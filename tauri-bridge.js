// Tauri compatibility bridge (provides the former electronAPI surface).
//
// Injected as a Tauri initialization script (see src-tauri/src/lib.rs) so it
// runs BEFORE index.html's inlined app script. It creates `window.electronAPI`
// (with isElectron + isTauri) on top of Tauri `invoke` so the existing UI takes
// its native code paths without per-call-site rewrites.
//
// As the port progresses, new native capabilities (filesystem, thumbnails,
// metadata) are added here as thin wrappers over Rust commands.
(function () {
  "use strict";

  // Resolve Tauri's invoke from either the global API (withGlobalTauri) or the
  // always-present internals, so we don't depend on script ordering.
  function resolveInvoke() {
    var g = typeof window !== "undefined" ? window : null;
    if (!g) return null;
    if (g.__TAURI__ && g.__TAURI__.core && typeof g.__TAURI__.core.invoke === "function") {
      return g.__TAURI__.core.invoke.bind(g.__TAURI__.core);
    }
    if (g.__TAURI_INTERNALS__ && typeof g.__TAURI_INTERNALS__.invoke === "function") {
      return g.__TAURI_INTERNALS__.invoke.bind(g.__TAURI_INTERNALS__);
    }
    return null;
  }

  var invoke = resolveInvoke();
  if (!invoke) {
    // Not running under Tauri (or API not yet present): leave window.electronAPI
    // untouched so the app falls back to its normal web behavior.
    console.warn("[tauri-bridge] Tauri invoke unavailable; electronAPI shim not installed");
    return;
  }

  // Coerce whatever the caller passes as bytes into a Uint8Array for transfer.
  function toBytes(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (bytes && bytes.buffer instanceof ArrayBuffer) {
      return new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
    }
    if (Array.isArray(bytes)) return Uint8Array.from(bytes);
    return new Uint8Array(0);
  }

  window.electronAPI = {
    // The UI uses this flag to choose its native path over the web fallback.
    isElectron: true,
    isTauri: true,

    // Electron resolved a File object to its absolute path via webUtils. There's
    // no equivalent for browser File objects under Tauri; the filesystem layer
    // (Phase 2) makes paths first-class so this becomes unnecessary. Best-effort
    // for now.
    getPathForFile: function (file) {
      try {
        return file && file.path ? String(file.path) : "";
      } catch (e) {
        return "";
      }
    },

    // Save bytes to the user's Downloads folder; returns the written path.
    // Save to Downloads (replaces the former downloads-write-file path).
    writeDownloadFile: function (payload) {
      payload = payload || {};
      return invoke("write_download_file", {
        fileName: String(payload.fileName || ""),
        bytes: Array.from(toBytes(payload.bytes)),
      });
    },
  };

  // Convert an absolute filesystem path into a URL the WebView can load
  // (Tauri asset protocol). WKWebView blocks file:// from the app origin, so
  // media/thumbnails must use this instead. Falls back to the raw path.
  function assetUrl(absPath) {
    var p = String(absPath || "");
    if (!p) return "";
    try {
      var core = window.__TAURI__ && window.__TAURI__.core;
      if (core && typeof core.convertFileSrc === "function") {
        return core.convertFileSrc(p);
      }
    } catch (e) {}
    return p;
  }

  // Handy during the port: window.__lg.ping() / generateThumbnail(path) from the
  // devtools console. assetUrl() is also used by ensureMediaUrl under Tauri.
  window.__lg = window.__lg || {};
  window.__lg.ping = function () {
    return invoke("ping");
  };
  window.__lg.generateThumbnail = function (path, maxEdge) {
    return invoke("generate_thumbnail", { path: String(path), maxEdge: maxEdge || 512 });
  };
  window.__lg.assetUrl = assetUrl;

  // Request a disk-cached downscaled thumbnail for a media file; resolves to an
  // asset URL the WebView can load (or "" on failure). Thumbs are written under
  // the open library's .local-gallery/thumbs so they're inside the asset scope.
  var thumbInflight = {}; // key -> in-flight promise (dedupe concurrent requests)
  window.__lg.requestThumb = function (path, edge, frameTime) {
    var ft = typeof frameTime === "number" && isFinite(frameTime) ? frameTime : null;
    var key = String(path) + "::" + (edge || 512) + "::" + (ft == null ? "d" : Math.round(ft * 1000));
    if (thumbInflight[key]) return thumbInflight[key];
    var meta = String((window.__lg && window.__lg.metaPath) || "").replace(/\/+$/, "");
    var root = String((window.__lg && window.__lg.rootPath) || "").replace(/\/+$/, "");
    var outDir = meta ? meta + "/thumbs" : (root ? root + "/.local-gallery/thumbs" : "");
    var p = invoke("generate_thumbnail", {
      path: String(path),
      maxEdge: edge || 512,
      outDir: outDir || null,
      frameTime: ft,
    })
      .then(function (thumbPath) {
        return thumbPath ? assetUrl(thumbPath) : "";
      })
      .catch(function () {
        return "";
      });
    thumbInflight[key] = p;
    var clear = function () { delete thumbInflight[key]; };
    p.then(clear, clear);
    return p;
  };

  // Boot-time connectivity check: confirm the Rust backend is reachable.
  invoke("ping")
    .then(function (v) {
      console.info("[tauri-bridge] electronAPI shim installed (Tauri); backend:", v);
    })
    .catch(function (e) {
      console.warn("[tauri-bridge] shim installed but backend ping failed:", e);
    });
})();
