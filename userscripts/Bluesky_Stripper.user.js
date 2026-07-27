// ==UserScript==
// @name         Bluesky Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.00
// @description  Bluesky account, follow-list, post-text, image, and video downloader.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/Bluesky_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/Bluesky_Stripper.user.js
// @match        *://bsky.app/*
// @match        *://*.bsky.app/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      self
// @connect      bsky.app
// @connect      *.bsky.app
// @connect      bsky.social
// @connect      public.api.bsky.app
// @connect      cdn.bsky.app
// @connect      video.bsky.app
// @connect      *.bsky.network
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (!/(?:^|\.)bsky\.app$/i.test(location.hostname)) return;
  if (window.__blueskyStripperLoaded) return;
  window.__blueskyStripperLoaded = true;

  const JSZip = window.JSZip;
  const API_BASE = 'https://public.api.bsky.app/xrpc/';
  const API_DELAY_MS = 550;
  const FILE_DELAY_MS = 220;
  const MAX_API_PAGES = 300;
  const LISTING_LIMIT = 100;
  const MAX_RETRIES = 2;
  const BACKOFF_BASE = 800;
  const BLOB_TIMEOUT_MS = 180000;
  const HLS_TIMEOUT_MS = 240000;
  const SAVED_KEY = 'BlueskyStripper.savedAccounts.v1';
  const SCAN_CACHE_PREFIX = 'BlueskyStripper.scanCache.v1:';
  const SCAN_CACHE_MAX_ENTRIES = 24;
  const SCAN_CACHE_MAX_BYTES = 4 * 1024 * 1024;
  const SCAN_CACHE_MAX_ENTRY_BYTES = 1.5 * 1024 * 1024;

  const imgRE = /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:$|[?#])/i;
  const vidRE = /\.(?:m3u8|m4v|mov|mp4|ts|webm)(?:$|[?#])/i;

  const state = {
    busy: false,
    scanType: '',
    actor: '',
    did: '',
    handle: '',
    displayName: '',
    userFolder: '',
    posts: [],
    pages: [],
    files: [],
    follows: [],
    countTextOverride: '',
    fileProgressOverride: '',
    loadedScanCacheKey: ''
  };

  const ui = {};

  init();

  function init() {
    injectStyle();
    const panel = document.createElement('div');
    panel.id = 'bskyStripperPanel';
    panel.innerHTML = `
      <div class="bs-head">
        <span class="bs-title">Bluesky Stripper</span>
        <span id="bsSavedCount" class="bs-pill" hidden></span>
        <button id="bsCollapse" class="bs-iconBtn" type="button" title="Collapse">^</button>
      </div>
      <div class="bs-modes">
        <button class="bs-modeBtn is-active" type="button" data-mode="download">Download</button>
        <button class="bs-modeBtn" type="button" data-mode="saved">Tracked</button>
      </div>
      <div class="bs-body">
        <section id="bsDownloadView" class="bs-view">
          <button id="bsScan" type="button">Scan</button>
          <div class="bs-trackRow">
            <button id="bsTrack" type="button">Track Profile</button>
            <button id="bsRemoveTrack" type="button" disabled>Remove</button>
          </div>
          <div class="bs-progress"><div id="bsFill"></div></div>
          <div class="bs-meta">
            <span id="bsProfile">No account scanned</span>
            <span id="bsCount">0 files</span>
          </div>
          <div class="bs-stack">
            <button id="bsPost" type="button" disabled>Download Post</button>
            <button id="bsPosts" type="button" disabled>Download All Posts</button>
            <button id="bsPages" type="button" disabled>Download All Pages</button>
            <button id="bsBacklog" type="button" disabled>Download Account Backlog</button>
          </div>
          <div class="bs-rangeRow">
            <input id="bsPostRange" type="text" inputmode="numeric" placeholder="Posts 1-0">
            <button id="bsPostRangeBtn" type="button" disabled>Download Posts</button>
          </div>
          <div class="bs-rangeRow">
            <input id="bsPageRange" type="text" inputmode="numeric" placeholder="Pages 1-0">
            <button id="bsPageRangeBtn" type="button" disabled>Download Pages</button>
          </div>
          <div class="bs-rangeRow">
            <input id="bsDateRange" type="text" placeholder="Date 260506-00">
            <button id="bsDateRangeBtn" type="button" disabled>Download Dates</button>
          </div>
          <div class="bs-types">
            <button class="bs-chip is-on" type="button" role="checkbox" data-kind="image" aria-checked="true">Images</button>
            <button class="bs-chip is-on" type="button" role="checkbox" data-kind="video" aria-checked="true">Videos</button>
            <button class="bs-chip" type="button" role="checkbox" data-kind="text" aria-checked="false">Text</button>
          </div>
          <div id="bsFollows" class="bs-follows" hidden>
            <div class="bs-followsHead">
              <span>Follows</span>
              <span id="bsFollowCount" class="bs-subtle"></span>
              <button id="bsTrackFollows" class="bs-smallBtn" type="button" title="Track all scanned follows">+</button>
            </div>
            <div id="bsFollowList" class="bs-list"></div>
          </div>
          <div id="bsLog" class="bs-log" aria-live="polite"></div>
        </section>
        <section id="bsSavedView" class="bs-view" hidden>
          <div class="bs-savedHead">
            <input id="bsSavedSearch" type="text" placeholder="Filter tracked accounts">
            <button id="bsRefreshSaved" class="bs-smallBtn" type="button" title="Refresh">Refresh</button>
          </div>
          <div id="bsSavedList" class="bs-list"></div>
        </section>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.savedCount = panel.querySelector('#bsSavedCount');
    ui.scan = panel.querySelector('#bsScan');
    ui.track = panel.querySelector('#bsTrack');
    ui.removeTrack = panel.querySelector('#bsRemoveTrack');
    ui.fill = panel.querySelector('#bsFill');
    ui.profile = panel.querySelector('#bsProfile');
    ui.count = panel.querySelector('#bsCount');
    ui.post = panel.querySelector('#bsPost');
    ui.posts = panel.querySelector('#bsPosts');
    ui.pages = panel.querySelector('#bsPages');
    ui.backlog = panel.querySelector('#bsBacklog');
    ui.postRange = panel.querySelector('#bsPostRange');
    ui.postRangeBtn = panel.querySelector('#bsPostRangeBtn');
    ui.pageRange = panel.querySelector('#bsPageRange');
    ui.pageRangeBtn = panel.querySelector('#bsPageRangeBtn');
    ui.dateRange = panel.querySelector('#bsDateRange');
    ui.dateRangeBtn = panel.querySelector('#bsDateRangeBtn');
    ui.chips = Array.from(panel.querySelectorAll('.bs-chip'));
    ui.follows = panel.querySelector('#bsFollows');
    ui.followCount = panel.querySelector('#bsFollowCount');
    ui.followList = panel.querySelector('#bsFollowList');
    ui.trackFollows = panel.querySelector('#bsTrackFollows');
    ui.log = panel.querySelector('#bsLog');
    ui.downloadView = panel.querySelector('#bsDownloadView');
    ui.savedView = panel.querySelector('#bsSavedView');
    ui.savedSearch = panel.querySelector('#bsSavedSearch');
    ui.savedList = panel.querySelector('#bsSavedList');
    ui.modeBtns = Array.from(panel.querySelectorAll('.bs-modeBtn'));

    ui.scan.addEventListener('click', scanCurrent);
    ui.track.addEventListener('click', trackCurrentProfile);
    ui.removeTrack.addEventListener('click', removeCurrentProfile);
    ui.post.addEventListener('click', () => downloadPostArchives(state.posts.slice(0, 1), { includeAllFileTypes: true }));
    ui.posts.addEventListener('click', () => downloadPostArchives());
    ui.pages.addEventListener('click', () => downloadPageArchives());
    ui.backlog.addEventListener('click', () => downloadAccountArchive());
    ui.postRangeBtn.addEventListener('click', () => downloadSelectedPostArchives());
    ui.pageRangeBtn.addEventListener('click', () => downloadSelectedPageArchives());
    ui.dateRangeBtn.addEventListener('click', () => downloadSelectedDateArchives());
    ui.trackFollows.addEventListener('click', trackScannedFollows);
    ui.savedSearch.addEventListener('input', renderSavedList);
    panel.querySelector('#bsRefreshSaved').addEventListener('click', renderSavedList);
    panel.querySelector('#bsCollapse').addEventListener('click', () => {
      panel.classList.toggle('bs-collapsed');
      panel.querySelector('#bsCollapse').textContent = panel.classList.contains('bs-collapsed') ? 'v' : '^';
    });
    ui.modeBtns.forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
    ui.chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const on = chip.getAttribute('aria-checked') === 'true';
        chip.setAttribute('aria-checked', on ? 'false' : 'true');
        chip.classList.toggle('is-on', !on);
      });
    });

    installRouteObserver();
    logLine('Ready. Open a Bluesky profile or post.');
    renderSavedList();
    syncUi();
  }

  function injectStyle() {
    GM_addStyle(`
      #bskyStripperPanel{position:fixed;right:16px;top:74px;z-index:2147483646;width:348px;max-height:86vh;
        display:flex;flex-direction:column;border:1px solid rgba(30,144,255,.32);border-radius:10px;
        background:#07111c;color:#f4f9ff;box-shadow:0 18px 60px rgba(0,0,0,.45);
        font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;overflow:hidden}
      #bskyStripperPanel,#bskyStripperPanel *{box-sizing:border-box}
      #bskyStripperPanel.bs-collapsed{height:auto}
      #bskyStripperPanel.bs-collapsed .bs-body,#bskyStripperPanel.bs-collapsed .bs-modes{display:none}
      #bskyStripperPanel .bs-head{height:38px;display:flex;align-items:center;gap:8px;padding:0 10px;
        border-bottom:1px solid rgba(255,255,255,.1);background:#0b1826;cursor:default}
      #bskyStripperPanel .bs-title{flex:1;font-weight:900;color:#7cc7ff}
      #bskyStripperPanel .bs-pill{padding:2px 7px;border-radius:999px;background:rgba(30,144,255,.2);color:#dff2ff;font-weight:800;font-size:10px}
      #bskyStripperPanel .bs-iconBtn{width:28px;height:28px;min-height:28px;padding:0}
      #bskyStripperPanel .bs-modes{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px 0}
      #bskyStripperPanel .bs-body{display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0;overflow:auto}
      #bskyStripperPanel .bs-view{display:flex;flex-direction:column;gap:8px;min-height:0}
      #bskyStripperPanel .bs-view[hidden],#bskyStripperPanel .bs-follows[hidden]{display:none}
      #bskyStripperPanel button{appearance:none;width:100%;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#f4f9ff;font:700 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;cursor:pointer}
      #bskyStripperPanel button:hover:not(:disabled){background:rgba(30,144,255,.18);border-color:rgba(124,199,255,.55)}
      #bskyStripperPanel button:disabled{opacity:.42;cursor:default}
      #bskyStripperPanel #bsScan,.bs-modeBtn.is-active{background:#178bff;color:#fff;border-color:#7cc7ff}
      #bskyStripperPanel .bs-trackRow,.bs-rangeRow,.bs-savedHead{display:grid;grid-template-columns:1fr 96px;gap:6px}
      #bskyStripperPanel .bs-stack{display:grid;grid-template-columns:1fr;gap:6px}
      #bskyStripperPanel input{box-sizing:border-box;width:100%;height:32px;padding:0 9px;border-radius:8px;
        border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.24);color:#f4f9ff;font:700 12px/1 Arial,sans-serif;outline:none}
      #bskyStripperPanel input:focus{border-color:rgba(124,199,255,.72)}
      #bskyStripperPanel .bs-progress{display:block;flex:0 0 10px;height:10px;min-height:10px;border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      #bskyStripperPanel #bsFill{height:10px;width:0;background:linear-gradient(90deg,#178bff,#50e3c2);transition:width 120ms ease}
      #bskyStripperPanel .bs-meta{display:flex;justify-content:space-between;gap:10px;color:#b9cfe2;font-weight:700}
      #bskyStripperPanel .bs-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #bskyStripperPanel .bs-types{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
      #bskyStripperPanel .bs-chip{min-height:28px;font-size:11px;color:#b8c4ce}
      #bskyStripperPanel .bs-chip.is-on{background:rgba(30,144,255,.2);border-color:rgba(124,199,255,.55);color:#f4f9ff}
      #bskyStripperPanel .bs-follows{display:flex;flex-direction:column;gap:5px;padding:7px;border:1px solid rgba(255,255,255,.08);
        border-radius:8px;background:rgba(0,0,0,.16)}
      #bskyStripperPanel .bs-followsHead{display:grid;grid-template-columns:1fr auto 32px;gap:6px;align-items:center;color:#dff2ff;font-weight:900}
      #bskyStripperPanel .bs-subtle{color:#9bb5ca;font-size:10px;font-weight:800}
      #bskyStripperPanel .bs-list{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto}
      #bskyStripperPanel .bs-row{display:grid;grid-template-columns:1fr 38px 38px;gap:6px;align-items:center}
      #bskyStripperPanel .bs-rowText{min-width:0;display:flex;flex-direction:column;gap:1px;overflow:hidden}
      #bskyStripperPanel .bs-rowName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eef8ff;font-weight:800}
      #bskyStripperPanel .bs-rowMeta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#91aabe;font-size:10px;font-weight:700}
      #bskyStripperPanel .bs-row button,#bskyStripperPanel .bs-smallBtn{min-height:28px;padding:0 8px;font-size:11px}
      #bskyStripperPanel .bs-log{min-height:92px;max-height:190px;overflow:auto;border:1px solid rgba(255,255,255,.08);
        border-radius:8px;background:rgba(0,0,0,.2);padding:7px;color:#c2d4e4;white-space:pre-wrap}
      #bskyStripperPanel .bs-log div{margin:0 0 4px}
    `);
  }

  function setMode(mode) {
    const selected = mode === 'saved' ? 'saved' : 'download';
    ui.mode = selected;
    ui.downloadView.hidden = selected !== 'download';
    ui.savedView.hidden = selected !== 'saved';
    ui.modeBtns.forEach(btn => btn.classList.toggle('is-active', btn.dataset.mode === selected));
    if (selected === 'saved') renderSavedList();
  }

  function installRouteObserver() {
    let last = location.href;
    setInterval(() => {
      if (location.href === last) return;
      last = location.href;
      setProgress(0);
      logLine('Page changed. Press Scan for this Bluesky page.');
      syncUi();
    }, 600);
  }

  function scanContextFromLocation() {
    const parts = location.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    if (parts[0] !== 'profile' || !parts[1]) return null;
    const actor = normalizeActor(parts[1]);
    if (!actor) return null;
    if (parts[2] === 'post' && parts[3]) {
      return { type: 'post', actor, rkey: String(parts[3]).trim(), url: location.href };
    }
    return { type: 'profile', actor };
  }

  async function scanCurrent() {
    if (state.busy) return;
    const context = scanContextFromLocation();
    if (!context) {
      logLine('This page is not a Bluesky profile or post.');
      setProgress(0);
      return;
    }

    const cacheKey = scanCacheKey(context);
    if (cacheKey && state.loadedScanCacheKey !== cacheKey) {
      const cached = loadScanCache(cacheKey);
      if (cached) {
        applyCachedScan(cached, cacheKey);
        logLine(`Loaded cached Bluesky scan from ${formatCacheAge(cached.savedAt)}. Press Scan again to refresh it.`);
        return;
      }
    }

    resetScan(context);
    setBusy(true, 'Scanning...');
    setProgress(0);
    try {
      const profile = await fetchProfile(context.actor);
      state.actor = context.actor;
      state.did = profile.did || '';
      state.handle = profile.handle || context.actor;
      state.displayName = profile.displayName || '';
      state.userFolder = sanitizeUserFolder(state.handle || context.actor);
      logLine(`Resolved @${state.handle}.`);

      let rawPosts = [];
      if (context.type === 'post') {
        rawPosts = await fetchSinglePost(profile, context.rkey);
        logLine(`Fetched post ${context.rkey}.`);
      } else {
        const feed = await fetchAuthorFeed(context.actor);
        rawPosts = feed.posts;
        state.follows = await fetchFollows(context.actor);
        renderFollowsPanel();
        logLine(`Fetched ${rawPosts.length} post${rawPosts.length === 1 ? '' : 's'} and ${state.follows.length} followed account${state.follows.length === 1 ? '' : 's'}.`);
      }

      const built = buildDownloadSetFromRawPosts(rawPosts);
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
    state.did = '';
    state.handle = context.actor || '';
    state.displayName = '';
    state.userFolder = sanitizeUserFolder(context.actor || 'bluesky_account');
    state.posts = [];
    state.pages = [];
    state.files = [];
    state.follows = [];
    state.countTextOverride = '';
    state.fileProgressOverride = '';
    state.loadedScanCacheKey = '';
    renderFollowsPanel();
    syncUi();
  }

  async function fetchProfile(actor) {
    const url = xrpcUrl('app.bsky.actor.getProfile', { actor });
    return await requestJson(url);
  }

  async function fetchAuthorFeed(actor) {
    const posts = [];
    let cursor = '';
    let page = 0;
    while (page < MAX_API_PAGES) {
      page++;
      const url = xrpcUrl('app.bsky.feed.getAuthorFeed', {
        actor,
        limit: LISTING_LIMIT,
        filter: 'posts_with_replies'
      });
      if (cursor) url.searchParams.set('cursor', cursor);
      logLine(`Loading posts page ${page}${cursor ? '...' : '.'}`);
      const json = await requestJson(url.href);
      const feed = Array.isArray(json && json.feed) ? json.feed : [];
      feed.forEach(item => {
        if (item && item.post) posts.push({ ...item.post, __bsPage: page, __bsFeedItem: item });
      });
      cursor = json && json.cursor ? String(json.cursor) : '';
      setProgress(Math.min(72, page * 6));
      if (!cursor || !feed.length) break;
      await delay(API_DELAY_MS);
    }
    if (page >= MAX_API_PAGES) logLine(`Stopped at ${MAX_API_PAGES} API pages.`);
    return { posts };
  }

  async function fetchSinglePost(profile, rkey) {
    const did = profile && profile.did ? profile.did : '';
    if (!did) throw new Error('could not resolve actor DID');
    const uri = `at://${did}/app.bsky.feed.post/${encodeURIComponent(rkey)}`;
    const url = xrpcUrl('app.bsky.feed.getPosts');
    url.searchParams.append('uris', uri);
    const json = await requestJson(url.href);
    return Array.isArray(json && json.posts) ? json.posts.map(post => ({ ...post, __bsPage: 1 })) : [];
  }

  async function fetchFollows(actor) {
    const follows = [];
    let cursor = '';
    let page = 0;
    while (page < MAX_API_PAGES) {
      page++;
      const url = xrpcUrl('app.bsky.graph.getFollows', { actor, limit: LISTING_LIMIT });
      if (cursor) url.searchParams.set('cursor', cursor);
      const json = await requestJson(url.href);
      const rows = Array.isArray(json && json.follows) ? json.follows : [];
      rows.forEach(row => follows.push(normalizeFollow(row)));
      cursor = json && json.cursor ? String(json.cursor) : '';
      setProgress(Math.min(90, 72 + page * 3));
      if (!cursor || !rows.length) break;
      await delay(API_DELAY_MS);
    }
    return follows.filter(f => f.did || f.handle);
  }

  function normalizePost(raw) {
    if (!raw || !raw.uri) return null;
    const record = raw.record || {};
    const author = raw.author || {};
    const createdAt = record.createdAt || raw.indexedAt || '';
    const id = postIdFromUri(raw.uri);
    return {
      id,
      uri: raw.uri,
      cid: raw.cid || '',
      user: author.handle || state.handle || state.actor,
      did: author.did || state.did,
      displayName: author.displayName || '',
      text: String(record.text || '').trim(),
      title: postTitle(record.text, id),
      published: createdAt,
      createdUtc: unixFromIso(createdAt),
      page: Math.max(1, Number(raw.__bsPage || 1) || 1),
      raw
    };
  }

  function buildDownloadSetFromRawPosts(rawPosts) {
    const parsed = (Array.isArray(rawPosts) ? rawPosts : []).map(normalizePost).filter(Boolean);
    const mediaPosts = parsed
      .map(post => {
        const files = extractMediaFiles(post.raw);
        const md = buildPostTextFile(post, files.length > 0);
        if (md) files.push(md);
        return { ...post, files };
      })
      .filter(post => post.files.length > 0);
    return buildDedupedDownloads(mediaPosts);
  }

  function extractMediaFiles(rawPost) {
    const out = [];
    const seen = new Set();
    const add = (url, label, mime, extra) => {
      const normalized = normalizeDownloadUrl(url);
      if (!normalized) return;
      if (!isLikelyMediaUrl(normalized, mime, extra)) return;
      const key = canonicalMediaKey(normalized);
      if (seen.has(key)) return;
      seen.add(key);
      const ext = extra && extra.hls ? 'ts' : inferExt(normalized, mime);
      out.push({
        url: normalized,
        name: `${label || 'media'}.${ext}`,
        mime: mime || '',
        ext,
        hls: !!(extra && extra.hls)
      });
    };

    const visit = (embed, prefix) => {
      if (!embed || typeof embed !== 'object') return;
      const type = String(embed.$type || '');
      if (Array.isArray(embed.images)) {
        embed.images.forEach((image, idx) => {
          add(image && (image.fullsize || image.thumb), `${prefix || 'image'}_${String(idx + 1).padStart(3, '0')}`, 'image/jpeg');
        });
      }
      if (embed.video) {
        add(embed.playlist || '', `${prefix || 'video'}_001`, 'application/vnd.apple.mpegurl', { hls: true });
        if (!embed.playlist && embed.thumbnail) add(embed.thumbnail, `${prefix || 'video'}_thumbnail`, 'image/jpeg');
      } else if (type.includes('video') && embed.playlist) {
        add(embed.playlist, `${prefix || 'video'}_001`, 'application/vnd.apple.mpegurl', { hls: true });
      }
      if (embed.external && embed.external.thumb) {
        add(embed.external.thumb, `${prefix || 'external'}_thumb`, 'image/jpeg');
      }
      if (embed.media) visit(embed.media, 'media');
    };

    visit(rawPost && rawPost.embed, 'media');
    return out;
  }

  function buildPostTextFile(post, hasMedia) {
    const body = String(post.text || '').trim();
    if (!hasMedia && !body) return null;
    const title = post.title || `post_${post.id}`;
    const lines = [`# ${title}`, ''];
    const meta = [];
    if (post.user) meta.push(`- **Author:** @${post.user}`);
    if (post.displayName) meta.push(`- **Display name:** ${post.displayName}`);
    if (post.published) meta.push(`- **Posted:** ${String(post.published).slice(0, 10)}`);
    const url = postUrl(post);
    if (url) meta.push(`- **Link:** ${url}`);
    if (post.uri) meta.push(`- **URI:** ${post.uri}`);
    if (meta.length) lines.push(...meta, '');
    if (body) lines.push(body, '');
    return { kind: 'text', text: lines.join('\n'), ext: 'md', mime: 'text/markdown', url: '', name: 'post.md' };
  }

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
        uri: post.uri,
        user: post.user || state.handle || 'bluesky',
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
      const archiveName = buildArchiveName(state.userFolder, state.userFolder || 'bluesky_account');
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
    await saveBlob(blob, sanitizeDownloadPathForSave(archiveName || 'bluesky_archive.zip'));
    if (onProgress) onProgress(100);
  }

  async function fetchBlobWithRetry(file) {
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (file && file.hls) return await fetchHlsBlob(file.url);
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

  async function fetchHlsBlob(playlistUrl) {
    const finalPlaylist = await resolveHlsMediaPlaylist(playlistUrl);
    const text = await requestText(finalPlaylist);
    const parts = parseHlsMediaParts(text, finalPlaylist);
    if (!parts.length) throw new Error('HLS playlist had no downloadable segments');
    const blobs = [];
    for (const partUrl of parts) {
      blobs.push(await requestBlob(partUrl, HLS_TIMEOUT_MS));
      await delay(40);
    }
    return new Blob(blobs, { type: 'video/mp2t' });
  }

  async function resolveHlsMediaPlaylist(playlistUrl) {
    const text = await requestText(playlistUrl);
    const variants = parseHlsVariants(text, playlistUrl);
    if (!variants.length) return playlistUrl;
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    return variants[0].url;
  }

  function parseHlsVariants(text, baseUrl) {
    const lines = String(text || '').split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
      const bandwidth = Number((line.match(/BANDWIDTH=(\d+)/i) || [])[1]) || 0;
      let j = i + 1;
      while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j++;
      if (j < lines.length) out.push({ bandwidth, url: new URL(lines[j].trim(), baseUrl).href });
    }
    return out;
  }

  function parseHlsMediaParts(text, baseUrl) {
    const lines = String(text || '').split(/\r?\n/);
    const out = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('#EXT-X-MAP')) {
        const uri = (line.match(/URI="([^"]+)"/i) || [])[1];
        if (uri) out.push(new URL(uri, baseUrl).href);
        continue;
      }
      if (line.startsWith('#')) continue;
      out.push(new URL(line, baseUrl).href);
    }
    return out;
  }

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: String(url),
        anonymous: false,
        headers: { Accept: 'application/json' },
        timeout: 45000,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          try {
            resolve(JSON.parse(res.responseText || ''));
          } catch (err) {
            reject(err);
          }
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('request timeout'))
      });
    });
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: String(url),
        anonymous: false,
        timeout: 45000,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          resolve(String(res.responseText || ''));
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('request timeout'))
      });
    });
  }

  function requestBlob(url, timeout) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: String(url),
        anonymous: false,
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
      a.download = name.split('/').pop() || 'bluesky_archive.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      finish();
    });
  }

  function trackCurrentProfile() {
    const context = scanContextFromLocation();
    if (!context) {
      logLine('Open a Bluesky profile or post to track it.');
      return;
    }
    const actor = state.handle || context.actor;
    const saved = loadSavedAccounts();
    const id = normalizeActor(state.did || actor);
    if (!id) return;
    saved[id] = {
      did: state.did || '',
      handle: normalizeActor(actor),
      displayName: state.displayName || '',
      url: `https://bsky.app/profile/${encodeURIComponent(actor)}`,
      savedAt: Date.now()
    };
    saveSavedAccounts(saved);
    renderSavedList();
    syncUi();
    logLine(`Tracking @${actor}.`);
  }

  function removeCurrentProfile() {
    const context = scanContextFromLocation();
    if (!context) return;
    const saved = loadSavedAccounts();
    const key = savedAccountKeyForContext(context);
    if (!key || !saved[key]) {
      logLine('This profile is not tracked.');
      return;
    }
    const label = saved[key].handle || context.actor;
    delete saved[key];
    saveSavedAccounts(saved);
    renderSavedList();
    syncUi();
    logLine(`Removed @${label} from tracked accounts.`);
  }

  function trackScannedFollows() {
    if (!state.follows.length) {
      logLine('No follows were scanned.');
      return;
    }
    const saved = loadSavedAccounts();
    let added = 0;
    state.follows.forEach(follow => {
      const key = normalizeActor(follow.did || follow.handle);
      if (!key || savedAccountExistingKey(saved, follow)) return;
      saved[key] = { ...follow, savedAt: Date.now(), url: `https://bsky.app/profile/${encodeURIComponent(follow.handle || follow.did)}` };
      added++;
    });
    saveSavedAccounts(saved);
    renderSavedList();
    syncUi();
    logLine(added ? `Tracked ${added} followed account${added === 1 ? '' : 's'}.` : 'All scanned follows were already tracked.');
  }

  function renderFollowsPanel() {
    if (!ui.follows) return;
    const follows = state.follows || [];
    if (!follows.length) {
      ui.follows.hidden = true;
      ui.followList.innerHTML = '';
      return;
    }
    const saved = loadSavedAccounts();
    ui.followCount.textContent = String(follows.length);
    ui.followList.innerHTML = '';
    follows.slice(0, 160).forEach(follow => {
      ui.followList.appendChild(accountRow(follow, saved, true));
    });
    ui.follows.hidden = false;
  }

  function renderSavedList() {
    if (!ui.savedList) return;
    const query = String(ui.savedSearch && ui.savedSearch.value || '').trim().toLowerCase();
    const saved = loadSavedAccounts();
    const rows = Object.values(saved)
      .filter(row => !query || [row.handle, row.displayName, row.did].join(' ').toLowerCase().includes(query))
      .sort((a, b) => String(a.handle || a.did).localeCompare(String(b.handle || b.did)));
    ui.savedCount.hidden = rows.length === 0;
    ui.savedCount.textContent = rows.length;
    ui.savedList.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'bs-rowMeta';
      empty.textContent = query ? 'No tracked accounts match.' : 'No tracked accounts yet.';
      ui.savedList.appendChild(empty);
      return;
    }
    rows.forEach(row => ui.savedList.appendChild(accountRow(row, saved, false)));
  }

  function accountRow(account, saved, fromFollows) {
    const row = document.createElement('div');
    row.className = 'bs-row';
    const text = document.createElement('div');
    text.className = 'bs-rowText';
    const name = document.createElement('div');
    name.className = 'bs-rowName';
    name.textContent = account.handle ? `@${account.handle}` : account.did || 'unknown';
    const meta = document.createElement('div');
    meta.className = 'bs-rowMeta';
    meta.textContent = account.displayName || account.description || account.did || '';
    text.appendChild(name);
    text.appendChild(meta);

    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open';
    open.title = `Open ${account.handle || account.did}`;
    open.addEventListener('click', () => {
      location.href = `https://bsky.app/profile/${encodeURIComponent(account.handle || account.did)}`;
    });

    const action = document.createElement('button');
    action.type = 'button';
    const key = normalizeActor(account.did || account.handle);
    const isSaved = !!savedAccountExistingKey(saved, account);
    if (fromFollows) {
      action.textContent = isSaved ? 'On' : '+';
      action.disabled = isSaved;
      action.title = isSaved ? 'Already tracked' : 'Track account';
      action.addEventListener('click', () => {
        const current = loadSavedAccounts();
        if (key) {
          current[key] = { ...account, savedAt: Date.now(), url: `https://bsky.app/profile/${encodeURIComponent(account.handle || account.did)}` };
          saveSavedAccounts(current);
          renderFollowsPanel();
          renderSavedList();
          syncUi();
        }
      });
    } else {
      action.textContent = 'X';
      action.title = 'Remove tracked account';
      action.addEventListener('click', () => {
        const current = loadSavedAccounts();
        if (key) delete current[key];
        saveSavedAccounts(current);
        renderSavedList();
        syncUi();
      });
    }

    row.appendChild(text);
    row.appendChild(open);
    row.appendChild(action);
    return row;
  }

  function loadSavedAccounts() {
    try {
      const raw = typeof GM_getValue === 'function' ? GM_getValue(SAVED_KEY, '{}') : localStorage.getItem(SAVED_KEY);
      const parsed = JSON.parse(raw || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveSavedAccounts(value) {
    const raw = JSON.stringify(value || {});
    try {
      if (typeof GM_setValue === 'function') GM_setValue(SAVED_KEY, raw);
      else localStorage.setItem(SAVED_KEY, raw);
    } catch {}
  }

  function savedAccountKeyForContext(context) {
    const saved = loadSavedAccounts();
    const did = normalizeActor(state.did || '');
    if (did && saved[did]) return did;
    const actor = normalizeActor((state.handle || context.actor || ''));
    if (!actor) return '';
    const direct = Object.keys(saved).find(key => normalizeActor(key) === actor || normalizeActor(saved[key] && saved[key].handle) === actor);
    return direct || '';
  }

  function savedAccountExistingKey(saved, account) {
    const did = normalizeActor(account && account.did);
    const handle = normalizeActor(account && account.handle);
    return Object.keys(saved || {}).find(key => {
      const row = saved[key] || {};
      return (did && (normalizeActor(key) === did || normalizeActor(row.did) === did)) ||
        (handle && (normalizeActor(key) === handle || normalizeActor(row.handle) === handle));
    }) || '';
  }

  function isCurrentProfileTracked() {
    const context = scanContextFromLocation();
    if (!context) return false;
    return !!savedAccountKeyForContext(context);
  }

  function syncUi() {
    const context = scanContextFromLocation();
    const hasFiles = state.files.length > 0;
    const hasPosts = state.posts.length > 0;
    const hasPages = state.pages.length > 0;
    const isPost = state.scanType === 'post';
    const tracked = isCurrentProfileTracked();
    ui.scan.disabled = state.busy || !context;
    ui.track.disabled = state.busy || !context || tracked;
    ui.track.textContent = tracked ? 'Tracked' : 'Track Profile';
    ui.removeTrack.disabled = state.busy || !tracked;
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
    ui.scan.textContent = busy ? (scanLabel || 'Working...') : 'Scan';
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
    if (f.hls || mime.indexOf('video/') === 0 || /^(?:m3u8|m4v|mov|mp4|ts|webm)$/.test(ext)) return 'video';
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

  function xrpcUrl(method, params) {
    const url = new URL(method, API_BASE);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    return url;
  }

  function normalizeActor(actor) {
    return String(actor || '').trim().replace(/^@/, '').toLowerCase();
  }

  function normalizeFollow(row) {
    return {
      did: row && row.did ? String(row.did) : '',
      handle: normalizeActor(row && row.handle),
      displayName: row && row.displayName ? String(row.displayName) : '',
      description: row && row.description ? String(row.description) : ''
    };
  }

  function postIdFromUri(uri) {
    const raw = String(uri || '');
    const parts = raw.split('/');
    return parts[parts.length - 1] || raw.replace(/^at:\/\//, '').replace(/[^A-Za-z0-9._-]+/g, '_');
  }

  function postUrl(post) {
    const actor = post && post.user ? post.user : state.handle || state.actor;
    const id = post && post.id ? post.id : '';
    if (!actor || !id) return '';
    return `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(id)}`;
  }

  function postTitle(text, id) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean) return clean.slice(0, 80);
    return `post_${id || 'unknown'}`;
  }

  function unixFromIso(raw) {
    const ms = Date.parse(raw || '');
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
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

  function isLikelyMediaUrl(raw, mime, extra) {
    const url = normalizeDownloadUrl(raw);
    if (!url) return false;
    if (extra && extra.hls) return true;
    if (/^(?:image|video)\//i.test(mime || '')) return true;
    if (/mpegurl/i.test(mime || '')) return true;
    if (imgRE.test(url) || vidRE.test(url)) return true;
    try {
      const u = new URL(url);
      return /(?:^|\.)cdn\.bsky\.app$/i.test(u.hostname) || /(?:^|\.)video\.bsky\.app$/i.test(u.hostname);
    } catch {
      return false;
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
    if (cleanMime.includes('mpegurl')) return 'ts';
    if (cleanMime.includes('mp4')) return 'mp4';
    if (cleanMime.includes('webm')) return 'webm';
    return 'bin';
  }

  function getUrlExt(u) {
    const raw = normalizeDownloadUrl(u);
    if (!raw) return '';
    try {
      const url = new URL(raw, location.origin);
      const path = url.pathname || '';
      const dot = path.lastIndexOf('.');
      if (dot >= 0 && dot < path.length - 1) return path.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]+/gi, '');
    } catch {}
    return '';
  }

  function formatFilename(post, fileObj, index, globalIndex) {
    const user = post.user || state.handle || 'bluesky';
    const userSec = sanitizeUserFolder(user);
    const actorSec = sanitizeNamePart(user).slice(0, 40) || 'bluesky';
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
    return s || 'bluesky_account';
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

  function scanCacheKey(context) {
    if (!context) return '';
    if (context.type === 'post') return `post:${normalizeActor(context.actor)}:${String(context.rkey || '').toLowerCase()}`;
    if (context.type === 'profile') return `profile:${normalizeActor(context.actor)}`;
    return '';
  }

  function buildCachePayload() {
    return {
      scanType: state.scanType,
      actor: state.actor,
      did: state.did,
      handle: state.handle,
      displayName: state.displayName,
      userFolder: state.userFolder,
      posts: state.posts,
      pages: state.pages,
      files: state.files,
      follows: state.follows
    };
  }

  function applyCachedScan(cached, cacheKey) {
    const payload = cached && cached.payload ? cached.payload : {};
    state.scanType = payload.scanType || '';
    state.actor = payload.actor || '';
    state.did = payload.did || '';
    state.handle = payload.handle || state.actor;
    state.displayName = payload.displayName || '';
    state.userFolder = payload.userFolder || sanitizeUserFolder(state.handle || state.actor);
    state.posts = safeArray(payload.posts);
    state.pages = safeArray(payload.pages);
    state.files = safeArray(payload.files);
    state.follows = safeArray(payload.follows);
    state.loadedScanCacheKey = cacheKey;
    state.countTextOverride = '';
    state.fileProgressOverride = '';
    renderFollowsPanel();
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
