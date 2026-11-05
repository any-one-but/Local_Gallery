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
// a folder that has picked up its own score keeps it. Tags are merged.
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
  // Tags are merged rather than filled: a folder that came back and was given
  // a Tag before this ran keeps that Tag and gets its old ones back too.
  if (WS.meta.pendingTagsByPath instanceof Map && WS.meta.dirTags instanceof Map) {
    for (const [pathRaw, value] of Array.from(
      WS.meta.pendingTagsByPath.entries(),
    )) {
      const path = String(pathRaw || "");
      if (!WS.dirByPath.has(path)) continue;
      const remembered = Array.isArray(value) ? value : [];
      const own = WS.meta.dirTags.get(path) || [];
      const merged = normalizeTagList([...own, ...remembered]);
      if (merged.length !== own.length) {
        WS.meta.dirTags.set(path, merged);
        changed = true;
      }
      WS.meta.pendingTagsByPath.delete(path);
    }
  }
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
// rather than something the user set".
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

// Folders that come back from the Trash take their metadata back, entry by
// entry. Moving a folder to the Trash re-keys everything about it -- and about
// everything inside it -- under "__LOCAL_GALLERY_TRASH__/<name>", and the origin
// record in trash.log remembers where it came from. Once that Trash item is no
// longer in the Trash and its folder is in the library again (put back by hand,
// from a backup, dragged in from an archive -- any route), every entry filed
// under it moves to the same place under the folder:
//
//   * Tags are merged: the folder keeps the Tags it has now and gets back every
//     Tag it had (a "groan" given to it since it came back no longer hides its
//     "reddit" and "wg").
//   * Anything else (score, thumbnail pick, filter preset, crop, video frame...)
//     fills a blank only. Where the folder has a value of its own now, that
//     value wins and the old one stays filed under the Trash, never deleted.
//   * Thumbnail picks anywhere that name a file inside that Trash item are
//     pointed at the file's place now.
//
// It used to be all or nothing: a restored folder with *any* metadata of its own
// got nothing back. Because metadata is never forgotten, a returning Model
// nearly always has some -- an old Set name's tags, kept from before it was
// renamed -- so most of an archive came back with no Tags and no thumbnails.
// The record is deleted only once nothing is left filed under the item.
//
// A Trash item with no record (Put Back used to delete it) is matched by name to
// a folder in the root.
function metaReclaimRestoredTrashOrigins() {
  const meta = WS.meta;
  if (!meta || !WS.dirByPath || !WS.dirByPath.size) return false;
  const trashPrefix = INTERNAL_TRASH_DIR_NAME + "/";
  const records =
    meta.trashItemsByPath instanceof Map ? meta.trashItemsByPath : new Map();
  const folderIsBack = (path) =>
    !!path && (WS.dirByPath.has(path) || metaHasStorage(path));

  // "<trash>/<name>" -> the folder it is now, or null.
  const destinations = new Map();
  const itemOf = (path) => {
    const p = String(path || "");
    if (!p.startsWith(trashPrefix)) return "";
    const name = p.slice(trashPrefix.length).split("/")[0];
    return name ? trashPrefix + name : "";
  };
  const destinationOfItem = (item) => {
    if (destinations.has(item)) return destinations.get(item);
    let dest = null;
    if (!WS.dirByPath.has(item)) {
      const record = records.get(item);
      const original = normalizeWorkspaceRelPath(record && record.originalPath);
      const name = item.slice(trashPrefix.length);
      if (original && folderIsBack(original)) dest = original;
      else if (!original && folderIsBack(name)) dest = name;
    }
    destinations.set(item, dest);
    return dest;
  };
  // Where a path under a Trash item lives now, or "" when it has not come back.
  const restoredPathFor = (path) => {
    const p = String(path || "");
    const item = itemOf(p);
    if (!item) return "";
    const dest = destinationOfItem(item);
    return dest ? dest + p.slice(item.length) : "";
  };

  let changed = false;
  const blankNumber = (v) => !Number.isFinite(Number(v)) || (Number(v) | 0) === 0;
  const blankList = (v) => !Array.isArray(v) || !v.length;
  const blankText = (v) => !String(v || "");

  // A live store and its "folder is not in the tree" twin answer together.
  const pairedStores = [
    [meta.dirScores, meta.pendingDirScores, blankNumber],
    [meta.dirThumbPresets, meta.pendingDirThumbPresets, blankText],
    [meta.dirAppearancePresetIds, meta.pendingDirAppearancePresetIds, blankText],
  ];
  for (const [live, pending, isBlank] of pairedStores) {
    if (!(live instanceof Map)) continue;
    const stores = pending instanceof Map ? [live, pending] : [live];
    const valueAt = (path) => {
      for (const store of stores) {
        if (store.has(path) && !isBlank(store.get(path))) return store.get(path);
      }
      return null;
    };
    for (const store of stores) {
      for (const [key, value] of Array.from(store.entries())) {
        const dest = restoredPathFor(key);
        if (!dest) continue;
        if (isBlank(value)) {
          store.delete(key);
          changed = true;
          continue;
        }
        if (valueAt(dest) != null) continue; // the folder's own value wins
        const target =
          WS.dirByPath.has(dest) || !(pending instanceof Map) ? live : pending;
        target.set(dest, value);
        store.delete(key);
        changed = true;
      }
    }
  }

  // Tags: merged, never replaced.
  if (meta.dirTags instanceof Map) {
    const tagStores =
      meta.pendingTagsByPath instanceof Map
        ? [meta.dirTags, meta.pendingTagsByPath]
        : [meta.dirTags];
    for (const store of tagStores) {
      for (const [key, value] of Array.from(store.entries())) {
        const dest = restoredPathFor(key);
        if (!dest) continue;
        const tags = Array.isArray(value) ? value : [];
        const target =
          WS.dirByPath.has(dest) || tagStores.length < 2
            ? meta.dirTags
            : meta.pendingTagsByPath;
        const other = target === meta.dirTags ? tagStores[1] : meta.dirTags;
        const merged = normalizeTagList([
          ...(target.get(dest) || []),
          ...((other && other.get(dest)) || []),
          ...tags,
        ]);
        target.set(dest, merged);
        if (other && other !== target) other.delete(dest);
        store.delete(key);
        changed = true;
      }
    }
  }

  // Everything else keyed by a path: fills a blank only.
  const singleStores = [
    [meta.folderAlbumByPath, blankText],
    [meta.folderGalleriesByPath, blankList],
    [meta.folderMediaFilterByPath, blankList],
    [meta.containerSortByFolderPath, blankText],
    [meta.folderAltByPath, blankText],
    [meta.fileThumbCrop, () => false],
    [meta.videoThumbTime, () => false],
    [meta.thumbFileIdentity, blankText],
    [meta.aspectRatios, () => false],
    [meta.dirFingerprintMemory, () => false],
  ];
  for (const [store, isBlank] of singleStores) {
    if (!(store instanceof Map)) continue;
    for (const [key, value] of Array.from(store.entries())) {
      const dest = restoredPathFor(key);
      if (!dest) continue;
      if (store.has(dest) && !isBlank(store.get(dest))) continue;
      store.set(dest, value);
      store.delete(key);
      changed = true;
    }
  }
  for (const store of [meta.contentTags, meta.scoreFilterOverrides]) {
    if (!(store instanceof Map)) continue;
    for (const [key, value] of Array.from(store.entries())) {
      if (!String(key).startsWith("dir:")) continue;
      const dest = restoredPathFor(String(key).slice(4));
      if (!dest || store.has("dir:" + dest)) continue;
      store.set("dir:" + dest, value);
      store.delete(key);
      changed = true;
    }
  }

  // Picks that name a file inside a Trash item that has come back.
  for (const store of [
    meta.dirThumbPresets,
    meta.pendingDirThumbPresets,
    meta.tagThumbPresets,
  ]) {
    if (!(store instanceof Map)) continue;
    for (const [key, value] of Array.from(store.entries())) {
      const dest = restoredPathFor(value);
      if (!dest) continue;
      store.set(key, dest);
      changed = true;
    }
  }

  // A record has done its job once nothing is filed under its item any more.
  if (changed) {
    const stillFiled = new Set();
    const note = (path) => {
      const item = itemOf(path);
      if (item) stillFiled.add(item);
    };
    for (const [map] of metaFolderMetadataStores()) {
      for (const key of map.keys()) note(key);
    }
    for (const [item] of Array.from(records.entries())) {
      if (!destinationOfItem(item) || stillFiled.has(item)) continue;
      records.delete(item);
    }
    metaMarkDirty(META_DOC_IDS.trash);
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
