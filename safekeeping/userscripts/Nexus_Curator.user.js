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
      if (typeof list.note !== 'string') list.note = '';
      // Main-files-only is the documented default; older lists predate the flag.
      if (typeof list.includeOptional !== 'boolean') list.includeOptional = false;
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
      includeOptional: false,
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

  /*
    Move a mod between lists in one step.

    Deliberately a distinct operation rather than a side effect of adding: a mod is
    allowed to live in several lists at once (SKSE genuinely belongs to all of them), and
    that many-to-many membership is what the cross-list audit reads. If adding silently
    moved, there would be no way to express "both lists need this".
  */
  function moveModBetweenLists(domain, modId, fromListId, toListId) {
    if (!modId || fromListId === toListId) return false;
    const from = getList(domain, fromListId);
    const to = getList(domain, toListId);
    if (!from || !to) return false;
    removeModFromList(domain, fromListId, modId);
    addModToList(domain, toListId, modId);
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
      /* Names wrap rather than ellipsise: a truncated game or mod name is unidentifiable,
         and these rows have vertical room to spare. */
      .ncRailName{font-weight:900;max-width:100%;overflow-wrap:anywhere;line-height:1.25}
      .ncRailMeta{font-size:10px;color:#9c8b7c;font-weight:700;line-height:1.3}
      .ncCol{display:flex;flex-direction:column;min-width:0;min-height:0;
        border-right:1px solid rgba(255,255,255,.09)}
      .ncColWide{border-right:0}
      .ncColHead{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:9px 10px;min-height:46px;
        box-sizing:border-box;border-bottom:1px solid rgba(255,255,255,.09);font-weight:900;color:#ffd9b3}
      /* The heading may truncate — it is a restatement of the row you selected, which is
         still spelled out in full one column to the left. The buttons never shrink. */
      .ncColHead span:first-child{flex:1 1 auto;min-width:0;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap}
      .ncRows{flex:1 1 auto;min-height:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:4px}
      .ncRow{display:flex;align-items:stretch;gap:4px}
      .ncRow.ncOn .ncRowMain{background:rgba(255,154,60,.18);border-color:rgba(255,154,60,.5)}
      .ncRowMain{flex:1 1 auto;min-width:0;display:flex!important;flex-direction:column;gap:2px;
        align-items:flex-start;text-align:left;padding:7px 9px!important;text-decoration:none}
      .ncRowLink{border:1px solid rgba(255,255,255,.14);border-radius:7px;background:rgba(255,255,255,.07);
        color:#fff4e8;cursor:pointer}
      .ncRowLink:hover{background:rgba(255,154,60,.18);border-color:rgba(255,154,60,.5)}
      .ncRowName{font-weight:900;max-width:100%;overflow-wrap:anywhere;line-height:1.25}
      .ncRowMeta{font-size:10px;color:#9c8b7c;font-weight:700;max-width:100%;
        overflow-wrap:anywhere;line-height:1.35}
      .ncMini{flex:0 0 auto;width:32px;min-height:0!important;padding:0!important;font-size:13px!important;
        display:flex;align-items:center;justify-content:center}
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
      .ncMiniWide{flex:0 0 auto;min-height:28px!important;padding:0 11px!important;margin-left:5px;
        font-size:11px!important;white-space:nowrap}
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
      #ncDock .nc-failRow{margin:0 0 6px;padding:0 0 5px;
        border-bottom:1px solid rgba(255,255,255,.06)}
      #ncDock .nc-failRow:last-child{border-bottom:0}
      #ncDock .nc-failWho{font:700 10px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#e0cfc4;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #ncDock .nc-failWhy{font:10px/1.4 Arial,sans-serif;color:#ffb0a0;
        overflow-wrap:anywhere;white-space:normal}
      .ncDlState{position:absolute;right:8px;top:7px;font-weight:900;font-size:12px}
      .ncDlOk{color:#7fc98d}
      .ncDlStale{color:#ffb347}
      .ncDlNone{color:#6b5f55}
      .ncRow .ncRowMain{position:relative;padding-right:24px!important}
      .ncColHead .ncMiniWide{flex:0 0 auto}

      /* ---- audit ---- */
      .ncModalHuge{width:min(1180px,100%);height:min(86vh,860px)}
      .ncModalHuge .ncModalBody{padding:0;overflow:hidden}
      .ncAudit{display:flex;flex-direction:column;height:100%;min-height:0}
      .ncAuditTabs{flex:0 0 auto;display:flex;gap:4px;padding:8px 10px;
        border-bottom:1px solid rgba(255,255,255,.1)}
      .ncAuditTab{min-height:28px!important;padding:0 14px!important;font-size:11px!important}
      .ncAuditTab.ncOn{background:rgba(255,154,60,.2)!important;border-color:rgba(255,154,60,.55)!important;
        color:#ffd9b3}
      .ncAuditBody{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px;
        display:flex;flex-direction:column;gap:9px}
      .ncAuditFilters{display:flex;gap:5px;flex-wrap:wrap}
      .ncChipBtn{min-height:26px!important;padding:0 12px!important;font-size:11px!important;
        border-radius:999px!important;white-space:nowrap}
      .ncChipBtn.ncOn{background:rgba(255,154,60,.2)!important;border-color:rgba(255,154,60,.55)!important}
      .ncCycleWarn{flex:0 0 auto;margin:8px 12px 0;padding:7px 9px;border-radius:7px;
        background:rgba(226,110,44,.14);border:1px solid rgba(226,110,44,.4);color:#ffc7a0;font-size:11px}
      .ncAuditTable td{vertical-align:top}
      .ncAuditTable td:nth-child(2),.ncAuditTable td:nth-child(4){white-space:nowrap}
      .ncSubNote{color:#8d7d6f;font-size:10px;margin-top:2px;max-width:340px}
      .ncChipOk{background:rgba(79,139,95,.22);color:#9fd3a8;border:1px solid rgba(79,139,95,.5)}
      .ncDetailRow td{background:rgba(0,0,0,.24)}
      .ncDetailCell{color:#a89786;font-size:11px}
      .ncMatrix th{font-size:10px}
      /* List names are the axis labels here — truncating them makes the grid unreadable. */
      .ncMatrixColHead{max-width:110px;overflow-wrap:anywhere;vertical-align:bottom;line-height:1.3}
      .ncMatrixRowHead{text-align:left!important;color:#ffd9b3;max-width:170px;
        overflow-wrap:anywhere;line-height:1.3}
      .ncMatrixCell{text-align:center;font-weight:900;color:#c3b3a3}
      .ncMatrixSelf{color:#4a413a}
      .ncMatrixHit{background:rgba(255,154,60,.16);color:#ffd9b3}
      .ncMatrixHit:hover{background:rgba(255,154,60,.3)}
      .ncOrderPre{margin:0;padding:10px;border-radius:8px;background:rgba(0,0,0,.3);
        border:1px solid rgba(255,255,255,.09);color:#d8c9bb;
        font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;overflow:auto;max-height:none}
      .ncGraphScroll{overflow:auto;border:1px solid rgba(255,255,255,.09);border-radius:8px;
        background:rgba(0,0,0,.24);padding:6px}
      .ncGraphSvg{display:block;font:11px Arial,sans-serif}
      .ncGEdge{fill:none;stroke:#6b5f55;stroke-width:1.4}
      .ncGEdgeSoft{stroke-dasharray:4 3;stroke:#5b6b86}
      .ncGNode rect{fill:#1b1410;stroke:#3d332c;stroke-width:1}
      .ncGNode text{fill:#e8dbd0;font-size:11px}
      .ncGNode-missing rect{fill:#3a1712;stroke:#e2604c}
      .ncGNode-have rect{fill:#14251a;stroke:#4f8b5f}
      .ncGNode-offsite rect,.ncGNode-dlc rect{fill:#171717;stroke:#4a4a4a}
      .ncGBadge{fill:#9c8b7c;font-size:9px}
      .ncGraphLegend{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .ncLegendNote{color:#7f7166;font-size:10px}

      /* ---- phase 7 polish ---- */
      .ncTextarea{box-sizing:border-box;width:100%;padding:7px 9px;border-radius:7px;
        border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.3);color:#fff4e8;
        font:12px/1.4 Arial,sans-serif;outline:none;resize:vertical}
      .ncTextarea:focus{border-color:rgba(255,154,60,.65)}
      .ncForm{display:flex;flex-direction:column;gap:4px}
      .ncForm .ncFieldLabel{margin-top:6px}
      .ncForm .ncCheckRow{margin-top:10px}
      .ncLibHint{flex:0 0 auto;padding:6px 10px;border-top:1px solid rgba(255,255,255,.08);
        color:#7f7166;font-size:10px;font-weight:700}
      .ncRailItem.ncCursor,.ncRow.ncCursor .ncRowMain{outline:2px solid rgba(255,154,60,.75);
        outline-offset:-2px}
      .ncRowActs{flex:0 0 auto;display:flex;gap:4px;align-items:stretch}
      .ncRowBtn{flex:0 0 auto;min-height:28px!important;padding:0 10px!important;font-size:11px!important;
        white-space:nowrap;display:flex;align-items:center;justify-content:center}

      /* ---- harvest ---- */
      .ncHarvest{display:flex;flex-direction:column;gap:8px}
      /* Header and rows share one left edge: the header's inline padding matches the
         row's, so game names and mod names start on the same pixel column. */
      .ncHarvestHead{color:#ffd9b3;font-weight:900;font-size:11px;padding:0 7px 5px;
        border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:2px}
      .ncHarvestRows{display:flex;flex-direction:column;gap:1px}
      .ncHarvestRow{display:grid;grid-template-columns:15px minmax(0,1fr) auto;gap:9px;
        align-items:start;padding:5px 7px;border-radius:6px;cursor:pointer}
      .ncHarvestRow:hover{background:rgba(255,255,255,.05)}
      .ncHarvestRow input{width:15px;height:15px;margin:1px 0 0;accent-color:#e07b1e}
      .ncHarvestName{min-width:0;overflow-wrap:anywhere;line-height:1.35}
      .ncHarvestMeta{color:#8d7d6f;font-size:10px;font-weight:700;text-align:right;
        white-space:nowrap;line-height:1.6}
      .ncHarvestHave .ncHarvestName{color:#9c8b7c}
      .ncSegmented{gap:0}
      .ncSegmented .ncChipBtn{border-radius:0!important;margin-left:-1px}
      .ncSegmented .ncChipBtn:first-child{border-radius:999px 0 0 999px!important;margin-left:0}
      .ncSegmented .ncChipBtn:last-child{border-radius:0 999px 999px 0!important}
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
        <button id="ncHarvest" type="button">Find mods on this page</button>
        <button id="ncLibrary" type="button">Library</button>
        <div class="nc-row">
          <button id="ncExport" type="button">Export</button>
          <button id="ncImport" type="button">Import</button>
        </div>
        <button id="ncDebug" type="button" hidden>Debug</button>
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
    ui.harvest = panel.querySelector('#ncHarvest');
    ui.harvest.addEventListener('click', openHarvest);

    ui.debug = panel.querySelector('#ncDebug');
    if (DEBUG_TOOLS) {
      ui.debug.hidden = false;
      ui.debug.addEventListener('click', openDebugMenu);
    }

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
        // Name on one line, reason wrapped below it. The reason is the actionable part
        // and it was previously ellipsised into uselessness by a long mod name.
        const who = document.createElement('div');
        who.className = 'nc-failWho';
        who.textContent = i.modName;
        const why = document.createElement('div');
        why.className = 'nc-failWhy';
        why.textContent = i.error || 'failed';
        row.append(who, why);
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
    panel.className = 'ncModal' +
      (opts.huge ? ' ncModalHuge' : opts.wide ? ' ncModalWide' : '');

    const head = document.createElement('div');
    head.className = 'ncModalHead';
    const title = document.createElement('span');
    title.className = 'ncModalTitle';
    title.textContent = opts.title || '';
    head.appendChild(title);

    /*
      One way out per dialog. A footer Cancel/Close and a corner ✕ do the same thing, and
      offering both makes the reader stop to work out whether they differ. The corner ✕
      appears only when the footer has no dismiss of its own — Esc always works either way.
    */
    const hasFooterDismiss = (opts.actions || []).some(a => /^(cancel|close)$/i.test(a.label || ''));
    let closeBtn = null;
    if (!hasFooterDismiss) {
      closeBtn = document.createElement('button');
      closeBtn.className = 'ncX';
      closeBtn.type = 'button';
      closeBtn.textContent = '✕';
      closeBtn.title = 'Close (Esc)';
      head.appendChild(closeBtn);
    }

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

    if (closeBtn) closeBtn.addEventListener('click', () => api.close(null));
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
    Extensions we're confident a download manager will accept and that every archive tool
    opens. Tampermonkey refuses to save any extension outside its own configurable
    whitelist (`not_whitelisted`), and that whitelist is the binding constraint here —
    not anything about Nexus.
  */
  const KNOWN_ARCHIVE_EXT = /\.(zip|rar|7z|gz|tgz|bz2|xz|tar)$/i;
  const SAFEST_EXT = '.zip';

  /*
    Ask the CDN for the true filename of files whose page doesn't publish one (one extra
    HEAD, first attempt only). Set false to skip it and use constructed names instead —
    downloads still work, they just get a generated name rather than the real one.
  */
  const CDN_FILENAME_LOOKUP = true;

  /*
    Guarantee a name a download manager will accept.

    `.zip` is the fallback rather than `.7z` for two reasons: it is the extension most
    likely to be whitelisted anywhere, and archive tools identify containers by magic
    bytes rather than suffix — so a 7z or rar payload saved as .zip still opens. A
    wrong-but-openable name beats a right-but-refused one.
  */
  function ensureArchiveExtension(name) {
    const trimmed = String(name || '').replace(/[\s.]+$/, '');
    if (!trimmed) return 'download' + SAFEST_EXT;
    return KNOWN_ARCHIVE_EXT.test(trimmed) ? trimmed : trimmed + SAFEST_EXT;
  }

  /*
    A name built from what the page does tell us. Used only when neither the DOM nor the
    CDN gave us the real one.
  */
  function constructedLeafName(mod, file) {
    const base = segOr(file.name, `file-${file.fileId}`);
    const ver = sanitizeSegment(String(file.version || '').replace(/\./g, '-'), 24);
    return ensureArchiveExtension(sanitizeSegment(`${base}-${mod.modId}${ver ? '-' + ver : ''}`, 110));
  }

  // Nexus's own filename when the page carried one, else a constructed stand-in.
  function fileLeafName(mod, file) {
    if (file.filename) return ensureArchiveExtension(sanitizeSegment(file.filename, 120));
    return constructedLeafName(mod, file);
  }

  function fileDir(doc, list, mod) {
    return [ROOT_FOLDER, gameFolder(doc), listFolder(list), modFolder(mod)].join('/');
  }

  function filePath(doc, list, mod, file) {
    return fileDir(doc, list, mod) + '/' + fileLeafName(mod, file);
  }

  /*
    Pull a filename out of a Content-Disposition header. Handles both the plain
    `filename="x"` form and RFC 5987's `filename*=UTF-8''x`, preferring the latter
    because it is the one that survives non-ASCII names.
  */
  function parseContentDispositionFilename(value) {
    const raw = String(value || '');
    let m = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(raw);
    if (m) {
      try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ }
    }
    m = /filename\s*=\s*"([^"]*)"/i.exec(raw) || /filename\s*=\s*([^;]+)/i.exec(raw);
    return m ? m[1].trim() : null;
  }

  function gmXhr(opts) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest(Object.assign({}, opts, {
          onload: resolve,
          onerror: (e) => reject(new Error((e && e.error) || 'request failed')),
          ontimeout: () => reject(new Error('timed out'))
        }));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /*
    Ask the CDN what the file is actually called.

    This is the authoritative source and the only one that works for every file: some
    mods (ArchiveXL, TweakXL) have no "Preview file contents" link at all, so the page
    carries no filename anywhere — verified, including their manifest JSON, which lists
    the archive's *contents* rather than its name.

    Entirely best-effort: any failure returns null and the caller falls back. Never let
    a naming nicety break a download.
  */
  async function filenameFromCdn(url) {
    if (!CDN_FILENAME_LOOKUP) return null;
    try {
      const res = await gmXhr({ method: 'HEAD', url, timeout: 15000 });
      const headers = String(res && res.responseHeaders || '');
      const line = /^content-disposition:[ \t]*(.*)$/im.exec(headers);
      if (!line) return null;
      const name = parseContentDispositionFilename(line[1]);
      return name ? sanitizeSegment(name, 120) : null;
    } catch {
      return null;
    }
  }

  // Turn a raw download failure into something that says what to actually do about it.
  function explainDownloadError(message, leaf) {
    const msg = String(message || '');
    if (/not_whitelisted/i.test(msg)) {
      const ext = (/\.[A-Za-z0-9]+$/.exec(leaf || '') || [''])[0] || '(no extension)';
      return `Tampermonkey refused "${ext}" — open its Settings → Downloads → ` +
        `"Whitelisted File Extensions" and add it (or use *.*).`;
    }
    if (/not_permitted|not_supported/i.test(msg)) {
      return `Tampermonkey blocked the download (${msg}). Check Settings → Downloads.`;
    }
    return msg;
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

  /*
    Which of a mod's files this list wants. Main files always; optionals only when the
    list opts in, because optional files are frequently mutually-exclusive variants and
    grabbing all of them by default hands you patches you didn't want.
  */
  function downloadableFiles(list, mod) {
    const files = mod.files || {};
    const main = files.main || [];
    if (!list || !list.includeOptional) return main;
    return main.concat(files.optional || []);
  }

  /*
    What this list still owes, from stored manifests alone — no network. Honest about its
    own staleness: it can only speak for what the last refresh saw, which is why the UI
    calls it "to download" rather than "updates available".
  */
  function listDownloadRollup(domain, list) {
    const doc = getGame(domain);
    let pending = 0, mods = 0, unread = 0;
    for (const modId of list.modIds) {
      const mod = doc.mods[modId];
      if (!mod) continue;
      if (mod.state === 'stub') { unread++; continue; }
      const want = downloadableFiles(list, mod);
      const need = want.filter(f => fileNeedsDownload(mod, f, false));
      if (need.length) { pending += need.length; mods++; }
    }
    return { pending, mods, unread };
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

  async function runQueueItem(item, attempt) {
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

    /*
      Settle the filename here rather than at queue-build time, because the best source
      only exists once we hold a link. Only on the first attempt: a HEAD is cheap but a
      retry loop that re-probes every pass could hammer a link that may be single-use.
    */
    if (!item.leafKnown && attempt === 1) {
      setQueueStatus(`${item.modName} — asking for the filename`);
      const fromCdn = await filenameFromCdn(url);
      if (fromCdn) {
        item.leaf = ensureArchiveExtension(fromCdn);
        item.leafKnown = true;
        item.leafSource = 'cdn';
        item.fileName = item.leaf;
      }
    }

    const leaf = ensureArchiveExtension(item.leaf);
    item.path = item.dirPath + '/' + leaf;

    setQueueStatus(`${item.modName} — ${leaf}`);
    try {
      await gmDownload(url, item.path, (frac) => { queue.progress = frac; renderQueue(); });
    } catch (err) {
      /*
        Tampermonkey vetoes by extension. If the true name carries one it dislikes, save
        it as .zip instead — the bytes are unchanged and every archive tool sniffs the
        container from magic bytes, so a renamed 7z still opens.
      */
      if (/not_whitelisted/i.test(String(err && err.message)) && !/\.zip$/i.test(leaf)) {
        const zipped = leaf.replace(/\.[A-Za-z0-9]+$/, '') + SAFEST_EXT;
        logLine(`${item.modName}: Tampermonkey refused that extension — saving as ${zipped}`);
        item.path = item.dirPath + '/' + zipped;
        item.renamedForWhitelist = true;
        await gmDownload(url, item.path, (frac) => { queue.progress = frac; renderQueue(); });
      } else {
        throw err;
      }
    }
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
            await runQueueItem(item, attempt);
            ok = true;
          } catch (err) {
            if (err && err.pausedMidItem) { item.status = 'pending'; queue.activeId = null; saveQueue(); renderQueue(); return; }
            item.attempts = attempt;
            item.error = explainDownloadError((err && err.message) || String(err), item.leaf);

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
            // A whitelist veto is a settings problem, not a transient one. The .zip
            // rename has already been tried by this point, so grinding through two more
            // identical refusals just wastes the gate.
            if (/not_whitelisted|not_permitted|not_supported/i.test(String(err && err.message))) break;

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
    const onlyModId = (opts && opts.onlyModId) || null;
    const doc = getGame(domain);
    const list = getList(domain, listId);
    if (!list) throw new Error('list is gone');
    if (!doc.gameId) throw new Error(`no game id stored for ${doc.name} — open a mod page for it once`);

    const targets = onlyModId
      ? list.modIds.filter(id => id === onlyModId)
      : list.modIds;

    const built = [];
    let refreshed = 0;
    for (let i = 0; i < targets.length; i++) {
      const modId = targets[i];
      let mod = doc.mods[modId];
      if (!mod) continue;
      setQueueStatus(`checking ${i + 1}/${targets.length}: ${mod.name || modId}`);
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

      const changed = downloadableFiles(list, mod).filter(f => fileNeedsDownload(mod, f, force));

      if (!changed.length) continue;

      // Info first, so an interrupted run still leaves the documentation behind.
      built.push({
        id: newId('q'), kind: 'info', domain, listId, listName: list.name,
        modId: mod.modId, modName: mod.name, fileName: 'Info',
        path: infoPath(doc, list, mod), status: 'pending', attempts: 0, sizeKb: 0
      });
      for (const f of changed) {
        const dirPath = fileDir(doc, list, mod);
        const leaf = fileLeafName(mod, f);
        built.push({
          id: newId('q'), kind: 'file', domain, listId, listName: list.name,
          modId: mod.modId, modName: mod.name,
          fileId: f.fileId, fileName: leaf, version: f.version,
          sizeKb: f.sizeKb || 0,
          dirPath,
          leaf,
          // The page gave us a real name; otherwise the CDN is asked at transfer time.
          leafKnown: !!f.filename,
          leafSource: f.filename ? 'page' : 'constructed',
          path: dirPath + '/' + leaf,
          status: 'pending', attempts: 0
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

    let files = prepared.built.filter(i => i.kind === 'file');
    if (!files.length) {
      // "Up to date" used to be a dead end. Offer the re-fetch from the same place,
      // rather than requiring a separate force control somewhere else.
      const again = await confirmModal(
        'Already up to date',
        `${list.name} has nothing new. Download every file in it again anyway?`,
        'Download again'
      );
      if (!again) { logLine(`${list.name}: everything is already up to date.`); renderQueue(); return; }
      setBusy(true, 'checking…');
      try {
        prepared = await prepareListRun(domain, listId, { force: true });
      } catch (err) {
        logLine('could not prepare: ' + (err && err.message));
        setBusy(false);
        return;
      }
      setBusy(false);
      files = prepared.built.filter(i => i.kind === 'file');
      if (!files.length) { logLine(`${list.name}: no files listed to download.`); return; }
    }
    const unknownName = files.filter(i => !i.leafKnown).length;
    const mb = files.reduce((a, i) => a + (i.sizeKb || 0), 0) / 1024;

    const proceed = await confirmModal(
      'Download list',
      `${list.name}: ${files.length} file${files.length === 1 ? '' : 's'} to fetch (~${mb.toFixed(0)}MB) ` +
      `across ${new Set(files.map(f => f.modId)).size} mod(s), plus info files.\n\n` +
      `They go to ${ROOT_FOLDER}/${gameFolder(doc)}/${listFolder(list)}/ in your browser's download folder. ` +
      `Each file waits out the site's countdown first, so this runs in the background.` +
      (unknownName
        ? `\n\n${unknownName} file(s) don't publish a filename on their page — Curator will ask the ` +
          `download server for the real one when it fetches them.`
        : ''),
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

  /*
    Download one mod into one list. Same two-pass machinery as a whole list, scoped by a
    filter — so ordering, gating, naming, resume and the failure tray all behave
    identically rather than being reimplemented for the single-mod case.
  */
  async function startModDownload(domain, listId, modId, opts) {
    if (queue.running) { logLine('a queue is already running — wait or pause it'); return; }
    const doc = getGame(domain);
    const list = getList(domain, listId);
    const mod = doc.mods[modId];
    if (!list || !mod) return;

    setBusy(true, 'checking…');
    let prepared;
    try {
      prepared = await prepareListRun(domain, listId, { force: !!(opts && opts.force), onlyModId: modId });
    } catch (err) {
      logLine('could not prepare: ' + (err && err.message));
      setBusy(false);
      return;
    }
    setBusy(false);

    let files = prepared.built.filter(i => i.kind === 'file');
    if (!files.length) {
      // Nothing outstanding is a normal answer, not a dead end — offer the re-fetch here
      // rather than making the user hunt for a separate "force" control.
      const again = await confirmModal(
        'Already up to date',
        `"${mod.name}" has nothing new in ${list.name}. Download its files again anyway?`,
        'Download again'
      );
      if (!again) return;
      prepared = await prepareListRun(domain, listId, { force: true, onlyModId: modId });
      files = prepared.built.filter(i => i.kind === 'file');
      if (!files.length) { logLine(`${mod.name}: no files listed to download.`); return; }
    }

    queue.items = prepared.built;
    queue.paused = false;
    queue.authFails = 0;
    queue.itemMs = [];
    saveQueue();
    logLine(`queued ${files.length} file(s) for ${mod.name}`);
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
  // DEPENDENCY GRAPH
  // ==========================================================================

  /*
    One structure, three views. The table, the matrix and the picture must never be able
    to disagree about what depends on what, so they all read this and nothing else.

    Scope is "mods that are in at least one list", because that is what the lists would
    actually install. A mod sitting in the library in no list is not part of any build,
    and its requirements aren't your problem yet.
  */
  function buildDepGraph(domain) {
    const doc = getGame(domain);
    const nodes = new Map();

    const nodeFor = (key, seed) => {
      let n = nodes.get(key);
      if (!n) {
        n = Object.assign({
          key, modId: null, name: key, url: null, kind: 'mod',
          inLists: [], dependents: [], dependencies: [], note: '', noteTag: null
        }, seed || {});
        nodes.set(key, n);
      }
      return n;
    };

    const keyForMod = (modId) => 'mod:' + modId;
    const keyForDep = (dep) => {
      if (dep.kind === 'dlc') return 'dlc:' + String(dep.name).toLowerCase();
      if (dep.modId) return 'mod:' + dep.modId;
      return 'off:' + String(dep.url || dep.name).toLowerCase();
    };

    // Seed with everything the lists hold.
    const inSomeList = new Set();
    for (const list of doc.lists) {
      for (const modId of list.modIds) inSomeList.add(modId);
    }
    for (const modId of inSomeList) {
      const mod = doc.mods[modId];
      if (!mod) continue;
      const n = nodeFor(keyForMod(modId), {
        modId, name: mod.name || `Mod ${modId}`, url: mod.url, kind: 'mod'
      });
      n.name = mod.name || n.name;
      n.url = mod.url || n.url;
      n.inLists = listsContainingMod(domain, modId).map(l => ({ id: l.id, name: l.name }));
    }

    // Then the edges, synthesising any required mod that isn't in the library.
    const edges = [];
    for (const modId of inSomeList) {
      const mod = doc.mods[modId];
      if (!mod) continue;
      const fromKey = keyForMod(modId);
      const all = [
        ...(mod.deps || []).map(d => Object.assign({}, d, { kind: 'mod' })),
        ...(mod.offsiteDeps || []).map(d => Object.assign({}, d, { kind: 'offsite' })),
        ...(mod.dlcDeps || []).map(d => Object.assign({}, d, { kind: 'dlc' }))
      ];
      for (const dep of all) {
        const toKey = keyForDep(dep);
        if (toKey === fromKey) continue;                // a mod requiring itself: ignore
        const target = nodeFor(toKey, {
          modId: dep.modId || null, name: dep.name, url: dep.url,
          kind: dep.kind === 'mod' ? 'mod' : dep.kind
        });
        if (!target.inLists.length && dep.modId) {
          target.inLists = listsContainingMod(domain, dep.modId).map(l => ({ id: l.id, name: l.name }));
        }
        if (!target.note && dep.note) { target.note = dep.note; target.noteTag = dep.noteTag || null; }

        if (edges.some(e => e.from === fromKey && e.to === toKey)) continue;
        edges.push({
          from: fromKey, to: toKey,
          note: dep.note || '', noteTag: dep.noteTag || null, hard: !!dep.hard,
          soft: /OPTIONAL|RECOMMENDED/i.test(dep.noteTag || '')
        });
        nodes.get(fromKey).dependencies.push(toKey);
        target.dependents.push(fromKey);
      }
    }

    const list = [...nodes.values()];
    for (const n of list) {
      n.status = n.kind === 'offsite' ? 'offsite'
        : n.kind === 'dlc' ? 'dlc'
        : n.inLists.length ? 'have' : 'missing';
    }
    return { domain, nodes, list, edges, cycles: detectCycles(nodes) };
  }

  /*
    Mutual requirements are common on Nexus and they break any install order the graph
    implies, so they get found and named rather than quietly producing a broken layering.
  */
  function detectCycles(nodes) {
    const cycles = [];
    const state = new Map();     // key -> 0 unvisited, 1 on stack, 2 done
    const stack = [];

    const visit = (key) => {
      const s = state.get(key) || 0;
      if (s === 1) {
        const at = stack.indexOf(key);
        if (at >= 0) cycles.push(stack.slice(at).concat(key));
        return;
      }
      if (s === 2) return;
      state.set(key, 1);
      stack.push(key);
      const node = nodes.get(key);
      for (const dep of (node ? node.dependencies : [])) visit(dep);
      stack.pop();
      state.set(key, 2);
    };
    for (const key of nodes.keys()) visit(key);

    // De-duplicate rotations of the same loop.
    const seen = new Set();
    return cycles.filter(c => {
      const sig = c.slice(0, -1).slice().sort().join('|');
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  /*
    Foundations first. Kahn's algorithm over the requirement edges; anything left over is
    in a cycle and gets appended in dependent-count order so the output is still usable.
  */
  function installOrder(graph) {
    const remaining = new Map();
    for (const n of graph.list) {
      if (n.kind !== 'mod') continue;
      remaining.set(n.key, n.dependencies.filter(k => {
        const t = graph.nodes.get(k);
        return t && t.kind === 'mod';
      }).length);
    }
    const out = [];
    let guard = 0;
    while (remaining.size && guard++ < 10000) {
      const ready = [...remaining.entries()].filter(([, c]) => c === 0).map(([k]) => k);
      if (!ready.length) break;
      ready.sort((a, b) =>
        graph.nodes.get(b).dependents.length - graph.nodes.get(a).dependents.length);
      for (const key of ready) {
        out.push(key);
        remaining.delete(key);
        for (const dependent of graph.nodes.get(key).dependents) {
          if (remaining.has(dependent)) remaining.set(dependent, remaining.get(dependent) - 1);
        }
      }
    }
    const stuck = [...remaining.keys()].sort((a, b) =>
      graph.nodes.get(b).dependents.length - graph.nodes.get(a).dependents.length);

    /*
      Kahn leaves two different kinds of node behind and they deserve different words: the
      ones actually in a mutual-requirement loop, and the ones merely sitting downstream of
      one. Calling the second kind "in a loop" sends you hunting for a cycle that isn't
      there, so cycle membership is taken from the real cycle list, not from "unresolved".
    */
    const inCycle = new Set();
    for (const cycle of graph.cycles) for (const key of cycle) inCycle.add(key);

    return {
      order: out.concat(stuck),
      unresolved: stuck,
      cyclic: stuck.filter(k => inCycle.has(k)),
      blocked: stuck.filter(k => !inCycle.has(k))
    };
  }

  /*
    Which lists cannot be installed without which other lists.

    A dependency only crosses a boundary when the required mod is NOT also in the
    dependent's own list — a list that already contains what it needs is self-sufficient,
    however many other lists happen to hold a copy.
  */
  function crossListMatrix(domain, graph) {
    const doc = getGame(domain);
    const cells = new Map();     // "from|to" -> [{fromMod, toMod}]
    for (const edge of graph.edges) {
      const from = graph.nodes.get(edge.from);
      const to = graph.nodes.get(edge.to);
      if (!from || !to || to.kind !== 'mod' || !to.inLists.length) continue;
      for (const la of from.inLists) {
        const selfSufficient = to.inLists.some(l => l.id === la.id);
        if (selfSufficient) continue;
        for (const ld of to.inLists) {
          const key = la.id + '|' + ld.id;
          if (!cells.has(key)) cells.set(key, []);
          const bucket = cells.get(key);
          if (!bucket.some(p => p.fromMod === from.key && p.toMod === to.key)) {
            bucket.push({ fromMod: from.key, toMod: to.key });
          }
        }
      }
    }
    return { lists: doc.lists, cells };
  }

  // ---------------------------------------------------------------- layout

  const G_NODE_W = 150, G_NODE_H = 30, G_HGAP = 18, G_VGAP = 54;

  /*
    Longest-path layering: a node sits one level below its deepest requirement, so
    foundations end up on the top row and install order reads downward. Cycle edges are
    skipped by the on-stack guard rather than being allowed to recurse forever.
  */
  function layerGraph(graph, keys) {
    const included = new Set(keys);
    const depth = new Map();
    const busy = new Set();
    const compute = (key) => {
      if (depth.has(key)) return depth.get(key);
      if (busy.has(key)) return 0;                 // cycle: treat as a foundation
      busy.add(key);
      const node = graph.nodes.get(key);
      let d = 0;
      for (const dep of (node ? node.dependencies : [])) {
        if (!included.has(dep)) continue;
        d = Math.max(d, compute(dep) + 1);
      }
      busy.delete(key);
      depth.set(key, d);
      return d;
    };
    for (const key of keys) compute(key);

    const layers = [];
    for (const key of keys) {
      const d = depth.get(key) || 0;
      (layers[d] = layers[d] || []).push(key);
    }

    // Two barycentre sweeps: order each row by the average position of what it connects
    // to in the row above. Cheap, and enough to stop the obvious spaghetti.
    const pos = new Map();
    layers.forEach(row => row.forEach((k, i) => pos.set(k, i)));
    for (let pass = 0; pass < 2; pass++) {
      for (let li = 1; li < layers.length; li++) {
        layers[li].sort((a, b) => bary(a) - bary(b));
        layers[li].forEach((k, i) => pos.set(k, i));
      }
    }
    function bary(key) {
      const node = graph.nodes.get(key);
      const refs = (node ? node.dependencies : []).filter(k => pos.has(k)).map(k => pos.get(k));
      return refs.length ? refs.reduce((a, b) => a + b, 0) / refs.length : 0;
    }

    const placed = new Map();
    layers.forEach((row, li) => {
      row.forEach((key, i) => {
        placed.set(key, { x: i * (G_NODE_W + G_HGAP), y: li * (G_NODE_H + G_VGAP) });
      });
    });
    const width = Math.max(1, ...layers.map(r => r.length)) * (G_NODE_W + G_HGAP);
    const height = layers.length * (G_NODE_H + G_VGAP);
    return { placed, layers, width, height };
  }

  // ==========================================================================
  // HARVEST — collect mod links off whatever page you're on
  // ==========================================================================

  /*
    Any Nexus page — a collection, a forum post, a "mods using this" list, a search
    result — is a pile of mod links. Scrape them, dedupe, and let the whole pile be
    filed at once instead of opening thirty tabs.

    The names here come from link text, which is often the mod's title but sometimes
    "click here". They are provisional: everything is added as a stub and the real name
    arrives when the page is read. Better an instant list of mostly-right names than a
    thirty-request wait before the picker opens.
  */
  /*
    Regions whose mod links are real links but not things you'd want to bulk-file.

    The translation table is the one that actually bites: it links a dozen real mod pages
    labelled "Czech", "German", "German", "Mandarin"… — verified on Legacy of the
    Dragonborn, where 12 of 36 harvested links were translations. Site chrome contributes
    the rest.
  */
  const HARVEST_EXCLUDE = [
    'table.translation-table',   // "Translations available on the Nexus"
    'header', 'footer', 'nav',
    '#nav', '.header-nav', '.subnav',
    '#section > .breadcrumb', '#breadcrumb'
  ].join(',');

  function harvestModLinks() {
    const here = parseModUrl(location.href);
    const found = new Map();

    for (const a of document.querySelectorAll('a[href*="/mods/"]')) {
      const parsed = parseModUrl(a.getAttribute('href'));
      if (!parsed) continue;
      if (here && parsed.url === here.url) continue;         // the page you're already on
      if (a.closest(HARVEST_EXCLUDE)) continue;
      // Link text first; then the tooltip or image alt, which is where card and tile
      // layouts keep the title. Author-embedded banner images carry none of these, and
      // those simply stay unnamed until their page is read.
      const label = (
        (a.textContent || '').replace(/\s+/g, ' ').trim() ||
        (a.getAttribute('title') || '').trim() ||
        ((a.querySelector('img') || {}).getAttribute
          ? (a.querySelector('img').getAttribute('alt') || '').trim()
          : '')
      );

      if (found.has(parsed.url)) {
        // Prefer the longest label seen: image links are usually empty, and the title
        // link next to them usually carries the real name.
        const existing = found.get(parsed.url);
        if (label.length > (existing.label || '').length) existing.label = label;
        continue;
      }
      found.set(parsed.url, {
        url: parsed.url,
        gameDomain: parsed.gameDomain,
        modId: parsed.modId,
        label
      });
    }
    return [...found.values()];
  }

  function harvestName(item) {
    const known = getGame(item.gameDomain).mods[item.modId];
    if (known && known.name) return known.name;
    const label = item.label || '';
    // Link text that is obviously not a title.
    if (!label || label.length < 3 || /^(here|link|click|download|view|more)$/i.test(label)) {
      return `Mod ${item.modId}`;
    }
    // The row wraps now, so this cap only exists to stop a pathological link (an entire
    // paragraph wrapped in an anchor) from taking over the dialog.
    return label.length > 120 ? label.slice(0, 119) + '…' : label;
  }

  async function openHarvest() {
    const items = harvestModLinks();
    if (!items.length) {
      logLine('no mod links found on this page');
      return;
    }

    // Group by game: a collection page can legitimately mix them.
    const byGame = new Map();
    for (const item of items) {
      if (!byGame.has(item.gameDomain)) byGame.set(item.gameDomain, []);
      byGame.get(item.gameDomain).push(item);
    }

    const wrap = document.createElement('div');
    wrap.className = 'ncHarvest';

    const intro = document.createElement('div');
    intro.className = 'ncModalText';
    intro.textContent = `${items.length} mod link${items.length === 1 ? '' : 's'} on this page.` +
      (byGame.size > 1 ? ` Across ${byGame.size} games — each goes to its own game's lists.` : '');
    wrap.appendChild(intro);

    const boxes = [];
    for (const [domain, list] of byGame) {
      const doc = getGame(domain);
      const head = document.createElement('div');
      head.className = 'ncHarvestHead';
      head.textContent = doc.name || domain;
      wrap.appendChild(head);

      const rows = document.createElement('div');
      rows.className = 'ncHarvestRows';
      for (const item of list) {
        const inLists = listsContainingMod(domain, item.modId);
        const row = document.createElement('label');
        row.className = 'ncHarvestRow' + (inLists.length ? ' ncHarvestHave' : '');

        const box = document.createElement('input');
        box.type = 'checkbox';
        // Default to the ones you don't already have — the common intent.
        box.checked = !inLists.length;
        boxes.push({ box, item, domain });

        const name = document.createElement('span');
        name.className = 'ncHarvestName';
        name.textContent = harvestName(item);

        const meta = document.createElement('span');
        meta.className = 'ncHarvestMeta';
        meta.textContent = inLists.length
          ? 'already in ' + inLists.map(l => l.name).join(', ')
          : '#' + item.modId;

        row.append(box, name, meta);
        rows.appendChild(row);
      }
      wrap.appendChild(rows);
    }

    /*
      A segmented control, not three plain buttons.

      The selection starts as "only new", so a plain "Only new" button was a no-op on
      first click — it looked broken because nothing moved. Showing which mode is active
      makes that state legible, and ticking a box by hand drops the highlight because the
      selection is then no longer any of the three.
    */
    const MODES = [['all', 'Select all'], ['none', 'Select none'], ['new', 'Only new']];
    let mode = 'new';
    const toggle = document.createElement('div');
    toggle.className = 'ncAuditFilters ncSegmented';
    const modeButtons = new Map();

    const paintMode = () => {
      for (const [id, btn] of modeButtons) btn.classList.toggle('ncOn', id === mode);
    };
    const applyMode = (id) => {
      mode = id;
      for (const entry of boxes) {
        entry.box.checked = id === 'all' ? true
          : id === 'none' ? false
          : !listsContainingMod(entry.domain, entry.item.modId).length;
      }
      paintMode();
    };

    for (const [id, label] of MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ncChipBtn';
      b.textContent = label;
      b.addEventListener('click', () => applyMode(id));
      modeButtons.set(id, b);
      toggle.appendChild(b);
    }
    for (const entry of boxes) {
      entry.box.addEventListener('change', () => { mode = null; paintMode(); });
    }
    paintMode();
    wrap.insertBefore(toggle, wrap.children[1]);

    openModal({
      title: 'Mods on this page',
      bodyNode: wrap,
      wide: true,
      actions: [
        { label: 'Add selected to…', primary: true, onClick: async (m) => {
          const chosen = boxes.filter(e => e.box.checked);
          if (!chosen.length) return;
          const domains = [...new Set(chosen.map(e => e.domain))];
          m.close();

          const added = [];
          for (const domain of domains) {
            const forDomain = chosen.filter(e => e.domain === domain);
            const listId = await pickListModal(domain, {
              title: `Add ${forDomain.length} mod(s)`,
              intro: `Put ${forDomain.length} mod(s) from ${getGame(domain).name} into which list?`
            });
            if (!listId) continue;
            for (const entry of forDomain) {
              const ok = addDepAsStub(domain, {
                modId: entry.item.modId,
                name: harvestName(entry.item),
                url: entry.item.url
              }, listId);
              if (ok) added.push({ domain, modId: entry.item.modId });
            }
            flushGames();
            logLine(`added ${forDomain.length} mod(s) to ${getList(domain, listId).name}`);
          }
          renderDock();
          if (added.length) await resolveStubsQuietly(added);
        } },
        { label: 'Cancel', onClick: (m) => m.close() }
      ]
    });
  }

  /*
    Fill in real names for freshly-added stubs, in the background.

    Deliberately silent about dependencies: reading these pages surfaces requirements, but
    firing an intake popup per mod after a bulk add would be a wall of modals. The records
    are stored, so the audit sees them immediately and the popups stay with the deliberate
    one-at-a-time add.
  */
  async function resolveStubsQuietly(added) {
    const targets = added.slice(0, 40);
    if (added.length > targets.length) {
      logLine(`reading the first ${targets.length} of ${added.length}; the rest stay unread until used`);
    }
    let done = 0;
    for (const item of targets) {
      const mod = getGame(item.domain).mods[item.modId];
      if (!mod || mod.state === 'resolved') continue;
      setBusy(true, `reading ${++done}/${targets.length}…`);
      try {
        const record = await resolveModRecord(mod.url);
        upsertMod(item.domain, record);
      } catch (err) {
        logLine(`could not read mod ${item.modId}: ${err && err.message}`);
      }
    }
    flushGames();
    setBusy(false);
    if (done) logLine(`read ${done} mod page(s)`);
    if (libState.modal) renderLibrary();
  }

  // ==========================================================================
  // LIBRARY OVERLAY
  // ==========================================================================

  const libState = { domain: null, listId: null, modal: null, pane: 'lists', cursor: { games: 0, lists: 0, mods: 0 } };

  /*
    Keyboard navigation across the three panes.

    ←/→ move between panes and ↑/↓ within one, which is the mental model the panes already
    imply — the rail is left of lists, lists left of mods. Enter activates: on a list that
    means select it, on a mod it opens the page. Everything remains clickable; this is an
    addition, not a mode.
  */
  function libraryPanes() {
    const idx = readIndex();
    const domains = Object.keys(idx.games).sort((a, b) =>
      (idx.games[a].name || a).localeCompare(idx.games[b].name || b));
    const doc = libState.domain ? getGame(libState.domain) : null;
    const list = doc && libState.listId ? doc.lists.find(l => l.id === libState.listId) : null;
    return {
      games: domains,
      lists: doc ? doc.lists.map(l => l.id) : [],
      mods: list ? list.modIds.slice() : []
    };
  }

  function clampLibCursor() {
    const panes = libraryPanes();
    for (const key of ['games', 'lists', 'mods']) {
      const n = panes[key].length;
      libState.cursor[key] = n ? Math.max(0, Math.min(libState.cursor[key], n - 1)) : 0;
    }
    return panes;
  }

  function handleLibraryKey(e) {
    // Never steal keys from a text field, and never from a modal stacked on top of us.
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    if (!libState.modal) return;
    if (modalStack[modalStack.length - 1] !== libState.modal.modal) return;

    const panes = clampLibCursor();
    const order = ['games', 'lists', 'mods'];
    /*
      Moving in the games or lists pane selects as it goes, exactly as clicking does.
      Requiring Enter left the cursor on one list while the mods pane still showed
      another, which reads as a bug even though it was the rule. Mods are different: the
      cursor there is just a cursor, and Enter opens the page.
    */
    const move = (delta) => {
      const items = panes[libState.pane];
      if (!items.length) return;
      const at = (libState.cursor[libState.pane] + delta + items.length) % items.length;
      libState.cursor[libState.pane] = at;
      if (libState.pane === 'games') {
        libState.domain = items[at];
        libState.listId = null;
        libState.cursor.lists = 0;
        renderLibrary();
      } else if (libState.pane === 'lists') {
        libState.listId = items[at];
        libState.cursor.mods = 0;
        renderLibrary();
      } else {
        applyLibCursor();
      }
    };

    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const at = order.indexOf(libState.pane);
      const next = order[Math.max(0, Math.min(order.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)))];
      if (panes[next].length || next !== 'mods') libState.pane = next;
      applyLibCursor();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const items = panes[libState.pane];
      const picked = items[libState.cursor[libState.pane]];
      if (picked === undefined) return;
      if (libState.pane === 'games' || libState.pane === 'lists') {
        // Already selected by the cursor; step right into what it opened.
        libState.pane = libState.pane === 'games' ? 'lists' : 'mods';
        applyLibCursor();
      } else {
        const mod = getGame(libState.domain).mods[picked];
        const url = (mod && mod.url) || `https://www.nexusmods.com/${libState.domain}/mods/${picked}`;
        window.open(url, '_blank', 'noreferrer');
      }
    }
  }

  // Paint the cursor without a full re-render, so holding an arrow key stays smooth.
  function applyLibCursor() {
    if (!libState.modal) return;
    const { wrap } = libState.modal;
    const map = { games: '.ncRailItem', lists: '.ncCol .ncRow', mods: '.ncColWide .ncRow' };
    for (const [pane, sel] of Object.entries(map)) {
      const nodes = [...wrap.querySelectorAll(sel)]
        .filter(el => pane !== 'lists' || !el.closest('.ncColWide'));
      nodes.forEach((el, i) => {
        const on = pane === libState.pane && i === libState.cursor[pane];
        el.classList.toggle('ncCursor', on);
        if (on) el.scrollIntoView({ block: 'nearest' });
      });
    }
  }

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
    document.addEventListener('keydown', handleLibraryKey, true);
    const stop = modal.close;
    modal.close = (result) => {
      document.removeEventListener('keydown', handleLibraryKey, true);
      stop(result);
    };
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
    const auditBtn = document.createElement('button');
    auditBtn.type = 'button';
    auditBtn.className = 'ncMiniWide';
    auditBtn.textContent = 'Audit';
    auditBtn.title = 'Dependency audit for this game';
    auditBtn.addEventListener('click', () => openAudit(libState.domain));
    listsHead.appendChild(auditBtn);
    const addListBtn = document.createElement('button');
    addListBtn.type = 'button';
    addListBtn.className = 'ncMiniWide';   // not ncMini: that is a fixed 32px icon slot
    addListBtn.textContent = 'New list';
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
      const roll = listDownloadRollup(libState.domain, list);
      // Kept terse: this column is narrow and the meta line ellipsises, so long words
      // here silently hide the counts that follow them.
      const bits = [`${list.modIds.length} mod${list.modIds.length === 1 ? '' : 's'}`];
      if (roll.pending) bits.push(`${roll.pending} to get`);
      if (roll.unread) bits.push(`${roll.unread} unread`);
      if (list.includeOptional) bits.push('+opt');
      m.textContent = bits.join(' · ');
      pick.append(n, m);
      if (roll.pending) {
        const dot = document.createElement('span');
        dot.className = 'ncDlState ncDlStale';
        dot.textContent = '↑';
        dot.title = `${roll.pending} file(s) across ${roll.mods} mod(s) not downloaded or out of date`;
        pick.appendChild(dot);
      }
      pick.addEventListener('click', () => { libState.listId = list.id; renderLibrary(); });

      const ren = document.createElement('button');
      ren.type = 'button';
      ren.className = 'ncMini';
      ren.title = 'List settings';
      ren.textContent = '⚙';
      ren.addEventListener('click', () => openListSettings(libState.domain, list.id));

      // No separate delete button: it was the one colour-emoji glyph in the UI, and
      // Delete already lives inside the settings dialog next to the other list actions.
      row.append(pick, ren);
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
        const wanted = downloadableFiles(list, mod);
        const dl = mod.download && mod.download.files ? mod.download.files : {};
        const havingAll = wanted.length && wanted.every(f => !fileNeedsDownload(mod, f, false));
        const someHeld = Object.keys(dl).length > 0;
        const state = document.createElement('span');
        state.className = 'ncDlState ' +
          (havingAll ? 'ncDlOk' : someHeld ? 'ncDlStale' : 'ncDlNone');
        // ↑ rather than ⬆: U+2B06 has emoji presentation by default and renders as a
        // colour glyph, which reads as decoration next to the plain ✓.
        state.textContent = havingAll ? '✓' : someHeld ? '↑' : '·';
        state.title = havingAll ? 'All main files downloaded and current'
          : someHeld ? 'An update is available' : 'Never downloaded';
        main.prepend(state);
        main.append(n, m);

        const acts = document.createElement('div');
        acts.className = 'ncRowActs';

        const get = document.createElement('button');
        get.type = 'button';
        get.className = 'ncRowBtn';
        get.textContent = 'Get';
        get.title = havingAll
          ? 'Already current — offers to download again'
          : 'Download this mod\'s files into this list';
        get.disabled = queue.running;
        get.addEventListener('click', () => {
          libState.modal && libState.modal.modal.close();
          startModDownload(libState.domain, list.id, modId, {});
        });

        const mv = document.createElement('button');
        mv.type = 'button';
        mv.className = 'ncRowBtn';
        mv.textContent = 'Move';
        mv.title = 'Move to another list (removes it from this one)';
        mv.addEventListener('click', async () => {
          const target = await pickListModal(libState.domain, {
            title: `Move ${mod.name || modId}`,
            intro: `Move "${mod.name || modId}" out of ${list.name} and into…`,
            excludeListId: list.id,
            marksModId: modId
          });
          if (!target) return;
          moveModBetweenLists(libState.domain, modId, list.id, target);
          flushGames();
          logLine(`moved "${mod.name}" → ${getList(libState.domain, target).name}`);
          renderLibrary();
        });

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'ncRowBtn ncDanger';
        rm.textContent = 'Remove';
        rm.title = 'Remove from this list (stays in the library)';
        rm.addEventListener('click', () => {
          removeModFromList(libState.domain, list.id, modId);
          flushGames();
          logLine(`removed "${mod.name}" from ${list.name}`);
          renderLibrary();
        });

        acts.append(get, mv, rm);
        row.append(main, acts);
        modRows.appendChild(row);
      }
    }
    modsCol.appendChild(modRows);

    const hint = document.createElement('div');
    hint.className = 'ncLibHint';
    hint.textContent = '←/→ pane · ↑/↓ move · Enter select · Esc close';
    modsCol.appendChild(hint);

    wrap.append(rail, listsCol, modsCol);

    // Keep the keyboard cursor pointing at whatever is actually selected after a render.
    const panes = libraryPanes();
    const gi = panes.games.indexOf(libState.domain);
    if (gi >= 0) libState.cursor.games = gi;
    const li = panes.lists.indexOf(libState.listId);
    if (li >= 0) libState.cursor.lists = li;
    clampLibCursor();
    applyLibCursor();
  }

  // ==========================================================================
  // AUDIT
  // ==========================================================================

  const auditState = { domain: null, view: 'foundation', filter: 'all', zoom: 1, hideLeaves: false };

  function openAudit(domain) {
    auditState.domain = domain;
    const wrap = document.createElement('div');
    wrap.className = 'ncAudit';
    const modal = openModal({
      title: `Dependency audit — ${getGame(domain).name}`,
      bodyNode: wrap,
      huge: true,
      onClose: () => { auditState.modal = null; }
    });
    auditState.modal = { modal, wrap };
    renderAudit();
  }

  function renderAudit() {
    if (!auditState.modal) return;
    const { wrap } = auditState.modal;
    const domain = auditState.domain;
    const graph = buildDepGraph(domain);
    wrap.textContent = '';

    // ---- view switcher
    const tabs = document.createElement('div');
    tabs.className = 'ncAuditTabs';
    const views = [
      ['foundation', 'Foundations'],
      ['crosslist', 'Cross-list'],
      ['graph', 'Graph'],
      ['order', 'Install order']
    ];
    for (const [id, label] of views) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ncAuditTab' + (auditState.view === id ? ' ncOn' : '');
      b.textContent = label;
      b.addEventListener('click', () => { auditState.view = id; renderAudit(); });
      tabs.appendChild(b);
    }
    wrap.appendChild(tabs);

    if (graph.cycles.length) {
      const warn = document.createElement('div');
      warn.className = 'ncCycleWarn';
      warn.textContent = `${graph.cycles.length} mutual-requirement loop(s): ` +
        graph.cycles.slice(0, 3).map(c =>
          c.slice(0, -1).map(k => (graph.nodes.get(k) || {}).name || k).join(' ⇄ ')
        ).join('  ·  ');
      warn.title = 'These have no valid install order between them; install either first.';
      wrap.appendChild(warn);
    }

    const body = document.createElement('div');
    body.className = 'ncAuditBody';
    wrap.appendChild(body);

    if (!graph.edges.length) {
      const e = document.createElement('div');
      e.className = 'ncEmpty';
      e.textContent = 'Nothing in this game\'s lists declares a dependency yet.';
      body.appendChild(e);
      return;
    }

    if (auditState.view === 'foundation') renderFoundations(body, graph);
    else if (auditState.view === 'crosslist') renderCrossList(body, graph);
    else if (auditState.view === 'graph') renderGraphView(body, graph);
    else renderInstallOrder(body, graph);
  }

  const STATUS_LABEL = { have: '✓ Have', missing: '✗ Missing', offsite: '⧉ Off-site', dlc: '⧉ Game DLC' };

  /*
    The default view, and the actionable one: everything anything depends on, ranked by
    how much depends on it. The top of this table is the set of mods to install first,
    and anything red is a hole in the library.
  */
  function renderFoundations(body, graph) {
    const filters = document.createElement('div');
    filters.className = 'ncAuditFilters';
    for (const [id, label] of [['all', 'All'], ['missing', 'Missing only'], ['external', 'Off-site & DLC']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ncChipBtn' + (auditState.filter === id ? ' ncOn' : '');
      b.textContent = label;
      b.addEventListener('click', () => { auditState.filter = id; renderAudit(); });
      filters.appendChild(b);
    }
    body.appendChild(filters);

    let rows = graph.list.filter(n => n.dependents.length > 0);
    if (auditState.filter === 'missing') rows = rows.filter(n => n.status === 'missing');
    else if (auditState.filter === 'external') rows = rows.filter(n => n.status === 'offsite' || n.status === 'dlc');
    rows.sort((a, b) => b.dependents.length - a.dependents.length ||
      a.name.localeCompare(b.name));

    if (!rows.length) {
      const e = document.createElement('div');
      e.className = 'ncEmpty';
      e.textContent = 'Nothing matches that filter.';
      body.appendChild(e);
      return;
    }

    const table = document.createElement('table');
    table.className = 'ncTable ncAuditTable';
    table.innerHTML = `<thead><tr>
      <th>Required mod</th><th>Depended on by</th><th>In lists</th><th>Status</th><th></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    for (const node of rows) {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      if (node.url) {
        const a = document.createElement('a');
        a.className = 'ncDepLink';
        a.href = node.url; a.target = '_blank'; a.rel = 'noreferrer';
        a.textContent = node.name;
        nameTd.appendChild(a);
      } else {
        nameTd.textContent = node.name;
      }
      if (node.note) {
        const note = document.createElement('div');
        note.className = 'ncSubNote';
        note.textContent = node.note;
        nameTd.appendChild(note);
      }

      const countTd = document.createElement('td');
      countTd.textContent = `${node.dependents.length} mod${node.dependents.length === 1 ? '' : 's'}`;

      const listsTd = document.createElement('td');
      listsTd.textContent = node.inLists.length ? node.inLists.map(l => l.name).join(', ') : '—';

      const statusTd = document.createElement('td');
      const chip = document.createElement('span');
      chip.className = 'ncChip ' + (
        node.status === 'have' ? 'ncChipOk'
          : node.status === 'missing' ? 'ncChipRequired' : 'ncChipMuted');
      chip.textContent = STATUS_LABEL[node.status];
      statusTd.appendChild(chip);

      const actTd = document.createElement('td');
      actTd.className = 'ncActionCell';
      if (node.status === 'missing' && node.modId) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'ncMiniWide';
        add.textContent = '+ Add to…';
        add.addEventListener('click', async () => {
          const listId = await pickListModal(auditState.domain, {
            title: `Add ${node.name}`, intro: `Add "${node.name}" to which list?`,
            marksModId: node.modId
          });
          if (!listId) return;
          addDepAsStub(auditState.domain, { modId: node.modId, name: node.name, url: node.url }, listId);
          flushGames();
          logLine(`+ ${node.name} → ${getList(auditState.domain, listId).name}`);
          renderAudit();
        });
        actTd.appendChild(add);
      }

      tr.append(nameTd, countTd, listsTd, statusTd, actTd);
      tbody.appendChild(tr);

      // Expandable dependents row.
      const detail = document.createElement('tr');
      detail.className = 'ncDetailRow';
      detail.hidden = true;
      const detailTd = document.createElement('td');
      detailTd.colSpan = 5;
      detailTd.className = 'ncDetailCell';
      detailTd.textContent = 'Needed by: ' +
        node.dependents.map(k => (graph.nodes.get(k) || {}).name || k).join(', ');
      detail.appendChild(detailTd);
      tbody.appendChild(detail);

      nameTd.style.cursor = 'pointer';
      nameTd.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') return;
        detail.hidden = !detail.hidden;
      });
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  /*
    The screen that answers "can I install this list on its own?". A non-empty cell means
    the row's list depends on mods that only exist in the column's list.
  */
  function renderCrossList(body, graph) {
    const { lists, cells } = crossListMatrix(auditState.domain, graph);
    if (lists.length < 2) {
      const e = document.createElement('div');
      e.className = 'ncEmpty';
      e.textContent = 'Cross-list dependencies need at least two lists.';
      body.appendChild(e);
      return;
    }

    const intro = document.createElement('div');
    intro.className = 'ncModalText';
    intro.textContent = 'A number means the row\'s list needs mods that live only in the column\'s list — install both.';
    body.appendChild(intro);

    const table = document.createElement('table');
    table.className = 'ncTable ncMatrix';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.appendChild(document.createElement('th'));
    for (const l of lists) {
      const th = document.createElement('th');
      th.textContent = l.name;
      th.className = 'ncMatrixColHead';
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    let anyCell = false;
    for (const rowList of lists) {
      const tr = document.createElement('tr');
      const rh = document.createElement('th');
      rh.textContent = rowList.name;
      rh.className = 'ncMatrixRowHead';
      tr.appendChild(rh);
      for (const colList of lists) {
        const td = document.createElement('td');
        td.className = 'ncMatrixCell';
        if (rowList.id === colList.id) {
          td.textContent = '·';
          td.classList.add('ncMatrixSelf');
        } else {
          const pairs = cells.get(rowList.id + '|' + colList.id) || [];
          if (!pairs.length) {
            td.textContent = '';
          } else {
            anyCell = true;
            td.classList.add('ncMatrixHit');
            // Count the required mods, not the edges: the caption promises "mods that
            // live only in the column's list", and three mods needed by two dependents
            // is three mods, not six.
            const requiredMods = new Set(pairs.map(p => p.toMod));
            td.textContent = String(requiredMods.size);
            td.title = [...requiredMods]
              .map(k => (graph.nodes.get(k) || {}).name)
              .join('\n');
            td.style.cursor = 'pointer';
            td.addEventListener('click', () => {
              const detail = document.createElement('div');
              detail.className = 'ncModalText';
              const byRequired = new Map();
              for (const p of pairs) {
                if (!byRequired.has(p.toMod)) byRequired.set(p.toMod, []);
                byRequired.get(p.toMod).push(p.fromMod);
              }
              detail.innerHTML = [...byRequired.entries()].map(([to, froms]) =>
                `<b>${escapeHtml((graph.nodes.get(to) || {}).name || '')}</b> — needed by ` +
                froms.map(f => escapeHtml((graph.nodes.get(f) || {}).name || '')).join(', ')
              ).join('<br>');
              openModal({
                title: `${rowList.name} → ${colList.name}`,
                bodyNode: detail,
                actions: [{ label: 'Close', primary: true, onClick: (m) => m.close() }]
              });
            });
          }
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);

    if (!anyCell) {
      const good = document.createElement('div');
      good.className = 'ncModalText ncSatisfied';
      good.textContent = 'Every list is self-sufficient — none of them needs a mod that lives only in another list.';
      body.appendChild(good);
    }
  }

  function renderInstallOrder(body, graph) {
    const { order, cyclic, blocked } = installOrder(graph);
    const intro = document.createElement('div');
    intro.className = 'ncModalText';
    intro.textContent = 'Foundations first. Mods with no requirements of their own come earliest.';
    body.appendChild(intro);

    const cyclicSet = new Set(cyclic);
    const blockedSet = new Set(blocked);

    const pre = document.createElement('pre');
    pre.className = 'ncOrderPre';
    pre.textContent = order.map((k, i) => {
      const n = graph.nodes.get(k);
      const flags = [];
      if (n.status === 'missing') flags.push('[MISSING]');
      if (cyclicSet.has(k)) flags.push('[in a loop]');
      else if (blockedSet.has(k)) flags.push('[waits on a loop]');
      return `${String(i + 1).padStart(3, ' ')}. ${n.name}${flags.length ? '  ' + flags.join(' ') : ''}`;
    }).join('\n');
    body.appendChild(pre);

    if (cyclic.length) {
      const note = document.createElement('div');
      note.className = 'ncHint';
      note.textContent = '[in a loop] = mutually required, so no order between them is correct — ' +
        'install either first. [waits on a loop] = ordered only after that knot is untangled.';
      body.appendChild(note);
    }

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ncMiniWide';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(pre.textContent)
        .then(() => logLine('install order copied'))
        .catch(() => logLine('clipboard blocked — select the text instead'));
    });
    body.appendChild(copy);
  }

  /*
    The picture. Deliberately third: a library of any size is a hairball as a node graph,
    and the two views above answer the actual questions better. This is for seeing shape.
  */
  function renderGraphView(body, graph) {
    const controls = document.createElement('div');
    controls.className = 'ncAuditFilters';

    const leafToggle = document.createElement('button');
    leafToggle.type = 'button';
    leafToggle.className = 'ncChipBtn' + (auditState.hideLeaves ? ' ncOn' : '');
    leafToggle.textContent = 'Foundations only';
    leafToggle.title = 'Hide mods that nothing else depends on';
    leafToggle.addEventListener('click', () => {
      auditState.hideLeaves = !auditState.hideLeaves;
      renderAudit();
    });
    controls.appendChild(leafToggle);

    for (const [label, delta] of [['−', -0.2], ['+', 0.2]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ncChipBtn';
      b.textContent = label;
      b.addEventListener('click', () => {
        auditState.zoom = Math.max(0.4, Math.min(2, auditState.zoom + delta));
        renderAudit();
      });
      controls.appendChild(b);
    }

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'ncChipBtn';
    save.textContent = 'Save SVG';
    controls.appendChild(save);
    body.appendChild(controls);

    // Only nodes that participate in an edge; optionally only those with dependents.
    let keys = graph.list
      .filter(n => n.dependents.length || n.dependencies.length)
      .filter(n => !auditState.hideLeaves || n.dependents.length)
      .map(n => n.key);
    const keySet = new Set(keys);

    const { placed, width, height } = layerGraph(graph, keys);
    const PAD = 16;
    const svgW = width + PAD * 2, svgH = height + PAD * 2;

    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    svg.setAttribute('width', String(Math.round(svgW * auditState.zoom)));
    svg.setAttribute('height', String(Math.round(svgH * auditState.zoom)));
    svg.setAttribute('class', 'ncGraphSvg');

    // Edges first, so nodes paint over them.
    for (const edge of graph.edges) {
      if (!keySet.has(edge.from) || !keySet.has(edge.to)) continue;
      const a = placed.get(edge.from), b = placed.get(edge.to);
      if (!a || !b) continue;
      const x1 = a.x + G_NODE_W / 2 + PAD, y1 = a.y + PAD;
      const x2 = b.x + G_NODE_W / 2 + PAD, y2 = b.y + G_NODE_H + PAD;
      const mid = (y1 + y2) / 2;
      const path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`);
      path.setAttribute('class', 'ncGEdge' + (edge.soft ? ' ncGEdgeSoft' : ''));
      const t = graph.nodes.get(edge.to), f = graph.nodes.get(edge.from);
      const title = document.createElementNS(svgNs, 'title');
      title.textContent = `${f.name} needs ${t.name}${edge.note ? ' — ' + edge.note : ''}`;
      path.appendChild(title);
      svg.appendChild(path);
    }

    for (const key of keys) {
      const node = graph.nodes.get(key);
      const p = placed.get(key);
      if (!p) continue;
      const g = document.createElementNS(svgNs, 'g');
      g.setAttribute('transform', `translate(${p.x + PAD},${p.y + PAD})`);
      g.setAttribute('class', 'ncGNode ncGNode-' + node.status);

      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('width', String(G_NODE_W));
      rect.setAttribute('height', String(G_NODE_H));
      rect.setAttribute('rx', '5');
      g.appendChild(rect);

      const text = document.createElementNS(svgNs, 'text');
      text.setAttribute('x', String(G_NODE_W / 2));
      text.setAttribute('y', String(G_NODE_H / 2 + 4));
      text.setAttribute('text-anchor', 'middle');
      const label = node.name.length > 22 ? node.name.slice(0, 21) + '…' : node.name;
      text.textContent = label;
      g.appendChild(text);

      if (node.dependents.length) {
        const badge = document.createElementNS(svgNs, 'text');
        badge.setAttribute('x', String(G_NODE_W - 5));
        badge.setAttribute('y', '-4');
        badge.setAttribute('text-anchor', 'end');
        badge.setAttribute('class', 'ncGBadge');
        badge.textContent = '←' + node.dependents.length;
        g.appendChild(badge);
      }

      const title = document.createElementNS(svgNs, 'title');
      title.textContent = `${node.name}\n${STATUS_LABEL[node.status]}` +
        (node.inLists.length ? `\nIn: ${node.inLists.map(l => l.name).join(', ')}` : '') +
        `\nNeeded by ${node.dependents.length}`;
      g.appendChild(title);
      svg.appendChild(g);
    }

    const scroller = document.createElement('div');
    scroller.className = 'ncGraphScroll';
    scroller.appendChild(svg);
    body.appendChild(scroller);

    const legend = document.createElement('div');
    legend.className = 'ncGraphLegend';
    legend.innerHTML =
      '<span class="ncChip ncChipOk">Have</span>' +
      '<span class="ncChip ncChipRequired">Missing</span>' +
      '<span class="ncChip ncChipMuted">Off-site / DLC</span>' +
      '<span class="ncLegendNote">Arrows point down to what a mod requires · dashed = optional · ←N = how many need it</span>';
    body.appendChild(legend);

    save.addEventListener('click', () => {
      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', svgNs);
      const css = `<style>
        .ncGraphSvg{background:#0b0906;font:11px Arial,sans-serif}
        .ncGEdge{fill:none;stroke:#6b5f55;stroke-width:1.4}
        .ncGEdgeSoft{stroke-dasharray:4 3;stroke:#4f5f7a}
        .ncGNode rect{fill:#1b1410;stroke:#3d332c}
        .ncGNode text{fill:#e8dbd0}
        .ncGNode-missing rect{fill:#3a1712;stroke:#e2604c}
        .ncGNode-have rect{fill:#14251a;stroke:#4f8b5f}
        .ncGBadge{fill:#9c8b7c;font-size:9px}
      </style>`;
      const out = `<svg xmlns="${svgNs}" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">${css}${clone.innerHTML}</svg>`;
      const url = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml' }));
      const name = `${ROOT_FOLDER}/${gameFolder(getGame(auditState.domain))}/dependency-graph.svg`;
      gmDownload(url, name)
        .then(() => logLine('saved ' + name))
        .catch(e => logLine('could not save svg: ' + e.message))
        .finally(() => setTimeout(() => URL.revokeObjectURL(url), 30000));
    });
  }

  /*
    Everything about one list in one place: its name, a note to your future self, and
    whether it wants optional files. Name lives here rather than in a separate rename
    prompt so there is one thing to open when you want to change anything about a list.
  */
  function openListSettings(domain, listId) {
    const list = getList(domain, listId);
    if (!list) return;

    const wrap = document.createElement('div');
    wrap.className = 'ncForm';

    const nameLabel = document.createElement('div');
    nameLabel.className = 'ncFieldLabel';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ncInput';
    nameInput.value = list.name;

    const noteLabel = document.createElement('div');
    noteLabel.className = 'ncFieldLabel';
    noteLabel.textContent = 'Note (yours, never downloaded)';
    const noteInput = document.createElement('textarea');
    noteInput.className = 'ncTextarea';
    noteInput.rows = 3;
    noteInput.value = list.note || '';
    noteInput.placeholder = 'e.g. load after the core framework list';

    const optRow = document.createElement('label');
    optRow.className = 'ncCheckRow';
    const optBox = document.createElement('input');
    optBox.type = 'checkbox';
    optBox.checked = !!list.includeOptional;
    const optText = document.createElement('span');
    optText.textContent = 'Also download this list’s optional files';
    optRow.append(optBox, optText);

    const optHint = document.createElement('div');
    optHint.className = 'ncHint';
    optHint.textContent = 'Off by default: optional files are often mutually-exclusive ' +
      'variants, so taking all of them gives you patches you may not want.';

    const roll = listDownloadRollup(domain, list);
    const stat = document.createElement('div');
    stat.className = 'ncHint';
    stat.textContent = `${list.modIds.length} mod(s) · ` +
      (roll.pending ? `${roll.pending} file(s) to download` : 'nothing outstanding') +
      (roll.unread ? ` · ${roll.unread} never read` : '');

    wrap.append(nameLabel, nameInput, noteLabel, noteInput, optRow, optHint, stat);

    openModal({
      title: 'List settings',
      bodyNode: wrap,
      actions: [
        { label: 'Save', primary: true, onClick: (m) => {
          const newName = nameInput.value.trim();
          if (newName && newName !== list.name) renameList(domain, listId, newName);
          list.note = noteInput.value;
          const wasOptional = !!list.includeOptional;
          list.includeOptional = optBox.checked;
          touchGame(domain);
          flushGames();
          if (wasOptional !== list.includeOptional) {
            logLine(`${list.name}: optional files ${list.includeOptional ? 'included' : 'excluded'}`);
          }
          m.close();
          renderLibrary();
        } },
        { label: 'Delete list', onClick: async (m) => {
          const n = list.modIds.length;
          const okDelete = await confirmModal('Delete list',
            n ? `Delete "${list.name}"? Its ${n} mod${n === 1 ? '' : 's'} stay in the library, and in any other list they belong to.`
              : `Delete "${list.name}"? It's empty, so nothing else changes.`,
            'Delete');
          if (!okDelete) return;
          deleteList(domain, listId);
          if (libState.listId === listId) libState.listId = null;
          flushGames();
          logLine(`deleted list "${list.name}"`);
          m.close();
          renderLibrary();
        } },
        { label: 'Cancel', onClick: (m) => m.close() }
      ]
    });
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
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
  // DEBUG PANEL
  // ==========================================================================

  /*
    Flip to false to remove the Debug button entirely. Nothing else needs changing —
    the panel and its fixtures cost nothing when it is never opened.

    Its whole reason to exist: most surfaces here are reachable only by doing the thing
    that opens them, and some (the five dependency-intake shapes, a queue mid-failure)
    need a library in a specific state. Checking a layout tweak should not require
    manufacturing that state by hand every time.
  */
  const DEBUG_TOOLS = true;

  // Fixtures for the intake shapes. These are read-only previews: the intake modal only
  // writes when a row's add button is pressed, so opening one changes nothing.
  function debugIntakeRecords(domain) {
    const doc = getGame(domain);
    const inLists = [];
    for (const list of doc.lists) for (const id of list.modIds) if (!inLists.includes(id)) inLists.push(id);
    const held = inLists.slice(0, 2).map(id => ({
      modId: id,
      name: (doc.mods[id] && doc.mods[id].name) || ('Mod ' + id),
      url: `https://www.nexusmods.com/${domain}/mods/${id}`,
      note: '', noteTag: null, kind: 'mod', hard: true, sources: ['debug'], requiredFiles: []
    }));
    const missing = (n, note) => ({
      modId: 'debug' + n,
      name: 'Missing Example ' + n,
      url: `https://www.nexusmods.com/${domain}/mods/99900${n}`,
      note: note || '', noteTag: note ? note.split(' ')[0].toUpperCase() : null,
      kind: 'mod', hard: !note, sources: ['debug'], requiredFiles: []
    });
    const base = { offsiteDeps: [], dlcDeps: [] };
    return [
      ['none — no requirements', Object.assign({ name: 'Debug: No Deps', deps: [] }, base)],
      ['allHere — all in this list', Object.assign({ name: 'Debug: All Held', deps: held.slice(0, 1) }, base)],
      ['allSatisfied — some elsewhere', Object.assign({ name: 'Debug: All Satisfied', deps: held }, base)],
      ['missing — mixed', Object.assign({
        name: 'Debug: Mixed',
        deps: held.slice(0, 1).concat([
          missing(1, 'OPTIONAL - only if you want the extra shop'),
          missing(2, ''),
          missing(3, 'HARD REQUIREMENT')
        ])
      }, base)],
      ['missing — none held', Object.assign({
        name: 'Debug: All Missing', deps: [missing(4, 'REQUIRED'), missing(5, '')]
      }, base)],
      ['infoOnly — off-site + DLC', {
        name: 'Debug: External Only', deps: [],
        offsiteDeps: [{ name: 'ENB Series', url: 'https://enbdev.com', kind: 'offsite' }],
        dlcDeps: [{ name: 'Some Game DLC', kind: 'dlc' }]
      }]
    ];
  }

  function debugFakeQueue(domain, listId, withFailures) {
    const doc = getGame(domain);
    const list = getList(domain, listId);
    const mk = (n, status, error) => ({
      id: newId('dbg'), kind: 'file', domain, listId,
      listName: list ? list.name : 'List', modId: 'x' + n, modName: 'Debug Mod ' + n,
      fileId: 'f' + n, fileName: `debug-mod-${n}.zip`, leaf: `debug-mod-${n}.zip`,
      dirPath: 'Nexus Mods/Debug', path: `Nexus Mods/Debug/debug-mod-${n}.zip`,
      sizeKb: 2048, status, attempts: status === 'failed' ? 3 : 0, error: error || null
    });
    // In memory only — deliberately not saved, so a reload clears it.
    queue.items = [
      mk(1, 'done'), mk(2, 'done'),
      mk(3, 'pending'), mk(4, 'pending'), mk(5, 'pending')
    ];
    if (withFailures) {
      queue.items.push(mk(6, 'failed',
        'Tampermonkey refused ".7z" — open its Settings → Downloads → "Whitelisted File Extensions" and add it (or use *.*).'));
      queue.items.push(mk(7, 'failed', 'no download link returned — is your Nexus session still signed in?'));
    }
    queue.paused = true;
    queue.progress = 0.42;
    setQueueStatus('Debug Mod 3 — waiting 4s');
    renderQueue();
  }

  function openDebugMenu() {
    const idx = readIndex();
    const domains = Object.keys(idx.games);
    const domain = (ui.context && ui.context.gameDomain && idx.games[ui.context.gameDomain])
      ? ui.context.gameDomain
      : domains[0] || null;
    const doc = domain ? getGame(domain) : null;
    const listId = doc && doc.lists.length ? doc.lists[0].id : null;

    const wrap = document.createElement('div');
    wrap.className = 'ncForm';

    const status = document.createElement('div');
    status.className = 'ncInfoBox';
    status.textContent =
      `games ${domains.length} · ` +
      (doc ? `context ${doc.name} · lists ${doc.lists.length} · mods ${Object.keys(doc.mods).length} · ` : '') +
      `queue ${queue.items.length} · gate ${Math.round(gateMs() / 1000)}s · ` +
      `tier ${ui.context && ui.context.kind === 'mod' ? 'page-known' : 'unknown'}`;
    wrap.appendChild(status);

    const section = (label) => {
      const h = document.createElement('div');
      h.className = 'ncHarvestHead';
      h.textContent = label;
      wrap.appendChild(h);
      const row = document.createElement('div');
      row.className = 'ncAuditFilters';
      wrap.appendChild(row);
      return row;
    };
    const button = (row, label, fn, disabledWhy) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ncChipBtn';
      b.textContent = label;
      if (disabledWhy) { b.disabled = true; b.title = disabledWhy; }
      else b.addEventListener('click', fn);
      row.appendChild(b);
      return b;
    };

    const needList = listId ? null : 'needs a game with at least one list';

    const surfaces = section('Surfaces');
    button(surfaces, 'Library', () => openLibrary());
    button(surfaces, 'Audit', () => openAudit(domain), domain ? null : 'needs a game');
    button(surfaces, 'Find mods on this page', () => openHarvest());
    button(surfaces, 'List settings', () => openListSettings(domain, listId), needList);
    button(surfaces, 'Pick a list', () => pickListModal(domain, { title: 'Debug: pick a list' }),
      domain ? null : 'needs a game');
    button(surfaces, 'Text prompt', () => textPromptModal({
      title: 'Debug: text prompt', label: 'A field', placeholder: 'type here', confirmLabel: 'OK'
    }));
    button(surfaces, 'Confirm dialog', () => confirmModal('Debug: confirm',
      'This is what a confirmation looks like, including a second line of explanation that runs on a bit.',
      'Do it'));

    const intake = section('Dependency intake — every shape');
    if (listId) {
      for (const [label, record] of debugIntakeRecords(domain)) {
        button(intake, label, () => showDependencyIntake(domain, listId, record));
      }
    } else {
      button(intake, 'unavailable', null, needList);
    }

    const queueRow = section('Queue states (in memory — a reload clears them)');
    button(queueRow, 'Running, no failures', () => debugFakeQueue(domain, listId, false), needList);
    button(queueRow, 'With failures', () => debugFakeQueue(domain, listId, true), needList);
    button(queueRow, 'Clear queue', () => { queue.items = []; queue.progress = 0; setQueueStatus(''); renderQueue(); });

    const note = document.createElement('div');
    note.className = 'ncHint';
    note.textContent = 'Intake previews use synthetic records against your first real list; ' +
      'they only write if you press an add button. Queue previews are never saved.';
    wrap.appendChild(note);

    openModal({
      title: 'Debug',
      bodyNode: wrap,
      wide: true,
      actions: [{ label: 'Close', onClick: (m) => m.close() }]
    });
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
    _blockedKeys: blockedKeys,
    // Tests only: the in-memory doc cache is correct for a real page (one load, one
    // library) but hides a re-seeded backing store between cases.
    _resetCache: () => { gameCache.clear(); dirtyGames.clear(); if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } }
  };

  window.__ncDev = {
    bucketDependencies, intakeShape, showDependencyIntake, addDepAsStub,
    openLibrary, pickListModal, resolveModRecord,
    queue, runQueue, startListDownload, checkListUpdates, resolveFileUrl,
    buildDepGraph, detectCycles, installOrder, crossListMatrix, layerGraph, openAudit
  };

  window.__ncPaths = {
    sanitizeSegment, fileLeafName, constructedLeafName, ensureArchiveExtension,
    fileDir, filePath, infoPath, buildInfoText, fileNeedsDownload,
    downloadableFiles, listDownloadRollup,
    parseContentDispositionFilename, explainDownloadError,
    fmtBytes, fmtDate, fmtDuration
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
