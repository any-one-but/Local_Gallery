// ==UserScript==
// @name         RedditGuest
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.02.00
// @description  Lightweight Reddit profile media downloader.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/RedditGuest.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/RedditGuest.user.js
// @match        *://reddit.com/*
// @match        *://*.reddit.com/*
// @match        *://redd.it/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      reddit.com
// @connect      *.reddit.com
// @connect      redd.it
// @connect      i.redd.it
// @connect      preview.redd.it
// @connect      external-preview.redd.it
// @connect      v.redd.it
// @connect      redditmedia.com
// @connect      *.redditmedia.com
// @connect      imgur.com
// @connect      i.imgur.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const JSZip = window.JSZip;
  const API_DELAY_MIN = 850;
  const API_DELAY_JITTER = 650;
  const FILE_DELAY_MS = 220;
  const MAX_API_PAGES = 500;
  const MAX_RETRIES = 2;
  const BACKOFF_BASE = 900;
  const BLOB_TIMEOUT_MS = 120000;
  const LISTING_LIMIT = 100;
  const USER_AGENT_NOTE = 'RedditGuest userscript';

  const imgRE = /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:$|[?#])/i;
  const vidRE = /\.(?:m4v|mov|mp4|webm)(?:$|[?#])/i;
  const directMediaHostRE = /(?:^|\.)((?:i|preview|external-preview)\.redd\.it|redditmedia\.com|imgur\.com)$/i;

  const state = {
    busy: false,
    scanType: '',
    username: '',
    userFolder: '',
    posts: [],
    pages: [],
    files: [],
    countTextOverride: '',
    lastScanAt: 0
  };

  const ui = {};

  GM_addStyle(`
    #redditGuestPanel {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      box-sizing: border-box;
      width: 320px;
      max-width: calc(100vw - 36px);
      max-height: min(520px, calc(100vh - 36px));
      overflow: visible;
      display: flex;
      flex-direction: column;
      gap: 9px;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 12px;
      background: rgba(18, 18, 21, 0.92);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.42);
      color: #f4f4f5;
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      backdrop-filter: blur(14px);
      transition: width 140ms ease, height 140ms ease, padding 140ms ease, border-radius 140ms ease, opacity 140ms ease;
    }
    #redditGuestPanel, #redditGuestPanel * {
      box-sizing: border-box;
    }
    #redditGuestPanel button {
      appearance: none;
      width: 100%;
      min-height: 32px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      background: #ff4500;
      color: #fff;
      font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
    }
    #redditGuestPanel button:hover:not(:disabled) {
      background: #ff5c1c;
      border-color: rgba(255, 255, 255, 0.28);
    }
    #redditGuestPanel button:disabled {
      cursor: default;
      opacity: 0.48;
    }
    #redditGuestPanel .rg-downloadStack {
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(100% + 8px);
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0;
      pointer-events: auto;
    }
    #redditGuestPanel .rg-downloadStack[hidden] {
      display: none;
    }
    #redditGuestPanel .rg-downloadStack button {
      min-height: 36px;
      background: rgba(255, 255, 255, 0.11);
      white-space: nowrap;
    }
    #redditGuestPanel .rg-downloadStack button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.17);
    }
    #redditGuestPanel .rg-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
      color: #c9c9cf;
      font-size: 11px;
    }
    #redditGuestPanel .rg-meta span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #redditGuestPanel .rg-progress {
      position: relative;
      height: 7px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
    }
    #redditGuestPanel .rg-progress > div {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #ff4500, #ffb000);
      transition: width 130ms ease;
    }
    #redditGuestPanel .rg-log {
      min-height: 86px;
      max-height: 190px;
      overflow: auto;
      padding: 8px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.23);
      color: #dedee3;
      font-size: 11px;
      scrollbar-width: thin;
    }
    #redditGuestPanel .rg-log div {
      padding: 0 0 5px;
      overflow-wrap: anywhere;
    }
    #redditGuestPanel .rg-log div:last-child {
      padding-bottom: 0;
    }
    #redditGuestPanel.rg-collapsed {
      right: 18px;
      bottom: 0;
      width: 320px;
      height: 10px;
      min-height: 10px;
      max-height: 10px;
      overflow: hidden;
      padding: 0;
      border-bottom: 0;
      border-radius: 8px 8px 0 0;
      opacity: 0.82;
      cursor: pointer;
    }
    #redditGuestPanel.rg-collapsed > * {
      display: none;
    }
    #redditGuestPanel.rg-collapsed::before {
      content: "";
      display: block;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #ff4500, #ffb000);
    }
  `);

  function init() {
    if (document.getElementById('redditGuestPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'redditGuestPanel';
    panel.innerHTML = `
      <div id="rgDownloadStack" class="rg-downloadStack" hidden>
        <button id="rgPostsBtn" type="button" disabled>Download Posts</button>
        <button id="rgPagesBtn" type="button" disabled>Download Pages</button>
        <button id="rgUserBtn" type="button" disabled>Download User</button>
      </div>
      <button id="rgScanBtn" type="button">Scan</button>
      <div class="rg-progress" aria-hidden="true"><div id="rgProgressFill"></div></div>
      <div class="rg-meta">
        <span id="rgProfileLabel">No profile scanned</span>
        <span id="rgCountLabel">0 files</span>
      </div>
      <div id="rgLog" class="rg-log" aria-live="polite"></div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.downloadStack = panel.querySelector('#rgDownloadStack');
    ui.scanBtn = panel.querySelector('#rgScanBtn');
    ui.postsBtn = panel.querySelector('#rgPostsBtn');
    ui.pagesBtn = panel.querySelector('#rgPagesBtn');
    ui.userBtn = panel.querySelector('#rgUserBtn');
    ui.fill = panel.querySelector('#rgProgressFill');
    ui.profileLabel = panel.querySelector('#rgProfileLabel');
    ui.countLabel = panel.querySelector('#rgCountLabel');
    ui.log = panel.querySelector('#rgLog');

    ui.scanBtn.addEventListener('click', () => scanCurrentProfile());
    ui.postsBtn.addEventListener('click', () => downloadPostArchives());
    ui.pagesBtn.addEventListener('click', () => downloadPageArchives());
    ui.userBtn.addEventListener('click', () => downloadUserArchive());
    panel.addEventListener('click', () => {
      if (panel.classList.contains('rg-collapsed')) setCollapsed(false);
    });
    document.addEventListener('keydown', handleGlobalKeydown, true);

    logLine('Ready. Open a Reddit profile or post and scan.');
    syncUi();
  }

  function syncUi() {
    const hasFiles = state.files.length > 0;
    const hasPages = state.pages.length > 0;
    const isPostScan = state.scanType === 'post';
    const isProfileScan = state.scanType === 'profile';
    ui.scanBtn.disabled = state.busy;
    ui.downloadStack.hidden = !hasFiles || (!isPostScan && !isProfileScan);
    ui.postsBtn.hidden = !hasFiles || (!isPostScan && !isProfileScan);
    ui.pagesBtn.hidden = !isProfileScan;
    ui.userBtn.hidden = !isProfileScan;
    ui.postsBtn.textContent = isPostScan ? 'Download Post' : 'Download Posts';
    ui.postsBtn.disabled = state.busy || !hasFiles;
    ui.pagesBtn.disabled = state.busy || !hasPages;
    ui.userBtn.disabled = state.busy || !hasFiles;
    ui.profileLabel.textContent = state.username ? `u/${state.username}` : 'No profile scanned';
    ui.countLabel.textContent = state.countTextOverride || `${state.files.length} file${state.files.length === 1 ? '' : 's'}`;
  }

  function setBusy(busy, scanLabel) {
    state.busy = !!busy;
    ui.scanBtn.textContent = scanLabel || (state.busy ? 'Working...' : 'Scan');
    syncUi();
  }

  function setProgress(value) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    ui.fill.style.width = `${pct}%`;
  }

  function setCountTextOverride(text) {
    state.countTextOverride = text || '';
    syncUi();
  }

  function formatUnitTicker(done, total, unit) {
    return `${done}/${total} ${unit}${total === 1 ? '' : 's'}`;
  }

  function logLine(text) {
    const el = document.createElement('div');
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    el.textContent = `[${hh}:${mm}:${ss}] ${text}`;
    ui.log.appendChild(el);
    while (ui.log.childNodes.length > 90) ui.log.removeChild(ui.log.firstChild);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function handleGlobalKeydown(evt) {
    if (!evt || evt.key !== 'Tab' || evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey) return;
    if (isEditableTarget(evt.target)) return;
    evt.preventDefault();
    setCollapsed(!ui.panel.classList.contains('rg-collapsed'));
  }

  function isEditableTarget(target) {
    const el = target && target.nodeType === 1 ? target : null;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!el.closest('[contenteditable=""], [contenteditable="true"]');
  }

  function setCollapsed(collapsed) {
    ui.panel.classList.toggle('rg-collapsed', !!collapsed);
  }

  function profileFromLocation() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    const marker = parts[0].toLowerCase();
    if (marker !== 'user' && marker !== 'u') return '';
    const name = decodeURIComponent(parts[1] || '').trim();
    if (!name || name === '[deleted]') return '';
    return name.replace(/^u\//i, '');
  }

  function postIdFromLocation() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (/^(?:www\.)?redd\.it$/i.test(location.hostname) && parts[0]) {
      return decodeURIComponent(parts[0]).trim();
    }
    if (parts[0] && parts[0].toLowerCase() === 'gallery' && parts[1]) {
      return decodeURIComponent(parts[1]).trim();
    }
    const idx = parts.findIndex(part => part.toLowerCase() === 'comments');
    if (idx < 0 || !parts[idx + 1]) return '';
    return decodeURIComponent(parts[idx + 1]).trim();
  }

  function scanContextFromLocation() {
    const postId = postIdFromLocation();
    if (postId) return { type: 'post', postId };
    const username = profileFromLocation();
    if (username) return { type: 'profile', username };
    return null;
  }

  async function scanCurrentProfile() {
    if (state.busy) return;
    const context = scanContextFromLocation();
    if (!context) {
      logLine('This page is not a Reddit user profile or post.');
      setProgress(0);
      return;
    }

    setBusy(true, 'Scanning...');
    setProgress(0);
    state.scanType = context.type;
    state.username = context.username || '';
    state.userFolder = state.username ? sanitizeUserFolder(state.username) : '';
    state.posts = [];
    state.pages = [];
    state.files = [];
    state.countTextOverride = '';
    state.lastScanAt = Date.now();
    syncUi();

    try {
      const rawPosts = context.type === 'post'
        ? await fetchSinglePost(context.postId)
        : await fetchSubmittedPosts(context.username);

      if (context.type === 'post') {
        const first = rawPosts[0] || {};
        state.username = first.author || state.username || context.username || 'reddit_user';
        state.userFolder = sanitizeUserFolder(state.username);
        logLine(`Fetched post ${context.postId} from u/${state.username}.`);
      } else {
        logLine(`Fetched ${rawPosts.length} submitted post${rawPosts.length === 1 ? '' : 's'} from u/${context.username}.`);
      }

      const parsed = rawPosts.map(normalizePost).filter(Boolean);
      const mediaPosts = parsed
        .map(post => ({ ...post, files: extractMediaFiles(post.raw) }))
        .filter(post => post.files.length > 0);

      const deduped = buildDedupedDownloads(mediaPosts);
      state.posts = deduped.posts;
      state.pages = deduped.pages;
      state.files = deduped.files;
      setProgress(100);
      logLine(`Scan complete: ${state.posts.length} post folder${state.posts.length === 1 ? '' : 's'}, ${state.pages.length} page archive${state.pages.length === 1 ? '' : 's'}, ${state.files.length} unique file${state.files.length === 1 ? '' : 's'}.`);
      if (deduped.duplicates > 0) {
        logLine(`Removed ${deduped.duplicates} duplicate file${deduped.duplicates === 1 ? '' : 's'}; oldest posts kept.`);
      }
    } catch (err) {
      setProgress(0);
      logLine(`Scan failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function fetchSubmittedPosts(username) {
    logLine(`Scanning u/${username} submitted posts.`);
    const posts = [];
    let after = '';
    let page = 0;

    while (page < MAX_API_PAGES) {
      page++;
      const url = new URL(`https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json`);
      url.searchParams.set('limit', String(LISTING_LIMIT));
      url.searchParams.set('raw_json', '1');
      if (after) url.searchParams.set('after', after);

      logLine(`Loading page ${page}${after ? '...' : '.'}`);
      const json = await requestJson(url.href);
      const children = json && json.data && Array.isArray(json.data.children) ? json.data.children : [];
      for (const child of children) {
        if (child && child.kind === 't3' && child.data) {
          posts.push({ ...child.data, __rgPage: page });
        }
      }

      after = json && json.data ? json.data.after : '';
      setProgress(Math.min(88, page * 8));
      if (!after || children.length === 0) break;
      await delay(API_DELAY_MIN + Math.floor(Math.random() * API_DELAY_JITTER));
    }

    if (page >= MAX_API_PAGES) {
      logLine(`Stopped at ${MAX_API_PAGES} API pages.`);
    }
    return posts;
  }

  async function fetchSinglePost(postId) {
    logLine(`Scanning single Reddit post ${postId}.`);
    const url = new URL(`https://www.reddit.com/comments/${encodeURIComponent(postId)}.json`);
    url.searchParams.set('raw_json', '1');
    const json = await requestJson(url.href);
    const listing = Array.isArray(json) ? json[0] : json;
    const children = listing && listing.data && Array.isArray(listing.data.children) ? listing.data.children : [];
    const post = children.find(child => child && child.kind === 't3' && child.data);
    return post && post.data ? [{ ...post.data, __rgPage: 1 }] : [];
  }

  function normalizePost(raw) {
    if (!raw || !raw.id) return null;
    const createdUtc = Number(raw.created_utc || raw.created || 0) || 0;
    return {
      id: String(raw.id),
      user: raw.author || state.username,
      title: raw.title || `post_${raw.id}`,
      subreddit: raw.subreddit || '',
      permalink: raw.permalink || '',
      published: createdUtc,
      createdUtc,
      page: Math.max(1, Number(raw.__rgPage || 1) || 1),
      raw
    };
  }

  function extractMediaFiles(post) {
    const out = [];
    const seen = new Set();
    const add = (url, label, mime, extra) => {
      const normalized = normalizeDownloadUrl(url);
      if (!normalized) return;
      if (!isLikelyMediaUrl(normalized, mime)) return;
      const key = canonicalMediaKey(normalized);
      if (seen.has(key)) return;
      seen.add(key);
      const ext = inferExt(normalized, mime);
      out.push({
        url: normalized,
        urls: extra && Array.isArray(extra.urls) ? extra.urls.map(normalizeDownloadUrl).filter(Boolean) : [normalized],
        manifestUrl: extra && extra.manifestUrl ? normalizeDownloadUrl(extra.manifestUrl) : '',
        name: `${label || 'media'}.${ext}`,
        mime: mime || '',
        ext
      });
    };

    const video = getRedditVideo(post);
    if (video) add(video, 'reddit_video', 'video/mp4');

    const gallery = extractGalleryMedia(post);
    gallery.forEach((item, idx) => add(item.url, `gallery_${String(idx + 1).padStart(3, '0')}`, item.mime, item));

    const dest = post.url_overridden_by_dest || post.url;
    if (!post.is_gallery) add(dest, 'media', '');

    const previewVideo = post.preview && post.preview.reddit_video_preview && post.preview.reddit_video_preview.fallback_url;
    if (previewVideo) add(previewVideo, 'reddit_video_preview', 'video/mp4');

    const previewImage = post.preview && Array.isArray(post.preview.images) && post.preview.images[0];
    if (previewImage) {
      if (previewImage.variants && previewImage.variants.gif && previewImage.variants.gif.source) {
        add(previewImage.variants.gif.source.url, 'preview_gif', 'image/gif');
      }
      if (previewImage.source) add(previewImage.source.url, 'preview', '');
    }

    return out;
  }

  function getRedditVideo(post) {
    const media = post.secure_media || post.media || {};
    if (media.reddit_video && media.reddit_video.fallback_url) return media.reddit_video.fallback_url;
    if (post.preview && post.preview.reddit_video_preview && post.preview.reddit_video_preview.fallback_url) {
      return post.preview.reddit_video_preview.fallback_url;
    }
    return '';
  }

  function extractGalleryMedia(post) {
    const metadata = post.media_metadata || {};
    const items = post.gallery_data && Array.isArray(post.gallery_data.items) ? post.gallery_data.items : [];
    const ids = items.length ? items.map(item => item.media_id).filter(Boolean) : Object.keys(metadata);
    const out = [];

    ids.forEach(id => {
      const meta = metadata[id];
      if (!meta || meta.status === 'failed') return;
      const mime = meta.m || '';
      if (meta.e === 'RedditVideo' || meta.dashUrl || meta.hlsUrl) {
        const urls = buildRedditVideoCandidates(meta.dashUrl || '', meta.y);
        if (urls.length) out.push({ url: urls[0], urls, manifestUrl: meta.dashUrl || '', mime: 'video/mp4' });
        return;
      }
      const source = meta.s || {};
      const url = source.mp4 || source.gif || source.u;
      if (url) out.push({ url, mime });
    });

    return out;
  }

  function buildDedupedDownloads(posts) {
    const sorted = posts
      .slice()
      .sort((a, b) => (a.createdUtc || 0) - (b.createdUtc || 0) || String(a.id).localeCompare(String(b.id)));
    const seen = new Set();
    const keptPosts = [];
    const keptFiles = [];
    let duplicates = 0;
    let globalIndex = 0;

    for (const post of sorted) {
      const postFiles = [];
      for (const file of post.files) {
        const key = canonicalMediaKey(file.url);
        if (!key) continue;
        if (seen.has(key)) {
          duplicates++;
          continue;
        }
        seen.add(key);
        postFiles.push(file);
      }
      if (!postFiles.length) continue;

      globalIndex++;
      const decorated = {
        id: post.id,
        user: post.user || state.username,
        title: post.title,
        subreddit: post.subreddit,
        permalink: post.permalink,
        published: post.published,
        createdUtc: post.createdUtc,
        page: Math.max(1, Number(post.page || 1) || 1),
        files: []
      };

      postFiles.forEach((file, idx) => {
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

    for (const post of posts) {
      const page = Math.max(1, Number(post.page || 1) || 1);
      if (!grouped.has(page)) {
        grouped.set(page, {
          page,
          posts: [],
          files: []
        });
      }

      const bucket = grouped.get(page);
      bucket.posts.push(post);
      bucket.files.push(...post.files);
    }

    return [...grouped.values()]
      .filter(page => page.files.length > 0)
      .sort((a, b) => a.page - b.page);
  }

  async function downloadPostArchives() {
    if (state.busy || !state.posts.length) return;
    setBusy(true, 'Downloading...');
    setProgress(0);
    setCountTextOverride(formatUnitTicker(0, state.posts.length, 'post'));
    try {
      let done = 0;
      for (const post of state.posts) {
        const firstFile = post.files[0];
        if (!firstFile) continue;
        const archiveName = buildArchiveName(firstFile.userFolder || state.userFolder, firstFile.postFolder);
        logLine(`Building post zip ${done + 1}/${state.posts.length}: ${firstFile.postFolder}`);
        await buildAndSaveArchive(post.files, archiveName, (pct, label) => {
          const base = (done / state.posts.length) * 100;
          const span = 100 / state.posts.length;
          setProgress(base + (pct / 100) * span);
          if (label) logLine(label);
        });
        done++;
        setCountTextOverride(formatUnitTicker(done, state.posts.length, 'post'));
        setProgress((done / state.posts.length) * 100);
        await delay(FILE_DELAY_MS);
      }
      logLine(`Downloaded ${done} post archive${done === 1 ? '' : 's'}.`);
    } catch (err) {
      logLine(`Post download failed: ${errorMessage(err)}`);
    } finally {
      setCountTextOverride('');
      setBusy(false);
    }
  }

  async function downloadPageArchives() {
    if (state.busy || !state.pages.length) return;
    setBusy(true, 'Downloading...');
    setProgress(0);
    setCountTextOverride(formatUnitTicker(0, state.pages.length, 'page'));
    try {
      let done = 0;
      for (const page of state.pages) {
        if (!page.files.length) continue;
        const archiveName = buildPageArchiveName(state.userFolder, page.page);
        logLine(`Building page zip ${done + 1}/${state.pages.length}: API page ${page.page}, ${page.posts.length} post${page.posts.length === 1 ? '' : 's'}, ${page.files.length} file${page.files.length === 1 ? '' : 's'}.`);
        await buildAndSaveArchive(page.files, archiveName, (pct, label) => {
          const base = (done / state.pages.length) * 100;
          const span = 100 / state.pages.length;
          setProgress(base + (pct / 100) * span);
          if (label) logLine(label);
        });
        done++;
        setCountTextOverride(formatUnitTicker(done, state.pages.length, 'page'));
        setProgress((done / state.pages.length) * 100);
        await delay(FILE_DELAY_MS);
      }
      logLine(`Downloaded ${done} page archive${done === 1 ? '' : 's'}.`);
    } catch (err) {
      logLine(`Page download failed: ${errorMessage(err)}`);
    } finally {
      setCountTextOverride('');
      setBusy(false);
    }
  }

  async function downloadUserArchive() {
    if (state.busy || !state.files.length) return;
    setBusy(true, 'Downloading...');
    setProgress(0);
    setCountTextOverride(formatUnitTicker(0, state.files.length, 'file'));
    try {
      const archiveName = buildArchiveName(state.userFolder, state.userFolder || 'reddit_user');
      logLine(`Building user zip for u/${state.username}.`);
      await buildAndSaveArchive(
        state.files,
        archiveName,
        (pct) => setProgress(pct),
        (done, total) => setCountTextOverride(formatUnitTicker(done, total, 'file'))
      );
      setProgress(100);
      logLine(`Downloaded user archive with ${state.files.length} file${state.files.length === 1 ? '' : 's'}.`);
    } catch (err) {
      logLine(`User download failed: ${errorMessage(err)}`);
    } finally {
      setCountTextOverride('');
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
        const blob = await fetchBlobWithRetry(file);
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

    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      meta => {
        const pct = Math.max(0, Math.min(100, Math.round(meta && meta.percent ? meta.percent : 0)));
        if (onProgress) onProgress(68 + Math.round((pct / 100) * 27));
      }
    );

    await saveBlob(blob, sanitizeDownloadPathForSave(archiveName || 'reddit_archive.zip'));
    if (onProgress) onProgress(100);
  }

  async function fetchBlobWithRetry(file) {
    const urls = Array.isArray(file && file.urls) && file.urls.length ? file.urls : [file && file.url ? file.url : file];
    let lastErr = null;
    const tryUrls = async (candidates) => {
      for (const url of candidates) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            return await requestBlob(url);
          } catch (err) {
            lastErr = err;
            if (attempt >= MAX_RETRIES) break;
            const backoff = BACKOFF_BASE * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
            await delay(backoff);
          }
        }
      }
      return null;
    };

    const direct = await tryUrls(urls);
    if (direct) return direct;

    if (file && file.manifestUrl) {
      const resolved = await resolveDashManifestCandidates(file.manifestUrl);
      const fromManifest = await tryUrls(resolved);
      if (fromManifest) return fromManifest;
    }

    throw lastErr || new Error('download failed');
  }

  async function resolveDashManifestCandidates(manifestUrl) {
    const text = await requestText(manifestUrl);
    const manifest = new URL(normalizeDownloadUrl(manifestUrl));
    const entries = [];
    const re = /<BaseURL>\s*([^<]+?\.mp4)\s*<\/BaseURL>/gi;
    let match;
    while ((match = re.exec(text))) {
      const raw = (match[1] || '').trim();
      if (!raw || /audio/i.test(raw)) continue;
      const hMatch = raw.match(/(?:CMAF|DASH)_(\d+)\.mp4/i);
      const height = hMatch ? Number(hMatch[1]) || 0 : 0;
      const url = new URL(raw, manifest.href);
      url.search = manifest.search;
      entries.push({ height, url: url.href });
    }
    entries.sort((a, b) => b.height - a.height);
    return entries.map(entry => entry.url);
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
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

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        headers: {
          Accept: 'application/json',
          'X-Requested-With': USER_AGENT_NOTE
        },
        timeout: 45000,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          try {
            const parsed = typeof res.response === 'object' && res.response ? res.response : JSON.parse(res.responseText || '');
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('request timeout'))
      });
    });
  }

  function requestBlob(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        responseType: 'blob',
        timeout: BLOB_TIMEOUT_MS,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          const blob = res.response;
          if (!blob || typeof blob.size !== 'number') {
            reject(new Error('empty response'));
            return;
          }
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
      a.download = name.split('/').pop() || 'reddit_archive.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      finish();
    });
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
      let path = decodeURIComponent(u.pathname || '').replace(/\/+$/, '');
      path = path.replace(/\/(?:CMAF|DASH)_\d+\.mp4$/i, '/VIDEO.mp4');
      return `${u.hostname.toLowerCase()}${path.toLowerCase()}`;
    } catch {
      return normalized.split('?')[0].toLowerCase();
    }
  }

  function isLikelyMediaUrl(raw, mime) {
    const url = normalizeDownloadUrl(raw);
    if (!url) return false;
    if (/^(?:image|video)\//i.test(mime || '')) return true;
    if (imgRE.test(url) || vidRE.test(url)) return true;
    try {
      const u = new URL(url);
      if (directMediaHostRE.test(u.hostname) && !/\/comments\//i.test(u.pathname)) return true;
      if (/\/DASH_\d+\.mp4$/i.test(u.pathname)) return true;
    } catch {}
    return false;
  }

  function buildRedditVideoCandidates(dashUrl, height) {
    const normalized = normalizeDownloadUrl(dashUrl);
    if (!normalized) return [];
    try {
      const url = new URL(normalized);
      if (!/\/DASHPlaylist\.mpd$/i.test(url.pathname)) return [];
      const maxHeight = Math.max(0, Number(height) || 0);
      const heights = [1080, 720, 480, 360, 240];
      const preferred = maxHeight ? heights.filter(h => h <= maxHeight) : heights;
      const order = preferred.length ? preferred : heights;
      const out = [];
      for (const h of order) {
        const cmaf = new URL(url.href);
        cmaf.pathname = cmaf.pathname.replace(/\/DASHPlaylist\.mpd$/i, `/CMAF_${h}.mp4`);
        out.push(cmaf.href);
        const dash = new URL(url.href);
        dash.pathname = dash.pathname.replace(/\/DASHPlaylist\.mpd$/i, `/DASH_${h}.mp4`);
        out.push(dash.href);
      }
      return [...new Set(out)];
    } catch {
      return [];
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
    if (/v\.redd\.it/i.test(raw || '')) return 'mp4';
    return 'bin';
  }

  function getUrlExt(u) {
    const raw = normalizeDownloadUrl(u);
    if (!raw) return '';
    try {
      const url = new URL(raw, location.origin);
      const path = url.pathname || '';
      const dot = path.lastIndexOf('.');
      if (dot >= 0 && dot < path.length - 1) {
        return path.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]+/gi, '');
      }
      const f = url.searchParams.get('f');
      if (f) {
        const fDot = f.lastIndexOf('.');
        if (fDot >= 0 && fDot < f.length - 1) {
          return f.slice(fDot + 1).toLowerCase().replace(/[^a-z0-9]+/gi, '');
        }
      }
    } catch {}
    return '';
  }

  function formatFilename(post, fileObj, index, globalIndex) {
    const user = post.user || state.username || 'reddit';
    const titleRaw = (post.title && post.title.trim()) ? post.title : (`post_${post.id}`);
    const threadRaw = user;
    const userSec = sanitizeUserFolder(user);
    let threadSec = sanitizeNamePart(threadRaw).slice(0, 40);
    if (!threadSec) threadSec = sanitizeNamePart(user).slice(0, 40);
    let titleSec = sanitizeNamePart(titleRaw).slice(0, 40);
    if (!titleSec) titleSec = sanitizeNamePart(`post_${post.id}`).slice(0, 40);
    const ext = fileObj.ext || getUrlExt(fileObj.name || fileObj.path || fileObj.url || '') || 'bin';
    const gPost = String(globalIndex || 0).padStart(6, '0');
    const fIdx = String(index || 0).padStart(6, '0');
    let dateSec = '000000';
    try {
      const raw = post.published || post.published_at || post.added || post.added_at || post.created || post.created_at || post.posted || post.posted_at;
      if (raw != null) {
        let d = null;
        if (typeof raw === 'number' && isFinite(raw)) {
          const ms = raw > 1e12 ? raw : (raw * 1000);
          d = new Date(ms);
        } else if (typeof raw === 'string' && raw.trim()) {
          d = new Date(raw);
        }
        if (d && isFinite(d.getTime())) {
          const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
          const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          dateSec = yy + mm + dd;
        }
      }
    } catch {}
    const base = `${dateSec}-${threadSec}-${gPost} - ${titleSec}`;
    const fileName = `${base}_${fIdx}.${ext}`;
    const postFolder = base;
    return `${userSec}/${postFolder}/${fileName}`;
  }

  function sanitizeUserFolder(s) {
    s = (s || '').normalize('NFC');
    s = s.replace(/\uFFFD/g, '');
    s = s.replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/\s+/g, '_');
    s = s.replace(/[\\/:*?"<>|]+/g, '');
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return s || 'reddit_user';
  }

  function sanitizeNamePart(s) {
    s = (s || '').normalize('NFC');
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
    const fallbackLeaf = 'download';
    const parts = String(rawPath || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean);
    if (!parts.length) return fallbackLeaf;
    return parts
      .map((seg, idx) => sanitizeFileNameStrict(seg, idx === parts.length - 1 ? fallbackLeaf : 'folder'))
      .join('/');
  }

  function splitDownloadPath(path) {
    const cleaned = (path || '').replace(/\\/g, '/');
    const parts = cleaned.split('/').filter(Boolean);
    const [userFolder, postFolder, ...rest] = parts;
    return {
      userFolder: userFolder || '',
      postFolder: postFolder || '',
      fileName: rest.join('/') || ''
    };
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
    const ext = inferExt(url, '');
    return `media_${String(index).padStart(6, '0')}.${ext}`;
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

  if (document.body) init();
  else window.addEventListener('DOMContentLoaded', init, { once: true });
})();