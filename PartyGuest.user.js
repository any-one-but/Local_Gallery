
// ==UserScript==
// @name         PartyGuest
// @version      01.11.23
// @description  A tool for downloading images and videos from Coomer/Kemono
// @author       normal person
// @match        *://coomer.st/*
// @match        *://kemono.cr/*
// @grant        GM_download
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==
// Gallery keybinds (right hand): ← / A = previous; → / D = next; 1 = -10 files; 3 = +10 files; Q = -10s; E = +10s; Space = play/pause; ` = close gallery.
// Gallery keybinds (left hand): ← / J = previous; → / L = next; 8 = -10 files; 0 = +10 files; U = -10s; O = +10s; Space = play/pause; Backspace = close gallery.
// Additional keybinds: G = toggle fullscreen; F = cycle filters (all/images/videos); R = toggle random order; P = toggle slideshow; T = toggle looping.

GM_addStyle(`
:root {
  --color0-primary: hsl(0, 0%, 95%);
  --color0-secondary: hsl(0, 0%, 70%);
  --color0-tertirary: hsl(0, 0%, 45%);

  --color1-primary: hsl(200, 25%, 5%);
  --color1-primary-transparent: hsla(200, 25%, 5%, .75);
  --color1-secondary: hsl(208, 22%, 12%);
  --color1-secondary-transparent: hsla(208, 22%, 12%, .5);
  --color1-tertiary: hsl(210, 15%, 5%);

  --anchor-internal-color2-primary: hsl(240, 100%, 40%);

  --beige: var(--color0-primary);
  --black: var(--color1-primary);
  --desk: var(--color0-tertirary);
  --light: var(--color0-secondary);

  --rain-red: #ff3b30;
  --rain-orange: #ff9500;
  --rain-yellow: #ffcc00;
  --rain-green: #34c759;
  --rain-blue: var(--anchor-internal-color2-primary);
  --rain-indigo: #5856d6;
}

.post__files {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  justify-items: left;
}

.post__thumbnail {
  position: relative;
}

.post__thumbnail img {
  width: 100%;
  height: auto;
  border-radius: 2px;
  border: 1px solid var(--color1-tertiary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, .35);
  transition: transform .15s ease, box-shadow .15s ease;
  cursor: pointer;
}

.post__thumbnail img:hover {
  transform: scale(1.02);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .55);
}

.post-card__footer {
  position: relative;
  padding-top: 16px;
}

.post-card__footer .post-number-badge {
  bottom: 4px;
  right: 4px;
}

.post-card__footer .pg-file-range-badge {
  bottom: 26px;
  right: 4px;
}

.post__body > .ad-container,
[class*="bottomRight--"],
[class*="slideAnimation--"] {
  display: none !important;
}

.ad-container-slider {
  background: transparent !important;
}

/* HUD */

#partyHUD {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0px;
  z-index: 9999;
  background: var(--color1-primary);
  color: var(--color0-primary);
  padding: 8px 12px;
  border-radius: 3px;
  border: 1px solid var(--color1-tertiary);
  font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 10px 30px var(--color1-primary-transparent);
  width: max-content;
  max-width: 98vw;
}

#partyHUD .full {
  width: auto;
}

#hudRow {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: auto;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

#hudRow > button {
  flex: 0 0 auto;
}

#partyHUD input[type="text"],
#partyHUD input[type="number"] {
  background: var(--color1-secondary);
  color: var(--color0-primary);
  border: 1px solid var(--color0-tertirary);
  border-radius: 2px;
  padding: 6px 8px;
  font-size: 13px;
}

#hudRow input[type="text"],
#hudRow input[type="number"] {
  width: 130px;
  flex: 0 0 auto;
}

#partyHUD button {
  font-size: 13px;
  padding: 6px 10px;
  font-weight: 600;
  color: var(--color1-primary);
  background: var(--color0-secondary);
  border: 1px solid var(--color0-tertirary);
  border-radius: 2px;
  cursor: pointer;
  text-shadow: none;
  box-shadow: none;
  transition: background .15s ease, border-color .15s ease, transform .05s ease;
}

#partyHUD button:hover:not(:disabled) {
  background: var(--color0-tertirary);
  color: var(--color1-primary);
  border-color: var(--color0-tertirary);
}

#partyHUD button:active:not(:disabled) {
  transform: translateY(1px);
}

/* Primary / special buttons */

#dlBtn {
  background: var(--color0-primary);
  color: var(--color1-primary);
}

#dlBtn:hover:not(:disabled) {
  background: #ffffff;
}

#dlBtn.stop {
  background: var(--rain-red);
  color: #ffffff;
  border-color: var(--rain-red);
}

#filterBtn {
  min-width: 90px;
}

#filterBtn.clear {
  background: var(--rain-red) !important;
  color: #ffffff;
  border-color: var(--rain-red);
}

#btnMedia {
  min-width: 90px;
}

#galleryBtn {
  background: var(--color0-secondary) !important;
}

#galleryBtn.active {
  background: var(--rain-red) !important;
  color: #ffffff;
  border-color: var(--rain-red);
}

/* Page button */

#btnPageAll {
  background: var(--color1-secondary) !important;
  color: var(--color0-primary) !important;
  border: 1px solid var(--color0-tertirary);
  border-radius: 2px;
  padding: 4px 8px;
  font-size: 12px !important;
  font-weight: 500 !important;
  box-shadow: none !important;
  text-shadow: none !important;
  cursor: pointer;
}

#btnPageAll:hover {
  background: var(--color1-secondary-transparent);
}

#btnPageAll.active {
  background: var(--anchor-internal-color2-primary) !important;
  color: #ffffff;
  border-color: var(--anchor-internal-color2-primary);
}

/* Filter / progress */

#filterBox {
  background: var(--color1-secondary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  padding: 6px 8px;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  color: var(--color0-primary);
  align-self: stretch;
  width: 100%;
  gap: 10px;
  font-size: 12px;
}

#indexStatus {
  color: var(--color0-secondary);
}

#filterStatus {
  flex: 1 1 auto;
  min-width: 0;
}

#pgDrop {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
  font-size: 12px;
}

#dlBox {
  background: var(--color1-secondary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  padding: 6px 8px;
  color: var(--color0-primary);
  display: none;
  opacity: 0;
  transition: opacity .25s ease;
  font-size: 12px;
}

#dlBox.pg-dl-visible {
  display: block;
  opacity: 1;
}

#dlBox.pg-dl-hidden {
  opacity: 0;
}

#dlSummaryLine {
  margin-bottom: 4px;
}

#pgWrap {
  width: calc(100% - 24px);
  display: flex;
  align-items: center;
  gap: 8px;
}

#pgTrack {
  position: relative;
  flex: 1 1 auto;
  height: 6px;
  background: var(--color1-secondary-transparent);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

#pgFill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: var(--anchor-internal-color2-primary);
  transition: width .25s ease;
}

#pgBarLabel {
  font-weight: 600;
  font-size: 11px;
  color: var(--color0-primary);
  min-width: 32px;
  text-align: right;
}

/* Post number badges */

.post-number-badge {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: var(--color1-secondary);
  color: var(--color0-primary);
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  border: 1px solid var(--color0-tertirary);
  border-radius: 2px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .35);
  z-index: 9997 !important;
  pointer-events: auto;
  display: inline-block;
  line-height: 1.2;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  -webkit-tap-highlight-color: transparent;
  text-shadow: none;
  -webkit-text-stroke: 0;
}

.post-number-badge.active {
  background: var(--anchor-internal-color2-primary);
  color: #ffffff;
  border-color: var(--anchor-internal-color2-primary);
}

.post-number-badge:hover {
  background: var(--color1-secondary-transparent);
}

.pg-file-range-badge {
  bottom: 26px;
}

/* Cards / badges */

.pg-card-dislike {
  border: 1px solid var(--rain-red) !important;
  border-radius: 2px;
}

.pg-card-new {
  border: 1px solid var(--color0-secondary) !important;
  border-radius: 2px;
}

.pg-badge {
  display: inline-block;
  background: var(--color1-secondary);
  color: var(--color0-primary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  padding: 2px 6px;
  font-size: 11px;
  margin-left: 4px;
}

.pg-visit-summary {
  color: var(--color0-secondary);
  margin-left: 6px;
  font-size: 11px;
}

.pg-btn {
  font-size: 12px;
  font-weight: 600;
  color: var(--color0-primary);
  border: 1px solid var(--color0-tertirary);
  border-radius: 2px;
  cursor: pointer;
  box-shadow: none;
  padding: 5px 9px;
  background: var(--color1-secondary);
  text-shadow: none;
}

.pg-btn + .pg-btn {
  margin-left: 6px;
}

.pg-btn:hover {
  background: var(--color1-secondary-transparent);
}

button:disabled {
  opacity: .6;
  cursor: not-allowed;
}

/* Ad / junk hiding */

.ad-container,
.blockitsowereplaceit,
.prm-wrapper,
.p-header,
.shareButtons-buttons,
.p-breadcrumbs.p-breadcrumbs--bottom,
.blockMessage.blockMessage--none,
.p-description,
.actionBar-set.actionBar-set--internal,
.reactionsBar.js-reactionsList.is-active,
.p-navEl-link.nav-bonga,
.p-navEl-link.nav-dfake,
.p-navEl-link.nav-faze,
.p-navEl-link.nav-tpd,
.ts-outstream-video__video,
#announcement-banner,
.ts-im-container,
#footer,
#footer-about,
.allow-same-origin.allow-popups.allow-forms.allow-scripts.allow-popups-to-escape-sandbox,
.ts-outstream-video__video_vertical,
#ad-banner {
  display: none !important;
}

#ad-banner .leadimage {
  display: none !important;
}

/* Gallery overlay */

#pgGalleryOverlay {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 10000;
  background: #000;
  display: none;
  align-items: center;
  justify-content: center;
}

#pgGalleryInner {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

#pgGalleryViewport {
  max-width: 100%;
  max-height: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

#pgGalleryViewport img,
#pgGalleryViewport video {
  max-width: 100%;
  max-height: 100%;
  height: 100%;
  width: auto;
  object-fit: contain;
  border-radius: 2px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .7);
  background: #000;
}

/* Gallery nav / close */

.pg-gallery-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: var(--color1-secondary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  padding: 8px 12px;
  color: var(--color0-primary);
  font-size: 20px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: background .15s ease, border-color .15s ease, transform .05s ease;
}

.pg-gallery-nav:hover {
  background: var(--color1-secondary-transparent);
}

.pg-gallery-nav:active {
  transform: translateY(-50%) translateY(1px);
}

.pg-gallery-prev {
  left: 16px;
}

.pg-gallery-next {
  right: 16px;
}

.pg-gallery-close {
  position: absolute;
  top: 16px;
  left: 16px;
  background: var(--color1-secondary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  padding: 4px 8px;
  color: var(--color0-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  text-transform: uppercase;
  letter-spacing: .06em;
  transition: background .15s ease, border-color .15s ease, transform .05s ease;
}

.pg-gallery-close:hover {
  background: var(--color1-secondary-transparent);
}

.pg-gallery-close:active {
  transform: translateY(1px);
}

/* Gallery spinner */

#pgGallerySpinner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid var(--color0-secondary);
  border-top-color: var(--anchor-internal-color2-primary);
  animation: pg-spin 1s linear infinite;
  display: none;
}

#pgGalleryFilename {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, .6);
  padding: 4px 8px;
  border-radius: 2px;
  font-size: 11px;
  max-width: 80%;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  color: var(--color0-primary);
}

#pgGalleryStatus {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, .7);
  padding: 4px 8px;
  border-radius: 2px;
  font-size: 11px;
  max-width: 80%;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  opacity: 0;
  transition: opacity .15s ease;
  pointer-events: none;
  color: var(--color0-primary);
}

#pgGalleryStatus.visible {
  opacity: 1;
}

#pgGalleryOverlay.pg-gallery-ui-hidden {
  cursor: none;
}

#pgGalleryOverlay.pg-gallery-ui-hidden .pg-gallery-nav,
#pgGalleryOverlay.pg-gallery-ui-hidden .pg-gallery-close,
#pgGalleryOverlay.pg-gallery-ui-hidden #pgGalleryFilename {
  opacity: 0;
  pointer-events: none;
}

@keyframes pg-spin {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}
`);

const SPAWN_DELAY = 800;
const imgRE = /\.(jpe?g|png|gif|webp|tiff|bmp|avif)$/i;
const vidRE = /\.(mp4|m4v|mov|wmv|flv|avi|webm|mkv)$/i;
const POSTS_PER_PAGE = 50;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const dataRoot = 'https://' + location.host + '/data';
const userName = () => location.pathname.split('/')[3] || 'user';
let DL_ACTIVE = false;
let MEDIA_MODE = 'all';
let LAST_QUEUE_HAD_ITEMS = false;
let lastFilterParams = {};
const retryMap = Object.create(null);
const MAX_RETRIES = 3;
const BACKOFF_BASE = 1200;
const STALL_IMG_TOTAL_MS = 90000;
const STALL_IMG_IDLE_MS = 45000;
const STALL_VID_TOTAL_MS = 300000;
const STALL_VID_IDLE_MS = 90000;
const GALLERY_PRELOAD_VIDEO_TIMEOUT_MS = 45000;
const GALLERY_PRELOAD_ALL_MEDIA = false  // Edit this variable to toggle between the gallery preloading filtered media (true) or loading as it goes (false)
;
let PG_TOTAL = null;
let PG_GW = 1;
let PG_ID_MAP = null;
let PG_POSTS = null;
let PG_INDEX_LOADING = false;
let INDEX_STATUS_TIMER = null;
let PENDING_FILTER_SUMMARY = null;
let PG_FILE_TOTAL = null;
let PG_FILE_URL_MAP = null;
let PG_POST_FILE_RANGE_MAP = null;
const DURATION_FEATURE_ENABLED = false; // Edit this variable to toggle on (true) or off (false) Duration filtering and video duration indexing
const badgeToggleEvent = ('onpointerdown' in window) ? 'pointerdown' : 'mousedown';
let lastUrl = location.href;
let CURRENT_PROFILE_KEY = null;
let PREVIEW_MODE = false;
let GALLERY_MODE = false;
let galleryItems = [];
let galleryIndex = 0;
let galleryKeyHandlerAttached = false;
let gallerySessionKey = null;
let baseGalleryItems = [];
let filterMode = 'all';
let randomMode = false;
let slideshowActive = false;
let slideshowTimer = null;
let uiHidden = false;
let uiHideTimer = null;
let galleryStatusTimeout = null;
let loopGallery = true;
let GALLERY_CACHE_LIMIT = Infinity;
let galleryCacheOrder = [];

function apiGetJson(url) {
  return new Promise(resolve => {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: {
        Accept: 'text/css',
        Referer: location.href,
        'User-Agent': navigator.userAgent,
        'X-Requested-With': 'XMLHttpRequest'
      },
      onload: resp => {
        if (resp.status >= 200 && resp.status < 300) {
          try { resolve(JSON.parse(resp.responseText)); } catch { resolve(null); }
        } else { resolve(null); }
      },
      onerror: () => resolve(null)
    });
  });
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function setStatus(text, type) {
  const el = $('#filterStatus');
  if (!el) return;
  el.textContent = text || '';
  if (type === 'error') el.style.color = '#b00020';
  else if (type === 'success') el.style.color = '#0a7d2b';
  else el.style.color = '';
  syncFilterBoxVisibility();
  syncProgressBarVisibility();
}

function setIndexStatus(text, type) {
  const el = $('#indexStatus');
  if (!el) return;
  if (INDEX_STATUS_TIMER) {
    try { clearTimeout(INDEX_STATUS_TIMER); } catch {}
    INDEX_STATUS_TIMER = null;
  }
  el.textContent = text || '';
  if (type === 'error') el.style.color = '#b00020';
  else if (type === 'success') el.style.color = '#0a7d2b';
  else el.style.color = '';
  syncFilterBoxVisibility();
  syncProgressBarVisibility();
  if (type === 'success' && text && String(text).trim()) {
    INDEX_STATUS_TIMER = setTimeout(() => {
      INDEX_STATUS_TIMER = null;
      const el2 = $('#indexStatus');
      if (el2) el2.textContent = '';
      if (PENDING_FILTER_SUMMARY != null) {
        const fs = $('#filterStatus');
        if (fs) fs.textContent = PENDING_FILTER_SUMMARY;
        PENDING_FILTER_SUMMARY = null;
      }
      syncFilterBoxVisibility();
      syncProgressBarVisibility();
    }, 2000);
  }
}

function setFilterSummary(msg) {
  const fs = $('#filterStatus');
  if (!fs) return;
  if (INDEX_STATUS_TIMER) {
    PENDING_FILTER_SUMMARY = msg || '';
    return;
  }
  fs.textContent = msg || '';
  fs.style.color = '';
}

let injectTimer = null;

function debounce(fn, delay) {
  return () => { clearTimeout(injectTimer); injectTimer = setTimeout(fn, delay); };
}

let filterTimer = null;

function filterKey() {
  const parts = location.pathname.split('/');
  const service = parts[1] || 'svc';
  const userId = parts[3] || 'user';
  return 'pg_filters_' + service + '_' + userId;
}

function saveFilterState(){
  const fPages = $('#fPages')?.value || '';
  const fPosts = $('#fPosts')?.value || '';
  const fFiles = $('#fFiles')?.value || '';
  const state = { pages:fPages, posts:fPosts, files:fFiles, media:MEDIA_MODE || 'all' };
  try { localStorage.setItem(filterKey(), JSON.stringify(state)); } catch {}
}

function restoreFilterState(){
  let state = null;
  try { state = JSON.parse(localStorage.getItem(filterKey()) || 'null'); } catch {}
  if (!state) return;
  const fPages = $('#fPages');
  if (fPages) fPages.value = state.pages || '';
  const fPosts = $('#fPosts');
  if (fPosts) fPosts.value = state.posts || '';
  const fFiles = $('#fFiles');
  if (fFiles) fFiles.value = state.files || '';
  if (state.media && typeof state.media === 'string') {
    MEDIA_MODE = state.media;
  }
}

function scheduleFilter(){
  saveFilterState();
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    filterTimer = null;
    handleFilter();
  }, 250);
}

function getProfileKeyFromLocation(){
  const parts = location.pathname.split('/');
  if (parts.length >= 4 && parts[2] === 'user') {
    const service = parts[1];
    const userId = parts[3];
    if (service && userId) return service + '::' + userId;
  }
  return null;
}

function handleProfileContextChange(){
  const key = getProfileKeyFromLocation();
  if (!key) {
    PG_POSTS = null;
    PG_ID_MAP = null;
    PG_TOTAL = null;
    PG_GW = 1;
    PG_FILE_TOTAL = null;
    PG_FILE_URL_MAP = null;
    PG_POST_FILE_RANGE_MAP = null;
    keptPosts = [];
    CURRENT_PROFILE_KEY = null;
    PENDING_FILTER_SUMMARY = null;
    if (INDEX_STATUS_TIMER) {
      try { clearTimeout(INDEX_STATUS_TIMER); } catch {}
      INDEX_STATUS_TIMER = null;
    }
    PG_INDEX_LOADING = false;
    const fs = $('#filterStatus'); if (fs) fs.textContent = '';
    const is = $('#indexStatus'); if (is) is.textContent = '';
    const fPages = $('#fPages'); if (fPages) fPages.value = '';
    const fPosts = $('#fPosts'); if (fPosts) fPosts.value = '';
    const fFiles = $('#fFiles'); if (fFiles) fFiles.value = '';
    const fDur = $('#fDur'); if (fDur) fDur.value = '';
    $$('article.post-card').forEach(c => { c.style.display = ''; });
    document.querySelectorAll('.post-number-badge').forEach(el => el.remove());
    syncFilterBoxVisibility();
    scheduleHUD();
    return false;
  }
  if (CURRENT_PROFILE_KEY && CURRENT_PROFILE_KEY !== key) {
    PG_POSTS = null;
    PG_ID_MAP = null;
    PG_TOTAL = null;
    PG_GW = 1;
    PG_FILE_TOTAL = null;
    PG_FILE_URL_MAP = null;
    PG_POST_FILE_RANGE_MAP = null;
    keptPosts = [];
    lastFilterParams = {};
    PENDING_FILTER_SUMMARY = null;
  }
  CURRENT_PROFILE_KEY = key;
  return true;
}

function onUrlChange(){
  const href = location.href;
  if (href === lastUrl) return;
  lastUrl = href;
  if (!handleProfileContextChange()) return;
  scheduleFilter();
}

function getVisiblePostNumbers() {
  if (!PG_ID_MAP) return [];
  const cards = [...document.querySelectorAll('article.post-card')].filter(c => c.style.display !== 'none');
  const nums = [];
  for (const card of cards) {
    const id = card.getAttribute('data-id');
    if (!id) continue;
    const num = PG_ID_MAP.get(String(id));
    if (!num) continue;
    nums.push(String(num));
  }
  return nums;
}

function syncPageAllButtonState() {
  const btn = document.getElementById('btnPageAll');
  if (!btn) return;
  const input = document.getElementById('fPosts');
  if (!input) {
    btn.classList.remove('active');
    return;
  }
  const visible = getVisiblePostNumbers();
  if (!visible.length) {
    btn.classList.remove('active');
    return;
  }
  const postsSet = getPostFilterSet();
  if (!postsSet.size) {
    btn.classList.remove('active');
    return;
  }
  let allIncluded = true;
  for (const v of visible) {
    const n = Number(v);
    if (!n || !postsSet.has(n)) {
      allIncluded = false;
      break;
    }
  }
  if (allIncluded) btn.classList.add('active'); else btn.classList.remove('active');
}

function injectPostNumbers() {
  document.querySelectorAll('.post-number-badge').forEach(el => el.remove());
  const cards = [...document.querySelectorAll('article.post-card')].filter(c => c.style.display !== 'none');
  if (!cards.length) {
    syncPageAllButtonState();
    return;
  }

  if (!PG_ID_MAP) {
    buildGlobalIndexMapIfNeeded();
    return;
  }

  const selectedSet = getPostFilterSet();
  const selectedFilesSet = getFileFilterSet();

  cards.forEach(card => {
    const id = card.getAttribute('data-id');
    if (!id) return;
    const num = PG_ID_MAP.get(String(id));
    if (!num) return;
    const thumb = card.querySelector('.post__thumbnail') || card;
    thumb.style.position = 'relative';

    if (PG_POST_FILE_RANGE_MAP) {
      const r = PG_POST_FILE_RANGE_MAP.get(String(id));
      if (r && typeof r.min === 'number' && typeof r.max === 'number' && r.min > 0 && r.max >= r.min) {
        const badgeR = document.createElement('div');
        badgeR.className = 'post-number-badge pg-file-range-badge';
        const rangeStr = (r.min === r.max) ? String(r.min) : (String(r.min) + '-' + String(r.max));
        badgeR.textContent = rangeStr;
        badgeR.dataset.fileRangeMin = String(r.min);
        badgeR.dataset.fileRangeMax = String(r.max);

        let allIncluded = true;
        for (let i = r.min; i <= r.max; i++) {
          if (!selectedFilesSet.has(i)) { allIncluded = false; break; }
        }
        if (allIncluded) badgeR.classList.add('active');

        badgeR.addEventListener(badgeToggleEvent, e => {
          e.preventDefault();
          e.stopPropagation();
          handleFileRangeClick(badgeR);
        });
        thumb.appendChild(badgeR);
      }
    }

    const badge = document.createElement('div');
    badge.className = 'post-number-badge';
    const numStr = String(num);
    badge.textContent = numStr;
    badge.dataset.postNumber = numStr;
    const nVal = Number(numStr);
    if (nVal && selectedSet.has(nVal)) badge.classList.add('active');
    badge.addEventListener(badgeToggleEvent, e => {
      e.preventDefault();
      e.stopPropagation();
      handlePostNumberClick(badge);
    });
    thumb.appendChild(badge);
  });

  syncPageAllButtonState();
}

function getFileFilterSet() {
  const input = document.getElementById('fFiles');
  if (!input) return new Set();
  const raw = input.value || '';
  const set = parseIndices(raw);
  return set || new Set();
}

function handlePostNumberClick(el) {
  if (!el) return;
  const numStr = el.dataset.postNumber || (el.textContent || '').trim();
  if (!numStr) return;
  if (!/^\d+$/.test(numStr)) return;
  const num = Number(numStr);
  if (!num) return;
  const input = document.getElementById('fPosts');
  if (!input) return;
  const set = getPostFilterSet();
  if (set.has(num)) {
    set.delete(num);
    el.classList.remove('active');
  } else {
    set.add(num);
    el.classList.add('active');
  }
  input.value = formatIndexRanges(set);
  syncPageAllButtonState();
  scheduleFilter();
}

function handleFileRangeClick(el) {
  if (!el) return;
  const minStr = el.dataset.fileRangeMin || '';
  const maxStr = el.dataset.fileRangeMax || '';
  if (!/^\d+$/.test(minStr) || !/^\d+$/.test(maxStr)) return;
  const min = Number(minStr);
  const max = Number(maxStr);
  if (!min || !max || max < min) return;

  const input = document.getElementById('fFiles');
  if (!input) return;

  const set = getFileFilterSet();

  let allIncluded = true;
  for (let i = min; i <= max; i++) {
    if (!set.has(i)) { allIncluded = false; break; }
  }

  if (allIncluded) {
    for (let i = min; i <= max; i++) set.delete(i);
    el.classList.remove('active');
  } else {
    for (let i = min; i <= max; i++) set.add(i);
    el.classList.add('active');
  }

  input.value = formatIndexRanges(set);
  scheduleFilter();
}

function handleFileNumberClick(el) {
  if (!el) return;
  const numStr = el.dataset.fileNumber || (el.textContent || '').trim();
  if (!numStr) return;
  if (!/^\d+$/.test(numStr)) return;
  const num = Number(numStr);
  if (!num) return;
  const input = document.getElementById('fFiles');
  if (!input) return;
  const set = getFileFilterSet();
  if (set.has(num)) {
    set.delete(num);
    el.classList.remove('active');
  } else {
    set.add(num);
    el.classList.add('active');
  }
  input.value = formatIndexRanges(set);
  scheduleFilter();
}

function injectFileNumbers() {
  if (!PG_POSTS || !PG_POSTS.length) return;
  if (!PG_FILE_TOTAL || PG_FILE_TOTAL <= 0) return;
  if (!PG_FILE_URL_MAP) buildFileIndexFromPostsIfNeeded();
  if (!PG_FILE_URL_MAP) return;

  document.querySelectorAll('.pg-file-badge').forEach(el => el.remove());

  const selectedSet = getFileFilterSet();
  const thumbs = document.querySelectorAll('.post__thumbnail');
  thumbs.forEach(thumb => {
    const anchor = thumb.closest('a') || thumb;
    if (!anchor || !anchor.href) return;
    const key = normalizeFileUrl(anchor.href);
    if (!key) return;
    const g = PG_FILE_URL_MAP.get(key);
    if (!g || typeof g !== 'number') return;

    thumb.style.position = 'relative';
    const badge = document.createElement('div');
    badge.className = 'post-number-badge pg-file-badge';
    const numStr = String(g);
    badge.textContent = numStr;
    badge.dataset.fileNumber = numStr;
    const nVal = Number(numStr);
    if (nVal && selectedSet.has(nVal)) badge.classList.add('active');
    badge.addEventListener(badgeToggleEvent, e => {
      e.preventDefault();
      e.stopPropagation();
      handleFileNumberClick(badge);
    });
    thumb.appendChild(badge);
  });
}

function syncFilterBoxWidth(){
  const bar = document.getElementById('partyHUD');
  const post = document.getElementById('fPosts');
  if (!bar || !post) return;
  const b = bar.getBoundingClientRect();
  const p = post.getBoundingClientRect();
  const w = Math.max(0, Math.round(p.right - b.left));
  bar.style.setProperty('--hud-row-width', w + 'px');
}

function syncFilterBoxVisibility(){
  const box = document.getElementById('filterBox');
  if (!box) return;
  box.style.display = 'inline-flex';
}

function syncProgressBarVisibility(){
  const box = document.getElementById('dlBox');
  if (!box) return;
  const { downloading, queued } = getCounts();
  const hasActivity = (downloading + queued) > 0;
  if (hasActivity) {
    box.classList.remove('pg-dl-hidden');
    box.classList.add('pg-dl-visible');
  } else {
    box.classList.remove('pg-dl-visible');
    box.classList.add('pg-dl-hidden');
  }
}

function lockMediaButtonWidth(){
  const btn = document.getElementById('btnMedia');
  if (!btn) return;
  const labels = ['All','Images','GIFs','Videos'];
  const probe = btn.cloneNode(true);
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.left = '-9999px';
  probe.style.width = 'auto';
  probe.style.whiteSpace = 'nowrap';
  document.body.appendChild(probe);
  let max = 0;
  for (const t of labels){
    probe.textContent = t;
    max = Math.max(max, probe.offsetWidth);
  }
  document.body.removeChild(probe);
  btn.style.width = max + 'px';
}

function lockPreviewButtonWidth(){
  const btn = document.getElementById('filterBtn');
  if (!btn) return;
  const labels = ['Preview','Clear'];
  const probe = btn.cloneNode(true);
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.left = '-9999px';
  probe.style.width = 'auto';
  probe.style.whiteSpace = 'nowrap';
  document.body.appendChild(probe);
  let max = 0;
  for (const t of labels){
    probe.textContent = t;
    max = Math.max(max, probe.offsetWidth);
  }
  document.body.removeChild(probe);
  btn.style.width = max + 'px';
}

function buildHUD() {
  if ($('#partyHUD')) return;

  const w = document.createElement('div');
  w.id = 'partyHUD';
  w.innerHTML = `
    <div id="dlBox" aria-live="polite">
      <div id="dlSummaryLine">
        <span id="dlSummary"></span>
      </div>
      <div id="pgWrap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Download progress">
        <div id="pgTrack"><div id="pgFill"></div></div>
        <div id="pgBarLabel" aria-hidden="true">0%</div>
      </div>
    </div>
    <div id="filterBox">
      <span id="indexStatus"></span>
      <span id="filterStatus"></span>
    </div>
    <div id="hudRow" class="hud-row">
      <button id="dlBtn" class="full">Download</button>
      <button id="galleryBtn" class="full">Gallery</button>
      <button id="localGalleryBtn" class="full">Local Gallery</button>
      <button id="filterBtn" class="full">Preview</button>
      <button id="btnMedia" class="full">All</button>
      <button id="btnPageAll">Page</button>
      <input id="fPages" type="text" placeholder="Page">
      <input id="fPosts" type="text" placeholder="Post">
      <input id="fFiles" type="text" placeholder="File">
      <input id="fDur" type="text" placeholder="Duration">
    </div>
  `;
  document.body.appendChild(w);

  $('#dlBtn').onclick = handleDlBtn;

  const galleryBtn = $('#galleryBtn');
  if (galleryBtn) galleryBtn.onclick = handleGalleryToggle;

  const localGalleryBtn = $('#localGalleryBtn');
  if (localGalleryBtn) localGalleryBtn.onclick = handleLocalGalleryBtn;

  restoreFilterState();

  const mediaLabel = m => m === 'all' ? 'All' : m === 'images' ? 'Images' : m === 'gifs' ? 'GIFs' : 'Videos';
  const btnMedia = $('#btnMedia');
  if (btnMedia) btnMedia.textContent = mediaLabel(MEDIA_MODE);
  if (btnMedia) btnMedia.onclick = () => {
    MEDIA_MODE = MEDIA_MODE === 'all' ? 'images' : MEDIA_MODE === 'images' ? 'gifs' : MEDIA_MODE === 'gifs' ? 'videos' : 'all';
    btnMedia.textContent = mediaLabel(MEDIA_MODE);
    scheduleFilter();
  };

  const filterBtn = $('#filterBtn');
  if (filterBtn) {
    PREVIEW_MODE = false;
    filterBtn.textContent = 'Preview';
    filterBtn.classList.remove('clear');
    filterBtn.onclick = handlePreviewToggle;
  }

  const btnPageAll = $('#btnPageAll');
  if (btnPageAll) btnPageAll.onclick = handlePageAllBtn;

  const postsInput = $('#fPosts');
  if (postsInput) postsInput.addEventListener('input', () => {
    syncPageAllButtonState();
    scheduleFilter();
  });

  const pagesInput = $('#fPages');
  if (pagesInput) pagesInput.addEventListener('input', scheduleFilter);

  const filesInput = $('#fFiles');
  if (filesInput) filesInput.addEventListener('input', scheduleFilter);

  const durInput = $('#fDur');
  if (durInput) {
    if (!DURATION_FEATURE_ENABLED) {
      durInput.style.display = 'none';
    } else {
      durInput.addEventListener('input', scheduleFilter);
    }
  }

  const hudRow = document.getElementById('hudRow');
  if (hudRow && 'ResizeObserver' in window) {
    new ResizeObserver(() => { syncFilterBoxWidth(); }).observe(hudRow);
  }
  requestAnimationFrame(syncFilterBoxWidth);
  requestAnimationFrame(syncFilterBoxVisibility);
  requestAnimationFrame(syncProgressBarVisibility);
  requestAnimationFrame(lockMediaButtonWidth);
  requestAnimationFrame(lockPreviewButtonWidth);

  if (handleProfileContextChange()) {
    scheduleFilter();
  }
}

function allowedUrl(u) {
  const s = (u || '').split('?')[0];
  const isImg = imgRE.test(s), isVid = vidRE.test(s);
  const isGif = s.toLowerCase().endsWith('.gif');
  if (MEDIA_MODE === 'all') return isImg || isVid;
  if (MEDIA_MODE === 'images') return isImg;
  if (MEDIA_MODE === 'gifs') return isGif;
  if (MEDIA_MODE === 'videos') return isVid;
  return false;
}

function resolveFileUrl(obj) {
  if (!obj) return null;
  if (obj.path) {
    const p = obj.path.startsWith('/') ? obj.path : ('/' + obj.path);
    if (obj.path.startsWith('http')) return obj.path;
    return dataRoot + p;
  }
  if (obj.url && obj.url.startsWith('http')) return obj.url;
  return null;
}

function normalizeFileUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u, location.origin);
    let path = url.pathname || '';
    const idx = path.indexOf('/data/');
    if (idx >= 0) path = path.slice(idx);
    return path.toLowerCase();
  } catch {
    return (u.split('?')[0] || '').toLowerCase();
  }
}

const durCache = Object.create(null);

function getVideoDuration(u) {
  return durCache[u] ?? (durCache[u] = new Promise(res => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.crossOrigin = 'anonymous';
    v.src = u;
    const done = d => { try{v.remove();}catch{} try{v.src='';}catch{} res(d); };
    v.onloadedmetadata = () => done(v.duration || Infinity);
    v.onerror = () => done(Infinity);
  }));
}

const dl = { items: [], started: false, dispatching: false };
const cooldownTimers = new Map();

function parLimit() { return 3; }

function getCounts() {
  let total = dl.items.length, completed = 0, downloading = 0, queued = 0;
  for (const it of dl.items) {
    if (it.status === 'done') completed++;
    else if (it.status === 'active') downloading++;
    else if (it.status === 'queued') queued++;
  }
  return { total, completed, downloading, queued };
}

let uiScheduled = false;
let lastDropNoteAt = 0;
let lastDropNoteCount = 0;

function updateHUD() {
  if (!uiScheduled) return;
  uiScheduled = false;

  const { total, completed, downloading, queued } = getCounts();
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const pct = Math.max(0, Math.min(100, percent));

  const fill = $('#pgFill'); if (fill) fill.style.width = pct + '%';
  const barLabel = $('#pgBarLabel'); if (barLabel) barLabel.textContent = pct + '%';
  const pgWrap = $('#pgWrap'); if (pgWrap) pgWrap.setAttribute('aria-valuenow', String(pct));

  const cC = $('#completedCount'); if (cC) cC.textContent = completed;
  const qC = $('#queuedCount'); if (qC) qC.textContent = queued;

  const hasDropped = lastDropNoteCount > 0;
  const dropEl = $('#pgDrop'); if (dropEl) dropEl.style.display = hasDropped ? 'flex' : 'none';
  const xC = $('#droppedCount'); if (xC) xC.textContent = String(lastDropNoteCount);

  const dlSummaryEl = $('#dlSummary');
  if (dlSummaryEl) {
    const retries = lastDropNoteCount || 0;
    const totalFiles = total || 0;
    dlSummaryEl.textContent = `${totalFiles} files total • ${queued} Queued • ${downloading} Downloading • ${completed} Completed • ${retries} Retries`;
  }

  syncFilterBoxVisibility();
  syncProgressBarVisibility();
}

function scheduleHUD() {
  if (uiScheduled) return;
  uiScheduled = true;
  requestAnimationFrame(updateHUD);
}

function requestDispatch() {
  if (dl.dispatching) return;
  dl.dispatching = true;
  queueMicrotask(() => {
    try {
      if (!dl.started) return;
      let startedAny = false;
      while (activeCount() < parLimit()) {
        const it = claimNext();
        if (!it) break;
        startedAny = true;
        startDownload(it);
      }
      if (startedAny) scheduleHUD();
    } finally {
      dl.dispatching = false;
      if (dl.started && hasRunnableQueued() && activeCount() < parLimit()) requestDispatch();
    }
  });
}

function activeCount() {
  let n = 0;
  for (const it of dl.items) if (it.status === 'active') n++;
  return n;
}

function hasRunnableQueued() {
  const now = Date.now();
  for (const it of dl.items) if (it.status === 'queued' && now >= (it.nextAt || 0)) return true;
  return false;
}

function claimNext() {
  const now = Date.now();
  for (const it of dl.items) {
    if (it.status === 'queued' && now >= (it.nextAt || 0)) { it.status = 'active'; return it; }
  }
  return null;
}

function enqueueItems(objs) {
  const toAdd = [];
  for (const obj of objs) {
    const url = obj.url;
    const name = obj.name;
    const meta = obj.meta || null;
    toAdd.push({ url, name, meta, status: 'queued', attempts: 0, nextAt: 0 });
  }
  if (!toAdd.length) return;
  dl.items.push(...toAdd);
  scheduleHUD();
  if (dl.started) requestDispatch();
}

function maybeFinishBatch() {
  const { total, completed, downloading, queued } = getCounts();
  if (total > 0 && completed === total && downloading === 0 && queued === 0) {
    DL_ACTIVE = false;
    dl.started = false;
    const b = $('#dlBtn'); if (b) { b.classList.remove('stop'); b.textContent = 'Download'; }
  }
}

function startDownload(item) {
  const name = item.name;
  const isVid = vidRE.test(item.url);
  const totalMs = isVid ? STALL_VID_TOTAL_MS : STALL_IMG_TOTAL_MS;
  const idleMs = isVid ? STALL_VID_IDLE_MS : STALL_IMG_IDLE_MS;
  let lastProgressAt = Date.now();
  let settled = false;

  const clearWatchers = () => { try { clearTimeout(tTotal); } catch {} try { clearInterval(tIdle); } catch {} };

  const handleFailure = () => {
    if (settled) return;
    settled = true;
    try { if (item._handle && typeof item._handle.abort === 'function') item._handle.abort(); } catch {}
    clearWatchers();

    const prev = retryMap[item.url] || 0;
    const n = prev + 1;
    retryMap[item.url] = n;

    lastDropNoteAt = Date.now();
    lastDropNoteCount++;

    const level = Math.min(n, MAX_RETRIES);
    const backoff = BACKOFF_BASE * Math.pow(2, level - 1) + Math.floor(Math.random() * 500);

    item.status = 'queued';
    item.nextAt = Date.now() + backoff;

    const prevTimer = cooldownTimers.get(item.url);
    if (prevTimer) clearTimeout(prevTimer);

    const tid = setTimeout(() => {
      item.nextAt = 0;
      scheduleHUD();
      if (dl.started) requestDispatch();
    }, backoff + 5);
    cooldownTimers.set(item.url, tid);

    const idx = dl.items.indexOf(item);
    if (idx >= 0) {
      dl.items.splice(idx, 1);
      dl.items.push(item);
    }

    scheduleHUD();
    setTimeout(requestDispatch, 0);
  };

  const tTotal = setTimeout(() => handleFailure(), totalMs);
  const tIdle = setInterval(() => {
    if (Date.now() - lastProgressAt > idleMs) handleFailure();
  }, 2000);

  const handle = GM_download({
    url: item.url,
    name,
    headers: { Referer: location.href, Accept: 'text/css' },
    timeout: 0,
    onprogress: () => { lastProgressAt = Date.now(); },
    onload: () => {
      if (settled) return;
      settled = true;
      clearWatchers();
      item.status = 'done';
      scheduleHUD();
      setTimeout(requestDispatch, SPAWN_DELAY + Math.floor(Math.random() * 200));
      maybeFinishBatch();
    },
    onerror: () => handleFailure()
  });
  item._handle = handle;
}

function parsePages(str) {
  const set = new Set();
  if (!str.trim()) return null;
  str.split(',').forEach(p => {
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(Number);
      if (!a || !b || a <= 0 || b < a) return;
      for (let i = a; i <= b; i++) set.add(i);
    } else {
      const n = parseInt(p, 10);
      if (!n || n <= 0) return;
      set.add(n);
    }
  });
  return set.size ? [...set].sort((a, b) => a - b) : null;
}

function parseIndices(str) {
  const set = new Set();
  if (!str.trim()) return null;
  const tokens = str.split(',').map(s=>s.trim()).filter(Boolean);
  for (const token of tokens){
    if (token.includes('-')) {
      const [a, b] = token.split('-').map(Number);
      if (!a || !b || a <= 0 || b < a) continue;
      for (let i=a;i<=b;i++) set.add(i);
    } else {
      const n = parseInt(token, 10);
      if (!n || n <= 0) continue;
      set.add(n);
    }
  }
  return set.size ? new Set([...set].sort((a, b) => a - b)) : new Set();
}

function formatIndexRanges(set) {
  if (!set || !(set instanceof Set) || set.size === 0) return '';
  let nums = [...set].filter(n => Number.isInteger(n) && n > 0);
  if (!nums.length) return '';
  nums.sort((a, b) => a - b);
  const parts = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i < nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) {
      prev = n;
    } else {
      if (start === prev) parts.push(String(start));
      else parts.push(start + '-' + prev);
      start = n;
      prev = n;
    }
  }
  if (start === prev) parts.push(String(start));
  else parts.push(start + '-' + prev);
  return parts.join(', ');
}

function getPostFilterSet() {
  const input = document.getElementById('fPosts');
  if (!input) return new Set();
  const raw = input.value || '';
  const set = parseIndices(raw);
  return set || new Set();
}

function parseDurationRanges(str) {
  const out = [];
  if (!str || !str.trim()) return out;
  const tokens = str.split(',').map(s => s.trim()).filter(Boolean);
  for (const token of tokens) {
    if (!token) continue;
    if (token.includes('-')) {
      const parts = token.split('-');
      if (!parts.length) continue;
      const a = (parts[0] || '').trim();
      const b = (parts[1] || '').trim();
      const min = (a ? parseFloat(a) : NaN);
      const max = (b ? parseFloat(b) : NaN);
      const hasMin = !isNaN(min);
      const hasMax = !isNaN(max);
      if (!hasMin && !hasMax) continue;
      const minVal = hasMin ? min : 0;
      const maxVal = hasMax ? max : null;
      if (maxVal != null && maxVal < minVal) continue;
      out.push({ min: minVal, max: maxVal });
    } else {
      const v = parseFloat(token);
      if (isNaN(v)) continue;
      out.push({ min: v, max: null });
    }
  }
  return out;
}

function formatFilename(post, fileObj, index, globalIndex) {
  const user = post.user || userName();
  const sanitizeUserFolder = s => {
    s = (s || '').normalize('NFC');
    s = s.replace(/\s+/g, '_');
    s = s.replace(/[\\/:*?"<>|]+/g, '');
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return s;
  };
  const sanitizeNamePart = s => {
    s = (s || '').normalize('NFC');
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/ - /g, '-');
    s = s.replace(/[\\/:*?"<>|]+/g, '');
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/ +/g, ' ').replace(/^ +| +$/g, '');
    return s;
  };
  const titleRaw = (post.title && post.title.trim()) ? post.title : ('post_' + post.id);
  const threadRaw = user;
  const userSec = sanitizeUserFolder(user);
  let threadSec = sanitizeNamePart(threadRaw).slice(0, 40);
  if (!threadSec) threadSec = sanitizeNamePart(user).slice(0, 40);
  let titleSec = sanitizeNamePart(titleRaw).slice(0, 40);
  if (!titleSec) titleSec = sanitizeNamePart('post_' + post.id).slice(0, 40);
  const ext = (fileObj.name || fileObj.path || '').split('.').pop().split('?')[0].toLowerCase();
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


let keptPosts = [];

async function enumerateAllPosts(service, userId, progressCb) {
  const posts = [];
  let pg = 1;
  while (true) {
    if (typeof progressCb === 'function') {
      try { progressCb(pg, posts.length); } catch {}
    }
    const o = (pg - 1) * POSTS_PER_PAGE;
    const apiUrl = `/api/v1/${service}/user/${userId}/posts?o=${o}`;
    const resp = await apiGetJson(apiUrl);
    const arr = Array.isArray(resp) ? resp : (resp && (resp.results || resp.posts)) || [];
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const copy = Object.assign({}, p);
      copy.pgPage = pg;
      copy.pgIdxOnPage = i + 1;
      posts.push(copy);
    }
    if (arr.length < POSTS_PER_PAGE) break;
    pg++;
    await sleep(200 + Math.floor(Math.random()*200));
  }
  return posts;
}

async function fetchNewestPost(service, userId) {
  const apiUrl = `/api/v1/${service}/user/${userId}/posts?o=0`;
  const resp = await apiGetJson(apiUrl);
  const arr = Array.isArray(resp) ? resp : (resp && (resp.results || resp.posts)) || [];
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[0];
}

function buildFileIndexFromPostsIfNeeded() {
  if (!PG_POSTS || !PG_POSTS.length) {
    PG_FILE_TOTAL = null;
    PG_FILE_URL_MAP = null;
    PG_POST_FILE_RANGE_MAP = null;
    return;
  }
  let haveFiles = false;
  for (const meta of PG_POSTS) {
    if (Array.isArray(meta.pgFiles) && meta.pgFiles.length) { haveFiles = true; break; }
  }
  if (haveFiles) {
    let maxG = 0;
    for (const meta of PG_POSTS) {
      if (!Array.isArray(meta.pgFiles)) continue;
      for (const f of meta.pgFiles) {
        if (!f || typeof f.g !== 'number') continue;
        if (f.g > maxG) maxG = f.g;
      }
    }
    PG_FILE_TOTAL = maxG || null;
  } else {
    let total = 0;
    for (const meta of PG_POSTS) {
      let refs = [];
      const add = o => { const u = resolveFileUrl(o); if (u) refs.push(u); };
      if (meta.file) add(meta.file);
      if (meta.attachments) meta.attachments.forEach(add);
      const seen = new Set();
      const uniqRefs = [];
      for (const ref of refs) {
        const key = (ref.split('?')[0] || '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniqRefs.push(ref);
      }
      const tmp = [];
      for (const ref of uniqRefs) {
        const base = (ref.split('?')[0] || '');
        const isImg = imgRE.test(base);
        const isVid = vidRE.test(base);
        if (!isImg && !isVid) continue;
        tmp.push({ url: ref, isVid });
        total++;
      }
      if (tmp.length) meta._pgTempFiles = tmp;
    }
    if (!total) {
      PG_FILE_TOTAL = 0;
      PG_FILE_URL_MAP = null;
      PG_POST_FILE_RANGE_MAP = null;
      for (const meta of PG_POSTS) { delete meta._pgTempFiles; }
      return;
    }
    PG_FILE_TOTAL = total;
    let g = total;
    for (const meta of PG_POSTS) {
      const tmp = meta._pgTempFiles;
      if (!tmp || !tmp.length) { delete meta._pgTempFiles; continue; }
      const pf = [];
      let local = 1;
      for (const item of tmp) {
        pf.push({ g, local, url: item.url, isVid: !!item.isVid });
        g--;
        local++;
      }
      meta.pgFiles = pf;
      delete meta._pgTempFiles;
    }
  }
  for (const meta of PG_POSTS) {
    if (!Array.isArray(meta.pgFiles)) continue;
    for (const f of meta.pgFiles) {
      if (!f) continue;
      if (typeof f.dur !== 'number' || !isFinite(f.dur)) {
        f.dur = DURATION_FEATURE_ENABLED ? null : 0;
      } else if (!DURATION_FEATURE_ENABLED) {
        f.dur = 0;
      }
    }
  }
  PG_FILE_URL_MAP = new Map();
  for (const meta of PG_POSTS) {
    if (!Array.isArray(meta.pgFiles)) continue;
    for (const f of meta.pgFiles) {
      if (!f || !f.url || typeof f.g !== 'number') continue;
      const key = normalizeFileUrl(f.url);
      if (!key) continue;
      if (!PG_FILE_URL_MAP.has(key)) PG_FILE_URL_MAP.set(key, f.g);
    }
  }

  PG_POST_FILE_RANGE_MAP = new Map();
  for (const meta of PG_POSTS) {
    if (!meta || meta.id == null) continue;
    const files = Array.isArray(meta.pgFiles) ? meta.pgFiles : [];
    if (!files.length) continue;
    let min = Infinity;
    let max = 0;
    for (const f of files) {
      const g = f && typeof f.g === 'number' ? f.g : 0;
      if (!g || g <= 0) continue;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    if (isFinite(min) && max > 0 && max >= min) {
      PG_POST_FILE_RANGE_MAP.set(String(meta.id), { min, max });
    }
  }
}

async function ensureVideoDurations() {
  if (!DURATION_FEATURE_ENABLED) return;
  if (!PG_POSTS || !PG_POSTS.length) return;
  const vids = [];
  for (const meta of PG_POSTS) {
    if (!Array.isArray(meta.pgFiles)) continue;
    for (const f of meta.pgFiles) {
      if (!f || !f.isVid) continue;
      vids.push(f);
    }
  }
  if (!vids.length) return;
  let idx = 0;
  for (const f of vids) {
    idx++;
    if (typeof f.dur === 'number' && isFinite(f.dur) && f.dur > 0) continue;
    setIndexStatus('Checking video ' + idx + ' of ' + vids.length + ' (file #' + (f.g || idx) + ')...', 'info');
    const d = await getVideoDuration(f.url);
    const dur = (isFinite(d) && d >= 0) ? d : 0;
    f.dur = dur;
  }
  setIndexStatus('', 'info');
}

async function buildGlobalIndexMapIfNeeded() {
  if ((PG_ID_MAP && PG_POSTS) || PG_INDEX_LOADING) return;
  const key = getProfileKeyFromLocation();
  if (!key) return;
  PG_INDEX_LOADING = true;
  try {
    const parts = location.pathname.split('/');
    const service = parts[1];
    const isUser = parts[2] === 'user';
    const userId = isUser ? parts[3] : null;
    if (!service || !isUser || !userId) return;
    const cacheKey = 'pg_postindex_' + service + '_' + userId;
    let parsed = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        parsed = JSON.parse(raw);
      }
    } catch {}
    if (parsed && Array.isArray(parsed.posts) && parsed.posts.length) {
      const posts = parsed.posts;
      let useCache = true;
      try {
        const cachedNewest = posts[0];
        if (!cachedNewest || !cachedNewest.id) {
          useCache = false;
        } else {
          const liveNewest = await fetchNewestPost(service, userId);
          if (liveNewest && liveNewest.id != null) {
            const liveId = String(liveNewest.id);
            const cachedId = String(cachedNewest.id);
            if (liveId !== cachedId) {
              useCache = false;
              setIndexStatus('Detected new posts. Rebuilding index...', 'info');
            }
          }
        }
      } catch (e) {
        useCache = false;
      }
      if (useCache) {
        let schema = typeof parsed.schema === 'number' ? parsed.schema : 1;
        const meta = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {};
        const durationMeta = meta.duration && typeof meta.duration === 'object' ? meta.duration : {};
        let durationCollected = !!durationMeta.durationCollected;
        if (schema < 3) durationCollected = false;
        PG_POSTS = posts;
        PG_TOTAL = posts.length;
        PG_GW = String(PG_TOTAL).length;
        const map = new Map();
        for (let i = 0; i < posts.length; i++) {
          const p = posts[i];
          const id = String(p.id);
          const g = typeof p.pgGlobalIndex === 'number' ? p.pgGlobalIndex : (PG_TOTAL - i);
          p.pgGlobalIndex = g;
          map.set(id, g);
        }
        PG_ID_MAP = map;
        buildFileIndexFromPostsIfNeeded();
        let upgraded = false;
        if (schema < 3) {
          schema = 3;
          upgraded = true;
        }
        if (DURATION_FEATURE_ENABLED && !durationCollected) {
          await ensureVideoDurations();
          durationCollected = true;
          upgraded = true;
        }
        const newMeta = Object.assign({}, meta, {
          duration: {
            featureEnabledAtBuild: !!DURATION_FEATURE_ENABLED,
            durationCollected: !!durationCollected,
            unit: 'seconds'
          }
        });
        if (upgraded) {
          try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), schema, meta: newMeta, posts: PG_POSTS })); } catch {}
        }
        setIndexStatus('Loaded index from cache: ' + PG_TOTAL + ' posts', 'success');
        injectPostNumbers();
        injectFileNumbers();
        scheduleFilter();
        return;
      }
    }
    setIndexStatus('Starting post index...', 'info');
    const posts = await enumerateAllPosts(service, userId, (pg, countSoFar) => {
      setIndexStatus('Indexing page ' + pg + '...', 'info');
    });
    if (posts && posts.length) {
      const total = posts.length;
      PG_TOTAL = total;
      PG_GW = String(total).length;
      const map = new Map();
      for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        const g = total - i;
        p.pgGlobalIndex = g;
        map.set(String(p.id), g);
      }
      PG_POSTS = posts;
      PG_ID_MAP = map;
      buildFileIndexFromPostsIfNeeded();
      let durationCollected = false;
      if (DURATION_FEATURE_ENABLED) {
        await ensureVideoDurations();
        durationCollected = true;
      }
      const meta = {
        duration: {
          featureEnabledAtBuild: !!DURATION_FEATURE_ENABLED,
          durationCollected: durationCollected,
          unit: 'seconds'
        }
      };
      try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), schema: 3, meta, posts: PG_POSTS })); } catch {}
      setIndexStatus('Indexing complete: ' + PG_TOTAL + ' posts', 'success');
      injectPostNumbers();
      injectFileNumbers();
      scheduleFilter();
    } else {
      setIndexStatus('Indexing failed', 'error');
    }
  } finally {
    PG_INDEX_LOADING = false;
  }
}

function formatPagesClause(set) {
  if (!set || !(set instanceof Set) || set.size === 0) return '';
  let arr = [...set].map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!arr.length) return '';
  arr.sort((a,b)=>a-b);
  const totalPages = arr.length;
  const ranges = [];
  let start = arr[0];
  let prev = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const n = arr[i];
    if (n === prev + 1) {
      prev = n;
    } else {
      ranges.push([start, prev]);
      start = n;
      prev = n;
    }
  }
  ranges.push([start, prev]);
  const labels = ranges.map(([a,b]) => a === b ? String(a) : a + '-' + b);
  if (labels.length === 1) {
    if (totalPages === 1) return ' on page ' + labels[0];
    return ' on pages ' + labels[0];
  }
  if (labels.length === 2) return ' on pages ' + labels[0] + ' and ' + labels[1];
  const last = labels.pop();
  return ' on pages ' + labels.join(', ') + ', and ' + last;
}

function computeGallerySessionKey(){
  if (!lastFilterParams || typeof lastFilterParams !== 'object') return null;
  try { return JSON.stringify(lastFilterParams); } catch { return null; }
}

async function handleFilter() {
  const st = $('#filterStatus');
  if (st) st.textContent = '';

  const profileKey = getProfileKeyFromLocation();
  if (!profileKey) {
    const st2 = $('#filterStatus'); if (st2) st2.textContent = '';
    return;
  }

  const pagesRaw = $('#fPages')?.value || '';
  const postsRaw = $('#fPosts')?.value || '';
  const filesRaw = $('#fFiles')?.value || '';
  const durRaw = $('#fDur')?.value || '';
  const parsedPosts = parseIndices(postsRaw);
  if (postsRaw.trim() && (!parsedPosts || parsedPosts.size === 0)) { if (st) st.textContent = 'Invalid posts'; scheduleHUD(); return; }
  const parsedFiles = parseIndices(filesRaw);
  if (filesRaw.trim() && (!parsedFiles || parsedFiles.size === 0)) { if (st) st.textContent = 'Invalid files'; scheduleHUD(); return; }
  const filteringByPosts = parsedPosts && parsedPosts.size;
  const filteringByFiles = parsedFiles && parsedFiles.size;

  const durRanges = parseDurationRanges(durRaw);
  const durationFiltering = DURATION_FEATURE_ENABLED && durRanges.length > 0;

  if (!PG_TOTAL) { PG_TOTAL = null; PG_GW = 1; }

  keptPosts = [];
  const usedPages = new Set();

  const [, service, , userId] = location.pathname.split('/');
  lastFilterParams = { postRaw: postsRaw, service, media: MEDIA_MODE, durRaw, pagesRaw, filesRaw };

  await buildGlobalIndexMapIfNeeded();
  if (!PG_POSTS || !PG_POSTS.length) {
    if (PG_INDEX_LOADING) {
      scheduleHUD();
      return;
    }
    if (st) st.textContent = 'Unable to build index';
    scheduleHUD();
    return;
  }
  if (!PG_TOTAL || PG_TOTAL <= 0) {
    PG_TOTAL = PG_POSTS.length;
    PG_GW = String(PG_TOTAL).length;
  }

  const allowed = new Set();
  let totalFiles = 0;

  let postIndexSet = null;
  if (filteringByPosts) {
    const total = PG_TOTAL || PG_POSTS.length;
    if (!total || total <= 0) { if (st) st.textContent = 'Unable to resolve total posts'; scheduleHUD(); return; }
    let dropped = 0;
    postIndexSet = new Set();
    parsedPosts.forEach(n => {
      if (n < 1 || n > total) { dropped++; return; }
      postIndexSet.add(n);
    });
    if (dropped && st) st.textContent = `Ignored ${dropped} invalid indices`;
  }

  let pagesSet = null;
  if (pagesRaw.trim()) {
    const parsedPages = parsePages(pagesRaw);
    if (!parsedPages) { if (st) st.textContent = 'Invalid pages'; scheduleHUD(); return; }
    pagesSet = new Set(parsedPages);
  }

  for (const meta of PG_POSTS) {
    const id = String(meta.id);
    const gIndex = typeof meta.pgGlobalIndex === 'number' ? meta.pgGlobalIndex : (PG_ID_MAP && PG_ID_MAP.get(id)) || 0;
    const pageNum = meta.pgPage || 1;

    if (filteringByPosts && postIndexSet && postIndexSet.size && !postIndexSet.has(gIndex)) continue;
    if (pagesSet && !pagesSet.has(pageNum)) continue;

    const allFiles = Array.isArray(meta.pgFiles) ? meta.pgFiles : [];
    if (!allFiles.length) continue;

    let fileCandidates = allFiles;
    if (filteringByFiles && parsedFiles && parsedFiles.size) {
      fileCandidates = allFiles.filter(f => parsedFiles.has(f.g));
      if (!fileCandidates.length) continue;
    }

    const allowedFilesArr = [];
    for (const f of fileCandidates) {
      const ref = f && f.url;
      if (!ref) continue;
      if (!allowedUrl(ref)) continue;
      if (f.isVid && durationFiltering) {
        const d = (typeof f.dur === 'number' && isFinite(f.dur)) ? f.dur : 0;
        let inRange = false;
        for (const r of durRanges) {
          if (d >= r.min && (r.max == null || d <= r.max)) {
            inRange = true;
            break;
          }
        }
        if (!inRange) continue;
      }
      allowedFilesArr.push({ url: ref, g: f.g });
    }
    if (!allowedFilesArr.length) continue;

    allowed.add(id);
    usedPages.add(pageNum);
    keptPosts.push({ post: meta, allowedFiles: allowedFilesArr, globalIndex: gIndex });
    totalFiles += allowedFilesArr.length;
  }

  if (PREVIEW_MODE) {
    $$('article.post-card').forEach(c => {
      const id = c.getAttribute('data-id');
      c.style.display = allowed.has(id) ? '' : 'none';
    });
  } else {
    $$('article.post-card').forEach(c => {
      c.style.display = '';
    });
  }

  let msg = 'Showing ' + keptPosts.length + ' posts and ' + totalFiles + ' files';
  msg += formatPagesClause(usedPages);
  setFilterSummary(msg);
  injectPostNumbers();
  injectFileNumbers();
  syncPageAllButtonState();
  scheduleHUD();
}

function handlePreviewToggle() {
  const btn = $('#filterBtn');
  if (!btn) return;

  PREVIEW_MODE = !PREVIEW_MODE;

  if (PREVIEW_MODE) {
    btn.textContent = 'Clear';
    btn.classList.add('clear');
  } else {
    btn.textContent = 'Preview';
    btn.classList.remove('clear');
  }

  handleFilter();
}

async function queueFiltered() {
  if (!keptPosts.length) return;
  const objs = [];
  keptPosts.forEach(kp => {
    const { post, allowedFiles, globalIndex } = kp;
    allowedFiles.forEach(fileInfo => {
      if (!fileInfo || !fileInfo.url) return;
      const ref = fileInfo.url;
      const fileObj = { path: ref };
      const name = formatFilename(post, fileObj, fileInfo.g, globalIndex);
      objs.push({ url: ref, name, meta: { post, url: ref, globalIndex, fileIndex: fileInfo.g } });
    });
  });
  if (!objs.length) {
    const st = $('#filterStatus');
    if (st) st.textContent = 'No files matched your filters.';
    scheduleHUD();
    return;
  }
  LAST_QUEUE_HAD_ITEMS = true;
  enqueueItems(objs);
}

async function handlePageAllBtn() {
  const input = document.getElementById('fPosts');
  if (!input) return;
  const visible = getVisiblePostNumbers();
  if (!visible.length) {
    syncPageAllButtonState();
    return;
  }
  const btn = document.getElementById('btnPageAll');
  const set = getPostFilterSet();

  if (btn && btn.classList.contains('active')) {
    if (!set.size) {
      syncPageAllButtonState();
      return;
    }
    for (const v of visible) {
      const n = Number(v);
      if (!n) continue;
      set.delete(n);
    }
    input.value = formatIndexRanges(set);
    injectPostNumbers();
    syncPageAllButtonState();
    scheduleFilter();
    return;
  }

  let changed = false;
  for (const v of visible) {
    const n = Number(v);
    if (!n) continue;
    if (!set.has(n)) {
      set.add(n);
      changed = true;
    }
  }
  if (changed) {
    input.value = formatIndexRanges(set);
    injectPostNumbers();
  }
  syncPageAllButtonState();
  scheduleFilter();
}

async function handleClear() {
  const b = $('#dlBtn');
  dl.started = false;
  DL_ACTIVE = false;
  if (b) { b.classList.remove('stop'); b.textContent = 'Download'; }
  cooldownTimers.forEach(id => clearTimeout(id));
  cooldownTimers.clear();
  for (const k in retryMap) delete retryMap[k];
  lastDropNoteAt = 0;
  lastDropNoteCount = 0;
  dl.items.length = 0;
  const cC = $('#completedCount'); if (cC) cC.textContent = '0';
  const qC = $('#queuedCount'); if (qC) qC.textContent = '0';
  const xC = $('#droppedCount'); if (xC) xC.textContent = '0';
  const dropEl = $('#pgDrop'); if (dropEl) dropEl.style.display = 'none';
  const fill = $('#pgFill'); if (fill) fill.style.width = '0%';
  const barLabel = $('#pgBarLabel'); if (barLabel) barLabel.textContent = '0%';
  injectPostNumbers();
  syncPageAllButtonState();
  scheduleHUD();
}

async function handleDlBtn() {
  const b = $('#dlBtn');

  if (!DL_ACTIVE) {
    const c = getCounts();
    if (c.total > 0 && c.completed === c.total && c.downloading === 0 && c.queued === 0) {
      await handleClear();
    }

    if (dl.items.length > 0) {
      DL_ACTIVE = true;
      dl.started = true;
      b.classList.add('stop');
      b.textContent = 'Stop';
      requestDispatch();
      scheduleHUD();
      return;
    }

    dl.started = false;
    DL_ACTIVE = false;
    LAST_QUEUE_HAD_ITEMS = false;
    keptPosts = [];
    lastFilterParams = {};
    for (const k in retryMap) delete retryMap[k];
    cooldownTimers.forEach(id => clearTimeout(id));
    cooldownTimers.clear();
    dl.items.length = 0;
    lastDropNoteAt = 0;
    lastDropNoteCount = 0;
    const st = $('#filterStatus'); if (st) st.textContent = '';
    const fill = $('#pgFill'); if (fill) fill.style.width = '0%';
    const barLabel = $('#pgBarLabel'); if (barLabel) barLabel.textContent = '0%';
    const cC = $('#completedCount'); if (cC) cC.textContent = '0';
    const qC = $('#queuedCount'); if (qC) qC.textContent = '0';
    const dropEl = $('#pgDrop'); if (dropEl) dropEl.style.display = 'none';
    const xC = $('#droppedCount'); if (xC) xC.textContent = '0';
    await handleFilter();
    await queueFiltered();

    if (LAST_QUEUE_HAD_ITEMS) {
      DL_ACTIVE = true;
      dl.started = true;
      b.classList.add('stop');
      b.textContent = 'Stop';
      requestDispatch();
      scheduleHUD();
    } else {
      DL_ACTIVE = false;
      dl.started = false;
      b.classList.remove('stop');
      b.textContent = 'Download';
      scheduleHUD();
    }
  } else {
    dl.started = false;
    DL_ACTIVE = false;
    b.classList.remove('stop');
    b.textContent = 'Download';
    scheduleHUD();
  }
}

function pgUserKey(slug) { return 'pg_u_' + slug; }

function pgExtractSummary(url, orUser) {
  const m = (url || '').match(/\/user\/([^/]+)/);
  if (m) {
    const k = pgUserKey(m[1]);
    let s = null;
    try { s = JSON.parse(localStorage.getItem(k) || 'null'); } catch { }
    if (s && !s.user) s.user = m[1];
    return s ? s : (orUser ? m[1] : s);
  }
  return false;
}

function pgLoadSummary(slug) {
  const k = pgUserKey(slug);
  try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; }
}

function pgSaveSummary(slug, obj) {
  const k = pgUserKey(slug);
  try { localStorage.setItem(k, JSON.stringify(obj)); } catch { }
}

function pgTodayISO() { return new Date().toISOString().split('T')[0]; }

function pgEnsureVisit(slug) {
  let s = pgLoadSummary(slug);
  const today = pgTodayISO();

  if (!s) {
    s = { user: slug, visits: 1, previousVisit: false, lastVisit: today, disliked: false };
  } else {
    if (s.lastVisit !== today) {
      s.visits = (s.visits || 0) + 1;
      s.previousVisit = s.lastVisit || false;
      s.lastVisit = today;
      if (!s.user) s.user = slug;
      if (typeof s.disliked !== 'boolean') s.disliked = false;
    }
  }

  pgSaveSummary(slug, s);
  return s;
}

function pgTextContains(el, txt) { return el && typeof el.textContent === 'string' && el.textContent.trim() === txt; }

function pgCopyText(str) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(str).catch(() => { });
  } else {
    const t = document.createElement('textarea');
    t.value = str;
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch { }
    t.remove();
  }
}

function pgEnhanceUserPages(root) {
  const up = location.pathname.match(/\/user\/([^/]+)$/);
  const upp = location.pathname.match(/\/user\/([^/]+)\/post/);
  if (!up && !upp) return;

  const slugVal = (up || upp)[1];
  const cssPrefix = up ? 'user-header' : 'post';
  const summary = pgEnsureVisit(slugVal);

  if (up) {
    if (!document.querySelector('.pg-visit-summary')) {
      const parent = $(`.${cssPrefix}__info`);
      if (parent) {
        const wrap = document.createElement('div');
        const span = document.createElement('span');
        span.className = 'pg-visit-summary';
        span.textContent = summary.previousVisit ? `Visited ${summary.visits} times, last visit on ${summary.previousVisit}` : `First visit`;
        wrap.appendChild(span);
        parent.appendChild(wrap);
      }
    }
  } else {
    if (!document.querySelector('.pg-visit-summary')) {
      const parent = $(`.${cssPrefix}__published`);
      if (parent) {
        const span = document.createElement('span');
        span.className = 'pg-visit-summary';
        span.textContent = summary.previousVisit ? `Visited ${summary.visits} times, last visit on ${summary.previousVisit}` : `First visit`;
        parent.appendChild(span);
      }
    }

    const navTop = $('nav.post__nav-links'), footer = $('footer.post__footer');
    if (navTop && footer && !footer.querySelector('.pg-nav-clone')) {
      const clone = navTop.cloneNode(true);
      clone.classList.add('pg-nav-clone');
      footer.appendChild(clone);
    }

    if (root.querySelectorAll || root.tagName === 'H2') {
      const headers = root.tagName === 'H2' ? [root] : document.querySelectorAll('h2');
      headers.forEach(h => {
        if (pgTextContains(h, 'Downloads') && !h.querySelector('.pg-copy-btn')) {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'pg-btn pg-copy-btn'; btn.textContent = 'Copy';
          btn.onclick = () => {
            let out = ''; let c = 0;
            document.querySelectorAll('a.post__attachment-link').forEach(a => { out += a.href + '\n'; c++; });
            if (out) pgCopyText(out);
          };
          h.appendChild(btn);
        }
      });
    }
  }

  if (!$(`.${cssPrefix}__actions .pg-dislike-btn`)) {
    const act = $(`.${cssPrefix}__actions`);
    if (act) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pg-btn pg-dislike-btn';
      btn.textContent = summary.disliked ? 'Undislike' : 'Dislike';
      btn.onclick = () => {
        const s = pgLoadSummary(slugVal) || { user: slugVal, visits: 1, previousVisit: false, lastVisit: pgTodayISO(), disliked: false };
        s.disliked = !s.disliked;
        pgSaveSummary(slugVal, s);
        btn.textContent = s.disliked ? 'Undislike' : 'Dislike';
      };
      act.appendChild(btn);
    }
  }
}

function pgEnhanceArtists(root) {
  if (!/\/artists/.test(location.pathname)) return;

  const processCard = card => {
    if (!card || card.classList.contains('pg-enhanced')) return;
    const summary = pgExtractSummary(card.href);
    card.classList.add('pg-enhanced');
    const svc = card.querySelector('span.user-card__service');

    if (summary) {
      const visits = document.createElement('span'); visits.className = 'pg-badge'; visits.textContent = `Visits: ${summary.visits || 0}`;
      if (svc) svc.insertAdjacentElement('afterend', visits);

      if (summary.previousVisit) {
        const days = Math.floor((new Date() - new Date(summary.previousVisit)) / (1000 * 60 * 60 * 24));
        const d = document.createElement('span'); d.className = 'pg-badge'; d.textContent = `Days: ${days}`; d.title = `Last visit: ${summary.previousVisit}`;
        visits.insertAdjacentElement('afterend', d);
      }

      if (summary.disliked) card.classList.add('pg-card-dislike');
    } else {
      card.classList.add('pg-card-new');
    }
  };

  if (root.tagName === 'A' && root.classList.contains('user-card')) {
    processCard(root);
  } else {
    root.querySelectorAll && root.querySelectorAll('a.user-card').forEach(processCard);
  }
}

function pgEnhancePostsList(root) {
  if (!/\/posts/.test(location.pathname)) return;

  const processCard = card => {
    if (!card || card.classList.contains('pg-enhanced')) return;
    const link = card.querySelector('a'); if (!link) return;
    const data = pgExtractSummary(link.href, true);
    card.classList.add('pg-enhanced');

    const footDiv = card.querySelector('footer > div');
    if (data && typeof data === 'object') {
      if (footDiv) footDiv.textContent = `${data.user || ''} (${data.visits || 0})`;
      if (data.disliked) card.classList.add('pg-card-dislike');
    } else if (typeof data === 'string') {
      if (footDiv) footDiv.textContent = data;
      card.classList.add('pg-card-new');
    }
  };

  if (root.tagName === 'ARTICLE' && root.classList.contains('post-card')) {
    processCard(root);
  } else {
    root.querySelectorAll && root.querySelectorAll('article.post-card').forEach(processCard);
  }
}

function pgOptimizeRoot(root) {
  pgEnhanceUserPages(root);
  pgEnhanceArtists(root);
  pgEnhancePostsList(root);
}

function hasGalleryItems(){
  return Array.isArray(galleryItems) && galleryItems.length > 0;
}

function enterGalleryFullscreenIfPossible() {
  const overlay = $('#pgGalleryOverlay');
  if (!overlay) return;
  if (document.fullscreenElement) return;
  if (overlay.requestFullscreen) {
    try { overlay.requestFullscreen(); } catch {}
  }
}

function exitGalleryFullscreenIfNeeded() {
  if (document.fullscreenElement && document.exitFullscreen) {
    try { document.exitFullscreen(); } catch {}
  }
}

function toggleGalleryFullscreen() {
  const overlay = $('#pgGalleryOverlay');
  if (!overlay) return;
  if (!document.fullscreenElement) {
    enterGalleryFullscreenIfPossible();
  } else {
    if (document.fullscreenElement === overlay) {
      exitGalleryFullscreenIfNeeded();
    }
  }
}

function handleFullscreenChangeForGallery() {
  if (!GALLERY_MODE) return;
}

function showGalleryUI() {
  const overlay = $('#pgGalleryOverlay');
  if (!overlay) return;
  overlay.classList.remove('pg-gallery-ui-hidden');
  uiHidden = false;
}

function hideGalleryUI() {
  const overlay = $('#pgGalleryOverlay');
  if (!overlay) return;
  overlay.classList.add('pg-gallery-ui-hidden');
  uiHidden = true;
}

function resetGalleryUIHideTimer() {
  showGalleryUI();
  if (uiHideTimer) {
    clearTimeout(uiHideTimer);
    uiHideTimer = null;
  }
  uiHideTimer = setTimeout(() => {
    hideGalleryUI();
  }, 2000);
}

function showGalleryStatusMessage(text) {
  const el = $('#pgGalleryStatus');
  if (!el) return;
  el.textContent = text || '';
  el.classList.add('visible');
  if (galleryStatusTimeout) {
    clearTimeout(galleryStatusTimeout);
    galleryStatusTimeout = null;
  }
  galleryStatusTimeout = setTimeout(() => {
    el.classList.remove('visible');
  }, 1200);
}

function handleGalleryMouseMove() {
  if (!GALLERY_MODE) return;
  resetGalleryUIHideTimer();
}

function ensureGalleryOverlay() {
  let overlay = $('#pgGalleryOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'pgGalleryOverlay';
  const inner = document.createElement('div');
  inner.id = 'pgGalleryInner';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'pg-gallery-close';
  closeBtn.textContent = 'X';
  closeBtn.addEventListener('click', closeGallery);
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'pg-gallery-nav pg-gallery-prev';
  prev.textContent = '‹';
  prev.addEventListener('click', showPrevGalleryItem);
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'pg-gallery-nav pg-gallery-next';
  next.textContent = '›';
  next.addEventListener('click', showNextGalleryItem);
  const viewport = document.createElement('div');
  viewport.id = 'pgGalleryViewport';
  const spinner = document.createElement('div');
  spinner.id = 'pgGallerySpinner';
  const filename = document.createElement('div');
  filename.id = 'pgGalleryFilename';
  const status = document.createElement('div');
  status.id = 'pgGalleryStatus';
  inner.appendChild(closeBtn);
  inner.appendChild(prev);
  inner.appendChild(viewport);
  inner.appendChild(next);
  inner.appendChild(spinner);
  inner.appendChild(filename);
  inner.appendChild(status);

  overlay.appendChild(inner);
  overlay.addEventListener('mousemove', handleGalleryMouseMove);
  document.body.appendChild(overlay);
  return overlay;
}

function showGallerySpinner(){
  const s = $('#pgGallerySpinner');
  if (s) s.style.display = 'block';
}

function hideGallerySpinner(){
  const s = $('#pgGallerySpinner');
  if (s) s.style.display = 'none';
}

function applyGalleryFiltersAndRandom() {
  if (!Array.isArray(baseGalleryItems) || !baseGalleryItems.length) {
    galleryItems = [];
    galleryIndex = 0;
    const viewport = $('#pgGalleryViewport');
    if (viewport) viewport.innerHTML = '';
    const fn = $('#pgGalleryFilename');
    if (fn) fn.textContent = '';
    return;
  }
  let arr = baseGalleryItems.slice();
  if (filterMode === 'images') {
    arr = arr.filter(it => !it.isVideo);
  } else if (filterMode === 'videos') {
    arr = arr.filter(it => it.isVideo);
  }
  if (randomMode) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }
  galleryItems = arr;
  if (!galleryItems.length) {
    galleryIndex = 0;
    const viewport = $('#pgGalleryViewport');
    if (viewport) viewport.innerHTML = '';
    const fn = $('#pgGalleryFilename');
    if (fn) fn.textContent = '';
    return;
  }
  if (galleryIndex < 0) galleryIndex = 0;
  if (galleryIndex >= galleryItems.length) galleryIndex = galleryItems.length - 1;
}

function renderGalleryItem(idx) {
  if (!hasGalleryItems()) return;
  const n = galleryItems.length;
  let i = idx;
  if (loopGallery) {
    i = idx % n;
    if (i < 0) i += n;
  } else {
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
  }
  galleryIndex = i;
  const viewport = $('#pgGalleryViewport');
  if (!viewport) return;
  const item = galleryItems[galleryIndex];
  const fn = $('#pgGalleryFilename');
  if (fn) fn.textContent = item && item.name ? item.name : '';
  if (!item || !item.url) return;

  const existing = viewport.firstElementChild || null;
  let existingType = null;
  if (existing) {
    if (existing.tagName === 'VIDEO') existingType = 'video';
    else if (existing.tagName === 'IMG') existingType = 'image';
  }

  const type = item.isVideo ? 'video' : 'image';

  let spinnerTimeout = null;
  const startSpinner = () => {
    spinnerTimeout = null;
    showGallerySpinner();
  };
  const clearSpinnerTimeout = () => {
    if (spinnerTimeout != null) {
      clearTimeout(spinnerTimeout);
      spinnerTimeout = null;
    }
  };
  const handleLoadError = () => {
    clearSpinnerTimeout();
    hideGallerySpinner();
    showGalleryStatusMessage('Failed to load media');
  };

  const delay = item.preloaded ? 150 : 100;
  spinnerTimeout = setTimeout(startSpinner, delay);

  if (type === 'video') {
    const v = document.createElement('video');
    v.src = item.url;
    v.controls = true;
    v.preload = 'metadata';
    v.playsInline = true;
    v.autoplay = true;
    v.muted = false;
    v.loop = !slideshowActive;

    const onLoaded = () => {
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('error', onError);
      clearSpinnerTimeout();
      hideGallerySpinner();
      cacheGalleryNode(item, v);
      viewport.innerHTML = '';
      viewport.appendChild(v);
      try { v.play(); } catch {}
    };
    const onError = () => {
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('error', onError);
      handleLoadError();
    };

    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('error', onError);
    if (slideshowActive) {
      v.addEventListener('ended', handleGallerySlideshowVideoEnded);
    }

    if (typeof v.readyState === 'number' && v.readyState >= 2) {
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('error', onError);
      clearSpinnerTimeout();
      hideGallerySpinner();
      cacheGalleryNode(item, v);
      viewport.innerHTML = '';
      viewport.appendChild(v);
      try { v.play(); } catch {}
      return;
    }

    viewport.innerHTML = '';
    viewport.appendChild(v);
    return;
  } else {
    let img = null;
    if (existingType === 'image') {
      img = existing;
    } else {
      viewport.innerHTML = '';
      img = document.createElement('img');
      viewport.appendChild(img);
    }
    img.onload = () => {
      img.onload = null;
      img.onerror = null;
      clearSpinnerTimeout();
      hideGallerySpinner();
      cacheGalleryNode(item, img);
    };
    img.onerror = () => {
      img.onload = null;
      img.onerror = null;
      handleLoadError();
    };
    img.loading = 'lazy';
    img.src = item.url;

    if (img.complete && img.naturalWidth > 0) {
      img.onload = null;
      img.onerror = null;
      clearSpinnerTimeout();
      hideGallerySpinner();
      cacheGalleryNode(item, img);
    }
    return;
  }
}

function jumpGalleryBy(delta){
  if (!hasGalleryItems()) return;
  renderGalleryItem(galleryIndex + delta);
}

function showPrevGalleryItem(){
  if (!hasGalleryItems()) return;
  renderGalleryItem(galleryIndex - 1);
}

function showNextGalleryItem(){
  if (!hasGalleryItems()) return;
  renderGalleryItem(galleryIndex + 1);
}

function getActiveGalleryVideo(){
  const viewport = $('#pgGalleryViewport');
  if (!viewport) return null;
  return viewport.querySelector('video') || null;
}

function seekGalleryVideo(deltaSeconds){
  const vid = getActiveGalleryVideo();
  if (!vid) return;
  try {
    let t = (vid.currentTime || 0) + deltaSeconds;
    if (t < 0) t = 0;
    if (!isNaN(vid.duration) && isFinite(vid.duration) && vid.duration >= 0) {
      if (t > vid.duration) t = vid.duration;
    }
    vid.currentTime = t;
  } catch {}
}

function toggleGalleryVideoPlayPause(){
  const vid = getActiveGalleryVideo();
  if (!vid) return;
  try {
    if (vid.paused) vid.play();
    else vid.pause();
  } catch {}
}

function handleGallerySlideshowVideoEnded() {
  if (!slideshowActive) return;
  showNextGalleryItem();
}

function startGallerySlideshow() {
  if (slideshowActive || !hasGalleryItems()) return;
  slideshowActive = true;
  if (slideshowTimer) {
    clearInterval(slideshowTimer);
    slideshowTimer = null;
  }
  slideshowTimer = setInterval(() => {
    if (!slideshowActive || !hasGalleryItems()) return;
    const item = galleryItems[galleryIndex];
    if (item && item.isVideo) {
      const vid = getActiveGalleryVideo();
      if (vid && !vid.paused) return;
    }
    showNextGalleryItem();
  }, 5000);
  renderGalleryItem(galleryIndex);
}

function stopGallerySlideshow() {
  slideshowActive = false;
  if (slideshowTimer) {
    clearInterval(slideshowTimer);
    slideshowTimer = null;
  }
  const vid = getActiveGalleryVideo();
  if (vid) {
    vid.loop = true;
  }
}

// Keybinds and functions
function handleGalleryKeydown(e){
  if (!GALLERY_MODE) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  e.stopPropagation();
  const key = e.key;

  if (key === 'g' || key === 'G') {
    e.preventDefault();
    toggleGalleryFullscreen();
    return;
  }

  if (key === 'ArrowRight' || key === 'd' || key === 'D' || key === 'l' || key === 'L') {
    e.preventDefault();
    showNextGalleryItem();
  } else if (key === 'ArrowLeft' || key === 'a' || key === 'A' || key === 'j' || key === 'J') {
    e.preventDefault();
    showPrevGalleryItem();
  } else if (key === '1' || key === '8') {
    e.preventDefault();
    jumpGalleryBy(-10);
  } else if (key === '3' || key === '0') {
    e.preventDefault();
    jumpGalleryBy(10);
  } else if (key === 'q' || key === 'Q' || key === 'u' || key === 'U') {
    e.preventDefault();
    seekGalleryVideo(-10);
  } else if (key === 'e' || key === 'E' || key === 'o' || key === 'O') {
    e.preventDefault();
    seekGalleryVideo(10);
  } else if (key === ' ' || key === 'Spacebar' || e.code === 'Space') {
    e.preventDefault();
    toggleGalleryVideoPlayPause();
  } else if (key === 'f' || key === 'F') {
    e.preventDefault();
    if (filterMode === 'all') {
      filterMode = 'images';
    } else if (filterMode === 'images') {
      filterMode = 'videos';
    } else {
      filterMode = 'all';
    }
    applyGalleryFiltersAndRandom();
    if (hasGalleryItems()) {
      renderGalleryItem(galleryIndex);
    } else {
      const viewport = $('#pgGalleryViewport');
      if (viewport) viewport.innerHTML = '';
      const fn = $('#pgGalleryFilename');
      if (fn) fn.textContent = '';
    }
    showGalleryStatusMessage(filterMode === 'all' ? 'Filter: All media' : (filterMode === 'images' ? 'Filter: Images only' : 'Filter: Videos only'));
  } else if (key === 'r' || key === 'R') {
    e.preventDefault();
    randomMode = !randomMode;
    applyGalleryFiltersAndRandom();
    if (hasGalleryItems()) {
      renderGalleryItem(galleryIndex);
    } else {
      const viewport = $('#pgGalleryViewport');
      if (viewport) viewport.innerHTML = '';
      const fn = $('#pgGalleryFilename');
      if (fn) fn.textContent = '';
    }
    showGalleryStatusMessage('Random order: ' + (randomMode ? 'ON' : 'OFF'));
  } else if (key === 'p' || key === 'P') {
    e.preventDefault();
    if (slideshowActive) {
      stopGallerySlideshow();
      showGalleryStatusMessage('Slideshow: OFF');
    } else {
      startGallerySlideshow();
      showGalleryStatusMessage('Slideshow: ON');
    }
  } else if (key === 't' || key === 'T') {
    e.preventDefault();
    loopGallery = !loopGallery;
    showGalleryStatusMessage('Looping: ' + (loopGallery ? 'ON' : 'OFF'));
  } else if (key === 'Backspace' || e.key === 'Escape' || key === '`' || key === '~' || e.code === 'Backquote') {
    e.preventDefault();
    closeGallery();
  }
}

function attachGalleryKeyHandler(){
  if (galleryKeyHandlerAttached) return;
  window.addEventListener('keydown', handleGalleryKeydown, true);
  galleryKeyHandlerAttached = true;
}

function detachGalleryKeyHandler(){
  if (!galleryKeyHandlerAttached) return;
  window.removeEventListener('keydown', handleGalleryKeydown, true);
  galleryKeyHandlerAttached = false;
}

function cacheGalleryNode(item, node) {
  if (!item || !node) return;
  item.node = node;
  item.loaded = true;
  const idx = galleryCacheOrder.indexOf(item);
  if (idx !== -1) galleryCacheOrder.splice(idx, 1);
  galleryCacheOrder.push(item);
  while (galleryCacheOrder.length > GALLERY_CACHE_LIMIT) {
    const evicted = galleryCacheOrder.shift();
    if (!evicted) continue;
    if (!evicted.node) {
      evicted.loaded = false;
      continue;
    }
    const viewport = $('#pgGalleryViewport');
    if (viewport && viewport.contains(evicted.node)) {
      galleryCacheOrder.push(evicted);
      break;
    }
    evicted.node = null;
    evicted.loaded = false;
  }
}

function preloadGalleryImages(){
  if (!hasGalleryItems()) return;
  galleryItems.forEach(item => {
    if (!item || item.isVideo || !item.url) return;
    if (item._preloaded) return;
    const img = new Image();
    img.onload = () => {
      item.preloaded = true;
      cacheGalleryNode(item, img);
    };
    img.onerror = () => {};
    img.src = item.url;
    item._preloaded = true;
  });
}

function preloadImageForGallery(item) {
  return new Promise(resolve => {
    if (!item || !item.url) {
      resolve(false);
      return;
    }
    const img = new Image();
    let settled = false;
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };
    const finish = ok => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) {
        cacheGalleryNode(item, img);
      }
      resolve(ok);
    };
    const onLoad = () => {
      finish(true);
    };
    const onError = () => {
      finish(false);
    };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = item.url;
  });
}

function preloadVideoForGallery(item) {
  return new Promise(resolve => {
    if (!item || !item.url) {
      resolve(false);
      return;
    }
    const v = document.createElement('video');
    let settled = false;
    let checkInterval = null;
    let timeoutId = null;
    const cleanup = () => {
      v.removeEventListener('loadedmetadata', onLoadedMetadata);
      v.removeEventListener('canplaythrough', onCanPlayThrough);
      v.removeEventListener('error', onError);
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    const finish = ok => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) {
        cacheGalleryNode(item, v);
      }
      resolve(ok);
    };
    const tryCheckBuffered = () => {
      try {
        if (!isFinite(v.duration) || v.duration <= 0) return;
        if (!v.buffered || v.buffered.length === 0) return;
        const end = v.buffered.end(v.buffered.length - 1);
        if (end >= v.duration - 0.25) {
          finish(true);
        }
      } catch {}
    };
    const onLoadedMetadata = () => {
      tryCheckBuffered();
    };
    const onCanPlayThrough = () => {
      finish(true);
    };
    const onError = () => {
      finish(false);
    };
    v.preload = 'auto';
    v.src = item.url;
    v.playsInline = true;
    v.controls = true;
    v.addEventListener('loadedmetadata', onLoadedMetadata);
    v.addEventListener('canplaythrough', onCanPlayThrough);
    v.addEventListener('error', onError);
    checkInterval = setInterval(tryCheckBuffered, 500);
    timeoutId = setTimeout(() => {
      finish(true);
    }, GALLERY_PRELOAD_VIDEO_TIMEOUT_MS);
  });
}

async function preloadGalleryMedia(items) {
  const readyItems = [];
  if (!items || !items.length) return readyItems;
  const total = items.length;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    setIndexStatus('Preloading gallery media ' + (i + 1) + ' / ' + total + '...', 'info');
    try {
      if (item.isVideo) {
        await preloadVideoForGallery(item);
      } else {
        await preloadImageForGallery(item);
      }
    } catch {
    }
    if (item.node && item.loaded) {
      readyItems.push(item);
    }
  }
  setIndexStatus('', 'info');
  return readyItems;
}

async function openGallery() {
  await handleFilter();
  const currentKey = computeGallerySessionKey();
  if (hasGalleryItems() && gallerySessionKey && currentKey && gallerySessionKey === currentKey) {
    const overlayExisting = ensureGalleryOverlay();
    overlayExisting.style.display = 'flex';
    GALLERY_MODE = true;
    attachGalleryKeyHandler();
    resetGalleryUIHideTimer();
    renderGalleryItem(galleryIndex);
    return;
  }
  galleryItems = [];
  baseGalleryItems = [];
  galleryIndex = 0;
  galleryCacheOrder = [];
  const viewport = $('#pgGalleryViewport');
  if (viewport) viewport.innerHTML = '';
  const fn = $('#pgGalleryFilename');
  if (fn) fn.textContent = '';
  if (!keptPosts || !keptPosts.length) {
    setStatus('No files available for gallery', 'error');
    return;
  }
  for (const kp of keptPosts) {
    const post = kp.post;
    const postGlobalIndex = kp.globalIndex;
    const allowedFiles = kp.allowedFiles || [];
    for (const f of allowedFiles) {
      if (!f || !f.url) continue;
      const u = f.url;
      const base = (u.split('?')[0] || '');
      const isVideo = vidRE.test(base);
      const fileIndex = typeof f.g === 'number' ? f.g : 0;
      const name = (base.split('/').pop() || '');
      baseGalleryItems.push({ url: u, isVideo, fileIndex, postGlobalIndex, post, name, node: null, loaded: false });
    }
  }
  if (!baseGalleryItems.length) {
    setStatus('No files available for gallery', 'error');
    return;
  }
  if (GALLERY_PRELOAD_ALL_MEDIA) {
    const readyItems = await preloadGalleryMedia(baseGalleryItems);
    if (!readyItems.length) {
      setStatus('No files available for gallery', 'error');
      return;
    }
    baseGalleryItems = readyItems;
    baseGalleryItems.sort((a,b) => {
      const ag = a.fileIndex || 0;
      const bg = b.fileIndex || 0;
      return ag - bg;
    });
  } else {
    baseGalleryItems.sort((a,b) => {
      const ag = a.fileIndex || 0;
      const bg = b.fileIndex || 0;
      return ag - bg;
    });
  }
  filterMode = 'all';
  randomMode = false;
  loopGallery = true;
  slideshowActive = false;
  applyGalleryFiltersAndRandom();
  if (!hasGalleryItems()) {
    setStatus('No files available for gallery', 'error');
    return;
  }
  gallerySessionKey = currentKey;
  if (!GALLERY_PRELOAD_ALL_MEDIA) setIndexStatus('Gallery opening. Loading on demand...', 'info');
  else setIndexStatus('Gallery ready. Opening...', 'success');
  const overlay = ensureGalleryOverlay();
  overlay.style.display = 'flex';
  GALLERY_MODE = true;
  attachGalleryKeyHandler();
  resetGalleryUIHideTimer();
  renderGalleryItem(0);
}

function closeGallery() {
  exitGalleryFullscreenIfNeeded();
  const overlay = $('#pgGalleryOverlay');
  if (overlay) overlay.style.display = 'none';
  const viewport = $('#pgGalleryViewport');
  if (viewport) {
    const v = viewport.querySelector('video');
    if (v && !v.paused) {
      try { v.pause(); } catch {}
    }
  }
  stopGallerySlideshow();
  if (uiHideTimer) {
    clearTimeout(uiHideTimer);
    uiHideTimer = null;
  }
  showGalleryUI();
  if (galleryStatusTimeout) {
    clearTimeout(galleryStatusTimeout);
    galleryStatusTimeout = null;
  }
  const st = $('#pgGalleryStatus');
  if (st) st.classList.remove('visible');
  GALLERY_MODE = false;
  detachGalleryKeyHandler();
}

async function handleGalleryToggle() {
  if (GALLERY_MODE) return;
  await openGallery();
}

function handleLocalGalleryBtn() {
  const url = 'https://any-one-but.github.io/Local_Gallery/';
  try {
    const w = window.open(url, '_blank', 'noopener');
    if (w) w.opener = null;
  } catch (e) {
  }
}

buildHUD();
injectPostNumbers();
injectFileNumbers();

const observer = new MutationObserver(debounce(injectPostNumbers, 100));
observer.observe(document.body, { childList: true, subtree: true });

const fileObserver = new MutationObserver(debounce(injectFileNumbers, 100));
fileObserver.observe(document.body, { childList: true, subtree: true });

const optimizerObserver = new MutationObserver(muts => {
  for (const m of muts) {
    if (m.type === 'childList' && m.addedNodes.length) {
      pgOptimizeRoot(m.addedNodes[0]);
    }
  }
});
optimizerObserver.observe(document.body, { childList: true, subtree: true });

pgOptimizeRoot(document.body);
window.addEventListener('resize', function(){
  syncFilterBoxWidth();
});
document.addEventListener('fullscreenchange', handleFullscreenChangeForGallery);
document.addEventListener('webkitfullscreenchange', handleFullscreenChangeForGallery);
document.addEventListener('mozfullscreenchange', handleFullscreenChangeForGallery);
document.addEventListener('MSFullscreenChange', handleFullscreenChangeForGallery);

const _pgOrigPushState = history.pushState;
const _pgOrigReplaceState = history.replaceState;
history.pushState = function(...args){
  const ret = _pgOrigPushState.apply(this, args);
  onUrlChange();
  return ret;
};
history.replaceState = function(...args){
  const ret = _pgOrigReplaceState.apply(this, args);
  onUrlChange();
  return ret;
};
window.addEventListener('popstate', onUrlChange);
