# Tauri (Rust) port

Porting Local Gallery off Electron onto **Tauri v2 + Rust** for a smaller,
faster, native macOS app (cross-platform-capable). This lives on the
`tauri-port` branch and is **additive** — the Electron app (`main.js`,
`preload.js`, `npm start`) still works untouched on `main`.

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
npm run tauri:dev      # launch the app in the system WebView (debug)
npm run tauri:build    # produce a .app/.dmg (release)
cd src-tauri && cargo test   # run Rust unit tests (thumbnail PoC)
```

In the running app's devtools console (`withGlobalTauri` is on):

```js
await window.__TAURI__.core.invoke('ping')
await window.__TAURI__.core.invoke('generate_thumbnail', { path: '/abs/path/to/video.mp4', maxEdge: 512 })
```

## Status

- [x] Rust toolchain + Tauri CLI installed; `src-tauri` scaffolded; icons generated.
- [x] Existing `index.html` loads in the WebView (WKWebView on macOS).
- [x] **Thumbnail PoC**: `generate_thumbnail` — images via the `image` crate,
      video/other via macOS QuickLook (`qlmanage`). Unit-tested.
- [ ] Asset protocol wiring so the frontend renders thumbnails as `<img>`
      (`convertFileSrc`).
- [ ] **Filesystem layer** (the bulk): replace the File System Access API
      (`showDirectoryPicker`, file/dir handles, `createWritable`) with Rust
      commands (`scan_library`, `read_file`, `write_file`) — the core data model
      (`DirNode`/`FileRecord`) becomes path-based.
- [ ] `window.electronAPI` compatibility shim over Tauri `invoke` so existing
      IPC calls keep working with minimal edits.
- [ ] Metadata I/O in Rust (keep the `.local-gallery/*.log.json` format first;
      SQLite later).
- [ ] Media serving (replace `file://`/`ensureMediaUrl` with the asset protocol).
- [ ] Production thumbnailing: AVFoundation/QLThumbnailGenerator on macOS,
      ffmpeg on Windows (replace the `qlmanage` shell-out).
- [ ] Windows/Linux build jobs in CI; signing + notarization.

## Notes / gotchas

- `frontendDist` currently points at the repo root so the existing `index.html`
  loads with zero changes. Before a real `tauri build`, point it at a dedicated
  frontend dir so the bundle doesn't embed `node_modules`/`dist`/`.git`.
- The WebView engine differs per OS (WKWebView/macOS, WebView2/Windows,
  WebKitGTK/Linux) — test UI across them if Windows stays a target.
- `showDirectoryPicker` and the File System Access API do **not** exist in
  WKWebView; opening a library won't work until the filesystem layer lands.
  That's expected at this stage — the PoC validates thumbnailing, not full flow.
