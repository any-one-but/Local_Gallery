/* Inline edits and selection actions
   Rename and tag fields, and the selection actions. */

/* Every inline edit in the app -- rename, tag, album -- is a piece of module
   state (`RENAME_EDIT_PATH`, `RENAME_EDIT_FILE_ID`, `TAG_EDIT_PATH`,
   `TAG_ENTRY_RENAME_STATE`) that makes the next render draw an <input> on the
   matching row or card, plus this call to put the caret in it.

   The state and the input are therefore two separate things, and the whole
   class of "stuck field" bugs is what happens when they come apart: if the
   input is not there to be focused, the state stays set anyway, so the input
   is drawn again the next time that row or card renders -- unfocused. Every
   way out of an inline edit (Escape, commit, blur) is a listener *on the
   input*, and the input's own keydown stops every key from propagating, so an
   unfocused one cannot be escaped, committed or blurred. Nothing else clears
   the state. That is a hard lock with only a reload out of it.

   So the invariant is: an inline edit that could not be focused does not
   exist. `onMissing` is how the caller retracts its state, and it is not
   optional politeness -- a starter that omits it can strand the app.

   The check is deferred one frame past the resolve, because the resolve
   already runs inside a frame: a starter that re-renders asynchronously would
   otherwise be judged before its input existed. */
/* Each starter that can retract its edit takes a new generation. A retraction
   runs only while its generation is still the latest: an edit that was replaced
   by another before its check came round is not the pending edit any more, and
   clearing then would wipe its successor. That is exactly what Add To -> Tag ->
   Create did -- it opens the card's inline tag input and immediately swaps it
   for the new-tag placeholder, and the card input's check, finding no card
   input, cleared the placeholder a moment after it appeared. */
let INLINE_EDIT_RETRACT_GENERATION = 0;

function queueInlineInputFocus(resolveInput, onMissing) {
  if (typeof resolveInput !== "function") return;
  const retracts = typeof onMissing === "function";
  const generation = retracts
    ? ++INLINE_EDIT_RETRACT_GENERATION
    : INLINE_EDIT_RETRACT_GENERATION;
  requestAnimationFrame(() => {
    const input = resolveInput();
    if (input) {
      try {
        input.focus();
        input.select();
      } catch {}
      return;
    }
    if (!retracts) return;
    requestAnimationFrame(() => {
      if (resolveInput()) return;
      if (generation !== INLINE_EDIT_RETRACT_GENERATION) return;
      try {
        onMissing();
      } catch {}
    });
  });
}

/* The retraction half of the invariant above: drop whatever inline edit is
   pending and redraw without it. Returns whether anything was actually
   pending, so callers can use it as "did I just handle this key". */
function clearPendingInlineEdit(opts = null) {
  const silent = !!(opts && opts.silent);
  const had =
    !!RENAME_EDIT_PATH ||
    !!RENAME_EDIT_FILE_ID ||
    !!TAG_EDIT_PATH ||
    !!TAG_ENTRY_RENAME_STATE ||
    !!BULK_TAG_PLACEHOLDER;
  if (!had) return false;
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  TAG_EDIT_PATH = null;
  TAG_EDIT_IN_PREVIEW = false;
  PREVIEW_BULK_TAG_EDIT = null;
  TAG_ENTRY_RENAME_STATE = null;
  BULK_TAG_PLACEHOLDER = null;
  if (!silent) {
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
  }
  return true;
}

/* True when an inline edit is pending but the caret is not in it -- the state
   the app must never be able to sit in. Used by the back key so a stranded
   edit is a keypress to get out of rather than a reload, whatever stranded it. */
function pendingInlineEditIsUnfocused() {
  const pending =
    !!RENAME_EDIT_PATH ||
    !!RENAME_EDIT_FILE_ID ||
    !!TAG_EDIT_PATH ||
    !!TAG_ENTRY_RENAME_STATE ||
    !!BULK_TAG_PLACEHOLDER;
  if (!pending) return false;
  const active = document.activeElement;
  if (!active) return true;
  const tag = String(active.tagName || "").toUpperCase();
  return tag !== "INPUT" && tag !== "TEXTAREA";
}

function focusSelectedDirectoryInlineInput(selector) {
  queueInlineInputFocus(
    () => {
      if (!directoriesListEl) return;
      const selectedInput = directoriesListEl.querySelector(
        `.dirRow.selected ${selector}`,
      );
      return selectedInput || directoriesListEl.querySelector(selector);
    },
    () => clearPendingInlineEdit(),
  );
}

function findPreviewFolderCardByPath(path) {
  const p = String(path || "");
  if (!p || !previewBodyEl) return null;
  const cards = previewBodyEl.querySelectorAll(".folderCard[data-dir-path]");
  for (const card of cards) {
    if (String(card?.dataset?.dirPath || "") === p) return card;
  }
  return null;
}

function focusPreviewFolderInlineInput(path, selector) {
  const p = String(path || "");
  const sel = String(selector || "");
  if (!p || !sel) return;
  queueInlineInputFocus(
    () => {
      const card = findPreviewFolderCardByPath(p);
      if (!card || !card.querySelector) return;
      return card.querySelector(sel);
    },
    () => clearPendingInlineEdit(),
  );
}

function findPreviewFileCardById(fileId) {
  const id = String(fileId || "");
  if (!id || !previewBodyEl) return null;
  const cards = previewBodyEl.querySelectorAll(".fileCard[data-file-id]");
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (String(card?.dataset?.fileId || "") === id) return card;
  }
  return null;
}

function focusPreviewFileInlineInput(fileId, selector) {
  const id = String(fileId || "");
  const sel = String(selector || "");
  if (!id || !sel) return;
  queueInlineInputFocus(
    () => {
      const card = findPreviewFileCardById(id);
      if (!card || !card.querySelector) return;
      return card.querySelector(sel);
    },
    () => clearPendingInlineEdit(),
  );
}

/* Tagging folders opens the new-tag card in the preview grid, whatever asked
   for it (the select menu's Create new, the bindable tag key). There is no
   field on the item's own card any more (2026-10-25): the card's field takes
   a comma list, so one name or several, new or existing, go in one go. */
function startPreviewFolderTagEdit(paths) {
  const unique = Array.from(
    new Set((paths || []).map((p) => String(p || "")).filter(Boolean)),
  );
  if (!unique.length) return false;
  // Clear any active bulk selection (paths are already captured).
  if (WS.view && WS.view.bulkSelectMode) finalizeBulkSelectionAction();
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  TAG_EDIT_PATH = null;
  PREVIEW_BULK_TAG_EDIT = null;
  return setBulkTagPlaceholder(unique, "New tag", "tag", "", "preview", {
    createNew: addToTagCreateOverrides(null),
  });
}

function startPreviewFolderRenameEdit(path) {
  const p = String(path || "");
  if (!p) return false;
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Rename requires a writable folder.");
    return false;
  }
  clearBulkTagPlaceholder();
  closeActionMenus();
  PREVIEW_BULK_TAG_EDIT = null;
  TAG_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  RENAME_EDIT_PATH = p;
  // Do NOT move the file-pane selection here -- the same rule the tag edit
  // above already follows, and for the same reason. The item is already on
  // screen in the preview grid; re-rendering draws the input on its own card.
  // Selecting it calls syncPreviewToSelection({force:true}), which re-derives
  // the preview *from the file pane*, and when the grid and the file pane are
  // listing the same directory (any media folder reached by quick navigation)
  // that swaps the grid for the single-item view. The card the input was going
  // to be drawn on then does not exist, so nothing gets focused and the edit is
  // stranded -- see settleInlineEditFocus below for why that used to be fatal.
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  focusPreviewFolderInlineInput(p, ".previewFolderRenameInput");
  return true;
}

function startPreviewFileRenameEdit(fileId) {
  const id = String(fileId || "");
  if (!id) return false;
  const rec = WS.fileById.get(id);
  if (!rec) return false;
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Renaming files requires a writable folder.");
    return false;
  }
  clearBulkTagPlaceholder();
  closeActionMenus();
  PREVIEW_BULK_TAG_EDIT = null;
  TAG_EDIT_PATH = null;
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = id;
  // See startPreviewFolderRenameEdit: selecting the entry here is what moved
  // the location out from under the input.
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  focusPreviewFileInlineInput(id, ".previewFileRenameInput");
  return true;
}

function startPreviewTagRenameEdit(entry) {
  if (!entry || entry.kind !== "tag" || entry.special || entry.placeholder)
    return false;
  const tag = String(entry.tag || "").trim();
  const album = normalizeTagAlbumName(entry.album || "");
  const gallery = normalizeGalleryName(entry.gallery || "");
  const isAlbumEntry = !!album && !tag;
  const isGalleryEntry = !!gallery && !tag && !album;
  if (!tag && !isAlbumEntry && !isGalleryEntry) return false;
  const label = String(entry.label || entry.tag || album || gallery || tag);
  const paths = gatherTagPathsForDirs(getDirsForTagEntry(entry));
  // A tag may hold only albums and no folders; renaming still has to work.
  const baseNode =
    WS.dirByPath.get(String(entry.originPath || "")) || WS.nav.dirNode || WS.root;
  const taggedAlbums =
    tag && !isAlbumEntry && !isGalleryEntry
      ? getAlbumEntriesForTagForBaseNode(baseNode, tag)
      : [];
  if (!paths.length && !isAlbumEntry && !isGalleryEntry && !taggedAlbums.length) {
    showStatusMessage("No items contain that tag.");
    return false;
  }
  return beginTagEntryRename(
    {
      tag,
      album,
      gallery,
      label,
      paths,
      originPath: String(entry.originPath || ""),
      isAlbumEntry,
      isGalleryEntry,
    },
    "preview",
  );
}

function applyFolderScoreSelectionAction(delta) {
  const { paths, usedBulk } = getFolderTargetPathsForSelectionActions();
  if (!paths.length) {
    showStatusMessage("No folders selected.");
    return false;
  }
  if (usedBulk) finalizeBulkSelectionAction();
  metaBumpScoreBulk(paths, delta);
  return true;
}

function startTagSelectionEdit() {
  const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
  if (!paths.length) {
    showStatusMessage("No folders selected.");
    return false;
  }
  if (usedBulk) finalizeBulkSelectionAction();
  closeActionMenus();
  return startPreviewFolderTagEdit(paths);
}

function toggleFavoriteSelection() {
  const { paths, usedBulk } = getFolderTargetPathsForSelectionActions();
  if (!paths.length) {
    showStatusMessage("No items selected.");
    return false;
  }
  if (usedBulk) finalizeBulkSelectionAction();
  const allFavorite = paths.every((p) => metaHasFavorite(p));
  metaSetFavoriteBulk(paths, !allFavorite);
  return true;
}

function toggleHiddenSelection() {
  const tagSelection = getTagSelectionForKeybindAction();
  // Albums hide alongside tags here: hiddenTagKeyForEntry resolves whichever
  // one the entry is, so an album selection no longer falls through to the
  // folder-path branch below (which could never act on it).
  const hideableEntries = tagSelection.entries.filter(
    (entry) =>
      !!String(entry?.tag || "").trim() ||
      !!normalizeTagAlbumName(entry?.album || "") ||
      !!normalizeGalleryName(entry?.gallery || ""),
  );
  const tagKeys = Array.from(
    new Set(
      hideableEntries.map((entry) => hiddenTagKeyForEntry(entry)).filter(Boolean),
    ),
  );
  if (tagKeys.length) {
    const noun = hiddenToggleNounForEntries(hideableEntries);
    const allHidden = tagKeys.every((key) => metaHasHiddenTagByKey(key));
    let changed = false;
    for (let i = 0; i < tagKeys.length; i++) {
      if (metaSetHiddenTagByKey(tagKeys[i], !allHidden)) changed = true;
    }
    if (!changed) return false;
    if (tagSelection.usedBulk) finalizeBulkSelectionAction();
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      `${allHidden ? "Unhid" : "Hid"} ${tagKeys.length} ${noun}${tagKeys.length === 1 ? "" : "s"}.`,
    );
    return true;
  }
  const { paths, usedBulk } = getFolderTargetPathsForSelectionActions();
  if (!paths.length) {
    showStatusMessage("No items selected.");
    return false;
  }
  if (usedBulk) finalizeBulkSelectionAction();
  const allHidden = paths.every((p) => metaHasHidden(p));
  metaSetHiddenBulk(paths, !allHidden);
  return true;
}

// "Selected item(s)" resolves to folder paths: a folder selection is used
// directly, a file selection maps to the folders that contain the files (see
// getFolderTargetPathsForSelectionActions). Album/storage/trash all key on
// folders, so they share that resolver with favorite and hidden above.
function startAlbumSelectionEdit() {
  const { paths, usedBulk } = getFolderTargetPathsForSelectionActions();
  if (!paths.length) {
    showStatusMessage("No items selected.");
    return false;
  }
  // Open the album placeholder UI in whichever pane the user is working in,
  // matching how the bulk action menus invoke startBulkFolderAlbuming.
  const fromPreview =
    !directoriesPaneOpenEnabled() || WS.view?.activePane === "preview";
  if (usedBulk) finalizeBulkSelectionAction();
  closeActionMenus();
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  TAG_EDIT_PATH = null;
  startBulkFolderAlbuming(paths, fromPreview ? "preview" : "directories");
  return true;
}

function startGallerySelectionEdit() {
  const folderSelection = getFolderTargetPathsForSelectionActions();
  const tagSelection = getTagSelectionForKeybindAction();
  const targets = [];
  const seen = new Set();
  for (let i = 0; i < folderSelection.paths.length; i++) {
    const path = normalizeDirPathValue(folderSelection.paths[i]);
    const key = path ? `dir:${path}` : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    targets.push({ kind: "dir", path });
  }
  for (let i = 0; i < tagSelection.entries.length; i++) {
    const target = galleryTargetForTagEntry(tagSelection.entries[i]);
    if (!target) continue;
    const key =
      target.kind === "tag"
        ? `tag:${String(target.originPath || "")}:${target.tag}`
        : target.kind === "album"
          ? `album:${String(target.originPath || "")}:${target.album}`
          : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  if (!targets.length) {
    showStatusMessage("No items selected.");
    return false;
  }
  const fromPreview =
    !directoriesPaneOpenEnabled() || WS.view?.activePane === "preview";
  if (folderSelection.usedBulk || tagSelection.usedBulk)
    finalizeBulkSelectionAction();
  closeActionMenus();
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  TAG_EDIT_PATH = null;
  startBulkGallerying(targets, fromPreview ? "preview" : "directories");
  return true;
}

async function deleteSelectedTagAlbumEntries(entries, usedBulk = false, opts = {}) {
  const options = opts && typeof opts === "object" ? opts : {};
  const byTag = new Map();
  const albums = [];
  const seenAlbums = new Set();
  const galleries = [];
  const seenGalleries = new Set();

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (
      !entry ||
      entry.kind !== "tag" ||
      entry.special ||
      entry.placeholder
    )
      continue;
    const tag = String(entry.tag || "").trim();
    const album = normalizeTagAlbumName(entry.album || "");
    const gallery = normalizeGalleryName(entry.gallery || "");
    const originPath = String(entry.originPath || "");
    if (tag) {
      const paths = gatherTagPathsForDirs(
        getUnfilteredMembershipDirsForTagEntry(entry),
      );
      byTag.set(`${originPath}\n${tag}`, { tag, paths, originPath });
      continue;
    }
    if (gallery) {
      if (seenGalleries.has(gallery)) continue;
      seenGalleries.add(gallery);
      galleries.push(gallery);
      continue;
    }
    const key = `${originPath}\n${album}`;
    if (!album || seenAlbums.has(key)) continue;
    seenAlbums.add(key);
    albums.push({ album, originPath });
  }

  if (!byTag.size && !albums.length && !galleries.length) {
    showStatusMessage("No tags, albums, or galleries selected.");
    return false;
  }

  const deleteParts = [];
  if (byTag.size) deleteParts.push(`${byTag.size} tag${byTag.size === 1 ? "" : "s"}`);
  if (albums.length) deleteParts.push(`${albums.length} album${albums.length === 1 ? "" : "s"}`);
  if (galleries.length) deleteParts.push(`${galleries.length} galler${galleries.length === 1 ? "y" : "ies"}`);
  const deleteLabel =
    byTag.size && !albums.length && !galleries.length
      ? `Delete ${byTag.size} tag${byTag.size === 1 ? "" : "s"}? Nothing inside is deleted.`
      : `Delete ${deleteParts.join(" and ")}? Nothing inside is deleted. Their folders, tags, and albums return to their normal place.`;
  if (!options.skipConfirm) {
    if (
      !(await showAppMenuConfirm(deleteLabel, {
        danger: true,
      }))
    )
      return false;
  }

  if (usedBulk) finalizeBulkSelectionAction();
  closeActionMenus();
  let changed = false;
  for (const value of byTag.values()) {
    if (deleteTagEverywhere(value.tag)) changed = true;
  }
  let deletedCount = 0;
  let ungroupedTotal = 0;
  for (let i = 0; i < albums.length; i++) {
    const result = deleteTagAlbumByName(
      albums[i].album,
      albums[i].originPath,
    );
    if (!result.changed) continue;
    changed = true;
    deletedCount++;
    ungroupedTotal += Number(result.clearedTags) || 0;
  }
  let deletedGalleryCount = 0;
  for (let i = 0; i < galleries.length; i++) {
    if (!deleteGalleryByName(galleries[i])) continue;
    changed = true;
    deletedGalleryCount++;
  }
  if (!changed) {
    showStatusMessage(byTag.size ? "No folders updated." : "No tags updated.");
    return false;
  }

  metaScheduleSave();
  refreshAfterTagMetadataChange();
  if (deletedGalleryCount) {
    showStatusMessage(
      `Deleted ${deletedGalleryCount} galler${deletedGalleryCount === 1 ? "y" : "ies"}.`,
    );
  } else if (byTag.size && deletedCount) {
    showStatusMessage(
      `Removed ${byTag.size} tag${byTag.size === 1 ? "" : "s"} and deleted ${deletedCount} album${deletedCount === 1 ? "" : "s"}.`,
    );
  } else if (byTag.size) {
    showStatusMessage(
      `Removed ${byTag.size} tag${byTag.size === 1 ? "" : "s"}.`,
    );
  } else {
    showStatusMessage(
      `Deleted ${deletedCount} album${deletedCount === 1 ? "" : "s"} and ungrouped ${ungroupedTotal} tag${ungroupedTotal === 1 ? "" : "s"}.`,
    );
  }
  return true;
}

// True when the preview grid (not the file pane) owns the current selection.
function previewPaneOwnsSelection() {
  return !directoriesPaneOpenEnabled() || WS.view?.activePane === "preview";
}

// Keyboard equivalent of Cmd-clicking the current item: toggle it in/out of the
// multi-item (bulk) selection. Works in both the preview grid and the file pane.
function toggleSelectionInBulkKeybindAction() {
  if (!WS.root || VIEWER_MODE) return false;
  if (previewPaneOwnsSelection()) {
    const card = findSelectedPreviewCard();
    if (!card) {
      showStatusMessage("No item selected.");
      return false;
    }
    if (!WS.view.bulkSelectMode) {
      WS.view.bulkSelectMode = true;
      addPreviewCardBulkSelection(card);
    } else {
      togglePreviewCardBulkSelection(card);
    }
    if (!hasBulkSelection()) WS.view.bulkSelectMode = false;
    WS.view.previewSelectAnchorKey = String(
      card.dataset.previewItemKey || "",
    );
    refreshBulkSelectionUiFromPreview();
    return true;
  }
  const idx = Number(WS.nav.selectedIndex);
  const entry = WS.nav.entries[idx] || null;
  if (!entry || !isSelectableEntry(entry)) {
    showStatusMessage("No item selected.");
    return false;
  }
  if (!WS.view.bulkSelectMode) {
    WS.view.bulkSelectMode = true;
    addEntrySelection(entry);
  } else {
    toggleEntrySelection(entry);
  }
  if (!hasBulkSelection()) WS.view.bulkSelectMode = false;
  WS.view.dirSelectAnchorIndex = idx;
  setDirectoriesSelection(idx, { keepScroll: true });
  return true;
}

// Keyboard equivalent of Shift-clicking the current item. The anchor is the
// item most recently used by the Cmd-click-style action (or the current item
// when no anchor has been established yet), matching the pointer behavior in
// both selection surfaces.
function selectRangeInBulkKeybindAction() {
  if (!WS.root || VIEWER_MODE) return false;
  if (previewPaneOwnsSelection()) {
    const card = findSelectedPreviewCard();
    const targetKey = String(card?.dataset?.previewItemKey || "");
    if (!card || !targetKey) {
      showStatusMessage("No item selected.");
      return false;
    }
    const anchorKey = String(
      WS.view.previewSelectAnchorKey || targetKey,
    );
    addPreviewSelectionRange(anchorKey, targetKey, true);
    WS.view.previewSelectAnchorKey = targetKey;
    setPreviewSelectionKey(targetKey, { activate: true });
    refreshBulkSelectionUiFromPreview();
    return true;
  }

  const targetIndex = Number(WS.nav.selectedIndex);
  const entry = WS.nav.entries[targetIndex] || null;
  if (!entry || !isSelectableEntry(entry)) {
    showStatusMessage("No item selected.");
    return false;
  }
  const anchorIndex =
    WS.view.dirSelectAnchorIndex >= 0
      ? WS.view.dirSelectAnchorIndex
      : targetIndex;
  selectEntryRange(anchorIndex, targetIndex);
  WS.view.dirSelectAnchorIndex = targetIndex;
  setDirectoriesSelection(targetIndex, { keepScroll: true });
  return true;
}

function cancelMultiSelectionKeybindAction() {
  if (!WS.view.bulkSelectMode && !hasBulkSelection()) {
    showStatusMessage("No bulk selection to cancel.");
    return false;
  }
  closeActionMenus();
  WS.view.bulkSelectMode = true;
  return exitBulkSelectMode();
}

function selectAllInCurrentLocationKeybindAction() {
  if (!WS.root || VIEWER_MODE || !canUseBulkSelection()) return false;
  if (previewPaneOwnsSelection()) {
    const cards = getPreviewSelectableCards();
    if (cards.length) {
      clearBulkTagSelection();
      WS.view.bulkSelectMode = true;
      for (let i = 0; i < cards.length; i++) addPreviewCardBulkSelection(cards[i]);
      const selectedCard = findSelectedPreviewCard() || cards[0];
      WS.view.previewSelectAnchorKey = String(
        selectedCard?.dataset?.previewItemKey || cards[0]?.dataset?.previewItemKey || "",
      );
      refreshBulkSelectionUiFromPreview();
      showStatusMessage(`Selected ${cards.length} item${cards.length === 1 ? "" : "s"}.`);
      return true;
    }
  }

  const selectableEntries = (WS.nav.entries || []).filter(isSelectableEntry);
  if (!selectableEntries.length) {
    showStatusMessage("No items to select.");
    return false;
  }
  clearBulkTagSelection();
  WS.view.bulkSelectMode = true;
  for (let i = 0; i < selectableEntries.length; i++)
    addEntrySelection(selectableEntries[i]);
  const selectedIndex = Number(WS.nav.selectedIndex);
  WS.view.dirSelectAnchorIndex =
    Number.isFinite(selectedIndex) && selectedIndex >= 0
      ? selectedIndex
      : 0;
  renderDirectoriesPane(true);
  updatePreviewSelectionClasses();
  syncButtons();
  showStatusMessage(
    `Selected ${selectableEntries.length} item${selectableEntries.length === 1 ? "" : "s"}.`,
  );
  return true;
}

function selectedItemMenuAnchor() {
  const openMediaRec = currentOpenMediaFileRecordForAppMenu();
  if (openMediaRec && directoriesListEl) {
    const row = directoriesListEl.querySelector(
      `.dirRow[data-file-id="${cssEscapeValue(openMediaRec.id)}"]`,
    );
    if (row) return row;
    if (VIEWER_MODE) {
      if (viewerVideoEl && viewerVideoEl.style.display !== "none")
        return viewerVideoEl;
      if (viewerImgEl && viewerImgEl.style.display !== "none")
        return viewerImgEl;
      if (viewport) return viewport;
    }
    if (previewVideoEl && previewVideoEl.style.display !== "none")
      return previewVideoEl;
    if (previewImgEl && previewImgEl.style.display !== "none")
      return previewImgEl;
  }
  if (previewPaneOwnsSelection()) {
    const card = findSelectedPreviewCard();
    if (card) return card;
  }
  if (!directoriesListEl) return null;
  return (
    directoriesListEl.querySelector(".dirRow.selected") ||
    directoriesListEl.querySelector(
      `.dirRow[data-entry-index="${Number(WS.nav.selectedIndex)}"]`,
    )
  );
}

function syncOpenMediaSelectionForAppMenu() {
  const rec = currentOpenMediaFileRecordForAppMenu();
  if (!rec) return false;
  const contextDir = currentOpenMediaContextDirForAppMenu();
  syncDirectoriesSelectionToFileRecord(rec, {
    syncPreview: false,
    renderPreview: false,
    pendingDirScrollMode: "center-selected",
    recordHistory: false,
    simulatedTagSourceDir: contextDir,
  });
  updatePreviewSelectionClasses();
  return true;
}

/* The bound key opens the *select* menu now -- the selected item's own actions.
   The app menu is on Tab and needs no selection. */
function openAppMenuForSelectionKeybindAction() {
  if (!WS.root) return false;
  syncOpenMediaSelectionForAppMenu();
  const anchor = selectedItemMenuAnchor();
  if (!anchor) {
    showStatusMessage("No item selected.");
    return false;
  }
  return openSelectMenu(anchor);
}

/* Tab. Hard-bound, unbindable, and deliberately independent of the selection:
   the app menu is about the library and the app, so it opens whether or not
   anything is selected, and lands wherever `Menu placement` says. */
function toggleAppMenuFromReservedKey() {
  if (!WS.root) return false;
  syncOpenMediaSelectionForAppMenu();
  return openAppMenu(selectedItemMenuAnchor(), "app");
}

function startFolderRenameSelection() {
  const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
  if (!paths.length) {
    showStatusMessage("No folders selected.");
    return false;
  }
  if (paths.length > 1) {
    showStatusMessage("Select one folder to rename.");
    return false;
  }

  const path = String(paths[0] || "");
  const dirNode = WS.dirByPath.get(path);
  if (!dirNode) return false;
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Rename requires a writable folder.");
    return false;
  }

  if (usedBulk) finalizeBulkSelectionAction();

  closeActionMenus();
  TAG_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  RENAME_EDIT_PATH = path;
  clearBulkTagPlaceholder();
  selectDirectoryEntryByPath(path);
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  focusSelectedDirectoryInlineInput(".renameEditInput");
  return true;
}

function startFileRenameSelection() {
  const { ids, usedBulk } = getFileSelectionForKeybindAction();
  if (!ids.length) {
    showStatusMessage("No files selected.");
    return false;
  }
  if (ids.length > 1) {
    showStatusMessage("Select one file to rename.");
    return false;
  }

  const id = String(ids[0] || "");
  const rec = WS.fileById.get(id);
  if (!rec) return false;
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Renaming files requires a writable folder.");
    return false;
  }

  if (usedBulk) finalizeBulkSelectionAction();

  closeActionMenus();
  TAG_EDIT_PATH = null;
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = id;
  clearBulkTagPlaceholder();
  selectFileEntryById(id);
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  focusSelectedDirectoryInlineInput(".renameEditInput");
  return true;
}

function startRenameSelection() {
  const previewActive =
    !directoriesPaneOpenEnabled() || WS.view?.activePane === "preview";
  const previewCard = findSelectedPreviewCard();
  const previewKind = String(previewCard?.dataset?.previewItemKind || "");
  const previewKey = String(WS.view?.previewSelectedKey || "");
  if (previewActive) {
    if (previewKind === "file" || previewKey.startsWith("file:")) {
      const id =
        previewFileIdForCard(previewCard) ||
        (previewKey.startsWith("file:") ? previewKey.slice(5) : "");
      if (id) return startPreviewFileRenameEdit(id);
    }
    if (previewKind === "dir" || previewKey.startsWith("dir:")) {
      const p =
        previewDirPathForCard(previewCard) ||
        previewDirPathForSelectionKey(previewKey);
      if (p) return startPreviewFolderRenameEdit(p);
    }
    if (previewKind === "tag" || previewKey.startsWith("tag:")) {
      const card = previewCard;
      const entry =
        card && card.__previewTagEntry ? card.__previewTagEntry : null;
      if (entry) return startPreviewTagRenameEdit(entry);
    }
  }
  const currentEntry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (
    currentEntry &&
    currentEntry.kind === "tag" &&
    !currentEntry.special &&
    !currentEntry.placeholder
  ) {
    return beginTagEntryRename(
      {
        tag: String(currentEntry.tag || "").trim(),
        album: normalizeTagAlbumName(currentEntry.album || ""),
        gallery: normalizeGalleryName(currentEntry.gallery || ""),
        label: String(
          currentEntry.label || currentEntry.tag || currentEntry.album || currentEntry.gallery || "",
        ),
        paths: gatherTagPathsForDirs(getDirsForTagEntry(currentEntry)),
        originPath: String(currentEntry.originPath || ""),
        isAlbumEntry: !!currentEntry.album && !currentEntry.tag,
        isGalleryEntry:
          !!currentEntry.gallery && !currentEntry.tag && !currentEntry.album,
      },
      "directories",
    );
  }
  const { ids } = getFileSelectionForKeybindAction();
  if (ids.length) return startFileRenameSelection();
  return startFolderRenameSelection();
}

function handleSelectionKeybindAction(action) {
  if (!action || !WS.root || VIEWER_MODE) return false;
  switch (action) {
    case "scoreUpSelection":
      return applyFolderScoreSelectionAction(1);
    case "scoreDownSelection":
      return applyFolderScoreSelectionAction(-1);
    case "tagSelection":
      return startTagSelectionEdit();
    case "favoriteSelection":
      return toggleFavoriteSelection();
    case "hiddenSelection":
      return toggleHiddenSelection();
    case "renameSelection":
      return startRenameSelection();
    case "toggleSelectionInBulk":
      return toggleSelectionInBulkKeybindAction();
    case "selectRangeInBulk":
      return selectRangeInBulkKeybindAction();
    case "cancelMultiSelection":
      return cancelMultiSelectionKeybindAction();
    case "selectAllInLocation":
      return selectAllInCurrentLocationKeybindAction();
    case "openAppMenu":
      return openAppMenuForSelectionKeybindAction();
    default:
      return false;
  }
}
