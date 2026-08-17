// ==UserScript==
// @name         ImageFap Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.01
// @description  ImageFap single-gallery downloader. One button, full-size images, gallery order preserved.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/ImageFap_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/ImageFap_Stripper.user.js
// @match        *://imagefap.com/*
// @match        *://*.imagefap.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      self
// @connect      imagefap.com
// @connect      *.imagefap.com
// @connect      cdnc.imagefap.com
// @connect      fap.to
// @connect      *.fap.to
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (!/(?:^|\.)imagefap\.com$/i.test(location.hostname)) return;
  if (window.__imagefapStripperLoaded) return;
  window.__imagefapStripperLoaded = true;

  // Non-www redirects to www, so both page forms end up same-origin with this.
  const ORIGIN = /^www\.imagefap\.com$/i.test(location.hostname)
    ? location.origin
    : 'https://www.imagefap.com';
  const PAGE_DELAY_MS = 450;
  const PHOTO_DELAY_MS = 400;
  const FILE_DELAY_MS = 120;
  const IMAGE_CONCURRENCY = 3;
  const MAX_GALLERY_PAGES = 400;
  const MAX_RETRIES = 2;
  const PAGE_TIMEOUT_MS = 45000;
  const BLOB_TIMEOUT_MS = 120000;
  const SAVE_TIMEOUT_MS = 20000;
  const MIN_INDEX_PAD = 3;
  const POST_INDEX = '000001';

  const state = {
    busy: false,
    cancel: false,
    gid: '',
    transport: ''
  };

  // @require lands in the sandbox scope in some managers and on window in
  // others, so resolve it at use time from wherever it actually is.
  function resolveJSZip() {
    if (typeof JSZip === 'function') return JSZip;
    if (typeof window !== 'undefined' && typeof window.JSZip === 'function') return window.JSZip;
    if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.JSZip === 'function') return unsafeWindow.JSZip;
    return null;
  }

  const ui = {};

  function init() {
    injectStyle();
    const panel = document.createElement('div');
    panel.id = 'imagefapStripperPanel';
    panel.innerHTML = `
      <div class="ifs-head">
        <span class="ifs-title">ImageFap Stripper</span>
        <button id="ifsCollapse" class="ifs-iconBtn" type="button" title="Collapse">&#9652;</button>
      </div>
      <div class="ifs-body">
        <button id="ifsGo" type="button">Download Gallery</button>
        <div class="ifs-progress"><div id="ifsFill"></div></div>
        <div class="ifs-meta">
          <span id="ifsGallery">No gallery</span>
          <span id="ifsCount">0 images</span>
        </div>
        <div id="ifsLog" class="ifs-log" aria-live="polite"></div>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.go = panel.querySelector('#ifsGo');
    ui.fill = panel.querySelector('#ifsFill');
    ui.gallery = panel.querySelector('#ifsGallery');
    ui.count = panel.querySelector('#ifsCount');
    ui.log = panel.querySelector('#ifsLog');

    ui.go.addEventListener('click', () => {
      if (state.busy) {
        state.cancel = true;
        logLine('Stopping after the current step...');
        return;
      }
      downloadCurrentGallery();
    });
    panel.querySelector('#ifsCollapse').addEventListener('click', () => {
      panel.classList.toggle('ifs-collapsed');
      panel.querySelector('#ifsCollapse').innerHTML = panel.classList.contains('ifs-collapsed') ? '&#9662;' : '&#9652;';
    });

    installRouteObserver();
    syncContext();
  }

  function addStyle(css) {
    try {
      if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
    } catch {}
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function injectStyle() {
    addStyle(`
      #imagefapStripperPanel{position:fixed;right:16px;top:92px;z-index:2147483646;width:300px;max-height:74vh;
        display:flex;flex-direction:column;border:1px solid rgba(255,138,76,.34);border-radius:10px;
        background:#0d0806;color:#fff3ec;box-shadow:0 18px 60px rgba(0,0,0,.5);font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #imagefapStripperPanel.ifs-collapsed{height:auto}
      #imagefapStripperPanel.ifs-collapsed .ifs-body{display:none}
      #imagefapStripperPanel .ifs-head{height:38px;display:flex;align-items:center;gap:8px;padding:0 10px;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#241009,#140b09);cursor:default}
      #imagefapStripperPanel .ifs-title{font-weight:900;color:#ff8a4c}
      #imagefapStripperPanel .ifs-iconBtn{margin-left:auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px}
      #imagefapStripperPanel .ifs-body{display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0;overflow:auto}
      #imagefapStripperPanel button{appearance:none;width:100%;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#fff3ec;font:700 12px/1 Arial,sans-serif;cursor:pointer}
      #imagefapStripperPanel button:hover:not(:disabled){background:rgba(255,138,76,.18);border-color:rgba(255,138,76,.5)}
      #imagefapStripperPanel button:disabled{opacity:.42;cursor:default}
      #imagefapStripperPanel #ifsGo{background:#ff7a33;color:#180b05;border-color:#ff8a4c}
      #imagefapStripperPanel #ifsGo.ifs-stop{background:#3a1a10;color:#ffd9c4;border-color:rgba(255,138,76,.55)}
      #imagefapStripperPanel .ifs-progress{display:block;box-sizing:border-box;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      #imagefapStripperPanel #ifsFill{display:block;height:10px;min-height:10px;width:0;
        background:linear-gradient(90deg,#ff7a33,#ffce6e);transition:width 120ms ease}
      #imagefapStripperPanel .ifs-meta{display:flex;justify-content:space-between;gap:10px;color:#d3bcb0;font-weight:700}
      #imagefapStripperPanel .ifs-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #imagefapStripperPanel .ifs-log{min-height:88px;max-height:200px;overflow:auto;border:1px solid rgba(255,255,255,.08);
        border-radius:8px;background:rgba(0,0,0,.26);padding:7px;color:#cbb6ab;white-space:pre-wrap}
      #imagefapStripperPanel .ifs-log div{margin:0 0 4px}
    `);
  }

  function installRouteObserver() {
    let last = location.href;
    setInterval(() => {
      if (location.href === last) return;
      last = location.href;
      if (state.busy) return;
      setProgress(0);
      syncContext();
    }, 700);
  }

  // --- context -------------------------------------------------------------

  function galleryIdFromLocation() {
    const query = new URLSearchParams(location.search);
    const fromQuery = String(query.get('gid') || '').trim();
    if (/^\d+$/.test(fromQuery)) return fromQuery;
    const path = decodeURIComponent(location.pathname);
    const match = path.match(/^\/(?:gallery|pictures|organizer)\/(\d+)/i);
    if (match) return match[1];
    return '';
  }

  function syncContext() {
    state.gid = galleryIdFromLocation();
    if (state.gid) {
      ui.go.disabled = false;
      ui.gallery.textContent = `Gallery ${state.gid}`;
      ui.gallery.title = `Gallery ${state.gid}`;
      logLine(`Ready. Gallery ${state.gid}.`);
    } else {
      ui.go.disabled = true;
      ui.gallery.textContent = 'No gallery';
      ui.gallery.title = '';
      ui.count.textContent = '0 images';
      logLine('Open a gallery or a photo inside one.');
    }
  }

  // --- scan ----------------------------------------------------------------

  async function downloadCurrentGallery() {
    const gid = galleryIdFromLocation();
    if (!gid) {
      logLine('This is not a gallery page.');
      return;
    }

    state.gid = gid;
    state.cancel = false;
    setBusy(true);
    setProgress(0);
    resetLog();
    logLine(`Scanning gallery ${gid}.`);

    try {
      const gallery = await scanGallery(gid);
      if (state.cancel) throw new Error('cancelled');
      if (!gallery.items.length) throw new Error('no images found in this gallery');

      ui.gallery.textContent = gallery.name;
      ui.gallery.title = gallery.name;
      ui.count.textContent = `${gallery.items.length} image${gallery.items.length === 1 ? '' : 's'}`;
      logLine(`Found ${gallery.items.length} image${gallery.items.length === 1 ? '' : 's'} by ${gallery.uploader || 'unknown'}.`);

      await resolveFullImages(gallery);
      if (state.cancel) throw new Error('cancelled');

      const resolved = gallery.items.filter(item => item.url);
      if (!resolved.length) throw new Error('could not resolve any full-size image');
      if (resolved.length !== gallery.items.length) {
        logLine(`${gallery.items.length - resolved.length} image${gallery.items.length - resolved.length === 1 ? '' : 's'} could not be resolved and will be skipped.`);
      }

      applyGalleryDate(gallery);
      await buildAndSaveArchive(gallery);
      setProgress(100);
      logLine('Done.');
    } catch (err) {
      setProgress(0);
      logLine(errorMessage(err) === 'cancelled' ? 'Cancelled.' : `Failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function scanGallery(gid) {
    const gallery = {
      gid,
      name: '',
      uploader: '',
      date: '',
      items: []
    };

    // One-page view returns the whole gallery in a single request. Paginated
    // walking is the fallback for anything it truncates.
    const onePage = await fetchTextWithRetry(`${ORIGIN}/gallery/${gid}?view=2`);
    const doc = parseDoc(onePage);
    gallery.name = galleryNameFrom(doc, gid);
    gallery.uploader = uploaderFrom(doc);

    const declared = declaredTotalFrom(doc);
    let ids = photoIdsFrom(doc);
    if (declared && ids.length < declared) {
      logLine(`One-page view returned ${ids.length} of ${declared}. Walking pages.`);
      ids = await walkGalleryPages(gid, declared);
    }

    gallery.items = ids.map((id, index) => ({ id, index: index + 1, url: '', added: '' }));
    setProgress(gallery.items.length ? 12 : 0);
    return gallery;
  }

  async function walkGalleryPages(gid, declared) {
    const ids = [];
    const seen = new Set();
    for (let page = 0; page < MAX_GALLERY_PAGES; page++) {
      if (state.cancel) break;
      const html = await fetchTextWithRetry(`${ORIGIN}/gallery/${gid}?page=${page}&view=0`);
      const pageIds = photoIdsFrom(parseDoc(html));
      let fresh = 0;
      pageIds.forEach(id => {
        if (seen.has(id)) return;
        seen.add(id);
        ids.push(id);
        fresh++;
      });
      logLine(`Page ${page + 1}: ${pageIds.length} thumb${pageIds.length === 1 ? '' : 's'} (${ids.length} total).`);
      if (!pageIds.length || !fresh) break;
      if (declared && ids.length >= declared) break;
      await delay(PAGE_DELAY_MS);
    }
    return ids;
  }

  // Every photo page ships a navigator strip holding ~24 neighbouring images,
  // each with its own signed full-size URL. Harvesting the whole strip on each
  // visit means roughly one request per 19 images instead of one per image.
  async function resolveFullImages(gallery) {
    const byId = new Map(gallery.items.map(item => [item.id, item]));
    let visits = 0;
    for (const item of gallery.items) {
      if (state.cancel) return;
      if (item.url) continue;
      visits++;
      try {
        const html = await fetchTextWithRetry(`${ORIGIN}/photo/${item.id}/?gid=${gallery.gid}`);
        const harvested = harvestNaviEntries(parseDoc(html));
        let applied = 0;
        harvested.forEach(entry => {
          const target = byId.get(entry.id);
          if (!target || target.url) return;
          target.url = entry.url;
          target.added = entry.added;
          applied++;
        });
        if (!item.url) logLine(`Photo ${item.id} did not list itself; skipping it.`);
        else if (applied > 1) logLine(`Resolved ${applied} images from photo ${item.id}.`);
      } catch (err) {
        logLine(`Photo ${item.id} failed: ${errorMessage(err)}`);
      }
      const done = gallery.items.filter(entry => entry.url).length;
      setProgress(12 + Math.round((done / Math.max(1, gallery.items.length)) * 38));
      await delay(PHOTO_DELAY_MS);
    }
    logLine(`Resolved full-size URLs in ${visits} page fetch${visits === 1 ? '' : 'es'}.`);
  }

  function applyGalleryDate(gallery) {
    const stamps = gallery.items.map(item => item.added).filter(Boolean).sort();
    gallery.date = stamps.length ? stamps[0] : '';
    if (gallery.date) logLine(`Gallery date: ${gallery.date.slice(0, 10)}.`);
    else logLine('No date found; using 000000 as the date prefix.');
  }

  // --- parsing -------------------------------------------------------------

  function parseDoc(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  function galleryNameFrom(doc, gid) {
    const heading = Array.from(doc.querySelectorAll('font[size="4"]'))
      .map(node => (node.textContent || '').trim())
      .find(Boolean);
    if (heading) return heading;
    const title = (doc.querySelector('title') || {}).textContent || '';
    return String(title).trim() || `gallery_${gid}`;
  }

  function uploaderFrom(doc) {
    const match = String(doc.body ? doc.body.textContent || '' : '').match(/Uploaded by\s+([^\s<]+)/i);
    return match ? match[1].trim() : '';
  }

  function declaredTotalFrom(doc) {
    const alts = Array.from(doc.querySelectorAll('img[alt]'))
      .map(img => String(img.getAttribute('alt') || '').match(/of\s+(\d+)\s+pics/i))
      .filter(Boolean)
      .map(match => Number(match[1]))
      .filter(value => Number.isFinite(value) && value > 0);
    return alts.length ? Math.max.apply(null, alts) : 0;
  }

  function photoIdsFrom(doc) {
    const ids = [];
    const seen = new Set();
    Array.from(doc.querySelectorAll('a[href*="/photo/"]')).forEach(anchor => {
      const match = String(anchor.getAttribute('href') || '').match(/\/photo\/(\d+)/);
      if (!match || seen.has(match[1])) return;
      seen.add(match[1]);
      ids.push(match[1]);
    });
    return ids;
  }

  function harvestNaviEntries(doc) {
    const out = [];
    Array.from(doc.querySelectorAll('a[imageid]')).forEach(anchor => {
      const id = String(anchor.getAttribute('imageid') || '').trim();
      const url = normalizeUrl(anchor.getAttribute('original') || anchor.getAttribute('href') || '');
      if (!/^\d+$/.test(id) || !/\/images\/full\//i.test(url)) return;
      out.push({ id, url, added: String(anchor.getAttribute('added') || '').trim() });
    });
    return out;
  }

  // --- archive -------------------------------------------------------------

  async function buildAndSaveArchive(gallery) {
    const Zip = resolveJSZip();
    if (!Zip) throw new Error('JSZip is missing (the @require did not load)');
    const items = gallery.items.filter(item => item.url);
    const userFolder = sanitizeFolder(gallery.uploader || 'imagefap');
    const base = archiveBaseName(gallery);
    const pad = Math.max(MIN_INDEX_PAD, String(gallery.items.length).length);

    let done = 0;
    await runPool(items, IMAGE_CONCURRENCY, async item => {
      try {
        item.data = await fetchBinaryWithRetry(item.url);
      } catch (err) {
        item.error = errorMessage(err);
      }
      done++;
      setProgress(50 + Math.round((done / Math.max(1, items.length)) * 35));
    });
    if (state.cancel) throw new Error('cancelled');

    // Zipping is a separate ordered pass so the parallel fetch above cannot
    // disturb gallery order.
    const zip = new Zip();
    let added = 0;
    let failed = 0;
    items.forEach(item => {
      const leaf = `${base}_${String(item.index).padStart(pad, '0')}.${inferExt(item.url)}`;
      if (!item.data) {
        failed++;
        logLine(`Skipped ${leaf}: ${item.error || 'no data'}`);
        return;
      }
      zip.file(`${base}/${leaf}`, item.data);
      added++;
    });
    if (!added) throw new Error(`all ${items.length} image downloads failed`);
    if (failed) logLine(`Archive is partial: ${failed} image${failed === 1 ? '' : 's'} failed.`);

    logLine(`Zipping ${added} image${added === 1 ? '' : 's'}.`);
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      meta => setProgress(85 + Math.round(((meta && meta.percent) || 0) * 0.13))
    );
    items.forEach(item => { item.data = null; });
    logLine(`Archive is ${formatBytes(blob.size)}.`);
    const archiveName = sanitizeDownloadPathForSave(`${userFolder}/${base}.zip`);
    await saveBlob(blob, archiveName);
    logLine(`Saved ${archiveName}.`);
  }

  async function runPool(items, limit, worker) {
    const queue = items.slice();
    const lanes = new Array(Math.max(1, Math.min(limit, queue.length))).fill(0).map(async () => {
      while (queue.length) {
        if (state.cancel) return;
        await worker(queue.shift());
        await delay(FILE_DELAY_MS);
      }
    });
    await Promise.all(lanes);
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Matches the shared stripper scheme: <YYMMDD>-<postIndex>-<title>-<id>.
  function archiveBaseName(gallery) {
    const title = sanitizeNamePart(gallery.name).slice(0, 56) || `gallery_${gallery.gid}`;
    return `${dateKey(gallery.date)}-${POST_INDEX}-${title}-${gallery.gid}`;
  }

  function fetchBinaryWithRetry(url) {
    return withRetry(() => httpBinary(url), 'image download');
  }

  function fetchTextWithRetry(url) {
    return withRetry(() => httpText(url), 'page load');
  }

  async function withRetry(run, label) {
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (state.cancel) throw new Error('cancelled');
      try {
        return await run();
      } catch (err) {
        lastErr = err;
        // A real HTTP status is an answer, not a stall; do not keep asking.
        if (err && err.httpStatus) break;
        if (attempt >= MAX_RETRIES) break;
        await delay(700 * Math.pow(2, attempt));
      }
    }
    throw lastErr || new Error(`${label} failed`);
  }

  // --- naming --------------------------------------------------------------

  // The `added` stamps are plain local wall-clock strings, so read the digits
  // straight off rather than routing them through Date and a timezone shift.
  function dateKey(raw) {
    const match = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '000000';
    return `${match[1].slice(2)}${match[2]}${match[3]}`;
  }

  function sanitizeFolder(raw) {
    return sanitizeNamePart(raw).replace(/\s+/g, '_') || 'imagefap';
  }

  function sanitizeNamePart(raw) {
    let s = String(raw || '').normalize('NFC');
    s = s.replace(/�/g, '').replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/[\\/:*?"<>|]+/g, '').replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function sanitizeFileNameStrict(raw, fallback) {
    const s = sanitizeNamePart(raw).replace(/[^A-Za-z0-9._ -]+/g, '').trim();
    return s || fallback || 'download';
  }

  function sanitizeDownloadPathForSave(rawPath) {
    const parts = String(rawPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return (parts.length ? parts : ['imagefap_archive.zip'])
      .map((part, idx) => sanitizeFileNameStrict(part, idx === parts.length - 1 ? 'archive.zip' : 'folder'))
      .join('/');
  }

  function normalizeUrl(raw) {
    if (!raw) return '';
    const value = String(raw).trim().replace(/&amp;/g, '&');
    try { return new URL(value, ORIGIN).href; } catch {}
    try { return new URL(encodeURI(value), ORIGIN).href; } catch {}
    return value;
  }

  function inferExt(raw) {
    const match = String(raw || '').split(/[?#]/)[0].match(/\.([A-Za-z0-9]{2,5})$/);
    const ext = match ? match[1].toLowerCase() : '';
    if (ext === 'jpeg') return 'jpg';
    return /^(?:avif|bmp|gif|jpg|png|webp)$/.test(ext) ? ext : 'jpg';
  }

  // --- transport -----------------------------------------------------------

  // Safari's extension bridge is what stalls: every GM_xmlhttpRequest response is
  // marshalled through the app extension, and large binaries there can hang without
  // ever firing a callback, which no `timeout` option rescues. Neither hop is needed
  // here — the HTML pages are same-origin, and the image CDN echoes the requesting
  // origin back in Access-Control-Allow-Origin — so native fetch is the primary path
  // and GM is only the fallback. Every path below carries its own deadline, so a
  // silent transport fails loudly instead of hanging.

  function withDeadline(label, ms, run) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let abort = null;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        try { if (typeof abort === 'function') abort(); } catch {}
        finish(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
      }, ms);
      try {
        abort = run(value => finish(null, value), err => finish(err || new Error(`${label} failed`)));
      } catch (err) {
        finish(err);
      }
    });
  }

  function httpStatusError(status) {
    const err = new Error(`HTTP ${status}`);
    err.httpStatus = status;
    return err;
  }

  function nativeFetch(url, init, ms, label) {
    return withDeadline(label, ms, (ok, fail) => {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const options = Object.assign({ redirect: 'follow' }, init);
      if (controller) options.signal = controller.signal;
      fetch(url, options).then(ok, fail);
      return controller ? () => controller.abort() : null;
    });
  }

  function noteTransport(name) {
    if (state.transport === name) return;
    state.transport = name;
    logLine(`Transport: ${name}.`);
  }

  async function httpText(url) {
    if (typeof fetch === 'function') {
      try {
        const res = await nativeFetch(url, { credentials: 'same-origin' }, PAGE_TIMEOUT_MS, 'page fetch');
        if (!res.ok) throw httpStatusError(res.status);
        const text = await withDeadline('page read', PAGE_TIMEOUT_MS, (ok, fail) => { res.text().then(ok, fail); });
        noteTransport('fetch');
        return text;
      } catch (err) {
        if (err && err.httpStatus) throw err;
        if (!hasGmRequest()) throw err;
        logLine(`fetch failed (${errorMessage(err)}); falling back to GM_xmlhttpRequest.`);
      }
    }
    noteTransport('GM_xmlhttpRequest');
    return gmRequest(url, 'text', PAGE_TIMEOUT_MS);
  }

  async function httpBinary(url) {
    if (typeof fetch === 'function') {
      try {
        // The CDN allows any origin but sends no allow-credentials, so cookies
        // must stay off or the browser rejects the response.
        const res = await nativeFetch(url, { credentials: 'omit' }, BLOB_TIMEOUT_MS, 'image fetch');
        if (!res.ok) throw httpStatusError(res.status);
        const type = String(res.headers.get('content-type') || '').toLowerCase();
        if (/^(?:text\/|application\/(?:json|xml|xhtml))/.test(type)) {
          throw new Error(`server returned ${type.split(';')[0] || 'non-media content'}`);
        }
        const buffer = await withDeadline('image read', BLOB_TIMEOUT_MS, (ok, fail) => { res.arrayBuffer().then(ok, fail); });
        if (!buffer || !buffer.byteLength) throw new Error('empty response');
        noteTransport('fetch');
        return buffer;
      } catch (err) {
        if (err && err.httpStatus) throw err;
        if (!hasGmRequest()) throw err;
        logLine(`fetch failed (${errorMessage(err)}); falling back to GM_xmlhttpRequest.`);
      }
    }
    noteTransport('GM_xmlhttpRequest');
    return gmRequest(url, 'arraybuffer', BLOB_TIMEOUT_MS);
  }

  function hasGmRequest() {
    try { return typeof GM_xmlhttpRequest === 'function'; } catch { return false; }
  }

  // arraybuffer rather than blob: it is the response type every manager
  // implements consistently, and JSZip takes it directly.
  function gmRequest(url, kind, ms) {
    return withDeadline(kind === 'text' ? 'page request' : 'image request', ms, (ok, fail) => {
      const handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        responseType: kind === 'text' ? undefined : 'arraybuffer',
        headers: kind === 'text' ? { Accept: 'text/html,application/xhtml+xml,*/*' } : { Referer: `${ORIGIN}/` },
        timeout: ms,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            fail(httpStatusError(res.status));
            return;
          }
          if (kind === 'text') {
            ok(String(res.responseText || ''));
            return;
          }
          const body = res.response;
          if (body && typeof body.byteLength === 'number' && body.byteLength) ok(body);
          else if (body && typeof body.arrayBuffer === 'function') body.arrayBuffer().then(ok, fail);
          else fail(new Error('empty response'));
        },
        onerror: () => fail(new Error('network error')),
        ontimeout: () => fail(new Error('request timeout'))
      });
      return handle && typeof handle.abort === 'function' ? () => handle.abort() : null;
    });
  }

  // GM_download is absent or a silent no-op in several Safari managers, so it
  // gets a deadline and the anchor path picks up whatever it drops.
  async function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    try {
      if (typeof GM_download === 'function') {
        try {
          await withDeadline('save', SAVE_TIMEOUT_MS, (ok, fail) => {
            GM_download({
              url,
              name,
              saveAs: false,
              onload: () => ok(),
              onerror: err => fail(new Error(err && err.error ? err.error : 'save failed')),
              ontimeout: () => fail(new Error('save timeout'))
            });
            return null;
          });
          return;
        } catch (err) {
          logLine(`GM_download did not complete (${errorMessage(err)}); saving via the browser instead.`);
        }
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name.split('/').pop() || 'imagefap_archive.zip';
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  // --- panel plumbing ------------------------------------------------------

  function setBusy(busy) {
    state.busy = busy;
    ui.go.textContent = busy ? 'Stop' : 'Download Gallery';
    ui.go.classList.toggle('ifs-stop', busy);
    ui.go.disabled = busy ? false : !galleryIdFromLocation();
  }

  function setProgress(percent) {
    const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
    ui.fill.style.width = `${value}%`;
  }

  function resetLog() {
    ui.log.textContent = '';
  }

  function logLine(text) {
    const line = document.createElement('div');
    line.textContent = text;
    ui.log.appendChild(line);
    ui.log.scrollTop = ui.log.scrollHeight;
    while (ui.log.childElementCount > 200) ui.log.removeChild(ui.log.firstElementChild);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function errorMessage(err) {
    if (!err) return 'unknown error';
    return String(err.message || err);
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
