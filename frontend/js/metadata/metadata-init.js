/* Loading metadata
   Loading a library's metadata, building a workspace from a file list and
   finding stored folders. */

function metaInitForCurrentWorkspace(opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const loadHeavyLogs = options.loadHeavyLogs !== false;
  metaComputeFingerprints();
  const dirtyDocs = new Set();

  if (WS.meta.storageMode === "local") {
    const keys = metaLocalKeys();
    if (keys) {
      const loadOrder = [
        META_DOC_IDS.appearancePresets,
        META_DOC_IDS.prefGeneral,
        META_DOC_IDS.prefNotifications,
        META_DOC_IDS.prefAppearance,
        META_DOC_IDS.prefPlayback,
        META_DOC_IDS.prefThumbnails,
        META_DOC_IDS.prefFilenames,
        META_DOC_IDS.prefControls,
        META_DOC_IDS.scores,
        META_DOC_IDS.scoreHistory,
        META_DOC_IDS.dailyJournals,
        META_DOC_IDS.tags,
        META_DOC_IDS.tagAlbums,
        META_DOC_IDS.trash,
        META_DOC_IDS.thumbnails,
        META_DOC_IDS.aspectRatios,
        META_DOC_IDS.appearanceAssignments,
        META_DOC_IDS.keybinds,
      ];
      const splitDocs = [];
      for (let i = 0; i < loadOrder.length; i++) {
        const docId = loadOrder[i];
        if (!loadHeavyLogs && docId === META_DOC_IDS.aspectRatios) continue;
        if (!metadataDocEnabled(docId)) continue;
        const log = metaLoadLocalDoc(keys.docs && keys.docs[docId]);
        if (!log) continue;
        splitDocs.push([docId, log]);
      }
      for (const docId of convertLoadedTagDocsSync(splitDocs, (originals) =>
        backupTagDocsToLocal(keys, originals),
      ))
        dirtyDocs.add(docId);

      if (splitDocs.length) {
        for (let i = 0; i < splitDocs.length; i++) {
          metaApplyDocLogById(splitDocs[i][0], splitDocs[i][1]);
        }
        const legacyDisabledPaths = new Set();
        const legacyCombinedLog = metaLoadLocalDoc(keys.legacy.combined);
        const legacyTagsLog = metaLoadLocalDoc(keys.legacy.tags);
        for (const path of collectLegacyProcessingDisabledPathsFromLog(
          legacyCombinedLog,
        ))
          legacyDisabledPaths.add(path);
        for (const path of collectLegacyProcessingDisabledPathsFromLog(
          legacyTagsLog,
        ))
          legacyDisabledPaths.add(path);
        if (cleanupLegacyProcessingDisabledMetadata(legacyDisabledPaths)) {
          dirtyDocs.add(META_DOC_IDS.tags);
          dirtyDocs.add(META_DOC_IDS.appearanceAssignments);
        }
        metaClearLegacyLocalDocs(keys);
      } else {
        const legacyCombinedLog = metaLoadLocalDoc(keys.legacy.combined);
        const legacyScoresLog = metaLoadLocalDoc(keys.legacy.scores);
        const legacyTagsLog = metaLoadLocalDoc(keys.legacy.tags);
        const legacyOptionsLog = metaLoadLocalDoc(keys.legacy.options);

        if (legacyCombinedLog) {
          metaApplyFromLog(legacyCombinedLog);
          for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
            dirtyDocs.add(META_ALL_DOC_IDS[i]);
        }
        if (legacyScoresLog) {
          metaApplyScoresLog(legacyScoresLog);
          for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
            dirtyDocs.add(META_ALL_DOC_IDS[i]);
        }
        if (legacyTagsLog) {
          metaApplyTagsLog(legacyTagsLog);
          for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
            dirtyDocs.add(META_ALL_DOC_IDS[i]);
        }
        if (legacyOptionsLog) {
          metaApplyOptionsLog(legacyOptionsLog);
          for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
            dirtyDocs.add(META_ALL_DOC_IDS[i]);
        }
      }
    }
  }

  if (cleanupLegacyProcessingDisabledMetadata()) {
    dirtyDocs.add(META_DOC_IDS.tags);
    dirtyDocs.add(META_DOC_IDS.appearanceAssignments);
  }
  if (metaReclaimRestoredTrashOrigins()) {
    for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
      dirtyDocs.add(META_ALL_DOC_IDS[i]);
  }
  if (metaReclaimStrandedTrashMetadata()) dirtyDocs.add(META_DOC_IDS.thumbnails);
  if (metaFollowMovedThumbnailFiles()) dirtyDocs.add(META_DOC_IDS.thumbnails);
  if (metaPromotePendingFolderMetadata()) {
    dirtyDocs.add(META_DOC_IDS.scores);
    dirtyDocs.add(META_DOC_IDS.tags);
    dirtyDocs.add(META_DOC_IDS.thumbnails);
    dirtyDocs.add(META_DOC_IDS.appearanceAssignments);
  }

  metaFinalizeLoadedState();
  if (dirtyDocs.size) {
    const list = Array.from(dirtyDocs);
    metaMarkDirty(...list);
  }
  syncMetaButtons();
  renderOptionsUi();
  applyLoadedOptionsToDocument();
}

async function metaInitForCurrentWorkspaceFs(opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const loadHeavyLogs = options.loadHeavyLogs !== false;
  metaComputeFingerprints();
  const dirtyDocs = new Set();
  const legacyHandles =
    WS.meta && WS.meta.fsLegacyDocHandles ? WS.meta.fsLegacyDocHandles : {};

  const loadOrder = [
    META_DOC_IDS.appearancePresets,
    META_DOC_IDS.prefGeneral,
    META_DOC_IDS.prefNotifications,
    META_DOC_IDS.prefAppearance,
    META_DOC_IDS.prefPlayback,
    META_DOC_IDS.prefThumbnails,
    META_DOC_IDS.prefFilenames,
    META_DOC_IDS.prefControls,
    META_DOC_IDS.scores,
    META_DOC_IDS.scoreHistory,
    META_DOC_IDS.dailyJournals,
    META_DOC_IDS.tags,
    META_DOC_IDS.tagAlbums,
    META_DOC_IDS.trash,
    META_DOC_IDS.thumbnails,
    META_DOC_IDS.aspectRatios,
    META_DOC_IDS.appearanceAssignments,
    META_DOC_IDS.keybinds,
  ];
  const splitDocs = [];
  for (let i = 0; i < loadOrder.length; i++) {
    const docId = loadOrder[i];
    if (!loadHeavyLogs && docId === META_DOC_IDS.aspectRatios) continue;
    if (!metadataDocEnabled(docId)) continue;
    const log = await metaLoadFsDoc(metaFsHandleForDocId(docId));
    if (docId === META_DOC_IDS.tags && typeof outsideEditsNoteTagsDocRead === "function")
      outsideEditsNoteTagsDocRead(log);
    if (!log) continue;
    splitDocs.push([docId, log]);
  }
  for (const docId of await convertLoadedTagDocs(splitDocs, backupTagDocsToFs))
    dirtyDocs.add(docId);

  if (splitDocs.length) {
    for (let i = 0; i < splitDocs.length; i++) {
      metaApplyDocLogById(splitDocs[i][0], splitDocs[i][1]);
    }
    const legacyDisabledPaths = new Set();
    const legacyCombinedLog = await metaLoadFsDoc(legacyHandles.combined);
    const legacyTagsLog = await metaLoadFsDoc(legacyHandles.tags);
    for (const path of collectLegacyProcessingDisabledPathsFromLog(
      legacyCombinedLog,
    ))
      legacyDisabledPaths.add(path);
    for (const path of collectLegacyProcessingDisabledPathsFromLog(
      legacyTagsLog,
    ))
      legacyDisabledPaths.add(path);
    if (cleanupLegacyProcessingDisabledMetadata(legacyDisabledPaths)) {
      dirtyDocs.add(META_DOC_IDS.tags);
      dirtyDocs.add(META_DOC_IDS.appearanceAssignments);
    }
    await metaClearLegacyFsDocs(legacyHandles);
  } else {
    const legacyCombinedLog = await metaLoadFsDoc(legacyHandles.combined);
    const legacyScoresLog = await metaLoadFsDoc(legacyHandles.scores);
    const legacyTagsLog = await metaLoadFsDoc(legacyHandles.tags);
    const legacyOptionsLog = await metaLoadFsDoc(legacyHandles.options);

    if (legacyCombinedLog) {
      metaApplyFromLog(legacyCombinedLog);
      for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
        dirtyDocs.add(META_ALL_DOC_IDS[i]);
    }
    if (legacyScoresLog) {
      metaApplyScoresLog(legacyScoresLog);
      for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
        dirtyDocs.add(META_ALL_DOC_IDS[i]);
    }
    if (legacyTagsLog) {
      metaApplyTagsLog(legacyTagsLog);
      for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
        dirtyDocs.add(META_ALL_DOC_IDS[i]);
    }
    if (legacyOptionsLog) {
      metaApplyOptionsLog(legacyOptionsLog);
      for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
        dirtyDocs.add(META_ALL_DOC_IDS[i]);
    }
  }

  if (metaReclaimRestoredTrashOrigins()) {
    for (let i = 0; i < META_ALL_DOC_IDS.length; i++)
      dirtyDocs.add(META_ALL_DOC_IDS[i]);
  }
  if (metaReclaimStrandedTrashMetadata()) dirtyDocs.add(META_DOC_IDS.thumbnails);
  if (metaFollowMovedThumbnailFiles()) dirtyDocs.add(META_DOC_IDS.thumbnails);
  if (metaPromotePendingFolderMetadata()) {
    dirtyDocs.add(META_DOC_IDS.scores);
    dirtyDocs.add(META_DOC_IDS.tags);
    dirtyDocs.add(META_DOC_IDS.thumbnails);
    dirtyDocs.add(META_DOC_IDS.appearanceAssignments);
  }

  if (cleanupLegacyProcessingDisabledMetadata()) {
    dirtyDocs.add(META_DOC_IDS.tags);
    dirtyDocs.add(META_DOC_IDS.appearanceAssignments);
  }

  metaFinalizeLoadedState();
  if (dirtyDocs.size) metaMarkDirty(...Array.from(dirtyDocs));
  syncMetaButtons();
  renderOptionsUi();
  applyLoadedOptionsToDocument();
}

async function metaReapplyFsScoresAndTags() {
  metaComputeFingerprints();
  const scoresLog = await metaLoadFsDoc(
    metaFsHandleForDocId(META_DOC_IDS.scores),
  );
  const tagsLog = await metaLoadFsDoc(metaFsHandleForDocId(META_DOC_IDS.tags));
  if (typeof outsideEditsNoteTagsDocRead === "function") outsideEditsNoteTagsDocRead(tagsLog);
  if (scoresLog) metaApplyScoresDocLog(scoresLog);
  if (tagsLog) metaApplyTagsDocLog(tagsLog);
}

async function buildWorkspaceFromFiles(fileList, opts = null) {
  // A same-root rebuild (storage toggle / add-content refresh) must not teleport
  // the user to the root's first item — capture the location before the reset.
  const preserveView = !!(opts && opts.preserveView && WS.root);
  const preservedState = preserveView ? captureSameRootRebuildState() : null;
  resetWorkspace();
  clearWorkspaceEmptyState();

  WS.root = makeDirNode(inferRootNameFromFileList(fileList), null);
  WS.root.path = "";
  WS.dirByPath.set("", WS.root);
  applyMediaFilterFromOptions();

  const files = Array.from(fileList || []);

  for (const f of files) {
    if (!f || !f.name) continue;
    if (f.name[0] === ".") continue;

    const relPath = f.webkitRelativePath || f.name;
    // (metadata no longer lives inside the media tree)

    const parts = relPath.split("/").filter(Boolean);
    if (!parts.length) continue;

    const filename = parts[parts.length - 1];
    const dirPath = parts.slice(0, -1).join("/");
    const isImg = isImageName(filename);
    const isVid = isVideoName(filename);
    if (!isImg && !isVid && !isMarkdownName(filename)) continue;

    const id = fileKey(f, relPath);
    if (WS.fileById.has(id)) continue;

    const extDot = filename.lastIndexOf(".");
    const ext = extDot >= 0 ? filename.slice(extDot).toLowerCase() : "";

    const rec = {
      id,
      file: f,
      name: filename,
      relPath,
      dirPath,
      ext,
      type: fileTypeForName(filename),
      size: f.size,
      lastModified: f.lastModified,
      url: null,
      thumbUrl: null,
      videoThumbUrl: null,
      indices: null,
      thumbMode: null,
      videoThumbMode: null,
      nativePath: "",
      aspectRatio: null,
      aspectRatioBucket: "",
    };

    rec.nativePath = getNativePathForFile(f);
    WS.fileById.set(id, rec);
    const dirNode = ensureDirPath(dirPath);
    dirNode.childrenFiles.push(id);
  }

  normalizeRootIfSingleDir();

  WS.view.randomSeed = computeWorkspaceSeed();
  WS.view.randomFolderCache = new Map();

  WS.meta.storageMode = "local";
  WS.meta.storageKey = String(WS.view.randomSeed >>> 0);

  metaInitForCurrentWorkspace();
  await finalizeAspectRatiosAndStorageForLoadedWorkspace();
  finalizeFolderAltsForWorkspace();
  rebuildDirectoryDerivedIndex();

  // Initialize List Pane at root listing (or restore the pre-rebuild location).
  if (preservedState) {
    applySameRootRebuildLocation(preservedState);
  } else {
    WS.nav.dirNode = WS.root;
    WS.view.aboveRootView = false;
    syncActivePaneWithLayout();
    syncBulkSelectionForCurrentDir();
    syncFavoritesUi();
    syncTagUiForCurrentDir();
    rebuildDirectoriesEntries();
    primeTagDerivedCachesForDir(WS.root);
    WS.nav.selectedIndex = 0;
    WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
    syncPreviewToSelection({ force: true });
  }
  primeDirectoryNavManifests(WS.root);
  syncPinnedHotNavigationDirectories(WS.root);
  if (!preservedState) applyDefaultRootLandingSidebars();
  applySessionResumeView();

  await prepareNavigationSnapshot(
    currentNavigationSnapshot(),
    "Preparing directory view...",
  );

  renderDirectoriesPane();
  renderPreviewPane(true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  scheduleWorkspaceNavigationWarm(WS.root, 1000);
  syncMetaButtons();
  initDirHistory();
}

function collectStorageTaggedFolderPathsFromTagsLog(log) {
  const out = new Set();
  if (!log || typeof log !== "object") return out;
  const folders =
    log.folders && typeof log.folders === "object" ? log.folders : {};
  for (const rawPath of Object.keys(folders)) {
    const normalizedPath = normalizeDirPathValue(rawPath);
    const item = folders[rawPath];
    const tags = item && Array.isArray(item.tags) ? normalizeTagList(item.tags) : [];
    if (
      !normalizedPath ||
      isPathInsideInternalTrash(normalizedPath) ||
      !tags.includes(STORAGE_TAG)
    ) {
      continue;
    }
    out.add(normalizedPath);
  }
  return out;
}

function pathIsWithinStoredFolder(path, storedPaths) {
  const normalizedPath = normalizeWorkspaceRelPath(path);
  if (!normalizedPath || !storedPaths || !storedPaths.size) return false;
  for (const storedPath of storedPaths.values()) {
    const prefix = normalizeDirPathValue(storedPath);
    if (!prefix) continue;
    if (normalizedPath === prefix || normalizedPath.startsWith(prefix + "/")) {
      return true;
    }
  }
  return false;
}

async function preloadStoragePathsForRootHandle(rootHandle) {
  if (!rootHandle) return new Set();
  let sysHandle = null;
  try {
    if (window.__lg && typeof window.__lg.getAppMetaDirectoryHandle === "function") {
      sysHandle = await window.__lg.getAppMetaDirectoryHandle();
    } else {
      sysHandle = await rootHandle.getDirectoryHandle(".local-gallery");
    }
  } catch {}
  if (!sysHandle) return new Set();
  let tagsHandle = null;
  try {
    tagsHandle = await sysHandle.getFileHandle(META_DOC_FILE_NAMES[META_DOC_IDS.tags]);
  } catch {}
  if (!tagsHandle) return new Set();
  const log = await metaLoadFsDoc(tagsHandle);
  return collectStorageTaggedFolderPathsFromTagsLog(log);
}

function computeWorkspaceSeedForFileList(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  const keys = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const rawRelPath = String(f.webkitRelativePath || f.name || "");
    const relParts = rawRelPath.split("/").filter(Boolean);
    if (!relParts.length) continue;
    const relPath =
      relParts.length > 1 ? relParts.slice(1).join("/") : relParts[0];
    if (!relPath) continue;
    const parts = relPath.split("/").filter(Boolean);
    if (!parts.length) continue;
    if (parts[0] === ".local-gallery") continue; // in-library metadata/cache dir
    if (parts[0] === INTERNAL_MUSIC_DIR_NAME) continue; // music player folder
    const filename = parts[parts.length - 1];
    if (!isImageName(filename) && !isVideoName(filename) && !isMarkdownName(filename)) continue;
    keys.push(fileKey(f, relPath));
  }
  keys.sort();
  let seed = "";
  for (let i = 0; i < keys.length; i++) seed += keys[i] + "||";
  return hash32(seed) >>> 0;
}

function preloadStoragePathsForFileList(fileList) {
  const storageKey = String(computeWorkspaceSeedForFileList(fileList) >>> 0);
  const keys = metaLocalKeysForStorageKey(storageKey);
  if (!keys || !keys.docs) return new Set();
  const log = metaLoadLocalDoc(keys.docs[META_DOC_IDS.tags]);
  return collectStorageTaggedFolderPathsFromTagsLog(log);
}

async function collectFilesFromDirHandle(dirHandle, basePath, out, storedPaths = null) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      const f = await handle.getFile();
      if (!f || !f.name) continue;
      if (f.name[0] === ".") continue;
      const relPath = basePath ? basePath + "/" + name : name;
      out.push({ file: f, relPath });
    } else if (handle.kind === "directory") {
      if (name === ".local-gallery") continue; // in-library metadata/cache dir
      if (!basePath && name === INTERNAL_MUSIC_DIR_NAME) continue; // music player folder
      const nextBase = basePath ? basePath + "/" + name : name;
      if (pathIsWithinStoredFolder(nextBase, storedPaths)) continue;
      await collectFilesFromDirHandle(handle, nextBase, out, storedPaths);
    }
  }
}
