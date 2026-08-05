// Injected as an initialization_script into every embedded site webview (see
// src-tauri/src/embedded_web.rs — Grok and Claude both use this file). Runs
// before the host page's own scripts on every load.
//
// Gives the embedded webview a local close shortcut.
//
// The close path is a cancelled navigation, not a Tauri invoke, and that is
// deliberate. Opening the IPC bridge to a third-party host would require a
// capability with `remote.urls`, and app commands are callable by any webview
// that has the bridge — so a script on that host (or content the model renders
// into the page) could reach fs::remove_path. A sentinel URL costs one
// navigation handler and keeps the bridge shut.
//
// The same channel carries zoom: Cmd +/-/0 and a trackpad pinch are reported
// to Rust, which owns the zoom level and applies it as real page zoom
// (WKWebView's pageZoom, which reflows) rather than a CSS transform.
//
// Rust bakes three globals this reads into the page: __lgEmbedCloseKey (the
// app's current binding for this window's toggle), __lgEmbedCloseUrl (this
// window's own close sentinel) and __lgEmbedZoomUrl (the zoom sentinel).
(function () {
  "use strict";

  function sendSentinel(url) {
    if (typeof url !== "string" || !url) return;
    try {
      window.location.href = url;
    } catch (e) {
      /* navigation is cancelled by the Rust side; errors here are noise */
    }
  }

  function requestClose() {
    sendSentinel(window.__lgEmbedCloseUrl);
  }

  // Only ever reports what the user did — a step, or a pinch ratio. Rust holds
  // the current zoom, so nothing here goes stale when the page reloads.
  function requestZoom(query) {
    var url = window.__lgEmbedZoomUrl;
    if (typeof url !== "string" || !url) return;
    sendSentinel(url + "?" + query);
  }

  // Mirrors normalizeKeyValue()'s output format from index.html: modifiers in
  // Cmd/Ctrl/Alt/Shift order joined by "+", base key last (e.g. "Cmd+g").
  // Rust bakes the app's current binding into window.__lgEmbedCloseKey — this
  // webview has focus whenever it is up, so the main webview never sees the key
  // and cannot toggle it off. The page has to close itself.
  function parseCloseKey(spec) {
    if (!spec || typeof spec !== "string") return null;
    var parts = spec.split("+").filter(Boolean);
    if (!parts.length) return null;
    var out = { cmd: false, ctrl: false, alt: false, shift: false, base: "" };
    parts.forEach(function (part) {
      var lower = part.toLowerCase();
      if (lower === "cmd" || lower === "meta") out.cmd = true;
      else if (lower === "ctrl" || lower === "control") out.ctrl = true;
      else if (lower === "alt" || lower === "option") out.alt = true;
      else if (lower === "shift") out.shift = true;
      else out.base = part.toLowerCase();
    });
    return out.base ? out : null;
  }

  // Same code->base mapping the app's own handler uses, so a binding set on a
  // non-US layout still matches: physical position, not the produced character.
  function baseKeyForEvent(e) {
    var code = e.code || "";
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (code === "Space") return "Space";
    if (code === "Escape") return "Escape";
    if (code === "Equal") return "=";
    if (code === "Minus") return "-";
    var key = e.key || "";
    return key.length === 1 ? key.toLowerCase() : key;
  }

  function matchesCloseKey(e) {
    var spec = parseCloseKey(window.__lgEmbedCloseKey);
    if (!spec) return false;
    if (!!e.metaKey !== spec.cmd) return false;
    if (!!e.ctrlKey !== spec.ctrl) return false;
    if (!!e.altKey !== spec.alt) return false;
    if (!!e.shiftKey !== spec.shift) return false;
    return baseKeyForEvent(e).toLowerCase() === spec.base.toLowerCase();
  }

  // Cmd +/-/0. The page never sees these: the host swallows every key while
  // this webview has focus, so if we do not act on them nothing does.
  // Matched on e.code (physical position) with a fallback to e.key, so a
  // layout where + and = are not the same key still works.
  function zoomStepForEvent(e) {
    if (!e.metaKey || e.ctrlKey || e.altKey) return "";
    var code = e.code || "";
    if (code === "Equal" || code === "NumpadAdd" || e.key === "+" || e.key === "=")
      return "d=up";
    if (code === "Minus" || code === "NumpadSubtract" || e.key === "-" || e.key === "_")
      return "d=down";
    if (code === "Digit0" || code === "Numpad0" || e.key === "0") return "d=reset";
    return "";
  }

  window.addEventListener(
    "keydown",
    function (e) {
      // Esc always works, even if the user changes the toggle binding.
      var isEscape = e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (isEscape || matchesCloseKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
        return;
      }
      // Checked after the close key so a binding on Cmd+0 and friends still
      // wins — the user chose it.
      var step = zoomStepForEvent(e);
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      requestZoom(step);
    },
    true,
  );

  // A trackpad pinch. WebKit reports it to the page as gesture events (with an
  // absolute scale for the whole gesture) because WKWebView's own magnification
  // is off, and reports a pinch on some other devices as ctrl+wheel.
  //
  // Both are sent as a *ratio since the last message*, so throttling cannot
  // lose or double-apply any part of the gesture: the ratios compose.
  var SEND_INTERVAL_MS = 90;
  var lastSentAt = 0;
  var gestureScale = 1;

  function sendRatio(ratio, force) {
    if (!isFinite(ratio) || ratio <= 0) return false;
    // Ignore the jitter a resting hand produces.
    if (Math.abs(Math.log(ratio)) < 0.01) return false;
    var now = Date.now();
    if (!force && now - lastSentAt < SEND_INTERVAL_MS) return false;
    lastSentAt = now;
    requestZoom("s=" + ratio.toFixed(4));
    return true;
  }

  window.addEventListener(
    "gesturestart",
    function (e) {
      e.preventDefault();
      gestureScale = e.scale || 1;
    },
    true,
  );

  window.addEventListener(
    "gesturechange",
    function (e) {
      e.preventDefault();
      var scale = e.scale || 1;
      if (sendRatio(scale / gestureScale, false)) gestureScale = scale;
    },
    true,
  );

  window.addEventListener(
    "gestureend",
    function (e) {
      e.preventDefault();
      // Flush whatever the throttle held back, so the zoom always ends where
      // the fingers did.
      var scale = e.scale || 1;
      if (sendRatio(scale / gestureScale, true)) gestureScale = scale;
      gestureScale = 1;
    },
    true,
  );

  window.addEventListener(
    "wheel",
    function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // deltaY is lines/pixels of intent; the exponential keeps the gesture
      // symmetric — pinching out then back in returns to where it started.
      sendRatio(Math.exp(-e.deltaY * 0.01), false);
    },
    { capture: true, passive: false },
  );
})();
