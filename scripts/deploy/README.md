# Deploy helpers (Asus / spotcobuild)

1. One-time: `grant_install_write_access.cmd` (Run as administrator) so deploy can write Program Files without UAC each time.
2. After each `build.bat`: `deploy_build.cmd` - stops Zebar and copies `target\release\zebar.exe`, desktop resources, and the vendored `spotcobuild-zebar-theme` pack into `C:\Program Files\glzr.io\Zebar`, and syncs `%USERPROFILE%\.glzr\zebar\spotcobuild-zebar-theme\`. Add `--start` to restart the bar automatically.
3. Start with `start_zebar.cmd` (quoted path; defaults to `spotcobuild-zebar-theme` bar preset).
