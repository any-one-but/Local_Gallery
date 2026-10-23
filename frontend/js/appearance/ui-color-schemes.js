/* UI color schemes
   The colour scheme lists behind UI tint and UI highlight, and the
   theme/tint/highlight normalisers. Loaded this early because normalizeOptions
   calls them while the page loads. */

function normalizeAppThemeValue(value, fallback = "dark") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "light" || raw === "dark") return raw;
  return fallback === "light" ? "light" : "dark";
}

/* Theme color and Accent color (Appearance; stored as `uiTint` and
   `uiHighlight`, and called tint and highlight in the code). They are one list of
   colour schemes seen from two sides: every scheme has a tint (the page, the
   surfaces, the glass, the ink) and a highlight (the accent) that were made
   together, and both menus list the same schemes in the same order under the
   same names. Mixing across schemes still works; matching is what each pair
   was drawn for. Default is no choice at all: nothing is written and the
   stylesheet's own graphite and system blue apply, exactly as before.

   Each side also offers "Match": the tint can follow whatever highlight is
   set, or the highlight whatever tint is set, so changing one changes both.
   Both set to Match have nothing left to follow, and that is the hidden
   scheme, Prism (`uiPrismVars`): every role on its own hue, all of them
   turning together, the accent turning three times as fast.

   They are written as inline custom properties on the root, recomputed for the
   theme in force every time applyColorSchemeFromOptions runs, and remembered in
   localStorage (`lgUiColors`) with both themes' values, so the boot script in
   <head> can paint the splash and passcode screen in them before any settings
   are readable.

   A scheme is authored per theme, colour by colour, rather than derived from
   one hue: Crimson is a gothic black-red in dark and blood on cold snow in
   light, which no single hue at two lightnesses could be. Every colour is
   [hue, saturation, lightness]. These are functions rather than consts
   because normalizeOptions asks for the ids before this point of the script
   has run. */
var UI_COLOR_SCHEMES_CACHE;
function uiColorSchemes() {
  if (UI_COLOR_SCHEMES_CACHE) return UI_COLOR_SCHEMES_CACHE;
  // bg: the page. surface: cards and menus. line: separators and hover.
  // glass: what bubbles are tinted with. ink, ink2, ink3: the three text
  // weights. accent: the highlight. dark: text laid on the accent is dark.
  const side = (bg, surface, line, glass, ink, ink2, ink3, accent, dark = false) => ({
    bg, surface, line, glass, ink, ink2, ink3, accent, dark,
  });
  UI_COLOR_SCHEMES_CACHE = [
    {
      // A gothic nave: red-black stone, bone-white text, and the accent is
      // blood. In light, blood on snow: cold blue-white and a deep red.
      value: "crimson", label: "Red",
      dark: side([350, 30, 4.5], [348, 26, 10], [350, 22, 19], [352, 34, 6],
        [30, 18, 90], [20, 10, 66], [355, 10, 44], [354, 84, 46]),
      light: side([210, 28, 97], [210, 35, 99.5], [215, 18, 86], [210, 30, 99],
        [222, 30, 10], [220, 12, 36], [218, 10, 56], [355, 88, 38]),
    },
    {
      // A forge: coal, firelight text, molten orange. In light, cold ash
      // with a burnt edge.
      value: "ember", label: "Orange",
      dark: side([20, 14, 6], [18, 14, 11.5], [20, 14, 21], [16, 16, 7.5],
        [36, 40, 92], [28, 22, 68], [22, 14, 48], [20, 96, 55], true),
      light: side([30, 10, 93], [35, 18, 97.5], [28, 10, 82], [33, 16, 97],
        [15, 22, 13], [20, 10, 38], [25, 8, 55], [16, 90, 44]),
    },
    {
      // Old photographs: a brown-black darkroom with tarnished gold. In
      // light, cream paper and sepia ink.
      value: "sepia", label: "Brown",
      dark: side([32, 28, 6.5], [33, 26, 12], [34, 22, 22], [32, 28, 8],
        [40, 45, 88], [36, 26, 66], [32, 18, 46], [42, 72, 56], true),
      light: side([40, 45, 90], [42, 55, 95], [38, 30, 78], [42, 50, 95],
        [26, 40, 16], [28, 24, 36], [30, 16, 52], [28, 62, 36]),
    },
    {
      // The forest floor at night, lit by lichen. In light, a botanical
      // plate: sage paper, fern-green ink.
      value: "moss", label: "Olive",
      dark: side([95, 22, 5.5], [92, 18, 10.5], [90, 14, 20], [96, 24, 7],
        [70, 25, 90], [80, 14, 66], [90, 10, 46], [78, 68, 52], true),
      light: side([80, 20, 93], [70, 30, 98], [85, 14, 80], [75, 25, 97],
        [120, 25, 12], [110, 12, 34], [100, 8, 52], [135, 48, 30]),
    },
    {
      // A polar sky: blue-black ground, teal surfaces, violet glass and the
      // green of the lights themselves. In light, a pale mint morning.
      value: "aurora", label: "Green",
      dark: side([215, 40, 5], [190, 26, 10], [200, 20, 20], [255, 32, 8],
        [160, 40, 92], [175, 18, 68], [200, 12, 48], [150, 85, 52], true),
      light: side([170, 30, 94], [190, 40, 98.5], [180, 16, 82], [260, 35, 98],
        [240, 35, 16], [230, 14, 38], [210, 10, 55], [160, 80, 30]),
    },
    {
      // The abyss: navy so deep it is nearly black, and bioluminescent
      // cyan. In light, sea glass and a sounding chart.
      value: "fathoms", label: "Cyan",
      dark: side([215, 60, 4.5], [210, 45, 9.5], [205, 35, 19], [218, 60, 6],
        [190, 40, 92], [195, 25, 68], [205, 18, 48], [186, 95, 50], true),
      light: side([195, 35, 92], [190, 40, 97.5], [198, 25, 80], [192, 40, 97],
        [212, 60, 15], [205, 25, 35], [200, 15, 52], [200, 90, 34]),
    },
    {
      // Polar night: grey-blue ice, frost-white text, a pale ice accent. In
      // light, fresh ice with a glacier-blue core.
      value: "glacier", label: "Light blue",
      dark: side([210, 14, 8], [208, 14, 15], [205, 12, 26], [210, 16, 10],
        [200, 25, 96], [205, 12, 74], [210, 8, 54], [195, 45, 80], true),
      light: side([200, 40, 96.5], [195, 50, 99.5], [200, 25, 87], [198, 45, 99],
        [215, 30, 18], [210, 14, 40], [205, 10, 58], [196, 75, 40]),
    },
    {
      // Twilight: a blue-violet sky with the last of the sun in the text and
      // the accent. In light, lavender haze and warm surfaces.
      value: "dusk", label: "Indigo",
      dark: side([248, 30, 7], [258, 24, 13], [262, 18, 23], [240, 30, 9],
        [28, 60, 90], [20, 22, 70], [255, 10, 50], [24, 92, 64], true),
      light: side([255, 22, 94], [30, 60, 98], [255, 14, 83], [25, 55, 97.5],
        [250, 30, 18], [250, 12, 40], [250, 8, 56], [16, 80, 48]),
    },
    {
      // Blacklight: violet-black and glowing UV. In light, lilac paper and
      // deep violet ink.
      value: "ultraviolet", label: "Purple",
      dark: side([268, 45, 5], [270, 34, 10.5], [272, 26, 21], [266, 48, 7],
        [270, 40, 94], [270, 22, 72], [268, 14, 50], [270, 95, 68], true),
      light: side([275, 30, 95], [280, 40, 99], [272, 18, 84], [278, 35, 98.5],
        [268, 50, 16], [268, 16, 38], [268, 10, 56], [266, 70, 48]),
    },
    {
      // A neon night drive: purple-black, cyan text, hot magenta. In light,
      // vaporwave pastels with the same hot pink.
      value: "synthwave", label: "Magenta",
      dark: side([280, 55, 6], [290, 40, 11.5], [300, 30, 22], [270, 55, 8],
        [185, 70, 90], [300, 30, 74], [290, 18, 52], [318, 100, 62]),
      light: side([300, 45, 95], [190, 60, 98], [300, 22, 84], [320, 50, 98],
        [270, 55, 20], [285, 20, 42], [290, 12, 58], [325, 90, 50]),
    },
    {
      // Velvet: plum shadows and a soft rose. In light, a blush petal with
      // plum ink.
      value: "rose", label: "Pink",
      dark: side([335, 24, 7], [332, 20, 13], [330, 16, 23], [338, 26, 9],
        [345, 35, 94], [340, 16, 72], [335, 10, 50], [338, 78, 70], true),
      light: side([345, 45, 95], [350, 60, 98.5], [345, 22, 85], [350, 55, 98],
        [335, 35, 18], [335, 14, 40], [335, 10, 56], [340, 62, 46]),
    },
    {
      // Film noir: no colour at all but a cold streetlight. In light,
      // newsprint: yellowed paper, black ink, steel.
      value: "noir", label: "Gray",
      dark: side([0, 0, 5], [0, 0, 11], [0, 0, 21], [0, 0, 7],
        [0, 0, 93], [0, 0, 66], [0, 0, 44], [208, 32, 74], true),
      light: side([45, 14, 91], [45, 18, 96], [45, 8, 78], [45, 16, 96],
        [0, 0, 10], [0, 0, 34], [0, 0, 52], [210, 28, 30]),
    },
  ];
  return UI_COLOR_SCHEMES_CACHE;
}

// Both menus list: Default, Match the other one, every scheme, then Pure.
// Pure is pure black / white as a tint and white / black as a highlight;
// uiPureTintVars and uiHighlightVars write it directly.
var UI_TINT_PALETTES_CACHE;
function uiTintPalettes() {
  if (UI_TINT_PALETTES_CACHE) return UI_TINT_PALETTES_CACHE;
  UI_TINT_PALETTES_CACHE = [
    { value: "default", label: "Default" },
    { value: "match", label: "Match accent color" },
    ...uiColorSchemes().map((s) => ({ value: s.value, label: s.label })),
    { value: "pure", label: "Pure" },
  ];
  return UI_TINT_PALETTES_CACHE;
}

var UI_HIGHLIGHT_PALETTES_CACHE;
function uiHighlightPalettes() {
  if (UI_HIGHLIGHT_PALETTES_CACHE) return UI_HIGHLIGHT_PALETTES_CACHE;
  UI_HIGHLIGHT_PALETTES_CACHE = [
    { value: "default", label: "Default" },
    { value: "match", label: "Match theme color" },
    ...uiColorSchemes().map((s) => ({ value: s.value, label: s.label })),
    { value: "pure", label: "Pure" },
  ];
  return UI_HIGHLIGHT_PALETTES_CACHE;
}

// Ids from before the tints and highlights were one list, each sent to the
// scheme closest to what it was, so nobody's choice falls back to Default.
// (Functions for the same reason as the lists.)
function uiTintRetiredIds() {
  return {
    neutral: "noir", verdant: "moss", dune: "sepia", darkroom: "crimson",
    rosewater: "rose", iridescence: "ultraviolet",
  };
}
function uiHighlightRetiredIds() {
  return {
    lagoon: "fathoms", jade: "aurora", lime: "moss", amber: "sepia",
    coral: "ember", neon: "synthwave", iris: "ultraviolet", silver: "glacier",
    inverse: "pure",
  };
}

function normalizeUiTintValue(value) {
  let raw = String(value ?? "").trim().toLowerCase();
  const retired = uiTintRetiredIds();
  if (Object.prototype.hasOwnProperty.call(retired, raw)) raw = retired[raw];
  return uiTintPalettes().some((p) => p.value === raw) ? raw : "default";
}

function normalizeUiHighlightValue(value) {
  let raw = String(value ?? "").trim().toLowerCase();
  const retired = uiHighlightRetiredIds();
  if (Object.prototype.hasOwnProperty.call(retired, raw)) raw = retired[raw];
  return uiHighlightPalettes().some((p) => p.value === raw) ? raw : "default";
}
