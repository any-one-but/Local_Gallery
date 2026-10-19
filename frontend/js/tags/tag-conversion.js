/* Tag conversion
   The one-time conversion of tags, albums and galleries into Tags. */

const TAG_CONVERSION_BACKUP_FILE_NAMES = Object.freeze({
  tags: "tags.before-tag-conversion.log.json",
  tagAlbums: "tag-albums.before-tag-conversion.log.json",
});

function tagConvNormPath(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function tagConvParentPath(path) {
  const p = tagConvNormPath(path);
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

function tagConvLastSegment(path) {
  const p = tagConvNormPath(path);
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function tagConvParseScopedKey(rawKey) {
  const key = String(rawKey || "");
  if (!key.startsWith("scope:")) return { name: normalizeTag(key), scope: null };
  const body = key.slice("scope:".length);
  const sep = body.indexOf(":");
  if (sep < 0) return null;
  try {
    return {
      scope: tagConvNormPath(decodeURIComponent(body.slice(0, sep))),
      name: normalizeTag(decodeURIComponent(body.slice(sep + 1))),
    };
  } catch {
    return null;
  }
}

function tagConvParseStateKey(rawKey) {
  const key = String(rawKey || "");
  const scoped = (prefix, kind) => {
    const body = key.slice(prefix.length);
    const sep = body.indexOf(":");
    if (sep <= 0) return null;
    try {
      const name = normalizeTag(decodeURIComponent(body.slice(0, sep)));
      const scopeRaw = decodeURIComponent(body.slice(sep + 1));
      return {
        kind,
        name,
        scope: scopeRaw === "__root__" ? "" : tagConvNormPath(scopeRaw),
      };
    } catch {
      return null;
    }
  };
  if (key.startsWith("tag-scope:")) return scoped("tag-scope:", "tag");
  if (key.startsWith("tag-album-scope:")) return scoped("tag-album-scope:", "album");
  if (key.startsWith("tag-gallery:"))
    return { kind: "gallery", name: normalizeTag(key.slice(12)), scope: "" };
  if (key.startsWith("tag-album:"))
    return { kind: "album", name: normalizeTag(key.slice(10)), scope: null };
  if (key.startsWith("tag:"))
    return { kind: "tag", name: normalizeTag(key.slice(4)), scope: null };
  return null;
}

function tagConvOriginScope(scope, trashItems) {
  const s = tagConvNormPath(scope);
  const root = INTERNAL_TRASH_DIR_NAME;
  if (s !== root && !s.startsWith(`${root}/`)) return s;
  if (s === root) return "";
  const parts = s.split("/");
  const top = parts.slice(0, 2).join("/");
  const rest = parts.slice(2).join("/");
  const original = trashItems.get(top);
  const base = original != null ? original : parts[1] || "";
  return tagConvNormPath(rest ? `${base}/${rest}` : base);
}

// "Folder - Tag": the folder a tag or album lived in, then its own name.
function tagConvPlainBaseName(name, scope) {
  return scope ? `${normalizeTag(tagConvLastSegment(scope))} - ${name}` : name;
}

function tagConvBaseName(name, scope) {
  const plain = tagConvPlainBaseName(name, scope);
  return isInternalTagName(plain) ? `${plain} (tag)` : plain;
}

const LEGACY_TAG_ALBUM_DOC_MAP_KEYS = Object.freeze([
  "tagAlbumByTag",
  "folderAlbumByPath",
  "albumTagsByAlbum",
  "folderGalleriesByPath",
  "galleryMemberTagsByGallery",
  "galleryMemberAlbumsByGallery",
  "galleryUserTagsByGallery",
  "galleryAlbumByGallery",
]);

function legacyTagMetadataNeedsConversion(tagsDoc, tagAlbumsDoc) {
  const t = metadataIsPlainObject(tagsDoc) ? tagsDoc : null;
  const a = metadataIsPlainObject(tagAlbumsDoc) ? tagAlbumsDoc : null;
  if (
    a &&
    !a.convertedToTags &&
    LEGACY_TAG_ALBUM_DOC_MAP_KEYS.some(
      (k) => metadataIsPlainObject(a[k]) && Object.keys(a[k]).length,
    )
  )
    return true;
  return !!(
    t &&
    (Number(t.schema) || 0) < TAGS_SCHEMA_VERSION &&
    metadataIsPlainObject(t.folders) &&
    Object.keys(t.folders).length
  );
}

function convertLegacyTagMetadata(input) {
  const docs = metadataIsPlainObject(input) ? input : {};
  const tags = metadataIsPlainObject(docs.tags) ? docs.tags : {};
  const albums = metadataIsPlainObject(docs.tagAlbums) ? docs.tagAlbums : {};
  const trash = metadataIsPlainObject(docs.trash) ? docs.trash : {};
  const report = {
    renamed: [],
    collisions: [],
    reservedRenames: [],
    droppedCycles: [],
    counts: {},
  };
  if (!legacyTagMetadataNeedsConversion(tags, albums)) {
    report.skipped = true;
    return { tags, tagAlbums: albums, report };
  }
  const isObj = metadataIsPlainObject;
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  const trashItems = new Map();
  const itemsByTrashPath = isObj(trash.itemsByTrashPath) ? trash.itemsByTrashPath : {};
  for (const trashPath of Object.keys(itemsByTrashPath)) {
    const item = itemsByTrashPath[trashPath];
    if (isObj(item) && item.originalPath)
      trashItems.set(tagConvNormPath(trashPath), tagConvNormPath(item.originalPath));
  }

  const containers = new Map();
  const identity = (kind, name, scope) =>
    `${kind}\n${scope == null ? "*" : scope}\n${name}`;
  const addContainer = (kind, name, scope, exclusive = false) => {
    if (!name) return null;
    const id = identity(kind, name, scope);
    if (!containers.has(id)) containers.set(id, { kind, name, scope, exclusive, id });
    return containers.get(id);
  };

  const folders = isObj(tags.folders) ? tags.folders : {};
  const folderUserTags = new Map();
  const folderReserved = new Map();
  for (const rawPath of Object.keys(folders)) {
    const path = tagConvNormPath(rawPath);
    const entry = folders[rawPath];
    const list = isObj(entry) && Array.isArray(entry.tags) ? entry.tags : [];
    const user = [];
    const reserved = [];
    for (const raw of list) {
      const t = normalizeTag(raw);
      if (!t || t === LEGACY_PROCESSING_DISABLED_TAG) continue;
      if (isReservedFolderTag(t)) reserved.push(t);
      else user.push(t);
    }
    if (user.length) folderUserTags.set(path, Array.from(new Set(user)));
    if (reserved.length) folderReserved.set(path, Array.from(new Set(reserved)));
    const scope = tagConvParentPath(tagConvOriginScope(path, trashItems));
    for (const t of user) addContainer("tag", t, scope);
  }

  const mapOf = (key) => (isObj(albums[key]) ? albums[key] : {});
  const tagAlbumByTag = mapOf("tagAlbumByTag");
  const folderAlbumByPath = mapOf("folderAlbumByPath");
  const albumTagsByAlbum = mapOf("albumTagsByAlbum");
  const folderGalleriesByPath = mapOf("folderGalleriesByPath");
  const galleryMemberTags = mapOf("galleryMemberTagsByGallery");
  const galleryMemberAlbums = mapOf("galleryMemberAlbumsByGallery");
  const galleryUserTags = mapOf("galleryUserTagsByGallery");
  const galleryAlbum = mapOf("galleryAlbumByGallery");

  const folderAlbums = new Map();
  for (const rawPath of Object.keys(folderAlbumByPath)) {
    const path = tagConvNormPath(rawPath);
    const album = normalizeTag(folderAlbumByPath[rawPath]);
    if (!path || !album) continue;
    const scope = tagConvParentPath(tagConvOriginScope(path, trashItems));
    folderAlbums.set(path, addContainer("album", album, scope, true));
  }

  const links = [];
  const tagScopesByName = new Map();
  for (const c of containers.values()) {
    if (c.kind !== "tag") continue;
    if (!tagScopesByName.has(c.name)) tagScopesByName.set(c.name, new Set());
    tagScopesByName.get(c.name).add(c.scope);
  }
  for (const rawKey of Object.keys(tagAlbumByTag)) {
    const parsed = tagConvParseScopedKey(rawKey);
    const album = normalizeTag(tagAlbumByTag[rawKey]);
    if (!parsed || !parsed.name || !album || album === parsed.name) continue;
    const scopes =
      parsed.scope == null
        ? Array.from(tagScopesByName.get(parsed.name) || [])
        : [tagConvOriginScope(parsed.scope, trashItems)];
    for (const scope of scopes) {
      if (
        parsed.scope == null &&
        own(
          tagAlbumByTag,
          `scope:${encodeURIComponent(scope)}:${encodeURIComponent(parsed.name)}`,
        )
      )
        continue;
      links.push({
        child: addContainer("tag", parsed.name, scope),
        parent: addContainer("album", album, scope, true),
      });
    }
  }
  for (const rawKey of Object.keys(albumTagsByAlbum)) {
    const parsed = tagConvParseScopedKey(rawKey);
    if (!parsed || !parsed.name) continue;
    const scope = parsed.scope == null ? "" : tagConvOriginScope(parsed.scope, trashItems);
    const album = addContainer("album", parsed.name, scope, true);
    const list = Array.isArray(albumTagsByAlbum[rawKey]) ? albumTagsByAlbum[rawKey] : [];
    for (const raw of list) {
      const t = normalizeTag(raw);
      if (!t || isReservedFolderTag(t) || t === parsed.name) continue;
      links.push({ child: album, parent: addContainer("tag", t, scope) });
    }
  }

  const folderGalleries = new Map();
  for (const rawPath of Object.keys(folderGalleriesByPath)) {
    const path = tagConvNormPath(rawPath);
    const list = Array.isArray(folderGalleriesByPath[rawPath])
      ? folderGalleriesByPath[rawPath]
      : [];
    const out = [];
    for (const raw of list) {
      const g = normalizeTag(raw);
      if (g) out.push(addContainer("gallery", g, ""));
    }
    if (path && out.length) folderGalleries.set(path, out);
  }
  const memberTarget = (raw, key) => {
    const name = normalizeTag(isObj(raw) ? raw[key] : raw);
    const originPath = tagConvNormPath(isObj(raw) ? raw.originPath : "");
    return name ? { name, scope: tagConvOriginScope(originPath, trashItems) } : null;
  };
  const listOf = (map, key) => (Array.isArray(map[key]) ? map[key] : []);
  for (const rawGallery of Object.keys(galleryMemberTags)) {
    const gallery = addContainer("gallery", normalizeTag(rawGallery), "");
    for (const raw of listOf(galleryMemberTags, rawGallery)) {
      const t = memberTarget(raw, "tag");
      if (gallery && t && !isReservedFolderTag(t.name))
        links.push({ child: addContainer("tag", t.name, t.scope), parent: gallery });
    }
  }
  for (const rawGallery of Object.keys(galleryMemberAlbums)) {
    const gallery = addContainer("gallery", normalizeTag(rawGallery), "");
    for (const raw of listOf(galleryMemberAlbums, rawGallery)) {
      const a = memberTarget(raw, "album");
      if (gallery && a)
        links.push({ child: addContainer("album", a.name, a.scope, true), parent: gallery });
    }
  }
  for (const rawGallery of Object.keys(galleryUserTags)) {
    const gallery = addContainer("gallery", normalizeTag(rawGallery), "");
    for (const raw of listOf(galleryUserTags, rawGallery)) {
      const t = normalizeTag(raw);
      if (gallery && t && !isReservedFolderTag(t) && t !== gallery.name)
        links.push({ child: gallery, parent: addContainer("tag", t, "") });
    }
  }
  for (const rawGallery of Object.keys(galleryAlbum)) {
    const gallery = addContainer("gallery", normalizeTag(rawGallery), "");
    const album = normalizeTag(galleryAlbum[rawGallery]);
    if (gallery && album && album !== gallery.name)
      links.push({ child: gallery, parent: addContainer("album", album, "", true) });
  }

  const order = { gallery: 0, tag: 1, album: 2 };
  const depth = (scope) => (scope ? scope.split("/").length : 0);
  const sorted = Array.from(containers.values()).sort((a, b) => {
    if (depth(a.scope) !== depth(b.scope)) return depth(a.scope) - depth(b.scope);
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    const sa = String(a.scope);
    const sb = String(b.scope);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  const taken = new Set();
  for (const c of sorted) {
    const base = tagConvBaseName(c.name, c.scope);
    const plain = tagConvPlainBaseName(c.name, c.scope);
    if (base !== plain) report.reservedRenames.push({ from: plain, to: base });
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    if (name !== base)
      report.collisions.push({ kind: c.kind, legacy: c.name, scope: c.scope, name });
    taken.add(name);
    c.newName = name;
    if (name !== c.name)
      report.renamed.push({ kind: c.kind, legacy: c.name, scope: c.scope, name });
  }

  const folderKeyByNormPath = new Map();
  for (const rawPath of Object.keys(folders)) {
    const norm = tagConvNormPath(rawPath);
    if (!folderKeyByNormPath.has(norm)) folderKeyByNormPath.set(norm, rawPath);
  }
  const outFolders = {};
  const allPaths = new Set([
    ...folderKeyByNormPath.keys(),
    ...folderAlbums.keys(),
    ...folderGalleries.keys(),
  ]);
  for (const path of allPaths) {
    if (!path) continue;
    const names = [];
    const scope = tagConvParentPath(tagConvOriginScope(path, trashItems));
    for (const t of folderUserTags.get(path) || []) {
      const c = containers.get(identity("tag", t, scope));
      if (c) names.push(c.newName);
    }
    const album = folderAlbums.get(path);
    if (album) names.push(album.newName);
    for (const g of folderGalleries.get(path) || []) names.push(g.newName);
    const merged = Array.from(new Set((folderReserved.get(path) || []).concat(names)));
    if (!merged.length) continue;
    const raw = folders[folderKeyByNormPath.get(path)];
    const fp = isObj(raw) && Number.isFinite(raw.fp) ? raw.fp >>> 0 : 0;
    outFolders[path] = { fp, tags: merged };
  }

  const parents = new Map();
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const p of parents.get(from) || []) if (reaches(p, to, seen)) return true;
    return false;
  };
  for (const { child, parent } of links) {
    if (!child || !parent) continue;
    const c = child.newName;
    const p = parent.newName;
    if (!c || !p || c === p) continue;
    if (reaches(p, c)) {
      report.droppedCycles.push({ child: c, parent: p });
      continue;
    }
    if (!parents.has(c)) parents.set(c, new Set());
    parents.get(c).add(p);
  }
  const tagParents = {};
  for (const [c, set] of parents) tagParents[c] = Array.from(set).sort();
  const exclusiveTags = Array.from(containers.values())
    .filter((c) => c.exclusive)
    .map((c) => c.newName)
    .sort();

  const byKindName = new Map();
  for (const c of containers.values()) {
    const k = `${c.kind}\n${c.name}`;
    if (!byKindName.has(k)) byKindName.set(k, []);
    byKindName.get(k).push(c);
  }
  const translateKey = (rawKey) => {
    const parsed = tagConvParseStateKey(rawKey);
    if (!parsed || !parsed.name) return rawKey;
    if (parsed.scope != null) {
      const scope =
        parsed.kind === "gallery" ? "" : tagConvOriginScope(parsed.scope, trashItems);
      const c = containers.get(identity(parsed.kind, parsed.name, scope));
      if (c) return `tag:${c.newName}`;
      const wouldBe = tagConvBaseName(parsed.name, scope);
      return taken.has(wouldBe) ? rawKey : `tag:${wouldBe}`;
    }
    const list = byKindName.get(`${parsed.kind}\n${parsed.name}`) || [];
    return list.length === 1 ? `tag:${list[0].newName}` : rawKey;
  };
  const rekeyMap = (map) => {
    if (!isObj(map)) return map;
    const out = {};
    for (const key of Object.keys(map)) {
      const next = translateKey(key);
      if (!own(out, next)) out[next] = map[key];
    }
    return out;
  };

  const out = {
    tags: Object.assign({}, tags, {
      schema: TAGS_SCHEMA_VERSION,
      updatedAt: Date.now(),
      folders: outFolders,
      tagByFp: {},
      hiddenTagByKey: rekeyMap(tags.hiddenTagByKey || {}),
      tagMediaFilterByKey: rekeyMap(tags.tagMediaFilterByKey || {}),
      tagParents,
      exclusiveTags,
    }),
    tagAlbums: { schema: 5, updatedAt: Date.now(), convertedToTags: true },
    report,
  };
  if (isObj(docs.thumbnails)) {
    out.thumbnails = Object.assign({}, docs.thumbnails, {
      tagThumbnailModeByTag: rekeyMap(docs.thumbnails.tagThumbnailModeByTag || {}),
      tagThumbnailByTag: rekeyMap(docs.thumbnails.tagThumbnailByTag || {}),
    });
  }
  if (isObj(docs.prefGeneral)) {
    out.prefGeneral = Object.assign({}, docs.prefGeneral, {
      containerSortByTagKey: rekeyMap(docs.prefGeneral.containerSortByTagKey || {}),
    });
  }
  if (isObj(docs.appearanceAssignments)) {
    out.appearanceAssignments = Object.assign({}, docs.appearanceAssignments, {
      mediaPresetByTagContext: rekeyMap(
        docs.appearanceAssignments.mediaPresetByTagContext || {},
      ),
    });
  }
  const kinds = Array.from(containers.values());
  report.counts = {
    containers: containers.size,
    tags: kinds.filter((c) => c.kind === "tag").length,
    albums: kinds.filter((c) => c.kind === "album").length,
    galleries: kinds.filter((c) => c.kind === "gallery").length,
    foldersWithTags: Object.keys(outFolders).length,
    tagInTagLinks: Object.values(tagParents).reduce((n, list) => n + list.length, 0),
    exclusive: exclusiveTags.length,
  };
  return out;
}

/* The load-time step shared by both hosts: find the tag-related documents in
   the list about to be applied, convert them in place if they need it, and
   report which documents changed so they get written back. `backup` receives
   the untouched originals first and must succeed before anything is replaced --
   a conversion that could not leave a copy behind does not happen. */
async function convertLoadedTagDocs(splitDocs, backup = null) {
  const list = Array.isArray(splitDocs) ? splitDocs : [];
  const byId = new Map(list.map((pair) => [pair[0], pair[1]]));
  const tagsDoc = byId.get(META_DOC_IDS.tags) || null;
  const tagAlbumsDoc = byId.get(META_DOC_IDS.tagAlbums) || null;
  if (!legacyTagMetadataNeedsConversion(tagsDoc, tagAlbumsDoc)) return [];
  if (typeof backup === "function") {
    const saved = await backup({ tags: tagsDoc, tagAlbums: tagAlbumsDoc });
    if (saved === false) {
      console.error("Tag conversion skipped: the backup could not be written.");
      return [];
    }
  }
  const converted = convertLegacyTagMetadata({
    tags: tagsDoc,
    tagAlbums: tagAlbumsDoc,
    trash: byId.get(META_DOC_IDS.trash) || null,
    thumbnails: byId.get(META_DOC_IDS.thumbnails) || null,
    prefGeneral: byId.get(META_DOC_IDS.prefGeneral) || null,
    appearanceAssignments: byId.get(META_DOC_IDS.appearanceAssignments) || null,
  });
  if (converted.report && converted.report.skipped) return [];
  const replacements = [
    [META_DOC_IDS.tags, converted.tags],
    [META_DOC_IDS.tagAlbums, converted.tagAlbums],
    [META_DOC_IDS.thumbnails, converted.thumbnails],
    [META_DOC_IDS.prefGeneral, converted.prefGeneral],
    [META_DOC_IDS.appearanceAssignments, converted.appearanceAssignments],
  ];
  const changed = [];
  for (const [docId, doc] of replacements) {
    if (!doc) continue;
    const index = list.findIndex((pair) => pair[0] === docId);
    if (index >= 0) list[index] = [docId, doc];
    else list.push([docId, doc]);
    changed.push(docId);
  }
  console.info("Converted tags, albums and galleries to Tags.", converted.report);
  return changed;
}

function convertLoadedTagDocsSync(splitDocs, backup = null) {
  const list = Array.isArray(splitDocs) ? splitDocs : [];
  const byId = new Map(list.map((pair) => [pair[0], pair[1]]));
  if (
    !legacyTagMetadataNeedsConversion(
      byId.get(META_DOC_IDS.tags) || null,
      byId.get(META_DOC_IDS.tagAlbums) || null,
    )
  )
    return [];
  if (typeof backup === "function") {
    const saved = backup({
      tags: byId.get(META_DOC_IDS.tags) || null,
      tagAlbums: byId.get(META_DOC_IDS.tagAlbums) || null,
    });
    if (saved === false) {
      console.error("Tag conversion skipped: the backup could not be written.");
      return [];
    }
  }
  const converted = convertLegacyTagMetadata({
    tags: byId.get(META_DOC_IDS.tags) || null,
    tagAlbums: byId.get(META_DOC_IDS.tagAlbums) || null,
    trash: byId.get(META_DOC_IDS.trash) || null,
    thumbnails: byId.get(META_DOC_IDS.thumbnails) || null,
    prefGeneral: byId.get(META_DOC_IDS.prefGeneral) || null,
    appearanceAssignments: byId.get(META_DOC_IDS.appearanceAssignments) || null,
  });
  if (converted.report && converted.report.skipped) return [];
  const changed = [];
  for (const [docId, doc] of [
    [META_DOC_IDS.tags, converted.tags],
    [META_DOC_IDS.tagAlbums, converted.tagAlbums],
    [META_DOC_IDS.thumbnails, converted.thumbnails],
    [META_DOC_IDS.prefGeneral, converted.prefGeneral],
    [META_DOC_IDS.appearanceAssignments, converted.appearanceAssignments],
  ]) {
    if (!doc) continue;
    const index = list.findIndex((pair) => pair[0] === docId);
    if (index >= 0) list[index] = [docId, doc];
    else list.push([docId, doc]);
    changed.push(docId);
  }
  console.info("Converted tags, albums and galleries to Tags.", converted.report);
  return changed;
}

/* Writes the originals next to the documents they came from, once. An existing
   backup is never overwritten: if a library is converted, restored from that
   backup and converted again, the first copy is the one worth keeping. */
async function backupTagDocsToFs(originals) {
  const sys = WS.meta && WS.meta.fsSysDirHandle;
  if (!sys) return false;
  try {
    for (const key of Object.keys(TAG_CONVERSION_BACKUP_FILE_NAMES)) {
      const doc = originals && originals[key];
      if (!doc) continue;
      const fh = await sys.getFileHandle(TAG_CONVERSION_BACKUP_FILE_NAMES[key], {
        create: true,
      });
      const existing = await fh.getFile();
      if (existing && existing.size > 0) continue;
      const writable = await fh.createWritable();
      await writable.write(JSON.stringify(doc));
      await writable.close();
    }
    return true;
  } catch (err) {
    console.error("Could not back up tag metadata before conversion.", err);
    return false;
  }
}

function backupTagDocsToLocal(keys, originals) {
  try {
    for (const key of Object.keys(TAG_CONVERSION_BACKUP_FILE_NAMES)) {
      const doc = originals && originals[key];
      const storageKey = `${String(keys && keys.docs && keys.docs[META_DOC_IDS.tags] || "LocalGalleryTags")}:${TAG_CONVERSION_BACKUP_FILE_NAMES[key]}`;
      if (!doc || localStorage.getItem(storageKey)) continue;
      localStorage.setItem(storageKey, JSON.stringify(doc));
    }
    return true;
  } catch (err) {
    console.error("Could not back up tag metadata before conversion.", err);
    return false;
  }
}
