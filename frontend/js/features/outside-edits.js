/* Editing from outside the app
   Noticing the tags file changed by an AI tool (library-ai/lg.py), doing the
   requests only the app can do, and the status file the tool reads. */

/* =========================================================
       Outside edits
       ========================================================= */

// An AI assistant changes Tags by running <library>/.local-gallery/ai/lg.py,
// which rewrites tags.log.json (atomically, after checking every change) and
// queues the few things only the app can finish -- a Tag rename or delete,
// Trash, Storage, following a folder moved on disk -- as JSON files in
// ai/requests. This file is the app's half:
//
// - Every OUTSIDE_EDITS_POLL_MS the tags file is stat'ed. When it changed and
//   holds something other than what the app last read or wrote, it is loaded
//   in place (metaApplyTagsDocLog) and the screen redrawn where it stands.
// - Before the app writes the tags file it checks the same thing, so a change
//   made outside in the last moments is never silently written over: it is
//   kept in ai/conflicts and the user is told.
// - Requests are run one file per tick with the app's own functions, and the
//   answer is written to ai/results.
// - ai/app-status.json says the app is open, whether a library is loaded and
//   which tags file it holds (a SHA-256), so the tool can wait for the app to
//   confirm a change.
//
// Nothing runs while the user is in the middle of something (a menu, an
// inline edit, a text field, the lock screen, Variations, the journal): the
// change waits for the next tick after.

const OUTSIDE_EDITS_POLL_MS = 1500;
const OUTSIDE_EDITS_STATUS_MS = 10000;
const OUTSIDE_EDITS_RESULTS_KEPT = 200;
const OUTSIDE_EDITS_MESSAGE_GAP_MS = 4000;

const OUTSIDE_EDITS = {
  started: false,
  ticking: false,
  // The tags document the app holds, as JSON.stringify writes it.
  knownCanon: null,
  // The file's size:mtime once it was seen to hold knownCanon; "" = not yet.
  knownSig: "",
  // A file that did not parse, left alone until it changes again.
  badSig: "",
  sha256: "",
  loadedAt: 0,
  lastReload: null,
  lastConflict: null,
  lastStatusAt: 0,
  lastMessageAt: 0,
  installedFor: "",
  // Request files being carried out in the background (collages).
  running: new Set(),
  aiDir: "",
  libraryRoot: "",
};

function outsideEditsInvoke(cmd, args) {
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!core || typeof core.invoke !== "function")
    return Promise.reject(new Error("no app bridge"));
  return core.invoke(cmd, args || {});
}

function outsideEditsTagsPath() {
  const fh =
    WS.meta && WS.meta.storageMode === "fs"
      ? metaFsHandleForDocId(META_DOC_IDS.tags)
      : null;
  return fh && fh._path ? String(fh._path) : "";
}

// Remembered past a reset, so the status file can still say "no library".
function outsideEditsRememberPaths() {
  const tagsPath = outsideEditsTagsPath();
  if (!tagsPath) return;
  const metaDir = tagsPath.replace(/\/[^/]+$/, "");
  OUTSIDE_EDITS.aiDir = `${metaDir}/ai`;
  OUTSIDE_EDITS.libraryRoot = metaDir.replace(/\/[^/]+$/, "");
}

function outsideEditsLibraryReady() {
  return (
    !!WS.root &&
    !!LIBRARY_SETTINGS_LOADED &&
    !!outsideEditsTagsPath() &&
    !(typeof lockScreenIsOpen === "function" && lockScreenIsOpen())
  );
}

// Why a change has to wait, or "" when the app can take it now.
function outsideEditsWaitReason() {
  if (APP_MENU_STATE) return "a menu is open";
  if (
    RENAME_EDIT_PATH ||
    RENAME_EDIT_FILE_ID ||
    TAG_EDIT_PATH ||
    TAG_ENTRY_RENAME_STATE ||
    BULK_TAG_PLACEHOLDER
  )
    return "a name is being edited";
  if (typeof DAILY_JOURNAL_STATE !== "undefined" && DAILY_JOURNAL_STATE)
    return "the journal is open";
  if (typeof variationsIsOpen === "function" && variationsIsOpen())
    return "Variations is open";
  if (typeof WORKSPACE_REFRESH_IN_FLIGHT !== "undefined" && WORKSPACE_REFRESH_IN_FLIGHT)
    return "the library is refreshing";
  if (document.getElementById("dailyJournalOverlay")) return "the journal is open";
  const active = document.activeElement;
  const tag = String((active && active.tagName) || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return "a text field is in use";
  return "";
}

/* --- What the app holds ---------------------------------------------------- */

// Where the app reads the tags file from disk.
function outsideEditsNoteTagsDocRead(log) {
  try {
    OUTSIDE_EDITS.knownCanon = log && typeof log === "object" ? JSON.stringify(log) : null;
  } catch {
    OUTSIDE_EDITS.knownCanon = null;
  }
  OUTSIDE_EDITS.knownSig = "";
  OUTSIDE_EDITS.loadedAt = Date.now();
}

// Where the app writes it.
function outsideEditsNoteTagsDocWritten(text) {
  OUTSIDE_EDITS.knownCanon = String(text || "") || null;
  OUTSIDE_EDITS.knownSig = "";
}

function outsideEditsSig(stat) {
  return stat ? `${stat.size}:${stat.mtime_ms}` : "";
}

async function outsideEditsReadFile(path) {
  const raw = await outsideEditsInvoke("read_file_bytes", { path });
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw || []);
  const text = new TextDecoder().decode(bytes);
  let log = null;
  try {
    log = JSON.parse(text);
  } catch {}
  const canon = log && typeof log === "object" ? JSON.stringify(log) : null;
  return { bytes, log, canon };
}

async function outsideEditsSha256(bytes) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

function outsideEditsStamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

function outsideEditsLog(message) {
  if (typeof debugModeLog === "function") debugModeLog("outside-edit", message);
}

function outsideEditsAnnounce(message, force = false) {
  const now = Date.now();
  if (!force && now - OUTSIDE_EDITS.lastMessageAt < OUTSIDE_EDITS_MESSAGE_GAP_MS) return;
  OUTSIDE_EDITS.lastMessageAt = now;
  showStatusMessage(message);
}

/* --- The tags file -------------------------------------------------------- */

async function outsideEditsCheckTagsFile() {
  const path = outsideEditsTagsPath();
  if (!path) return;
  const sig = outsideEditsSig(await outsideEditsInvoke("stat_path", { path }));
  if (!sig || sig === OUTSIDE_EDITS.knownSig || sig === OUTSIDE_EDITS.badSig) return;
  const disk = await outsideEditsReadFile(path);
  if (!disk.canon) {
    // Half-written by hand, or broken: leave it, and the app's own copy, alone.
    OUTSIDE_EDITS.badSig = sig;
    outsideEditsLog(`tags.log.json does not parse; not loading it (${sig})`);
    return;
  }
  OUTSIDE_EDITS.badSig = "";
  if (OUTSIDE_EDITS.knownCanon == null || disk.canon === OUTSIDE_EDITS.knownCanon) {
    OUTSIDE_EDITS.knownCanon = disk.canon;
    OUTSIDE_EDITS.knownSig = sig;
    const sha = await outsideEditsSha256(disk.bytes);
    if (sha !== OUTSIDE_EDITS.sha256) {
      OUTSIDE_EDITS.sha256 = sha;
      await outsideEditsWriteStatus();
    }
    return;
  }
  // Written by someone else. With a change of the app's own still waiting to
  // be saved, loading would lose it: the save's check keeps both instead.
  if (WS.meta.dirtyDocIds instanceof Set && WS.meta.dirtyDocIds.has(META_DOC_IDS.tags))
    return;
  if (outsideEditsWaitReason()) return;
  outsideEditsApplyTagsDoc(disk.log);
  OUTSIDE_EDITS.knownCanon = disk.canon;
  OUTSIDE_EDITS.knownSig = sig;
  OUTSIDE_EDITS.sha256 = await outsideEditsSha256(disk.bytes);
  OUTSIDE_EDITS.loadedAt = Date.now();
  OUTSIDE_EDITS.lastReload = { at: Date.now(), sha256: OUTSIDE_EDITS.sha256 };
  outsideEditsLog("loaded tags.log.json changed outside the app");
  await outsideEditsWriteStatus();
}

function outsideEditsApplyTagsDoc(log) {
  metaApplyTagsDocLog(log);
  if (metaPromotePendingFolderMetadata()) {
    metaMarkDirty(
      META_DOC_IDS.scores,
      META_DOC_IDS.tags,
      META_DOC_IDS.thumbnails,
      META_DOC_IDS.appearanceAssignments,
    );
  }
  invalidateHiddenVisibilityState();
  refreshAfterTagMetadataChange();
  outsideEditsAnnounce("Tags were changed outside the app. Updated.");
}

// Called by metaSaveFsNow just before it writes the tags file.
async function outsideEditsGuardTagsSave() {
  const path = outsideEditsTagsPath();
  if (!path || OUTSIDE_EDITS.knownCanon == null) return;
  try {
    const sig = outsideEditsSig(await outsideEditsInvoke("stat_path", { path }));
    if (!sig || sig === OUTSIDE_EDITS.knownSig) return;
    const disk = await outsideEditsReadFile(path);
    if (!disk.canon || disk.canon === OUTSIDE_EDITS.knownCanon) return;
    outsideEditsRememberPaths();
    const name = `${outsideEditsStamp()}-tags.log.json`;
    await outsideEditsInvoke("write_file_bytes", {
      path: `${OUTSIDE_EDITS.aiDir}/conflicts/${name}`,
      bytes: Array.from(disk.bytes),
    });
    OUTSIDE_EDITS.lastConflict = {
      at: Date.now(),
      file: `conflicts/${name}`,
      sha256: await outsideEditsSha256(disk.bytes),
    };
    outsideEditsLog(`outside tags change overwritten by the app's own; kept as ${name}`);
    outsideEditsAnnounce(
      "A tag change made outside the app clashed with yours. Yours was kept; the other is in .local-gallery/ai/conflicts.",
      true,
    );
  } catch (err) {
    outsideEditsLog(`save check failed: ${err}`);
  }
}

/* --- Requests ------------------------------------------------------------- */

async function outsideEditsRunRequests() {
  const dir = `${OUTSIDE_EDITS.aiDir}/requests`;
  let listing = null;
  try {
    listing = await outsideEditsInvoke("scan_dir", { path: dir });
  } catch {
    return; // no requests folder yet
  }
  const names = ((listing && listing.files) || [])
    .map((f) => String(f.name || ""))
    .filter((n) => n.endsWith(".json") && !n.startsWith("."))
    .sort();
  const name = names.find((n) => !OUTSIDE_EDITS.running.has(n));
  if (!name) return;
  let req = null;
  try {
    req = (await outsideEditsReadFile(`${dir}/${name}`)).log;
  } catch {}
  // Collages are drawn in the background and touch nothing on screen, so they
  // neither wait for the user nor hold up the requests and tag changes after
  // them.
  if (req && Array.isArray(req.ops) && req.ops.length && req.ops.every((op) => op && op.kind === "collages")) {
    OUTSIDE_EDITS.running.add(name);
    (async () => {
      const results = [];
      for (const op of req.ops) {
        try {
          results.push(await outsideEditsRunRequestOp(op, {}));
        } catch (err) {
          results.push({ kind: "collages", ok: false, message: String(err) });
        }
      }
      try {
        await outsideEditsFinishRequest(dir, name, req, results);
      } finally {
        OUTSIDE_EDITS.running.delete(name);
      }
    })();
    return;
  }
  if (outsideEditsWaitReason()) return;
  const results = [];
  const ctx = { refreshed: false, rerender: false };
  if (!req || !Array.isArray(req.ops)) {
    results.push({ ok: false, message: "The request file could not be read." });
  } else {
    for (const op of req.ops) {
      try {
        results.push(await outsideEditsRunRequestOp(op || {}, ctx));
      } catch (err) {
        results.push({ kind: op && op.kind, ok: false, message: String(err) });
      }
    }
  }
  if (ctx.rerender) refreshAfterTagMetadataChange();
  await flushPendingMetadataSaveNow();
  await outsideEditsFinishRequest(dir, name, req, results);
}

// Writes the answer to ai/results, takes the request away, and says so.
async function outsideEditsFinishRequest(dir, name, req, results) {
  const done = Object.assign({}, req || { id: name.replace(/\.json$/, "") }, {
    results,
    doneAt: Date.now(),
  });
  await outsideEditsInvoke("write_file_bytes", {
    path: `${OUTSIDE_EDITS.aiDir}/results/${name}`,
    bytes: Array.from(new TextEncoder().encode(JSON.stringify(done, null, 1))),
  });
  await outsideEditsInvoke("remove_path", { path: `${dir}/${name}`, recursive: false });
  await outsideEditsTrimResults();
  const failed = results.filter((r) => !r.ok).length;
  outsideEditsLog(`ran request ${name}: ${results.length - failed} ok, ${failed} failed`);
  outsideEditsAnnounce(
    failed
      ? `An outside request finished with ${failed} problem${failed === 1 ? "" : "s"}: ${results.find((r) => !r.ok).message}`
      : results.map((r) => r.message).join(" "),
    true,
  );
  await outsideEditsWriteStatus();
}

async function outsideEditsTrimResults() {
  const dir = `${OUTSIDE_EDITS.aiDir}/results`;
  try {
    const listing = await outsideEditsInvoke("scan_dir", { path: dir });
    const names = ((listing && listing.files) || [])
      .map((f) => String(f.name || ""))
      .filter((n) => n.endsWith(".json"))
      .sort();
    for (const n of names.slice(0, Math.max(0, names.length - OUTSIDE_EDITS_RESULTS_KEPT)))
      await outsideEditsInvoke("remove_path", { path: `${dir}/${n}`, recursive: false });
  } catch {}
}

function outsideEditsNodeExists(path) {
  return WS.dirByPath.has(path) || !!resolveDirNodeForPathOrStorageStub(path);
}

// A folder moved on disk while the app was open is not in the tree it holds:
// one refresh per request brings the tree up to date.
async function outsideEditsEnsureFresh(ctx, paths, stalePaths = []) {
  const missing = paths.some((p) => !outsideEditsNodeExists(p));
  const stale = stalePaths.some((p) => WS.dirByPath.has(p));
  if ((missing || stale) && !ctx.refreshed) {
    ctx.refreshed = true;
    await refreshWorkspaceFromRootHandle();
  }
}

async function outsideEditsRunRequestOp(op, ctx) {
  const kind = String(op.kind || "");
  const ok = (message) => ({ kind, ok: true, message });
  const fail = (message) => ({ kind, ok: false, message });
  const paths = Array.isArray(op.paths)
    ? op.paths.map((p) => normalizeDirPathValue(p)).filter(Boolean)
    : [];
  if (kind === "folder-moved") {
    const from = normalizeDirPathValue(op.from);
    const to = normalizeDirPathValue(op.to);
    if (!from || !to || from === to) return fail("A move needs two different paths.");
    await outsideEditsEnsureFresh(ctx, [to], [from]);
    if (WS.dirByPath.has(from)) return fail(`'${from}' is still in the library, so nothing moved.`);
    if (!outsideEditsNodeExists(to)) return fail(`'${to}' is not in the library.`);
    updateMetaPathsForRename(from, to);
    metaPromotePendingFolderMetadata();
    metaMarkDirty(
      META_DOC_IDS.scores,
      META_DOC_IDS.scoreHistory,
      META_DOC_IDS.tags,
      META_DOC_IDS.thumbnails,
      META_DOC_IDS.appearanceAssignments,
      META_DOC_IDS.prefGeneral,
    );
    invalidateDirMetricsCaches();
    ctx.rerender = true;
    return ok(`Everything known about '${from}' now belongs to '${to}'.`);
  }
  if (kind === "rename-tag") {
    const result = renameTagEverywhere(op.from, op.to);
    if (!result.ok)
      return fail(
        result.reason === "exists"
          ? `A Tag named '${normalizeTag(op.to)}' already exists.`
          : result.reason === "reserved"
            ? `'${normalizeTag(op.to)}' is a name Local Gallery uses itself.`
            : "The Tag name did not change.",
      );
    metaMarkDirty(META_DOC_IDS.tags);
    ctx.rerender = true;
    return ok(`Renamed Tag '${normalizeTag(op.from)}' to '${normalizeTag(op.to)}'.`);
  }
  if (kind === "delete-tag") {
    const tag = normalizeTag(op.tag);
    if (!tagNameExists(tag)) return fail(`There is no Tag '${tag}'.`);
    if (!deleteTagEverywhere(tag)) return fail(`The Tag '${tag}' could not be deleted.`);
    metaMarkDirty(META_DOC_IDS.tags);
    ctx.rerender = true;
    return ok(`Deleted Tag '${tag}'.`);
  }
  if (kind === "trash") {
    if (!paths.length) return fail("No folders to move to the Trash.");
    await outsideEditsEnsureFresh(ctx, paths);
    const gone = paths.filter((p) => !WS.dirByPath.has(p));
    if (gone.length) return fail(`Not in the library: ${gone.join(", ")}.`);
    if (!(await moveFolderPathsToTrash(paths)))
      return fail("The folders could not be moved to the Trash.");
    return ok(`Moved ${paths.length} folder${paths.length === 1 ? "" : "s"} to the Trash.`);
  }
  if (kind === "storage") {
    if (!paths.length) return fail("No folders for Storage.");
    await outsideEditsEnsureFresh(ctx, paths);
    const gone = paths.filter((p) => !outsideEditsNodeExists(p));
    if (gone.length) return fail(`Not in the library: ${gone.join(", ")}.`);
    if (!(await setStorageStateForFolderPaths(paths, !!op.on)))
      return fail("Storage could not be changed.");
    return ok(
      `${op.on ? "Sent" : "Took"} ${paths.length} folder${paths.length === 1 ? "" : "s"} ${op.on ? "to" : "out of"} Storage.`,
    );
  }
  if (kind === "collages") {
    const model = normalizeDirPathValue(op.model);
    const root = collageLibraryRoot();
    if (!model || model.includes("/") || !root) return fail("A collage request needs a Model.");
    if ((await outsideEditsInvoke("path_kind", { path: `${root}/${model}` })) !== "dir")
      return fail(`There is no Model '${model}'.`);
    const sets = Array.isArray(op.sets) ? op.sets.map((x) => String(x || "")).filter(Boolean) : null;
    const node = WS.dirByPath.get(model);
    const label = (node && dirDisplayName(node)) || model;
    while (COLLAGE_JOB) await new Promise((r) => setTimeout(r, 1000));
    const result = await makeCollagesForSets(root, model, label, sets);
    return Object.assign(
      result.stopped || result.failed.length ? fail(collageJobSummary(label, result)) : ok(collageJobSummary(label, result)),
      { made: result.made, total: result.total },
    );
  }
  return fail(`Unknown request '${kind}'.`);
}

/* --- Status, the guide, the poll ------------------------------------------ */

async function outsideEditsWriteStatus() {
  if (!OUTSIDE_EDITS.aiDir) return;
  OUTSIDE_EDITS.lastStatusAt = Date.now();
  const ready = outsideEditsLibraryReady();
  const status = {
    app: "Local Gallery",
    version: (typeof DEBUG_MODE !== "undefined" && DEBUG_MODE.version) || "",
    open: true,
    libraryOpen: ready,
    library: OUTSIDE_EDITS.libraryRoot,
    updatedAt: Date.now(),
    waitingBecause: ready ? outsideEditsWaitReason() : "the library is not open (locked or loading)",
    tagsDoc: { sha256: OUTSIDE_EDITS.sha256, loadedAt: OUTSIDE_EDITS.loadedAt },
    lastOutsideReload: OUTSIDE_EDITS.lastReload,
    lastConflict: OUTSIDE_EDITS.lastConflict,
    collages:
      typeof COLLAGE_JOB !== "undefined" && COLLAGE_JOB
        ? { model: COLLAGE_JOB.model, done: COLLAGE_JOB.done, total: COLLAGE_JOB.total }
        : null,
  };
  try {
    await outsideEditsInvoke("write_file_bytes", {
      path: `${OUTSIDE_EDITS.aiDir}/app-status.json`,
      bytes: Array.from(new TextEncoder().encode(JSON.stringify(status, null, 1))),
    });
  } catch {}
}

async function outsideEditsInstallGuide() {
  const root = OUTSIDE_EDITS.libraryRoot;
  if (!root || OUTSIDE_EDITS.installedFor === root) return;
  OUTSIDE_EDITS.installedFor = root;
  try {
    const written = await outsideEditsInvoke("library_ai_install", { root });
    if (written && written.length) outsideEditsLog(`AI instructions: ${written.join(", ")}`);
  } catch (err) {
    outsideEditsLog(`could not write the AI instructions: ${err}`);
  }
}

async function outsideEditsTick() {
  if (OUTSIDE_EDITS.ticking) return;
  OUTSIDE_EDITS.ticking = true;
  try {
    outsideEditsRememberPaths();
    if (outsideEditsLibraryReady()) {
      await outsideEditsInstallGuide();
      await outsideEditsCheckTagsFile();
      await outsideEditsRunRequests();
    }
    if (Date.now() - OUTSIDE_EDITS.lastStatusAt >= OUTSIDE_EDITS_STATUS_MS)
      await outsideEditsWriteStatus();
  } catch (err) {
    outsideEditsLog(String(err));
  } finally {
    OUTSIDE_EDITS.ticking = false;
    window.setTimeout(outsideEditsTick, OUTSIDE_EDITS_POLL_MS);
  }
}

// Started from boot.js, once everything it reaches has loaded.
function startOutsideEditsWatcher() {
  if (OUTSIDE_EDITS.started || !LG_HOST_IS_APP) return;
  if (!window.__TAURI__ || !window.__TAURI__.core) return;
  OUTSIDE_EDITS.started = true;
  window.setTimeout(outsideEditsTick, OUTSIDE_EDITS_POLL_MS);
}
