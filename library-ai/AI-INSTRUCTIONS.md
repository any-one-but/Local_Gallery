# AI instructions -- working on a Local Gallery library

You are an AI assistant, and the folder this file sits in belongs to a
**Local Gallery** library: a media collection that its owner browses in the
Local Gallery Mac app. You are here to help organize it, usually by putting
Sets into **Tags**. This file is everything you need to do that safely. Read
all of it before changing anything; it is written so that you never have to
guess.

Where things are, from the library folder (the folder that holds the hidden
`.local-gallery/` folder):

- `.local-gallery/AI-INSTRUCTIONS.md` -- this file.
- `.local-gallery/ai/lg.py` -- the tool that makes every change.

Nothing for you is kept outside `.local-gallery/`, and nothing you make
should be: keep plan files and notes in a temporary folder of your own, or in
`.local-gallery/ai/work/` if you need them to outlast your session.

> Local Gallery writes this file each time it opens the library, from
> `library-ai/AI-INSTRUCTIONS.md` in the app's source. Edits made here are
> replaced.

## The five rules

1. **Change the library's organization only through `lg.py`.** Never edit any
   other file in `.local-gallery/` by hand, never write those files from your
   own scripts, and never delete them. `lg.py` checks every change, writes all
   of it or none of it, keeps a backup, logs what it did, and works with the
   app open or closed. Your own edits would do none of that, and the app could
   write over them.
2. **Never move, rename or delete folders with `mv`, `os.rename`, `rm` or
   similar** unless you then tell `lg.py` (`moved`), and prefer letting
   `lg.py` do it (`move`). Everything the app knows about a folder (its Tags,
   score, thumbnail, settings) is filed under its path; a folder moved behind
   the app's back loses all of it until the app is told. To remove a folder,
   use `trash` (it goes to the app's own Trash, from which the user can put it
   back). Files *inside* a Set are yours to manage when the user asks, but
   tell `lg.py` about any Set or Model folder you rename.
3. **Dry-run first, then write.** Every changing command takes `--dry-run`.
   For anything bigger than a handful of folders, build a plan file, run
   `apply plan.json --dry-run`, read what it says, then run it for real.
4. **Ask the user before anything that removes or hides**: `delete-tag`,
   `trash`, `storage`, `hide`, `flag ... hidden`, `remove` across many
   folders, `rename-tag`, or `undo --force`. Adding folders to Tags and making
   new Tags is fine when the user asked you to categorize.
5. **Read what `lg.py` answers.** It starts with `Done.` or `Refused:`. A
   refusal means nothing was written; it says why and usually what to do
   instead. Never work around a refusal by editing files yourself. If it
   answers `WARNING`, stop and tell the user.

## Running it

From the library folder:

```bash
python3 .local-gallery/ai/lg.py status
```

It needs only Python 3.8+ and finds the library from its own location, so it
works on the Mac and in a sandbox where the library folder is mounted (run it
by its full path there). If it ever cannot find the library, pass
`--library <path to the library folder>`.

Always start with:

```bash
python3 .local-gallery/ai/lg.py status     # is the app open, is anything waiting
python3 .local-gallery/ai/lg.py tags       # every Tag that exists
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
and it files the Tag under `Name`, and says so.

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

When you make a new family, propose names in the library's style and tell the
user what you chose, or ask them for a prefix.

## Reading

```bash
lg status                               # app open? waiting requests? last change
lg tags [--sort count] [--json]         # every Tag: size, flags, parent, card place
lg tag "some tag" [--json]              # one Tag: every folder (and how), sub-Tags, rules
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
lg nest "xx beach" "xx albums"                  # Tag inside Tag
lg unnest "xx beach" "xx albums"
lg nest "some source" :tag-storage
lg flag "xx beach" exclusive                    # --off to clear; flags: exclusive,
lg flag "xx beach" use-anywhere                 #   use-anywhere, hidden
lg hide-media "xx videos" images text           # 'none' shows everything again
lg contents "Some Model" "xx everything"        # every Set of the Model, now and later
lg contents "tag:xx sets" "xx everything" --off
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
`contents` (`source`, `tag`, `on`), `favorite` / `hide` / `storage` (`paths`,
`on`), `trash` (`paths`), `move` / `moved` (`from`, `to`), `rename-tag`
(`from`, `to`), `delete-tag` (`tag`). Changes run in order, so a `flag` after
the `add` that creates a Tag works. A rename or delete of a Tag cannot share a
plan with other changes to that Tag; do it in a separate run, last.

## Recipes

**Categorize Sets into Tags (the usual job).**
1. `lg status`, `lg tags`, and `lg sets "<Model>" --json` to see what exists.
2. Look at the Sets (open the media, or make contact sheets of them), decide
   each Set's Tags, and keep your decisions in a file as you go. The unit is
   the Set; judge it by what is in it, not by its title.
3. Write one plan: `add` per Tag with all its Sets (a new Tag is held to its
   Model by itself); `nest` new Tags under a parent if they form a family;
   `flag exclusive` only if the user wants them filed away out of the Model.
4. `apply --dry-run`, read it, `apply`.
5. `lg tag "<each new Tag>"` to confirm, then report to the user: each Tag,
   how many Sets, and the judgment calls.

**Sort Sets into confidence buckets** ("which of these show X?"). Make the
buckets Tags, not folders: numbered so they sort (`<prefix> 1 definite`,
`<prefix> 2 likely`, `<prefix> 3 close, <what the near miss is>`, `<prefix> 4
maybe`, `<prefix> 5 unlikely`, `<prefix> 6 no`), every Set in exactly one, all
nested in a parent Tag (`<prefix> scale`); `use-anywhere` only when the
buckets must take Sets of several Models (flag them before adding). Ask whether to make them Exclusive (that files the Sets out of
the Model into the buckets). Never move Set folders into bucket folders: that
breaks the library's shape.

**Find what still needs Tags.** `lg sets "<Model>" --untagged`, or across the
library `lg sets --untagged --json`.

**Merge Tag A into Tag B.** `lg tag A --json` for its folders; `add` them to B
(and `nest` A's sub-Tags into B); then, with the user's OK, `delete-tag A` in a
separate run.

**Rename a Set or Model folder** (naming fixes, merges): `lg move OLD NEW`. It
moves the folder on disk, carries its Tags at once, and asks the app to carry
everything else (score, thumbnail, settings). If a script of yours already
renamed folders, record each with `lg moved OLD NEW` (or a plan of `moved`
changes) *right away*, before anything else.

**Remove a Set the user doesn't want.** With their OK: `lg trash PATH`. Never
`rm`.

**Fix a mistake.** `lg undo` puts the tags file back as it was before the last
`lg.py` change (run it again to go further back). It refuses if the app or
the user changed Tags since, because undoing would throw that away too; then
reverse the mistake with the opposite command instead (`remove` for `add`...).
Requests the app carried out (renames, deletes, Trash, Storage) and folder
moves are not undone by `undo`; reverse those with the opposite command.

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

## What lives in `.local-gallery/` (read only)

You never need these, since `lg.py` reads them for you, but so you know:

| File | What it is |
|---|---|
| `tags.log.json` | Tags, Favorites, Hidden, Storage marks, Tag settings. The one file `lg.py` writes. |
| `scores.log.json`, `score-history.log.json` | The user's scores for folders, and their history. Never change these. |
| `custom-thumbnails.log.json` | Picked thumbnails, crops, video frames. |
| `appearance-*.log.json`, `preferences.*.log.json`, `keyboard-configuration.log.json` | The user's settings. |
| `trash.log.json` | Where Trash items came from (for Put Back). |
| `daily-journals.log.json`, `variations.json`, `lock.log.json` | The user's journal, prompt composer, app lock. |
| `thumbs/`, `catalog/` | Caches. |
| `AI-INSTRUCTIONS.md` | This file. |
| `ai/` | The shared desk between AI tools and the app: `lg.py`, `journal.jsonl` (every change), `backups/` (the tags file before each change), `requests/`, `results/`, `conflicts/`, `app-status.json`, and `work/` for your own files. |

The app never forgets metadata of a folder that disappears: it stays filed
under the old path in case the folder comes back. That is why `lg tag` may
list Sets "remembered, not on disk". Leave them; they do no harm.

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
- `WARNING: after writing, these are not as expected` -- stop and tell the
  user what it lists.

When in doubt, `lg check`, and ask the user.
