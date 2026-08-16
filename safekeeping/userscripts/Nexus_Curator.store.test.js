/*
  Node harness for the Nexus Curator store layer.

  Trick: set document.readyState = 'loading' so the script registers init() on
  DOMContentLoaded and never actually runs it. That means no DOM is needed — the store
  functions are reachable via window.__ncStore with nothing rendered.
*/

const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(
  '/Users/jo/Programs/Local_Gallery/safekeeping/userscripts/Nexus_Curator.user.js',
  'utf8'
);

let store = {};                       // the fake GM storage
const styleCalls = [];
const downloads = [];

const windowObj = {
  __ncLoaded: false,
  addEventListener() {},
};
windowObj.top = windowObj;
windowObj.self = windowObj;

const sandbox = {
  window: windowObj,
  document: {
    readyState: 'loading',           // <- keeps init() from firing
    addEventListener() {},
  },
  GM_getValue: (k, d) => (k in store ? store[k] : d),
  GM_setValue: (k, v) => { store[k] = v; },
  GM_addStyle: (css) => styleCalls.push(css.length),
  GM_download: (opts) => downloads.push(opts.name),
  Blob: class { constructor(parts) { this.parts = parts; } },
  URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
  setTimeout, clearTimeout, console,
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const S = windowObj.__ncStore;
const assert = require('assert');
let pass = 0;
const ok = (label, fn) => {
  try { fn(); pass++; console.log('  ok   ' + label); }
  catch (e) { console.log('  FAIL ' + label + '\n       ' + e.message); process.exitCode = 1; }
};

console.log('\n--- store layer ---');

ok('starts empty', () => {
  assert.deepStrictEqual(Object.keys(S.readIndex().games), []);
});

ok('ensureGame registers a game', () => {
  S.ensureGame({ gameDomain: 'skyrimspecialedition', gameName: 'Skyrim SE', gameId: '1704' });
  S.flushGames();
  const idx = S.readIndex();
  assert.strictEqual(idx.games.skyrimspecialedition.gameId, '1704');
  assert.strictEqual(idx.games.skyrimspecialedition.name, 'Skyrim SE');
});

let listA, listB;
ok('createList + addModToList', () => {
  listA = S.createList('skyrimspecialedition', 'Core Utilities');
  listB = S.createList('skyrimspecialedition', 'Visuals');
  S.upsertMod('skyrimspecialedition', { modId: '30379', name: 'SKSE64', state: 'resolved' });
  S.upsertMod('skyrimspecialedition', { modId: '12604', name: 'SkyUI', state: 'resolved' });
  assert.strictEqual(S.addModToList('skyrimspecialedition', listA.id, '30379'), true);
  assert.strictEqual(S.addModToList('skyrimspecialedition', listA.id, '12604'), true);
  S.flushGames();
  assert.strictEqual(S.getList('skyrimspecialedition', listA.id).modIds.length, 2);
});

ok('adding the same mod twice is a no-op', () => {
  assert.strictEqual(S.addModToList('skyrimspecialedition', listA.id, '30379'), false);
  assert.strictEqual(S.getList('skyrimspecialedition', listA.id).modIds.length, 2);
});

ok('a mod can live in two lists at once', () => {
  S.addModToList('skyrimspecialedition', listB.id, '30379');
  const lists = S.listsContainingMod('skyrimspecialedition', '30379');
  assert.strictEqual(lists.length, 2);
  // join() rather than deepStrictEqual: arrays built inside the vm realm have a
  // different Array prototype and never compare reference-equal.
  assert.strictEqual(lists.map(l => l.name).sort().join('|'), 'Core Utilities|Visuals');
});

ok('gameStats counts distinct mods in lists', () => {
  const st = S.gameStats('skyrimspecialedition');
  assert.strictEqual(st.lists, 2);
  assert.strictEqual(st.mods, 2);
  assert.strictEqual(st.inLists, 2);   // 30379 counted once despite two lists
});

ok('upsertMod preserves download history on re-parse', () => {
  const doc = S.getGame('skyrimspecialedition');
  doc.mods['30379'].download = { files: { '111': { version: '2.2.6', at: 123 } } };
  S.upsertMod('skyrimspecialedition', { modId: '30379', name: 'SKSE64', version: '2.2.7' });
  const after = S.getGame('skyrimspecialedition').mods['30379'];
  assert.strictEqual(after.version, '2.2.7', 'new field applied');
  assert.strictEqual(after.download.files['111'].version, '2.2.6', 'history kept');
});

ok('deleteList removes only that list', () => {
  const tmp = S.createList('skyrimspecialedition', 'Scratch');
  assert.strictEqual(S.deleteList('skyrimspecialedition', tmp.id), true);
  assert.strictEqual(S.getList('skyrimspecialedition', tmp.id), null);
  assert.strictEqual(S.getGame('skyrimspecialedition').lists.length, 2);
});

console.log('\n--- persistence ---');

let exported;
ok('data survives a reload from storage', () => {
  S.flushGames();
  exported = JSON.parse(JSON.stringify(S.exportPayload(null)));
  // simulate a fresh page: rerun the script against the same backing store
  const w2 = { __ncLoaded: false, addEventListener() {} };
  w2.top = w2; w2.self = w2;
  const s2 = Object.assign({}, sandbox, { window: w2 });
  s2.globalThis = s2;
  vm.createContext(s2);
  vm.runInContext(src, s2);
  const st = w2.__ncStore.gameStats('skyrimspecialedition');
  assert.strictEqual(st.lists, 2);
  assert.strictEqual(st.mods, 2);
});

console.log('\n--- import merge ---');

ok('import into an empty library restores everything', () => {
  store = {};                                   // wipe
  const w3 = { __ncLoaded: false, addEventListener() {} };
  w3.top = w3; w3.self = w3;
  const s3 = Object.assign({}, sandbox, { window: w3 });
  s3.globalThis = s3;
  vm.createContext(s3);
  vm.runInContext(src, s3);
  const S3 = w3.__ncStore;
  const summary = S3.mergeImport(exported);
  assert.strictEqual(summary.games, 1);
  assert.strictEqual(summary.lists, 2);
  assert.strictEqual(summary.mods, 2);
  assert.strictEqual(S3.gameStats('skyrimspecialedition').lists, 2);
});

ok('re-importing the same file adds nothing (idempotent)', () => {
  const w4 = { __ncLoaded: false, addEventListener() {} };
  w4.top = w4; w4.self = w4;
  const s4 = Object.assign({}, sandbox, { window: w4 });
  s4.globalThis = s4;
  vm.createContext(s4);
  vm.runInContext(src, s4);
  const S4 = w4.__ncStore;
  const summary = S4.mergeImport(exported);
  assert.strictEqual(summary.lists, 0, 'no duplicate lists');
  assert.strictEqual(summary.mods, 0, 'no duplicate mods');
  assert.strictEqual(S4.gameStats('skyrimspecialedition').lists, 2);
});

ok('import keeps LOCAL download history, not the file\'s', () => {
  const w5 = { __ncLoaded: false, addEventListener() {} };
  w5.top = w5; w5.self = w5;
  const s5 = Object.assign({}, sandbox, { window: w5 });
  s5.globalThis = s5;
  vm.createContext(s5);
  vm.runInContext(src, s5);
  const S5 = w5.__ncStore;
  const doc = S5.getGame('skyrimspecialedition');
  doc.mods['12604'].download = { files: { local: { version: 'LOCAL', at: 1 } } };
  S5.flushGames();

  const incoming = JSON.parse(JSON.stringify(exported));
  incoming.games.skyrimspecialedition.mods['12604'].download =
    { files: { remote: { version: 'REMOTE', at: 2 } } };
  S5.mergeImport(incoming);

  const after = S5.getGame('skyrimspecialedition').mods['12604'].download.files;
  assert.ok(after.local, 'local history survived');
  assert.ok(!after.remote, 'file history did not overwrite local');
});

ok('import unions list membership without duplicating', () => {
  const w6 = { __ncLoaded: false, addEventListener() {} };
  w6.top = w6; w6.self = w6;
  const s6 = Object.assign({}, sandbox, { window: w6 });
  s6.globalThis = s6;
  vm.createContext(s6);
  vm.runInContext(src, s6);
  const S6 = w6.__ncStore;
  const incoming = JSON.parse(JSON.stringify(exported));
  const l = incoming.games.skyrimspecialedition.lists[0];
  l.modIds.push('99999');                        // a mod the local copy lacks
  S6.mergeImport(incoming);
  const local = S6.getGame('skyrimspecialedition').lists.find(x => x.id === l.id);
  assert.ok(local.modIds.includes('99999'), 'new member added');
  assert.strictEqual(new Set(local.modIds).size, local.modIds.length, 'no duplicates');
});

ok('rejects a file that is not an export', () => {
  assert.throws(() => S.mergeImport({ hello: 'world' }), /not a Nexus Curator export/);
});

console.log('\n--- corruption safety ---');

ok('a corrupt game doc is NOT overwritten by an empty one', () => {
  store = { 'nc:index': JSON.stringify({ schema: 1, games: { g: { domain: 'g' } } }),
            'nc:game:g': '{ this is not json' };
  const w7 = { __ncLoaded: false, addEventListener() {} };
  w7.top = w7; w7.self = w7;
  const s7 = Object.assign({}, sandbox, { window: w7 });
  s7.globalThis = s7;
  vm.createContext(s7);
  vm.runInContext(src, s7);
  const S7 = w7.__ncStore;
  S7.getGame('g');                               // triggers the failed parse
  assert.ok(S7._blockedKeys.has('nc:game:g'), 'key is write-locked');
  S7.createList('g', 'should not persist');
  S7.flushGames();
  assert.strictEqual(store['nc:game:g'], '{ this is not json', 'corrupt data left intact');
});

console.log(`\n${pass} checks passed\n`);
