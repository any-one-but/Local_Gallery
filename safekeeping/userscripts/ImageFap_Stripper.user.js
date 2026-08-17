// ==UserScript==
// @name         ImageFap Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.02.00
// @description  ImageFap gallery downloader. Drop gallery links into the panel and it eats through them one at a time.
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

  // Per-tab only, and deliberately not GM storage: browsing to gather links is a
  // full page load on this site, so a purely in-memory queue would evaporate the
  // moment you went looking for the next gallery. sessionStorage keeps it alive
  // across those loads and dies with the tab, so nothing is left on disk.
  const QUEUE_KEY = 'ImageFapStripper.queue.v1';
  const QUEUE_LIMIT = 200;

  const state = {
    busy: false,
    cancel: false,
    abortQueue: false,
    queueRunning: false,
    gid: '',
    transport: '',
    queue: []
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
        <div id="ifsDrop" class="ifs-drop">Drop gallery links here</div>
        <div class="ifs-queueHead">
          <span id="ifsQueueCount">Queue empty</span>
          <button id="ifsAdd" class="ifs-miniBtn" type="button" title="Queue the gallery on this page">+ This</button>
          <button id="ifsClear" class="ifs-miniBtn" type="button" title="Clear the queue">Clear</button>
        </div>
        <div id="ifsQueue" class="ifs-queue" hidden></div>
        <button id="ifsStart" type="button" disabled>Start Queue</button>
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
    ui.drop = panel.querySelector('#ifsDrop');
    ui.queue = panel.querySelector('#ifsQueue');
    ui.queueCount = panel.querySelector('#ifsQueueCount');
    ui.add = panel.querySelector('#ifsAdd');
    ui.clear = panel.querySelector('#ifsClear');
    ui.start = panel.querySelector('#ifsStart');

    ui.go.addEventListener('click', () => {
      if (state.busy) {
        requestStop();
        return;
      }
      downloadCurrentGallery();
    });
    ui.start.addEventListener('click', () => {
      if (state.busy) {
        requestStop();
        return;
      }
      runQueue();
    });
    ui.add.addEventListener('click', () => {
      const gid = galleryIdFromLocation();
      if (!gid) {
        logLine('This page is not a gallery.');
        return;
      }
      reportQueued(addToQueue([{ gid, name: '' }]));
    });
    ui.clear.addEventListener('click', clearQueue);
    installDropTarget(panel);
    panel.querySelector('#ifsCollapse').addEventListener('click', () => {
      panel.classList.toggle('ifs-collapsed');
      panel.querySelector('#ifsCollapse').innerHTML = panel.classList.contains('ifs-collapsed') ? '&#9662;' : '&#9652;';
    });

    installRouteObserver();
    loadQueue();
    renderQueue();
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
      #imagefapStripperPanel .ifs-drop{display:flex;align-items:center;justify-content:center;min-height:44px;padding:6px 8px;
        border:1px dashed rgba(255,138,76,.42);border-radius:8px;background:rgba(255,138,76,.05);
        color:#c9a993;font-weight:700;text-align:center}
      #imagefapStripperPanel.ifs-dragging .ifs-drop{border-color:#ff8a4c;border-style:solid;
        background:rgba(255,138,76,.2);color:#fff3ec}
      #imagefapStripperPanel .ifs-queueHead{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;
        color:#d3bcb0;font-weight:700}
      #imagefapStripperPanel .ifs-queueHead span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #imagefapStripperPanel .ifs-miniBtn{width:auto;min-height:24px;padding:0 8px;font-size:11px;border-radius:6px}
      #imagefapStripperPanel .ifs-queue{display:flex;flex-direction:column;gap:4px;max-height:168px;overflow:auto;
        border:1px solid rgba(255,255,255,.08);border-radius:8px;background:rgba(0,0,0,.16);padding:6px}
      #imagefapStripperPanel .ifs-queue[hidden]{display:none}
      #imagefapStripperPanel .ifs-row{display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center}
      #imagefapStripperPanel .ifs-rowIndex{color:#8d7267;font-weight:700;font-size:10px;min-width:18px}
      #imagefapStripperPanel .ifs-rowName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#f0ddd2;font-weight:700}
      #imagefapStripperPanel .ifs-rowName small{display:block;color:#9d8175;font-weight:700;font-size:10px}
      #imagefapStripperPanel .ifs-rowKill{width:22px;min-height:22px;padding:0;border-radius:6px;font-size:11px;line-height:1}
      #imagefapStripperPanel .ifs-row.is-active .ifs-rowName{color:#ffb98c}
      #imagefapStripperPanel .ifs-row.is-done .ifs-rowName{color:#8fbf9a}
      #imagefapStripperPanel .ifs-row.is-failed .ifs-rowName{color:#e08a7a}
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

  // --- queue ---------------------------------------------------------------

  function installDropTarget(panel) {
    let depth = 0;
    const setDragging = on => panel.classList.toggle('ifs-dragging', on);

    panel.addEventListener('dragenter', event => {
      event.preventDefault();
      depth++;
      setDragging(true);
    });
    panel.addEventListener('dragover', event => {
      // Without this the drop never fires; the browser treats it as a no-drop zone.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    panel.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    });
    panel.addEventListener('drop', event => {
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      setDragging(false);
      const targets = galleryTargetsFromTransfer(event.dataTransfer);
      if (!targets.length) {
        logLine('Nothing gallery-shaped in that drop.');
        return;
      }
      reportQueued(addToQueue(targets));
    });
  }

  // A dragged link arrives as several flavours at once. Read them all and let the
  // id extractor sort it out, so dragging a thumbnail, a gallery link, or a pasted
  // list of URLs all land the same way.
  function galleryTargetsFromTransfer(transfer) {
    if (!transfer) return [];
    const chunks = [];
    ['text/uri-list', 'text/plain', 'text/html', 'URL', 'Text'].forEach(type => {
      try {
        const value = transfer.getData(type);
        if (value) chunks.push(value);
      } catch {}
    });
    return galleryTargetsFromText(chunks.join('\n'));
  }

  function galleryTargetsFromText(text) {
    const seen = new Set();
    const targets = [];
    const source = String(text || '');
    // `#`-prefixed lines are uri-list comments, not URLs.
    source.split(/[\s"'<>]+/).forEach(token => {
      if (!token || token.charAt(0) === '#') return;
      const gid = galleryIdFromUrl(token);
      if (!gid || seen.has(gid)) return;
      seen.add(gid);
      targets.push({ gid, name: nameHintFromUrl(token) });
    });
    return targets;
  }

  function galleryIdFromUrl(raw) {
    const value = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!/imagefap\.com/i.test(value) && !/^\/(?:gallery|pictures)\//i.test(value)) return '';
    let url;
    try { url = new URL(value, ORIGIN); } catch { return ''; }
    if (!/(?:^|\.)imagefap\.com$/i.test(url.hostname)) return '';
    const fromQuery = String(url.searchParams.get('gid') || '').trim();
    if (/^\d+$/.test(fromQuery)) return fromQuery;
    const match = decodeURIComponent(url.pathname).match(/^\/(?:gallery|pictures|organizer)\/(\d+)/i);
    return match ? match[1] : '';
  }

  // /pictures/<id>/Some_Gallery_Name carries a readable name; use it as a
  // placeholder label until the real one arrives from the scan.
  function nameHintFromUrl(raw) {
    try {
      const parts = decodeURIComponent(new URL(String(raw), ORIGIN).pathname).split('/').filter(Boolean);
      if (parts.length < 3 || !/^(?:gallery|pictures)$/i.test(parts[0])) return '';
      return sanitizeNamePart(parts[2].replace(/_/g, ' '));
    } catch {
      return '';
    }
  }

  function addToQueue(targets) {
    const known = new Set(state.queue.map(entry => entry.gid));
    const added = [];
    let full = false;
    targets.forEach(target => {
      if (known.has(target.gid)) return;
      if (state.queue.length >= QUEUE_LIMIT) { full = true; return; }
      known.add(target.gid);
      const entry = { gid: target.gid, name: target.name || '', status: 'queued', note: '' };
      state.queue.push(entry);
      added.push(entry);
    });
    if (full) logLine(`Queue is capped at ${QUEUE_LIMIT}; the rest were dropped.`);
    saveQueue();
    renderQueue();
    return added;
  }

  function reportQueued(added) {
    if (!added.length) {
      logLine('Already queued.');
      return;
    }
    logLine(`Queued ${added.length} galler${added.length === 1 ? 'y' : 'ies'}: ${added.map(entry => entry.gid).join(', ')}.`);
  }

  function clearQueue() {
    if (state.busy) {
      logLine('Stop the queue before clearing it.');
      return;
    }
    state.queue = [];
    saveQueue();
    renderQueue();
    logLine('Queue cleared.');
  }

  function removeFromQueue(gid) {
    const entry = state.queue.find(item => item.gid === gid);
    if (entry && entry.status === 'active') {
      logLine('That one is downloading; press Stop first.');
      return;
    }
    state.queue = state.queue.filter(item => item.gid !== gid);
    saveQueue();
    renderQueue();
  }

  function pendingQueueEntries() {
    return state.queue.filter(entry => entry.status === 'queued' || entry.status === 'active');
  }

  function renderQueue() {
    const pending = pendingQueueEntries().length;
    ui.queue.hidden = !state.queue.length;
    ui.queue.textContent = '';
    ui.queueCount.textContent = state.queue.length
      ? `Queue: ${state.queue.length} (${pending} to go)`
      : 'Queue empty';
    ui.start.disabled = state.busy ? false : !pending;
    ui.start.textContent = state.busy ? 'Stop' : (pending ? `Start Queue (${pending})` : 'Start Queue');
    ui.start.classList.toggle('ifs-stop', state.busy);

    state.queue.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = `ifs-row is-${entry.status}`;

      const position = document.createElement('span');
      position.className = 'ifs-rowIndex';
      position.textContent = String(index + 1);

      const name = document.createElement('div');
      name.className = 'ifs-rowName';
      name.textContent = entry.name || `Gallery ${entry.gid}`;
      name.title = `${entry.name || 'Gallery'} (${entry.gid})`;
      const note = document.createElement('small');
      note.textContent = entry.note || entry.status;
      name.appendChild(note);

      const kill = document.createElement('button');
      kill.className = 'ifs-rowKill';
      kill.type = 'button';
      kill.textContent = '✕';
      kill.title = 'Remove from queue';
      kill.addEventListener('click', () => removeFromQueue(entry.gid));

      row.appendChild(position);
      row.appendChild(name);
      row.appendChild(kill);
      ui.queue.appendChild(row);
    });
  }

  function saveQueue() {
    try {
      sessionStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue));
    } catch {}
  }

  function loadQueue() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]');
      if (!Array.isArray(parsed)) return;
      state.queue = parsed
        .filter(entry => entry && /^\d+$/.test(String(entry.gid)))
        .slice(0, QUEUE_LIMIT)
        .map(entry => ({
          gid: String(entry.gid),
          name: String(entry.name || ''),
          // A run interrupted by navigation left this mid-flight; it never finished.
          status: entry.status === 'done' || entry.status === 'failed' ? entry.status : 'queued',
          note: String(entry.note || '')
        }));
    } catch {}
  }

  async function runQueue() {
    const pending = pendingQueueEntries();
    if (!pending.length) {
      logLine('Nothing queued.');
      return;
    }

    state.abortQueue = false;
    state.queueRunning = true;
    setBusy(true);
    resetLog();
    logLine(`Starting queue: ${pending.length} galler${pending.length === 1 ? 'y' : 'ies'}.`);

    let completed = 0;
    try {
      // Re-read the queue each lap rather than iterating a snapshot, so galleries
      // dropped in while it is running get eaten by the same pass.
      while (!state.abortQueue) {
        const entry = state.queue.find(item => item.status === 'queued');
        if (!entry) break;
        completed++;
        const total = completed + state.queue.filter(item => item.status === 'queued').length - 1;
        entry.status = 'active';
        entry.note = 'downloading';
        renderQueue();
        ui.count.textContent = `${completed}/${total}`;
        logLine(`--- ${completed}/${total}: gallery ${entry.gid} ---`);

        state.cancel = false;
        try {
          const gallery = await processGallery(entry.gid);
          entry.name = gallery.name || entry.name;
          entry.status = 'done';
          entry.note = `${gallery.saved} image${gallery.saved === 1 ? '' : 's'}`;
        } catch (err) {
          const message = errorMessage(err);
          const cancelled = message === 'cancelled';
          entry.status = cancelled ? 'queued' : 'failed';
          entry.note = cancelled ? 'queued' : message.slice(0, 60);
          setProgress(0);
          logLine(cancelled ? 'Cancelled.' : `Gallery ${entry.gid} failed: ${message}`);
          // A cancel is aimed at the whole run, not just the gallery in flight.
          if (cancelled) state.abortQueue = true;
        }
        renderQueue();
        saveQueue();
        if (state.abortQueue) break;
        await delay(PAGE_DELAY_MS);
      }
      const left = pendingQueueEntries().length;
      logLine(state.abortQueue ? `Queue stopped with ${left} left.` : 'Queue finished.');
    } finally {
      setBusy(false);
      saveQueue();
      renderQueue();
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
    state.abortQueue = false;
    setBusy(true);
    resetLog();

    try {
      await processGallery(gid);
    } catch (err) {
      setProgress(0);
      logLine(errorMessage(err) === 'cancelled' ? 'Cancelled.' : `Failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function processGallery(gid) {
    setProgress(0);
    logLine(`Scanning gallery ${gid}.`);

    const gallery = await scanGallery(gid);
    if (state.cancel) throw new Error('cancelled');
    if (!gallery.items.length) throw new Error('no images found in this gallery');

    ui.gallery.textContent = gallery.name;
    ui.gallery.title = gallery.name;
    // During a run the counter is the queue's position readout; leave it alone.
    if (!state.queueRunning) {
      ui.count.textContent = `${gallery.items.length} image${gallery.items.length === 1 ? '' : 's'}`;
    }
    logLine(`Found ${gallery.items.length} image${gallery.items.length === 1 ? '' : 's'} by ${gallery.uploader || 'unknown'}.`);

    await resolveFullImages(gallery);
    if (state.cancel) throw new Error('cancelled');

    const resolved = gallery.items.filter(item => item.url);
    if (!resolved.length) throw new Error('could not resolve any full-size image');
    if (resolved.length !== gallery.items.length) {
      logLine(`${gallery.items.length - resolved.length} image${gallery.items.length - resolved.length === 1 ? '' : 's'} could not be resolved and will be skipped.`);
    }

    applyGalleryDate(gallery);
    gallery.saved = await buildAndSaveArchive(gallery);
    setProgress(100);
    logLine('Done.');
    return gallery;
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
    return added;
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

  // <YYMMDD> - <title>. The prefix is the date alone, and the separator is exactly
  // " - " — so the title is stripped of edge hyphens and spaces (slicing to the
  // length cap can leave one behind) and that boundary stays the only one.
  function archiveBaseName(gallery) {
    const title = sanitizeNamePart(gallery.name)
      .slice(0, 56)
      .replace(/^[\s-]+/, '')
      .replace(/[\s-]+$/, '') || `gallery_${gallery.gid}`;
    return `${dateKey(gallery.date)} - ${title}`;
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
    if (!busy) state.queueRunning = false;
    ui.go.textContent = busy ? 'Stop' : 'Download Gallery';
    ui.go.classList.toggle('ifs-stop', busy);
    ui.go.disabled = busy ? false : !galleryIdFromLocation();
    // Adding stays open during a run — the loop picks up late arrivals — but
    // clearing the list out from under it does not.
    ui.clear.disabled = busy;
    renderQueue();
  }

  // Either button stops everything: a cancel is aimed at the run, not at whichever
  // gallery happens to be in flight.
  function requestStop() {
    if (!state.busy) return;
    state.cancel = true;
    state.abortQueue = true;
    logLine('Stopping after the current step...');
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
