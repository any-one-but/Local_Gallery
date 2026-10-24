/* App menu: settings
   Appearance, Thumbnails, Experimental, theme and Basics. */

function appearancePresetMenuCycleOptions() {
  return [
    { value: "", label: "None" },
    ...getAppearancePresetCycleList().map((preset) => ({
      value: normalizeAppearancePresetIdValue(preset && preset.id),
      label: normalizeAppearancePresetName(preset && preset.name, "Preset"),
    })),
  ].filter((option, index) => index === 0 || !!option.value);
}

function createAppearancePresetCycleButton(options = {}) {
  // No per-folder / per-tag / bulk "Filters" override while the system is off.
  if (!APPEARANCE_FILTERS_ENABLED) return null;
  const hasOverride = !!options.hasOverride;
  const currentPresetId = hasOverride
    ? normalizeAppearancePresetIdValue(options.currentPresetId)
    : "";
  return createCyclingItemMenuButton(
    String(options.label || "Filters"),
    appearancePresetMenuCycleOptions(),
    currentPresetId,
    (presetId) => {
      if (!presetId && typeof options.onClear === "function") {
        options.onClear();
        return;
      }
      if (typeof options.onChoosePreset === "function")
        options.onChoosePreset(presetId);
    },
    !!options.mixed,
  );
}

function setAppMenuThumbnailSize(value) {
  const next = THUMBNAIL_SIZE_CYCLE.some(
    (option) => option.value === value,
  )
    ? value
    : "medium";
  setOptionValue("thumbnailSize", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  applyOptionsEverywhere(false);
  showStatusMessage(
    `Thumbnail size: ${labelForCycleValue(THUMBNAIL_SIZE_CYCLE, next)}`,
  );
  return true;
}

// Diffusion writes one CSS custom property (via applyGlassDiffusionFromOptions,
// which applyOptionsEverywhere calls), so it invalidates no thumbnails and the
// menu stays open -- the value can be stepped and judged against the live
// window, which is the whole point of a control that reaches every surface.
function setAppMenuGlassDiffusion(value) {
  const next = normalizeGlassDiffusionValue(value);
  setOptionValue("glassDiffusion", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  applyOptionsEverywhere(false);
  showStatusMessage(
    `Diffusion: ${labelForCycleValue(GLASS_DIFFUSION_CYCLE, next)}`,
  );
  return true;
}

function setAppMenuFullResThumbnails(enabled) {
  if (!WS.meta) return false;
  const next = !!enabled;
  if (fullResThumbnailsEnabled() === next) return true;
  setOptionValue("fullResThumbnails", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  applyFullResThumbnailsModeChange(next);
  return true;
}

function setAppMenuMediaThumbnails(enabled) {
  if (!WS.meta) return false;
  const next = !!enabled;
  if (mediaThumbnailsEnabled() === next) return true;
  setOptionValue("mediaThumbnails", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  applyMediaThumbnailsModeChange(next);
  return true;
}

function setAppMenuAnimatedFilters(value) {
  const next = normalizeAnimatedMediaFiltersValue(value, "on");
  setOptionValue("animatedMediaFilters", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  applyMediaFilterFromOptions();
  showStatusMessage(
    `Animated filters: ${labelForCycleValue(ANIMATED_FILTER_CYCLE, next)}`,
  );
  return true;
}

function buildAppMenuSortButton() {
  const current = normalizeDirSortMode(WS.meta?.dirSortMode);
  return buildCycleSubmenu(
    "Sort",
    dirSortModeOptions(scoreInterfaceEnabled()),
    current,
    (mode) => setAppMenuFolderSortMode(mode),
  );
}

function buildAppMenuScoreFilterButton(kind) {
  const current = globalMinScoreFilterValue(kind);
  const values = scoreFilterCycleValues(kind);
  // A saved threshold the library has since moved past is still listed, so the
  // row can name it and the list can mark it.
  if (current != null && !values.includes(current)) {
    values.push(current);
    values.sort((a, b) => a - b);
  }
  return buildCycleSubmenu(
    scoreFilterOverrideLabel(kind),
    [{ value: "", label: "Off" }].concat(
      values.map((v) => ({ value: String(v), label: String(v) })),
    ),
    current == null ? "" : String(current),
    (value) => setAppMenuScoreFilter(kind, value),
  );
}

function setAppMenuScoreFilter(kind, value) {
  const next = normalizeMinScoreFilterValue(value);
  if (next === globalMinScoreFilterValue(kind)) {
    if (next == null)
      showStatusMessage(
        kind === "model"
          ? "Every Model has the same score."
          : "Every Set with media has the same score.",
      );
    return false;
  }
  setOptionValue(kind === "model" ? "minModelScoreFilter" : "minSetScoreFilter", next);
  bumpScoreFilterRevision();
  invalidateDirMetricsCaches();
  applyViewModesEverywhere(true);
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(
    `${scoreFilterOverrideLabel(kind)}: ${next == null ? "Off" : next}`,
  );
  return true;
}

function buildAppMenuMediaFilterButton() {
  const current = normalizeMediaFilterMode(WS.view?.filterMode);
  const options = [
    { value: "all", label: "All" },
    { value: "images", label: "Images" },
    { value: "videos", label: "Videos" },
    { value: "text", label: "Text" },
  ];
  return buildCycleSubmenu("Media filter", options, current, (value) =>
    setAppMenuMediaFilterMode(value),
  );
}

function buildAppMenuAppearanceSubmenu() {
  // Dropped from the app menu entirely while the system is off. The caller
  // filters nulls out of its item list.
  if (!APPEARANCE_FILTERS_ENABLED) return null;
  const options = WS.meta?.options || {};
  const submenu = createDropdownMenuSubmenu("Filters", [
    buildAppMenuPresetHybridSubmenu(options),
    buildAppMenuCycleButton(
      "Animated filters",
      ANIMATED_FILTER_CYCLE,
      normalizeAnimatedMediaFiltersValue(options.animatedMediaFilters, "on"),
      setAppMenuAnimatedFilters,
    ),
    ...FILTER_MENU_COLOR_CONTROLS.concat(FILTER_MENU_EFFECT_CONTROLS).map(
      buildAppMenuFilterControlButton,
    ),
  ]);
  submenu
    ?.querySelector?.(":scope > .dropdownMenuSubmenuPanel")
    ?.classList?.add("appMenuAppearancePanel");
  return submenu;
}

function buildAppMenuThumbnailsSubmenu() {
  const options = WS.meta?.options || {};
  const thumbnailSize = String(options.thumbnailSize || "medium");
  const fullRes = fullResThumbnailsEnabled(options);
  const mediaThumbs = mediaThumbnailsEnabled(options);
  return createDropdownMenuSubmenu("Thumbnails", [
    // First because it gates everything below it: off, no tile paints media at
    // all. closeAfter for the same reason as Full resolution — it refreshes the
    // workspace, so there is no tree left to rebuild the markers over.
    appMenuChoiceButton(
      "Media thumbnails",
      () => setAppMenuMediaThumbnails(!mediaThumbs),
      mediaThumbs,
      true,
    ),
    buildAppMenuCycleButton(
      "Thumbnail size",
      THUMBNAIL_SIZE_CYCLE,
      thumbnailSize,
      setAppMenuThumbnailSize,
    ),
    // closeAfter: switching pipelines forces a workspace refresh, so leave the
    // menu rather than rebuild ●/○ over a tree that is about to be replaced.
    appMenuChoiceButton(
      "Full resolution",
      () => setAppMenuFullResThumbnails(!fullRes),
      fullRes,
      true,
    ),
    // What shares the name's pill on a card -- see arrangeCardPills.
    buildAppMenuCycleButton(
      "Icon placement",
      TYPE_ICON_PLACEMENT_CYCLE,
      typeIconPlacement(),
      setAppMenuTypeIconPlacement,
    ),
    buildAppMenuCycleButton(
      "Score placement",
      SCORE_PLACEMENT_CYCLE,
      scorePlacement(),
      setAppMenuScorePlacement,
    ),
    // The title strip's opacity and diffusion controls are gone. There is no
    // strip left to configure -- the title and the score each carry their own
    // frosted pill, and a pill that could be turned down to nothing would just
    // be an invisible label over a photograph. The setters and the cycles are
    // left in place, unreferenced, so restoring the bar is one edit here plus
    // the two tokens.
  ]);
}

// Experimental: switches for finding out what makes a big library slow. The
// two new ones only change what is *drawn* -- stored crops, frames and picks
// are never rewritten -- and the rest are the same options as under
// Appearance -> Thumbnails and Basics, reached from one place.
function setAppMenuThumbnailEdits(enabled) {
  if (!WS.meta) return false;
  const next = !!enabled;
  if (thumbnailEditsEnabled() === next) return true;
  setOptionValue("thumbnailEdits", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  applyExperimentalThumbnailModeChange(
    `Thumbnail edits: ${next ? "On" : "Off"}`,
  );
  return true;
}

function setAppMenuDefaultThumbnailsOnly(enabled) {
  if (!WS.meta) return false;
  const next = !!enabled;
  if (defaultThumbnailsOnlyEnabled() === next) return true;
  setOptionValue("defaultThumbnailsOnly", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  applyExperimentalThumbnailModeChange(
    `Default thumbnails only: ${next ? "On" : "Off"}`,
  );
  return true;
}

// Same route as Media thumbnails: save, then Refresh App, so every card is
// rebuilt and no cache keyed on the old choice survives.
function applyExperimentalThumbnailModeChange(message) {
  showStatusMessage(message);
  const kickRefresh = () => {
    if (!WS.meta?.fsRootHandle) return;
    refreshWorkspaceKeybindAction();
  };
  if (typeof persistDirtyMetadataNow === "function") {
    persistDirtyMetadataNow()
      .catch(() => {})
      .finally(kickRefresh);
  } else {
    kickRefresh();
  }
}

function buildAppMenuExperimentalSubmenu() {
  const options = WS.meta?.options || {};
  const edits = thumbnailEditsEnabled(options);
  const defaultsOnly = defaultThumbnailsOnlyEnabled(options);
  // Only the switches that live nowhere else. Media thumbnails, Full
  // resolution and Thumbnail size are under Appearance -> Thumbnails, Animated
  // filters under the filters and Utility containers in Basics.
  return createDropdownMenuSubmenu("Experimental", [
    // closeAfter on every switch that refreshes the workspace, as under
    // Thumbnails: there is no tree left to rebuild the markers over.
    appMenuChoiceButton(
      "Thumbnail edits",
      () => setAppMenuThumbnailEdits(!edits),
      edits,
      true,
    ),
    appMenuChoiceButton(
      "Default thumbnails only",
      () => setAppMenuDefaultThumbnailsOnly(!defaultsOnly),
      defaultsOnly,
      true,
    ),
    buildAppMenuCycleButton(
      "Sidebar settings menu",
      MENU_SIDEBAR_CYCLE,
      appMenuSidebarSide(options),
      setAppMenuSidebar,
    ),
    buildAppMenuCycleButton(
      "Sidebar select menu",
      MENU_SIDEBAR_CYCLE,
      selectMenuSidebarSide(options),
      setSelectMenuSidebar,
    ),
    // Where the app menu opens when it is not a sidebar, and (Select Menu)
    // how far from the item and how high either menu sits when it opens at
    // the item. Moved here from Appearance.
    buildAppMenuPlacementButton(options),
    buildAppMenuSelectMenuSubmenu(),
    // Where a folder card's name goes: under the picture or on it
    // (card-captions.css).
    buildAppMenuCycleButton(
      "Folder names",
      CARD_CAPTIONS_CYCLE,
      cardCaptions(),
      setAppMenuCardCaptions,
    ),
    // Whether a picture opened from the grid grows out of its card
    // (media/open-zoom.js).
    buildAppMenuCycleButton(
      "Opening media",
      MEDIA_OPEN_ZOOM_CYCLE,
      mediaOpenAnimation(),
      setAppMenuMediaOpenAnimation,
    ),
    // How the zoom bridges a Set's card picture and the file that opens when
    // they are not the same file (media/open-zoom.js).
    buildAppMenuCycleButton(
      "Thumbnail isn't the first file",
      MEDIA_OPEN_ZOOM_MISMATCH_CYCLE,
      mediaOpenZoomMismatch(),
      setAppMenuMediaOpenZoomMismatch,
    ),
  ]);
}

// Experimental -> Sidebar settings menu. Changed from inside the menu it
// changes, so the open menu is put into (or taken out of, or across to the
// other side of) the sidebar at once.
function setAppMenuSidebar(value) {
  if (!WS.meta) return false;
  const next = normalizeMenuSidebarValue(value, "left");
  if (appMenuSidebarSide() === next) return true;
  setOptionValue("appMenuSidebar", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  if (appActionMenuEl?.classList?.contains("open")) {
    APP_MENU_DOCK_POS = null;
    positionActionMenuInPreviewDock(appActionMenuEl, { reanchor: true });
  }
  showStatusMessage(
    `Sidebar settings menu: ${labelForCycleValue(MENU_SIDEBAR_CYCLE, next)}`,
  );
  return true;
}

// Experimental -> Sidebar select menu. Changed from the settings menu, so the
// select menu is closed and nothing on screen has to move; the next one opens
// in the sidebar (or beside its item).
function setSelectMenuSidebar(value) {
  if (!WS.meta) return false;
  const next = normalizeMenuSidebarValue(value, "right");
  if (selectMenuSidebarSide() === next) return true;
  setOptionValue("selectMenuSidebar", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(
    `Sidebar select menu: ${labelForCycleValue(MENU_SIDEBAR_CYCLE, next)}`,
  );
  return true;
}

// While Default thumbnails only is on there is nothing a Thumbnail submenu
// could change, so the select menu leaves every one of them out, nested ones
// (Folder options -> Thumbnail) included.
function stripThumbnailSubmenusWhileLocked(items) {
  if (!thumbnailPicksLocked()) return items;
  const isThumbnailSubmenu = (el) => {
    if (!el?.classList?.contains("dropdownMenuSubmenu")) return false;
    const trigger = el.querySelector(":scope > .dropdownMenuSubmenuTrigger");
    const labelEl =
      trigger?.querySelector(".dropdownMenuSubmenuLabelWithIcon > span:last-child") ||
      trigger?.querySelector(":scope > span:first-child");
    return String(labelEl?.textContent || "").trim() === "Thumbnail";
  };
  return items.filter((item) => {
    if (isThumbnailSubmenu(item)) return false;
    item?.querySelectorAll?.(".dropdownMenuSubmenu").forEach((el) => {
      if (isThumbnailSubmenu(el)) el.remove();
    });
    return true;
  });
}

function buildAppMenuThemeButton(options) {
  return buildAppMenuCycleButton(
    "Theme",
    APP_THEME_CYCLE,
    getAppThemeFromOptions(options),
    (value) => {
      setOptionValue("appTheme", normalizeAppThemeValue(value));
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(
        `Theme: ${labelForCycleValue(APP_THEME_CYCLE, getAppThemeFromOptions())}`,
      );
      return true;
    },
  );
}

// Both sides on Match: the hidden scheme is showing.
function uiColorsArePrism() {
  const opt = (WS.meta && WS.meta.options) || {};
  return resolveUiColorChoice(
    normalizeUiTintValue(opt.uiTint),
    normalizeUiHighlightValue(opt.uiHighlight),
  ).prism;
}

function buildAppMenuUiTintButton(options) {
  return buildAppMenuCycleButton(
    "Theme color",
    uiTintPalettes(),
    normalizeUiTintValue(options && options.uiTint),
    (value) => {
      setOptionValue("uiTint", normalizeUiTintValue(value));
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(
        uiColorsArePrism()
          ? "Colors: Prism"
          : `Theme color: ${labelForCycleValue(uiTintPalettes(), normalizeUiTintValue(value))}`,
      );
      return true;
    },
  );
}

function buildAppMenuUiHighlightButton(options) {
  return buildAppMenuCycleButton(
    "Accent color",
    uiHighlightPalettes(),
    normalizeUiHighlightValue(options && options.uiHighlight),
    (value) => {
      setOptionValue("uiHighlight", normalizeUiHighlightValue(value));
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(
        uiColorsArePrism()
          ? "Colors: Prism"
          : `Accent color: ${labelForCycleValue(uiHighlightPalettes(), normalizeUiHighlightValue(value))}`,
      );
      return true;
    },
  );
}

function buildAppMenuPlacementButton(options) {
  return buildAppMenuCycleButton(
    "Menu placement",
    APP_MENU_PLACEMENT_CYCLE,
    getStoredAppMenuPlacementFromOptions(options),
    (value) => {
      setOptionValue("appMenuPlacement", normalizeAppMenuPlacementValue(value));
      APP_MENU_DOCK_POS = null;
      applyOptionsEverywhere(false);
      if (appActionMenuEl)
        positionActionMenuInPreviewDock(appActionMenuEl, { reanchor: true });
      showStatusMessage(
        `Menu placement: ${labelForCycleValue(APP_MENU_PLACEMENT_CYCLE, getStoredAppMenuPlacementFromOptions())}`,
      );
      return true;
    },
  );
}

function buildAppMenuSelectMenuSubmenu() {
  const options = WS.meta?.options || {};
  return createDropdownMenuSubmenu("Select Menu", [
    buildAppMenuCycleButton(
      "Menu distance",
      APP_MENU_DISTANCE_CYCLE,
      getStoredAppMenuDistanceFromOptions(options),
      (value) => {
        setOptionValue("appMenuDistance", normalizeAppMenuDistanceValue(value));
        // Re-dock rather than redraw in place: the stored corner is what every
        // in-place rebuild reuses, so it has to be recomputed for the change to
        // be visible without closing the menu.
        APP_MENU_DOCK_POS = null;
        applyOptionsEverywhere(false);
        if (appActionMenuEl) positionActionMenuInPreviewDock(appActionMenuEl, { reanchor: true });
        showStatusMessage(
          `Menu distance: ${labelForCycleValue(APP_MENU_DISTANCE_CYCLE, getStoredAppMenuDistanceFromOptions())}`,
        );
        return true;
      },
    ),
    buildAppMenuCycleButton(
      "Menu height",
      APP_MENU_HEIGHT_CYCLE,
      getStoredAppMenuHeightFromOptions(options),
      (value) => {
        setOptionValue("appMenuHeight", normalizeAppMenuHeightValue(value));
        APP_MENU_DOCK_POS = null;
        applyOptionsEverywhere(false);
        if (appActionMenuEl) positionActionMenuInPreviewDock(appActionMenuEl, { reanchor: true });
        showStatusMessage(
          `Menu height: ${labelForCycleValue(APP_MENU_HEIGHT_CYCLE, getStoredAppMenuHeightFromOptions())}`,
        );
        return true;
      },
    ),
  ]);
}

function buildAppMenuAppearanceSettingsSubmenu() {
  const options = WS.meta?.options || {};
  return createDropdownMenuSubmenu("Appearance", [
    buildAppMenuThemeButton(options),
    buildAppMenuUiTintButton(options),
    buildAppMenuUiHighlightButton(options),
    appMenuChoiceButton(
      "Top bar",
      () => setAppMenuTopBar(!topBarEnabled()),
      topBarEnabled(),
    ),
    // Diffusion lives here rather than under Thumbnails because it is not a
    // thumbnail setting any more -- it reaches the title bar, the menus, the
    // overlays and the search field as well as the pills on each card.
    buildAppMenuCycleButton(
      "Bubble diffusion",
      GLASS_DIFFUSION_CYCLE,
      getGlassDiffusionFromOptions(options),
      setAppMenuGlassDiffusion,
    ),
    buildAppMenuCycleButton(
      "Bubble tint",
      BUBBLE_TINT_CYCLE,
      getBubbleTintFromOptions(options),
      (value) => {
        setOptionValue("bubbleTint", normalizeBubbleTintValue(value));
        refreshLiveSettingsPaneFromKeyboardAction();
        applyOptionsEverywhere(false);
        showStatusMessage(
          `Bubble tint: ${labelForCycleValue(BUBBLE_TINT_CYCLE, getBubbleTintFromOptions())}`,
        );
        return true;
      },
    ),
    appMenuChoiceButton(
      "Float tags",
      () => handleExtrasKeybindAction("toggleFloatTags"),
      !!options.showTagFolderSpacerRow,
    ),
    appMenuChoiceButton(
      "Float utility containers",
      () => handleExtrasKeybindAction("toggleFloatSpecialContainers"),
      !!options.showSpecialContainerSpacerRow,
    ),
  ]);
}

// Each Basics row carries an icon, matched on its name -- the ●/○ marker and a
// cycle row's ": Value" are not part of it.
const APP_MENU_BASICS_ICON_KEYS = Object.freeze({
  Sort: "listSort",
  "Media filter": "mediaType",
  "Set score is at least": "scoreFilter",
  "Model score is at least": "scoreFilter",
  "Quick navigation": "quickNav",
  Hidden: "hidden",
  "Utility containers": "storage",
  Slideshow: "slideshow",
  "Slideshow duration": "slideshowDuration",
  "Disable messages": "messagesOff",
});

function appMenuBasicsIconKey(label) {
  const name = String(label || "")
    .replace(/^[●○]\s*/, "")
    .split(":")[0]
    .trim();
  return APP_MENU_BASICS_ICON_KEYS[name] || "";
}

function buildAppMenuBasicsSubmenu() {
  return createDropdownMenuSubmenu(
    "Basics",
    [
      buildAppMenuSortButton(),
      buildAppMenuMediaFilterButton(),
      buildAppMenuScoreFilterButton("set"),
      buildAppMenuScoreFilterButton("model"),
      appMenuChoiceButton(
        "Quick navigation",
        () => handleExtrasKeybindAction("toggleQuickNavigation"),
        quickNavigationEnabled(),
      ),
      appMenuChoiceButton(
        "Hidden",
        () => handleExtrasKeybindAction("toggleShowHiddenFolder"),
        showHiddenFolderEnabled(),
      ),
      appMenuChoiceButton(
        "Utility containers",
        () => handleExtrasKeybindAction("toggleUtilityContainers"),
        showUtilityContainersEnabled(),
      ),
      ...buildAppMenuSlideshowRows(),
      MUTE_MESSAGES_EXPOSED
        ? appMenuChoiceButton(
            "Disable messages",
            () => handleExtrasKeybindAction("toggleMuteMessages"),
            muteMessagesEnabled(),
          )
        : null,
    ]
      .filter(Boolean)
      .map((item) => withMenuItemIcon(item, appMenuBasicsIconKey)),
  );
}

// Slideshow is a toggle, or under Slideshow duration: Cycle a cycler over Off and each
// duration (pressing it steps to the next, stepping in lists them all).
function buildAppMenuSlideshowRows() {
  const running = WS.view.slideshowActive ? WS.view.slideshowSeconds : 0;
  const toggle = slideshowCycleMode()
    ? buildAppMenuCycleButton(
        "Slideshow",
        SLIDESHOW_MODE_CYCLE,
        String(running),
        setSlideshowSeconds,
      )
    : appMenuChoiceButton(
        "Slideshow",
        () => handleExtrasKeybindAction("slideshow"),
        WS.view.slideshowActive,
      );
  return [
    toggle,
    buildAppMenuCycleButton(
      "Slideshow duration",
      SLIDESHOW_DURATION_CYCLE,
      slideshowDurationSetting(),
      setSlideshowDuration,
    ),
  ];
}

// Import external files/folders into the current location (the folder the
// preview pane is showing), folded in from the old background context menu.
// Omitted for locations that cannot be imported into -- tag/virtual portals
// and the internal trash -- so it never appears as a dead submenu.
function buildAppMenuAddItemsSubmenu() {
  const importTarget = importableDirectoryForNode(getPreviewTargetDir());
  if (!importTarget) return null;
  return createDropdownMenuSubmenu("Add items", [
    appMenuChoiceButton(
      "Add folders...",
      () => addContentToDirectoryViaPicker(importTarget, "folders"),
      null,
      true,
    ),
    appMenuChoiceButton(
      "Add files...",
      () => addContentToDirectoryViaPicker(importTarget, "files"),
      null,
      true,
    ),
  ]);
}

// Reverse the file order inside the given folder -- the selected item, not the
// current location. Returns null (so the option does not appear at all) unless
// the folder actually has two or more reorderable files. The menu stays open,
// like any other option, so Reset order and Index appear for the next step.
function buildAppMenuReverseFilesButton(dirNode) {
  if (!dirNode) return null;
  const ids = getPreviewFolderAndFileEntries(dirNode, {
    includeFiles: true,
    useCurrentViewEntries: false,
  }).fileIds;
  if (!canReorderFilesInDir(dirNode) || ids.length < 2) return null;
  return appMenuChoiceButton(
    "Reverse file order",
    () => {
      if (reverseFilesInDir(dirNode, { visibleIds: ids })) {
        syncAfterDirOrderChange(null, {
          preserveSelection: true,
          preservePreviewTarget: true,
        });
        showStatusMessage(`Reversed the files in ${dirDisplayName(dirNode)}.`);
      }
    },
  );
}

function buildAppMenuFilenameSubmenu() {
  const options = WS.meta?.options || {};
  return createDropdownMenuSubmenu("Display names", [
    /* First, because it governs whether the rest of the section applies at
       all: with names off there is nothing for the formatting rules below to
       format. */
    appMenuChoiceButton(
      "Show file names",
      () => handleExtrasKeybindAction("toggleShowFileNames"),
      showFileNamesEnabled(options),
    ),
    appMenuChoiceButton(
      "Force title caps",
      () => handleExtrasKeybindAction("toggleForceTitleCaps"),
      !!options.forceTitleCaps,
    ),
    appMenuChoiceButton(
      "Position number prefixes",
      () => handleExtrasKeybindAction("toggleShowPositionNumbers"),
      !!options.showPositionNumbersInNames,
    ),
    appMenuChoiceButton(
      "Trim before last dash",
      () => handleExtrasKeybindAction("toggleHideBeforeLastDash"),
      !!options.hideBeforeLastDashInFileNames,
    ),
    appMenuChoiceButton(
      "Hide file extensions",
      () => handleExtrasKeybindAction("toggleHideFileExtensions"),
      !!options.hideFileExtensionsInFileNames,
    ),
  ]);
}

function currentOpenMediaFileRecordForAppMenu() {
  if (VIEWER_MODE) {
    const item = viewerItems[viewerIndex] || null;
    if (item && !item.isFolder && item.id) {
      return WS.fileById.get(String(item.id || "")) || null;
    }
  }
  if (WS.preview && WS.preview.kind === "file" && WS.preview.fileId) {
    return WS.fileById.get(String(WS.preview.fileId || "")) || null;
  }
  return null;
}

function currentOpenMediaContextDirForAppMenu() {
  if (VIEWER_MODE && viewerDirNode) return viewerDirNode;
  if (WS.preview && WS.preview.kind === "file" && WS.preview.dirNode)
    return WS.preview.dirNode;
  return null;
}
