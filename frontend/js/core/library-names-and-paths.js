/* Core model: names and paths
   File types, display names, path helpers and the DirNode that every folder in
   the tree is made of. */

/* Local note: version 01.02.08 was the last version to include online features. */
/* =========================================================
       Core model
       ========================================================= */

const imgRE = /\.(jpe?g|png|gif|webp|tiff|bmp|avif)$/i;
const vidRE = /\.(mp4|m4v|mov|wmv|flv|avi|webm|mkv)$/i;
const mdRE = /\.(md|markdown)$/i;
const indexPrefixRE = /^(\d+)\s-\s/;

const FAVORITE_TAG = "__favorite__";
const HIDDEN_TAG = "__hidden__";
const STORAGE_TAG = "__storage__";
const LEGACY_PROCESSING_DISABLED_TAG = "__processing_disabled__";
const FOLDER_THUMB_NONE_SENTINEL = "__thumb_none__";
const FOLDER_THUMB_ROTATE_SENTINEL = "__thumb_rotate__";
const INTERNAL_TRASH_DIR_NAME = "__LOCAL_GALLERY_TRASH__";
// The music player's folder (see "Music player"). Unlike the Trash it is never
// part of the library tree: every scan skips it at the top level.
const INTERNAL_MUSIC_DIR_NAME = "__LOCAL_GALLERY_MUSIC__";
// The guide for AI assistants (library-ai/CLAUDE.md, see "Editing from outside
// the app") sits in the root beside the Models. It is not media, and every
// scan passes over it.
const LIBRARY_GUIDE_FILE_NAMES = new Set(["CLAUDE.md", "AGENTS.md"]);
const TRASH_UI_LABEL = "Trash";
const STORAGE_UI_LABEL = "Storage";
// Legacy thumbnail style switch. "aspect" mode remains in code for future reactivation,
// but the app currently runs cropped thumbnails only.
const ENABLE_ASPECT_RATIO_THUMBNAIL_STYLE = false;
// Keep quad thumbnail logic in code, but force it off in the shipped UI/runtime path.
const ENABLE_QUAD_THUMBNAILS = false;
const GRID_CROPPED_COLS_BY_SCALE = Object.freeze({
  row10: 10,
  row9: 9,
  row8: 8,
  row7: 7,
  row6: 6,
  row5: 5,
  row4: 4,
  row3: 3,
});

let LAST_LOADED_FILE_LIST = [];

function isInternalTrashDirName(name) {
  return String(name || "") === INTERNAL_TRASH_DIR_NAME;
}

function isInternalTrashPath(path) {
  return String(path || "") === INTERNAL_TRASH_DIR_NAME;
}

function isPathInsideInternalTrash(path) {
  const normalized = String(path || "");
  return (
    normalized === INTERNAL_TRASH_DIR_NAME ||
    normalized.startsWith(INTERNAL_TRASH_DIR_NAME + "/")
  );
}

function isInternalTrashDirNode(node) {
  return !!node && isInternalTrashPath(node.path || node.name || "");
}

function isDirectChildOfInternalTrash(path) {
  const normalized = String(path || "");
  if (!normalized.startsWith(INTERNAL_TRASH_DIR_NAME + "/")) return false;
  return normalized.slice(INTERNAL_TRASH_DIR_NAME.length + 1).split("/").length === 1;
}

function isFolderPathMovableToTrash(path) {
  if (!(WS.meta && WS.meta.fsRootHandle)) return false;
  const normalized = normalizeWorkspaceRelPath(path);
  // Storage and Trash are mutually exclusive locations. A stored folder must
  // be removed from Storage before it can be moved to Trash.
  return !!(
    normalized &&
    !isInternalTrashDirName(normalized) &&
    !isPathInsideInternalTrash(normalized) &&
    !metaHasStorage(normalized)
  );
}

function displayFolderSegmentName(name) {
  return isInternalTrashDirName(name) ? TRASH_UI_LABEL : displayName(name);
}
function isImageName(name) {
  return imgRE.test((name || "").toLowerCase());
}
function isVideoName(name) {
  return vidRE.test((name || "").toLowerCase());
}
function isMarkdownName(name) {
  return mdRE.test((name || "").toLowerCase());
}
// Central type classifier for a filename: "video" | "image" | "markdown" | "".
function fileTypeForName(name) {
  if (isVideoName(name)) return "video";
  if (isImageName(name)) return "image";
  if (isMarkdownName(name)) return "markdown";
  return "";
}

function fileKey(file, relPathOverride) {
  const rp = relPathOverride || file.webkitRelativePath || "";
  return file.name + "::" + file.lastModified + "::" + file.size + "::" + rp;
}

function fileKeyForRecord(rec, relPathOverride) {
  const relPath = String(
    relPathOverride != null ? relPathOverride : rec?.relPath || "",
  );
  const name = String(rec?.name || rec?.file?.name || "");
  const lastModified = Number.isFinite(Number(rec?.lastModified))
    ? Number(rec.lastModified)
    : Number(rec?.file?.lastModified || 0);
  const size = Number.isFinite(Number(rec?.size))
    ? Number(rec.size)
    : Number(rec?.file?.size || 0);
  return `${name}::${lastModified}::${size}::${relPath}`;
}

function splitIndexPrefix(name) {
  const s = String(name || "");
  const m = s.match(indexPrefixRE);
  if (!m) return { idx: null, clean: s };
  return { idx: parseInt(m[1], 10), clean: s.slice(m[0].length) };
}

function displayName(name) {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return applyDisplayNameRules(name, opt, { isFile: false });
}

function displayTagFolderLabel(name) {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  let out = String(name || "");
  if (opt && opt.forceTitleCaps) out = toTitleCaps(out);
  return out;
}

// Title-cases a generated label or, when Force title caps is enabled, a
// displayed item name.
//
// A word that already carries a capital past its first letter is left exactly
// as the user typed it. Lowercasing the remainder would flatten deliberate
// capitalisation that is part of the name rather than sloppy casing to fix —
// NASA, iPhone, eBay, McDonald, TestLibrary — and this runs on real folder and
// file names, not just on generated labels. Words with no capital of their own
// ("my holiday pics") are still capitalised, which is the whole point of the
// option.
function toTitleCaps(str) {
  return String(str || "").replace(/\w\S*/g, (txt) => {
    if (/[A-Z]/.test(txt)) return txt;
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  });
}

function splitNameExt(name) {
  const raw = String(name || "");
  const i = raw.lastIndexOf(".");
  if (i <= 0) return { base: raw, ext: "" };
  return { base: raw.slice(0, i), ext: raw.slice(i) };
}

function applyDisplayNameRules(name, opt, ctx = null) {
  let out = String(name || "");
  const isFile = !!(ctx && ctx.isFile);
  if (opt && opt.hideBeforeLastDashInFileNames) {
    const idx = out.lastIndexOf(" - ");
    if (idx >= 0) out = out.slice(idx + 3);
  }
  if (isFile && opt && opt.hideUnderscoresInFileNames) {
    out = out.replace(/_/g, " ");
  }
  if (isFile && opt && opt.hideAfterFirstUnderscoreInFileNames) {
    const idx = out.indexOf("_");
    if (idx >= 0) out = out.slice(0, idx);
  }
  if (opt && opt.forceTitleCaps) out = toTitleCaps(out);
  return out;
}

function compareIndexedNames(a, b) {
  const A = splitIndexPrefix(a);
  const B = splitIndexPrefix(b);
  const ai = A.idx === null || !Number.isFinite(A.idx) ? Infinity : A.idx;
  const bi = B.idx === null || !Number.isFinite(B.idx) ? Infinity : B.idx;
  if (ai !== bi) return ai - bi;
  const ac = (A.clean || "").toLowerCase();
  const bc = (B.clean || "").toLowerCase();
  const c = ac.localeCompare(bc);
  if (c) return c;
  return String(a || "").localeCompare(String(b || ""));
}

function displayPath(path) {
  const p = String(path || "");
  try {
    if (typeof WS !== "undefined" && WS.dirByPath && WS.dirByPath.has(p)) {
      const node = WS.dirByPath.get(p);
      if (node) {
        const parts = [];
        let cur = node;
        while (cur) {
          parts.push(dirDisplayName(cur));
          cur = cur.parent;
        }
        parts.reverse();
        return parts.join("/") || "";
      }
    }
  } catch {}
  const parts = p.split("/").filter(Boolean);
  const out = parts.map((seg) => displayFolderSegmentName(seg));
  return out.join("/") || "";
}

function displayRelPath(relPath) {
  const parts = String(relPath || "")
    .split("/")
    .filter(Boolean);
  const out = parts.map((seg) => displayFolderSegmentName(seg));
  return out.join("/") || "";
}

function normalizeFolderNameInput(name) {
  return String(name || "").trim();
}

function isValidFolderName(name) {
  if (!name) return false;
  if (name === "." || name === "..") return false;
  if (/[\/\\]/.test(name)) return false;
  return true;
}

function isValidFileName(name) {
  if (!name) return false;
  if (name === "." || name === "..") return false;
  if (/[\/\\]/.test(name)) return false;
  return true;
}

function remapPathPrefix(oldPrefix, newPrefix, path) {
  const p = String(path || "");
  if (!oldPrefix) return p;
  if (p === oldPrefix) return newPrefix;
  if (p.startsWith(oldPrefix + "/"))
    return newPrefix + p.slice(oldPrefix.length);
  return p;
}

function remapPathSet(src, oldPrefix, newPrefix) {
  const next = new Set();
  for (const p of src || []) next.add(remapPathPrefix(oldPrefix, newPrefix, p));
  return next;
}

// Remap without replacing the Set object. The live bulk-selection sets are
// aliases into the per-directory selection maps (syncBulkSelectionForCurrentDir);
// swapping in a fresh Set breaks that aliasing, so a later clear empties the
// detached copy while the map keeps the stale pre-move paths forever.
function remapPathSetInPlace(set, oldPrefix, newPrefix) {
  if (!set || !set.size || !oldPrefix) return set;
  const remapped = Array.from(set, (p) =>
    remapPathPrefix(oldPrefix, newPrefix, p),
  );
  set.clear();
  for (const p of remapped) set.add(p);
  return set;
}

function remapPathMapKeys(src, oldPrefix, newPrefix) {
  const next = new Map();
  for (const [key, value] of src || []) {
    next.set(remapPathPrefix(oldPrefix, newPrefix, key), value);
  }
  return next;
}

function remapPathMapValues(src, oldPrefix, newPrefix) {
  const next = new Map();
  for (const [key, value] of src || []) {
    next.set(key, remapPathPrefix(oldPrefix, newPrefix, value));
  }
  return next;
}

function makeDirNode(name, parent) {
  return {
    type: "dir",
    name,
    parent,
    childrenDirs: [],
    childrenFiles: [],
    lastIndex: 0,
    path: "",
    directFileCount: 0,
    directFolderCount: 0,
    recursiveFileCount: 0,
    recursiveFolderCount: 0,
    recursiveItemCount: 0,
    recursiveImageCount: 0,
    recursiveVideoCount: 0,
    recursiveTextCount: 0,
    recursiveSizeBytes: 0,
    loadState: "loaded",
    summary: null,
    catalogPathKey: "",
    altLabel: "",
    altVariants: null,
    isMissingPlaceholder: false,
    sourcePath: "",
    _altChildPool: null,
  };
}

function isLibraryGuideFile(dirPath, name) {
  return !dirPath && LIBRARY_GUIDE_FILE_NAMES.has(String(name || ""));
}
