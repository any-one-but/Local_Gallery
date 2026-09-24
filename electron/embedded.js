// Grok, Claude and Variations: pages shown over the gallery, filling the
// window, one at a time. Mirrors src-tauri/src/embedded_web.rs, grok.rs,
// claude.rs and variations.rs.
//
// What is simpler here than in the Tauri app: the main process sees every key
// before any page does (`before-input-event`), so closing, switching and
// zooming are handled natively instead of by a script injected into the site
// that signals out through cancelled navigations. That also means a site that
// has wedged or crashed can still be closed with its key.
//
// Grok and Claude each run in a session of their own ("persist:grok"), which
// keeps their sign-ins and keeps them away from the library protocol, which is
// registered on the default session only. Variations is our own page and runs
// in the default session with the same bridge as the gallery.

"use strict";

const { app, clipboard, shell, WebContentsView } = require("electron");
const fs = require("fs");
const path = require("path");

const media = require("./media");

const LABELS = ["grok", "claude", "variations"];

const SITES = {
  grok: {
    home: "https://grok.com/",
    restorable: (u) => u.protocol === "https:" && (hostIs(u, "grok.com") || hostIs(u, "x.com")),
    clipboardLink: (u) => u.protocol === "https:" && hostIs(u, "grok.com"),
  },
  claude: {
    home: "https://claude.ai/",
    restorable: (u) => u.protocol === "https:" && (hostIs(u, "claude.ai") || hostIs(u, "anthropic.com")),
    clipboardLink: (u) => u.protocol === "https:" && hostIs(u, "claude.ai"),
  },
};

// Sign-in popups (window.open to these) get a real window of their own;
// anything else a site opens goes to the default browser.
const SIGN_IN_ENTRY_HOSTS = new Set(["accounts.google.com", "appleid.apple.com"]);

function hostIs(u, domain) {
  const host = u.hostname.replace(/^www\./, "");
  return host === domain || host.endsWith(`.${domain}`);
}

function parseUrl(raw) {
  try {
    return new URL(String(raw || "").trim());
  } catch {
    return null;
  }
}

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;

let mainWindow = null;
const views = {}; // label -> WebContentsView
const visible = {}; // label -> bool
// The page's current key for each of the three toggles, sent with every
// toggle, so whichever window is in front can hand over to either other.
let siteKeys = { grok: "", claude: "", variations: "" };

function configFile(label, suffix) {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${label}-${suffix}.txt`);
}

function readConfig(label, suffix) {
  try {
    return fs.readFileSync(configFile(label, suffix), "utf8").trim();
  } catch {
    return "";
  }
}

function writeConfig(label, suffix, value) {
  try {
    fs.writeFileSync(configFile(label, suffix), String(value));
  } catch {}
}

// --- keys --------------------------------------------------------------------

// The page writes keys as "Cmd+Shift+w"; this reads them the way
// embedded-inject.js did.
function parseKeySpec(spec) {
  if (!spec || typeof spec !== "string") return null;
  const out = { cmd: false, ctrl: false, alt: false, shift: false, base: "" };
  for (const part of spec.split("+").filter(Boolean)) {
    const lower = part.toLowerCase();
    if (lower === "cmd" || lower === "meta") out.cmd = true;
    else if (lower === "ctrl" || lower === "control") out.ctrl = true;
    else if (lower === "alt" || lower === "option") out.alt = true;
    else if (lower === "shift") out.shift = true;
    else out.base = lower;
  }
  return out.base ? out : null;
}

function baseKeyForInput(input) {
  const code = input.code || "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === "Space") return "space";
  if (code === "Escape") return "escape";
  if (code === "Equal") return "=";
  if (code === "Minus") return "-";
  const key = input.key || "";
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

function inputMatches(input, spec) {
  if (!spec) return false;
  if (!!input.meta !== spec.cmd) return false;
  if (!!input.control !== spec.ctrl) return false;
  if (!!input.alt !== spec.alt) return false;
  if (!!input.shift !== spec.shift) return false;
  return baseKeyForInput(input) === spec.base;
}

function isEscapeHatch(input) {
  // Shift+Cmd+W closes whichever of the three is up, whatever state it is in.
  return input.meta && input.shift && !input.alt && !input.control && baseKeyForInput(input) === "w";
}

// Returns true when the key was ours.
function handleEmbeddedKey(label, input) {
  if (input.type !== "keyDown") return false;
  if (isEscapeHatch(input)) {
    hide(label, true);
    return true;
  }
  if (label === "variations") return false; // the page handles its own keys
  const plainEscape = input.key === "Escape" && !input.meta && !input.control && !input.alt;
  if (plainEscape || inputMatches(input, parseKeySpec(siteKeys[label]))) {
    hide(label, true);
    return true;
  }
  for (const other of LABELS) {
    if (other !== label && inputMatches(input, parseKeySpec(siteKeys[other]))) {
      show(other);
      return true;
    }
  }
  if (input.meta && !input.control && !input.alt) {
    const code = input.code || "";
    const wc = views[label].webContents;
    const current = wc.getZoomFactor();
    let next = null;
    if (code === "Equal" || code === "NumpadAdd") next = ZOOM_STEPS.find((s) => s > current + 0.001) || ZOOM_MAX;
    else if (code === "Minus" || code === "NumpadSubtract")
      next = [...ZOOM_STEPS].reverse().find((s) => s < current - 0.001) || ZOOM_MIN;
    else if (code === "Digit0" || code === "Numpad0") next = 1.0;
    if (next !== null) {
      wc.setZoomFactor(next);
      writeConfig(label, "zoom", next);
      return true;
    }
  }
  return false;
}

// --- showing and hiding -------------------------------------------------------

function fitToWindow(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  view.setBounds({ x: 0, y: 0, width, height });
}

function syncBounds() {
  for (const label of LABELS) {
    if (visible[label] && views[label]) fitToWindow(views[label]);
  }
}

function saveUrl(label) {
  const site = SITES[label];
  const view = views[label];
  if (!site || !view) return;
  const u = parseUrl(view.webContents.getURL());
  if (u && site.restorable(u)) writeConfig(label, "last-url", u.href);
}

function clipboardLink(label) {
  const site = SITES[label];
  if (!site) return null;
  const u = parseUrl(clipboard.readText());
  return u && site.clipboardLink(u) ? u.href : null;
}

function visibleLabel() {
  return LABELS.find((l) => visible[l]) || null;
}

function hide(label, refocusMain) {
  const view = views[label];
  if (!view || !visible[label]) return;
  saveUrl(label);
  view.setVisible(false);
  visible[label] = false;
  if (refocusMain && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.focus();
  }
}

function hideAll() {
  for (const label of LABELS) hide(label, false);
}

function variationsExtras() {
  const others = {};
  for (const l of LABELS) if (l !== "variations" && siteKeys[l]) others[l] = siteKeys[l];
  return (
    `window.__lgVariationsEmbedded = true;` +
    `window.__lgVariationsCloseKey = ${JSON.stringify(siteKeys.variations || "")};` +
    `window.__lgVariationsSwitchKeys = ${JSON.stringify(others)};`
  );
}

function chromeLikeUserAgent(ua) {
  // Sites (Google sign-in above all) turn away anything that says Electron.
  return String(ua).replace(/\s(Electron|local-gallery|Local Gallery)\/\S+/gi, "");
}

function buildView(label) {
  const remote = label !== "variations";
  const view = new WebContentsView({
    webPreferences: remote
      ? {
          partition: `persist:${label}`,
          contextIsolation: true,
          sandbox: true,
        }
      : {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          sandbox: true,
        },
  });
  const wc = view.webContents;
  if (remote) {
    wc.setUserAgent(chromeLikeUserAgent(wc.getUserAgent()));
    wc.setVisualZoomLevelLimits(1, 3).catch(() => {});
    wc.setWindowOpenHandler(({ url }) => {
      const u = parseUrl(url);
      if (u && u.protocol === "https:" && SIGN_IN_ENTRY_HOSTS.has(u.hostname)) {
        return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 680 } };
      }
      if (u && (u.protocol === "https:" || u.protocol === "http:")) shell.openExternal(u.href);
      return { action: "deny" };
    });
    const zoom = Number(readConfig(label, "zoom"));
    if (zoom >= ZOOM_MIN && zoom <= ZOOM_MAX) {
      wc.once("did-finish-load", () => wc.setZoomFactor(zoom));
    }
  } else {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
  }
  wc.on("before-input-event", (event, input) => {
    if (handleEmbeddedKey(label, input)) event.preventDefault();
  });
  // A page whose renderer died comes back on its own.
  wc.on("render-process-gone", () => {
    setTimeout(() => {
      if (!wc.isDestroyed()) wc.reload();
    }, 250);
  });
  view.setBackgroundColor("#000000");
  mainWindow.contentView.addChildView(view);
  views[label] = view;
  return view;
}

function show(label, overrideUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) throw "main window missing";
  for (const other of LABELS) if (other !== label) hide(other, false);
  let view = views[label];
  const fresh = !view;
  if (fresh) view = buildView(label);
  const wc = view.webContents;
  if (label === "variations") {
    if (fresh) wc.loadURL(`${media.APP_ORIGIN}/variations.html`);
    else wc.executeJavaScript(variationsExtras()).catch(() => {});
  } else {
    const site = SITES[label];
    const link = overrideUrl || clipboardLink(label);
    if (fresh) {
      const saved = parseUrl(readConfig(label, "last-url"));
      wc.loadURL(link || (saved && site.restorable(saved) ? saved.href : site.home));
    } else if (link && wc.getURL() !== link) {
      saveUrl(label);
      wc.loadURL(link);
    }
  }
  fitToWindow(view);
  view.setVisible(true);
  visible[label] = true;
  wc.focus();
  return true;
}

function toggle(label, args) {
  if (args && args.siteKeys && typeof args.siteKeys === "object") {
    siteKeys = { ...siteKeys, ...args.siteKeys };
  }
  if (args && args.closeKey) siteKeys[label] = String(args.closeKey);
  if (visible[label] && views[label]) {
    hide(label, true);
    return false;
  }
  return show(label);
}

function init(win) {
  mainWindow = win;
  win.on("resize", syncBounds);
  win.on("enter-full-screen", syncBounds);
  win.on("leave-full-screen", syncBounds);
  // Variations is served by lgapp and needs its embedded flags in the page
  // before its own script runs.
  media.setPageExtras((file) => (file === "variations.html" ? variationsExtras() : ""));
  app.on("before-quit", () => {
    for (const label of Object.keys(SITES)) saveUrl(label);
  });
}

const commands = {
  toggle_grok_window: (args) => toggle("grok", args),
  toggle_claude_window: (args) => toggle("claude", args),
  toggle_variations_window: (args) => toggle("variations", args),
  close_variations_window: () => hide("variations", true),
  embedded_heartbeat: () => {},
};

module.exports = { init, commands, visibleLabel, hide, hideAll };
