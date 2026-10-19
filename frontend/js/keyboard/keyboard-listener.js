/* Keyboard listener
   The global keydown listener. */

// Command+, is intentionally disabled: there is no Settings pane; the settings
// menu opens with the locked Tab key. No Cmd+, listener.

document.addEventListener("keydown", (e) => {
  if (busyOverlayActive()) {
    e.preventDefault();
    return;
  }
  if (e.defaultPrevented && !RESERVED_APP_KEYBIND_EVENTS.has(e)) return;

  const key = keybindValueFromEvent(e);
  if (!key) return;

  /* Tab is the app menu, reserved and unbindable -- the one key that is always
     the same whatever the Controls list says. Handled here rather than through
     KEYBIND_ACTIONS for that reason, alongside Cmd+1-9. It is deliberately not
     gated on a selection: the app menu is about the library, not about an item.
     Modified Tab is left alone so the browser host keeps its own focus
     traversal, and a text field keeps Tab for what Tab does in a text field. */
  if (
    key === "Tab" &&
    WS.root &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey &&
    !e.repeat &&
    !VIEWER_MODE &&
    !isTextInputTarget(e.target)
  ) {
    e.preventDefault();
    toggleAppMenuFromReservedKey();
    return;
  }

  const baseKey = normalizeBaseKeyValue(e.key);
  if (baseKey === ".") {
    if (isTextInputTarget(e.target)) return;
    if (VIEWER_MODE) return;
    if (directoriesSearchInput && !directoriesSearchInput.disabled && topBarEnabled()) {
      e.preventDefault();
      try {
        directoriesSearchInput.focus();
        directoriesSearchInput.select();
      } catch {}
      return;
    }
  }

  // The select menu opens with the locked F key (openAppMenu). No special-case
  // Settings pane toggle -- the settings pane is gone. While typing, letter keys keep
  // normal input because the action handlers below bail on text inputs.
  const action = keybindActionFor(key);
  if (!isTextInputTarget(e.target) && actionNeedsImmediateNavigationPriority(action)) {
    noteResponsiveNavigationInteraction("user-navigation", RESPONSIVE_NAV_MEDIA_MS);
  }
  if (handleThumbnailViewportArrowKey(e, action)) {
    e.preventDefault();
    return;
  }
  if (VIEWER_MODE && isQuadPlaybackMode()) {
    const allowedQuadAction =
      key === "Escape" ||
      action === "back" ||
      action === "seekBack" ||
      action === "seekForward" ||
      action === "playPause" ||
      action === "muteToggle" ||
      action === "openAppMenu" ||
      action === "toggleAnimatedFilters" ||
      action === "cycleAppearancePresets" ||
      isAppearancePresetKeybindAction(action);
    if (!allowedQuadAction) {
      e.preventDefault();
      return;
    }
  }

  if (action === "panic") {
    // Never let the panic key fire while typing — a bare-letter binding would
    // otherwise be un-typeable. Any other context still panics.
    if (isTextInputTarget(e.target)) return;
    e.preventDefault();
    applyBanicState(!BANIC_ACTIVE);
    return;
  }

  if (BANIC_ACTIVE) return;

  if (key === "Escape" || action === "back") {
    const handled = handleBackAction();
    if (handled) e.preventDefault();
    return;
  }

  const keybindOverridesTextInput =
    !!action && !!(e.metaKey || e.ctrlKey || e.altKey);
  if (isTextInputTarget(e.target) && !keybindOverridesTextInput) return;

  // While a grid file is grabbed for reorder, the selection keys move it
  // instead of the cursor. Any other action (except the grab toggle itself,
  // which drops it below) ends the grab and then runs normally.
  if (GRAB_REORDER_STATE) {
    const grabDir = grabReorderDirectionForAction(action);
    if (grabDir) {
      e.preventDefault();
      moveGrabbedPreviewFile(grabDir);
      return;
    }
    if (action !== "grabReorderItem") dropGrabReorder(false);
  }

  if (handleExtrasKeybindAction(action)) {
    e.preventDefault();
    return;
  }

  if (handleSelectionKeybindAction(action)) {
    e.preventDefault();
    return;
  }

  if (action === "muteToggle") {
    e.preventDefault();
    toggleViewerVideoMute();
    return;
  }

  if (VIEWER_MODE) {
    if (isQuadPlaybackMode()) {
      switch (action) {
        case "selectUp":
        case "selectDown":
        case "selectLeft":
        case "selectRight":
        case "enterDir":
        case "prevFolder":
        case "nextFolder":
        case "randomFirstFileJump":
        case "toggleRandomFolderSort":
        case "cycleFilter":
        case "slideshow":
        case "jumpMinus50":
        case "jumpMinus10":
        case "jumpPlus10":
        case "jumpPlus50":
          e.preventDefault();
          return;
        case "leaveDir":
          e.preventDefault();
          hideOverlay();
          return;
        case "seekBack":
          e.preventDefault();
          seekViewerVideo(-videoSkipStepSeconds());
          return;
        case "seekForward":
          e.preventDefault();
          seekViewerVideo(videoSkipStepSeconds());
          return;
        case "playPause":
          e.preventDefault();
          toggleViewerVideoPlayPause();
          return;
        case "muteToggle":
          e.preventDefault();
          toggleViewerVideoMute();
          return;
        default:
          return;
      }
    }
    switch (action) {
      case "selectUp":
        e.preventDefault();
        viewerStep(-1);
        return;
      case "selectDown":
        e.preventDefault();
        viewerStep(1);
        return;
      case "selectLeft":
        e.preventDefault();
        viewerStep(-1);
        return;
      case "selectRight":
        e.preventDefault();
        viewerStep(1);
        return;
      case "leaveDir":
        e.preventDefault();
        hideOverlay();
        return;
      case "enterDir":
        e.preventDefault();
        viewerEnterDir();
        return;
      case "prevFolder":
        e.preventDefault();
        viewerJumpToPrevFolderFirstFile();
        return;
      case "nextFolder":
        e.preventDefault();
        viewerJumpToNextFolderFirstFile();
        return;
      case "toggleRandomFolderSort":
        e.preventDefault();
        toggleRandomOrder("sets");
        return;
      case "cycleFilter":
        e.preventDefault();
        cycleFilterMode();
        return;
      case "slideshow":
        e.preventDefault();
        handleSlideshowHotkey(true);
        return;
      case "seekBack":
        e.preventDefault();
        seekViewerVideo(-videoSkipStepSeconds());
        return;
      case "seekForward":
        e.preventDefault();
        seekViewerVideo(videoSkipStepSeconds());
        return;
      case "playPause":
        e.preventDefault();
        toggleViewerVideoPlayPause();
        return;
      case "muteToggle":
        e.preventDefault();
        toggleViewerVideoMute();
        return;
      case "jumpMinus50":
        e.preventDefault();
        viewerJumpRelative(-50);
        return;
      case "jumpMinus10":
        e.preventDefault();
        viewerJumpRelative(-10);
        return;
      case "jumpPlus10":
        e.preventDefault();
        viewerJumpRelative(10);
        return;
      case "jumpPlus50":
        e.preventDefault();
        viewerJumpRelative(50);
        return;
      default:
        return;
    }
  }

  if (!WS.root) return;

  const inFilePreview = WS.preview.kind === "file" && !!WS.preview.fileId;
  const previewPaneActive =
    !directoriesPaneOpenEnabled() || WS.view.activePane === "preview";

  if (
    action === "enterDir" &&
    directoriesPaneOpenEnabled() &&
    selectedFilePaneEntryForEnterAutoClose()
  ) {
    e.preventDefault();
    enterSelectedDirectory();
    return;
  }

  if (action === "leaveDir" && restorePanesClosedByFilePaneEnter()) {
    e.preventDefault();
    return;
  }

  // Closed file pane wins before any visible-pane navigation model.
  if (handleClosedFilePaneNavigationAction(action)) {
    e.preventDefault();
    return;
  }

  if (previewPaneActive && !inFilePreview) {
    const isGridAction =
      action === "selectUp" ||
      action === "selectDown" ||
      action === "selectLeft" ||
      action === "selectRight" ||
      action === "leaveDir" ||
      action === "enterDir";
    if (isGridAction) {
      // Route all six grid-navigation actions through the full handler so
      // the 2D grid traversal logic runs first (left/right move within the
      // grid before falling back to pane-switching, matching v1.6.0).
      handlePreviewPaneAction(action, false);
      e.preventDefault();
      return;
    }
  }

  if (previewPaneActive && handlePreviewPaneAction(action, inFilePreview)) {
    e.preventDefault();
    return;
  }

  if (handleDirectoriesPaneSwitchAction(action)) {
    e.preventDefault();
    return;
  }

  if (inFilePreview) {
    switch (action) {
      case "selectUp":
        e.preventDefault();
        viewerStep(-1);
        return;
      case "selectDown":
        e.preventDefault();
        viewerStep(1);
        return;
      case "selectLeft":
        if (!directoriesPaneOpenEnabled()) {
          e.preventDefault();
          viewerStep(-1);
          return;
        }
        break;
      case "selectRight":
        if (!directoriesPaneOpenEnabled()) {
          e.preventDefault();
          viewerStep(1);
          return;
        }
        break;
      case "leaveDir":
        e.preventDefault();
        if (WS.view.previewFileSelectionBridgeActive) {
          closeFilePreviewToFolder();
        } else {
          goDirUp();
        }
        return;
      case "enterDir":
        e.preventDefault();
        return;
      case "prevFolder":
        e.preventDefault();
        viewerJumpToPrevFolderFirstFile();
        return;
      case "nextFolder":
        e.preventDefault();
        viewerJumpToNextFolderFirstFile();
        return;
      case "toggleRandomFolderSort":
        e.preventDefault();
        toggleRandomOrder("sets");
        return;
      case "cycleFilter":
        e.preventDefault();
        cycleFilterMode();
        return;
      case "slideshow":
        e.preventDefault();
        handleSlideshowHotkey(false);
        return;
      case "seekBack":
        e.preventDefault();
        seekViewerVideo(-videoSkipStepSeconds());
        return;
      case "seekForward":
        e.preventDefault();
        seekViewerVideo(videoSkipStepSeconds());
        return;
      case "playPause":
        e.preventDefault();
        toggleViewerVideoPlayPause();
        return;
      case "muteToggle":
        e.preventDefault();
        toggleViewerVideoMute();
        return;
      case "jumpMinus50":
        e.preventDefault();
        viewerJumpRelative(-50);
        return;
      case "jumpMinus10":
        e.preventDefault();
        viewerJumpRelative(-10);
        return;
      case "jumpPlus10":
        e.preventDefault();
        viewerJumpRelative(10);
        return;
      case "jumpPlus50":
        e.preventDefault();
        viewerJumpRelative(50);
        return;
      case "historyBack":
        e.preventDefault();
        goDirHistory(-1);
        return;
      case "historyForward":
        e.preventDefault();
        goDirHistory(1);
        return;
      default:
        return;
    }
  }

  switch (action) {
    case "selectUp":
      e.preventDefault();
      moveDirectoriesSelection(-1);
      return;
    case "selectDown":
      e.preventDefault();
      moveDirectoriesSelection(1);
      return;
    case "selectLeft":
      e.preventDefault();
      return;
    case "selectRight":
      e.preventDefault();
      return;
    case "leaveDir":
      e.preventDefault();
      leaveDirectory();
      return;
    case "enterDir":
      e.preventDefault();
      enterSelectedDirectory();
      return;
    case "prevFolder":
      e.preventDefault();
      jumpToPrevFolderFirstFile();
      return;
    case "nextFolder":
      e.preventDefault();
      jumpToNextFolderFirstFile();
      return;
    case "toggleRandomFolderSort":
      e.preventDefault();
      toggleRandomOrder("sets");
      return;
    case "cycleFilter":
      e.preventDefault();
      cycleFilterMode();
      return;
    case "jumpMinus50":
      e.preventDefault();
      moveDirectoriesSelection(-50);
      return;
    case "jumpMinus10":
      e.preventDefault();
      moveDirectoriesSelection(-10);
      return;
    case "jumpPlus10":
      e.preventDefault();
      moveDirectoriesSelection(10);
      return;
    case "jumpPlus50":
      e.preventDefault();
      moveDirectoriesSelection(50);
      return;
    case "historyBack":
      e.preventDefault();
      goDirHistory(-1);
      return;
    case "historyForward":
      e.preventDefault();
      goDirHistory(1);
      return;
    default:
      return;
  }
});
