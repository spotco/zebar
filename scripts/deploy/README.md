# Zebar local deploy (no recurring UAC)

1. **One-time UAC:** Run `grant_install_write_access.cmd` as Administrator (grants your user Modify on the install folder)
2. After each `build.bat`: `deploy_build.cmd` - stops Zebar and copies `target\release\zebar.exe` (+ desktop resources) into `C:\Program Files\glzr.io\Zebar` (no UAC). Add `--start` to restart the vendored spotcobuild bar automatically.
3. Start with `start_zebar.cmd` (quoted path; defaults to `spotco.tokyo-silence` bar preset).

Runtime diagnostics are written to `%USERPROFILE%\.glzr\zebar\zebar.log` and
errors to `errors.log`; each file is capped at 2 MiB with one `.1` backup.
