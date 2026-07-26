// Injected as an initialization_script into the Grok webview (see
// src-tauri/src/grok.rs). Runs before grok.com's own scripts on every load.
//
// Gives the embedded Grok webview a local close shortcut.
//
// The close path is a cancelled navigation, not a Tauri invoke, and that is
// deliberate. Opening the IPC bridge to grok.com would require a capability
// with `remote.urls`, and app commands are callable by any webview that has the
// bridge — so a script on grok.com (or content the model renders into the page)
// could reach fs::remove_path. A sentinel URL costs one navigation handler and
// keeps the bridge shut.
(function () {
  "use strict";

  var CLOSE_URL = "https://local-gallery.invalid/close";
  function requestClose() {
    try {
      window.location.href = CLOSE_URL;
    } catch (e) {
      /* navigation is cancelled by the Rust side; errors here are noise */
    }
  }

  // Mirrors normalizeKeyValue()'s output format from index.html: modifiers in
  // Cmd/Ctrl/Alt/Shift order joined by "+", base key last (e.g. "Cmd+g").
  // Rust bakes the app's current binding into window.__lgGrokCloseKey — this
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
    var spec = parseCloseKey(window.__lgGrokCloseKey);
    if (!spec) return false;
    if (!!e.metaKey !== spec.cmd) return false;
    if (!!e.ctrlKey !== spec.ctrl) return false;
    if (!!e.altKey !== spec.alt) return false;
    if (!!e.shiftKey !== spec.shift) return false;
    return baseKeyForEvent(e).toLowerCase() === spec.base.toLowerCase();
  }

  window.addEventListener(
    "keydown",
    function (e) {
      // Esc always works, even if the user changes the toggle binding.
      var isEscape = e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!isEscape && !matchesCloseKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      requestClose();
    },
    true,
  );
})();
