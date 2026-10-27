/* Navigation watcher
   Catches the screen landing somewhere it should not and saves a report to
   Downloads. installNavWatch runs in boot.js, after debug mode. */

/* =========================================================
       Navigation watcher
       =========================================================

   A hunt for a rare bug: leaving a folder sometimes lands in another Model or
   the Trash instead of the folder above. It could not be made to happen on
   purpose, so the app watches for it and, when it sees one, writes a report
   to Downloads ("YYMMDD-HHMMSS - Navigation slip.md") and says so.

   What counts is anything that would look like a jump to the user:
   - an exit (the leave key, Escape) that lands anywhere but a folder above
     where you were -- another Model, the Trash, Favorites, a Tag -- or lands
     above it on the wrong card (not the folder you came out of);
   - a selection key that moves you to another place instead of another card,
     or an open key that lands outside the thing you opened;
   - the place on screen changing with no key pressed for a while.
   Keys that move you on purpose (folder steps, random jumps, the menus) are
   not judged. Tag and special views are judged only for where they lead out
   of, since their way back is their own.

   The report is a timeline of the last keys (with where each found you) and
   the navigation calls that ran, the exit's saved way back, and the debug
   report (state, options, recent events). It only observes: every wrapper
   returns exactly what the function did. */

const NAV_WATCH_TIMELINE_LIMIT = 300;
const NAV_WATCH_SETTLE_MS = 2500;
const NAV_WATCH_REPORT_GAP_MS = 120000;
const NAV_WATCH = {
  installed: false,
  timeline: [],
  pending: null,
  lastKeyAt: 0,
  baseline: null,
  lastReportAt: 0,
  missed: 0,
  saving: false,
};

// The navigation functions whose calls go in the timeline.
const NAV_WATCH_CALLS = Object.freeze([
  "leaveDirectory",
  "goDirUp",
  "enterSelectedDirectory",
  "navigateToDirectory",
  "enterMediaFolderWithQuickNavigation",
  "openSelectedPreviewItem",
  "closeFilePreviewToFolder",
  "exitUnbridgedOpenFileToSetSelection",
  "syncGridReturnStateToExitedFolder",
  "restorePreviewFolderBridgeState",
  "restoreViewerCloseState",
  "restorePanesClosedByFilePaneEnter",
  "tryRestoreTagDirectoryContext",
  "exitTagFolderView",
  "jumpToLocationTarget",
  "syncPreviewToSelection",
  "preserveActivePreviewTargetDuringDirectoriesRefresh",
  "restoreRefreshSelection",
  "refreshAfterTagMetadataChange",
  "refreshWorkspaceFromRootHandle",
  "resetWorkspace",
  "finishMediaOpenZoomNow",
  "viewerJumpToPrevFolderFirstFile",
  "viewerJumpToNextFolderFirstFile",
  "moveClosedFilePaneMediaSelection",
]);

const NAV_WATCH_EXIT_ACTIONS = new Set(["leaveDir", "back"]);
const NAV_WATCH_SELECT_ACTIONS = new Set([
  "selectUp",
  "selectDown",
  "selectLeft",
  "selectRight",
]);

function navWatchNote(kind, text) {
  NAV_WATCH.timeline.push({ t: debugModeTime(), kind, text: String(text || "") });
  if (NAV_WATCH.timeline.length > NAV_WATCH_TIMELINE_LIMIT)
    NAV_WATCH.timeline.splice(0, NAV_WATCH.timeline.length - NAV_WATCH_TIMELINE_LIMIT);
}

function navWatchReady() {
  return (
    !!WS.root &&
    !!LIBRARY_SETTINGS_LOADED &&
    !(typeof lockScreenIsOpen === "function" && lockScreenIsOpen())
  );
}

// Where the screen is: the folder it shows (an open file's own Set), whether
// that is through a Tag or special view, and the card selected.
function navWatchLocation() {
  const p = WS.preview || {};
  const view = WS.view || {};
  const node = debugModeSafe(() => previewLocationDirNode(), null);
  const fileOpen = !!(p.kind === "file" && p.fileId && debugModeSafe(() => previewMediaIsOpen(), false));
  const rec = p.kind === "file" && p.fileId ? WS.fileById.get(String(p.fileId)) : null;
  const viewed = !!(
    (node && node._skipTagFilters) ||
    (p.dirNode && p.dirNode._skipTagFilters) ||
    debugModeSafe(() => isViewingTagFolder(), false) ||
    (Array.isArray(view.tagNavStack) && view.tagNavStack.length) ||
    view.favoritesMode ||
    view.hiddenMode ||
    view.searchRootActive ||
    debugModeSafe(() => searchBrowsingResultFolder(), false)
  );
  const path = node && typeof node === "object" ? String(node.path || "") : "";
  return {
    path,
    viewed,
    fileOpen,
    fileId: rec ? String(rec.id || p.fileId) : "",
    filePath: rec ? String(rec.relPath || "") : "",
    sel: String(view.previewSelectedKey || ""),
    title: String(debugModeSafe(() => getPreviewLocationPathText(), "")),
    // What decides "the place" for a change with no key: the folder (or the
    // view, by its title) and whether a file is open.
    place: `${viewed ? `view:${debugModeSafe(() => getPreviewLocationPathText(), "")}` : `dir:${path}`}|${fileOpen ? "file" : "grid"}`,
  };
}

function navWatchDescribe(loc) {
  if (!loc) return "(nothing)";
  const where = loc.title || (loc.path ? `"${loc.path}"` : "the root");
  const what = loc.fileOpen ? `file ${loc.filePath}` : `grid, card ${loc.sel || "none"}`;
  return `${where} [${loc.viewed ? "view" : "folder"} "${loc.path}", ${what}]`;
}

// The saved way back an exit will use, in short.
function navWatchBridgeSummary() {
  const s = WS.view && WS.view.previewFolderBridgeReturnState;
  const parts = [];
  if (s) {
    parts.push(
      `bridge: dirPath="${s.dirPath || ""}" entryKey=${s.entryKey || "-"} preview=${s.previewState ? `${s.previewState.kind}:${s.previewState.path ?? s.previewState.fileId ?? ""}` : "-"} pendingSel=${s.pendingPreviewSelectionKey || "-"} tagStack=${Array.isArray(s.tagNavStack) ? s.tagNavStack.length : 0}`,
    );
  } else parts.push("bridge: none");
  parts.push(`fileSelectionBridge=${!!(WS.view && WS.view.previewFileSelectionBridgeActive)}`);
  parts.push(`filePane="${WS.nav?.dirNode?.path ?? "?"}"#${WS.nav?.selectedIndex ?? "-"}`);
  parts.push(`previewContext="${WS.preview?.dirNode?.path ?? "-"}"${WS.preview?.dirNode?._skipTagFilters ? " (view)" : ""}`);
  parts.push(`aboveRoot=${!!WS.view?.aboveRootView}`);
  return parts.join(" ");
}

function navWatchIsAtOrAbove(upper, lower) {
  if (upper === lower || upper === "") return true;
  return lower.startsWith(`${upper}/`);
}

// The card an exit should leave selected: the item, in the folder landed in,
// that holds where you were.
function navWatchExpectedCard(before, after) {
  if (after.path === before.path) return before.fileId ? `file:${before.fileId}` : "";
  const rest = after.path ? before.path.slice(after.path.length + 1) : before.path;
  const first = rest.split("/")[0];
  if (!first) return "";
  return `dir:${after.path ? `${after.path}/` : ""}${first}`;
}

// What looks wrong about where a key left you, or "".
function navWatchJudge(kind, before, after) {
  if (!before || !after) return "";
  // Out of a Tag or special view the way back is the view's own, so only a
  // landing in a plain folder that is not above where you were is wrong.
  if (before.viewed) {
    if (kind !== "exit" || after.viewed) return "";
    if (navWatchIsAtOrAbove(after.path, before.path)) return "";
    return "An exit from a Tag or special view landed outside the folders above where you were.";
  }
  if (kind === "exit") {
    if (after.viewed) return "An exit landed in a Tag or special view.";
    if (!navWatchIsAtOrAbove(after.path, before.path))
      return "An exit landed outside the folders above where you were.";
    if (after.fileOpen || after.path === before.path) return "";
    const want = navWatchExpectedCard(before, after);
    if (want && after.sel !== want)
      return `An exit landed on the wrong card (expected ${want}).`;
    return "";
  }
  if (kind === "select") {
    if (after.viewed) return "A selection key landed in a Tag or special view.";
    if (after.path === before.path) return "";
    // Stepping through open files may run on into the next Set of the Model.
    const parentOf = (p) => p.split("/").slice(0, -1).join("/");
    if (before.fileOpen && after.fileOpen && parentOf(after.path) === parentOf(before.path)) return "";
    return "A selection key moved you to another place.";
  }
  if (kind === "open") {
    if (after.viewed) {
      // Opening a Tag card goes into its view.
      return before.sel.startsWith("tag:") ? "" : "Opening an item landed in a Tag or special view.";
    }
    if (after.path === before.path || navWatchIsAtOrAbove(before.path, after.path)) return "";
    return "Opening an item landed outside it.";
  }
  return "";
}

function navWatchSettlePending() {
  const pending = NAV_WATCH.pending;
  if (!pending) return;
  NAV_WATCH.pending = null;
  clearTimeout(pending.timer);
  if (!navWatchReady()) return;
  const after = navWatchLocation();
  NAV_WATCH.baseline = after;
  navWatchNote("landed", `${pending.label} -> ${navWatchDescribe(after)}`);
  const problem = navWatchJudge(pending.kind, pending.before, after);
  if (problem) navWatchSlip(problem, pending, after);
}

function navWatchKeydown(e) {
  if (!NAV_WATCH.installed || !e) return;
  NAV_WATCH.lastKeyAt = performance.now();
  // The open key waits out its zoom (media/open-zoom.js) and this key will
  // run it first, so where it lands is the open's doing, not this key's: leave
  // the open's check to its timer and do not judge this key.
  const openWaiting = !!(MEDIA_OPEN_ZOOM_ACTIVE && !MEDIA_OPEN_ZOOM_ACTIVE.ran);
  if (!openWaiting) navWatchSettlePending();
  if (!navWatchReady()) return;
  const key = debugModeSafe(() => keybindValueFromEvent(e), "");
  if (!key) return;
  const inField = debugModeSafe(() => isTextInputTarget(e.target), false);
  const menuOpen = !!APP_MENU_STATE || !!MENU_OPEN;
  const elsewhere =
    inField ||
    debugModeSafe(() => variationsIsOpen(), false) ||
    !!DAILY_JOURNAL_STATE;
  const action = debugModeSafe(() => keybindActionFor(key), null) || "";
  const before = navWatchLocation();
  NAV_WATCH.baseline = before;
  if (!e.repeat || NAV_WATCH_EXIT_ACTIONS.has(action) || key === "Escape") {
    navWatchNote(
      "key",
      `${key}${action ? ` (${action})` : ""}${menuOpen ? " [menu]" : ""}${elsewhere ? " [typing/other]" : ""} at ${navWatchDescribe(before)}`,
    );
  }
  if (menuOpen || elsewhere || openWaiting || WS.view?.slideshowActive) return;
  let kind = "";
  if (key === "Escape" || NAV_WATCH_EXIT_ACTIONS.has(action)) kind = "exit";
  else if (NAV_WATCH_SELECT_ACTIONS.has(action)) kind = "select";
  else if (action === "enterDir") kind = "open";
  if (!kind) return;
  const label = `${key}${action ? ` (${action})` : ""}`;
  if (kind === "exit") navWatchNote("exit", navWatchBridgeSummary());
  const pending = { kind, label, key, before, bridge: kind === "exit" ? navWatchBridgeSummary() : "", timer: 0 };
  pending.timer = setTimeout(navWatchSettlePending, NAV_WATCH_SETTLE_MS);
  NAV_WATCH.pending = pending;
}

// The place on screen changing while no key has been pressed for a while.
function navWatchTick() {
  if (!navWatchReady()) {
    NAV_WATCH.baseline = null;
    return;
  }
  const now = navWatchLocation();
  const was = NAV_WATCH.baseline;
  NAV_WATCH.baseline = now;
  if (!was || NAV_WATCH.pending) return;
  if (performance.now() - NAV_WATCH.lastKeyAt < NAV_WATCH_SETTLE_MS) return;
  if (was.place === now.place) return;
  // A slideshow, or a video that moves on when it ends, steps by itself.
  if (WS.view?.slideshowActive) return;
  if (was.fileOpen && now.fileOpen) {
    const parentOf = (p) => p.split("/").slice(0, -1).join("/");
    if (was.path === now.path || parentOf(was.path) === parentOf(now.path)) return;
  }
  navWatchNote("moved", `with no key: ${navWatchDescribe(was)} -> ${navWatchDescribe(now)}`);
  navWatchSlip("The screen moved with no key pressed.", { kind: "none", label: "(no key)", before: was, bridge: "" }, now);
}

function navWatchFileName(d) {
  const two = (n) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).slice(2)}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())} - Navigation slip.md`;
}

function navWatchReport(problem, pending, after) {
  const lines = [];
  lines.push("# Local Gallery navigation slip");
  lines.push("");
  lines.push(`**${problem}**`);
  lines.push("");
  lines.push(`- When: ${new Date().toString()}`);
  lines.push(`- Key: ${pending.label}`);
  lines.push(`- Before: ${navWatchDescribe(pending.before)}`);
  lines.push(`- After: ${navWatchDescribe(after)}`);
  if (pending.bridge) lines.push(`- Way back saved before the exit: ${pending.bridge}`);
  lines.push(`- Now: ${navWatchBridgeSummary()}`);
  if (NAV_WATCH.missed) lines.push(`- Slips seen since the last report but not saved: ${NAV_WATCH.missed}`);
  lines.push("");
  lines.push(`## Timeline (oldest first, ${NAV_WATCH.timeline.length})`);
  lines.push("```");
  for (const e of NAV_WATCH.timeline) lines.push(`${e.t} ${e.kind.padEnd(6)} ${e.text}`);
  lines.push("```");
  lines.push("");
  lines.push(debugModeSafe(() => debugModeReport(), "(debug report unavailable)").replace(/^# /, "## "));
  return lines.join("\n");
}

function navWatchSlip(problem, pending, after) {
  debugModeLog("slip", problem, `${pending.label}: ${navWatchDescribe(pending.before)} -> ${navWatchDescribe(after)}`);
  const now = performance.now();
  if (NAV_WATCH.saving || (NAV_WATCH.lastReportAt && now - NAV_WATCH.lastReportAt < NAV_WATCH_REPORT_GAP_MS)) {
    NAV_WATCH.missed += 1;
    return;
  }
  NAV_WATCH.lastReportAt = now;
  const text = navWatchReport(problem, pending, after);
  NAV_WATCH.missed = 0;
  NAV_WATCH.saving = true;
  navWatchSave(navWatchFileName(new Date()), text)
    .then(() =>
      showStatusMessage("That looked like a wrong jump. A report was saved to Downloads.", "", {
        force: true,
      }),
    )
    .catch((err) => debugModeLog("slip", `could not save the report: ${err}`))
    .finally(() => {
      NAV_WATCH.saving = false;
    });
}

function navWatchSave(fileName, text) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") return Promise.reject("no app bridge");
  return invoke("write_download_file", {
    fileName,
    bytes: Array.from(new TextEncoder().encode(text)),
  });
}

function navWatchWrapCall(name) {
  const original = window[name];
  if (typeof original !== "function" || original.__lgNavWatched) return;
  const wrapped = function (...args) {
    const result = original.apply(this, args);
    try {
      let detail = "";
      if (name === "restoreViewerCloseState" && args[0]) {
        const s = args[0];
        detail = ` dirPath="${s.dirPath || ""}" entryKey=${s.entryKey || "-"} preview=${s.previewState ? `${s.previewState.kind}:${s.previewState.path ?? s.previewState.fileId ?? ""}` : "-"} pendingSel=${s.pendingPreviewSelectionKey || "-"}`;
      } else if (name === "syncPreviewToSelection" || name === "syncGridReturnStateToExitedFolder") {
        detail = args[0] && typeof args[0] === "object" && "force" in args[0] ? ` force=${!!args[0].force}` : args[0]?.path != null ? ` "${args[0].path}"` : "";
      } else if (name === "jumpToLocationTarget" || name === "navigateToDirectory") {
        const t = args[0];
        detail = t ? ` ${t.kind || ""} "${t.node?.path ?? t.path ?? t.fileId ?? ""}"` : "";
      }
      const shown = result && typeof result.then === "function" ? "(async)" : typeof result === "boolean" ? String(result) : "";
      // syncPreviewToSelection runs on every render; keep only the ones that moved something.
      if (name === "syncPreviewToSelection" && result === false) return result;
      navWatchNote("call", `${name}${detail}${shown ? ` -> ${shown}` : ""}`);
    } catch {}
    return result;
  };
  wrapped.__lgNavWatched = true;
  window[name] = wrapped;
}

function installNavWatch() {
  if (NAV_WATCH.installed) return;
  for (const name of NAV_WATCH_CALLS) navWatchWrapCall(name);
  window.addEventListener("keydown", navWatchKeydown, true);
  setInterval(navWatchTick, 500);
  NAV_WATCH.installed = true;
}
