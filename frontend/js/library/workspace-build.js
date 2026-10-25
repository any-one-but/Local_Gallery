/* Building the workspace
   Building the tree from the library folder. */

async function buildWorkspaceFromDirectoryHandle(rootHandle, opts = null) {
  const silent = !!(opts && (opts.silent || opts.noLoader || opts.skipLoader));
  // A rebuild of the *same* already-open root (refresh, add content, storage
  // toggle, processing, ...) should never dump the user back at the root's first
  // item. Detect that case up front (same handle identity as the loaded root)
  // and snapshot the current directory + selection + view so we can restore it
  // after the tree is rebuilt. A genuinely fresh open (Choose Root with a new
  // handle, or opts.freshOpen) keeps the default root-landing behaviour.
  const preserveView =
    !(opts && opts.freshOpen) &&
    !!(WS.root && WS.root.fsHandle && WS.root.fsHandle === rootHandle);
  const preservedState = preserveView ? snapshotRefreshState() : null;
  // Capture the exact previewed location (the "location you are at") before the
  // tree is torn down, so a same-root rebuild restores it verbatim instead of
  // snapping the preview to the file-pane selection.
  if (preservedState) preservedState.previewState = capturePreviewRestoreState();
  if (!silent) {
    holdBusyOverlay();
    showBlockingLoaderOverlay("Opening root folder...", "Preparing workspace...");
    await waitForBusyOverlayPaint();
  }
  try {
    await flushPendingMetadataSaveNow();
    if (!silent) {
      updateBlockingLoaderOverlay("Preparing workspace...", "Resetting previous gallery state...");
      await waitForBusyOverlayPaint();
    }
    LAST_LOADED_FILE_LIST = [];
    resetWorkspace();
    clearWorkspaceEmptyState();

    if (!silent) {
      updateBlockingLoaderOverlay("Preparing workspace...", "Checking gallery storage...");
      await waitForBusyOverlayPaint();
    }
    const trashDirAvailable = await ensureInternalTrashDirectoryForRootHandle(
      rootHandle,
    );
    const ok = await metaEnsureFsHandles(rootHandle);
    const storedPaths = await preloadStoragePathsForRootHandle(rootHandle);
    await initVideoThumbCacheForWorkspace(rootHandle);

    if (!silent) {
      updateBlockingLoaderOverlay("Opening root folder...", "Scanning folders and media files...");
      await waitForBusyOverlayPaint();
    }
    const stats = { folders: 0, mediaFiles: 0, allFiles: 0, entries: 0, lastUpdate: 0 };
    const updateScanProgress = (path = "", force = false) => {
      if (silent) return;
      const now = Date.now();
      if (!force && now - stats.lastUpdate < 80) return;
      stats.lastUpdate = now;
      updateBlockingLoaderOverlay(
        "Opening root folder...",
        formatBusyProgressDetail(
          `Loaded ${stats.folders} folders, ${stats.mediaFiles} media files`,
          path,
        ),
      );
    };
    WS.root = makeDirNode(String(rootHandle?.name || "root"), null);
    WS.root.path = "";
    WS.root.fsHandle = rootHandle;
    WS.root.loadState = "loaded";
    WS.root.subtreeLoadState = "loaded";
    WS.dirByPath.set("", WS.root);
    DIR_HANDLE_CACHE.set("", rootHandle);
    const scanDir = async (dirHandle, dirPath, dirNode) => {
      if (!dirHandle || !dirNode) return;
      stats.folders++;
      updateScanProgress(dirPath);
      const childDirEntries = [];
      const fileEntries = [];
      for await (const [name, handle] of dirHandle.entries()) {
        const relPath = dirPath ? `${dirPath}/${name}` : name;
        if (pathIsWithinStoredFolder(relPath, storedPaths)) continue;
        stats.entries++;
        if (handle.kind === "directory") {
          if (name === ".local-gallery") continue; // in-library metadata/cache dir
          if (!dirPath && name === INTERNAL_MUSIC_DIR_NAME) continue; // music player folder
          childDirEntries.push({ name, handle, path: relPath });
          continue;
        }
        if (handle.kind !== "file") continue;
        stats.allFiles++;
        if (String(name || "")[0] === ".") continue;
        if (isLibraryGuideFile(dirPath, name)) continue;
        if (!isImageName(name) && !isVideoName(name) && !isMarkdownName(name)) continue;
        fileEntries.push({ name, handle, path: relPath });
      }
      childDirEntries.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
      for (let i = 0; i < childDirEntries.length; i++) {
        const entry = childDirEntries[i];
        const child = makeDirNode(entry.name, dirNode);
        child.path = normalizeDirPathValue(entry.path);
        child.fsHandle = entry.handle;
        child.loadState = "loaded";
        child.subtreeLoadState = "loaded";
        dirNode.childrenDirs.push(child);
        WS.dirByPath.set(child.path, child);
        DIR_HANDLE_CACHE.set(child.path, entry.handle);
        await scanDir(entry.handle, child.path, child);
      }
      fileEntries.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
      const fileRecords = new Array(fileEntries.length);
      await runWithConcurrency(fileEntries, 6, async (entry, index) => {
        try {
          const file = await entry.handle.getFile();
          const relPath = normalizeWorkspaceRelPath(entry.path);
          const desc = fileDescriptorFromFile(file, relPath);
          if (!desc || WS.fileById.has(desc.id)) return;
          const rec = {
            id: desc.id,
            file,
            name: desc.name,
            relPath: desc.relPath,
            dirPath: desc.dirPath,
            ext: desc.ext,
            type: desc.type,
            size: desc.size,
            lastModified: desc.lastModified,
            url: null,
            thumbUrl: null,
            videoThumbUrl: null,
            indices: null,
            thumbMode: null,
            videoThumbMode: null,
            nativePath: getNativePathForFile(file),
            aspectRatio: desc.aspectRatio,
            aspectRatioBucket: desc.aspectRatioBucket || "",
          };
          fileRecords[index] = rec;
          stats.mediaFiles++;
          updateScanProgress(desc.relPath);
        } catch {}
      });
      for (let i = 0; i < fileRecords.length; i++) {
        const rec = fileRecords[i];
        if (!rec || WS.fileById.has(rec.id)) continue;
        WS.fileById.set(rec.id, rec);
        dirNode.childrenFiles.push(rec.id);
      }
      dirNode.loadState = "loaded";
      dirNode.subtreeLoadState = "loaded";
    };
    await scanDir(rootHandle, "", WS.root);
    if (trashDirAvailable && !WS.dirByPath.has(INTERNAL_TRASH_DIR_NAME)) {
      try {
        const trashHandle = await rootHandle.getDirectoryHandle(INTERNAL_TRASH_DIR_NAME);
        const trashNode = makeDirNode(INTERNAL_TRASH_DIR_NAME, WS.root);
        trashNode.path = INTERNAL_TRASH_DIR_NAME;
        trashNode.fsHandle = trashHandle;
        trashNode.loadState = "loaded";
        trashNode.subtreeLoadState = "loaded";
        WS.root.childrenDirs.push(trashNode);
        WS.dirByPath.set(INTERNAL_TRASH_DIR_NAME, trashNode);
        DIR_HANDLE_CACHE.set(INTERNAL_TRASH_DIR_NAME, trashHandle);
      } catch {}
    }
    updateScanProgress("", true);

    applyMediaFilterFromOptions();

    if (!silent) {
      updateBlockingLoaderOverlay(
        "Loading saved data...",
        "Reading saved tags, scores, and preferences...",
      );
      await waitForBusyOverlayPaint();
    }
    try {
      if (!ok) {
        WS.meta.storageMode = "local";
        WS.meta.storageKey = String(computeWorkspaceSeed() >>> 0);
        metaInitForCurrentWorkspace({ loadHeavyLogs: true });
      } else {
        WS.meta.storageKey = String(computeWorkspaceSeed() >>> 0);
        await metaInitForCurrentWorkspaceFs({
          loadHeavyLogs: true,
        });
        if (WS.meta.saveTimer) {
          clearTimeout(WS.meta.saveTimer);
          WS.meta.saveTimer = null;
        }
        if (WS.meta.dirtyDocIds && WS.meta.dirtyDocIds.size) metaScheduleSave();
      }
    } finally {
      if (!silent) hideBlockingLoaderOverlay();
    }
    applyMediaFilterFromOptions();

    await finalizeAspectRatiosAndStorageForLoadedWorkspace();
    finalizeFolderAltsForWorkspace();

    if (!silent) {
      showBlockingLoaderOverlay("Preparing folder view...", "Building folder statistics...");
      await waitForBusyOverlayPaint();
    }
    try {
      rebuildDirectoryDerivedIndex();
    } finally {
      if (!silent) hideBlockingLoaderOverlay();
    }

    if (!silent) {
      updateBlockingLoaderOverlay("Preparing folder view...", "Preparing root navigation...");
      await waitForBusyOverlayPaint();
    }
    WS.view.randomSeed = computeWorkspaceSeed();
    WS.view.randomFolderCache = new Map();

    if (preservedState) {
      // Same-root rebuild: put the panes back exactly where they were instead
      // of landing on the root's first item.
      restoreRefreshViewState(preservedState.view);
      WS.nav.dirNode =
        WS.dirByPath.get(preservedState.dirPath || "") || WS.root;
    } else {
      WS.nav.dirNode = WS.root;
      // Open one level "above root" so the root's folders are shown in the
      // preview grid (mirrors leaveDirectory()'s at-root behaviour) instead of
      // descending into the first child.
      WS.view.aboveRootView = showRootViewEnabled();
    }
    syncActivePaneWithLayout();
    syncBulkSelectionForCurrentDir();
    syncFavoritesUi();
    syncTagUiForCurrentDir();

    if (!silent) {
      updateBlockingLoaderOverlay("Preparing folder view...", "Building folder and file rows...");
      await waitForBusyOverlayPaint();
    }
    if (
      preservedState &&
      (WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim())
    ) {
      computeDirectorySearchResults();
    }
    rebuildDirectoriesEntries();
    primeTagDerivedCachesForDir(WS.root);
    if (preservedState) {
      const restoredIdx = restoreRefreshSelection(preservedState.entryKey);
      WS.nav.selectedIndex = findNearestSelectableIndex(restoredIdx, 1);
    } else {
      WS.nav.selectedIndex = 0;
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
    }
    // Restore the exact previewed location when it still exists; only fall back
    // to deriving it from the selection when the captured target is gone (e.g.
    // the previewed folder is the one just sent to storage). This keeps a
    // storage toggle / refresh from teleporting the preview.
    if (
      !(
        preservedState &&
        applyCapturedPreviewStateAfterRebuild(preservedState.previewState)
      )
    ) {
      syncPreviewToSelection({ force: true });
    }
    primeDirectoryNavManifests(WS.root);
    syncPinnedHotNavigationDirectories(WS.root);
    if (!preservedState) applyDefaultRootLandingSidebars();
    applySessionResumeView();

    if (!silent) {
      await prepareNavigationSnapshot(
        currentNavigationSnapshot(),
        "Preparing directory view...",
        { keepBusyOverlay: true },
      );
    }
    // silent startup skips the prepare snapshot (which shows busy) for instant open;
    // thumbnails are primed at the end of build anyway.

    if (!silent) {
      updateBlockingLoaderOverlay("Rendering folder view...", "Populating files and preview panes...");
      await waitForBusyOverlayPaint();
    }
    if (!IS_SETTINGS_WINDOW) {
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      scheduleWorkspaceNavigationWarm(WS.root, 1000);
      startVideoThumbWarm();
    }
    syncMetaButtons();
    initDirHistory();
    settingsWorkspaceDidLoad();
  } finally {
    if (!silent) {
      releaseBusyOverlayHold({ hide: true });
    } else {
      hideBusyOverlay(true);
    }
    // Kick the passive thumbnail loader now the panes have their final size, so
    // thumbnails start loading on startup without needing a navigation nudge.
    if (!IS_SETTINGS_WINDOW) scheduleInitialThumbnailPrime();
  }
}

async function buildWorkspaceFromFileList(fileList, opts = null) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return false;
  const workspaceStorageKey = String(computeWorkspaceSeedForFileList(files) >>> 0);
  const storedPaths = preloadStoragePathsForFileList(files);
  // A same-root rebuild (e.g. the non-fs storage toggle fallback) must preserve
  // the location instead of teleporting to the root's first item.
  const preserveView = !!(opts && opts.preserveView && WS.root);
  const preservedState = preserveView ? captureSameRootRebuildState() : null;
  LAST_LOADED_FILE_LIST = files.slice();

  resetWorkspace();
  clearWorkspaceEmptyState();

  let rootName = "root";
  for (let i = 0; i < files.length; i++) {
    const rel = String(files[i]?.webkitRelativePath || "");
    const parts = rel.split("/").filter(Boolean);
    if (parts.length > 1) {
      rootName = parts[0];
      break;
    }
  }

  WS.root = makeDirNode(rootName, null);
  WS.root.path = "";
  WS.dirByPath.set("", WS.root);
  applyMediaFilterFromOptions();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f) continue;
    const rawRelPath = String(f.webkitRelativePath || f.name || "");
    const relParts = rawRelPath.split("/").filter(Boolean);
    if (!relParts.length) continue;
    const relPath =
      relParts.length > 1 ? relParts.slice(1).join("/") : relParts[0];
    if (!relPath) continue;
    if (pathIsWithinStoredFolder(relPath, storedPaths)) continue;

    const parts = relPath.split("/").filter(Boolean);
    if (!parts.length) continue;
    if (parts[0] === ".local-gallery") continue; // in-library metadata/cache dir
    if (parts[0] === INTERNAL_MUSIC_DIR_NAME) continue; // music player folder

    const filename = parts[parts.length - 1];
    const dirPath = parts.slice(0, -1).join("/");
    if (isLibraryGuideFile(dirPath, filename)) continue;
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
  WS.meta.storageKey = workspaceStorageKey;
  WS.meta.fsRootHandle = null;
  WS.meta.fsSysDirHandle = null;
  WS.meta.fsDocHandles = Object.create(null);
  WS.meta.fsLegacyDocHandles = Object.create(null);
  metaInitForCurrentWorkspace();

  await finalizeAspectRatiosAndStorageForLoadedWorkspace();
  finalizeFolderAltsForWorkspace();
  rebuildDirectoryDerivedIndex();

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
    syncPreviewToSelection();
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
  settingsWorkspaceDidLoad();
  showStatusMessage("Loaded folder in read-only mode.");
  return true;
}
