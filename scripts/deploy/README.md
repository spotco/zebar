# Zebar local deploy (no recurring UAC)

1. **One-time UAC:** Run `grant_install_write_access.cmd` as Administrator (grants your user Modify on the install folder)
2. After each `build.bat`: `deploy_build.cmd` - stops Zebar and copies `target\release\zebar.exe` (+ desktop resources) into `C:\Program Files\glzr.io\Zebar` (no UAC)
3. Start with `start_zebar.cmd` (quoted path; defaults to y4m3.tokyo-silence bar preset)
