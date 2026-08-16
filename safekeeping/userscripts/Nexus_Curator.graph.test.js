/*
  Dependency graph: bucketing into nodes/edges, cycle detection, install order, and the
  cross-list matrix.

  The graph feeds three views that must never disagree, and the topological/cycle code is
  the kind that looks right and silently isn't — so it gets tested against hand-built
  libraries with known answers.
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

const D = windowObj.__ncDev;
const S = windowObj.__ncStore;

let pass = 0;
const pending = [];
/*
  An async test returns a promise, and a runner that does not wait for it counts the
  test as passed before its assertions have run — a green that means nothing. Thenables
  are collected and settled before the summary is printed.
*/
const ok = (label, fn) => {
  const fail = (e) => {
    console.log('  FAIL ' + label + '\n       ' + (e && e.message || e));
    process.exitCode = 1;
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      pending.push(out.then(() => { pass++; console.log('  ok   ' + label); }, fail));
      return;
    }
    pass++; console.log('  ok   ' + label);
  } catch (e) { fail(e); }
};

const DOMAIN = 'testgame';

/*
  Build a library from a compact spec:
    lists: { ListName: [modId, ...] }
    mods:  { modId: { name, deps: [[modId, note], ...], offsite: [name], dlc: [name] } }
*/
function seed(spec) {
  for (const k of Object.keys(store)) delete store[k];
  S._resetCache();
  const lists = [];
  const mods = {};
  for (const [modId, m] of Object.entries(spec.mods)) {
    mods[modId] = {
      modId, name: m.name || ('Mod ' + modId), state: 'resolved',
      url: 'https://www.nexusmods.com/' + DOMAIN + '/mods/' + modId,
      files: { main: [], optional: [], old: [] },
      deps: (m.deps || []).map(([id, note]) => ({
        modId: String(id), name: (spec.mods[id] && spec.mods[id].name) || ('Mod ' + id),
        url: 'https://www.nexusmods.com/' + DOMAIN + '/mods/' + id,
        note: note || '', noteTag: note ? String(note).split(' ')[0].toUpperCase() : null,
        kind: 'mod', hard: !note
      })),
      offsiteDeps: (m.offsite || []).map(n => ({ name: n, url: 'https://example.com/' + n, kind: 'offsite' })),
      dlcDeps: (m.dlc || []).map(n => ({ name: n, kind: 'dlc' })),
      download: { files: {} }
    };
  }
  let i = 0;
  for (const [name, modIds] of Object.entries(spec.lists)) {
    lists.push({ id: 'L' + (++i), name, note: '', modIds: modIds.map(String), createdAt: 1, updatedAt: 1 });
  }
  store['nc:game:' + DOMAIN] = JSON.stringify({
    schema: 1, domain: DOMAIN, name: 'Test Game', gameId: '1', lists, mods,
    createdAt: 1, updatedAt: 1
  });
  store['nc:index'] = JSON.stringify({
    schema: 1, updatedAt: 1,
    games: { [DOMAIN]: { domain: DOMAIN, name: 'Test Game', gameId: '1', lists: lists.length, mods: Object.keys(mods).length, updatedAt: 1 } }
  });
}

/*
  Values crossing the vm boundary are arrays from the sandbox realm, whose prototype is
  not the host's Array — deepStrictEqual rejects them as "not reference-equal" even when
  the contents match. Rebuild every compared list as a host array.
*/
const host = (iterable) => Array.from(iterable);
const nameOf = (g, key) => (g.nodes.get(key) || {}).name;
const names = (g, keys) => host(keys).map(k => nameOf(g, k)).sort();

console.log('\n--- graph construction ---');

seed({
  lists: { Core: ['1', '2'], Quests: ['3'] },
  mods: {
    1: { name: 'SKSE' },
    2: { name: 'SkyUI', deps: [['1']] },
    3: { name: 'BigQuest', deps: [['1'], ['2', 'OPTIONAL - for menus'], ['9']] },
    9: { name: 'MissingThing' }
  }
});

ok('nodes cover listed mods plus synthesised missing ones', () => {
  const g = D.buildDepGraph(DOMAIN);
  assert.deepStrictEqual(names(g, [...g.nodes.keys()]),
    ['BigQuest', 'MissingThing', 'SKSE', 'SkyUI']);
});

ok('a mod in a list is "have"; one only referenced is "missing"', () => {
  const g = D.buildDepGraph(DOMAIN);
  assert.strictEqual(g.nodes.get('mod:1').status, 'have');
  assert.strictEqual(g.nodes.get('mod:9').status, 'missing');
});

ok('dependents accumulate across lists', () => {
  const g = D.buildDepGraph(DOMAIN);
  assert.deepStrictEqual(names(g, g.nodes.get('mod:1').dependents), ['BigQuest', 'SkyUI']);
});

ok('an optional note marks the edge soft', () => {
  const g = D.buildDepGraph(DOMAIN);
  const e = g.edges.find(x => x.from === 'mod:3' && x.to === 'mod:2');
  assert.strictEqual(e.soft, true);
  const hard = g.edges.find(x => x.from === 'mod:2' && x.to === 'mod:1');
  assert.strictEqual(hard.soft, false);
});

ok('a mod in no list contributes no edges', () => {
  seed({ lists: { Only: ['1'] }, mods: { 1: { name: 'A' }, 2: { name: 'B', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  assert.strictEqual(g.edges.length, 0, 'B is not in a list so its requirement is not ours yet');
});

ok('off-site and DLC become their own node kinds', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'Preset', offsite: ['ENB'], dlc: ['Dawnguard'] } } });
  const g = D.buildDepGraph(DOMAIN);
  const kinds = host(g.list).filter(n => n.key !== 'mod:1').map(n => n.status).sort();
  assert.deepStrictEqual(kinds, ['dlc', 'offsite']);
});

ok('duplicate declarations of the same requirement make one edge', () => {
  seed({ lists: { L: ['1', '2'] }, mods: { 1: { name: 'Base' }, 2: { name: 'Dep', deps: [['1'], ['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  assert.strictEqual(g.edges.length, 1);
});

ok('a self-requirement is ignored rather than making a loop', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'Weird', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  assert.strictEqual(g.edges.length, 0);
  assert.strictEqual(g.cycles.length, 0);
});

console.log('\n--- cycles ---');

ok('a clean tree has no cycles', () => {
  seed({ lists: { L: ['1', '2', '3'] },
    mods: { 1: { name: 'A' }, 2: { name: 'B', deps: [['1']] }, 3: { name: 'C', deps: [['2']] } } });
  assert.strictEqual(D.buildDepGraph(DOMAIN).cycles.length, 0);
});

ok('a mutual pair is detected', () => {
  seed({ lists: { L: ['1', '2'] },
    mods: { 1: { name: 'A', deps: [['2']] }, 2: { name: 'B', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  assert.strictEqual(g.cycles.length, 1);
  assert.deepStrictEqual(names(g, g.cycles[0].slice(0, -1)), ['A', 'B']);
});

ok('a three-mod loop is detected once, not once per rotation', () => {
  seed({ lists: { L: ['1', '2', '3'] }, mods: {
    1: { name: 'A', deps: [['2']] }, 2: { name: 'B', deps: [['3']] }, 3: { name: 'C', deps: [['1']] } } });
  assert.strictEqual(D.buildDepGraph(DOMAIN).cycles.length, 1);
});

ok('a diamond is not mistaken for a cycle', () => {
  seed({ lists: { L: ['1', '2', '3', '4'] }, mods: {
    1: { name: 'Base' },
    2: { name: 'Left', deps: [['1']] },
    3: { name: 'Right', deps: [['1']] },
    4: { name: 'Top', deps: [['2'], ['3']] } } });
  assert.strictEqual(D.buildDepGraph(DOMAIN).cycles.length, 0);
});

console.log('\n--- install order ---');

ok('requirements come before what needs them', () => {
  seed({ lists: { L: ['1', '2', '3'] }, mods: {
    3: { name: 'C', deps: [['2']] }, 2: { name: 'B', deps: [['1']] }, 1: { name: 'A' } } });
  const g = D.buildDepGraph(DOMAIN);
  const order = host(D.installOrder(g).order).map(k => nameOf(g, k));
  assert.deepStrictEqual(order, ['A', 'B', 'C']);
});

ok('the most depended-upon foundation comes first among equals', () => {
  seed({ lists: { L: ['1', '2', '3', '4'] }, mods: {
    1: { name: 'Popular' }, 2: { name: 'Lonely' },
    3: { name: 'X', deps: [['1']] }, 4: { name: 'Y', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  assert.strictEqual(host(D.installOrder(g).order).map(k => nameOf(g, k))[0], 'Popular');
});

ok('every listed mod appears exactly once even with a cycle present', () => {
  seed({ lists: { L: ['1', '2', '3'] }, mods: {
    1: { name: 'A', deps: [['2']] }, 2: { name: 'B', deps: [['1']] }, 3: { name: 'C' } } });
  const g = D.buildDepGraph(DOMAIN);
  const res = D.installOrder(g); const order = host(res.order), unresolved = host(res.unresolved);
  assert.strictEqual(order.length, new Set(order).size, 'no duplicates');
  assert.deepStrictEqual(names(g, order), ['A', 'B', 'C']);
  assert.deepStrictEqual(names(g, unresolved), ['A', 'B'], 'the loop members are flagged');
});

ok('missing mods are ordered too, so they can be installed in the right place', () => {
  seed({ lists: { L: ['2'] }, mods: { 1: { name: 'Absent' }, 2: { name: 'Needs', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  assert.deepStrictEqual(host(D.installOrder(g).order).map(k => nameOf(g, k)), ['Absent', 'Needs']);
});

console.log('\n--- cross-list matrix ---');

ok('a dependency inside the same list does not cross', () => {
  seed({ lists: { Core: ['1', '2'] }, mods: { 1: { name: 'A' }, 2: { name: 'B', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  const m = D.crossListMatrix(DOMAIN, g);
  assert.strictEqual(m.cells.size, 0);
});

ok('a dependency living only in another list is reported', () => {
  seed({ lists: { Core: ['1'], Quests: ['2'] },
    mods: { 1: { name: 'A' }, 2: { name: 'B', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  const m = D.crossListMatrix(DOMAIN, g);
  const cell = m.cells.get('L2|L1');
  assert.ok(cell && cell.length === 1, 'Quests needs something in Core');
  assert.strictEqual(m.cells.get('L1|L2'), undefined, 'and not the other way round');
});

ok('a list holding its own copy is self-sufficient despite duplicates elsewhere', () => {
  seed({ lists: { Core: ['1'], Quests: ['1', '2'] },
    mods: { 1: { name: 'A' }, 2: { name: 'B', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  assert.strictEqual(D.crossListMatrix(DOMAIN, g).cells.size, 0,
    'Quests has its own copy of A, so it does not depend on Core');
});

ok('a missing requirement creates no cross-list claim', () => {
  seed({ lists: { Core: ['1'], Quests: ['2'] },
    mods: { 1: { name: 'A' }, 2: { name: 'B', deps: [['9']] }, 9: { name: 'Nowhere' } } });
  const g = D.buildDepGraph(DOMAIN);
  assert.strictEqual(D.crossListMatrix(DOMAIN, g).cells.size, 0);
});

console.log('\n--- layout ---');

ok('foundations land on the top row, dependents below', () => {
  seed({ lists: { L: ['1', '2', '3'] }, mods: {
    1: { name: 'A' }, 2: { name: 'B', deps: [['1']] }, 3: { name: 'C', deps: [['2']] } } });
  const g = D.buildDepGraph(DOMAIN);
  const keys = g.list.map(n => n.key);
  const { placed, layers } = D.layerGraph(g, keys);
  assert.strictEqual(layers.length, 3);
  assert.ok(placed.get('mod:1').y < placed.get('mod:2').y);
  assert.ok(placed.get('mod:2').y < placed.get('mod:3').y);
});

ok('layering terminates on a cycle instead of recursing forever', () => {
  seed({ lists: { L: ['1', '2'] },
    mods: { 1: { name: 'A', deps: [['2']] }, 2: { name: 'B', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  const out = D.layerGraph(g, g.list.map(n => n.key));
  assert.ok(out.layers.length >= 1);
  assert.strictEqual(out.placed.size, 2);
});


console.log('\n--- loop labelling ---');

ok('a mod inside a loop is distinguished from one merely blocked by it', () => {
  seed({ lists: { L: ['1', '2', '3'] }, mods: {
    1: { name: 'A', deps: [['2']] },
    2: { name: 'B', deps: [['1']] },
    3: { name: 'Downstream', deps: [['1']] } } });
  const g = D.buildDepGraph(DOMAIN);
  const r = D.installOrder(g);
  assert.deepStrictEqual(names(g, r.cyclic), ['A', 'B'], 'only the real loop members');
  assert.deepStrictEqual(names(g, r.blocked), ['Downstream'], 'downstream is blocked, not cyclic');
});

ok('with no loops nothing is cyclic or blocked', () => {
  seed({ lists: { L: ['1', '2'] }, mods: { 1: { name: 'A' }, 2: { name: 'B', deps: [['1']] } } });
  const r = D.installOrder(D.buildDepGraph(DOMAIN));
  assert.strictEqual(host(r.cyclic).length, 0);
  assert.strictEqual(host(r.blocked).length, 0);
});

console.log('\n--- matrix counts mods, not edges ---');

ok('two dependents needing the same three mods counts three', () => {
  seed({ lists: { Core: ['1', '2', '3'], Play: ['8', '9'] }, mods: {
    1: { name: 'X' }, 2: { name: 'Y' }, 3: { name: 'Z' },
    8: { name: 'P', deps: [['1'], ['2'], ['3']] },
    9: { name: 'Q', deps: [['1'], ['2'], ['3']] } } });
  const g = D.buildDepGraph(DOMAIN);
  const cell = D.crossListMatrix(DOMAIN, g).cells.get('L2|L1');
  assert.strictEqual(new Set(host(cell).map(p => p.toMod)).size, 3, 'three distinct required mods');
  assert.strictEqual(host(cell).length, 6, 'from six dependency edges');
});


console.log('\n--- per-list optional files ---');

const P = windowObj.__ncPaths;

function modWith(main, optional, downloaded) {
  return { modId: '1', name: 'M', state: 'resolved',
    files: { main, optional: optional || [], old: [] },
    download: { files: downloaded || {} } };
}
const f = (id, v) => ({ fileId: id, name: 'f' + id, version: v || '1', uploadedAt: 100 });

ok('a list defaults to main files only', () => {
  const m = modWith([f('a')], [f('b')]);
  const got = host(P.downloadableFiles({ includeOptional: false }, m)).map(x => x.fileId);
  assert.deepStrictEqual(got, ['a']);
});

ok('opting in adds the optional files', () => {
  const m = modWith([f('a')], [f('b')]);
  const got = host(P.downloadableFiles({ includeOptional: true }, m)).map(x => x.fileId);
  assert.deepStrictEqual(got, ['a', 'b']);
});

ok('old files are never downloaded, even with optionals on', () => {
  const m = { files: { main: [f('a')], optional: [f('b')], old: [f('c')] } };
  const got = host(P.downloadableFiles({ includeOptional: true }, m)).map(x => x.fileId);
  assert.ok(!got.includes('c'), got.join(','));
});

ok('a missing list argument falls back to main only', () => {
  const m = modWith([f('a')], [f('b')]);
  assert.deepStrictEqual(host(P.downloadableFiles(null, m)).map(x => x.fileId), ['a']);
});

console.log('\n--- list rollup ---');

ok('rollup counts outstanding files and unread stubs, without network', () => {
  seed({ lists: { L: ['1', '2', '3'] }, mods: {
    1: { name: 'Done' }, 2: { name: 'Pending' }, 3: { name: 'Stub' } } });
  const doc = S.getGame(DOMAIN);
  doc.mods['1'].files.main = [{ fileId: 'x', version: '1', uploadedAt: 5 }];
  doc.mods['1'].download.files = { x: { version: '1', uploadedAt: 5 } };
  doc.mods['2'].files.main = [{ fileId: 'y', version: '2', uploadedAt: 9 }];
  doc.mods['3'].state = 'stub';
  const roll = P.listDownloadRollup(DOMAIN, doc.lists[0]);
  assert.strictEqual(roll.pending, 1, 'only the undownloaded file');
  assert.strictEqual(roll.mods, 1);
  assert.strictEqual(roll.unread, 1, 'the stub is counted separately, not as pending');
});

ok('an out-of-date file counts as pending', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'Stale' } } });
  const doc = S.getGame(DOMAIN);
  doc.mods['1'].files.main = [{ fileId: 'x', version: '2', uploadedAt: 9 }];
  doc.mods['1'].download.files = { x: { version: '1', uploadedAt: 5 } };
  assert.strictEqual(P.listDownloadRollup(DOMAIN, doc.lists[0]).pending, 1);
});

ok('optionals only count when the list wants them', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'Opt' } } });
  const doc = S.getGame(DOMAIN);
  doc.mods['1'].files.main = [];
  doc.mods['1'].files.optional = [{ fileId: 'o', version: '1', uploadedAt: 1 }];
  assert.strictEqual(P.listDownloadRollup(DOMAIN, doc.lists[0]).pending, 0);
  doc.lists[0].includeOptional = true;
  assert.strictEqual(P.listDownloadRollup(DOMAIN, doc.lists[0]).pending, 1);
});


console.log('\n--- cascade brakes ---');

// The cascade's resolve loop needs the network, which the sandbox denies. These test the
// gatekeeping around it: what gets queued, deduped, depth-capped and dropped on stop.
function freshCascade() { D.cascadeReset(); D.cascade.stopped = false; }

ok('adding mods queues them for reading', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'A' } } });
  freshCascade();
  D.cascadeEnqueue(DOMAIN, 'L1', [{ modId: '7', listId: 'L1' }, { modId: '8', listId: 'L1' }], 1, 'A');
  // Assert on `seen` rather than queue length: enqueue starts the resolve loop, which
  // may already have shifted an entry off, so the length is timing-dependent.
  assert.strictEqual(D.cascade.seen.size, 2);
  D.cascadeStop();
});

ok('the same mod is never queued twice in one run', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'A' } } });
  freshCascade();
  D.cascadeEnqueue(DOMAIN, 'L1', [{ modId: '7' }], 1, 'A');
  D.cascadeEnqueue(DOMAIN, 'L1', [{ modId: '7' }, { modId: '9' }], 1, 'B');
  assert.strictEqual(D.cascade.seen.size, 2, 'the repeat of 7 is dropped, 9 is added');
  D.cascadeStop();
});

ok('depth past the cap queues nothing', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'A' } } });
  freshCascade();
  D.cascadeEnqueue(DOMAIN, 'L1', [{ modId: '7' }], D.MAX_CASCADE_DEPTH + 1, 'deep');
  assert.strictEqual(D.cascade.resolveQueue.length, 0);
  D.cascadeStop();
});

ok('depth exactly at the cap still queues', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'A' } } });
  freshCascade();
  D.cascadeEnqueue(DOMAIN, 'L1', [{ modId: '7' }], D.MAX_CASCADE_DEPTH, 'edge');
  assert.strictEqual(D.cascade.seen.size, 1);
  D.cascadeStop();
});

ok('stop empties both queues', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'A' } } });
  freshCascade();
  D.cascadeEnqueue(DOMAIN, 'L1', [{ modId: '7' }, { modId: '8' }], 1, 'A');
  D.cascade.popupQueue.push({ domain: DOMAIN, listId: 'L1', record: {}, depth: 1 });
  D.cascadeStop();
  assert.strictEqual(D.cascade.resolveQueue.length, 0);
  assert.strictEqual(D.cascade.popupQueue.length, 0);
  assert.strictEqual(D.cascade.stopped, true);
});

ok('entries without a mod id are ignored', () => {
  seed({ lists: { L: ['1'] }, mods: { 1: { name: 'A' } } });
  freshCascade();
  D.cascadeEnqueue(DOMAIN, 'L1', [{ name: 'no id' }, null, { modId: '5' }], 1, 'A');
  assert.strictEqual(D.cascade.seen.size, 1);
  D.cascadeStop();
});

ok('an empty add list queues nothing', () => {
  freshCascade();
  D.cascadeEnqueue(DOMAIN, 'L1', [], 1, 'A');
  assert.strictEqual(D.cascade.resolveQueue.length, 0);
  assert.strictEqual(D.cascade.popupQueue.length, 0);
});

ok('idle means both queues drained and nothing in flight', () => {
  freshCascade();
  // A resolve loop from an earlier case may still be unwinding its awaits; idle is a
  // pure read of the four fields, so pin them rather than racing the loop.
  D.cascade.running = false; D.cascade.showing = false;
  assert.strictEqual(D.cascadeIdle(), true);
  D.cascade.resolveQueue.push({ modId: 'x' });
  assert.strictEqual(D.cascadeIdle(), false, 'pending work is not idle');
  D.cascadeStop();
  D.cascade.running = false;
  assert.strictEqual(D.cascadeIdle(), true, 'stop drains it back to idle');
});

ok('each queued entry keeps its own target list', () => {
  seed({ lists: { A: ['1'], B: [] }, mods: { 1: { name: 'X' } } });
  freshCascade();
  // Enqueue starts the resolve loop, which shifts the first entry off synchronously
  // before its first await — so match by modId rather than by index.
  D.cascadeEnqueue(DOMAIN, 'L1',
    [{ modId: '7' }, { modId: '8' }, { modId: '9', listId: 'L2' }], 1, 'X');
  const q = host(D.cascade.resolveQueue);
  const byId = Object.fromEntries(q.map(e => [e.modId, e.listId]));
  assert.strictEqual(byId['8'], 'L1', 'no explicit list falls back to the default');
  assert.strictEqual(byId['9'], 'L2', 'an explicit list is kept');
  D.cascadeStop();
});

ok('the budget is a real number, not unlimited', () => {
  assert.ok(D.MAX_CASCADE_MODS > 0 && D.MAX_CASCADE_MODS <= 200, String(D.MAX_CASCADE_MODS));
  assert.strictEqual(D.MAX_CASCADE_DEPTH, 2);
});


console.log('\n--- list switches ---');

function switched(disabledIds) {
  return D.buildDepGraph(DOMAIN, { disabledListIds: new Set(disabledIds) });
}

ok('switching a list off makes its mods stop counting as installed', () => {
  seed({ lists: { Core: ['1'], Extra: ['2'] },
    mods: { 1: { name: 'Base' }, 2: { name: 'Dep', deps: [['1']] } } });
  assert.strictEqual(D.buildDepGraph(DOMAIN).nodes.get('mod:1').status, 'have');
  assert.strictEqual(switched(['L1']).nodes.get('mod:1').status, 'offList',
    'owned, but only in the list that is off');
});

ok('a switched-off mod names the list you would need', () => {
  seed({ lists: { Core: ['1'], Extra: ['2'] },
    mods: { 1: { name: 'Base' }, 2: { name: 'Dep', deps: [['1']] } } });
  const n = switched(['L1']).nodes.get('mod:1');
  assert.deepStrictEqual(host(n.offLists).map(l => l.name), ['Core']);
  assert.strictEqual(host(n.inLists).length, 0);
});

ok('offList is distinct from missing', () => {
  seed({ lists: { Core: ['1'], Extra: ['2'] },
    mods: { 1: { name: 'Base' }, 2: { name: 'Dep', deps: [['1'], ['9']] }, 9: { name: 'Nowhere' } } });
  const g = switched(['L1']);
  assert.strictEqual(g.nodes.get('mod:1').status, 'offList');
  assert.strictEqual(g.nodes.get('mod:9').status, 'missing');
});

ok('mods only in a disabled list contribute no edges of their own', () => {
  seed({ lists: { Core: ['1'], Extra: ['2'] },
    mods: { 1: { name: 'Base', deps: [['3']] }, 2: { name: 'Other' }, 3: { name: 'Deep' } } });
  assert.strictEqual(D.buildDepGraph(DOMAIN).edges.length, 1);
  assert.strictEqual(switched(['L1']).edges.length, 0, 'Base is not installed, so its needs are moot');
});

ok('activeLists and disabledCount report the model', () => {
  seed({ lists: { A: ['1'], B: ['2'], C: [] }, mods: { 1: { name: 'X' }, 2: { name: 'Y' } } });
  const g = switched(['L2']);
  assert.deepStrictEqual(host(g.activeLists).map(l => l.name), ['A', 'C']);
  assert.strictEqual(g.disabledCount, 1);
});

ok('the cross-list matrix only considers lists left on', () => {
  seed({ lists: { Core: ['1'], Play: ['2'], Cosmetic: ['3'] }, mods: {
    1: { name: 'Base' }, 2: { name: 'P', deps: [['1']] }, 3: { name: 'C', deps: [['1']] } } });
  const all = D.crossListMatrix(DOMAIN, D.buildDepGraph(DOMAIN));
  assert.strictEqual(all.cells.size, 2, 'both Play and Cosmetic need Core');
  const g = switched(['L3']);
  const some = D.crossListMatrix(DOMAIN, g);
  assert.strictEqual(some.cells.size, 1, 'Cosmetic is out of the model');
  assert.deepStrictEqual(host(some.lists).map(l => l.name), ['Core', 'Play']);
});

ok('switching everything off yields an empty model, not a crash', () => {
  seed({ lists: { A: ['1'], B: ['2'] }, mods: { 1: { name: 'X' }, 2: { name: 'Y', deps: [['1']] } } });
  const g = switched(['L1', 'L2']);
  assert.strictEqual(host(g.list).length, 0);
  assert.strictEqual(g.edges.length, 0);
  assert.strictEqual(host(g.activeLists).length, 0);
});

ok('no disabled set behaves exactly like all lists on', () => {
  seed({ lists: { A: ['1'], B: ['2'] }, mods: { 1: { name: 'X' }, 2: { name: 'Y', deps: [['1']] } } });
  const plain = D.buildDepGraph(DOMAIN);
  const empty = switched([]);
  assert.strictEqual(host(plain.list).length, host(empty.list).length);
  assert.strictEqual(plain.nodes.get('mod:1').status, empty.nodes.get('mod:1').status);
});


console.log('\n--- busy indicator ---');

const task = (b) => host(D.busyTasks.values())[host(D.busyTasks.keys()).indexOf(b.id)];
const only = () => host(D.busyTasks.values())[0];

ok('a task appears while it runs and vanishes when done', () => {
  D.busyTasks.clear();
  const b = D.beginBusy('Doing a thing');
  assert.strictEqual(D.busyTasks.size, 1);
  assert.strictEqual(only().label, 'Doing a thing');
  b.done();
  assert.strictEqual(D.busyTasks.size, 0);
});

ok('done() twice does not go negative or throw', () => {
  D.busyTasks.clear();
  const b = D.beginBusy('x');
  b.done(); b.done();
  assert.strictEqual(D.busyTasks.size, 0);
});

ok('label and detail update in place', () => {
  D.busyTasks.clear();
  const b = D.beginBusy('First');
  b.label('Second'); b.detail('a detail');
  assert.strictEqual(only().label, 'Second');
  assert.strictEqual(only().detail, 'a detail');
  b.done();
});

ok('step sets both a fraction and a readable detail', () => {
  D.busyTasks.clear();
  const b = D.beginBusy('Reading');
  b.step(3, 12, 'SkyUI');
  assert.strictEqual(only().frac, 0.25);
  assert.strictEqual(only().detail, '3/12 · SkyUI');
  b.done();
});

ok('progress clamps and rejects nonsense, falling back to indeterminate', () => {
  D.busyTasks.clear();
  const b = D.beginBusy('x');
  b.progress(2); assert.strictEqual(only().frac, 1);
  b.progress(-5); assert.strictEqual(only().frac, 0);
  b.progress(NaN); assert.strictEqual(only().frac, null, 'NaN means unknown, not zero');
  b.progress('half'); assert.strictEqual(only().frac, null);
  b.done();
});

ok('step with a zero total stays indeterminate rather than dividing by zero', () => {
  D.busyTasks.clear();
  const b = D.beginBusy('x');
  b.step(0, 0);
  assert.strictEqual(only().frac, null);
  b.done();
});

ok('several tasks coexist and each clears independently', () => {
  D.busyTasks.clear();
  const a = D.beginBusy('A'), b = D.beginBusy('B');
  assert.strictEqual(D.busyTasks.size, 2);
  a.done();
  assert.strictEqual(D.busyTasks.size, 1);
  assert.strictEqual(only().label, 'B');
  b.done();
});

ok('withBusy clears the task even when the work throws', async () => {
  D.busyTasks.clear();
  let threw = false;
  await D.withBusy('risky', async () => { throw new Error('boom'); })
    .catch(() => { threw = true; });
  assert.strictEqual(threw, true, 'the error still propagates');
  assert.strictEqual(D.busyTasks.size, 0, 'and the strip does not get stuck');
});

ok('withBusy returns the work’s value', async () => {
  D.busyTasks.clear();
  const v = await D.withBusy('x', async () => 42);
  assert.strictEqual(v, 42);
  assert.strictEqual(D.busyTasks.size, 0);
});

ok('setBusy(false) clears the implicit task it created', () => {
  D.busyTasks.clear();
  D.setBusy(true, 'checking');
  assert.strictEqual(D.busyTasks.size, 1);
  D.setBusy(true, 'still checking');
  assert.strictEqual(D.busyTasks.size, 1, 'repeat calls relabel rather than stack');
  assert.strictEqual(only().label, 'still checking');
  D.setBusy(false);
  assert.strictEqual(D.busyTasks.size, 0);
});

Promise.all(pending).then(() => console.log(`\n${pass} checks passed\n`));
