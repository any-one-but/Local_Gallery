// ==UserScript==
// @name         SimpGuest
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.00
// @description  Lightweight SimpCity thread media downloader with RedditGuest-style controls.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/SimpGuest.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/SimpGuest.user.js
// @icon         https://simp4.host.church/simpcityIcon192.png
// @match        https://simpcity.cr/threads/*
// @match        https://simpcity.is/threads/*
// @match        https://simpcity.cz/threads/*
// @match        https://simpcity.hk/threads/*
// @match        https://simpcity.rs/threads/*
// @match        https://simpcity.ax/threads/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      self
// @connect      simpcity.cr
// @connect      simpcity.is
// @connect      simpcity.cz
// @connect      simpcity.hk
// @connect      simpcity.rs
// @connect      simpcity.ax
// @connect      simpcity.su
// @connect      api.redgifs.com
// @connect      redgifs.com
// @connect      www.redgifs.com
// @connect      cyberdrop.me
// @connect      cyberdrop.cc
// @connect      cyberdrop.ch
// @connect      cyberdrop.cloud
// @connect      cyberdrop.nl
// @connect      cyberdrop.to
// @connect      cyberdrop.cr
// @connect      api.cyberdrop.me
// @connect      api.cyberdrop.cc
// @connect      api.cyberdrop.ch
// @connect      api.cyberdrop.cloud
// @connect      api.cyberdrop.nl
// @connect      api.cyberdrop.to
// @connect      api.cyberdrop.cr
// @connect      bunkr.ac
// @connect      bunkr.ax
// @connect      bunkr.black
// @connect      bunkr.cat
// @connect      bunkr.ci
// @connect      bunkr.cr
// @connect      bunkr.fi
// @connect      bunkr.is
// @connect      bunkr.media
// @connect      bunkr.nu
// @connect      bunkr.pk
// @connect      bunkr.ph
// @connect      bunkr.ps
// @connect      bunkr.red
// @connect      bunkr.ru
// @connect      bunkr.se
// @connect      bunkr.si
// @connect      bunkr.site
// @connect      bunkr.sk
// @connect      bunkr.ws
// @connect      bunkrr.ru
// @connect      bunkrr.su
// @connect      bunkrrr.org
// @connect      bunkr-cache.se
// @connect      scdn.st
// @connect      cache8.st
// @connect      gigachad-cdn.ru
// @connect      *.gigachad-cdn.ru
// @connect      imagebam.com
// @connect      *.imagebam.com
// @connect      imgbox.com
// @connect      *.imgbox.com
// @connect      ibb.co
// @connect      *.ibb.co
// @connect      pixhost.to
// @connect      *.pixhost.to
// @connect      postimg.cc
// @connect      i.postimg.cc
// @connect      pixxxels.cc
// @connect      i.pixxxels.cc
// @connect      jpg.fish
// @connect      jpg.fishing
// @connect      jpg.pet
// @connect      jpeg.pet
// @connect      jpg1.su
// @connect      jpg2.su
// @connect      jpg3.su
// @connect      jpg4.su
// @connect      jpg5.su
// @connect      jpg6.su
// @connect      jpg7.cr
// @connect      cuckcapital.cr
// @connect      pixeldrain.com
// @connect      pixeldrain.net
// @connect      pixeldra.in
// @connect      gofile.io
// @connect      turbo.cr
// @connect      turbovid.cr
// @connect      turbocdn.st
// @connect      *.turbocdn.st
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const JSZip = window.JSZip;
  const PAGE_DELAY_MS = 650;
  const FILE_DELAY_MS = 220;
  const MAX_THREAD_PAGES = 300;
  const MAX_RETRIES = 2;
  const BACKOFF_BASE = 900;
  const BLOB_TIMEOUT_MS = 120000;

  const imgRE = /\.(?:avif|bmp|gif|jpe?g|jif|png|svg|tiff?|webp)(?:$|[?#])/i;
  const vidRE = /\.(?:avi|flv|m4p|m4v|mov|mp4|mpeg|mpg|ogg|qt|swf|webm|wmv)(?:$|[?#])/i;
  const state = {
    busy: false,
    threadTitle: '',
    threadFolder: '',
    pages: [],
    posts: [],
    files: [],
    countTextOverride: '',
    lastScanAt: 0
  };

  const ui = {};

  GM_addStyle(`
    #simpGuestPanel {
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
    #simpGuestPanel, #simpGuestPanel * {
      box-sizing: border-box;
    }
    #simpGuestPanel button {
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
    #simpGuestPanel button:hover:not(:disabled) {
      background: #ff5c1c;
      border-color: rgba(255, 255, 255, 0.28);
    }
    #simpGuestPanel button:disabled {
      cursor: default;
      opacity: 0.48;
    }
    #simpGuestPanel .sg-downloadStack {
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
    #simpGuestPanel .sg-downloadStack[hidden] {
      display: none;
    }
    #simpGuestPanel .sg-downloadStack button {
      min-height: 36px;
      background: rgba(255, 255, 255, 0.11);
      white-space: nowrap;
    }
    #simpGuestPanel .sg-downloadStack button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.17);
    }
    #simpGuestPanel .sg-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
      color: #c9c9cf;
      font-size: 11px;
    }
    #simpGuestPanel .sg-meta span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #simpGuestPanel .sg-progress {
      position: relative;
      height: 7px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
    }
    #simpGuestPanel .sg-progress > div {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #ff4500, #ffb000);
      transition: width 130ms ease;
    }
    #simpGuestPanel .sg-log {
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
    #simpGuestPanel .sg-log div {
      padding: 0 0 5px;
      overflow-wrap: anywhere;
    }
    #simpGuestPanel .sg-log div:last-child {
      padding-bottom: 0;
    }
    #simpGuestPanel.sg-collapsed {
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
    #simpGuestPanel.sg-collapsed > * {
      display: none;
    }
    #simpGuestPanel.sg-collapsed::before {
      content: "";
      display: block;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #ff4500, #ffb000);
    }
  `);

  function init() {
    if (document.getElementById('simpGuestPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'simpGuestPanel';
    panel.innerHTML = `
      <div id="sgDownloadStack" class="sg-downloadStack" hidden>
        <button id="sgPostsBtn" type="button" disabled>Download Posts</button>
        <button id="sgPagesBtn" type="button" disabled>Download Pages</button>
        <button id="sgThreadBtn" type="button" disabled>Download Thread</button>
      </div>
      <button id="sgScanBtn" type="button">Scan</button>
      <div class="sg-progress" aria-hidden="true"><div id="sgProgressFill"></div></div>
      <div class="sg-meta">
        <span id="sgThreadLabel">No thread scanned</span>
        <span id="sgCountLabel">0 files</span>
      </div>
      <div id="sgLog" class="sg-log" aria-live="polite"></div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.downloadStack = panel.querySelector('#sgDownloadStack');
    ui.scanBtn = panel.querySelector('#sgScanBtn');
    ui.postsBtn = panel.querySelector('#sgPostsBtn');
    ui.pagesBtn = panel.querySelector('#sgPagesBtn');
    ui.threadBtn = panel.querySelector('#sgThreadBtn');
    ui.fill = panel.querySelector('#sgProgressFill');
    ui.threadLabel = panel.querySelector('#sgThreadLabel');
    ui.countLabel = panel.querySelector('#sgCountLabel');
    ui.log = panel.querySelector('#sgLog');

    ui.scanBtn.addEventListener('click', () => scanCurrentThread());
    ui.postsBtn.addEventListener('click', () => downloadPostArchives());
    ui.pagesBtn.addEventListener('click', () => downloadPageArchives());
    ui.threadBtn.addEventListener('click', () => downloadThreadArchive());
    panel.addEventListener('click', () => {
      if (panel.classList.contains('sg-collapsed')) setCollapsed(false);
    });
    document.addEventListener('keydown', handleGlobalKeydown, true);

    logLine('Ready. Open a SimpCity thread and scan.');
    syncUi();
  }

  function syncUi() {
    const hasFiles = state.files.length > 0;
    ui.scanBtn.disabled = state.busy;
    ui.downloadStack.hidden = !hasFiles;
    ui.postsBtn.disabled = state.busy || !state.posts.length;
    ui.pagesBtn.disabled = state.busy || !state.pages.length;
    ui.threadBtn.disabled = state.busy || !hasFiles;
    ui.threadLabel.textContent = state.threadTitle || 'No thread scanned';
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
    setCollapsed(!ui.panel.classList.contains('sg-collapsed'));
  }

  function isEditableTarget(target) {
    const el = target && target.nodeType === 1 ? target : null;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!el.closest('[contenteditable=""], [contenteditable="true"]');
  }

  function setCollapsed(collapsed) {
    ui.panel.classList.toggle('sg-collapsed', !!collapsed);
  }

  async function scanCurrentThread() {
    if (state.busy) return;
    if (!/\/threads\//i.test(location.pathname)) {
      logLine('This page is not a SimpCity thread.');
      setProgress(0);
      return;
    }

    setBusy(true, 'Scanning...');
    setProgress(0);
    state.threadTitle = parseThreadTitle(document) || titleFromUrl(location.href) || 'simpcity_thread';
    state.threadFolder = sanitizeFolder(state.threadTitle);
    state.pages = [];
    state.posts = [];
    state.files = [];
    state.countTextOverride = '';
    state.lastScanAt = Date.now();
    syncUi();

    try {
      const urls = buildThreadPageUrls(document, location.href);
      logLine(`Scanning ${urls.length} thread page${urls.length === 1 ? '' : 's'} for embedded media.`);

      const rawPosts = [];
      for (let i = 0; i < urls.length; i++) {
        const pageNo = i + 1;
        const doc = urls[i].current ? document : await requestDocument(urls[i].url);
        const posts = parsePostsFromDocument(doc, urls[i].page, urls[i].url);
        rawPosts.push(...posts);
        logLine(`Page ${urls[i].page}: found ${posts.length} post${posts.length === 1 ? '' : 's'}.`);
        setProgress(Math.min(45, ((i + 1) / urls.length) * 45));
        if (!urls[i].current && pageNo < urls.length) await delay(PAGE_DELAY_MS);
      }

      const postsWithCandidates = rawPosts
        .map(post => ({ ...post, candidates: extractMediaCandidates(post.content, post.pageUrl) }))
        .filter(post => post.candidates.length > 0);

      logLine(`Resolving media from ${postsWithCandidates.length} post${postsWithCandidates.length === 1 ? '' : 's'}.`);
      const resolvedPosts = [];
      let resolvedDone = 0;
      for (const post of postsWithCandidates) {
        const files = await resolvePostFiles(post);
        if (files.length) resolvedPosts.push({ ...post, files });
        resolvedDone++;
        setProgress(45 + Math.min(45, (resolvedDone / postsWithCandidates.length) * 45));
      }

      const deduped = buildDedupedDownloads(resolvedPosts);
      state.posts = deduped.posts;
      state.pages = deduped.pages;
      state.files = deduped.files;
      setProgress(100);
      logLine(`Scan complete: ${state.posts.length} post archive${state.posts.length === 1 ? '' : 's'}, ${state.pages.length} page archive${state.pages.length === 1 ? '' : 's'}, ${state.files.length} unique file${state.files.length === 1 ? '' : 's'}.`);
      if (deduped.duplicates > 0) {
        logLine(`Removed ${deduped.duplicates} duplicate file${deduped.duplicates === 1 ? '' : 's'}; earliest posts kept.`);
      }
    } catch (err) {
      setProgress(0);
      logLine(`Scan failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function parseThreadTitle(doc) {
    const el = doc.querySelector('.p-title-value');
    const raw = el ? el.textContent : doc.title;
    return String(raw || '').replace(/\s+/g, ' ').replace(/\s*\|\s*SimpCity.*$/i, '').trim();
  }

  function titleFromUrl(url) {
    try {
      const u = new URL(url, location.href);
      const m = u.pathname.match(/\/threads\/([^/.]+)/i);
      return m ? decodeURIComponent(m[1]).replace(/[-_]+/g, ' ') : '';
    } catch {
      return '';
    }
  }

  function buildThreadPageUrls(doc, currentUrl) {
    const current = new URL(currentUrl, location.href);
    const pageMatch = current.pathname.match(/\/page-(\d+)\/?$/i);
    const currentPage = pageMatch ? Math.max(1, Number(pageMatch[1]) || 1) : 1;
    const pageNumbers = new Set([currentPage]);

    doc.querySelectorAll('a[href*="/page-"], a.pageNav-page').forEach(a => {
      const href = a.getAttribute('href') || '';
      const textNum = Number((a.textContent || '').trim().replace(/[^\d]/g, ''));
      const hrefNum = Number((href.match(/\/page-(\d+)/i) || [])[1] || 0);
      const n = hrefNum || textNum;
      if (n > 0) pageNumbers.add(n);
    });

    const maxPage = Math.min(MAX_THREAD_PAGES, Math.max(...pageNumbers));
    const base = new URL(current.href);
    base.pathname = base.pathname.replace(/\/page-\d+\/?$/i, '/');
    base.search = '';
    base.hash = '';

    const out = [];
    for (let page = 1; page <= maxPage; page++) {
      const u = new URL(base.href);
      if (page > 1) u.pathname = u.pathname.replace(/\/?$/i, '/') + `page-${page}`;
      out.push({ page, url: u.href, current: page === currentPage });
    }
    return out;
  }

  function parsePostsFromDocument(doc, pageNumber, pageUrl) {
    const title = parseThreadTitle(doc) || state.threadTitle || 'simpcity_thread';
    const posts = [];
    doc.querySelectorAll('.message').forEach((message, idx) => {
      const content = message.querySelector('.message-content .message-userContent, .message-userContent, .bbWrapper');
      if (!content) return;
      const postId = parsePostId(message) || `${pageNumber}-${idx + 1}`;
      const postNumber = parsePostNumber(message) || String(idx + 1);
      const postDate = parsePostDate(message);
      const clone = content.cloneNode(true);
      scrubContentClone(clone);
      posts.push({
        id: postId,
        number: postNumber,
        page: Math.max(1, Number(pageNumber) || 1),
        pageUrl,
        title,
        published: postDate ? Math.floor(postDate.getTime() / 1000) : 0,
        postDate,
        content: clone
      });
    });
    return posts;
  }

  function parsePostId(message) {
    const idAttr = message.getAttribute('id') || message.getAttribute('data-content') || '';
    const direct = idAttr.match(/post-(\d+)/i);
    if (direct) return direct[1];
    const a = message.querySelector('a[href*="/post-"]');
    const href = a ? a.getAttribute('href') || '' : '';
    const m = href.match(/\/post-(\d+)/i);
    return m ? m[1] : '';
  }

  function parsePostNumber(message) {
    const anchors = [...message.querySelectorAll('a[href*="/post-"]')];
    const anchor = anchors.reverse().find(a => /#\s*[\d,]+/.test(a.textContent || ''));
    return anchor ? (anchor.textContent || '').replace(/[^\d]/g, '') : '';
  }

  function parsePostDate(message) {
    const time = message.querySelector('time.u-dt, time');
    if (!time) return null;
    const unix = time.getAttribute('data-timestamp') || time.getAttribute('data-time');
    if (unix && !Number.isNaN(Number(unix))) return new Date(Number(unix) * 1000);
    const dt = time.getAttribute('datetime');
    if (dt) {
      const d = new Date(dt);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  }

  function scrubContentClone(clone) {
    clone.querySelectorAll('.contentRow-figure, .js-unfurl-favicon, .button-text > span').forEach(el => el.remove());
    clone.querySelectorAll('blockquote').forEach(el => {
      if (el.querySelector('.bbCodeBlock-title') || el.closest('.bbCodeBlock')) el.remove();
    });
    clone.querySelectorAll('a[href]').forEach(a => {
      const decoded = decodeForumRedirect(a.getAttribute('href') || '');
      if (decoded) a.setAttribute('href', decoded);
    });
  }

  function decodeForumRedirect(href) {
    if (!href) return '';
    try {
      const u = new URL(href, location.origin);
      const p = (u.pathname || '').toLowerCase();
      if (!(p === '/redirect' || p === '/redirect/' || p.startsWith('/redirect/') || p.includes('link-proxy'))) return '';
      let to = u.searchParams.get('to') || u.searchParams.get('url') || u.searchParams.get('u') || u.searchParams.get('link') || u.searchParams.get('target');
      if (!to) return '';
      const mode = (u.searchParams.get('m') || '').toLowerCase();
      if (mode === 'b64' || mode === 'base64' || /^[A-Za-z0-9+/_-]+={0,2}$/.test(to)) {
        const decoded = decodeBase64Url(to);
        if (decoded) to = decoded;
      }
      try { to = decodeURIComponent(to); } catch {}
      if (!/^https?:\/\//i.test(to) && /%3a%2f%2f/i.test(to)) {
        try { to = decodeURIComponent(to); } catch {}
      }
      return /^https?:\/\//i.test(to) ? to : '';
    } catch {
      return '';
    }
  }

  function decodeBase64Url(raw) {
    let s = String(raw || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try { return atob(s); } catch { return ''; }
  }

  function extractMediaCandidates(content, baseUrl) {
    const out = [];
    const seen = new Set();
    const add = (raw, source, nameHint) => {
      const url = normalizeUrl(raw, baseUrl);
      if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;
      if (isSameThreadUrl(url)) return;
      if (!isMediaCandidateUrl(url)) return;
      const key = canonicalMediaKey(url);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ url, source: source || 'embed', nameHint: sanitizeNamePart(nameHint || '') });
    };

    content.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!isEmbeddedMediaAnchor(a, href, baseUrl)) return;
      add(
        href,
        'embedded-link',
        a.getAttribute('download') || a.getAttribute('title') || a.textContent || ''
      );
    });
    content.querySelectorAll('img').forEach(img => {
      const parentAnchor = img.closest('a[href]');
      if (parentAnchor && isEmbeddedMediaAnchor(parentAnchor, parentAnchor.getAttribute('href') || '', baseUrl)) return;
      add(
        img.getAttribute('data-url') || img.getAttribute('data-src') || img.getAttribute('src'),
        'image',
        img.getAttribute('alt') || img.getAttribute('title') || ''
      );
    });
    content.querySelectorAll('img[srcset], source[srcset]').forEach(el => {
      const parentAnchor = el.closest('a[href]');
      if (parentAnchor && isEmbeddedMediaAnchor(parentAnchor, parentAnchor.getAttribute('href') || '', baseUrl)) return;
      add(
        pickBestSrcsetUrl(el.getAttribute('srcset')),
        'image',
        el.getAttribute('alt') || el.getAttribute('title') || ''
      );
    });
    content.querySelectorAll('video[src], video source[src], source[src]').forEach(el => {
      add(el.getAttribute('src'), 'video', el.getAttribute('title') || '');
    });
    content.querySelectorAll('iframe[src], embed[src]').forEach(el => {
      add(el.getAttribute('src'), 'iframe', el.getAttribute('title') || '');
    });
    content.querySelectorAll('[style*="background-image"]').forEach(el => {
      const m = String(el.getAttribute('style') || '').match(/url\(["']?([^"')]+)["']?\)/i);
      if (m) add(m[1], 'image');
    });
    return out;
  }

  function pickBestSrcsetUrl(srcset) {
    const entries = String(srcset || '')
      .split(',')
      .map(part => {
        const pieces = part.trim().split(/\s+/);
        const url = pieces[0] || '';
        const descriptor = pieces[1] || '';
        const width = Number((descriptor.match(/^(\d+)w$/i) || [])[1] || 0);
        const density = Number((descriptor.match(/^([\d.]+)x$/i) || [])[1] || 0);
        return { url, score: width || density || 1 };
      })
      .filter(item => item.url);
    entries.sort((a, b) => b.score - a.score);
    return entries[0] ? entries[0].url : '';
  }

  function isSameThreadUrl(raw) {
    try {
      const u = new URL(raw, location.href);
      return u.hostname === location.hostname && /\/threads\//i.test(u.pathname);
    } catch {
      return false;
    }
  }

  function isEmbeddedMediaAnchor(anchor, href, baseUrl) {
    if (!anchor || !href) return false;
    if (!anchor.querySelector('img, picture, video, source, iframe, embed')) return false;
    const url = normalizeUrl(href, baseUrl);
    if (!url || isSameThreadUrl(url)) return false;
    if (isDirectDownloadUrl(url)) return true;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname.toLowerCase();
      if (/simpcity\./i.test(host) && (/\/attachments\//i.test(path) || /\/data\/video\//i.test(path))) return true;
      if (/redgifs\.com$/i.test(host) && /\/(?:ifr|watch|gifs\/detail|gifs\/watch)\//i.test(path)) return true;
      if (/cyberdrop\.[a-z]+$/i.test(host) && /\/(?:f|e)\//i.test(path)) return true;
      if (/bunkrr?r?\./i.test(host) && !/\/a\//i.test(path)) return true;
      if (/imagebam\.com$/i.test(host) && /\/view\//i.test(path)) return true;
      if (/(?:postimg|pixxxels)\.cc$/i.test(host) && path.length > 1) return true;
      if (/pixhost\.to$/i.test(host) && /\/show\//i.test(path)) return true;
      if (/(?:^|\.)ibb\.co$/i.test(host) && !/\/album\//i.test(path)) return true;
      if (/(?:pixeldrain\.com|pixeldrain\.net|pixeldra\.in)$/i.test(host) && /^\/u\//i.test(path)) return true;
      if (/turbo\.cr$/i.test(host) && /\/(?:embed|v|d)\//i.test(path)) return true;
    } catch {}
    return false;
  }

  function isMediaCandidateUrl(raw) {
    const url = normalizeUrl(raw);
    if (!url) return false;
    if (imgRE.test(url) || vidRE.test(url)) return true;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname.toLowerCase();
      if (host === location.hostname && (/\/attachments\//i.test(path) || /\/data\/video\//i.test(path))) return true;
      if (/simpcity\./i.test(host) && (/\/attachments\//i.test(path) || /\/data\/video\//i.test(path))) return true;
      if (/redgifs\.com$/i.test(host) && /\/(?:ifr|watch|gifs\/detail|gifs\/watch)\//i.test(path)) return true;
      if (/cyberdrop\.[a-z]+$/i.test(host) && /\/(?:a|f|e)\//i.test(path)) return true;
      if (/bunkrr?r?\./i.test(host) || /bunkr-cache\./i.test(host) || /scdn\.st$/i.test(host)) return true;
      if (/imagebam\.com$/i.test(host) && /\/(?:view|gallery)\//i.test(path)) return true;
      if (/(?:^|\.)imgbox\.com$/i.test(host) && /\/g\//i.test(path)) return true;
      if (/(?:^|\.)ibb\.co$/i.test(host) && /\/album\//i.test(path)) return true;
      if (/pixhost\.to$/i.test(host) && /\/gallery\//i.test(path)) return true;
      if (/(?:postimg|pixxxels)\.cc$/i.test(host) && path.length > 1) return true;
      if (/(?:jpg\d?\.(?:church|fish|fishing|pet|su|cr)|jpeg\.pet|cuckcapital\.cr)$/i.test(host)) return true;
      if (/(?:pixeldrain\.com|pixeldrain\.net|pixeldra\.in)$/i.test(host) && /^\/[lu]\//i.test(path)) return true;
      if (/gofile\.io$/i.test(host) && /\/d\//i.test(path)) return true;
      if (/turbo\.cr$/i.test(host) && /\/(?:a|embed|v|d)\//i.test(path)) return true;
    } catch {}
    return false;
  }

  async function resolvePostFiles(post) {
    const files = [];
    let index = 0;
    for (const candidate of post.candidates) {
      let resolved = [];
      try {
        resolved = await resolveCandidate(candidate.url);
      } catch (err) {
        logLine(`Could not resolve ${shortUrl(candidate.url)} (${errorMessage(err)}).`);
      }
      for (const item of resolved) {
        const url = typeof item === 'string' ? item : item.url;
        if (!url) continue;
        index++;
        const nameHint = (typeof item === 'object' ? item.name : '') || candidate.nameHint || '';
        files.push({
          url,
          nameHint,
          sourceUrl: candidate.url,
          referrer: candidate.url || post.pageUrl || location.href,
          ext: inferExt(url, nameHint),
          postId: post.id,
          postNumber: post.number,
          page: post.page,
          published: post.published
        });
      }
    }
    return files;
  }

  async function resolveCandidate(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return [];
    if (isDirectDownloadUrl(normalized)) return [{ url: normalized }];
    if (/redgifs\.com/i.test(normalized)) return resolveRedgifs(normalized);
    if (/cyberdrop\.[a-z]+\/a\//i.test(normalized)) return resolveCyberdropAlbum(normalized);
    if (/cyberdrop\.[a-z]+\/(?:f|e)\//i.test(normalized)) return resolveCyberdropFile(normalized);
    if (/bunkrr?r?\./i.test(normalized) && /\/a\//i.test(normalized)) return resolveBunkrAlbum(normalized);
    if (/bunkrr?r?\.|bunkr-cache\.|scdn\.st/i.test(normalized)) return resolveBunkrFile(normalized);
    if (/imagebam\.com\/gallery\//i.test(normalized)) return resolveGenericGallery(normalized, 'a[href*="imagebam.com/view/"]');
    if (/imagebam\.com\/view\//i.test(normalized)) return resolveMetaImage(normalized);
    if (/imgbox\.com\/g\//i.test(normalized)) return resolveGenericGallery(normalized, 'a[href*="images"][href], a[href*="imgbox.com"][href]');
    if (/ibb\.co\/album\//i.test(normalized)) return resolveGenericGallery(normalized, 'a[href*="ibb.co/"][href], img[src]');
    if (/pixhost\.to\/gallery\//i.test(normalized)) return resolveGenericGallery(normalized, 'a[href*="pixhost.to/show/"][href], a[href*="img"][href]');
    if (/(?:postimg|pixxxels)\.cc|pixhost\.to\/show|ibb\.co\//i.test(normalized)) return resolveMetaImage(normalized);
    if (/(?:jpg\d?\.(?:church|fish|fishing|pet|su|cr)|jpeg\.pet|cuckcapital\.cr)/i.test(normalized)) return resolveJpgHost(normalized);
    if (/pixeldrain\.(?:com|net)|pixeldra\.in/i.test(normalized)) return resolvePixeldrain(normalized);
    if (/gofile\.io\/d\//i.test(normalized)) return resolveGofile(normalized);
    if (/turbo\.cr\/a\//i.test(normalized)) return resolveTurboAlbum(normalized);
    if (/turbo\.cr\/(?:embed|v|d)\//i.test(normalized)) return resolveTurboFile(normalized);
    return [];
  }

  function isDirectDownloadUrl(url) {
    if (imgRE.test(url) || vidRE.test(url)) return true;
    try {
      const u = new URL(url);
      return /\/attachments\/|\/data\/video\//i.test(u.pathname);
    } catch {
      return false;
    }
  }

  async function resolveRedgifs(url) {
    const idMatch = String(url).match(/redgifs\.com\/(?:ifr\/|watch\/|gifs\/detail\/|gifs\/watch\/)?([a-z0-9_-]+)/i);
    const id = idMatch && idMatch[1] ? idMatch[1] : '';
    if (!id) return [];
    const tokenResp = await requestJson('https://api.redgifs.com/v2/auth/temporary');
    const token = tokenResp && tokenResp.token;
    if (!token) return [];
    const data = await requestJson(`https://api.redgifs.com/v2/gifs/${encodeURIComponent(id)}`, {
      Authorization: `Bearer ${token}`
    });
    const gif = data && (data.gif || data.gfyItem || data);
    const urls = gif && gif.urls ? gif.urls : {};
    const best = urls.hd || urls.hd1080 || urls.hd720 || urls.sd || urls.mp4;
    return best ? [{ url: best, name: `${id}.mp4` }] : [];
  }

  async function resolveCyberdropAlbum(url) {
    const doc = await requestDocument(url);
    const folder = (doc.querySelector('h1') || doc.querySelector('title'));
    const folderName = folder ? sanitizeNamePart(folder.textContent || '') : '';
    const links = [...doc.querySelectorAll('a[href]')]
      .map(a => normalizeUrl(a.getAttribute('href'), url))
      .filter(u => /cyberdrop\.[a-z]+\/(?:f|e)\//i.test(u));
    const out = [];
    for (const link of unique(links)) {
      const resolved = await resolveCyberdropFile(link);
      resolved.forEach(item => out.push({ ...item, folderName }));
      await delay(80);
    }
    return out;
  }

  async function resolveCyberdropFile(url) {
    const normalized = normalizeUrl(url);
    const u = new URL(normalized);
    const slug = (u.pathname.match(/\/(?:f|e)\/([^/?#]+)/i) || [])[1];
    if (!slug) return [];
    const root = (u.hostname.match(/cyberdrop\.[a-z]+$/i) || [])[0];
    const bases = unique([
      root ? `https://api.${root}` : '',
      'https://api.cyberdrop.cr',
      `${u.origin}`
    ].filter(Boolean));

    for (const base of bases) {
      const endpoints = [
        `${base}/api/file/auth/${slug}`,
        `${base}/api/file/info/${slug}`,
        `${base}/api/file/url/${slug}`,
        `${base}/api/file/${slug}`,
        `${base}/api/f/${slug}`
      ];
      for (const endpoint of endpoints) {
        try {
          const text = await requestText(endpoint, { Accept: 'application/json, text/plain, */*', Referer: u.origin + '/', Origin: u.origin });
          const found = parseDirectUrlFromText(text, slug, base);
          if (found.url) return [found];
        } catch {}
      }
    }
    const doc = await requestDocument(normalized);
    const meta = pickMetaImage(doc);
    return meta ? [{ url: meta }] : [];
  }

  function parseDirectUrlFromText(text, slug, base) {
    const out = { url: '', name: '' };
    const s = String(text || '');
    const absolute = s.match(new RegExp(`https?:[^"'\\s]+/api/file/d/${escapeRegExp(slug)}\\?[^"'\\s]*token=[^"'\\s]+`, 'i'));
    if (absolute) out.url = absolute[0].replace(/\\\//g, '/');
    const rel = !out.url && s.match(new RegExp(`/api/file/d/${escapeRegExp(slug)}\\?[^"'\\s]*token=[^"'\\s]+`, 'i'));
    if (rel) out.url = `${base.replace(/\/$/, '')}${rel[0]}`;
    try {
      const json = JSON.parse(s);
      const values = [];
      walkValues(json, (value, key) => {
        if (typeof value !== 'string') return;
        if (!out.url && /^https?:\/\//i.test(value) && (/\/api\/file\/d\//i.test(value) || isDirectDownloadUrl(value))) out.url = value;
        if (!out.name && /(name|filename|original)/i.test(key) && /\.[a-z0-9]{2,8}$/i.test(value)) out.name = value.split(/[\\/]/).pop();
        values.push(value);
      });
      if (!out.url) {
        const direct = values.find(v => /^https?:\/\//i.test(v) && (/\/api\/file\/d\//i.test(v) || isDirectDownloadUrl(v)));
        if (direct) out.url = direct;
      }
    } catch {}
    if (out.url) out.url = normalizeUrl(out.url);
    return out;
  }

  async function resolveBunkrAlbum(url) {
    const doc = await requestDocument(url);
    const links = [...doc.querySelectorAll('a[href]')]
      .map(a => normalizeUrl(a.getAttribute('href'), url))
      .filter(u => /bunkrr?r?\./i.test(u) && !/\/a\//i.test(u));
    const out = [];
    for (const link of unique(links)) {
      const resolved = await resolveBunkrFile(link);
      out.push(...resolved);
      await delay(80);
    }
    return out;
  }

  async function resolveBunkrFile(url) {
    if (isDirectDownloadUrl(url) || /scdn\.st|bunkr-cache\./i.test(url)) return [{ url }];
    const doc = await requestDocument(url);
    const direct = [
      ...[...doc.querySelectorAll('source[src], video[src], a[href]')].map(el => normalizeUrl(el.getAttribute('src') || el.getAttribute('href'), url)),
      ...String(doc.documentElement.innerHTML || '').match(/https?:\/\/[^"'<> ]+(?:scdn\.st|bunkr-cache\.[^"'<> ]+)[^"'<> ]+/gi) || []
    ].find(u => u && (isDirectDownloadUrl(u) || /scdn\.st|bunkr-cache\./i.test(u)));
    return direct ? [{ url: direct }] : [];
  }

  async function resolveGenericGallery(url, selector) {
    const doc = await requestDocument(url);
    const out = [];
    const links = [...doc.querySelectorAll(selector)]
      .map(el => normalizeUrl(el.getAttribute('href') || el.getAttribute('src'), url))
      .filter(Boolean);
    for (const link of unique(links)) {
      if (isDirectDownloadUrl(link)) out.push({ url: link });
      else {
        const meta = await resolveMetaImage(link);
        out.push(...meta);
      }
      await delay(60);
    }
    return out;
  }

  async function resolveMetaImage(url) {
    if (isDirectDownloadUrl(url)) return [{ url }];
    const doc = await requestDocument(url);
    const picked = pickMetaImage(doc) ||
      [...doc.querySelectorAll('img[src]')]
        .map(img => normalizeUrl(img.getAttribute('src'), url))
        .find(u => isDirectDownloadUrl(u));
    return picked ? [{ url: picked }] : [];
  }

  function pickMetaImage(doc) {
    const meta = doc.querySelector('meta[property="og:image"], meta[name="twitter:image"]');
    return meta ? normalizeUrl(meta.getAttribute('content'), doc.URL || location.href) : '';
  }

  async function resolveJpgHost(url) {
    if (isDirectDownloadUrl(url)) return [{ url }];
    if (/\/(?:a|album)\//i.test(url)) return resolveGenericGallery(url, 'a[href], img[src]');
    return resolveMetaImage(url);
  }

  async function resolvePixeldrain(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/(?:u|l)\/([^/?#]+)/i);
      if (!m) return [];
      if (/\/u\//i.test(u.pathname)) return [{ url: `${u.origin}/api/file/${m[1]}` }];
    } catch {}
    return [];
  }

  async function resolveGofile(url) {
    const m = String(url).match(/gofile\.io\/d\/([^/?#]+)/i);
    const id = m && m[1] ? m[1] : '';
    if (!id) return [];
    const data = await requestJson(`https://api.gofile.io/contents/${encodeURIComponent(id)}?wt=4fd6sg89d7s6`);
    const out = [];
    walkValues(data, value => {
      if (typeof value === 'string' && /^https?:\/\//i.test(value) && isDirectDownloadUrl(value)) out.push({ url: value });
    });
    return uniqueBy(out, item => canonicalMediaKey(item.url));
  }

  async function resolveTurboAlbum(url) {
    const doc = await requestDocument(url);
    const ids = [...doc.querySelectorAll('a[href*="/v/"], a[href*="/d/"]')]
      .map(a => {
        const href = normalizeUrl(a.getAttribute('href'), url);
        const m = href.match(/\/(?:v|d)\/([^/?#]+)/i);
        return m ? { id: m[1], name: sanitizeNamePart(a.getAttribute('title') || a.textContent || '') } : null;
      })
      .filter(Boolean);
    const out = [];
    for (const item of uniqueBy(ids, x => x.id)) {
      const signed = await signTurboUrl(item.id, `https://turbo.cr/embed/${item.id}`, item.name);
      if (signed) out.push({ url: signed, name: item.name });
      await delay(120);
    }
    return out;
  }

  async function resolveTurboFile(url) {
    const m = String(url).match(/\/(?:embed|v|d)\/([^/?#]+)/i);
    const id = m && m[1] ? m[1] : '';
    if (!id) return [];
    const signed = await signTurboUrl(id, `https://turbo.cr/embed/${id}`, '');
    if (signed) return [{ url: signed }];
    const doc = await requestDocument(`https://turbo.cr/embed/${encodeURIComponent(id)}`);
    const src = doc.querySelector('source[src], video[src]');
    const direct = src ? normalizeUrl(src.getAttribute('src'), `https://turbo.cr/embed/${id}`) : '';
    return direct ? [{ url: direct }] : [];
  }

  async function signTurboUrl(id, refererUrl, nameHint) {
    const headers = { Accept: 'application/json, text/plain, */*', Referer: refererUrl };
    const endpoints = [
      `https://turbo.cr/api/sign?v=${encodeURIComponent(id)}`,
      `https://turbo.cr/sign?v=${encodeURIComponent(id)}`
    ];
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const endpoint of endpoints) {
        try {
          const data = await requestJson(endpoint, headers);
          if (data && data.url && (data.success === undefined || data.success)) {
            let signed = String(data.url);
            const originalName = data.original_filename || nameHint;
            if (originalName && !/[?&]fn=/.test(signed)) {
              signed += (signed.includes('?') ? '&' : '?') + `fn=${encodeURIComponent(String(originalName)).replace(/%20/g, '+')}`;
            }
            return signed;
          }
        } catch {}
      }
      await delay(700 + Math.floor(Math.random() * 700));
    }
    return '';
  }

  function buildDedupedDownloads(posts) {
    const sorted = posts
      .slice()
      .sort((a, b) => (a.page - b.page) || (Number(a.number) - Number(b.number)) || String(a.id).localeCompare(String(b.id)));
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
      const postFolder = buildPostFolderName(post, globalIndex);
      const decorated = {
        id: post.id,
        number: post.number,
        page: post.page,
        postFolder,
        files: []
      };

      postFiles.forEach((file, idx) => {
        const fileName = formatFileName(post, file, idx + 1, globalIndex);
        const item = {
          ...file,
          threadFolder: state.threadFolder,
          postFolder,
          fileName,
          path: `${postFolder}/${fileName}`
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
      if (!grouped.has(page)) grouped.set(page, { page, posts: [], files: [] });
      const bucket = grouped.get(page);
      bucket.posts.push(post);
      bucket.files.push(...post.files);
    }
    return [...grouped.values()].filter(page => page.files.length > 0).sort((a, b) => a.page - b.page);
  }

  async function downloadPostArchives() {
    if (state.busy || !state.posts.length) return;
    setBusy(true, 'Downloading...');
    setProgress(0);
    setCountTextOverride(formatUnitTicker(0, state.posts.length, 'post'));
    try {
      let done = 0;
      for (const post of state.posts) {
        const archiveName = `${state.threadFolder}/${post.postFolder}.zip`;
        logLine(`Building post zip ${done + 1}/${state.posts.length}: ${post.postFolder}`);
        await buildAndSaveArchive(post.files, archiveName, (pct, label) => {
          const base = (done / state.posts.length) * 100;
          const span = 100 / state.posts.length;
          setProgress(base + (pct / 100) * span);
          if (label) logLine(label);
        });
        done++;
        setCountTextOverride(formatUnitTicker(done, state.posts.length, 'post'));
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
        const archiveName = `${state.threadFolder}/page_${String(page.page).padStart(4, '0')}.zip`;
        logLine(`Building page zip ${done + 1}/${state.pages.length}: page ${page.page}, ${page.files.length} file${page.files.length === 1 ? '' : 's'}.`);
        await buildAndSaveArchive(page.files, archiveName, (pct, label) => {
          const base = (done / state.pages.length) * 100;
          const span = 100 / state.pages.length;
          setProgress(base + (pct / 100) * span);
          if (label) logLine(label);
        });
        done++;
        setCountTextOverride(formatUnitTicker(done, state.pages.length, 'page'));
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

  async function downloadThreadArchive() {
    if (state.busy || !state.files.length) return;
    setBusy(true, 'Downloading...');
    setProgress(0);
    setCountTextOverride(formatUnitTicker(0, state.files.length, 'file'));
    try {
      const archiveName = `${state.threadFolder}/${state.threadFolder}.zip`;
      logLine(`Building thread zip for ${state.threadTitle}.`);
      await buildAndSaveArchive(
        state.files,
        archiveName,
        pct => setProgress(pct),
        (done, total) => setCountTextOverride(formatUnitTicker(done, total, 'file'))
      );
      logLine(`Downloaded thread archive with ${state.files.length} file${state.files.length === 1 ? '' : 's'}.`);
    } catch (err) {
      logLine(`Thread download failed: ${errorMessage(err)}`);
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
        zip.file(file.path || file.fileName || fallbackFileName(file.url, added + 1), blob);
        added++;
        if (onProgress) onProgress(Math.round((added / files.length) * 68));
      } catch (err) {
        failed++;
        logLine(`Skipped failed file: ${file.fileName || shortUrl(file.url)} (${errorMessage(err)})`);
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

    await saveBlob(blob, sanitizeDownloadPathForSave(archiveName || 'simpguest_archive.zip'));
    if (onProgress) onProgress(100);
  }

  async function fetchBlobWithRetry(file) {
    const url = typeof file === 'string' ? file : file && file.url;
    if (!url) throw new Error('missing download URL');
    const referrer = typeof file === 'object' && file ? (file.referrer || file.sourceUrl || location.href) : location.href;
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await requestBlob(url, referrer);
      } catch (err) {
        lastErr = err;
        if (attempt >= MAX_RETRIES) break;
        const backoff = BACKOFF_BASE * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
        await delay(backoff);
      }
    }
    throw lastErr || new Error('download failed');
  }

  function requestDocument(url, headers) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        headers: headers || { Accept: 'text/html,application/xhtml+xml' },
        responseType: 'document',
        timeout: 45000,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          const doc = res.response || new DOMParser().parseFromString(res.responseText || '', 'text/html');
          try { Object.defineProperty(doc, 'URL', { value: url, configurable: true }); } catch {}
          resolve(doc);
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('request timeout'))
      });
    });
  }

  function requestText(url, headers) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: false,
        headers: headers || {},
        responseType: 'text',
        timeout: 45000,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          resolve(String(res.responseText || res.response || ''));
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('request timeout'))
      });
    });
  }

  function requestJson(url, headers) {
    return requestText(url, { Accept: 'application/json', ...(headers || {}) }).then(text => JSON.parse(text || '{}'));
  }

  function buildDownloadHeaders(url, referrer) {
    const headers = {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8'
    };
    const referer = normalizeReferrer(url, referrer);
    if (referer) headers.Referer = referer;
    return headers;
  }

  function normalizeReferrer(url, referrer) {
    const candidates = [referrer, location.href];
    for (const candidate of candidates) {
      try {
        const r = new URL(candidate, location.href);
        if (!/^https?:$/i.test(r.protocol)) continue;
        const target = new URL(url, location.href);
        if (/redgifs\.com$/i.test(target.hostname)) return 'https://www.redgifs.com/';
        if (/cyberdrop\.[a-z]+$/i.test(target.hostname)) return `${target.origin}/`;
        if (/bunkrr?r?\.|bunkr-cache\.|scdn\.st/i.test(target.hostname)) return `${target.origin}/`;
        return r.href;
      } catch {}
    }
    return '';
  }

  function getHeaderValue(rawHeaders, name) {
    const needle = String(name || '').toLowerCase();
    const lines = String(rawHeaders || '').split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      if (line.slice(0, idx).trim().toLowerCase() === needle) {
        return line.slice(idx + 1).trim();
      }
    }
    return '';
  }

  function requestBlob(url, referrer) {
    return new Promise((resolve, reject) => {
      const headers = buildDownloadHeaders(url, referrer);
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          anonymous: false,
          headers,
          responseType: 'blob',
          timeout: BLOB_TIMEOUT_MS,
          onload: res => {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error(`HTTP ${res.status}`));
              return;
            }
            const blob = res.response;
            if (!blob || typeof blob.size !== 'number' || blob.size <= 0) {
              reject(new Error('empty response'));
              return;
            }
            const contentType = getHeaderValue(res.responseHeaders, 'content-type') || blob.type || '';
            if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
              reject(new Error('received HTML instead of media'));
              return;
            }
            resolve(blob);
          },
          onerror: () => reject(new Error('network error')),
          ontimeout: () => reject(new Error('request timeout'))
        });
      } catch (err) {
        reject(err);
      }
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
            onerror: () => fallbackAnchorDownload(url, name, finish),
            ontimeout: () => fallbackAnchorDownload(url, name, finish)
          });
          return;
        }
      } catch (err) {
        fallbackAnchorDownload(url, name, finish);
        return;
      }

      fallbackAnchorDownload(url, name, finish);
    });
  }

  function fallbackAnchorDownload(url, name, finish) {
      const a = document.createElement('a');
      a.href = url;
      a.download = name.split('/').pop() || 'simpguest_archive.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => finish(), 250);
  }

  function buildPostFolderName(post, globalIndex) {
    return sanitizeGeneratedNamePart(buildPostBaseStem(post, globalIndex, 80));
  }

  function formatFileName(post, file, index, globalIndex) {
    const ext = file.ext || inferExt(file.url, file.nameHint) || 'bin';
    const idx = String(index || 1).padStart(6, '0');
    const hinted = file.nameHint ? sanitizeNamePart(stripExt(file.nameHint)).slice(0, 80) : '';
    const stem = hinted || `${buildPostBaseStem(post, globalIndex, 40)}_${idx}`;
    return sanitizeFileNameStrict(`${stem}.${ext}`, fallbackFileName(file.url, index));
  }

  function buildPostBaseStem(post, globalIndex, titleLimit) {
    const dateSec = formatDateSec(post.published);
    const threadSec = sanitizeCompactNamePart(state.threadTitle || post.title || 'thread').slice(0, titleLimit) || 'thread';
    const rawNumber = String(post.number || globalIndex || '').replace(/[^\d]/g, '');
    const numberSec = rawNumber ? rawNumber.padStart(6, '0') : String(globalIndex).padStart(6, '0');
    return `${dateSec}-${threadSec}-${numberSec} - postname`;
  }

  function formatDateSec(raw) {
    let d = null;
    if (typeof raw === 'number' && isFinite(raw) && raw > 0) d = new Date(raw > 1e12 ? raw : raw * 1000);
    if (!d || Number.isNaN(d.getTime())) d = new Date();
    const yy = String(d.getFullYear() % 100).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  function inferExt(url, nameHint) {
    const fromName = getUrlExt(nameHint || '');
    if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
    const fromQueryName = getUrlExt(getQueryFileName(url || ''));
    if (fromQueryName) return fromQueryName === 'jpeg' ? 'jpg' : fromQueryName;
    const fromUrl = getUrlExt(url || '');
    if (fromUrl) return fromUrl === 'jpeg' ? 'jpg' : fromUrl;
    if (/redgifs/i.test(url || '')) return 'mp4';
    return 'bin';
  }

  function getUrlExt(raw) {
    const s = String(raw || '').split('#')[0].split('?')[0];
    const dot = s.lastIndexOf('.');
    if (dot < 0 || dot >= s.length - 1) return '';
    const ext = s.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]+/g, '');
    return ext.length <= 8 ? ext : '';
  }

  function getQueryFileName(raw) {
    try {
      const u = new URL(String(raw || ''), location.href);
      return u.searchParams.get('fn') ||
        u.searchParams.get('filename') ||
        u.searchParams.get('file') ||
        u.searchParams.get('name') ||
        '';
    } catch {
      return '';
    }
  }

  function stripExt(raw) {
    const s = String(raw || '');
    const dot = s.lastIndexOf('.');
    return dot > 0 ? s.slice(0, dot) : s;
  }

  function normalizeUrl(raw, base) {
    if (!raw) return '';
    let u = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!u) return '';
    if (u.startsWith('//')) u = `${location.protocol}${u}`;
    try { return new URL(u, base || location.href).href; } catch {}
    try { return new URL(encodeURI(u), base || location.href).href; } catch {}
    return '';
  }

  function canonicalMediaKey(raw) {
    const normalized = normalizeUrl(raw);
    if (!normalized) return '';
    try {
      const u = new URL(normalized);
      let path = decodeURIComponent(u.pathname || '').replace(/\/+$/, '');
      path = path.replace(/\/(?:thumbs?|small|medium)\//gi, '/');
      return `${u.hostname.toLowerCase()}${path.toLowerCase()}`;
    } catch {
      return normalized.split('?')[0].toLowerCase();
    }
  }

  function sanitizeFolder(s) {
    let out = sanitizeNamePart(s);
    out = out.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return out || 'simpcity_thread';
  }

  function sanitizeCompactNamePart(s) {
    let out = sanitizeNamePart(s);
    out = out.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return out;
  }

  function sanitizeGeneratedNamePart(s) {
    let out = sanitizeNamePart(s);
    const dashToken = 'SIMPGUESTDASHSEP';
    out = out.replace(/\s+-\s+/g, dashToken);
    out = out.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    out = out.replace(new RegExp(dashToken, 'g'), ' - ');
    return out || 'post';
  }

  function sanitizeNamePart(s) {
    s = String(s || '').normalize('NFC');
    s = s.replace(/\uFFFD/g, '');
    s = s.replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/[\\/:*?"<>|]+/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/[. ]+$/g, '');
    return s;
  }

  function sanitizeFileNameStrict(raw, fallback) {
    let s = sanitizeNamePart(raw);
    s = s.replace(/[^A-Za-z0-9._ -]+/g, '');
    s = s.trim();
    return s || (fallback || 'download');
  }

  function sanitizeDownloadPathForSave(rawPath) {
    const parts = String(rawPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) return 'download';
    return parts.map((seg, idx) => sanitizeFileNameStrict(seg, idx === parts.length - 1 ? 'download' : 'folder')).join('/');
  }

  function fallbackFileName(url, index) {
    const ext = inferExt(url, '') || 'bin';
    return `media_${String(index || 1).padStart(6, '0')}.${ext}`;
  }

  function walkValues(value, cb, key, seen) {
    seen = seen || new Set();
    if (value === null || value === undefined) return;
    if (typeof value !== 'object') {
      cb(value, key || '');
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(item => walkValues(item, cb, key, seen));
    } else {
      Object.entries(value).forEach(([k, v]) => walkValues(v, cb, k, seen));
    }
  }

  function unique(items) {
    return [...new Set(items.filter(Boolean))];
  }

  function uniqueBy(items, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const key = keyFn(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function shortUrl(url) {
    const s = String(url || '');
    return s.length > 90 ? `${s.slice(0, 87)}...` : s;
  }

  function escapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
