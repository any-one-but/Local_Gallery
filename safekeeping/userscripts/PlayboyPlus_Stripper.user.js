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
//      clip id of the bonus video. This is where the queue and the model
//      expansion come from, and it is why a listing of any size can be queued
//      without the thousand page fetches Zishy needed.
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
  const PAGE_DELAY_MS = 250;     // between catalogue queries
  const ALBUM_DELAY_MS = 400;    // between galleries in a queue run
  const FILE_DELAY_MS = 40;      // between photo fetches within one lane
  const IMAGE_CONCURRENCY = 6;

  // A gallery's photos can be had two ways, and the difference is not small.
  //
  // One at a time is forty requests, and each one is a round trip through the
  // userscript extension's own plumbing rather than a plain browser request,
  // because the media host does not invite other sites to read its files. That
  // detour costs far more than the bytes do, and it is paid forty times.
  //
  // The site also builds the whole gallery as a single zip — it is what its own
  // Download Photos button hands you — and that is one request for all of it.
  // Same pictures, one detour instead of forty. So that is tried first, and the
  // one-at-a-time path is what happens when it is not on offer or does not
  // answer.
  //
  // It has a second benefit, which is that the zip is where the erotic/explicit
  // folders actually live, so flattening them is the same job either way.
  const USE_SITE_ZIP = true;
  // A zip the server has not built yet answers 503. One wait and one retry, then
  // fall back rather than sit there.
  const SITE_ZIP_RETRY_MS = 3000;

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

  // Per-tab only, and deliberately not GM storage: gathering links here is a full
  // page load every time, so an in-memory queue would evaporate the moment you
  // went looking for the next gallery. sessionStorage survives those loads and
  // dies with the tab, so nothing is left on disk.
  const QUEUE_KEY = 'PlayboyStripper.queue.v1';
  const FILTER_KEY = 'PlayboyStripper.filter.v1';
  const FORCE_KEY = 'PlayboyStripper.force.v1';
  const LINKMODE_KEY = 'PlayboyStripper.linkmode.v1';
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
  // type an instant answer rather than a lookup per card. Kept on disk beside the
  // history because it describes the site rather than anything you did, and
  // re-read after a week in case somebody has been recategorised.
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
  // comes back faster and a stopped listing read loses less.
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
    compilations: 'include',
    hiddenTypes: new Set(),
    actorTypes: null,
    actorTypesAt: 0,
    actorTypesLoading: null,
    setTypes: new Map(),
    cdnTransport: '',
    typeLookupWanted: new Set(),
    typeLookupRunning: false,
    force: false,
    history: new Map(),
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

  function applyDownloadedHideStyle() {
    downloadedStyleEl = document.createElement('style');
    downloadedStyleEl.id = 'playboyStripperDownloadedRules';
    downloadedStyleEl.textContent = '.pbGot { display: none !important; }';
    (document.head || document.documentElement).appendChild(downloadedStyleEl);
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
  //
  // Galleries only. Calling a model "had" would mean knowing every set she has,
  // which is a reading of the whole catalogue — and this site is far too big for
  // that to be worth doing on the chance it hides a card.
  function targetIsHad(target) {
    if (!HIDE_DOWNLOADED || !target || target.kind !== 'album') return false;
    return historySatisfies(target.id, state.fileFilter);
  }

  // Two reasons a link goes: you have it already, or it is a kind of model you
  // turned off. The type answer can be "not yet", and not-yet means leave it
  // alone — a card that appears and then vanishes reads worse than one that takes
  // a moment to go.
  function linkShouldHide(target) {
    if (!target) return false;
    if (targetIsHad(target)) return true;
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

  // Re-tests the whole page. The answer changes underneath the cards whenever a
  // download completes, the history is cleared, or the file-kind cycler moves
  // and redefines what "had" means.
  //
  // It is a full pass rather than an incremental one because the climb needs a
  // settled DOM: mid-render, a grid that will hold thirty entries holds one, and
  // an incremental mark would climb straight past the card and hide the grid.
  function refreshDownloadedCards() {
    if (!document.body) return;
    Array.from(document.querySelectorAll('.pbGot')).forEach(el => el.classList.remove('pbGot'));
    Array.from(document.querySelectorAll('a[href]')).forEach(anchor => {
      const target = linkTarget(anchor);
      if (!linkShouldHide(target)) return;
      cardForAnchor(anchor).classList.add('pbGot');
    });
    updateEyeButton();
  }

  // The one entry point everything uses to ask for a re-test, so a type lookup
  // landing and the page rebuilding its own grid cannot each start their own.
  let cardRefreshTimer = 0;
  function scheduleCardRefresh() {
    clearTimeout(cardRefreshTimer);
    cardRefreshTimer = setTimeout(refreshDownloadedCards, 120);
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
      ? `Reveal hidden page elements${hiddenCards ? ` and ${hiddenCards} hidden card${hiddenCards === 1 ? '' : 's'}` : ''}`
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
          <button id="pbCompilations" class="pb-cycle pb-cycleWide" type="button" title="Roundups, reviews, event coverage and mashups: sets with several models on them and none of them named in the title. Skipping leaves every set that is actually somebody's, including joint sets with two or three models in it.">Compilations: Include</button>
        </div>
        <div class="pb-typesHead">Showing</div>
        <div id="pbTypes" class="pb-types">
          ${MODEL_TYPES.map(type => `<button class="pb-typeChip" type="button" data-type="${type.slug}" data-label="${type.label}" aria-pressed="true">${type.label}</button>`).join('')}
        </div>
        <div class="pb-progress"><div id="pbFill"></div></div>
        <div class="pb-meta">
          <span id="pbAlbum">No gallery</span>
          <span id="pbCount">0 photos</span>
        </div>
        <div id="pbDrop" class="pb-drop" title="Gallery and model links to queue them. A history file to import it.">Drop gallery links here</div>
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
        </div>
        <div class="pb-histBtns">
          <button id="pbHistImport" class="pb-miniBtn" type="button" title="Read a history file and fold it into this one. Nothing already here is lost — the two are merged.">Import</button>
          <button id="pbHistExport" class="pb-miniBtn" type="button" title="Write everything downloaded so far to a file, to carry to another browser or keep as a backup">Export</button>
          <button id="pbHistClear" class="pb-miniBtn" type="button" title="Forget every gallery already downloaded">Clear</button>
        </div>
        <input id="pbHistFile" type="file" accept="application/json,.json" hidden>
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
    ui.compilations = panel.querySelector('#pbCompilations');
    ui.types = panel.querySelector('#pbTypes');
    ui.histCount = panel.querySelector('#pbHistCount');
    ui.histClear = panel.querySelector('#pbHistClear');
    ui.histImport = panel.querySelector('#pbHistImport');
    ui.histExport = panel.querySelector('#pbHistExport');
    ui.histFile = panel.querySelector('#pbHistFile');

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
    ui.compilations.addEventListener('click', () => {
      setCompilationMode(state.compilations === 'skip' ? 'include' : 'skip');
      logLine(state.compilations === 'skip'
        ? 'Compilations will be skipped: sets with several models and none of them named in the title.'
        : 'Compilations will be downloaded like anything else.');
    });
    ui.histClear.addEventListener('click', clearHistory);
    ui.histExport.addEventListener('click', exportHistory);
    // The picker cannot be opened from script without a click of its own, so the
    // button borrows one from the hidden input.
    ui.histImport.addEventListener('click', () => ui.histFile.click());
    ui.histFile.addEventListener('change', () => {
      const file = ui.histFile.files && ui.histFile.files[0];
      // Cleared first, or picking the same file twice in a row fires nothing the
      // second time.
      ui.histFile.value = '';
      if (file) importHistoryFile(file);
    });
    Array.from(ui.types.querySelectorAll('.pb-typeChip')).forEach(chip => {
      chip.addEventListener('click', () => {
        const slug = chip.getAttribute('data-type');
        const label = chip.getAttribute('data-label') || slug;
        toggleHiddenType(slug);
        logLine(typeIsHidden(slug)
          ? `Hiding ${label}: her card, her galleries, and any set she is in.`
          : `Showing ${label} again.`);
        // Turning one off is the moment the model table is first needed, and a
        // re-test has to wait for it or every card would read as untyped.
        if (anyTypeHidden()) ensureActorTypes().then(scheduleCardRefresh);
        else scheduleCardRefresh();
        renderQueue();
      });
    });
    installDropTarget(panel);
    makePanelDraggable(panel, panel.querySelector('.pb-head'));
    panel.querySelector('#pbCollapse').addEventListener('click', () => {
      panel.classList.toggle('pb-collapsed');
      panel.querySelector('#pbCollapse').innerHTML = panel.classList.contains('pb-collapsed') ? '&#9662;' : '&#9652;';
    });

    // The history and the file filter were already read at document-start so the
    // card observer could use them; only the toggles the observer does not need
    // are loaded here.
    setFileFilter(state.fileFilter);
    loadVideoQuality();
    loadForce();
    loadLinkMode();
    loadCompilationMode();
    loadHiddenTypes();
    if (anyTypeHidden()) ensureActorTypes().then(scheduleCardRefresh);
    setHidden(true);
    installRouteObserver();
    installSoftNavigation();
    loadQueue();
    renderHistory();
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
    state.compilations = mode === 'skip' ? 'skip' : 'include';
    if (ui.compilations) {
      ui.compilations.textContent = `Compilations: ${state.compilations === 'skip' ? 'Skip' : 'Include'}`;
      ui.compilations.classList.toggle('pb-compilationsOn', state.compilations === 'skip');
    }
    try { sessionStorage.setItem(COMPILATION_KEY, state.compilations); } catch {}
  }

  function loadCompilationMode() {
    let stored = '';
    try { stored = sessionStorage.getItem(COMPILATION_KEY) || ''; } catch {}
    setCompilationMode(stored);
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

  // Asked of a catalogue record, before anything has been downloaded.
  function isCompilationRecord(record) {
    const names = ((record && record.actors) || []).map(actor => actor && actor.name);
    return setBelongsToNobody(record && record.title, names);
  }

  // Asked of a gallery being saved. The verdict is settled once, in scanAlbum,
  // off the same record the queue judged — so the folder cannot disagree with
  // the skip for want of a comma somewhere in a title.
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
  // off takes that kind out of sight and out of the queue entirely: her own card
  // in a model listing, every gallery of hers, and every gallery link on the page
  // that leads to one.
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
    let stored = '';
    try { stored = sessionStorage.getItem(HIDDEN_TYPES_KEY) || ''; } catch {}
    let slugs = [];
    try { const parsed = JSON.parse(stored || '[]'); if (Array.isArray(parsed)) slugs = parsed; } catch {}
    setHiddenTypes(slugs);
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
          a: (entry.a || []).map(String)
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
      a: (record.actors || []).map(actor => String(actor && actor.actor_id || '')).filter(id2 => /^\d+$/.test(id2))
    });
    saveSetTypesSoon();
  }

  // --- the verdict -----------------------------------------------------------

  function slugsAreHidden(slugs) {
    return (slugs || []).some(typeIsHidden);
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
    if (!anyTypeHidden() || !target) return false;
    if (!state.actorTypes) { ensureActorTypes().then(scheduleCardRefresh); return null; }
    if (target.kind === 'model') return slugsAreHidden(actorTypeSlugs(target.id));
    const entry = state.setTypes.get(String(target.id));
    if (!entry) { wantSetType(target.id); return null; }
    if (slugsAreHidden(entry.c)) return true;
    return entry.a.some(actorId => slugsAreHidden(actorTypeSlugs(actorId)));
  }

  function wantSetType(setId) {
    const id = String(setId);
    if (!/^\d+$/.test(id) || state.setTypes.has(id) || state.typeLookupWanted.has(id)) return;
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
        batch.forEach(id => { if (!answered.has(id)) state.setTypes.set(id, { c: [], a: [] }); });
        saveSetTypesSoon();
        scheduleCardRefresh();
      }
    } finally {
      state.typeLookupRunning = false;
    }
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
        const record = normalizeHistoryRecord(id, parsed[id]);
        if (record) state.history.set(String(id), record);
      });
    } catch {}
  }

  // One reading of a stored record, shared by the file on disk and a file being
  // imported, so a hand-edited or foreign document cannot put anything into the
  // history that the history itself would not have written.
  function normalizeHistoryRecord(id, record) {
    if (!record || typeof record !== 'object') return null;
    if (!/^\d+$/.test(String(id))) return null;
    const flags = sortHistoryFlags(String(record.k || ''));
    if (!flags) return null;
    return { k: flags, t: Number(record.t) || 0, n: String(record.n || '') };
  }

  // Always in the same order, so two records that mean the same thing look the
  // same — which is what lets an import tell a real change from a reshuffle.
  function sortHistoryFlags(raw) {
    const seen = String(raw || '');
    return 'aiv'.split('').filter(flag => seen.indexOf(flag) >= 0).join('');
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
    // The card for what just finished should disappear.
    refreshDownloadedCards();
  }

  function renderHistory() {
    if (!ui.histCount) return;
    const size = state.history.size;
    ui.histCount.textContent = size
      ? `History: ${size} galler${size === 1 ? 'y' : 'ies'}`
      : 'History empty';
    ui.histClear.disabled = !size;
    if (ui.histExport) ui.histExport.disabled = !size;
  }

  // --- carrying the history around ------------------------------------------
  //
  // The history is the one thing here that lives on disk, and it lives on the
  // disk of one browser: a second machine starts from nothing and re-downloads
  // everything, and clearing site data takes it with no warning. So it can be
  // written out and read back.
  //
  // An import merges. It never replaces, because replacing is the one thing you
  // cannot undo and the one thing you would not find out about until the
  // re-downloads started. Two browsers that have each done some of the library
  // can therefore be pointed at each other and both end up knowing everything —
  // and a file imported twice changes nothing the second time. Clear first if a
  // clean replacement is really what you want.
  //
  // Merging a record means the union of what the two say. The mode flags are
  // OR-ed, so a machine that took the images and a machine that took the videos
  // add up to a gallery that is completely downloaded, which is exactly what
  // happened. The date keeps the later of the two, and the title keeps whichever
  // is actually there.

  const HISTORY_FILE_KIND = 'playboyplus-stripper-history';
  const HISTORY_FILE_VERSION = 1;

  function historyToDocument() {
    const galleries = {};
    // Newest first, so the file opens on what you did last rather than on
    // whatever order a Map happened to be in.
    Array.from(state.history.entries())
      .sort((a, b) => (Number(b[1].t) || 0) - (Number(a[1].t) || 0))
      .forEach(([id, record]) => { galleries[id] = { k: record.k, t: record.t, n: record.n }; });
    return {
      kind: HISTORY_FILE_KIND,
      version: HISTORY_FILE_VERSION,
      site: 'playboyplus.com',
      exported: new Date().toISOString(),
      count: state.history.size,
      galleries
    };
  }

  async function exportHistory() {
    const size = state.history.size;
    if (!size) { logLine('Nothing to export; the history is empty.'); return; }
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const name = sanitizeDownloadPathForSave(`${ROOT_FOLDER}/PlayboyPlus history ${stamp}.json`);
    const blob = new Blob([JSON.stringify(historyToDocument(), null, 1)], { type: 'application/json' });
    try {
      await saveBlob(blob, name);
      logLine(`Exported ${size} galler${size === 1 ? 'y' : 'ies'} to ${name}.`);
    } catch (err) {
      logLine(`Export failed: ${errorMessage(err)}`);
    }
  }

  // Two shapes are accepted: the document Export writes, and the bare
  // id-to-record map the browser's own storage holds, so a value copied straight
  // out of it still works. A document that names itself as something else is
  // refused rather than half-read — the Zishy stripper's history is the same bare
  // shape with entirely different ids in it, and merging one into the other would
  // mark hundreds of galleries downloaded that never were.
  function galleriesFromHistoryDocument(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.galleries && typeof parsed.galleries === 'object') {
      if (parsed.kind && parsed.kind !== HISTORY_FILE_KIND) return null;
      return { galleries: parsed.galleries, titled: true };
    }
    if (parsed.kind) return null;
    return { galleries: parsed, titled: false };
  }

  function mergeHistoryRecord(id, incoming) {
    const key = String(id);
    const existing = state.history.get(key);
    if (!existing) { state.history.set(key, incoming); return 'new'; }
    const existingFlags = sortHistoryFlags(existing.k);
    const merged = {
      k: sortHistoryFlags(existingFlags + incoming.k),
      t: Math.max(Number(existing.t) || 0, Number(incoming.t) || 0),
      n: existing.n || incoming.n || ''
    };
    const changed = merged.k !== existingFlags
      || merged.t !== (Number(existing.t) || 0)
      || merged.n !== String(existing.n || '');
    state.history.set(key, merged);
    return changed ? 'updated' : 'same';
  }

  function importHistoryFromText(text, sourceName) {
    const where = sourceName ? ` from ${sourceName}` : '';
    let parsed;
    try {
      parsed = JSON.parse(String(text || ''));
    } catch {
      logLine(`That file${where} is not readable as JSON.`);
      return;
    }
    const found = galleriesFromHistoryDocument(parsed);
    if (!found) {
      logLine(`That file${where} is not a Playboy Plus Stripper history.`);
      return;
    }
    if (!found.titled) logLine('No header on that file; reading it as a bare history.');

    let created = 0;
    let updated = 0;
    let same = 0;
    let ignored = 0;
    Object.keys(found.galleries).forEach(id => {
      const record = normalizeHistoryRecord(id, found.galleries[id]);
      if (!record) { ignored++; return; }
      const outcome = mergeHistoryRecord(id, record);
      if (outcome === 'new') created++;
      else if (outcome === 'updated') updated++;
      else same++;
    });

    if (!created && !updated && !same) {
      logLine(`Nothing in that file${where} looked like a downloaded gallery.`);
      return;
    }
    saveHistory();
    renderHistory();
    renderQueue();
    // Galleries the imported history says are had should disappear from the page
    // straight away, the same as ones this browser downloaded itself.
    refreshDownloadedCards();
    const parts = [`${created} new`];
    if (updated) parts.push(`${updated} updated`);
    if (same) parts.push(`${same} already known`);
    if (ignored) parts.push(`${ignored} unreadable`);
    logLine(`Imported${where}: ${parts.join(', ')}. History now holds ${state.history.size}.`);
  }

  async function importHistoryFile(file) {
    if (!file) return;
    try {
      const text = await readFileText(file);
      importHistoryFromText(text, file.name);
    } catch (err) {
      logLine(`Could not read ${file.name}: ${errorMessage(err)}`);
    }
  }

  // file.text() is the whole job in a current browser; FileReader is there for
  // the ones where it is not.
  function readFileText(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('the file could not be read'));
      reader.readAsText(file);
    });
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
      #playboyStripperPanel .pb-typesHead{color:#8f8471;font-weight:700;font-size:10px;
        letter-spacing:.08em;text-transform:uppercase;margin:-2px 0 -4px}
      #playboyStripperPanel .pb-types{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
      #playboyStripperPanel .pb-typeChip{min-height:24px;padding:0 4px;font-size:10px;border-radius:999px;
        background:rgba(224,196,138,.16);border-color:rgba(224,196,138,.4);color:#f2e6cc;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #playboyStripperPanel .pb-typeChip.pb-typeOff{background:rgba(255,255,255,.03);
        border-color:rgba(255,255,255,.1);color:#6f6555;text-decoration:line-through}
      #playboyStripperPanel .pb-typeChip.pb-typeOff:hover{color:#a2957f}
      #playboyStripperPanel .pb-cycle.pb-forceOn{background:rgba(224,138,122,.2);border-color:rgba(224,138,122,.55);color:#ffd8cf}
      #playboyStripperPanel .pb-cycle.pb-linkModeOn{background:rgba(143,191,154,.18);border-color:rgba(143,191,154,.5);color:#d6f0dc}
      #playboyStripperPanel .pb-cycle.pb-compilationsOn{background:rgba(143,191,154,.18);border-color:rgba(143,191,154,.5);color:#d6f0dc}
      #playboyStripperPanel .pb-cycle.pb-qualityHigh{background:rgba(224,196,138,.28);border-color:rgba(224,196,138,.6);color:#fff1d4}
      #playboyStripperPanel .pb-row.is-willResolve .pb-rowName small{color:#8fbf9a}
      #playboyStripperPanel .pb-histHead{display:flex;align-items:center;gap:6px;color:#c4b79f;font-weight:700}
      #playboyStripperPanel .pb-histHead span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #playboyStripperPanel .pb-histBtns{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
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
  // A drag that starts on a button is not a drag — the eye and the collapse
  // caret live in the title bar and have to stay pressable.

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
      // A dropped file is never a link, so this is asked first rather than
      // after the link reader has failed to find anything in it.
      const history = historyFileFromTransfer(event.dataTransfer);
      if (history) { importHistoryFile(history); return; }
      const targets = targetsFromTransfer(event.dataTransfer);
      if (!targets.length) { logLine('Nothing gallery- or model-shaped in that drop.'); return; }
      reportQueued(addToQueue(targets));
    });
  }

  function historyFileFromTransfer(transfer) {
    const files = transfer && transfer.files ? Array.from(transfer.files) : [];
    return files.find(file => /\.json$/i.test(file.name || '') || file.type === 'application/json') || null;
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
    if (!isListingUrl(location.href)) { logLine('This is not a listing page.'); return; }
    if (state.crawling) return;

    state.crawling = true;
    state.cancel = false;
    ui.addAll.textContent = 'Stop';
    ui.addAll.classList.add('pb-stop');
    let queued = 0;
    let dropped = 0;
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

      // Everything needed to judge a set comes back with it — its models, its
      // title, its category — so both filters happen here rather than queueing
      // sets only to refuse them one query at a time later.
      if (anyTypeHidden()) await ensureActorTypes();
      await algoliaWalk(ALGOLIA_PHOTOSETS, {
        filters: filters || undefined,
        attributesToRetrieve: JSON.stringify(['set_id', 'title', 'url_title', 'actors', 'categories'])
      }, (hits, page, result) => {
        hits.forEach(rememberSetRecord);
        const wanted = hits.filter(hit => !(skippingCompilations() && isCompilationRecord(hit)) && !recordIsHiddenType(hit));
        dropped += hits.length - wanted.length;
        const added = addToQueue(wanted.map(targetFromPhotosetHit));
        queued += added.length;
        logLine(`Page ${page + 1} of ${result.nbPages}: ${added.length} new (${state.queue.length} queued).`);
        return state.queue.length < QUEUE_LIMIT || (logLine('Queue is full; stopping.'), false);
      });
      if (dropped) logLine(`Left out ${dropped} set${dropped === 1 ? '' : 's'} the filters exclude.`);
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
    // Both share state.cancel, so letting the two run at once would let either
    // one abort the other mid-request.
    if (state.crawling) { logLine('Stop the current listing read first.'); return; }
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
        if (recordIsHiddenType(hit)) { dropped++; return; }
        const target = targetFromPhotosetHit(hit);
        if (!found.has(target.id)) found.set(target.id, target);
      });
      logLine(`  page ${page + 1}/${result.nbPages}: ${found.size} set${found.size === 1 ? '' : 's'} so far.`);
      return true;
    });
    if (state.cancel) throw new Error('cancelled');

    if (dropped) logLine(`  left out ${dropped} set${dropped === 1 ? '' : 's'} the filters exclude.`);

    const albums = Array.from(found.values());
    if (!albums.length) {
      const err = new Error(dropped ? 'nothing of hers the filters allow' : 'no sets found for this model');
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
      if (errorMessage(err) === 'cancelled') logLine('Cancelled.');
      else logLine(`${err && err.skip ? 'Skipped' : 'Failed'}: ${errorMessage(err)}`);
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
    rememberSetRecord(record);
    // A gallery queued from a link arrives as a bare id, so this is the first
    // point at which there is anything to judge it by. One that came out of the
    // catalogue was judged before it was queued and never reaches here.
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
      sourceZip: null,
      items: []
    };

    if (wantsKind('image')) {
      const signed = await signPhotoset(album.id);
      const photos = (signed && Array.isArray(signed.large) ? signed.large : []).filter(Boolean);
      // Prefer the larger build when the gallery has one; most have only the one.
      const zip = (signed && signed.zip) || null;
      if (USE_SITE_ZIP && zip) album.sourceZip = String(zip.hd || zip.normal || '') || null;
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

    const startedAt = Date.now();
    const folder = modelFolderFor(album);
    const base = archiveBaseName(album);
    const wantImages = album.items.some(item => item.kind === 'image');
    const videos = album.items.filter(item => item.kind === 'video');

    // Photos: the gallery's own zip if the site offers one, else one at a time.
    let photos = [];
    let photoSeconds = 0;
    if (wantImages) {
      const photosAt = Date.now();
      if (album.sourceZip) photos = await photosFromSiteZip(album, Zip);
      if (!photos || !photos.length) photos = await photosOneByOne(album);
      photoSeconds = (Date.now() - photosAt) / 1000;
    }
    if (state.cancel) throw new Error('cancelled');

    // The video one at a time and on its own budget, because it is the whole
    // archive's weight in a single file and a lane of six would be six of it.
    for (const video of videos) {
      if (state.cancel) throw new Error('cancelled');
      if (video.bytes && video.bytes > VIDEO_SIZE_WARN_BYTES) {
        logLine(`The ${video.quality} video is ${formatBytes(video.bytes)}. It has to sit in memory to go in the zip, so a tab with little to spare may not manage it — the Video button drops to a smaller encode.`);
      }
      logLine(`Fetching the ${video.quality} video${video.bytes ? ` (${formatBytes(video.bytes)})` : ''}.`);
      try {
        video.data = await fetchBinaryWithRetry(video.url, VIDEO_TIMEOUT_MS);
      } catch (err) {
        video.error = errorMessage(err);
      }
      setProgress(80);
    }
    if (state.cancel) throw new Error('cancelled');

    // Photos in order, then the video, sharing one run of numbers. Every entry is
    // a loose file inside the one folder the archive is named for; nothing nests
    // below that, whichever way the photos arrived.
    const files = photos.concat(videos.map(video => ({
      kind: 'video', data: video.data, url: video.url, error: video.error
    })));
    const pad = Math.max(MIN_INDEX_PAD, String(files.length).length);
    const zip = new Zip();
    let added = 0;
    let failed = 0;
    files.forEach((file, index) => {
      const leaf = `${base}_${String(index + 1).padStart(pad, '0')}.${inferExt(file.name || file.url, file.kind === 'video' ? 'mp4' : 'jpg')}`;
      if (!file.data) {
        failed++;
        logLine(`Skipped ${leaf}: ${file.error || 'no data'}`);
        return;
      }
      zip.file(`${base}/${leaf}`, file.data);
      added++;
    });
    if (!added) throw new Error(`all ${files.length} downloads failed`);
    if (failed) logLine(`Archive is partial: ${failed} file${failed === 1 ? '' : 's'} failed.`);

    const zipAt = Date.now();
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      meta => setProgress(82 + Math.round(((meta && meta.percent) || 0) * 0.14))
    );
    // Dropped as early as possible: until this runs the tab is holding both the
    // files and the archive made out of them.
    files.forEach(file => { file.data = null; });
    album.items.forEach(item => { item.data = null; });

    const archiveName = sanitizeDownloadPathForSave(`${ROOT_FOLDER}/${folder}/${base}.zip`);
    await saveBlob(blob, archiveName);
    // One line with the numbers in it, because "it feels slow" is not something
    // anyone can act on and "34 photos in 41s" is.
    logLine(`Saved ${archiveName} — ${added} file${added === 1 ? '' : 's'}, ${formatBytes(blob.size)}`
      + `${photoSeconds ? `, photos ${photoSeconds.toFixed(1)}s` : ''}`
      + `, zip ${((Date.now() - zipAt) / 1000).toFixed(1)}s, total ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
    return added;
  }

  // --- the gallery's own zip -------------------------------------------------
  //
  // One request instead of forty. Returns null rather than throwing when it does
  // not work out, because the one-at-a-time path is still there and a gallery
  // should not fail over a shortcut.

  async function photosFromSiteZip(album, Zip) {
    let buffer = null;
    try {
      buffer = await fetchBinaryWithRetry(album.sourceZip, BLOB_TIMEOUT_MS);
    } catch (err) {
      // 503 is this server saying "not built yet", which one wait usually cures.
      if (err && err.httpStatus === 503) {
        logLine('The gallery zip is still being built; waiting a moment.');
        await delay(SITE_ZIP_RETRY_MS);
        try {
          buffer = await fetchBinaryWithRetry(album.sourceZip, BLOB_TIMEOUT_MS);
        } catch (retryErr) {
          logLine(`The gallery zip did not come (${errorMessage(retryErr)}); fetching the photos one at a time.`);
          return null;
        }
      } else {
        logLine(`The gallery zip did not come (${errorMessage(err)}); fetching the photos one at a time.`);
        return null;
      }
    }

    let loaded;
    try {
      loaded = await new Zip().loadAsync(buffer);
    } catch (err) {
      logLine(`The gallery zip could not be opened (${errorMessage(err)}); fetching the photos one at a time.`);
      return null;
    }
    buffer = null;

    const entries = [];
    loaded.forEach((path, entry) => {
      if (entry.dir) return;
      const name = String(path || '');
      if (!/\.(?:jpe?g|png|webp|gif|avif|bmp)$/i.test(name)) return;
      entries.push({ path: name, entry });
    });
    if (!entries.length) {
      logLine('The gallery zip held no photos; fetching them one at a time.');
      return null;
    }

    const ordered = flattenZipEntryOrder(entries);
    if (album.declared && ordered.length < album.declared) {
      const detail = `the gallery zip holds ${ordered.length} of ${album.declared} photos`;
      if (!ALLOW_PARTIAL_ALBUMS) {
        logLine(`${detail}; fetching them one at a time instead.`);
        return null;
      }
      logLine(`Partial gallery: ${detail}.`);
    }

    const out = [];
    for (let i = 0; i < ordered.length; i++) {
      if (state.cancel) throw new Error('cancelled');
      const item = ordered[i];
      try {
        out.push({ kind: 'image', name: item.path, data: await item.entry.async('uint8array') });
      } catch (err) {
        out.push({ kind: 'image', name: item.path, data: null, error: errorMessage(err) });
      }
      setProgress(16 + Math.round(((i + 1) / ordered.length) * 54));
    }
    logLine(`Took ${out.length} photo${out.length === 1 ? '' : 's'} from the gallery's own zip.`);
    return out;
  }

  // The same regrouping flattenPhotoOrder does for URLs, applied to the paths
  // inside an archive — which is where the erotic/explicit split actually lives.
  function flattenZipEntryOrder(entries) {
    const groups = new Map();
    entries.forEach(item => {
      const at = item.path.lastIndexOf('/');
      const dir = at >= 0 ? item.path.slice(0, at + 1) : '';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(item);
    });
    // Within a folder the archive's own order is not guaranteed, but the names
    // are numbered, so sort on them.
    groups.forEach(group => group.sort((a, b) => naturalCompare(a.path, b.path)));
    if (groups.size > 1) {
      const sizes = Array.from(groups.values()).map(group => group.length).join(' + ');
      logLine(`Split across ${groups.size} folders (${sizes}); flattening them into one run.`);
    }
    const out = [];
    groups.forEach(group => out.push(...group));
    return out;
  }

  // "10" after "9", not before it, in case a gallery numbers its files without
  // padding them.
  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  // --- one at a time ---------------------------------------------------------

  async function photosOneByOne(album) {
    const images = album.items.filter(item => item.kind === 'image');
    if (!images.length) return [];
    let done = 0;
    await runPool(images, IMAGE_CONCURRENCY, async item => {
      try {
        item.data = await fetchBinaryWithRetry(item.url);
      } catch (err) {
        item.error = errorMessage(err);
      }
      done++;
      setProgress(16 + Math.round((done / Math.max(1, images.length)) * 54));
    });
    if (state.cancel) throw new Error('cancelled');
    return images.map(item => ({ kind: 'image', name: item.url, url: item.url, data: item.data, error: item.error }));
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

  // Which road the media host will take, decided once by trying the fast one.
  //
  // The extension's own request function is the only thing that can read a host
  // which does not invite other pages to, and that used to be reason enough to
  // send every photo down it without asking. It is also, per file, several times
  // slower than a plain browser request — everything it fetches is handed across
  // the extension's boundary before the page sees a byte — and forty of those is
  // most of a minute for a gallery that is ten seconds of actual pictures.
  //
  // So the plain request is tried first, once. If the host allows it, everything
  // afterwards takes that road and never asks again. If it does not, that is
  // remembered too, and nothing after the first file wastes a request finding out
  // what is already known.
  //
  // A real HTTP status is an answer about the file, not about the road, so it is
  // thrown rather than treated as a reason to change transport.

  async function httpBinaryDirect(url, ms) {
    const res = await nativeFetch(url, {}, ms, 'file fetch');
    if (!res.ok) throw httpStatusError(res.status);
    // A signed-out or expired session answers with a page rather than a 401, so a
    // media request that comes back as markup is an auth failure wearing a 200.
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    if (/^(?:text\/|application\/(?:json|xml|xhtml))/.test(type)) {
      throw new Error(`server returned ${type.split(';')[0] || 'non-media content'} — check you are signed in`);
    }
    const buffer = await withDeadline('file read', ms, (ok, fail) => { res.arrayBuffer().then(ok, fail); });
    if (!buffer || !buffer.byteLength) throw new Error('empty response');
    return buffer;
  }

  async function httpBinary(url, timeoutMs) {
    const ms = timeoutMs || BLOB_TIMEOUT_MS;
    const offSite = !isSameOrigin(url);
    const settled = offSite ? state.cdnTransport : '';

    if (settled !== 'gm' && typeof fetch === 'function') {
      try {
        const buffer = await httpBinaryDirect(url, ms);
        if (offSite && state.cdnTransport !== 'fetch') {
          state.cdnTransport = 'fetch';
          logLine('The media host lets the page read its files directly; using the fast road.');
        }
        noteTransport('fetch');
        return buffer;
      } catch (err) {
        if (err && err.httpStatus) throw err;
        if (!hasGmRequest()) throw err;
        if (offSite && !state.cdnTransport) {
          state.cdnTransport = 'gm';
          logLine('The media host will not let the page read its files directly, so every file goes through the extension. That is the slow road, and there is no way around it.');
        } else if (!offSite) {
          logLine(`fetch failed (${errorMessage(err)}); falling back to GM_xmlhttpRequest.`);
        }
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
  // The history is read here rather than in init() because the observer cannot
  // judge a card without it, and by the time a body exists the first screenful of
  // cards may already be built. It is a synchronous read that touches no UI, so
  // it is safe this early.
  applyHideStyle();
  applyDownloadedHideStyle();
  loadHistory();
  loadActorTypes();
  loadSetTypes();
  loadFileFilter();
  installEarlyObserver();
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
