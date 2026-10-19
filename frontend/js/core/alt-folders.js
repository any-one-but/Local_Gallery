/* ALT folders
   Two versions of one collection (`Name -- Label`): folding them into one node
   and switching between them. */

const ALT_FOLDER_NAME_SEPARATOR = " -- ";
const ORIGINAL_ALT_LABEL = "";
const ORIGINAL_ALT_MENU_LABEL = "Original";
const MISSING_ITEM_PREFIX = "Missing: ";

function parseAltFolderName(name) {
  const raw = String(name || "");
  const idx = raw.lastIndexOf(ALT_FOLDER_NAME_SEPARATOR);
  if (idx <= 0) return null;
  const base = raw.slice(0, idx).trim();
  const label = raw.slice(idx + ALT_FOLDER_NAME_SEPARATOR.length).trim();
  if (!base || !label) return null;
  return { base, label };
}

function formatAltFolderName(base, label) {
  return `${String(base || "")}${ALT_FOLDER_NAME_SEPARATOR}${String(label || "")}`;
}

function altVariantDisplayLabel(label) {
  const raw = String(label || "");
  return raw ? raw : ORIGINAL_ALT_MENU_LABEL;
}

function missingItemDisplayName(name) {
  return `${MISSING_ITEM_PREFIX}${String(name || "")}`;
}

function altFileStem(name) {
  return String(splitNameExt(name).base || name || "").trim();
}

function altFileStemKey(name) {
  return altFileStem(name).toLowerCase();
}

function altIdentityRelPath(relPath) {
  const parts = normalizeWorkspaceRelPath(relPath).split("/").filter(Boolean);
  if (!parts.length) return "";
  const stem = altFileStem(parts[parts.length - 1]);
  if (!stem) return "";
  parts[parts.length - 1] = stem;
  return parts.join("/");
}

function altCanonicalThumbKeyForRecord(rec) {
  if (!rec) return "";
  return altIdentityKeyFromDirAndName(rec.dirPath, rec.name);
}

function altIdentityKeyFromDirAndName(dirPath, fileName) {
  const stem = altFileStem(fileName);
  if (!stem) return "";
  const dir = String(dirPath || "");
  return dir ? `${dir}/${stem}` : stem;
}

function registerAltSourcePath(path) {
  const p = String(path || "");
  if (!p) return;
  if (!WS.altSourcePaths) WS.altSourcePaths = new Set();
  WS.altSourcePaths.add(p);
}

function pathIsRegisteredAltSource(path) {
  const dirPath = String(path || "");
  if (!dirPath || !WS.altSourcePaths || !WS.altSourcePaths.size) return false;
  for (const src of WS.altSourcePaths) {
    if (dirPath === src || dirPath.startsWith(src + "/")) return true;
  }
  return false;
}

function dirNodeIsHiddenAlt(node) {
  if (!node) return false;
  const parsed = parseAltFolderName(node.name);
  if (!parsed) return false;
  const parent = node.parent;
  if (!parent || !Array.isArray(parent.childrenDirs)) return false;
  return parent.childrenDirs.some(
    (child) => child && child !== node && String(child.name || "") === parsed.base,
  );
}

function fileRecordIsInactiveAltSource(rec) {
  if (!rec || rec.isMissingPlaceholder) return false;
  if (rec._altSourceDirPath != null) return false;
  return pathIsRegisteredAltSource(rec.dirPath || "");
}

function isMissingPlaceholderNode(node) {
  return !!(node && node.isMissingPlaceholder);
}

function isMissingPlaceholderRecord(rec) {
  return !!(rec && rec.isMissingPlaceholder);
}

function captureAltSourceTree(node) {
  if (!node) return null;
  return {
    name: String(node.name || ""),
    sourcePath: String(node.path || ""),
    fsHandle: node.fsHandle || null,
    loadState: node.loadState || "loaded",
    childrenFiles: Array.isArray(node.childrenFiles)
      ? node.childrenFiles.slice()
      : [],
    childrenDirs: (Array.isArray(node.childrenDirs) ? node.childrenDirs : [])
      .filter((child) => child && !parseAltFolderName(child.name))
      .map((child) => captureAltSourceTree(child))
      .filter(Boolean),
  };
}

function unindexDirTree(node) {
  if (!node) return;
  const path = String(node.path || "");
  if (path && WS.dirByPath && WS.dirByPath.get(path) === node) {
    WS.dirByPath.delete(path);
  }
  if (path && typeof DIR_HANDLE_CACHE !== "undefined" && DIR_HANDLE_CACHE) {
    DIR_HANDLE_CACHE.delete(path);
  }
  const dirs = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
  for (let i = 0; i < dirs.length; i++) unindexDirTree(dirs[i]);
}

function detachAltFolderNode(parent, altNode) {
  if (!parent || !altNode) return;
  registerAltSourcePath(altNode.path);
  parent.childrenDirs = (parent.childrenDirs || []).filter(
    (child) => child !== altNode,
  );
  unindexDirTree(altNode);
}

function attachAltVariant(canonical, label, altNode) {
  if (!canonical || !altNode || !label) return;
  if (!canonical.altVariants) {
    canonical.altVariants = Object.create(null);
    canonical.altVariants[ORIGINAL_ALT_LABEL] = captureAltSourceTree(canonical);
    canonical.altLabel = ORIGINAL_ALT_LABEL;
    canonical.sourcePath = String(canonical.path || "");
  }
  if (!canonical.altVariants[label]) {
    canonical.altVariants[label] = captureAltSourceTree(altNode);
    canonical._altApplied = false;
  }
}

function foldAltFoldersInNode(node) {
  if (!node || !Array.isArray(node.childrenDirs)) return;
  const childrenSnapshot = node.childrenDirs.slice();
  for (let i = 0; i < childrenSnapshot.length; i++) {
    foldAltFoldersInNode(childrenSnapshot[i]);
  }
  const byName = new Map();
  for (let i = 0; i < node.childrenDirs.length; i++) {
    const child = node.childrenDirs[i];
    if (child && child.name) byName.set(String(child.name), child);
  }
  const currentChildren = node.childrenDirs.slice();
  for (let i = 0; i < currentChildren.length; i++) {
    const child = currentChildren[i];
    const parsed = parseAltFolderName(child && child.name);
    if (!parsed) continue;
    const canonical = byName.get(parsed.base);
    if (!canonical || canonical === child) continue;
    if (parseAltFolderName(canonical.name)) continue;
    if (isInternalTrashDirNode(child) || isInternalTrashDirNode(canonical))
      continue;
    attachAltVariant(canonical, parsed.label, child);
    detachAltFolderNode(node, child);
  }
}

function altSourceChildByName(source, name) {
  if (!source || !Array.isArray(source.childrenDirs)) return null;
  const needle = String(name || "");
  for (let i = 0; i < source.childrenDirs.length; i++) {
    const child = source.childrenDirs[i];
    if (child && String(child.name || "") === needle) return child;
  }
  return null;
}

function altVariantsAtRelativePath(rootVariants, relParts) {
  const out = Object.create(null);
  if (!rootVariants) return out;
  const parts = Array.isArray(relParts) ? relParts : [];
  for (const label of Object.keys(rootVariants)) {
    let source = rootVariants[label];
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      source = altSourceChildByName(source, parts[i]);
      if (!source) {
        ok = false;
        break;
      }
    }
    if (ok && source) out[label] = source;
  }
  return out;
}

function unionAltChildDirNames(variants) {
  const names = new Set();
  if (!variants) return [];
  for (const label of Object.keys(variants)) {
    const source = variants[label];
    const dirs = source && Array.isArray(source.childrenDirs)
      ? source.childrenDirs
      : [];
    for (let i = 0; i < dirs.length; i++) {
      const name = String(dirs[i]?.name || "");
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}

function unionAltChildFileEntries(variants) {
  const byStem = new Map();
  if (!variants) return [];
  const labels = Object.keys(variants);
  labels.sort((a, b) => {
    if (a === ORIGINAL_ALT_LABEL) return -1;
    if (b === ORIGINAL_ALT_LABEL) return 1;
    return 0;
  });
  for (let i = 0; i < labels.length; i++) {
    const source = variants[labels[i]];
    const ids =
      source && Array.isArray(source.childrenFiles) ? source.childrenFiles : [];
    for (let j = 0; j < ids.length; j++) {
      const rec = WS.fileById.get(ids[j]);
      const name = String(rec?.name || "");
      const stemKey = altFileStemKey(name);
      if (!stemKey || byStem.has(stemKey)) continue;
      byStem.set(stemKey, name);
    }
  }
  return Array.from(byStem.entries()).map(([stemKey, name]) => ({
    stemKey,
    name,
  }));
}

function altSourceFilesByStem(source) {
  const byStem = new Map();
  const ids =
    source && Array.isArray(source.childrenFiles) ? source.childrenFiles : [];
  for (let i = 0; i < ids.length; i++) {
    const rec = WS.fileById.get(ids[i]);
    const stemKey = altFileStemKey(rec && rec.name);
    if (!stemKey || byStem.has(stemKey)) continue;
    byStem.set(stemKey, rec);
  }
  return byStem;
}

function canonicalChildPool(node) {
  if (!node._altChildPool) node._altChildPool = new Map();
  const dirs = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
  for (let i = 0; i < dirs.length; i++) {
    const child = dirs[i];
    if (child && child.name && !child.isMissingPlaceholder) {
      node._altChildPool.set(String(child.name), child);
    }
  }
  return node._altChildPool;
}

function bindFileRecordToCanonical(rec, canonicalDirPath) {
  if (!rec || rec.isMissingPlaceholder) return;
  if (rec._altSourceDirPath == null) {
    rec._altSourceDirPath = String(rec.dirPath || "");
  }
  rec.dirPath = String(canonicalDirPath || "");
}

function restoreFileRecordSourcePath(rec) {
  if (!rec || rec._altSourceDirPath == null) return;
  rec.dirPath = rec._altSourceDirPath;
  rec._altSourceDirPath = null;
}

function restoreAltSourceFiles(source) {
  if (!source) return;
  const ids = Array.isArray(source.childrenFiles) ? source.childrenFiles : [];
  for (let i = 0; i < ids.length; i++) {
    restoreFileRecordSourcePath(WS.fileById.get(ids[i]));
  }
  const dirs = Array.isArray(source.childrenDirs) ? source.childrenDirs : [];
  for (let i = 0; i < dirs.length; i++) restoreAltSourceFiles(dirs[i]);
}

function restoreAllAltVariantFiles(node) {
  if (!node || !node.altVariants) return;
  for (const label of Object.keys(node.altVariants)) {
    restoreAltSourceFiles(node.altVariants[label]);
  }
}

function clearMissingPlaceholderFiles(node) {
  if (!node) return;
  const ids = Array.isArray(node.childrenFiles) ? node.childrenFiles : [];
  for (let i = 0; i < ids.length; i++) {
    const rec = WS.fileById.get(ids[i]);
    if (rec && rec.isMissingPlaceholder) WS.fileById.delete(ids[i]);
  }
  const dirs = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
  for (let i = 0; i < dirs.length; i++) clearMissingPlaceholderFiles(dirs[i]);
}

function makeMissingFileRecord(dirNode, name) {
  const dirPath = String(dirNode?.path || "");
  const fileName = String(name || "");
  const relPath = dirPath ? `${dirPath}/${fileName}` : fileName;
  const id = `missing::${relPath}`;
  const existing = WS.fileById.get(id);
  if (existing) return existing;
  const rec = {
    id,
    file: null,
    name: fileName,
    relPath,
    dirPath,
    ext: splitNameExt(fileName).ext.toLowerCase(),
    type: fileTypeForName(fileName) || "image",
    size: 0,
    lastModified: 0,
    url: null,
    thumbUrl: null,
    videoThumbUrl: null,
    indices: null,
    thumbMode: null,
    videoThumbMode: null,
    nativePath: "",
    aspectRatio: null,
    aspectRatioBucket: "",
    isMissingPlaceholder: true,
  };
  WS.fileById.set(id, rec);
  return rec;
}

function projectAltSourceOntoNode(node, source, rootVariants, relParts) {
  if (!node) return;
  const variantsHere = altVariantsAtRelativePath(rootVariants, relParts);
  const sourceHere = source || null;
  node.sourcePath = sourceHere ? String(sourceHere.sourcePath || "") : "";
  node.fsHandle = sourceHere ? sourceHere.fsHandle || null : null;
  node.isMissingPlaceholder = !sourceHere;
  if (!sourceHere) {
    node.childrenFiles = [];
    node.childrenDirs = [];
    return;
  }

  const dirNames = unionAltChildDirNames(variantsHere);
  dirNames.sort(compareIndexedNames);
  const fileEntries = unionAltChildFileEntries(variantsHere);
  fileEntries.sort((a, b) => compareIndexedNames(a.name, b.name));

  const pool = canonicalChildPool(node);
  const nextDirs = [];
  for (let i = 0; i < dirNames.length; i++) {
    const name = dirNames[i];
    let child = pool.get(name);
    if (!child) {
      child = makeDirNode(name, node);
      pool.set(name, child);
    }
    child.parent = node;
    child.name = name;
    child.path = node.path ? `${node.path}/${name}` : name;
    const childSource = altSourceChildByName(sourceHere, name);
    if (!childSource) {
      child.isMissingPlaceholder = true;
      child.childrenDirs = [];
      child.childrenFiles = [];
      child.fsHandle = null;
      child.sourcePath = "";
    } else {
      child.isMissingPlaceholder = false;
      projectAltSourceOntoNode(
        child,
        childSource,
        rootVariants,
        relParts.concat(name),
      );
    }
    if (WS.dirByPath) WS.dirByPath.set(child.path, child);
    nextDirs.push(child);
  }
  for (const [name, child] of pool.entries()) {
    if (dirNames.indexOf(name) >= 0) continue;
    const path = String(child?.path || "");
    if (path && WS.dirByPath && WS.dirByPath.get(path) === child) {
      WS.dirByPath.delete(path);
    }
  }

  const filesByStem = altSourceFilesByStem(sourceHere);
  const sourceIds = Array.isArray(sourceHere.childrenFiles)
    ? sourceHere.childrenFiles
    : [];
  const nextFiles = [];
  const usedStems = new Set();
  if (node.preserveOrder) {
    for (let i = 0; i < sourceIds.length; i++) {
      const rec = WS.fileById.get(sourceIds[i]);
      if (!rec) continue;
      const stemKey = altFileStemKey(rec.name);
      if (!stemKey || usedStems.has(stemKey)) continue;
      bindFileRecordToCanonical(rec, node.path);
      nextFiles.push(rec.id);
      usedStems.add(stemKey);
    }
    for (let i = 0; i < fileEntries.length; i++) {
      const entry = fileEntries[i];
      if (usedStems.has(entry.stemKey)) continue;
      nextFiles.push(makeMissingFileRecord(node, entry.name).id);
    }
  } else {
    for (let i = 0; i < fileEntries.length; i++) {
      const entry = fileEntries[i];
      const rec = filesByStem.get(entry.stemKey);
      if (rec) {
        bindFileRecordToCanonical(rec, node.path);
        nextFiles.push(rec.id);
      } else {
        nextFiles.push(makeMissingFileRecord(node, entry.name).id);
      }
    }
  }
  node.childrenDirs = nextDirs;
  node.childrenFiles = nextFiles;
}

function installFolderAltVariant(node, label, opts = null) {
  if (!node || !node.altVariants) return false;
  const options = opts && typeof opts === "object" ? opts : {};
  const variants = node.altVariants;
  const nextLabel = Object.prototype.hasOwnProperty.call(variants, label)
    ? String(label || "")
    : ORIGINAL_ALT_LABEL;
  restoreAllAltVariantFiles(node);
  clearMissingPlaceholderFiles(node);
  const source = variants[nextLabel] || variants[ORIGINAL_ALT_LABEL] || null;
  projectAltSourceOntoNode(node, source, variants, []);
  node.altLabel = nextLabel;
  node._altApplied = true;
  if (options.persist !== false) metaSetFolderAltLabel(node.path, nextLabel);
  if (options.refresh !== false)
    refreshViewAfterFolderAltSwap(node, { stayInPlace: !!options.stayInPlace });
  return true;
}

function applySavedFolderAlts(node) {
  if (!node) return;
  if (node.altVariants && !node._altApplied) {
    const saved = metaGetFolderAltLabel(node.path);
    const label =
      saved && Object.prototype.hasOwnProperty.call(node.altVariants, saved)
        ? saved
        : ORIGINAL_ALT_LABEL;
    installFolderAltVariant(node, label, { persist: false, refresh: false });
  }
  const dirs = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
  for (let i = 0; i < dirs.length; i++) applySavedFolderAlts(dirs[i]);
}

function finalizeFolderAltsForWorkspace() {
  if (!WS.root) return;
  try {
    foldAltFoldersInNode(WS.root);
    applySavedFolderAlts(WS.root);
  } catch (err) {
    console.error("ALT folder setup failed.", err);
  }
}

function folderAltVariantEntries(node) {
  if (!node || !node.altVariants) return [];
  const labels = Object.keys(node.altVariants);
  labels.sort((a, b) => {
    if (a === ORIGINAL_ALT_LABEL) return -1;
    if (b === ORIGINAL_ALT_LABEL) return 1;
    return String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  const current = String(node.altLabel || ORIGINAL_ALT_LABEL);
  return labels.map((label) => ({
    label,
    title: altVariantDisplayLabel(label),
    active: label === current,
  }));
}

// The record ids of a folder's files are the *source* tree's, so a swap
// replaces every one of them. This finds the file in the newly installed
// variant that stands for the one that was open, by the extension-insensitive
// identity key -- the same key the per-file thumbnail metadata is stored under,
// so `Foo/a.png` and `Foo -- VHS/a.avif` are one file with two forms.
function altEquivalentFileIdInDir(dirPath, identityKey) {
  const key = String(identityKey || "");
  if (!key) return "";
  const dirNode = WS.dirByPath.get(String(dirPath || ""));
  const files = Array.isArray(dirNode?.childrenFiles) ? dirNode.childrenFiles : [];
  for (let i = 0; i < files.length; i++) {
    const rec = WS.fileById.get(files[i]);
    if (!rec || rec.isMissingPlaceholder) continue;
    if (altCanonicalThumbKeyForRecord(rec) === key) return String(rec.id || "");
  }
  return "";
}

// Re-point every place that names the open file at its counterpart in the
// variant just installed, so switching ALTs while looking at a picture leaves
// you looking at the same picture in its other form rather than at nothing.
function carryOpenFileAcrossFolderAltSwap(snapshot) {
  if (!snapshot || !snapshot.fileId || !snapshot.identityKey) return;
  const nextId = altEquivalentFileIdInDir(snapshot.dirPath, snapshot.identityKey);
  if (!nextId || nextId === snapshot.fileId) return;
  if (WS.preview && WS.preview.fileId === snapshot.fileId)
    WS.preview.fileId = nextId;
  const oldKey = `file:${snapshot.fileId}`;
  const nextKey = `file:${nextId}`;
  if (!WS.view) return;
  if (WS.view.previewSelectedKey === oldKey) WS.view.previewSelectedKey = nextKey;
  if (WS.view.previewSelectAnchorKey === oldKey)
    WS.view.previewSelectAnchorKey = nextKey;
  if (WS.view.pendingPreviewSelectionKey === oldKey)
    WS.view.pendingPreviewSelectionKey = nextKey;
}

function captureOpenFileForFolderAltSwap() {
  if (!WS.preview || WS.preview.kind !== "file" || !WS.preview.fileId) return null;
  const rec = WS.fileById.get(WS.preview.fileId);
  if (!rec) return null;
  return {
    fileId: String(rec.id || ""),
    dirPath: String(rec.dirPath || ""),
    identityKey: altCanonicalThumbKeyForRecord(rec),
  };
}

// A swap made from the select menu acts on a folder you are looking *at*, so
// the file pane re-selects it. A swap made from the app menu acts on the folder
// you are *inside*, and re-selecting it would throw you out of the very view you
// made the change from -- so `stayInPlace` leaves both panes where they are and
// only re-resolves what the swap actually replaced.
function refreshViewAfterFolderAltSwap(node, opts = null) {
  const stayInPlace = !!(opts && opts.stayInPlace);
  const openFile = stayInPlace ? captureOpenFileForFolderAltSwap() : null;
  invalidateDirectoryDerivedIndex();
  rebuildDirectoryDerivedIndex();
  invalidateDirMetricsCaches();
  invalidateDirSortOrderCaches();
  rebuildDirectoriesEntries();
  if (stayInPlace) {
    carryOpenFileAcrossFolderAltSwap(openFile);
    preserveActivePreviewTargetDuringDirectoriesRefresh();
  } else {
    // The swapped folder is a card on screen (or the place itself): keep the
    // location and the card's selection.
    if (!preserveActivePreviewTargetDuringDirectoriesRefresh()) {
      const path = String(node?.path || "");
      const idx = path ? findDirEntryIndexByPath(path) : -1;
      if (idx >= 0) WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection({ force: true });
    }
  }
  renderDirectoriesPane(true);
  renderPreviewPane(true, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function swapFolderAltVariant(node, label, opts = null) {
  if (
    !installFolderAltVariant(node, label, {
      persist: true,
      refresh: true,
      stayInPlace: !!(opts && opts.stayInPlace),
    })
  )
    return false;
  showStatusMessage(`ALTs: ${altVariantDisplayLabel(label)}.`);
  return true;
}

// Where a select menu's ALTs entry starts looking. A folder answers for itself;
// anything else answers for the folder it sits in, which is what carries the
// switch down into a collection's interior.
function selectMenuAltSearchStartNode(target) {
  if (!target) return null;
  if (target.kind === "dir") return target.node || null;
  if (target.kind === "file")
    return WS.dirByPath.get(String(target.rec?.dirPath || "")) || null;
  if (target.kind === "tag")
    return WS.dirByPath.get(String(target.entry?.originPath || "")) || null;
  return null;
}

// The nearest alt-bearing folder at or above the selected item. Walking up is
// the whole point: once you are browsing inside `Foo` you can no longer select
// `Foo`, so its own select menu is out of reach and every item you *can* select
// in there has to offer the switch instead.
function folderAltNodeForSelectMenuTarget(target) {
  let node = selectMenuAltSearchStartNode(target);
  const seen = new Set();
  while (node && !seen.has(node)) {
    seen.add(node);
    if (folderAltVariantEntries(node).length > 1) return node;
    node = node.parent || null;
  }
  return null;
}

function buildSelectMenuAltsSubmenu(target) {
  const node = folderAltNodeForSelectMenuTarget(target);
  if (!node) return null;
  const entries = folderAltVariantEntries(node);
  if (entries.length < 2) return null;
  // The panel reads the same whether the folder is the selected item or three
  // levels above it: the folder named at the top, every version listed, and the
  // one you are on marked. Only the refresh differs -- see `own` below.
  const heading = document.createElement("div");
  heading.className = "dropdownMenuTitle";
  heading.setAttribute("aria-hidden", "true");
  heading.textContent = String(node.name || "ALTs");
  // Acting on the selected folder itself is the original gesture and keeps the
  // original refresh, which re-selects that folder. Acting on an ancestor is a
  // swap made from *inside* it, where re-selecting it would throw you out of
  // the view you made the change from.
  const own = target?.kind === "dir" && target.node === node;
  const items = [heading];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    items.push(
      appMenuChoiceButton(
        entry.title,
        () => {
          if (entry.active) return;
          swapFolderAltVariant(node, entry.label, { stayInPlace: !own });
        },
        entry.active,
      ),
    );
  }
  return createDropdownMenuSubmenu("ALTs", items);
}

function altSourceDiskPathsForNode(node) {
  if (!node || !node.altVariants) return [];
  const parentPath = String(node.parent?.path || "");
  const out = [];
  for (const label of Object.keys(node.altVariants)) {
    if (!label) continue;
    const altName = formatAltFolderName(node.name, label);
    const path = parentPath ? `${parentPath}/${altName}` : altName;
    out.push({ label, name: altName, path });
  }
  return out;
}

function remapAltSourceTreePaths(source, oldPrefix, newPrefix) {
  if (!source) return;
  source.sourcePath = remapPathPrefix(
    oldPrefix,
    newPrefix,
    String(source.sourcePath || ""),
  );
  const dirs = Array.isArray(source.childrenDirs) ? source.childrenDirs : [];
  for (let i = 0; i < dirs.length; i++) {
    remapAltSourceTreePaths(dirs[i], oldPrefix, newPrefix);
  }
}

function remapAltGroupAfterCanonicalRename(node, oldPath, newPath, oldName, newName) {
  if (!node || !node.altVariants) return;
  remapAltSourceTreePaths(node.altVariants[ORIGINAL_ALT_LABEL], oldPath, newPath);
  for (const label of Object.keys(node.altVariants)) {
    if (!label) continue;
    const oldAltPrefix = formatAltFolderName(oldName, label);
    const newAltPrefix = formatAltFolderName(newName, label);
    const parentPath = String(node.parent?.path || "");
    const oldAltPath = parentPath ? `${parentPath}/${oldAltPrefix}` : oldAltPrefix;
    const newAltPath = parentPath ? `${parentPath}/${newAltPrefix}` : newAltPrefix;
    remapAltSourceTreePaths(node.altVariants[label], oldAltPath, newAltPath);
    if (node.altVariants[label]) node.altVariants[label].name = newAltPrefix;
    updateFileRecordsForRename(oldAltPath, newAltPath);
  }
  if (node.altVariants[ORIGINAL_ALT_LABEL]) {
    node.altVariants[ORIGINAL_ALT_LABEL].name = newName;
  }
}

function metaGetFolderAltLabel(path) {
  const p = normalizeDirPathValue(path);
  if (!WS.meta || !WS.meta.folderAltByPath) return ORIGINAL_ALT_LABEL;
  return String(WS.meta.folderAltByPath.get(p) || ORIGINAL_ALT_LABEL);
}

function metaSetFolderAltLabel(path, label) {
  const p = normalizeDirPathValue(path);
  if (!WS.meta || !WS.meta.folderAltByPath) return false;
  const next = String(label || ORIGINAL_ALT_LABEL);
  if (!next) WS.meta.folderAltByPath.delete(p);
  else WS.meta.folderAltByPath.set(p, next);
  metaMarkDirty(META_DOC_IDS.prefGeneral);
  return true;
}
