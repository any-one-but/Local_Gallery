/* Boot
   Everything that sets the app running. It loads last, so nothing it starts --
   the library auto-open, the first render, observers -- can run before every
   other file exists. */

(function setupPreviewMediaResizeObserver() {
  if (typeof ResizeObserver !== "function") return;
  const targets = [previewContentEl, previewBodyEl].filter(Boolean);
  if (!targets.length) return;
  const observer = new ResizeObserver(() => {
    refreshActivePreviewMediaLayout();
    // The preview body resizes on sidebar drag/toggle without firing a window
    // "resize" event, so recompute the grid column count here too — otherwise
    // the inline repeat(N, minmax(0,1fr)) tracks stay stale and the cards just
    // shrink instead of the wrap/row length changing as the pane narrows.
    refreshPreviewGridTracks();
    refreshFitInsidePreviewGrids();
  });
  targets.forEach((target) => observer.observe(target));
})();

// On load (after shims and UI wiring), open the app's managed library.
// The boot splash stays up until this settles so a multi-second silent open
// still has feedback (see dismissBootSplash).
(function tryAutoOpenManagedLibrary() {
  // Use 0 timeout so DOM elements are ready but no extra settle delay.
  setTimeout(() => {
    const run = async () => {
      try {
        // Before the gate and before the library: this is what lets a page that
        // was killed or reloaded come back without re-asking for the passcode.
        try {
          await initSessionRecovery();
        } catch {}
        if (typeof WS !== "undefined" && (!WS || !WS.root)) {
          await openFixedAppMediaFolder();
        }
      } catch {
        // The openers already log; still dismiss the splash.
      } finally {
        dismissBootSplash();
      }
    };
    run();
  }, 0);
})();

// Watch for Tags changed by an AI tool outside the app (features/outside-edits.js).
// Its first look is one poll after this, and it waits for a loaded library.
startOutsideEditsWatcher();

/* =========================================================
       Initial UI state
       ========================================================= */

if (directoriesSearchClearBtn) directoriesSearchClearBtn.disabled = true;
initializeSettingsMetadataSync();
applyOptionsEverywhere(false);
rebuildKeybindIndex();
renderDirectoriesPane();
renderPreviewPane(true);
syncButtons();
ensureThumbnailServiceHeartbeat();

(function installDebugMode() {
  for (const level of ["error", "warn"]) {
    const original = console[level];
    if (typeof original !== "function") continue;
    console[level] = function (...args) {
      debugModeLog(level, args.map((a) => debugModeShort(a, 160)).join(" "));
      return original.apply(this, args);
    };
  }
  window.addEventListener("error", (event) => {
    // A failed <img>/<video> load also arrives here (capture); those are logged
    // by the thumbnail recovery with more context.
    if (event?.target && event.target !== window) return;
    debugModeLog("error", event?.message || "error", event?.error?.stack || "");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const r = event?.reason;
    debugModeLog("error", `unhandled rejection: ${r?.message || r}`, r?.stack || "");
  });
  const originalStatus = showStatusMessage;
  showStatusMessage = function (text, ...rest) {
    debugModeLog("status", text);
    return originalStatus.call(this, text, ...rest);
  };
  ["renderPreviewPane", "renderDirectoriesPane", "rebuildDirectoriesEntries"].forEach(
    debugModeWrapRender,
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (!debugModeKeyIsToggle(e) || e.metaKey || e.ctrlKey) {
        const key = keybindValueFromEvent(e);
        if (key) {
          const action = debugModeSafe(() => keybindActionFor(key), "");
          DEBUG_MODE.lastKey = `${key} -> ${action || "(no action)"}`;
          if (DEBUG_MODE.on) debugModeLog("key", DEBUG_MODE.lastKey);
        }
        return;
      }
      if (isTextInputTarget(e.target)) return;
      if (debugModeSafe(() => lockScreenIsOpen(), false) === true) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.altKey) {
        if (!DEBUG_MODE.on) debugModeSetEnabled(true);
        debugModeCopyReport();
        return;
      }
      debugModeSetEnabled(!DEBUG_MODE.on);
    },
    true,
  );

  window.__lgDebug = {
    get on() {
      return DEBUG_MODE.on;
    },
    toggle: (on = !DEBUG_MODE.on) => debugModeSetEnabled(on, { silent: true }),
    state: debugModeState,
    report: debugModeReport,
    log: DEBUG_MODE_LOG,
  };

  let remembered = false;
  try {
    remembered = localStorage.getItem(DEBUG_MODE_STORAGE_KEY) === "1";
  } catch {}
  if (remembered) debugModeSetEnabled(true, { silent: true });
  try {
    const getVersion = window.__TAURI__?.app?.getVersion;
    if (typeof getVersion === "function")
      getVersion().then((v) => (DEBUG_MODE.version = String(v || ""))).catch(() => {});
  } catch {}
})();

function dismissBootSplash() {
  const el = document.getElementById("bootSplash");
  if (!el || el.classList.contains("bootSplashDone")) return;
  el.classList.add("bootSplashDone");
  el.setAttribute("aria-busy", "false");
  window.setTimeout(() => {
    try {
      document.body.classList.add("bootSplashGone");
    } catch {}
    try {
      el.remove();
    } catch {}
  }, 320);
}

// UI is fully built — reveal it (it was hidden during boot to avoid showing the
// half-initialized skeleton). One rAF lets init's own layout callbacks settle
// first, so the very first visible frame is the finished UI. The boot splash
// still covers the screen until the managed library auto-open finishes (or the
// safety timeout below fires if that path never runs).

requestAnimationFrame(() => {
  const appEl = document.getElementById("app");
  if (appEl) appEl.classList.add("appBooted");
  // Hard cap: never leave the splash up if auto-open hung or was skipped.
  window.setTimeout(dismissBootSplash, 12000);
});

  


