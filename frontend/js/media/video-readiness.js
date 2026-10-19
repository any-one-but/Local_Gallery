/* Video readiness
   Preview file ids and waiting for a video to be ready. */

/* =========================================================
       Video thumbnails (lazy, low quality) for Preview Pane
       ========================================================= */

function getPreviewFileIdsForDir(dirNode, includeChildren = false) {
  dirNode = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!dirNode) return [];
  if (
    !includeChildren &&
    previewUsesCurrentViewEntries(dirNode, { useCurrentViewEntries: true })
  ) {
    return getPreviewFolderAndFileEntries(dirNode, {
      includeFiles: true,
      useCurrentViewEntries: true,
    }).fileIds;
  }
  applySessionFileOrderForDir(dirNode);
  let ids = dirNode.childrenFiles.slice();
  if (!dirNode.preserveOrder)
    ids.sort((a, b) =>
      compareIndexedNames(
        WS.fileById.get(a)?.name || "",
        WS.fileById.get(b)?.name || "",
      ),
    );
  ids = randomOrderFileIds(dirNode, ids);
  const contextualTagFilter = contextualTagMediaFilterForDirPath(
    String(dirNode.path || ""),
  );
  const out = ids.filter((id) => {
    const rec = WS.fileById.get(id);
    if (!passesFilter(rec)) return false;
    return (
      !contextualTagFilter.length ||
      recordPassesTagMediaFilter(rec, contextualTagFilter)
    );
  });

  if (!includeChildren) return out;

  for (const child of getChildDirsForNode(dirNode)) {
    const childIds = getPreviewFileIdsForDir(child, false);
    for (const id of childIds) out.push(id);
  }

  return out;
}

function getRenderedPreviewFileIds(limit = 96) {
  if (!previewBodyEl) return [];
  const out = [];
  const seen = new Set();
  const cards = previewBodyEl.querySelectorAll(".fileCard[data-file-id]");
  for (let i = 0; i < cards.length; i++) {
    const id = String(cards[i]?.dataset?.fileId || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

async function waitForVideoLoadedData(videoEl, timeoutMs = 1500) {
  if (!videoEl) return;
  if (
    videoEl.readyState >= 2 &&
    (videoEl.videoWidth || 0) > 0 &&
    (videoEl.videoHeight || 0) > 0
  )
    return;
  await new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      videoEl.removeEventListener("loadeddata", onReady);
      videoEl.removeEventListener("canplay", onReady);
      resolve();
    };
    const onReady = () => {
      if (
        videoEl.readyState >= 2 &&
        (videoEl.videoWidth || 0) > 0 &&
        (videoEl.videoHeight || 0) > 0
      )
        finish();
    };
    videoEl.addEventListener("loadeddata", onReady);
    videoEl.addEventListener("canplay", onReady);
    timer = setTimeout(finish, Math.max(300, timeoutMs | 0));
    onReady();
  });
}

async function waitForVideoMetadata(videoEl, timeoutMs = 2500) {
  if (!videoEl) return;
  if (
    videoEl.readyState >= 1 &&
    Number(videoEl.videoWidth || 0) > 0 &&
    Number(videoEl.videoHeight || 0) > 0
  )
    return;
  await new Promise((resolve, reject) => {
    let done = false;
    let timer = 0;
    const finish = (err = null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try {
        videoEl.removeEventListener("loadedmetadata", onMeta);
      } catch {}
      try {
        videoEl.removeEventListener("error", onErr);
      } catch {}
      if (err) reject(err);
      else resolve();
    };
    const onMeta = () => finish();
    const onErr = () => finish(new Error("video load failed"));
    try {
      videoEl.addEventListener("loadedmetadata", onMeta);
    } catch {}
    try {
      videoEl.addEventListener("error", onErr);
    } catch {}
    timer = setTimeout(
      () => finish(new Error("video metadata timeout")),
      Math.max(400, timeoutMs | 0),
    );
  });
}

async function waitForVideoFrameReady(videoEl, timeoutMs = 1200) {
  if (!videoEl) return;
  await new Promise((resolve) => {
    let done = false;
    let timer = 0;
    let pollTimer = 0;
    let frameHandle = 0;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      if (
        typeof videoEl.cancelVideoFrameCallback === "function" &&
        frameHandle
      ) {
        try {
          videoEl.cancelVideoFrameCallback(frameHandle);
        } catch {}
      }
      videoEl.removeEventListener("loadeddata", onReadySignal);
      videoEl.removeEventListener("canplay", onReadySignal);
      videoEl.removeEventListener("canplaythrough", onReadySignal);
      resolve();
    };
    const onReadySignal = () => {
      if (
        videoEl.readyState >= 2 &&
        (videoEl.videoWidth || 0) > 0 &&
        (videoEl.videoHeight || 0) > 0
      )
        finish();
    };
    videoEl.addEventListener("loadeddata", onReadySignal);
    videoEl.addEventListener("canplay", onReadySignal);
    videoEl.addEventListener("canplaythrough", onReadySignal);
    if (typeof videoEl.requestVideoFrameCallback === "function") {
      try {
        frameHandle = videoEl.requestVideoFrameCallback(() => finish());
      } catch {}
    }
    pollTimer = setInterval(onReadySignal, 50);
    timer = setTimeout(finish, Math.max(250, timeoutMs | 0));
    onReadySignal();
  });
}

function isVideoFrameLikelyBlank(videoEl) {
  const srcW = Number(videoEl?.videoWidth || 0);
  const srcH = Number(videoEl?.videoHeight || 0);
  if (!(srcW > 0 && srcH > 0)) return true;
  const maxSide = 96;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(16, Math.round(srcW * scale));
  const h = Math.max(16, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  try {
    ctx.drawImage(videoEl, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let lumaSum = 0;
    let brightCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumaSum += luma;
      if (Math.max(r, g, b) >= 26) brightCount++;
    }
    const px = Math.max(1, w * h);
    const avgLuma = lumaSum / px;
    const brightRatio = brightCount / px;
    return avgLuma < 12 || brightRatio < 0.015;
  } catch {
    return false;
  }
}
