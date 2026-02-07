
// ==UserScript==
// @name         PartyGuest
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      01.13.03
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
  --color0-primary: hsl(0, 0%, 95%);
  --color0-secondary: hsl(0, 0%, 70%);
  --color0-tertirary: hsl(0, 0%, 45%);

  --color1-primary: hsl(200, 25%, 5%);
  --color1-primary-transparent: hsla(200, 25%, 5%, .85);
  --color1-secondary: hsl(208, 22%, 12%);
  --color1-secondary-transparent: hsla(208, 22%, 12%, .5);
  --color1-tertiary: hsl(210, 15%, 5%);

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

#partyHUD button {
  font-size: 12px;
  padding: 6px 10px;
  font-weight: 600;
  color: var(--color0-primary);
  background: var(--color1-secondary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  cursor: pointer;
  text-shadow: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .45);
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

#pgMenuCard #partyHUD {
  position: relative;
  left: auto;
  bottom: auto;
  transform: none;
  z-index: auto;
  width: 100%;
  max-width: none;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
}

#pgMenuCard #hudRow {
  flex-wrap: wrap;
  overflow: visible;
}

#pgMenuCard #hudRow > button {
  flex: 0 0 auto;
}

.pg-hud-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color1-tertiary);
}

.pg-hud-section:last-child {
  border-bottom: none;
}

.pg-hud-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--color0-secondary);
}

#hudFilters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

#hudFilters > button {
  flex: 0 0 auto;
}

#hudFilters input[type="text"],
#hudFilters input[type="number"] {
  width: auto;
  min-width: 90px;
  flex: 1 1 120px;
}

/* Menu overlay */

html.pg-menu-open,
body.pg-menu-open {
  overflow: auto !important;
  overscroll-behavior: auto;
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
  resize: none;
  overflow: hidden;
  width: min(860px, 96vw);
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  min-width: 100px;
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
  overscroll-behavior: contain;
}

#pgMenuCard.pg-overlay-dragging {
  cursor: grabbing;
}

#pgMenuCard .pg-menu-resize-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  z-index: 6;
  pointer-events: auto;
  background: transparent;
}

#pgMenuCard .pg-menu-resize-handle.pg-menu-resize-nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

#pgMenuCard .pg-menu-resize-handle.pg-menu-resize-ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

#pgMenuCard .pg-menu-resize-handle.pg-menu-resize-sw {
  left: 0;
  bottom: 0;
  cursor: nesw-resize;
}

#pgMenuCard .pg-menu-resize-handle.pg-menu-resize-se {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}

#pgMenuCard.pg-collapsed .pg-menu-resize-handle {
  display: none;
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

#pgMenuTabs .pgMenuTabBtn .pg-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  margin-left: 6px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--rain-red);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

#pgMenuCollapseBtn {
  margin-left: auto;
  align-self: flex-start;
  order: 2;
  min-width: 32px;
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
#pgMenuInfoBody,
#pgMenuGroupsBody,
#pgMenuErrorBody,
#pgMenuQueueBody,
#pgMenuDownloadsBody {
  padding: 10px 10px 12px;
  overflow: auto;
  min-height: 0;
  flex: 1 1 auto;
  font-size: 12px;
  color: var(--color0-primary);
  overscroll-behavior: contain;
}

#pgMenuDownloadsBody > .pg-hud-section {
  padding: 10px 12px;
}

#pgMenuDownloadsBody #pgMenuGroupsBody {
  padding: 0;
  overflow: visible;
  flex: 0 0 auto;
  min-height: auto;
}

#pgMenuCard.pg-collapsed {
  height: auto !important;
  min-height: 0;
  resize: none;
}

#pgMenuCard.pg-collapsed #pgMenuBody {
  display: none;
}

#pgMenuCard.pg-collapsed #pgMenuTabs {
  display: none;
}

#pgMenuCard.pg-collapsed #pgMenuHeader {
  padding: 12px 12px;
  align-items: center;
  justify-content: space-between;
}

#pgMenuCard.pg-collapsed #pgMenuHeader .title {
  order: 1;
}

#pgMenuCard.pg-collapsed #pgMenuCollapseBtn {
  align-self: center;
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

#pgMenuBody .pg-opt-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0 8px;
}

#pgMenuBody .pg-opt-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color0-primary);
}

#pgMenuBody .pg-opt-check input {
  margin: 0;
}

#pgMenuBody .pg-opt-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--color1-tertiary);
}

#pgMenuBody .pg-group-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 2px 0 10px;
}

#pgMenuBody .pg-group-row .pg-opt-right {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
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
  accent-color: var(--anchor-internal-color2-primary);
  outline: none;
}

#pgMenuBody select {
  background: var(--color1-primary);
  color: var(--color0-primary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  padding: 4px 6px;
  font-size: 12px;
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

.pg-info-preview {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color1-primary);
  border: 1px solid var(--color1-tertiary);
  border-radius: 3px;
  padding: 8px;
  color: var(--color0-primary);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}

.pg-queue-progress {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pg-queue-progress-track {
  position: relative;
  width: 100%;
  height: 6px;
  border: 1px solid var(--color1-tertiary);
  border-radius: 2px;
  background: var(--color1-secondary);
  overflow: hidden;
}

.pg-queue-progress-fill {
  height: 100%;
  width: 0%;
  background: var(--anchor-internal-color2-primary);
  transition: width .12s linear;
}

.pg-queue-progress-fill.indeterminate {
  width: 35%;
  animation: pg-queue-indeterminate 1s linear infinite;
}

.pg-queue-progress-text {
  font-size: 11px;
  color: var(--color0-primary);
}

@keyframes pg-queue-indeterminate {
  from { transform: translateX(-120%); }
  to { transform: translateX(320%); }
}

/* Primary / special buttons */

#dlBtn {
  background: var(--color1-secondary);
  color: var(--color0-primary);
}

#dlBtn:hover:not(:disabled) {
  background: var(--color1-secondary-transparent);
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
  background: var(--color1-secondary) !important;
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
  box-shadow: 0 2px 6px rgba(0, 0, 0, .45) !important;
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
  color: var(--color0-primary);
}

#filterStatus {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--color0-primary);
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
  z-index: 10002;
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
const MAX_RETRIES = 5;
const BACKOFF_BASE = 1200;
const STALL_IMG_TOTAL_MS = 90000;
const STALL_IMG_IDLE_MS = 45000;
const STALL_VID_TOTAL_MS = 300000;
const STALL_VID_IDLE_MS = 90000;
const GALLERY_PRELOAD_VIDEO_TIMEOUT_MS = 45000;
const VIDEO_DURATION_REQUEST_TIMEOUT_MS = 45000;
const VIDEO_DURATION_PROBE_DEFAULT = 6;
let VIDEO_DURATION_PROBE_CONCURRENCY = VIDEO_DURATION_PROBE_DEFAULT;
const PG_OPTIONS_KEY = 'pg_options';
const PG_GROUPS_KEY_PREFIX = 'pg_groups_';
const PG_MENU_STATE_KEY = 'pg_menu_state';
const PG_CACHE_DB_NAME = 'PartyGuestCache';
const PG_CACHE_STORE = 'postIndex';
const PG_DURATION_CACHE_KEY_PREFIX = 'duration_';
const SPECIAL_DOWNLOAD_BEHAVIOR_LABELS = {
  off: 'Off',
  smattering: 'Smattering (1/X per post)',
  every_x: 'Only Every X Files',
  first_x: 'Only First X Files per post'
};
const SPECIAL_DOWNLOAD_BEHAVIOR_VALUES = [
  'off',
  'smattering',
  'every_x',
  'first_x'
];
const SPECIAL_DOWNLOAD_VALUE_DEFAULT = 3;
const DEFAULT_OPTIONS = {
  downloadMode: 'queue_flat',
  specialDownloadBehavior: 'off',
  specialDownloadValue: SPECIAL_DOWNLOAD_VALUE_DEFAULT,
  durationIndexing: false,
  galleryPreloadAll: false,
  parallelDownloadLimit: 3,
  videoDurationProbeConcurrency: VIDEO_DURATION_PROBE_DEFAULT,
  timeoutRetries: true,
  stopClearsQueue: true,
  showLocalGalleryBtn: true,
  showDownloadPostLinksBtn: true,
  showGalleryBtn: true,
  showPageBtn: true,
  showMediaBtn: true,
  showPreviewBtn: true,
  showPageInput: true,
  showPostInput: true,
  showFileInput: true,
  showProgressBar: true,
  showGroupsSection: true
};
const DOWNLOAD_MODE_LABELS = {
  queue_flat: 'Archive by queue',
  post: 'Archive by post',
  loose_queue: 'Loose by queue',
  loose_post: 'Loose by post'
};
const DOWNLOAD_MODE_VALUES = [
  'queue_flat',
  'post',
  'loose_queue',
  'loose_post'
];
function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function normalizeOptions(opt) {
  const out = Object.assign({}, DEFAULT_OPTIONS);
  if (!opt || typeof opt !== 'object') return out;
  if (typeof opt.downloadMode === 'string') {
    if (DOWNLOAD_MODE_LABELS[opt.downloadMode]) out.downloadMode = opt.downloadMode;
  }
  if (typeof opt.specialDownloadBehavior === 'string') {
    if (SPECIAL_DOWNLOAD_BEHAVIOR_LABELS[opt.specialDownloadBehavior]) out.specialDownloadBehavior = opt.specialDownloadBehavior;
  }
  if (opt.specialDownloadValue != null) {
    out.specialDownloadValue = clampInt(opt.specialDownloadValue, 1, 999, DEFAULT_OPTIONS.specialDownloadValue);
  }
  if (typeof opt.durationIndexing === 'boolean') out.durationIndexing = opt.durationIndexing;
  if (typeof opt.galleryPreloadAll === 'boolean') out.galleryPreloadAll = opt.galleryPreloadAll;
  if (opt.parallelDownloadLimit != null) {
    out.parallelDownloadLimit = clampInt(opt.parallelDownloadLimit, 1, 10, DEFAULT_OPTIONS.parallelDownloadLimit);
  }
  if (opt.videoDurationProbeConcurrency != null) {
    out.videoDurationProbeConcurrency = clampInt(opt.videoDurationProbeConcurrency, 1, 10, DEFAULT_OPTIONS.videoDurationProbeConcurrency);
  }
  if (typeof opt.timeoutRetries === 'boolean') out.timeoutRetries = opt.timeoutRetries;
  if (typeof opt.stopClearsQueue === 'boolean') out.stopClearsQueue = opt.stopClearsQueue;
  if (typeof opt.showLocalGalleryBtn === 'boolean') out.showLocalGalleryBtn = opt.showLocalGalleryBtn;
  if (typeof opt.showDownloadPostLinksBtn === 'boolean') out.showDownloadPostLinksBtn = opt.showDownloadPostLinksBtn;
  if (typeof opt.showGalleryBtn === 'boolean') out.showGalleryBtn = opt.showGalleryBtn;
  if (typeof opt.showPageBtn === 'boolean') out.showPageBtn = opt.showPageBtn;
  if (typeof opt.showMediaBtn === 'boolean') out.showMediaBtn = opt.showMediaBtn;
  if (typeof opt.showPreviewBtn === 'boolean') out.showPreviewBtn = opt.showPreviewBtn;
  if (typeof opt.showPageInput === 'boolean') out.showPageInput = opt.showPageInput;
  if (typeof opt.showPostInput === 'boolean') out.showPostInput = opt.showPostInput;
  if (typeof opt.showFileInput === 'boolean') out.showFileInput = opt.showFileInput;
  if (typeof opt.showProgressBar === 'boolean') out.showProgressBar = opt.showProgressBar;
  if (typeof opt.showGroupsSection === 'boolean') out.showGroupsSection = opt.showGroupsSection;
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
let DOWNLOAD_MODE = DEFAULT_OPTIONS.downloadMode;
let SPECIAL_DOWNLOAD_BEHAVIOR = DEFAULT_OPTIONS.specialDownloadBehavior;
let SPECIAL_DOWNLOAD_VALUE = DEFAULT_OPTIONS.specialDownloadValue;
let GALLERY_PRELOAD_ALL_MEDIA = false;
let DURATION_FEATURE_ENABLED = false;
let PARALLEL_DOWNLOAD_LIMIT = 3;
const ARCHIVE_FETCH_CAP = 6;
let TIMEOUT_RETRIES_ENABLED = true;
let STOP_BUTTON_CLEARS_QUEUE = true;
let SHOW_PROGRESS_BAR = true;
let SHOW_GROUPS_SECTION = true;
let PG_GROUPS = [];
let GROUPS_PROFILE_KEY = null;
let PG_CACHE_DB = null;
let PG_CACHE_DB_OPENING = null;
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
let LAST_POST_CLICK = null;
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
let MENU_ACTIVE_TAB = 'downloads';
let MENU_LAST_TAB = 'downloads';
let MENU_HAS_OPENED = false;
const MENU_TAB_SCROLL = { downloads: 0, queue: 0, info: 0, options: 0, errors: 0 };
const MENU_TAB_IDS = ['downloads', 'queue', 'info', 'options', 'errors'];
const MENU_WINDOW_STATE = { x: null, y: null, width: null, height: null };
const MENU_DEFAULT_WIDTH = 100;
const MENU_DEFAULT_HEIGHT = 550;
const MENU_DEFAULT_MARGIN = 8;
let MENU_TAB_BUTTONS = [];
let MENU_TAB_PANELS = {};
let MENU_SCROLL_TARGETS = {};
let MENU_RESIZE_OBSERVER = null;
let MENU_COLLAPSED = false;
let INFO_RENDER_TOKEN = 0;
const ERROR_LOG = [];
const FAILED_ITEMS = [];
let ERROR_TAB_UNREAD = 0;

function loadMenuState() {
  let parsed = null;
  try { parsed = JSON.parse(localStorage.getItem(PG_MENU_STATE_KEY) || 'null'); } catch {}
  if (!parsed || typeof parsed !== 'object') return;
  const keys = ['x', 'y', 'width', 'height'];
  keys.forEach(k => {
    const v = parsed[k];
    if (typeof v === 'number' && isFinite(v)) MENU_WINDOW_STATE[k] = v;
  });
  if (typeof parsed.collapsed === 'boolean') MENU_COLLAPSED = parsed.collapsed;
  if (typeof parsed.lastTab === 'string' && MENU_TAB_IDS.includes(parsed.lastTab)) {
    MENU_LAST_TAB = parsed.lastTab;
  }
}

function saveMenuState() {
  const payload = {
    x: MENU_WINDOW_STATE.x,
    y: MENU_WINDOW_STATE.y,
    width: MENU_WINDOW_STATE.width,
    height: MENU_WINDOW_STATE.height,
    collapsed: MENU_COLLAPSED,
    lastTab: MENU_LAST_TAB
  };
  try { localStorage.setItem(PG_MENU_STATE_KEY, JSON.stringify(payload)); } catch {}
}

loadMenuState();

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

function isLikelyHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function summarizeErrorBits(err, prefix) {
  if (!err || typeof err !== 'object') return [];
  const bits = [];
  const keyPrefix = prefix ? (prefix + ' ') : '';
  if (err.stage) bits.push(`${keyPrefix}stage=${String(err.stage)}`);
  if (typeof err.status === 'number') {
    if (err.statusText) bits.push(`${keyPrefix}HTTP ${err.status} ${String(err.statusText)}`);
    else bits.push(`${keyPrefix}HTTP ${err.status}`);
  }
  if (err.error) bits.push(`${keyPrefix}${String(err.error)}`);
  if (err.message) bits.push(`${keyPrefix}${String(err.message)}`);
  if (err.details) bits.push(`${keyPrefix}${String(err.details)}`);
  if (!bits.length && err.type) bits.push(`${keyPrefix}${String(err.type)}`);
  return bits;
}

function formatDownloadErrorReason(reason, err) {
  const bits = [];
  if (typeof err === 'string') {
    bits.push(err);
  } else if (err && typeof err === 'object') {
    bits.push(...summarizeErrorBits(err));
    if (err.native) bits.push(...summarizeErrorBits(err.native, 'native'));
    if (err.fallback) bits.push(...summarizeErrorBits(err.fallback, 'fallback'));
    if (!bits.length) bits.push('unknown');
  }
  const base = reason || 'Download failed';
  const detail = bits.join(' | ');
  if (detail && detail !== base) return `${base}: ${detail}`;
  return base;
}

function buildErrorEntry(item, reason, err, attempts) {
  const isArchive = !!(item && Array.isArray(item.files));
  const label = isArchive ? `[Archive] ${item.name || 'archive.zip'}` : getDownloadLabel(item);
  const sourceUrlRaw = item && (item.lastErrorUrl || item.failedUrl || item.url) ? (item.lastErrorUrl || item.failedUrl || item.url) : '';
  const sourceUrl = isLikelyHttpUrl(sourceUrlRaw) ? sourceUrlRaw : '';
  const stage = err && typeof err === 'object' && err.stage ? String(err.stage) : '';
  return {
    ts: Date.now(),
    url: sourceUrl,
    label,
    reason: formatDownloadErrorReason(reason, err),
    attempts: attempts || 0,
    stage,
    isArchive
  };
}

function buildRetryPayloadFromQueueItem(item) {
  if (!item || typeof item !== 'object') return null;
  const out = {
    url: item.url || '',
    name: item.name || '',
    retryKey: item.retryKey || item.url || item.name || ''
  };
  if (item.meta && typeof item.meta === 'object') {
    out.meta = Object.assign({}, item.meta);
  }
  if (Array.isArray(item.files)) {
    const files = item.files
      .filter(file => file && file.url)
      .map(file => ({
        url: file.url,
        name: file.name || '',
        fileIndex: typeof file.fileIndex === 'number' ? file.fileIndex : 0,
        postFolder: file.postFolder || ''
      }));
    if (!files.length) return null;
    out.files = files;
    out.userFolder = item.userFolder || '';
    out.postFolder = item.postFolder || '';
    out.archiveMode = item.archiveMode || '';
    out.queuePostFolder = item.queuePostFolder || '';
    out.groupPostFolder = item.groupPostFolder || '';
    out.url = out.url || files[0].url;
    out.retryKey = out.retryKey || out.url || out.name || '';
  }
  if (!out.url) return null;
  return out;
}

function buildRetryQueueItemFromFailedEntry(entry) {
  if (!entry || typeof entry !== 'object' || !entry.retryItem) return null;
  return buildRetryPayloadFromQueueItem(entry.retryItem);
}

function hasRetryableFailedItems() {
  for (const entry of FAILED_ITEMS) {
    const src = entry && entry.retryItem;
    if (!src || typeof src !== 'object') continue;
    if (Array.isArray(src.files)) {
      if (src.files.some(file => file && file.url)) return true;
      continue;
    }
    if (src.url) return true;
  }
  return false;
}

function handleRetryFailedFiles() {
  const { downloading, queued } = getCounts();
  if (downloading > 0 || queued > 0) {
    setStatus('Wait for the current queue to finish first', 'info');
    return false;
  }
  if (!FAILED_ITEMS.length) {
    setStatus('No failed files to retry', 'info');
    return false;
  }

  const retryItems = [];
  for (const entry of FAILED_ITEMS) {
    const item = buildRetryQueueItemFromFailedEntry(entry);
    if (item) retryItems.push(item);
  }
  if (!retryItems.length) {
    setStatus('No retry data available for failed files', 'error');
    return false;
  }

  FAILED_ITEMS.length = 0;
  clearErrorTabUnread();
  renderErrorLogUi();
  scheduleHUD();

  enqueueItems(retryItems);
  startQueueIfIdle();
  setStatus(`Queued ${retryItems.length} failed item${retryItems.length === 1 ? '' : 's'} for retry`, 'success');
  return true;
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
  const { downloading, queued } = getCounts();
  const showRetryFailedBtn = hasRetryableFailedItems() && downloading === 0 && queued === 0;
  if (showRetryFailedBtn) {
    const actions = document.createElement('div');
    actions.className = 'pg-group-actions';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.id = 'pgRetryFailedBtn';
    retryBtn.textContent = 'retry failed files';
    retryBtn.addEventListener('click', () => handleRetryFailedFiles());
    actions.appendChild(retryBtn);
    body.appendChild(actions);
  }
  if (!ERROR_LOG.length && !FAILED_ITEMS.length) {
    const empty = document.createElement('div');
    empty.className = 'pg-options-note';
    empty.textContent = 'No errors yet.';
    body.appendChild(empty);
    return;
  }

  if (FAILED_ITEMS.length) {
    const title = document.createElement('div');
    title.className = 'pg-opt-section-title';
    title.textContent = 'Failed Items';
    body.appendChild(title);

    const failedList = document.createElement('div');
    failedList.className = 'pg-error-log';
    for (let i = FAILED_ITEMS.length - 1; i >= 0; i--) {
      const entry = FAILED_ITEMS[i];
      const item = document.createElement('div');
      item.className = 'pg-error-item';

      if (entry.url && isLikelyHttpUrl(entry.url)) {
        const link = document.createElement('a');
        link.className = 'pg-error-link';
        link.href = entry.url;
        link.textContent = entry.label || entry.url || 'Unknown file';
        link.target = '_blank';
        link.rel = 'noopener';
        item.appendChild(link);
      } else {
        const label = document.createElement('div');
        label.className = 'pg-error-link';
        label.textContent = entry.label || 'Unknown file';
        item.appendChild(label);
      }

      const meta = document.createElement('div');
      meta.className = 'pg-error-meta';
      const when = new Date(entry.ts || Date.now()).toLocaleTimeString();
      const attempts = entry.attempts || MAX_RETRIES;
      meta.textContent = `${when} • ${entry.reason || 'Download failed'} • ${attempts}/${MAX_RETRIES} attempts`;
      item.appendChild(meta);

      failedList.appendChild(item);
    }
    body.appendChild(failedList);
  }

  if (ERROR_LOG.length) {
    const title = document.createElement('div');
    title.className = 'pg-opt-section-title';
    title.textContent = 'Recent Errors';
    body.appendChild(title);

    const list = document.createElement('div');
    list.className = 'pg-error-log';
    for (let i = ERROR_LOG.length - 1; i >= 0; i--) {
      const entry = ERROR_LOG[i];
      const item = document.createElement('div');
      item.className = 'pg-error-item';

      if (entry.url && isLikelyHttpUrl(entry.url)) {
        const link = document.createElement('a');
        link.className = 'pg-error-link';
        link.href = entry.url;
        link.textContent = entry.label || entry.url || 'Unknown file';
        link.target = '_blank';
        link.rel = 'noopener';
        item.appendChild(link);
      } else {
        const label = document.createElement('div');
        label.className = 'pg-error-link';
        label.textContent = entry.label || 'Unknown file';
        item.appendChild(label);
      }

      const meta = document.createElement('div');
      meta.className = 'pg-error-meta';
      const when = new Date(entry.ts || Date.now()).toLocaleTimeString();
      meta.textContent = `${when} • ${entry.reason || 'Download failed'}`;
      item.appendChild(meta);

      list.appendChild(item);
    }
    body.appendChild(list);
  }

  requestAnimationFrame(() => {
    body.scrollTop = prevScroll;
  });
}

function getErrorTabButton() {
  return document.querySelector('#pgMenuTabs .pgMenuTabBtn[data-tab="errors"]');
}

function updateErrorTabBadge() {
  const btn = getErrorTabButton();
  if (!btn) return;
  let badge = btn.querySelector('.pg-tab-badge');
  if (ERROR_TAB_UNREAD > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'pg-tab-badge';
      btn.appendChild(badge);
    }
    badge.textContent = ERROR_TAB_UNREAD > 999 ? '999+' : String(ERROR_TAB_UNREAD);
    btn.setAttribute('aria-label', `Error Log (${ERROR_TAB_UNREAD} unread)`);
  } else {
    if (badge) badge.remove();
    btn.setAttribute('aria-label', 'Error Log');
  }
}

function markErrorTabUnread() {
  if (MENU_OPEN && MENU_ACTIVE_TAB === 'errors') return;
  ERROR_TAB_UNREAD++;
  updateErrorTabBadge();
}

function clearErrorTabUnread() {
  if (!ERROR_TAB_UNREAD) return;
  ERROR_TAB_UNREAD = 0;
  updateErrorTabBadge();
}

function getQueueItemLabel(item) {
  if (!item) return 'Unknown file';
  if (Array.isArray(item.files)) return `[Archive] ${item.name || 'archive'}`;
  return getDownloadLabel(item);
}

function clampQueuePercent(value) {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatByteSize(value) {
  const n = Number(value);
  if (!isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getQueueItemProgressState(item) {
  if (!item) return null;
  const hasPct = typeof item.progressPct === 'number' && isFinite(item.progressPct);
  const hasLabel = typeof item.progressLabel === 'string' && item.progressLabel.trim() !== '';
  const indeterminate = !!item.progressIndeterminate;
  if (!hasPct && !hasLabel && !indeterminate) return null;
  const pct = hasPct ? clampQueuePercent(item.progressPct) : null;
  let label = hasLabel ? item.progressLabel.trim() : '';
  if (!label && pct != null) label = `${pct}%`;
  if (!label && indeterminate) label = 'Working...';
  return { pct, label, indeterminate };
}

function setQueueItemProgress(item, next) {
  if (!item) return;
  const patch = next && typeof next === 'object' ? next : {};
  let changed = false;

  if ('pct' in patch) {
    const pct = clampQueuePercent(patch.pct);
    if (pct == null) {
      if ('progressPct' in item) {
        delete item.progressPct;
        changed = true;
      }
    } else if (item.progressPct !== pct) {
      item.progressPct = pct;
      changed = true;
    }
  }

  if ('label' in patch) {
    const label = patch.label == null ? '' : String(patch.label);
    if (label) {
      if (item.progressLabel !== label) {
        item.progressLabel = label;
        changed = true;
      }
    } else if ('progressLabel' in item) {
      delete item.progressLabel;
      changed = true;
    }
  }

  if ('indeterminate' in patch) {
    const ind = !!patch.indeterminate;
    if (item.progressIndeterminate !== ind) {
      item.progressIndeterminate = ind;
      changed = true;
    }
  }

  if (changed) scheduleHUD();
}

function clearQueueItemProgress(item) {
  if (!item) return;
  let changed = false;
  if ('progressPct' in item) { delete item.progressPct; changed = true; }
  if ('progressLabel' in item) { delete item.progressLabel; changed = true; }
  if ('progressIndeterminate' in item) { delete item.progressIndeterminate; changed = true; }
  if (changed) scheduleHUD();
}

function renderQueueUi() {
  const body = document.getElementById('pgMenuQueueBody');
  if (!body) return;
  const prevScroll = body.scrollTop || 0;
  body.innerHTML = '';

  const activeItems = dl.items.filter(item => item && item.status === 'active');
  const queuedItems = dl.items.filter(item => item && item.status === 'queued');
  if (!activeItems.length && !queuedItems.length) {
    const empty = document.createElement('div');
    empty.className = 'pg-options-note';
    empty.textContent = 'Queue is empty.';
    body.appendChild(empty);
    return;
  }

  const now = Date.now();
  const appendSection = (titleText, items, downloading) => {
    if (!items.length) return;
    const title = document.createElement('div');
    title.className = 'pg-opt-section-title';
    title.textContent = titleText;
    body.appendChild(title);

    const list = document.createElement('div');
    list.className = 'pg-error-log';
    for (let i = 0; i < items.length; i++) {
      const entry = items[i];
      const item = document.createElement('div');
      item.className = 'pg-error-item';

      const labelText = getQueueItemLabel(entry);
      const sourceUrl = entry && entry.url ? normalizeDownloadUrl(entry.url) : '';
      if (sourceUrl && isLikelyHttpUrl(sourceUrl)) {
        const link = document.createElement('a');
        link.className = 'pg-error-link';
        link.href = sourceUrl;
        link.textContent = labelText;
        link.target = '_blank';
        link.rel = 'noopener';
        item.appendChild(link);
      } else {
        const label = document.createElement('div');
        label.className = 'pg-error-link';
        label.textContent = labelText;
        item.appendChild(label);
      }

      const meta = document.createElement('div');
      meta.className = 'pg-error-meta';
      const bits = [];
      bits.push('#' + (i + 1));
      if (downloading) bits.push('Downloading');
      else if (entry.nextAt && entry.nextAt > now) bits.push('Retry in ' + Math.ceil((entry.nextAt - now) / 1000) + 's');
      else bits.push('Queued');
      if (Array.isArray(entry.files)) bits.push(`${entry.files.length} files`);
      const retryKey = getRetryKey(entry);
      const retries = retryKey ? (retryMap[retryKey] || 0) : 0;
      if (retries > 0) bits.push(`${retries}/${MAX_RETRIES} retries`);
      meta.textContent = bits.join(' • ');
      item.appendChild(meta);

      if (downloading) {
        const progress = getQueueItemProgressState(entry);
        if (progress) {
          const wrap = document.createElement('div');
          wrap.className = 'pg-queue-progress';

          const track = document.createElement('div');
          track.className = 'pg-queue-progress-track';

          const fill = document.createElement('div');
          fill.className = 'pg-queue-progress-fill';
          if (progress.indeterminate || progress.pct == null) {
            fill.classList.add('indeterminate');
          } else {
            fill.style.width = progress.pct + '%';
          }
          track.appendChild(fill);

          const txt = document.createElement('div');
          txt.className = 'pg-queue-progress-text';
          txt.textContent = progress.label || (progress.pct != null ? `${progress.pct}%` : 'Working...');

          wrap.appendChild(track);
          wrap.appendChild(txt);
          item.appendChild(wrap);
        }
      }

      list.appendChild(item);
    }
    body.appendChild(list);
  };

  appendSection('Downloading', activeItems, true);
  appendSection('Queued', queuedItems, false);

  requestAnimationFrame(() => {
    body.scrollTop = prevScroll;
  });
}

function logDownloadError(item, reason, err) {
  const entry = buildErrorEntry(item, reason, err, 0);
  ERROR_LOG.push(entry);
  if (ERROR_LOG.length > 500) {
    ERROR_LOG.splice(0, ERROR_LOG.length - 500);
  }
  renderErrorLogUi();
  markErrorTabUnread();
}

function logFailedItem(item, reason, err, attempts) {
  const entry = buildErrorEntry(item, reason, err, attempts || MAX_RETRIES);
  const key = getRetryKey(item) || entry.url || entry.label;
  const retryItem = buildRetryPayloadFromQueueItem(item);
  const nextEntry = Object.assign({ key, retryItem }, entry);
  const idx = FAILED_ITEMS.findIndex(entry => entry && entry.key === key);
  if (idx >= 0) FAILED_ITEMS[idx] = nextEntry;
  else FAILED_ITEMS.push(nextEntry);
  if (FAILED_ITEMS.length > 500) {
    FAILED_ITEMS.splice(0, FAILED_ITEMS.length - 500);
  }
  renderErrorLogUi();
  markErrorTabUnread();
}

function setStatus(text, type) {
  const el = $('#filterStatus');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = 'var(--color0-primary)';
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
  el.style.color = 'var(--color0-primary)';
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
  fs.style.color = 'var(--color0-primary)';
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

function openCacheDb() {
  if (PG_CACHE_DB) return Promise.resolve(PG_CACHE_DB);
  if (PG_CACHE_DB_OPENING) return PG_CACHE_DB_OPENING;
  if (!('indexedDB' in window)) return Promise.resolve(null);
  PG_CACHE_DB_OPENING = new Promise(resolve => {
    const req = indexedDB.open(PG_CACHE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PG_CACHE_STORE)) {
        db.createObjectStore(PG_CACHE_STORE);
      }
    };
    req.onsuccess = () => {
      PG_CACHE_DB = req.result;
      resolve(PG_CACHE_DB);
    };
    req.onerror = () => resolve(null);
  });
  return PG_CACHE_DB_OPENING;
}

async function idbGet(cacheKey) {
  const db = await openCacheDb();
  if (!db) return null;
  return new Promise(resolve => {
    const tx = db.transaction(PG_CACHE_STORE, 'readonly');
    const store = tx.objectStore(PG_CACHE_STORE);
    const req = store.get(cacheKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function idbSet(cacheKey, payload) {
  const db = await openCacheDb();
  if (!db) return false;
  return new Promise(resolve => {
    const tx = db.transaction(PG_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(PG_CACHE_STORE);
    const req = store.put(payload, cacheKey);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  });
}

async function idbDelete(cacheKey) {
  const db = await openCacheDb();
  if (!db) return false;
  return new Promise(resolve => {
    const tx = db.transaction(PG_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(PG_CACHE_STORE);
    const req = store.delete(cacheKey);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  });
}

async function loadCachedIndex(cacheKey) {
  let parsed = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    try { localStorage.removeItem(cacheKey); } catch {}
  }

  if (!parsed) {
    parsed = await idbGet(cacheKey);
  }

  if (!parsed || !Array.isArray(parsed.posts) || !parsed.posts.length) return null;
  return parsed;
}

async function saveCachedIndex(cacheKey, payload) {
  try {
    const raw = JSON.stringify(payload);
    localStorage.setItem(cacheKey, raw);
  } catch {
    try { localStorage.removeItem(cacheKey); } catch {}
  }
  await idbSet(cacheKey, payload);
}

function durationCacheKey(profileKey) {
  return profileKey ? (PG_DURATION_CACHE_KEY_PREFIX + profileKey) : '';
}

function normalizeCachedDuration(value) {
  const n = Number(value);
  return (isFinite(n) && n >= 0) ? n : null;
}

function normalizeDurationCacheMap(raw) {
  const source = raw && typeof raw === 'object'
    ? ((raw.entries && typeof raw.entries === 'object') ? raw.entries : raw)
    : null;
  if (!source) return {};
  const out = {};
  for (const key in source) {
    if (!key) continue;
    const n = normalizeCachedDuration(source[key]);
    if (n != null) out[key] = n;
  }
  return out;
}

async function loadDurationCache(profileKey) {
  const key = durationCacheKey(profileKey);
  if (!key) return {};
  let parsed = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    try { localStorage.removeItem(key); } catch {}
  }
  if (!parsed) {
    parsed = await idbGet(key);
  }
  return normalizeDurationCacheMap(parsed);
}

async function saveDurationCache(profileKey, entries) {
  const key = durationCacheKey(profileKey);
  if (!key || !entries || typeof entries !== 'object') return;
  const payload = {
    ts: Date.now(),
    entries: normalizeDurationCacheMap(entries)
  };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    try { localStorage.removeItem(key); } catch {}
  }
  await idbSet(key, payload);
}

function groupsKey(profileKey) {
  return profileKey ? (PG_GROUPS_KEY_PREFIX + profileKey) : null;
}

function makeGroupId() {
  return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function computeGroupStats(files) {
  const postFolders = new Set();
  for (const file of files) {
    if (!file) continue;
    const parts = splitDownloadPath(file.name || '');
    const postFolder = file.postFolder || parts.postFolder || '';
    if (postFolder) postFolders.add(postFolder);
  }
  return { postCount: postFolders.size, fileCount: files.length };
}

function normalizeGroup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const files = Array.isArray(raw.files) ? raw.files.filter(f => f && f.url) : [];
  const stats = computeGroupStats(files);
  const name = typeof raw.name === 'string' ? raw.name : '';
  const earliestPostFolder = typeof raw.earliestPostFolder === 'string' ? raw.earliestPostFolder : (name || '');
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeGroupId(),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    name: name || earliestPostFolder || 'post',
    earliestPostFolder: earliestPostFolder || name || 'post',
    earliestIndex: typeof raw.earliestIndex === 'number' ? raw.earliestIndex : 0,
    userFolder: typeof raw.userFolder === 'string' ? raw.userFolder : '',
    files,
    postCount: typeof raw.postCount === 'number' ? raw.postCount : stats.postCount,
    fileCount: typeof raw.fileCount === 'number' ? raw.fileCount : stats.fileCount
  };
}

function loadGroupsForProfile(profileKey) {
  if (!profileKey) {
    PG_GROUPS = [];
    GROUPS_PROFILE_KEY = null;
    return PG_GROUPS;
  }
  if (GROUPS_PROFILE_KEY === profileKey && Array.isArray(PG_GROUPS)) return PG_GROUPS;
  let parsed = null;
  try { parsed = JSON.parse(localStorage.getItem(groupsKey(profileKey)) || '[]'); } catch {}
  if (!Array.isArray(parsed)) parsed = [];
  PG_GROUPS = parsed.map(normalizeGroup).filter(Boolean);
  GROUPS_PROFILE_KEY = profileKey;
  return PG_GROUPS;
}

function saveGroupsForProfile() {
  if (!GROUPS_PROFILE_KEY) return;
  try { localStorage.setItem(groupsKey(GROUPS_PROFILE_KEY), JSON.stringify(PG_GROUPS)); } catch {}
}

function deleteGroupById(groupId) {
  if (!groupId) return false;
  const idx = PG_GROUPS.findIndex(g => g && g.id === groupId);
  if (idx < 0) return false;
  PG_GROUPS.splice(idx, 1);
  saveGroupsForProfile();
  renderGroupsUi();
  return true;
}

function clearGroupsForProfile() {
  PG_GROUPS = [];
  saveGroupsForProfile();
  renderGroupsUi();
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

function resetDownloadQueueState(opts = {}) {
  const clearFailures = opts.clearFailures !== false;
  dl.started = false;
  DL_ACTIVE = false;
  const b = $('#dlBtn');
  if (b) {
    b.classList.remove('stop');
    b.textContent = 'Download';
  }

  for (const it of dl.items) {
    try { if (it && it._handle && typeof it._handle.abort === 'function') it._handle.abort(); } catch {}
    try {
      if (it && it._handles && typeof it._handles.forEach === 'function') {
        it._handles.forEach(h => {
          try { if (h && typeof h.abort === 'function') h.abort(); } catch {}
        });
      }
    } catch {}
  }

  cooldownTimers.forEach(id => clearTimeout(id));
  cooldownTimers.clear();
  for (const k in retryMap) delete retryMap[k];
  lastDropNoteAt = 0;
  lastDropNoteCount = 0;
  LAST_QUEUE_HAD_ITEMS = false;
  dl.items.length = 0;

  if (clearFailures) {
    FAILED_ITEMS.length = 0;
    clearErrorTabUnread();
    renderErrorLogUi();
  }

  const fs = $('#filterStatus'); if (fs) fs.textContent = '';
  const is = $('#indexStatus'); if (is) is.textContent = '';
  const fill = $('#pgFill'); if (fill) fill.style.width = '0%';
  const barLabel = $('#pgBarLabel'); if (barLabel) barLabel.textContent = '0%';
  const cC = $('#completedCount'); if (cC) cC.textContent = '0';
  const qC = $('#queuedCount'); if (qC) qC.textContent = '0';
  const xC = $('#droppedCount'); if (xC) xC.textContent = '0';
  const dropEl = $('#pgDrop'); if (dropEl) dropEl.style.display = 'none';
  PENDING_FILTER_SUMMARY = null;
  scheduleHUD();
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
    LAST_POST_CLICK = null;
    PENDING_FILTER_SUMMARY = null;
    if (INDEX_STATUS_TIMER) {
      try { clearTimeout(INDEX_STATUS_TIMER); } catch {}
      INDEX_STATUS_TIMER = null;
    }
    PG_INDEX_LOADING = false;
    resetDownloadQueueState({ clearFailures: true });
    const fPages = $('#fPages'); if (fPages) fPages.value = '';
    const fPosts = $('#fPosts'); if (fPosts) fPosts.value = '';
    const fFiles = $('#fFiles'); if (fFiles) fFiles.value = '';
    const fDur = $('#fDur'); if (fDur) fDur.value = '';
    $$('article.post-card').forEach(c => { c.style.display = ''; });
    document.querySelectorAll('.post-number-badge').forEach(el => el.remove());
    syncFilterBoxVisibility();
    scheduleHUD();
    loadGroupsForProfile(null);
    renderGroupsUi();
    if (MENU_OPEN && MENU_ACTIVE_TAB === 'info') ensureInfoUi();
    return false;
  }
  if (CURRENT_PROFILE_KEY && CURRENT_PROFILE_KEY !== key) {
    resetDownloadQueueState({ clearFailures: true });
    PG_POSTS = null;
    PG_ID_MAP = null;
    PG_TOTAL = null;
    PG_GW = 1;
    PG_FILE_TOTAL = null;
    PG_FILE_URL_MAP = null;
    PG_POST_FILE_RANGE_MAP = null;
    keptPosts = [];
    lastFilterParams = {};
    LAST_POST_CLICK = null;
    PENDING_FILTER_SUMMARY = null;
  }
  CURRENT_PROFILE_KEY = key;
  loadGroupsForProfile(key);
  renderGroupsUi();
  if (MENU_OPEN && MENU_ACTIVE_TAB === 'info') ensureInfoUi();
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
      handlePostNumberClick(badge, e);
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

function handlePostNumberClick(el, ev) {
  if (!el) return;
  const numStr = el.dataset.postNumber || (el.textContent || '').trim();
  if (!numStr) return;
  if (!/^\d+$/.test(numStr)) return;
  const num = Number(numStr);
  if (!num) return;
  const input = document.getElementById('fPosts');
  if (!input) return;
  const set = getPostFilterSet();
  const useRange = !!(ev && ev.shiftKey && Number.isInteger(LAST_POST_CLICK) && LAST_POST_CLICK > 0);
  if (useRange) {
    const a = LAST_POST_CLICK;
    const b = num;
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    for (let i = min; i <= max; i++) set.add(i);
    input.value = formatIndexRanges(set);
    LAST_POST_CLICK = num;
    injectPostNumbers();
    syncPageAllButtonState();
    scheduleFilter();
    return;
  }
  if (set.has(num)) {
    set.delete(num);
    el.classList.remove('active');
  } else {
    set.add(num);
    el.classList.add('active');
  }
  LAST_POST_CLICK = num;
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
  setHudItemVisible('downloadPostLinksBtn', opt.showDownloadPostLinksBtn === true);
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

function getDownloadModeLabel(mode) {
  return DOWNLOAD_MODE_LABELS[mode] || mode || 'Download Mode';
}

function syncDownloadModeSelect() {
  const el = document.getElementById('pg_opt_downloadMode');
  if (!el) return;
  const mode = DOWNLOAD_MODE || (PG_OPTIONS && PG_OPTIONS.downloadMode) || DEFAULT_OPTIONS.downloadMode;
  if (DOWNLOAD_MODE_LABELS[mode]) el.value = mode;
}

function syncSpecialDownloadBehaviorSelect() {
  const modeEl = document.getElementById('pg_opt_specialDownloadBehavior');
  if (modeEl && SPECIAL_DOWNLOAD_BEHAVIOR_LABELS[SPECIAL_DOWNLOAD_BEHAVIOR]) {
    modeEl.value = SPECIAL_DOWNLOAD_BEHAVIOR;
  }
  const valueEl = document.getElementById('pg_opt_specialDownloadValue');
  if (valueEl) {
    valueEl.value = String(SPECIAL_DOWNLOAD_VALUE);
    const disabled = SPECIAL_DOWNLOAD_BEHAVIOR === 'off';
    valueEl.disabled = disabled;
    valueEl.title = disabled ? 'Enable a special behavior to use X.' : '';
  }
}

function setDownloadMode(nextMode) {
  if (!DOWNLOAD_MODE_LABELS[nextMode]) return;
  PG_OPTIONS.downloadMode = nextMode;
  saveOptions();
  setOptionsStatus('Saved');
  applyOptions();
  syncDownloadModeSelect();
}

function applyOptions() {
  const opt = PG_OPTIONS || DEFAULT_OPTIONS;
  const prevDuration = DURATION_FEATURE_ENABLED;
  DOWNLOAD_MODE = (opt.downloadMode && DOWNLOAD_MODE_LABELS[opt.downloadMode]) ? opt.downloadMode : DEFAULT_OPTIONS.downloadMode;
  SPECIAL_DOWNLOAD_BEHAVIOR = (opt.specialDownloadBehavior && SPECIAL_DOWNLOAD_BEHAVIOR_LABELS[opt.specialDownloadBehavior])
    ? opt.specialDownloadBehavior
    : DEFAULT_OPTIONS.specialDownloadBehavior;
  SPECIAL_DOWNLOAD_VALUE = clampInt(
    opt.specialDownloadValue,
    1,
    999,
    DEFAULT_OPTIONS.specialDownloadValue
  );
  DURATION_FEATURE_ENABLED = !!opt.durationIndexing;
  GALLERY_PRELOAD_ALL_MEDIA = !!opt.galleryPreloadAll;
  PARALLEL_DOWNLOAD_LIMIT = clampInt(opt.parallelDownloadLimit, 1, 10, DEFAULT_OPTIONS.parallelDownloadLimit);
  VIDEO_DURATION_PROBE_CONCURRENCY = clampInt(
    opt.videoDurationProbeConcurrency,
    1,
    10,
    DEFAULT_OPTIONS.videoDurationProbeConcurrency
  );
  TIMEOUT_RETRIES_ENABLED = opt.timeoutRetries !== false;
  STOP_BUTTON_CLEARS_QUEUE = opt.stopClearsQueue !== false;
  SHOW_PROGRESS_BAR = opt.showProgressBar !== false;
  SHOW_GROUPS_SECTION = opt.showGroupsSection !== false;

  syncHudElementVisibility();
  syncDurationInputVisibility();
  syncProgressBarVisibility();
  syncDownloadModeSelect();
  syncSpecialDownloadBehaviorSelect();
  if (document.getElementById('pgMenuDownloadsBody')) {
    renderDownloadsUi();
  }

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

  const makeSelectRow = (title, hint, id, options, value, labels) => {
    const items = options.map(optVal => {
      const label = (labels && labels[optVal]) || optVal;
      return `<option value="${optVal}"${optVal === value ? ' selected' : ''}>${label}</option>`;
    }).join('');
    return `
      <div class="pg-opt-row">
        <div class="pg-opt-left">
          <div class="pg-opt-title">${title}</div>
          <div class="pg-opt-hint">${hint}</div>
        </div>
        <div class="pg-opt-right">
          <select id="${id}">${items}</select>
        </div>
      </div>
    `;
  };

  const makeCheckRow = (title, hint, id, checked) => {
    const hintHtml = hint ? `<div class="pg-opt-hint">${hint}</div>` : '';
    return `
      <div class="pg-opt-row">
        <div class="pg-opt-left">
          <div class="pg-opt-title">${title}</div>
          ${hintHtml}
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

  const makeCheckInline = (label, id, checked) => {
    return `
      <label class="pg-opt-check">
        <input id="${id}" type="checkbox"${checked ? ' checked' : ''}>
        <span>${label}</span>
      </label>
    `;
  };

  body.innerHTML = `
    <div class="pg-options-note">Options are saved locally in your browser for this site.</div>

    <div class="pg-opt-section">
      <div class="pg-opt-section-title">Downloads</div>
      ${makeSelectRow('Download Mode', 'Archive by post/queue or loose files by post/queue.', 'pg_opt_downloadMode', DOWNLOAD_MODE_VALUES, opt.downloadMode || DEFAULT_OPTIONS.downloadMode, DOWNLOAD_MODE_LABELS)}
      ${makeSelectRow('Special Download Behavior', 'Optional vertical-slice behavior for oversized profiles/posts.', 'pg_opt_specialDownloadBehavior', SPECIAL_DOWNLOAD_BEHAVIOR_VALUES, opt.specialDownloadBehavior || DEFAULT_OPTIONS.specialDownloadBehavior, SPECIAL_DOWNLOAD_BEHAVIOR_LABELS)}
      ${makeNumberRow('Special Behavior Value (X)', 'Used by the selected special behavior. Example: Smattering uses 1/X files per post.', 'pg_opt_specialDownloadValue', opt.specialDownloadValue, 1, 999)}
      ${makeCheckRow('Video duration indexing', 'Enable duration filters and video duration indexing.', 'pg_opt_durationIndexing', !!opt.durationIndexing)}
      ${makeCheckRow('Gallery preloading', 'Preload filtered media before opening the gallery.', 'pg_opt_galleryPreloadAll', !!opt.galleryPreloadAll)}
      ${makeNumberRow('Parallel download limit', 'Maximum simultaneous downloads.', 'pg_opt_parallelDownloadLimit', opt.parallelDownloadLimit, 1, 10)}
      ${makeNumberRow('Video index concurrency', 'Maximum simultaneous video metadata probes.', 'pg_opt_videoDurationProbeConcurrency', opt.videoDurationProbeConcurrency, 1, 10)}
      ${makeCheckRow('Retry on stall/timeout', 'When a download stalls or takes too long, abort and retry (default on).', 'pg_opt_timeoutRetries', opt.timeoutRetries !== false)}
      ${makeCheckRow('Stop button clears queue', 'When stopping downloads, clear the queue (default on).', 'pg_opt_stopClearsQueue', opt.stopClearsQueue !== false)}
    </div>

    <div class="pg-opt-section">
      <div class="pg-opt-section-title">HUD</div>
      <div class="pg-opt-block">
        ${makeCheckInline('Local Gallery', 'pg_opt_showLocalGalleryBtn', opt.showLocalGalleryBtn !== false)}
        ${makeCheckInline('Download Post Links', 'pg_opt_showDownloadPostLinksBtn', opt.showDownloadPostLinksBtn === true)}
        ${makeCheckInline('Gallery', 'pg_opt_showGalleryBtn', opt.showGalleryBtn !== false)}
        ${makeCheckInline('Page', 'pg_opt_showPageBtn', opt.showPageBtn !== false)}
        ${makeCheckInline('Media Filter', 'pg_opt_showMediaBtn', opt.showMediaBtn !== false)}
        ${makeCheckInline('Preview', 'pg_opt_showPreviewBtn', opt.showPreviewBtn !== false)}
        ${makeCheckInline('Page input', 'pg_opt_showPageInput', opt.showPageInput !== false)}
        ${makeCheckInline('Post input', 'pg_opt_showPostInput', opt.showPostInput !== false)}
        ${makeCheckInline('File input', 'pg_opt_showFileInput', opt.showFileInput !== false)}
        ${makeCheckInline('Progress bar', 'pg_opt_showProgressBar', opt.showProgressBar !== false)}
        ${makeCheckInline('Groups section', 'pg_opt_showGroupsSection', opt.showGroupsSection !== false)}
      </div>
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

  const bindNumber = (id, key, min, max, onChange, fallback) => {
    const el = document.getElementById(id);
    if (!el) return;
    const applyValue = () => {
      const fb = (fallback != null)
        ? fallback
        : ((DEFAULT_OPTIONS[key] != null) ? DEFAULT_OPTIONS[key] : min);
      const next = clampInt(el.value, min, max, fb);
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

  const bindSelect = (id, key, labels, onChange) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const next = String(el.value || '').trim();
      if (labels && labels[next]) {
        PG_OPTIONS[key] = next;
        saveOptions();
        setOptionsStatus('Saved');
        applyOptions();
        if (typeof onChange === 'function') onChange(next);
      }
    });
  };

  bindSelect('pg_opt_downloadMode', 'downloadMode', DOWNLOAD_MODE_LABELS);
  bindSelect('pg_opt_specialDownloadBehavior', 'specialDownloadBehavior', SPECIAL_DOWNLOAD_BEHAVIOR_LABELS);
  bindNumber('pg_opt_specialDownloadValue', 'specialDownloadValue', 1, 999, null, DEFAULT_OPTIONS.specialDownloadValue);
  bindCheck('pg_opt_durationIndexing', 'durationIndexing');
  bindCheck('pg_opt_galleryPreloadAll', 'galleryPreloadAll');
  bindNumber('pg_opt_parallelDownloadLimit', 'parallelDownloadLimit', 1, 10, () => {
    if (dl.started) requestDispatch();
  }, DEFAULT_OPTIONS.parallelDownloadLimit);
  bindNumber('pg_opt_videoDurationProbeConcurrency', 'videoDurationProbeConcurrency', 1, 10, null, DEFAULT_OPTIONS.videoDurationProbeConcurrency);
  bindCheck('pg_opt_timeoutRetries', 'timeoutRetries');
  bindCheck('pg_opt_stopClearsQueue', 'stopClearsQueue');
  bindCheck('pg_opt_showLocalGalleryBtn', 'showLocalGalleryBtn');
  bindCheck('pg_opt_showDownloadPostLinksBtn', 'showDownloadPostLinksBtn');
  bindCheck('pg_opt_showGalleryBtn', 'showGalleryBtn');
  bindCheck('pg_opt_showPageBtn', 'showPageBtn');
  bindCheck('pg_opt_showMediaBtn', 'showMediaBtn');
  bindCheck('pg_opt_showPreviewBtn', 'showPreviewBtn');
  bindCheck('pg_opt_showPageInput', 'showPageInput');
  bindCheck('pg_opt_showPostInput', 'showPostInput');
  bindCheck('pg_opt_showFileInput', 'showFileInput');
  bindCheck('pg_opt_showProgressBar', 'showProgressBar');
  bindCheck('pg_opt_showGroupsSection', 'showGroupsSection');
  syncSpecialDownloadBehaviorSelect();
}

function formatGroupDate(ts) {
  if (!ts || typeof ts !== 'number') return '';
  const d = new Date(ts);
  if (!isFinite(d.getTime())) return '';
  return 'Created ' + d.toISOString().split('T')[0];
}

function renderGroupsUi() {
  const body = document.getElementById('pgMenuGroupsBody');
  if (!body) return;
  const profileKey = getProfileKeyFromLocation();
  const hasProfile = !!profileKey;
  const groups = hasProfile ? loadGroupsForProfile(profileKey) : [];
  const note = hasProfile
    ? '<div class="pg-options-note">Groups are saved per profile. Use Create Group to add one.</div>'
    : '<div class="pg-options-note">No profile detected.</div>';

  const actions = `
    <div class="pg-group-actions">
      <button type="button" id="pgGroupsCreateBtn"${hasProfile ? '' : ' disabled'}>Create Group</button>
      <button type="button" id="pgGroupsClearBtn"${hasProfile ? '' : ' disabled'}>Delete All Groups</button>
      <button type="button" id="pgGroupsDownloadAllBtn"${groups.length ? '' : ' disabled'}>Download All</button>
    </div>
  `;

  const rows = groups.map(group => {
    const name = group.name || group.earliestPostFolder || 'group';
    const created = formatGroupDate(group.createdAt);
    const posts = typeof group.postCount === 'number' ? group.postCount : 0;
    const files = typeof group.fileCount === 'number' ? group.fileCount : (group.files ? group.files.length : 0);
    const meta = `${posts} posts • ${files} files${created ? ' • ' + created : ''}`;
    return `
      <div class="pg-opt-row pg-group-row">
        <div class="pg-opt-left">
          <div class="pg-opt-title">${name}</div>
          <div class="pg-opt-hint">${meta}</div>
        </div>
        <div class="pg-opt-right">
          <button type="button" class="pg-group-download-btn" data-group-id="${group.id}">Download</button>
          <button type="button" class="pg-group-delete-btn" data-group-id="${group.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  const empty = !groups.length ? '<div class="pg-options-note">No groups created.</div>' : '';
  body.innerHTML = actions + note + empty + rows;

  const createBtn = document.getElementById('pgGroupsCreateBtn');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      if (hasProfile) handleCreateGroup();
    });
  }

  const clearBtn = document.getElementById('pgGroupsClearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (hasProfile) handleClearGroups();
    });
  }

  const dlAllBtn = document.getElementById('pgGroupsDownloadAllBtn');
  if (dlAllBtn) {
    dlAllBtn.addEventListener('click', () => {
      if (groups.length) queueAllGroupDownloads(groups);
    });
  }

  body.querySelectorAll('.pg-group-download-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.dataset.groupId || '';
      const group = groups.find(g => g && g.id === groupId);
      if (group) queueGroupDownload(group);
    });
  });

  body.querySelectorAll('.pg-group-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = btn.dataset.groupId || '';
      deleteGroupById(groupId);
    });
  });
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

function renderDownloadsUi() {
  const body = document.getElementById('pgMenuDownloadsBody');
  if (!body) return;
  const hud = document.getElementById('partyHUD');
  body.innerHTML = '';
  if (hud) {
    body.appendChild(hud);
  }
  if (SHOW_GROUPS_SECTION) {
    const groupsWrap = document.createElement('div');
    groupsWrap.className = 'pg-hud-section';
    groupsWrap.innerHTML = `
      <div class="pg-hud-title">Groups</div>
      <div id="pgMenuGroupsBody"></div>
    `;
    body.appendChild(groupsWrap);
    renderGroupsUi();
  }
}

function ensureDownloadsUi() {
  renderDownloadsUi();
  syncHudElementVisibility();
  syncDurationInputVisibility();
  syncProgressBarVisibility();
  restoreMenuTabScroll('downloads');
}

function ensureQueueUi() {
  renderQueueUi();
  restoreMenuTabScroll('queue');
}

function ensureInfoUi() {
  const body = document.getElementById('pgMenuInfoBody');
  if (!body) return;
  const token = ++INFO_RENDER_TOKEN;
  body.innerHTML = '<div class="pg-options-note">Loading profile info...</div>';
  restoreMenuTabScroll('info');
  buildProfileInfoSnapshot().then(snapshot => {
    if (token !== INFO_RENDER_TOKEN) return;
    if (!document.getElementById('pgMenuInfoBody')) return;
    if (!snapshot || snapshot.error) {
      body.innerHTML = `<div class="pg-options-note">${snapshot && snapshot.error ? snapshot.error : 'Unable to load profile info.'}</div>`;
      restoreMenuTabScroll('info');
      return;
    }

    body.innerHTML = `
      <div class="pg-opt-section">
        <div class="pg-opt-section-title">Document Preview</div>
        <pre class="pg-info-preview" id="pgInfoPreview"></pre>
      </div>
      <div class="pg-group-actions">
        <button type="button" id="pgInfoDownloadBtn">Download</button>
      </div>
    `;
    const preview = document.getElementById('pgInfoPreview');
    if (preview) preview.textContent = snapshot.lines.join('\n');
    const downloadBtn = document.getElementById('pgInfoDownloadBtn');
    if (downloadBtn) downloadBtn.addEventListener('click', () => handleDownloadInfo());
    restoreMenuTabScroll('info');
  }).catch(() => {
    if (token !== INFO_RENDER_TOKEN) return;
    if (!document.getElementById('pgMenuInfoBody')) return;
    body.innerHTML = '<div class="pg-options-note">Unable to load profile info.</div>';
    restoreMenuTabScroll('info');
  });
}

function ensureErrorLogUi() {
  renderErrorLogUi();
  restoreMenuTabScroll('errors');
}

function setMenuCollapsed(next) {
  const card = document.getElementById('pgMenuCard');
  if (!card) return;
  MENU_COLLAPSED = !!next;
  card.classList.toggle('pg-collapsed', MENU_COLLAPSED);
  const btn = document.getElementById('pgMenuCollapseBtn');
  if (btn) btn.textContent = MENU_COLLAPSED ? '▸' : '▾';
  saveMenuState();
}

function toggleMenuCollapsed() {
  setMenuCollapsed(!MENU_COLLAPSED);
}

function setMenuTab(tabId) {
  const next = MENU_TAB_IDS.includes(tabId) ? tabId : 'options';
  if (MENU_ACTIVE_TAB) saveMenuTabScroll(MENU_ACTIVE_TAB);
  MENU_ACTIVE_TAB = next;
  MENU_LAST_TAB = next;
  saveMenuState();

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

  if (next === 'downloads') {
    ensureDownloadsUi();
    return;
  }
  if (next === 'queue') {
    ensureQueueUi();
    return;
  }
  if (next === 'info') {
    ensureInfoUi();
    return;
  }
  if (next === 'errors') {
    clearErrorTabUnread();
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
  const maxX = Math.max(MENU_DEFAULT_MARGIN, window.innerWidth - width - MENU_DEFAULT_MARGIN);
  const maxY = Math.max(MENU_DEFAULT_MARGIN, window.innerHeight - height - MENU_DEFAULT_MARGIN);
  let x;
  if (typeof desiredX === 'number') x = desiredX;
  else if (typeof MENU_WINDOW_STATE.x === 'number') x = MENU_WINDOW_STATE.x;
  else x = window.innerWidth - width - MENU_DEFAULT_MARGIN;
  let y;
  if (typeof desiredY === 'number') y = desiredY;
  else if (typeof MENU_WINDOW_STATE.y === 'number') y = MENU_WINDOW_STATE.y;
  else y = MENU_DEFAULT_MARGIN;
  x = Math.min(maxX, Math.max(MENU_DEFAULT_MARGIN, x));
  y = Math.min(maxY, Math.max(MENU_DEFAULT_MARGIN, y));
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  MENU_WINDOW_STATE.x = x;
  MENU_WINDOW_STATE.y = y;
  MENU_WINDOW_STATE.width = width;
  MENU_WINDOW_STATE.height = height;
  saveMenuState();
}

function applyMenuWindowState() {
  const card = document.getElementById('pgMenuCard');
  if (!card) return;
  if (MENU_WINDOW_STATE.width) card.style.width = `${MENU_WINDOW_STATE.width}px`;
  else card.style.width = `${MENU_DEFAULT_WIDTH}px`;
  if (MENU_WINDOW_STATE.height) card.style.height = `${MENU_WINDOW_STATE.height}px`;
  else card.style.height = `${MENU_DEFAULT_HEIGHT}px`;
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

function registerMenuResizeHandles(card) {
  if (!card || card.dataset.pgResizeReady) return;
  card.dataset.pgResizeReady = '1';
  const handles = [...card.querySelectorAll('.pg-menu-resize-handle[data-corner]')];
  if (!handles.length) return;

  let resizing = false;
  let resizeCorner = 'se';
  let resizePointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startWidth = 0;
  let startHeight = 0;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const getSizeLimits = () => {
    const cs = getComputedStyle(card);
    const minWidth = Math.max(80, parseFloat(cs.minWidth) || 100);
    const minHeight = Math.max(120, parseFloat(cs.minHeight) || 240);
    const maxWidth = Math.max(minWidth, window.innerWidth - MENU_DEFAULT_MARGIN * 2);
    const maxHeight = Math.max(minHeight, window.innerHeight - MENU_DEFAULT_MARGIN * 2);
    return { minWidth, minHeight, maxWidth, maxHeight };
  };

  const onResizeMove = (ev) => {
    if (!resizing) return;
    ev.preventDefault();

    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const rightEdge = startLeft + startWidth;
    const bottomEdge = startTop + startHeight;
    const limits = getSizeLimits();

    let width = startWidth;
    let height = startHeight;
    let left = startLeft;
    let top = startTop;

    if (resizeCorner.includes('e')) width = startWidth + dx;
    if (resizeCorner.includes('w')) width = startWidth - dx;
    width = clamp(width, limits.minWidth, limits.maxWidth);
    left = resizeCorner.includes('w') ? (rightEdge - width) : startLeft;

    if (resizeCorner.includes('s')) height = startHeight + dy;
    if (resizeCorner.includes('n')) height = startHeight - dy;
    height = clamp(height, limits.minHeight, limits.maxHeight);
    top = resizeCorner.includes('n') ? (bottomEdge - height) : startTop;

    const maxLeft = Math.max(MENU_DEFAULT_MARGIN, window.innerWidth - MENU_DEFAULT_MARGIN - width);
    const maxTop = Math.max(MENU_DEFAULT_MARGIN, window.innerHeight - MENU_DEFAULT_MARGIN - height);
    left = clamp(left, MENU_DEFAULT_MARGIN, maxLeft);
    top = clamp(top, MENU_DEFAULT_MARGIN, maxTop);

    card.style.width = `${width}px`;
    card.style.height = `${height}px`;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    MENU_WINDOW_STATE.width = width;
    MENU_WINDOW_STATE.height = height;
    MENU_WINDOW_STATE.x = left;
    MENU_WINDOW_STATE.y = top;
  };

  const stopResize = () => {
    if (!resizing) return;
    resizing = false;
    document.removeEventListener('pointermove', onResizeMove);
    document.removeEventListener('pointerup', stopResize);
    document.removeEventListener('pointercancel', stopResize);
    const activeHandle = handles.find(h => String(h.dataset.corner || '') === resizeCorner);
    if (activeHandle && resizePointerId !== null) {
      try { activeHandle.releasePointerCapture(resizePointerId); } catch {}
    }
    resizePointerId = null;
    saveMenuState();
  };

  handles.forEach(handle => {
    handle.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const rect = card.getBoundingClientRect();
      resizing = true;
      resizeCorner = String(handle.dataset.corner || 'se');
      resizePointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      startWidth = rect.width;
      startHeight = rect.height;
      try { handle.setPointerCapture(resizePointerId); } catch {}
      document.addEventListener('pointermove', onResizeMove);
      document.addEventListener('pointerup', stopResize);
      document.addEventListener('pointercancel', stopResize);
    });
  });
}

function initMenuTabs() {
  const tabs = document.getElementById('pgMenuTabs');
  MENU_TAB_BUTTONS = tabs ? [...tabs.querySelectorAll('.pgMenuTabBtn')] : [];
  MENU_TAB_PANELS = {
    downloads: document.getElementById('pgMenuTabDownloads'),
    queue: document.getElementById('pgMenuTabQueue'),
    info: document.getElementById('pgMenuTabInfo'),
    options: document.getElementById('pgMenuTabOptions'),
    errors: document.getElementById('pgMenuTabErrors')
  };
  MENU_SCROLL_TARGETS = {
    downloads: document.getElementById('pgMenuDownloadsBody'),
    queue: document.getElementById('pgMenuQueueBody'),
    info: document.getElementById('pgMenuInfoBody'),
    options: document.getElementById('pgMenuOptionsBody'),
    errors: document.getElementById('pgMenuErrorBody')
  };
  MENU_TAB_BUTTONS.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab || 'options';
      setMenuTab(tab);
    });
  });
  updateErrorTabBadge();
}

function buildMenu() {
  if (document.getElementById('pgMenuOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'pgMenuOverlay';
  overlay.innerHTML = `
    <div id="pgMenuCard" role="dialog" aria-modal="true" aria-label="PartyGuest">
      <div id="pgMenuHeader">
        <div class="title">PartyGuest</div>
        <div id="pgMenuTabs" role="tablist" aria-label="Menu tabs">
          <button type="button" class="pgMenuTabBtn" data-tab="downloads" role="tab" aria-controls="pgMenuTabDownloads">Downloads</button>
          <button type="button" class="pgMenuTabBtn" data-tab="queue" role="tab" aria-controls="pgMenuTabQueue">Queue</button>
          <button type="button" class="pgMenuTabBtn" data-tab="info" role="tab" aria-controls="pgMenuTabInfo">Info</button>
          <button type="button" class="pgMenuTabBtn" data-tab="options" role="tab" aria-controls="pgMenuTabOptions">Options</button>
          <button type="button" class="pgMenuTabBtn" data-tab="errors" role="tab" aria-controls="pgMenuTabErrors">Error Log</button>
        </div>
        <button id="pgMenuCollapseBtn" type="button" aria-label="Collapse menu">▾</button>
      </div>
      <div id="pgMenuBody">
        <section id="pgMenuTabDownloads" class="pgMenuTabPanel" data-tab="downloads" role="tabpanel">
          <div id="pgMenuDownloadsBody"></div>
        </section>
        <section id="pgMenuTabQueue" class="pgMenuTabPanel" data-tab="queue" role="tabpanel">
          <div id="pgMenuQueueBody"></div>
        </section>
        <section id="pgMenuTabInfo" class="pgMenuTabPanel" data-tab="info" role="tabpanel">
          <div id="pgMenuInfoBody"></div>
        </section>
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
        <section id="pgMenuTabErrors" class="pgMenuTabPanel" data-tab="errors" role="tabpanel">
          <div id="pgMenuErrorBody"></div>
        </section>
      </div>
      <div class="pg-menu-resize-handle pg-menu-resize-nw" data-corner="nw" aria-hidden="true"></div>
      <div class="pg-menu-resize-handle pg-menu-resize-ne" data-corner="ne" aria-hidden="true"></div>
      <div class="pg-menu-resize-handle pg-menu-resize-sw" data-corner="sw" aria-hidden="true"></div>
      <div class="pg-menu-resize-handle pg-menu-resize-se" data-corner="se" aria-hidden="true"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const collapseBtn = document.getElementById('pgMenuCollapseBtn');
  if (collapseBtn) collapseBtn.addEventListener('click', () => toggleMenuCollapsed());

  const doneBtn = document.getElementById('pgOptionsDoneBtn');
  if (doneBtn) doneBtn.addEventListener('click', () => setMenuCollapsed(true));

  const resetBtn = document.getElementById('pgOptionsResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => resetOptionsToDefaults());

  const menuCard = document.getElementById('pgMenuCard');
  const menuHeader = document.getElementById('pgMenuHeader');
  registerMenuWindow(menuCard, menuHeader);
  registerMenuResizeHandles(menuCard);
  initMenuTabs();
  if (document.getElementById('partyHUD')) {
    ensureDownloadsUi();
  }

  if (menuCard && !menuCard.dataset.pgScrollGuard) {
    menuCard.dataset.pgScrollGuard = '1';
    const scrollSelector = '#pgMenuDownloadsBody, #pgMenuQueueBody, #pgMenuInfoBody, #pgMenuOptionsBody, #pgMenuErrorBody';
    const findScroller = target => {
      if (!target || !target.closest) return null;
      return target.closest(scrollSelector);
    };
    const shouldBlockScroll = (scroller, deltaY) => {
      if (!scroller) return true;
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      if (maxScroll <= 0) return true;
      if (deltaY < 0 && scroller.scrollTop <= 0) return true;
      if (deltaY > 0 && scroller.scrollTop >= maxScroll - 1) return true;
      return false;
    };
    menuCard.addEventListener('wheel', (ev) => {
      const scroller = findScroller(ev.target);
      if (shouldBlockScroll(scroller, ev.deltaY || 0)) {
        ev.preventDefault();
      }
      ev.stopPropagation();
    }, { passive: false });

    let lastTouchY = null;
    menuCard.addEventListener('touchstart', (ev) => {
      if (ev.touches && ev.touches.length) {
        lastTouchY = ev.touches[0].clientY;
      }
    }, { passive: true });
    menuCard.addEventListener('touchmove', (ev) => {
      if (!ev.touches || !ev.touches.length || lastTouchY == null) return;
      const y = ev.touches[0].clientY;
      const deltaY = lastTouchY - y;
      lastTouchY = y;
      const scroller = findScroller(ev.target);
      if (shouldBlockScroll(scroller, deltaY)) {
        ev.preventDefault();
      }
      ev.stopPropagation();
    }, { passive: false });
    menuCard.addEventListener('touchend', () => { lastTouchY = null; }, { passive: true });
    menuCard.addEventListener('touchcancel', () => { lastTouchY = null; }, { passive: true });
  }

  document.addEventListener('keydown', (e) => {
    if (!MENU_OPEN) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      toggleMenuCollapsed();
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
  setMenuCollapsed(MENU_COLLAPSED);
  const next = MENU_TAB_IDS.includes(tabId)
    ? tabId
    : (MENU_TAB_IDS.includes(MENU_LAST_TAB) ? MENU_LAST_TAB : 'downloads');
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
    <div class="pg-hud-section">
      <div class="pg-hud-title">Status</div>
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
    </div>
    <div class="pg-hud-section">
      <div class="pg-hud-title">Controls</div>
      <div id="hudRow" class="hud-row">
        <button id="dlBtn" class="full">Download</button>
        <button id="downloadPostLinksBtn" class="full">Download Post Links</button>
        <button id="galleryBtn" class="full">Gallery</button>
        <button id="localGalleryBtn" class="full">Local Gallery</button>
        <button id="filterBtn" class="full">Preview</button>
      </div>
    </div>
    <div class="pg-hud-section">
      <div class="pg-hud-title">Filters</div>
      <div id="hudFilters" class="hud-filters">
        <button id="btnMedia" class="full">All</button>
        <button id="btnPageAll">Page</button>
        <button id="clearFiltersBtn">Clear Filters</button>
        <input id="fPages" type="text" placeholder="Page">
        <input id="fPosts" type="text" placeholder="Post">
        <input id="fFiles" type="text" placeholder="File">
        <input id="fDur" type="text" placeholder="Duration">
      </div>
    </div>
  `;
  document.body.appendChild(w);

  $('#dlBtn').onclick = handleDlBtn;

  const downloadPostLinksBtn = $('#downloadPostLinksBtn');
  if (downloadPostLinksBtn) downloadPostLinksBtn.onclick = handleDownloadPostLinks;

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
  const clearFiltersBtn = $('#clearFiltersBtn');
  if (clearFiltersBtn) clearFiltersBtn.onclick = handleClearFilters;

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
  if (document.getElementById('pgMenuDownloadsBody')) {
    ensureDownloadsUi();
  }

  if (handleProfileContextChange()) {
    scheduleFilter();
  }
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
  const clean = parts.map((seg, idx) => {
    return sanitizeFileNameStrict(seg, idx === parts.length - 1 ? fallbackLeaf : 'folder');
  });
  return clean.join('/');
}

function getUrlExt(u) {
  const raw = normalizeDownloadUrl(u);
  if (!raw) return '';
  try {
    const url = new URL(raw, location.origin);
    const path = url.pathname || '';
    const dot = path.lastIndexOf('.');
    if (dot >= 0 && dot < path.length - 1) {
      const ext = path.slice(dot + 1).toLowerCase();
      return ext.replace(/[^a-z0-9]+/gi, '');
    }
    const f = url.searchParams.get('f');
    if (f) {
      const fDot = f.lastIndexOf('.');
      if (fDot >= 0 && fDot < f.length - 1) {
        const ext = f.slice(fDot + 1).toLowerCase();
        return ext.replace(/[^a-z0-9]+/gi, '');
      }
    }
  } catch {}
  return '';
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

function getPostIdFromUrl(url) {
  try {
    const u = new URL(url || location.href, location.origin);
    const m = u.pathname.match(/\/post\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function extractPostPageMeta(doc, postUrl) {
  const titleEl = doc.querySelector('.post__title, .scrape__title');
  const titleNode = titleEl ? (titleEl.querySelector('span') || titleEl) : null;
  const title = titleNode ? (titleNode.textContent || '').trim() : '';
  const userEl = doc.querySelector('.post__user-name, .scrape__user-name, .user-header__name');
  const user = userEl ? (userEl.textContent || '').trim() : userName();
  const pubEl = doc.querySelector('.post__published, .scrape__published, .post__date');
  let published = null;
  if (pubEl) {
    const copy = pubEl.cloneNode(true);
    if (copy.firstElementChild) copy.firstElementChild.remove();
    const text = (copy.textContent || '').trim();
    if (text) published = text;
  }
  const id = getPostIdFromUrl(postUrl || location.href);
  return { id, user, title, published };
}

function extractPostPageFileUrls(doc, allowAll) {
  const out = [];
  const seen = new Set();
  const nodes = doc.querySelectorAll(
    '.post__files a, .post__files img, .post__files video, .post__files source, ' +
    '.scrape__files a, .scrape__files img, .scrape__files video, .scrape__files source, ' +
    '.post__attachments a, .scrape__attachments a, a.post__attachment-link'
  );
  nodes.forEach(node => {
    let url = '';
    if (node.tagName === 'A') url = node.getAttribute('href') || '';
    if (!url && node.closest) {
      const a = node.closest('a');
      if (a) url = a.getAttribute('href') || '';
    }
    if (!url) {
      url = node.getAttribute('src')
        || node.getAttribute('data-src')
        || node.getAttribute('data-lazy-src')
        || node.getAttribute('data-original')
        || node.getAttribute('data-full')
        || '';
    }
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return;
    let abs = '';
    try { abs = new URL(url, location.origin).href; } catch { return; }
    abs = normalizeDownloadUrl(abs);
    if (!allowAll && !allowedUrl(abs)) return;
    const key = normalizeFileUrl(abs) || abs;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(abs);
  });
  return out;
}

function resolveFileUrl(obj) {
  if (!obj) return null;
  if (obj.path) {
    const raw = String(obj.path || '').trim();
    if (/^https?:\/\//i.test(raw)) return normalizeDownloadUrl(raw);
    if (raw.startsWith('//')) return location.protocol + raw;
    if (raw.startsWith('/data/')) return location.origin + raw;
    if (raw.startsWith('data/')) return location.origin + '/' + raw;
    if (raw.startsWith('/')) return location.origin + raw;
    return normalizeDownloadUrl(dataRoot + '/' + raw);
  }
  if (obj.url) {
    const rawUrl = String(obj.url || '').trim();
    if (/^https?:\/\//i.test(rawUrl)) return normalizeDownloadUrl(rawUrl);
    if (rawUrl.startsWith('//')) return location.protocol + rawUrl;
  }
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

function makeDurationUrlKey(url) {
  if (!url) return '';
  return normalizeFileUrl(url) || normalizeDownloadUrl(url) || String(url);
}

function getVideoDuration(u) {
  const src = normalizeDownloadUrl(u);
  const key = makeDurationUrlKey(src);
  if (!key || !src) return Promise.resolve(Infinity);
  return durCache[key] ?? (durCache[key] = new Promise(res => {
    const v = document.createElement('video');
    let settled = false;
    let timeoutId = null;
    const done = d => {
      if (settled) return;
      settled = true;
      if (timeoutId) {
        try { clearTimeout(timeoutId); } catch {}
        timeoutId = null;
      }
      try { v.pause(); } catch {}
      try { v.removeAttribute('src'); } catch {}
      try { v.load(); } catch {}
      try { v.remove(); } catch {}
      res(d);
    };
    v.preload = 'metadata';
    v.crossOrigin = 'anonymous';
    v.onloadedmetadata = () => done(v.duration || Infinity);
    v.onerror = () => done(Infinity);
    timeoutId = setTimeout(() => done(Infinity), VIDEO_DURATION_REQUEST_TIMEOUT_MS);
    v.src = src;
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

function getDownloadSummaryUnit() {
  if (DOWNLOAD_MODE === 'post') return 'posts';
  if (DOWNLOAD_MODE === 'queue_flat') return 'queues';
  return 'files';
}

let uiScheduled = false;
let lastDropNoteAt = 0;
let lastDropNoteCount = 0;

function updateHUD() {
  if (!uiScheduled) return;
  uiScheduled = false;

  const { total, completed, downloading, queued } = getCounts();
  const failed = FAILED_ITEMS.length;
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
    const unit = getDownloadSummaryUnit();
    dlSummaryEl.textContent = `${totalItems} ${unit} total • ${queued} Queued • ${downloading} Downloading • ${completed} Completed • ${failed} Failed • ${retries} Retries`;
  }

  syncFilterBoxVisibility();
  syncProgressBarVisibility();
  renderQueueUi();
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
    const archiveMode = obj.archiveMode || '';
    const queuePostFolder = obj.queuePostFolder || '';
    const groupPostFolder = obj.groupPostFolder || '';
    toAdd.push({ url, name, meta, status: 'queued', attempts: 0, nextAt: 0 });
    if (files) {
      const it = toAdd[toAdd.length - 1];
      it.files = files;
      it.userFolder = userFolder;
      it.postFolder = postFolder;
      it.retryKey = retryKey;
      it.archiveMode = archiveMode;
      it.queuePostFolder = queuePostFolder;
      it.groupPostFolder = groupPostFolder;
    }
  }
  if (!toAdd.length) return;
  dl.items.push(...toAdd);
  scheduleHUD();
  if (dl.started) requestDispatch();
}

function startQueueIfIdle() {
  if (DL_ACTIVE) {
    scheduleHUD();
    return;
  }
  DL_ACTIVE = true;
  dl.started = true;
  const b = $('#dlBtn');
  if (b) {
    b.classList.add('stop');
    b.textContent = 'Stop';
  }
  requestDispatch();
  scheduleHUD();
}

function buildQueueArchiveItem(files, userFolder, queueFolder, retryKey, meta, modeOverride) {
  if (!Array.isArray(files) || files.length === 0) return null;
  let mode = modeOverride || DOWNLOAD_MODE || DEFAULT_OPTIONS.downloadMode;
  if (mode === 'post') mode = 'queue_flat';
  if (mode === 'loose_post' || mode === 'loose_queue') mode = 'queue_flat';
  const queueFolderSafe = queueFolder || 'post';
  const archiveName = buildArchiveName(userFolder, queueFolderSafe);
  return {
    url: files[0].url,
    name: archiveName,
    meta: meta || null,
    files,
    userFolder: userFolder || '',
    postFolder: '',
    retryKey: retryKey || '',
    archiveMode: mode,
    queuePostFolder: queueFolderSafe
  };
}

function buildGroupQueueItem(group, idx) {
  if (!group || !Array.isArray(group.files) || group.files.length === 0) return null;
  const userFolder = group.userFolder || '';
  const queueFolder = group.earliestPostFolder || group.name || 'post';
  const retryKey = group.id
    ? `group:${group.id}`
    : (userFolder ? `group:${userFolder}:${idx || 0}` : `group:${idx || 0}`);
  return buildQueueArchiveItem(
    group.files,
    userFolder,
    queueFolder,
    retryKey,
    { groupId: group.id || '', name: group.name || queueFolder },
    'queue_flat'
  );
}

function queueGroupDownload(group, idx) {
  const item = buildGroupQueueItem(group, idx);
  if (!item) {
    setStatus('Group has no files to download', 'error');
    return false;
  }
  enqueueItems([item]);
  startQueueIfIdle();
  const label = group.name || group.earliestPostFolder || 'group';
  setStatus(`Queued group: ${label}`, 'success');
  return true;
}

function queueAllGroupDownloads(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return false;
  const items = [];
  groups.forEach((group, idx) => {
    const item = buildGroupQueueItem(group, idx);
    if (item) items.push(item);
  });
  if (!items.length) {
    setStatus('No groups with files to download', 'error');
    return false;
  }
  enqueueItems(items);
  startQueueIfIdle();
  setStatus(`Queued ${items.length} group${items.length === 1 ? '' : 's'}`, 'success');
  return true;
}

function buildPostPageDownloadItems(doc, postUrl) {
  const urls = extractPostPageFileUrls(doc, true);
  if (!urls.length) return { objs: [], count: 0 };
  const meta = extractPostPageMeta(doc, postUrl);
  const postId = meta.id != null ? String(meta.id) : '';
  const gIndex = (PG_ID_MAP && postId && PG_ID_MAP.get(postId)) || (postId ? Number(postId) : 0) || 0;
  const post = {
    id: postId || (gIndex ? String(gIndex) : ''),
    user: meta.user || userName(),
    title: meta.title || (postId ? `post_${postId}` : 'post'),
    published: meta.published || null
  };

  const objs = [];
  urls.forEach((url, idx) => {
    const fileObj = { path: url };
    const rawName = formatFilename(post, fileObj, idx + 1, gIndex);
    const name = rawName || sanitizeDownloadPathForSave(getDownloadLabel({ url }));
    objs.push({ url, name, meta: { post, globalIndex: gIndex } });
  });
  return { objs, count: objs.length };
}

function handlePostPageDownload(doc, postUrl) {
  const res = buildPostPageDownloadItems(doc || document, postUrl || location.href);
  if (!res || !res.objs || res.objs.length === 0) {
    setStatus('No files found on this post', 'error');
    return;
  }
  enqueueItems(res.objs);
  startQueueIfIdle();
  const n = res.count || 0;
  setStatus(`Queued post files (${n} file${n === 1 ? '' : 's'})`, 'success');
}

function maybeFinishBatch() {
  const { downloading, queued } = getCounts();
  if (downloading === 0 && queued === 0) {
    DL_ACTIVE = false;
    dl.started = false;
    const b = $('#dlBtn'); if (b) { b.classList.remove('stop'); b.textContent = 'Download'; }
    renderErrorLogUi();
  }
}

async function fetchBlobNative(url, timeoutMs, handles) {
  const controller = new AbortController();
  const handle = { abort: () => controller.abort() };
  let timer = null;
  const u = normalizeDownloadUrl(url);
  if (handles) handles.add(handle);
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const resp = await fetch(u, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal
    });
    if (!resp || !resp.ok) {
      throw {
        stage: 'fetch-native-http',
        status: resp ? resp.status : 0,
        statusText: resp ? (resp.statusText || '') : '',
        url: u
      };
    }
    const blob = await resp.blob();
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw {
        stage: 'fetch-native-empty',
        details: 'empty blob',
        url: u
      };
    }
    return blob;
  } catch (err) {
    if (err && typeof err === 'object' && err.stage) throw err;
    if (err && err.name === 'AbortError') {
      throw {
        stage: 'fetch-native-timeout',
        error: 'abort',
        message: err.message || 'aborted',
        url: u
      };
    }
    throw {
      stage: 'fetch-native',
      error: err && err.name ? String(err.name) : 'native fetch failed',
      message: err && err.message ? String(err.message) : '',
      url: u
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (handles) handles.delete(handle);
  }
}

function fetchBlobGM(url, onprogress, timeoutMs, handles) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let handle = null;
    const u = normalizeDownloadUrl(url);
    const finalize = (ok, payload) => {
      if (settled) return;
      settled = true;
      if (handles && handle) handles.delete(handle);
      ok ? resolve(payload) : reject(payload);
    };
    handle = GM_xmlhttpRequest({
      method: 'GET',
      url: u,
      responseType: 'blob',
      timeout: timeoutMs || 0,
      onprogress: evt => { if (typeof onprogress === 'function') onprogress(evt); },
      onload: resp => {
        const status = resp && typeof resp.status === 'number' ? resp.status : 0;
        if (status < 200 || status >= 300) {
          finalize(false, {
            stage: 'fetch-gm-http',
            status,
            statusText: resp && resp.statusText ? String(resp.statusText) : '',
            url: u
          });
          return;
        }
        if (resp && resp.response instanceof Blob && resp.response.size > 0) {
          finalize(true, resp.response);
        } else {
          finalize(false, {
            stage: 'fetch-gm-empty',
            status,
            statusText: resp && resp.statusText ? String(resp.statusText) : '',
            details: 'empty blob',
            url: u
          });
        }
      },
      onerror: err => finalize(false, {
        stage: 'fetch-gm-network',
        error: err && err.error ? String(err.error) : 'gm request error',
        message: err && err.message ? String(err.message) : '',
        url: u
      }),
      ontimeout: () => finalize(false, {
        stage: 'fetch-gm-timeout',
        error: 'timeout',
        url: u
      })
    });
    if (handles && handle) handles.add(handle);
  });
}

async function fetchBlob(url, onprogress, timeoutMs, handles) {
  let nativeErr = null;
  try {
    return await fetchBlobNative(url, timeoutMs, handles);
  } catch (err) {
    nativeErr = err;
  }
  try {
    return await fetchBlobGM(url, onprogress, timeoutMs, handles);
  } catch (gmErr) {
    throw {
      stage: 'fetch-failed',
      details: 'native and GM fetch failed',
      url: normalizeDownloadUrl(url),
      native: nativeErr,
      fallback: gmErr
    };
  }
}

function startPostArchiveDownload(item) {
  const name = item.name;
  const files = Array.isArray(item.files) ? item.files : [];
  const totalFiles = files.length;
  const retryKey = getRetryKey(item);
  const archiveMode = item.archiveMode || 'post';
  let settled = false;
  let lastProgressAt = Date.now();
  let tTotal = null;
  let tIdle = null;
  const handles = new Set();
  item._handles = handles;
  item.lastErrorUrl = '';
  clearQueueItemProgress(item);
  setQueueItemProgress(item, {
    pct: 0,
    label: totalFiles ? `Fetching files 0/${totalFiles}` : 'Preparing archive...',
    indeterminate: !totalFiles
  });

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
    if (err && typeof err === 'object' && err.url && isLikelyHttpUrl(err.url)) {
      item.lastErrorUrl = err.url;
    }
    abortHandles();
    clearWatchers();

    const prev = retryMap[retryKey] || 0;
    const n = prev + 1;
    retryMap[retryKey] = n;

    lastDropNoteAt = Date.now();
    lastDropNoteCount++;

    if (n >= MAX_RETRIES) {
      clearQueueItemProgress(item);
      logDownloadError(item, `Retry ceiling reached (${n}/${MAX_RETRIES})`, err);
      logFailedItem(item, reason || 'Download failed', err, n);
      item.status = 'failed';
      const prevTimer = cooldownTimers.get(retryKey);
      if (prevTimer) clearTimeout(prevTimer);
      cooldownTimers.delete(retryKey);
      delete retryMap[retryKey];
      const idx = dl.items.indexOf(item);
      if (idx >= 0) dl.items.splice(idx, 1);
      scheduleHUD();
      maybeFinishBatch();
      setTimeout(requestDispatch, 0);
      return;
    }

    logDownloadError(item, reason || 'Download failed', err);

    const level = Math.min(n, MAX_RETRIES);
    const backoff = BACKOFF_BASE * Math.pow(2, level - 1) + Math.floor(Math.random() * 500);

    item.status = 'queued';
    item.nextAt = Date.now() + backoff;
    setQueueItemProgress(item, {
      pct: 0,
      label: `Retrying in ${Math.ceil(backoff / 1000)}s`,
      indeterminate: true
    });

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
    handleFailure('Archive packer missing', { stage: 'archive-init', error: 'JSZip missing' });
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
    handleFailure('Archive download timeout', { stage: 'archive-timeout' });
  }, totalMs);
  tIdle = setInterval(() => {
    if (!TIMEOUT_RETRIES_ENABLED) return;
    if (Date.now() - lastProgressAt > idleMs) handleFailure('Archive download stalled', { stage: 'archive-stalled' });
  }, 2000);

  (async () => {
    const zip = new JSZip();
    let added = 0;
    let failedFiles = 0;
    const fetchLimit = Math.max(1, Math.min(ARCHIVE_FETCH_CAP, PARALLEL_DOWNLOAD_LIMIT || 1));
    let cursor = 0;
    const downloadOne = async (file) => {
      if (settled) return;
      const url = normalizeDownloadUrl(file && file.url);
      if (!url) return;
      item.lastErrorUrl = url;
      const maxRetries = Math.max(0, MAX_RETRIES);
      const maxAttempts = maxRetries + 1;
      let attempt = 0;
      while (!settled && attempt < maxAttempts) {
        attempt++;
        try {
          lastProgressAt = Date.now();
          const timeoutMs = vidRE.test(url) ? STALL_VID_TOTAL_MS : STALL_IMG_TOTAL_MS;
          const blob = await fetchBlob(url, () => { lastProgressAt = Date.now(); }, timeoutMs, handles);
          if (settled) return;
          const parts = splitDownloadPath(file.name || '');
          let postFolder = parts.postFolder || item.postFolder || '';
          let groupFolder = '';
          if (archiveMode === 'queue') {
            postFolder = parts.postFolder || '';
          } else if (archiveMode === 'queue_flat') {
            postFolder = item.queuePostFolder || parts.postFolder || '';
          } else if (archiveMode === 'group') {
            groupFolder = item.groupPostFolder || '';
            postFolder = parts.postFolder || item.postFolder || '';
          } else if (archiveMode === 'group_flat') {
            groupFolder = item.groupPostFolder || '';
            postFolder = '';
          }
          const fileName = parts.fileName || getDownloadLabel(file);
          const zipPath = `${groupFolder ? `${groupFolder}/` : ''}${postFolder ? `${postFolder}/` : ''}${fileName}`;
          zip.file(zipPath, blob);
          added++;
          if (totalFiles > 0) {
            const fetchPct = Math.round((added / totalFiles) * 70);
            setQueueItemProgress(item, {
              pct: fetchPct,
              label: `Fetching files ${added}/${totalFiles}`,
              indeterminate: false
            });
          }
          return;
        } catch (err) {
          item.lastErrorUrl = url;
          const label = { url, name: file && file.name ? file.name : url };
          if (attempt <= maxRetries) {
            logDownloadError(label, `Archive file fetch retry (${attempt}/${maxRetries})`, err);
            lastDropNoteAt = Date.now();
            lastDropNoteCount++;
            scheduleHUD();
            const level = Math.min(attempt, MAX_RETRIES || 1);
            const backoff = BACKOFF_BASE * Math.pow(2, level - 1) + Math.floor(Math.random() * 500);
            await new Promise(res => setTimeout(res, backoff));
            continue;
          }
          failedFiles++;
          logDownloadError(label, 'Archive file fetch failed', err);
          return;
        }
      }
    };
    const workerCount = Math.min(fetchLimit, files.length || 0);
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push((async () => {
        while (true) {
          if (settled) return;
          const idx = cursor++;
          if (idx >= files.length) return;
          await downloadOne(files[idx]);
        }
      })());
    }
    await Promise.all(workers);

    if (settled) return;
    if (!added) {
      handleFailure('All archive files failed', {
        stage: 'archive-fetch',
        details: `${failedFiles}/${files.length} files failed`
      });
      return;
    }

    if (failedFiles > 0) {
      logDownloadError(item, `Archive partial (${failedFiles} file(s) failed)`, {
        stage: 'archive-partial',
        details: `${added}/${files.length} files included`
      });
    }

    let zipBlob;
    try {
      setQueueItemProgress(item, {
        pct: 70,
        label: 'Building archive 0%',
        indeterminate: false
      });
      zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE' },
        (meta) => {
          const packPctRaw = meta && typeof meta.percent === 'number' ? meta.percent : 0;
          const packPct = Math.max(0, Math.min(100, Math.round(packPctRaw)));
          const stagePct = 70 + Math.round((packPct / 100) * 25);
          setQueueItemProgress(item, {
            pct: stagePct,
            label: `Building archive ${packPct}%`,
            indeterminate: false
          });
        }
      );
    } catch (err) {
      handleFailure('Archive build failed', {
        stage: 'archive-build',
        error: err && err.name ? String(err.name) : 'zip generation failed',
        message: err && err.message ? String(err.message) : ''
      });
      return;
    }
    const zipUrl = URL.createObjectURL(zipBlob);
    const saveName = sanitizeDownloadPathForSave(name || 'archive.zip');
    setQueueItemProgress(item, {
      pct: 95,
      label: 'Saving archive...',
      indeterminate: true
    });
    const handle = GM_download({
      url: zipUrl,
      name: saveName,
      onprogress: (evt) => {
        lastProgressAt = Date.now();
        const loaded = evt && typeof evt.loaded === 'number' ? evt.loaded : 0;
        const total = evt && typeof evt.total === 'number' ? evt.total : 0;
        if (total > 0) {
          const donePct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
          const stagePct = 95 + Math.round((donePct / 100) * 4);
          setQueueItemProgress(item, {
            pct: stagePct,
            label: `Saving archive ${donePct}%`,
            indeterminate: false
          });
        } else {
          setQueueItemProgress(item, {
            pct: 95,
            label: 'Saving archive...',
            indeterminate: true
          });
        }
      },
      onload: () => {
        if (settled) return;
        settled = true;
        clearWatchers();
        try { URL.revokeObjectURL(zipUrl); } catch {}
        setQueueItemProgress(item, { pct: 100, label: 'Done', indeterminate: false });
        item.status = 'done';
        scheduleHUD();
        setTimeout(requestDispatch, SPAWN_DELAY + Math.floor(Math.random() * 200));
        maybeFinishBatch();
      },
      onerror: err => {
        try { URL.revokeObjectURL(zipUrl); } catch {}
        handleFailure('Archive save failed', Object.assign({
          stage: 'archive-save',
          details: saveName
        }, (err && typeof err === 'object') ? err : { error: String(err || 'unknown error') }));
      }
    });
    item._handle = handle;
  })().catch(err => handleFailure('Archive pipeline failed', Object.assign({
    stage: 'archive-pipeline'
  }, (err && typeof err === 'object') ? err : { error: String(err || 'unknown error') })));
}

function buildLooseItemsForPost(kp) {
  const out = [];
  if (!kp || !kp.post || !Array.isArray(kp.allowedFiles) || !kp.allowedFiles.length) return out;
  const { post, allowedFiles, globalIndex } = kp;
  allowedFiles.forEach(fileInfo => {
    if (!fileInfo || !fileInfo.url) return;
    const ref = fileInfo.url;
    const fileObj = { path: ref };
    const rawName = formatFilename(post, fileObj, fileInfo.g, globalIndex);
    const name = rawName || sanitizeDownloadPathForSave(getDownloadLabel({ url: ref }));
    out.push({
      url: ref,
      name,
      meta: { post, globalIndex },
      retryKey: ref
    });
  });
  return out;
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
  clearQueueItemProgress(item);
  setQueueItemProgress(item, {
    pct: 0,
    label: 'Starting download...',
    indeterminate: true
  });

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

    const retryKey = getRetryKey(item);
    const prev = retryMap[retryKey] || 0;
    const n = prev + 1;
    retryMap[retryKey] = n;

    lastDropNoteAt = Date.now();
    lastDropNoteCount++;

    if (n >= MAX_RETRIES) {
      clearQueueItemProgress(item);
      logDownloadError(item, `Retry ceiling reached (${n}/${MAX_RETRIES})`, err);
      logFailedItem(item, reason || 'Download failed', err, n);
      item.status = 'failed';
      const prevTimer = cooldownTimers.get(retryKey);
      if (prevTimer) clearTimeout(prevTimer);
      cooldownTimers.delete(retryKey);
      delete retryMap[retryKey];
      const idx = dl.items.indexOf(item);
      if (idx >= 0) dl.items.splice(idx, 1);
      scheduleHUD();
      maybeFinishBatch();
      setTimeout(requestDispatch, 0);
      return;
    }

    logDownloadError(item, reason || 'Download failed', err);

    const level = Math.min(n, MAX_RETRIES);
    const backoff = BACKOFF_BASE * Math.pow(2, level - 1) + Math.floor(Math.random() * 500);

    item.status = 'queued';
    item.nextAt = Date.now() + backoff;
    setQueueItemProgress(item, {
      pct: 0,
      label: `Retrying in ${Math.ceil(backoff / 1000)}s`,
      indeterminate: true
    });

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
    handleFailure('Direct download timeout', { stage: 'direct-timeout', url: item && item.url ? item.url : '' });
  }, totalMs);
  tIdle = setInterval(() => {
    if (!TIMEOUT_RETRIES_ENABLED) return;
    if (Date.now() - lastProgressAt > idleMs) handleFailure('Direct download stalled', { stage: 'direct-stalled', url: item && item.url ? item.url : '' });
  }, 2000);

  const saveName = sanitizeDownloadPathForSave(name || getDownloadLabel(item));
  const handle = GM_download({
    url: normalizeDownloadUrl(item.url),
    name: saveName,
    timeout: 0,
    onprogress: (evt) => {
      lastProgressAt = Date.now();
      const loaded = evt && typeof evt.loaded === 'number' ? evt.loaded : 0;
      const total = evt && typeof evt.total === 'number' ? evt.total : 0;
      if (total > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
        setQueueItemProgress(item, {
          pct,
          label: `${formatByteSize(loaded)} / ${formatByteSize(total)} (${pct}%)`,
          indeterminate: false
        });
      } else {
        setQueueItemProgress(item, {
          pct: 0,
          label: `${formatByteSize(loaded)} downloaded`,
          indeterminate: true
        });
      }
    },
    onload: () => {
      if (settled) return;
      settled = true;
      clearWatchers();
      setQueueItemProgress(item, { pct: 100, label: 'Done', indeterminate: false });
      item.status = 'done';
      scheduleHUD();
      setTimeout(requestDispatch, SPAWN_DELAY + Math.floor(Math.random() * 200));
      maybeFinishBatch();
    },
    onerror: (err) => {
      handleFailure('Direct download failed', Object.assign({
        stage: 'direct-save',
        url: item && item.url ? item.url : '',
        details: saveName
      }, (err && typeof err === 'object') ? err : { error: String(err || 'unknown error') }));
    }
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
    s = s.replace(/\uFFFD/g, '');
    s = s.replace(/[\uD800-\uDFFF]/g, '');
    s = s.replace(/\s+/g, '_');
    s = s.replace(/[\\/:*?"<>|]+/g, '');
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return s;
  };
  const sanitizeNamePart = s => {
    s = (s || '').normalize('NFC');
    s = s.replace(/\uFFFD/g, '');
    s = s.replace(/[\uD800-\uDFFF]/g, '');
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
  const ext = getUrlExt(fileObj.name || fileObj.path || '') || 'bin';
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

function buildQueueArchiveName(userFolder, queueFolder) {
  const base = queueFolder || 'post';
  return userFolder ? `${userFolder}/${base}.zip` : `${base}.zip`;
}

function applySpecialDownloadBehavior(sourceKeptPosts) {
  const items = Array.isArray(sourceKeptPosts) ? sourceKeptPosts : [];
  if (!items.length) return [];

  const mode = SPECIAL_DOWNLOAD_BEHAVIOR || DEFAULT_OPTIONS.specialDownloadBehavior;
  const x = clampInt(
    SPECIAL_DOWNLOAD_VALUE,
    1,
    999,
    DEFAULT_OPTIONS.specialDownloadValue
  );
  if (mode === 'off' || !SPECIAL_DOWNLOAD_BEHAVIOR_LABELS[mode]) {
    return items.slice();
  }

  if (mode === 'first_x') {
    const out = [];
    items.forEach(kp => {
      if (!kp || !Array.isArray(kp.allowedFiles) || !kp.allowedFiles.length) return;
      const nextFiles = kp.allowedFiles.slice(0, x);
      if (!nextFiles.length) return;
      out.push({ post: kp.post, allowedFiles: nextFiles, globalIndex: kp.globalIndex });
    });
    return out;
  }

  if (mode === 'smattering') {
    const out = [];
    items.forEach(kp => {
      if (!kp || !Array.isArray(kp.allowedFiles) || !kp.allowedFiles.length) return;
      const files = kp.allowedFiles;
      const keepCount = Math.max(1, Math.ceil(files.length / x));
      if (keepCount >= files.length) {
        out.push({ post: kp.post, allowedFiles: files.slice(), globalIndex: kp.globalIndex });
        return;
      }
      const chosen = new Set();
      while (chosen.size < keepCount) {
        chosen.add(Math.floor(Math.random() * files.length));
      }
      const nextFiles = files.filter((_, idx) => chosen.has(idx));
      if (!nextFiles.length) return;
      out.push({ post: kp.post, allowedFiles: nextFiles, globalIndex: kp.globalIndex });
    });
    return out;
  }

  if (mode === 'every_x') {
    const out = [];
    let idxGlobal = 0;
    items.forEach(kp => {
      if (!kp || !Array.isArray(kp.allowedFiles) || !kp.allowedFiles.length) return;
      const nextFiles = [];
      kp.allowedFiles.forEach(fileInfo => {
        if ((idxGlobal % x) === 0) nextFiles.push(fileInfo);
        idxGlobal++;
      });
      if (!nextFiles.length) return;
      out.push({ post: kp.post, allowedFiles: nextFiles, globalIndex: kp.globalIndex });
    });
    return out;
  }

  return items.slice();
}

function buildBundleFromKeptPosts(sourceKeptPosts = keptPosts) {
  const files = [];
  let userFolder = '';
  let earliestPostFolder = '';
  let earliestIndex = Infinity;

  sourceKeptPosts.forEach(kp => {
    const { post, allowedFiles, globalIndex } = kp;
    if (!allowedFiles || !allowedFiles.length) return;
    const isEarliestCandidate = typeof globalIndex === 'number' && globalIndex < earliestIndex;
    if (isEarliestCandidate) {
      earliestIndex = globalIndex;
      earliestPostFolder = '';
    }
    allowedFiles.forEach(fileInfo => {
      if (!fileInfo || !fileInfo.url) return;
      const ref = fileInfo.url;
      const fileObj = { path: ref };
      const name = formatFilename(post, fileObj, fileInfo.g, globalIndex);
      const parts = splitDownloadPath(name);
      if (!userFolder && parts.userFolder) userFolder = parts.userFolder;
      if (isEarliestCandidate && !earliestPostFolder && parts.postFolder) {
        earliestPostFolder = parts.postFolder;
      }
      files.push({ url: ref, name, fileIndex: fileInfo.g, postFolder: parts.postFolder });
    });
  });

  if (files.length && !earliestPostFolder) {
    const parts = splitDownloadPath(files[0].name || '');
    earliestPostFolder = parts.postFolder || '';
  }

  const stats = computeGroupStats(files);
  return {
    files,
    userFolder,
    earliestPostFolder,
    earliestIndex: isFinite(earliestIndex) ? earliestIndex : 0,
    postCount: stats.postCount,
    fileCount: stats.fileCount
  };
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
  const profileKey = getProfileKeyFromLocation();
  const durationCache = await loadDurationCache(profileKey);
  const pendingMap = new Map();
  for (const meta of PG_POSTS) {
    if (!Array.isArray(meta.pgFiles)) continue;
    for (const f of meta.pgFiles) {
      if (!f || !f.isVid || !f.url) continue;
      const key = makeDurationUrlKey(f.url);
      if (!key) continue;
      let group = pendingMap.get(key);
      if (!group) {
        group = { key, url: f.url, files: [] };
        pendingMap.set(key, group);
      }
      group.files.push(f);
    }
  }
  if (!pendingMap.size) return;

  const probeQueue = [];
  let cachedCount = 0;
  let cacheChanged = false;

  for (const group of pendingMap.values()) {
    const cached = normalizeCachedDuration(durationCache[group.key]);
    if (cached != null) {
      for (const file of group.files) file.dur = cached;
      cachedCount++;
      continue;
    }
    let known = null;
    for (const file of group.files) {
      const d = normalizeCachedDuration(file && file.dur);
      if (d != null && d > 0) {
        known = d;
        break;
      }
    }
    if (known != null) {
      for (const file of group.files) file.dur = known;
      durationCache[group.key] = known;
      cacheChanged = true;
      cachedCount++;
      continue;
    }
    probeQueue.push(group);
  }

  if (!probeQueue.length) {
    if (cacheChanged) {
      await saveDurationCache(profileKey, durationCache);
    }
    return;
  }

  const total = probeQueue.length;
  let done = 0;
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(VIDEO_DURATION_PROBE_CONCURRENCY, total));

  const updateStatus = () => {
    const prefix = cachedCount ? (`${cachedCount} cached, `) : '';
    setIndexStatus(prefix + 'Checking video ' + done + ' of ' + total + ` (${concurrency} workers)...`, 'info');
  };

  updateStatus();

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      const group = probeQueue[idx];
      const d = await getVideoDuration(group.url);
      const dur = (isFinite(d) && d >= 0) ? d : 0;
      for (const file of group.files) file.dur = dur;
      if (durationCache[group.key] !== dur) {
        durationCache[group.key] = dur;
        cacheChanged = true;
      }
      done++;
      updateStatus();
    }
  };

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  if (cacheChanged) {
    await saveDurationCache(profileKey, durationCache);
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
    const parsed = await loadCachedIndex(cacheKey);
    if (parsed && Array.isArray(parsed.posts) && parsed.posts.length) {
      const posts = parsed.posts;
      let useCache = true;
      const cachedNewest = posts[0];
      if (!cachedNewest || !cachedNewest.id) {
        useCache = false;
      } else {
        try {
          const liveNewest = await fetchNewestPost(service, userId);
          if (liveNewest && liveNewest.id != null) {
            const liveId = String(liveNewest.id);
            const cachedId = String(cachedNewest.id);
            if (liveId !== cachedId) {
              useCache = false;
              setIndexStatus('Detected new posts. Rebuilding index...', 'info');
            }
          }
        } catch {}
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
          await saveCachedIndex(cacheKey, { ts: Date.now(), schema, meta: newMeta, posts: PG_POSTS });
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
      await saveCachedIndex(cacheKey, { ts: Date.now(), schema: 3, meta, posts: PG_POSTS });
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

function sanitizeInfoFilePart(str, fallback) {
  return sanitizeFileNameStrict(str, fallback || 'profile');
}

function extractPostDate(post) {
  if (!post) return null;
  const raw = post.published || post.published_at || post.added || post.added_at || post.created || post.created_at || post.posted || post.posted_at;
  if (raw == null) return null;
  if (typeof raw === 'number' && isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return isFinite(d.getTime()) ? d : null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw);
    return isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function formatDateForInfo(d) {
  if (!d) return 'Unknown';
  return d.toISOString().split('T')[0];
}

function buildPostUrlFromMeta(post) {
  if (!post || post.id == null) return '';
  const parts = location.pathname.split('/');
  const service = parts[1];
  const userId = parts[3];
  if (!service || !userId) return '';
  return `${location.origin}/${service}/user/${userId}/post/${post.id}`;
}

async function buildProfileInfoSnapshot() {
  const profileKey = getProfileKeyFromLocation();
  if (!profileKey) return { error: 'No profile detected' };

  if (!PG_POSTS || !PG_POSTS.length) {
    await buildGlobalIndexMapIfNeeded();
  }

  let waitCount = 0;
  while (PG_INDEX_LOADING && waitCount < 120) {
    await sleep(250);
    waitCount++;
  }

  if (!PG_POSTS || !PG_POSTS.length) {
    return { error: 'Unable to build index' };
  }

  buildFileIndexFromPostsIfNeeded();

  const posts = PG_POSTS;
  const totalPosts = posts.length;
  let totalPages = 0;
  let minDate = null;
  let maxDate = null;
  let totalFiles = 0;
  let totalImages = 0;
  let totalGifs = 0;
  let totalVideos = 0;

  for (const post of posts) {
    const pg = post && typeof post.pgPage === 'number' ? post.pgPage : 1;
    if (pg > totalPages) totalPages = pg;

    const d = extractPostDate(post);
    if (d) {
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }

    const files = Array.isArray(post.pgFiles) ? post.pgFiles : [];
    for (const f of files) {
      if (!f || !f.url) continue;
      totalFiles++;
      const base = (f.url.split('?')[0] || '').toLowerCase();
      const isVid = typeof f.isVid === 'boolean' ? f.isVid : vidRE.test(base);
      if (isVid) {
        totalVideos++;
      } else if (imgRE.test(base)) {
        totalImages++;
        if (base.endsWith('.gif')) totalGifs++;
      }
    }
  }

  if (!totalPages) totalPages = Math.max(1, Math.ceil(totalPosts / POSTS_PER_PAGE));

  const avgFiles = totalPosts ? (totalFiles / totalPosts) : 0;
  const avgImages = totalPosts ? (totalImages / totalPosts) : 0;
  const avgVideos = totalPosts ? (totalVideos / totalPosts) : 0;

  const parts = location.pathname.split('/');
  const service = parts[1] || 'service';
  const profileName = userName();
  const generatedAt = new Date();
  const lastPostDate = formatDateForInfo(maxDate);
  const firstPostDate = formatDateForInfo(minDate);

  const lines = [
    `Date of doc download: ${generatedAt.toISOString()}`,
    `Profile name: ${profileName}`,
    `Profile service: ${service}`,
    `Number of Pages as of ${lastPostDate}: ${totalPages}`,
    `Number of Posts from ${firstPostDate} to ${lastPostDate}: ${totalPosts}`,
    `Number of total files: ${totalFiles}`,
    `Number of Images (GIFs): ${totalImages} (${totalGifs})`,
    `Number of Videos: ${totalVideos}`,
    `Average files per post: ${avgFiles.toFixed(2)}`,
    `Average images per post: ${avgImages.toFixed(2)}`,
    `Average videos per post: ${avgVideos.toFixed(2)}`
  ];

  const userFolder = sanitizeInfoFilePart(profileName, 'profile');
  const servicePart = sanitizeInfoFilePart(service, 'service');
  const datePart = generatedAt.toISOString().split('T')[0].replace(/[^0-9]/g, '');
  const infoFile = sanitizeDownloadPathForSave(`${userFolder}/${userFolder} ${servicePart} info ${datePart}.txt`);

  return {
    lines,
    infoFile,
    stats: {
      profileName,
      service,
      totalPages,
      totalPosts,
      totalFiles,
      totalImages,
      totalGifs,
      totalVideos,
      avgFiles,
      avgImages,
      avgVideos,
      firstPostDate,
      lastPostDate,
      generatedAt
    }
  };
}

async function handleDownloadInfo() {
  setStatus('Preparing profile info...', 'info');
  const snapshot = await buildProfileInfoSnapshot();
  if (!snapshot || snapshot.error) {
    setStatus(snapshot && snapshot.error ? snapshot.error : 'Unable to build index', 'error');
    return;
  }
  const blob = new Blob([snapshot.lines.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  GM_download({
    url,
    name: snapshot.infoFile,
    onload: () => {
      try { URL.revokeObjectURL(url); } catch {}
      setStatus('Profile info downloaded', 'success');
    },
    onerror: () => {
      try { URL.revokeObjectURL(url); } catch {}
      setStatus('Failed to download profile info', 'error');
    }
  });
}

async function handleDownloadPostLinks() {
  const profileKey = getProfileKeyFromLocation();
  if (!profileKey) {
    setStatus('No profile detected', 'error');
    return;
  }

  setStatus('Preparing post links...', 'info');

  if (!PG_POSTS || !PG_POSTS.length) {
    await buildGlobalIndexMapIfNeeded();
  }

  let waitCount = 0;
  while (PG_INDEX_LOADING && waitCount < 120) {
    await sleep(250);
    waitCount++;
  }

  if (!PG_POSTS || !PG_POSTS.length) {
    setStatus('Unable to build index', 'error');
    return;
  }

  await handleFilter();

  if (!keptPosts || !keptPosts.length) {
    setStatus('No filtered files', 'error');
    return;
  }

  const lines = [];
  const seen = new Set();
  for (const kp of keptPosts) {
    if (!kp || !kp.post) continue;
    const postUrl = buildPostUrlFromMeta(kp.post);
    if (!postUrl) continue;
    const files = Array.isArray(kp.allowedFiles) ? kp.allowedFiles : [];
    if (!files.length) continue;
    if (!seen.has(postUrl)) {
      seen.add(postUrl);
      lines.push(postUrl);
    }
  }

  if (!lines.length) {
    setStatus('No filtered files', 'error');
    return;
  }

  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  GM_download({
    url,
    name: sanitizeDownloadPathForSave('links.txt'),
    onload: () => {
      try { URL.revokeObjectURL(url); } catch {}
      setStatus('Post links downloaded', 'success');
    },
    onerror: () => {
      try { URL.revokeObjectURL(url); } catch {}
      setStatus('Failed to download post links', 'error');
    }
  });
}

async function handleCreateGroup() {
  const profileKey = getProfileKeyFromLocation();
  if (!profileKey) {
    setStatus('No profile detected', 'error');
    return;
  }

  const postsRaw = $('#fPosts')?.value || '';
  const filesRaw = $('#fFiles')?.value || '';
  const parsedPosts = parseIndices(postsRaw);
  if (postsRaw.trim() && (!parsedPosts || parsedPosts.size === 0)) {
    setStatus('Invalid posts', 'error');
    return;
  }
  const parsedFiles = parseIndices(filesRaw);
  if (filesRaw.trim() && (!parsedFiles || parsedFiles.size === 0)) {
    setStatus('Invalid files', 'error');
    return;
  }

  await handleFilter();

  if (!keptPosts || !keptPosts.length) {
    setStatus('No filtered files', 'error');
    return;
  }

  const bundle = buildBundleFromKeptPosts();
  if (!bundle.files.length) {
    setStatus('No filtered files', 'error');
    return;
  }

  loadGroupsForProfile(profileKey);
  const name = bundle.earliestPostFolder || 'post';
  const group = {
    id: makeGroupId(),
    createdAt: Date.now(),
    name,
    earliestPostFolder: name,
    earliestIndex: bundle.earliestIndex,
    userFolder: bundle.userFolder,
    files: bundle.files,
    postCount: bundle.postCount,
    fileCount: bundle.fileCount
  };
  PG_GROUPS.push(group);
  saveGroupsForProfile();
  renderGroupsUi();
  setStatus(`Group created: ${name} (${bundle.postCount} posts, ${bundle.fileCount} files)`, 'success');
}

function handleClearGroups() {
  const profileKey = getProfileKeyFromLocation();
  if (!profileKey) {
    setStatus('No profile detected', 'error');
    return;
  }
  loadGroupsForProfile(profileKey);
  if (!PG_GROUPS.length) {
    setStatus('No groups to clear', 'info');
    return;
  }
  clearGroupsForProfile();
  setStatus('Groups cleared', 'success');
}

async function queueFiltered() {
  if (!keptPosts.length) return;
  const sourcePosts = applySpecialDownloadBehavior(keptPosts);
  if (!sourcePosts.length) {
    const st = $('#filterStatus');
    if (st) st.textContent = 'No files matched your filters.';
    scheduleHUD();
    return;
  }
  const mode = DOWNLOAD_MODE || DEFAULT_OPTIONS.downloadMode;
  if (mode === 'loose_post') {
    const items = [];
    sourcePosts.forEach(kp => {
      items.push(...buildLooseItemsForPost(kp));
    });
    if (!items.length) {
      const st = $('#filterStatus');
      if (st) st.textContent = 'No files matched your filters.';
      scheduleHUD();
      return;
    }
    LAST_QUEUE_HAD_ITEMS = true;
    enqueueItems(items);
    return;
  }
  if (mode === 'loose_queue') {
    const bundle = buildBundleFromKeptPosts(sourcePosts);
    const queueFolder = bundle.earliestPostFolder || 'post';
    const userFolder = bundle.userFolder || '';
    const items = (bundle.files || []).map(file => {
      const parts = splitDownloadPath(file.name || '');
      const fileName = parts.fileName || getDownloadLabel(file);
      const rawName = userFolder ? `${userFolder}/${queueFolder}/${fileName}` : `${queueFolder}/${fileName}`;
      const name = rawName || sanitizeDownloadPathForSave(getDownloadLabel(file));
      return {
        url: file.url,
        name,
        retryKey: file.url
      };
    });
    if (!items.length) {
      const st = $('#filterStatus');
      if (st) st.textContent = 'No files matched your filters.';
      scheduleHUD();
      return;
    }
    LAST_QUEUE_HAD_ITEMS = true;
    enqueueItems(items);
    return;
  }
  if (mode === 'post') {
    const items = [];
    sourcePosts.forEach(kp => {
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
        files.push({ url: ref, name, fileIndex: fileInfo.g, postFolder: parts.postFolder });
      });
      if (!files.length) return;
      const archiveName = buildArchiveName(userFolder, postFolder);
      const retryKey = post && post.id ? `post:${post.id}` : `${userFolder}/${postFolder || 'post'}`;
      items.push({
        url: files[0].url,
        name: archiveName,
        meta: { post, globalIndex },
        files,
        userFolder,
        postFolder,
        retryKey,
        archiveMode: 'post'
      });
    });
    if (!items.length) {
      const st = $('#filterStatus');
      if (st) st.textContent = 'No files matched your filters.';
      scheduleHUD();
      return;
    }
    LAST_QUEUE_HAD_ITEMS = true;
    enqueueItems(items);
    return;
  }
  const bundle = buildBundleFromKeptPosts(sourcePosts);
  if (!bundle.files.length) {
    const st = $('#filterStatus');
    if (st) st.textContent = 'No files matched your filters.';
    scheduleHUD();
    return;
  }
  const queueFolder = bundle.earliestPostFolder || 'post';
  const retryKey = bundle.userFolder ? `queue:${bundle.userFolder}` : 'queue:profile';
  const item = buildQueueArchiveItem(
    bundle.files,
    bundle.userFolder,
    queueFolder,
    retryKey,
    { globalIndex: bundle.earliestIndex }
  );
  if (!item) {
    const st = $('#filterStatus');
    if (st) st.textContent = 'No files matched your filters.';
    scheduleHUD();
    return;
  }
  LAST_QUEUE_HAD_ITEMS = true;
  enqueueItems([item]);
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

function handleClearFilters() {
  const fPages = $('#fPages'); if (fPages) fPages.value = '';
  const fPosts = $('#fPosts'); if (fPosts) fPosts.value = '';
  const fFiles = $('#fFiles'); if (fFiles) fFiles.value = '';
  const fDur = $('#fDur'); if (fDur) fDur.value = '';
  MEDIA_MODE = 'all';
  const btnMedia = $('#btnMedia');
  if (btnMedia) btnMedia.textContent = 'All';
  LAST_POST_CLICK = null;
  PREVIEW_MODE = false;
  const filterBtn = $('#filterBtn');
  if (filterBtn) {
    filterBtn.textContent = 'Preview';
    filterBtn.classList.remove('clear');
  }
  $$('article.post-card').forEach(c => { c.style.display = ''; });
  saveFilterState();
  injectPostNumbers();
  injectFileNumbers();
  syncPageAllButtonState();
  scheduleFilter();
}

async function handleClear() {
  resetDownloadQueueState({ clearFailures: true });
  LAST_POST_CLICK = null;
  injectPostNumbers();
  syncPageAllButtonState();
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

  if (upp && !$(`.${cssPrefix}__actions .pg-post-download-btn`)) {
    const act = $(`.${cssPrefix}__actions`);
    if (act) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pg-btn pg-post-download-btn';
      btn.textContent = 'Download Post';
      btn.title = 'Download this post archive (all files)';
      btn.onclick = () => handlePostPageDownload(document, location.href);
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

buildMenu();
buildHUD();
openMenu();
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

window.addEventListener('storage', (ev) => {
  if (!ev || !ev.key) return;
  const profileKey = getProfileKeyFromLocation();
  if (!profileKey) return;
  if (ev.key === groupsKey(profileKey)) {
    loadGroupsForProfile(profileKey);
    renderGroupsUi();
  }
});
