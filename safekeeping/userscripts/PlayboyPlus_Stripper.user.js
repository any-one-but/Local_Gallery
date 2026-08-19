// ==UserScript==
// @name         Playboy Plus Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.00
// @description  Playboy Plus gallery downloader. Queue galleries from any page and eat through them one at a time, named by model and date.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/PlayboyPlus_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/PlayboyPlus_Stripper.user.js
// @match        *://members.playboyplus.com/*
// @match        *://*.playboyplus.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      self
// @connect      playboyplus.com
// @connect      *.playboyplus.com
// @connect      gammacdn.com
// @connect      *.gammacdn.com
// @connect      algolia.net
// @connect      *.algolia.net
// @connect      algolianet.com
// @connect      *.algolianet.com
// @run-at       document-start
// ==/UserScript==

// ===========================================================================
// WHAT THIS IS
// ===========================================================================
// The Zishy Stripper, rebuilt for Playboy Plus. Same panel, same queue, same
// naming, same history. What had to change is where the information comes from.
//
// Zishy is a plain HTML site: an album page carries its own photo links, and a
// listing page carries its album links, so everything could be read by fetching
// pages and looking at them. Playboy Plus is not. Its listing pages arrive as an
// empty shell and fill themselves in afterwards, so a fetched /en/updates has
// literally nothing in it — no albums, no links, nothing to walk. Its galleries
// hand out photo URLs that are individually signed and expire, so no URL can be
// guessed or built by hand.
//
// So this script talks to the same three places the site's own pages talk to:
//
//   1. Algolia, the search service behind every listing on the site. The site
//      ships its own credentials in `window.env.api.algolia` on every page, and
//      the indexes (`all_photosets`, `all_scenes`, `all_actors`) hold the whole
//      catalogue: ids, titles, publication dates, models, picture counts and the
//      clip id of the bonus video. This is where the queue, the model expansion
//      and the completion index all come from, and it is why indexing the site
//      takes seconds rather than the thousand page fetches Zishy needed.
//   2. /media/signPhotoset/<id> on members.playboyplus.com, which answers with
//      the signed full-size URL of every photo in the gallery. This is what the
//      site's own viewer uses, and it is the only way to a full-size photo.
//   3. /movieaction/download/<clip>/<size>/mp4 for the bonus video, which is the
//      link behind the page's own VIDEOS button.
//
// All three need your subscription — signed out, (2) and (3) return nothing.
// Nothing here bypasses anything; it is your download tier, automated.
//
// ===========================================================================

(function () {
  'use strict';

  if (!/(?:^|\.)playboyplus\.com$/i.test(location.hostname)) return;
  if (window.__playboyStripperLoaded) return;
  window.__playboyStripperLoaded = true;

  // ===========================================================================
  // CONFIG — page furniture to hide
  // ===========================================================================
  // Any CSS selector listed here is hidden outright. This is for turning gallery
  // pages into fast, light link-collecting surfaces while you queue in bulk:
  // nothing here affects downloading, because a download never reads the visible
  // page — it asks the site for the gallery's files directly.
  //
  // Add or remove lines freely. The eye button in the panel toggles the whole
  // list off and on without editing anything.

  const HIDE_SELECTORS = [
    // The photos inside a gallery. Deliberately narrower than "every image", so
    // the covers on listing pages survive and you can still tell galleries apart.
    'img[src*="/photo_set/"]',

    // The full-width photo across the top of a gallery page.
    'img[src*="contentHero"]',

    // --- more things worth hiding; uncomment to taste ---------------------
    // 'img[src*="/media/photoset-"]',   // covers on listings too (fully blind browsing)
    // '[class*="Comments"]',            // the comment thread
    // '[class*="PhotosetPlayer"]',      // the whole gallery player block
    // '[class*="Carousel"]'             // the "you might also like" rails
  ];

  // A separate system from the selector list above, sharing its eye button: any
  // gallery card on the site whose set is already in the download history is
  // hidden, as is any model card whose sets are all downloaded. Browsing then
  // shows only what you have not got. The eye reveals both systems at once.
  //
  // "Already downloaded" here means exactly what the queue would skip — so with
  // Download set to Images, a gallery you took the images of counts as had, and
  // in All Files mode it does not until its video is in too. A model is hidden
  // only on the strict reading: every one of her sets completely downloaded.
  const HIDE_DOWNLOADED = true;

  // Off, and not an oversight. Zishy's pages are plain HTML, so stripping an
  // image's src as it was parsed cancelled the request before it left. Here the
  // page builds and rebuilds its own images in JavaScript and will simply put
  // the src back, so the two would sit there fighting over one attribute all
  // afternoon. Hiding is CSS-only, which means hidden images are still fetched.
  const BLOCK_HIDDEN_IMAGE_LOADS = false;

  // ===========================================================================
  // CONFIG — behaviour
  // ===========================================================================

  // Everything the downloader asks for lives on the members host, whichever part
  // of the site you happen to be reading.
  const ORIGIN = /^members\./i.test(location.hostname)
    ? location.origin
    : 'https://members.playboyplus.com';

  // The defaults are deliberately unhurried; a bulk run is meant to be left
  // alone, not raced.
  const PAGE_DELAY_MS = 400;     // between catalogue queries
  const ALBUM_DELAY_MS = 800;    // between galleries in a queue run
  const FILE_DELAY_MS = 120;     // between photo fetches within one lane
  const IMAGE_CONCURRENCY = 3;

  const MAX_RETRIES = 2;
  const PAGE_TIMEOUT_MS = 45000;
  const BLOB_TIMEOUT_MS = 180000;
  const VIDEO_TIMEOUT_MS = 3600000;  // a 4K clip is over a gigabyte; give it an hour
  const SAVE_TIMEOUT_MS = 20000;
  const MIN_INDEX_PAD = 3;
  const MAX_TITLE_CHARS = 56;

  // Everything lands under one folder in your downloads directory, so a bulk run
  // does not scatter model folders across whatever else is in there.
  const ROOT_FOLDER = 'PlayboyPlus';

  // What the file-kind cycler starts on: 'all', 'images' or 'videos'. A gallery
  // often carries a video alongside its photos. Absent or unreachable videos are
  // logged and skipped — they never fail a gallery.
  const DEFAULT_FILE_FILTER = 'all';
  const FILE_FILTERS = ['all', 'images', 'videos'];
  const FILE_FILTER_LABELS = { all: 'All Files', images: 'Images', videos: 'Videos' };

  // Which encode of the video to take. 'best' means the largest the gallery
  // offers, which on newer sets is 4K and runs to about 1.3 GB apiece — fine for
  // one gallery, quite a lot for a run of four hundred. 1080p is the default for
  // that reason and the panel button changes it in one click. Anything not on
  // offer for a given gallery steps down to the next size below it.
  const VIDEO_QUALITIES = ['best', '1080p', '720p', '480p'];
  const DEFAULT_VIDEO_QUALITY = '1080p';
  // Largest first. This is the order a step-down walks.
  const VIDEO_QUALITY_ORDER = ['4k', '2160p', '1440p', '1080p', '960p', '720p', '540p', '480p', '432p', '360p', '288p', '240p', '160p'];

  // Videos are saved beside the zip rather than inside it. A browser builds a zip
  // in memory, and a gigabyte of video in memory is how a tab dies; saved on its
  // own it streams to disk and costs nothing. The name is the same either way, so
  // the pair sits together in the model's folder:
  //   <YYMMDD>-<Model> - <Title>.zip
  //   <YYMMDD>-<Model> - <Title>.mp4
  const ZIP_VIDEOS = false;

  // A gallery that yields fewer photos than it declares means you are signed out,
  // your subscription does not cover downloads, or the page shape changed.
  // Refusing is the honest default: a silently partial gallery is worse than no
  // gallery.
  const ALLOW_PARTIAL_ALBUMS = false;

  // Gallery with no model on it. Falls back to this folder rather than guessing
  // a name out of the URL slug.
  const UNTAGGED_FOLDER = '_Untagged';

  // How a two-model gallery's names are joined. "and" rather than "&", because
  // the strict filename pass strips an ampersand and leaves a double space
  // behind it.
  const MODEL_JOIN = ' and ';

  // Mashups and group sets run to five or six models, and a folder named after
  // all of them is a folder nobody can read. Past this many, the set goes in one
  // shared folder and its filename keeps only the date and the title.
  const MAX_MODELS_IN_NAME = 2;
  const MULTI_MODEL_FOLDER = '_Various';

  // Nearly every title on this site reads "<Model> in <Something>". Stripping the
  // model off the front, the way Zishy does, would leave "In Something" on
  // thousands of files. With this on the leading connector goes too.
  const STRIP_LEADING_IN = true;

  // Per-tab only, and deliberately not GM storage: gathering links here is a full
  // page load every time, so an in-memory queue would evaporate the moment you
  // went looking for the next gallery. sessionStorage survives those loads and
  // dies with the tab, so nothing is left on disk.
  const QUEUE_KEY = 'PlayboyStripper.queue.v1';
  const FILTER_KEY = 'PlayboyStripper.filter.v1';
  const FORCE_KEY = 'PlayboyStripper.force.v1';
  const LINKMODE_KEY = 'PlayboyStripper.linkmode.v1';
  const QUALITY_KEY = 'PlayboyStripper.quality.v1';

  // Set while a run is going and cleared when it stops on purpose. Browsing
  // during a run no longer unloads the page (see "browsing during a run"), so
  // finding this still set at startup means the document went down under the run
  // rather than with it — a reload, a typed address, a link off the site — and
  // the queue picks itself back up instead of sitting there stopped and waiting
  // to be noticed.
  const RUNNING_KEY = 'PlayboyStripper.running.v1';

  // The one thing this script leaves on disk, and deliberately so: a record of
  // what has already been saved is only useful if it outlives the tab. It is
  // localStorage rather than GM storage so the Clear button and the browser's own
  // "clear site data" both reach it — losing it costs re-downloads, nothing more.
  const HISTORY_KEY = 'PlayboyStripper.history.v1';

  // The completion index: what the site actually holds, so "downloaded" has a
  // denominator. Built on demand and stored beside the history.
  const INDEX_KEY = 'PlayboyStripper.index.v1';

  // Sized to hold the whole site at once: ~15,600 galleries plus the ~4,700 model
  // entries that expand into them, with headroom. Entries are tiny, so even a
  // full queue is comfortably inside sessionStorage.
  const QUEUE_LIMIT = 25000;

  // Algolia, the search service the site's own listings run on. The indexes are
  // the same three the site queries; the credentials are read off the page.
  const ALGOLIA_PHOTOSETS = 'all_photosets';
  const ALGOLIA_SCENES = 'all_scenes';
  const ALGOLIA_ACTORS = 'all_actors';
  // Algolia caps a page at 1000. Smaller pages cost more requests but each one
  // comes back faster and a stopped index loses less.
  const ALGOLIA_PAGE_SIZE = 500;
  const ALGOLIA_MAX_PAGES = 200;

  // ===========================================================================

  const state = {
    busy: false,
    cancel: false,
    abortQueue: false,
    queueRunning: false,
    crawling: false,
    hidden: true,
    fileFilter: DEFAULT_FILE_FILTER,
    videoQuality: DEFAULT_VIDEO_QUALITY,
    linkMode: 'added',
    force: false,
    indexing: false,
    history: new Map(),
    index: null,
    transport: '',
    algolia: null,
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

  // --- the site's own search credentials -------------------------------------
  //
  // Every page on the site ships them in an inline script as `window.env`, because
  // the page's own listings are built in the browser out of the same queries this
  // script makes. Three ways to reach it, because a userscript may be sandboxed
  // away from the page's variables: the page's window if the manager exposes it,
  // this window if it does not sandbox, and failing both, the HTML the value was
  // written into. The last one is what makes it work on a page whose script has
  // not run yet.
  //
  // The key is scoped to the session, so it is read fresh per page load and never
  // stored.

  function readAlgoliaCredentials() {
    if (state.algolia) return state.algolia;
    const fromEnv = env => {
      const algolia = env && env.api && env.api.algolia;
      if (!algolia || !algolia.applicationID || !algolia.apiKey) return null;
      return { appId: String(algolia.applicationID), apiKey: String(algolia.apiKey) };
    };
    let found = null;
    try { if (typeof unsafeWindow !== 'undefined') found = fromEnv(unsafeWindow.env); } catch {}
    if (!found) { try { found = fromEnv(window.env); } catch {} }
    if (!found) found = algoliaCredentialsFromHtml(document.documentElement ? document.documentElement.innerHTML : '');
    if (found) state.algolia = found;
    return found;
  }

  function algoliaCredentialsFromHtml(html) {
    const text = String(html || '');
    const appId = text.match(/"applicationID"\s*:\s*"([^"]+)"/);
    const apiKey = text.match(/"apiKey"\s*:\s*"([^"]+)"/);
    if (!appId || !apiKey) return null;
    return { appId: appId[1], apiKey: apiKey[1] };
  }

  function requireAlgolia() {
    const creds = readAlgoliaCredentials();
    if (!creds) {
      throw new Error('the site has not handed over its search credentials — reload the page while signed in');
    }
    return creds;
  }

  // One query against one index. `params` is the site's own query-string form.
  async function algoliaSearch(indexName, params) {
    const creds = requireAlgolia();
    const url = `https://${creds.appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
    const body = JSON.stringify({ requests: [{ indexName, params }] });
    const raw = await withRetry(() => httpPostJson(url, body, {
      'X-Algolia-Application-Id': creds.appId,
      'X-Algolia-API-Key': creds.apiKey
    }), 'catalogue query');
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('the catalogue answered with something that was not a result'); }
    if (!parsed || !parsed.results || !parsed.results[0]) {
      throw new Error(parsed && parsed.message ? String(parsed.message) : 'the catalogue returned nothing');
    }
    return parsed.results[0];
  }

  function algoliaParams(options) {
    const parts = ['query='];
    Object.keys(options || {}).forEach(key => {
      const value = options[key];
      if (value === undefined || value === null || value === '') return;
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    });
    return parts.join('&');
  }

  // Walks every page of a query. `onPage` is given the hits and the page number
  // and returning false stops the walk, the same shape the crawl and the index
  // both want.
  async function algoliaWalk(indexName, options, onPage) {
    for (let page = 0; page < ALGOLIA_MAX_PAGES; page++) {
      if (state.cancel) throw new Error('cancelled');
      const result = await algoliaSearch(indexName, algoliaParams(
        Object.assign({ hitsPerPage: ALGOLIA_PAGE_SIZE, page }, options)
      ));
      const hits = result.hits || [];
      if (!hits.length) return;
      if (onPage(hits, page, result) === false) return;
      if (page + 1 >= (result.nbPages || 0)) return;
      await delay(PAGE_DELAY_MS);
    }
  }

  // The gallery record: title, publication date, models, picture count and the
  // clip id of its video. Everything the naming and the scan need, in one query.
  async function photosetById(setId) {
    const result = await algoliaSearch(ALGOLIA_PHOTOSETS, algoliaParams({
      hitsPerPage: 1,
      filters: `set_id=${Number(setId)}`
    }));
    return (result.hits && result.hits[0]) || null;
  }

  async function sceneByClipId(clipId) {
    const result = await algoliaSearch(ALGOLIA_SCENES, algoliaParams({
      hitsPerPage: 1,
      filters: `clip_id=${Number(clipId)}`
    }));
    return (result.hits && result.hits[0]) || null;
  }

  async function actorById(actorId) {
    const result = await algoliaSearch(ALGOLIA_ACTORS, algoliaParams({
      hitsPerPage: 1,
      filters: `actor_id=${Number(actorId)}`
    }));
    return (result.hits && result.hits[0]) || null;
  }

  function targetFromPhotosetHit(hit) {
    return {
      kind: 'album',
      id: String(hit.set_id),
      slug: String(hit.url_title || ''),
      name: sanitizeNamePart(hit.title || '') || titleFromSlug(hit.url_title)
    };
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
    hideStyleEl.id = 'playboyStripperHideRules';
    hideStyleEl.textContent = `${selectors.join(',\n')} { display: none !important; }`;
    (document.head || document.documentElement).appendChild(hideStyleEl);
  }

  // --- hiding what you already have -----------------------------------------
  //
  // Marking is a class on the card and the rule lives in its own stylesheet, so
  // revealing is one `disabled = true` rather than a re-scan — and re-hiding does
  // not have to find everything again.
  //
  // The card is found by structure, not by class name. Every class on this site
  // is a build hash beside a component name, and both change when the site is
  // rebuilt; the shape of a grid does not. So: start at the link, climb while the
  // parent still holds exactly one gallery-or-model link, and hide where that
  // stops. A container holding several is the grid, not the card.
  const CARD_CLIMB_LIMIT = 5;
  // Landmarks that are page furniture rather than a card, in case a listing is
  // ever rendered with a single entry on it.
  const CARD_CLIMB_STOP = 'body, main, header, footer, nav, #root, #app';
  // Links that are navigation on a page you deliberately opened. The model chips
  // under a gallery are the important ones: they name who you are looking at, and
  // hiding one because she is complete would remove the way back to her.
  const CARD_SKIP_WITHIN = '#playboyStripperPanel, header, footer, nav, [class*="Breadcrumb"], [class*="TitleBlock"], [class*="Header-"]';

  function applyDownloadedHideStyle() {
    if (!HIDE_DOWNLOADED) return;
    downloadedStyleEl = document.createElement('style');
    downloadedStyleEl.id = 'playboyStripperDownloadedRules';
    downloadedStyleEl.textContent = '.pbGot { display: none !important; }';
    (document.head || document.documentElement).appendChild(downloadedStyleEl);
  }

  function isModelComplete(actorId) {
    const index = state.index;
    if (!index) return false;
    const model = index.models[String(actorId)];
    const hers = model && model.a ? model.a : [];
    if (!hers.length) return false;
    return hers.every(id => historySatisfies(id, 'all'));
  }

  // What this link offers, or null when it is not an offer at all.
  function linkTarget(anchor) {
    try { if (anchor.closest(CARD_SKIP_WITHIN)) return null; } catch {}
    return targetFromUrl(anchor.getAttribute('href'), location.href);
  }

  function targetLinkCount(node) {
    return Array.from(node.querySelectorAll('a[href]')).filter(linkTarget).length;
  }

  // Whether there is any point looking at what this link leads to.
  function targetIsHad(target) {
    if (!target) return false;
    if (target.kind === 'model') return isModelComplete(target.id);
    return historySatisfies(target.id, state.fileFilter);
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
  // download completes, the history is cleared, an index finishes, or the
  // file-kind cycler moves and redefines what "had" means.
  //
  // It is a full pass rather than an incremental one because the climb needs a
  // settled DOM: mid-render, a grid that will hold thirty entries holds one, and
  // an incremental mark would climb straight past the card and hide the grid.
  function refreshDownloadedCards() {
    if (!HIDE_DOWNLOADED || !document.body) return;
    Array.from(document.querySelectorAll('.pbGot')).forEach(el => el.classList.remove('pbGot'));
    Array.from(document.querySelectorAll('a[href]')).forEach(anchor => {
      const target = linkTarget(anchor);
      if (!targetIsHad(target)) return;
      cardForAnchor(anchor).classList.add('pbGot');
    });
    updateEyeButton();
  }

  function hiddenCardCount() {
    try { return document.querySelectorAll('.pbGot').length; } catch { return 0; }
  }

  // One observer for both jobs. Image blocking is per-node and has to happen the
  // instant the node appears, or the request is already away. Card hiding is the
  // opposite: it needs the DOM to have settled, so it is coalesced into one full
  // pass on a short timer — which matters far more here than on a plain HTML
  // site, because this page rebuilds its grids as you scroll.
  function installEarlyObserver() {
    const combined = BLOCK_HIDDEN_IMAGE_LOADS ? hideSelectorList().join(',') : '';
    let cardPass = 0;
    const scheduleCardPass = () => {
      if (!HIDE_DOWNLOADED) return;
      clearTimeout(cardPass);
      cardPass = setTimeout(refreshDownloadedCards, 120);
    };

    const strip = img => {
      if (!combined || !img || img.dataset.pbBlocked) return;
      let matches = false;
      try { matches = img.matches(combined); } catch { return; }
      if (!matches) return;
      img.dataset.pbBlocked = img.getAttribute('src') || '';
      img.dataset.pbBlockedSet = img.getAttribute('srcset') || '';
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
      Array.from(document.querySelectorAll('img[data-pb-blocked]')).forEach(img => {
        const src = img.dataset.pbBlocked;
        const set = img.dataset.pbBlockedSet;
        delete img.dataset.pbBlocked;
        delete img.dataset.pbBlockedSet;
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
    panel.id = 'playboyStripperPanel';
    panel.innerHTML = `
      <div class="pb-head">
        <span class="pb-title">Playboy Plus Stripper</span>
        <button id="pbEye" class="pb-iconBtn" type="button" title="Show hidden page elements">🙈</button>
        <button id="pbCollapse" class="pb-iconBtn" type="button" title="Collapse">&#9652;</button>
      </div>
      <div class="pb-body">
        <button id="pbGo" type="button">Download Gallery</button>
        <div class="pb-cycles">
          <button id="pbFilter" class="pb-cycle" type="button" title="What gets downloaded">Download: All Files</button>
          <button id="pbQuality" class="pb-cycle" type="button" title="Which encode of the video to take. Best is 4K where a gallery offers it, and around 1.3 GB a time.">Video: 1080p</button>
          <button id="pbForce" class="pb-cycle" type="button" title="Whether galleries already in the history are downloaded again">Duplicates: Skip</button>
          <button id="pbLinkMode" class="pb-cycle" type="button" title="As added: queue what you give it. To model: resolve every gallery to its model and queue her whole catalogue instead.">Links: As added</button>
        </div>
        <div class="pb-progress"><div id="pbFill"></div></div>
        <div class="pb-meta">
          <span id="pbAlbum">No gallery</span>
          <span id="pbCount">0 photos</span>
        </div>
        <div id="pbDrop" class="pb-drop">Drop gallery links here</div>
        <div class="pb-queueHead"><span id="pbQueueCount">Queue empty</span></div>
        <div class="pb-queueBtns">
          <button id="pbAdd" class="pb-miniBtn" type="button" title="Queue the gallery on this page">+ This</button>
          <button id="pbAddPage" class="pb-miniBtn" type="button" title="Queue every gallery linked on this page">+ Page</button>
          <button id="pbAddAll" class="pb-miniBtn" type="button" title="Queue everything this listing covers, straight out of the catalogue">+ All</button>
          <button id="pbClear" class="pb-miniBtn" type="button" title="Clear the queue">Clear</button>
        </div>
        <div id="pbQueue" class="pb-queue" hidden></div>
        <div class="pb-histHead">
          <span id="pbHistCount">History empty</span>
          <button id="pbHistClear" class="pb-miniBtn pb-histBtn" type="button" title="Forget every gallery already downloaded">Clear</button>
        </div>
        <div class="pb-histHead">
          <span id="pbStats">No index — press Index</span>
          <button id="pbIndex" class="pb-miniBtn pb-histBtn" type="button" title="Read the catalogue once to learn how many sets and models exist">Index</button>
        </div>
        <button id="pbStart" type="button" disabled>Start Queue</button>
        <div id="pbLog" class="pb-log" aria-live="polite"></div>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.go = panel.querySelector('#pbGo');
    ui.fill = panel.querySelector('#pbFill');
    ui.album = panel.querySelector('#pbAlbum');
    ui.count = panel.querySelector('#pbCount');
    ui.log = panel.querySelector('#pbLog');
    ui.drop = panel.querySelector('#pbDrop');
    ui.queue = panel.querySelector('#pbQueue');
    ui.queueCount = panel.querySelector('#pbQueueCount');
    ui.add = panel.querySelector('#pbAdd');
    ui.addPage = panel.querySelector('#pbAddPage');
    ui.addAll = panel.querySelector('#pbAddAll');
    ui.clear = panel.querySelector('#pbClear');
    ui.start = panel.querySelector('#pbStart');
    ui.eye = panel.querySelector('#pbEye');
    ui.filter = panel.querySelector('#pbFilter');
    ui.quality = panel.querySelector('#pbQuality');
    ui.force = panel.querySelector('#pbForce');
    ui.linkMode = panel.querySelector('#pbLinkMode');
    ui.histCount = panel.querySelector('#pbHistCount');
    ui.histClear = panel.querySelector('#pbHistClear');
    ui.stats = panel.querySelector('#pbStats');
    ui.index = panel.querySelector('#pbIndex');

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
      if (!target) { logLine('This page is not a gallery or a model.'); return; }
      reportQueued(addToQueue([target]));
    });
    ui.addPage.addEventListener('click', () => {
      const targets = targetsFromDocument(document, location.href);
      if (!targets.length) { logLine('No gallery or model links on this page.'); return; }
      const kind = targets[0].kind === 'model' ? 'model' : 'gallery';
      logLine(`Found ${targets.length} ${kind} link${targets.length === 1 ? '' : 's'} on this page.`);
      reportQueued(addToQueue(targets));
    });
    ui.addAll.addEventListener('click', () => {
      if (state.crawling) { state.cancel = true; logLine('Stopping...'); return; }
      crawlListing().catch(err => logLine(`Could not read the catalogue: ${errorMessage(err)}`));
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
    ui.quality.addEventListener('click', () => {
      const next = (VIDEO_QUALITIES.indexOf(state.videoQuality) + 1) % VIDEO_QUALITIES.length;
      setVideoQuality(VIDEO_QUALITIES[next]);
      logLine(state.videoQuality === 'best'
        ? 'Videos: the largest encode each gallery offers. On newer sets that is 4K, over a gigabyte apiece.'
        : `Videos: ${state.videoQuality}, stepping down when a gallery does not have it.`);
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
    panel.querySelector('#pbCollapse').addEventListener('click', () => {
      panel.classList.toggle('pb-collapsed');
      panel.querySelector('#pbCollapse').innerHTML = panel.classList.contains('pb-collapsed') ? '&#9662;' : '&#9652;';
    });

    // History, index and the file filter were already read at document-start so
    // the card observer could use them; only the toggles the observer does not
    // need are loaded here.
    setFileFilter(state.fileFilter);
    loadVideoQuality();
    loadForce();
    loadLinkMode();
    setHidden(true);
    installRouteObserver();
    installSoftNavigation();
    loadQueue();
    renderHistory();
    renderStats();
    renderQueue();
    syncContext();
    // The body existed before the observer did, so anything already parsed has
    // not been judged yet.
    refreshDownloadedCards();
    resumeInterruptedRun();
  }

  // A run was going when this document went down. Since browsing during a run
  // keeps the page alive, that means something the script cannot intercept took
  // it — a reload, a typed address, a link off the site — so the run is picked
  // up rather than left stopped for the user to discover later.
  function resumeInterruptedRun() {
    let wasRunning = '';
    try { wasRunning = sessionStorage.getItem(RUNNING_KEY) || ''; } catch {}
    if (wasRunning !== '1') return;
    if (!pendingQueueEntries().length) {
      try { sessionStorage.removeItem(RUNNING_KEY); } catch {}
      return;
    }
    logLine('A run was interrupted by a page load; picking it back up.');
    runQueue().catch(err => logLine(`Queue failed: ${errorMessage(err)}`));
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

  function setVideoQuality(quality) {
    state.videoQuality = VIDEO_QUALITIES.indexOf(quality) >= 0 ? quality : DEFAULT_VIDEO_QUALITY;
    if (ui.quality) {
      ui.quality.textContent = `Video: ${state.videoQuality === 'best' ? 'Best' : state.videoQuality}`;
      ui.quality.classList.toggle('pb-qualityHigh', state.videoQuality === 'best');
    }
    try { sessionStorage.setItem(QUALITY_KEY, state.videoQuality); } catch {}
  }

  function loadVideoQuality() {
    let stored = '';
    try { stored = sessionStorage.getItem(QUALITY_KEY) || ''; } catch {}
    setVideoQuality(stored || DEFAULT_VIDEO_QUALITY);
  }

  function wantsKind(kind) {
    if (state.fileFilter === 'images') return kind === 'image';
    if (state.fileFilter === 'videos') return kind === 'video';
    return true;
  }

  // 'added' queues what you gave it. 'model' treats every gallery link as a
  // pointer to whoever is in it: the gallery is resolved to its models and they
  // are queued instead, which then expands to their whole catalogue. Dragging in
  // one set you liked therefore fetches everything she has done.
  function setLinkMode(mode) {
    state.linkMode = mode === 'model' ? 'model' : 'added';
    if (ui.linkMode) {
      ui.linkMode.textContent = `Links: ${state.linkMode === 'model' ? 'To model' : 'As added'}`;
      ui.linkMode.classList.toggle('pb-linkModeOn', state.linkMode === 'model');
    }
    try { sessionStorage.setItem(LINKMODE_KEY, state.linkMode); } catch {}
  }

  function loadLinkMode() {
    let stored = '';
    try { stored = sessionStorage.getItem(LINKMODE_KEY) || ''; } catch {}
    setLinkMode(stored);
  }

  // Galleries that a model expanded into are already hers; resolving them would
  // cost a query only to rediscover the model that produced them.
  function needsModelResolution(entry) {
    return state.linkMode === 'model' && entry.kind !== 'model' && !entry.viaModel;
  }

  function setForce(force) {
    state.force = !!force;
    if (ui.force) {
      ui.force.textContent = `Duplicates: ${state.force ? 'Redownload' : 'Skip'}`;
      ui.force.classList.toggle('pb-forceOn', state.force);
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
  // Keyed by gallery id, recording which file-kind modes have actually completed
  // for it — because a gallery saved in Images mode is not a duplicate when you
  // come back for its video. Flags are 'a' (all), 'i' (images) and 'v' (videos).
  //
  // A record means files were written. A gallery that produced nothing is never
  // recorded, which keeps the history from filling with conclusions like "this
  // one has no video" that are really statements about the detector rather than
  // about the gallery.

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
      ? `History: ${size} galler${size === 1 ? 'y' : 'ies'}`
      : 'History empty';
    ui.histClear.disabled = !size;
  }

  // --- completion index -----------------------------------------------------
  //
  // "Downloaded 412 sets" means nothing without a denominator, so the index is a
  // snapshot of what the site holds: every gallery id, and every model with the
  // galleries that are hers.
  //
  // On Zishy this cost around a thousand page fetches and had to be split into
  // phases so a stopped run left something usable. Here it is one read of the
  // catalogue: each gallery record already lists its models, so a single pass
  // builds both halves at once, in about thirty queries. It is still saved as it
  // goes, so stopping halfway leaves a partial index rather than nothing.

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
    ui.index.classList.add('pb-stop');
    const index = { t: Date.now(), albums: [], models: {}, complete: false };
    const albums = new Set();
    try {
      logLine('Reading the catalogue. This is read-only and can be stopped at any time.');
      await algoliaWalk(ALGOLIA_PHOTOSETS, {
        attributesToRetrieve: JSON.stringify(['set_id', 'actors'])
      }, (hits, page, result) => {
        hits.forEach(hit => {
          const setId = String(hit.set_id || '');
          if (!/^\d+$/.test(setId) || albums.has(setId)) return;
          albums.add(setId);
          index.albums.push(setId);
          (hit.actors || []).forEach(actor => {
            const actorId = String(actor && actor.actor_id || '');
            if (!/^\d+$/.test(actorId)) return;
            const model = index.models[actorId] || (index.models[actorId] = { n: '', a: [] });
            if (!model.n && actor.name) model.n = sanitizeNamePart(actor.name);
            model.a.push(setId);
          });
        });
        if (page % 5 === 0 || page + 1 >= (result.nbPages || 0)) {
          logLine(`Catalogue: ${index.albums.length} of ${result.nbHits} sets, ${Object.keys(index.models).length} models.`);
          state.index = index;
          saveIndex();
          renderStats();
        }
        return true;
      });
      index.complete = !state.cancel;
      state.index = index;
      saveIndex();
      logLine(state.cancel
        ? `Stopped with ${index.albums.length} sets read.`
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
      ui.index.classList.remove('pb-stop');
      renderStats();
      // Model cards can only be judged complete once the index knows her sets.
      refreshDownloadedCards();
    }
  }

  // "Completely downloaded" is read strictly: a set counts only when everything
  // in it has been saved, which is what an "all" run does, or images and videos
  // runs between them. A model counts when every set of hers does.
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
      ui.stats.title = 'Reads the catalogue once to learn how many sets and models there are.';
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
    if (!confirm(`Forget ${size} downloaded galler${size === 1 ? 'y' : 'ies'}?\n\nEverything will look new again and can be re-downloaded.`)) return;
    state.history = new Map();
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    renderHistory();
    // The index survives — it describes the site, not what you have — but every
    // completion figure read off it just went to zero.
    renderStats();
    renderQueue();
    // Everything the site was hiding comes back, since nothing counts as had.
    refreshDownloadedCards();
    logLine(`History cleared: ${size} galler${size === 1 ? 'y' : 'ies'} forgotten.`);
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
      #playboyStripperPanel{position:fixed;right:16px;top:16px;z-index:2147483646;width:300px;max-height:88vh;
        display:flex;flex-direction:column;border:1px solid rgba(224,196,138,.4);border-radius:10px;
        background:#141210;color:#f2ece1;box-shadow:0 18px 60px rgba(0,0,0,.6);font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #playboyStripperPanel.pb-collapsed{height:auto}
      #playboyStripperPanel.pb-collapsed .pb-body{display:none}
      #playboyStripperPanel .pb-head{height:38px;display:flex;align-items:center;gap:6px;padding:0 10px;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#33261a,#1a1613);cursor:default}
      #playboyStripperPanel .pb-title{font-weight:900;color:#e0c48a;flex:1 1 auto;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #playboyStripperPanel .pb-iconBtn{flex:0 0 auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px;font-size:13px}
      #playboyStripperPanel .pb-body{display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0;overflow:auto}
      #playboyStripperPanel button{appearance:none;width:100%;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#f2ece1;font:700 12px/1 Arial,sans-serif;cursor:pointer}
      #playboyStripperPanel button:hover:not(:disabled){background:rgba(224,196,138,.2);border-color:rgba(224,196,138,.55)}
      #playboyStripperPanel button:disabled{opacity:.42;cursor:default}
      #playboyStripperPanel #pbGo{background:#e0c48a;color:#1a1613;border-color:#f0d9a8}
      #playboyStripperPanel #pbGo.pb-stop,#playboyStripperPanel #pbStart.pb-stop,
      #playboyStripperPanel .pb-miniBtn.pb-stop{background:#4a3323;color:#ffeccf;border-color:rgba(224,196,138,.6)}
      #playboyStripperPanel .pb-progress{display:block;box-sizing:border-box;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      #playboyStripperPanel #pbFill{display:block;height:10px;min-height:10px;width:0;
        background:linear-gradient(90deg,#b08d4e,#e0c48a);transition:width 120ms ease}
      #playboyStripperPanel .pb-meta{display:flex;justify-content:space-between;gap:10px;color:#c4b79f;font-weight:700}
      #playboyStripperPanel .pb-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #playboyStripperPanel .pb-drop{display:flex;align-items:center;justify-content:center;min-height:44px;padding:6px 8px;
        border:1px dashed rgba(224,196,138,.45);border-radius:8px;background:rgba(224,196,138,.06);
        color:#b3a58c;font-weight:700;text-align:center}
      #playboyStripperPanel.pb-dragging .pb-drop{border-color:#e0c48a;border-style:solid;
        background:rgba(224,196,138,.22);color:#fff}
      #playboyStripperPanel .pb-queueHead{color:#c4b79f;font-weight:700}
      #playboyStripperPanel .pb-queueHead span{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #playboyStripperPanel .pb-queueBtns{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
      #playboyStripperPanel .pb-miniBtn{min-height:26px;padding:0 6px;font-size:11px;border-radius:6px}
      #playboyStripperPanel .pb-queue{display:flex;flex-direction:column;gap:4px;max-height:210px;overflow:auto;
        border:1px solid rgba(255,255,255,.08);border-radius:8px;background:rgba(0,0,0,.25);padding:6px}
      #playboyStripperPanel .pb-queue[hidden]{display:none}
      #playboyStripperPanel .pb-row{display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center}
      #playboyStripperPanel .pb-rowIndex{color:#857a68;font-weight:700;font-size:10px;min-width:24px}
      #playboyStripperPanel .pb-rowName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#eee5d5;font-weight:700}
      #playboyStripperPanel .pb-rowName small{display:block;color:#978b78;font-weight:700;font-size:10px}
      #playboyStripperPanel .pb-rowKill{width:22px;min-height:22px;padding:0;border-radius:6px;font-size:11px;line-height:1}
      #playboyStripperPanel .pb-row.is-active .pb-rowName{color:#e0c48a}
      #playboyStripperPanel .pb-row.is-done .pb-rowName{color:#8fbf9a}
      #playboyStripperPanel .pb-row.is-failed .pb-rowName{color:#e08a7a}
      #playboyStripperPanel .pb-row.is-skipped .pb-rowName{color:#857a68}
      #playboyStripperPanel .pb-row.is-modelRow .pb-rowName{color:#efd6a6}
      #playboyStripperPanel .pb-row.is-modelRow.is-done .pb-rowName{color:#8fbf9a}
      #playboyStripperPanel .pb-row.is-dupe .pb-rowName{color:#857a68}
      #playboyStripperPanel .pb-row.is-dupe .pb-rowName small{color:#6f6555}
      #playboyStripperPanel .pb-cycles{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      #playboyStripperPanel .pb-cycle{background:rgba(224,196,138,.1);border-color:rgba(224,196,138,.32);
        font-size:11px;min-height:28px;padding:0 6px}
      #playboyStripperPanel .pb-cycle.pb-cycleWide{grid-column:1 / -1}
      #playboyStripperPanel .pb-cycle.pb-forceOn{background:rgba(224,138,122,.2);border-color:rgba(224,138,122,.55);color:#ffd8cf}
      #playboyStripperPanel .pb-cycle.pb-linkModeOn{background:rgba(143,191,154,.18);border-color:rgba(143,191,154,.5);color:#d6f0dc}
      #playboyStripperPanel .pb-cycle.pb-qualityHigh{background:rgba(224,196,138,.28);border-color:rgba(224,196,138,.6);color:#fff1d4}
      #playboyStripperPanel .pb-row.is-willResolve .pb-rowName small{color:#8fbf9a}
      #playboyStripperPanel .pb-histHead{display:flex;align-items:center;gap:6px;color:#c4b79f;font-weight:700}
      #playboyStripperPanel .pb-histHead span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #playboyStripperPanel .pb-histBtn{flex:0 0 auto;width:auto;min-width:54px}
      #playboyStripperPanel .pb-log{min-height:88px;max-height:220px;overflow:auto;border:1px solid rgba(255,255,255,.08);
        border-radius:8px;background:rgba(0,0,0,.32);padding:7px;color:#bdb1a0;white-space:pre-wrap}
      #playboyStripperPanel .pb-log div{margin:0 0 4px}
    `);
  }

  // The site is a single page that rewrites itself as you browse, so there is no
  // load event to hang the context readout on. Watching the address is the one
  // signal that works for both its own navigation and ours.
  function installRouteObserver() {
    let last = location.href;
    setInterval(() => {
      if (location.href === last) return;
      last = location.href;
      if (state.busy) return;
      setProgress(0);
      syncContext();
      refreshDownloadedCards();
    }, 700);
  }

  // --- browsing during a run ------------------------------------------------
  //
  // A run lives in this page's JavaScript, so an ordinary navigation ends it: the
  // document is torn down mid-gallery, the fetches in flight are dropped, and
  // what comes back is a saved list with the set that was downloading returned to
  // the queue.
  //
  // The site's own links do not have that problem — it rewrites itself in place
  // and never replaces the document, which is exactly what we want. What is left
  // to guard is everything else: a reload, a typed address, a link off the site.
  // Those cannot be intercepted, only warned about, and the queue is saved either
  // way so the run picks itself back up on the way in.
  function installSoftNavigation() {
    window.addEventListener('beforeunload', event => {
      if (!state.busy) return;
      event.preventDefault();
      event.returnValue = '';
      return '';
    });
  }

  // --- context --------------------------------------------------------------

  // Galleries live at /en/update/<slug>/<id> and models at
  // /en/model/view/<name>/<id>. The language segment is not always "en" and the
  // slug is not always tidy, so both are read loosely: what matters is the shape
  // and the number on the end.
  function albumRefFromPath(path) {
    const match = decodeURIComponent(String(path || ''))
      .match(/\/update\/([^/?#]*)\/(\d+)\/?$/i);
    if (!match) return null;
    return { id: match[2], slug: String(match[1] || ''), name: '' };
  }

  function modelRefFromPath(path) {
    const match = decodeURIComponent(String(path || ''))
      .match(/\/models?\/view\/([^/?#]*)\/(\d+)\/?$/i);
    if (!match) return null;
    return { id: match[2], slug: String(match[1] || ''), name: titleFromSlug(match[1]) };
  }

  function albumRefFromLocation() {
    return albumRefFromPath(location.pathname);
  }

  // What "+ This" acts on: the gallery you are reading, or the model whose page
  // you are on.
  function targetFromLocation() {
    return targetFromUrl(location.href, ORIGIN);
  }

  function syncContext() {
    const target = targetFromLocation();
    const album = target && target.kind === 'album' ? target : null;
    state.albumId = album ? album.id : '';
    if (album) {
      const label = titleFromSlug(album.slug) || `Gallery ${album.id}`;
      ui.go.disabled = false;
      ui.album.textContent = label;
      ui.album.title = `${label} (${album.id})`;
      logLine(`Ready. ${label}.`);
    } else {
      ui.go.disabled = true;
      ui.album.textContent = target ? (target.name || `Model ${target.id}`) : 'No gallery';
      ui.album.title = '';
      ui.count.textContent = '0 photos';
      if (target) logLine('Model page. + This queues her whole catalogue.');
      else if (isListingUrl(location.href)) logLine('Listing page. Use + Page for what is on screen, or + All for everything it covers.');
      else logLine('Open a gallery, a model, or a listing to queue from.');
    }
    ui.addAll.disabled = state.busy || !isListingUrl(location.href);
  }

  // Anything that renders a grid of galleries: the front page, /en/updates and
  // its categories, favourites, VIP, a search. A model's own page counts too —
  // "+ All" on one queues her catalogue, which is what it looks like it should do.
  function isListingUrl(raw) {
    let url;
    try { url = new URL(String(raw || ''), ORIGIN); } catch { return false; }
    if (albumRefFromPath(url.pathname)) return false;
    if (modelRefFromPath(url.pathname)) return true;
    const path = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/';
    return /^(?:\/[a-z]{2})?(?:\/(?:updates|models|favorite|favourites|vip|search|categories)(?:\/.*)?)?$/i.test(path);
  }

  // The category a listing is filtered to, when its address names one. The slug
  // in the URL is the same slug the catalogue files each set under, give or take
  // capitals, so it is matched case-insensitively against the real list rather
  // than guessed at.
  function categorySlugFromUrl(raw) {
    let url;
    try { url = new URL(String(raw || ''), ORIGIN); } catch { return ''; }
    const match = decodeURIComponent(url.pathname).match(/\/categories\/([^/?#]+)/i);
    return match ? String(match[1] || '').trim() : '';
  }

  async function resolveCategoryFilter(slug) {
    if (!slug) return '';
    const result = await algoliaSearch(ALGOLIA_PHOTOSETS, algoliaParams({
      hitsPerPage: 0,
      facets: JSON.stringify(['categories.url_name'])
    }));
    const facets = (result.facets && result.facets['categories.url_name']) || {};
    const wanted = slug.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const match = Object.keys(facets).find(name => name.toLowerCase().replace(/[^a-z0-9]+/g, '') === wanted);
    if (!match) return '';
    return `categories.url_name:"${match}"`;
  }

  // --- queue ----------------------------------------------------------------

  function installDropTarget(panel) {
    let depth = 0;
    const setDragging = on => panel.classList.toggle('pb-dragging', on);

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
      if (!targets.length) { logLine('Nothing gallery- or model-shaped in that drop.'); return; }
      reportQueued(addToQueue(targets));
    });
  }

  // A dragged link arrives as several flavours at once. Read them all and let the
  // URL matcher sort it out, so a dragged cover, a dragged gallery link, a dragged
  // model profile and a pasted list of URLs all land the same way.
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

  // The two shapes are unambiguous: a path ending /update/<slug>/<id> is one
  // gallery, and /model/view/<name>/<id> is one model. Anything else is neither.
  function targetFromUrl(raw, baseUrl) {
    const value = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!value) return null;
    let url;
    try { url = new URL(value, baseUrl || ORIGIN); } catch { return null; }
    if (!/(?:^|\.)playboyplus\.com$/i.test(url.hostname)) return null;

    const album = albumRefFromPath(url.pathname);
    if (album) return Object.assign({ kind: 'album' }, album);

    const model = modelRefFromPath(url.pathname);
    if (model) return Object.assign({ kind: 'model' }, model);

    return null;
  }

  // Every gallery- or model-shaped link on whatever page is open. This reads the
  // page as it stands on screen, which is the only way it can be read: fetching
  // a listing gets an empty shell, because the site fills its grids in afterwards.
  //
  // Galleries win outright when the page has any: a gallery page also links its
  // own models, and queueing their whole catalogues off a single set would be a
  // wild overreach of "+ Page". A model directory carries no gallery links at
  // all, so the fallback needs no special case for it.
  function targetsFromDocument(doc, baseUrl) {
    const albums = new Map();
    const models = new Map();
    Array.from(doc.querySelectorAll('a[href]')).forEach(anchor => {
      if (ui.panel && ui.panel.contains(anchor)) return;
      const target = targetFromUrl(anchor.getAttribute('href'), baseUrl);
      if (!target) return;
      if (target.kind === 'album') {
        if (albums.has(target.id)) return;
        target.name = modelNameFromAnchor(anchor) || titleFromSlug(target.slug);
        albums.set(target.id, target);
        return;
      }
      if (models.has(target.id)) return;
      target.name = modelNameFromAnchor(anchor) || titleFromSlug(target.slug);
      models.set(target.id, target);
    });
    return albums.size ? Array.from(albums.values()) : Array.from(models.values());
  }

  // A card's link usually wraps a picture and nothing else, so its own text is
  // often empty; the readable name sits in a heading beside it. Either way this
  // is only a label for the queue row — the real title comes from the catalogue
  // when the gallery is actually downloaded.
  function modelNameFromAnchor(anchor) {
    const own = sanitizeNamePart(String(anchor.textContent || ''));
    if (own) return own.slice(0, 120);
    const label = sanitizeNamePart(String(anchor.getAttribute('title') || anchor.getAttribute('aria-label') || ''));
    return label.slice(0, 120);
  }

  // "+ All": everything the listing you are looking at covers, taken from the
  // catalogue rather than from the page. On a model's page that is her sets; on a
  // category it is that category; anywhere else it is the whole site.
  async function crawlListing() {
    if (state.busy) { logLine('Wait for the current run to finish.'); return; }
    if (state.indexing) { logLine('Stop the index first.'); return; }
    if (!isListingUrl(location.href)) { logLine('This is not a listing page.'); return; }
    if (state.crawling) return;

    state.crawling = true;
    state.cancel = false;
    ui.addAll.textContent = 'Stop';
    ui.addAll.classList.add('pb-stop');
    let queued = 0;
    try {
      const model = modelRefFromPath(location.pathname);
      if (model) {
        logLine(`Queueing ${model.name || `model ${model.id}`}.`);
        reportQueued(addToQueue([{ kind: 'model', id: model.id, slug: model.slug, name: model.name }]));
        return;
      }

      const slug = categorySlugFromUrl(location.href);
      let filters = '';
      if (slug) {
        filters = await resolveCategoryFilter(slug);
        logLine(filters
          ? `Reading the "${slug}" category out of the catalogue.`
          : `No category called "${slug}" in the catalogue; reading everything instead.`);
      } else {
        logLine('Reading the whole catalogue.');
      }

      await algoliaWalk(ALGOLIA_PHOTOSETS, {
        filters: filters || undefined,
        attributesToRetrieve: JSON.stringify(['set_id', 'title', 'url_title'])
      }, (hits, page, result) => {
        const targets = hits.map(targetFromPhotosetHit);
        const added = addToQueue(targets);
        queued += added.length;
        logLine(`Page ${page + 1} of ${result.nbPages}: ${added.length} new (${state.queue.length} queued).`);
        return state.queue.length < QUEUE_LIMIT || (logLine('Queue is full; stopping.'), false);
      });
      logLine(state.cancel
        ? `Stopped with ${queued} queued.`
        : `Done: ${queued} new item${queued === 1 ? '' : 's'} queued.`);
    } catch (err) {
      // A cancel lands as a thrown 'cancelled' when it arrives mid-query rather
      // than at the top of the loop; it is a stop, not a failure.
      if (errorMessage(err) === 'cancelled') logLine(`Stopped with ${queued} queued.`);
      else throw err;
    } finally {
      state.crawling = false;
      state.cancel = false;
      ui.addAll.textContent = '+ All';
      ui.addAll.classList.remove('pb-stop');
    }
  }

  function entryKey(entry) {
    return `${entry.kind || 'album'}:${entry.id}`;
  }

  // `insertAt` is used by model expansion, so a model's galleries land directly
  // after her rather than at the back of a queue that may be thousands long.
  function addToQueue(targets, insertAt) {
    const known = new Set(state.queue.map(entryKey));
    const byKey = new Map(state.queue.map(entry => [entryKey(entry), entry]));
    const fresh = [];
    let full = false;
    targets.forEach(target => {
      const kind = target.kind || 'album';
      const key = `${kind}:${target.id}`;
      if (known.has(key)) {
        // Already queued, but a model expansion has just proved this gallery is
        // hers. Saying so on the entry that is actually in the queue stops it
        // going back out to ask which model produced it — the queued copy is the
        // one that will be downloaded, so it is the one that has to know.
        if (target.viaModel) {
          const existing = byKey.get(key);
          if (existing && !existing.viaModel) existing.viaModel = true;
        }
        return;
      }
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
    if (albums) parts.push(`${albums} galler${albums === 1 ? 'y' : 'ies'}`);
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
    ui.start.classList.toggle('pb-stop', state.busy);

    // A full-catalogue queue is 15,000 rows, and drawing 15,000 rows is how a
    // panel stops answering the mouse. The list shows a window around whatever is
    // running; the counter above it speaks for the rest.
    const MAX_ROWS = 300;
    let from = 0;
    if (state.queue.length > MAX_ROWS) {
      const active = state.queue.findIndex(entry => entry.status === 'active' || entry.status === 'queued');
      from = Math.max(0, Math.min(state.queue.length - MAX_ROWS, (active < 0 ? 0 : active) - 20));
    }
    const shown = state.queue.slice(from, from + MAX_ROWS);

    shown.forEach((entry, offset) => {
      const index = from + offset;
      const isModel = entry.kind === 'model';
      // Live rather than stamped at add time, so flipping the file-kind or the
      // Duplicates toggle restates every row without rebuilding the queue.
      // A gallery waiting to be resolved to its model is not being downloaded, so
      // the history has no opinion on it yet.
      const willResolve = entry.status === 'queued' && needsModelResolution(entry);
      const isDupe = !isModel && !willResolve && entry.status === 'queued'
        && historySatisfies(entry.id, state.fileFilter);
      const row = document.createElement('div');
      row.className = `pb-row is-${entry.status}${isModel ? ' is-modelRow' : ''}`
        + `${isDupe ? ' is-dupe' : ''}${willResolve ? ' is-willResolve' : ''}`;

      const position = document.createElement('span');
      position.className = 'pb-rowIndex';
      position.textContent = String(index + 1);

      const fallback = isModel ? `Model ${entry.id}` : `Gallery ${entry.id}`;
      const name = document.createElement('div');
      name.className = 'pb-rowName';
      name.textContent = `${isModel ? '★ ' : ''}${entry.name || fallback}`;
      name.title = `${entry.name || fallback} (${entry.id})`;
      const note = document.createElement('small');
      note.textContent = willResolve
        ? '→ will queue its model'
        : (isDupe
          ? (state.force ? 'downloaded — will redownload' : 'downloaded — will skip')
          : (entry.note || entry.status));
      name.appendChild(note);

      const kill = document.createElement('button');
      kill.className = 'pb-rowKill';
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
    // one abort the other mid-request.
    if (state.crawling) { logLine('Stop the current listing read first.'); return; }
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
      // Re-read the queue each lap rather than iterating a snapshot, so galleries
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
        logLine(`--- ${completed}/${total}: ${entry.name || `${isModel ? 'model' : 'gallery'} ${entry.id}`} ---`);

        state.cancel = false;
        try {
          if (isModel) {
            const found = await expandModelEntry(entry);
            entry.status = 'done';
            entry.note = `${found} galler${found === 1 ? 'y' : 'ies'}`;
          } else if (resolveToModel) {
            const models = await resolveAlbumToModels(entry);
            if (models.length) {
              const at = state.queue.indexOf(entry);
              const added = addToQueue(models, at >= 0 ? at + 1 : undefined);
              const names = models.map(model => model.name || `Model ${model.id}`).join(' and ');
              // The gallery stays in the queue as one of hers rather than being
              // retired as a spent pointer. It is one of her sets too, and the
              // expansion that follows cannot put it back: the queue dedupes by
              // id, so a finished row sitting on that id would mask it and the
              // very set that was dragged in would be the one never downloaded.
              entry.viaModel = true;
              entry.status = 'queued';
              entry.note = `→ ${names}`;
              logLine(`Resolved to ${names}${added.length ? '' : ' (already queued)'}.`);
            } else {
              // Nothing to resolve to, so the gallery is the only thing there is.
              // Marked as hers so the next lap downloads it instead of asking again.
              entry.viaModel = true;
              entry.status = 'queued';
              entry.note = 'no model listed';
              logLine('No model on this gallery; downloading the gallery itself.');
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
          else logLine(`${isModel ? 'Model' : 'Gallery'} ${entry.id} ${skipped ? 'skipped' : 'failed'}: ${message}`);
          // A cancel is aimed at the whole run, not just the gallery in flight.
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
  // A model is a stand-in for her galleries, expanded when the runner reaches her
  // rather than when she is queued. That is what makes a model directory usable:
  // dropping every profile in is instant, and the work of listing each one is
  // spread through the run instead of front-loaded before anything downloads.
  //
  // Her galleries are spliced in directly after her, so the queue reads model,
  // her sets, next model — and a run interrupted halfway leaves the models it
  // never reached still queued, ready to expand next time.

  async function resolveAlbumToModels(entry) {
    const record = await photosetById(entry.id);
    if (!record) return [];
    const out = [];
    const seen = new Set();
    (record.actors || []).forEach(actor => {
      const id = String(actor && actor.actor_id || '');
      if (!/^\d+$/.test(id) || seen.has(id)) return;
      seen.add(id);
      out.push({
        kind: 'model',
        id,
        slug: String(actor.url_name || ''),
        name: sanitizeNamePart(actor.name || '').slice(0, 120)
      });
    });
    return out;
  }

  async function expandModelEntry(entry) {
    const found = new Map();
    await algoliaWalk(ALGOLIA_PHOTOSETS, {
      filters: `actors.actor_id:${Number(entry.id)}`,
      attributesToRetrieve: JSON.stringify(['set_id', 'title', 'url_title', 'actors'])
    }, (hits, page, result) => {
      hits.forEach(hit => {
        const target = targetFromPhotosetHit(hit);
        if (!found.has(target.id)) found.set(target.id, target);
        if (!entry.name) {
          const mine = (hit.actors || []).find(actor => String(actor.actor_id) === String(entry.id));
          if (mine && mine.name) entry.name = sanitizeNamePart(mine.name);
        }
      });
      logLine(`  page ${page + 1}/${result.nbPages}: ${found.size} set${found.size === 1 ? '' : 's'} so far.`);
      return true;
    });
    if (state.cancel) throw new Error('cancelled');

    const albums = Array.from(found.values());
    if (!albums.length) {
      const err = new Error('no sets found for this model');
      err.skip = true;
      throw err;
    }

    if (!entry.name) {
      // A bare model URL dragged in has only a slug to go on until the catalogue
      // is asked directly.
      const actor = await actorById(entry.id).catch(() => null);
      entry.name = (actor && sanitizeNamePart(actor.name)) || titleFromSlug(entry.slug) || `Model ${entry.id}`;
    }

    const at = state.queue.indexOf(entry);
    // Tagged as hers, so link-to-model mode does not send each of them back out
    // to rediscover the model that just produced them.
    albums.forEach(album => { album.viaModel = true; });
    const added = addToQueue(albums, at >= 0 ? at + 1 : undefined);
    logLine(`${entry.name}: ${albums.length} set${albums.length === 1 ? '' : 's'}, ${added.length} newly queued.`);
    return albums.length;
  }

  // --- download -------------------------------------------------------------

  async function downloadCurrentAlbum() {
    if (state.indexing) { logLine('Stop the index first.'); return; }
    if (state.crawling) { logLine('Stop the current listing read first.'); return; }
    const ref = albumRefFromLocation();
    if (!ref) { logLine('This is not a gallery page.'); return; }
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
    logLine(`Scanning gallery ${ref.id}.`);

    const album = await scanAlbum(ref);
    if (state.cancel) throw new Error('cancelled');
    if (!album.items.length) {
      // On Videos, a gallery with no clip is the common case, not a broken
      // gallery, and a run across the whole site would otherwise read as
      // thousands of failures. It is flagged as skipped so the distinction
      // survives.
      if (state.fileFilter !== 'all') {
        const err = new Error(`no ${state.fileFilter === 'videos' ? 'video' : 'images'} in this gallery`);
        err.skip = true;
        throw err;
      }
      throw new Error('no photos or videos found in this gallery');
    }

    ui.album.textContent = album.title;
    ui.album.title = `${album.title} (${album.id})`;
    // During a run the counter is the queue's position readout; leave it alone.
    if (!state.queueRunning) {
      ui.count.textContent = `${album.items.length} file${album.items.length === 1 ? '' : 's'}`;
    }
    logLine(`${album.title} — ${album.items.length} file${album.items.length === 1 ? '' : 's'}, ${album.models.join(' & ') || 'no model listed'}, ${album.date || 'no date'}.`);

    album.saved = await saveAlbumFiles(album);
    setProgress(100);
    logLine('Done.');
    return album;
  }

  // Two questions, asked of two places. The catalogue knows what the gallery is —
  // its title, its date, who is in it, how many photos it should have and whether
  // it carries a video. The site's own signing endpoint knows where the photos
  // actually are, and is the only thing that does: every full-size URL is signed
  // and expires, so there is nothing here that could be guessed or built by hand.
  async function scanAlbum(ref) {
    const record = await photosetById(ref.id);
    if (!record) throw new Error('the catalogue has no gallery with that id');
    setProgress(8);

    const album = {
      id: String(ref.id),
      slug: String(record.url_title || ref.slug || ''),
      title: sanitizeNamePart(record.title) || titleFromSlug(record.url_title) || `Gallery ${ref.id}`,
      date: String(record.date_online || '').slice(0, 10),
      models: modelsFromRecord(record),
      clipId: Number(record.clip_id) || 0,
      declared: Number(record.num_of_pictures) || 0,
      items: []
    };

    if (wantsKind('image')) {
      const signed = await signPhotoset(album.id);
      const photos = (signed && Array.isArray(signed.large) ? signed.large : []).filter(Boolean);
      setProgress(14);

      if (album.declared && photos.length < album.declared) {
        const detail = `saw ${photos.length} of ${album.declared} photo${album.declared === 1 ? '' : 's'}`
          + (photos.length ? '' : ' — signed out, or this subscription does not include downloads');
        // The guard exists to stop a truncated gallery being saved as a whole one.
        if (!ALLOW_PARTIAL_ALBUMS) throw new Error(detail);
        logLine(`Partial gallery: ${detail}.`);
      }
      album.items = photos.map(url => ({ kind: 'image', url, index: 0 }));
    }

    if (wantsKind('video')) {
      const video = await videoForAlbum(album);
      if (video) {
        album.items.push({ kind: 'video', url: video.url, quality: video.quality, bytes: video.bytes, index: 0 });
        logLine(`Video found: ${video.quality}${video.bytes ? `, ${formatBytes(video.bytes)}` : ''}.`);
      } else if (state.fileFilter === 'all') {
        logLine('No video on this gallery.');
      }
    }

    // Numbered after filtering, so a Videos-only run starts at _001 rather than
    // carrying a gap where the images would have been.
    album.items.forEach((item, index) => { item.index = index + 1; });

    setProgress(16);
    return album;
  }

  // The signing endpoint the site's own viewer calls. It answers only to a
  // request that says it is one — without the header it refuses outright — and
  // only to a signed-in session with downloads on the plan.
  async function signPhotoset(setId) {
    const raw = await withRetry(
      () => httpText(`${ORIGIN}/media/signPhotoset/${encodeURIComponent(setId)}`, { 'X-Requested-With': 'XMLHttpRequest' }),
      'gallery contents'
    );
    if (!raw || raw.trim() === '{}') {
      throw new Error('the site handed back an empty gallery — check you are signed in with downloads on your plan');
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('the gallery contents came back as something other than a list of files');
    }
  }

  // The video behind the page's own VIDEOS button. The gallery record names its
  // clip; the clip's own record says which encodes exist, and the link is built
  // from the two. A gallery with no clip simply has no video, which is not an
  // error.
  async function videoForAlbum(album) {
    if (!album.clipId) return null;
    let scene = null;
    try {
      scene = await sceneByClipId(album.clipId);
    } catch (err) {
      logLine(`Could not read the video's details (${errorMessage(err)}); skipping it.`);
      return null;
    }
    if (!scene) return null;
    const sizes = (scene.download_sizes || []).map(String).filter(Boolean);
    if (!sizes.length) return null;
    const quality = pickVideoQuality(sizes);
    if (!quality) return null;
    const bytes = Number((scene.download_file_sizes || {})[quality]) || 0;
    return {
      url: `${ORIGIN}/movieaction/download/${album.clipId}/${encodeURIComponent(quality)}/mp4?codec=h264`,
      quality,
      bytes
    };
  }

  // Largest first, and the preference is a ceiling rather than a demand: asking
  // for 1080p on a gallery that only goes to 720p takes the 720p rather than
  // skipping the video. Asking for 480p on a gallery whose smallest is 720p takes
  // the 720p too — something is better than the gap.
  function pickVideoQuality(sizes) {
    const available = VIDEO_QUALITY_ORDER.filter(quality => sizes.some(size => size.toLowerCase() === quality));
    if (!available.length) return sizes[sizes.length - 1] || '';
    if (state.videoQuality === 'best') return available[0];
    const wantedAt = VIDEO_QUALITY_ORDER.indexOf(state.videoQuality);
    if (wantedAt < 0) return available[0];
    const atOrBelow = available.find(quality => VIDEO_QUALITY_ORDER.indexOf(quality) >= wantedAt);
    return atOrBelow || available[available.length - 1];
  }

  function modelsFromRecord(record) {
    const names = [];
    const seen = new Set();
    (record.actors || []).forEach(actor => {
      const name = sanitizeNamePart(actor && actor.name);
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      names.push(name);
    });
    return names;
  }

  // --- naming ---------------------------------------------------------------
  //
  // PlayboyPlus/<Model>/<YYMMDD>-<Model> - <Title>.zip, holding
  // <YYMMDD>-<Model> - <Title>/<same>_001.jpg, and — when the gallery has one —
  // PlayboyPlus/<Model>/<YYMMDD>-<Model> - <Title>.mp4 beside it.
  //
  // The model folder comes from the gallery's own model list, and the title has
  // her name stripped off the front, because "Freya Parker in Penthouse Desire"
  // inside a folder called Freya Parker says it twice. Anything that cannot be
  // matched confidently keeps the whole title instead.

  function modelFolderFor(album) {
    if (!album.models.length) return UNTAGGED_FOLDER;
    if (album.models.length > MAX_MODELS_IN_NAME) return MULTI_MODEL_FOLDER;
    return sanitizeNamePart(album.models.join(MODEL_JOIN)) || UNTAGGED_FOLDER;
  }

  // <yymmdd>-<model> - <title>. The date and the model are one prefix joined by a
  // bare hyphen; " - " is reserved as the single boundary between that prefix and
  // the title, which is why both halves are scrubbed of it. A gallery with no
  // model, or with more of them than a name can carry, keeps the plain
  // "<yymmdd> - <title>" shape rather than growing an unreadable segment.
  function archiveBaseName(album) {
    const model = modelNamePart(album);
    const prefix = model ? `${dateKey(album.date)}-${model}` : dateKey(album.date);
    return `${prefix} - ${albumTitlePart(album)}`;
  }

  function modelNamePart(album) {
    if (!album.models.length || album.models.length > MAX_MODELS_IN_NAME) return '';
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
    return capped || `gallery_${album.id}`;
  }

  // Word-by-word, and each word compared on its letters and digits alone, so a
  // model listed as "Erna O'Hara" still matches the title's "Erna Ohara". A title
  // that is nothing but the model's name is left whole — there would be no title
  // left. The connector that follows her name goes too, or thousands of files
  // would begin "In".
  function stripModelPrefix(title, models) {
    const words = String(title || '').split(/\s+/).filter(Boolean);
    const bare = word => word.toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (const model of models) {
      const modelWords = String(model || '').split(/\s+/).filter(Boolean);
      if (!modelWords.length || modelWords.length >= words.length) continue;
      const matches = modelWords.every((word, i) => bare(word) && bare(word) === bare(words[i]));
      if (!matches) continue;
      let rest = words.slice(modelWords.length);
      if (STRIP_LEADING_IN && rest.length > 1 && /^(?:in|for|at|on)$/i.test(rest[0])) rest = rest.slice(1);
      const text = rest.join(' ');
      if (!text) continue;
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    return '';
  }

  // The URL slug, as a last-resort display label before the catalogue is asked.
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
    return (parts.length ? parts : ['playboyplus_archive.zip'])
      .map((part, idx) => sanitizeFileNameStrict(part, idx === parts.length - 1 ? 'archive.zip' : 'folder'))
      .join('/');
  }

  function inferExt(raw, fallback) {
    const match = String(raw || '').split(/[?#]/)[0].match(/\.([A-Za-z0-9]{2,5})$/);
    const ext = match ? match[1].toLowerCase() : '';
    if (ext === 'jpeg') return 'jpg';
    return /^(?:avif|bmp|gif|jpg|png|webp|mp4|m4v|webm)$/.test(ext) ? ext : (fallback || 'jpg');
  }

  // --- saving ---------------------------------------------------------------
  //
  // Photos go into one zip, the way Zishy's do. The video does not, and that is
  // the one deliberate departure from it: a browser builds a zip entirely in
  // memory, and a 4K clip is well over a gigabyte, so zipping it is the single
  // most reliable way to kill the tab. Handed to the downloader as a link it
  // streams straight to disk and costs nothing at all. The name is the same
  // either way, so the pair sits together in the model's folder.

  async function saveAlbumFiles(album) {
    const folder = modelFolderFor(album);
    const base = archiveBaseName(album);
    const images = album.items.filter(item => item.kind === 'image');
    const videos = album.items.filter(item => item.kind === 'video');
    let saved = 0;

    if (images.length) {
      saved += await buildAndSaveArchive(album, images, folder, base);
    }

    for (const video of videos) {
      if (state.cancel) throw new Error('cancelled');
      const name = sanitizeDownloadPathForSave(`${ROOT_FOLDER}/${folder}/${base}.mp4`);
      try {
        await saveVideo(video, name);
        saved++;
        logLine(`Saved ${name}.`);
      } catch (err) {
        // A missing or refused video is worth saying out loud, but it does not
        // fail a gallery whose photos are already on disk.
        if (images.length) logLine(`Video skipped: ${errorMessage(err)}`);
        else throw err;
      }
    }

    if (!saved) throw new Error('nothing could be saved');
    return saved;
  }

  async function buildAndSaveArchive(album, images, folder, base) {
    const Zip = resolveJSZip();
    if (!Zip) throw new Error('JSZip is missing (the @require did not load)');

    const pad = Math.max(MIN_INDEX_PAD, String(album.items.length).length);
    let done = 0;
    await runPool(images, IMAGE_CONCURRENCY, async item => {
      try {
        item.data = await fetchBinaryWithRetry(item.url);
      } catch (err) {
        item.error = errorMessage(err);
      }
      done++;
      setProgress(16 + Math.round((done / Math.max(1, images.length)) * 68));
    });
    if (state.cancel) throw new Error('cancelled');

    // Zipping is a separate ordered pass so the parallel fetch above cannot
    // disturb gallery order.
    const zip = new Zip();
    let added = 0;
    let failed = 0;
    images.forEach(item => {
      const leaf = `${base}_${String(item.index).padStart(pad, '0')}.${inferExt(item.url, 'jpg')}`;
      if (!item.data) {
        failed++;
        logLine(`Skipped ${leaf}: ${item.error || 'no data'}`);
        return;
      }
      zip.file(`${base}/${leaf}`, item.data);
      added++;
    });
    if (!added) throw new Error(`all ${images.length} downloads failed`);
    if (failed) logLine(`Archive is partial: ${failed} file${failed === 1 ? '' : 's'} failed.`);

    logLine(`Zipping ${added} file${added === 1 ? '' : 's'}.`);
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      meta => setProgress(84 + Math.round(((meta && meta.percent) || 0) * 0.12))
    );
    images.forEach(item => { item.data = null; });
    logLine(`Archive is ${formatBytes(blob.size)}.`);

    const archiveName = sanitizeDownloadPathForSave(`${ROOT_FOLDER}/${folder}/${base}.zip`);
    await saveBlob(blob, archiveName);
    logLine(`Saved ${archiveName}.`);
    return added;
  }

  // Handed to the download manager as a link rather than fetched here, so the
  // file streams to disk and never sits in this tab's memory. The link is on the
  // members host and redirects to the file itself, which the manager follows.
  //
  // The fallback pulls it through this tab, which for a 4K clip is a gigabyte in
  // memory and is exactly what the first path exists to avoid — but a fallback
  // that works badly beats one that is not there.
  function saveVideo(video, name) {
    if (typeof GM_download !== 'function') return saveVideoThroughMemory(video, name);
    return withDeadline('video save', VIDEO_TIMEOUT_MS, (ok, fail) => {
      const handle = GM_download({
        url: video.url,
        name,
        saveAs: false,
        headers: { Referer: `${ORIGIN}/` },
        onprogress: event => {
          if (!event || !event.total) return;
          setProgress(84 + Math.round((event.loaded / event.total) * 14));
        },
        onload: () => ok(),
        onerror: err => fail(new Error(err && err.error ? String(err.error) : 'the download manager refused it')),
        ontimeout: () => fail(new Error('the download timed out'))
      });
      return handle && typeof handle.abort === 'function' ? () => handle.abort() : null;
    }).catch(async err => {
      logLine(`The download manager could not take the video (${errorMessage(err)}); pulling it through the page instead.`);
      await saveVideoThroughMemory(video, name);
    });
  }

  async function saveVideoThroughMemory(video, name) {
    const buffer = await fetchBinaryWithRetry(video.url, VIDEO_TIMEOUT_MS);
    await saveBlob(new Blob([buffer], { type: 'video/mp4' }), name);
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
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function fetchBinaryWithRetry(url, timeoutMs) {
    return withRetry(() => httpBinary(url, timeoutMs), 'file download');
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
  // Two kinds of request, and they cannot use the same road.
  //
  // Pages and the site's own endpoints are same-origin, so ordinary fetch handles
  // them and carries the session cookie that makes them answer at all.
  //
  // The photos are not. They live on the media network, which does not invite
  // other sites to read it, so an ordinary fetch of one fails before it starts —
  // not a download problem, a permission the browser will not grant a page. The
  // extension's own request function is not bound by that, so it is the primary
  // path for anything off-site rather than a fallback. Without a userscript
  // manager that provides it, photos cannot be fetched at all.
  //
  // Each path carries its own deadline, so a silent transport fails loudly
  // instead of hanging.

  function isSameOrigin(url) {
    try { return new URL(url, ORIGIN).origin === new URL(ORIGIN).origin || new URL(url, ORIGIN).origin === location.origin; }
    catch { return false; }
  }

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
      const options = Object.assign({ redirect: 'follow', credentials: 'include' }, init);
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

  async function httpText(url, headers) {
    if (typeof fetch === 'function') {
      try {
        const res = await nativeFetch(url, { headers: headers || {} }, PAGE_TIMEOUT_MS, 'page fetch');
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
    return gmRequest(url, 'text', PAGE_TIMEOUT_MS, headers);
  }

  async function httpPostJson(url, body, headers) {
    const merged = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
    if (typeof fetch === 'function') {
      try {
        const res = await nativeFetch(url, { method: 'POST', headers: merged, body, credentials: 'omit' }, PAGE_TIMEOUT_MS, 'catalogue fetch');
        if (!res.ok) throw httpStatusError(res.status);
        const text = await withDeadline('catalogue read', PAGE_TIMEOUT_MS, (ok, fail) => { res.text().then(ok, fail); });
        noteTransport('fetch');
        return text;
      } catch (err) {
        if (err && err.httpStatus) throw err;
        if (!hasGmRequest()) throw err;
      }
    }
    noteTransport('GM_xmlhttpRequest');
    return withDeadline('catalogue request', PAGE_TIMEOUT_MS, (ok, fail) => {
      const handle = GM_xmlhttpRequest({
        method: 'POST',
        url,
        data: body,
        headers: merged,
        anonymous: true,
        timeout: PAGE_TIMEOUT_MS,
        onload: res => {
          if (res.status < 200 || res.status >= 300) { fail(httpStatusError(res.status)); return; }
          ok(String(res.responseText || ''));
        },
        onerror: () => fail(new Error('network error')),
        ontimeout: () => fail(new Error('request timeout'))
      });
      return handle && typeof handle.abort === 'function' ? () => handle.abort() : null;
    });
  }

  async function httpBinary(url, timeoutMs) {
    const ms = timeoutMs || BLOB_TIMEOUT_MS;
    // Off-site media goes straight to the extension's request function: a page is
    // not allowed to read the media network's responses, so trying fetch first
    // would only spend a failed request to learn what is already known.
    if (!isSameOrigin(url) && hasGmRequest()) {
      noteTransport('GM_xmlhttpRequest');
      return gmRequest(url, 'arraybuffer', ms);
    }
    if (typeof fetch === 'function') {
      try {
        const res = await nativeFetch(url, {}, ms, 'file fetch');
        if (!res.ok) throw httpStatusError(res.status);
        // A signed-out or expired session answers with a page rather than a 401,
        // so a media request that comes back as markup is an auth failure wearing
        // a 200.
        const type = String(res.headers.get('content-type') || '').toLowerCase();
        if (/^(?:text\/|application\/(?:json|xml|xhtml))/.test(type)) {
          throw new Error(`server returned ${type.split(';')[0] || 'non-media content'} — check you are signed in`);
        }
        const buffer = await withDeadline('file read', ms, (ok, fail) => { res.arrayBuffer().then(ok, fail); });
        if (!buffer || !buffer.byteLength) throw new Error('empty response');
        noteTransport('fetch');
        return buffer;
      } catch (err) {
        if (err && err.httpStatus) throw err;
        if (!hasGmRequest()) throw err;
        logLine(`fetch failed (${errorMessage(err)}); falling back to GM_xmlhttpRequest.`);
      }
    }
    if (!hasGmRequest()) {
      throw new Error('this needs a userscript manager that provides GM_xmlhttpRequest');
    }
    noteTransport('GM_xmlhttpRequest');
    return gmRequest(url, 'arraybuffer', ms);
  }

  function hasGmRequest() {
    try { return typeof GM_xmlhttpRequest === 'function'; } catch { return false; }
  }

  // arraybuffer rather than blob: it is the response type every manager
  // implements consistently, and JSZip takes it directly.
  function gmRequest(url, kind, ms, extraHeaders) {
    return withDeadline(kind === 'text' ? 'page request' : 'file request', ms, (ok, fail) => {
      const headers = kind === 'text'
        ? Object.assign({ Accept: 'text/html,application/json,application/xhtml+xml,*/*' }, extraHeaders || {})
        : Object.assign({ Referer: `${ORIGIN}/` }, extraHeaders || {});
      const handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        responseType: kind === 'text' ? undefined : 'arraybuffer',
        headers,
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
      anchor.download = name.split('/').pop() || 'playboyplus_archive.zip';
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
    // Written here rather than at the two ends of runQueue so that every way a
    // run can start or stop — including the single-gallery button and a failure
    // that unwinds to the finally — leaves the same mark.
    try {
      if (busy) sessionStorage.setItem(RUNNING_KEY, '1');
      else sessionStorage.removeItem(RUNNING_KEY);
    } catch {}
    if (!busy) {
      state.queueRunning = false;
      // A stale cancel would otherwise abort the next thing that checks it.
      state.cancel = false;
    }
    ui.go.textContent = busy ? 'Stop' : 'Download Gallery';
    ui.go.classList.toggle('pb-stop', busy);
    ui.go.disabled = busy ? false : !albumRefFromLocation();
    // Adding stays open during a run — the loop picks up late arrivals — but
    // clearing the list out from under it does not.
    ui.clear.disabled = busy;
    ui.addAll.disabled = busy || !isListingUrl(location.href);
    ui.index.disabled = busy;
    renderQueue();
  }

  // Either button stops everything: a cancel is aimed at the run, not at
  // whichever gallery happens to be in flight.
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
  // first screenful of cards may already be built. Both are synchronous reads
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
