/* Busy overlay and dialogs
   The busy overlay and the confirm/alert dialog. */

let BUSY_OVERLAY_HOLD_COUNT = 0;
let BUSY_OVERLAY_PENDING_HIDE = false;

function holdBusyOverlay() {
  BUSY_OVERLAY_HOLD_COUNT++;
  BUSY_OVERLAY_PENDING_HIDE = false;
}

function releaseBusyOverlayHold(options = null) {
  const opts = options && typeof options === "object" ? options : {};
  const shouldHide = opts.hide !== false;
  BUSY_OVERLAY_HOLD_COUNT = Math.max(0, BUSY_OVERLAY_HOLD_COUNT - 1);
  if (!BUSY_OVERLAY_HOLD_COUNT && (shouldHide || BUSY_OVERLAY_PENDING_HIDE)) {
    hideBusyOverlay(true);
  }
}

// Busy overlay is a fixed "Loading" + spinner screen (same as boot splash).
// Callers may still pass label/detail for API compatibility; both are ignored.
function showBusyOverlay(_text, _detail = "") {
  BUSY_OVERLAY_PENDING_HIDE = false;
  if (busyLabel) busyLabel.textContent = "Loading";
  if (busyDetail) busyDetail.textContent = "";
  if (busyOverlay) {
    busyOverlay.classList.add("active");
    busyOverlay.setAttribute("aria-busy", "true");
  }
}

function hideBusyOverlay(force = false) {
  if (!force && BUSY_OVERLAY_HOLD_COUNT > 0) {
    BUSY_OVERLAY_PENDING_HIDE = true;
    return;
  }
  BUSY_OVERLAY_PENDING_HIDE = false;
  if (busyDetail) busyDetail.textContent = "";
  if (busyOverlay) {
    busyOverlay.classList.remove("active");
    busyOverlay.setAttribute("aria-busy", "false");
  }
}

function busyOverlayActive() {
  return !!(busyOverlay && busyOverlay.classList.contains("active"));
}

/* Themed confirm/alert dialog — replaces blocking native confirm()/alert().
   Returns a Promise that resolves to true (OK) or false (Cancel / dismissed).
   For alert mode the Cancel button is hidden and dismissal resolves to true. */
let confirmDialogState = null;
function confirmDialogIsOpen() {
  return !!confirmDialogState;
}
function showConfirmDialog(message, opts = {}) {
  const options = opts && typeof opts === "object" ? opts : {};
  const isAlert = options.mode === "alert";
  return new Promise((resolve) => {
    const overlayEl = $("confirmOverlay");
    const msgEl = $("confirmMessage");
    const okBtn = $("confirmOkBtn");
    const cancelBtn = $("confirmCancelBtn");
    if (!overlayEl || !msgEl || !okBtn || !cancelBtn) {
      // Fall back to the native dialog if the markup is unavailable.
      let result = isAlert ? true : false;
      try {
        if (isAlert) {
          if (typeof window.alert === "function") window.alert(message);
          result = true;
        } else if (typeof window.confirm === "function") {
          result = window.confirm(message);
        }
      } catch {}
      resolve(result);
      return;
    }

    // Replace any dialog already on screen (resolve it as dismissed).
    if (confirmDialogState) confirmDialogState.settle(confirmDialogState.dismissValue);

    msgEl.textContent = String(message == null ? "" : message);
    okBtn.textContent = options.okLabel || "OK";
    cancelBtn.textContent = options.cancelLabel || "Cancel";
    cancelBtn.style.display = isAlert ? "none" : "";
    okBtn.classList.toggle("confirmDanger", !!options.danger);

    const dismissValue = isAlert ? true : false;
    const prevFocus =
      document.activeElement && typeof document.activeElement.focus === "function"
        ? document.activeElement
        : null;

    const state = { dismissValue, settle: null };

    const settle = (result) => {
      if (confirmDialogState !== state) return;
      confirmDialogState = null;
      document.removeEventListener("keydown", onKeyDown, true);
      overlayEl.removeEventListener("mousedown", onBackdrop);
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlayEl.classList.remove("active");
      overlayEl.setAttribute("aria-hidden", "true");
      okBtn.classList.remove("confirmDanger");
      try {
        if (prevFocus) prevFocus.focus();
      } catch {}
      resolve(result);
    };
    state.settle = settle;

    const onOk = () => settle(true);
    const onCancel = () => settle(false);
    const onBackdrop = (e) => {
      if (e.target === overlayEl) settle(dismissValue);
    };
    const onKeyDown = (e) => {
      // The confirm ("yes, do it") and cancel ("no") options answer to the
      // user's own enter/exit keybinds, not just hardcoded Enter/Escape: the
      // key bound to enterDir confirms, the key bound to leaveDir/back cancels.
      const bindKey =
        typeof keybindValueFromEvent === "function"
          ? keybindValueFromEvent(e)
          : "";
      const boundAction = bindKey ? keybindActionFor(bindKey) : "";
      const isConfirmKey = e.key === "Enter" || boundAction === "enterDir";
      const isCancelKey =
        e.key === "Escape" ||
        boundAction === "leaveDir" ||
        boundAction === "back";
      if (isCancelKey) {
        e.preventDefault();
        e.stopPropagation();
        settle(dismissValue);
      } else if (isConfirmKey) {
        // Enter / the enter keybind always confirms (an alert's only outcome is
        // dismissal, which is its confirm value too).
        e.preventDefault();
        e.stopPropagation();
        settle(true);
      } else if (e.key === " " || e.key === "Spacebar") {
        // Space still activates whichever button is focused (default OK).
        e.preventDefault();
        e.stopPropagation();
        settle(document.activeElement === cancelBtn ? false : true);
      } else if (e.key === "Tab") {
        // Keep focus inside the dialog.
        const focusables = isAlert ? [okBtn] : [cancelBtn, okBtn];
        e.preventDefault();
        const idx = focusables.indexOf(document.activeElement);
        const next = e.shiftKey
          ? focusables[(idx <= 0 ? focusables.length : idx) - 1]
          : focusables[(idx + 1) % focusables.length];
        try {
          next.focus();
        } catch {}
      } else {
        // Swallow other keys so global app shortcuts don't fire under the modal.
        e.preventDefault();
        e.stopPropagation();
      }
    };

    confirmDialogState = state;
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlayEl.addEventListener("mousedown", onBackdrop);
    document.addEventListener("keydown", onKeyDown, true);

    overlayEl.setAttribute("aria-hidden", "false");
    overlayEl.classList.add("active");
    try {
      (options.danger && !isAlert ? cancelBtn : okBtn).focus();
    } catch {}
  });
}

function showAlertDialog(message, opts = {}) {
  const options = opts && typeof opts === "object" ? opts : {};
  return showConfirmDialog(message, Object.assign({}, options, { mode: "alert" }));
}
