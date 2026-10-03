// ==UserScript==
// @name         OnlyHaven Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.00
// @description  OnlyHaven (cum.st) creator downloader. Drop a creator link to download every post she has, one zip per post, named by creator and date.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/OnlyHaven_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/OnlyHaven_Stripper.user.js
// @match        *://cum.st/*
// @match        *://www.cum.st/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @connect      cum.st
// @connect      *.cum.st
// @run-at       document-start
// ==/UserScript==

// ===========================================================================
// WHAT THIS IS
// ===========================================================================
// The Playboy Plus Stripper, rebuilt for OnlyHaven (cum.st), an archive of
// OnlyFans and Fansly creators. Same panel, same queue, same job: drop a
// creator and take her whole library in one go. What changes is that the unit
// is a post rather than a gallery, so the files are named the way every other
// post Stripper names them (Reddit, Twitter, Pawchive):
//
//   OnlyHaven/<Creator>/<YYMMDD>-<Creator>-<000001> - <title>.zip
//     holding  <same name>/<same name>_000001.jpg, _000002.mp4, ...
//              <same name>/<same name>.md   (the caption, date and link)
//
// The six-digit number is the post's place in her history, oldest first, so
// post 1 is her first post and the numbers mean the same thing every run. The
// title is the post's own title, or the first line of its caption, or
// `post_<id>` when there is neither.
//
// The site is easy to read. Its pages arrive empty and fill themselves in from
// a plain public API, and this script asks the same API:
//
//   /api/v1/<service>/user/<id>/profile             who she is
//   /api/v1/<service>/user/<id>/posts?o=&n=50&sort  her posts, 50 at a time
//
// Each post lists its attachments with a storage key, and the full-size file
// is https://e1.cum.st/media/<key>/<variant> — the same link behind the site's
// own Download button. Locked attachments (paid content the archive never got)
// carry no key and are left out. Posts with nothing downloadable in them are
// not posts here: no zip, no number. DMs are not taken; they have no dates and
// are mostly the same promo clip sent again and again.
//
// ---------------------------------------------------------------------------
// THE PANEL
// ---------------------------------------------------------------------------
// Drop a creator link, or a post link (it resolves to whoever posted it). A row
// appears with her name and how much of her you have, counts down five seconds
// and adds itself to the queue. Press Download to go now, × to drop it. Drop
// into a collapsed panel and it goes straight in. While a run is going the
// other rows say Add to queue and start one after another.
//
// A post is downloaded or it is not. Nothing is marked by hand. Already-had
// posts are skipped, so dropping a creator again later takes only what is new.
//
// "Ignore videos" leaves video files out. A post with photos and a video lands
// with its photos; a post that is only video is left alone. Posts saved without
// their video are remembered, and turning the button off puts exactly those
// back to not-downloaded, so the next run takes them whole.
//
// ---------------------------------------------------------------------------
// HIDING IS HAVING
// ---------------------------------------------------------------------------
// On the site itself, a post you have is gone from the grid, and so is a
// creator every one of whose posts you have. The eye in the title bar shows
// them again. A creator is only judged once she has been read (dropped or
// downloaded at least once) — until then nothing knows how many posts she has.
//
// "Check all" is for a library saved before this script existed, or on another
// machine. Pick your OnlyHaven folder: for every creator the script knows, what
// is in that folder becomes the record of what you have. Creators it has never
// read are listed so you can drop them once and check again.
// ===========================================================================

(function () {
  'use strict';

  if (!/^(?:www\.)?cum\.st$/i.test(location.hostname)) return;
  if (window.__onlyHavenStripperLoaded) return;
  window.__onlyHavenStripperLoaded = true;

  // ===========================================================================
  // CONFIG
  // ===========================================================================

  const ORIGIN = location.origin;
  // Where the files live. The site picks from a list of these at random; it
  // has only ever had the one.
  const FILE_HOST = 'https://e1.cum.st';

  // The API answers 50 posts at a time whatever is asked for.
  const PAGE_SIZE = 50;
  const MAX_PAGES = 1000;

  // Unhurried on purpose: a bulk run is meant to be left alone, not raced.
  const PAGE_DELAY_MS = 400;     // between listing pages
  const POST_DELAY_MS = 300;     // between posts in a run
  const FILE_DELAY_MS = 120;     // between files within one lane
  const IMAGE_CONCURRENCY = 3;

  const MAX_RETRIES = 3;
  const PAGE_TIMEOUT_MS = 45000;
  const BLOB_TIMEOUT_MS = 180000;
  const VIDEO_TIMEOUT_MS = 3600000;
  const SAVE_TIMEOUT_MS = 20000;
  const VIDEO_SIZE_WARN_BYTES = 900 * 1024 * 1024;

  // Everything lands under one folder in your downloads directory.
  const ROOT_FOLDER = 'OnlyHaven';
  const NAME_CHARS = 40;

  // How long a dropped creator sits in the list before it adds itself.
  const AUTO_START_MS = 5000;
  // How long the collapsed panel's header says what it just took.
  const COLLAPSED_CUE_MS = 2200;

  const IMAGE_EXTS = new Set(['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp']);
  const VIDEO_EXTS = new Set(['avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'webm', 'wmv']);
  // The only two answers that mean a file will never be there again. Anything
  // else is a bad afternoon and is tried again next run.
  const MEDIA_GONE_STATUSES = new Set([404, 410]);

  // The site accent: OnlyHaven's blue (#028cd4), warmed a step so it sits on the
  // dark panel rather than glowing off it.
  const ACCENT = '#5fa8d6';
  const ACCENT_HOVER = '#82bce0';
  const ACCENT_DEEP = '#3d86b4';
  const ACCENT_RGB = '95, 168, 214';
  const acc = alpha => `rgba(${ACCENT_RGB}, ${alpha})`;

  const KEYS = {
    creators: 'oh:creators',
    downloaded: 'oh:dl:',
    owed: 'oh:owed:',
    ignoreVideos: 'oh:ignoreVideos'
  };
  const PANEL_POS_KEY = 'OnlyHavenStripper.panelpos.v1';
  const PANEL_ID = 'onlyHavenStripperPanel';

  // ===========================================================================

  const state = {
    busy: false,
    cancel: false,
    checking: false,
    aborters: new Set(),
    transport: '',
    hidden: true,
    ignoreVideos: false,
    queue: [],
    currentJobKey: ''
  };

  const ui = {};
  const styleEls = [];
  let cardHideStyleEl = null;
  let COLLAPSED_CUE_TIMER = 0;

  // @require lands in the sandbox scope in some managers and on window in others.
  function resolveJSZip() {
    try { if (typeof JSZip === 'function') return JSZip; } catch {}
    try { if (typeof window.JSZip === 'function') return window.JSZip; } catch {}
    return null;
  }

  // --- storage --------------------------------------------------------------
  //
  // The extension's own storage, so the record survives the site's data being
  // cleared and is shared by every cum.st tab. localStorage stands in where a
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
  // Per creator, written whenever she is read: who she is, and her posts with
  // anything in them, in numbered order (`postIds[0]` is post 000001) with the
  // date each was named with. That is what lets a fraction be shown, a card be
  // hidden and a folder be checked without asking the site again.
  //
  //   { key, service, id, handle, name, postIds: [], postDates: [], videoOnly: [], readAt }
  //
  // Downloads are a separate list of post ids per creator, written only once a
  // zip has actually been saved.

  let creatorsCache = null;
  const downloadedCache = new Map();
  const owedCache = new Map();
  const figuresCache = new Map();

  function creatorKey(service, id) {
    return `${String(service || '').toLowerCase()}:${String(id || '')}`;
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
  }

  function downloadedSet(key) { return idSet(downloadedCache, KEYS.downloaded, key); }
  function owedSet(key) { return idSet(owedCache, KEYS.owed, key); }

  function postIsHad(key, postId) {
    return !!(key && postId != null && downloadedSet(key).has(String(postId)));
  }

  function markPostDownloaded(key, postId, owedVideo) {
    const had = downloadedSet(key);
    had.add(String(postId));
    writeIdSet(downloadedCache, KEYS.downloaded, key, had);
    const owed = owedSet(key);
    const wasOwed = owed.has(String(postId));
    if (owedVideo) owed.add(String(postId));
    else owed.delete(String(postId));
    if (wasOwed !== !!owedVideo) writeIdSet(owedCache, KEYS.owed, key, owed);
  }

  // What you have of her, counted on her posts as last read. Posts the ignore
  // button is leaving out are in neither half.
  function creatorFigures(key) {
    if (figuresCache.has(key)) return figuresCache.get(key);
    const rec = creatorRecord(key);
    let out = null;
    if (rec && Array.isArray(rec.postIds)) {
      const had = downloadedSet(key);
      const videoOnly = new Set((rec.videoOnly || []).map(String));
      let have = 0;
      let ignored = 0;
      rec.postIds.forEach(id => {
        if (had.has(String(id))) have++;
        else if (state.ignoreVideos && videoOnly.has(String(id))) ignored++;
      });
      const total = rec.postIds.length - ignored;
      out = { have, total, ignored, all: rec.postIds.length, videoOnly, done: rec.postIds.length > 0 && have >= total };
    }
    figuresCache.set(key, out);
    return out;
  }

  function creatorIsHad(key) {
    const f = creatorFigures(key);
    return !!(f && f.done);
  }

  function postIsIgnored(key, postId) {
    if (!state.ignoreVideos) return false;
    const f = creatorFigures(key);
    return !!(f && f.videoOnly.has(String(postId)) && !postIsHad(key, postId));
  }

  function forgetAllFigures() {
    figuresCache.clear();
  }

  // --- the site's addresses -------------------------------------------------
  //
  // Creators live at /creators/<service>/<id>, posts at
  // /creators/<service>/<id>/post/<postId>.

  function targetFromUrl(raw, baseUrl) {
    const value = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!value) return null;
    let url;
    try { url = new URL(value, baseUrl || ORIGIN); } catch { return null; }
    if (!/^(?:www\.)?cum\.st$/i.test(url.hostname)) return null;
    const m = url.pathname.match(/^\/creators\/([a-z0-9_-]+)\/([^/?#]+)(?:\/post\/([^/?#]+))?\/?$/i);
    if (!m) return null;
    const service = m[1].toLowerCase();
    const id = decodeURIComponent(m[2]);
    const target = { kind: m[3] ? 'post' : 'creator', service, id, key: creatorKey(service, id) };
    if (m[3]) target.postId = decodeURIComponent(m[3]);
    return target;
  }

  function targetsFromText(text) {
    const seen = new Set();
    const targets = [];
    // `#`-prefixed lines are uri-list comments, not URLs.
    String(text || '').split(/[\s"'<>]+/).forEach(token => {
      if (!token || token.charAt(0) === '#') return;
      const target = targetFromUrl(token, ORIGIN);
      if (!target) return;
      const k = `${target.key}:${target.postId || ''}`;
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
    return t ? t.key : '';
  }

  // --- hiding what you already have -----------------------------------------
  //
  // A class on the card, with the rule in its own stylesheet, so the eye is one
  // `disabled` flip. The card is found by structure: climb from the link while
  // the parent still holds just this one offer. On this site the link *is* the
  // card, so the climb usually stops at once.

  const CARD_CLIMB_LIMIT = 5;
  const CARD_CLIMB_STOP = 'body, main, header, footer, nav, astro-island';
  const CARD_SKIP_WITHIN = `#${PANEL_ID}, header, footer, nav, [data-sidebar], [data-slot="sidebar"]`;

  function linkTarget(anchor) {
    try { if (anchor.closest(CARD_SKIP_WITHIN)) return null; } catch {}
    return targetFromUrl(anchor.getAttribute('href'), location.href);
  }

  function targetLinkCount(node) {
    return Array.from(node.querySelectorAll('a[href]')).filter(linkTarget).length;
  }

  function cardForAnchor(anchor) {
    let card = anchor;
    let node = anchor;
    for (let i = 0; i < CARD_CLIMB_LIMIT; i++) {
      const parent = node.parentElement;
      if (!parent || parent === document.body) break;
      try { if (parent.matches(CARD_CLIMB_STOP)) break; } catch {}
      if (targetLinkCount(parent) > 1) break;
      card = parent;
      node = parent;
    }
    return card;
  }

  // Anything already coming is taken off the site too: the creator whose run is
  // going or waiting, and her posts.
  function creatorKeysInFlight() {
    const keys = new Set();
    state.queue.forEach(job => { if (job && job.key) keys.add(job.key); });
    if (state.currentJobKey) keys.add(state.currentJobKey);
    return keys;
  }

  function refreshHiddenCards() {
    if (!document.body) return;
    const inFlight = creatorKeysInFlight();
    // The creator whose page you are on is never hidden from her own page: the
    // link to her there is the way back, not an offer.
    const here = locationCreatorKey();
    Array.from(document.querySelectorAll('.ohGot, .ohIgnored, .ohInFlight')).forEach(el => {
      el.classList.remove('ohGot', 'ohIgnored', 'ohInFlight');
    });
    Array.from(document.querySelectorAll('a[href]')).forEach(anchor => {
      const target = linkTarget(anchor);
      if (!target) return;
      let had = false;
      let ignored = false;
      if (target.kind === 'post') {
        had = postIsHad(target.key, target.postId);
        ignored = !had && postIsIgnored(target.key, target.postId);
      } else {
        if (target.key === here) return;
        had = creatorIsHad(target.key);
      }
      const coming = !had && inFlight.has(target.key) && !(target.kind === 'creator' && target.key === here);
      if (!had && !ignored && !coming) return;
      const card = cardForAnchor(anchor);
      if (had) card.classList.add('ohGot');
      if (ignored) card.classList.add('ohIgnored');
      if (coming) card.classList.add('ohInFlight');
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
  // The site moves between pages by swapping the document's head and body in
  // place (Astro view transitions). Anything put in the head or the body is
  // thrown away on the first click, so the panel and its stylesheets hang off
  // the <html> element itself, and are put back if anything ever removes them.

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
    cardHideStyleEl = addStyleEl('onlyHavenStripperCardRules', '.ohGot { display: none !important; }');
    // Ignored and in-flight are said on screen (the lit button, the queue), so
    // the eye — which exists to show what you have — does not hand them back.
    addStyleEl('onlyHavenStripperFilterRules', '.ohIgnored, .ohInFlight { display: none !important; }');
  }

  function injectStyle() {
    const P = `#${PANEL_ID}`;
    addStyleEl('onlyHavenStripperStyle', `
      ${P}{position:fixed;right:16px;top:16px;z-index:2147483646;width:360px;max-height:92vh;
        display:flex;flex-direction:column;border:1px solid ${acc(0.4)};border-radius:10px;box-sizing:border-box;
        background:#141210;color:#f2ece1;box-shadow:0 18px 60px rgba(0,0,0,.6);font:700 12px/1.35 Arial,sans-serif;
        overflow:hidden;text-align:left;letter-spacing:normal;text-transform:none}
      ${P} *{box-sizing:border-box;font-family:Arial,sans-serif}
      ${P} [hidden]{display:none!important}
      ${P}.oh-collapsed{height:auto;max-height:none}
      ${P}.oh-collapsed .oh-body{display:none}
      ${P}.oh-tookIt .oh-head{background:linear-gradient(90deg,#24384a,#1a1613)}
      ${P}.oh-tookIt .oh-title{color:#d9eefb}
      ${P} .oh-head{height:38px;flex:0 0 38px;display:flex;align-items:center;gap:6px;padding:0 10px;
        touch-action:none;user-select:none;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#33261a,#1a1613);cursor:grab}
      ${P}.oh-dragging-panel .oh-head{cursor:grabbing}
      ${P} .oh-title{font-weight:900;font-size:12px;color:${ACCENT};flex:1 1 auto;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      ${P} .oh-iconBtn{flex:0 0 auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px;font-size:13px}
      ${P} .oh-body{flex:1 1 auto;display:flex;flex-direction:column;gap:12px;padding:10px;min-height:0;overflow:hidden}
      ${P} button{appearance:none;width:100%;min-height:32px;margin:0;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#f2ece1;font:700 12px/1 Arial,sans-serif;cursor:pointer;
        text-transform:none;letter-spacing:normal;box-shadow:none}
      ${P} button:hover:not(:disabled){background:${acc(0.2)};border-color:${acc(0.55)}}
      ${P} button:disabled{opacity:.42;cursor:default}

      ${P} .oh-drop{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-height:52px;padding:8px 10px;
        border:1px dashed ${acc(0.45)};border-radius:8px;background:${acc(0.06)};
        color:#b3a58c;font-weight:700;text-align:center}
      ${P}.oh-dragging .oh-drop{border-color:${ACCENT};border-style:solid;background:${acc(0.22)};color:#fff}

      ${P} .oh-resultsWrap{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
      ${P} .oh-summary{flex:0 0 auto;min-height:18px;color:#bdb1a0;font-weight:700;line-height:1.4}
      ${P} .oh-results{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding-right:2px}
      ${P} .oh-results:empty{display:none}
      ${P} .oh-result{flex:0 0 auto;position:relative;overflow:hidden;
        display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;align-items:center;
        padding:7px 8px;border-radius:8px;background:rgba(255,255,255,.05)}
      ${P} .oh-rowName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#f2ece1;font-weight:900;font-size:12px}
      ${P} .oh-rowCount{flex:0 0 auto;color:#a99b87;font-weight:900;font-size:11px;
        font-variant-numeric:tabular-nums;letter-spacing:.02em}
      ${P} .oh-rowCountDone{color:#8fd49b}
      ${P} .oh-result button{width:auto;min-height:24px;padding:0 9px;border-radius:6px;font-size:10px}
      ${P} .oh-rowX{width:24px!important;min-width:24px;padding:0!important;font-size:13px!important;line-height:1;color:#c0b09a}
      ${P} .oh-rowX:hover:not(:disabled){background:rgba(224,138,138,.22);border-color:rgba(224,138,138,.5);color:#ffd9d9}
      ${P} .oh-rowTimer{position:absolute;left:0;right:0;bottom:0;height:2px;pointer-events:none}
      ${P} .oh-rowTimer i{display:block;height:2px;width:100%;background:${ACCENT};transform:scaleX(0);transform-origin:left center}
      ${P} .oh-resultHidden{opacity:.62}

      ${P} .oh-progress{display:block;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      ${P} .oh-fill{display:block;height:10px;min-height:10px;width:0;
        background:linear-gradient(90deg,${ACCENT_DEEP},${ACCENT});transition:width 120ms ease}
      ${P} .oh-live{flex:0 0 auto;display:flex;flex-direction:column;gap:5px}
      ${P} .oh-line{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;align-items:baseline}
      ${P} .oh-line span{color:#857a68;font-weight:900;text-transform:uppercase;font-size:10px}
      ${P} .oh-line strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee5d5;font-size:12px;font-weight:900}
      ${P} .oh-stop{flex:0 0 auto;background:#4a3323!important;color:#ffeccf!important;border-color:${acc(0.6)}!important}
      ${P} .oh-log{flex:0 0 auto;max-height:72px;overflow:auto;color:#a99b87;font:700 11px/1.35 Arial,sans-serif;
        white-space:pre-wrap;word-break:break-word}
      ${P} .oh-log:empty{display:none}

      ${P} .oh-foot{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid ${acc(0.16)}}
      ${P} .oh-stats{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bdb1a0;font-weight:700;font-size:11px}
      ${P} .oh-footBtns{display:flex;flex-wrap:wrap;gap:6px}
      ${P} .oh-footBtn{width:auto;flex:1 1 auto;min-height:28px;border-radius:7px;font-size:11px}
      ${P} .oh-footBtnOn{background:${ACCENT}!important;color:#1a1613!important;border-color:${ACCENT_DEEP}!important;font-weight:900}
      ${P} .oh-footBtnOn:hover:not(:disabled){background:${ACCENT_HOVER}!important;border-color:${ACCENT}!important}
      ${P} .oh-footNote{color:#bdb1a0;font-weight:700;font-size:11px;line-height:1.35;white-space:pre-wrap}

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
      <div class="oh-head">
        <span class="oh-title">OnlyHaven Stripper</span>
        <button class="oh-iconBtn" data-ui="eye" type="button" title="Reveal what you already have">&#128584;</button>
        <button class="oh-iconBtn" data-ui="collapse" type="button" title="Collapse">&#9652;</button>
      </div>
      <div class="oh-body">
        <div class="oh-drop" data-ui="drop" title="Drop a creator, or a post. A post resolves to whoever posted it.">Drop a creator or post link here</div>

        <div class="oh-resultsWrap">
          <div class="oh-summary" data-ui="summary" hidden></div>
          <div class="oh-results" data-ui="results"></div>
        </div>

        <div class="oh-progress" data-ui="progress" hidden><div class="oh-fill" data-ui="fill"></div></div>
        <div class="oh-live" data-ui="live" aria-live="polite" hidden>
          <div class="oh-line"><span>Creator</span><strong data-ui="creator">None</strong></div>
          <div class="oh-line"><span>Posts</span><strong data-ui="posts">0/0</strong></div>
          <div class="oh-line"><span>Current</span><strong data-ui="current">None</strong></div>
          <div class="oh-line"><span>Files</span><strong data-ui="files">0/0</strong></div>
        </div>
        <button class="oh-stop" data-ui="stop" type="button" hidden>Stop</button>
        <div class="oh-log" data-ui="log" aria-live="polite"></div>

        <div class="oh-foot">
          <span class="oh-stats" data-ui="stats">Nothing read yet</span>
          <div class="oh-footBtns">
            <button class="oh-footBtn" data-ui="ignoreVideos" type="button" aria-pressed="false">Ignore videos</button>
          </div>
          <div class="oh-footBtns">
            <button class="oh-footBtn" data-ui="check" type="button" title="Pick your OnlyHaven folder. For every creator this script knows, what is in it becomes the download record.">Check all</button>
            <button class="oh-footBtn" data-ui="clearDownloads" type="button" title="Forget every download, for every creator." hidden>Clear downloads</button>
          </div>
          <div class="oh-footNote" data-ui="footNote" hidden></div>
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
    ui.ignoreVideos.addEventListener('click', () => setIgnoreVideos(!state.ignoreVideos));
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
      panel.classList.toggle('oh-collapsed');
      ui.collapse.innerHTML = panel.classList.contains('oh-collapsed') ? '&#9662;' : '&#9652;';
    });
    makePanelDraggable(panel, panel.querySelector('.oh-head'));
    installDropTarget(panel);

    state.ignoreVideos = gmGet(KEYS.ignoreVideos, false) === true;
    updateIgnoreButton();
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

  // The site rewrites itself in place rather than loading a new page, so this
  // watches the address and the documentElement's children instead.
  function installRouteWatch() {
    let last = location.href;
    const onRoute = () => {
      keepAttached();
      if (location.href === last) return;
      last = location.href;
      if (!state.busy) syncContext();
      scheduleCardRefresh();
    };
    document.addEventListener('astro:after-swap', onRoute);
    document.addEventListener('astro:page-load', onRoute);
    setInterval(onRoute, 700);
  }

  function syncContext() {
    if (ui.drop) {
      ui.drop.textContent = targetFromUrl(location.href, ORIGIN)
        ? 'Drop another creator or post link here'
        : 'Drop a creator or post link here';
    }
    if (state.busy) return;
    setDisplay(ui.creator, 'None');
    setDisplay(ui.posts, '0/0');
    setDisplay(ui.current, 'None');
    setDisplay(ui.files, '0/0');
  }

  function setHidden(hidden) {
    state.hidden = hidden !== false;
    if (cardHideStyleEl) cardHideStyleEl.disabled = !state.hidden;
    updateEyeButton();
  }

  function updateEyeButton() {
    if (!ui.eye) return;
    let count = 0;
    try { count = document.querySelectorAll('.ohGot').length; } catch {}
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

  // --- ignoring videos --------------------------------------------------------

  function setIgnoreVideos(on) {
    state.ignoreVideos = !!on;
    gmSet(KEYS.ignoreVideos, state.ignoreVideos);
    if (!state.ignoreVideos) redeemOwedVideos();
    forgetAllFigures();
    updateIgnoreButton();
    refreshResultRows();
    renderStats();
    scheduleCardRefresh();
  }

  // Posts saved without their video, put back to not-downloaded, so the next
  // run takes them whole.
  function redeemOwedVideos() {
    let count = 0;
    gmKeys(KEYS.owed).forEach(storeKey => {
      const key = storeKey.slice(KEYS.owed.length);
      const owed = owedSet(key);
      if (!owed.size) return;
      const had = downloadedSet(key);
      owed.forEach(id => { if (had.delete(id)) count++; });
      writeIdSet(downloadedCache, KEYS.downloaded, key, had);
      writeIdSet(owedCache, KEYS.owed, key, new Set());
    });
    if (count) logLine(`${count} post${count === 1 ? '' : 's'} saved without ${count === 1 ? 'its video is' : 'their videos are'} back to not-downloaded.`);
  }

  function updateIgnoreButton() {
    if (!ui.ignoreVideos) return;
    ui.ignoreVideos.classList.toggle('oh-footBtnOn', state.ignoreVideos);
    ui.ignoreVideos.setAttribute('aria-pressed', String(state.ignoreVideos));
    ui.ignoreVideos.textContent = state.ignoreVideos ? 'Ignoring videos' : 'Ignore videos';
    ui.ignoreVideos.title = state.ignoreVideos
      ? 'Videos are being left out. Press to take them again; posts saved without theirs are reopened.'
      : 'Leave video files out. Posts that are only video are skipped.';
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
    panel.classList.add('oh-dragged');
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
      panel.classList.add('oh-dragging-panel');
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
      panel.classList.remove('oh-dragging-panel');
      try { handle.releasePointerCapture(event.pointerId); } catch {}
      if (last) savePanelPosition(last);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => {
      if (!panel.classList.contains('oh-dragged')) return;
      const rect = panel.getBoundingClientRect();
      last = placePanelAt(panel, rect.left, rect.top);
      savePanelPosition(last);
    });
  }

  function installDropTarget(panel) {
    let depth = 0;
    const setDragging = on => panel.classList.toggle('oh-dragging', on);
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
      if (!targets.length) { showSummary('Nothing creator- or post-shaped in that drop.'); return; }
      addDroppedTargets(targets).catch(err => showSummary(`Could not read that link: ${errorMessage(err)}`));
    });
  }

  // --- the list, which is the queue -----------------------------------------
  //
  // It only ever grows: a drop adds to the bottom and nothing but the × takes a
  // row away. Panel open, a new row counts down and then adds itself; panel
  // collapsed, it goes straight in and the title bar says what it took.

  async function addDroppedTargets(targets) {
    const listed = listedRowKeys();
    const keys = [];
    targets.forEach(t => { if (!keys.some(k => k.key === t.key)) keys.push(t); });
    const fresh = keys.filter(t => !listed.has(t.key));
    if (!fresh.length) { showSummary('Already on the list.'); return; }
    showSummary(`Reading ${fresh.length === 1 ? 'one creator' : `${fresh.length} creators`}…`);

    const rows = [];
    let unknown = 0;
    for (const t of fresh) {
      let name = creatorDisplayName(creatorRecord(t.key));
      if (!name) {
        try {
          const profile = await fetchProfile(t.service, t.id);
          name = profileName(profile);
          // Remembered straight away, so the name is known before any run.
          saveCreatorRecord({ key: t.key, service: t.service, id: String(profile.id || t.id), handle: String(profile.name || ''), name });
        } catch (err) {
          if (err && err.httpStatus === 404) { unknown++; continue; }
          name = `${t.service} ${t.id}`;
        }
      }
      rows.push(rowNode({ key: t.key, service: t.service, id: t.id, name }));
    }
    if (!rows.length) {
      showSummary(unknown ? 'The site does not know that creator.' : 'Nothing to add.');
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
    const skipped = keys.length - fresh.length;
    showSummary(`Added ${rows.length}${skipped ? `, ${skipped} already listed` : ''}${unknown ? `, ${unknown} not on the site` : ''}.`);
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
    return { key: row.dataset.key, service: row.dataset.service, id: row.dataset.id, name: row.dataset.name };
  }

  function panelIsCollapsed() {
    return !!(ui.panel && ui.panel.classList.contains('oh-collapsed'));
  }

  // One line per creator: name, how much of her you have, the button that takes
  // her, and the ×. The timer bar across the foot only moves while counting down.
  function rowNode(item) {
    const row = document.createElement('div');
    row.className = 'oh-result';
    row.dataset.key = item.key;
    row.dataset.service = item.service;
    row.dataset.id = item.id;
    row.dataset.name = item.name;

    const name = document.createElement('div');
    name.className = 'oh-rowName';
    name.textContent = item.name;
    name.title = `${item.name} (${item.service})`;

    const count = document.createElement('div');
    count.className = 'oh-rowCount';

    const go = document.createElement('button');
    go.type = 'button';
    go.dataset.action = 'download';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.className = 'oh-rowX';
    remove.textContent = '×';
    remove.title = 'Take this off the list';

    const timer = document.createElement('div');
    timer.className = 'oh-rowTimer';
    timer.appendChild(document.createElement('i'));

    row.append(name, count, go, remove, timer);
    applyRowState(row);
    return row;
  }

  function applyRowState(row) {
    const f = creatorFigures(row.dataset.key);
    const count = row.querySelector('.oh-rowCount');
    if (count) {
      if (!f) {
        count.textContent = '?';
        count.title = 'Not read yet. Her posts are counted when she is downloaded.';
      } else if (!f.total) {
        count.textContent = '—';
        count.title = f.all ? 'Only video posts, and videos are being ignored' : 'No posts with anything in them';
      } else {
        count.textContent = `${f.have}/${f.total}`;
        count.title = f.done ? `All ${f.total} posts` : `${f.have} of ${f.total} posts`;
      }
      count.classList.toggle('oh-rowCountDone', !!(f && f.done && f.total));
    }
    const go = row.querySelector('button[data-action="download"]');
    if (go) {
      const next = downloadButtonState(row.dataset.key);
      go.textContent = next.label;
      go.disabled = next.disabled;
    }
    row.classList.toggle('oh-resultHidden', !!(f && f.done));
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
    const row = button.closest('.oh-result');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.action === 'remove') { removeRow(row); return; }
    cancelRowCountdown(row);
    requestDownload(jobFromRow(row));
  }

  function beginRowCountdown(row) {
    if (!row || row.__ohTimer) return;
    const bar = row.querySelector('.oh-rowTimer i');
    if (bar) {
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(1)';
      requestAnimationFrame(() => {
        bar.style.transition = `transform ${AUTO_START_MS}ms linear`;
        bar.style.transform = 'scaleX(0)';
      });
    }
    row.__ohTimer = setTimeout(() => {
      cancelRowCountdown(row);
      if (row.isConnected) requestDownload(jobFromRow(row));
    }, AUTO_START_MS);
  }

  function cancelRowCountdown(row) {
    if (!row) return;
    if (row.__ohTimer) { clearTimeout(row.__ohTimer); row.__ohTimer = null; }
    const bar = row.querySelector('.oh-rowTimer i');
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
    const title = ui.panel && ui.panel.querySelector('.oh-title');
    if (!title || !names.length) return;
    clearTimeout(COLLAPSED_CUE_TIMER);
    title.textContent = names.length === 1 ? `↓ ${names[0]}` : `↓ ${names.length} creators`;
    ui.panel.classList.add('oh-tookIt');
    COLLAPSED_CUE_TIMER = setTimeout(() => {
      title.textContent = 'OnlyHaven Stripper';
      ui.panel.classList.remove('oh-tookIt');
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

  function apiUrl(path) {
    return `${ORIGIN}/api/v1/${path}`;
  }

  function fetchProfile(service, id) {
    return httpJson(apiUrl(`${encodeURIComponent(service)}/user/${encodeURIComponent(id)}/profile`));
  }

  function profileName(profile) {
    return String(profile && (profile.displayName || profile.name) || '').trim();
  }

  // Oldest first, so the pages arrive in the order the posts will be numbered.
  async function fetchAllPosts(service, id) {
    const out = [];
    const seen = new Set();
    let total = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (state.cancel) throw cancelledError();
      const offset = page * PAGE_SIZE;
      const data = await httpJson(apiUrl(`${encodeURIComponent(service)}/user/${encodeURIComponent(id)}/posts?o=${offset}&n=${PAGE_SIZE}&sort=oldest`));
      const posts = Array.isArray(data && data.posts) ? data.posts : [];
      if (Number.isFinite(Number(data && data.total))) total = Number(data.total);
      let added = 0;
      posts.forEach(post => {
        const pid = String(post && post.id || '');
        if (!pid || seen.has(pid)) return;
        seen.add(pid);
        out.push(post);
        added++;
      });
      const pages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : '?';
      setDisplay(ui.posts, `Reading page ${page + 1}/${pages}`);
      if (posts.length < PAGE_SIZE || !added || (total != null && out.length >= total)) break;
      await delay(PAGE_DELAY_MS);
    }
    return out;
  }

  function extOf(name) {
    const leaf = String(name || '').split(/[?#]/)[0].split('/').pop() || '';
    const dot = leaf.lastIndexOf('.');
    if (dot <= 0 || dot === leaf.length - 1) return '';
    return leaf.slice(dot + 1).toLowerCase();
  }

  function canonicalExt(ext) {
    const e = String(ext || '').toLowerCase();
    if (e === 'jpeg' || e === 'jpe') return 'jpg';
    if (e === 'tif') return 'tiff';
    return e;
  }

  // The original encode when there is one; otherwise the largest. Videos can
  // also carry 720p and 240p copies, which are never what you want to keep.
  function pickVariant(variants) {
    const list = (Array.isArray(variants) ? variants : []).filter(v => v && v.name);
    if (!list.length) return null;
    return list.find(v => /^original\./i.test(v.name))
      || list.slice().sort((a, b) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0))[0];
  }

  function filesForPost(raw) {
    const out = [];
    const seen = new Set();
    const attachments = (Array.isArray(raw && raw.attachments) ? raw.attachments : [])
      .slice()
      .sort((a, b) => (Number(a && a.position) || 0) - (Number(b && b.position) || 0));
    attachments.forEach(att => {
      if (!att || att.locked || !att.storageKey) return;
      if (seen.has(att.storageKey)) return;
      const variant = pickVariant(att.variants);
      if (!variant) return;
      seen.add(att.storageKey);
      const ext = canonicalExt(extOf(variant.name) || extOf(att.originalFilename)) || 'bin';
      // A "gif" here is an mp4, so the file decides, not the label.
      const kind = VIDEO_EXTS.has(ext) ? 'video' : IMAGE_EXTS.has(ext) ? 'image' : 'other';
      out.push({
        kind,
        ext,
        bytes: Number(variant.bytes) || Number(att.bytes) || 0,
        originalName: String(att.originalFilename || variant.name),
        url: `${FILE_HOST}/media/${encodeURIComponent(att.storageKey)}/${encodeURIComponent(variant.name)}`
      });
    });
    return out;
  }

  // Her posts with anything in them, numbered oldest first. A post with nothing
  // downloadable takes no number, so the numbers count posts you can have.
  function planCreator(creator, rawPosts) {
    const posts = rawPosts
      .map(raw => ({
        id: String(raw.id),
        published: Number(raw.published) || Number(raw.added) || 0,
        title: String(raw.title || '').trim(),
        captionHtml: String(raw.captionHtml || raw.caption || ''),
        files: filesForPost(raw)
      }))
      .filter(post => post.files.length)
      .sort((a, b) => (a.published - b.published) || a.id.localeCompare(b.id, undefined, { numeric: true }));
    posts.forEach((post, i) => {
      post.number = i + 1;
      post.dateSec = dateKey(post.published);
      post.caption = htmlToText(post.captionHtml);
      post.base = postBaseName(post, creator);
      post.videoOnly = post.files.every(f => f.kind === 'video');
    });
    return posts;
  }

  function rememberCreator(creator, posts) {
    saveCreatorRecord({
      key: creator.key,
      service: creator.service,
      id: creator.id,
      handle: creator.handle,
      name: creator.name,
      postIds: posts.map(p => p.id),
      postDates: posts.map(p => p.dateSec),
      videoOnly: posts.filter(p => p.videoOnly).map(p => p.id),
      readAt: Date.now()
    });
  }

  // --- naming ---------------------------------------------------------------
  //
  // OnlyHaven/<Creator>/<YYMMDD>-<Creator>-<000001> - <title>.zip, the post
  // Strippers' shape. The creator folder is her display name, as the Playboy
  // Stripper files a model under hers.

  function creatorDisplayName(rec) {
    if (!rec) return '';
    return String(rec.name || rec.handle || '').trim();
  }

  function creatorFolderName(creator) {
    return sanitizeNamePart(creator.name) || sanitizeNamePart(creator.handle) || `${creator.service}_${creator.id}`;
  }

  function creatorNameSection(creator) {
    return creatorFolderName(creator).slice(0, NAME_CHARS).trim();
  }

  function postTitleSection(post) {
    const firstLine = String(post.caption || '').split('\n').map(line => line.trim()).find(Boolean) || '';
    const title = clipAtWord(sanitizeNamePart(post.title || firstLine), NAME_CHARS);
    return title || `post_${post.id}`;
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

  function postBaseName(post, creator) {
    return `${post.dateSec}-${creatorNameSection(creator)}-${String(post.number).padStart(6, '0')} - ${postTitleSection(post)}`;
  }

  // The site's times are Unix seconds. UTC, so a late post is named for the day
  // the site says it went up wherever you are.
  function dateKey(unixSeconds) {
    const n = Number(unixSeconds);
    if (!Number.isFinite(n) || n <= 0) return '000000';
    const d = new Date(n * 1000);
    return String(d.getUTCFullYear() % 100).padStart(2, '0')
      + String(d.getUTCMonth() + 1).padStart(2, '0')
      + String(d.getUTCDate()).padStart(2, '0');
  }

  // Emoji go (they are most of a caption's first line here), and so does every
  // mark a file system refuses. " - " is squeezed to "-" so the one real " - "
  // in a name is the one before the title.
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
    if (!parts.length) return 'download.zip';
    return parts.map((seg, idx) => {
      let s = String(seg).normalize('NFC').replace(/[\uD800-\uDFFF�]/g, '').replace(/[\x00-\x1F\x7F]/g, '');
      s = strict ? s.replace(/[^A-Za-z0-9._ -]+/g, '') : s.replace(/[\\/:*?"<>|~]+/g, '');
      s = s.replace(/^[\s.]+|[\s.]+$/g, '').replace(/ +/g, ' ');
      return s || (idx === parts.length - 1 ? 'download.zip' : 'folder');
    }).join('/');
  }

  function htmlToText(html) {
    const source = String(html || '');
    if (!source.trim()) return '';
    let doc;
    try { doc = new DOMParser().parseFromString(`<div id="root">${source}</div>`, 'text/html'); } catch { return source; }
    const root = doc.getElementById('root');
    if (!root) return '';
    root.querySelectorAll('script, style').forEach(el => el.remove());
    root.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    root.querySelectorAll('a[href]').forEach(el => {
      const href = el.getAttribute('href') || '';
      const text = (el.textContent || '').trim();
      if (!/^https?:/i.test(href)) return;
      el.replaceWith(text && text !== href ? `[${text}](${href})` : href);
    });
    root.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr').forEach(el => el.append('\n\n'));
    return (root.textContent || '')
      .replace(/ /g, ' ')
      .split('\n')
      .map(line => line.replace(/[ \t]+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function postLink(creator, post) {
    return `${ORIGIN}/creators/${encodeURIComponent(creator.service)}/${encodeURIComponent(creator.id)}/post/${encodeURIComponent(post.id)}`;
  }

  function postTextFile(creator, post) {
    const heading = post.title || (String(post.caption || '').split('\n').map(l => l.trim()).find(Boolean)) || `post_${post.id}`;
    const lines = [`# ${heading}`, ''];
    lines.push(`- **Creator:** ${creator.name}${creator.handle ? ` (@${creator.handle})` : ''}`);
    lines.push(`- **Service:** ${creator.service}`);
    if (post.published) lines.push(`- **Posted:** ${new Date(post.published * 1000).toISOString().slice(0, 10)}`);
    lines.push(`- **Link:** ${postLink(creator, post)}`, '');
    if (post.caption) lines.push(post.caption, '');
    return lines.join('\n');
  }

  // --- the run --------------------------------------------------------------

  async function downloadCreator(job) {
    if (state.busy) { requestDownload(job); return; }
    state.cancel = false;
    state.currentJobKey = job.key;
    setBusy(true);
    resetLog();
    const label = job.name || `${job.service} ${job.id}`;
    setDisplay(ui.creator, label);
    setDisplay(ui.posts, 'Reading');
    setDisplay(ui.current, 'None');
    setDisplay(ui.files, '0/0');

    try {
      logLine(`Reading ${label}.`);
      const profile = await fetchProfile(job.service, job.id);
      const creator = {
        key: job.key,
        service: job.service,
        id: String(profile.id || job.id),
        handle: String(profile.name || ''),
        name: profileName(profile) || label
      };
      setDisplay(ui.creator, creator.name, `${creator.name} (@${creator.handle}, ${creator.service})`);

      const raw = await fetchAllPosts(creator.service, creator.id);
      const posts = planCreator(creator, raw);
      rememberCreator(creator, posts);
      refreshResultRows();
      renderStats();
      logLine(`${creator.name}: ${raw.length} post${raw.length === 1 ? '' : 's'}, ${posts.length} with something in ${posts.length === 1 ? 'it' : 'them'}.`);
      if (!posts.length) { logLine('Nothing to download.'); return; }

      let saved = 0;
      let already = 0;
      let ignored = 0;
      let failed = 0;
      const progress = () => setDisplay(ui.posts, `${saved}/${posts.length} done`
        + `${already ? `, ${already} already had` : ''}${ignored ? `, ${ignored} ignored` : ''}`
        + `${failed ? `, ${failed} failed` : ''}`);
      progress();

      for (let i = 0; i < posts.length; i++) {
        if (state.cancel) throw cancelledError();
        const post = posts[i];
        if (postIsHad(creator.key, post.id)) { already++; progress(); continue; }
        if (state.ignoreVideos && post.videoOnly) { ignored++; progress(); continue; }
        setDisplay(ui.current, post.base, `${post.base} (${post.id})`);
        try {
          await savePost(creator, post, i, posts.length);
          saved++;
        } catch (err) {
          if (isCancelledError(err)) throw err;
          failed++;
          logLine(`Post ${String(post.number).padStart(6, '0')} failed: ${errorMessage(err)}`);
        }
        progress();
        refreshResultRows();
        renderStats();
        scheduleCardRefresh();
        await delay(POST_DELAY_MS);
      }
      setProgress(100);
      logLine(`Finished ${creator.name}: ${saved} saved, ${already} already had, ${ignored} ignored, ${failed} failed.`);
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

  // One zip per post, holding one folder of loose files named for the post:
  // its files in the order the post shows them, then the caption. A file the
  // site has lost for good gets a small placeholder, so the post still counts
  // as handled; any other failure means the post is not saved and is tried
  // again next run — a silently partial post is worse than no post.
  async function savePost(creator, post, index, count) {
    const Zip = resolveJSZip();
    if (!Zip) throw new Error('JSZip is missing (the @require did not load)');
    const skipVideos = state.ignoreVideos;
    const files = post.files.filter(f => !(skipVideos && f.kind === 'video'));
    const droppedVideo = files.length < post.files.length;
    const base = post.base;
    const total = files.length;
    let done = 0;
    let gone = 0;
    const failures = [];
    const step = () => {
      setDisplay(ui.files, `${done}/${total}${gone ? `, ${gone} gone` : ''}`);
      setProgress(((index + (done / Math.max(1, total)) * 0.9) / count) * 100);
    };
    step();

    const fetchOne = async file => {
      try {
        if (file.kind === 'video' && file.bytes > VIDEO_SIZE_WARN_BYTES) {
          logLine(`A ${formatBytes(file.bytes)} video. It has to sit in memory to go in the zip.`);
        }
        file.data = await withRetry(() => httpBinary(file.url, file.kind === 'video' ? VIDEO_TIMEOUT_MS : BLOB_TIMEOUT_MS), 'file download');
      } catch (err) {
        if (isCancelledError(err)) throw err;
        if (err && MEDIA_GONE_STATUSES.has(err.httpStatus)) { file.gone = errorMessage(err); gone++; }
        else failures.push(errorMessage(err));
      }
      done++;
      step();
    };

    // Photos several at a time; videos one at a time, because each is the
    // whole post's weight in a single file.
    await runPool(files.filter(f => f.kind !== 'video'), IMAGE_CONCURRENCY, fetchOne);
    for (const file of files.filter(f => f.kind === 'video')) {
      if (state.cancel) throw cancelledError();
      await fetchOne(file);
    }
    if (state.cancel) throw cancelledError();
    if (failures.length) {
      files.forEach(f => { f.data = null; });
      throw new Error(`${failures.length} of ${total} file${total === 1 ? '' : 's'} could not be fetched (${failures[0]})`);
    }

    const zip = new Zip();
    files.forEach((file, i) => {
      const n = String(i + 1).padStart(6, '0');
      if (file.data) {
        zip.file(`${base}/${base}_${n}.${file.ext}`, file.data);
      } else {
        zip.file(`${base}/${base}_${n} MISSING MEDIA.txt`, [
          'This file is no longer on OnlyHaven.',
          '',
          `original file : ${file.originalName}`,
          `url           : ${file.url}`,
          `result        : ${file.gone}`,
          `recorded      : ${new Date().toISOString()}`,
          '',
          'It stands in for a file that cannot be fetched any more, so the post',
          'counts as handled. Delete it freely; nothing depends on it.'
        ].join('\n'));
      }
    });
    zip.file(`${base}/${base}.md`, postTextFile(creator, post));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, () => {
      if (state.cancel) throw cancelledError();
    });
    files.forEach(f => { f.data = null; });
    if (state.cancel) throw cancelledError();

    const name = `${ROOT_FOLDER}/${creatorFolderName(creator)}/${base}.zip`;
    await saveBlob(blob, name);
    markPostDownloaded(creator.key, post.id, droppedVideo);
    logLine(`Saved ${base}.zip (${total} file${total === 1 ? '' : 's'}, ${formatBytes(blob.size)})${gone ? ` — ${gone} gone from the site` : ''}${droppedVideo ? ', without its video' : ''}.`);
  }

  async function runPool(items, limit, worker) {
    const pending = items.slice();
    const lanes = new Array(Math.max(1, Math.min(limit, pending.length))).fill(0).map(async () => {
      while (pending.length) {
        if (state.cancel) return;
        await worker(pending.shift());
        await delay(FILE_DELAY_MS);
      }
    });
    await Promise.all(lanes);
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  // A real answer is final, except the two that mean "slow down" or "not now":
  // the site sits behind a DDoS shield that says 429 and 503 when pushed.
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
        await delay((status === 429 ? 4000 : 800) * Math.pow(2, attempt));
      }
    }
    throw lastErr || new Error(`${label} failed`);
  }

  // --- transport ------------------------------------------------------------
  //
  // The API is this site's own, so plain fetch reaches it with the site's
  // cookies (the DDoS shield wants them). The file host answers any site
  // (`Access-Control-Allow-Origin: *`), so fetch reaches that too; the
  // extension's own request function is the fallback for both.

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

  function gmRequest(url, kind, ms) {
    return withDeadline(kind === 'json' ? 'api request' : 'file request', ms, (ok, fail) => {
      const handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        responseType: kind === 'json' ? undefined : 'arraybuffer',
        headers: kind === 'json' ? { Accept: 'application/json' } : { Referer: `${ORIGIN}/` },
        timeout: ms,
        onload: res => {
          if (res.status < 200 || res.status >= 300) { fail(httpStatusError(res.status)); return; }
          if (kind === 'json') { ok(String(res.responseText || '')); return; }
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

  async function httpJsonOnce(url) {
    let text = '';
    try {
      const res = await nativeFetch(url, { credentials: 'include', headers: { Accept: 'application/json' } }, PAGE_TIMEOUT_MS, 'api fetch');
      if (!res.ok) {
        // The site's own "not found" is JSON with a 404; keep the status.
        throw httpStatusError(res.status);
      }
      text = await withDeadline('api read', PAGE_TIMEOUT_MS, (ok, fail) => { res.text().then(ok, fail); });
      noteTransport('fetch');
    } catch (err) {
      if (isCancelledError(err) || state.cancel) throw cancelledError();
      if (err && err.httpStatus) throw err;
      if (!hasGmRequest()) throw err;
      noteTransport('GM_xmlhttpRequest');
      text = await gmRequest(url, 'json', PAGE_TIMEOUT_MS);
    }
    try {
      return JSON.parse(text);
    } catch {
      // The DDoS shield answers with a page, not JSON, when it wants a check.
      throw new Error('the site answered with a page instead of data. Open any page on cum.st in this tab, let it load, and try again');
    }
  }

  function httpJson(url) {
    return withRetry(() => httpJsonOnce(url), 'api request');
  }

  async function httpBinary(url, timeoutMs) {
    const ms = timeoutMs || BLOB_TIMEOUT_MS;
    try {
      const res = await nativeFetch(url, { credentials: 'omit' }, ms, 'file fetch');
      if (!res.ok) throw httpStatusError(res.status);
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      if (/^(?:text\/html|application\/(?:json|xml|xhtml))/.test(type)) {
        throw new Error(`server returned ${type.split(';')[0]} instead of a file`);
      }
      const buffer = await withDeadline('file read', ms, (ok, fail) => { res.arrayBuffer().then(ok, fail); });
      if (!buffer || !buffer.byteLength) throw new Error('empty response');
      return buffer;
    } catch (err) {
      if (isCancelledError(err) || state.cancel) throw cancelledError();
      if (err && err.httpStatus) throw err;
      if (!hasGmRequest()) throw err;
    }
    return gmRequest(url, 'arraybuffer', ms);
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
        logLine('Saving through the browser instead; the zip lands loose in Downloads.');
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = names[0].split('/').pop() || 'onlyhaven_post.zip';
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
  // Point it at your OnlyHaven folder (or any folder above or inside it). Every
  // zip or unpacked post folder named the Stripper way is read for its date,
  // its creator and its number; the number says which post it is, and the date
  // has to agree. For each creator the script has read before, what is in the
  // folder then *becomes* her download record. Creators found in the folder
  // that the script has never read are named, so they can be dropped once.

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
      if (!found.size) { setFootNote('No OnlyHaven posts in that folder.'); return; }

      const bySection = new Map();
      Object.values(loadCreators()).forEach(rec => {
        if (!Array.isArray(rec.postIds)) return;
        const creator = { service: rec.service, id: rec.id, name: rec.name, handle: rec.handle };
        bySection.set(creatorNameSection(creator).toLowerCase(), rec);
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
          const i = Number(number) - 1;
          const id = rec.postIds[i];
          const recDate = (rec.postDates || [])[i];
          if (id && (!recDate || recDate === date)) had.add(String(id));
          else stray++;
        });
        writeIdSet(downloadedCache, KEYS.downloaded, rec.key, had);
        const owed = owedSet(rec.key);
        const keptOwed = new Set([...owed].filter(id => had.has(id)));
        if (keptOwed.size !== owed.size) writeIdSet(owedCache, KEYS.owed, rec.key, keptOwed);
        matchedCreators++;
        matchedPosts += had.size;
      });
      forgetAllFigures();

      const lines = [`Checked ${matchedCreators} creator${matchedCreators === 1 ? '' : 's'}: ${matchedPosts} post${matchedPosts === 1 ? '' : 's'} on disk.`];
      if (stray) lines.push(`${stray} file${stray === 1 ? '' : 's'} did not match a post as last read; drop that creator again and check once more.`);
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
  // creator's posts is kept, so fractions still show.
  function resetDownloads() {
    if (state.busy) return;
    const keys = gmKeys(KEYS.downloaded);
    if (!keys.length) return;
    if (!window.confirm('Forget every OnlyHaven download? Every creator will read as not downloaded. Files on disk are not touched.')) return;
    keys.forEach(gmDelete);
    gmKeys(KEYS.owed).forEach(gmDelete);
    downloadedCache.clear();
    owedCache.clear();
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
      ui.stats.textContent = `Posts ${have}/${posts} · Creators ${done}/${recs.length}`;
      ui.stats.title = `${have} of ${posts} posts downloaded, across ${recs.length} creator${recs.length === 1 ? '' : 's'} read so far. ${done} complete.`;
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

  // The site carries an ExoClick pop-under that turns the first real click on
  // the page into a redirect to an ad site — a click on this panel included,
  // which throws away whatever download was running. The ad shows once per
  // twelve hours, and remembers that it has in a `zone-cap-<zone>` cookie
  // holding "<count>;<unix time>". Writing that cookie before the ad's own
  // script runs, and keeping it fresh, means the ad always believes it has
  // just been shown. The zone is read off the page too, in case it changes.
  const POPUNDER_ZONES = new Set(['4680']);

  function holdOffPopunder() {
    const stamp = () => {
      try {
        document.querySelectorAll('script:not([src])').forEach(script => {
          const m = String(script.text || '').match(/"idzone"\s*:\s*"?(\d+)/);
          if (m) POPUNDER_ZONES.add(m[1]);
        });
      } catch {}
      const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toUTCString();
      const value = encodeURIComponent(`1;${Math.floor(Date.now() / 1000)}`);
      POPUNDER_ZONES.forEach(zone => {
        try { document.cookie = `zone-cap-${zone}=${value}; expires=${expires}; path=/`; } catch {}
      });
    };
    stamp();
    document.addEventListener('DOMContentLoaded', stamp, { once: true });
    setInterval(stamp, 5 * 60 * 1000);
  }

  // The hiding sheets go in before the page draws anything, so a post you have
  // never flashes up first; the panel waits for the page to exist.
  holdOffPopunder();
  applyCardHideStyle();
  installPageObserver();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
