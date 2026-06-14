// ==UserScript==
// @name         Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.14.00
// @description  Reddit media + post-text (Markdown) downloader with a built-in Rabbithole click-path map.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/Stripper.user.js
// @match        *://reddit.com/*
// @match        *://*.reddit.com/*
// @match        *://redd.it/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @require      https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      self
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

  if (isRedditHost()) {
    runRedditStripper();
  }

  function isRedditHost() {
    const host = String(location.hostname || '').toLowerCase();
    return /^(?:www\.)?redd\.it$/.test(host) || /(?:^|\.)reddit\.com$/.test(host);
  }

  const STRIPPER_SCAN_CACHE_PREFIX = 'Stripper.scanCache.v1:';

  function loadStripperScanCache(cacheKey) {
    if (!cacheKey) return null;
    try {
      const storageKey = STRIPPER_SCAN_CACHE_PREFIX + cacheKey;
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

  function saveStripperScanCache(cacheKey, payload) {
    if (!cacheKey || !payload) return false;
    try {
      const storageKey = STRIPPER_SCAN_CACHE_PREFIX + cacheKey;
      const serialized = JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        payload
      });
      if (typeof GM_setValue === 'function') GM_setValue(storageKey, serialized);
      else localStorage.setItem(storageKey, serialized);
      return true;
    } catch {
      return false;
    }
  }

  function removeStripperScanCache(cacheKey) {
    if (!cacheKey) return;
    try {
      const storageKey = STRIPPER_SCAN_CACHE_PREFIX + cacheKey;
      if (typeof GM_deleteValue === 'function') GM_deleteValue(storageKey);
      localStorage.removeItem(storageKey);
    } catch {}
  }

  function safeCachedArray(value) {
    return Array.isArray(value) ? value : [];
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

  function parseStripperRangeList(raw, maxNumber) {
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

  function formatStripperNumberRanges(values) {
    const numbers = [...new Set((values || [])
      .map(value => Number(value) || 0)
      .filter(value => value > 0))]
      .sort((a, b) => a - b);
    if (!numbers.length) return 'none';
    const ranges = [];
    let start = numbers[0];
    let prev = numbers[0];
    for (let i = 1; i < numbers.length; i++) {
      const current = numbers[i];
      if (current === prev + 1) {
        prev = current;
        continue;
      }
      ranges.push(start === prev ? String(start) : `${start}-${prev}`);
      start = current;
      prev = current;
    }
    ranges.push(start === prev ? String(start) : `${start}-${prev}`);
    return ranges.join(', ');
  }

  function runRedditStripper() {
    const JSZip = window.JSZip;
      const API_DELAY_MIN = 850;
      const API_DELAY_JITTER = 650;
      const FILE_DELAY_MS = 220;
      const MAX_API_PAGES = 500;
      const MAX_RETRIES = 2;
      const BACKOFF_BASE = 900;
      const BLOB_TIMEOUT_MS = 120000;
      const LISTING_LIMIT = 100;
      const USER_AGENT_NOTE = 'Stripper userscript';
    
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
        subreddits: [],
        summary: null,
        summaryNodeId: '',
        countTextOverride: '',
        lastScanAt: 0,
        loadedScanCacheKey: ''
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
        #redditGuestPanel .rg-selective {
          display: grid;
          gap: 7px;
          padding: 8px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.07);
        }
        #redditGuestPanel .rg-selective[hidden],
        #redditGuestPanel .rg-rangeRow[hidden] {
          display: none;
        }
        #redditGuestPanel .rg-rangeLabel {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: #d8d8dd;
          font-size: 11px;
          font-weight: 700;
        }
        #redditGuestPanel .rg-rangeHint {
          color: #a9a9b2;
          font-weight: 600;
        }
        #redditGuestPanel .rg-rangeRow {
          display: grid;
          grid-template-columns: 1fr 88px;
          gap: 7px;
        }
        #redditGuestPanel .rg-rangeRow input {
          width: 100%;
          min-width: 0;
          height: 32px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.18);
          color: #f4f4f5;
          padding: 0 9px;
          font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          outline: none;
        }
        #redditGuestPanel .rg-rangeRow input:focus {
          border-color: rgba(255, 176, 0, 0.72);
        }
        #redditGuestPanel .rg-rangeRow button {
          min-height: 32px;
          background: rgba(255, 255, 255, 0.11);
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
          <div class="rg-titlebar">
            <span class="rg-title">Stripper</span>
            <button id="rgMapBtn" class="rg-mapBtn" type="button" title="Reddit Rabbithole Map">
              <span class="rg-mapGlyph">🕸</span><span id="rgMapCount" class="rg-mapCount" hidden></span>
            </button>
          </div>
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
          <div id="rgSelectiveDownloads" class="rg-selective" hidden>
            <div class="rg-rangeLabel">
              <span>Posts</span>
              <span id="rgPostRangeHint" class="rg-rangeHint">1-0</span>
            </div>
            <div id="rgPostRangeRow" class="rg-rangeRow">
              <input id="rgPostRangeInput" type="text" inputmode="numeric" placeholder="1,3-5">
              <button id="rgPostRangeBtn" type="button" disabled>Download</button>
            </div>
            <div class="rg-rangeLabel">
              <span>Pages</span>
              <span id="rgPageRangeHint" class="rg-rangeHint">1-0</span>
            </div>
            <div id="rgPageRangeRow" class="rg-rangeRow">
              <input id="rgPageRangeInput" type="text" inputmode="numeric" placeholder="1,2-4">
              <button id="rgPageRangeBtn" type="button" disabled>Download</button>
            </div>
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
        ui.selectiveDownloads = panel.querySelector('#rgSelectiveDownloads');
        ui.postRangeHint = panel.querySelector('#rgPostRangeHint');
        ui.postRangeRow = panel.querySelector('#rgPostRangeRow');
        ui.postRangeInput = panel.querySelector('#rgPostRangeInput');
        ui.postRangeBtn = panel.querySelector('#rgPostRangeBtn');
        ui.pageRangeHint = panel.querySelector('#rgPageRangeHint');
        ui.pageRangeRow = panel.querySelector('#rgPageRangeRow');
        ui.pageRangeInput = panel.querySelector('#rgPageRangeInput');
        ui.pageRangeBtn = panel.querySelector('#rgPageRangeBtn');
        ui.log = panel.querySelector('#rgLog');
        ui.mapBtn = panel.querySelector('#rgMapBtn');
        ui.mapCount = panel.querySelector('#rgMapCount');

        ui.mapBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (panel.classList.contains('rg-collapsed')) { setCollapsed(false); return; }
          rabbithole.toggleWindow();
        });
        ui.scanBtn.addEventListener('click', () => scanCurrentProfile());
        ui.postsBtn.addEventListener('click', () => downloadPostArchives());
        ui.pagesBtn.addEventListener('click', () => downloadPageArchives());
        ui.userBtn.addEventListener('click', () => downloadUserArchive());
        ui.postRangeBtn.addEventListener('click', () => downloadSelectedPostArchives());
        ui.pageRangeBtn.addEventListener('click', () => downloadSelectedPageArchives());
        panel.addEventListener('click', () => {
          if (panel.classList.contains('rg-collapsed')) setCollapsed(false);
        });
        document.addEventListener('keydown', handleGlobalKeydown, true);
    
        logLine('Ready. Stripper detected Reddit; open a profile or post and scan.');
        syncUi();
        rabbithole.refreshButton();
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
        ui.selectiveDownloads.hidden = !hasFiles;
        ui.postRangeHint.textContent = state.posts.length ? `1-${state.posts.length}` : 'none';
        ui.postRangeInput.disabled = state.busy || !state.posts.length;
        ui.postRangeBtn.disabled = state.busy || !state.posts.length;
        ui.pageRangeRow.hidden = !hasPages;
        ui.pageRangeHint.textContent = hasPages ? formatStripperNumberRanges(state.pages.map(page => page.page)) : 'none';
        ui.pageRangeInput.disabled = state.busy || !hasPages;
        ui.pageRangeBtn.disabled = state.busy || !hasPages;
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

      function redditScanCacheKey(context) {
        if (!context) return '';
        if (context.type === 'post' && context.postId) return `reddit:post:${String(context.postId).toLowerCase()}`;
        if (context.type === 'profile' && context.username) return `reddit:profile:${String(context.username).toLowerCase()}`;
        return '';
      }

      function applyRedditCachedScan(cached, cacheKey) {
        const payload = cached && cached.payload ? cached.payload : {};
        state.scanType = payload.scanType || '';
        state.username = payload.username || '';
        state.userFolder = payload.userFolder || (state.username ? sanitizeUserFolder(state.username) : '');
        state.posts = safeCachedArray(payload.posts);
        state.pages = safeCachedArray(payload.pages);
        state.files = safeCachedArray(payload.files);
        state.subreddits = safeCachedArray(payload.subreddits);
        state.summary = payload.summary || null;
        state.summaryNodeId = payload.summaryNodeId || '';
        state.countTextOverride = '';
        state.lastScanAt = Number(payload.lastScanAt || cached.savedAt || 0) || Date.now();
        state.loadedScanCacheKey = cacheKey;
        if (state.summaryNodeId && state.summary) rabbithole.recordScan(state.summaryNodeId, state.summary);
        renderSubsPanel();
        setProgress(100);
        syncUi();
      }

      function buildRedditCachePayload() {
        return {
          scanType: state.scanType,
          username: state.username,
          userFolder: state.userFolder,
          posts: state.posts,
          pages: state.pages,
          files: state.files,
          subreddits: state.subreddits,
          summary: state.summary,
          summaryNodeId: state.summaryNodeId,
          lastScanAt: state.lastScanAt
        };
      }
    
      // Classify a scanned file as image / video / other (text .md excluded).
      function classifyFileKind(f) {
        if (!f || f.kind === 'text') return 'text';
        const ext = String(f.ext || '').toLowerCase();
        const mime = String(f.mime || '').toLowerCase();
        if (mime.indexOf('image/') === 0 || /^(?:avif|bmp|gif|jpe?g|png|webp)$/.test(ext)) return 'image';
        if (mime.indexOf('video/') === 0 || /^(?:m4v|mov|mp4|webm)$/.test(ext)) return 'video';
        return 'other';
      }

      // Roll up the current scan into a small summary the Rabbithole map can show.
      function computeScanSummary() {
        let files = 0, images = 0, videos = 0;
        for (const f of state.files) {
          const k = classifyFileKind(f);
          if (k === 'text') continue;
          files++;
          if (k === 'image') images++;
          else if (k === 'video') videos++;
        }
        return {
          posts: state.posts.length,
          files, images, videos,
          pages: state.pages.length,
          scannedAt: Date.now()
        };
      }

      // The Rabbithole node id for whatever was just scanned (matches classify()).
      function scannedNodeId(context) {
        if (!context) return '';
        if (context.type === 'post') return context.postId ? 'post:' + String(context.postId).toLowerCase() : '';
        const name = context.username || state.username;
        return name ? 'user:' + String(name).toLowerCase() : '';
      }

      // A separate fixed panel (top-right) listing every subreddit a scanned user
      // has posted in, with post counts. Appears after a user scan; closable.
      let subsStyleInjected = false;
      function ensureSubsPanel() {
        let p = document.getElementById('rgSubsPanel');
        if (p) return p;
        if (!subsStyleInjected) {
          subsStyleInjected = true;
          GM_addStyle(`
            #rgSubsPanel{position:fixed;top:18px;right:18px;z-index:2147483646;box-sizing:border-box;width:320px;
              max-width:calc(100vw - 36px);max-height:260px;display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.16);
              border-radius:12px;background:rgba(18,18,21,.92);backdrop-filter:blur(14px);box-shadow:0 16px 48px rgba(0,0,0,.42);
              color:#f4f4f5;font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
            #rgSubsPanel[hidden]{display:none;}
            #rgSubsPanel *{box-sizing:border-box;}
            #rgSubsPanel .rgsub-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 11px;
              border-bottom:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);}
            #rgSubsPanel .rgsub-title{font-weight:800;font-size:12px;letter-spacing:.3px;}
            #rgSubsPanel .rgsub-count{color:#a9a9b2;font-size:11px;font-weight:700;min-width:0;overflow:hidden;
              text-overflow:ellipsis;white-space:nowrap;}
            #rgSubsPanel .rgsub-close{appearance:none;width:24px;height:24px;padding:0;border-radius:7px;cursor:pointer;
              border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#f4f4f5;font-size:11px;font-weight:700;}
            #rgSubsPanel .rgsub-close:hover{background:rgba(255,255,255,.16);}
            #rgSubsPanel .rgsub-list{flex:1;min-height:0;overflow:auto;padding:6px;display:flex;flex-direction:column;gap:3px;scrollbar-width:thin;}
            #rgSubsPanel .rgsub-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;
              text-decoration:none;color:#e8e8ee;font-size:12px;font-weight:600;}
            #rgSubsPanel .rgsub-row:hover{background:rgba(255,255,255,.08);color:#fff;}
            #rgSubsPanel .rgsub-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
            #rgSubsPanel .rgsub-n{flex:0 0 auto;padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.12);
              color:#d8d8dd;font-size:10px;font-weight:800;}
          `);
        }
        p = document.createElement('div');
        p.id = 'rgSubsPanel';
        p.hidden = true;
        p.innerHTML = `
          <div class="rgsub-head">
            <span class="rgsub-title">Subreddits</span>
            <span class="rgsub-count" id="rgSubCount"></span>
            <span style="flex:1"></span>
            <button class="rgsub-close" type="button" title="Hide">✕</button>
          </div>
          <div class="rgsub-list" id="rgSubList"></div>`;
        document.body.appendChild(p);
        p.querySelector('.rgsub-close').addEventListener('click', () => { p.hidden = true; });
        return p;
      }

      function renderSubsPanel() {
        const subs = state.subreddits || [];
        if (!subs.length) {
          const ex = document.getElementById('rgSubsPanel');
          if (ex) ex.hidden = true;
          return;
        }
        const p = ensureSubsPanel();
        p.querySelector('#rgSubCount').textContent = `u/${state.username} · ${subs.length}`;
        const list = p.querySelector('#rgSubList');
        list.innerHTML = '';
        subs.forEach(s => {
          const row = document.createElement('a');
          row.className = 'rgsub-row';
          row.href = `https://www.reddit.com/r/${encodeURIComponent(s.name)}/`;
          row.target = '_blank';
          row.rel = 'noopener noreferrer';
          row.innerHTML = `<span class="rgsub-name">r/${s.name}</span><span class="rgsub-n">${s.count}</span>`;
          list.appendChild(row);
        });
        p.hidden = false;
      }

      async function scanCurrentProfile() {
        if (state.busy) return;
        const context = scanContextFromLocation();
        if (!context) {
          logLine('This page is not a Reddit user profile or post.');
          setProgress(0);
          return;
        }

        const cacheKey = redditScanCacheKey(context);
        if (cacheKey && state.loadedScanCacheKey !== cacheKey) {
          logLine(`Checking browser scan cache for ${cacheKey}.`);
          const cached = loadStripperScanCache(cacheKey);
          if (cached) {
            applyRedditCachedScan(cached, cacheKey);
            logLine(`Loaded cached Reddit scan from ${formatCacheAge(cached.savedAt)}. Press Scan again to refresh it.`);
            return;
          }
          logLine('No cached scan found; scanning now.');
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
        state.loadedScanCacheKey = '';
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
            .map(post => {
              const files = extractMediaFiles(post.raw);
              const md = buildPostTextFile(post, files.length > 0);   // post title/body as .md
              if (md) files.push(md);
              return { ...post, files };
            })
            .filter(post => post.files.length > 0);
    
          const deduped = buildDedupedDownloads(mediaPosts);
          state.posts = deduped.posts;
          state.pages = deduped.pages;
          state.files = deduped.files;

          // All subreddits this user has posted in (full list, pre-filter), with counts.
          if (context.type === 'post') {
            state.subreddits = [];
          } else {
            const counts = {};
            parsed.forEach(p => { if (p.subreddit) counts[p.subreddit] = (counts[p.subreddit] || 0) + 1; });
            state.subreddits = Object.keys(counts)
              .map(name => ({ name, count: counts[name] }))
              .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
          }

          // Hand a summary to the Rabbithole map so hovering this node shows it.
          state.summary = computeScanSummary();
          state.summaryNodeId = scannedNodeId(context);
          if (state.summaryNodeId) rabbithole.recordScan(state.summaryNodeId, state.summary);
          renderSubsPanel();

          state.loadedScanCacheKey = cacheKey;
          setProgress(100);
          logLine(`Scan complete: ${state.posts.length} post folder${state.posts.length === 1 ? '' : 's'}, ${state.pages.length} page archive${state.pages.length === 1 ? '' : 's'}, ${state.files.length} unique file${state.files.length === 1 ? '' : 's'}.`);
          if (deduped.duplicates > 0) {
            logLine(`Removed ${deduped.duplicates} duplicate file${deduped.duplicates === 1 ? '' : 's'}; oldest posts kept.`);
          }
          if (cacheKey) {
            if (saveStripperScanCache(cacheKey, buildRedditCachePayload())) {
              logLine('Saved this scan in the browser cache.');
            } else {
              logLine('Could not save scan cache in this browser.');
            }
          }
        } catch (err) {
          setProgress(0);
          removeStripperScanCache(cacheKey);
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
    
      // Build a Markdown sidecar holding a post's text: title, a little metadata,
      // and the self-text body. Returns null when there's nothing worth saving
      // (a link/media post with no body and no media of its own).
      function buildPostTextFile(post, hasMedia) {
        const raw = post.raw || {};
        const body = String(raw.selftext || '').trim();
        if (!hasMedia && !body) return null;

        const title = (post.title && post.title.trim()) ? post.title.trim() : `post_${post.id}`;
        const lines = [`# ${title}`, ''];
        const meta = [];
        if (post.user) meta.push(`- **Author:** u/${post.user}`);
        if (post.subreddit) meta.push(`- **Subreddit:** r/${post.subreddit}`);
        if (post.createdUtc) {
          try { meta.push(`- **Posted:** ${new Date(post.createdUtc * 1000).toISOString().slice(0, 10)}`); } catch (e) {}
        }
        const permalink = raw.permalink || post.permalink;
        if (permalink) meta.push(`- **Link:** https://www.reddit.com${permalink}`);
        const linkOut = raw.url_overridden_by_dest;
        if (linkOut && !/(?:^|\.)(?:redd\.it|reddit\.com)/i.test(linkOut)) meta.push(`- **URL:** ${linkOut}`);
        if (meta.length) lines.push(...meta, '');
        if (body) lines.push(body, '');

        return { kind: 'text', text: lines.join('\n'), ext: 'md', mime: 'text/markdown', url: '', name: 'post.md' };
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
          const textFiles = [];
          for (const file of post.files) {
            if (file.kind === 'text') { textFiles.push(file); continue; }   // .md never dedupes away
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
            user: post.user || state.username,
            title: post.title,
            subreddit: post.subreddit,
            permalink: post.permalink,
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
    
      function selectedRedditPostsFromRange() {
        const parsed = parseStripperRangeList(ui.postRangeInput.value, state.posts.length);
        if (parsed.error) {
          logLine(`Post range error: ${parsed.error}.`);
          return [];
        }
        return state.posts.filter((post, idx) => parsed.numbers.has(idx + 1));
      }

      function selectedRedditPagesFromRange() {
        const maxPage = state.pages.reduce((max, page) => Math.max(max, Number(page.page) || 0), 0);
        const parsed = parseStripperRangeList(ui.pageRangeInput.value, maxPage);
        if (parsed.error) {
          logLine(`Page range error: ${parsed.error}.`);
          return [];
        }
        return state.pages.filter((page, idx) => parsed.numbers.has(Number(page.page) || 0) || parsed.numbers.has(idx + 1));
      }

      async function downloadSelectedPostArchives() {
        if (state.busy) return;
        const selected = selectedRedditPostsFromRange();
        if (!selected.length) {
          logLine('No scanned posts matched that range.');
          return;
        }
        await downloadPostArchives(selected);
      }

      async function downloadSelectedPageArchives() {
        if (state.busy) return;
        const selected = selectedRedditPagesFromRange();
        if (!selected.length) {
          logLine('No scanned pages matched that range.');
          return;
        }
        await downloadPageArchives(selected);
      }

      async function downloadPostArchives(selectedPosts) {
        const posts = Array.isArray(selectedPosts) ? selectedPosts : state.posts;
        if (state.busy || !posts.length) return;
        setBusy(true, 'Downloading...');
        setProgress(0);
        setCountTextOverride(formatUnitTicker(0, posts.length, 'post'));
        try {
          let done = 0;
          for (const post of posts) {
            const firstFile = post.files[0];
            if (!firstFile) continue;
            const archiveName = buildArchiveName(firstFile.userFolder || state.userFolder, firstFile.postFolder);
            logLine(`Building post zip ${done + 1}/${posts.length}: ${firstFile.postFolder}`);
            await buildAndSaveArchive(post.files, archiveName, (pct, label) => {
              const base = (done / posts.length) * 100;
              const span = 100 / posts.length;
              setProgress(base + (pct / 100) * span);
              if (label) logLine(label);
            });
            done++;
            setCountTextOverride(formatUnitTicker(done, posts.length, 'post'));
            setProgress((done / posts.length) * 100);
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
    
      async function downloadPageArchives(selectedPages) {
        const pages = Array.isArray(selectedPages) ? selectedPages : state.pages;
        if (state.busy || !pages.length) return;
        setBusy(true, 'Downloading...');
        setProgress(0);
        setCountTextOverride(formatUnitTicker(0, pages.length, 'page'));
        try {
          let done = 0;
          for (const page of pages) {
            if (!page.files.length) continue;
            const archiveName = buildPageArchiveName(state.userFolder, page.page);
            logLine(`Building page zip ${done + 1}/${pages.length}: API page ${page.page}, ${page.posts.length} post${page.posts.length === 1 ? '' : 's'}, ${page.files.length} file${page.files.length === 1 ? '' : 's'}.`);
            await buildAndSaveArchive(page.files, archiveName, (pct, label) => {
              const base = (done / pages.length) * 100;
              const span = 100 / pages.length;
              setProgress(base + (pct / 100) * span);
              if (label) logLine(label);
            });
            done++;
            setCountTextOverride(formatUnitTicker(done, pages.length, 'page'));
            setProgress((done / pages.length) * 100);
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
        const fileName = fileObj.kind === 'text' ? `${base}.${ext}` : `${base}_${fIdx}.${ext}`;
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
    
      // ----------------------------------------------------------------------
      // Reddit Rabbithole Map — integrated. Records the click-path between
      // posts/users/subreddits as a network graph. Shares storage with the
      // standalone "Reddit Rabbithole Map" userscript (same rrm: keys), so it
      // reads any map you already built with the old script.
      // ----------------------------------------------------------------------
      const rabbithole = (function () {
        const NS = 'rrm:';        // storage prefix for nodes/edges (old-version compatible)
        const REV = 'rrm_rev';    // revision counter -> cross-tab live refresh
        const COLORS = { sub: '#4f9cf9', user: '#f97362', post: '#9b8cf9' };
        const BRIDGE_KEY = 'rrm_bridge_v1';   // legacy shared-localStorage key; only cleared on reset now

        let booted = false, winEl = null, network = null, nodesDS = null, edgesDS = null;
        let selectedId = null, query = '', lastNavByPop = false, resizeObs = null;
        let view = 'graph', typeFilter = 'all';   // view: 'graph' | 'columns'
        let didInitialFit = false;
        let tipEl = null, hoverTimer = null;

        // -------------------------------------------------------------- classify
        function classify(href) {
          let u;
          try { u = new URL(href, location.origin); } catch (e) { return null; }
          if (!/(?:^|\.)reddit\.com$/.test(u.hostname)) return null;
          const p = u.pathname.replace(/\/+$/, '');
          let m;
          if ((m = p.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]+)/i))) {
            return { type: 'post', id: 'post:' + m[2].toLowerCase(),
                     label: 'r/' + m[1] + '\n' + m[2],
                     url: u.origin + '/r/' + m[1] + '/comments/' + m[2] };
          }
          if ((m = p.match(/^\/(?:user|u)\/([^/]+)/i))) {
            return { type: 'user', id: 'user:' + m[1].toLowerCase(),
                     label: 'u/' + m[1], url: u.origin + '/user/' + m[1] };
          }
          if ((m = p.match(/^\/r\/([^/]+)/i))) {
            return { type: 'sub', id: 'sub:' + m[1].toLowerCase(),
                     label: 'r/' + m[1], url: u.origin + '/r/' + m[1] };
          }
          return null;
        }

        // ---------------------------------------------------------------- storage
        function bumpRev() { GM_setValue(REV, (GM_getValue(REV, 0) || 0) + 1); }

        function upsertNode(n, visited) {
          const key = NS + 'n:' + n.id;
          const raw = GM_getValue(key, null);
          const rec = raw ? JSON.parse(raw)
                          : { id: n.id, type: n.type, label: n.label, url: n.url, visited: false, first: Date.now() };
          rec.label = n.label; rec.url = n.url; rec.type = n.type; rec.last = Date.now();
          if (visited) rec.visited = true;
          GM_setValue(key, JSON.stringify(rec));
          bumpRev();
        }

        function addEdge(from, to) {
          if (!from || !to || from === to) return;
          const key = NS + 'e:' + from + '__' + to;
          if (GM_getValue(key, null)) return;
          GM_setValue(key, JSON.stringify({ from, to, ts: Date.now() }));
          bumpRev();
        }

        function loadGraph() {
          const nodes = [], edges = [];
          for (const k of GM_listValues()) {
            if (k.startsWith(NS + 'n:')) nodes.push(JSON.parse(GM_getValue(k)));
            else if (k.startsWith(NS + 'e:')) edges.push(JSON.parse(GM_getValue(k)));
          }
          return { nodes, edges };
        }

        function countNodes() {
          let n = 0;
          for (const k of GM_listValues()) if (k.startsWith(NS + 'n:')) n++;
          return n;
        }

        function removeNodes(ids) {
          const set = new Set(ids);
          for (const k of GM_listValues()) {
            if (k.startsWith(NS + 'n:')) {
              if (set.has(k.slice((NS + 'n:').length))) GM_deleteValue(k);
            } else if (k.startsWith(NS + 'e:')) {
              const e = JSON.parse(GM_getValue(k));
              if (set.has(e.from) || set.has(e.to)) GM_deleteValue(k);
            }
          }
          bumpRev();
        }

        function resetAll() {
          for (const k of GM_listValues()) if (k.startsWith(NS)) GM_deleteValue(k);
          try { localStorage.removeItem(BRIDGE_KEY); } catch (e) {}   // wipe any legacy shared snapshot too
          bumpRev();
        }

        // Cross a node off (mark "scraped") without deleting it or its links.
        function setScraped(id, scraped) {
          const key = NS + 'n:' + id;
          const raw = GM_getValue(key, null);
          if (!raw) return;
          const rec = JSON.parse(raw);
          rec.scraped = !!scraped;
          GM_setValue(key, JSON.stringify(rec));
          bumpRev();
        }

        // ------------------------------------------------------------- scan link
        // Scan summaries written by the Stripper scanner, keyed by node id, so
        // hovering a node can show how much media/text was found (or "Unscanned").
        function recordScan(id, summary) {
          if (!id || !summary) return;
          try { GM_setValue(NS + 'scan:' + id, JSON.stringify(summary)); } catch (e) {}
          if (isWindowOpen()) scheduleRender();
        }
        function getScan(id) {
          try { const raw = GM_getValue(NS + 'scan:' + id, null); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
        }
        function scanSummaryText(id) {
          const s = getScan(id);
          if (!s) return 'Unscanned';
          return `Scanned: ${s.posts || 0} posts, ${s.files || 0} files `
            + `(${s.images || 0} img / ${s.videos || 0} vid), ${s.pages || 0} pages`;
        }

        // -------------------------------------------------------- import / merge
        // Merge a dataset from an exported JSON file (manual Import button).
        // Union semantics: new nodes/edges are added; existing nodes keep the
        // richer state (visited/scraped OR'd, earliest first / latest last). Never
        // deletes or downgrades anything, and is safe to run repeatedly.
        function mergeBridge(bridge) {
          if (!bridge || bridge.v !== 1) return 0;
          let changes = 0;
          (bridge.nodes || []).forEach(n => {
            if (!n || !n.id || !n.type) return;
            const key = NS + 'n:' + n.id;
            const raw = GM_getValue(key, null);
            if (!raw) {
              GM_setValue(key, JSON.stringify({
                id: n.id, type: n.type, label: n.label, url: n.url,
                visited: !!n.visited, scraped: !!n.scraped,
                first: n.first || Date.now(), last: n.last || Date.now(),
              }));
              changes++;
              return;
            }
            const cur = JSON.parse(raw);
            const visited = !!(cur.visited || n.visited);
            const scraped = !!(cur.scraped || n.scraped);
            const label = cur.label || n.label;
            const url = cur.url || n.url;
            // Only a real state change counts — timestamp drift alone is ignored.
            const changed = visited !== !!cur.visited || scraped !== !!cur.scraped
                || label !== cur.label || url !== cur.url;
            if (changed) {
              const first = Math.min(cur.first || Date.now(), n.first || Date.now());
              const last = Math.max(cur.last || 0, n.last || 0);
              GM_setValue(key, JSON.stringify({ id: cur.id, type: cur.type || n.type, label, url, visited, scraped, first, last }));
              changes++;
            }
          });
          (bridge.edges || []).forEach(e => {
            if (!e || !e.from || !e.to) return;
            const key = NS + 'e:' + e.from + '__' + e.to;
            if (!GM_getValue(key, null)) {
              GM_setValue(key, JSON.stringify({ from: e.from, to: e.to, ts: e.ts || Date.now() }));
              changes++;
            }
          });
          return changes;
        }

        // ------------------------------------------------------------ export / import
        // Manual only. No background publishing or importing — the map lives purely
        // in this install's own GM storage so resetting/deleting actually sticks.
        // Download the whole map as a JSON file — an install-independent backup.
        function exportData() {
          try {
            const g = loadGraph();
            const blob = new Blob([JSON.stringify({ v: 1, ts: Date.now(), nodes: g.nodes, edges: g.edges }, null, 2)],
              { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'rabbithole-map-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
            try { logLine(`Rabbithole: exported ${g.nodes.length} nodes / ${g.edges.length} links.`); } catch (e) {}
          } catch (e) {}
        }

        // Load a previously exported JSON file and merge it in (same union rules).
        function importDataFromFile(file) {
          const reader = new FileReader();
          reader.onload = () => {
            let data = null;
            try { data = JSON.parse(reader.result); } catch (e) { try { logLine('Rabbithole: import failed (not valid JSON).'); } catch (e2) {} return; }
            const changes = mergeBridge(data);
            if (changes) { bumpRev(); }
            try { logLine(`Rabbithole: imported ${changes} new item${changes === 1 ? '' : 's'} from file.`); } catch (e) {}
            renderGraph();
          };
          reader.readAsText(file);
        }

        function descendants(rootId, edges) {
          const out = new Set([rootId]), adj = {};
          edges.forEach(e => (adj[e.from] = adj[e.from] || []).push(e.to));
          const stack = [rootId];
          while (stack.length) {
            const cur = stack.pop();
            for (const nxt of (adj[cur] || [])) if (!out.has(nxt)) { out.add(nxt); stack.push(nxt); }
          }
          return [...out];
        }

        // ---------------------------------------------------------- navigate away
        // Jumping to a node from the map is an explicit teleport, not part of the
        // browsing trail, so it must NOT create an edge. We flag the jump in
        // sessionStorage; onLocation (same tab) sees the flag and skips edge
        // creation. New tabs are opened with noopener so they start with a clean
        // sessionStorage (no rrm_last) and therefore can't chain an edge either.
        function openNodeCurrentTab(url) {
          if (!url) return;
          try { sessionStorage.setItem('rrm_jump', '1'); } catch (e) {}
          location.href = url;
        }
        function openNodeNewTab(url) {
          if (!url) return;
          try { sessionStorage.setItem('rrm_jump', '1'); } catch (e) {}
          window.open(url, '_blank', 'noopener');
          try { sessionStorage.removeItem('rrm_jump'); } catch (e) {}
        }

        // -------------------------------------------------------------- capture
        function anchorFrom(e) {
          const path = e.composedPath ? e.composedPath() : [];
          for (const el of path) if (el && el.tagName === 'A' && el.href) return el;
          let el = e.target;
          while (el) { if (el.tagName === 'A' && el.href) return el; el = el.parentNode; }
          return null;
        }

        function onClick(e) {
          const a = anchorFrom(e);
          if (!a) return;
          if (winEl && winEl.contains(a)) return;   // clicks inside the map aren't browsing
          const dest = classify(a.href);
          if (!dest) return;
          const src = classify(location.href);
          upsertNode(dest, false);
          if (src) addEdge(src.id, dest.id);
        }

        function onLocation() {
          let isJump = false;
          try {
            if (sessionStorage.getItem('rrm_jump')) { isJump = true; sessionStorage.removeItem('rrm_jump'); }
          } catch (e) {}
          const cur = classify(location.href);
          if (cur) {
            upsertNode(cur, true);
            try {
              const rawLast = sessionStorage.getItem('rrm_last');
              if (rawLast && !lastNavByPop && !isJump) {
                const last = JSON.parse(rawLast);
                if (last.id && last.id !== cur.id && (Date.now() - last.ts) < 60000) addEdge(last.id, cur.id);
              }
            } catch (e) {}
            try { sessionStorage.setItem('rrm_last', JSON.stringify({ id: cur.id, ts: Date.now() })); } catch (e) {}
          }
          lastNavByPop = false;
          scheduleRender();
        }

        // Coalesce bursty re-renders (a single navigation writes a node + maybe
        // an edge, each bumping REV) so the graph refreshes at most once per
        // pause instead of several times in a row.
        let renderTimer = null;
        function scheduleRender() {
          if (!isWindowOpen()) { refreshButton(); return; }
          if (renderTimer) clearTimeout(renderTimer);
          renderTimer = setTimeout(() => { renderTimer = null; renderGraph(); }, 400);
        }

        // ------------------------------------------------------------------- UI
        function injectStyle() {
          GM_addStyle(`
            #redditGuestPanel .rg-titlebar{display:flex;align-items:center;gap:8px;}
            #redditGuestPanel .rg-title{flex:1;font-weight:800;font-size:13px;letter-spacing:.3px;color:#f4f4f5;}
            #redditGuestPanel button.rg-mapBtn{width:auto;min-height:28px;padding:0 10px;display:flex;align-items:center;gap:6px;
              background:rgba(255,255,255,.11);}
            #redditGuestPanel button.rg-mapBtn:hover:not(:disabled){background:rgba(255,255,255,.17);border-color:rgba(255,255,255,.28);}
            #redditGuestPanel .rg-mapGlyph{font-size:14px;line-height:1;}
            #redditGuestPanel .rg-mapCount{padding:1px 6px;border-radius:999px;font-size:10px;font-weight:800;color:#fff;
              background:linear-gradient(90deg,#ff4500,#ffb000);}
            #redditGuestPanel .rg-mapCount[hidden]{display:none;}

            #rrm-window{position:fixed;z-index:2147483646;box-sizing:border-box;width:560px;height:440px;
              min-width:340px;min-height:260px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);
              display:flex;flex-direction:column;overflow:hidden;resize:both;
              border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(18,18,21,.94);
              backdrop-filter:blur(14px);box-shadow:0 18px 56px rgba(0,0,0,.5);color:#f4f4f5;
              font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
            #rrm-window *{box-sizing:border-box;}
            #rrm-window[hidden]{display:none;}
            #rrm-titlebar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:move;
              user-select:none;border-bottom:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);
              border-radius:14px 14px 0 0;}
            #rrm-titlebar .rrm-title{font-weight:800;font-size:12px;letter-spacing:.3px;}
            #rrm-toolbar{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;
              border-bottom:1px solid rgba(255,255,255,.10);}
            #rrm-search{flex:1;min-width:120px;height:28px;padding:0 9px;border-radius:8px;
              border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.22);color:#f4f4f5;
              font-family:inherit;font-size:12px;font-weight:600;outline:none;}
            #rrm-search:focus{border-color:rgba(255,176,0,.72);}
            #rrm-window .rrm-btn{appearance:none;min-height:28px;padding:0 11px;border:1px solid rgba(255,255,255,.16);
              border-radius:8px;background:rgba(255,255,255,.11);color:#f4f4f5;font-family:inherit;font-size:11px;
              font-weight:700;cursor:pointer;white-space:nowrap;
              transition:background 120ms ease,border-color 120ms ease,opacity 120ms ease;}
            #rrm-window .rrm-btn:hover:not(:disabled){background:rgba(255,255,255,.17);border-color:rgba(255,255,255,.28);}
            #rrm-window .rrm-btn:disabled{opacity:.42;cursor:default;}
            #rrm-window .rrm-btn.primary{background:#ff4500;}
            #rrm-window .rrm-btn.primary:hover:not(:disabled){background:#ff5c1c;}
            #rrm-window .rrm-btn.danger{background:rgba(255,69,0,.16);border-color:rgba(255,69,0,.5);}
            #rrm-window .rrm-btn.danger:hover:not(:disabled){background:rgba(255,69,0,.28);border-color:rgba(255,69,0,.7);}
            #rrm-window .rrm-btn.icon{padding:0;width:28px;}
            #rrm-graph{flex:1;min-height:0;position:relative;}
            #rrm-tip{position:absolute;z-index:5;transform:translate(-50%,0);min-width:130px;max-width:240px;
              padding:8px 10px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(24,24,28,.97);
              box-shadow:0 10px 30px rgba(0,0,0,.5);color:#f4f4f5;font-size:11px;pointer-events:none;}
            #rrm-tip[hidden]{display:none;}
            #rrm-tip .rrm-tip-h{font-weight:800;font-size:12px;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
            #rrm-tip .rrm-tip-row{display:flex;justify-content:space-between;gap:14px;color:#c9c9cf;padding:1px 0;}
            #rrm-tip .rrm-tip-row b{color:#fff;font-weight:700;}
            #rrm-tip .rrm-tip-un{color:#a9a9b2;font-style:italic;}
            #rrm-foot{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:8px 11px;
              border-top:1px solid rgba(255,255,255,.10);font-size:11px;color:#a9a9b2;}
            #rrm-foot .rrm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px;}
            #rrm-count{color:#d8d8dd;font-weight:700;}
            #rrm-window .rrm-select{height:28px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.16);
              background:rgba(0,0,0,.22);color:#f4f4f5;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;outline:none;}
            #rrm-window .rrm-select:focus{border-color:rgba(255,176,0,.72);}
            #rrm-window .rrm-btn.active{background:#ff4500;}
            #rrm-columns{flex:1;min-height:0;display:none;gap:10px;padding:10px;overflow:auto;}
            #rrm-columns .rrm-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;overflow:hidden;
              border:1px solid rgba(255,255,255,.10);border-radius:10px;background:rgba(255,255,255,.03);}
            #rrm-columns .rrm-col-head{flex:0 0 auto;padding:8px 10px;font-weight:800;font-size:12px;
              border-bottom:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);}
            #rrm-columns .rrm-col-count{opacity:.7;}
            #rrm-columns .rrm-col-list{flex:1;min-height:0;overflow:auto;padding:6px;display:flex;flex-direction:column;
              gap:4px;scrollbar-width:thin;}
            #rrm-columns .rrm-col-empty{padding:8px 6px;color:#7a7a82;font-size:11px;}
            #rrm-columns .rrm-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:7px;}
            #rrm-columns .rrm-row:hover{background:rgba(255,255,255,.06);}
            #rrm-columns .rrm-row-chk{flex:0 0 auto;width:14px;height:14px;cursor:pointer;accent-color:#ff4500;}
            #rrm-columns .rrm-row-link{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
              color:#e8e8ee;text-decoration:none;font-size:12px;font-weight:600;cursor:pointer;}
            #rrm-columns .rrm-row-link:hover{color:#fff;text-decoration:underline;}
            #rrm-columns .rrm-row-link.unvisited{color:#9a9aa2;}
            #rrm-columns .rrm-row.scraped .rrm-row-link{text-decoration:line-through;color:#6f6f76;}
            #rrm-columns .rrm-row-btn{flex:0 0 auto;width:22px;height:22px;padding:0;border-radius:6px;line-height:1;
              border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#d8d8dd;
              font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;}
            #rrm-columns .rrm-row-btn:hover{background:rgba(255,255,255,.16);}
            #rrm-columns .rrm-row-btn.rm:hover{background:rgba(255,69,0,.28);border-color:rgba(255,69,0,.6);}
          `);
        }

        function buildWindow() {
          const win = document.createElement('div');
          win.id = 'rrm-window';
          win.innerHTML = `
            <div id="rrm-titlebar">
              <span class="rrm-title">🕸 Rabbithole Map</span>
              <span style="flex:1"></span>
              <button class="rrm-btn icon" data-act="close" title="Close">✕</button>
            </div>
            <div id="rrm-toolbar">
              <input id="rrm-search" type="text" placeholder="Filter nodes by name…" autocomplete="off" spellcheck="false">
              <select id="rrm-type" class="rrm-select" title="Filter by node type">
                <option value="all">All types</option>
                <option value="sub">Subreddits</option>
                <option value="user">Users</option>
                <option value="post">Posts</option>
              </select>
              <button class="rrm-btn" data-act="view" title="Toggle graph / column view">Column view</button>
              <button class="rrm-btn primary" data-act="open" disabled>Open ↗</button>
              <button class="rrm-btn" data-act="open-tab" disabled>New tab</button>
              <button class="rrm-btn" data-act="scrape" disabled>Cross off</button>
              <button class="rrm-btn" data-act="rm" disabled>Remove</button>
              <button class="rrm-btn" data-act="branch" disabled>Remove branch</button>
              <span style="flex:1"></span>
              <button class="rrm-btn" data-act="export" title="Download the whole map as a JSON backup">Export</button>
              <button class="rrm-btn" data-act="import" title="Merge a previously exported JSON file">Import</button>
              <button class="rrm-btn" data-act="visited">Clear visited</button>
              <button class="rrm-btn danger" data-act="reset">Reset</button>
              <input id="rrm-file" type="file" accept="application/json,.json" hidden>
            </div>
            <div id="rrm-graph"></div>
            <div id="rrm-columns"></div>
            <div id="rrm-foot">
              <span><span class="rrm-dot" style="background:${COLORS.sub}"></span>subreddit</span>
              <span><span class="rrm-dot" style="background:${COLORS.user}"></span>user</span>
              <span><span class="rrm-dot" style="background:${COLORS.post}"></span>post</span>
              <span style="opacity:.7">dashed = not visited · ✓ dim = crossed off · double-click opens</span>
              <span style="flex:1"></span>
              <span id="rrm-count"></span>
            </div>`;
          document.body.appendChild(win);
          winEl = win;

          // position near top-center on first open
          const w = win.offsetWidth || 560;
          win.style.left = Math.max(8, Math.round((window.innerWidth - w) / 2)) + 'px';
          win.style.top = '64px';
          win.style.right = 'auto';
          win.style.bottom = 'auto';

          const titlebar = win.querySelector('#rrm-titlebar');
          makeDraggable(win, titlebar);

          const search = win.querySelector('#rrm-search');
          search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderGraph(); });

          const typeSel = win.querySelector('#rrm-type');
          typeSel.value = typeFilter;
          typeSel.addEventListener('change', () => { typeFilter = typeSel.value; renderGraph(); });

          win.querySelector('[data-act="view"]').onclick = () => {
            view = (view === 'columns') ? 'graph' : 'columns';
            renderGraph();
            // graph container was display:none in column view; recover its size
            if (view === 'graph' && network) {
              requestAnimationFrame(() => { if (network) { network.setSize('100%', '100%'); network.redraw(); } });
            }
          };
          win.querySelector('[data-act="scrape"]').onclick = () => {
            const n = curNode(); if (!n) return; setScraped(n.id, !n.scraped); renderGraph();
          };
          win.querySelector('[data-act="close"]').onclick = closeWindow;
          win.querySelector('[data-act="open"]').onclick = () => { const n = curNode(); if (n) openNodeCurrentTab(n.url); };
          win.querySelector('[data-act="open-tab"]').onclick = () => { const n = curNode(); if (n) openNodeNewTab(n.url); };
          win.querySelector('[data-act="rm"]').onclick = () => {
            if (selectedId) { removeNodes([selectedId]); selectedId = null; renderGraph(); }
          };
          win.querySelector('[data-act="branch"]').onclick = () => {
            if (selectedId) { const g = loadGraph(); removeNodes(descendants(selectedId, g.edges)); selectedId = null; renderGraph(); }
          };
          win.querySelector('[data-act="visited"]').onclick = () => {
            const g = loadGraph(); removeNodes(g.nodes.filter(n => n.visited).map(n => n.id)); selectedId = null; renderGraph();
          };
          win.querySelector('[data-act="reset"]').onclick = () => {
            if (confirm('Erase the entire rabbithole map?')) { resetAll(); selectedId = null; renderGraph(); }
          };
          const fileInput = win.querySelector('#rrm-file');
          win.querySelector('[data-act="export"]').onclick = exportData;
          win.querySelector('[data-act="import"]').onclick = () => fileInput.click();
          fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files[0]) importDataFromFile(fileInput.files[0]);
            fileInput.value = '';
          });
          win.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeWindow(); } });

          initNetwork(win.querySelector('#rrm-graph'));

          tipEl = document.createElement('div');
          tipEl.id = 'rrm-tip';
          tipEl.hidden = true;
          win.querySelector('#rrm-graph').appendChild(tipEl);

          if (typeof ResizeObserver !== 'undefined') {
            resizeObs = new ResizeObserver(() => {
              if (network) { network.setSize('100%', '100%'); network.redraw(); }
            });
            resizeObs.observe(win);
          }
        }

        function makeDraggable(win, handle) {
          let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
          handle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button, input')) return;
            dragging = true;
            const r = win.getBoundingClientRect();
            ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
            win.style.left = ox + 'px'; win.style.top = oy + 'px';
            win.style.right = 'auto'; win.style.bottom = 'auto';
            try { handle.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
          });
          handle.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const maxX = window.innerWidth - 60, maxY = window.innerHeight - 30;
            let nx = ox + (e.clientX - sx);
            let ny = oy + (e.clientY - sy);
            nx = Math.min(Math.max(nx, 60 - win.offsetWidth), maxX);
            ny = Math.min(Math.max(ny, 0), maxY);
            win.style.left = nx + 'px'; win.style.top = ny + 'px';
          });
          const end = (e) => { if (dragging) { dragging = false; try { handle.releasePointerCapture(e.pointerId); } catch (err) {} } };
          handle.addEventListener('pointerup', end);
          handle.addEventListener('pointercancel', end);
        }

        function curNode() { return loadGraph().nodes.find(n => n.id === selectedId) || null; }

        function initNetwork(container) {
          if (typeof vis === 'undefined' || !vis.Network) {
            container.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;'
              + 'color:#a9a9b2;font-size:12px;text-align:center;padding:24px;">Graph library failed to load.<br>'
              + 'Check the userscript’s network access and reload.</div>';
            return;
          }
          nodesDS = new vis.DataSet([]); edgesDS = new vis.DataSet([]);
          network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
            nodes: { shape: 'dot', size: 14, font: { color: '#f4f4f5', size: 12, face: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } },
            edges: { arrows: 'to', color: { color: 'rgba(255,255,255,0.22)', highlight: '#ffb000', hover: 'rgba(255,255,255,0.4)' }, smooth: { type: 'dynamic' } },
            interaction: { hover: true, multiselect: false },
            physics: { enabled: true, solver: 'forceAtlas2Based', stabilization: { iterations: 150 },
                       forceAtlas2Based: { gravitationalConstant: -45, springLength: 90 } },
          });
          // Freeze the layout once it settles so navigating around doesn't keep
          // nudging nodes. Physics is only re-armed (kickPhysics) when the graph
          // actually gains or loses nodes/edges.
          network.on('stabilized', () => { freezePhysics(); separateComponents(); });
          network.on('selectNode',   p => { selectedId = p.nodes[0]; updateActionButtons(); });
          network.on('deselectNode', () => { selectedId = null; updateActionButtons(); });
          network.on('doubleClick',  p => {
            if (!p.nodes[0]) return;
            const n = loadGraph().nodes.find(x => x.id === p.nodes[0]);
            if (n) openNodeCurrentTab(n.url);
          });
          // Hover a node for a beat to see its scan summary (or "Unscanned").
          network.on('hoverNode', p => {
            if (hoverTimer) clearTimeout(hoverTimer);
            const id = p.node;
            hoverTimer = setTimeout(() => showTip(id), 900);
          });
          network.on('blurNode', hideTip);
          network.on('dragStart', hideTip);
          network.on('zoom', hideTip);
          network.on('click', hideTip);
          renderGraph();
        }

        function escapeHtml(s) {
          return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        }

        function showTip(id) {
          if (!network || !tipEl || view === 'columns') return;
          const node = loadGraph().nodes.find(x => x.id === id);
          if (!node) return;
          const label = escapeHtml((node.label || '').replace(/\n/g, ' '));
          const s = getScan(id);
          let body;
          if (!s) {
            body = '<div class="rrm-tip-un">Unscanned</div>';
          } else {
            const row = (k, v) => `<div class="rrm-tip-row"><span>${k}</span><b>${v}</b></div>`;
            body = row('Posts', s.posts || 0)
              + row('Files', s.files || 0)
              + row('Images / Videos', `${s.images || 0} / ${s.videos || 0}`)
              + row('Pages', s.pages || 0);
          }
          tipEl.innerHTML = `<div class="rrm-tip-h">${label}</div>${body}`;
          const pos = network.getPositions([id])[id];
          if (!pos) return;
          const dom = network.canvasToDOM(pos);
          tipEl.style.left = dom.x + 'px';
          tipEl.style.top = (dom.y + 16) + 'px';
          tipEl.hidden = false;
        }

        function hideTip() {
          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
          if (tipEl) tipEl.hidden = true;
        }

        // Re-arm physics briefly; the 'stabilized' handler (or the fallback
        // timer) turns it back off so the graph stops drifting once it settles.
        let physicsTimer = null;
        function kickPhysics() {
          if (!network) return;
          network.setOptions({ physics: { enabled: true } });
          if (physicsTimer) clearTimeout(physicsTimer);
          physicsTimer = setTimeout(freezePhysics, 2500);
        }
        function freezePhysics() {
          if (physicsTimer) { clearTimeout(physicsTimer); physicsTimer = null; }
          if (network) network.setOptions({ physics: { enabled: false } });
        }

        // Once the layout has settled, pull apart graphs that aren't connected to
        // each other: find the connected components, then rigidly shift each one
        // onto its own cell in a spaced grid so separate clusters never overlap and
        // are easy to tell apart. Each component keeps its own internal shape — we
        // only move whole clusters, not the nodes within them. Runs with physics
        // already frozen, so the new positions stick.
        function separateComponents() {
          if (!network || !nodesDS) return;
          const ids = nodesDS.getIds();
          if (ids.length < 2) { maybeInitialFit(); return; }

          const adj = {};
          ids.forEach(id => { adj[id] = []; });
          edgesDS.get().forEach(e => {
            if (adj[e.from] && adj[e.to]) { adj[e.from].push(e.to); adj[e.to].push(e.from); }
          });

          const seen = new Set(), comps = [];
          ids.forEach(id => {
            if (seen.has(id)) return;
            const comp = [], stack = [id];
            seen.add(id);
            while (stack.length) {
              const c = stack.pop();
              comp.push(c);
              (adj[c] || []).forEach(nb => { if (!seen.has(nb)) { seen.add(nb); stack.push(nb); } });
            }
            comps.push(comp);
          });
          if (comps.length < 2) { maybeInitialFit(); return; }

          const pos = network.getPositions();
          const info = comps.map(comp => {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cx = 0, cy = 0;
            comp.forEach(id => {
              const p = pos[id] || { x: 0, y: 0 };
              minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
              cx += p.x; cy += p.y;
            });
            return { comp, w: maxX - minX, h: maxY - minY, cx: cx / comp.length, cy: cy / comp.length };
          });

          const GAP = 260;   // clear empty space between clusters
          const cellW = Math.max(...info.map(i => i.w)) + GAP;
          const cellH = Math.max(...info.map(i => i.h)) + GAP;
          const cols = Math.ceil(Math.sqrt(comps.length));
          const rows = Math.ceil(comps.length / cols);
          const originX = -((cols - 1) * cellW) / 2;   // center the whole grid on (0,0)
          const originY = -((rows - 1) * cellH) / 2;

          info.forEach((ci, idx) => {
            const targetX = originX + (idx % cols) * cellW;
            const targetY = originY + Math.floor(idx / cols) * cellH;
            const dx = targetX - ci.cx, dy = targetY - ci.cy;
            ci.comp.forEach(id => {
              const p = pos[id] || { x: 0, y: 0 };
              network.moveNode(id, p.x + dx, p.y + dy);
            });
          });
          maybeInitialFit();
        }

        function maybeInitialFit() {
          if (didInitialFit || !network) return;
          didInitialFit = true;
          try { network.fit({ animation: false }); } catch (e) {}
        }

        function updateActionButtons() {
          if (!winEl) return;
          const on = !!selectedId;
          winEl.querySelectorAll('[data-act="open"],[data-act="open-tab"],[data-act="scrape"],[data-act="rm"],[data-act="branch"]')
            .forEach(b => b.disabled = !on);
          const sb = winEl.querySelector('[data-act="scrape"]');
          if (sb) { const n = curNode(); sb.textContent = (n && n.scraped) ? 'Uncross' : 'Cross off'; }
          const vb = winEl.querySelector('[data-act="view"]');
          if (vb) { vb.textContent = view === 'columns' ? 'Graph view' : 'Column view'; vb.classList.toggle('active', view === 'columns'); }
        }

        // search-text + type-dropdown filter, shared by both views
        function getVisible(nodes) {
          return nodes.filter(n => {
            if (typeFilter !== 'all' && n.type !== typeFilter) return false;
            if (query && !((n.label || '').toLowerCase().includes(query) || (n.url || '').toLowerCase().includes(query))) return false;
            return true;
          });
        }

        // re-render entry point: dispatches to whichever view is active
        function renderGraph() {
          refreshButton();
          hideTip();
          if (!winEl) return;
          const graphEl = winEl.querySelector('#rrm-graph');
          const colsEl = winEl.querySelector('#rrm-columns');
          if (graphEl) graphEl.style.display = view === 'columns' ? 'none' : '';
          if (colsEl) colsEl.style.display = view === 'columns' ? 'flex' : 'none';

          const g = loadGraph();
          const visible = getVisible(g.nodes);
          const ids = new Set(visible.map(n => n.id));
          if (selectedId && !ids.has(selectedId)) selectedId = null;

          if (view === 'columns') renderColumns(visible);
          else renderCanvas(g, visible, ids);

          const c = winEl.querySelector('#rrm-count');
          if (c) {
            const total = g.nodes.length;
            const filtered = !!(query || typeFilter !== 'all');
            c.textContent = filtered
              ? `${visible.length} / ${total} nodes · ${g.edges.length} links`
              : `${total} nodes · ${g.edges.length} links`;
          }
          updateActionButtons();
        }

        function renderCanvas(g, visible, ids) {
          if (!network) return;
          const curId = (classify(location.href) || {}).id;

          // Build the desired node styling, then diff it against what's already
          // drawn. Updating (instead of clear + re-add) preserves each node's
          // position, so the layout stays put while you browse — only genuinely
          // new/removed nodes move things.
          const desired = new Map();
          visible.forEach(n => {
            const base = COLORS[n.type];
            desired.set(n.id, {
              id: n.id,
              label: (n.scraped ? '✓ ' : '') + n.label,
              color: { background: n.visited ? base : 'rgba(255,255,255,0.06)', border: base,
                       highlight: { background: base, border: '#fff' } },
              borderWidth: n.id === curId ? 4 : 2,
              opacity: n.scraped ? 0.4 : 1,
              font: { color: n.scraped ? '#8a8a90' : '#f4f4f5' },
              shapeProperties: { borderDashes: n.visited ? false : [4, 3] },
            });
          });

          const existing = new Set(nodesDS.getIds());
          const nodeRemove = [];
          existing.forEach(id => { if (!desired.has(id)) nodeRemove.push(id); });
          const nodeAdd = [], nodeUpdate = [];
          desired.forEach((node, id) => { (existing.has(id) ? nodeUpdate : nodeAdd).push(node); });
          if (nodeRemove.length) nodesDS.remove(nodeRemove);
          if (nodeUpdate.length) nodesDS.update(nodeUpdate);   // keeps positions
          if (nodeAdd.length) nodesDS.add(nodeAdd);

          const desiredEdges = new Map();
          g.edges.filter(e => ids.has(e.from) && ids.has(e.to))
                 .forEach(e => { const id = e.from + '__' + e.to; desiredEdges.set(id, { id, from: e.from, to: e.to }); });
          const existingE = new Set(edgesDS.getIds());
          const edgeRemove = [];
          existingE.forEach(id => { if (!desiredEdges.has(id)) edgeRemove.push(id); });
          const edgeAdd = [];
          desiredEdges.forEach((edge, id) => { if (!existingE.has(id)) edgeAdd.push(edge); });
          if (edgeRemove.length) edgesDS.remove(edgeRemove);
          if (edgeAdd.length) edgesDS.add(edgeAdd);

          // Only disturb the layout when the structure actually changed.
          if (nodeAdd.length || nodeRemove.length || edgeAdd.length || edgeRemove.length) kickPhysics();
        }

        // Alternate view: three columns (subreddits / users / posts) listing
        // collected nodes as links, with no connections drawn.
        function renderColumns(visible) {
          const colsEl = winEl.querySelector('#rrm-columns');
          if (!colsEl) return;
          // Remember each column's scroll position so rebuilding (e.g. after a
          // delete) doesn't jump you back to the top while clearing items out.
          const prevScroll = {};
          colsEl.querySelectorAll('.rrm-col').forEach(c => {
            const l = c.querySelector('.rrm-col-list');
            if (l) prevScroll[c.dataset.type] = l.scrollTop;
          });
          const titles = { sub: 'Subreddits', user: 'Users', post: 'Posts' };
          const groups = { sub: [], user: [], post: [] };
          visible.forEach(n => { if (groups[n.type]) groups[n.type].push(n); });
          colsEl.innerHTML = '';
          ['sub', 'user', 'post'].forEach(type => {
            if (typeFilter !== 'all' && typeFilter !== type) return;
            const list = groups[type].slice().sort((a, b) => (a.label || '').localeCompare(b.label || ''));
            const col = document.createElement('div');
            col.className = 'rrm-col';
            col.dataset.type = type;
            const head = document.createElement('div');
            head.className = 'rrm-col-head';
            head.style.color = COLORS[type];
            head.innerHTML = `<span class="rrm-dot" style="background:${COLORS[type]}"></span>${titles[type]} `
              + `<span class="rrm-col-count">${list.length}</span>`;
            col.appendChild(head);
            const listEl = document.createElement('div');
            listEl.className = 'rrm-col-list';
            if (!list.length) {
              const empty = document.createElement('div');
              empty.className = 'rrm-col-empty';
              empty.textContent = 'none';
              listEl.appendChild(empty);
            } else {
              list.forEach(n => listEl.appendChild(buildColumnRow(n)));
            }
            col.appendChild(listEl);
            colsEl.appendChild(col);
            if (prevScroll[type] != null) listEl.scrollTop = prevScroll[type];   // restore scroll
          });
        }

        function buildColumnRow(n) {
          const row = document.createElement('div');
          row.className = 'rrm-row' + (n.scraped ? ' scraped' : '');

          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.className = 'rrm-row-chk';
          chk.checked = !!n.scraped;
          chk.title = 'Cross off (mark scraped)';
          chk.addEventListener('change', () => { setScraped(n.id, chk.checked); renderGraph(); });

          const link = document.createElement('a');
          link.className = 'rrm-row-link' + (n.visited ? '' : ' unvisited');
          link.href = n.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = (n.label || '').replace(/\n/g, ' ');
          link.title = n.url + (n.visited ? '' : '  (not visited)') + '\n' + scanSummaryText(n.id);
          link.addEventListener('click', (e) => { e.preventDefault(); openNodeNewTab(n.url); });

          const openCur = document.createElement('button');
          openCur.className = 'rrm-row-btn';
          openCur.textContent = '↗';
          openCur.title = 'Open in current tab';
          openCur.addEventListener('click', () => openNodeCurrentTab(n.url));

          const rm = document.createElement('button');
          rm.className = 'rrm-row-btn rm';
          rm.textContent = '×';
          rm.title = 'Remove node';
          rm.addEventListener('click', () => { removeNodes([n.id]); renderGraph(); });

          row.appendChild(chk);
          row.appendChild(link);
          row.appendChild(openCur);
          row.appendChild(rm);
          return row;
        }

        // ------------------------------------------------------------- lifecycle
        function isWindowOpen() { return !!(winEl && !winEl.hidden); }

        function toggleWindow() {
          if (isWindowOpen()) { closeWindow(); return; }
          if (!winEl) buildWindow();
          else { winEl.hidden = false; renderGraph(); }
          const s = winEl && winEl.querySelector('#rrm-search');
          if (s) setTimeout(() => s.focus(), 0);
        }

        function closeWindow() {
          selectedId = null;
          if (winEl) winEl.hidden = true;
        }

        function refreshButton() {
          if (!ui.mapCount) return;
          const n = countNodes();
          ui.mapCount.textContent = n;
          ui.mapCount.hidden = n === 0;
        }

        function bootstrap() {
          if (booted) return;
          booted = true;
          injectStyle();
          document.addEventListener('click', onClick, true);
          document.addEventListener('auxclick', onClick, true);
          ['pushState', 'replaceState'].forEach(fn => {
            const orig = history[fn];
            history[fn] = function () { const r = orig.apply(this, arguments); window.dispatchEvent(new Event('rrm:loc')); return r; };
          });
          window.addEventListener('popstate', () => { lastNavByPop = true; window.dispatchEvent(new Event('rrm:loc')); });
          window.addEventListener('rrm:loc', onLocation);
          if (typeof GM_addValueChangeListener === 'function') {
            GM_addValueChangeListener(REV, () => { scheduleRender(); });
          }

          onLocation(); // record the page you loaded on
        }

        return { bootstrap, toggleWindow, refreshButton, recordScan };
      })();

      if (window.__stripperRrmLoaded) { /* avoid double tracking if injected twice */ }
      else { window.__stripperRrmLoaded = true; rabbithole.bootstrap(); }

      if (document.body) init();
      else window.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
