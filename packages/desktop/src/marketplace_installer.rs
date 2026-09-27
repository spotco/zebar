use std::{
  fs::{self},
  path::{Path, PathBuf},
  sync::Arc,
  time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{bail, Context};
use flate2::read::GzDecoder;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use tar::Archive;
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tokio::{sync::mpsc, task};
use uuid::Uuid;

use crate::{
  app_settings::AppSettings,
  common::{copy_dir_all, read_and_parse_json},
  widget_pack::{WidgetPack, WidgetPackConfig, WidgetPackManager},
};

/// The ID of the built-in starter pack.
/// Spotcobuild default bar pack (vendored tokyo-silence fork).
pub const STARTER_PACK_ID: &str = "spotco.tokyo-silence";

/// Metadata about an installed marketplace widget pack.
///
/// These are stored in `%userprofile%/.glzr/zebar/.marketplace`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplacePackMetadata {
  /// Unique identifier for the pack.
  pub pack_id: String,

  /// Version of the installed pack.
  pub version: String,

  /// Embedded-pack revision, when the pack is maintained by the fork.
  #[serde(default)]
  pub build_revision: Option<String>,

  /// Installation timestamp, stored as seconds since epoch.
  pub installed_at: u64,
}

impl MarketplacePackMetadata {
  pub fn new(pack_id: &str, version: &str) -> anyhow::Result<Self> {
    Ok(Self {
      pack_id: pack_id.to_string(),
      version: version.to_string(),
      build_revision: None,
      installed_at: SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("Failed to get timestamp.")?
        .as_secs(),
    })
  }
}

/// Manages installation of marketplace widget packs.
#[derive(Debug)]
pub struct MarketplaceInstaller {
  /// Handle to the Tauri application.
  app_handle: AppHandle,

  /// Reference to `AppSettings`.
  app_settings: Arc<AppSettings>,

  /// Sender channel for newly installed widget packs.
  installed_tx: mpsc::Sender<WidgetPack>,
}

impl MarketplaceInstaller {
  /// Creates a new `MarketplaceInstaller` instance.
  pub fn new(
    app_handle: &AppHandle,
    app_settings: Arc<AppSettings>,
  ) -> anyhow::Result<(Arc<Self>, mpsc::Receiver<WidgetPack>)> {
    let (installed_tx, installed_rx) = mpsc::channel(1);

    let installer = Self {
      app_handle: app_handle.clone(),
      app_settings,
      installed_tx,
    };

    // Keep the embedded spotcobuild pack current for existing installs
    // too. The settings file remains user-owned; only the embedded
    // pack copy is refreshed when its version/revision changes.
    installer.install_starter_pack_if_needed()?;

    Ok((Arc::new(installer), installed_rx))
  }

  /// Returns a vector of `MarketplacePackMetadata` instances for all
  /// installed packs.
  pub fn installed_packs_metadata(
    &self,
  ) -> anyhow::Result<Vec<MarketplacePackMetadata>> {
    let packs_metadata =
      fs::read_dir(&self.app_settings.marketplace_meta_dir)?
        .filter_map(|entry| {
          let metadata = read_and_parse_json::<MarketplacePackMetadata>(
            &entry.ok()?.path(),
          )
          .ok()?;

          Some(metadata)
        })
        .collect();

    Ok(packs_metadata)
  }

  /// Installs a widget pack from the marketplace.
  pub async fn install(
    &self,
    pack_id: &str,
    version: &str,
    tarball_url: &str,
    is_preview: bool,
  ) -> anyhow::Result<WidgetPack> {
    let pack_dir = self
      .app_settings
      .marketplace_pack_download_dir(pack_id, version);

    // Download and extract the pack. Skip the download if the directory
    // already exists.
    if !pack_dir.exists() {
      self.download_and_extract(&pack_dir, tarball_url).await?;
    }

    // Create metadata.
    let metadata = MarketplacePackMetadata::new(pack_id, version)?;

    let pack = WidgetPackManager::read_widget_pack(
      &pack_dir.join("zpack.json"),
      Some(&metadata),
    )?;

    if !is_preview {
      fs::create_dir_all(&self.app_settings.marketplace_meta_dir)?;

      // Write metadata to file.
      fs::write(
        self.app_settings.marketplace_pack_metadata_path(pack_id),
        serde_json::to_string_pretty(&metadata)? + "\n",
      )?;

      // Broadcast the installation event.
      self.installed_tx.send(pack.clone()).await?;
    }

    tracing::info!("Installed widget pack: {}", pack_id);

    Ok(pack)
  }

  /// Deletes the metadata for an installed widget pack.
  pub fn delete_metadata(&self, pack_id: &str) -> anyhow::Result<()> {
    let metadata_path =
      self.app_settings.marketplace_pack_metadata_path(pack_id);

    if metadata_path.exists() {
      fs::remove_file(metadata_path)?;
    }

    Ok(())
  }

  /// Downloads and extracts a widget pack.
  async fn download_and_extract(
    &self,
    pack_dir: &PathBuf,
    tarball_url: &str,
  ) -> anyhow::Result<()> {
    tracing::info!("Downloading widget pack from {}.", tarball_url);

    // Download the tarball.
    let response = reqwest::get(tarball_url).await?;

    if response.status() != StatusCode::OK {
      bail!("Failed to download widget pack: HTTP {}", response.status());
    }

    let bytes = response.bytes().await?;

    // Create the pack directory.
    fs::create_dir_all(pack_dir)?;
    tracing::info!("Extracting widget pack to {}", pack_dir.display());

    // Extract the tarball.
    task::spawn_blocking({
      let pack_dir = pack_dir.clone();

      move || {
        let decoder = GzDecoder::new(&bytes[..]);
        let mut archive = Archive::new(decoder);
        archive.unpack(&pack_dir)
      }
    })
    .await??;

    Ok(())
  }

  /// Installs or refreshes the spotcobuild default pack from the embedded
  /// `tokyo-silence` resource (`spotco.tokyo-silence`).
  fn install_starter_pack_if_needed(&self) -> anyhow::Result<()> {
    let starter_pack_dir = self
      .app_handle
      .path()
      .resolve("../../resources/tokyo-silence", BaseDirectory::Resource)
      .context("Unable to resolve starter pack resource.")?;

    let pack_config = read_and_parse_json::<WidgetPackConfig>(
      &starter_pack_dir.join("zpack.json"),
    )?;

    let metadata_path = self
      .app_settings
      .marketplace_pack_metadata_path(STARTER_PACK_ID);
    let installed_metadata = read_embedded_pack_metadata(&metadata_path);

    let dest_dir = self.app_settings.marketplace_pack_download_dir(
      STARTER_PACK_ID,
      &pack_config.version,
    );

    if !should_update_embedded_pack(
      installed_metadata.as_ref(),
      &pack_config,
      dest_dir.is_dir(),
    ) {
      return Ok(());
    }

    refresh_embedded_pack(
      &starter_pack_dir,
      &dest_dir,
      &metadata_path,
      &pack_config,
    )
  }
}

fn refresh_embedded_pack(
  source_dir: &Path,
  destination_dir: &Path,
  metadata_path: &Path,
  embedded_config: &WidgetPackConfig,
) -> anyhow::Result<()> {
  refresh_embedded_pack_with_copy(
    source_dir,
    destination_dir,
    metadata_path,
    embedded_config,
    |source, destination| copy_dir_all(source, destination, true),
  )
}

fn refresh_embedded_pack_with_copy<F>(
  source_dir: &Path,
  destination_dir: &Path,
  metadata_path: &Path,
  embedded_config: &WidgetPackConfig,
  copy: F,
) -> anyhow::Result<()>
where
  F: FnOnce(&Path, &Path) -> anyhow::Result<()>,
{
  let staging_dir = unique_sibling(destination_dir, "staging");
  let backup_dir = unique_sibling(destination_dir, "backup");

  let result = (|| {
    copy(source_dir, &staging_dir)?;

    // Validate the completed staged copy before touching the live pack.
    let staged_config = read_and_parse_json::<WidgetPackConfig>(
      &staging_dir.join("zpack.json"),
    )?;
    anyhow::ensure!(
      staged_config.version == embedded_config.version
        && staged_config.build_revision == embedded_config.build_revision,
      "Staged embedded pack metadata does not match its source."
    );

    let had_destination = destination_dir.exists();
    if had_destination {
      fs::rename(destination_dir, &backup_dir)?;
    }

    if let Err(error) = fs::rename(&staging_dir, destination_dir) {
      if had_destination {
        let _ = fs::rename(&backup_dir, destination_dir);
      }
      return Err(error.into());
    }

    let mut metadata = MarketplacePackMetadata::new(
      STARTER_PACK_ID,
      &embedded_config.version,
    )?;
    metadata.build_revision = embedded_config.build_revision.clone();

    // Metadata is written only after the new pack is in place. If this
    // fails, restore the prior directory so startup still has a usable
    // pack.
    if let Err(error) = fs::write(
      metadata_path,
      serde_json::to_string_pretty(&metadata)? + "\n",
    ) {
      let _ = remove_path(destination_dir);
      if had_destination {
        let _ = fs::rename(&backup_dir, destination_dir);
      }
      return Err(error.into());
    }

    if had_destination {
      remove_path(&backup_dir)?;
    }

    Ok(())
  })();

  if staging_dir.exists() {
    let _ = remove_path(&staging_dir);
  }

  result
}

fn unique_sibling(path: &Path, purpose: &str) -> PathBuf {
  let name = path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("embedded-pack");
  path.with_file_name(format!(".{name}.{purpose}-{}", Uuid::new_v4()))
}

fn remove_path(path: &Path) -> std::io::Result<()> {
  if path.is_dir() {
    fs::remove_dir_all(path)
  } else {
    fs::remove_file(path)
  }
}

fn should_update_embedded_pack(
  installed: Option<&MarketplacePackMetadata>,
  embedded: &WidgetPackConfig,
  destination_exists: bool,
) -> bool {
  let Some(installed) = installed else {
    return true;
  };

  installed.pack_id != STARTER_PACK_ID
    || installed.version != embedded.version
    || installed.build_revision != embedded.build_revision
    || !destination_exists
}

fn read_embedded_pack_metadata(
  metadata_path: &Path,
) -> Option<MarketplacePackMetadata> {
  if !metadata_path.is_file() {
    return None;
  }

  match read_and_parse_json::<MarketplacePackMetadata>(metadata_path) {
    Ok(metadata) => Some(metadata),
    Err(error) => {
      tracing::warn!(
        "Ignoring malformed embedded-pack metadata at {}: {error:#}",
        metadata_path.display()
      );
      None
    }
  }
}

#[cfg(test)]
mod tests {
  use std::{fs, path::Path};

  use super::*;

  fn embedded(version: &str, revision: Option<&str>) -> WidgetPackConfig {
    WidgetPackConfig {
      schema: None,
      name: "tokyo-silence".into(),
      version: version.into(),
      build_revision: revision.map(str::to_string),
      description: String::new(),
      tags: Vec::new(),
      preview_images: Vec::new(),
      repository_url: String::new(),
      widgets: Vec::new(),
    }
  }

  fn metadata(
    version: &str,
    revision: Option<&str>,
  ) -> MarketplacePackMetadata {
    MarketplacePackMetadata {
      pack_id: STARTER_PACK_ID.into(),
      version: version.into(),
      build_revision: revision.map(str::to_string),
      installed_at: 0,
    }
  }

  #[test]
  fn existing_older_embedded_pack_is_refreshed() {
    assert!(should_update_embedded_pack(
      Some(&metadata("1.0.0", Some("old"))),
      &embedded("1.0.1", Some("new")),
      true,
    ));
  }

  #[test]
  fn matching_embedded_pack_is_not_recopied() {
    assert!(!should_update_embedded_pack(
      Some(&metadata("1.0.1", Some("new"))),
      &embedded("1.0.1", Some("new")),
      true,
    ));
  }

  #[test]
  fn missing_embedded_pack_is_recreated() {
    assert!(should_update_embedded_pack(
      Some(&metadata("1.0.1", Some("new"))),
      &embedded("1.0.1", Some("new")),
      false,
    ));
  }

  #[test]
  fn malformed_embedded_metadata_is_ignored() {
    let path = std::env::temp_dir().join(format!(
      "zebar-malformed-pack-metadata-{}.json",
      Uuid::new_v4()
    ));
    fs::write(&path, "not json").expect("write malformed metadata");

    assert!(read_embedded_pack_metadata(&path).is_none());
    fs::remove_file(path).expect("remove malformed metadata");
  }

  #[test]
  fn failed_embedded_pack_copy_preserves_existing_install() {
    let root = std::env::temp_dir()
      .join(format!("zebar-pack-refresh-failure-{}", Uuid::new_v4()));
    let destination = root.join("spotco.tokyo-silence@1.0.1");
    let metadata_path = root.join("spotco.tokyo-silence.json");
    fs::create_dir_all(&destination).expect("create old pack");
    fs::write(destination.join("old.txt"), "keep me")
      .expect("write old pack");

    let old_metadata = metadata("1.0.1", Some("old"));
    fs::write(
      &metadata_path,
      serde_json::to_string_pretty(&old_metadata)
        .expect("serialize metadata"),
    )
    .expect("write old metadata");

    let result = refresh_embedded_pack_with_copy(
      Path::new("missing-source"),
      &destination,
      &metadata_path,
      &embedded("1.0.1", Some("new")),
      |_, _| Err(anyhow::anyhow!("simulated copy failure")),
    );

    assert!(result.is_err());
    assert_eq!(
      fs::read_to_string(destination.join("old.txt")).expect("old pack"),
      "keep me"
    );
    assert_eq!(
      read_and_parse_json::<MarketplacePackMetadata>(&metadata_path)
        .expect("old metadata")
        .build_revision,
      Some("old".into())
    );
    fs::remove_dir_all(root).expect("remove test data");
  }
}
