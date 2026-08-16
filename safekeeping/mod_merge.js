#!/usr/bin/env node
'use strict';
/*
  mod_merge — companion to the Nexus Curator userscript.

  Takes the folder tree Curator downloads into:

      <Downloads>/Nexus Mods/<Game>/<List>/<Mod>/*.zip|7z|rar

  and merges every archive into a real game installation at the correct depth, tracking
  what came from where so it can be cleanly removed again.

  USAGE
      node mod_merge.js plan   --mods <dir> --game <dir> [--list <name>]
      node mod_merge.js apply  --mods <dir> --game <dir> [--list <name>] --confirm
      node mod_merge.js status --game <dir>
      node mod_merge.js remove --game <dir> --mod "<Mod Name>" [--confirm]

  `plan` never writes anything. `apply` refuses to write without --confirm.

  WHY IT NEEDS THE GAME FOLDER
  ----------------------------
  An archive is really just a list of file paths, and the question is only ever "at what
  depth does this path start being real?". The game folder answers that authoritatively:
  strip leading folders until what remains matches directories the game actually has.

  That alone is not enough, because the directories mods care about most often do not
  exist in a vanilla install. Measured on a real CP2077 install, vanilla has:

      archive, bin, engine, r6          — and NOT archive/pc/mod, bin/x64/plugins,
                                          r6/scripts, r6/tweaks, or red4ext at all

  So a second signal is needed: agreement between the archives themselves. Across 97
  real mods, top-level names used by three or more different mods were archive, bin, r6
  and red4ext — contributing exactly the one anchor (red4ext) the game folder cannot
  know. The game folder in turn contributes `engine`, which too few mods use to reach
  the consensus threshold. Each covers the other's blind spot.

  A third signal falls out of installing in order: once RED4ext is installed,
  red4ext/plugins exists for the mods that extend it, so the reference tree grows as it
  goes.

  NO EXTERNAL DEPENDENCIES. Extraction uses bsdtar, which ships with macOS and reads
  zip, 7z and rar.
*/

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MANIFEST_DIR = '.mod_merge';
const MANIFEST_FILE = 'installed.json';
const BACKUP_DIR = 'overwritten';
const CONSENSUS_MIN = 3;      // distinct mods that must agree before a name is an anchor
const ARCHIVE_RE = /\.(zip|7z|rar)$/i;

// ---------------------------------------------------------------- small helpers

const lc = (s) => String(s).toLowerCase();

function die(msg) {
  console.error('error: ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function walkFiles(dir, test, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}

function fmtBytes(n) {
  if (n < 1024) return n + 'B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(0) + 'KB';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + 'MB';
  return (n / 1024 ** 3).toFixed(2) + 'GB';
}

// ------------------------------------------------------------------- the game

/*
  Every directory in the game, relative and lowercased. Capped in depth because the
  interesting structure is near the top and CP2077 has ~100k files further down.
*/
function indexGameDirs(gameDir, maxDepth = 5) {
  const dirs = new Set();
  (function walk(abs, rel, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.endsWith('.app')) continue;
      // Skip our own bookkeeping and any dot-folder: they are not install targets, and
      // letting .mod_merge become an "anchor" would be circular.
      if (e.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      dirs.add(lc(r));
      walk(path.join(abs, e.name), r, depth + 1);
    }
  })(gameDir, '', 0);
  return dirs;
}

// --------------------------------------------------------------- the archives

function listArchive(file) {
  const raw = execFileSync('bsdtar', ['-tf', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return raw.split('\n')
    .map(e => e.replace(/\\/g, '/'))
    .filter(e => e && !e.endsWith('/') &&
      !e.startsWith('__MACOSX') && !/(^|\/)\._/.test(e) && !/(^|\/)\.DS_Store$/i.test(e));
}

/*
  Read the download tree. Curator's layout gives us list and mod names for free, which
  is what makes conflict reports readable ("X overwrote Y") rather than path soup.
*/
function collectArchives(modsRoot, onlyList) {
  const files = walkFiles(modsRoot, n => ARCHIVE_RE.test(n));
  const items = [];
  for (const file of files) {
    const rel = path.relative(modsRoot, file);
    const parts = rel.split(path.sep);
    // <List>/<Mod>/archive.zip  — anything shallower is unexpected but tolerated
    const list = parts.length >= 3 ? parts[0] : '(loose)';
    const mod = parts.length >= 2 ? parts[parts.length - 2] : path.basename(file, path.extname(file));
    if (onlyList && lc(list) !== lc(onlyList)) continue;
    // Curator writes Info/<Mod>.txt next to the archives; never install those.
    if (parts.some(p => lc(p) === 'info')) continue;
    let entries;
    try { entries = listArchive(file); } catch (e) { items.push({ file, list, mod, error: e.message }); continue; }
    if (!entries.length) { items.push({ file, list, mod, error: 'archive is empty' }); continue; }
    items.push({ file, list, mod, entries });
  }
  return items;
}

/*
  Names that many different mods place at their top level are almost certainly real
  install targets, whether or not the game has created them yet.
*/
function learnConsensus(items) {
  const votes = new Map();
  for (const it of items) {
    if (!it.entries) continue;
    const tops = new Set();
    for (const f of it.entries) {
      if (!f.includes('/')) continue;          // a bare file has no top-level folder
      tops.add(lc(f.split('/')[0]));
    }
    for (const t of tops) {
      if (!votes.has(t)) votes.set(t, new Set());
      votes.get(t).add(it.mod);
    }
  }
  const anchors = new Set();
  for (const [name, mods] of votes) if (mods.size >= CONSENSUS_MIN) anchors.add(name);
  return { anchors, votes };
}

// --------------------------------------------------------------- classification

/*
  Not everything in a mod folder belongs in the game folder. Both of these were found in
  a real library and both would be silently wrong to merge:

    save games  — sav.dat + metadata json, belong in the saves folder
    REDmods     — info.json beside archives/, install to mods/<name>/ keeping the wrapper
*/
function classify(entries) {
  const lower = entries.map(lc);
  if (lower.some(f => /(^|\/)sav\.dat$/.test(f))) return 'save';
  if (lower.some(f => /(^|\/)info\.json$/.test(f)) &&
      lower.some(f => /(^|\/)archives\//.test(f))) return 'redmod';
  if (lower.some(f => /(^|\/)fomod\/moduleconfig\.xml$/.test(f))) return 'fomod';
  return 'mod';
}

/*
  How many leading directories of this path are real, given what the game has and what
  the archives agree on. Only the first segment may lean on consensus — deeper agreement
  would be guessing.
*/
function prefixDepth(rel, gameDirs, anchors) {
  const parts = rel.split('/');
  let cur = '', n = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? cur + '/' + parts[i] : parts[i];
    const key = lc(cur);
    if (gameDirs.has(key) || (i === 0 && anchors.has(key))) n++;
    else break;
  }
  return n;
}

/*
  Choose one strip offset for the whole archive rather than per file. Per-file matching
  looks tempting but scatters a mod: an inner `textures/` would happily match the game's
  own, and half the mod would land somewhere else.
*/
function chooseStrip(entries, gameDirs, anchors, maxStrip = 4) {
  let best = { strip: 0, avg: -1, anchored: 0 };
  for (let d = 0; d < maxStrip; d++) {
    let sum = 0, anchored = 0, total = 0;
    for (const f of entries) {
      const parts = f.split('/');
      if (parts.length <= d) continue;
      const depth = prefixDepth(parts.slice(d).join('/'), gameDirs, anchors);
      sum += depth;
      if (depth > 0) anchored++;
      total++;
    }
    if (!total) continue;
    const avg = sum / total;
    if (avg > best.avg + 1e-9) best = { strip: d, avg, anchored: anchored / total };
  }
  return best;
}

// -------------------------------------------------------------------- planning

function buildPlan(items, gameDirs, anchors) {
  const plan = [];
  const growing = new Set(gameDirs);     // installing creates dirs later mods rely on

  for (const it of items) {
    if (it.error) { plan.push({ ...it, kind: 'error' }); continue; }
    const kind = classify(it.entries);
    if (kind !== 'mod') { plan.push({ ...it, kind, skipped: true }); continue; }

    const fit = chooseStrip(it.entries, growing, anchors);
    const files = [];
    const docs = [];
    for (const f of it.entries) {
      const parts = f.split('/');
      if (parts.length <= fit.strip) continue;
      const target = parts.slice(fit.strip).join('/');

      /*
        A file that ends up loose in the game root, with no directory to anchor it, is
        almost always documentation the author bundled — and writing it there is both
        wrong and noisy. 28 mods in one real library each shipped a root `codes.txt`,
        which would have meant 28 mods overwriting one junk file in the game root.

        Only doc-shaped extensions are diverted; anything else loose at the root is kept
        and surfaced, because that is unusual enough to want a human eye.
      */
      if (!target.includes('/') && /\.(txt|md|pdf|rtf|html?|jpe?g|png|gif|webp|url|nfo|docx?)$/i.test(target)) {
        docs.push(target);
        continue;
      }
      files.push({ from: f, to: target });
      const dir = target.split('/').slice(0, -1).join('/');
      if (dir) {
        // register every ancestor so the next mod can anchor against it
        const segs = dir.split('/');
        for (let i = 1; i <= segs.length; i++) growing.add(lc(segs.slice(0, i).join('/')));
      }
    }
    plan.push({ ...it, kind: 'mod', strip: fit.strip, anchored: fit.anchored, files, docs });
  }
  return plan;
}

function findConflicts(plan) {
  const owners = new Map();          // target path -> [{mod, list, file}]
  for (const p of plan) {
    if (p.kind !== 'mod' || !p.files) continue;
    for (const f of p.files) {
      const key = lc(f.to);
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push({ mod: p.mod, list: p.list, to: f.to });
    }
  }
  /*
    Two very different things look identical at this level and must not be reported the
    same way:

      cross-mod  — two mods genuinely fight over a file; install order decides, and you
                   probably want to know (CET and cybercmd both ship bin/x64/version.dll)
      same-mod   — one mod folder holds several archives that overlap, which almost
                   always means they are alternatives or an older version, not layers.
                   Merging those is not a load-order question, it is a "pick one".
  */
  const cross = [], sameMod = [];
  for (const [, list] of owners) {
    if (list.length < 2) continue;
    const mods = new Set(list.map(x => lc(x.mod)));
    (mods.size > 1 ? cross : sameMod).push({ path: list[0].to, claimants: list });
  }
  return { cross, sameMod };
}

// ------------------------------------------------------------------- manifest

function manifestPath(gameDir) {
  return path.join(gameDir, MANIFEST_DIR, MANIFEST_FILE);
}

function readManifest(gameDir) {
  try { return JSON.parse(fs.readFileSync(manifestPath(gameDir), 'utf8')); }
  catch { return { schema: 1, installs: [] }; }
}

function writeManifest(gameDir, data) {
  const dir = path.join(gameDir, MANIFEST_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath(gameDir), JSON.stringify(data, null, 1));
}

// --------------------------------------------------------------------- apply

function extractTo(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  execFileSync('bsdtar', ['-xf', archive, '-C', dest], { maxBuffer: 1 << 28 });
}

/*
  Install one archive.

  Overwrites are stashed rather than clobbered, and the manifest records the stash, so
  removing a mod can put back whatever it displaced instead of leaving a hole. That is
  the whole difference between "a merge" and "something you can undo".
*/
function applyOne(entry, gameDir, tmpRoot, manifest) {
  const staging = fs.mkdtempSync(path.join(tmpRoot, 'mm-'));
  try {
    extractTo(entry.file, staging);
    const written = [];
    for (const f of entry.files) {
      const src = path.join(staging, f.from);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(gameDir, f.to);
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      let backup = null;
      if (fs.existsSync(dest)) {
        const rel = path.join(String(manifest.installs.length), f.to);
        backup = path.join(MANIFEST_DIR, BACKUP_DIR, rel);
        const abs = path.join(gameDir, backup);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.copyFileSync(dest, abs);
      }
      fs.copyFileSync(src, dest);
      written.push({ path: f.to, backup });
    }
    return written;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------- output

function reportPlan(plan, conflicts, anchors, gameDirs) {
  const mods = plan.filter(p => p.kind === 'mod');
  const skipped = plan.filter(p => p.skipped);
  const errors = plan.filter(p => p.kind === 'error');
  const totalFiles = mods.reduce((n, m) => n + m.files.length, 0);
  const weak = mods.filter(m => m.anchored < 0.99);

  console.log('anchors from the game folder : ' +
    [...gameDirs].filter(d => !d.includes('/')).sort().join(', '));
  console.log('anchors from mod consensus   : ' + [...anchors].sort().join(', '));
  console.log('');
  console.log(`archives to install : ${mods.length}`);
  console.log(`files to write      : ${totalFiles}`);
  console.log(`skipped             : ${skipped.length}`);
  console.log(`unreadable          : ${errors.length}`);
  console.log(`cross-mod conflicts : ${conflicts.cross.length}`);
  console.log(`overlapping archives: ${conflicts.sameMod.length} file(s) within a single mod`);
  const docCount = mods.reduce((n, m) => n + (m.docs ? m.docs.length : 0), 0);
  if (docCount) console.log(`readme files skipped: ${docCount}`);

  const stripped = mods.filter(m => m.strip > 0);
  if (stripped.length) {
    console.log('\n--- wrapper folders stripped ---');
    for (const m of stripped.slice(0, 20)) {
      console.log(`  -${m.strip}  ${m.mod.slice(0, 46)}`);
    }
  }

  if (weak.length) {
    console.log('\n--- partially anchored (mod creates new folders; usually fine) ---');
    for (const m of weak.slice(0, 15)) {
      console.log(`  ${(m.anchored * 100).toFixed(0).padStart(3)}%  ${m.mod.slice(0, 44).padEnd(46)} ${m.files[0] ? m.files[0].to.slice(0, 44) : ''}`);
    }
  }

  if (skipped.length) {
    console.log('\n--- skipped, not game-folder mods ---');
    const byKind = new Map();
    for (const s of skipped) {
      if (!byKind.has(s.kind)) byKind.set(s.kind, new Set());
      byKind.get(s.kind).add(s.mod);
    }
    for (const [kind, set] of byKind) {
      console.log(`  ${kind}:`);
      for (const m of set) console.log(`     ${m.slice(0, 60)}`);
    }
  }

  if (errors.length) {
    console.log('\n--- unreadable ---');
    for (const e of errors) console.log(`  ${path.basename(e.file)}: ${e.error}`);
  }

  if (conflicts.cross.length) {
    console.log('\n--- cross-mod conflicts (last install wins) ---');
    for (const c of conflicts.cross.slice(0, 25)) {
      console.log(`  ${c.path.slice(0, 62)}`);
      console.log(`     ${c.claimants.map(x => x.mod.slice(0, 26)).join('  ->  ')}`);
    }
    if (conflicts.cross.length > 25) console.log(`  … and ${conflicts.cross.length - 25} more`);
  }

  if (conflicts.sameMod.length) {
    // Grouped by mod: the useful unit is "this mod ships alternatives", not each file.
    const byMod = new Map();
    for (const c of conflicts.sameMod) {
      const m = c.claimants[0].mod;
      byMod.set(m, (byMod.get(m) || 0) + 1);
    }
    console.log('\n--- mods whose own archives overlap (probably alternatives — pick one) ---');
    for (const [mod, n] of byMod) {
      const archives = [...new Set(plan.filter(p => p.mod === mod).map(p => path.basename(p.file)))];
      console.log(`  ${mod.slice(0, 50)}  (${n} overlapping file(s))`);
      for (const a of archives) console.log(`     ${a.slice(0, 66)}`);
    }
  }
}

// ----------------------------------------------------------------------- main

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('USAGE')[1].split('WHY')[0]);
    process.exit(0);
  }

  const gameDir = args.game && String(args.game);
  if (!gameDir || !fs.existsSync(gameDir)) die('--game must point at the game installation folder');

  if (cmd === 'status') {
    const m = readManifest(gameDir);
    if (!m.installs.length) { console.log('nothing installed by mod_merge'); return; }
    console.log(`${m.installs.length} install(s) recorded\n`);
    for (const i of m.installs) {
      console.log(`  ${i.mod.slice(0, 50).padEnd(52)} ${String(i.files.length).padStart(5)} files   ${i.list || ''}`);
    }
    return;
  }

  if (cmd === 'remove') {
    const target = args.mod && String(args.mod);
    if (!target) die('--mod "<Mod Name>" is required');
    const m = readManifest(gameDir);
    const idx = m.installs.findIndex(i => lc(i.mod) === lc(target));
    if (idx < 0) die(`"${target}" is not in the manifest — try: status`);
    const entry = m.installs[idx];
    console.log(`${entry.mod}: ${entry.files.length} file(s)`);
    if (!args.confirm) { console.log('\n(dry run — pass --confirm to actually remove)'); return; }

    let removed = 0, restored = 0;
    for (const f of entry.files) {
      const abs = path.join(gameDir, f.path);
      try {
        if (f.backup) {
          const b = path.join(gameDir, f.backup);
          if (fs.existsSync(b)) { fs.copyFileSync(b, abs); fs.rmSync(b, { force: true }); restored++; continue; }
        }
        if (fs.existsSync(abs)) { fs.rmSync(abs, { force: true }); removed++; }
      } catch (e) { console.log('  could not remove ' + f.path + ': ' + e.message); }
    }
    // prune directories that this left empty, deepest first
    const dirs = [...new Set(entry.files.map(f => path.dirname(path.join(gameDir, f.path))))]
      .sort((a, b) => b.length - a.length);
    for (const d of dirs) {
      try { if (fs.readdirSync(d).length === 0) fs.rmdirSync(d); } catch { /* not empty, fine */ }
    }
    m.installs.splice(idx, 1);
    writeManifest(gameDir, m);
    console.log(`removed ${removed}, restored ${restored} overwritten file(s)`);
    return;
  }

  const modsRoot = args.mods && String(args.mods);
  if (!modsRoot || !fs.existsSync(modsRoot)) die('--mods must point at the downloaded game folder');

  /*
    Consensus is always learned from the whole library, even when only one list is being
    installed. Anchors are a property of the game's modding conventions, not of the
    subset you happen to be installing — and a two-mod list would otherwise have almost
    no agreement to draw on.
  */
  const everything = collectArchives(modsRoot, null);
  if (!everything.length) die('no archives found under ' + modsRoot);
  const { anchors } = learnConsensus(everything);

  const onlyList = args.list && String(args.list);
  const items = onlyList
    ? everything.filter(i => lc(i.list) === lc(onlyList))
    : everything;
  if (!items.length) die(`no archives found for list "${onlyList}"`);

  const gameDirs = indexGameDirs(gameDir);
  const plan = buildPlan(items, gameDirs, anchors);
  const conflicts = findConflicts(plan);

  /*
    Say up front, before the wall of detail, whether this run is going to change
    anything. The notice used to be the last line after forty lines of plan output,
    which meant a dry run and a real install looked identical until you went hunting.
  */
  const banner = (text) => console.log('\n' + '='.repeat(60) + '\n' + text + '\n' + '='.repeat(60) + '\n');

  if (cmd === 'plan') {
    banner('PLAN ONLY — nothing will be written');
    reportPlan(plan, conflicts, anchors, gameDirs);
    console.log('\nNothing was written. To install, re-run with:  apply  ... --confirm');
    return;
  }

  if (cmd === 'apply') {
    if (!args.confirm) {
      banner('DRY RUN — nothing will be written (no --confirm)');
      reportPlan(plan, conflicts, anchors, gameDirs);
      console.log('\n*** NOTHING WAS INSTALLED. Add --confirm to actually write files. ***');
      return;
    }
    banner('INSTALLING into ' + gameDir);
    reportPlan(plan, conflicts, anchors, gameDirs);
    console.log('');

    const manifest = readManifest(gameDir);
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod_merge-'));
    const todo = plan.filter(p => p.kind === 'mod');
    let n = 0, wroteTotal = 0, replacedTotal = 0;
    try {
      for (const entry of todo) {
        n++;
        process.stdout.write(`  [${String(n).padStart(2)}/${todo.length}] ${entry.mod.slice(0, 44).padEnd(46)}`);
        const written = applyOne(entry, gameDir, tmpRoot, manifest);
        const replaced = written.filter(w => w.backup).length;
        wroteTotal += written.length;
        replacedTotal += replaced;
        manifest.installs.push({
          mod: entry.mod, list: entry.list, archive: path.basename(entry.file),
          installedAt: new Date().toISOString(), files: written
        });
        writeManifest(gameDir, manifest);      // after each, so a crash loses nothing
        console.log(`${String(written.length).padStart(4)} files` +
          (replaced ? `  (${replaced} replaced)` : ''));
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
    banner(`DONE — ${todo.length} mod(s), ${wroteTotal} file(s) written` +
      (replacedTotal ? `, ${replacedTotal} replaced` : ''));
    console.log('installed into : ' + gameDir);
    console.log('manifest       : ' + path.join(MANIFEST_DIR, MANIFEST_FILE));
    console.log('to undo one    : remove --game "..." --mod "<name>" --confirm');
    return;
  }

  die('unknown command: ' + cmd);
}

main();
