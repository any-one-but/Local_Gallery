/* Options
   Every stored option: its normaliser, its default (defaultOptions) and
   normalizeOptions, plus the small accessors around them. The last two
   functions come from Filters and App volume: normalizeOptions calls them
   while the page loads, so they must be declared here or earlier (see "Load
   order" in CLAUDE.md). */

/* =========================================================
       Local-only mode
       ========================================================= */

/* A hidden library folder is `.Local Gallery` on disk (Passcode -> Hide gallery
   folder), but the dot is only there to hide it from Finder -- it is not part
   of the library's name. So the root is shown without its leading dots
   everywhere the app names it (title path, Item Info). Only the display
   changes: the node's real name, catalog rootName and archive names keep it. */
function rootDisplayFolderName(name) {
  return String(name || "").replace(/^\.+/, "") || String(name || "");
}

function dirDisplayName(node) {
  const rawName =
    node && WS.root && node === WS.root
      ? rootDisplayFolderName(node.name)
      : node?.name;
  const base = displayFolderSegmentName(rawName || "folder") || "folder";
  if (isMissingPlaceholderNode(node)) return missingItemDisplayName(base);
  return base;
}

function fileDisplayNameForRecord(rec) {
  const base = fileDisplayName(rec?.name || "file") || "file";
  if (isMissingPlaceholderRecord(rec)) return missingItemDisplayName(base);
  return base;
}

function clampNumber(value, min, max, fallback) {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeAnimatedMediaFiltersValue(value, fallback = "on") {
  if (value === true) return "on";
  if (value === false) return "off";
  const raw = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (raw === "on" || raw === "off") return raw;
  if (
    raw === "videos" ||
    raw === "video" ||
    raw === "video-only" ||
    raw === "videos-only" ||
    raw === "video_only" ||
    raw === "videos_only"
  ) {
    return "videos";
  }
  return fallback;
}

function normalizeFolderBehavior(value, fallback = "slide") {
  const raw = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (raw === "slide" || raw === "stop") return raw;
  // Legacy "loop" mode is retired for item navigation; map to slide.
  if (raw === "loop") return "slide";
  return fallback;
}

function normalizeColorSchemeValue(value, fallback = "retro") {
  const raw = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (
    raw === "retro" ||
    raw === "ibn" ||
    raw === "retro90s" ||
    raw === "retro90s-dark"
  )
    return "retro";
  return "retro";
}

// NOTE: The selectable "appearance modes" (the Appearance dropdown with the
// retro, classic, verdant, synthwave, azure, ember, amber and OLED-dark color
// schemes) were removed in this release. v01.06.51 is the LAST version to
// include them. The app now ships a single fixed look (the former "default"),
// dark only -- the Light Mode toggle and its lightMode option were removed too.
// To revive the old schemes, check out v01.06.51 or earlier. (This is unrelated
// to the "Filter preset" media-overlay presets, which remain.)

function normalizeThumbRenderModeValue(value, fallback = "medium") {
  const raw = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (
    raw === "small" ||
    raw === "medium" ||
    raw === "high" ||
    raw === "native" ||
    raw === "placeholder"
  )
    return raw;
  return fallback;
}

function normalizeDisplaySizeValue(value, fallback = "medium") {
  const raw = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (raw === "small" || raw === "medium" || raw === "large") return raw;
  return fallback;
}

function normalizeThumbnailScaleValue(value, fallback = "row7") {
  const raw = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (raw === "row10" || raw === "row7" || raw === "row5") return raw;
  if (raw === "row9" || raw === "row8") return "row10";
  if (raw === "row6") return "row7";
  if (raw === "row4" || raw === "row3") return "row5";
  // Migrate legacy scale names to the closest matching row-count target.
  if (raw === "small") return "row10";
  if (raw === "medium") return "row7";
  if (raw === "large") return "row5";
  if (raw === "xl") return "row5";
  if (raw === "xxl") return "row5";
  if (raw === "xxxl") return "row5";
  return normalizeThumbnailScaleValue(fallback, "row7");
}

function thumbnailVisibilityKindSpecs() {
  return [
    {
      kind: "file",
      label: "File cards",
      previewPrefix: "previewFileThumbnail",
      legacyTitleKey: "showFileThumbnailTitles",
      legacyMenuHiddenKey: "hideFileThumbnailMenuButton",
    },
    {
      kind: "rootFolder",
      label: "Root folder cards",
      previewPrefix: "previewRootFolderThumbnail",
      legacyTitleKey: "showRootFolderThumbnailTitles",
      legacyMenuHiddenKey: "hideRootFolderThumbnailMenuButton",
    },
    {
      kind: "subfolder",
      label: "Subfolder cards",
      previewPrefix: "previewSubfolderThumbnail",
      legacyTitleKey: "showSubfolderThumbnailTitles",
      legacyMenuHiddenKey: "hideSubfolderThumbnailMenuButton",
    },
    {
      kind: "tag",
      label: "Tag cards",
      previewPrefix: "previewTagThumbnail",
      legacyTitleKey: "showTagThumbnailTitles",
      legacyMenuHiddenKey: "hideTagAndRootFolderThumbnailMenuButton",
    },
  ];
}

function thumbnailVisibilityKindSpec(kind) {
  const target = String(kind || "");
  const specs = thumbnailVisibilityKindSpecs();
  for (let i = 0; i < specs.length; i++) {
    if (specs[i].kind === target) return specs[i];
  }
  return specs[0];
}

function thumbnailVisibilitySupportedFields(surface, kind) {
  const targetSurface = surface === "directories" ? "directories" : "preview";
  const targetKind = thumbnailVisibilityKindSpec(kind).kind;
  const support = {
    preview: {
      file: ["itemCount", "size", "title", "menuButton", "itemType"],
      rootFolder: [
        "folderCount",
        "fileCount",
        "size",
        "title",
        "menuButton",
        "itemType",
      ],
      subfolder: [
        "folderCount",
        "fileCount",
        "size",
        "title",
        "menuButton",
        "itemType",
      ],
      tag: [
        "folderCount",
        "fileCount",
        "size",
        "title",
        "menuButton",
        "itemType",
      ],
    },
    directories: {
      file: ["itemCount", "size", "itemType"],
      rootFolder: ["folderCount", "fileCount", "size", "itemType"],
      subfolder: ["folderCount", "fileCount", "size", "itemType"],
      tag: ["folderCount", "fileCount", "size", "itemType"],
    },
  };
  return Array.isArray(support[targetSurface]?.[targetKind])
    ? support[targetSurface][targetKind].slice()
    : [];
}

function thumbnailVisibilityFieldSupported(surface, kind, field) {
  return thumbnailVisibilitySupportedFields(surface, kind).includes(
    String(field || ""),
  );
}

function thumbnailVisibilityFieldSuffix(field) {
  if (field === "itemCount") return "ShowItemCount";
  if (field === "folderCount") return "ShowFolderCount";
  if (field === "fileCount") return "ShowFileCount";
  if (field === "size") return "ShowSize";
  if (field === "score") return "ShowScore";
  if (field === "title") return "ShowTitle";
  if (field === "menuButton") return "ShowMenuButton";
  if (field === "itemType") return "ShowItemType";
  return "";
}

function thumbnailVisibilityPreviewOptionKey(kind, field) {
  if (!thumbnailVisibilityFieldSupported("preview", kind, field)) return "";
  const spec = thumbnailVisibilityKindSpec(kind);
  const suffix = thumbnailVisibilityFieldSuffix(field);
  return suffix ? `${spec.previewPrefix}${suffix}` : "";
}

function thumbnailVisibilityExtraInfoOptionKey(kind) {
  const spec = thumbnailVisibilityKindSpec(kind);
  return spec && spec.previewPrefix ? `${spec.previewPrefix}ShowExtraInfo` : "";
}

function thumbnailVisibilityDirectoriesOptionKey(kind, field) {
  return "";
}

function thumbnailVisibilityOptionKeys() {
  const out = [];
  const specs = thumbnailVisibilityKindSpecs();
  const previewFields = [
    "itemCount",
    "folderCount",
    "fileCount",
    "size",
    "title",
    "menuButton",
    "itemType",
  ];
  const directoriesFields = ["itemCount", "folderCount", "fileCount", "size", "itemType"];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    out.push(thumbnailVisibilityExtraInfoOptionKey(spec.kind));
    for (let j = 0; j < previewFields.length; j++) {
      out.push(
        thumbnailVisibilityPreviewOptionKey(spec.kind, previewFields[j]),
      );
    }
    for (let j = 0; j < directoriesFields.length; j++) {
      out.push(
        thumbnailVisibilityDirectoriesOptionKey(
          spec.kind,
          directoriesFields[j],
        ),
      );
    }
  }
  return out.filter(Boolean);
}

function thumbnailVisibilityInputId(optionKey) {
  return optionKey ? `opt_${String(optionKey)}` : "";
}

function buildDefaultThumbnailVisibilityOptions() {
  const out = {};
  const setPreview = (kind, field, value) => {
    const key = thumbnailVisibilityPreviewOptionKey(kind, field);
    if (key) out[key] = !!value;
  };
  const setExtraInfo = (kind, value) => {
    const key = thumbnailVisibilityExtraInfoOptionKey(kind);
    if (key) out[key] = !!value;
  };
  const setDirectories = (kind, field, value) => {
    const key = thumbnailVisibilityDirectoriesOptionKey(kind, field);
    if (key) out[key] = !!value;
  };
  const specs = thumbnailVisibilityKindSpecs();
  const previewFields = [
    "itemCount",
    "folderCount",
    "fileCount",
    "size",
    "title",
    "menuButton",
    "itemType",
  ];
  const directoriesFields = ["itemCount", "folderCount", "fileCount", "size", "itemType"];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    setExtraInfo(spec.kind, true);
    for (let j = 0; j < previewFields.length; j++) {
      out[thumbnailVisibilityPreviewOptionKey(spec.kind, previewFields[j])] =
        true;
    }
    for (let j = 0; j < directoriesFields.length; j++) {
      out[
        thumbnailVisibilityDirectoriesOptionKey(spec.kind, directoriesFields[j])
      ] = true;
    }
  }

  // Baseline defaults aligned to workspace thumbnail preference defaults.
  setPreview("file", "itemCount", false);
  setPreview("file", "size", false);
  setPreview("file", "title", true);
  setPreview("file", "menuButton", true);
  setPreview("file", "itemType", false);
  setDirectories("file", "itemCount", false);
  setDirectories("file", "size", false);
  setDirectories("file", "itemType", false);

  setPreview("rootFolder", "folderCount", false);
  setPreview("rootFolder", "fileCount", false);
  setPreview("rootFolder", "size", true);
  setPreview("rootFolder", "title", true);
  setPreview("rootFolder", "menuButton", true);
  setPreview("rootFolder", "itemType", false);
  setDirectories("rootFolder", "folderCount", false);
  setDirectories("rootFolder", "fileCount", false);
  setDirectories("rootFolder", "size", false);

  setPreview("subfolder", "folderCount", false);
  setPreview("subfolder", "fileCount", false);
  setPreview("subfolder", "size", false);
  setPreview("subfolder", "title", true);
  setPreview("subfolder", "menuButton", true);
  setPreview("subfolder", "itemType", false);
  setExtraInfo("subfolder", false);
  setDirectories("subfolder", "folderCount", false);
  setDirectories("subfolder", "fileCount", false);
  setDirectories("subfolder", "size", false);

  setPreview("tag", "folderCount", true);
  setPreview("tag", "fileCount", true);
  setPreview("tag", "title", true);
  setPreview("tag", "menuButton", true);
  setPreview("tag", "itemType", false);
  setDirectories("tag", "folderCount", true);
  setDirectories("tag", "fileCount", true);

  return out;
}

// --- Thumbnail title strip fields ---------------------------------------
// The strip renders exactly these two things. Everything else that used to be a
// per-kind visibility field is info text, which the strip no longer carries.
const THUMB_STRIP_LIVE_FIELDS = new Set(["title", "menuButton"]);

// Thumbnail title strip frosting. Two independent Settings > Thumbnails
/* Names off strips a *file* card back to its type bubble: no title, no score.
   Folders keep theirs -- a folder with no name is not identifiable by anything
   else on the card, whereas a photograph is its own label. Default on. */
function showFileNamesEnabled(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  if (!src) return true;
  return src.showFileNames !== false;
}

function applyShowFileNamesFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  if (showFileNamesEnabled()) root.removeAttribute("data-hide-file-names");
  else root.setAttribute("data-hide-file-names", "1");
}

/* Where a card's type icon sits (Appearance -> Icon placement): in the name's
   pill, before the name, or in its own bubble in the card's top-left corner.
   Written onto the root for the stylesheet, and the cards already on screen
   are moved over in place -- see arrangeCardPills. */
const TYPE_ICON_PLACEMENT_CYCLE = Object.freeze([
  Object.freeze({ value: "name", label: "In name" }),
  Object.freeze({ value: "corner", label: "Corner" }),
]);

function normalizeTypeIconPlacementValue(value, fallback = "name") {
  const v = String(value || "").trim().toLowerCase();
  return v === "name" || v === "corner" ? v : fallback;
}

function typeIconPlacement() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return normalizeTypeIconPlacementValue(opt && opt.typeIconPlacement);
}

function applyTypeIconPlacementFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  const place = typeIconPlacement();
  if (root.getAttribute("data-type-icon-place") === place) return;
  root.setAttribute("data-type-icon-place", place);
  arrangeCardPillsIn(document.body);
}

/* Where a card's score sits (Appearance -> Thumbnails -> Score placement): in
   its own bubble in the bottom-right corner, or in the name's pill, between
   the type icon and the name. Same mechanism as Icon placement. */
const SCORE_PLACEMENT_CYCLE = Object.freeze([
  Object.freeze({ value: "corner", label: "Corner" }),
  Object.freeze({ value: "name", label: "In name" }),
]);

function normalizeScorePlacementValue(value, fallback = "corner") {
  const v = String(value || "").trim().toLowerCase();
  return v === "name" || v === "corner" ? v : fallback;
}

function scorePlacement() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return normalizeScorePlacementValue(opt && opt.scorePlacement);
}

function applyScorePlacementFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  const place = scorePlacement();
  if (root.getAttribute("data-score-place") === place) return;
  root.setAttribute("data-score-place", place);
  arrangeCardPillsIn(document.body);
}

function setAppMenuScorePlacement(value) {
  setOptionValue("scorePlacement", normalizeScorePlacementValue(value));
  refreshLiveSettingsPaneFromKeyboardAction();
  applyOptionsEverywhere(false);
  showStatusMessage(
    `Score placement: ${labelForCycleValue(SCORE_PLACEMENT_CYCLE, scorePlacement())}`,
  );
  return true;
}

function setAppMenuTypeIconPlacement(value) {
  setOptionValue("typeIconPlacement", normalizeTypeIconPlacementValue(value));
  refreshLiveSettingsPaneFromKeyboardAction();
  applyOptionsEverywhere(false);
  showStatusMessage(
    `Icon placement: ${labelForCycleValue(TYPE_ICON_PLACEMENT_CYCLE, typeIconPlacement())}`,
  );
  return true;
}

/* How much the bubbles are tinted, as a percentage written onto the root.
   Shares the shape of the diffusion control on purpose -- the two are the two
   halves of what a bubble is made of, and they now sit next to each other. */
const BUBBLE_TINT_PERCENT_VALUES = Object.freeze([
  "0",
  "10",
  "20",
  "30",
  "40",
  "50",
  "60",
  "70",
  "80",
  "90",
  "100",
]);
const BUBBLE_TINT_DEFAULT = "60";

const BUBBLE_TINT_CYCLE = BUBBLE_TINT_PERCENT_VALUES.map((value) => ({
  value,
  label: `${value}%`,
}));

function normalizeBubbleTintValue(value, fallback = BUBBLE_TINT_DEFAULT) {
  const raw = String(value ?? "").trim().replace(/%$/, "");
  if (BUBBLE_TINT_PERCENT_VALUES.includes(raw)) return raw;
  /* An absent value is not a zero. `Number("")` is 0, not NaN, so without this
     an unset option normalises to "Clear" and every bubble in the app opens
     untinted -- which looks exactly like a broken theme rather than a missing
     default. */
  if (!raw) {
    const fb0 = String(fallback ?? "").trim().replace(/%$/, "");
    return BUBBLE_TINT_PERCENT_VALUES.includes(fb0) ? fb0 : BUBBLE_TINT_DEFAULT;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) {
    const rounded = Math.round(Math.max(0, Math.min(100, parsed)) / 10) * 10;
    return String(rounded);
  }
  const fb = String(fallback ?? "").trim().replace(/%$/, "");
  return BUBBLE_TINT_PERCENT_VALUES.includes(fb) ? fb : BUBBLE_TINT_DEFAULT;
}

function getBubbleTintFromOptions(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return normalizeBubbleTintValue(src && src.bubbleTint);
}

function applyBubbleTintFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  root.style.setProperty("--bubble-tint", `${getBubbleTintFromOptions()}%`);
}

/* Where the app menu opens. The select menu is not placed by this -- it is
   about an item and always appears beside it -- so this is the app menu only.

   `item` is the old behaviour and keeps the two offset cyclers below
   meaningful; every other value ignores them and pins the menu to a spot in the
   window, which is what makes it a fixed target you can learn rather than a
   panel that appears somewhere new each time. */
const APP_MENU_PLACEMENT_CYCLE = [
  { value: "item", label: "At the item" },
  { value: "center", label: "Middle" },
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "left", label: "Left edge" },
  { value: "right", label: "Right edge" },
];
const APP_MENU_PLACEMENT_DEFAULT = "top-left";

function normalizeAppMenuPlacementValue(value, fallback = APP_MENU_PLACEMENT_DEFAULT) {
  const raw = String(value ?? "").trim();
  if (APP_MENU_PLACEMENT_CYCLE.some((o) => o.value === raw)) return raw;
  return APP_MENU_PLACEMENT_CYCLE.some((o) => o.value === String(fallback))
    ? String(fallback)
    : APP_MENU_PLACEMENT_DEFAULT;
}

/* Placement, distance and height are fixed (Jo's choice): at the item, flush,
   raised. The accessors answer the fixed values and the rows are gone from the
   menu; the cycles, setters and stored options are untouched, so returning the
   stored value here and the rows to their submenus restores both. */
const APP_MENU_PLACEMENT_FIXED = "item";
const APP_MENU_DISTANCE_FIXED = "3";
const APP_MENU_HEIGHT_FIXED = "4";

function getAppMenuPlacementFromOptions(opt = null) {
  return APP_MENU_PLACEMENT_FIXED;
}

function getStoredAppMenuPlacementFromOptions(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return normalizeAppMenuPlacementValue(src && src.appMenuPlacement);
}

/* Where the app menu lands next to the item it was opened on.

   It used to sit flush against the card -- top edge level with the thumbnail's
   top edge, an 8px gap at the side -- and lining up exactly with the thing
   underneath it is what made it hard to read as a separate surface. Both axes
   are now adjustable so the right amount can be found by eye rather than
   argued about.

   Five steps each, and step 3 is the floor: it is the old flush position, the
   lowest and closest the menu will go. Steps 4 and 5 move it out and up;
   steps 1 and 2 exist so the scale can be walked *past* the floor into the
   overlap it used to have, which is worth being able to see next to the
   alternatives rather than only remembering. The default is step 4 -- one out
   from the floor -- which is the "slightly further, a little higher" this was
   asked for.

   `center` on the height axis is the one non-numeric value: the menu is
   centred on the item instead of offset from its top edge, which is a
   different idea rather than a further step, so it sits at the end of the
   list. */
const APP_MENU_OFFSET_STEP_PX = 14;

const APP_MENU_DISTANCE_CYCLE = [
  { value: "1", label: "Overlapping" },
  { value: "2", label: "Tight" },
  { value: "3", label: "Flush" },
  { value: "4", label: "Near" },
  { value: "5", label: "Far" },
];
const APP_MENU_DISTANCE_DEFAULT = "4";

const APP_MENU_HEIGHT_CYCLE = [
  { value: "1", label: "Below" },
  { value: "2", label: "Low" },
  { value: "3", label: "Level" },
  { value: "4", label: "Raised" },
  { value: "5", label: "High" },
  { value: "center", label: "Centered" },
];
const APP_MENU_HEIGHT_DEFAULT = "4";

function normalizeAppMenuDistanceValue(value, fallback = APP_MENU_DISTANCE_DEFAULT) {
  const raw = String(value ?? "").trim();
  if (APP_MENU_DISTANCE_CYCLE.some((o) => o.value === raw)) return raw;
  return APP_MENU_DISTANCE_CYCLE.some((o) => o.value === String(fallback))
    ? String(fallback)
    : APP_MENU_DISTANCE_DEFAULT;
}

function normalizeAppMenuHeightValue(value, fallback = APP_MENU_HEIGHT_DEFAULT) {
  const raw = String(value ?? "").trim();
  if (APP_MENU_HEIGHT_CYCLE.some((o) => o.value === raw)) return raw;
  return APP_MENU_HEIGHT_CYCLE.some((o) => o.value === String(fallback))
    ? String(fallback)
    : APP_MENU_HEIGHT_DEFAULT;
}

function getAppMenuDistanceFromOptions(opt = null) {
  return APP_MENU_DISTANCE_FIXED;
}

function getAppMenuHeightFromOptions(opt = null) {
  return APP_MENU_HEIGHT_FIXED;
}

function getStoredAppMenuDistanceFromOptions(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return normalizeAppMenuDistanceValue(src && src.appMenuDistance);
}

function getStoredAppMenuHeightFromOptions(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return normalizeAppMenuHeightValue(src && src.appMenuHeight);
}

/* Step 3 is the floor, so the offset is (step - 3) * one step. Steps 1 and 2
   come out negative, which is the overlap. */
function appMenuDistanceOffsetPx() {
  return (Number(getAppMenuDistanceFromOptions()) - 3) * APP_MENU_OFFSET_STEP_PX;
}

function appMenuHeightOffsetPx() {
  const v = getAppMenuHeightFromOptions();
  if (v === "center") return 0;
  return (Number(v) - 3) * APP_MENU_OFFSET_STEP_PX;
}

function appMenuCentersOnItem() {
  return getAppMenuHeightFromOptions() === "center";
}

/* Diffusion: how hard every translucent surface in the app frosts what is
   behind it -- the title bar, the menus, the overlays, the search field and the
   two pills on each card, all from one number.

   It replaces the pair of controls the old title strip had. Those governed one
   bar on one card; there is no bar any more, and a knob that reached a single
   element was never the useful shape of this setting. What people actually
   want to turn down is the frost, everywhere at once.

   Stored as a 0-100 percentage string at 10% intervals, so the value survives
   in the same options file the strip settings lived in. `thumbTitleStripBlur`
   is read as the seed when the new key is absent: it is the same quantity
   under an old name, and a library that had diffusion turned down should not
   have it jump back up on first launch. The old *opacity* value is simply
   dropped -- it described a bar that no longer exists. */
/* 40px was the whole range spread over ten even steps, which put the first
   usable setting at 4px and every step after it further than wanted -- the
   bottom of the scale was unreachable. The ceiling comes down and the steps
   bunch up at the low end, so the gentle settings have somewhere to live and
   the coarse ones are still there for anyone who wants a heavy frost. */
const GLASS_DIFFUSION_MAX_PX = 26;

// Even 10% steps, like Bubble tint beside it (Jo's call). The ceiling above
// still keeps the low end gentle.
const GLASS_DIFFUSION_PERCENT_VALUES = Object.freeze([
  "0",
  "10",
  "20",
  "30",
  "40",
  "50",
  "60",
  "70",
  "80",
  "90",
  "100",
]);
const GLASS_DIFFUSION_DEFAULT = "20";
const LEGACY_GLASS_DIFFUSION_LEVELS = Object.freeze({
  none: "0",
  low: "20",
  medium: "50",
  high: "70",
  max: "100",
});

function normalizeGlassDiffusionValue(
  value,
  fallback = GLASS_DIFFUSION_DEFAULT,
) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/%$/, "");
  if (Object.prototype.hasOwnProperty.call(LEGACY_GLASS_DIFFUSION_LEVELS, raw)) {
    return LEGACY_GLASS_DIFFUSION_LEVELS[raw];
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) {
    /* Snap to the nearest step on the list, so a value saved under the old
       uneven steps (5, 15) lands on its neighbour. */
    const target = Math.max(0, Math.min(100, parsed));
    let best = GLASS_DIFFUSION_PERCENT_VALUES[0];
    let bestGap = Infinity;
    for (const v of GLASS_DIFFUSION_PERCENT_VALUES) {
      const gap = Math.abs(Number(v) - target);
      if (gap < bestGap) { bestGap = gap; best = v; }
    }
    return best;
  }
  const fb = String(fallback ?? "").trim().replace(/%$/, "");
  return GLASS_DIFFUSION_PERCENT_VALUES.includes(fb) ? fb : GLASS_DIFFUSION_DEFAULT;
}

function getGlassDiffusionFromOptions(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  if (!src) return GLASS_DIFFUSION_DEFAULT;
  const own = src.glassDiffusion;
  if (own !== undefined && own !== null && String(own).trim() !== "")
    return normalizeGlassDiffusionValue(own);
  // Carried over from the retired title-strip diffusion, same quantity.
  return normalizeGlassDiffusionValue(src.thumbTitleStripBlur);
}

// Default for workspaces that have never set fullResThumbnails. Must live above
// defaultOptions() / META_GENERAL_PREFERENCE_OPTION_KEYS (which call it at
// init). See tauriThumbForImgEl for what each mode paints.
const FULL_QUALITY_THUMBNAILS_DEFAULT = true;

// The master switch for painting media into thumbnails at all. Off, no card
// ever asks for a media URL, so nothing is fetched, decoded or kept in memory
// and every tile shows its item icon instead. On by default.
const MEDIA_THUMBNAILS_DEFAULT = true;

// Which thumbnail pipeline the grid uses.
function fullResThumbnailsEnabled(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return typeof src?.fullResThumbnails === "boolean"
    ? src.fullResThumbnails
    : FULL_QUALITY_THUMBNAILS_DEFAULT;
}

// Persist, drop in-memory thumb URLs, then Refresh App so every tile rebuilds
// under the new pipeline (full-res originals vs 512px generated JPEGs).
function applyFullResThumbnailsModeChange(enabled) {
  const on = !!enabled;
  showStatusMessage(
    `Full resolution thumbnails: ${on ? "On" : "Off"}`,
    "full-res-thumbnails",
  );
  try {
    if (typeof TAURI_THUMB_INDEX !== "undefined" && TAURI_THUMB_INDEX?.clear) {
      TAURI_THUMB_INDEX.clear();
    }
  } catch {}
  const kickRefresh = () => {
    if (!WS.meta?.fsRootHandle) return;
    refreshWorkspaceKeybindAction();
  };
  // Save first so a refresh / crash keeps the new value.
  if (typeof persistDirtyMetadataNow === "function") {
    persistDirtyMetadataNow()
      .catch(() => {})
      .finally(kickRefresh);
  } else {
    kickRefresh();
  }
}

// Persist, drop any thumb URLs already minted, then Refresh App so every tile
// rebuilds in the new mode. A refresh (rather than a re-render) is what makes
// "off" actually free: resetWorkspace revokes the object URLs the old tiles
// were holding, so turning it off releases what was already loaded instead of
// merely hiding it.
function applyMediaThumbnailsModeChange(enabled) {
  const on = !!enabled;
  showStatusMessage(
    `Media thumbnails: ${on ? "On" : "Off"}`,
    "media-thumbnails",
  );
  try {
    if (typeof TAURI_THUMB_INDEX !== "undefined" && TAURI_THUMB_INDEX?.clear) {
      TAURI_THUMB_INDEX.clear();
    }
  } catch {}
  const kickRefresh = () => {
    if (!WS.meta?.fsRootHandle) return;
    refreshWorkspaceKeybindAction();
  };
  // Save first so a refresh / crash keeps the new value.
  if (typeof persistDirtyMetadataNow === "function") {
    persistDirtyMetadataNow()
      .catch(() => {})
      .finally(kickRefresh);
  } else {
    kickRefresh();
  }
}

function normalizeThumbnailVisibilityOptions(src, fallbacks) {
  const out = {};
  const specs = thumbnailVisibilityKindSpecs();
  const previewFields = [
    "itemCount",
    "folderCount",
    "fileCount",
    "size",
    "score",
    "title",
    "menuButton",
    "itemType",
  ];
  const directoriesFields = ["itemCount", "folderCount", "fileCount", "size", "score", "itemType"];


  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    // "Show extra info" only ever gated the info text, which the strip no
    // longer renders. Forced off with the rest rather than derived from the
    // legacy per-field keys.
    const extraInfoKey = thumbnailVisibilityExtraInfoOptionKey(spec.kind);
    if (extraInfoKey) out[extraInfoKey] = false;
    for (let j = 0; j < previewFields.length; j++) {
      const field = previewFields[j];
      const key = thumbnailVisibilityPreviewOptionKey(spec.kind, field);
      if (!key) continue;
      // The title strip carries a title and a badge; the info fields (counts,
      // size, item type) are no longer rendered on it, so they are forced off
      // here rather than deleted. Keeping the keys means saved preference docs
      // still load unchanged and the many `opt[key]` readers around the app
      // just see false, instead of every one of them needing a guard.
      if (!THUMB_STRIP_LIVE_FIELDS.has(field)) {
        out[key] = false;
        continue;
      }
      out[key] = true;
    }
    for (let j = 0; j < directoriesFields.length; j++) {
      const field = directoriesFields[j];
      const key = thumbnailVisibilityDirectoriesOptionKey(spec.kind, field);
      if (!key) continue;
      out[key] = false;
    }
  }
  return out;
}

const NOTIFICATION_SOURCE_SPECS = Object.freeze([
  Object.freeze({ section: "Library & workspace", id: "workspace-load", label: "Folder loading / read-only state", hint: "Folder picker, load-folder, and read-only status messages.", optionKey: "notifyWorkspaceLoad" }),
  Object.freeze({ section: "Library & workspace", id: "workspace-refresh", label: "Workspace refresh", hint: "Refresh start, completion, failure, and unavailable messages.", optionKey: "notifyWorkspaceRefresh" }),
  Object.freeze({ section: "Library & workspace", id: "storage", label: "Storage portal messages", hint: "Storage portal and storage-management messages that are not just the visibility toggle.", optionKey: "notifyStorage" }),

  Object.freeze({ section: "Panes & surfaces", id: "pane-toggles", label: "Pane / surface toggles", hint: "Title pane, settings pane, and preview background toggle messages.", optionKey: "notifyPaneToggles" }),
  Object.freeze({ section: "Hidden & utility folders", id: "visibility-toggles", label: "Hidden / Trash / Storage / Untagged toggles", hint: "Notifications that announce utility folders being shown, hidden, revealed, or blank-row adjusted.", optionKey: "notifyVisibilityToggles" }),
  Object.freeze({ section: "Hidden & utility folders", id: "quick-navigation", label: "Quick navigation toggle", hint: "Quick navigation on/off messages.", optionKey: "notifyQuickNavigation" }),

  Object.freeze({ section: "Cycling actions", id: "cycle-filter", label: "Media filter cycle", hint: "The action that cycles the root-wide media filter: All / Images / Videos / Text.", optionKey: "notifyCycleFilter" }),
  Object.freeze({ section: "Cycling actions", id: "cycle-animated-filters", label: "Animated filter cycle", hint: "The action that cycles animated filters off/on/videos-only.", optionKey: "notifyCycleAnimatedFilters" }),
  Object.freeze({ section: "Cycling actions", id: "cycle-folder-sort", label: "Folder sort cycle", hint: "The action that cycles folder sort modes.", optionKey: "notifyCycleFolderSort" }),
  Object.freeze({ section: "Cycling actions", id: "cycle-video-end", label: "Video-end behavior cycle", hint: "The action that cycles what videos do when they end.", optionKey: "notifyCycleVideoEnd" }),

  Object.freeze({ section: "Random navigation & sorting", id: "navigation-jump", label: "Random jumps", hint: "Random set and model jumps and their nothing-to-open messages.", optionKey: "notifyNavigationJump" }),
  Object.freeze({ section: "Random navigation & sorting", id: "random-folder-sort", label: "Randomize set order toggle", hint: "Randomize set order on/off messages.", optionKey: "notifyRandomFolderSort" }),

  Object.freeze({ section: "Playback", id: "playback", label: "Slideshow / gallery mode", hint: "Slideshow status and gallery-mode messages.", optionKey: "notifyPlayback" }),
  Object.freeze({ section: "Appearance & filenames", id: "appearance-display", label: "Filename display", hint: "Filename-format toggle messages.", optionKey: "notifyAppearanceDisplay" }),
  Object.freeze({ section: "Appearance & filenames", id: "appearance-presets", label: "Appearance presets", hint: "Preset apply, save, delete, and preset-selection messages.", optionKey: "notifyAppearancePresets" }),

  Object.freeze({ section: "Tags", id: "tags", label: "Tags / hidden tags", hint: "Tag editing and hidden-tag messages.", optionKey: "notifyTags" }),
  Object.freeze({ section: "Editing", id: "rename", label: "Rename + sanitize names", hint: "Rename and sanitize-name messages.", optionKey: "notifyRename" }),
  Object.freeze({ section: "File operations", id: "trash", label: "Trash / Put Back", hint: "Move-to-trash and Put Back messages.", optionKey: "notifyTrash" }),
  Object.freeze({ section: "File operations", id: "delete", label: "Delete", hint: "Delete messages.", optionKey: "notifyDelete" }),
  Object.freeze({ section: "File operations", id: "merge", label: "Set Merge / Loose Set Merge", hint: "Merge and loose-merge messages.", optionKey: "notifyMerge" }),

  Object.freeze({ section: "Generation", id: "scrub", label: "Scrub", hint: "Scrub tool messages.", optionKey: "notifyScrub" }),
  Object.freeze({ section: "Stats", id: "stats", label: "Stats / score history", hint: "Stats and score-history messages.", optionKey: "notifyStats" }),
  Object.freeze({ section: "Other", id: "misc", label: "Fallback / uncategorized", hint: "Any notification that does not fit a more specific bucket.", optionKey: "notifyMisc" }),
]);

function notificationSourceOptionKeys() {
  return NOTIFICATION_SOURCE_SPECS.map((spec) => String(spec.optionKey || ""));
}

function defaultOptions() {
  const out = {
    videoAudio: "unmuted",
    imageThumbSize: "placeholder",
    videoThumbSize: "placeholder",
    betaDirFileThumbFullCard: true,
    betaDirFolderSquareCard: true,
    previewMode: "grid",
    videoSkipStep: "10",
    preloadNextMode: "on",
    videoEndBehavior: "loop",
    slideshowDuration: "5",
    mediaFilter: "off",
    mediaFilterIntensity: 1,
    activeAppearancePresetId: "builtin-null",
    hueShiftOverlayEnabled: true,
    hueShiftOverlayIntensity: null,
    saturationOverlayEnabled: true,
    saturationOverlayIntensity: null,
    contrastOverlayEnabled: true,
    contrastOverlayIntensity: null,
    brightnessOverlayEnabled: true,
    brightnessOverlayIntensity: null,
    warmthOverlayEnabled: true,
    warmthOverlayIntensity: null,
    colorCrushOverlayEnabled: true,
    colorCrushOverlayIntensity: null,
    blackCrushOverlayEnabled: true,
    blackCrushOverlayIntensity: null,
    whiteCrushOverlayEnabled: true,
    whiteCrushOverlayIntensity: null,
    halationOverlayEnabled: true,
    halationOverlayIntensity: null,
    animatedMediaFilters: "on",
    ghostingOverlayEnabled: true,
    ghostingOverlayIntensity: null,
    lineDamageOverlayEnabled: true,
    lineDamageOverlayIntensity: null,
    pixelateOverlayEnabled: true,
    pixelateOverlayIntensity: null,
    blurOverlayEnabled: true,
    blurOverlayIntensity: null,
    upscaleSmoothingOverlayEnabled: true,
    upscaleSmoothingOverlayIntensity: null,
    upscalerOverlayEnabled: true,
    upscalerOverlayIntensity: null,
    chromaOverlayEnabled: true,
    chromaOverlayIntensity: null,
    grainOverlayEnabled: true,
    grainOverlayIntensity: null,
    vignetteOverlayEnabled: true,
    vignetteOverlayIntensity: null,
    filmCornerOverlayEnabled: true,
    filmCornerOverlayIntensity: null,
    colorScheme: "retro",
    appTheme: "dark",
    uiTint: "default",
    uiHighlight: "default",
    appMenuDistance: APP_MENU_DISTANCE_DEFAULT,
    appMenuHeight: APP_MENU_HEIGHT_DEFAULT,
    appMenuPlacement: APP_MENU_PLACEMENT_DEFAULT,
    bubbleTint: BUBBLE_TINT_DEFAULT,
    showFileNames: true,
    leftPaneWidthPct: 0.24421296296296297,
    menuPaneWidthPx: 422,
    thumbnailSize: "medium",
    includeHiddenItemsInStats: false,
    showHiddenFolder: false,
    showTrashFolder: true,
    showStorageFolder: true,
    storeImageFiles: false,
    storeVideoFiles: false,
    muteMessages: false,
    quickNavigation: true,
    showTopBar: true,
    typeIconPlacement: "name",
    scorePlacement: "corner",
    randomOrderModels: false,
    randomOrderSets: false,
    randomOrderFiles: false,
    minSetScoreFilter: null,
    minModelScoreFilter: null,
    showUntaggedFolder: false,
    showAllTagsFolder: false,
    showAllModelsFolder: false,
    showAllSetsFolder: false,
    showUtilityContainers: true,
    musicShuffle: false,
    musicRepeat: false,
    appVolume: 100,
    showScores: true,
    showFolderItemCount: true,
    showFolderSize: true,
    showItemTypeLabel: true,
    showFolderThumbnailTitles: true,
    showRootFolderThumbnailTitles: true,
    showSubfolderThumbnailTitles: true,
    showFileThumbnailTitles: true,
    showTagThumbnailTitles: true,
    hideRootFolderThumbnailMenuButton: false,
    hideSubfolderThumbnailMenuButton: false,
    hideTagAndRootFolderThumbnailMenuButton: false,
    hideFileThumbnailMenuButton: false,
    previewMediaUsePaneBackground: false,
    mediaThumbnails: MEDIA_THUMBNAILS_DEFAULT,
    thumbnailEdits: true,
    defaultThumbnailsOnly: false,
    systemNotifications: false,
    forceTitleCaps: true,
    showPositionNumbersInNames: true,
    showTagFolderSpacerRow: true,
    showSpecialContainerSpacerRow: false,
    hideFileExtensionsInFileNames: true,
    hideUnderscoresInFileNames: true,
    hideBeforeLastDashInFileNames: true,
    hideAfterFirstUnderscoreInFileNames: true,
    clickSelectedRotatingThumbTeleports: false,
    previewFileThumbnailTitleSize: "small",
    previewRootFolderThumbnailTitleSize: "small",
    previewSubfolderThumbnailTitleSize: "small",
    previewTagThumbnailTitleSize: "small",
    glassDiffusion: GLASS_DIFFUSION_DEFAULT,
    fullResThumbnails: FULL_QUALITY_THUMBNAILS_DEFAULT,
    thumbnailStyle: "cropped",
    thumbnailScaleCropped: "row7",
    thumbnailScaleAspect: "row7",
    collapsedSections: {},
  };
  for (let i = 0; i < NOTIFICATION_SOURCE_SPECS.length; i++) {
    out[NOTIFICATION_SOURCE_SPECS[i].optionKey] = true;
  }
  Object.assign(out, buildDefaultThumbnailVisibilityOptions());
  return out;
}

function normalizeOptions(o) {
  const d = defaultOptions();
  const src = o && typeof o === "object" ? o : {};
  const activeAppearancePresetId =
    String(src.activeAppearancePresetId || "").trim() || null;
  const normalizeOptionalClampedNumber = (value, min, max) => {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return clampNumber(parsed, min, max, 0);
  };
  const firstPresentOptionValue = (...keys) => {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      const value = src[key];
      if (value == null || value === "") continue;
      return value;
    }
    return keys.length ? src[keys[0]] : null;
  };
  const hueShiftOverlayEnabled = true;
  const hueShiftOverlayIntensity = normalizeOptionalClampedNumber(
    src.hueShiftOverlayIntensity,
    -180,
    180,
  );
  const saturationOverlayEnabled = true;
  const saturationOverlayIntensity = normalizeOptionalClampedNumber(
    src.saturationOverlayIntensity,
    -1,
    3,
  );
  const contrastOverlayEnabled = true;
  const contrastOverlayIntensity = normalizeOptionalClampedNumber(
    src.contrastOverlayIntensity,
    -0.75,
    2,
  );
  const brightnessOverlayEnabled = true;
  const brightnessOverlayIntensity = normalizeOptionalClampedNumber(
    src.brightnessOverlayIntensity,
    -0.6,
    1.5,
  );
  const warmthOverlayEnabled = true;
  const warmthOverlayIntensity = normalizeOptionalClampedNumber(
    firstPresentOptionValue(
      "warmthOverlayIntensity",
      "temperatureOverlayIntensity",
    ),
    -1,
    1,
  );
  const colorCrushOverlayEnabled = true;
  const colorCrushOverlayIntensity = normalizeOptionalClampedNumber(
    src.colorCrushOverlayIntensity,
    0,
    2,
  );
  const blackCrushOverlayEnabled = true;
  const blackCrushOverlayIntensity = normalizeOptionalClampedNumber(
    src.blackCrushOverlayIntensity,
    0,
    0.8,
  );
  const whiteCrushOverlayEnabled = true;
  const whiteCrushOverlayIntensity = normalizeOptionalClampedNumber(
    src.whiteCrushOverlayIntensity,
    0,
    0.8,
  );
  const halationOverlayEnabled = true;
  const halationOverlayIntensity = normalizeOptionalClampedNumber(
    src.halationOverlayIntensity,
    0,
    1,
  );
  const ghostingOverlayEnabled = true;
  const ghostingOverlayIntensity = normalizeOptionalClampedNumber(
    src.ghostingOverlayIntensity,
    0,
    1,
  );
  const lineDamageOverlayEnabled = true;
  const lineDamageOverlayIntensity = normalizeOptionalClampedNumber(
    src.lineDamageOverlayIntensity,
    0,
    1,
  );
  const pixelateOverlayEnabled = true;
  const pixelateOverlayIntensity = normalizeOptionalClampedNumber(
    src.pixelateOverlayIntensity,
    1,
    16,
  );
  const blurOverlayEnabled = true;
  const blurOverlayIntensity = normalizeOptionalClampedNumber(
    src.blurOverlayIntensity,
    0,
    8,
  );
  const upscaleSmoothingOverlayEnabled = true;
  const upscaleSmoothingOverlayIntensity = normalizeOptionalClampedNumber(
    firstPresentOptionValue(
      "upscaleSmoothingOverlayIntensity",
      "upscalerOverlayIntensity",
    ),
    0,
    1,
  );
  const upscalerOverlayEnabled = true;
  const upscalerOverlayIntensity = normalizeOptionalClampedNumber(
    src.upscalerOverlayIntensity,
    0,
    1,
  );
  const chromaOverlayEnabled = true;
  const chromaOverlayIntensity = normalizeOptionalClampedNumber(
    src.chromaOverlayIntensity,
    0,
    8,
  );
  const grainOverlayEnabled = true;
  const grainOverlayIntensity = normalizeOptionalClampedNumber(
    src.grainOverlayIntensity,
    0,
    0.5,
  );
  const vignetteOverlayEnabled = true;
  const vignetteOverlayIntensity = normalizeOptionalClampedNumber(
    src.vignetteOverlayIntensity,
    0,
    0.6,
  );
  const filmCornerOverlayEnabled = true;
  const filmCornerOverlayIntensity = normalizeOptionalClampedNumber(
    src.filmCornerOverlayIntensity,
    0,
    0.25,
  );
  const notificationOptionValues = {};
  for (let i = 0; i < NOTIFICATION_SOURCE_SPECS.length; i++) {
    const spec = NOTIFICATION_SOURCE_SPECS[i];
    notificationOptionValues[spec.optionKey] =
      typeof src[spec.optionKey] === "boolean" ? src[spec.optionKey] : true;
  }
  const thumbnailStyleRaw = String(src.thumbnailStyle || "")
    .trim()
    .toLowerCase();
  const thumbnailStyle = ENABLE_ASPECT_RATIO_THUMBNAIL_STYLE
    ? thumbnailStyleRaw === "cropped" || thumbnailStyleRaw === "aspect"
      ? thumbnailStyleRaw
      : typeof src.betaAspectRatioThumbCards === "boolean" &&
          src.betaAspectRatioThumbCards
        ? "aspect"
        : d.thumbnailStyle
    : "cropped";
  const colorScheme = "retro";
  const videoAudioRaw = String(
    src.videoAudio ?? src.videoGallery ?? src.videoPreview ?? "",
  )
    .trim()
    .toLowerCase();
  const videoAudio =
    videoAudioRaw === "muted" || videoAudioRaw === "unmuted"
      ? videoAudioRaw
      : d.videoAudio;
  // Video settings are retired as user-configurable options: skip is fixed at
  // 10 seconds and playback always loops. (The stored/raw values are ignored,
  // same pattern as previewMode below.)
  const videoSkipStep = "10";
  const videoEndBehavior = "loop";
  const previewModeRaw = String(src.previewMode || "")
    .trim()
    .toLowerCase();
  const previewMode = "grid";
  const imageThumbSize = normalizeThumbRenderModeValue(
    src.imageThumbSize,
    d.imageThumbSize,
  );
  const videoThumbSize = normalizeThumbRenderModeValue(
    src.videoThumbSize,
    d.videoThumbSize,
  );
  const thumbnailScaleCropped = normalizeThumbnailScaleValue(
    src.thumbnailScaleCropped,
    d.thumbnailScaleCropped,
  );
  const thumbnailScaleAspect = normalizeThumbnailScaleValue(
    src.thumbnailScaleAspect,
    d.thumbnailScaleAspect,
  );
  const previewFileThumbnailTitleSize = "small";
  const previewRootFolderThumbnailTitleSize = "small";
  const previewSubfolderThumbnailTitleSize = "small";
  const previewTagThumbnailTitleSize = "small";
  const legacyShowFolderThumbnailTitles = true;
  const __legacyShowFolderThumbnailTitlesDisabled =
    typeof src.showFolderThumbnailTitles === "boolean"
      ? src.showFolderThumbnailTitles
      : typeof src.showThumbnailTitle === "boolean"
        ? src.showThumbnailTitle
        : typeof src.showRealItemThumbnailTitles === "boolean"
          ? src.showRealItemThumbnailTitles
          : typeof src.hideThumbnailTitle === "boolean"
            ? !src.hideThumbnailTitle
            : d.showFolderThumbnailTitles;
  const showScores =
    typeof src.showScores === "boolean"
      ? src.showScores
      : typeof src.hideFolderScores === "boolean"
        ? !src.hideFolderScores
        : d.showScores;
  const showFolderItemCount =
    typeof src.showFolderItemCount === "boolean"
      ? src.showFolderItemCount
      : d.showFolderItemCount;
  const showFolderSize =
    typeof src.showFolderSize === "boolean"
      ? src.showFolderSize
      : d.showFolderSize;
  const showItemTypeLabel =
    typeof src.showItemTypeLabel === "boolean"
      ? src.showItemTypeLabel
      : d.showItemTypeLabel;
  const showRootFolderThumbnailTitles = true;
  const __showRootFolderThumbnailTitlesDisabled =
    typeof src.showRootFolderThumbnailTitles === "boolean"
      ? src.showRootFolderThumbnailTitles
      : legacyShowFolderThumbnailTitles;
  const showSubfolderThumbnailTitles = true;
  const __showSubfolderThumbnailTitlesDisabled =
    typeof src.showSubfolderThumbnailTitles === "boolean"
      ? src.showSubfolderThumbnailTitles
      : legacyShowFolderThumbnailTitles;
  const showFileThumbnailTitles = true;
  const __showFileThumbnailTitlesDisabled =
    typeof src.showFileThumbnailTitles === "boolean"
      ? src.showFileThumbnailTitles
      : typeof src.showThumbnailTitle === "boolean"
        ? src.showThumbnailTitle
        : typeof src.showRealItemThumbnailTitles === "boolean"
          ? src.showRealItemThumbnailTitles
          : typeof src.hideThumbnailTitle === "boolean"
            ? !src.hideThumbnailTitle
            : d.showFileThumbnailTitles;
  const showTagThumbnailTitles = true;
  const __showTagThumbnailTitlesDisabled =
    typeof src.showTagThumbnailTitles === "boolean"
      ? src.showTagThumbnailTitles
      : typeof src.showThumbnailTitle === "boolean"
        ? src.showThumbnailTitle
        : typeof src.hideThumbnailTitle === "boolean"
          ? !src.hideThumbnailTitle
          : d.showTagThumbnailTitles;
  const hideRootFolderThumbnailMenuButton = false;
  const __hideRootFolderThumbnailMenuButtonDisabled =
    typeof src.hideRootFolderThumbnailMenuButton === "boolean"
      ? src.hideRootFolderThumbnailMenuButton
      : d.hideRootFolderThumbnailMenuButton;
  const hideSubfolderThumbnailMenuButton = false;
  const __hideSubfolderThumbnailMenuButtonDisabled =
    typeof src.hideSubfolderThumbnailMenuButton === "boolean"
      ? src.hideSubfolderThumbnailMenuButton
      : d.hideSubfolderThumbnailMenuButton;
  const hideTagAndRootFolderThumbnailMenuButton = false;
  const __hideTagAndRootFolderThumbnailMenuButtonDisabled =
    typeof src.hideTagAndRootFolderThumbnailMenuButton === "boolean"
      ? src.hideTagAndRootFolderThumbnailMenuButton
      : d.hideTagAndRootFolderThumbnailMenuButton;
  const hideFileThumbnailMenuButton = false;
  const __hideFileThumbnailMenuButtonDisabled =
    typeof src.hideFileThumbnailMenuButton === "boolean"
      ? src.hideFileThumbnailMenuButton
      : d.hideFileThumbnailMenuButton;
  const normalizedThumbnailVisibility = normalizeThumbnailVisibilityOptions(
    src,
    {
      itemCount: showFolderItemCount,
      folderCount: showFolderItemCount,
      fileCount: showFolderItemCount,
      size: showFolderSize,
      score: showScores,
      itemType: showItemTypeLabel,
      previewTitles: {
        file: showFileThumbnailTitles,
        rootFolder: showRootFolderThumbnailTitles,
        subfolder: showSubfolderThumbnailTitles,
        tag: showTagThumbnailTitles,
      },
      previewMenuButtons: {
        file: !hideFileThumbnailMenuButton,
        rootFolder: !hideRootFolderThumbnailMenuButton,
        subfolder: !hideSubfolderThumbnailMenuButton,
        tag: !hideTagAndRootFolderThumbnailMenuButton,
      },
    },
  );
  const collapsedSections = (() => {
    const raw =
      src && typeof src.collapsedSections === "object" && src.collapsedSections
        ? src.collapsedSections
        : {};
    const sanitized = {};
    for (const k in raw) {
      if (raw[k]) sanitized[String(k)] = true;
    }
    return sanitized;
  })();
  const out = {
    collapsedSections,
    videoAudio,
    imageThumbSize,
    videoThumbSize,
    betaDirFileThumbFullCard: true,
    betaDirFolderSquareCard: true,
    previewMode,
    videoSkipStep,
    preloadNextMode:
      src.preloadNextMode === "off" ||
      src.preloadNextMode === "on" ||
      src.preloadNextMode === "ultra"
        ? src.preloadNextMode
        : d.preloadNextMode,
    videoEndBehavior,
    // Basics -> Duration. Only the duration is stored: whether the slideshow
    // is on is WS.view state, so it is off at every launch.
    slideshowDuration: normalizeSlideshowDurationValue(
      src.slideshowDuration,
      d.slideshowDuration,
    ),
    colorScheme,
    appTheme: normalizeAppThemeValue(src.appTheme, d.appTheme),
    uiTint: normalizeUiTintValue(src.uiTint),
    uiHighlight: normalizeUiHighlightValue(src.uiHighlight),
    appMenuDistance: normalizeAppMenuDistanceValue(src.appMenuDistance, d.appMenuDistance),
    appMenuHeight: normalizeAppMenuHeightValue(src.appMenuHeight, d.appMenuHeight),
    appMenuPlacement: normalizeAppMenuPlacementValue(src.appMenuPlacement, d.appMenuPlacement),
    bubbleTint: normalizeBubbleTintValue(src.bubbleTint, d.bubbleTint),
    showFileNames:
      typeof src.showFileNames === "boolean" ? src.showFileNames : d.showFileNames,
    menuPaneWidthPx: (function () {
      const v = parseFloat(src.menuPaneWidthPx);
      if (Number.isFinite(v)) return Math.max(280, Math.min(720, v));
      return d.menuPaneWidthPx;
    })(),
    thumbnailSize:
      src.thumbnailSize === "small" ||
      src.thumbnailSize === "medium" ||
      src.thumbnailSize === "large"
        ? src.thumbnailSize
        : d.thumbnailSize,
    includeHiddenItemsInStats:
      typeof src.includeHiddenItemsInStats === "boolean"
        ? src.includeHiddenItemsInStats
        : d.includeHiddenItemsInStats,
    showHiddenFolder:
      typeof src.showHiddenFolder === "boolean"
        ? src.showHiddenFolder
        : typeof src.treatHiddenAsFolder === "boolean"
          ? src.treatHiddenAsFolder
          : d.showHiddenFolder,
    showTrashFolder:
      typeof src.showTrashFolder === "boolean"
        ? src.showTrashFolder
        : d.showTrashFolder,
    showStorageFolder:
      typeof src.showStorageFolder === "boolean"
        ? src.showStorageFolder
        : d.showStorageFolder,
    storeImageFiles:
      typeof src.storeImageFiles === "boolean"
        ? src.storeImageFiles
        : d.storeImageFiles,
    storeVideoFiles:
      typeof src.storeVideoFiles === "boolean"
        ? src.storeVideoFiles
        : d.storeVideoFiles,
    muteMessages:
      typeof src.muteMessages === "boolean"
        ? src.muteMessages
        : d.muteMessages,
    quickNavigation:
      typeof src.quickNavigation === "boolean"
        ? src.quickNavigation
        : d.quickNavigation,
    showTopBar:
      typeof src.showTopBar === "boolean" ? src.showTopBar : d.showTopBar,
    typeIconPlacement: normalizeTypeIconPlacementValue(
      src.typeIconPlacement,
      d.typeIconPlacement,
    ),
    scorePlacement: normalizeScorePlacementValue(
      src.scorePlacement,
      d.scorePlacement,
    ),
    // Randomize model / set / file order. Only their own controls write them.
    randomOrderModels: src.randomOrderModels === true,
    randomOrderSets: src.randomOrderSets === true,
    randomOrderFiles: src.randomOrderFiles === true,
    // The single "Score is at least" it replaced counted only folders that
    // hold media, which are the Sets, so an old value becomes the Set filter.
    minSetScoreFilter: normalizeMinScoreFilterValue(
      src.minSetScoreFilter !== undefined
        ? src.minSetScoreFilter
        : src.minScoreFilter,
    ),
    minModelScoreFilter: normalizeMinScoreFilterValue(src.minModelScoreFilter),
    showUntaggedFolder:
      typeof src.showUntaggedFolder === "boolean"
        ? src.showUntaggedFolder
        : d.showUntaggedFolder,
    showAllTagsFolder:
      typeof src.showAllTagsFolder === "boolean"
        ? src.showAllTagsFolder
        : d.showAllTagsFolder,
    showAllModelsFolder:
      typeof src.showAllModelsFolder === "boolean"
        ? src.showAllModelsFolder
        : d.showAllModelsFolder,
    showAllSetsFolder:
      typeof src.showAllSetsFolder === "boolean"
        ? src.showAllSetsFolder
        : d.showAllSetsFolder,
    // One switch for all six utility containers. A library from before it
    // existed keeps them showing if it was showing any of them.
    showUtilityContainers:
      typeof src.showUtilityContainers === "boolean"
        ? src.showUtilityContainers
        : [
              "showTrashFolder",
              "showStorageFolder",
              "showUntaggedFolder",
              "showAllTagsFolder",
              "showAllModelsFolder",
              "showAllSetsFolder",
            ].some((key) => typeof src[key] === "boolean")
          ? [
              "showTrashFolder",
              "showStorageFolder",
              "showUntaggedFolder",
              "showAllTagsFolder",
              "showAllModelsFolder",
              "showAllSetsFolder",
            ].some((key) => src[key] === true)
          : d.showUtilityContainers,
    musicShuffle:
      typeof src.musicShuffle === "boolean" ? src.musicShuffle : d.musicShuffle,
    musicRepeat:
      typeof src.musicRepeat === "boolean" ? src.musicRepeat : d.musicRepeat,
    appVolume: normalizeAppVolumeValue(src.appVolume, d.appVolume),
    showScores,
    showFolderItemCount,
    showFolderSize,
    showItemTypeLabel,
    showFolderThumbnailTitles: legacyShowFolderThumbnailTitles,
    showRootFolderThumbnailTitles,
    showSubfolderThumbnailTitles,
    showFileThumbnailTitles,
    showTagThumbnailTitles,
    hideRootFolderThumbnailMenuButton,
    hideSubfolderThumbnailMenuButton,
    hideTagAndRootFolderThumbnailMenuButton,
    hideFileThumbnailMenuButton,
    // Preview media always sits on a black background; toggle was removed.
    previewMediaUsePaneBackground: false,
    imageThumbSize: "placeholder",
    videoThumbSize: "placeholder",
    forceTitleCaps:
      typeof src.forceTitleCaps === "boolean"
        ? src.forceTitleCaps
        : d.forceTitleCaps,
    showPositionNumbersInNames:
      typeof src.showPositionNumbersInNames === "boolean"
        ? src.showPositionNumbersInNames
        : d.showPositionNumbersInNames,
    showTagFolderSpacerRow:
      typeof src.showTagFolderSpacerRow === "boolean"
        ? src.showTagFolderSpacerRow
        : d.showTagFolderSpacerRow,
    showSpecialContainerSpacerRow:
      typeof src.showSpecialContainerSpacerRow === "boolean"
        ? src.showSpecialContainerSpacerRow
        : d.showSpecialContainerSpacerRow,
    hideFileExtensionsInFileNames:
      typeof src.hideFileExtensionsInFileNames === "boolean"
        ? src.hideFileExtensionsInFileNames
        : d.hideFileExtensionsInFileNames,
    hideUnderscoresInFileNames:
      typeof src.hideUnderscoresInFileNames === "boolean"
        ? src.hideUnderscoresInFileNames
        : d.hideUnderscoresInFileNames,
    hideBeforeLastDashInFileNames:
      typeof src.hideBeforeLastDashInFileNames === "boolean"
        ? src.hideBeforeLastDashInFileNames
        : d.hideBeforeLastDashInFileNames,
    hideAfterFirstUnderscoreInFileNames:
      typeof src.hideAfterFirstUnderscoreInFileNames === "boolean"
        ? src.hideAfterFirstUnderscoreInFileNames
        : d.hideAfterFirstUnderscoreInFileNames,
    clickSelectedRotatingThumbTeleports:
      typeof src.clickSelectedRotatingThumbTeleports === "boolean"
        ? src.clickSelectedRotatingThumbTeleports
        : d.clickSelectedRotatingThumbTeleports,
    previewFileThumbnailTitleSize,
    previewRootFolderThumbnailTitleSize,
    previewSubfolderThumbnailTitleSize,
    previewTagThumbnailTitleSize,
    glassDiffusion: getGlassDiffusionFromOptions(src),
    fullResThumbnails:
      typeof src.fullResThumbnails === "boolean"
        ? src.fullResThumbnails
        : d.fullResThumbnails,
    mediaThumbnails:
      typeof src.mediaThumbnails === "boolean"
        ? src.mediaThumbnails
        : d.mediaThumbnails,
    thumbnailEdits:
      typeof src.thumbnailEdits === "boolean"
        ? src.thumbnailEdits
        : d.thumbnailEdits,
    defaultThumbnailsOnly:
      typeof src.defaultThumbnailsOnly === "boolean"
        ? src.defaultThumbnailsOnly
        : d.defaultThumbnailsOnly,
    systemNotifications:
      typeof src.systemNotifications === "boolean"
        ? src.systemNotifications
        : d.systemNotifications,
    thumbnailStyle,
    thumbnailScaleCropped,
    thumbnailScaleAspect,
    leftPaneWidthPct: (function () {
      const v = parseFloat(src.leftPaneWidthPct);
      if (Number.isFinite(v)) return Math.max(0.05, Math.min(0.9, v));
      return 0.28;
    })(),
    /* Media filters: UI */
    mediaFilter: "off",
    mediaFilterIntensity: 1,
    activeAppearancePresetId,
    hueShiftOverlayEnabled,
    hueShiftOverlayIntensity,
    saturationOverlayEnabled,
    saturationOverlayIntensity,
    contrastOverlayEnabled,
    contrastOverlayIntensity,
    brightnessOverlayEnabled,
    brightnessOverlayIntensity,
    warmthOverlayEnabled,
    warmthOverlayIntensity,
    colorCrushOverlayEnabled,
    colorCrushOverlayIntensity,
    blackCrushOverlayEnabled,
    blackCrushOverlayIntensity,
    whiteCrushOverlayEnabled,
    whiteCrushOverlayIntensity,
    halationOverlayEnabled,
    halationOverlayIntensity,
    animatedMediaFilters: normalizeAnimatedMediaFiltersValue(
      src.animatedMediaFilters,
      d.animatedMediaFilters,
    ),
    ghostingOverlayEnabled,
    ghostingOverlayIntensity,
    lineDamageOverlayEnabled,
    lineDamageOverlayIntensity,
    pixelateOverlayEnabled,
    pixelateOverlayIntensity,
    blurOverlayEnabled,
    blurOverlayIntensity,
    upscaleSmoothingOverlayEnabled,
    upscaleSmoothingOverlayIntensity,
    upscalerOverlayEnabled,
    upscalerOverlayIntensity,
    chromaOverlayEnabled,
    chromaOverlayIntensity,
    grainOverlayEnabled,
    grainOverlayIntensity,
    vignetteOverlayEnabled,
    vignetteOverlayIntensity,
    filmCornerOverlayEnabled,
    filmCornerOverlayIntensity,
  };
  Object.assign(out, notificationOptionValues);
  Object.assign(out, normalizedThumbnailVisibility);
  return out;
}

function normalizeMinScoreFilterValue(raw) {
  if (raw == null || raw === "" || raw === "off") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

// Called by normalizeOptions, which runs before this block is reached at load,
// so it must not read APP_VOLUME_STEP (still uninitialised then).
function normalizeAppVolumeValue(value, fallback = 100) {
  const step = 5;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n / step) * step));
}

// Basics -> Duration: seconds as a string, or "cycle". Called by
// normalizeOptions at load, so it lists its values itself rather than reading
// SLIDESHOW_DURATION_CYCLE (declared in a later file).
function normalizeSlideshowDurationValue(value, fallback = "5") {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  return ["1", "3", "5", "10", "20", "cycle"].includes(raw) ? raw : fallback;
}
