// ==UserScript==
// @name         Zishy Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.00
// @description  Zishy album downloader. Queue albums from any listing and eat through them one at a time, named by model and date.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/Zishy_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/Zishy_Stripper.user.js
// @match        *://zishy.com/*
// @match        *://*.zishy.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      self
// @connect      zishy.com
// @connect      *.zishy.com
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  if (!/(?:^|\.)zishy\.com$/i.test(location.hostname)) return;
  if (window.__zishyStripperLoaded) return;
  window.__zishyStripperLoaded = true;

  // ===========================================================================
  // CONFIG — page furniture to hide
  // ===========================================================================
  // Any CSS selector listed here is hidden outright. This is for turning album
  // pages into fast, light link-collecting surfaces while you queue in bulk:
  // nothing here affects downloading, because a download always refetches the
  // page rather than reading the visible DOM.
  //
  // Add or remove lines freely. The eye button in the panel toggles the whole
  // list off and on without editing anything.

  const HIDE_SELECTORS = [
    // The in-album photos themselves (`single_*` under /uploads/thumbs/).
    // Deliberately narrower than `/uploads/thumbs/` alone, so the `collection_*`
    // covers on listing pages survive and you can still tell albums apart.
    'img[src*="/uploads/thumbs/"][src*="/single_"]',

    // The per-album blurb under the first photo.
    '#descrip',

    // --- more things worth hiding; uncomment to taste ---------------------
    // '.albumcover img',              // covers on listings too (fully blind browsing)
    // '#comments',                    // the comment thread
    // '.player, #media-player28',     // the bonus video player
    // '#captionbox',                  // the whole caption block, not just #descrip
    // '#twitterft',                   // the social footer
    // '#joincontain, #joincontain2'   // the logged-out SUBSCRIBE upsells
  ];

  // A separate system from the selector list above, sharing its eye button: any
  // album card on the site whose gallery is already in the download history is
  // hidden, as is any model card in the directory whose sets are all downloaded.
  // Browsing then shows only what you have not got. The eye reveals both systems
  // at once.
  //
  // "Already downloaded" here means exactly what the queue would skip — so with
  // Download set to Images, an album you took the images of counts as had, and in
  // All Files mode it does not until its video is in too. A model is hidden only
  // on the strict reading: every one of her sets completely downloaded.
  const HIDE_DOWNLOADED = true;

  // Hiding an <img> with CSS does not stop the browser fetching it. With this on,
  // matching images also have their src stripped as they are parsed, which cancels
  // most of those requests — not all, since the parser can dispatch a load before
  // the observer sees the node. The eye button puts the srcs back.
  const BLOCK_HIDDEN_IMAGE_LOADS = true;

  // ===========================================================================
  // CONFIG — behaviour
  // ===========================================================================

  const ORIGIN = /^www\.zishy\.com$/i.test(location.hostname)
    ? location.origin
    : 'https://www.zishy.com';

  // This is one person's site, not a CDN farm. The defaults are deliberately
  // unhurried; a bulk run is meant to be left alone, not raced.
  const PAGE_DELAY_MS = 500;     // between album/listing page fetches
  const ALBUM_DELAY_MS = 800;    // between albums in a queue run
  const FILE_DELAY_MS = 150;     // between image fetches within one lane
  const IMAGE_CONCURRENCY = 3;

  const MAX_LISTING_PAGES = 120; // ceiling for "+ All Pages"
  const MAX_RETRIES = 2;
  const PAGE_TIMEOUT_MS = 45000;
  const BLOB_TIMEOUT_MS = 180000;
  const SAVE_TIMEOUT_MS = 20000;
  const MIN_INDEX_PAD = 3;
  const MAX_TITLE_CHARS = 56;

  // Everything lands under one folder in your downloads directory, so a bulk run
  // does not scatter model folders across whatever else is in there.
  const ROOT_FOLDER = 'Zishy';

  // What the file-kind cycler starts on: 'all', 'images' or 'videos'. Albums
  // frequently carry a "Bonus HD Video Clip", which is appended to the zip after
  // the images, sharing their numbering. Absent or unreachable videos are logged
  // and skipped — they never fail an album.
  const DEFAULT_FILE_FILTER = 'all';
  const FILE_FILTERS = ['all', 'images', 'videos'];
  const FILE_FILTER_LABELS = { all: 'All Files', images: 'Images', videos: 'Videos' };

  // Off, and not an oversight. The signed-out player exposes only a poster at
  // /uploads/files/<Album>/movie.jpg, and every obvious sibling of it (movie.mp4,
  // .m4v, .webm, .mov, movie_hd.mp4, trailer.mp4) answers 404 — so guessing costs
  // a wasted request per album and never lands. The three detectors in videoFrom()
  // read the real source out of the subscriber player instead. Turn this on only
  // if you find a naming rule that actually resolves.
  const GUESS_VIDEO_FROM_POSTER = false;

  // An album page that yields fewer photos than it declares means you are signed
  // out (the free preview shows 3 of N) or the page shape changed. Refusing is the
  // honest default: a silently partial gallery is worse than no gallery.
  const ALLOW_PARTIAL_ALBUMS = false;

  // Model with no tag on the album. Falls back to this folder rather than guessing
  // a name out of the URL slug.
  const UNTAGGED_FOLDER = '_Untagged';

  // How a two-model album's names are joined. "and" rather than "&", because the
  // strict filename pass strips an ampersand and leaves a double space behind it.
  const MODEL_JOIN = ' and ';

  // Per-tab only, and deliberately not GM storage: gathering links here is a full
  // page load every time, so an in-memory queue would evaporate the moment you
  // went looking for the next album. sessionStorage survives those loads and dies
  // with the tab, so nothing is left on disk.
  const QUEUE_KEY = 'ZishyStripper.queue.v1';
  const FILTER_KEY = 'ZishyStripper.filter.v1';
  const FORCE_KEY = 'ZishyStripper.force.v1';
  const LINKMODE_KEY = 'ZishyStripper.linkmode.v1';

  // The one thing this script leaves on disk, and deliberately so: a record of
  // what has already been saved is only useful if it outlives the tab. It is
  // localStorage rather than GM storage so the Clear button and the browser's own
  // "clear site data" both reach it — losing it costs re-downloads, nothing more.
  const HISTORY_KEY = 'ZishyStripper.history.v1';

  // The completion index: what the site actually holds, so "downloaded" has a
  // denominator. Built on demand and stored beside the history.
  const INDEX_KEY = 'ZishyStripper.index.v1';
  // Sized to hold the whole site at once: ~2750 albums plus the ~704 model entries
  // that expand into them, with headroom. Entries are tiny, so even a full queue is
  // well under a megabyte of sessionStorage.
  const QUEUE_LIMIT = 6000;

  // ===========================================================================

  const state = {
    busy: false,
    cancel: false,
    abortQueue: false,
    queueRunning: false,
    crawling: false,
    hidden: true,
    fileFilter: DEFAULT_FILE_FILTER,
    linkMode: 'added',
    force: false,
    indexing: false,
    history: new Map(),
    index: null,
    transport: '',
    albumId: '',
    queue: []
  };

  const ui = {};
  let hideStyleEl = null;
  let downloadedStyleEl = null;

  // @require lands in the sandbox scope in some managers and on window in others,
  // so resolve it at use time from wherever it actually is.
  function resolveJSZip() {
    if (typeof JSZip === 'function') return JSZip;
    if (typeof window !== 'undefined' && typeof window.JSZip === 'function') return window.JSZip;
    if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.JSZip === 'function') return unsafeWindow.JSZip;
    return null;
  }

  // --- hiding ---------------------------------------------------------------
  // Runs at document-start, before the parser reaches the body, which is the only
  // point at which hiding can save any work at all.

  function hideSelectorList() {
    return HIDE_SELECTORS.map(s => String(s || '').trim()).filter(Boolean);
  }

  function applyHideStyle() {
    const selectors = hideSelectorList();
    if (!selectors.length) return;
    hideStyleEl = document.createElement('style');
    hideStyleEl.id = 'zishyStripperHideRules';
    hideStyleEl.textContent = `${selectors.join(',\n')} { display: none !important; }`;
    (document.head || document.documentElement).appendChild(hideStyleEl);
  }

  // --- hiding what you already have -----------------------------------------
  //
  // Marking is a class on the card and the rule lives in its own stylesheet, so
  // revealing is one `disabled = true` rather than a re-scan — and re-hiding does
  // not have to find everything again.
  //
  // The unit is `.albumcover`, which is how the site draws every entry in a
  // listing, in the model directory, and in an album's "also check out" strip.
  // Scoping to it is also what keeps the model chip beside the download button
  // (a `.moreof` span) out of this: that chip is navigation on a page you are
  // deliberately reading, not a card offering you something you already have.

  function applyDownloadedHideStyle() {
    if (!HIDE_DOWNLOADED) return;
    downloadedStyleEl = document.createElement('style');
    downloadedStyleEl.id = 'zishyStripperDownloadedRules';
    downloadedStyleEl.textContent = '.zsGot { display: none !important; }';
    (document.head || document.documentElement).appendChild(downloadedStyleEl);
  }

  function isModelComplete(tagId) {
    const index = state.index;
    if (!index) return false;
    const model = index.models[String(tagId)];
    const hers = model && model.a ? model.a : [];
    if (!hers.length) return false;
    return hers.every(id => historySatisfies(id, 'all'));
  }

  // Whether this card offers something there is no point looking at.
  function cardIsHad(card) {
    const anchor = card.querySelector('a[href]');
    if (!anchor) return false;
    const target = targetFromUrl(anchor.getAttribute('href'), location.href);
    if (!target) return false;
    if (target.kind === 'model') return isModelComplete(target.id);
    return historySatisfies(target.id, state.fileFilter);
  }

  function markCard(card) {
    if (!card || card.nodeType !== 1) return;
    const had = cardIsHad(card);
    card.classList.toggle('zsGot', had);
  }

  function sweepDownloadedCards(node) {
    if (!HIDE_DOWNLOADED || !node || node.nodeType !== 1) return;
    if (node.classList && node.classList.contains('albumcover')) markCard(node);
    if (node.querySelectorAll) Array.from(node.querySelectorAll('.albumcover')).forEach(markCard);
  }

  // Re-tests every card on the page. Needed when the answer changes underneath
  // them: a download completes, the history is cleared, or the file-kind cycler
  // moves and redefines what "had" means.
  function refreshDownloadedCards() {
    if (!HIDE_DOWNLOADED || !document.body) return;
    Array.from(document.querySelectorAll('.albumcover')).forEach(markCard);
    updateEyeButton();
  }

  function hiddenCardCount() {
    try { return document.querySelectorAll('.albumcover.zsGot').length; } catch { return 0; }
  }

  // One observer for both jobs, installed at document-start so cards are marked
  // as the parser produces them rather than appearing and then vanishing.
  function installEarlyObserver() {
    const combined = BLOCK_HIDDEN_IMAGE_LOADS ? hideSelectorList().join(',') : '';

    const strip = img => {
      if (!combined || !img || img.dataset.zsBlocked) return;
      let matches = false;
      try { matches = img.matches(combined); } catch { return; }
      if (!matches) return;
      // The attribute is kept rather than the resolved property: putting back
      // `img.src` would write an absolute URL where a relative one used to be,
      // which is harmless but makes the DOM lie about what the page shipped.
      img.dataset.zsBlocked = img.getAttribute('src') || '';
      img.dataset.zsBlockedSet = img.getAttribute('srcset') || '';
      img.removeAttribute('src');
      img.removeAttribute('srcset');
    };

    const sweep = node => {
      if (!node || node.nodeType !== 1) return;
      if (state.hidden && combined) {
        if (node.tagName === 'IMG') strip(node);
        if (node.querySelectorAll) Array.from(node.querySelectorAll('img')).forEach(strip);
      }
      // Marked regardless of the toggle: the class is what the toggle acts on, so
      // a card added while revealed still hides correctly when you hide again.
      sweepDownloadedCards(node);
    };

    new MutationObserver(records => {
      records.forEach(record => Array.from(record.addedNodes).forEach(sweep));
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function updateEyeButton() {
    if (!ui.eye) return;
    const hiddenCards = hiddenCardCount();
    ui.eye.textContent = state.hidden ? '🙈' : '👁';
    ui.eye.title = state.hidden
      ? `Reveal hidden page elements${hiddenCards ? ` and ${hiddenCards} already-downloaded card${hiddenCards === 1 ? '' : 's'}` : ''}`
      : 'Hide them again';
  }

  function setHidden(hidden) {
    state.hidden = hidden;
    if (hideStyleEl) hideStyleEl.disabled = !hidden;
    if (downloadedStyleEl) downloadedStyleEl.disabled = !hidden;
    if (!hidden) {
      Array.from(document.querySelectorAll('img[data-zs-blocked]')).forEach(img => {
        const src = img.dataset.zsBlocked;
        const set = img.dataset.zsBlockedSet;
        delete img.dataset.zsBlocked;
        delete img.dataset.zsBlockedSet;
        if (set) img.setAttribute('srcset', set);
        if (src) img.setAttribute('src', src);
      });
    }
    updateEyeButton();
  }

  // --- panel ----------------------------------------------------------------

  function init() {
    injectStyle();
    const panel = document.createElement('div');
    panel.id = 'zishyStripperPanel';
    panel.innerHTML = `
      <div class="zs-head">
        <span class="zs-title">Zishy Stripper</span>
        <button id="zsEye" class="zs-iconBtn" type="button" title="Show hidden page elements">🙈</button>
        <button id="zsCollapse" class="zs-iconBtn" type="button" title="Collapse">&#9652;</button>
      </div>
      <div class="zs-body">
        <button id="zsGo" type="button">Download Album</button>
        <div class="zs-cycles">
          <button id="zsFilter" class="zs-cycle" type="button" title="What gets downloaded">Download: All Files</button>
          <button id="zsForce" class="zs-cycle" type="button" title="Whether albums already in the history are downloaded again">Duplicates: Skip</button>
          <button id="zsLinkMode" class="zs-cycle zs-cycleWide" type="button" title="As added: queue what you give it. To model: resolve every album to its model and queue her whole catalogue instead.">Links: As added</button>
        </div>
        <div class="zs-progress"><div id="zsFill"></div></div>
        <div class="zs-meta">
          <span id="zsAlbum">No album</span>
          <span id="zsCount">0 photos</span>
        </div>
        <div id="zsDrop" class="zs-drop">Drop album links here</div>
        <div class="zs-queueHead"><span id="zsQueueCount">Queue empty</span></div>
        <div class="zs-queueBtns">
          <button id="zsAdd" class="zs-miniBtn" type="button" title="Queue the album on this page">+ This</button>
          <button id="zsAddPage" class="zs-miniBtn" type="button" title="Queue every album linked on this page">+ Page</button>
          <button id="zsAddAll" class="zs-miniBtn" type="button" title="Walk this listing's pagination and queue everything">+ All Pages</button>
          <button id="zsClear" class="zs-miniBtn" type="button" title="Clear the queue">Clear</button>
        </div>
        <div id="zsQueue" class="zs-queue" hidden></div>
        <div class="zs-histHead">
          <span id="zsHistCount">History empty</span>
          <button id="zsHistClear" class="zs-miniBtn zs-histBtn" type="button" title="Forget every album already downloaded">Clear</button>
        </div>
        <div class="zs-histHead">
          <span id="zsStats">No index — press Index</span>
          <button id="zsIndex" class="zs-miniBtn zs-histBtn" type="button" title="Walk the site once to learn how many sets and models exist">Index</button>
        </div>
        <button id="zsStart" type="button" disabled>Start Queue</button>
        <div id="zsLog" class="zs-log" aria-live="polite"></div>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.go = panel.querySelector('#zsGo');
    ui.fill = panel.querySelector('#zsFill');
    ui.album = panel.querySelector('#zsAlbum');
    ui.count = panel.querySelector('#zsCount');
    ui.log = panel.querySelector('#zsLog');
    ui.drop = panel.querySelector('#zsDrop');
    ui.queue = panel.querySelector('#zsQueue');
    ui.queueCount = panel.querySelector('#zsQueueCount');
    ui.add = panel.querySelector('#zsAdd');
    ui.addPage = panel.querySelector('#zsAddPage');
    ui.addAll = panel.querySelector('#zsAddAll');
    ui.clear = panel.querySelector('#zsClear');
    ui.start = panel.querySelector('#zsStart');
    ui.eye = panel.querySelector('#zsEye');
    ui.filter = panel.querySelector('#zsFilter');
    ui.force = panel.querySelector('#zsForce');
    ui.linkMode = panel.querySelector('#zsLinkMode');
    ui.histCount = panel.querySelector('#zsHistCount');
    ui.histClear = panel.querySelector('#zsHistClear');
    ui.stats = panel.querySelector('#zsStats');
    ui.index = panel.querySelector('#zsIndex');

    ui.go.addEventListener('click', () => {
      if (state.busy) { requestStop(); return; }
      downloadCurrentAlbum();
    });
    ui.start.addEventListener('click', () => {
      if (state.busy) { requestStop(); return; }
      runQueue();
    });
    ui.add.addEventListener('click', () => {
      const target = targetFromLocation();
      if (!target) { logLine('This page is not an album or a model.'); return; }
      reportQueued(addToQueue([target]));
    });
    ui.addPage.addEventListener('click', () => {
      const targets = targetsFromDocument(document, location.href);
      if (!targets.length) { logLine('No album or model links on this page.'); return; }
      const kind = targets[0].kind === 'model' ? 'model' : 'album';
      logLine(`Found ${targets.length} ${kind} link${targets.length === 1 ? '' : 's'} on this page.`);
      reportQueued(addToQueue(targets));
    });
    ui.addAll.addEventListener('click', () => {
      if (state.crawling) { state.cancel = true; logLine('Stopping the crawl...'); return; }
      crawlListing().catch(err => logLine(`Crawl failed: ${errorMessage(err)}`));
    });
    ui.clear.addEventListener('click', clearQueue);
    ui.eye.addEventListener('click', () => setHidden(!state.hidden));
    ui.filter.addEventListener('click', () => {
      const next = (FILE_FILTERS.indexOf(state.fileFilter) + 1) % FILE_FILTERS.length;
      setFileFilter(FILE_FILTERS[next]);
      logLine(`Downloading: ${FILE_FILTER_LABELS[state.fileFilter]}.`);
      // The mode defines what counts as a duplicate, so both the queue rows and
      // the cards hidden on the page have to be re-judged.
      renderQueue();
      refreshDownloadedCards();
    });
    ui.force.addEventListener('click', () => {
      setForce(!state.force);
      logLine(state.force
        ? 'Duplicates will be downloaded again.'
        : 'Duplicates will be skipped.');
      renderQueue();
    });
    ui.linkMode.addEventListener('click', () => {
      setLinkMode(state.linkMode === 'model' ? 'added' : 'model');
      logLine(state.linkMode === 'model'
        ? 'Links resolve to their model; her whole catalogue gets queued.'
        : 'Links queue exactly as added.');
      renderQueue();
    });
    ui.histClear.addEventListener('click', clearHistory);
    ui.index.addEventListener('click', () => {
      if (state.indexing) { state.cancel = true; logLine('Stopping the index...'); return; }
      buildIndex().catch(err => logLine(`Indexing failed: ${errorMessage(err)}`));
    });
    installDropTarget(panel);
    panel.querySelector('#zsCollapse').addEventListener('click', () => {
      panel.classList.toggle('zs-collapsed');
      panel.querySelector('#zsCollapse').innerHTML = panel.classList.contains('zs-collapsed') ? '&#9662;' : '&#9652;';
    });

    // History, index and the file filter were already read at document-start so
    // the card observer could use them; only the toggles the observer does not
    // need are loaded here.
    setFileFilter(state.fileFilter);
    loadForce();
    loadLinkMode();
    setHidden(true);
    installRouteObserver();
    loadQueue();
    renderHistory();
    renderStats();
    renderQueue();
    syncContext();
    // The body existed before the observer did, so anything already parsed has
    // not been judged yet.
    refreshDownloadedCards();
  }

  // Kept in sessionStorage alongside the queue rather than localStorage, for the
  // same reason: it dies with the tab and leaves nothing on disk.
  function setFileFilter(mode) {
    state.fileFilter = FILE_FILTERS.indexOf(mode) >= 0 ? mode : DEFAULT_FILE_FILTER;
    if (ui.filter) ui.filter.textContent = `Download: ${FILE_FILTER_LABELS[state.fileFilter]}`;
    try { sessionStorage.setItem(FILTER_KEY, state.fileFilter); } catch {}
  }

  function loadFileFilter() {
    let stored = '';
    try { stored = sessionStorage.getItem(FILTER_KEY) || ''; } catch {}
    setFileFilter(stored || DEFAULT_FILE_FILTER);
  }

  function wantsKind(kind) {
    if (state.fileFilter === 'images') return kind === 'image';
    if (state.fileFilter === 'videos') return kind === 'video';
    return true;
  }

  // 'added' queues what you gave it. 'model' treats every album link as a pointer
  // to whoever is in it: the album is resolved to its model tag and she is queued
  // instead, which then expands to her whole catalogue. Dragging in one set you
  // liked therefore fetches everything she has done.
  function setLinkMode(mode) {
    state.linkMode = mode === 'model' ? 'model' : 'added';
    if (ui.linkMode) {
      ui.linkMode.textContent = `Links: ${state.linkMode === 'model' ? 'To model' : 'As added'}`;
      ui.linkMode.classList.toggle('zs-linkModeOn', state.linkMode === 'model');
    }
    try { sessionStorage.setItem(LINKMODE_KEY, state.linkMode); } catch {}
  }

  function loadLinkMode() {
    let stored = '';
    try { stored = sessionStorage.getItem(LINKMODE_KEY) || ''; } catch {}
    setLinkMode(stored);
  }

  // Albums that a model expanded into are already hers; resolving them would
  // fetch a page only to rediscover the model that produced them.
  function needsModelResolution(entry) {
    return state.linkMode === 'model' && entry.kind !== 'model' && !entry.viaModel;
  }

  function setForce(force) {
    state.force = !!force;
    if (ui.force) {
      ui.force.textContent = `Duplicates: ${state.force ? 'Redownload' : 'Skip'}`;
      ui.force.classList.toggle('zs-forceOn', state.force);
    }
    try { sessionStorage.setItem(FORCE_KEY, state.force ? '1' : '0'); } catch {}
  }

  function loadForce() {
    let stored = '';
    try { stored = sessionStorage.getItem(FORCE_KEY) || ''; } catch {}
    // Defaults back to Skip in a fresh tab: forcing is a deliberate one-off, and
    // silently re-downloading a whole library would be an expensive thing to
    // inherit from a tab you closed last week.
    setForce(stored === '1');
  }

  // --- download history -----------------------------------------------------
  //
  // Keyed by album id, recording which file-kind modes have actually completed
  // for it — because an album saved in Images mode is not a duplicate when you
  // come back for its video. Flags are 'a' (all), 'i' (images) and 'v' (videos).
  //
  // A record means files were written. An album that produced nothing is never
  // recorded, which keeps the history from filling with conclusions like "this
  // one has no video" that are really statements about the detector rather than
  // about the album.

  const HISTORY_FLAGS = { all: 'a', images: 'i', videos: 'v' };

  function loadHistory() {
    state.history = new Map();
    let raw = '';
    try { raw = localStorage.getItem(HISTORY_KEY) || ''; } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      Object.keys(parsed).forEach(id => {
        const record = parsed[id];
        if (!record || !/^\d+$/.test(id)) return;
        state.history.set(id, {
          k: String(record.k || '').replace(/[^aiv]/g, ''),
          t: Number(record.t) || 0,
          n: String(record.n || '')
        });
      });
    } catch {}
  }

  function saveHistory() {
    const out = {};
    state.history.forEach((record, id) => { out[id] = record; });
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(out));
    } catch (err) {
      logLine(`History could not be saved (${errorMessage(err)}); duplicates will not be remembered.`);
    }
  }

  // "all" is satisfied by a previous "all", or by having done images and videos
  // separately — between them they covered everything an "all" run would have.
  function historySatisfies(id, mode) {
    const record = state.history.get(String(id));
    if (!record) return false;
    const flags = record.k || '';
    if (flags.indexOf('a') >= 0) return true;
    if (mode === 'images') return flags.indexOf('i') >= 0;
    if (mode === 'videos') return flags.indexOf('v') >= 0;
    return flags.indexOf('i') >= 0 && flags.indexOf('v') >= 0;
  }

  function markDownloaded(id, mode, name) {
    const key = String(id);
    const flag = HISTORY_FLAGS[mode] || 'a';
    const existing = state.history.get(key);
    const flags = ((existing && existing.k) || '').indexOf(flag) >= 0
      ? existing.k
      : `${(existing && existing.k) || ''}${flag}`;
    state.history.set(key, { k: flags, t: Date.now(), n: String(name || (existing && existing.n) || '') });
    saveHistory();
    renderHistory();
    renderStats();
    // The card for what just finished should disappear, and finishing a model's
    // last set should take her directory card with it.
    refreshDownloadedCards();
  }

  function renderHistory() {
    if (!ui.histCount) return;
    const size = state.history.size;
    ui.histCount.textContent = size
      ? `History: ${size} album${size === 1 ? '' : 's'}`
      : 'History empty';
    ui.histClear.disabled = !size;
  }

  // --- completion index -----------------------------------------------------
  //
  // "Downloaded 412 sets" means nothing without a denominator, so the index is a
  // snapshot of what the site holds: every album id, and every model with the
  // albums that are hers.
  //
  // It is built from authoritative pages rather than inferred. Album slugs start
  // with the model's name, and matching them against the directory resolves 97%
  // of them — but the misses are structural, not noise: "camila-and-mercy-friends-
  // again" is a two-model set that neither name prefixes, and no amount of
  // tightening fixes that class. Her tag page lists it correctly, so tag pages are
  // what gets walked.
  //
  // Two phases, saved separately, because they cost very different amounts:
  //   1. the album listings — around 170 fetches, and enough on its own for the
  //      set total;
  //   2. the model directory and every model's tag pages — around 800 more, and
  //      what makes per-model completion possible.
  // Cancelling after the first leaves a usable index rather than nothing.

  function loadIndex() {
    state.index = null;
    let raw = '';
    try { raw = localStorage.getItem(INDEX_KEY) || ''; } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const models = {};
      Object.keys(parsed.models || {}).forEach(id => {
        const model = parsed.models[id];
        if (!model) return;
        models[id] = { n: String(model.n || ''), a: (model.a || []).map(String) };
      });
      state.index = {
        t: Number(parsed.t) || 0,
        albums: (parsed.albums || []).map(String),
        models,
        complete: !!parsed.complete
      };
    } catch {}
  }

  function saveIndex() {
    if (!state.index) return;
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(state.index));
    } catch (err) {
      logLine(`Index could not be saved (${errorMessage(err)}).`);
    }
  }

  async function buildIndex() {
    if (state.busy || state.crawling) { logLine('Wait for the current run to finish.'); return; }
    if (state.indexing) return;

    state.indexing = true;
    state.cancel = false;
    ui.index.textContent = 'Stop';
    ui.index.classList.add('zs-stop');
    const index = { t: Date.now(), albums: [], models: {}, complete: false };
    try {
      logLine('Indexing the site. This is a long read-only pass; it can be stopped at any time.');

      const albums = new Set();
      await walkListingPages(`${ORIGIN}/albums`, (targets, page) => {
        targets.forEach(target => { if (target.kind === 'album') albums.add(target.id); });
        if (page % 10 === 0) logLine(`Listings: page ${page + 1}, ${albums.size} sets.`);
        return true;
      });
      index.albums = Array.from(albums);
      state.index = index;
      saveIndex();
      renderStats();
      logLine(`Phase 1 done: ${index.albums.length} sets on the site.`);
      if (state.cancel) { logLine('Stopped after phase 1; set totals are usable, model totals are not.'); return; }

      const directory = targetsFromDocument(parseDoc(await fetchTextWithRetry(`${ORIGIN}/girls`)), `${ORIGIN}/girls`)
        .filter(target => target.kind === 'model');
      logLine(`Phase 2: ${directory.length} models to walk.`);

      for (let i = 0; i < directory.length; i++) {
        if (state.cancel) break;
        const model = directory[i];
        const hers = new Set();
        await walkListingPages(`${ORIGIN}/albums?tag_id=${encodeURIComponent(model.id)}`, targets => {
          targets.forEach(target => {
            if (target.kind !== 'album') return;
            hers.add(target.id);
            // A set can be indexed here and nowhere else, if the listings never
            // surfaced it; the album total is the union of both passes.
            if (!albums.has(target.id)) { albums.add(target.id); index.albums.push(target.id); }
          });
          return true;
        }, { quiet: true });
        index.models[model.id] = { n: model.name || `Model ${model.id}`, a: Array.from(hers) };
        if (i % 25 === 0 || i === directory.length - 1) {
          logLine(`Models: ${i + 1}/${directory.length} (${model.name || model.id}).`);
          state.index = index;
          saveIndex();
          renderStats();
        }
        await delay(PAGE_DELAY_MS);
      }
      index.complete = !state.cancel;
      state.index = index;
      saveIndex();
      logLine(state.cancel
        ? `Stopped: ${Object.keys(index.models).length} of ${directory.length} models indexed.`
        : `Index complete: ${index.albums.length} sets across ${Object.keys(index.models).length} models.`);
    } catch (err) {
      if (errorMessage(err) === 'cancelled') logLine('Indexing stopped.');
      else logLine(`Indexing failed: ${errorMessage(err)}`);
      // Whatever it reached is still worth more than nothing.
      if (index.albums.length) { state.index = index; saveIndex(); }
    } finally {
      state.indexing = false;
      state.cancel = false;
      ui.index.textContent = 'Index';
      ui.index.classList.remove('zs-stop');
      renderStats();
      // Model cards can only be judged complete once the index knows her sets.
      refreshDownloadedCards();
    }
  }

  // "Completely downloaded" is read strictly: a set counts only when everything in
  // it has been saved, which is what an "all" run does, or images and videos runs
  // between them. A model counts when every set of hers does.
  function computeCompletion() {
    const index = state.index;
    if (!index) return null;
    const setsTotal = index.albums.length;
    let setsDone = 0;
    index.albums.forEach(id => { if (historySatisfies(id, 'all')) setsDone++; });

    // A model with no sets is left out of the denominator entirely rather than
    // counted as forever incomplete, which would put 100% out of reach.
    const modelIds = Object.keys(index.models).filter(id => (index.models[id].a || []).length);
    let modelsDone = 0;
    let modelsStarted = 0;
    modelIds.forEach(id => {
      const hers = index.models[id].a;
      const done = hers.filter(albumId => historySatisfies(albumId, 'all')).length;
      if (done === hers.length) modelsDone++;
      else if (done) modelsStarted++;
    });
    return { setsDone, setsTotal, modelsDone, modelsStarted, modelsTotal: modelIds.length, complete: index.complete };
  }

  function renderStats() {
    if (!ui.stats) return;
    const stats = computeCompletion();
    if (!stats) {
      ui.stats.textContent = 'No index — press Index';
      ui.stats.title = 'Walks the site once to learn how many sets and models there are.';
      return;
    }
    const pct = total => (total ? Math.floor((stats.setsDone / total) * 100) : 0);
    const setLine = `Sets ${stats.setsDone}/${stats.setsTotal} (${pct(stats.setsTotal)}%)`;
    const modelLine = stats.modelsTotal
      ? `Models ${stats.modelsDone}/${stats.modelsTotal}`
      : 'Models not indexed';
    ui.stats.textContent = `${setLine} · ${modelLine}`;
    ui.stats.title = [
      `${stats.setsDone} of ${stats.setsTotal} sets fully downloaded.`,
      `${stats.modelsDone} models complete, ${stats.modelsStarted} partly done, of ${stats.modelsTotal}.`,
      stats.complete ? '' : 'Index is partial — run Index again to finish it.'
    ].filter(Boolean).join('\n');
  }

  function clearHistory() {
    const size = state.history.size;
    if (!size) { logLine('History is already empty.'); return; }
    // Irreversible and easy to hit by accident next to the queue controls, so it
    // asks — and says how much it is about to forget.
    if (!confirm(`Forget ${size} downloaded album${size === 1 ? '' : 's'}?\n\nEverything will look new again and can be re-downloaded.`)) return;
    state.history = new Map();
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    renderHistory();
    // The index survives — it describes the site, not what you have — but every
    // completion figure read off it just went to zero.
    renderStats();
    renderQueue();
    // Everything the site was hiding comes back, since nothing counts as had.
    refreshDownloadedCards();
    logLine(`History cleared: ${size} album${size === 1 ? '' : 's'} forgotten.`);
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
      #zishyStripperPanel{position:fixed;right:16px;top:16px;z-index:2147483646;width:300px;max-height:88vh;
        display:flex;flex-direction:column;border:1px solid rgba(217,205,239,.4);border-radius:10px;
        background:#17161c;color:#efeaf7;box-shadow:0 18px 60px rgba(0,0,0,.55);font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #zishyStripperPanel.zs-collapsed{height:auto}
      #zishyStripperPanel.zs-collapsed .zs-body{display:none}
      #zishyStripperPanel .zs-head{height:38px;display:flex;align-items:center;gap:6px;padding:0 10px;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#2b2338,#1a1720);cursor:default}
      #zishyStripperPanel .zs-title{font-weight:900;color:#d9cdef;flex:1 1 auto;min-width:0}
      #zishyStripperPanel .zs-iconBtn{flex:0 0 auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px;font-size:13px}
      #zishyStripperPanel .zs-body{display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0;overflow:auto}
      #zishyStripperPanel button{appearance:none;width:100%;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#efeaf7;font:700 12px/1 Arial,sans-serif;cursor:pointer}
      #zishyStripperPanel button:hover:not(:disabled){background:rgba(217,205,239,.2);border-color:rgba(217,205,239,.55)}
      #zishyStripperPanel button:disabled{opacity:.42;cursor:default}
      #zishyStripperPanel #zsGo{background:#d9cdef;color:#1a1720;border-color:#e6dcff}
      #zishyStripperPanel #zsGo.zs-stop,#zishyStripperPanel #zsStart.zs-stop,
      #zishyStripperPanel .zs-miniBtn.zs-stop{background:#3a2a4a;color:#efe4ff;border-color:rgba(217,205,239,.6)}
      #zishyStripperPanel .zs-progress{display:block;box-sizing:border-box;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      #zishyStripperPanel #zsFill{display:block;height:10px;min-height:10px;width:0;
        background:linear-gradient(90deg,#8f7bc0,#d9cdef);transition:width 120ms ease}
      #zishyStripperPanel .zs-meta{display:flex;justify-content:space-between;gap:10px;color:#b6acc9;font-weight:700}
      #zishyStripperPanel .zs-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #zishyStripperPanel .zs-drop{display:flex;align-items:center;justify-content:center;min-height:44px;padding:6px 8px;
        border:1px dashed rgba(217,205,239,.45);border-radius:8px;background:rgba(217,205,239,.06);
        color:#a99cc0;font-weight:700;text-align:center}
      #zishyStripperPanel.zs-dragging .zs-drop{border-color:#d9cdef;border-style:solid;
        background:rgba(217,205,239,.22);color:#fff}
      #zishyStripperPanel .zs-queueHead{color:#b6acc9;font-weight:700}
      #zishyStripperPanel .zs-queueHead span{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #zishyStripperPanel .zs-queueBtns{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
      #zishyStripperPanel .zs-miniBtn{min-height:26px;padding:0 6px;font-size:11px;border-radius:6px}
      #zishyStripperPanel .zs-queue{display:flex;flex-direction:column;gap:4px;max-height:210px;overflow:auto;
        border:1px solid rgba(255,255,255,.08);border-radius:8px;background:rgba(0,0,0,.2);padding:6px}
      #zishyStripperPanel .zs-queue[hidden]{display:none}
      #zishyStripperPanel .zs-row{display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center}
      #zishyStripperPanel .zs-rowIndex{color:#7d7290;font-weight:700;font-size:10px;min-width:24px}
      #zishyStripperPanel .zs-rowName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#e4dcf2;font-weight:700}
      #zishyStripperPanel .zs-rowName small{display:block;color:#8f849f;font-weight:700;font-size:10px}
      #zishyStripperPanel .zs-rowKill{width:22px;min-height:22px;padding:0;border-radius:6px;font-size:11px;line-height:1}
      #zishyStripperPanel .zs-row.is-active .zs-rowName{color:#d9cdef}
      #zishyStripperPanel .zs-row.is-done .zs-rowName{color:#8fbf9a}
      #zishyStripperPanel .zs-row.is-failed .zs-rowName{color:#e08a7a}
      #zishyStripperPanel .zs-row.is-skipped .zs-rowName{color:#7d7290}
      #zishyStripperPanel .zs-row.is-modelRow .zs-rowName{color:#c9b6ef}
      #zishyStripperPanel .zs-row.is-modelRow.is-done .zs-rowName{color:#8fbf9a}
      #zishyStripperPanel .zs-row.is-dupe .zs-rowName{color:#7d7290}
      #zishyStripperPanel .zs-row.is-dupe .zs-rowName small{color:#6a5f7c}
      #zishyStripperPanel .zs-cycles{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      #zishyStripperPanel .zs-cycle{background:rgba(217,205,239,.1);border-color:rgba(217,205,239,.32);
        font-size:11px;min-height:28px;padding:0 6px}
      #zishyStripperPanel .zs-cycle.zs-cycleWide{grid-column:1 / -1}
      #zishyStripperPanel .zs-cycle.zs-forceOn{background:rgba(224,138,122,.2);border-color:rgba(224,138,122,.55);color:#ffd8cf}
      #zishyStripperPanel .zs-cycle.zs-linkModeOn{background:rgba(143,191,154,.18);border-color:rgba(143,191,154,.5);color:#d6f0dc}
      #zishyStripperPanel .zs-row.is-willResolve .zs-rowName small{color:#8fbf9a}
      #zishyStripperPanel .zs-histHead{display:flex;align-items:center;gap:6px;color:#b6acc9;font-weight:700}
      #zishyStripperPanel .zs-histHead span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #zishyStripperPanel .zs-histBtn{flex:0 0 auto;width:auto;min-width:54px}
      #zishyStripperPanel .zs-log{min-height:88px;max-height:220px;overflow:auto;border:1px solid rgba(255,255,255,.08);
        border-radius:8px;background:rgba(0,0,0,.3);padding:7px;color:#b3a8c4;white-space:pre-wrap}
      #zishyStripperPanel .zs-log div{margin:0 0 4px}
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

  // --- context --------------------------------------------------------------

  // Albums live at /albums/<id>-<slug>. The bare /albums path, and /albums?tag_id=
  // or ?q= or ?page=, are listings — they carry no id of their own.
  function albumRefFromPath(path) {
    const match = decodeURIComponent(String(path || '')).match(/^\/albums\/(\d+)(?:-([^/?#]*))?\/?$/i);
    if (!match) return null;
    return { id: match[1], slug: String(match[2] || ''), name: '' };
  }

  function albumRefFromLocation() {
    return albumRefFromPath(location.pathname);
  }

  // What "+ This" acts on: the album you are reading, or — on a model's tag page —
  // the model herself.
  function targetFromLocation() {
    return targetFromUrl(location.href, ORIGIN);
  }

  function syncContext() {
    const target = targetFromLocation();
    const album = target && target.kind === 'album' ? target : null;
    state.albumId = album ? album.id : '';
    if (album) {
      const label = titleFromSlug(album.slug) || `Album ${album.id}`;
      ui.go.disabled = false;
      ui.album.textContent = label;
      ui.album.title = `${label} (${album.id})`;
      logLine(`Ready. ${label}.`);
    } else {
      ui.go.disabled = true;
      ui.album.textContent = target ? `Model ${target.id}` : 'No album';
      ui.album.title = '';
      ui.count.textContent = '0 photos';
      if (target) logLine('Model page. + This queues her whole catalogue.');
      else if (isModelDirectoryUrl(location.href)) logLine('Model directory. + Page queues every model on it.');
      else if (isListingUrl(location.href)) logLine('Listing page. Use + Page or + All Pages.');
      else logLine('Open an album, a model, or a listing to queue from.');
    }
    ui.addAll.disabled = !isListingUrl(location.href);
  }

  function isModelDirectoryUrl(raw) {
    try {
      return decodeURIComponent(new URL(String(raw || ''), ORIGIN).pathname).replace(/\/$/, '') === '/girls';
    } catch {
      return false;
    }
  }

  // Anything that renders a paginated grid: the homepage, /albums, a model's tag
  // page, a search, /xtras. All of them take ?page=N. /girls is deliberately not
  // one — it lists every model on a single page, with no pagination to walk.
  function isListingUrl(raw) {
    let url;
    try { url = new URL(String(raw || ''), ORIGIN); } catch { return false; }
    const path = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/';
    if (albumRefFromPath(url.pathname)) return false;
    return path === '/' || path === '/albums' || path === '/xtras';
  }

  // --- queue ----------------------------------------------------------------

  function installDropTarget(panel) {
    let depth = 0;
    const setDragging = on => panel.classList.toggle('zs-dragging', on);

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
      const targets = targetsFromTransfer(event.dataTransfer);
      if (!targets.length) { logLine('Nothing album- or model-shaped in that drop.'); return; }
      reportQueued(addToQueue(targets));
    });
  }

  // A dragged link arrives as several flavours at once. Read them all and let the
  // URL matcher sort it out, so a dragged cover, a dragged album link, a dragged
  // model profile off /girls and a pasted list of URLs all land the same way.
  function targetsFromTransfer(transfer) {
    if (!transfer) return [];
    const chunks = [];
    ['text/uri-list', 'text/plain', 'text/html', 'URL', 'Text'].forEach(type => {
      try {
        const value = transfer.getData(type);
        if (value) chunks.push(value);
      } catch {}
    });
    return targetsFromText(chunks.join('\n'));
  }

  function targetsFromText(text) {
    const seen = new Set();
    const targets = [];
    // `#`-prefixed lines are uri-list comments, not URLs.
    String(text || '').split(/[\s"'<>]+/).forEach(token => {
      if (!token || token.charAt(0) === '#') return;
      const target = targetFromUrl(token, ORIGIN);
      if (!target || seen.has(targetKey(target))) return;
      seen.add(targetKey(target));
      targets.push(target);
    });
    return targets;
  }

  function targetKey(target) {
    return `${target.kind}:${target.id}`;
  }

  // The two shapes are unambiguous: /albums/<id>-<slug> is one album, and /albums
  // with a tag_id is one model's set of them. Anything else is neither.
  function targetFromUrl(raw, baseUrl) {
    const value = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!value) return null;
    let url;
    try { url = new URL(value, baseUrl || ORIGIN); } catch { return null; }
    if (!/(?:^|\.)zishy\.com$/i.test(url.hostname)) return null;

    const album = albumRefFromPath(url.pathname);
    if (album) return Object.assign({ kind: 'album' }, album);

    const path = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/';
    if (path !== '/albums') return null;
    const tagId = String(url.searchParams.get('tag_id') || '').trim();
    if (!/^\d+$/.test(tagId) || Number(tagId) <= 0) return null;
    return { kind: 'model', id: tagId, slug: '', name: '' };
  }

  // Every album- or model-shaped link on whatever page is open. Listings write
  // their hrefs relative ("albums/2719-...", "albums?tag_id=340"), and a fetched
  // document resolves relative hrefs against *this* page rather than the one it
  // came from, so the base URL is passed in and the attribute resolved by hand.
  //
  // Albums win outright when the page has any: an album page also links its own
  // model, and queueing her whole catalogue off a single album would be a wild
  // overreach of "+ Page". The model directory carries no album links at all, so
  // the fallback needs no special case for it.
  function targetsFromDocument(doc, baseUrl) {
    const albums = new Map();
    const models = new Map();
    Array.from(doc.querySelectorAll('a[href]')).forEach(anchor => {
      if (ui.panel && ui.panel.contains(anchor)) return;
      const target = targetFromUrl(anchor.getAttribute('href'), baseUrl);
      if (!target) return;
      if (target.kind === 'album') {
        if (albums.has(target.id)) return;
        target.name = titleFromSlug(target.slug);
        albums.set(target.id, target);
        return;
      }
      if (models.has(target.id)) return;
      target.name = modelNameFromAnchor(anchor);
      models.set(target.id, target);
    });
    return albums.size ? Array.from(albums.values()) : Array.from(models.values());
  }

  // On /girls each profile is an <a> wrapping the thumbnail with the name in a
  // <strong> beside it, inside the same .albumcover cell.
  function modelNameFromAnchor(anchor) {
    const cell = anchor.closest('.albumcover') || anchor.parentElement;
    const strong = cell ? cell.querySelector('strong') : null;
    const name = sanitizeNamePart(strong ? strong.textContent : '');
    if (name) return name.slice(0, 120);
    return sanitizeNamePart(String(anchor.textContent || '').replace(/^\s*#\s*/, '')).slice(0, 120);
  }

  // "+ All Pages": walk ?page=N off whatever listing you are looking at, so it
  // works the same for the whole site, one model's tag page, or a search.
  async function crawlListing() {
    if (state.busy) { logLine('Wait for the current run to finish.'); return; }
    if (state.indexing) { logLine('Stop the index first.'); return; }
    if (!isListingUrl(location.href)) { logLine('This is not a listing page.'); return; }
    if (state.crawling) return;

    state.crawling = true;
    state.cancel = false;
    ui.addAll.textContent = 'Stop Crawl';
    ui.addAll.classList.add('zs-stop');
    let queued = 0;
    try {
      const base = new URL(location.href);
      base.searchParams.delete('page');
      logLine(`Crawling ${base.pathname}${base.search} ...`);
      await walkListingPages(base.href, (targets, page) => {
        const added = addToQueue(targets);
        queued += added.length;
        logLine(`Page ${page + 1}: ${targets.length} item${targets.length === 1 ? '' : 's'}, ${added.length} new (${state.queue.length} queued).`);
        return state.queue.length < QUEUE_LIMIT || (logLine('Queue is full; stopping the crawl.'), false);
      });
      logLine(state.cancel
        ? `Crawl stopped with ${queued} queued.`
        : `Crawl done: ${queued} new item${queued === 1 ? '' : 's'} queued.`);
    } catch (err) {
      // A cancel lands as a thrown 'cancelled' when it arrives mid-fetch rather
      // than at the top of the loop; it is a stop, not a failure.
      if (errorMessage(err) === 'cancelled') logLine(`Crawl stopped with ${queued} queued.`);
      else throw err;
    } finally {
      state.crawling = false;
      state.cancel = false;
      ui.addAll.textContent = '+ All Pages';
      ui.addAll.classList.remove('zs-stop');
    }
  }

  // Shared by the crawl and by model expansion. The site's pagination is
  // 0-indexed — /albums?page=0 is the first page and page=1 is the second, while
  // the bare URL is a landing view showing the first two pages at once. Starting
  // at 1 therefore skips the newest page silently, and on a single-page tag it
  // finds nothing at all.
  async function walkListingPages(baseHref, onPage, opts) {
    const quiet = !!(opts && opts.quiet);
    const say = text => { if (!quiet) logLine(text); };
    const base = new URL(baseHref);
    base.searchParams.delete('page');
    for (let page = 0; page < MAX_LISTING_PAGES; page++) {
      if (state.cancel) { say('Stopped.'); return; }
      const pageUrl = new URL(base.href);
      pageUrl.searchParams.set('page', String(page));
      const targets = targetsFromDocument(parseDoc(await fetchTextWithRetry(pageUrl.href)), pageUrl.href);
      // Only an empty page ends the walk. A page whose items are all known already
      // does not: listings reorder as new sets land, so one overlapping page is a
      // repeat, not the end of the list.
      if (!targets.length) { say(`Page ${page + 1} is empty; that is the end.`); return; }
      if (onPage(targets, page) === false) return;
      await delay(PAGE_DELAY_MS);
    }
    say(`Stopped at the ${MAX_LISTING_PAGES}-page ceiling.`);
  }

  function entryKey(entry) {
    return `${entry.kind || 'album'}:${entry.id}`;
  }

  // `insertAt` is used by model expansion, so a model's albums land directly
  // after her rather than at the back of a queue that may be thousands long.
  function addToQueue(targets, insertAt) {
    const known = new Set(state.queue.map(entryKey));
    const fresh = [];
    let full = false;
    targets.forEach(target => {
      const kind = target.kind || 'album';
      const key = `${kind}:${target.id}`;
      if (known.has(key)) return;
      if (state.queue.length + fresh.length >= QUEUE_LIMIT) { full = true; return; }
      known.add(key);
      fresh.push({
        kind,
        id: target.id,
        slug: target.slug || '',
        name: target.name || (kind === 'model' ? '' : titleFromSlug(target.slug)),
        viaModel: !!target.viaModel,
        status: 'queued',
        note: kind === 'model' ? 'model' : ''
      });
    });
    if (full) logLine(`Queue is capped at ${QUEUE_LIMIT}; the rest were dropped.`);
    if (typeof insertAt === 'number' && insertAt >= 0) state.queue.splice(insertAt, 0, ...fresh);
    else state.queue.push(...fresh);
    saveQueue();
    renderQueue();
    return fresh;
  }

  function reportQueued(added) {
    if (!added.length) { logLine('Already queued.'); return; }
    const models = added.filter(entry => entry.kind === 'model').length;
    const albums = added.length - models;
    const parts = [];
    if (albums) parts.push(`${albums} album${albums === 1 ? '' : 's'}`);
    if (models) parts.push(`${models} model${models === 1 ? '' : 's'}`);
    logLine(`Queued ${parts.join(' and ')}.`);
  }

  function clearQueue() {
    if (state.busy) { logLine('Stop the queue before clearing it.'); return; }
    state.queue = [];
    saveQueue();
    renderQueue();
    logLine('Queue cleared.');
  }

  function removeFromQueue(key) {
    const entry = state.queue.find(item => entryKey(item) === key);
    if (entry && entry.status === 'active') { logLine('That one is running; press Stop first.'); return; }
    state.queue = state.queue.filter(item => entryKey(item) !== key);
    saveQueue();
    renderQueue();
  }

  function pendingQueueEntries() {
    return state.queue.filter(entry => entry.status === 'queued' || entry.status === 'active');
  }

  function renderQueue() {
    const pendingEntries = pendingQueueEntries();
    const pending = pendingEntries.length;
    // What "to go" means depends on the toggles: with Duplicates on Skip, the
    // rows the history already covers are not work, and saying otherwise would
    // promise a run far longer than the one about to happen.
    const live = state.force
      ? pending
      : pendingEntries.filter(entry => entry.kind === 'model'
          || needsModelResolution(entry)
          || !historySatisfies(entry.id, state.fileFilter)).length;
    ui.queue.hidden = !state.queue.length;
    ui.queue.textContent = '';
    ui.queueCount.textContent = state.queue.length
      ? `Queue: ${state.queue.length} (${live} to go${live === pending ? '' : `, ${pending - live} dup`})`
      : 'Queue empty';
    ui.start.disabled = state.busy ? false : !pending;
    ui.start.textContent = state.busy ? 'Stop' : (pending ? `Start Queue (${pending})` : 'Start Queue');
    ui.start.classList.toggle('zs-stop', state.busy);

    state.queue.forEach((entry, index) => {
      const isModel = entry.kind === 'model';
      // Live rather than stamped at add time, so flipping the file-kind or the
      // Duplicates toggle restates every row without rebuilding the queue.
      // An album waiting to be resolved to its model is not being downloaded, so
      // the history has no opinion on it yet.
      const willResolve = entry.status === 'queued' && needsModelResolution(entry);
      const isDupe = !isModel && !willResolve && entry.status === 'queued'
        && historySatisfies(entry.id, state.fileFilter);
      const row = document.createElement('div');
      row.className = `zs-row is-${entry.status}${isModel ? ' is-modelRow' : ''}`
        + `${isDupe ? ' is-dupe' : ''}${willResolve ? ' is-willResolve' : ''}`;

      const position = document.createElement('span');
      position.className = 'zs-rowIndex';
      position.textContent = String(index + 1);

      const fallback = isModel ? `Model ${entry.id}` : `Album ${entry.id}`;
      const name = document.createElement('div');
      name.className = 'zs-rowName';
      name.textContent = `${isModel ? '★ ' : ''}${entry.name || fallback}`;
      name.title = `${entry.name || fallback} (${isModel ? 'tag ' : ''}${entry.id})`;
      const note = document.createElement('small');
      note.textContent = willResolve
        ? '→ will queue its model'
        : (isDupe
          ? (state.force ? 'downloaded — will redownload' : 'downloaded — will skip')
          : (entry.note || entry.status));
      name.appendChild(note);

      const kill = document.createElement('button');
      kill.className = 'zs-rowKill';
      kill.type = 'button';
      kill.textContent = '✕';
      kill.title = 'Remove from queue';
      kill.addEventListener('click', () => removeFromQueue(entryKey(entry)));

      row.appendChild(position);
      row.appendChild(name);
      row.appendChild(kill);
      ui.queue.appendChild(row);
    });
  }

  function saveQueue() {
    try {
      sessionStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue));
    } catch (err) {
      logLine(`Queue could not be saved (${errorMessage(err)}); it will not survive a page load.`);
    }
  }

  function loadQueue() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]');
      if (!Array.isArray(parsed)) return;
      state.queue = parsed
        .filter(entry => entry && /^\d+$/.test(String(entry.id)))
        .slice(0, QUEUE_LIMIT)
        .map(entry => ({
          // Queues written before models existed have no kind; they were albums.
          kind: entry.kind === 'model' ? 'model' : 'album',
          id: String(entry.id),
          slug: String(entry.slug || ''),
          name: String(entry.name || ''),
          viaModel: !!entry.viaModel,
          // A run interrupted by navigation left this mid-flight; it never finished.
          status: /^(?:done|failed|skipped)$/.test(String(entry.status)) ? entry.status : 'queued',
          note: String(entry.note || '')
        }));
    } catch {}
  }

  async function runQueue() {
    // All three share state.cancel, so letting two run at once would let either
    // one abort the other mid-fetch.
    if (state.crawling) { logLine('Stop the crawl first.'); return; }
    if (state.indexing) { logLine('Stop the index first.'); return; }
    const pending = pendingQueueEntries();
    if (!pending.length) { logLine('Nothing queued.'); return; }

    state.abortQueue = false;
    state.queueRunning = true;
    setBusy(true);
    resetLog();
    logLine(`Starting queue: ${pending.length} item${pending.length === 1 ? '' : 's'}.`);

    let completed = 0;
    try {
      // Re-read the queue each lap rather than iterating a snapshot, so albums
      // dropped in while it is running — including the ones a model expands into —
      // get eaten by the same pass.
      while (!state.abortQueue) {
        const entry = state.queue.find(item => item.status === 'queued');
        if (!entry) break;
        const isModel = entry.kind === 'model';
        const resolveToModel = needsModelResolution(entry);
        completed++;
        const total = completed + state.queue.filter(item => item.status === 'queued').length - 1;
        entry.status = 'active';
        entry.note = isModel ? 'listing sets' : (resolveToModel ? 'finding model' : 'downloading');
        renderQueue();
        ui.count.textContent = `${completed}/${total}`;
        logLine(`--- ${completed}/${total}: ${entry.name || `${isModel ? 'model' : 'album'} ${entry.id}`} ---`);

        state.cancel = false;
        try {
          if (isModel) {
            const found = await expandModelEntry(entry);
            entry.status = 'done';
            entry.note = `${found} album${found === 1 ? '' : 's'}`;
          } else if (resolveToModel) {
            const models = await resolveAlbumToModels(entry);
            if (models.length) {
              const at = state.queue.indexOf(entry);
              const added = addToQueue(models, at >= 0 ? at + 1 : undefined);
              const names = models.map(model => model.name || `Model ${model.id}`).join(' and ');
              entry.status = 'done';
              entry.note = `→ ${names}`;
              logLine(`Resolved to ${names}${added.length ? '' : ' (already queued)'}.`);
            } else {
              // Nothing to resolve to, so the album is the only thing there is.
              // Marked as hers so the next lap downloads it instead of asking again.
              entry.viaModel = true;
              entry.status = 'queued';
              entry.note = 'no model tag';
              logLine('No model tag on this album; downloading the album itself.');
            }
          } else if (!state.force && historySatisfies(entry.id, state.fileFilter)) {
            // Caught before the scan, so a duplicate costs no request at all.
            entry.status = 'skipped';
            entry.note = 'already downloaded';
            logLine(`Already downloaded; skipping. (Duplicates: Redownload overrides this.)`);
          } else {
            const album = await processAlbum(entry);
            entry.name = album.title || entry.name;
            entry.status = 'done';
            entry.note = `${album.saved} file${album.saved === 1 ? '' : 's'}`;
            markDownloaded(entry.id, state.fileFilter, album.title);
          }
        } catch (err) {
          const message = errorMessage(err);
          const cancelled = message === 'cancelled';
          const skipped = !cancelled && !!(err && err.skip);
          entry.status = cancelled ? 'queued' : (skipped ? 'skipped' : 'failed');
          entry.note = cancelled ? 'queued' : message.slice(0, 60);
          setProgress(0);
          if (cancelled) logLine('Cancelled.');
          else logLine(`${isModel ? 'Model' : 'Album'} ${entry.id} ${skipped ? 'skipped' : 'failed'}: ${message}`);
          // A cancel is aimed at the whole run, not just the album in flight.
          if (cancelled) state.abortQueue = true;
        }
        renderQueue();
        saveQueue();
        if (state.abortQueue) break;
        await delay(ALBUM_DELAY_MS);
      }
      const left = pendingQueueEntries().length;
      logLine(state.abortQueue ? `Queue stopped with ${left} left.` : 'Queue finished.');
    } finally {
      setBusy(false);
      saveQueue();
      renderQueue();
    }
  }

  // --- models ---------------------------------------------------------------
  //
  // A model is a stand-in for her albums, expanded when the runner reaches her
  // rather than when she is queued. That is what makes the model directory usable:
  // dropping all 704 profiles in is instant, and the 704 listing fetches are
  // spread through the run instead of front-loaded before anything downloads.
  //
  // Her albums are spliced in directly after her, so the queue reads model, her
  // sets, next model — and a run interrupted halfway leaves the models it never
  // reached still queued, ready to expand next time.

  function albumUrlFor(ref) {
    return `${ORIGIN}/albums/${ref.id}${ref.slug ? `-${ref.slug}` : ''}`;
  }

  // The model tag beside the download button is the only place an album names
  // whoever is in it, so resolving costs one page fetch. An album with two models
  // yields both, and both get queued.
  async function resolveAlbumToModels(entry) {
    const url = albumUrlFor(entry);
    const doc = parseDoc(await fetchTextWithRetry(url));
    const out = [];
    const seen = new Set();
    Array.from(doc.querySelectorAll('#ziplink a[href*="tag_id="], .moreof a[href*="tag_id="]')).forEach(anchor => {
      const target = targetFromUrl(anchor.getAttribute('href'), url);
      if (!target || target.kind !== 'model' || seen.has(target.id)) return;
      seen.add(target.id);
      target.name = sanitizeNamePart(String(anchor.textContent || '').replace(/^\s*#\s*/, '')).slice(0, 120);
      out.push(target);
    });
    return out;
  }

  async function expandModelEntry(entry) {
    const found = new Map();
    await walkListingPages(`${ORIGIN}/albums?tag_id=${encodeURIComponent(entry.id)}`, (targets, page) => {
      // A tag page lists only albums; a model link on one would be the model
      // herself, and expanding her into herself is a loop worth not writing.
      targets.filter(target => target.kind === 'album').forEach(target => {
        if (!found.has(target.id)) found.set(target.id, target);
      });
      logLine(`  page ${page + 1}: ${found.size} set${found.size === 1 ? '' : 's'} so far.`);
      return true;
    });
    if (state.cancel) throw new Error('cancelled');

    const albums = Array.from(found.values());
    if (!albums.length) {
      const err = new Error('no sets found for this model');
      err.skip = true;
      throw err;
    }

    const at = state.queue.indexOf(entry);
    // Tagged as hers, so link-to-model mode does not send each of them back out
    // to fetch a page and rediscover the model that just produced them.
    albums.forEach(album => { album.viaModel = true; });
    const added = addToQueue(albums, at >= 0 ? at + 1 : undefined);
    if (!entry.name) entry.name = modelNameFromAlbumTargets(albums) || `Model ${entry.id}`;
    logLine(`${entry.name}: ${albums.length} set${albums.length === 1 ? '' : 's'}, ${added.length} newly queued.`);
    return albums.length;
  }

  // The tag page carries no name of its own — its title is just "Zishy" — so when
  // a bare tag URL was dragged in, the name is taken from the common leading words
  // of her albums' titles, which is where the site puts it.
  function modelNameFromAlbumTargets(albums) {
    const wordLists = albums
      .map(album => String(album.name || titleFromSlug(album.slug)).split(/\s+/).filter(Boolean))
      .filter(words => words.length);
    if (wordLists.length < 2) return '';
    const shared = [];
    for (let i = 0; i < wordLists[0].length; i++) {
      const word = wordLists[0][i];
      if (!wordLists.every(words => (words[i] || '').toLowerCase() === word.toLowerCase())) break;
      shared.push(word);
    }
    // Two words is a name; one is more likely a coincidence than an identity.
    return shared.length >= 2 ? sanitizeNamePart(shared.join(' ')) : '';
  }

  // --- download -------------------------------------------------------------

  async function downloadCurrentAlbum() {
    if (state.indexing) { logLine('Stop the index first.'); return; }
    if (state.crawling) { logLine('Stop the crawl first.'); return; }
    const ref = albumRefFromLocation();
    if (!ref) { logLine('This is not an album page.'); return; }
    if (!state.force && historySatisfies(ref.id, state.fileFilter)) {
      const record = state.history.get(String(ref.id));
      const when = record && record.t ? new Date(record.t).toLocaleDateString() : 'earlier';
      logLine(`Already downloaded (${when}). Set Duplicates: Redownload to do it again.`);
      return;
    }

    state.cancel = false;
    state.abortQueue = false;
    setBusy(true);
    resetLog();
    try {
      const album = await processAlbum(ref);
      markDownloaded(ref.id, state.fileFilter, album.title);
    } catch (err) {
      setProgress(0);
      logLine(errorMessage(err) === 'cancelled' ? 'Cancelled.' : `Failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function processAlbum(ref) {
    setProgress(0);
    logLine(`Scanning album ${ref.id}.`);

    const album = await scanAlbum(ref);
    if (state.cancel) throw new Error('cancelled');
    if (!album.items.length) {
      // On Videos, an album with no clip is the common case, not a broken album,
      // and a crawl of the whole site would otherwise read as thousands of
      // failures. It is flagged as skipped so the distinction survives.
      if (state.fileFilter !== 'all') {
        const err = new Error(`no ${state.fileFilter === 'videos' ? 'video' : 'images'} in this album`);
        err.skip = true;
        throw err;
      }
      throw new Error('no photos or videos found in this album');
    }

    ui.album.textContent = album.title;
    ui.album.title = `${album.title} (${album.id})`;
    // During a run the counter is the queue's position readout; leave it alone.
    if (!state.queueRunning) {
      ui.count.textContent = `${album.items.length} file${album.items.length === 1 ? '' : 's'}`;
    }
    logLine(`${album.title} — ${album.items.length} file${album.items.length === 1 ? '' : 's'}, model ${album.models.join(' & ') || 'unknown'}, ${album.date || 'no date'}.`);

    album.saved = await buildAndSaveArchive(album);
    setProgress(100);
    logLine('Done.');
    return album;
  }

  // The whole album arrives in one HTML fetch: title, date, model tag, every
  // full-size URL in display order, and the video poster. There is nothing to
  // paginate and no per-photo page to visit, so this is one request per album.
  async function scanAlbum(ref) {
    const url = `${ORIGIN}/albums/${ref.id}${ref.slug ? `-${ref.slug}` : ''}`;
    const html = await fetchTextWithRetry(url);
    const doc = parseDoc(html);
    setProgress(10);

    const album = {
      id: ref.id,
      slug: ref.slug || '',
      title: titleFrom(doc, ref),
      date: dateFrom(doc),
      models: modelsFrom(doc),
      items: []
    };

    const photos = photosFrom(doc, url);
    const declared = declaredCountFrom(doc);
    const maxIndex = photos.reduce((top, photo) => Math.max(top, photo.displayIndex || 0), 0);
    const expected = Math.max(declared, maxIndex);

    if (expected && photos.length < expected) {
      const signedOut = !doc.querySelector('a[href^="/galzip/"]') && !!doc.querySelector('#ziplink a[href*="/login"]');
      const detail = `saw ${photos.length} of ${expected} photo${expected === 1 ? '' : 's'}${signedOut ? ' — you are signed out, this is the free preview' : ''}`;
      // The guard exists to stop a truncated gallery being saved as a whole one.
      // On Videos it has nothing to protect, so it drops to a warning — being
      // signed out is still worth saying, since the video will be missing too.
      if (!ALLOW_PARTIAL_ALBUMS && wantsKind('image')) throw new Error(detail);
      logLine(`Partial album: ${detail}.`);
    }

    if (wantsKind('image')) {
      album.items = photos.map(photo => ({ kind: 'image', url: photo.url, index: 0 }));
    }

    if (wantsKind('video')) {
      const video = videoFrom(doc, html, url);
      if (video) {
        album.items.push({ kind: 'video', url: video.url, guessed: video.guessed, index: 0 });
        logLine(video.guessed ? 'Video guessed from the poster; skipped if it is not there.' : 'Bonus video found.');
      }
    }

    // Numbered after filtering, so a Videos-only run starts at _001 rather than
    // carrying a gap where the images would have been.
    album.items.forEach((item, index) => { item.index = index + 1; });

    setProgress(15);
    return album;
  }

  // --- parsing --------------------------------------------------------------

  function parseDoc(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  function resolveHref(raw, baseUrl) {
    const value = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!value) return '';
    try { return new URL(value, baseUrl || ORIGIN).href; } catch {}
    try { return new URL(encodeURI(value), baseUrl || ORIGIN).href; } catch {}
    return '';
  }

  function titleFrom(doc, ref) {
    const headline = doc.querySelector('#headline span');
    const heading = sanitizeNamePart(headline ? headline.textContent : '');
    if (heading) return heading;
    // The <title> is "<album> - Zishy"; the suffix is the site, not the album.
    const raw = sanitizeNamePart((doc.querySelector('title') || {}).textContent || '');
    const stripped = raw.replace(/\s*[-–]\s*Zishy\s*$/i, '').trim();
    if (stripped) return stripped;
    return titleFromSlug(ref && ref.slug) || `Album ${ref && ref.id}`;
  }

  // "added on Jun 22, 2026" sits in the headline block as loose text. It is the
  // site's own publication date and the only date the pages carry.
  function dateFrom(doc) {
    const head = doc.querySelector('#headline');
    const text = String((head || doc.body || {}).textContent || '');
    const match = text.match(/added on\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
    if (!match) return '';
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(match[1].slice(0, 3).toLowerCase());
    if (month < 0) return '';
    return `${match[3]}-${String(month + 1).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
  }

  // The model tag beside the download button: <a href="/albums?tag_id=798">#Mirra Jean</a>.
  // This is the site's own identity for her, correctly spelled and cased, which is
  // why nothing here has to guess a name out of a URL slug.
  function modelsFrom(doc) {
    const names = [];
    const seen = new Set();
    const anchors = doc.querySelectorAll('#ziplink a[href*="tag_id="], .moreof a[href*="tag_id="]');
    Array.from(anchors).forEach(anchor => {
      const name = sanitizeNamePart(String(anchor.textContent || '').replace(/^\s*#\s*/, ''));
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      names.push(name);
    });
    return names;
  }

  // DOM order is display order. The number in `full_042_...` is not: 014, 042 and
  // 011 render as photos 1, 2 and 8, so it is a storage id rather than a position.
  function photosFrom(doc, baseUrl) {
    const out = [];
    const seen = new Set();
    const scope = doc.querySelector('#multipleimages') || doc;
    Array.from(scope.querySelectorAll('a[href*="/uploads/full/"]')).forEach(anchor => {
      const url = resolveHref(anchor.getAttribute('href'), baseUrl);
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push({ url, displayIndex: displayIndexFrom(anchor) });
    });
    return out;
  }

  // The preview pages label each photo "<album title> - <n>". Subscriber pages may
  // ship Rails' auto-generated alt instead, so this is used only to notice a
  // truncated album, never to order one.
  function displayIndexFrom(anchor) {
    const img = anchor.querySelector('img');
    if (!img) return 0;
    const label = String(img.getAttribute('title') || img.getAttribute('alt') || '');
    const match = label.match(/-\s*(\d+)\s*$/);
    return match ? Number(match[1]) : 0;
  }

  function declaredCountFrom(doc) {
    const counts = Array.from(doc.querySelectorAll('#countbox strong, #joincontain2 strong'))
      .map(node => Number(String(node.textContent || '').trim()))
      .filter(value => Number.isFinite(value) && value > 0);
    return counts.length ? Math.max.apply(null, counts) : 0;
  }

  function videoFrom(doc, html, baseUrl) {
    const direct = doc.querySelector('video source[src], video[src]');
    if (direct) {
      const url = resolveHref(direct.getAttribute('src'), baseUrl);
      if (url) return { url, guessed: false };
    }
    const anchor = Array.from(doc.querySelectorAll('a[href], source[src]'))
      .map(node => resolveHref(node.getAttribute('href') || node.getAttribute('src'), baseUrl))
      .find(url => /\.(?:mp4|m4v|webm)(?:[?#]|$)/i.test(url));
    if (anchor) return { url: anchor, guessed: false };

    // Players configured in inline script leave the source in the raw HTML only.
    const inline = String(html || '').match(/\/uploads\/files\/[^"'\s)]+\.(?:mp4|m4v|webm)/i);
    if (inline) return { url: resolveHref(inline[0], baseUrl), guessed: false };

    if (!GUESS_VIDEO_FROM_POSTER) return null;
    const poster = String(html || '').match(/\/uploads\/files\/[^"'\s)]+\/movie\.jpg/i);
    if (!poster) return null;
    return { url: resolveHref(poster[0].replace(/\.jpg$/i, '.mp4'), baseUrl), guessed: true };
  }

  // --- naming ---------------------------------------------------------------
  //
  // Zishy/<Model>/<YYMMDD>-<Model> - <Title>.zip, holding
  // <YYMMDD>-<Model> - <Title>/<same>_001.jpg.
  //
  // The model folder comes from the album's tag, and the title has her name
  // stripped off the front, because "Mirra Jean Really Out of Jeans" inside a
  // folder called Mirra Jean says it twice. Anything that cannot be matched
  // confidently keeps the whole title instead.

  function modelFolderFor(album) {
    if (!album.models.length) return UNTAGGED_FOLDER;
    return sanitizeNamePart(album.models.join(MODEL_JOIN)) || UNTAGGED_FOLDER;
  }

  // <yymmdd>-<model> - <title>. The date and the model are one prefix joined by a
  // bare hyphen; " - " is reserved as the single boundary between that prefix and
  // the title, which is why both halves are scrubbed of it. An untagged album has
  // no model to name, so it keeps the plain "<yymmdd> - <title>" shape rather than
  // growing an empty segment.
  function archiveBaseName(album) {
    const model = modelNamePart(album);
    const prefix = model ? `${dateKey(album.date)}-${model}` : dateKey(album.date);
    return `${prefix} - ${albumTitlePart(album)}`;
  }

  function modelNamePart(album) {
    if (!album.models.length) return '';
    return sanitizeNamePart(album.models.join(MODEL_JOIN))
      .replace(/\s+-\s+/g, ' ')
      .replace(/^[\s-]+/, '')
      .replace(/[\s-]+$/, '');
  }

  function albumTitlePart(album) {
    const full = sanitizeNamePart(album.title);
    const trimmed = stripModelPrefix(full, album.models) || full;
    const capped = trimmed
      // Slicing to the cap can leave a dangling hyphen, and a title with its own
      // " - " would read as a second boundary; neither may survive.
      .replace(/\s+-\s+/g, ' ')
      .slice(0, MAX_TITLE_CHARS)
      .replace(/^[\s-]+/, '')
      .replace(/[\s-]+$/, '');
    return capped || `album_${album.id}`;
  }

  // Word-by-word, and each word compared on its letters and digits alone, so the
  // tag "Erna O'Hara" still matches the title's "Erna Ohara". A title that is
  // nothing but the model's name is left whole — there would be no title left.
  function stripModelPrefix(title, models) {
    const words = String(title || '').split(/\s+/).filter(Boolean);
    const bare = word => word.toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (const model of models) {
      const modelWords = String(model || '').split(/\s+/).filter(Boolean);
      if (!modelWords.length || modelWords.length >= words.length) continue;
      const matches = modelWords.every((word, i) => bare(word) && bare(word) === bare(words[i]));
      if (!matches) continue;
      const rest = words.slice(modelWords.length).join(' ');
      // "Keely Rose in Travis County" leaves a lowercase connector at the front.
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return '';
  }

  // The album URL slug, as a last-resort display label before the page is fetched.
  function titleFromSlug(slug) {
    const words = String(slug || '').split('-').filter(Boolean);
    if (!words.length) return '';
    return sanitizeNamePart(words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '));
  }

  // The site's dates are plain wall-clock strings, so read the digits straight off
  // rather than routing them through Date and a timezone shift.
  function dateKey(raw) {
    const match = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '000000';
    return `${match[1].slice(2)}${match[2]}${match[3]}`;
  }

  function sanitizeNamePart(raw) {
    let s = String(raw || '').normalize('NFC');
    s = s.replace(/�/g, '').replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/[\\/:*?"<>|]+/g, '').replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  // Dropping a disallowed character mid-name leaves the spaces that surrounded it
  // sitting next to each other, so the collapse has to happen after the strip and
  // not only in sanitizeNamePart before it.
  function sanitizeFileNameStrict(raw, fallback) {
    const s = sanitizeNamePart(raw)
      .replace(/[^A-Za-z0-9._ -]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return s || fallback || 'download';
  }

  function sanitizeDownloadPathForSave(rawPath) {
    const parts = String(rawPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return (parts.length ? parts : ['zishy_archive.zip'])
      .map((part, idx) => sanitizeFileNameStrict(part, idx === parts.length - 1 ? 'archive.zip' : 'folder'))
      .join('/');
  }

  function inferExt(raw, fallback) {
    const match = String(raw || '').split(/[?#]/)[0].match(/\.([A-Za-z0-9]{2,5})$/);
    const ext = match ? match[1].toLowerCase() : '';
    if (ext === 'jpeg') return 'jpg';
    return /^(?:avif|bmp|gif|jpg|png|webp|mp4|m4v|webm)$/.test(ext) ? ext : (fallback || 'jpg');
  }

  // --- archive --------------------------------------------------------------

  async function buildAndSaveArchive(album) {
    const Zip = resolveJSZip();
    if (!Zip) throw new Error('JSZip is missing (the @require did not load)');

    const folder = modelFolderFor(album);
    const base = archiveBaseName(album);
    const pad = Math.max(MIN_INDEX_PAD, String(album.items.length).length);

    let done = 0;
    await runPool(album.items, IMAGE_CONCURRENCY, async item => {
      try {
        item.data = await fetchBinaryWithRetry(item.url);
      } catch (err) {
        item.error = errorMessage(err);
      }
      done++;
      setProgress(15 + Math.round((done / Math.max(1, album.items.length)) * 72));
    });
    if (state.cancel) throw new Error('cancelled');

    // Zipping is a separate ordered pass so the parallel fetch above cannot
    // disturb album order.
    const zip = new Zip();
    let added = 0;
    let failed = 0;
    album.items.forEach(item => {
      const leaf = `${base}_${String(item.index).padStart(pad, '0')}.${inferExt(item.url, item.kind === 'video' ? 'mp4' : 'jpg')}`;
      if (!item.data) {
        // A guessed video URL that is not there is an absence, not a failure.
        if (item.kind === 'video' && item.guessed) logLine('No bonus video at the guessed URL; skipping it.');
        else { failed++; logLine(`Skipped ${leaf}: ${item.error || 'no data'}`); }
        return;
      }
      zip.file(`${base}/${leaf}`, item.data);
      added++;
    });
    if (!added) throw new Error(`all ${album.items.length} downloads failed`);
    if (failed) logLine(`Archive is partial: ${failed} file${failed === 1 ? '' : 's'} failed.`);

    logLine(`Zipping ${added} file${added === 1 ? '' : 's'}.`);
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      meta => setProgress(87 + Math.round(((meta && meta.percent) || 0) * 0.11))
    );
    album.items.forEach(item => { item.data = null; });
    logLine(`Archive is ${formatBytes(blob.size)}.`);

    const archiveName = sanitizeDownloadPathForSave(`${ROOT_FOLDER}/${folder}/${base}.zip`);
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

  function fetchBinaryWithRetry(url) {
    return withRetry(() => httpBinary(url), 'file download');
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

  // --- transport ------------------------------------------------------------
  //
  // Everything here is same-origin, including the media under /uploads/, so native
  // fetch is the primary path and GM_xmlhttpRequest is only the fallback for
  // managers whose extension bridge stalls on large binaries. Credentials are sent
  // on every request: the full-size files are behind your subscription, and an
  // anonymous fetch of them is what a preview-sized or redirected response looks
  // like. Each path carries its own deadline, so a silent transport fails loudly
  // instead of hanging.

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
      const options = Object.assign({ redirect: 'follow', credentials: 'same-origin' }, init);
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
        const res = await nativeFetch(url, {}, PAGE_TIMEOUT_MS, 'page fetch');
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
        const res = await nativeFetch(url, {}, BLOB_TIMEOUT_MS, 'file fetch');
        if (!res.ok) throw httpStatusError(res.status);
        // A signed-out or expired session answers with the login page rather than
        // a 401, so a media request that comes back as markup is an auth failure
        // wearing a 200.
        const type = String(res.headers.get('content-type') || '').toLowerCase();
        if (/^(?:text\/|application\/(?:json|xml|xhtml))/.test(type)) {
          throw new Error(`server returned ${type.split(';')[0] || 'non-media content'} — check you are signed in`);
        }
        const buffer = await withDeadline('file read', BLOB_TIMEOUT_MS, (ok, fail) => { res.arrayBuffer().then(ok, fail); });
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

  // arraybuffer rather than blob: it is the response type every manager implements
  // consistently, and JSZip takes it directly.
  function gmRequest(url, kind, ms) {
    return withDeadline(kind === 'text' ? 'page request' : 'file request', ms, (ok, fail) => {
      const handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        responseType: kind === 'text' ? undefined : 'arraybuffer',
        headers: kind === 'text'
          ? { Accept: 'text/html,application/xhtml+xml,*/*' }
          : { Referer: `${ORIGIN}/` },
        timeout: ms,
        onload: res => {
          if (res.status < 200 || res.status >= 300) { fail(httpStatusError(res.status)); return; }
          if (kind === 'text') { ok(String(res.responseText || '')); return; }
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

  // GM_download is absent or a silent no-op in several Safari managers, so it gets
  // a deadline and the anchor path picks up whatever it drops.
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
      anchor.download = name.split('/').pop() || 'zishy_archive.zip';
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  // --- panel plumbing -------------------------------------------------------

  function setBusy(busy) {
    state.busy = busy;
    if (!busy) {
      state.queueRunning = false;
      // A stale cancel would otherwise abort the next thing that checks it.
      state.cancel = false;
    }
    ui.go.textContent = busy ? 'Stop' : 'Download Album';
    ui.go.classList.toggle('zs-stop', busy);
    ui.go.disabled = busy ? false : !albumRefFromLocation();
    // Adding stays open during a run — the loop picks up late arrivals — but
    // clearing the list out from under it does not.
    ui.clear.disabled = busy;
    ui.addAll.disabled = busy || !isListingUrl(location.href);
    ui.index.disabled = busy;
    renderQueue();
  }

  // Either button stops everything: a cancel is aimed at the run, not at whichever
  // album happens to be in flight.
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
    if (!ui.log) return;
    const line = document.createElement('div');
    line.textContent = text;
    ui.log.appendChild(line);
    ui.log.scrollTop = ui.log.scrollHeight;
    while (ui.log.childElementCount > 300) ui.log.removeChild(ui.log.firstElementChild);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function errorMessage(err) {
    if (!err) return 'unknown error';
    return String(err.message || err);
  }

  // Hiding has to be in place before the parser reaches the body, or there is
  // nothing left to save; the panel waits for a body to attach itself to.
  //
  // The history and index are read here rather than in init() because the
  // observer cannot judge a card without them, and by the time a body exists the
  // first screenful of cards has already been built. Both are synchronous reads
  // that touch no UI, so they are safe this early.
  applyHideStyle();
  applyDownloadedHideStyle();
  loadHistory();
  loadIndex();
  loadFileFilter();
  installEarlyObserver();
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
