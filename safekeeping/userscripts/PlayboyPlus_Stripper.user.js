// ==UserScript==
// @name         Playboy Plus Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.10.04
// @description  Playboy Plus gallery downloader. Drop a model link to download her galleries one at a time, named by model and date.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/PlayboyPlus_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/PlayboyPlus_Stripper.user.js
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
// ---------------------------------------------------------------------------
// THE PANEL
// ---------------------------------------------------------------------------
// One pane, and the same one the Zishy Stripper has. The two sites want the same
// thing done to them, so the two scripts look and read alike: drop a link or
// search the index, get rows, press Download. The footer holds the library-wide
// buttons — Index site, Check all, and the two Clears, each shown only when
// there is something for it to do.
//
// What it is for is taking a model's whole library in one go. A single set is
// the same row with one thing in it, for picking up what has landed since.
//
// There is no queue, no tabs and no page-scraping button: everything arrives in
// the results list, from a drop, from a search, or from the page you are standing
// on. Search only ever surfaces models. Type and a list of years sit under the
// search field.
//
// ---------------------------------------------------------------------------
// ONE ANSWER PER SET
// ---------------------------------------------------------------------------
// A gallery is downloaded or it is not. There is no file-kind filter, nothing
// is skipped for being a Various set or a video, nothing is marked by hand, and
// there is no "partial". Everything a gallery holds is taken, every time.
//
// The one rule about what is *not* downloaded is that a gallery already
// downloaded is not downloaded again — asked once, in processAlbum, which every
// route into a download goes through. That is what stops a roundup or a joint
// set being fetched a second time when you reach it through the second model in
// it: it is one set on disk, so it is fetched once.
//
// ---------------------------------------------------------------------------
// HIDING IS HAVING
// ---------------------------------------------------------------------------
// There is no manual hiding and no list of things you have curated away. A card
// on the site is gone if and only if you already have what is behind it: a
// gallery whose files are all downloaded, or a model every one of whose sets is.
// Nothing else can hide anything, and nothing you have not got can be hidden.
//
// Model completeness is read out of the index logs, which are the only thing
// that knows how many sets a model has. Without one, galleries still hide and
// models do not.
//
// A library saved before this script existed, or on another machine, is
// invisible to that record — which is what "Check all" is for. Point it at your
// PlayboyPlus folder and the folder becomes the whole record: what is in it is
// downloaded, and anything that is not is forgotten. An empty folder therefore
// means you have nothing.
//
// "Reset Downloads" beside it is the other direction: forget every download at
// once and have the whole site back. Your index logs survive it; Purge Browser
// Logs is the button for those.
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

  // There is no file-kind filter. Everything a gallery holds is taken, every
  // time — photos and the bonus video both. A gallery is one thing, "downloaded"
  // is one answer about it, and a half-taken one would be a third state that
  // everything downstream (hiding, skipping, the completion figures) would then
  // have to have an opinion about. Absent or unreachable videos are logged and
  // skipped; they never fail a gallery.
  //
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

  // Where a set that is nobody's goes — a roundup rather than a joint set. See
  // "compilations" below for how that is decided. It is downloaded like anything
  // else, once, and filed here instead of under a dozen women's names.
  const MULTI_MODEL_FOLDER = '_Various';

  // Past this many models a set is a roundup whatever its title says. See the
  // ceiling in "compilations".
  const COLLAB_MAX_MODELS = 6;

  // Nearly every title on this site reads "<Model> in <Something>". Stripping the
  // model off the front, the way Zishy does, would leave "In Something" on
  // thousands of files. With this on the leading connector goes too.
  const STRIP_LEADING_IN = true;

  // The six kinds of model the site files people under. The slug is the site's
  // own; the label is what fits in the search pane's Type menu. Three other
  // categories exist — Editors' Choice, VIP Content and a five-set MetArt
  // oddity — and are deliberately not here: they describe the content rather
  // than the woman.
  const MODEL_TYPES = [
    { slug: 'Playmates', label: 'Playmates' },
    { slug: 'Playboy-Muses', label: 'Muses' },
    { slug: 'Playboy-Creator', label: 'Creator' },
    { slug: 'All-Stars', label: 'All Stars' },
    { slug: 'International', label: 'International' },
    { slug: 'Celebrities', label: 'Celebrities' }
  ];

  const QUALITY_KEY = 'PlayboyStripper.quality.v1';
  const PANEL_POS_KEY = 'PlayboyStripper.panelpos.v1';
  const INDEX_DB_NAME = 'PlayboyStripper.indexlogs.v1';
  const INDEX_DB_STORE = 'logs';
  const ADVANCED_STATE_KEY = 'PlayboyStripper.advancedState.v1';
  // Two states, and deliberately not three. A gallery is downloaded or it is
  // not: nothing writes a status by hand any more, and the only thing that
  // writes one at all is a run that finished.
  const DOWNLOAD_STATUSES = ['not', 'full'];

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
    videoQuality: DEFAULT_VIDEO_QUALITY,
    transport: '',
    algolia: null,
    aborters: new Set(),
    searchTimer: 0,
    modelDownloadStatus: new Map(),
    setDownloadStatus: new Map(),
    checking: false,
    // The site index, in memory: one snapshot, read at boot. Null means there
    // is none, which every reader treats as "cannot say" rather than as "empty".
    index: null,
    indexLoading: null,
    indexing: false,
    hidden: true,
    // Whether what is in the results came from the page rather than from you.
    // Only that is replaced when you navigate.
    focusedFromPage: false
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

  // A link goes when you already have what is behind it, and for no other reason.
  function linkShouldHide(target) {
    return targetIsHad(target);
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
        <button id="pbEye" class="pb-iconBtn" type="button" title="Reveal what you already have">&#128584;</button>
        <button id="pbCollapse" class="pb-iconBtn" type="button" title="Collapse">&#9652;</button>
      </div>
      <div class="pb-body">
        <div id="pbDrop" class="pb-drop" title="Drop a model, or a set. A set resolves to whoever is in it.">Drop a model or set link here</div>

        <div class="pb-block pb-find">
          <div class="pb-kicker">Find</div>
          <input id="pbSearchQuery" class="pb-searchInput" type="search" placeholder="Search models">
          <div class="pb-filterGrid">
            <label><span>Type</span><select id="pbSearchType">
              <option value="">Any type</option>
              ${MODEL_TYPES.map(type => `<option value="${type.slug}">${type.label}</option>`).join('')}
            </select></label>
            <label><span>Years</span><input id="pbSearchYears" type="text" inputmode="numeric" placeholder="2019, 2021-2023"></label>
          </div>
          <div class="pb-searchActions">
            <button id="pbSearchRun" type="button">Search</button>
            <button id="pbSearchClear" type="button">Clear</button>
          </div>
        </div>

        <div class="pb-resultsWrap">
          <div id="pbSearchSummary" class="pb-searchSummary">Index the site to search it.</div>
          <div id="pbSearchResults" class="pb-searchResults"></div>
        </div>

        <div class="pb-progress" hidden><div id="pbFill"></div></div>
        <div class="pb-live" aria-live="polite" hidden>
          <div class="pb-line"><span>Model</span><strong id="pbModel">None</strong></div>
          <div class="pb-line"><span>Sets</span><strong id="pbSets">0/0</strong></div>
          <div class="pb-line"><span>Current</span><strong id="pbAlbum">None</strong></div>
          <div class="pb-line"><span>Files</span><strong id="pbFiles">0/0</strong></div>
        </div>
        <button id="pbStop" type="button" hidden>Stop</button>
        <div id="pbLog" class="pb-log" aria-live="polite"></div>

        <div class="pb-foot">
          <div class="pb-footStats">
            <span id="pbStats">No index yet</span>
            <button id="pbIndex" class="pb-footBtn" type="button" title="Walk the site once to learn every model and every set she has">Index site</button>
          </div>
          <div class="pb-footBtns">
            <button id="pbCheck" class="pb-footBtn" type="button" title="Pick your downloads folder. What is in it replaces the download record.">Check all</button>
            <button id="pbClearIndex" class="pb-footBtn" type="button" title="Forget what the site holds. Your downloads are kept." hidden>Clear index</button>
            <button id="pbClearDownloads" class="pb-footBtn" type="button" title="Forget every download, site-wide. The index is kept." hidden>Clear downloads</button>
          </div>
          <div id="pbFootNote" class="pb-footNote" hidden></div>
        </div>
        <input id="pbCheckDir" type="file" webkitdirectory directory multiple hidden>
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
    ui.log = panel.querySelector('#pbLog');
    ui.drop = panel.querySelector('#pbDrop');
    ui.eye = panel.querySelector('#pbEye');
    ui.stop = panel.querySelector('#pbStop');
    ui.searchQuery = panel.querySelector('#pbSearchQuery');
    ui.searchType = panel.querySelector('#pbSearchType');
    ui.searchYears = panel.querySelector('#pbSearchYears');
    ui.searchRun = panel.querySelector('#pbSearchRun');
    ui.searchClear = panel.querySelector('#pbSearchClear');
    ui.searchSummary = panel.querySelector('#pbSearchSummary');
    ui.searchResults = panel.querySelector('#pbSearchResults');
    ui.stats = panel.querySelector('#pbStats');
    ui.index = panel.querySelector('#pbIndex');
    ui.check = panel.querySelector('#pbCheck');
    ui.clearIndex = panel.querySelector('#pbClearIndex');
    ui.clearDownloads = panel.querySelector('#pbClearDownloads');
    ui.footNote = panel.querySelector('#pbFootNote');
    ui.checkDir = panel.querySelector('#pbCheckDir');

    ui.stop.addEventListener('click', requestStop);
    ui.eye.addEventListener('click', () => setHidden(!state.hidden));
    ui.searchResults.addEventListener('click', handleSearchResultAction);
    ui.searchRun.addEventListener('click', () => runAdvancedSearch().catch(err => showSearchMessage(`Search failed: ${errorMessage(err)}`)));
    ui.searchClear.addEventListener('click', clearAdvancedSearch);
    ui.searchQuery.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runAdvancedSearch().catch(err => showSearchMessage(`Search failed: ${errorMessage(err)}`));
    });
    ui.index.addEventListener('click', () => {
      if (state.indexing) { requestStop(); return; }
      startIndexing().catch(err => logLine(`Index failed: ${errorMessage(err)}`));
    });
    ui.check.addEventListener('click', () => { if (!state.checking) ui.checkDir.click(); });
    ui.checkDir.addEventListener('change', () => {
      // Copied out, not referenced: `input.files` is live and the line below
      // empties it. Clearing it is also what lets the same folder be picked
      // twice in a row and still fire a change event the second time.
      const picked = Array.from(ui.checkDir.files || []);
      ui.checkDir.value = '';
      checkDownloadFolder(picked).catch(err => setFootNote(`Folder check failed: ${errorMessage(err)}`));
    });
    ui.clearIndex.addEventListener('click', () => clearIndex().catch(err => logLine(`Could not clear the index: ${errorMessage(err)}`)));
    ui.clearDownloads.addEventListener('click', resetDownloads);
    [ui.searchQuery, ui.searchType, ui.searchYears].forEach(control => {
      if (control) control.addEventListener('input', scheduleAdvancedSearch);
    });
    makePanelDraggable(panel, panel.querySelector('.pb-head'));
    installDropTarget(panel);
    panel.querySelector('#pbCollapse').addEventListener('click', () => {
      panel.classList.toggle('pb-collapsed');
      panel.querySelector('#pbCollapse').innerHTML = panel.classList.contains('pb-collapsed') ? '&#9662;' : '&#9652;';
    });

    loadVideoQuality();
    installRouteObserver();
    installSoftNavigation();
    setHidden(true);
    renderStats();
    // Everything downstream reads the index, so it is read once here and the
    // page, the footer and the lookup all restate themselves when it lands.
    loadSiteIndex().then(() => {
      scheduleCardRefresh();
      renderStats();
      showSearchMessage(searchIdleMessage());
      syncContext();
    });
    // The body existed before the observer did, so anything already parsed has
    // not been judged yet.
    refreshHiddenCards();
  }

  // The eye reveals what is being hidden, without changing what is hidden: the
  // class stays on the cards and only the rule that acts on it is switched off.
  function setHidden(hidden) {
    state.hidden = hidden !== false;
    if (cardHideStyleEl) cardHideStyleEl.disabled = !state.hidden;
    if (hideStyleEl) hideStyleEl.disabled = !state.hidden;
    updateEyeButton();
  }

  function updateEyeButton() {
    if (!ui.eye) return;
    let count = 0;
    try { count = document.querySelectorAll('.pbGot').length; } catch {}
    ui.eye.textContent = state.hidden ? '\u{1F648}' : '\u{1F441}';
    ui.eye.title = state.hidden
      ? `Reveal what you already have${count ? ` (${count} on this page)` : ''}`
      : 'Hide it again';
  }

  function setFootNote(text) {
    if (!ui.footNote) return;
    ui.footNote.hidden = !text;
    ui.footNote.textContent = String(text || '');
    ui.footNote.title = ui.footNote.textContent;
  }

  // Which encode to take is not a filter over what gets downloaded — the video
  // is always taken — so it survives the filters going. There is no control for
  // it; it sits at Best.
  function setVideoQuality(quality) {
    state.videoQuality = VIDEO_QUALITIES.indexOf(quality) >= 0 ? quality : DEFAULT_VIDEO_QUALITY;
    try { sessionStorage.setItem(QUALITY_KEY, state.videoQuality); } catch {}
  }

  function loadVideoQuality() {
    setVideoQuality(DEFAULT_VIDEO_QUALITY);
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
  // Nothing is skipped for being either one. Everything on the site gets
  // downloaded, and this question decides one thing only: whether a set files
  // under its models or under _Various. It used to decide two, the other being
  // whether a "skip compilations" toggle threw the set away — and a roundup
  // thrown away is the same photographs kept under the women in it, which is
  // what the toggle was really for. It is better done once, at the folder: the
  // set is kept, and it is kept where it belongs.
  //
  // The reason a roundup is not downloaded twice over is the ordinary one, and
  // it is not special to roundups: a set already downloaded is not downloaded
  // again, whoever you reached it through. See processAlbum.
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
  // off the same catalogue record, so the folder it lands in cannot disagree
  // with the record for want of a comma somewhere in a title.
  function albumBelongsToNobody(album) {
    if (album && typeof album.nobodys === 'boolean') return album.nobodys;
    return setBelongsToNobody(album && album.title, (album && album.models) || []);
  }

  // --- the verdict -----------------------------------------------------------
  //
  // Hidden and downloaded are the same thing. There is no manual hiding, no list
  // of things you have curated away, and nothing to keep in step: a card is gone
  // if and only if you already have what is behind it.
  //
  //   a set    — its own download status is Downloaded;
  //   a model  — every set of hers is, which is what the index is for.
  //
  // A model whose sets the index does not know cannot be judged, so her card
  // stays. Leaving a card alone is always the safe failure here: one that
  // appears and then vanishes reads worse than one that never went.

  function setIsHad(setId) {
    return downloadStatus('set', setId) === 'full';
  }

  function modelIsHad(modelId) {
    const id = String(modelId || '');
    if (!id) return false;
    if (downloadStatus('model', id) === 'full') return true;
    const sets = modelSetIds(id);
    if (!sets.length) return false;
    return sets.every(setIsHad);
  }

  // Her sets, from the index. Empty when there is no index or she is not in it,
  // which every caller reads as "cannot say" rather than as "none".
  function modelSetIds(modelId) {
    const sets = state.index && state.index.modelSets.get(String(modelId || ''));
    return sets ? Array.from(sets) : [];
  }

  function targetIsHad(target) {
    if (!target) return false;
    if (target.kind === 'model') return modelIsHad(target.id);
    return setIsHad(target.id);
  }

  function addStyle(css) {
    try {
      if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
    } catch {}
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // The panel is the same panel as Zishy's, in this site's accent: one dark
  // sheet, one gold, used at fixed strengths. Anything changed here should be
  // changed there, or the two stop reading as one tool.
  function injectStyle() {
    addStyle(`
      #playboyStripperPanel{position:fixed;right:16px;top:16px;z-index:2147483646;width:360px;max-height:92vh;
        display:flex;flex-direction:column;border:1px solid rgba(224,196,138,.4);border-radius:10px;
        background:#141210;color:#f2ece1;box-shadow:0 18px 60px rgba(0,0,0,.6);font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #playboyStripperPanel [hidden]{display:none!important}
      #playboyStripperPanel.pb-collapsed{height:auto;max-height:none}
      #playboyStripperPanel.pb-collapsed .pb-body{display:none}
      #playboyStripperPanel .pb-head{height:38px;display:flex;align-items:center;gap:6px;padding:0 10px;
        touch-action:none;user-select:none;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#33261a,#1a1613);cursor:grab}
      #playboyStripperPanel.pb-dragging-panel .pb-head{cursor:grabbing}
      #playboyStripperPanel .pb-title{font-weight:900;color:#e0c48a;flex:1 1 auto;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #playboyStripperPanel .pb-iconBtn{flex:0 0 auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px;font-size:13px}
      #playboyStripperPanel .pb-body{flex:1 1 auto;display:flex;flex-direction:column;gap:12px;padding:10px;min-height:0;overflow:hidden}
      #playboyStripperPanel button{appearance:none;width:100%;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#f2ece1;font:700 12px/1 Arial,sans-serif;cursor:pointer}
      #playboyStripperPanel button:hover:not(:disabled){background:rgba(224,196,138,.2);border-color:rgba(224,196,138,.55)}
      #playboyStripperPanel button:disabled{opacity:.42;cursor:default}
      #playboyStripperPanel input,#playboyStripperPanel select{box-sizing:border-box;width:100%;min-width:0;height:30px;
        border:1px solid rgba(255,255,255,.14);border-radius:7px;background:#211d19;color:#f2ece1;
        font:700 12px/1 Arial,sans-serif;padding:0 8px;outline:none}
      #playboyStripperPanel input:focus,#playboyStripperPanel select:focus{border-color:rgba(224,196,138,.7);box-shadow:0 0 0 2px rgba(224,196,138,.14)}
      #playboyStripperPanel input::placeholder{color:#8f806b}
      #playboyStripperPanel input[type=number]{-moz-appearance:textfield}
      #playboyStripperPanel input[type=number]::-webkit-inner-spin-button,
      #playboyStripperPanel input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}

      #playboyStripperPanel .pb-drop{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-height:52px;padding:8px 10px;
        border:1px dashed rgba(224,196,138,.45);border-radius:8px;background:rgba(224,196,138,.06);
        color:#b3a58c;font-weight:700;text-align:center}
      #playboyStripperPanel.pb-dragging .pb-drop{border-color:#e0c48a;border-style:solid;
        background:rgba(224,196,138,.22);color:#fff}

      #playboyStripperPanel .pb-block{flex:0 0 auto;display:flex;flex-direction:column;gap:8px}
      #playboyStripperPanel .pb-kicker{color:#857a68;font-weight:900;letter-spacing:.12em;text-transform:uppercase;font-size:10px}
      #playboyStripperPanel .pb-searchInput{flex:0 0 auto;height:38px;min-height:38px;font-size:13px;padding:0 12px;border-radius:9px}
      #playboyStripperPanel .pb-filterGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      #playboyStripperPanel .pb-filterGrid label{display:flex;flex-direction:column;gap:4px;min-width:0}
      #playboyStripperPanel .pb-filterGrid label span{color:#857a68;font-weight:900;letter-spacing:.06em;text-transform:uppercase;font-size:10px}
      #playboyStripperPanel .pb-searchActions{display:grid;grid-template-columns:1.4fr .8fr;gap:8px}
      #playboyStripperPanel #pbSearchRun{background:#e0c48a;color:#1a1613;border-color:#c9ae72;font-weight:900}
      #playboyStripperPanel #pbSearchRun:hover:not(:disabled){background:#edd4a4;border-color:#e0c48a}
      #playboyStripperPanel #pbSearchClear{background:transparent}

      #playboyStripperPanel .pb-resultsWrap{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:80px;padding:12px;
        border:1px solid rgba(224,196,138,.14);border-radius:10px;background:rgba(0,0,0,.22);overflow:hidden}
      #playboyStripperPanel .pb-searchSummary{flex:0 0 auto;min-height:18px;color:#bdb1a0;font-weight:700;line-height:1.4}
      #playboyStripperPanel .pb-searchResults{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding-right:2px}
      #playboyStripperPanel .pb-searchResults:empty{display:none}
      #playboyStripperPanel .pb-result{flex:0 0 auto;display:grid;grid-template-columns:28px minmax(0,1fr);gap:0;overflow:hidden;
        border:1px solid rgba(224,196,138,.16);border-radius:10px;background:rgba(255,255,255,.035)}
      #playboyStripperPanel .pb-resultHidden{opacity:.62}
      #playboyStripperPanel .pb-resultKind{display:flex;align-items:center;justify-content:center;align-self:stretch;
        writing-mode:vertical-rl;transform:rotate(180deg);padding:10px 0;
        background:rgba(224,196,138,.13);color:#e0c48a;font-weight:900;letter-spacing:.16em;text-transform:uppercase;font-size:9px}
      #playboyStripperPanel .pb-result[data-kind="set"] .pb-resultKind{background:rgba(255,255,255,.06);color:#d7cbb6}
      #playboyStripperPanel .pb-resultMain{min-width:0;display:flex;flex-direction:column;gap:5px;padding:10px 12px 12px}
      #playboyStripperPanel .pb-resultTop{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}
      #playboyStripperPanel .pb-resultTitle{color:#f2ece1;font-weight:900;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playboyStripperPanel .pb-resultMeta{color:#a99b87;font-weight:700;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playboyStripperPanel .pb-resultModels{color:#cfc2ae;font-weight:700;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playboyStripperPanel .pb-resultBadges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px}
      #playboyStripperPanel .pb-badge{display:inline-flex;align-items:center;min-height:18px;padding:0 7px;border-radius:999px;
        background:rgba(255,255,255,.08);color:#cfc2ae;font-weight:900;font-size:9px;letter-spacing:.04em;text-transform:uppercase}
      #playboyStripperPanel .pb-badgeFull{background:rgba(88,143,101,.24);color:#d7ffd8}
      #playboyStripperPanel .pb-badgePart{background:rgba(224,196,138,.2);color:#f8edd4}
      #playboyStripperPanel .pb-resultActions{display:flex;gap:6px;margin-top:4px;
        padding-top:8px;border-top:1px solid rgba(224,196,138,.12)}
      #playboyStripperPanel .pb-resultActions button{flex:1 1 auto;min-height:26px;padding:0 6px;border-radius:7px;font-size:10px}
      #playboyStripperPanel .pb-result a{color:#e0c48a;text-decoration:none}
      #playboyStripperPanel .pb-result a:hover{text-decoration:underline}

      #playboyStripperPanel .pb-progress{display:block;box-sizing:border-box;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      #playboyStripperPanel #pbFill{display:block;height:10px;min-height:10px;width:0;
        background:linear-gradient(90deg,#b08d4e,#e0c48a);transition:width 120ms ease}
      #playboyStripperPanel .pb-live{flex:0 0 auto;display:flex;flex-direction:column;gap:5px}
      #playboyStripperPanel .pb-line{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;align-items:baseline}
      #playboyStripperPanel .pb-line span{color:#857a68;font-weight:900;text-transform:uppercase;font-size:10px}
      #playboyStripperPanel .pb-line strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee5d5;font-size:12px}
      #playboyStripperPanel #pbStop{flex:0 0 auto;background:#4a3323;color:#ffeccf;border-color:rgba(224,196,138,.6)}
      #playboyStripperPanel .pb-log{flex:0 0 auto;max-height:72px;overflow:auto;color:#a99b87;font:700 11px/1.35 Arial,sans-serif;
        white-space:pre-wrap;word-break:break-word}
      #playboyStripperPanel .pb-log:empty{display:none}

      #playboyStripperPanel .pb-foot{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding-top:10px;
        border-top:1px solid rgba(224,196,138,.16)}
      #playboyStripperPanel .pb-footStats{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
      #playboyStripperPanel .pb-footStats span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        color:#bdb1a0;font-weight:700;font-size:11px}
      #playboyStripperPanel .pb-footBtns{display:flex;flex-wrap:wrap;gap:6px}
      #playboyStripperPanel .pb-footBtn{width:auto;flex:1 1 auto;min-height:28px;border-radius:7px;font-size:11px}
      #playboyStripperPanel .pb-footStats .pb-footBtn{flex:0 0 auto}
      #playboyStripperPanel .pb-footNote{color:#bdb1a0;font-weight:700;font-size:11px;line-height:1.35}

      @media (max-width:700px){
        #playboyStripperPanel{width:calc(100vw - 16px);right:8px;left:auto}
        #playboyStripperPanel .pb-searchActions{grid-template-columns:1fr}
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
      if (!targets.length) { showSearchMessage('Nothing set- or model-shaped in that drop.'); return; }
      // A drop lands in the results list, exactly where a search lands. Whether
      // you found the thing by name or by dragging it in, what you get is the
      // same row with the same button under it.
      state.focusedFromPage = false;
      focusAdvancedDropTargets(targets).catch(err => showSearchMessage(`Could not show that link: ${errorMessage(err)}`));
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
    return modelTargetsFromPhotosetHit(record);
  }

  async function albumsForModel(model) {
    const entry = Object.assign({}, model);
    const found = new Map();
    await algoliaWalk(ALGOLIA_PHOTOSETS, {
      filters: `actors.actor_id:${Number(entry.id)}`,
      attributesToRetrieve: JSON.stringify(['set_id', 'title', 'url_title', 'actors', 'categories'])
    }, (hits, page, result) => {
      hits.forEach(hit => {
        if (!entry.name) {
          const mine = (hit.actors || []).find(actor => String(actor.actor_id) === String(entry.id));
          if (mine && mine.name) entry.name = sanitizeNamePart(mine.name);
        }
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
      albums: Array.from(found.values()).map(album => Object.assign(album, { viaModel: true }))
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
      if (!found.albums.length) {
        logLine('No sets found for this model.');
        return { modelId: String(found.model.id), setIds: [], saved: 0 };
      }

      let saved = 0;
      let failed = 0;
      // A set you already have is not a set that went wrong, and it is not a set
      // that was left out: it is one of hers that is accounted for. Counting it
      // as anything else would mean a model you have every set of never reads as
      // finished, which is the one thing that record is for.
      let already = 0;
      let skipped = 0;
      const savedIds = [];
      logLine(`${name}: ${found.albums.length} set${found.albums.length === 1 ? '' : 's'}.`);
      setSetDisplay(`0/${found.albums.length} done`);
      for (let i = 0; i < found.albums.length; i++) {
        if (state.cancel) throw new Error('cancelled');
        const albumRef = found.albums[i];
        const progress = () => setSetDisplay(`${saved}/${found.albums.length} done`
          + `${already ? `, ${already} already had` : ''}${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}`);
        progress();
        setAlbumDisplay(albumRef.name || `Gallery ${albumRef.id}`, `Gallery ${albumRef.id}`);
        setFileDisplay('Scanning');
        // Asked here as well as inside processAlbum, so a set she shares with
        // somebody you have already been through costs nothing at all — not even
        // the catalogue lookup that the guard downstream would need to make.
        if (setIsHad(albumRef.id)) {
          already++;
          progress();
          continue;
        }
        logLine(`--- ${i + 1}/${found.albums.length}: ${albumRef.name || `Gallery ${albumRef.id}`} ---`);
        try {
          await processAlbum(albumRef);
          saved++;
          if (albumRef.id) savedIds.push(String(albumRef.id));
        } catch (err) {
          const message = errorMessage(err);
          if (message === 'cancelled') throw err;
          if (err && err.had) {
            already++;
          } else if (err && err.skip) {
            skipped++;
            logLine(`Gallery ${albumRef.id} skipped: ${message}`);
          } else {
            failed++;
            logLine(`Gallery ${albumRef.id} failed: ${message}`);
          }
        }
        logLine(`Model progress: ${saved} saved, ${already} already had, ${failed} failed, ${skipped} skipped.`);
        progress();
        if (i + 1 < found.albums.length) await delay(ALBUM_DELAY_MS);
      }
      logLine(`Finished ${name}: ${saved} saved, ${already} already had, ${failed} failed, ${skipped} skipped.`);
      // Written by the run and never by hand. It is a fallback for a library with
      // no index log, where nothing else can say how many sets she has; where
      // there is one, modelIsHad reads it off her sets instead.
      if (saved + already === found.albums.length) setDownloadState('model', found.model.id, 'full');
      return { modelId: String(found.model.id), setIds: savedIds, saved };
    } catch (err) {
      setProgress(0);
      if (errorMessage(err) === 'cancelled') {
        if (alreadyBusy) throw err;
        logLine('Cancelled.');
      } else {
        logLine(`Model failed: ${errorMessage(err)}`);
      }
      return { modelId: String(model.id || ''), setIds: [], saved: 0 };
    } finally {
      if (!alreadyBusy) setBusy(false);
    }
  }

  // --- download -------------------------------------------------------------

  // Every download in the script funnels through here, which is why the
  // already-had guard lives here and nowhere else. A set reached through two
  // models — a joint set, a roundup, anything in _Various — is one set on disk,
  // and the second time it comes round it is not fetched again. There is no
  // toggle for that: hidden and downloaded are the same thing, so downloading
  // something you have would be asking for a file you are already being told
  // you have.
  //
  // `err.had` marks it as the ordinary case rather than a failure, so a model
  // run can count it towards her being finished instead of against it.
  async function processAlbum(ref) {
    if (setIsHad(ref.id)) {
      const err = new Error('already downloaded');
      err.skip = true;
      err.had = true;
      throw err;
    }

    setProgress(0);
    logLine(`Scanning gallery ${ref.id}.`);

    const album = await scanAlbum(ref);
    if (state.cancel) throw new Error('cancelled');
    if (!album.items.length) throw new Error('no photos or videos found in this gallery');

    setAlbumDisplay(album.title, `${album.title} (${album.id})`);
    setFileDisplay(`0/${album.items.length}`);
    logLine(`${album.title} — ${album.items.length} file${album.items.length === 1 ? '' : 's'}, ${album.models.join(' & ') || 'no model listed'}, ${album.date || 'no date'}.`);

    album.saved = await saveAlbumFiles(album);
    setDownloadState('set', album.id, 'full');
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
      nobodys: isCompilationRecord(record),
      clipId: Number(record.clip_id) || 0,
      declared: Number(record.num_of_pictures) || 0,
      items: []
    };

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

    const video = await videoForAlbum(album);
    if (video) {
      album.items.push({ kind: 'video', url: video.url, quality: video.quality, bytes: video.bytes, index: 0 });
      logLine(`Video found: ${video.quality}${video.bytes ? `, ${formatBytes(video.bytes)}` : ''}.`);
    } else {
      logLine('No video on this gallery.');
    }

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
    // A roundup is nobody's, so it goes to _Various rather than being filed
    // under whichever of its dozen models happens to be listed first.
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

  // Names as they actually land on disk: punctuation is deleted, not turned into
  // spaces, so "O'Hara" is "OHara" and "Renée" is "Rene". Check all has to read
  // both the folder and the catalogue through this, or a sanitized zip never
  // matches the title it came from.
  function fileNameMatchText(raw) {
    const s = sanitizeNamePart(raw)
      .replace(/[^A-Za-z0-9._ -]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return bareWords(s);
  }

  // Letters and digits only. Apostrophes, hyphens, accents and the rest of the
  // marks the saver deletes all disappear, so "O'Hara", "O-Hara" and "OHara"
  // are the same string. Check all matches on this, not on spaced words.
  function compactName(raw) {
    return String(raw || '').normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // The saver deletes a mark and glues the letters: "o" + "hara" becomes
  // "ohara" on disk. Indexing the joins means a file named OHara can still
  // find the catalogue row that still says O'Hara.
  function gluedTokens(words) {
    const tokens = new Set(words || []);
    const list = Array.from(tokens);
    for (let i = 0; i < list.length - 1; i++) tokens.add(list[i] + list[i + 1]);
    return tokens;
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

  // There are exactly two reasons to index: you have none, or the site has grown
  // since you took the last one. Either way it replaces what was there, so there
  // is nothing to name, nothing to keep and nothing to choose between.
  async function startIndexing() {
    if (state.busy) { logLine('Wait for the current run to finish, or press Stop.'); return; }
    state.cancel = false;
    state.indexing = true;
    setBusy(true);
    resetLog();
    renderFooterButtons();
    setModelDisplay('Site index');
    setSetDisplay('0 sets');
    setAlbumDisplay('Photosets');
    setFileDisplay('0 scenes');

    try {
      const log = await buildSiteIndexLog();
      if (state.cancel) throw cancelledError();
      await saveIndexLog(log);
      await refreshSiteIndex();
      scheduleAdvancedSearch();
      logLine(`Indexed: ${log.summary.setCount} sets, ${log.summary.modelCount} models.`);
    } catch (err) {
      if (errorMessage(err) === 'cancelled') logLine('Stopped. Nothing was saved; the last index is untouched.');
      else logLine(`Index failed: ${errorMessage(err)}`);
    } finally {
      state.indexing = false;
      setBusy(false);
      renderFooterButtons();
    }
  }

  // Forget what the site holds. Downloads survive it — they are a record of what
  // you have rather than of what is out there — but with no denominator the
  // completion figures go, and a model's card can no longer be judged complete
  // until the site is indexed again.
  async function clearIndex() {
    if (state.busy || state.checking) { logLine('Wait for the current run to finish.'); return; }
    if (!haveIndex()) { logLine('There is no index to clear.'); return; }
    const sets = state.index.sets.length;
    if (!confirm(`Clear the index of ${sets} set${sets === 1 ? '' : 's'}?\n\n`
      + 'Your downloads are kept. Searching and the completion figures stop working until you index again.')) return;
    await clearIndexStore();
    await refreshSiteIndex();
    clearSearchResults(false);
    showSearchMessage(searchIdleMessage());
    logLine('Index cleared.');
  }

  // Forget every download, for the whole site, in one go. The download status of
  // every set and every model is the only record of what you have, so emptying
  // both is the whole reset: nothing counts as had, nothing is hidden, and
  // everything can be downloaded again.
  //
  // The index deliberately survives it. It describes what the site holds rather
  // than what you have taken off it, it costs a long crawl, and it would be
  // identical if rebuilt — so throwing it away here would be a tax on changing
  // your mind. Clear index, next to this, is the button for that.
  function resetDownloads() {
    if (state.busy) { logLine('Wait for the current run to finish, or press Stop.'); return; }
    if (state.checking) { logLine('Wait for the folder check to finish.'); return; }
    const sets = state.setDownloadStatus.size;
    const models = state.modelDownloadStatus.size;
    if (!sets && !models) { logLine('Nothing downloaded is on record; there is nothing to reset.'); return; }

    if (!confirm(`Forget ${sets} downloaded set${sets === 1 ? '' : 's'}`
      + `${models ? ` and ${models} completed model${models === 1 ? '' : 's'}` : ''}?\n\n`
      + 'Every set and model on the site comes back into view and can be downloaded again. '
      + 'The index is kept. This cannot be undone.')) return;

    state.setDownloadStatus = new Map();
    state.modelDownloadStatus = new Map();
    saveAdvancedState();
    // Hiding is read straight off those two maps, so the page has to be
    // re-judged, the figures restated and any results on screen redrawn.
    scheduleCardRefresh();
    renderStats();
    scheduleAdvancedSearch();
    setFootNote('');
    logLine(`Reset: ${sets} set${sets === 1 ? '' : 's'} forgotten`
      + `${models ? `, ${models} model${models === 1 ? '' : 's'} no longer complete` : ''}.`);
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

  // The index is one document, not a collection. There is exactly one site and
  // one snapshot of it worth holding: you index when you install the script or
  // after clearing it, and you index again when the site has grown. So it is
  // stored under a fixed key and every save replaces the last one — no import,
  // no export, no list, nothing to reconcile.
  const INDEX_LOG_ID = 'site-index';

  function openIndexDb() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available in this browser'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(INDEX_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(INDEX_DB_STORE)) {
          db.createObjectStore(INDEX_DB_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('could not open browser index storage'));
    });
  }

  async function saveIndexLog(log) {
    if (!log || typeof log !== 'object') throw new Error('index is empty');
    log.id = INDEX_LOG_ID;
    const db = await openIndexDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEX_DB_STORE, 'readwrite');
      const store = tx.objectStore(INDEX_DB_STORE);
      // Cleared first, because an older build wrote one record per run and they
      // would otherwise sit there forever taking up room nothing reads.
      store.clear();
      store.put(log);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('could not save the index')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('saving the index was aborted')); };
    });
  }

  // The newest record in the store, whatever it is called. Reading by key alone
  // would miss a library indexed by an older build, which is the one case where
  // somebody has an index worth keeping and no way to know it was not found.
  function readIndexLog() {
    return openIndexDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(INDEX_DB_STORE, 'readonly');
      const request = tx.objectStore(INDEX_DB_STORE).getAll();
      request.onsuccess = () => {
        const logs = (request.result || []).filter(Boolean);
        logs.sort((x, y) => String(y.generatedAt || '').localeCompare(String(x.generatedAt || '')));
        resolve(logs[0] || null);
      };
      request.onerror = () => reject(request.error || new Error('could not read the index'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
      tx.onabort = () => db.close();
    })).catch(() => null);
  }

  async function clearIndexStore() {
    const db = await openIndexDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(INDEX_DB_STORE, 'readwrite');
      tx.objectStore(INDEX_DB_STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('could not clear the index')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('clearing the index was aborted')); };
    });
  }

  // --- the index, in memory --------------------------------------------------
  //
  // Read once at boot and rebuilt only when the stored index changes. Everything
  // downstream — the card hiding, the lookup, the completion figures, Check all
  // — reads this rather than going back to the database, so all four are always
  // describing the same snapshot.

  function buildIndexView(log) {
    if (!log) return null;
    const sets = (log.sets || []).filter(Boolean);
    const models = (log.models || []).filter(Boolean);
    const setsById = new Map();
    const modelsById = new Map();
    const modelSets = new Map();

    sets.forEach(set => {
      const setId = String(set.id || '');
      if (!setId) return;
      setsById.set(setId, set);
      (set.models || []).forEach(model => {
        const modelId = String(model && model.id || '');
        if (!modelId) return;
        if (!modelSets.has(modelId)) modelSets.set(modelId, new Set());
        modelSets.get(modelId).add(setId);
        // A model named only on a set she is in is still a model. Backfilled
        // here so the lookup can find her and her card can be judged.
        if (!modelsById.has(modelId)) modelsById.set(modelId, Object.assign({}, model, blankModelStats()));
      });
    });
    models.forEach(model => {
      const id = String(model.id || '');
      if (id) modelsById.set(id, model);
    });

    return {
      at: String(log.generatedAt || ''),
      sets,
      models: Array.from(modelsById.values()),
      setsById,
      modelsById,
      modelSets
    };
  }

  function loadSiteIndex() {
    if (state.indexLoading) return state.indexLoading;
    state.indexLoading = readIndexLog()
      .then(log => { state.index = buildIndexView(log); return state.index; })
      .catch(() => { state.index = null; return null; })
      .finally(() => { state.indexLoading = null; });
    return state.indexLoading;
  }

  // Anything that replaces or clears the stored index re-reads it, then asks the
  // page and the footer to restate themselves.
  function refreshSiteIndex() {
    return loadSiteIndex().then(() => {
      scheduleCardRefresh();
      renderStats();
      return state.index;
    });
  }

  function haveIndex() {
    return !!(state.index && state.index.sets.length);
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
    if (filters.yearError) {
      showSearchMessage(filters.yearError);
      clearSearchResults(false);
      return;
    }
    if (!searchHasInput(filters)) {
      showSearchMessage('Enter a name or set a filter.');
      clearSearchResults(false);
      return;
    }
    await loadSiteIndex();
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
    if (ui.searchType) ui.searchType.value = '';
    if (ui.searchYears) ui.searchYears.value = '';
    showSearchMessage(searchIdleMessage());
    clearSearchResults(false);
  }

  function searchIdleMessage() {
    return haveIndex() ? 'Search for a model, or drop a link.' : 'Index the site to search it.';
  }

  // How much of this item you have. One shape for models and sets alike, so the
  // row, the badge and the Have filter all read the same three fields.
  function stampFocusedItem(kind, item) {
    if (kind === 'model') {
      const sets = modelSetIds(item.id);
      item.setCount = sets.length || item.setCount || 0;
      item.haveCount = sets.filter(setIsHad).length;
      item.have = modelIsHad(item.id) ? 'yes' : (item.haveCount ? 'part' : 'no');
    } else {
      item.setCount = 1;
      item.haveCount = setIsHad(item.id) ? 1 : 0;
      item.have = item.haveCount ? 'yes' : 'no';
    }
    item.hidden = item.have === 'yes';
    return item;
  }

  function focusedModelResult(target, score) {
    const known = state.index && state.index.modelsById.get(String(target.id));
    const item = known ? normalizeSearchModel(known) : fallbackSearchModel(target);
    stampFocusedItem('model', item);
    return { kind: 'model', score: score || 999, item };
  }

  function focusedSetResult(target, score) {
    const known = state.index && state.index.setsById.get(String(target.id));
    const item = known ? normalizeSearchSet(known) : fallbackSearchSet(target);
    stampFocusedItem('set', item);
    return { kind: 'set', score: score || 999, item };
  }

  async function modelsForDroppedSet(target) {
    const indexed = state.index && state.index.setsById.get(String(target.id));
    if (indexed) {
      return (indexed.models || []).map(model => ({
        kind: 'model',
        id: String(model && model.id || ''),
        slug: String(model && model.slug || ''),
        name: String(model && model.name || '')
      })).filter(model => /^\d+$/.test(model.id));
    }
    try {
      return await resolveAlbumToModels(target);
    } catch {
      return [];
    }
  }

  async function focusAdvancedDropTargets(targets) {
    const incoming = (targets || []).filter(Boolean);
    if (!incoming.length || !ui.searchResults) return;
    clearTimeout(state.searchTimer);
    if (ui.searchQuery) ui.searchQuery.value = '';
    await loadSiteIndex();

    const results = [];
    const seen = new Set();

    // Search and drop both land on models, never on sets. A set link resolves to
    // whoever is in it, so a roundup in _Various still surfaces the women whose
    // libraries you would actually take.
    const pushModel = modelTarget => {
      const modelKey = `model:${modelTarget.id}`;
      if (!modelTarget || !modelTarget.id || seen.has(modelKey)) return;
      seen.add(modelKey);
      results.push(focusedModelResult(modelTarget, 999));
    };

    for (const target of incoming) {
      if (target.kind === 'model') {
        pushModel(target);
        continue;
      }
      const setModels = await modelsForDroppedSet(target);
      setModels.forEach(pushModel);
    }

    renderFocusedSearchResults(results);
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
    const years = parseYearList(ui.searchYears && ui.searchYears.value);
    return {
      query: String(ui.searchQuery && ui.searchQuery.value || '').trim(),
      type: String(ui.searchType && ui.searchType.value || ''),
      years: years.ranges,
      yearError: years.error
    };
  }

  function searchHasInput(filters) {
    return !!(filters.query || filters.type || (filters.years && filters.years.length) || filters.yearError);
  }

  // One box, a list of years and ranges: `2019`, `2019-2021`, `2019, 2021-2023`.
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

  function searchIndex(filters) {
    const queryWords = bareWords(filters.query).split(' ').filter(Boolean);
    const results = [];
    if (!state.index) return results;

    state.index.models.forEach(model => {
      const item = normalizeSearchModel(model);
      stampFocusedItem('model', item);
      if (!searchItemMatches(item, queryWords, filters)) return;
      results.push({ kind: 'model', score: searchScore(item, queryWords), item });
    });

    return results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dateCompare = String(b.item.dateEnd || b.item.date || '').localeCompare(String(a.item.dateEnd || a.item.date || ''));
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

  function normalizeSearchSet(set) {
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
      categories: searchSetCategories(set),
      modelNames: models,
      modelIds,
      slug: String(set && set.slug || ''),
      nobodySet: set && typeof set.nobodySet === 'boolean'
        ? !!set.nobodySet
        : setBelongsToNobody(set && set.title, models),
      text: `${set && set.title || ''} ${set && set.slug || ''} ${models.join(' ')} ${categorySearchText(searchSetCategories(set))}`
    };
  }

  function searchSetCategories(set) {
    const out = [];
    (set && set.categories || []).forEach(category => out.push(category));
    (set && set.models || []).forEach(model => {
      (model && model.categories || []).forEach(category => out.push(category));
      const full = state.index && state.index.modelsById.get(String(model && model.id || ''));
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
    if (!itemMatchesYears(item, filters.years)) return false;
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
    row.className = 'pb-result';
    // "Hidden" here is a statement about the site, not about this list: the row
    // stays so you can still find and re-download what you already have.
    row.classList.toggle('pb-resultHidden', !!item.hidden);
    row.dataset.kind = result.kind;
    row.dataset.id = item.id;
    row.dataset.title = item.title || '';
    row.dataset.slug = item.slug || '';
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
    badges.appendChild(resultBadge(haveLabel(result.kind, item),
      item.have === 'yes' ? 'pb-badgeFull' : item.have === 'part' ? 'pb-badgePart' : ''));

    const counts = [
      item.date || (item.dateStart && item.dateEnd ? `${item.dateStart} to ${item.dateEnd}` : ''),
      result.kind === 'model' ? `${item.setCount} set${item.setCount === 1 ? '' : 's'}` : '',
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
    // One button, because there is one thing to do with a row: take everything
    // it holds. The status beside it is written by runs and by Check all, and
    // there is nothing here that says it by hand.
    actions.appendChild(resultActionButton('Download', 'download'));

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

  // What you have of this, said the way the thing itself is counted. A model is
  // a library you are working through, so hers is a fraction; a set is one thing
  // you either have or do not.
  function haveLabel(kind, item) {
    if (kind !== 'model') return item.have === 'yes' ? 'Downloaded' : 'Not downloaded';
    if (!item.setCount) return 'No sets known';
    if (item.have === 'yes') return `All ${item.setCount} set${item.setCount === 1 ? '' : 's'}`;
    return `${item.haveCount} of ${item.setCount} sets`;
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

    if (action === 'download') startSearchDownload(kind, id, title, slug);
  }

  async function startSearchDownload(kind, id, title, slug) {
    if (state.busy) { logLine('Wait for the current run to finish, or press Stop.'); return; }
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
      const message = errorMessage(err);
      if (message === 'cancelled') logLine('Cancelled.');
      else if (err && err.had) logLine('You already have this set.');
      else logLine(`Set failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  // --- checking a whole download folder against the site ---------------------
  //
  // Point this at the folder your PB+ downloads live in — the whole
  // `PlayboyPlus` folder, model folders and all — and that folder becomes the
  // whole download record. What matches is downloaded. What does not is not.
  // An empty folder therefore means you have nothing.
  //
  // It needs an index log to name the files it finds, because a folder name says
  // what a gallery is called and not what its id is. An empty folder has nothing
  // to name, so it can clear the record without one.

  async function checkDownloadFolder(files) {
    if (state.checking) { showSearchMessage('A check is already running.'); return; }
    const list = Array.from(files || []);

    state.checking = true;
    setCheckButton(true);
    // It reports in the footer, beside the button that started it, rather than
    // in the results list — which is not what this is about.
    const say = setFootNote;
    try {
      say('Reading the selected folder.');
      await loadSiteIndex();
      const candidates = buildDownloadImportCandidates(list);
      if (candidates.length && !haveIndex()) {
        say('Index the site before checking a download folder.');
        return;
      }

      const matched = (candidates.length && haveIndex())
        ? matchSetsToCandidates(state.index.sets, candidates)
        : [];
      // The folder is the record. Model completeness is read off the sets, so a
      // leftover "this model is done" stamp from an old run has to go with them.
      state.setDownloadStatus = new Map();
      matched.forEach(id => state.setDownloadStatus.set(String(id), 'full'));
      state.modelDownloadStatus = new Map();
      saveAdvancedState();
      scheduleCardRefresh();
      renderStats();
      scheduleAdvancedSearch();

      const total = haveIndex() ? state.index.sets.length : 0;
      const after = computeCompletion();
      if (!list.length || !candidates.length) {
        say(total
          ? `That folder was empty. Download record replaced: 0 of ${total} sets.`
          : 'That folder was empty. Download record cleared.');
        return;
      }
      say(`Download record replaced: ${matched.length} of ${total} sets on disk`
        + (after ? `, ${after.modelsDone} of ${after.modelsTotal} models complete` : '')
        + (matched.length ? '.' : '. Archives should be named like "241114-Mirra Jean - Really Out of Jeans".'));
    } catch (err) {
      say(`Folder check failed: ${errorMessage(err)}`);
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

  // Every path segment in the picked tree, not just the file names: an archive
  // still zipped is a file called `<name>.zip`, and one that has been unpacked
  // is a folder called `<name>` with the photos inside it. Both count as having
  // it.
  function buildDownloadImportCandidates(files) {
    const seen = new Set();
    const out = [];
    Array.from(files || []).forEach(file => {
      const rawPath = String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/');
      rawPath.split('/').filter(Boolean).forEach(segment => {
        const stripped = segment.replace(/\.[A-Za-z0-9]{2,5}$/i, '');
        const compact = compactName(stripped);
        if (!compact || seen.has(compact)) return;
        seen.add(compact);
        const text = fileNameMatchText(stripped) || bareWords(stripped);
        out.push({ text, compact, words: text.split(' ').filter(Boolean) });
      });
    });
    return out;
  }

  // Matching is on the name the downloader would have written. Marks the saver
  // deletes — apostrophes, accents, ampersands — are ignored: both sides are
  // reduced to letters and digits, so "O'Hara" in the catalogue still matches
  // a file named OHara.
  //
  // Two passes, strict first. Containment is the certain case and claims its
  // gallery outright; only what is left over is scored word by word, which is
  // what catches a title the 56-character cap truncated on its way to disk. A
  // gallery already claimed is never handed to a second folder, so two sets with
  // near-identical names cannot both be matched by one of them.
  const CHECK_MIN_WORDS = 3;
  const CHECK_MIN_COMPACT = 8;
  const CHECK_MIN_SCORE = 0.8;
  // A folder full of photos is tens of thousands of names, and the catalogue is
  // twenty thousand galleries, so no name may be compared against all of them.
  // Each one is narrowed through the few of its words that are rare enough to
  // narrow anything: a word thousands of galleries share is not a clue, it is a
  // scan.
  const CHECK_MAX_POSTINGS = 400;
  const CHECK_PROBE_WORDS = 4;

  // The galleries worth comparing this name against, and nothing else.
  function candidateSetPool(candidate, byWord) {
    const pool = new Set();
    Array.from(gluedTokens(candidate.words))
      .map(word => byWord.get(word) || [])
      .filter(list => list.length && list.length <= CHECK_MAX_POSTINGS)
      .sort((a, b) => a.length - b.length)
      .slice(0, CHECK_PROBE_WORDS)
      .forEach(list => list.forEach(index => pool.add(index)));
    return pool;
  }

  function setArchiveNameVariants(set) {
    const id = String(set && set.id || '');
    const date = String(set && set.dateProduced || '');
    const title = String(set && set.title || '');
    const names = (set && set.models || []).map(model => String(model && model.name || '')).filter(Boolean);
    const nobody = set && typeof set.nobodySet === 'boolean'
      ? !!set.nobodySet
      : setBelongsToNobody(title, names);
    const variants = [];
    const push = album => {
      const base = archiveBaseName(album);
      const text = fileNameMatchText(base);
      const compact = compactName(base);
      if (!compact || variants.some(variant => variant.compact === compact)) return;
      variants.push({ text, compact, words: text.split(' ').filter(Boolean) });
    };
    // How it would be saved today, then both older shapes: filed under _Various
    // as date-and-title, and filed under the models as date-models-title. Check
    // all has to recognise a roundup whichever of those three it landed as.
    push({ id, date, title, models: names, nobodys: nobody });
    push({ id, date, title, models: names, nobodys: true });
    if (names.length) push({ id, date, title, models: names, nobodys: false });
    return variants;
  }

  function variantMinWords(variant) {
    // A Various archive is often `YYMMDD - Title`, and a short title is two
    // words with the date. Three would leave those behind.
    if (variant.words.some(word => /^\d{6}$/.test(word))) return 2;
    return CHECK_MIN_WORDS;
  }

  function gluedWordHits(expectedWords, diskTokens) {
    let hits = 0;
    for (let i = 0; i < expectedWords.length; ) {
      if (diskTokens.has(expectedWords[i])) { hits++; i++; continue; }
      if (i + 1 < expectedWords.length && diskTokens.has(expectedWords[i] + expectedWords[i + 1])) {
        hits += 2;
        i += 2;
        continue;
      }
      i++;
    }
    return hits;
  }

  function matchSetsToCandidates(sets, candidates) {
    const entries = [];
    const byWord = new Map();
    (sets || []).forEach(set => {
      const id = String(set && set.id || '');
      if (!id) return;
      const variants = setArchiveNameVariants(set).filter(variant => variant.compact);
      if (!variants.length) return;
      const index = entries.length;
      entries.push({ id, variants, taken: false });
      variants.forEach(variant => {
        gluedTokens(variant.words).forEach(word => {
          if (!byWord.has(word)) byWord.set(word, []);
          byWord.get(word).push(index);
        });
      });
    });

    const matched = [];
    const leftover = [];
    const claim = entry => { entry.taken = true; matched.push(entry.id); };

    candidates.forEach(candidate => {
      if (!candidate.compact || candidate.compact.length < CHECK_MIN_COMPACT) return;
      // The longest containing name wins, so a gallery whose name is another
      // gallery's name plus a word is not lost to the shorter of the two.
      let best = null;
      let bestLength = 0;
      candidateSetPool(candidate, byWord).forEach(index => {
        const entry = entries[index];
        if (entry.taken) return;
        entry.variants.forEach(variant => {
          if (variant.compact.length < CHECK_MIN_COMPACT) return;
          if (!candidate.compact.includes(variant.compact)) return;
          if (!best || variant.compact.length > bestLength) {
            best = entry;
            bestLength = variant.compact.length;
          }
        });
      });
      if (best) { claim(best); return; }
      leftover.push(candidate);
    });

    leftover.forEach(candidate => {
      const own = gluedTokens(candidate.words);
      let best = null;
      let bestScore = 0;
      candidateSetPool(candidate, byWord).forEach(index => {
        const entry = entries[index];
        if (entry.taken) return;
        entry.variants.forEach(variant => {
          const need = variantMinWords(variant);
          const hits = gluedWordHits(variant.words, own);
          if (hits < need) return;
          const score = hits / Math.max(1, variant.words.length);
          if (score < CHECK_MIN_SCORE || score <= bestScore) return;
          best = entry;
          bestScore = score;
        });
      });
      if (best) claim(best);
    });

    return matched;
  }

  function formatCount(value) {
    const number = Number(value) || 0;
    if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
    return String(number);
  }

  function loadAdvancedState() {
    let raw = '';
    try { raw = localStorage.getItem(ADVANCED_STATE_KEY) || ''; } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      state.modelDownloadStatus = mapFromStatusObject(parsed.modelDownloadStatus);
      state.setDownloadStatus = mapFromStatusObject(parsed.setDownloadStatus);
      // Four things an older document may carry are deliberately dropped, and
      // for the same reason each time — the thing they described is gone:
      //   hiddenModels / hiddenSets / hideVariousSets / hideVideoOnlySets —
      //     hiding is downloading now, and a stale hand-made list would keep
      //     cards away for a reason nothing on screen could explain;
      //   setDownloadKinds — there are no file kinds; a gallery is taken whole;
      //   skipVariousDownloads / skipVideosDownloads — nothing is skipped for
      //     what it is any more, only for already being had.
      // A stored 'partial' is dropped by mapFromStatusObject on its way in, so
      // a half-taken gallery reads as not downloaded and gets taken properly.
      // Written back immediately so those leftover keys cannot sit around for a
      // later version to read and start skipping files again.
      saveAdvancedState();
    } catch {}
  }

  function saveAdvancedState() {
    const out = {
      modelDownloadStatus: statusObjectFromMap(state.modelDownloadStatus),
      setDownloadStatus: statusObjectFromMap(state.setDownloadStatus)
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

  // Download status is the whole of what hiding is made of, so every write of it
  // asks the page to re-judge its cards.
  function setDownloadState(kind, id, status) {
    const normalized = DOWNLOAD_STATUSES.indexOf(status) >= 0 ? status : 'not';
    const target = kind === 'model' ? state.modelDownloadStatus : state.setDownloadStatus;
    if (normalized === 'not') target.delete(String(id));
    else target.set(String(id), normalized);
    saveAdvancedState();
    scheduleCardRefresh();
    scheduleAdvancedSearch();
  }

  function downloadStatus(kind, id) {
    const target = kind === 'model' ? state.modelDownloadStatus : state.setDownloadStatus;
    return target.get(String(id)) || 'not';
  }

  // --- the completion tracker ------------------------------------------------
  //
  // "412 sets downloaded" means nothing without a denominator, and the
  // denominator is the index. It sits next to the Index button because that is
  // the thing it is a readout of: no index, no figures.
  //
  // A model with no sets in the index is left out of the model denominator
  // rather than counted as forever incomplete, which would put 100% out of
  // reach.
  function computeCompletion() {
    if (!haveIndex()) return null;
    const setsTotal = state.index.sets.length;
    let setsDone = 0;
    state.index.sets.forEach(set => { if (setIsHad(set.id)) setsDone++; });

    let modelsTotal = 0;
    let modelsDone = 0;
    let modelsStarted = 0;
    state.index.modelSets.forEach(sets => {
      if (!sets.size) return;
      modelsTotal++;
      let done = 0;
      sets.forEach(setId => { if (setIsHad(setId)) done++; });
      if (done === sets.size) modelsDone++;
      else if (done) modelsStarted++;
    });
    return { setsDone, setsTotal, modelsDone, modelsStarted, modelsTotal, at: state.index.at };
  }

  function renderStats() {
    const stats = computeCompletion();
    if (ui.stats) {
      if (!stats) {
        ui.stats.textContent = 'No index yet';
        ui.stats.title = 'Index the site to learn how many sets and models there are.';
      } else {
        const pct = stats.setsTotal ? Math.floor((stats.setsDone / stats.setsTotal) * 100) : 0;
        ui.stats.textContent = `Sets ${stats.setsDone}/${stats.setsTotal} (${pct}%) · Models ${stats.modelsDone}/${stats.modelsTotal}`;
        ui.stats.title = [
          `${stats.setsDone} of ${stats.setsTotal} sets downloaded.`,
          `${stats.modelsDone} models complete, ${stats.modelsStarted} partly done, of ${stats.modelsTotal}.`,
          stats.at ? `Indexed ${new Date(stats.at).toLocaleDateString()}.` : ''
        ].filter(Boolean).join('\n');
      }
    }
    renderFooterButtons();
  }

  // The two destructive buttons only exist when there is something to destroy.
  function renderFooterButtons() {
    const downloads = state.setDownloadStatus.size + state.modelDownloadStatus.size;
    if (ui.index) ui.index.textContent = state.indexing ? 'Stop' : (haveIndex() ? 'Re-index site' : 'Index site');
    if (ui.clearIndex) ui.clearIndex.hidden = !haveIndex();
    if (ui.clearDownloads) ui.clearDownloads.hidden = !downloads;
    if (ui.check) ui.check.textContent = state.checking ? 'Checking…' : 'Check all';
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
    // A folder check runs without setting busy, so a download finishing while one
    // is in the air must not hand its button back.
    if (state.checking) setCheckButton(true);
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
  loadAdvancedState();
  installEarlyObserver();
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
