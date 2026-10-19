/* Visibility and the Trash
   Child folder listings, the visibility switches and the Trash entry. */

function getChildDirsForNodeBase(dirNode) {
  if (!dirNode) return [];
  ensureDirectoryChildNodesFromCatalog(dirNode);
  const base = sortDirsForDisplay(dirNode.childrenDirs)
    .filter((d) => !isInternalTrashDirNode(d))
    .filter((d) => !dirNodeIsHiddenAlt(d))
    .filter((d) => dirCanAppearUnderCurrentContentFilters(d));
  if (isPathInsideInternalTrash(dirNode.path || "")) return base;
  const showHidden =
    WS.view.hiddenMode ||
    showHiddenFolderEnabled() ||
    (isViewingTagFolder() && WS.view.tagFolderActiveMode === "hidden");
  const visibleBase = showHidden
    ? base
    : base.filter((d) => !isDirOrAncestorHidden(d));
  return visibleBase.filter((d) => dirPassesScoreFilter(d));
}

function showRootViewEnabled() {
  return true;
}

function includeHiddenItemsInStatsEnabled() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return scoreInterfaceEnabled(opt) && showHiddenFolderEnabled();
}

function showHiddenFolderEnabled() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return !!(opt && opt.showHiddenFolder);
}

// The utility containers -- Trash, Storage, Untagged, All tags, All Models and
// All Sets -- are shown and hidden together, by the one Utility containers
// switch (Basics). Each keeps its own accessor so callers say which one they
// mean; the old per-container options are still read, once, to seed it.
function showUtilityContainersEnabled() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return !!(opt && opt.showUtilityContainers);
}

function showTrashFolderEnabled() {
  return showUtilityContainersEnabled();
}

function showStorageFolderEnabled() {
  return showUtilityContainersEnabled();
}

const ASPECT_RATIO_STORAGE_OPTION_BY_BUCKET = Object.freeze({
  portrait: "storePortraitAspectRatioFiles",
  square: "storeSquareAspectRatioFiles",
  landscape: "storeLandscapeAspectRatioFiles",
});

function aspectRatioStorageOptionKeyForBucket(bucket) {
  const key = String(bucket || "").trim().toLowerCase();
  return ASPECT_RATIO_STORAGE_OPTION_BY_BUCKET[key] || "";
}

function aspectRatioStorageEnabledForBucket(bucket, options = null) {
  const key = aspectRatioStorageOptionKeyForBucket(bucket);
  if (!key) return false;
  const opt = options || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return !!(opt && opt[key]);
}

function anyAspectRatioStorageEnabled(options = null) {
  // Auto-routing by aspect ratio was removed from the UI; keep it permanently
  // inert so any previously-saved store* flags can never re-trigger it.
  return false;
}

const MEDIA_TYPE_STORAGE_OPTION_BY_TYPE = Object.freeze({
  images: "storeImageFiles",
  videos: "storeVideoFiles",
});

function normalizeMediaTypeStorageType(type) {
  const raw = String(type || "").trim().toLowerCase();
  if (raw === "image" || raw === "images") return "images";
  if (raw === "video" || raw === "videos") return "videos";
  if (raw === "text" || raw === "markdown") return "text";
  return "";
}

function mediaTypeStorageOptionKeyForType(type) {
  const normalized = normalizeMediaTypeStorageType(type);
  return MEDIA_TYPE_STORAGE_OPTION_BY_TYPE[normalized] || "";
}

function mediaTypeStorageEnabledForType(type, options = null) {
  const key = mediaTypeStorageOptionKeyForType(type);
  if (!key) return false;
  const opt = options || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return !!(opt && opt[key]);
}

function anyMediaTypeStorageEnabled(options = null) {
  // Auto-routing by media type was removed from the UI; keep it inert.
  return false;
}

function mediaTypeStorageLabel(type) {
  const normalized = normalizeMediaTypeStorageType(type);
  if (normalized === "images") return "Image";
  if (normalized === "videos") return "Video";
  if (normalized === "text") return "Text";
  return "Media";
}

function aspectRatioStorageLabel(bucket, enabled = null) {
  const normalized = aspectRatioBucketForValue(
    bucket === "portrait" ? 0.75 : bucket === "square" ? 1 : 1.5,
  );
  const label = labelForAspectRatioFilterMode(normalized).toLowerCase();
  const active =
    enabled == null ? aspectRatioStorageEnabledForBucket(normalized) : !!enabled;
  return `${active ? "Remove" : "Send"} all ${label} files ${active ? "from" : "to"} storage`;
}

function tortoiseNavigationEnabled() {
  return false;
}

function topBarEnabled() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return !(opt && opt.showTopBar === false);
}

// Hiding the top bar takes its search with it: a search in progress is
// cleared (its results would otherwise stay on screen with nothing to show
// or end them), and the field is disabled so nothing can focus it.
function applyTopBarFromOptions() {
  const shown = topBarEnabled();
  const appEl = document.getElementById("app");
  if (appEl) appEl.classList.toggle("topBarHidden", !shown);
  // Looked up here: this can run before the script's element constants exist.
  const input = document.getElementById("directoriesSearchInput");
  if (shown || !input) return;
  if (WS.root && directorySearchInteractionActive()) clearDirectorySearchUi();
  input.disabled = true;
}

function setAppMenuTopBar(shown) {
  setOptionValue("showTopBar", !!shown);
  refreshLiveSettingsPaneFromKeyboardAction();
  applyOptionsEverywhere(false);
  syncButtons();
  showStatusMessage(`Top bar: ${shown ? "On" : "Off"}`);
  return true;
}

function quickNavigationEnabled() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return !!(opt && opt.quickNavigation);
}

function showUntaggedFolderEnabled() {
  return showUtilityContainersEnabled();
}

function showAllTagsFolderEnabled() {
  return showUtilityContainersEnabled();
}

function showAllModelsFolderEnabled() {
  return showUtilityContainersEnabled();
}

function showAllSetsFolderEnabled() {
  return showUtilityContainersEnabled();
}

function showCertifiedFreshFolderEnabled() {
  return showUtilityContainersEnabled();
}

function showTagStorageFolderEnabled() {
  return showUtilityContainersEnabled();
}

function showModelMediaFoldersEnabled() {
  return showUtilityContainersEnabled();
}

function getInternalTrashRootNode() {
  return WS.dirByPath.get(INTERNAL_TRASH_DIR_NAME) || null;
}

function internalTrashHasItems() {
  const trashNode = getInternalTrashRootNode();
  if (!trashNode) return false;
  return !!(
    (Array.isArray(trashNode.childrenDirs) && trashNode.childrenDirs.length) ||
    (Array.isArray(trashNode.childrenFiles) && trashNode.childrenFiles.length)
  );
}

function internalTrashTopLevelItemCount() {
  const trashNode = getInternalTrashRootNode();
  if (!trashNode) return 0;
  const dirCount = Array.isArray(trashNode.childrenDirs)
    ? trashNode.childrenDirs.length
    : 0;
  const fileCount = Array.isArray(trashNode.childrenFiles)
    ? trashNode.childrenFiles.length
    : 0;
  return dirCount + fileCount;
}

function shouldShowRootTrashEntry(dirNode) {
  return !!(
    dirNode &&
    dirNode === WS.root &&
    showTrashFolderEnabled()
  );
}

function buildRootTrashDirEntry() {
  const trashNode = getInternalTrashRootNode();
  if (!trashNode) return null;
  return {
    kind: "dir",
    node: trashNode,
    specialRootTrash: true,
  };
}

function isTrashRootPortalEntry(entry) {
  return !!(
    entry &&
    entry.kind === "dir" &&
    entry.specialRootTrash &&
    isInternalTrashDirNode(entry.node)
  );
}

function isTrashRootPortalNode(node) {
  return !!node && node.parent === WS.root && isInternalTrashDirNode(node);
}

function isPutBackEligibleTrashPath(path) {
  const normalized = normalizeWorkspaceRelPath(path);
  return !!(normalized && isDirectChildOfInternalTrash(normalized));
}

function trashTopLevelItemPathForPath(path) {
  const normalized = normalizeWorkspaceRelPath(path);
  if (!normalized || normalized === INTERNAL_TRASH_DIR_NAME) return "";
  if (!isPathInsideInternalTrash(normalized)) return "";
  const rest = normalized.slice(INTERNAL_TRASH_DIR_NAME.length + 1);
  const name = rest.split("/").filter(Boolean)[0] || "";
  if (!name || isInternalTrashDirName(name)) return "";
  return `${INTERNAL_TRASH_DIR_NAME}/${name}`;
}

function trashTopLevelItemPathForFileRecord(rec) {
  return trashTopLevelItemPathForPath(String(rec?.dirPath || ""));
}

function fallbackRootRestorePathForTrashPath(path) {
  const normalized = normalizeWorkspaceRelPath(path);
  if (!isPutBackEligibleTrashPath(normalized)) return "";
  // Subfolders must go back under their tracked parent and never silently
  // resurface at root. If that parent is gone, put-back is simply disallowed
  // and the user is expected to sort it out with their own file manager.
  const restoreInfo = metaGetTrashRestoreInfo(normalized);
  const originalPath = normalizeWorkspaceRelPath(restoreInfo?.originalPath);
  if (originalPath && originalPath.includes("/")) return "";
  const name = normalized.slice(INTERNAL_TRASH_DIR_NAME.length + 1);
  if (!name || name.includes("/") || isInternalTrashDirName(name)) return "";
  return name;
}

function restoreTargetPathForTrashPath(path) {
  const normalized = normalizeWorkspaceRelPath(path);
  if (!isPutBackEligibleTrashPath(normalized)) return "";
  const restoreInfo = metaGetTrashRestoreInfo(normalized);
  const originalPath = normalizeWorkspaceRelPath(restoreInfo?.originalPath);
  if (originalPath && !isPathInsideInternalTrash(originalPath)) return originalPath;
  return fallbackRootRestorePathForTrashPath(normalized);
}

// A trashed item can only be put back when the directory it would land in still
// exists. Root-level items always restore to root; a subfolder needs its tracked
// parent to still be present in the workspace tree.
function canPutBackTrashPath(path) {
  const trashItemPath = trashTopLevelItemPathForPath(path);
  if (!trashItemPath) return false;
  const target = restoreTargetPathForTrashPath(trashItemPath);
  if (!target) return false;
  const parts = target.split("/").filter(Boolean);
  parts.pop();
  const parentPath = parts.join("/");
  if (!parentPath) return true;
  return WS.dirByPath.has(parentPath);
}

// Trashed folders are listed by their original location so a subfolder buried
// several levels deep is identifiable at a glance (root-level items just show
// their own name).
function trashItemDisplayPathForPath(path) {
  const normalized = normalizeWorkspaceRelPath(path);
  if (!isDirectChildOfInternalTrash(normalized)) return "";
  const restoreInfo = metaGetTrashRestoreInfo(normalized);
  const originalPath = normalizeWorkspaceRelPath(restoreInfo?.originalPath);
  if (originalPath && !isPathInsideInternalTrash(originalPath)) {
    return displayRelPath(originalPath);
  }
  return "";
}

function navigateOutOfTrashIfHidden() {
  if (shouldShowRootTrashEntry(WS.root)) return false;
  const navPath = String(WS.nav.dirNode?.path || "");
  const previewDirPath = String(getPreviewTargetDir()?.path || "");
  if (!isPathInsideInternalTrash(navPath) && !isPathInsideInternalTrash(previewDirPath)) {
    return false;
  }
  return navigateToTopLevelRootAfterSystemPortalDisappears();
}

function navigateToTopLevelRootAfterSystemPortalDisappears() {
  if (!WS.root) return false;
  cancelPendingNavigationRender();
  allowMenuClose();
  closeActionMenus();
  clearTagNavigationStack();
  WS.view.tagFolderActiveMode = "";
  WS.view.tagFolderActiveTag = "";
  WS.view.tagFolderActiveAlbum = "";
  WS.view.tagFolderOriginPath = "";
  WS.view.favoritesRootActive = false;
  WS.view.hiddenRootActive = false;
  WS.view.searchRootActive = false;
  WS.view.previewSearchActive = false;
  WS.nav.dirNode = WS.root;
  WS.view.aboveRootView = showRootViewEnabled();
  WS.view.previewFolderBridgeReturnState = null;
  WS.view.previewFileSelectionBridgeActive = false;
  WS.view.previewFileBridgeReturnState = null;
  WS.view.pendingPreviewSelectionKey = "";
  WS.view.previewSelectedKey = "";
  TAG_EDIT_PATH = null;
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  clearBulkTagPlaceholder();
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
  syncPreviewToSelection({ force: true });
  return true;
}

function navigateOutOfStorageIfHidden() {
  if (showStorageFolderEnabled()) return false;
  const viewingStoragePortal =
    isViewingTagFolder() && WS.view.tagFolderActiveMode === "storage";
  const navStorage = isStorageStubDirNode(WS.nav.dirNode);
  const previewTarget = getPreviewTargetDir();
  const previewStorage =
    isStorageStubDirNode(previewTarget) ||
    String(previewTarget?._tagPreviewMode || "") === "storage";
  if (!viewingStoragePortal && !navStorage && !previewStorage) return false;
  return navigateToTopLevelRootAfterSystemPortalDisappears();
}
