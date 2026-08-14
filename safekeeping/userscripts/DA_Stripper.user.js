// ==UserScript==
// @name         DA Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.04
// @description  DeviantArt profile, post, page, backlog, and profile-gallery downloader.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/DA_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/DA_Stripper.user.js
// @match        *://deviantart.com/*
// @match        *://*.deviantart.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      self
// @connect      deviantart.com
// @connect      *.deviantart.com
// @connect      wixmp.com
// @connect      *.wixmp.com
// @connect      images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com
// @connect      img-deviantart.wixmp.com
// @connect      st.deviantart.net
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (!/(?:^|\.)deviantart\.com$/i.test(location.hostname)) return;
  if (window.__daStripperLoaded) return;
  window.__daStripperLoaded = true;

  const API_LIMIT = 24;
  const MAX_API_PAGES = 500;
  const MAX_FOLDERS = 200;
  const API_DELAY_MS = 900;
  const FILE_DELAY_MS = 250;
  const MAX_RETRIES = 2;
  const BLOB_TIMEOUT_MS = 180000;
  const MEDIA_RE = /\.(?:avif|bmp|gif|jpe?g|m4v|mov|mp4|png|webm|webp)(?:[?#]|$)/i;
  const IMG_RE = /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#]|$)/i;
  const VID_RE = /\.(?:m4v|mov|mp4|webm)(?:[?#]|$)/i;
  const RESERVED_ROOTS = new Set([
    '', 'about', 'account', 'api', 'browse', 'chat', 'daily-deviations',
    'developers', 'forum', 'join', 'login', 'morelikethis', 'notifications',
    'popular-all-time', 'search', 'settings', 'shop', 'tag', 'users'
  ]);

  const state = {
    busy: false,
    context: null,
    scanType: '',
    username: '',
    userFolder: '',
    posts: [],
    pages: [],
    folders: [],
    files: [],
    log: []
  };

  const ui = {};
  const galleryQueue = [];
  const galleryQueuedIds = new Set();
  let galleryDownloadActive = false;
  let currentGalleryDownloadId = '';

  function init() {
    injectStyle();
    const panel = document.createElement('div');
    panel.id = 'daStripperPanel';
    panel.innerHTML = `
      <div class="das-head">
        <span class="das-title">DA Stripper</span>
        <button id="dasCollapse" class="das-iconBtn" type="button" title="Collapse">▴</button>
      </div>
      <div class="das-body">
        <button id="dasScan" type="button">Scan</button>
        <div class="das-progress"><div id="dasFill"></div></div>
        <div class="das-meta">
          <span id="dasProfile">No profile scanned</span>
          <span id="dasCount">0 files</span>
        </div>
        <div class="das-stack">
          <button id="dasPost" type="button" disabled>Download Post</button>
          <button id="dasPosts" type="button" disabled>Download All Posts</button>
          <button id="dasPages" type="button" disabled>Download All Pages</button>
          <button id="dasBacklog" type="button" disabled>Download Backlog</button>
        </div>
        <div class="das-types">
          <button class="das-chip is-on" type="button" data-kind="image" aria-checked="true">Images</button>
          <button class="das-chip is-on" type="button" data-kind="video" aria-checked="true">Videos</button>
          <button class="das-chip" type="button" data-kind="text" aria-checked="false">Text</button>
        </div>
        <div id="dasGalleryList" class="das-galleryList" hidden></div>
        <div id="dasLog" class="das-log" aria-live="polite"></div>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.scan = panel.querySelector('#dasScan');
    ui.fill = panel.querySelector('#dasFill');
    ui.profile = panel.querySelector('#dasProfile');
    ui.count = panel.querySelector('#dasCount');
    ui.post = panel.querySelector('#dasPost');
    ui.posts = panel.querySelector('#dasPosts');
    ui.pages = panel.querySelector('#dasPages');
    ui.backlog = panel.querySelector('#dasBacklog');
    ui.galleryList = panel.querySelector('#dasGalleryList');
    ui.log = panel.querySelector('#dasLog');
    ui.chips = Array.from(panel.querySelectorAll('.das-chip'));

    ui.scan.addEventListener('click', scanCurrent);
    ui.post.addEventListener('click', () => downloadPostArchives(state.posts.slice(0, 1), { includeAllFileTypes: true }));
    ui.posts.addEventListener('click', () => downloadPostArchives());
    ui.pages.addEventListener('click', () => downloadPageArchives());
    ui.backlog.addEventListener('click', () => downloadBacklogArchive());
    panel.querySelector('#dasCollapse').addEventListener('click', () => {
      panel.classList.toggle('das-collapsed');
      panel.querySelector('#dasCollapse').textContent = panel.classList.contains('das-collapsed') ? '▾' : '▴';
    });
    ui.chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const on = chip.getAttribute('aria-checked') === 'true';
        chip.setAttribute('aria-checked', on ? 'false' : 'true');
        chip.classList.toggle('is-on', !on);
      });
    });

    installRouteObserver();
    logLine('Ready. Open a DeviantArt profile or post.');
    syncUi();
  }

  function injectStyle() {
    GM_addStyle(`
      #daStripperPanel{position:fixed;right:16px;top:92px;z-index:2147483646;width:320px;max-height:78vh;
        display:flex;flex-direction:column;border:1px solid rgba(0,230,154,.32);border-radius:10px;
        background:#060b0f;color:#f4fffb;box-shadow:0 18px 60px rgba(0,0,0,.45);font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #daStripperPanel.das-collapsed{height:auto}
      #daStripperPanel.das-collapsed .das-body{display:none}
      #daStripperPanel .das-head{height:38px;display:flex;align-items:center;gap:8px;padding:0 10px;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#071b18,#0c1017);cursor:default}
      #daStripperPanel .das-title{font-weight:900;letter-spacing:0;color:#00e59b}
      #daStripperPanel .das-iconBtn{margin-left:auto;width:28px;height:28px;min-height:28px;padding:0;border-radius:7px}
      #daStripperPanel .das-body{display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0;overflow:auto}
      #daStripperPanel button{appearance:none;width:100%;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
        border-radius:8px;background:rgba(255,255,255,.08);color:#f4fffb;font:700 12px/1 Arial,sans-serif;cursor:pointer}
      #daStripperPanel button:hover:not(:disabled){background:rgba(0,230,154,.16);border-color:rgba(0,230,154,.48)}
      #daStripperPanel button:disabled{opacity:.42;cursor:default}
      #daStripperPanel #dasScan{background:#00c987;color:#02100b;border-color:#00e59b}
      #daStripperPanel .das-progress{display:block;box-sizing:border-box;flex:0 0 10px;height:10px;min-height:10px;
        border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}
      #daStripperPanel #dasFill{display:block;height:10px;min-height:10px;width:0;background:linear-gradient(90deg,#00e59b,#6ee7ff);transition:width 120ms ease}
      #daStripperPanel .das-meta{display:flex;justify-content:space-between;gap:10px;color:#b7c8c2;font-weight:700}
      #daStripperPanel .das-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #daStripperPanel .das-stack{display:grid;grid-template-columns:1fr;gap:6px}
      #daStripperPanel input{box-sizing:border-box;width:100%;height:32px;padding:0 9px;border-radius:8px;
        border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.24);color:#f4fffb;font:700 12px/1 Arial,sans-serif;outline:none}
      #daStripperPanel input:focus{border-color:rgba(0,230,154,.62)}
      #daStripperPanel .das-types{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
      #daStripperPanel .das-chip{min-height:28px;font-size:11px;color:#a8bbb4}
      #daStripperPanel .das-chip.is-on{background:rgba(0,230,154,.18);border-color:rgba(0,230,154,.52);color:#ecfff9}
      #daStripperPanel .das-galleryList{display:flex;flex-direction:column;gap:5px;padding:7px;border:1px solid rgba(255,255,255,.08);
        border-radius:8px;background:rgba(0,0,0,.16)}
      #daStripperPanel .das-galleryList[hidden]{display:none}
      #daStripperPanel .das-galleryHead{display:flex;align-items:center;justify-content:space-between;gap:8px;
        color:#d6fff2;font-weight:900}
      #daStripperPanel .das-galleryRows{display:flex;flex-direction:column;gap:4px;max-height:170px;overflow:auto}
      #daStripperPanel .das-galleryRow{display:grid;grid-template-columns:1fr 86px;gap:6px;align-items:center}
      #daStripperPanel .das-galleryName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e8fff8;font-weight:700}
      #daStripperPanel .das-galleryMeta{font-size:10px;color:#8fa49d;font-weight:700}
      #daStripperPanel .das-galleryRow button{min-height:28px;padding:0 8px;font-size:11px}
      #daStripperPanel .das-galleryRow button.is-queued{color:#02100b;background:#8feccf;border-color:#8feccf}
      #daStripperPanel .das-galleryRow button.is-active{color:#02100b;background:#00c987;border-color:#00e59b}
      #daStripperPanel .das-log{min-height:88px;max-height:190px;overflow:auto;border:1px solid rgba(255,255,255,.08);
        border-radius:8px;background:rgba(0,0,0,.2);padding:7px;color:#b9c9c4;white-space:pre-wrap}
      #daStripperPanel .das-log div{margin:0 0 4px}
    `);
  }

  function installRouteObserver() {
    let last = location.href;
    setInterval(() => {
      if (location.href === last) return;
      last = location.href;
      setProgress(0);
      logLine('Page changed. Press Scan for this DeviantArt page.');
      syncUi();
    }, 600);
  }

  function scanContextFromLocation() {
    const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return null;
    const first = String(parts[0] || '').trim();
    if (!first || RESERVED_ROOTS.has(first.toLowerCase())) return null;

    if (parts[1] && parts[1].toLowerCase() === 'art') {
      const id = postIdFromPath(parts);
      return id ? { type: 'post', username: first, postId: id, url: location.href } : null;
    }

    if (parts[1] && parts[1].toLowerCase() === 'gallery') {
      return { type: 'profile', username: first };
    }

    if (parts.length === 1 || ['about', 'gallery', 'posts'].includes(String(parts[1] || '').toLowerCase())) {
      return { type: 'profile', username: first };
    }

    return null;
  }

  function postIdFromPath(parts) {
    const tail = parts[parts.length - 1] || '';
    const match = String(tail).match(/-(\d+)(?:[?#].*)?$/);
    return match ? match[1] : '';
  }

  async function scanCurrent() {
    if (state.busy) return;
    const context = scanContextFromLocation();
    if (!context) {
      logLine('This is not a DeviantArt profile or post page.');
      setProgress(0);
      return;
    }

    resetScan(context);
    setBusy(true, 'Scanning...');
    setProgress(0);
    try {
      if (context.type === 'post') {
        const post = await fetchSinglePost(context);
        applyPosts([post], []);
        logLine(`Scanned post ${context.postId}.`);
      } else {
        const all = await fetchAllProfileGallery(context.username);
        applyPosts(all.posts, all.folders);
        logLine(`Scanned ${context.username}: ${all.posts.length} unique post${all.posts.length === 1 ? '' : 's'}, ${all.folders.length} profile galler${all.folders.length === 1 ? 'y' : 'ies'}.`);
      }
      setProgress(100);
      logLine(`Scan complete: ${state.posts.length} post folder${state.posts.length === 1 ? '' : 's'}, ${state.pages.length} page archive${state.pages.length === 1 ? '' : 's'}, ${state.files.length} file${state.files.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setProgress(0);
      logLine(`Scan failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function resetScan(context) {
    state.context = context;
    state.scanType = context.type;
    state.username = context.username || '';
    state.userFolder = sanitizeFolder(state.username || 'deviantart');
    state.posts = [];
    state.pages = [];
    state.folders = [];
    state.files = [];
    state.log = [];
    galleryQueue.length = 0;
    galleryQueuedIds.clear();
    currentGalleryDownloadId = '';
    syncUi();
  }

  async function fetchAllProfileGallery(username) {
    logLine(`Scanning ${username}'s all-gallery backlog.`);
    const allPages = await fetchGalleryContents(username, { allFolder: true });
    const folders = await fetchGalleryFolders(username);
    const folderResults = [];
    let i = 0;
    for (const folderInfo of folders.slice(0, MAX_FOLDERS)) {
      i++;
      logLine(`Scanning gallery ${i}/${folders.length}: ${folderInfo.name}.`);
      const folderPages = await fetchGalleryContents(username, {
        folderId: folderInfo.folderId,
        folderName: folderInfo.name,
        progressBase: 20 + Math.min(60, Math.round((i / Math.max(1, folders.length)) * 60))
      });
      folderResults.push({
        id: String(folderInfo.folderId),
        name: folderInfo.name,
        pages: folderPages.pages,
        posts: folderPages.posts,
        files: folderPages.files
      });
      await delay(API_DELAY_MS);
    }
    if (folders.length > MAX_FOLDERS) logLine(`Stopped gallery-folder scan at ${MAX_FOLDERS} folders.`);
    return { posts: allPages.posts, pages: allPages.pages, files: allPages.files, folders: folderResults };
  }

  async function fetchGalleryFolders(username) {
    const out = [];
    let offset = 0;
    let page = 0;
    while (page < MAX_API_PAGES) {
      page++;
      const url = puppyUrl('/_puppy/dashared/gallection/folders', {
        username,
        type: 'gallery',
        offset,
        limit: API_LIMIT
      });
      const json = await requestJson(url);
      const results = Array.isArray(json.results) ? json.results : [];
      results.forEach(folder => {
        if (!folder || folder.folderId == null) return;
        out.push({
          folderId: String(folder.folderId),
          name: String(folder.name || `folder_${folder.folderId}`).trim() || `folder_${folder.folderId}`
        });
      });
      if (!json.hasMore || !results.length || json.nextOffset == null) break;
      offset = Number(json.nextOffset) || (offset + results.length);
      await delay(API_DELAY_MS);
    }
    return out;
  }

  async function fetchGalleryContents(username, options) {
    const opts = options || {};
    const rawPosts = [];
    const pages = [];
    let offset = 0;
    let page = 0;
    let gallection = null;

    while (page < MAX_API_PAGES) {
      page++;
      const params = {
        username,
        type: 'gallery',
        offset,
        limit: API_LIMIT
      };
      if (opts.allFolder) params.all_folder = 'true';
      if (opts.folderId) params.folderid = opts.folderId;
      const json = await requestJson(puppyUrl('/_puppy/dashared/gallection/contents', params));
      gallection = gallection || json.gallection || null;
      const results = (Array.isArray(json.results) ? json.results : [])
        .map(item => item && (item.deviation || item))
        .filter(Boolean);
      const normalized = results.map((dev, idx) => normalizeDeviation(dev, {
        username,
        page,
        folderId: opts.folderId || '',
        folderName: opts.folderName || (json.gallection && json.gallection.name) || (opts.allFolder ? 'All' : 'Gallery'),
        indexInPage: idx + 1
      })).filter(Boolean);
      rawPosts.push(...normalized);
      pages.push({ page, folderId: opts.folderId || '', folderName: opts.folderName || '', posts: normalized, files: [] });
      setProgress(Math.min(88, opts.progressBase || Math.round(page * 3)));
      if (!json.hasMore || !results.length || json.nextOffset == null) break;
      offset = Number(json.nextOffset) || (offset + results.length);
      await delay(API_DELAY_MS);
    }

    const decorated = decoratePosts(rawPosts);
    const filesByPost = new Map(decorated.posts.map(post => [post.id, post.files]));
    pages.forEach(bucket => {
      bucket.files = [];
      bucket.posts = bucket.posts
        .map(post => decorated.posts.find(item => item.id === post.id))
        .filter(Boolean);
      bucket.posts.forEach(post => bucket.files.push(...(filesByPost.get(post.id) || [])));
    });
    return {
      gallection,
      posts: decorated.posts,
      pages: pages.filter(pageItem => pageItem.files.length > 0),
      files: decorated.files
    };
  }

  async function fetchSinglePost(context) {
    let html = '';
    if (sameUrl(context.url, location.href)) html = document.documentElement.outerHTML;
    else html = await requestText(context.url);
    const parsed = parseSinglePostHtml(html, context);
    if (!parsed) throw new Error('could not find media metadata on this post page');
    return normalizeDeviation(parsed, {
      username: context.username,
      page: 1,
      folderName: 'Post',
      indexInPage: 1
    });
  }

  function parseSinglePostHtml(html, context) {
    const id = String(context.postId || '');
    const graph = [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const json = JSON.parse(script.textContent || '');
        if (json && Array.isArray(json['@graph'])) graph.push(...json['@graph']);
        else if (json) graph.push(json);
      } catch {}
    });
    const entity = graph.find(item => item && item['@id'] && String(item['@id']).includes('#deviation'))
      || graph.find(item => item && (item.contentUrl || item.thumbnailUrl));
    if (entity) {
      const authorName = entity.creator && (entity.creator.name || entity.creator.url && entity.creator.url.split('/').pop());
      return {
        deviationId: id,
        type: entity.contentUrl && VID_RE.test(entity.contentUrl) ? 'video' : 'image',
        title: cleanTitle(String(entity.name || document.title || `deviation_${id}`).replace(/\s+by\s+.+?\s+on\s+DeviantArt$/i, '')),
        url: context.url,
        publishedTime: entity.datePublished || entity.uploadDate || '',
        isDownloadable: true,
        isJournal: false,
        isVideo: !!(entity.contentUrl && VID_RE.test(entity.contentUrl)),
        author: { username: authorName || context.username || 'deviantart' },
        stats: {},
        mediaUrl: entity.contentUrl || entity.thumbnailUrl || '',
        previewUrl: entity.thumbnailUrl || '',
        description: entity.description || ''
      };
    }

    const ogImage = metaContent(doc, 'property', 'og:image') || metaContent(doc, 'name', 'twitter:image');
    const ogVideo = metaContent(doc, 'property', 'og:video') || metaContent(doc, 'property', 'og:video:url');
    const title = metaContent(doc, 'property', 'og:title') || document.title || `deviation_${id}`;
    if (!ogImage && !ogVideo) return null;
    return {
      deviationId: id,
      type: ogVideo ? 'video' : 'image',
      title: cleanTitle(title.replace(/\s+by\s+.+?\s+on\s+DeviantArt$/i, '')),
      url: context.url,
      publishedTime: '',
      isDownloadable: true,
      isVideo: !!ogVideo,
      author: { username: context.username || 'deviantart' },
      mediaUrl: ogVideo || ogImage,
      previewUrl: ogImage || '',
      description: metaContent(doc, 'name', 'description') || ''
    };
  }

  function normalizeDeviation(dev, extra) {
    if (!dev) return null;
    const id = String(dev.deviationId || dev.deviationid || extra.id || '').trim();
    if (!id) return null;
    const author = dev.author && dev.author.username ? dev.author.username : (extra.username || 'deviantart');
    const title = cleanTitle(dev.title || `deviation_${id}`);
    const post = {
      id,
      user: author,
      title,
      url: dev.url || extra.url || '',
      type: dev.type || '',
      isJournal: !!dev.isJournal,
      isVideo: !!dev.isVideo || String(dev.type || '').toLowerCase() === 'video',
      isMature: !!dev.isMature,
      isDownloadable: !!dev.isDownloadable,
      published: dev.publishedTime || dev.published || '',
      page: Math.max(1, Number(extra.page || 1) || 1),
      folderId: String(extra.folderId || ''),
      folderName: extra.folderName || '',
      files: [],
      raw: dev
    };
    post.files = extractDeviationFiles(post, dev);
    const md = buildMetadataFile(post, dev);
    if (md) post.files.push(md);
    return post.files.length ? post : null;
  }

  function extractDeviationFiles(post, dev) {
    const out = [];
    const mediaObjects = collectMediaObjects(dev);
    if (dev.mediaUrl) {
      out.push({
        kind: VID_RE.test(dev.mediaUrl) ? 'video' : 'image',
        url: normalizeUrl(dev.mediaUrl),
        urls: [normalizeUrl(dev.mediaUrl), normalizeUrl(dev.previewUrl)].filter(Boolean),
        ext: inferExt(dev.mediaUrl, post.isVideo ? 'video/mp4' : ''),
        mime: post.isVideo ? 'video/mp4' : '',
        label: 'media'
      });
    }
    mediaObjects.forEach((media, idx) => {
      const candidates = mediaCandidates(media);
      if (!candidates.length) return;
      const url = candidates[0];
      out.push({
        kind: VID_RE.test(url) ? 'video' : 'image',
        url,
        urls: candidates,
        ext: inferExt(url, ''),
        mime: VID_RE.test(url) ? 'video/mp4' : '',
        label: media.prettyName || `media_${idx + 1}`
      });
    });
    return dedupeFiles(out).filter(file => file.url && isLikelyMediaUrl(file.url));
  }

  function collectMediaObjects(root) {
    const out = [];
    const seen = new Set();
    const walk = (value, depth) => {
      if (!value || typeof value !== 'object' || depth > 5) return;
      if (value.baseUri && value.prettyName && !seen.has(value.baseUri)) {
        seen.add(value.baseUri);
        out.push(value);
      }
      if (Array.isArray(value)) value.forEach(item => walk(item, depth + 1));
      else Object.keys(value).forEach(key => walk(value[key], depth + 1));
    };
    walk(root, 0);
    return out;
  }

  function mediaCandidates(media) {
    const base = normalizeUrl(media && media.baseUri);
    if (!base) return [];
    const tokens = Array.isArray(media.token) ? media.token : (media.token ? [media.token] : []);
    const candidates = [];
    const videoTypes = (Array.isArray(media.types) ? media.types : [])
      .filter(type => type && String(type.t || '').toLowerCase() === 'video' && type.b)
      .sort((a, b) => (Number(b.h) || 0) - (Number(a.h) || 0));
    videoTypes.forEach(type => candidates.push(type.b));
    tokens.forEach(token => {
      if (token) candidates.push(addToken(base, token));
    });
    const full = bestMediaType(media, 'fullview') || bestMediaType(media, 'preview') || bestMediaType(media, 'social_preview');
    if (full) {
      if (full.c) candidates.push(addToken(base + String(full.c).replace('<prettyName>', media.prettyName || ''), tokens[0]));
      else candidates.push(addToken(base, tokens[0]));
    }
    const previews = (Array.isArray(media.types) ? media.types : [])
      .filter(type => type && type.c)
      .sort((a, b) => ((b.w || 0) * (b.h || 0)) - ((a.w || 0) * (a.h || 0)))
      .slice(0, 3);
    previews.forEach(type => candidates.push(addToken(base + String(type.c).replace('<prettyName>', media.prettyName || ''), tokens[0])));
    candidates.push(addToken(base, tokens[0]));
    return [...new Set(candidates.map(normalizeUrl).filter(Boolean))];
  }

  function bestMediaType(media, name) {
    const types = Array.isArray(media && media.types) ? media.types : [];
    return types.find(type => String(type.t || '').toLowerCase() === String(name).toLowerCase()) || null;
  }

  function addToken(url, token) {
    const normalized = normalizeUrl(url);
    if (!normalized || !token) return normalized;
    try {
      const u = new URL(normalized, location.origin);
      if (!u.searchParams.has('token')) u.searchParams.set('token', token);
      return u.href;
    } catch {
      return normalized;
    }
  }

  function buildMetadataFile(post, dev) {
    const lines = [`# ${post.title}`, ''];
    lines.push(`- **Author:** ${post.user}`);
    lines.push(`- **Deviation ID:** ${post.id}`);
    if (post.published) lines.push(`- **Published:** ${post.published}`);
    if (post.url) lines.push(`- **Link:** ${post.url}`);
    if (post.folderName) lines.push(`- **Gallery:** ${post.folderName}`);
    if (post.isMature) lines.push('- **Mature:** yes');
    const stats = dev.stats || {};
    const statBits = [];
    if (stats.views != null) statBits.push(`${stats.views} views`);
    if (stats.favourites != null) statBits.push(`${stats.favourites} favourites`);
    if (stats.comments != null) statBits.push(`${stats.comments} comments`);
    if (statBits.length) lines.push(`- **Stats:** ${statBits.join(', ')}`);
    const desc = String(dev.description || dev.excerpt || '').trim();
    if (desc) lines.push('', desc);
    lines.push('');
    return { kind: 'text', text: lines.join('\n'), ext: 'md', mime: 'text/markdown', url: '', label: 'metadata' };
  }

  function decoratePosts(posts) {
    const sorted = (Array.isArray(posts) ? posts : [])
      .slice()
      .sort((a, b) => dateMs(a.published) - dateMs(b.published) || String(a.id).localeCompare(String(b.id)));
    const seenPost = new Set();
    const seenMedia = new Set();
    const kept = [];
    const files = [];
    let globalIndex = 0;
    for (const post of sorted) {
      if (!post || seenPost.has(post.id)) continue;
      seenPost.add(post.id);
      const postFiles = [];
      for (const file of post.files || []) {
        if (file.kind !== 'text') {
          const key = canonicalMediaKey(file.url);
          if (!key || seenMedia.has(key)) continue;
          seenMedia.add(key);
        }
        postFiles.push(file);
      }
      if (!postFiles.length) continue;
      globalIndex++;
      const decorated = { ...post, files: [] };
      postFiles.forEach((file, idx) => {
        const path = formatDownloadPath(decorated, file, idx + 1, globalIndex);
        const parts = splitPath(path);
        const item = {
          ...file,
          name: path,
          userFolder: parts.userFolder,
          postFolder: parts.postFolder,
          fileName: parts.fileName,
          postId: decorated.id
        };
        decorated.files.push(item);
        files.push(item);
      });
      kept.push(decorated);
    }
    return { posts: kept, files };
  }

  function applyPosts(posts, folders) {
    const decorated = decoratePosts(posts);
    state.posts = decorated.posts;
    state.files = decorated.files;
    state.pages = buildPages(state.posts);
    state.folders = (Array.isArray(folders) ? folders : []).map(folder => {
      const folderDecorated = decoratePosts(folder.posts || []);
      return {
        id: folder.id || '',
        name: folder.name || 'Gallery',
        posts: folderDecorated.posts,
        pages: buildPages(folderDecorated.posts),
        files: folderDecorated.files
      };
    }).filter(folder => folder.files.length > 0);
    syncUi();
  }

  function buildPages(posts) {
    const grouped = new Map();
    (posts || []).forEach(post => {
      const key = String(Math.max(1, Number(post.page) || 1));
      if (!grouped.has(key)) grouped.set(key, { page: Number(key), posts: [], files: [] });
      const page = grouped.get(key);
      page.posts.push(post);
      page.files.push(...(post.files || []));
    });
    return Array.from(grouped.values()).sort((a, b) => a.page - b.page);
  }

  async function downloadPostArchives(selectedPosts, options) {
    const posts = Array.isArray(selectedPosts) ? selectedPosts : state.posts;
    const includeAllFileTypes = !!(options && options.includeAllFileTypes);
    const items = posts
      .map(post => ({ post, files: includeAllFileTypes ? (post.files || []) : filterFilesByType(post.files || []) }))
      .filter(item => item.files.length > 0);
    if (state.busy || !items.length) return;
    await runArchiveBatch(items, 'post', async (item, idx, total) => {
      const first = item.files[0];
      logLine(`Building post zip ${idx}/${total}: ${item.post.title}.`);
      await buildAndSaveArchive(item.files, buildArchiveName(first.userFolder, first.postFolder));
    });
  }

  async function downloadPageArchives(selectedPages) {
    const pages = Array.isArray(selectedPages) ? selectedPages : state.pages;
    const items = pages
      .map(page => ({ page, files: filterFilesByType(page.files || []) }))
      .filter(item => item.files.length > 0);
    if (state.busy || !items.length) return;
    await runArchiveBatch(items, 'page', async (item, idx, total) => {
      logLine(`Building page zip ${idx}/${total}: page ${item.page.page}.`);
      await buildAndSaveArchive(item.files, buildPageArchiveName(state.userFolder, item.page.page));
    });
  }

  async function downloadBacklogArchive() {
    const files = filterFilesByType(state.files);
    if (state.busy || !files.length) return;
    await runSingleArchive(files, buildArchiveName(state.userFolder, `${state.userFolder}_backlog`), 'backlog');
  }

  async function downloadGalleryArchive(folderId) {
    const id = String(folderId || '');
    if (state.busy && !galleryDownloadActive) {
      logLine('Finish the current scan or non-gallery download before queueing a gallery.');
      return;
    }
    if (currentGalleryDownloadId === id || galleryQueuedIds.has(id)) {
      logLine('That gallery is already queued.');
      return;
    }
    const folder = state.folders.find(item => String(item.id || '') === String(folderId || ''));
    if (!folder) {
      logLine('Gallery not found in the current profile scan.');
      return;
    }
    const files = filterFilesByType(folder.files || []);
    if (!files.length) {
      logLine(`No files match the selected file types for ${folder.name}.`);
      return;
    }
    galleryQueue.push(id);
    galleryQueuedIds.add(id);
    logLine(`Queued gallery ${folder.name}.`);
    syncUi();
    processGalleryQueue();
  }

  async function processGalleryQueue() {
    if (galleryDownloadActive) return;
    galleryDownloadActive = true;
    try {
      while (galleryQueue.length) {
        const id = galleryQueue.shift();
        galleryQueuedIds.delete(id);
        const folder = state.folders.find(item => String(item.id || '') === String(id || ''));
        if (!folder) continue;
        const files = filterFilesByType(folder.files || []);
        if (!files.length) {
          logLine(`Skipped ${folder.name}; no files match the selected file types.`);
          continue;
        }
        currentGalleryDownloadId = id;
        setBusy(true, 'Downloading...');
        setProgress(0);
        syncUi();
        try {
          logLine(`Building gallery zip: ${folder.name}.`);
          await buildAndSaveArchive(
            files,
            buildArchiveName(state.userFolder, galleryArchiveLeaf(folder)),
            setProgress
          );
          setProgress(100);
          logLine(`Downloaded gallery ${folder.name}.`);
        } catch (err) {
          logLine(`Gallery download failed for ${folder.name}: ${errorMessage(err)}`);
        } finally {
          currentGalleryDownloadId = '';
          await delay(FILE_DELAY_MS);
        }
      }
    } finally {
      galleryDownloadActive = false;
      currentGalleryDownloadId = '';
      setBusy(false);
      syncUi();
    }
  }

  async function runArchiveBatch(items, unit, fn) {
    setBusy(true, 'Downloading...');
    setProgress(0);
    try {
      for (let i = 0; i < items.length; i++) {
        await fn(items[i], i + 1, items.length);
        setProgress(Math.round(((i + 1) / items.length) * 100));
        syncUi(`${i + 1}/${items.length} ${unit}${items.length === 1 ? '' : 's'}`);
        await delay(FILE_DELAY_MS);
      }
      logLine(`Downloaded ${items.length} ${unit} archive${items.length === 1 ? '' : 's'}.`);
    } catch (err) {
      logLine(`Download failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runSingleArchive(files, archiveName, label) {
    setBusy(true, 'Downloading...');
    setProgress(0);
    try {
      logLine(`Building ${label} zip with ${files.length} file${files.length === 1 ? '' : 's'}.`);
      await buildAndSaveArchive(files, archiveName, setProgress);
      setProgress(100);
      logLine(`Downloaded ${label} archive.`);
    } catch (err) {
      logLine(`${label} download failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function buildAndSaveArchive(files, archiveName, onProgress) {
    if (!JSZip || typeof JSZip !== 'function') throw new Error('JSZip is missing');
    const zip = new JSZip();
    let added = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const blob = file.kind === 'text'
          ? new Blob([file.text || ''], { type: 'text/markdown' })
          : await fetchBlobWithRetry(file);
        zip.file(`${file.postFolder ? `${file.postFolder}/` : ''}${file.fileName || fallbackFileName(file.url, added + 1)}`, blob);
        added++;
      } catch (err) {
        failed++;
        logLine(`Skipped failed file: ${file.fileName || file.url} (${errorMessage(err)})`);
      }
      if (onProgress) onProgress(Math.min(70, Math.round((added + failed) / Math.max(1, files.length) * 70)));
      await delay(FILE_DELAY_MS);
    }
    if (!added) throw new Error(`all ${files.length} file fetches failed`);
    if (failed) logLine(`Archive is partial: ${failed} file${failed === 1 ? '' : 's'} failed.`);
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      meta => {
        if (onProgress) onProgress(70 + Math.round(((meta && meta.percent) || 0) * 0.25));
      }
    );
    await saveBlob(blob, sanitizeDownloadPathForSave(archiveName || 'deviantart_archive.zip'));
    if (onProgress) onProgress(100);
  }

  async function fetchBlobWithRetry(file) {
    const urls = Array.isArray(file.urls) && file.urls.length ? file.urls : [file.url];
    let lastErr = null;
    for (const url of urls) {
      if (!url) continue;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await requestBlob(url);
        } catch (err) {
          lastErr = err;
          if (attempt >= MAX_RETRIES) break;
          await delay(700 * Math.pow(2, attempt));
        }
      }
    }
    throw lastErr || new Error('download failed');
  }

  function puppyUrl(path, params) {
    const url = new URL(path, 'https://www.deviantart.com');
    Object.keys(params || {}).forEach(key => {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const csrf = csrfToken();
    if (csrf) url.searchParams.set('csrf_token', csrf);
    return url.href;
  }

  function csrfToken() {
    if (window.__CSRF_TOKEN__) return String(window.__CSRF_TOKEN__);
    const script = Array.from(document.scripts).map(s => s.textContent || '').find(text => text.includes('__CSRF_TOKEN__'));
    const match = script && script.match(/window\.__CSRF_TOKEN__\s*=\s*'([^']+)'/);
    return match ? match[1] : '';
  }

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        headers: { Accept: 'application/json, text/plain, */*' },
        timeout: 60000,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          try { resolve(JSON.parse(res.responseText || '{}')); }
          catch (err) { reject(err); }
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
        url,
        anonymous: false,
        timeout: 60000,
        onload: res => {
          if (res.status < 200 || res.status >= 300) reject(new Error(`HTTP ${res.status}`));
          else resolve(String(res.responseText || ''));
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
        onload: async res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          const blob = res.response;
          if (!blob || !blob.size) {
            reject(new Error('empty response'));
            return;
          }
          const type = (parseHeader(res.responseHeaders, 'content-type') || blob.type || '').toLowerCase();
          if (/^(?:text\/|application\/(?:json|xml|xhtml))/.test(type)) {
            reject(new Error(`server returned ${type.split(';')[0] || 'non-media content'}`));
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
        setTimeout(() => URL.revokeObjectURL(url), 30000);
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
      a.download = name.split('/').pop() || 'deviantart_archive.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      finish();
    });
  }

  function classifyFileKind(file) {
    if (!file || file.kind === 'text') return 'text';
    const ext = String(file.ext || '').toLowerCase();
    const mime = String(file.mime || '').toLowerCase();
    if (mime.indexOf('image/') === 0 || /^(?:avif|bmp|gif|jpe?g|png|webp)$/.test(ext) || IMG_RE.test(file.url || '')) return 'image';
    if (mime.indexOf('video/') === 0 || /^(?:m4v|mov|mp4|webm)$/.test(ext) || VID_RE.test(file.url || '')) return 'video';
    return 'other';
  }

  function typeAllowed(kind) {
    const chip = ui.chips && ui.chips.find(item => item.dataset.kind === kind);
    if (!chip) return kind !== 'text';
    return chip.getAttribute('aria-checked') === 'true';
  }

  function filterFilesByType(files) {
    return (Array.isArray(files) ? files : []).filter(file => {
      const kind = classifyFileKind(file);
      if (kind === 'image') return typeAllowed('image');
      if (kind === 'video') return typeAllowed('video');
      if (kind === 'text') return typeAllowed('text');
      return true;
    });
  }

  function formatDownloadPath(post, file, index, globalIndex) {
    const user = sanitizeFolder(post.user || state.username || 'deviantart');
    const date = dateKey(post.published);
    const title = sanitizeNamePart(post.title || `deviation_${post.id}`).slice(0, 56) || `deviation_${post.id}`;
    const g = String(globalIndex || 0).padStart(6, '0');
    const i = String(index || 0).padStart(3, '0');
    const ext = file.ext || inferExt(file.url || file.label || '', file.mime || '') || 'bin';
    const base = `${date}-${g}-${title}-${post.id}`;
    const leaf = file.kind === 'text' ? `${base}.md` : `${base}_${i}.${ext}`;
    return `${user}/${base}/${leaf}`;
  }

  function buildArchiveName(userFolder, leaf) {
    const base = leaf || 'archive';
    return userFolder ? `${userFolder}/${base}.zip` : `${base}.zip`;
  }

  function buildPageArchiveName(userFolder, pageNumber) {
    return buildArchiveName(userFolder, `page_${String(pageNumber || 1).padStart(4, '0')}`);
  }

  function galleryArchiveLeaf(folder) {
    const name = sanitizeNamePart(folder && folder.name) || `gallery_${folder && folder.id || 'download'}`;
    const firstPost = folder && Array.isArray(folder.posts) ? folder.posts[0] : null;
    const firstFile = firstPost && Array.isArray(firstPost.files) ? firstPost.files[0] : null;
    const fromFolder = firstFile && String(firstFile.postFolder || '').match(/^(\d{6})-(\d{6})/);
    const date = fromFolder ? fromFolder[1] : dateKey(firstPost && firstPost.published);
    const index = fromFolder ? fromFolder[2] : '000001';
    return `${date}-${index} - ${name}`;
  }

  function splitPath(path) {
    const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const [userFolder, postFolder, ...rest] = parts;
    return { userFolder: userFolder || '', postFolder: postFolder || '', fileName: rest.join('/') || '' };
  }

  function sanitizeFolder(raw) {
    return sanitizeNamePart(raw).replace(/\s+/g, '_') || 'deviantart';
  }

  function sanitizeNamePart(raw) {
    let s = String(raw || '').normalize('NFC');
    s = s.replace(/\uFFFD/g, '').replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/[\\/:*?"<>|]+/g, '').replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function sanitizeFileNameStrict(raw, fallback) {
    let s = sanitizeNamePart(raw).replace(/[^A-Za-z0-9._ -]+/g, '').trim();
    return s || fallback || 'download';
  }

  function sanitizeDownloadPathForSave(rawPath) {
    const parts = String(rawPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return (parts.length ? parts : ['deviantart_archive.zip'])
      .map((part, idx) => sanitizeFileNameStrict(part, idx === parts.length - 1 ? 'archive.zip' : 'folder'))
      .join('/');
  }

  function cleanTitle(raw) {
    return String(raw || '').replace(/\s*\|\s*DeviantArt\s*$/i, '').trim();
  }

  function normalizeUrl(raw) {
    if (!raw) return '';
    let u = String(raw).trim().replace(/&amp;/g, '&');
    try { return new URL(u, location.origin).href; } catch {}
    try { return new URL(encodeURI(u), location.origin).href; } catch {}
    return u;
  }

  function canonicalMediaKey(raw) {
    const normalized = normalizeUrl(raw);
    if (!normalized) return '';
    try {
      const u = new URL(normalized);
      return `${u.hostname.toLowerCase()}${decodeURIComponent(u.pathname).toLowerCase()}`;
    } catch {
      return normalized.split('?')[0].toLowerCase();
    }
  }

  function dedupeFiles(files) {
    const out = [];
    const seen = new Set();
    (files || []).forEach(file => {
      const key = file.kind === 'text' ? `text:${file.label || file.text || out.length}` : canonicalMediaKey(file.url);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(file);
    });
    return out;
  }

  function isLikelyMediaUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return false;
    if (MEDIA_RE.test(normalized)) return true;
    try {
      const u = new URL(normalized);
      return /(?:^|\.)wixmp\.com$/i.test(u.hostname) || /(?:^|\.)deviantart\.net$/i.test(u.hostname);
    } catch {
      return false;
    }
  }

  function inferExt(raw, mime) {
    const fromUrl = getUrlExt(raw);
    if (fromUrl) return fromUrl === 'jpeg' ? 'jpg' : fromUrl;
    const m = String(mime || '').toLowerCase();
    if (m.includes('jpeg')) return 'jpg';
    if (m.includes('png')) return 'png';
    if (m.includes('webp')) return 'webp';
    if (m.includes('gif')) return 'gif';
    if (m.includes('mp4')) return 'mp4';
    if (m.includes('webm')) return 'webm';
    return 'jpg';
  }

  function getUrlExt(raw) {
    const url = normalizeUrl(raw);
    if (!url) return '';
    try {
      const path = new URL(url).pathname;
      const match = path.match(/\.([A-Za-z0-9]{2,5})$/);
      return match ? match[1].toLowerCase() : '';
    } catch {
      const match = String(url).split('?')[0].match(/\.([A-Za-z0-9]{2,5})$/);
      return match ? match[1].toLowerCase() : '';
    }
  }

  function fallbackFileName(url, index) {
    return `media_${String(index).padStart(6, '0')}.${inferExt(url, '')}`;
  }

  function dateMs(raw) {
    if (!raw) return 0;
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  }

  function dateKey(raw) {
    const d = raw ? new Date(raw) : null;
    if (!d || !Number.isFinite(d.getTime())) return '000000';
    return `${String(d.getUTCFullYear() % 100).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  function metaContent(doc, attr, value) {
    const el = doc.querySelector(`meta[${attr}="${value}"]`);
    return el ? el.getAttribute('content') || '' : '';
  }

  function parseHeader(headers, name) {
    const match = String(headers || '').match(new RegExp(`^${name}:\\s*([^\\r\\n]+)`, 'im'));
    return match ? match[1].trim() : '';
  }

  function sameUrl(a, b) {
    try {
      const aa = new URL(a, location.origin);
      const bb = new URL(b, location.origin);
      return aa.origin === bb.origin && aa.pathname === bb.pathname;
    } catch {
      return a === b;
    }
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

  function setBusy(busy, label) {
    state.busy = !!busy;
    if (ui.scan) ui.scan.textContent = busy ? (label || 'Working...') : 'Scan';
    syncUi();
  }

  function setProgress(value) {
    if (!ui.fill) return;
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    ui.fill.style.width = `${pct}%`;
  }

  function syncUi(overrideCount) {
    const hasPosts = state.posts.length > 0;
    const hasPages = state.pages.length > 0;
    const hasFiles = state.files.length > 0;
    if (ui.profile) ui.profile.textContent = state.username || 'No profile scanned';
    if (ui.count) ui.count.textContent = overrideCount || `${state.files.length} file${state.files.length === 1 ? '' : 's'}`;
    if (ui.post) {
      ui.post.hidden = state.scanType !== 'post';
      ui.post.disabled = state.busy || !hasPosts || state.scanType !== 'post';
    }
    if (ui.posts) ui.posts.disabled = state.busy || !hasPosts;
    if (ui.pages) ui.pages.disabled = state.busy || !hasPages;
    if (ui.backlog) ui.backlog.disabled = state.busy || !hasFiles;
    renderGalleryList();
  }

  function renderGalleryList() {
    if (!ui.galleryList) return;
    const previousRows = ui.galleryList.querySelector('.das-galleryRows');
    const previousScrollTop = previousRows ? previousRows.scrollTop : 0;
    const folders = state.scanType === 'profile'
      ? state.folders.filter(folder => folder && Array.isArray(folder.files) && folder.files.length > 0)
      : [];
    ui.galleryList.hidden = !folders.length;
    ui.galleryList.innerHTML = '';
    if (!folders.length) return;

    const head = document.createElement('div');
    head.className = 'das-galleryHead';
    const title = document.createElement('span');
    title.textContent = 'Galleries';
    const count = document.createElement('span');
    count.textContent = String(folders.length);
    head.appendChild(title);
    head.appendChild(count);
    ui.galleryList.appendChild(head);

    const rows = document.createElement('div');
    rows.className = 'das-galleryRows';
    folders.forEach(folder => {
      const row = document.createElement('div');
      row.className = 'das-galleryRow';

      const labelWrap = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'das-galleryName';
      name.title = folder.name || 'Gallery';
      name.textContent = folder.name || 'Gallery';
      const meta = document.createElement('div');
      meta.className = 'das-galleryMeta';
      meta.textContent = `${folder.posts.length} post${folder.posts.length === 1 ? '' : 's'} · ${folder.files.length} file${folder.files.length === 1 ? '' : 's'}`;
      labelWrap.appendChild(name);
      labelWrap.appendChild(meta);

      const btn = document.createElement('button');
      btn.type = 'button';
      updateGalleryDownloadButton(btn, folder);
      btn.addEventListener('click', () => downloadGalleryArchive(folder.id));

      row.appendChild(labelWrap);
      row.appendChild(btn);
      rows.appendChild(row);
    });
    ui.galleryList.appendChild(rows);
    rows.scrollTop = previousScrollTop;
  }

  function updateGalleryDownloadButton(button, folder) {
    if (!button || !folder) return;
    const id = String(folder.id || '');
    button.classList.toggle('is-active', currentGalleryDownloadId === id);
    button.classList.toggle('is-queued', galleryQueuedIds.has(id));
    let text = 'Download';
    let disabled = state.busy && !galleryDownloadActive;
    if (currentGalleryDownloadId === id) {
      text = 'Downloading';
      disabled = true;
    } else if (galleryQueuedIds.has(id)) {
      text = 'Queued';
      disabled = true;
    }
    if (button.textContent !== text) button.textContent = text;
    if (button.disabled !== disabled) button.disabled = disabled;
    const title = `${text} ${folder.name || 'gallery'}`;
    if (button.title !== title) button.title = title;
  }

  function logLine(text) {
    const line = String(text || '');
    state.log.push(line);
    if (state.log.length > 80) state.log.shift();
    if (ui.log) {
      ui.log.innerHTML = '';
      state.log.slice(-40).forEach(item => {
        const div = document.createElement('div');
        div.textContent = item;
        ui.log.appendChild(div);
      });
      ui.log.scrollTop = ui.log.scrollHeight;
    }
  }

  if (document.body) init();
  else window.addEventListener('DOMContentLoaded', init, { once: true });
})();
