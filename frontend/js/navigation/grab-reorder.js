/* Grab to reorder
   Grab, and the folder keys' column-edge jumps. */

// ---------------------------------------------------------------------------
// Grab-to-reorder: a keyboard-only port of the drag-drop file rearrange. The
// bindable `grabReorderItem` action lifts the selected grid file; while lifted,
// the ordinary selection keys move the file itself (nearest file neighbour in
// that direction, via the same 2D scoring the cursor uses) instead of moving
// the cursor. It reuses reorderFilesInDir -- the exact primitive the mouse drag
// commits -- so ordering, persistence and the reorder guards stay identical.
// ---------------------------------------------------------------------------
let GRAB_REORDER_STATE = null;

function grabReorderDirectionForAction(action) {
  if (action === "selectUp") return "up";
  if (action === "selectDown") return "down";
  if (action === "selectLeft") return "left";
  if (action === "selectRight") return "right";
  return "";
}

function clearGrabbedPreviewCardVisual() {
  if (!previewBodyEl) return;
  previewBodyEl
    .querySelectorAll(".previewCardGrabbed")
    .forEach((el) => el.classList.remove("previewCardGrabbed"));
}

function markGrabbedPreviewCard() {
  clearGrabbedPreviewCardVisual();
  if (!GRAB_REORDER_STATE || !previewBodyEl) return;
  const cards = getPreviewSelectableCards();
  for (let i = 0; i < cards.length; i++) {
    if (
      String(previewFileIdForCard(cards[i]) || "") === GRAB_REORDER_STATE.fileId
    ) {
      cards[i].classList.add("previewCardGrabbed");
      break;
    }
  }
}

function dropGrabReorder(announce = false) {
  if (!GRAB_REORDER_STATE) return false;
  GRAB_REORDER_STATE = null;
  clearGrabbedPreviewCardVisual();
  if (announce) showStatusMessage("Set down.");
  return true;
}

function startGrabReorder() {
  if (!WS.root || VIEWER_MODE) return false;
  if (WS.preview.kind === "file" && WS.preview.fileId)
    return startOpenFileGrabReorder();
  const previewActive =
    !directoriesPaneOpenEnabled() || WS.view.activePane === "preview";
  if (!previewActive) {
    showStatusMessage("Select a file in the grid to grab.");
    return false;
  }
  const card = findSelectedPreviewCard();
  if (!card || String(card.dataset?.previewItemKind || "") !== "file") {
    showStatusMessage("Select a file to grab.");
    return false;
  }
  const fileId = String(previewFileIdForCard(card) || "");
  const dirNode = getPreviewTargetDir();
  if (!fileId || !dirNode || !canReorderFilesInDir(dirNode)) {
    showStatusMessage("These files can't be reordered here.");
    return false;
  }
  GRAB_REORDER_STATE = { fileId, dirPath: String(dirNode.path || "") };
  markGrabbedPreviewCard();
  showStatusMessage("Grabbed — selection keys move it, grab key or Esc sets it down.");
  return true;
}

/* Grab on an open file. With quick navigation on (the default) a Set's files
   are only ever seen one at a time, so a grid-only grab could never be used.
   On an open file the selection keys move it one place earlier (left / up) or
   later (right / down) in its Set; the picture does not change, so a message
   gives the new position. It works only when the file is seen from its own
   folder, the list the viewer steps through, so "earlier" means what the
   next/previous keys will show. */
function openFileGrabContext(fileId) {
  const rec = WS.fileById.get(String(fileId || ""));
  const dirNode = getPreviewTargetDir();
  if (!rec || !dirNode) return null;
  if (String(dirNode.path || "") !== String(rec.dirPath || "")) return null;
  if (dirNode._skipTagFilters || !canReorderFilesInDir(dirNode)) return null;
  const ids = getPreviewFileIdsForDir(dirNode, false).map((id) => String(id || ""));
  if (ids.indexOf(String(rec.id || "")) < 0) return null;
  return { dirNode, ids };
}

function startOpenFileGrabReorder() {
  const fileId = String(WS.preview.fileId || "");
  const ctx = openFileGrabContext(fileId);
  if (!ctx) {
    showStatusMessage("Open this file from its own set to move it.");
    return false;
  }
  if (ctx.ids.length < 2) {
    showStatusMessage("This is the only file here.");
    return false;
  }
  GRAB_REORDER_STATE = {
    fileId,
    dirPath: String(ctx.dirNode.path || ""),
    open: true,
  };
  showStatusMessage(
    `Grabbed — ${ctx.ids.indexOf(fileId) + 1} of ${ctx.ids.length}. Selection keys move it, grab key or Esc sets it down.`,
  );
  return true;
}

function moveGrabbedOpenFile(direction) {
  const st = GRAB_REORDER_STATE;
  // Another file on screen means the grab is about something no longer shown.
  if (WS.preview.kind !== "file" || String(WS.preview.fileId || "") !== st.fileId) {
    dropGrabReorder(false);
    return false;
  }
  const ctx = openFileGrabContext(st.fileId);
  if (!ctx || String(ctx.dirNode.path || "") !== st.dirPath) {
    dropGrabReorder(false);
    return false;
  }
  const count = ctx.ids.length;
  const index = ctx.ids.indexOf(st.fileId);
  const later = direction === "right" || direction === "down";
  const targetIndex = later ? index + 1 : index - 1;
  if (targetIndex < 0 || targetIndex >= count) {
    showStatusMessage(later ? `Already last (${count} of ${count}).` : `Already first (1 of ${count}).`);
    return false;
  }
  if (
    !reorderFilesInDir(ctx.dirNode, st.fileId, ctx.ids[targetIndex], later, {
      visibleIds: ctx.ids,
    })
  )
    return false;
  syncAfterDirOrderChange(null, {
    preserveSelection: true,
    preservePreviewTarget: true,
    renderPreview: false,
  });
  showStatusMessage(`Moved to ${targetIndex + 1} of ${count}.`);
  return true;
}

function toggleGrabReorderKeybindAction() {
  if (GRAB_REORDER_STATE) return dropGrabReorder(true);
  return startGrabReorder();
}

function moveGrabbedPreviewFile(direction) {
  const st = GRAB_REORDER_STATE;
  if (!st || !direction) return false;
  if (st.open) return moveGrabbedOpenFile(direction);
  const dirNode = getPreviewTargetDir();
  // Context changed underneath the grab (folder switch, etc.): drop it rather
  // than reorder the wrong folder.
  if (!dirNode || String(dirNode.path || "") !== st.dirPath) {
    dropGrabReorder(false);
    return false;
  }
  if (!canReorderFilesInDir(dirNode)) {
    dropGrabReorder(false);
    return false;
  }
  const metrics = getPreviewSelectableCardMetrics();
  if (!metrics.length) return false;
  const selected =
    metrics.find(
      (m) => String(previewFileIdForCard(m.card) || "") === st.fileId,
    ) || metrics.find((m) => m.card === findSelectedPreviewCard());
  if (!selected) return false;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    if (!m || m.card === selected.card) continue;
    if (String(m.card.dataset?.previewItemKind || "") !== "file") continue;
    const dx = m.cx - selected.cx;
    const dy = m.cy - selected.cy;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let primary = 0;
    let secondary = 0;
    let valid = false;
    if (direction === "up" && dy < -2) {
      valid = true;
      primary = -dy;
      secondary = ax;
    } else if (direction === "down" && dy > 2) {
      valid = true;
      primary = dy;
      secondary = ax;
    } else if (direction === "left" && dx < -2) {
      valid = true;
      primary = -dx;
      secondary = ay;
    } else if (direction === "right" && dx > 2) {
      valid = true;
      primary = dx;
      secondary = ay;
    }
    if (!valid) continue;
    const score = primary * 1000 + secondary;
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  if (!best) return false;

  const targetId = String(previewFileIdForCard(best.card) || "");
  if (!targetId || targetId === st.fileId) return false;
  const ids = getPreviewFolderAndFileEntries(dirNode, {
    includeFiles: true,
    useCurrentViewEntries: true,
  }).fileIds;
  const grabIdx = ids.indexOf(st.fileId);
  const targIdx = ids.indexOf(targetId);
  if (grabIdx < 0 || targIdx < 0) return false;
  const placeAfter = targIdx > grabIdx;
  if (
    !reorderFilesInDir(dirNode, st.fileId, targetId, placeAfter, {
      visibleIds: ids,
    })
  )
    return false;

  // Keep the moved file selected so the cursor rides along. Update the order
  // and file-pane state WITHOUT letting syncAfterDirOrderChange run its own
  // animated preview render (renderPreview:false) -- exactly like the mouse
  // drop path. That animated staged re-render, restarted on every move, is
  // what left the grid blank; repaint the grid once, non-animated, instead.
  WS.view.previewSelectedKey = `file:${st.fileId}`;
  WS.view.pendingPreviewSelectionKey = `file:${st.fileId}`;
  syncAfterDirOrderChange(null, {
    preserveSelection: true,
    preservePreviewTarget: true,
    renderPreview: false,
  });
  renderPreviewPane(false, true);
  markGrabbedPreviewCard();
  return true;
}

function jumpPreviewTargetToDirectoryFile(dirNode, mode = "first") {
  if (!dirNode || dirNode._skipTagFilters) return false;
  const fileIds = getPreviewFileIdsForDir(dirNode, false);
  if (!fileIds.length) return false;
  let fileId = "";
  if (mode === "last") {
    fileId = fileIds[fileIds.length - 1] || "";
  } else if (mode === "random") {
    fileId = fileIds[Math.floor(Math.random() * fileIds.length)] || "";
  } else {
    fileId = fileIds[0] || "";
  }
  if (!fileId) return false;
  applyPreviewState({ kind: "dir", dirNode, fileId: null });
  WS.view.pendingPreviewSelectionKey = `file:${String(fileId || "")}`;
  renderPreviewPane(true, true);
  activatePreviewPaneSelection();
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  return true;
}

// Prev/next folder double as column-edge jumps when the current location is a
// folder grid (contains folders / is not a media-only folder) and no media is
// open — so large parent folders can be scanned without walking every card.
// A Tag's grid (or a special view's: Favorites, Untagged, All Sets...) is
// always a grid of folders and Tags, so it jumps the same way. Media folders
// and open-file views keep the sibling-folder jump.
function currentLocationSupportsFolderColumnEdgeJump(dirNode = null) {
  if (VIEWER_MODE) return false;
  if (WS.preview?.kind === "file" && WS.preview.fileId) return false;
  const node = dirNode || getPreviewTargetDir();
  if (!node) return false;
  if (!node._skipTagFilters && dirNodeIsMediaOnlyForQuickNavigation(node))
    return false;
  if (!previewThumbnailSelectionEnabled()) return false;
  // Need a live grid with at least one selectable card to jump within.
  return getPreviewSelectableCards().length > 0;
}

function movePreviewSelectionToColumnEdge(edge) {
  if (edge !== "top" && edge !== "bottom") return false;
  if (!ensurePreviewSelectionForCurrentTarget(false)) return false;
  const metrics = getPreviewSelectableCardMetrics();
  if (!metrics.length) return false;
  const selectedCard = findSelectedPreviewCard();
  const activeKey = String((WS.view && WS.view.previewSelectedKey) || "");
  const selected =
    metrics.find((m) => m.card === selectedCard) ||
    metrics.find((m) => m.key === activeKey) ||
    metrics[0];
  if (!selected) return false;

  // Column match uses the same “near enough center-x” idea as lateral grid
  // movement: half a card width, with a small floor so thin cards still group.
  const selectedRect = getPreviewCardRelativeRect(selected.card);
  const colTol = Math.max(8, (selectedRect?.width || 40) * 0.45);
  const sameCol = [];
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    if (!m) continue;
    if (Math.abs(m.cx - selected.cx) > colTol) continue;
    // Keep expanded headers out of the column-edge target set — they are
    // section chrome, not grid cells in the same sense as folder/file cards.
    if (isExpandedPreviewHeaderCard(m.card)) continue;
    sameCol.push(m);
  }
  if (!sameCol.length) return false;

  let best = sameCol[0];
  for (let i = 1; i < sameCol.length; i++) {
    const m = sameCol[i];
    if (edge === "top" ? m.cy < best.cy : m.cy > best.cy) best = m;
  }
  if (!best?.card) return false;
  if (best.card === selected.card) {
    // Already at the edge — still consume the key so it doesn't fall through
    // to a sibling-folder jump the user didn't intend.
    revealPreviewCard(best.card);
    return true;
  }
  return setPreviewSelectionCard(best.card, { activate: true });
}

function tryFolderJumpColumnEdgeInCurrentLocation(edge) {
  if (!currentLocationSupportsFolderColumnEdgeJump()) return false;
  return movePreviewSelectionToColumnEdge(edge);
}

function previewPaneFolderJump(action) {
  const sourceDir = getPreviewTargetDir();
  if (!sourceDir) return false;
  if (sourceDir._skipTagFilters) {
    // A Tag's grid has no sibling folders to step to; it only jumps within
    // itself. Consume the key either way, so it cannot fall through to a jump
    // among the folder the Tag hangs off.
    if (action === "prevFolder") tryFolderJumpColumnEdgeInCurrentLocation("top");
    else if (action === "nextFolder") tryFolderJumpColumnEdgeInCurrentLocation("bottom");
    return action === "prevFolder" || action === "nextFolder";
  }
  if (action === "prevFolder") {
    if (tryFolderJumpColumnEdgeInCurrentLocation("top")) return true;
    const dir = getPrevSiblingDirWithFiles(sourceDir);
    return !!dir && jumpPreviewTargetToDirectoryFile(dir, "first");
  }
  if (action === "nextFolder") {
    if (tryFolderJumpColumnEdgeInCurrentLocation("bottom")) return true;
    const dir = getNextSiblingDirWithFiles(sourceDir);
    return !!dir && jumpPreviewTargetToDirectoryFile(dir, "first");
  }
  return false;
}
