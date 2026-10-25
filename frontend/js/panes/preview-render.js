/* Preview render
   The placeholder, markdown files and renderPreviewPane. */

let PREVIEW_FILES_RENDER_TOKEN = 0;
function nextPreviewFilesRenderToken() {
  PREVIEW_FILES_RENDER_TOKEN = (PREVIEW_FILES_RENDER_TOKEN + 1) >>> 0;
  return PREVIEW_FILES_RENDER_TOKEN;
}

const HARE_TAG_PREVIEW_INITIAL_TAG_CARDS = 8;
const HARE_TAG_PREVIEW_TAG_CHUNK_SIZE = 16;
const HARE_TAG_PREVIEW_INITIAL_DIR_CARDS = 40;
const HARE_TAG_PREVIEW_DIR_CHUNK_SIZE = 80;

function shouldChunkTagPreviewForHare(dirNode, folderEntries, fileIds) {
  if (tortoiseNavigationEnabled()) return false;
  if (!dirNode || !dirNode._skipTagFilters) return false;
  if (Array.isArray(fileIds) && fileIds.length) return false;
  const entries = Array.isArray(folderEntries) ? folderEntries : [];
  if (!entries.length) return false;
  const hasTagEntry = entries.some((entry) => entry && entry.kind === "tag");
  const threshold = hasTagEntry
    ? HARE_TAG_PREVIEW_INITIAL_TAG_CARDS
    : HARE_TAG_PREVIEW_INITIAL_DIR_CARDS;
  return entries.length > threshold;
}

/* The cards a grid must draw in its first batch, not a later one: the one a
   return is about to select (pending) and the one already selected. A grid is
   often drawn twice on the way back out of a folder -- the first draw uses the
   pending key and clears it, the second only knows the selection -- and a
   selected card left for a later batch is "missing" when the selection is
   checked, which dropped it for the first card of the row in view. */
function previewKeysToDrawFirst() {
  const keys = new Set();
  const pending = String(WS.view?.pendingPreviewSelectionKey || "");
  if (pending) keys.add(pending);
  const selected = String(WS.view?.previewSelectedKey || "");
  if (selected) keys.add(selected);
  return keys;
}

function preferredImmediatePreviewFolderRenderCount(entries, fallbackCount) {
  const baseCount = Math.max(1, Math.floor(Number(fallbackCount) || 1));
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return baseCount;
  const keys = previewKeysToDrawFirst();
  if (!keys.size) return baseCount;
  let last = -1;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (entry && keys.has(entryKeyForSelection(entry))) last = i;
  }
  return last >= 0 ? Math.max(baseCount, last + 1) : baseCount;
}

function renderTagPreviewFolderEntriesInHareChunks(
  dirNode,
  container,
  folderEntries,
  previewDisplayPositions,
  renderToken,
  folderMediaPreviewGrid = false,
) {
  const entries = Array.isArray(folderEntries) ? folderEntries : [];
  const containsTagEntries = entries.some((entry) => entry && entry.kind === "tag");
  const initialLimit = containsTagEntries
    ? HARE_TAG_PREVIEW_INITIAL_TAG_CARDS
    : HARE_TAG_PREVIEW_INITIAL_DIR_CARDS;
  const chunkSize = containsTagEntries
    ? HARE_TAG_PREVIEW_TAG_CHUNK_SIZE
    : HARE_TAG_PREVIEW_DIR_CHUNK_SIZE;
  const gridF = document.createElement("div");
  gridF.className = "gridFolders";
  if (folderMediaPreviewGrid) {
    gridF.classList.add("folderMediaPreviewGrid", "folderContentsPreviewGrid");
    gridF.setAttribute("aria-label", "Folder contents preview folders");
  }
  const useFolderFitInsideJustified = folderPreviewThumbUsesContainMode();
  if (useFolderFitInsideJustified) gridF.classList.add("fitInsideJustified");
  const folderSizeMemo = new Map();
  let index = 0;
  const floatSpacerBefore = makeFloatLayerSpacerGate();
  const guardedChunkSize = () =>
    responsiveNavigationGuardActive()
      ? Math.max(4, Math.floor(chunkSize / 3))
      : chunkSize;

  const appendRange = (endExclusive) => {
    if (renderToken !== PREVIEW_FILES_RENDER_TOKEN) return false;
    const fragF = document.createDocumentFragment();
    const end = Math.min(entries.length, Math.max(index, endExclusive));
    for (; index < end; index++) {
      const entry = entries[index];
      if (floatSpacerBefore(entry)) fragF.appendChild(makePreviewTagSpacer());
      if (!entry) continue;
      if (entry.kind === "tag") {
        fragF.appendChild(makeTagPreviewCard(entry));
        continue;
      }
      fragF.appendChild(
        makeFolderPreviewCard(
          entry.node,
          folderSizeMemo,
          previewDisplayPositions.dirPositions.get(
            String(entry.node?.path || ""),
          ),
        ),
      );
    }
    gridF.appendChild(fragF);
    // A picked thumbnail's crop is written against a guessed shape and put
    // right once the picture loads. The grid's own pass does that only for
    // what is on screen when the grid is swapped in -- the first batch -- so
    // every later batch asks for it here, or those Tag cards keep a wrong crop
    // until the file's shape is known some other way.
    reapplyInlineThumbCropsIn(gridF);
    if (folderMediaPreviewGrid) {
      if (tauriThumbnailsActive()) {
        tauriThumbnailizeContainer(gridF);
      } else {
        upgradeContainerPreviewVideoThumbs(gridF, {
          renderToken,
          passiveWhenHeavy: true,
        });
      }
    }
    return true;
  };

  appendRange(
    preferredImmediatePreviewFolderRenderCount(entries, initialLimit),
  );
  container.appendChild(gridF);
  if (useFolderFitInsideJustified) applyFitInsideJustifiedLayout(gridF);
  else applyPreviewGridTracks(gridF);
  container.appendChild(makeSpacer());

  const appendNextChunk = () => {
    if (renderToken !== PREVIEW_FILES_RENDER_TOKEN) return;
    if (index >= entries.length) {
      if (useFolderFitInsideJustified) applyFitInsideJustifiedLayout(gridF);
      else applyPreviewGridTracks(gridF);
      updatePreviewSelectionClasses();
      scheduleThumbnailDemandRefresh();
      return;
    }
    requestAnimationFrame(() => {
      if (renderToken !== PREVIEW_FILES_RENDER_TOKEN) return;
      if (!gridF.isConnected) return;
      if (!appendRange(index + guardedChunkSize())) return;
      updatePreviewSelectionClasses();
      scheduleThumbnailDemandRefresh();
      appendNextChunk();
    });
  };
  appendNextChunk();

  return {
    folderCount: entries.length,
    fileCount: 0,
    hasContent: true,
  };
}

function tagEntryForPreviewPlaceholderNode(dirNode) {
  if (!dirNode || !dirNode._skipTagFilters) return null;
  const mode = String(dirNode._tagPreviewMode || "").trim().toLowerCase();
  const entry = {
    kind: "tag",
    label: String(dirNode.name || "Tag"),
    originPath: String(dirNode._tagPreviewOriginPath || dirNode.parent?.path || ""),
  };
  if (mode === "favorites" || mode === "hidden" || mode === "untagged") {
    entry.special = mode;
  } else if (mode === "album") {
    entry.album = String(dirNode._tagPreviewAlbum || dirNode.name || "");
  } else if (mode === "gallery") {
    entry.gallery = String(
      dirNode._tagPreviewGallery || dirNode._tagPreviewTag || dirNode.name || "",
    );
  } else {
    entry.tag = String(dirNode._tagPreviewTag || dirNode.name || "");
    entry.album = String(dirNode._tagPreviewAlbum || "");
  }
  return entry;
}

function previewPlaceholderInfoForCurrentSelection() {
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  const selectedThumbRecord = getSelectedThumbnailSourceRecord();
  if (entry && entry.kind === "tag") {
    const originPath = String(entry.originPath || WS.nav?.dirNode?.path || "");
    const tagLocation = [
      originPath ? displayPath(originPath) : "",
      displayTagFolderLabel(String(entry.label || entry.tag || "Tag")),
    ]
      .filter(Boolean)
      .join("/");
    return {
      iconKey: getTagEntryIconKey(entry),
      label: displayTagFolderLabel(String(entry.label || entry.tag || "Tag")),
      meta: tagItemTypeLabelForEntry(entry),
      itemKind: "tag",
      tagEntry: entry,
      thumbnailKind: "tag",
      itemPath: tagLocation,
      thumbnailRecord: selectedThumbRecord || getTagThumbnailReferenceRecord(entry),
    };
  }
  if (entry && entry.kind === "dir") {
    const tagEntry = tagEntryForPreviewPlaceholderNode(entry.node);
    const tagLabel = tagEntry
      ? displayTagFolderLabel(
          String(tagEntry.label || tagEntry.tag || tagEntry.album || "Tag"),
        )
      : "";
    return {
      iconKey: tagEntry
        ? getTagEntryIconKey(tagEntry)
        : iconKeyForDirNode(entry.node),
      label: tagEntry ? tagLabel : dirUiLabel(entry.node) || "Folder",
      meta: tagEntry
        ? tagItemTypeLabelForEntry(tagEntry)
        : folderItemTypeLabelForNode(entry.node),
      itemKind: tagEntry ? "tag" : "dir",
      tagEntry,
      dirNode: entry.node || null,
      thumbnailKind: tagEntry ? "tag" : folderThumbnailKindForNode(entry.node),
      itemPath: displayPath(String(entry.node?.path || "")),
      thumbnailRecord:
        selectedThumbRecord || previewPlaceholderThumbnailRecordForDirNode(entry.node),
    };
  }
  if (WS.preview.kind === "dir" && WS.preview.dirNode) {
    const dirNode = WS.preview.dirNode;
    const tagEntry = tagEntryForPreviewPlaceholderNode(dirNode);
    const tagLabel = tagEntry
      ? displayTagFolderLabel(
          String(tagEntry.label || tagEntry.tag || tagEntry.album || "Tag"),
        )
      : "";
    return {
      iconKey: tagEntry ? getTagEntryIconKey(tagEntry) : iconKeyForDirNode(dirNode),
      label: tagEntry ? tagLabel : dirUiLabel(dirNode) || "Folder",
      meta: tagEntry
        ? tagItemTypeLabelForEntry(tagEntry)
        : folderItemTypeLabelForNode(dirNode),
      itemKind: tagEntry ? "tag" : "dir",
      tagEntry,
      dirNode,
      thumbnailKind: tagEntry ? "tag" : folderThumbnailKindForNode(dirNode),
      itemPath: displayPath(String(dirNode.path || "")),
      thumbnailRecord:
        selectedThumbRecord || previewPlaceholderThumbnailRecordForDirNode(dirNode),
    };
  }
  return {
    iconKey: "noItem",
    label: "No item selected",
    meta: "",
    thumbnailRecord: null,
  };
}

function previewPlaceholderVisibilityKind(src) {
  const raw = String((src && src.thumbnailKind) || "");
  if (!raw) return "";
  return thumbnailVisibilityKindSpec(raw).kind || "";
}

function previewPlaceholderTitleVisible(src) {
  const kind = previewPlaceholderVisibilityKind(src);
  return kind ? previewThumbnailVisibilityForKind(kind).showTitle : true;
}

function previewPlaceholderSourcePathText(src, thumbRec) {
  const itemPath = String((src && src.itemPath) || "");
  if (itemPath) return itemPath;
  const rec = thumbRec || (src && src.thumbnailRecord) || null;
  if (!rec) return "";
  const rel = relPathDisplayName(rec.relPath || rec.name || "");
  return rel || String(rec.nativePath || rec.relPath || rec.name || "");
}

function previewPlaceholderRegularMetaText(src) {
  const kind = previewPlaceholderVisibilityKind(src);
  if (!kind) return String((src && src.meta) || "");
  const visibility = previewThumbnailVisibilityForKind(kind);
  const parts = [];

  if (kind === "tag" && src && src.tagEntry) {
    const entry = src.tagEntry;
    const metrics = getTagEntryAggregateMetrics(entry, new Map());
    parts.push(tagItemTypeLabelForEntry(entry));
    parts.push(
      formatFolderFileCountSegment(metrics.folderCount, metrics.fileCount),
    );
    parts.push(formatBytes(metrics.sizeBytes));
    return parts.join(" • ");
  }

  if ((kind === "rootFolder" || kind === "subfolder") && src && src.dirNode) {
    const dirNode = src.dirNode;
    parts.push(folderItemTypeLabelForNode(dirNode));
    const folderCount = getDirectFolderCountForNode(dirNode);
    const fileCount = getRecursiveFileCountForNode(dirNode);
    parts.push(formatFolderFileCountSegment(folderCount, fileCount));
    parts.push(formatBytes(getDirRecursiveSizeBytesForNode(dirNode, new Map())));
    return parts.join(" • ");
  }

  if (kind === "file") {
    const rec = (src && (src.fileRecord || src.thumbnailRecord)) || null;
    if (visibility.showItemTypeLabel) parts.push(fileItemTypeLabelForRecord(rec));
    if (visibility.showItemCount) parts.push("1 item");
    if (visibility.showSize)
      parts.push(formatBytes(Math.max(0, Number(rec?.size) || 0)));
    return parts.join(" • ");
  }

  return "";
}

const PREVIEW_PLACEHOLDER_PRELOAD_CACHE = new Map();
let PREVIEW_PLACEHOLDER_RESIZE_OBSERVER = null;
let PREVIEW_PLACEHOLDER_RESIZE_TARGET = null;

function syncPreviewPlaceholderSquareSize(wrap) {
  if (!wrap) return;
  const update = () => {
    if (!wrap.isConnected) return;
    const w = Math.max(0, Number(wrap.clientWidth) || 0);
    const h = Math.max(0, Number(wrap.clientHeight) || 0);
    const size = Math.max(1, Math.floor(Math.min(w || h || 1, h || w || 1)));
    wrap.style.setProperty("--preview-placeholder-square-size", `${size}px`);
  };
  update();
  requestAnimationFrame(update);
  if (typeof ResizeObserver === "function" && PREVIEW_PLACEHOLDER_RESIZE_TARGET !== wrap) {
    try {
      if (PREVIEW_PLACEHOLDER_RESIZE_OBSERVER) PREVIEW_PLACEHOLDER_RESIZE_OBSERVER.disconnect();
      PREVIEW_PLACEHOLDER_RESIZE_OBSERVER = new ResizeObserver(update);
      PREVIEW_PLACEHOLDER_RESIZE_OBSERVER.observe(wrap);
      PREVIEW_PLACEHOLDER_RESIZE_TARGET = wrap;
    } catch {}
  }
}

function renderPreviewPlaceholder(info = null) {
  const src = info && typeof info === "object" ? info : previewPlaceholderInfoForCurrentSelection();
  setPreviewBodyMode("placeholder");
  if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
  MediaFilterEngine.detach("preview");
  if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
  if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");

  const thumbRec = src.thumbnailRecord || null;
  const thumbSrc = previewPlaceholderThumbSrcForRecord(thumbRec);
  const thumbId = String(thumbRec && thumbRec.id ? thumbRec.id : "");
  const labelText = String(src.label || "—");
  const showTitle = previewPlaceholderTitleVisible(src);
  const regularMetaText = previewPlaceholderRegularMetaText(src);
  const sourcePathText = regularMetaText
    ? previewPlaceholderSourcePathText(src, thumbRec)
    : "";

  const makeIcon = () => {
    const icon = document.createElement("div");
    icon.className = "previewItemPlaceholderIcon";
    icon.setAttribute("aria-hidden", "true");
    setAppIcon(icon, src.iconKey || "noItem");
    return icon;
  };

  const makeLabel = () => {
    const label = document.createElement("div");
    label.className = "previewItemPlaceholderLabel";
    label.textContent = labelText;
    label.title = labelText;
    return label;
  };

  const applyPlaceholderCropStyle = (img) => {
    if (!img) return;
    img.classList.remove("thumbCropApplied", "thumbCropAbsolute");
    img.style.removeProperty("width");
    img.style.removeProperty("height");
    img.style.removeProperty("left");
    img.style.removeProperty("top");
    const cropStyle = fileThumbCropLayoutStyle(thumbRec, "");
    if (cropStyle) {
      img.classList.add("thumbCropApplied", "thumbCropAbsolute");
      img.style.cssText += cropStyle;
      attachFileThumbCropAspectReapply(img, thumbRec);
    }
  };

  if (!thumbSrc) {
    releaseContainerThumbMedia(previewBodyEl);
    previewBodyEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "previewItemPlaceholder noThumbnail";
    wrap.appendChild(makeIcon());
    wrap.appendChild(makeLabel());
    if (regularMetaText) {
      const meta = document.createElement("div");
      meta.className = "previewItemPlaceholderMeta";
      meta.textContent = String(regularMetaText || "");
      wrap.appendChild(meta);
    }
    previewBodyEl.appendChild(wrap);
    if (itemsPill) itemsPill.textContent = src.label ? "Items: 1" : "Items: —";
    clearPreviewSelectionState(currentPreviewSelectionContextKeyFromState());
    updatePreviewSelectionClasses();
    scheduleThumbnailDemandRefresh();
    return;
  }

  let wrap = previewBodyEl.firstElementChild;
  const canReuse = !!(wrap && wrap.classList && wrap.classList.contains("previewItemPlaceholder"));
  if (!canReuse || !wrap.classList.contains("hasThumbnail")) {
    releaseContainerThumbMedia(previewBodyEl);
    previewBodyEl.innerHTML = "";
    wrap = document.createElement("div");
    wrap.className = "previewItemPlaceholder hasThumbnail";
    previewBodyEl.appendChild(wrap);
  }
  wrap.classList.add("hasThumbnail");
  wrap.classList.remove("noThumbnail");

  syncPreviewPlaceholderSquareSize(wrap);

  let art = wrap.querySelector(".previewItemPlaceholderArtwork");
  if (!art) {
    art = document.createElement("div");
    art.className = "previewItemPlaceholderArtwork";
    wrap.appendChild(art);
  }

  let infoBar = art.querySelector(".previewItemPlaceholderInfoBar");
  if (!infoBar) {
    infoBar = document.createElement("div");
    infoBar.className = "previewItemPlaceholderInfoBar";
    art.appendChild(infoBar);
  }
  infoBar.innerHTML = "";
  if (showTitle || sourcePathText) {
    const textBlock = document.createElement("div");
    textBlock.className = "previewItemPlaceholderTextBlock";
    if (showTitle) textBlock.appendChild(makeLabel());
    if (sourcePathText) {
      const pathMeta = document.createElement("div");
      pathMeta.className =
        "previewItemPlaceholderMeta previewItemPlaceholderPathMeta";
      pathMeta.textContent = sourcePathText;
      pathMeta.title = sourcePathText;
      textBlock.appendChild(pathMeta);
    }
    infoBar.appendChild(textBlock);
  }
  if (regularMetaText) {
    const regularMeta = document.createElement("div");
    regularMeta.className =
      "previewItemPlaceholderMeta previewItemPlaceholderRegularMeta";
    regularMeta.textContent = regularMetaText;
    regularMeta.title = regularMetaText;
    infoBar.appendChild(regularMeta);
  }
  infoBar.hidden = !infoBar.childNodes.length;
  infoBar.title = [showTitle ? labelText : "", sourcePathText, regularMetaText]
    .filter(Boolean)
    .join(" • ");
  forcePreviewPaneThumbTitleBar(infoBar);

  const imgs = Array.from(art.querySelectorAll(".previewItemPlaceholderThumb"));
  let img = imgs[0] || null;
  if (!img) {
    img = document.createElement("img");
    img.className = "previewItemPlaceholderThumb ready";
    img.alt = "";
    img.draggable = false;
    img.decoding = "sync";
    img.loading = "eager";
    try { img.fetchPriority = "high"; } catch {}
    art.insertBefore(img, infoBar);
  }
  for (let i = 1; i < imgs.length; i++) {
    try { imgs[i].parentElement && imgs[i].parentElement.removeChild(imgs[i]); } catch {}
  }
  img.classList.remove("entering", "leaving");
  img.classList.add("ready");
  img.dataset.placeholderThumbSrc = String(thumbSrc || "");
  img.dataset.placeholderThumbId = thumbId;
  img.dataset.placeholderCurrent = "1";
  if (thumbId) img.dataset.dirPreviewId = thumbId;
  else img.removeAttribute("data-dir-preview-id");
  applyPlaceholderCropStyle(img);
  if (String(img.getAttribute("src") || "") !== String(thumbSrc || "")) {
    preloadPreviewPlaceholderThumbSrc(thumbSrc);
    img.src = thumbSrc;
  }
  warmPreviewPlaceholderNeighborThumbs();

  if (infoBar.parentElement !== art) art.appendChild(infoBar);
  if (itemsPill) itemsPill.textContent = src.label ? "Items: 1" : "Items: —";
  clearPreviewSelectionState(currentPreviewSelectionContextKeyFromState());
  updatePreviewSelectionClasses();
  scheduleThumbnailDemandRefresh();
}

// Render a Markdown record into the preview pane: read-only, scrollable, and
// formatted (no raw markdown syntax shown). Fills asynchronously and bails if
// the preview target changes while the file is being read.
async function renderMarkdownPreview(rec, keepScroll, prevScroll) {
  const targetId = String(rec && rec.id ? rec.id : "");
  releaseContainerThumbMedia(previewBodyEl);
  previewBodyEl.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "mdPreview";
  const article = document.createElement("div");
  article.className = "mdPreviewBody markdownBody";
  article.textContent = "Loading…";
  wrap.appendChild(article);
  previewBodyEl.appendChild(wrap);
  if (keepScroll) previewBodyEl.scrollTop = prevScroll || 0;

  let text = null;
  try {
    if (!rec.file && typeof ensureFileObjectForRecord === "function") {
      await ensureFileObjectForRecord(rec);
    }
    if (rec.file && typeof rec.file.text === "function") {
      text = await rec.file.text();
    } else {
      const url = ensureMediaUrl(rec);
      if (url) text = await (await fetch(url)).text();
    }
  } catch (e) {
    text = null;
  }

  // The preview may have moved on (navigation) while we were reading.
  if (
    !WS.preview ||
    WS.preview.kind !== "file" ||
    String(WS.preview.fileId || "") !== targetId ||
    previewBodyEl.firstChild !== wrap
  ) {
    return;
  }

  if (text == null) {
    article.innerHTML = "";
    article.classList.add("mdPreviewError");
    article.textContent = "Could not read this Markdown file.";
    return;
  }
  article.classList.remove("mdPreviewError");
  article.innerHTML = renderMarkdownToHtml(text);
}

// Minimal, safe Markdown -> HTML. Escapes all input first (read-only viewer,
// never injects raw HTML), then applies block + inline formatting.
function renderMarkdownToHtml(src) {
  const escHtml = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const linkHtml = (url, label) => {
    const safe = /^(https?:|mailto:)/i.test(url) || /^[^:]*$/.test(url) ? url : "#";
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  };

  // Inline formatting; operates on already-escaped text.
  const inline = (s) => {
    let t = s;
    const codes = [];
    t = t.replace(/`([^`]+)`/g, (m, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt, url) =>
      linkHtml(url, alt || url),
    );
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, txt, url) =>
      linkHtml(url, txt),
    );
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
    t = t.replace(/(^|[^_])_([^_\s][^_]*?)_/g, "$1<em>$2</em>");
    t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    t = t.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
    return t;
  };

  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let listType = null;
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```/);
    if (fence) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code>${escHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      closeList();
      out.push("<hr>");
      i++;
      continue;
    }
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(escHtml(h[2].trim()))}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(escHtml(buf.join(" ")))}</blockquote>`);
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inline(escHtml(ul[1]))}</li>`);
      i++;
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inline(escHtml(ol[1]))}</li>`);
      i++;
      continue;
    }
    closeList();
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```)/.test(lines[i]) &&
      !/^\s*([-*_])\s*(\1\s*){2,}$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(escHtml(buf.join("\n"))).replace(/\n/g, "<br>")}</p>`);
  }
  closeList();
  return out.join("\n");
}

function renderPreviewPane(animate = false, keepScroll = false) {
  syncMediaZoomForCurrentTarget();
  clearPreviewFileVirtualizers();
  syncThumbFilterKeyWithCurrentAppearanceContext();
  const previewRenderToken = nextPreviewFilesRenderToken();
  savePreviewScrollForActiveDir();
  const prevScroll = keepScroll ? previewBodyEl.scrollTop : 0;

  if (!WS.root || !WS.nav.dirNode) {
    WS.view.previewScrollActiveKey = "";
    updateModePill();
    if (previewBodyEl) {
      releaseContainerThumbMedia(previewBodyEl);
      previewBodyEl.innerHTML = "";
    }
    return;
  }

  if (isGridInteractionMode()) {
    WS.view.previewScrollActiveKey = "";
    updateModePill();
    renderPreviewPlaceholder();
    return;
  }

  if (compactPreviewSearchActive()) {
    updateModePill();
    setPreviewBodyMode("grid");
    if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
    MediaFilterEngine.detach("preview");
    if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
    if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");

    releaseContainerThumbMedia(previewBodyEl);
    previewBodyEl.innerHTML = "";
    const searchRender = renderPreviewSearchResults(previewBodyEl);
    WS.view.previewScrollActiveKey = "";
    if (itemsPill) itemsPill.textContent = `Items: ${searchRender.count}`;
    const searchContextKey = `search:${String(WS.view.searchRootPath || "")}:${String(
      WS.view.dirSearchQuery || "",
    )
      .trim()
      .toLowerCase()}`;
    const resultKeys = (WS.view.searchResults || [])
      .map((node) => `dir:${String(node?.path || "")}`)
      .filter((key) => key !== "dir:");
    let selectedKey = "";
    const pendingKey = String(WS.view.pendingPreviewSelectionKey || "");
    if (pendingKey && resultKeys.includes(pendingKey)) {
      selectedKey = pendingKey;
    } else if (
      String(WS.view.previewSelectionContextKey || "") === searchContextKey
    ) {
      const activeKey = String(WS.view.previewSelectedKey || "");
      if (resultKeys.includes(activeKey)) selectedKey = activeKey;
    }
    if (!selectedKey) selectedKey = resultKeys[0] || "";
    WS.view.pendingPreviewSelectionKey = "";
    WS.view.previewSelectionContextKey = searchContextKey;
    WS.view.previewSelectAnchorKey = selectedKey;
    WS.view.previewSelectedKey = selectedKey;
    updatePreviewSelectionClasses();
    if (selectedKey)
      revealPreviewCard(findPreviewSelectableCardByKey(selectedKey));
    scheduleThumbnailDemandRefresh();
    return;
  }

  updateModePill();
  if (WS.preview.kind === "file" && WS.preview.fileId && itemsPill)
    itemsPill.textContent = "Items: 1";

  if (WS.preview.kind === "file" && WS.preview.fileId) {
    setPreviewBodyMode("file");
    const rec = WS.fileById.get(WS.preview.fileId);
    if (!rec) {
      releaseContainerThumbMedia(previewBodyEl);
      previewBodyEl.innerHTML = "";
      previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">File not found.</div>`;
      MediaFilterEngine.detach("preview");
      if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
      if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
      scheduleThumbnailDemandRefresh();
      return;
    }

    // Markdown files render as scrolled, read-only formatted text instead of the
    // image/video viewer pipeline.
    if (rec.type === "markdown" || isMarkdownName(rec.name)) {
      ACTIVE_MEDIA_SURFACE = "none";
      MediaFilterEngine.detach("preview");
      if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
      if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
      renderMarkdownPreview(rec, keepScroll, prevScroll);
      WS.view.previewScrollActiveKey = "";
      ensurePreviewSelectionForCurrentTarget(false);
      scheduleThumbnailDemandRefresh();
      return;
    }

    if (!previewFileIdVisibleInContext(rec.id, WS.preview.dirNode || WS.nav.dirNode || null)) {
      const fallbackState = firstVisibleFilePreviewStateForContext(
        WS.preview.dirNode || WS.nav.dirNode || null,
      );
      if (fallbackState && fallbackState.fileId && String(fallbackState.fileId) !== String(rec.id || "")) {
        applyPreviewState(fallbackState);
        renderPreviewPane(animate, keepScroll);
        return;
      }
      WS.view.previewScrollActiveKey = "";
      renderPreviewPlaceholder({
        iconKey: "noItem",
        label: "No visible file",
        meta: "The previous preview item is hidden by the current filters.",
      });
      return;
    }

    ensurePreviewFileElements();

    const previewViewportWasAttached = !!(
      previewBodyEl.firstChild === previewViewportBox &&
      previewBodyEl.childNodes.length === 1
    );
    if (!previewViewportWasAttached) seedPreviewViewportWithRecordHint(rec);

    if (
      previewBodyEl.firstChild !== previewViewportBox ||
      previewBodyEl.childNodes.length !== 1
    ) {
      releaseContainerThumbMedia(previewBodyEl);
      previewBodyEl.innerHTML = "";
      previewBodyEl.appendChild(previewViewportBox);
    }

    if (!ensureViewerFromPreviewFileId(rec.id)) {
      const fallbackState = firstVisibleFilePreviewStateForContext(
        WS.preview.dirNode || WS.nav.dirNode || null,
      );
      if (fallbackState && fallbackState.fileId) {
        applyPreviewState(fallbackState);
        renderPreviewPane(animate, keepScroll);
        return;
      }
      WS.view.previewScrollActiveKey = "";
      renderPreviewPlaceholder({
        iconKey: "noItem",
        label: "No visible file",
        meta: "No file is available for the current filters.",
      });
      return;
    }
    normalizeViewerStateForCurrentFilters(rec.id);
    if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "preview";
    renderPreviewViewerItem(viewerIndex);

    if (keepScroll) previewBodyEl.scrollTop = prevScroll;
    ensurePreviewSelectionForCurrentTarget(false);
    scheduleThumbnailDemandRefresh();
    return;
  }

  if (WS.preview.kind === "dir" && WS.preview.dirNode) {
    if (
      renderSelectedFolderMediaPreview(
        WS.preview.dirNode,
        animate,
        keepScroll,
        prevScroll,
        previewRenderToken,
      )
    ) {
      return;
    }
  }

  WS.view.previewScrollActiveKey = "";
  renderPreviewPlaceholder();
}

previewBodyEl.addEventListener("scroll", () => {
  savePreviewScrollForActiveDir();
  schedulePreviewVirtualGridRefresh();
  scheduleDeferredPreviewVideoThumbUpgrade(120);
  scheduleThumbnailDemandRefresh();
});

// Right-click opens no menu anywhere now: every action lives in the
// keyboard-driven app menu. Just suppress the native context menu over the
// preview surface — except inside a real text input, which is where the inline
// rename and tag fields are drawn. That menu is the only way to take a spelling
// suggestion or to paste, and this handler stops propagation, so without the
// exemption the document-level one below never gets its say.
previewBodyEl.addEventListener("contextmenu", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (target && target.closest && target.closest('input, textarea, [contenteditable="true"]'))
    return;
  e.preventDefault();
  e.stopPropagation();
});

// App-wide: right-click never opens a menu. Suppress the native context menu on
// the app's own chrome, but leave real text inputs and the Settings window
// (which keeps full cursor interaction) alone so native copy/paste still works
// there.
document.addEventListener("contextmenu", (e) => {
  if (e.defaultPrevented) return;
  const target = e.target instanceof Element ? e.target : null;
  if (target && target.closest) {
    if (target.closest("input, textarea, select, [contenteditable=\"true\"]"))
      return;
    if (target.closest("#menuOverlay")) return;
  }
  e.preventDefault();
});
