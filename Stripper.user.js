// ==UserScript==
// @name         Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.06.00
// @description  Multi-site media downloader for Reddit and SimpCity.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/Stripper.user.js
// @match        *://reddit.com/*
// @match        *://*.reddit.com/*
// @match        *://redd.it/*
// @match        https://simpcity.cr/threads/*
// @match        https://simpcity.is/threads/*
// @match        https://simpcity.cz/threads/*
// @match        https://simpcity.hk/threads/*
// @match        https://simpcity.rs/threads/*
// @match        https://simpcity.ax/threads/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_download
// @grant        GM_getValue
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

  const stripperSite = detectStripperSite();
  if (stripperSite === 'reddit') {
    runRedditStripper();
  } else if (stripperSite === 'simpcity') {
    runSimpCityStripper();
  }

  function detectStripperSite() {
    const host = String(location.hostname || '').toLowerCase();
    const path = String(location.pathname || '');
    if (/^(?:www\.)?redd\.it$/.test(host) || /(?:^|\.)reddit\.com$/.test(host)) return 'reddit';
    if (/^simpcity\.(?:cr|is|cz|hk|rs|ax)$/.test(host) && /\/threads\//i.test(path)) return 'simpcity';
    return '';
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
        ui.pageRangeHint.textContent = hasPages ? state.pages.map(page => page.page).join(', ') : 'none';
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
        state.countTextOverride = '';
        state.lastScanAt = Number(payload.lastScanAt || cached.savedAt || 0) || Date.now();
        state.loadedScanCacheKey = cacheKey;
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
          lastScanAt: state.lastScanAt
        };
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
            .map(post => ({ ...post, files: extractMediaFiles(post.raw) }))
            .filter(post => post.files.length > 0);
    
          const deduped = buildDedupedDownloads(mediaPosts);
          state.posts = deduped.posts;
          state.pages = deduped.pages;
          state.files = deduped.files;
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
  }

  function runSimpCityStripper() {
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
        lastScanAt: 0,
        loadedScanCacheKey: ''
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
        #simpGuestPanel .sg-selective {
          display: grid;
          gap: 7px;
          padding: 8px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.07);
        }
        #simpGuestPanel .sg-selective[hidden],
        #simpGuestPanel .sg-rangeRow[hidden] {
          display: none;
        }
        #simpGuestPanel .sg-rangeLabel {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: #d8d8dd;
          font-size: 11px;
          font-weight: 700;
        }
        #simpGuestPanel .sg-rangeHint {
          color: #a9a9b2;
          font-weight: 600;
        }
        #simpGuestPanel .sg-rangeRow {
          display: grid;
          grid-template-columns: 1fr 88px;
          gap: 7px;
        }
        #simpGuestPanel .sg-rangeRow input {
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
        #simpGuestPanel .sg-rangeRow input:focus {
          border-color: rgba(255, 176, 0, 0.72);
        }
        #simpGuestPanel .sg-rangeRow button {
          min-height: 32px;
          background: rgba(255, 255, 255, 0.11);
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
          <div id="sgSelectiveDownloads" class="sg-selective" hidden>
            <div class="sg-rangeLabel">
              <span>Posts</span>
              <span id="sgPostRangeHint" class="sg-rangeHint">1-0</span>
            </div>
            <div id="sgPostRangeRow" class="sg-rangeRow">
              <input id="sgPostRangeInput" type="text" inputmode="numeric" placeholder="1,3-5">
              <button id="sgPostRangeBtn" type="button" disabled>Download</button>
            </div>
            <div class="sg-rangeLabel">
              <span>Pages</span>
              <span id="sgPageRangeHint" class="sg-rangeHint">1-0</span>
            </div>
            <div id="sgPageRangeRow" class="sg-rangeRow">
              <input id="sgPageRangeInput" type="text" inputmode="numeric" placeholder="1,2-4">
              <button id="sgPageRangeBtn" type="button" disabled>Download</button>
            </div>
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
        ui.selectiveDownloads = panel.querySelector('#sgSelectiveDownloads');
        ui.postRangeHint = panel.querySelector('#sgPostRangeHint');
        ui.postRangeRow = panel.querySelector('#sgPostRangeRow');
        ui.postRangeInput = panel.querySelector('#sgPostRangeInput');
        ui.postRangeBtn = panel.querySelector('#sgPostRangeBtn');
        ui.pageRangeHint = panel.querySelector('#sgPageRangeHint');
        ui.pageRangeRow = panel.querySelector('#sgPageRangeRow');
        ui.pageRangeInput = panel.querySelector('#sgPageRangeInput');
        ui.pageRangeBtn = panel.querySelector('#sgPageRangeBtn');
        ui.log = panel.querySelector('#sgLog');
    
        ui.scanBtn.addEventListener('click', () => scanCurrentThread());
        ui.postsBtn.addEventListener('click', () => downloadPostArchives());
        ui.pagesBtn.addEventListener('click', () => downloadPageArchives());
        ui.threadBtn.addEventListener('click', () => downloadThreadArchive());
        ui.postRangeBtn.addEventListener('click', () => downloadSelectedPostArchives());
        ui.pageRangeBtn.addEventListener('click', () => downloadSelectedPageArchives());
        panel.addEventListener('click', () => {
          if (panel.classList.contains('sg-collapsed')) setCollapsed(false);
        });
        document.addEventListener('keydown', handleGlobalKeydown, true);
    
        logLine('Ready. Stripper detected SimpCity; open a thread and scan.');
        syncUi();
      }
    
      function syncUi() {
        const hasFiles = state.files.length > 0;
        ui.scanBtn.disabled = state.busy;
        ui.downloadStack.hidden = !hasFiles;
        ui.postsBtn.disabled = state.busy || !state.posts.length;
        ui.pagesBtn.disabled = state.busy || !state.pages.length;
        ui.threadBtn.disabled = state.busy || !hasFiles;
        ui.selectiveDownloads.hidden = !hasFiles;
        ui.postRangeHint.textContent = state.posts.length ? `1-${state.posts.length}` : 'none';
        ui.postRangeInput.disabled = state.busy || !state.posts.length;
        ui.postRangeBtn.disabled = state.busy || !state.posts.length;
        ui.pageRangeRow.hidden = !state.pages.length;
        ui.pageRangeHint.textContent = state.pages.length ? state.pages.map(page => page.page).join(', ') : 'none';
        ui.pageRangeInput.disabled = state.busy || !state.pages.length;
        ui.pageRangeBtn.disabled = state.busy || !state.pages.length;
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

      function simpCityScanCacheKey(rawUrl) {
        try {
          const u = new URL(rawUrl || location.href, location.href);
          u.pathname = u.pathname.replace(/\/page-\d+\/?$/i, '/');
          u.search = '';
          u.hash = '';
          return `simpcity:thread:${u.origin}${u.pathname.replace(/\/?$/, '/')}`;
        } catch {
          return '';
        }
      }

      function applySimpCityCachedScan(cached, cacheKey) {
        const payload = cached && cached.payload ? cached.payload : {};
        state.threadTitle = payload.threadTitle || '';
        state.threadFolder = payload.threadFolder || (state.threadTitle ? sanitizeFolder(state.threadTitle) : '');
        state.posts = safeCachedArray(payload.posts);
        state.pages = safeCachedArray(payload.pages);
        state.files = safeCachedArray(payload.files);
        state.countTextOverride = '';
        state.lastScanAt = Number(payload.lastScanAt || cached.savedAt || 0) || Date.now();
        state.loadedScanCacheKey = cacheKey;
        setProgress(100);
        syncUi();
      }

      function buildSimpCityCachePayload() {
        return {
          threadTitle: state.threadTitle,
          threadFolder: state.threadFolder,
          posts: state.posts,
          pages: state.pages,
          files: state.files,
          lastScanAt: state.lastScanAt
        };
      }
    
      async function scanCurrentThread() {
        if (state.busy) return;
        if (!/\/threads\//i.test(location.pathname)) {
          logLine('This page is not a SimpCity thread.');
          setProgress(0);
          return;
        }

        const cacheKey = simpCityScanCacheKey(location.href);
        if (cacheKey && state.loadedScanCacheKey !== cacheKey) {
          logLine(`Checking browser scan cache for ${cacheKey}.`);
          const cached = loadStripperScanCache(cacheKey);
          if (cached) {
            applySimpCityCachedScan(cached, cacheKey);
            logLine(`Loaded cached SimpCity scan from ${formatCacheAge(cached.savedAt)}. Press Scan again to refresh it.`);
            return;
          }
          logLine('No cached scan found; scanning now.');
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
        state.loadedScanCacheKey = '';
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
          state.loadedScanCacheKey = cacheKey;
          setProgress(100);
          logLine(`Scan complete: ${state.posts.length} post archive${state.posts.length === 1 ? '' : 's'}, ${state.pages.length} page archive${state.pages.length === 1 ? '' : 's'}, ${state.files.length} unique file${state.files.length === 1 ? '' : 's'}.`);
          if (deduped.duplicates > 0) {
            logLine(`Removed ${deduped.duplicates} duplicate file${deduped.duplicates === 1 ? '' : 's'}; earliest posts kept.`);
          }
          if (cacheKey) {
            if (saveStripperScanCache(cacheKey, buildSimpCityCachePayload())) {
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
    
      function selectedSimpCityPostsFromRange() {
        const maxPostNumber = state.posts.reduce((max, post, idx) => Math.max(max, idx + 1, Number(post.number) || 0), 0);
        const parsed = parseStripperRangeList(ui.postRangeInput.value, maxPostNumber);
        if (parsed.error) {
          logLine(`Post range error: ${parsed.error}.`);
          return [];
        }
        return state.posts.filter((post, idx) => parsed.numbers.has(idx + 1) || parsed.numbers.has(Number(post.number) || 0));
      }

      function selectedSimpCityPagesFromRange() {
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
        const selected = selectedSimpCityPostsFromRange();
        if (!selected.length) {
          logLine('No scanned posts matched that range.');
          return;
        }
        await downloadPostArchives(selected);
      }

      async function downloadSelectedPageArchives() {
        if (state.busy) return;
        const selected = selectedSimpCityPagesFromRange();
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
            const archiveName = `${state.threadFolder}/${post.postFolder}.zip`;
            logLine(`Building post zip ${done + 1}/${posts.length}: ${post.postFolder}`);
            await buildAndSaveArchive(post.files, archiveName, (pct, label) => {
              const base = (done / posts.length) * 100;
              const span = 100 / posts.length;
              setProgress(base + (pct / 100) * span);
              if (label) logLine(label);
            });
            done++;
            setCountTextOverride(formatUnitTicker(done, posts.length, 'post'));
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
            const archiveName = `${state.threadFolder}/page_${String(page.page).padStart(4, '0')}.zip`;
            logLine(`Building page zip ${done + 1}/${pages.length}: page ${page.page}, ${page.files.length} file${page.files.length === 1 ? '' : 's'}.`);
            await buildAndSaveArchive(page.files, archiveName, (pct, label) => {
              const base = (done / pages.length) * 100;
              const span = 100 / pages.length;
              setProgress(base + (pct / 100) * span);
              if (label) logLine(label);
            });
            done++;
            setCountTextOverride(formatUnitTicker(done, pages.length, 'page'));
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
  }
})();
