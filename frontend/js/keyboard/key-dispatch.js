/* Key dispatch
   Grid, back, pane and closed-pane actions, and the keys reserved before
   Chromium. */

function isGridExclusiveAction(action) {
  return (
    action === "selectUp" ||
    action === "selectDown" ||
    action === "selectLeft" ||
    action === "selectRight" ||
    action === "leaveDir" ||
    action === "enterDir" ||
    action === "playPause" ||
    action === "historyBack" ||
    action === "historyForward" ||
    action === "gridMoveUp" ||
    action === "gridMoveDown" ||
    action === "gridOpenSelection"
  );
}

function handleGridKeybindAction(action) {
  if (!action || !isGridInteractionMode() || !WS.root) return false;
  if (VIEWER_MODE) {
    if (isQuadPlaybackMode()) {
      switch (action) {
        case "leaveDir":
          hideOverlay();
          return true;
        case "seekBack":
          seekViewerVideo(-videoSkipStepSeconds());
          return true;
        case "seekForward":
          seekViewerVideo(videoSkipStepSeconds());
          return true;
        case "playPause":
          toggleViewerVideoPlayPause();
          return true;
        case "muteToggle":
          toggleViewerVideoMute();
          return true;
        case "selectUp":
        case "selectDown":
        case "selectLeft":
        case "selectRight":
        case "enterDir":
        case "gridMoveUp":
        case "gridMoveDown":
        case "jumpMinus50":
        case "jumpMinus10":
        case "jumpPlus10":
        case "jumpPlus50":
          return true;
        default:
          return false;
      }
    }
    switch (action) {
      case "selectUp":
      case "gridMoveUp":
        moveGridGallerySelectionByDirection("up");
        return true;
      case "selectDown":
      case "gridMoveDown":
        moveGridGallerySelectionByDirection("down");
        return true;
      case "selectLeft":
        moveGridGallerySelectionByDirection("left");
        return true;
      case "selectRight":
        moveGridGallerySelectionByDirection("right");
        return true;
      case "leaveDir":
        hideOverlay();
        return true;
      case "enterDir":
      case "gridOpenSelection":
        return true;
      case "seekBack":
        seekViewerVideo(-videoSkipStepSeconds());
        return true;
      case "seekForward":
        seekViewerVideo(videoSkipStepSeconds());
        return true;
      case "playPause":
        toggleViewerVideoPlayPause();
        return true;
      case "muteToggle":
        toggleViewerVideoMute();
        return true;
      case "jumpMinus50":
        viewerJumpRelative(-50);
        return true;
      case "jumpMinus10":
        viewerJumpRelative(-10);
        return true;
      case "jumpPlus10":
        viewerJumpRelative(10);
        return true;
      case "jumpPlus50":
        viewerJumpRelative(50);
        return true;
      default:
        return false;
    }
  }
  switch (action) {
    case "selectUp":
      moveGridSelectionByDirection("up");
      return true;
    case "selectDown":
      moveGridSelectionByDirection("down");
      return true;
    case "selectLeft":
      moveGridSelectionByDirection("left");
      return true;
    case "selectRight":
      moveGridSelectionByDirection("right");
      return true;
    case "leaveDir":
      goDirUp();
      return true;
    case "enterDir":
      openSelectedEntryInGridMode(true);
      return true;
    case "playPause":
      // Space is intentionally unbound for opening items in Grid Mode.
      return true;
    case "historyBack":
      goDirHistory(-1);
      return true;
    case "historyForward":
      goDirHistory(1);
      return true;
    case "gridMoveUp":
      moveGridSelectionByDirection("up");
      return true;
    case "gridMoveDown":
      moveGridSelectionByDirection("down");
      return true;
    case "gridOpenSelection":
      openSelectedEntryInGridMode(true);
      return true;
    default:
      return false;
  }
}

async function closeFilePreviewToFolder() {
  if (!WS.root) return;
  if (WS.preview.kind !== "file") return;
  const currentItem = viewerItems[viewerIndex] || null;
  const closedFileId =
    currentItem && !currentItem.isFolder && currentItem.id
      ? String(currentItem.id || "")
      : WS.preview.fileId
        ? String(WS.preview.fileId || "")
        : "";
  const closedFileRec = closedFileId ? WS.fileById.get(closedFileId) : null;
  const closedFileDirPath = String(
    closedFileRec?.dirPath || viewerDirNode?.path || WS.preview.dirNode?.path || "",
  );
  const closedFilePreviewSelectionKey = closedFileId
    ? makeExpandedPreviewFileSelectionKey(closedFileId, closedFileDirPath)
    : "";
  const useDirectorySelectionBridge = !!WS.view.previewFileSelectionBridgeActive;
  const bridgeReturnState = useDirectorySelectionBridge
    ? resolvePreviewFileBridgeReturnState(closedFilePreviewSelectionKey)
    : null;
  if (closedFilePreviewSelectionKey) {
    WS.view.pendingPreviewSelectionKey = closedFilePreviewSelectionKey;
  }
  const returnToPreviewPane = !!WS.view.returnToPreviewPaneAfterFileClose;
  WS.view.returnToPreviewPaneAfterFileClose = false;
  WS.view.previewFileSelectionBridgeActive = false;
  WS.view.previewFileBridgeReturnState = null;
  if (bridgeReturnState) {
    try {
      restoreViewerCloseState(bridgeReturnState, {
        preferCachedEntries: true,
        deferDirectoriesRender: false,
        preserveViewFilters: true,
        preserveTagEntryCaches: true,
        hideBusyAfterDeferredRender: false,
      });
    } catch {
      hideBusyOverlay();
    }
    return;
  }
  try {
    applyPreviewState({
      kind: "dir",
      dirNode: WS.preview.dirNode || getPreviewTargetDir(),
      fileId: null,
    });
    ACTIVE_MEDIA_SURFACE = "none";
    renderPreviewPane(true, true);
    if (returnToPreviewPane || useDirectorySelectionBridge) {
      setActivePane("preview");
      activatePreviewPaneSelection();
    } else if (WS.view.activePane === "preview") {
      activatePreviewPaneSelection();
    }
    syncButtons();
  } finally {
    hideBusyOverlay();
  }
}

function handleBackAction() {
  if (dropGrabReorder(true)) return true;
  /* An inline edit that is on screen but has no caret in it. A focused one
     never reaches here -- its own keydown stops every key -- so this fires
     only for the stranded case, and it is the last line of defence rather than
     the fix: `queueInlineInputFocus` is supposed to have retracted it already.
     It is kept because "there is no way to make it go away" is the part of
     this bug that costs a reload, and that should not depend on having
     enumerated every way an edit can be stranded. */
  if (pendingInlineEditIsUnfocused()) {
    clearPendingInlineEdit();
    return true;
  }
  if (MENU_OPEN) {
    closeMenu();
    return true;
  }
  if (
    WS.view.bulkActionMenuOpen ||
    WS.view.dirActionMenuPath ||
    WS.view.fileActionMenuId
  ) {
    closeActionMenus();
    renderDirectoriesPane(true);
    return true;
  }
  if (directorySearchInteractionActive()) {
    clearDirectorySearchUi();
    return true;
  }
  if (VIEWER_MODE) {
    hideOverlay();
    return true;
  }
  if (exitUnbridgedOpenFileToSetSelection()) return true;
  if (
    WS.preview.kind === "file" &&
    WS.preview.fileId &&
    WS.view.previewFileSelectionBridgeActive
  ) {
    closeFilePreviewToFolder();
    return true;
  }
  return false;
}

function toggleMenuForTab(tabId) {
  if (MENU_OPEN && MENU_ACTIVE_TAB === tabId) closeMenu();
  else openMenu(tabId);
}

function refreshAfterDirectoriesPaneToggle(
  animatePreview = false,
  keepPreviewScroll = true,
) {
  canonicalizeActiveDirectoryReferences();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  canonicalizeActiveDirectoryReferences();
  renderDirectoriesPane(true);
  renderPreviewPane(animatePreview, keepPreviewScroll);
  refreshActivePreviewMediaLayout({ immediate: true });
  requestAnimationFrame(() => {
    refreshActivePreviewMediaLayout({ immediate: true });
    if (WS.preview && WS.preview.kind === "file" && WS.preview.fileId) {
      renderPreviewPane(false, true);
    }
  });
  updatePreviewSelectionClasses();
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function setDirectoriesPaneOpenValue() {
  // Preview-only UI: the file pane no longer exists, so its open state can
  // never change (directoriesPaneOpenEnabled() is hard-wired false).
  return false;
}

function handlePreviewPaneAction(action, inFilePreview) {
  const sidebarVisible = directoriesPaneOpenEnabled();
  if (inFilePreview) {
    switch (action) {
      case "selectUp":
        viewerStep(-1);
        return true;
      case "selectDown":
        viewerStep(1);
        return true;
      case "selectLeft":
        viewerStep(-1);
        return true;
      case "selectRight":
        viewerStep(1);
        return true;
      case "leaveDir":
        if (WS.view.previewFileSelectionBridgeActive) {
          closeFilePreviewToFolder();
        } else {
          goDirUp();
        }
        return true;
      case "enterDir":
        return true;
      case "prevFolder":
        viewerJumpToPrevFolderFirstFile();
        return true;
      case "nextFolder":
        viewerJumpToNextFolderFirstFile();
        return true;
      case "toggleRandomFolderSort":
        toggleRandomOrder("sets");
        return true;
      case "cycleFilter":
        cycleFilterMode();
        return true;
      case "slideshow":
        toggleSlideshow();
        return true;
      case "seekBack":
        seekViewerVideo(-videoSkipStepSeconds());
        return true;
      case "seekForward":
        seekViewerVideo(videoSkipStepSeconds());
        return true;
      case "playPause":
        toggleViewerVideoPlayPause();
        return true;
      case "muteToggle":
        toggleViewerVideoMute();
        return true;
      case "jumpMinus50":
        viewerJumpRelative(-50);
        return true;
      case "jumpMinus10":
        viewerJumpRelative(-10);
        return true;
      case "jumpPlus10":
        viewerJumpRelative(10);
        return true;
      case "jumpPlus50":
        viewerJumpRelative(50);
        return true;
      case "historyBack":
        goDirHistory(-1);
        return true;
      case "historyForward":
        goDirHistory(1);
        return true;
      default:
        return false;
    }
  }
  switch (action) {
    case "prevFolder":
    case "nextFolder":
      return previewPaneFolderJump(action);
    case "selectUp":
      return movePreviewSelectionByDirection("up");
    case "selectDown":
      return movePreviewSelectionByDirection("down");
    case "selectLeft":
      // Folder/grid navigation stays inside the current folder. Cross-folder
      // sliding is only available while a file is open in the preview pane.
      if (movePreviewSelectionByDirection("left")) return true;
      if (sidebarVisible) return activateDirectoriesPaneSelection();
      return false;
    case "selectRight":
      return movePreviewSelectionByDirection("right");
    case "leaveDir": {
      if (exitUnbridgedOpenFileToSetSelection()) return true;
      if (WS.view.previewFolderBridgeReturnState) {
        syncGridReturnStateToExitedFolder(WS.nav.dirNode);
        if (restorePreviewFolderBridgeState()) return true;
      }
      const beforeState = {
        navPath: String(WS.nav.dirNode?.path || ""),
        aboveRoot: !!WS.view.aboveRootView,
        tagMode: String(WS.view.tagFolderActiveMode || ""),
        tagTag: String(WS.view.tagFolderActiveTag || ""),
        tagAlbum: String(WS.view.tagFolderActiveAlbum || ""),
        tagOriginPath: String(WS.view.tagFolderOriginPath || ""),
        searchRootActive: !!WS.view.searchRootActive,
        favoritesRootActive: !!WS.view.favoritesRootActive,
        hiddenRootActive: !!WS.view.hiddenRootActive,
      };
      const previewTarget = getPreviewTargetDir();
      const exitTarget =
        previewTarget && !previewTarget._skipTagFilters
          ? previewTarget
          : WS.nav.dirNode;
      if (
        exitTarget &&
        !exitTarget._skipTagFilters &&
        tryRestoreTagDirectoryContext(String(exitTarget.path || ""), {
          previewPortalRestore: true,
        })
      )
        return true;
      WS.view.pendingPreviewSelectionKey = entryKeyForSelection(
        WS.nav.entries[WS.nav.selectedIndex] || null,
      );
      leaveDirectory();
      const unchanged =
        beforeState.navPath === String(WS.nav.dirNode?.path || "") &&
        beforeState.aboveRoot === !!WS.view.aboveRootView &&
        beforeState.tagMode === String(WS.view.tagFolderActiveMode || "") &&
        beforeState.tagTag === String(WS.view.tagFolderActiveTag || "") &&
        beforeState.tagAlbum === String(WS.view.tagFolderActiveAlbum || "") &&
        beforeState.tagOriginPath ===
          String(WS.view.tagFolderOriginPath || "") &&
        beforeState.searchRootActive === !!WS.view.searchRootActive &&
        beforeState.favoritesRootActive === !!WS.view.favoritesRootActive &&
        beforeState.hiddenRootActive === !!WS.view.hiddenRootActive;
      if (unchanged) WS.view.pendingPreviewSelectionKey = "";
      return true;
    }
    case "enterDir":
      return openSelectedPreviewItem();
    default:
      return false;
  }
}

function handleDirectoriesPaneSwitchAction(action) {
  if (!directoriesPaneOpenEnabled()) return false;
  if (WS.view.activePane === "preview") return false;
  if (action === "selectLeft") return true;
  if (action !== "selectRight") return false;
  return activatePreviewPaneSelection();
}

function moveClosedFilePaneMediaSelection(step) {
  if (!WS.root) return false;
  const direction = step < 0 ? -1 : 1;

  // If the preview is already showing media, browse the media sequence
  // itself and skip folder entries. This keeps the hidden file pane from
  // leaking list/grid layout behavior into fullscreen-style browsing.
  if (WS.preview.kind === "file" && WS.preview.fileId) {
    ensureViewerFromPreviewFileId(WS.preview.fileId);
    return viewerStepMediaOnly(direction);
  }

  const selected = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (selected && selected.kind === "file") {
    const slide = slideStepFileInternal(direction);
    if (slide.moved) {
      WS.view.pendingDirScroll = "center-selected";
      renderDirectoriesPane(!slide.dirChanged);
      renderPreviewPane(!!slide.dirChanged, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      return true;
    }
  }

  const start = Number.isFinite(WS.nav.selectedIndex)
    ? WS.nav.selectedIndex
    : direction > 0
      ? -1
      : WS.nav.entries.length;
  for (
    let idx = start + direction;
    idx >= 0 && idx < WS.nav.entries.length;
    idx += direction
  ) {
    const entry = WS.nav.entries[idx];
    if (!entry || entry.kind !== "file") continue;
    WS.view.pendingDirScroll = "center-selected";
    setDirectoriesSelection(idx, { keepScroll: true });
    return true;
  }

  return false;
}

function moveClosedFilePaneMediaJump(delta) {
  const step = delta < 0 ? -1 : 1;
  let remaining = Math.abs(delta);
  let moved = false;
  while (remaining > 0) {
    if (!moveClosedFilePaneMediaSelection(step)) break;
    moved = true;
    remaining--;
  }
  return moved;
}

/* Quick navigation's way out, for a file that was reached without the dive.
   Opening a set with quick navigation on captures a return bridge, so leaving
   lands back on the model folder's grid with that set selected. Many things now
   land straight on a file instead -- the random jumps, or restoring a session
   that was on a file -- and they capture nothing,
   so leaving used to fall through to a plain step up and land in the set's own
   grid. With quick navigation on, this makes every such exit behave as if the
   set had been dived into: the model folder's grid, with the set selected.

   It stands aside whenever the file already has a way back (a bridge, or a file
   opened from a grid card), when the file was opened inside a Tag or special
   view (those keep their own return), and when the file does not sit in a Set
   directly inside a Model (see "The library's shape"). */
function exitUnbridgedOpenFileToSetSelection() {
  if (!WS.root || !quickNavigationEnabled()) return false;
  if (!(WS.preview && WS.preview.kind === "file" && WS.preview.fileId)) return false;
  if (WS.view.previewFolderBridgeReturnState || WS.view.previewFileSelectionBridgeActive)
    return false;
  if (isViewingTagFolder()) return false;
  if (WS.preview.dirNode && WS.preview.dirNode._skipTagFilters) return false;
  const rec = WS.fileById.get(String(WS.preview.fileId || ""));
  const set = rec ? WS.dirByPath.get(String(rec.dirPath || "")) : null;
  const model = set ? set.parent : null;
  if (!set || !model || model.parent !== WS.root) return false;
  const selectionKey = `dir:${String(set.path || "")}`;
  const state = makeLocationState({ kind: "dir", node: model });
  state.pendingPreviewSelectionKey = selectionKey;
  state.previewSelectedKey = selectionKey;
  return restoreViewerCloseState(state, { restorePreviewForAnyPane: true });
}

function handleClosedFilePaneNavigationAction(action) {
  if (directoriesPaneOpenEnabled()) return false;
  // Only take over for sequential fullscreen media browsing, i.e. when a single
  // file is shown. When a folder grid is shown with the file pane closed, defer
  // to the normal grid handler (handlePreviewPaneAction) so the grid cursor
  // (previewSelectedKey) drives both movement AND opening — otherwise opening
  // would fall back to WS.nav.selectedIndex and always open the first item.
  if (!(WS.preview && WS.preview.kind === "file" && WS.preview.fileId)) {
    return false;
  }
  switch (action) {
    case "selectUp":
    case "selectLeft":
      return moveClosedFilePaneMediaSelection(-1);
    case "selectDown":
    case "selectRight":
      return moveClosedFilePaneMediaSelection(1);
    case "leaveDir":
      if (exitUnbridgedOpenFileToSetSelection()) return true;
      if (WS.view.previewFileSelectionBridgeActive) {
        closeFilePreviewToFolder();
        return true;
      }
      // If this folder was opened from the grid, a grid return state was
      // captured: jump back to the grid view
      // with the folder kept selected. Otherwise step up one level, keeping the
      // folder you just left selected.
      if (WS.view.previewFolderBridgeReturnState) {
        syncGridReturnStateToExitedFolder(WS.nav.dirNode);
        if (restorePreviewFolderBridgeState()) return true;
      }
      WS.view.pendingPreviewSelectionKey = entryKeyForSelection(
        WS.nav.entries[WS.nav.selectedIndex] || null,
      );
      leaveDirectory();
      return true;
    case "enterDir":
      enterSelectedDirectory();
      return true;
    case "jumpMinus50":
      return moveClosedFilePaneMediaJump(-50);
    case "jumpMinus10":
      return moveClosedFilePaneMediaJump(-10);
    case "jumpPlus10":
      return moveClosedFilePaneMediaJump(10);
    case "jumpPlus50":
      return moveClosedFilePaneMediaJump(50);
    default:
      return false;
  }
}

function handleThumbnailViewportArrowKey(e, action) {
  if (!e || !WS.root || VIEWER_MODE || THUMB_CROP_EDITOR) return false;
  if (isTextInputTarget(e.target)) return false;
  if (openNumberedItemMenu()) return false;
  const key = normalizeBaseKeyValue(e.key);
  const commandOnly =
    !!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
  // Experimental -> Thumbnail edits off: the edits are not drawn, so they
  // cannot be made either. Cmd+arrows are still consumed (they are fixed
  // keys); bare arrows go back to ordinary navigation.
  if (!thumbnailEditsEnabled()) {
    if (!commandOnly || !String(key).startsWith("Arrow")) return false;
    showStatusMessage(
      "Thumbnail edits are off (Settings > Experimental).",
    );
    return true;
  }
  if (commandOnly && (key === "ArrowUp" || key === "ArrowDown")) {
    const zoomStep =
      typeof THUMB_VIEWPORT_ZOOM_STEP_RESTORED === "number"
        ? THUMB_VIEWPORT_ZOOM_STEP_RESTORED
        : 0.2;
    zoomSelectedThumbnailViewport(
      key === "ArrowUp" ? zoomStep : -zoomStep,
      {
        consumeAtLimit: true,
        quietNoTarget: true,
        quietSuccess: true,
      },
    );
    // Keep these fixed shortcuts from falling through to navigation when the
    // selected item has no editable thumbnail or has reached a zoom limit.
    return true;
  }
  if (commandOnly && (key === "ArrowLeft" || key === "ArrowRight")) {
    seekSelectedVideoThumbnailFrame(key === "ArrowLeft" ? -1 : 1, !!e.repeat);
    // Images intentionally do nothing, but the fixed shortcut remains consumed
    // so it cannot leak through to navigation or a browser history action.
    return true;
  }
  if (action || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const step =
    typeof THUMB_VIEWPORT_NUDGE_STEP_RESTORED === "number"
      ? THUMB_VIEWPORT_NUDGE_STEP_RESTORED
      : 8;
  if (key === "ArrowLeft") {
    return nudgeSelectedThumbnailViewport(-step, 0, {
      quietNoTarget: true,
      quietSuccess: true,
    });
  }
  if (key === "ArrowRight") {
    return nudgeSelectedThumbnailViewport(step, 0, {
      quietNoTarget: true,
      quietSuccess: true,
    });
  }
  if (key === "ArrowUp") {
    return nudgeSelectedThumbnailViewport(0, -step, {
      quietNoTarget: true,
      quietSuccess: true,
    });
  }
  if (key === "ArrowDown") {
    return nudgeSelectedThumbnailViewport(0, step, {
      quietNoTarget: true,
      quietSuccess: true,
    });
  }
  return false;
}

const RESERVED_APP_KEYBIND_EVENTS = new WeakSet();

function shouldReserveAppKeybindBeforeBrowser(e) {
  if (!e || e.defaultPrevented) return false;
  if (busyOverlayActive()) return true;
  const baseKey = normalizeBaseKeyValue(e.key);
  if (WS.root && !VIEWER_MODE && isReservedSettingsMenuTabEvent(e))
    return true;
  const commandThumbnailEdit =
    !!WS.root &&
    !VIEWER_MODE &&
    !THUMB_CROP_EDITOR &&
    !openNumberedItemMenu() &&
    !!e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey &&
    (baseKey === "ArrowUp" ||
      baseKey === "ArrowDown" ||
      baseKey === "ArrowLeft" ||
      baseKey === "ArrowRight");
  if (commandThumbnailEdit) return true;
  const key = keybindValueFromEvent(e);
  if (!key) return false;
  const action = keybindActionFor(key);
  if (!action) return false;
  if (isTextInputTarget(e.target)) return !!(e.metaKey || e.ctrlKey || e.altKey);
  return true;
}

window.addEventListener(
  "keydown",
  (e) => {
    if (!shouldReserveAppKeybindBeforeBrowser(e)) return;
    RESERVED_APP_KEYBIND_EVENTS.add(e);
    e.preventDefault();
  },
  true,
);

document.addEventListener(
  "keydown",
  (e) => {
    syncModifierKeyStateFromEvent(e);
  },
  true,
);

document.addEventListener(
  "keyup",
  (e) => {
    syncModifierKeyStateFromEvent(e);
    const baseKey = normalizeBaseKeyValue(e.key);
    if (
      baseKey === "ArrowLeft" ||
      baseKey === "ArrowRight" ||
      baseKey === "Meta"
    ) {
      resetVideoThumbnailFrameSeekHold();
    }
  },
  true,
);

window.addEventListener("blur", () => {
  clearModifierKeyState();
});

// An external file dropped anywhere outside a drop target would make the
// WebView navigate to that file, replacing the app. Internal reorder drags
// carry "text/plain" (never "Files"), so they are untouched.
window.addEventListener("dragover", (e) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "none";
  }
});
window.addEventListener("drop", (e) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
    e.preventDefault();
  }
});

// The slash / question-mark key focuses the folder search bar so it can be
// typed into without the mouse. (The controls list is on a held [ instead; see
// the listener below.)
document.addEventListener(
  "keydown",
  (e) => {
    const noCommandModifiers = !e.metaKey && !e.ctrlKey && !e.altKey;
    const isSearchFocus =
      (String(e.key || "") === "/" || String(e.key || "") === "?") &&
      noCommandModifiers &&
      !e.repeat;
    if (!isSearchFocus) return;
    // The search lives in the top bar; with the bar hidden there is none.
    if (!topBarEnabled()) return;
    const searchIsActive = directorySearchInteractionActive();
    if (
      busyOverlayActive() ||
      confirmDialogIsOpen() ||
      KEYBIND_CAPTURE_ACTION_ID ||
      APP_MENU_CONTROLS_CAPTURE_ID ||
      BANIC_ACTIVE ||
      (isTextInputTarget(e.target) && !searchIsActive)
    )
      return;
    if (!directoriesSearchInput) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (searchIsActive) {
      clearDirectorySearchUi();
      return;
    }
    directoriesSearchInput.focus();
    try {
      directoriesSearchInput.select();
    } catch {}
  },
  true,
);
