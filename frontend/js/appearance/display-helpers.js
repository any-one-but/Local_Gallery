/* Display helpers
   Position numbers in names, float-layer spacers and other small display
   switches. */

function fileDisplayName(name) {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const parts = splitNameExt(name || "");
  const base = applyDisplayNameRules(parts.base || "", opt, { isFile: true });
  return `${base}${opt && opt.hideFileExtensionsInFileNames ? "" : parts.ext || ""}`;
}

function displayPositionNumbersInNamesEnabled() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return !!(opt && opt.showPositionNumbersInNames);
}

function showTagFolderSpacerRowEnabled() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return !!(opt && opt.showTagFolderSpacerRow);
}

function showSpecialContainerSpacerRowEnabled() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return !!(opt && opt.showSpecialContainerSpacerRow);
}

// A folder listing is three layers, always in this order: the utility
// containers (the Trash, Storage, Untagged and the All tags / Models / Sets /
// Certified fresh views), then Favorites with the Tags, then the folders. Float utility
// containers puts a blank row under the first layer and Float tags one under
// the second. With Float utility containers off the first layer joins the
// Tags' layer, so Float tags alone still separates both from the folders.
// Returns -1 for anything that is not part of the layering (the new-tag
// placeholder, files).
function folderEntryFloatTier(entry) {
  if (!entry || entry.placeholder) return -1;
  if (entry.kind === "dir") return isTrashRootPortalEntry(entry) ? 0 : 2;
  if (entry.kind !== "tag") return -1;
  if (entry.special === "favorites") return 1;
  if (entry.special) return 0;
  if (isViewOnlyTagName(String(entry.tag || ""))) return 0;
  return 1;
}

// Fed every folder entry in order; answers whether a spacer row goes before it.
function makeFloatLayerSpacerGate() {
  const floatSpecials = showSpecialContainerSpacerRowEnabled();
  const floatTags = showTagFolderSpacerRowEnabled();
  let top = -1;
  return (entry) => {
    const tier = folderEntryFloatTier(entry);
    if (tier < 0) return false;
    const prev = top;
    if (tier > top) top = tier;
    if (prev < 0 || tier <= prev) return false;
    if (prev === 0)
      return tier === 1 ? floatSpecials : floatSpecials || floatTags;
    return floatTags;
  };
}

function displayPositionPrefix(position) {
  const n = Number(position);
  if (
    !displayPositionNumbersInNamesEnabled() ||
    !Number.isFinite(n) ||
    n < 1
  )
    return "";
  return `${Math.floor(n)}. `;
}

function prefixDisplayLabelWithPosition(label, position) {
  return `${displayPositionPrefix(position)}${String(label || "")}`;
}

function shouldNumberDisplayDirNode(node) {
  return !!node && !node._skipTagFilters && !isStorageStubDirNode(node);
}

function buildDisplayPositionMapsForFolderAndFileEntries(
  folderEntries,
  fileIds,
) {
  const dirPositions = new Map();
  const filePositions = new Map();
  let position = 0;
  const folders = Array.isArray(folderEntries) ? folderEntries : [];
  for (let i = 0; i < folders.length; i++) {
    const entry = folders[i];
    if (!entry || entry.kind !== "dir" || !shouldNumberDisplayDirNode(entry.node))
      continue;
    position++;
    dirPositions.set(String(entry.node?.path || ""), position);
  }
  const ids = Array.isArray(fileIds) ? fileIds : [];
  for (let i = 0; i < ids.length; i++) {
    const id = String(ids[i] || "");
    if (!id || !WS.fileById.has(id)) continue;
    position++;
    filePositions.set(id, position);
  }
  return { dirPositions, filePositions };
}

function buildDisplayPositionMapsForNavEntries(entries) {
  const dirPositions = new Map();
  const filePositions = new Map();
  let position = 0;
  const list = Array.isArray(entries) ? entries : [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry) continue;
    if (entry.kind === "dir" && shouldNumberDisplayDirNode(entry.node)) {
      position++;
      dirPositions.set(String(entry.node?.path || ""), position);
      continue;
    }
    if (entry.kind === "file") {
      const id = String(entry.id || "");
      if (!id || !WS.fileById.has(id)) continue;
      position++;
      filePositions.set(id, position);
    }
  }
  return { dirPositions, filePositions };
}

function buildDisplayPositionMapsForViewerItems(items) {
  const dirPositions = new Map();
  const filePositions = new Map();
  let position = 0;
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item) continue;
    if (item.isFolder) {
      if (!shouldNumberDisplayDirNode(item.dirNode)) continue;
      position++;
      dirPositions.set(String(item.dirNode?.path || ""), position);
      continue;
    }
    const id = String(item.id || "");
    if (!id || !WS.fileById.has(id)) continue;
    position++;
    filePositions.set(id, position);
  }
  return { dirPositions, filePositions };
}

function relPathDisplayName(relPath, opts = null) {
  const parts = String(relPath || "")
    .split("/")
    .filter(Boolean);
  if (!parts.length) return "";
  const finalPrefix =
    opts && typeof opts.finalPrefix === "string" ? opts.finalPrefix : "";
  const out = parts.map((seg, idx) => {
    if (idx !== parts.length - 1) return displayName(seg || "") || "";
    const finalName = fileDisplayName(seg || "") || "";
    return `${finalPrefix}${finalName}`;
  });
  return out.join("/") || "";
}

function directoriesPaneOpenEnabled() {
  // Preview-only UI: the file pane sidebar is permanently retired. The
  // preview grid is the only interaction surface.
  return false;
}

function aspectRatioMetadataEnabled() {
  // Aspect-ratio filtering/tracking/logging was removed. This master gate stays
  // off so no aspect ratios are measured, cached, hydrated, or logged.
  return false;
}

function metadataDocEnabled(docId) {
  const id = String(docId || "");
  // Never load or save the aspect-ratios log (feature removed).
  if (id === META_DOC_IDS.aspectRatios) return false;
  return true;
}

function isCompactTitleLayout() {
  return !!WS.root && !directoriesPaneOpenEnabled();
}

// Legacy helper kept in place while old grid-mode call sites are retired.
// Unified layout always uses pane-style navigation semantics.
function isGridInteractionMode() {
  return false;
}

function sharedThumbWidthForMode(modeRaw) {
  const mode = normalizeThumbRenderModeValue(modeRaw, "medium");
  if (mode === "small") return 224;
  if (mode === "high") return 640;
  if (mode === "native") return 640;
  return 384;
}

function setOptionsStatus(text) {
  if (!optionsStatusLabel) return;
  optionsStatusLabel.textContent = text || "—";
}

function applyDefaultViewFromOptions() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  if (!opt) return;
  WS.view.filterMode = "all";
  WS.view.aspectRatioFilterMode = "all";
  WS.view.randomFolderCache = new Map();
  WS.view.activePane = directoriesPaneOpenEnabled(opt)
    ? "directories"
    : "preview";
  WS.view.previewSelectedKey = "";
  WS.view.previewSelectionContextKey = "";
  WS.view.folderBehavior = "slide";
  WS.view.hiddenMode = false;
  WS.view.hiddenRootActive = false;
  WS.view.hiddenAnchorPath = "";
  applyColorSchemeFromOptions();
  applyTagFolderTitleColorsFromOptions();
}
