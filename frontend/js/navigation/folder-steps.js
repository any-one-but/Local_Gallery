/* Folder steps
   Stepping between files and jumping between folders. */

function firstFileEntryIndexForDirEntries() {
  for (let i = 0; i < WS.nav.entries.length; i++)
    if (WS.nav.entries[i]?.kind === "file") return i;
  return -1;
}

function lastFileEntryIndexForDirEntries() {
  for (let i = WS.nav.entries.length - 1; i >= 0; i--)
    if (WS.nav.entries[i]?.kind === "file") return i;
  return -1;
}

function slideStepFileInternal(step) {
  if (!WS.root || !WS.nav.dirNode) return { moved: false, dirChanged: false };
  if (WS.view.folderBehavior !== "slide")
    return { moved: false, dirChanged: false };
  if (searchResultsVisibleInDirectoriesPane())
    return { moved: false, dirChanged: false };
  if (WS.view.favoritesMode && WS.view.favoritesRootActive)
    return { moved: false, dirChanged: false };
  if (WS.view.hiddenMode && WS.view.hiddenRootActive)
    return { moved: false, dirChanged: false };

  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (!entry || entry.kind !== "file")
    return { moved: false, dirChanged: false };

  const fileIdxs = [];
  for (let i = 0; i < WS.nav.entries.length; i++)
    if (WS.nav.entries[i]?.kind === "file") fileIdxs.push(i);
  if (!fileIdxs.length) return { moved: false, dirChanged: false };

  const pos = fileIdxs.indexOf(WS.nav.selectedIndex);
  if (pos === -1) return { moved: false, dirChanged: false };

  const nextPos = pos + step;
  if (nextPos >= 0 && nextPos < fileIdxs.length) {
    WS.nav.selectedIndex = fileIdxs[nextPos];
    syncPreviewToSelection({ force: true });
    return { moved: true, dirChanged: false };
  }

  if (step > 0) {
    const nextDir = getNextSiblingDirWithFiles(WS.nav.dirNode);
    if (!nextDir) return { moved: false, dirChanged: false };
    WS.nav.dirNode = nextDir;
    if (searchBrowsingResultFolder())
      enterSearchResultContext(nextDir.path || "");
    TAG_EDIT_PATH = null;
    clearBulkTagPlaceholder();
    syncBulkSelectionForCurrentDir();
    syncFavoritesUi();
    syncHiddenUi();
    syncTagUiForCurrentDir();
    rebuildDirectoriesEntries();
    const idx = firstFileEntryIndexForDirEntries();
    if (idx >= 0) WS.nav.selectedIndex = idx;
    else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
    syncPreviewToSelection({ force: true });
    return { moved: true, dirChanged: true };
  } else {
    const prevDir = getPrevSiblingDirWithFiles(WS.nav.dirNode);
    if (!prevDir) return { moved: false, dirChanged: false };
    WS.nav.dirNode = prevDir;
    if (searchBrowsingResultFolder())
      enterSearchResultContext(prevDir.path || "");
    TAG_EDIT_PATH = null;
    clearBulkTagPlaceholder();
    syncBulkSelectionForCurrentDir();
    syncFavoritesUi();
    syncHiddenUi();
    syncTagUiForCurrentDir();
    rebuildDirectoriesEntries();
    const idx = lastFileEntryIndexForDirEntries();
    if (idx >= 0) WS.nav.selectedIndex = idx;
    else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
    syncPreviewToSelection({ force: true });
    return { moved: true, dirChanged: true };
  }
}

function slideMoveFiles(delta) {
  const step = delta > 0 ? 1 : -1;
  let remaining = Math.abs(delta);
  let moved = false;
  let dirChanged = false;

  while (remaining > 0) {
    const r = slideStepFileInternal(step);
    if (!r.moved) break;
    moved = true;
    if (r.dirChanged) dirChanged = true;
    remaining--;
  }

  if (!moved) {
    WS.view.pendingDirScroll = "";
    return;
  }

  renderDirectoriesPane();
  renderPreviewPane(dirChanged);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function canUseFolderJumpActions() {
  if (!WS.root || !WS.nav.dirNode) return false;
  if (searchResultsVisibleInDirectoriesPane()) return false;
  if (WS.view.favoritesMode && WS.view.favoritesRootActive) return false;
  if (WS.view.hiddenMode && WS.view.hiddenRootActive) return false;
  return true;
}

function jumpToDirectoryFirstFile(dirNode) {
  return jumpToDirectoryFile(dirNode, null);
}

// Moves the file pane into `dirNode` with `fileId` open (its first file when
// that one is not listed), the way Next folder does.
function jumpToDirectoryFile(dirNode, fileId = null) {
  if (!dirNode) return false;
  WS.nav.dirNode = dirNode;
  if (searchBrowsingResultFolder())
    enterSearchResultContext(dirNode.path || "");
  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();

  const wanted = fileId == null ? "" : String(fileId);
  const exact = wanted
    ? WS.nav.entries.findIndex(
        (entry) => entry && entry.kind === "file" && String(entry.id || "") === wanted,
      )
    : -1;
  const idx = exact >= 0 ? exact : firstFileEntryIndexForDirEntries();
  if (idx >= 0) WS.nav.selectedIndex = idx;
  else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);

  syncPreviewToSelection({ force: true });
  renderDirectoriesPane();
  renderPreviewPane(true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  return idx >= 0;
}

function jumpToNextFolderFirstFile() {
  if (!canUseFolderJumpActions()) return;
  // Same dual role as previewPaneFolderJump: column-edge within a folder grid,
  // sibling media jump otherwise.
  if (tryFolderJumpColumnEdgeInCurrentLocation("bottom")) return;
  const nextDir = getNextSiblingDirWithFiles(WS.nav.dirNode);
  if (!nextDir) return;
  jumpToDirectoryFirstFile(nextDir);
}

function jumpToPrevFolderFirstFile() {
  if (!canUseFolderJumpActions()) return;
  if (tryFolderJumpColumnEdgeInCurrentLocation("top")) return;
  const prevDir = getPrevSiblingDirWithFiles(WS.nav.dirNode);
  if (!prevDir) return;
  jumpToDirectoryFirstFile(prevDir);
}
