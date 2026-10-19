/* Host detection
   Recognises the Mac app around the page, and reports renderer errors that
   would otherwise vanish. */

/* =========================================================
       Host detection
       ========================================================= */
// This page runs inside the Mac app only. The app puts tauri-bridge.js and
// tauri-fs-shim.js in front of it (they keep their Tauri-era names), so they
// have already run by the time this one starts. Opened as a plain web page it
// does not work: there is no browser version any more.
const LG_HOST_IS_APP = !!(
  (window.electronAPI && window.electronAPI.isTauri) ||
  window.__TAURI__ ||
  window.__TAURI_INTERNALS__
);
const IS_SETTINGS_WINDOW = !!window.__LG_SETTINGS_WINDOW__;
if (IS_SETTINGS_WINDOW) {
  document.documentElement.classList.add("settings-window");
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        String(event.key || "").toLowerCase() !== "w" ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const currentWindow = window.__TAURI__?.window?.getCurrentWindow?.();
      if (currentWindow && typeof currentWindow.close === "function") {
        currentWindow.close().catch(() => {});
      }
    },
    true,
  );
}

window.addEventListener("error", (event) => {
  try {
    const err = event?.error;
    const message =
      err && err.stack
        ? err.stack
        : String(event?.message || "Unknown renderer error");
    console.error("Global renderer error:", message);
  } catch {}
});
window.addEventListener("unhandledrejection", (event) => {
  try {
    const reason = event?.reason;
    const message =
      reason && reason.stack
        ? reason.stack
        : String(reason || "Unknown promise rejection");
    console.error("Unhandled promise rejection:", message);
  } catch {}
});
