/* Workspace state
   WS, the single global workspace state, and resetting it. */

const WS = {
  root: null,
  fileById: new Map(), // id -> FileRecord
  dirByPath: new Map(), // path -> DirNode
  altSourcePaths: new Set(),
  catalog: {
    enabled: false,
    index: null,
    rootHandle: null,
    folderShardDirHandle: null,
    folderSummaries: new Map(),
    fileLocationsById: new Map(),
    fileLocationsByRelPath: new Map(),
    fileDescriptorsById: new Map(),
    fileDescriptorsByRelPath: new Map(),
    fileLightIndexById: new Map(),
    fileLightIndexByRelPath: new Map(),
    folderShardCache: new Map(),
  },
  fsStoredPaths: new Set(),

  meta: {
    dirScores: new Map(),
    pendingDirScores: new Map(),
    dirTags: new Map(),
    // Tag -> the Tags that hold it, and the Tags whose content is hidden from
    // its real place. Folder -> Tag names stays in dirTags.
    tagParents: new Map(),
    exclusiveTags: new Set(),
    // Tags that take Sets from their own Model only (Tag options -> Model only).
    modelOnlyTags: new Set(),
    // "dir:<path>" / "tag:<name>" -> the Tags that source's contents are always
    // in (Add tag to all contents). Live: folded in by getTagModel, never copied.
    contentTags: new Map(),
    // Container overrides of the two score filters; see "Set score is at least".
    scoreFilterOverrides: new Map(),
    tagAlbumByTag: new Map(),
    folderAlbumByPath: new Map(),
    albumTagsByAlbum: new Map(),
    folderGalleriesByPath: new Map(),
    galleryMemberTagsByGallery: new Map(),
    galleryMemberAlbumsByGallery: new Map(),
    galleryUserTagsByGallery: new Map(),
    galleryAlbumByGallery: new Map(),
    trashItemsByPath: new Map(),
    hiddenTagKeys: new Set(),
    tagMediaFilterByKey: new Map(),
    folderMediaFilterByPath: new Map(),
    dirThumbPresets: new Map(),
    pendingDirThumbPresets: new Map(),
    dirAppearancePresetIds: new Map(),
    pendingDirAppearancePresetIds: new Map(),
    tagAppearancePresetIds: new Map(),
    containerSortByFolderPath: new Map(),
    containerSortByTagKey: new Map(),
    folderAltByPath: new Map(),
    fileThumbCrop: new Map(),
    videoThumbTime: new Map(),
    thumbFileIdentity: new Map(),
    aspectRatios: new Map(),
    tagThumbModes: new Map(),
    tagThumbPresets: new Map(),
    pendingTagsByPath: new Map(),
    scoreHistory: [],
    dailyJournals: new Map(),
    dirFingerprints: new Map(),
    dirFingerprintMemory: new Map(),
    dirSortMode: "score",
    storageMode: "local",
    storageKey: "",
    fsRootHandle: null,
    fsSysDirHandle: null,
    fsDocHandles: Object.create(null),
    fsLegacyDocHandles: Object.create(null),
    saveTimer: null,
    dirty: false,
    dirtyDocIds: new Set(),
    options: normalizeOptions(null),
    appearancePresets: defaultAppearancePresets(),
    keybinds: defaultKeybinds(defaultAppearancePresets()),
    gridKeybinds: defaultGridKeybinds(),
  },

  view: {
    filterMode: "all",
    aspectRatioFilterMode: "all",
    loopWithinDir: false,
    folderBehavior: "slide",
    randomSeed: 0,
    randomFolderCache: new Map(),
    fileOrderByDirPath: new Map(),
    // Slideshow (Basics). Never stored: off at launch and after any reset.
    // slideshowSeconds is the running duration, 0 when off.
    slideshowSeconds: 0,
    slideshowActive: false,
    slideshowTimer: null,
    appearancePresetDraftName: "",
    appearancePresetEditingId: BUILTIN_NULL_APPEARANCE_PRESET_ID,
    appearancePresetPromptMode: "",
    statusTimeout: null,
    scrollBusyDirs: false,
    scrollBusyPreview: false,
    pendingDirScroll: "",
    bulkSelectMode: false,
    bulkTagSelectedPaths: new Set(),
    bulkTagSelectionsByDir: new Map(),
    bulkTagFolderSelectedKeys: new Set(),
    bulkTagFolderSelectionsByDir: new Map(),
    bulkFileSelectedIds: new Set(),
    bulkFileSelectionsByDir: new Map(),
    bulkActionMenuOpen: false,
    bulkActionMenuAnchorPath: "",
    bulkActionMenuPoint: null,
    dirActionMenuPath: "",
    aboveRootView: false,
    tagFolderActiveMode: "",
    tagFolderActiveTag: "",
    tagFolderActiveAlbum: "",
    tagFolderOriginPath: "",
    tagNavStack: [],
    dirSearchPinned: false,
    previewSearchActive: false,
    dirSearchQuery: "",
    dirHistory: [],
    dirHistoryIndex: -1,
    dirSelectAnchorIndex: -1,
    fileActionMenuId: "",
    favoritesMode: false,
    favoritesRootActive: false,
    favoritesAnchorPath: "",
    favoritesReturnState: null,
    hiddenMode: false,
    hiddenRootActive: false,
    hiddenAnchorPath: "",
    hiddenReturnState: null,
    searchRootActive: false,
    searchRootPath: "",
    searchAnchorPath: "",
    searchEntryRootPath: "",
    searchRootIsFavorites: false,
    searchRootFavorites: [],
    searchRootIsHidden: false,
    searchRootHidden: [],
    searchResults: [],
    searchResultsDirectCount: 0,
    pendingPreviewSelectionKey: "",
    returnToPreviewPaneAfterFileClose: false,
    previewFileSelectionBridgeActive: false,
    previewFileBridgeReturnState: null,
    previewFolderBridgeReturnState: null,
    previewScrollByDir: new Map(),
    previewScrollActiveKey: "",
    gridSelectionByContext: new Map(),
    closedFilePaneWidthPx: 0,
    filePaneEnterAutoClosedPanes: null,
    activePane: "preview",
    previewSelectAnchorKey: "",
    previewSelectedKey: "",
    previewSelectionContextKey: "",
  },

  // List Pane navigation state
  nav: {
    dirNode: null, // current directory listed in List Pane
    entries: [], // [{kind:"dir", node},{kind:"file", id}]
    selectedIndex: 0,
  },

  // Preview target derived from List selection
  preview: {
    kind: null, // "dir"|"file"|null
    dirNode: null,
    fileId: null,
  },

  // video thumbs
  videoThumbPriorityQueue: [],
  videoThumbQueue: [],
  videoThumbActive: 0,
  videoThumbQueuedIds: new Set(),
  videoThumbInFlightIds: new Set(),
  videoThumbInFlightBackgroundIds: new Set(),
  videoThumbRetryTimers: new Map(),
  videoThumbRetryAttempts: new Map(),

  // image thumbs
  imageThumbPriorityQueue: [],
  imageThumbQueue: [],
  imageThumbActive: 0,
  imageThumbQueuedIds: new Set(),
  imageThumbInFlightIds: new Set(),

  thumbnailDemandToken: 0,
  thumbnailDesiredIds: new Set(),
  thumbnailPriorityIds: new Set(),
  thumbnailBackgroundDemandIds: new Set(),
  thumbnailBackgroundContextKey: "",
  thumbnailBackgroundCursor: 0,
  thumbnailBackgroundDone: false,
  thumbnailPreviewDemandIds: new Set(),
  thumbnailDirectoriesDemandIds: new Set(),
  thumbnailRootPinnedIds: new Set(),
  thumbnailActiveWorkspaceRootChild: "",
  thumbnailActiveWorkspaceIds: new Set(),
  thumbnailUiDirtyPreview: false,
  thumbnailUiDirtyDirectories: false,
};

/* FileRecord:
       {
         id, file, name, relPath, dirPath, ext, type,
         size, lastModified,
         url, thumbUrl, videoThumbUrl,
         indices
       }
    */

function revokeRecordObjectURLs(it) {
  if (!it) return;
  const id = String(it.id || "");
  try {
    if (it.url) URL.revokeObjectURL(it.url);
  } catch {}
  try {
    if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
  } catch {}
  try {
    if (it.videoThumbUrl) URL.revokeObjectURL(it.videoThumbUrl);
  } catch {}
  try {
    if (it.previewFullResUrl) URL.revokeObjectURL(it.previewFullResUrl);
  } catch {}
  it.url = null;
  it.thumbUrl = null;
  it.videoThumbUrl = null;
  it.previewFullResUrl = null;
  it.previewFullResLoading = false;
  it.thumbMode = null;
  it.videoThumbMode = null;
  if (id) THUMBNAIL_URL_RECORD_IDS.delete(id);
}

function revokeAllObjectURLs() {
  for (const it of WS.fileById.values()) revokeRecordObjectURLs(it);
  try {
    PREVIEW_FULLRES_LRU.length = 0;
  } catch {}
}

function resetWorkspace() {
  LIBRARY_SETTINGS_LOADED = false;
  GRAB_REORDER_STATE = null;
  CERTIFIED_FRESH_LAST_PATHS = null;
  resetMediaZoom();
  revokeAllObjectURLs();
  resetStorageStubThumbs();
  resetVideoThumbCacheState();
  THUMBNAIL_URL_RECORD_IDS.clear();
  invalidateDirectoryDerivedIndex();
  ASPECT_RATIO_BACKGROUND_HYDRATE_TOKEN++;
  NAV_THUMB_READY_PROMISES.clear();
  PREVIEW_FILE_OBJECT_PROMISES.clear();
  PREVIEW_FILE_OBJECT_WARM_TOKEN++;
  if (PREVIEW_FILE_OBJECT_WARM_TIMER) {
    try {
      clearTimeout(PREVIEW_FILE_OBJECT_WARM_TIMER);
    } catch {}
  }
  PREVIEW_FILE_OBJECT_WARM_TIMER = 0;
  if (LOADED_THUMB_RELEASE_TIMER) {
    try {
      clearTimeout(LOADED_THUMB_RELEASE_TIMER);
    } catch {}
  }
  LOADED_THUMB_RELEASE_TIMER = 0;
  if (PREVIEW_STATE_RENDER_RAF) {
    try {
      cancelAnimationFrame(PREVIEW_STATE_RENDER_RAF);
    } catch {}
  }
  PREVIEW_STATE_RENDER_RAF = 0;
  PREVIEW_STATE_RENDER_FILE_ID = "";
  NAVIGATION_PREP_TOKEN = 0;
  HOT_NAV_DIR_PATHS.clear();
  PINNED_HOT_NAV_DIR_PATHS.clear();
  PINNED_HOT_NAV_DECODE_CACHE.clear();
  HOT_NAV_CACHE_TOKEN = 0;
  if (HOT_NAV_CACHE_TIMER) {
    try {
      clearTimeout(HOT_NAV_CACHE_TIMER);
    } catch {}
  }
  HOT_NAV_CACHE_TIMER = 0;
  WORKSPACE_NAV_WARM_TOKEN = 0;
  if (WORKSPACE_NAV_WARM_TIMER) {
    try {
      clearTimeout(WORKSPACE_NAV_WARM_TIMER);
    } catch {}
  }
  WORKSPACE_NAV_WARM_TIMER = 0;
  THUMBNAIL_DEMAND_RAF = 0;
  if (THUMBNAIL_DEMAND_DEFER_TIMER) {
    try {
      clearTimeout(THUMBNAIL_DEMAND_DEFER_TIMER);
    } catch {}
  }
  THUMBNAIL_DEMAND_DEFER_TIMER = 0;
  THUMBNAIL_INVALIDATION_RAF = 0;
  if (THUMBNAIL_BACKGROUND_TIMER) {
    try {
      clearTimeout(THUMBNAIL_BACKGROUND_TIMER);
    } catch {}
  }
  THUMBNAIL_BACKGROUND_TIMER = 0;
  invalidateDirMetricsCaches();
  WS.root = null;
  WS.fileById.clear();
  WS.dirByPath.clear();
  if (WS.altSourcePaths) WS.altSourcePaths.clear();
  WS.catalog.enabled = false;
  WS.catalog.index = null;
  WS.catalog.rootHandle = null;
  WS.catalog.folderShardDirHandle = null;
  WS.catalog.folderSummaries.clear();
  WS.catalog.fileLocationsById.clear();
  WS.catalog.fileLocationsByRelPath.clear();
  WS.catalog.fileDescriptorsById.clear();
  WS.catalog.fileDescriptorsByRelPath.clear();
  WS.catalog.fileLightIndexById.clear();
  WS.catalog.fileLightIndexByRelPath.clear();
  WS.catalog.folderShardCache.clear();
  WS.fsStoredPaths.clear();
  DIR_HANDLE_CACHE = new Map();

  WS.meta.dirScores.clear();
  WS.meta.pendingDirScores.clear();
  WS.meta.dirTags.clear();
  WS.meta.tagParents.clear();
  WS.meta.exclusiveTags.clear();
  if (WS.meta.modelOnlyTags instanceof Set) WS.meta.modelOnlyTags.clear();
  if (WS.meta.contentTags instanceof Map) WS.meta.contentTags.clear();
  if (WS.meta.scoreFilterOverrides instanceof Map)
    WS.meta.scoreFilterOverrides.clear();
  WS.meta.tagAlbumByTag.clear();
  WS.meta.folderAlbumByPath.clear();
  WS.meta.albumTagsByAlbum.clear();
  WS.meta.folderGalleriesByPath.clear();
  WS.meta.galleryMemberTagsByGallery.clear();
  WS.meta.galleryMemberAlbumsByGallery.clear();
  WS.meta.galleryUserTagsByGallery.clear();
  WS.meta.galleryAlbumByGallery.clear();
  WS.meta.trashItemsByPath.clear();
  WS.meta.hiddenTagKeys.clear();
  WS.meta.tagMediaFilterByKey.clear();
  WS.meta.folderMediaFilterByPath.clear();
  WS.meta.dirThumbPresets.clear();
  WS.meta.pendingDirThumbPresets.clear();
  if (WS.meta.thumbFileIdentity instanceof Map) WS.meta.thumbFileIdentity.clear();
  WS.meta.dirAppearancePresetIds.clear();
  WS.meta.pendingDirAppearancePresetIds.clear();
  WS.meta.tagAppearancePresetIds.clear();
  WS.meta.containerSortByFolderPath.clear();
  WS.meta.containerSortByTagKey.clear();
  if (WS.meta.folderAltByPath) WS.meta.folderAltByPath.clear();
  WS.meta.fileThumbCrop.clear();
  WS.meta.videoThumbTime.clear();
  WS.meta.aspectRatios.clear();
  WS.meta.tagThumbModes.clear();
  WS.meta.tagThumbPresets.clear();
  WS.meta.pendingTagsByPath.clear();
  WS.meta.scoreHistory = [];
  WS.meta.dailyJournals.clear();
  WS.meta.dirFingerprints.clear();
  WS.meta.dirFingerprintMemory.clear();
  WS.meta.dirSortMode = "score";
  WS.meta.storageMode = "local";
  WS.meta.storageKey = "";
  WS.meta.fsRootHandle = null;
  WS.meta.fsSysDirHandle = null;
  WS.meta.fsDocHandles = Object.create(null);
  WS.meta.fsLegacyDocHandles = Object.create(null);
  WS.meta.dirty = false;
  WS.meta.dirtyDocIds = new Set();
  WS.meta.options = normalizeOptions(null);
  WS.meta.appearancePresets = defaultAppearancePresets();
  WS.meta.keybinds = defaultKeybinds(WS.meta.appearancePresets);
  WS.meta.gridKeybinds = defaultGridKeybinds();
  if (WS.meta.saveTimer) {
    clearTimeout(WS.meta.saveTimer);
    WS.meta.saveTimer = null;
  }

  applyDefaultViewFromOptions();
  rebuildKeybindIndex();
  WS.view.loopWithinDir = false;
  WS.view.randomSeed = 0;
  WS.view.randomFolderCache = new Map();
  // Manual file orders are session state, and one of their keys ("session-path::")
  // is not workspace-scoped — leaving the map behind pins the same relative paths
  // in the next workspace opened. Drop it with the rest of the workspace.
  WS.view.fileOrderByDirPath = new Map();
  WS.view.slideshowSeconds = 0;
  WS.view.slideshowActive = false;
  WS.view.appearancePresetDraftName = "";
  WS.view.appearancePresetEditingId = BUILTIN_NULL_APPEARANCE_PRESET_ID;
  WS.view.appearancePresetPromptMode = "";
  WS.view.bulkSelectMode = false;
  WS.view.bulkTagSelectedPaths = new Set();
  WS.view.bulkTagSelectionsByDir = new Map();
  WS.view.bulkTagFolderSelectedKeys = new Set();
  WS.view.bulkTagFolderSelectionsByDir = new Map();
  WS.view.bulkFileSelectedIds = new Set();
  WS.view.bulkFileSelectionsByDir = new Map();
  WS.view.bulkActionMenuOpen = false;
  WS.view.bulkActionMenuAnchorPath = "";
  WS.view.bulkActionMenuPoint = null;
  WS.view.dirActionMenuPath = "";
  WS.view.aboveRootView = false;
  WS.view.tagFolderActiveMode = "";
  WS.view.tagFolderActiveTag = "";
  WS.view.tagFolderActiveAlbum = "";
  WS.view.tagFolderOriginPath = "";
  WS.view.tagNavStack = [];
  WS.view.dirSearchPinned = false;
  WS.view.previewSearchActive = false;
  WS.view.dirSearchQuery = "";
  WS.view.dirHistory = [];
  WS.view.dirHistoryIndex = -1;
  WS.view.dirSelectAnchorIndex = -1;
  WS.view.fileActionMenuId = "";
  WS.view.favoritesMode = false;
  WS.view.favoritesRootActive = false;
  WS.view.favoritesAnchorPath = "";
  WS.view.favoritesReturnState = null;
  WS.view.hiddenMode = false;
  WS.view.hiddenRootActive = false;
  WS.view.hiddenAnchorPath = "";
  WS.view.hiddenReturnState = null;
  WS.view.searchRootActive = false;
  WS.view.searchRootPath = "";
  WS.view.searchAnchorPath = "";
  WS.view.searchEntryRootPath = "";
  WS.view.searchRootIsFavorites = false;
  WS.view.searchRootFavorites = [];
  WS.view.searchRootIsHidden = false;
  WS.view.searchRootHidden = [];
  WS.view.searchResults = [];
  WS.view.searchResultsDirectCount = 0;
  WS.view.pendingPreviewSelectionKey = "";
  WS.view.returnToPreviewPaneAfterFileClose = false;
  WS.view.previewFileSelectionBridgeActive = false;
  WS.view.previewFileBridgeReturnState = null;
  WS.view.previewFolderBridgeReturnState = null;
  WS.view.previewScrollByDir = new Map();
  WS.view.previewScrollActiveKey = "";
  WS.view.gridSelectionByContext = new Map();
  WS.view.closedFilePaneWidthPx = 0;
  WS.view.filePaneEnterAutoClosedPanes = null;
  WS.view.previewSelectAnchorKey = "";
  stopSlideshow();
  if (WS.view.statusTimeout) {
    clearTimeout(WS.view.statusTimeout);
    WS.view.statusTimeout = null;
  }

  WS.nav.dirNode = null;
  WS.nav.entries = [];
  WS.nav.selectedIndex = 0;

  applyPreviewState(null);
  clearPreviewSelectionState("none");

  WS.videoThumbPriorityQueue = [];
  WS.videoThumbQueue = [];
  WS.videoThumbActive = 0;
  WS.videoThumbQueuedIds = new Set();
  WS.videoThumbInFlightIds = new Set();
  WS.videoThumbInFlightBackgroundIds = new Set();
  clearVideoThumbRetryState();

  WS.imageThumbPriorityQueue = [];
  WS.imageThumbQueue = [];
  WS.imageThumbActive = 0;
  WS.imageThumbQueuedIds = new Set();
  WS.imageThumbInFlightIds = new Set();
  WS.thumbnailDemandToken = 0;
  WS.thumbnailDesiredIds = new Set();
  WS.thumbnailPriorityIds = new Set();
  WS.thumbnailBackgroundDemandIds = new Set();
  WS.thumbnailBackgroundContextKey = "";
  WS.thumbnailBackgroundCursor = 0;
  WS.thumbnailBackgroundDone = false;
  WS.thumbnailPreviewDemandIds = new Set();
  WS.thumbnailDirectoriesDemandIds = new Set();
  WS.thumbnailRootPinnedIds = new Set();
  WS.thumbnailActiveWorkspaceRootChild = "";
  WS.thumbnailActiveWorkspaceIds = new Set();
  WS.thumbnailUiDirtyPreview = false;
  WS.thumbnailUiDirtyDirectories = false;
  THUMBNAIL_DEMAND_RAF = 0;
  if (THUMBNAIL_DEMAND_DEFER_TIMER) {
    try {
      clearTimeout(THUMBNAIL_DEMAND_DEFER_TIMER);
    } catch {}
  }
  THUMBNAIL_DEMAND_DEFER_TIMER = 0;
  THUMBNAIL_INVALIDATION_RAF = 0;
  PRELOAD_CACHE = new Map();
  PREVIEW_BULK_TAG_EDIT = null;
  closeThumbnailCropEditor();

  clearWorkspaceEmptyState();
  syncButtons();
  syncMetaButtons();
  renderOptionsUi();
}

function clearWorkspaceEmptyState() {
  if (directoriesListEl) directoriesListEl.innerHTML = "";
  if (previewBodyEl) { releaseContainerThumbMedia(previewBodyEl); previewBodyEl.innerHTML = ""; }
}
