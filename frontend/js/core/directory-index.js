/* Directory index
   The derived per-folder counts (recursive files, images, videos) the panes
   read. */

let DIR_DERIVED_INDEX_READY = false;

function invalidateDirectoryDerivedIndex() {
  DIR_DERIVED_INDEX_READY = false;
}

function resetDirectoryDerivedStatsForNode(node) {
  if (!node) return;
  node.directFileCount = 0;
  node.directFolderCount = 0;
  node.recursiveFileCount = 0;
  node.recursiveFolderCount = 0;
  node.recursiveItemCount = 0;
  node.recursiveImageCount = 0;
  node.recursiveVideoCount = 0;
  node.recursiveTextCount = 0;
  node.recursiveSizeBytes = 0;
}

function rebuildDirectoryDerivedIndex(rootNode = null) {
  const root = rootNode || WS.root;
  if (!root) {
    DIR_DERIVED_INDEX_READY = false;
    return false;
  }

  const walk = (node) => {
    if (!node) return resetDirectoryDerivedStatsForNode(node);
    if (node.loadState !== "loaded" && node.summary) {
      applyCatalogSummaryToDirNode(node, node.summary);
      return;
    }
    const fileIds = Array.isArray(node.childrenFiles)
      ? node.childrenFiles
      : [];
    const childDirs = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];

    let fileCount = 0;
    let imageCount = 0;
    let videoCount = 0;
    let textCount = 0;
    let sizeBytes = 0;
    for (let i = 0; i < fileIds.length; i++) {
      const rec = WS.fileById.get(String(fileIds[i] || ""));
      if (!rec || rec.isMissingPlaceholder) continue;
      fileCount++;
      if (rec.type === "video") videoCount++;
      else if (rec.type === "image") imageCount++;
      else if (rec.type === "markdown") textCount++;
      const fileSize = Number(rec.size);
      if (Number.isFinite(fileSize) && fileSize > 0) sizeBytes += fileSize;
    }

    const directFileCount = fileCount;
    let folderCount = 0;
    for (let i = 0; i < childDirs.length; i++) {
      const child = childDirs[i];
      walk(child);
      if (child && child.isMissingPlaceholder) continue;
      folderCount++;
      fileCount += Number(child?.recursiveFileCount || 0);
      folderCount += Number(child?.recursiveFolderCount || 0);
      imageCount += Number(child?.recursiveImageCount || 0);
      videoCount += Number(child?.recursiveVideoCount || 0);
      textCount += Number(child?.recursiveTextCount || 0);
      sizeBytes += Number(child?.recursiveSizeBytes || 0);
    }

    node.directFileCount = directFileCount;
    node.directFolderCount = childDirs.filter(
      (child) => child && !child.isMissingPlaceholder,
    ).length;
    node.recursiveFileCount = fileCount;
    node.recursiveFolderCount = folderCount;
    node.recursiveItemCount = fileCount + folderCount;
    node.recursiveImageCount = imageCount;
    node.recursiveVideoCount = videoCount;
    node.recursiveTextCount = textCount;
    node.recursiveSizeBytes = sizeBytes;
  };

  walk(root);
  DIR_DERIVED_INDEX_READY = true;
  return true;
}

function ensureDirectoryDerivedIndex() {
  if (!DIR_DERIVED_INDEX_READY && WS.root) rebuildDirectoryDerivedIndex(WS.root);
  return !!DIR_DERIVED_INDEX_READY;
}
