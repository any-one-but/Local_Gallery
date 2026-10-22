/* Select menu: Tags and folder options
   Cyclers, Add tag / Add tag to all contents, toggles and Folder options. */

// `closeAfter` marks the handful of entries that navigate somewhere rather than
// change a setting — leaving the menu up over the place you just jumped to (with
// file-tree keys still captured by the menu) would be in the way.
function appMenuChoiceButton(label, onClick, active = null, closeAfter = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent =
    active == null ? String(label || "") : `${active ? "●" : "○"} ${label}`;
  // Otherwise the app menu stays open when an option is chosen so several
  // settings can be changed in one visit; it only rebuilds itself in place so
  // the ●/○ markers reflect the new state.
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (closeAfter) {
      allowMenuClose();
      closeAppMenu();
      if (typeof onClick === "function") onClick();
      return;
    }
    const keyState = captureNumberedMenuKeyState(appActionMenuEl);
    suppressMenuAutoClose();
    if (typeof onClick === "function") onClick();
    refreshAppMenuContents(keyState);
  });
  return btn;
}

function setAppMenuFolderSortMode(mode) {
  if (!WS.meta) return false;
  const next = normalizeDirSortMode(mode);
  WS.meta.dirSortMode = next;
  invalidateDirSortOrderCaches();
  metaMarkDirty(META_DOC_IDS.prefGeneral);
  refreshLiveSettingsPaneFromKeyboardAction();
  applyFolderSortModeEverywhere(true);
  showStatusMessage(`Folder sort: ${dirSortModeLabel(next)}`);
  return true;
}

function setAppMenuMediaFilterMode(mode) {
  if (!WS.view) return false;
  const next = normalizeMediaFilterMode(mode);
  WS.view.filterMode = next;
  applyViewModesEverywhere(true);
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(`Media filter: ${next}`, "cycle-filter");
  return true;
}

function buildAppMenuChoiceSubmenu(label, options, currentValue, onChoose) {
  const choices = Array.isArray(options) ? options : [];
  return createDropdownMenuSubmenu(
    label,
    choices.map((option) =>
      appMenuChoiceButton(
        option.label,
        () => onChoose(option.value),
        String(option.value) === String(currentValue),
      ),
    ),
  );
}

function menuCycleChoiceState(options, currentValue, mixed = false) {
  const choices = Array.isArray(options) ? options.filter(Boolean) : [];
  if (!choices.length) return null;
  const currentIndex = choices.findIndex(
    (option) => String(option.value) === String(currentValue),
  );
  const currentOption = choices[currentIndex >= 0 ? currentIndex : 0];
  const nextOption = choices[
    mixed ? 0 : currentIndex >= 0 ? (currentIndex + 1) % choices.length : 0
  ];
  return {
    currentLabel: mixed ? "Mixed" : String(currentOption.label || ""),
    nextValue: nextOption.value,
  };
}

/* Every cycler in both menus is built here. The row is a hybrid submenu
   (createDropdownMenuSubmenu's onActivate): pressing it steps to the next value
   exactly as a plain cycle row did, and stepping into it lists every value with
   the current one marked, so a far-off value is one pick rather than several
   presses. Choosing from the list rebuilds the menu like any other option.
   The trigger's state key is the bare label, so the cursor and an open list
   survive the rebuild even though the row's text names the new value. */
function buildCycleSubmenu(label, options, currentValue, onChoose, mixed = false) {
  const state = menuCycleChoiceState(options, currentValue, mixed);
  if (!state || typeof onChoose !== "function") return null;
  const choices = options.filter(Boolean);
  const currentIndex = Math.max(
    0,
    choices.findIndex((option) => String(option.value) === String(currentValue)),
  );
  const rows = choices.map((option, index) =>
    appMenuChoiceButton(
      String(option.label || ""),
      () => onChoose(option.value),
      !mixed && index === currentIndex,
    ),
  );
  const submenu = createDropdownMenuSubmenu(
    `${label}: ${state.currentLabel}`,
    rows,
    "",
    {
      stateKey: `cycle:${label}`,
      onActivate: () => {
        onChoose(state.nextValue);
      },
    },
  );
  if (submenu) submenu.classList.add("menuCycleSubmenu");
  return submenu;
}

function buildAppMenuCycleButton(label, options, currentValue, onChoose) {
  return buildCycleSubmenu(label, options, currentValue, onChoose);
}

function createCyclingItemMenuButton(
  label,
  options,
  currentValue,
  onChoose,
  mixed = false,
) {
  return buildCycleSubmenu(label, options, currentValue, onChoose, mixed);
}

// The plain-button cycler both builders above used to return. Unreferenced;
// kept so a cycler can be put back to press-only in one edit.
function createCyclingItemMenuButtonPressOnly(
  label,
  options,
  currentValue,
  onChoose,
  mixed = false,
) {
  let state = menuCycleChoiceState(options, currentValue, mixed);
  if (!state || typeof onChoose !== "function") return null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = `${label}: ${state.currentLabel}`;
  btn.setAttribute("data-action", "keep");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const hostedInAppMenu = !!btn.closest("#appActionMenu");
    const keyState = hostedInAppMenu
      ? captureNumberedMenuKeyState(appActionMenuEl)
      : null;
    if (hostedInAppMenu) suppressMenuAutoClose();
    onChoose(state.nextValue);
    if (hostedInAppMenu) {
      refreshAppMenuContents(keyState);
    } else {
      state = menuCycleChoiceState(options, state.nextValue);
      if (state) setMenuButtonLabelText(btn, `${label}: ${state.currentLabel}`);
    }
  });
  return btn;
}

function addToScopeForTarget(target) {
  const item = target && typeof target === "object" ? target : null;
  if (!item) return "";
  if (item.kind === "dir")
    return hiddenTagScopePathForDirPath(item.path || "");
  if (item.kind === "tag" || item.kind === "album")
    return normalizeTagAlbumScopePath(item.originPath || "");
  return "";
}

function sharedAddToScopeForTargets(targets) {
  const list = Array.isArray(targets) ? targets : [];
  if (!list.length) return null;
  const scopes = new Set(list.map(addToScopeForTarget));
  return scopes.size === 1 ? Array.from(scopes)[0] : null;
}

function collectExistingTagNamesForScope(scopePath) {
  const scope = normalizeTagAlbumScopePath(scopePath || "");
  const out = new Set();
  const addTagList = (tagsRaw) => {
    normalizeTagList(tagsRaw)
      .filter((tag) => !isReservedFolderTag(tag))
      .forEach((tag) => out.add(tag));
  };
  const addTaggedFolderMap = (map) => {
    if (!(map instanceof Map)) return;
    for (const [pathRaw, tagsRaw] of map.entries()) {
      if (hiddenTagScopePathForDirPath(pathRaw) === scope)
        addTagList(tagsRaw);
    }
  };
  addTaggedFolderMap(WS.meta?.dirTags);
  addTaggedFolderMap(WS.meta?.pendingTagsByPath);
  if (WS.meta?.albumTagsByAlbum instanceof Map) {
    for (const [albumKeyRaw, tagsRaw] of WS.meta.albumTagsByAlbum.entries()) {
      const parsed = parseAlbumTagMembershipKey(albumKeyRaw);
      if (parsed && parsed.scopePath === scope) addTagList(tagsRaw);
    }
  }
  if (scope === "" && WS.meta?.galleryUserTagsByGallery instanceof Map) {
    for (const tagsRaw of WS.meta.galleryUserTagsByGallery.values())
      addTagList(tagsRaw);
  }
  return Array.from(out).sort((a, b) => String(a).localeCompare(String(b)));
}

function collectExistingAlbumNamesForScope(scopePath) {
  const scope = normalizeTagAlbumScopePath(scopePath || "");
  const out = new Set();
  if (WS.meta?.folderAlbumByPath instanceof Map) {
    for (const [pathRaw, albumRaw] of WS.meta.folderAlbumByPath.entries()) {
      if (hiddenTagScopePathForDirPath(pathRaw) !== scope) continue;
      const album = normalizeTagAlbumName(albumRaw);
      if (album) out.add(album);
    }
  }
  if (WS.meta?.tagAlbumByTag instanceof Map) {
    for (const [tagKeyRaw, albumRaw] of WS.meta.tagAlbumByTag.entries()) {
      const parsed = parseTagAlbumMembershipKey(tagKeyRaw);
      if (!parsed || parsed.scopePath !== scope) continue;
      const album = normalizeTagAlbumName(albumRaw);
      if (album) out.add(album);
    }
  }
  if (WS.meta?.albumTagsByAlbum instanceof Map) {
    for (const albumKeyRaw of WS.meta.albumTagsByAlbum.keys()) {
      const parsed = parseAlbumTagMembershipKey(albumKeyRaw);
      if (parsed && parsed.scopePath === scope && parsed.album)
        out.add(parsed.album);
    }
  }
  if (scope === "" && WS.meta?.galleryAlbumByGallery instanceof Map) {
    for (const albumRaw of WS.meta.galleryAlbumByGallery.values()) {
      const album = normalizeTagAlbumName(albumRaw);
      if (album) out.add(album);
    }
  }
  return Array.from(out).sort((a, b) => String(a).localeCompare(String(b)));
}

/* Add tag is a hybrid. Pressing it opens the naming field at once
   (the "A, B" list, seeded with the Tags the selection shares); stepping into
   it lists Create new and then every Tag.

   Create new is a hybrid too: pressing it names a fresh Tag straight away,
   stepping into it offers the new Tag's settings -- Exclusive and the three
   Overrides -- with Create at the bottom, which then opens the naming field.
   The settings are a draft (ADD_TO_TAG_CREATE_DRAFTS) held outside the menu,
   because the select menu rebuilds itself after every option; openAppMenu
   starts a fresh one.

   Each Tag row is a toggle that keeps the menu open, so one selection can be
   put in several Tags in a row: ● means every selected item is in it, and
   pressing a ● row takes them back out. A row stays listed until the menu
   closes (ADD_TO_TAG_OFFERED_NAMES), so taking the last folder out of a Tag
   does not pull the row out from under the cursor.

   Add tag to all contents has the same shape over the same parts, keyed "contents"
   where Tag is keyed "tag" (each has its own draft): its rows toggle the
   selection's contents rule rather than the selection's own Tags. */
let ADD_TO_TAG_CREATE_DRAFTS = {};
let ADD_TO_TAG_OFFERED_NAMES = new Set();

function resetAddToTagCreateDraft() {
  ADD_TO_TAG_CREATE_DRAFTS = {};
  ADD_TO_TAG_OFFERED_NAMES = new Set();
}

function addToTagCreateDraft(kind = "tag") {
  if (!ADD_TO_TAG_CREATE_DRAFTS[kind]) {
    ADD_TO_TAG_CREATE_DRAFTS[kind] = {
      exclusive: false,
      sortMode: "",
      appearancePresetId: "",
      mediaType: "",
      setScore: "",
      modelScore: "",
    };
  }
  return ADD_TO_TAG_CREATE_DRAFTS[kind];
}

// The settings a Create new draft hands to the naming field.
function addToTagCreateOverrides(draft) {
  const settings = draft && typeof draft === "object" ? draft : {};
  return {
    containerType: "tag",
    exclusive: !!settings.exclusive,
    exclusiveTouched: !!settings.exclusive,
    sortMode: String(settings.sortMode || ""),
    sortModeTouched: !!settings.sortModeTouched,
    appearancePresetId: String(settings.appearancePresetId || ""),
    appearancePresetTouched: !!settings.appearancePresetIdTouched,
    mediaType: String(settings.mediaType || ""),
    mediaTypeTouched: !!settings.mediaTypeTouched,
    setScore: String(settings.setScore || ""),
    setScoreTouched: !!settings.setScoreTouched,
    modelScore: String(settings.modelScore || ""),
    modelScoreTouched: !!settings.modelScoreTouched,
  };
}

// Folders and Tags can go in a Tag; anything else in the selection (a special
// bucket, an album, a file) means no Tag can take all of it.
function addToTagEligibleTargets(selectionTarget) {
  const targets = labelTargetsForSelectionTarget(selectionTarget);
  if (!targets.length) return [];
  return targets.every((target) => target.kind === "dir" || target.kind === "tag")
    ? targets
    : [];
}

function addToTagTargetIsIn(target, name) {
  const tag = normalizeTag(name);
  if (!target || !tag) return false;
  if (target.kind === "dir") return metaGetUserTags(target.path).includes(tag);
  if (target.kind === "tag") return tagParentNames(target.tag).includes(tag);
  return false;
}

// Every Tag with a place in the library, less -- for a Tag being put somewhere
// -- itself and anything it holds, which would make a loop. A Tag with nothing
// left in it has no place and is not offered; its metadata is kept, and it is
// offered again once it holds something.
function addToTagChoiceNames(targets) {
  const tagTargets = targets.filter((target) => target.kind === "tag");
  // Tag storage takes Tags and nothing else, so it is offered only when every
  // selected item is a Tag.
  const sources =
    tagTargets.length && tagTargets.length === targets.length ? [TAG_STORAGE_NAME] : [];
  return sources.concat(addToTagOfferedNames((name) =>
    tagTargets.some(
      (target) =>
        normalizeTag(target.tag) === name ||
        tagHoldsTransitively(target.tag, name),
    ),
  ));
}

function addToTagOfferedNames(isExcluded) {
  const names = new Set(
    getAllTagNames().filter((name) => name && tagPlacementPath(name) != null),
  );
  ADD_TO_TAG_OFFERED_NAMES.forEach((name) => names.add(name));
  const out = Array.from(names)
    .filter((name) => !isInternalTagName(name) && !isExcluded(name))
    .sort((a, b) => String(a).localeCompare(String(b)));
  out.forEach((name) => ADD_TO_TAG_OFFERED_NAMES.add(name));
  return out;
}

// A Tag's contents going into that same Tag would change nothing.
function addContentsToTagChoiceNames(contentsSources) {
  return addToTagOfferedNames((name) => contentsSources.includes(`tag:${name}`));
}

// Taking the selection out of the Tag it is being looked at through moves the
// screen, and the menu would then be about whatever is selected now. It closes
// rather than let the next press act on a different item.
function closeSelectMenuIfTargetMoved(identityBefore) {
  if (selectMenuTargetIdentity() === identityBefore) return;
  allowMenuClose();
  closeAppMenu();
}

function toggleSelectionContentsInTag(name, contentsSources) {
  const tag = normalizeTag(name);
  const sources = Array.isArray(contentsSources) ? contentsSources : [];
  if (!tag || !sources.length) return false;
  const identityBefore = selectMenuTargetIdentity();
  const remove = sources.every((key) => metaGetContentTags(key).includes(tag));
  if (
    !metaApplyContentTagsDiff(sources, remove ? [tag] : [], remove ? [] : [tag])
  )
    return false;
  metaScheduleSave();
  refreshAfterTagMetadataChange();
  closeSelectMenuIfTargetMoved(identityBefore);
  showStatusMessage(
    remove
      ? `Contents no longer added to '${tag}'.`
      : `Contents added to '${tag}', including anything added later.`,
  );
  return true;
}

function createAddToTagToggleButton(name, on, onToggle) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = `${on ? "●" : "○"} ${tagDisplayName(name)}`;
  btn.setAttribute("data-action", "keep");
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    onToggle();
  });
  return btn;
}

// What the select menu is about right now, as one comparable string.
function selectMenuTargetIdentity() {
  return labelTargetsForSelectionTarget(appMenuSelectionSummary()?.target)
    .map((target) => `${target.kind}:${target.path || target.tag || ""}`)
    .sort()
    .join("\n");
}

function toggleSelectionInTag(name, selectionTarget) {
  const tag = normalizeTag(name);
  const targets = addToTagEligibleTargets(selectionTarget);
  if (!tag || !targets.length) return false;
  const identityBefore = selectMenuTargetIdentity();
  const remove = targets.every((target) => addToTagTargetIsIn(target, tag));
  const dirs = targets
    .filter((target) => target.kind === "dir")
    .map((target) => normalizeDirPathValue(target.path))
    .filter(Boolean);
  const childTags = targets
    .filter((target) => target.kind === "tag")
    .map((target) => normalizeTag(target.tag))
    .filter(Boolean);
  let changed = false;
  if (dirs.length)
    changed =
      metaApplyBulkUserTagDiff(dirs, remove ? [tag] : [], remove ? [] : [tag]) ||
      changed;
  let nested = false;
  for (const child of childTags) {
    if (remove ? metaRemoveTagParent(child, tag) : metaAddTagParent(child, tag))
      nested = true;
  }
  if (nested) {
    metaScheduleSave();
    refreshAfterTagMetadataChange();
  }
  if (!changed && !nested) return false;
  closeSelectMenuIfTargetMoved(identityBefore);
  const count = targets.length;
  const what = count === 1 ? "" : `${count} items `;
  showStatusMessage(
    remove
      ? `Removed ${what}from '${tagDisplayName(tag)}'.`
      : `Added ${what}to '${tagDisplayName(tag)}'.`,
  );
  return true;
}

// The draft lives outside the menu (ADD_TO_TAG_CREATE_DRAFTS), so the rebuild
// every cycler does reads the new value back from it.
function createAddToTagDraftCycleButton(label, options, draftKey, kind) {
  const draft = addToTagCreateDraft(kind);
  return buildCycleSubmenu(label, options, draft[draftKey] || "", (value) => {
    draft[draftKey] = value;
    draft[`${draftKey}Touched`] = true;
  });
}

// The press-only draft cycler. Unreferenced, kept beside its replacement.
function createAddToTagDraftCycleButtonPressOnly(label, options, draftKey, kind) {
  const draft = addToTagCreateDraft(kind);
  const state = menuCycleChoiceState(options, draft[draftKey] || "");
  if (!state) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-action", "keep");
  button.textContent = `${label}: ${state.currentLabel}`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const current = menuCycleChoiceState(options, draft[draftKey] || "");
    if (!current) return;
    draft[draftKey] = current.nextValue;
    draft[`${draftKey}Touched`] = true;
    const next = menuCycleChoiceState(options, draft[draftKey]);
    if (next) setMenuButtonLabelText(button, `${label}: ${next.currentLabel}`);
  });
  return button;
}

// Opens the naming field for one new Tag, with the draft's settings waiting to
// be applied to whatever name is committed.
function startAddToTagCreation(selectionTarget, draft = null) {
  if (!canUseBulkTagPlaceholderUi()) return false;
  const targets = addToTagEligibleTargets(selectionTarget);
  const dirs = targets
    .filter((target) => target.kind === "dir")
    .map((target) => normalizeDirPathValue(target.path))
    .filter(Boolean);
  const childTags = targets
    .filter((target) => target.kind === "tag")
    .map((target) => normalizeTag(target.tag))
    .filter(Boolean);
  if (!dirs.length && !childTags.length) return false;
  const createNew = addToTagCreateOverrides(draft);
  TAG_EDIT_PATH = null;
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  PREVIEW_BULK_TAG_EDIT = null;
  resetAddToTagCreateDraft();
  if (dirs.length) {
    if (WS.view && WS.view.bulkSelectMode) finalizeBulkSelectionAction();
    return setBulkTagPlaceholder(dirs, "New tag", "tag", "", "preview", {
      createNew,
    });
  }
  if (WS.view && WS.view.bulkSelectMode) finalizeBulkSelectionAction();
  return setBulkTagPlaceholder(childTags, "New tag", "tagInTag", "", "preview", {
    createNew,
  });
}

// onStart(draft) opens the naming field; pressing Create new passes no draft.
function createAddToTagCreateSubmenu(kind, onStart) {
  const draft = addToTagCreateDraft(kind);
  const exclusiveButton = document.createElement("button");
  exclusiveButton.type = "button";
  exclusiveButton.setAttribute("data-action", "keep");
  exclusiveButton.textContent = `${draft.exclusive ? "●" : "○"} Exclusive`;
  exclusiveButton.addEventListener("click", (event) => {
    event.stopPropagation();
    draft.exclusive = !draft.exclusive;
  });
  const sortButton = createAddToTagDraftCycleButton(
    "Sort",
    containerSortModeOptions(),
    "sortMode",
    kind,
  );
  const filtersButton = APPEARANCE_FILTERS_ENABLED
    ? createAddToTagDraftCycleButton(
        "Filters",
        appearancePresetMenuCycleOptions(),
        "appearancePresetId",
        kind,
      )
    : null;
  const mediaTypeButton = createAddToTagDraftCycleButton(
    "Media type",
    tagMediaFilterAxisCycleOptions(TAG_MEDIA_FILTER_MEDIA_TYPES, "All"),
    "mediaType",
    kind,
  );
  const setScoreButton = createAddToTagDraftCycleButton(
    scoreFilterOverrideLabel("set"),
    scoreFilterOverrideCycleOptions("set"),
    "setScore",
    kind,
  );
  const modelScoreButton = createAddToTagDraftCycleButton(
    scoreFilterOverrideLabel("model"),
    scoreFilterOverrideCycleOptions("model"),
    "modelScore",
    kind,
  );
  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.textContent = "Create";
  createButton.addEventListener("click", (event) => {
    event.stopPropagation();
    onStart(addToTagCreateDraft(kind));
  });
  return createDropdownMenuSubmenu(
    "Create new",
    [
      exclusiveButton,
      sortButton,
      filtersButton,
      mediaTypeButton,
      setScoreButton,
      modelScoreButton,
      createButton,
    ],
    "",
    {
      stateKey: `add-to-${kind}-create`,
      onActivate: () => {
        onStart(null);
        return false;
      },
    },
  );
}

// The hybrid row itself: pressing it runs the plain button it replaces,
// stepping in shows Create new and the Tag rows.
function createAddToTagHybridSubmenu(label, kind, plainButton, items) {
  const submenu = createDropdownMenuSubmenu(label, items, "", {
    stateKey: `add-to-${kind}`,
    onActivate: () => {
      plainButton.click();
      return false;
    },
  });
  submenu
    ?.querySelector?.(":scope > .dropdownMenuSubmenuPanel")
    ?.classList?.add("appMenuLongListPanel");
  return submenu || plainButton;
}

function createAddToTagSubmenu(tagButton, selectionTarget) {
  const targets = addToTagEligibleTargets(selectionTarget);
  if (!targets.length) return tagButton;
  const choices = addToTagChoiceNames(targets).map((name) =>
    createAddToTagToggleButton(
      name,
      targets.every((target) => addToTagTargetIsIn(target, name)),
      () => toggleSelectionInTag(name, selectionTarget),
    ),
  );
  return createAddToTagHybridSubmenu(ADD_TO_TAG_LABEL, "tag", tagButton, [
    createAddToTagCreateSubmenu("tag", (draft) =>
      startAddToTagCreation(selectionTarget, draft),
    ),
    ...choices,
  ]);
}

/* The select menu's first option. There is no Add To... submenu any more:
   Tag is the one place a selection is put, so its row is "Add tag" at the
   top level (Add tag to all contents joins it right below, in
   selectedItemMenuSectionItems), Favorite and Hidden are toggles under Folder
   options / Tag options, and Send to storage sits above the red removal row.
   Builders still hand in their plain "Tag" button; it comes back renamed and,
   when enabled, as the hybrid. */
const ADD_TO_TAG_LABEL = "Add tag";
const ADD_CONTENTS_TO_TAG_LABEL = "Add tag to all contents";
// Remove From... once listed Favorites and Hidden too; with those now toggles,
// what is left is the Tags the selection shares.
const REMOVE_TAG_LABEL = "Remove tag";
// The three above share one submenu, the select menu's first option.
const EDIT_TAGS_LABEL = "Edit tags";

function createSelectMenuAddToTagRow(tagButton, selectionTarget = null) {
  if (!tagButton) return null;
  tagButton.textContent = ADD_TO_TAG_LABEL;
  return tagButton.tagName === "BUTTON" && !tagButton.disabled
    ? createAddToTagSubmenu(tagButton, selectionTarget)
    : tagButton;
}

// A Favorite / Hidden toggle under Folder options or Tag options: ● when every
// selected item has it, and pressing it sets all of them the other way. The
// menu rebuilds itself after the press, which is what redraws the mark --
// unless the press took the item off the screen (hiding it with Hidden not
// revealed), when the menu closes rather than turn to whatever is selected next.
function createSelectMenuToggleButton(label, on, onToggle, disabled = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = `${on ? "●" : "○"} ${label}`;
  btn.disabled = !!disabled;
  btn.setAttribute("data-action", "keep");
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (btn.disabled) return;
    const identityBefore = selectMenuTargetIdentity();
    onToggle();
    closeSelectMenuIfTargetMoved(identityBefore);
  });
  return btn;
}

// The folder's full path on disk, as Finder has it: the library's own folder
// plus the folder's path inside it. A folder showing an ALT is on disk under
// that ALT's name (`sourcePath`), so that is the path copied.
function folderDiskPathForDirNode(node) {
  const rootPath = String(WS.meta?.fsRootHandle?._path || "").replace(/\/+$/, "");
  if (!node || !rootPath) return "";
  const rel = String(node.sourcePath || node.path || "").replace(/^\/+|\/+$/g, "");
  return rel ? `${rootPath}/${rel}` : rootPath;
}

// Folder options -> Copy path, for a single folder: puts the folder's Finder
// path on the clipboard and keeps the menu open, like any option.
function createCopyFolderPathButton(node, disabled = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Copy path";
  btn.disabled = !!disabled;
  btn.setAttribute("data-action", "keep");
  btn.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (btn.disabled) return;
    const diskPath = folderDiskPathForDirNode(node);
    const invoke = window.__TAURI__?.core?.invoke;
    if (!diskPath || typeof invoke !== "function") {
      showStatusMessage("Could not copy the path.");
      return;
    }
    try {
      await invoke("copy_text", { text: diskPath });
      showStatusMessage(`Copied ${diskPath}`);
    } catch {
      showStatusMessage("Could not copy the path.");
    }
  });
  return btn;
}

function folderPathHasDirectHidden(path) {
  return metaGetTags(String(path || "")).includes(HIDDEN_TAG);
}

// Folder options for one folder or several: Rename, Favorite, Hidden, then
// Overrides and Thumbnail -- everything about the folder itself, the way Tag
// options holds a Tag's own settings. The caller passes Rename in `before` and
// the two submenus in `after`, since it is the one that builds them. Hidden
// reads the folder's own mark, not one inherited from a hidden Tag, since the
// inherited kind is not this folder's to switch off.
function createFolderOptionsSubmenu(paths, disabled = false, extras = {}) {
  const list = (Array.isArray(paths) ? paths : [])
    .map((path) => normalizeDirPathValue(path))
    .filter(Boolean);
  if (!list.length) return null;
  const allFavorite = list.every((path) => metaHasFavorite(path));
  const allHidden = list.every((path) => folderPathHasDirectHidden(path));
  const favoriteButton = createSelectMenuToggleButton(
    "Favorite",
    allFavorite,
    () => {
      if (!metaSetFavoriteBulk(list, !allFavorite)) return;
      metaScheduleSave();
      if (allFavorite)
        showStatusMessage(
          list.length === 1
            ? "Removed from Favorites."
            : `${list.length} items removed from Favorites.`,
        );
    },
    disabled,
  );
  const hiddenButton = createSelectMenuToggleButton(
    "Hidden",
    allHidden,
    () => {
      metaSetHiddenBulk(list, !allHidden);
      metaScheduleSave();
      const subject = list.length === 1 ? "Folder" : `${list.length} folders`;
      showStatusMessage(`${subject} ${allHidden ? "no longer hidden" : "hidden"}.`);
    },
    disabled,
  );
  return createDropdownMenuSubmenu(
    "Folder options",
    [
      ...(extras.before || []),
      favoriteButton,
      hiddenButton,
      ...(extras.after || []),
    ].filter(Boolean),
  );
}
