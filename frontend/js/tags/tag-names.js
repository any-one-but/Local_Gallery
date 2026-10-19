/* Tag names
   Reserved and internal Tag names: All tags, All Models/Sets, Certified fresh,
   Tag storage, model media views. */

/* ---------------------------------------------------------------------------
   One-time conversion to the Tag model
   ---------------------------------------------------------------------------
   Tags used to belong to a folder (the same name in two folders was two tags),
   albums likewise held folders and tags and hid them from their parent, and
   galleries collected from the whole library. They are all Tags now: one
   library-wide name each, able to hold other Tags, with an Exclusive switch.

   This runs on the raw documents before any is applied, so nothing in the live
   model ever has to understand the old shape. It is pure -- inputs are never
   modified -- and it refuses to run on data it has already converted, since a
   second pass would add another bracket to every name.

   Naming: a tag or album that lived in a folder becomes "folder - name"; one at
   the root, and every gallery, keeps its name. A clash is settled shallowest
   folder first, then gallery < tag < album, and the loser gets " 2", " 3"...
   A name that would be one of INTERNAL_TAG_NAMES gets " (tag)". A scope inside the
   Trash is named for where its folder came from, so putting it back finds its
   Tag. Settings keyed by the old scoped keys move to `tag:<name>`; a bare key
   that names no folder moves only when exactly one container could own it. */

const TAGS_SCHEMA_VERSION = 3;
// The utility containers that are Tag-shaped are keyed by an internal name in
// the `__name__` form the folder markers use (FAVORITE_TAG), which no one would
// type, so every name a person would give a Tag stays free -- a Tag called
// "All tags" or "Storage" is just a Tag. Their cards carry their own labels.
//
// "All tags" (a utility container) is a Tag-shaped folder in the root that holds every
// Tag by reference. See tagChildNames.
const ALL_TAGS_NAME = "__all_tags__";
// "All Models" and "All Sets" (utility containers) are Tag-shaped the same way, but hold
// folders: every Model, or every Set, straight from the library's shape rather
// than from any tag -- so Exclusive Tags cannot take anything out of them. See
// libraryShapeViewMemberPaths.
const ALL_MODELS_NAME = "__all_models__";
const ALL_SETS_NAME = "__all_sets__";
// "Certified fresh" (a utility container) is the same kind of view: every Model
// holding at least one Set scored above 0. See certifiedFreshModelPaths.
const CERTIFIED_FRESH_NAME = "__certified_fresh__";
const LIBRARY_SHAPE_VIEW_NAMES = new Set([ALL_MODELS_NAME, ALL_SETS_NAME, CERTIFIED_FRESH_NAME]);
// "Tag storage" (a utility container) is a real Tag under an internal name, with
// two differences: it holds only Tags (no folder can be put in it, and getTagModel
// ignores any that are), and it is always Exclusive, so the Tags in it leave the
// root while the Models they hold stay where they are. Its card is built with
// the other utility containers, never as an ordinary Tag card.
const TAG_STORAGE_LABEL = "Tag storage";
const TAG_STORAGE_NAME = "__tag_storage__";
// It has been stored under two earlier names: "sources" (when it was called
// Sources) and then "tag storage". The tags document records the name it was
// written with in `tagStorage` (absent means "sources"), and a document written
// under an older one has its links moved here once at load
// (metaApplyTagsDocLog); the old name is an ordinary Tag name from then on.
const TAG_STORAGE_FIRST_NAME = "sources";
// The Tag-shaped views that are not Tags: nothing to rename, tag or delete.
const VIEW_ONLY_TAG_NAMES = new Set([ALL_TAGS_NAME, ALL_MODELS_NAME, ALL_SETS_NAME, CERTIFIED_FRESH_NAME, TAG_STORAGE_NAME]);
// The only names a Tag cannot take: the internal keys above. Anything else is
// free as long as no other Tag has it.
const INTERNAL_TAG_NAMES = new Set([ALL_TAGS_NAME, ALL_MODELS_NAME, ALL_SETS_NAME, CERTIFIED_FRESH_NAME, TAG_STORAGE_NAME]);

// "<Model>'s Images", "<Model>'s Videos" and "<Model>'s Text" (utility
// containers) are the one kind that lives inside each Model rather than the
// root: that Model's Sets seen through one media type, like a Tag with a media
// type override. Their name is built from the Model's path, so it cannot be a
// name anyone would type, and it follows a rename on its own (the label is
// read off the Model's current name). Hex keeps the path intact through
// normalizeTag, which lowercases. See modelMediaViewNamesForModel.
// `var`: metaGetTagMediaFilterByKey reads them and can run before this line.
var MODEL_MEDIA_VIEW_PREFIX = "__model_media__:";
var MODEL_MEDIA_VIEW_KINDS = Object.freeze([
  Object.freeze({ type: "images", word: "Images", icon: "image" }),
  Object.freeze({ type: "videos", word: "Videos", icon: "video" }),
  Object.freeze({ type: "text", word: "Text", icon: "markdown" }),
]);

function modelMediaViewName(modelPath, type) {
  const bytes = new TextEncoder().encode(String(modelPath || ""));
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return `${MODEL_MEDIA_VIEW_PREFIX}${type}:${hex}`;
}

// { type, modelPath, kind } for a Model's media view name, else null.
function parseModelMediaViewName(name) {
  const tag = String(name || "");
  if (!tag.startsWith(MODEL_MEDIA_VIEW_PREFIX)) return null;
  const body = tag.slice(MODEL_MEDIA_VIEW_PREFIX.length);
  const sep = body.indexOf(":");
  if (sep <= 0) return null;
  const kind = MODEL_MEDIA_VIEW_KINDS.find((k) => k.type === body.slice(0, sep));
  const hex = body.slice(sep + 1);
  if (!kind || !hex || hex.length % 2 || /[^0-9a-f]/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let modelPath = "";
  try {
    modelPath = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return modelPath ? { type: kind.type, modelPath, kind } : null;
}

function isModelMediaViewName(name) {
  return String(name || "").startsWith(MODEL_MEDIA_VIEW_PREFIX);
}

// "James' Images", "Madison Kate's Videos".
function modelPossessive(name) {
  const s = String(name || "").trim();
  return /s$/i.test(s) ? `${s}'` : `${s}'s`;
}

function modelMediaViewLabel(name) {
  const parsed = parseModelMediaViewName(name);
  if (!parsed) return String(name || "");
  const node = WS.dirByPath && WS.dirByPath.get(parsed.modelPath);
  const modelName =
    (node && node.name) || parsed.modelPath.split("/").filter(Boolean).pop() || "";
  return `${modelPossessive(modelName)} ${parsed.kind.word}`;
}

function isInternalTagName(name) {
  return INTERNAL_TAG_NAMES.has(name) || isModelMediaViewName(name);
}

function isViewOnlyTagName(name) {
  return VIEW_ONLY_TAG_NAMES.has(name) || isModelMediaViewName(name);
}

// The views whose folders come straight from the library's shape.
function isLibraryShapeViewName(name) {
  return LIBRARY_SHAPE_VIEW_NAMES.has(name) || isModelMediaViewName(name);
}

// A Tag's name as the menus and titles show it: the Tag-shaped utility
// containers by their labels, not their stored names.
function tagDisplayName(name) {
  const tag = normalizeTag(name);
  if (tag === TAG_STORAGE_NAME) return TAG_STORAGE_LABEL;
  if (tag === ALL_TAGS_NAME) return "All tags";
  if (tag === ALL_MODELS_NAME) return "All Models";
  if (tag === ALL_SETS_NAME) return "All Sets";
  if (tag === CERTIFIED_FRESH_NAME) return "Certified fresh";
  if (isModelMediaViewName(tag)) return modelMediaViewLabel(tag);
  return String(name || "");
}
