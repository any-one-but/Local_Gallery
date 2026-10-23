// ==UserScript==
// @name         Pornhub Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.00
// @description  Pornhub creator downloader. Drop a model, pornstar, channel or user link to download every free video she has, each in its own folder, named by creator and date.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/Pornhub_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/Pornhub_Stripper.user.js
// @match        *://pornhub.com/*
// @match        *://*.pornhub.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @connect      pornhub.com
// @connect      *.pornhub.com
// @connect      phncdn.com
// @connect      *.phncdn.com
// @run-at       document-start
// ==/UserScript==

// ===========================================================================
// WHAT THIS IS
// ===========================================================================
// The OnlyHaven Stripper, rebuilt for Pornhub. Same panel, same queue, same
// job: drop a creator and take her whole library in one go. What changes is
// that the unit is a video, and a video is one file, so there is no zip: each
// one lands in a folder of its own, already the shape a Set is in the gallery:
//
//   Pornhub/<Creator>/<YYMMDD>-<Creator>-<000001> - <title>/
//     <same name>_000001.mp4
//
// The six-digit number is the video's place in her list, oldest first, and it
// is kept: the first read numbers her videos, and every later read only adds
// the new ones at the end. So a number means the same video on every run, even
// after an older video is taken down. The date is the day the site says it was
// uploaded (UTC), and the title is the video's own.
//
// Where her videos are listed depends on what she is:
//
//   /model/<slug>/videos              a verified model's uploads
//   /pornstar/<slug>/videos/upload    a pornstar's own uploads, or when she has
//   /pornstar/<slug>/videos           none, every video she is tagged in
//   /channels/<slug>/videos           a studio channel
//   /users/<slug>/videos/public       anyone else
//
// Each list is 40 or so videos a page (`?page=2` and on), newest first. Each video's own page
// carries the player's settings, and in them a `get_media` link that answers
// with the plain MP4 files the player can choose between. The tallest one is
// taken: 1080p for anyone, more if your account gets more. That file link is
// tied to your connection and lasts a couple of hours, so it is asked for
// right before each video is saved, never ahead of time.
//
// Not taken: paid videos (their page has no player until bought; they are
// noted and left out of her count), photos, GIFs and playlists. A video the
// site has taken down is noted the same way.
//
// ---------------------------------------------------------------------------
// THE PANEL
// ---------------------------------------------------------------------------
// Drop a creator link, or a video link (it resolves to whoever uploaded it). A
// row appears with her name and how much of her you have, counts down five
// seconds and adds itself to the queue. Press Download to go now, × to drop
// it. Drop into a collapsed panel and it goes straight in. While a run is
// going the other rows say Add to queue and start one after another.
//
// A video is downloaded or it is not. Already-had videos are skipped, so
// dropping a creator again later takes only what is new.
//
// ---------------------------------------------------------------------------
// HIDING IS HAVING
// ---------------------------------------------------------------------------
// On the site itself, a video you have is gone from every grid, and so is a
// creator every one of whose videos you have. The eye in the title bar shows
// them again. A creator is only judged once she has been read (dropped or
// downloaded at least once) — until then nothing knows how many videos she has.
//
// "Check all" is for a library saved before this script existed, or on another
// machine. Pick your Pornhub folder: for every creator the script knows, what
// is in that folder becomes the record of what you have. Creators it has never
// read are listed so you can drop them once and check again.
// ===========================================================================

(function () {
  'use strict';

  if (!/(?:^|\.)pornhub\.com$/i.test(location.hostname)) return;
  if (window.top !== window.self) return;
  if (window.__pornhubStripperLoaded) return;
  window.__pornhubStripperLoaded = true;

  // ===========================================================================
  // CONFIG
  // ===========================================================================

  const ORIGIN = location.origin;

  const MAX_PAGES = 400;

  // Unhurried on purpose: a bulk run is meant to be left alone, not raced, and
  // the site answers 429 when pushed.
  const PAGE_DELAY_MS = 600;     // between listing pages
  const VIDEO_DELAY_MS = 800;    // between videos in a run

  const MAX_RETRIES = 3;
  const PAGE_TIMEOUT_MS = 45000;
  const VIDEO_TIMEOUT_MS = 3 * 3600000;
  const SAVE_TIMEOUT_MS = 20000;

  // Everything lands under one folder in your downloads directory.
  const ROOT_FOLDER = 'Pornhub';
  const NAME_CHARS = 40;

  // How long a dropped creator sits in the list before it adds itself.
  const AUTO_START_MS = 5000;
  // How long the collapsed panel's header says what it just took.
  const COLLAPSED_CUE_MS = 2200;

  // The only two answers that mean a video will never be there again.
  const MEDIA_GONE_STATUSES = new Set([404, 410]);

  // Where a list page keeps its videos. Every other list on the page (the
  // header's hottest and recommended, a profile's paid shelf, a preview strip
  // of five) has a different id.
  const LIST_SELECTOR = ['#moreData', '#mostRecentVideosSection', '#showAllChanelVideos']
    .map(id => `${id} li[data-video-vkey]`).join(', ');

  // The site accent: Pornhub's orange (#ff9000), warmed a step so it sits on
  // the dark panel rather than glowing off it.
  const ACCENT = '#f39a2b';
  const ACCENT_DEEP = '#c9761a';
  const ACCENT_RGB = '243, 154, 43';
  const acc = alpha => `rgba(${ACCENT_RGB}, ${alpha})`;

  const KEYS = {
    creators: 'ph:creators',
    downloaded: 'ph:dl:',
    unavailable: 'ph:na:'
  };
  const PANEL_POS_KEY = 'PornhubStripper.panelpos.v1';
  const PANEL_ID = 'pornhubStripperPanel';

  // ===========================================================================

  const state = {
    busy: false,
    cancel: false,
    checking: false,
    aborters: new Set(),
    transport: '',
    hidden: true,
    queue: [],
    currentJobKey: ''
  };

  const ui = {};
  const styleEls = [];
  let cardHideStyleEl = null;
  let COLLAPSED_CUE_TIMER = 0;

  // --- storage --------------------------------------------------------------
  //
  // The extension's own storage, so the record survives the site's data being
  // cleared and is shared by every Pornhub tab. localStorage stands in where a
  // manager does not provide it.

  function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(key, null);
        if (v == null) return fallback;
        return typeof v === 'string' ? JSON.parse(v) : v;
      }
    } catch {}
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  }

  function gmSet(key, value) {
    const text = JSON.stringify(value);
    try { if (typeof GM_setValue === 'function') { GM_setValue(key, text); return; } } catch {}
    try { localStorage.setItem(key, text); } catch {}
  }

  function gmDelete(key) {
    try { if (typeof GM_deleteValue === 'function') { GM_deleteValue(key); return; } } catch {}
    try { localStorage.removeItem(key); } catch {}
  }

  function gmKeys(prefix) {
    try {
      if (typeof GM_listValues === 'function') return GM_listValues().filter(k => String(k).startsWith(prefix));
    } catch {}
    try { return Object.keys(localStorage).filter(k => k.startsWith(prefix)); } catch { return []; }
  }

  // --- the record -----------------------------------------------------------
  //
  // Per creator, written whenever she is read: who she is, and her videos in
  // numbered order (`postIds[0]` is video 000001), with the date each was named
  // with once it has been read.
  //
  //   { key, kind, slug, name, postIds: [], postDates: { vkey: YYMMDD }, readAt }
  //
  // Downloads are a separate list of video keys per creator, written only once
  // a file has actually been saved. Videos that cannot be had (paid, taken
  // down) are a third, with the reason, and count for nothing.

  let creatorsCache = null;
  const downloadedCache = new Map();
  const unavailableCache = new Map();
  const figuresCache = new Map();
  let allHadCache = null;

  function creatorKey(kind, slug) {
    return `${String(kind || '').toLowerCase()}:${String(slug || '').toLowerCase()}`;
  }

  function loadCreators() {
    if (!creatorsCache) {
      const v = gmGet(KEYS.creators, {});
      creatorsCache = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    return creatorsCache;
  }

  function creatorRecord(key) {
    return loadCreators()[key] || null;
  }

  function saveCreatorRecord(rec) {
    const all = loadCreators();
    all[rec.key] = Object.assign({}, all[rec.key] || {}, rec);
    gmSet(KEYS.creators, all);
    figuresCache.delete(rec.key);
  }

  function idSet(cache, prefix, key) {
    if (!cache.has(key)) {
      const v = gmGet(prefix + key, []);
      cache.set(key, new Set(Array.isArray(v) ? v.map(String) : []));
    }
    return cache.get(key);
  }

  function writeIdSet(cache, prefix, key, set) {
    cache.set(key, set);
    if (set.size) gmSet(prefix + key, [...set]);
    else gmDelete(prefix + key);
    figuresCache.delete(key);
    allHadCache = null;
  }

  function downloadedSet(key) { return idSet(downloadedCache, KEYS.downloaded, key); }

  function postIsHad(key, vkey) {
    return !!(key && vkey != null && downloadedSet(key).has(String(vkey)));
  }

  function markPostDownloaded(key, vkey) {
    const had = downloadedSet(key);
    had.add(String(vkey));
    writeIdSet(downloadedCache, KEYS.downloaded, key, had);
  }

  // A video card on the site does not say whose it is, so a card is judged
  // against everything you have from anyone.
  function allHadVkeys() {
    if (!allHadCache) {
      allHadCache = new Set();
      gmKeys(KEYS.downloaded).forEach(storeKey => {
        downloadedSet(storeKey.slice(KEYS.downloaded.length)).forEach(v => allHadCache.add(v));
      });
    }
    return allHadCache;
  }

  function unavailableMap(key) {
    if (!unavailableCache.has(key)) {
      const v = gmGet(KEYS.unavailable + key, {});
      unavailableCache.set(key, v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    }
    return unavailableCache.get(key);
  }

  function markUnavailable(key, vkey, reason) {
    const map = unavailableMap(key);
    map[String(vkey)] = String(reason || 'unavailable');
    gmSet(KEYS.unavailable + key, map);
    figuresCache.delete(key);
  }

  function isUnavailable(key, vkey) {
    return Object.prototype.hasOwnProperty.call(unavailableMap(key), String(vkey));
  }

  // What you have of her, counted on her videos as last read, leaving out the
  // ones nobody can have.
  function creatorFigures(key) {
    if (figuresCache.has(key)) return figuresCache.get(key);
    const rec = creatorRecord(key);
    let out = null;
    if (rec && Array.isArray(rec.postIds)) {
      const had = downloadedSet(key);
      const ids = rec.postIds.filter(id => had.has(String(id)) || !isUnavailable(key, id));
      const have = ids.filter(id => had.has(String(id))).length;
      const total = ids.length;
      out = { have, total, done: total > 0 && have >= total };
    }
    figuresCache.set(key, out);
    return out;
  }

  function creatorIsHad(key) {
    const f = creatorFigures(key);
    return !!(f && f.done);
  }

  function forgetAllFigures() {
    figuresCache.clear();
    allHadCache = null;
  }

  // --- the site's addresses -------------------------------------------------
  //
  // Creators live at /model/<slug>, /pornstar/<slug>, /channels/<slug> and
  // /users/<slug>, with anything after that being one of her tabs. Videos live
  // at /view_video.php?viewkey=<vkey>.

  const CREATOR_KINDS = ['model', 'pornstar', 'channels', 'users'];

  function isSiteHost(hostname) {
    return /(?:^|\.)pornhub\.com$/i.test(String(hostname || ''));
  }

  function targetFromUrl(raw, baseUrl) {
    const value = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!value || /^javascript:/i.test(value)) return null;
    let url;
    try { url = new URL(value, baseUrl || ORIGIN); } catch { return null; }
    if (!isSiteHost(url.hostname)) return null;
    if (/^\/view_video\.php$/i.test(url.pathname)) {
      const vkey = String(url.searchParams.get('viewkey') || '').trim();
      return /^[a-z0-9]+$/i.test(vkey) ? { kind: 'video', vkey } : null;
    }
    const m = url.pathname.match(/^\/(model|pornstar|channels|users)\/([^/?#]+)/i);
    if (!m) return null;
    const kind = m[1].toLowerCase();
    const slug = decodeURIComponent(m[2]).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(slug)) return null;
    return { kind, slug, key: creatorKey(kind, slug) };
  }

  function targetsFromText(text) {
    const seen = new Set();
    const targets = [];
    // `#`-prefixed lines are uri-list comments, not URLs.
    String(text || '').split(/[\s"'<>]+/).forEach(token => {
      if (!token || token.charAt(0) === '#') return;
      const target = targetFromUrl(token, ORIGIN);
      if (!target) return;
      const k = target.kind === 'video' ? `video:${target.vkey}` : target.key;
      if (seen.has(k)) return;
      seen.add(k);
      targets.push(target);
    });
    return targets;
  }

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

  function locationCreatorKey() {
    const t = targetFromUrl(location.href, ORIGIN);
    return t && t.key ? t.key : '';
  }

  // --- hiding what you already have -----------------------------------------
  //
  // A class on the card, with the rule in its own stylesheet, so the eye is one
  // `disabled` flip. A video card is the site's own `li[data-video-vkey]`. A
  // creator card is found by structure: climb from the link while the parent
  // still offers just this one creator.

  const CARD_CLIMB_LIMIT = 5;
  const CARD_CLIMB_STOP = 'body, main, header, footer, nav, ul, ol';
  // Never hidden: the panel, the site's chrome, and a creator named as part of
  // something else (a video's uploader, the pornstars under a player).
  const CARD_SKIP_WITHIN = `#${PANEL_ID}, header, footer, nav, #headerContainer, .userInfoBlock, .video-info-row, `
    + '.pornstarsWrapper, .usernameWrap, li[data-video-vkey], .videoUploaderBlock';

  function linkCreatorTarget(anchor) {
    try { if (anchor.closest(CARD_SKIP_WITHIN)) return null; } catch {}
    const target = targetFromUrl(anchor.getAttribute('href'), location.href);
    return target && target.key ? target : null;
  }

  function distinctCreatorCount(node) {
    const keys = new Set();
    node.querySelectorAll('a[href]').forEach(a => {
      const t = targetFromUrl(a.getAttribute('href'), location.href);
      if (t) keys.add(t.key || `video:${t.vkey}`);
    });
    return keys.size;
  }

  function cardForAnchor(anchor) {
    let card = anchor;
    let node = anchor;
    for (let i = 0; i < CARD_CLIMB_LIMIT; i++) {
      const parent = node.parentElement;
      if (!parent || parent === document.body) break;
      try { if (parent.matches(CARD_CLIMB_STOP)) break; } catch {}
      if (distinctCreatorCount(parent) > 1) break;
      card = parent;
      node = parent;
    }
    return card;
  }

  // Anything already coming is taken off the site too: the creator whose run
  // is going or waiting, and the videos of hers that are known.
  function creatorKeysInFlight() {
    const keys = new Set();
    state.queue.forEach(job => { if (job && job.key) keys.add(job.key); });
    if (state.currentJobKey) keys.add(state.currentJobKey);
    return keys;
  }

  function vkeysInFlight(creatorKeys) {
    const out = new Set();
    creatorKeys.forEach(key => {
      const rec = creatorRecord(key);
      if (rec && Array.isArray(rec.postIds)) rec.postIds.forEach(id => out.add(String(id)));
    });
    return out;
  }

  function refreshHiddenCards() {
    if (!document.body) return;
    const inFlight = creatorKeysInFlight();
    const inFlightVideos = vkeysInFlight(inFlight);
    const hadVideos = allHadVkeys();
    // The creator whose page you are on is never hidden from her own page: the
    // link to her there is the way back, not an offer.
    const here = locationCreatorKey();
    Array.from(document.querySelectorAll('.phsGot, .phsInFlight')).forEach(el => {
      el.classList.remove('phsGot', 'phsInFlight');
    });
    Array.from(document.querySelectorAll('li[data-video-vkey]')).forEach(card => {
      if (card.closest(`#${PANEL_ID}`)) return;
      const vkey = String(card.getAttribute('data-video-vkey') || '');
      if (!vkey) return;
      if (hadVideos.has(vkey)) card.classList.add('phsGot');
      else if (inFlightVideos.has(vkey)) card.classList.add('phsInFlight');
    });
    Array.from(document.querySelectorAll('a[href]')).forEach(anchor => {
      const target = linkCreatorTarget(anchor);
      if (!target || target.key === here) return;
      const had = creatorIsHad(target.key);
      const coming = !had && inFlight.has(target.key);
      if (!had && !coming) return;
      cardForAnchor(anchor).classList.add(had ? 'phsGot' : 'phsInFlight');
    });
    updateEyeButton();
  }

  let cardRefreshTimer = 0;
  function scheduleCardRefresh() {
    clearTimeout(cardRefreshTimer);
    cardRefreshTimer = setTimeout(refreshHiddenCards, 120);
  }

  function installPageObserver() {
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && !(ui.panel && ui.panel.contains(node))) {
            scheduleCardRefresh();
            return;
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // --- styles ---------------------------------------------------------------
  //
  // The panel and its stylesheets hang off the <html> element itself, so they
  // exist before the page has a body, and are put back if anything ever
  // removes them.

  function addStyleEl(id, css) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.documentElement.appendChild(style);
    styleEls.push(style);
    return style;
  }

  function keepAttached() {
    styleEls.forEach(el => { if (!el.isConnected) document.documentElement.appendChild(el); });
    if (ui.panel && !ui.panel.isConnected) document.documentElement.appendChild(ui.panel);
  }

  function applyCardHideStyle() {
    cardHideStyleEl = addStyleEl('pornhubStripperCardRules', '.phsGot { display: none !important; }');
    // In-flight is said on screen (the queue), so the eye — which exists to
    // show what you have — does not hand it back.
    addStyleEl('pornhubStripperFilterRules', '.phsInFlight { display: none !important; }');
  }

  function injectStyle() {
    const P = `#${PANEL_ID}`;
    addStyleEl('pornhubStripperStyle', `
      ${P}{position:fixed;right:16px;top:16px;z-index:2147483646;width:360px;max-height:92vh;
        display:flex;flex-direction:column;border:1px solid ${acc(0.4)};border-radius:10px;box-sizing:border-box;
        background:#141210;color:#f2ece1;box-shadow:0 18px 60px rgba(0,0,0,.6);font:700 12px/1.35 Arial,sans-serif;
        overflow:hidden;text-align:left;letter-spacing:normal;text-transform:none}
      ${P} *{box-sizing:border-box;font-family:Arial,sans-serif}
      ${P} [hidden]{display:none!important}
      ${P}.phs-collapsed{height:auto;max-height:none}
      ${P}.phs-collapsed .phs-body{display:none}
      ${P}.phs-tookIt .phs-head{background:linear-gradient(90deg,#4a3418,#1a1613)}
      ${P}.phs-tookIt .phs-title{color:#ffe3bd}
      ${P} .phs-head{height:38px;flex:0 0 38px;display:flex;align-items:center;gap:6px;padding:0 10px;
        touch-action:none;user-select:none;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#33261a,#1a1613);cursor:grab}
      ${P}.phs-dragging-panel .phs-head{cursor:grabbing}
      ${P} .phs-title{font-weight:900;font-size:12px;color:${ACCENT};flex:1 1 auto;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      ${P} .phs-iconBtn{flex:0 0 auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px;font-size:13px}
      ${P} .phs-body{flex:1 1 auto;display:flex;flex-direction:column;gap:12px;padding:10px;min-height:0;overflow:hidden}
      ${P} button{appearance:none;width:100%;min-height:32px;margin:0;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#f2ece1;font:700 12px/1 Arial,sans-serif;cursor:pointer;
        text-transform:none;letter-spacing:normal;box-shadow:none}
      ${P} button:hover:not(:disabled){background:${acc(0.2)};border-color:${acc(0.55)}}
      ${P} button:disabled{opacity:.42;cursor:default}

      ${P} .phs-drop{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-height:52px;padding:8px 10px;
        border:1px dashed ${acc(0.45)};border-radius:8px;background:${acc(0.06)};
        color:#b3a58c;font-weight:700;text-align:center}
      ${P}.phs-dragging .phs-drop{border-color:${ACCENT};border-style:solid;background:${acc(0.22)};color:#fff}

      ${P} .phs-resultsWrap{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
      ${P} .phs-summary{flex:0 0 auto;min-height:18px;color:#bdb1a0;font-weight:700;line-height:1.4}
      ${P} .phs-results{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding-right:2px}
      ${P} .phs-results:empty{display:none}
      ${P} .phs-result{flex:0 0 auto;position:relative;overflow:hidden;
        display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;align-items:center;
        padding:7px 8px;border-radius:8px;background:rgba(255,255,255,.05)}
      ${P} .phs-rowName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#f2ece1;font-weight:900;font-size:12px}
      ${P} .phs-rowCount{flex:0 0 auto;color:#a99b87;font-weight:900;font-size:11px;
        font-variant-numeric:tabular-nums;letter-spacing:.02em}
      ${P} .phs-rowCountDone{color:#8fd49b}
      ${P} .phs-result button{width:auto;min-height:24px;padding:0 9px;border-radius:6px;font-size:10px}
      ${P} .phs-rowX{width:24px!important;min-width:24px;padding:0!important;font-size:13px!important;line-height:1;color:#c0b09a}
      ${P} .phs-rowX:hover:not(:disabled){background:rgba(224,138,138,.22);border-color:rgba(224,138,138,.5);color:#ffd9d9}
      ${P} .phs-rowTimer{position:absolute;left:0;right:0;bottom:0;height:2px;pointer-events:none}
      ${P} .phs-rowTimer i{display:block;height:2px;width:100%;background:${ACCENT};transform:scaleX(0);transform-origin:left center}
      ${P} .phs-resultHidden{opacity:.62}

      ${P} .phs-progress{display:block;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      ${P} .phs-fill{display:block;height:10px;min-height:10px;width:0;
        background:linear-gradient(90deg,${ACCENT_DEEP},${ACCENT});transition:width 120ms ease}
      ${P} .phs-live{flex:0 0 auto;display:flex;flex-direction:column;gap:5px}
      ${P} .phs-line{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;align-items:baseline}
      ${P} .phs-line span{color:#857a68;font-weight:900;text-transform:uppercase;font-size:10px}
      ${P} .phs-line strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee5d5;font-size:12px;font-weight:900}
      ${P} .phs-stop{flex:0 0 auto;background:#4a3323!important;color:#ffeccf!important;border-color:${acc(0.6)}!important}
      ${P} .phs-log{flex:0 0 auto;max-height:72px;overflow:auto;color:#a99b87;font:700 11px/1.35 Arial,sans-serif;
        white-space:pre-wrap;word-break:break-word}
      ${P} .phs-log:empty{display:none}

      ${P} .phs-foot{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid ${acc(0.16)}}
      ${P} .phs-stats{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bdb1a0;font-weight:700;font-size:11px}
      ${P} .phs-footBtns{display:flex;flex-wrap:wrap;gap:6px}
      ${P} .phs-footBtn{width:auto;flex:1 1 auto;min-height:28px;border-radius:7px;font-size:11px}
      ${P} .phs-footNote{color:#bdb1a0;font-weight:700;font-size:11px;line-height:1.35;white-space:pre-wrap}

      @media (max-width:700px){
        ${P}{width:calc(100vw - 16px);right:8px;left:auto}
      }
    `);
  }

  // --- panel ----------------------------------------------------------------

  function init() {
    injectStyle();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="phs-head">
        <span class="phs-title">Pornhub Stripper</span>
        <button class="phs-iconBtn" data-ui="eye" type="button" title="Reveal what you already have">&#128584;</button>
        <button class="phs-iconBtn" data-ui="collapse" type="button" title="Collapse">&#9652;</button>
      </div>
      <div class="phs-body">
        <div class="phs-drop" data-ui="drop" title="Drop a model, pornstar, channel or user. A video resolves to whoever uploaded it.">Drop a creator or video link here</div>

        <div class="phs-resultsWrap">
          <div class="phs-summary" data-ui="summary" hidden></div>
          <div class="phs-results" data-ui="results"></div>
        </div>

        <div class="phs-progress" data-ui="progress" hidden><div class="phs-fill" data-ui="fill"></div></div>
        <div class="phs-live" data-ui="live" aria-live="polite" hidden>
          <div class="phs-line"><span>Creator</span><strong data-ui="creator">None</strong></div>
          <div class="phs-line"><span>Videos</span><strong data-ui="posts">0/0</strong></div>
          <div class="phs-line"><span>Current</span><strong data-ui="current">None</strong></div>
          <div class="phs-line"><span>File</span><strong data-ui="files">None</strong></div>
        </div>
        <button class="phs-stop" data-ui="stop" type="button" hidden>Stop</button>
        <div class="phs-log" data-ui="log" aria-live="polite"></div>

        <div class="phs-foot">
          <span class="phs-stats" data-ui="stats">Nothing read yet</span>
          <div class="phs-footBtns">
            <button class="phs-footBtn" data-ui="check" type="button" title="Pick your Pornhub folder. For every creator this script knows, what is in it becomes the download record.">Check all</button>
            <button class="phs-footBtn" data-ui="clearDownloads" type="button" title="Forget every download, for every creator." hidden>Clear downloads</button>
          </div>
          <div class="phs-footNote" data-ui="footNote" hidden></div>
        </div>
        <input data-ui="checkDir" type="file" webkitdirectory directory multiple hidden>
      </div>
    `;
    document.documentElement.appendChild(panel);
    ui.panel = panel;
    panel.querySelectorAll('[data-ui]').forEach(node => { ui[node.dataset.ui] = node; });

    ui.stop.addEventListener('click', requestStop);
    ui.eye.addEventListener('click', () => setHidden(!state.hidden));
    ui.results.addEventListener('click', handleRowAction);
    ui.check.addEventListener('click', () => { if (!state.busy) ui.checkDir.click(); });
    ui.checkDir.addEventListener('change', () => {
      // Copied out first: `files` is live, and clearing the value is what lets
      // the same folder be picked twice in a row.
      const picked = Array.from(ui.checkDir.files || []);
      ui.checkDir.value = '';
      checkDownloadFolder(picked).catch(err => setFootNote(`Folder check failed: ${errorMessage(err)}`));
    });
    ui.clearDownloads.addEventListener('click', resetDownloads);
    ui.collapse.addEventListener('click', () => {
      panel.classList.toggle('phs-collapsed');
      ui.collapse.innerHTML = panel.classList.contains('phs-collapsed') ? '&#9662;' : '&#9652;';
    });
    makePanelDraggable(panel, panel.querySelector('.phs-head'));
    installDropTarget(panel);

    installRouteWatch();
    window.addEventListener('beforeunload', event => {
      if (!state.busy) return;
      event.preventDefault();
      event.returnValue = '';
      return '';
    });
    setHidden(true);
    renderStats();
    syncContext();
    refreshHiddenCards();
  }

  // Most of the site loads a new page per click, but its tabs and filters
  // rewrite the address in place, so the address is watched too.
  function installRouteWatch() {
    let last = location.href;
    const onRoute = () => {
      keepAttached();
      if (location.href === last) return;
      last = location.href;
      if (!state.busy) syncContext();
      scheduleCardRefresh();
    };
    window.addEventListener('popstate', onRoute);
    setInterval(onRoute, 700);
  }

  function syncContext() {
    if (ui.drop) {
      ui.drop.textContent = targetFromUrl(location.href, ORIGIN)
        ? 'Drop another creator or video link here'
        : 'Drop a creator or video link here';
    }
    if (state.busy) return;
    setDisplay(ui.creator, 'None');
    setDisplay(ui.posts, '0/0');
    setDisplay(ui.current, 'None');
    setDisplay(ui.files, 'None');
  }

  function setHidden(hidden) {
    state.hidden = hidden !== false;
    if (cardHideStyleEl) cardHideStyleEl.disabled = !state.hidden;
    updateEyeButton();
  }

  function updateEyeButton() {
    if (!ui.eye) return;
    let count = 0;
    try { count = document.querySelectorAll('.phsGot').length; } catch {}
    ui.eye.textContent = state.hidden ? '\u{1F648}' : '\u{1F441}';
    ui.eye.title = state.hidden
      ? `Reveal what you already have${count ? ` (${count} on this page)` : ''}`
      : 'Hide it again';
  }

  function setFootNote(text) {
    if (!ui.footNote) return;
    ui.footNote.hidden = !text;
    ui.footNote.textContent = String(text || '');
  }

  // --- moving the panel -----------------------------------------------------
  //
  // Dragged by its title bar, never off the screen, and where you put it is
  // remembered for the tab.

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
    panel.classList.add('phs-dragged');
    return at;
  }

  function savePanelPosition(at) {
    try { sessionStorage.setItem(PANEL_POS_KEY, JSON.stringify({ x: Math.round(at.x), y: Math.round(at.y) })); } catch {}
  }

  function restorePanelPosition(panel) {
    try {
      const at = JSON.parse(sessionStorage.getItem(PANEL_POS_KEY) || 'null');
      if (at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y))) placePanelAt(panel, Number(at.x), Number(at.y));
    } catch {}
  }

  function makePanelDraggable(panel, handle) {
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
      panel.classList.add('phs-dragging-panel');
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
      panel.classList.remove('phs-dragging-panel');
      try { handle.releasePointerCapture(event.pointerId); } catch {}
      if (last) savePanelPosition(last);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => {
      if (!panel.classList.contains('phs-dragged')) return;
      const rect = panel.getBoundingClientRect();
      last = placePanelAt(panel, rect.left, rect.top);
      savePanelPosition(last);
    });
  }

  function installDropTarget(panel) {
    let depth = 0;
    const setDragging = on => panel.classList.toggle('phs-dragging', on);
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
      if (!targets.length) { showSummary('Nothing creator- or video-shaped in that drop.'); return; }
      addDroppedTargets(targets).catch(err => showSummary(`Could not read that link: ${errorMessage(err)}`));
    });
  }

  // --- the list, which is the queue -----------------------------------------
  //
  // It only ever grows: a drop adds to the bottom and nothing but the × takes a
  // row away. Panel open, a new row counts down and then adds itself; panel
  // collapsed, it goes straight in and the title bar says what it took.

  async function addDroppedTargets(targets) {
    showSummary(`Reading ${targets.length === 1 ? 'one link' : `${targets.length} links`}…`);
    const creators = [];
    let noUploader = 0;
    let unknown = 0;
    for (const t of targets) {
      if (t.kind !== 'video') { creators.push(t); continue; }
      try {
        const owner = await uploaderOfVideo(t.vkey);
        if (owner) creators.push(owner);
        else noUploader++;
      } catch (err) {
        if (err && MEDIA_GONE_STATUSES.has(err.httpStatus)) unknown++;
        else throw err;
      }
    }

    const listed = listedRowKeys();
    const rows = [];
    let skipped = 0;
    const seen = new Set();
    for (const t of creators) {
      let rec = creatorRecord(t.key);
      let creator = rec && rec.name ? { key: rec.key, kind: rec.kind, slug: rec.slug, name: rec.name } : null;
      if (!creator) {
        try {
          // Read once to learn her name, and where the site really keeps her:
          // a /users/ link to a verified model is sent on to /model/.
          const first = await readListPage(t, 1);
          creator = first.creator;
          saveCreatorRecord({ key: creator.key, kind: creator.kind, slug: creator.slug, name: creator.name });
        } catch (err) {
          if (err && MEDIA_GONE_STATUSES.has(err.httpStatus)) { unknown++; continue; }
          creator = { key: t.key, kind: t.kind, slug: t.slug, name: t.slug };
        }
      }
      if (seen.has(creator.key) || listed.has(creator.key)) { skipped++; continue; }
      seen.add(creator.key);
      rows.push(rowNode(creator));
    }
    if (!rows.length) {
      showSummary(skipped ? 'Already on the list.'
        : unknown ? 'The site does not know that link.'
          : noUploader ? 'That video has no uploader to follow.'
            : 'Nothing to add.');
      return;
    }
    const fragment = document.createDocumentFragment();
    rows.forEach(row => fragment.appendChild(row));
    ui.results.appendChild(fragment);
    requestAnimationFrame(() => { try { ui.results.scrollTop = ui.results.scrollHeight; } catch {} });

    if (panelIsCollapsed()) {
      rows.forEach(row => requestDownload(jobFromRow(row)));
      flashCollapsedCue(rows.map(row => row.dataset.name));
    } else {
      rows.forEach(beginRowCountdown);
    }
    showSummary(`Added ${rows.length}${skipped ? `, ${skipped} already listed` : ''}`
      + `${unknown ? `, ${unknown} not on the site` : ''}${noUploader ? `, ${noUploader} with no uploader` : ''}.`);
  }

  function showSummary(text) {
    if (!ui.summary) return;
    ui.summary.textContent = String(text || '');
    ui.summary.title = ui.summary.textContent;
    ui.summary.hidden = !ui.summary.textContent;
  }

  function listedRowKeys() {
    return new Set(Array.from(ui.results.querySelectorAll('[data-key]')).map(row => row.dataset.key));
  }

  function jobFromRow(row) {
    return { key: row.dataset.key, kind: row.dataset.kind, slug: row.dataset.slug, name: row.dataset.name };
  }

  function panelIsCollapsed() {
    return !!(ui.panel && ui.panel.classList.contains('phs-collapsed'));
  }

  const KIND_LABELS = { model: 'model', pornstar: 'pornstar', channels: 'channel', users: 'user' };

  // One line per creator: name, how much of her you have, the button that takes
  // her, and the ×. The timer bar across the foot only moves while counting down.
  function rowNode(item) {
    const row = document.createElement('div');
    row.className = 'phs-result';
    row.dataset.key = item.key;
    row.dataset.kind = item.kind;
    row.dataset.slug = item.slug;
    row.dataset.name = item.name;

    const name = document.createElement('div');
    name.className = 'phs-rowName';
    name.textContent = item.name;
    name.title = `${item.name} (${KIND_LABELS[item.kind] || item.kind})`;

    const count = document.createElement('div');
    count.className = 'phs-rowCount';

    const go = document.createElement('button');
    go.type = 'button';
    go.dataset.action = 'download';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.className = 'phs-rowX';
    remove.textContent = '×';
    remove.title = 'Take this off the list';

    const timer = document.createElement('div');
    timer.className = 'phs-rowTimer';
    timer.appendChild(document.createElement('i'));

    row.append(name, count, go, remove, timer);
    applyRowState(row);
    return row;
  }

  function applyRowState(row) {
    const f = creatorFigures(row.dataset.key);
    const count = row.querySelector('.phs-rowCount');
    if (count) {
      if (!f) {
        count.textContent = '?';
        count.title = 'Not read yet. Her videos are counted when she is downloaded.';
      } else if (!f.total) {
        count.textContent = '—';
        count.title = 'No free videos';
      } else {
        count.textContent = `${f.have}/${f.total}`;
        count.title = f.done ? `All ${f.total} videos` : `${f.have} of ${f.total} videos`;
      }
      count.classList.toggle('phs-rowCountDone', !!(f && f.done && f.total));
    }
    const go = row.querySelector('button[data-action="download"]');
    if (go) {
      const next = downloadButtonState(row.dataset.key);
      go.textContent = next.label;
      go.disabled = next.disabled;
    }
    row.classList.toggle('phs-resultHidden', !!(f && f.done));
  }

  function refreshResultRows() {
    if (!ui.results) return;
    Array.from(ui.results.querySelectorAll('[data-key]')).forEach(applyRowState);
  }

  function downloadButtonState(key) {
    if (state.currentJobKey === key) return { label: 'Downloading', disabled: true };
    if (state.queue.some(job => job.key === key)) return { label: 'In queue', disabled: true };
    if (state.busy) return { label: 'Add to queue', disabled: false };
    return { label: 'Download', disabled: false };
  }

  function handleRowAction(event) {
    const button = event.target && event.target.closest && event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('.phs-result');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.action === 'remove') { removeRow(row); return; }
    cancelRowCountdown(row);
    requestDownload(jobFromRow(row));
  }

  function beginRowCountdown(row) {
    if (!row || row.__phsTimer) return;
    const bar = row.querySelector('.phs-rowTimer i');
    if (bar) {
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(1)';
      requestAnimationFrame(() => {
        bar.style.transition = `transform ${AUTO_START_MS}ms linear`;
        bar.style.transform = 'scaleX(0)';
      });
    }
    row.__phsTimer = setTimeout(() => {
      cancelRowCountdown(row);
      if (row.isConnected) requestDownload(jobFromRow(row));
    }, AUTO_START_MS);
  }

  function cancelRowCountdown(row) {
    if (!row) return;
    if (row.__phsTimer) { clearTimeout(row.__phsTimer); row.__phsTimer = null; }
    const bar = row.querySelector('.phs-rowTimer i');
    if (bar) { bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)'; }
  }

  // The × takes her out of the waiting queue too. A run already going is left
  // alone: stopping that is what Stop is for.
  function removeRow(row) {
    cancelRowCountdown(row);
    const key = row.dataset.key;
    const before = state.queue.length;
    state.queue = state.queue.filter(job => job.key !== key);
    row.remove();
    if (state.queue.length !== before) {
      logLine(`Took ${row.dataset.name} out of the queue.`);
      refreshResultRows();
      scheduleCardRefresh();
    }
    if (!ui.results.children.length) showSummary('');
  }

  function flashCollapsedCue(names) {
    const title = ui.panel && ui.panel.querySelector('.phs-title');
    if (!title || !names.length) return;
    clearTimeout(COLLAPSED_CUE_TIMER);
    title.textContent = names.length === 1 ? `↓ ${names[0]}` : `↓ ${names.length} creators`;
    ui.panel.classList.add('phs-tookIt');
    COLLAPSED_CUE_TIMER = setTimeout(() => {
      title.textContent = 'Pornhub Stripper';
      ui.panel.classList.remove('phs-tookIt');
    }, COLLAPSED_CUE_MS);
  }

  function requestDownload(job) {
    if (!job || !job.key) return;
    if (state.currentJobKey === job.key || state.queue.some(entry => entry.key === job.key)) return;
    if (state.busy) {
      state.queue.push(job);
      logLine(`Queued ${job.name}.`);
      refreshResultRows();
      scheduleCardRefresh();
      return;
    }
    downloadCreator(job);
  }

  function pumpQueue() {
    if (state.busy || state.cancel) { refreshResultRows(); return; }
    const job = state.queue.shift();
    refreshResultRows();
    if (job) Promise.resolve().then(() => downloadCreator(job));
  }

  // --- reading a creator ------------------------------------------------------
  //
  // Her list pages are read as the site draws them. A page past the end is a
  // 404, and the last page has no Next.

  function listPath(kind, slug, variant) {
    const s = encodeURIComponent(slug);
    if (kind === 'model') return `/model/${s}/videos`;
    if (kind === 'pornstar') return variant === 'all' ? `/pornstar/${s}/videos` : `/pornstar/${s}/videos/upload`;
    if (kind === 'channels') return `/channels/${s}/videos`;
    return `/users/${s}/videos/public`;
  }

  function listUrl(kind, slug, page, variant) {
    return `${ORIGIN}${listPath(kind, slug, variant)}${page > 1 ? `?page=${page}` : ''}`;
  }

  function parseHtml(text) {
    return new DOMParser().parseFromString(String(text || ''), 'text/html');
  }

  function textOf(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('span, i, img, svg, div').forEach(el => el.remove());
    return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, lead, ch) => lead + ch.toUpperCase());
  }

  // The page's own name for her. A pornstar's is written in capitals, which is
  // the page's styling rather than her name, so it is put back in title case;
  // a user's page names itself "<name>'s Public Videos".
  function creatorNameFromDoc(doc, kind, slug) {
    let name = textOf(doc.querySelector('h1[itemprop="name"]')) || textOf(doc.querySelector('h1'));
    name = name.replace(/\s*[’']s\s+(?:public\s+)?(?:porn\s+)?videos?(?:\s+uploads?)?\s*$/i, '').trim();
    if (kind === 'pornstar' && name && name === name.toUpperCase() && /\p{Lu}/u.test(name)) name = titleCase(name);
    return name || titleCase(String(slug || '').replace(/[-_]+/g, ' '));
  }

  function videosFromDoc(doc) {
    const out = [];
    const seen = new Set();
    doc.querySelectorAll(LIST_SELECTOR).forEach(li => {
      const vkey = String(li.getAttribute('data-video-vkey') || '');
      if (!vkey || seen.has(vkey)) return;
      // A paid video in a free list opens a buy box instead of the video.
      const thumb = li.querySelector('a.linkVideoThumb, .phimage a');
      if (thumb && /^javascript:/i.test(thumb.getAttribute('href') || '')) return;
      seen.add(vkey);
      const titled = li.querySelector('a[title]');
      out.push({ vkey, title: titled ? String(titled.getAttribute('title') || '').trim() : '' });
    });
    return out;
  }

  // One list page. The address it ended on says where the site really keeps
  // her, which is what makes a dropped /users/ link and a /model/ link the
  // same creator.
  async function readListPage(target, page, variant) {
    const res = await httpText(listUrl(target.kind, target.slug, page, variant));
    const landed = targetFromUrl(res.url, ORIGIN);
    const doc = parseHtml(res.text);
    if (page === 1 && landed && landed.key && landed.key !== target.key) {
      return readListPage(landed, 1, variant);
    }
    const shown = String(doc.body ? doc.body.textContent : '').match(/Showing\s+\d+\s*-\s*\d+\s+of\s+([\d,]+)/i);
    // A user's list has a Load more button instead of page links, but answers
    // ?page= all the same; with no page links, only an empty page ends it.
    const paged = !!doc.querySelector('.pagination3');
    return {
      creator: { key: target.key, kind: target.kind, slug: target.slug, name: creatorNameFromDoc(doc, target.kind, target.slug) },
      videos: videosFromDoc(doc),
      next: !paged || !!doc.querySelector('.page_next:not(.disabled) a[href]:not([href=""])'),
      total: shown ? Number(shown[1].replace(/,/g, '')) : null
    };
  }

  // Every video in her list, newest first as the site has them.
  async function readAllVideos(target, variant) {
    const out = [];
    const seen = new Set();
    let creator = null;
    let total = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (state.cancel) throw cancelledError();
      let result;
      try {
        result = await withRetry(() => readListPage(creator || target, page, variant), 'list page');
      } catch (err) {
        if (page > 1 && err && err.httpStatus === 404) break;
        throw err;
      }
      if (!creator) creator = result.creator;
      if (result.total) total = result.total;
      let added = 0;
      result.videos.forEach(video => {
        if (seen.has(video.vkey)) return;
        seen.add(video.vkey);
        out.push(video);
        added++;
      });
      const pages = result.total ? Math.max(page, Math.ceil(result.total / Math.max(1, result.videos.length || 40))) : '?';
      setDisplay(ui.posts, `Reading page ${page}/${pages}`);
      if (!result.next || !added) break;
      await delay(PAGE_DELAY_MS);
    }
    // The site can stop paging early for someone not signed in. Said, so a
    // short count is not mistaken for all of her.
    if (total && out.length < total) {
      logLine(`The site listed ${out.length} of the ${total} it says she has. Signing in may show the rest.`);
    }
    return { creator: creator || target, videos: out };
  }

  // A pornstar's own uploads when she has any; a pornstar who uploads nothing
  // herself is every video she is tagged in.
  async function readCreator(target) {
    let read;
    try {
      read = await readAllVideos(target, 'upload');
    } catch (err) {
      if (!(target.kind === 'pornstar' && err && err.httpStatus === 404)) throw err;
      read = { creator: target, videos: [] };
    }
    if (target.kind === 'pornstar' && !read.videos.length) {
      logLine('No uploads of her own; taking every video she is tagged in.');
      read = await readAllVideos(target, 'all');
    }
    return read;
  }

  // Numbers are kept. Her videos already numbered stay where they are, even if
  // the site has since taken one down; videos new since the last read go on
  // the end, oldest first.
  function mergeVideoOrder(previous, newestFirst) {
    const ids = Array.isArray(previous) ? previous.map(String) : [];
    const known = new Set(ids);
    newestFirst.slice().reverse().forEach(video => {
      if (known.has(video.vkey)) return;
      known.add(video.vkey);
      ids.push(video.vkey);
    });
    return ids;
  }

  // Whoever uploaded a video: the profile named beside its player.
  async function uploaderOfVideo(vkey) {
    const res = await httpText(videoPageUrl(vkey));
    const doc = parseHtml(res.text);
    for (const anchor of doc.querySelectorAll('.userInfoBlock a[href], .video-info-row.userRow a[href]')) {
      const t = targetFromUrl(anchor.getAttribute('href'), ORIGIN);
      if (t && t.key) return t;
    }
    return null;
  }

  // --- reading a video --------------------------------------------------------

  function videoPageUrl(vkey) {
    return `${ORIGIN}/view_video.php?viewkey=${encodeURIComponent(vkey)}`;
  }

  // What the player is told about the video: its title, its length, and the
  // list of files it can play.
  function playerSettingsFromHtml(html) {
    const m = String(html || '').match(/var\s+flashvars_\d+\s*=\s*(\{[\s\S]*?\});\s*\n/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  function uploadDateFromHtml(html) {
    const m = String(html || '').match(/"uploadDate"\s*:\s*"([^"]+)"/);
    return m ? m[1] : '';
  }

  // The tallest plain MP4 the site offers. The player's settings name one
  // `get_media` link, which answers with every MP4 it has for the video.
  async function bestMp4For(settings, vkey) {
    const defs = Array.isArray(settings && settings.mediaDefinitions) ? settings.mediaDefinitions : [];
    let files = defs.filter(d => d && d.format === 'mp4' && d.videoUrl && !d.remote && d.quality && !Array.isArray(d.quality));
    const remote = defs.find(d => d && d.format === 'mp4' && d.videoUrl && (d.remote || Array.isArray(d.quality)));
    if (remote) {
      const listed = await httpJson(new URL(remote.videoUrl, ORIGIN).href, videoPageUrl(vkey));
      if (Array.isArray(listed)) files = files.concat(listed.filter(d => d && d.videoUrl && String(d.format || 'mp4') === 'mp4'));
    }
    if (!files.length) return null;
    const rank = d => Number(d.quality) || Math.max(Number(d.height) || 0, Number(d.width) || 0);
    return files.slice().sort((a, b) => rank(b) - rank(a))[0];
  }

  // --- naming ---------------------------------------------------------------
  //
  // Pornhub/<Creator>/<YYMMDD>-<Creator>-<000001> - <title>/<same>_000001.mp4,
  // the post Strippers' shape with the zip already unpacked.

  function creatorFolderName(creator) {
    return sanitizeNamePart(creator.name) || sanitizeNamePart(creator.slug) || `${creator.kind}_${creator.slug}`;
  }

  function creatorNameSection(creator) {
    return creatorFolderName(creator).slice(0, NAME_CHARS).trim();
  }

  function videoTitleSection(title, vkey) {
    return clipAtWord(sanitizeNamePart(title), NAME_CHARS) || `video_${vkey}`;
  }

  // Cut at the last whole word that fits, so a title does not end in half a
  // word — unless that would throw away more than half of it.
  function clipAtWord(text, max) {
    const s = String(text || '').trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max + 1);
    const space = cut.lastIndexOf(' ');
    return (space >= max / 2 ? cut.slice(0, space) : s.slice(0, max)).replace(/[\s,.;:!-]+$/, '').trim();
  }

  function videoBaseName(creator, number, dateSec, title, vkey) {
    return `${dateSec}-${creatorNameSection(creator)}-${String(number).padStart(6, '0')} - ${videoTitleSection(title, vkey)}`;
  }

  // UTC, so a late upload is named for the day the site says it went up
  // wherever you are.
  function dateKeyFromIso(iso) {
    const d = new Date(String(iso || ''));
    if (Number.isNaN(d.getTime())) return '000000';
    return String(d.getUTCFullYear() % 100).padStart(2, '0')
      + String(d.getUTCMonth() + 1).padStart(2, '0')
      + String(d.getUTCDate()).padStart(2, '0');
  }

  // Emoji go, and so does every mark a file system refuses. " - " is squeezed
  // to "-" so the one real " - " in a name is the one before the title.
  function sanitizeNamePart(s) {
    let out = String(s || '').normalize('NFC');
    out = out.replace(/�/g, '').replace(/[\uD800-\uDFFF]/g, '').replace(/[☀-➿️‍]/g, '');
    out = out.replace(/\s+/g, ' ').replace(/ - /g, '-');
    out = out.replace(/[\\/:*?"<>|~]+/g, '').replace(/[\x00-\x1F\x7F]/g, '');
    return out.replace(/ +/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  }

  // Strict keeps only plain letters, digits and simple punctuation — the
  // fallback when a browser refuses a name.
  function sanitizeSavePath(rawPath, strict) {
    const parts = String(rawPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) return 'video.mp4';
    return parts.map((seg, idx) => {
      let s = String(seg).normalize('NFC').replace(/[\uD800-\uDFFF�]/g, '').replace(/[\x00-\x1F\x7F]/g, '');
      s = strict ? s.replace(/[^A-Za-z0-9._ -]+/g, '') : s.replace(/[\\/:*?"<>|~]+/g, '');
      s = s.replace(/^[\s.]+|[\s.]+$/g, '').replace(/ +/g, ' ');
      return s || (idx === parts.length - 1 ? 'video.mp4' : 'folder');
    }).join('/');
  }

  // --- the run --------------------------------------------------------------

  async function downloadCreator(job) {
    if (state.busy) { requestDownload(job); return; }
    state.cancel = false;
    state.currentJobKey = job.key;
    setBusy(true);
    resetLog();
    const label = job.name || job.slug;
    setDisplay(ui.creator, label);
    setDisplay(ui.posts, 'Reading');
    setDisplay(ui.current, 'None');
    setDisplay(ui.files, 'None');

    try {
      logLine(`Reading ${label}.`);
      const read = await readCreator({ key: job.key, kind: job.kind, slug: job.slug });
      const creator = read.creator;
      if (creator.key !== job.key) {
        // The site keeps her somewhere else now; carry what is known across.
        state.currentJobKey = creator.key;
        logLine(`${label} lives at /${creator.kind}/${creator.slug} now.`);
      }
      const titles = new Map(read.videos.map(v => [v.vkey, v.title]));
      const rec = creatorRecord(creator.key) || {};
      const postIds = mergeVideoOrder(rec.postIds, read.videos);
      const postDates = Object.assign({}, rec.postDates || {});
      saveCreatorRecord({
        key: creator.key,
        kind: creator.kind,
        slug: creator.slug,
        name: creator.name,
        postIds,
        postDates,
        readAt: Date.now()
      });
      setDisplay(ui.creator, creator.name, `${creator.name} (${KIND_LABELS[creator.kind] || creator.kind} ${creator.slug})`);
      refreshResultRows();
      renderStats();
      const added = postIds.length - (Array.isArray(rec.postIds) ? rec.postIds.length : 0);
      logLine(`${creator.name}: ${read.videos.length} video${read.videos.length === 1 ? '' : 's'} listed`
        + `${rec.postIds && added ? `, ${added} new` : ''}.`);
      if (!postIds.length) { logLine('Nothing to download.'); return; }

      let saved = 0;
      let already = 0;
      let skipped = 0;
      let failed = 0;
      const progress = () => setDisplay(ui.posts, `${saved}/${postIds.length} done`
        + `${already ? `, ${already} already had` : ''}`
        + `${skipped ? `, ${skipped} not free` : ''}`
        + `${failed ? `, ${failed} failed` : ''}`);
      progress();

      for (let i = 0; i < postIds.length; i++) {
        if (state.cancel) throw cancelledError();
        const vkey = postIds[i];
        if (postIsHad(creator.key, vkey)) { already++; progress(); continue; }
        if (isUnavailable(creator.key, vkey)) { skipped++; progress(); continue; }
        const number = i + 1;
        setDisplay(ui.current, titles.get(vkey) || vkey, `${String(number).padStart(6, '0')} ${vkey}`);
        setProgress((i / postIds.length) * 100);
        try {
          const outcome = await saveVideo(creator, vkey, number, titles.get(vkey));
          if (outcome === 'saved') saved++;
          else skipped++;
        } catch (err) {
          if (isCancelledError(err)) throw err;
          failed++;
          logLine(`Video ${String(number).padStart(6, '0')} failed: ${errorMessage(err)}`);
        }
        progress();
        refreshResultRows();
        renderStats();
        scheduleCardRefresh();
        await delay(VIDEO_DELAY_MS);
      }
      setProgress(100);
      logLine(`Finished ${creator.name}: ${saved} saved, ${already} already had, ${skipped} not free, ${failed} failed.`);
      if (failed) logLine('Drop her again later to retry the ones that failed.');
    } catch (err) {
      setProgress(0);
      if (isCancelledError(err)) logLine('Cancelled.');
      else logLine(`${label} failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
      refreshResultRows();
      renderStats();
      scheduleCardRefresh();
    }
  }

  // One video: read its page, ask for its files, save the tallest. Answers
  // 'saved', or 'unavailable' when nobody can have it (paid, taken down). Any
  // other trouble throws, and the video is tried again next run.
  async function saveVideo(creator, vkey, number, listedTitle) {
    const tag = String(number).padStart(6, '0');
    setDisplay(ui.files, 'Reading the video page');
    let page;
    try {
      page = await httpText(videoPageUrl(vkey));
    } catch (err) {
      if (err && MEDIA_GONE_STATUSES.has(err.httpStatus)) {
        markUnavailable(creator.key, vkey, 'gone');
        logLine(`Video ${tag} is gone from the site.`);
        return 'unavailable';
      }
      throw err;
    }
    const settings = playerSettingsFromHtml(page.text);
    if (!settings) {
      if (/"isPurchased"\s*:\s*false/.test(page.text)) {
        markUnavailable(creator.key, vkey, 'paid');
        logLine(`Video ${tag} is paid; left out.`);
        return 'unavailable';
      }
      throw new Error('the video page came back without its player. Open any video in this tab, let it play, and try again');
    }
    if (settings.video_unavailable === true || settings.video_unavailable === 'true') {
      markUnavailable(creator.key, vkey, 'unavailable');
      logLine(`Video ${tag} is not available.`);
      return 'unavailable';
    }

    const best = await bestMp4For(settings, vkey);
    if (!best) throw new Error('the site offered no plain MP4 for it, only a stream');

    const dateSec = dateKeyFromIso(uploadDateFromHtml(page.text));
    const title = String(settings.video_title || listedTitle || '').trim();
    const base = videoBaseName(creator, number, dateSec, title, vkey);
    const rec = creatorRecord(creator.key) || {};
    saveCreatorRecord({ key: creator.key, postDates: Object.assign({}, rec.postDates || {}, { [vkey]: dateSec }) });
    setDisplay(ui.current, base, `${base} (${vkey})`);

    const quality = Number(best.quality) || Number(best.height) || 0;
    const name = `${ROOT_FOLDER}/${creatorFolderName(creator)}/${base}/${base}_000001.mp4`;
    const bytes = await saveRemoteFile(best.videoUrl, name);
    markPostDownloaded(creator.key, vkey);
    logLine(`Saved ${tag} (${quality ? `${quality}p` : 'mp4'}${bytes ? `, ${formatBytes(bytes)}` : ''}).`);
    return 'saved';
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function showFileProgress(loaded, total) {
    if (total > 0) setDisplay(ui.files, `${formatBytes(loaded)} of ${formatBytes(total)} (${Math.floor((loaded / total) * 100)}%)`);
    else if (loaded > 0) setDisplay(ui.files, `${formatBytes(loaded)}`);
  }

  // A real answer is final, except the two that mean "slow down" or "not now".
  async function withRetry(run, label) {
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (state.cancel) throw cancelledError();
      try {
        return await run();
      } catch (err) {
        if (isCancelledError(err) || state.cancel) throw cancelledError();
        lastErr = err;
        const status = err && err.httpStatus;
        if (status && status !== 429 && status < 500) break;
        if (attempt >= MAX_RETRIES) break;
        await delay((status === 429 ? 5000 : 1000) * Math.pow(2, attempt));
      }
    }
    throw lastErr || new Error(`${label} failed`);
  }

  // --- transport ------------------------------------------------------------
  //
  // Pages and `get_media` are the site's own, so plain fetch reaches them with
  // the site's cookies (your age check and, if you are signed in, your
  // account). The file host answers www.pornhub.com only, so from any other
  // Pornhub address the extension's own request function is the way through.

  function withDeadline(label, ms, run) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let abort = null;
      let cancel = null;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancel) state.aborters.delete(cancel);
        if (err) reject(err);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        try { if (typeof abort === 'function') abort(); } catch {}
        finish(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
      }, ms);
      try {
        abort = run(value => finish(null, value), err => finish(err || new Error(`${label} failed`)));
        cancel = () => {
          try { if (typeof abort === 'function') abort(); } catch {}
          finish(cancelledError());
        };
        state.aborters.add(cancel);
        if (state.cancel) cancel();
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

  function hasGmRequest() {
    try { return typeof GM_xmlhttpRequest === 'function'; } catch { return false; }
  }

  function gmRequest(url, kind, ms, referer, onProgress) {
    return withDeadline(kind === 'arraybuffer' ? 'file request' : 'page request', ms, (ok, fail) => {
      const headers = { Referer: referer || `${ORIGIN}/` };
      if (kind === 'json') { headers.Accept = 'application/json'; headers['X-Requested-With'] = 'XMLHttpRequest'; }
      const handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        responseType: kind === 'arraybuffer' ? 'arraybuffer' : undefined,
        headers,
        timeout: ms,
        onprogress: onProgress ? e => onProgress(Number(e.loaded) || 0, Number(e.total) || 0) : undefined,
        onload: res => {
          if (res.status < 200 || res.status >= 300) { fail(httpStatusError(res.status)); return; }
          if (kind !== 'arraybuffer') { ok({ text: String(res.responseText || ''), url: res.finalUrl || url }); return; }
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

  async function httpTextOnce(url, kind, referer) {
    try {
      const headers = kind === 'json'
        ? { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        : { Accept: 'text/html' };
      const res = await nativeFetch(url, { credentials: 'include', headers, referrer: referer || undefined }, PAGE_TIMEOUT_MS, 'page fetch');
      if (!res.ok) throw httpStatusError(res.status);
      const text = await withDeadline('page read', PAGE_TIMEOUT_MS, (ok, fail) => { res.text().then(ok, fail); });
      noteTransport('fetch');
      return { text, url: res.url || url };
    } catch (err) {
      if (isCancelledError(err) || state.cancel) throw cancelledError();
      if (err && err.httpStatus) throw err;
      if (!hasGmRequest()) throw err;
      noteTransport('GM_xmlhttpRequest');
      return gmRequest(url, kind, PAGE_TIMEOUT_MS, referer);
    }
  }

  function httpText(url) {
    return withRetry(() => httpTextOnce(url, 'html'), 'page request');
  }

  async function httpJson(url, referer) {
    const res = await withRetry(() => httpTextOnce(url, 'json', referer), 'media request');
    try {
      return JSON.parse(res.text);
    } catch {
      throw new Error('the site answered with a page instead of the file list. Open any video in this tab, let it play, and try again');
    }
  }

  async function httpBinary(url, timeoutMs) {
    const ms = timeoutMs || VIDEO_TIMEOUT_MS;
    try {
      const res = await nativeFetch(url, { credentials: 'omit' }, ms, 'file fetch');
      if (!res.ok) throw httpStatusError(res.status);
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      if (/^(?:text\/html|application\/(?:json|xml|xhtml))/.test(type)) {
        throw new Error(`server returned ${type.split(';')[0]} instead of a file`);
      }
      const total = Number(res.headers.get('content-length')) || 0;
      const buffer = await withDeadline('file read', ms, (ok, fail) => { readWithProgress(res, total).then(ok, fail); });
      if (!buffer || !buffer.byteLength) throw new Error('empty response');
      return buffer;
    } catch (err) {
      if (isCancelledError(err) || state.cancel) throw cancelledError();
      if (err && err.httpStatus) throw err;
      if (!hasGmRequest()) throw err;
    }
    return gmRequest(url, 'arraybuffer', ms, `${ORIGIN}/`, showFileProgress);
  }

  async function readWithProgress(res, total) {
    if (!res.body || typeof res.body.getReader !== 'function') return res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      if (state.cancel) { try { reader.cancel(); } catch {} throw cancelledError(); }
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      showFileProgress(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let at = 0;
    chunks.forEach(chunk => { out.set(chunk, at); at += chunk.byteLength; });
    return out.buffer;
  }

  // A video is handed to the extension to save straight from the file host,
  // so it goes to disk without ever sitting in this tab's memory. Only when
  // that is refused is it fetched here and saved from memory, which a video
  // of a gigabyte or more may not survive.
  async function saveRemoteFile(url, rawName) {
    const names = [sanitizeSavePath(rawName, false), sanitizeSavePath(rawName, true)]
      .filter((name, i, all) => all.indexOf(name) === i);
    if (typeof GM_download === 'function') {
      for (const name of names) {
        let total = 0;
        try {
          await withDeadline('save', VIDEO_TIMEOUT_MS, (ok, fail) => {
            const handle = GM_download({
              url,
              name,
              saveAs: false,
              headers: { Referer: `${ORIGIN}/` },
              onprogress: e => { total = Number(e && e.total) || total; showFileProgress(Number(e && e.loaded) || 0, total); },
              onload: () => ok(),
              onerror: err => fail(new Error(err && err.error ? `${err.error}${err.details ? ` (${err.details})` : ''}` : 'save failed')),
              ontimeout: () => fail(new Error('save timeout'))
            });
            setDisplay(ui.files, 'Downloading');
            return handle && typeof handle.abort === 'function' ? () => handle.abort() : null;
          });
          return total;
        } catch (err) {
          if (isCancelledError(err) || state.cancel) throw cancelledError();
          logLine(`Saving as "${name}" did not work (${errorMessage(err)}).`);
          // Only a refused name is worth the plain-letters retry; anything
          // else goes straight to fetching it here.
          if (!/name|filename|not_permitted|invalid/i.test(errorMessage(err))) break;
        }
      }
      logLine('Fetching the video into this tab instead.');
    }
    const buffer = await withRetry(() => httpBinary(url, VIDEO_TIMEOUT_MS), 'file download');
    const blob = new Blob([buffer], { type: 'video/mp4' });
    await saveBlob(blob, rawName);
    return blob.size;
  }

  // GM_download keeps the folders in the name; a browser download flattens
  // them. A name GM_download refuses is retried in plain letters first.
  async function saveBlob(blob, rawName) {
    const url = URL.createObjectURL(blob);
    const names = [sanitizeSavePath(rawName, false), sanitizeSavePath(rawName, true)]
      .filter((name, i, all) => all.indexOf(name) === i);
    try {
      if (typeof GM_download === 'function') {
        for (const name of names) {
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
            logLine(`Saving as "${name}" did not work (${errorMessage(err)}).`);
          }
        }
        logLine('Saving through the browser instead; the video lands loose in Downloads.');
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = names[0].split('/').pop() || 'pornhub_video.mp4';
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.documentElement.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  // --- checking a download folder -------------------------------------------
  //
  // Point it at your Pornhub folder (or any folder above or inside it). Every
  // file or folder named the Stripper way is read for its date, its creator
  // and its number; the number says which video it is, and the date, where
  // the script has read it, has to agree. For each creator the script has read
  // before, what is in the folder then *becomes* her download record. Creators
  // found in the folder that the script has never read are named, so they can
  // be dropped once.

  const POST_NAME_RE = /^(\d{6})-(.+?)-(\d{6}) - /;

  async function checkDownloadFolder(files) {
    if (state.busy || state.checking) return;
    if (!files.length) { setFootNote('That folder is empty.'); return; }
    state.checking = true;
    ui.check.textContent = 'Checking…';
    ui.check.disabled = true;
    try {
      // creator section (lower-cased) -> Set of "date|number"
      const found = new Map();
      const shownAs = new Map();
      files.forEach(file => {
        const path = String(file.webkitRelativePath || file.name || '');
        path.split('/').forEach(segment => {
          const m = segment.match(POST_NAME_RE);
          if (!m) return;
          const who = m[2].toLowerCase();
          if (!found.has(who)) found.set(who, new Set());
          if (!shownAs.has(who)) shownAs.set(who, m[2]);
          found.get(who).add(`${m[1]}|${Number(m[3])}`);
        });
      });
      if (!found.size) { setFootNote('No Pornhub videos in that folder.'); return; }

      const bySection = new Map();
      Object.values(loadCreators()).forEach(rec => {
        if (!Array.isArray(rec.postIds)) return;
        bySection.set(creatorNameSection(rec).toLowerCase(), rec);
      });

      let matchedCreators = 0;
      let matchedPosts = 0;
      let stray = 0;
      const unknown = [];
      found.forEach((entries, who) => {
        const rec = bySection.get(who);
        if (!rec) { unknown.push(shownAs.get(who) || who); return; }
        const had = new Set();
        entries.forEach(entry => {
          const [date, number] = entry.split('|');
          const id = rec.postIds[Number(number) - 1];
          const recDate = id && rec.postDates ? rec.postDates[id] : '';
          if (id && (!recDate || recDate === date)) had.add(String(id));
          else stray++;
        });
        writeIdSet(downloadedCache, KEYS.downloaded, rec.key, had);
        matchedCreators++;
        matchedPosts += had.size;
      });
      forgetAllFigures();

      const lines = [`Checked ${matchedCreators} creator${matchedCreators === 1 ? '' : 's'}: ${matchedPosts} video${matchedPosts === 1 ? '' : 's'} on disk.`];
      if (stray) lines.push(`${stray} item${stray === 1 ? '' : 's'} did not match a video as last read; drop that creator again and check once more.`);
      if (unknown.length) {
        const sample = unknown.slice(0, 3).join(', ');
        lines.push(`Not read yet, so not checked: ${sample}${unknown.length > 3 ? ` and ${unknown.length - 3} more` : ''}. Drop them once, then check again.`);
      }
      setFootNote(lines.join('\n'));
      refreshResultRows();
      renderStats();
      scheduleCardRefresh();
    } finally {
      state.checking = false;
      ui.check.textContent = 'Check all';
      ui.check.disabled = state.busy;
    }
  }

  // Forget every download, for every creator. What the script knows about each
  // creator's videos is kept, so fractions still show.
  function resetDownloads() {
    if (state.busy) return;
    const keys = gmKeys(KEYS.downloaded);
    if (!keys.length) return;
    if (!window.confirm('Forget every Pornhub download? Every creator will read as not downloaded. Files on disk are not touched.')) return;
    keys.forEach(gmDelete);
    downloadedCache.clear();
    forgetAllFigures();
    setFootNote('Download record cleared.');
    refreshResultRows();
    renderStats();
    scheduleCardRefresh();
  }

  function renderStats() {
    if (!ui.stats) return;
    const recs = Object.values(loadCreators()).filter(rec => Array.isArray(rec.postIds));
    let posts = 0;
    let have = 0;
    let done = 0;
    recs.forEach(rec => {
      const f = creatorFigures(rec.key);
      if (!f) return;
      posts += f.total;
      have += Math.min(f.have, f.total);
      if (f.done) done++;
    });
    if (!recs.length) {
      ui.stats.textContent = 'Nothing read yet';
      ui.stats.title = 'Drop a creator to start.';
    } else {
      ui.stats.textContent = `Videos ${have}/${posts} · Creators ${done}/${recs.length}`;
      ui.stats.title = `${have} of ${posts} free videos downloaded, across ${recs.length} creator${recs.length === 1 ? '' : 's'} read so far. ${done} complete.`;
    }
    if (ui.clearDownloads) ui.clearDownloads.hidden = !gmKeys(KEYS.downloaded).length;
  }

  // --- panel plumbing -------------------------------------------------------

  function setBusy(busy) {
    state.busy = busy;
    if (!busy) {
      state.cancel = false;
      state.currentJobKey = '';
    }
    ui.progress.hidden = !busy;
    ui.live.hidden = !busy;
    ui.stop.hidden = !busy;
    ui.stop.disabled = !busy;
    ui.check.disabled = busy || state.checking;
    ui.clearDownloads.disabled = busy;
    refreshResultRows();
    scheduleCardRefresh();
    if (!busy) { syncContext(); pumpQueue(); }
  }

  function requestStop() {
    if (!state.busy && !state.queue.length) return;
    state.queue.length = 0;
    refreshResultRows();
    if (!state.busy) return;
    state.cancel = true;
    Array.from(state.aborters).forEach(abort => { try { abort(); } catch {} });
    setProgress(0);
    logLine('Stopped.');
  }

  function setProgress(percent) {
    const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
    if (ui.fill) ui.fill.style.width = `${value}%`;
  }

  function resetLog() {
    setProgress(0);
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

  function cancelledError() {
    return new Error('cancelled');
  }

  function isCancelledError(err) {
    return errorMessage(err) === 'cancelled';
  }

  function delay(ms) {
    if (state.cancel) return Promise.reject(cancelledError());
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancel = null;
      const finish = err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancel) state.aborters.delete(cancel);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => finish(), ms);
      cancel = () => finish(cancelledError());
      state.aborters.add(cancel);
    });
  }

  function errorMessage(err) {
    if (!err) return 'unknown error';
    return String(err.message || err);
  }

  // The hiding sheets go in before the page draws anything, so a video you
  // have never flashes up first; the panel waits for the page to exist.
  applyCardHideStyle();
  installPageObserver();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
