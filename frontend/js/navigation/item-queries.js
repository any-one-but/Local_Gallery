/* Item queries
   What is selected or visible, native paths and thumbnail visibility. */

function canUseBulkSelection() {
  if (!WS.root) return false;
  if (WS.nav.dirNode) return true;
  if (searchResultsVisibleInDirectoriesPane()) return true;
  if (WS.view.favoritesMode && WS.view.favoritesRootActive) return true;
  if (WS.view.hiddenMode && WS.view.hiddenRootActive) return true;
  return false;
}

function getVisibleDirPathsInEntries() {
  const set = new Set();
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (!entry || entry.kind !== "dir") continue;
    const p = String(entry.node?.path || "");
    if (p) set.add(p);
  }
  return set;
}

function getVisiblePreviewDirPaths() {
  const set = new Set();
  const cards = getPreviewSelectableCards();
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (String(card?.dataset?.previewItemKind || "") !== "dir") continue;
    const p = previewDirPathForCard(card);
    if (p) set.add(p);
  }
  return set;
}

function getVisibleFileIdsInEntries() {
  const set = new Set();
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (!entry || entry.kind !== "file") continue;
    const id = String(entry.id || "");
    if (id) set.add(id);
  }
  return set;
}

function getVisiblePreviewFileIds() {
  const set = new Set();
  const cards = getPreviewSelectableCards();
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (String(card?.dataset?.previewItemKind || "") !== "file") continue;
    const id = previewFileIdForCard(card);
    if (id) set.add(id);
  }
  return set;
}

function getSelectedPathsInCurrentDir() {
  const baseSet = getVisibleDirPathsInEntries();
  const previewSet = getVisiblePreviewDirPaths();
  return Array.from(WS.view.bulkTagSelectedPaths || []).filter((p) => {
    const value = String(p || "");
    return baseSet.has(value) || previewSet.has(value);
  });
}

function tagEntrySelectionKey(entry) {
  if (!entry || entry.kind !== "tag") return "";
  if (entry.placeholder) return "";
  // Same-named albums/tags/specials that live in different folders are distinct
  // items, so the selection identity must include the entry's scope (originPath).
  // Without this, a bulk action on one folder's "Albums" would also hit an
  // identically named album/tag/bucket in another folder, e.g. tagging a child
  // folder's album would also tag a same-named album in the parent, because the
  // parent's entry sits in WS.nav.entries and matched the name-only key.
  const scope = encodeURIComponent(normalizeTagAlbumScopePath(entry.originPath || ""));
  if (entry.album && !entry.tag) {
    const album = normalizeTagAlbumName(entry.album);
    return album ? `tag-album:${scope}:${album}` : "";
  }
  if (entry.gallery && !entry.tag && !entry.album) {
    const gallery = normalizeGalleryName(entry.gallery);
    return gallery ? `tag-gallery:${gallery}` : "";
  }
  if (entry.special) {
    if (entry.special === "favorites") {
      return tagThumbnailKeyForEntry(entry);
    }
    return `special:${scope}:${String(entry.special || "")}`;
  }
  const tag = normalizeTag(entry.tag || "");
  if (!tag) return "";
  // One Tag per name, wherever its card is drawn.
  return `tag:${tag}`;
}

function isTagEntryRenameActive(entry, state = TAG_ENTRY_RENAME_STATE) {
  if (!entry || entry.kind !== "tag" || entry.special || !state) return false;
  if (entry.placeholder) return !!state.placeholder;
  if (tagEntryRenameStateIsAlbum(state)) {
    return (
      !!entry.album &&
      !entry.tag &&
      normalizeTagAlbumName(entry.album || "") ===
        normalizeTagAlbumName(state.album || state.label || "")
    );
  }
  if (tagEntryRenameStateIsGallery(state)) {
    return (
      !!entry.gallery &&
      !entry.tag &&
      !entry.album &&
      normalizeGalleryName(entry.gallery || "") ===
        normalizeGalleryName(state.gallery || state.label || "")
    );
  }
  return !!entry.tag && String(entry.tag || "") === String(state.tag || "");
}

function getVisibleTagFolderKeysInEntries() {
  const set = new Set();
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (!entry || entry.kind !== "tag") continue;
    const key = tagEntrySelectionKey(entry);
    if (key) set.add(key);
  }
  return set;
}

function getVisiblePreviewTagFolderKeys() {
  const set = new Set();
  const cards = getPreviewSelectableCards();
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (String(card?.dataset?.previewItemKind || "") !== "tag") continue;
    const key = previewTagFolderKeyForCard(card);
    if (key) set.add(key);
  }
  return set;
}

function getSelectedTagFolderKeysInCurrentView() {
  const baseSet = getVisibleTagFolderKeysInEntries();
  const previewSet = getVisiblePreviewTagFolderKeys();
  return Array.from(WS.view.bulkTagFolderSelectedKeys || []).filter((k) => {
    const value = String(k || "");
    return baseSet.has(value) || previewSet.has(value);
  });
}

function getSelectedTagEntriesInCurrentView() {
  const keys = new Set(getSelectedTagFolderKeysInCurrentView());
  if (!keys.size) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (!entry || entry.kind !== "tag") continue;
    const key = tagEntrySelectionKey(entry);
    if (!key || !keys.has(key)) continue;
    out.push(entry);
    seen.add(key);
  }
  if (previewBodyEl && seen.size < keys.size) {
    const cards = previewBodyEl.querySelectorAll(
      ".previewTagFolderCard[data-preview-item-key]",
    );
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const selectionKey = previewTagFolderKeyForCard(card);
      if (!keys.has(selectionKey) || seen.has(selectionKey)) continue;
      const entry = card.__previewTagEntry || null;
      if (!entry) continue;
      out.push(entry);
      seen.add(selectionKey);
    }
  }
  return out;
}

function getSelectedFileIdsInCurrentView() {
  const baseSet = getVisibleFileIdsInEntries();
  const previewSet = getVisiblePreviewFileIds();
  return Array.from(WS.view.bulkFileSelectedIds || []).filter((id) => {
    const value = String(id || "");
    return baseSet.has(value) || previewSet.has(value);
  });
}

function getSelectedFileRecordsInCurrentView() {
  const selectedIds = new Set(
    getSelectedFileIdsInCurrentView().map((id) => String(id || "")),
  );
  if (!selectedIds.size) return [];
  const recs = [];
  for (const id of selectedIds) {
    const rec = WS.fileById.get(id);
    if (rec) recs.push(rec);
  }
  return recs;
}

function getLocalMediaRecordsForDirPath(dirPath) {
  const target = String(dirPath || "").replace(/^\/+|\/+$/g, "");
  const prefix = target ? target + "/" : "";
  const out = [];
  for (const rec of WS.fileById.values()) {
    if (!rec || !rec.file) continue;
    const rel = String(rec.relPath || "").replace(/\\/g, "/");
    if (target && !rel.startsWith(prefix)) continue;
    out.push(rec);
  }
  return out;
}

function joinNativePath(basePath, relPath) {
  const base = String(basePath || "");
  const rel = String(relPath || "").replace(/^\/+|\/+$/g, "");
  if (!rel) return base.replace(/[\/\\]+$/g, "");
  const sep = base.includes("\\") ? "\\" : "/";
  const cleanBase = base.replace(/[\/\\]+$/g, "");
  return cleanBase
    ? cleanBase + sep + rel.split("/").filter(Boolean).join(sep)
    : rel;
}

function getElectronApi() {
  if (typeof window === "undefined") return null;
  if (!window.electronAPI || typeof window.electronAPI !== "object")
    return null;
  return window.electronAPI;
}

function getNativePathForFile(file) {
  if (!file) return "";
  const electronApi = getElectronApi();
  if (electronApi && typeof electronApi.getPathForFile === "function") {
    try {
      const resolved = String(electronApi.getPathForFile(file) || "");
      if (resolved) return resolved;
    } catch {}
  }
  return String(file?.path || "");
}

function nativePathToFileUrl(nativePath) {
  const raw = String(nativePath || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encoded}`;
  return normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

function nativePathForRecord(rec) {
  if (!rec) return "";
  const existing = String(rec.nativePath || "");
  if (existing) return existing;
  const resolved = getNativePathForFile(rec.file);
  if (resolved) rec.nativePath = resolved;
  return resolved;
}

function resolveAbsoluteDirectoryPath(dirPath) {
  const electronApi = getElectronApi();
  if (!electronApi) return "";

  const target = String(dirPath || "").replace(/^\/+|\/+$/g, "");
  const preferred = getLocalMediaRecordsForDirPath(target).sort(
    (a, b) => String(a?.relPath || "").length - String(b?.relPath || "").length,
  );
  const fallback = Array.from(WS.fileById.values())
    .filter((rec) => !!(rec && rec.file && rec.relPath))
    .sort(
      (a, b) =>
        String(a?.relPath || "").length - String(b?.relPath || "").length,
    );
  const records = [];
  const seen = new Set();
  for (const rec of preferred.concat(fallback)) {
    const key = `${String(rec?.id || "")}::${String(rec?.relPath || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(rec);
  }
  if (!records.length) return "";

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const absFile = String(
      rec.nativePath || getNativePathForFile(rec.file) || "",
    );
    const relPath = String(rec.relPath || "").replace(/\\/g, "/");
    if (!absFile || !relPath) continue;

    const absNorm = absFile.replace(/\\/g, "/");
    if (!absNorm.toLowerCase().endsWith(relPath.toLowerCase())) continue;

    const relNative = relPath
      .split("/")
      .join(absFile.includes("\\") ? "\\" : "/");
    if (!relNative || absFile.length < relNative.length) continue;
    const rootAbs = absFile
      .slice(0, absFile.length - relNative.length)
      .replace(/[\/\\]+$/g, "");
    const targetAbs = target ? joinNativePath(rootAbs, target) : rootAbs;
    if (targetAbs) return targetAbs;
  }
  return "";
}

function previewStateForEntry(entry) {
  if (!entry || !isSelectableEntry(entry)) {
    return { kind: null, dirNode: null, fileId: null };
  }
  if (entry.kind === "dir") {
    return { kind: "dir", dirNode: entry.node || null, fileId: null };
  }
  if (entry.kind === "file") {
    return {
      kind: "file",
      dirNode: currentFilePreviewContextDir(),
      fileId: entry.id || null,
    };
  }
  if (entry.kind === "tag") {
    const node = makeTagPreviewNode(entry);
    return node
      ? { kind: "dir", dirNode: node, fileId: null }
      : { kind: null, dirNode: null, fileId: null };
  }
  return { kind: null, dirNode: null, fileId: null };
}

function currentFilePreviewContextDir() {
  const activePreviewDir =
    WS.preview && WS.preview.kind === "dir" ? WS.preview.dirNode : null;
  if (activePreviewDir) return activePreviewDir;
  if (isViewingTagFolder()) {
    const mode = String(WS.view.tagFolderActiveMode || "");
    const entry = {
      special:
        mode === "favorites" || mode === "hidden" || mode === "untagged"
          ? mode
          : "",
      album: mode === "album" ? String(WS.view.tagFolderActiveAlbum || "") : "",
      tag: mode === "tag" ? String(WS.view.tagFolderActiveTag || "") : "",
      gallery:
        mode === "gallery" ? String(WS.view.tagFolderActiveTag || "") : "",
      label:
        mode === "favorites"
          ? "Favorites"
          : mode === "hidden"
            ? "Hidden"
            : mode === "untagged"
              ? "Untagged"
              : mode === "album"
                ? String(WS.view.tagFolderActiveAlbum || "Album")
                : mode === "gallery"
                  ? String(WS.view.tagFolderActiveTag || "Gallery")
                : String(WS.view.tagFolderActiveTag || "Tag"),
    };
    return makeTagPreviewNode(entry) || WS.nav.dirNode || WS.root || null;
  }
  return WS.nav.dirNode || WS.root || null;
}

function navigationEntriesContainOnlyMediaFiles() {
  if (!WS || !WS.nav || !Array.isArray(WS.nav.entries)) return false;
  let mediaCount = 0;
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (!entry) continue;
    if (entry.kind !== "file") return false;
    const rec = WS.fileById && WS.fileById.get(String(entry.id || ""));
    if (!rec || (rec.type !== "image" && rec.type !== "video")) return false;
    mediaCount++;
  }
  return mediaCount > 0;
}

function tagAlbumContentFilterActiveForCurrentView() {
  if (!isViewingTagFolder()) return false;
  const contextual = currentContextualTagMediaFilterValue();
  if (contextual && contextual.length) return true;
  const mode = String((WS.view && WS.view.tagFolderActiveMode) || "");
  if (mode === "tag" || mode === "album") {
    const key = mode === "album"
      ? tagThumbnailKeyForAlbum(WS.view.tagFolderActiveAlbum || "", WS.view.tagFolderOriginPath || "")
      : tagThumbnailKeyForTag(WS.view.tagFolderActiveTag || "", WS.view.tagFolderOriginPath || "");
    return !!(key && metaHasTagMediaFilterByKey(key));
  }
  return false;
}

function currentViewNeedsResponsiveNavigationPriority() {
  return !!(isViewingTagFolder() || navigationEntriesContainOnlyMediaFiles());
}

function noteResponsiveNavigationInteraction(reason = "", durationMs = null) {
  if (!WS || !WS.view) return;
  const reasonText = String(reason || "");
  const tagLike = isViewingTagFolder() || reasonText.indexOf("tag") >= 0 || reasonText.indexOf("album") >= 0;
  const mediaLike = navigationEntriesContainOnlyMediaFiles() || reasonText.indexOf("media") >= 0;
  const fallback = tagLike
    ? RESPONSIVE_NAV_TAG_ALBUM_MS
    : mediaLike
      ? RESPONSIVE_NAV_MEDIA_MS
      : RESPONSIVE_NAV_DEFAULT_MS;
  const duration = Math.max(120, Number(durationMs == null ? fallback : durationMs) || fallback);
  WS.view.responsiveNavigationUntil = Math.max(
    Number(WS.view.responsiveNavigationUntil || 0) || 0,
    Date.now() + duration,
  );
}

function responsiveNavigationGuardActive() {
  return !!(WS && WS.view && Date.now() < (Number(WS.view.responsiveNavigationUntil || 0) || 0));
}

function actionNeedsImmediateNavigationPriority(action) {
  return (
    action === "selectUp" ||
    action === "selectDown" ||
    action === "selectLeft" ||
    action === "selectRight" ||
    action === "enterDir" ||
    action === "leaveDir" ||
    action === "back" ||
    action === "prevFolder" ||
    action === "nextFolder" ||
    action === "prevRootFolder" ||
    action === "nextRootFolder" ||
    action === "jumpToRoot" ||
    action === "jumpMinus50" ||
    action === "jumpMinus10" ||
    action === "jumpPlus10" ||
    action === "jumpPlus50" ||
    action === "randomFirstFileJump" ||
    action === "randomRootSetJump" ||
    action === "randomModelJump" ||
    action === "randomFileInFolderJump" ||
    action === "randomFileInModelJump" ||
    action === "randomFileInRootJump"
  );
}

function shouldDeferNonEssentialNavigationWork() {
  return responsiveNavigationGuardActive();
}

function previewRenderDelayForCurrentSelection() {
  if (!isViewingTagFolder()) return 0;
  return tagAlbumContentFilterActiveForCurrentView()
    ? RESPONSIVE_PREVIEW_FILTERED_TAG_ALBUM_DELAY_MS
    : RESPONSIVE_PREVIEW_TAG_ALBUM_DELAY_MS;
}

function shouldDeferPreviewRenderForCurrentSelection() {
  return previewRenderDelayForCurrentSelection() > 0;
}

function scoreInterfaceEnabled(opt = null) {
  return true;
}

function folderDepthRelativeToWorkspaceRoot(dirNode) {
  if (!dirNode) return 0;
  const rootPath = String(WS.root?.path || "");
  const dirPath = String(dirNode.path || "");
  const rootDepth = rootPath ? rootPath.split("/").filter(Boolean).length : 0;
  const dirDepth = dirPath ? dirPath.split("/").filter(Boolean).length : 0;
  return Math.max(0, dirDepth - rootDepth);
}

function previewFolderMenuButtonHiddenForNode(dirNode, opt = null) {
  return !previewThumbnailVisibilityForDirNode(dirNode, opt).showMenuButton;
}

function previewTagAndRootMenuButtonHidden(opt = null) {
  return !previewThumbnailVisibilityForKind("tag", opt).showMenuButton;
}

function previewFileMenuButtonHidden(opt = null) {
  return !previewThumbnailVisibilityForKind("file", opt).showMenuButton;
}

function currentItemMetadataVisibilityOptions() {
  return {
    preview: {
      file: previewThumbnailVisibilityForKind("file"),
      rootFolder: previewThumbnailVisibilityForKind("rootFolder"),
      subfolder: previewThumbnailVisibilityForKind("subfolder"),
      tag: previewThumbnailVisibilityForKind("tag"),
    },
    directories: {
      file: directoriesThumbnailVisibilityForKind("file"),
      rootFolder: directoriesThumbnailVisibilityForKind("rootFolder"),
      subfolder: directoriesThumbnailVisibilityForKind("subfolder"),
      tag: directoriesThumbnailVisibilityForKind("tag"),
    },
  };
}

function folderThumbnailKindForNode(dirNode) {
  return folderDepthRelativeToWorkspaceRoot(dirNode) <= 1
    ? "rootFolder"
    : "subfolder";
}

function resolveThumbnailVisibility(surface, kind, opt = null) {
  const src =
    opt || (WS.meta && WS.meta.options ? WS.meta.options : null) || {};
  const showScore = scoreInterfaceEnabled(src);
  const supportsPreview = (field) =>
    thumbnailVisibilityFieldSupported("preview", kind, field);
  const supportsDirectories = (field) =>
    thumbnailVisibilityFieldSupported("directories", kind, field);
  const resolvePreviewValue = (field, fallback) => {
    const key = thumbnailVisibilityPreviewOptionKey(kind, field);
    if (key && typeof src[key] === "boolean") return src[key];
    return fallback;
  };
  const resolveDirectoriesValue = (field, fallback) => {
    const key = thumbnailVisibilityDirectoriesOptionKey(kind, field);
    if (key && typeof src[key] === "boolean") return src[key];
    return fallback;
  };
  const resolveExtraInfoValue = (fallback) => {
    const key = thumbnailVisibilityExtraInfoOptionKey(kind);
    if (key && typeof src[key] === "boolean") return src[key];
    const fields = [
      "itemCount",
      "folderCount",
      "fileCount",
      "size",
      "score",
      "itemType",
    ];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const previewKey = thumbnailVisibilityPreviewOptionKey(kind, field);
      const directoriesKey = thumbnailVisibilityDirectoriesOptionKey(
        kind,
        field,
      );
      if (previewKey && typeof src[previewKey] === "boolean")
        return src[previewKey];
      if (directoriesKey && typeof src[directoriesKey] === "boolean")
        return src[directoriesKey];
    }
    return fallback;
  };
  const fallbackExtraInfo =
    !(src && src.showFolderItemCount === false) ||
    !(src && src.showFolderSize === false) ||
    !(src && src.showItemTypeLabel === false) ||
    !(src && src.showScores === false);
  const showExtraInfo = resolveExtraInfoValue(fallbackExtraInfo);
  const showDirectoryExtraInfo = showExtraInfo;
  const showPreviewField = (field, fallback = true) =>
    showExtraInfo &&
    supportsPreview(field) &&
    resolvePreviewValue(field, fallback);
  const showDirectoryField = (field, fallback = true) =>
    showDirectoryExtraInfo &&
    supportsDirectories(field) &&
    resolveDirectoriesValue(field, fallback);
  if (surface === "directories") {
    const showFolderCount = showDirectoryField("folderCount");
    const showFileCount = showDirectoryField("fileCount");
    return {
      showScores:
        showScore &&
        showDirectoryField("score"),
      showFolderCount,
      showFileCount,
      showItemCount: showDirectoryField("itemCount"),
      showSize: showDirectoryField("size"),
      showTitle: true,
      showMenuButton: true,
      showItemTypeLabel: showDirectoryField("itemType"),
    };
  }

  const showFolderCount = showPreviewField("folderCount");
  const showFileCount = showPreviewField("fileCount");
  return {
    showScores:
      showScore &&
      showPreviewField("score"),
    showFolderCount,
    showFileCount,
    showItemCount: showPreviewField("itemCount"),
    showSize: showPreviewField("size"),
    showTitle: supportsPreview("title"),
    showMenuButton: supportsPreview("menuButton"),
    // v1: Preview pane should not render the item-kind label under titles (File, Folder, Tag, etc.).
    // Other optional metadata, such as size/counts, can still render normally.
    showItemTypeLabel: false,
  };
}

function previewThumbnailVisibilityForKind(kind, opt = null) {
  return resolveThumbnailVisibility("preview", kind, opt);
}

function directoriesThumbnailVisibilityForKind(kind, opt = null) {
  return resolveThumbnailVisibility("directories", kind, opt);
}

function previewThumbnailVisibilityForDirNode(dirNode, opt = null) {
  return previewThumbnailVisibilityForKind(
    folderThumbnailKindForNode(dirNode),
    opt,
  );
}

function directoriesThumbnailVisibilityForDirNode(dirNode, opt = null) {
  return directoriesThumbnailVisibilityForKind(
    folderThumbnailKindForNode(dirNode),
    opt,
  );
}

function folderItemTypeLabelForNode(dirNode) {
  if (!dirNode) return "Folder";
  return dirNode === WS.root ? "Root" : "Folder";
}

function fileItemTypeLabelForRecord(rec) {
  return toTitleCaps(String(rec?.type || "file"));
}

function tagItemTypeLabelForEntry(entry) {
  if (!entry) return "Tag";
  if (entry.special) {
    const special = String(entry.special || "")
      .trim()
      .toLowerCase();
    if (special === "favorites") return "Favorites";
    if (special === "hidden") return "Hidden";
    if (special === "untagged") return "Untagged";
    return toTitleCaps(special || "Tag");
  }
  return "Tag";
}
