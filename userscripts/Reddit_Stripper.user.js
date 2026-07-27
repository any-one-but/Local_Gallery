// ==UserScript==
// @name         Reddit Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.17.08
// @description  Reddit media + post-text (Markdown) downloader with a built-in Rabbithole saved list.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/Reddit_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/userscripts/Reddit_Stripper.user.js
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

  function stripperDateKeyFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  function stripperDateKeyFromUnix(seconds) {
    const ts = Number(seconds) || 0;
    if (!ts) return '';
    return stripperDateKeyFromDate(new Date(ts * 1000));
  }

  function stripperDateNumberFromKey(key) {
    return Number(String(key || '').replace(/\D/g, '')) || 0;
  }

  function stripperTodayDateKey() {
    return stripperDateKeyFromDate(new Date());
  }

  function parseStripperDateRangeList(raw) {
    const text = String(raw || '').trim();
    if (!text) return { ranges: [], error: 'enter a date range first' };
    const today = stripperTodayDateKey();
    const parseDateToken = (token) => {
      const value = String(token || '').trim();
      if (value === '00') return today;
      if (!/^\d{6}$/.test(value)) return '';
      const yy = Number(value.slice(0, 2));
      const mm = Number(value.slice(2, 4));
      const dd = Number(value.slice(4, 6));
      const date = new Date(Date.UTC(2000 + yy, mm - 1, dd));
      if (
        date.getUTCFullYear() !== 2000 + yy ||
        date.getUTCMonth() !== mm - 1 ||
        date.getUTCDate() !== dd
      ) return '';
      return value;
    };
    const ranges = [];
    const parts = text.split(/[\s,]+/).filter(Boolean);
    for (const part of parts) {
      const pieces = part.split('-');
      if (pieces.length > 2) return { ranges, error: `invalid date range item "${part}"` };
      const startKey = parseDateToken(pieces[0]);
      const endKey = parseDateToken(pieces[1] || pieces[0]);
      if (!startKey || !endKey) return { ranges, error: `invalid date item "${part}"` };
      let start = stripperDateNumberFromKey(startKey);
      let end = stripperDateNumberFromKey(endKey);
      if (end < start) [start, end] = [end, start];
      ranges.push({ start, end });
    }
    if (!ranges.length) return { ranges, error: 'date range did not match any scanned posts' };
    return { ranges, error: '' };
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
        pages: [],
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
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-right: 0;
          border-radius: 14px 0 0 14px;
          background: rgba(18, 18, 21, 0.94);
          box-shadow: 0 18px 56px rgba(0, 0, 0, 0.5);
          color: #f4f4f5;
          font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          backdrop-filter: blur(14px);
        }
        #redditGuestPanel, #redditGuestPanel * {
          box-sizing: border-box;
        }
        #redditGuestPanel .rg-header {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 12px;
          cursor: move;
          user-select: none;
          border-bottom: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(255, 255, 255, 0.04);
          border-radius: 14px 0 0 0;
        }
        #redditGuestPanel .rg-title {
          flex: 1;
          font-weight: 800;
          font-size: 13px;
          letter-spacing: .3px;
          color: #f4f4f5;
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
          min-height: 30px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: #d8d8dd;
          font-weight: 700;
          font-size: 11px;
        }
        #redditGuestPanel .rg-modeBtn:hover:not(.is-active) {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(255, 255, 255, 0.24);
        }
        #redditGuestPanel .rg-modeBtn.is-active {
          background: #ff4500;
          color: #fff;
          border-color: rgba(255, 255, 255, 0.28);
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
        #redditGuestPanel[data-mode="blocked"] .rg-sidebar {
          display: none;
        }
        /* Let the search box absorb the freed width so it grows with the panel
           instead of leaving a gap before the buttons. */
        #redditGuestPanel[data-mode="column"] #rrm-search {
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
          border-radius: 14px 0 0 14px;
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
          color: #b6b6bf;
          font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        #redditGuestPanel .rg-typeChip:hover {
          border-color: rgba(255, 255, 255, 0.3);
          color: #e8e8ee;
        }
        #redditGuestPanel .rg-typeChip.is-on {
          color: #fff;
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
          flex: 0 0 auto;
          min-height: 120px;
          max-height: 240px;
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
          color: #d8d8dd;
          font-size: 11px;
          font-weight: 700;
        }
        #redditGuestPanel .rg-subsCount {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #a9a9b2;
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
          color: #fff;
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
          color: #e8e8ee;
          text-decoration: none;
          font-size: 12px;
          font-weight: 600;
        }
        #redditGuestPanel .rg-subRow:hover .rg-subLink {
          color: #fff;
        }
        #redditGuestPanel .rg-subN {
          flex: 0 0 auto;
          padding: 1px 7px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.12);
          color: #d8d8dd;
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
          color: #fff;
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
          color: #fff;
        }
        #redditGuestPanel .rg-removeSaved[hidden],
        #redditGuestPanel .rg-blockProfile[hidden] {
          display: none;
        }
        .stripperBlockedProfilePost {
          display: none !important;
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
            <button id="rgCollapseBtn" class="rg-collapseBtn" type="button" title="Collapse">▴</button>
          </div>
          <div class="rg-modes">
            <button class="rg-modeBtn" type="button" data-mode="download">Download</button>
            <button class="rg-modeBtn" type="button" data-mode="column">Saved</button>
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
                  <button id="rgPagesBtn" type="button" disabled>Download All Pages</button>
                  <button id="rgUserBtn" type="button" disabled>Download User Backlog</button>
                </div>
                <div id="rgPostRangeRow" class="rg-rangeRow">
                  <input id="rgPostRangeInput" type="text" inputmode="numeric" placeholder="Posts 1-0">
                  <button id="rgPostRangeBtn" type="button" disabled>Download Posts</button>
                </div>
                <div id="rgPageRangeRow" class="rg-rangeRow">
                  <input id="rgPageRangeInput" type="text" inputmode="numeric" placeholder="Pages 1-0">
                  <button id="rgPageRangeBtn" type="button" disabled>Download Pages</button>
                </div>
                <div id="rgDateRangeRow" class="rg-rangeRow">
                  <input id="rgDateRangeInput" type="text" placeholder="Date 260506-00">
                  <button id="rgDateRangeBtn" type="button" disabled>Download Dates</button>
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
        ui.pagesBtn = panel.querySelector('#rgPagesBtn');
        ui.userBtn = panel.querySelector('#rgUserBtn');
        ui.fill = panel.querySelector('#rgProgressFill');
        ui.profileLabel = panel.querySelector('#rgProfileLabel');
        ui.countLabel = panel.querySelector('#rgCountLabel');
        ui.selectiveDownloads = panel.querySelector('#rgSelectiveDownloads');
        ui.postRangeRow = panel.querySelector('#rgPostRangeRow');
        ui.postRangeInput = panel.querySelector('#rgPostRangeInput');
        ui.postRangeBtn = panel.querySelector('#rgPostRangeBtn');
        ui.pageRangeRow = panel.querySelector('#rgPageRangeRow');
        ui.pageRangeInput = panel.querySelector('#rgPageRangeInput');
        ui.pageRangeBtn = panel.querySelector('#rgPageRangeBtn');
        ui.dateRangeRow = panel.querySelector('#rgDateRangeRow');
        ui.dateRangeInput = panel.querySelector('#rgDateRangeInput');
        ui.dateRangeBtn = panel.querySelector('#rgDateRangeBtn');
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
        ui.mapCount = panel.querySelector('#rgMapCount');
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
        makePanelDraggable(panel, ui.header);
        ui.scanBtn.addEventListener('click', () => scanCurrentProfile());
        ui.postBtn.addEventListener('click', () => downloadPostArchives());
        ui.postsBtn.addEventListener('click', () => downloadPostArchives());
        ui.pagesBtn.addEventListener('click', () => downloadPageArchives());
        ui.userBtn.addEventListener('click', () => downloadUserArchive());
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
        ui.pageRangeBtn.addEventListener('click', () => downloadSelectedPageArchives());
        ui.dateRangeBtn.addEventListener('click', () => downloadSelectedDateArchives());
        installPageChangeObserver();
        installRedditSubscriptionClickSync();
        document.addEventListener('keydown', handleGlobalKeydown, true);

        // The saved list is mounted into the main body; the mode switcher decides
        // whether the strip shows downloads or saved items.
        rabbithole.mount(panel.querySelector('#rgMain'), panel);
        setColumnType('user');
        setMode('download');

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
        if (!state.busy) syncUi();
        filterBlockedProfilePosts();
        if (ui.mode === 'column') rabbithole.resize();
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

      function filterBlockedProfilePosts() {
        const blocked = loadStripperBlockedUsers();
        if (typeof rabbithole !== 'undefined' && rabbithole.hiddenProfileNames) {
          rabbithole.hiddenProfileNames().forEach(name => blocked.add(name));
        }
        const hasBlocks = blocked.size > 0;
        const shouldFilter = hasBlocks && isBlockedFeedLocation();
        feedPostCandidates().forEach(post => {
          const author = postAuthorName(post);
          const hide = shouldFilter && author && blocked.has(author);
          post.classList.toggle('stripperBlockedProfilePost', !!hide);
          if (hide) post.setAttribute('data-stripper-blocked-author', author);
          else post.removeAttribute('data-stripper-blocked-author');
        });
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

      function postDatePlaceholder() {
        const keys = state.posts
          .map(post => stripperDateKeyFromUnix(post.createdUtc))
          .filter(Boolean)
          .sort();
        if (!keys.length) return `Date ${stripperTodayDateKey()}-00`;
        return `Date ${keys[0]}-${keys[keys.length - 1]}`;
      }

      function baseFileCountText() {
        if (state.fileProgressOverride) return state.fileProgressOverride;
        return `${state.files.length} file${state.files.length === 1 ? '' : 's'}`;
      }

      function syncUi() {
        const context = scanContextFromLocation();
        const currentSaved = isCurrentContextSaved(context);
        const hasFiles = state.files.length > 0;
        const hasPages = state.pages.length > 0;
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
        ui.pagesBtn.disabled = state.busy || !hasPages;
        ui.userBtn.disabled = state.busy || !hasFiles;
        ui.selectiveDownloads.hidden = !(isProfileScan && hasFiles);
        ui.postRangeInput.placeholder = state.posts.length ? `Posts 1-${state.posts.length}` : 'Posts none';
        ui.postRangeInput.disabled = state.busy || !state.posts.length;
        ui.postRangeBtn.disabled = state.busy || !state.posts.length;
        ui.pageRangeRow.hidden = !hasPages;
        ui.pageRangeInput.placeholder = hasPages ? `Pages ${formatStripperNumberRanges(state.pages.map(page => page.page))}` : 'Pages none';
        ui.pageRangeInput.disabled = state.busy || !hasPages;
        ui.pageRangeBtn.disabled = state.busy || !hasPages;
        ui.dateRangeRow.hidden = !state.posts.length;
        ui.dateRangeInput.placeholder = postDatePlaceholder();
        ui.dateRangeInput.disabled = state.busy || !state.posts.length;
        ui.dateRangeBtn.disabled = state.busy || !state.posts.length;
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

      // The right-docked strip shows one view at a time: the downloader sidebar,
      // saved list, or blocked list.
      function setMode(mode) {
        const m = ['column', 'blocked'].includes(mode) ? mode : 'download';
        ui.mode = m;
        ui.panel.setAttribute('data-mode', m);
        if (ui.modeBtns) ui.modeBtns.forEach(b => b.classList.toggle('is-active', b.dataset.mode === m));
        if (m === 'column') rabbithole.setView('columns');
        else if (m === 'blocked') rabbithole.setView('blocked');
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
        state.pages = safeCachedArray(payload.pages);
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
          pages: state.pages.length,
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
          pages: state.pages.length,
          posts: state.posts.length,
          images,
          videos,
          textOnlyPosts
        };
      }

      function logProfileStats() {
        const stats = computeProfileStats();
        logLine(`${stats.files} Files`);
        logLine(`${stats.pages} Pages`);
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
        state.pages = [];
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
          const deduped = built.deduped;
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

          // Hand a summary to the saved list for this item.
          state.summary = computeScanSummary();
          state.summaryNodeId = scannedNodeId(context);
          if (state.summaryNodeId) rabbithole.recordScan(state.summaryNodeId, state.summary, scannedRabbitholeNode(context));
          renderSubsPanel();

          state.loadedScanCacheKey = cacheKey;
          setProgress(100);
          logLine(`Scan complete: ${state.posts.length} post folder${state.posts.length === 1 ? '' : 's'}, ${state.pages.length} page archive${state.pages.length === 1 ? '' : 's'}, ${state.files.length} unique file${state.files.length === 1 ? '' : 's'}.`);
          if (context.type === 'profile') logProfileStats();
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
        return { parsed, deduped: buildDedupedDownloads(mediaPosts) };
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

      function selectedRedditPostsFromDateRange() {
        const parsed = parseStripperDateRangeList(ui.dateRangeInput.value);
        if (parsed.error) {
          logLine(`Date range error: ${parsed.error}.`);
          return [];
        }
        return state.posts.filter(post => {
          const key = stripperDateNumberFromKey(stripperDateKeyFromUnix(post.createdUtc));
          return key && parsed.ranges.some(range => key >= range.start && key <= range.end);
        });
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

      async function downloadSelectedDateArchives() {
        if (state.busy) return;
        const selected = selectedRedditPostsFromDateRange();
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
        try {
          let done = 0;
          let completedFiles = 0;
          for (const item of archiveItems) {
            const files = item.files;
            const firstFile = files[0];
            const archiveName = buildArchiveName(firstFile.userFolder || state.userFolder, firstFile.postFolder);
            logLine(`Building post zip ${done + 1}/${archiveItems.length}: ${firstFile.postFolder}`);
            await buildAndSaveArchive(files, archiveName, (pct, label) => {
              const base = (done / archiveItems.length) * 100;
              const span = 100 / archiveItems.length;
              setProgress(base + (pct / 100) * span);
              if (label) logLine(label);
            }, (fileDone) => {
              setFileProgressOverride(completedFiles + fileDone, totalFiles);
            });
            completedFiles += files.length;
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
            const page = item.page;
            const files = item.files;
            const archiveName = buildPageArchiveName(state.userFolder, page.page);
            logLine(`Building page zip ${done + 1}/${archiveItems.length}: API page ${page.page}, ${page.posts.length} post${page.posts.length === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'}.`);
            await buildAndSaveArchive(files, archiveName, (pct, label) => {
              const base = (done / archiveItems.length) * 100;
              const span = 100 / archiveItems.length;
              setProgress(base + (pct / 100) * span);
              if (label) logLine(label);
            }, (fileDone) => {
              setFileProgressOverride(completedFiles + fileDone, totalFiles);
            });
            completedFiles += files.length;
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
    
      async function downloadUserArchive() {
        if (state.busy || !state.files.length) return;
        const files = filterFilesByType(state.files);
        if (!files.length) {
          logLine('No files match the selected file types.');
          return;
        }
        setBusy(true, 'Downloading...');
        setProgress(0);
        setFileProgressOverride(0, files.length);
        setCountTextOverride('');
        try {
          const archiveName = buildArchiveName(state.userFolder, state.userFolder || 'reddit_user');
          logLine(`Building user zip for u/${state.username}.`);
          await buildAndSaveArchive(
            files,
            archiveName,
            (pct) => setProgress(pct),
            (done, total) => setFileProgressOverride(done, total)
          );
          setProgress(100);
          logLine(`Downloaded user archive with ${files.length} file${files.length === 1 ? '' : 's'}.`);
        } catch (err) {
          logLine(`User download failed: ${errorMessage(err)}`);
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

        function hiddenProfileNames() {
          const out = new Set();
          loadGraph().nodes.forEach(n => {
            if (!n || n.type !== 'user' || !n.scraped) return;
            const fromId = String(n.id || '').replace(/^user:/, '');
            const fromLabel = String(n.label || '').replace(/^u\//i, '');
            const name = normalizeRedditUsername(fromId || fromLabel);
            if (name) out.add(name);
          });
          return out;
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

        // Cross a saved item off (mark "scraped") without deleting it or its links.
        function setScraped(id, scraped) {
          const key = NS + 'n:' + id;
          const raw = GM_getValue(key, null);
          if (!raw) return;
          const rec = JSON.parse(raw);
          rec.scraped = !!scraped;
          GM_setValue(key, JSON.stringify(rec));
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

        function normalizeSubredditName(name) {
          return String(name || '')
            .trim()
            .replace(/^\/?r\//i, '')
            .replace(/^r_/i, '')
            .toLowerCase();
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
            const blob = new Blob([JSON.stringify({ v: 1, ts: Date.now(), nodes: g.nodes, edges: g.edges }, null, 2)],
              { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'rabbithole-saved-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
            try { logLine(`Rabbithole: exported ${g.nodes.length} saved item${g.nodes.length === 1 ? '' : 's'}.`); } catch (e) {}
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
            #redditGuestPanel .rg-mapCount{padding:1px 6px;border-radius:999px;font-size:10px;font-weight:800;color:#fff;
              background:linear-gradient(90deg,#ff4500,#ffb000);}
            #redditGuestPanel .rg-mapCount[hidden]{display:none;}
            #redditGuestPanel .rg-main button, #redditGuestPanel .rg-main select{width:auto;}

            #rrm-toolbar{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;
              border-bottom:1px solid rgba(255,255,255,.10);}
            #rrm-search{flex:1;min-width:120px;height:28px;padding:0 9px;border-radius:8px;
              border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.22);color:#f4f4f5;
              font-family:inherit;font-size:12px;font-weight:600;outline:none;}
            #rrm-search:focus{border-color:rgba(255,176,0,.72);}
            #redditGuestPanel .rrm-btn{appearance:none;min-height:28px;padding:0 11px;border:1px solid rgba(255,255,255,.16);
              border-radius:8px;background:rgba(255,255,255,.11);color:#f4f4f5;font-family:inherit;font-size:11px;
              font-weight:700;cursor:pointer;white-space:nowrap;
              transition:background 120ms ease,border-color 120ms ease,opacity 120ms ease;}
            #redditGuestPanel .rrm-btn:hover:not(:disabled){background:rgba(255,255,255,.17);border-color:rgba(255,255,255,.28);}
            #redditGuestPanel .rrm-btn:disabled{opacity:.42;cursor:default;}
            #redditGuestPanel .rrm-btn.primary{background:#ff4500;}
            #redditGuestPanel .rrm-btn.primary:hover:not(:disabled){background:#ff5c1c;}
            #redditGuestPanel .rrm-btn.danger{background:rgba(255,69,0,.16);border-color:rgba(255,69,0,.5);}
            #redditGuestPanel .rrm-btn.danger:hover:not(:disabled){background:rgba(255,69,0,.28);border-color:rgba(255,69,0,.7);}
            #redditGuestPanel .rrm-btn.icon{padding:0;width:28px;}
            #rrm-blocked-panel{flex:0 0 auto;display:flex;flex-direction:column;gap:5px;padding:8px 10px;
              border-bottom:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.16);}
            #rrm-blocked-panel[hidden]{display:none;}
            #redditGuestPanel #rgMain[data-rrm-view="blocked"] #rrm-blocked-panel{flex:1 1 auto;overflow:auto;
              border-bottom:0;background:transparent;padding:10px;}
            #rrm-blocked-panel .rrm-blocked-empty{color:#8f8f98;font-size:11px;padding:2px 0;}
            #rrm-blocked-panel .rrm-blocked-row{display:flex;align-items:center;gap:6px;}
            #rrm-blocked-panel .rrm-blocked-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
              color:#f4f4f5;font-size:12px;font-weight:700;}
            #redditGuestPanel #rrm-blocked-panel .rrm-blocked-action{flex:0 0 auto;width:auto;min-height:26px;padding:0 9px;
              font-size:11px;background:rgba(255,255,255,.09);}
            #redditGuestPanel #rrm-blocked-panel .rrm-blocked-action.rm{background:rgba(255,69,0,.16);border-color:rgba(255,69,0,.5);}
            #rrm-foot{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:8px 11px;
              border-top:1px solid rgba(255,255,255,.10);font-size:11px;color:#a9a9b2;}
            #rrm-foot .rrm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px;}
            #rrm-count{color:#d8d8dd;font-weight:700;}
            #redditGuestPanel .rrm-select{height:28px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.16);
              background:rgba(0,0,0,.22);color:#f4f4f5;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;outline:none;}
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
              color:#cfcfd6;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);
              border-radius:999px;padding:2px 9px;user-select:none;white-space:nowrap;
              transition:background 120ms ease,color 120ms ease,border-color 120ms ease;}
            #redditGuestPanel #rrm-columns .rrm-col-ctl:hover{background:rgba(255,255,255,.18);color:#fff;
              border-color:rgba(255,255,255,.3);}
            #redditGuestPanel #rrm-columns .rrm-row-rating{flex:0 0 auto;box-sizing:border-box;width:46px;height:26px;
              padding:0 4px;text-align:center;border-radius:8px;border:1px solid rgba(255,255,255,.14);
              background:rgba(0,0,0,.22);color:#f4f4f5;font-family:inherit;font-size:11px;font-weight:700;outline:none;}
            #redditGuestPanel #rrm-columns .rrm-row-rating:focus{border-color:rgba(255,176,0,.72);}
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
            #rrm-columns .rrm-row.scraped{opacity:.58;}
            #rrm-columns .rrm-row.scraped .rrm-row-link{text-decoration:none;color:#7c7c84;}
            #redditGuestPanel #rrm-columns .rrm-row-btn{flex:0 0 auto;box-sizing:border-box;
              width:28px;height:28px;min-width:28px;min-height:0;aspect-ratio:1/1;padding:0;border-radius:9px;
              display:inline-flex;align-items:center;justify-content:center;line-height:1;
              border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#d8d8dd;
              font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;}
            #rrm-columns .rrm-row-btn:hover{background:rgba(255,255,255,.16);}
            #rrm-columns .rrm-row-btn.rm:hover{background:rgba(255,69,0,.28);border-color:rgba(255,69,0,.6);}
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
              <button class="rrm-btn" data-act="export" title="Download the saved list as a JSON backup">Export</button>
              <button class="rrm-btn" data-act="import" title="Merge a previously exported JSON file">Import</button>
              <button class="rrm-btn danger" data-act="reset">Reset</button>
              <input id="rrm-file" type="file" accept="application/json,.json" hidden>
            </div>
            <div id="rrm-blocked-panel" hidden></div>
            <div id="rrm-columns"></div>
            <div id="rrm-foot">
              <span><span class="rrm-dot" style="background:${COLORS.sub}"></span>subreddit</span>
              <span><span class="rrm-dot" style="background:${COLORS.user}"></span>user</span>
              <span><span class="rrm-dot" style="background:${COLORS.post}"></span>post</span>
              <span style="opacity:.7">✓ dim = checked · saved items can be opened or removed</span>
              <span style="flex:1"></span>
              <span id="rrm-count"></span>
            </div>`;

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
          view = next === 'blocked' ? 'blocked' : 'columns';
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
          if (toolbar) toolbar.hidden = view === 'blocked';
          const colsEl = winEl.querySelector('#rrm-columns');
          const blockedEl = winEl.querySelector('#rrm-blocked-panel');
          if (colsEl) colsEl.style.display = view === 'columns' ? 'flex' : 'none';
          if (blockedEl) blockedEl.hidden = view !== 'blocked';

          const g = loadGraph();
          const visible = getVisible(g.nodes);

          if (view === 'blocked') renderBlockedPanel();
          else renderColumns(g.nodes);

          const c = winEl.querySelector('#rrm-count');
          if (c) {
            if (view === 'blocked') {
              const total = loadStripperBlockedUsers().size;
              c.textContent = `${total} blocked`;
            } else {
              const total = g.nodes.length;
              const filtered = !!(query || typeFilter !== 'all');
              c.textContent = filtered
                ? `${visible.length} / ${total} saved`
                : `${total} saved`;
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

        function buildColumnRow(n) {
          const row = document.createElement('div');
          row.className = 'rrm-row' + (n.scraped ? ' scraped' : '');

          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.className = 'rrm-row-chk';
          chk.checked = !!n.scraped;
          chk.title = n.type === 'user' ? 'Hide this profile in feeds' : 'Cross off (mark scraped)';
          chk.addEventListener('change', () => {
            setScraped(n.id, chk.checked);
            renderGraph();
            if (n.type === 'user') filterBlockedProfilePosts();
          });

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

          row.appendChild(chk);
          row.appendChild(link);
          row.appendChild(rating);
          row.appendChild(openCur);
          row.appendChild(rm);
          return row;
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

        return { bootstrap, mount, resize, refreshButton, recordScan, addSubreddits, addNode, hasNode, removeNode, setView, setColumnType, hiddenProfileNames, refreshBlockedPanel: renderBlockedPanel, syncWithReddit, unsubscribeSavedNode };
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

      if (document.body) init();
      else window.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
