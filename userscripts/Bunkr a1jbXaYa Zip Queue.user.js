// ==UserScript==
// @name         Bunkr a1jbXaYa Zip Queue
// @namespace    local-gallery
// @version      1.0.2
// @description  One-off queued downloader for the zip files in Bunkr album a1jbXaYa.
// @author       jo
// @match        https://bunkr.cr/a/a1jbXaYa*
// @match        https://balbums.st/a/a1jbXaYa*
// @match        https://dl.bunkr.cr/file/*
// @connect      bunkr.cr
// @connect      balbums.st
// @connect      dl.bunkr.cr
// @connect      *.bunkr.cr
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const ALBUM_PATH = "/a/a1jbXaYa";
  const STORE_KEY = "bunkr-a1jbXaYa-zip-queue-v3";
  const DEFAULT_DELAY_MS = 30000;
  const RESOLVE_DELAY_MS = 900;
  const DIRECT_DOWNLOAD_RE = /https?:\/\/[^"'\s<>]*\/file\/\d+/i;
  const HELPER_PARAM = "bzq_auto";
  const HELPER_CLOSE_DELAY_MS = 10000;

  let state = loadState();
  let stopRequested = false;
  let renderTimer = null;

  if (location.hostname === "dl.bunkr.cr") {
    runDownloadPageHelper();
    return;
  }

  normalizeInterruptedState();
  injectPanel();
  render();

  function defaultState() {
    return {
      delayMs: DEFAULT_DELAY_MS,
      items: [],
      running: false,
      lastMessage: "Scan the album first.",
      log: [],
    };
  }

  function loadState() {
    try {
      return Object.assign(defaultState(), JSON.parse(localStorage.getItem(STORE_KEY) || "{}"));
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function normalizeInterruptedState() {
    state.running = false;
    state.items.forEach((item) => {
      if (item.status === "resolving" || item.status === "downloading") {
        item.status = "pending";
        item.error = "Reset after page reload.";
      }
    });
    saveState();
  }

  function log(message) {
    const stamp = new Date().toLocaleTimeString();
    state.lastMessage = message;
    state.log.unshift(`[${stamp}] ${message}`);
    state.log = state.log.slice(0, 8);
    saveState();
    scheduleRender();
  }

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(render, 50);
  }

  function injectPanel() {
    const style = document.createElement("style");
    style.textContent = `
      #bzq-panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: min(420px, calc(100vw - 32px));
        color: #e5e7eb;
        background: #111827;
        border: 1px solid #374151;
        border-radius: 10px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, .45);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
      }
      #bzq-panel * { box-sizing: border-box; }
      #bzq-panel header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #374151;
      }
      #bzq-panel h2 {
        margin: 0;
        color: #f9fafb;
        font-size: 14px;
        font-weight: 700;
      }
      #bzq-body {
        display: grid;
        gap: 10px;
        padding: 12px;
      }
      #bzq-panel button,
      #bzq-panel input {
        height: 32px;
        border-radius: 7px;
        border: 1px solid #4b5563;
        font: inherit;
      }
      #bzq-panel button {
        padding: 0 10px;
        color: #f9fafb;
        background: #1f2937;
        cursor: pointer;
      }
      #bzq-panel button:hover { background: #374151; }
      #bzq-panel button.primary {
        border-color: #2563eb;
        background: #2563eb;
      }
      #bzq-panel button.danger {
        border-color: #7f1d1d;
        background: #450a0a;
      }
      #bzq-panel button:disabled {
        opacity: .55;
        cursor: not-allowed;
      }
      #bzq-panel input {
        width: 84px;
        padding: 0 8px;
        color: #f9fafb;
        background: #0b1120;
      }
      .bzq-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .bzq-muted { color: #9ca3af; }
      .bzq-status {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
      }
      .bzq-stat {
        min-width: 0;
        padding: 7px 8px;
        background: #0b1120;
        border: 1px solid #273244;
        border-radius: 7px;
      }
      .bzq-stat strong {
        display: block;
        color: #f9fafb;
        font-size: 15px;
      }
      #bzq-progress-wrap {
        height: 8px;
        overflow: hidden;
        background: #0b1120;
        border: 1px solid #273244;
        border-radius: 999px;
      }
      #bzq-progress {
        width: 0;
        height: 100%;
        background: #10b981;
        transition: width .2s ease;
      }
      #bzq-log {
        max-height: 120px;
        overflow: auto;
        padding: 8px;
        color: #cbd5e1;
        background: #0b1120;
        border: 1px solid #273244;
        border-radius: 7px;
        white-space: pre-wrap;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("section");
    panel.id = "bzq-panel";
    panel.innerHTML = `
      <header>
        <h2>Bunkr Zip Queue</h2>
        <button id="bzq-hide" type="button" title="Hide panel">Hide</button>
      </header>
      <div id="bzq-body">
        <div class="bzq-status">
          <div class="bzq-stat"><strong id="bzq-total">0</strong><span>Total</span></div>
          <div class="bzq-stat"><strong id="bzq-done">0</strong><span>Done</span></div>
          <div class="bzq-stat"><strong id="bzq-pending">0</strong><span>Pending</span></div>
          <div class="bzq-stat"><strong id="bzq-failed">0</strong><span>Failed</span></div>
        </div>
        <div id="bzq-progress-wrap"><div id="bzq-progress"></div></div>
        <div class="bzq-row">
          <button id="bzq-scan" type="button">Scan album</button>
          <button id="bzq-start" class="primary" type="button">Start queue</button>
          <button id="bzq-pause" type="button">Pause</button>
          <button id="bzq-reset" class="danger" type="button">Reset</button>
        </div>
        <label class="bzq-row">
          <span class="bzq-muted">Launch one file every</span>
          <input id="bzq-delay" type="number" min="0" step="5">
          <span class="bzq-muted">seconds</span>
        </label>
        <div id="bzq-message" class="bzq-muted"></div>
        <div id="bzq-log"></div>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector("#bzq-hide").addEventListener("click", () => {
      panel.style.display = "none";
      const show = document.createElement("button");
      show.textContent = "Bunkr queue";
      show.type = "button";
      show.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;height:34px;border:1px solid #374151;border-radius:8px;background:#111827;color:#f9fafb;padding:0 12px;font:13px system-ui;cursor:pointer";
      show.addEventListener("click", () => {
        show.remove();
        panel.style.display = "";
      });
      document.body.appendChild(show);
    });
    panel.querySelector("#bzq-scan").addEventListener("click", scanAlbum);
    panel.querySelector("#bzq-start").addEventListener("click", startQueue);
    panel.querySelector("#bzq-pause").addEventListener("click", pauseQueue);
    panel.querySelector("#bzq-reset").addEventListener("click", resetQueue);
    panel.querySelector("#bzq-delay").addEventListener("change", (event) => {
      const seconds = Math.max(0, Number(event.currentTarget.value) || 0);
      state.delayMs = seconds * 1000;
      saveState();
      render();
    });
  }

  function render() {
    const totals = countStatuses();
    const doneOrFailed = totals.done + totals.failed;
    const pct = totals.total ? Math.round((doneOrFailed / totals.total) * 100) : 0;

    document.querySelector("#bzq-total").textContent = String(totals.total);
    document.querySelector("#bzq-done").textContent = String(totals.done);
    document.querySelector("#bzq-pending").textContent = String(totals.pending + totals.resolving + totals.downloading);
    document.querySelector("#bzq-failed").textContent = String(totals.failed);
    document.querySelector("#bzq-progress").style.width = `${pct}%`;
    document.querySelector("#bzq-message").textContent = state.lastMessage || "";
    document.querySelector("#bzq-log").textContent = state.log.join("\n");
    document.querySelector("#bzq-delay").value = String(Math.round(state.delayMs / 1000));

    document.querySelector("#bzq-scan").disabled = state.running;
    document.querySelector("#bzq-start").disabled = state.running || !state.items.length || !hasPendingItems();
    document.querySelector("#bzq-pause").disabled = !state.running;
    document.querySelector("#bzq-reset").disabled = state.running;
  }

  function countStatuses() {
    const counts = { total: state.items.length, pending: 0, resolving: 0, downloading: 0, done: 0, failed: 0 };
    state.items.forEach((item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
    });
    return counts;
  }

  function hasPendingItems() {
    return state.items.some((item) => item.status === "pending" || item.status === "failed");
  }

  async function scanAlbum() {
    stopRequested = false;
    state.items = [];
    state.running = true;
    log("Scanning album pages.");

    try {
      const firstUrl = new URL(ALBUM_PATH, location.origin).href;
      const firstHtml = await requestText(firstUrl);
      const firstDoc = parseHtml(firstHtml);
      const pageUrls = getAlbumPageUrls(firstDoc, firstUrl);
      const collected = [];

      for (const pageUrl of pageUrls) {
        const html = pageUrl === firstUrl ? firstHtml : await requestText(pageUrl);
        collected.push(...parseAlbumItems(html, pageUrl));
        log(`Scanned page ${pageNumber(pageUrl)} of ${pageUrls.length}.`);
        await sleep(RESOLVE_DELAY_MS);
      }

      state.items = uniquifyNames(collected).map((item, index) => ({
        id: item.pageUrl,
        index,
        name: item.name,
        pageUrl: item.pageUrl,
        status: "pending",
        warningPageUrl: "",
        error: "",
      }));
      log(`Found ${state.items.length} zip files.`);
    } catch (error) {
      log(`Scan failed: ${error.message || error}`);
    } finally {
      state.running = false;
      saveState();
      render();
    }
  }

  async function startQueue() {
    if (state.running) return;
    stopRequested = false;
    state.running = true;
    log("Queue started.");

    try {
      while (!stopRequested) {
        const item = state.items.find((entry) => entry.status === "pending" || entry.status === "failed");
        if (!item) {
          log("Queue complete.");
          break;
        }

        try {
          item.status = "resolving";
          item.error = "";
          saveState();
          render();

          item.warningPageUrl = await resolveWarningPageUrl(item.pageUrl);
          await sleep(RESOLVE_DELAY_MS);

          item.status = "downloading";
          item.startedAt = new Date().toISOString();
          saveState();
          render();
          log(`Launching ${item.index + 1}/${state.items.length}: ${item.name}`);

          await downloadFile(item);

          item.status = "done";
          item.finishedAt = new Date().toISOString();
          saveState();
          render();
          log(`Launched ${item.index + 1}/${state.items.length}: ${item.name}`);
        } catch (error) {
          item.status = "failed";
          item.error = String(error && error.message ? error.message : error);
          saveState();
          render();
          log(`Failed ${item.index + 1}/${state.items.length}: ${item.error}`);
        }

        if (!stopRequested && hasPendingItems() && state.delayMs > 0) {
          await sleepInterruptible(state.delayMs);
        }
      }
    } finally {
      state.running = false;
      saveState();
      render();
    }
  }

  function pauseQueue() {
    stopRequested = true;
    state.running = false;
    log("Pause requested. The current file may finish first.");
    saveState();
    render();
  }

  function resetQueue() {
    stopRequested = true;
    state = defaultState();
    saveState();
    log("Queue reset.");
    render();
  }

  function getAlbumPageUrls(doc, firstUrl) {
    const urls = new Map();
    urls.set(1, firstUrl);
    doc.querySelectorAll(".pagination a[href]").forEach((anchor) => {
      const url = new URL(anchor.getAttribute("href"), firstUrl);
      if (url.pathname !== ALBUM_PATH) return;
      const page = Number(url.searchParams.get("page") || "1");
      if (Number.isInteger(page) && page > 0) urls.set(page, url.href);
    });
    return [...urls.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  }

  function parseAlbumItems(html, pageUrl) {
    const doc = parseHtml(html);
    const items = [];
    const seenPageUrls = new Set();

    doc.querySelectorAll(".theItem").forEach((item) => {
      const rawName = item.getAttribute("title") || item.querySelector(".theName")?.textContent || "";
      const name = safeFilename(rawName);
      if (!/\.zip$/i.test(name)) return;

      const link = item.querySelector('a[href^="/f/"], a[href*="/f/"]');
      if (!link) return;

      const filePageUrl = new URL(link.getAttribute("href"), pageUrl).href;
      if (seenPageUrls.has(filePageUrl)) return;
      seenPageUrls.add(filePageUrl);
      items.push({ name, pageUrl: filePageUrl });
    });

    return items;
  }

  async function resolveWarningPageUrl(filePageUrl) {
    const html = await requestText(filePageUrl);
    const doc = parseHtml(html);
    const buttonHref = doc.querySelector('a[href*="dl.bunkr.cr/file/"], a[href*="/file/"]')?.href || "";
    const matchedHref = html.match(DIRECT_DOWNLOAD_RE)?.[0] || "";
    const warningPageUrl = buttonHref || matchedHref;

    if (!warningPageUrl) {
      throw new Error("No direct download button found.");
    }

    return warningPageUrl;
  }

  function downloadFile(item) {
    return new Promise((resolve, reject) => {
      const helperUrl = addHelperParams(item.warningPageUrl, item.name);

      if (typeof GM_openInTab === "function") {
        GM_openInTab(helperUrl, { active: false, insert: true, setParent: true });
        resolve();
        return;
      }

      const opened = window.open(helperUrl, "_blank", "noopener");
      if (opened) {
        resolve();
        return;
      }

      reject(new Error("The browser blocked the helper tab. Allow popups for this site and resume the queue."));
    });
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: 45000,
          headers: { Accept: "text/html,application/xhtml+xml" },
          onload: (response) => {
            if (response.status >= 200 && response.status < 400) resolve(response.responseText);
            else reject(new Error(`HTTP ${response.status} for ${url}`));
          },
          onerror: () => reject(new Error(`Request failed for ${url}`)),
          ontimeout: () => reject(new Error(`Request timed out for ${url}`)),
        });
        return;
      }

      fetch(url, { credentials: "include" })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
          return response.text();
        })
        .then(resolve)
        .catch(reject);
    });
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  function safeFilename(name) {
    const cleaned = name
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "download.zip";
  }

  function uniquifyNames(items) {
    const counts = new Map();
    return items.map((item) => {
      const count = (counts.get(item.name.toLowerCase()) || 0) + 1;
      counts.set(item.name.toLowerCase(), count);
      if (count === 1) return item;

      const match = item.name.match(/^(.*?)(\.[^.]+)$/);
      const uniqueName = match ? `${match[1]} (${count})${match[2]}` : `${item.name} (${count})`;
      return Object.assign({}, item, { name: uniqueName });
    });
  }

  function addHelperParams(url, name) {
    const helperUrl = new URL(url);
    helperUrl.searchParams.set(HELPER_PARAM, "1");
    helperUrl.searchParams.set("bzq_name", name);
    return helperUrl.toString();
  }

  function runDownloadPageHelper() {
    if (new URL(location.href).searchParams.get(HELPER_PARAM) !== "1") return;

    const status = document.createElement("div");
    status.textContent = "Bunkr queue: waiting for download button...";
    status.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;padding:10px 12px;font:13px system-ui;box-shadow:0 12px 32px rgba(0,0,0,.35)";
    document.documentElement.appendChild(status);

    const clickWhenReady = () => {
      const button = document.querySelector("#download-btn");
      if (!button) {
        window.setTimeout(clickWhenReady, 250);
        return;
      }

      status.textContent = "Bunkr queue: clicking final download button...";
      window.setTimeout(() => {
        button.click();
        status.textContent = "Bunkr queue: download started.";
        window.setTimeout(() => window.close(), HELPER_CLOSE_DELAY_MS);
      }, 750);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", clickWhenReady, { once: true });
    } else {
      clickWhenReady();
    }
  }

  function pageNumber(url) {
    return new URL(url).searchParams.get("page") || "1";
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function sleepInterruptible(ms) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (stopRequested || Date.now() - started >= ms) resolve();
        else window.setTimeout(tick, 500);
      };
      tick();
    });
  }
})();
