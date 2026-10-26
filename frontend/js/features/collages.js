/* Collages (contact sheets)
   "Create collage" and "Create collages for all sets" in Folder options: the
   contact sheets AI assistants make with lg.py, drawn by the app. */

/* =========================================================
       Collages
       ========================================================= */

// A collage is a contact sheet of one Set: every photo in file-name order,
// labelled p1, p2..., and each video as a row of frames labelled v1, v2...
// They are kept for AI assistants (see "Editing from outside the app" in
// CLAUDE.md) in <library>/.local-gallery/ai/models/<Model>/sheets/, with
// index.json beside them recording what the Set's files were when its
// collage was made. library-ai/lg.py (`sheets`, make_sheets) draws the same
// thing and reads the same index, so a collage made by either is current for
// both. **The layout, the file names, the photo order and the signature must
// stay in step with lg.py**: COLLAGE_LAYOUT is its SHEET_* constants,
// collageNaturalCompare its natural_key, collageSignature its set_media.
//
// Nothing here is shown in the app; the collages are for AI assistants.

const COLLAGE_LAYOUT = Object.freeze({
  width: 1440,
  columns: 6,
  cellHeight: 360,
  labelHeight: 18,
  headerHeight: 32,
  rowsPerSheet: 4,
  videoFrames: 6,
  background: "rgb(24, 24, 24)",
  headInk: "rgb(250, 214, 60)",
  labelInk: "rgb(175, 175, 175)",
  videoInk: "rgb(125, 190, 255)",
  font: '-apple-system, "SF Pro Text", "Helvetica Neue", sans-serif',
  jpegQuality: 0.85,
});
const COLLAGE_IMAGE_RE = /\.(jpe?g|png|gif|webp|tiff?|bmp|avif|heic)$/i;
const COLLAGE_VIDEO_RE = /\.(mp4|m4v|mov|wmv|flv|avi|webm|mkv)$/i;
// Pictures decoded at once while a collage is drawn.
const COLLAGE_DECODE_AT_ONCE = 6;

// The Model run in the background, or null. One at a time.
let COLLAGE_JOB = null;

function collageLibraryRoot() {
  if (typeof outsideEditsRememberPaths === "function") outsideEditsRememberPaths();
  return (typeof OUTSIDE_EDITS !== "undefined" && OUTSIDE_EDITS.libraryRoot) || "";
}

function collageModelDir(root, model) {
  return `${root}/.local-gallery/ai/models/${model}`;
}

// lg.py's natural_key: runs of digits compare as numbers, the rest as
// lower-cased text, a number before text at the same place.
function collageNaturalParts(name) {
  return String(name || "")
    .normalize("NFC")
    .toLowerCase()
    .split(/(\d+)/)
    .map((part) => (/^\d+$/.test(part) ? [0, Number(part)] : [1, part]));
}

function collageNaturalCompare(a, b) {
  const pa = collageNaturalParts(a);
  const pb = collageNaturalParts(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i][0] !== pb[i][0]) return pa[i][0] - pb[i][0];
    if (pa[i][1] < pb[i][1]) return -1;
    if (pa[i][1] > pb[i][1]) return 1;
  }
  return pa.length - pb.length;
}

function collageAltBase(name) {
  const i = name.lastIndexOf(" -- ");
  if (i <= 0) return "";
  const base = name.slice(0, i);
  const label = name.slice(i + 4);
  return base.trim() && label.trim() ? base : "";
}

// The Sets of a Model as lg.py lists them: the folders on disk, ALTs folded
// into their Original, in name order.
async function collageModelSets(root, model) {
  const listing = await outsideEditsInvoke("scan_dir", { path: `${root}/${model}` });
  const names = ((listing && listing.dirs) || []).filter((n) => !String(n).startsWith("."));
  const have = new Set(names);
  return names
    .filter((n) => {
      const base = collageAltBase(n);
      return !(base && have.has(base));
    })
    .sort(collageNaturalCompare);
}

async function collageSignature(images, videos) {
  const text = images.concat(videos).map((f) => `${f.name.normalize("NFC")}|${f.size}\n`).join("");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

async function collageSetMedia(root, model, set) {
  const listing = await outsideEditsInvoke("scan_dir", { path: `${root}/${model}/${set}` });
  const files = ((listing && listing.files) || []).filter((f) => !String(f.name).startsWith("."));
  const byName = (a, b) => collageNaturalCompare(a.name, b.name);
  const images = files.filter((f) => COLLAGE_IMAGE_RE.test(f.name)).sort(byName);
  const videos = files.filter((f) => !COLLAGE_IMAGE_RE.test(f.name) && COLLAGE_VIDEO_RE.test(f.name)).sort(byName);
  return { images, videos, signature: await collageSignature(images, videos) };
}

async function collageReadIndex(root, model) {
  try {
    const raw = await outsideEditsInvoke("read_file_bytes", { path: `${collageModelDir(root, model)}/index.json` });
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw || [])));
    if (data && typeof data === "object" && data.sets && typeof data.sets === "object") return data;
  } catch {}
  return { schema: 1, model, sets: {} };
}

function collageLocalStamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

// Read again right before writing, so a record lg.py wrote meanwhile (a
// description) is kept.
async function collageRecordInIndex(root, model, set, update) {
  const index = await collageReadIndex(root, model);
  index.model = model;
  index.sets[set] = Object.assign({}, index.sets[set] || {}, update);
  index.updatedAt = collageLocalStamp();
  await outsideEditsInvoke("write_file_bytes", {
    path: `${collageModelDir(root, model)}/index.json`,
    bytes: new TextEncoder().encode(JSON.stringify(index, null, 1)),
  });
}

async function collageFileExists(path) {
  try {
    return (await outsideEditsInvoke("path_kind", { path })) === "file";
  } catch {
    return false;
  }
}

// lg.py's sheet_names.
function collageSheetNames(set, count, ext) {
  let base = set;
  const bytes = (s) => new TextEncoder().encode(s).length;
  while (base && bytes(`${base} (sheet 99 of 99)${ext}`) > 250) base = base.slice(0, -1);
  if (count === 1) return [`${base}${ext}`];
  return Array.from({ length: count }, (_, k) => `${base} (sheet ${k + 1} of ${count})${ext}`);
}

async function collageBitmapFromBytes(raw) {
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw || []);
  return await createImageBitmap(new Blob([bytes]));
}

// A picture fitted into the cell, never enlarged (lg.py uses Pillow's
// thumbnail). Pictures Chromium cannot draw go through ffmpeg.
async function collageLoadPicture(path, boxW, boxH) {
  try {
    const res = await fetch(window.__lg.assetUrl(path));
    if (!res.ok) throw new Error(String(res.status));
    const bitmap = await createImageBitmap(await res.blob());
    const scale = Math.min(1, boxW / bitmap.width, boxH / bitmap.height);
    return { bitmap, w: Math.max(1, Math.round(bitmap.width * scale)), h: Math.max(1, Math.round(bitmap.height * scale)) };
  } catch {}
  return await collageLoadFrame(path, 0, boxW, boxH);
}

async function collageLoadFrame(path, at, boxW, boxH) {
  try {
    const raw = await outsideEditsInvoke("collage_frame", { path, at, width: boxW, height: boxH });
    const bitmap = await collageBitmapFromBytes(raw);
    return { bitmap, w: bitmap.width, h: bitmap.height };
  } catch {
    return null;
  }
}

async function collageVideoDuration(path) {
  try {
    const timing = await outsideEditsInvoke("probe_video_timing", { path });
    return Number(timing && timing.duration) || 0;
  } catch {
    return 0;
  }
}

async function collageMapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Rows in sheet order: rows of up to six photos, then a row per video.
function collageRows(media) {
  const rows = [];
  const photos = media.images.map((f, i) => ({ label: `p${i + 1}`, file: f }));
  for (let i = 0; i < photos.length; i += COLLAGE_LAYOUT.columns)
    rows.push({ kind: "photos", cells: photos.slice(i, i + COLLAGE_LAYOUT.columns) });
  media.videos.forEach((f, i) => rows.push({ kind: "video", label: `v${i + 1}`, file: f }));
  return rows;
}

// Draws the Set's collages and writes them; answers their file names.
async function drawCollagesForSet(root, model, set, media, sheetsDir, ext) {
  const L = COLLAGE_LAYOUT;
  const rows = collageRows(media);
  const count = Math.ceil(rows.length / L.rowsPerSheet);
  const per = Math.ceil(rows.length / count);
  const names = collageSheetNames(set, count, ext);
  const cellW = Math.floor(L.width / L.columns);
  const boxW = cellW - 6;
  const boxH = L.cellHeight - L.labelHeight - 6;
  const folder = `${root}/${model}/${set}`;
  for (let k = 0; k < count; k++) {
    const part = rows.slice(k * per, (k + 1) * per);
    const canvas = new OffscreenCanvas(L.width, L.headerHeight + L.cellHeight * part.length);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = L.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.textBaseline = "top";
    ctx.font = `20px ${L.font}`;
    ctx.fillStyle = L.headInk;
    ctx.fillText(
      `${set}  [${media.images.length} img, ${media.videos.length} vid]  sheet ${k + 1}/${count}`,
      8,
      6,
    );
    for (let r = 0; r < part.length; r++) {
      const row = part[r];
      const y = L.headerHeight + r * L.cellHeight;
      let cells;
      let ink;
      if (row.kind === "photos") {
        ink = L.labelInk;
        cells = await collageMapLimited(row.cells, COLLAGE_DECODE_AT_ONCE, async (c) => ({
          label: c.label,
          pic: await collageLoadPicture(`${folder}/${c.file.name}`, boxW, boxH),
        }));
      } else {
        ink = L.videoInk;
        const path = `${folder}/${row.file.name}`;
        const dur = await collageVideoDuration(path);
        const times = Array.from({ length: L.videoFrames }, (_, i) => (dur * (i + 0.5)) / L.videoFrames);
        cells = await collageMapLimited(times, COLLAGE_DECODE_AT_ONCE, async (at) => ({
          label: `${row.label} ${at.toFixed(1)}/${Math.round(dur)}s`,
          pic: await collageLoadFrame(path, at, boxW, boxH),
        }));
      }
      ctx.font = `13px ${L.font}`;
      cells.forEach((cell, c) => {
        const x = c * cellW;
        ctx.fillStyle = ink;
        ctx.fillText(cell.label, x + 4, y + 1);
        if (!cell.pic) {
          ctx.fillStyle = L.labelInk;
          ctx.fillText("(could not be read)", x + 10, y + Math.floor(L.cellHeight / 2));
          return;
        }
        const { bitmap, w, h } = cell.pic;
        const ox = x + Math.floor((cellW - w) / 2);
        const oy = y + L.labelHeight + Math.floor((L.cellHeight - L.labelHeight - h) / 2);
        ctx.drawImage(bitmap, ox, oy, w, h);
        bitmap.close();
      });
    }
    const blob =
      ext === ".png"
        ? await canvas.convertToBlob({ type: "image/png" })
        : await canvas.convertToBlob({ type: "image/jpeg", quality: L.jpegQuality });
    await outsideEditsInvoke("write_file_bytes", {
      path: `${sheetsDir}/${names[k]}`,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  return names;
}

// Makes one Set's collage. Answers { ok, made, message }.
async function makeCollageForSet(root, model, set, options = {}) {
  const kind = await outsideEditsInvoke("path_kind", { path: `${root}/${model}/${set}` });
  if (kind !== "dir")
    return { ok: false, message: `'${set}' is not on disk under its own name (an ALT only?), so it has no collage.` };
  const media = await collageSetMedia(root, model, set);
  if (!media.images.length && !media.videos.length)
    return { ok: false, message: `'${set}' has no photos or videos.` };
  const index = await collageReadIndex(root, model);
  const rec = index.sets[set] || {};
  const dir = collageModelDir(root, model);
  const oldSheets = (rec.sheets || []).map((rel) => `${dir}/${rel}`);
  if (options.onlyIfStale && rec.sheetsFor === media.signature && oldSheets.length) {
    let present = true;
    for (const p of oldSheets) if (!(await collageFileExists(p))) present = false;
    if (present) return { ok: true, made: false, message: "current" };
  }
  const ext = oldSheets.length && /\.png$/i.test(oldSheets[0]) ? ".png" : ".jpg";
  const names = await drawCollagesForSet(root, model, set, media, `${dir}/sheets`, ext);
  for (const p of oldSheets) {
    const name = p.slice(p.lastIndexOf("/") + 1);
    if (!names.includes(name)) await outsideEditsInvoke("remove_path", { path: p, recursive: false }).catch(() => {});
  }
  await collageRecordInIndex(root, model, set, {
    sheets: names.map((n) => `sheets/${n}`),
    sheetsFor: media.signature,
    signature: media.signature,
    images: media.images.length,
    videos: media.videos.length,
  });
  return { ok: true, made: true, message: `Made ${names.length === 1 ? "a collage" : `${names.length} collages`} of ${media.images.length + media.videos.length} files.` };
}

function collagePathParts(dirNode) {
  const path = normalizeDirPathValue(dirNode && dirNode.path);
  if (!path || isPathInsideInternalTrash(path)) return null;
  const parts = path.split("/");
  return parts.length <= 2 ? parts : null;
}

async function runCreateCollage(dirNode) {
  const parts = collagePathParts(dirNode);
  const root = collageLibraryRoot();
  if (!parts || parts.length !== 2 || !root) return;
  const [model, set] = parts;
  const label = dirDisplayName(dirNode) || set;
  if (COLLAGE_JOB && COLLAGE_JOB.model === model) {
    showStatusMessage(`Still making collages for ${COLLAGE_JOB.label} (${COLLAGE_JOB.done} of ${COLLAGE_JOB.total}).`);
    return;
  }
  showStatusMessage(`Making a collage of '${label}'...`);
  try {
    const res = await makeCollageForSet(root, model, set);
    showStatusMessage(res.ok ? `'${label}': ${res.message}` : res.message);
  } catch (err) {
    showStatusMessage(`The collage of '${label}' could not be made (${err}).`);
    if (typeof debugModeLog === "function") debugModeLog("collage", `${model}/${set}: ${err}`);
  }
}

async function runCreateCollagesForModel(dirNode) {
  const parts = collagePathParts(dirNode);
  const root = collageLibraryRoot();
  if (!parts || parts.length !== 1 || !root) return;
  const model = parts[0];
  const label = dirDisplayName(dirNode) || model;
  if (COLLAGE_JOB) {
    showStatusMessage(`Already making collages for ${COLLAGE_JOB.label} (${COLLAGE_JOB.done} of ${COLLAGE_JOB.total}).`);
    return;
  }
  const job = { model, label, root, done: 0, total: 0, made: 0, failed: [] };
  COLLAGE_JOB = job;
  try {
    showStatusMessage(`Looking for Sets of ${label} without a current collage...`);
    const sets = await collageModelSets(root, model);
    job.total = sets.length;
    let lastMessage = 0;
    for (const set of sets) {
      // Lock now, a refresh into another library: stop.
      if (!WS.root || collageLibraryRoot() !== root) break;
      try {
        const res = await makeCollageForSet(root, model, set, { onlyIfStale: true });
        if (res.made) job.made++;
        else if (!res.ok && !/no photos or videos/.test(res.message)) job.failed.push(res.message);
      } catch (err) {
        job.failed.push(`'${set}': ${err}`);
        if (typeof debugModeLog === "function") debugModeLog("collage", `${model}/${set}: ${err}`);
      }
      job.done++;
      if (Date.now() - lastMessage > 1500) {
        lastMessage = Date.now();
        showStatusMessage(`Making collages for ${label}: ${job.done} of ${job.total} Sets checked, ${job.made} made.`);
      }
    }
    const stopped = job.done < job.total;
    showStatusMessage(
      (stopped
        ? `Stopped making collages for ${label} after ${job.done} of ${job.total} Sets.`
        : job.made
          ? `Made collages for ${job.made} Set${job.made === 1 ? "" : "s"} of ${label}; the rest were current.`
          : `Every Set of ${label} already has a current collage.`) +
        (job.failed.length ? ` ${job.failed.length} could not be made: ${job.failed[0]}` : ""),
    );
  } catch (err) {
    showStatusMessage(`Collages for ${label} could not be made (${err}).`);
  } finally {
    COLLAGE_JOB = null;
  }
}

// Folder options' row for a Set ("Create collage") or a Model ("Create
// collages for all sets"); null for anything else.
function createCollageMenuButton(dirNode) {
  if (!LG_HOST_IS_APP || !window.__lg || typeof window.__lg.assetUrl !== "function") return null;
  const parts = collagePathParts(dirNode);
  if (!parts) return null;
  const forModel = parts.length === 1;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = forModel ? "Create collages for all sets" : "Create collage";
  button.setAttribute("data-action", forModel ? "create-collages" : "create-collage");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (forModel) runCreateCollagesForModel(dirNode);
    else runCreateCollage(dirNode);
  });
  return button;
}
