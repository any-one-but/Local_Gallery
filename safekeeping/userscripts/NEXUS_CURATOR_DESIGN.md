# Nexus Curator — design / dev plan

A userscript for nexusmods.com that keeps **mod lists** (ordered collections of mod-page
links), organised by game, and downloads every file for every mod on a list in one go,
with descriptions saved alongside. Plus a dependency intake flow when a mod is added, and
a per-game dependency audit.

Proposed file: `safekeeping/userscripts/Nexus_Curator.user.js`
(Not a "Stripper" — it doesn't scrape a feed, it manages a library. It borrows the
Stripper *chrome*: fixed dark panel, collapse caret, progress fill, live log.)

---

## 0. What was verified on the live site (2026-08-16, site build `v2026.0813.1602`)

This matters because the whole plan rests on scraping. Everything below was read out of
the real DOM, not assumed. Nexus is mid-migration to a new frontend, but **mod pages are
still the classic Laravel layout with a handful of Vue custom elements bolted on**.

| Thing | Where it lives | Notes |
|---|---|---|
| Mod description | `div.container.mod_description_container` on `?tab=description` | Full HTML, BBCode-rendered |
| Requirements accordion | `dt[data-accordion-track="mod_requirements"]` (and `"file_requirements"`) → its `dd` | **The only safe scope.** See the Mirrors trap below |
| Mod-level requirements **with author notes** | `table.desc-table` inside that `dd`, under `h3` "Nexus requirements" | Rows: `td.table-require-name > a[href]` + `td.table-require-notes` |
| Off-site requirements | Same `dd`, sibling `h3` "Off-site requirements" | External links — trackable, not addable |
| File list | `#file-container-main-files` / `-optional-files` / `-old-files` | Each is a `dl.accordion` |
| Per-file metadata | `dt.file-expander-header[data-id][data-name][data-size][data-version][data-date][data-dependencies-count]` | `data-id` = legacy file id (the `fid` the resolve endpoint wants); `data-date` = unix ts; **`data-size` is in KB** (2630 → "2.6MB") |
| Per-file description | `dd > div.tabbed-block.files-description` | Exactly the per-file text we want to save |
| Per-file download descriptor | `<mod-download-modal file="{json}">` | JSON has `uid`, `name`, `category`, `downloadUrl` |
| File-level dependencies | `<main-file-requirements download-links="{json}">` | `dependencies[].files[].mod.{name,url,thumbnailUrl}` |
| Free-user gate | `<slow-download-prompt eligible-for-free-trial="…">` | The wait-timer element |

Live sample of the requirements table (Legacy of the Dragonborn), which is precisely the
shape the intake popup needs:

```
Legacy of the Dragonborn Patches (Official) | OPTIONAL - Required to enhance the museum based on your installed mods
Skyrim Script Extender (SKSE64)             | OPTIONAL - Required for SKSE enabled functions v3.0+
SkyUI                                       | OPTIONAL - Required for MCM Menus v3.0+
```

Live sample of the embedded dependency JSON (SkyUI), which gives us *file-level* deps and
real download URLs without a second page fetch:

```json
{"name":"SkyUI","downloadUrl":"https://www.nexusmods.com/api/files/7318625021427/download",
 "dependencies":[{"files":[{"uid":7318624734761,"name":"Skyrim Script Extender (SKSE64) Steam",
   "version":"2.2.6","downloadUrl":"…/api/files/7318624734761/download",
   "mod":{"name":"Skyrim Script Extender (SKSE64)","url":"https://www.nexusmods.com/skyrimspecialedition/mods/30379"}}]}],
 "dlcDependencies":[]}
```

**Three dependency sources, and they disagree on purpose.** This is the single most
fiddly part of parsing, and Phase 0 turned up a source I'd missed:

| Source | Where | Has | Lacks |
|---|---|---|---|
| `table.desc-table` | description tab | author's prose notes | structure, ids |
| `mod-download-modal[requirements]` | either tab | `{type, name, url, adultContent, thumbnailUrl}` | **notes** |
| `mod-download-modal[dependencies]` / `main-file-requirements` | files tab | file uids, versions | notes |

Verified on `cyberpunk2077/mods/2675`, where `requirements` lists Cyber Engine Tweaks /
RED4ext / redscript as structured JSON while `dependencies` is `[]`; and on
`skyrimspecialedition/mods/12604`, where it's exactly the reverse. **Both shapes occur in
the wild, so all three sources must be merged** — keyed on mod URL, structure from the
JSON, prose from the table.

Two consequences worth pinning down now:

- **`type` is a discriminator** (`"mod"` observed; off-site and DLC presumably ride the
  same array), so off-site/DLC handling falls out of one parse instead of scraping
  separate tables.
- **Notes are very often the empty string.** All three rows on that Cyberpunk mod have
  `note: ""` — the author simply didn't write any. The intake popup must render that
  gracefully (an em-dash, not a blank cell, and never an empty "Notes" column heading
  implying data is missing). This is exactly the modularity the request asked for.

**A full record needs both tabs.** The description tab has no `#file-container-main-files`
and the files tab has no `desc-table`, so a first-time add is two fetches. But the
**refresh-before-download pass only needs the files tab** — versions and file lists live
there, and descriptions change rarely — so a 40-mod refresh is 40 requests, not 80.
Descriptions re-fetch only on first add or an explicit "refresh info".

---

## 1. The one genuinely risky part: how a download actually happens

Everything else here is bookkeeping. This is the part that decides whether the project
works, so it is Phase 0 and gets built first, on its own, before any UI.

**Target: free account.** So the slow path is not a fallback, it is *the* engine, and the
whole queue design is built around it rather than bolted on.

Nexus's two tiers behave completely differently:

- **Free (ours):** the button opens `slow-download-prompt` — an interstitial with an
  enforced wait before a `key` + `expires` pair is minted and the CDN link generated.
- **Premium:** resolves straight to a CDN URL, no interstitial.

**Curator waits the timer out and never circumvents it.** No timer patching, no clock
faking, no touching the ad frame. The overhead is per-file — the wait plus a page load —
so what actually dominates a big list is transfer time, not the gate. Phase 0 *measures*
the real per-file overhead on this account, and the panel shows a measured ETA before a
queue starts instead of a guess.

### Phase 0 findings (resolved by reading Nexus's own bundle, `web-components-GDHJGY6M.js`)

**The endpoint is confirmed.** Nexus's own download component calls:

```
POST https://www.nexusmods.com/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl
     Content-Type: application/x-www-form-urlencoded
     credentials: include
     body: game_id=<gameId>&fid=<legacyFileId>&collection_id=0
  -> 200 { "url": "<cdn url>" }
```

Everything it needs is scrapeable from the page: `fid` is `data-id` on
`dt.file-expander-header`, `game_id` comes off any `a[href*="game_id="]`, and
`collection_id` is `0` outside collections. So `resolveFileUrl()` is a dozen lines.

**Three findings that change the design:**

1. **There is no `key`/`expires` proof-of-wait in the request.** The free-tier countdown
   is a *client-side* value — a `countdown-seconds` attribute on `<mod-download-modal>`
   that a React hook ticks down before enabling the button. The endpoint itself will
   answer without it.

   **Curator waits anyway.** It reads `countdown-seconds` off the page and sleeps that
   long before every resolve, with a 5s floor if the attribute is absent. Being able to
   skip the wait is not a reason to skip it: the timer is how the site is asking to be
   used, it's the difference between automating my own clicking and hammering someone
   else's server, and a script that ignores it is also the script that gets the account
   banned. This is a deliberate choice and it is worth not quietly "optimising" later.

2. **Failure is HTTP 200.** Logged out, the endpoint returns `200 OK` with a body of
   `[]` — no `url` field, no error status. A naive `if (res.ok)` would treat a dead
   session as success and silently download nothing, dozens of times, during an
   unattended run. So the success test is `typeof json.url === 'string'` and nothing
   else; a missing `url` counts as an auth failure and trips the 3-strike hard stop.
   (Nexus's own code does exactly this, throwing "Download URL response missing 'url'
   field".)

3. **Tier is readable from the DOM** — `<mod-download-modal is-premium="false">` — so the
   script can pick its path per page instead of being configured, and can notice the day
   the account changes tier.

`slow` is the implementation that gets built and tested; `premium` (direct) stays as a
second implementation behind the same interface, since it's a few lines and means an
upgrade later needs no rework.

### Phase 0 results — all green (probed on a real logged-in free account)

Run against `cyberpunk2077/mods/2675` (free account, `is-premium="false"`,
`eligible-for-free-trial="true"`):

- **Resolve works.** `HTTP 200 in 420ms` → a real CDN URL at
  `supporter-files.nexus-cdn.com`, path `/9a/b9/b5/<uuid>`, query params
  `md5, expires, user_id, h`. So links are **signed, user-bound and expiring** — which
  settles it: resolve immediately before each transfer, never batch ahead. The URL was
  not fetched.
- **Subfolder writes work.** `Nexus Mods/_probe/subfolder-test.txt` landed correctly
  nested and intact. No flat-name fallback needed. Note the browser's download root on
  this machine is `~/Downloads/Chrome`, not `~/Downloads` — irrelevant to the script,
  since `GM_download` paths are relative to whatever that root is, but the UI should say
  "your browser's download folder" rather than naming one.
- **No `countdown-seconds` attribute was present at all**, even logged in on free tier.
  The 5s floor carried the resolve fine. So the attribute is optional in practice — the
  countdown likely materialises inside the modal at click time rather than on the
  collapsed trigger. Design unchanged: honour the attribute when present, 5s floor when
  not, and never go below the floor.

Free tier also permits only one download at a time server-side, which happens to match the
serial queue below — so this is not a limitation to work around, it's the shape of the
design.

Once we have a CDN URL, the actual save is `GM_download({url, name, saveAs:false})` — the
same mechanism the DA/Reddit strippers already use, so the browser's own download manager
does the transfer, exactly as asked.

Three caveats to design around, not discover later:

1. **Subfolders in `GM_download`.** Target is **Tampermonkey**, which supports a relative
   path in `name` (`Nexus Mods/Skyrim SE/My List/SkyUI/SkyUI.7z`) provided its download
   mode is the browser API rather than the legacy blob mode — so the tree works natively
   and no flat-name fallback is planned. Phase 0 still writes one file to confirm the
   mode, and if it comes back flattened the panel says so loudly rather than silently
   dumping 40 archives into Downloads.
2. **CDN links are short-lived and IP-bound.** Resolve immediately before each transfer,
   never batch-resolve a whole list up front.
3. **`@connect` must cover the CDN, which is on a different registrable domain.**
   Confirmed live: files come from **`supporter-files.nexus-cdn.com`** — `nexus-cdn.com`,
   *not* `nexusmods.com`. An `@connect *.nexusmods.com` alone silently blocks every
   transfer. Required:

   ```
   // @connect nexusmods.com
   // @connect *.nexusmods.com
   // @connect nexus-cdn.com
   // @connect *.nexus-cdn.com
   // @connect staticdelivery.nexusmods.com
   ```

**Rate limiting is a first-class feature, not a nicety.** One transfer at a time, no
parallelism, a configurable inter-file delay (default 3s), full honouring of any free-tier
timer, exponential backoff on 429/403, and a hard stop after 3 consecutive auth failures
with the queue left resumable. Bulk automated downloading is the sort of thing a site can
reasonably object to; keeping the request rate at or below what a human clicking would
produce is both the polite and the durable choice.

---

## 1a. Phase 1 findings (from building and testing the parser live)

Four things the real pages taught that the plan had wrong.

**The Mirrors trap — the worst bug found so far.** `table.desc-table` is not the
requirements table; it is a *generic* class reused by the Mirrors, Translations and other
accordions. Parsing it unscoped made USSEP — a mod with **no** requirements — report five
"off-site requirements" that were actually its download mirrors (AFK Mods, Bethesda.net,
ModDB…). Anything built on that would have shown users phantom dependencies and offered to
add them. The fix is to scope to `dt[data-accordion-track="mod_requirements"]` and take its
`dd`; the tracking attribute is machine-readable and stable, where heading text is neither.
Within the section, sub-tables are then classified by their preceding `h3`
(Nexus / Off-site / DLC), and an *unlabelled* table inside the requirements accordion
defaults to `mod` rather than being dropped.

**The header version is not the file version.** SkyUI's page header says **6.9** while its
current main file is **6.11** — the header field is author-set metadata and drifts.
Consequence for §6: **update detection must key off `fileId` + file `version` +
`uploadedAt`, never the mod's header version.** The record keeps the header version for
display only. This would have been a subtle, silent bug — the queue would have skipped
genuinely-updated files.

**`gameId` is not always on the page.** USSEP has no `game_id` link at all, and `gameId` is
required by the resolve endpoint, so a null there breaks downloading for that mod. Second
source: staticdelivery image URLs embed it as `/mods/<gameId>/`, available via `og:image`
on every page. Chain both.

**Two smaller ones.** Some mods (USSEP) render a legacy `<a>` download button instead of
`<mod-download-modal>`, so file `uid` is sometimes null — harmless, since the resolve
endpoint wants the legacy `fid` from `data-id`, which is always present. And empty
per-file descriptions are *normal*, not a parse failure: LOTD and USSEP simply have none,
where SkyUI has 127 characters. The Info file must not imply data was lost.

**Not yet verified:** no mod tested so far actually has an off-site or DLC requirements
table, so those two branches are written to the heading-name contract but unconfirmed
against live markup. They fail safe (an unrecognised heading falls back to `mod`, and
`dlc-dependencies` was observed as `[]`), but they should be confirmed the first time a
real example turns up rather than assumed correct.

## 2. Data model

Three record types. Mods are stored **once per game** and referenced by lists, so the same
mod in three lists is one record with one download-state — which is also what makes the
audit and the "you already have this" check trivial.

```js
Game    { domain, name, gameId, lists[], mods{}, createdAt }
List    { id, name, note, modUids[], createdAt, updatedAt }   // modUids is ordered
Mod     { uid, modId, url, name, author, version, updatedAt,
          summary, descriptionHtml,
          files: [{ fileId, uid, name, category, version, size, uploadedAt, description }],
          deps: [{ modUrl, modId, name, note, source, hard }],
          offsiteDeps: [{ label, url, note }],
          dlcDeps: [...],
          state: 'stub' | 'resolved',
          download: { lastVersion, lastAt, files: { [fileId]: {version, at} } } }
```

**`state: 'stub'` is what keeps the intake popup instant.** Adding a dependency from the
popup writes `{url, name, note, state:'stub'}` and nothing else — no page fetch. A stub is
resolved lazily: on next visit to its page, on demand from the library view, or
automatically just before it is downloaded. So "add all 9 dependencies" is one click and
zero network, and the popup never blocks on 9 page loads.

Membership is deliberately many-to-many (a mod can sit in several lists), because SKSE
genuinely belongs to every list. The download tree still gives each list its own copy on
disk — the same mod downloaded into two lists is two folders, by design, since the lists
are meant to be independently installable.

## 3. Storage — ✅ built (Phase 2)

`GM_setValue`, **one key per game** (`nc:game:skyrimspecialedition`) plus a small index
key (`nc:index`) and a `nc:ui` for panel state. Sharding by game matters: a serious
library is megabytes, and a whole-blob rewrite on every "add mod" would be slow and would
risk losing everything at once. Writes are debounced 400ms and versioned with a `schema`
field; `migrateGameDoc()` is the single point every read passes through, so nothing
downstream may assume a field that migration didn't guarantee.

Export/import the whole store as JSON from the panel. Worth doing on day one — per
`[[rabbithole-in-stripper]]`, GM storage is per-script, so anything that later becomes its
own script or moves managers starts from empty otherwise.

Four decisions worth keeping:

- **Mods are keyed by `modId`, not a Nexus uid.** `modId` is in the URL and always
  parseable; the internal uid is not reliably scrapeable (some pages render a legacy
  download button with no modal at all — see §1a). One less thing that can be null.
- **A corrupt key is write-locked, not overwritten.** If a game document fails to parse,
  reads fall back to an empty doc so the UI still works — but writes to that key are then
  *refused*. Otherwise the next autosave would replace a recoverable document with the
  empty one we substituted, turning a transient glitch into permanent loss. The dock says
  so loudly on boot.
- **Import merges and never replaces.** Lists union their members, mods fill gaps, and
  **local download history always beats the file's** — the local record knows what this
  machine actually has on disk and an exported file cannot. Import is idempotent:
  re-importing the same file adds nothing.
- **Flush on `pagehide`, `beforeunload` and `visibilitychange`.** A debounce that loses
  the last write on navigation is a bug, and on a multi-page site like Nexus, navigating
  away is the common case rather than the rare one.

**Tested:** `Nexus_Curator.store.test.js` — 15 checks over a `vm` sandbox with stubbed
`GM_*`, covering CRUD, cross-list membership, reload-from-storage, the three merge
invariants, and the corruption write-lock. Run with `node Nexus_Curator.store.test.js`.
(It sets `document.readyState = 'loading'` so `init()` registers but never fires, which
is what lets the store be tested with no DOM at all.)

---

## 4. UI surfaces

Two, and the split is deliberate.

**A. The dock** — the Stripper panel, near-identical chrome to `DA_Stripper`: fixed
right-side dark panel, `nc-head` with title + collapse caret, `nc-body` with buttons, a
progress fill, and a live log. It is *page-contextual* — on a mod page it shows that mod
and an "Add to list…" control; on a game page it shows that game's lists; anywhere else
it's just the opener. Collapsed state persists.

**B. The library overlay** — a full-viewport modal (the dock's "Library" button, or a
hotkey). The dock is too small for real list management, and Nexus's own page is in the
way. Three panes, borrowing the gallery's own model: games rail on the left, lists in the
middle, mods of the selected list on the right. Per-mod row: name, version, file count,
"deps: 3 ✓ / 1 ✗", Download, Open, Remove. Per-list header: Download All, Check For
Updates, Audit, Rename, Export, Delete.

Both are built from one small primitive set styled by a single `GM_addStyle` block, so the
intake popup, the audit, and the library all look like one thing. All state changes go
through a single re-render — no ad-hoc DOM patching, since the same list is visible in two
surfaces at once.

Built in Phase 3: `openModal()` (stacking, Esc closes the topmost, backdrop-only dismiss),
`textPromptModal()`, `confirmModal()`, `chooseListModal()`, and `renderLibrary()`. Two
details that came out of testing:

- **Backdrop dismiss listens on `mousedown` and checks `e.target === overlay`**, so a drag
  that starts inside the panel and releases outside doesn't count as "dismiss".
- **`politeFetchDoc()` is the only way the script fetches a page** — serialised, 700ms
  apart, never parallel — so there is exactly one place that governs request rate. It also
  treats "no mod title in the response" as an error, because Nexus answers deleted, hidden
  and adult-gated mods with a **200 and a normal-looking page**; status alone proves
  nothing.

Adding the mod you're currently reading costs **one** request, not two: `resolveModRecord()`
reuses the live document for whichever tab you're on and fetches only the other.

---

## 5. Feature: adding a mod, and the dependency intake popup

**Trigger.** "Add to list" in the dock on a mod page; or paste one or more mod URLs into
the library; or an "＋" button injected next to the mod title.

**Flow.** Scrape the current page (or fetch it for a pasted URL) → build the `Mod` record
→ append to the chosen list → compute the dependency picture → show the popup **only if
there is something to say**.

**Computing the picture.** Merge mod-level + file-level deps (§0), then bucket each one
against every mod already in *any* list for this game:

- `satisfiedHere` — already in the list we just added to
- `satisfiedElsewhere` — in another list for this game (**needs naming**: the user must
  know they have to install that other list too)
- `missing` — not anywhere in this game
- `offsite` — non-Nexus, can never be auto-added; shown as a note, never as a row with buttons
- `dlc` — official game DLC; same treatment

**The popup is fully modular.** One template, assembled from parts, so every combination
reads correctly rather than emitting "0 dependencies" boilerplate:

Five shapes, decided by `intakeShape()`, all verified live:

| Shape | Situation | Behaviour |
|---|---|---|
| `none` | No requirements at all | **No popup.** One log line. |
| `allHere` | All deps already in *this* list | **No popup.** Log: "all 2 dependencies are already in Core Utilities." |
| `allSatisfied` | All held, but some in *other* lists | Modal, no table, single Close: "You already have 2 of them…: SKSE64 (this list), SkyUI (Quest Mods)." The cross-list fact **is** the message. |
| `missing` | Anything outstanding | The full modal. Satisfied clause omitted entirely when nothing is held. |
| `infoOnly` | Off-site / DLC only | "…has no Nexus dependencies, but the author lists other requirements", info block, single Close, **no action buttons** — nothing here is addable. |

Full form:

> **Legacy of the Dragonborn SSE** has **3 dependencies**.
> You already have **2** in your lists for Skyrim Special Edition: **SkyUI** *(Core
> Utilities)*, **SKSE64** *(Core Utilities)*.
> You don't have these yet:
>
> | Mod | Author's note | | | |
> |---|---|---|---|---|
> | LOTD Patches (Official) | OPTIONAL - Required to enhance the museum… | `+ This list` | `+ Existing list ▾` | `+ New list…` |
>
> `Add all to this list` `Add all to an existing list ▾` `Add all to a new list` `Cancel`

Details that decide whether this feels good:

- **Rows disappear as they're actioned**, with the header count updating live; when the
  table empties, the popup collapses to a confirmation rather than sitting there empty.
- **`+ Existing list ▾`** is a dropdown of that game's lists with the current one and any
  list already containing the mod disabled — never a second modal.
- **`+ New list…`** takes a name inline in the row (Enter commits, Esc reverts), and once
  a new list exists in this session it joins the "existing" dropdown.
- **Note colouring** is a cheap, high-value touch: the notes are unstructured prose, but
  `NOTE_TAG_RE` catches the near-universal convention, so those get a coloured chip and the
  rest of the note stays as written. Never *hide* anything based on that parse — it's a
  hint, not a classification. **The matched prefix is stripped from the displayed text**,
  or the row reads "[OPTIONAL] OPTIONAL - Required for MCM Menus"; the chip carries the
  tag, the text carries the author's actual sentence. A dep flagged hard by the file-level
  source with no author note gets a REQUIRED chip and no text.
- **Cancel leaves the originally-added mod in place.** It cancels the dependency handling,
  not the add. Anything else would be a trap.
- **Recursion is opt-in.** Dependencies of dependencies are not fetched (a stub has no
  deps yet). A checkbox "also check the new mods' dependencies" re-runs the flow once per
  added mod after resolution, sequentially. Default off — otherwise one add can cascade
  into a dozen popups.
- Keyboard: Enter = primary, Esc = cancel, ↑↓ across rows. The gallery's own habit.

---

## 6. Feature: downloading

**Scope. Main Files only** — confirmed. Optional and Old files are still parsed into the
`Mod` record and listed in the UI (so you can see and one-off download them), and a
per-list "include optionals" toggle exists but is off. Recording them costs nothing since
we're already parsing the page, and it means changing your mind later is a checkbox
rather than a re-scrape of the whole library.

**Tree.**

```
<Downloads>/Nexus Mods/<Game>/<List>/<Mod>/
    SkyUI_6_11.7z
    SkyUI_Patch.7z
    Info/
        SkyUI.txt
```

Every segment sanitised: strip `/ \ : * ? " < > |`, collapse whitespace, trim dots, cap
each segment at ~64 chars, and fall back to `mod-<id>` if a name sanitises to nothing.
The gallery's own `sanitizeNamePart` / `sanitizeFolder` from the strippers port directly.

**The info file** — one `Info/<Mod Name>.txt`, since one file per mod is easier to read
than a scatter of them, with the per-file descriptions as labelled sections:

```
Legacy of the Dragonborn SSE
https://www.nexusmods.com/skyrimspecialedition/mods/11802
Version 5.9.6 · by icecreamassassin · downloaded 2026-08-16

=== DESCRIPTION ===
<mod description, HTML → text, links kept as "text <url>">

=== REQUIREMENTS ===
SkyUI — OPTIONAL - Required for MCM Menus v3.0+
  https://www.nexusmods.com/skyrimspecialedition/mods/12604
…
Off-site: ENB Series — https://enbdev.com

=== FILES ===
--- Legacy of the Dragonborn SSE v5.9.6 (Main, 2.1GB, uploaded 2026-03-21) ---
<that file's description>

--- LOTD Patch v5.9.6 (Main, 4MB, uploaded 2026-03-21) ---
<that file's description>
```

Saved via `GM_download` with a blob URL, same as the strippers' `saveBlob`. Written
**first**, before any archive, so a queue interrupted halfway still leaves the
documentation behind.

**"Most recent versions"** is the real requirement, so downloading a list is two passes:

1. **Refresh** — re-fetch each mod page (1 request per mod, ~1s apart), update the file
   manifest, diff against `download.files`.
2. **Transfer** — enqueue only new or version-changed files, unless "force re-download".

That also gives **Check For Updates** free: run pass 1, report, transfer nothing. A list
view then marks each mod ✓ current / ⬆ update available / ✗ never downloaded.

**The queue** is one shared serial queue across all lists, persisted to GM storage after
every item, so a browser crash or a tab close resumes rather than restarts. Panel shows
current file, list position, per-file progress, ETA. Pause / Resume / Skip / Cancel. A
failed item retries twice with backoff, then parks in a "Failed" tray with the error and a
Retry button — never a silent skip.

---

## 6a. Phase 5 findings

**The archive filename is the hard part, and the page is not a sufficient source.**

`data-name` is a display name ("SkyUI"), and the CDN URL is a bare uuid
(`/9a/b9/b5/<uuid>`). `a.btn-ajax-content-preview[data-url]` carries the real name —
`SkyUI-12604-6-11-1778020881.zip` — but **only for files Nexus can preview**. ArchiveXL
and TweakXL (Cyberpunk) have no preview link at all; they expose
`a.btn-ajax-manifest[data-manifest-uri]` instead, and that JSON lists the archive's
*contents*, not its name. Verified on the live pages: for those files the DOM carries no
filename anywhere.

So naming is a three-layer fallback, settled per file **at transfer time** rather than at
queue-build time, because the best source only exists once a link is held:

1. **`data-url` from the page** — free, covers most files.
2. **`Content-Disposition` from the CDN**, via a `HEAD` with `GM_xmlhttpRequest`. This is
   authoritative and works for every file. Best-effort: any failure falls through
   silently, and it runs **only on the first attempt**, so a retry loop can't hammer a
   possibly single-use link.
3. **A constructed name**, `<file>-<modId>-<version>.zip`.

**`.zip` is the fallback extension, not `.7z`.** Tampermonkey vetoes downloads whose
extension is outside its configurable *Whitelisted File Extensions* list, failing with
`not_whitelisted` — this is a Tampermonkey policy, nothing to do with Nexus. `.zip` is the
most likely to be whitelisted anywhere, and archive tools identify containers by magic
bytes rather than suffix, so a 7z or rar payload saved as `.zip` still opens. A
wrong-but-openable name beats a right-but-refused one.

Three supporting rules:

- `ensureArchiveExtension()` guarantees every leaf ends in a known archive extension,
  appending `.zip` when it doesn't.
- A `not_whitelisted` failure **retries once as `.zip`** before giving up.
- A whitelist veto is then treated as **permanent, not transient** — no backoff retries,
  since it's a settings problem and grinding through identical refusals just burns the
  gate. The failure tray shows the offending extension and names the setting to change.

**Path segments are sanitised against traversal, not just against illegal characters.**
A mod named `../../etc/passwd` must not escape the tree. Tested: the built path contains
no `..` and still has exactly five segments. Names that sanitise away entirely fall back
to `mod-<id>` / `list-<id>` so a path can never contain an empty segment.

**Update detection is file-keyed on version *and* upload time.** Authors re-upload without
bumping the version, so version alone misses real changes; and the header version drifts
from file versions (§1a), so it must not be consulted at all. `fileNeedsDownload()` is the
single predicate, used by both the queue builder and the library's ✓/⬆/· state badge.

**Queue behaviour worth preserving:**

- **Serial, gated, never parallel.** Each file waits out `max(5s, observed countdown)`
  before its link is resolved. The countdown is learned from any page that advertises
  `countdown-seconds` and stored; the 5s floor applies when none ever has.
- **Links are resolved immediately before each transfer**, never batched — they are
  signed, user-bound and expiring (§1).
- **The Info file is queued first for each mod**, so an interrupted run still leaves the
  documentation behind.
- **A restored queue never auto-starts.** On load it comes back paused, with anything
  caught mid-flight returned to pending, and the dock says how many are waiting. Silently
  resuming a download queue on page load would be obnoxious.
- **Three consecutive "no url" answers stop the whole queue**, not just the item — that
  pattern means the session died, and grinding through 40 files to fail identically each
  time helps nobody.
- **Failures park in a tray with the reason and a retry-all**, never a silent skip.

**Still unverified: no actual archive has been downloaded yet.** Everything up to the
transfer is tested — the resolve endpoint was proven live in Phase 0, and paths, naming,
diffing and Info generation have unit tests — but pressing "Download list" for real writes
to disk and spends the account's download allowance, so the first true run is the user's
to make. The likeliest thing to surface there is a `@connect` or CDN-redirect detail.

## 6b. Phase 7 findings

**`includeOptional` is per list, not per mod**, and `downloadableFiles(list, mod)` is the
one place that decides what a run wants — used by the queue builder, the rollups and the
row badges alike. The same mod can therefore read ✓ in a main-files-only list and ⬆ in a
list that wants its optionals, which is correct: the lists genuinely want different things.
Old files are never downloadable in either mode.

**Rollups are computed from stored manifests only, never the network**, so opening the
library is instant. That makes them honest-but-stale, which is why the UI says "1 to get"
rather than "1 update available" — it can only speak for what the last refresh saw, and
*Check updates* is the thing that refreshes it.

**Cursor movement selects, in the games and lists panes.** The first version required
Enter, which left the cursor sitting on one list while the mods pane still showed another
— technically the documented rule and unmistakably a bug to look at. Moving now selects,
matching what clicking already did; Enter simply steps right into what the cursor opened.
In the mods pane the cursor stays a cursor and Enter opens the mod page.

The key handler binds on the document in capture, and refuses to act when a text field has
focus or when any modal is stacked above the library — so the list-settings dialog can't be
navigated out from underneath.

## 7. Feature: dependency audit

The one part where the request said "I don't know the exact display form". Here's the
recommendation, and the reasoning.

A node-and-edge graph is the obvious answer and the wrong default: a 150-mod library is a
hairball, and the actual questions are *"what have I missed"* and *"what is load-bearing"*
— both of which a graph answers worse than a table. So: **three coordinated views, with
the table primary.**

**A. Foundation table (default).** Every mod that anything depends on, across the whole
game, ranked by dependent count:

| Required mod | Depended on by | In lists | Status |
|---|---|---|---|
| SKSE64 | 14 mods | Core Utilities | ✓ Have |
| Address Library | 9 mods | — | ✗ **Missing** — `Add to…` |
| SkyUI | 6 mods | Core Utilities | ✓ Have |
| ENB Series | 2 mods | — | ⧉ Off-site |

This is the actionable view: sorted this way, the top of the table is exactly the set of
mods that must be installed first, and anything red is a hole in the library. Clicking a
row expands its dependents. Filters: Missing only / Off-site / Optional-only.

**B. Cross-list matrix.** The insight the request is circling without naming: dependencies
that cross list boundaries. A grid of list × list, cell = "List A has 3 mods whose
dependencies live in List B" — i.e. **you cannot install A without also installing B**.
Cells click through to the specific mods. For anyone treating lists as independently
installable profiles, this is the highest-value screen here.

**C. Graph.** Hand-rolled SVG, layered top-down (longest-path layering + a barycentre
sweep to reduce crossings — no external library, keeping the script self-contained). Made
survivable by defaulting to **only mods with at least one edge**, collapsing leaves into a
"+7 dependents" badge, colouring by list, dashed edges for optional deps, and red nodes
for missing. Pan/zoom, click to focus a subtree. Export as `.svg` via `GM_download`.

### Phase 6 findings

All views run off one `buildDepGraph(domain)` producing `{nodes, list, edges, cycles}`,
so the table, the matrix and the picture cannot disagree.

**Scope is "mods in at least one list."** A mod sitting in the library in no list isn't
part of any build, so its requirements aren't yet your problem — it contributes no edges.

**Two distinctions the implementation had to learn, both caught by looking at real
output rather than by reading the code:**

- **"In a loop" ≠ "blocked by a loop".** Kahn's algorithm leaves both kinds behind, and
  the first draft labelled them identically — so Fancy Outfit, which merely *depends on*
  the ArchiveXL ⇄ TweakXL pair, was reported as being in a cycle, sending you hunting for
  one that doesn't exist. Cycle membership now comes from the real cycle list; the rest
  are `[waits on a loop]`.
- **The matrix counts mods, not edges.** Its caption promises "mods that live only in the
  column's list", but the cell was counting dependency *relationships* — two dependents
  each needing the same three mods read as 6. Now it counts distinct required mods (3),
  with the tooltip naming them.

**Self-sufficiency is per-list, not global.** A dependency only crosses a boundary when
the required mod is *not* also in the dependent's own list. A list holding its own copy is
self-sufficient however many other lists happen to duplicate it — otherwise every shared
foundation would light up the whole matrix.

**Graph layout** is longest-path layering (foundations on the top row, install order
reading downward) with two barycentre sweeps to cut crossings. Cycles are survived by an
on-stack guard that treats a re-entered node as depth 0 rather than recursing forever.
De-hairballing is a "Foundations only" toggle that hides nodes nothing depends on — simpler
and more predictable than the leaf-collapsing badge originally sketched, and it answers the
same question.
**Cycle detection is a real feature, not a formality** — mutual-requirement pairs are
common on Nexus and break any naive "install order" the graph implies; they get flagged
explicitly rather than producing a broken layering. Missing nodes are synthesised from dep
records so a mod you've never added still appears.

Also emitted from the same structure: **suggested install order** (topological sort, cycles
broken by dependent count), as a copyable text list. Cheap, and it's what most people
actually want out of "audit my dependencies".

---

## 8. Build order

| Phase | Deliverable | Why here |
|---|---|---|
| **0** | ✅ **DONE.** Endpoint identified from the bundle; resolve confirmed returning a signed CDN URL on a real free account; subfolder writes confirmed; CDN domain corrected. | Everything rested on this. |
| **1** | ✅ **DONE** (`Nexus_Curator.user.js`). `parseModPage()` → `Mod` record from all three dep sources. Verified live against 4 mods covering: notes-populated, notes-empty, file-level-only, and no-deps. Off-site/DLC code paths written but **not yet seen in the wild** — see §1a. | Pure functions, testable in console |
| **2** | ✅ **DONE.** Store + schema + migration + export/import (15 passing tests) + the dock shell with page-contextual detection, persisted collapse, and live log. | |
| **3** | ✅ **DONE.** Polite fetch layer, modal primitive, list picker, "Add to list" (resolves the real record), library overlay with games/lists/mods panes and full list CRUD. | First point it's usable at all |
| **4** | ✅ **DONE.** Bucketing, all five shapes, live-retiring rows, per-row and bulk targets, opt-in one-level recursion. Verified against 7 synthetic records. | |
| **5** | ✅ **BUILT** (24 passing tests). Resolver, paths, Info file, two-pass refresh/diff, serial gated queue, crash-safe resume, pause/skip/cancel, failure tray. **The first real transfer is still unrun** — see §6a. | The big one |
| **6** | ✅ **DONE** (25 tests). One `buildDepGraph()` feeding four views: foundations, cross-list matrix, layered SVG graph, install order. Cycle detection throughout. | Each ships independently |
| **7** | ✅ **DONE.** Library keyboard nav, per-list settings (name/note/optionals), list-level download rollups, mod-level ✓/⬆/· badges. SVG export landed in Phase 6. | |

Phases 3–7 each end at something usable, so the thing is testable against a real library
throughout rather than only at the end.

## 9. Risks

- ~~Phase 0 fails~~ — retired, it passed. **Nexus changing the download mint** remains:
  mitigated by the resolver being one function behind one interface, with selectors in a
  single `SEL` map at the top of the script.
- **Signed CDN URLs are user-bound** (`user_id`, `h`, `expires`). They cannot be shared,
  cached, or resolved ahead of the queue — and an exported list must therefore contain mod
  URLs only, never resolved links. Worth stating because it's an easy mistake to make in
  the export feature.
- **The new Nexus frontend replaces mod pages.** Partially rolled out already. All
  scraping is centralised in `parseModPage()`; a rewrite is one function, and the embedded
  JSON custom-elements are likely to outlive the surrounding HTML.
- **Free-tier throughput.** Not fixable, only communicable — the panel states a measured
  ETA before the queue starts, and the queue is resumable so a long run is interruptible.
- **A gated queue is unattended by nature**, which makes the failure tray and crash-safe
  resume load-bearing rather than polish. They're in Phase 5, not Phase 7.
- **Terms of service.** Bulk automated downloading is worth a look at the current Nexus
  ToS before leaning on this hard; the rate limiting in §1 is the good-faith posture, and
  premium is where this kind of automation is explicitly sanctioned via their API.

## 10. Settled, and still open

All settled:

- Free account — the slow path is the engine.
- Tampermonkey — native subfolders.
- Main Files only — optionals recorded, toggle off.
- **One combined `Info/<Mod Name>.txt` per mod**, with a labelled section per file.
- **All games** — `@match *://*.nexusmods.com/*`, no per-game allowlist.
