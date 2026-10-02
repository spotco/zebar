# Plan: local spotcobuild-zebar-theme, no marketplace UI (2026-10-02)

## Done
- Pack renamed to `spotcobuild-zebar-theme` (folder, zpack.name, STARTER_PACK_ID, settings, deploy/package scripts).
- Vendored at `resources/spotcobuild-zebar-theme`; live at `%USERPROFILE%\.glzr\zebar\spotcobuild-zebar-theme\`.
- Default pack installs/refreshes as a **custom** pack under config_dir (no `.marketplace` / AppData downloads).
- Built-in `starter` always kept locally for missing-folder fallback; `widget_factory.startup` falls back to `starter`/`with-glazewm`.
- Marketplace UI removed: tray `Browse widgets...`, settings sidebar Marketplace, `/marketplace` routes.
- Deploy stamp: `spotcobuild-20261002-160327`; smoke: bar from local pack id `spotcobuild-zebar-theme`.
- Cleanup: removed `.marketplace`, AppData downloads + old webview caches, Program Files leftover `tokyo-silence` embed.
