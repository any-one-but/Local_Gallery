/* Theme and UI colours
   Dark/light, UI tint and highlight, Prism, and the remembered look used
   before the library's settings are read. The scheme lists themselves are in
   ui-color-schemes.js. */

/* Two themes, one attribute. `retro90s-dark` is kept as the dark value because
   a pile of existing rules are keyed to it; light is `graphite-light`, a new
   value, so none of the retired azure-light (`retro90s`) rules can apply. */
const APP_THEME_CYCLE = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

function getAppThemeFromOptions(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return normalizeAppThemeValue(src && src.appTheme);
}

// True once the open library's own settings have been read
// (metaFinalizeLoadedState), false from resetWorkspace on. A library being
// built already has WS.root while its settings are still the defaults, and
// anything that repainted the colors in that window -- a resize, a render --
// used to paint the default theme, tint and highlight over the remembered ones
// until loading finished, and write them back as the remembered ones too.
// `var`: resetWorkspace can run before this line.
var LIBRARY_SETTINGS_LOADED = false;

/* The look -- theme, UI color tint, UI highlight color -- is the one group of
   settings that must be right *before* the library's settings are read: the
   boot splash, the passcode screen, the loading overlay and the root prompt
   are all drawn while WS.meta.options is still the defaults. EVERY surface
   follows the look, always. Where it comes from while the settings are not
   loaded, best first:

   1. LIBRARY_LOOK, in memory: the look of the library last open in this page
      (kept through resetWorkspace, so a refresh, a rebuild or Lock now never
      falls back to anything), or the look read straight from the library's
      own preferences file by the passcode gate (readLibraryLookFromDisk).
   2. The remembered copy: the Mac app's look.json, handed to the page as
      window.__LG_REMEMBERED_LOOK; else localStorage (lgAppTheme, lgUiColors).
   3. The defaults.

   Do not read the look from WS.meta.options while LIBRARY_SETTINGS_LOADED is
   false. That is the regression this replaces. */
var LIBRARY_LOOK = null; // `var`: read by applyColorSchemeFromOptions, which can run before this line.
var LIBRARY_LOOK_FROM_DISK = false;

function rememberedLook() {
  if (LIBRARY_LOOK) return LIBRARY_LOOK;
  const host = typeof window !== "undefined" ? window.__LG_REMEMBERED_LOOK : null;
  if (host && typeof host === "object")
    return { theme: host.theme, tint: host.tint, highlight: host.highlight };
  try {
    const ui = JSON.parse(localStorage.getItem("lgUiColors") || "null");
    return {
      theme: localStorage.getItem("lgAppTheme"),
      tint: ui ? ui.tint : "default",
      highlight: ui ? ui.highlight : "default",
    };
  } catch {
    return null;
  }
}

function applyColorSchemeFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  let theme = getAppThemeFromOptions();
  // With a library's settings loaded they are the truth, and are remembered
  // for the next launch. Before that (boot, the lock screen, Lock now, a
  // library still loading) the settings are only defaults, so the look
  // remembered from the library wins (rememberedLook).
  const libraryOpen =
    typeof WS !== "undefined" && !!(WS && WS.root) && LIBRARY_SETTINGS_LOADED;
  if (!libraryOpen) {
    const look = rememberedLook();
    if (look && (look.theme === "light" || look.theme === "dark")) theme = look.theme;
  }
  try {
    if (libraryOpen || LIBRARY_LOOK_FROM_DISK) localStorage.setItem("lgAppTheme", theme);
  } catch {}
  root.setAttribute(
    "data-theme",
    theme === "light" ? "graphite-light" : "retro90s-dark",
  );
  root.setAttribute("data-retro", "off");
  // So the OS paints form controls, scrollbars and the like to match.
  root.style.colorScheme = theme === "light" ? "light" : "dark";
  applyUiColorsFromOptions(theme, libraryOpen);
}

// What a tint / highlight pair actually paints: each Match takes the other
// side's scheme, and two Matches are Prism.
function resolveUiColorChoice(tint, highlight) {
  const tintMatches = tint === "match";
  const highlightMatches = highlight === "match";
  if (tintMatches && highlightMatches)
    return { tint: "prism", highlight: "prism", prism: true };
  return {
    tint: tintMatches ? highlight : tint,
    highlight: highlightMatches ? tint : highlight,
    prism: false,
  };
}

function uiColorHsl(h, s, l, a = null) {
  const sat = Math.max(0, Math.min(100, Math.round(s * 10) / 10));
  return a == null
    ? `hsl(${h}, ${sat}%, ${l}%)`
    : `hsla(${h}, ${sat}%, ${l}%, ${a})`;
}

function uiSchemeSide(id, theme) {
  const scheme = uiColorSchemes().find((s) => s.value === id);
  if (!scheme) return null;
  return theme === "light" ? scheme.light : scheme.dark;
}

// The custom properties a tint sets, for one theme.
function uiTintVars(id, theme) {
  if (id === "pure") return uiPureTintVars(theme);
  const t = uiSchemeSide(id, theme);
  if (!t) return {};
  const c = (hsl, a = null) => uiColorHsl(hsl[0], hsl[1], hsl[2], a);
  const vars = {
    "--color0-primary": c(t.ink),
    "--color0-secondary": c(t.ink2),
    "--color0-tertirary": c(t.ink3),
    "--color1-primary": c(t.bg),
    "--color1-primary-transparent": c(t.bg, 0.72),
    "--color1-secondary": c(t.surface),
    "--color1-secondary-transparent": c(t.surface, theme === "light" ? 0.66 : 0.62),
    "--color1-tertiary": c(t.line),
    "--tint-base": c(t.glass),
  };
  if (theme === "light") {
    vars["--on-media-fg"] = c(t.ink);
    vars["--preview-pane-thumb-title-bar-fg"] = c(t.ink);
  }
  return vars;
}

// Pure: the page, the surfaces and the glass all at full black (dark) or full
// white (light), with full-strength ink. Raised surfaces stay one small step
// off the page so a card or menu still has an edge.
function uiPureTintVars(theme) {
  if (theme === "light") {
    return {
      "--color0-primary": "hsl(0, 0%, 0%)",
      "--color0-secondary": "hsl(0, 0%, 32%)",
      "--color0-tertirary": "hsl(0, 0%, 52%)",
      "--color1-primary": "hsl(0, 0%, 100%)",
      "--color1-primary-transparent": "hsla(0, 0%, 100%, 0.72)",
      "--color1-secondary": "hsl(0, 0%, 100%)",
      "--color1-secondary-transparent": "hsla(0, 0%, 100%, 0.66)",
      "--color1-tertiary": "hsl(0, 0%, 88%)",
      "--tint-base": "hsl(0, 0%, 100%)",
      "--on-media-fg": "hsl(0, 0%, 0%)",
      "--preview-pane-thumb-title-bar-fg": "hsl(0, 0%, 0%)",
    };
  }
  return {
    "--color0-primary": "hsl(0, 0%, 100%)",
    "--color0-secondary": "hsl(0, 0%, 70%)",
    "--color0-tertirary": "hsl(0, 0%, 48%)",
    "--color1-primary": "hsl(0, 0%, 0%)",
    "--color1-primary-transparent": "hsla(0, 0%, 0%, 0.72)",
    "--color1-secondary": "hsl(0, 0%, 6%)",
    "--color1-secondary-transparent": "hsla(0, 0%, 6%, 0.62)",
    "--color1-tertiary": "hsl(0, 0%, 18%)",
    "--tint-base": "hsl(0, 0%, 0%)",
  };
}

// The custom properties a highlight sets, for one theme -- the selection
// border and everything else drawn in the accent (focus rings, the favourite
// colour, the calendar cursor, filled toggles, carets).
function uiHighlightVars(id, theme) {
  const c = uiColorHsl;
  const light = theme === "light";
  if (id === "pure") {
    // White on dark, black on light; text laid on it takes the opposite.
    const l = light ? 0 : 100;
    return {
      "--accent": c(0, 0, l),
      "--accent-strong": c(0, 0, light ? 22 : 82),
      "--accent-soft": c(0, 0, l, light ? 0.1 : 0.16),
      "--anchor-internal-color2-primary": c(0, 0, l),
      "--palette-accent-text": light ? "#ffffff" : "#000000",
      "--ui-selection-outline-soft": c(0, 0, l, 0.34),
      "--ui-selection-fill": c(0, 0, l, light ? 0.08 : 0.12),
      "--ui-selection-fill-strong": c(0, 0, l, light ? 0.14 : 0.2),
    };
  }
  const p = uiSchemeSide(id, theme);
  if (!p) return {};
  const [h, s, l] = p.accent;
  const accent = c(h, s, l);
  return {
    "--accent": accent,
    "--accent-strong": c(h, s, light ? l - 7 : l + 8),
    "--accent-soft": c(h, s, l, light ? 0.14 : 0.18),
    "--anchor-internal-color2-primary": accent,
    "--palette-accent-text": p.dark ? c(h, 40, 8) : "#ffffff",
    "--ui-selection-outline-soft": c(h, s, l, 0.34),
    "--ui-selection-fill": c(h, s, l, light ? 0.12 : 0.14),
    "--ui-selection-fill-strong": c(h, s, l, light ? 0.2 : 0.24),
  };
}

/* Prism, the scheme behind both Matches. Every colour is a hue offset from
   `--lg-prism`, an angle the stylesheet turns once every 48 seconds
   (`:root[data-ui-prism]`, registered with @property so it can animate), so
   the page, the surfaces, the glass and the ink drift round the wheel
   together, each a third of the way from the last, and the selection and
   accent run three times as fast against them -- the colour folding back
   through itself. The menus and the controls list carry a moving sheen on
   top. It stops while media is open, and for reduced motion. */
function uiPrismVars(theme) {
  const light = theme === "light";
  const hue = (offset, speed = 1) =>
    `calc(var(--lg-prism) * ${speed}deg + ${offset}deg)`;
  const c = (offset, s, l, a = null, speed = 1) =>
    `hsl(${hue(offset, speed)} ${s}% ${l}%${a == null ? "" : ` / ${a}`})`;
  const A = (s, l, a = null) => c(60, s, l, a, 3);
  if (light) {
    return {
      "--color0-primary": c(180, 50, 18),
      "--color0-secondary": c(150, 22, 40),
      "--color0-tertirary": c(90, 16, 56),
      "--color1-primary": c(0, 55, 95),
      "--color1-primary-transparent": c(0, 55, 95, 0.72),
      "--color1-secondary": c(120, 70, 98.5),
      "--color1-secondary-transparent": c(120, 70, 98.5, 0.66),
      "--color1-tertiary": c(200, 30, 84),
      "--tint-base": c(240, 60, 98),
      "--on-media-fg": c(180, 50, 18),
      "--preview-pane-thumb-title-bar-fg": c(180, 50, 18),
      "--accent": A(85, 46),
      "--accent-strong": A(85, 39),
      "--accent-soft": A(85, 46, 0.14),
      "--anchor-internal-color2-primary": A(85, 46),
      "--palette-accent-text": "#ffffff",
      "--ui-selection-outline-soft": A(85, 46, 0.34),
      "--ui-selection-fill": A(85, 46, 0.12),
      "--ui-selection-fill-strong": A(85, 46, 0.2),
    };
  }
  return {
    "--color0-primary": c(180, 60, 93),
    "--color0-secondary": c(150, 30, 72),
    "--color0-tertirary": c(90, 20, 52),
    "--color1-primary": c(0, 42, 6),
    "--color1-primary-transparent": c(0, 42, 6, 0.72),
    "--color1-secondary": c(120, 34, 11),
    "--color1-secondary-transparent": c(120, 34, 11, 0.62),
    "--color1-tertiary": c(200, 26, 22),
    "--tint-base": c(240, 42, 8),
    "--accent": A(95, 64),
    "--accent-strong": A(95, 72),
    "--accent-soft": A(95, 64, 0.18),
    "--anchor-internal-color2-primary": A(95, 64),
    "--palette-accent-text": "hsl(240, 40%, 8%)",
    "--ui-selection-outline-soft": A(95, 64, 0.34),
    "--ui-selection-fill": A(95, 64, 0.14),
    "--ui-selection-fill-strong": A(95, 64, 0.24),
  };
}

var UI_COLOR_PROPS_WRITTEN = [];
var UI_COLOR_PROP_NAMES = null;
// Every custom property a tint, a highlight or Prism can set.
function uiColorPropNames() {
  if (UI_COLOR_PROP_NAMES) return UI_COLOR_PROP_NAMES;
  const names = new Set();
  const add = (vars) => Object.keys(vars || {}).forEach((n) => names.add(n));
  for (const theme of ["dark", "light"]) {
    add(uiPrismVars(theme));
    add(uiPureTintVars(theme));
    add(uiHighlightVars("pure", theme));
    for (const scheme of uiColorSchemes()) {
      add(uiTintVars(scheme.value, theme));
      add(uiHighlightVars(scheme.value, theme));
    }
  }
  UI_COLOR_PROP_NAMES = Array.from(names);
  return UI_COLOR_PROP_NAMES;
}
var REMEMBERED_LOOK_SENT = "";
function applyUiColorsFromOptions(theme, libraryOpen) {
  const root = document.documentElement;
  if (!root) return;
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  let tint = normalizeUiTintValue(opt && opt.uiTint);
  let highlight = normalizeUiHighlightValue(opt && opt.uiHighlight);
  // Same rule as the theme: with no library open the settings are only
  // defaults, so the look remembered from the library wins.
  if (!libraryOpen) {
    const look = rememberedLook();
    if (look) {
      tint = normalizeUiTintValue(look.tint);
      highlight = normalizeUiHighlightValue(look.highlight);
    }
  }
  const resolved = resolveUiColorChoice(tint, highlight);
  const varsFor = (t) =>
    resolved.prism
      ? uiPrismVars(t)
      : Object.assign(
          {},
          uiTintVars(resolved.tint, t),
          uiHighlightVars(resolved.highlight, t),
        );
  const vars = varsFor(theme === "light" ? "light" : "dark");
  // Clear every property any scheme can write, not only the ones this page
  // wrote last: the <head> boot script paints the remembered scheme before
  // this runs, and a property only it wrote would otherwise stay stuck when
  // the library's own look writes fewer (Default writes none).
  for (const name of uiColorPropNames()) root.style.removeProperty(name);
  for (const name of UI_COLOR_PROPS_WRITTEN) root.style.removeProperty(name);
  UI_COLOR_PROPS_WRITTEN = Object.keys(vars);
  for (const name of UI_COLOR_PROPS_WRITTEN)
    root.style.setProperty(name, vars[name]);
  if (resolved.prism) root.setAttribute("data-ui-prism", "");
  else root.removeAttribute("data-ui-prism");
  if (!libraryOpen && !LIBRARY_LOOK_FROM_DISK) return;
  // The library's own look: keep it in memory for every reload and loading
  // screen in this page, and remember it for the next launch.
  LIBRARY_LOOK = { theme: theme === "light" ? "light" : "dark", tint, highlight };
  const record = {
    theme: LIBRARY_LOOK.theme,
    tint,
    highlight,
    prism: resolved.prism,
    dark: varsFor("dark"),
    light: varsFor("light"),
  };
  try {
    if (tint === "default" && highlight === "default")
      localStorage.removeItem("lgUiColors");
    else localStorage.setItem("lgUiColors", JSON.stringify(record));
  } catch {}
  // The Mac app keeps its own copy in a file (electron/commands.js
  // remember_look), sent only when it changes.
  const sent = JSON.stringify(record);
  if (sent !== REMEMBERED_LOOK_SENT && window.__TAURI__ && window.__TAURI__.core) {
    REMEMBERED_LOOK_SENT = sent;
    Promise.resolve()
      .then(() => window.__TAURI__.core.invoke("remember_look", { look: record }))
      .catch(() => {});
  }
}

/* The passcode gate's view of the look: the library's own preferences file,
   read before anything else is, so the passcode screen is in the library's
   colors even when the remembered copy is missing or out of date (another
   host changed them, or a quit lost the last write). */
async function readLibraryLookFromDisk(rootHandle = null) {
  let dir = null;
  try {
    dir = await lockMetaDirHandle(rootHandle);
  } catch {
    dir = null;
  }
  if (!dir) return null;
  const names = new Set(
    ["appTheme", "uiTint", "uiHighlight"]
      .map((key) => META_DOC_FILE_NAMES[metaPreferenceDocIdForOptionKey(key)])
      .filter(Boolean),
  );
  const options = {};
  for (const name of names) {
    try {
      const fh = await dir.getFileHandle(name, { create: false });
      const doc = JSON.parse(await (await fh.getFile()).text());
      if (doc && doc.options && typeof doc.options === "object")
        Object.assign(options, doc.options);
    } catch {}
  }
  if (!("appTheme" in options) && !("uiTint" in options) && !("uiHighlight" in options))
    return null;
  return {
    theme: normalizeAppThemeValue(options.appTheme),
    tint: normalizeUiTintValue(options.uiTint),
    highlight: normalizeUiHighlightValue(options.uiHighlight),
  };
}

async function applyLibraryLookFromDisk(rootHandle = null) {
  const look = await readLibraryLookFromDisk(rootHandle);
  if (!look) return false;
  LIBRARY_LOOK = look;
  LIBRARY_LOOK_FROM_DISK = true;
  try {
    applyColorSchemeFromOptions();
  } finally {
    LIBRARY_LOOK_FROM_DISK = false;
  }
  return true;
}

function applyTagFolderTitleColorsFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  root.style.removeProperty("--dir-tag-favorite-title-color");
}
