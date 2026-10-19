/* Settings window (retired)
   The floating Settings window. Its markup is gone, so this is inert; kept so
   callers still resolve. */

/* =========================================================
       Floating Settings window (drag + resize + geometry)
       ========================================================= */

const SETTINGS_WINDOW_MIN_W = 360;
const SETTINGS_WINDOW_MIN_H = 320;
const SETTINGS_WINDOW_GEOMETRY_KEY = "lg.settingsWindowGeometry";
const settingsWindowGeometry = { left: 0, top: 0, width: 720, height: 640 };
let settingsWindowGeometryLoaded = false;

function settingsFloatingEnabled() {
  return !IS_SETTINGS_WINDOW;
}

function settingsWindowViewportBounds() {
  return {
    w: Math.max(SETTINGS_WINDOW_MIN_W, window.innerWidth || 0),
    h: Math.max(SETTINGS_WINDOW_MIN_H, window.innerHeight || 0),
  };
}

function loadSettingsWindowGeometry() {
  if (settingsWindowGeometryLoaded) return;
  settingsWindowGeometryLoaded = true;
  try {
    const raw = window.localStorage?.getItem(SETTINGS_WINDOW_GEOMETRY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (Number.isFinite(parsed.width))
          settingsWindowGeometry.width = parsed.width;
        if (Number.isFinite(parsed.height))
          settingsWindowGeometry.height = parsed.height;
        if (Number.isFinite(parsed.left))
          settingsWindowGeometry.left = parsed.left;
        if (Number.isFinite(parsed.top)) settingsWindowGeometry.top = parsed.top;
        settingsWindowGeometry.placed = true;
      }
    }
  } catch {}
}

function saveSettingsWindowGeometry() {
  try {
    window.localStorage?.setItem(
      SETTINGS_WINDOW_GEOMETRY_KEY,
      JSON.stringify({
        left: Math.round(settingsWindowGeometry.left),
        top: Math.round(settingsWindowGeometry.top),
        width: Math.round(settingsWindowGeometry.width),
        height: Math.round(settingsWindowGeometry.height),
      }),
    );
  } catch {}
}

// Keep the window fully inside the app viewport. Called on open, drag, resize,
// and window resize so it can never end up off-screen or larger than the app.
function clampSettingsWindowGeometry() {
  const bounds = settingsWindowViewportBounds();
  const g = settingsWindowGeometry;
  g.width = Math.max(SETTINGS_WINDOW_MIN_W, Math.min(g.width, bounds.w));
  g.height = Math.max(SETTINGS_WINDOW_MIN_H, Math.min(g.height, bounds.h));
  g.left = Math.max(0, Math.min(g.left, bounds.w - g.width));
  g.top = Math.max(0, Math.min(g.top, bounds.h - g.height));
}

function applySettingsWindowGeometry() {
  if (!menuOverlay) return;
  clampSettingsWindowGeometry();
  const g = settingsWindowGeometry;
  menuOverlay.style.left = `${Math.round(g.left)}px`;
  menuOverlay.style.top = `${Math.round(g.top)}px`;
  menuOverlay.style.width = `${Math.round(g.width)}px`;
  menuOverlay.style.height = `${Math.round(g.height)}px`;
}

// On first open (or if never placed) centre the window in the app.
function ensureSettingsWindowGeometry() {
  loadSettingsWindowGeometry();
  if (!settingsWindowGeometry.placed) {
    const bounds = settingsWindowViewportBounds();
    settingsWindowGeometry.width = Math.min(
      settingsWindowGeometry.width,
      bounds.w - 40,
    );
    settingsWindowGeometry.height = Math.min(
      settingsWindowGeometry.height,
      bounds.h - 40,
    );
    settingsWindowGeometry.left = Math.round(
      (bounds.w - settingsWindowGeometry.width) / 2,
    );
    settingsWindowGeometry.top = Math.round(
      (bounds.h - settingsWindowGeometry.height) / 2,
    );
    settingsWindowGeometry.placed = true;
  }
  applySettingsWindowGeometry();
}

function initSettingsFloatingWindow() {
  if (!settingsFloatingEnabled() || !menuOverlay) return;
  const titleBar = document.getElementById("menuTitleBar");
  const closeBtn = document.getElementById("menuTitleClose");
  const handles = menuOverlay.querySelectorAll(".menuResizeHandle");

  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (MENU_OPEN) closeMenu();
    });
  }

  // Dragging the title bar moves the whole window (pointer capture so the drag
  // survives fast cursor moves and the pointer leaving the bar).
  if (titleBar) {
    titleBar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("#menuTitleClose")) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = settingsWindowGeometry.left;
      const startTop = settingsWindowGeometry.top;
      try {
        titleBar.setPointerCapture(e.pointerId);
      } catch {}
      const onMove = (ev) => {
        settingsWindowGeometry.left = startLeft + (ev.clientX - startX);
        settingsWindowGeometry.top = startTop + (ev.clientY - startY);
        applySettingsWindowGeometry();
      };
      const onUp = () => {
        titleBar.removeEventListener("pointermove", onMove);
        titleBar.removeEventListener("pointerup", onUp);
        titleBar.removeEventListener("pointercancel", onUp);
        saveSettingsWindowGeometry();
      };
      titleBar.addEventListener("pointermove", onMove);
      titleBar.addEventListener("pointerup", onUp);
      titleBar.addEventListener("pointercancel", onUp);
    });
  }

  handles.forEach((handle) => {
    const dir = handle.dataset.resize || "";
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const start = Object.assign({}, settingsWindowGeometry);
      const bounds = settingsWindowViewportBounds();
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {}
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const g = settingsWindowGeometry;
        if (dir.includes("e")) {
          g.width = Math.max(
            SETTINGS_WINDOW_MIN_W,
            Math.min(start.width + dx, bounds.w - start.left),
          );
        }
        if (dir.includes("s")) {
          g.height = Math.max(
            SETTINGS_WINDOW_MIN_H,
            Math.min(start.height + dy, bounds.h - start.top),
          );
        }
        if (dir.includes("w")) {
          const right = start.left + start.width;
          const nextLeft = Math.min(
            Math.max(0, start.left + dx),
            right - SETTINGS_WINDOW_MIN_W,
          );
          g.left = nextLeft;
          g.width = right - nextLeft;
        }
        if (dir.includes("n")) {
          const bottom = start.top + start.height;
          const nextTop = Math.min(
            Math.max(0, start.top + dy),
            bottom - SETTINGS_WINDOW_MIN_H,
          );
          g.top = nextTop;
          g.height = bottom - nextTop;
        }
        applySettingsWindowGeometry();
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        saveSettingsWindowGeometry();
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  });

  window.addEventListener("resize", () => {
    if (!MENU_OPEN) return;
    applySettingsWindowGeometry();
    saveSettingsWindowGeometry();
  });
}

// Settings pane removed — openMenu/closeMenu are inert. Callers that used to
// open Settings should go through toggleSettingsWindow / the app menu.
function openMenu(_tabId) {
  MENU_OPEN = false;
  KEYBIND_CAPTURE_ACTION_ID = "";
}

function closeMenu() {
  MENU_OPEN = false;
  KEYBIND_CAPTURE_ACTION_ID = "";
  const appEl = document.getElementById("app");
  if (appEl) {
    appEl.classList.remove("menu-pane-open");
    appEl.classList.toggle("no-side-panes", !directoriesPaneOpenEnabled());
  }
  if (previewContentEl) previewContentEl.classList.remove("menu-open");
}

// Settings pane is gone. These entry points open the app menu instead (Controls
// / History / Appearance all live there now).
function toggleSettingsWindow(_tabId) {
  if (typeof openAppMenuForSelectionKeybindAction === "function") {
    openAppMenuForSelectionKeybindAction();
  }
}
window.__lgToggleSettings = () => toggleSettingsWindow();

window.__lgOpenSettingsTab = (_tabId) => {
  toggleSettingsWindow();
};

if (optionsBtn) {
  optionsBtn.addEventListener("click", () => toggleSettingsWindow());
}
// menuOverlay is removed; floating-window init is a no-op when the node is gone.
initSettingsFloatingWindow();
if (menuTabButtons && menuTabButtons.length) {
  menuTabButtons.forEach((btn) => {
    btn.setAttribute("tabindex", "-1");
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab || "controls";
      setMenuTab(tab);
    });
  });
}
