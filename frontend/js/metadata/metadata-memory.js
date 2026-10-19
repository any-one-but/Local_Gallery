/* Metadata is never forgotten
   Fingerprints and the passes that give remembered metadata back to folders
   and files that return. */

function metaComputeFingerprints() {
  WS.meta.dirFingerprints.clear();
  if (!WS.root) return;

  (function walk(node) {
    for (const d of node.childrenDirs) walk(d);

    const fileIds = node.childrenFiles.slice().sort();
    const childFps = node.childrenDirs
      .slice()
      .map((d) => {
        const fp = WS.meta.dirFingerprints.get(d.path || "");
        return Number.isFinite(fp) ? fp : 0;
      })
      .sort((a, b) => a - b);

    let s = "F:";
    for (let i = 0; i < fileIds.length; i++) s += fileIds[i] + "|";
    s += "D:";
    for (let i = 0; i < childFps.length; i++) s += childFps[i] + "|";

    const fp = hash32(s);
    WS.meta.dirFingerprints.set(node.path || "", fp);
    metaRememberFingerprintForPath(node.path || "", fp);
  })(WS.root);
}

// ---------------------------------------------------------------------------
// Metadata is never forgotten when a folder or file stops existing.
//
// Every log is keyed by path, and the rule is that a path's metadata outlives
// whatever used to be at it: a folder deleted from inside the app, emptied out
// of the Trash, removed in Finder or eaten by a script keeps its score, tags,
// thumbnail pin, appearance preset, media filter, album/gallery membership,
// sort mode, ALT choice and per-file thumbnail settings in the logs. Put the
// folder back at the same path and all of it is simply there again; put it
// back somewhere else and the fingerprint match below still finds it.
//
// Four pieces cooperate, and none of them is optional:
//   * dirFingerprintMemory keeps the last fingerprint ever computed for a
//     path, because dirFingerprints is rebuilt from the live tree only and a
//     folder that is gone would otherwise be written out with fp 0 — losing
//     the one thing that can match it by content rather than by name.
//   * the doc writers emit every path they hold, live or not.
//   * metaPromotePendingFolderMetadata puts remembered metadata back onto a
//     folder the moment it reappears in the tree.
//   * metaReclaimRestoredTrashOrigins does the same for a folder restored to
//     the place it was trashed from, whose metadata the Trash move re-keyed.
// Nothing anywhere may delete metadata merely because its path is missing.
// ---------------------------------------------------------------------------
function metaRememberFingerprintForPath(path, fp) {
  if (!WS.meta) return;
  if (!(WS.meta.dirFingerprintMemory instanceof Map))
    WS.meta.dirFingerprintMemory = new Map();
  const value = Number(fp);
  if (!Number.isFinite(value)) return;
  WS.meta.dirFingerprintMemory.set(String(path || ""), value >>> 0);
}

function metaFingerprintForPath(path) {
  const key = String(path || "");
  const live =
    WS.meta && WS.meta.dirFingerprints ? WS.meta.dirFingerprints.get(key) : null;
  if (Number.isFinite(live)) return live >>> 0;
  const remembered =
    WS.meta && WS.meta.dirFingerprintMemory instanceof Map
      ? WS.meta.dirFingerprintMemory.get(key)
      : null;
  return Number.isFinite(remembered) ? remembered >>> 0 : 0;
}

// A folder that reappears - restored from the Trash, put back on disk, or
// merely materialized late out of a deferred catalog - takes back whatever was
// remembered for its path. The getters for scores, tags and appearance presets
// already fall back to the pending maps, but the folder thumbnail pin does not
// and the doc writers prefer the live map, so this has to be a real move
// rather than a read-time fallback. Remembered values only ever fill a blank:
// a folder that has picked up its own score or tags keeps them.
function metaPromotePendingFolderMetadata() {
  if (!WS.meta || !WS.dirByPath || !WS.dirByPath.size) return false;
  let changed = false;
  const promote = (pending, live, isBlank) => {
    if (!(pending instanceof Map) || !(live instanceof Map) || !pending.size)
      return;
    for (const [pathRaw, value] of Array.from(pending.entries())) {
      const path = String(pathRaw || "");
      if (!WS.dirByPath.has(path)) continue;
      if (live.has(path) && !isBlank(live.get(path))) {
        pending.delete(path);
        continue;
      }
      live.set(path, value);
      pending.delete(path);
      changed = true;
    }
  };
  promote(
    WS.meta.pendingDirScores,
    WS.meta.dirScores,
    (value) => !Number.isFinite(value) || (value | 0) === 0,
  );
  promote(
    WS.meta.pendingTagsByPath,
    WS.meta.dirTags,
    (value) => !Array.isArray(value) || !value.length,
  );
  promote(
    WS.meta.pendingDirThumbPresets,
    WS.meta.dirThumbPresets,
    (value) => !String(value || ""),
  );
  promote(
    WS.meta.pendingDirAppearancePresetIds,
    WS.meta.dirAppearancePresetIds,
    (value) => !String(value || ""),
  );
  return changed;
}

// The path-keyed folder stores, each with the test for "this is a placeholder
// rather than something the user set". Both the question below and the clearing
// beside it read this one list, so neither can fall behind the other.
function metaFolderMetadataStores() {
  const meta = WS.meta || {};
  const blankNumber = (v) => !Number.isFinite(Number(v)) || (Number(v) | 0) === 0;
  const blankList = (v) => !Array.isArray(v) || !v.length;
  const blankText = (v) => !String(v || "");
  const never = () => false;
  return [
    [meta.dirScores, blankNumber],
    [meta.pendingDirScores, blankNumber],
    [meta.dirTags, blankList],
    [meta.pendingTagsByPath, blankList],
    [meta.dirThumbPresets, blankText],
    [meta.pendingDirThumbPresets, blankText],
    [meta.dirAppearancePresetIds, blankText],
    [meta.pendingDirAppearancePresetIds, blankText],
    [meta.folderAlbumByPath, blankText],
    [meta.folderGalleriesByPath, blankList],
    [meta.folderMediaFilterByPath, blankList],
    [meta.containerSortByFolderPath, blankText],
    [meta.folderAltByPath, blankText],
    [meta.fileThumbCrop, never],
    [meta.videoThumbTime, never],
  ].filter(([map]) => map instanceof Map);
}

// True when any log still holds something for this folder or anything under
// it. Blank placeholders do not count: the loaders seed every live folder with
// score 0 and an empty tag list, and treating those as "has metadata" would
// stop a restored folder from reclaiming what it owned.
function metaHasStoredFolderMetadata(path) {
  const p = String(path || "");
  if (!p || !WS.meta) return false;
  const prefix = p + "/";
  for (const [map, isBlank] of metaFolderMetadataStores()) {
    for (const [keyRaw, value] of map.entries()) {
      const key = String(keyRaw || "");
      if (key !== p && !key.startsWith(prefix)) continue;
      if (!isBlank(value)) return true;
    }
  }
  return false;
}

// Drop the placeholder rows sitting on a path so remembered metadata can be
// moved onto it. Re-keying a whole prefix rebuilds each Map, and a blank row
// already at the destination would otherwise be written *after* the remembered
// one and quietly win. Only called once metaHasStoredFolderMetadata has said
// there is nothing but placeholders here.
function metaForgetBlankFolderMetadata(path) {
  const p = String(path || "");
  if (!p || !WS.meta) return;
  const prefix = p + "/";
  for (const [map, isBlank] of metaFolderMetadataStores()) {
    for (const keyRaw of Array.from(map.keys())) {
      const key = String(keyRaw || "");
      if (key !== p && !key.startsWith(prefix)) continue;
      if (!isBlank(map.get(keyRaw))) continue;
      map.delete(keyRaw);
    }
  }
}

// Moving a folder to the Trash re-keys its metadata under the trash path, and
// the origin record in trash.log is what remembers where it came from. That
// record is now kept even after the item leaves the Trash, so a folder put
// back at its old place - from a backup, by hand, by any route at all - is
// handed its metadata again here rather than coming back blank.
function metaReclaimRestoredTrashOrigins() {
  if (!WS.meta || !(WS.meta.trashItemsByPath instanceof Map)) return false;
  if (!WS.dirByPath || !WS.dirByPath.size) return false;
  let changed = false;
  for (const [trashPathRaw, item] of Array.from(
    WS.meta.trashItemsByPath.entries(),
  )) {
    const trashPath = normalizeWorkspaceRelPath(trashPathRaw);
    const originalPath = normalizeWorkspaceRelPath(item && item.originalPath);
    if (!trashPath || !originalPath) continue;
    if (WS.dirByPath.has(trashPath)) continue; // still sitting in the Trash
    if (!WS.dirByPath.has(originalPath)) continue; // not back yet
    if (!metaHasStoredFolderMetadata(trashPath)) continue; // nothing to hand over
    if (metaHasStoredFolderMetadata(originalPath)) continue; // never clobber
    metaForgetBlankFolderMetadata(originalPath);
    updateMetaPathsForRename(trashPath, originalPath);
    WS.meta.trashItemsByPath.delete(trashPath);
    changed = true;
  }
  if (changed) metaMarkDirty(META_DOC_IDS.trash);
  return changed;
}

// Thumbnail picks left filed under the Trash by a Put Back that never saved
// them (see updateMetaPathsForRename). Put Back deletes the Trash record, so
// metaReclaimRestoredTrashOrigins cannot see these: a Trash item with no
// record, no longer in the Trash, whose name is a folder in the root again, is
// that folder. Its folder picks (key and the file it names), crops and video
// frames move back -- each only where the folder has nothing of its own, so a
// pick made since always wins and the old one is left where it was.
function metaReclaimStrandedTrashMetadata() {
  const meta = WS.meta;
  if (!meta || !WS.dirByPath || !WS.dirByPath.size) return false;
  const trashPrefix = INTERNAL_TRASH_DIR_NAME + "/";
  const records =
    meta.trashItemsByPath instanceof Map ? meta.trashItemsByPath : new Map();
  const destinations = new Map(); // "<trash>/<name>" -> "<name>", or null
  const destinationFor = (path) => {
    const p = String(path || "");
    if (!p.startsWith(trashPrefix)) return null;
    const name = p.slice(trashPrefix.length).split("/")[0];
    if (!name) return null;
    const item = trashPrefix + name;
    if (!destinations.has(item)) {
      const usable =
        !WS.dirByPath.has(item) &&
        !records.has(item) &&
        (WS.dirByPath.has(name) || metaHasStorage(name));
      destinations.set(item, usable ? name : null);
    }
    const dest = destinations.get(item);
    return dest === null ? null : dest + p.slice(item.length);
  };
  let changed = false;
  const stripValue = (value, from, to) => {
    const raw = String(value || "");
    return raw === from || raw.startsWith(from + "/")
      ? to + raw.slice(from.length)
      : raw;
  };
  const pinStores = [meta.dirThumbPresets, meta.pendingDirThumbPresets];
  for (const store of pinStores) {
    if (!(store instanceof Map)) continue;
    for (const [key, value] of Array.from(store.entries())) {
      const dest = destinationFor(key);
      if (!dest) continue;
      if (
        String(meta.dirThumbPresets.get(dest) || "") ||
        (meta.pendingDirThumbPresets instanceof Map &&
          String(meta.pendingDirThumbPresets.get(dest) || ""))
      )
        continue;
      const item = trashPrefix + dest.split("/")[0];
      const target = WS.dirByPath.has(dest)
        ? meta.dirThumbPresets
        : meta.pendingDirThumbPresets;
      if (!(target instanceof Map)) continue;
      target.set(dest, stripValue(value, item, dest.split("/")[0]));
      store.delete(key);
      changed = true;
    }
  }
  for (const store of [meta.fileThumbCrop, meta.videoThumbTime]) {
    if (!(store instanceof Map)) continue;
    for (const [key, value] of Array.from(store.entries())) {
      const dest = destinationFor(key);
      if (!dest || store.has(dest)) continue;
      store.set(dest, value);
      store.delete(key);
      changed = true;
    }
  }
  return changed;
}

// Thumbnail picks, crops and video frames name files by path, so a folder or
// file renamed or moved outside the app (Finder, clean.sh's renaming, a Set
// dragged out of the Trash into a Model) would leave them pointing nowhere.
// Each file they name is therefore also remembered by what a rename does not
// change -- its size and modification time -- in the thumbnails document
// (`fileIdentityByRelPath`), and at every load metaFollowMovedThumbnailFiles
// finds a missing file by that identity and moves what pointed at it. Folder
// fingerprints cannot do this: a file's id contains its path.
function thumbnailFileIdentityOfRecord(rec) {
  if (!rec || rec.isMissingPlaceholder) return "";
  if (String(rec.id || "").startsWith("missing::")) return "";
  const size = Number(rec.size != null ? rec.size : rec.file && rec.file.size);
  const modified = Number(
    rec.lastModified != null ? rec.lastModified : rec.file && rec.file.lastModified,
  );
  if (!(size > 0) || !(modified > 0)) return "";
  return `${size}:${Math.floor(modified)}`;
}

function thumbnailRecordsByRelPath() {
  const byRelPath = new Map();
  if (!(WS.fileById instanceof Map)) return byRelPath;
  for (const rec of WS.fileById.values()) {
    const relPath = normalizeWorkspaceRelPath(rec && rec.relPath);
    if (relPath && thumbnailFileIdentityOfRecord(rec)) byRelPath.set(relPath, rec);
  }
  return byRelPath;
}

// The identity of every file the document names: read off the file when it is
// loaded, else what was remembered for it (a stored folder's files are never
// loaded, and a missing file is exactly the one whose identity matters).
function thumbnailFileIdentitiesForDoc(relPaths) {
  const out = {};
  const remembered =
    WS.meta && WS.meta.thumbFileIdentity instanceof Map
      ? WS.meta.thumbFileIdentity
      : new Map();
  const byRelPath = thumbnailRecordsByRelPath();
  for (const raw of relPaths || []) {
    const relPath = normalizeWorkspaceRelPath(raw);
    if (!relPath || out[relPath]) continue;
    const identity =
      thumbnailFileIdentityOfRecord(byRelPath.get(relPath)) ||
      remembered.get(relPath) ||
      "";
    if (identity) out[relPath] = identity;
  }
  return out;
}

function metaFollowMovedThumbnailFiles() {
  const meta = WS.meta;
  if (!meta || !WS.dirByPath || !WS.dirByPath.size) return false;
  if (!(meta.thumbFileIdentity instanceof Map))
    meta.thumbFileIdentity = new Map();
  const remembered = meta.thumbFileIdentity;
  const byRelPath = thumbnailRecordsByRelPath();
  if (!byRelPath.size) return false;
  const isSentinel = (raw) =>
    raw === FOLDER_THUMB_NONE_SENTINEL || raw === FOLDER_THUMB_ROTATE_SENTINEL;
  const stored = new Set(getStoredFolderPaths());
  const inStorage = (path) => pathIsWithinStoredFolder(path, stored);
  let changed = false;

  // Every file named anywhere, and its identity now (recorded so picks made
  // before identities existed can be followed from here on).
  const named = new Set();
  for (const map of [meta.dirThumbPresets, meta.pendingDirThumbPresets, meta.tagThumbPresets]) {
    if (!(map instanceof Map)) continue;
    for (const value of map.values()) {
      const raw = String(value || "");
      if (!isSentinel(raw) && normalizeWorkspaceRelPath(raw))
        named.add(normalizeWorkspaceRelPath(raw));
    }
  }
  for (const map of [meta.fileThumbCrop, meta.videoThumbTime]) {
    if (!(map instanceof Map)) continue;
    for (const key of map.keys()) {
      if (normalizeWorkspaceRelPath(key)) named.add(normalizeWorkspaceRelPath(key));
    }
  }
  for (const relPath of named) {
    const identity = thumbnailFileIdentityOfRecord(byRelPath.get(relPath));
    if (identity && remembered.get(relPath) !== identity) {
      remembered.set(relPath, identity);
      changed = true;
    }
  }

  // Where each missing file is now: the one loaded file with its identity.
  const missing = [];
  for (const relPath of named) {
    if (byRelPath.has(relPath) || inStorage(relPath)) continue;
    if (remembered.get(relPath)) missing.push(relPath);
  }
  if (!missing.length) return changed;
  const wanted = new Set(missing.map((relPath) => remembered.get(relPath)));
  const holders = new Map(); // identity -> relPath, or "" when not unique
  for (const [relPath, rec] of byRelPath.entries()) {
    const identity = thumbnailFileIdentityOfRecord(rec);
    if (!wanted.has(identity)) continue;
    holders.set(identity, holders.has(identity) ? "" : relPath);
  }
  const movedTo = new Map();
  for (const relPath of missing) {
    const target = holders.get(remembered.get(relPath));
    if (target) movedTo.set(relPath, target);
  }
  if (!movedTo.size) return changed;

  // Crops and frames follow their file, never over the new file's own.
  for (const map of [meta.fileThumbCrop, meta.videoThumbTime]) {
    if (!(map instanceof Map)) continue;
    for (const [key, value] of Array.from(map.entries())) {
      const target = movedTo.get(normalizeWorkspaceRelPath(key));
      if (!target || map.has(target)) continue;
      map.set(target, value);
      map.delete(key);
      changed = true;
    }
  }
  // A Tag's pick just points at the file's new place.
  if (meta.tagThumbPresets instanceof Map) {
    for (const [key, value] of Array.from(meta.tagThumbPresets.entries())) {
      const target = movedTo.get(normalizeWorkspaceRelPath(value));
      if (!target) continue;
      meta.tagThumbPresets.set(key, target);
      changed = true;
    }
  }
  // A folder's pick does too; and when the folder itself is gone, the pick
  // goes to the folder now holding the file at the same depth -- the Set the
  // file is in for a Set's pick, that Set's Model for a Model's -- unless that
  // folder has a pick of its own.
  const ownPick = (path) =>
    !!String(meta.dirThumbPresets.get(path) || "") ||
    (meta.pendingDirThumbPresets instanceof Map &&
      !!String(meta.pendingDirThumbPresets.get(path) || ""));
  for (const store of [meta.dirThumbPresets, meta.pendingDirThumbPresets]) {
    if (!(store instanceof Map)) continue;
    for (const [key, value] of Array.from(store.entries())) {
      const raw = String(value || "");
      if (isSentinel(raw)) continue;
      const fromFile = normalizeWorkspaceRelPath(raw);
      const target = movedTo.get(fromFile);
      if (!target) continue;
      const folder = normalizeDirPathValue(key);
      if (WS.dirByPath.has(folder) || inStorage(folder)) {
        store.set(key, target);
        changed = true;
        continue;
      }
      if (!folder || !fromFile.startsWith(folder + "/")) continue;
      const depth = fromFile.slice(folder.length + 1).split("/").length;
      const targetParts = target.split("/");
      if (targetParts.length <= depth) continue;
      const dest = targetParts.slice(0, targetParts.length - depth).join("/");
      if (!WS.dirByPath.has(dest) || ownPick(dest)) continue;
      meta.dirThumbPresets.set(dest, target);
      store.delete(key);
      changed = true;
    }
  }
  for (const [from, target] of movedTo.entries()) {
    if (!remembered.has(target)) remembered.set(target, remembered.get(from));
  }
  return changed;
}
