# AI instructions -- working on a Local Gallery library

You are an AI assistant, and the folder this file sits in belongs to a
**Local Gallery** library: a media collection that its owner browses in the
Local Gallery Mac app. You are here to help organize it: put Sets into
**Tags**, sort them by what they show, merge in new downloads, and keep a
written record of what every Set holds so the next job does not start from
nothing. This file is everything you need to do that safely. Read all of it
before changing anything; it is written so that you never have to guess. If
other instructions you were given (a skill, a prompt) disagree with this file
about this library, this file wins.

Where things are, from the library folder (the folder that holds the hidden
`.local-gallery/` folder):

- `.local-gallery/AI-INSTRUCTIONS.md` -- this file.
- `.local-gallery/ai/lg.py` -- the tool that makes every change.
- `.local-gallery/ai/models/<Model>/` -- what AI assistants keep about each
  Model: contact sheets of its Sets, its set guide, and notes. See "What is
  kept about each Model".
- `.local-gallery/ai/work/` -- your scratch space for one job (plans, drafts,
  scores, staging). One subfolder per job; delete it when the job is done.

**Nothing for you lives outside `.local-gallery/`, and nothing you make may
go there either**: no notes, guides, temp folders or bucket folders in the
library root or inside a Model or Set. The app shows every folder there as a
Model or Set, and every `.md` file in a Set as one of its files.

> Local Gallery writes this file each time it opens the library, from
> `library-ai/AI-INSTRUCTIONS.md` in the app's source. Edits made here are
> replaced.

## The six rules

1. **Change the library's organization only through `lg.py`.** Never edit any
   file in `.local-gallery/` by hand, never write those files from your own
   scripts, and never delete them. That includes the contact sheets, set
   guides and `index.json` files under `ai/models/` -- `lg.py` makes and
   updates those too. The only places you write yourself are `ai/work/` and a
   Model's `ai/models/<Model>/notes/`. `lg.py` checks every change, writes all
   of it or none of it, keeps a backup, logs what it did, and works with the
   app open or closed. Your own edits would do none of that, and the app could
   write over them.
2. **Never move, rename or delete folders with `mv`, `os.rename`, `rm` or
   similar** unless you then tell `lg.py` (`moved`), and prefer letting
   `lg.py` do it (`move`). Everything the app knows about a folder (its Tags,
   score, thumbnail, settings, contact sheets, set guide entry) is filed under
   its path; a folder moved behind the app's back loses all of it until the
   app is told. To remove a folder, use `trash` (it goes to the app's own
   Trash, from which the user can put it back). Files *inside* a Set are yours
   to manage when the user asks, but tell `lg.py` about any Set or Model
   folder you rename.
3. **Dry-run first, then write.** Every changing command takes `--dry-run`.
   For anything bigger than a handful of folders, build a plan file, run
   `apply plan.json --dry-run`, read what it says, then run it for real.
4. **Ask the user before anything that removes or hides**: `delete-tag`,
   `trash`, `storage`, `hide`, `flag ... hidden`, `remove` across many
   folders, `rename-tag`, or `undo --force`. Adding folders to Tags, making
   new Tags, making contact sheets and writing set guide entries are fine
   whenever the job calls for them.
5. **Read what `lg.py` answers.** It starts with `Done.` or `Refused:`. A
   refusal means nothing was written; it says why and usually what to do
   instead. Never work around a refusal by editing files yourself. If it
   answers `WARNING`, stop and tell the user.
6. **Leave the record better than you found it.** Any job that looks at Sets
   ends with their contact sheets and set guide entries current (see "Keeping
   a Model's record current"). Looking at media is the slow, expensive part
   of every job; writing down what you saw is what makes the next job fast.

## Running it

From the library folder:

```bash
python3 .local-gallery/ai/lg.py status
```

It needs only Python 3.8+ and finds the library from its own location, so it
works on the Mac and in a sandbox where the library folder is mounted (run it
by its full path there). If it ever cannot find the library, pass
`--library <path to the library folder>`. Contact sheets are made by the
Local Gallery app, which `lg.py` asks; you never need an imaging library.

Always start with:

```bash
python3 .local-gallery/ai/lg.py status     # is the app open, is anything waiting
python3 .local-gallery/ai/lg.py tags       # every Tag that exists
python3 .local-gallery/ai/lg.py knowledge  # which Models have sheets and set guides
python3 .local-gallery/ai/lg.py --help     # every command
python3 .local-gallery/ai/lg.py <command> --help
python3 .local-gallery/ai/lg.py guide      # prints this file
```

Below, `lg` means `python3 .local-gallery/ai/lg.py`.

## The library's shape

It is fixed, exactly three levels deep:

- **Root** -- the library folder.
- **Models** -- the folders directly in the root. Each one is a person.
- **Sets** -- the folders directly in a Model. A photo shoot, a post, a
  compilation.
- **Files** -- images, videos and text (`.md`), directly in a Set.

Only folders go in the root and in Models; only files go in Sets; nothing goes
deeper. A folder is named by its path from the root: `Some Model` is a Model,
`Some Model/230506 - Beach day` is a Set.

Folders the app keeps for itself, never to be touched or tagged:
`.local-gallery/` (all its data), `__LOCAL_GALLERY_TRASH__/` (its Trash) and
`__LOCAL_GALLERY_MUSIC__/` (its music player). Anything starting with `.` is
ignored.

**ALT folders.** A folder named `Name -- Label` next to a folder `Name` (for
example `Some Model -- VHS` beside `Some Model`) is an *ALT*: the same
collection in another form. The app shows only one of them and keeps all
their Tags on the plain name. `lg.py` does this for you: give it either path
and it files the Tag under `Name`, and says so. Contact sheets and set guides
are made from the plain-named (Original) folder only.

**Names.** The app hides ` - ` (space, hyphen, space) and everything before
it in a folder's name, so `230506-Some Model-000116 - Beach day` shows as
`Beach day`; libraries often keep dates and numbers before it. Paths you pass
to `lg.py` are matched to the real names on disk, so letter case does not have
to be exact, but the rest does; `lg find` helps you get it right.

## Tags: what they are

A **Tag** is a named collection of folders. It shows in the app as a card that
opens like a folder. Everything about Tags:

- **Names are lowercase and library-wide.** There is one Tag per name, wherever
  its folders are. `lg.py` lowercases what you give it. A name cannot contain a
  comma (the app uses commas to separate Tag names when they are typed), and
  names like `__this__` are reserved.
- **A Tag holds Models or Sets** (any mix), **and other Tags.** A Tag inside a
  Tag is a sub-collection (`nest`). Loops are refused.
- **Where its card shows** is worked out, never stored: in the deepest folder
  that holds everything it has. A Tag holding Sets of one Model shows inside
  that Model; one holding Sets of several Models, or Models, shows in the root.
  A Tag that holds nothing that exists is not shown at all (its settings are
  kept). `tags` and `tag NAME` print where each card is.
- **Exclusive** (`flag TAG exclusive`): its folders *leave* their normal place
  and are seen only inside the Tag. Without it, a folder shows both in its
  Model and in the Tag. Exclusive is how Sets are filed away into a category.
  With a media type hidden (below), Exclusive takes out only the files the
  Tag shows, not whole folders: a "videos only" Exclusive Tag takes the
  videos out of its Sets and leaves the images where they were.
- **Every Tag is held to its place.** This is not a setting; it is read off
  what the Tag holds. A Tag whose content is all Sets of one Model takes Sets
  from that Model only. A Tag whose content is all Models takes Models only. A
  Tag that is empty, or already holds Sets of several Models, or a mix, takes
  anything -- so a new Tag is held from the first thing put in it. A Tag
  inside another Tag is also held by that Tag's place. Adding something that
  does not fit is refused.
- **Use anywhere** (`flag TAG use-anywhere`, off by default): frees the Tag
  to take Sets and Models from anywhere in the library. It passes down to the
  Tags inside it. Only set it when the user wants a Tag shared across Models
  (a library-wide category); per-Model categories never need it. A new Tag
  meant for several Models needs it before its first Sets go in: put the
  `flag` op ahead of the `add` ops in the plan.
- **Hidden** (`flag TAG hidden`): the Tag and its content are hidden unless the
  user reveals hidden items. Hidden passes down to Tags inside it.
- **Hide media types** (`hide-media TAG videos`): inside this Tag those files
  are not shown (types: `images`, `videos`, `text`; `none` shows all again).
  Useful for "videos only" or "images only" views of Sets.
- **There are no contents rules any more.** Tag the folders themselves with
  `add` (to tag all of a Model's Sets, list them with `sets MODEL --json`). An
  old library may still have a rule the app has not yet turned into ordinary
  tags; `contents SOURCE TAG --off` takes one away.
- **Tag storage** (`:tag-storage`): a special Tag that holds only Tags, always
  Exclusive, used to tuck away Tags that would crowd the root. `nest TAG
  :tag-storage`.

Marks on folders that are not Tags but are kept in the same place:

- **Favorite** (`favorite PATH`) -- shows in Favorites.
- **Hidden** (`hide PATH`) -- the folder is hidden unless revealed.
- **Storage** (`storage PATH`) -- the folder is packed away: the app does not
  load it at all, only shows a card. Done by the app (it rebuilds the library).
- **Trash** (`trash PATH`) -- moved into the app's Trash, from which the user
  can put it back. Done by the app.

The cards **All tags, All Models, All Sets, Certified fresh, Favorites,
Untagged** and each Model's **Images / Videos / Text** are views the app builds
by itself. They are not Tags and cannot be changed.

## Follow the library's own conventions

Every library has its own habits. Before making anything new, run `lg tags`
(and `lg tags --json` for exact names) and look for them:

- **Prefixes.** Tags about one Model often start with the Model's name or a
  short form of it, so they group together when sorted.
- **Numbers for order.** The app sorts Tags by name, so families of Tags are
  often numbered (`xx 01 - ...`, `xx 02 - ...`).
- **Families inside a parent.** A set of related Tags is often nested inside
  one parent Tag (a "scale" or "categories" Tag), and the parent may be
  Exclusive.
- **Flags.** Note which Tags are Use anywhere, Exclusive or hide a media type,
  and give new Tags of the same kind the same flags. `lg tags` shows what
  each Tag is held to ("takes Sets from X only").
- **Exact spelling.** Existing names sometimes carry double spaces or unusual
  punctuation. Copy names from `lg tags --json`; never retype them. `lg check`
  lists names that differ only in spaces or punctuation.
- **The set guide.** A Model's guide may already have fields for judgments
  the user cares about (say, whether a Set belongs in one particular Tag).
  Read its field list before deciding anything about that Model.

When you make a new family, propose names in the library's style and tell the
user what you chose, or ask them for a prefix.

## What is kept about each Model

Looking at a Set's media is the slow, costly part of any job. So whatever an
AI assistant sees is written down once and kept, in
`.local-gallery/ai/models/<Model>/`, for every later job to read first:

| Kept | What it is |
|---|---|
| `sheets/<Set>.jpg` | The Set's **contact sheet**: one image showing every photo of the Set in file-name order, each labelled p1, p2..., and each video as a row of six frames labelled v1, v2... with their timestamps. A Set with many files gets several (`<Set> (sheet 1 of 2).jpg`...). Some older sheets are `.png`. |
| `set-guide.md` | The **set guide**: one written entry per Set, made from looking at every sheet of it. Its photo numbers are the sheets' labels. |
| `index.json` | What each Set's files were when its sheets were made and when it was described, so `lg.py` can tell which Sets are new or have changed since. |
| `notes/` | Anything else worth keeping about the Model, in files you write yourself: decision lists from a sorting job (one row per Set: the call and the reason), what a Tag means and where its edges are, the user's answers to questions you asked. Add a line to `notes/README.md` saying what each file is. |
| `history/` | The set guide as it was before each change (kept by `lg.py`). |

None of it is shown in the app; it is for AI assistants. Never write the
sheets, the guide's entries or the index by hand. Moving or renaming a Set or
Model with `lg move` / `lg moved` carries its sheets and guide entry along.

### Contact sheets: the app makes them, you check first

**Collages (contact sheets) are made by the Local Gallery app, not by you.**
It draws one in about a second, from its own copy of every picture and its
own video tools; drawing them yourself costs far more time and effort and
gives nothing better. So:

1. **Always check first.** `lg knowledge "<Model>"` says which Sets already
   have current sheets. Sheets made earlier -- by the app, by the user from
   the app's menu, or by anyone -- stay current until the Set's files change.
   Never make a sheet that is already there and current.
2. **Ask the app for only what is missing or out of date:** `lg sheets
   "<Model>"`. It works out which Sets need one, asks the open app to make
   them, and waits (up to `--seconds`, 150 by default) for the answer. If it
   is still going when the wait ends, the app carries on in the background
   and saves each sheet as it goes: run `lg knowledge "<Model>"` a minute
   later to see how far it got. Never ask again while a request is waiting
   (`lg sheets` refuses to; `lg requests` shows it).
3. **If Local Gallery is not open**, `lg sheets` says so: ask the user to
   open it (and unlock it), then run it again. Meanwhile, work on whatever
   already has sheets.
4. **Only if the user says they cannot open the app**, `lg sheets "<Model>"
   --here` draws them with `lg.py` itself (it needs Pillow, `python3 -m pip
   install --user pillow`, and is much slower). Never build collages with
   scripts of your own.

`lg sheets "<Model>" "<Set>" --redo` asks for one Set's sheet again, current
or not; use it only when a sheet is damaged or unreadable. The user can make
sheets from the app's menu too (a Set's Folder options -> **Create
collage**, a Model's -> **Create collages for all sets**), which redraws
them all; if the user says they did, check `lg knowledge` and go straight to
describing.

### The set guide

`set-guide.md` starts with a title, a status line `lg.py` keeps (`> Kept by
lg.py: ...`), a few lines about the Model, and the **field list**. Then one
entry per Set, in Set order under year headings:

```markdown
### 000001 · Lacy

`190501-000001 - Lacy` · 2019-05-01 · 11 photos

- **Concept:** None. Plain lingerie posing on a bed; relaxed, not a seduction scene.
- **Setting:** Bedroom. White rumpled duvet, black metal headboard; bright window light behind her.
- **Outfit:** Matching black lace set: balconette bra, garter belt with suspenders, sheer panties, ribbed thigh-highs. Stays on throughout.
- **Hair & accessories:** Shoulder-length wavy red hair, loose. Natural makeup with eyeliner.
- **Body:** Slim; flat stomach.
- **Poses & body language:** Sitting up on the bed, hands in hair (p1-p3); lying on her side, rear toward camera (p4); ... Steady eye contact; calm.
- **Nudity:** None. Rear partly bare around the garter straps in back views.
- **Camera:** Photographer-shot, natural daylight, color.
```

The heading and the line in backticks (folder name, date, counts) are made by
`lg.py`; you write the field lines. The standard fields are **Concept,
Setting, Outfit, Hair & accessories, Body, Poses & body language, Nudity,
Camera**, and every entry must have them. A guide can add **its own fields**
for a judgment worth keeping for every Set -- whether a Set belongs in a
particular Tag, and why. Those are optional per entry. Add one with
`lg field MODEL "Name" "what it records"`.

What makes an entry useful, so a later job can sort or tag the Set without
opening it:

- **Written from looking at every sheet of the Set**, never from its title
  (titles hint and routinely mislead) and never from memory.
- **Concrete and complete.** Every garment and prop, in order of appearance;
  colors and materials; the room and what is in the frame; hair, makeup,
  jewelry, glasses. What changes during the Set, with photo numbers
  (`p4-p7`, `v1 0:12`).
- **Poses shot by shot**, with photo numbers, then the mood in a few words.
- **Clinical, plain wording.** Libraries may hold explicit material; describe
  what is visible (how much is shown, where) without commentary or
  euphemism.
- **Say what you cannot tell.** "Unclear from stills", "possibly", "looks
  like". Stills cannot show motion: describe what the frames show.
- **One judgment per own-field line**, with the reason: "In: lingerie around
  the bedroom." / "Out: bikini, not lingerie."

### Keeping a Model's record current

Do this for every Model a job touches, before the job's real work (rule 6),
and whenever the user adds Sets:

1. `lg knowledge "<Model>"` -- how many Sets have current sheets and entries,
   which are new, which changed since (files added, replaced or upgraded), and
   which entries describe folders that are gone.
2. If any Set lacks a current sheet, `lg sheets "<Model>"` -- the app makes
   exactly those (see "Contact sheets" above). Wait for it, checking with `lg
   knowledge "<Model>"`; describe Sets that already have sheets meanwhile.
3. `lg describe "<Model>"` -- lists the next Sets that need an entry (`--next
   N`, default 10), with their sheet files and the entry format. A Set whose
   entry is out of date has changed files: read its old entry with `lg entry
   "<Model>/<Set>"`, look at its new sheets, and write the entry again whole.
4. **Look at every sheet** of each listed Set (open the image files; see
   "Looking at images" below) and write its entry into a draft file in
   `ai/work/<job>/`, the moment you have looked -- never batch it up to write
   from memory later. The draft holds one block per Set:

   ```
   === Some Model/190501-000001 - Lacy
   - **Concept:** ...
   - **Setting:** ...
   ```

5. Every ten Sets or so, `lg describe "<Model>" --write draft.md --dry-run`,
   then the same without `--dry-run`. It refuses the whole file if an entry
   is missing a required field, mentions a photo number the Set does not have
   (p40 in an 11-photo Set), or names a Set that is not there; fix and repeat.
   Then start a new draft for the next Sets.
6. Repeat 3-5 until `lg describe` says everything is described, and finish
   with `lg knowledge "<Model>"`.

A guide for a Model that has none is started by the first `--write`. Sheets
or a guide made before (or outside `.local-gallery/`) are taken in with `lg
adopt "<Model>" --guide FILE --sheets DIR` (`--move` to move rather than
copy), which also marks everything found as current; then ask the user before
removing the old copies, and never leave a guide inside a Model folder.

To **add a judgment to every Set** (for a new Tag, or a question the user
keeps asking): `lg field "<Model>" "Name" "what it records"`, then write a
draft with just that field for each Set and `lg describe "<Model>" --write
draft.md --amend` -- it sets only the fields given and leaves the rest of each
entry alone.

### Using the record

- **Read the guide first.** For most questions -- which Sets have a costume,
  which are outdoors, which match the user's example -- the guide answers
  without opening anything. `lg entry "<Model>/<Set>"` prints one entry and
  its sheet files.
- **Then the sheets** for anything the guide does not settle: a borderline
  call, a detail nobody wrote down. Only open the Set's own files when a
  sheet is too small to tell.
- **Write back what you learn.** If a job turned on a detail the guide lacked,
  add it to those entries (or as a field) before you finish.

## Looking at images

- Open sheets as image files with whatever your environment uses to view an
  image. Some sandboxes need a file staged or attached first; do that a few
  at a time (about a dozen staged, about three viewed per turn), since
  viewing many at once can fail or drop images from your context.
- **Write down what you saw immediately** (an entry, a score, a call) after
  each sheet. Images can drop out of your context a few turns later; never
  decide or describe from memory.
- When a sheet is too small for a call, open the few photos in question
  from the Set itself rather than making anything new. Only for a motion in
  a video that six frames cannot settle, take more frames from a short window
  into `ai/work/<job>/`, look, and delete them with the job.
- Keep reports and notes clinical. If anything suggests a person depicted
  could be under 18, stop and tell the user.

## Jobs

Every job starts the same way: `lg status`, `lg tags`, `lg knowledge`, and
bringing the record of each Model involved up to date (above).

### Categorize Sets into Tags

The user wants Sets put into Tags: existing ones ("put the beach sets in
`xx beach`"), new ones ("make Tags for her outfits"), or "tag everything
untagged".

1. `lg tags`, `lg tag "<name>" --json` for each Tag in play, `lg sets
   "<Model>" --json` (or `--untagged`). Note what each Tag is held to and
   which are Exclusive.
2. **Agree the Tags.** For new ones, propose names in the library's style and
   whether they are Exclusive. Ask once, then go. Never make a Tag whose name
   differs from an existing one only in spaces or punctuation.
3. **Decide each Set from its guide entry**, checking its sheets where the
   entry does not settle it. A Set can be in several Tags unless the user says
   the Tags are alternatives. Write each call to a decision file as you make
   it (`ai/work/<job>/calls.tsv`: Set, Tag, yes/no, reason).
4. **One plan** for the whole job: an `add` per Tag listing all its Sets,
   `flag` for new Tags as agreed, `nest` new Tags under a parent if they form
   a family. `apply --dry-run`, read every line, `apply`.
5. **Keep the judgment.** If the Tag's rule is a judgment (not obvious from
   the guide), copy the decision file into `ai/models/<Model>/notes/` with a
   line in its README saying what the Tag means and where its edges are, or
   add a field to the guide for it. The next time Sets are added, the call is
   then made the same way.
6. `lg tag "<each Tag>"` to confirm, then report: each Tag, how many Sets,
   and the judgment calls.

### Sort Sets into confidence buckets

The user names a quality only looking can answer (a pose, a setting, an
outfit, a mood) and wants the Sets sorted by how sure you are that each Set
has it, often with a few example Sets.

- **The unit is the Set, judged by its media.** By default a Set takes the
  bucket of its strongest item (one clear video, or a clear run of photos,
  qualifies the whole Set); if the user cares about proportion ("mostly"),
  score the share of items instead. Say which rule you used.
- **The user's examples are the rubric**: positives, near misses ("very
  close, but not quite") and negatives. A near miss marks the boundary; give
  it its own bucket.
- **Buckets are Tags, never folders**: numbered so they sort (`<prefix> 1
  definite`, `<prefix> 2 likely`, `<prefix> 3 close, <what the near miss
  is>`, `<prefix> 4 maybe`, `<prefix> 5 unlikely`, `<prefix> 6 no`), every Set
  in exactly one, all nested in a parent Tag (`<prefix> scale`). Use the
  style of any scale the library already has. `use-anywhere` only when the
  buckets take Sets of several Models (flag them before adding). Ask whether
  to make them Exclusive (that files the Sets out of their Model into the
  buckets).
- **Stills cannot show motion.** A motion that fits but cannot be confirmed
  from frames goes to "likely", not "definite"; more frames from a short
  window can settle it.

Steps:

1. Bring each Model's record current. Read the guides: many Sets can be
   placed, or ruled out, from their entries alone.
2. **First pass.** For every Set not settled by its entry, look at its sheets
   and score it 0-10 the moment you have looked, appending `Set<TAB>score<TAB>
   note` to `ai/work/<job>/scores.tsv` (add `?` when unsure).
3. **Calibrate.** Look at the user's examples and a few of your top and
   boundary scores together, and pin down what each score means. Watch for a
   recurring look-alike (same framing, not the thing asked for); give it its
   own verdict and a lower bucket, and mention it in the report.
4. **Second pass.** Look again at every `?` Set, with larger frames if
   needed, and give each a final verdict.
5. **Plan**: one `add` per bucket Tag, then `nest` each under the parent and
   any agreed flags. Check that every Set appears exactly once and the user's
   examples land where they said. `apply --dry-run`, `apply`.
6. **Keep it.** Copy `scores.tsv` (with the final bucket per Set) into
   `ai/models/<Model>/notes/<prefix>-calls.tsv`, describe the criterion and the
   bucket edges in `notes/README.md`, and, if the user will want it again,
   add a guide field with the call per Set.
7. **Report**: a short table (bucket, number of Sets, what is in it), then the
   judgment calls: look-alikes, the aggregation rule, what stills could not
   confirm. `lg undo` reverses the tagging.

### Merge new downloads into the library

The user hands over new media (downloads from a site, a forum thread, an old
archive) to merge with what is already there: upgrade low-quality files, add
what is missing, drop what is redundant, name and group it like the rest.

- **Never touch the originals.** Copy the input into
  `ai/work/<job>/staging/` (`rsync -a --exclude .DS_Store SRC/ DEST/`), on the
  same disk so later moves are instant, and work only there. Staging never
  goes in the library root or a Model: the app would show it.
- **Identify by content, never by name.** Names, dates and post numbers are
  often wrong. Fingerprint every file: images by a small grayscale vector
  (32x32 after EXIF orientation) plus a tiny color thumbnail; videos by frames
  sampled every half second; md5 only as a bonus. Matches score near 1.0;
  different photos of one shoot rarely pass 0.8. Confirm aspect ratio agrees.
  Assign one-to-one, and look for duplicates within the library and within
  the new batch too.
- **Keep the best copy**: highest resolution, then most detail (less lossy
  format, full color, higher bitrate), then largest file. A re-encoded copy
  loses to an original. A better new file takes the old one's exact name and
  place (with its own extension). A photo lives in one Set: its original,
  most complete one.
- **Group and name new Sets the way the library already does.** Look at the
  Model's existing Set names first and follow them exactly (a common pattern:
  `yymmdd-<Model>-<NNNNNN> - <Title>` for the folder and
  `<folder name>_<NN>.<ext>` for files, `NN` zero-padded in Set order). When
  grouping is uncertain, do not combine; ask.
- **Plan, then execute, then verify.** Write a plan of every copy, move,
  delete and rename first; check every input file is accounted for once and
  nothing overwrites anything. Moving a *new* Set folder into a Model needs
  nothing more. Renaming or moving an *existing* Set or Model goes through `lg
  move` (or is recorded at once with `lg moved`). When two existing Sets are
  combined, the folder that stays keeps its Tags: add the other's Tags to it
  first (`lg show` both). Removing a whole existing Set is `lg trash`, after
  asking.
- **Then the record.** `lg knowledge "<Model>"`, then `lg sheets` (the app
  makes sheets for just the new and changed Sets), `lg describe` for them,
  and offer to tag them.
- Report what is now in the library (upgraded, added, dropped), the judgment
  calls, and where the untouched originals are; the user deletes those.

### Smaller jobs

**Find what still needs Tags.** `lg sets "<Model>" --untagged`, or across the
library `lg sets --untagged --json`.

**Merge Tag A into Tag B.** `lg tag A --json` for its folders; `add` them to B
(and `nest` A's sub-Tags into B); then, with the user's OK, `delete-tag A` in a
separate run.

**After renaming or deleting a Tag**, look for it by name in the set guides'
field lists (`lg field "<Model>" "<field>" "<new text>" --update`) and in
`ai/models/*/notes/` (yours to edit), so the record keeps naming it right.

**Rename a Set or Model folder** (naming fixes, merges): `lg move OLD NEW`. It
moves the folder on disk, carries its Tags, contact sheets and guide entry at
once, and asks the app to carry everything else (score, thumbnail, settings).
If a script of yours already renamed folders, record each with `lg moved OLD
NEW` (or a plan of `moved` changes) *right away*, before anything else.

**Remove a Set the user doesn't want.** With their OK: `lg trash PATH`. Never
`rm`.

**Fix a mistake.** `lg undo` puts the tags file back as it was before the last
`lg.py` change (run it again to go further back). It refuses if the app or
the user changed Tags since, because undoing would throw that away too; then
reverse the mistake with the opposite command instead (`remove` for `add`...).
Requests the app carried out (renames, deletes, Trash, Storage) and folder
moves are not undone by `undo`; reverse those with the opposite command. A set
guide's previous versions are in `ai/models/<Model>/history/` (gzip); ask the
user before putting one back.

## Command reference

### Reading

```bash
lg status                               # app open? waiting requests? last change
lg tags [--sort count] [--json]         # every Tag: size, flags, parent, card place
lg tag "some tag" [--json]              # one Tag: every folder (and how), sub-Tags
lg models [--json]                      # every Model with its Tags
lg sets "Some Model" [--json]           # a Model's Sets with their Tags
lg sets "Some Model" --untagged         # ...only those with no Tags yet
lg sets --tagged-with "some tag"        # Sets (any Model) in a Tag
lg sets "Some Model" --counts           # with image/video/text counts
lg show "Some Model/230506 - Beach day" # one folder: Tags, marks, score, files
lg find "beach"                         # Models, Sets and Tags whose names contain it
lg export --out /tmp/library.json       # everything at once, for your own analysis
lg check                                # problems: loops, near-duplicate names
lg journal                              # what lg.py has changed so far
lg requests                             # what is waiting for the app, what it finished
lg knowledge ["Some Model"] [--json]    # sheets and guide entries: current, new, changed
lg entry "Some Model/Some Set" [--json] # a Set's guide entry and sheet files
```

`--json` gives machine-readable output for reading commands. Use it rather than
parsing the human text.

### The record (contact sheets and set guides)

```bash
lg sheets "Some Model"                          # the app makes sheets for Sets that need them
lg sheets "Some Model" "Some Set" --redo        # ask the app to remake one (damaged sheet)
lg sheets "Some Model" --here                   # draw them yourself: only if the app can't be opened
lg describe "Some Model" [--next 10] [--json]   # what to describe next, with sheet files
lg describe "Some Model" --write draft.md       # add or replace entries (--dry-run first)
lg describe "Some Model" --write draft.md --amend   # set only the fields given
lg field "Some Model" "Name" "what it records"  # a new field for this Model's guide
lg field "Some Model" "Name" "new text" --update   # change what a field says it records
lg adopt "Some Model" --guide FILE --sheets DIR [--move]   # take in sheets/guide made before
```

### Changing the library

```bash
lg add "beach" "Model/Set A" "Model/Set B"      # into a Tag (made if new)
lg add "beach" --paths-from sets.txt            # one path per line, # comments ok
lg remove "beach" "Model/Set A"
lg set-tags "Model/Set A" "beach" "summer"      # exactly these Tags (marks untouched)
lg set-tags "Model/Set A"                        # no Tags at all
lg nest "xx beach" "xx albums"                  # Tag inside Tag
lg unnest "xx beach" "xx albums"
lg nest "some source" :tag-storage
lg flag "xx beach" exclusive                    # --off to clear; flags: exclusive,
lg flag "xx beach" use-anywhere                 #   use-anywhere, hidden
lg hide-media "xx videos" images text           # 'none' shows everything again
lg favorite "Model/Set A"                       # --off to unmark
lg hide "Model/Set A"                           # --off to unhide   (ask first)
lg move "Model/Old name" "Model/New name"       # rename or move a Model or Set on disk
lg moved "Model/Old name" "Model/New name"      # it was already moved; follow it
lg rename-tag "old" "new"                       # (ask first; the app finishes it)
lg delete-tag "old"                             # no folder is touched (ask first)
lg trash "Model/Set A"                          # into the app's Trash (ask first)
lg storage "Model/Set A"                        # --off to take out (ask first)
lg undo                                         # put back the tags file from before the last change
```

Options every changing command takes:

- `--dry-run` -- check everything and print what would happen; write nothing.
- `--skip-refused` -- when a Tag refuses some folders (say, a Tag held to one
  Model and a Set from another Model), skip those and do the rest, listing them.
  Without it, one refusal stops the whole change.
- `--new` -- make a new Tag even though its name differs from an existing one
  only in spaces or punctuation (normally refused, because it is almost always
  a typo of the existing Tag).
- `--no-wait` -- don't wait for the open app to confirm.

### Batches: the plan file

For any real categorizing job, write one plan and apply it once. It is checked
as a whole, and written all or nothing:

```json
{
  "ops": [
    {"op": "add", "tag": "xx beach", "paths": ["Some Model/230610 - ...", "Some Model/230701 - ..."]},
    {"op": "flag", "tag": "xx beach", "flag": "exclusive", "on": true},
    {"op": "nest", "tag": "xx beach", "parent": "xx albums"},
    {"op": "remove", "tag": "xx casual", "paths": ["Some Model/230610 - ..."]},
    {"op": "favorite", "paths": ["Some Model/230610 - ..."], "on": true}
  ]
}
```

```bash
lg apply plan.json --dry-run
lg apply plan.json
```

Every change in the plan has the same fields as its command: `add` / `remove`
(`tag`, `paths`), `set-tags` (`path`, `tags`), `nest` / `unnest` (`tag`,
`parent`), `flag` (`tag`, `flag`, `on`), `hide-media` (`tag`, `types`),
`favorite` / `hide` / `storage` (`paths`, `on`), `trash` (`paths`), `move` /
`moved` (`from`, `to`), `rename-tag` (`from`, `to`), `delete-tag` (`tag`).
Changes run in order, so a `flag` after the `add` that creates a Tag works. A
rename or delete of a Tag cannot share a plan with other changes to that Tag;
do it in a separate run, last.

## How changes reach the app

- `lg.py` writes Tags straight into `.local-gallery/tags.log.json`. **If the
  app is open**, it notices within about two seconds, loads the change in
  place, and `lg.py` waits and prints "Local Gallery has loaded the change."
  The app waits while the user is in the middle of something (a menu, a text
  field, the journal); `lg.py` says so, and the change lands right after. **If
  the app is closed or locked**, it reads the file when the library next
  opens. Either way the change is already saved the moment `lg.py` says
  `Done.`
- Some things only the app can finish: renaming and deleting Tags, Trash,
  Storage, and carrying a moved folder's other data. `lg.py` queues these in
  `.local-gallery/ai/requests/`; the open app does them within seconds and
  writes the answer to `ai/results/` (`lg requests` shows both). If the app is
  closed they wait, and run when it opens. While one is waiting, `lg.py`
  refuses changes that would collide with it and says so.
- If the user changes Tags in the app in the same moment `lg.py` writes, the
  app keeps the user's change, saves yours in `.local-gallery/ai/conflicts/`,
  and `lg.py` makes your change again on top and says so.
- `.local-gallery/ai/app-status.json` is the app saying it is open (rewritten
  every few seconds). `lg status` reads it for you.
- Contact sheets, set guides and notes are never read by the app; they need
  nothing from it.

## Working in a sandbox

- The library may be mounted at a path like `$HOME/mnt/<folder>`; run
  `python3 <that path>/.local-gallery/ai/lg.py`. Keep your own scripts and
  large intermediate files (fingerprints, logs) outside the user's folders
  where you can, and anything a later session needs to resume (manifests,
  scores, drafts) in `ai/work/<job>/`, since your own home folder may not
  survive the session.
- If each command is cut off after a few minutes, run long work as resumable
  steps: `lg sheets` stops waiting on time while the app carries on; write
  your own scripts the same way (skip work already done, run again).
- Deleting files may need a permission your environment asks for once;
  `lg.py` never needs it (it replaces files rather than deleting them).
- The user may make a backup zip of the library before a risky job; never
  touch it.

## What lives in `.local-gallery/` (read only)

You never need these, since `lg.py` reads them for you, but so you know:

| File | What it is |
|---|---|
| `tags.log.json` | Tags, Favorites, Hidden, Storage marks, Tag settings. Written only through `lg.py`. |
| `scores.log.json`, `score-history.log.json` | The user's scores for folders, and their history. Never change these. |
| `custom-thumbnails.log.json` | Picked thumbnails, crops, video frames. |
| `appearance-*.log.json`, `preferences.*.log.json`, `keyboard-configuration.log.json` | The user's settings. |
| `trash.log.json` | Where Trash items came from (for Put Back). |
| `daily-journals.log.json`, `variations.json`, `lock.log.json` | The user's journal, prompt composer, app lock. |
| `thumbs/`, `catalog/` | Caches. |
| `AI-INSTRUCTIONS.md` | This file. |
| `ai/` | The shared desk between AI tools and the app: `lg.py`, `models/` (what is kept about each Model), `work/` (your scratch space), `journal.jsonl` (every change), `backups/` (the tags file before each change), `requests/`, `results/`, `conflicts/`, `app-status.json`. |

The app never forgets metadata of a folder that disappears: it stays filed
under the old path in case the folder comes back. That is why `lg tag` may
list Sets "remembered, not on disk", and `lg knowledge` entries "described but
no longer on disk". Leave them; they do no harm.

If you are ever asked to do something `lg.py` has no command for (scores,
thumbnails, settings), do not edit the files: tell the user it has to be done
in the app.

## When something goes wrong

- `Refused: No folder ...` -- the path is wrong. It suggests close names; use
  `lg find`. Paths are `Model` or `Model/Set`, from the library root.
- `Refused: ... would be a new Tag, but ... already exists` -- you probably
  mistyped an existing Tag. Use the existing name (check `lg tags`), or `--new`
  if the user really wants a second one.
- `Refused: ... is held to its place` -- the Tag (or a Tag holding it) only
  takes Sets of one Model, or only Models. Pick the right Tag, or
  `--skip-refused` to do the rest. Set `use-anywhere` only if the user asks
  for that Tag to be shared.
- `Refused: The app has not finished ...` -- a request is waiting. Ask the
  user to open Local Gallery (and unlock it), then `lg requests`.
- `Refused: Another lg.py run is writing` -- wait a moment and repeat.
- `Refused: The tags file ... is not valid JSON` -- something wrote it badly.
  Stop and tell the user; the last good copies are in
  `.local-gallery/ai/backups/` (gzip) and the app keeps working from its own
  copy.
- `Refused: ... collages are made by Local Gallery, which is not open` -- ask
  the user to open the app (and unlock it), then run `lg sheets` again.
- `describe --write` refused -- it lists every entry that needs fixing
  (missing fields, photo numbers the Set does not have); nothing was written.
- `WARNING: after writing, these are not as expected` -- stop and tell the
  user what it lists.

When in doubt, `lg check`, `lg knowledge`, and ask the user.
