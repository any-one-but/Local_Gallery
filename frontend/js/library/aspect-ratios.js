/* Aspect ratios
   The aspect-ratio log, aspect/type storage and extension reconciliation. */

const ASPECT_RATIO_LOG_SCHEMA_VERSION = 1;
const ASPECT_RATIO_LOG_MTIME_TOLERANCE_MS = 1;

function normalizeAspectRatioLogEntry(relPath, value) {
  const normalizedPath = normalizeWorkspaceRelPath(relPath);
  if (!normalizedPath || !value || typeof value !== "object") return null;
  const aspect = Number(value.aspectRatio ?? value.aspect ?? value.ratio);
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const normalizedAspect = normalizePreviewAspect(aspect, 4 / 3);
  const size = Number(value.size);
  const lastModified = Number(value.lastModified ?? value.mtime ?? value.modified);
  return {
    relPath: normalizedPath,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    lastModified: Number.isFinite(lastModified) && lastModified >= 0 ? lastModified : 0,
    type: value.type === "video" ? "video" : value.type === "image" ? "image" : value.type === "markdown" ? "markdown" : "",
    aspectRatio: normalizedAspect,
    bucket: aspectRatioBucketForValue(normalizedAspect),
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim()
        ? value.updatedAt
        : new Date().toISOString(),
    schema: ASPECT_RATIO_LOG_SCHEMA_VERSION,
  };
}

function aspectRatioLogEntryForRecord(rec, aspect) {
  if (!rec) return null;
  const relPath = normalizeWorkspaceRelPath(rec.relPath);
  const n = Number(aspect);
  if (!relPath || !Number.isFinite(n) || n <= 0) return null;
  const normalizedAspect = normalizePreviewAspect(n, 4 / 3);
  return {
    relPath,
    size: Number.isFinite(Number(rec.size)) && Number(rec.size) >= 0 ? Number(rec.size) : 0,
    lastModified:
      Number.isFinite(Number(rec.lastModified)) && Number(rec.lastModified) >= 0
        ? Number(rec.lastModified)
        : 0,
    type: rec.type === "video" ? "video" : rec.type === "image" ? "image" : rec.type === "markdown" ? "markdown" : "",
    aspectRatio: normalizedAspect,
    bucket: aspectRatioBucketForValue(normalizedAspect),
    updatedAt: new Date().toISOString(),
    schema: ASPECT_RATIO_LOG_SCHEMA_VERSION,
  };
}

function aspectRatioLogEntryMatchesRecord(entry, rec) {
  if (!entry || !rec) return false;
  const relPath = normalizeWorkspaceRelPath(rec.relPath);
  if (!relPath || normalizeWorkspaceRelPath(entry.relPath) !== relPath) return false;
  const entrySize = Number(entry.size);
  const recSize = Number(rec.size);
  if (Number.isFinite(entrySize) && Number.isFinite(recSize) && entrySize !== recSize)
    return false;
  const entryModified = Number(entry.lastModified);
  const recModified = Number(rec.lastModified);
  if (
    Number.isFinite(entryModified) &&
    Number.isFinite(recModified) &&
    Math.abs(entryModified - recModified) > ASPECT_RATIO_LOG_MTIME_TOLERANCE_MS
  ) {
    return false;
  }
  const entryType = String(entry.type || "");
  if (entryType && rec.type && entryType !== rec.type) return false;
  return Number(entry.aspectRatio) > 0;
}

function getCachedAspectRatioForRecord(rec) {
  if (!aspectRatioMetadataEnabled()) return 0;
  if (!WS.meta || !WS.meta.aspectRatios || !rec) return 0;
  const relPath = normalizeWorkspaceRelPath(rec.relPath);
  if (!relPath) return 0;
  const entry = normalizeAspectRatioLogEntry(
    relPath,
    WS.meta.aspectRatios.get(relPath),
  );
  if (!aspectRatioLogEntryMatchesRecord(entry, rec)) return 0;
  return Number(entry.aspectRatio) || 0;
}

function setCachedAspectRatioForRecord(rec, aspect) {
  if (!aspectRatioMetadataEnabled()) return false;
  if (!WS.meta) return false;
  if (!WS.meta.aspectRatios) WS.meta.aspectRatios = new Map();
  const relPath = normalizeWorkspaceRelPath(rec && rec.relPath);
  const next = aspectRatioLogEntryForRecord(rec, aspect);
  if (!relPath || !next) return false;
  const prev = normalizeAspectRatioLogEntry(relPath, WS.meta.aspectRatios.get(relPath));
  if (
    prev &&
    prev.size === next.size &&
    Math.abs(Number(prev.lastModified) - Number(next.lastModified)) <= ASPECT_RATIO_LOG_MTIME_TOLERANCE_MS &&
    prev.type === next.type &&
    Math.abs(Number(prev.aspectRatio) - Number(next.aspectRatio)) <= 0.0001 &&
    prev.bucket === next.bucket
  ) {
    return false;
  }
  WS.meta.aspectRatios.set(relPath, next);
  return true;
}

const ASPECT_RATIO_SQUARE_TOLERANCE = 0.05;

function normalizeAspectRatioFilterMode(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "portrait" || raw === "square" || raw === "landscape")
    return raw;
  return "all";
}

function labelForAspectRatioFilterMode(value) {
  const mode = normalizeAspectRatioFilterMode(value);
  if (mode === "portrait") return "Portrait";
  if (mode === "square") return "Square";
  if (mode === "landscape") return "Landscape";
  return "All";
}

function getKnownRecordAspectRatio(rec) {
  if (!rec) return 0;
  const candidates = [
    rec.previewAspect,
    rec.aspectRatio,
    rec.thumbAspect,
    rec.videoAspect,
    rec.aspect,
  ];
  for (let i = 0; i < candidates.length; i++) {
    const n = Number(candidates[i]);
    if (Number.isFinite(n) && n > 0) return normalizePreviewAspect(n, 4 / 3);
  }
  return 0;
}

function aspectRatioBucketForValue(aspect) {
  const n = Number(aspect);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (Math.abs(n - 1) <= ASPECT_RATIO_SQUARE_TOLERANCE) return "square";
  return n < 1 ? "portrait" : "landscape";
}

function setRecordAspectRatio(rec, aspect) {
  if (!rec) return false;
  const n = Number(aspect);
  if (!Number.isFinite(n) || n <= 0) return false;
  const normalized = normalizePreviewAspect(n, 4 / 3);
  const bucket = aspectRatioBucketForValue(normalized);
  const prevAspect = Number(rec.aspectRatio);
  const prevBucket = String(rec.aspectRatioBucket || "");
  rec.aspectRatio = normalized;
  rec.previewAspect = normalized;
  rec.aspectRatioBucket = bucket;
  return (
    !Number.isFinite(prevAspect) ||
    Math.abs(prevAspect - normalized) > 0.0001 ||
    prevBucket !== bucket
  );
}

function recordPassesAspectRatioFilter(rec) {
  // Aspect-ratio filtering removed; every record always passes.
  return true;
}

function recordIsGloballyStoredByAspectRatio(rec, options = null) {
  if (!rec || !anyAspectRatioStorageEnabled(options)) return false;
  const bucket = String(
    rec.aspectRatioBucket || aspectRatioBucketForValue(getKnownRecordAspectRatio(rec)) || "",
  );
  return !!bucket && aspectRatioStorageEnabledForBucket(bucket, options);
}

function recordIsGloballyStoredByMediaType(rec, options = null) {
  if (!rec || !anyMediaTypeStorageEnabled(options)) return false;
  const type = normalizeMediaTypeStorageType(recordMediaFilterType(rec));
  return !!type && mediaTypeStorageEnabledForType(type, options);
}

function removeFileRecordFromWorkspace(rec) {
  if (!rec || !WS.fileById) return false;
  const id = String(rec.id || "");
  if (!id || !WS.fileById.has(id)) return false;
  const dirPath = String(rec.dirPath || "");
  const dirNode = WS.dirByPath && WS.dirByPath.get(dirPath);
  if (dirNode && Array.isArray(dirNode.childrenFiles)) {
    dirNode.childrenFiles = dirNode.childrenFiles.filter(
      (fileId) => String(fileId || "") !== id,
    );
  }
  revokeRecordObjectURLs(rec);
  WS.fileById.delete(id);
  invalidateDirectoryDerivedIndex();
  return true;
}

function applyAspectRatioStorageToCurrentWorkspace() {
  if (!WS.root || !WS.fileById || !WS.fileById.size) return 0;
  const options = WS.meta && WS.meta.options ? WS.meta.options : null;
  if (!anyAspectRatioStorageEnabled(options) && !anyMediaTypeStorageEnabled(options)) return 0;
  let removed = 0;
  const records = Array.from(WS.fileById.values()).filter(Boolean);
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (
      !recordIsGloballyStoredByAspectRatio(rec, options) &&
      !recordIsGloballyStoredByMediaType(rec, options)
    )
      continue;
    if (removeFileRecordFromWorkspace(rec)) removed++;
  }
  if (removed) {
    rebuildDirectoryDerivedIndex();
    invalidateDirMetricsCaches();
    if (WS.view) {
      WS.view.randomFolderCache = new Map();
      for (const node of WS.dirByPath.values()) {
        applySessionFileOrderForDir(node);
      }
    }
  }
  return removed;
}

// Extension-agnostic key for a file's relPath: directory + basename without
// its extension, lowercased for case-insensitive filesystems. Used to keep
// per-file metadata attached when a file is re-encoded to a different format
// (e.g. clean.sh turning foo.webm into foo.mp4, or foo.png into foo.avif),
// which changes the extension and therefore the relPath the metadata was
// keyed under.
function relPathExtensionAgnosticStem(relPath) {
  const key = normalizeWorkspaceRelPath(relPath);
  if (!key) return "";
  const slash = key.lastIndexOf("/");
  const dir = slash >= 0 ? key.slice(0, slash + 1) : "";
  const base = slash >= 0 ? key.slice(slash + 1) : key;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return (dir + stem).toLowerCase();
}

// Re-attach orphaned per-file metadata to files whose extension changed since
// the metadata was written (e.g. clean.sh re-encoding foo.png -> foo.avif).
// Two shapes of metadata reference a file relPath and break on a rename:
//   * relPath-KEYED stores  - fileThumbCrop, videoThumbTime, aspectRatios
//   * relPath-VALUED stores  - dirThumbPresets / pendingDirThumbPresets and
//     tagThumbPresets, where a folder or tag pins a specific file as its
//     thumbnail. (Folder presets may also hold none/rotate sentinels, which
//     are not relPaths and are left untouched.)
// A reference is orphaned when no current file lives at its exact relPath; we
// retarget it onto the current file sharing the same extension-agnostic stem,
// but only when that match is unambiguous: exactly one current file with the
// stem, exactly one orphan claiming it, and (for keyed stores) no existing
// metadata on the target to clobber. Runs once per workspace load and bails
// before indexing files when nothing is orphaned.
function reconcileFileMetadataExtensions() {
  if (!WS || !WS.meta) return;
  const meta = WS.meta;

  const keyMaps = [
    { map: meta.fileThumbCrop, doc: META_DOC_IDS.thumbnails },
    { map: meta.videoThumbTime, doc: META_DOC_IDS.thumbnails },
    { map: meta.aspectRatios, doc: META_DOC_IDS.aspectRatios },
  ].filter((entry) => entry.map instanceof Map && entry.map.size);
  const valueMaps = [
    { map: meta.dirThumbPresets, doc: META_DOC_IDS.thumbnails },
    { map: meta.pendingDirThumbPresets, doc: META_DOC_IDS.thumbnails },
    { map: meta.tagThumbPresets, doc: META_DOC_IDS.thumbnails },
  ].filter((entry) => entry.map instanceof Map && entry.map.size);
  if (!keyMaps.length && !valueMaps.length) return;

  const isPresetSentinel = (raw) =>
    raw === FOLDER_THUMB_NONE_SENTINEL || raw === FOLDER_THUMB_ROTATE_SENTINEL;

  // Authoritative set of files that currently exist, from every index that may
  // be populated (loaded records and the deferred catalog location index).
  const currentRelPaths = new Set();
  const addRel = (rp) => {
    const key = normalizeWorkspaceRelPath(rp);
    if (key) currentRelPaths.add(key);
  };
  if (WS.fileById instanceof Map) {
    for (const rec of WS.fileById.values()) if (rec) addRel(rec.relPath);
  }
  if (WS.catalog && WS.catalog.fileLocationsByRelPath instanceof Map) {
    for (const rp of WS.catalog.fileLocationsByRelPath.keys()) addRel(rp);
  }
  if (!currentRelPaths.size) return;

  // Collect every orphaned relPath referenced by any store: keys of the keyed
  // stores, values of the valued stores (excluding sentinels).
  const orphanRelPaths = new Set();
  for (const { map } of keyMaps) {
    for (const key of map.keys()) {
      const norm = normalizeWorkspaceRelPath(key);
      if (norm && !currentRelPaths.has(norm)) orphanRelPaths.add(norm);
    }
  }
  for (const { map } of valueMaps) {
    for (const value of map.values()) {
      const raw = String(value || "");
      if (isPresetSentinel(raw)) continue;
      const norm = normalizeWorkspaceRelPath(raw);
      if (norm && !currentRelPaths.has(norm)) orphanRelPaths.add(norm);
    }
  }
  if (!orphanRelPaths.size) return;

  // Index current files by extension-agnostic stem. Stems shared by more than
  // one current file are ambiguous and excluded so metadata never lands on the
  // wrong file.
  const stemToRel = new Map();
  const ambiguousStems = new Set();
  for (const rp of currentRelPaths) {
    const stem = relPathExtensionAgnosticStem(rp);
    if (!stem) continue;
    if (stemToRel.has(stem)) {
      ambiguousStems.add(stem);
      continue;
    }
    stemToRel.set(stem, rp);
  }

  // Resolve each orphan to a unique current file via its stem, rejecting any
  // target claimed by more than one orphan.
  const targetClaims = new Map();
  for (const orphan of orphanRelPaths) {
    const stem = relPathExtensionAgnosticStem(orphan);
    if (!stem || ambiguousStems.has(stem)) continue;
    const target = stemToRel.get(stem);
    if (!target) continue;
    if (!targetClaims.has(target)) targetClaims.set(target, []);
    targetClaims.get(target).push(orphan);
  }
  const renameMap = new Map();
  for (const [target, claims] of targetClaims.entries()) {
    if (claims.length === 1) renameMap.set(claims[0], target);
  }
  if (!renameMap.size) return;

  const dirtyDocs = new Set();

  // Re-key the relPath-keyed stores (never clobber existing target metadata).
  for (const { map, doc } of keyMaps) {
    const moves = [];
    for (const key of map.keys()) {
      const target = renameMap.get(normalizeWorkspaceRelPath(key));
      if (!target || map.has(target)) continue;
      moves.push([key, target]);
    }
    for (const [oldKey, target] of moves) {
      map.set(target, map.get(oldKey));
      map.delete(oldKey);
      dirtyDocs.add(doc);
    }
  }

  // Retarget the relPath-valued stores (folder and tag thumbnail pins).
  for (const { map, doc } of valueMaps) {
    for (const [storeKey, value] of map.entries()) {
      const raw = String(value || "");
      if (isPresetSentinel(raw)) continue;
      const target = renameMap.get(normalizeWorkspaceRelPath(raw));
      if (!target) continue;
      map.set(storeKey, target);
      dirtyDocs.add(doc);
    }
  }

  for (const doc of dirtyDocs) metaMarkDirty(doc);
}

async function finalizeAspectRatiosAndStorageForLoadedWorkspace(opts = null) {
  reconcileFileMetadataExtensions();
  if (!aspectRatioMetadataEnabled()) return 0;
  const optionsArg = opts && typeof opts === "object" ? opts : {};
  const options = WS.meta && WS.meta.options ? WS.meta.options : null;
  const showOverlay = !!optionsArg.showOverlay;
  const aspectLabel = optionsArg.aspectLabel
    ? String(optionsArg.aspectLabel)
    : "Checking media aspect ratios...";
  const storageLabel = optionsArg.storageLabel
    ? String(optionsArg.storageLabel)
    : "Applying media filters...";
  const progressState = { lastUpdate: 0 };
  const recordsTotal = WS.fileById ? WS.fileById.size : 0;
  let removed = 0;

  try {
    if (aspectRatioHydrationRequiresBlocking(options)) {
      if (showOverlay)
        showBlockingLoaderOverlay(
          aspectLabel,
          formatBusyProgressDetail(`Checked 0/${recordsTotal} media files`, ""),
        );
      try {
        await hydrateAllRecordAspectRatios({
          maxConcurrency: optionsArg.maxConcurrency,
          onProgress: ({ completed, total, record }) => {
            if (!showOverlay) return;
            updateBusyProgress(
              aspectLabel,
              `Checked ${completed}/${total} media files`,
              record ? record.relPath || record.name || "" : "",
              completed >= total,
              progressState,
            );
          },
        });
      } catch {}
    } else {
      if (showOverlay)
        showBlockingLoaderOverlay(
          aspectLabel,
          formatBusyProgressDetail("Applying cached aspect ratios", ""),
        );
      try {
        hydrateCachedRecordAspectRatiosForLoadedWorkspace();
      } catch {}
      scheduleBackgroundAspectRatioHydration();
    }

    if (showOverlay)
      updateBlockingLoaderOverlay(
        storageLabel,
        formatBusyProgressDetail("Checking media type and aspect-ratio storage rules", ""),
      );
    removed = applyAspectRatioStorageToCurrentWorkspace();
    if (showOverlay)
      updateBlockingLoaderOverlay(
        storageLabel,
        formatBusyProgressDetail(
          removed ? `Moved ${removed} stored media records out of view` : "No stored media records hidden",
          "",
        ),
      );
    return removed;
  } finally {
    if (showOverlay) hideBlockingLoaderOverlay();
  }
}

function recordMediaFilterType(rec) {
  if (!rec) return "";
  if (rec.type === "video") return "videos";
  if (rec.type === "image") return "images";
  if (rec.type === "markdown") return "text";
  return "";
}
