// ==UserScript==
// @name         Pawchive Stripper
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.02.01
// @description  Pawchive post downloader: one zip per post, filed by creator, with a saved creator list that knows what is left to download.
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/Pawchive_Stripper.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/safekeeping/userscripts/Pawchive_Stripper.user.js
// @match        *://pawchive.pw/*
// @match        *://*.pawchive.pw/*
// @match        *://pawchive.st/*
// @match        *://*.pawchive.st/*
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
// @connect      pawchive.pw
// @connect      *.pawchive.pw
// @connect      pawchive.st
// @connect      *.pawchive.st
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // Built the way the Reddit Stripper is built, and it starts the same way: at
  // the *bottom* of this file. Every const below exists only once its line has
  // run, so the one call that starts the script comes after all of them.
  //
  // What carries over from the Reddit Stripper: the docked panel, Add then Scan,
  // one zip per post named `YYMMDD-creator-000001 - title` inside a folder per
  // creator, Download All / a post range / Post text, a download record that
  // skips what you already have, a Saved list that says how much of each
  // creator is still waiting, placeholders for files that are gone for good,
  // and a Stop that stops now. What does not: everything about Reddit itself
  // (subreddits, the map, RedGIFs, subscriptions, blocking, the folder check).

  const API_DELAY_MIN = 850;
  const API_DELAY_JITTER = 650;
  const FILE_DELAY_MS = 220;
  const MAX_API_PAGES = 1000;
  // Pawchive answers a creator listing 50 posts at a time. A shorter page is the
  // last one; so is an empty one, which is what follows a creator whose post
  // count is an exact multiple of 50.
  const PAGE_SIZE = 50;
  const MAX_RETRIES = 2;
  const BACKOFF_BASE = 900;
  const BLOB_TIMEOUT_MS = 180000;
  // Files are served from their own host rather than the page's. The page's own
  // /data path is kept as a second candidate in case that ever changes.
  const FILE_HOST = 'https://file.pawchive.pw';

  const IMAGE_EXTS = new Set(['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp']);
  const VIDEO_EXTS = new Set(['avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'webm', 'wmv']);

  // The only two answers that mean a file will never be there again. A timeout,
  // a 429 or a 5xx is a bad afternoon, not a deletion, and is retried next run.
  const MEDIA_GONE_STATUSES = new Set([404, 410]);

  const KEYS = {
    creators: 'ps:creators',
    downloaded: 'ps:dl:',
    history: 'ps:hist:',
    rev: 'ps:rev',
    skipDownloaded: 'ps:skipDownloaded',
    showDownloaded: 'ps:showDownloaded',
    fileTypes: 'ps:fileTypes',
    panelWidth: 'ps:panelWidth',
    mode: 'ps:mode'
  };

  // The site accent: the colour of Pawchive's paw logo. It is already warm, so
  // it goes on the dark panel as it is.
  const ACCENT = '#cc9d97';
  const ACCENT_HOVER = '#dab3ad';
  const ACCENT_RGB = '204, 157, 151';
  const acc = alpha => `rgba(${ACCENT_RGB}, ${alpha})`;

  const PANEL_WIDTH_DEFAULT = 512;
  const PANEL_WIDTH_MIN = 300;

  function stripperVersion() {
    try {
      const v = typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version;
      if (v) return String(v);
    } catch (e) {}
    return '(unknown)';
  }

  // ------------------------------------------------------------------ storage

  function readJson(key, fallback) {
    try {
      const v = GM_getValue(key, null);
      if (v == null) return fallback;
      return typeof v === 'string' ? JSON.parse(v) : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { GM_setValue(key, JSON.stringify(value)); } catch (e) {}
  }

  function deleteKey(key) {
    try { GM_deleteValue(key); } catch (e) {}
  }

  function listKeys(prefix) {
    try { return GM_listValues().filter(k => typeof k === 'string' && k.startsWith(prefix)); } catch (e) { return []; }
  }

  // Every other open Pawchive tab listens on this, so a download finished in one
  // tab is reflected in the counts of the others without a reload.
  function bumpRev() {
    try { GM_setValue(KEYS.rev, (Number(GM_getValue(KEYS.rev, 0)) || 0) + 1); } catch (e) {}
  }

  function readFlag(key, fallback) {
    try {
      const v = GM_getValue(key, fallback);
      return typeof v === 'boolean' ? v : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function creatorKey(service, userId) {
    return `${String(service || '').toLowerCase()}:${String(userId || '')}`;
  }

  // Saved creators: { key: { key, service, userId, name, addedAt } }.
  function loadCreators() {
    const v = readJson(KEYS.creators, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  function isCreatorSaved(key) {
    return !!(key && loadCreators()[key]);
  }

  function saveCreator(rec) {
    const all = loadCreators();
    all[rec.key] = Object.assign({ addedAt: Date.now() }, all[rec.key] || {}, rec);
    writeJson(KEYS.creators, all);
    bumpRev();
  }

  // Removing a creator leaves their download record alone. Add them back and
  // what you already have is still known to be had.
  function removeCreator(key) {
    const all = loadCreators();
    if (!all[key]) return false;
    delete all[key];
    writeJson(KEYS.creators, all);
    bumpRev();
    return true;
  }

  // The download record: one list of post ids per creator. A post is recorded
  // only once its zip has actually been saved.
  const downloadedCache = new Map();

  function downloadedSet(key) {
    if (!downloadedCache.has(key)) {
      const v = readJson(KEYS.downloaded + key, []);
      downloadedCache.set(key, new Set(Array.isArray(v) ? v.map(String) : []));
    }
    return downloadedCache.get(key);
  }

  function isPostDownloaded(key, postId) {
    return !!(key && postId != null && downloadedSet(key).has(String(postId)));
  }

  function markPostsDownloaded(key, ids) {
    const set = downloadedSet(key);
    let changed = 0;
    ids.forEach(id => {
      const pid = String(id);
      if (set.has(pid)) return;
      set.add(pid);
      changed++;
    });
    if (changed) {
      writeJson(KEYS.downloaded + key, [...set]);
      bumpRev();
    }
    return changed;
  }

  // Forget what was downloaded for one creator, so their whole backlog reads as
  // waiting again. What they have posted (the history) is a fact about them and
  // is kept, so the badge reads 0/16 at once rather than an unknown "?".
  function resetCreatorDownloads(key) {
    downloadedCache.delete(key);
    deleteKey(KEYS.downloaded + key);
    bumpRev();
  }

  // The folder is the record: these ids are what you have for this creator,
  // and anything not in the list is forgotten. Only the folder check calls this,
  // and only once it has seen both the folder and the whole post list.
  function replaceCreatorDownloads(key, ids) {
    const next = [...new Set((ids || []).map(String).filter(Boolean))];
    const before = downloadedSet(key).size;
    downloadedCache.delete(key);
    if (next.length) writeJson(KEYS.downloaded + key, next);
    else deleteKey(KEYS.downloaded + key);
    bumpRev();
    return { kept: next.length, before };
  }

  // What a creator had posted the last time they were scanned or checked: the
  // ids of posts that carry an image or a video. That list is the denominator
  // of every "3/16" on the Saved tab.
  function loadHistory(key) {
    const v = readJson(KEYS.history + key, null);
    return v && Array.isArray(v.mediaIds) ? v : null;
  }

  function recordHistory(key, mediaIds) {
    writeJson(KEYS.history + key, { mediaIds: [...new Set(mediaIds.map(String))], checkedAt: Date.now() });
    bumpRev();
  }

  function creatorProgress(key) {
    const history = loadHistory(key);
    if (!history) return { known: false, media: 0, downloaded: 0, pending: 0 };
    const set = downloadedSet(key);
    const media = history.mediaIds.length;
    const downloaded = history.mediaIds.reduce((n, id) => n + (set.has(String(id)) ? 1 : 0), 0);
    return { known: true, media, downloaded, pending: media - downloaded, checkedAt: history.checkedAt };
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
    if (!out.size) return { numbers: out, error: 'range did not match any scanned posts' };
    return { numbers: out, error: '' };
  }

  // ------------------------------------------------------------------- the run

  function runPawchiveStripper() {
    const JSZip = window.JSZip;

    const state = {
      busy: false,
      scanType: '',
      creator: null,          // { key, service, userId, name, folder }
      posts: [],
      files: [],
      countTextOverride: '',
      fileProgressOverride: '',
      // The page the scan on screen was taken on. Leave that page and the scan
      // is dropped, so a Download button can never act on a creator you are no
      // longer looking at.
      scanPageKey: '',
      checkingKey: '',
      resetArmedKey: '',
      // What is running, so each Stop-able button knows whether it is the one
      // that started it: 'scan', 'download', 'refresh' or 'folder'.
      job: '',
      // Which saved creator the folder picker is about to answer for, or, for
      // Check all, that it is answering for a whole parent folder instead.
      folderTarget: '',
      folderBulk: false,
      mode: 'download'
    };

    const ui = {};

    const ICONS = {
      skip: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5l6 4.5-6 4.5z"/><path d="M12 3.5v9"/></svg>',
      eye: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/></svg>',
      eyeOff: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><path d="M2.5 13.5l11-11"/></svg>',
      open: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5L7 9"/><path d="M11.5 9.5v4h-9v-9h4"/></svg>',
      remove: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8"/><path d="M12 4l-8 8"/></svg>',
      recheck: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.46-3.54"/><path d="M13 2.5v3h-3"/></svg>',
      reset: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.46-3.54"/><path d="M3 2.5v3h3"/><path d="M8 5.5V8l1.8 1.2"/></svg>',
      folder: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 12.5V4a1 1 0 0 1 1-1h3.3l1.6 2h6.1a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/><path d="M5.4 9.2l1.9 1.9 3.6-3.6"/></svg>',
      busy: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12" cy="8" r="1"/></svg>'
    };

    GM_addStyle(`
      #pawchiveStripperPanel {
        position: fixed;
        right: 0;
        top: 0;
        z-index: 2147483646;
        box-sizing: border-box;
        width: ${PANEL_WIDTH_DEFAULT}px;
        height: 100vh;
        min-width: ${PANEL_WIDTH_MIN}px;
        max-width: 80vw;
        max-height: 100vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        resize: horizontal;
        border: 1px solid ${acc(0.4)};
        border-right: 0;
        border-radius: 10px 0 0 10px;
        background: #141210;
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
        color: #f2ece1;
        font: 700 12px/1.35 Arial, Helvetica, sans-serif;
        text-align: left;
        letter-spacing: 0;
      }
      #pawchiveStripperPanel, #pawchiveStripperPanel * { box-sizing: border-box; }
      #pawchiveStripperPanel .ps-header {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 38px;
        padding: 0 10px 0 12px;
        cursor: move;
        user-select: none;
        border-bottom: 1px solid rgba(255, 255, 255, 0.10);
        background: linear-gradient(90deg, #33261a, #1a1613);
      }
      #pawchiveStripperPanel .ps-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 900;
        font-size: 12px;
        color: ${ACCENT};
      }
      #pawchiveStripperPanel button {
        appearance: none;
        width: 100%;
        min-height: 32px;
        margin: 0;
        padding: 0 10px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        color: #cfc2ae;
        font: 700 12px/1 Arial, Helvetica, sans-serif;
        text-transform: none;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
      }
      #pawchiveStripperPanel button:hover:not(:disabled) {
        background: ${acc(0.18)};
        border-color: ${acc(0.55)};
        color: #f2ece1;
      }
      #pawchiveStripperPanel button:disabled { cursor: default; opacity: 0.42; }
      #pawchiveStripperPanel .ps-headBtn {
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        min-height: 0;
        padding: 0;
        border-radius: 7px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
      }
      #pawchiveStripperPanel .ps-headBtn.is-on {
        background: ${acc(0.2)};
        border-color: ${acc(0.55)};
        color: #f2ece1;
      }
      #pawchiveStripperPanel svg {
        display: block;
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      #pawchiveStripperPanel .ps-modes {
        flex: 0 0 auto;
        display: flex;
        gap: 6px;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.10);
        background: rgba(255, 255, 255, 0.02);
      }
      #pawchiveStripperPanel .ps-modeBtn {
        flex: 1 1 0;
        min-width: 0;
        min-height: 28px;
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.05);
        font-size: 11px;
      }
      #pawchiveStripperPanel .ps-modeBtn.is-active {
        background: ${acc(0.2)};
        border-color: ${acc(0.55)};
        color: #f2ece1;
      }
      #pawchiveStripperPanel .ps-tabCount {
        display: inline-block;
        margin-left: 6px;
        padding: 0 6px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.32);
        font-size: 9px;
        font-weight: 900;
        vertical-align: 1px;
      }
      #pawchiveStripperPanel .ps-tabCount[hidden] { display: none; }
      #pawchiveStripperPanel .ps-body {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      #pawchiveStripperPanel .ps-pane {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
      }
      #pawchiveStripperPanel[data-mode="download"] .ps-savedPane,
      #pawchiveStripperPanel[data-mode="saved"] .ps-downloadPane { display: none; }
      #pawchiveStripperPanel.ps-collapsed {
        height: auto !important;
        resize: none;
      }
      #pawchiveStripperPanel.ps-collapsed .ps-modes,
      #pawchiveStripperPanel.ps-collapsed .ps-body { display: none; }
      #pawchiveStripperPanel.ps-collapsed .ps-header { border-bottom: 0; }

      /* The one thing you are probably here to do, on either pane. */
      #pawchiveStripperPanel .ps-primary {
        background: ${ACCENT};
        border-color: ${acc(0.55)};
        color: #141210;
        font-weight: 900;
      }
      #pawchiveStripperPanel .ps-primary:hover:not(:disabled) {
        background: ${ACCENT_HOVER};
        border-color: ${acc(0.55)};
        color: #141210;
      }
      /* Stop is the emergency, not a sibling of Scan: its own warm dark fill,
         and only while something is running. */
      #pawchiveStripperPanel .ps-primary.ps-stop,
      #pawchiveStripperPanel .ps-primary.ps-stop:hover:not(:disabled) {
        background: #4a3323;
        border-color: ${acc(0.55)};
        color: #f2ece1;
      }
      #pawchiveStripperPanel .ps-stack { display: flex; flex-direction: column; gap: 8px; }
      #pawchiveStripperPanel .ps-stack[hidden],
      #pawchiveStripperPanel .ps-selective[hidden],
      #pawchiveStripperPanel [hidden] { display: none !important; }
      #pawchiveStripperPanel .ps-progress {
        flex: 0 0 auto;
        height: 10px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
      }
      #pawchiveStripperPanel .ps-progress > div {
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, ${ACCENT}, #ecd2c2);
        transition: width 130ms ease;
      }
      #pawchiveStripperPanel .ps-meta {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
        color: #cfc2ae;
        font-size: 11px;
      }
      #pawchiveStripperPanel .ps-meta span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #pawchiveStripperPanel .ps-selective {
        display: grid;
        gap: 8px;
        padding: 8px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
      }
      #pawchiveStripperPanel .ps-rangeRow {
        display: grid;
        grid-template-columns: 1fr 124px;
        gap: 6px;
      }
      #pawchiveStripperPanel input[type="text"] {
        width: 100%;
        min-width: 0;
        height: 30px;
        margin: 0;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 7px;
        background: #211d19;
        color: #f2ece1;
        padding: 0 8px;
        font: 700 12px/1 Arial, Helvetica, sans-serif;
        outline: none;
        box-shadow: none;
      }
      #pawchiveStripperPanel input[type="text"]::placeholder { color: #8f806b; }
      #pawchiveStripperPanel input[type="text"]:focus {
        border-color: ${acc(0.7)};
        box-shadow: 0 0 0 2px ${acc(0.14)};
      }
      #pawchiveStripperPanel .ps-search { height: 38px; padding: 0 12px; border-radius: 9px; font-size: 13px; }
      #pawchiveStripperPanel .ps-fileTypes { display: flex; flex-wrap: wrap; gap: 6px; }
      #pawchiveStripperPanel .ps-typeChip {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 0 0 auto;
        width: auto;
        min-height: 30px;
        padding: 0 12px 0 10px;
        background: rgba(255, 255, 255, 0.05);
        color: #bdb1a0;
      }
      #pawchiveStripperPanel .ps-typeChip.is-on {
        color: #f2ece1;
        border-color: ${acc(0.55)};
        background: ${acc(0.2)};
      }
      #pawchiveStripperPanel .ps-typeBox {
        position: relative;
        flex: 0 0 auto;
        width: 15px;
        height: 15px;
        border-radius: 5px;
        border: 1px solid rgba(255, 255, 255, 0.32);
        background: rgba(255, 255, 255, 0.05);
      }
      #pawchiveStripperPanel .ps-typeChip.is-on .ps-typeBox { border-color: ${ACCENT}; background: ${ACCENT}; }
      #pawchiveStripperPanel .ps-typeChip.is-on .ps-typeBox::after {
        content: "";
        position: absolute;
        left: 5px;
        top: 2px;
        width: 3px;
        height: 7px;
        border: solid #141210;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
      /* Output lives in a sunk tray that is always there, so where a run reports
         is visible before anything has run. */
      #pawchiveStripperPanel .ps-log {
        flex: 0 0 auto;
        min-height: 120px;
        max-height: 260px;
        overflow: auto;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid ${acc(0.14)};
        background: rgba(0, 0, 0, 0.22);
        color: #bdb1a0;
        font-size: 11px;
        scrollbar-width: thin;
      }
      #pawchiveStripperPanel .ps-log div { padding: 0 0 4px; overflow-wrap: anywhere; }
      #pawchiveStripperPanel .ps-log div:last-child { padding-bottom: 0; }
      #pawchiveStripperPanel .ps-quietDanger {
        margin-top: auto;
        background: rgba(163, 68, 58, 0.14);
        border-color: rgba(163, 68, 58, 0.5);
        color: #d8a49c;
      }
      #pawchiveStripperPanel .ps-quietDanger:hover:not(:disabled) {
        background: rgba(163, 68, 58, 0.28);
        border-color: rgba(163, 68, 58, 0.75);
        color: #f2ece1;
      }

      /* Saved */
      #pawchiveStripperPanel .ps-kicker {
        color: #857a68;
        font-size: 10px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: .12em;
      }
      #pawchiveStripperPanel .ps-qHead { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
      #pawchiveStripperPanel .ps-qSummary {
        flex: 1;
        min-width: 0;
        color: #bdb1a0;
        font-size: 11px;
        line-height: 1.35;
      }
      #pawchiveStripperPanel .ps-qHead button { flex: 0 0 auto; width: auto; padding: 0 14px; white-space: nowrap; }
      /* What the last folder check said, next to the buttons that start one:
         the log is on the Download tab, where you are not standing. */
      #pawchiveStripperPanel .ps-folderNote {
        flex: 0 0 auto;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid ${acc(0.28)};
        background: ${acc(0.1)};
        color: #f2ddd9;
        font-size: 11px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
      #pawchiveStripperPanel .ps-folderNote.ok { border-color: rgba(143, 191, 138, .4); background: rgba(143, 191, 138, .12); color: #8fbf8a; }
      #pawchiveStripperPanel .ps-folderNote.bad { border-color: rgba(163, 68, 58, .55); background: rgba(163, 68, 58, .18); color: #d8a49c; }
      #pawchiveStripperPanel svg circle { fill: currentColor; stroke: none; }
      #pawchiveStripperPanel .ps-list {
        flex: 1 1 auto;
        min-height: 120px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        border-radius: 10px;
        border: 1px solid ${acc(0.14)};
        background: rgba(0, 0, 0, 0.22);
        scrollbar-width: thin;
      }
      #pawchiveStripperPanel .ps-empty { padding: 8px 6px; color: #857a68; font-size: 11px; line-height: 1.5; }
      #pawchiveStripperPanel .ps-row {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        border-radius: 7px;
      }
      #pawchiveStripperPanel .ps-row:hover { background: rgba(255, 255, 255, 0.06); }
      #pawchiveStripperPanel .ps-row.done { opacity: .55; }
      #pawchiveStripperPanel .ps-row.checking { background: ${acc(0.08)}; box-shadow: inset 0 0 0 1px ${acc(0.4)}; }
      #pawchiveStripperPanel .ps-row.arming { background: rgba(163, 68, 58, .16); box-shadow: inset 0 0 0 1px rgba(163, 68, 58, .55); }
      #pawchiveStripperPanel .ps-badge {
        flex: 0 0 auto;
        min-width: 48px;
        text-align: center;
        padding: 2px 6px;
        border-radius: 999px;
        font-size: 9px;
        font-weight: 900;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        color: #857a68;
      }
      #pawchiveStripperPanel .ps-badge.ok { color: #8fbf8a; border-color: rgba(143, 191, 138, .4); background: rgba(143, 191, 138, .12); }
      #pawchiveStripperPanel .ps-badge.pending { color: #f2ddd9; border-color: ${acc(0.45)}; background: ${acc(0.18)}; }
      #pawchiveStripperPanel .ps-rowName {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 6px;
        overflow: hidden;
        white-space: nowrap;
        color: #f2ece1;
        text-decoration: none;
        font-size: 12px;
        cursor: pointer;
      }
      #pawchiveStripperPanel .ps-rowName:hover .ps-rowLabel { text-decoration: underline; }
      #pawchiveStripperPanel .ps-rowLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      #pawchiveStripperPanel .ps-rowService {
        flex: 0 0 auto;
        color: #857a68;
        font-size: 9px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: .08em;
      }
      #pawchiveStripperPanel .ps-rowBtn {
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        min-height: 0;
        padding: 0;
        border-radius: 7px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      #pawchiveStripperPanel .ps-rowBtn.rm { margin-left: 4px; }
      #pawchiveStripperPanel .ps-rowBtn.rm:hover:not(:disabled) { background: rgba(163, 68, 58, .3); border-color: rgba(163, 68, 58, .75); }
      #pawchiveStripperPanel .ps-rowBtn.armed,
      #pawchiveStripperPanel .ps-rowBtn.armed:hover:not(:disabled) {
        background: rgba(163, 68, 58, .85);
        border-color: #d8a49c;
        color: #f2ece1;
      }
      #pawchiveStripperPanel .ps-house {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 6px;
        padding-top: 14px;
        border-top: 1px solid ${acc(0.14)};
      }
      #pawchiveStripperPanel .ps-houseRow { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }

      /* On the site: a post you already have stays legible but reads as handled. */
      .psDownloadedPost { opacity: 0.45; }
      .psHiddenPost { display: none !important; }
    `);

    // ------------------------------------------------------------------ panel

    function init() {
      if (document.getElementById('pawchiveStripperPanel')) return;
      const panel = document.createElement('div');
      panel.id = 'pawchiveStripperPanel';
      panel.innerHTML = `
        <div class="ps-header">
          <span class="ps-title">Pawchive Stripper</span>
          <button id="psSkipToggle" class="ps-headBtn" type="button">${ICONS.skip}</button>
          <button id="psShowToggle" class="ps-headBtn" type="button">${ICONS.eye}</button>
          <button id="psCollapseBtn" class="ps-headBtn" type="button" title="Collapse">▴</button>
        </div>
        <div class="ps-modes">
          <button class="ps-modeBtn" type="button" data-mode="download">Download</button>
          <button class="ps-modeBtn" type="button" data-mode="saved">Saved<span id="psTabCount" class="ps-tabCount" hidden></span></button>
        </div>
        <div class="ps-body">
          <div class="ps-pane ps-downloadPane">
            <div id="psPostStack" class="ps-stack" hidden>
              <button id="psPostBtn" type="button" disabled>Download Post</button>
            </div>
            <button id="psScanBtn" class="ps-primary" type="button">Scan</button>
            <div class="ps-progress" aria-hidden="true"><div id="psProgressFill"></div></div>
            <div class="ps-meta">
              <span id="psCreatorLabel">No creator scanned</span>
              <span id="psCountLabel">0 files</span>
            </div>
            <div id="psSelective" class="ps-selective" hidden>
              <button id="psAllBtn" type="button" disabled>Download All Posts</button>
              <div class="ps-rangeRow">
                <input id="psRangeInput" type="text" inputmode="numeric" placeholder="Posts 1-0" autocomplete="off" spellcheck="false">
                <button id="psRangeBtn" type="button" disabled>Download Posts</button>
              </div>
              <div class="ps-fileTypes">
                <button class="ps-typeChip" type="button" role="checkbox" aria-checked="false" data-kind="text">
                  <span class="ps-typeBox"></span><span>Post text</span>
                </button>
                <button class="ps-typeChip" type="button" role="checkbox" aria-checked="false" data-kind="other">
                  <span class="ps-typeBox"></span><span>Other files</span>
                </button>
              </div>
            </div>
            <div id="psLog" class="ps-log" aria-live="polite"></div>
            <button id="psRemoveSavedBtn" class="ps-quietDanger" type="button" hidden>Remove Saved</button>
          </div>
          <div class="ps-pane ps-savedPane">
            <input id="psSavedSearch" class="ps-search" type="text" placeholder="Filter saved creators…" autocomplete="off" spellcheck="false">
            <div class="ps-qHead">
              <span id="psSavedSummary" class="ps-qSummary"></span>
              <button id="psFolderAllBtn" type="button">Check all</button>
              <button id="psRefreshAllBtn" class="ps-primary" type="button">Refresh all</button>
            </div>
            <div id="psFolderNote" class="ps-folderNote" hidden></div>
            <div id="psSavedList" class="ps-list"></div>
            <input id="psFolderInput" type="file" webkitdirectory directory multiple hidden>
            <div class="ps-house">
              <span class="ps-kicker">Housekeeping</span>
              <div class="ps-houseRow">
                <button id="psExportBtn" type="button" title="Save the creator list and download record as a JSON backup">Export</button>
                <button id="psImportBtn" type="button" title="Merge a backup made with Export">Import</button>
                <button id="psResetBtn" class="ps-quietDanger" type="button">Reset</button>
              </div>
              <input id="psImportFile" type="file" accept="application/json,.json" hidden>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(panel);

      ui.panel = panel;
      ui.header = panel.querySelector('.ps-header');
      ui.skipToggle = panel.querySelector('#psSkipToggle');
      ui.showToggle = panel.querySelector('#psShowToggle');
      ui.collapseBtn = panel.querySelector('#psCollapseBtn');
      ui.modeBtns = Array.from(panel.querySelectorAll('.ps-modeBtn'));
      ui.tabCount = panel.querySelector('#psTabCount');
      ui.postStack = panel.querySelector('#psPostStack');
      ui.postBtn = panel.querySelector('#psPostBtn');
      ui.scanBtn = panel.querySelector('#psScanBtn');
      ui.fill = panel.querySelector('#psProgressFill');
      ui.creatorLabel = panel.querySelector('#psCreatorLabel');
      ui.countLabel = panel.querySelector('#psCountLabel');
      ui.selective = panel.querySelector('#psSelective');
      ui.allBtn = panel.querySelector('#psAllBtn');
      ui.rangeInput = panel.querySelector('#psRangeInput');
      ui.rangeBtn = panel.querySelector('#psRangeBtn');
      ui.typeChips = Array.from(panel.querySelectorAll('.ps-typeChip'));
      ui.log = panel.querySelector('#psLog');
      ui.removeSavedBtn = panel.querySelector('#psRemoveSavedBtn');
      ui.savedSearch = panel.querySelector('#psSavedSearch');
      ui.savedSummary = panel.querySelector('#psSavedSummary');
      ui.refreshAllBtn = panel.querySelector('#psRefreshAllBtn');
      ui.folderAllBtn = panel.querySelector('#psFolderAllBtn');
      ui.folderNote = panel.querySelector('#psFolderNote');
      ui.folderInput = panel.querySelector('#psFolderInput');
      ui.savedList = panel.querySelector('#psSavedList');
      ui.importFile = panel.querySelector('#psImportFile');

      installPanelWidthMemory(panel);
      makePanelDraggable(panel, ui.header);

      ui.modeBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
      ui.collapseBtn.addEventListener('click', e => {
        e.stopPropagation();
        setCollapsed(!panel.classList.contains('ps-collapsed'));
      });
      ui.skipToggle.addEventListener('click', e => {
        e.stopPropagation();
        try { GM_setValue(KEYS.skipDownloaded, !skipDownloaded()); } catch (err) {}
        syncHeadToggles();
      });
      ui.showToggle.addEventListener('click', e => {
        e.stopPropagation();
        try { GM_setValue(KEYS.showDownloaded, !showDownloaded()); } catch (err) {}
        syncHeadToggles();
        markPostCards();
      });
      ui.scanBtn.addEventListener('click', () => {
        if (state.busy) requestStop();
        else runFromButton('Scan', () => scanCurrentPage());
      });
      ui.postBtn.addEventListener('click', () => runFromButton('Download', () => downloadPostArchives(state.posts)));
      ui.allBtn.addEventListener('click', () => runFromButton('Download', () => downloadPostArchives(state.posts)));
      ui.rangeBtn.addEventListener('click', () => runFromButton('Download', () => downloadSelectedRange()));
      ui.rangeInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !ui.rangeBtn.disabled) {
          e.preventDefault();
          runFromButton('Download', () => downloadSelectedRange());
        }
      });
      const storedTypes = readJson(KEYS.fileTypes, {});
      ui.typeChips.forEach(chip => {
        const on = !!(storedTypes && storedTypes[chip.dataset.kind]);
        setChip(chip, on);
        chip.addEventListener('click', () => {
          setChip(chip, chip.getAttribute('aria-checked') !== 'true');
          const types = {};
          ui.typeChips.forEach(c => { types[c.dataset.kind] = c.getAttribute('aria-checked') === 'true'; });
          writeJson(KEYS.fileTypes, types);
          // The counts are measured through these switches.
          syncUi();
        });
      });
      ui.removeSavedBtn.addEventListener('click', () => {
        const context = contextFromLocation();
        if (!context || context.type !== 'creator') return;
        const rec = loadCreators()[context.key];
        if (removeCreator(context.key)) logLine(`Removed ${rec && rec.name ? rec.name : context.userId} from Saved.`);
        syncUi();
        renderSaved();
      });

      ui.savedSearch.addEventListener('input', () => renderSaved());
      ui.refreshAllBtn.addEventListener('click', () => {
        if (state.busy) { if (state.job === 'refresh') requestStop(); return; }
        runFromButton('Refresh all', () => checkCreators(Object.keys(loadCreators())));
      });
      ui.folderAllBtn.addEventListener('click', () => {
        if (state.busy) { if (state.job === 'folder') requestStop(); return; }
        state.folderTarget = '';
        state.folderBulk = true;
        ui.folderInput.click();
      });
      ui.folderInput.addEventListener('change', () => {
        const target = state.folderTarget;
        const bulk = state.folderBulk;
        state.folderTarget = '';
        state.folderBulk = false;
        // Copied out first: input.files is live, and clearing the input (so the
        // same folder can be picked twice in a row) empties it.
        const picked = Array.from(ui.folderInput.files || []);
        ui.folderInput.value = '';
        if (bulk) runFromButton('Check all', () => reconcileAllCreatorFolders(picked));
        else if (target) runFromButton('Folder check', () => reconcileCreatorFolder(target, picked));
      });
      ui.savedList.addEventListener('click', evt => {
        // Anything else pressed while a reset is armed is a change of mind.
        if (!state.resetArmedKey) return;
        const btn = evt.target && evt.target.closest ? evt.target.closest('.ps-rowReset') : null;
        if (btn && btn.dataset.key === state.resetArmedKey) return;
        state.resetArmedKey = '';
        renderSaved();
      }, true);
      panel.querySelector('#psExportBtn').addEventListener('click', () => runFromButton('Export', () => exportBackup()));
      panel.querySelector('#psImportBtn').addEventListener('click', () => ui.importFile.click());
      ui.importFile.addEventListener('change', () => {
        const file = ui.importFile.files && ui.importFile.files[0];
        ui.importFile.value = '';
        if (file) runFromButton('Import', () => importBackup(file));
      });
      panel.querySelector('#psResetBtn').addEventListener('click', () => {
        if (state.busy) return;
        if (!confirm('Erase the saved creator list, the download record, and every check result? This cannot be undone.')) return;
        resetEverything();
      });

      document.addEventListener('keydown', handleGlobalKeydown, true);
      try {
        GM_addValueChangeListener(KEYS.rev, (name, oldValue, newValue, remote) => {
          if (!remote) return;
          downloadedCache.clear();
          syncUi();
          renderSaved();
          markPostCards();
        });
      } catch (e) {}
      installPageChangeWatch();

      setMode(GM_getValue(KEYS.mode, 'download'));
      syncHeadToggles();
      logLine('Ready. Open a creator to add them, or a post to scan it.');
      syncUi();
      renderSaved();
      markPostCards();
    }

    function setChip(chip, on) {
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
      chip.classList.toggle('is-on', !!on);
    }

    function wantKind(kind) {
      if (kind === 'image' || kind === 'video') return true;
      const chip = ui.typeChips && ui.typeChips.find(c => c.dataset.kind === kind);
      return !!(chip && chip.getAttribute('aria-checked') === 'true');
    }

    function filterFilesByType(files) {
      return (files || []).filter(f => wantKind(f.kind));
    }

    function skipDownloaded() { return readFlag(KEYS.skipDownloaded, true); }
    function showDownloaded() { return readFlag(KEYS.showDownloaded, true); }

    function syncHeadToggles() {
      const skip = skipDownloaded();
      ui.skipToggle.classList.toggle('is-on', skip);
      ui.skipToggle.title = skip
        ? 'Skipping posts already downloaded. Click to download them again'
        : 'Downloading every post, even ones already downloaded. Click to skip them';
      const show = showDownloaded();
      ui.showToggle.innerHTML = show ? ICONS.eye : ICONS.eyeOff;
      ui.showToggle.classList.toggle('is-on', !show);
      ui.showToggle.title = show
        ? 'Downloaded posts are showing, dimmed. Click to hide them'
        : 'Downloaded posts are hidden. Click to show them';
    }

    function setMode(mode) {
      const m = mode === 'saved' ? 'saved' : 'download';
      state.mode = m;
      ui.panel.setAttribute('data-mode', m);
      ui.modeBtns.forEach(b => b.classList.toggle('is-active', b.dataset.mode === m));
      try { GM_setValue(KEYS.mode, m); } catch (e) {}
      if (m === 'saved') renderSaved();
    }

    function setCollapsed(collapsed) {
      ui.panel.classList.toggle('ps-collapsed', !!collapsed);
      ui.collapseBtn.textContent = collapsed ? '▾' : '▴';
      ui.collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
    }

    function isEditableTarget(target) {
      const el = target && target.nodeType === 1 ? target : null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    // ` (and Tab) fold the panel away and bring it back, as on Reddit. Not while
    // typing: Tab in a field belongs to the form, and ` is a character.
    function handleGlobalKeydown(evt) {
      if (!evt || evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey) return;
      const isTab = evt.key === 'Tab';
      const isBackquote = evt.code === 'Backquote' || evt.key === '`';
      if (!isTab && !isBackquote) return;
      if (isEditableTarget(evt.target)) return;
      evt.preventDefault();
      setCollapsed(!ui.panel.classList.contains('ps-collapsed'));
    }

    function makePanelDraggable(win, handle) {
      let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      handle.addEventListener('pointerdown', e => {
        if (e.target.closest('button, input')) return;
        dragging = true;
        const r = win.getBoundingClientRect();
        ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
        win.style.left = ox + 'px'; win.style.top = oy + 'px';
        win.style.right = 'auto'; win.style.bottom = 'auto';
        try { handle.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      handle.addEventListener('pointermove', e => {
        if (!dragging) return;
        const maxX = window.innerWidth - 60, maxY = window.innerHeight - 30;
        const nx = Math.min(Math.max(ox + (e.clientX - sx), 60 - win.offsetWidth), maxX);
        const ny = Math.min(Math.max(oy + (e.clientY - sy), 0), maxY);
        win.style.left = nx + 'px'; win.style.top = ny + 'px';
      });
      const end = e => {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    }

    // The width you drag the panel to is a preference, kept for the next load.
    function installPanelWidthMemory(panel) {
      let saved = 0;
      try { saved = Number(GM_getValue(KEYS.panelWidth, 0)) || 0; } catch (e) {}
      if (saved >= PANEL_WIDTH_MIN) panel.style.width = Math.min(saved, Math.floor(window.innerWidth * 0.8)) + 'px';
      if (typeof ResizeObserver !== 'function') return;
      let last = Math.round(panel.getBoundingClientRect().width);
      let timer = null;
      new ResizeObserver(() => {
        if (panel.classList.contains('ps-collapsed')) return;
        const w = Math.round(panel.getBoundingClientRect().width);
        if (w === last || w < PANEL_WIDTH_MIN) return;
        last = w;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { try { GM_setValue(KEYS.panelWidth, w); } catch (e) {} }, 400);
      }).observe(panel);
    }

    // Pawchive does not load a new page when you follow a link: it swaps #main
    // and pushes the new address (htmx), so this script is never re-run. The
    // swap events are the prompt signal; the address poll is the backstop for
    // anything that changes the page without them.
    function installPageChangeWatch() {
      let last = location.href;
      const check = () => {
        if (location.href === last) return;
        last = location.href;
        dropScanFromOtherPage();
        syncUi();
        markPostCards();
      };
      setInterval(check, 1000);
      window.addEventListener('pageshow', check);
      window.addEventListener('popstate', check);
      // A swap can also redraw the post cards without moving the address.
      const afterSwap = () => { check(); markPostCards(); };
      ['htmx:afterSettle', 'htmx:historyRestore'].forEach(name => document.addEventListener(name, afterSwap));
    }

    function dropScanFromOtherPage() {
      if (state.busy || !state.scanPageKey || state.scanPageKey === location.pathname) return;
      state.scanType = '';
      state.creator = null;
      state.posts = [];
      state.files = [];
      state.scanPageKey = '';
      setProgress(0);
    }

    // ------------------------------------------------------------- page facts

    function contextFromLocation() {
      const parts = location.pathname.split('/').filter(Boolean).map(p => {
        try { return decodeURIComponent(p); } catch (e) { return p; }
      });
      if (parts.length < 3 || parts[1] !== 'user' || !parts[0] || !parts[2]) return null;
      const service = parts[0];
      const userId = parts[2];
      const key = creatorKey(service, userId);
      if (parts.length === 3) return { type: 'creator', service, userId, key };
      if (parts[3] === 'post' && parts[4]) return { type: 'post', service, userId, postId: parts[4], key };
      return null;
    }

    // Pawchive moves between pages by swapping #main and nothing else (htmx), so
    // <head>, and the artist_name tag in it, still describes whichever page the
    // tab first opened. Reading it named every creator added after a click
    // through the site after the first one. Only #main is current.
    function pageCreatorName() {
      const header = document.querySelector('#main .user-header__info [itemprop="name"], #main .post__user-name');
      return header && header.textContent ? header.textContent.trim() : '';
    }

    // Posts on a creator's page (and in any other card list) are links to
    // /<service>/user/<id>/post/<post id>. The downloaded ones are dimmed, or
    // hidden when the eye in the head says so.
    function markPostCards() {
      const hide = !showDownloaded();
      document.querySelectorAll('a[href*="/post/"]').forEach(link => {
        if (ui.panel && ui.panel.contains(link)) return;
        const m = (link.getAttribute('href') || '').match(/\/([^/?#]+)\/user\/([^/?#]+)\/post\/([^/?#]+)/);
        if (!m) return;
        const card = link.closest('article') || (link.querySelector('.post-card__header') ? link : null);
        if (!card) return;
        const done = isPostDownloaded(creatorKey(decodeURIComponent(m[1]), decodeURIComponent(m[2])), decodeURIComponent(m[3]));
        card.classList.toggle('psDownloadedPost', done && !hide);
        card.classList.toggle('psHiddenPost', done && hide);
      });
    }

    // ------------------------------------------------------------- status bits

    function scanButtonIdleLabel() {
      const context = contextFromLocation();
      if (!context) return 'Scan';
      if (context.type === 'post') return 'Scan Post';
      return isCreatorSaved(context.key) ? 'Scan Creator' : 'Add Creator';
    }

    function baseFileCountText() {
      if (state.fileProgressOverride) return state.fileProgressOverride;
      // Counted through the same switches the download uses, so this is what a
      // run would fetch right now, not what the scan happened to find.
      const files = filterFilesByType(state.files).length;
      const posts = state.posts.filter(post => filterFilesByType(post.files).length > 0);
      if (!posts.length) return `${files} file${files === 1 ? '' : 's'}`;
      const key = state.creator && state.creator.key;
      const done = posts.reduce((n, post) => n + (isPostDownloaded(key, post.id) ? 1 : 0), 0);
      const pct = Math.round((done / posts.length) * 100);
      return `${files} file${files === 1 ? '' : 's'} · ${posts.length} post${posts.length === 1 ? '' : 's'} · ${pct}%`;
    }

    function syncUi() {
      if (!ui.panel) return;
      const context = contextFromLocation();
      const saved = !!(context && context.type === 'creator' && isCreatorSaved(context.key));
      const hasFiles = state.files.length > 0;
      // Never disabled while busy: that is when it is the Stop button.
      ui.scanBtn.classList.toggle('ps-stop', state.busy);
      ui.scanBtn.textContent = state.busy ? 'Stop' : scanButtonIdleLabel();
      const anySaved = Object.keys(loadCreators()).length > 0;
      const refreshing = state.busy && state.job === 'refresh';
      const folderChecking = state.busy && state.job === 'folder';
      ui.refreshAllBtn.classList.toggle('ps-stop', refreshing);
      ui.refreshAllBtn.textContent = refreshing ? 'Stop' : 'Refresh all';
      ui.refreshAllBtn.disabled = state.busy ? !refreshing : !anySaved;
      ui.refreshAllBtn.title = 'Ask Pawchive for every saved creator\'s posts and work out what is missing';
      ui.folderAllBtn.textContent = folderChecking ? 'Stop' : 'Check all';
      ui.folderAllBtn.disabled = state.busy ? !folderChecking : !anySaved;
      ui.folderAllBtn.title = folderChecking
        ? 'Stop the folder check'
        : 'Pick the folder your per-creator download folders live in. What is in it replaces the download record.';
      ui.postStack.hidden = !(state.scanType === 'post' && hasFiles);
      ui.postBtn.disabled = state.busy || !hasFiles;
      ui.selective.hidden = !(state.scanType === 'creator' && hasFiles);
      ui.allBtn.disabled = state.busy || !state.posts.length;
      ui.rangeInput.placeholder = state.posts.length ? `Posts 1-${state.posts.length}` : 'Posts none';
      ui.rangeInput.disabled = state.busy || !state.posts.length;
      ui.rangeBtn.disabled = state.busy || !state.posts.length;
      ui.creatorLabel.textContent = state.creator
        ? `${state.creator.name} · ${state.creator.service}`
        : 'No creator scanned';
      const base = baseFileCountText();
      ui.countLabel.textContent = state.countTextOverride ? `${base} · ${state.countTextOverride}` : base;
      ui.removeSavedBtn.hidden = !saved;
      ui.removeSavedBtn.disabled = state.busy;
      syncTabCount();
    }

    function syncTabCount() {
      const waiting = Object.keys(loadCreators()).filter(key => creatorProgress(key).pending > 0).length;
      ui.tabCount.hidden = !waiting;
      ui.tabCount.textContent = String(waiting);
      ui.tabCount.title = `${waiting} saved creator${waiting === 1 ? ' has' : 's have'} posts not downloaded yet`;
    }

    function setBusy(busy, job) {
      state.busy = !!busy;
      state.job = state.busy ? (job || state.job || '') : '';
      keepTabAwake(state.busy);
      syncUi();
      renderSaved();
      if (!state.busy) dropScanFromOtherPage();
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
      const t = Math.max(0, Number(total) || 0);
      state.fileProgressOverride = t ? formatUnitTicker(Math.max(0, Number(done) || 0), t, 'file') : '';
      syncUi();
    }

    function formatUnitTicker(done, total, unit) {
      return `${done}/${total} ${unit}${total === 1 ? '' : 's'}`;
    }

    // A press has nowhere to report a failure once its handler has returned, so
    // everything a press starts goes through here and fails into the log.
    function runFromButton(label, work) {
      let running;
      try { running = work(); } catch (err) { logLine(`${label} failed: ${errorMessage(err)}`); return; }
      if (running && typeof running.catch === 'function') {
        running.catch(err => logLine(`${label} failed: ${errorMessage(err)}`));
      }
    }

    function logLine(text) {
      if (!ui.log) return;
      const el = document.createElement('div');
      const t = new Date();
      const stamp = [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
      el.textContent = `[${stamp}] ${text}`;
      ui.log.appendChild(el);
      while (ui.log.childNodes.length > 120) ui.log.removeChild(ui.log.firstChild);
      ui.log.scrollTop = ui.log.scrollHeight;
    }

    // ------------------------------------------------------------------- scan

    async function scanCurrentPage() {
      if (state.busy) return;
      const context = contextFromLocation();
      if (!context) {
        logLine('This page is not a Pawchive creator or post. Open one to scan it.');
        return;
      }
      if (context.type === 'creator' && !isCreatorSaved(context.key)) {
        // The name comes from Pawchive's own record of the id in the address,
        // never from the page, which can be a swap behind.
        armStop();
        setBusy(true, 'scan');
        try {
          const name = await fetchCreatorName(context);
          saveCreator({ key: context.key, service: context.service, userId: context.userId, name });
          logLine(`Saved ${name}. Press Scan Creator to read their posts.`);
        } finally {
          setBusy(false);
          renderSaved();
        }
        return;
      }

      armStop();
      setBusy(true, 'scan');
      setProgress(0);
      state.scanType = context.type;
      state.creator = null;
      state.posts = [];
      state.files = [];
      state.countTextOverride = '';
      state.fileProgressOverride = '';
      state.scanPageKey = '';
      syncUi();

      try {
        const name = await fetchCreatorName(context);
        const creator = {
          key: context.key,
          service: context.service,
          userId: context.userId,
          name,
          folder: sanitizeCreatorFolder(name)
        };
        let rawPosts;
        let complete = false;
        if (context.type === 'post') {
          rawPosts = [await fetchSinglePost(context)];
          logLine(`Fetched post ${context.postId} from ${name}.`);
        } else {
          const walk = await fetchCreatorPosts(context.service, context.userId);
          rawPosts = walk.posts;
          complete = walk.complete;
          logLine(`Fetched ${rawPosts.length} post${rawPosts.length === 1 ? '' : 's'} from ${name}.`);
          // Keep the saved record's name current; creators rename.
          if (isCreatorSaved(context.key)) {
            const rec = loadCreators()[context.key];
            if (rec && rec.name !== name) saveCreator({ key: context.key, name });
          }
        }

        const built = buildDownloadSet(rawPosts, creator);
        state.creator = creator;
        state.posts = built.downloads.posts;
        state.files = built.downloads.files;
        state.scanPageKey = location.pathname;
        // Only a full walk of a creator speaks for everything they have posted.
        if (context.type === 'creator' && complete) recordHistory(context.key, built.mediaIds);
        setCountTextOverride('');
        setProgress(100);
        logLine(`Scan complete: ${state.posts.length} post${state.posts.length === 1 ? '' : 's'}, ${state.files.length} file${state.files.length === 1 ? '' : 's'}.`);
        if (context.type === 'creator') {
          const p = creatorProgress(context.key);
          if (p.known) logLine(`${p.downloaded} of ${p.media} post${p.media === 1 ? '' : 's'} with media already downloaded.`);
        }
      } catch (err) {
        setProgress(0);
        state.countTextOverride = '';
        if (!isStop(err)) logLine(`Scan failed: ${errorMessage(err)}`);
      } finally {
        setBusy(false);
        markPostCards();
      }
    }

    function apiUrl(path) {
      return location.origin + path;
    }

    function enc(v) {
      return encodeURIComponent(String(v || ''));
    }

    async function fetchCreatorName(context) {
      const saved = loadCreators()[context.key];
      try {
        const profile = await requestJsonRetry(apiUrl(`/api/v1/${enc(context.service)}/user/${enc(context.userId)}/profile`));
        if (profile && typeof profile.name === 'string' && profile.name.trim()) return profile.name.trim();
      } catch (err) {
        if (isStop(err)) throw err;
      }
      return (context.type === 'creator' && pageCreatorName()) || (saved && saved.name) || context.userId;
    }

    async function fetchCreatorPosts(service, userId, onPage) {
      const all = [];
      const seen = new Set();
      let offset = 0;
      let route = 0;
      // Pawchive answers the listing at /user/<id>; Kemono's /user/<id>/posts is
      // the fallback should that ever be the one left standing.
      const routes = [
        o => `/api/v1/${enc(service)}/user/${enc(userId)}?o=${o}`,
        o => `/api/v1/${enc(service)}/user/${enc(userId)}/posts?o=${o}`
      ];
      for (let page = 0; page < MAX_API_PAGES; page++) {
        if (stopIsRequested()) throw stopError();
        let list;
        try {
          list = await requestJsonRetry(apiUrl(routes[route](offset)));
        } catch (err) {
          if (!isStop(err) && err && err.httpStatus === 404 && page === 0 && route === 0) {
            route = 1;
            page--;
            continue;
          }
          throw err;
        }
        const rows = Array.isArray(list) ? list : (list && Array.isArray(list.results) ? list.results : null);
        if (!rows) throw new Error('Pawchive answered with something that is not a list of posts');
        let fresh = 0;
        rows.forEach(row => {
          const id = row && row.id != null ? String(row.id) : '';
          if (!id || seen.has(id)) return;
          seen.add(id);
          all.push(row);
          fresh++;
        });
        if (onPage) onPage(all.length);
        else setCountTextOverride(`${all.length} post${all.length === 1 ? '' : 's'} found`);
        if (rows.length < PAGE_SIZE || !fresh) return { posts: all, complete: true };
        offset += rows.length;
        await delay(API_DELAY_MIN + Math.floor(Math.random() * API_DELAY_JITTER));
      }
      return { posts: all, complete: false };
    }

    async function fetchSinglePost(context) {
      const res = await requestJsonRetry(apiUrl(`/api/v1/${enc(context.service)}/user/${enc(context.userId)}/post/${enc(context.postId)}`));
      const raw = res && res.post && res.post.id != null ? res.post : res;
      if (!raw || raw.id == null) throw new Error('Pawchive did not return that post');
      return raw;
    }

    // ------------------------------------------------------------- the files

    function parseDate(value) {
      if (!value) return 0;
      let text = String(value).trim();
      // Pawchive's times carry no zone. They are UTC, and read as local they
      // would move a late-night post onto the wrong day in its name.
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) text += 'Z';
      const ms = Date.parse(text);
      return Number.isFinite(ms) ? ms : 0;
    }

    function extOf(name) {
      const clean = String(name || '').split(/[?#]/)[0];
      const leaf = clean.split('/').pop() || '';
      const dot = leaf.lastIndexOf('.');
      if (dot <= 0 || dot === leaf.length - 1) return '';
      return leaf.slice(dot + 1).toLowerCase();
    }

    function canonicalExt(ext) {
      const e = String(ext || '').toLowerCase();
      if (e === 'jpeg' || e === 'jpe') return 'jpg';
      if (e === 'tif') return 'tiff';
      return e;
    }

    function fileUrlCandidates(path, name) {
      const raw = String(path || '').trim();
      if (/^https?:\/\//i.test(raw)) return [raw];
      const rel = raw.replace(/^\/?data\//i, '').replace(/^\/+/, '');
      const query = name ? `?f=${encodeURIComponent(name)}` : '';
      return [`${FILE_HOST}/data/${rel}${query}`, `${location.origin}/data/${rel}${query}`];
    }

    // A post's cover (`file`) is very often also its first attachment; the same
    // stored path is one file, not two.
    function extractFiles(raw) {
      const out = [];
      const seen = new Set();
      const add = entry => {
        if (!entry || !entry.path) return;
        const path = String(entry.path);
        const identity = path.toLowerCase();
        if (seen.has(identity)) return;
        seen.add(identity);
        const originalName = String(entry.name || '') || path.split('/').pop();
        const ext = canonicalExt(extOf(originalName) || extOf(path)) || 'bin';
        const kind = IMAGE_EXTS.has(ext) ? 'image' : VIDEO_EXTS.has(ext) ? 'video' : 'other';
        const urls = fileUrlCandidates(path, originalName);
        out.push({ kind, ext, originalName, path, url: urls[0], urls });
      };
      add(raw && raw.file);
      (Array.isArray(raw && raw.attachments) ? raw.attachments : []).forEach(add);
      return out;
    }

    function htmlToText(html) {
      const source = String(html || '');
      if (!source.trim()) return '';
      let doc;
      try { doc = new DOMParser().parseFromString(`<div id="root">${source}</div>`, 'text/html'); } catch (e) { return source; }
      const root = doc.getElementById('root');
      if (!root) return '';
      root.querySelectorAll('script, style').forEach(el => el.remove());
      root.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
      root.querySelectorAll('a[href]').forEach(el => {
        const href = el.getAttribute('href') || '';
        const text = (el.textContent || '').trim();
        if (!/^https?:/i.test(href)) return;
        el.replaceWith(text && text !== href ? `[${text}](${href})` : href);
      });
      root.querySelectorAll('img[src]').forEach(el => {
        const src = el.getAttribute('src') || '';
        el.replaceWith(/^https?:/i.test(src) ? `![](${src})` : '');
      });
      root.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr').forEach(el => el.append('\n\n'));
      return (root.textContent || '')
        .replace(/ /g, ' ')
        .split('\n')
        .map(line => line.replace(/[ \t]+$/g, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function postLink(creator, postId) {
      return `${location.origin}/${enc(creator.service)}/user/${enc(creator.userId)}/post/${enc(postId)}`;
    }

    function buildPostTextFile(post, creator, hasFiles) {
      const raw = post.raw || {};
      const body = htmlToText(raw.content);
      if (!hasFiles && !body) return null;
      const lines = [`# ${post.title || `post_${post.id}`}`, ''];
      const meta = [`- **Creator:** ${creator.name}`, `- **Service:** ${creator.service}`];
      if (post.published) meta.push(`- **Posted:** ${new Date(post.published).toISOString().slice(0, 10)}`);
      meta.push(`- **Link:** ${postLink(creator, post.id)}`);
      const embed = raw.embed && typeof raw.embed === 'object' ? raw.embed : null;
      if (embed && embed.url) meta.push(`- **Embed:** ${embed.subject ? `${embed.subject} ` : ''}${embed.url}`);
      lines.push(...meta, '');
      if (body) lines.push(body, '');
      return { kind: 'text', text: lines.join('\n'), ext: 'md', url: '', urls: [] };
    }

    function buildDownloadSet(rawPosts, creator) {
      const parsed = (Array.isArray(rawPosts) ? rawPosts : [])
        .filter(raw => raw && raw.id != null)
        .map(raw => ({
          id: String(raw.id),
          title: String(raw.title || '').trim(),
          published: parseDate(raw.published) || parseDate(raw.added),
          raw
        }));
      const mediaIds = [];
      const withFiles = parsed.map(post => {
        const files = extractFiles(post.raw);
        if (files.some(f => f.kind === 'image' || f.kind === 'video')) mediaIds.push(post.id);
        const md = buildPostTextFile(post, creator, files.length > 0);
        if (md) files.push(md);
        return Object.assign({}, post, { files });
      }).filter(post => post.files.length > 0);
      return { parsed, mediaIds, downloads: buildPostDownloads(withFiles, creator) };
    }

    // Oldest first, so post 1 is the creator's first post and a range means the
    // same posts every time the creator is scanned.
    function buildPostDownloads(posts, creator) {
      const sorted = posts.slice().sort((a, b) =>
        (a.published || 0) - (b.published || 0)
        || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
      const keptPosts = [];
      const keptFiles = [];
      let globalIndex = 0;
      for (const post of sorted) {
        globalIndex++;
        const base = postFolderName(post, creator, globalIndex);
        const decorated = { id: post.id, title: post.title, published: post.published, postFolder: base, files: [] };
        const ordered = post.files.filter(f => f.kind !== 'text').concat(post.files.filter(f => f.kind === 'text'));
        ordered.forEach((file, idx) => {
          const fIdx = String(idx + 1).padStart(6, '0');
          let fileName;
          if (file.kind === 'text') fileName = `${base}.md`;
          else if (file.kind === 'other') {
            // A zip or a PSD is named by its author for a reason; keep that
            // after the index rather than throwing it away.
            const stem = sanitizeNamePart(String(file.originalName || '').replace(/\.[^.]+$/, '')).slice(0, 60);
            fileName = `${base}_${fIdx}${stem ? ` - ${stem}` : ''}.${file.ext}`;
          } else fileName = `${base}_${fIdx}.${file.ext}`;
          const item = Object.assign({}, file, {
            fileName,
            postFolder: base,
            creatorFolder: creator.folder,
            postId: post.id
          });
          decorated.files.push(item);
          keptFiles.push(item);
        });
        keptPosts.push(decorated);
      }
      return { posts: keptPosts, files: keptFiles };
    }

    function postFolderName(post, creator, globalIndex) {
      let dateSec = '000000';
      if (post.published) {
        const d = new Date(post.published);
        dateSec = String(d.getUTCFullYear() % 100).padStart(2, '0')
          + String(d.getUTCMonth() + 1).padStart(2, '0')
          + String(d.getUTCDate()).padStart(2, '0');
      }
      const creatorSec = sanitizeNamePart(creator.name).slice(0, 40).trim() || sanitizeNamePart(creator.userId);
      const titleSec = sanitizeNamePart(post.title).slice(0, 40).trim() || `post_${post.id}`;
      return `${dateSec}-${creatorSec}-${String(globalIndex).padStart(6, '0')} - ${titleSec}`;
    }

    function sanitizeCreatorFolder(s) {
      let out = String(s || '').normalize('NFC');
      out = out.replace(/�/g, '').replace(/[\uD800-\uDFFF]/g, '');
      out = out.replace(/\s+/g, '_').replace(/[\\/:*?"<>|~]+/g, '').replace(/[\x00-\x1F\x7F]/g, '');
      out = out.replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
      return out || 'pawchive_creator';
    }

    function sanitizeNamePart(s) {
      let out = String(s || '').normalize('NFC');
      out = out.replace(/�/g, '').replace(/[\uD800-\uDFFF]/g, '');
      out = out.replace(/\s+/g, ' ').replace(/ - /g, '-');
      out = out.replace(/[\\/:*?"<>|~]+/g, '').replace(/[\x00-\x1F\x7F]/g, '');
      return out.replace(/ +/g, ' ').trim();
    }

    // Pawchive titles are very often Japanese, so unlike the Reddit Stripper the
    // saved name keeps any letter, and strips only what a file system or the
    // browser's download API refuses. An ASCII-only name is the fallback if the
    // browser refuses this one anyway (see saveBlob).
    function sanitizeSavePath(rawPath, strict) {
      const parts = String(rawPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
      if (!parts.length) return 'download';
      return parts.map((seg, idx) => {
        let s = String(seg).normalize('NFC').replace(/[\uD800-\uDFFF�]/g, '');
        s = s.replace(/[\x00-\x1F\x7F]/g, '');
        s = strict ? s.replace(/[^A-Za-z0-9._ -]+/g, '') : s.replace(/[\\/:*?"<>|~]+/g, '');
        s = s.replace(/^[\s.]+|[\s.]+$/g, '');
        if (idx === parts.length - 1 && /^\.?zip$/i.test(s)) s = '';
        return s || (idx === parts.length - 1 ? 'download.zip' : 'folder');
      }).join('/');
    }

    // --------------------------------------------------------------- download

    async function downloadSelectedRange() {
      if (state.busy || !state.posts.length) return;
      const parsed = parseRangeList(ui.rangeInput.value, state.posts.length);
      if (parsed.error) {
        logLine(`Post range: ${parsed.error}.`);
        return;
      }
      const selected = state.posts.filter((post, index) => parsed.numbers.has(index + 1));
      logLine(`Selected ${selected.length} post${selected.length === 1 ? '' : 's'} from the range.`);
      await downloadPostArchives(selected);
    }

    async function downloadPostArchives(selectedPosts) {
      const posts = Array.isArray(selectedPosts) ? selectedPosts : state.posts;
      const creator = state.creator;
      if (state.busy || !posts.length || !creator) return;
      const scanned = posts
        .map(post => ({ post, files: filterFilesByType(post.files) }))
        .filter(item => item.files.length > 0);
      if (!scanned.length) {
        logLine('No files match the selected posts and file types.');
        return;
      }
      const skip = skipDownloaded();
      const items = skip ? scanned.filter(item => !isPostDownloaded(creator.key, item.post.id)) : scanned;
      const alreadyHave = scanned.length - items.length;
      if (!items.length) {
        logLine(`Nothing to download: all ${alreadyHave} post${alreadyHave === 1 ? ' is' : 's are'} already downloaded.`
          + ' Turn off Skip downloaded in the header to fetch them again.');
        return;
      }
      if (alreadyHave) logLine(`Skipping ${alreadyHave} post${alreadyHave === 1 ? '' : 's'} already downloaded.`);

      const totalFiles = items.reduce((sum, item) => sum + item.files.length, 0);
      armStop();
      setBusy(true, 'download');
      setProgress(0);
      setFileProgressOverride(0, totalFiles);
      setCountTextOverride(formatUnitTicker(0, items.length, 'post'));
      let saved = 0;
      let failed = 0;
      let completedFiles = 0;
      try {
        for (let i = 0; i < items.length; i++) {
          if (stopIsRequested()) break;
          const { post, files } = items[i];
          const archiveName = `${creator.folder}/${post.postFolder}.zip`;
          logLine(`Building post zip ${i + 1}/${items.length}: ${post.postFolder}`);
          // Each post stands or falls on its own; one dead link never takes the
          // rest of the run down with it.
          try {
            await buildAndSaveArchive(files, archiveName, pct => {
              setProgress((i / items.length) * 100 + (pct / 100) * (100 / items.length));
            }, fileDone => {
              setFileProgressOverride(completedFiles + fileDone, totalFiles);
            });
            markPostsDownloaded(creator.key, [post.id]);
            saved++;
          } catch (err) {
            if (isStop(err)) break;
            failed++;
            logLine(`Skipped post ${post.postFolder}: ${errorMessage(err)}`);
          }
          completedFiles += files.length;
          setFileProgressOverride(completedFiles, totalFiles);
          setCountTextOverride(formatUnitTicker(saved, items.length, 'post'));
          setProgress(((i + 1) / items.length) * 100);
          markPostCards();
          await delay(FILE_DELAY_MS);
        }
        logLine(`Downloaded ${saved} post archive${saved === 1 ? '' : 's'}`
          + (failed ? `; skipped ${failed}` : '')
          + (stopIsRequested() ? '; stopped before the rest.' : '.'));
      } finally {
        state.countTextOverride = '';
        state.fileProgressOverride = '';
        setBusy(false);
        markPostCards();
      }
    }

    async function buildAndSaveArchive(files, archiveName, onProgress, onUnitProgress) {
      if (!JSZip || typeof JSZip !== 'function') throw new Error('JSZip is missing');
      const zip = new JSZip();
      let added = 0;
      let addedFetched = 0;
      let failed = 0;
      let placeheld = 0;
      const renamed = [];
      const fetchedWanted = files.filter(f => f.kind !== 'text').length;
      if (onUnitProgress) onUnitProgress(0, files.length);

      for (const file of files) {
        if (stopIsRequested()) throw stopError();
        try {
          const blob = file.kind === 'text'
            ? new Blob([file.text || ''], { type: 'text/markdown' })
            : await fetchBlobWithRetry(file);
          let name = file.fileName;
          if (file.kind === 'image' || file.kind === 'video') {
            const fixed = await nameForBlob(name, blob);
            if (fixed.renamed) renamed.push(fixed.renamed);
            name = fixed.name;
          }
          zip.file(`${file.postFolder}/${name}`, blob);
          added++;
          if (file.kind !== 'text') addedFetched++;
        } catch (err) {
          // A stop is never evidence that a file is gone, so it can never earn
          // a placeholder.
          if (isStop(err)) throw err;
          if (err && err.mediaGone) {
            placeheld++;
            zip.file(`${file.postFolder}/${placeholderFileName(placeheld)}`, placeholderBlobFor(file, err));
            logLine(`File gone for good, wrote a placeholder: ${file.fileName}`);
          } else {
            failed++;
            logLine(`Skipped failed file: ${file.fileName} (${errorMessage(err)})`);
          }
        }
        if (onUnitProgress) onUnitProgress(added + failed + placeheld, files.length);
        if (onProgress) onProgress(Math.round(((added + failed + placeheld) / files.length) * 68));
        await delay(FILE_DELAY_MS);
      }

      // The text sidecar always lands, because it is never fetched. A post that
      // had files to get must come away with some of them, or with placeholders
      // saying they are gone, or it is not recorded and is tried again next run.
      if (fetchedWanted && !addedFetched && !placeheld) {
        throw new Error(`all ${fetchedWanted} file fetch${fetchedWanted === 1 ? '' : 'es'} failed`);
      }
      if (!added && !placeheld) throw new Error('nothing could be added to the zip');
      if (failed) logLine(`Archive is partial: ${failed} file${failed === 1 ? '' : 's'} failed.`);
      if (renamed.length) {
        const kinds = [...new Set(renamed.map(r => `${r.from} -> ${r.to}`))].join(', ');
        logLine(`Corrected ${renamed.length} file extension${renamed.length === 1 ? '' : 's'} from what the bytes actually are (${kinds}).`);
      }

      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => {
        const pct = Math.max(0, Math.min(100, Math.round(meta && meta.percent ? meta.percent : 0)));
        if (onProgress) onProgress(68 + Math.round((pct / 100) * 27));
      });
      await saveBlob(blob, archiveName);
      if (onProgress) onProgress(100);
    }

    const PLACEHOLDER_BASE_NAME = 'MISSING MEDIA';

    function placeholderFileName(index) {
      return `${PLACEHOLDER_BASE_NAME} ${String(index).padStart(3, '0')}`;
    }

    function placeholderBlobFor(file, err) {
      const lines = [
        'This file is no longer on Pawchive.',
        '',
        `original file : ${file.originalName || file.fileName || '(unnamed)'}`,
        `saved as      : ${file.fileName || '(unnamed)'}`,
        `url           : ${file.url || '(none)'}`,
        `result        : ${errorMessage(err)}`,
        `recorded      : ${new Date().toISOString()}`,
        '',
        'It stands in for a file that cannot be fetched any more, so the post',
        'counts as handled and stops being retried on every run. Delete it',
        'freely; nothing depends on it.'
      ];
      return new Blob([lines.join('\n')], { type: 'application/octet-stream' });
    }

    // What a blob actually is, read off its own first bytes. A wrong extension
    // is corrected rather than archived under a name nothing will open.
    async function sniffMediaExt(blob) {
      if (!blob || typeof blob.slice !== 'function') return '';
      const head = blob.slice(0, 32);
      let bytes = null;
      if (typeof head.arrayBuffer === 'function') {
        try { bytes = new Uint8Array(await head.arrayBuffer()); } catch (e) { bytes = null; }
      }
      if (!bytes && typeof FileReader === 'function') {
        try {
          bytes = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.onerror = () => reject(reader.error || new Error('read failed'));
            reader.readAsArrayBuffer(head);
          });
        } catch (e) { bytes = null; }
      }
      if (!bytes || bytes.length < 12) return '';
      const ascii = (start, len) => {
        let out = '';
        for (let i = start; i < start + len && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
        return out;
      };
      if (ascii(0, 3) === 'GIF') return 'gif';
      if (bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return 'png';
      if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpg';
      if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
      if (bytes[0] === 0x42 && bytes[1] === 0x4D) return 'bmp';
      if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return 'webm';
      if (ascii(4, 4) === 'ftyp') {
        const brand = ascii(8, 4).toLowerCase();
        if (brand === 'avif' || brand === 'avis') return 'avif';
        if (brand === 'heic' || brand === 'heix' || brand === 'heim' || brand === 'mif1') return 'heic';
        if (brand === 'qt  ') return 'mov';
        return 'mp4';
      }
      return '';
    }

    async function nameForBlob(name, blob) {
      const actual = await sniffMediaExt(blob);
      if (!actual) return { name, renamed: null };
      const dot = name.lastIndexOf('.');
      const current = dot > 0 ? name.slice(dot + 1) : '';
      // A Matroska file and a WebM share their first bytes; only a real
      // disagreement is corrected.
      if (canonicalExt(current) === canonicalExt(actual) || (actual === 'webm' && current === 'mkv')) {
        return { name, renamed: null };
      }
      return { name: (dot > 0 ? name.slice(0, dot) : name) + '.' + actual, renamed: { from: current || '(none)', to: actual } };
    }

    async function fetchBlobWithRetry(file) {
      const urls = Array.isArray(file.urls) && file.urls.length ? file.urls : [file.url];
      let lastErr = null;
      // Every attempt at every candidate has to agree the file is gone. One
      // transient failure anywhere and it is not written off.
      let sawGone = false;
      let sawTransient = false;
      for (const url of urls) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (stopIsRequested()) throw stopError();
          try {
            return await requestBlob(url, { allowText: file.kind === 'other' });
          } catch (err) {
            if (isStop(err)) throw err;
            lastErr = err;
            if (MEDIA_GONE_STATUSES.has(err && err.httpStatus)) sawGone = true;
            else sawTransient = true;
            if (attempt >= MAX_RETRIES) break;
            await delay(BACKOFF_BASE * Math.pow(2, attempt) + Math.floor(Math.random() * 500));
          }
        }
      }
      const failure = lastErr || new Error('download failed');
      failure.mediaGone = sawGone && !sawTransient;
      throw failure;
    }

    function parseHeader(headers, name) {
      if (!headers) return '';
      const m = String(headers).match(new RegExp(`^${name}:\\s*([^\\r\\n]+)`, 'im'));
      return m ? m[1].trim() : '';
    }

    // The archive family of sites answers its API as JSON to this Accept header;
    // it is what the site's own pages send.
    function requestJson(url) {
      return new Promise((resolve, reject) => {
        trackedRequest({
          method: 'GET',
          url,
          anonymous: false,
          headers: { Accept: 'text/css' },
          timeout: 45000,
          onload: res => {
            if (res.status < 200 || res.status >= 300) {
              const err = new Error(`HTTP ${res.status}`);
              err.httpStatus = res.status;
              reject(err);
              return;
            }
            try {
              resolve(typeof res.response === 'object' && res.response ? res.response : JSON.parse(res.responseText || ''));
            } catch (err) {
              reject(new Error('Pawchive did not answer with data (the site may be showing a check page; reload it)'));
            }
          },
          onerror: err => reject(isStop(err) ? err : new Error('network error')),
          ontimeout: () => reject(new Error('request timeout'))
        });
      });
    }

    async function requestJsonRetry(url) {
      let lastErr = null;
      for (let attempt = 0; attempt <= MAX_RETRIES + 2; attempt++) {
        if (stopIsRequested()) throw stopError();
        try {
          return await requestJson(url);
        } catch (err) {
          if (isStop(err)) throw err;
          lastErr = err;
          const status = err && err.httpStatus;
          // A 4xx other than rate limiting will say the same thing again.
          if (status && status < 500 && status !== 429) throw err;
          if (attempt >= MAX_RETRIES + 2) break;
          await delay(BACKOFF_BASE * Math.pow(2, attempt + (status === 429 ? 1 : 0)) + Math.floor(Math.random() * 500));
        }
      }
      throw lastErr || new Error('request failed');
    }

    function requestBlob(url, opts) {
      const allowText = !!(opts && opts.allowText);
      return new Promise((resolve, reject) => {
        trackedRequest({
          method: 'GET',
          url,
          anonymous: false,
          responseType: 'blob',
          timeout: BLOB_TIMEOUT_MS,
          onload: async res => {
            if (res.status < 200 || res.status >= 300) {
              const err = new Error(`HTTP ${res.status}`);
              err.httpStatus = res.status;
              reject(err);
              return;
            }
            const blob = res.response;
            if (!blob || typeof blob.size !== 'number') { reject(new Error('empty response')); return; }
            if (blob.size === 0) { reject(new Error('empty file (0 bytes)')); return; }
            // A removed or rate-limited file can come back as a 200 page. Media
            // is never text; an attachment may honestly be a .txt, so only media
            // is held to that.
            const contentType = (parseHeader(res.responseHeaders, 'content-type') || blob.type || '').toLowerCase();
            if (!allowText && /^(?:text\/|application\/(?:json|xml|xhtml))/.test(contentType)) {
              reject(new Error(`server returned ${contentType.split(';')[0] || 'non-media content'} (likely an error page)`));
              return;
            }
            const expectedLen = Number(parseHeader(res.responseHeaders, 'content-length'));
            if (expectedLen > 0 && blob.size < expectedLen) {
              reject(new Error(`truncated download (${blob.size}/${expectedLen} bytes)`));
              return;
            }
            if (!allowText) {
              try {
                const head = await blob.slice(0, 16).text();
                if (/^\s*<(?:!doctype|html|head|body|\?xml)/i.test(head)) {
                  reject(new Error('server returned a web page instead of the file (likely an error page)'));
                  return;
                }
              } catch (e) {}
            }
            resolve(blob);
          },
          onerror: err => reject(isStop(err) ? err : new Error('network error')),
          ontimeout: () => reject(new Error('request timeout'))
        });
      });
    }

    function saveBlob(blob, rawName) {
      const attempt = name => new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        let settled = false;
        const finish = err => {
          if (settled) return;
          settled = true;
          setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 30000);
          if (err) reject(err); else resolve();
        };
        try {
          if (typeof GM_download === 'function') {
            GM_download({
              url,
              name,
              saveAs: false,
              onload: () => finish(),
              onerror: err => finish(Object.assign(new Error(err && err.error ? String(err.error) : 'save failed'), { gm: err })),
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
        a.download = name.split('/').pop() || 'pawchive_archive.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        finish();
      });
      const friendly = sanitizeSavePath(rawName, false);
      const strict = sanitizeSavePath(rawName, true);
      return attempt(friendly).catch(err => {
        if (friendly === strict || !/name|filename|invalid/i.test(errorMessage(err))) throw err;
        logLine('The browser refused that file name; saved it under a plain-letters name instead.');
        return attempt(strict);
      });
    }

    // ------------------------------------------------------------------ saved

    function renderSaved() {
      if (!ui.savedList) return;
      const query = ui.savedSearch.value.trim().toLowerCase();
      const creators = Object.values(loadCreators());
      const rows = creators.map(c => ({ c, p: creatorProgress(c.key) }));
      const waiting = rows.filter(r => r.p.pending > 0);
      const pendingPosts = waiting.reduce((n, r) => n + r.p.pending, 0);
      const unknown = rows.filter(r => !r.p.known).length;

      if (!rows.length) {
        ui.savedSummary.textContent = 'Nobody saved yet.';
      } else {
        const bits = [`${rows.length} creator${rows.length === 1 ? '' : 's'}`];
        bits.push(waiting.length
          ? `${waiting.length} with new posts (${pendingPosts} to download)`
          : 'nothing waiting');
        if (unknown) bits.push(`${unknown} never checked`);
        ui.savedSummary.textContent = bits.join(' · ');
      }

      // Most still to download first, never-checked next, finished last.
      const rank = r => (r.p.pending > 0 ? 0 : !r.p.known ? 1 : 2);
      const shown = rows
        .filter(r => !query || String(r.c.name || '').toLowerCase().includes(query)
          || String(r.c.service || '').toLowerCase().includes(query)
          || String(r.c.userId || '').toLowerCase().includes(query))
        .sort((a, b) => rank(a) - rank(b) || b.p.pending - a.p.pending
          || String(a.c.name || '').localeCompare(String(b.c.name || '')));

      ui.savedList.textContent = '';
      if (!shown.length) {
        const empty = document.createElement('div');
        empty.className = 'ps-empty';
        empty.textContent = rows.length
          ? 'No saved creator matches that filter.'
          : 'Open a creator\'s page and press Add Creator. They land here, and Refresh all tells you who has posted something you have not downloaded.';
        ui.savedList.appendChild(empty);
      } else {
        shown.forEach(r => ui.savedList.appendChild(buildSavedRow(r.c, r.p)));
      }
      syncTabCount();
    }

    function iconButton(className, icon, title) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ps-rowBtn ${className}`;
      btn.innerHTML = icon;
      btn.title = title;
      return btn;
    }

    function buildSavedRow(c, p) {
      const row = document.createElement('div');
      const finished = p.known && p.pending === 0;
      const arming = state.resetArmedKey === c.key;
      row.className = 'ps-row' + (finished ? ' done' : '') + (state.checkingKey === c.key ? ' checking' : '') + (arming ? ' arming' : '');

      const badge = document.createElement('span');
      badge.className = 'ps-badge';
      if (p.known) {
        badge.textContent = `${p.downloaded}/${p.media}`;
        badge.classList.add(p.pending ? 'pending' : 'ok');
        badge.title = p.pending
          ? `${p.pending} post${p.pending === 1 ? '' : 's'} with media not downloaded yet`
          : 'Everything with media is downloaded';
      } else {
        badge.textContent = '?';
        badge.title = 'Never checked. Scan or recheck this creator to find out what is here';
      }

      const url = `${location.origin}/${enc(c.service)}/user/${enc(c.userId)}`;
      const link = document.createElement('a');
      link.className = 'ps-rowName';
      link.href = url;
      link.title = `${c.name} (${c.service} ${c.userId})`
        + (p.checkedAt ? `\nLast checked ${new Date(p.checkedAt).toLocaleString()}` : '');
      const label = document.createElement('span');
      label.className = 'ps-rowLabel';
      label.textContent = c.name || c.userId;
      const service = document.createElement('span');
      service.className = 'ps-rowService';
      service.textContent = c.service;
      link.append(label, service);

      const recheck = iconButton('', ICONS.recheck, 'Ask Pawchive for this creator\'s new posts');
      recheck.disabled = state.busy;
      recheck.addEventListener('click', () => runFromButton('Check', () => checkCreators([c.key])));

      const reset = iconButton('ps-rowReset' + (arming ? ' armed' : ''), ICONS.reset,
        arming ? 'Press again to forget what was downloaded for this creator' : 'Forget what was downloaded for this creator');
      reset.dataset.key = c.key;
      reset.disabled = state.busy || !(p.downloaded > 0 || downloadedSet(c.key).size > 0);
      reset.addEventListener('click', () => {
        if (state.resetArmedKey !== c.key) {
          state.resetArmedKey = c.key;
          renderSaved();
          return;
        }
        state.resetArmedKey = '';
        resetCreatorDownloads(c.key);
        logLine(`Forgot what was downloaded for ${c.name}.`);
        renderSaved();
        syncUi();
        markPostCards();
      });

      const open = iconButton('', ICONS.open, 'Open in a new tab');
      open.addEventListener('click', () => window.open(url, '_blank', 'noopener'));

      const rm = iconButton('rm', ICONS.remove, 'Remove from Saved (the download record is kept)');
      rm.disabled = state.busy;
      rm.addEventListener('click', () => {
        removeCreator(c.key);
        logLine(`Removed ${c.name} from Saved.`);
        renderSaved();
        syncUi();
      });

      const folderChecking = state.job === 'folder' && state.checkingKey === c.key;
      const folder = iconButton('', folderChecking ? ICONS.busy : ICONS.folder, folderChecking
        ? `Checking a folder against ${c.name}…`
        : `Pick the folder ${c.name}'s post zips were saved into. What is in it replaces ${c.name}'s download record.`);
      folder.disabled = state.busy;
      folder.addEventListener('click', () => {
        if (state.busy) return;
        state.folderTarget = c.key;
        state.folderBulk = false;
        ui.folderInput.click();
      });

      row.append(badge, link, recheck, folder, reset, open, rm);
      return row;
    }

    // Walk each creator's post list and record which posts carry media, which is
    // what turns "?" into "3/16". Nothing is downloaded.
    async function checkCreators(keys) {
      if (state.busy || !keys.length) return;
      armStop();
      setBusy(true, 'refresh');
      let checked = 0;
      let failed = 0;
      try {
        for (let i = 0; i < keys.length; i++) {
          if (stopIsRequested()) break;
          const rec = loadCreators()[keys[i]];
          if (!rec) continue;
          state.checkingKey = rec.key;
          renderSaved();
          setProgress((i / keys.length) * 100);
          try {
            // Also repairs a name saved wrong by the stale-page bug, or one the
            // creator has since changed.
            const freshName = await fetchCreatorName({ type: 'refresh', key: rec.key, service: rec.service, userId: rec.userId });
            if (freshName && freshName !== rec.name) {
              saveCreator({ key: rec.key, name: freshName });
              logLine(`${rec.name} is saved as ${freshName} now, the name Pawchive has for ${rec.service} ${rec.userId}.`);
              rec.name = freshName;
            }
            const creator = { key: rec.key, service: rec.service, userId: rec.userId, name: rec.name, folder: sanitizeCreatorFolder(rec.name) };
            const walk = await fetchCreatorPosts(rec.service, rec.userId, n => {
              ui.savedSummary.textContent = `Checking ${rec.name} (${i + 1}/${keys.length}): ${n} post${n === 1 ? '' : 's'} so far`;
            });
            const built = buildDownloadSet(walk.posts, creator);
            if (walk.complete) recordHistory(rec.key, built.mediaIds);
            const p = creatorProgress(rec.key);
            checked++;
            logLine(`${rec.name}: ${p.pending ? `${p.pending} new` : 'nothing new'} (${p.downloaded}/${p.media} downloaded).`);
          } catch (err) {
            if (isStop(err)) break;
            failed++;
            logLine(`Could not check ${rec.name}: ${errorMessage(err)}`);
          }
          if (i < keys.length - 1) await delay(API_DELAY_MIN + Math.floor(Math.random() * API_DELAY_JITTER));
        }
        setProgress(100);
        if (keys.length > 1) {
          logLine(`Checked ${checked} creator${checked === 1 ? '' : 's'}`
            + (failed ? `; ${failed} failed` : '')
            + (stopIsRequested() ? '; stopped before the rest.' : '.'));
        }
      } finally {
        state.checkingKey = '';
        setBusy(false);
      }
    }

    // ---------------------------------------------------------- folder check
    // Point this at the folder a creator's post zips were saved into and it works
    // out which of their posts you already have, then makes that the download
    // record for that creator: what matches is downloaded, what does not is not.
    //
    // Replacing a record is only right when the check really saw both the folder
    // and Pawchive, so it writes nothing at all when:
    //   - nothing in the folder is a post archive (an empty or mis-picked folder
    //     looks exactly like a deleted library);
    //   - the walk of Pawchive was stopped part-way (every post it did not reach
    //     would be forgotten);
    //   - not one archive matched (that is the matching failing, not you having
    //     nothing).
    // Forgetting downloads on purpose has its own button, which says so.

    function setFolderStatus(text, tone) {
      if (!ui.folderNote) return;
      ui.folderNote.hidden = !text;
      ui.folderNote.textContent = text || '';
      ui.folderNote.className = 'ps-folderNote' + (tone ? ` ${tone}` : '');
    }

    // `<date>-<creator>-<number> - <title>`, as postFolderName writes it. The
    // title is optional and the creator may be empty, because a name made only
    // of letters the plain-letters fallback deletes saves as nothing. A browser's
    // " (1)" copy is the same archive.
    function archiveNameParts(name) {
      const text = String(name || '').normalize('NFC').trim().replace(/\s*\(\d+\)$/, '');
      const m = text.match(/^(\d{6})-(.*?)-(\d{6})(?:\s*-\s*(.*))?$/);
      if (!m) return null;
      return { date: m[1], creator: m[2], index: m[3], title: m[4] || '' };
    }

    // The archives named anywhere in one picked file's path. An archive is a file
    // called <name>.zip or, once unpacked, a folder called <name>, so folder
    // segments are read as they are and only the last segment has to be a .zip.
    // The files inside an unpacked archive carry the name plus a suffix and are
    // not archives.
    function archivesInPickedPath(file) {
      const rel = String((file && (file.webkitRelativePath || file.name)) || '').replace(/\\/g, '/');
      const segments = rel.split('/').filter(Boolean);
      const out = [];
      segments.forEach((segment, i) => {
        let name = segment;
        if (i === segments.length - 1) {
          if (!/\.zip$/i.test(name)) return;
          name = name.slice(0, -4);
        }
        const parts = archiveNameParts(name);
        if (parts) out.push(parts);
      });
      return out;
    }

    // Two readings of a title or a name, because a zip was saved under one of two
    // names: the ordinary one, which keeps every letter (Japanese included), or,
    // if the browser refused that, the plain-letters one. Both drop case, spacing
    // and punctuation, which is what a file system or a browser changes on top.
    // macOS hands back decomposed names; NFKC puts them back together.
    function looseKey(text) {
      return String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    }

    function plainKey(text) {
      return String(text || '').normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    // The creator segment every archive of this creator's would carry today.
    function creatorNameSegment(name) {
      return sanitizeNamePart(name).slice(0, 40).trim();
    }

    // `opts.bulk` means Check all is driving this: the busy guard would refuse
    // every creator after the first (the walk itself is the busy job), and the
    // note gets the walk's "3 of 12" in front of it.
    //
    // Resolves { key, ok, wrote, archives, matched }. `ok` false means the check
    // failed; `wrote` false means it ran and deliberately changed nothing.
    async function reconcileCreatorFolder(key, files, opts) {
      const bulk = !!(opts && opts.bulk);
      const prefix = (opts && opts.prefix) || '';
      const rec = loadCreators()[key];
      const list = Array.from(files || []);
      const result = (ok, wrote, archives, matched) => ({ key, ok, wrote, archives: archives || 0, matched: matched || 0 });
      if (!rec) return result(false, false);
      const say = (text, tone) => {
        logLine(`Folder check: ${text}`);
        setFolderStatus(prefix + text, tone);
      };
      const leave = (text, archives) => {
        say(`${text} Nothing was changed for ${rec.name}.`, 'bad');
        return result(true, false, archives);
      };
      if (!bulk && state.busy) {
        say('Another job is already running.', 'bad');
        return result(false, false);
      }
      if (!bulk) {
        armStop();
        setBusy(true, 'folder');
      }
      state.checkingKey = key;
      renderSaved();
      try {
        say(`Reading folder for ${rec.name}…`);
        if (!list.length) return leave('That folder was empty.');

        const ownLoose = looseKey(creatorNameSegment(rec.name));
        const ownPlain = plainKey(creatorNameSegment(rec.name));
        const isOwn = parts => looseKey(parts.creator) === ownLoose
          || (!!plainKey(parts.creator) && plainKey(parts.creator) === ownPlain)
          || (!parts.creator && !ownPlain);

        // One entry per archive: a zip and the folder it was unpacked into, or a
        // browser's second copy of either, are the same archive.
        const all = new Map();
        list.forEach(file => {
          archivesInPickedPath(file).forEach(parts => {
            const id = `${looseKey(parts.creator)}|${parts.date}|${parts.index}|${looseKey(parts.title)}`;
            if (!all.has(id)) all.set(id, parts);
          });
        });
        if (!all.size) return leave('Nothing in that folder looks like a post archive.');

        let archives = [...all.values()].filter(isOwn);
        let renamedFrom = '';
        let foreign = all.size - archives.length;
        if (!archives.length) {
          // Creators rename. A folder picked for this creator whose archives all
          // carry one other name is this creator under the name they had when
          // the zips were saved; the day-and-title match below is still what
          // decides whether any of them are really this creator's posts.
          const counts = new Map();
          all.forEach(parts => {
            const k = looseKey(parts.creator) || plainKey(parts.creator);
            const seen = counts.get(k);
            if (seen) seen.n++; else counts.set(k, { n: 1, name: parts.creator });
          });
          const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
          archives = [...all.values()].filter(parts => (looseKey(parts.creator) || plainKey(parts.creator)) === best[0]);
          renamedFrom = best[1].name || '(no name)';
          foreign = all.size - archives.length;
        }
        const plural = archives.length === 1 ? '' : 's';

        say(`${archives.length} archive${plural} found. Asking Pawchive for ${rec.name}'s posts…`);
        let walk;
        try {
          walk = await fetchCreatorPosts(rec.service, rec.userId, n => {
            setFolderStatus(`${prefix}${archives.length} archive${plural} found. Reading ${rec.name}'s posts: ${n} so far…`);
          });
        } catch (err) {
          if (isStop(err)) return leave('Stopped before Pawchive had listed every post.', archives.length);
          throw err;
        }
        if (!walk.complete) return leave('Pawchive did not list every post.', archives.length);
        if (!walk.posts.length) return leave('Pawchive returned no posts.', archives.length);

        // Every post's archive name as a download would write it: built by the
        // same code a real run uses, then passed through the same sanitiser that
        // puts it on disk, so both sides are read by one rule.
        const creator = { key: rec.key, service: rec.service, userId: rec.userId, name: rec.name, folder: sanitizeCreatorFolder(rec.name) };
        const built = buildDownloadSet(walk.posts, creator);
        recordHistory(key, built.mediaIds);
        const candidates = [];
        built.downloads.posts.forEach(post => {
          const leaf = sanitizeSavePath(`${post.postFolder}.zip`, false).split('/').pop().replace(/\.zip$/i, '');
          const parts = archiveNameParts(leaf);
          if (parts) candidates.push({ id: String(post.id), index: parts.index, date: parts.date, title: parts.title });
        });

        // Matched on the day and the title, never on the number. The number is
        // the post's *position* among the creator's posts, so every post added or
        // removed on Pawchive shifts the ones after it; the day and the title
        // come from the post and do not move.
        //
        // One day can hold several posts with one title (a series posted as
        // parts). A shift moves every number in a group together and leaves
        // their order alone, so both sides of a group pair off in number order.
        const byIndex = (a, b) => a.index.localeCompare(b.index);
        const matchedIds = new Set();
        let unmatched = archives;
        [looseKey, plainKey].forEach(keyOf => {
          if (!unmatched.length) return;
          const pools = new Map();
          candidates.forEach(c => {
            if (matchedIds.has(c.id)) return;
            const t = keyOf(c.title);
            if (!t) return;
            const k = `${c.date}|${t}`;
            if (!pools.has(k)) pools.set(k, []);
            pools.get(k).push(c);
          });
          const groups = new Map();
          const left = [];
          unmatched.forEach(parts => {
            const t = keyOf(parts.title);
            if (!t) { left.push(parts); return; }
            const k = `${parts.date}|${t}`;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(parts);
          });
          groups.forEach((group, k) => {
            const pool = (pools.get(k) || []).sort(byIndex);
            group.sort(byIndex).forEach((parts, i) => {
              if (pool[i]) matchedIds.add(pool[i].id);
              else left.push(parts);
            });
          });
          unmatched = left;
        });

        // An unmatched archive is named in full: its name is the only thing
        // there is to go and look at.
        const examples = unmatched.slice(0, 3)
          .map(parts => `${parts.date}-${parts.creator}-${parts.index} - ${parts.title}`)
          .join(' | ');
        if (!matchedIds.size) {
          return leave(`None of the ${archives.length} archive${plural} matched a post on Pawchive, e.g. ${examples}.`, archives.length);
        }

        const { before } = replaceCreatorDownloads(key, [...matchedIds]);
        say(`${rec.name}: ${matchedIds.size} of ${archives.length} archive${plural} matched`
          + ` (the record held ${before})`
          + (renamedFrom ? `. The archives are named "${renamedFrom}", an earlier name` : '')
          + (unmatched.length ? `. ${unmatched.length} had no post with that day and title, e.g. ${examples}` : '')
          + (foreign ? `. Ignored ${foreign} belonging to someone else` : '')
          + '.', 'ok');
        return result(true, true, archives.length, matchedIds.size);
      } catch (err) {
        say(`Failed for ${rec.name}: ${errorMessage(err)}`, 'bad');
        return result(false, false);
      } finally {
        state.checkingKey = '';
        if (!bulk) setBusy(false);
        renderSaved();
        syncUi();
        markPostCards();
      }
    }

    // ------------------------------------------------ Check all (a whole parent)
    // Point this at the folder your per-creator download folders live in, and it
    // runs the single check once per creator folder, in order, against Pawchive.
    //
    // Which creator a folder is for is read out of the archive names *inside* it
    // rather than off the folder itself, because the downloader wrote those. Zip
    // names carry a creator's name and not their id, so a name has to belong to
    // exactly one saved creator; two saved creators with one name (the same
    // artist on two services, say) cannot be told apart this way and their
    // folders are skipped, with their records left as they are.
    function groupPickedFolderFiles(files) {
      const groups = new Map();
      Array.from(files || []).forEach(file => {
        const rel = String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/');
        const segments = rel.split('/').filter(Boolean);
        if (!segments.length) return;
        // segments[0] is the folder you picked; its children are creator folders.
        const name = segments.length > 2 ? segments[1] : '';
        let group = groups.get(name);
        if (!group) { group = { name, files: [], names: new Map() }; groups.set(name, group); }
        group.files.push(file);
        archivesInPickedPath(file).forEach(parts => {
          const k = looseKey(parts.creator) || plainKey(parts.creator);
          if (k) group.names.set(k, (group.names.get(k) || 0) + 1);
        });
      });
      return [...groups.values()];
    }

    async function reconcileAllCreatorFolders(files) {
      const say = (text, tone) => {
        logLine(`Check all: ${text}`);
        setFolderStatus(`Check all: ${text}`, tone);
      };
      if (state.busy) { say('another job is already running.', 'bad'); return; }
      const creators = Object.values(loadCreators());
      const byName = new Map();
      const byFolder = new Map();
      const index = (map, k, c) => {
        if (!k) return;
        if (!map.has(k)) map.set(k, []);
        if (!map.get(k).includes(c.key)) map.get(k).push(c.key);
      };
      creators.forEach(c => {
        index(byName, looseKey(creatorNameSegment(c.name)), c);
        index(byName, plainKey(creatorNameSegment(c.name)), c);
        index(byFolder, looseKey(sanitizeCreatorFolder(c.name)), c);
      });

      const merged = new Map();
      const skipped = [];
      // Records that must survive the clear-out even though no folder claimed
      // them, because a skipped folder might well have been theirs.
      const protectedKeys = new Set();
      groupPickedFolderFiles(files).forEach(group => {
        let best = '', bestCount = 0;
        // The commonest name in there, so one stray zip copied in from somewhere
        // else cannot hand the folder to someone else.
        group.names.forEach((count, k) => { if (count > bestCount) { best = k; bestCount = count; } });
        let keys = best ? (byName.get(best) || []) : [];
        if (!keys.length) keys = byFolder.get(looseKey(group.name)) || [];
        if (keys.length !== 1) {
          keys.forEach(k => protectedKeys.add(k));
          if (group.files.length) {
            skipped.push(`${group.name || '(loose files)'}${keys.length > 1 ? ' (more than one saved creator has that name)' : ''}`);
          }
          return;
        }
        const seen = merged.get(keys[0]);
        if (seen) seen.files = seen.files.concat(group.files);
        else merged.set(keys[0], { key: keys[0], files: group.files.slice() });
      });
      const list = [...merged.values()]
        .sort((a, b) => String(loadCreators()[a.key].name).localeCompare(String(loadCreators()[b.key].name)));
      // Same rule as the single check: a folder with nothing recognisable in it
      // is far more likely the wrong folder than an empty library.
      if (!list.length) {
        say('Nothing in that folder looked like a saved creator’s downloads, so nothing was changed.'
          + (skipped.length ? ` Skipped: ${skipped.slice(0, 5).join(', ')}.` : ''), 'bad');
        return;
      }

      armStop();
      setBusy(true, 'folder');
      let done = 0, matched = 0, failed = 0, unchanged = 0, stopped = false;
      const seenKeys = new Set();
      logLine(`Check all: ${list.length} creator folder${list.length === 1 ? '' : 's'} to check.`);
      try {
        for (const target of list) {
          if (stopIsRequested()) { stopped = true; break; }
          seenKeys.add(target.key);
          const res = await reconcileCreatorFolder(target.key, target.files,
            { bulk: true, prefix: `Check all ${done + 1}/${list.length}: ` });
          if (!res.ok) failed++;
          else if (!res.wrote) unchanged++;
          else matched += res.matched;
          done++;
          if (stopIsRequested()) { stopped = true; break; }
          await delay(API_DELAY_MIN + Math.floor(Math.random() * API_DELAY_JITTER));
        }
        // The folder is the record: a creator with no folder in there has
        // nothing downloaded. Only after a walk that was not stopped, and never
        // for a creator a skipped folder might have belonged to.
        let cleared = 0;
        if (!stopped) {
          listKeys(KEYS.downloaded).forEach(k => {
            const ck = k.slice(KEYS.downloaded.length);
            if (seenKeys.has(ck) || protectedKeys.has(ck)) return;
            deleteKey(k);
            downloadedCache.delete(ck);
            cleared++;
          });
          if (cleared) bumpRev();
        }
        say(`${stopped ? 'stopped after ' : 'checked '}${done} of ${list.length} creator folder${list.length === 1 ? '' : 's'}, `
          + `download record replaced: ${matched} archive${matched === 1 ? '' : 's'} on disk`
          + (unchanged ? `, ${unchanged} folder${unchanged === 1 ? '' : 's'} left unchanged` : '')
          + (failed ? `, ${failed} folder${failed === 1 ? '' : 's'} could not be checked` : '')
          + (cleared ? `, ${cleared} creator${cleared === 1 ? '' : 's'} with no folder there now have nothing recorded` : '')
          + (skipped.length ? `. Skipped ${skipped.length}: ${skipped.slice(0, 5).join(', ')}.` : '.'),
          stopped ? 'bad' : (matched ? 'ok' : ''));
      } finally {
        setBusy(false);
        renderSaved();
        syncUi();
        markPostCards();
      }
    }

    function backupStamp() {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }

    async function exportBackup() {
      const downloaded = {};
      listKeys(KEYS.downloaded).forEach(k => { downloaded[k.slice(KEYS.downloaded.length)] = readJson(k, []); });
      const histories = {};
      listKeys(KEYS.history).forEach(k => { histories[k.slice(KEYS.history.length)] = readJson(k, null); });
      const doc = {
        kind: 'pawchive-stripper-backup',
        version: 1,
        script: stripperVersion(),
        exportedAt: new Date().toISOString(),
        creators: loadCreators(),
        downloaded,
        histories
      };
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      await saveBlob(blob, `${backupStamp()} - Pawchive Stripper backup.json`);
      logLine(`Exported ${Object.keys(doc.creators).length} saved creator${Object.keys(doc.creators).length === 1 ? '' : 's'} and the download record.`);
    }

    // Merges, never replaces: creators and downloaded posts are unioned, and a
    // check result is taken only if it is newer than the one already here.
    async function importBackup(file) {
      const text = await file.text();
      let doc;
      try { doc = JSON.parse(text); } catch (e) { throw new Error('that file is not JSON'); }
      if (!doc || doc.kind !== 'pawchive-stripper-backup') throw new Error('that file is not a Pawchive Stripper backup');
      const creators = loadCreators();
      let addedCreators = 0;
      Object.values(doc.creators || {}).forEach(c => {
        if (!c || !c.key || !c.service || !c.userId) return;
        if (!creators[c.key]) addedCreators++;
        creators[c.key] = Object.assign({}, c, creators[c.key] || {});
      });
      writeJson(KEYS.creators, creators);
      let addedPosts = 0;
      Object.entries(doc.downloaded || {}).forEach(([key, ids]) => {
        if (Array.isArray(ids)) addedPosts += markPostsDownloaded(key, ids);
      });
      Object.entries(doc.histories || {}).forEach(([key, hist]) => {
        if (!hist || !Array.isArray(hist.mediaIds)) return;
        const current = loadHistory(key);
        if (!current || (Number(hist.checkedAt) || 0) > (Number(current.checkedAt) || 0)) {
          writeJson(KEYS.history + key, hist);
        }
      });
      bumpRev();
      logLine(`Imported: ${addedCreators} new creator${addedCreators === 1 ? '' : 's'}, ${addedPosts} newly recorded post${addedPosts === 1 ? '' : 's'}.`);
      renderSaved();
      syncUi();
      markPostCards();
    }

    function resetEverything() {
      deleteKey(KEYS.creators);
      listKeys(KEYS.downloaded).forEach(deleteKey);
      listKeys(KEYS.history).forEach(deleteKey);
      downloadedCache.clear();
      bumpRev();
      logLine('Reset: the saved list, the download record and every check result are gone.');
      renderSaved();
      syncUi();
      markPostCards();
    }

    // ------------------------------------------------------------------- stop

    // Stop means stop, now: every request in flight is aborted and every pause
    // between requests is cut short, rather than waiting out whatever file was
    // mid-download.
    let stopRequested = false;
    const inFlightRequests = new Set();
    const pendingDelays = new Set();

    function armStop() { stopRequested = false; }
    function stopIsRequested() { return stopRequested; }

    function requestStop() {
      if (stopRequested) return;
      stopRequested = true;
      inFlightRequests.forEach(handle => { try { if (handle && handle.abort) handle.abort(); } catch (e) {} });
      inFlightRequests.clear();
      pendingDelays.forEach(cancel => { try { cancel(); } catch (e) {} });
      pendingDelays.clear();
      logLine('Stopped.');
    }

    function stopError() {
      const err = new Error('stopped');
      err.stopped = true;
      return err;
    }

    function isStop(err) { return !!(err && err.stopped); }

    function trackedRequest(options) {
      const opts = options || {};
      if (stopRequested) {
        if (opts.onerror) opts.onerror(stopError());
        return null;
      }
      let handle = null;
      const done = () => { if (handle) inFlightRequests.delete(handle); };
      handle = GM_xmlhttpRequest(Object.assign({}, opts, {
        onload: res => { done(); if (opts.onload) opts.onload(res); },
        onerror: err => { done(); if (opts.onerror) opts.onerror(stopRequested ? stopError() : err); },
        ontimeout: err => { done(); if (opts.ontimeout) opts.ontimeout(err); },
        onabort: () => { done(); if (opts.onerror) opts.onerror(stopError()); }
      }));
      if (handle) inFlightRequests.add(handle);
      return handle;
    }

    // A background tab's timers are slowed to a crawl; a worker's are not, so
    // the pauses between requests are timed there and a run in a background tab
    // goes as fast as one in front. The page's own timer is the fallback.
    const backgroundTimer = (() => {
      let worker = null;
      let seq = 0;
      const waiting = new Map();
      try {
        const src = 'const t=new Map();onmessage=e=>{const d=e.data;'
          + 'if(d.clear){clearTimeout(t.get(d.id));t.delete(d.id);return;}'
          + 't.set(d.id,setTimeout(()=>{t.delete(d.id);postMessage(d.id);},d.ms));};';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = e => {
          const fn = waiting.get(e.data);
          waiting.delete(e.data);
          if (fn) fn();
        };
        worker.onerror = () => {
          const pending = Array.from(waiting.values());
          waiting.clear();
          worker = null;
          pending.forEach(fn => setTimeout(fn, 0));
        };
      } catch (e) {
        worker = null;
      }
      return {
        set(fn, ms) {
          if (!worker) {
            const timer = setTimeout(fn, ms);
            return () => clearTimeout(timer);
          }
          const id = ++seq;
          waiting.set(id, fn);
          worker.postMessage({ id, ms });
          return () => {
            waiting.delete(id);
            if (worker) worker.postMessage({ id, clear: true });
          };
        }
      };
    })();

    // A tab holding a web lock is not frozen by the browser, so one is held for
    // as long as a job is running.
    let releaseKeepAwake = null;
    function keepTabAwake(on) {
      if (on && !releaseKeepAwake && navigator.locks && navigator.locks.request) {
        let release = null;
        const held = new Promise(resolve => { release = resolve; });
        releaseKeepAwake = release;
        navigator.locks.request('pawchive-stripper-running-' + Math.random(), () => held).catch(() => {});
      } else if (!on && releaseKeepAwake) {
        releaseKeepAwake();
        releaseKeepAwake = null;
      }
    }

    function delay(ms) {
      return new Promise(resolve => {
        if (stopRequested) { resolve(); return; }
        let cancel = null;
        const clear = backgroundTimer.set(() => { pendingDelays.delete(cancel); resolve(); }, ms);
        cancel = () => { clear(); resolve(); };
        pendingDelays.add(cancel);
      });
    }

    function errorMessage(err) {
      if (!err) return 'unknown error';
      if (err.message) return String(err.message);
      if (err.error) return String(err.error);
      return String(err);
    }

    init();
  }

  // Pawchive's pages carry a pop-under ad that turns the first click on the
  // page into a redirect to an ad site -- a click on this panel included, which
  // throws away whatever scan or download was running. The site's own loader
  // skips that ad, and its window.open wrapper refuses outside links, for an
  // hour after `lastPopunder` was stamped in the page's localStorage. Stamping it
  // here, at document-start and before the page's scripts run, means the ad is
  // never loaded; refreshing the stamp keeps a long-open tab covered too.
  function holdOffPopunder() {
    const stamp = () => { try { localStorage.setItem('lastPopunder', String(Date.now())); } catch (e) {} };
    stamp();
    setInterval(stamp, 5 * 60 * 1000);
  }

  // Last, on purpose: see the note at the top.
  holdOffPopunder();
  if (document.body) runPawchiveStripper();
  else window.addEventListener('DOMContentLoaded', runPawchiveStripper, { once: true });
})();
