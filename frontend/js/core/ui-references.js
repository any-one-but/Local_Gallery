/* UI references
   Element lookups, pane widths, the dividers and the transient UI state shared
   across the app. getQuadPlaybackSlots is here because setupDivider needs it
   at load; the preview ResizeObserver is set up in boot.js. */

/* =========================================================
       UI references
       ========================================================= */

const $ = (id) => document.getElementById(id);

// Title Pane
const optionsBtn = $("optionsBtn");
const refreshBtn = $("refreshBtn");
const openWritableBtn = $("openWritableBtn");
const openWritableInput = $("openWritableInput");
const titleLabel = $("titleLabel");
const titleInfo = $("titleInfo");

// Menu Overlay
const menuOverlay = $("menuOverlay");
const menuCard = $("menuCard");
const menuHeader = $("menuHeader");
const menuTabs = $("menuTabs");
const menuDivider = $("menuDivider");
const menuTabKeybinds = $("menuTabKeybinds");
const menuTabCalendar = $("menuTabCalendar");

const optionsBodyEl = $("optionsBody");
const optionsDoneBtn = $("optionsDoneBtn");
const optionsStatusLabel = $("optionsStatusLabel");

// Keybinds Panel
const keybindsBodyEl = $("keybindsBody");
const keybindsResetBtn = $("keybindsResetBtn");
const keybindsOpenWritableBtn = $("keybindsOpenWritableBtn");
const keybindsStatusLabel = $("keybindsStatusLabel");
const keybindHelpOverlayEl = $("keybindHelpOverlay");
const keybindHelpBodyEl = $("keybindHelpBody");
const keybindHelpCloseBtn = $("keybindHelpCloseBtn");
const calendarBodyEl = $("calendarBody");
const calendarOpenWritableBtn = $("calendarOpenWritableBtn");
const calendarDeleteAllBtn = $("calendarDeleteAllBtn");
const calendarStatusLabel = $("calendarStatusLabel");

let keybindHelpPreviousFocusEl = null;

function keybindHelpIsOpen() {
  return !!(
    keybindHelpOverlayEl && keybindHelpOverlayEl.classList.contains("active")
  );
}

function currentKeybindHelpBindings() {
  const paneBindings =
    WS.meta && Array.isArray(WS.meta.keybinds)
      ? syncPaneKeybindBindingsWithCurrentActions(false)
      : defaultKeybinds(WS.meta && WS.meta.appearancePresets);
  const gridBindings =
    WS.meta && Array.isArray(WS.meta.gridKeybinds)
      ? WS.meta.gridKeybinds
      : defaultGridKeybinds();
  const gridById = new Map(
    gridBindings.map((binding) => [String(binding?.id || ""), binding]),
  );
  const normalizedGridBindings = GRID_KEYBIND_ACTIONS.map((action) =>
    Object.assign({}, action, gridById.get(action.id) || {}),
  );
  return {
    pane: paneBindings.filter(
      (binding) =>
        binding &&
        !binding.hiddenInUi &&
        !appItemMenuActionKeybindIsDisabled(binding.id) &&
        !isLockedKeybindAction(binding.id),
    ),
    grid: normalizedGridBindings.filter((binding) => binding && binding.id),
  };
}

function renderKeybindHelpOverlay() {
  if (!keybindHelpBodyEl) return;
  const bindings = currentKeybindHelpBindings();
  const bySection = new Map();
  for (const binding of bindings.pane.concat(bindings.grid)) {
    const sectionId = String(binding.section || "");
    if (!bySection.has(sectionId)) bySection.set(sectionId, []);
    bySection.get(sectionId).push(binding);
  }
  const sectionSpecs = KEYBIND_SECTIONS.concat(GRID_KEYBIND_SECTIONS);
  keybindHelpBodyEl.innerHTML = sectionSpecs
    .map((section) => {
      const sectionBindings = bySection.get(section.id) || [];
      if (!sectionBindings.length) return "";
      const rows = sectionBindings
        .map((binding) => {
          const normalizedKey = normalizeKeyValue(binding.key || "");
          const label = normalizedKey ? keyLabel(normalizedKey) : "Unassigned";
          return `<div class="keybindHelpRow"><span class="keybindHelpAction">${escapeHtml(binding.label || binding.id)}</span><span class="keybindHelpKey${normalizedKey ? "" : " unassigned"}" title="${escapeHtml(label)}">${escapeHtml(label)}</span></div>`;
        })
        .join("");
      return `<section class="keybindHelpSection"><h3 class="keybindHelpSectionTitle">${escapeHtml(section.label)}</h3>${rows}</section>`;
    })
    .join("");
}

function showKeybindHelpOverlay() {
  if (!keybindHelpOverlayEl) return false;
  renderKeybindHelpOverlay();
  keybindHelpPreviousFocusEl = document.activeElement;
  keybindHelpOverlayEl.classList.add("active");
  keybindHelpOverlayEl.setAttribute("aria-hidden", "false");
  try {
    keybindHelpCloseBtn?.focus();
  } catch {}
  return true;
}

function hideKeybindHelpOverlay() {
  if (!keybindHelpOverlayEl) return false;
  const wasOpen = keybindHelpIsOpen();
  keybindHelpOverlayEl.classList.remove("active");
  keybindHelpOverlayEl.setAttribute("aria-hidden", "true");
  if (wasOpen && keybindHelpPreviousFocusEl?.isConnected) {
    try {
      keybindHelpPreviousFocusEl.focus();
    } catch {}
  }
  keybindHelpPreviousFocusEl = null;
  return wasOpen;
}

function toggleKeybindHelpOverlay() {
  return keybindHelpIsOpen()
    ? hideKeybindHelpOverlay()
    : showKeybindHelpOverlay();
}

if (keybindHelpCloseBtn) {
  keybindHelpCloseBtn.addEventListener("click", () => {
    hideKeybindHelpOverlay();
  });
}
if (keybindHelpOverlayEl) {
  keybindHelpOverlayEl.addEventListener("click", (e) => {
    if (e.target === keybindHelpOverlayEl) hideKeybindHelpOverlay();
  });
}

function defaultMenuPaneWidth() {
  return Math.max(340, Math.min(496, Math.round(window.innerWidth * 0.32)));
}

function applyMenuPaneWidthFromOptions() {
  if (!menuOverlay) return;
  // The floating in-app window sizes itself; the pane width only applies to the
  // legacy Settings-only window.
  if (!IS_SETTINGS_WINDOW) return;
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const raw = Number(opt && opt.menuPaneWidthPx);
  const contentWidth = Math.max(
    0,
    Number(
      previewContentEl?.clientWidth ||
        previewPane?.clientWidth ||
        window.innerWidth,
    ) || 0,
  );
  const maxWidth = Math.max(320, Math.min(760, contentWidth - 220));
  const width = Number.isFinite(raw)
    ? Math.max(320, Math.min(maxWidth, raw))
    : defaultMenuPaneWidth();
  menuOverlay.style.width = `${Math.round(width)}px`;
}

function setMenuPaneWidthPx(widthPx, save = true) {
  if (!menuOverlay || !WS.meta) return 0;
  // No-op for the floating in-app window (it manages its own geometry).
  if (!IS_SETTINGS_WINDOW) return 0;
  const contentWidth = Math.max(
    0,
    Number(
      previewContentEl?.clientWidth ||
        previewPane?.clientWidth ||
        window.innerWidth,
    ) || 0,
  );
  const maxWidth = Math.max(320, Math.min(760, contentWidth - 220));
  const nextWidth = Math.max(
    320,
    Math.min(maxWidth, Math.round(Number(widthPx) || defaultMenuPaneWidth())),
  );
  menuOverlay.style.width = `${nextWidth}px`;
  if (!save) return nextWidth;
  if (Math.abs(nextWidth - Number(WS.meta.options?.menuPaneWidthPx || 0)) >= 1) {
    WS.meta.options = normalizeOptions(
      Object.assign({}, WS.meta.options || {}, { menuPaneWidthPx: nextWidth }),
    );
    metaMarkDirty(META_DOC_IDS.prefGeneral);
    metaScheduleSave();
  }
  return nextWidth;
}

function getDirectoriesPaneWidthPxFromOptions() {
  const appEl = document.getElementById("app");
  const appWidth = Math.max(
    1,
    Number(appEl?.clientWidth || window.innerWidth) || 1,
  );
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const rawPct =
    opt && typeof opt.leftPaneWidthPct === "number"
      ? opt.leftPaneWidthPct
      : parseFloat(opt?.leftPaneWidthPct);
  const pct = Number.isFinite(rawPct) ? Math.max(0.05, Math.min(0.9, rawPct)) : 0.3;
  const min = Math.max(220, Math.round(appWidth * 0.14));
  const max = Math.max(min + 50, appWidth - 200);
  return Math.max(min, Math.min(max, Math.round(appWidth * pct)));
}

function currentFilePaneWidthSnapshotPx() {
  const rectWidth = Math.round(
    Number(
      directoriesPane?.getBoundingClientRect
        ? directoriesPane.getBoundingClientRect().width
        : directoriesPane?.offsetWidth || 0,
    ) || 0,
  );
  if (rectWidth > 0) return rectWidth;
  return getDirectoriesPaneWidthPxFromOptions();
}

function rememberClosedFilePaneWidthSnapshot() {
  if (!WS.view) return 0;
  const width = currentFilePaneWidthSnapshotPx();
  if (Number.isFinite(width) && width > 0) {
    WS.view.closedFilePaneWidthPx = Math.round(width);
  }
  return Math.max(0, Number(WS.view.closedFilePaneWidthPx) || 0);
}

function setDirectoriesPaneWidthPx(widthPx, save = true) {
  if (!WS.meta) return 0;
  const appEl = document.getElementById("app");
  const appWidth = Math.max(
    1,
    Number(appEl?.clientWidth || window.innerWidth) || 1,
  );
  const min = Math.max(220, Math.round(appWidth * 0.14));
  const max = Math.max(min + 50, appWidth - 200);
  const nextWidth = Math.max(
    min,
    Math.min(max, Math.round(Number(widthPx) || appWidth * 0.28)),
  );
  const nextPct = nextWidth / appWidth;
  if (save) {
    const prevPct = Number(WS.meta.options?.leftPaneWidthPct || 0);
    if (Math.abs(nextPct - prevPct) >= 0.0005) {
      WS.meta.options = normalizeOptions(
        Object.assign({}, WS.meta.options || {}, {
          leftPaneWidthPct: nextPct,
        }),
      );
      metaMarkDirty(META_DOC_IDS.prefGeneral);
      metaScheduleSave();
    }
  }
  setDividerPositionFromPct(nextPct);
  return nextWidth;
}

function menuPaneDividerWidthPx() {
  if (!MENU_OPEN) return 0;
  const raw = Number(menuDivider?.offsetWidth || 8);
  if (!Number.isFinite(raw) || raw < 0) return 8;
  return Math.round(raw);
}

function syncSidePaneWidthsToSmallerSide() {
  if (!WS.meta) return;
  const dividerPx = menuPaneDividerWidthPx();
  const currentMenuOccupied = Math.max(
    0,
    Number(
      WS.meta.options && Number.isFinite(Number(WS.meta.options.menuPaneWidthPx))
        ? WS.meta.options.menuPaneWidthPx
        : defaultMenuPaneWidth(),
    ) || defaultMenuPaneWidth(),
  ) + dividerPx;
  const targetPx = Math.min(
    getDirectoriesPaneWidthPxFromOptions(),
    currentMenuOccupied,
  );
  const targetMenuWidth = Math.max(280, Math.round(targetPx - dividerPx));
  const appliedMenuWidth =
    setMenuPaneWidthPx(targetMenuWidth, true) ||
    Math.round(Number(menuOverlay?.offsetWidth || targetMenuWidth));
  const finalWidth = Math.max(
    280,
    Math.round(
      Number(menuOverlay?.offsetWidth || appliedMenuWidth || targetMenuWidth),
    ) + dividerPx,
  );
  setDirectoriesPaneWidthPx(finalWidth, true);
  syncPreviewContentLayoutAfterMenuToggle();
}


function rootLandingClampNumber(value, min, max, fallback) {
  const n = Number(value);
  const base = Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, base));
}

function measureNoWrapElementWidthPx(el) {
  if (!el || !document || !document.body) return 0;
  const clone = el.cloneNode(true);
  if (!clone) return 0;
  clone.removeAttribute("id");
  clone.style.position = "fixed";
  clone.style.left = "-10000px";
  clone.style.top = "-10000px";
  clone.style.width = "auto";
  clone.style.maxWidth = "none";
  clone.style.minWidth = "0";
  clone.style.whiteSpace = "nowrap";
  clone.style.overflow = "visible";
  clone.style.textOverflow = "clip";
  clone.style.visibility = "hidden";
  clone.style.pointerEvents = "none";
  clone.style.contain = "layout style";
  document.body.appendChild(clone);
  let width = 0;
  try {
    width = Math.ceil(clone.getBoundingClientRect().width || clone.scrollWidth || 0);
  } catch (e) {
    width = 0;
  }
  try { clone.remove(); } catch (e) {}
  return Math.max(0, width);
}

function measuredElementOuterWidthPx(el) {
  if (!el) return 0;
  const rectWidth = Math.ceil(Number(el.getBoundingClientRect?.().width) || 0);
  const scrollWidth = Math.ceil(Number(el.scrollWidth) || 0);
  return Math.max(rectWidth, scrollWidth, 0);
}

function preferredMenuPaneWidthForCurrentTabPx() {
  if (!menuOverlay || !MENU_OPEN) return defaultMenuPaneWidth();
  const activePanelId =
    MENU_PANEL_BY_TAB[MENU_ACTIVE_TAB || "controls"] || "controls";
  const panel = menuTabPanels[activePanelId] || menuTabKeybinds || menuOverlay;
  if (!panel) return defaultMenuPaneWidth();
  const body =
    activePanelId === "controls"
      ? keybindsBodyEl
      : calendarBodyEl;
  const bodyStyle = body ? getComputedStyle(body) : null;
  const bodyPad = bodyStyle
    ? (parseFloat(bodyStyle.paddingLeft) || 0) + (parseFloat(bodyStyle.paddingRight) || 0)
    : 24;
  let needed = 280;

  const addTextNeed = (el, extra = 0) => {
    if (!el) return;
    const textNeed = Math.max(
      measuredElementOuterWidthPx(el),
      measureNoWrapElementWidthPx(el),
    );
    needed = Math.max(needed, textNeed + bodyPad + extra);
  };

  panel.querySelectorAll(".settingsSubsectionTitle, .keybindSubtabBtn, .optTitle, .optSelectBtnLabel, .miniBtn, button").forEach((el) => {
    addTextNeed(el, 44);
  });

  panel.querySelectorAll(".optRow").forEach((row) => {
    const style = getComputedStyle(row);
    const rowPad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const gap = parseFloat(style.columnGap || style.gap) || 10;
    const left = row.querySelector(":scope > .optLeft") || row.querySelector(".optLeft");
    const title = left ? left.querySelector(".optTitle") : null;
    const leftNeed = title
      ? Math.max(measuredElementOuterWidthPx(title), measureNoWrapElementWidthPx(title))
      : measuredElementOuterWidthPx(left);
    let rightNeed = 0;
    Array.from(row.children || []).forEach((child) => {
      if (child === left) return;
      rightNeed += measuredElementOuterWidthPx(child);
    });
    const childCount = Math.max(1, (row.children ? row.children.length : 2) - 1);
    needed = Math.max(needed, leftNeed + rightNeed + gap * childCount + rowPad + bodyPad + 30);
  });

  const footer =
    activePanelId === "controls"
      ? document.getElementById("keybindsFooter")
      : document.getElementById("calendarFooter");
  if (footer) {
    needed = Math.max(needed, measuredElementOuterWidthPx(footer) + 10);
  }
  return Math.ceil(needed);
}

function preferredDirectoriesPaneWidthForRootInfoPx() {
  const appEl = document.getElementById("app");
  const appWidth = Math.max(1, Number(appEl?.clientWidth || window.innerWidth) || 1);
  const min = Math.max(180, Math.round(appWidth * 0.12));
  if (typeof updateTitleLabel === "function") updateTitleLabel();
  let preferred = min;
  if (titleInfo) {
    preferred = Math.max(preferred, measureNoWrapElementWidthPx(titleInfo) + 28);
  }
  if (titleMain) preferred = Math.max(preferred, measuredElementOuterWidthPx(titleMain) + 20);
  if (directoriesSearchRow) preferred = Math.max(preferred, measuredElementOuterWidthPx(directoriesSearchRow) + 20);
  return Math.ceil(preferred);
}

function fitRootLandingSidePaneWidths() {
  if (!WS.root || !WS.meta) return;
  const appEl = document.getElementById("app");
  const appWidth = Math.max(1, Number(appEl?.clientWidth || window.innerWidth) || 1);
  const appHeight = Math.max(1, Number(appEl?.clientHeight || window.innerHeight) || 1);
  const dividerPx = Math.max(0, menuPaneDividerWidthPx());

  // Legacy sizing helper retained for the settings pane on root landing.
  const minPreviewWidth = Math.max(360, Math.round(appWidth * 0.36));
  const minLeft = Math.max(220, Math.min(320, Math.round(appWidth * 0.18)));
  const minMenu = Math.max(300, Math.min(380, Math.round(appWidth * 0.22)));
  const maxCombined = Math.max(
    minLeft + minMenu,
    appWidth - minPreviewWidth - dividerPx,
  );
  const targetCombined = Math.min(
    maxCombined,
    Math.max(minLeft + minMenu, Math.round(appHeight * (2 / 3))),
  );

  let leftWidth = Math.round(targetCombined * 0.47);
  let menuWidth = Math.round(targetCombined - leftWidth);
  leftWidth = Math.max(minLeft, leftWidth);
  menuWidth = Math.max(minMenu, menuWidth);

  if (leftWidth + menuWidth > maxCombined) {
    const over = leftWidth + menuWidth - maxCombined;
    const leftRoom = Math.max(0, leftWidth - minLeft);
    const menuRoom = Math.max(0, menuWidth - minMenu);
    const totalRoom = Math.max(1, leftRoom + menuRoom);
    leftWidth = Math.max(minLeft, Math.round(leftWidth - over * (leftRoom / totalRoom)));
    menuWidth = Math.max(minMenu, Math.round(menuWidth - over * (menuRoom / totalRoom)));
    if (leftWidth + menuWidth > maxCombined) {
      const remaining = Math.max(0, leftWidth + menuWidth - maxCombined);
      if (menuWidth - minMenu >= remaining) menuWidth -= remaining;
      else leftWidth = Math.max(minLeft, maxCombined - menuWidth);
    }
  }

  setMenuPaneWidthPx(menuWidth, true);
  setDirectoriesPaneWidthPx(leftWidth, true);
  syncPreviewContentLayoutAfterMenuToggle();
}

function applyDefaultRootLandingSidebars() {
  // Preview-only UI: nothing auto-opens on root landing. The settings pane
  // stays closed until explicitly opened.
  if (MENU_OPEN) fitRootLandingSidePaneWidths();
}

window.addEventListener("resize", () => {
  if (MENU_OPEN) applyMenuPaneWidthFromOptions();
  refreshPreviewGridTracks();
  refreshFitInsidePreviewGrids();
  scheduleGridModeCardSizing();
  updateGridModeListTopInset();
  scheduleDirectoriesVirtualViewportRefresh();
  schedulePreviewVirtualGridRefresh();
  scheduleThumbnailDemandRefresh();
});

// List Pane
const directoriesListEl = $("directoriesList");
const directoriesHeader = $("directoriesHeader");
const favoritesBtn = $("favoritesBtn");
const hiddenBtn = $("hiddenBtn");
const directoriesTagsRowEl = $("directoriesTagsRow");
const directoriesActionRowEl = $("directoriesActionRow");
const directoriesSelectAllBtn = $("directoriesSelectAllBtn");
const directoriesActionMenuEl = $("directoriesActionMenu");
const directoriesBulkRowEl = $("directoriesBulkRow");
const directoriesSearchInput = $("directoriesSearchInput");
const directoriesSearchClearBtn = $("directoriesSearchClearBtn");
const tagActionMenuEl = $("tagActionMenu");
if (tagActionMenuEl) {
  if (tagActionMenuEl.parentElement !== document.body) {
    document.body.appendChild(tagActionMenuEl);
  }
  tagActionMenuEl.addEventListener("click", (e) => e.stopPropagation());
}
const dirBackBtn = $("dirBackBtn");
const dirForwardBtn = $("dirForwardBtn");
const dirUpBtn = $("dirUpBtn");
const busyOverlay = $("busyOverlay");
const busyLabel = $("busyLabel");
const busyDetail = $("busyDetail");

// Preview Pane
const modePill = $("modePill");
const itemsPill = $("itemsPill");
const previewPane = $("previewPane");
const previewContentEl = $("previewContent");
const previewMainStackEl = $("previewMainStack");
const previewBodyEl = $("previewBody");
const previewActionMenuEl = $("previewActionMenu");
const appActionMenuEl = $("appActionMenu");
const controlPane = $("controlPane");
const controlPrevItemBtn = $("controlPrevItemBtn");
const controlSkipBackBtn = $("controlSkipBackBtn");
const controlPlayPauseBtn = $("controlPlayPauseBtn");
const controlSkipForwardBtn = $("controlSkipForwardBtn");
const controlNextItemBtn = $("controlNextItemBtn");
const controlMuteBtn = $("controlMuteBtn");
const controlProgressRange = $("controlProgressRange");
const controlTimecode = $("controlTimecode");
if (previewActionMenuEl) {
  previewActionMenuEl.addEventListener("click", (e) => e.stopPropagation());
}
if (appActionMenuEl) {
  if (appActionMenuEl.parentElement !== document.body) {
    document.body.appendChild(appActionMenuEl);
  }
  appActionMenuEl.addEventListener("click", (e) => e.stopPropagation());
}
directoriesListEl.addEventListener("scroll", () => {
  if (WS.view.scrollBusyDirs) return;
  scheduleDirectoriesVirtualViewportRefresh();
  scheduleThumbnailDemandRefresh();
});

/* Gallery Mode (Overlay) */
const overlay = $("overlay");
const viewport = $("viewerViewport");
const closeBtn = $("closeBtn");
const filenameEl = $("filename");

const statusMessageEl = document.createElement("div");
statusMessageEl.id = "statusMessage";
overlay.appendChild(statusMessageEl);

const mainStatusMessageEl = document.createElement("div");
mainStatusMessageEl.id = "mainStatusMessage";
document.body.appendChild(mainStatusMessageEl);

const banicOverlayEl = document.createElement("div");
banicOverlayEl.id = "banicOverlay";
document.body.appendChild(banicOverlayEl);

let VIEWER_MODE = false;
let viewerDirNode = null;
let viewerItems = []; // { isFolder, dirNode } or { isFolder:false, id }
let viewerIndex = 0;
let VIEWER_LAYOUT_MODE = "single";
let VIEWER_SKIP_DIR_SYNC_ON_CLOSE = false;
let VIEWER_CLOSE_RESTORE_STATE = null;
let uiHideTimer = null;
let globalCursorHideTimer = null;

let viewerImgEl = null;
let viewerVideoEl = null;
let viewerFolderEl = null;
let viewerQuadGridEl = null;
let viewerQuadSlots = [];
let viewerTransitionCanvas = null;
let VIEWER_TRANSITION_TOKEN = 0;
let VIEWER_TRANSITION_HIDE_TIMER = 0;
let QUAD_PLAYBACK = { active: false, fileIds: [], activeId: "", muted: false };

function getQuadPlaybackSlots() {
  return Array.isArray(viewerQuadSlots) ? viewerQuadSlots : [];
}

let DIR_HANDLE_CACHE = new Map();

let previewViewportBox = null;
let previewImgEl = null;
let PREVIEW_IMAGE_SWAP_TOKEN = 0;
let PREVIEW_SUPPRESS_STALE_FRAME_ONCE = false;
let PREVIEW_STATE_RENDER_RAF = 0;
let PREVIEW_STATE_RENDER_FILE_ID = "";
let PREVIEW_FILE_OBJECT_PROMISES = new Map();
let PREVIEW_FILE_OBJECT_WARM_TIMER = 0;
let PREVIEW_FILE_OBJECT_WARM_TOKEN = 0;
let LOADED_THUMB_RELEASE_TIMER = 0;
let previewVideoEl = null;
let previewVideoTransitionCanvas = null;
let PREVIEW_VIDEO_TRANSITION_TOKEN = 0;
let PREVIEW_VIDEO_TRANSITION_HIDE_TIMER = 0;
let PREVIEW_VIDEO_POSTER_TIMER = 0;
let PREVIEW_VIDEO_POSTER_TOKEN = 0;
let previewFolderEl = null;
const CONTROL_PANE_AUTO_HIDE_MS = 1800;
let CONTROL_PANE_HIDE_TIMER = 0;
let CONTROL_PANE_HOVER = false;
let CONTROL_PANE_DRAGGING = false;
let CONTROL_PANE_DRAG_POINTER_ID = null;
let CONTROL_PANE_DRAG_OFFSET_X = 0;
let CONTROL_PANE_DRAG_OFFSET_Y = 0;
let CONTROL_PANE_SESSION_POSITION = null;
let CONTROL_PANE_ACTIVE_KEY = "";

// Divider setup: attach drag handlers and initialize position
(function setupDivider() {
  const appEl = document.getElementById("app");
  const divider = document.getElementById("divider");
  if (!appEl || !divider) return;

  let dragging = false;
  let activePointerId = null;

  function onMoveClientX(clientX) {
    const rect = appEl.getBoundingClientRect();
    const min = Math.max(180, Math.round(rect.width * 0.12));
    const max = Math.max(min + 50, rect.width - 200);
    let left = Math.min(Math.max(clientX - rect.left, min), max);
    const pct = left / rect.width;
    if (!WS.meta.options || typeof WS.meta.options !== "object")
      WS.meta.options = normalizeOptions(null);
    WS.meta.options.leftPaneWidthPct = pct;
    metaTrackDirtyDocIds([META_DOC_IDS.prefGeneral]);
    if (typeof metaScheduleSave === "function") metaScheduleSave();
    setDividerPositionFromPct(pct);
    refreshFitInsidePreviewGrids();
    refreshActivePreviewMediaLayout();
  }

  divider.addEventListener("pointerdown", (ev) => {
    if (!directoriesPaneOpenEnabled()) return;
    ev.preventDefault();
    dragging = true;
    activePointerId = ev.pointerId;
    try {
      divider.setPointerCapture(activePointerId);
    } catch (e) {}
  });

  document.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    onMoveClientX(ev.clientX);
  });

  document.addEventListener("pointerup", (ev) => {
    if (!dragging) return;
    dragging = false;
    try {
      divider.releasePointerCapture(activePointerId);
    } catch (e) {}
    activePointerId = null;
    if (typeof metaScheduleSave === "function") metaScheduleSave();
  });

  window.addEventListener("resize", () => {
    applyPaneDividerFromOptions();
    refreshFitInsidePreviewGrids();
    refreshActivePreviewMediaLayout();
  });

  // initial apply from saved options
  applyPaneDividerFromOptions();
  applyMediaFilterFromOptions();
})();

(function setupMenuDivider() {
  if (!menuDivider || !previewContentEl || !menuOverlay) return;
  let dragging = false;
  let activePointerId = null;

  function onMoveClientX(clientX) {
    const rect = previewContentEl.getBoundingClientRect();
    const desiredWidth = rect.right - clientX;
    setMenuPaneWidthPx(desiredWidth, false);
    refreshActivePreviewMediaLayout();
  }

  menuDivider.addEventListener("pointerdown", (ev) => {
    if (!MENU_OPEN) return;
    ev.preventDefault();
    dragging = true;
    activePointerId = ev.pointerId;
    try {
      menuDivider.setPointerCapture(activePointerId);
    } catch (e) {}
  });

  document.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    onMoveClientX(ev.clientX);
  });

  document.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    try {
      menuDivider.releasePointerCapture(activePointerId);
    } catch (e) {}
    activePointerId = null;
    setMenuPaneWidthPx(menuOverlay.offsetWidth || defaultMenuPaneWidth(), true);
    refreshFitInsidePreviewGrids();
    schedulePreviewVirtualGridRefresh();
    scheduleThumbnailDemandRefresh();
    refreshActivePreviewMediaLayout();
  });
})();

let MAIN_STATUS_TIMEOUT = null;
let WORKSPACE_REFRESH_IN_FLIGHT = false;

let ACTIVE_MEDIA_SURFACE = "none";
let CONTROL_PROGRESS_DRAGGING = false;
let PREVIEW_VIDEO_USER_PAUSE_FILE_ID = null;
const RESPONSIVE_VIDEO_SEEK_STATES = new WeakMap();

let PREVIEW_VIDEO_PAUSE = {
  active: false,
  fileId: null,
  time: 0,
  wasPlaying: false,
};

let VIDEO_CARRY = { active: false, fileId: null, time: 0, wasPlaying: false };

let PRELOAD_CACHE = new Map();

const BLACK_POSTER_URL =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2' fill='black'/></svg>";

let TAG_EDIT_PATH = null;
// When true, the single-folder tag edit (TAG_EDIT_PATH) was initiated from the
// preview pane and must render only there (never in the file pane), even when
// the same folder also appears in the file pane's current directory.
let TAG_EDIT_IN_PREVIEW = false;
let TAG_CONTEXT_MENU_STATE = null;
let PREVIEW_CONTEXT_MENU_STATE = null;
let APP_MENU_STATE = null;
// The app menu's on-screen position is fixed at open time and reused for every
// in-place rebuild, so activating an option never jumps the menu (a detached
// anchor would otherwise measure as 0,0 and fling it to the top-left corner).
let APP_MENU_DOCK_POS = null;
// When set, the app menu shows an "Are You Sure?" confirmation page instead of
// its normal contents. Holds { title, message, confirmLabel, danger, resolve }.
// showAppMenuConfirm() drives it; the Yes/No buttons settle the promise.
let APP_MENU_CONFIRM = null;
let APP_MENU_FILTER_EDIT_KEY = "";
// Controls submenu edit state: the control row whose Assign/Clear options are
// open, which of those two is focused (0 = Assign, 1 = Clear), and the control
// currently waiting for a captured key.
let APP_MENU_CONTROLS_EDIT_ID = "";
let APP_MENU_CONTROLS_EDIT_BTN = 0;
let APP_MENU_CONTROLS_CAPTURE_ID = "";
// WASD (move) + QE (open/exit) + the four folder steps + Tab (settings menu)
// are hard-coded: non-editable, left out of Controls (the hold-[ page lists
// them), and their keys can't be assigned to anything else.
const APP_MENU_CONTROLS_HARDCODED_IDS = Object.freeze([
  "selectUp",
  "selectLeft",
  "selectDown",
  "selectRight",
  "leaveDir",
  "enterDir",
  "prevFolder",
  "nextFolder",
  "prevRootFolder",
  "nextRootFolder",
  "settingsMenu",
  "keyHelp",
  "openAppMenu",
]);
const APP_MENU_CONTROLS_HARDCODED_SET = new Set(APP_MENU_CONTROLS_HARDCODED_IDS);
const APP_MENU_SETTINGS_CONTROL_BINDING = Object.freeze({
  id: "settingsMenu",
  label: "Settings menu",
  hint: "Toggle the settings menu.",
  section: "folderActions",
  key: "Tab",
});
const APP_MENU_KEY_HELP_CONTROL_BINDING = Object.freeze({
  id: "keyHelp",
  label: "Show all controls (hold)",
  hint: "Hold to list every control; press ] while holding to open Controls.",
  section: "folderActions",
  key: "[",
});
const APP_MENU_DEBUG_CONTROL_BINDING = Object.freeze({
  id: "debugMode",
  label: "Debug mode",
  hint: "Show the debug panel; Option+` copies a report for a coding agent.",
  section: "folderActions",
  key: "`",
});
let APP_MENU_PRESET_RENAME_STATE = null;
let APP_MENU_PRESET_DELETE_CONFIRM_ID = "";
let SCORE_HISTORY_DAY_MENU_STATE = null;
let DAILY_JOURNAL_STATE = null;
let TAG_ENTRY_RENAME_STATE = null;
let BULK_TAG_PLACEHOLDER = null;
let PREVIEW_BULK_TAG_EDIT = null;
let THUMB_CROP_EDITOR = null;
const THUMB_ASPECT_RESOLVE_PENDING = new Set();
let RENAME_EDIT_PATH = null;
let RENAME_EDIT_FILE_ID = null;
let RENAME_BUSY = false;

let MENU_OPEN = false;
let MENU_ACTIVE_TAB = "controls";
let MENU_LAST_TAB = "controls";
let MENU_HAS_OPENED = false;
let PREVIEW_MEDIA_LAYOUT_RAF = 0;
const MENU_TAB_SCROLL = {
  controls: 0,
  calendar: 0,
};
const CALENDAR_STATS_SORT_KEYS = [
  "name",
  "score",
  "sizeBytes",
  "itemCount",
  "efficiency",
  "scorePortion",
];
let KEYBIND_CAPTURE_ACTION_ID = "";
let KEYBIND_MODIFIER_TAB_ID = "all";
let PROPERTIES_OPEN = false;

let BANIC_ACTIVE = false;
let BANIC_STATE = {
  preview: null,
  viewer: null,
  quad: [],
};
// Panic mode must survive a WebView reload (the content process can crash and
// auto-reload — the "blank then content reappears" hiccup — which would drop
// BANIC_ACTIVE back to false and flash hidden content back on screen). Persist
// the flag and, on boot, raise the opaque cover *synchronously* before anything
// renders. BANIC_ACTIVE is set here too so the normal video/autoplay guards
// (which all check BANIC_ACTIVE) keep playback silent behind the cover.
const BANIC_PERSIST_KEY = "lg.banic.active";
try {
  if (localStorage.getItem(BANIC_PERSIST_KEY) === "1") {
    BANIC_ACTIVE = true;
    banicOverlayEl.classList.add("active");
  }
} catch {}
