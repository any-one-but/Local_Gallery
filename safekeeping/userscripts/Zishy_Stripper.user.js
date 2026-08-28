// ==UserScript==
// @name         Zishy Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.06.00
// @description  Zishy album downloader. Queue albums from any listing and eat through them one at a time, named by model and date.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/Zishy_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/Zishy_Stripper.user.js
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
  // THE PANEL
  // ===========================================================================
  // One pane, and the same one the Playboy Plus Stripper has. The two sites want
  // the same thing done to them, so the two scripts look and read alike: drop a
  // link or search the index, get rows, press Download. The footer holds the
  // library-wide buttons — Index site, Check all, and the two Clears, each shown
  // only when there is something for it to do.
  //
  // What it is for is taking a model's whole library in one go. A single set is
  // the same row with one thing in it, for picking up what has landed since.
  //
  // There is no queue and no page-scraping button: everything arrives in the
  // results list, from a drop, from a search, or from the page you are standing
  // on. Search only ever surfaces models. The remaining filter — a list of years
  // — sits behind Advanced and folds itself away the moment you search or drop a
  // link, so the field you type into is never crowded out.
  //
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
  // "Already downloaded" here means exactly what the queue would skip, and that
  // is one answer now rather than a reading of what you last asked for: an album
  // is taken whole or it is not taken. A model is hidden on the strict reading —
  // every one of her sets downloaded.
  //
  // There is no manual hiding and nothing to curate: an item is hidden if and
  // only if you have it. A library saved before this script existed, or on
  // another machine, starts out invisible to the history — which is what
  // "Check all" is for: point it at your downloads folder and it fills the
  // history in from what is actually on disk. "Reset" beside it is the other
  // direction: forget every download at once and have the whole site back.
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

  const MAX_LISTING_PAGES = 120; // ceiling for one walk of a paginated listing
  const MAX_RETRIES = 2;
  const PAGE_TIMEOUT_MS = 45000;
  const BLOB_TIMEOUT_MS = 180000;
  const SAVE_TIMEOUT_MS = 20000;
  const MIN_INDEX_PAD = 3;
  const MAX_TITLE_CHARS = 56;

  // Everything lands under one folder in your downloads directory, so a bulk run
  // does not scatter model folders across whatever else is in there.
  const ROOT_FOLDER = 'Zishy';

  // There is no file-kind filter. Everything an album holds is taken, every
  // time — the photos and the "Bonus HD Video Clip", which is appended to the
  // zip after the images, sharing their numbering. An album is one thing and
  // "downloaded" is one answer about it; a half-taken one would be a third state
  // that hiding, skipping and the completion figures would each have to have an
  // opinion about. Absent or unreachable videos are logged and skipped — they
  // never fail an album.

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

  // The one thing this script leaves on disk, and deliberately so: a record of
  // what has already been saved is only useful if it outlives the tab. It is
  // localStorage rather than GM storage so the Clear button and the browser's own
  // "clear site data" both reach it — losing it costs re-downloads, nothing more.
  const HISTORY_KEY = 'ZishyStripper.history.v1';

  // The completion index: what the site actually holds, so "downloaded" has a
  // denominator and the lookup has something to search. Built by the Index
  // button and stored beside the history.
  const INDEX_KEY = 'ZishyStripper.index.v1';

  // ===========================================================================

  const state = {
    busy: false,
    cancel: false,
    checking: false,
    indexing: false,
    hidden: true,
    history: new Map(),
    // The stored index, and the arrays the lookup walks, derived from it.
    index: null,
    view: null,
    // Whether what is in the results came from the page rather than from you.
    // Only that is replaced when you navigate.
    focusedFromPage: false,
    advancedOpen: false,
    transport: ''
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
  // The card is found by structure, not by class name. An earlier version keyed
  // off `.albumcover` and hid nothing on a real subscriber session: the signed-in
  // markup is not the signed-out markup this was written against — the same
  // reason a subscriber's photos carry Rails' auto-generated alt text instead of
  // "<title> - N". Anything that names a class is a guess about a page shape only
  // ever seen logged out.
  //
  // So: start at the link, climb while the parent still holds exactly one
  // album-or-model link, and hide where that stops. A container holding several
  // is the grid, not the card. That works whatever the wrapper is called, and
  // whether or not it has a class at all.
  const CARD_CLIMB_LIMIT = 4;
  // Landmarks that are page furniture rather than a card, in case a listing is
  // ever rendered with a single entry on it.
  const CARD_CLIMB_STOP = 'body, #content, #container, #albums, #girlslist, #multipleimages, #footer';
  // Links that are navigation on a page you deliberately opened. The model chip
  // beside the download button is the important one: it names who you are looking
  // at, and hiding it because she is complete would remove the way back to her.
  const CARD_SKIP_WITHIN = '#zishyStripperPanel, #ziplink, .moreof, #menuz, #bottomnav, #footer, #actionlinks';

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
    return hers.every(historyHas);
  }

  // What this link offers, or null when it is not an offer at all.
  function linkTarget(anchor) {
    if (anchor.closest(CARD_SKIP_WITHIN)) return null;
    return targetFromUrl(anchor.getAttribute('href'), location.href);
  }

  function targetLinkCount(node) {
    return Array.from(node.querySelectorAll('a[href]')).filter(linkTarget).length;
  }

  // Whether there is any point looking at what this link leads to.
  function targetIsHad(target) {
    if (!target) return false;
    if (target.kind === 'model') return isModelComplete(target.id);
    return historyHas(target.id);
  }

  function cardForAnchor(anchor) {
    let card = anchor;
    let node = anchor;
    for (let i = 0; i < CARD_CLIMB_LIMIT; i++) {
      const parent = node.parentElement;
      if (!parent || parent === document.body) break;
      try { if (parent.matches(CARD_CLIMB_STOP)) break; } catch {}
      // More than one offer up here means we have reached the grid; the card is
      // the last thing that was still just this one.
      if (targetLinkCount(parent) > 1) break;
      card = parent;
      node = parent;
    }
    return card;
  }

  // Re-tests the whole page. The answer changes underneath the cards whenever a
  // download completes, the history is cleared, or an index finishes and a
  // model's total becomes knowable.
  //
  // It is a full pass rather than an incremental one because the climb needs a
  // settled DOM: mid-parse, a grid that will hold thirty entries holds one, and
  // an incremental mark would climb straight past the card and hide the grid.
  function refreshDownloadedCards() {
    if (!HIDE_DOWNLOADED || !document.body) return;
    Array.from(document.querySelectorAll('.zsGot')).forEach(el => el.classList.remove('zsGot'));
    Array.from(document.querySelectorAll('a[href]')).forEach(anchor => {
      const target = linkTarget(anchor);
      if (!targetIsHad(target)) return;
      cardForAnchor(anchor).classList.add('zsGot');
    });
    updateEyeButton();
  }

  function hiddenCardCount() {
    try { return document.querySelectorAll('.zsGot').length; } catch { return 0; }
  }

  // One observer for both jobs. Image blocking is per-node and has to happen the
  // instant the node appears, or the request is already away. Card hiding is the
  // opposite: it needs the DOM to have settled, so it is coalesced into one full
  // pass on a short timer, which also collapses a whole parse into a single sweep.
  function installEarlyObserver() {
    const combined = BLOCK_HIDDEN_IMAGE_LOADS ? hideSelectorList().join(',') : '';
    let cardPass = 0;
    const scheduleCardPass = () => {
      if (!HIDE_DOWNLOADED) return;
      clearTimeout(cardPass);
      cardPass = setTimeout(refreshDownloadedCards, 60);
    };

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
    };

    new MutationObserver(records => {
      let sawElement = false;
      records.forEach(record => Array.from(record.addedNodes).forEach(node => {
        if (node.nodeType === 1) sawElement = true;
        sweep(node);
      }));
      // Marking runs regardless of the eye's position: the class is what the eye
      // acts on, so a card added while revealed still hides when you hide again.
      if (sawElement) scheduleCardPass();
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
        <button id="zsEye" class="zs-iconBtn" type="button" title="Reveal what you already have">&#128584;</button>
        <button id="zsCollapse" class="zs-iconBtn" type="button" title="Collapse">&#9652;</button>
      </div>
      <div class="zs-body">
        <div id="zsDrop" class="zs-drop" title="Drop a model, or a set. A set resolves to whoever is in it.">Drop a model or set link here</div>

        <div class="zs-block zs-find">
          <div class="zs-kicker">Find</div>
          <input id="zsSearchQuery" class="zs-searchInput" type="search" placeholder="Search models">
          <button id="zsAdvancedToggle" class="zs-advancedToggle" type="button" aria-expanded="false">Advanced</button>
          <div id="zsAdvanced" class="zs-advanced" hidden>
            <div class="zs-filterGrid">
              <label><span>Years</span><input id="zsSearchYears" type="text" inputmode="numeric" placeholder="2019, 2021-2023"></label>
            </div>
          </div>
          <div class="zs-searchActions">
            <button id="zsSearchRun" type="button">Search</button>
            <button id="zsSearchClear" type="button">Clear</button>
          </div>
        </div>

        <div class="zs-resultsWrap">
          <div id="zsSearchSummary" class="zs-searchSummary">Index the site to search it.</div>
          <div id="zsSearchResults" class="zs-searchResults"></div>
        </div>

        <div class="zs-progress" hidden><div id="zsFill"></div></div>
        <div class="zs-live" aria-live="polite" hidden>
          <div class="zs-line"><span>Model</span><strong id="zsModel">None</strong></div>
          <div class="zs-line"><span>Sets</span><strong id="zsSets">0/0</strong></div>
          <div class="zs-line"><span>Current</span><strong id="zsAlbum">None</strong></div>
          <div class="zs-line"><span>Files</span><strong id="zsFiles">0/0</strong></div>
        </div>
        <button id="zsStop" type="button" hidden>Stop</button>
        <div id="zsLog" class="zs-log" aria-live="polite"></div>

        <div class="zs-foot">
          <div class="zs-footStats">
            <span id="zsStats">No index yet</span>
            <button id="zsIndex" class="zs-footBtn" type="button" title="Walk the site once to learn every model and every set she has">Index site</button>
          </div>
          <div class="zs-footBtns">
            <button id="zsCheck" class="zs-footBtn" type="button" title="Pick the folder your downloads live in and mark everything already in it as downloaded">Check all</button>
            <button id="zsClearIndex" class="zs-footBtn" type="button" title="Forget what the site holds. Your downloads are kept." hidden>Clear index</button>
            <button id="zsClearDownloads" class="zs-footBtn" type="button" title="Forget every download, site-wide. The index is kept." hidden>Clear downloads</button>
          </div>
          <div id="zsFootNote" class="zs-footNote" hidden></div>
        </div>
        <input id="zsCheckDir" type="file" webkitdirectory directory multiple hidden>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.progress = panel.querySelector('.zs-progress');
    ui.live = panel.querySelector('.zs-live');
    ui.fill = panel.querySelector('#zsFill');
    ui.model = panel.querySelector('#zsModel');
    ui.sets = panel.querySelector('#zsSets');
    ui.album = panel.querySelector('#zsAlbum');
    ui.files = panel.querySelector('#zsFiles');
    ui.log = panel.querySelector('#zsLog');
    ui.drop = panel.querySelector('#zsDrop');
    ui.eye = panel.querySelector('#zsEye');
    ui.stop = panel.querySelector('#zsStop');
    ui.searchQuery = panel.querySelector('#zsSearchQuery');
    ui.advancedToggle = panel.querySelector('#zsAdvancedToggle');
    ui.advanced = panel.querySelector('#zsAdvanced');
    ui.searchYears = panel.querySelector('#zsSearchYears');
    ui.searchRun = panel.querySelector('#zsSearchRun');
    ui.searchClear = panel.querySelector('#zsSearchClear');
    ui.searchSummary = panel.querySelector('#zsSearchSummary');
    ui.searchResults = panel.querySelector('#zsSearchResults');
    ui.stats = panel.querySelector('#zsStats');
    ui.index = panel.querySelector('#zsIndex');
    ui.check = panel.querySelector('#zsCheck');
    ui.clearIndex = panel.querySelector('#zsClearIndex');
    ui.clearDownloads = panel.querySelector('#zsClearDownloads');
    ui.footNote = panel.querySelector('#zsFootNote');
    ui.checkDir = panel.querySelector('#zsCheckDir');

    ui.stop.addEventListener('click', requestStop);
    ui.eye.addEventListener('click', () => setHidden(!state.hidden));
    ui.searchResults.addEventListener('click', handleSearchResultAction);
    ui.advancedToggle.addEventListener('click', () => setAdvancedOpen(!state.advancedOpen));
    ui.searchRun.addEventListener('click', () => {
      setAdvancedOpen(false);
      runAdvancedSearch().catch(err => showSearchMessage(`Search failed: ${errorMessage(err)}`));
    });
    ui.searchClear.addEventListener('click', clearAdvancedSearch);
    ui.searchQuery.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      setAdvancedOpen(false);
      runAdvancedSearch().catch(err => showSearchMessage(`Search failed: ${errorMessage(err)}`));
    });
    ui.index.addEventListener('click', () => {
      if (state.indexing) { state.cancel = true; logLine('Stopping the index...'); return; }
      buildIndex().catch(err => logLine(`Indexing failed: ${errorMessage(err)}`));
    });
    ui.check.addEventListener('click', () => { if (!state.checking) ui.checkDir.click(); });
    ui.checkDir.addEventListener('change', () => {
      // Copied out, not referenced: `input.files` is live and the line below
      // empties it. Clearing it is also what lets the same folder be picked
      // twice in a row and still fire a change event the second time.
      const picked = Array.from(ui.checkDir.files || []);
      ui.checkDir.value = '';
      checkDownloadFolder(picked);
    });
    ui.clearIndex.addEventListener('click', clearIndex);
    ui.clearDownloads.addEventListener('click', resetDownloads);
    ui.searchQuery.addEventListener('input', () => {
      setAdvancedOpen(false);
      scheduleAdvancedSearch();
    });
    if (ui.searchYears) ui.searchYears.addEventListener('input', scheduleAdvancedSearch);
    installDropTarget(panel);
    panel.querySelector('#zsCollapse').addEventListener('click', () => {
      panel.classList.toggle('zs-collapsed');
      panel.querySelector('#zsCollapse').innerHTML = panel.classList.contains('zs-collapsed') ? '&#9662;' : '&#9652;';
    });

    // History and index were already read at document-start so the card observer
    // could use them; the view derived from the index is built here.
    setHidden(true);
    installRouteObserver();
    installSoftNavigation();
    buildIndexView();
    renderStats();
    showSearchMessage(searchIdleMessage());
    syncContext();
    // The body existed before the observer did, so anything already parsed has
    // not been judged yet.
    refreshDownloadedCards();
  }

  function setFootNote(text) {
    if (!ui.footNote) return;
    ui.footNote.hidden = !text;
    ui.footNote.textContent = String(text || '');
    ui.footNote.title = ui.footNote.textContent;
  }

  function setAdvancedOpen(open) {
    state.advancedOpen = !!open;
    if (ui.advanced) ui.advanced.hidden = !state.advancedOpen;
    if (ui.advancedToggle) {
      ui.advancedToggle.classList.toggle('zs-advancedOpen', state.advancedOpen);
      ui.advancedToggle.setAttribute('aria-expanded', state.advancedOpen ? 'true' : 'false');
    }
  }

  // --- download history -----------------------------------------------------
  //
  // Keyed by album id. There is one thing to record about an album, and it is
  // that it was taken.
  //
  // A record means files were written. An album that produced nothing is never
  // recorded, which keeps the history from filling with conclusions like "this
  // one has no video" that are really statements about the detector rather than
  // about the album.
  //
  // Older records carry a `k` of file-kind flags — 'a' (all), 'i' (images), 'v'
  // (videos) — from when there was a cycler to take only some of an album. Half
  // an album is not an album you have, so a record that does not add up to the
  // whole one is dropped on the way in and the album reads as new. It is the
  // honest reading, and the cost of it is downloading the half you were missing
  // along with the half you were not.

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
        const flags = String(record.k || '').replace(/[^aiv]/g, '');
        // No flags at all is a record written since they went, and means the
        // whole album. Flags mean an older one, which has to add up.
        if (flags && flags.indexOf('a') < 0 && !(flags.indexOf('i') >= 0 && flags.indexOf('v') >= 0)) return;
        state.history.set(id, { t: Number(record.t) || 0, n: String(record.n || '') });
      });
      // Written back without the old file-kind flags, so a previous version's
      // "images only" / "videos only" cannot sit around and start skipping files.
      saveHistory();
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

  function historyHas(id) {
    return state.history.has(String(id));
  }

  function markDownloaded(id, name) {
    const key = String(id);
    const existing = state.history.get(key);
    state.history.set(key, { t: Date.now(), n: String(name || (existing && existing.n) || '') });
    saveHistory();
    renderStats();
    // The card for what just finished should disappear, and finishing a model's
    // last set should take her directory card with it.
    refreshDownloadedCards();
  }

  // The bulk form, for "Check all". Same rule as markDownloaded, but it saves,
  // re-renders and re-judges the page once at the end instead of a thousand
  // times; and it only ever adds, so an album already recorded is left alone.
  function markManyDownloaded(ids) {
    const now = Date.now();
    let added = 0;
    (ids || []).forEach(id => {
      const key = String(id);
      if (state.history.has(key)) return;
      state.history.set(key, { t: now, n: '' });
      added++;
    });
    if (added) {
      saveHistory();
      renderStats();
      renderStats();
      refreshDownloadedCards();
    }
    return added;
  }


  // --- checking a whole download folder against the site ---------------------
  //
  // Point this at the folder your Zishy downloads live in — the whole `Zishy`
  // folder, model folders and all — and it works out which of the site's albums
  // you already have. That is what makes browsing hide them: history is what
  // "already downloaded" means, and a library saved before this script existed,
  // or on another machine, starts out invisible to it.
  //
  // It only ever *adds*. An album in the history with no matching folder is left
  // alone: the folder you picked may be partial, half-moved or the wrong one, and
  // silently forgetting real downloads on that evidence would be worse than the
  // problem being solved. Clear is what starting over is for.
  //
  // Matching is on the album's URL slug, because the slug is built from the same
  // words the archive name is: `/albums/2719-mirra-jean-really-out-of-jeans` was
  // saved as `241114-Mirra Jean - Really Out of Jeans.zip`. Reduce both to bare
  // lowercase words and the folder name contains the slug outright.

  function bareWords(raw) {
    return String(raw || '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Every path segment in the picked tree, not just the file names: an archive
  // still zipped is a file called `<name>.zip`, and one that has been unpacked is
  // a folder called `<name>` with the photos inside it. Both count as having it.
  function checkCandidatesFromFiles(files) {
    const seen = new Set();
    const out = [];
    Array.from(files || []).forEach(file => {
      const rel = String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/');
      rel.split('/').filter(Boolean).forEach(segment => {
        const text = bareWords(segment.replace(/\.[A-Za-z0-9]{2,5}$/, ''));
        if (!text || seen.has(text)) return;
        seen.add(text);
        out.push({ text, words: text.split(' ').filter(Boolean) });
      });
    });
    return out;
  }

  // Two passes, strict first. Containment is the certain case and claims its
  // album outright; only what is left over is scored word by word, which is what
  // catches a title the 56-character cap truncated on its way to disk. An album
  // already claimed is never handed to a second folder.
  const CHECK_MIN_WORDS = 3;
  const CHECK_MIN_SCORE = 0.8;
  // A folder full of photos is tens of thousands of names, so no name may be
  // compared against every album. Each one is narrowed through the few of its
  // words that are rare enough to narrow anything: a word thousands of albums
  // share is not a clue, it is a scan.
  const CHECK_MAX_POSTINGS = 400;
  const CHECK_PROBE_WORDS = 4;

  // The albums worth comparing this name against, and nothing else.
  function candidateAlbumPool(candidate, byWord) {
    const pool = new Set();
    Array.from(new Set(candidate.words))
      .map(word => byWord.get(word) || [])
      .filter(list => list.length && list.length <= CHECK_MAX_POSTINGS)
      .sort((a, b) => a.length - b.length)
      .slice(0, CHECK_PROBE_WORDS)
      .forEach(list => list.forEach(index => pool.add(index)));
    return pool;
  }

  function matchAlbumsToCandidates(slugs, candidates) {
    const albums = [];
    const byWord = new Map();
    Object.keys(slugs || {}).forEach(id => {
      const words = bareWords(slugs[id]).split(' ').filter(Boolean);
      if (!words.length) return;
      const index = albums.length;
      albums.push({ id, words, text: words.join(' '), taken: false });
      new Set(words).forEach(word => {
        if (!byWord.has(word)) byWord.set(word, []);
        byWord.get(word).push(index);
      });
    });

    const matched = [];
    const leftover = [];
    const claim = album => { album.taken = true; matched.push(album.id); };

    candidates.forEach(candidate => {
      if (candidate.words.length < CHECK_MIN_WORDS) return;
      // The longest containing slug wins, so "…-out-of-jeans-2" is not lost to
      // "…-out-of-jeans" sitting inside the same folder name.
      let best = null;
      candidateAlbumPool(candidate, byWord).forEach(index => {
        const album = albums[index];
        if (album.taken || album.words.length < CHECK_MIN_WORDS) return;
        if (!candidate.text.includes(album.text)) return;
        if (!best || album.text.length > best.text.length) best = album;
      });
      if (best) { claim(best); return; }
      leftover.push(candidate);
    });

    leftover.forEach(candidate => {
      const own = new Set(candidate.words);
      let best = null;
      let bestScore = 0;
      candidateAlbumPool(candidate, byWord).forEach(index => {
        const album = albums[index];
        if (album.taken) return;
        const hits = album.words.filter(word => own.has(word)).length;
        if (hits < CHECK_MIN_WORDS) return;
        const score = hits / album.words.length;
        if (score < CHECK_MIN_SCORE || score <= bestScore) return;
        best = album;
        bestScore = score;
      });
      if (best) claim(best);
    });

    return matched;
  }

  async function checkDownloadFolder(files) {
    if (state.busy || state.indexing) { logLine('Wait for the current run to finish.'); return; }
    const candidates = checkCandidatesFromFiles(files);
    if (!candidates.length) { setFootNote('That folder came through empty — nothing to compare.'); return; }

    if (!haveIndex()) { setFootNote('Index the site before checking a download folder.'); return; }
    const slugs = (state.index && state.index.slugs) || {};
    const total = Object.keys(slugs).length;
    if (!total) {
      setFootNote('This index was built before names were recorded. Press Re-index site, then check again.');
      return;
    }

    state.checking = true;
    setCheckButton(true);
    try {
      logLine(`Check all: ${candidates.length} distinct name${candidates.length === 1 ? '' : 's'} in that folder.`);
      const matched = matchAlbumsToCandidates(slugs, candidates);
      const added = markManyDownloaded(matched);
      const note = matched.length
        ? `Checked ${candidates.length} name${candidates.length === 1 ? '' : 's'}: matched ${matched.length} of `
          + `${total} sets, ${added} newly hidden.`
        : 'Nothing in that folder looked like a Zishy archive. They should be named like '
          + '"241114-Mirra Jean - Really Out of Jeans".';
      logLine(`Check all: ${note}`);
      setFootNote(note);
      scheduleAdvancedSearch();
    } catch (err) {
      logLine(`Check all failed: ${errorMessage(err)}`);
      setFootNote(`Folder check failed: ${errorMessage(err)}`);
    } finally {
      state.checking = false;
      setCheckButton(false);
    }
  }

  function setCheckButton(running) {
    if (!ui.check) return;
    ui.check.disabled = running;
    ui.check.textContent = running ? 'Checking…' : 'Check all';
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
      // The slug is what "Check all" matches folder names against, so an index
      // written before it existed simply has none and is topped up on first use.
      const slugs = {};
      Object.keys(parsed.slugs || {}).forEach(id => {
        const slug = String(parsed.slugs[id] || '');
        if (slug) slugs[id] = slug;
      });
      state.index = {
        t: Number(parsed.t) || 0,
        albums: (parsed.albums || []).map(String),
        models,
        slugs,
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
    if (state.busy || state.checking) { logLine('Wait for the current run to finish.'); return; }
    if (state.indexing) return;

    state.indexing = true;
    state.cancel = false;
    renderFooterButtons();
    const index = { t: Date.now(), albums: [], models: {}, slugs: {}, complete: false };
    try {
      logLine('Indexing the site. This is a long read-only pass; it can be stopped at any time.');

      const albums = new Set();
      await walkListingPages(`${ORIGIN}/albums`, (targets, page) => {
        targets.forEach(target => {
          if (target.kind !== 'album') return;
          albums.add(target.id);
          if (target.slug) index.slugs[target.id] = target.slug;
        });
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
            if (target.slug) index.slugs[target.id] = target.slug;
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
      buildIndexView();
      renderStats();
      showSearchMessage(searchIdleMessage());
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
    index.albums.forEach(id => { if (historyHas(id)) setsDone++; });

    // A model with no sets is left out of the denominator entirely rather than
    // counted as forever incomplete, which would put 100% out of reach.
    const modelIds = Object.keys(index.models).filter(id => (index.models[id].a || []).length);
    let modelsDone = 0;
    let modelsStarted = 0;
    modelIds.forEach(id => {
      const hers = index.models[id].a;
      const done = hers.filter(historyHas).length;
      if (done === hers.length) modelsDone++;
      else if (done) modelsStarted++;
    });
    return { setsDone, setsTotal, modelsDone, modelsStarted, modelsTotal: modelIds.length, complete: index.complete };
  }

  function renderStats() {
    if (ui.stats) {
      const stats = computeCompletion();
      if (!stats) {
        ui.stats.textContent = 'No index yet';
        ui.stats.title = 'Index the site to learn how many sets and models there are.';
      } else {
        const pct = stats.setsTotal ? Math.floor((stats.setsDone / stats.setsTotal) * 100) : 0;
        const models = stats.modelsTotal ? `Models ${stats.modelsDone}/${stats.modelsTotal}` : 'Models not indexed';
        ui.stats.textContent = `Sets ${stats.setsDone}/${stats.setsTotal} (${pct}%) · ${models}`;
        ui.stats.title = [
          `${stats.setsDone} of ${stats.setsTotal} sets downloaded.`,
          `${stats.modelsDone} models complete, ${stats.modelsStarted} partly done, of ${stats.modelsTotal}.`,
          stats.complete ? '' : 'The index is partial — press Re-index site to finish it.'
        ].filter(Boolean).join('\n');
      }
    }
    renderFooterButtons();
  }

  // The two destructive buttons only exist when there is something to destroy.
  function renderFooterButtons() {
    if (ui.index) ui.index.textContent = state.indexing ? 'Stop' : (haveIndex() ? 'Re-index site' : 'Index site');
    if (ui.clearIndex) ui.clearIndex.hidden = !haveIndex();
    if (ui.clearDownloads) ui.clearDownloads.hidden = !state.history.size;
    if (ui.check) ui.check.textContent = state.checking ? 'Checking…' : 'Check all';
  }

  // Forget what the site holds. Downloads survive it — they are a record of what
  // you have rather than of what is out there — but with no denominator the
  // completion figures go, and a model's card can no longer be judged complete
  // until the site is indexed again.
  function clearIndex() {
    if (state.busy || state.checking) { logLine('Wait for the current run to finish.'); return; }
    if (!haveIndex()) { logLine('There is no index to clear.'); return; }
    const sets = state.index.albums.length;
    if (!confirm(`Clear the index of ${sets} set${sets === 1 ? '' : 's'}?\n\n`
      + 'Your downloads are kept. Searching and the completion figures stop working until you index again.')) return;
    state.index = null;
    state.view = null;
    try { localStorage.removeItem(INDEX_KEY); } catch {}
    clearSearchResults(false);
    showSearchMessage(searchIdleMessage());
    renderStats();
    refreshDownloadedCards();
    logLine('Index cleared.');
  }

  // --- the live readout ------------------------------------------------------

  function setModelDisplay(text, title) { setDisplay(ui.model, text, title); }
  function setSetDisplay(text, title) { setDisplay(ui.sets, text, title); }
  function setAlbumDisplay(text, title) { setDisplay(ui.album, text, title); }
  function setFileDisplay(text, title) { setDisplay(ui.files, text, title); }

  function setFileProgress(done, total, failed) {
    const text = `${done}/${total}${failed ? `, ${failed} failed` : ''}`;
    setFileDisplay(text, text);
  }

  function setDisplay(node, text, title) {
    if (!node) return;
    node.textContent = String(text || '');
    node.title = String(title || text || '');
  }

  // Forget every download, for the whole site, in one go. The history is the
  // only record of what you have, so emptying it is the whole reset: nothing
  // counts as had, nothing is hidden, and everything can be downloaded again.
  //
  // Two things deliberately survive it, because neither is a record of what you
  // have downloaded:
  //
  //   - the index, which describes what the site holds. It costs a long crawl
  //     and would be identical if rebuilt, so throwing it away here would be a
  //     tax on changing your mind. Its completion figures simply read zero.
  //   - the queue, which is a list of work rather than a record of it — except
  //     for the rows the history itself stamped. A row that says "already
  //     downloaded" is a statement about a history that has just gone, so those
  //     go back to queued. A row that failed still failed; a row done in this
  //     session was still done.
  // --- the lookup -----------------------------------------------------------
  //
  // The same lookup Playboy Plus has, over what this site's index can actually
  // say. There is no API here and no per-set metadata to speak of: the index is
  // ids, slugs and which sets belong to which model, so search is models and a
  // year list. Everything else about it — the rows, the badges, the wording, the
  // one Download button — is the same on both sites on purpose.

  function haveIndex() {
    return !!(state.index && state.index.albums && state.index.albums.length);
  }

  // Derived once per index change: the arrays the lookup walks, and the
  // set-to-models inversion the rows need. Kept beside the index rather than
  // recomputed per keystroke.
  function buildIndexView() {
    if (!haveIndex()) { state.view = null; return null; }
    const index = state.index;
    const setModels = new Map();
    const models = [];
    Object.keys(index.models || {}).forEach(id => {
      const model = index.models[id];
      const setIds = (model && model.a) || [];
      models.push({ id: String(id), name: String((model && model.n) || `Model ${id}`), setIds });
      setIds.forEach(setId => {
        const key = String(setId);
        if (!setModels.has(key)) setModels.set(key, []);
        setModels.get(key).push(String(model && model.n || ''));
      });
    });
    const sets = (index.albums || []).map(id => ({
      id: String(id),
      slug: albumSlug(id),
      modelNames: (setModels.get(String(id)) || []).filter(Boolean)
    }));
    state.view = { sets, models, setModels };
    return state.view;
  }

  function modelSetIds(modelId) {
    const model = state.index && state.index.models && state.index.models[String(modelId || '')];
    return (model && model.a) ? model.a.map(String) : [];
  }

  function normalizeSearchModel(model) {
    return {
      id: String(model.id),
      title: model.name,
      url: `${ORIGIN}/albums?tag_id=${encodeURIComponent(model.id)}`,
      slug: '',
      setCount: (model.setIds || []).length,
      modelNames: [model.name],
      text: model.name
    };
  }

  function normalizeSearchSet(set) {
    const title = titleFromSlug(set.slug) || `Set ${set.id}`;
    return {
      id: String(set.id),
      title,
      url: `${ORIGIN}/albums/${encodeURIComponent(set.id)}${set.slug ? `-${set.slug}` : ''}`,
      slug: set.slug || '',
      setCount: 1,
      modelNames: set.modelNames || [],
      text: `${title} ${(set.modelNames || []).join(' ')}`
    };
  }

  // How much of this item you have. One shape for models and sets alike, so the
  // row, the badge and the Have filter all read the same three fields.
  function stampFocusedItem(kind, item) {
    if (kind === 'model') {
      const sets = modelSetIds(item.id);
      item.setCount = sets.length || item.setCount || 0;
      item.haveCount = sets.filter(historyHas).length;
      item.have = (item.setCount && item.haveCount === item.setCount) ? 'yes' : (item.haveCount ? 'part' : 'no');
    } else {
      item.setCount = 1;
      item.haveCount = historyHas(item.id) ? 1 : 0;
      item.have = item.haveCount ? 'yes' : 'no';
    }
    item.hidden = item.have === 'yes';
    return item;
  }

  function readSearchFilters() {
    const years = parseYearList(ui.searchYears && ui.searchYears.value);
    return {
      query: String(ui.searchQuery && ui.searchQuery.value || '').trim(),
      years: years.ranges,
      yearError: years.error
    };
  }

  function searchHasInput(filters) {
    return !!(filters.query || (filters.years && filters.years.length) || filters.yearError);
  }

  function parseYearList(raw) {
    const text = String(raw || '').trim();
    if (!text) return { ranges: [], error: '' };
    const ranges = [];
    const parts = text.split(/[,;]+/).map(part => part.trim()).filter(Boolean);
    for (const part of parts) {
      let match = part.match(/^(\d{4})$/);
      if (match) {
        const year = Number(match[1]);
        if (year < 1900 || year > 2200) return { ranges: [], error: `Year not understood: ${part}` };
        ranges.push({ start: year, end: year });
        continue;
      }
      match = part.match(/^(\d{4})\s*[-–—to]+\s*(\d{4})$/i);
      if (match) {
        let start = Number(match[1]);
        let end = Number(match[2]);
        if (start > end) { const swap = start; start = end; end = swap; }
        if (start < 1900 || end > 2200) return { ranges: [], error: `Year not understood: ${part}` };
        ranges.push({ start, end });
        continue;
      }
      return { ranges: [], error: `Year not understood: ${part}` };
    }
    return { ranges, error: '' };
  }

  function itemMatchesYears(item, ranges) {
    if (!ranges || !ranges.length) return true;
    const startText = String(item && (item.dateStart || item.date) || '').slice(0, 4);
    const endText = String(item && (item.dateEnd || item.date) || startText).slice(0, 4);
    if (!/^\d{4}$/.test(startText) && !/^\d{4}$/.test(endText)) return true;
    const from = Number(startText || endText);
    const to = Number(endText || startText);
    return ranges.some(range => to >= range.start && from <= range.end);
  }

  function searchItemMatches(item, queryWords, filters) {
    if (queryWords.length && !queryWords.every(word => bareWords(item.text).includes(word))) return false;
    if (!itemMatchesYears(item, filters.years)) return false;
    return true;
  }

  function searchScore(item, queryWords) {
    if (!queryWords.length) return 0;
    const title = bareWords(item.title);
    const text = bareWords(item.text);
    let score = 0;
    queryWords.forEach(word => {
      if (title === word) score += 120;
      else if (title.startsWith(`${word} `)) score += 80;
      else if (title.includes(` ${word} `) || title.endsWith(` ${word}`)) score += 55;
      else if (text.includes(word)) score += 25;
    });
    return score;
  }

  function searchIndex(filters) {
    const queryWords = bareWords(filters.query).split(' ').filter(Boolean);
    const results = [];
    const view = state.view || buildIndexView();
    if (!view) return results;

    view.models.forEach(model => {
      const item = normalizeSearchModel(model);
      stampFocusedItem('model', item);
      if (!searchItemMatches(item, queryWords, filters)) return;
      results.push({ kind: 'model', score: searchScore(item, queryWords), item });
    });

    return results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.item.title || '').localeCompare(String(b.item.title || ''));
    });
  }

  let searchTimer = 0;
  function scheduleAdvancedSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      runAdvancedSearch().catch(err => showSearchMessage(`Search failed: ${errorMessage(err)}`));
    }, 180);
  }

  async function runAdvancedSearch() {
    const filters = readSearchFilters();
    if (filters.yearError) {
      showSearchMessage(filters.yearError);
      clearSearchResults(false);
      return;
    }
    if (!searchHasInput(filters)) {
      showSearchMessage(searchIdleMessage());
      clearSearchResults(false);
      return;
    }
    if (!haveIndex()) {
      showSearchMessage('No index yet. Press Index site.');
      clearSearchResults(false);
      return;
    }
    state.focusedFromPage = false;
    renderSearchResults(searchIndex(filters));
  }

  function clearAdvancedSearch() {
    if (ui.searchQuery) ui.searchQuery.value = '';
    if (ui.searchYears) ui.searchYears.value = '';
    setAdvancedOpen(false);
    showSearchMessage(searchIdleMessage());
    clearSearchResults(false);
  }

  function searchIdleMessage() {
    return haveIndex() ? 'Search for a model, or drop a link.' : 'Index the site to search it.';
  }

  function clearSearchResults(resetSummary) {
    if (ui.searchResults) ui.searchResults.textContent = '';
    if (resetSummary !== false) showSearchMessage('');
  }

  function showSearchMessage(text) {
    if (!ui.searchSummary) return;
    ui.searchSummary.textContent = String(text || '');
    ui.searchSummary.title = ui.searchSummary.textContent;
  }

  // --- a dropped link, and the page you are on -------------------------------

  function fallbackSearchModel(target) {
    const name = target.name || `Model ${target.id}`;
    return {
      id: String(target.id || ''),
      title: name,
      url: `${ORIGIN}/albums?tag_id=${encodeURIComponent(target.id)}`,
      slug: '',
      setCount: 0,
      modelNames: [name],
      text: name
    };
  }

  function fallbackSearchSet(target) {
    const title = target.name || titleFromSlug(target.slug) || `Set ${target.id}`;
    return {
      id: String(target.id || ''),
      title,
      url: `${ORIGIN}/albums/${encodeURIComponent(target.id)}${target.slug ? `-${target.slug}` : ''}`,
      slug: String(target.slug || ''),
      setCount: 1,
      modelNames: [],
      text: title
    };
  }

  function focusedModelResult(target, score) {
    const known = (state.view || buildIndexView() || { models: [] }).models
      .find(model => model.id === String(target.id));
    const item = known ? normalizeSearchModel(known) : fallbackSearchModel(target);
    if (!known && target.name) item.title = target.name;
    stampFocusedItem('model', item);
    return { kind: 'model', score: score || 999, item };
  }

  function focusedSetResult(target, score) {
    const view = state.view || buildIndexView();
    const known = view && view.sets.find(set => set.id === String(target.id));
    const item = known ? normalizeSearchSet(known) : fallbackSearchSet(target);
    stampFocusedItem('set', item);
    return { kind: 'set', score: score || 999, item };
  }

  function modelSetsForFocusedDrop(modelId, seen) {
    const view = state.view || buildIndexView();
    if (!view) return [];
    return modelSetIds(modelId).map(setId => {
      const key = `set:${setId}`;
      if (seen.has(key)) return null;
      const set = view.sets.find(entry => entry.id === String(setId));
      if (!set) return null;
      seen.add(key);
      const item = normalizeSearchSet(set);
      stampFocusedItem('set', item);
      return { kind: 'set', score: 500, item };
    }).filter(Boolean);
  }

  async function modelsForDroppedSet(target) {
    const view = state.view || buildIndexView();
    if (view) {
      const names = view.setModels.get(String(target.id));
      if (names && names.length) {
        const owners = view.models.filter(model => (model.setIds || []).some(id => String(id) === String(target.id)));
        if (owners.length) return owners.map(model => ({ kind: 'model', id: model.id, name: model.name }));
      }
    }
    try {
      return await resolveAlbumToModels(target);
    } catch {
      return [];
    }
  }

  // A dropped link is meant to end in the same place a search does: the thing
  // itself at the top, and — since taking a model's whole library is what this
  // is for — everything of hers underneath it, ready to take in one press.
  async function focusAdvancedDropTargets(targets) {
    const incoming = (targets || []).filter(Boolean);
    if (!incoming.length || !ui.searchResults) return;
    clearTimeout(searchTimer);
    if (ui.searchQuery) ui.searchQuery.value = '';
    setAdvancedOpen(false);

    const results = [];
    const seen = new Set();
    const pushModel = modelTarget => {
      const modelKey = `model:${modelTarget.id}`;
      if (!modelTarget || !modelTarget.id || seen.has(modelKey)) return;
      seen.add(modelKey);
      results.push(focusedModelResult(modelTarget, 999));
    };

    for (const target of incoming) {
      if (target.kind === 'model') { pushModel(target); continue; }
      const owners = await modelsForDroppedSet(target);
      owners.forEach(pushModel);
    }

    renderFocusedSearchResults(results);
  }

  // --- results ---------------------------------------------------------------

  const MAX_RESULTS_RENDERED = 500;

  function renderSearchResults(results) {
    const showing = results.slice(0, MAX_RESULTS_RENDERED);
    const clipped = results.length > showing.length;
    showSearchMessage(results.length
      ? `${results.length} model${results.length === 1 ? '' : 's'}`
        + `${clipped ? `; showing the first ${showing.length}` : ''}.`
      : 'Nothing matched.');
    paintResults(showing);
  }

  function renderFocusedSearchResults(results) {
    showSearchMessage(results.length
      ? `${results.length} model${results.length === 1 ? '' : 's'} from that link.`
      : 'That link is not a model, and no model could be read from it.');
    paintResults(results.slice(0, MAX_RESULTS_RENDERED));
  }

  function paintResults(results) {
    if (!ui.searchResults) return;
    ui.searchResults.textContent = '';
    if (!results.length) return;
    const fragment = document.createDocumentFragment();
    results.forEach(result => fragment.appendChild(searchResultNode(result)));
    ui.searchResults.appendChild(fragment);
  }

  function searchResultNode(result) {
    const item = result.item;
    const row = document.createElement('div');
    row.className = 'zs-result';
    // "Have it" dims the row rather than removing it: this is where you come to
    // find something again, including something you already took.
    row.classList.toggle('zs-resultHidden', !!item.hidden);
    row.dataset.kind = result.kind;
    row.dataset.id = item.id;
    row.dataset.title = item.title || '';
    row.dataset.slug = item.slug || '';

    const kind = document.createElement('div');
    kind.className = 'zs-resultKind';
    kind.textContent = result.kind;

    const main = document.createElement('div');
    main.className = 'zs-resultMain';
    const top = document.createElement('div');
    top.className = 'zs-resultTop';
    const title = document.createElement(item.url ? 'a' : 'div');
    title.className = 'zs-resultTitle';
    title.textContent = item.title || `${result.kind} ${item.id}`;
    title.title = title.textContent;
    if (item.url) {
      title.href = item.url;
      title.target = '_blank';
      title.rel = 'noopener';
    }
    const badges = document.createElement('div');
    badges.className = 'zs-resultBadges';
    badges.appendChild(resultBadge(haveLabel(result.kind, item),
      item.have === 'yes' ? 'zs-badgeFull' : item.have === 'part' ? 'zs-badgePart' : ''));

    const meta = document.createElement('div');
    meta.className = 'zs-resultMeta';
    meta.textContent = result.kind === 'model'
      ? `${item.setCount} set${item.setCount === 1 ? '' : 's'}`
      : (item.modelNames.join(', ') || 'No model tagged');
    meta.title = meta.textContent;

    const actions = document.createElement('div');
    actions.className = 'zs-resultActions';
    actions.appendChild(resultActionButton('Download', 'download'));

    top.appendChild(title);
    top.appendChild(badges);
    main.appendChild(top);
    main.appendChild(meta);
    main.appendChild(actions);
    row.appendChild(kind);
    row.appendChild(main);
    return row;
  }

  // What you have of this, said the way the thing itself is counted. A model is
  // a library you are working through, so hers is a fraction; a set is one thing
  // you either have or do not.
  function haveLabel(kind, item) {
    if (kind !== 'model') return item.have === 'yes' ? 'Downloaded' : 'Not downloaded';
    if (!item.setCount) return 'No sets known';
    if (item.have === 'yes') return `All ${item.setCount} set${item.setCount === 1 ? '' : 's'}`;
    return `${item.haveCount} of ${item.setCount} sets`;
  }

  function resultBadge(text, extraClass) {
    const badge = document.createElement('span');
    badge.className = `zs-badge${extraClass ? ` ${extraClass}` : ''}`;
    badge.textContent = text;
    return badge;
  }

  function resultActionButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    return button;
  }

  function handleSearchResultAction(event) {
    const button = event.target && event.target.closest && event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('.zs-result');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.action !== 'download') return;
    const id = row.dataset.id;
    const title = row.dataset.title;
    const slug = row.dataset.slug;
    if (row.dataset.kind === 'model') downloadModel({ kind: 'model', id, name: title });
    else downloadSet({ kind: 'album', id, slug, name: title });
  }

  function resetDownloads() {
    const size = state.history.size;
    if (!size) { logLine('Nothing downloaded is on record; there is nothing to reset.'); return; }
    if (state.busy) { logLine('Stop the current run before resetting.'); return; }
    // Irreversible and easy to hit by accident next to the queue controls, so it
    // asks — and says how much it is about to forget.
    if (!confirm(`Forget ${size} downloaded album${size === 1 ? '' : 's'}?\n\n`
      + 'Every album and model on the site comes back into view and can be downloaded again. '
      + 'The site index is kept. This cannot be undone.')) return;

    state.history = new Map();
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    renderStats();
    // Whatever is on screen was labelled against a history that has just gone.
    scheduleAdvancedSearch();
    // Everything the site was hiding comes back, since nothing counts as had.
    refreshDownloadedCards();
    logLine(`Reset: ${size} album${size === 1 ? '' : 's'} forgotten`
      + (rearmed ? `, ${rearmed} queued row${rearmed === 1 ? '' : 's'} put back` : '') + '.');
  }

  function addStyle(css) {
    try {
      if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
    } catch {}
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // The panel is the same panel as Playboy Plus's, in this site's accent: one
  // dark sheet, one lilac, used at fixed strengths. Anything changed here should
  // be changed there, or the two stop reading as one tool.
  function injectStyle() {
    addStyle(`
      #zishyStripperPanel{position:fixed;right:16px;top:16px;z-index:2147483646;width:360px;max-height:92vh;
        display:flex;flex-direction:column;border:1px solid rgba(217,205,239,.4);border-radius:10px;
        background:#17161c;color:#efeaf7;box-shadow:0 18px 60px rgba(0,0,0,.55);font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #zishyStripperPanel [hidden]{display:none!important}
      #zishyStripperPanel.zs-collapsed{height:auto;max-height:none}
      #zishyStripperPanel.zs-collapsed .zs-body{display:none}
      #zishyStripperPanel .zs-head{height:38px;display:flex;align-items:center;gap:6px;padding:0 10px;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#2b2338,#1a1720);cursor:default}
      #zishyStripperPanel .zs-title{font-weight:900;color:#d9cdef;flex:1 1 auto;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #zishyStripperPanel .zs-iconBtn{flex:0 0 auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px;font-size:13px}
      #zishyStripperPanel .zs-body{flex:1 1 auto;display:flex;flex-direction:column;gap:12px;padding:10px;min-height:0;overflow:hidden}
      #zishyStripperPanel button{appearance:none;width:100%;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#efeaf7;font:700 12px/1 Arial,sans-serif;cursor:pointer}
      #zishyStripperPanel button:hover:not(:disabled){background:rgba(217,205,239,.2);border-color:rgba(217,205,239,.55)}
      #zishyStripperPanel button:disabled{opacity:.42;cursor:default}
      #zishyStripperPanel input,#zishyStripperPanel select{box-sizing:border-box;width:100%;min-width:0;height:30px;
        border:1px solid rgba(255,255,255,.14);border-radius:7px;background:#211d29;color:#efeaf7;
        font:700 12px/1 Arial,sans-serif;padding:0 8px;outline:none}
      #zishyStripperPanel input:focus,#zishyStripperPanel select:focus{border-color:rgba(217,205,239,.7);box-shadow:0 0 0 2px rgba(217,205,239,.14)}
      #zishyStripperPanel input::placeholder{color:#867a9b}
      #zishyStripperPanel input[type=number]{-moz-appearance:textfield}
      #zishyStripperPanel input[type=number]::-webkit-inner-spin-button,
      #zishyStripperPanel input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}

      #zishyStripperPanel .zs-drop{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-height:52px;padding:8px 10px;
        border:1px dashed rgba(217,205,239,.45);border-radius:8px;background:rgba(217,205,239,.06);
        color:#a99cc4;font-weight:700;text-align:center}
      #zishyStripperPanel.zs-dragging .zs-drop{border-color:#d9cdef;border-style:solid;
        background:rgba(217,205,239,.22);color:#fff}

      #zishyStripperPanel .zs-block{flex:0 0 auto;display:flex;flex-direction:column;gap:8px}
      #zishyStripperPanel .zs-kicker{color:#7e7392;font-weight:900;letter-spacing:.12em;text-transform:uppercase;font-size:10px}
      #zishyStripperPanel .zs-searchInput{flex:0 0 auto;height:38px;min-height:38px;font-size:13px;padding:0 12px;border-radius:9px}
      #zishyStripperPanel .zs-advancedToggle{width:auto;align-self:flex-start;min-height:28px;padding:0 10px;border-radius:7px;
        background:transparent;color:#c6bbdd;font:900 10px/1 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase}
      #zishyStripperPanel .zs-advancedToggle::after{content:' \\25B8'}
      #zishyStripperPanel .zs-advancedToggle.zs-advancedOpen::after{content:' \\25BE'}
      #zishyStripperPanel .zs-advanced{display:flex;flex-direction:column;gap:8px}
      #zishyStripperPanel .zs-filterGrid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
      #zishyStripperPanel .zs-filterGrid label{display:flex;flex-direction:column;gap:4px;min-width:0}
      #zishyStripperPanel .zs-filterGrid label span{color:#7e7392;font-weight:900;letter-spacing:.06em;text-transform:uppercase;font-size:10px}
      #zishyStripperPanel .zs-searchActions{display:grid;grid-template-columns:1.4fr .8fr;gap:8px}
      #zishyStripperPanel #zsSearchRun{background:#d9cdef;color:#1a1720;border-color:#e6dcff;font-weight:900}
      #zishyStripperPanel #zsSearchRun:hover:not(:disabled){background:#e6dcff;border-color:#d9cdef}
      #zishyStripperPanel #zsSearchClear{background:transparent}

      #zishyStripperPanel .zs-resultsWrap{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:80px;padding:12px;
        border:1px solid rgba(217,205,239,.14);border-radius:10px;background:rgba(0,0,0,.22);overflow:hidden}
      #zishyStripperPanel .zs-searchSummary{flex:0 0 auto;min-height:18px;color:#b3a8c8;font-weight:700;line-height:1.4}
      #zishyStripperPanel .zs-searchResults{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding-right:2px}
      #zishyStripperPanel .zs-searchResults:empty{display:none}
      #zishyStripperPanel .zs-result{flex:0 0 auto;display:grid;grid-template-columns:28px minmax(0,1fr);gap:0;overflow:hidden;
        border:1px solid rgba(217,205,239,.16);border-radius:10px;background:rgba(255,255,255,.035)}
      #zishyStripperPanel .zs-resultHidden{opacity:.62}
      #zishyStripperPanel .zs-resultKind{display:flex;align-items:center;justify-content:center;align-self:stretch;
        writing-mode:vertical-rl;transform:rotate(180deg);padding:10px 0;
        background:rgba(217,205,239,.13);color:#d9cdef;font-weight:900;letter-spacing:.16em;text-transform:uppercase;font-size:9px}
      #zishyStripperPanel .zs-result[data-kind="set"] .zs-resultKind{background:rgba(255,255,255,.06);color:#c6bbdd}
      #zishyStripperPanel .zs-resultMain{min-width:0;display:flex;flex-direction:column;gap:5px;padding:10px 12px 12px}
      #zishyStripperPanel .zs-resultTop{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}
      #zishyStripperPanel .zs-resultTitle{color:#efeaf7;font-weight:900;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #zishyStripperPanel .zs-resultMeta{color:#a396ba;font-weight:700;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #zishyStripperPanel .zs-resultBadges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px}
      #zishyStripperPanel .zs-badge{display:inline-flex;align-items:center;min-height:18px;padding:0 7px;border-radius:999px;
        background:rgba(255,255,255,.08);color:#c6bbdd;font-weight:900;font-size:9px;letter-spacing:.04em;text-transform:uppercase}
      #zishyStripperPanel .zs-badgeFull{background:rgba(88,143,101,.24);color:#d7ffd8}
      #zishyStripperPanel .zs-badgePart{background:rgba(217,205,239,.2);color:#efe4ff}
      #zishyStripperPanel .zs-resultActions{display:flex;gap:6px;margin-top:4px;
        padding-top:8px;border-top:1px solid rgba(217,205,239,.12)}
      #zishyStripperPanel .zs-resultActions button{flex:1 1 auto;min-height:26px;padding:0 6px;border-radius:7px;font-size:10px}
      #zishyStripperPanel .zs-result a{color:#d9cdef;text-decoration:none}
      #zishyStripperPanel .zs-result a:hover{text-decoration:underline}

      #zishyStripperPanel .zs-progress{display:block;box-sizing:border-box;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      #zishyStripperPanel #zsFill{display:block;height:10px;min-height:10px;width:0;
        background:linear-gradient(90deg,#8c7bb4,#d9cdef);transition:width 120ms ease}
      #zishyStripperPanel .zs-live{flex:0 0 auto;display:flex;flex-direction:column;gap:5px}
      #zishyStripperPanel .zs-line{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;align-items:baseline}
      #zishyStripperPanel .zs-line span{color:#7e7392;font-weight:900;text-transform:uppercase;font-size:10px}
      #zishyStripperPanel .zs-line strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e7e0f3;font-size:12px}
      #zishyStripperPanel #zsStop{flex:0 0 auto;background:#3a2a4a;color:#efe4ff;border-color:rgba(217,205,239,.6)}
      #zishyStripperPanel .zs-log{flex:0 0 auto;max-height:72px;overflow:auto;color:#a396ba;font:700 11px/1.35 Arial,sans-serif;
        white-space:pre-wrap;word-break:break-word}
      #zishyStripperPanel .zs-log:empty{display:none}

      #zishyStripperPanel .zs-foot{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding-top:10px;
        border-top:1px solid rgba(217,205,239,.16)}
      #zishyStripperPanel .zs-footStats{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
      #zishyStripperPanel .zs-footStats span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#b3a8c8;font-weight:700;font-size:11px}
      #zishyStripperPanel .zs-footBtns{display:flex;flex-wrap:wrap;gap:6px}
      #zishyStripperPanel .zs-footBtn{width:auto;flex:1 1 auto;min-height:28px;border-radius:7px;font-size:11px}
      #zishyStripperPanel .zs-footStats .zs-footBtn{flex:0 0 auto}
      #zishyStripperPanel .zs-footNote{color:#b3a8c8;font-weight:700;font-size:11px;line-height:1.35}

      @media (max-width:700px){
        #zishyStripperPanel{width:calc(100vw - 16px);right:8px;left:auto}
        #zishyStripperPanel .zs-searchActions{grid-template-columns:1fr}
      }
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

  // --- browsing during a run ------------------------------------------------
  //
  // A run lives in this page's JavaScript, so an ordinary navigation ends it:
  // the document is torn down mid-album, the fetches in flight are dropped, and
  // what comes back is a saved list with the set that was downloading returned
  // to the queue. That made browsing and downloading mutually exclusive.
  //
  // So while a run is going, a link is followed by fetching the next page and
  // swapping its contents in, rather than letting the browser load it. The
  // address bar, the back button and the history all behave normally, but the
  // document is never replaced — so the script, the queue and every download in
  // flight simply carry on. The downloader never read the visible page in the
  // first place (it refetches each album itself), so what is on screen and what
  // is being saved are independent, and swapping one cannot disturb the other.
  //
  // This is confined to a run on purpose. Idle browsing is left completely
  // alone — a normal load runs the site's own scripts, and there is nothing to
  // protect when nothing is in flight.
  let softNavUsed = false;
  let softNavToken = 0;

  function installSoftNavigation() {
    // Capture, so the site's own handlers cannot swallow the click first.
    document.addEventListener('click', event => {
      if (!state.busy) return;
      if (event.defaultPrevented) return;
      // Anything but a plain left click is the user asking for something else —
      // a new tab, a download, a context menu — and is left to the browser.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor || !softNavigableAnchor(anchor)) return;
      event.preventDefault();
      softNavigate(anchor.href, true);
    }, true);

    // The search box and any other GET form: same idea, with the fields folded
    // into the query string the way the browser would have done it.
    document.addEventListener('submit', event => {
      if (!state.busy || event.defaultPrevented) return;
      const form = event.target;
      if (!form || form.tagName !== 'FORM') return;
      if (String(form.method || 'get').toLowerCase() !== 'get') return;
      let url = '';
      try {
        url = new URL(form.getAttribute('action') || location.href, location.href);
        if (url.origin !== location.origin) return;
        new FormData(form).forEach((value, key) => {
          if (typeof value === 'string') url.searchParams.set(key, value);
        });
      } catch { return; }
      event.preventDefault();
      softNavigate(url.href, true);
    }, true);

    // Back and forward. Once anything has been swapped in, the document no
    // longer matches what a plain history move assumes, so every move is served
    // the same way rather than leaving the previous page's contents on screen.
    window.addEventListener('popstate', () => {
      if (!softNavUsed) return;
      softNavigate(location.href, false);
    });

    // Some exits cannot be intercepted — a reload, a typed address, a link off
    // the site. A run cannot survive one, so say so before it happens rather
    // than losing it to a stray keystroke.
    window.addEventListener('beforeunload', event => {
      if (!state.busy) return;
      event.preventDefault();
      event.returnValue = '';
      return '';
    });
  }

  function softNavigableAnchor(anchor) {
    if (anchor.hasAttribute('download')) return false;
    const target = String(anchor.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self') return false;
    let url = null;
    try { url = new URL(anchor.href, location.href); } catch { return false; }
    if (url.origin !== location.origin) return false;
    if (!/^https?:$/.test(url.protocol)) return false;
    // A bare fragment is a scroll, not a page; let the browser do it.
    if (url.hash && url.href.replace(/#.*$/, '') === location.href.replace(/#.*$/, '')) return false;
    return true;
  }

  async function softNavigate(url, push) {
    const token = ++softNavToken;
    let html = '';
    try {
      // httpText rather than fetchTextWithRetry: the retry wrapper aborts on
      // state.cancel, which belongs to the download run. Pressing Stop should
      // not cancel the page you are reading, and vice versa.
      html = await httpText(url);
    } catch (err) {
      // Whatever went wrong, the browser can still be trusted to load a page.
      // Losing the run is the lesser evil against stranding the user.
      logLine(`Could not swap in ${url} (${errorMessage(err)}); loading it normally.`);
      location.assign(url);
      return;
    }
    // A second click while the first was in the air wins; this one is stale.
    if (token !== softNavToken) return;
    try {
      swapDocument(parseDoc(html), url, push);
    } catch (err) {
      logLine(`Could not swap in ${url} (${errorMessage(err)}); loading it normally.`);
      location.assign(url);
    }
  }

  function swapDocument(doc, url, push) {
    const panel = document.getElementById('zishyStripperPanel');
    const body = doc.body;
    if (!body) throw new Error('no body in the fetched page');

    // The site's own scripts are dropped rather than re-run. They were written to
    // execute once against a fresh document; running a second copy against this
    // one risks double-bound handlers and half-initialised widgets, and none of
    // it is needed to read a listing or to queue from it. Plain links still work,
    // because plain links are what this site is made of.
    Array.from(body.querySelectorAll('script')).forEach(node => node.remove());

    if (push) history.pushState({ zsSoft: true }, '', url);
    softNavUsed = true;

    // Body attributes carry per-page classes the stylesheet keys off.
    Array.from(document.body.attributes).forEach(attr => {
      if (attr.name !== 'style') document.body.removeAttribute(attr.name);
    });
    Array.from(body.attributes).forEach(attr => {
      try { document.body.setAttribute(attr.name, attr.value); } catch {}
    });

    Array.from(document.body.childNodes).forEach(node => {
      if (node !== panel) node.remove();
    });
    // Adopted rather than imported so the incoming nodes belong to this document
    // before they are connected, and the early observer sees them exactly as it
    // sees anything the site itself adds: it is watching documentElement's whole
    // subtree, so hidden images are stripped and downloaded cards marked without
    // any of that having to be repeated here.
    Array.from(body.childNodes).forEach(node => {
      document.body.insertBefore(document.adoptNode(node), panel || null);
    });
    if (panel && panel.parentNode !== document.body) document.body.appendChild(panel);

    try { document.title = doc.title || document.title; } catch {}
    window.scrollTo(0, 0);
    setProgress(0);
    syncContext();
    refreshDownloadedCards();
  }

  // --- context --------------------------------------------------------------

  // Albums live at /albums/<id>-<slug>. The bare /albums path, and /albums?tag_id=
  // or ?q= or ?page=, are listings — they carry no id of their own.
  function albumRefFromPath(path) {
    const match = decodeURIComponent(String(path || '')).match(/^\/albums\/(\d+)(?:-([^/?#]*))?\/?$/i);
    if (!match) return null;
    return { id: match[1], slug: String(match[2] || ''), name: '' };
  }

  // What "+ This" acts on: the album you are reading, or — on a model's tag page —
  // the model herself.
  function targetFromLocation() {
    return targetFromUrl(location.href, ORIGIN);
  }

  // The page you are standing on is the commonest thing you want, so it is put
  // in the results by itself — the same rows a search or a drop would produce,
  // with the same button under them. There is nothing else to press to get it.
  //
  // It gives way to anything you did yourself: a typed search or a dropped link
  // is a deliberate act, and having it replaced by whatever page happened to
  // load underneath would be the panel arguing with you.
  function syncContext() {
    const target = targetFromLocation();
    if (ui.drop) {
      ui.drop.textContent = target ? 'Drop another model or set link here' : 'Drop a model or set link here';
    }
    setModelDisplay('None');
    setSetDisplay('0/0');
    setAlbumDisplay('None');
    setFileDisplay('0/0');
    if (state.busy || !ui.searchResults) return;
    if (String(ui.searchQuery && ui.searchQuery.value || '').trim()) return;
    if (!target) {
      if (!state.focusedFromPage) return;
      state.focusedFromPage = false;
      clearSearchResults(false);
      showSearchMessage(searchIdleMessage());
      return;
    }
    if (ui.searchResults.children.length && !state.focusedFromPage) return;
    state.focusedFromPage = true;
    focusAdvancedDropTargets([target]).catch(() => {});
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
      if (!targets.length) { showSearchMessage('Nothing set- or model-shaped in that drop.'); return; }
      // A drop lands in the results list, exactly where a search lands. Whether
      // you found the thing by name or by dragging it in, what you get is the
      // same row with the same button under it.
      state.focusedFromPage = false;
      setAdvancedOpen(false);
      focusAdvancedDropTargets(targets).catch(err => showSearchMessage(`Could not show that link: ${errorMessage(err)}`));
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

  // Every set of hers. The index knows, if there is one; otherwise her tag page
  // is walked, which is what makes a dropped model link work on a fresh install
  // with nothing indexed yet.
  async function albumsForModel(model) {
    const entry = Object.assign({}, model);
    const known = state.index && state.index.models[String(entry.id)];
    if (known && known.a && known.a.length) {
      if (!entry.name) entry.name = known.n || '';
      const albums = known.a.map(id => ({ kind: 'album', id: String(id), slug: albumSlug(id), name: '' }));
      return { model: entry, albums };
    }

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
    if (!entry.name) entry.name = modelNameFromAlbumTargets(albums) || `Model ${entry.id}`;
    return { model: entry, albums };
  }

  function albumSlug(id) {
    return String((state.index && state.index.slugs && state.index.slugs[String(id)]) || '');
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

  // Taking a model's whole library is what this is for, so it is the download
  // that has a shape: read every set of hers, then walk them. A single set is
  // the same walk with one thing in it.
  async function downloadModel(model) {
    if (state.busy) { logLine('Wait for the current run to finish, or press Stop.'); return; }
    const label = model.name || `Model ${model.id}`;
    state.cancel = false;
    setBusy(true);
    resetLog();
    setModelDisplay(label, `${label} (${model.id})`);
    setSetDisplay('Reading model');
    setAlbumDisplay('None');
    setFileDisplay('0/0');

    try {
      logLine(`Reading ${label}.`);
      const found = await albumsForModel(model);
      const name = found.model.name || label;
      setModelDisplay(name, `${name} (${found.model.id})`);
      if (!found.albums.length) { logLine('No sets found for this model.'); return; }

      let saved = 0;
      let failed = 0;
      // A set you already have is not a set that went wrong: it is one of hers
      // that is accounted for, and it counts towards her being finished.
      let already = 0;
      logLine(`${name}: ${found.albums.length} set${found.albums.length === 1 ? '' : 's'}.`);
      for (let i = 0; i < found.albums.length; i++) {
        if (state.cancel) throw new Error('cancelled');
        const ref = found.albums[i];
        const progress = () => setSetDisplay(`${saved}/${found.albums.length} done`
          + `${already ? `, ${already} already had` : ''}${failed ? `, ${failed} failed` : ''}`);
        progress();
        // Asked here as well as inside processAlbum, so a set you already have
        // costs nothing at all — not even the page fetch the guard downstream
        // would need to make.
        if (historyHas(ref.id)) { already++; progress(); continue; }
        setAlbumDisplay(ref.name || `Set ${ref.id}`, `Set ${ref.id}`);
        setFileDisplay('Scanning');
        logLine(`--- ${i + 1}/${found.albums.length}: ${ref.name || `Set ${ref.id}`} ---`);
        try {
          await processAlbum(ref);
          saved++;
        } catch (err) {
          const message = errorMessage(err);
          if (message === 'cancelled') throw err;
          if (err && err.had) already++;
          else { failed++; logLine(`Set ${ref.id} failed: ${message}`); }
        }
        progress();
        if (i + 1 < found.albums.length) await delay(ALBUM_DELAY_MS);
      }
      logLine(`Finished ${name}: ${saved} saved, ${already} already had, ${failed} failed.`);
    } catch (err) {
      setProgress(0);
      logLine(errorMessage(err) === 'cancelled' ? 'Cancelled.' : `Model failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function downloadSet(ref) {
    if (state.busy) { logLine('Wait for the current run to finish, or press Stop.'); return; }
    state.cancel = false;
    setBusy(true);
    resetLog();
    setModelDisplay('None');
    setSetDisplay('1 set');
    try {
      await processAlbum(ref);
    } catch (err) {
      setProgress(0);
      const message = errorMessage(err);
      if (message === 'cancelled') logLine('Cancelled.');
      else if (err && err.had) logLine('You already have this set.');
      else logLine(`Failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  // Every download funnels through here, which is why the already-had guard
  // lives here and nowhere else: a set reached through two models is one set on
  // disk, and the second time round it is not fetched again. `err.had` marks it
  // as the ordinary case rather than a failure.
  async function processAlbum(ref) {
    if (historyHas(ref.id)) {
      const err = new Error('already downloaded');
      err.skip = true;
      err.had = true;
      throw err;
    }

    setProgress(0);
    logLine(`Scanning set ${ref.id}.`);

    const album = await scanAlbum(ref);
    if (state.cancel) throw new Error('cancelled');
    if (!album.items.length) throw new Error('no photos or videos found in this set');

    setAlbumDisplay(album.title, `${album.title} (${album.id})`);
    setFileDisplay(`0/${album.items.length}`);
    logLine(`${album.title} — ${album.items.length} file${album.items.length === 1 ? '' : 's'}, model ${album.models.join(' & ') || 'unknown'}, ${album.date || 'no date'}.`);

    album.saved = await buildAndSaveArchive(album);
    markDownloaded(album.id, album.title);
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
      if (!ALLOW_PARTIAL_ALBUMS) throw new Error(detail);
      logLine(`Partial album: ${detail}.`);
    }

    album.items = photos.map(photo => ({ kind: 'image', url: photo.url, index: 0 }));

    const video = videoFrom(doc, html, url);
    if (video) {
      album.items.push({ kind: 'video', url: video.url, guessed: video.guessed, index: 0 });
      logLine(video.guessed ? 'Video guessed from the poster; skipped if it is not there.' : 'Bonus video found.');
    }

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
    let failedFiles = 0;
    setFileProgress(0, album.items.length, 0);
    await runPool(album.items, IMAGE_CONCURRENCY, async item => {
      try {
        item.data = await fetchBinaryWithRetry(item.url);
      } catch (err) {
        item.error = errorMessage(err);
        failedFiles++;
      }
      done++;
      setFileProgress(done, album.items.length, failedFiles);
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
      // A stale cancel would otherwise abort the next thing that checks it.
      state.cancel = false;
    }
    if (ui.drop) ui.drop.hidden = busy;
    if (ui.progress) ui.progress.hidden = !busy;
    if (ui.live) ui.live.hidden = !busy;
    if (ui.stop) {
      ui.stop.hidden = !busy;
      ui.stop.disabled = !busy;
    }
    // Indexing is a run like any other, but its own button turns into Stop
    // rather than going dead, so it is left out of the blanket disable.
    [ui.check, ui.clearIndex, ui.clearDownloads].forEach(button => {
      if (button) button.disabled = busy;
    });
    if (ui.index) ui.index.disabled = busy && !state.indexing;
    if (state.checking) setCheckButton(true);
  }

  // A cancel is aimed at the run, not at whichever set happens to be in flight.
  function requestStop() {
    if (!state.busy) return;
    state.cancel = true;
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
  installEarlyObserver();
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
