// The right-click (Control-click) menu, rebuilt the way macOS lays out its own
// text menu, because Electron shows no menu at all over a web page. It is
// attached to the gallery page and to Grok's and Claude's views
// (attachTextContextMenu).
//
// Over a misspelled word: suggestions, Learn Spelling. Over selected text or
// in a field: Look Up, Translate, Search with Google, Cut / Copy / Paste /
// Paste and Match Style / Delete / Select All, Undo / Redo, Share,
// Spelling and Grammar, Transformations, Speech, Emoji & Symbols, and
// Services (macOS's own, acting on the selection). Over a link: open, copy,
// share. Over a picture in Grok or Claude: open, save, copy, copy address.
// Elsewhere in Grok or Claude: Back, Forward, Reload. In the gallery page
// nothing else is offered, and the page's own suppressors preventDefault
// everywhere but text fields, which stops Chromium asking for a menu at all.
//
// What Electron cannot reach is left out rather than faked: Apple's Writing
// Tools, AutoFill, Substitutions (Chromium does no smart quotes or dashes)
// and the grammar half of Spelling and Grammar.

"use strict";

const { app, Menu, clipboard, shell } = require("electron");

const MAX_SUGGESTIONS = 6;
const QUOTE_MAX = 24;

function quoted(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return `“${t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX - 1)}…` : t}”`;
}

function capitalizeWords(text) {
  return String(text).toLowerCase().replace(/(^|[\s\-("“'‘])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
}

function separatorTidy(items) {
  const out = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === "separator" && (!out.length || out[out.length - 1].type === "separator")) continue;
    out.push(item);
  }
  while (out.length && out[out.length - 1].type === "separator") out.pop();
  return out;
}

function textMenuTemplate(wc, params, options = {}) {
  const flags = params.editFlags || {};
  const selected = String(params.selectionText || "");
  const hasSelection = !!selected.trim();
  const editable = !!params.isEditable;
  const link = /^https?:/i.test(String(params.linkURL || "")) ? params.linkURL : "";
  const image = params.mediaType === "image" && /^(https?|data|blob):/i.test(String(params.srcURL || ""))
    ? params.srcURL
    : "";
  const items = [];

  // Spelling first, as macOS does.
  if (editable && params.misspelledWord) {
    const suggestions = (params.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS);
    for (const word of suggestions) items.push({ label: word, click: () => wc.replaceMisspelling(word) });
    if (!suggestions.length) items.push({ label: "No Guesses Found", enabled: false });
    items.push(
      { type: "separator" },
      { label: "Learn Spelling", click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
      { type: "separator" },
    );
  }

  if (link) {
    items.push(
      { label: "Open Link in Browser", click: () => shell.openExternal(link) },
      { label: "Copy Link", click: () => clipboard.writeText(link) },
      { label: "Share Link", role: "shareMenu", sharingItem: { urls: [link] } },
      { type: "separator" },
    );
  }

  if (image && options.embedded) {
    items.push(
      { label: "Open Image in Browser", enabled: /^https?:/i.test(image), click: () => shell.openExternal(image) },
      { label: "Save Image As…", click: () => wc.downloadURL(image) },
      { label: "Copy Image", click: () => wc.copyImageAt(params.x, params.y) },
      { label: "Copy Image Address", enabled: /^https?:/i.test(image), click: () => clipboard.writeText(image) },
      { type: "separator" },
    );
  }

  if (hasSelection) {
    const q = encodeURIComponent(selected.trim());
    items.push(
      { label: `Look Up ${quoted(selected)}`, click: () => wc.showDefinitionForSelection() },
      { label: `Translate ${quoted(selected)}`, click: () => shell.openExternal(`https://translate.google.com/?sl=auto&op=translate&text=${q}`) },
      { label: "Search with Google", click: () => shell.openExternal(`https://www.google.com/search?q=${q}`) },
      { type: "separator" },
    );
  }

  if (editable) {
    items.push(
      { label: "Cut", enabled: !!flags.canCut, click: () => wc.cut() },
      { label: "Copy", enabled: !!flags.canCopy, click: () => wc.copy() },
      { label: "Paste", enabled: !!flags.canPaste, click: () => wc.paste() },
      { label: "Paste and Match Style", enabled: !!flags.canPaste, click: () => wc.pasteAndMatchStyle() },
      { label: "Delete", enabled: !!flags.canDelete, click: () => wc.delete() },
      { label: "Select All", enabled: flags.canSelectAll !== false, click: () => wc.selectAll() },
      { type: "separator" },
      { label: "Undo", enabled: !!flags.canUndo, click: () => wc.undo() },
      { label: "Redo", enabled: !!flags.canRedo, click: () => wc.redo() },
      { type: "separator" },
    );
  } else if (hasSelection) {
    items.push(
      { label: "Copy", click: () => wc.copy() },
      { label: "Select All", click: () => wc.selectAll() },
      { type: "separator" },
    );
  }

  if (hasSelection) {
    items.push({ label: "Share", role: "shareMenu", sharingItem: { texts: [selected] } }, { type: "separator" });
  }

  if (editable) {
    const ses = wc.session;
    items.push({
      label: "Spelling and Grammar",
      submenu: [
        {
          label: "Check Spelling While Typing",
          type: "checkbox",
          checked: !!ses.spellCheckerEnabled,
          click: () => {
            ses.spellCheckerEnabled = !ses.spellCheckerEnabled;
          },
        },
      ],
    });
    // Transformations replace the selection with the changed text, so they
    // go through the field's own undo.
    const transform = (fn) => () => wc.insertText(fn(selected));
    items.push({
      label: "Transformations",
      enabled: hasSelection,
      submenu: [
        { label: "Make Upper Case", click: transform((t) => t.toUpperCase()) },
        { label: "Make Lower Case", click: transform((t) => t.toLowerCase()) },
        { label: "Capitalize", click: transform(capitalizeWords) },
      ],
    });
  }

  if (hasSelection || editable) {
    items.push(
      {
        label: "Speech",
        submenu: [
          { label: "Start Speaking", role: "startSpeaking" },
          { label: "Stop Speaking", role: "stopSpeaking" },
        ],
      },
      { type: "separator" },
    );
  }

  if (editable) {
    items.push({ label: "Emoji & Symbols", click: () => app.showEmojiPanel() }, { type: "separator" });
  }

  if (hasSelection) {
    items.push({ label: "Services", role: "services" });
  }

  // A plain spot of a site: the page menu Safari and Chrome give.
  if (options.embedded && !items.length) {
    const history = wc.navigationHistory;
    items.push(
      { label: "Back", enabled: !!(history && history.canGoBack()), click: () => history.goBack() },
      { label: "Forward", enabled: !!(history && history.canGoForward()), click: () => history.goForward() },
      { label: "Reload", click: () => wc.reload() },
    );
  }

  return separatorTidy(items);
}

// `getWindow` answers the window to show the menu in (an embedded view has
// none of its own). `options.embedded`: a site's view (Grok, Claude), which
// also gets the picture and page items.
function attachTextContextMenu(wc, getWindow, options = {}) {
  wc.on("context-menu", (_event, params) => {
    const template = textMenuTemplate(wc, params, options);
    if (!template.length) return;
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
}

module.exports = { attachTextContextMenu, textMenuTemplate };
