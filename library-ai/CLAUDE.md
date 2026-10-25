# CLAUDE.md -- working on this Local Gallery library

This folder is a **Local Gallery** library: Jo's media collection, browsed in
the Local Gallery Mac app. You are here to help organize it, usually by putting
Sets into **Tags**. This guide is everything you need to do that safely. Read
all of it before changing anything; it is written so that you never have to
guess.

> Local Gallery writes this file into the library each time it opens it, from
> `library-ai/CLAUDE.md` in the app's source. Edits made here are replaced.
> `.local-gallery/CLAUDE.md` points back here.

## The five rules

1. **Change the library's organization only through `lg.py`.** It lives at
   `.local-gallery/ai/lg.py`. Never edit any file in `.local-gallery/` by
   hand, never write those files from your own scripts, and never delete them.
   `lg.py` checks every change, writes all of it or none of it, keeps a backup,
   logs what it did, and works with the app open or closed. Your own edits
   would do none of that, and the app could write over them.
2. **Never move, rename or delete folders with `mv`, `os.rename`, `rm` or
   Finder-style tools** unless you then tell `lg.py` (`moved`), and prefer
   letting `lg.py` do it (`move`). Everything the app knows about a folder
   (its Tags, score, thumbnail, settings) is filed under its path; a folder
   moved behind the app's back loses all of it until the app is told. To
   remove a folder, use `trash` (it goes to the app's own Trash, from which Jo
   can put it back). Files *inside* a Set are yours to manage when Jo asks
   (the media-library-curator skill covers that), but tell `lg.py` about any
   Set folder you rename.
3. **Dry-run first, then write.** Every changing command takes `--dry-run`.
   For anything bigger than a handful of folders, build a plan file, run
   `apply plan.json --dry-run`, read what it says, then run it for real.
4. **Ask Jo before anything that removes or hides**: `delete-tag`, `trash`,
   `storage`, `hide`, `flag ... hidden`, `remove` across many folders,
   `rename-tag`, or `undo --force`. Adding folders to Tags and making new Tags
   is fine when Jo asked you to categorize.
5. **Read what `lg.py` answers.** It starts with `Done.` or `Refused:`. A
   refusal means nothing was written; it says why and usually what to do
   instead. Never work around a refusal by editing files yourself. If it
   answers `WARNING`, stop and tell Jo.

## Running it

From the library folder (the one that holds this file and `.local-gallery/`):

```bash
python3 .local-gallery/ai/lg.py status
```

It needs only Python 3.8+ and finds the library from its own location, so it
works on the Mac and in a sandbox where this folder is mounted (for example
`$HOME/mnt/<folder>/.local-gallery/ai/lg.py`). If it ever cannot find the
library, pass `--library <path to this folder>`.

Always start with:

```bash
python3 .local-gallery/ai/lg.py status     # is the app open, is anything waiting
python3 .local-gallery/ai/lg.py tags       # every Tag that exists
python3 .local-gallery/ai/lg.py --help     # every command
python3 .local-gallery/ai/lg.py <command> --help
```

Below, `lg` means `python3 .local-gallery/ai/lg.py`.

## The library's shape

It is fixed, exactly three levels deep:

- **Root** -- this folder.
- **Models** -- the folders directly in the root. Each one is a person.
- **Sets** -- the folders directly in a Model. A photo shoot, a post, a
  compilation.
- **Files** -- images, videos and text (`.md`), directly in a Set.

Only folders go in the root and in Models; only files go in Sets; nothing goes
deeper. A folder is named by its path from the root: `Madison Kate` is a
Model, `Madison Kate/230506-Madison Kate-000116 - Teddy bear` is a Set.

Folders the app keeps for itself, never to be touched or tagged:
`.local-gallery/` (all its data), `__LOCAL_GALLERY_TRASH__/` (its Trash) and
`__LOCAL_GALLERY_MUSIC__/` (its music player). Anything starting with `.` is
ignored.

**ALT folders.** A folder named `Name -- Label` next to a folder `Name` (for
example `Madison Kate -- VHS` beside `Madison Kate`) is an *ALT*: the same
collection in another form. The app shows only one of them and keeps all
their Tags on the plain name. `lg.py` does this for you: give it either path
and it files the Tag under `Name`, and says so.

**Names.** Set folders follow `yymmdd-<Model Name>-<NNNNNN> - <Title>`. The
app hides ` - ` and everything before it, so Jo sees only the title. Paths you
pass to `lg.py` are matched to the real names on disk, so letter case does not
have to be exact, but the rest does; `find` helps you get it right.

## Tags: what they are

A **Tag** is a named collection of folders. It shows in the app as a card that
opens like a folder. Everything about Tags:

- **Names are lowercase and library-wide.** There is one Tag per name, wherever
  its folders are. `lg.py` lowercases what you give it. A name cannot contain a
  comma, and names like `__this__` are reserved.
- **A Tag holds Models or Sets** (any mix), **and other Tags.** A Tag inside a
  Tag is a sub-collection (`nest`). Loops are refused.
- **Where its card shows** is worked out, never stored: in the deepest folder
  that holds everything it has. A Tag holding Sets of one Model shows inside
  that Model; one holding Sets of several Models, or Models, shows in the root.
  A Tag that holds nothing that exists is not shown at all (its settings are
  kept). `tags` and `tag NAME` print where each card is.
- **Exclusive** (`flag TAG exclusive`): its folders *leave* their normal place
  and are seen only inside the Tag. Without it, a folder shows both in its
  Model and in the Tag. Exclusive is how Jo files Sets away into a category.
  With a media type hidden (below), Exclusive takes out only the files the
  Tag shows, not whole folders: a "videos only" Exclusive Tag takes the
  videos out of its Sets and leaves the images where they were.
- **Model only** (`flag TAG model-only`): the Tag takes Sets from one Model
  only (the Model its content is already in). Most of Jo's per-Model Tags are
  this. Adding a Set from another Model is refused. It passes down to Tags put
  inside it.
- **Root only** (`flag TAG root-only`): the Tag takes Models only (Jo's
  source Tags like `onlyfans`, `patreon`, and the `tier 1`-`tier 6` Tags).
- **Hidden** (`flag TAG hidden`): the Tag and its content are hidden unless Jo
  reveals hidden items. Hidden passes down to Tags inside it.
- **Hide media types** (`hide-media TAG videos`): inside this Tag those files
  are not shown (types: `images`, `videos`, `text`; `none` shows all again).
  Jo uses it for "videos only" or "images only" views of Sets.
- **Contents rules** (`contents SOURCE TAG`): "every folder inside SOURCE is in
  TAG", kept as a rule, so folders added to SOURCE later are included too.
  SOURCE is a Model (its Sets), `:root` (every Model) or `tag:NAME` (that Tag's
  folders). A folder in a Tag only through a rule is taken out by turning the
  rule off, not with `remove`.
- **Tag storage** (`:tag-storage`): a special Tag that holds only Tags, always
  Exclusive, used to tuck away Tags that would crowd the root. `nest TAG
  :tag-storage`.

Marks on folders that are not Tags but are kept in the same place:

- **Favorite** (`favorite PATH`) -- shows in Favorites.
- **Hidden** (`hide PATH`) -- the folder is hidden unless revealed.
- **Storage** (`storage PATH`) -- the folder is packed away: the app does not
  load it at all, only shows a card. Done by the app (it rebuilds the library).
- **Trash** (`trash PATH`) -- moved into the app's Trash, from which Jo can put
  it back. Done by the app.

The cards **All tags, All Models, All Sets, Certified fresh, Favorites,
Untagged** and each Model's **Images / Videos / Text** are views the app builds
by itself. They are not Tags and cannot be changed.

## Jo's conventions (look before inventing)

Run `lg tags` and follow what is there. As of writing:

- Per-Model Tags are prefixed with the Model's name or a short form and are
  Model only: `hannah chrono`, `mk sets`, `selti videos`, `br 01 - oral`.
- Numbered prefixes keep Tags in order, since the app sorts by name:
  `br 01 - oral`, `br 02 - sex, riding`, ... A family of numbered Tags is
  usually put inside one parent Tag (`bearuby sex acts`, `eb scale`).
- Confidence scales: `eb  1 def`, `eb  2 likely`, `eb  3 close`, `eb 4 maybe`,
  `eb 5 unlikely`, `eb 6 no`, all inside `eb scale`, Exclusive. Some names have
  two spaces; that is in the data, use them exactly (`lg.py` warns about it).
- Library-wide Tags on Models: `tier 1`-`tier 6` inside `tiers`; sources
  (`onlyfans`, `patreon`, `reddit`, ...) inside `sources`. All Root only.
- `... - images`, `... - videos`, `... - gifs` Tags often have a media type
  hidden so they show one kind of file.

When you make a new family, ask Jo for the prefix, or propose one in the same
style, and say what you chose.

## Reading

```bash
lg status                               # app open? waiting requests? last change
lg tags [--sort count] [--json]         # every Tag: size, flags, parent, card place
lg tag "mk sets" [--json]               # one Tag: every folder (and how), sub-Tags, rules
lg models [--json]                      # every Model with its Tags
lg sets "Madison Kate" [--json]         # a Model's Sets with their Tags
lg sets "Madison Kate" --untagged       # ...only those with no Tags yet
lg sets --tagged-with "eb  3 close"     # Sets (any Model) in a Tag
lg sets "Selti" --counts                # with image/video/text counts
lg show "Selti/250731-Selti-000001 - Black Leather, Bare Chest, Stairway to Heaven"
lg find "teddy"                         # Models, Sets and Tags whose names contain it
lg export --out /tmp/library.json       # everything at once, for your own analysis
lg check                                # problems: loops, broken locks, near-duplicate names
lg journal                              # what lg.py has changed so far
lg requests                             # what is waiting for the app, what it finished
```

`--json` gives machine-readable output for reading commands. Use it rather than
parsing the human text.

## Changing

```bash
lg add "beach" "Model/Set A" "Model/Set B"      # into a Tag (made if new)
lg add "beach" --paths-from sets.txt            # one path per line, # comments ok
lg remove "beach" "Model/Set A"
lg set-tags "Model/Set A" "beach" "summer"      # exactly these Tags (marks untouched)
lg set-tags "Model/Set A"                        # no Tags at all
lg nest "mk beach" "mk albums"                  # Tag inside Tag
lg unnest "mk beach" "mk albums"
lg nest "patreon" :tag-storage
lg flag "mk beach" exclusive                    # --off to clear; flags: exclusive,
lg flag "mk beach" model-only                   #   model-only, root-only, hidden
lg hide-media "mk vids" images text             # 'none' shows everything again
lg contents "Hannah0w0" "hannah chrono"         # every Set of the Model, now and later
lg contents "tag:mk sets" "mk everything" --off
lg favorite "Model/Set A"                       # --off to unmark
lg hide "Model/Set A"                           # --off to unhide   (ask Jo first)
lg move "Model/Old name" "Model/New name"       # rename or move a Model or Set on disk
lg moved "Model/Old name" "Model/New name"      # it was already moved; follow it
lg rename-tag "old" "new"                       # (ask Jo first; the app finishes it)
lg delete-tag "old"                             # no folder is touched (ask Jo first)
lg trash "Model/Set A"                          # into the app's Trash (ask Jo first)
lg storage "Model/Set A"                        # --off to take out (ask Jo first)
lg undo                                         # put back the tags file from before the last change
```

Options every changing command takes:

- `--dry-run` -- check everything and print what would happen; write nothing.
- `--skip-refused` -- when a Tag refuses some folders (say, a Model only Tag
  and a Set from another Model), skip those and do the rest, listing them.
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
    {"op": "add", "tag": "mk beach", "paths": ["Madison Kate/230610-...", "Madison Kate/230701-..."]},
    {"op": "flag", "tag": "mk beach", "flag": "model-only", "on": true},
    {"op": "nest", "tag": "mk beach", "parent": "mk albums"},
    {"op": "remove", "tag": "mk casual", "paths": ["Madison Kate/230610-..."]},
    {"op": "favorite", "paths": ["Madison Kate/230610-..."], "on": true}
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
`contents` (`source`, `tag`, `on`), `favorite` / `hide` / `storage` (`paths`,
`on`), `trash` (`paths`), `move` / `moved` (`from`, `to`), `rename-tag`
(`from`, `to`), `delete-tag` (`tag`). Changes run in order, so a `flag` after
the `add` that creates a Tag works. A rename or delete of a Tag cannot share a
plan with other changes to that Tag; do it in a separate run, last.

Keep plans in a temporary folder outside the library (or in a `_tmp_check`
folder you delete afterwards), never in `.local-gallery/`.

## Recipes

**Categorize Sets into Tags (the usual job).**
1. `lg status`, `lg tags`, and `lg sets "<Model>" --json` to see what exists.
2. Look at the Sets (the media-library-curator skill has the contact-sheet
   method), decide each Set's Tags, and keep your decisions in a file as you
   go.
3. Write one plan: `add` per Tag with all its Sets; `flag model-only` for new
   per-Model Tags; `nest` new Tags under a parent if they form a family;
   `flag exclusive` only if Jo wants them filed away out of the Model.
4. `apply --dry-run`, read it, `apply`.
5. `lg tag "<each new Tag>"` to confirm, then report to Jo: each Tag, how many
   Sets, and the judgment calls.

**Sort Sets into confidence buckets.** Make the buckets Tags, not folders:
numbered so they sort (`<prefix> 1 definite`, `<prefix> 2 likely`, `<prefix> 3
close, <what the near miss is>`, `<prefix> 4 maybe`, `<prefix> 5 unlikely`,
`<prefix> 6 no`), every Set in exactly one, all nested in a parent Tag
(`<prefix> scale`), Model only when they are one Model's Sets. Ask Jo whether
to make them Exclusive (that files the Sets out of the Model into the
buckets). Never move Set folders into bucket folders: that breaks the
library's shape.

**Find what still needs Tags.** `lg sets "<Model>" --untagged`, or across the
library `lg sets --untagged --json`.

**Merge Tag A into Tag B.** `lg tag A --json` for its folders; `add` them to B
(and `nest` A's sub-Tags into B); then, with Jo's OK, `delete-tag A` in a
separate run.

**Rename a Set or Model folder** (naming fixes, merges): `lg move OLD NEW`. It
moves the folder on disk, carries its Tags at once, and asks the app to carry
everything else (score, thumbnail, settings). If a script of yours already
renamed folders, record each with `lg moved OLD NEW` (or a plan of `moved`
changes) *right away*, before anything else.

**Remove a Set Jo doesn't want.** With Jo's OK: `lg trash PATH`. Never `rm`.

**Fix a mistake.** `lg undo` puts the tags file back as it was before the last
`lg.py` change (run it again to go further back). It refuses if the app or Jo
changed Tags since, because undoing would throw that away too; then reverse
the mistake with the opposite command instead (`remove` for `add`...).
Requests the app carried out (renames, deletes, Trash, Storage) and folder
moves are not undone by `undo`; reverse those with the opposite command.

## How changes reach the app

- `lg.py` writes Tags straight into `.local-gallery/tags.log.json`. **If the
  app is open**, it notices within about two seconds, loads the change in
  place, and `lg.py` waits and prints "Local Gallery has loaded the change."
  The app waits while Jo is in the middle of something (a menu, a text field,
  the journal); `lg.py` says so, and the change lands right after. **If the
  app is closed or locked**, it reads the file when the library next opens.
  Either way the change is already saved the moment `lg.py` says `Done.`
- Some things only the app can finish: renaming and deleting Tags, Trash,
  Storage, and carrying a moved folder's other data. `lg.py` queues these in
  `.local-gallery/ai/requests/`; the open app does them within seconds and
  writes the answer to `ai/results/` (`lg requests` shows both). If the app is
  closed they wait, and run when it opens. While one is waiting, `lg.py`
  refuses changes that would collide with it and says so.
- If Jo changes Tags in the app in the same second `lg.py` writes, the app
  keeps Jo's version and saves yours in `.local-gallery/ai/conflicts/`, and
  `lg.py` prints a `WARNING`. Run `lg show` / `lg tag` on what you changed and
  re-apply what is missing.
- `.local-gallery/ai/app-status.json` is the app saying it is open (rewritten
  every few seconds). `lg status` reads it for you.

## What lives in `.local-gallery/` (read only)

You never need these, since `lg.py` reads them for you, but so you know:

| File | What it is |
|---|---|
| `tags.log.json` | Tags, Favorites, Hidden, Storage marks, Tag settings. The one file `lg.py` writes. |
| `scores.log.json`, `score-history.log.json` | Jo's scores for folders, and their history. Never change these. |
| `custom-thumbnails.log.json` | Picked thumbnails, crops, video frames. |
| `appearance-*.log.json`, `preferences.*.log.json`, `keyboard-configuration.log.json` | Jo's settings. |
| `trash.log.json` | Where Trash items came from (for Put Back). |
| `daily-journals.log.json`, `variations.json`, `lock.log.json` | Jo's journal, prompt composer, app lock. |
| `thumbs/`, `catalog/` | Caches. |
| `ai/` | Yours and the app's shared desk: `lg.py`, `journal.jsonl` (every change), `backups/` (the tags file before each change), `requests/`, `results/`, `conflicts/`, `app-status.json`. |

The app never forgets metadata of a folder that disappears: it stays filed
under the old path in case the folder comes back. That is why `lg tag` may
list Sets "remembered, not on disk". Leave them; they do no harm.

If you are ever asked to do something `lg.py` has no command for (scores,
thumbnails, settings), do not edit the files: tell Jo it has to be done in the
app, or that `lg.py` needs a new command.

## When something goes wrong

- `Refused: No folder ...` -- the path is wrong. It suggests close names; use
  `lg find`. Paths are `Model` or `Model/Set`, from the library root.
- `Refused: ... would be a new Tag, but ... already exists` -- you probably
  mistyped an existing Tag. Use the existing name (check `lg tags`), or `--new`
  if Jo really wants a second one.
- `Refused: ... is Model only` / `Root only` -- the Tag only takes Sets of one
  Model / only Models. Pick the right Tag, or `--skip-refused` to do the rest.
- `Refused: The app has not finished ...` -- a request is waiting. Ask Jo to
  open Local Gallery (and unlock it), then `lg requests`.
- `Refused: Another lg.py run is writing` -- wait a moment and repeat.
- `Refused: The tags file ... is not valid JSON` -- something wrote it badly.
  Stop and tell Jo; the last good copies are in `.local-gallery/ai/backups/`
  (gzip) and the app keeps working from its own copy.
- `WARNING: after writing, these are not as expected` -- stop and tell Jo
  what it lists.

When in doubt, `lg check`, and ask Jo.
