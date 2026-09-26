use std::{
  fs::{self, DirEntry},
  path::Path,
};

use anyhow::Context;
use serde::de::DeserializeOwned;

/// Reads a JSON file and parses it into the specified type.
///
/// Returns the parsed type `T` if successful.
pub fn read_and_parse_json<T: DeserializeOwned>(
  path: &Path,
) -> anyhow::Result<T> {
  let content = fs::read_to_string(path)
    .with_context(|| format!("Failed to read file: {}", path.display()))?;

  serde_json::from_str(&content).with_context(|| {
    format!("Failed to parse JSON from file: {}", path.display())
  })
}

/// Returns whether the path has the given extension.
pub fn has_extension(path: &Path, extension: &str) -> bool {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .map(|name| name.ends_with(extension))
    .unwrap_or(false)
}

/// Recursively copies a directory and all its contents to a new file
/// location.
///
/// Optionally replaces existing files in the destination directory if
/// `override_existing` is `true`.
pub fn copy_dir_all(
  src_dir: &Path,
  dest_dir: &Path,
  override_existing: bool,
) -> anyhow::Result<()> {
  fs::create_dir_all(dest_dir)?;

  for entry in fs::read_dir(src_dir)? {
    let entry = entry?;
    let source_path = entry.path();
    let dest_path = dest_dir.join(entry.file_name());

    if source_path.is_dir() {
      copy_dir_all(&source_path, &dest_path, override_existing)?;
    } else if override_existing || !dest_path.exists() {
      fs::copy(source_path, dest_path)?;
    }
  }

  Ok(())
}

/// Recursively visit files in a directory.
///
/// The callback is invoked for each entry in the directory.
pub fn visit_deep<F>(dir: &Path, callback: &mut F) -> anyhow::Result<()>
where
  F: FnMut(&DirEntry),
{
  if dir.is_dir() {
    let read_dir = std::fs::read_dir(dir).with_context(|| {
      format!("Failed to read directory {}.", dir.display())
    })?;

    for entry in read_dir {
      let entry = entry?;
      let path = entry.path();

      callback(&entry);

      if path.is_dir() {
        visit_deep(&path, callback)?;
      }
    }
  }

  Ok(())
}
