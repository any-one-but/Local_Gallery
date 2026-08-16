// ==UserScript==
// @name         Nexus Curator
// @namespace    https://github.com/any-one-but/Local_Gallery
// @version      00.01.00
// @description  Mod lists for Nexus Mods, organised by game. Build a list of mod pages, download every current file for the whole list in one go, with descriptions saved alongside. Tracks dependencies.
// @author       normal person
// @match        *://*.nexusmods.com/*
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      nexusmods.com
// @connect      *.nexusmods.com
// @connect      nexus-cdn.com
// @connect      *.nexus-cdn.com
// @connect      staticdelivery.nexusmods.com
// @run-at       document-idle
// ==/UserScript==

/*
  PHASE 1 — page parsing only.

  Everything in here is a pure function over a Document, so it works identically on the
  live page and on a document fetched for some other mod. Nothing below touches GM_*,
  the network, or the DOM of the current page, which is what makes it testable by
  pasting this file into a console.

  Exposed as window.__ncParse for that purpose.
*/

(function () {
  'use strict';

  // A @match this broad also matches every ad and widget iframe on the page. Without
  // this the dock is injected several times over, and each copy writes to the same
  // storage keys.
  if (window.top !== window.self) return;
  if (window.__ncLoaded) return;
  window.__ncLoaded = true;

  // ------------------------------------------------------------------ selectors
  // Every piece of Nexus's markup this script depends on. One map, so a site
  // redesign is a single edit rather than a hunt through the file.

  const SEL = {
    pageTitle: '#pagetitle h1',
    versionStat: '#fileinfo li.stat-version .stat',
    endorseStat: '#fileinfo li.stat-endorsements .stat',
    sideItem: '.sideitem',
    sideTimestamp: '.sideitem.timestamp',
    descContainer: '.mod_description_container',
    // The requirements accordion is identified by its tracking attribute, NOT by its
    // heading text. `table.desc-table` on its own is a trap: Mirrors, Translations and
    // other accordions reuse the class, and scraping those yields five "off-site
    // requirements" that are actually download mirrors. Ask for the right section first.
    reqAccordion: 'dt[data-accordion-track="mod_requirements"], dt[data-accordion-track="file_requirements"]',
    descTable: 'table.desc-table',
    reqName: 'td.table-require-name',
    reqNote: 'td.table-require-notes',
    downloadModal: 'mod-download-modal',
    mainFileRequirements: 'main-file-requirements',
    gameIdLink: 'a[href*="game_id="]',
    breadcrumb: '#breadcrumb li a',
    fileContainers: {
      main: '#file-container-main-files',
      optional: '#file-container-optional-files',
      old: '#file-container-old-files'
    },
    fileHeader: 'dt.file-expander-header',
    fileDescription: '.tabbed-block.files-description',
    // The real archive filename, with its extension, lives on the "Preview file contents"
    // link. Nothing else on the page carries it: data-name is a display name ("SkyUI"),
    // and the CDN URL is a bare uuid. Without this we'd be guessing extensions.
    filePreviewLink: 'a.btn-ajax-content-preview[data-url]'
  };

  // Notes are unstructured prose, but authors near-universally lead with one of these.
  // This is a HINT for display only — nothing is ever hidden or reclassified on it.
  const NOTE_TAG_RE =
    /^\s*(hard\s+requirement|soft\s+requirement|required|requires|optional|recommended|mandatory)\b/i;

  // ------------------------------------------------------------------ utilities

  function txt(node) {
    return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function attr(node, name) {
    return node ? node.getAttribute(name) : null;
  }

  function jsonAttr(node, name) {
    const raw = attr(node, name);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function toInt(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }

  /*
    Canonical mod URL. Nexus mod links arrive with ?tab=, #anchors, http/https, with and
    without www, and occasionally uppercased game domains. Everything that identifies the
    same mod must produce the same key or the dependency merge silently duplicates rows.
  */
  function parseModUrl(url) {
    if (!url) return null;
    let u;
    try { u = new URL(String(url), 'https://www.nexusmods.com'); } catch { return null; }
    if (!/(^|\.)nexusmods\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([^/]+)\/mods\/(\d+)/i);
    if (!m) return null;
    const gameDomain = m[1].toLowerCase();
    const modId = m[2];
    return {
      gameDomain,
      modId,
      url: `https://www.nexusmods.com/${gameDomain}/mods/${modId}`
    };
  }

  /*
    HTML -> plain text for the Info file. Mod descriptions are user-authored BBCode
    rendered to HTML: <font>, <br>, imgur <img>, nested tables, the lot. Two rules that
    matter: a link keeps its target (the description is often mostly links, and a bare
    "click here" in a text file is useless), and block boundaries become real newlines
    so the result is readable rather than one run-on paragraph.
  */
  function htmlToText(root) {
    if (!root) return '';
    const BLOCK = new Set([
      'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DD', 'DT', 'FIELDSET',
      'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL'
    ]);
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME']);
    const out = [];

    const walk = (node) => {
      if (node.nodeType === 3) {
        out.push(node.nodeValue.replace(/\s+/g, ' '));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (SKIP.has(tag)) return;

      if (tag === 'BR') { out.push('\n'); return; }
      if (tag === 'HR') { out.push('\n---\n'); return; }
      if (tag === 'IMG') {
        const alt = node.getAttribute('alt');
        if (alt && alt.trim()) out.push(`[image: ${alt.trim()}]`);
        return;
      }

      const isBlock = BLOCK.has(tag);
      if (isBlock) out.push('\n');
      if (tag === 'LI') out.push('- ');

      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        const label = node.textContent.replace(/\s+/g, ' ').trim();
        if (href && label && !href.startsWith('#')) {
          let abs = href;
          try { abs = new URL(href, 'https://www.nexusmods.com').href; } catch { /* keep raw */ }
          // Don't print "https://x <https://x>" when the label already is the URL.
          out.push(label === abs || label === href ? label : `${label} <${abs}>`);
        } else {
          out.push(label);
        }
        if (isBlock) out.push('\n');
        return;
      }

      for (const child of node.childNodes) walk(child);
      if (isBlock) out.push('\n');
    };

    walk(root);

    return out.join('')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // -------------------------------------------------------------- page context

  /*
    gameId is required by the resolve endpoint, so it cannot be allowed to come back null.
    Not every mod page carries a game_id link — USSEP doesn't — but every page carries
    staticdelivery image URLs, which embed the game id as /mods/<gameId>/. Two independent
    sources, tried in order.
  */
  function parseGameId(doc) {
    const link = doc.querySelector(SEL.gameIdLink);
    if (link) {
      const m = String(link.getAttribute('href') || '').match(/game_id=(\d+)/);
      if (m) return m[1];
    }
    const og = doc.querySelector('meta[property="og:image"]');
    const candidates = [
      og ? og.getAttribute('content') : null,
      ...[...doc.querySelectorAll('img[src*="staticdelivery.nexusmods.com/mods/"]')]
        .slice(0, 5).map(img => img.getAttribute('src'))
    ];
    for (const src of candidates) {
      if (!src) continue;
      const m = String(src).match(/staticdelivery\.nexusmods\.com\/mods\/(\d+)\//);
      if (m) return m[1];
    }
    return null;
  }

  /*
    The header version stat is `li.stat-version`, but the files tab repeats that class on
    every file row, so an unscoped query there returns whichever file happens to be first.
    Exclude anything inside a file container and take the header's own.
  */
  function parseHeaderVersion(doc) {
    for (const li of doc.querySelectorAll('li.stat-version')) {
      if (li.closest('[id^="file-container"]')) continue;
      const v = txt(li.querySelector('.stat'));
      if (v) return v;
    }
    return null;
  }

  function parseContext(doc, pageUrl) {
    const fromUrl = parseModUrl(pageUrl) || {};
    const gameId = parseGameId(doc);
    const crumbs = [...doc.querySelectorAll(SEL.breadcrumb)].map(a => txt(a));
    return {
      url: fromUrl.url || null,
      gameDomain: fromUrl.gameDomain || null,
      modId: fromUrl.modId || null,
      gameId,
      gameName: crumbs.length > 1 ? crumbs[1] : null,
      category: crumbs.length ? crumbs[crumbs.length - 1] : null
    };
  }

  // ---------------------------------------------------------- description tab

  function parseSideItems(doc) {
    const out = { author: null, uploader: null, updatedAt: null, uploadedAt: null };
    const stamps = [...doc.querySelectorAll(SEL.sideTimestamp)];
    for (const el of stamps) {
      const t = el.querySelector('time');
      const secs = toInt(attr(t, 'data-date'));
      if (secs === null) continue;
      const label = txt(el).toLowerCase();
      if (label.includes('last updated')) out.updatedAt = secs * 1000;
      else if (label.includes('original upload')) out.uploadedAt = secs * 1000;
    }
    for (const el of doc.querySelectorAll(SEL.sideItem)) {
      const t = txt(el);
      let m = t.match(/^Created by\s+(.+)$/i);
      if (m) { out.author = m[1].trim(); continue; }
      m = t.match(/^Uploaded by\s+(.+)$/i);
      if (m) out.uploader = m[1].trim();
    }
    return out;
  }

  // Which bucket a requirements sub-table belongs to, from the h3 above it.
  function requirementTableKind(heading) {
    const h = String(heading || '').toLowerCase();
    if (h.includes('off-site') || h.includes('offsite')) return 'offsite';
    if (h.includes('dlc')) return 'dlc';
    if (h.includes('nexus')) return 'mod';
    return null;
  }

  function precedingHeading(table) {
    let el = table.previousElementSibling;
    while (el && el.tagName !== 'H3') el = el.previousElementSibling;
    return el ? txt(el) : null;
  }

  /*
    The only source of the author's prose. Scoped hard to the requirements accordion —
    see the note on SEL.reqAccordion for why an unscoped `table.desc-table` is wrong.
  */
  function parseDescTableDeps(doc) {
    const out = [];
    const sections = [];
    for (const dt of doc.querySelectorAll(SEL.reqAccordion)) {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === 'DD') sections.push(dd);
    }
    if (!sections.length) return out;

    for (const dd of sections) {
      for (const table of dd.querySelectorAll(SEL.descTable)) {
        const heading = precedingHeading(table);
        const kind = requirementTableKind(heading);
        // An unlabelled table inside the requirements accordion is still a requirements
        // table; default it to 'mod' rather than dropping rows on the floor.
        const kindHint = kind === null ? 'mod' : kind;
        for (const tr of table.querySelectorAll('tbody tr')) {
          const nameCell = tr.querySelector(SEL.reqName);
          const noteCell = tr.querySelector(SEL.reqNote);
          if (!nameCell) continue;
          const link = nameCell.querySelector('a');
          const name = txt(link) || txt(nameCell);
          if (!name) continue;
          out.push({
            name,
            url: link ? link.getAttribute('href') : null,
            note: txt(noteCell),
            kindHint,
            source: 'descTable'
          });
        }
      }
    }
    return out;
  }

  /*
    Structured requirements. Present on both tabs as an attribute of the download modal.
    Carries a `type` discriminator and a real URL, but never the author's note — which is
    exactly the half the desc-table has and this doesn't.
  */
  function parseRequirementAttrDeps(doc) {
    const el = doc.querySelector(SEL.downloadModal);
    if (!el) return [];
    const out = [];
    for (const item of jsonAttr(el, 'requirements') || []) {
      if (!item || !item.name) continue;
      out.push({
        name: String(item.name),
        url: item.url || null,
        note: '',
        kindHint: item.type || null,
        adultContent: !!item.adultContent,
        thumbnailUrl: item.thumbnailUrl || null,
        source: 'requirements'
      });
    }
    for (const item of jsonAttr(el, 'dlc-dependencies') || []) {
      if (!item) continue;
      const name = item.name || item.title || item.label;
      if (!name) continue;
      out.push({
        name: String(name),
        url: item.url || null,
        note: '',
        kindHint: 'dlc',
        source: 'dlcDependencies'
      });
    }
    return out;
  }

  // --------------------------------------------------------------- files tab

  /*
    File-level hard dependencies. Two carriers with the same payload shape: the modal's
    `dependencies` attribute, and <main-file-requirements download-links>. A mod uses one
    or the other depending on which requirements system its author is on, so both are read.
  */
  function parseFileLevelDeps(doc) {
    const groups = [];
    const modal = doc.querySelector(SEL.downloadModal);
    if (modal) {
      const deps = jsonAttr(modal, 'dependencies');
      if (Array.isArray(deps)) groups.push(...deps);
    }
    for (const el of doc.querySelectorAll(SEL.mainFileRequirements)) {
      const payload = jsonAttr(el, 'download-links');
      if (payload && Array.isArray(payload.dependencies)) groups.push(...payload.dependencies);
    }

    const out = [];
    for (const group of groups) {
      const files = (group && Array.isArray(group.files)) ? group.files : [];
      for (const file of files) {
        const mod = file && file.mod;
        if (!mod || !mod.name) continue;
        out.push({
          name: String(mod.name),
          url: mod.url || null,
          note: '',
          kindHint: 'mod',
          hard: true,
          adultContent: !!mod.adultContent,
          thumbnailUrl: mod.thumbnailUrl || null,
          requiredFile: {
            uid: file.uid || null,
            name: file.name || null,
            version: file.version || null
          },
          source: 'fileDeps'
        });
      }
    }
    return out;
  }

  function parseFileSection(doc, containerSel, category) {
    const root = doc.querySelector(containerSel);
    if (!root) return [];
    const out = [];
    for (const dt of root.querySelectorAll(SEL.fileHeader)) {
      const fid = attr(dt, 'data-id');
      if (!fid) continue;

      // Pair by data-id rather than nextElementSibling: the accordion sometimes carries
      // extra nodes between dt and dd, and a mispaired description is worse than none.
      const dd = root.querySelector(`dd[data-id="${CSS.escape(fid)}"]`);
      const descEl = dd ? dd.querySelector(SEL.fileDescription) : null;
      const modal = dd ? dd.querySelector(SEL.downloadModal) : null;
      const fileJson = modal ? jsonAttr(modal, 'file') : null;
      const uploadedSecs = toInt(attr(dt, 'data-date'));
      const sizeKb = toInt(attr(dt, 'data-size'));
      const previewLink = dd ? dd.querySelector(SEL.filePreviewLink) : null;
      const filename = previewLink ? String(previewLink.getAttribute('data-url') || '').trim() : '';

      out.push({
        fileId: fid,                                  // the `fid` the resolve endpoint wants
        uid: fileJson && fileJson.uid ? String(fileJson.uid) : null,
        name: attr(dt, 'data-name') || '',
        filename: filename || null,                   // null => extension will be guessed
        version: attr(dt, 'data-version') || '',
        category,
        sizeKb,                                       // data-size is KB, not bytes
        sizeBytes: sizeKb === null ? null : sizeKb * 1024,
        uploadedAt: uploadedSecs === null ? null : uploadedSecs * 1000,
        dependencyCount: toInt(attr(dt, 'data-dependencies-count')) || 0,
        description: htmlToText(descEl)
      });
    }
    return out;
  }

  function parseFiles(doc) {
    return {
      main: parseFileSection(doc, SEL.fileContainers.main, 'main'),
      optional: parseFileSection(doc, SEL.fileContainers.optional, 'optional'),
      old: parseFileSection(doc, SEL.fileContainers.old, 'old')
    };
  }

  // ------------------------------------------------------------- dependency merge

  function depKey(dep) {
    const parsed = parseModUrl(dep.url);
    if (parsed) return parsed.url;
    if (dep.url) {
      try { return 'offsite:' + new URL(dep.url).href.toLowerCase(); } catch { /* fall through */ }
    }
    return 'name:' + String(dep.name || '').trim().toLowerCase();
  }

  function classifyDep(dep, parsed) {
    // An explicit hint from a labelled table beats URL shape: the author put the row
    // under that heading deliberately.
    if (dep.kindHint === 'dlc') return 'dlc';
    if (dep.kindHint === 'offsite') return 'offsite';
    if (parsed) return 'mod';
    return dep.url ? 'offsite' : 'unknown';
  }

  function noteTag(note) {
    const m = String(note || '').match(NOTE_TAG_RE);
    return m ? m[1].toUpperCase().replace(/\s+/g, ' ') : null;
  }

  /*
    Merge the three sources into one list, keyed on canonical mod URL.

    Precedence is per-field rather than per-source, because no single source is complete:
    structure comes from the JSON attributes, prose comes only from the table, and a
    hard-requirement flag comes only from the file-level deps. First non-empty wins for
    scalars; `hard` is sticky once true; sources accumulate so the UI can say where a
    claim came from.
  */
  function mergeDeps(...lists) {
    const map = new Map();
    for (const list of lists) {
      for (const dep of list || []) {
        const key = depKey(dep);
        const parsed = parseModUrl(dep.url);
        let rec = map.get(key);
        if (!rec) {
          rec = {
            key,
            name: dep.name || '',
            url: parsed ? parsed.url : (dep.url || null),
            gameDomain: parsed ? parsed.gameDomain : null,
            modId: parsed ? parsed.modId : null,
            kind: classifyDep(dep, parsed),
            note: '',
            noteTag: null,
            hard: false,
            adultContent: false,
            thumbnailUrl: null,
            requiredFiles: [],
            sources: []
          };
          map.set(key, rec);
        }
        if (!rec.name && dep.name) rec.name = dep.name;
        if (!rec.url && dep.url) rec.url = dep.url;
        if (!rec.note && dep.note) {
          rec.note = dep.note;
          rec.noteTag = noteTag(dep.note);
        }
        if (dep.hard) rec.hard = true;
        if (dep.adultContent) rec.adultContent = true;
        if (!rec.thumbnailUrl && dep.thumbnailUrl) rec.thumbnailUrl = dep.thumbnailUrl;
        if (dep.kindHint === 'dlc' || dep.kindHint === 'offsite') rec.kind = dep.kindHint;
        if (dep.requiredFile) rec.requiredFiles.push(dep.requiredFile);
        if (!rec.sources.includes(dep.source)) rec.sources.push(dep.source);
      }
    }
    return [...map.values()];
  }

  // ------------------------------------------------------------------ assembly

  /*
    Build a Mod record. Either document may be omitted: passing only the files document
    is what the refresh-before-download pass does, since versions live there and
    descriptions rarely change.
  */
  function parseModPage(opts) {
    const descDoc = opts.descDoc || null;
    const filesDoc = opts.filesDoc || null;
    const anyDoc = descDoc || filesDoc;
    if (!anyDoc) throw new Error('parseModPage: need at least one document');

    const ctx = parseContext(anyDoc, opts.url || (anyDoc.location && anyDoc.location.href));
    const side = descDoc ? parseSideItems(descDoc) : {};
    const files = filesDoc ? parseFiles(filesDoc) : { main: [], optional: [], old: [] };

    const deps = mergeDeps(
      descDoc ? parseDescTableDeps(descDoc) : [],
      descDoc ? parseRequirementAttrDeps(descDoc) : [],
      filesDoc ? parseRequirementAttrDeps(filesDoc) : [],
      filesDoc ? parseFileLevelDeps(filesDoc) : []
    );

    const descEl = descDoc ? descDoc.querySelector(SEL.descContainer) : null;
    const summaryMeta = descDoc
      ? descDoc.querySelector('meta[name="description"]')
      : null;
    const modal = anyDoc.querySelector(SEL.downloadModal);

    return {
      url: ctx.url,
      gameDomain: ctx.gameDomain,
      gameId: ctx.gameId,
      gameName: ctx.gameName,
      modId: ctx.modId,
      name: descDoc ? txt(descDoc.querySelector(SEL.pageTitle)) : txt(anyDoc.querySelector(SEL.pageTitle)),
      category: ctx.category,
      author: side.author || null,
      uploader: side.uploader || null,
      version: parseHeaderVersion(descDoc || anyDoc),
      updatedAt: side.updatedAt || null,
      uploadedAt: side.uploadedAt || null,
      summary: summaryMeta ? String(summaryMeta.content || '').trim() : null,
      description: htmlToText(descEl),
      isPremiumAccount: modal ? attr(modal, 'is-premium') === 'true' : null,
      adultContent: modal ? attr(modal, 'show-adult-content') === 'true' : null,
      files,
      deps: deps.filter(d => d.kind === 'mod'),
      offsiteDeps: deps.filter(d => d.kind === 'offsite' || d.kind === 'unknown'),
      dlcDeps: deps.filter(d => d.kind === 'dlc'),
      parsedAt: Date.now()
    };
  }

  // ==========================================================================
  // STORE
  // ==========================================================================

  const SCHEMA = 1;
  const INDEX_KEY = 'nc:index';
  const UI_KEY = 'nc:ui';
  const gameKey = (domain) => 'nc:game:' + domain;

  /*
    Sharded by game: one storage key per game plus a small index, rather than one blob.
    A serious library is megabytes, and rewriting all of it on every "add mod" would be
    both slow and a single point of total loss.
  */

  // A key whose stored value failed to parse. Reads fall back to an empty doc so the UI
  // still works, but writes to that key are REFUSED — otherwise the next autosave would
  // overwrite a recoverable document with the empty one we substituted. Data loss from a
  // transient parse error is not an acceptable failure mode.
  const blockedKeys = new Set();

  function readJson(key, fallback) {
    let raw = '';
    try {
      raw = GM_getValue(key, '') || '';
    } catch (err) {
      logLine(`storage: read failed for ${key} (${err && err.message})`);
      blockedKeys.add(key);
      return fallback;
    }
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      logLine(`storage: ${key} is corrupt — writes to it are now blocked. Export before fixing.`);
      blockedKeys.add(key);
      return fallback;
    }
  }

  function writeJson(key, value) {
    if (blockedKeys.has(key)) {
      logLine(`storage: refusing to write ${key} (it failed to load; writing would destroy it)`);
      return false;
    }
    try {
      GM_setValue(key, JSON.stringify(value));
      return true;
    } catch (err) {
      logLine(`storage: write failed for ${key} (${err && err.message})`);
      return false;
    }
  }

  function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------------------------------------------------------------- index

  function readIndex() {
    const idx = readJson(INDEX_KEY, null);
    if (!idx || typeof idx !== 'object') return { schema: SCHEMA, games: {}, updatedAt: 0 };
    if (!idx.games || typeof idx.games !== 'object') idx.games = {};
    return idx;
  }

  function writeIndex(idx) {
    idx.schema = SCHEMA;
    idx.updatedAt = Date.now();
    return writeJson(INDEX_KEY, idx);
  }

  // ------------------------------------------------------------ game docs

  function blankGameDoc(domain, name, gameId) {
    return {
      schema: SCHEMA,
      domain,
      name: name || domain,
      gameId: gameId || null,
      lists: [],
      mods: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  /*
    Every document read passes through here, so this is the one place a shape from an
    older schema gets brought forward. Nothing else in the script may assume a field
    exists that migrate() did not guarantee.
  */
  function migrateGameDoc(doc, domain) {
    if (!doc || typeof doc !== 'object') return blankGameDoc(domain);
    if (!Array.isArray(doc.lists)) doc.lists = [];
    if (!doc.mods || typeof doc.mods !== 'object') doc.mods = {};
    doc.domain = doc.domain || domain;
    doc.name = doc.name || domain;
    for (const list of doc.lists) {
      if (!list.id) list.id = newId('list');
      if (!Array.isArray(list.modIds)) list.modIds = [];
      if (typeof list.name !== 'string') list.name = 'Untitled list';
    }
    for (const [modId, mod] of Object.entries(doc.mods)) {
      if (!mod || typeof mod !== 'object') { delete doc.mods[modId]; continue; }
      mod.modId = mod.modId || modId;
      if (!mod.state) mod.state = 'stub';
      if (!mod.download || typeof mod.download !== 'object') mod.download = { files: {} };
      if (!mod.download.files || typeof mod.download.files !== 'object') mod.download.files = {};
      if (!Array.isArray(mod.deps)) mod.deps = [];
      if (!mod.files || typeof mod.files !== 'object') mod.files = { main: [], optional: [], old: [] };
    }
    doc.schema = SCHEMA;
    return doc;
  }

  const gameCache = new Map();

  function getGame(domain) {
    if (!domain) return null;
    if (gameCache.has(domain)) return gameCache.get(domain);
    const doc = migrateGameDoc(readJson(gameKey(domain), null), domain);
    gameCache.set(domain, doc);
    return doc;
  }

  function ensureGame(ctx) {
    if (!ctx || !ctx.gameDomain) return null;
    const doc = getGame(ctx.gameDomain);
    let changed = false;
    if (ctx.gameName && doc.name !== ctx.gameName) { doc.name = ctx.gameName; changed = true; }
    if (ctx.gameId && doc.gameId !== ctx.gameId) { doc.gameId = ctx.gameId; changed = true; }
    if (changed) touchGame(ctx.gameDomain);
    return doc;
  }

  // ---------------------------------------------------- debounced persistence

  const dirtyGames = new Set();
  let flushTimer = null;

  function touchGame(domain) {
    dirtyGames.add(domain);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushGames, 400);
  }

  function flushGames() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!dirtyGames.size) return;
    const idx = readIndex();
    let indexChanged = false;
    for (const domain of dirtyGames) {
      const doc = gameCache.get(domain);
      if (!doc) continue;
      doc.updatedAt = Date.now();
      if (!writeJson(gameKey(domain), doc)) continue;
      const entry = idx.games[domain];
      const summary = {
        domain,
        name: doc.name,
        gameId: doc.gameId,
        lists: doc.lists.length,
        mods: Object.keys(doc.mods).length,
        updatedAt: doc.updatedAt
      };
      if (!entry || JSON.stringify(entry) !== JSON.stringify(summary)) {
        idx.games[domain] = summary;
        indexChanged = true;
      }
    }
    dirtyGames.clear();
    if (indexChanged) writeIndex(idx);
    renderDock();
  }

  // A debounce that loses the last write on navigation is not a debounce, it's a bug.
  // Nexus is a multi-page site, so leaving the page is the common case, not the rare one.
  window.addEventListener('pagehide', flushGames);
  window.addEventListener('beforeunload', flushGames);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushGames();
  });

  // ------------------------------------------------------------- mutations

  function upsertMod(domain, record) {
    const doc = getGame(domain);
    if (!doc || !record || !record.modId) return null;
    const existing = doc.mods[record.modId] || null;
    const merged = Object.assign({}, existing || {}, record);
    // Download history is ours, not the page's — a re-parse must never clear it.
    merged.download = (existing && existing.download) || record.download || { files: {} };
    merged.addedAt = (existing && existing.addedAt) || Date.now();
    doc.mods[record.modId] = merged;
    touchGame(domain);
    return merged;
  }

  function createList(domain, name) {
    const doc = getGame(domain);
    if (!doc) return null;
    const list = {
      id: newId('list'),
      name: String(name || 'Untitled list').trim() || 'Untitled list',
      note: '',
      modIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    doc.lists.push(list);
    touchGame(domain);
    return list;
  }

  function getList(domain, listId) {
    const doc = getGame(domain);
    return doc ? doc.lists.find(l => l.id === listId) || null : null;
  }

  function renameList(domain, listId, name) {
    const list = getList(domain, listId);
    if (!list) return false;
    list.name = String(name || '').trim() || list.name;
    list.updatedAt = Date.now();
    touchGame(domain);
    return true;
  }

  function deleteList(domain, listId) {
    const doc = getGame(domain);
    if (!doc) return false;
    const i = doc.lists.findIndex(l => l.id === listId);
    if (i < 0) return false;
    doc.lists.splice(i, 1);
    touchGame(domain);
    return true;
  }

  function addModToList(domain, listId, modId) {
    const list = getList(domain, listId);
    if (!list || !modId) return false;
    if (list.modIds.includes(modId)) return false;
    list.modIds.push(modId);
    list.updatedAt = Date.now();
    touchGame(domain);
    return true;
  }

  function removeModFromList(domain, listId, modId) {
    const list = getList(domain, listId);
    if (!list) return false;
    const i = list.modIds.indexOf(modId);
    if (i < 0) return false;
    list.modIds.splice(i, 1);
    list.updatedAt = Date.now();
    touchGame(domain);
    return true;
  }

  // Which lists in this game hold this mod. The basis of the whole "you already have
  // this" check, so it lives in the store rather than being recomputed in the UI.
  function listsContainingMod(domain, modId) {
    const doc = getGame(domain);
    if (!doc) return [];
    return doc.lists.filter(l => l.modIds.includes(modId));
  }

  function gameStats(domain) {
    const doc = getGame(domain);
    if (!doc) return { lists: 0, mods: 0, inLists: 0 };
    const inLists = new Set();
    for (const l of doc.lists) for (const id of l.modIds) inLists.add(id);
    return { lists: doc.lists.length, mods: Object.keys(doc.mods).length, inLists: inLists.size };
  }

  // ------------------------------------------------------- export / import

  function exportPayload(domain) {
    const idx = readIndex();
    const games = {};
    const domains = domain ? [domain] : Object.keys(idx.games);
    for (const d of domains) {
      const doc = getGame(d);
      if (doc) games[d] = doc;
    }
    return {
      schema: SCHEMA,
      kind: 'nexus-curator-export',
      exportedAt: new Date().toISOString(),
      games
    };
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      GM_download({
        url,
        name: filename,
        saveAs: true,
        onload: () => { logLine(`exported ${filename}`); setTimeout(() => URL.revokeObjectURL(url), 30000); },
        onerror: (e) => { logLine('export failed: ' + JSON.stringify(e)); setTimeout(() => URL.revokeObjectURL(url), 30000); }
      });
    } catch (err) {
      logLine('export failed: ' + (err && err.message));
    }
  }

  /*
    Import MERGES; it never replaces. Lists union their members, mods fill in gaps, and
    an existing mod's download history always wins over the imported one — the local
    record knows what this machine actually has on disk and the file cannot.
  */
  function mergeImport(payload) {
    if (!payload || payload.kind !== 'nexus-curator-export' || !payload.games) {
      throw new Error('not a Nexus Curator export');
    }
    const summary = { games: 0, lists: 0, mods: 0 };
    for (const [domain, incomingRaw] of Object.entries(payload.games)) {
      const incoming = migrateGameDoc(incomingRaw, domain);
      const doc = getGame(domain);
      if (!doc.gameId && incoming.gameId) doc.gameId = incoming.gameId;
      if (doc.name === domain && incoming.name) doc.name = incoming.name;

      for (const [modId, mod] of Object.entries(incoming.mods)) {
        const existing = doc.mods[modId];
        if (!existing) {
          doc.mods[modId] = mod;
          summary.mods++;
        } else {
          const keptDownload = existing.download;
          doc.mods[modId] = Object.assign({}, mod, existing);
          doc.mods[modId].download = keptDownload;
        }
      }
      for (const list of incoming.lists) {
        const existing = doc.lists.find(l => l.id === list.id);
        if (!existing) {
          doc.lists.push(list);
          summary.lists++;
        } else {
          for (const modId of list.modIds) {
            if (!existing.modIds.includes(modId)) existing.modIds.push(modId);
          }
          existing.updatedAt = Date.now();
        }
      }
      touchGame(domain);
      summary.games++;
    }
    flushGames();
    return summary;
  }

  function promptImportFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let payload;
        try {
          payload = JSON.parse(String(reader.result));
        } catch (err) {
          logLine('import failed: file is not valid JSON');
          return;
        }
        const games = payload && payload.games ? Object.keys(payload.games).length : 0;
        // Merging is additive and the user can export first, but it still changes stored
        // data — so it is confirmed rather than done on a single stray click.
        if (!window.confirm(
          `Merge this export into your library?\n\n` +
          `${games} game(s) from ${payload && payload.exportedAt || 'unknown date'}.\n\n` +
          `Existing lists keep their names and gain any missing mods. ` +
          `Nothing is deleted, and download history is kept.`
        )) {
          logLine('import cancelled');
          return;
        }
        try {
          const s = mergeImport(payload);
          logLine(`imported: ${s.games} game(s), +${s.lists} list(s), +${s.mods} mod(s)`);
        } catch (err) {
          logLine('import failed: ' + (err && err.message));
        }
      };
      reader.onerror = () => logLine('import failed: could not read file');
      reader.readAsText(file);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  }

  // ==========================================================================
  // DOCK UI
  // ==========================================================================

  const ui = {};
  const logBuffer = [];
  const LOG_LIMIT = 200;

  function logLine(text) {
    const stamp = new Date().toLocaleTimeString();
    logBuffer.push(`${stamp}  ${text}`);
    while (logBuffer.length > LOG_LIMIT) logBuffer.shift();
    if (ui.log) {
      const div = document.createElement('div');
      div.textContent = text;
      ui.log.appendChild(div);
      while (ui.log.childElementCount > LOG_LIMIT) ui.log.firstElementChild.remove();
      ui.log.scrollTop = ui.log.scrollHeight;
    }
  }

  function readUiState() {
    const s = readJson(UI_KEY, null);
    return (s && typeof s === 'object') ? s : { collapsed: false };
  }

  function writeUiState(state) {
    writeJson(UI_KEY, state);
  }

  function injectStyle() {
    GM_addStyle(`
      #ncDock{position:fixed;right:16px;top:92px;z-index:2147483000;width:330px;max-height:78vh;
        display:flex;flex-direction:column;border:1px solid rgba(255,154,60,.34);border-radius:10px;
        background:#0b0906;color:#fff4e8;box-shadow:0 18px 60px rgba(0,0,0,.5);
        font:12px/1.35 Arial,Helvetica,sans-serif;overflow:hidden}
      #ncDock.nc-collapsed{max-height:none}
      #ncDock.nc-collapsed .nc-body{display:none}
      #ncDock .nc-head{height:36px;display:flex;align-items:center;gap:8px;padding:0 10px;flex:0 0 auto;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#241503,#0d1017)}
      #ncDock .nc-title{font-weight:900;color:#ff9a3c;letter-spacing:.02em}
      #ncDock .nc-badge{margin-left:auto;font:700 10px/1 Arial;color:#9c8b7c}
      #ncDock .nc-iconBtn{width:26px;height:26px;min-height:26px;padding:0;border-radius:6px;flex:0 0 auto}
      #ncDock .nc-body{display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0;overflow:auto}
      #ncDock button{appearance:none;width:100%;min-height:30px;padding:0 10px;
        border:1px solid rgba(255,255,255,.14);border-radius:7px;background:rgba(255,255,255,.07);
        color:#fff4e8;font:700 12px/1 Arial,sans-serif;cursor:pointer;text-align:center}
      #ncDock button:hover:not(:disabled){background:rgba(255,154,60,.18);border-color:rgba(255,154,60,.5)}
      #ncDock button:disabled{opacity:.4;cursor:default}
      #ncDock .nc-primary{background:#e07b1e;border-color:#ff9a3c;color:#160c02}
      #ncDock .nc-primary:hover:not(:disabled){background:#ff9a3c}
      #ncDock .nc-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      #ncDock .nc-ctx{border:1px solid rgba(255,255,255,.09);border-radius:8px;background:rgba(0,0,0,.24);padding:8px}
      #ncDock .nc-ctxTitle{font-weight:900;color:#ffd9b3;margin:0 0 3px;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap}
      #ncDock .nc-ctxMeta{color:#a1917f;font-weight:700;font-size:11px}
      #ncDock .nc-stats{display:flex;justify-content:space-between;gap:8px;font-weight:700}
      #ncDock .nc-stat{flex:1;text-align:center;border:1px solid rgba(255,255,255,.08);border-radius:7px;
        background:rgba(0,0,0,.2);padding:5px 3px}
      #ncDock .nc-statNum{display:block;font-size:15px;font-weight:900;color:#ff9a3c}
      #ncDock .nc-statLbl{display:block;font-size:10px;color:#9c8b7c;font-weight:700;text-transform:uppercase}
      #ncDock .nc-log{min-height:76px;max-height:190px;overflow:auto;border:1px solid rgba(255,255,255,.08);
        border-radius:7px;background:rgba(0,0,0,.28);padding:6px;color:#c9b8a8;white-space:pre-wrap;
        font:11px/1.4 ui-monospace,Menlo,Consolas,monospace}
      #ncDock .nc-log div{margin:0 0 3px}
      #ncDock.nc-busy .nc-ctx{opacity:.6}

      /* ---- modal primitive ---- */
      .ncOverlay{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.62);
        display:flex;align-items:center;justify-content:center;padding:24px;
        font:12px/1.4 Arial,Helvetica,sans-serif}
      .ncModal{display:flex;flex-direction:column;width:min(440px,100%);max-height:min(78vh,760px);
        border:1px solid rgba(255,154,60,.34);border-radius:11px;background:#0b0906;color:#fff4e8;
        box-shadow:0 24px 80px rgba(0,0,0,.6);overflow:hidden}
      .ncModalWide{width:min(940px,100%);height:min(74vh,680px)}
      .ncModalHead{flex:0 0 auto;height:40px;display:flex;align-items:center;gap:8px;padding:0 12px;
        border-bottom:1px solid rgba(255,255,255,.1);background:linear-gradient(90deg,#241503,#0d1017)}
      .ncModalTitle{font-weight:900;color:#ff9a3c}
      .ncModalHead .ncX{margin-left:auto;width:26px;height:26px;padding:0;border-radius:6px;
        border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#fff4e8;cursor:pointer}
      .ncModalBody{flex:1 1 auto;min-height:0;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
      .ncModalWide .ncModalBody{padding:0;overflow:hidden}
      .ncModalFoot{flex:0 0 auto;display:flex;gap:8px;justify-content:flex-end;padding:10px 12px;
        border-top:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.24)}
      .ncModalFoot button,.ncModalBody button{appearance:none;min-height:30px;padding:0 12px;
        border:1px solid rgba(255,255,255,.14);border-radius:7px;background:rgba(255,255,255,.07);
        color:#fff4e8;font:700 12px/1 Arial,sans-serif;cursor:pointer}
      .ncModalFoot button:hover:not(:disabled),.ncModalBody button:hover:not(:disabled){
        background:rgba(255,154,60,.18);border-color:rgba(255,154,60,.5)}
      .ncModalFoot button:disabled,.ncModalBody button:disabled{opacity:.35;cursor:default}
      .ncModalFoot .nc-primary{background:#e07b1e;border-color:#ff9a3c;color:#160c02}
      .ncModalFoot .nc-primary:disabled{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14);
        color:#fff4e8}
      .ncModalText{color:#d7c6b5}
      .ncFieldLabel{color:#a1917f;font-weight:700;margin:0 0 5px}
      .ncInput{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border-radius:7px;
        border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.3);color:#fff4e8;
        font:700 12px/1 Arial,sans-serif;outline:none}
      .ncInput:focus{border-color:rgba(255,154,60,.65)}

      /* ---- list picker ---- */
      .ncPickRows{display:flex;flex-direction:column;gap:5px}
      .ncPickRow{display:flex!important;align-items:center;gap:10px;width:100%;text-align:left}
      .ncPickRow:disabled{opacity:.45;cursor:default}
      .ncPickName{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ncPickMeta{flex:0 0 auto;font-size:11px;color:#9c8b7c;font-weight:700}

      /* ---- library ---- */
      .ncLib{display:grid;grid-template-columns:200px 260px 1fr;height:100%;min-height:0}
      .ncRail{border-right:1px solid rgba(255,255,255,.09);overflow:auto;padding:8px;display:flex;
        flex-direction:column;gap:4px;background:rgba(0,0,0,.2)}
      .ncRailItem{display:flex!important;flex-direction:column;gap:2px;align-items:flex-start;
        width:100%;text-align:left;padding:7px 9px!important;min-height:0!important}
      .ncRailItem.ncOn{background:rgba(255,154,60,.18)!important;border-color:rgba(255,154,60,.5)!important}
      .ncRailName{font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
      .ncRailMeta{font-size:10px;color:#9c8b7c;font-weight:700}
      .ncCol{display:flex;flex-direction:column;min-width:0;min-height:0;
        border-right:1px solid rgba(255,255,255,.09)}
      .ncColWide{border-right:0}
      .ncColHead{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 10px;
        border-bottom:1px solid rgba(255,255,255,.09);font-weight:900;color:#ffd9b3;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ncColHead span:first-child{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ncRows{flex:1 1 auto;min-height:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:4px}
      .ncRow{display:flex;align-items:stretch;gap:4px}
      .ncRow.ncOn .ncRowMain{background:rgba(255,154,60,.18);border-color:rgba(255,154,60,.5)}
      .ncRowMain{flex:1 1 auto;min-width:0;display:flex!important;flex-direction:column;gap:2px;
        align-items:flex-start;text-align:left;padding:7px 9px!important;text-decoration:none}
      .ncRowLink{border:1px solid rgba(255,255,255,.14);border-radius:7px;background:rgba(255,255,255,.07);
        color:#fff4e8;cursor:pointer}
      .ncRowLink:hover{background:rgba(255,154,60,.18);border-color:rgba(255,154,60,.5)}
      .ncRowName{font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
      .ncRowMeta{font-size:10px;color:#9c8b7c;font-weight:700;overflow:hidden;text-overflow:ellipsis;
        white-space:nowrap;max-width:100%}
      .ncMini{flex:0 0 auto;width:30px;min-height:0!important;padding:0!important;font-size:12px!important}
      .ncDanger:hover{background:rgba(226,64,44,.24)!important;border-color:rgba(226,64,44,.6)!important}
      .ncEmpty{color:#8d7d6f;padding:10px;text-align:center;font-weight:700}

      /* ---- dependency intake ---- */
      .ncIntake{display:flex;flex-direction:column;gap:10px;outline:none}
      .ncSatisfied{color:#9fd3a8}
      .ncDone{color:#9fd3a8;font-weight:700}
      .ncTable{width:100%;border-collapse:collapse;font-size:12px}
      .ncTable th{text-align:left;padding:6px 8px;color:#a1917f;font-size:10px;
        text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid rgba(255,255,255,.12)}
      .ncTable td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.07);vertical-align:top}
      .ncTable tr.ncRowDone{opacity:.5}
      .ncTable tr.ncRowCursor td{background:rgba(255,154,60,.13)}
      .ncDepLink{color:#ffd9b3;font-weight:900;text-decoration:none}
      .ncDepLink:hover{text-decoration:underline}
      .ncNoteCell{color:#c3b3a3;max-width:300px}
      .ncNoteText{display:inline}
      .ncChip{display:inline-block;padding:1px 6px;margin:0 6px 0 0;border-radius:999px;
        font-size:9px;font-weight:900;letter-spacing:.04em;vertical-align:1px}
      .ncChipOptional{background:rgba(120,160,255,.2);color:#a8c4ff;border:1px solid rgba(120,160,255,.45)}
      .ncChipRequired{background:rgba(226,110,44,.22);color:#ffb37a;border:1px solid rgba(226,110,44,.5)}
      .ncChipMuted{background:rgba(255,255,255,.09);color:#b0a094;border:1px solid rgba(255,255,255,.16)}
      .ncActionCell{white-space:nowrap;text-align:right}
      .ncMiniWide{min-height:26px!important;padding:0 8px!important;margin-left:4px;font-size:11px!important}
      .ncAddedTag{color:#9fd3a8;font-weight:900;font-size:11px}
      .ncInfoBox{border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(0,0,0,.24);padding:9px}
      .ncInfoLine{margin:0 0 5px;color:#c3b3a3}
      .ncInfoFoot{color:#8d7d6f;font-size:11px;border-top:1px solid rgba(255,255,255,.08);padding-top:6px}
      .ncCheckRow{display:flex;align-items:center;gap:7px;color:#c3b3a3;cursor:pointer;font-weight:700}
      .ncCheckRow input{width:14px;height:14px;accent-color:#e07b1e}
      .ncHint{color:#7f7166;font-size:10px;font-weight:700}

      /* ---- queue ---- */
      #ncDock .nc-queue{display:flex;flex-direction:column;gap:6px;padding:8px;
        border:1px solid rgba(255,154,60,.28);border-radius:8px;background:rgba(255,154,60,.06)}
      #ncDock .nc-queue[hidden]{display:none}
      #ncDock .nc-qTop{display:flex;justify-content:space-between;gap:8px;font-weight:900;
        color:#ffd9b3;font-size:11px}
      #ncDock .nc-bar{height:8px;border-radius:999px;background:rgba(0,0,0,.4);overflow:hidden}
      #ncDock #ncQFill{height:8px;width:0;background:linear-gradient(90deg,#e07b1e,#ffc178);
        transition:width 180ms ease}
      #ncDock .nc-qFile{font:11px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#c9b8a8;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:14px}
      #ncDock .nc-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px}
      #ncDock .nc-row3 button{min-height:26px;font-size:11px}
      #ncDock .nc-fails{border-top:1px solid rgba(255,255,255,.12);padding-top:6px;
        max-height:120px;overflow:auto}
      #ncDock .nc-fails[hidden]{display:none}
      #ncDock .nc-failHead{display:flex;align-items:center;gap:6px;color:#ff9c8a;
        font-weight:900;font-size:11px;margin:0 0 4px}
      #ncDock .nc-failHead button{width:24px;min-height:22px!important;padding:0!important;margin-left:auto}
      #ncDock .nc-failRow{font:10px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#b09c92;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ncDlState{position:absolute;right:8px;top:7px;font-weight:900;font-size:12px}
      .ncDlOk{color:#7fc98d}
      .ncDlStale{color:#ffb347}
      .ncDlNone{color:#6b5f55}
      .ncRow .ncRowMain{position:relative;padding-right:24px!important}
      .ncColHead .ncMiniWide{flex:0 0 auto}
    `);
  }

  function buildDock() {
    const panel = document.createElement('div');
    panel.id = 'ncDock';
    panel.innerHTML = `
      <div class="nc-head">
        <span class="nc-title">Nexus Curator</span>
        <span class="nc-badge" id="ncBadge"></span>
        <button class="nc-iconBtn" id="ncCollapse" type="button" title="Collapse">▴</button>
      </div>
      <div class="nc-body">
        <div class="nc-ctx">
          <div class="nc-ctxTitle" id="ncCtxTitle">—</div>
          <div class="nc-ctxMeta" id="ncCtxMeta"></div>
        </div>
        <div class="nc-stats">
          <div class="nc-stat"><span class="nc-statNum" id="ncStatLists">0</span><span class="nc-statLbl">Lists</span></div>
          <div class="nc-stat"><span class="nc-statNum" id="ncStatMods">0</span><span class="nc-statLbl">Mods</span></div>
          <div class="nc-stat"><span class="nc-statNum" id="ncStatGames">0</span><span class="nc-statLbl">Games</span></div>
        </div>
        <div class="nc-queue" id="ncQueue" hidden>
          <div class="nc-qTop"><span id="ncQCount"></span><span id="ncQEta"></span></div>
          <div class="nc-bar"><div id="ncQFill"></div></div>
          <div class="nc-qFile" id="ncQFile"></div>
          <div class="nc-row3">
            <button id="ncQPause" type="button">Pause</button>
            <button id="ncQSkip" type="button">Skip</button>
            <button id="ncQCancel" type="button">Cancel</button>
          </div>
          <div class="nc-fails" id="ncFails" hidden></div>
        </div>
        <button class="nc-primary" id="ncAdd" type="button">Add to list…</button>
        <button id="ncLibrary" type="button">Library</button>
        <div class="nc-row">
          <button id="ncExport" type="button">Export</button>
          <button id="ncImport" type="button">Import</button>
        </div>
        <div class="nc-log" id="ncLog"></div>
      </div>
    `;
    document.body.appendChild(panel);

    ui.panel = panel;
    ui.badge = panel.querySelector('#ncBadge');
    ui.ctxTitle = panel.querySelector('#ncCtxTitle');
    ui.ctxMeta = panel.querySelector('#ncCtxMeta');
    ui.statLists = panel.querySelector('#ncStatLists');
    ui.statMods = panel.querySelector('#ncStatMods');
    ui.statGames = panel.querySelector('#ncStatGames');
    ui.library = panel.querySelector('#ncLibrary');
    ui.addBtn = panel.querySelector('#ncAdd');
    ui.log = panel.querySelector('#ncLog');
    ui.collapse = panel.querySelector('#ncCollapse');

    const state = readUiState();
    if (state.collapsed) {
      panel.classList.add('nc-collapsed');
      ui.collapse.textContent = '▾';
    }

    ui.collapse.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('nc-collapsed');
      ui.collapse.textContent = collapsed ? '▾' : '▴';
      const s = readUiState();
      s.collapsed = collapsed;
      writeUiState(s);
    });

    panel.querySelector('#ncExport').addEventListener('click', () => {
      const ctx = ui.context;
      const domain = ctx && ctx.gameDomain;
      const payload = exportPayload(null);
      const count = Object.keys(payload.games).length;
      if (!count) { logLine('nothing to export yet'); return; }
      downloadJson(payload, `nexus-curator-${new Date().toISOString().slice(0, 10)}.json`);
      if (domain) logLine(`exporting all ${count} game(s)`);
    });

    panel.querySelector('#ncImport').addEventListener('click', promptImportFile);

    ui.library.addEventListener('click', openLibrary);
    ui.addBtn.addEventListener('click', addCurrentModToList);

    ui.queue = panel.querySelector('#ncQueue');
    ui.qCount = panel.querySelector('#ncQCount');
    ui.qEta = panel.querySelector('#ncQEta');
    ui.qFill = panel.querySelector('#ncQFill');
    ui.qFile = panel.querySelector('#ncQFile');
    ui.qPause = panel.querySelector('#ncQPause');
    ui.fails = panel.querySelector('#ncFails');

    ui.qPause.addEventListener('click', () => {
      queue.paused = !queue.paused;
      if (!queue.paused) { logLine('resumed'); runQueue(); }
      else logLine('pausing after the current file…');
      renderQueue();
    });
    panel.querySelector('#ncQSkip').addEventListener('click', () => {
      const item = queue.items.find(i => i.status === 'active') ||
                   queue.items.find(i => i.status === 'pending');
      if (!item) return;
      item.status = 'failed';
      item.error = 'skipped';
      saveQueue();
      logLine(`skipped ${item.modName} / ${item.fileName}`);
      renderQueue();
    });
    panel.querySelector('#ncQCancel').addEventListener('click', async () => {
      const c = queueCounts();
      const okCancel = await confirmModal('Cancel queue',
        `Drop the remaining ${c.pending} item(s)? ${c.done} already saved stay on disk.`, 'Drop them');
      if (!okCancel) return;
      queue.paused = true;
      clearQueue();
      logLine('queue cancelled');
    });
  }

  function setQueueStatus(text) {
    if (ui.qFile) ui.qFile.textContent = text || '';
  }

  function renderQueue() {
    if (!ui.queue) return;
    const c = queueCounts();
    if (!c.total) {
      ui.queue.hidden = true;
      return;
    }
    ui.queue.hidden = false;

    const finished = c.done + c.failed;
    ui.qCount.textContent = `${finished}/${c.total}` +
      (c.failed ? ` · ${c.failed} failed` : '') +
      (queue.paused ? ' · paused' : '');

    const eta = queue.running && !queue.paused ? etaMs() : null;
    ui.qEta.textContent = eta ? `~${fmtDuration(eta)} left` : '';

    // Overall progress, nudged by the current file's own progress so the bar moves
    // during a long transfer instead of sitting still for minutes.
    const frac = c.total ? (finished + (queue.progress || 0)) / c.total : 0;
    ui.qFill.style.width = Math.max(0, Math.min(100, frac * 100)) + '%';

    ui.qPause.textContent = queue.paused ? 'Resume' : 'Pause';

    if (!c.failed) {
      ui.fails.hidden = true;
      ui.fails.textContent = '';
    } else {
      ui.fails.hidden = false;
      ui.fails.textContent = '';
      const head = document.createElement('div');
      head.className = 'nc-failHead';
      head.textContent = `${c.failed} failed`;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'ncMini';
      retry.textContent = '↻';
      retry.title = 'Retry all failed';
      retry.addEventListener('click', retryFailed);
      head.appendChild(retry);
      ui.fails.appendChild(head);
      for (const i of queue.items.filter(x => x.status === 'failed').slice(0, 8)) {
        const row = document.createElement('div');
        row.className = 'nc-failRow';
        row.textContent = `${i.modName} / ${i.fileName} — ${i.error || 'failed'}`;
        row.title = i.path;
        ui.fails.appendChild(row);
      }
    }
  }

  /*
    The dock is page-contextual: on a mod page it names the mod, elsewhere it just reports
    the library. Parsing here is deliberately cheap — the header block only, never the
    full record — because this runs on every page load including search and forum pages.
  */
  function detectContext() {
    const parsed = parseModUrl(location.href);
    if (!parsed) return { kind: 'other' };
    const ctx = parseContext(document, location.href);
    return {
      kind: 'mod',
      gameDomain: ctx.gameDomain,
      gameId: ctx.gameId,
      gameName: ctx.gameName,
      modId: ctx.modId,
      url: ctx.url,
      name: txt(document.querySelector(SEL.pageTitle)) || `Mod ${ctx.modId}`,
      version: parseHeaderVersion(document)
    };
  }

  function renderDock() {
    if (!ui.panel) return;
    const ctx = ui.context;
    const idx = readIndex();
    const gameCount = Object.keys(idx.games).length;

    if (ctx && ctx.kind === 'mod') {
      const stats = gameStats(ctx.gameDomain);
      const inLists = listsContainingMod(ctx.gameDomain, ctx.modId);
      ui.ctxTitle.textContent = ctx.name;
      ui.ctxTitle.title = ctx.name;
      const bits = [ctx.gameName || ctx.gameDomain];
      if (ctx.version) bits.push('v' + ctx.version);
      bits.push(inLists.length
        ? `in ${inLists.length} list${inLists.length === 1 ? '' : 's'}`
        : 'not in any list');
      ui.ctxMeta.textContent = bits.join(' · ');
      ui.statLists.textContent = stats.lists;
      ui.statMods.textContent = stats.mods;
      ui.badge.textContent = ctx.gameDomain;
      ui.addBtn.disabled = false;
      ui.addBtn.textContent = inLists.length ? 'Add to another list…' : 'Add to list…';
    } else {
      ui.ctxTitle.textContent = 'No mod on this page';
      ui.ctxMeta.textContent = 'Open a mod page to add it to a list.';
      ui.addBtn.disabled = true;
      ui.addBtn.textContent = 'Add to list…';
      const totals = Object.values(idx.games).reduce(
        (a, g) => ({ lists: a.lists + (g.lists || 0), mods: a.mods + (g.mods || 0) }),
        { lists: 0, mods: 0 }
      );
      ui.statLists.textContent = totals.lists;
      ui.statMods.textContent = totals.mods;
      ui.badge.textContent = '';
    }
    ui.statGames.textContent = gameCount;
  }

  // ==========================================================================
  // NETWORK
  // ==========================================================================

  const FETCH_GAP_MS = 700;
  let lastFetchAt = 0;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /*
    Every page fetch goes through here so there is exactly one place that controls how
    fast this script talks to Nexus. Serialised and spaced — never parallel. See §1 of
    the design doc: staying at or under human click speed is the whole posture.
  */
  async function politeFetchDoc(url) {
    const wait = FETCH_GAP_MS - (Date.now() - lastFetchAt);
    if (wait > 0) await sleep(wait);
    lastFetchAt = Date.now();

    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    // Nexus answers "not found" and adult-content gates with a 200 and a normal-looking
    // page, so status alone proves nothing. The mod title is the real test.
    if (!doc.querySelector(SEL.pageTitle)) {
      throw new Error('no mod on that page (deleted, hidden, or adult-gated for this account?)');
    }
    return doc;
  }

  /*
    Build a full Mod record for a URL. Reuses the live document for whichever tab we are
    already looking at, so adding the mod you are reading costs one request, not two.
  */
  async function resolveModRecord(modUrl) {
    const parsed = parseModUrl(modUrl);
    if (!parsed) throw new Error('not a Nexus mod URL');

    const here = parseModUrl(location.href);
    const onThisMod = !!here && here.url === parsed.url;
    const tab = new URLSearchParams(location.search).get('tab');

    const descDoc = (onThisMod && (!tab || tab === 'description'))
      ? document
      : await politeFetchDoc(parsed.url + '?tab=description');

    const filesDoc = (onThisMod && tab === 'files')
      ? document
      : await politeFetchDoc(parsed.url + '?tab=files');

    const record = parseModPage({ descDoc, filesDoc, url: parsed.url });
    record.state = 'resolved';
    record.resolvedAt = Date.now();
    return record;
  }

  // ==========================================================================
  // MODAL PRIMITIVE
  // ==========================================================================

  const modalStack = [];

  function openModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'ncOverlay';

    const panel = document.createElement('div');
    panel.className = 'ncModal' + (opts.wide ? ' ncModalWide' : '');

    const head = document.createElement('div');
    head.className = 'ncModalHead';
    const title = document.createElement('span');
    title.className = 'ncModalTitle';
    title.textContent = opts.title || '';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ncX';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    head.append(title, closeBtn);

    const body = document.createElement('div');
    body.className = 'ncModalBody';
    if (opts.bodyNode) body.appendChild(opts.bodyNode);

    panel.append(head, body);

    let foot = null;
    if (opts.actions && opts.actions.length) {
      foot = document.createElement('div');
      foot.className = 'ncModalFoot';
      for (const action of opts.actions) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = action.label;
        if (action.primary) b.className = 'nc-primary';
        b.addEventListener('click', () => action.onClick(api));
        foot.appendChild(b);
      }
      panel.appendChild(foot);
    }

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let closed = false;
    const api = {
      body,
      close(result) {
        if (closed) return;
        closed = true;
        overlay.remove();
        const i = modalStack.indexOf(api);
        if (i >= 0) modalStack.splice(i, 1);
        if (opts.onClose) opts.onClose(result);
      }
    };
    modalStack.push(api);

    closeBtn.addEventListener('click', () => api.close(null));
    // Clicking the backdrop closes, but only the backdrop itself — a click that started
    // inside the panel and drifted out must not count as "dismiss".
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) api.close(null);
    });

    return api;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !modalStack.length) return;
    e.stopPropagation();
    e.preventDefault();
    modalStack[modalStack.length - 1].close(null);
  }, true);

  // A tiny inline prompt, because window.prompt is blocked on some pages and looks alien.
  function textPromptModal(opts) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'ncFieldLabel';
      label.textContent = opts.label || '';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'ncInput';
      input.value = opts.value || '';
      input.placeholder = opts.placeholder || '';
      wrap.append(label, input);

      let settled = false;
      const finish = (value) => { if (settled) return; settled = true; resolve(value); };

      const modal = openModal({
        title: opts.title || 'Name',
        bodyNode: wrap,
        onClose: () => finish(null),
        actions: [
          { label: opts.confirmLabel || 'OK', primary: true, onClick: (m) => {
            const v = input.value.trim();
            if (!v) { input.focus(); return; }
            finish(v);
            m.close();
          } },
          { label: 'Cancel', onClick: (m) => { finish(null); m.close(); } }
        ]
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const v = input.value.trim();
          if (!v) return;
          finish(v);
          modal.close();
        }
      });
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  function confirmModal(title, message, confirmLabel) {
    return new Promise((resolve) => {
      const p = document.createElement('div');
      p.className = 'ncModalText';
      p.textContent = message;
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; resolve(v); };
      openModal({
        title,
        bodyNode: p,
        onClose: () => finish(false),
        actions: [
          { label: confirmLabel || 'Confirm', primary: true, onClick: (m) => { finish(true); m.close(); } },
          { label: 'Cancel', onClick: (m) => { finish(false); m.close(); } }
        ]
      });
    });
  }

  // ==========================================================================
  // ADD TO LIST
  // ==========================================================================

  /*
    Pick a list. Resolves to a list id, or null if cancelled.

    `opts.marksModId` greys out lists that already contain that mod — telling you it's
    already there is more useful than hiding the row and leaving you wondering.
    `opts.excludeListId` hides a list outright (used for "add to an *existing* list",
    where offering the list you're already working in is just noise).
  */
  function pickListModal(domain, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const doc = getGame(domain);
      const candidates = doc.lists.filter(l => l.id !== o.excludeListId);
      const wrap = document.createElement('div');
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; resolve(v); };

      const intro = document.createElement('div');
      intro.className = 'ncModalText';
      intro.textContent = candidates.length
        ? (o.intro || 'Which list?')
        : `No other lists in ${doc.name} yet. Make one.`;
      wrap.appendChild(intro);

      const rows = document.createElement('div');
      rows.className = 'ncPickRows';
      for (const list of candidates) {
        const has = o.marksModId ? list.modIds.includes(o.marksModId) : false;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ncPickRow';
        row.disabled = has;
        const name = document.createElement('span');
        name.className = 'ncPickName';
        name.textContent = list.name;
        const meta = document.createElement('span');
        meta.className = 'ncPickMeta';
        meta.textContent = has
          ? 'already in this list'
          : `${list.modIds.length} mod${list.modIds.length === 1 ? '' : 's'}`;
        row.append(name, meta);
        row.addEventListener('click', () => { finish(list.id); modal.close(); });
        rows.appendChild(row);
      }
      wrap.appendChild(rows);

      const modal = openModal({
        title: o.title || 'Choose a list',
        bodyNode: wrap,
        onClose: () => finish(null),
        actions: [
          { label: 'New list…', primary: true, onClick: async (m) => {
            const name = await textPromptModal({
              title: 'New list',
              label: `A new list in ${doc.name}`,
              placeholder: 'e.g. Core Utilities',
              confirmLabel: 'Create'
            });
            if (!name) return;
            const list = createList(domain, name);
            finish(list.id);
            m.close();
          } },
          { label: 'Cancel', onClick: (m) => { finish(null); m.close(); } }
        ]
      });
    });
  }

  function chooseListModal(domain, modId, modName) {
    return pickListModal(domain, {
      title: 'Add to list',
      intro: `Add "${modName}" to which list?`,
      marksModId: modId
    });
  }

  // ==========================================================================
  // DEPENDENCY INTAKE
  // ==========================================================================

  const MAX_RECURSION_ADDS = 25;

  /*
    Sort a mod's requirements against what the game's lists already hold.

    "Have it" means it is in some list — not merely that a record exists. A mod sitting in
    the library but in no list is not installed by any list you'd build, so it counts as
    missing (adding it is then cheap, since the record is already there).
  */
  function bucketDependencies(domain, listId, record) {
    const out = { here: [], elsewhere: [], missing: [], offsite: [], dlc: [] };
    for (const dep of record.deps || []) {
      const lists = dep.modId ? listsContainingMod(domain, dep.modId) : [];
      if (lists.some(l => l.id === listId)) out.here.push({ dep, lists });
      else if (lists.length) out.elsewhere.push({ dep, lists });
      else out.missing.push({ dep, lists: [] });
    }
    for (const dep of record.offsiteDeps || []) out.offsite.push({ dep });
    for (const dep of record.dlcDeps || []) out.dlc.push({ dep });
    return out;
  }

  // Add a dependency without reading its page. A stub costs nothing and is upgraded
  // later — which is what makes "add all 9" instant instead of nine page loads.
  function addDepAsStub(domain, dep, listId) {
    if (!dep.modId) return false;
    const existing = getGame(domain).mods[dep.modId];
    if (!existing) {
      upsertMod(domain, {
        modId: dep.modId,
        name: dep.name,
        url: dep.url,
        gameDomain: domain,
        depNote: dep.note || '',
        state: 'stub',
        files: { main: [], optional: [], old: [] },
        deps: [],
        download: { files: {} }
      });
    }
    return addModToList(domain, listId, dep.modId);
  }

  function listLabel(lists, listId) {
    return lists.map(l => (l.id === listId ? 'this list' : l.name)).join(', ');
  }

  /*
    The whole point of this popup is that it says something true and specific in every
    situation, rather than emitting a fixed template with zeroes in it. Six shapes:

      none          -> no popup at all, one log line
      allHere       -> nothing to decide; a log line, no modal
      allSatisfied  -> modal, no table (the cross-list fact IS the message)
      missing       -> the full modal
      infoOnly      -> off-site / DLC only; nothing is addable, so no action buttons
  */
  function intakeShape(buckets) {
    const modDeps = buckets.here.length + buckets.elsewhere.length + buckets.missing.length;
    const extras = buckets.offsite.length + buckets.dlc.length;
    if (!modDeps && !extras) return 'none';
    if (!modDeps && extras) return 'infoOnly';
    if (buckets.missing.length) return 'missing';
    if (buckets.elsewhere.length || extras) return 'allSatisfied';
    return 'allHere';
  }

  function buildSatisfiedLine(buckets, listId, gameName) {
    const satisfied = [...buckets.here, ...buckets.elsewhere];
    if (!satisfied.length) return null;
    const names = satisfied
      .map(s => `${s.dep.name} (${listLabel(s.lists, listId)})`)
      .join(', ');
    return `You already have ${satisfied.length} of them in your lists for ${gameName}: ${names}.`;
  }

  function buildExtrasNode(buckets) {
    if (!buckets.offsite.length && !buckets.dlc.length) return null;
    const box = document.createElement('div');
    box.className = 'ncInfoBox';
    for (const [label, items] of [['Off-site', buckets.offsite], ['Game DLC', buckets.dlc]]) {
      if (!items.length) continue;
      const line = document.createElement('div');
      line.className = 'ncInfoLine';
      const tag = document.createElement('span');
      tag.className = 'ncChip ncChipMuted';
      tag.textContent = label;
      line.appendChild(tag);
      const text = document.createElement('span');
      text.textContent = items.map(i => i.dep.name).join(', ');
      line.appendChild(text);
      box.appendChild(line);
    }
    const foot = document.createElement('div');
    foot.className = 'ncInfoFoot';
    foot.textContent = 'These are not on Nexus, so Curator can\'t add or download them — install them yourself.';
    box.appendChild(foot);
    return box;
  }

  function noteCell(dep) {
    const cell = document.createElement('td');
    cell.className = 'ncNoteCell';
    if (dep.noteTag) {
      const chip = document.createElement('span');
      chip.className = 'ncChip ' + (
        /OPTIONAL|RECOMMENDED/.test(dep.noteTag) ? 'ncChipOptional' : 'ncChipRequired'
      );
      chip.textContent = dep.noteTag;
      cell.appendChild(chip);
    } else if (dep.hard) {
      const chip = document.createElement('span');
      chip.className = 'ncChip ncChipRequired';
      chip.textContent = 'REQUIRED';
      chip.title = 'Declared as a hard requirement on the file, with no author note';
      cell.appendChild(chip);
    }
    // The chip already shows the tag, so don't print "OPTIONAL" twice — strip the
    // matched prefix and any separator after it, keeping the author's actual sentence.
    let noteText = dep.note || '';
    if (dep.noteTag && noteText) {
      noteText = noteText.replace(NOTE_TAG_RE, '').replace(/^\s*[-–—:;,]\s*/, '').trim();
    }

    const text = document.createElement('span');
    text.className = 'ncNoteText';
    // The author simply wrote nothing. An em-dash says that; an empty cell looks broken.
    text.textContent = noteText || (dep.noteTag || dep.hard ? '' : '—');
    cell.appendChild(text);
    return cell;
  }

  function showDependencyIntake(domain, listId, record) {
    return new Promise((resolve) => {
      const doc = getGame(domain);
      const list = getList(domain, listId);
      const gameName = doc.name;
      const buckets = bucketDependencies(domain, listId, record);
      const shape = intakeShape(buckets);
      const totalModDeps = buckets.here.length + buckets.elsewhere.length + buckets.missing.length;

      const added = [];
      let settled = false;
      const finish = () => { if (settled) return; settled = true; flushGames(); renderDock(); resolve(added); };

      if (shape === 'none') { finish(); return; }

      if (shape === 'allHere') {
        logLine(`${record.name}: all ${totalModDeps} dependenc${totalModDeps === 1 ? 'y is' : 'ies are'} already in ${list.name}.`);
        finish();
        return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'ncIntake';

      // ---- headline
      const head = document.createElement('div');
      head.className = 'ncModalText';
      if (shape === 'infoOnly') {
        head.innerHTML = `<b>${escapeHtml(record.name)}</b> has no Nexus dependencies, but the author lists other requirements.`;
      } else {
        head.innerHTML = `<b>${escapeHtml(record.name)}</b> has <b>${totalModDeps}</b> dependenc${totalModDeps === 1 ? 'y' : 'ies'}.`;
      }
      wrap.appendChild(head);

      const satisfiedLine = buildSatisfiedLine(buckets, listId, gameName);
      if (satisfiedLine) {
        const s = document.createElement('div');
        s.className = 'ncModalText ncSatisfied';
        s.textContent = satisfiedLine;
        wrap.appendChild(s);
      }

      // ---- the table of what's missing
      let table = null, tbody = null, missingHead = null, keyHint = null;
      const rowState = [];
      let cursor = -1;

      const refreshCount = () => {
        const left = rowState.filter(r => !r.done).length;
        if (missingHead) {
          missingHead.textContent = left
            ? `You don't have ${left === totalModDeps ? 'these' : `these ${left}`} yet:`
            : '';
        }
        if (!left && table) {
          if (missingHead) missingHead.remove();
          const doneMsg = document.createElement('div');
          doneMsg.className = 'ncModalText ncDone';
          doneMsg.textContent = `Added ${added.length} mod${added.length === 1 ? '' : 's'}. Nothing left outstanding.`;
          // replaceWith, not remove-then-append: the confirmation belongs where the
          // table was, not below the checkbox and the now-irrelevant keyboard hint.
          table.replaceWith(doneMsg);
          table = null;
          if (keyHint) keyHint.remove();
          for (const b of footerAddButtons) b.disabled = true;
        }
      };

      const commit = (entry, targetListId, targetName) => {
        if (entry.done) return;
        addDepAsStub(domain, entry.dep, targetListId);
        entry.done = true;
        entry.tr.classList.add('ncRowDone');
        entry.actionCell.textContent = '';
        const ok = document.createElement('span');
        ok.className = 'ncAddedTag';
        ok.textContent = '✓ ' + targetName;
        entry.actionCell.appendChild(ok);
        added.push({ modId: entry.dep.modId, listId: targetListId, name: entry.dep.name });
        logLine(`+ ${entry.dep.name} → ${targetName}`);
        refreshCount();
      };

      const setCursor = (i) => {
        const live = rowState.filter(r => !r.done);
        if (!live.length) { cursor = -1; return; }
        cursor = Math.max(0, Math.min(i, live.length - 1));
        for (const r of rowState) r.tr.classList.remove('ncRowCursor');
        live[cursor].tr.classList.add('ncRowCursor');
        live[cursor].tr.scrollIntoView({ block: 'nearest' });
      };

      if (buckets.missing.length) {
        missingHead = document.createElement('div');
        missingHead.className = 'ncModalText';
        wrap.appendChild(missingHead);

        table = document.createElement('table');
        table.className = 'ncTable';
        table.innerHTML = `<thead><tr>
          <th>Mod</th><th>Author's note</th><th colspan="3">Add to…</th>
        </tr></thead>`;
        tbody = document.createElement('tbody');
        table.appendChild(tbody);

        for (const item of buckets.missing) {
          const dep = item.dep;
          const tr = document.createElement('tr');

          const nameTd = document.createElement('td');
          const link = document.createElement('a');
          link.href = dep.url || '#';
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = dep.name;
          link.className = 'ncDepLink';
          nameTd.appendChild(link);
          tr.appendChild(nameTd);

          tr.appendChild(noteCell(dep));

          const actionCell = document.createElement('td');
          actionCell.className = 'ncActionCell';
          actionCell.colSpan = 3;

          const entry = { dep, tr, actionCell, done: false };
          rowState.push(entry);

          const bThis = document.createElement('button');
          bThis.type = 'button';
          bThis.className = 'ncMiniWide';
          bThis.textContent = '+ This list';
          bThis.addEventListener('click', () => commit(entry, listId, list.name));

          const bExisting = document.createElement('button');
          bExisting.type = 'button';
          bExisting.className = 'ncMiniWide';
          bExisting.textContent = '+ Existing ▾';
          bExisting.addEventListener('click', async () => {
            const id = await pickListModal(domain, {
              title: `Add ${dep.name}`,
              intro: `Add "${dep.name}" to which list?`,
              excludeListId: listId,
              marksModId: dep.modId
            });
            if (!id) return;
            commit(entry, id, getList(domain, id).name);
          });

          const bNew = document.createElement('button');
          bNew.type = 'button';
          bNew.className = 'ncMiniWide';
          bNew.textContent = '+ New…';
          bNew.addEventListener('click', async () => {
            const name = await textPromptModal({
              title: 'New list',
              label: `Put "${dep.name}" in a new list`,
              placeholder: 'e.g. Requirements',
              confirmLabel: 'Create'
            });
            if (!name) return;
            const created = createList(domain, name);
            commit(entry, created.id, created.name);
          });

          actionCell.append(bThis, bExisting, bNew);
          tr.appendChild(actionCell);
          tbody.appendChild(tr);
        }
        wrap.appendChild(table);
      }

      const extras = buildExtrasNode(buckets);
      if (extras) wrap.appendChild(extras);

      // ---- recursion opt-in
      let recurse = null;
      if (buckets.missing.length) {
        const label = document.createElement('label');
        label.className = 'ncCheckRow';
        recurse = document.createElement('input');
        recurse.type = 'checkbox';
        const span = document.createElement('span');
        span.textContent = "Also check the added mods' own dependencies (one level, reads each page)";
        label.append(recurse, span);
        wrap.appendChild(label);

        keyHint = document.createElement('div');
        keyHint.className = 'ncHint';
        keyHint.textContent = '↑↓ move · Enter adds the highlighted mod to this list · Esc closes';
        wrap.appendChild(keyHint);
      }

      // ---- footer
      const footerAddButtons = [];
      const actions = [];
      if (buckets.missing.length) {
        const addAll = (getTarget, labelFor) => async () => {
          const target = await getTarget();
          if (!target) return;
          for (const entry of rowState.slice()) {
            if (!entry.done) commit(entry, target.id, target.name);
          }
        };
        const bAllThis = { label: 'Add all to this list', primary: true, onClick: () =>
          addAll(async () => ({ id: listId, name: list.name }))() };
        const bAllExisting = { label: 'Add all to an existing list', onClick: () =>
          addAll(async () => {
            const id = await pickListModal(domain, {
              title: 'Add all', intro: 'Add all outstanding dependencies to which list?',
              excludeListId: listId
            });
            return id ? { id, name: getList(domain, id).name } : null;
          })() };
        const bAllNew = { label: 'Add all to a new list', onClick: () =>
          addAll(async () => {
            const name = await textPromptModal({
              title: 'New list', label: 'Put all outstanding dependencies in a new list',
              placeholder: 'e.g. Requirements', confirmLabel: 'Create'
            });
            if (!name) return null;
            const created = createList(domain, name);
            return { id: created.id, name: created.name };
          })() };
        actions.push(bAllThis, bAllExisting, bAllNew);
      }
      actions.push({ label: buckets.missing.length ? 'Cancel' : 'Close', onClick: (m) => m.close() });

      const modal = openModal({
        title: buckets.missing.length ? 'Dependencies' : 'Requirements',
        bodyNode: wrap,
        wide: buckets.missing.length > 0,
        onClose: async () => {
          const wantRecurse = recurse && recurse.checked && added.length;
          finish();
          if (wantRecurse) await recurseIntoAdded(domain, added);
        },
        actions
      });

      // Capture the rendered footer buttons so "nothing outstanding" can disable them.
      if (modal.body.parentElement) {
        const foot = modal.body.parentElement.querySelector('.ncModalFoot');
        if (foot) {
          const btns = [...foot.querySelectorAll('button')];
          // every button except the trailing Cancel/Close
          footerAddButtons.push(...btns.slice(0, -1));
        }
      }

      refreshCount();

      // ---- keyboard
      wrap.addEventListener('keydown', (e) => {
        if (!rowState.length) return;
        const live = rowState.filter(r => !r.done);
        if (!live.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(cursor + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(cursor - 1); }
        else if (e.key === 'Enter' && cursor >= 0) {
          e.preventDefault();
          commit(live[cursor], listId, list.name);
          setCursor(cursor);
        }
      });
      wrap.tabIndex = -1;
      setTimeout(() => wrap.focus(), 0);
    });
  }

  /*
    One level only, and opt-in. Unbounded recursion would turn a single add into a
    cascade of page reads and popups; one level is the depth that answers "what did I
    just drag in?" without becoming a crawl.
  */
  async function recurseIntoAdded(domain, added) {
    const targets = added.slice(0, MAX_RECURSION_ADDS);
    if (added.length > targets.length) {
      logLine(`checking the first ${MAX_RECURSION_ADDS} of ${added.length} added mods`);
    }
    for (const item of targets) {
      const mod = getGame(domain).mods[item.modId];
      if (!mod || mod.state === 'resolved') continue;
      setBusy(true, `reading ${item.name}…`);
      try {
        logLine(`reading ${item.name}…`);
        const record = await resolveModRecord(mod.url);
        upsertMod(domain, record);
        flushGames();
        await showDependencyIntake(domain, item.listId, record);
      } catch (err) {
        logLine(`could not read ${item.name}: ${err && err.message}`);
      } finally {
        setBusy(false);
      }
    }
  }

  async function addCurrentModToList() {
    const ctx = ui.context;
    if (!ctx || ctx.kind !== 'mod') return;

    ensureGame(ctx);
    const listId = await chooseListModal(ctx.gameDomain, ctx.modId, ctx.name);
    if (!listId) { logLine('add cancelled'); return; }

    const list = getList(ctx.gameDomain, listId);
    setBusy(true, 'reading mod page…');
    try {
      logLine(`resolving ${ctx.name}…`);
      const record = await resolveModRecord(ctx.url);
      upsertMod(ctx.gameDomain, record);
      addModToList(ctx.gameDomain, listId, ctx.modId);
      flushGames();

      const files = record.files.main.length;
      const deps = record.deps.length;
      logLine(`added "${record.name}" to ${list.name} — ${files} main file${files === 1 ? '' : 's'}, ${deps} dependenc${deps === 1 ? 'y' : 'ies'}`);

      setBusy(false);
      await showDependencyIntake(ctx.gameDomain, listId, record);
    } catch (err) {
      logLine('add failed: ' + (err && err.message));
    } finally {
      setBusy(false);
      renderDock();
    }
  }

  // ==========================================================================
  // DOWNLOAD ENGINE
  // ==========================================================================

  const RESOLVE_URL =
    'https://www.nexusmods.com/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl';
  const GATE_FLOOR_MS = 5000;      // never faster than this, even if the page says less
  const INTER_FILE_MS = 1500;      // breathing room between transfers
  const MAX_ATTEMPTS = 3;
  const AUTH_FAIL_LIMIT = 3;       // consecutive "no url" answers => stop the whole queue
  const QUEUE_KEY = 'nc:queue';
  const ROOT_FOLDER = 'Nexus Mods';

  /*
    The free-tier countdown is a client-side value (see design §1). The endpoint answers
    without it. We wait anyway, and we wait for the LARGER of the floor and whatever the
    page most recently advertised. Do not "optimise" this away.
  */
  function gateMs() {
    const observed = Number(readUiState().countdownSeconds) || 0;
    return Math.max(GATE_FLOOR_MS, observed * 1000);
  }

  /*
    Ask Nexus for a CDN link.

    The critical detail: a logged-out or ineligible request comes back as **HTTP 200 with
    a body of `[]`** — not an error status. Treating res.ok as success would silently
    "download" nothing, over and over, through an unattended queue. The only proof of
    success is a string `url` field.
  */
  async function resolveFileUrl(gameId, fileId) {
    const body = new URLSearchParams();
    body.append('game_id', String(gameId));
    body.append('fid', String(fileId));
    body.append('collection_id', '0');

    const res = await fetch(RESOLVE_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`link request failed: HTTP ${res.status}`);

    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (!json || typeof json.url !== 'string') {
      const err = new Error('no download link returned — is your Nexus session still signed in?');
      err.authLike = true;
      throw err;
    }
    return json.url;
  }

  // ------------------------------------------------------------ paths

  function sanitizeSegment(value, max) {
    const cleaned = String(value == null ? '' : value)
      .replace(/[\/\\:*?"<>|]/g, ' ')     // path separators and Windows-illegal chars
      .replace(/[\u0000-\u001f\u007f]/g, '')  // control characters
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+/, '')                  // leading dots hide files on unix
      .replace(/[\s.]+$/, '');                 // trailing dots are illegal on Windows
    return cleaned.slice(0, max || 64).replace(/[\s.]+$/, '');
  }

  function segOr(value, fallback) {
    return sanitizeSegment(value) || fallback;
  }

  function modFolder(mod) {
    return segOr(mod.name, `mod-${mod.modId}`);
  }

  function listFolder(list) {
    return segOr(list.name, `list-${list.id}`);
  }

  function gameFolder(doc) {
    return segOr(doc.name, doc.domain);
  }

  /*
    Nexus's own filename when we have it. When we don't, the name is constructed and the
    extension is a guess — flagged as such rather than pretended to be authoritative,
    because a wrongly-suffixed archive is confusing in a way a warning isn't.
  */
  function fileLeafName(mod, file) {
    if (file.filename) return sanitizeSegment(file.filename, 120);
    const base = segOr(file.name, `file-${file.fileId}`);
    const ver = sanitizeSegment(String(file.version || '').replace(/\./g, '-'), 24);
    return sanitizeSegment(`${base}-${mod.modId}${ver ? '-' + ver : ''}.7z`, 120);
  }

  function filePath(doc, list, mod, file) {
    return [ROOT_FOLDER, gameFolder(doc), listFolder(list), modFolder(mod), fileLeafName(mod, file)]
      .join('/');
  }

  /*
    Is this file missing or out of date on disk?

    Both version AND upload time, because authors re-upload without bumping the version,
    and because the mod's *header* version drifts from its file versions (design §1a) —
    so the header version must never be what decides this.
  */
  function fileNeedsDownload(mod, file, force) {
    if (force) return true;
    const rec = mod.download && mod.download.files ? mod.download.files[file.fileId] : null;
    if (!rec) return true;
    return rec.version !== file.version || rec.uploadedAt !== file.uploadedAt;
  }

  function infoPath(doc, list, mod) {
    return [ROOT_FOLDER, gameFolder(doc), listFolder(list), modFolder(mod), 'Info',
      segOr(mod.name, `mod-${mod.modId}`) + '.txt'].join('/');
  }

  // ------------------------------------------------------------ info file

  function fmtBytes(kb) {
    if (kb == null) return 'unknown size';
    if (kb < 1024) return `${kb}KB`;
    if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)}MB`;
    return `${(kb / 1024 / 1024).toFixed(2)}GB`;
  }

  function fmtDate(ms) {
    return ms ? new Date(ms).toISOString().slice(0, 10) : 'unknown date';
  }

  /*
    One combined text file per mod, with a labelled section per file — the format asked
    for. Requirements are included because a text file that says what this mod needs is
    exactly what you want when reinstalling from a folder six months later.
  */
  function buildInfoText(doc, list, mod) {
    const L = [];
    L.push(mod.name || `Mod ${mod.modId}`);
    L.push(mod.url || '');
    const by = [];
    if (mod.version) by.push('Version ' + mod.version);
    if (mod.author) by.push('by ' + mod.author);
    by.push('downloaded ' + new Date().toISOString().slice(0, 10));
    L.push(by.join(' · '));
    L.push(`Game: ${doc.name}   List: ${list.name}`);
    L.push('');

    if (mod.summary) { L.push(mod.summary); L.push(''); }

    L.push('=== DESCRIPTION ===');
    L.push(mod.description ? mod.description : '(the author wrote no description)');
    L.push('');

    const deps = mod.deps || [];
    const off = mod.offsiteDeps || [];
    const dlc = mod.dlcDeps || [];
    if (deps.length || off.length || dlc.length) {
      L.push('=== REQUIREMENTS ===');
      for (const d of deps) {
        L.push(`${d.name}${d.note ? ' — ' + d.note : (d.hard ? ' — required' : '')}`);
        if (d.url) L.push('  ' + d.url);
      }
      for (const d of off) L.push(`Off-site: ${d.name}${d.url ? ' — ' + d.url : ''}`);
      for (const d of dlc) L.push(`Game DLC: ${d.name}`);
      L.push('');
    }

    const mains = (mod.files && mod.files.main) || [];
    L.push('=== FILES ===');
    if (!mains.length) L.push('(no main files found)');
    for (const f of mains) {
      L.push('');
      L.push(`--- ${f.name}${f.version ? ' v' + f.version : ''} (${fmtBytes(f.sizeKb)}, uploaded ${fmtDate(f.uploadedAt)}) ---`);
      if (f.filename) L.push(`file: ${f.filename}`);
      L.push(f.description ? f.description : '(the author wrote no description for this file)');
    }
    L.push('');
    return L.join('\n');
  }

  // ------------------------------------------------------------ transfer

  function gmDownload(url, name, onProgress) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => { if (settled) return; settled = true; err ? reject(err) : resolve(); };
      try {
        GM_download({
          url,
          name,
          saveAs: false,
          onload: () => done(),
          onprogress: (e) => { if (onProgress && e && e.total) onProgress(e.loaded / e.total); },
          onerror: (e) => {
            const reason = e && (e.error || e.details) ? (e.error || e.details) : 'download failed';
            done(new Error(String(reason)));
          },
          ontimeout: () => done(new Error('download timed out'))
        });
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function downloadTextFile(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    return gmDownload(url, name).finally(() => setTimeout(() => URL.revokeObjectURL(url), 30000));
  }

  // ------------------------------------------------------------ the queue

  const queue = {
    items: [],
    paused: false,
    running: false,
    activeId: null,
    authFails: 0,
    itemMs: [],          // rolling durations, for the ETA
    progress: 0
  };

  function loadQueue() {
    const saved = readJson(QUEUE_KEY, null);
    if (!saved || !Array.isArray(saved.items)) return;
    queue.items = saved.items;
    queue.paused = true;   // a restored queue never auto-starts; the user restarts it
    // Anything caught mid-flight when the page died is pending again, not lost.
    for (const it of queue.items) if (it.status === 'active') it.status = 'pending';
  }

  function saveQueue() {
    if (!queue.items.length) { writeJson(QUEUE_KEY, null); return; }
    writeJson(QUEUE_KEY, { items: queue.items, savedAt: Date.now() });
  }

  function queueCounts() {
    let pending = 0, done = 0, failed = 0;
    for (const i of queue.items) {
      if (i.status === 'pending') pending++;
      else if (i.status === 'done') done++;
      else if (i.status === 'failed') failed++;
    }
    return { pending, done, failed, total: queue.items.length };
  }

  function etaMs() {
    const { pending } = queueCounts();
    if (!pending || !queue.itemMs.length) return null;
    const avg = queue.itemMs.reduce((a, b) => a + b, 0) / queue.itemMs.length;
    return Math.round(avg * pending);
  }

  function fmtDuration(ms) {
    if (ms == null) return '';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  async function runQueueItem(item) {
    const doc = getGame(item.domain);
    const list = getList(item.domain, item.listId);
    const mod = doc.mods[item.modId];
    if (!mod || !list) throw new Error('list or mod no longer exists');

    if (item.kind === 'info') {
      await downloadTextFile(buildInfoText(doc, list, mod), item.path);
      return;
    }

    const file = ((mod.files && mod.files.main) || []).find(f => f.fileId === item.fileId);
    if (!file) throw new Error('file is no longer listed on the mod page');

    // Honour the gate, then resolve immediately before transferring — the CDN link is
    // signed, user-bound and expiring, so it cannot be fetched ahead of time.
    const gate = gateMs();
    for (let left = Math.ceil(gate / 1000); left > 0; left--) {
      if (queue.paused) throw Object.assign(new Error('paused'), { pausedMidItem: true });
      setQueueStatus(`${item.modName} — waiting ${left}s`);
      await sleep(1000);
    }
    setQueueStatus(`${item.modName} — getting link`);
    const url = await resolveFileUrl(doc.gameId, item.fileId);
    queue.authFails = 0;

    setQueueStatus(`${item.modName} — ${item.fileName}`);
    await gmDownload(url, item.path, (frac) => {
      queue.progress = frac;
      renderQueue();
    });
    queue.progress = 0;

    mod.download.files[item.fileId] = {
      version: file.version,
      uploadedAt: file.uploadedAt,
      at: Date.now(),
      path: item.path
    };
    touchGame(item.domain);
  }

  async function runQueue() {
    if (queue.running) return;
    queue.running = true;
    renderQueue();
    try {
      while (!queue.paused) {
        const item = queue.items.find(i => i.status === 'pending');
        if (!item) break;

        item.status = 'active';
        queue.activeId = item.id;
        renderQueue();

        const started = Date.now();
        let ok = false;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
          try {
            await runQueueItem(item);
            ok = true;
          } catch (err) {
            if (err && err.pausedMidItem) { item.status = 'pending'; queue.activeId = null; saveQueue(); renderQueue(); return; }
            item.attempts = attempt;
            item.error = (err && err.message) || String(err);

            if (err && err.authLike) {
              queue.authFails++;
              if (queue.authFails >= AUTH_FAIL_LIMIT) {
                item.status = 'failed';
                queue.paused = true;
                logLine('STOPPED: Nexus stopped returning download links. Check you are signed in, then Resume.');
                saveQueue(); renderQueue();
                return;
              }
            }
            if (attempt < MAX_ATTEMPTS) {
              const backoff = 2000 * Math.pow(2, attempt - 1);
              logLine(`${item.modName}: ${item.error} — retrying in ${Math.round(backoff / 1000)}s`);
              await sleep(backoff);
            }
          }
        }

        if (ok) {
          item.status = 'done';
          queue.itemMs.push(Date.now() - started);
          if (queue.itemMs.length > 12) queue.itemMs.shift();
          logLine(`✓ ${item.path}`);
        } else {
          item.status = 'failed';
          logLine(`✗ ${item.modName} / ${item.fileName}: ${item.error}`);
        }

        queue.activeId = null;
        saveQueue();
        renderQueue();
        if (!queue.paused) await sleep(INTER_FILE_MS);
      }
    } finally {
      queue.running = false;
      queue.activeId = null;
      flushGames();
      const c = queueCounts();
      if (!c.pending && !queue.paused) {
        logLine(`Queue finished: ${c.done} saved, ${c.failed} failed.`);
      }
      renderQueue();
    }
  }

  // ------------------------------------------------------------ building a run

  /*
    Two passes, as designed: refresh what the pages say, then enqueue only what actually
    changed. A stub gets a full read (both tabs) because its description is needed for the
    Info file; an already-resolved mod only needs the files tab.
  */
  async function prepareListRun(domain, listId, opts) {
    const force = !!(opts && opts.force);
    const doc = getGame(domain);
    const list = getList(domain, listId);
    if (!list) throw new Error('list is gone');
    if (!doc.gameId) throw new Error(`no game id stored for ${doc.name} — open a mod page for it once`);

    const built = [];
    let refreshed = 0;
    for (let i = 0; i < list.modIds.length; i++) {
      const modId = list.modIds[i];
      let mod = doc.mods[modId];
      if (!mod) continue;
      setQueueStatus(`checking ${i + 1}/${list.modIds.length}: ${mod.name || modId}`);
      try {
        if (mod.state === 'stub' || !mod.description) {
          const record = await resolveModRecord(mod.url ||
            `https://www.nexusmods.com/${domain}/mods/${modId}`);
          mod = upsertMod(domain, record);
        } else {
          const filesDoc = await politeFetchDoc(
            (mod.url || `https://www.nexusmods.com/${domain}/mods/${modId}`) + '?tab=files');
          // Only the file manifest — a files-tab parse has no description or notes, so
          // assigning a whole record here would wipe both.
          mod.files = parseFiles(filesDoc);
          touchGame(domain);
        }
        refreshed++;
      } catch (err) {
        logLine(`could not refresh ${mod.name || modId}: ${err && err.message}`);
      }

      const mains = (mod.files && mod.files.main) || [];
      const changed = mains.filter(f => fileNeedsDownload(mod, f, force));

      if (!changed.length) continue;

      // Info first, so an interrupted run still leaves the documentation behind.
      built.push({
        id: newId('q'), kind: 'info', domain, listId, listName: list.name,
        modId: mod.modId, modName: mod.name, fileName: 'Info',
        path: infoPath(doc, list, mod), status: 'pending', attempts: 0, sizeKb: 0
      });
      for (const f of changed) {
        built.push({
          id: newId('q'), kind: 'file', domain, listId, listName: list.name,
          modId: mod.modId, modName: mod.name,
          fileId: f.fileId, fileName: f.filename || f.name, version: f.version,
          sizeKb: f.sizeKb || 0, guessedName: !f.filename,
          path: filePath(doc, list, mod, f), status: 'pending', attempts: 0
        });
      }
    }
    flushGames();
    setQueueStatus('');
    return { built, refreshed };
  }

  async function startListDownload(domain, listId, opts) {
    if (queue.running) { logLine('a queue is already running'); return; }
    const doc = getGame(domain);
    const list = getList(domain, listId);
    setBusy(true, 'checking…');
    let prepared;
    try {
      prepared = await prepareListRun(domain, listId, opts);
    } catch (err) {
      logLine('could not prepare: ' + (err && err.message));
      setBusy(false);
      return;
    }
    setBusy(false);

    const files = prepared.built.filter(i => i.kind === 'file');
    if (!files.length) {
      logLine(`${list.name}: everything is already up to date.`);
      renderQueue();
      return;
    }
    const guessed = files.filter(i => i.guessedName).length;
    const mb = files.reduce((a, i) => a + (i.sizeKb || 0), 0) / 1024;

    const proceed = await confirmModal(
      'Download list',
      `${list.name}: ${files.length} file${files.length === 1 ? '' : 's'} to fetch (~${mb.toFixed(0)}MB) ` +
      `across ${new Set(files.map(f => f.modId)).size} mod(s), plus info files.\n\n` +
      `They go to ${ROOT_FOLDER}/${gameFolder(doc)}/${listFolder(list)}/ in your browser's download folder. ` +
      `Each file waits out the site's countdown first, so this runs in the background.` +
      (guessed ? `\n\n${guessed} file(s) had no filename on the page; their extension is a guess.` : ''),
      'Start'
    );
    if (!proceed) { logLine('download cancelled'); return; }

    queue.items = prepared.built;
    queue.paused = false;
    queue.authFails = 0;
    queue.itemMs = [];
    saveQueue();
    logLine(`queued ${files.length} file(s) for ${list.name}`);
    runQueue();
  }

  async function checkListUpdates(domain, listId) {
    setBusy(true, 'checking…');
    let prepared;
    try {
      prepared = await prepareListRun(domain, listId, { force: false });
    } catch (err) {
      logLine('check failed: ' + (err && err.message));
      setBusy(false);
      return;
    }
    setBusy(false);
    const files = prepared.built.filter(i => i.kind === 'file');
    const list = getList(domain, listId);
    if (!files.length) { logLine(`${list.name}: all up to date.`); return; }
    const byMod = new Map();
    for (const f of files) byMod.set(f.modName, (byMod.get(f.modName) || 0) + 1);
    logLine(`${list.name}: ${files.length} file(s) need downloading —`);
    for (const [name, n] of byMod) logLine(`   ${name} (${n})`);
    renderLibrary();
  }

  function retryFailed() {
    let n = 0;
    for (const i of queue.items) {
      if (i.status === 'failed') { i.status = 'pending'; i.attempts = 0; i.error = null; n++; }
    }
    if (!n) return;
    queue.paused = false;
    queue.authFails = 0;
    saveQueue();
    logLine(`retrying ${n} failed item(s)`);
    runQueue();
  }

  function clearQueue() {
    queue.items = [];
    queue.paused = false;
    queue.activeId = null;
    queue.itemMs = [];
    saveQueue();
    renderQueue();
  }

  // ==========================================================================
  // LIBRARY OVERLAY
  // ==========================================================================

  const libState = { domain: null, listId: null, modal: null };

  function openLibrary() {
    const idx = readIndex();
    const domains = Object.keys(idx.games);
    if (!libState.domain || !domains.includes(libState.domain)) {
      libState.domain = (ui.context && ui.context.gameDomain) || domains[0] || null;
    }

    const wrap = document.createElement('div');
    wrap.className = 'ncLib';
    const modal = openModal({
      title: 'Library',
      bodyNode: wrap,
      wide: true,
      onClose: () => { libState.modal = null; renderDock(); }
    });
    libState.modal = { modal, wrap };
    renderLibrary();
  }

  function renderLibrary() {
    if (!libState.modal) return;
    const { wrap } = libState.modal;
    wrap.textContent = '';

    const idx = readIndex();
    const domains = Object.keys(idx.games).sort((a, b) =>
      (idx.games[a].name || a).localeCompare(idx.games[b].name || b));

    if (!domains.length) {
      const empty = document.createElement('div');
      empty.className = 'ncEmpty';
      empty.textContent = 'No games yet. Open a mod page and use "Add to list".';
      wrap.appendChild(empty);
      return;
    }

    // ---- games rail
    const rail = document.createElement('div');
    rail.className = 'ncRail';
    for (const d of domains) {
      const g = idx.games[d];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ncRailItem' + (d === libState.domain ? ' ncOn' : '');
      const n = document.createElement('span');
      n.className = 'ncRailName';
      n.textContent = g.name || d;
      const m = document.createElement('span');
      m.className = 'ncRailMeta';
      m.textContent = `${g.lists || 0} list${g.lists === 1 ? '' : 's'} · ${g.mods || 0} mods`;
      b.append(n, m);
      b.addEventListener('click', () => { libState.domain = d; libState.listId = null; renderLibrary(); });
      rail.appendChild(b);
    }

    const doc = getGame(libState.domain);
    if (libState.listId && !doc.lists.some(l => l.id === libState.listId)) libState.listId = null;
    if (!libState.listId && doc.lists.length) libState.listId = doc.lists[0].id;

    // ---- lists column
    const listsCol = document.createElement('div');
    listsCol.className = 'ncCol';
    const listsHead = document.createElement('div');
    listsHead.className = 'ncColHead';
    listsHead.innerHTML = '<span>Lists</span>';
    const addListBtn = document.createElement('button');
    addListBtn.type = 'button';
    addListBtn.className = 'ncMini';
    addListBtn.textContent = '+ New';
    addListBtn.addEventListener('click', async () => {
      const name = await textPromptModal({
        title: 'New list', label: `A new list in ${doc.name}`,
        placeholder: 'e.g. Core Utilities', confirmLabel: 'Create'
      });
      if (!name) return;
      const list = createList(libState.domain, name);
      libState.listId = list.id;
      flushGames();
      logLine(`created list "${name}"`);
      renderLibrary();
    });
    listsHead.appendChild(addListBtn);
    listsCol.appendChild(listsHead);

    const listRows = document.createElement('div');
    listRows.className = 'ncRows';
    if (!doc.lists.length) {
      const e = document.createElement('div');
      e.className = 'ncEmpty';
      e.textContent = 'No lists yet.';
      listRows.appendChild(e);
    }
    for (const list of doc.lists) {
      const row = document.createElement('div');
      row.className = 'ncRow' + (list.id === libState.listId ? ' ncOn' : '');

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'ncRowMain';
      const n = document.createElement('span');
      n.className = 'ncRowName';
      n.textContent = list.name;
      const m = document.createElement('span');
      m.className = 'ncRowMeta';
      m.textContent = `${list.modIds.length} mod${list.modIds.length === 1 ? '' : 's'}`;
      pick.append(n, m);
      pick.addEventListener('click', () => { libState.listId = list.id; renderLibrary(); });

      const ren = document.createElement('button');
      ren.type = 'button';
      ren.className = 'ncMini';
      ren.title = 'Rename';
      ren.textContent = '✎';
      ren.addEventListener('click', async () => {
        const name = await textPromptModal({
          title: 'Rename list', label: 'List name', value: list.name, confirmLabel: 'Rename'
        });
        if (!name) return;
        renameList(libState.domain, list.id, name);
        flushGames();
        renderLibrary();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ncMini ncDanger';
      del.title = 'Delete';
      del.textContent = '🗑';
      del.addEventListener('click', async () => {
        const n = list.modIds.length;
        const okDelete = await confirmModal(
          'Delete list',
          n
            ? `Delete "${list.name}"? Its ${n} mod${n === 1 ? '' : 's'} stay in the library, and in any other list they belong to.`
            : `Delete "${list.name}"? It's empty, so nothing else changes.`,
          'Delete'
        );
        if (!okDelete) return;
        deleteList(libState.domain, list.id);
        if (libState.listId === list.id) libState.listId = null;
        flushGames();
        logLine(`deleted list "${list.name}"`);
        renderLibrary();
      });

      row.append(pick, ren, del);
      listRows.appendChild(row);
    }
    listsCol.appendChild(listRows);

    // ---- mods column
    const modsCol = document.createElement('div');
    modsCol.className = 'ncCol ncColWide';
    const list = libState.listId ? doc.lists.find(l => l.id === libState.listId) : null;
    const modsHead = document.createElement('div');
    modsHead.className = 'ncColHead';
    modsHead.innerHTML = `<span>${list ? escapeHtml(list.name) : 'Mods'}</span>`;
    if (list && list.modIds.length) {
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'ncMiniWide';
      dl.textContent = 'Download list';
      dl.disabled = queue.running;
      dl.addEventListener('click', () => {
        libState.modal && libState.modal.modal.close();
        startListDownload(libState.domain, list.id, {});
      });
      const chk = document.createElement('button');
      chk.type = 'button';
      chk.className = 'ncMiniWide';
      chk.textContent = 'Check updates';
      chk.disabled = queue.running;
      chk.addEventListener('click', () => checkListUpdates(libState.domain, list.id));
      modsHead.append(chk, dl);
    }
    modsCol.appendChild(modsHead);

    const modRows = document.createElement('div');
    modRows.className = 'ncRows';
    if (!list) {
      const e = document.createElement('div');
      e.className = 'ncEmpty';
      e.textContent = 'Select a list.';
      modRows.appendChild(e);
    } else if (!list.modIds.length) {
      const e = document.createElement('div');
      e.className = 'ncEmpty';
      e.textContent = 'This list is empty. Open a mod page and use "Add to list".';
      modRows.appendChild(e);
    } else {
      for (const modId of list.modIds) {
        const mod = doc.mods[modId] || { modId, name: `Mod ${modId}`, state: 'stub' };
        const row = document.createElement('div');
        row.className = 'ncRow';

        const main = document.createElement('a');
        main.className = 'ncRowMain ncRowLink';
        main.href = mod.url || `https://www.nexusmods.com/${libState.domain}/mods/${modId}`;
        main.target = '_blank';
        main.rel = 'noreferrer';
        const n = document.createElement('span');
        n.className = 'ncRowName';
        n.textContent = mod.name || `Mod ${modId}`;
        const m = document.createElement('span');
        m.className = 'ncRowMeta';
        const bits = [];
        if (mod.state === 'stub') bits.push('not yet read');
        if (mod.version) bits.push('v' + mod.version);
        if (mod.files && mod.files.main) bits.push(`${mod.files.main.length} file${mod.files.main.length === 1 ? '' : 's'}`);
        if (mod.deps && mod.deps.length) bits.push(`${mod.deps.length} dep${mod.deps.length === 1 ? '' : 's'}`);
        const others = listsContainingMod(libState.domain, modId).filter(l => l.id !== list.id);
        if (others.length) bits.push(`also in ${others.length}`);
        m.textContent = bits.join(' · ');

        // Download state, from the file-keyed history (never the header version).
        const mains = (mod.files && mod.files.main) || [];
        const dl = mod.download && mod.download.files ? mod.download.files : {};
        const havingAll = mains.length && mains.every(f => {
          const rec = dl[f.fileId];
          return rec && rec.version === f.version && rec.uploadedAt === f.uploadedAt;
        });
        const someHeld = Object.keys(dl).length > 0;
        const state = document.createElement('span');
        state.className = 'ncDlState ' +
          (havingAll ? 'ncDlOk' : someHeld ? 'ncDlStale' : 'ncDlNone');
        state.textContent = havingAll ? '✓' : someHeld ? '⬆' : '·';
        state.title = havingAll ? 'All main files downloaded and current'
          : someHeld ? 'An update is available' : 'Never downloaded';
        main.prepend(state);
        main.append(n, m);

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'ncMini ncDanger';
        rm.title = 'Remove from this list';
        rm.textContent = '✕';
        rm.addEventListener('click', () => {
          removeModFromList(libState.domain, list.id, modId);
          flushGames();
          logLine(`removed "${mod.name}" from ${list.name}`);
          renderLibrary();
        });

        row.append(main, rm);
        modRows.appendChild(row);
      }
    }
    modsCol.appendChild(modRows);

    wrap.append(rail, listsCol, modsCol);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setBusy(busy, label) {
    if (!ui.panel) return;
    ui.panel.classList.toggle('nc-busy', !!busy);
    if (ui.badge) ui.badge.textContent = busy ? (label || 'working…') : (ui.context && ui.context.gameDomain) || '';
    if (ui.addBtn) ui.addBtn.disabled = !!busy;
  }

  // ==========================================================================
  // BOOT
  // ==========================================================================

  function init() {
    injectStyle();
    buildDock();

    ui.context = detectContext();
    if (ui.context.kind === 'mod') {
      // Registering the game on sight means the index knows about a game as soon as you
      // browse it, without waiting for a list to be made.
      ensureGame(ui.context);
    }

    // Learn the site's own countdown whenever a page advertises one, so the queue's gate
    // tracks whatever Nexus currently asks for rather than a hardcoded guess.
    const gateEl = document.querySelector('mod-download-modal[countdown-seconds]');
    if (gateEl) {
      const secs = parseInt(gateEl.getAttribute('countdown-seconds'), 10);
      if (Number.isFinite(secs) && secs >= 0) {
        const s = readUiState();
        if (s.countdownSeconds !== secs) {
          s.countdownSeconds = secs;
          writeUiState(s);
          logLine(`noted the site's countdown: ${secs}s`);
        }
      }
    }

    loadQueue();
    renderDock();
    renderQueue();
    const qc = queueCounts();
    if (qc.pending) {
      logLine(`${qc.pending} item(s) left from a previous run — paused. Press Resume.`);
    }

    const idx = readIndex();
    const games = Object.keys(idx.games).length;
    logLine(games
      ? `Ready. ${games} game(s) in the library.`
      : 'Ready. No games in the library yet.');
    if (blockedKeys.size) {
      logLine(`WARNING: ${blockedKeys.size} storage key(s) failed to load and are write-locked.`);
    }
  }

  // --------------------------------------------------------------- dev export

  window.__ncParse = {
    SEL,
    parseModUrl,
    htmlToText,
    parseGameId,
    parseHeaderVersion,
    parseContext,
    parseSideItems,
    parseDescTableDeps,
    parseRequirementAttrDeps,
    parseFileLevelDeps,
    parseFiles,
    mergeDeps,
    parseModPage
  };

  window.__ncStore = {
    readIndex, getGame, ensureGame, upsertMod, flushGames,
    createList, getList, renameList, deleteList,
    addModToList, removeModFromList, listsContainingMod, gameStats,
    exportPayload, mergeImport,
    _blockedKeys: blockedKeys
  };

  window.__ncDev = {
    bucketDependencies, intakeShape, showDependencyIntake, addDepAsStub,
    openLibrary, pickListModal, resolveModRecord,
    queue, runQueue, startListDownload, checkListUpdates, resolveFileUrl
  };

  window.__ncPaths = {
    sanitizeSegment, fileLeafName, filePath, infoPath, buildInfoText,
    fileNeedsDownload, fmtBytes, fmtDate, fmtDuration
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
