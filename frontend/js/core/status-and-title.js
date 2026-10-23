/* Status messages and the title
   Status messages, quad playback bookkeeping, panic, and the title pane's path
   and counts. (getQuadPlaybackSlots is in ui-references.js.) */

/* =========================================================
       Status/progress helpers
       ========================================================= */

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/* Disable messages is unexposed (Jo's call): its Basics row and its
   Controls entry are gone and messages always show, so a library saved with it
   on cannot be left silent with no way back. Set this to true to bring the
   option, the row and the control back; the stored option is untouched. */
var MUTE_MESSAGES_EXPOSED = false; // `var`: status messages can ask before this line runs.

function muteMessagesEnabled() {
  if (!MUTE_MESSAGES_EXPOSED) return false;
  const opt =
    WS.meta && WS.meta.options ? WS.meta.options : normalizeOptions(null);
  return !!opt.muteMessages;
}

function hideStatusMessages() {
  if (MAIN_STATUS_TIMEOUT) {
    clearTimeout(MAIN_STATUS_TIMEOUT);
    MAIN_STATUS_TIMEOUT = null;
  }
  if (WS.view && WS.view.statusTimeout) {
    clearTimeout(WS.view.statusTimeout);
    WS.view.statusTimeout = null;
  }
  mainStatusMessageEl.classList.remove("visible");
  mainStatusMessageEl.textContent = "";
  statusMessageEl.classList.remove("visible");
  statusMessageEl.textContent = "";
}

function showMainStatusMessage(text, options = null) {
  const force = !!(options && options.force);
  if (!force && muteMessagesEnabled()) return;
  mainStatusMessageEl.textContent = text || "";
  mainStatusMessageEl.classList.add("visible");
  if (MAIN_STATUS_TIMEOUT) {
    clearTimeout(MAIN_STATUS_TIMEOUT);
    MAIN_STATUS_TIMEOUT = null;
  }
  MAIN_STATUS_TIMEOUT = setTimeout(() => {
    mainStatusMessageEl.classList.remove("visible");
  }, 1200);
}

function normalizeNotificationSourceId(sourceId) {
  const raw = String(sourceId || "")
    .trim()
    .toLowerCase();
  if (!raw) return "misc";
  for (let i = 0; i < NOTIFICATION_SOURCE_SPECS.length; i++) {
    if (NOTIFICATION_SOURCE_SPECS[i].id === raw) return raw;
  }
  return "misc";
}

function notificationSourceSpec(sourceId) {
  const normalized = normalizeNotificationSourceId(sourceId);
  for (let i = 0; i < NOTIFICATION_SOURCE_SPECS.length; i++) {
    const spec = NOTIFICATION_SOURCE_SPECS[i];
    if (spec.id === normalized) return spec;
  }
  return NOTIFICATION_SOURCE_SPECS[NOTIFICATION_SOURCE_SPECS.length - 1];
}

function notificationsEnabledForSource(sourceId) {
  const spec = notificationSourceSpec(sourceId);
  const opt = WS.meta && WS.meta.options ? WS.meta.options : normalizeOptions(null);
  return !!opt[String(spec.optionKey || "")];
}

function captureStatusSourceContext() {
  try {
    throw new Error("status_source");
  } catch (err) {
    return err && err.stack ? String(err.stack).toLowerCase() : "";
  }
}

function inferNotificationSourceId(text, sourceContext = "") {
  const msg = String(text || "").trim().toLowerCase();
  const ctx = String(sourceContext || "").trim().toLowerCase();
  if (!msg && !ctx) return "misc";
  const hasMsg = (...parts) => parts.some((part) => part && msg.includes(part));
  const hasCtx = (...parts) => parts.some((part) => part && ctx.includes(part));

  if (hasMsg("aspect ratio:")) return "cycle-aspect-ratio-filter";
  if (hasMsg("filter:")) return "cycle-filter";
  if (hasMsg("animated filters:")) return "cycle-animated-filters";
  if (hasMsg("folder sort:")) return "cycle-folder-sort";
  if (hasMsg("video end:")) return "cycle-video-end";
  if (hasMsg("shuffle play:")) return "playback";
  if (hasMsg("random folder sort:")) return "random-folder-sort";
  if (hasMsg("quick navigation:")) return "quick-navigation";
  if (hasMsg("reveal hidden items:", "trash folder:", "storage folder:", "untagged folder:", "blank row after tag folders:"))
    return "visibility-toggles";
  if (hasMsg("title layout:", "settings pane:", "preview media uses pane background:"))
    return "pane-toggles";

  if (hasCtx("cycleaspectratiofiltermode", "setaspectratiofiltermode")) return "cycle-aspect-ratio-filter";
  if (hasCtx("cyclefiltermode")) return "cycle-filter";
  if (hasCtx("cyclefoldersortmode", "cycledirsortmode")) return "cycle-folder-sort";
  if (hasCtx("toggleanimatedfilters")) return "cycle-animated-filters";
  if (hasCtx("cyclevideoendbehavior")) return "cycle-video-end";
  if (hasCtx("randomfoldersort")) return "random-folder-sort";

  if (hasCtx("scrub")) return "scrub";
  if (hasCtx("putback", "movefolderswithundotash", "movetotrash", "trash")) return "trash";
  if (hasCtx("loosesetmerge", "setmerge", "merge")) return "merge";
  if (hasCtx("sanitize", "rename")) return "rename";
  if (hasCtx("refreshworkspace", "refreshworkspacefromroothandle")) return "workspace-refresh";
  if (hasCtx("folderpicker", "loadfolder", "indexworkspace", "load workspace", "load folder")) return "workspace-load";
  if (hasCtx("storage")) return "storage";
  if (hasCtx("firstfilejump", "randomfilejump")) return "navigation-jump";
  if (hasCtx("slideshow", "gallerymode")) return "playback";
  if (hasCtx("preset")) return "appearance-presets";
  if (hasCtx("tag", "album")) return "tags";
  if (hasCtx("scorehistory", "scorelog", "stats")) return "stats";

  if (hasMsg("tag media preset", "tag content filter", "removed tag '"))
    return "tags";
  if (hasMsg("scrub")) return "scrub";
  if (hasMsg("score history", "score log")) return "stats";
  if (hasMsg("preset")) return "appearance-presets";
  if (hasMsg("light mode", "force title case", "hide file extensions", "hide underscores", "trim before last dash", "trim after first underscore", "pane background"))
    return "appearance-display";
  if (hasMsg("slideshow", "gallery mode is no longer available")) return "playback";
  if (hasMsg("storage folders cannot be opened", "storage changes")) return "storage";
  if (hasMsg("loaded folder", "load folder", "folder picker unavailable", "read-only mode"))
    return "workspace-load";
  if (hasMsg("refreshing workspace", "refresh complete", "refresh failed", "refresh already running", "refresh requires"))
    return "workspace-refresh";
  if (hasMsg("random set", "random model", "jump to random")) return "navigation-jump";
  if (hasMsg("filter:", "title layout:", "settings pane:"))
    return "pane-toggles";
  if (hasMsg("tag ", "tag album", "album", "hid tag", "unhid tag", "created tag", "no folders contain that tag", "no items contain that tag", "no tags updated", "no tags selected", "removed tag '", "untagged") )
    return "tags";
  if (hasMsg("sanitize names", "rename", "invalid folder name", "invalid file name", "a folder with that name already exists", "a file with that name already exists", "no files renamed", "renaming files requires", "root folder cannot be renamed"))
    return "rename";
  if (hasMsg("put back", "trash folder is unavailable", "move to trash requires", "no trashed folders selected"))
    return "trash";
  if (hasMsg("delete requires", "delete failed", "deleted ")) return "delete";
  if (hasMsg("set merge", "loose set merge", "selected folders must be in the same parent folder", "selected files must be in the same folder", "failed to create merge folder", "failed to finalize merged folder", "failed to create temporary folder", "move failed for "))
    return "merge";
  return "misc";
}

function showStatusMessage(text, sourceId = "", options = null) {
  const force = !!(options && options.force);
  const source = normalizeNotificationSourceId(
    sourceId || inferNotificationSourceId(text, captureStatusSourceContext()),
  );
  if (!force) {
    if (muteMessagesEnabled()) return;
    if (!notificationsEnabledForSource(source)) return;
  }
  if (VIEWER_MODE) {
    statusMessageEl.textContent = text || "";
    statusMessageEl.classList.add("visible");
    if (WS.view.statusTimeout) {
      clearTimeout(WS.view.statusTimeout);
      WS.view.statusTimeout = null;
    }
    WS.view.statusTimeout = setTimeout(() => {
      statusMessageEl.classList.remove("visible");
    }, 1200);
    return;
  }
  showMainStatusMessage(text, options);
}

function showSlideshowMessage(text) {
  if (VIEWER_MODE) {
    showStatusMessage(text, "playback");
    return;
  }
  if (muteMessagesEnabled()) return;
  if (!notificationsEnabledForSource("playback")) return;
  showMainStatusMessage(text);
}

function captureVideoState(vid) {
  if (!vid) return null;
  return {
    muted: !!vid.muted,
    paused: !!vid.paused,
    volume: clampNumber(vid.volume, 0, 1, 1),
  };
}

function isQuadPlaybackMode() {
  return VIEWER_LAYOUT_MODE === "quad" && !!QUAD_PLAYBACK.active;
}

function getQuadPlaybackVideos() {
  return getQuadPlaybackSlots()
    .map((slot) => slot?.videoEl || null)
    .filter((videoEl) => !!videoEl && !!videoEl.dataset.quadFileId);
}

function getQuadPlaybackRecords() {
  const ids = Array.isArray(QUAD_PLAYBACK.fileIds) ? QUAD_PLAYBACK.fileIds : [];
  const recs = [];
  for (let i = 0; i < ids.length; i++) {
    const rec = WS.fileById.get(String(ids[i] || ""));
    if (rec && rec.type === "video") recs.push(rec);
  }
  return recs;
}

function getQuadPlaybackFocusedRecord() {
  const activeId = String(QUAD_PLAYBACK.activeId || "");
  if (activeId) {
    const activeRec = WS.fileById.get(activeId);
    if (activeRec && activeRec.type === "video") return activeRec;
  }
  const recs = getQuadPlaybackRecords();
  return recs[0] || null;
}

function updateQuadPlaybackFilename() {
  if (!filenameEl) return;
  if (!isQuadPlaybackMode()) return;
  filenameEl.textContent = "";
}

function applyQuadPlaybackAudioState() {
  const slots = getQuadPlaybackSlots();
  if (!slots.length) return;
  const activeId =
    String(QUAD_PLAYBACK.activeId || "") || String(slots[0]?.fileId || "");
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot || !slot.videoEl) continue;
    const focused = !!slot.fileId && String(slot.fileId) === activeId;
    slot.cellEl.classList.toggle("active", focused);
    slot.videoEl.volume = (focused ? 1 : 0.05) * appVolumeFactor();
    slot.videoEl.muted = !!QUAD_PLAYBACK.muted || BANIC_ACTIVE;
  }
  updateQuadPlaybackFilename();
}

function setQuadPlaybackFocus(fileId) {
  const id = String(fileId || "");
  if (!id || !isQuadPlaybackMode()) return;
  if (QUAD_PLAYBACK.activeId === id) return;
  QUAD_PLAYBACK.activeId = id;
  applyQuadPlaybackAudioState();
}

function clearQuadPlaybackSlot(slot) {
  if (!slot || !slot.videoEl) return;
  slot.fileId = "";
  slot.rec = null;
  slot.cellEl.classList.remove("active");
  slot.cellEl.style.display = "none";
  slot.videoEl.dataset.quadFileId = "";
  slot.videoEl.dataset.playbackSrc = "";
  slot.videoEl.onloadeddata = null;
  slot.videoEl.onended = null;
  try {
    slot.videoEl.pause();
  } catch {}
  try {
    slot.videoEl.removeAttribute("src");
  } catch {}
  try {
    slot.videoEl.load();
  } catch {}
  slot.videoEl.classList.remove("ready");
  slot.videoEl.volume = 0;
  slot.videoEl.muted = true;
  clearPendingFilmCornerMask(slot.videoEl);
  clearMediaFilterSurface(slot.surfaceName, slot.videoEl);
}

function clearQuadPlaybackSession() {
  const slots = getQuadPlaybackSlots();
  for (let i = 0; i < slots.length; i++) clearQuadPlaybackSlot(slots[i]);
  if (viewerQuadGridEl) {
    viewerQuadGridEl.classList.remove("active");
    viewerQuadGridEl.style.display = "none";
  }
  QUAD_PLAYBACK = { active: false, fileIds: [], activeId: "", muted: false };
  if (viewport) viewport.classList.remove("viewerQuadMode");
}

function applyBanicState(active) {
  if (active === BANIC_ACTIVE) return;
  if (active && MENU_OPEN) closeMenu();
  if (active && document.fullscreenElement) {
    if (VIEWER_MODE) hideOverlay();
    else exitFullscreenIfNeeded();
  }
  BANIC_ACTIVE = active;
  try {
    musicOnPanic(active);
  } catch {}
  try {
    if (active) localStorage.setItem(BANIC_PERSIST_KEY, "1");
    else localStorage.removeItem(BANIC_PERSIST_KEY);
  } catch {}

  if (BANIC_ACTIVE) {
    BANIC_STATE.preview = captureVideoState(previewVideoEl);
    BANIC_STATE.viewer = captureVideoState(viewerVideoEl);
    BANIC_STATE.quad = getQuadPlaybackSlots()
      .map((slot) => ({
        id: String(slot?.fileId || ""),
        state: captureVideoState(slot?.videoEl || null),
      }))
      .filter((entry) => !!entry.id && !!entry.state);
    // The slideshow does not move behind the panic screen (slideshowIsPaused
    // reads BANIC_ACTIVE), and carries on where it was afterwards.

    const vids = Array.from(document.querySelectorAll("video"));
    vids.forEach((vid) => {
      try {
        vid.pause();
      } catch {}
      vid.muted = true;
    });
    banicOverlayEl.classList.add("active");
    return;
  }

  banicOverlayEl.classList.remove("active");
  const restore = (vid, state) => {
    if (!vid || !state) return;
    vid.muted = !!state.muted;
    vid.volume = clampNumber(state.volume, 0, 1, vid.volume);
    if (!state.paused) {
      try {
        vid.play();
      } catch {}
    }
  };
  restore(previewVideoEl, BANIC_STATE.preview);
  restore(viewerVideoEl, BANIC_STATE.viewer);
  if (BANIC_STATE.quad.length) {
    const byId = new Map(
      BANIC_STATE.quad.map((entry) => [String(entry.id || ""), entry.state]),
    );
    for (const slot of getQuadPlaybackSlots()) {
      const state = byId.get(String(slot?.fileId || ""));
      restore(slot?.videoEl || null, state || null);
    }
    if (isQuadPlaybackMode()) applyQuadPlaybackAudioState();
  }
  BANIC_STATE = {
    preview: null,
    viewer: null,
    quad: [],
  };
}

function updateModePill() {
  if (!modePill) return;
  const parts = [];
  const contextualTagFilter = currentContextualTagMediaFilterValue();
  if (contextualTagFilter.length) {
    parts.push(
      `Tag filter: ${describeTagMediaFilterValue(contextualTagFilter)}`,
    );
  }

  const dirSortMode = normalizeDirSortMode(WS.meta.dirSortMode);
  if (
    dirSortMode !== "name" &&
    (scoreInterfaceEnabled() ||
      (dirSortMode !== "score" && dirSortMode !== "efficiency"))
  ) {
    parts.push(`Dir sort: ${dirSortModeLabel(dirSortMode)}`);
  }

  modePill.textContent = parts.length ? parts.join(" | ") : "Mode: default";
}

function tagContextLabel(mode, tag, album = "") {
  const normalizedMode = String(mode || "");
  if (normalizedMode === "favorites") return "Favorites";
  if (normalizedMode === "untagged") return "Untagged";
  if (normalizedMode === "hidden") return "Hidden";
  if (normalizedMode === "gallery")
    return displayTagFolderLabel(String(tag || "").trim()) || "Gallery";
  const albumLabel = displayTagFolderLabel(String(album || "").trim());
  if (normalizedMode === "album") return albumLabel || "Album";
  // By its label: a utility container's stored name is an internal key.
  const tagLabel = displayTagFolderLabel(tagDisplayName(String(tag || "").trim()));
  if (albumLabel && tagLabel) return `${albumLabel} · ${tagLabel}`;
  return tagLabel || albumLabel || "Tag";
}

// The top bar's path is a row of crumbs, Finder's way: Lib › Untagged › Aria
// Vale. Every builder below joins with this one separator, and updateTitleLabel
// splits on it to draw the crumbs. A folder name cannot hold "/", so turning a
// display path's slashes into it is safe.
const TITLE_PATH_SEPARATOR = " \u203a ";

function titlePathForDisplayPath(text) {
  return String(text || "").split("/").filter(Boolean).join(TITLE_PATH_SEPARATOR);
}

function displayRelativePathFromBase(fullPath, basePath) {
  const fullParts = String(fullPath || "")
    .split("/")
    .filter(Boolean);
  const baseParts = String(basePath || "")
    .split("/")
    .filter(Boolean);
  let idx = 0;
  while (
    idx < fullParts.length &&
    idx < baseParts.length &&
    fullParts[idx] === baseParts[idx]
  ) {
    idx++;
  }
  const relParts = fullParts.slice(idx);
  if (!relParts.length) return "";
  return relParts.map((seg) => displayName(seg)).join(TITLE_PATH_SEPARATOR);
}

function findNearestMatchingTagPortalFrameInfo(path) {
  const currentPath = String(path || "");
  const stack = Array.isArray(WS.view?.tagNavStack) ? WS.view.tagNavStack : [];
  if (!currentPath || !stack.length) return null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (!frame || frame.type !== "tag-view") continue;
    const portalRootPath = findMatchingVirtualPortalRootPath(frame, currentPath);
    if (!portalRootPath) continue;
    return {
      frame,
      portalRootPath: String(portalRootPath || ""),
    };
  }
  return null;
}

function buildTagContextPathText(mode, tag, originPath, album = "") {
  const basePath = String(originPath || "");
  const baseLabel = basePath
    ? buildPortalAwareDirectoryPathText(basePath) ||
      titlePathForDisplayPath(displayPath(basePath))
    : dirDisplayName(WS.root) || "root";
  const contextLabel = tagContextLabel(mode, tag, album);
  return contextLabel
    ? `${baseLabel}${TITLE_PATH_SEPARATOR}${contextLabel}`
    : baseLabel;
}

function buildPortalAwareDirectoryPathText(path) {
  const currentPath = String(path || "");
  if (!currentPath) return "";
  const info = findNearestMatchingTagPortalFrameInfo(currentPath);
  if (!info || !info.frame) return "";
  const frame = info.frame;
  const baseText = buildTagContextPathText(
    String(frame.mode || ""),
    String(frame.tag || ""),
    String(frame.originPath || ""),
    String(frame.album || ""),
  );
  const relativeText = displayRelativePathFromBase(
    currentPath,
    String(frame.originPath || ""),
  );
  if (!relativeText) return baseText;
  return `${baseText}${TITLE_PATH_SEPARATOR}${relativeText}`;
}

function dirPathTextForNode(previewDir) {
  if (!WS.root) return "—";
  if (!previewDir) return "—";
  if (previewDir._skipTagFilters) {
    return (
      buildTagContextPathText(
        String(previewDir._tagPreviewMode || ""),
        String(previewDir._tagPreviewTag || previewDir.name || ""),
        String(previewDir._tagPreviewOriginPath || previewDir.parent?.path || ""),
        String(previewDir._tagPreviewAlbum || ""),
      ) ||
      dirDisplayName(WS.root) ||
      "root"
    );
  }
  if (previewDir === WS.root) return dirDisplayName(WS.root) || "root";
  const path = String(previewDir.path || "");
  return (
    (path && buildPortalAwareDirectoryPathText(path)) ||
    (path ? titlePathForDisplayPath(displayPath(path)) || "root" : "root")
  );
}

function getPreviewPathText() {
  return dirPathTextForNode(getPreviewTargetDir());
}

function collectUniqueTitleMetricNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  const sorted = list
    .slice()
    .sort((a, b) => {
      const pathA = String(a?.path || "");
      const pathB = String(b?.path || "");
      const depthA = pathA ? pathA.split("/").filter(Boolean).length : 0;
      const depthB = pathB ? pathB.split("/").filter(Boolean).length : 0;
      if (depthA !== depthB) return depthA - depthB;
      return pathA.localeCompare(pathB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i];
    const path = String(node?.path || "");
    if (
      out.some((parentNode) => isDirWithin(parentNode, node))
    )
      continue;
    out.push(node);
  }
  return out;
}

function getActiveTagPreviewMetricNodes(previewDir) {
  if (!previewDir || !previewDir._skipTagFilters) return [];
  const mode = String(previewDir._tagPreviewMode || "");
  if (mode === "gallery") {
    return getDirsForTagEntry({
      kind: "tag",
      gallery: String(
        previewDir._tagPreviewGallery || previewDir._tagPreviewTag || "",
      ),
      label: String(previewDir.name || "Gallery"),
      originPath: "",
    });
  }
  if (mode === "album") {
    const baseNode =
      WS.dirByPath.get(String(previewDir._tagPreviewOriginPath || "")) ||
      previewDir.parent ||
      WS.root;
    const entries = getTagEntriesForAlbumForBaseNode(
      baseNode,
      String(previewDir._tagPreviewAlbum || ""),
    );
    const out = [];
    const seen = new Set();
    for (let i = 0; i < entries.length; i++) {
      const dirs = getDirsForTagEntry(entries[i]);
      for (let j = 0; j < dirs.length; j++) {
        const dirNode = dirs[j];
        const path = String(dirNode?.path || "");
        if (!path || seen.has(path)) continue;
        seen.add(path);
        out.push(dirNode);
      }
    }
    return out;
  }
  return Array.isArray(previewDir.childrenDirs) ? previewDir.childrenDirs : [];
}

function countRecursiveFoldersForNode(dirNode, memo = null) {
  if (!dirNode) return 0;
  const path = String(dirNode.path || "");
  if (memo && memo.has(path)) return memo.get(path) || 0;
  if (
    ensureDirectoryDerivedIndex() &&
    Number.isFinite(Number(dirNode.recursiveFolderCount))
  ) {
    const count = Math.max(0, Number(dirNode.recursiveFolderCount) || 0) + 1;
    if (memo) memo.set(path, count);
    return count;
  }
  let count = 1;
  const dirs = Array.isArray(dirNode.childrenDirs) ? dirNode.childrenDirs : [];
  for (let i = 0; i < dirs.length; i++) {
    count += countRecursiveFoldersForNode(dirs[i], memo);
  }
  if (memo) memo.set(path, count);
  return count;
}

function formatFolderFileCountSegment(folderCount, fileCount) {
  const folderNum = Math.max(0, Number(folderCount) || 0);
  const fileNum = Math.max(0, Number(fileCount) || 0);
  return `${folderNum} ${folderNum === 1 ? "Folder" : "Folders"} • ${fileNum} ${fileNum === 1 ? "File" : "Files"}`;
}

function getDirectFolderCountForNode(dirNode) {
  if (!dirNode) return 0;
  if (
    ensureDirectoryDerivedIndex() &&
    Number.isFinite(Number(dirNode.directFolderCount))
  )
    return Math.max(0, Number(dirNode.directFolderCount) || 0);
  return getChildDirsForNode(dirNode).length;
}

function getRecursiveFileCountForNode(dirNode) {
  if (!dirNode) return 0;
  return dirItemCount(dirNode);
}

function buildDirFolderFileCountText(dirNode) {
  return formatFolderFileCountSegment(
    getDirectFolderCountForNode(dirNode),
    getRecursiveFileCountForNode(dirNode),
  );
}

function formatTitlePaneScoreSegment(score) {
  const value = Number(score) || 0;
  const rounded = Math.round(value);
  return `Score ${rounded > 0 ? `+${rounded}` : String(rounded)}`;
}

function getTitlePaneScoreForNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += Number(metaGetScore(list[i]?.path || "")) || 0;
  }
  return total;
}

// Metrics for the preview location, resolved the same way as its path text so
// the two never describe different folders.
function getPreviewTitleInfoContext() {
  const previewDir = previewLocationDirNode();
  const title = previewDir
    ? dirDisplayName(previewDir) || "root"
    : "—";
  if (!WS.root) return { title, nodes: [], folderCountMode: "collection" };
  if (!previewDir) return { title, nodes: [], folderCountMode: "collection" };
  if (previewDir._skipTagFilters) {
    return { title, nodes: getActiveTagPreviewMetricNodes(previewDir), folderCountMode: "collection" };
  }
  return { title, nodes: [previewDir], folderCountMode: "directChildren" };
}

// The preview pane is the authoritative location: whatever it currently shows
// — a folder's contents, or a single file — is where you are. Note this sits a
// level below WS.nav.dirNode (see the navigation model in CLAUDE.md), so the
// title deliberately tracks the preview, not the file pane.
function getPreviewLocationFileRecord() {
  if (!WS.preview || WS.preview.kind !== "file") return null;
  const id = String(WS.preview.fileId || "");
  return (id && WS.fileById.get(id)) || null;
}

// The folder that qualifies the preview location.
//
// For a file, WS.preview.dirNode is the *context* it was opened from, which is
// not always its parent. In a portal grid (tag/favorites/hidden) that context is
// genuinely where you are, so it wins. In a plain folder it merely holds the
// last previewed folder and lags the selection — arrowing off a subfolder onto a
// file sibling would otherwise report the file as living inside that subfolder.
// There, the file's own folder is authoritative.
function previewLocationDirNode() {
  const context = getPreviewTargetDir();
  const rec = getPreviewLocationFileRecord();
  if (!rec) return context;
  if (context && context._skipTagFilters) return context;
  return WS.dirByPath.get(String(rec.dirPath || "")) || context;
}

// Path text of the preview location. When a file is open it is the location, so
// its name is the last segment rather than its containing folder's.
function getPreviewLocationPathText() {
  const dirText = dirPathTextForNode(previewLocationDirNode());
  const rec = getPreviewLocationFileRecord();
  if (!rec) return dirText;
  const name = fileDisplayNameForRecord(rec);
  if (!name) return dirText;
  if (!dirText || dirText === "—") return name;
  return `${dirText}${TITLE_PATH_SEPARATOR}${name}`;
}

function getCurrentTitleInfoText() {
  const context = getPreviewTitleInfoContext();
  const title = String(context?.title || "—") || "—";
  const nodes = collectUniqueTitleMetricNodes(context?.nodes || []);
  if (!nodes.length) return title;
  const scoreSegment = formatTitlePaneScoreSegment(
    getTitlePaneScoreForNodes(nodes),
  );
  if (isViewingTagFolder() && WS.view.tagFolderActiveMode === "storage") {
    const folderCount = nodes.length;
    return `${folderCount} ${folderCount === 1 ? "Folder" : "Folders"} • ${scoreSegment}`;
  }
  const sizeMemo = new Map();
  const folderCountMode =
    String(context?.folderCountMode || "directChildren") === "collection"
      ? "collection"
      : "directChildren";
  let folderCount = folderCountMode === "collection" ? nodes.length : 0;
  let fileCount = 0;
  let sizeBytes = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (folderCountMode !== "collection") {
      folderCount += getDirectFolderCountForNode(node);
    }
    fileCount += getRecursiveFileCountForNode(node);
    sizeBytes += getDirRecursiveSizeBytesForNode(node, sizeMemo);
  }
  return `${formatFolderFileCountSegment(folderCount, fileCount)} • ${formatBytes(sizeBytes)} • ${scoreSegment}`;
}

function getCurrentTitleText() {
  return getPreviewLocationPathText() || "—";
}

// The crumbs before the last are quiet; the last, where you are, is the title.
function titleCrumbsHtml(text) {
  const parts = String(text || "").split(TITLE_PATH_SEPARATOR);
  const last = parts.length - 1;
  return parts
    .map(
      (part, i) =>
        `<span class="${i === last ? "titleCrumb titleCrumbCurrent" : "titleCrumb"}">${escapeHtml(part)}</span>`,
    )
    .join(`<span class="titleCrumbSep" aria-hidden="true">\u203a</span>`);
}

function updateTitleLabel() {
  if (titleLabel) {
    const text = getCurrentTitleText();
    titleLabel.innerHTML = titleCrumbsHtml(text);
    titleLabel.title = text;
  }
  if (titleInfo) titleInfo.textContent = getCurrentTitleInfoText();
}

function syncMetaButtons() {
  syncFavoritesUi();
  syncHiddenUi();
}

const MENU_TAB_IDS = [
  "controls",
];
const MENU_PANEL_BY_TAB = {
  controls: "controls",
  calendar: "calendar",
};
const menuTabButtons = menuTabs
  ? Array.from(menuTabs.querySelectorAll(".menuTabBtn"))
  : [];
const menuTabPanels = {
  controls: menuTabKeybinds,
  calendar: menuTabCalendar,
};
const menuScrollTargets = {
  controls: keybindsBodyEl,
  calendar: calendarBodyEl,
};

function isKeybindMenuTab(tabId) {
  const tab = String(tabId || "");
  return tab === "controls";
}

function saveMenuTabScroll(tab) {
  const target = menuScrollTargets[tab];
  if (!target) return;
  MENU_TAB_SCROLL[tab] = target.scrollTop || 0;
}

function restoreMenuTabScroll(tab) {
  const target = menuScrollTargets[tab];
  if (!target) return;
  const top = MENU_TAB_SCROLL[tab] || 0;
  requestAnimationFrame(() => {
    target.scrollTop = top;
  });
}

function availableMenuTabIds() {
  return MENU_TAB_IDS.filter(
    (tabId) =>
      (scoreInterfaceEnabled() || tabId !== "calendar"),
  );
}

function isMenuTabAvailable(tabId) {
  return availableMenuTabIds().includes(String(tabId || ""));
}

function refreshMenuTabAvailability() {
  const available = new Set(availableMenuTabIds());
  menuTabButtons.forEach((btn) => {
    const tabId = String(btn?.dataset?.tab || "");
    const visible = available.has(tabId);
    btn.hidden = !visible;
    btn.setAttribute("aria-hidden", visible ? "false" : "true");
  });
  if (menuTabCalendar) menuTabCalendar.hidden = !available.has("calendar");
}

function ensureOptionsUi(section) {
  renderOptionsUi(section);
  setOptionsStatus("Saved automatically");
  restoreMenuTabScroll(section);
}

function ensureKeybindsUi(scope = "pane") {
  renderKeybindsUi("pane");
  setKeybindsStatus("Saved automatically");
  restoreMenuTabScroll("controls");
}

function blurElementSoon(el) {
  if (!el || typeof el.blur !== "function") return;
  requestAnimationFrame(() => {
    try {
      el.blur();
    } catch {}
  });
}

function isMenuNonTextControlElement(el) {
  if (!el || !menuOverlay || !menuOverlay.contains(el)) return false;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "BUTTON" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = String(el.type || "").toLowerCase();
  return !(
    type === "text" ||
    type === "search" ||
    type === "url" ||
    type === "email" ||
    type === "number" ||
    type === "tel" ||
    type === "password"
  );
}

function applyMenuTransientFocusBehavior(root = null) {
  const scope = root || menuOverlay;
  if (!scope || !scope.querySelectorAll) return;
  const controls = scope.querySelectorAll("button, select, input");
  controls.forEach((el) => {
    if (!isMenuNonTextControlElement(el)) return;
    el.setAttribute("tabindex", "-1");
    if (el.dataset.menuTransientFocusBound === "1") return;
    el.dataset.menuTransientFocusBound = "1";
    const tag = String(el.tagName || "").toUpperCase();
    const type = String(el.type || "").toLowerCase();
    if (tag === "BUTTON") {
      el.addEventListener("click", () => {
        blurElementSoon(el);
      });
    } else if (tag === "SELECT") {
      el.addEventListener("change", () => {
        blurElementSoon(el);
      });
    } else if (type === "checkbox" || type === "radio") {
      el.addEventListener("change", () => {
        blurElementSoon(el);
      });
    } else if (type === "range") {
      el.addEventListener("change", () => {
        blurElementSoon(el);
      });
      el.addEventListener("pointerup", () => {
        blurElementSoon(el);
      });
    } else {
      el.addEventListener("change", () => {
        blurElementSoon(el);
      });
    }
  });
}

function setMenuTab(tabId) {
  refreshMenuTabAvailability();
  const nextCandidate = isMenuTabAvailable(tabId) ? tabId : "controls";
  const next = nextCandidate;
  if (MENU_ACTIVE_TAB) saveMenuTabScroll(MENU_ACTIVE_TAB);
  if (isKeybindMenuTab(MENU_ACTIVE_TAB) && !isKeybindMenuTab(next))
    KEYBIND_CAPTURE_ACTION_ID = "";
  MENU_ACTIVE_TAB = next;
  MENU_LAST_TAB = next;

  menuTabButtons.forEach((btn) => {
    const active = btn.dataset.tab === next;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.setAttribute("tabindex", "-1");
  });

  const activePanelId = MENU_PANEL_BY_TAB[next] || "controls";
  Object.entries(menuTabPanels).forEach(([id, panel]) => {
    if (!panel) return;
    const active = id === activePanelId;
    panel.classList.toggle("active", active);
    panel.setAttribute("aria-hidden", active ? "false" : "true");
  });

  if (next === "controls") {
    ensureKeybindsUi("pane");
    return;
  }
  if (next === "calendar") {
    renderCalendarUi();
    setCalendarStatus("Saved automatically");
    restoreMenuTabScroll("calendar");
    return;
  }
  ensureOptionsUi(next);
}

function refreshActivePreviewMediaLayout() {
  let opts = null;
  if (arguments.length > 0) {
    const first = arguments[0];
    if (first && typeof first === "object") opts = first;
  }
  const runRefresh = () => {
    if (ACTIVE_MEDIA_SURFACE !== "preview") return;
    const rec =
      WS.preview && WS.preview.kind === "file" && WS.preview.fileId
        ? WS.fileById.get(String(WS.preview.fileId || "")) || null
        : null;
    if (!rec || !previewViewportBox) return;
    if (previewImgEl && previewImgEl.style.display !== "none") {
      const mode = detectScrollImageMode(rec, previewImgEl);
      applyScrollImageMode(
        previewViewportBox,
        previewImgEl,
        mode,
        !!(opts && opts.resetScroll),
      );
      applyScrollImageProcessingFallback(previewImgEl, rec, mode);
    }
    MediaFilterEngine.requestRender();
  };
  if (opts && opts.immediate) {
    if (PREVIEW_MEDIA_LAYOUT_RAF) {
      cancelAnimationFrame(PREVIEW_MEDIA_LAYOUT_RAF);
      PREVIEW_MEDIA_LAYOUT_RAF = 0;
    }
    runRefresh();
    return;
  }
  if (PREVIEW_MEDIA_LAYOUT_RAF) return;
  PREVIEW_MEDIA_LAYOUT_RAF = requestAnimationFrame(() => {
    PREVIEW_MEDIA_LAYOUT_RAF = 0;
    runRefresh();
  });
}

function syncPreviewContentLayoutAfterMenuToggle() {
  if (previewContentEl) previewContentEl.offsetWidth;
  refreshFitInsidePreviewGrids();
  schedulePreviewVirtualGridRefresh();
  scheduleThumbnailDemandRefresh();
  refreshActivePreviewMediaLayout({ immediate: true });
}

// Legacy "open settings" entry point — Settings is gone; open the app menu.
function requestSettingsWindow(_tabId = "controls") {
  toggleSettingsWindow();
  return true;
}
