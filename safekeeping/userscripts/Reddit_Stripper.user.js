// ==UserScript==
// @name         Reddit Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.17.26
// @description  Reddit media + post-text (Markdown) downloader with a built-in Rabbithole saved list.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/Reddit_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/Reddit_Stripper.user.js
// @match        *://reddit.com/*
// @match        *://*.reddit.com/*
// @match        *://redd.it/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
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
  // Bound the scan cache so it can never quietly fill GM storage and starve other
  // writes (notably the rabbithole's boot-time writes). These limits are invisible
  // to the user and survive map pruning, so they need their own ceiling.
  const STRIPPER_SCAN_CACHE_MAX_ENTRIES = 24;                   // keep only the most recent N scans
  const STRIPPER_SCAN_CACHE_MAX_BYTES = 4 * 1024 * 1024;        // total budget across all scans
  const STRIPPER_SCAN_CACHE_MAX_ENTRY_BYTES = 1.5 * 1024 * 1024; // skip caching a single huge scan
  const STRIPPER_BLOCKED_USERS_KEY = 'Stripper.blockedUsers.v1';

  // Evict the stalest scans (by savedAt) until the cache is back under its entry
  // count and byte budget, leaving room for an incoming write of `reserveBytes`.
  // Best-effort: needs GM_listValues, otherwise it's a no-op.
  function evictStripperScanCaches(reserveBytes) {
    if (typeof GM_listValues !== 'function') return;
    let keys;
    try { keys = GM_listValues(); } catch { return; }
    const entries = [];
    let total = 0;
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(STRIPPER_SCAN_CACHE_PREFIX)) continue;
      let raw = '';
      try { raw = GM_getValue(key, '') || ''; } catch { raw = ''; }
      let savedAt = 0;
      try { savedAt = Number(JSON.parse(raw).savedAt) || 0; } catch { savedAt = 0; }
      entries.push({ key, savedAt, bytes: raw.length });
      total += raw.length;
    }
    entries.sort((a, b) => a.savedAt - b.savedAt);   // oldest first
    const budget = STRIPPER_SCAN_CACHE_MAX_BYTES - Math.max(0, Number(reserveBytes) || 0);
    let count = entries.length;
    let i = 0;
    while (i < entries.length && (count > STRIPPER_SCAN_CACHE_MAX_ENTRIES || total > budget)) {
      const victim = entries[i++];
      try { if (typeof GM_deleteValue === 'function') GM_deleteValue(victim.key); } catch {}
      try { localStorage.removeItem(victim.key); } catch {}
      total -= victim.bytes;
      count--;
    }
  }

  function loadStripperScanCache(cacheKey) {
    if (!cacheKey) return null;
    try {
      const storageKey = STRIPPER_SCAN_CACHE_PREFIX + cacheKey;
      const raw = typeof GM_getValue === 'function'
        ? (GM_getValue(storageKey, '') || localStorage.getItem(storageKey))
        : localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // v3 = one entry per post with every file that post exposes. v1 and v2
      // payloads were written by the deduping scanner, so their file lists are
      // already trimmed and their page archives are meaningless now; serving one
      // would hand back an incomplete set. They are rejected rather than
      // migrated — the next scan overwrites them in place.
      if (!parsed || parsed.version !== 3 || !parsed.payload) return null;
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
        version: 3,
        savedAt: Date.now(),
        payload
      });
      // A single oversized scan (a very prolific profile) can blow the per-value
      // limit on its own — skip caching it rather than risk poisoning storage.
      if (serialized.length > STRIPPER_SCAN_CACHE_MAX_ENTRY_BYTES) return false;
      // Make room first so this write can't tip the store over its budget.
      evictStripperScanCaches(serialized.length);
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

  function normalizeRedditUsername(name) {
    return String(name || '')
      .trim()
      .replace(/^\/?(?:user|u)\//i, '')
      .replace(/^u_/i, '')
      .replace(/^@/, '')
      .toLowerCase();
  }

  function profileNameFromHref(href) {
    let url;
    try { url = new URL(href, location.origin); } catch { return ''; }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    const marker = parts[0].toLowerCase();
    if (marker !== 'user' && marker !== 'u') return '';
    return normalizeRedditUsername(decodeURIComponent(parts[1] || ''));
  }

  function normalizeSubredditName(name) {
    return String(name || '')
      .trim()
      .replace(/^\/?r\//i, '')
      .replace(/^r_/i, '')
      .toLowerCase();
  }

  function subredditNameFromHref(href) {
    let url;
    try { url = new URL(href, location.origin); } catch { return ''; }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    if (parts[0].toLowerCase() !== 'r') return '';
    return normalizeSubredditName(decodeURIComponent(parts[1] || ''));
  }

  function loadStripperBlockedUsers() {
    try {
      const raw = typeof GM_getValue === 'function'
        ? GM_getValue(STRIPPER_BLOCKED_USERS_KEY, '[]')
        : localStorage.getItem(STRIPPER_BLOCKED_USERS_KEY);
      const parsed = JSON.parse(raw || '[]');
      return new Set((Array.isArray(parsed) ? parsed : []).map(normalizeRedditUsername).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  function saveStripperBlockedUsers(users) {
    const list = [...(users || new Set())].map(normalizeRedditUsername).filter(Boolean).sort();
    const raw = JSON.stringify([...new Set(list)]);
    try {
      if (typeof GM_setValue === 'function') GM_setValue(STRIPPER_BLOCKED_USERS_KEY, raw);
      else localStorage.setItem(STRIPPER_BLOCKED_USERS_KEY, raw);
    } catch {}
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
      const USER_AGENT_NOTE = 'Reddit Stripper userscript';
      const REDDIT_SUBSCRIPTION_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
      const REDDIT_SUBSCRIPTION_SYNC_DELAY_MS = 900;
    
      const imgRE = /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:$|[?#])/i;
      const vidRE = /\.(?:m4v|mov|mp4|webm)(?:$|[?#])/i;
      const directMediaHostRE = /(?:^|\.)((?:i|preview|external-preview)\.redd\.it|redditmedia\.com|imgur\.com)$/i;
    
      const state = {
        busy: false,
        scanType: '',
        username: '',
        userFolder: '',
        posts: [],
        files: [],
        subreddits: [],
        summary: null,
        summaryNodeId: '',
        countTextOverride: '',
        fileProgressOverride: '',
        lastScanAt: 0,
        loadedScanCacheKey: ''
      };
    
      const ui = {};
    
      GM_addStyle(`
        #redditGuestPanel {
          position: fixed;
          right: 0;
          top: 0;
          z-index: 2147483646;
          box-sizing: border-box;
          width: 372px;
          height: 100vh;
          min-width: 300px;
          min-height: 0;
          max-width: 80vw;
          max-height: 100vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          resize: horizontal;
          /* The panel edge is the one place the accent draws an outline, and the
             panel is the one object allowed a cast shadow — it has to lift off a
             page it does not belong to. No blur: the guide's separation comes
             from a solid ground and a 1px edge. */
          border: 1px solid rgba(255, 69, 0, 0.4);
          border-right: 0;
          border-radius: 10px 0 0 10px;
          background: #141210;
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
          color: #f2ece1;
          font: 700 12px/1.35 Arial, Helvetica, sans-serif;
        }
        #redditGuestPanel, #redditGuestPanel * {
          box-sizing: border-box;
        }
        #redditGuestPanel .rg-header {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 38px;
          padding: 0 12px;
          cursor: move;
          user-select: none;
          border-bottom: 1px solid rgba(255, 255, 255, 0.10);
          background: linear-gradient(90deg, #33261a, #1a1613);
          border-radius: 10px 0 0 0;
        }
        #redditGuestPanel .rg-title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 900;
          font-size: 12px;
          color: #ff4500;
        }
        #redditGuestPanel .rg-collapseBtn {
          width: 30px;
          min-height: 26px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          line-height: 1;
          background: rgba(255, 255, 255, 0.11);
        }
        #redditGuestPanel .rg-collapseBtn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.17);
        }
        #redditGuestPanel .rg-body {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
        }
        #redditGuestPanel .rg-sidebar {
          flex: 0 0 304px;
          width: 304px;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 9px;
          padding: 12px;
          overflow-y: auto;
          overflow-x: hidden;
          border-right: 1px solid rgba(255, 255, 255, 0.10);
          scrollbar-width: thin;
        }
        #redditGuestPanel .rg-main {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        #redditGuestPanel .rg-modes {
          flex: 0 0 auto;
          display: flex;
          gap: 4px;
          padding: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(255, 255, 255, 0.02);
        }
        #redditGuestPanel .rg-modeBtn {
          flex: 1 1 0;
          width: auto;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-height: 30px;
          /* Five tabs share one row, so the label size is set by the longest of
             them rather than by taste. Do not put a sixth here without widening
             the panel: an ellipsised tab is not a tab. */
          padding: 0 4px;
          border-radius: 7px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: #cfc2ae;
          font-weight: 700;
          font-size: 10px;
        }
        #redditGuestPanel .rg-modeBtn:hover:not(.is-active) {
          background: rgba(255, 69, 0, 0.18);
          border-color: rgba(255, 69, 0, 0.55);
          color: #f2ece1;
        }
        /* A tab is on, not primary: an accent wash and an accent edge. The one
           solid accent fill in a pane belongs to that pane's action. */
        #redditGuestPanel .rg-modeBtn.is-active {
          background: rgba(255, 69, 0, 0.2);
          color: #f2ece1;
          border-color: rgba(255, 69, 0, 0.55);
        }
        #redditGuestPanel.rg-collapsed .rg-modes {
          display: none;
        }
        #redditGuestPanel .rg-colModes {
          flex: 0 0 auto;
          display: flex;
          gap: 4px;
          padding: 0 8px 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(255, 255, 255, 0.02);
        }
        #redditGuestPanel .rg-colBtn {
          min-height: 26px;
          font-size: 10.5px;
          background: rgba(255, 255, 255, 0.05);
        }
        /* The saved-list sub-switcher only applies to Saved view. */
        #redditGuestPanel:not([data-mode="column"]) .rg-colModes,
        #redditGuestPanel.rg-collapsed .rg-colModes {
          display: none;
        }
        /* The strip shows exactly one view at a time, driven by the mode switcher. */
        #redditGuestPanel .rg-sidebar {
          flex: 1 1 auto;
          width: auto;
          border-right: 0;
        }
        #redditGuestPanel[data-mode="download"] #rgMain {
          display: none;
        }
        #redditGuestPanel[data-mode="column"] .rg-sidebar,
        #redditGuestPanel[data-mode="queue"] .rg-sidebar,
        #redditGuestPanel[data-mode="graph"] .rg-sidebar,
        #redditGuestPanel[data-mode="blocked"] .rg-sidebar {
          display: none;
        }
        /* Let the search box absorb the freed width so it grows with the panel
           instead of leaving a gap before the buttons. */
        #redditGuestPanel[data-mode="column"] #rrm-search,
        #redditGuestPanel[data-mode="graph"] #rrm-search {
          flex: 1 1 auto;
        }
        #redditGuestPanel.rg-collapsed {
          height: auto !important;
          min-height: 0;
          resize: horizontal;
        }
        #redditGuestPanel.rg-collapsed .rg-body {
          display: none;
        }
        #redditGuestPanel.rg-collapsed .rg-header {
          border-bottom: 0;
          border-radius: 10px 0 0 10px;
        }
        #redditGuestPanel button {
          appearance: none;
          width: 100%;
          min-height: 32px;
          padding: 0 10px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.08);
          color: #cfc2ae;
          font: 700 12px/1 Arial, Helvetica, sans-serif;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
        }
        /* Hover is a wash of the accent, never a second hue. */
        #redditGuestPanel button:hover:not(:disabled) {
          background: rgba(255, 69, 0, 0.18);
          border-color: rgba(255, 69, 0, 0.55);
          color: #f2ece1;
        }
        #redditGuestPanel button:disabled {
          cursor: default;
          opacity: 0.42;
        }
        /* The one thing you are probably here to do. */
        #redditGuestPanel #rgScanBtn {
          background: #ff4500;
          border-color: rgba(255, 69, 0, 0.55);
          color: #141210;
          font-weight: 900;
        }
        #redditGuestPanel #rgScanBtn:hover:not(:disabled) {
          background: #ff5c1c;
          color: #141210;
        }
        #redditGuestPanel .rg-downloadStack {
          display: flex;
          flex-direction: column;
          gap: 8px;
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
          color: #cfc2ae;
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
        #redditGuestPanel .rg-bulkStack {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        #redditGuestPanel .rg-bulkStack button {
          min-height: 34px;
          background: rgba(255, 255, 255, 0.11);
          white-space: nowrap;
        }
        #redditGuestPanel .rg-bulkStack button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.17);
        }
        #redditGuestPanel .rg-fileTypes {
          display: flex;
          gap: 7px;
        }
        #redditGuestPanel .rg-typeChip {
          display: flex;
          align-items: center;
          gap: 7px;
          flex: 1;
          width: auto;
          min-height: 34px;
          padding: 0 8px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.18);
          color: #bdb1a0;
          font: 700 11px/1 Arial, Helvetica, sans-serif;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        #redditGuestPanel .rg-typeChip:hover {
          border-color: rgba(255, 255, 255, 0.3);
          color: #f2ece1;
        }
        #redditGuestPanel .rg-typeChip.is-on {
          color: #f2ece1;
          border-color: rgba(255, 176, 0, 0.55);
          background: rgba(255, 69, 0, 0.13);
        }
        #redditGuestPanel .rg-typeBox {
          position: relative;
          flex: 0 0 auto;
          width: 15px;
          height: 15px;
          border-radius: 5px;
          border: 1px solid rgba(255, 255, 255, 0.32);
          background: rgba(255, 255, 255, 0.05);
          transition: background 120ms ease, border-color 120ms ease;
        }
        #redditGuestPanel .rg-typeChip.is-on .rg-typeBox {
          border-color: transparent;
          background: linear-gradient(135deg, #ff4500, #ffb000);
        }
        #redditGuestPanel .rg-typeChip.is-on .rg-typeBox::after {
          content: "";
          position: absolute;
          left: 5px;
          top: 2px;
          width: 3px;
          height: 7px;
          border: solid #fff;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }
        #redditGuestPanel .rg-typeName {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #redditGuestPanel .rg-rangeRow {
          display: grid;
          grid-template-columns: 1fr 116px;
          gap: 7px;
        }
        #redditGuestPanel .rg-rangeRow input {
          width: 100%;
          min-width: 0;
          height: 30px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 7px;
          background: #211d19;
          color: #f2ece1;
          padding: 0 8px;
          font: 700 12px/1 Arial, Helvetica, sans-serif;
          outline: none;
        }
        #redditGuestPanel .rg-rangeRow input::placeholder {
          color: #8f806b;
        }
        /* Focus is the accent at 70% with a 2px ring at 14% — the same shape on
           every field in the panel, so focus never has to be guessed at. */
        #redditGuestPanel .rg-rangeRow input:focus {
          border-color: rgba(255, 69, 0, 0.7);
          box-shadow: 0 0 0 2px rgba(255, 69, 0, 0.14);
        }
        #redditGuestPanel .rg-rangeRow button {
          min-height: 30px;
        }
        #redditGuestPanel .rg-progress {
          position: relative;
          height: 10px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
        }
        #redditGuestPanel .rg-progress > div {
          width: 0;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #ff4500, #ffb000);
          transition: width 130ms ease;
        }
        /* Output lives in a sunk tray, always present so the destination of a
           run is visible before anything is in it. */
        #redditGuestPanel .rg-log {
          flex: 0 0 auto;
          min-height: 120px;
          max-height: 240px;
          overflow: auto;
          padding: 12px;
          border-radius: 10px;
          border: 1px solid rgba(255, 69, 0, 0.14);
          background: rgba(0, 0, 0, 0.22);
          color: #bdb1a0;
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
        #redditGuestPanel .rg-subs {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        #redditGuestPanel .rg-subs[hidden] {
          display: none;
        }
        #redditGuestPanel .rg-subsHead {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #cfc2ae;
          font-size: 11px;
          font-weight: 700;
        }
        #redditGuestPanel .rg-subsCount {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #bdb1a0;
          font-weight: 600;
        }
        #redditGuestPanel .rg-subAdd {
          width: 24px;
          min-height: 22px;
          flex: 0 0 auto;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          font-size: 14px;
          border: 1px solid rgba(255, 176, 0, 0.5);
          background: rgba(255, 69, 0, 0.16);
          color: #ffd9b0;
        }
        #redditGuestPanel .rg-subAdd:hover:not(:disabled) {
          background: rgba(255, 69, 0, 0.3);
          border-color: rgba(255, 176, 0, 0.75);
          color: #f2ece1;
        }
        #redditGuestPanel .rg-subsList {
          display: flex;
          flex-direction: column;
          gap: 3px;
          max-height: 200px;
          overflow: auto;
          padding: 4px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.23);
          scrollbar-width: thin;
        }
        #redditGuestPanel .rg-subRow {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 4px 6px;
          border-radius: 6px;
        }
        #redditGuestPanel .rg-subRow:hover {
          background: rgba(255, 255, 255, 0.07);
        }
        #redditGuestPanel .rg-subLink {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #f2ece1;
          text-decoration: none;
          font-size: 12px;
          font-weight: 600;
        }
        #redditGuestPanel .rg-subRow:hover .rg-subLink {
          color: #f2ece1;
        }
        #redditGuestPanel .rg-subN {
          flex: 0 0 auto;
          padding: 1px 7px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.12);
          color: #cfc2ae;
          font-size: 10px;
          font-weight: 800;
        }
        #redditGuestPanel .rg-removeSaved {
          margin-top: auto;
          min-height: 34px;
          border-color: rgba(255, 69, 0, 0.55);
          background: rgba(255, 69, 0, 0.16);
          color: #ffd9b0;
        }
        #redditGuestPanel .rg-removeSaved:hover:not(:disabled) {
          background: rgba(255, 69, 0, 0.3);
          border-color: rgba(255, 176, 0, 0.75);
          color: #f2ece1;
        }
        #redditGuestPanel .rg-blockProfile {
          margin-top: auto;
          min-height: 34px;
          border-color: rgba(255, 176, 0, 0.5);
          background: rgba(255, 176, 0, 0.14);
          color: #ffe1a3;
        }
        #redditGuestPanel .rg-blockProfile:hover:not(:disabled) {
          background: rgba(255, 176, 0, 0.26);
          border-color: rgba(255, 176, 0, 0.78);
          color: #f2ece1;
        }
        #redditGuestPanel .rg-removeSaved[hidden],
        #redditGuestPanel .rg-blockProfile[hidden] {
          display: none;
        }
        .stripperBlockedProfilePost {
          display: none !important;
        }
        /* When downloaded posts are set to show, they stay legible but read as
           already-handled rather than looking identical to something new. */
        .stripperDownloadedPost {
          opacity: 0.55;
        }
        #redditGuestPanel .rg-headBtn {
          flex: 0 0 auto;
          width: 28px;
          height: 28px;
          min-height: 0;
          padding: 0;
          border-radius: 7px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.08);
          color: #cfc2ae;
          font-size: 13px;
          line-height: 1;
          cursor: pointer;
        }
        #redditGuestPanel .rg-headBtn:hover {
          background: rgba(255, 69, 0, 0.18);
          border-color: rgba(255, 69, 0, 0.55);
        }
        #redditGuestPanel .rg-headBtn.is-on {
          background: rgba(255, 69, 0, 0.2);
          border-color: rgba(255, 69, 0, 0.55);
          color: #f2ece1;
        }
      `);
    
      function init() {
        if (document.getElementById('redditGuestPanel')) return;
    
        const panel = document.createElement('div');
        panel.id = 'redditGuestPanel';
        panel.innerHTML = `
          <div class="rg-header">
            <span class="rg-title">Reddit Stripper</span>
            <span id="rgMapCount" class="rg-mapCount" title="Saved Rabbithole items" hidden></span>
            <button id="rgHiddenToggle" class="rg-headBtn" type="button" title="Show downloaded posts">◎</button>
            <button id="rgCollapseBtn" class="rg-collapseBtn" type="button" title="Collapse">▴</button>
          </div>
          <div class="rg-modes">
            <button class="rg-modeBtn" type="button" data-mode="download">Download</button>
            <button class="rg-modeBtn" type="button" data-mode="column">Saved</button>
            <button class="rg-modeBtn" type="button" data-mode="queue">Queue<span id="rgQueueCount" class="rg-tabCount" hidden></span></button>
            <button class="rg-modeBtn" type="button" data-mode="graph">Graph</button>
            <button class="rg-modeBtn" type="button" data-mode="blocked">Blocked</button>
          </div>
          <div class="rg-colModes">
            <button class="rg-modeBtn rg-colBtn" type="button" data-coltype="sub">Subreddits</button>
            <button class="rg-modeBtn rg-colBtn" type="button" data-coltype="user">Users</button>
            <button class="rg-modeBtn rg-colBtn" type="button" data-coltype="post">Posts</button>
          </div>
          <div class="rg-body">
            <div class="rg-sidebar">
              <div id="rgDownloadStack" class="rg-downloadStack" hidden>
                <button id="rgPostBtn" type="button" disabled>Download Post</button>
              </div>
              <button id="rgScanBtn" type="button">Scan</button>
              <div class="rg-progress" aria-hidden="true"><div id="rgProgressFill"></div></div>
              <div class="rg-meta">
                <span id="rgProfileLabel">No profile scanned</span>
                <span id="rgCountLabel">0 files</span>
              </div>
              <div id="rgSelectiveDownloads" class="rg-selective" hidden>
                <div class="rg-bulkStack">
                  <button id="rgPostsBtn" type="button" disabled>Download All Posts</button>
                </div>
                <div id="rgPostRangeRow" class="rg-rangeRow">
                  <input id="rgPostRangeInput" type="text" inputmode="numeric" placeholder="Posts 1-0">
                  <button id="rgPostRangeBtn" type="button" disabled>Download Posts</button>
                </div>
                <div id="rgFileTypes" class="rg-fileTypes">
                  <button id="rgTypeImages" class="rg-typeChip is-on" type="button" role="checkbox" aria-checked="true" data-kind="image">
                    <span class="rg-typeBox"></span><span class="rg-typeName">Images</span>
                  </button>
                  <button id="rgTypeVideos" class="rg-typeChip is-on" type="button" role="checkbox" aria-checked="true" data-kind="video">
                    <span class="rg-typeBox"></span><span class="rg-typeName">Videos</span>
                  </button>
                  <button id="rgTypeText" class="rg-typeChip" type="button" role="checkbox" aria-checked="false" data-kind="text">
                    <span class="rg-typeBox"></span><span class="rg-typeName">Text</span>
                  </button>
                </div>
              </div>
              <div id="rgLog" class="rg-log" aria-live="polite"></div>
              <div id="rgSubs" class="rg-subs" hidden>
                <div class="rg-subsHead">
                  <span>Subreddits</span>
                  <span class="rg-subsCount" id="rgSubCount"></span>
                  <button id="rgSubAddAll" class="rg-subAdd" type="button" title="Add all these subreddits to the saved list">+</button>
                </div>
                <div class="rg-subsList" id="rgSubList"></div>
              </div>
              <button id="rgRemoveSavedBtn" class="rg-removeSaved" type="button" hidden>Remove Saved</button>
              <button id="rgBlockProfileBtn" class="rg-blockProfile" type="button" hidden>Block Profile</button>
            </div>
            <div id="rgMain" class="rg-main"></div>
          </div>
        `;
        document.body.appendChild(panel);
    
        ui.panel = panel;
        ui.downloadStack = panel.querySelector('#rgDownloadStack');
        ui.scanBtn = panel.querySelector('#rgScanBtn');
        ui.postBtn = panel.querySelector('#rgPostBtn');
        ui.postsBtn = panel.querySelector('#rgPostsBtn');
        ui.fill = panel.querySelector('#rgProgressFill');
        ui.profileLabel = panel.querySelector('#rgProfileLabel');
        ui.countLabel = panel.querySelector('#rgCountLabel');
        ui.selectiveDownloads = panel.querySelector('#rgSelectiveDownloads');
        ui.postRangeRow = panel.querySelector('#rgPostRangeRow');
        ui.postRangeInput = panel.querySelector('#rgPostRangeInput');
        ui.postRangeBtn = panel.querySelector('#rgPostRangeBtn');
        ui.typeChips = {
          image: panel.querySelector('#rgTypeImages'),
          video: panel.querySelector('#rgTypeVideos'),
          text: panel.querySelector('#rgTypeText')
        };
        ui.log = panel.querySelector('#rgLog');
        ui.subs = panel.querySelector('#rgSubs');
        ui.subCount = panel.querySelector('#rgSubCount');
        ui.subList = panel.querySelector('#rgSubList');
        ui.subAddAll = panel.querySelector('#rgSubAddAll');
        ui.removeSavedBtn = panel.querySelector('#rgRemoveSavedBtn');
        ui.blockProfileBtn = panel.querySelector('#rgBlockProfileBtn');
        ui.header = panel.querySelector('.rg-header');
        ui.collapseBtn = panel.querySelector('#rgCollapseBtn');
        ui.hiddenToggle = panel.querySelector('#rgHiddenToggle');
        ui.mapCount = panel.querySelector('#rgMapCount');
        ui.queueCount = panel.querySelector('#rgQueueCount');
        ui.modeBtns = Array.from(panel.querySelectorAll('.rg-modes .rg-modeBtn'));
        ui.colModeBtns = Array.from(panel.querySelectorAll('.rg-colBtn'));

        ui.modeBtns.forEach(btn => {
          btn.addEventListener('click', () => setMode(btn.dataset.mode));
        });
        ui.colModeBtns.forEach(btn => {
          btn.addEventListener('click', () => setColumnType(btn.dataset.coltype));
        });

        ui.subAddAll.addEventListener('click', () => {
          const added = rabbithole.addSubreddits(state.username, state.subreddits || []);
          logLine(added
            ? `Rabbithole: saved ${added} subreddit${added === 1 ? '' : 's'}.`
            : 'Rabbithole: no subreddits to add.');
          if (added && rabbithole.syncWithReddit) rabbithole.syncWithReddit({ force: true, reason: 'saved-subreddits' });
        });

        ui.collapseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          setCollapsed(!panel.classList.contains('rg-collapsed'));
        });
        ui.hiddenToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          rabbithole.setShowDownloadedPosts(!rabbithole.showDownloadedPosts());
          syncHiddenToggle();
          filterBlockedProfilePosts();
        });
        makePanelDraggable(panel, ui.header);
        ui.scanBtn.addEventListener('click', () => scanCurrentProfile());
        ui.postBtn.addEventListener('click', () => downloadPostArchives());
        ui.postsBtn.addEventListener('click', () => downloadPostArchives());
        ui.removeSavedBtn.addEventListener('click', () => removeCurrentSavedItem());
        ui.blockProfileBtn.addEventListener('click', () => toggleCurrentProfileBlock());
        panel.querySelectorAll('.rg-typeChip').forEach(chip => {
          chip.addEventListener('click', () => {
            const on = chip.getAttribute('aria-checked') === 'true';
            chip.setAttribute('aria-checked', on ? 'false' : 'true');
            chip.classList.toggle('is-on', !on);
          });
        });
        ui.postRangeBtn.addEventListener('click', () => downloadSelectedPostArchives());
        installPageChangeObserver();
        installRedditSubscriptionClickSync();
        document.addEventListener('keydown', handleGlobalKeydown, true);

        // The saved list is mounted into the main body; the mode switcher decides
        // whether the strip shows downloads or saved items.
        rabbithole.mount(panel.querySelector('#rgMain'), panel);
        setColumnType('user');
        setMode('download');

        syncHiddenToggle();
        logLine('Ready. Open a profile or post to scan, or a subreddit to add.');
        syncUi();
        rabbithole.refreshButton();
        if (rabbithole.syncWithReddit) rabbithole.syncWithReddit({ reason: 'startup' });
      }

      function installPageChangeObserver() {
        if (window.__stripperPageChangeObserver) return;
        window.__stripperPageChangeObserver = true;
        state.observedLocationHref = location.href;

        const schedule = (force) => {
          if (window.__stripperPageChangeTimer) clearTimeout(window.__stripperPageChangeTimer);
          window.__stripperPageChangeTimer = setTimeout(() => refreshForCurrentLocation(!!force), 80);
        };
        const scheduleFilter = () => {
          if (window.__stripperFeedFilterTimer) clearTimeout(window.__stripperFeedFilterTimer);
          window.__stripperFeedFilterTimer = setTimeout(() => filterBlockedProfilePosts(), 140);
        };

        ['pushState', 'replaceState'].forEach(fn => {
          const orig = history[fn];
          if (typeof orig !== 'function' || orig.__stripperRouteWrapped) return;
          const wrapped = function () {
            const result = orig.apply(this, arguments);
            schedule(true);
            return result;
          };
          wrapped.__stripperRouteWrapped = true;
          history[fn] = wrapped;
        });

        window.addEventListener('popstate', () => schedule(true));
        window.addEventListener('hashchange', () => schedule(true));
        window.addEventListener('pageshow', () => schedule(true));
        window.addEventListener('focus', () => schedule(false));
        document.addEventListener('click', () => schedule(false), true);

        if (document.body && typeof MutationObserver !== 'undefined') {
          const observer = new MutationObserver(() => {
            schedule(false);
            scheduleFilter();
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }

        window.__stripperPageChangePoll = setInterval(() => schedule(false), 500);
        schedule(true);
      }

      function installRedditSubscriptionClickSync() {
        if (window.__stripperSubscriptionClickSync) return;
        window.__stripperSubscriptionClickSync = true;
        document.addEventListener('click', evt => {
          if (!evt || !evt.target || !rabbithole || !rabbithole.syncWithReddit) return;
          const el = evt.target.closest && evt.target.closest('button, a, [role="button"]');
          if (!el || el.closest('#redditGuestPanel')) return;
          const label = [
            el.textContent,
            el.getAttribute && el.getAttribute('aria-label'),
            el.getAttribute && el.getAttribute('title')
          ].join(' ').toLowerCase();
          if (!/\b(?:join|joined|leave|follow|following|unfollow)\b/.test(label)) return;
          clearTimeout(window.__stripperSubscriptionClickSyncTimer);
          window.__stripperSubscriptionClickSyncTimer = setTimeout(() => {
            rabbithole.syncWithReddit({ force: true, reason: 'reddit-subscription-click' });
          }, 2200);
        }, true);
      }

      function refreshForCurrentLocation(force) {
        const href = location.href;
        const changed = href !== state.observedLocationHref;
        if (!force && !changed) return;
        state.observedLocationHref = href;
        // Reddit is a single-page app, so arriving at a listing by clicking is
        // not a page load and would otherwise skip the rule entirely.
        if (applyForcedSubredditSort()) return;
        if (!state.busy) syncUi();
        filterBlockedProfilePosts();
        if (ui.mode === 'column') rabbithole.resize();
      }

      // Every subreddit listing opens on Top / this month instead of Reddit's
      // Hot. The single exception is a listing already sorted Top over some
      // other period: that one was chosen on purpose and says something a
      // default cannot, so it is left alone.
      const FORCED_SORT = 'top';
      const FORCED_PERIOD = 'month';
      const KNOWN_SORTS = ['hot', 'new', 'top', 'rising', 'controversial', 'best'];

      // The URL this listing should be at, or '' when it is already right or is
      // not a listing at all.
      function forcedSubredditSortTarget() {
        const parts = location.pathname.split('/').filter(Boolean);
        if (parts.length < 2 || String(parts[0]).toLowerCase() !== 'r') return '';
        const sub = parts[1];
        if (!sub) return '';
        const segment = String(parts[2] || '').toLowerCase();
        // A third segment that is not a sort means this is not a listing at all —
        // a post, the wiki, a search, a mod page. Whitelisting sorts rather than
        // blacklisting the rest is what keeps a page Reddit adds later safe by
        // default instead of silently redirected.
        if (segment && !KNOWN_SORTS.includes(segment)) return '';
        if (parts.length > 3) return '';

        let params;
        try { params = new URLSearchParams(location.search); } catch (e) { return ''; }
        const sort = KNOWN_SORTS.includes(segment) ? segment : String(params.get('sort') || '').toLowerCase();
        const period = String(params.get('t') || '').toLowerCase();

        if (sort === FORCED_SORT) {
          // Top over a period that was picked deliberately: leave it be. Top with
          // no period at all still gets one, so the month is stated rather than
          // left to whatever Reddit decides a bare /top/ means.
          if (period && period !== FORCED_PERIOD) return '';
          if (period === FORCED_PERIOD) return '';
        }
        return `${location.origin}/r/${sub}/${FORCED_SORT}/?t=${FORCED_PERIOD}`;
      }

      // A redirect that can fire twice for the same destination is worse than no
      // redirect, so the destination is recorded on the window: after the
      // replace the page reloads, the URL is already right, and the target comes
      // back empty — but an in-page route change gets the same protection.
      function applyForcedSubredditSort() {
        let target = '';
        try { target = forcedSubredditSortTarget(); } catch (e) { return false; }
        if (!target) return false;
        if (window.__stripperLastForcedSort === target) return false;
        window.__stripperLastForcedSort = target;
        try { location.replace(target); } catch (e) { return false; }
        return true;
      }

      function isBlockedFeedLocation() {
        const parts = location.pathname.split('/').filter(Boolean);
        if (!parts.length) return true;
        const first = String(parts[0] || '').toLowerCase();
        if (['best', 'hot', 'new', 'top', 'rising'].includes(first)) return true;
        if (first === 'r') return parts.length >= 2 && !parts.some(part => String(part).toLowerCase() === 'comments');
        return false;
      }

      function feedPostCandidates() {
        const nodes = Array.from(document.querySelectorAll('shreddit-post, article, [data-testid="post-container"], div[data-click-id="background"], .Post'))
          .filter(post => post && !post.closest('#redditGuestPanel'));
        return nodes.filter(post => !nodes.some(other => other !== post && other.contains(post)));
      }

      // The subreddit whose own listing page we are on, if any. Checking off a
      // subreddit hides it from other feeds but must not blank out the sub when
      // you deliberately open it — the same way a blocked user's own profile
      // still shows their posts.
      function currentFeedSubredditName() {
        const parts = location.pathname.split('/').filter(Boolean);
        if (parts.length < 2 || String(parts[0]).toLowerCase() !== 'r') return '';
        return normalizeSubredditName(decodeURIComponent(parts[1] || ''));
      }

      // Two independent reasons a post is not shown: its author is on the
      // Blocked list, or it has already been downloaded. The second is the
      // "checked" state now — nothing is ticked off by hand any more.
      function filterBlockedProfilePosts() {
        const blocked = loadStripperBlockedUsers();
        const shouldFilterAuthors = blocked.size > 0 && isBlockedFeedLocation();
        const hideDownloaded = typeof rabbithole !== 'undefined'
          && rabbithole.showDownloadedPosts && !rabbithole.showDownloadedPosts();
        feedPostCandidates().forEach(post => {
          const author = postAuthorName(post);
          const hideAuthor = shouldFilterAuthors && author && blocked.has(author);
          // Downloaded posts hide on every listing, a user's own profile very
          // much included: seeing only what is new on a profile you have already
          // pulled is the whole point of keeping the ledger.
          const postId = hideDownloaded ? feedPostId(post) : '';
          const hideDone = !!(postId && rabbithole.isPostDownloaded(postId));
          post.classList.toggle('stripperBlockedProfilePost', !!(hideAuthor || hideDone));
          post.classList.toggle('stripperDownloadedPost', hideDone);
          if (hideAuthor) post.setAttribute('data-stripper-blocked-author', author);
          else post.removeAttribute('data-stripper-blocked-author');
        });
      }

      // Reddit's markup carries the post id in a different place depending on
      // which front-end rendered the page, so take whichever shape is present.
      function postIdFromHref(href) {
        const m = String(href || '').match(/\/comments\/([a-z0-9]+)/i);
        return m ? m[1].toLowerCase() : '';
      }

      function feedPostId(post) {
        if (!post || !post.getAttribute) return '';
        const token = post.getAttribute('id') || post.getAttribute('data-fullname')
          || post.getAttribute('data-post-id') || '';
        const fromToken = String(token).match(/t3_([a-z0-9]+)/i);
        if (fromToken) return fromToken[1].toLowerCase();
        const fromPermalink = postIdFromHref(post.getAttribute('permalink') || '');
        if (fromPermalink) return fromPermalink;
        const link = post.querySelector && post.querySelector('a[href*="/comments/"]');
        return link ? postIdFromHref(link.getAttribute('href') || link.href || '') : '';
      }

      function postAuthorName(post) {
        if (!post) return '';
        const attrAuthor = post.getAttribute && (post.getAttribute('author') || post.getAttribute('data-author'));
        if (attrAuthor) return normalizeRedditUsername(attrAuthor);
        const authorEl = post.querySelector && post.querySelector('[author], [data-author]');
        const nestedAuthor = authorEl && (authorEl.getAttribute('author') || authorEl.getAttribute('data-author'));
        if (nestedAuthor) return normalizeRedditUsername(nestedAuthor);
        const links = post.querySelectorAll ? post.querySelectorAll('a[href*="/user/"], a[href*="/u/"]') : [];
        for (const link of links) {
          const name = profileNameFromHref(link.href || link.getAttribute('href') || '');
          if (name) return name;
        }
        return '';
      }

      // Drag the whole window by its header. Mirrors the rabbithole window's old
      // drag behavior; ignores drags that start on a button/input in the header.
      function makePanelDraggable(win, handle) {
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
    
      function scanButtonIdleLabel() {
        const context = scanContextFromLocation();
        if (!context) return 'Scan';
        if (!isCurrentContextSaved(context)) return 'Add';
        return context.type === 'subreddit' ? 'Added' : 'Scan';
      }

      function isCurrentContextSaved(context) {
        const id = scannedNodeId(context || scanContextFromLocation());
        return !!(id && rabbithole.hasNode(id));
      }

      function isProfileBlocked(username) {
        const name = normalizeRedditUsername(username);
        return !!(name && loadStripperBlockedUsers().has(name));
      }

      function baseFileCountText() {
        if (state.fileProgressOverride) return state.fileProgressOverride;
        return `${state.files.length} file${state.files.length === 1 ? '' : 's'}`;
      }

      function syncUi() {
        const context = scanContextFromLocation();
        const currentSaved = isCurrentContextSaved(context);
        const hasFiles = state.files.length > 0;
        const isPostScan = state.scanType === 'post';
        const isProfileScan = state.scanType === 'profile';
        const canBlockProfile = !!(context && context.type === 'profile' && !currentSaved);
        const profileBlocked = canBlockProfile && isProfileBlocked(context.username);
        ui.scanBtn.disabled = state.busy || (context && context.type === 'subreddit' && currentSaved);
        if (!state.busy) ui.scanBtn.textContent = scanButtonIdleLabel();
        // A single post just floats one "Download Post" button; the Posts/Pages
        // sections are unnecessary, so the grey square only appears for profiles.
        ui.downloadStack.hidden = !(isPostScan && hasFiles);
        ui.postBtn.disabled = state.busy || !hasFiles;
        ui.postsBtn.disabled = state.busy || !state.posts.length;
        ui.selectiveDownloads.hidden = !(isProfileScan && hasFiles);
        ui.postRangeInput.placeholder = state.posts.length ? `Posts 1-${state.posts.length}` : 'Posts none';
        ui.postRangeInput.disabled = state.busy || !state.posts.length;
        ui.postRangeBtn.disabled = state.busy || !state.posts.length;
        ui.profileLabel.textContent = state.username ? `u/${state.username}` : 'No profile scanned';
        const base = baseFileCountText();
        ui.countLabel.textContent = state.countTextOverride ? `${base} · ${state.countTextOverride}` : base;
        ui.removeSavedBtn.hidden = !(context && currentSaved);
        ui.removeSavedBtn.disabled = state.busy;
        ui.blockProfileBtn.hidden = !canBlockProfile;
        ui.blockProfileBtn.disabled = state.busy;
        ui.blockProfileBtn.textContent = profileBlocked ? 'Unblock Profile' : 'Block Profile';
      }
    
      function setBusy(busy, scanLabel) {
        state.busy = !!busy;
        ui.scanBtn.textContent = scanLabel || (state.busy ? 'Working...' : scanButtonIdleLabel());
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

      function setFileProgressOverride(done, total) {
        const d = Math.max(0, Number(done) || 0);
        const t = Math.max(0, Number(total) || 0);
        state.fileProgressOverride = t ? formatUnitTicker(d, t, 'file') : '';
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
    
      // The one control that says whether downloaded posts are on screen. It
      // lives in the head rather than in a tab because it applies to the site,
      // not to whichever pane happens to be open.
      function syncHiddenToggle() {
        if (!ui.hiddenToggle) return;
        const showing = rabbithole.showDownloadedPosts();
        ui.hiddenToggle.textContent = showing ? '◉' : '◎';
        ui.hiddenToggle.classList.toggle('is-on', showing);
        ui.hiddenToggle.title = showing
          ? 'Downloaded posts are showing — click to hide them'
          : 'Downloaded posts are hidden — click to show them';
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
        const isCollapsed = !!collapsed;
        ui.panel.classList.toggle('rg-collapsed', isCollapsed);
        if (ui.collapseBtn) {
          ui.collapseBtn.textContent = isCollapsed ? '▾' : '▴';
          ui.collapseBtn.title = isCollapsed ? 'Expand' : 'Collapse';
        }
        // The saved list may have been hidden, so nudge it to re-measure once the
        // window is expanded again.
        if (!isCollapsed) requestAnimationFrame(() => rabbithole.resize());
      }

      // A map with every name on it needs width; the download strip does not.
      // The panel is a user-resizable dock, so widening it is a loan: we put the
      // width back on the way out, and only if it is still the width we set —
      // if it has moved since, the user resized it and that outranks us.
      const GRAPH_PANEL_WIDTH = 620;
      let panelWidthBeforeGraph = 0;
      let panelWidthAppliedForGraph = 0;

      function applyGraphPanelWidth(active) {
        const panel = ui.panel;
        if (!panel) return;
        const current = Math.round(panel.getBoundingClientRect().width);
        if (active) {
          if (panelWidthAppliedForGraph) return;             // already lent
          const target = Math.min(GRAPH_PANEL_WIDTH, Math.floor(window.innerWidth * 0.8));
          if (current >= target) return;                     // already wide enough
          panelWidthBeforeGraph = current;
          panelWidthAppliedForGraph = target;
          panel.style.width = target + 'px';
        } else if (panelWidthAppliedForGraph) {
          if (Math.abs(current - panelWidthAppliedForGraph) <= 2) {
            panel.style.width = panelWidthBeforeGraph + 'px';
          }
          panelWidthBeforeGraph = 0;
          panelWidthAppliedForGraph = 0;
        }
      }

      // The right-docked strip shows one view at a time: the downloader sidebar,
      // saved list, or blocked list.
      function setMode(mode) {
        const m = ['column', 'queue', 'graph', 'blocked'].includes(mode) ? mode : 'download';
        ui.mode = m;
        ui.panel.setAttribute('data-mode', m);
        if (ui.modeBtns) ui.modeBtns.forEach(b => b.classList.toggle('is-active', b.dataset.mode === m));
        applyGraphPanelWidth(m === 'graph');
        if (m === 'column') rabbithole.setView('columns');
        else if (m === 'queue') rabbithole.setView('queue');
        else if (m === 'graph') rabbithole.setView('graph');
        else if (m === 'blocked') rabbithole.setView('blocked');
        // The width just changed under the map, so let it reframe itself.
        if (m === 'graph') requestAnimationFrame(() => rabbithole.resize());
      }

      // Saved view shows one node type full width; this sub-switcher picks which.
      // Defaults to Users.
      function setColumnType(type) {
        const t = (type === 'sub' || type === 'post') ? type : 'user';
        ui.colType = t;
        if (ui.colModeBtns) ui.colModeBtns.forEach(b => b.classList.toggle('is-active', b.dataset.coltype === t));
        rabbithole.setColumnType(t);
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

      function subredditFromLocation() {
        const parts = location.pathname.split('/').filter(Boolean);
        if (parts.length < 2 || String(parts[0]).toLowerCase() !== 'r') return '';
        const name = decodeURIComponent(parts[1] || '').trim();
        return name.replace(/^r\//i, '');
      }
    
      function scanContextFromLocation() {
        const postId = postIdFromLocation();
        if (postId) return { type: 'post', postId };
        const username = profileFromLocation();
        if (username) return { type: 'profile', username };
        const subreddit = subredditFromLocation();
        if (subreddit) return { type: 'subreddit', subreddit };
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
        state.files = safeCachedArray(payload.files);
        state.subreddits = safeCachedArray(payload.subreddits);
        state.summary = payload.summary || null;
        state.summaryNodeId = payload.summaryNodeId || '';
        state.countTextOverride = '';
        state.fileProgressOverride = '';
        state.lastScanAt = Number(payload.lastScanAt || cached.savedAt || 0) || Date.now();
        state.loadedScanCacheKey = cacheKey;
        if (state.summaryNodeId && state.summary) {
          const cachedContext = state.scanType === 'post'
            ? { type: 'post', postId: state.summaryNodeId.replace(/^post:/, '') }
            : { type: 'profile', username: state.username };
          rabbithole.recordScan(state.summaryNodeId, state.summary, scannedRabbitholeNode(cachedContext));
        }
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

      // Whether files of a given kind ('image' | 'video' | 'text') are currently
      // enabled by the File Type checkboxes. Defaults match the initial markup
      // (images/videos on, text off) when the chips aren't built yet.
      function typeAllowed(kind) {
        const chip = ui.typeChips && ui.typeChips[kind];
        if (!chip) return kind !== 'text';
        return chip.getAttribute('aria-checked') === 'true';
      }

      // Drop files whose type is unchecked in the File Type filter. A post/page
      // archive keeps its other files — only the individually excluded files are
      // skipped. Single-post scans hide the filter UI, so they take everything.
      function filterFilesByType(files) {
        if (!Array.isArray(files)) return [];
        if (state.scanType === 'post') return files.slice();
        return files.filter(f => {
          const kind = classifyFileKind(f);
          if (kind === 'image') return typeAllowed('image');
          if (kind === 'video') return typeAllowed('video');
          if (kind === 'text') return typeAllowed('text');
          return true;   // unknown/other kinds are always kept
        });
      }

      // Roll up the current scan into a small summary the saved list can show.
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
          scannedAt: Date.now()
        };
      }

      function computeProfileStats() {
        let images = 0, videos = 0;
        for (const f of state.files) {
          const kind = classifyFileKind(f);
          if (kind === 'image') images++;
          else if (kind === 'video') videos++;
        }
        const textOnlyPosts = state.posts.filter(post => {
          const files = Array.isArray(post.files) ? post.files : [];
          return files.length > 0 && files.every(file => classifyFileKind(file) === 'text');
        }).length;
        return {
          files: state.files.length,
          posts: state.posts.length,
          images,
          videos,
          textOnlyPosts
        };
      }

      function logProfileStats() {
        const stats = computeProfileStats();
        logLine(`${stats.files} Files`);
        logLine(`${stats.posts} Posts`);
        logLine(`${stats.images} Images`);
        logLine(`${stats.videos} Videos`);
        logLine(`${stats.textOnlyPosts} Text only posts`);
      }

      // The Rabbithole node id for whatever was just scanned (matches classify()).
      function scannedNodeId(context) {
        if (!context) return '';
        if (context.type === 'post') return context.postId ? 'post:' + String(context.postId).toLowerCase() : '';
        if (context.type === 'subreddit') return context.subreddit ? 'sub:' + String(context.subreddit).toLowerCase() : '';
        const name = context.username || state.username;
        return name ? 'user:' + String(name).toLowerCase() : '';
      }

      function scannedRabbitholeNode(context) {
        const id = scannedNodeId(context);
        if (!id || !context) return null;
        if (context.type === 'post') {
          const first = state.posts[0] || {};
          const sub = first.subreddit ? `r/${first.subreddit}\n` : '';
          const permalink = first.permalink || '';
          return {
            type: 'post',
            id,
            label: `${sub}${context.postId}`,
            url: permalink ? new URL(permalink, 'https://www.reddit.com').href : location.href
          };
        }
        if (context.type === 'subreddit') {
          return {
            type: 'sub',
            id,
            label: `r/${context.subreddit}`,
            url: `${location.origin}/r/${encodeURIComponent(context.subreddit)}/`
          };
        }
        const name = context.username || state.username;
        return {
          type: 'user',
          id,
          label: `u/${name}`,
          url: `${location.origin}/user/${encodeURIComponent(name)}/`
        };
      }

      // Lists every subreddit a scanned user has posted in (with post counts) in
      // the window sidebar, under the status log. Each row links to the sub and
      // has a "+" to add just that one to the saved list; the header "+" adds
      // them all. Hidden when there are no subreddits (e.g. single-post scans).
      function renderSubsPanel() {
        if (!ui.subs) return;
        const subs = state.subreddits || [];
        if (!subs.length) {
          ui.subs.hidden = true;
          ui.subList.innerHTML = '';
          return;
        }
        ui.subCount.textContent = `u/${state.username} · ${subs.length}`;
        ui.subList.innerHTML = '';
        subs.forEach(s => {
          const row = document.createElement('div');
          row.className = 'rg-subRow';

          const link = document.createElement('a');
          link.className = 'rg-subLink';
          link.href = `https://www.reddit.com/r/${encodeURIComponent(s.name)}/`;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `r/${s.name}`;

          const count = document.createElement('span');
          count.className = 'rg-subN';
          count.textContent = s.count;

          const add = document.createElement('button');
          add.className = 'rg-subAdd';
          add.type = 'button';
          add.textContent = '+';
          add.title = `Add r/${s.name} to the saved list`;
          add.addEventListener('click', () => {
            const added = rabbithole.addSubreddits(state.username, [s]);
            logLine(added
              ? `Rabbithole: saved r/${s.name}.`
              : `Rabbithole: could not add r/${s.name}.`);
            if (added && rabbithole.syncWithReddit) rabbithole.syncWithReddit({ force: true, reason: 'saved-subreddit' });
          });

          row.appendChild(link);
          row.appendChild(count);
          row.appendChild(add);
          ui.subList.appendChild(row);
        });
        ui.subs.hidden = false;
      }

      function addCurrentContextToSaved(context) {
        const node = scannedRabbitholeNode(context);
        if (!node) return false;
        const added = rabbithole.addNode(node, true);
        if (added && (node.type === 'user' || node.type === 'sub') && rabbithole.syncWithReddit) {
          rabbithole.syncWithReddit({ force: true, reason: 'saved-current' });
        }
        return added;
      }

      async function removeCurrentSavedItem() {
        if (state.busy) return;
        const context = scanContextFromLocation();
        const id = scannedNodeId(context);
        if (!context || !id || !rabbithole.hasNode(id)) {
          logLine('No saved item found for this page.');
          syncUi();
          return;
        }
        rabbithole.removeNode(id);
        const label = context.type === 'subreddit'
          ? `r/${context.subreddit}`
          : context.type === 'profile'
            ? `u/${context.username}`
            : `post ${context.postId}`;
        logLine(`Removed saved ${label}.`);
        syncUi();
        if ((context.type === 'subreddit' || context.type === 'profile') && rabbithole.unsubscribeSavedNode) {
          await rabbithole.unsubscribeSavedNode(id, label);
        }
      }

      function toggleCurrentProfileBlock() {
        if (state.busy) return;
        const context = scanContextFromLocation();
        if (!context || context.type !== 'profile' || isCurrentContextSaved(context)) {
          logLine('Open an unsaved profile to block it.');
          syncUi();
          return;
        }
        const name = normalizeRedditUsername(context.username);
        if (!name) {
          logLine('Could not identify this profile.');
          return;
        }
        const blocked = loadStripperBlockedUsers();
        if (blocked.has(name)) {
          blocked.delete(name);
          saveStripperBlockedUsers(blocked);
          logLine(`Unblocked u/${context.username}.`);
        } else {
          blocked.add(name);
          saveStripperBlockedUsers(blocked);
          logLine(`Blocked u/${context.username}; their posts will be hidden from feeds and subreddits.`);
        }
        filterBlockedProfilePosts();
        if (rabbithole.refreshBlockedPanel) rabbithole.refreshBlockedPanel();
        syncUi();
      }

      async function scanCurrentProfile() {
        if (state.busy) return;
        const context = scanContextFromLocation();
        if (!context) {
          logLine('This page is not a Reddit user profile, subreddit, or post.');
          setProgress(0);
          return;
        }
        const saved = isCurrentContextSaved(context);
        if (!saved) {
          const added = addCurrentContextToSaved(context);
          const label = context.type === 'subreddit'
            ? `r/${context.subreddit}`
            : context.type === 'profile'
              ? `u/${context.username}`
              : `post ${context.postId}`;
          logLine(added ? `Saved ${label}.` : `Could not save ${label}.`);
          syncUi();
          return;
        }
        if (context.type === 'subreddit') return;

        const cacheKey = redditScanCacheKey(context);
        if (cacheKey && state.loadedScanCacheKey !== cacheKey) {
          logLine(`Checking browser scan cache for ${cacheKey}.`);
          const cached = loadStripperScanCache(cacheKey);
          if (cached) {
            applyRedditCachedScan(cached, cacheKey);
            logLine(`Loaded cached Reddit scan from ${formatCacheAge(cached.savedAt)}. Press Scan again to refresh it.`);
            if (state.scanType === 'profile') logProfileStats();
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
        state.files = [];
        state.countTextOverride = '';
        state.fileProgressOverride = '';
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
    
          const built = buildDownloadSetFromRawPosts(rawPosts);
          const parsed = built.parsed;
          const downloads = built.downloads;
          state.posts = downloads.posts;
          state.files = downloads.files;

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

          // Feed the ledger. `parsed` is the pre-filter list, so the "how many
          // are there" denominator counts posts the file-type filter would drop
          // as well — otherwise turning Videos off would make a user look done.
          if (context.type === 'profile' && state.username) {
            recordScannedUserHistory(state.username, parsed, { deep: true });
          }

          // Hand a summary to the saved list for this item.
          state.summary = computeScanSummary();
          state.summaryNodeId = scannedNodeId(context);
          if (state.summaryNodeId) rabbithole.recordScan(state.summaryNodeId, state.summary, scannedRabbitholeNode(context));
          renderSubsPanel();

          state.loadedScanCacheKey = cacheKey;
          setProgress(100);
          logLine(`Scan complete: ${state.posts.length} post${state.posts.length === 1 ? '' : 's'}, ${state.files.length} file${state.files.length === 1 ? '' : 's'}.`);
          if (context.type === 'profile') logProfileStats();
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
    
      // Post ids plus the one fact the ledger cannot re-derive later: whether
      // there was ever anything to download. A text-only post is recorded with
      // hasMedia false so it never counts as pending.
      function recordScannedUserHistory(username, parsedPosts, opts) {
        if (typeof rabbithole === 'undefined' || !rabbithole.recordUserHistory) return 0;
        const entries = (Array.isArray(parsedPosts) ? parsedPosts : []).map(post => ({
          id: post.id,
          subreddit: post.subreddit,
          createdUtc: post.createdUtc,
          hasMedia: extractMediaFiles(post.raw).length > 0
        }));
        // A user with nothing to show still gets a record written. Bailing out
        // on an empty list left them stuck in the Queue's "Never checked" section
        // no matter how often they were checked — the one case where pressing
        // Refresh looks like it did nothing at all.
        return rabbithole.recordUserHistory(username, entries, opts || {});
      }

      // Record what a finished archive actually contained. Called per archive
      // rather than once at the end, so a run that fails or is closed part-way
      // still leaves the ledger true for whatever did land on disk.
      function markDownloadedPosts(posts) {
        if (typeof rabbithole === 'undefined' || !rabbithole.markPostsDownloaded) return;
        const entries = (Array.isArray(posts) ? posts : [])
          .filter(Boolean)
          .map(post => ({ id: post.id, user: post.user || state.username }))
          .filter(entry => entry.id);
        if (!entries.length) return;
        rabbithole.markPostsDownloaded(entries);
        filterBlockedProfilePosts();
      }

      // Manual only, by design: nothing in the Queue touches the network until
      // its Refresh button is pressed. Pressing it again while a pass is running
      // stops it — a walk over a large saved list needs a way out.
      let queueRefreshRunning = false;
      let queueRefreshCancel = false;

      // The one user being checked on their own, if any.
      let queueUserRefreshName = '';

      function queueRefreshIsRunning() { return queueRefreshRunning; }
      function queueRefreshingUser() { return queueUserRefreshName; }
      // Anything that talks to Reddit on the Queue's behalf. One user at a time
      // and the whole-list walk must not overlap: they would interleave requests
      // and double the rate the account is hitting Reddit at.
      function queueRefreshBusy() { return queueRefreshRunning || !!queueUserRefreshName; }

      // Check a single saved user without walking the whole list, and without
      // having to open their profile and Scan.
      async function refreshQueueUser(name) {
        const user = normalizeRedditUsername(name || '');
        if (!user || queueRefreshBusy()) return;
        queueUserRefreshName = user;
        rabbithole.refreshQueuePanel();
        try {
          const known = rabbithole.loadUserHistory(user);
          // Same rule as the whole-list walk: everything the first time, only
          // the newest page after that.
          const deep = !known || !known.deep;
          const raw = await fetchQueueSubmittedPosts(user, deep);
          const parsed = raw.map(normalizePost).filter(Boolean);
          const added = recordScannedUserHistory(user, parsed, { deep });
          logLine(added
            ? `Queue: u/${user} has ${added} post${added === 1 ? '' : 's'} not seen before.`
            : `Queue: u/${user} has nothing new.`);
        } catch (err) {
          logLine(`Queue: could not refresh u/${user}: ${errorMessage(err)}`);
        } finally {
          queueUserRefreshName = '';
          rabbithole.refreshQueuePanel();
          filterBlockedProfilePosts();
        }
      }

      async function refreshDownloadQueue() {
        // A single-user check is already using the connection; let it finish.
        if (queueUserRefreshName) return;
        if (queueRefreshRunning) {
          queueRefreshCancel = true;
          logLine('Queue: stopping after the current user.');
          return;
        }
        const users = rabbithole.savedUserNodes()
          .map(n => rabbithole.userNameFromNode(n))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        if (!users.length) { logLine('Queue: no saved users to refresh.'); return; }

        queueRefreshRunning = true;
        queueRefreshCancel = false;
        rabbithole.refreshQueuePanel();
        let checked = 0, found = 0, failed = 0;
        logLine(`Queue: refreshing ${users.length} saved user${users.length === 1 ? '' : 's'}.`);
        try {
          for (const name of users) {
            if (queueRefreshCancel) { logLine('Queue: refresh stopped.'); break; }
            const known = rabbithole.loadUserHistory(name);
            // A user we have never walked needs their whole history, or the
            // "x of y" would measure one page against a long backlog and read
            // as almost-done when it is barely started. After that the newest
            // page is enough, since that is where new posts appear.
            const deep = !known || !known.deep;
            try {
              const raw = await fetchQueueSubmittedPosts(name, deep);
              const parsed = raw.map(normalizePost).filter(Boolean);
              found += recordScannedUserHistory(name, parsed, { deep });
              checked++;
            } catch (err) {
              failed++;
              logLine(`Queue: could not refresh u/${name}: ${errorMessage(err)}`);
            }
            rabbithole.refreshQueuePanel();
            if (queueRefreshCancel) { logLine('Queue: refresh stopped.'); break; }
            await delay(API_DELAY_MIN + Math.floor(Math.random() * API_DELAY_JITTER));
          }
          logLine(`Queue: checked ${checked} user${checked === 1 ? '' : 's'}, ${found} new post${found === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
        } finally {
          queueRefreshRunning = false;
          queueRefreshCancel = false;
          rabbithole.refreshQueuePanel();
          filterBlockedProfilePosts();
        }
      }

      // A quieter twin of fetchSubmittedPosts: no log spam, no progress bar, and
      // it stops after one page unless a full walk was asked for.
      async function fetchQueueSubmittedPosts(username, deep) {
        const posts = [];
        let after = '';
        let page = 0;
        const maxPages = deep ? MAX_API_PAGES : 1;
        while (page < maxPages) {
          page++;
          const url = new URL(`https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json`);
          url.searchParams.set('limit', String(LISTING_LIMIT));
          url.searchParams.set('raw_json', '1');
          if (after) url.searchParams.set('after', after);
          const json = await requestJson(url.href);
          const children = json && json.data && Array.isArray(json.data.children) ? json.data.children : [];
          for (const child of children) {
            if (child && child.kind === 't3' && child.data) posts.push({ ...child.data, __rgPage: page });
          }
          after = json && json.data ? json.data.after : '';
          if (!after || !children.length || queueRefreshCancel) break;
          await delay(API_DELAY_MIN + Math.floor(Math.random() * API_DELAY_JITTER));
        }
        return posts;
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
        // Reddit pages newest-first, so the fetch order runs backwards through
        // time. Flip the numbering so page 1 is the oldest batch and the number
        // climbs with recency, matching how the posts themselves accumulate.
        // (When the scan is cut short by MAX_API_PAGES, page 1 is the oldest
        // batch actually fetched — the only "oldest" available.)
        const fetchedPages = posts.reduce((max, post) => Math.max(max, Number(post.__rgPage) || 1), 1);
        for (const post of posts) {
          post.__rgPage = fetchedPages - (Number(post.__rgPage) || 1) + 1;
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

      function buildDownloadSetFromRawPosts(rawPosts) {
        const parsed = (Array.isArray(rawPosts) ? rawPosts : []).map(normalizePost).filter(Boolean);
        const mediaPosts = parsed
          .map(post => {
            const files = extractMediaFiles(post.raw);
            const md = buildPostTextFile(post, files.length > 0);   // post title/body as .md
            if (md) files.push(md);
            return { ...post, files };
          })
          .filter(post => post.files.length > 0);
        return { parsed, downloads: buildPostDownloads(mediaPosts) };
      }
    
      function extractMediaFiles(post) {
        const out = [];
        const seen = new Set();
        const add = (url, label, mime, extra) => {
          const normalized = normalizeDownloadUrl(url);
          if (!normalized) return;
          if (!isLikelyMediaUrl(normalized, mime)) return;
          // Exact repeats only. Reddit lists the same URL under several keys for
          // one post, and fetching it twice would put two byte-identical files in
          // the zip under different names — noise, not authority. Anything that
          // differs by so much as a query parameter is kept.
          if (seen.has(normalized)) return;
          seen.add(normalized);
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
    
      // Every post, every file that post exposes. Nothing is dropped for being
      // the same as something in another post: the download is meant to be an
      // authoritative copy of what Reddit served, and deduping is a decision to
      // make afterwards against the files themselves, not a decision to bake
      // into the fetch where it cannot be undone or audited.
      function buildPostDownloads(posts) {
        const sorted = posts
          .slice()
          .sort((a, b) => (a.createdUtc || 0) - (b.createdUtc || 0) || String(a.id).localeCompare(String(b.id)));
        const keptPosts = [];
        const keptFiles = [];
        let globalIndex = 0;
    
        for (const post of sorted) {
          const postFiles = [];
          const textFiles = [];
          for (const file of post.files) {
            if (file.kind === 'text') { textFiles.push(file); continue; }
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
    
        return { posts: keptPosts, files: keptFiles };
      }
    
      function selectedRedditPostsFromRange() {
        const parsed = parseStripperRangeList(ui.postRangeInput.value, state.posts.length);
        if (parsed.error) {
          logLine(`Post range error: ${parsed.error}.`);
          return [];
        }
        return state.posts.filter((post, idx) => parsed.numbers.has(idx + 1));
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

      async function downloadPostArchives(selectedPosts, options) {
        const posts = Array.isArray(selectedPosts) ? selectedPosts : state.posts;
        if (state.busy || !posts.length) return;
        const includeAllFileTypes = !!(options && options.includeAllFileTypes);
        const archiveItems = posts
          .map(post => ({ post, files: includeAllFileTypes ? (Array.isArray(post.files) ? post.files.slice() : []) : filterFilesByType(post.files) }))
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
        let saved = 0;
        let failed = 0;
        let completedFiles = 0;
        try {
          for (let i = 0; i < archiveItems.length; i++) {
            const item = archiveItems[i];
            const files = item.files;
            const firstFile = files[0];
            const archiveName = buildArchiveName(firstFile.userFolder || state.userFolder, firstFile.postFolder);
            logLine(`Building post zip ${i + 1}/${archiveItems.length}: ${firstFile.postFolder}`);
            // Each post stands or falls on its own. One dead link used to abort
            // the whole run from here, leaving every post after it untouched and
            // unexplained — and the longer the queue, the more it cost.
            try {
              await buildAndSaveArchive(files, archiveName, (pct, label) => {
                const base = (i / archiveItems.length) * 100;
                const span = 100 / archiveItems.length;
                setProgress(base + (pct / 100) * span);
                if (label) logLine(label);
              }, (fileDone) => {
                setFileProgressOverride(completedFiles + fileDone, totalFiles);
              });
              // Only a post whose archive actually saved is recorded. A skipped
              // one stays unmarked, so it is still waiting in the Queue and comes
              // back around on the next run rather than being lost quietly.
              markDownloadedPosts([item.post]);
              saved++;
            } catch (err) {
              failed++;
              logLine(`Skipped post ${firstFile.postFolder}: ${errorMessage(err)}`);
            }
            // The bar tracks progress through the queue, not successes, so it
            // still reaches the end when something was skipped.
            completedFiles += files.length;
            setFileProgressOverride(completedFiles, totalFiles);
            setCountTextOverride(formatUnitTicker(saved, archiveItems.length, 'post'));
            setProgress(((i + 1) / archiveItems.length) * 100);
            await delay(FILE_DELAY_MS);
          }
          logLine(failed
            ? `Downloaded ${saved} post archive${saved === 1 ? '' : 's'}; skipped ${failed}.`
            : `Downloaded ${saved} post archive${saved === 1 ? '' : 's'}.`);
        } catch (err) {
          logLine(`Post download stopped: ${errorMessage(err)}`);
        } finally {
          setCountTextOverride('');
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

      let redditMePromise = null;
      async function redditMe() {
        if (!redditMePromise) {
          const url = new URL('/api/me.json', location.origin);
          redditMePromise = requestJson(url.href).then(json => {
            const data = json && json.data ? json.data : {};
            return {
              name: normalizeRedditUsername(data.name || ''),
              modhash: String(data.modhash || data.modhashes || '').trim()
            };
          }).catch(err => {
            redditMePromise = null;
            throw err;
          });
        }
        return redditMePromise;
      }

      async function requestRedditForm(path, fields) {
        let me = null;
        try { me = await redditMe(); } catch (err) {}
        return new Promise((resolve, reject) => {
          const body = new URLSearchParams(fields || {});
          if (me && me.modhash && !body.has('uh')) body.set('uh', me.modhash);
          const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': USER_AGENT_NOTE
          };
          if (me && me.modhash) headers['X-Modhash'] = me.modhash;
          const url = new URL(path, location.origin);
          try {
            GM_xmlhttpRequest({
              method: 'POST',
              url: url.href,
              anonymous: false,
              headers,
              data: body.toString(),
              timeout: 45000,
              onload: res => {
                if (res.status < 200 || res.status >= 300) {
                  reject(new Error(`HTTP ${res.status}`));
                  return;
                }
                let parsed = null;
                try { parsed = res.responseText ? JSON.parse(res.responseText) : null; } catch (err) {}
                const errors = parsed && parsed.json && Array.isArray(parsed.json.errors) ? parsed.json.errors : [];
                if (errors.length) {
                  reject(new Error(errors.map(e => Array.isArray(e) ? (e[1] || e[0]) : String(e)).filter(Boolean).join('; ') || 'Reddit rejected the request'));
                  return;
                }
                resolve(parsed || {});
              },
              onerror: () => reject(new Error('network error')),
              ontimeout: () => reject(new Error('request timeout'))
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    
      function parseHeader(headers, name) {
        if (!headers) return '';
        const re = new RegExp(`^${name}:\\s*([^\\r\\n]+)`, 'im');
        const m = String(headers).match(re);
        return m ? m[1].trim() : '';
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
              if (!blob || typeof blob.size !== 'number') {
                reject(new Error('empty response'));
                return;
              }
              // Empty payloads get saved as 0-byte, contentless files otherwise.
              if (blob.size === 0) {
                reject(new Error('empty file (0 bytes)'));
                return;
              }
              // Reddit/imgur serve removed, rate-limited, or 403'd media as a
              // 200 HTML/JSON placeholder page. Without this check that page is
              // written under an image/gif extension and is unviewable. Rejecting
              // lets fetchBlobWithRetry fall back to alternate URLs / the DASH
              // manifest, or skip+log the file instead of archiving junk.
              const contentType = (parseHeader(res.responseHeaders, 'content-type') || blob.type || '').toLowerCase();
              if (/^(?:text\/|application\/(?:json|xml|xhtml))/.test(contentType)) {
                reject(new Error(`server returned ${contentType.split(';')[0] || 'non-media content'} (likely a removed/error page)`));
                return;
              }
              // Catch a truncated transfer (dropped connection still fires onload
              // with a partial blob). Servers don't gzip already-compressed media,
              // so Content-Length should match; only a short blob is suspect.
              const expectedLen = Number(parseHeader(res.responseHeaders, 'content-length'));
              if (expectedLen > 0 && blob.size < expectedLen) {
                reject(new Error(`truncated download (${blob.size}/${expectedLen} bytes)`));
                return;
              }
              // Final guard for mislabeled content-types: every common image/video
              // format has binary magic bytes, so a leading '<' means HTML/XML.
              try {
                const head = await blob.slice(0, 16).text();
                if (/^\s*<(?:!doctype|html|head|body|\?xml|svg)/i.test(head)) {
                  reject(new Error('server returned an HTML/XML page instead of media (likely a removed/error page)'));
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
      // Reddit Rabbithole Saved Items — integrated. Shares storage with the
      // standalone "Reddit Rabbithole Map" userscript (same rrm: keys), so it
      // reads any saved items you already built with the old script.
      // ----------------------------------------------------------------------
      const rabbithole = (function () {
        const NS = 'rrm:';        // storage prefix for nodes/edges (old-version compatible)
        const REV = 'rrm_rev';    // revision counter -> cross-tab live refresh
        const COLORS = { sub: '#4f9cf9', user: '#f97362', post: '#9b8cf9' };
        const BRIDGE_KEY = 'rrm_bridge_v1';   // legacy shared-localStorage key; only cleared on reset now

        let booted = false, winEl = null;
        let query = '';
        let view = 'columns';
        let typeFilter = 'all';
        let columnType = 'user';                  // Saved view shows one type full width: 'sub' | 'user' | 'post'

        // How the saved columns are ordered. Cycled from the column header and
        // persisted in GM storage so the choice sticks across page loads/tabs.
        const SORT_KEY = 'rrm_sort_mode';         // 'name' | 'added' | 'rating'
        const SORT_MODES = ['name', 'added', 'rating'];
        const SORT_LABELS = { name: 'Name', added: 'Date added', rating: 'Rating' };
        const REDDIT_SYNC_STATE_KEY = 'rrm_reddit_subscription_sync_v1';
        let sortMode = (() => {
          const v = GM_getValue(SORT_KEY, 'name');
          return SORT_MODES.includes(v) ? v : 'name';
        })();
        let redditSyncRunning = false;
        let redditSyncQueuedForce = false;

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
        // All GM access here is defensive: this runs at boot, before the main
        // Stripper UI mounts, so a rejected write (quota) or a single corrupt
        // value must degrade gracefully instead of throwing — an uncaught error
        // on this path would abort init() and hide the whole panel.
        function safeSet(key, value) {
          try { GM_setValue(key, value); return true; }
          catch (e) { try { console.warn('[Stripper/rabbithole] write failed for', key, e); } catch (e2) {} return false; }
        }
        function safeParse(key) {
          const raw = GM_getValue(key, null);
          if (raw == null) return null;
          try { return JSON.parse(raw); }
          catch (e) {
            // A truncated/corrupt value (e.g. a write cut short when storage was
            // full) is a poison pill on every future boot — drop it and move on.
            try { console.warn('[Stripper/rabbithole] dropping corrupt value', key, e); } catch (e2) {}
            try { GM_deleteValue(key); } catch (e3) {}
            return null;
          }
        }

        function bumpRev() { safeSet(REV, (GM_getValue(REV, 0) || 0) + 1); }

        function upsertNode(n, visited) {
          const key = NS + 'n:' + n.id;
          const rec = safeParse(key)
                   || { id: n.id, type: n.type, label: n.label, url: n.url, visited: false, first: Date.now() };
          rec.label = n.label; rec.url = n.url; rec.type = n.type; rec.last = Date.now();
          if (visited) rec.visited = true;
          safeSet(key, JSON.stringify(rec));
          bumpRev();
        }

        function addEdge(from, to) {
          if (!from || !to || from === to) return;
          const key = NS + 'e:' + from + '__' + to;
          if (GM_getValue(key, null)) return;
          safeSet(key, JSON.stringify({ from, to, ts: Date.now() }));
          bumpRev();
        }

        function loadGraph() {
          const nodes = [], edges = [];
          for (const k of GM_listValues()) {
            if (k.startsWith(NS + 'n:')) { const v = safeParse(k); if (v) nodes.push(v); }
            else if (k.startsWith(NS + 'e:')) { const v = safeParse(k); if (v) edges.push(v); }
          }
          return { nodes, edges };
        }


        // ------------------------------------------------------- download ledger
        // What has actually been pulled off Reddit, post by post. This replaces
        // the old "check off a user/subreddit" system outright: nothing is marked
        // by hand any more. A post is checked when its archive was saved, and a
        // user is finished when every post of theirs that has media is checked.
        //
        // Stored one key per author (`rrm:dl:<name>`) rather than one per post,
        // because GM storage is a key-value store with a real per-write cost and
        // a library of ten thousand posts would otherwise be ten thousand keys.
        const DL_NS = NS + 'dl:';
        const HIST_NS = NS + 'hist:';
        const DL_UNKNOWN_BUCKET = '_';
        const SHOW_DOWNLOADED_KEY = 'rrm_show_downloaded';

        // Every downloaded id across all authors, for the feed filter's per-post
        // lookup. Built once and kept in step by the writers below.
        let downloadedIdCache = null;

        function dlBucketFor(user) {
          const name = normalizeRedditUsername(user || '');
          return name ? name.toLowerCase() : DL_UNKNOWN_BUCKET;
        }

        function normalizePostId(id) {
          return String(id || '').trim().toLowerCase().replace(/^t3_/, '');
        }

        function loadDownloadedIds() {
          if (downloadedIdCache) return downloadedIdCache;
          const set = new Set();
          try {
            for (const k of GM_listValues()) {
              if (!k.startsWith(DL_NS)) continue;
              const v = safeParse(k);
              if (Array.isArray(v)) v.forEach(id => set.add(normalizePostId(id)));
            }
          } catch (e) {}
          downloadedIdCache = set;
          return set;
        }

        function downloadedIdsForUser(name) {
          const v = safeParse(DL_NS + dlBucketFor(name));
          return new Set(Array.isArray(v) ? v.map(normalizePostId) : []);
        }

        function isPostDownloaded(id) {
          const pid = normalizePostId(id);
          return !!pid && loadDownloadedIds().has(pid);
        }

        // entries: [{ id, user }]. Returns how many were newly recorded.
        function markPostsDownloaded(entries, downloaded) {
          const on = downloaded !== false;
          const list = (Array.isArray(entries) ? entries : []).filter(e => e && e.id);
          if (!list.length) return 0;
          const byBucket = new Map();
          list.forEach(e => {
            const bucket = dlBucketFor(e.user);
            if (!byBucket.has(bucket)) byBucket.set(bucket, []);
            byBucket.get(bucket).push(normalizePostId(e.id));
          });
          const cache = loadDownloadedIds();
          let changedCount = 0;
          byBucket.forEach((ids, bucket) => {
            const key = DL_NS + bucket;
            const existing = safeParse(key);
            const set = new Set(Array.isArray(existing) ? existing.map(normalizePostId) : []);
            let changed = false;
            ids.forEach(id => {
              if (!id) return;
              if (on ? set.has(id) : !set.has(id)) return;
              if (on) { set.add(id); cache.add(id); }
              else { set.delete(id); cache.delete(id); }
              changed = true;
              changedCount++;
            });
            if (!changed) return;
            if (set.size) safeSet(key, JSON.stringify([...set]));
            else { try { GM_deleteValue(key); } catch (e) {} }
          });
          if (changedCount) {
            bumpRev();
            if (isWindowOpen()) scheduleRender(); else refreshButton();
          }
          return changedCount;
        }

        // Forget everything recorded as downloaded for one user, so their whole
        // backlog reads as waiting again.
        //
        // The history is deliberately left alone. What a user has posted is a
        // fact about them; what you have pulled is a fact about you, and only
        // the second is being undone. Keeping the history means the counts stay
        // meaningful straight away — 0/16 rather than an unknown "?" that needs
        // a Queue refresh before it means anything.
        function resetUserDownloads(name) {
          const bucket = dlBucketFor(name);
          if (!bucket || bucket === DL_UNKNOWN_BUCKET) return 0;
          const key = DL_NS + bucket;
          const existing = safeParse(key);
          const count = Array.isArray(existing) ? existing.length : 0;
          if (!count) return 0;
          try { GM_deleteValue(key); } catch (e) { return 0; }
          // Rebuild the all-authors lookup from scratch rather than subtracting
          // these ids from it: the same post can sit under a second bucket when
          // its author was not known at download time, and subtracting would
          // un-hide a post that is still legitimately recorded elsewhere.
          downloadedIdCache = null;
          bumpRev();
          if (isWindowOpen()) scheduleRender(); else refreshButton();
          return count;
        }

        // ------------------------------------------------------------- histories
        // A user's known posts, as compact tuples [id, subreddit, createdUtc,
        // hasMedia]. This is the other half of the ledger: without it "not
        // downloaded yet" has no denominator, and the graph has no idea which
        // subreddits a user posts in.
        // r/LiminalSpace, not r/liminalspace. Prefix stripped, case kept.
        function subredditDisplayName(value) {
          return String(value || '').trim().replace(/^\/?r\//i, '').replace(/^r_/i, '');
        }

        function historyKeyFor(name) {
          const n = normalizeRedditUsername(name || '');
          return n ? HIST_NS + n.toLowerCase() : '';
        }

        function loadUserHistory(name) {
          const key = historyKeyFor(name);
          if (!key) return null;
          const rec = safeParse(key);
          if (!rec || !Array.isArray(rec.posts)) return null;
          return rec;
        }

        // Union, never replace: a refresh that only fetched the newest page must
        // not forget the rest of a history a full scan already established.
        // Writing a record with no posts in it is meaningful: it says this user
        // was looked at and had nothing, which is not the same as never looked at.
        function recordUserHistory(name, posts, opts) {
          const key = historyKeyFor(name);
          if (!key) return 0;
          const options = opts || {};
          const prev = loadUserHistory(name);
          const byId = new Map();
          if (prev) prev.posts.forEach(t => { if (t && t[0]) byId.set(normalizePostId(t[0]), t); });
          let added = 0;
          (Array.isArray(posts) ? posts : []).forEach(post => {
            const id = normalizePostId(post && post.id);
            if (!id) return;
            if (!byId.has(id)) added++;
            byId.set(id, [
              id,
              subredditDisplayName(post.subreddit || ''),
              Number(post.createdUtc || post.created_utc || 0) || 0,
              post.hasMedia ? 1 : 0
            ]);
          });
          const rec = {
            name: normalizeRedditUsername(name),
            posts: [...byId.values()],
            fetchedAt: Date.now(),
            // A partial refresh only saw the newest page, so it cannot claim the
            // history is complete — only a full scan may set that.
            deep: options.deep ? Date.now() : (prev && prev.deep) || 0
          };
          safeSet(key, JSON.stringify(rec));
          bumpRev();
          return added;
        }

        // { total, media, downloaded, pending, known } for one saved user.
        // `known` is false when we have never fetched their posts, which is a
        // different thing from "nothing pending" and must read differently.
        function userDownloadProgress(name) {
          const hist = loadUserHistory(name);
          if (!hist) return { known: false, total: 0, media: 0, downloaded: 0, pending: 0, fetchedAt: 0, deep: 0 };
          const done = downloadedIdsForUser(name);
          let media = 0, downloaded = 0;
          hist.posts.forEach(t => {
            const id = normalizePostId(t[0]);
            const hasMedia = t[3] !== 0;
            // A text-only post has nothing to fetch, so counting it as pending
            // would leave every user permanently unfinished.
            if (!hasMedia) return;
            media++;
            if (done.has(id)) downloaded++;
          });
          return {
            known: true,
            total: hist.posts.length,
            media,
            downloaded,
            pending: Math.max(0, media - downloaded),
            fetchedAt: hist.fetchedAt || 0,
            deep: hist.deep || 0
          };
        }

        // lowercase key -> { name (as displayed), count }
        function subredditsForUser(name) {
          const hist = loadUserHistory(name);
          const out = new Map();
          if (!hist) return out;
          hist.posts.forEach(t => {
            const display = subredditDisplayName(t[1]);
            const key = display.toLowerCase();
            if (!key) return;
            const cur = out.get(key);
            if (cur) cur.count++;
            else out.set(key, { name: display, count: 1 });
          });
          return out;
        }

        // Every subreddit any saved user has posted in, plus anything already
        // saved, as one alphabetical list. This is what the picker offers, and it
        // is deliberately wider than what the map draws.
        function allKnownSubreddits() {
          const out = new Map();
          const add = (display, count, saved) => {
            const name = subredditDisplayName(display);
            const key = name.toLowerCase();
            if (!key) return;
            const cur = out.get(key);
            if (cur) {
              cur.count += count;
              cur.saved = cur.saved || saved;
              return;
            }
            out.set(key, { key, name, count, saved });
          };
          savedUserNodes().forEach(n => {
            const user = userNameFromNode(n);
            if (!user) return;
            subredditsForUser(user).forEach(entry => add(entry.name, entry.count, false));
          });
          loadGraph().nodes.forEach(n => {
            if (!n || n.type !== 'sub') return;
            add(n.label || String(n.id).replace(/^sub:/, ''), 0, true);
          });
          return [...out.values()]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        }

        // The picker is not a view filter. Turning a subreddit on saves it and
        // joins it on Reddit; turning it off removes it and leaves. The map is
        // then simply a drawing of what you are actually subscribed to, which is
        // the only reading under which "on the map" means something definite.
        async function toggleGraphSubreddit(key, displayName) {
          const id = 'sub:' + key;
          if (hasNode(id)) {
            removeNodes([id]);
            renderGraph();
            await unsubscribeSavedNode(id, 'r/' + displayName);
            renderGraph();
            return;
          }
          upsertNode({
            type: 'sub', id, label: 'r/' + displayName,
            url: location.origin + '/r/' + encodeURIComponent(displayName)
          }, false);
          renderGraph();
          const target = targetFromSavedId(id);
          if (!target) return;
          try {
            await subscribeRedditTarget(target);
            updateRemoteSnapshotTarget(target, true);
            logSync(`Reddit sync: joined r/${displayName}.`);
          } catch (err) {
            logSync(`Reddit sync could not join r/${displayName}: ${errorMessage(err)}`);
          }
          renderGraph();
        }

        function savedUserNodes() {
          return loadGraph().nodes.filter(n => n && n.type === 'user');
        }

        function userNameFromNode(n) {
          if (!n) return '';
          const fromId = String(n.id || '').replace(/^user:/, '');
          const fromLabel = String(n.label || '').replace(/^u\//i, '');
          return normalizeRedditUsername(fromId || fromLabel);
        }

        // ------------------------------------------------------- hidden toggle
        function showDownloadedPosts() {
          return GM_getValue(SHOW_DOWNLOADED_KEY, false) === true;
        }
        function setShowDownloadedPosts(on) {
          safeSet(SHOW_DOWNLOADED_KEY, !!on);
          bumpRev();
        }

        function countNodes() {
          let n = 0;
          for (const k of GM_listValues()) if (k.startsWith(NS + 'n:')) n++;
          return n;
        }

        function hasNode(id) {
          return !!(id && safeParse(NS + 'n:' + id));
        }

        function addNode(node, visited) {
          if (!node || !node.id) return false;
          upsertNode(node, !!visited);
          if (isWindowOpen()) scheduleRender(); else refreshButton();
          return true;
        }

        function removeNodes(ids) {
          const set = new Set(ids);
          for (const k of GM_listValues()) {
            if (k.startsWith(NS + 'n:')) {
              if (set.has(k.slice((NS + 'n:').length))) GM_deleteValue(k);
            } else if (k.startsWith(NS + 'scan:')) {
              // Scan summaries are keyed by node id; drop them with their node so
              // they don't orphan-accumulate as the user prunes the saved list.
              if (set.has(k.slice((NS + 'scan:').length))) GM_deleteValue(k);
            } else if (k.startsWith(NS + 'e:')) {
              const e = safeParse(k);
              if (!e || set.has(e.from) || set.has(e.to)) GM_deleteValue(k);
            }
          }
          bumpRev();
        }

        function removeNode(id) {
          if (!id) return false;
          removeNodes([id]);
          if (isWindowOpen()) scheduleRender(); else refreshButton();
          return true;
        }

        function resetAll() {
          for (const k of GM_listValues()) if (k.startsWith(NS)) GM_deleteValue(k);
          try { localStorage.removeItem(BRIDGE_KEY); } catch (e) {}   // wipe any legacy shared snapshot too
          bumpRev();
        }

        // Store the user's numerical rating for a saved item (whatever number
        // they typed), or clear it when the field is blanked / non-numeric.
        function setRating(id, value) {
          const key = NS + 'n:' + id;
          const raw = GM_getValue(key, null);
          if (!raw) return;
          const rec = JSON.parse(raw);
          const trimmed = String(value == null ? '' : value).trim();
          if (trimmed === '' || !Number.isFinite(Number(trimmed))) {
            delete rec.rating;
          } else {
            rec.rating = Number(trimmed);
          }
          GM_setValue(key, JSON.stringify(rec));
          bumpRev();
        }

        // Cycle the column sort order (name -> date added -> rating -> …).
        function cycleSort() {
          const i = SORT_MODES.indexOf(sortMode);
          sortMode = SORT_MODES[(i + 1) % SORT_MODES.length];
          safeSet(SORT_KEY, sortMode);
          renderGraph();
        }

        // Bulk-add the subreddits from a user scan as saved items, linked from
        // the scanned user so legacy imports can still preserve that relationship.
        function addSubreddits(username, subs, visited) {
          if (!Array.isArray(subs) || !subs.length) return 0;
          const userName = String(username || '').trim();
          const userId = userName ? 'user:' + userName.toLowerCase() : '';
          if (userId) {
            upsertNode({ type: 'user', id: userId, label: 'u/' + userName,
                         url: location.origin + '/user/' + userName }, false);
          }
          let added = 0;
          subs.forEach(s => {
            const name = s && s.name ? String(s.name).trim() : '';
            if (!name) return;
            upsertNode({ type: 'sub', id: 'sub:' + name.toLowerCase(), label: 'r/' + name,
                         url: location.origin + '/r/' + name }, !!visited);
            if (userId) addEdge(userId, 'sub:' + name.toLowerCase());
            added++;
          });
          if (isWindowOpen()) renderGraph(); else refreshButton();
          return added;
        }

        // ------------------------------------------------------------- scan link
        // Scan summaries written by the Stripper scanner, keyed by node id, so
        // hovering a node can show how much media/text was found (or "Unscanned").
        function recordScan(id, summary, node) {
          if (!id || !summary) return;
          if (node) upsertNode(node, true);
          try { GM_setValue(NS + 'scan:' + id, JSON.stringify(summary)); } catch (e) {}
          if (isWindowOpen()) scheduleRender(); else refreshButton();
        }
        function getScan(id) {
          try { const raw = GM_getValue(NS + 'scan:' + id, null); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
        }
        function scanSummaryText(id) {
          const s = getScan(id);
          if (!s) return 'Unscanned';
          return `Scanned: ${s.posts || 0} posts, ${s.files || 0} files `
            + `(${s.images || 0} img / ${s.videos || 0} vid)`;
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
                ...(Number.isFinite(Number(n.rating)) ? { rating: Number(n.rating) } : {}),
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
            const rating = Number.isFinite(Number(cur.rating)) ? Number(cur.rating)
              : (Number.isFinite(Number(n.rating)) ? Number(n.rating) : undefined);
            const ratingChanged = rating !== (Number.isFinite(Number(cur.rating)) ? Number(cur.rating) : undefined);
            if (changed || ratingChanged) {
              const first = Math.min(cur.first || Date.now(), n.first || Date.now());
              const last = Math.max(cur.last || 0, n.last || 0);
              GM_setValue(key, JSON.stringify({ id: cur.id, type: cur.type || n.type, label, url, visited, scraped, first, last,
                ...(rating !== undefined ? { rating } : {}) }));
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
          // Ledger merges are unions in both directions: a post downloaded on
          // either machine stays downloaded, and a history known to either side
          // is kept. Nothing here can un-download something.
          Object.keys(bridge.downloads || {}).forEach(bucket => {
            const incoming = bridge.downloads[bucket];
            if (!Array.isArray(incoming) || !incoming.length) return;
            const key = DL_NS + bucket;
            const existing = safeParse(key);
            const set = new Set(Array.isArray(existing) ? existing.map(normalizePostId) : []);
            const before = set.size;
            incoming.forEach(id => set.add(normalizePostId(id)));
            if (set.size === before) return;
            safeSet(key, JSON.stringify([...set]));
            changes += set.size - before;
          });
          Object.keys(bridge.histories || {}).forEach(name => {
            const incoming = bridge.histories[name];
            if (!incoming || !Array.isArray(incoming.posts) || !incoming.posts.length) return;
            changes += recordUserHistory(incoming.name || name, incoming.posts.map(t => ({
              id: t[0], subreddit: t[1], createdUtc: t[2], hasMedia: t[3] !== 0
            })), { deep: !!incoming.deep });
          });
          downloadedIdCache = null;   // rebuilt lazily; the ledger just moved under it
          return changes;
        }

        // ---------------------------------------------------------- Reddit sync
        // Keep saved users/subreddits and Reddit follows/subscriptions aligned.
        // Existing saved items are joined/followed once; after that, leaving or
        // unfollowing on Reddit removes the saved copy instead of re-adding it.
        function logSync(text) {
          try { logLine(text); } catch (e) {}
        }

        function setFromList(values) {
          return new Set((Array.isArray(values) ? values : [])
            .map(value => String(value || '').trim().toLowerCase())
            .filter(Boolean));
        }

        function remoteSnapshotFromState(state) {
          const remote = state && state.remote ? state.remote : {};
          return {
            sub: setFromList(remote.sub),
            user: setFromList(remote.user)
          };
        }

        function remoteSnapshotToJson(remote) {
          return {
            sub: Array.from(remote.sub || []).sort(),
            user: Array.from(remote.user || []).sort()
          };
        }

        function targetFromSavedNode(n) {
          if (!n || !n.id) return null;
          if (n.type === 'user') {
            const idName = String(n.id || '').replace(/^user:/i, '');
            const labelName = String(n.label || '').replace(/^u\//i, '').replace(/^\/?user\//i, '');
            const name = normalizeRedditUsername(idName || labelName);
            if (!name) return null;
            return {
              kind: 'user',
              key: name,
              srName: `u_${name}`,
              node: { type: 'user', id: `user:${name}`, label: `u/${name}`, url: `${location.origin}/user/${encodeURIComponent(name)}/` }
            };
          }
          if (n.type === 'sub') {
            const idName = String(n.id || '').replace(/^sub:/i, '');
            const labelName = String(n.label || '').replace(/^r\//i, '');
            const name = normalizeSubredditName(idName || labelName);
            if (!name) return null;
            return {
              kind: 'sub',
              key: name,
              srName: name,
              node: { type: 'sub', id: `sub:${name}`, label: `r/${name}`, url: `${location.origin}/r/${encodeURIComponent(name)}/` }
            };
          }
          return null;
        }

        function targetFromSavedId(id) {
          const text = String(id || '').trim();
          if (/^user:/i.test(text)) return targetFromSavedNode({ id: text, type: 'user' });
          if (/^sub:/i.test(text)) return targetFromSavedNode({ id: text, type: 'sub' });
          return null;
        }

        function targetFromRedditSubscription(data) {
          if (!data) return null;
          const display = String(data.display_name || '').trim();
          const prefixed = String(data.display_name_prefixed || '').trim();
          const userName = (() => {
            const candidates = [prefixed, display];
            for (const value of candidates) {
              const text = String(value || '').trim();
              let m = text.match(/^u\/([^/]+)$/i);
              if (m) return m[1];
              m = text.match(/^u_([^/]+)$/i);
              if (m) return m[1];
            }
            return '';
          })();
          if (userName) {
            const name = normalizeRedditUsername(userName);
            if (!name) return null;
            return {
              kind: 'user',
              key: name,
              srName: `u_${name}`,
              node: { type: 'user', id: `user:${name}`, label: `u/${name}`, url: `${location.origin}/user/${encodeURIComponent(name)}/` }
            };
          }
          const name = normalizeSubredditName(display || prefixed);
          if (!name) return null;
          return {
            kind: 'sub',
            key: name,
            srName: name,
            node: { type: 'sub', id: `sub:${name}`, label: `r/${name}`, url: `${location.origin}/r/${encodeURIComponent(name)}/` }
          };
        }

        async function loadRedditSubscriptionTargets() {
          const targets = [];
          const remote = { sub: new Set(), user: new Set() };
          let after = '';
          let pages = 0;
          while (pages < MAX_API_PAGES) {
            pages++;
            const url = new URL('/subreddits/mine/subscriber.json', location.origin);
            url.searchParams.set('limit', '100');
            url.searchParams.set('raw_json', '1');
            if (after) url.searchParams.set('after', after);
            const json = await requestJson(url.href);
            const children = json && json.data && Array.isArray(json.data.children) ? json.data.children : [];
            children.forEach(child => {
              const target = targetFromRedditSubscription(child && child.data);
              if (!target) return;
              const set = remote[target.kind];
              if (set.has(target.key)) return;
              set.add(target.key);
              targets.push(target);
            });
            after = json && json.data ? json.data.after : '';
            if (!after || !children.length) break;
            await delay(REDDIT_SUBSCRIPTION_SYNC_DELAY_MS);
          }
          return { targets, remote };
        }

        async function subscribeRedditTarget(target) {
          await requestRedditForm('/api/subscribe', {
            action: 'sub',
            sr_name: target.srName,
            skip_initial_defaults: 'true',
            api_type: 'json'
          });
        }

        async function unsubscribeRedditTarget(target) {
          await requestRedditForm('/api/subscribe', {
            action: 'unsub',
            sr_name: target.srName,
            api_type: 'json'
          });
        }

        function updateRemoteSnapshotTarget(target, subscribed) {
          if (!target || !target.kind || !target.key) return;
          const state = safeParse(REDDIT_SYNC_STATE_KEY) || {};
          const remote = remoteSnapshotFromState(state);
          if (subscribed) remote[target.kind].add(target.key);
          else remote[target.kind].delete(target.key);
          safeSet(REDDIT_SYNC_STATE_KEY, JSON.stringify({
            ...state,
            ts: Date.now(),
            remote: remoteSnapshotToJson(remote)
          }));
        }

        async function unsubscribeSavedNode(id, label, options) {
          const opts = options || {};
          const target = targetFromSavedId(id);
          if (!target) return;
          const display = label || (target.kind === 'user' ? `u/${target.key}` : `r/${target.key}`);
          try {
            await unsubscribeRedditTarget(target);
            updateRemoteSnapshotTarget(target, false);
            logSync(`Reddit sync: unsubscribed/unfollowed ${display}.`);
          } catch (err) {
            logSync(`Reddit sync could not unsubscribe/unfollow ${display}: ${errorMessage(err)}`);
          }
          await delay(REDDIT_SUBSCRIPTION_SYNC_DELAY_MS);
          if (!opts.skipSync) syncWithReddit({ force: true, reason: 'local-unsave' });
        }

        async function syncWithReddit(options) {
          const opts = options || {};
          const force = !!opts.force;
          if (redditSyncRunning) {
            redditSyncQueuedForce = redditSyncQueuedForce || force;
            return;
          }
          const state = safeParse(REDDIT_SYNC_STATE_KEY);
          const last = state && Number(state.ts) || 0;
          if (!force && last && Date.now() - last < REDDIT_SUBSCRIPTION_SYNC_INTERVAL_MS) return;

          redditSyncRunning = true;
          let imported = 0;
          let pushed = 0;
          let removed = 0;
          let failed = 0;
          try {
            logSync('Syncing saved users/subreddits with Reddit follows/subscriptions...');
            const me = await redditMe().catch(() => null);
            const previousRemote = remoteSnapshotFromState(state);
            const synced = await loadRedditSubscriptionTargets();
            synced.targets.forEach(target => {
              if (hasNode(target.node.id)) return;
              upsertNode(target.node, true);
              imported++;
            });

            const queued = [];
            const queuedKeys = new Set();
            loadGraph().nodes.forEach(n => {
              const target = targetFromSavedNode(n);
              if (!target) return;
              if (target.kind === 'user' && me && me.name && target.key === me.name) return;
              if (synced.remote[target.kind].has(target.key)) return;
              if (previousRemote[target.kind].has(target.key)) {
                removeNodes([target.node.id]);
                removed++;
                return;
              }
              const dedupe = `${target.kind}:${target.key}`;
              if (queuedKeys.has(dedupe)) return;
              queuedKeys.add(dedupe);
              queued.push(target);
            });

            for (const target of queued) {
              try {
                await subscribeRedditTarget(target);
                synced.remote[target.kind].add(target.key);
                pushed++;
              } catch (err) {
                failed++;
                const label = target.kind === 'user' ? `u/${target.key}` : `r/${target.key}`;
                logSync(`Reddit sync could not subscribe to ${label}: ${errorMessage(err)}`);
              }
              await delay(REDDIT_SUBSCRIPTION_SYNC_DELAY_MS);
            }

            safeSet(REDDIT_SYNC_STATE_KEY, JSON.stringify({
              ts: Date.now(),
              imported,
              pushed,
              removed,
              failed,
              remote: remoteSnapshotToJson(synced.remote)
            }));
            if (imported || pushed || removed || failed) {
              logSync(`Reddit sync complete: saved ${imported}, followed/joined ${pushed}, removed ${removed}${failed ? `, ${failed} failed` : ''}.`);
            } else {
              logSync('Reddit sync complete: already in sync.');
            }
            if (isWindowOpen()) renderGraph(); else refreshButton();
          } catch (err) {
            logSync(`Reddit sync skipped: ${errorMessage(err)}`);
          } finally {
            redditSyncRunning = false;
            if (redditSyncQueuedForce) {
              redditSyncQueuedForce = false;
              syncWithReddit({ force: true, reason: 'queued' });
            }
          }
        }

        // ------------------------------------------------------------ export / import
        // Manual only. No background publishing or importing — the saved list
        // lives purely in this install's own GM storage so resetting/deleting
        // actually sticks.
        // Download the saved list as a JSON file — an install-independent backup.
        function exportData() {
          try {
            const g = loadGraph();
            // The ledger goes in the backup as well. An export that carried only
            // the saved list would restore *what* you follow while losing every
            // record of what you had already pulled from it.
            const blob = new Blob([JSON.stringify({ v: 1, ts: Date.now(), nodes: g.nodes, edges: g.edges,
              downloads: exportDownloadLedger(), histories: exportHistories() }, null, 2)],
              { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'rabbithole-saved-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
            try { logLine(`Rabbithole: exported ${g.nodes.length} saved item${g.nodes.length === 1 ? '' : 's'}.`); } catch (e) {}
          } catch (e) {}
        }

        function exportDownloadLedger() {
          const out = {};
          try {
            for (const k of GM_listValues()) {
              if (!k.startsWith(DL_NS)) continue;
              const v = safeParse(k);
              if (Array.isArray(v) && v.length) out[k.slice(DL_NS.length)] = v;
            }
          } catch (e) {}
          return out;
        }

        function exportHistories() {
          const out = {};
          try {
            for (const k of GM_listValues()) {
              if (!k.startsWith(HIST_NS)) continue;
              const v = safeParse(k);
              if (v && Array.isArray(v.posts)) out[k.slice(HIST_NS.length)] = v;
            }
          } catch (e) {}
          return out;
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
            if (changes) syncWithReddit({ force: true, reason: 'import' });
            renderGraph();
          };
          reader.readAsText(file);
        }

        // ---------------------------------------------------------- navigate away
        // Opening a saved item is explicit navigation. The saved list no longer
        // records browsing trails automatically, so these actions only navigate.
        function openNodeCurrentTab(url) {
          if (!url) return;
          location.href = url;
        }
        function openNodeNewTab(url) {
          if (!url) return;
          window.open(url, '_blank', 'noopener');
        }

        // Coalesce bursty re-renders from explicit saved-item edits/imports.
        let renderTimer = null;
        function scheduleRender() {
          if (!isWindowOpen()) { refreshButton(); return; }
          if (renderTimer) clearTimeout(renderTimer);
          renderTimer = setTimeout(() => { renderTimer = null; renderGraph(); }, 400);
        }

        // ------------------------------------------------------------------- UI
        function injectStyle() {
          GM_addStyle(`
            #redditGuestPanel .rg-mapCount{padding:1px 6px;border-radius:999px;font-size:10px;font-weight:800;color:#f2ece1;
              background:linear-gradient(90deg,#ff4500,#ffb000);}
            #redditGuestPanel .rg-mapCount[hidden]{display:none;}
            #redditGuestPanel .rg-main button, #redditGuestPanel .rg-main select{width:auto;}

            #rrm-toolbar{flex:0 0 auto;display:flex;flex-direction:column;gap:14px;padding:10px;
              border-bottom:1px solid rgba(255,255,255,.10);}
            #rrm-toolbar[hidden]{display:none;}
            #rrm-toolbar .rrm-house{display:flex;flex-direction:column;gap:8px;padding-top:14px;
              border-top:1px solid rgba(255,69,0,.14);}
            #rrm-toolbar .rrm-houseRow{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;}
            #redditGuestPanel .rrm-kicker{color:#857a68;font-size:10px;font-weight:900;text-transform:uppercase;
              letter-spacing:.12em;}
            /* Search is the Find control, so it is allowed to be a step larger
               than a filter field: 38px, 13px, 9px radius. */
            #rrm-search{flex:1;min-width:120px;height:38px;padding:0 12px;border-radius:9px;
              border:1px solid rgba(255,255,255,.14);background:#211d19;color:#f2ece1;
              font-family:inherit;font-size:13px;font-weight:700;outline:none;}
            #rrm-search::placeholder{color:#8f806b;}
            #rrm-search:focus{border-color:rgba(255,69,0,.7);box-shadow:0 0 0 2px rgba(255,69,0,.14);}
            #redditGuestPanel .rrm-btn{appearance:none;min-height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.14);
              border-radius:8px;background:rgba(255,255,255,.08);color:#cfc2ae;font-family:inherit;font-size:12px;
              font-weight:700;cursor:pointer;white-space:nowrap;
              transition:background 120ms ease,border-color 120ms ease,opacity 120ms ease;}
            #redditGuestPanel .rrm-btn:hover:not(:disabled){background:rgba(255,69,0,.18);border-color:rgba(255,69,0,.55);
              color:#f2ece1;}
            #redditGuestPanel .rrm-btn:disabled{opacity:.42;cursor:default;}
            #redditGuestPanel .rrm-btn.primary{background:#ff4500;color:#141210;font-weight:900;
              border-color:rgba(255,69,0,.55);}
            #redditGuestPanel .rrm-btn.primary:hover:not(:disabled){background:#ff5c1c;color:#141210;}
            /* Danger is a muted red, never the site accent — the accent means
               "this is the action", not "this removes something". */
            #redditGuestPanel .rrm-btn.danger{background:rgba(163,68,58,.18);border-color:rgba(163,68,58,.55);
              color:#d8a49c;}
            #redditGuestPanel .rrm-btn.danger:hover:not(:disabled){background:rgba(163,68,58,.3);
              border-color:rgba(163,68,58,.75);color:#f2ece1;}
            #redditGuestPanel .rrm-btn.icon{padding:0;width:28px;}
            #rrm-blocked-panel{flex:0 0 auto;display:flex;flex-direction:column;gap:5px;padding:8px 10px;
              border-bottom:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.16);}
            #rrm-blocked-panel[hidden]{display:none;}
            #redditGuestPanel #rgMain[data-rrm-view="blocked"] #rrm-blocked-panel{flex:1 1 auto;overflow:auto;
              border-bottom:0;background:transparent;padding:10px;}
            #rrm-blocked-panel .rrm-blocked-empty{color:#8f806b;font-size:11px;padding:2px 0;}
            #rrm-blocked-panel .rrm-blocked-row{display:flex;align-items:center;gap:6px;}
            #rrm-blocked-panel .rrm-blocked-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
              color:#f2ece1;font-size:12px;font-weight:700;}
            #redditGuestPanel #rrm-blocked-panel .rrm-blocked-action{flex:0 0 auto;width:auto;min-height:26px;padding:0 9px;
              font-size:11px;background:rgba(255,255,255,.09);}
            #redditGuestPanel #rrm-blocked-panel .rrm-blocked-action.rm{background:rgba(255,69,0,.16);border-color:rgba(255,69,0,.5);}
            #rrm-foot{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:8px 11px;
              border-top:1px solid rgba(255,255,255,.10);font-size:11px;color:#bdb1a0;}
            /* Export/Import/Reset act on the saved list. On the map they are only
               a band of height taken off the thing you came here to look at. */
            #redditGuestPanel #rgMain[data-rrm-view="graph"] #rrm-toolbar .rrm-house{display:none;}
            #redditGuestPanel #rgMain[data-rrm-view="graph"] #rrm-toolbar{gap:0;padding:10px;}
            #redditGuestPanel #rgMain[data-rrm-view="queue"] .rrm-legend,
            #redditGuestPanel #rgMain[data-rrm-view="graph"] .rrm-legend,
            #redditGuestPanel #rgMain[data-rrm-view="blocked"] .rrm-legend{display:none;}
            #rrm-foot .rrm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px;}
            #rrm-count{color:#cfc2ae;font-weight:700;}
            #redditGuestPanel .rrm-select{height:28px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.16);
              background:rgba(0,0,0,.22);color:#f2ece1;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;outline:none;}
            #redditGuestPanel .rrm-select:focus{border-color:rgba(255,176,0,.72);}
            #redditGuestPanel .rrm-btn.active{background:#ff4500;}
            #rrm-columns{flex:1;min-height:0;display:none;gap:10px;padding:10px;overflow:auto;}
            #rrm-columns .rrm-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;overflow:hidden;
              border:1px solid rgba(255,255,255,.10);border-radius:10px;background:rgba(255,255,255,.03);}
            #rrm-columns .rrm-col-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;
              padding:8px 10px;font-weight:800;font-size:12px;
              border-bottom:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);}
            #rrm-columns .rrm-col-head-left{flex:0 0 auto;}
            #rrm-columns .rrm-col-count{opacity:.7;}
            #redditGuestPanel #rrm-columns .rrm-col-ctl{flex:0 0 auto;cursor:pointer;font-size:10px;font-weight:700;
              color:#cfc2ae;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);
              border-radius:999px;padding:2px 9px;user-select:none;white-space:nowrap;
              transition:background 120ms ease,color 120ms ease,border-color 120ms ease;}
            #redditGuestPanel #rrm-columns .rrm-col-ctl:hover{background:rgba(255,255,255,.18);color:#f2ece1;
              border-color:rgba(255,255,255,.3);}
            #redditGuestPanel #rrm-columns .rrm-row-rating{flex:0 0 auto;box-sizing:border-box;width:46px;height:28px;
              padding:0 4px;text-align:center;border-radius:7px;border:1px solid rgba(255,255,255,.14);
              background:#211d19;color:#f2ece1;font-family:inherit;font-size:11px;font-weight:700;outline:none;}
            #redditGuestPanel #rrm-columns .rrm-row-rating::placeholder{color:#8f806b;}
            #redditGuestPanel #rrm-columns .rrm-row-rating:focus{border-color:rgba(255,69,0,.7);
              box-shadow:0 0 0 2px rgba(255,69,0,.14);}
            #rrm-columns .rrm-col-list{flex:1;min-height:0;overflow:auto;padding:6px;display:flex;flex-direction:column;
              gap:4px;scrollbar-width:thin;}
            #rrm-columns .rrm-col-empty{padding:8px 6px;color:#857a68;font-size:11px;}
            #rrm-columns .rrm-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:7px;}
            #rrm-columns .rrm-row:hover{background:rgba(255,255,255,.06);}
            #rrm-columns .rrm-row-link{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
              color:#f2ece1;text-decoration:none;font-size:12px;font-weight:600;cursor:pointer;}
            #rrm-columns .rrm-row-link:hover{color:#f2ece1;text-decoration:underline;}
            #rrm-columns .rrm-row-link.unvisited{color:#8f806b;}
            #rrm-columns .rrm-row.done{opacity:.55;}
            #rrm-columns .rrm-row.done .rrm-row-link{text-decoration:none;color:#857a68;}
            #rrm-columns .rrm-row-badge{flex:0 0 auto;box-sizing:border-box;min-width:44px;text-align:center;
              padding:2px 6px;border-radius:999px;font-size:9px;font-weight:900;letter-spacing:.02em;
              border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#bdb1a0;}
            #rrm-columns .rrm-row-badge.ok{color:#8fbf8a;border-color:rgba(143,191,138,.4);background:rgba(143,191,138,.12);}
            #rrm-columns .rrm-row-badge.pending{color:#ffb28a;border-color:rgba(255,69,0,.42);background:rgba(255,69,0,.16);}
            #rrm-columns .rrm-row-badge.unknown{color:#857a68;}
            #rrm-columns .rrm-row-badge.blank{visibility:hidden;min-width:0;width:0;padding:0;border:0;}
            #redditGuestPanel #rrm-columns .rrm-row-btn{flex:0 0 auto;box-sizing:border-box;
              width:28px;height:28px;min-width:28px;min-height:0;aspect-ratio:1/1;padding:0;border-radius:9px;
              display:inline-flex;align-items:center;justify-content:center;line-height:1;
              border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#cfc2ae;
              font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;}
            #rrm-columns .rrm-row-btn:hover{background:rgba(255,69,0,.18);border-color:rgba(255,69,0,.55);color:#f2ece1;}
            #redditGuestPanel #rrm-columns .rrm-row-btn:disabled{opacity:.42;cursor:default;}
            #redditGuestPanel #rrm-columns .rrm-row-btn:disabled:hover{background:rgba(255,255,255,.08);
              border-color:rgba(255,255,255,.14);color:#cfc2ae;}
            /* Armed. Loud on purpose, and in the danger red rather than the
               accent: the accent means "this is the action", not "this destroys
               something". */
            #redditGuestPanel #rrm-columns .rrm-row-btn.armed,
            #redditGuestPanel #rrm-columns .rrm-row-btn.armed:hover{background:rgba(163,68,58,.85);
              border-color:#d8a49c;color:#f2ece1;font-weight:900;}
            #rrm-columns .rrm-row.arming{background:rgba(163,68,58,.16);
              box-shadow:inset 0 0 0 1px rgba(163,68,58,.55);}
            #rrm-columns .rrm-row.arming .rrm-row-link{color:#f2ece1;}
            #rrm-columns .rrm-row-btn.rm:hover{background:rgba(163,68,58,.3);border-color:rgba(163,68,58,.75);}

            #rrm-queue{flex:1;min-height:0;display:none;flex-direction:column;gap:8px;padding:10px;overflow:auto;}
            #rrm-queue .rrm-q-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;}
            #rrm-queue .rrm-q-summary{flex:1;min-width:0;color:#bdb1a0;font-size:11px;font-weight:700;line-height:1.35;}
            #redditGuestPanel #rrm-queue .rrm-q-refresh{flex:0 0 auto;width:auto;min-height:32px;padding:0 12px;
              border-radius:8px;border:1px solid rgba(255,255,255,.16);background:#ff4500;color:#141210;
              font-family:inherit;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap;}
            #redditGuestPanel #rrm-queue .rrm-q-refresh.busy{background:#4a3323;color:#f2ece1;
              border-color:rgba(255,69,0,.55);}
            #rrm-queue .rrm-q-kicker{flex:0 0 auto;margin-top:4px;color:#857a68;font-size:10px;font-weight:900;
              text-transform:uppercase;letter-spacing:.12em;}
            #rrm-queue .rrm-q-list{flex:0 0 auto;display:flex;flex-direction:column;gap:4px;}
            #rrm-queue .rrm-q-row{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:5px 6px;
              border-radius:8px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);}
            #rrm-queue .rrm-q-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
              color:#f2ece1;font-size:12px;font-weight:700;text-decoration:none;cursor:pointer;}
            #rrm-queue .rrm-q-name:hover{text-decoration:underline;}
            #rrm-queue .rrm-q-count{flex:0 0 auto;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:900;
              border:1px solid rgba(255,69,0,.42);background:rgba(255,69,0,.16);color:#ffb28a;}
            #rrm-queue .rrm-q-count.unknown{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.06);
              color:#857a68;}
            #redditGuestPanel #rrm-queue .rrm-q-open{flex:0 0 auto;box-sizing:border-box;width:28px;height:28px;
              min-height:0;padding:0;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;
              border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#cfc2ae;
              font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;}
            #redditGuestPanel #rrm-queue .rrm-q-open:hover{background:rgba(255,69,0,.18);border-color:rgba(255,69,0,.55);}
            #redditGuestPanel #rrm-queue .rrm-q-open:disabled{opacity:.42;cursor:default;}
            #redditGuestPanel #rrm-queue .rrm-q-open:disabled:hover{background:rgba(255,255,255,.08);
              border-color:rgba(255,255,255,.14);color:#cfc2ae;}
            /* The row being checked reads as busy without moving anything. */
            #rrm-queue .rrm-q-row.checking{border-color:rgba(255,69,0,.4);background:rgba(255,69,0,.08);}
            #redditGuestPanel #rrm-queue .rrm-q-row.checking .rrm-q-recheck{opacity:1;color:#ffb28a;
              border-color:rgba(255,69,0,.55);background:rgba(255,69,0,.16);}
            #redditGuestPanel #rrm-queue .rrm-q-refresh:disabled{opacity:.42;cursor:default;}
            #rrm-queue .rrm-q-empty{color:#857a68;font-size:11px;font-weight:700;padding:2px 0;line-height:1.45;}
            #redditGuestPanel .rg-tabCount{display:inline-block;margin-left:5px;padding:0 5px;border-radius:999px;
              background:rgba(0,0,0,.32);color:inherit;font-size:9px;font-weight:900;vertical-align:1px;}
            #redditGuestPanel .rg-tabCount[hidden]{display:none;}

            #rrm-graph{flex:1;min-height:0;position:relative;display:none;overflow:hidden;
              background:radial-gradient(circle at 50% 42%,rgba(255,69,0,.07),transparent 68%),rgba(0,0,0,.18);}
            #rrm-graph .rrm-g-svg{display:block;width:100%;height:100%;cursor:grab;touch-action:none;
              user-select:none;-webkit-user-select:none;}
            #rrm-graph .rrm-g-svg.panning{cursor:grabbing;}
            /* The links are the content of this view now, not background
               texture, so they are drawn to be read. Width comes from the weight
               set per line, which is why no width is declared here. */
            #rrm-graph .rrm-g-edge{stroke:rgba(226,214,196,.3);}
            #rrm-graph .rrm-g-node{cursor:pointer;}
            #rrm-graph .rrm-g-node circle{stroke:rgba(0,0,0,.6);stroke-width:1.5;
              transition:stroke 120ms ease,stroke-width 120ms ease;}
            /* Names are always on. The map is for reading who sits where, and a
               label you have to hover for is a label you cannot compare against
               its neighbours. */
            #rrm-graph .rrm-g-node text{fill:#e6ddcf;font-family:inherit;font-size:9.5px;font-weight:700;
              text-anchor:middle;paint-order:stroke;stroke:rgba(10,8,6,.85);stroke-width:3px;stroke-linejoin:round;
              pointer-events:none;}
            #rrm-graph .rrm-g-node.sub text{fill:#bcd2ef;}
            #rrm-graph .rrm-g-node.user text{fill:#f2c9bd;}
            /* A subreddit nobody has followed is drawn hollow: it is somewhere
               your users go, not somewhere you have signed up for. */
            #rrm-graph .rrm-g-node.unsaved circle{fill-opacity:.22;stroke:rgba(79,156,249,.55);}
            #rrm-graph .rrm-g-node.unsaved text{fill:#8fa3bd;}
            /* Nothing left to get. Still on the map, just no longer interesting. */
            #rrm-graph .rrm-g-node.finished text{fill:#857a68;}
            #rrm-graph .rrm-g-node.finished circle{stroke:rgba(255,255,255,.18);}
            #rrm-graph .rrm-g-node.dim{opacity:.14;}
            #rrm-graph .rrm-g-node.hit circle{stroke:#ff4500;stroke-width:2.5;}
            #rrm-graph .rrm-g-node.hover circle{stroke:#fff;stroke-width:2.5;}
            /* The picker sits over the map rather than beside it: the map is the
               thing you came for, and a panel in the layout would take width from
               it permanently instead of only while it is open. */
            #rrm-graph .rrm-g-picker{position:absolute;right:10px;top:8px;z-index:2;width:212px;
              display:flex;flex-direction:column;border-radius:10px;overflow:hidden;
              border:1px solid rgba(255,69,0,.22);background:rgba(20,18,16,.94);}
            #redditGuestPanel #rrm-graph .rrm-g-pickerHead{display:flex;align-items:center;gap:6px;width:100%;
              min-height:30px;padding:0 9px;border:0;border-radius:0;background:rgba(255,255,255,.05);
              color:#cfc2ae;font-family:inherit;font-size:11px;font-weight:900;text-align:left;cursor:pointer;}
            #redditGuestPanel #rrm-graph .rrm-g-pickerHead:hover{background:rgba(255,69,0,.18);color:#f2ece1;
              border:0;}
            #rrm-graph .rrm-g-pickerChev{flex:0 0 auto;font-size:9px;color:#857a68;}
            #rrm-graph .rrm-g-pickerTitle{flex:1;min-width:0;text-transform:uppercase;letter-spacing:.08em;}
            #rrm-graph .rrm-g-pickerCount{flex:0 0 auto;padding:1px 6px;border-radius:999px;font-size:9px;
              font-weight:900;background:rgba(255,255,255,.08);color:#bdb1a0;}
            #rrm-graph .rrm-g-pickerBody{display:none;flex-direction:column;gap:6px;padding:8px;
              border-top:1px solid rgba(255,69,0,.14);}
            #rrm-graph .rrm-g-picker.is-open .rrm-g-pickerBody{display:flex;}
            #redditGuestPanel #rrm-graph .rrm-g-pickerFilter{flex:0 0 auto;height:28px;padding:0 8px;
              border-radius:7px;border:1px solid rgba(255,255,255,.14);background:#211d19;color:#f2ece1;
              font-family:inherit;font-size:11px;font-weight:700;outline:none;}
            #rrm-graph .rrm-g-pickerFilter::placeholder{color:#8f806b;}
            #rrm-graph .rrm-g-pickerFilter:focus{border-color:rgba(255,69,0,.7);
              box-shadow:0 0 0 2px rgba(255,69,0,.14);}
            /* The list scrolls; it never shrinks its rows to fit. */
            #rrm-graph .rrm-g-pickerList{flex:1 1 auto;max-height:230px;overflow-y:auto;overflow-x:hidden;
              display:flex;flex-direction:column;gap:2px;scrollbar-width:thin;}
            #redditGuestPanel #rrm-graph .rrm-g-pickerRow{flex:0 0 auto;display:flex;align-items:center;gap:7px;
              width:100%;min-height:24px;padding:0 6px;border:0;border-radius:7px;background:transparent;
              color:#bdb1a0;font-family:inherit;font-size:11px;font-weight:700;text-align:left;cursor:pointer;}
            #redditGuestPanel #rrm-graph .rrm-g-pickerRow:hover{background:rgba(255,255,255,.07);color:#f2ece1;
              border:0;}
            #rrm-graph .rrm-g-pickerBox{flex:0 0 auto;width:12px;height:12px;border-radius:3px;
              border:1px solid rgba(255,255,255,.28);background:transparent;}
            #rrm-graph .rrm-g-pickerRow.is-on .rrm-g-pickerBox{background:#ff4500;border-color:#ff4500;}
            #rrm-graph .rrm-g-pickerRow.is-on{color:#f2ece1;}
            #rrm-graph .rrm-g-pickerName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;}
            #rrm-graph .rrm-g-pickerNum{flex:0 0 auto;color:#857a68;font-size:9px;font-weight:900;}
            #rrm-graph .rrm-g-pickerEmpty{padding:4px 6px;color:#857a68;font-size:10px;font-weight:700;}

            #rrm-graph .rrm-g-legend{position:absolute;left:11px;top:9px;right:232px;display:flex;flex-wrap:wrap;gap:4px 10px;
              color:#857a68;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;
              pointer-events:none;}
            #rrm-graph .rrm-g-legend span{display:inline-flex;align-items:center;gap:4px;}
            #rrm-graph .rrm-g-key{width:8px;height:8px;border-radius:50%;display:inline-block;}
            #rrm-graph .rrm-g-key.user{background:#f97362;}
            #rrm-graph .rrm-g-key.userdone{background:#6d6357;}
            #rrm-graph .rrm-g-key.sub{background:#4f9cf9;}
            #rrm-graph .rrm-g-key.subnew{background:rgba(79,156,249,.22);box-shadow:inset 0 0 0 1px rgba(79,156,249,.55);}
            #rrm-graph .rrm-g-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
              padding:24px;color:#857a68;font-size:12px;font-weight:700;text-align:center;line-height:1.5;}
            #rrm-graph .rrm-g-hint{position:absolute;left:11px;right:11px;bottom:44px;color:#857a68;font-size:10px;
              font-weight:700;pointer-events:none;text-align:center;}
            #rrm-graph .rrm-g-jump{position:absolute;left:11px;right:11px;bottom:8px;z-index:2;
              display:flex;justify-content:center;gap:6px;}
            #redditGuestPanel #rrm-graph .rrm-g-jumpBtn{flex:0 1 auto;width:auto;min-height:28px;padding:0 12px;
              border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(20,18,16,.94);
              color:#cfc2ae;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;
              overflow:hidden;text-overflow:ellipsis;}
            #redditGuestPanel #rrm-graph .rrm-g-jumpBtn:hover:not(:disabled){background:rgba(255,69,0,.18);
              border-color:rgba(255,69,0,.55);color:#f2ece1;}
            #redditGuestPanel #rrm-graph .rrm-g-jumpBtn:disabled{opacity:.42;cursor:default;}
          `);
        }

        // Build the saved-items UI inside the main body of the unified Stripper
        // window. `win` is the whole window element used for visibility checks.
        function mount(container, win) {
          if (!container) return;
          winEl = win;
          container.innerHTML = `
            <div id="rrm-toolbar">
              <input id="rrm-search" type="text" placeholder="Filter saved items…" autocomplete="off" spellcheck="false">
              <div class="rrm-house">
                <span class="rrm-kicker">Housekeeping</span>
                <div class="rrm-houseRow">
                  <button class="rrm-btn" data-act="export" title="Download the saved list as a JSON backup">Export</button>
                  <button class="rrm-btn" data-act="import" title="Merge a previously exported JSON file">Import</button>
                  <button class="rrm-btn danger" data-act="reset">Reset</button>
                </div>
              </div>
              <input id="rrm-file" type="file" accept="application/json,.json" hidden>
            </div>
            <div id="rrm-blocked-panel" hidden></div>
            <div id="rrm-columns"></div>
            <div id="rrm-queue"></div>
            <div id="rrm-graph"></div>
            <div id="rrm-foot">
              <span class="rrm-legend"><span class="rrm-dot" style="background:${COLORS.sub}"></span>subreddit</span>
              <span class="rrm-legend"><span class="rrm-dot" style="background:${COLORS.user}"></span>user</span>
              <span class="rrm-legend"><span class="rrm-dot" style="background:${COLORS.post}"></span>post</span>
              <span class="rrm-legend" style="opacity:.7">dim = every post downloaded</span>
              <span style="flex:1"></span>
              <span id="rrm-count"></span>
            </div>`;

          // Anything else you click is a change of mind. Capture phase so it is
          // seen no matter which control was hit.
          container.addEventListener('click', evt => {
            if (!ledgerResetArmedId) return;
            const btn = evt.target && evt.target.closest ? evt.target.closest('.rrm-row-reset') : null;
            if (btn && btn.dataset.nodeId === ledgerResetArmedId) return;
            disarmLedgerReset();
          }, true);

          const search = container.querySelector('#rrm-search');
          search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderGraph(); });

          container.querySelector('[data-act="reset"]').onclick = async () => {
            if (confirm('Erase the entire saved list and unsubscribe/unfollow saved users and subreddits on Reddit?')) {
              const savedIds = loadGraph().nodes
                .filter(n => n && (n.type === 'user' || n.type === 'sub'))
                .map(n => ({ id: n.id, label: (n.label || '').replace(/\n/g, ' ') }));
              resetAll();
              renderGraph();
              for (const saved of savedIds) {
                await unsubscribeSavedNode(saved.id, saved.label, { skipSync: true });
              }
              syncWithReddit({ force: true, reason: 'reset' });
            }
          };
          const fileInput = container.querySelector('#rrm-file');
          container.querySelector('[data-act="export"]').onclick = exportData;
          container.querySelector('[data-act="import"]').onclick = () => fileInput.click();
          fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files[0]) importDataFromFile(fileInput.files[0]);
            fileInput.value = '';
          });

          renderGraph();
        }

        function renderBlockedPanel() {
          if (!winEl) return;
          const panel = winEl.querySelector('#rrm-blocked-panel');
          if (!panel || (view !== 'blocked' && panel.hidden)) return;
          const blocked = [...loadStripperBlockedUsers()].sort((a, b) => a.localeCompare(b));
          panel.innerHTML = '';
          if (!blocked.length) {
            const empty = document.createElement('div');
            empty.className = 'rrm-blocked-empty';
            empty.textContent = 'No blocked profiles';
            panel.appendChild(empty);
            return;
          }
          blocked.forEach(name => {
            const row = document.createElement('div');
            row.className = 'rrm-blocked-row';

            const label = document.createElement('span');
            label.className = 'rrm-blocked-name';
            label.textContent = `u/${name}`;

            const open = document.createElement('button');
            open.className = 'rrm-blocked-action';
            open.type = 'button';
            open.textContent = 'Open';
            open.addEventListener('click', () => openNodeNewTab(`https://www.reddit.com/user/${encodeURIComponent(name)}/`));

            const unblock = document.createElement('button');
            unblock.className = 'rrm-blocked-action rm';
            unblock.type = 'button';
            unblock.textContent = 'Unblock';
            unblock.addEventListener('click', () => {
              const users = loadStripperBlockedUsers();
              users.delete(name);
              saveStripperBlockedUsers(users);
              filterBlockedProfilePosts();
              syncUi();
              renderBlockedPanel();
            });

            row.appendChild(label);
            row.appendChild(open);
            row.appendChild(unblock);
            panel.appendChild(row);
          });
        }

        function setView(next) {
          // Leaving the list is a change of mind too, and an armed button must
          // never survive out of sight of the row it belongs to.
          disarmLedgerReset(false);
          view = ['blocked', 'graph', 'queue'].includes(next) ? next : 'columns';
          // The settle loop is the one thing here that costs anything while it is
          // not on screen, so leaving the tab stops it.
          if (view !== 'graph') stopGraphSim();
          renderGraph();
        }

        // search-text + type-dropdown filter
        function getVisible(nodes) {
          return nodes.filter(n => {
            if (typeFilter !== 'all' && n.type !== typeFilter) return false;
            if (query && !((n.label || '').toLowerCase().includes(query) || (n.url || '').toLowerCase().includes(query))) return false;
            return true;
          });
        }

        // re-render entry point
        function renderGraph() {
          refreshButton();
          if (!winEl) return;
          const main = winEl.querySelector('#rgMain');
          if (main) main.setAttribute('data-rrm-view', view);
          const toolbar = winEl.querySelector('#rrm-toolbar');
          // The Queue has its own controls and its own idea of what a refresh is,
          // so the saved-list toolbar would only be a second, wronger one.
          if (toolbar) toolbar.hidden = view === 'blocked' || view === 'queue';
          const colsEl = winEl.querySelector('#rrm-columns');
          const graphEl = winEl.querySelector('#rrm-graph');
          const queueEl = winEl.querySelector('#rrm-queue');
          const blockedEl = winEl.querySelector('#rrm-blocked-panel');
          if (colsEl) colsEl.style.display = view === 'columns' ? 'flex' : 'none';
          if (graphEl) graphEl.style.display = view === 'graph' ? 'block' : 'none';
          if (queueEl) queueEl.style.display = view === 'queue' ? 'flex' : 'none';
          if (blockedEl) blockedEl.hidden = view !== 'blocked';

          const g = loadGraph();
          const visible = getVisible(g.nodes);

          if (view === 'blocked') renderBlockedPanel();
          else if (view === 'queue') renderQueuePanel();
          else if (view === 'graph') renderGraphView();
          else renderColumns(g.nodes);
          syncQueueTabCount();

          const c = winEl.querySelector('#rrm-count');
          if (c) {
            if (view === 'blocked') {
              const total = loadStripperBlockedUsers().size;
              c.textContent = `${total} blocked`;
            } else {
              const total = g.nodes.length;
              const filtered = !!(query || typeFilter !== 'all');
              const base = filtered ? `${visible.length} / ${total} saved` : `${total} saved`;
              const pending = queuePendingUserCount();
              // The map's links are derived from the histories, so the stored
              // edge count is not what is on screen and must not be reported.
              const drawn = graphBuilt.links.length;
              c.textContent = view === 'graph'
                ? `${graphBuilt.nodes.length} on the map · ${drawn} link${drawn === 1 ? '' : 's'}`
                : view === 'queue'
                  ? `${pending} user${pending === 1 ? '' : 's'} waiting`
                  : base;
            }
          }
        }

        // A single full-width column listing the saved nodes of one type
        // (subreddits / users / posts). The strip's saved sub-switcher picks
        // `columnType`; the search box narrows it further.
        function renderColumns(allNodes) {
          const colsEl = winEl.querySelector('#rrm-columns');
          if (!colsEl) return;
          // Remember the column's scroll position so rebuilding (e.g. after a
          // delete) doesn't jump you back to the top while clearing items out.
          const prevList = colsEl.querySelector('.rrm-col-list');
          const prevScroll = prevList ? prevList.scrollTop : 0;
          const titles = { sub: 'Subreddits', user: 'Users', post: 'Posts' };
          const type = columnType;
          const q = query;
          const matchQuery = n => !q
            || (n.label || '').toLowerCase().includes(q)
            || (n.url || '').toLowerCase().includes(q);
          const byName = (a, b) => (a.label || '').localeCompare(b.label || '');
          const list = allNodes
            .filter(n => n.type === type && matchQuery(n))
            .sort((a, b) => {
              if (sortMode === 'added') {
                // Most recently added first; fall back to name for ties.
                return (b.first || 0) - (a.first || 0) || byName(a, b);
              }
              if (sortMode === 'rating') {
                // Highest rating first; unrated items sink to the bottom.
                const ra = Number.isFinite(Number(a.rating)) ? Number(a.rating) : -Infinity;
                const rb = Number.isFinite(Number(b.rating)) ? Number(b.rating) : -Infinity;
                return rb - ra || byName(a, b);
              }
              return byName(a, b);
            });
          colsEl.innerHTML = '';
          const col = document.createElement('div');
          col.className = 'rrm-col';
          col.dataset.type = type;
          const head = document.createElement('div');
          head.className = 'rrm-col-head';
          head.style.color = COLORS[type];
          const headLeft = document.createElement('span');
          headLeft.className = 'rrm-col-head-left';
          headLeft.innerHTML = `<span class="rrm-dot" style="background:${COLORS[type]}"></span>${titles[type]} `
            + `<span class="rrm-col-count">${list.length}</span>`;
          const sortBtn = document.createElement('span');
          sortBtn.className = 'rrm-col-ctl rrm-col-sort';
          sortBtn.textContent = `Sort: ${SORT_LABELS[sortMode]}`;
          sortBtn.title = 'Click to cycle the sort order (name / date added / rating)';
          sortBtn.addEventListener('click', cycleSort);
          const headSpacer = document.createElement('span');
          headSpacer.style.flex = '1';
          head.appendChild(headLeft);
          head.appendChild(headSpacer);
          head.appendChild(sortBtn);
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
          listEl.scrollTop = prevScroll;   // restore scroll
        }

        // Switch which node type the Saved view shows.
        function setColumnType(type) {
          columnType = (type === 'sub' || type === 'post') ? type : 'user';
          if (view === 'columns') renderGraph();
        }

        // Resetting a user's ledger throws away a record that cannot be rebuilt
        // without re-downloading, so it takes two deliberate presses. Three
        // things stop the second one being an accident rather than a decision:
        // a dead time that a double-click cannot outrun, an expiry so a forgotten
        // armed button does not sit waiting for a stray click, and a click
        // anywhere else disarming it.
        const LEDGER_RESET_ARM_MS = 5000;
        const LEDGER_RESET_DEAD_MS = 450;
        let ledgerResetArmedId = '';
        let ledgerResetArmedAt = 0;
        let ledgerResetTimer = null;

        function disarmLedgerReset(rerender) {
          if (ledgerResetTimer) { clearTimeout(ledgerResetTimer); ledgerResetTimer = null; }
          if (!ledgerResetArmedId) return;
          ledgerResetArmedId = '';
          ledgerResetArmedAt = 0;
          // Redraw once the current click has finished dispatching. Rebuilding
          // the rows mid-dispatch would detach the very button being clicked,
          // before its own handler had run.
          if (rerender !== false) setTimeout(() => renderGraph(), 0);
        }

        function armLedgerReset(id) {
          if (ledgerResetTimer) clearTimeout(ledgerResetTimer);
          ledgerResetArmedId = id;
          ledgerResetArmedAt = Date.now();
          ledgerResetTimer = setTimeout(() => {
            ledgerResetTimer = null;
            disarmLedgerReset();
          }, LEDGER_RESET_ARM_MS);
          renderGraph();
        }

        function buildLedgerResetButton(n, progress) {
          const armed = ledgerResetArmedId === n.id;
          const name = userNameFromNode(n);
          const has = !!(progress && progress.downloaded > 0);
          const btn = document.createElement('button');
          btn.className = 'rrm-row-btn rrm-row-reset' + (armed ? ' armed' : '');
          btn.type = 'button';
          btn.dataset.nodeId = n.id;
          btn.textContent = armed ? '!' : '\u21ba';
          btn.disabled = !has;
          btn.title = !has
            ? 'Nothing recorded as downloaded for this user'
            : armed
              ? `Press again to forget all ${progress.downloaded} downloaded post${progress.downloaded === 1 ? '' : 's'} for u/${name}`
              : `Forget what has been downloaded from u/${name} (needs a second press)`;
          btn.addEventListener('click', () => {
            if (!has) return;
            if (ledgerResetArmedId !== n.id) { armLedgerReset(n.id); return; }
            // A press this soon after arming is a double-click, not an answer.
            if (Date.now() - ledgerResetArmedAt < LEDGER_RESET_DEAD_MS) return;
            const cleared = resetUserDownloads(name);
            disarmLedgerReset(false);
            try {
              logLine(cleared
                ? `Reset u/${name}: ${cleared} post${cleared === 1 ? '' : 's'} no longer counted as downloaded.`
                : `u/${name} had nothing recorded as downloaded.`);
            } catch (e) {}
            renderGraph();
            filterBlockedProfilePosts();
          });
          return btn;
        }

        function buildColumnRow(n) {
          const row = document.createElement('div');
          // "Done" is now derived from the ledger, never ticked by hand: a user
          // is finished when every post of theirs that has media is downloaded.
          const progress = n.type === 'user' ? userDownloadProgress(userNameFromNode(n)) : null;
          const finished = !!(progress && progress.known && progress.media > 0 && progress.pending === 0);
          const arming = ledgerResetArmedId === n.id;
          row.className = 'rrm-row' + (finished ? ' done' : '') + (arming ? ' arming' : '');

          const badge = document.createElement('span');
          badge.className = 'rrm-row-badge';
          if (progress && progress.known) {
            badge.textContent = `${progress.downloaded}/${progress.media}`;
            badge.classList.add(finished ? 'ok' : (progress.pending ? 'pending' : 'ok'));
            badge.title = progress.pending
              ? `${progress.pending} post${progress.pending === 1 ? '' : 's'} not downloaded yet`
              : 'Everything downloaded';
          } else if (n.type === 'user') {
            badge.textContent = '?';
            badge.classList.add('unknown');
            badge.title = 'Never scanned — refresh in the Queue tab to find out what is here';
          } else {
            badge.classList.add('blank');
          }

          const link = document.createElement('a');
          link.className = 'rrm-row-link' + (n.visited ? '' : ' unvisited');
          link.href = n.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = (n.label || '').replace(/\n/g, ' ');
          link.title = n.url + (n.visited ? '' : '  (not visited)') + '\n' + scanSummaryText(n.id);
          link.addEventListener('click', (e) => { e.preventDefault(); openNodeCurrentTab(n.url); });

          const rating = document.createElement('input');
          rating.type = 'text';
          rating.className = 'rrm-row-rating';
          rating.inputMode = 'decimal';
          rating.placeholder = '–';
          rating.title = 'Your rating (type any number)';
          if (Number.isFinite(Number(n.rating))) rating.value = String(n.rating);
          // Don't let a click on the field bubble up to the row/link handlers.
          rating.addEventListener('click', (e) => e.stopPropagation());
          rating.addEventListener('change', () => {
            setRating(n.id, rating.value);
            // Re-sort if the rating order is active; otherwise leave the list put.
            if (sortMode === 'rating') renderGraph();
          });

          const openCur = document.createElement('button');
          openCur.className = 'rrm-row-btn';
          openCur.textContent = '↗';
          openCur.title = 'Open in new tab';
          openCur.addEventListener('click', () => openNodeNewTab(n.url));

          const rm = document.createElement('button');
          rm.className = 'rrm-row-btn rm';
          rm.textContent = '×';
          rm.title = 'Remove node';
          rm.addEventListener('click', async () => {
            removeNodes([n.id]);
            renderGraph();
            if (n.type === 'user' || n.type === 'sub') {
              await unsubscribeSavedNode(n.id, (n.label || '').replace(/\n/g, ' '));
            }
          });

          row.appendChild(badge);
          row.appendChild(link);
          if (n.type === 'user') row.appendChild(buildLedgerResetButton(n, progress));
          row.appendChild(rating);
          row.appendChild(openCur);
          row.appendChild(rm);
          return row;
        }



        // ------------------------------------------------------------ the queue
        // Who has posted something you have not pulled yet. This is the whole
        // reason the ledger exists: come back to the site, open one tab, and see
        // which saved users have added things since last time.
        function queueEntries() {
          return savedUserNodes()
            .map(n => {
              const name = userNameFromNode(n);
              return name ? { node: n, name, progress: userDownloadProgress(name) } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.progress.pending - a.progress.pending || a.name.localeCompare(b.name));
        }

        function queuePendingUserCount() {
          return queueEntries().filter(e => e.progress.known && e.progress.pending > 0).length;
        }

        function buildQueueRow(entry) {
          const busy = typeof queueRefreshBusy === 'function' && queueRefreshBusy();
          const checkingThis = typeof queueRefreshingUser === 'function'
            && queueRefreshingUser() === entry.name;
          const row = document.createElement('div');
          row.className = 'rrm-q-row' + (checkingThis ? ' checking' : '');

          const count = document.createElement('span');
          count.className = 'rrm-q-count' + (entry.progress.known ? '' : ' unknown');
          if (entry.progress.known) {
            count.textContent = String(entry.progress.pending);
            count.title = `${entry.progress.pending} of ${entry.progress.media} downloadable posts still to get`;
          } else {
            count.textContent = '?';
            count.title = 'Never fetched — press Refresh to find out what is here';
          }

          const name = document.createElement('a');
          name.className = 'rrm-q-name';
          name.href = entry.node.url;
          name.textContent = 'u/' + entry.name;
          name.title = entry.progress.known
            ? `${entry.progress.downloaded} of ${entry.progress.media} downloaded`
            : 'Never fetched';
          name.addEventListener('click', e => { e.preventDefault(); openNodeCurrentTab(entry.node.url); });

          // Check this one user against Reddit from here, rather than walking the
          // whole list or opening their profile to Scan.
          const recheck = document.createElement('button');
          recheck.className = 'rrm-q-open rrm-q-recheck';
          recheck.type = 'button';
          recheck.textContent = checkingThis ? '\u00b7\u00b7\u00b7' : '\u21bb';
          recheck.disabled = busy;
          recheck.title = checkingThis
            ? `Checking u/${entry.name} on Reddit…`
            : busy
              ? 'Another check is already running'
              : `Check Reddit for new posts from u/${entry.name}`;
          recheck.addEventListener('click', () => {
            if (typeof refreshQueueUser === 'function') refreshQueueUser(entry.name);
          });

          const open = document.createElement('button');
          open.className = 'rrm-q-open';
          open.type = 'button';
          open.textContent = '↗';
          open.title = 'Open in a new tab';
          open.addEventListener('click', () => openNodeNewTab(entry.node.url));

          row.appendChild(count);
          row.appendChild(name);
          row.appendChild(recheck);
          row.appendChild(open);
          return row;
        }

        function renderQueuePanel() {
          if (!winEl) return;
          const host = winEl.querySelector('#rrm-queue');
          syncQueueTabCount();
          if (!host || (view !== 'queue' && host.style.display === 'none')) return;
          const entries = queueEntries();
          const waiting = entries.filter(e => e.progress.known && e.progress.pending > 0);
          const unknown = entries.filter(e => !e.progress.known);
          const done = entries.length - waiting.length - unknown.length;
          const running = typeof queueRefreshIsRunning === 'function' && queueRefreshIsRunning();
          const busy = typeof queueRefreshBusy === 'function' && queueRefreshBusy();

          host.innerHTML = '';
          const head = document.createElement('div');
          head.className = 'rrm-q-head';
          const summary = document.createElement('div');
          summary.className = 'rrm-q-summary';
          if (!entries.length) {
            summary.textContent = 'No saved users yet.';
          } else {
            const pendingPosts = waiting.reduce((sum, e) => sum + e.progress.pending, 0);
            summary.textContent = waiting.length
              ? `${waiting.length} user${waiting.length === 1 ? '' : 's'} with ${pendingPosts} post${pendingPosts === 1 ? '' : 's'} to get · ${done} up to date`
              : `All ${entries.length - unknown.length} checked user${entries.length - unknown.length === 1 ? '' : 's'} are up to date.`;
          }
          const refresh = document.createElement('button');
          refresh.className = 'rrm-q-refresh' + (running ? ' busy' : '');
          refresh.type = 'button';
          refresh.textContent = running ? 'Stop' : 'Refresh';
          refresh.disabled = busy && !running;
          refresh.title = running
            ? 'Stop after the current user'
            : busy
              ? 'A single user is being checked right now'
              : 'Fetch each saved user’s posts from Reddit and work out what is missing';
          refresh.addEventListener('click', () => { refreshDownloadQueue(); });
          head.appendChild(summary);
          head.appendChild(refresh);
          host.appendChild(head);

          const section = (label, rows) => {
            if (!rows.length) return;
            const kicker = document.createElement('div');
            kicker.className = 'rrm-q-kicker';
            kicker.textContent = label;
            host.appendChild(kicker);
            const list = document.createElement('div');
            list.className = 'rrm-q-list';
            rows.forEach(entry => list.appendChild(buildQueueRow(entry)));
            host.appendChild(list);
          };

          section('Waiting', waiting);
          // Never-fetched users are a question, not a queue position, so they sit
          // below the real backlog rather than being counted into it.
          section('Never checked', unknown);

          if (!waiting.length && !unknown.length) {
            const empty = document.createElement('div');
            empty.className = 'rrm-q-empty';
            empty.textContent = entries.length
              ? 'Nothing waiting. Press Refresh to check Reddit again.'
              : 'Save a user, then press Refresh to see what of theirs you are missing.';
            host.appendChild(empty);
          }
        }

        function syncQueueTabCount() {
          if (!ui.queueCount) return;
          const n = queuePendingUserCount();
          ui.queueCount.textContent = String(n);
          ui.queueCount.hidden = n === 0;
        }

        // ------------------------------------------------------------- graph view
        // The saved list drawn as a map: one dot per saved item, one line per
        // recorded user->subreddit link. The layout is a small force settle run
        // here rather than by a library, so the tab costs no extra @require and
        // no third-party fetch on a script that otherwise only talks to Reddit.
        // Every dot carries a name at a fixed size in scene units, so the only
        // thing that buys label separation is spreading the layout: the fit then
        // scales the whole thing down and the names sit further apart relative
        // to their own size.
        const GRAPH_REPULSE = 7000;               // pairwise push, falls off with distance squared
        const GRAPH_REPULSE_RANGE = 400;          // pairs further apart than this are skipped
        const GRAPH_REPULSE_RANGE2 = GRAPH_REPULSE_RANGE * GRAPH_REPULSE_RANGE;
        const GRAPH_LINK_DIST = 120;
        // Every link gets its own length, drawn from a stable hash of its ends.
        // With one length for all of them a user's subreddits landed on a
        // perfect circle, which reads as a diagram rather than a blob.
        const GRAPH_LINK_JITTER_LO = 0.68;
        const GRAPH_LINK_JITTER_HI = 1.55;
        const GRAPH_LINK_STRENGTH = 0.04;
        // Users push each other apart a little, so they do not pile up — but only
        // a little. Flinging them apart was the wrong reading: what makes a blob
        // legible is a user sitting at the middle of its own subreddits.
        const GRAPH_USER_REPULSE = 2.2;
        // An island is a set of users joined by a chain of shared subreddits.
        // Gravity is per island, toward that island's own centre — a single
        // world-centre gravity is what dragged unrelated islands into one clump.
        //
        // Gravity is weak and the same for everything. Pulling users hard to the
        // island centre was wrong: an island with five users in it collapsed all
        // five onto one point, and every subreddit any of them posted in ended up
        // in a single ring around that point — one giant wheel instead of a map.
        //
        // A user does not need to be dragged to the middle of its own subreddits;
        // its links already put it there. What it needs is room from other users,
        // which is the constraint below. Gravity here only stops an island
        // drifting; the springs are what hold it together.
        const GRAPH_ISLAND_GRAVITY = 0.0035;
        // Two users in one island are kept apart by a distance rather than left
        // to a 1/d^2 force, because a force is simply overpowered by the springs
        // of every subreddit they share — which is exactly the case where they
        // most need to stay legible as two centres.
        const GRAPH_USER_MIN_GAP = 300;
        // Islands are seeded close enough to overlap, on purpose. The separation
        // force below then pushes each pair to exactly the room it needs, which
        // scales itself to how big the islands actually are — seeding them far
        // apart instead left a fixed gap that dwarfed small islands and made the
        // whole map mostly empty space, since nothing ever pulls islands back in.
        // Deliberately far too small. Nothing in the system ever pulls two
        // islands together, so wherever they are seeded apart is where they stay
        // — seeding a field of lone subreddits on a wide spiral left the real
        // clusters squeezed into an unreadable middle. Seed them piled up and
        // let the relaxation below open exactly the room each pair needs.
        const GRAPH_ISLAND_SPREAD = 55;           // just enough to give each a starting direction
        // Room for a label between neighbouring islands, and not much more.
        const GRAPH_ISLAND_GAP = 72;              // clear space kept between two islands

        // Hard bounds. Islands are separated by *moving* them rather than by
        // pushing them, and every step is capped, because the previous version
        // added a force per island pair per tick: a library with dozens of lone
        // subreddits has dozens of islands, and the sum threw every node clean
        // off the map. Nothing here may depend on how many islands there are.
        const GRAPH_ISLAND_PAIR_LIMIT = 260;      // beyond this many islands, skip the whole-island pass
        const GRAPH_ISLAND_RELAX = 0.4;           // share of an island overlap closed per tick
        // The island radius used for keeping islands apart is the *mean* distance
        // from its centre, nudged up a little — not the maximum. Max reserves a
        // disc as wide as the furthest stray node, which is what inflated the map
        // when whole-island separation was first tried.
        const GRAPH_ISLAND_RADIUS_SCALE = 1.3;
        // How far one node may be moved in a tick to honour the constraint. A
        // positional correction cannot compound the way a force does — each tick
        // measures the gap that is actually there — so this only limits how fast
        // the layout converges, never how far it can end up.
        const GRAPH_ISLAND_MAX_STEP = 24;
        const GRAPH_MAX_SPEED = 40;               // per node, per tick
        const GRAPH_MAX_COORD = 12000;            // the map has edges, whatever the forces do

        const GRAPH_DAMP = 0.8;
        const GRAPH_ALPHA_DECAY = 0.985;
        const GRAPH_ALPHA_MIN = 0.02;
        const GRAPH_LABEL_MAX = 20;               // characters before a name is clipped
        // The legend and the hint are painted over the map, so the fit frames the
        // graph into the band between them rather than the whole pane. Without
        // this the outermost labels sit underneath them.
        const GRAPH_FIT_INSET_TOP = 22;
        const GRAPH_FIT_INSET_BOTTOM = 68;   // the hint, and the jump buttons below it
        const GRAPH_ZOOM_MIN = 0.15;
        const GRAPH_ZOOM_MAX = 3.2;
        const SVG_NS = 'http://www.w3.org/2000/svg';

        // Positions are kept per node id and outlive a re-render, so editing a
        // rating or a cross-tab sync never reshuffles a layout you have read.
        const graphPos = new Map();
        let graphSim = null;                      // the running rAF handle, if any
        let graphAlpha = 0;                       // settle energy left; 0 means settled or idle
        let graphBuilt = { sig: '', host: null, svg: null, scene: null, nodes: [], links: [], compCount: 1 };
        let graphTransform = { k: 1, x: 0, y: 0 };
        let graphUserMoved = false;               // a pan/zoom/drag stops the auto-framing

        function svgEl(name) { return document.createElementNS(SVG_NS, name); }

        // A repeatable number in [0,1) from a string. Everything irregular about
        // the layout is drawn from this rather than Math.random, so a rebuild
        // gives the same map back instead of reshuffling it under you.
        function graphJitter(seed) {
          const str = String(seed || '');
          let h = 2166136261;
          for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          return ((h >>> 0) % 100000) / 100000;
        }

        // Pauses the loop. `graphAlpha` is deliberately left alone: an unfinished
        // settle must resume, not restart, or every visit to the tab reshuffles.
        function stopGraphSim() {
          if (graphSim) cancelAnimationFrame(graphSim);
          graphSim = null;
        }

        // The map is built from the histories, not from a trail of what you
        // clicked. Every saved user is joined to every subreddit they have ever
        // posted in, so the shape on screen is where your tastes actually
        // cluster and which users overlap — not the order you happened to browse.
        //
        // Posts are deliberately absent. The question this view answers is about
        // people and places; a dot per post would bury both.
        function buildGraphModel() {
          const saved = loadGraph();
          const nodes = new Map();
          const linkWeights = new Map();

          const addNodeRec = (id, rec) => {
            if (nodes.has(id)) return nodes.get(id);
            nodes.set(id, rec);
            return rec;
          };

          saved.nodes.forEach(n => {
            if (!n || !n.id) return;
            if (n.type === 'user') {
              const name = userNameFromNode(n);
              const progress = name ? userDownloadProgress(name) : null;
              addNodeRec(n.id, {
                id: n.id, type: 'user', name,
                label: (n.label || ('u/' + name)).replace(/\n/g, ' '),
                url: n.url, visited: !!n.visited, saved: true,
                // "Finished" is the ledger's word, not a manual tick: every post
                // of theirs that has media is downloaded.
                finished: !!(progress && progress.known && progress.media > 0 && progress.pending === 0),
                pending: progress && progress.known ? progress.pending : -1,
                posts: 0
              });
            } else if (n.type === 'sub') {
              const name = subredditDisplayName(n.label || String(n.id).replace(/^sub:/, ''));
              addNodeRec(n.id, {
                id: n.id, type: 'sub', name,
                label: (n.label || ('r/' + name)).replace(/\n/g, ' '),
                url: n.url, visited: !!n.visited, saved: true, finished: false, posts: 0
              });
            }
          });

          const linkUp = (userId, subName, weight) => {
            const subId = 'sub:' + subName.toLowerCase();
            const sub = nodes.get(subId);
            // Only subreddits turned on in the picker are drawn. A user's other
            // subreddits are still listed there, and still counted — they are
            // simply not on the map until you ask for them.
            if (!sub) return;
            sub.posts += weight;
            const user = nodes.get(userId);
            if (user) user.posts += weight;
            const lk = userId + '__' + subId;
            linkWeights.set(lk, (linkWeights.get(lk) || 0) + weight);
          };

          nodes.forEach(rec => {
            if (rec.type !== 'user' || !rec.name) return;
            subredditsForUser(rec.name).forEach(entry => {
              if (entry && entry.name) linkUp(rec.id, entry.name, entry.count);
            });
          });

          // Links recorded by older scans, before histories existed. Same shape,
          // so they simply top up the model rather than needing a second view.
          saved.edges.forEach(e => {
            if (!e || !e.from || !e.to) return;
            if (!String(e.from).startsWith('user:') || !String(e.to).startsWith('sub:')) return;
            if (!nodes.has(e.from) || !nodes.has(e.to)) return;
            const lk = e.from + '__' + e.to;
            if (linkWeights.has(lk)) return;
            linkUp(e.from, String(e.to).replace(/^sub:/, ''), 1);
          });

          const list = [...nodes.values()];
          const links = [];
          linkWeights.forEach((weight, key) => {
            const [from, to] = key.split('__');
            const source = nodes.get(from), target = nodes.get(to);
            if (source && target) links.push({ source, target, weight });
          });
          list.forEach(n => { n.degree = 0; });
          links.forEach(l => { l.source.degree++; l.target.degree++; });
          return { nodes: list, links };
        }

        // Size carries the one fact the colour cannot: how much is there. A
        // subreddit grows with how many of your saved users post in it, which is
        // what makes a cluster legible at a glance.
        function graphNodeRadius(node) {
          const base = node.type === 'user' ? 6.5 : 5.5;
          const pull = node.type === 'user'
            ? Math.min(6, (node.degree || 0) * 0.55)
            : Math.min(9, Math.sqrt(Math.max(1, node.degree || 1)) * 2.6 - 2.6);
          return base + pull;
        }

        function graphNodeLabel(node) {
          const text = String(node.label || '').replace(/\n/g, ' ');
          return text.length > GRAPH_LABEL_MAX ? text.slice(0, GRAPH_LABEL_MAX - 1) + '\u2026' : text;
        }

        function graphMatches(n) {
          if (!query) return true;
          return (n.label || '').toLowerCase().includes(query)
              || (n.url || '').toLowerCase().includes(query);
        }

        function applyGraphTransform() {
          if (!graphBuilt.scene) return;
          const t = graphTransform;
          graphBuilt.scene.setAttribute('transform', `translate(${t.x} ${t.y}) scale(${t.k})`);
        }

        // Frame the whole map in the pane. Called every settle frame until the
        // user pans, zooms or drags — after that the view is theirs to keep.
        function fitGraphToView() {
          const host = graphBuilt.host;
          const pts = graphBuilt.nodes;
          if (!host || !pts.length) return;
          const w = host.clientWidth, h = host.clientHeight;
          if (!w || !h) return;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          let box = null;
          try { box = graphBuilt.scene && graphBuilt.scene.getBBox(); } catch (e) { box = null; }
          if (box && box.width && box.height) {
            minX = box.x; minY = box.y;
            maxX = box.x + box.width; maxY = box.y + box.height;
          } else {
            pts.forEach(p => {
              const r = p.r + 14;
              if (p.x - r < minX) minX = p.x - r;
              if (p.y - r < minY) minY = p.y - r;
              if (p.x + r > maxX) maxX = p.x + r;
              if (p.y + r > maxY) maxY = p.y + r;
            });
          }
          const pad = 12;
          minX -= pad; minY -= pad; maxX += pad; maxY += pad;
          const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1);
          const availH = Math.max(40, h - GRAPH_FIT_INSET_TOP - GRAPH_FIT_INSET_BOTTOM);
          const k = Math.max(GRAPH_ZOOM_MIN, Math.min(GRAPH_ZOOM_MAX, Math.min(w / bw, availH / bh, 1.4)));
          graphTransform = {
            k,
            x: w / 2 - k * (minX + maxX) / 2,
            y: GRAPH_FIT_INSET_TOP + availH / 2 - k * (minY + maxY) / 2
          };
          applyGraphTransform();
        }

        // Repulsion already ignores any pair further apart than its range, so the
        // pairs worth testing are the ones sharing a cell of that size or a
        // neighbouring one. Bucketing them turns the every-pair sweep into a
        // local one, which is what lets a map of a whole library stay smooth:
        // an exhaustive user/subreddit graph runs to hundreds of dots, and at
        // that size the old O(n squared) tick was most of a frame on its own.
        function graphTick(alpha) {
          const nodes = graphBuilt.nodes, links = graphBuilt.links, n = nodes.length;
          const cell = GRAPH_REPULSE_RANGE;
          const buckets = new Map();
          for (let i = 0; i < n; i++) {
            const p = nodes[i];
            const key = Math.floor(p.x / cell) + ':' + Math.floor(p.y / cell);
            let list = buckets.get(key);
            if (!list) { list = []; buckets.set(key, list); }
            list.push(p);
          }
          const push = (a, b) => {
            let dx = b.x - a.x, dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            // Two dots exactly on top of each other have no direction to push
            // along, so give them one rather than dividing by zero.
            if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy || 0.01; }
            if (d2 > GRAPH_REPULSE_RANGE2) return;
            const d = Math.sqrt(d2);
            if (a.comp !== b.comp) {
              // Two islands must not touch, and that is all they owe each other.
              // Stated as a distance between nodes rather than between island
              // centres, it packs a small island into the hollows of a big one
              // instead of reserving a disc as wide as the widest island — which
              // is what inflated the map when a library had many lone
              // subreddits. Corrected in position, so it cannot build up speed.
              const want = GRAPH_ISLAND_GAP + a.r + b.r;
              if (d < want) {
                const fix = Math.min((want - d) * 0.5, GRAPH_ISLAND_MAX_STEP);
                const ux = dx / d, uy = dy / d;
                if (!a.fixed) { a.x -= ux * fix; a.y -= uy * fix; }
                if (!b.fixed) { b.x += ux * fix; b.y += uy * fix; }
              }
              return;
            }
            if (a.isUser && b.isUser && d < GRAPH_USER_MIN_GAP) {
              // Each user is the middle of its own cluster of subreddits, so two
              // of them must not sit on top of each other however much they share.
              const fix = Math.min((GRAPH_USER_MIN_GAP - d) * 0.5, GRAPH_ISLAND_MAX_STEP);
              const ux = dx / d, uy = dy / d;
              if (!a.fixed) { a.x -= ux * fix; a.y -= uy * fix; }
              if (!b.fixed) { b.x += ux * fix; b.y += uy * fix; }
            }
            const strength = (a.isUser && b.isUser) ? GRAPH_REPULSE * GRAPH_USER_REPULSE : GRAPH_REPULSE;
            const f = strength / d2;
            const fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx -= fx; a.vy -= fy;
            b.vx += fx; b.vy += fy;
          };
          for (let i = 0; i < n; i++) {
            const a = nodes[i];
            const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
            for (let gx = cx - 1; gx <= cx + 1; gx++) {
              for (let gy = cy - 1; gy <= cy + 1; gy++) {
                const list = buckets.get(gx + ':' + gy);
                if (!list) continue;
                for (let k = 0; k < list.length; k++) {
                  const b = list[k];
                  // Each unordered pair is handled once, by the lower index.
                  if (b.idx <= a.idx) continue;
                  push(a, b);
                }
              }
            }
          }
          for (let i = 0; i < links.length; i++) {
            const l = links[i];
            const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const f = (d - (l.dist || GRAPH_LINK_DIST)) * GRAPH_LINK_STRENGTH;
            const fx = (dx / d) * f, fy = (dy / d) * f;
            l.source.vx += fx; l.source.vy += fy;
            l.target.vx -= fx; l.target.vy -= fy;
          }
          // Where each island currently sits, and how far it reaches.
          const islands = graphBuilt.compCount || 1;
          const midX = new Float64Array(islands);
          const midY = new Float64Array(islands);
          const members = new Float64Array(islands);
          for (let i = 0; i < n; i++) {
            const p = nodes[i];
            midX[p.comp] += p.x; midY[p.comp] += p.y; members[p.comp]++;
          }
          for (let c = 0; c < islands; c++) {
            if (members[c]) { midX[c] /= members[c]; midY[c] /= members[c]; }
            if (!Number.isFinite(midX[c])) midX[c] = 0;
            if (!Number.isFinite(midY[c])) midY[c] = 0;
          }

          relaxGraphIslands(nodes, islands, members, midX, midY);

          for (let i = 0; i < n; i++) {
            const p = nodes[i];
            if (p.fixed) { p.vx = 0; p.vy = 0; continue; }
            const c = p.comp;
            p.vx -= (p.x - midX[c]) * GRAPH_ISLAND_GRAVITY;
            p.vy -= (p.y - midY[c]) * GRAPH_ISLAND_GRAVITY;
            p.vx *= GRAPH_DAMP; p.vy *= GRAPH_DAMP;
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (speed > GRAPH_MAX_SPEED) {
              p.vx = (p.vx / speed) * GRAPH_MAX_SPEED;
              p.vy = (p.vy / speed) * GRAPH_MAX_SPEED;
            }
            p.x += p.vx * alpha; p.y += p.vy * alpha;
            // Last line of defence. A node that has gone non-finite or left the
            // map is put back rather than being allowed to drag the fit — an
            // unreachable graph looks exactly like an empty one.
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
              p.x = Number.isFinite(midX[c]) ? midX[c] : 0;
              p.y = Number.isFinite(midY[c]) ? midY[c] : 0;
              p.vx = 0; p.vy = 0;
            }
            if (p.x > GRAPH_MAX_COORD) p.x = GRAPH_MAX_COORD;
            else if (p.x < -GRAPH_MAX_COORD) p.x = -GRAPH_MAX_COORD;
            if (p.y > GRAPH_MAX_COORD) p.y = GRAPH_MAX_COORD;
            else if (p.y < -GRAPH_MAX_COORD) p.y = -GRAPH_MAX_COORD;
          }
        }

        // Islands have to be kept apart as whole things, not only node by node.
        // The node rule alone lets two islands interleave like combs — every
        // individual pair legally spaced, the two clusters hopelessly mixed —
        // which is what put one island's users a hundred units from another's.
        //
        // Positional and capped per island per tick, so it converges rather than
        // accumulating the way the original force did.
        function relaxGraphIslands(nodes, islands, members, midX, midY) {
          if (islands < 2 || islands > GRAPH_ISLAND_PAIR_LIMIT) return;
          const n = nodes.length;
          const radius = new Float64Array(islands);
          for (let i = 0; i < n; i++) {
            const p = nodes[i];
            const dx = p.x - midX[p.comp], dy = p.y - midY[p.comp];
            radius[p.comp] += Math.sqrt(dx * dx + dy * dy);
          }
          for (let c = 0; c < islands; c++) {
            radius[c] = members[c] ? (radius[c] / members[c]) * GRAPH_ISLAND_RADIUS_SCALE : 0;
          }
          const moveX = new Float64Array(islands);
          const moveY = new Float64Array(islands);
          for (let a = 0; a < islands; a++) {
            if (!members[a]) continue;
            for (let b = a + 1; b < islands; b++) {
              if (!members[b]) continue;
              let dx = midX[b] - midX[a], dy = midY[b] - midY[a];
              let dist = Math.sqrt(dx * dx + dy * dy);
              const want = radius[a] + radius[b] + GRAPH_ISLAND_GAP;
              if (dist >= want) continue;
              if (!(dist > 0.01)) {
                // Needs a direction, and a stable one: random here would jitter
                // the whole map every frame.
                const seedAngle = (a * 2.399963) % (Math.PI * 2);
                dx = Math.cos(seedAngle); dy = Math.sin(seedAngle); dist = 1;
              }
              const step = (want - dist) * 0.5 * GRAPH_ISLAND_RELAX;
              const ux = dx / dist, uy = dy / dist;
              moveX[a] -= ux * step; moveY[a] -= uy * step;
              moveX[b] += ux * step; moveY[b] += uy * step;
            }
          }
          // Capped per island, not per pair, which is what makes this independent
          // of how many islands there are.
          for (let c = 0; c < islands; c++) {
            const m = Math.sqrt(moveX[c] * moveX[c] + moveY[c] * moveY[c]);
            if (m > GRAPH_ISLAND_MAX_STEP) {
              moveX[c] = (moveX[c] / m) * GRAPH_ISLAND_MAX_STEP;
              moveY[c] = (moveY[c] / m) * GRAPH_ISLAND_MAX_STEP;
            }
          }
          for (let i = 0; i < n; i++) {
            const p = nodes[i];
            if (p.fixed) continue;
            p.x += moveX[p.comp];
            p.y += moveY[p.comp];
          }
        }

        function paintGraphPositions() {
          const nodes = graphBuilt.nodes, links = graphBuilt.links;
          for (let i = 0; i < nodes.length; i++) {
            const p = nodes[i];
            p.el.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
            graphPos.set(p.id, { x: p.x, y: p.y });
          }
          for (let i = 0; i < links.length; i++) {
            const l = links[i];
            l.el.setAttribute('x1', l.source.x.toFixed(1));
            l.el.setAttribute('y1', l.source.y.toFixed(1));
            l.el.setAttribute('x2', l.target.x.toFixed(1));
            l.el.setAttribute('y2', l.target.y.toFixed(1));
          }
        }

        function runGraphSim(alpha) {
          if (!graphBuilt.nodes.length) return;
          graphAlpha = Math.max(graphAlpha, alpha);
          if (graphSim) return;
          const step = () => {
            graphSim = null;
            // A collapsed or hidden window measures zero. Pause rather than burn a
            // frame budget on a map nobody is looking at; returning resumes it.
            if (!graphBuilt.host || !graphBuilt.host.clientWidth) return;
            graphTick(graphAlpha);
            paintGraphPositions();
            if (!graphUserMoved) fitGraphToView();
            graphAlpha *= GRAPH_ALPHA_DECAY;
            if (graphAlpha < GRAPH_ALPHA_MIN) {
              graphAlpha = 0;
              return;
            }
            graphSim = requestAnimationFrame(step);
          };
          graphSim = requestAnimationFrame(step);
        }

        // Search does not remove dots from the map — a map with holes in it stops
        // being a map. Matches keep their ring and their name; the rest go quiet.
        function applyGraphHighlight() {
          graphBuilt.nodes.forEach(p => {
            const hit = !!query && graphMatches(p.node);
            p.el.classList.toggle('hit', hit);
            p.el.classList.toggle('dim', !!query && !hit);
          });
        }

        function graphScenePoint(evt) {
          const rect = graphBuilt.svg.getBoundingClientRect();
          return {
            x: (evt.clientX - rect.left - graphTransform.x) / graphTransform.k,
            y: (evt.clientY - rect.top - graphTransform.y) / graphTransform.k
          };
        }

        // An island is a set of nodes joined by links — in practice a group of
        // users reachable from one another through subreddits they share. Two
        // users with no subreddit in common, however indirectly, land in
        // different islands, and that is the fact the layout is built to show.
        function assignGraphIslands() {
          const parent = new Map();
          const find = (start) => {
            let root = start;
            while (parent.get(root) !== root) root = parent.get(root);
            let walk = start;
            while (parent.get(walk) !== root) {   // path compression
              const next = parent.get(walk);
              parent.set(walk, root);
              walk = next;
            }
            return root;
          };
          graphBuilt.nodes.forEach(p => parent.set(p.id, p.id));
          graphBuilt.links.forEach(l => {
            const ra = find(l.source.id), rb = find(l.target.id);
            if (ra !== rb) parent.set(ra, rb);
          });
          const index = new Map();
          graphBuilt.nodes.forEach(p => {
            const root = find(p.id);
            if (!index.has(root)) index.set(root, index.size);
            p.comp = index.get(root);
          });
          graphBuilt.compCount = Math.max(1, index.size);
        }

        // A node starts near its own island rather than in one shared heap at
        // the world centre. Seeding everything together and trusting repulsion
        // to sort it out is what produced the single clump: repulsion is
        // range-limited, so islands that start overlapped can never push apart.
        // Seed the shape we actually want rather than a heap the forces have to
        // dig out of: users spread around their island, and every subreddit out
        // beside whichever user it belongs to. Getting this right matters more
        // than the forces do — a layout seeded as one pile tends to settle as
        // one pile, because the springs of shared subreddits hold it there.
        function seedGraphIslandPositions() {
          // The user a subreddit should start next to. First one wins; a shared
          // subreddit gets pulled between them by its springs soon enough.
          const anchor = new Map();
          graphBuilt.links.forEach(l => {
            const user = l.source.isUser ? l.source : (l.target.isUser ? l.target : null);
            if (!user) return;
            const other = user === l.source ? l.target : l.source;
            if (other && !other.isUser && !anchor.has(other.id)) anchor.set(other.id, user);
          });

          const userCount = new Map();
          graphBuilt.nodes.forEach(p => {
            if (p.isUser) userCount.set(p.comp, (userCount.get(p.comp) || 0) + 1);
          });

          const islandOrigin = comp => {
            const a = comp * 2.399963;                       // golden angle
            const r = GRAPH_ISLAND_SPREAD * Math.sqrt(comp);
            return { x: Math.cos(a) * r, y: Math.sin(a) * r };
          };

          // Users first, so a subreddit has somewhere to be placed beside.
          const userSlot = new Map();
          graphBuilt.nodes.forEach(p => {
            if (!p.isUser || p.seeded) return;
            const origin = islandOrigin(p.comp);
            const total = Math.max(1, userCount.get(p.comp) || 1);
            const k = userSlot.get(p.comp) || 0;
            userSlot.set(p.comp, k + 1);
            const ring = total > 1 ? GRAPH_USER_MIN_GAP * 0.62 * Math.sqrt(total) : 0;
            const a = (k / total) * Math.PI * 2 + graphJitter(p.id) * 0.7;
            p.x = origin.x + Math.cos(a) * ring;
            p.y = origin.y + Math.sin(a) * ring;
            p.seeded = true;
          });

          // Then subreddits, out around the user they hang off.
          const subSlot = new Map();
          graphBuilt.nodes.forEach(p => {
            if (p.isUser || p.seeded) return;
            const host = anchor.get(p.id);
            const origin = host ? host : islandOrigin(p.comp);
            const key = host ? host.id : 'island:' + p.comp;
            const k = subSlot.get(key) || 0;
            subSlot.set(key, k + 1);
            // Golden angle so they fan out evenly, jittered so they do not land
            // on a ring — an even circle reads as a diagram, not a blob.
            const a = k * 2.399963 + (graphJitter(p.id + ':a') - 0.5) * 1.1;
            const ring = GRAPH_LINK_DIST * (0.8 + graphJitter(p.id + ':r') * 0.75);
            p.x = origin.x + Math.cos(a) * ring;
            p.y = origin.y + Math.sin(a) * ring;
            p.seeded = true;
          });
        }

        function buildGraphScene(host, nodes, links) {
          clearGraphHostChrome(host);
          const svg = svgEl('svg');
          svg.setAttribute('class', 'rrm-g-svg');
          const scene = svgEl('g');
          scene.setAttribute('class', 'rrm-g-scene');
          const edgeLayer = svgEl('g');
          const nodeLayer = svgEl('g');
          scene.appendChild(edgeLayer);
          scene.appendChild(nodeLayer);
          svg.appendChild(scene);
          host.appendChild(svg);

          const hint = document.createElement('div');
          hint.className = 'rrm-g-hint';
          hint.textContent = 'click a dot to open it · drag to move · scroll to zoom · double-click to refit';
          const legend = document.createElement('div');
          legend.className = 'rrm-g-legend';
          legend.innerHTML = '<span><i class="rrm-g-key user"></i>user</span>'
            + '<span><i class="rrm-g-key userdone"></i>all downloaded</span>'
            + '<span><i class="rrm-g-key sub"></i>subreddit</span>';
          host.appendChild(legend);
          host.appendChild(hint);

          graphBuilt = { sig: graphBuilt.sig, host, svg, scene, nodes: [], links: [], compCount: 1 };

          // Positions are left until the links exist: where a node should start
          // depends on which island it turns out to belong to.
          nodes.forEach(node => {
            const saved = graphPos.get(node.id);
            const x = saved ? saved.x : 0;
            const y = saved ? saved.y : 0;
            const g = svgEl('g');
            g.setAttribute('class', 'rrm-g-node ' + node.type
              // A finished user is greyed rather than hidden: it is still part of
              // the shape of your taste, it just has nothing waiting.
              + (node.finished ? ' finished' : '')
              );
            const circle = svgEl('circle');
            const r = graphNodeRadius(node);
            circle.setAttribute('r', String(r));
            circle.setAttribute('fill', node.finished ? '#6d6357' : (COLORS[node.type] || '#8a8a92'));
            const text = svgEl('text');
            text.setAttribute('y', String(r + 11));
            text.textContent = graphNodeLabel(node);
            const title = svgEl('title');
            const detail = node.type === 'user'
              ? (node.pending < 0 ? 'never checked'
                 : node.pending === 0 ? 'everything downloaded'
                 : `${node.pending} post${node.pending === 1 ? '' : 's'} still to get`)
              : (node.saved ? 'followed' : 'not followed')
                + ` · ${node.posts} post${node.posts === 1 ? '' : 's'} from your saved users`;
            title.textContent = `${(node.label || '').replace(/\n/g, ' ')}\n${node.url}\n${detail}`;
            g.appendChild(title);
            g.appendChild(circle);
            g.appendChild(text);
            nodeLayer.appendChild(g);
            graphBuilt.nodes.push({ id: node.id, node, el: g, r, x, y, vx: 0, vy: 0, fixed: false,
                                    idx: graphBuilt.nodes.length, seeded: !!saved,
                                    isUser: node.type === 'user', comp: 0 });
          });

          const byId = new Map(graphBuilt.nodes.map(p => [p.id, p]));
          links.forEach(l => {
            const source = byId.get(l.source.id), target = byId.get(l.target.id);
            if (!source || !target) return;
            const line = svgEl('line');
            line.setAttribute('class', 'rrm-g-edge');
            // How much of a user's output lands in that subreddit. A thicker line
            // is the difference between "posts there" and "lives there".
            line.setAttribute('stroke-width', String(Math.min(3.4, 0.9 + Math.log2(Math.max(1, l.weight || 1)) * 0.55)));
            edgeLayer.appendChild(line);
            const spread = GRAPH_LINK_JITTER_LO
              + graphJitter(source.id + '>' + target.id) * (GRAPH_LINK_JITTER_HI - GRAPH_LINK_JITTER_LO);
            graphBuilt.links.push({ source, target, el: line, dist: GRAPH_LINK_DIST * spread });
          });

          renderGraphPicker(host);
          renderGraphJumpBar(host);
          assignGraphIslands();
          seedGraphIslandPositions();
          bindGraphInteractions();
          paintGraphPositions();
          applyGraphHighlight();
        }

        function bindGraphInteractions() {
          const svg = graphBuilt.svg;
          let drag = null;      // { point, moved } for a node, or { pan: true } for the background

          graphBuilt.nodes.forEach(p => {
            p.el.addEventListener('pointerenter', () => p.el.classList.add('hover'));
            p.el.addEventListener('pointerleave', () => p.el.classList.remove('hover'));
            p.el.addEventListener('pointerdown', evt => {
              if (evt.button !== 0) return;
              evt.stopPropagation();
              evt.preventDefault();
              graphUserMoved = true;
              p.fixed = true;
              drag = { point: p, moved: false };
              try { svg.setPointerCapture(evt.pointerId); } catch (e) {}
            });
            // Double-clicking a dot must not also reach the background's refit.
            p.el.addEventListener('dblclick', evt => { evt.preventDefault(); evt.stopPropagation(); });
          });

          svg.addEventListener('pointerdown', evt => {
            if (evt.button !== 0 || drag) return;
            drag = { pan: true, x: evt.clientX, y: evt.clientY, ox: graphTransform.x, oy: graphTransform.y };
            svg.classList.add('panning');
            try { svg.setPointerCapture(evt.pointerId); } catch (e) {}
          });

          svg.addEventListener('pointermove', evt => {
            if (!drag) return;
            if (drag.pan) {
              graphUserMoved = true;
              graphTransform.x = drag.ox + (evt.clientX - drag.x);
              graphTransform.y = drag.oy + (evt.clientY - drag.y);
              applyGraphTransform();
              return;
            }
            const pt = graphScenePoint(evt);
            drag.moved = true;
            drag.point.x = pt.x; drag.point.y = pt.y;
            drag.point.vx = 0; drag.point.vy = 0;
            paintGraphPositions();
            runGraphSim(0.4);
          });

          const endDrag = evt => {
            if (!drag) return;
            const finished = drag;
            drag = null;
            svg.classList.remove('panning');
            try { svg.releasePointerCapture(evt.pointerId); } catch (e) {}
            if (finished.pan) return;
            finished.point.fixed = false;
            if (finished.moved) { runGraphSim(0.3); return; }
            // A press that never moved is a click on that dot. It opens in a new
            // tab rather than navigating, so a stray press cannot cost you the
            // map you were reading.
            openNodeNewTab(finished.point.node.url);
          };
          svg.addEventListener('pointerup', endDrag);
          svg.addEventListener('pointercancel', endDrag);

          svg.addEventListener('wheel', evt => {
            evt.preventDefault();
            graphUserMoved = true;
            const rect = svg.getBoundingClientRect();
            const mx = evt.clientX - rect.left, my = evt.clientY - rect.top;
            const scale = Math.exp(-evt.deltaY * 0.0016);
            const k = Math.max(GRAPH_ZOOM_MIN, Math.min(GRAPH_ZOOM_MAX, graphTransform.k * scale));
            // Zoom about the cursor: the scene point under it must not move.
            graphTransform.x = mx - (mx - graphTransform.x) * (k / graphTransform.k);
            graphTransform.y = my - (my - graphTransform.y) * (k / graphTransform.k);
            graphTransform.k = k;
            applyGraphTransform();
          }, { passive: false });

          svg.addEventListener('dblclick', evt => {
            evt.preventDefault();
            graphUserMoved = false;
            fitGraphToView();
          });
        }

        // The picker keeps a filter box and a scroll position, and the jump bar
        // keeps nothing but should not flicker; both are rebuilt in place rather
        // than thrown away with the scene on every layout change.
        function clearGraphHostChrome(host) {
          Array.from(host.children).forEach(el => {
            if (el.classList.contains('rrm-g-picker')) return;
            if (el.classList.contains('rrm-g-jump')) return;
            el.remove();
          });
        }

        // ------------------------------------------------------------- the jumps
        // Somewhere to go, rather than something to look at. One die rolls over
        // what you have joined, the other over everything the map knows about —
        // which is the whole point of keeping the wider list in the picker.
        function jumpToRandomSubreddit(joinedOnly) {
          const all = allKnownSubreddits();
          const pool = joinedOnly ? all.filter(entry => entry.saved) : all;
          if (!pool.length) {
            try {
              logLine(joinedOnly
                ? 'No joined subreddits to jump to — turn some on in the map’s Subreddits list.'
                : 'No subreddits known yet — refresh the Queue so the map learns where your users post.');
            } catch (e) {}
            return;
          }
          const pick = pool[Math.floor(Math.random() * pool.length)];
          try { logLine(`Jumping to r/${pick.name}.`); } catch (e) {}
          openNodeCurrentTab(location.origin + '/r/' + encodeURIComponent(pick.name) + '/');
        }

        function renderGraphJumpBar(host) {
          if (!host) return;
          let bar = host.querySelector('.rrm-g-jump');
          if (!bar) {
            bar = document.createElement('div');
            bar.className = 'rrm-g-jump';
            bar.innerHTML = `
              <button class="rrm-g-jumpBtn" type="button" data-pool="joined"></button>
              <button class="rrm-g-jumpBtn" type="button" data-pool="all"></button>`;
            host.appendChild(bar);
            bar.querySelectorAll('.rrm-g-jumpBtn').forEach(btn => {
              btn.addEventListener('click', () => jumpToRandomSubreddit(btn.dataset.pool === 'joined'));
            });
            // The map pans on drag and zooms on wheel; neither should happen
            // because you reached for a button sitting on top of it.
            ['pointerdown', 'wheel', 'dblclick'].forEach(type => {
              bar.addEventListener(type, e => e.stopPropagation());
            });
          }
          const all = allKnownSubreddits();
          const joined = all.filter(entry => entry.saved).length;
          const joinedBtn = bar.querySelector('[data-pool="joined"]');
          const allBtn = bar.querySelector('[data-pool="all"]');
          joinedBtn.textContent = `Random joined (${joined})`;
          joinedBtn.disabled = joined === 0;
          joinedBtn.title = joined
            ? 'Open a random subreddit you have joined'
            : 'Nothing joined yet — turn some on in the Subreddits list';
          allBtn.textContent = `Random any (${all.length})`;
          allBtn.disabled = all.length === 0;
          allBtn.title = all.length
            ? 'Open a random subreddit any of your saved users posts in, joined or not'
            : 'No subreddits known yet — refresh the Queue';
        }

        // ------------------------------------------------------------ the picker
        // Which subreddits are on the map. Collapsed by default so it does not
        // cover the thing it controls; the header still carries the count, which
        // is the part worth seeing at a glance.
        const GRAPH_PICKER_OPEN_KEY = 'rrm_graph_picker_open';
        let graphPickerFilter = '';

        function graphPickerIsOpen() { return GM_getValue(GRAPH_PICKER_OPEN_KEY, false) === true; }
        function setGraphPickerOpen(on) { safeSet(GRAPH_PICKER_OPEN_KEY, !!on); }

        function renderGraphPicker(host) {
          if (!host) return;
          let picker = host.querySelector('.rrm-g-picker');
          if (!picker) {
            picker = document.createElement('div');
            picker.className = 'rrm-g-picker';
            picker.innerHTML = `
              <button class="rrm-g-pickerHead" type="button">
                <span class="rrm-g-pickerChev"></span>
                <span class="rrm-g-pickerTitle">Subreddits</span>
                <span class="rrm-g-pickerCount"></span>
              </button>
              <div class="rrm-g-pickerBody">
                <input class="rrm-g-pickerFilter" type="text" placeholder="Filter…"
                       autocomplete="off" spellcheck="false">
                <div class="rrm-g-pickerList"></div>
              </div>`;
            host.appendChild(picker);
            picker.querySelector('.rrm-g-pickerHead').addEventListener('click', () => {
              setGraphPickerOpen(!graphPickerIsOpen());
              renderGraphPicker(host);
            });
            const filter = picker.querySelector('.rrm-g-pickerFilter');
            filter.addEventListener('input', () => {
              graphPickerFilter = filter.value.trim().toLowerCase();
              paintGraphPickerList(picker);
            });
            // The map behind this panel pans on drag and zooms on wheel; neither
            // should happen because you scrolled a list or clicked a checkbox.
            ['pointerdown', 'wheel', 'dblclick'].forEach(type => {
              picker.addEventListener(type, e => e.stopPropagation());
            });
          }
          const open = graphPickerIsOpen();
          picker.classList.toggle('is-open', open);
          picker.querySelector('.rrm-g-pickerChev').textContent = open ? '\u25be' : '\u25b8';
          const filterEl = picker.querySelector('.rrm-g-pickerFilter');
          if (filterEl.value !== graphPickerFilter) filterEl.value = graphPickerFilter;
          paintGraphPickerList(picker);
        }

        function paintGraphPickerList(picker) {
          const all = allKnownSubreddits();
          const on = all.filter(entry => entry.saved).length;
          const countEl = picker.querySelector('.rrm-g-pickerCount');
          countEl.textContent = `${on}/${all.length}`;
          countEl.title = `${on} of ${all.length} subreddits are on the map`;
          const list = picker.querySelector('.rrm-g-pickerList');
          if (!picker.classList.contains('is-open')) { list.innerHTML = ''; return; }

          const q = graphPickerFilter;
          const shown = q ? all.filter(entry => entry.name.toLowerCase().includes(q)) : all;
          const scroll = list.scrollTop;
          list.innerHTML = '';
          if (!shown.length) {
            const empty = document.createElement('div');
            empty.className = 'rrm-g-pickerEmpty';
            empty.textContent = all.length ? 'Nothing matches that.' : 'No subreddits known yet — refresh the Queue.';
            list.appendChild(empty);
            return;
          }
          shown.forEach(entry => {
            const row = document.createElement('button');
            row.className = 'rrm-g-pickerRow' + (entry.saved ? ' is-on' : '');
            row.type = 'button';
            const box = document.createElement('span');
            box.className = 'rrm-g-pickerBox';
            const name = document.createElement('span');
            name.className = 'rrm-g-pickerName';
            name.textContent = 'r/' + entry.name;
            const num = document.createElement('span');
            num.className = 'rrm-g-pickerNum';
            num.textContent = entry.count ? String(entry.count) : '';
            row.title = entry.saved
              ? `On the map and joined. Click to leave r/${entry.name} and remove it.`
              : `Click to join r/${entry.name} and put it on the map.`
              + (entry.count ? ` ${entry.count} post${entry.count === 1 ? '' : 's'} from your saved users.` : '');
            row.appendChild(box);
            row.appendChild(name);
            row.appendChild(num);
            row.addEventListener('click', () => { toggleGraphSubreddit(entry.key, entry.name); });
            list.appendChild(row);
          });
          list.scrollTop = scroll;
        }

        // Entry point for the Graph tab. Rebuilds the scene only when the saved
        // set itself changed — typing in the filter must not restart the settle.
        function renderGraphView() {
          const host = winEl && winEl.querySelector('#rrm-graph');
          if (!host) return;
          const model = buildGraphModel();
          const nodes = model.nodes.filter(n => typeFilter === 'all' || n.type === typeFilter);
          const keep = new Set(nodes.map(n => n.id));
          const links = model.links.filter(l => keep.has(l.source.id) && keep.has(l.target.id));

          if (!nodes.length) {
            stopGraphSim();
            graphAlpha = 0;
            graphBuilt = { sig: 'empty', host, svg: null, scene: null, nodes: [], links: [], compCount: 1 };
            clearGraphHostChrome(host);
            const empty = document.createElement('div');
            empty.className = 'rrm-g-empty';
            empty.innerHTML = 'Nothing to map yet.<br>Save a user, Refresh the Queue so the map learns where they post, then pick subreddits from the corner menu.';
            host.appendChild(empty);
            renderGraphPicker(host);
            renderGraphJumpBar(host);
            return;
          }

          const sig = nodes.map(n => n.id + (n.finished ? 'F' : '-') + (n.saved ? 'S' : '-') + n.degree).sort().join('|')
            + '#' + links.length;
          if (sig === graphBuilt.sig && graphBuilt.host === host && graphBuilt.svg && graphBuilt.svg.isConnected) {
            applyGraphHighlight();
            if (!graphUserMoved) fitGraphToView();
            if (graphAlpha > 0) runGraphSim(graphAlpha);
            return;
          }

          stopGraphSim();
          graphAlpha = 0;
          graphBuilt.sig = sig;
          graphUserMoved = false;
          buildGraphScene(host, nodes, links);
          runGraphSim(1);
        }

        // ------------------------------------------------------------- lifecycle
        // The saved list shares the unified window; it's "open" whenever that window is
        // mounted and not collapsed into just its header.
        function isWindowOpen() { return !!(winEl && !winEl.classList.contains('rg-collapsed')); }

        // Re-render the saved list after the window is expanded or resized.
        function resize() {
          renderGraph();
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
          if (typeof GM_addValueChangeListener === 'function') {
            GM_addValueChangeListener(REV, () => { scheduleRender(); });
          }
        }

        return { bootstrap, mount, resize, refreshButton, recordScan, addSubreddits, addNode, hasNode, removeNode, setView, setColumnType, refreshBlockedPanel: renderBlockedPanel, syncWithReddit, unsubscribeSavedNode,
                 refreshQueuePanel: renderQueuePanel,
                 isPostDownloaded, markPostsDownloaded, recordUserHistory, loadUserHistory, userDownloadProgress,
                 subredditsForUser, savedUserNodes, userNameFromNode, showDownloadedPosts, setShowDownloadedPosts };
      })();

      if (window.__stripperRrmLoaded) { /* avoid double saved-list bootstrap if injected twice */ }
      else {
        window.__stripperRrmLoaded = true;
        // Never let a rabbithole boot failure (a rejected GM write, a corrupt
        // stored value) abort init() below — that would hide the whole UI. The
        // logged error is the diagnostic: check the console next time it breaks.
        try { rabbithole.bootstrap(); }
        catch (e) { try { console.warn('[Stripper] rabbithole bootstrap failed; continuing without the saved list.', e); } catch (e2) {} }
      }

      // If this listing is not on Top / this month it is about to be replaced, and
      // there is no point building a panel for a page that is going away. This
      // has to sit here rather than at the top of the function: the rule reads
      // constants declared in this same body, and calling it before they are
      // initialised is a temporal-dead-zone error, not an early start.
      if (!applyForcedSubredditSort()) {
        if (document.body) init();
        else window.addEventListener('DOMContentLoaded', init, { once: true });
      }
  }
})();
