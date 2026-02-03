
// ==UserScript==
// @name         PartyGuest
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      01.12.00
// @description  A tool for downloading images and videos from Coomer/Kemono
// @author       normal person
// @updateURL    https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/PartyGuest.user.js
// @downloadURL  https://raw.githubusercontent.com/any-one-but/Local_Gallery/main/PartyGuest.user.js
// @match        *://coomer.st/*
// @match        *://kemono.cr/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @grant        GM_download
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==
// Gallery keybinds (right hand): ← / A = previous; → / D = next; 1 = -10 files; 3 = +10 files; Q = -10s; E = +10s; Space = play/pause; ` = close gallery.
// Gallery keybinds (left hand): ← / J = previous; → / L = next; 8 = -10 files; 0 = +10 files; U = -10s; O = +10s; Space = play/pause; Backspace = close gallery.
// Additional keybinds: G = toggle fullscreen; F = cycle filters (all/images/videos); R = toggle random order; P = toggle slideshow; T = toggle looping.

const JSZip = window.JSZip;

GM_addStyle(`
:root {
  --color0-primary: #ffffff;
  --color0-secondary: rgba(255, 255, 255, 0.72);
  --color0-tertirary: rgba(255, 255, 255, 0.4);

  --color1-primary: #000000;
  --color1-primary-transparent: rgba(0, 0, 0, 0.92);
  --color1-secondary: #000000;
  --color1-secondary-transparent: rgba(0, 0, 0, 0.6);
  --color1-tertiary: rgba(255, 255, 255, 0.2);

  --anchor-internal-color2-primary: hsl(240, 100%, 40%);

  --beige: var(--color0-primary);
  --black: var(--color1-primary);
  --desk: var(--color0-tertirary);
  --light: var(--color0-secondary);

  --rain-red: #ff3b30;
  --rain-orange: var(--color0-primary);
  --rain-yellow: var(--color0-primary);
  --rain-green: var(--color0-primary);
  --rain-blue: var(--anchor-internal-color2-primary);
  --rain-indigo: var(--anchor-internal-color2-primary);
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
  border-radius: 4px;
  border: 1px solid var(--color1-tertiary);
  font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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

#pgToastStack {
  position: absolute;
  left: 50%;
  bottom: 100%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  pointer-events: none;
  margin-bottom: 8px;
  z-index: 2;
}

.pg-toast {
  background: var(--color1-primary);
  color: var(--color0-primary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 3px;
  padding: 6px 10px;
  font-size: 11px;
  box-shadow: 0 8px 20px var(--color1-primary-transparent);
  max-width: min(520px, 86vw);
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
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
  background: var(--color1-primary);
  color: var(--color0-primary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  padding: 6px 8px;
  font-size: 12px;
  outline: none;
}

#hudRow input[type="text"],
#hudRow input[type="number"] {
  width: 130px;
  flex: 0 0 auto;
}

#partyHUD button {
  font-size: 12px;
  padding: 6px 10px;
  font-weight: 600;
  color: var(--color0-primary);
  background: var(--color1-primary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  cursor: pointer;
  text-shadow: none;
  box-shadow: none;
  transition: background .15s ease, border-color .15s ease, transform .05s ease;
  user-select: none;
  white-space: nowrap;
}

#partyHUD button:hover:not(:disabled) {
  background: var(--color1-secondary-transparent);
  border-color: var(--color0-secondary);
}

#partyHUD button:active:not(:disabled) {
  transform: translateY(1px);
}

#partyHUD .pg-icon-btn {
  width: 30px;
  padding: 6px;
  font-size: 14px;
}

/* Menu overlay */

html.pg-menu-open,
body.pg-menu-open {
  overflow: hidden !important;
  overscroll-behavior: contain;
}

#pgMenuOverlay {
  position: fixed;
  inset: 0;
  display: none;
  pointer-events: none;
  background: transparent;
  z-index: 10001;
}

#pgMenuOverlay.active {
  display: block;
}

#pgMenuCard {
  position: fixed;
  pointer-events: auto;
  resize: both;
  overflow: hidden;
  width: min(860px, 96vw);
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  min-width: 320px;
  min-height: 240px;
  left: 50%;
  top: 50%;
  transform: none;
  background: var(--color1-secondary);
  color: var(--color0-primary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, .85);
}

#pgMenuCard.pg-overlay-dragging {
  cursor: grabbing;
}

#pgMenuHeader {
  padding: 10px 10px 0;
  border-bottom: 1px solid var(--color1-tertiary);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  flex-wrap: wrap;
  cursor: grab;
  user-select: none;
}

#pgMenuHeader .title {
  font-size: 12px;
  font-weight: 800;
  color: var(--color0-primary);
  letter-spacing: .02em;
  order: 1;
}

#pgMenuTabs {
  display: flex;
  gap: 2px;
  align-items: center;
  flex-wrap: wrap;
  width: 100%;
  order: 3;
}

#pgMenuTabs .pgMenuTabBtn {
  white-space: nowrap;
  border-radius: 4px 4px 0 0;
  border-bottom-color: var(--color1-tertiary);
  background: rgba(255, 255, 255, 0.06);
  padding: 4px 10px;
  font-size: 12px;
  color: var(--color0-secondary);
}

#pgMenuTabs .pgMenuTabBtn.active {
  background: var(--color1-secondary);
  border-bottom-color: var(--color1-secondary);
  position: relative;
  top: 1px;
  color: var(--color0-primary);
}

#pgMenuCloseBtn {
  margin-left: auto;
  align-self: flex-start;
  order: 2;
}

#pgMenuBody {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.pgMenuTabPanel {
  display: none;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  width: 100%;
}

.pgMenuTabPanel.active {
  display: flex;
}

#pgMenuOptionsBody,
#pgMenuKeybindsBody,
#pgMenuErrorBody {
  padding: 10px 10px 12px;
  overflow: auto;
  min-height: 0;
  flex: 1 1 auto;
  font-size: 12px;
  color: var(--color0-primary);
}

#pgMenuCard button {
  font-size: 12px;
  padding: 4px 10px;
  font-weight: 600;
  color: var(--color0-primary);
  background: var(--color1-primary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  text-shadow: none;
  box-shadow: none;
  transition: background .15s ease, border-color .15s ease, transform .05s ease;
}

#pgMenuCard button:hover:not(:disabled) {
  background: var(--color1-secondary-transparent);
  border-color: var(--color0-secondary);
}

#pgMenuCard button:active:not(:disabled) {
  transform: translateY(1px);
}

#pgMenuBody .pg-options-note {
  color: var(--color0-secondary);
  font-size: 11px;
  margin-bottom: 10px;
}

#pgMenuBody .pg-opt-section {
  margin-bottom: 12px;
}

#pgMenuBody .pg-opt-section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--color0-secondary);
  margin: 6px 0 4px;
}

#pgMenuBody .pg-opt-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--color1-tertiary);
}

#pgMenuBody .pg-opt-section .pg-opt-row:last-child {
  border-bottom: none;
}

#pgMenuBody .pg-opt-left {
  min-width: 0;
}

#pgMenuBody .pg-opt-title {
  font-weight: 600;
  font-size: 12px;
}

#pgMenuBody .pg-opt-hint {
  font-size: 11px;
  color: var(--color0-secondary);
  margin-top: 2px;
}

#pgMenuBody .pg-opt-right {
  flex: 0 0 auto;
  justify-self: end;
}

#pgMenuBody input[type="checkbox"],
#pgMenuBody input[type="number"] {
  background: var(--color1-primary);
  color: var(--color0-primary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  padding: 4px 6px;
  font-size: 12px;
  accent-color: var(--color0-primary);
  outline: none;
}

#pgMenuBody input[type="number"] {
  width: 72px;
  text-align: right;
}

#pgMenuFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border-top: 1px solid var(--color1-tertiary);
  background: var(--color1-primary);
}

#pgMenuFooter .label {
  font-size: 11px;
  color: var(--color0-secondary);
}

.pg-keybinds-section {
  margin-bottom: 12px;
}

.pg-keybinds-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--color0-secondary);
}

.pg-keybinds-list {
  margin: 6px 0 0 16px;
}

.pg-keybinds-list li {
  margin: 2px 0;
}

.pg-error-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pg-error-item {
  border: 1px solid var(--color1-tertiary);
  border-radius: 3px;
  padding: 6px 8px;
  background: var(--color1-primary);
}

.pg-error-link {
  color: var(--anchor-internal-color2-primary);
  text-decoration: none;
  word-break: break-all;
}

.pg-error-meta {
  color: var(--color0-secondary);
  font-size: 11px;
  margin-top: 4px;
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
  background: var(--color1-primary) !important;
  color: var(--color0-primary);
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
const PG_OPTIONS_KEY = 'pg_options';
const DEFAULT_OPTIONS = {
  durationIndexing: false,
  galleryPreloadAll: false,
  parallelDownloadLimit: 3,
  timeoutRetries: true,
  stopClearsQueue: true,
  showLocalGalleryBtn: false,
  showGalleryBtn: true,
  showPageBtn: true,
  showMediaBtn: true,
  showPreviewBtn: false,
  showPageInput: true,
  showPostInput: true,
  showFileInput: false,
  showProgressBar: false
};
function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function normalizeOptions(opt) {
  const out = Object.assign({}, DEFAULT_OPTIONS);
  if (!opt || typeof opt !== 'object') return out;
  if (typeof opt.durationIndexing === 'boolean') out.durationIndexing = opt.durationIndexing;
  if (typeof opt.galleryPreloadAll === 'boolean') out.galleryPreloadAll = opt.galleryPreloadAll;
  if (opt.parallelDownloadLimit != null) {
    out.parallelDownloadLimit = clampInt(opt.parallelDownloadLimit, 1, 10, DEFAULT_OPTIONS.parallelDownloadLimit);
  }
  if (typeof opt.timeoutRetries === 'boolean') out.timeoutRetries = opt.timeoutRetries;
  if (typeof opt.stopClearsQueue === 'boolean') out.stopClearsQueue = opt.stopClearsQueue;
  if (typeof opt.showLocalGalleryBtn === 'boolean') out.showLocalGalleryBtn = opt.showLocalGalleryBtn;
  if (typeof opt.showGalleryBtn === 'boolean') out.showGalleryBtn = opt.showGalleryBtn;
  if (typeof opt.showPageBtn === 'boolean') out.showPageBtn = opt.showPageBtn;
  if (typeof opt.showMediaBtn === 'boolean') out.showMediaBtn = opt.showMediaBtn;
  if (typeof opt.showPreviewBtn === 'boolean') out.showPreviewBtn = opt.showPreviewBtn;
  if (typeof opt.showPageInput === 'boolean') out.showPageInput = opt.showPageInput;
  if (typeof opt.showPostInput === 'boolean') out.showPostInput = opt.showPostInput;
  if (typeof opt.showFileInput === 'boolean') out.showFileInput = opt.showFileInput;
  if (typeof opt.showProgressBar === 'boolean') out.showProgressBar = opt.showProgressBar;
  return out;
}
function loadOptions() {
  let parsed = null;
  try { parsed = JSON.parse(localStorage.getItem(PG_OPTIONS_KEY) || 'null'); } catch {}
  return normalizeOptions(parsed);
}
function saveOptions() {
  try { localStorage.setItem(PG_OPTIONS_KEY, JSON.stringify(PG_OPTIONS)); } catch {}
}
let PG_OPTIONS = loadOptions();
let GALLERY_PRELOAD_ALL_MEDIA = false;
let DURATION_FEATURE_ENABLED = false;
let PARALLEL_DOWNLOAD_LIMIT = 3;
let TIMEOUT_RETRIES_ENABLED = true;
let STOP_BUTTON_CLEARS_QUEUE = true;
let SHOW_PROGRESS_BAR = true;
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
let MENU_OPEN = false;
let MENU_ACTIVE_TAB = 'options';
let MENU_LAST_TAB = 'options';
let MENU_HAS_OPENED = false;
const MENU_TAB_SCROLL = { options: 0, keybinds: 0, errors: 0 };
const MENU_TAB_IDS = ['options', 'keybinds', 'errors'];
const MENU_WINDOW_STATE = { x: null, y: null, width: null, height: null };
let MENU_TAB_BUTTONS = [];
let MENU_TAB_PANELS = {};
let MENU_SCROLL_TARGETS = {};
let MENU_RESIZE_OBSERVER = null;
const ERROR_LOG = [];
const KEYBINDS_SECTIONS = [
  {
    title: 'Gallery keybinds (right hand)',
    items: [
      '← / A = previous',
      '→ / D = next',
      '1 = -10 files',
      '3 = +10 files',
      'Q = -10s',
      'E = +10s',
      'Space = play/pause',
      '` = close gallery'
    ]
  },
  {
    title: 'Gallery keybinds (left hand)',
    items: [
      '← / J = previous',
      '→ / L = next',
      '8 = -10 files',
      '0 = +10 files',
      'U = -10s',
      'O = +10s',
      'Space = play/pause',
      'Backspace = close gallery'
    ]
  },
  {
    title: 'Additional keybinds',
    items: [
      'G = toggle fullscreen',
      'F = cycle filters (all/images/videos)',
      'R = toggle random order',
      'P = toggle slideshow',
      'T = toggle looping'
    ]
  }
];

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

function getDownloadLabel(item) {
  if (!item) return 'file';
  if (item.name) return item.name;
  if (item.url) return item.url.split('/').pop() || item.url;
  return 'file';
}

function formatDownloadErrorReason(reason, err) {
  let detail = '';
  if (err) {
    if (typeof err === 'string') detail = err;
    else if (err.error) detail = err.error;
    else if (err.message) detail = err.message;
  }
  const base = reason || 'Download failed';
  if (detail && detail !== base) return `${base}: ${detail}`;
  return base;
}

function showErrorToast(text) {
  const host = document.getElementById('pgToastStack');
  if (!host) return;
  const toast = document.createElement('div');
  toast.className = 'pg-toast';
  toast.textContent = text;
  host.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}

function renderErrorLogUi() {
  const body = document.getElementById('pgMenuErrorBody');
  if (!body) return;
  const prevScroll = body.scrollTop || 0;
  body.innerHTML = '';
  if (!ERROR_LOG.length) {
    const empty = document.createElement('div');
    empty.className = 'pg-options-note';
    empty.textContent = 'No errors yet.';
    body.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'pg-error-log';
  for (let i = ERROR_LOG.length - 1; i >= 0; i--) {
    const entry = ERROR_LOG[i];
    const item = document.createElement('div');
    item.className = 'pg-error-item';

    const link = document.createElement('a');
    link.className = 'pg-error-link';
    link.href = entry.url || '#';
    link.textContent = entry.label || entry.url || 'Unknown file';
    link.target = '_blank';
    link.rel = 'noopener';
    item.appendChild(link);

    const meta = document.createElement('div');
    meta.className = 'pg-error-meta';
    const when = new Date(entry.ts || Date.now()).toLocaleTimeString();
    meta.textContent = `${when} • ${entry.reason || 'Download failed'}`;
    item.appendChild(meta);

    list.appendChild(item);
  }
  body.appendChild(list);
  requestAnimationFrame(() => {
    body.scrollTop = prevScroll;
  });
}

function logDownloadError(item, reason, err) {
  const label = getDownloadLabel(item);
  const message = formatDownloadErrorReason(reason, err);
  ERROR_LOG.push({
    ts: Date.now(),
    url: item && item.url ? item.url : '',
    label,
    reason: message
  });
  renderErrorLogUi();
  showErrorToast(`${label} — ${message}`);
}

function setStatus(text, type) {
  const el = $('#filterStatus');
  if (!el) return;
  el.textContent = text || '';
  if (type === 'error') el.style.color = 'var(--rain-red)';
  else if (type === 'success') el.style.color = 'var(--anchor-internal-color2-primary)';
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
  if (type === 'error') el.style.color = 'var(--rain-red)';
  else if (type === 'success') el.style.color = 'var(--anchor-internal-color2-primary)';
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
  const row = document.getElementById('hudRow');
  if (!bar || !row) return;
  const items = [...row.children].filter(el => el.offsetParent !== null);
  const anchor = items.length ? items[items.length - 1] : null;
  if (!anchor) return;
  const b = bar.getBoundingClientRect();
  const p = anchor.getBoundingClientRect();
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
  const bar = document.getElementById('pgWrap');
  if (bar) bar.style.display = SHOW_PROGRESS_BAR ? '' : 'none';
}

function setHudItemVisible(id, visible) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = visible ? '' : 'none';
}

function syncHudElementVisibility() {
  const opt = PG_OPTIONS || DEFAULT_OPTIONS;
  setHudItemVisible('localGalleryBtn', opt.showLocalGalleryBtn !== false);
  setHudItemVisible('galleryBtn', opt.showGalleryBtn !== false);
  setHudItemVisible('btnPageAll', opt.showPageBtn !== false);
  setHudItemVisible('btnMedia', opt.showMediaBtn !== false);
  setHudItemVisible('filterBtn', opt.showPreviewBtn !== false);
  setHudItemVisible('fPages', opt.showPageInput !== false);
  setHudItemVisible('fPosts', opt.showPostInput !== false);
  setHudItemVisible('fFiles', opt.showFileInput !== false);
  requestAnimationFrame(syncFilterBoxWidth);
}

function syncDurationInputVisibility() {
  const durInput = document.getElementById('fDur');
  if (!durInput) return;
  durInput.style.display = DURATION_FEATURE_ENABLED ? '' : 'none';
  durInput.disabled = !DURATION_FEATURE_ENABLED;
}

function applyOptions() {
  const opt = PG_OPTIONS || DEFAULT_OPTIONS;
  const prevDuration = DURATION_FEATURE_ENABLED;
  DURATION_FEATURE_ENABLED = !!opt.durationIndexing;
  GALLERY_PRELOAD_ALL_MEDIA = !!opt.galleryPreloadAll;
  PARALLEL_DOWNLOAD_LIMIT = clampInt(opt.parallelDownloadLimit, 1, 10, DEFAULT_OPTIONS.parallelDownloadLimit);
  TIMEOUT_RETRIES_ENABLED = opt.timeoutRetries !== false;
  STOP_BUTTON_CLEARS_QUEUE = opt.stopClearsQueue !== false;
  SHOW_PROGRESS_BAR = opt.showProgressBar !== false;

  syncHudElementVisibility();
  syncDurationInputVisibility();
  syncProgressBarVisibility();

  if (prevDuration !== DURATION_FEATURE_ENABLED && DURATION_FEATURE_ENABLED) {
    if (PG_POSTS && PG_POSTS.length) {
      ensureVideoDurations().then(() => scheduleFilter());
    }
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

function setOptionsStatus(text) {
  const el = document.getElementById('pgOptionsStatusLabel');
  if (!el) return;
  el.textContent = text || '-';
}

function resetOptionsToDefaults() {
  PG_OPTIONS = normalizeOptions(null);
  saveOptions();
  applyOptions();
  renderOptionsUi();
  setOptionsStatus('Reset');
}

function renderOptionsUi() {
  const body = document.getElementById('pgMenuOptionsBody');
  if (!body) return;
  const opt = PG_OPTIONS || DEFAULT_OPTIONS;

  const makeCheckRow = (title, hint, id, checked) => {
    return `
      <div class="pg-opt-row">
        <div class="pg-opt-left">
          <div class="pg-opt-title">${title}</div>
          <div class="pg-opt-hint">${hint}</div>
        </div>
        <div class="pg-opt-right">
          <input id="${id}" type="checkbox"${checked ? ' checked' : ''}>
        </div>
      </div>
    `;
  };

  const makeNumberRow = (title, hint, id, value, min, max) => {
    return `
      <div class="pg-opt-row">
        <div class="pg-opt-left">
          <div class="pg-opt-title">${title}</div>
          <div class="pg-opt-hint">${hint}</div>
        </div>
        <div class="pg-opt-right">
          <input id="${id}" type="number" min="${min}" max="${max}" step="1" value="${value}">
        </div>
      </div>
    `;
  };

  body.innerHTML = `
    <div class="pg-options-note">Options are saved locally in your browser for this site.</div>

    <div class="pg-opt-section">
      <div class="pg-opt-section-title">Downloads</div>
      ${makeCheckRow('Video duration indexing', 'Enable duration filters and video duration indexing.', 'pg_opt_durationIndexing', !!opt.durationIndexing)}
      ${makeCheckRow('Gallery preloading', 'Preload filtered media before opening the gallery.', 'pg_opt_galleryPreloadAll', !!opt.galleryPreloadAll)}
      ${makeNumberRow('Parallel download limit', 'Maximum simultaneous downloads.', 'pg_opt_parallelDownloadLimit', opt.parallelDownloadLimit, 1, 10)}
      ${makeCheckRow('Retry on stall/timeout', 'When a download stalls or takes too long, abort and retry (default on).', 'pg_opt_timeoutRetries', opt.timeoutRetries !== false)}
      ${makeCheckRow('Stop button clears queue', 'When stopping downloads, clear the queue (default on).', 'pg_opt_stopClearsQueue', opt.stopClearsQueue !== false)}
    </div>

    <div class="pg-opt-section">
      <div class="pg-opt-section-title">HUD</div>
      ${makeCheckRow('Show Local Gallery button', 'Toggle the Local Gallery launcher.', 'pg_opt_showLocalGalleryBtn', opt.showLocalGalleryBtn !== false)}
      ${makeCheckRow('Show Gallery button', 'Toggle the Gallery button.', 'pg_opt_showGalleryBtn', opt.showGalleryBtn !== false)}
      ${makeCheckRow('Show Page button', 'Toggle the Page button.', 'pg_opt_showPageBtn', opt.showPageBtn !== false)}
      ${makeCheckRow('Show media filter button', 'Toggle the media type cycle button.', 'pg_opt_showMediaBtn', opt.showMediaBtn !== false)}
      ${makeCheckRow('Show Preview button', 'Toggle the Preview button.', 'pg_opt_showPreviewBtn', opt.showPreviewBtn !== false)}
      ${makeCheckRow('Show Page input', 'Toggle the Page selector input.', 'pg_opt_showPageInput', opt.showPageInput !== false)}
      ${makeCheckRow('Show Post input', 'Toggle the Post selector input.', 'pg_opt_showPostInput', opt.showPostInput !== false)}
      ${makeCheckRow('Show File input', 'Toggle the File selector input.', 'pg_opt_showFileInput', opt.showFileInput !== false)}
    </div>

    <div class="pg-opt-section">
      <div class="pg-opt-section-title">Progress</div>
      ${makeCheckRow('Show progress bar', 'Toggle the download progress bar graphic.', 'pg_opt_showProgressBar', opt.showProgressBar !== false)}
    </div>
  `;

  const bindCheck = (id, key, onChange) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      PG_OPTIONS[key] = !!el.checked;
      saveOptions();
      setOptionsStatus('Saved');
      applyOptions();
      if (typeof onChange === 'function') onChange(!!el.checked);
    });
  };

  const bindNumber = (id, key, min, max, onChange) => {
    const el = document.getElementById(id);
    if (!el) return;
    const applyValue = () => {
      const next = clampInt(el.value, min, max, DEFAULT_OPTIONS.parallelDownloadLimit);
      el.value = String(next);
      PG_OPTIONS[key] = next;
      saveOptions();
      setOptionsStatus('Saved');
      applyOptions();
      if (typeof onChange === 'function') onChange(next);
    };
    el.addEventListener('change', applyValue);
    el.addEventListener('blur', applyValue);
  };

  bindCheck('pg_opt_durationIndexing', 'durationIndexing');
  bindCheck('pg_opt_galleryPreloadAll', 'galleryPreloadAll');
  bindNumber('pg_opt_parallelDownloadLimit', 'parallelDownloadLimit', 1, 10, () => {
    if (dl.started) requestDispatch();
  });
  bindCheck('pg_opt_timeoutRetries', 'timeoutRetries');
  bindCheck('pg_opt_stopClearsQueue', 'stopClearsQueue');
  bindCheck('pg_opt_showLocalGalleryBtn', 'showLocalGalleryBtn');
  bindCheck('pg_opt_showGalleryBtn', 'showGalleryBtn');
  bindCheck('pg_opt_showPageBtn', 'showPageBtn');
  bindCheck('pg_opt_showMediaBtn', 'showMediaBtn');
  bindCheck('pg_opt_showPreviewBtn', 'showPreviewBtn');
  bindCheck('pg_opt_showPageInput', 'showPageInput');
  bindCheck('pg_opt_showPostInput', 'showPostInput');
  bindCheck('pg_opt_showFileInput', 'showFileInput');
  bindCheck('pg_opt_showProgressBar', 'showProgressBar');
}

function renderKeybindsUi() {
  const body = document.getElementById('pgMenuKeybindsBody');
  if (!body) return;
  const sections = KEYBINDS_SECTIONS.map(section => {
    const items = section.items.map(item => `<li>${item}</li>`).join('');
    return `
      <div class="pg-keybinds-section">
        <div class="pg-keybinds-title">${section.title}</div>
        <ul class="pg-keybinds-list">${items}</ul>
      </div>
    `;
  }).join('');
  body.innerHTML = sections || '<div class="pg-options-note">No keybinds available.</div>';
}

function saveMenuTabScroll(tab) {
  const target = MENU_SCROLL_TARGETS[tab];
  if (!target) return;
  MENU_TAB_SCROLL[tab] = target.scrollTop || 0;
}

function restoreMenuTabScroll(tab) {
  const target = MENU_SCROLL_TARGETS[tab];
  if (!target) return;
  const top = MENU_TAB_SCROLL[tab] || 0;
  requestAnimationFrame(() => {
    target.scrollTop = top;
  });
}

function ensureOptionsUi() {
  renderOptionsUi();
  setOptionsStatus('Saved automatically');
  restoreMenuTabScroll('options');
}

function ensureKeybindsUi() {
  renderKeybindsUi();
  restoreMenuTabScroll('keybinds');
}

function ensureErrorLogUi() {
  renderErrorLogUi();
  restoreMenuTabScroll('errors');
}

function setMenuTab(tabId) {
  const next = MENU_TAB_IDS.includes(tabId) ? tabId : 'options';
  if (MENU_ACTIVE_TAB) saveMenuTabScroll(MENU_ACTIVE_TAB);
  MENU_ACTIVE_TAB = next;
  MENU_LAST_TAB = next;

  MENU_TAB_BUTTONS.forEach(btn => {
    const active = btn.dataset.tab === next;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.setAttribute('tabindex', active ? '0' : '-1');
  });

  Object.entries(MENU_TAB_PANELS).forEach(([id, panel]) => {
    if (!panel) return;
    const active = id === next;
    panel.classList.toggle('active', active);
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });

  if (next === 'keybinds') {
    ensureKeybindsUi();
    return;
  }
  if (next === 'errors') {
    ensureErrorLogUi();
    return;
  }
  ensureOptionsUi();
}

function clampMenuWindowPosition(desiredX, desiredY) {
  const card = document.getElementById('pgMenuCard');
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const width = rect.width || MENU_WINDOW_STATE.width || card.offsetWidth || 0;
  const height = rect.height || MENU_WINDOW_STATE.height || card.offsetHeight || 0;
  if (!width || !height) return;
  const maxX = Math.max(8, window.innerWidth - width - 8);
  const maxY = Math.max(8, window.innerHeight - height - 8);
  let x = (typeof desiredX === 'number') ? desiredX : (typeof MENU_WINDOW_STATE.x === 'number' ? MENU_WINDOW_STATE.x : (window.innerWidth - width) / 2);
  let y = (typeof desiredY === 'number') ? desiredY : (typeof MENU_WINDOW_STATE.y === 'number' ? MENU_WINDOW_STATE.y : (window.innerHeight - height) / 2);
  x = Math.min(maxX, Math.max(8, x));
  y = Math.min(maxY, Math.max(8, y));
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  MENU_WINDOW_STATE.x = x;
  MENU_WINDOW_STATE.y = y;
  MENU_WINDOW_STATE.width = width;
  MENU_WINDOW_STATE.height = height;
}

function applyMenuWindowState() {
  const card = document.getElementById('pgMenuCard');
  if (!card) return;
  if (MENU_WINDOW_STATE.width) card.style.width = `${MENU_WINDOW_STATE.width}px`;
  else card.style.removeProperty('width');
  if (MENU_WINDOW_STATE.height) card.style.height = `${MENU_WINDOW_STATE.height}px`;
  else card.style.removeProperty('height');
  clampMenuWindowPosition();
}

function registerMenuWindow(card, header) {
  if (!card || card.dataset.pgWindowReady) return;
  card.dataset.pgWindowReady = '1';

  if (!MENU_RESIZE_OBSERVER && 'ResizeObserver' in window) {
    MENU_RESIZE_OBSERVER = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        const width = rect.width || MENU_WINDOW_STATE.width || card.offsetWidth || 0;
        const height = rect.height || MENU_WINDOW_STATE.height || card.offsetHeight || 0;
        if (!width || !height) continue;
        MENU_WINDOW_STATE.width = width;
        MENU_WINDOW_STATE.height = height;
        clampMenuWindowPosition(MENU_WINDOW_STATE.x, MENU_WINDOW_STATE.y);
      }
    });
  }
  if (MENU_RESIZE_OBSERVER) MENU_RESIZE_OBSERVER.observe(card);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let activePointerId = null;

  const onPointerMove = (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    const rect = card.getBoundingClientRect();
    const nextX = rect.left + (ev.clientX - lastX);
    const nextY = rect.top + (ev.clientY - lastY);
    lastX = ev.clientX;
    lastY = ev.clientY;
    clampMenuWindowPosition(nextX, nextY);
  };

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (header && activePointerId !== null) {
      try { header.releasePointerCapture(activePointerId); } catch {}
    }
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', stopDrag);
    document.removeEventListener('pointercancel', stopDrag);
    card.classList.remove('pg-overlay-dragging');
    activePointerId = null;
  };

  if (header) {
    header.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      if (ev.target && ev.target.closest && ev.target.closest('button')) return;
      ev.preventDefault();
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      activePointerId = ev.pointerId;
      try { header.setPointerCapture(activePointerId); } catch {}
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', stopDrag);
      document.addEventListener('pointercancel', stopDrag);
      card.classList.add('pg-overlay-dragging');
    });
  }
}

function initMenuTabs() {
  const tabs = document.getElementById('pgMenuTabs');
  MENU_TAB_BUTTONS = tabs ? [...tabs.querySelectorAll('.pgMenuTabBtn')] : [];
  MENU_TAB_PANELS = {
    options: document.getElementById('pgMenuTabOptions'),
    keybinds: document.getElementById('pgMenuTabKeybinds'),
    errors: document.getElementById('pgMenuTabErrors')
  };
  MENU_SCROLL_TARGETS = {
    options: document.getElementById('pgMenuOptionsBody'),
    keybinds: document.getElementById('pgMenuKeybindsBody'),
    errors: document.getElementById('pgMenuErrorBody')
  };
  MENU_TAB_BUTTONS.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab || 'options';
      setMenuTab(tab);
    });
  });
}

function buildMenu() {
  if (document.getElementById('pgMenuOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'pgMenuOverlay';
  overlay.innerHTML = `
    <div id="pgMenuCard" role="dialog" aria-modal="true" aria-label="Menu">
      <div id="pgMenuHeader">
        <div class="title">Menu</div>
        <div id="pgMenuTabs" role="tablist" aria-label="Menu tabs">
          <button type="button" class="pgMenuTabBtn" data-tab="options" role="tab" aria-controls="pgMenuTabOptions">Options</button>
          <button type="button" class="pgMenuTabBtn" data-tab="keybinds" role="tab" aria-controls="pgMenuTabKeybinds">Keybinds</button>
          <button type="button" class="pgMenuTabBtn" data-tab="errors" role="tab" aria-controls="pgMenuTabErrors">Error Log</button>
        </div>
        <button id="pgMenuCloseBtn" type="button">X</button>
      </div>
      <div id="pgMenuBody">
        <section id="pgMenuTabOptions" class="pgMenuTabPanel" data-tab="options" role="tabpanel">
          <div id="pgMenuOptionsBody"></div>
          <div id="pgMenuFooter">
            <div class="left"><span class="label" id="pgOptionsStatusLabel">-</span></div>
            <div class="right">
              <button id="pgOptionsResetBtn" type="button">Reset defaults</button>
              <button id="pgOptionsDoneBtn" type="button">Done</button>
            </div>
          </div>
        </section>
        <section id="pgMenuTabKeybinds" class="pgMenuTabPanel" data-tab="keybinds" role="tabpanel">
          <div id="pgMenuKeybindsBody"></div>
        </section>
        <section id="pgMenuTabErrors" class="pgMenuTabPanel" data-tab="errors" role="tabpanel">
          <div id="pgMenuErrorBody"></div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeBtn = document.getElementById('pgMenuCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => closeMenu());

  const doneBtn = document.getElementById('pgOptionsDoneBtn');
  if (doneBtn) doneBtn.addEventListener('click', () => closeMenu());

  const resetBtn = document.getElementById('pgOptionsResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => resetOptionsToDefaults());

  const menuCard = document.getElementById('pgMenuCard');
  const menuHeader = document.getElementById('pgMenuHeader');
  registerMenuWindow(menuCard, menuHeader);
  initMenuTabs();

  document.addEventListener('keydown', (e) => {
    if (!MENU_OPEN) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  });
}

function openMenu(tabId) {
  buildMenu();
  const overlay = document.getElementById('pgMenuOverlay');
  if (!overlay) return;
  MENU_OPEN = true;
  overlay.classList.add('active');
  document.documentElement.classList.add('pg-menu-open');
  document.body.classList.add('pg-menu-open');
  requestAnimationFrame(() => applyMenuWindowState());
  const next = MENU_TAB_IDS.includes(tabId)
    ? tabId
    : (MENU_HAS_OPENED ? MENU_LAST_TAB : 'options');
  MENU_HAS_OPENED = true;
  setMenuTab(next);
}

function closeMenu() {
  if (MENU_ACTIVE_TAB) saveMenuTabScroll(MENU_ACTIVE_TAB);
  const overlay = document.getElementById('pgMenuOverlay');
  if (overlay) overlay.classList.remove('active');
  document.documentElement.classList.remove('pg-menu-open');
  document.body.classList.remove('pg-menu-open');
  MENU_OPEN = false;
}

window.addEventListener('resize', () => applyMenuWindowState());

function buildHUD() {
  if ($('#partyHUD')) {
    applyOptions();
    return;
  }

  const w = document.createElement('div');
  w.id = 'partyHUD';
  w.innerHTML = `
    <div id="pgToastStack" aria-live="polite"></div>
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
      <button id="pgMenuBtn" class="full pg-icon-btn" title="Menu" aria-label="Menu">⚙</button>
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

  const menuBtn = $('#pgMenuBtn');
  if (menuBtn) menuBtn.onclick = openMenu;

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
  if (durInput) durInput.addEventListener('input', scheduleFilter);

  const hudRow = document.getElementById('hudRow');
  if (hudRow && 'ResizeObserver' in window) {
    new ResizeObserver(() => { syncFilterBoxWidth(); }).observe(hudRow);
  }
  requestAnimationFrame(syncFilterBoxWidth);
  requestAnimationFrame(syncFilterBoxVisibility);
  requestAnimationFrame(syncProgressBarVisibility);
  requestAnimationFrame(lockMediaButtonWidth);
  requestAnimationFrame(lockPreviewButtonWidth);
  applyOptions();

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

function parLimit() { return PARALLEL_DOWNLOAD_LIMIT; }

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
    const totalItems = total || 0;
    dlSummaryEl.textContent = `${totalItems} posts total • ${queued} Queued • ${downloading} Downloading • ${completed} Completed • ${retries} Retries`;
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

function getRetryKey(item) {
  if (!item) return '';
  return item.retryKey || item.url || item.name || '';
}

function enqueueItems(objs) {
  const toAdd = [];
  for (const obj of objs) {
    const url = obj.url;
    const name = obj.name;
    const meta = obj.meta || null;
    const files = Array.isArray(obj.files) ? obj.files : null;
    const userFolder = obj.userFolder || '';
    const postFolder = obj.postFolder || '';
    const retryKey = obj.retryKey || '';
    toAdd.push({ url, name, meta, status: 'queued', attempts: 0, nextAt: 0 });
    if (files) {
      const it = toAdd[toAdd.length - 1];
      it.files = files;
      it.userFolder = userFolder;
      it.postFolder = postFolder;
      it.retryKey = retryKey;
    }
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

function fetchBlob(url, onprogress, timeoutMs, handles) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let handle = null;
    const finalize = (ok, payload) => {
      if (settled) return;
      settled = true;
      if (handles && handle) handles.delete(handle);
      ok ? resolve(payload) : reject(payload);
    };
    handle = GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: { Referer: location.href, Accept: 'text/css' },
      responseType: 'blob',
      timeout: timeoutMs || 0,
      onprogress: evt => { if (typeof onprogress === 'function') onprogress(evt); },
      onload: resp => {
        if (resp && resp.status >= 200 && resp.status < 300 && resp.response) {
          finalize(true, resp.response);
        } else {
          finalize(false, resp);
        }
      },
      onerror: err => finalize(false, err),
      ontimeout: err => finalize(false, err)
    });
    if (handles && handle) handles.add(handle);
  });
}

function startPostArchiveDownload(item) {
  const name = item.name;
  const files = Array.isArray(item.files) ? item.files : [];
  const retryKey = getRetryKey(item);
  let settled = false;
  let lastProgressAt = Date.now();
  let tTotal = null;
  let tIdle = null;
  const handles = new Set();
  item._handles = handles;

  const clearWatchers = () => {
    if (tTotal) {
      try { clearTimeout(tTotal); } catch {}
      tTotal = null;
    }
    if (tIdle) {
      try { clearInterval(tIdle); } catch {}
      tIdle = null;
    }
  };

  const abortHandles = () => {
    if (item._handle && typeof item._handle.abort === 'function') {
      try { item._handle.abort(); } catch {}
    }
    for (const h of handles) {
      if (h && typeof h.abort === 'function') {
        try { h.abort(); } catch {}
      }
    }
    handles.clear();
  };

  const handleFailure = (reason, err) => {
    if (settled) return;
    settled = true;
    abortHandles();
    clearWatchers();

    logDownloadError(item, reason || 'Download failed', err);

    const prev = retryMap[retryKey] || 0;
    const n = prev + 1;
    retryMap[retryKey] = n;

    lastDropNoteAt = Date.now();
    lastDropNoteCount++;

    const level = Math.min(n, MAX_RETRIES);
    const backoff = BACKOFF_BASE * Math.pow(2, level - 1) + Math.floor(Math.random() * 500);

    item.status = 'queued';
    item.nextAt = Date.now() + backoff;

    const prevTimer = cooldownTimers.get(retryKey);
    if (prevTimer) clearTimeout(prevTimer);

    const tid = setTimeout(() => {
      item.nextAt = 0;
      scheduleHUD();
      if (dl.started) requestDispatch();
    }, backoff + 5);
    cooldownTimers.set(retryKey, tid);

    const idx = dl.items.indexOf(item);
    if (idx >= 0) {
      dl.items.splice(idx, 1);
      dl.items.push(item);
    }

    scheduleHUD();
    setTimeout(requestDispatch, 0);
  };

  if (!JSZip || typeof JSZip !== 'function') {
    handleFailure('JSZip missing');
    return;
  }

  const totalMs = Math.max(
    STALL_VID_TOTAL_MS,
    files.reduce((sum, file) => {
      const url = file && file.url ? file.url : '';
      return sum + (vidRE.test(url) ? STALL_VID_TOTAL_MS : STALL_IMG_TOTAL_MS);
    }, 0) || STALL_IMG_TOTAL_MS
  );
  const idleMs = files.some(file => vidRE.test((file && file.url) || '')) ? STALL_VID_IDLE_MS : STALL_IMG_IDLE_MS;
  tTotal = setTimeout(() => {
    if (!TIMEOUT_RETRIES_ENABLED) return;
    handleFailure('Download timeout');
  }, totalMs);
  tIdle = setInterval(() => {
    if (!TIMEOUT_RETRIES_ENABLED) return;
    if (Date.now() - lastProgressAt > idleMs) handleFailure('Download stalled');
  }, 2000);

  (async () => {
    const zip = new JSZip();
    let added = 0;

    for (const file of files) {
      if (settled) return;
      const url = file && file.url;
      if (!url) continue;
      try {
        lastProgressAt = Date.now();
        const timeoutMs = vidRE.test(url) ? STALL_VID_TOTAL_MS : STALL_IMG_TOTAL_MS;
        const blob = await fetchBlob(url, () => { lastProgressAt = Date.now(); }, timeoutMs, handles);
        const parts = splitDownloadPath(file.name || '');
        const postFolder = parts.postFolder || item.postFolder || '';
        const fileName = parts.fileName || getDownloadLabel(file);
        const zipPath = `${postFolder ? `${postFolder}/` : ''}${fileName}`;
        zip.file(zipPath, blob);
        added++;
      } catch (err) {
        logDownloadError({ url, name: file && file.name ? file.name : url }, 'Download error', err);
      }
    }

    if (settled) return;
    if (!added) {
      handleFailure('No files downloaded');
      return;
    }

    let zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);

    const handle = GM_download({
      url: zipUrl,
      name,
      onload: () => {
        if (settled) return;
        settled = true;
        clearWatchers();
        try { URL.revokeObjectURL(zipUrl); } catch {}
        item.status = 'done';
        scheduleHUD();
        setTimeout(requestDispatch, SPAWN_DELAY + Math.floor(Math.random() * 200));
        maybeFinishBatch();
      },
      onerror: err => {
        try { URL.revokeObjectURL(zipUrl); } catch {}
        handleFailure('Download error', err);
      }
    });
    item._handle = handle;
  })().catch(err => handleFailure('Download error', err));
}

function startDownload(item) {
  if (item && Array.isArray(item.files)) {
    startPostArchiveDownload(item);
    return;
  }
  const name = item.name;
  const isVid = vidRE.test(item.url);
  const totalMs = isVid ? STALL_VID_TOTAL_MS : STALL_IMG_TOTAL_MS;
  const idleMs = isVid ? STALL_VID_IDLE_MS : STALL_IMG_IDLE_MS;
  let lastProgressAt = Date.now();
  let settled = false;
  let tTotal = null;
  let tIdle = null;

  const clearWatchers = () => {
    if (tTotal) {
      try { clearTimeout(tTotal); } catch {}
      tTotal = null;
    }
    if (tIdle) {
      try { clearInterval(tIdle); } catch {}
      tIdle = null;
    }
  };

  const handleFailure = (reason, err) => {
    if (settled) return;
    settled = true;
    try { if (item._handle && typeof item._handle.abort === 'function') item._handle.abort(); } catch {}
    clearWatchers();

    logDownloadError(item, reason || 'Download failed', err);

    const retryKey = getRetryKey(item);
    const prev = retryMap[retryKey] || 0;
    const n = prev + 1;
    retryMap[retryKey] = n;

    lastDropNoteAt = Date.now();
    lastDropNoteCount++;

    const level = Math.min(n, MAX_RETRIES);
    const backoff = BACKOFF_BASE * Math.pow(2, level - 1) + Math.floor(Math.random() * 500);

    item.status = 'queued';
    item.nextAt = Date.now() + backoff;

    const prevTimer = cooldownTimers.get(retryKey);
    if (prevTimer) clearTimeout(prevTimer);

    const tid = setTimeout(() => {
      item.nextAt = 0;
      scheduleHUD();
      if (dl.started) requestDispatch();
    }, backoff + 5);
    cooldownTimers.set(retryKey, tid);

    const idx = dl.items.indexOf(item);
    if (idx >= 0) {
      dl.items.splice(idx, 1);
      dl.items.push(item);
    }

    scheduleHUD();
    setTimeout(requestDispatch, 0);
  };

  tTotal = setTimeout(() => {
    if (!TIMEOUT_RETRIES_ENABLED) return;
    handleFailure('Download timeout');
  }, totalMs);
  tIdle = setInterval(() => {
    if (!TIMEOUT_RETRIES_ENABLED) return;
    if (Date.now() - lastProgressAt > idleMs) handleFailure('Download stalled');
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
    onerror: (err) => handleFailure('Download error', err)
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
    if (!allowedFiles || !allowedFiles.length) return;
    const files = [];
    let userFolder = '';
    let postFolder = '';
    allowedFiles.forEach(fileInfo => {
      if (!fileInfo || !fileInfo.url) return;
      const ref = fileInfo.url;
      const fileObj = { path: ref };
      const name = formatFilename(post, fileObj, fileInfo.g, globalIndex);
      const parts = splitDownloadPath(name);
      if (!userFolder && parts.userFolder) userFolder = parts.userFolder;
      if (!postFolder && parts.postFolder) postFolder = parts.postFolder;
      files.push({ url: ref, name, fileIndex: fileInfo.g });
    });
    if (!files.length) return;
    const archiveName = buildArchiveName(userFolder, postFolder);
    const retryKey = post && post.id ? `post:${post.id}` : `${userFolder}/${postFolder}`;
    objs.push({
      url: files[0].url,
      name: archiveName,
      meta: { post, globalIndex },
      files,
      userFolder,
      postFolder,
      retryKey
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
    if (STOP_BUTTON_CLEARS_QUEUE) {
      await handleClear();
    } else {
      dl.started = false;
      DL_ACTIVE = false;
      b.classList.remove('stop');
      b.textContent = 'Download';
      scheduleHUD();
    }
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
