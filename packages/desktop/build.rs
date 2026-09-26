fn spotco_build_id() -> String {
  if let Ok(v) = std::env::var("SPOTCO_BUILD_ID") {
    if !v.is_empty() {
      return v;
    }
  }

  // Local time (this machine is America/New_York). Prefer PowerShell for a
  // stable yyyyMMdd-HHmmss stamp without adding build-deps.
  let ps = std::process::Command::new("powershell")
    .args([
      "-NoProfile",
      "-Command",
      "Get-Date -Format 'yyyyMMdd-HHmmss'",
    ])
    .output();

  if let Ok(out) = ps {
    if out.status.success() {
      let stamp = String::from_utf8_lossy(&out.stdout).trim().to_string();
      if !stamp.is_empty() {
        return format!("spotcobuild-{stamp}");
      }
    }
  }

  format!(
    "spotcobuild-unknown-{}",
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_secs())
      .unwrap_or(0)
  )
}

fn main() {
  // Re-run when build.bat sets a fresh trigger so each release build gets a
  // new spotcobuild stamp even if sources are unchanged.
  println!("cargo:rerun-if-env-changed=SPOTCO_BUILD_TRIGGER");
  println!("cargo:rerun-if-env-changed=SPOTCO_BUILD_ID");
  println!("cargo:rerun-if-env-changed=VERSION_NUMBER");

  let build_id = spotco_build_id();
  println!("cargo:rustc-env=SPOTCO_BUILD_ID={build_id}");

  tauri_build::build()
}
