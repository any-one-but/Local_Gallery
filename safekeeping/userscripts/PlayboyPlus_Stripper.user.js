// ==UserScript==
// @name         Playboy Plus Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.02.00
// @description  Playboy Plus gallery downloader. Drop a model link to download her galleries one at a time, named by model and date.
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
// The Zishy Stripper, rebuilt for Playboy Plus. Same panel and naming. What had
// to change is where the information comes from.
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
//      clip id of the bonus video.
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
  // pages into fast, light surfaces:
  // nothing here affects downloading, because a download never reads the visible
  // page — it asks the site for the gallery's files directly.
  //
  // Add or remove lines freely. These stay hidden while the script is running.

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
  const ALBUM_DELAY_MS = 800;    // between galleries in a model run
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
  // offers, which on newer sets is 4K and runs to about 1.3 GB apiece.
  const VIDEO_QUALITIES = ['best', '1080p', '720p', '480p'];
  const DEFAULT_VIDEO_QUALITY = 'best';
  // Largest first. This is the order a step-down walks.
  const VIDEO_QUALITY_ORDER = ['4k', '2160p', '1440p', '1080p', '960p', '720p', '540p', '480p', '432p', '360p', '288p', '240p', '160p'];

  // The video goes in the zip with the photos, sharing their numbering, the way
  // Zishy's does. The cost is that a browser builds a zip entirely in memory, so
  // the clip has to be held there whole and then held again as part of the
  // finished archive. At 1080p that is around half a gigabyte and unremarkable;
  // at Best it can be over a gigabyte and twice that while the zip is being
  // written, which is a lot to ask of a tab. Past this size the log says so
  // before it starts, so a failure reads as the size it was rather than as a
  // mystery.
  const VIDEO_SIZE_WARN_BYTES = 900 * 1024 * 1024;

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

  // Where a set that is nobody's goes. See "compilations" below: it is the same
  // question as whether the compilations toggle would skip it, deliberately, so
  // that turning that toggle on empties this folder rather than leaving some of
  // it behind.
  const MULTI_MODEL_FOLDER = '_Various';

  // Past this many models a set is a roundup whatever its title says. See the
  // ceiling in "compilations".
  const COLLAB_MAX_MODELS = 6;

  // Nearly every title on this site reads "<Model> in <Something>". Stripping the
  // model off the front, the way Zishy does, would leave "In Something" on
  // thousands of files. With this on the leading connector goes too.
  const STRIP_LEADING_IN = true;

  const FILTER_KEY = 'PlayboyStripper.filter.v1';
  const COMPILATION_KEY = 'PlayboyStripper.compilations.v1';
  const HIDDEN_TYPES_KEY = 'PlayboyStripper.hiddentypes.v1';

  // The six kinds of model the site files people under, in the order the chips
  // sit in the panel. The slug is the site's own; the label is what fits on a
  // chip. Three other categories exist — Editors' Choice, VIP Content and a
  // five-set MetArt oddity — and are deliberately not here: they describe the
  // content, not the woman, and there is no "Editors' Choice model" to hide.
  const MODEL_TYPES = [
    { slug: 'Playmates', label: 'Playmates' },
    { slug: 'Playboy-Muses', label: 'Muses' },
    { slug: 'Playboy-Creator', label: 'Creator' },
    { slug: 'All-Stars', label: 'All Stars' },
    { slug: 'International', label: 'International' },
    { slug: 'Celebrities', label: 'Celebrities' }
  ];

  // What a model is filed under, for all 4,738 of them: five queries, about two
  // seconds and 120 KB. Small enough to hold whole, which is what makes hiding a
  // type an instant answer rather than a lookup per card. Kept on disk because it
  // describes the site rather than anything you did, and re-read after a week in
  // case somebody has been recategorised.
  const ACTOR_TYPES_KEY = 'PlayboyStripper.actortypes.v1';
  const TYPE_TABLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  // Which models are in a gallery, learned only for the galleries whose links you
  // have actually looked at. The whole catalogue would be sixteen times the size
  // of the model table and almost all of it would go unread.
  const SET_TYPES_KEY = 'PlayboyStripper.settypes.v1';
  const SET_TYPE_CACHE_LIMIT = 20000;
  const TYPE_LOOKUP_BATCH = 60;
  const QUALITY_KEY = 'PlayboyStripper.quality.v1';
  const PANEL_POS_KEY = 'PlayboyStripper.panelpos.v1';
  const INDEX_DB_NAME = 'PlayboyStripper.indexlogs.v1';
  const INDEX_DB_STORE = 'logs';
  const ADVANCED_STATE_KEY = 'PlayboyStripper.advancedState.v1';
  const DOWNLOAD_STATUSES = ['not', 'partial', 'full'];

  // Algolia, the search service the site's own listings run on. The indexes are
  // the same three the site queries; the credentials are read off the page.
  const ALGOLIA_PHOTOSETS = 'all_photosets';
  const ALGOLIA_SCENES = 'all_scenes';
  const ALGOLIA_ACTORS = 'all_actors';
  // Algolia caps a page at 1000. Smaller pages cost more requests but each one
  // comes back faster and a stopped listing read loses less.
  const ALGOLIA_PAGE_SIZE = 500;
  const ALGOLIA_MAX_PAGES = 200;

  // ===========================================================================

  const state = {
    busy: false,
    cancel: false,
    fileFilter: DEFAULT_FILE_FILTER,
    videoQuality: DEFAULT_VIDEO_QUALITY,
    compilations: 'include',
    hiddenTypes: new Set(),
    actorTypes: null,
    actorTypesAt: 0,
    actorTypesLoading: null,
    setTypes: new Map(),
    typeLookupWanted: new Set(),
    typeLookupRunning: false,
    transport: '',
    algolia: null,
    aborters: new Set(),
    pane: 'simple',
    searchTimer: 0,
    hiddenModels: new Set(),
    hiddenSets: new Set(),
    modelDownloadStatus: new Map(),
    setDownloadStatus: new Map(),
    importSetMatches: new Set(),
    importModelMatches: new Set(),
    skipVariousDownloads: false,
    hideVariousSets: false
  };

  const ui = {};
  let hideStyleEl = null;
  let cardHideStyleEl = null;

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
  // and returning false stops the walk, which is what lets a listing read be
  // stopped partway.
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

  function applyCardHideStyle() {
    cardHideStyleEl = document.createElement('style');
    cardHideStyleEl.id = 'playboyStripperCardRules';
    cardHideStyleEl.textContent = '.pbGot { display: none !important; }';
    (document.head || document.documentElement).appendChild(cardHideStyleEl);
  }

  // What this link offers, or null when it is not an offer at all.
  function linkTarget(anchor) {
    try { if (anchor.closest(CARD_SKIP_WITHIN)) return null; } catch {}
    return targetFromUrl(anchor.getAttribute('href'), location.href);
  }

  function targetLinkCount(node) {
    return Array.from(node.querySelectorAll('a[href]')).filter(linkTarget).length;
  }

  // A link goes when it is a kind of model you turned off. The type answer can be
  // "not yet", and not-yet means leave it
  // alone — a card that appears and then vanishes reads worse than one that takes
  // a moment to go.
  function linkShouldHide(target) {
    if (!target) return false;
    return targetIsHiddenType(target) === true;
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

  // Re-tests the whole page. It is a full pass rather than an incremental one
  // because the climb needs a
  // settled DOM: mid-render, a grid that will hold thirty entries holds one, and
  // an incremental mark would climb straight past the card and hide the grid.
  function refreshHiddenCards() {
    if (!document.body) return;
    Array.from(document.querySelectorAll('.pbGot')).forEach(el => el.classList.remove('pbGot'));
    Array.from(document.querySelectorAll('a[href]')).forEach(anchor => {
      const target = linkTarget(anchor);
      if (!linkShouldHide(target)) return;
      cardForAnchor(anchor).classList.add('pbGot');
    });
  }

  // The one entry point everything uses to ask for a re-test, so a type lookup
  // landing and the page rebuilding its own grid cannot each start their own.
  let cardRefreshTimer = 0;
  function scheduleCardRefresh() {
    clearTimeout(cardRefreshTimer);
    cardRefreshTimer = setTimeout(refreshHiddenCards, 120);
  }

  // One observer for both jobs. Image blocking is per-node and has to happen the
  // instant the node appears, or the request is already away. Card hiding is the
  // opposite: it needs the DOM to have settled, so it is coalesced into one full
  // pass on a short timer — which matters far more here than on a plain HTML
  // site, because this page rebuilds its grids as you scroll.
  function installEarlyObserver() {
    const combined = BLOCK_HIDDEN_IMAGE_LOADS ? hideSelectorList().join(',') : '';
    const scheduleCardPass = scheduleCardRefresh;

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
      if (combined) {
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
      if (sawElement) scheduleCardPass();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // --- panel ----------------------------------------------------------------

  function init() {
    injectStyle();
    const panel = document.createElement('div');
    panel.id = 'playboyStripperPanel';
    panel.innerHTML = `
      <div class="pb-head">
        <span class="pb-title">Playboy Plus Stripper</span>
        <button id="pbCollapse" class="pb-iconBtn" type="button" title="Collapse">&#9652;</button>
      </div>
      <div class="pb-body">
        <div class="pb-tabs" role="tablist" aria-label="Tool panes">
          <button id="pbSimpleTab" class="pb-tab pb-tabOn" type="button">Simple</button>
          <button id="pbAdvancedTab" class="pb-tab" type="button">Advanced</button>
          <button id="pbIndexingTab" class="pb-tab" type="button">Indexing</button>
        </div>
        <div id="pbSimplePane" class="pb-pane">
          <div id="pbDrop" class="pb-drop" title="Drop one model link, or one gallery link that resolves to one model">Drop one model link here</div>
        </div>
        <div id="pbAdvancedPane" class="pb-pane pb-advancedPane" hidden>
          <div class="pb-advancedSimple">
            <div id="pbAdvancedDrop" class="pb-drop" title="Drop one model link, or one gallery link that resolves to one model">Drop one model link here</div>
          </div>
          <div class="pb-searchTools">
            <div class="pb-advBlock">
              <div class="pb-advKicker">Find</div>
              <input id="pbSearchQuery" class="pb-searchInput" type="search" placeholder="Search models or sets">
            </div>
            <div class="pb-advBlock">
              <div class="pb-filterGroups">
                <div class="pb-filterGroup">
                  <div class="pb-filterGroupName">Look</div>
                  <div class="pb-filterGrid pb-filterLook">
                    <label><span>Show</span><select id="pbSearchKind">
                      <option value="all">Models and sets</option>
                      <option value="model">Models only</option>
                      <option value="set">Sets only</option>
                    </select></label>
                    <label><span>Type</span><select id="pbSearchType">
                      <option value="">Any type</option>
                      ${MODEL_TYPES.map(type => `<option value="${type.slug}">${type.label}</option>`).join('')}
                    </select></label>
                    <label><span>Files</span><select id="pbSearchFiles">
                      <option value="all">Any files</option>
                      <option value="images">Has images</option>
                      <option value="videos">Has videos</option>
                      <option value="both">Images and videos</option>
                      <option value="no-images">No images</option>
                      <option value="no-videos">No videos</option>
                      <option value="images-only">Images only</option>
                      <option value="videos-only">Videos only</option>
                    </select></label>
                  </div>
                </div>
                <div class="pb-filterGroup">
                  <div class="pb-filterGroupName">When</div>
                  <div class="pb-filterGrid pb-filterWhen">
                    <label><span>From</span><input id="pbSearchDateFrom" type="text" inputmode="numeric" placeholder="YYYY or YYYY-MM"></label>
                    <label><span>To</span><input id="pbSearchDateTo" type="text" inputmode="numeric" placeholder="YYYY or YYYY-MM-DD"></label>
                  </div>
                </div>
                <div class="pb-filterGroup">
                  <div class="pb-filterGroupName">Counts</div>
                  <div class="pb-filterGrid pb-filterCounts">
                    <label class="pb-filterRangeLabel"><span>Images</span>
                      <div class="pb-filterRange">
                        <input id="pbSearchImagesMin" type="number" min="0" step="1" placeholder="Min">
                        <span class="pb-filterDash" aria-hidden="true"></span>
                        <input id="pbSearchImagesMax" type="number" min="0" step="1" placeholder="Max">
                      </div>
                    </label>
                    <label class="pb-filterRangeLabel"><span>Videos</span>
                      <div class="pb-filterRange">
                        <input id="pbSearchVideosMin" type="number" min="0" step="1" placeholder="Min">
                        <span class="pb-filterDash" aria-hidden="true"></span>
                        <input id="pbSearchVideosMax" type="number" min="0" step="1" placeholder="Max">
                      </div>
                    </label>
                    <label><span>Views</span><input id="pbSearchViewsMin" type="number" min="0" step="1" placeholder="Min"></label>
                    <label><span>Likes</span><input id="pbSearchLikesMin" type="number" min="0" step="1" placeholder="Min"></label>
                  </div>
                </div>
              </div>
            </div>
            <div class="pb-searchActions">
              <button id="pbSearchRun" type="button">Search</button>
              <button id="pbSearchClear" type="button">Clear</button>
            </div>
            <div class="pb-advBlock pb-advHousekeep">
              <div class="pb-advKicker">Housekeeping</div>
              <button id="pbHideVideoOnly" type="button">Hide Video-Only Sets</button>
              <div class="pb-advHousekeepRow">
                <label class="pb-optionRow"><input id="pbHideVarious" type="checkbox"> <span>Hide all Various sets</span></label>
                <label class="pb-optionRow"><input id="pbSkipVarious" type="checkbox"> <span>Skip Various sets when downloading</span></label>
              </div>
            </div>
            <div class="pb-advResultsWrap">
              <div id="pbSearchSummary" class="pb-searchSummary">Index or import logs, then search.</div>
              <div id="pbSearchResults" class="pb-searchResults"></div>
            </div>
          </div>
        </div>
        <div id="pbIndexingPane" class="pb-pane pb-indexingPane" hidden>
          <div class="pb-indexStats">
            <span>Browser logs</span>
            <strong id="pbIndexLogCount">Loading</strong>
          </div>
          <button id="pbIndexStart" type="button">Index Site</button>
          <button id="pbIndexImport" type="button">Import Index Log</button>
          <button id="pbImportDownloads" type="button">Import Download Folder</button>
          <button id="pbIndexPurge" type="button">Purge Browser Logs</button>
          <input id="pbIndexFile" type="file" accept="application/json,.json" multiple hidden>
          <input id="pbImportDir" type="file" webkitdirectory directory multiple hidden>
          <div id="pbImportSummary" class="pb-importSummary" hidden></div>
          <div id="pbImportActions" class="pb-importActions" hidden>
            <button data-import-action="mark-full" type="button">Mark Full</button>
            <button data-import-action="mark-partial" type="button">Mark Partial</button>
            <button data-import-action="hide-sets" type="button">Hide Sets</button>
            <button data-import-action="hide-models" type="button">Hide Models</button>
          </div>
        </div>
        <div class="pb-progress" hidden><div id="pbFill"></div></div>
        <div class="pb-live" aria-live="polite" hidden>
          <div class="pb-line"><span>Model</span><strong id="pbModel">None</strong></div>
          <div class="pb-line"><span>Sets</span><strong id="pbSets">0/0</strong></div>
          <div class="pb-line"><span>Current</span><strong id="pbAlbum">None</strong></div>
          <div class="pb-line"><span>Files</span><strong id="pbFiles">0/0</strong></div>
        </div>
        <div id="pbStatus" class="pb-status" hidden></div>
        <button id="pbStop" type="button" hidden>Stop</button>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.progress = panel.querySelector('.pb-progress');
    ui.live = panel.querySelector('.pb-live');
    ui.fill = panel.querySelector('#pbFill');
    ui.model = panel.querySelector('#pbModel');
    ui.sets = panel.querySelector('#pbSets');
    ui.album = panel.querySelector('#pbAlbum');
    ui.files = panel.querySelector('#pbFiles');
    ui.status = panel.querySelector('#pbStatus');
    ui.drop = panel.querySelector('#pbDrop');
    ui.advancedDrop = panel.querySelector('#pbAdvancedDrop');
    ui.stop = panel.querySelector('#pbStop');
    ui.simpleTab = panel.querySelector('#pbSimpleTab');
    ui.advancedTab = panel.querySelector('#pbAdvancedTab');
    ui.indexingTab = panel.querySelector('#pbIndexingTab');
    ui.simplePane = panel.querySelector('#pbSimplePane');
    ui.advancedPane = panel.querySelector('#pbAdvancedPane');
    ui.indexingPane = panel.querySelector('#pbIndexingPane');
    ui.indexStart = panel.querySelector('#pbIndexStart');
    ui.indexImport = panel.querySelector('#pbIndexImport');
    ui.indexPurge = panel.querySelector('#pbIndexPurge');
    ui.indexFile = panel.querySelector('#pbIndexFile');
    ui.importDownloads = panel.querySelector('#pbImportDownloads');
    ui.importDir = panel.querySelector('#pbImportDir');
    ui.importSummary = panel.querySelector('#pbImportSummary');
    ui.importActions = panel.querySelector('#pbImportActions');
    ui.indexLogCount = panel.querySelector('#pbIndexLogCount');
    ui.searchQuery = panel.querySelector('#pbSearchQuery');
    ui.searchKind = panel.querySelector('#pbSearchKind');
    ui.searchType = panel.querySelector('#pbSearchType');
    ui.searchFiles = panel.querySelector('#pbSearchFiles');
    ui.searchDateFrom = panel.querySelector('#pbSearchDateFrom');
    ui.searchDateTo = panel.querySelector('#pbSearchDateTo');
    ui.searchImagesMin = panel.querySelector('#pbSearchImagesMin');
    ui.searchImagesMax = panel.querySelector('#pbSearchImagesMax');
    ui.searchVideosMin = panel.querySelector('#pbSearchVideosMin');
    ui.searchVideosMax = panel.querySelector('#pbSearchVideosMax');
    ui.searchViewsMin = panel.querySelector('#pbSearchViewsMin');
    ui.searchLikesMin = panel.querySelector('#pbSearchLikesMin');
    ui.searchRun = panel.querySelector('#pbSearchRun');
    ui.searchClear = panel.querySelector('#pbSearchClear');
    ui.hideVideoOnly = panel.querySelector('#pbHideVideoOnly');
    ui.hideVarious = panel.querySelector('#pbHideVarious');
    ui.skipVarious = panel.querySelector('#pbSkipVarious');
    ui.searchSummary = panel.querySelector('#pbSearchSummary');
    ui.searchResults = panel.querySelector('#pbSearchResults');

    ui.stop.addEventListener('click', requestStop);
    ui.simpleTab.addEventListener('click', () => setPane('simple'));
    ui.advancedTab.addEventListener('click', () => setPane('advanced'));
    ui.indexingTab.addEventListener('click', () => setPane('indexing'));
    ui.indexStart.addEventListener('click', () => startIndexing().catch(err => logLine(`Index failed: ${errorMessage(err)}`)));
    ui.indexImport.addEventListener('click', () => ui.indexFile.click());
    ui.importDownloads.addEventListener('click', () => ui.importDir.click());
    ui.indexPurge.addEventListener('click', () => purgeIndexLogs().catch(err => logLine(`Could not purge logs: ${errorMessage(err)}`)));
    ui.indexFile.addEventListener('change', () => importIndexLogFiles(ui.indexFile.files).catch(err => logLine(`Could not import: ${errorMessage(err)}`)));
    ui.importDir.addEventListener('change', () => importDownloadStructure(ui.importDir.files).catch(err => showSearchMessage(`Folder import failed: ${errorMessage(err)}`)));
    ui.importActions.addEventListener('click', handleImportAction);
    ui.searchResults.addEventListener('click', handleSearchResultAction);
    ui.searchRun.addEventListener('click', () => runAdvancedSearch().catch(err => showSearchMessage(`Search failed: ${errorMessage(err)}`)));
    ui.searchClear.addEventListener('click', clearAdvancedSearch);
    ui.hideVideoOnly.addEventListener('click', () => hideVideoOnlySets().catch(err => showSearchMessage(`Could not hide video-only sets: ${errorMessage(err)}`)));
    ui.hideVarious.addEventListener('change', () => setHideVariousSets(ui.hideVarious.checked));
    ui.skipVarious.addEventListener('change', () => setSkipVariousDownloads(ui.skipVarious.checked));
    [ui.searchQuery, ui.searchKind, ui.searchType, ui.searchFiles, ui.searchDateFrom, ui.searchDateTo,
      ui.searchImagesMin, ui.searchImagesMax, ui.searchVideosMin, ui.searchVideosMax, ui.searchViewsMin, ui.searchLikesMin]
      .forEach(control => control.addEventListener('input', scheduleAdvancedSearch));
    makePanelDraggable(panel, panel.querySelector('.pb-head'));
    installDropTarget(panel);
    panel.querySelector('#pbCollapse').addEventListener('click', () => {
      panel.classList.toggle('pb-collapsed');
      panel.querySelector('#pbCollapse').innerHTML = panel.classList.contains('pb-collapsed') ? '&#9662;' : '&#9652;';
    });

    setFileFilter(state.fileFilter);
    loadVideoQuality();
    loadCompilationMode();
    loadHiddenTypes();
    installRouteObserver();
    installSoftNavigation();
    syncContext();
    renderAdvancedStateControls();
    updateIndexLogCount();
    // The body existed before the observer did, so anything already parsed has
    // not been judged yet.
    refreshHiddenCards();
  }

  // Kept per tab: it dies with the tab and leaves nothing on disk.
  function setFileFilter(mode) {
    state.fileFilter = FILE_FILTERS.indexOf(mode) >= 0 ? mode : DEFAULT_FILE_FILTER;
    if (ui.filter) ui.filter.textContent = `Download: ${FILE_FILTER_LABELS[state.fileFilter]}`;
    try { sessionStorage.setItem(FILTER_KEY, state.fileFilter); } catch {}
  }

  function loadFileFilter() {
    setFileFilter(DEFAULT_FILE_FILTER);
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
    setVideoQuality(DEFAULT_VIDEO_QUALITY);
  }

  function wantsKind(kind) {
    if (state.fileFilter === 'images') return kind === 'image';
    if (state.fileFilter === 'videos') return kind === 'video';
    return true;
  }

  // --- compilations, and the one question they answer ------------------------
  //
  // Two kinds of set carry several models, and they are not the same thing at
  // all. One is a joint set — new work, made by those models together, and as
  // much theirs as any solo set. The other is a roundup: playmates of the year,
  // a month's unpublished leftovers, event coverage, a best-of. Old pictures,
  // a dozen women, nobody's set in particular, and the same photographs you
  // already have filed under the people who took part.
  //
  // This is *one* question, asked once, and two things read the answer: whether
  // the compilations toggle skips the set, and whether the set files under its
  // models or under _Various. They used to be decided separately — skipping by
  // the test below, filing by a flat "more than two models" count — and the
  // disagreement was visible in the worst way: turn skipping on, and _Various
  // still filled up, with genuine three- and four-model joint sets that the
  // count had no way to recognise. So the count is gone. A set is somebody's or
  // it is nobody's, and _Various is exactly the second kind, which is why
  // turning the toggle on now empties that folder rather than thinning it.
  //
  // Nothing in the catalogue distinguishes them. There is a `compilation` field
  // and it says "0" or nothing on every record on the site, so it is a column
  // somebody never filled in. Two things do distinguish them.
  //
  // The first is the title, and it works because of what a title is for:
  //
  //   a set that belongs to its models is named after them.
  //
  // "Bryona, Braylin and Odette in Treat for Three" says whose it is. "Playmates
  // of the Year 2020" and "Daily Double - June 2001" and "Events - Spring Break
  // 2001" do not, because they are not anybody's.
  //
  // The second is a ceiling, and it is there because the first has a failure
  // mode that gets worse the bigger the set is. A name only counts as evidence
  // while a coincidence is unlikely; across forty-eight women the chance that
  // one of their names turns up in any title at all approaches certainty. That
  // is not a hypothetical — "Daily Double - April 2009" lists forty-eight models
  // and one of them is April Ireland, and "Daily Double - April 2006" lists
  // thirty-three including April Renee. Both read as joint sets on the title
  // test alone. Both are roundups, and the month in the title has nothing to do
  // with the woman. So past COLLAB_MAX_MODELS the title is not consulted: a set
  // that large is a roundup whatever it is called.
  //
  // Six is the ceiling because five thousand sets sampled across the whole
  // archive hold ninety-one joint sets, and they run 82 of two models, 6 of
  // three and 3 of four. Nothing real comes close to it, and the two Daily
  // Doubles are the only things it catches that the title test missed.
  //
  // Two deliberate limits:
  //
  //   - A set with one model is never a compilation, whatever its title. A
  //     remaster of one woman's old pictorial is still hers, and it files under
  //     her name like everything else she has done.
  //   - A set with no models listed at all is left alone too. There are no names
  //     to test a title against, so there is nothing to be right about — and
  //     those go to the untagged folder anyway rather than into anyone's.
  //
  // Below the ceiling the one way it errs is toward keeping: a model called
  // Summer on a set called "Summer Days" reads as named. That is the harmless
  // direction.

  function setCompilationMode(mode) {
    state.compilations = 'include';
    if (ui.compilations) {
      ui.compilations.textContent = `Compilations: ${state.compilations === 'skip' ? 'Skip' : 'Include'}`;
      ui.compilations.classList.toggle('pb-compilationsOn', state.compilations === 'skip');
    }
    try { sessionStorage.setItem(COMPILATION_KEY, state.compilations); } catch {}
  }

  function loadCompilationMode() {
    setCompilationMode('include');
  }

  // Letters and digits only, single-spaced, so "Naj'a Irie" and "Naja Irie" are
  // the same words and punctuation in a title cannot hide a name behind it.
  function bareWords(raw) {
    return String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Whole words, padded at both ends, because a title is allowed to contain a
  // name and not merely the letters of one — "Kit" must not match "Kitchen".
  // First names count on their own: joint sets are titled with them ("Elly and
  // Kei in Co-Pilots") far more often than with full ones. Two letters is too
  // short to be evidence of anything.
  function titleNamesAnyModel(title, names) {
    const words = ` ${bareWords(title)} `;
    return (names || []).some(name => {
      const full = bareWords(name);
      if (!full) return false;
      if (full.length > 2 && words.includes(` ${full} `)) return true;
      const first = full.split(' ')[0];
      return first.length > 2 && words.includes(` ${first} `);
    });
  }

  // The one question, in one place. Everything else here asks it through one of
  // the two wrappers below, so what gets skipped and what lands in _Various can
  // never be two different answers.
  function setBelongsToNobody(title, names) {
    const real = (names || []).map(name => String(name || '').trim()).filter(Boolean);
    if (real.length < 2) return false;
    if (real.length > COLLAB_MAX_MODELS) return true;
    return !titleNamesAnyModel(title, real);
  }

  // Asked of a catalogue record before it is saved.
  function isCompilationRecord(record) {
    const names = ((record && record.actors) || []).map(actor => actor && actor.name);
    return setBelongsToNobody(record && record.title, names);
  }

  // Asked of a gallery being saved. The verdict is settled once, in scanAlbum,
  // off the same catalogue record, so the folder cannot disagree with the skip
  // for want of a comma somewhere in a title.
  function albumBelongsToNobody(album) {
    if (album && typeof album.nobodys === 'boolean') return album.nobodys;
    return setBelongsToNobody(album && album.title, (album && album.models) || []);
  }

  function skippingCompilations() {
    return state.compilations === 'skip';
  }

  // --- hiding a kind of model ------------------------------------------------
  //
  // Six chips, one per kind of model the site files people under. A chip turned
  // off takes that kind out of sight and out of downloads entirely: her own card
  // in a model listing, every gallery of hers, and every gallery link on the
  // page that leads to one.
  //
  // The obvious implementation is the wrong one. Galleries carry a category of
  // their own and it is tempting to read the type off that, but it does not say
  // what it appears to say — it is a shelf the set was put on, not a statement
  // about who is in it. Sara Jean Underwood is a Playmate and sixteen of her
  // fifty sets are filed under Editors' Choice. Kim Kardashian is a Celebrity and
  // her one set is filed under Editors' Choice, so a set-category reading of
  // "hide celebrities" would leave the only celebrity set on screen. Pamela
  // Anderson has twenty-three sets and exactly one of them is filed under
  // Celebrities.
  //
  // So the type is the model's, and a gallery inherits it from whoever is in it.
  // A gallery is hidden when any of its models is of a hidden kind — any, not
  // all, because a joint set with a hidden model in it is a set you asked not to
  // see. Its own category is consulted as well, which costs nothing and catches
  // the handful of sets that carry a type but list nobody.
  //
  // That reading needs to know what everyone is, so it holds the whole model
  // table: 4,738 people, five queries, two seconds, 120 KB, and then every
  // question about a model is answered without asking anything. The galleries are
  // the other way round — sixteen times as many and mostly never looked at — so
  // those are learned in batches as their links appear, and remembered.

  function anyTypeHidden() {
    return state.hiddenTypes.size > 0;
  }

  function typeIsHidden(slug) {
    return state.hiddenTypes.has(String(slug || ''));
  }

  function setHiddenTypes(slugs) {
    const known = new Set(MODEL_TYPES.map(type => type.slug));
    state.hiddenTypes = new Set((slugs || []).map(String).filter(slug => known.has(slug)));
    renderTypeChips();
    try { sessionStorage.setItem(HIDDEN_TYPES_KEY, JSON.stringify(Array.from(state.hiddenTypes))); } catch {}
  }

  function loadHiddenTypes() {
    setHiddenTypes([]);
  }

  function toggleHiddenType(slug) {
    const next = new Set(state.hiddenTypes);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setHiddenTypes(Array.from(next));
  }

  function renderTypeChips() {
    if (!ui.types) return;
    Array.from(ui.types.querySelectorAll('.pb-typeChip')).forEach(chip => {
      const slug = chip.getAttribute('data-type');
      const hidden = typeIsHidden(slug);
      const label = chip.getAttribute('data-label') || slug;
      chip.classList.toggle('pb-typeOff', hidden);
      chip.setAttribute('aria-pressed', hidden ? 'false' : 'true');
      chip.title = hidden ? `Show ${label} again` : `Hide ${label} — her card, her galleries, and any set she is in`;
    });
  }

  // --- the model table -------------------------------------------------------

  function loadActorTypes() {
    state.actorTypes = null;
    state.actorTypesAt = 0;
    let raw = '';
    try { raw = localStorage.getItem(ACTOR_TYPES_KEY) || ''; } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.actors) return;
      const table = new Map();
      Object.keys(parsed.actors).forEach(id => {
        const slugs = parsed.actors[id];
        if (Array.isArray(slugs) && slugs.length) table.set(String(id), slugs.map(String));
      });
      if (!table.size) return;
      state.actorTypes = table;
      state.actorTypesAt = Number(parsed.t) || 0;
    } catch {}
  }

  function saveActorTypes() {
    if (!state.actorTypes) return;
    const actors = {};
    state.actorTypes.forEach((slugs, id) => { actors[id] = slugs; });
    try {
      localStorage.setItem(ACTOR_TYPES_KEY, JSON.stringify({ t: state.actorTypesAt, actors }));
    } catch (err) {
      logLine(`The model table could not be saved (${errorMessage(err)}); it will be read again next time.`);
    }
  }

  function actorTypesAreFresh() {
    return !!state.actorTypes && (Date.now() - state.actorTypesAt) < TYPE_TABLE_MAX_AGE_MS;
  }

  // One load at a time however many callers want it, because everything that
  // touches a type wants it at once the moment a chip is turned off.
  function ensureActorTypes() {
    if (actorTypesAreFresh()) return Promise.resolve(state.actorTypes);
    if (state.actorTypesLoading) return state.actorTypesLoading;
    state.actorTypesLoading = (async () => {
      const table = new Map();
      logLine('Reading what kind of model everyone is; this happens once.');
      await algoliaWalk(ALGOLIA_ACTORS, {
        hitsPerPage: 1000,
        attributesToRetrieve: JSON.stringify(['actor_id', 'categories'])
      }, hits => {
        hits.forEach(hit => {
          const id = String(hit.actor_id || '');
          if (!/^\d+$/.test(id)) return;
          const slugs = (hit.categories || []).map(category => String(category && category.url_name || '')).filter(Boolean);
          if (slugs.length) table.set(id, slugs);
        });
        return true;
      });
      state.actorTypes = table;
      state.actorTypesAt = Date.now();
      saveActorTypes();
      logLine(`Model table ready: ${table.size} models.`);
      return table;
    })().catch(err => {
      // A failure must not be remembered as an empty table, or every model on the
      // site would read as having no type at all and nothing would ever hide.
      logLine(`Could not read the model table (${errorMessage(err)}); types cannot be judged until it loads.`);
      return null;
    }).then(table => {
      state.actorTypesLoading = null;
      return table;
    });
    return state.actorTypesLoading;
  }

  function actorTypeSlugs(actorId) {
    if (!state.actorTypes) return null;
    return state.actorTypes.get(String(actorId)) || [];
  }

  // --- the gallery table -----------------------------------------------------

  function loadSetTypes() {
    state.setTypes = new Map();
    let raw = '';
    try { raw = localStorage.getItem(SET_TYPES_KEY) || ''; } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      Object.keys(parsed).forEach(id => {
        const entry = parsed[id];
        if (!entry || !/^\d+$/.test(id)) return;
        state.setTypes.set(id, {
          c: (entry.c || []).map(String),
          a: (entry.a || []).map(String),
          n: typeof entry.n === 'number' ? (entry.n ? 1 : 0) : undefined
        });
      });
    } catch {}
  }

  let setTypesSaveTimer = 0;
  function saveSetTypesSoon() {
    clearTimeout(setTypesSaveTimer);
    setTypesSaveTimer = setTimeout(() => {
      const out = {};
      let written = 0;
      state.setTypes.forEach((entry, id) => {
        if (written >= SET_TYPE_CACHE_LIMIT) return;
        out[id] = entry;
        written++;
      });
      try { localStorage.setItem(SET_TYPES_KEY, JSON.stringify(out)); } catch {}
    }, 1500);
  }

  function rememberSetRecord(record) {
    const id = String(record && record.set_id || '');
    if (!/^\d+$/.test(id)) return;
    state.setTypes.set(id, {
      c: (record.categories || []).map(category => String(category && category.url_name || '')).filter(Boolean),
      a: (record.actors || []).map(actor => String(actor && actor.actor_id || '')).filter(id2 => /^\d+$/.test(id2)),
      n: isCompilationRecord(record) ? 1 : 0
    });
    saveSetTypesSoon();
  }

  // --- the verdict -----------------------------------------------------------

  function slugsAreHidden(slugs) {
    return (slugs || []).some(typeIsHidden);
  }

  function recordShouldHide(record) {
    return recordIsHiddenType(record);
  }

  // Straight off a catalogue record, for anything already holding one.
  function recordIsHiddenType(record) {
    if (!anyTypeHidden() || !record) return false;
    const own = (record.categories || []).map(category => String(category && category.url_name || ''));
    if (slugsAreHidden(own)) return true;
    return (record.actors || []).some(actor => slugsAreHidden(actorTypeSlugs(actor && actor.actor_id)));
  }

  // For a link on the page, where the answer may not be known yet. Returns null
  // for "ask me later" so the caller can leave the card alone rather than guess
  // at it — a card that flickers into view and back out again is worse than one
  // that takes a moment to go.
  function targetIsHiddenType(target) {
    if (targetIsUserHidden(target)) return true;
    if (!anyTypeHidden() || !target) return false;
    if (!state.actorTypes) { ensureActorTypes().then(scheduleCardRefresh); return null; }
    if (target.kind === 'model') return slugsAreHidden(actorTypeSlugs(target.id));
    const entry = state.setTypes.get(String(target.id));
    if (!entry) { wantSetType(target.id); return null; }
    if (slugsAreHidden(entry.c)) return true;
    return entry.a.some(actorId => slugsAreHidden(actorTypeSlugs(actorId)));
  }

  function targetIsUserHidden(target) {
    if (!target) return false;
    if (target.kind === 'model') return state.hiddenModels.has(String(target.id));
    if (state.hiddenSets.has(String(target.id))) return true;
    const entry = state.setTypes.get(String(target.id));
    if (state.hideVariousSets) {
      if (entry && entry.n === 1) return true;
      if (!entry || typeof entry.n !== 'number') wantSetType(target.id);
    }
    if (!entry) { wantSetType(target.id); return false; }
    return (entry.a || []).some(actorId => state.hiddenModels.has(String(actorId)));
  }

  function wantSetType(setId) {
    const id = String(setId);
    if (!/^\d+$/.test(id) || state.typeLookupWanted.has(id)) return;
    const entry = state.setTypes.get(id);
    if (entry && typeof entry.n === 'number') return;
    if (entry && !state.hideVariousSets) return;
    state.typeLookupWanted.add(id);
    runSetTypeLookups();
  }

  // Batched, because a listing page is thirty unknown galleries at once and thirty
  // queries for one screenful would be absurd. One run at a time, and it re-checks
  // the wanted list at the end, so links that appeared while it was in the air are
  // picked up by the same loop rather than starting a second one.
  async function runSetTypeLookups() {
    if (state.typeLookupRunning) return;
    state.typeLookupRunning = true;
    try {
      while (state.typeLookupWanted.size) {
        const batch = Array.from(state.typeLookupWanted).slice(0, TYPE_LOOKUP_BATCH);
        batch.forEach(id => state.typeLookupWanted.delete(id));
        const filters = batch.map(id => `set_id=${Number(id)}`).join(' OR ');
        let hits = [];
        try {
          const result = await algoliaSearch(ALGOLIA_PHOTOSETS, algoliaParams({
            hitsPerPage: batch.length,
            filters,
            attributesToRetrieve: JSON.stringify(['set_id', 'categories', 'actors'])
          }));
          hits = result.hits || [];
        } catch (err) {
          // Leaving them unknown is the safe failure: the cards stay visible.
          logLine(`Could not look up ${batch.length} galler${batch.length === 1 ? 'y' : 'ies'} (${errorMessage(err)}).`);
          continue;
        }
        hits.forEach(rememberSetRecord);
        // A gallery the catalogue does not answer for is recorded as having
        // nothing, or it would be asked for again on every pass forever.
        const answered = new Set(hits.map(hit => String(hit.set_id)));
        batch.forEach(id => { if (!answered.has(id)) state.setTypes.set(id, { c: [], a: [], n: 0 }); });
        saveSetTypesSoon();
        scheduleCardRefresh();
      }
    } finally {
      state.typeLookupRunning = false;
    }
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
      #playboyStripperPanel.pb-wide{width:min(760px,calc(100vw - 32px));max-height:94vh}
      #playboyStripperPanel [hidden]{display:none!important}
      #playboyStripperPanel.pb-collapsed{height:auto}
      #playboyStripperPanel.pb-collapsed .pb-body{display:none}
      #playboyStripperPanel .pb-head{height:38px;display:flex;align-items:center;gap:6px;padding:0 10px;
        touch-action:none;user-select:none;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#33261a,#1a1613);cursor:grab}
      #playboyStripperPanel.pb-dragging-panel .pb-head{cursor:grabbing}
      #playboyStripperPanel .pb-title{font-weight:900;color:#e0c48a;flex:1 1 auto;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #playboyStripperPanel .pb-iconBtn{flex:0 0 auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px;font-size:13px}
      #playboyStripperPanel .pb-body{display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0;overflow:auto}
      #playboyStripperPanel button{appearance:none;width:100%;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#f2ece1;font:700 12px/1 Arial,sans-serif;cursor:pointer}
      #playboyStripperPanel button:hover:not(:disabled){background:rgba(224,196,138,.2);border-color:rgba(224,196,138,.55)}
      #playboyStripperPanel button:disabled{opacity:.42;cursor:default}
      #playboyStripperPanel input,#playboyStripperPanel select{box-sizing:border-box;width:100%;min-width:0;height:30px;
        border:1px solid rgba(255,255,255,.14);border-radius:7px;background:#211d19;color:#f2ece1;
        font:700 12px/1 Arial,sans-serif;padding:0 8px;outline:none}
      #playboyStripperPanel input:focus,#playboyStripperPanel select:focus{border-color:rgba(224,196,138,.7);box-shadow:0 0 0 2px rgba(224,196,138,.14)}
      #playboyStripperPanel input::placeholder{color:#8f806b}
      #playboyStripperPanel .pb-tabs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
      #playboyStripperPanel .pb-tab{min-height:28px;border-radius:7px;color:#bdb1a0}
      #playboyStripperPanel .pb-tabOn{background:rgba(224,196,138,.18);border-color:rgba(224,196,138,.55);color:#f8edd4}
      #playboyStripperPanel .pb-pane{display:flex;flex-direction:column;gap:8px}
      #playboyStripperPanel .pb-advancedPane{gap:14px}
      #playboyStripperPanel .pb-advancedSimple{display:flex;flex-direction:column;gap:8px}
      #playboyStripperPanel .pb-advancedPane .pb-drop{min-height:56px;padding:12px 14px;letter-spacing:.02em}
      #playboyStripperPanel .pb-indexingPane{gap:8px}
      #playboyStripperPanel #pbStop{background:#4a3323;color:#ffeccf;border-color:rgba(224,196,138,.6)}
      #playboyStripperPanel .pb-progress{display:block;box-sizing:border-box;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      #playboyStripperPanel #pbFill{display:block;height:10px;min-height:10px;width:0;
        background:linear-gradient(90deg,#b08d4e,#e0c48a);transition:width 120ms ease}
      #playboyStripperPanel .pb-drop{display:flex;align-items:center;justify-content:center;min-height:44px;padding:6px 8px;
        border:1px dashed rgba(224,196,138,.45);border-radius:8px;background:rgba(224,196,138,.06);
        color:#b3a58c;font-weight:700;text-align:center}
      #playboyStripperPanel.pb-dragging .pb-drop{border-color:#e0c48a;border-style:solid;
        background:rgba(224,196,138,.22);color:#fff}
      #playboyStripperPanel .pb-live{display:flex;flex-direction:column;gap:5px}
      #playboyStripperPanel .pb-line{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;align-items:baseline}
      #playboyStripperPanel .pb-line span{color:#857a68;font-weight:900;text-transform:uppercase;font-size:10px}
      #playboyStripperPanel .pb-line strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee5d5;font-size:12px}
      #playboyStripperPanel .pb-indexStats{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;
        min-height:30px;padding:0 8px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:rgba(255,255,255,.045)}
      #playboyStripperPanel .pb-indexStats span{color:#857a68;font-weight:900;text-transform:uppercase;font-size:10px}
      #playboyStripperPanel .pb-indexStats strong{color:#eee5d5;font-size:12px}
      #playboyStripperPanel .pb-searchTools{display:flex;flex-direction:column;gap:14px}
      #playboyStripperPanel .pb-advBlock{display:flex;flex-direction:column;gap:8px}
      #playboyStripperPanel .pb-advKicker{color:#857a68;font-weight:900;letter-spacing:.12em;text-transform:uppercase;font-size:10px}
      #playboyStripperPanel .pb-searchInput{height:38px;font-size:13px;padding:0 12px;border-radius:9px}
      #playboyStripperPanel .pb-filterGroups{display:flex;flex-direction:column;gap:8px}
      #playboyStripperPanel .pb-filterGroup{display:grid;grid-template-columns:48px minmax(0,1fr);gap:8px 12px;align-items:start}
      #playboyStripperPanel .pb-filterGroupName{padding-top:18px;color:#857a68;font-weight:900;letter-spacing:.08em;text-transform:uppercase;font-size:10px}
      #playboyStripperPanel .pb-filterGrid{display:grid;gap:8px}
      #playboyStripperPanel .pb-filterLook{grid-template-columns:repeat(3,minmax(0,1fr))}
      #playboyStripperPanel .pb-filterWhen{grid-template-columns:repeat(2,minmax(0,1fr))}
      #playboyStripperPanel .pb-filterCounts{grid-template-columns:repeat(4,minmax(0,1fr))}
      #playboyStripperPanel .pb-filterGrid label{display:flex;flex-direction:column;gap:4px;min-width:0}
      #playboyStripperPanel .pb-filterGrid label span{color:#857a68;font-weight:900;letter-spacing:.06em;text-transform:uppercase;font-size:10px}
      #playboyStripperPanel .pb-filterRange{display:grid;grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr);align-items:center;gap:4px}
      #playboyStripperPanel .pb-filterDash{display:block;height:1px;background:rgba(224,196,138,.45)}
      #playboyStripperPanel .pb-advancedPane input[type=number]{-moz-appearance:textfield}
      #playboyStripperPanel .pb-advancedPane input[type=number]::-webkit-inner-spin-button,
      #playboyStripperPanel .pb-advancedPane input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
      #playboyStripperPanel .pb-searchActions{display:grid;grid-template-columns:1.4fr .8fr;gap:8px}
      #playboyStripperPanel .pb-advancedPane #pbSearchRun{background:#e0c48a;color:#1a1613;border-color:#c9ae72;font-weight:900}
      #playboyStripperPanel .pb-advancedPane #pbSearchRun:hover:not(:disabled){background:#edd4a4;border-color:#e0c48a}
      #playboyStripperPanel .pb-advancedPane #pbSearchClear{background:transparent}
      #playboyStripperPanel .pb-advHousekeep{padding-top:2px;border-top:1px solid rgba(224,196,138,.14)}
      #playboyStripperPanel .pb-advHousekeepRow{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:stretch}
      #playboyStripperPanel .pb-advancedPane #pbHideVideoOnly{background:transparent;color:#cfc2ae}
      #playboyStripperPanel .pb-optionRow{display:flex;align-items:center;gap:10px;min-height:32px;padding:0 10px;
        border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.03);color:#cfc2ae;font-weight:700}
      #playboyStripperPanel .pb-optionRow input{width:15px;height:15px;min-width:15px;padding:0;accent-color:#e0c48a}
      #playboyStripperPanel .pb-advResultsWrap{display:flex;flex-direction:column;gap:8px;min-height:72px;padding:12px;
        border:1px solid rgba(224,196,138,.14);border-radius:10px;background:rgba(0,0,0,.22)}
      #playboyStripperPanel .pb-searchSummary{min-height:18px;color:#bdb1a0;font-weight:700;line-height:1.4}
      #playboyStripperPanel .pb-searchResults{display:flex;flex-direction:column;gap:8px;max-height:42vh;overflow:auto;padding-right:2px}
      #playboyStripperPanel .pb-searchResults:empty{display:none}
      #playboyStripperPanel .pb-result{flex:0 0 auto;display:grid;grid-template-columns:28px minmax(0,1fr);gap:0;overflow:hidden;
        border:1px solid rgba(224,196,138,.16);border-radius:10px;background:rgba(255,255,255,.035)}
      #playboyStripperPanel .pb-resultHidden{border-color:rgba(202,87,87,.55);background:rgba(102,32,32,.22)}
      #playboyStripperPanel .pb-resultKind{display:flex;align-items:center;justify-content:center;align-self:stretch;
        writing-mode:vertical-rl;transform:rotate(180deg);padding:10px 0;border-radius:0;
        background:rgba(224,196,138,.13);color:#e0c48a;font-weight:900;letter-spacing:.16em;text-transform:uppercase;font-size:9px}
      #playboyStripperPanel .pb-result[data-kind="set"] .pb-resultKind{background:rgba(255,255,255,.06);color:#d7cbb6}
      #playboyStripperPanel .pb-resultHidden .pb-resultKind{background:rgba(202,87,87,.28);color:#ffd4d4}
      #playboyStripperPanel .pb-resultMain{min-width:0;display:flex;flex-direction:column;gap:5px;padding:10px 12px 12px}
      #playboyStripperPanel .pb-resultTop{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}
      #playboyStripperPanel .pb-resultTitle{color:#f2ece1;font-weight:900;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playboyStripperPanel .pb-resultMeta{color:#a99b87;font-weight:700;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playboyStripperPanel .pb-resultModels{color:#cfc2ae;font-weight:700;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playboyStripperPanel .pb-resultBadges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px}
      #playboyStripperPanel .pb-badge{display:inline-flex;align-items:center;min-height:18px;padding:0 7px;border-radius:999px;
        background:rgba(255,255,255,.08);color:#cfc2ae;font-weight:900;font-size:9px;letter-spacing:.04em;text-transform:uppercase}
      #playboyStripperPanel .pb-badgeHidden{background:rgba(202,87,87,.28);color:#ffd4d4;border:1px solid rgba(202,87,87,.5)}
      #playboyStripperPanel .pb-badgeFull{background:rgba(88,143,101,.24);color:#d7ffd8}
      #playboyStripperPanel .pb-badgePartial{background:rgba(224,196,138,.18);color:#f8edd4}
      #playboyStripperPanel .pb-resultActions{display:grid;grid-template-columns:1.15fr 1fr 1fr 1fr;gap:6px;margin-top:4px;
        padding-top:8px;border-top:1px solid rgba(224,196,138,.12)}
      #playboyStripperPanel .pb-resultActions button{min-height:26px;padding:0 6px;border-radius:7px;font-size:10px}
      #playboyStripperPanel .pb-resultActions button:first-child{grid-row:1 / span 2}
      #playboyStripperPanel .pb-resultActions button:nth-child(5){grid-column:2}
      #playboyStripperPanel .pb-resultActions button[data-action="toggle-hidden"]{background:transparent;color:#cfc2ae}
      #playboyStripperPanel .pb-resultActions button[data-action^="status-"]{background:rgba(255,255,255,.04);color:#cfc2ae;font-weight:700}
      #playboyStripperPanel .pb-importSummary{color:#bdb1a0;font-weight:700;line-height:1.35}
      #playboyStripperPanel .pb-importActions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
      #playboyStripperPanel .pb-result a{color:#e0c48a;text-decoration:none}
      #playboyStripperPanel .pb-result a:hover{text-decoration:underline}
      #playboyStripperPanel .pb-status{min-height:18px;color:#bdb1a0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media (max-width:700px){
        #playboyStripperPanel.pb-wide{width:calc(100vw - 16px);right:8px;left:auto}
        #playboyStripperPanel .pb-filterLook,
        #playboyStripperPanel .pb-filterWhen,
        #playboyStripperPanel .pb-filterCounts{grid-template-columns:repeat(2,minmax(0,1fr))}
        #playboyStripperPanel .pb-filterLook label:last-child{grid-column:1 / -1}
        #playboyStripperPanel .pb-searchActions,
        #playboyStripperPanel .pb-advHousekeepRow{grid-template-columns:1fr}
        #playboyStripperPanel .pb-filterGroup{grid-template-columns:1fr}
        #playboyStripperPanel .pb-filterGroupName{padding-top:0}
      }
    `);
  }

  // The site is a single page that rewrites itself as you browse, so there is no
  // load event to hang the panel context on. Watching the address is the one
  // signal that works for both its own navigation and ours.
  function installRouteObserver() {
    let last = location.href;
    setInterval(() => {
      if (location.href === last) return;
      last = location.href;
      if (state.busy) return;
      setProgress(0);
      syncContext();
      refreshHiddenCards();
    }, 700);
  }

  // --- browsing during a run ------------------------------------------------
  //
  // A run lives in this page's JavaScript, so an ordinary navigation ends it: the
  // document is torn down mid-gallery and the fetches in flight are dropped.
  //
  // The site's own links do not have that problem — it rewrites itself in place
  // and never replaces the document, which is exactly what we want. What is left
  // to guard is everything else: a reload, a typed address, a link off the site.
  // Those cannot be intercepted, only warned about.
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

  function targetFromLocation() {
    return targetFromUrl(location.href, ORIGIN);
  }

  function syncContext() {
    const target = targetFromLocation();
    [ui.drop, ui.advancedDrop].forEach(drop => {
      if (drop) drop.textContent = target && target.kind === 'model' ? 'Drop this model link here' : 'Drop one model link here';
    });
    setModelDisplay(target && target.kind === 'model' ? (target.name || `Model ${target.id}`) : 'None');
    setSetDisplay('0/0');
    setAlbumDisplay('None');
    setFileDisplay('0/0');
  }

  // --- moving the panel -----------------------------------------------------
  //
  // Dragged by its title bar, the way the Reddit stripper's window is. The panel
  // is parked in the top right corner, which is also where this site puts things
  // worth reading, so being able to shove it out of the way is not a luxury.
  //
  // Three rules, all of them about not losing it:
  //
  //   - It cannot be dragged off the screen. A strip of it always stays reachable
  //     at every edge, so a panel pushed too far can always be pulled back.
  //   - Resizing the window re-checks that. A panel parked against the right edge
  //     of a wide window would otherwise be somewhere off past the edge of a
  //     narrow one, with no way to reach it.
  //   - Where you put it is remembered for the tab, alongside the other panel
  //     settings and on the same terms: it dies with the tab and leaves nothing
  //     on disk.
  //
  // A drag that starts on a button is not a drag — the collapse caret lives in
  // the title bar and has to stay pressable.

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
    // The stylesheet parks it by its right edge; a dragged panel is placed by its
    // left one, and leaving both set would stretch it across the window.
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.classList.add('pb-dragged');
    return at;
  }

  function savePanelPosition(at) {
    try { sessionStorage.setItem(PANEL_POS_KEY, JSON.stringify({ x: Math.round(at.x), y: Math.round(at.y) })); } catch {}
  }

  function restorePanelPosition(panel) {
    let stored = '';
    try { stored = sessionStorage.getItem(PANEL_POS_KEY) || ''; } catch {}
    if (!stored) return;
    try {
      const at = JSON.parse(stored);
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
      panel.classList.add('pb-dragging-panel');
      // Capture, so a fast drag that outruns the pointer keeps hold of it rather
      // than dropping the panel wherever the cursor left the title bar.
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
      panel.classList.remove('pb-dragging-panel');
      try { handle.releasePointerCapture(event.pointerId); } catch {}
      if (last) savePanelPosition(last);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);

    window.addEventListener('resize', () => {
      if (!panel.classList.contains('pb-dragged')) return;
      const rect = panel.getBoundingClientRect();
      last = placePanelAt(panel, rect.left, rect.top);
      savePanelPosition(last);
    });
  }

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
      if (state.pane === 'advanced') {
        focusAdvancedDropTargets(targets).catch(err => showSearchMessage(`Could not show dropped item: ${errorMessage(err)}`));
        return;
      }
      startDroppedModel(targets).catch(err => logLine(`Could not start from that drop: ${errorMessage(err)}`));
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

  function modelTargetFromActor(actor) {
    const id = String(actor && actor.actor_id || '');
    if (!/^\d+$/.test(id)) return null;
    return {
      kind: 'model',
      id,
      slug: String(actor.url_name || ''),
      name: sanitizeNamePart(actor.name || '').slice(0, 120)
    };
  }

  function modelTargetsFromPhotosetHit(hit) {
    const out = [];
    const seen = new Set();
    (hit && hit.actors || []).forEach(actor => {
      const target = modelTargetFromActor(actor);
      if (!target || seen.has(target.id)) return;
      seen.add(target.id);
      out.push(target);
    });
    return out;
  }

  function pushUniqueTarget(out, seen, target) {
    if (!target || !/^\d+$/.test(String(target.id))) return;
    const key = targetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(target);
  }

  async function resolveTargetsToModels(targets) {
    const out = [];
    const seen = new Set();
    let albums = 0;
    let withoutModels = 0;
    let failed = 0;

    for (const target of targets || []) {
      if (!target) continue;
      if (target.kind === 'model') {
        pushUniqueTarget(out, seen, target);
        continue;
      }
      albums++;
      let models = [];
      try {
        models = await resolveAlbumToModels(target);
      } catch (err) {
        failed++;
        logLine(`Could not resolve gallery ${target.id} to a model (${errorMessage(err)}).`);
        continue;
      }
      if (!models.length) {
        withoutModels++;
        continue;
      }
      models.forEach(model => pushUniqueTarget(out, seen, model));
    }

    return { targets: out, albums, withoutModels, failed };
  }

  async function startDroppedModel(targets) {
    if (state.busy) { logLine('Wait for the current download to finish, or press Stop.'); return; }
    const incoming = (targets || []).filter(Boolean);
    if (!incoming.length) { logLine('Nothing to download.'); return; }

    state.cancel = false;
    setBusy(true);
    resetLog();
    setModelDisplay('Resolving');
    try {
      const albumCount = incoming.filter(target => target.kind !== 'model').length;
      if (albumCount) {
        logLine(`Resolving ${albumCount} galler${albumCount === 1 ? 'y' : 'ies'} to model${albumCount === 1 ? '' : 's'}.`);
      }
      const resolved = await resolveTargetsToModels(incoming);
      if (state.cancel) throw new Error('cancelled');
      if (resolved.withoutModels) {
        logLine(`${resolved.withoutModels} galler${resolved.withoutModels === 1 ? 'y has' : 'ies have'} no model listed.`);
      }
      if (!resolved.targets.length) {
        logLine(resolved.failed ? 'No models could be resolved.' : 'No model link found.');
        return;
      }
      if (resolved.targets.length > 1) {
        logLine(`That resolves to ${resolved.targets.length} models. Drop one model at a time.`);
        return;
      }
      await downloadModel(resolved.targets[0], true);
    } catch (err) {
      if (errorMessage(err) === 'cancelled') logLine('Cancelled.');
      else logLine(`Could not start from that drop: ${errorMessage(err)}`);
    } finally {
      if (state.busy) setBusy(false);
    }
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

  // --- models ---------------------------------------------------------------

  async function resolveAlbumToModels(entry) {
    const record = await photosetById(entry.id);
    if (!record) return [];
    rememberSetRecord(record);
    return modelTargetsFromPhotosetHit(record);
  }

  async function albumsForModel(model) {
    const entry = Object.assign({}, model);
    const found = new Map();
    let dropped = 0;
    if (anyTypeHidden()) {
      await ensureActorTypes();
      if (slugsAreHidden(actorTypeSlugs(entry.id))) {
        const err = new Error('a kind of model you have turned off');
        err.skip = true;
        throw err;
      }
    }
    await algoliaWalk(ALGOLIA_PHOTOSETS, {
      filters: `actors.actor_id:${Number(entry.id)}`,
      attributesToRetrieve: JSON.stringify(['set_id', 'title', 'url_title', 'actors', 'categories'])
    }, (hits, page, result) => {
      hits.forEach(hit => {
        rememberSetRecord(hit);
        // Her name still comes off a compilation she appears in even when the
        // set itself is being left out: it is a record of hers either way.
        if (!entry.name) {
          const mine = (hit.actors || []).find(actor => String(actor.actor_id) === String(entry.id));
          if (mine && mine.name) entry.name = sanitizeNamePart(mine.name);
        }
        if (skippingCompilations() && isCompilationRecord(hit)) { dropped++; return; }
        if (recordShouldHide(hit)) { dropped++; return; }
        const target = targetFromPhotosetHit(hit);
        if (!found.has(target.id)) found.set(target.id, target);
      });
      logLine(`  page ${page + 1}/${result.nbPages}: ${found.size} set${found.size === 1 ? '' : 's'} so far.`);
      return true;
    });
    if (state.cancel) throw new Error('cancelled');

    if (!entry.name) {
      // A bare model URL dragged in has only a slug to go on until the catalogue
      // is asked directly.
      const actor = await actorById(entry.id).catch(() => null);
      entry.name = (actor && sanitizeNamePart(actor.name)) || titleFromSlug(entry.slug) || `Model ${entry.id}`;
    }

    return {
      model: entry,
      albums: Array.from(found.values()).map(album => Object.assign(album, { viaModel: true })),
      dropped
    };
  }

  async function downloadModel(model, alreadyBusy) {
    if (state.busy && !alreadyBusy) { logLine('Wait for the current download to finish, or press Stop.'); return; }
    const label = model.name || titleFromSlug(model.slug) || `Model ${model.id}`;
    if (!alreadyBusy) {
      state.cancel = false;
      setBusy(true);
      resetLog();
    }
    setModelDisplay(label, `${label} (${model.id})`);
    setSetDisplay('Reading model');
    setAlbumDisplay('None');
    setFileDisplay('0/0');

    try {
      logLine(`Reading ${label}.`);
      const found = await albumsForModel(model);
      const name = found.model.name || label;
      setModelDisplay(name, `${name} (${found.model.id})`);
      if (found.dropped) logLine(`Left out ${found.dropped} set${found.dropped === 1 ? '' : 's'} the filters exclude.`);
      if (!found.albums.length) {
        logLine(found.dropped ? 'Nothing of hers the filters allow.' : 'No sets found for this model.');
        return;
      }

      let saved = 0;
      let failed = 0;
      let skipped = 0;
      logLine(`${name}: ${found.albums.length} set${found.albums.length === 1 ? '' : 's'}.`);
      setSetDisplay(`0/${found.albums.length} done`);
      for (let i = 0; i < found.albums.length; i++) {
        if (state.cancel) throw new Error('cancelled');
        const albumRef = found.albums[i];
        setSetDisplay(`${saved}/${found.albums.length} done${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}`);
        setAlbumDisplay(albumRef.name || `Gallery ${albumRef.id}`, `Gallery ${albumRef.id}`);
        setFileDisplay('Scanning');
        logLine(`--- ${i + 1}/${found.albums.length}: ${albumRef.name || `Gallery ${albumRef.id}`} ---`);
        try {
          await processAlbum(albumRef);
          saved++;
        } catch (err) {
          const message = errorMessage(err);
          if (message === 'cancelled') throw err;
          if (err && err.skip) {
            skipped++;
            logLine(`Gallery ${albumRef.id} skipped: ${message}`);
          } else {
            failed++;
            logLine(`Gallery ${albumRef.id} failed: ${message}`);
          }
        }
        logLine(`Model progress: ${saved} saved, ${failed} failed, ${skipped} skipped.`);
        setSetDisplay(`${saved}/${found.albums.length} done${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}`);
        if (i + 1 < found.albums.length) await delay(ALBUM_DELAY_MS);
      }
      logLine(`Finished ${name}: ${saved} saved, ${failed} failed, ${skipped} skipped.`);
      if (saved > 0) setDownloadState('model', found.model.id, saved === found.albums.length && !failed && !skipped && state.fileFilter === 'all' ? 'full' : 'partial');
    } catch (err) {
      setProgress(0);
      if (errorMessage(err) === 'cancelled') logLine('Cancelled.');
      else logLine(`Model failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // --- download -------------------------------------------------------------

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

    setAlbumDisplay(album.title, `${album.title} (${album.id})`);
    setFileDisplay(`0/${album.items.length}`);
    logLine(`${album.title} — ${album.items.length} file${album.items.length === 1 ? '' : 's'}, ${album.models.join(' & ') || 'no model listed'}, ${album.date || 'no date'}.`);

    album.saved = await saveAlbumFiles(album);
    setDownloadState('set', album.id, state.fileFilter === 'all' ? 'full' : 'partial');
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
    rememberSetRecord(record);
    // A gallery reached from a dropped link arrives as a bare id, so this is the
    // first point at which there is anything to judge it by. One reached from a
    // model run already went through the catalogue, but this check is cheap and
    // keeps dropped gallery links honest.
    if (anyTypeHidden()) {
      await ensureActorTypes();
      if (recordIsHiddenType(record)) {
        const err = new Error('a kind of model you have turned off');
        err.skip = true;
        throw err;
      }
    }
    if (skippingCompilations() && isCompilationRecord(record)) {
      const err = new Error('a compilation — several models and none of them named in the title (Compilations: Include takes it anyway)');
      err.skip = true;
      throw err;
    }
    setProgress(8);

    const album = {
      id: String(ref.id),
      slug: String(record.url_title || ref.slug || ''),
      title: sanitizeNamePart(record.title) || titleFromSlug(record.url_title) || `Gallery ${ref.id}`,
      date: String(record.date_online || '').slice(0, 10),
      models: modelsFromRecord(record),
      nobodys: isCompilationRecord(record),
      clipId: Number(record.clip_id) || 0,
      declared: Number(record.num_of_pictures) || 0,
      items: []
    };

    if (state.skipVariousDownloads && albumBelongsToNobody(album)) {
      const err = new Error('a Various set — Skip Various is on');
      err.skip = true;
      throw err;
    }

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
      album.items = flattenPhotoOrder(photos.map(url => ({ kind: 'image', url, index: 0 })));
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
  // <YYMMDD>-<Model> - <Title>/<same>_001.jpg — loose files, one run of numbers,
  // the video last if the gallery has one.
  //
  // The model folder comes from the gallery's own model list, and the title has
  // her name stripped off the front, because "Freya Parker in Penthouse Desire"
  // inside a folder called Freya Parker says it twice. Anything that cannot be
  // matched confidently keeps the whole title instead.

  function modelFolderFor(album) {
    if (!album.models.length) return UNTAGGED_FOLDER;
    // The same question the compilations toggle asks, so with that toggle on
    // this folder never gets written at all.
    if (albumBelongsToNobody(album)) return MULTI_MODEL_FOLDER;
    return sanitizeNamePart(album.models.join(MODEL_JOIN)) || UNTAGGED_FOLDER;
  }

  // <yymmdd>-<model> - <title>. The date and the model are one prefix joined by a
  // bare hyphen; " - " is reserved as the single boundary between that prefix and
  // the title, which is why both halves are scrubbed of it. A gallery with no
  // model, or that turns out to be nobody's, keeps the plain "<yymmdd> - <title>"
  // shape rather than growing a segment naming a dozen women who each appear in
  // one picture of it.
  function archiveBaseName(album) {
    const model = modelNamePart(album);
    const prefix = model ? `${dateKey(album.date)}-${model}` : dateKey(album.date);
    return `${prefix} - ${albumTitlePart(album)}`;
  }

  function modelNamePart(album) {
    if (!album.models.length || albumBelongsToNobody(album)) return '';
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
  // One zip per gallery, holding loose files and nothing else — the photos in
  // order, then the video, all sharing one run of numbers, the way Zishy's do.
  //
  // The flattening is the part worth explaining. Some sets on this site are split
  // into folders — erotic and explicit, most often — and not by any rule that
  // could be relied on to mean the same thing twice, so there is nothing here
  // that tries to understand the split. It only refuses to keep it: files are
  // gathered by the folder they came out of, the folders keep the order they
  // first appeared in, and the files keep their order inside each one. A split
  // set therefore comes out as one unbroken run followed by the next, which is
  // what the folders were saying anyway, without the folders.

  // The directory a file sits in, which is all "same folder" needs to mean here.
  function photoFolderKey(url) {
    try {
      const path = new URL(url, ORIGIN).pathname;
      return path.slice(0, path.lastIndexOf('/') + 1);
    } catch {
      return '';
    }
  }

  function flattenPhotoOrder(items) {
    const groups = new Map();
    items.forEach(item => {
      const key = photoFolderKey(item.url);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    if (groups.size > 1) {
      const sizes = Array.from(groups.values()).map(group => group.length).join(' + ');
      logLine(`Split across ${groups.size} folders (${sizes}); flattening them into one run.`);
    }
    const out = [];
    groups.forEach(group => out.push(...group));
    return out;
  }

  async function saveAlbumFiles(album) {
    const Zip = resolveJSZip();
    if (!Zip) throw new Error('JSZip is missing (the @require did not load)');

    const folder = modelFolderFor(album);
    const base = archiveBaseName(album);
    const images = album.items.filter(item => item.kind === 'image');
    const videos = album.items.filter(item => item.kind === 'video');
    const pad = Math.max(MIN_INDEX_PAD, String(album.items.length).length);
    const totalFiles = album.items.length;
    let completedFiles = 0;
    let failedFiles = 0;
    setFileProgress(completedFiles, totalFiles, failedFiles);

    // Photos first, several at a time. They are small enough that the only cost
    // of holding them all is the one the zip was always going to charge.
    await runPool(images, IMAGE_CONCURRENCY, async item => {
      try {
        item.data = await fetchBinaryWithRetry(item.url);
      } catch (err) {
        if (isCancelledError(err)) throw err;
        item.error = errorMessage(err);
        failedFiles++;
      }
      completedFiles++;
      setFileProgress(completedFiles, totalFiles, failedFiles);
      setProgress(16 + Math.round((completedFiles / Math.max(1, totalFiles)) * 64));
    });
    if (state.cancel) throw new Error('cancelled');

    // The video one at a time and on its own budget, because it is the whole
    // archive's weight in a single file and a lane of three would be three of it.
    for (const video of videos) {
      if (state.cancel) throw new Error('cancelled');
      if (video.bytes && video.bytes > VIDEO_SIZE_WARN_BYTES) {
        logLine(`The ${video.quality} video is ${formatBytes(video.bytes)}. It has to sit in memory to go in the zip, so a tab with little to spare may not manage it.`);
      }
      logLine(`Fetching the ${video.quality} video${video.bytes ? ` (${formatBytes(video.bytes)})` : ''}.`);
      try {
        video.data = await fetchBinaryWithRetry(video.url, VIDEO_TIMEOUT_MS);
      } catch (err) {
        if (isCancelledError(err)) throw err;
        video.error = errorMessage(err);
        failedFiles++;
      }
      completedFiles++;
      setFileProgress(completedFiles, totalFiles, failedFiles);
      setProgress(80);
    }
    if (state.cancel) throw new Error('cancelled');

    // Zipping is a separate ordered pass so the parallel fetch above cannot
    // disturb gallery order. Every entry is a loose file inside the one folder
    // the archive is named for; nothing nests below that.
    const zip = new Zip();
    let added = 0;
    let failed = 0;
    album.items.forEach(item => {
      const leaf = `${base}_${String(item.index).padStart(pad, '0')}.${inferExt(item.url, item.kind === 'video' ? 'mp4' : 'jpg')}`;
      if (!item.data) {
        failed++;
        logLine(`Skipped ${leaf}: ${item.error || 'no data'}`);
        return;
      }
      zip.file(`${base}/${leaf}`, item.data);
      added++;
    });
    if (!added) throw new Error(`all ${album.items.length} downloads failed`);
    if (failed) logLine(`Archive is partial: ${failed} file${failed === 1 ? '' : 's'} failed.`);

    logLine(`Zipping ${added} file${added === 1 ? '' : 's'}.`);
    setFileDisplay(`Zipping ${added}/${totalFiles}${failed ? `, ${failed} failed` : ''}`);
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      meta => {
        if (state.cancel) throw cancelledError();
        setProgress(82 + Math.round(((meta && meta.percent) || 0) * 0.14));
      }
    );
    if (state.cancel) throw cancelledError();
    // Dropped as early as possible: until this runs the tab is holding both the
    // files and the archive made out of them.
    album.items.forEach(item => { item.data = null; });
    logLine(`Archive is ${formatBytes(blob.size)}.`);

    const archiveName = sanitizeDownloadPathForSave(`${ROOT_FOLDER}/${folder}/${base}.zip`);
    if (state.cancel) throw cancelledError();
    setFileDisplay(`Saving ${added}/${totalFiles}${failed ? `, ${failed} failed` : ''}`);
    await saveBlob(blob, archiveName);
    setFileDisplay(`${added}/${totalFiles}${failed ? `, ${failed} failed` : ''}`);
    logLine(`Saved ${archiveName}.`);
    return added;
  }

  async function runPool(items, limit, worker) {
    const pendingItems = items.slice();
    const lanes = new Array(Math.max(1, Math.min(limit, pendingItems.length))).fill(0).map(async () => {
      while (pendingItems.length) {
        if (state.cancel) return;
        await worker(pendingItems.shift());
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
        if (isCancelledError(err) || state.cancel) throw cancelledError();
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
        if (isCancelledError(err) || state.cancel) throw cancelledError();
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
        if (isCancelledError(err) || state.cancel) throw cancelledError();
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
    // Off-site media goes straight to the extension request function. A plain
    // fetch will usually be blocked by the browser before it can read the file.
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
        if (isCancelledError(err) || state.cancel) throw cancelledError();
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
          if (isCancelledError(err) || state.cancel) throw cancelledError();
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

  // --- site index -----------------------------------------------------------

  function setPane(pane) {
    state.pane = pane === 'advanced' || pane === 'indexing' ? pane : 'simple';
    if (ui.panel) ui.panel.classList.toggle('pb-wide', state.pane === 'advanced' || state.pane === 'indexing');
    if (ui.simplePane) ui.simplePane.hidden = state.pane !== 'simple';
    if (ui.advancedPane) ui.advancedPane.hidden = state.pane !== 'advanced';
    if (ui.indexingPane) ui.indexingPane.hidden = state.pane !== 'indexing';
    if (ui.simpleTab) ui.simpleTab.classList.toggle('pb-tabOn', state.pane === 'simple');
    if (ui.advancedTab) ui.advancedTab.classList.toggle('pb-tabOn', state.pane === 'advanced');
    if (ui.indexingTab) ui.indexingTab.classList.toggle('pb-tabOn', state.pane === 'indexing');
  }

  async function startIndexing() {
    if (state.busy) { logLine('Wait for the current run to finish, or press Stop.'); return; }
    state.cancel = false;
    setBusy(true);
    resetLog();
    setPane('indexing');
    setModelDisplay('Site index');
    setSetDisplay('0 sets');
    setAlbumDisplay('Photosets');
    setFileDisplay('0 scenes');

    try {
      const log = await buildSiteIndexLog();
      if (state.cancel) throw cancelledError();
      await saveIndexLog(log);
      await updateIndexLogCount();
      scheduleAdvancedSearch();

      const text = JSON.stringify(log, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const fileName = `${timestampForFileName(new Date())} - PB+ index.json`;
      await saveBlob(blob, fileName);
      logLine(`Index saved: ${log.summary.setCount} sets, ${log.summary.modelCount} models.`);
    } catch (err) {
      if (errorMessage(err) === 'cancelled') logLine('Cancelled.');
      else logLine(`Index failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function buildSiteIndexLog() {
    const generatedAt = new Date().toISOString();
    const photosets = [];
    const scenes = new Map();
    const actors = new Map();

    logLine('Indexing photosets.');
    await algoliaWalk(ALGOLIA_PHOTOSETS, {
      attributesToHighlight: JSON.stringify([])
    }, (hits, page, result) => {
      hits.forEach(hit => photosets.push(hit));
      setSetDisplay(`${photosets.length} sets`);
      setAlbumDisplay(`Photosets ${page + 1}/${result.nbPages || '?'}`);
      setProgress(Math.min(45, Math.round(((page + 1) / Math.max(1, result.nbPages || 1)) * 45)));
      return true;
    });

    if (state.cancel) throw cancelledError();
    logLine('Indexing scenes.');
    await algoliaWalk(ALGOLIA_SCENES, {
      attributesToHighlight: JSON.stringify([])
    }, (hits, page, result) => {
      hits.forEach(hit => {
        const id = String(hit && hit.clip_id || '');
        if (id) scenes.set(id, normalizeSceneRecord(hit));
      });
      setFileDisplay(`${scenes.size} scenes`);
      setAlbumDisplay(`Scenes ${page + 1}/${result.nbPages || '?'}`);
      setProgress(45 + Math.min(25, Math.round(((page + 1) / Math.max(1, result.nbPages || 1)) * 25)));
      return true;
    });

    if (state.cancel) throw cancelledError();
    logLine('Indexing models.');
    await algoliaWalk(ALGOLIA_ACTORS, {
      attributesToHighlight: JSON.stringify([])
    }, (hits, page, result) => {
      hits.forEach(hit => {
        const actor = normalizeActorRecord(hit, true);
        if (actor.id) actors.set(actor.id, actor);
      });
      setModelDisplay(`${actors.size} models`);
      setAlbumDisplay(`Models ${page + 1}/${result.nbPages || '?'}`);
      setProgress(70 + Math.min(20, Math.round(((page + 1) / Math.max(1, result.nbPages || 1)) * 20)));
      return true;
    });

    const sets = photosets.map(record => normalizeIndexSet(record, scenes.get(String(record && record.clip_id || ''))));
    const models = buildIndexModelStats(sets, actors);
    const summary = buildIndexSummary(sets, models);
    setProgress(95);

    return {
      type: 'PlayboyPlusIndexLog',
      version: 1,
      id: `pbplus-index-${generatedAt}`,
      generatedAt,
      source: {
        host: location.hostname,
        origin: ORIGIN,
        photosetIndex: ALGOLIA_PHOTOSETS,
        sceneIndex: ALGOLIA_SCENES,
        actorIndex: ALGOLIA_ACTORS
      },
      summary,
      sets,
      models,
      scenes: Array.from(scenes.values())
    };
  }

  function normalizeIndexSet(record, scene) {
    const id = String(record && record.set_id || '');
    const slug = String(record && record.url_title || '');
    const clipId = Number(record && record.clip_id) || 0;
    const numImages = firstNumber(record, ['num_of_pictures', 'num_photos', 'photo_count']) || 0;
    const views = firstNumber(record, ['views', 'view_count', 'views_count', 'total_views']);
    const likes = firstNumber(record, ['likes', 'like_count', 'likes_count', 'total_likes']);
    const sceneViews = firstNumber(scene, ['views', 'view_count', 'views_count', 'total_views']);
    const sceneLikes = firstNumber(scene, ['likes', 'like_count', 'likes_count', 'total_likes']);
    const dateProduced = firstText(record, ['date_produced', 'date_online', 'date_published', 'date_released']).slice(0, 10);
    const models = (record && record.actors || []).map(actor => normalizeActorRecord(actor)).filter(actor => actor.id || actor.name);
    return {
      id,
      title: String(record && record.title || ''),
      slug,
      url: slug && id ? `${ORIGIN}/en/update/${encodeURIComponent(slug)}/${encodeURIComponent(id)}` : '',
      dateProduced,
      numImages,
      numVideos: clipId || scene ? 1 : 0,
      clipId: clipId || null,
      views: views === null ? sceneViews : views,
      likes: likes === null ? sceneLikes : likes,
      categories: normalizeCategories(record && record.categories),
      models,
      modelCount: models.length,
      nobodySet: isCompilationRecord(record),
      catalogue: stripSearchMetadata(record),
      scene: scene ? {
        clipId: scene.clipId,
        title: scene.title,
        duration: scene.duration,
        downloadSizes: scene.downloadSizes,
        downloadFileSizes: scene.downloadFileSizes
      } : null
    };
  }

  function normalizeSceneRecord(record) {
    const clipId = String(record && record.clip_id || '');
    return {
      clipId,
      title: String(record && record.title || ''),
      slug: String(record && record.url_title || ''),
      dateProduced: firstText(record, ['date_produced', 'date_online', 'date_published', 'date_released']).slice(0, 10),
      duration: firstNumber(record, ['duration', 'runtime', 'length']),
      views: firstNumber(record, ['views', 'view_count', 'views_count', 'total_views']),
      likes: firstNumber(record, ['likes', 'like_count', 'likes_count', 'total_likes']),
      categories: normalizeCategories(record && record.categories),
      models: (record && record.actors || []).map(actor => normalizeActorRecord(actor)).filter(actor => actor.id || actor.name),
      downloadSizes: (record && record.download_sizes || []).map(String),
      downloadFileSizes: Object.assign({}, record && record.download_file_sizes || {}),
      catalogue: stripSearchMetadata(record)
    };
  }

  function normalizeActorRecord(record, includeRaw) {
    const actor = {
      id: String(record && (record.actor_id || record.id) || ''),
      name: String(record && record.name || ''),
      slug: String(record && record.url_name || record && record.url_title || ''),
      categories: normalizeCategories(record && record.categories),
      catalogueViews: firstNumber(record, ['views', 'view_count', 'views_count', 'total_views']),
      catalogueLikes: firstNumber(record, ['likes', 'like_count', 'likes_count', 'total_likes']),
      popularity: firstNumber(record, ['popularity'])
    };
    if (includeRaw) actor.catalogue = stripSearchMetadata(record);
    return actor;
  }

  function stripSearchMetadata(record) {
    const out = Object.assign({}, record || {});
    delete out._highlightResult;
    delete out._snippetResult;
    delete out._rankingInfo;
    return out;
  }

  function buildIndexModelStats(sets, actors) {
    const stats = new Map();
    actors.forEach(actor => {
      stats.set(actor.id, Object.assign({}, actor, blankModelStats()));
    });

    sets.forEach(set => {
      set.models.forEach(model => {
        const key = model.id || `name:${model.name.toLowerCase()}`;
        if (!stats.has(key)) stats.set(key, Object.assign({}, model, blankModelStats()));
        const entry = stats.get(key);
        if (!entry.name && model.name) entry.name = model.name;
        if (!entry.slug && model.slug) entry.slug = model.slug;
        if (!entry.categories.length && model.categories.length) entry.categories = model.categories;
        entry.setCount++;
        entry.imageCount += set.numImages || 0;
        entry.videoCount += set.numVideos || 0;
        entry.views += Number(set.views) || 0;
        entry.likes += Number(set.likes) || 0;
        entry.setIds.push(set.id);
        if (set.dateProduced) {
          if (!entry.firstDate || set.dateProduced < entry.firstDate) entry.firstDate = set.dateProduced;
          if (!entry.latestDate || set.dateProduced > entry.latestDate) entry.latestDate = set.dateProduced;
        }
      });
    });

    return Array.from(stats.values()).sort((a, b) => {
      if (b.setCount !== a.setCount) return b.setCount - a.setCount;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function blankModelStats() {
    return {
      setCount: 0,
      imageCount: 0,
      videoCount: 0,
      views: 0,
      likes: 0,
      firstDate: '',
      latestDate: '',
      setIds: []
    };
  }

  function buildIndexSummary(sets, models) {
    return {
      setCount: sets.length,
      modelCount: models.length,
      imageCount: sets.reduce((sum, set) => sum + (Number(set.numImages) || 0), 0),
      videoCount: sets.reduce((sum, set) => sum + (Number(set.numVideos) || 0), 0),
      viewCount: sets.reduce((sum, set) => sum + (Number(set.views) || 0), 0),
      likeCount: sets.reduce((sum, set) => sum + (Number(set.likes) || 0), 0),
      firstDate: sets.reduce((min, set) => set.dateProduced && (!min || set.dateProduced < min) ? set.dateProduced : min, ''),
      latestDate: sets.reduce((max, set) => set.dateProduced && (!max || set.dateProduced > max) ? set.dateProduced : max, '')
    };
  }

  function normalizeCategories(categories) {
    return (categories || []).map(category => ({
      id: String(category && (category.category_id || category.id) || ''),
      name: String(category && category.name || ''),
      slug: String(category && (category.url_name || category.slug) || '')
    })).filter(category => category.id || category.name || category.slug);
  }

  function firstNumber(record, fields) {
    for (const field of fields || []) {
      if (!record || record[field] === undefined || record[field] === null || record[field] === '') continue;
      const value = Number(record[field]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function firstText(record, fields) {
    for (const field of fields || []) {
      if (!record || record[field] === undefined || record[field] === null || record[field] === '') continue;
      return String(record[field]);
    }
    return '';
  }

  function timestampForFileName(date) {
    const two = value => String(value).padStart(2, '0');
    return `${two(date.getFullYear() % 100)}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  }

  function openIndexDb() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available in this browser'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(INDEX_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(INDEX_DB_STORE)) {
          const store = db.createObjectStore(INDEX_DB_STORE, { keyPath: 'id' });
          store.createIndex('generatedAt', 'generatedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('could not open browser index storage'));
    });
  }

  async function saveIndexLog(log) {
    if (!log || typeof log !== 'object') throw new Error('index log is empty');
    if (!log.id) log.id = `pbplus-index-${log.generatedAt || new Date().toISOString()}`;
    const db = await openIndexDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEX_DB_STORE, 'readwrite');
      tx.objectStore(INDEX_DB_STORE).put(log);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('could not save index log')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('index log save was aborted')); };
    });
  }

  async function countIndexLogs() {
    const db = await openIndexDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEX_DB_STORE, 'readonly');
      const request = tx.objectStore(INDEX_DB_STORE).count();
      request.onsuccess = () => resolve(Number(request.result) || 0);
      request.onerror = () => reject(request.error || new Error('could not count index logs'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
      tx.onabort = () => db.close();
    });
  }

  async function updateIndexLogCount() {
    if (!ui.indexLogCount) return;
    try {
      const count = await countIndexLogs();
      ui.indexLogCount.textContent = String(count);
    } catch {
      ui.indexLogCount.textContent = 'Unavailable';
    }
  }

  async function purgeIndexLogs() {
    if (state.busy) { logLine('Wait for the current run to finish, or press Stop.'); return; }
    const db = await openIndexDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(INDEX_DB_STORE, 'readwrite');
      tx.objectStore(INDEX_DB_STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('could not purge index logs')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('index log purge was aborted')); };
    });
    await updateIndexLogCount();
    clearSearchResults();
    logLine('Browser index logs purged.');
  }

  async function importIndexLogFiles(files) {
    if (state.busy) { logLine('Wait for the current run to finish, or press Stop.'); return; }
    const list = Array.from(files || []);
    if (!list.length) return;
    let imported = 0;
    for (const file of list) {
      const parsed = JSON.parse(await readFileAsText(file));
      const logs = Array.isArray(parsed) ? parsed : [parsed];
      for (const log of logs) {
        const normalized = normalizeImportedIndexLog(log, file.name);
        await saveIndexLog(normalized);
        imported++;
      }
    }
    if (ui.indexFile) ui.indexFile.value = '';
    await updateIndexLogCount();
    scheduleAdvancedSearch();
    logLine(`Imported ${imported} index log${imported === 1 ? '' : 's'}.`);
  }

  function getAllIndexLogs() {
    return openIndexDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(INDEX_DB_STORE, 'readonly');
      const request = tx.objectStore(INDEX_DB_STORE).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error || new Error('could not read index logs'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
      tx.onabort = () => db.close();
    }));
  }

  function scheduleAdvancedSearch() {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      runAdvancedSearch().catch(err => showSearchMessage(`Search failed: ${errorMessage(err)}`));
    }, 260);
  }

  async function runAdvancedSearch() {
    if (!ui.searchResults) return;
    const filters = readSearchFilters();
    if (filters.dateError) {
      showSearchMessage(filters.dateError);
      clearSearchResults(false);
      return;
    }
    if (!searchHasInput(filters)) {
      showSearchMessage('Enter a name or set a filter.');
      clearSearchResults(false);
      return;
    }
    showSearchMessage('Searching browser logs.');
    const logs = await getAllIndexLogs();
    if (!logs.length) {
      showSearchMessage('No browser logs yet. Index the site or import a log first.');
      clearSearchResults(false);
      return;
    }
    const merged = mergeIndexLogs(logs);
    const results = searchMergedIndex(merged, filters);
    renderSearchResults(results, merged, filters);
  }

  function clearAdvancedSearch() {
    [ui.searchQuery, ui.searchDateFrom, ui.searchDateTo, ui.searchImagesMin, ui.searchImagesMax,
      ui.searchVideosMin, ui.searchVideosMax, ui.searchViewsMin, ui.searchLikesMin]
      .forEach(input => { if (input) input.value = ''; });
    if (ui.searchKind) ui.searchKind.value = 'all';
    if (ui.searchType) ui.searchType.value = '';
    if (ui.searchFiles) ui.searchFiles.value = 'all';
    showSearchMessage('Index or import logs, then search.');
    clearSearchResults(false);
  }

  async function focusAdvancedDropTargets(targets) {
    const incoming = (targets || []).filter(Boolean);
    if (!incoming.length || !ui.searchResults) return;
    clearTimeout(state.searchTimer);
    clearAdvancedSearch();

    let merged = { sets: [], models: [], logCount: 0 };
    try {
      const logs = await getAllIndexLogs();
      if (logs.length) merged = mergeIndexLogs(logs);
    } catch {}

    const modelsById = new Map(merged.models.map(model => [String(model && model.id || ''), model]));
    const setsById = new Map(merged.sets.map(set => [String(set && set.id || ''), set]));
    const results = [];
    const seen = new Set();

    incoming.forEach(target => {
      const kind = target.kind === 'model' ? 'model' : 'set';
      const key = `${kind}:${target.id}`;
      if (seen.has(key)) return;
      seen.add(key);

      let item;
      if (kind === 'model') {
        item = modelsById.has(String(target.id))
          ? normalizeSearchModel(modelsById.get(String(target.id)))
          : fallbackSearchModel(target);
      } else {
        item = setsById.has(String(target.id))
          ? normalizeSearchSet(setsById.get(String(target.id)), modelsById)
          : fallbackSearchSet(target);
      }
      item.directHidden = kind === 'model' ? state.hiddenModels.has(item.id) : state.hiddenSets.has(item.id);
      item.hidden = itemIsHidden(kind, item);
      item.status = downloadStatus(kind, item.id);
      results.push({ kind, score: 999, item });
      if (kind === 'model') {
        modelSetsForFocusedDrop(target.id, merged.sets, modelsById, seen).forEach(result => results.push(result));
      }
    });

    renderFocusedSearchResults(results, merged.logCount);
  }

  function modelSetsForFocusedDrop(modelId, sets, modelsById, seen) {
    const id = String(modelId || '');
    if (!id) return [];
    return (sets || [])
      .filter(set => (set && set.models || []).some(model => String(model && model.id || '') === id))
      .map(set => {
        const key = `set:${set && set.id || ''}`;
        if (!set || !set.id || seen.has(key)) return null;
        seen.add(key);
        const item = normalizeSearchSet(set, modelsById);
        item.directHidden = state.hiddenSets.has(item.id);
        item.hidden = itemIsHidden('set', item);
        item.status = downloadStatus('set', item.id);
        return { kind: 'set', score: 500, item };
      })
      .filter(Boolean)
      .sort((a, b) => String(b.item.date || '').localeCompare(String(a.item.date || '')));
  }

  function fallbackSearchModel(target) {
    const name = target.name || titleFromSlug(target.slug) || `Model ${target.id}`;
    return {
      id: String(target.id || ''),
      title: name,
      url: target.slug && target.id ? `${ORIGIN}/en/model/view/${encodeURIComponent(target.slug)}/${encodeURIComponent(target.id)}` : '',
      date: '',
      dateStart: '',
      dateEnd: '',
      imageCount: 0,
      videoCount: 0,
      setCount: 0,
      views: 0,
      likes: 0,
      categories: [],
      modelNames: [name],
      modelIds: [String(target.id || '')].filter(Boolean),
      slug: String(target.slug || ''),
      text: `${name} ${target.slug || ''}`
    };
  }

  function fallbackSearchSet(target) {
    const title = target.name || titleFromSlug(target.slug) || `Set ${target.id}`;
    return {
      id: String(target.id || ''),
      title,
      url: target.slug && target.id ? `${ORIGIN}/en/update/${encodeURIComponent(target.slug)}/${encodeURIComponent(target.id)}` : '',
      date: '',
      imageCount: 0,
      videoCount: 0,
      setCount: 1,
      views: 0,
      likes: 0,
      categories: [],
      modelNames: [],
      modelIds: [],
      slug: String(target.slug || ''),
      nobodySet: false,
      text: `${title} ${target.slug || ''}`
    };
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

  function readSearchFilters() {
    const dateRange = readSearchDateRange();
    return {
      query: String(ui.searchQuery && ui.searchQuery.value || '').trim(),
      kind: String(ui.searchKind && ui.searchKind.value || 'all'),
      type: String(ui.searchType && ui.searchType.value || ''),
      files: String(ui.searchFiles && ui.searchFiles.value || 'all'),
      dateFromRaw: String(ui.searchDateFrom && ui.searchDateFrom.value || '').trim(),
      dateToRaw: String(ui.searchDateTo && ui.searchDateTo.value || '').trim(),
      dateStart: dateRange.start,
      dateEnd: dateRange.end,
      dateError: dateRange.error,
      imagesMin: nullableNumber(ui.searchImagesMin && ui.searchImagesMin.value),
      imagesMax: nullableNumber(ui.searchImagesMax && ui.searchImagesMax.value),
      videosMin: nullableNumber(ui.searchVideosMin && ui.searchVideosMin.value),
      videosMax: nullableNumber(ui.searchVideosMax && ui.searchVideosMax.value),
      viewsMin: nullableNumber(ui.searchViewsMin && ui.searchViewsMin.value),
      likesMin: nullableNumber(ui.searchLikesMin && ui.searchLikesMin.value)
    };
  }

  function searchHasInput(filters) {
    return !!(filters.query || filters.kind !== 'all' || filters.type || filters.files !== 'all'
      || filters.dateFromRaw || filters.dateToRaw || filters.imagesMin !== null || filters.imagesMax !== null
      || filters.videosMin !== null || filters.videosMax !== null || filters.viewsMin !== null || filters.likesMin !== null);
  }

  function readSearchDateRange() {
    const fromRaw = String(ui.searchDateFrom && ui.searchDateFrom.value || '').trim();
    const toRaw = String(ui.searchDateTo && ui.searchDateTo.value || '').trim();
    const from = fromRaw ? parseLooseSearchDate(fromRaw) : null;
    const to = toRaw ? parseLooseSearchDate(toRaw) : null;
    if (fromRaw && !from) return { start: '', end: '', error: `Date not understood: ${fromRaw}` };
    if (toRaw && !to) return { start: '', end: '', error: `Date not understood: ${toRaw}` };
    if (from && to) {
      if (from.start > to.end) return { start: '', end: '', error: 'From date is after To date.' };
      return { start: from.start, end: to.end, error: '' };
    }
    if (from) return { start: from.start, end: from.end, error: '' };
    if (to) return { start: '', end: to.end, error: '' };
    return { start: '', end: '', error: '' };
  }

  function parseLooseSearchDate(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;

    let match = value.match(/^(\d{4})$/);
    if (match) return dateRangeParts(Number(match[1]), 1, 1, 'year');

    match = value.match(/^(\d{4})[-/.](\d{1,2})$/);
    if (match) return dateRangeParts(Number(match[1]), Number(match[2]), 1, 'month');

    match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (match) return dateRangeParts(Number(match[1]), Number(match[2]), Number(match[3]), 'day');

    match = value.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (match) return dateRangeParts(Number(match[2]), monthNameNumber(match[1]), 1, 'month');

    match = value.match(/^(\d{4})\s+([A-Za-z]+)$/);
    if (match) return dateRangeParts(Number(match[1]), monthNameNumber(match[2]), 1, 'month');

    match = value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (match) return dateRangeParts(Number(match[3]), monthNameNumber(match[1]), Number(match[2]), 'day');

    return null;
  }

  function dateRangeParts(year, month, day, precision) {
    if (!validDateParts(year, month, day)) return null;
    const start = formatDateParts(year, month, day);
    if (precision === 'day') return { start, end: start };
    if (precision === 'month') return { start, end: formatDateParts(year, month, daysInMonth(year, month)) };
    return { start, end: formatDateParts(year, 12, 31) };
  }

  function validDateParts(year, month, day) {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return false;
    if (!Number.isInteger(month) || month < 1 || month > 12) return false;
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return false;
    return true;
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function formatDateParts(year, month, day) {
    const two = value => String(value).padStart(2, '0');
    return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`;
  }

  function monthNameNumber(raw) {
    const key = String(raw || '').toLowerCase().slice(0, 3);
    return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(key) + 1;
  }

  function nullableNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function mergeIndexLogs(logs) {
    const sets = new Map();
    const models = new Map();
    const seenLogs = (logs || []).slice().sort((a, b) => String(a.generatedAt || '').localeCompare(String(b.generatedAt || '')));
    seenLogs.forEach(log => {
      (log.sets || []).forEach(set => {
        const id = String(set && set.id || '');
        if (id) sets.set(id, set);
      });
      (log.models || []).forEach(model => {
        const id = String(model && model.id || '');
        if (id) models.set(id, model);
      });
    });

    sets.forEach(set => {
      (set.models || []).forEach(model => {
        const id = String(model && model.id || '');
        if (!id || models.has(id)) return;
        models.set(id, Object.assign({}, model, blankModelStats()));
      });
    });

    return {
      sets: Array.from(sets.values()),
      models: Array.from(models.values()),
      logCount: logs.length
    };
  }

  function searchMergedIndex(merged, filters) {
    const queryWords = bareWords(filters.query).split(' ').filter(Boolean);
    const results = [];
    const modelsById = new Map(merged.models.map(model => [String(model && model.id || ''), model]));

    if (filters.kind !== 'set') {
      merged.models.forEach(model => {
        const item = normalizeSearchModel(model);
        item.directHidden = state.hiddenModels.has(item.id);
        item.hidden = itemIsHidden('model', item);
        item.status = downloadStatus('model', item.id);
        if (!searchItemMatches(item, queryWords, filters)) return;
        results.push({ kind: 'model', score: searchScore(item, queryWords), item });
      });
    }

    if (filters.kind !== 'model') {
      merged.sets.forEach(set => {
        const item = normalizeSearchSet(set, modelsById);
        item.directHidden = state.hiddenSets.has(item.id);
        item.hidden = itemIsHidden('set', item);
        item.status = downloadStatus('set', item.id);
        if (!searchItemMatches(item, queryWords, filters)) return;
        results.push({ kind: 'set', score: searchScore(item, queryWords), item });
      });
    }

    return results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dateCompare = String(b.item.date || '').localeCompare(String(a.item.date || ''));
      if (dateCompare) return dateCompare;
      return String(a.item.title || '').localeCompare(String(b.item.title || ''));
    });
  }

  function normalizeSearchModel(model) {
    const name = String(model && model.name || model && model.slug || `Model ${model && model.id || ''}`).trim();
    return {
      id: String(model && model.id || ''),
      title: name,
      url: model && model.slug && model.id ? `${ORIGIN}/en/model/view/${encodeURIComponent(model.slug)}/${encodeURIComponent(model.id)}` : '',
      date: '',
      dateStart: String(model && model.firstDate || ''),
      dateEnd: String(model && model.latestDate || ''),
      imageCount: Number(model && model.imageCount) || 0,
      videoCount: Number(model && model.videoCount) || 0,
      setCount: Number(model && model.setCount) || 0,
      views: Number(model && model.views) || Number(model && model.catalogueViews) || 0,
      likes: Number(model && model.likes) || Number(model && model.catalogueLikes) || 0,
      categories: model && model.categories || [],
      modelNames: [name],
      modelIds: [String(model && model.id || '')].filter(Boolean),
      slug: String(model && model.slug || ''),
      text: `${name} ${(model && model.slug) || ''} ${categorySearchText(model && model.categories)}`
    };
  }

  function normalizeSearchSet(set, modelsById) {
    const models = (set && set.models || []).map(model => String(model && model.name || '')).filter(Boolean);
    const modelIds = (set && set.models || []).map(model => String(model && model.id || '')).filter(Boolean);
    return {
      id: String(set && set.id || ''),
      title: String(set && set.title || set && set.slug || `Set ${set && set.id || ''}`),
      url: String(set && set.url || ''),
      date: String(set && set.dateProduced || ''),
      imageCount: Number(set && set.numImages) || 0,
      videoCount: Number(set && set.numVideos) || 0,
      setCount: 1,
      views: Number(set && set.views) || 0,
      likes: Number(set && set.likes) || 0,
      categories: searchSetCategories(set, modelsById),
      modelNames: models,
      modelIds,
      slug: String(set && set.slug || ''),
      nobodySet: set && typeof set.nobodySet === 'boolean'
        ? !!set.nobodySet
        : setBelongsToNobody(set && set.title, models),
      text: `${set && set.title || ''} ${set && set.slug || ''} ${models.join(' ')} ${categorySearchText(searchSetCategories(set, modelsById))}`
    };
  }

  function searchSetCategories(set, modelsById) {
    const out = [];
    (set && set.categories || []).forEach(category => out.push(category));
    (set && set.models || []).forEach(model => {
      (model && model.categories || []).forEach(category => out.push(category));
      const full = modelsById && modelsById.get(String(model && model.id || ''));
      (full && full.categories || []).forEach(category => out.push(category));
    });
    return out;
  }

  function categorySearchText(categories) {
    return (categories || []).map(category => `${category && category.slug || ''} ${category && category.name || ''}`).join(' ');
  }

  function searchItemMatches(item, queryWords, filters) {
    if (queryWords.length && !queryWords.every(word => bareWords(item.text).includes(word))) return false;
    if (filters.type && !itemHasType(item, filters.type)) return false;
    if (filters.files === 'images' && item.imageCount <= 0) return false;
    if (filters.files === 'videos' && item.videoCount <= 0) return false;
    if (filters.files === 'both' && (item.imageCount <= 0 || item.videoCount <= 0)) return false;
    if (filters.files === 'no-images' && item.imageCount > 0) return false;
    if (filters.files === 'no-videos' && item.videoCount > 0) return false;
    if (filters.files === 'images-only' && (item.imageCount <= 0 || item.videoCount > 0)) return false;
    if (filters.files === 'videos-only' && (item.videoCount <= 0 || item.imageCount > 0)) return false;
    if ((filters.dateStart || filters.dateEnd) && !itemDateOverlapsRange(item, filters.dateStart, filters.dateEnd)) return false;
    if (filters.imagesMin !== null && item.imageCount < filters.imagesMin) return false;
    if (filters.imagesMax !== null && item.imageCount > filters.imagesMax) return false;
    if (filters.videosMin !== null && item.videoCount < filters.videosMin) return false;
    if (filters.videosMax !== null && item.videoCount > filters.videosMax) return false;
    if (filters.viewsMin !== null && item.views < filters.viewsMin) return false;
    if (filters.likesMin !== null && item.likes < filters.likesMin) return false;
    return true;
  }

  function itemHasType(item, slug) {
    return (item.categories || []).some(category => {
      const categorySlug = String(category && category.slug || '');
      const categoryName = String(category && category.name || '');
      return categorySlug === slug || bareWords(categoryName) === bareWords(slug);
    });
  }

  function itemDateOverlapsRange(item, start, end) {
    const itemStart = String(item.dateStart || item.date || '');
    const itemEnd = String(item.dateEnd || item.date || itemStart);
    if (!itemStart && !itemEnd) return false;
    if (start && itemEnd && itemEnd < start) return false;
    if (end && itemStart && itemStart > end) return false;
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

  function renderSearchResults(results, merged, filters) {
    const maxRendered = 500;
    const showing = results.slice(0, maxRendered);
    const models = results.filter(result => result.kind === 'model').length;
    const sets = results.length - models;
    const clipped = results.length > showing.length;
    showSearchMessage(`${results.length} result${results.length === 1 ? '' : 's'} from ${merged.logCount} log${merged.logCount === 1 ? '' : 's'}: ${models} models, ${sets} sets${clipped ? `; showing first ${showing.length}` : ''}.`);

    if (!ui.searchResults) return;
    ui.searchResults.textContent = '';
    if (!results.length) return;
    const fragment = document.createDocumentFragment();
    showing.forEach(result => fragment.appendChild(searchResultNode(result, filters)));
    ui.searchResults.appendChild(fragment);
  }

  function renderFocusedSearchResults(results, logCount) {
    if (!ui.searchResults) return;
    ui.searchResults.textContent = '';
    const fragment = document.createDocumentFragment();
    results.forEach(result => fragment.appendChild(searchResultNode(result)));
    ui.searchResults.appendChild(fragment);
    showSearchMessage(`${results.length} dropped item${results.length === 1 ? '' : 's'}${logCount ? ` matched against ${logCount} browser log${logCount === 1 ? '' : 's'}` : '; no browser log match available'}.`);
  }

  function searchResultNode(result) {
    const item = result.item;
    const row = document.createElement('div');
    row.className = 'pb-result';
    row.classList.toggle('pb-resultHidden', !!item.hidden);
    row.dataset.kind = result.kind;
    row.dataset.id = item.id;
    row.dataset.title = item.title || '';
    row.dataset.slug = item.slug || '';
    row.dataset.directHidden = item.directHidden ? '1' : '';
    const kind = document.createElement('div');
    kind.className = 'pb-resultKind';
    kind.textContent = result.kind;

    const main = document.createElement('div');
    main.className = 'pb-resultMain';
    const top = document.createElement('div');
    top.className = 'pb-resultTop';
    const title = document.createElement(item.url ? 'a' : 'div');
    title.className = 'pb-resultTitle';
    title.textContent = item.title || `${result.kind} ${item.id}`;
    title.title = title.textContent;
    if (item.url) {
      title.href = item.url;
      title.target = '_blank';
      title.rel = 'noopener';
    }
    const badges = document.createElement('div');
    badges.className = 'pb-resultBadges';
    if (item.hidden) badges.appendChild(resultBadge('Hidden', 'pb-badgeHidden'));
    badges.appendChild(resultBadge(statusLabel(item.status), item.status === 'full' ? 'pb-badgeFull' : item.status === 'partial' ? 'pb-badgePartial' : ''));

    const counts = [
      item.date || (item.dateStart && item.dateEnd ? `${item.dateStart} to ${item.dateEnd}` : ''),
      `${item.setCount} set${item.setCount === 1 ? '' : 's'}`,
      `${item.imageCount} image${item.imageCount === 1 ? '' : 's'}`,
      `${item.videoCount} video${item.videoCount === 1 ? '' : 's'}`,
      item.views ? `${formatCount(item.views)} views` : '',
      item.likes ? `${formatCount(item.likes)} likes` : ''
    ].filter(Boolean);
    const meta = document.createElement('div');
    meta.className = 'pb-resultMeta';
    meta.textContent = counts.join(' | ');
    meta.title = meta.textContent;

    const modelLine = document.createElement('div');
    modelLine.className = 'pb-resultModels';
    const typeText = categorySearchText(item.categories).replace(/\s+/g, ' ').trim();
    modelLine.textContent = result.kind === 'set'
      ? (item.modelNames.join(', ') || 'No models listed')
      : (typeText || 'No type listed');
    modelLine.title = modelLine.textContent;

    const actions = document.createElement('div');
    actions.className = 'pb-resultActions';
    actions.appendChild(resultActionButton(item.directHidden ? 'Unhide' : 'Hide', 'toggle-hidden'));
    actions.appendChild(resultActionButton('All', 'download-all'));
    actions.appendChild(resultActionButton('Images', 'download-images'));
    actions.appendChild(resultActionButton('Videos', 'download-videos'));
    actions.appendChild(resultActionButton('Full', 'status-full'));
    actions.appendChild(resultActionButton('Partial', 'status-partial'));
    actions.appendChild(resultActionButton('Not', 'status-not'));

    top.appendChild(title);
    top.appendChild(badges);
    main.appendChild(top);
    main.appendChild(meta);
    main.appendChild(modelLine);
    main.appendChild(actions);
    row.appendChild(kind);
    row.appendChild(main);
    return row;
  }

  function resultBadge(text, extraClass) {
    const badge = document.createElement('span');
    badge.className = `pb-badge${extraClass ? ` ${extraClass}` : ''}`;
    badge.textContent = text;
    return badge;
  }

  function statusLabel(status) {
    if (status === 'full') return 'Downloaded';
    if (status === 'partial') return 'Partial';
    return 'Not downloaded';
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
    const row = button.closest('.pb-result');
    if (!row) return;
    const kind = row.dataset.kind;
    const id = row.dataset.id;
    const title = row.dataset.title;
    const slug = row.dataset.slug;
    const action = button.dataset.action;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'toggle-hidden') {
      setHidden(kind, id, row.dataset.directHidden !== '1');
      return;
    }
    if (action === 'status-full') { setDownloadState(kind, id, 'full'); return; }
    if (action === 'status-partial') { setDownloadState(kind, id, 'partial'); return; }
    if (action === 'status-not') { setDownloadState(kind, id, 'not'); return; }
    if (action === 'download-all') { startSearchDownload(kind, id, title, slug, 'all'); return; }
    if (action === 'download-images') { startSearchDownload(kind, id, title, slug, 'images'); return; }
    if (action === 'download-videos') { startSearchDownload(kind, id, title, slug, 'videos'); }
  }

  async function startSearchDownload(kind, id, title, slug, fileMode) {
    if (state.busy) { logLine('Wait for the current run to finish, or press Stop.'); return; }
    const previous = state.fileFilter;
    setFileFilter(fileMode);
    try {
      if (kind === 'model') {
        await downloadModel({ kind: 'model', id, slug, name: title }, false);
        return;
      }
      state.cancel = false;
      setBusy(true);
      resetLog();
      try {
        await processAlbum({ kind: 'album', id, slug, name: title });
      } catch (err) {
        if (errorMessage(err) === 'cancelled') logLine('Cancelled.');
        else logLine(`Set failed: ${errorMessage(err)}`);
      } finally {
        setBusy(false);
      }
    } finally {
      setFileFilter(previous);
    }
  }

  async function importDownloadStructure(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    showSearchMessage('Reading selected folder.');
    const logs = await getAllIndexLogs();
    if (!logs.length) {
      showSearchMessage('Index or import a PB+ index log before importing a download folder.');
      return;
    }

    const merged = mergeIndexLogs(logs);
    const candidates = buildDownloadImportCandidates(list);
    const matchedSets = new Set();
    const matchedModels = new Set();

    merged.sets.forEach(set => {
      if (!downloadCandidateMatchesSet(set, candidates)) return;
      const id = String(set && set.id || '');
      if (!id) return;
      matchedSets.add(id);
      (set.models || []).forEach(model => {
        const modelId = String(model && model.id || '');
        if (modelId) matchedModels.add(modelId);
      });
    });

    state.importSetMatches = matchedSets;
    state.importModelMatches = matchedModels;
    if (ui.importDir) ui.importDir.value = '';
    renderImportSummary(list.length, candidates.length);
  }

  async function hideVideoOnlySets() {
    if (state.busy) { showSearchMessage('Wait for the current run to finish, or press Stop.'); return; }
    showSearchMessage('Finding video-only sets.');
    const logs = await getAllIndexLogs();
    if (!logs.length) {
      showSearchMessage('Index or import a PB+ index log first.');
      return;
    }
    const merged = mergeIndexLogs(logs);
    const ids = merged.sets
      .filter(set => (Number(set && set.numVideos) || 0) > 0 && (Number(set && set.numImages) || 0) <= 0)
      .map(set => String(set && set.id || ''))
      .filter(Boolean);
    ids.forEach(id => state.hiddenSets.add(id));
    saveAdvancedState();
    scheduleCardRefresh();
    scheduleAdvancedSearch();
    showSearchMessage(`Hid ${ids.length} video-only set${ids.length === 1 ? '' : 's'}.`);
  }

  function buildDownloadImportCandidates(files) {
    const unique = new Map();
    Array.from(files || []).forEach(file => {
      const rawPath = String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/');
      if (!rawPath) return;
      const parts = rawPath.split('/').filter(Boolean);
      const leaf = parts[parts.length - 1] || rawPath;
      const parent = parts.length > 1 ? parts[parts.length - 2] : '';
      const withoutExt = leaf.replace(/\.[A-Za-z0-9]{2,5}$/i, '');
      [rawPath, leaf, withoutExt, parent].forEach(value => {
        const text = bareWords(value);
        if (text && !unique.has(text)) unique.set(text, { raw: value, text });
      });
    });
    return Array.from(unique.values());
  }

  function downloadCandidateMatchesSet(set, candidates) {
    const names = (set && set.models || []).map(model => String(model && model.name || '')).filter(Boolean);
    const album = {
      id: String(set && set.id || ''),
      date: String(set && set.dateProduced || ''),
      title: String(set && set.title || ''),
      models: names,
      nobodys: !!(set && set.nobodySet)
    };
    const base = bareWords(archiveBaseName(album));
    const date = dateKey(album.date);
    const titleWords = bareWords(albumTitlePart(album)).split(' ').filter(word => word.length > 2).slice(0, 8);
    const modelWords = bareWords(modelNamePart(album)).split(' ').filter(word => word.length > 2).slice(0, 6);
    if (!titleWords.length && !base) return false;

    return candidates.some(candidate => {
      const text = candidate.text;
      let score = 0;
      if (base && text.includes(base)) score += 120;
      if (date !== '000000' && text.includes(date)) score += 45;
      titleWords.forEach(word => { if (text.includes(word)) score += 12; });
      modelWords.forEach(word => { if (text.includes(word)) score += 7; });
      return score >= 72;
    });
  }

  function renderImportSummary(fileCount, candidateCount) {
    const sets = state.importSetMatches.size;
    const models = state.importModelMatches.size;
    if (ui.importSummary) {
      ui.importSummary.hidden = false;
      ui.importSummary.textContent = `Folder scan: ${fileCount} files, ${candidateCount} names checked, ${sets} sets matched, ${models} models involved.`;
      ui.importSummary.title = ui.importSummary.textContent;
    }
    if (ui.importActions) ui.importActions.hidden = sets === 0;
    showSearchMessage(sets ? `Matched ${sets} downloaded set${sets === 1 ? '' : 's'}.` : 'No downloaded sets matched the current index logs.');
  }

  function handleImportAction(event) {
    const button = event.target && event.target.closest && event.target.closest('button[data-import-action]');
    if (!button) return;
    const action = button.dataset.importAction;
    const setIds = Array.from(state.importSetMatches);
    const modelIds = Array.from(state.importModelMatches);
    if (!setIds.length) return;

    if (action === 'mark-full' || action === 'mark-partial') {
      const status = action === 'mark-full' ? 'full' : 'partial';
      setIds.forEach(id => state.setDownloadStatus.set(String(id), status));
      saveAdvancedState();
      scheduleAdvancedSearch();
      showSearchMessage(`Marked ${setIds.length} matched set${setIds.length === 1 ? '' : 's'} ${status}.`);
      return;
    }

    if (action === 'hide-sets') {
      setIds.forEach(id => state.hiddenSets.add(String(id)));
      saveAdvancedState();
      scheduleCardRefresh();
      scheduleAdvancedSearch();
      showSearchMessage(`Hid ${setIds.length} matched set${setIds.length === 1 ? '' : 's'}.`);
      return;
    }

    if (action === 'hide-models') {
      modelIds.forEach(id => state.hiddenModels.add(String(id)));
      saveAdvancedState();
      scheduleCardRefresh();
      scheduleAdvancedSearch();
      showSearchMessage(`Hid ${modelIds.length} matched model${modelIds.length === 1 ? '' : 's'} and their sets.`);
    }
  }

  function formatCount(value) {
    const number = Number(value) || 0;
    if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
    return String(number);
  }

  function normalizeImportedIndexLog(log, fallbackName) {
    if (!log || typeof log !== 'object') throw new Error(`${fallbackName || 'that file'} is not an index log`);
    if (log.type !== 'PlayboyPlusIndexLog') throw new Error(`${fallbackName || 'that file'} is not a Playboy Plus index log`);
    if (!Array.isArray(log.sets) || !Array.isArray(log.models)) throw new Error(`${fallbackName || 'that file'} is missing index data`);
    if (!log.generatedAt) log.generatedAt = new Date().toISOString();
    if (!log.id) log.id = `pbplus-index-${log.generatedAt}-${hashString(fallbackName || '')}`;
    return log;
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('could not read file'));
      reader.readAsText(file);
    });
  }

  function hashString(text) {
    let hash = 0;
    for (let i = 0; i < String(text || '').length; i++) {
      hash = ((hash << 5) - hash + String(text).charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function loadAdvancedState() {
    let raw = '';
    try { raw = localStorage.getItem(ADVANCED_STATE_KEY) || ''; } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      state.hiddenModels = new Set((parsed.hiddenModels || []).map(String));
      state.hiddenSets = new Set((parsed.hiddenSets || []).map(String));
      state.modelDownloadStatus = mapFromStatusObject(parsed.modelDownloadStatus);
      state.setDownloadStatus = mapFromStatusObject(parsed.setDownloadStatus);
      state.skipVariousDownloads = !!parsed.skipVariousDownloads;
      state.hideVariousSets = !!parsed.hideVariousSets;
    } catch {}
  }

  function saveAdvancedState() {
    const out = {
      hiddenModels: Array.from(state.hiddenModels),
      hiddenSets: Array.from(state.hiddenSets),
      modelDownloadStatus: statusObjectFromMap(state.modelDownloadStatus),
      setDownloadStatus: statusObjectFromMap(state.setDownloadStatus),
      skipVariousDownloads: !!state.skipVariousDownloads,
      hideVariousSets: !!state.hideVariousSets
    };
    try { localStorage.setItem(ADVANCED_STATE_KEY, JSON.stringify(out)); } catch (err) {
      logLine(`Advanced state could not be saved (${errorMessage(err)}).`);
    }
  }

  function mapFromStatusObject(raw) {
    const map = new Map();
    Object.keys(raw || {}).forEach(id => {
      const value = String(raw[id] || '');
      if (DOWNLOAD_STATUSES.indexOf(value) >= 0 && value !== 'not') map.set(String(id), value);
    });
    return map;
  }

  function statusObjectFromMap(map) {
    const out = {};
    map.forEach((value, id) => {
      if (DOWNLOAD_STATUSES.indexOf(value) >= 0 && value !== 'not') out[id] = value;
    });
    return out;
  }

  function setHidden(kind, id, hidden) {
    const target = kind === 'model' ? state.hiddenModels : state.hiddenSets;
    if (hidden) target.add(String(id));
    else target.delete(String(id));
    saveAdvancedState();
    scheduleCardRefresh();
    scheduleAdvancedSearch();
  }

  function setDownloadState(kind, id, status) {
    const normalized = DOWNLOAD_STATUSES.indexOf(status) >= 0 ? status : 'not';
    const target = kind === 'model' ? state.modelDownloadStatus : state.setDownloadStatus;
    if (normalized === 'not') target.delete(String(id));
    else target.set(String(id), normalized);
    saveAdvancedState();
    scheduleAdvancedSearch();
  }

  function downloadStatus(kind, id) {
    const target = kind === 'model' ? state.modelDownloadStatus : state.setDownloadStatus;
    return target.get(String(id)) || 'not';
  }

  function itemIsHidden(kind, item) {
    if (kind === 'model') return state.hiddenModels.has(String(item && item.id || ''));
    if (state.hiddenSets.has(String(item && item.id || ''))) return true;
    if (state.hideVariousSets && itemIsVariousSet(item)) return true;
    return (item && item.modelIds || []).some(id => state.hiddenModels.has(String(id)));
  }

  function itemIsVariousSet(item) {
    if (!item) return false;
    if (typeof item.nobodySet === 'boolean') return item.nobodySet;
    return setBelongsToNobody(item.title, item.modelNames);
  }

  function setSkipVariousDownloads(skip) {
    state.skipVariousDownloads = !!skip;
    renderAdvancedStateControls();
    saveAdvancedState();
  }

  function setHideVariousSets(hide) {
    state.hideVariousSets = !!hide;
    renderAdvancedStateControls();
    saveAdvancedState();
    scheduleCardRefresh();
    if (ui.searchResults && ui.searchResults.children.length) scheduleAdvancedSearch();
  }

  function renderAdvancedStateControls() {
    if (ui.skipVarious) ui.skipVarious.checked = !!state.skipVariousDownloads;
    if (ui.hideVarious) ui.hideVarious.checked = !!state.hideVariousSets;
  }

  // --- panel plumbing -------------------------------------------------------

  function setBusy(busy) {
    state.busy = busy;
    if (!busy) {
      // A stale cancel would otherwise abort the next thing that checks it.
      state.cancel = false;
    }
    if (ui.drop) {
      ui.drop.hidden = busy;
    }
    if (ui.advancedDrop) {
      ui.advancedDrop.hidden = busy;
    }
    if (ui.progress) {
      ui.progress.hidden = !busy;
    }
    if (ui.live) {
      ui.live.hidden = !busy;
    }
    if (ui.status) {
      ui.status.hidden = !busy;
    }
    if (ui.stop) {
      ui.stop.hidden = !busy;
      ui.stop.disabled = !busy;
    }
    [ui.indexStart, ui.indexImport, ui.importDownloads, ui.indexPurge, ui.hideVideoOnly].forEach(button => {
      if (button) button.disabled = busy;
    });
    if (ui.skipVarious) ui.skipVarious.disabled = busy;
    if (ui.hideVarious) ui.hideVarious.disabled = busy;
    if (!busy) syncContext();
  }

  function requestStop() {
    if (!state.busy) return;
    state.cancel = true;
    abortActiveRequests();
    setProgress(0);
    logLine('Stopped.');
  }

  function setProgress(percent) {
    const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
    ui.fill.style.width = `${value}%`;
  }

  function resetLog() {
    setProgress(0);
    setSetDisplay('0/0');
    setAlbumDisplay('None');
    setFileDisplay('0/0');
    logLine('Starting.');
  }

  function logLine(text) {
    setStatus(text);
  }

  function setStatus(text) {
    if (!ui.status) return;
    ui.status.textContent = String(text || '');
    ui.status.title = ui.status.textContent;
  }

  function setModelDisplay(text, title) {
    setDisplay(ui.model, text, title);
  }

  function setSetDisplay(text, title) {
    setDisplay(ui.sets, text, title);
  }

  function setAlbumDisplay(text, title) {
    setDisplay(ui.album, text, title);
  }

  function setFileDisplay(text, title) {
    setDisplay(ui.files, text, title);
  }

  function setFileProgress(done, total, failed) {
    const label = `${done}/${total}${failed ? `, ${failed} failed` : ''}`;
    const left = Math.max(0, Number(total) - Number(done));
    setFileDisplay(label, `${done} done, ${left} not done${failed ? `, ${failed} failed` : ''}`);
  }

  function setDisplay(node, text, title) {
    if (!node) return;
    node.textContent = String(text || '');
    node.title = String(title || text || '');
  }

  function abortActiveRequests() {
    Array.from(state.aborters).forEach(abort => {
      try { abort(); } catch {}
    });
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
      if (state.cancel) cancel();
    });
  }

  function errorMessage(err) {
    if (!err) return 'unknown error';
    return String(err.message || err);
  }

  // Hiding has to be in place before the parser reaches the body, or there is
  // nothing left to save; the panel waits for a body to attach itself to.
  applyHideStyle();
  applyCardHideStyle();
  loadActorTypes();
  loadSetTypes();
  loadAdvancedState();
  loadFileFilter();
  installEarlyObserver();
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
