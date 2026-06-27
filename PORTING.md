# Tauri (Rust) port

Porting Local Gallery off Electron onto **Tauri v2 + Rust** for a smaller,
faster, native macOS app (cross-platform-capable). 

**Cutover complete** on this branch (tauri-port-ii and descendants). Electron files
(`main.js`, `preload.js`, electron* deps) have been removed. The app now builds and
runs exclusively via Tauri. The `main` branch history retains the Electron era.

## Why

The Electron pain points (video thumbnails, large-library memory, startup) are
exactly what a native Rust backend + system WebView solves. The UI logic in
`index.html` (~58k lines of DOM/JS: navigation, scoring/tags/votes/victories,
Compare mode, appearance presets, sorting, keybinds) is plain web code and
ports as-is — only the seams that touch the OS get rewritten in Rust.

## Layout

```
index.html            # the existing UI — loaded as-is in the WebView (frontendDist)
src-tauri/
  Cargo.toml          # Rust crate + deps (tauri, image, serde)
  tauri.conf.json      # window, security (asset protocol), bundle/icons
  build.rs
  capabilities/        # window permissions (Tauri v2)
  icons/               # generated from assets/icon.icns
  src/
    main.rs            # thin entry -> lib::run()
    lib.rs             # commands: ping, generate_thumbnail (+ unit test)
```

## Run

```bash
npm start              # or: npm run tauri:dev
npm run tauri:build    # .app + .dmg (and platform equivalents)
cd src-tauri && cargo test
```

The bridge and shims are injected automatically. From the WebView console:

```js
await window.__TAURI__.core.invoke('ping')
window.__lg.requestThumb('/abs/path/to/video.mp4', 256)
```

## Status

**Cutover complete.** All phases implemented:

- Full native FS layer via injected `tauri-fs-shim.js` (showDirectoryPicker + full handle API backed by Rust).
- Asset protocol for all media + thumbs.
- `tauri-bridge.js` providing electronAPI compat + thumbnail request API.
- Thumbnails fully wired (disk cache + ffmpeg + image crate).
- Metadata persistence works via the shims.
- Feature parity + packaging validated.
- Electron completely removed; Tauri is the only builder.

See docs/TAURI_PORT_DESIGN.md for the detailed history and phase notes.

## Notes / gotchas

- `frontendDist` currently points at the repo root so the existing `index.html`
  loads with zero changes. Before a real `tauri build`, point it at a dedicated
  frontend dir so the bundle doesn't embed `node_modules`/`dist`/`.git`.
- The WebView engine differs per OS (WKWebView/macOS, WebView2/Windows,
  WebKitGTK/Linux) — test UI across them if Windows stays a target.
- `showDirectoryPicker` and the File System Access API do **not** exist in
  WKWebView; opening a library won't work until the filesystem layer lands.
  That's expected at this stage — the PoC validates thumbnailing, not full flow.
