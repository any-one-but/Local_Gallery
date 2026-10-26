// The right-click (Control-click) menu for text: spelling suggestions, Learn
// Spelling, Undo / Redo, Cut / Copy / Paste and Select All in a text field,
// Copy for selected text, and Copy Link / Open Link for a link. Electron shows
// no menu of its own, so without this a right-click did nothing -- in the
// gallery page's text fields, in Variations and in Grok and Claude.
//
// It is only ever offered over text or a link. The gallery page suppresses
// right-click everywhere else (its `contextmenu` handlers preventDefault, which
// stops Chromium asking for a menu at all), and a right-click on anything
// else in an embedded site simply shows nothing.

"use strict";

const { Menu, clipboard, shell } = require("electron");

const MAX_SUGGESTIONS = 6;

function textMenuTemplate(wc, params) {
  const items = [];
  const flags = params.editFlags || {};
  const selected = String(params.selectionText || "").trim();

  if (params.isEditable && params.misspelledWord) {
    const suggestions = (params.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS);
    for (const word of suggestions) {
      items.push({ label: word, click: () => wc.replaceMisspelling(word) });
    }
    if (!suggestions.length) items.push({ label: "No Guesses Found", enabled: false });
    items.push(
      { type: "separator" },
      {
        label: "Learn Spelling",
        click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      },
      { type: "separator" },
    );
  }

  const link = /^https?:/i.test(String(params.linkURL || "")) ? params.linkURL : "";
  if (link) {
    items.push(
      { label: "Open Link in Browser", click: () => shell.openExternal(link) },
      { label: "Copy Link", click: () => clipboard.writeText(link) },
      { type: "separator" },
    );
  }

  if (params.isEditable) {
    items.push(
      { label: "Undo", enabled: !!flags.canUndo, click: () => wc.undo() },
      { label: "Redo", enabled: !!flags.canRedo, click: () => wc.redo() },
      { type: "separator" },
      { label: "Cut", enabled: !!flags.canCut, click: () => wc.cut() },
      { label: "Copy", enabled: !!flags.canCopy, click: () => wc.copy() },
      { label: "Paste", enabled: !!flags.canPaste, click: () => wc.paste() },
      { type: "separator" },
      { label: "Select All", enabled: flags.canSelectAll !== false, click: () => wc.selectAll() },
    );
  } else if (selected) {
    items.push({ label: "Copy", click: () => wc.copy() });
  }

  while (items.length && items[items.length - 1].type === "separator") items.pop();
  return items;
}

// `getWindow` answers the window to show the menu in (an embedded view has
// none of its own).
function attachTextContextMenu(wc, getWindow) {
  wc.on("context-menu", (_event, params) => {
    const template = textMenuTemplate(wc, params);
    if (!template.length) return;
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
}

module.exports = { attachTextContextMenu, textMenuTemplate };
