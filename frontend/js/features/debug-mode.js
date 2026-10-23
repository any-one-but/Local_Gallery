/* Debug mode
   The debug panel and log. installDebugMode runs in boot.js, right after the
   first render, where it always ran. */

/* =========================================================
       Debug mode
       =========================================================

   ` (or ~) toggles it; Option+` copies a debug report to the clipboard. Both
   are fixed keys (debugMode in KEYBIND_LOCKED_ACTIONS). The point is to make
   what the app is doing visible and easy to hand to a coding agent:

   - A panel with where you are (both panes, the grid cursor, the open file),
     the menu and any inline edit in progress, the library size, thumbnail
     work, render timings and frame rate, and the last key with the action it
     resolved to.
   - A log of recent errors, warnings, status messages, failed thumbnails and
     keys. It records even while the panel is off, so turning debug mode on
     after something went wrong still shows it.
   - Outlines on thumbnails: red dashed for one that failed and was replaced,
     amber for a slot still waiting on a picture.
   - window.__lgDebug: state(), report(), log, toggle(on) -- for an agent
     driving the page.

   It only observes. Nothing here changes what the app does, and with the panel
   off the cost is a few array pushes. */
const DEBUG_MODE_LOG_LIMIT = 200;
const DEBUG_MODE_LOG = [];
const DEBUG_MODE_STORAGE_KEY = "lgDebugMode";
const DEBUG_MODE = {
  on: false,
  hud: null,
  timer: 0,
  raf: 0,
  lastKey: "",
  flash: "",
  flashUntil: 0,
  frames: [],
  lastFrameAt: 0,
  worstFrameMs: 0,
  renders: new Map(),
  version: "",
};

function debugModeTime() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function debugModeShort(value, max = 240) {
  let text;
  if (typeof value === "string") text = value;
  else if (value instanceof Error) text = value.stack || value.message;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = String(text == null ? "" : text);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function debugModeLog(kind, message, detail = null) {
  try {
    DEBUG_MODE_LOG.push({
      t: debugModeTime(),
      kind: String(kind || "info"),
      message: debugModeShort(message),
      detail: detail == null ? "" : debugModeShort(detail, 400),
    });
    if (DEBUG_MODE_LOG.length > DEBUG_MODE_LOG_LIMIT)
      DEBUG_MODE_LOG.splice(0, DEBUG_MODE_LOG.length - DEBUG_MODE_LOG_LIMIT);
  } catch {}
}

function debugModeSafe(fn, fallback = "") {
  try {
    const v = fn();
    return v == null ? fallback : v;
  } catch (err) {
    return `(error: ${debugModeShort(err?.message || err, 60)})`;
  }
}

function debugModeState() {
  const nav = WS.nav || {};
  const view = WS.view || {};
  const preview = WS.preview || {};
  const selectedEntry = debugModeSafe(() => {
    const e = nav.entries?.[nav.selectedIndex];
    if (!e) return "";
    if (e.kind === "dir") return `folder "${e.node?.path || "(root)"}"`;
    if (e.kind === "file") return `file "${WS.fileById.get(e.id)?.relPath || e.id}"`;
    return `${e.kind}:${e.tag || e.label || ""}`;
  });
  const openFile = debugModeSafe(() => {
    const rec = preview.fileId ? WS.fileById.get(preview.fileId) : null;
    return rec ? `${rec.relPath} (${rec.type})` : "";
  });
  const menuEl = typeof appActionMenuEl !== "undefined" ? appActionMenuEl : null;
  const menuOpen = !!menuEl?.classList?.contains("open");
  const edits = [];
  if (RENAME_EDIT_PATH != null) edits.push(`rename folder "${RENAME_EDIT_PATH}"`);
  if (RENAME_EDIT_FILE_ID != null) edits.push(`rename file ${RENAME_EDIT_FILE_ID}`);
  if (TAG_EDIT_PATH != null) edits.push(`tag "${TAG_EDIT_PATH}"`);
  if (TAG_ENTRY_RENAME_STATE) edits.push("tag name field");
  if (BULK_TAG_PLACEHOLDER) edits.push("bulk tag field");
  const bulkCount =
    (view.bulkTagSelectedPaths?.size || 0) +
    (view.bulkTagFolderSelectedKeys?.size || 0) +
    (view.bulkFileSelectedIds?.size || 0);
  const thumbs = debugModeSafe(() => thumbActiveCounts(), { img: 0, video: 0 });
  const renders = {};
  for (const [name, st] of DEBUG_MODE.renders) {
    renders[name] = `${st.count}x, last ${st.last.toFixed(1)}ms, worst ${st.worst.toFixed(1)}ms`;
  }
  const mem = performance?.memory;
  return {
    app: {
      version: DEBUG_MODE.version || "",
      host: LG_HOST_IS_APP ? "desktop app" : "browser",
      window: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
      theme: document.documentElement.getAttribute("data-theme") || "",
      locked: debugModeSafe(() => lockScreenIsOpen(), false),
    },
    location: {
      title: debugModeSafe(() => getPreviewLocationPathText()),
      "file pane": WS.root ? `"${nav.dirNode?.path || "(root)"}"` : "(no library)",
      "list cursor": `${nav.selectedIndex ?? "-"} of ${nav.entries?.length ?? 0}, ${selectedEntry || "nothing"}`,
      preview: `${preview.kind || "-"} "${preview.dirNode?.path || "(root)"}"`,
      "open file": openFile || "none",
      "grid cursor": view.previewSelectedKey || "none",
      "active pane": view.activePane || "",
      "way back": debugModeSafe(() => view.previewFolderBridgeReturnState ? "return bridge set" : "none"),
    },
    ui: {
      menu: menuOpen ? `open (${APP_MENU_MODE})${APP_MENU_CONFIRM ? ", confirming" : ""}` : "closed",
      "inline edit": edits.join(", ") || "none",
      "multi-select": view.bulkSelectMode || bulkCount ? `${bulkCount} selected` : "none",
      filter: `${view.filterMode || "all"}${["models", "sets", "files"].filter(randomOrderOn).map((k) => `, random ${k.slice(0, -1)} order`).join("")}`,
      focus: debugModeSafe(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return "page";
        return `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}${a.className && typeof a.className === "string" ? "." + a.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
      }),
    },
    library: {
      root: WS.root ? String(WS.root.name || "") : "",
      folders: WS.dirByPath?.size || 0,
      files: WS.fileById?.size || 0,
      catalog: WS.catalog?.enabled ? "deferred catalog" : "fully loaded",
    },
    thumbnails: {
      loading: `${thumbs.img} images, ${thumbs.video} videos`,
      "failed (red)": document.querySelectorAll("[data-broken-thumb]").length,
      "waiting (amber)": document.querySelectorAll(".thumbIconPending").length,
      "cached thumbs": debugModeSafe(() => TAURI_THUMB_INDEX.size, 0),
    },
    performance: {
      fps: debugModeFps(),
      worstFrame: `${Math.round(DEBUG_MODE.worstFrameMs)}ms (last 5s)`,
      domNodes: document.getElementsByTagName("*").length,
      heap: mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB` : "n/a",
      renders,
    },
    lastKey: DEBUG_MODE.lastKey,
  };
}

function debugModeFps() {
  const now = performance.now();
  DEBUG_MODE.frames = DEBUG_MODE.frames.filter((t) => now - t < 1000);
  return DEBUG_MODE.on ? DEBUG_MODE.frames.length : "n/a";
}

function debugModeFrame(now) {
  DEBUG_MODE.raf = 0;
  if (!DEBUG_MODE.on) return;
  if (DEBUG_MODE.lastFrameAt) {
    const gap = now - DEBUG_MODE.lastFrameAt;
    if (gap > DEBUG_MODE.worstFrameMs) DEBUG_MODE.worstFrameMs = gap;
    // A frame that took over a quarter second is the app visibly freezing.
    if (gap > 250 && !document.hidden)
      debugModeLog("warn", `main thread blocked for ${Math.round(gap)}ms`);
  }
  DEBUG_MODE.lastFrameAt = now;
  DEBUG_MODE.frames.push(now);
  if (DEBUG_MODE.frames.length > 240) DEBUG_MODE.frames.splice(0, 120);
  DEBUG_MODE.raf = requestAnimationFrame(debugModeFrame);
}

const DEBUG_MODE_RENDER_LABELS = Object.freeze({
  renderPreviewPane: "grid render",
  renderDirectoriesPane: "list render",
  rebuildDirectoriesEntries: "list rebuild",
});

function debugModeHudHtml() {
  const s = debugModeState();
  const esc = escapeHtml;
  const row = (k, v) =>
    `<div class="dbgRow"><span class="dbgKey">${esc(k)}</span><span class="dbgVal" title="">${esc(String(v ?? ""))}</span></div>`;
  const section = (title, obj) =>
    `<div class="dbgSection"><div class="dbgSectionTitle">${esc(title)}</div>${Object.entries(obj)
      .map(([k, v]) => (v && typeof v === "object" ? "" : row(k, v)))
      .join("")}</div>`;
  const renderRows = Object.entries(s.performance.renders)
    .map(([k, v]) => row(DEBUG_MODE_RENDER_LABELS[k] || k, v))
    .join("");
  const log = DEBUG_MODE_LOG.slice(-10)
    .reverse()
    .map((e) => {
      const cls = e.kind === "error" ? " dbgError" : e.kind === "warn" ? " dbgWarn" : "";
      return `<div class="dbgLogLine${cls}">${esc(`${e.t} ${e.kind}  ${e.message}`)}</div>`;
    })
    .join("");
  const flash =
    DEBUG_MODE.flash && performance.now() < DEBUG_MODE.flashUntil
      ? `<div class="dbgFlash">${esc(DEBUG_MODE.flash)}</div>`
      : "";
  return (
    `<div class="dbgHead"><span class="dbgTitle">Debug mode</span><span class="dbgHint">\` hide · \u2325\` copy report</span></div>` +
    section("Where", s.location) +
    section("Interface", Object.assign({ "last key": s.lastKey || "-" }, s.ui)) +
    section("Library", s.library) +
    section("Thumbnails", s.thumbnails) +
    `<div class="dbgSection"><div class="dbgSectionTitle">Performance</div>${row("fps", s.performance.fps)}${row("worst frame", s.performance.worstFrame)}${row("page nodes", s.performance.domNodes)}${row("memory", s.performance.heap)}${renderRows}</div>` +
    `<div class="dbgSection"><div class="dbgSectionTitle">Recent events</div><div class="dbgLog">${log || "Nothing yet."}</div></div>` +
    flash
  );
}

function debugModeRefreshHud() {
  if (!DEBUG_MODE.on || !DEBUG_MODE.hud) return;
  try {
    DEBUG_MODE.hud.innerHTML = debugModeHudHtml();
  } catch (err) {
    DEBUG_MODE.hud.textContent = `Debug panel failed: ${err?.message || err}`;
  }
}

function debugModeSetEnabled(on, opts = null) {
  const next = !!on;
  DEBUG_MODE.on = next;
  document.documentElement.classList.toggle("lgDebugMode", next);
  try {
    if (next) localStorage.setItem(DEBUG_MODE_STORAGE_KEY, "1");
    else localStorage.removeItem(DEBUG_MODE_STORAGE_KEY);
  } catch {}
  if (next) {
    if (!DEBUG_MODE.hud) {
      DEBUG_MODE.hud = document.createElement("div");
      DEBUG_MODE.hud.id = "lgDebugHud";
      DEBUG_MODE.hud.setAttribute("aria-hidden", "true");
      document.body.appendChild(DEBUG_MODE.hud);
    }
    DEBUG_MODE.worstFrameMs = 0;
    DEBUG_MODE.lastFrameAt = 0;
    if (!DEBUG_MODE.timer) {
      DEBUG_MODE.timer = setInterval(() => {
        DEBUG_MODE.worstFrameMs *= 0.64; // drifts back down over ~5s
        debugModeRefreshHud();
      }, 500);
    }
    if (!DEBUG_MODE.raf) DEBUG_MODE.raf = requestAnimationFrame(debugModeFrame);
    debugModeRefreshHud();
  } else {
    if (DEBUG_MODE.timer) clearInterval(DEBUG_MODE.timer);
    if (DEBUG_MODE.raf) cancelAnimationFrame(DEBUG_MODE.raf);
    DEBUG_MODE.timer = 0;
    DEBUG_MODE.raf = 0;
  }
  if (!opts?.silent)
    showStatusMessage(next ? "Debug mode on." : "Debug mode off.", "", { force: true });
}

function debugModeReport() {
  const lines = [];
  lines.push("# Local Gallery debug report");
  lines.push(`Taken: ${new Date().toString()}`);
  lines.push(`User agent: ${navigator.userAgent}`);
  lines.push("");
  lines.push("## State");
  lines.push("```json");
  lines.push(JSON.stringify(debugModeState(), null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Options");
  lines.push("```json");
  lines.push(debugModeSafe(() => JSON.stringify(WS.meta?.options || {}, null, 2), "{}"));
  lines.push("```");
  lines.push("");
  lines.push(`## Recent events (oldest first, ${DEBUG_MODE_LOG.length})`);
  lines.push("```");
  for (const e of DEBUG_MODE_LOG) {
    lines.push(`${e.t} ${e.kind.padEnd(6)} ${e.message}${e.detail ? `\n    ${e.detail}` : ""}`);
  }
  lines.push("```");
  return lines.join("\n");
}

async function debugModeCopyReport() {
  const text = debugModeReport();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch {}
  }
  DEBUG_MODE.flash = ok
    ? "Report copied. Paste it to your coding agent."
    : "Could not copy the report.";
  DEBUG_MODE.flashUntil = performance.now() + 4000;
  debugModeRefreshHud();
  showStatusMessage(ok ? "Debug report copied." : "Could not copy the debug report.", "", {
    force: true,
  });
}

function debugModeKeyIsToggle(e) {
  return e.code === "Backquote" || e.key === "`" || e.key === "~";
}

// Timing wrapper for the big render entry points. Assigning to a top-level
// function name replaces it for every caller, which is what makes this work.
function debugModeWrapRender(name) {
  const original = window[name];
  if (typeof original !== "function" || original.__lgDebugWrapped) return;
  const wrapped = function (...args) {
    const start = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      const ms = performance.now() - start;
      let st = DEBUG_MODE.renders.get(name);
      if (!st) {
        st = { count: 0, last: 0, worst: 0 };
        DEBUG_MODE.renders.set(name, st);
      }
      st.count++;
      st.last = ms;
      if (ms > st.worst) st.worst = ms;
      if (ms > 120) debugModeLog("warn", `${name} took ${Math.round(ms)}ms`);
    }
  };
  wrapped.__lgDebugWrapped = true;
  window[name] = wrapped;
}
