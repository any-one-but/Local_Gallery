// ==UserScript==
// @name         ShareAnyNudes Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.00
// @description  ShareAnyNudes video downloader. Drop a video or a model link to download it, named by model and date, without the site's logo where the site allows.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/ShareAnyNudes_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/ShareAnyNudes_Stripper.user.js
// @match        *://shareanynudes.com/*
// @match        *://*.shareanynudes.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      self
// @connect      shareanynudes.com
// @connect      *.shareanynudes.com
// @connect      nudes365.com
// @connect      *.nudes365.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

// ===========================================================================
// WHAT THIS IS
// ===========================================================================
// The Playboy Plus Stripper's panel and naming, on ShareAnyNudes. The site is a
// stock video-sharing script (KVS), and that makes it simple to read:
//
//   - A video page carries everything in its own HTML: the player settings
//     (`flashvars`) name the title, the models and a download link per quality,
//     and the page's JSON-LD block carries the upload date. One page fetch is a
//     whole video's worth of facts.
//   - A model page lists her videos twenty at a time, and the site's own "next
//     page" asks the same URL with `mode=async&function=get_block&from=N`. Those
//     pages are plain HTML too, so walking a model is reading pages until one
//     comes back with nothing new on it.
//   - The download links are signed per visit (`v-acctoken`) and redirect to the
//     storage host, which sends no CORS headers, so files come through
//     GM_xmlhttpRequest. No login and no referer is needed.
//
// ---------------------------------------------------------------------------
// THE WATERMARK
// ---------------------------------------------------------------------------
// The site keeps two encodes of every video, and only one of them is branded.
// The 720p copy has "SHAREANYNUDES" burned into the bottom-right corner; the
// 480p copy (the one whose file name has no `_720p` on it) has no site logo at
// all. Checked on every video sampled, portrait and landscape. The logo is part
// of the picture in the 720p file, so there is no taking it back out of that
// one — the only clean copy is the 480p one.
//
// So the footer has one switch, "No watermark", on by default: on takes the
// clean 480p copy, off takes the sharpest copy there is, logo and all. Marks
// that came with the video from wherever it was first posted (an OnlyFans URL,
// a studio name) are in both copies and are not this site's to remove.
//
// ---------------------------------------------------------------------------
// NAMING
// ---------------------------------------------------------------------------
// Exactly the Playboy Plus Stripper's shape, one video standing in for one set:
//
//   ShareAnyNudes/<Model>/<yymmdd>-<Model> - <Title>.zip
//     └ <yymmdd>-<Model> - <Title>/<yymmdd>-<Model> - <Title>_001.mp4
//
// The date is the day the site published it. The title loses the model's name
// off its front (it is already in the prefix) and the site's boilerplate off its
// end ("OnlyFans 4K PPV Video Leaked" and its many cousins), because those are
// on nearly every title here and would make every file read the same. A video
// with nobody listed files under _Untagged and drops the model segment.
//
// ---------------------------------------------------------------------------
// HAVING
// ---------------------------------------------------------------------------
// Every video saved is remembered by its link, in the userscript's own storage.
// A remembered video is not downloaded again — dropping her model a second time
// takes only what has appeared since — and its card on the site is dimmed, so
// what is left to take is what stands out. "Clear downloads" forgets the lot.
// ===========================================================================

(function () {
  'use strict';

  if (!/(?:^|\.)shareanynudes\.com$/i.test(location.hostname)) return;
  if (window.top !== window.self) return;
  if (window.__shareAnyNudesStripperLoaded) return;
  window.__shareAnyNudesStripperLoaded = true;

  // ===========================================================================
  // CONFIG
  // ===========================================================================

  const ORIGIN = location.origin;
  const ROOT_FOLDER = 'ShareAnyNudes';
  const UNTAGGED_FOLDER = '_Untagged';
  const MULTI_MODEL_FOLDER = '_Various';
  const MODEL_JOIN = ' and ';
  // More names than this on one video is a compilation, not anybody's.
  const COLLAB_MAX_MODELS = 6;
  const MAX_TITLE_CHARS = 56;
  const MIN_INDEX_PAD = 3;

  const PAGE_DELAY_MS = 400;        // between model listing pages
  const VIDEO_DELAY_MS = 800;       // between videos in a model run
  const MAX_RETRIES = 2;
  const PAGE_TIMEOUT_MS = 45000;
  const VIDEO_TIMEOUT_MS = 3600000; // an hour; long videos are hundreds of MB
  const SAVE_TIMEOUT_MS = 20000;
  const MODEL_MAX_PAGES = 200;
  const AUTO_START_MS = 5000;
  const COLLAPSED_CUE_MS = 2200;

  const MODEL_LIST_BLOCK = 'list_videos_common_videos_list';

  const HAD_KEY = 'ShareAnyNudesStripper.had.v1';
  const MODEL_VIDEOS_KEY = 'ShareAnyNudesStripper.modelVideos.v1';
  const CLEAN_KEY = 'ShareAnyNudesStripper.clean.v1';
  const PANEL_POS_KEY = 'ShareAnyNudesStripper.panelpos.v1';

  // Words the site hangs off the end of almost every title. Taken off the end
  // only, one at a time, so "Leaked" in the middle of a real title survives.
  const TITLE_TAIL_WORDS = new Set([
    'onlyfans', 'only', 'fans', 'fansly', 'patreon', 'ppv', '4k', 'hd', 'uhd', '1080p', '720p',
    'exclusive', 'new', 'latest', 'full', 'video', 'videos', 'vid', 'clip', 'leaked', 'leak',
    'leaks', 'viral', 'mms', 'nude', 'nudes', 'naked', 'uncensored', 'porn', 'xxx'
  ]);
  // Same idea at the front, but only words that never carry meaning there.
  const TITLE_HEAD_WORDS = new Set(['watch', 'onlyfans', 'leaked', 'viral', 'new']);

  // ===========================================================================

  const state = {
    busy: false,
    cancel: false,
    clean: true,
    aborters: new Set(),
    had: {},          // video slug -> { id, at }
    modelVideos: {},  // model slug -> [video slugs], as of her last walk
    queue: [],
    currentJobKey: '',
    focusedFromPage: false
  };

  const ui = {};
  let COLLAPSED_CUE_TIMER = 0;
  let CARD_REFRESH_TIMER = 0;

  // --- storage ---------------------------------------------------------------
  //
  // The userscript's own storage first, because it outlives the site's: clearing
  // the site's data must not forget what you have. localStorage is the fallback
  // for a manager without GM_getValue.

  function readStore(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = GM_getValue(key, undefined);
        if (value !== undefined) return value;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    } catch {}
    return fallback;
  }

  function writeStore(key, value) {
    try {
      if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; }
    } catch {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function loadState() {
    const had = readStore(HAD_KEY, {});
    state.had = had && typeof had === 'object' ? had : {};
    const models = readStore(MODEL_VIDEOS_KEY, {});
    state.modelVideos = models && typeof models === 'object' ? models : {};
    state.clean = readStore(CLEAN_KEY, true) !== false;
  }

  function videoIsHad(slug) {
    return !!(slug && state.had[slug]);
  }

  function markHad(slug, id) {
    if (!slug) return;
    state.had[slug] = { id: String(id || ''), at: Date.now() };
    writeStore(HAD_KEY, state.had);
  }

  function rememberModelVideos(modelSlug, slugs) {
    if (!modelSlug) return;
    state.modelVideos[modelSlug] = slugs.slice();
    writeStore(MODEL_VIDEOS_KEY, state.modelVideos);
  }

  function setClean(on) {
    state.clean = on !== false;
    writeStore(CLEAN_KEY, state.clean);
    renderFooter();
  }

  function resetDownloads() {
    const count = Object.keys(state.had).length;
    if (!count) return;
    if (!window.confirm(`Forget all ${count} downloaded video${count === 1 ? '' : 's'}? Nothing on disk is touched.`)) return;
    state.had = {};
    writeStore(HAD_KEY, state.had);
    logLine(`Forgot ${count} download${count === 1 ? '' : 's'}.`);
    refreshResultRows();
    renderFooter();
    scheduleCardRefresh();
  }

  // --- the site's own cards --------------------------------------------------
  //
  // A card you already have is dimmed, not removed: this site's grid is ad-mixed
  // and lays out by position, so taking cards out reshuffles it under the cursor.

  function cardSlug(anchor) {
    const target = targetFromUrl(anchor && anchor.getAttribute('href'), ORIGIN);
    return target && target.kind === 'video' ? target.slug : '';
  }

  function refreshCards() {
    let anchors = [];
    try { anchors = Array.from(document.querySelectorAll('a.media[href*="/video/"], .card a[href*="/video/"]')); } catch {}
    const seen = new Set();
    anchors.forEach(anchor => {
      const card = anchor.closest('.th, .card, .item') || anchor;
      if (seen.has(card) || (ui.panel && ui.panel.contains(card))) return;
      seen.add(card);
      card.classList.toggle('saGot', videoIsHad(cardSlug(anchor)));
    });
  }

  function scheduleCardRefresh() {
    clearTimeout(CARD_REFRESH_TIMER);
    CARD_REFRESH_TIMER = setTimeout(refreshCards, 120);
  }

  function installCardObserver() {
    // Paging and sorting on the site swap the list in place, without a load.
    try {
      new MutationObserver(mutations => {
        if (mutations.some(m => m.addedNodes && m.addedNodes.length && !(ui.panel && ui.panel.contains(m.target)))) {
          scheduleCardRefresh();
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch {}
  }

  // ===========================================================================
  // THE PANEL
  // ===========================================================================

  function init() {
    loadState();
    injectStyle();
    const panel = document.createElement('div');
    panel.id = 'shareAnyNudesStripperPanel';
    panel.innerHTML = `
      <div class="sa-head">
        <span class="sa-title">ShareAnyNudes Stripper</span>
        <button id="saCollapse" class="sa-iconBtn" type="button" title="Collapse">&#9652;</button>
      </div>
      <div class="sa-body">
        <div id="saDrop" class="sa-drop" title="Drop a video to take it, or a model to take every video she has.">Drop a video or model link here</div>

        <div class="sa-resultsWrap">
          <div id="saSummary" class="sa-summary"></div>
          <div id="saResults" class="sa-results"></div>
        </div>

        <div class="sa-progress" hidden><div id="saFill"></div></div>
        <div class="sa-live" aria-live="polite" hidden>
          <div class="sa-line"><span>Model</span><strong id="saModel">None</strong></div>
          <div class="sa-line"><span>Videos</span><strong id="saVideos">0/0</strong></div>
          <div class="sa-line"><span>Current</span><strong id="saCurrent">None</strong></div>
          <div class="sa-line"><span>File</span><strong id="saFile">None</strong></div>
        </div>
        <button id="saStop" type="button" hidden>Stop</button>
        <div id="saLog" class="sa-log" aria-live="polite"></div>

        <div class="sa-foot">
          <div class="sa-footStats">
            <span id="saStats"></span>
            <button id="saClearDownloads" class="sa-footBtn" type="button" title="Forget every download. Files on disk are not touched." hidden>Clear downloads</button>
          </div>
          <div class="sa-footBtns">
            <button id="saClean" class="sa-footBtn" type="button" aria-pressed="true">No watermark</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.drop = panel.querySelector('#saDrop');
    ui.summary = panel.querySelector('#saSummary');
    ui.results = panel.querySelector('#saResults');
    ui.progress = panel.querySelector('.sa-progress');
    ui.fill = panel.querySelector('#saFill');
    ui.live = panel.querySelector('.sa-live');
    ui.model = panel.querySelector('#saModel');
    ui.videos = panel.querySelector('#saVideos');
    ui.current = panel.querySelector('#saCurrent');
    ui.file = panel.querySelector('#saFile');
    ui.stop = panel.querySelector('#saStop');
    ui.log = panel.querySelector('#saLog');
    ui.stats = panel.querySelector('#saStats');
    ui.clearDownloads = panel.querySelector('#saClearDownloads');
    ui.clean = panel.querySelector('#saClean');

    ui.stop.addEventListener('click', requestStop);
    ui.results.addEventListener('click', handleRowAction);
    ui.clearDownloads.addEventListener('click', resetDownloads);
    ui.clean.addEventListener('click', () => setClean(!state.clean));
    panel.querySelector('#saCollapse').addEventListener('click', () => {
      panel.classList.toggle('sa-collapsed');
      panel.querySelector('#saCollapse').innerHTML = panel.classList.contains('sa-collapsed') ? '&#9662;' : '&#9652;';
    });

    makePanelDraggable(panel, panel.querySelector('.sa-head'));
    installDropTarget(panel);
    renderFooter();
    showSummary(idleMessage());
    offerCurrentPage();
    installCardObserver();
    refreshCards();
  }

  function idleMessage() {
    return 'Drag a video or a model here from the site. It starts on its own after five seconds.';
  }

  // Standing on a video or a model page puts it on the list, without the
  // countdown: you did not drop it, so it waits for the button.
  function offerCurrentPage() {
    const target = targetFromUrl(location.href, ORIGIN);
    if (!target) return;
    const title = target.kind === 'video' ? pageVideoTitle() : pageModelName();
    if (title) target.title = title;
    appendRows([target]);
    state.focusedFromPage = true;
    showSummary(target.kind === 'video' ? 'This video is ready. Press Download, or drop more.' : 'This model is ready. Press Download, or drop more.');
  }

  function pageVideoTitle() {
    const vars = readFlashvars(document.documentElement.innerHTML);
    return vars.video_title ? tidySpaces(vars.video_title) : '';
  }

  function pageModelName() {
    const heading = document.querySelector('h1.title, h1');
    const text = heading ? tidySpaces(heading.textContent) : '';
    return text.replace(/'s?\s+(?:new\s+|top\s+rated\s+|most\s+viewed\s+)?videos.*$/i, '').trim();
  }

  function renderFooter() {
    const count = Object.keys(state.had).length;
    if (ui.stats) {
      ui.stats.textContent = count ? `${count} video${count === 1 ? '' : 's'} downloaded` : 'Nothing downloaded yet';
      ui.stats.title = count ? 'Their cards on the site are dimmed, and they are skipped if dropped again.' : '';
    }
    if (ui.clearDownloads) ui.clearDownloads.hidden = !count;
    if (ui.clean) {
      ui.clean.classList.toggle('sa-footBtnOn', state.clean);
      ui.clean.setAttribute('aria-pressed', state.clean ? 'true' : 'false');
      ui.clean.textContent = state.clean ? 'No watermark (480p)' : 'Watermarked (720p)';
      ui.clean.title = state.clean
        ? 'Taking the 480p copy, which has no ShareAnyNudes logo. Press for the sharper 720p copy, which has it burned into the corner.'
        : 'Taking the sharpest copy, which has the ShareAnyNudes logo burned into the corner. Press to take the clean 480p copy instead.';
    }
  }

  function showSummary(text) {
    if (!ui.summary) return;
    ui.summary.textContent = String(text || '');
    ui.summary.hidden = !text;
  }

  // --- style -----------------------------------------------------------------
  //
  // The Playboy Plus panel, in this site's blue (the "SHARE" in its logo,
  // lifted a step so it reads on the dark panel). Same strengths, same roles.

  function addStyle(css) {
    try {
      if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
    } catch {}
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function injectStyle() {
    const P = '#shareAnyNudesStripperPanel';
    const A = '118,160,236';
    addStyle(`
      .saGot{opacity:.28!important;transition:opacity 120ms ease}
      .saGot:hover{opacity:.7!important}

      ${P}{position:fixed;right:16px;top:16px;z-index:2147483646;width:360px;max-height:88vh;
        display:flex;flex-direction:column;border:1px solid rgba(${A},.4);border-radius:10px;box-sizing:border-box;
        background:#141210;color:#f2ece1;box-shadow:0 18px 60px rgba(0,0,0,.6);font:700 12px/1.35 Arial,sans-serif;
        overflow:hidden;text-align:left;letter-spacing:normal;text-transform:none}
      ${P} *{box-sizing:border-box}
      ${P} [hidden]{display:none!important}
      ${P}.sa-collapsed{height:auto;max-height:none}
      ${P}.sa-collapsed .sa-body{display:none}
      ${P}.sa-tookIt .sa-head{background:linear-gradient(90deg,#24324d,#171a22)}
      ${P}.sa-tookIt .sa-title{color:#d6e3fb}
      ${P} .sa-head{flex:0 0 auto;height:38px;display:flex;align-items:center;gap:6px;padding:0 10px;
        touch-action:none;user-select:none;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#33261a,#1a1613);cursor:grab}
      ${P}.sa-dragging-panel .sa-head{cursor:grabbing}
      ${P} .sa-title{font-weight:900;color:#76a0ec;flex:1 1 auto;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      ${P} .sa-iconBtn{flex:0 0 auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px;font-size:13px}
      ${P} .sa-body{flex:1 1 auto;display:flex;flex-direction:column;gap:12px;padding:10px;min-height:0;overflow:hidden}
      ${P} button{appearance:none;width:100%;min-height:32px;margin:0;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#f2ece1;font:700 12px/1 Arial,sans-serif;cursor:pointer;
        text-transform:none;letter-spacing:normal;box-shadow:none}
      ${P} button:hover:not(:disabled){background:rgba(${A},.2);border-color:rgba(${A},.55)}
      ${P} button:disabled{opacity:.42;cursor:default}

      ${P} .sa-drop{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-height:52px;padding:8px 10px;
        border:1px dashed rgba(${A},.45);border-radius:8px;background:rgba(${A},.06);
        color:#b3a58c;font-weight:700;text-align:center}
      ${P}.sa-dragging .sa-drop{border-color:#76a0ec;border-style:solid;background:rgba(${A},.22);color:#fff}

      ${P} .sa-resultsWrap{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
      ${P} .sa-summary{flex:0 0 auto;min-height:18px;color:#bdb1a0;font-weight:700;line-height:1.4}
      ${P} .sa-results{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding-right:2px}
      ${P} .sa-results:empty{display:none}
      ${P} .sa-row{flex:0 0 auto;position:relative;overflow:hidden;
        display:grid;grid-template-columns:auto minmax(0,1fr) auto auto auto;gap:8px;align-items:center;
        padding:7px 8px;border-radius:8px;background:rgba(255,255,255,.05)}
      ${P} .sa-rowKind{flex:0 0 auto;min-height:18px;display:inline-flex;align-items:center;padding:0 6px;border-radius:999px;
        background:rgba(${A},.13);color:#76a0ec;font-weight:900;font-size:9px;letter-spacing:.08em;text-transform:uppercase}
      ${P} .sa-row[data-kind="video"] .sa-rowKind{background:rgba(255,255,255,.06);color:#d7cbb6}
      ${P} .sa-rowName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#f2ece1;font-weight:900;font-size:12px}
      ${P} .sa-rowCount{flex:0 0 auto;color:#a99b87;font-weight:900;font-size:11px;
        font-variant-numeric:tabular-nums;letter-spacing:.02em}
      ${P} .sa-rowCountDone{color:#8fd49b}
      ${P} .sa-row button{width:auto;min-height:24px;padding:0 9px;border-radius:6px;font-size:10px}
      ${P} .sa-rowX{width:24px!important;min-width:24px;padding:0!important;font-size:13px!important;line-height:1;color:#c0b09a}
      ${P} .sa-rowX:hover:not(:disabled){background:rgba(224,138,138,.22);border-color:rgba(224,138,138,.5);color:#ffd9d9}
      ${P} .sa-rowTimer{position:absolute;left:0;right:0;bottom:0;height:2px;pointer-events:none}
      ${P} .sa-rowTimer i{display:block;height:2px;width:100%;background:#76a0ec;transform:scaleX(0);transform-origin:left center}
      ${P} .sa-rowHad{opacity:.62}

      ${P} .sa-progress{display:block;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      ${P} #saFill{display:block;height:10px;min-height:10px;width:0;
        background:linear-gradient(90deg,#3f6fc4,#76a0ec);transition:width 120ms ease}
      ${P} .sa-live{flex:0 0 auto;display:flex;flex-direction:column;gap:5px}
      ${P} .sa-line{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;align-items:baseline}
      ${P} .sa-line span{color:#857a68;font-weight:900;text-transform:uppercase;font-size:10px}
      ${P} .sa-line strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee5d5;font-size:12px;font-weight:900}
      ${P} #saStop{flex:0 0 auto;background:#4a3323;color:#ffeccf;border-color:rgba(${A},.6)}
      ${P} .sa-log{flex:0 0 auto;max-height:72px;overflow:auto;color:#a99b87;font:700 11px/1.35 Arial,sans-serif;
        white-space:pre-wrap;word-break:break-word}
      ${P} .sa-log:empty{display:none}

      ${P} .sa-foot{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding-top:10px;
        border-top:1px solid rgba(${A},.16)}
      ${P} .sa-footStats{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
      ${P} .sa-footStats span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#bdb1a0;font-weight:700;font-size:11px}
      ${P} .sa-footBtns{display:flex;flex-wrap:wrap;gap:6px}
      ${P} .sa-footBtn{width:auto;flex:1 1 auto;min-height:28px;border-radius:7px;font-size:11px}
      ${P} .sa-footStats .sa-footBtn{flex:0 0 auto}
      ${P} .sa-footBtnOn{background:#76a0ec;color:#141210;border-color:#5f8bd8;font-weight:900}
      ${P} .sa-footBtnOn:hover:not(:disabled){background:#9dbcf2;border-color:#76a0ec}

      @media (max-width:700px){
        ${P}{width:calc(100vw - 16px);right:8px;left:auto}
      }
    `);
  }

  // --- moving the panel ------------------------------------------------------

  const PANEL_MIN_VISIBLE_PX = 60;

  function clampPanelPosition(panel, x, y) {
    const width = panel.offsetWidth || 300;
    const maxX = Math.max(0, window.innerWidth - PANEL_MIN_VISIBLE_PX);
    const maxY = Math.max(0, window.innerHeight - 30);
    return {
      x: Math.min(Math.max(x, PANEL_MIN_VISIBLE_PX - width), maxX),
      y: Math.min(Math.max(y, 0), maxY)
    };
  }

  function placePanelAt(panel, x, y) {
    const at = clampPanelPosition(panel, x, y);
    panel.style.left = `${at.x}px`;
    panel.style.top = `${at.y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.classList.add('sa-dragged');
    return at;
  }

  function savePanelPosition(at) {
    try { sessionStorage.setItem(PANEL_POS_KEY, JSON.stringify({ x: Math.round(at.x), y: Math.round(at.y) })); } catch {}
  }

  function restorePanelPosition(panel) {
    try {
      const at = JSON.parse(sessionStorage.getItem(PANEL_POS_KEY) || 'null');
      if (!at || !Number.isFinite(Number(at.x)) || !Number.isFinite(Number(at.y))) return;
      placePanelAt(panel, Number(at.x), Number(at.y));
    } catch {}
  }

  function makePanelDraggable(panel, handle) {
    if (!handle) return;
    restorePanelPosition(panel);
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let last = null;

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      try { if (event.target.closest('button, input, a')) return; } catch {}
      const rect = panel.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;
      startX = event.clientX;
      startY = event.clientY;
      dragging = true;
      last = placePanelAt(panel, originX, originY);
      panel.classList.add('sa-dragging-panel');
      try { handle.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!dragging) return;
      last = placePanelAt(panel, originX + (event.clientX - startX), originY + (event.clientY - startY));
    });
    const end = event => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('sa-dragging-panel');
      try { handle.releasePointerCapture(event.pointerId); } catch {}
      if (last) savePanelPosition(last);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => {
      if (!panel.classList.contains('sa-dragged')) return;
      const rect = panel.getBoundingClientRect();
      last = placePanelAt(panel, rect.left, rect.top);
      savePanelPosition(last);
    });
  }

  // --- dropping ---------------------------------------------------------------

  function installDropTarget(panel) {
    let depth = 0;
    const setDragging = on => panel.classList.toggle('sa-dragging', on);
    panel.addEventListener('dragenter', event => {
      event.preventDefault();
      depth++;
      setDragging(true);
    });
    panel.addEventListener('dragover', event => {
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
      if (!targets.length) { showSummary('Nothing in that drop is a video or a model link.'); return; }
      acceptDrop(targets);
    });
  }

  // A dragged card arrives as several flavours at once (the link, the page's
  // HTML for it, plain text). Read them all and let the URL matcher sort it out.
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
    String(text || '').split(/[\s"'<>]+/).forEach(token => {
      if (!token || token.charAt(0) === '#') return;
      const target = targetFromUrl(token.replace(/&amp;/g, '&'), ORIGIN);
      if (!target || seen.has(targetKey(target))) return;
      seen.add(targetKey(target));
      targets.push(target);
    });
    return targets;
  }

  function targetFromUrl(raw, base) {
    if (!raw) return null;
    let url;
    try { url = new URL(String(raw), base); } catch { return null; }
    if (!/(?:^|\.)shareanynudes\.com$/i.test(url.hostname)) return null;
    const video = url.pathname.match(/^\/video\/([^/?#]+)\/?/i);
    if (video) return { kind: 'video', slug: decodeURIComponent(video[1]).toLowerCase() };
    const model = url.pathname.match(/^\/models\/([^/?#]+)\/?/i);
    if (model && !/^\d+$/.test(model[1])) return { kind: 'model', slug: decodeURIComponent(model[1]).toLowerCase() };
    return null;
  }

  function targetKey(target) {
    return `${target.kind}:${target.slug}`;
  }

  function videoPageUrl(slug) {
    return `${ORIGIN}/video/${encodeURIComponent(slug)}/`;
  }

  function modelPageUrl(slug) {
    return `${ORIGIN}/models/${encodeURIComponent(slug)}/`;
  }

  // ===========================================================================
  // THE LIST (which is the queue)
  // ===========================================================================
  //
  // As on Playboy Plus: a drop adds to the bottom and only the × takes a row
  // away. With the panel open a dropped row counts down five seconds and then
  // starts, so there is a moment to read it and change your mind; with the panel
  // collapsed it goes straight in, and the title bar says what it took.

  function acceptDrop(targets) {
    if (state.focusedFromPage) {
      // The page's own offer was a suggestion; a drop is a decision. Clear the
      // suggestion out unless it has already been acted on.
      Array.from(ui.results.querySelectorAll('.sa-row[data-from-page]')).forEach(row => {
        const key = row.dataset.key;
        if (state.currentJobKey !== key && !state.queue.some(job => job.key === key)) row.remove();
      });
      state.focusedFromPage = false;
    }
    const listed = listedRowKeys();
    const fresh = targets.filter(target => !listed.has(targetKey(target)));
    const rows = appendRows(fresh, true);
    if (panelIsCollapsed()) {
      rows.forEach(row => requestDownload(jobFromRow(row)));
      flashCollapsedCue(rows.map(row => row.dataset.title));
    } else {
      rows.forEach(beginRowCountdown);
    }
    const skipped = targets.length - fresh.length;
    showSummary(fresh.length
      ? `Added ${fresh.length}${skipped ? `, ${skipped} already listed` : ''}.`
      : 'Already on the list.');
  }

  function appendRows(targets, dropped) {
    const rows = [];
    if (!ui.results || !targets.length) return rows;
    const fragment = document.createDocumentFragment();
    targets.forEach(target => {
      const row = rowNode(target);
      if (!dropped) row.dataset.fromPage = '1';
      rows.push(row);
      fragment.appendChild(row);
    });
    ui.results.appendChild(fragment);
    requestAnimationFrame(() => {
      try { ui.results.scrollTop = ui.results.scrollHeight; } catch {}
    });
    return rows;
  }

  function rowNode(target) {
    const row = document.createElement('div');
    row.className = 'sa-row';
    row.dataset.kind = target.kind;
    row.dataset.slug = target.slug;
    row.dataset.key = targetKey(target);
    row.dataset.title = target.title || titleFromSlug(target.slug);

    const kind = document.createElement('span');
    kind.className = 'sa-rowKind';
    kind.textContent = target.kind;

    const name = document.createElement('div');
    name.className = 'sa-rowName';

    const count = document.createElement('div');
    count.className = 'sa-rowCount';

    const go = document.createElement('button');
    go.type = 'button';
    go.dataset.action = 'download';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.className = 'sa-rowX';
    remove.textContent = '\u00d7';
    remove.title = 'Take this off the list';

    const timer = document.createElement('div');
    timer.className = 'sa-rowTimer';
    timer.appendChild(document.createElement('i'));

    row.append(kind, name, count, go, remove, timer);
    applyRowState(row);
    return row;
  }

  function applyRowState(row) {
    const kind = row.dataset.kind;
    const slug = row.dataset.slug;
    const name = row.querySelector('.sa-rowName');
    if (name) {
      name.textContent = row.dataset.title || slug;
      name.title = name.textContent;
    }
    let had = false;
    const count = row.querySelector('.sa-rowCount');
    if (count) {
      if (kind === 'video') {
        had = videoIsHad(slug);
        count.textContent = had ? '1/1' : '0/1';
        count.title = had ? 'Downloaded' : 'Not downloaded';
      } else {
        const known = state.modelVideos[slug];
        if (known && known.length) {
          const got = known.filter(videoIsHad).length;
          had = got === known.length;
          count.textContent = `${got}/${known.length}`;
          count.title = `${got} of her ${known.length} videos, as of the last time she was read`;
        } else {
          count.textContent = '?';
          count.title = 'Not read yet. Her videos are counted when she downloads.';
        }
      }
      count.classList.toggle('sa-rowCountDone', had);
    }
    row.classList.toggle('sa-rowHad', had);
    const go = row.querySelector('button[data-action="download"]');
    if (go) {
      const next = downloadButtonState(row.dataset.key, had, kind);
      go.textContent = next.label;
      go.disabled = next.disabled;
    }
  }

  function refreshResultRows() {
    if (!ui.results) return;
    Array.from(ui.results.querySelectorAll('.sa-row')).forEach(applyRowState);
  }

  function downloadButtonState(key, had, kind) {
    if (state.currentJobKey === key) return { label: 'Downloading', disabled: true };
    if (state.queue.some(job => job.key === key)) return { label: 'In queue', disabled: true };
    if (had && kind === 'video') return { label: 'Have it', disabled: true };
    if (state.busy) return { label: 'Add to queue', disabled: false };
    return { label: had ? 'Check again' : 'Download', disabled: false };
  }

  function listedRowKeys() {
    if (!ui.results) return new Set();
    return new Set(Array.from(ui.results.querySelectorAll('.sa-row')).map(row => row.dataset.key));
  }

  function jobFromRow(row) {
    return { kind: row.dataset.kind, slug: row.dataset.slug, key: row.dataset.key, title: row.dataset.title };
  }

  function rowForKey(key) {
    if (!ui.results) return null;
    return Array.from(ui.results.querySelectorAll('.sa-row')).find(row => row.dataset.key === key) || null;
  }

  function panelIsCollapsed() {
    return !!(ui.panel && ui.panel.classList.contains('sa-collapsed'));
  }

  function handleRowAction(event) {
    const button = event.target && event.target.closest && event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('.sa-row');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.action === 'remove') { removeRow(row); return; }
    if (button.dataset.action === 'download') {
      cancelRowCountdown(row);
      requestDownload(jobFromRow(row));
    }
  }

  // The × takes the row out of the queue too. A download already running is
  // left alone; stopping that is what Stop is for.
  function removeRow(row) {
    cancelRowCountdown(row);
    const key = row.dataset.key;
    const before = state.queue.length;
    state.queue = state.queue.filter(job => job.key !== key);
    row.remove();
    if (state.queue.length !== before) logLine(`Took ${row.dataset.title || row.dataset.slug} out of the queue.`);
    refreshResultRows();
    if (!ui.results.children.length) showSummary(idleMessage());
  }

  function beginRowCountdown(row) {
    if (!row || row.__saTimer) return;
    const bar = row.querySelector('.sa-rowTimer i');
    if (bar) {
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(1)';
      requestAnimationFrame(() => {
        bar.style.transition = `transform ${AUTO_START_MS}ms linear`;
        bar.style.transform = 'scaleX(0)';
      });
    }
    row.__saTimer = setTimeout(() => {
      cancelRowCountdown(row);
      if (row.isConnected) requestDownload(jobFromRow(row));
    }, AUTO_START_MS);
  }

  function cancelRowCountdown(row) {
    if (!row) return;
    if (row.__saTimer) { clearTimeout(row.__saTimer); row.__saTimer = null; }
    const bar = row.querySelector('.sa-rowTimer i');
    if (bar) { bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)'; }
  }

  function flashCollapsedCue(names) {
    const title = ui.panel && ui.panel.querySelector('.sa-title');
    if (!title || !names.length) return;
    if (!title.dataset.saLabel) title.dataset.saLabel = title.textContent;
    clearTimeout(COLLAPSED_CUE_TIMER);
    title.textContent = names.length === 1 ? `\u2193 ${names[0]}` : `\u2193 ${names.length} items`;
    ui.panel.classList.add('sa-tookIt');
    COLLAPSED_CUE_TIMER = setTimeout(() => {
      title.textContent = title.dataset.saLabel || 'ShareAnyNudes Stripper';
      ui.panel.classList.remove('sa-tookIt');
    }, COLLAPSED_CUE_MS);
  }

  function requestDownload(job) {
    if (!job || !job.slug) return;
    if (state.currentJobKey === job.key || state.queue.some(entry => entry.key === job.key)) return;
    if (job.kind === 'video' && videoIsHad(job.slug)) {
      logLine(`Already have ${job.title || job.slug}.`);
      return;
    }
    if (state.busy) {
      state.queue.push(job);
      logLine(`Queued ${job.title || job.slug}.`);
      refreshResultRows();
      return;
    }
    startJob(job);
  }

  function pumpQueue() {
    if (state.busy) return;
    const job = state.queue.shift();
    refreshResultRows();
    if (job) Promise.resolve().then(() => startJob(job));
  }

  async function startJob(job) {
    if (state.busy) { requestDownload(job); return; }
    state.cancel = false;
    state.currentJobKey = job.key;
    setBusy(true);
    resetLog();
    try {
      if (job.kind === 'model') await downloadModel(job);
      else {
        setModelDisplay('Single video');
        setVideosDisplay('0/1');
        await processVideo(job.slug);
        setVideosDisplay('1/1');
      }
    } catch (err) {
      const message = errorMessage(err);
      if (message === 'cancelled') logLine('Cancelled.');
      else if (err && err.had) logLine('You already have this video.');
      else logLine(`Failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  // ===========================================================================
  // READING THE SITE
  // ===========================================================================

  // The player's settings are a JS object literal of single-quoted strings, with
  // the site's apostrophes written as \'. Its variable gets a random name on
  // every page (`var tf2270f210b = {`), so it is found by its first key instead.
  // Read as pairs rather than evaluate anything the page sends.
  function readFlashvars(html) {
    const vars = {};
    const block = String(html || '').match(/=\s*\{\s*video_id\s*:\s*'[\s\S]*?\};/);
    const text = block ? block[0] : '';
    const re = /([a-z0-9_]+)\s*:\s*'((?:\\.|[^'\\])*)'/gi;
    let match;
    while ((match = re.exec(text))) {
      if (!(match[1] in vars)) vars[match[1]] = match[2].replace(/\\(.)/g, '$1');
    }
    return vars;
  }

  function readJsonLd(doc) {
    const out = {};
    Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).forEach(node => {
      try {
        const data = JSON.parse(node.textContent);
        (Array.isArray(data) ? data : [data]).forEach(item => {
          if (item && item['@type'] === 'VideoObject') Object.assign(out, item);
        });
      } catch {}
    });
    return out;
  }

  async function readVideoPage(slug) {
    const html = await httpText(videoPageUrl(slug));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const vars = readFlashvars(html);
    const ld = readJsonLd(doc);

    const formats = [];
    Object.keys(vars).forEach(key => {
      const m = key.match(/^video_(?:alt_)?url(\d*)$/);
      if (!m || !/^https?:/i.test(vars[key])) return;
      const label = vars[`${key}_text`] || '';
      const fromName = vars[key].match(/_(\d{3,4})p\.mp4/i);
      const height = parseInt(label, 10) || (fromName ? Number(fromName[1]) : 0);
      // The clean encode is the one the site stored under the bare id, with no
      // `_720p` on its file name. That is the one without the logo.
      const clean = !/_\d{3,4}p\.(?:mp4|webm)/i.test(vars[key]);
      formats.push({ url: vars[key], label: label || (height ? `${height}p` : 'video'), height, clean });
    });
    if (!formats.length) {
      if (/login-required|premium/i.test(html) && /video_id/.test(html)) {
        throw new Error('this video needs a login or premium to play');
      }
      throw new Error('no download link on the video page');
    }

    let models = String(vars.video_models || '').split(',').map(tidySpaces).filter(Boolean);
    if (!models.length) {
      models = Array.from(doc.querySelectorAll('a.model-link, .model-item a[href*="/models/"]'))
        .map(a => tidySpaces((a.querySelector('.name, .title, strong') || a).textContent))
        .filter(Boolean);
    }
    models = Array.from(new Set(models));

    return {
      slug,
      id: String(vars.video_id || ''),
      title: tidySpaces(ld.name || vars.video_title || titleFromSlug(slug)),
      date: String(ld.uploadDate || ''),
      models,
      formats
    };
  }

  function pickFormat(formats) {
    const byHeight = formats.slice().sort((a, b) => b.height - a.height);
    if (state.clean) {
      const clean = byHeight.find(f => f.clean);
      if (clean) return clean;
      logLine('No clean copy of this one; taking the watermarked one.');
    }
    return byHeight[0];
  }

  // Her listing, page by page, through the same request the site's own "next"
  // button makes. Stops at the first page with nothing new on it — the site
  // answers a page past the end with the last page again, not with nothing.
  async function listModelVideos(modelSlug) {
    const slugs = [];
    const seen = new Set();
    let name = '';
    for (let page = 1; page <= MODEL_MAX_PAGES; page++) {
      if (state.cancel) throw cancelledError();
      const url = page === 1
        ? modelPageUrl(modelSlug)
        : `${modelPageUrl(modelSlug)}?mode=async&function=get_block&block_id=${MODEL_LIST_BLOCK}&sort_by=post_date&from=${page}`;
      const html = await httpText(url);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (page === 1) {
        const heading = doc.querySelector('h1.title, h1');
        name = heading ? tidySpaces(heading.textContent).replace(/'s?\s+(?:new\s+)?videos.*$/i, '').trim() : '';
      }
      const list = doc.getElementById(`${MODEL_LIST_BLOCK}_items`) || doc.querySelector('[id$="_videos_list_items"]');
      if (!list) break;
      let fresh = 0;
      Array.from(list.querySelectorAll('a[href*="/video/"]')).forEach(anchor => {
        const target = targetFromUrl(anchor.getAttribute('href'), ORIGIN);
        if (!target || target.kind !== 'video' || seen.has(target.slug)) return;
        seen.add(target.slug);
        slugs.push(target.slug);
        fresh++;
      });
      setVideosDisplay(`${slugs.length} found`);
      const hasNext = !!doc.querySelector(`#${MODEL_LIST_BLOCK}_pagination .next a, .pagination .next a`);
      if (!fresh || !hasNext) break;
      await delay(PAGE_DELAY_MS);
    }
    return { name, slugs };
  }

  async function downloadModel(job) {
    setModelDisplay(job.title || titleFromSlug(job.slug));
    logLine(`Reading ${job.title || job.slug}'s videos.`);
    const listing = await listModelVideos(job.slug);
    if (listing.name) {
      setModelDisplay(listing.name);
      const row = rowForKey(job.key);
      if (row) row.dataset.title = listing.name;
    }
    rememberModelVideos(job.slug, listing.slugs);
    refreshResultRows();
    if (!listing.slugs.length) throw new Error('no videos listed for this model');

    const todo = listing.slugs.filter(slug => !videoIsHad(slug));
    const had = listing.slugs.length - todo.length;
    logLine(`${listing.slugs.length} video${listing.slugs.length === 1 ? '' : 's'}${had ? `, ${had} already downloaded` : ''}.`);
    if (!todo.length) { setProgress(100); logLine('Nothing new.'); return; }

    // Oldest first, so the files land in the order she posted them.
    todo.reverse();
    let done = 0;
    let failed = 0;
    for (const slug of todo) {
      if (state.cancel) throw cancelledError();
      setVideosDisplay(`${done}/${todo.length}${failed ? `, ${failed} failed` : ''}`);
      try {
        await processVideo(slug);
      } catch (err) {
        if (isCancelledError(err) || state.cancel) throw cancelledError();
        failed++;
        logLine(`${titleFromSlug(slug)} failed: ${errorMessage(err)}`);
      }
      done++;
      refreshResultRows();
      if (done < todo.length) await delay(VIDEO_DELAY_MS);
    }
    setVideosDisplay(`${done - failed}/${todo.length}${failed ? `, ${failed} failed` : ''}`);
    logLine(failed ? `Finished with ${failed} failed. Press Download again to retry them.` : 'Done.');
  }

  async function processVideo(slug) {
    if (videoIsHad(slug)) {
      const err = new Error('already downloaded');
      err.had = true;
      throw err;
    }
    setProgress(0);
    setCurrentDisplay(titleFromSlug(slug));
    setFileDisplay('Reading page');
    const video = await readVideoPage(slug);
    if (state.cancel) throw cancelledError();
    const format = pickFormat(video.formats);
    const base = archiveBaseName(video);
    // A dropped row only knew its link; now it can say what the video is called.
    const row = rowForKey(`video:${slug}`);
    if (row && video.title) {
      row.dataset.title = video.title;
      applyRowState(row);
    }
    setCurrentDisplay(base, `${video.title} (${video.id})`);
    logLine(`${video.title} — ${video.models.join(', ') || 'no model listed'}, ${format.label}${format.clean ? ', no watermark' : ', watermarked'}.`);

    const data = await fetchVideo(format.url);
    if (state.cancel) throw cancelledError();

    const Zip = resolveJSZip();
    if (!Zip) throw new Error('JSZip is missing (the @require did not load)');
    const zip = new Zip();
    const leaf = `${base}_${'1'.padStart(MIN_INDEX_PAD, '0')}.${inferExt(format.url, 'mp4')}`;
    zip.file(`${base}/${leaf}`, data);
    setFileDisplay('Zipping');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => {
      if (state.cancel) throw cancelledError();
      setProgress(90 + Math.round(((meta && meta.percent) || 0) * 0.08));
    });
    if (state.cancel) throw cancelledError();

    const archiveName = sanitizeDownloadPathForSave(`${ROOT_FOLDER}/${modelFolderFor(video)}/${base}.zip`);
    setFileDisplay('Saving');
    await saveBlob(blob, archiveName);
    markHad(slug, video.id);
    setProgress(100);
    setFileDisplay(formatBytes(blob.size));
    logLine(`Saved ${archiveName}.`);
    renderFooter();
    refreshResultRows();
    scheduleCardRefresh();
  }

  // ===========================================================================
  // NAMING
  // ===========================================================================

  function modelsFor(video) {
    return video.models.length > COLLAB_MAX_MODELS ? [] : video.models;
  }

  function modelFolderFor(video) {
    if (!video.models.length) return UNTAGGED_FOLDER;
    if (video.models.length > COLLAB_MAX_MODELS) return MULTI_MODEL_FOLDER;
    return sanitizeNamePart(video.models.join(MODEL_JOIN)) || UNTAGGED_FOLDER;
  }

  // <yymmdd>-<model> - <title>. " - " is the one boundary between the prefix and
  // the title, so both halves are scrubbed of it.
  function archiveBaseName(video) {
    const model = modelNamePart(video);
    const prefix = model ? `${dateKey(video.date)}-${model}` : dateKey(video.date);
    return `${prefix} - ${videoTitlePart(video)}`;
  }

  function modelNamePart(video) {
    const models = modelsFor(video);
    if (!models.length) return '';
    return sanitizeNamePart(models.join(MODEL_JOIN))
      .replace(/\s+-\s+/g, ' ')
      .replace(/^[\s-]+/, '')
      .replace(/[\s-]+$/, '');
  }

  function videoTitlePart(video) {
    const full = sanitizeNamePart(video.title).replace(/\s*([,!?])\s*/g, '$1 ').trim();
    const headless = stripBoilerplateHead(full) || full;
    const withoutModel = stripModelPrefix(headless, video.models) || headless;
    const trimmed = stripBoilerplate(withoutModel) || withoutModel;
    const capped = trimmed
      .replace(/\s+-\s+/g, ' ')
      .slice(0, MAX_TITLE_CHARS)
      .replace(/^[\s-]+/, '')
      .replace(/[\s-]+$/, '');
    return capped || `video_${video.id || video.slug}`;
  }

  // Word by word, each compared on its letters and digits, so "Erna O'Hara"
  // matches "Erna Ohara" and "Frances Bentley's" counts as her name.
  function stripModelPrefix(title, models) {
    const words = String(title || '').split(/\s+/).filter(Boolean);
    const bare = word => word.toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (const model of models || []) {
      const modelWords = String(model || '').split(/\s+/).filter(Boolean);
      if (!modelWords.length || modelWords.length >= words.length) continue;
      const matches = modelWords.every((word, i) => {
        const want = bare(word);
        const got = bare(words[i]);
        if (!want) return false;
        if (got === want) return true;
        return i === modelWords.length - 1 && /['\u2019]s$/i.test(words[i]) && got === `${want}s`;
      });
      if (!matches) continue;
      const text = words.slice(modelWords.length).join(' ');
      if (!text) continue;
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    return '';
  }

  // "... Onlyfans 4K PPV Video Leaked" off the end. The site cuts long titles
  // mid-word ("... PPV Video Lea"), so the very last word also goes when it is
  // the start of one of those words.
  function stripBoilerplate(title) {
    const words = String(title || '').split(/\s+/).filter(Boolean);
    const bare = word => word.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const last = words.length ? bare(words[words.length - 1]) : '';
    if (words.length > 1 && last.length >= 2 && !TITLE_TAIL_WORDS.has(last)
      && Array.from(TITLE_TAIL_WORDS).some(word => word.length > last.length && word.startsWith(last))) words.pop();
    while (words.length > 1 && (TITLE_TAIL_WORDS.has(bare(words[words.length - 1])) || !bare(words[words.length - 1]))) words.pop();
    return capitalize(words.join(' '));
  }

  // "Watch ..." and "Leaked ..." off the front, before her name is looked for.
  function stripBoilerplateHead(title) {
    const words = String(title || '').split(/\s+/).filter(Boolean);
    const bare = word => word.toLowerCase().replace(/[^a-z0-9]+/g, '');
    while (words.length > 1 && TITLE_HEAD_WORDS.has(bare(words[0]))) words.shift();
    return capitalize(words.join(' '));
  }

  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function titleFromSlug(slug) {
    const words = String(slug || '').split('-').filter(Boolean);
    if (!words.length) return '';
    return sanitizeNamePart(words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '));
  }

  function dateKey(raw) {
    const match = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '000000';
    return `${match[1].slice(2)}${match[2]}${match[3]}`;
  }

  function tidySpaces(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeNamePart(raw) {
    let s = String(raw || '').normalize('NFC');
    s = s.replace(/\uFFFD/g, '').replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/[\\/:*?"<>|]+/g, '').replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function sanitizeFileNameStrict(raw, fallback) {
    const s = sanitizeNamePart(raw)
      .replace(/[^A-Za-z0-9._ -]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return s || fallback || 'download';
  }

  function sanitizeDownloadPathForSave(rawPath) {
    const parts = String(rawPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return (parts.length ? parts : ['shareanynudes_video.zip'])
      .map((part, idx) => sanitizeFileNameStrict(part, idx === parts.length - 1 ? 'video.zip' : 'folder'))
      .join('/');
  }

  function inferExt(raw, fallback) {
    const match = String(raw || '').split(/[?#]/)[0].replace(/\/+$/, '').match(/\.([A-Za-z0-9]{2,5})$/);
    const ext = match ? match[1].toLowerCase() : '';
    return /^(?:mp4|m4v|webm|mov)$/.test(ext) ? ext : (fallback || 'mp4');
  }

  // ===========================================================================
  // NETWORK
  // ===========================================================================

  function resolveJSZip() {
    try { if (typeof JSZip === 'function') return JSZip; } catch {}
    try { if (typeof window.JSZip === 'function') return window.JSZip; } catch {}
    return null;
  }

  async function withRetry(run, label) {
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (state.cancel) throw cancelledError();
      try {
        return await run();
      } catch (err) {
        if (isCancelledError(err) || state.cancel) throw cancelledError();
        lastErr = err;
        if (err && err.status && err.status >= 400 && err.status < 500 && err.status !== 429) break;
        if (attempt < MAX_RETRIES) {
          logLine(`${label} failed (${errorMessage(err)}); trying again.`);
          await delay(1500 * (attempt + 1));
        }
      }
    }
    throw lastErr || new Error(`${label} failed`);
  }

  function withDeadline(label, ms, run) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let abort = null;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        state.aborters.delete(cancel);
        if (err) reject(err);
        else resolve(value);
      };
      const cancel = () => {
        try { if (abort) abort(); } catch {}
        finish(cancelledError());
      };
      const timer = setTimeout(() => {
        try { if (abort) abort(); } catch {}
        finish(new Error(`${label} timed out`));
      }, ms);
      state.aborters.add(cancel);
      try {
        abort = run(value => finish(null, value), err => finish(err));
      } catch (err) {
        finish(err);
      }
      if (state.cancel) cancel();
    });
  }

  function httpStatusError(status) {
    const err = new Error(`HTTP ${status}`);
    err.status = status;
    return err;
  }

  // Pages are same-origin, so a plain fetch with your cookies is enough — and
  // it means a logged-in or premium account sees what it would see in the tab.
  function httpText(url) {
    return withRetry(() => withDeadline('page request', PAGE_TIMEOUT_MS, (ok, fail) => {
      const controller = new AbortController();
      fetch(url, { credentials: 'include', signal: controller.signal, headers: { Accept: 'text/html,*/*' } })
        .then(res => {
          if (!res.ok) throw httpStatusError(res.status);
          return res.text();
        })
        .then(ok, fail);
      return () => controller.abort();
    }), 'Page');
  }

  // The file itself lives on the storage host behind a redirect with no CORS
  // headers, so it has to come through the userscript manager.
  function fetchVideo(url) {
    if (!hasGmRequest()) return Promise.reject(new Error('this userscript manager has no GM_xmlhttpRequest'));
    return withRetry(() => withDeadline('video download', VIDEO_TIMEOUT_MS, (ok, fail) => {
      const started = Date.now();
      const handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        responseType: 'arraybuffer',
        headers: { Referer: `${ORIGIN}/` },
        timeout: VIDEO_TIMEOUT_MS,
        onprogress: event => {
          const loaded = Number(event && event.loaded) || 0;
          const total = Number(event && event.total) || 0;
          if (total > 0) {
            setProgress(Math.round((loaded / total) * 88));
            setFileDisplay(`${formatBytes(loaded)} of ${formatBytes(total)}`, rateText(loaded, started));
          } else if (loaded) {
            setFileDisplay(formatBytes(loaded), rateText(loaded, started));
          }
        },
        onload: res => {
          if (res.status < 200 || res.status >= 300) { fail(httpStatusError(res.status)); return; }
          const body = res.response;
          if (body && typeof body.byteLength === 'number' && body.byteLength) ok(body);
          else if (body && typeof body.arrayBuffer === 'function') body.arrayBuffer().then(ok, fail);
          else fail(new Error('empty response'));
        },
        onerror: () => fail(new Error('network error')),
        ontimeout: () => fail(new Error('request timeout'))
      });
      return handle && typeof handle.abort === 'function' ? () => handle.abort() : null;
    }), 'Video');
  }

  function rateText(loaded, started) {
    const seconds = Math.max(0.5, (Date.now() - started) / 1000);
    return `${formatBytes(loaded / seconds)}/s`;
  }

  function hasGmRequest() {
    try { return typeof GM_xmlhttpRequest === 'function'; } catch { return false; }
  }

  // GM_download is absent or a silent no-op in some managers, so it gets a
  // deadline and the plain browser save picks up whatever it drops.
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
          if (isCancelledError(err) || state.cancel) throw cancelledError();
          logLine(`GM_download did not complete (${errorMessage(err)}); saving via the browser instead.`);
        }
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name.split('/').pop() || 'shareanynudes_video.zip';
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  // ===========================================================================
  // PANEL PLUMBING
  // ===========================================================================

  function setBusy(busy) {
    state.busy = busy;
    if (!busy) {
      state.cancel = false;
      state.currentJobKey = '';
    }
    if (ui.progress) ui.progress.hidden = !busy;
    if (ui.live) ui.live.hidden = !busy;
    if (ui.stop) {
      ui.stop.hidden = !busy;
      ui.stop.disabled = !busy;
    }
    if (ui.clearDownloads) ui.clearDownloads.disabled = busy;
    refreshResultRows();
    if (!busy) pumpQueue();
  }

  function requestStop() {
    if (!state.busy && !state.queue.length) return;
    state.queue.length = 0;
    refreshResultRows();
    if (!state.busy) return;
    state.cancel = true;
    Array.from(state.aborters).forEach(abort => {
      try { abort(); } catch {}
    });
    setProgress(0);
    logLine('Stopped.');
  }

  function setProgress(percent) {
    const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
    if (ui.fill) ui.fill.style.width = `${value}%`;
  }

  function resetLog() {
    setProgress(0);
    setModelDisplay('None');
    setVideosDisplay('0/0');
    setCurrentDisplay('None');
    setFileDisplay('None');
    if (ui.log) ui.log.textContent = '';
  }

  function logLine(text) {
    if (!ui.log) return;
    const line = document.createElement('div');
    line.textContent = text;
    ui.log.appendChild(line);
    ui.log.scrollTop = ui.log.scrollHeight;
    while (ui.log.childElementCount > 300) ui.log.removeChild(ui.log.firstElementChild);
  }

  function setDisplay(node, text, title) {
    if (!node) return;
    node.textContent = String(text || '');
    node.title = String(title || text || '');
  }

  function setModelDisplay(text, title) { setDisplay(ui.model, text, title); }
  function setVideosDisplay(text, title) { setDisplay(ui.videos, text, title); }
  function setCurrentDisplay(text, title) { setDisplay(ui.current, text, title); }
  function setFileDisplay(text, title) { setDisplay(ui.file, text, title); }

  function cancelledError() {
    return new Error('cancelled');
  }

  function isCancelledError(err) {
    return errorMessage(err) === 'cancelled';
  }

  function delay(ms) {
    if (state.cancel) return Promise.reject(cancelledError());
    return withDeadline('wait', ms + 1000, ok => {
      const timer = setTimeout(ok, ms);
      return () => clearTimeout(timer);
    });
  }

  function errorMessage(err) {
    if (!err) return 'unknown error';
    return String(err.message || err);
  }

  // For testing from a console: the naming and parsing, with no side effects.
  window.__shareAnyNudesStripper = { readFlashvars, archiveBaseName, modelFolderFor, targetFromUrl, stripBoilerplate };

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
