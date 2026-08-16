/*
  Path building, filename derivation, and Info-file generation.

  These are the parts where a bug is silent: a mangled path still "succeeds", it just
  puts the file somewhere useless. Same vm-sandbox trick as the store tests.
*/

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/Nexus_Curator.user.js', 'utf8');
const store = {};
const windowObj = { __ncLoaded: false, addEventListener() {} };
windowObj.top = windowObj; windowObj.self = windowObj;

const sandbox = {
  window: windowObj,
  document: { readyState: 'loading', addEventListener() {}, querySelector: () => null },
  GM_getValue: (k, d) => (k in store ? store[k] : d),
  GM_setValue: (k, v) => { store[k] = v; },
  GM_addStyle() {}, GM_download() {},
  Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  setTimeout, clearTimeout, console, fetch: () => Promise.reject(new Error('no net')),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const P = windowObj.__ncPaths;
let pass = 0;
const ok = (label, fn) => {
  try { fn(); pass++; console.log('  ok   ' + label); }
  catch (e) { console.log('  FAIL ' + label + '\n       ' + e.message); process.exitCode = 1; }
};

const game = { domain: 'skyrimspecialedition', name: 'Skyrim Special Edition', gameId: '1704' };
const list = { id: 'l1', name: 'Core Utilities' };
const mod = {
  modId: '12604', name: 'SkyUI', version: '6.9', author: 'SkyUI Team',
  url: 'https://www.nexusmods.com/skyrimspecialedition/mods/12604',
  summary: 'Elegant, PC-friendly interface mod.',
  description: 'The full description.\n\nWith a blank line.',
  deps: [{ name: 'SKSE64', url: 'https://www.nexusmods.com/skyrimspecialedition/mods/30379',
           note: 'HARD REQUIREMENT - needed', hard: true }],
  offsiteDeps: [{ name: 'ENB Series', url: 'https://enbdev.com' }],
  dlcDeps: [{ name: 'Dawnguard' }],
  files: { main: [
    { fileId: '749043', name: 'SkyUI', filename: 'SkyUI-12604-6-11-1778020881.zip',
      version: '6.11', sizeKb: 2630, uploadedAt: 1778020881000, description: 'SkyUI 6 Update' },
    { fileId: '749044', name: 'No Filename Here', filename: null,
      version: '1.0', sizeKb: 12, uploadedAt: 1778020881000, description: '' }
  ], optional: [], old: [] },
  download: { files: {} }
};

console.log('\n--- sanitising ---');

ok('strips path separators and illegal chars', () => {
  assert.strictEqual(P.sanitizeSegment('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
});

ok('keeps spaces, dots and hyphens inside a name', () => {
  assert.strictEqual(P.sanitizeSegment('SkyUI 5.2 SE - Patch'), 'SkyUI 5.2 SE - Patch');
});

ok('strips leading dots (hidden files) and trailing dots (illegal on Windows)', () => {
  assert.strictEqual(P.sanitizeSegment('...hidden'), 'hidden');
  assert.strictEqual(P.sanitizeSegment('trailing...'), 'trailing');
});

ok('strips control characters', () => {
  assert.strictEqual(P.sanitizeSegment('a\u0001b\u007fc'), 'abc');
});

ok('collapses whitespace runs', () => {
  assert.strictEqual(P.sanitizeSegment('a   \t  b'), 'a b');
});

ok('a name that sanitises to nothing yields empty (caller substitutes)', () => {
  assert.strictEqual(P.sanitizeSegment('///'), '');
  assert.strictEqual(P.sanitizeSegment('...'), '');
});

ok('caps length and does not leave a trailing dot after the cut', () => {
  const long = 'x'.repeat(50) + '.' + 'y'.repeat(50);
  const out = P.sanitizeSegment(long, 51);
  assert.ok(out.length <= 51);
  assert.ok(!out.endsWith('.'), 'no trailing dot after truncation');
});

console.log('\n--- paths ---');

ok('file path is Root/Game/List/Mod/File', () => {
  assert.strictEqual(
    P.filePath(game, list, mod, mod.files.main[0]),
    'Nexus Mods/Skyrim Special Edition/Core Utilities/SkyUI/SkyUI-12604-6-11-1778020881.zip'
  );
});

ok('info path nests under Info/', () => {
  assert.strictEqual(
    P.infoPath(game, list, mod),
    'Nexus Mods/Skyrim Special Edition/Core Utilities/SkyUI/Info/SkyUI.txt'
  );
});

ok('uses the real Nexus filename when present', () => {
  assert.strictEqual(P.fileLeafName(mod, mod.files.main[0]), 'SkyUI-12604-6-11-1778020881.zip');
});

ok('constructs a name when the page had none, defaulting to .zip', () => {
  const leaf = P.fileLeafName(mod, mod.files.main[1]);
  assert.strictEqual(leaf, 'No Filename Here-12604-1-0.zip');
});

console.log('\n--- extension safety (the not_whitelisted fix) ---');

ok('keeps a real archive extension untouched', () => {
  for (const n of ['a.zip', 'a.rar', 'a.7z', 'a.tar.gz', 'a.tgz', 'A.ZIP']) {
    assert.strictEqual(P.ensureArchiveExtension(n), n, n);
  }
});

ok('appends .zip when there is no extension at all', () => {
  assert.strictEqual(P.ensureArchiveExtension('ArchiveXL'), 'ArchiveXL.zip');
});

ok('appends .zip to an unrecognised extension rather than trusting it', () => {
  assert.strictEqual(P.ensureArchiveExtension('mod.archive'), 'mod.archive.zip');
  assert.strictEqual(P.ensureArchiveExtension('thing.exe'), 'thing.exe.zip');
});

ok('never returns a bare or dot-trailing name', () => {
  assert.strictEqual(P.ensureArchiveExtension(''), 'download.zip');
  assert.strictEqual(P.ensureArchiveExtension('   '), 'download.zip');
  assert.strictEqual(P.ensureArchiveExtension('name...'), 'name.zip');
});

console.log('\n--- Content-Disposition parsing ---');

ok('reads a plain quoted filename', () => {
  assert.strictEqual(
    P.parseContentDispositionFilename('attachment; filename="ArchiveXL-4198-1-27-1.zip"'),
    'ArchiveXL-4198-1-27-1.zip');
});

ok('reads an unquoted filename', () => {
  assert.strictEqual(
    P.parseContentDispositionFilename('attachment; filename=TweakXL-4197.zip'),
    'TweakXL-4197.zip');
});

ok('prefers RFC 5987 filename* and decodes it', () => {
  assert.strictEqual(
    P.parseContentDispositionFilename(
      "attachment; filename=\"fallback.zip\"; filename*=UTF-8''Mod%20With%20Spaces.7z"),
    'Mod With Spaces.7z');
});

ok('returns null when there is no filename to find', () => {
  assert.strictEqual(P.parseContentDispositionFilename('attachment'), null);
  assert.strictEqual(P.parseContentDispositionFilename(''), null);
});

console.log('\n--- error explanations ---');

ok('not_whitelisted names the offending extension and the setting to change', () => {
  const msg = P.explainDownloadError('not_whitelisted', 'ArchiveXL-4198.7z');
  assert.ok(msg.includes('.7z'), msg);
  assert.ok(/Whitelisted File Extensions/i.test(msg), msg);
});

ok('an unrecognised error is passed through unchanged', () => {
  assert.strictEqual(P.explainDownloadError('network boom', 'x.zip'), 'network boom');
});

ok('a hostile mod name cannot escape the tree', () => {
  const evil = Object.assign({}, mod, { name: '../../etc/passwd' });
  const path = P.filePath(game, list, evil, mod.files.main[0]);
  assert.ok(!path.includes('..'), 'no traversal: ' + path);
  assert.strictEqual(path.split('/').length, 5, 'still exactly five segments');
});

ok('a hostile list name cannot escape either', () => {
  const evilList = { id: 'l', name: '../../../Desktop' };
  const path = P.filePath(game, evilList, mod, mod.files.main[0]);
  assert.ok(!path.includes('..'), path);
});

ok('empty names fall back rather than producing //', () => {
  const blank = Object.assign({}, mod, { name: '///' });
  const path = P.filePath(game, list, blank, mod.files.main[0]);
  assert.ok(path.includes('/mod-12604/'), path);
  assert.ok(!path.includes('//'), 'no empty segment: ' + path);
});

console.log('\n--- info file ---');

const info = P.buildInfoText(game, list, mod);

ok('names the mod, version, author and location', () => {
  assert.ok(info.startsWith('SkyUI\n'), 'starts with the name');
  assert.ok(info.includes('Version 6.9'), 'header version');
  assert.ok(info.includes('by SkyUI Team'));
  assert.ok(info.includes('List: Core Utilities'));
});

ok('has all three sections', () => {
  assert.ok(info.includes('=== DESCRIPTION ==='));
  assert.ok(info.includes('=== REQUIREMENTS ==='));
  assert.ok(info.includes('=== FILES ==='));
});

ok('requirements carry the author note, the url, off-site and DLC', () => {
  assert.ok(info.includes('SKSE64 — HARD REQUIREMENT - needed'));
  assert.ok(info.includes('https://www.nexusmods.com/skyrimspecialedition/mods/30379'));
  assert.ok(info.includes('Off-site: ENB Series — https://enbdev.com'));
  assert.ok(info.includes('Game DLC: Dawnguard'));
});

ok('one labelled section per file, with the real filename', () => {
  assert.ok(info.includes('--- SkyUI v6.11 (2.6MB, uploaded 2026-05-05) ---'), info.slice(-400));
  assert.ok(info.includes('file: SkyUI-12604-6-11-1778020881.zip'));
  assert.ok(info.includes('SkyUI 6 Update'));
});

ok('an empty file description says so instead of leaving a blank', () => {
  assert.ok(info.includes('(the author wrote no description for this file)'));
});

ok('an absent mod description says so too', () => {
  const bare = Object.assign({}, mod, { description: '' });
  assert.ok(P.buildInfoText(game, list, bare).includes('(the author wrote no description)'));
});

console.log('\n--- update diffing ---');

ok('never downloaded => needs download', () => {
  assert.strictEqual(P.fileNeedsDownload(mod, mod.files.main[0], false), true);
});

ok('same version AND same upload time => up to date', () => {
  const m = JSON.parse(JSON.stringify(mod));
  m.download.files['749043'] = { version: '6.11', uploadedAt: 1778020881000 };
  assert.strictEqual(P.fileNeedsDownload(m, m.files.main[0], false), false);
});

ok('re-upload with the SAME version still counts as changed', () => {
  const m = JSON.parse(JSON.stringify(mod));
  m.download.files['749043'] = { version: '6.11', uploadedAt: 1 };
  assert.strictEqual(P.fileNeedsDownload(m, m.files.main[0], false), true);
});

ok('force overrides an up-to-date record', () => {
  const m = JSON.parse(JSON.stringify(mod));
  m.download.files['749043'] = { version: '6.11', uploadedAt: 1778020881000 };
  assert.strictEqual(P.fileNeedsDownload(m, m.files.main[0], true), true);
});

console.log(`\n${pass} checks passed\n`);
