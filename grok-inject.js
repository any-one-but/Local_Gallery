// Injected as an initialization_script into the Grok webview window (see
// src-tauri/src/grok.rs). Runs before grok.com's own scripts on every load.
//
// Two jobs: give the window a close affordance, and restyle the page to match
// Local Gallery's design language.
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
  var STYLE_ID = "lg-grok-theme";
  var HINT_ID = "lg-grok-hint";

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
  // window has focus whenever it is up, so the main window never sees the key
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
      // Esc always works; it is the only affordance an undecorated window has.
      var isEscape = e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!isEscape && !matchesCloseKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      requestClose();
    },
    true,
  );

  // Cmd/Ctrl+Shift+G toggles the theme off and back on. Every rule below is an
  // override of a live site we do not control, so a Grok redeploy can always
  // make one of them land somewhere unintended; this is the way out without
  // waiting on a rebuild. Never matches the close key, which has no Shift.
  window.addEventListener(
    "keydown",
    function (e) {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (baseKeyForEvent(e).toLowerCase() !== "g") return;
      e.preventDefault();
      e.stopPropagation();
      var style = document.getElementById(STYLE_ID);
      if (style) style.disabled = !style.disabled;
    },
    true,
  );

  // A palette swap, and deliberately nothing more.
  //
  // An earlier version also restyled type and hid the sidebar, the timeline
  // scrubber and the nav cluster. That was the wrong trade: every `display:none`
  // is a bet that a selector still matches what we think it matches, and losing
  // that bet leaves the page unnavigable — a much worse failure than Grok simply
  // looking like Grok. Colour rules cannot do that. The worst a wrong colour can
  // do is look bad, and Cmd/Ctrl+Shift+G turns the sheet off anyway.
  //
  // So: no `display:none`, no layout, no font-family. Grok is Next.js +
  // Tailwind and serves its CSS from cdn.grok.com, i.e. cross-origin, so its
  // tokens can be overridden but never read — hence literal values here.
  //
  // Everything below targets element names and our own id only. Nothing depends
  // on a Grok class name, so a redeploy cannot silently break it.
  var CSS = [
    ":root {",
    "  --lg-font: ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', system-ui, -apple-system, 'Segoe UI', sans-serif;",
    "  --lg-bg: #15171c;",
    "  --lg-surface: #1d2027;",
    "  --lg-raised: #2a2e37;",
    "  --lg-ink: #e7eaf0;",
    "  --lg-ink-dim: #9aa1ad;",
    "}",

    // Grok paints its own background on several nested wrappers, so this tints
    // the page rather than fully recolouring it. That is the intended ceiling:
    // chasing every surface means chasing their class names again.
    "html, body {",
    "  background-color: var(--lg-bg) !important;",
    "  color: var(--lg-ink) !important;",
    "}",

    "::selection {",
    "  background: rgba(77, 144, 255, 0.35) !important;",
    "  color: var(--lg-ink) !important;",
    "}",
    "a, a:visited { color: #7db3ff !important; }",

    // Scrollbars, to match the app's chrome-free look.
    "* {",
    "  scrollbar-width: thin !important;",
    "  scrollbar-color: var(--lg-raised) transparent !important;",
    "}",
    "*::-webkit-scrollbar { width: 10px !important; height: 10px !important; }",
    "*::-webkit-scrollbar-track { background: transparent !important; }",
    "*::-webkit-scrollbar-thumb {",
    "  background: var(--lg-raised) !important;",
    "  border-radius: 999px !important;",
    "}",

    // The window has no decorations, so nothing on screen says how to leave.
    // Our own element, so styling it is not an override of anything.
    "#" + HINT_ID + " {",
    "  position: fixed !important;",
    "  right: 14px !important;",
    "  bottom: 14px !important;",
    "  z-index: 2147483647 !important;",
    "  padding: 6px 12px !important;",
    "  border-radius: 999px !important;",
    "  background: var(--lg-surface) !important;",
    "  color: var(--lg-ink-dim) !important;",
    "  font-family: var(--lg-font) !important;",
    "  font-size: 11px !important;",
    "  pointer-events: none !important;",
    "  opacity: 0.75 !important;",
    "}",
  ].join("\n");

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var host = document.head || document.documentElement;
    if (!host) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    host.appendChild(style);
  }

  function ensureHint() {
    if (!document.body) return;
    if (document.getElementById(HINT_ID)) return;
    var hint = document.createElement("div");
    hint.id = HINT_ID;
    hint.textContent = "Esc to close";
    document.body.appendChild(hint);
  }

  function ensureAll() {
    ensureStyle();
    ensureHint();
  }

  // Grok is a React app: route changes can swap <head> and <body> wholesale, and
  // both callbacks below no-op once the nodes are present, so re-appending never
  // retriggers the observer into a loop.
  var headObserver = null;
  function watchHead() {
    if (!document.head || headObserver) return;
    headObserver = new MutationObserver(ensureAll);
    headObserver.observe(document.head, { childList: true });
  }

  new MutationObserver(function () {
    watchHead();
    ensureAll();
  }).observe(document.documentElement, { childList: true });

  ensureAll();
  watchHead();
  document.addEventListener("DOMContentLoaded", function () {
    watchHead();
    ensureAll();
  });
})();
