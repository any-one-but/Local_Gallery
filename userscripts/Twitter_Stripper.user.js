// ==UserScript==
// @name         Twitter Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.00
// @description  Twitter/X account post-text, image, and video downloader.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/Twitter_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/Twitter_Stripper.user.js
// @match        *://x.com/*
// @match        *://*.x.com/*
// @match        *://twitter.com/*
// @match        *://*.twitter.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      self
// @connect      x.com
// @connect      *.x.com
// @connect      twitter.com
// @connect      *.twitter.com
// @connect      api.twitter.com
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      abs.twimg.com
// @connect      *.twimg.com
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  if (!/(?:^|\.)(?:x|twitter)\.com$/i.test(location.hostname)) return;
  if (window.__twitterStripperLoaded) return;
  window.__twitterStripperLoaded = true;

  // X ships no public API, so the script never invents credentials or query
  // ids. It hooks the page's own fetch/XHR at document-start and learns the
  // bearer token plus each GraphQL operation's queryId/features/variables from
  // the real requests the site makes. Scanning then replays those templates
  // with the target userId/cursor swapped in. Because you must already be on
  // the profile or tweet page to scan it, the page has always fired the calls
  // we need (UserByScreenName + UserTweets on a profile, TweetDetail on a
  // status) before you press Scan.
  const captured = { bearer: '', ops: Object.create(null) };
  installNetworkCapture();

  const JSZip = window.JSZip;
  const FALLBACK_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const API_DELAY_MS = 550;
  const FILE_DELAY_MS = 220;
  const MAX_API_PAGES = 300;
  const LISTING_LIMIT = 100;
  const MAX_RETRIES = 2;
  const BACKOFF_BASE = 800;
  const BLOB_TIMEOUT_MS = 180000;
  const SCAN_CACHE_PREFIX = 'TwitterStripper.scanCache.v1:';
  const SCAN_CACHE_MAX_ENTRIES = 24;
  const SCAN_CACHE_MAX_BYTES = 4 * 1024 * 1024;
  const SCAN_CACHE_MAX_ENTRY_BYTES = 1.5 * 1024 * 1024;

  const RESERVED_HANDLES = new Set([
    'home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search',
    'compose', 'hashtag', 'bookmarks', 'lists', 'communities', 'tos', 'privacy',
    'jobs', 'about', 'login', 'logout', 'signup', 'intent', 'share', 'account',
    'personalization', 'following', 'followers', 'topics', 'moment', 'moments',
    'help', 'settings', 'download', 'flow'
  ]);

  const imgRE = /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:$|[?#])/i;
  const vidRE = /\.(?:m3u8|m4v|mov|mp4|ts|webm)(?:$|[?#])/i;

  const state = {
    busy: false,
    scanType: '',
    actor: '',
    restId: '',
    handle: '',
    displayName: '',
    userFolder: '',
    posts: [],
    pages: [],
    files: [],
    countTextOverride: '',
    fileProgressOverride: '',
    loadedScanCacheKey: ''
  };

  const ui = {};

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    if (ui.panel || !document.body) return;
    injectStyle();
    const panel = document.createElement('div');
    panel.id = 'twStripperPanel';
    panel.innerHTML = `
      <div class="tw-head">
        <span class="tw-title">Twitter Stripper</span>
        <button id="twCollapse" class="tw-iconBtn" type="button" title="Collapse">^</button>
      </div>
      <div class="tw-body">
        <section class="tw-view">
          <button id="twScan" type="button">Scan</button>
          <div class="tw-progress"><div id="twFill"></div></div>
          <div class="tw-meta">
            <span id="twProfile">No account scanned</span>
            <span id="twCount">0 files</span>
          </div>
          <div class="tw-stack">
            <button id="twPost" type="button" disabled>Download Post</button>
            <button id="twPosts" type="button" disabled>Download All Posts</button>
            <button id="twPages" type="button" disabled>Download All Pages</button>
            <button id="twBacklog" type="button" disabled>Download Account Backlog</button>
          </div>
          <div class="tw-rangeRow">
            <input id="twPostRange" type="text" inputmode="numeric" placeholder="Posts 1-0">
            <button id="twPostRangeBtn" type="button" disabled>Download Posts</button>
          </div>
          <div class="tw-rangeRow">
            <input id="twPageRange" type="text" inputmode="numeric" placeholder="Pages 1-0">
            <button id="twPageRangeBtn" type="button" disabled>Download Pages</button>
          </div>
          <div class="tw-rangeRow">
            <input id="twDateRange" type="text" placeholder="Date 260506-00">
            <button id="twDateRangeBtn" type="button" disabled>Download Dates</button>
          </div>
          <div class="tw-types">
            <button class="tw-chip is-on" type="button" role="checkbox" data-kind="image" aria-checked="true">Images</button>
            <button class="tw-chip is-on" type="button" role="checkbox" data-kind="video" aria-checked="true">Videos</button>
            <button class="tw-chip" type="button" role="checkbox" data-kind="text" aria-checked="false">Text</button>
          </div>
          <div id="twLog" class="tw-log" aria-live="polite"></div>
        </section>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.scan = panel.querySelector('#twScan');
    ui.fill = panel.querySelector('#twFill');
    ui.profile = panel.querySelector('#twProfile');
    ui.count = panel.querySelector('#twCount');
    ui.post = panel.querySelector('#twPost');
    ui.posts = panel.querySelector('#twPosts');
    ui.pages = panel.querySelector('#twPages');
    ui.backlog = panel.querySelector('#twBacklog');
    ui.postRange = panel.querySelector('#twPostRange');
    ui.postRangeBtn = panel.querySelector('#twPostRangeBtn');
    ui.pageRange = panel.querySelector('#twPageRange');
    ui.pageRangeBtn = panel.querySelector('#twPageRangeBtn');
    ui.dateRange = panel.querySelector('#twDateRange');
    ui.dateRangeBtn = panel.querySelector('#twDateRangeBtn');
    ui.chips = Array.from(panel.querySelectorAll('.tw-chip'));
    ui.log = panel.querySelector('#twLog');

    ui.scan.addEventListener('click', scanCurrent);
    ui.post.addEventListener('click', () => downloadPostArchives(state.posts.slice(0, 1), { includeAllFileTypes: true }));
    ui.posts.addEventListener('click', () => downloadPostArchives());
    ui.pages.addEventListener('click', () => downloadPageArchives());
    ui.backlog.addEventListener('click', () => downloadAccountArchive());
    ui.postRangeBtn.addEventListener('click', () => downloadSelectedPostArchives());
    ui.pageRangeBtn.addEventListener('click', () => downloadSelectedPageArchives());
    ui.dateRangeBtn.addEventListener('click', () => downloadSelectedDateArchives());
    panel.querySelector('#twCollapse').addEventListener('click', () => {
      panel.classList.toggle('tw-collapsed');
      panel.querySelector('#twCollapse').textContent = panel.classList.contains('tw-collapsed') ? 'v' : '^';
    });
    ui.chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const on = chip.getAttribute('aria-checked') === 'true';
        chip.setAttribute('aria-checked', on ? 'false' : 'true');
        chip.classList.toggle('is-on', !on);
      });
    });

    installRouteObserver();
    logLine('Ready. Open an X profile or tweet, let it load, then press Scan.');
    syncUi();
  }

  function injectStyle() {
    GM_addStyle(`
      #twStripperPanel{position:fixed;right:16px;top:74px;z-index:2147483646;width:348px;max-height:86vh;
        display:flex;flex-direction:column;border:1px solid rgba(120,120,128,.32);border-radius:10px;
        background:#0b0b0d;color:#f4f5f7;box-shadow:0 18px 60px rgba(0,0,0,.5);
        font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;overflow:hidden}
      #twStripperPanel,#twStripperPanel *{box-sizing:border-box}
      #twStripperPanel.tw-collapsed{height:auto}
      #twStripperPanel.tw-collapsed .tw-body{display:none}
      #twStripperPanel .tw-head{height:38px;display:flex;align-items:center;gap:8px;padding:0 10px;
        border-bottom:1px solid rgba(255,255,255,.1);background:#16161a;cursor:default}
      #twStripperPanel .tw-title{flex:1;font-weight:900;color:#e7e9ea}
      #twStripperPanel .tw-iconBtn{width:28px;height:28px;min-height:28px;padding:0}
      #twStripperPanel .tw-body{display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0;overflow:auto}
      #twStripperPanel .tw-view{display:flex;flex-direction:column;gap:8px;min-height:0}
      #twStripperPanel button{appearance:none;width:100%;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#f4f5f7;font:700 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;cursor:pointer}
      #twStripperPanel button:hover:not(:disabled){background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.4)}
      #twStripperPanel button:disabled{opacity:.42;cursor:default}
      #twStripperPanel #twScan{background:#1d9bf0;color:#fff;border-color:#1d9bf0}
      #twStripperPanel #twScan:hover:not(:disabled){background:#1a8cd8}
      #twStripperPanel .tw-rangeRow{display:grid;grid-template-columns:1fr 96px;gap:6px}
      #twStripperPanel .tw-stack{display:grid;grid-template-columns:1fr;gap:6px}
      #twStripperPanel input{box-sizing:border-box;width:100%;height:32px;padding:0 9px;border-radius:8px;
        border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.35);color:#f4f5f7;font:700 12px/1 Arial,sans-serif;outline:none}
      #twStripperPanel input:focus{border-color:rgba(29,155,240,.72)}
      #twStripperPanel .tw-progress{display:block;flex:0 0 10px;height:10px;min-height:10px;border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      #twStripperPanel #twFill{height:10px;width:0;background:linear-gradient(90deg,#1d9bf0,#00ba7c);transition:width 120ms ease}
      #twStripperPanel .tw-meta{display:flex;justify-content:space-between;gap:10px;color:#a7abb0;font-weight:700}
      #twStripperPanel .tw-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #twStripperPanel .tw-types{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
      #twStripperPanel .tw-chip{min-height:28px;font-size:11px;color:#a7abb0}
      #twStripperPanel .tw-chip.is-on{background:rgba(29,155,240,.2);border-color:rgba(29,155,240,.55);color:#f4f5f7}
      #twStripperPanel .tw-log{min-height:92px;max-height:190px;overflow:auto;border:1px solid rgba(255,255,255,.08);
        border-radius:8px;background:rgba(0,0,0,.28);padding:7px;color:#c7ccd1;white-space:pre-wrap}
      #twStripperPanel .tw-log div{margin:0 0 4px}
    `);
  }

  // ---- Network capture (learns bearer + GraphQL templates) ----------------

  function installNetworkCapture() {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, initArg) {
        try {
          const init = initArg || {};
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const method = init.method || (input && input.method) || 'GET';
          const headers = init.headers || (input && input.headers);
          rememberRequest(url, method, headers, init.body);
        } catch {}
        return origFetch.apply(this, arguments);
      };
      captured.origFetch = origFetch;
    }

    try {
      const XHR = XMLHttpRequest.prototype;
      const origOpen = XHR.open;
      const origSetHeader = XHR.setRequestHeader;
      const origSend = XHR.send;
      XHR.open = function (method, url) {
        this.__twCap = { method, url, headers: {} };
        return origOpen.apply(this, arguments);
      };
      XHR.setRequestHeader = function (key, value) {
        if (this.__twCap) this.__twCap.headers[key] = value;
        return origSetHeader.apply(this, arguments);
      };
      XHR.send = function (body) {
        try {
          if (this.__twCap) rememberRequest(this.__twCap.url, this.__twCap.method, this.__twCap.headers, body);
        } catch {}
        return origSend.apply(this, arguments);
      };
    } catch {}
  }

  function rememberRequest(url, method, headers, body) {
    try {
      const auth = headerGet(headers, 'authorization');
      if (auth && /^bearer\s+/i.test(auth)) captured.bearer = auth.replace(/^bearer\s+/i, '').trim();
      const match = String(url).match(/\/graphql\/([^/]+)\/([^/?#]+)/);
      if (!match) return;
      const queryId = match[1];
      const opName = match[2];
      let variables;
      let features;
      let fieldToggles;
      if (String(method || 'GET').toUpperCase() === 'GET') {
        const u = new URL(url, location.origin);
        variables = safeJsonParse(u.searchParams.get('variables'));
        features = safeJsonParse(u.searchParams.get('features'));
        fieldToggles = safeJsonParse(u.searchParams.get('fieldToggles'));
      } else if (typeof body === 'string') {
        const parsed = safeJsonParse(body);
        if (parsed) { variables = parsed.variables; features = parsed.features; fieldToggles = parsed.fieldToggles; }
      }
      const prev = captured.ops[opName] || {};
      captured.ops[opName] = {
        opName,
        queryId: queryId || prev.queryId || '',
        variables: variables || prev.variables || {},
        features: features || prev.features || null,
        fieldToggles: fieldToggles || prev.fieldToggles || null
      };
    } catch {}
  }

  function headerGet(headers, name) {
    if (!headers) return '';
    const lower = String(name).toLowerCase();
    try {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name) || '';
      if (Array.isArray(headers)) {
        const found = headers.find(pair => Array.isArray(pair) && String(pair[0]).toLowerCase() === lower);
        return found ? String(found[1] || '') : '';
      }
      if (typeof headers === 'object') {
        for (const key of Object.keys(headers)) {
          if (String(key).toLowerCase() === lower) return String(headers[key] || '');
        }
      }
    } catch {}
    return '';
  }

  // ---- API layer ----------------------------------------------------------

  function apiHeaders() {
    const ct0 = getCookie('ct0');
    const headers = {
      authorization: `Bearer ${captured.bearer || FALLBACK_BEARER}`,
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en'
    };
    if (ct0) {
      headers['x-csrf-token'] = ct0;
      headers['x-twitter-auth-type'] = 'OAuth2Session';
    }
    return headers;
  }

  async function apiGraphql(opName, variablesOverride) {
    const tmpl = captured.ops[opName];
    if (!tmpl || !tmpl.queryId) {
      throw new Error(`X has not run "${opName}" on this page yet — reload the page, let it load, then Scan`);
    }
    const vars = Object.assign({}, tmpl.variables, variablesOverride || {});
    const u = new URL(`${location.protocol}//${location.host}/i/api/graphql/${tmpl.queryId}/${opName}`);
    u.searchParams.set('variables', JSON.stringify(vars));
    if (tmpl.features) u.searchParams.set('features', JSON.stringify(tmpl.features));
    if (tmpl.fieldToggles) u.searchParams.set('fieldToggles', JSON.stringify(tmpl.fieldToggles));
    const doFetch = captured.origFetch || window.fetch;
    const res = await doFetch(u.href, { method: 'GET', credentials: 'include', headers: apiHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function resolveUser(screenName) {
    const json = await apiGraphql('UserByScreenName', { screen_name: screenName });
    const result = json && json.data && json.data.user && json.data.user.result;
    if (!result || (result.__typename && result.__typename !== 'User')) {
      throw new Error(result && result.__typename ? `account is ${result.__typename}` : 'account not found');
    }
    const legacy = result.legacy || {};
    const core = result.core || {};
    return {
      restId: result.rest_id || '',
      handle: legacy.screen_name || core.screen_name || screenName,
      name: legacy.name || core.name || ''
    };
  }

  async function fetchUserTweets(restId) {
    const posts = [];
    let cursor = '';
    let page = 0;
    let emptyStreak = 0;
    while (page < MAX_API_PAGES) {
      page++;
      const vars = { userId: restId };
      if (cursor) vars.cursor = cursor;
      logLine(`Loading tweets page ${page}${cursor ? '...' : '.'}`);
      const json = await apiGraphql('UserTweets', vars);
      const parsed = parseTimeline(json);
      let added = 0;
      parsed.tweets.forEach(result => {
        const post = tweetToPost(result, page);
        if (post) { posts.push(post); added++; }
      });
      setProgress(Math.min(72, page * 5));
      if (!parsed.cursor || parsed.cursor === cursor) break;
      if (!added) {
        emptyStreak++;
        if (emptyStreak >= 3) break;
      } else {
        emptyStreak = 0;
      }
      cursor = parsed.cursor;
      await delay(API_DELAY_MS);
    }
    if (page >= MAX_API_PAGES) logLine(`Stopped at ${MAX_API_PAGES} API pages.`);
    return posts;
  }

  async function loadSingleTweetResult(tweetId) {
    if (captured.ops.TweetResultByRestId) {
      try {
        const json = await apiGraphql('TweetResultByRestId', { tweetId });
        const result = json && json.data && json.data.tweetResult && json.data.tweetResult.result;
        if (result) return result;
      } catch (err) {
        logLine(`TweetResultByRestId failed (${errorMessage(err)}); trying the thread view.`);
      }
    }
    if (captured.ops.TweetDetail) {
      const json = await apiGraphql('TweetDetail', { focalTweetId: tweetId });
      const result = pickTweetFromDetail(json, tweetId);
      if (result) return result;
    }
    throw new Error('could not load this tweet — reload the tweet page and Scan again');
  }

  function pickTweetFromDetail(json, focalId) {
    const conv = json && json.data && json.data.threaded_conversation_with_injections_v2;
    const instructions = (conv && conv.instructions) || [];
    let fallback = null;
    for (const ins of instructions) {
      if (!ins || !Array.isArray(ins.entries)) continue;
      for (const entry of ins.entries) {
        const id = entry && entry.entryId ? String(entry.entryId) : '';
        const result = tweetResultFrom(entry && entry.content && entry.content.itemContent);
        if (!result) continue;
        if (!fallback) fallback = result;
        if (id === `tweet-${focalId}`) return result;
      }
    }
    return fallback;
  }

  // ---- Timeline / tweet parsing -------------------------------------------

  function parseTimeline(json) {
    const result = json && json.data && json.data.user && json.data.user.result;
    const timeline = result && (
      (result.timeline_v2 && result.timeline_v2.timeline) ||
      (result.timeline && result.timeline.timeline) ||
      result.timeline_v2 ||
      result.timeline
    );
    const instructions = (timeline && timeline.instructions) || [];
    const tweets = [];
    let cursor = '';
    const pushResult = r => { if (r) tweets.push(r); };
    const setCursor = c => { if (c) cursor = c; };
    instructions.forEach(ins => {
      if (!ins) return;
      if (ins.type === 'TimelineAddEntries' && Array.isArray(ins.entries)) {
        ins.entries.forEach(entry => collectEntry(entry, pushResult, setCursor));
      } else if (ins.type === 'TimelinePinEntry' && ins.entry) {
        collectEntry(ins.entry, pushResult, setCursor);
      } else if (ins.type === 'TimelineAddToModule' && Array.isArray(ins.moduleItems)) {
        ins.moduleItems.forEach(mi => pushResult(tweetResultFrom(mi && mi.item && mi.item.itemContent)));
      }
    });
    return { tweets, cursor };
  }

  function collectEntry(entry, push, setCursor) {
    if (!entry) return;
    const id = entry.entryId ? String(entry.entryId) : '';
    const content = entry.content || {};
    if (id.startsWith('cursor-bottom') || content.cursorType === 'Bottom') {
      if (content.value) setCursor(content.value);
      return;
    }
    if (id.startsWith('cursor-')) return;
    if (content.itemContent) {
      push(tweetResultFrom(content.itemContent));
      return;
    }
    if (Array.isArray(content.items)) {
      content.items.forEach(it => {
        const ic = it && it.item && it.item.itemContent;
        if (ic && ic.cursorType === 'Bottom' && ic.value) { setCursor(ic.value); return; }
        push(tweetResultFrom(ic));
      });
    }
  }

  function tweetResultFrom(itemContent) {
    if (!itemContent || itemContent.cursorType) return null;
    const result = itemContent.tweet_results && itemContent.tweet_results.result;
    return result || null;
  }

  function unwrapTweet(result) {
    if (!result) return null;
    if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) return result.tweet;
    if (result.tweet && result.tweet.legacy && !result.legacy) return result.tweet;
    return result;
  }

  function tweetToPost(result, page) {
    const tweet = unwrapTweet(result);
    if (!tweet || !tweet.legacy) return null;
    const legacy = tweet.legacy;
    if (legacy.retweeted_status_result) return null; // skip pure retweets

    const userResult = tweet.core && tweet.core.user_results && tweet.core.user_results.result;
    const uLegacy = (userResult && userResult.legacy) || {};
    const uCore = (userResult && userResult.core) || {};
    const handle = uLegacy.screen_name || uCore.screen_name || state.handle || state.actor;
    const displayName = uLegacy.name || uCore.name || '';
    const id = tweet.rest_id || legacy.id_str || '';
    if (!id) return null;

    const text = String((tweet.note_tweet && noteTweetText(tweet.note_tweet)) || legacy.full_text || '').trim();
    const post = {
      id,
      user: handle,
      displayName,
      text: stripTrailingMediaUrl(text),
      title: '',
      published: legacy.created_at || '',
      createdUtc: unixFromTwitter(legacy.created_at),
      page: Math.max(1, Number(page || 1) || 1),
      files: []
    };
    post.title = postTitle(post.text, id);

    const files = extractMediaFiles(legacy);
    const md = buildPostTextFile(post, files.length > 0);
    if (md) files.push(md);
    if (!files.length) return null;
    post.files = files;
    return post;
  }

  function noteTweetText(noteTweet) {
    const r = noteTweet && noteTweet.note_tweet_results && noteTweet.note_tweet_results.result;
    return r && r.text ? String(r.text) : '';
  }

  function extractMediaFiles(legacy) {
    const media = (legacy.extended_entities && legacy.extended_entities.media) ||
      (legacy.entities && legacy.entities.media) || [];
    const out = [];
    const seen = new Set();
    const add = (url, label, mime, ext) => {
      const normalized = normalizeDownloadUrl(url);
      if (!normalized) return;
      const key = canonicalMediaKey(normalized);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ url: normalized, name: `${label}.${ext}`, mime: mime || '', ext, hls: false });
    };
    (Array.isArray(media) ? media : []).forEach((m, idx) => {
      if (!m) return;
      const type = String(m.type || '').toLowerCase();
      if (type === 'photo' || (!type && m.media_url_https)) {
        const url = imageOrigUrl(m.media_url_https || m.media_url);
        add(url, `image_${pad3(idx + 1)}`, 'image/jpeg', getUrlExt(url) || 'jpg');
      } else if (type === 'video' || type === 'animated_gif') {
        const variant = bestVideoVariant(m.video_info && m.video_info.variants);
        const label = `${type === 'animated_gif' ? 'gif' : 'video'}_${pad3(idx + 1)}`;
        if (variant) add(variant.url, label, 'video/mp4', 'mp4');
        else if (m.media_url_https) add(imageOrigUrl(m.media_url_https), `${label}_thumb`, 'image/jpeg', 'jpg');
      }
    });
    return out;
  }

  function bestVideoVariant(variants) {
    if (!Array.isArray(variants)) return null;
    const mp4 = variants.filter(v => v && v.url && String(v.content_type || '').toLowerCase() === 'video/mp4');
    if (!mp4.length) return null;
    mp4.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
    return mp4[0];
  }

  function imageOrigUrl(url) {
    const base = String(url || '').split('?')[0].split('#')[0];
    if (!base) return '';
    return `${base}?name=orig`;
  }

  function stripTrailingMediaUrl(text) {
    // The full_text of a media tweet ends with a t.co link to the media itself;
    // drop only a lone trailing t.co token so text posts read cleanly.
    return String(text || '').replace(/\s*https:\/\/t\.co\/[A-Za-z0-9]+\s*$/, '').trim();
  }

  function buildPostTextFile(post, hasMedia) {
    const body = String(post.text || '').trim();
    if (!hasMedia && !body) return null;
    const title = post.title || `post_${post.id}`;
    const lines = [`# ${title}`, ''];
    const meta = [];
    if (post.user) meta.push(`- **Author:** @${post.user}`);
    if (post.displayName) meta.push(`- **Display name:** ${post.displayName}`);
    const iso = isoDateFromUnix(post.createdUtc);
    if (iso) meta.push(`- **Posted:** ${iso}`);
    else if (post.published) meta.push(`- **Posted:** ${post.published}`);
    const url = postUrl(post);
    if (url) meta.push(`- **Link:** ${url}`);
    if (meta.length) lines.push(...meta, '');
    if (body) lines.push(body, '');
    return { kind: 'text', text: lines.join('\n'), ext: 'md', mime: 'text/markdown', url: '', name: 'post.md' };
  }

  // ---- Scan ---------------------------------------------------------------

  function scanContextFromLocation() {
    const parts = location.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    if (!parts.length) return null;
    const actor = normalizeActor(parts[0]);
    if (!actor || RESERVED_HANDLES.has(actor)) return null;
    if ((parts[1] === 'status' || parts[1] === 'statuses') && parts[2]) {
      const id = String(parts[2]).replace(/[^0-9]/g, '');
      if (id) return { type: 'post', actor, id, url: location.href };
    }
    // profile, media tab, with_replies, likes-of-self, etc. all scan the account
    return { type: 'profile', actor };
  }

  function installRouteObserver() {
    let last = location.href;
    setInterval(() => {
      if (location.href === last) return;
      last = location.href;
      setProgress(0);
      logLine('Page changed. Press Scan for this X page.');
      syncUi();
    }, 600);
  }

  async function scanCurrent() {
    if (state.busy) return;
    const context = scanContextFromLocation();
    if (!context) {
      logLine('This page is not an X profile or tweet.');
      setProgress(0);
      return;
    }

    const cacheKey = scanCacheKey(context);
    if (cacheKey && state.loadedScanCacheKey !== cacheKey) {
      const cached = loadScanCache(cacheKey);
      if (cached) {
        applyCachedScan(cached, cacheKey);
        logLine(`Loaded cached X scan from ${formatCacheAge(cached.savedAt)}. Press Scan again to refresh it.`);
        return;
      }
    }

    resetScan(context);
    setBusy(true, 'Scanning...');
    setProgress(0);
    try {
      let mediaPosts = [];
      if (context.type === 'post') {
        const result = await loadSingleTweetResult(context.id);
        const post = tweetToPost(result, 1);
        if (post) {
          mediaPosts = [post];
          state.handle = post.user || context.actor;
          state.displayName = post.displayName || '';
          state.userFolder = sanitizeUserFolder(state.handle);
        }
        logLine(`Fetched tweet ${context.id}.`);
      } else {
        const user = await resolveUser(context.actor);
        state.actor = context.actor;
        state.restId = user.restId;
        state.handle = user.handle || context.actor;
        state.displayName = user.name || '';
        state.userFolder = sanitizeUserFolder(state.handle || context.actor);
        logLine(`Resolved @${state.handle}.`);
        if (!user.restId) throw new Error('could not resolve the account id');
        mediaPosts = await fetchUserTweets(user.restId);
        logLine(`Fetched ${mediaPosts.length} media/text post${mediaPosts.length === 1 ? '' : 's'} by @${state.handle}.`);
      }

      const built = buildDedupedDownloads(mediaPosts);
      state.posts = built.posts;
      state.pages = built.pages;
      state.files = built.files;
      state.loadedScanCacheKey = cacheKey;
      setProgress(100);
      logLine(`Scan complete: ${state.posts.length} post folder${state.posts.length === 1 ? '' : 's'}, ${state.pages.length} page archive${state.pages.length === 1 ? '' : 's'}, ${state.files.length} unique file${state.files.length === 1 ? '' : 's'}.`);
      if (built.duplicates) logLine(`Removed ${built.duplicates} duplicate file${built.duplicates === 1 ? '' : 's'}; oldest posts kept.`);
      if (cacheKey) {
        if (saveScanCache(cacheKey, buildCachePayload())) logLine('Saved this scan in the browser cache.');
        else logLine('Could not save scan cache in this browser.');
      }
    } catch (err) {
      setProgress(0);
      removeScanCache(cacheKey);
      logLine(`Scan failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function resetScan(context) {
    state.scanType = context.type;
    state.actor = context.actor || '';
    state.restId = '';
    state.handle = context.actor || '';
    state.displayName = '';
    state.userFolder = sanitizeUserFolder(context.actor || 'twitter_account');
    state.posts = [];
    state.pages = [];
    state.files = [];
    state.countTextOverride = '';
    state.fileProgressOverride = '';
    state.loadedScanCacheKey = '';
    syncUi();
  }

  // ---- Download set assembly (shared with Bluesky Stripper) ----------------

  function buildDedupedDownloads(posts) {
    const sorted = posts.slice().sort((a, b) => (a.createdUtc || 0) - (b.createdUtc || 0) || String(a.id).localeCompare(String(b.id)));
    const seen = new Set();
    const keptPosts = [];
    const keptFiles = [];
    let duplicates = 0;
    let globalIndex = 0;

    for (const post of sorted) {
      const postFiles = [];
      const textFiles = [];
      for (const file of post.files) {
        if (file.kind === 'text') {
          textFiles.push(file);
          continue;
        }
        const key = canonicalMediaKey(file.url);
        if (!key) continue;
        if (seen.has(key)) {
          duplicates++;
          continue;
        }
        seen.add(key);
        postFiles.push(file);
      }
      if (!postFiles.length && !textFiles.length) continue;
      globalIndex++;
      const decorated = {
        id: post.id,
        user: post.user || state.handle || 'twitter',
        title: post.title,
        published: post.published,
        createdUtc: post.createdUtc,
        page: Math.max(1, Number(post.page || 1) || 1),
        files: []
      };
      postFiles.concat(textFiles).forEach((file, idx) => {
        const name = formatFilename(decorated, file, idx + 1, globalIndex);
        const parts = splitDownloadPath(name);
        const item = {
          ...file,
          name,
          userFolder: parts.userFolder,
          postFolder: parts.postFolder,
          fileName: parts.fileName,
          postId: decorated.id
        };
        decorated.files.push(item);
        keptFiles.push(item);
      });
      keptPosts.push(decorated);
    }

    const pages = buildPageDownloads(keptPosts);
    return { posts: keptPosts, pages, files: keptFiles, duplicates };
  }

  function buildPageDownloads(posts) {
    const grouped = new Map();
    posts.forEach(post => {
      const page = Math.max(1, Number(post.page || 1) || 1);
      if (!grouped.has(page)) grouped.set(page, { page, posts: [], files: [] });
      grouped.get(page).posts.push(post);
      grouped.get(page).files.push(...post.files);
    });
    return [...grouped.values()].filter(page => page.files.length > 0).sort((a, b) => a.page - b.page);
  }

  async function downloadSelectedPostArchives() {
    if (state.busy) return;
    const parsed = parseRangeList(ui.postRange.value, state.posts.length);
    if (parsed.error) {
      logLine(`Post range error: ${parsed.error}.`);
      return;
    }
    const selected = state.posts.filter((post, idx) => parsed.numbers.has(idx + 1));
    if (!selected.length) {
      logLine('No scanned posts matched that range.');
      return;
    }
    await downloadPostArchives(selected);
  }

  async function downloadSelectedPageArchives() {
    if (state.busy) return;
    const maxPage = state.pages.reduce((max, page) => Math.max(max, Number(page.page) || 0), 0);
    const parsed = parseRangeList(ui.pageRange.value, maxPage);
    if (parsed.error) {
      logLine(`Page range error: ${parsed.error}.`);
      return;
    }
    const selected = state.pages.filter((page, idx) => parsed.numbers.has(Number(page.page) || 0) || parsed.numbers.has(idx + 1));
    if (!selected.length) {
      logLine('No scanned pages matched that range.');
      return;
    }
    await downloadPageArchives(selected);
  }

  async function downloadSelectedDateArchives() {
    if (state.busy) return;
    const parsed = parseDateRangeList(ui.dateRange.value);
    if (parsed.error) {
      logLine(`Date range error: ${parsed.error}.`);
      return;
    }
    const selected = state.posts.filter(post => {
      const key = dateNumberFromKey(dateKeyFromUnix(post.createdUtc));
      return key && parsed.ranges.some(range => key >= range.start && key <= range.end);
    });
    if (!selected.length) {
      logLine('No scanned posts matched that date range.');
      return;
    }
    await downloadPostArchives(selected);
  }

  async function downloadPostArchives(selectedPosts, options) {
    const posts = Array.isArray(selectedPosts) ? selectedPosts : state.posts;
    if (state.busy || !posts.length) return;
    const includeAllFileTypes = !!(options && options.includeAllFileTypes);
    const archiveItems = posts
      .map(post => ({ post, files: includeAllFileTypes ? safeArray(post.files) : filterFilesByType(post.files) }))
      .filter(item => item.files.length > 0);
    const totalFiles = archiveItems.reduce((sum, item) => sum + item.files.length, 0);
    if (!archiveItems.length) {
      logLine('No files match the selected post range and file types.');
      return;
    }
    setBusy(true, 'Downloading...');
    setProgress(0);
    setFileProgressOverride(0, totalFiles);
    setCountTextOverride(formatUnitTicker(0, archiveItems.length, 'post'));
    try {
      let done = 0;
      let completedFiles = 0;
      for (const item of archiveItems) {
        const firstFile = item.files[0];
        const archiveName = buildArchiveName(firstFile.userFolder || state.userFolder, firstFile.postFolder);
        logLine(`Building post zip ${done + 1}/${archiveItems.length}: ${firstFile.postFolder}`);
        await buildAndSaveArchive(item.files, archiveName, (pct, label) => {
          const base = (done / archiveItems.length) * 100;
          const span = 100 / archiveItems.length;
          setProgress(base + (pct / 100) * span);
          if (label) logLine(label);
        }, fileDone => setFileProgressOverride(completedFiles + fileDone, totalFiles));
        completedFiles += item.files.length;
        done++;
        setFileProgressOverride(completedFiles, totalFiles);
        setCountTextOverride(formatUnitTicker(done, archiveItems.length, 'post'));
        setProgress((done / archiveItems.length) * 100);
        await delay(FILE_DELAY_MS);
      }
      logLine(`Downloaded ${done} post archive${done === 1 ? '' : 's'}.`);
    } catch (err) {
      logLine(`Post download failed: ${errorMessage(err)}`);
    } finally {
      setCountTextOverride('');
      state.fileProgressOverride = '';
      setBusy(false);
    }
  }

  async function downloadPageArchives(selectedPages) {
    const pages = Array.isArray(selectedPages) ? selectedPages : state.pages;
    if (state.busy || !pages.length) return;
    const archiveItems = pages
      .map(page => ({ page, files: filterFilesByType(page.files) }))
      .filter(item => item.files.length > 0);
    const totalFiles = archiveItems.reduce((sum, item) => sum + item.files.length, 0);
    if (!archiveItems.length) {
      logLine('No files match the selected page range and file types.');
      return;
    }
    setBusy(true, 'Downloading...');
    setProgress(0);
    setFileProgressOverride(0, totalFiles);
    setCountTextOverride(formatUnitTicker(0, archiveItems.length, 'page'));
    try {
      let done = 0;
      let completedFiles = 0;
      for (const item of archiveItems) {
        const archiveName = buildPageArchiveName(state.userFolder, item.page.page);
        logLine(`Building page zip ${done + 1}/${archiveItems.length}: API page ${item.page.page}.`);
        await buildAndSaveArchive(item.files, archiveName, pct => {
          const base = (done / archiveItems.length) * 100;
          const span = 100 / archiveItems.length;
          setProgress(base + (pct / 100) * span);
        }, fileDone => setFileProgressOverride(completedFiles + fileDone, totalFiles));
        completedFiles += item.files.length;
        done++;
        setFileProgressOverride(completedFiles, totalFiles);
        setCountTextOverride(formatUnitTicker(done, archiveItems.length, 'page'));
        setProgress((done / archiveItems.length) * 100);
        await delay(FILE_DELAY_MS);
      }
      logLine(`Downloaded ${done} page archive${done === 1 ? '' : 's'}.`);
    } catch (err) {
      logLine(`Page download failed: ${errorMessage(err)}`);
    } finally {
      setCountTextOverride('');
      state.fileProgressOverride = '';
      setBusy(false);
    }
  }

  async function downloadAccountArchive() {
    if (state.busy || !state.files.length) return;
    const files = filterFilesByType(state.files);
    if (!files.length) {
      logLine('No files match the selected file types.');
      return;
    }
    setBusy(true, 'Downloading...');
    setProgress(0);
    setFileProgressOverride(0, files.length);
    try {
      const archiveName = buildArchiveName(state.userFolder, state.userFolder || 'twitter_account');
      logLine(`Building account zip for @${state.handle || state.actor}.`);
      await buildAndSaveArchive(files, archiveName, pct => setProgress(pct), (done, total) => setFileProgressOverride(done, total));
      setProgress(100);
      logLine(`Downloaded account archive with ${files.length} file${files.length === 1 ? '' : 's'}.`);
    } catch (err) {
      logLine(`Account download failed: ${errorMessage(err)}`);
    } finally {
      state.fileProgressOverride = '';
      setBusy(false);
    }
  }

  async function buildAndSaveArchive(files, archiveName, onProgress, onUnitProgress) {
    if (!JSZip || typeof JSZip !== 'function') throw new Error('JSZip is missing');
    const zip = new JSZip();
    let added = 0;
    let failed = 0;
    if (onUnitProgress) onUnitProgress(0, files.length);
    for (const file of files) {
      const fetchPct = files.length ? Math.round((added / files.length) * 68) : 0;
      if (onProgress) onProgress(fetchPct);
      try {
        const blob = file.kind === 'text'
          ? new Blob([file.text || ''], { type: 'text/markdown' })
          : await fetchBlobWithRetry(file);
        const zipPath = `${file.postFolder ? `${file.postFolder}/` : ''}${file.fileName || fallbackFileName(file.url, added + 1)}`;
        zip.file(zipPath, blob);
        added++;
        if (onProgress) onProgress(Math.round((added / files.length) * 68));
      } catch (err) {
        failed++;
        logLine(`Skipped failed file: ${file.fileName || file.url} (${errorMessage(err)})`);
      }
      if (onUnitProgress) onUnitProgress(added + failed, files.length);
      await delay(FILE_DELAY_MS);
    }
    if (!added) throw new Error(`all ${files.length} file fetches failed`);
    if (failed) logLine(`Archive is partial: ${failed} file${failed === 1 ? '' : 's'} failed.`);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => {
      const pct = Math.max(0, Math.min(100, Math.round(meta && meta.percent ? meta.percent : 0)));
      if (onProgress) onProgress(68 + Math.round((pct / 100) * 27));
    });
    await saveBlob(blob, sanitizeDownloadPathForSave(archiveName || 'twitter_archive.zip'));
    if (onProgress) onProgress(100);
  }

  async function fetchBlobWithRetry(file) {
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await requestBlob(file.url);
      } catch (err) {
        lastErr = err;
        if (attempt >= MAX_RETRIES) break;
        const backoff = BACKOFF_BASE * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
        await delay(backoff);
      }
    }
    throw lastErr || new Error('download failed');
  }

  function requestBlob(url, timeout) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: String(url),
        anonymous: true,
        responseType: 'blob',
        timeout: timeout || BLOB_TIMEOUT_MS,
        onload: async res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          const blob = res.response;
          if (!blob || typeof blob.size !== 'number' || blob.size === 0) {
            reject(new Error('empty response'));
            return;
          }
          const contentType = (parseHeader(res.responseHeaders, 'content-type') || blob.type || '').toLowerCase();
          if (/^(?:text\/|application\/(?:json|xml|xhtml))/.test(contentType)) {
            reject(new Error(`server returned ${contentType.split(';')[0] || 'non-media content'}`));
            return;
          }
          try {
            const head = await blob.slice(0, 16).text();
            if (/^\s*<(?:!doctype|html|head|body|\?xml|svg)/i.test(head)) {
              reject(new Error('server returned an HTML/XML page instead of media'));
              return;
            }
          } catch {}
          resolve(blob);
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('request timeout'))
      });
    });
  }

  function saveBlob(blob, name) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        setTimeout(() => {
          try { URL.revokeObjectURL(url); } catch {}
        }, 30000);
        if (err) reject(err);
        else resolve();
      };
      try {
        if (typeof GM_download === 'function') {
          GM_download({
            url,
            name,
            saveAs: false,
            onload: () => finish(),
            onerror: err => finish(new Error(err && err.error ? err.error : 'save failed')),
            ontimeout: () => finish(new Error('save timeout'))
          });
          return;
        }
      } catch (err) {
        finish(err);
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = name.split('/').pop() || 'twitter_archive.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      finish();
    });
  }

  // ---- UI plumbing --------------------------------------------------------

  function syncUi() {
    if (!ui.scan) return;
    const context = scanContextFromLocation();
    const hasFiles = state.files.length > 0;
    const hasPosts = state.posts.length > 0;
    const hasPages = state.pages.length > 0;
    const isPost = state.scanType === 'post';
    ui.scan.disabled = state.busy || !context;
    ui.post.disabled = state.busy || !hasPosts || !isPost;
    ui.posts.disabled = state.busy || !hasPosts;
    ui.pages.disabled = state.busy || !hasPages || isPost;
    ui.backlog.disabled = state.busy || !hasFiles || isPost;
    ui.postRangeBtn.disabled = state.busy || !hasPosts;
    ui.pageRangeBtn.disabled = state.busy || !hasPages || isPost;
    ui.dateRangeBtn.disabled = state.busy || !hasPosts;
    const label = state.handle ? `@${state.handle}` : context && context.actor ? `@${context.actor}` : 'No account scanned';
    ui.profile.textContent = label;
    ui.count.textContent = state.countTextOverride || state.fileProgressOverride || `${state.files.length} file${state.files.length === 1 ? '' : 's'}`;
    ui.postRange.placeholder = hasPosts ? `Posts 1-${state.posts.length}` : 'Posts 1-0';
    const maxPage = state.pages.reduce((max, page) => Math.max(max, Number(page.page) || 0), 0);
    ui.pageRange.placeholder = maxPage ? `Pages 1-${maxPage}` : 'Pages 1-0';
    ui.dateRange.placeholder = hasPosts ? postDatePlaceholder() : `Date ${todayDateKey()}-00`;
  }

  function setBusy(busy, scanLabel) {
    state.busy = !!busy;
    if (ui.scan) ui.scan.textContent = busy ? (scanLabel || 'Working...') : 'Scan';
    syncUi();
  }

  function setProgress(pct) {
    if (!ui.fill) return;
    const n = Math.max(0, Math.min(100, Number(pct) || 0));
    ui.fill.style.width = `${n}%`;
  }

  function setCountTextOverride(text) {
    state.countTextOverride = text || '';
    syncUi();
  }

  function setFileProgressOverride(done, total) {
    const d = Math.max(0, Number(done) || 0);
    const t = Math.max(d, Number(total) || 0);
    state.fileProgressOverride = t ? `${d}/${t} files` : '';
    syncUi();
  }

  function logLine(msg) {
    if (!ui.log) return;
    const div = document.createElement('div');
    div.textContent = String(msg || '');
    ui.log.appendChild(div);
    while (ui.log.children.length > 100) ui.log.removeChild(ui.log.firstChild);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function classifyFileKind(f) {
    if (!f || f.kind === 'text') return 'text';
    const ext = String(f.ext || '').toLowerCase();
    const mime = String(f.mime || '').toLowerCase();
    if (mime.indexOf('image/') === 0 || /^(?:avif|bmp|gif|jpe?g|png|webp)$/.test(ext)) return 'image';
    if (mime.indexOf('video/') === 0 || /^(?:m3u8|m4v|mov|mp4|ts|webm)$/.test(ext)) return 'video';
    return 'other';
  }

  function typeAllowed(kind) {
    const chip = ui.chips && ui.chips.find(c => c.dataset.kind === kind);
    if (!chip) return kind !== 'text';
    return chip.getAttribute('aria-checked') === 'true';
  }

  function filterFilesByType(files) {
    if (!Array.isArray(files)) return [];
    if (state.scanType === 'post') return files.slice();
    return files.filter(f => {
      const kind = classifyFileKind(f);
      if (kind === 'image') return typeAllowed('image');
      if (kind === 'video') return typeAllowed('video');
      if (kind === 'text') return typeAllowed('text');
      return true;
    });
  }

  // ---- Naming / formatting helpers ----------------------------------------

  function normalizeActor(actor) {
    return String(actor || '').trim().replace(/^@/, '').toLowerCase();
  }

  function postUrl(post) {
    const actor = post && post.user ? post.user : state.handle || state.actor;
    const id = post && post.id ? post.id : '';
    if (!actor || !id) return '';
    return `https://x.com/${encodeURIComponent(actor)}/status/${encodeURIComponent(id)}`;
  }

  function postTitle(text, id) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean) return clean.slice(0, 80);
    return `post_${id || 'unknown'}`;
  }

  function unixFromTwitter(raw) {
    const ms = Date.parse(raw || '');
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }

  function isoDateFromUnix(seconds) {
    const ts = Number(seconds) || 0;
    if (!ts) return '';
    return new Date(ts * 1000).toISOString().slice(0, 10);
  }

  function pad3(n) {
    return String(n || 0).padStart(3, '0');
  }

  function normalizeDownloadUrl(raw) {
    if (!raw) return '';
    let u = String(raw || '').trim();
    if (!u) return '';
    if (u.includes('&amp;')) u = u.replace(/&amp;/g, '&');
    try { return new URL(u, location.origin).href; } catch {}
    try { return new URL(encodeURI(u), location.origin).href; } catch {}
    return u;
  }

  function canonicalMediaKey(raw) {
    const normalized = normalizeDownloadUrl(raw);
    if (!normalized) return '';
    try {
      const u = new URL(normalized);
      return `${u.hostname.toLowerCase()}${decodeURIComponent(u.pathname || '').replace(/\/+$/, '').toLowerCase()}`;
    } catch {
      return normalized.split('?')[0].toLowerCase();
    }
  }

  function inferExt(raw, mime) {
    const fromUrl = getUrlExt(raw);
    if (fromUrl) return fromUrl === 'jpeg' ? 'jpg' : fromUrl;
    const cleanMime = String(mime || '').toLowerCase();
    if (cleanMime.includes('jpeg')) return 'jpg';
    if (cleanMime.includes('png')) return 'png';
    if (cleanMime.includes('webp')) return 'webp';
    if (cleanMime.includes('gif')) return 'gif';
    if (cleanMime.includes('mp4')) return 'mp4';
    if (cleanMime.includes('webm')) return 'webm';
    return 'bin';
  }

  function getUrlExt(u) {
    const raw = normalizeDownloadUrl(u);
    if (!raw) return '';
    try {
      const url = new URL(raw, location.origin);
      const fmt = url.searchParams.get('format');
      if (fmt) return fmt.toLowerCase().replace(/[^a-z0-9]+/gi, '');
      const path = url.pathname || '';
      const dot = path.lastIndexOf('.');
      if (dot >= 0 && dot < path.length - 1) return path.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]+/gi, '');
    } catch {}
    return '';
  }

  function formatFilename(post, fileObj, index, globalIndex) {
    const user = post.user || state.handle || 'twitter';
    const userSec = sanitizeUserFolder(user);
    const actorSec = sanitizeNamePart(user).slice(0, 40) || 'twitter';
    const titleSec = sanitizeNamePart(post.title || `post_${post.id}`).slice(0, 44) || `post_${post.id}`;
    const ext = fileObj.ext || getUrlExt(fileObj.name || fileObj.url || '') || 'bin';
    const gPost = String(globalIndex || 0).padStart(6, '0');
    const fIdx = String(index || 0).padStart(6, '0');
    const dateSec = dateKeyFromPost(post) || '000000';
    const base = `${dateSec}-${actorSec}-${gPost} - ${titleSec}`;
    const fileName = fileObj.kind === 'text' ? `${base}.${ext}` : `${base}_${fIdx}.${ext}`;
    return `${userSec}/${base}/${fileName}`;
  }

  function dateKeyFromPost(post) {
    if (post && post.createdUtc) return dateKeyFromUnix(post.createdUtc);
    const ms = Date.parse(post && post.published || '');
    if (!Number.isFinite(ms)) return '';
    return dateKeyFromDate(new Date(ms));
  }

  function sanitizeUserFolder(s) {
    s = String(s || '').normalize('NFC');
    s = s.replace(/\uFFFD/g, '');
    s = s.replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/\s+/g, '_');
    s = s.replace(/[\\/:*?"<>|]+/g, '');
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return s || 'twitter_account';
  }

  function sanitizeNamePart(s) {
    s = String(s || '').normalize('NFC');
    s = s.replace(/\uFFFD/g, '');
    s = s.replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/ - /g, '-');
    s = s.replace(/[\\/:*?"<>|]+/g, '');
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/ +/g, ' ').replace(/^ +| +$/g, '');
    return s;
  }

  function sanitizeFileNameStrict(raw, fallback) {
    let s = String(raw || '').normalize('NFC');
    s = s.replace(/\uFFFD/g, '');
    s = s.replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/[^A-Za-z0-9._ -]+/g, '');
    s = s.trim();
    return s || (fallback || 'download');
  }

  function sanitizeDownloadPathForSave(rawPath) {
    const parts = String(rawPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) return 'download';
    return parts.map((seg, idx) => sanitizeFileNameStrict(seg, idx === parts.length - 1 ? 'download' : 'folder')).join('/');
  }

  function splitDownloadPath(path) {
    const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const [userFolder, postFolder, ...rest] = parts;
    return { userFolder: userFolder || '', postFolder: postFolder || '', fileName: rest.join('/') || '' };
  }

  function buildArchiveName(userFolder, postFolder) {
    const base = postFolder || 'post';
    return userFolder ? `${userFolder}/${base}.zip` : `${base}.zip`;
  }

  function buildPageArchiveName(userFolder, pageNumber) {
    const pageSec = `page_${String(pageNumber || 1).padStart(4, '0')}`;
    return userFolder ? `${userFolder}/${pageSec}.zip` : `${pageSec}.zip`;
  }

  function fallbackFileName(url, index) {
    return `media_${String(index).padStart(6, '0')}.${inferExt(url, '')}`;
  }

  function parseRangeList(raw, maxNumber) {
    const text = String(raw || '').trim();
    if (!text) return { numbers: new Set(), error: 'enter a range list first' };
    const limit = Math.max(0, Number(maxNumber) || 0);
    const out = new Set();
    const parts = text.split(/[\s,]+/).filter(Boolean);
    for (const part of parts) {
      const match = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!match) return { numbers: out, error: `invalid range item "${part}"` };
      let start = Number(match[1]) || 0;
      let end = Number(match[2] || match[1]) || 0;
      if (start < 1 || end < 1) return { numbers: out, error: 'range numbers start at 1' };
      if (end < start) [start, end] = [end, start];
      if (limit && start > limit) continue;
      end = limit ? Math.min(end, limit) : end;
      for (let n = start; n <= end; n++) out.add(n);
    }
    if (!out.size) return { numbers: out, error: 'range did not match any scanned items' };
    return { numbers: out, error: '' };
  }

  function parseDateRangeList(raw) {
    const text = String(raw || '').trim();
    if (!text) return { ranges: [], error: 'enter a date range first' };
    const today = todayDateKey();
    const parseDateToken = token => {
      const value = String(token || '').trim();
      if (value === '00') return today;
      if (!/^\d{6}$/.test(value)) return '';
      const yy = Number(value.slice(0, 2));
      const mm = Number(value.slice(2, 4));
      const dd = Number(value.slice(4, 6));
      const date = new Date(Date.UTC(2000 + yy, mm - 1, dd));
      if (date.getUTCFullYear() !== 2000 + yy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return '';
      return value;
    };
    const ranges = [];
    for (const part of text.split(/[\s,]+/).filter(Boolean)) {
      const pieces = part.split('-');
      if (pieces.length > 2) return { ranges, error: `invalid date range item "${part}"` };
      const startKey = parseDateToken(pieces[0]);
      const endKey = parseDateToken(pieces[1] || pieces[0]);
      if (!startKey || !endKey) return { ranges, error: `invalid date item "${part}"` };
      let start = dateNumberFromKey(startKey);
      let end = dateNumberFromKey(endKey);
      if (end < start) [start, end] = [end, start];
      ranges.push({ start, end });
    }
    return ranges.length ? { ranges, error: '' } : { ranges, error: 'date range did not match any scanned posts' };
  }

  function postDatePlaceholder() {
    const keys = state.posts.map(post => dateKeyFromUnix(post.createdUtc)).filter(Boolean).sort();
    if (!keys.length) return `Date ${todayDateKey()}-00`;
    return `Date ${keys[0]}-${keys[keys.length - 1]}`;
  }

  function dateKeyFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  function dateKeyFromUnix(seconds) {
    const ts = Number(seconds) || 0;
    return ts ? dateKeyFromDate(new Date(ts * 1000)) : '';
  }

  function dateNumberFromKey(key) {
    return Number(String(key || '').replace(/\D/g, '')) || 0;
  }

  function todayDateKey() {
    return dateKeyFromDate(new Date());
  }

  // ---- Scan cache ---------------------------------------------------------

  function scanCacheKey(context) {
    if (!context) return '';
    if (context.type === 'post') return `post:${normalizeActor(context.actor)}:${String(context.id || '').toLowerCase()}`;
    if (context.type === 'profile') return `profile:${normalizeActor(context.actor)}`;
    return '';
  }

  function buildCachePayload() {
    return {
      scanType: state.scanType,
      actor: state.actor,
      restId: state.restId,
      handle: state.handle,
      displayName: state.displayName,
      userFolder: state.userFolder,
      posts: state.posts,
      pages: state.pages,
      files: state.files
    };
  }

  function applyCachedScan(cached, cacheKey) {
    const payload = cached && cached.payload ? cached.payload : {};
    state.scanType = payload.scanType || '';
    state.actor = payload.actor || '';
    state.restId = payload.restId || '';
    state.handle = payload.handle || state.actor;
    state.displayName = payload.displayName || '';
    state.userFolder = payload.userFolder || sanitizeUserFolder(state.handle || state.actor);
    state.posts = safeArray(payload.posts);
    state.pages = safeArray(payload.pages);
    state.files = safeArray(payload.files);
    state.loadedScanCacheKey = cacheKey;
    state.countTextOverride = '';
    state.fileProgressOverride = '';
    setProgress(100);
    syncUi();
  }

  function evictScanCaches(reserveBytes) {
    if (typeof GM_listValues !== 'function') return;
    let keys = [];
    try { keys = GM_listValues(); } catch { return; }
    const entries = [];
    let total = 0;
    keys.forEach(key => {
      if (typeof key !== 'string' || !key.startsWith(SCAN_CACHE_PREFIX)) return;
      let raw = '';
      try { raw = GM_getValue(key, '') || ''; } catch { raw = ''; }
      let savedAt = 0;
      try { savedAt = Number(JSON.parse(raw).savedAt) || 0; } catch {}
      entries.push({ key, savedAt, bytes: raw.length });
      total += raw.length;
    });
    entries.sort((a, b) => a.savedAt - b.savedAt);
    const budget = SCAN_CACHE_MAX_BYTES - Math.max(0, Number(reserveBytes) || 0);
    let count = entries.length;
    let i = 0;
    while (i < entries.length && (count > SCAN_CACHE_MAX_ENTRIES || total > budget)) {
      const victim = entries[i++];
      try { GM_deleteValue(victim.key); } catch {}
      try { localStorage.removeItem(victim.key); } catch {}
      total -= victim.bytes;
      count--;
    }
  }

  function loadScanCache(cacheKey) {
    if (!cacheKey) return null;
    try {
      const storageKey = SCAN_CACHE_PREFIX + cacheKey;
      const raw = typeof GM_getValue === 'function'
        ? (GM_getValue(storageKey, '') || localStorage.getItem(storageKey))
        : localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.payload) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveScanCache(cacheKey, payload) {
    if (!cacheKey || !payload) return false;
    try {
      const storageKey = SCAN_CACHE_PREFIX + cacheKey;
      const serialized = JSON.stringify({ version: 1, savedAt: Date.now(), payload });
      if (serialized.length > SCAN_CACHE_MAX_ENTRY_BYTES) return false;
      evictScanCaches(serialized.length);
      if (typeof GM_setValue === 'function') GM_setValue(storageKey, serialized);
      else localStorage.setItem(storageKey, serialized);
      return true;
    } catch {
      return false;
    }
  }

  function removeScanCache(cacheKey) {
    if (!cacheKey) return;
    try {
      const storageKey = SCAN_CACHE_PREFIX + cacheKey;
      if (typeof GM_deleteValue === 'function') GM_deleteValue(storageKey);
      localStorage.removeItem(storageKey);
    } catch {}
  }

  function formatCacheAge(savedAt) {
    const ageMs = Math.max(0, Date.now() - (Number(savedAt) || 0));
    const mins = Math.floor(ageMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  // ---- Misc helpers -------------------------------------------------------

  function getCookie(name) {
    const match = String(document.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function safeJsonParse(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function parseHeader(headers, name) {
    const re = new RegExp(`^${name}:\\s*([^\\r\\n]+)`, 'im');
    const match = String(headers || '').match(re);
    return match ? match[1].trim() : '';
  }

  function formatUnitTicker(done, total, label) {
    return `${done}/${total} ${label}${total === 1 ? '' : 's'}`;
  }

  function safeArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function errorMessage(err) {
    if (!err) return 'unknown error';
    if (err.message) return String(err.message);
    if (err.error) return String(err.error);
    return String(err);
  }
})();
