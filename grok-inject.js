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

  // Written against the real DOM (grok.com is Next.js + Tailwind + shadcn/ui).
  // Its own stylesheets are served from cdn.grok.com, i.e. cross-origin, so they
  // can be overridden but never read — hence literal values here rather than
  // anything derived from the page.
  //
  // Selector strategy: prefer the semantic hooks Grok already exposes — the ids
  // #grok-app-root / #grok-content-area, the classes .message-bubble /
  // .response-content-markdown / .action-buttons, and shadcn's data-state
  // attributes. Hashed build classes are never targeted. Where a Tailwind
  // arbitrary-variant class is the only handle, [class*=] matches it as a plain
  // substring, which sidesteps escaping the brackets and slashes.
  //
  // Every hiding rule fails *safe*: if Grok renames something the rule stops
  // matching and the element simply comes back. Nothing here can break the page
  // by matching the wrong thing.
  var CSS = [
    ":root {",
    "  --lg-font: ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', system-ui, -apple-system, 'Segoe UI', sans-serif;",
    "  --lg-mono: ui-monospace, 'IBM Plex Mono', SFMono-Regular, Menlo, monospace;",
    "  --lg-bg: #15171c;",
    "  --lg-surface: #1d2027;",
    "  --lg-raised: #2a2e37;",
    "  --lg-ink: #e7eaf0;",
    "  --lg-ink-dim: #9aa1ad;",
    "  --lg-accent: #4d90ff;",
    "}",

    // Surfaces. Grok paints its own background on several nested wrappers, so
    // the html/body override alone leaves patches of the original colour.
    "html, body {",
    "  background-color: var(--lg-bg) !important;",
    "  color: var(--lg-ink) !important;",
    "}",

    // Type. The two rules are a pair and neither works alone: excluding a
    // subtree from the first only stops it being *set*, it still inherits the
    // rounded face from an ancestor. So anything that must stay monospace has
    // to be excluded above AND set explicitly below.
    //
    // Monaco is named in full because "monaco" does not contain the substring
    // "mono" — [class*='mono'] misses it. Grok loads it (vs/editor/editor.main
    // .css) for code artifacts, and it positions its cursor by monospace
    // character width, so a proportional face there breaks the editor outright.
    "body *:not(i, code, pre, kbd, samp, [class*='mono'], .monaco-editor, .monaco-editor *) {",
    "  font-family: var(--lg-font) !important;",
    "}",
    "code, pre, kbd, samp, [class*='mono'], .monaco-editor, .monaco-editor * {",
    "  font-family: var(--lg-mono) !important;",
    "}",

    // Prose. Grok's own metrics are already generous (16px/28px), so this only
    // takes the glare off: its near-white #fcfcfc on a dark surface is what
    // reads as harsh over a long answer, not the size or the leading.
    ".response-content-markdown, .response-content-markdown p, .response-content-markdown li, .response-content-markdown h1, .response-content-markdown h2, .response-content-markdown h3 {",
    "  color: var(--lg-ink) !important;",
    // Undoes the tracking-[-0.1px] set on <body>.
    "  letter-spacing: normal !important;",
    "}",
    ".response-content-markdown p, .response-content-markdown li {",
    "  line-height: 1.8 !important;",
    "}",

    // Fewer non-chat elements. Each of these is a distinct piece of furniture
    // around the conversation, hidden narrowly rather than by killing a wrapper.

    // The sidebar rail, but only while collapsed: shadcn flips data-state to
    // "expanded" on the same element, so the trigger (which lives outside the
    // sidebar, in the content area) still opens it and the chat list stays
    // reachable. Hiding it outright would strand you in one conversation.
    "div[data-side='left'][data-state='collapsed'][data-collapsible='icon'] {",
    "  display: none !important;",
    "}",

    // The floating timeline scrubber pinned to the right edge of the chat.
    "div[class*='@[860px]/chat:flex'] {",
    "  display: none !important;",
    "}",

    // The button cluster in the top-right of the nav bar.
    "div[class*='@container/nav'] div[class*='flex-row'][class*='shrink-0'] {",
    "  display: none !important;",
    "}",

    // Per-message toolbars (copy, retry, thumbs). Kept, but revealed on hover
    // instead of sitting under every message — Grok pins them permanently on
    // the last response. The row keeps its height so nothing jumps on hover.
    "div[id^='response-'] .action-buttons {",
    "  opacity: 0 !important;",
    "  transition: opacity 0.15s ease !important;",
    "}",
    "div[id^='response-']:hover .action-buttons,",
    "div[id^='response-']:focus-within .action-buttons {",
    "  opacity: 1 !important;",
    "}",

    // Accent + selection.
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
