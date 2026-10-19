/* Saving metadata
   Trash restore records, dirty tracking and writing documents to disk. */

function metaGetTrashRestoreInfo(trashPath) {
  const normalized = normalizeWorkspaceRelPath(trashPath);
  return normalized ? WS.meta.trashItemsByPath.get(normalized) || null : null;
}

function metaSetTrashRestoreInfo(trashPath, originalPath, trashedAt = null) {
  const normalizedTrashPath = normalizeWorkspaceRelPath(trashPath);
  const normalizedOriginalPath = normalizeWorkspaceRelPath(originalPath);
  if (
    !normalizedTrashPath ||
    !normalizedOriginalPath ||
    !isPathInsideInternalTrash(normalizedTrashPath) ||
    isPathInsideInternalTrash(normalizedOriginalPath)
  ) {
    return false;
  }
  const next = {
    originalPath: normalizedOriginalPath,
    trashedAt:
      typeof trashedAt === "string" && trashedAt.trim()
        ? trashedAt
        : new Date().toISOString(),
  };
  const prev = WS.meta.trashItemsByPath.get(normalizedTrashPath) || null;
  if (
    prev &&
    prev.originalPath === next.originalPath &&
    prev.trashedAt === next.trashedAt
  ) {
    return false;
  }
  WS.meta.trashItemsByPath.set(normalizedTrashPath, next);
  metaMarkDirty(META_DOC_IDS.trash);
  return true;
}

function metaDeleteTrashRestoreInfo(trashPath) {
  const normalized = normalizeWorkspaceRelPath(trashPath);
  if (!normalized || !WS.meta.trashItemsByPath.has(normalized)) return false;
  WS.meta.trashItemsByPath.delete(normalized);
  metaMarkDirty(META_DOC_IDS.trash);
  return true;
}

function metaFinalizeLoadedState() {
  LIBRARY_SETTINGS_LOADED = true;
  syncActiveAppearancePresetSelection(WS.meta.options);
  WS.view.appearancePresetEditingId =
    effectiveActiveAppearancePresetId() || BUILTIN_NULL_APPEARANCE_PRESET_ID;
  WS.view.appearancePresetDraftName = "";
  WS.view.appearancePresetPromptMode = "";
  applyDefaultViewFromOptions();
  applyLoadedOptionsToDocument();
}

function metaNormalizeDocIdsToSave(docIds = null) {
  const requested = Array.isArray(docIds)
    ? docIds.slice()
    : Array.from(docIds || []);
  const unique = [];
  const seen = new Set();
  const push = (docId) => {
    const id = String(docId || "");
    if (!id || seen.has(id) || !META_ALL_DOC_IDS.includes(id)) return;
    if (!metadataDocEnabled(id)) return;
    seen.add(id);
    unique.push(id);
  };
  for (let i = 0; i < requested.length; i++) push(requested[i]);
  if (unique.length) return unique;
  if (WS.meta && WS.meta.dirtyDocIds && WS.meta.dirtyDocIds.size) {
    for (const docId of WS.meta.dirtyDocIds) push(docId);
  }
  if (!unique.length && WS.meta && WS.meta.dirty) {
    for (let i = 0; i < META_ALL_DOC_IDS.length; i++) push(META_ALL_DOC_IDS[i]);
  }
  return unique;
}

function metaTrackDirtyDocIds(docIds = null) {
  if (!WS.meta) return;
  const list = Array.isArray(docIds)
    ? docIds.slice()
    : Array.from(docIds || []);
  const targetIds = list.length ? list : META_ALL_DOC_IDS.slice();
  if (!(WS.meta.dirtyDocIds instanceof Set)) WS.meta.dirtyDocIds = new Set();
  for (let i = 0; i < targetIds.length; i++) {
    const docId = String(targetIds[i] || "");
    if (!META_ALL_DOC_IDS.includes(docId)) continue;
    if (!metadataDocEnabled(docId)) continue;
    WS.meta.dirtyDocIds.add(docId);
  }
  WS.meta.dirty = !!WS.meta.dirtyDocIds.size;
  scheduleSettingsMetadataBroadcast(targetIds);
}

function metaMarkDirty(...docIds) {
  metaTrackDirtyDocIds(docIds);
  metaScheduleSave();
}

function metaClearSavedDocIds(docIds = null) {
  if (!WS.meta) return;
  const list = metaNormalizeDocIdsToSave(docIds);
  if (!(WS.meta.dirtyDocIds instanceof Set)) WS.meta.dirtyDocIds = new Set();
  for (let i = 0; i < list.length; i++) WS.meta.dirtyDocIds.delete(list[i]);
  WS.meta.dirty = !!WS.meta.dirtyDocIds.size;
}

function metaParseText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function metaLocalKeysForStorageKey(storageKey) {
  const k = String(storageKey || "");
  if (!k) return null;
  const docs = {};
  for (let i = 0; i < META_ALL_DOC_IDS.length; i++) {
    const docId = META_ALL_DOC_IDS[i];
    const prefix = META_LOCAL_KEY_PREFIXES[docId];
    if (!prefix) continue;
    docs[docId] = `${prefix}::${k}`;
  }
  return {
    docs,
    legacy: {
      scores: `LocalGalleryScores::${k}`,
      tags: `LocalGalleryTags::${k}`,
      options: `LocalGalleryPreferences::${k}`,
      keybinds: `LocalGalleryKeyboard::${k}`,
      combined: `LocalGalleryVotes::${k}`,
    },
  };
}

function metaLocalKeys() {
  return metaLocalKeysForStorageKey(WS.meta.storageKey || "");
}

function metaLoadLocalDoc(key) {
  if (!key) return null;
  try {
    const txt = localStorage.getItem(key);
    return metaParseText(txt);
  } catch {
    return null;
  }
}

function metaSaveLocalDoc(key, obj) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {}
}

function metaClearLegacyLocalDocs(keys) {
  const legacy = keys && keys.legacy;
  if (!legacy) return;
  const doomed = [legacy.combined, legacy.scores, legacy.tags, legacy.options];
  for (let i = 0; i < doomed.length; i++) {
    const key = doomed[i];
    if (!key) continue;
    try {
      localStorage.removeItem(key);
    } catch {}
  }
}

function metaSaveLocalNow(docIds = null) {
  const keys = metaLocalKeys();
  if (!keys) return;
  const ids = metaNormalizeDocIdsToSave(docIds);
  for (let i = 0; i < ids.length; i++) {
    const docId = ids[i];
    const key = keys.docs && keys.docs[docId];
    const obj = metaDocObjectForId(docId);
    if (!key || !obj) continue;
    metaSaveLocalDoc(key, obj);
  }
  metaClearSavedDocIds(ids);
}

function normalizeWorkspaceRelPath(path) {
  const raw = String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!raw) return "";
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return "";
  return parts.join("/");
}

async function metaEnsureFsHandles(rootHandle) {
  if (!rootHandle) return false;
  try {
    // Use separate metadata dir handle when available (new single-folder model).
    // Falls back to old .local-gallery subdir of media root.
    let sys;
    if (window.__lg && typeof window.__lg.getAppMetaDirectoryHandle === "function") {
      try {
        sys = await window.__lg.getAppMetaDirectoryHandle();
      } catch (e) {}
    }
    if (!sys) {
      sys = await rootHandle.getDirectoryHandle(".local-gallery", { create: true });
    }
    const docHandles = Object.create(null);
    for (let i = 0; i < META_ALL_DOC_IDS.length; i++) {
      const docId = META_ALL_DOC_IDS[i];
      const fileName = META_DOC_FILE_NAMES[docId];
      if (!fileName) continue;
      docHandles[docId] = await sys.getFileHandle(fileName, { create: true });
    }
    const legacyHandles = {
      scores: await sys.getFileHandle("folder-scores.log.json", {
        create: true,
      }),
      tags: await sys.getFileHandle("folder-tags.log.json", { create: true }),
      options: await sys.getFileHandle("preferences.log.json", {
        create: true,
      }),
      keybinds:
        docHandles[META_DOC_IDS.keybinds] ||
        (await sys.getFileHandle("keyboard-configuration.log.json", {
          create: true,
        })),
      combined: await sys.getFileHandle("folder-votes.log.json", {
        create: true,
      }),
    };
    WS.meta.fsRootHandle = rootHandle;
    WS.meta.fsSysDirHandle = sys;
    WS.meta.fsDocHandles = docHandles;
    WS.meta.fsLegacyDocHandles = legacyHandles;
    WS.meta.storageMode = "fs";
    return true;
  } catch {
    return false;
  }
}

async function metaLoadFsDoc(fh) {
  if (!fh) return null;
  try {
    const f = await fh.getFile();
    const txt = await f.text();
    return metaParseText(txt);
  } catch {
    return null;
  }
}

async function metaSaveFsDoc(fh, obj) {
  if (!fh) return;
  const txt = JSON.stringify(obj);
  try {
    const writable = await fh.createWritable();
    await writable.write(txt);
    await writable.close();
  } catch {}
}

async function metaClearFsDoc(fh) {
  if (!fh) return;
  try {
    const writable = await fh.createWritable();
    await writable.write("");
    await writable.close();
  } catch {}
}

async function metaClearLegacyFsDocs(handles) {
  if (!handles || typeof handles !== "object") return;
  const doomed = [
    handles.combined,
    handles.scores,
    handles.tags,
    handles.options,
  ];
  for (let i = 0; i < doomed.length; i++) {
    await metaClearFsDoc(doomed[i]);
  }
}

function metaFsHandleForDocId(docId) {
  const handles = WS.meta && WS.meta.fsDocHandles;
  if (!handles || typeof handles !== "object") return null;
  return handles[String(docId || "")] || null;
}

async function metaSaveFsNow(docIds = null) {
  const ids = metaNormalizeDocIdsToSave(docIds);
  for (let i = 0; i < ids.length; i++) {
    const docId = ids[i];
    const fh = metaFsHandleForDocId(docId);
    const obj = metaDocObjectForId(docId);
    if (!fh || !obj) continue;
    await metaSaveFsDoc(fh, obj);
  }
  metaClearSavedDocIds(ids);
}

function metaScheduleSave(...docIds) {
  if (docIds.length) metaTrackDirtyDocIds(docIds);
  if (WS.meta.saveTimer) return;
  WS.meta.saveTimer = setTimeout(async () => {
    WS.meta.saveTimer = null;
    const ids = metaNormalizeDocIdsToSave();
    if (!ids.length) return;
    if (WS.meta.storageMode === "fs") await metaSaveFsNow(ids);
    else metaSaveLocalNow(ids);
  }, 500);
}

async function flushPendingMetadataSaveNow(docIds = null) {
  if (!WS.meta) return;
  if (WS.meta.saveTimer) {
    clearTimeout(WS.meta.saveTimer);
    WS.meta.saveTimer = null;
  }
  const ids = metaNormalizeDocIdsToSave(docIds);
  if (!ids.length) return;
  if (WS.meta.storageMode === "fs") await metaSaveFsNow(ids);
  else metaSaveLocalNow(ids);
}
