# Local Gallery — Tauri/Rust Port: Design & Plan

Status: **living document.** Phase 0 (scaffold) is done on branch `tauri-port`.
Quick-start lives in `PORTING.md`; this is the full design and ordered plan.

---

## 1. Goals & non-goals

**Goals**
- Replace Electron with **Tauri v2 + Rust** for a smaller, faster, lower-memory
  native macOS app (cross-platform-capable).
- Make the chronic pain points fast and reliable: **video/image thumbnails**,
  **large-library** scanning/scrolling, **startup time**, memory.
- Preserve the existing UI and feature set (navigation model, scoring, tags,
  votes/victories, Compare mode, appearance presets, sorting, search,
  slideshow, keybinds) with as little rewrite of `index.html` as possible.

**Non-goals (for the port itself)**
- No UI redesign — same UX, ported faithfully. New features come after parity.
- No change to `clean.sh` or the Tampermonkey userscripts (independent tools).
- Not committing to SQLite up front — keep the `.local-gallery/*.log.json`
  format first, revisit storage only if it proves a bottleneck.

---

## 2. Where we're porting *from* (current Electron architecture)

- **`main.js`** — creates the window; one IPC handler `downloads-write-file`.
- **`preload.js`** — exposes `window.electronAPI` = `{ getPathForFile,
  writeDownloadFile }`.
- **`index.html`** (~59k lines) — the whole app. Key globals/subsystems:
  - `WS.root` / `WS.dirByPath` — directory tree of `DirNode`s, built from
    **File System Access API** handles.
  - `WS.fileById` — `Map<id, FileRecord>` holding `File` objects + object URLs.
  - `WS.catalog` — sharded JSON on disk for deferred loading of huge libraries.
  - `WS.meta` — scores/tags/votes/victories/prefs/keybinds, persisted as JSON
    logs in `<root>/.local-gallery/` via `createWritable`.
  - `WS.view` / `WS.nav` / `WS.preview` — transient UI state.
  - Media URLs via `ensureMediaUrl` (`file://` / blob object URLs).
  - Thumbnails: image + (the hard one) video.

**The load-bearing dependency:** the entire data model is built on the **File
System Access API** (`showDirectoryPicker`, `getDirectoryHandle`,
`getFileHandle`, `getFile`, `createWritable`). That API **does not exist in
WKWebView**, so replacing it is the spine of this port.

---

## 3. Where we're porting *to* (target architecture)

```
frontend (index.html, unchanged UI)  ──invoke()──►  Rust backend (src-tauri)
        │                                                   │
        │   window.electronAPI shim ──► Tauri commands      ├─ fs: scan/read/write
        │   media/thumbs as <img>/<video> via asset:        ├─ thumbnails (native)
        │                                                   ├─ metadata I/O
        └───────────────  WKWebView (macOS)  ───────────────┴─ dialogs, watch
```

The strategy: **keep `index.html` as-is**, and replace only the seams where it
touches the OS:
1. `window.electronAPI` → a thin shim over Tauri `invoke`.
2. File System Access API → Rust `fs` commands (path-based, not handle-based).
3. `ensureMediaUrl` (`file://`/blob) → Tauri **asset protocol** (`convertFileSrc`).
4. Thumbnail generation → the Rust `generate_thumbnail` command (PoC done).
5. Metadata read/write → Rust commands over the same `.log.json` files.

Everything else (DOM rendering, scoring math, Compare mode, sort, keybinds) is
plain web code and ports unchanged.

---

## 4. Guiding principles

- **Incremental & reversible.** Electron stays working on `main` until Tauri
  reaches parity. Each phase ends in a runnable, more-complete app.
- **Parity before improvement.** Match current behavior first; optimize/redesign
  after.
- **Thin shim, not a rewrite.** Prefer adapting the existing `electronAPI`/FS
  call sites over rewriting UI logic.
- **Verify each phase.** Every phase has an explicit "done when" check; the Rust
  side gets unit/integration tests where practical.
- **Native where it pays.** Thumbnails, library scan, file I/O, and watching run
  in Rust on real threads — that's the whole point.

---

## 5. The plan (in order)

Each phase: **goal → steps → done-when.**

### Phase 0 — Scaffold ✅ (done)
Tauri v2 crate, config, icons, npm scripts, `generate_thumbnail` PoC + test,
`index.html` loads in WKWebView. (Commit `7fbdb64`.)

### Phase 1 — Backend bridge & boot ✅ (done)
*Goal: the real UI boots in Tauri and can talk to Rust without per-call rewrites.*
- `tauri-bridge.js` injected as a Rust **`initialization_script`** (the main
  window is now built in `src/lib.rs` so the script runs before page scripts).
  It re-creates `window.electronAPI` (`isElectron`, `getPathForFile`,
  `writeDownloadFile`) over Tauri `invoke`, plus `window.__lg` dev helpers.
- `write_download_file` Rust command implemented (replaces the Electron
  `downloads-write-file` IPC; writes to the OS Downloads dir with unique names).
- **Verified end-to-end:** launching logs `[lg] ping()` from Rust — proving the
  shim installs before boot and IPC round-trips. `getElectronApi()` now returns
  the shim, so the UI takes its native path instead of the web fallback.

### Phase 2 — Filesystem layer & opening a library ✅ (core done)
*Goal: pick a root folder and build the `DirNode`/`FileRecord` tree from Rust.*
- **Approach taken:** a **File System Access API shim** (`tauri-fs-shim.js`)
  rather than rewriting the handle-based builder. It overrides
  `showDirectoryPicker` and provides `TauriDirHandle`/`TauriFileHandle`/
  writable objects whose methods call native Rust commands, so the existing open
  flow (tree scan, `.local-gallery` metadata logs, catalog) runs unchanged.
- **Rust commands** (`src-tauri/src/fs.rs`): `pick_root` (tauri-plugin-dialog),
  `scan_dir`, `path_kind`, `read_file_bytes`, `write_file_bytes` (atomic),
  `make_dir`, `touch_file`, `remove_path`. Unit-tested.
- Media URLs: `ensureMediaUrl` now uses the **asset protocol** under Tauri
  (`window.__lg.assetUrl` → `convertFileSrc`) instead of `file://`, which
  WKWebView blocks. (This pulls part of Phase 3 forward so the open renders.)
- **Verified end-to-end:** auto-opening a test library (`LG_DEV_OPEN`) reported
  `openRoot OK dirs=5 files=4` and wrote the full `.local-gallery/*.log.json`
  set to disk — proving recursive scan + file records + metadata read/write all
  work through the shim.
- **2b done:** last root is remembered (`save_last_root`/`get_last_root`) but the
  app starts with **no** library loaded (auto-reopen was removed — it was
  unintended; reserved for a future explicit "reopen recent"); native
  `rename_path` command +
  `handle.move()` shim so rename and move-to-trash are instant fs renames (not a
  read-whole-file-through-IPC copy); `toUint8` handles the FileLike so the
  copy-fallback path is correct too.
- **Remaining for later:** recursive catalog (`scan_tree`) for huge libraries;
  broader runtime QA of navigation/rename/trash in the real UI (I can't drive the
  GUI headlessly — dev hooks cover open + auto-reopen only).

### Phase 3 — Media display (images + video playback) ✅ (done)
*Goal: images render and videos play in the preview/viewer.*
- `ensureMediaUrl` serves media via the asset protocol (`convertFileSrc`) under
  Tauri — wired in Phase 2; all `getPassivePreviewSrcForRecord`/`<video>.src`
  paths flow through it.
- **Asset scope hardened:** config scope is now `[]` (deny-all); the open flow
  grants just the opened root at runtime (`allow_media_scope` →
  `asset_protocol_scope().allow_directory`), so the WebView can't read arbitrary
  files. Called from the shim's `rememberRoot` (awaited before render).
- **Verified end-to-end:** with the test library, a media file fetches
  `full=200/10777B` (loads through the restricted scope) and `range=206`
  (Range request honored → video seeking works).
- Remaining (minor): a negative scope test (out-of-root file blocked) and full
  visual QA of the viewer are user-side.

### Phase 4 — Thumbnails wired into the UI  ⟵ the visible payoff
*Goal: image and video thumbnails render as cheap `<img>`, fast.*

**4a done:** the thumbnail *service* + the safe lazy-`<img>` path.
- `generate_thumbnail` is now a real disk cache under `<root>/.local-gallery/
  thumbs/`, keyed by path+size+mtime+edge (short-circuits; edits invalidate).
- `window.__lg.requestThumb(path, edge)` → cached-thumb asset URL.
- Interception at `assignThumbSrc` (the one lazy-`<img>` loader; the full-size
  viewer bypasses it): prefer the cached downscaled thumb, fall back to the
  full-media src until generated, then swap in — **never worse than today**.
- Gotcha fixed: the root's `**` asset-scope glob doesn't match the hidden
  `.local-gallery` dir, so the thumbs dir is allowed explicitly in `rememberRoot`.
- **Verified:** `thumb status=200 bytes=1210` (vs 10777 original) — generate →
  cache → asset-load works; 512px thumbs were produced during the real render.

**4b done:** inline leads + video thumbnails.
- `tauriThumbnailizeContainer` post-render pass routes inline `dirInlinePreview`/
  `folderThumb` leads (image + video) through `requestThumb`; called for the
  preview grid, preview body, and the directory list. Gates out the live-`<video>`
  folder-lead upgrade under Tauri.
- File-card videos take the `<img>` path under Tauri (the live-`<video>` branch
  is skipped) — a transparent pixel shows until the generated frame swaps in.
- **Verified:** with a real test `.mp4`, `vidthumb status=200` (QuickLook frame,
  cached `.png`, asset-served) alongside `imgthumb status=200` — no live
  WebMediaPlayer for thumbnails.
- Follow-ups (minor): "heavy folder" passive path still shows a fallback icon
  (div, not img) so it isn't thumbnailized yet; bounded-concurrency queue;
  visual QA of a dense grid (needs your eyes).

**4c (fixes from first real GUI test):**
- **Beachball during navigation** — the Rust commands were synchronous, so they
  ran on the main thread; `generate_thumbnail` (image decode / subprocess) firing
  during nav froze the UI. Made the heavy commands **async + spawn_blocking**
  (generate_thumbnail, scan_dir, read/write_file_bytes, remove_path).
- **Video frame "changed"/"re-cropped"** — QuickLook ignored the per-file
  thumbnail frame time, picking a different frame at a different aspect (so the
  crop looked wrong). Video thumbs now use **ffmpeg** seeking to
  `metaGetVideoThumbnailTimeForRecord` (early-frame default ≈ Electron's),
  aspect-preserving; cache key includes the frame so changes regenerate.
  Caveat: uses a system ffmpeg (common paths) — **Phase 8 bundles ffmpeg-static**
  so packaged builds work; falls back to QuickLook when ffmpeg is absent.

### Phase 5 — Metadata persistence
*Goal: scores/tags/votes/victories/prefs/keybinds load and save.*
- Rust reads/writes the existing `.local-gallery/*.log.json` files (scores,
  tags, victories, preferences, keyboard config, etc.) — same format, so no
  data migration. Atomic writes (temp + rename).
- Wire the `metaScheduleSave`/load paths through Rust instead of `createWritable`.
- **Done when:** scoring, tagging, Compare-mode victories, the Victories sort,
  appearance presets, and keybinds all persist across restarts.

### Phase 6 — Feature parity & WKWebView QA
*Goal: every feature works under WebKit, not just Chromium.*
- Walk the feature list and fix engine quirks: Compare mode, appearance presets/
  filters (CSS), sorting (incl. Victories), search, slideshow/gallery, bulk
  select, rename/trash/storage, drag-and-drop (use Tauri's file-drop events),
  downloads, fullscreen, clipboard.
- **Done when:** a parity checklist passes against the Electron build.

### Phase 7 — Performance pass
*Goal: beat Electron on the metrics that motivated the port.*
- Large-library: verify virtualized grids scroll smoothly in WebKit; tune chunk
  sizes; ensure scan/thumb work stays off the UI thread.
- Startup & memory measurements vs Electron.
- If JSON metadata is a bottleneck at scale, evaluate **SQLite** (GRDB-style)
  for scores/tags — but only if measured.
- **Done when:** measured wins on startup, memory, and large-folder open/scroll.

### Phase 8 — Production-grade thumbnails
*Goal: replace the `qlmanage` shell-out with native/robust generation.*
- macOS: `QLThumbnailGenerator` / AVFoundation via `objc2` bindings (fast,
  in-process, no subprocess).
- Windows: bundled `ffmpeg` (or Media Foundation) for video frames; `image`
  crate for images.
- **Done when:** thumbnail generation is in-process and fast on both platforms.

### Phase 9 — Packaging & distribution
*Goal: shippable signed builds.*
- Point `frontendDist` at a dedicated, minimal frontend dir (already synced via
  `scripts/sync-frontend.js`); confirm the bundle excludes `node_modules`/`dist`.
- macOS code signing + notarization; DMG. Auto-update (tauri-plugin-updater) if
  wanted.
- Windows (WebView2) + Linux builds; update the GitHub Actions workflow with a
  Tauri matrix job alongside/replacing the Electron one.
- **Done when:** signed macOS DMG installs and runs on a clean machine; CI
  produces artifacts.

### Phase 10 — Cutover
*Goal: Tauri is the app.*
- Remove Electron (`main.js`, `preload.js`, `electron`/`electron-builder` deps,
  the `dist`/`start` scripts) once parity + packaging are confirmed.
- Update `CLAUDE.md`, `README`, release script for the Tauri toolchain.
- Merge `tauri-port` → `main`.
- **Done when:** `main` builds and ships as a Tauri app; Electron is gone.

---

## 6. Cross-cutting concerns

- **WKWebView vs Chromium.** No File System Access API (Phase 2 handles it);
  watch for CSS/JS engine differences; confirm `<video>` range playback via the
  asset protocol. If Windows stays a target, every UI change is tested on two
  engines (WebView2 + WKWebView).
- **Security/scopes.** Narrow `assetProtocol.scope` and capabilities to the open
  root rather than `**` before shipping.
- **Large libraries.** Keep the catalog/sharded model; do scanning and
  thumbnailing on Rust threads; paginate scan results to the frontend.
- **Atomic writes.** Metadata logs written temp-then-rename to avoid corruption.
- **Path handling.** Normalize separators; handle Unicode/spaces (the asset
  protocol and command args already do, but test).

---

## 7. Key decisions & open questions

1. **Metadata storage:** keep JSON logs (default) vs move to SQLite. → Decide in
   Phase 7 based on measured scale.
2. **Frontend structure:** keep `index.html` monolith vs split during the port.
   → Keep monolith for parity; revisit post-cutover.
3. **Windows in scope?** If yes, budget WebView2 QA + ffmpeg packaging now; if
   Mac-only, we can lean harder on Apple frameworks. → Needs your call.
4. **Bridge approach:** `electronAPI` shim (least UI churn) vs gradually
   replacing call sites with direct `invoke`. → Start with the shim.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| FS-layer rewrite is large and blocks everything | Phase it: lazy `scan_dir` first to get *something* on screen, then catalog/recursive |
| WebKit renders the dense media grid differently/slower | Early smoke test in Phase 1; perf pass in Phase 7 |
| `<video>` won't seek over asset protocol | Verify range-request support early in Phase 3; fall back to a custom protocol if needed |
| `qlmanage` flaky/slow for thumbnails | It's only the interim path; Phase 8 moves to AVFoundation/ffmpeg |
| Scope creep into a UI rewrite | Parity-first principle; new features gated until after cutover |

---

## 9. Definition of done

Tauri build reaches **feature parity** with the Electron app, **measurably
faster** on startup/memory/thumbnails/large-folder scroll, is **signed and
packaged**, and `main` ships it with Electron removed.
