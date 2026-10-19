/* Random jumps
   The Random controls' jumps. */

/* The random jumps (see "Randomizing" in CLAUDE.md).

   Jump to random set picks among the sets of the container you are in, and
   opens the first file of the one it lands on. The container is the one Next
   folder walks (getVisibleSiblingDirsForSlide), so inside a Tag or special view
   it is that view's sets and the jump never leaves it; in a plain set it is the
   model folder. From a container's own grid (a model, a Tag, a special view) it
   picks among the sets that grid shows.

   Jump to random set in root picks among every model folder's sets, and Jump to
   random model lands on a model folder's grid.

   A candidate set has a file passing the current filters, and each jump leaves
   out the set (or model) you are in when there is another. */
function setFolderForNode(node) {
  let cur = node || null;
  while (cur && cur.parent) {
    if (cur.parent.parent === WS.root) return cur;
    cur = cur.parent;
  }
  return null;
}

function randomJumpLocationNode() {
  const location = previewLocationDirNode();
  if (location && !location._skipTagFilters) return location;
  return WS.nav.dirNode || null;
}

// A random set out of `dirs` that has something to open, preferring anything
// but `exclude`. Candidates are tried in a shuffled order and stop at the first
// with a visible file, so a big pool costs one file listing, not one per set.
function pickRandomSetWithFiles(dirs, exclude = null) {
  const pool = (Array.isArray(dirs) ? dirs : []).filter(
    (d) =>
      d &&
      d.parent &&
      d.parent.parent === WS.root &&
      !isStorageStubDirNode(d) &&
      !isInternalTrashDirNode(d.parent),
  );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const hasFiles = (d) => getPreviewFileIdsForDir(d, false).length > 0;
  for (const d of pool) if (d !== exclude && hasFiles(d)) return d;
  return exclude && pool.includes(exclude) && hasFiles(exclude) ? exclude : null;
}

// Lands the way Jump to... does: the file pane in the set, its first file open.
function landOnSetFirstFile(set) {
  const fileId = getPreviewFileIdsForDir(set, false)[0];
  return !!fileId && jumpToLocationTarget({ kind: "file", id: String(fileId) });
}

// Opens a set's card in the grid on screen exactly as the open key would, so a
// set picked from a Tag's grid is entered through the Tag and keeps its way
// back. Without quick navigation that shows the set's grid; the first file is
// then opened in place.
function openPreviewGridSetCard(set) {
  const key = `dir:${String(set?.path || "")}`;
  const card = getPreviewSelectableCards().find(
    (c) => String(c?.dataset?.previewItemKey || "") === key,
  );
  if (!card) return false;
  setPreviewSelectionCard(card, { activate: true });
  if (String(WS.view.previewSelectedKey || "") !== key) return false;
  openSelectedPreviewItem();
  if (WS.nav.dirNode === set && !(WS.preview?.kind === "file" && WS.preview.fileId))
    jumpToDirectoryFirstFile(set);
  return true;
}

function randomSetJump() {
  if (!WS.root) return false;
  const location = previewLocationDirNode() || WS.nav.dirNode || null;
  const current = location && !location._skipTagFilters ? setFolderForNode(location) : null;
  let sets = [];
  if (location && location._skipTagFilters) {
    const entries = getPreviewFolderAndFileEntries(location, { includeFiles: false });
    sets = (Array.isArray(entries.folderEntries) ? entries.folderEntries : [])
      .filter((entry) => entry && entry.kind === "dir" && entry.node)
      .map((entry) => entry.node);
  } else if (current) {
    sets = getVisibleSiblingDirsForSlide(current);
  } else if (location && location.parent === WS.root) {
    sets = getChildDirsForNode(location);
  } else {
    showStatusMessage("Jump to random set: there are no sets here.");
    return true;
  }
  const pick = pickRandomSetWithFiles(sets, current);
  if (!pick) {
    showStatusMessage("Jump to random set: nothing to open.");
    return true;
  }
  if (VIEWER_MODE) hideOverlay();
  let moved = false;
  if (location && location._skipTagFilters) moved = openPreviewGridSetCard(pick);
  // In a set, move sideways the way Next folder does: the view around it -- a
  // Tag, a search, Favorites -- and the way back out all stay as they are.
  else if (current && WS.nav.dirNode === current) moved = jumpToDirectoryFirstFile(pick);
  if (!moved) moved = landOnSetFirstFile(pick);
  showStatusMessage(moved ? "Random set" : "Jump to random set: could not open it.");
  return true;
}

// Every Set in every Model, as the listings show them.
function allLibrarySets() {
  const sets = [];
  for (const model of getChildDirsForNode(WS.root)) {
    if (!model || isInternalTrashDirNode(model) || isStorageStubDirNode(model)) continue;
    for (const set of getChildDirsForNode(model)) sets.push(set);
  }
  return sets;
}

function randomRootSetJump() {
  if (!WS.root) return false;
  const sets = allLibrarySets();
  const pick = pickRandomSetWithFiles(sets, setFolderForNode(randomJumpLocationNode()));
  if (!pick) {
    showStatusMessage("Jump to random set in root: nothing to open.");
    return true;
  }
  if (VIEWER_MODE) hideOverlay();
  showStatusMessage(
    landOnSetFirstFile(pick)
      ? "Random set in root"
      : "Jump to random set in root: could not open it.",
  );
  return true;
}

// Over the same list of root folders Jump to... and the root folder steps use.
function randomModelJump() {
  if (!WS.root) return false;
  const models = appMenuJumpChildTargets({ kind: "dir", node: WS.root }).filter(
    (t) => t && t.kind === "dir" && t.node && t.node.parent === WS.root,
  );
  const current = rootLevelFolderForNode(randomJumpLocationNode());
  const pool = models.length > 1 ? models.filter((t) => t.node !== current) : models;
  if (!pool.length) {
    showStatusMessage("Jump to random model: nothing to open.");
    return true;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (VIEWER_MODE) hideOverlay();
  showStatusMessage(
    jumpToLocationTarget(pick, { freshGrid: true })
      ? "Random model"
      : "Jump to random model: could not open it.",
  );
  return true;
}

/* Jump to random file in current folder / current model / root. Any file, not
   the first of a set: a set is drawn weighted by how many files it holds, then
   a file in it, so every file is about as likely as any other without listing
   the whole library. A set whose files the filters hide is passed over. The
   file open now is left out when there is another.

   "Current folder" is the set an open file sits in; with no file open, the
   folder on screen -- a set, a model (its sets' files), a Tag or special view
   (the sets its grid shows) or the root. "Current model" is the model folder
   around you. Landing keeps the view you are in, the way Jump to random set
   does: inside a set it moves sideways, from a Tag's grid it opens the set
   through the Tag, and otherwise it lands the way Jump to... does. */
function randomFileJumpOpenFileRecord() {
  if (WS.preview?.kind !== "file" || !WS.preview.fileId) return null;
  return WS.fileById.get(String(WS.preview.fileId)) || null;
}

function setsInsideNode(node) {
  if (!node) return [];
  if (node === WS.root) return allLibrarySets();
  if (node.parent === WS.root) return getChildDirsForNode(node);
  if (node.parent && node.parent.parent === WS.root) return [node];
  return [];
}

function randomFileJumpSets(scope) {
  const openRec = randomFileJumpOpenFileRecord();
  const openDir = openRec ? WS.dirByPath.get(String(openRec.dirPath || "")) || null : null;
  if (scope === "root") return { sets: allLibrarySets() };
  if (scope === "model") {
    const model = rootLevelFolderForNode(openDir || randomJumpLocationNode());
    return model && !isInternalTrashDirNode(model) && !isStorageStubDirNode(model)
      ? { sets: getChildDirsForNode(model) }
      : { sets: [], why: "you are not in a model" };
  }
  if (openDir) return { sets: setsInsideNode(setFolderForNode(openDir) || openDir) };
  const location = previewLocationDirNode() || WS.nav.dirNode || null;
  if (location && location._skipTagFilters) {
    const entries = getPreviewFolderAndFileEntries(location, { includeFiles: false });
    const sets = [];
    for (const entry of Array.isArray(entries.folderEntries) ? entries.folderEntries : []) {
      if (entry && entry.kind === "dir" && entry.node) sets.push(...setsInsideNode(entry.node));
    }
    return { sets, viaGrid: true };
  }
  return { sets: setsInsideNode(location || WS.root) };
}

function pickRandomFileFromSets(sets, excludeId = "") {
  const pool = (Array.isArray(sets) ? sets : []).filter(
    (d) =>
      d &&
      d.parent &&
      d.parent.parent === WS.root &&
      !isStorageStubDirNode(d) &&
      !isInternalTrashDirNode(d.parent),
  );
  const weights = pool.map((d) => Math.max(0, Number(d.recursiveFileCount) || 0));
  if (!weights.some((w) => w > 0)) weights.fill(1);
  let fallback = null;
  for (let tries = 0; tries < pool.length; tries++) {
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) break;
    let r = Math.random() * total;
    let i = 0;
    for (; i < pool.length; i++) {
      if (weights[i] <= 0) continue;
      r -= weights[i];
      if (r < 0) break;
    }
    if (i >= pool.length) i = weights.findLastIndex((w) => w > 0);
    const ids = getPreviewFileIdsForDir(pool[i], false).map(String);
    const others = ids.filter((id) => id !== String(excludeId || ""));
    if (others.length)
      return { set: pool[i], id: others[Math.floor(Math.random() * others.length)] };
    if (ids.length && !fallback) fallback = { set: pool[i], id: ids[0] };
    weights[i] = 0;
  }
  return fallback;
}

function randomFileJump(scope) {
  if (!WS.root) return false;
  const name =
    scope === "root"
      ? "Jump to random file in root"
      : scope === "model"
        ? "Jump to random file in current model"
        : "Jump to random file in current folder";
  const { sets, why, viaGrid } = randomFileJumpSets(scope);
  if (!sets.length) {
    showStatusMessage(`${name}: ${why || "there are no files here"}.`);
    return true;
  }
  const openRec = randomFileJumpOpenFileRecord();
  const pick = pickRandomFileFromSets(sets, openRec ? openRec.id : "");
  if (!pick) {
    showStatusMessage(`${name}: nothing to open.`);
    return true;
  }
  if (VIEWER_MODE) hideOverlay();
  const navIsSet = !!(WS.nav.dirNode && setFolderForNode(WS.nav.dirNode) === WS.nav.dirNode);
  let moved = false;
  if (viaGrid && openPreviewGridSetCard(pick.set) && WS.nav.dirNode === pick.set)
    moved = jumpToDirectoryFile(pick.set, pick.id);
  // In a set, move sideways (or stay put): the view around it and the way back
  // out stay as they are.
  else if (scope !== "root" && navIsSet && openRec)
    moved = jumpToDirectoryFile(pick.set, pick.id);
  if (!moved) moved = jumpToLocationTarget({ kind: "file", id: String(pick.id) });
  showStatusMessage(moved ? "Random file" : `${name}: could not open it.`);
  return true;
}
