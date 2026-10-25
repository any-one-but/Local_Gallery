# CLAUDE.md -- .local-gallery (Local Gallery's data)

Stop: **do not edit, write or delete any file in this folder by hand or from a
script.** This is where the Local Gallery app keeps everything it knows about
the library (Tags, scores, thumbnails, settings, the journal), and the app may
be running and writing these files right now.

To change Tags, Favorites, Hidden, Storage or Trash, or to move or rename a
Model or Set folder, use the tool:

```bash
python3 .local-gallery/ai/lg.py status     # run from the library folder
python3 .local-gallery/ai/lg.py --help
```

The full guide is `../CLAUDE.md` (the `CLAUDE.md` in the library folder, one
level up), also printed by `python3 .local-gallery/ai/lg.py guide`. Read it
before changing anything.

> Written by Local Gallery each time it opens the library; edits are replaced.
