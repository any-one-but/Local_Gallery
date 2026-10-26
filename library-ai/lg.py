#!/usr/bin/env python3
"""lg.py -- read and change Local Gallery's Tags from outside the app.

Made for AI assistants working on the library. The instructions are
.local-gallery/AI-INSTRUCTIONS.md (run `python3 lg.py guide` to print them).
Start with:

    python3 lg.py status
    python3 lg.py --help

Everything it writes is checked first and all-or-nothing, a backup of the
tags file is kept before every change (`undo` puts it back), and every change
is logged in .local-gallery/ai/journal.jsonl. Local Gallery notices the change
within a couple of seconds when it is open, and reads it at the next start
when it is not.

Only the Python standard library is used (3.8 or newer), so it runs on the
Mac and in a Linux sandbox that has the library folder mounted.

This file is written into each library by the app (from library-ai/ in the
app's source); edits made to the copy in a library are replaced.
"""

import argparse
import datetime
import difflib
import gzip
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import uuid
from pathlib import Path

TOOL_VERSION = 1

# --- names the app uses ------------------------------------------------------

META_DIR = ".local-gallery"
AI_DIR = "ai"
TAGS_FILE = "tags.log.json"
INSTRUCTIONS_FILE = "AI-INSTRUCTIONS.md"
SCORES_FILE = "scores.log.json"
TRASH_DIR = "__LOCAL_GALLERY_TRASH__"
MUSIC_DIR = "__LOCAL_GALLERY_MUSIC__"
TAGS_SCHEMA = 3

FAVORITE = "__favorite__"
HIDDEN = "__hidden__"
STORAGE = "__storage__"
MARKERS = (FAVORITE, HIDDEN, STORAGE)
LEGACY_PROCESSING = "__processing_disabled__"
TAG_STORAGE = "__tag_storage__"
TAG_STORAGE_ALIAS = ":tag-storage"
INTERNAL_TAGS = {
    "__all_tags__",
    "__all_models__",
    "__all_sets__",
    "__certified_fresh__",
    TAG_STORAGE,
}
MEDIA_TYPES = ("images", "videos", "text")
ALT_SEP = " -- "
FLAGS = ("exclusive", "use-anywhere", "hidden")
# Switches an older app had; every Tag now does what they did (see lockers).
RETIRED_FLAGS = ("model-only", "root-only")

APP_FRESH_SECONDS = 35
BACKUPS_KEPT = 40


class Refused(Exception):
    """A change that cannot be made. Nothing is written."""


# --- small helpers -------------------------------------------------------------


def now_ms():
    return int(time.time() * 1000)


def stamp():
    return datetime.datetime.now().strftime("%Y%m%d-%H%M%S")


def nfc(s):
    return unicodedata.normalize("NFC", str(s))


def natural_key(s):
    # Mirrors the app's localeCompare(..., { numeric: true, sensitivity: "base" }).
    out = []
    for part in re.split(r"(\d+)", nfc(s).casefold()):
        out.append((0, int(part)) if part.isdigit() else (1, part))
    return out


def normalize_tag(name):
    return str(name or "").strip().lower()


def normalize_tag_list(tags):
    out, seen = [], set()
    for t in tags or []:
        t = normalize_tag(t)
        if not t or t == LEGACY_PROCESSING or t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def squash(name):
    return re.sub(r"[\s\-_.,:;'\"()]+", "", normalize_tag(name))


def norm_rel(path):
    p = str(path or "").replace("\\", "/").strip()
    p = re.sub(r"/+", "/", p).strip("/")
    return p


def parse_alt(name):
    i = name.rfind(ALT_SEP)
    if i <= 0:
        return None
    base, label = name[:i], name[i + len(ALT_SEP):]
    if not base.strip() or not label.strip():
        return None
    return base, label


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def plural(n, word, words=None):
    return f"{n} {word if n == 1 else (words or word + 's')}"


def is_trash(path):
    return path == TRASH_DIR or path.startswith(TRASH_DIR + "/")


def under(path, prefix):
    return path == prefix or path.startswith(prefix + "/")


def remap_prefix(path, old, new):
    if path == old:
        return new
    if path.startswith(old + "/"):
        return new + path[len(old):]
    return path


# --- the library on disk ------------------------------------------------------


class Library:
    def __init__(self, root):
        self.root = Path(root)
        self.meta = self.root / META_DIR
        self.ai = self.meta / AI_DIR
        self._listing = {}

    # One listing per folder per run: {name: is_dir}, names exactly as on disk.
    def listing(self, rel):
        rel = norm_rel(rel)
        if rel in self._listing:
            return self._listing[rel]
        out = {}
        try:
            with os.scandir(self.root / rel if rel else self.root) as it:
                for e in it:
                    try:
                        out[e.name] = e.is_dir()
                    except OSError:
                        pass
        except OSError:
            out = None
        self._listing[rel] = out
        return out

    def child_dirs(self, rel):
        """The folders the app lists inside `rel`, in its order, ALTs folded."""
        rel = norm_rel(rel)
        names = self.listing(rel) or {}
        out = []
        for name, is_dir in names.items():
            if not is_dir or name.startswith("."):
                continue
            if not rel and name in (META_DIR, MUSIC_DIR, TRASH_DIR):
                continue
            alt = parse_alt(name)
            if alt and names.get(alt[0]):
                continue  # an ALT of a sibling: folded into it
            out.append(name)
        out.sort(key=natural_key)
        return [f"{rel}/{n}" if rel else n for n in out]

    def alt_labels(self, rel):
        rel = norm_rel(rel)
        parent, _, name = rel.rpartition("/")
        names = self.listing(parent) or {}
        out = []
        for other, is_dir in names.items():
            alt = parse_alt(other) if is_dir else None
            if alt and alt[0] == name:
                out.append(alt[1])
        return sorted(out, key=natural_key)

    def models(self):
        return self.child_dirs("")

    def sets(self, model):
        return self.child_dirs(model)

    def all_sets(self):
        out = []
        for m in self.models():
            out.extend(self.sets(m))
        return out

    def exists(self, rel):
        """A folder the app knows: on disk, or the folded form of an ALT."""
        parts = norm_rel(rel).split("/") if norm_rel(rel) else []
        frontier = [""]
        for part in parts:
            nxt = []
            for parent in frontier:
                names = self.listing(parent) or {}
                for name, is_dir in names.items():
                    if not is_dir:
                        continue
                    alt = parse_alt(name)
                    if name == part or (alt and alt[0] == part):
                        nxt.append(f"{parent}/{name}" if parent else name)
            if not nxt:
                return False
            frontier = nxt
        return True

    def file_counts(self, rel):
        counts = {"images": 0, "videos": 0, "text": 0}
        names = self.listing(rel) or {}
        for name, is_dir in names.items():
            if is_dir or name.startswith("."):
                continue
            low = name.lower()
            if re.search(r"\.(jpe?g|png|gif|webp|tiff|bmp|avif)$", low):
                counts["images"] += 1
            elif re.search(r"\.(mp4|m4v|mov|wmv|flv|avi|webm|mkv)$", low):
                counts["videos"] += 1
            elif re.search(r"\.(md|markdown)$", low):
                counts["text"] += 1
        return counts

    def resolve(self, raw, must_exist=True, allow_trash=False, known=None):
        """A folder argument -> (path the app keys it by, notes).

        Accepts `Model`, `Model/Set`, an absolute path inside the library, any
        letter case, and the real folder of an ALT (`Foo -- VHS/Set` is
        `Foo/Set` to the app)."""
        notes = []
        text = str(raw or "").strip()
        if not text:
            raise Refused("An empty folder path was given.")
        p = Path(text)
        if p.is_absolute():
            rel = None
            for base in (self.root, self.root.resolve()):
                try:
                    rel = Path(os.path.abspath(text)).relative_to(base).as_posix()
                    break
                except ValueError:
                    continue
            if rel is None:
                raise Refused(f"'{text}' is not inside the library ({self.root}).")
            text = rel
        rel = nfc(norm_rel(text))
        if rel in ("", "."):
            raise Refused("The library root itself can't be tagged.")
        parts = rel.split("/")
        if parts[0] in (META_DIR, MUSIC_DIR) or any(x.startswith(".") for x in parts):
            raise Refused(f"'{rel}' is not part of the library.")
        if is_trash(rel) and not allow_trash:
            raise Refused(
                f"'{rel}' is in Local Gallery's Trash. Put it back in the app first."
            )
        depth_limit = 3 if is_trash(rel) else 2
        if len(parts) > depth_limit:
            raise Refused(
                f"'{rel}' is deeper than Model/Set. Sets hold only files, so "
                "nothing below a Set is part of the library."
            )

        # Match each part against the real names on disk (case and Unicode
        # form), then fold ALT names onto their Original.
        real, canon = [], []
        for i, part in enumerate(parts):
            parent = "/".join(real)
            names = self.listing(parent) if parent is not None else None
            found = None
            if names:
                if names.get(part):
                    found = part
                else:
                    folded = nfc(part).casefold()
                    for name, is_dir in names.items():
                        if is_dir and nfc(name).casefold() == folded:
                            found = name
                            break
            if found is None:
                if must_exist and not (known and rel in known):
                    hint = ""
                    if names:
                        close = difflib.get_close_matches(
                            part, [n for n, d in names.items() if d], n=3, cutoff=0.6
                        )
                        if close:
                            hint = " Did you mean: " + ", ".join(
                                "/".join(real + [c]) for c in close
                            ) + "?"
                    raise Refused(f"No folder '{rel}' in the library.{hint}")
                real = parts  # vanished folder named exactly as remembered
                canon = parts
                break
            if found != part:
                notes.append(f"'{part}' is spelled '{found}' on disk; using that.")
            real.append(found)
            alt = parse_alt(found)
            if alt and names.get(alt[0]):
                notes.append(
                    f"'{found}' is an ALT of '{alt[0]}'; the app keeps its Tags on "
                    f"'{alt[0]}'."
                )
                canon.append(alt[0])
            else:
                canon.append(found)
        return "/".join(canon), notes


# --- the tags document ----------------------------------------------------------


class TagsDoc:
    def __init__(self, lib):
        self.lib = lib
        self.path = lib.meta / TAGS_FILE
        raw = self.path.read_bytes()
        st = os.stat(self.path)
        self.sig = (st.st_size, st.st_mtime_ns)
        self.raw = raw
        self.sha = sha256_bytes(raw)
        text = raw.decode("utf-8").strip()
        if not text:
            raise Refused(
                f"{self.path} is empty. Open Local Gallery once so it writes it."
            )
        try:
            self.d = json.loads(text)
        except ValueError as e:
            raise Refused(f"{self.path} is not valid JSON ({e}). Nothing was changed.")
        if not isinstance(self.d, dict):
            raise Refused(f"{self.path} is not a tags document.")
        if int(self.d.get("schema") or 0) < TAGS_SCHEMA:
            raise Refused(
                f"{self.path} is schema {self.d.get('schema')}, written before Tags "
                "were one thing. Open Local Gallery once so it converts it."
            )
        for key, empty in (
            ("folders", {}),
            ("tagParents", {}),
            ("exclusiveTags", []),
            ("useAnywhereTags", []),
            ("contentTags", {}),
            ("hiddenTagByKey", {}),
            ("tagMediaFilterByKey", {}),
            ("folderMediaFilterByPath", {}),
            ("scoreFilterOverrides", {}),
            ("tagByFp", {}),
        ):
            if not isinstance(self.d.get(key), type(empty)):
                self.d[key] = type(empty)()
        self._derived = None
        self.modified = False

    # -- folders

    @property
    def folders(self):
        return self.d["folders"]

    def tags_of(self, path):
        entry = self.folders.get(path)
        return normalize_tag_list(entry.get("tags")) if isinstance(entry, dict) else []

    def user_tags_of(self, path):
        return [t for t in self.tags_of(path) if t not in MARKERS]

    def set_tags(self, path, tags):
        tags = normalize_tag_list(tags)
        entry = self.folders.get(path)
        if not isinstance(entry, dict):
            entry = {"fp": 0, "tags": []}
            self.folders[path] = entry
        entry["tags"] = tags
        self.dirty()

    # -- Tag-wide data

    def parents_of(self, tag):
        return set(normalize_tag_list(self.d["tagParents"].get(tag) or []))

    def set_parents(self, tag, parents):
        parents = sorted(p for p in set(parents) if p and p != tag)
        if parents:
            self.d["tagParents"][tag] = parents
        else:
            self.d["tagParents"].pop(tag, None)
        self.dirty()

    def flag_list(self, flag):
        key = {
            "exclusive": "exclusiveTags",
            "use-anywhere": "useAnywhereTags",
        }[flag]
        return key

    def has_flag(self, tag, flag):
        if flag == "hidden":
            return bool(self.d["hiddenTagByKey"].get(f"tag:{tag}"))
        if flag == "exclusive" and tag == TAG_STORAGE:
            return True
        return tag in normalize_tag_list(self.d[self.flag_list(flag)])

    def set_flag(self, tag, flag, on):
        if flag == "hidden":
            if on:
                self.d["hiddenTagByKey"][f"tag:{tag}"] = True
            else:
                self.d["hiddenTagByKey"].pop(f"tag:{tag}", None)
        else:
            key = self.flag_list(flag)
            names = set(normalize_tag_list(self.d[key]))
            if on:
                names.add(tag)
            else:
                names.discard(tag)
            self.d[key] = sorted(names)
        self.dirty()

    def hidden_media(self, tag):
        v = self.d["tagMediaFilterByKey"].get(f"tag:{tag}")
        return [t for t in MEDIA_TYPES if isinstance(v, list) and t in v]

    def set_hidden_media(self, tag, types):
        types = [t for t in MEDIA_TYPES if t in types]
        if types:
            self.d["tagMediaFilterByKey"][f"tag:{tag}"] = types
        else:
            self.d["tagMediaFilterByKey"].pop(f"tag:{tag}", None)
        self.dirty()

    def content_rules(self):
        """{key: [tags]} -- key is `dir:<path>` or `tag:<name>`."""
        out = {}
        for key, tags in self.d["contentTags"].items():
            if isinstance(tags, list):
                out[key] = normalize_tag_list(tags)
        return out

    def set_content_rule(self, key, tags):
        tags = sorted(set(normalize_tag_list(tags)) - set(MARKERS))
        if tags:
            self.d["contentTags"][key] = tags
        else:
            self.d["contentTags"].pop(key, None)
        self.dirty()

    # -- derived views (rebuilt after every change)

    def dirty(self):
        self._derived = None
        self.modified = True

    def derived(self):
        if self._derived is not None:
            return self._derived
        by_tag = {}
        for path, entry in self.folders.items():
            if not isinstance(entry, dict):
                continue
            for t in normalize_tag_list(entry.get("tags")):
                if t in MARKERS:
                    continue
                by_tag.setdefault(t, []).append(path)
        children = {}
        for child, parents in self.d["tagParents"].items():
            child = normalize_tag(child)
            for p in normalize_tag_list(parents if isinstance(parents, list) else []):
                children.setdefault(p, set()).add(child)
        names = set(by_tag) | set(children)
        for child in self.d["tagParents"]:
            names.add(normalize_tag(child))
        for key in ("exclusiveTags", "useAnywhereTags"):
            names.update(normalize_tag_list(self.d[key]))
        for key, tags in self.content_rules().items():
            names.update(tags)
            if key.startswith("tag:"):
                names.add(normalize_tag(key[4:]))
        for mapkey in ("hiddenTagByKey", "tagMediaFilterByKey", "scoreFilterOverrides"):
            for key in self.d[mapkey]:
                if key.startswith("tag:"):
                    names.add(normalize_tag(key[4:]))
        names.discard("")
        self._derived = {"by_tag": by_tag, "children": children, "names": names}
        return self._derived

    def tag_names(self):
        return self.derived()["names"]

    def tag_exists(self, tag):
        return tag in self.tag_names()

    def direct_members(self, tag, include_trash=False):
        out = self.derived()["by_tag"].get(tag, [])
        return [p for p in out if include_trash or not is_trash(p)]

    def children_of(self, tag):
        return set(self.derived()["children"].get(tag, set()))

    def descendants(self, tag):
        out, stack = set(), [tag]
        while stack:
            cur = stack.pop()
            for c in self.children_of(cur):
                if c not in out:
                    out.add(c)
                    stack.append(c)
        out.discard(tag)
        return out

    def holds(self, holder, name):
        return name in self.descendants(holder)

    def rule_members(self, tag, _seen=None):
        """Folders in `tag` through contents rules, with the rule that adds each."""
        seen = _seen or set()
        out = {}
        for key, tags in self.content_rules().items():
            if tag not in tags:
                continue
            if key.startswith("dir:"):
                if is_trash(key[4:]):
                    continue
                for child in self.lib.child_dirs(key[4:]):
                    out.setdefault(child, key)
            elif key.startswith("tag:"):
                src = normalize_tag(key[4:])
                if src in seen:
                    continue
                seen.add(src)
                for p in self.members(src, _seen=seen):
                    out.setdefault(p, key)
        return out

    def members(self, tag, _seen=None):
        seen = _seen or {tag}
        out = set(p for p in self.direct_members(tag) if self.lib.exists(p))
        out.update(self.rule_members(tag, _seen=seen))
        return sorted(out, key=natural_key)

    def content_info(self, tag):
        """What `tag` holds in the library's shape, through the Tags it holds."""
        memo = self.derived().setdefault("content_info", {})
        if tag in memo:
            return memo[tag]
        models, holds_models, holds_other = set(), False, False
        for t in [tag] + sorted(self.descendants(tag)):
            for p in self.members(t):
                if is_trash(p):
                    continue
                parts = p.split("/")
                if len(parts) == 1:
                    holds_models = True
                elif len(parts) == 2:
                    models.add(parts[0])
                else:
                    holds_other = True
        memo[tag] = (models, holds_models, holds_other)
        return memo[tag]

    def single_model(self, tag):
        models, holds_models, holds_other = self.content_info(tag)
        if holds_models or holds_other or len(models) != 1:
            return None
        return next(iter(models))

    # Where a Tag may be used (the app's tagLockKind / tagLockers). Every Tag is
    # held to the place its content is in, read off the content: all Sets of one
    # Model -> that Model's Sets only; all Models -> Models only; anything else
    # (empty, several Models, mixed) -> anything. "use-anywhere" frees it. A Tag
    # is also held by the lock of every Tag holding it. Tag storage is never held.

    def lock_kind(self, tag):
        if tag in INTERNAL_TAGS or self.has_flag(tag, "use-anywhere"):
            return None
        models, holds_models, holds_other = self.content_info(tag)
        if holds_models and not holds_other and not models:
            return "root"
        if self.single_model(tag):
            return "model"
        return None

    def lockers(self, tag):
        out, seen, queue = [], set(), [tag]
        while queue:
            cur = queue.pop(0)
            if cur in seen:
                continue
            seen.add(cur)
            if self.lock_kind(cur):
                out.append(cur)
            queue.extend(sorted(self.parents_of(cur)))
        return out

    def held_to(self, tag):
        """What the Tag's own lock lets in, in words, or None."""
        kind = self.lock_kind(tag)
        if kind == "root":
            return "Models"
        if kind == "model":
            return f"Sets from {self.single_model(tag)}"
        return None

    def _refusal(self, tag, locker):
        why = f"it only takes {self.held_to(locker)}"
        if locker != tag:
            why = f"it is in '{label(locker)}', which only takes {self.held_to(locker)}"
        return (
            f"'{tag}' is held to its place ({why}). Set `flag {locker!r} use-anywhere` "
            "only if the user wants it used anywhere."
        )

    def lock_refuses_paths(self, tag, paths):
        for locker in self.lockers(tag):
            kind = self.lock_kind(locker)
            if kind == "root" and any("/" in p for p in paths):
                return self._refusal(tag, locker)
            if kind == "model":
                lock = self.single_model(locker)
                for p in paths:
                    parts = p.split("/")
                    if len(parts) != 2 or parts[0] != lock:
                        return self._refusal(tag, locker)
        return None

    def lock_refuses_tag(self, parent, child):
        models, holds_models, holds_other = self.content_info(child)
        for locker in self.lockers(parent):
            kind = self.lock_kind(locker)
            if kind == "root" and (holds_other or models):
                return self._refusal(parent, locker) + f" '{child}' holds Sets."
            if kind == "model":
                lock = self.single_model(locker)
                if holds_models or holds_other or any(m != lock for m in models):
                    return self._refusal(parent, locker) + f" '{child}' holds other things."
        return None

    def placement(self, tag, _seen=None):
        """Where the Tag's card shows: the deepest folder at or above all it holds."""
        if tag == TAG_STORAGE:
            return ""
        seen = _seen or set()
        if tag in seen:
            return None
        seen.add(tag)
        spots = []
        for p in self.members(tag):
            if is_trash(p):
                continue
            spots.append(p.rpartition("/")[0])
        for child in self.children_of(tag):
            spot = self.placement(child, seen)
            if spot is not None:
                spots.append(spot)
        if not spots:
            return None
        common = spots[0].split("/") if spots[0] else []
        for s in spots[1:]:
            parts = s.split("/") if s else []
            n = 0
            while n < len(common) and n < len(parts) and common[n] == parts[n]:
                n += 1
            common = common[:n]
        return "/".join(common)

    def fp_twins(self, path):
        """Other remembered folders with the same fingerprint and Tags of their own."""
        entry = self.folders.get(path)
        fp = entry.get("fp") if isinstance(entry, dict) else 0
        if not fp or "/" not in path:
            return []
        out = []
        for other, e in self.folders.items():
            if other != path and isinstance(e, dict) and e.get("fp") == fp and "/" in other:
                if normalize_tag_list(e.get("tags")):
                    out.append(other)
        return out

    # -- writing

    def finish(self):
        """What the app writes beside the folders, kept the way it writes it."""
        tag_by_fp = {}
        for path, entry in self.folders.items():
            if not isinstance(entry, dict):
                continue
            tags = normalize_tag_list(entry.get("tags"))
            fp = entry.get("fp") or 0
            if tags and "/" in path and isinstance(fp, int) and fp:
                tag_by_fp.setdefault(str(fp & 0xFFFFFFFF), tags)
        self.d["tagByFp"] = tag_by_fp
        self.d["updatedAt"] = now_ms()

    def encode(self):
        return json.dumps(self.d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


# --- writing safely --------------------------------------------------------------


class Busy(Exception):
    pass


class FileChanged(Exception):
    pass


class ToolLock:
    """One lg.py writing at a time. An OS lock on a file that stays, so it
    needs no permission to delete anything and dies with the process."""

    def __init__(self, lib, name=".lg.lock"):
        self.path = lib.ai / name
        self.f = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            import fcntl
        except ImportError:
            return self
        self.f = open(self.path, "a+")
        for _ in range(600):
            try:
                fcntl.flock(self.f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                time.sleep(0.1)
            except OSError:
                return self  # a file system without locks: go ahead
        self.f.close()
        self.f = None
        raise Busy("Another lg.py run is writing. Try again in a moment.")

    def __exit__(self, *exc):
        if self.f:
            self.f.close()  # closing releases the lock


def atomic_write(path, data):
    path = Path(path)
    tmp = path.with_name(f".{path.name}.lg-ai-tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def save_doc(doc, journal):
    """Write the document only if nobody else has written it since it was read."""
    lib = doc.lib
    doc.finish()
    data = doc.encode()
    json.loads(data.decode("utf-8"))  # never write something that does not read back
    st = os.stat(doc.path)
    if (st.st_size, st.st_mtime_ns) != doc.sig:
        raise FileChanged()
    backups = lib.ai / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    backup_name = f"{stamp()}-{uuid.uuid4().hex[:6]}.tags.log.json.gz"
    with gzip.open(backups / backup_name, "wb") as f:
        f.write(doc.raw)
    old = sorted(backups.glob("*.tags.log.json.gz"))
    for extra in old[:-BACKUPS_KEPT]:
        try:
            extra.unlink()
        except OSError:
            pass
    atomic_write(doc.path, data)
    journal.update(
        {
            "backup": backup_name,
            "beforeSha256": doc.sha,
            "afterSha256": sha256_bytes(data),
        }
    )
    append_journal(lib, journal)
    return sha256_bytes(data)


def append_journal(lib, entry):
    lib.ai.mkdir(parents=True, exist_ok=True)
    entry = dict(entry)
    entry.setdefault("at", datetime.datetime.now().isoformat(timespec="seconds"))
    entry.setdefault("id", uuid.uuid4().hex[:10])
    with open(lib.ai / "journal.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def read_journal(lib):
    out = []
    try:
        with open(lib.ai / "journal.jsonl", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        pass
    except OSError:
        pass
    return out


# --- the app ----------------------------------------------------------------------


def app_status(lib):
    try:
        s = json.loads((lib.ai / "app-status.json").read_text("utf-8"))
    except (OSError, ValueError):
        return {"open": False, "ready": False, "raw": None}
    age = time.time() - (s.get("updatedAt") or 0) / 1000.0
    is_open = bool(s.get("open")) and -30 < age < APP_FRESH_SECONDS
    return {
        "open": is_open,
        "ready": is_open and bool(s.get("libraryOpen")),
        "age": age,
        "raw": s,
    }


def pending_requests(lib):
    out = []
    folder = lib.ai / "requests"
    for p in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            out.append(json.loads(p.read_text("utf-8")))
        except (OSError, ValueError):
            pass
    return out


def recent_results(lib, n=10):
    folder = lib.ai / "results"
    out = []
    for p in sorted(folder.glob("*.json"))[-n:] if folder.is_dir() else []:
        try:
            out.append(json.loads(p.read_text("utf-8")))
        except (OSError, ValueError):
            pass
    return out


def queue_request(lib, ops):
    folder = lib.ai / "requests"
    folder.mkdir(parents=True, exist_ok=True)
    rid = f"{stamp()}-{uuid.uuid4().hex[:6]}"
    req = {
        "id": rid,
        "createdAt": now_ms(),
        "createdBy": f"lg.py v{TOOL_VERSION}",
        "ops": ops,
    }
    data = json.dumps(req, ensure_ascii=False, indent=1).encode("utf-8")
    atomic_write(folder / f"{rid}.json", data)
    return rid


def wait_for_result(lib, rid, timeout):
    path = lib.ai / "results" / f"{rid}.json"
    end = time.time() + timeout
    while time.time() < end:
        if path.is_file():
            try:
                return json.loads(path.read_text("utf-8"))
            except ValueError:
                pass
        time.sleep(0.5)
    return None


def wait_for_app_load(lib, sha, timeout, expect=None):
    """"loaded" once the app holds this write, or a later file that still has
    it (another run wrote after it); "conflict" if the app wrote over it."""
    since = time.time() - 0.2
    end = time.time() + timeout
    while time.time() < end:
        s = app_status(lib)
        raw = s.get("raw") or {}
        tags = raw.get("tagsDoc") or {}
        if tags.get("sha256") == sha:
            return "loaded"
        if expect and tags.get("sha256"):
            try:
                current = sha256_bytes((lib.meta / TAGS_FILE).read_bytes())
            except OSError:
                current = ""
            if current == tags.get("sha256") and not verify_expectations(lib, expect):
                return "loaded"
        conflict = raw.get("lastConflict") or {}
        if (conflict.get("at") or 0) > since * 1000:
            return "conflict"
        time.sleep(0.4)
    return None


# --- changes --------------------------------------------------------------------------

# A change ("op") is a dict. The same shapes are what `apply` reads from a plan
# file, so everything the commands can do can be done in one batch:
#
#   {"op": "add",       "tag": "beach", "paths": ["Model/Set", ...]}
#   {"op": "remove",    "tag": "beach", "paths": [...]}
#   {"op": "set-tags",  "path": "Model/Set", "tags": ["a", "b"]}
#   {"op": "nest",      "tag": "child", "parent": "parent"}      (":tag-storage" for Tag storage)
#   {"op": "unnest",    "tag": "child", "parent": "parent"}
#   {"op": "flag",      "tag": "x", "flag": "exclusive|use-anywhere|hidden", "on": true}
#   {"op": "hide-media","tag": "x", "types": ["videos"]}         ([] shows everything again)
#   {"op": "contents",  "source": "Model" | "tag:name" | ":root", "tag": "x", "on": true}
#   {"op": "favorite",  "paths": [...], "on": true}
#   {"op": "hide",      "paths": [...], "on": true}
#   {"op": "moved",     "from": "Old/Path", "to": "New/Path"}    (already moved on disk)
#   {"op": "move",      "from": "Old/Path", "to": "New/Path"}    (lg.py moves it)
#   {"op": "rename-tag","from": "old", "to": "new"}              (finished by the app)
#   {"op": "delete-tag","tag": "x"}                              (finished by the app)
#   {"op": "trash",     "paths": [...]}                          (done by the app)
#   {"op": "storage",   "paths": [...], "on": true}              (done by the app)

APP_OPS = ("rename-tag", "delete-tag", "trash", "storage")
# Changes that can simply be made again when the app wrote over them.
REAPPLIABLE_OPS = (
    "add", "remove", "set-tags", "nest", "unnest", "flag", "hide-media",
    "contents", "favorite", "hide",
)
ALL_OPS = (
    "add", "remove", "set-tags", "nest", "unnest", "flag", "hide-media",
    "contents", "favorite", "hide", "moved", "move",
) + APP_OPS


class Run:
    def __init__(self, lib, doc, opts):
        self.lib = lib
        self.doc = doc
        self.opts = opts
        self.changes = []
        self.notes = []
        self.refusals = []
        self.app_ops = []
        self.disk_moves = []
        self.expect = []  # (kind, a, b, present) checked again after writing
        self.new_tags = set()
        self.knowledge_moves = []  # (old, new) for the sheets and guide to follow

    def note(self, msg):
        if msg not in self.notes:
            self.notes.append(msg)

    def refuse(self, msg):
        if self.opts.get("skip_refused"):
            self.refusals.append(msg)
            return
        raise Refused(msg)

    # -- names

    def tag_name(self, raw, may_be_new):
        if str(raw or "").strip().lower() == TAG_STORAGE_ALIAS:
            return TAG_STORAGE
        tag = normalize_tag(raw)
        if not tag:
            raise Refused("A Tag name can't be empty.")
        # Commas separate Tag names in the app, so none may be in a name. An
        # older Tag that still has one is renamed by the app when it next opens
        # (each comma made a space); until then it can still be named exactly.
        if "," in tag and not self.doc.tag_exists(tag):
            raise Refused(f"'{raw}': a Tag name can't hold a comma (commas separate Tag names).")
        if tag in MARKERS or tag in INTERNAL_TAGS or (tag.startswith("__") and tag.endswith("__")):
            raise Refused(f"'{raw}' is a name Local Gallery uses itself.")
        if "  " in tag:
            self.note(f"'{tag}' has two spaces in a row. Some existing Tags do; check it is the one you mean.")
        if self.doc.tag_exists(tag) or tag in self.new_tags:
            return tag
        if not may_be_new:
            close = difflib.get_close_matches(tag, sorted(self.doc.tag_names()), n=4, cutoff=0.6)
            hint = f" Close names: {', '.join(repr(c) for c in close)}." if close else ""
            raise Refused(f"There is no Tag '{tag}'.{hint}")
        same = [t for t in self.doc.tag_names() if squash(t) == squash(tag)]
        if same and not self.opts.get("allow_new"):
            raise Refused(
                f"'{tag}' would be a new Tag, but {', '.join(repr(s) for s in same)} "
                "already exists and differs only in spaces or punctuation. Use that "
                "name, or pass --new if a separate Tag is really wanted."
            )
        close = difflib.get_close_matches(tag, sorted(self.doc.tag_names()), n=3, cutoff=0.85)
        if close:
            self.note(f"New Tag '{tag}' looks like {', '.join(repr(c) for c in close)}. Make sure it is meant to be separate.")
        self.new_tags.add(tag)
        self.changes.append(f"New Tag '{tag}'.")
        return tag

    def folder(self, raw, must_exist=True, allow_trash=False):
        path, notes = self.lib.resolve(
            raw, must_exist=must_exist, allow_trash=allow_trash, known=self.doc.folders
        )
        for n in notes:
            self.note(n)
        return path

    def folders(self, op, must_exist=True, allow_trash=False):
        raw = op.get("paths")
        if isinstance(raw, str):
            raw = [raw]
        if not isinstance(raw, list) or not raw:
            raise Refused(f"'{op.get('op')}' needs a list of folder paths.")
        out = []
        for r in raw:
            try:
                p = self.folder(r, must_exist=must_exist, allow_trash=allow_trash)
            except Refused as e:
                self.refuse(str(e))
                continue
            if p not in out:
                out.append(p)
        return out

    # -- the changes

    def op_add(self, op):
        tag = self.tag_name(op.get("tag"), may_be_new=True)
        if tag == TAG_STORAGE:
            raise Refused("Tag storage holds only Tags. Put a Tag in it with `nest TAG :tag-storage`.")
        paths = self.folders(op)
        added = 0
        for p in paths:
            if tag in self.doc.tags_of(p):
                self.note(f"'{p}' is already in '{tag}'.")
                continue
            # Asked per folder, as the app does: an empty Tag is held from the
            # first folder put in it.
            why = self.doc.lock_refuses_paths(tag, [p])
            if why:
                self.refuse(f"Not adding '{p}': {why}")
                continue
            self.doc.set_tags(p, self.doc.tags_of(p) + [tag])
            self.expect.append(("tag", p, tag, True))
            added += 1
        if added:
            self.changes.append(f"Added {plural(added, 'folder')} to '{tag}'.")

    def op_remove(self, op):
        tag = self.tag_name(op.get("tag"), may_be_new=False)
        paths = self.folders(op, must_exist=False, allow_trash=True)
        removed = 0
        rules = self.doc.rule_members(tag)
        for p in paths:
            if p in rules and tag not in self.doc.tags_of(p):
                self.refuse(
                    f"'{p}' is in '{tag}' only through the contents rule '{rules[p]}'. "
                    f"Remove the rule (`contents {rules[p][4:] or ':root'} {tag!r} --off`) instead."
                )
                continue
            if tag not in self.doc.tags_of(p):
                self.note(f"'{p}' is not in '{tag}'.")
                continue
            self.doc.set_tags(p, [t for t in self.doc.tags_of(p) if t != tag])
            self.expect.append(("tag", p, tag, False))
            removed += 1
            if not self.doc.tags_of(p) and self.doc.fp_twins(p):
                self.note(
                    f"'{p}' now has no Tags, but {self.doc.fp_twins(p)[0]!r} has the same "
                    "fingerprint and Tags of its own, so the app may give it those back. "
                    "Run `check` after."
                )
        if removed:
            self.changes.append(f"Removed {plural(removed, 'folder')} from '{tag}'.")

    def op_set_tags(self, op):
        path = self.folder(op.get("path"))
        wanted = []
        for raw in op.get("tags") or []:
            t = self.tag_name(raw, may_be_new=True)
            if t == TAG_STORAGE:
                raise Refused("Tag storage holds only Tags.")
            wanted.append(t)
        have = self.doc.user_tags_of(path)
        for t in wanted:
            if t not in have:
                why = self.doc.lock_refuses_paths(t, [path])
                if why:
                    raise Refused(f"Not setting the Tags of '{path}': {why}")
        markers = [t for t in self.doc.tags_of(path) if t in MARKERS]
        self.doc.set_tags(path, markers + wanted)
        for t in set(have) | set(wanted):
            self.expect.append(("tag", path, t, t in wanted))
        if sorted(have) != sorted(wanted):
            self.changes.append(f"'{path}' now has Tags: {', '.join(wanted) or '(none)'}.")

    def op_nest(self, op, on=True):
        child = self.tag_name(op.get("tag"), may_be_new=False)
        parent = self.tag_name(op.get("parent"), may_be_new=on)
        if child == TAG_STORAGE:
            raise Refused("Tag storage can't be put inside another Tag.")
        if not on:
            if parent not in self.doc.parents_of(child):
                self.note(f"'{child}' is not in '{parent}'.")
                return
            self.doc.set_parents(child, self.doc.parents_of(child) - {parent})
            self.expect.append(("nest", child, parent, False))
            self.changes.append(f"Took '{child}' out of '{label(parent)}'.")
            return
        if parent in self.doc.parents_of(child):
            self.note(f"'{child}' is already in '{label(parent)}'.")
            return
        if child == parent or self.doc.holds(child, parent):
            raise Refused(f"'{child}' already holds '{label(parent)}', so it can't go inside it (that would be a loop).")
        why = self.doc.lock_refuses_tag(parent, child)
        if why:
            raise Refused(why)
        self.doc.set_parents(child, self.doc.parents_of(child) | {parent})
        self.expect.append(("nest", child, parent, True))
        self.changes.append(f"Put '{child}' in '{label(parent)}'.")
        # A Tag put in a held Tag is held too, with what it holds.
        if self.doc.lockers(parent):
            for t in [child] + sorted(self.doc.descendants(child)):
                if self.doc.has_flag(t, "use-anywhere"):
                    self.doc.set_flag(t, "use-anywhere", False)
                    self.changes.append(f"'{t}' is no longer use-anywhere (it is inside '{label(parent)}', which is held to its place).")

    def op_flag(self, op):
        tag = self.tag_name(op.get("tag"), may_be_new=False)
        flag = str(op.get("flag") or "").strip().lower()
        if flag in RETIRED_FLAGS:
            raise Refused(
                f"'{flag}' is gone: every Tag is now held to the place its content is in "
                "(one Model's Sets, or Models). The only switch is 'use-anywhere', which frees a Tag."
            )
        if flag not in FLAGS:
            raise Refused(f"Unknown flag '{flag}'. Flags: {', '.join(FLAGS)}.")
        on = bool(op.get("on", True))
        if tag == TAG_STORAGE and flag == "exclusive":
            raise Refused("Tag storage is always Exclusive.")
        if tag == TAG_STORAGE and flag == "use-anywhere":
            raise Refused("Tag storage holds Tags from anywhere already.")
        if flag == "use-anywhere":
            # Passes down to the Tags it holds, as in the app.
            changed = 0
            for t in [tag] + sorted(self.doc.descendants(tag)):
                if self.doc.has_flag(t, flag) != on:
                    self.doc.set_flag(t, flag, on)
                    changed += 1
            if changed:
                self.changes.append(
                    f"{'Set' if on else 'Cleared'} {flag} on '{tag}'"
                    + (f" and {plural(changed - 1, 'Tag')} inside it." if changed > 1 else ".")
                )
            else:
                self.note(f"'{tag}' is already {'' if on else 'not '}{flag}.")
        else:
            if self.doc.has_flag(tag, flag) == on:
                self.note(f"'{tag}' is already {'' if on else 'not '}{flag}.")
                return
            self.doc.set_flag(tag, flag, on)
            self.changes.append(f"'{tag}' is {'now' if on else 'no longer'} {flag}.")
        self.expect.append(("flag", tag, flag, on))

    def op_hide_media(self, op):
        tag = self.tag_name(op.get("tag"), may_be_new=False)
        types = [str(t).strip().lower() for t in (op.get("types") or [])]
        types = [t for t in types if t not in ("", "none")]
        bad = [t for t in types if t not in MEDIA_TYPES]
        if bad:
            raise Refused(f"Unknown media type {bad[0]!r}. Types: {', '.join(MEDIA_TYPES)}.")
        if set(types) == set(MEDIA_TYPES):
            raise Refused("Hiding images, videos and text would leave the Tag showing nothing.")
        if self.doc.hidden_media(tag) == [t for t in MEDIA_TYPES if t in types]:
            self.note(f"'{tag}' already hides {', '.join(types) or 'nothing'}.")
            return
        self.doc.set_hidden_media(tag, types)
        self.changes.append(
            f"'{tag}' now hides {', '.join(types)}." if types else f"'{tag}' shows every media type again."
        )

    def op_contents(self, op):
        # Contents rules can no longer be made (the app turns any it finds into
        # ordinary tags); an old one can still be taken away with --off.
        if bool(op.get("on", True)):
            raise Refused(
                "Contents rules are gone: tag the folders themselves with `add` "
                "(a Model's Sets: `sets MODEL --json` lists them)."
            )
        tag = self.tag_name(op.get("tag"), may_be_new=bool(op.get("on", True)))
        if tag == TAG_STORAGE:
            raise Refused("Tag storage holds only Tags.")
        src = str(op.get("source") or "").strip()
        if src in (":root", "/"):
            key, children = "dir:", self.lib.models()
        elif src.lower().startswith("tag:"):
            name = self.tag_name(src[4:], may_be_new=False)
            if name == tag:
                raise Refused("A Tag's contents can't be put in the Tag itself.")
            key, children = f"tag:{name}", None
        else:
            path = self.folder(src)
            if "/" in path:
                raise Refused(f"'{path}' is a Set; its contents are files. Contents rules take a Model, ':root' or 'tag:NAME'.")
            key, children = f"dir:{path}", self.lib.child_dirs(path)
        on = bool(op.get("on", True))
        rules = self.doc.content_rules()
        have = rules.get(key, [])
        if on == (tag in have):
            self.note(f"The contents of {key} are {'already' if on else 'not'} in '{tag}'.")
            return
        if on:
            if children is not None:
                why = self.doc.lock_refuses_paths(tag, children)
            else:
                why = self.doc.lock_refuses_tag(tag, key[4:])
            if why:
                raise Refused(why)
        self.doc.set_content_rule(key, (have + [tag]) if on else [t for t in have if t != tag])
        self.changes.append(
            f"{'Added' if on else 'Removed'} the rule: the contents of {key} {'are' if on else 'are no longer'} in '{tag}'."
        )

    def op_marker(self, op, marker, word):
        on = bool(op.get("on", True))
        paths = self.folders(op, must_exist=on, allow_trash=not on)
        n = 0
        for p in paths:
            tags = self.doc.tags_of(p)
            if (marker in tags) == on:
                continue
            self.doc.set_tags(p, ([marker] + tags) if on else [t for t in tags if t != marker])
            self.expect.append(("tag", p, marker, on))
            n += 1
        if n:
            self.changes.append(f"{'Marked' if on else 'Unmarked'} {plural(n, 'folder')} {word}.")

    def rekey(self, old, new):
        """Moves everything in the tags document filed under `old` to `new`."""
        moved = 0
        folders = self.doc.folders
        for path in [p for p in list(folders) if under(p, old)]:
            target = remap_prefix(path, old, new)
            src = folders.pop(path)
            dst = folders.get(target)
            if isinstance(dst, dict) and normalize_tag_list(dst.get("tags")):
                merged = normalize_tag_list(dst.get("tags")) + normalize_tag_list(src.get("tags"))
                dst["tags"] = normalize_tag_list(merged)
                self.note(f"'{target}' already had Tags; the ones from '{path}' were added to them.")
            else:
                folders[target] = src
            moved += 1
        for mapkey, prefix in (("contentTags", "dir:"), ("scoreFilterOverrides", "dir:"), ("folderMediaFilterByPath", "")):
            m = self.doc.d[mapkey]
            for key in [k for k in list(m) if k.startswith(prefix) and under(k[len(prefix):], old)]:
                m[prefix + remap_prefix(key[len(prefix):], old, new)] = m.pop(key)
                moved += 1
        if moved:
            self.doc.dirty()
        return moved

    def op_moved(self, op, do_move=False):
        old = nfc(norm_rel(op.get("from")))
        new_raw = op.get("to")
        if not old or not norm_rel(new_raw):
            raise Refused("A move needs 'from' and 'to'.")
        if is_trash(old) or is_trash(norm_rel(new_raw)):
            raise Refused("Moves into or out of the Trash are made in the app (use `trash`, or Put Back in the app).")
        if len(old.split("/")) > 2 or len(norm_rel(new_raw).split("/")) > 2:
            raise Refused("Only Models and Sets move: paths are Model or Model/Set.")
        if len(old.split("/")) != len(norm_rel(new_raw).split("/")):
            raise Refused("A Model stays a Model and a Set stays a Set: 'from' and 'to' must be the same depth.")
        if do_move:
            src = self.lib.root / old
            dst = self.lib.root / nfc(norm_rel(new_raw))
            if not src.is_dir():
                raise Refused(f"No folder '{old}' to move.")
            if dst.exists():
                raise Refused(f"'{norm_rel(new_raw)}' already exists. Nothing was moved.")
            if not dst.parent.is_dir():
                raise Refused(f"'{dst.parent.relative_to(self.lib.root)}' does not exist.")
            if self.lib.alt_labels(old):
                raise Refused(f"'{old}' has ALT versions ({', '.join(self.lib.alt_labels(old))}). Rename it in the app, which moves them together.")
            self.disk_moves.append((old, nfc(norm_rel(new_raw))))
            new = nfc(norm_rel(new_raw))
        else:
            if (self.lib.root / old).is_dir():
                raise Refused(f"'{old}' is still on disk, so it has not moved. Use `move` to move it.")
            new = self.folder(new_raw)
        n = self.rekey(old, new)
        self.knowledge_moves.append((old, new))
        self.app_ops.append({"kind": "folder-moved", "from": old, "to": new})
        self.changes.append(
            f"{'Moving' if do_move else 'Recorded the move of'} '{old}' to '{new}'"
            + (f" ({plural(n, 'tags entry', 'tags entries')} moved with it)." if n else ".")
        )

    def op_rename_tag(self, op):
        old = self.tag_name(op.get("from"), may_be_new=False)
        new = normalize_tag(op.get("to"))
        if old == TAG_STORAGE:
            raise Refused("Tag storage can't be renamed.")
        if not new or "," in new or new in MARKERS or new in INTERNAL_TAGS or (new.startswith("__") and new.endswith("__")):
            raise Refused(f"'{op.get('to')}' can't be a Tag name.")
        if new == old:
            raise Refused("That is already its name.")
        if self.doc.tag_exists(new):
            raise Refused(f"A Tag named '{new}' already exists. Tags are not merged by renaming; move its folders with add/remove instead.")
        self.app_ops.append({"kind": "rename-tag", "from": old, "to": new})
        self.changes.append(f"Asked the app to rename '{old}' to '{new}'.")

    def op_delete_tag(self, op):
        tag = self.tag_name(op.get("tag"), may_be_new=False)
        if tag == TAG_STORAGE:
            raise Refused("Tag storage can't be deleted.")
        self.app_ops.append({"kind": "delete-tag", "tag": tag})
        self.changes.append(f"Asked the app to delete the Tag '{tag}' (no folder or file is touched).")

    def op_trash(self, op):
        paths = self.folders(op)
        for p in paths:
            if STORAGE in self.doc.tags_of(p):
                raise Refused(f"'{p}' is in Storage. Take it out of Storage first.")
        if paths:
            self.app_ops.append({"kind": "trash", "paths": paths})
            self.changes.append(f"Asked the app to move {plural(len(paths), 'folder')} to its Trash (reversible there with Put Back).")

    def op_storage(self, op):
        on = bool(op.get("on", True))
        paths = self.folders(op)
        if on:
            paths = [p for p in paths if STORAGE not in self.doc.tags_of(p)]
        else:
            paths = [p for p in paths if STORAGE in self.doc.tags_of(p)]
        if paths:
            self.app_ops.append({"kind": "storage", "paths": paths, "on": on})
            self.changes.append(f"Asked the app to {'send' if on else 'take'} {plural(len(paths), 'folder')} {'to' if on else 'out of'} Storage.")

    def apply(self, op):
        kind = str(op.get("op") or "").strip().lower()
        handler = {
            "add": self.op_add,
            "remove": self.op_remove,
            "set-tags": self.op_set_tags,
            "nest": lambda o: self.op_nest(o, True),
            "unnest": lambda o: self.op_nest(o, False),
            "flag": self.op_flag,
            "hide-media": self.op_hide_media,
            "contents": self.op_contents,
            "favorite": lambda o: self.op_marker(o, FAVORITE, "as Favorites"),
            "hide": lambda o: self.op_marker(o, HIDDEN, "Hidden"),
            "moved": lambda o: self.op_moved(o, False),
            "move": lambda o: self.op_moved(o, True),
            "rename-tag": self.op_rename_tag,
            "delete-tag": self.op_delete_tag,
            "trash": self.op_trash,
            "storage": self.op_storage,
        }.get(kind)
        if not handler:
            raise Refused(f"Unknown change '{kind}'. Changes: {', '.join(ALL_OPS)}.")
        handler(op)


def label(tag):
    return "Tag storage" if tag == TAG_STORAGE else tag


def blocked_by_pending(lib, ops):
    """Direct changes that would race a request the app has not finished."""
    tags, paths = set(), []
    for req in pending_requests(lib):
        for o in req.get("ops") or []:
            if o.get("kind") == "rename-tag":
                tags.update([o.get("from"), o.get("to")])
            elif o.get("kind") == "delete-tag":
                tags.add(o.get("tag"))
            elif o.get("kind") in ("trash", "storage"):
                paths.extend(o.get("paths") or [])
    for op in ops:
        kind = op.get("op") if isinstance(op, dict) else None
        if not kind:
            continue
        names = [op.get("tag"), op.get("parent")]
        if kind == "rename-tag":
            names += [op.get("from"), op.get("to")]
        if kind == "contents" and str(op.get("source") or "").lower().startswith("tag:"):
            names.append(str(op.get("source"))[4:])
        for v in names:
            v = normalize_tag(v)
            if v and v in tags:
                return f"The app has not finished a rename or delete of the Tag '{v}' yet."
        folders = list(op.get("paths") or []) + [op.get("path"), op.get("from"), op.get("to")]
        for p in folders:
            if not p:
                continue
            for q in paths:
                if under(norm_rel(p), q):
                    return f"The app has not finished moving '{q}' (Trash or Storage) yet."
    return None


def run_changes(lib, ops, opts):
    """Checks every change, then writes them all or nothing. Returns an exit code.

    When the open app saved over the change in the same moment, the change is
    made once more on top of the app's version (changes that can be)."""
    opts = dict(opts)
    code = write_changes(lib, ops, opts)
    if opts.get("reapply"):
        print("Applying the same change again on top of the app's version:")
        code = write_changes(lib, ops, dict(opts, reapply=False, clash_retry=True))
    return code


def write_changes(lib, ops, opts):
    out = Out(opts)
    if not ops:
        out.line("Nothing to do.")
        return 0
    why = blocked_by_pending(lib, ops)
    if why:
        out.fail(why + " Open Local Gallery so it can finish (run `requests` to see what is waiting), then try again.")
        return 1
    own = {o.get("tag") for o in ops if o.get("op") in ("rename-tag", "delete-tag")}
    own |= {o.get("from") for o in ops if o.get("op") == "rename-tag"}
    own |= {o.get("to") for o in ops if o.get("op") == "rename-tag"}
    own = {normalize_tag(t) for t in own if t}
    if own and any(
        o.get("op") not in APP_OPS and normalize_tag(o.get("tag")) in own for o in ops
    ):
        out.fail("A Tag that this batch renames or deletes is also changed in the same batch. Do the rename or delete in its own run, after the rest.")
        return 1

    written = None
    with ToolLock(lib):
        for attempt in range(6):
            lib._listing = {}
            doc = TagsDoc(lib)
            run = Run(lib, doc, opts)
            try:
                for op in ops:
                    if not isinstance(op, dict):
                        raise Refused(f"Not a change: {op!r}")
                    run.apply(op)
            except Refused as e:
                out.fail(str(e) + " Nothing was written.")
                return 1
            direct = doc.modified
            if opts.get("dry_run"):
                out.line("Dry run, nothing written. This would:")
                out.items(run.changes or ["change nothing"])
                out.section("Notes", run.notes)
                out.section("Refused (would be skipped)", run.refusals)
                return 0
            if not run.changes:
                out.line("Nothing changed: everything was already that way.")
                out.section("Notes", run.notes)
                out.section("Refused (skipped)", run.refusals)
                return 0 if not run.refusals else 1
            # Disk moves first: if one fails nothing else has happened yet.
            done_moves = []
            try:
                for old, new in run.disk_moves:
                    os.rename(lib.root / old, lib.root / new)
                    done_moves.append((old, new))
            except OSError as e:
                for old, new in reversed(done_moves):
                    try:
                        os.rename(lib.root / new, lib.root / old)
                    except OSError:
                        pass
                out.fail(f"Moving a folder failed ({e}). Nothing was changed.")
                return 1
            sha = None
            journal = {"kind": "change", "ops": ops, "changes": run.changes, "by": f"lg.py v{TOOL_VERSION}"}
            try:
                if direct or run.disk_moves:
                    sha = save_doc(doc, journal)
            except FileChanged:
                # Someone saved the tags file meanwhile: start over from what is
                # there now. Folders already moved are recorded as moved.
                moved = {(o, n) for o, n in done_moves}
                ops = [
                    dict(o, op="moved")
                    if isinstance(o, dict) and o.get("op") == "move"
                    and (nfc(norm_rel(o.get("from"))), nfc(norm_rel(o.get("to")))) in moved
                    else o
                    for o in ops
                ]
                time.sleep(0.3)
                continue
            rid = queue_request(lib, run.app_ops) if run.app_ops else None
            for old, new in run.knowledge_moves:
                for note in knowledge_follow_move(lib, old, new):
                    run.note(f"'{new}': {note}")
            if rid and not sha:
                append_journal(lib, {"kind": "request", "request": rid, "ops": ops, "changes": run.changes})
            written = (run, sha, rid)
            break
    if not written:
        out.fail("The tags file kept changing while this ran (is the app saving a lot right now?). Nothing was written. Try again.")
        return 1
    # Waiting for the app happens outside the lock, so other runs can go on.
    run, sha, rid = written
    clashed = report_written(lib, out, run, sha, rid, opts)
    if clashed and not opts.get("clash_retry") and all(
        o.get("op") in REAPPLIABLE_OPS for o in ops
    ):
        opts["reapply"] = True
    return 0 if not run.refusals else 1


def report_written(lib, out, run, sha, rid, opts):
    """Prints the outcome. Answers True when the app wrote over the change."""
    clashed = False
    status = app_status(lib)
    out.line("Done." if not run.refusals else "Done, with some changes skipped.")
    out.items(run.changes)
    out.section("Notes", run.notes)
    out.section("Refused (skipped)", run.refusals)
    if sha:
        if status["ready"] and not opts.get("no_wait"):
            got = wait_for_app_load(lib, sha, 20, run.expect)
            if got == "loaded":
                out.line("Local Gallery has loaded the change.")
            elif got == "conflict":
                clashed = True
                out.line("Local Gallery saved a change of its own at the same moment, over this one (a copy of this one is in .local-gallery/ai/conflicts).")
            else:
                why = ((app_status(lib).get("raw") or {}).get("waitingBecause") or "").strip()
                out.line(
                    "Local Gallery is open but has not loaded the change yet"
                    + (f" (it waits while {why})" if why else "")
                    + ". It picks it up by itself; run `status` to check."
                )
        elif status["open"]:
            out.line("Local Gallery is open but locked or still opening; it reads the change once the library opens.")
        else:
            out.line("Local Gallery is not open; it reads the change the next time it opens.")
        failed = verify_expectations(lib, run.expect)
        if failed and not clashed:
            out.line("WARNING: after writing, these are not as expected:")
            out.items(failed)
    if rid:
        if status["ready"] and not opts.get("no_wait"):
            res = wait_for_result(lib, rid, 180)
            if res is None:
                out.line(f"The app has not finished request {rid} yet. Run `requests` to see when it does.")
            else:
                out.line("Local Gallery finished the request:")
                out.items([("ok: " if r.get("ok") else "FAILED: ") + str(r.get("message") or "") for r in res.get("results") or []])
        else:
            out.line(f"Queued request {rid}. Local Gallery finishes it the next time it is open with the library unlocked. Run `requests` to check.")
    return clashed


def verify_expectations(lib, expect):
    if not expect:
        return []
    lib._listing = {}
    doc = TagsDoc(lib)
    failed = []
    for kind, a, b, present in expect:
        if kind == "tag" and (b in doc.tags_of(a)) != present:
            failed.append(f"'{a}' should {'' if present else 'not '}have '{b}'.")
        elif kind == "nest" and (b in doc.parents_of(a)) != present:
            failed.append(f"'{a}' should {'' if present else 'not '}be in '{b}'.")
        elif kind == "flag" and doc.has_flag(a, b) != present:
            failed.append(f"'{a}' should {'' if present else 'not '}be {b}.")
    return failed


# --- output ----------------------------------------------------------------------------


class Out:
    def __init__(self, opts):
        self.json = bool(opts.get("json"))

    def line(self, s=""):
        print(s)

    def items(self, rows):
        for r in rows:
            print(f"  - {r}")

    def section(self, title, rows):
        if rows:
            print(f"{title}:")
            self.items(rows)

    def fail(self, s):
        print(f"Refused: {s}")


def dump(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=1))


# --- read-only commands ---------------------------------------------------------------


def folder_record(lib, doc, path, scores=None, counts=False):
    tags = doc.tags_of(path)
    rules = []
    parent = path.rpartition("/")[0]
    for key, rtags in doc.content_rules().items():
        if key == f"dir:{parent}":
            rules.extend(rtags)
    rec = {
        "path": path,
        "kind": "Model" if "/" not in path else "Set",
        "tags": [t for t in tags if t not in MARKERS],
        "tagsFromContentsRules": sorted(set(rules) - set(tags)),
        "favorite": FAVORITE in tags,
        "hidden": HIDDEN in tags,
        "storage": STORAGE in tags,
        "onDisk": lib.exists(path),
    }
    if lib.alt_labels(path):
        rec["alts"] = lib.alt_labels(path)
    if scores is not None:
        rec["score"] = scores.get(path)
    if counts:
        rec["files"] = lib.file_counts(path)
    return rec


def load_scores(lib):
    try:
        d = json.loads((lib.meta / SCORES_FILE).read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    out = {}
    for path, entry in (d.get("folders") or {}).items():
        if isinstance(entry, dict) and isinstance(entry.get("score"), (int, float)):
            out[path] = entry["score"]
    return out


def tag_record(lib, doc, tag, full=False):
    members = doc.members(tag)
    direct = set(doc.direct_members(tag))
    rec = {
        "name": tag,
        "label": label(tag),
        "folders": len(members),
        "parents": sorted(label(p) for p in doc.parents_of(tag)),
        "holdsTags": sorted(doc.children_of(tag)),
        "exclusive": doc.has_flag(tag, "exclusive"),
        "useAnywhere": doc.has_flag(tag, "use-anywhere"),
        "heldTo": doc.held_to(tag),
        "hidden": doc.has_flag(tag, "hidden"),
        "hidesMedia": doc.hidden_media(tag),
    }
    place = doc.placement(tag)
    rec["cardIn"] = None if place is None else (place or "(root)")
    if full:
        rules = doc.rule_members(tag)
        rec["members"] = [
            {"path": p, "via": "tagged" if p in direct else rules.get(p, "")} for p in members
        ]
        rec["contentsRules"] = sorted(k for k, v in doc.content_rules().items() if tag in v)
        trashed = [p for p in doc.direct_members(tag, include_trash=True) if is_trash(p)]
        if trashed:
            rec["inTrash"] = trashed
        gone = [p for p in direct if not lib.exists(p)]
        if gone:
            rec["rememberedButNotOnDisk"] = sorted(gone, key=natural_key)
        model = doc.single_model(tag)
        if model:
            rec["allSetsOf"] = model
    return rec


def cmd_status(lib, args):
    s = app_status(lib)
    doc = TagsDoc(lib)
    reqs = pending_requests(lib)
    journal = read_journal(lib)
    if args.json:
        dump({
            "library": str(lib.root),
            "app": s.get("raw"),
            "appOpen": s["open"],
            "appReady": s["ready"],
            "models": len(lib.models()),
            "tags": len(doc.tag_names()),
            "pendingRequests": reqs,
            "lastChange": journal[-1] if journal else None,
        })
        return 0
    print(f"Library: {lib.root}")
    if s["ready"]:
        raw = s["raw"] or {}
        loaded = (raw.get("tagsDoc") or {}).get("sha256") == doc.sha
        why = (raw.get("waitingBecause") or "").strip()
        print(f"Local Gallery: open, library loaded (version {raw.get('version') or '?'}). "
              + ("It has the current tags file." if loaded else "It has not loaded the newest tags file yet"
                 + (f" (it waits while {why})." if why else " (it checks every couple of seconds).")))
        conflict = raw.get("lastConflict") or {}
        if conflict.get("file"):
            print(f"Last clash between the app and an outside change: {conflict.get('file')} (in .local-gallery/ai).")
    elif s["open"]:
        print("Local Gallery: open, but locked or still opening.")
    else:
        print("Local Gallery: not open (or not a version that reports itself). Changes are read when it next opens.")
    print(f"{plural(len(lib.models()), 'Model')}, {plural(len(doc.tag_names()), 'Tag')}.")
    if reqs:
        print(f"Waiting for the app: {plural(len(reqs), 'request')} (run `requests`).")
    if journal:
        last = journal[-1]
        changes = last.get("changes") or [last.get("kind", "")]
        shown = " / ".join(changes[:3]) + (f" / and {len(changes) - 3} more" if len(changes) > 3 else "")
        print(f"Last change by an AI tool: {last.get('at')}: {shown}")
    kept = sorted(p.name for p in knowledge_root(lib).iterdir() if p.is_dir()) if knowledge_root(lib).is_dir() else []
    if kept:
        print(f"Contact sheets and set guides are kept for {plural(len(kept), 'Model')}: {', '.join(kept[:8])}"
              + (" ..." if len(kept) > 8 else "") + ". Run `knowledge` for what is new or out of date.")
    print("Instructions: " + str(lib.meta / INSTRUCTIONS_FILE))
    return 0


def cmd_tags(lib, args):
    doc = TagsDoc(lib)
    names = sorted(doc.tag_names(), key=natural_key)
    recs = [tag_record(lib, doc, t) for t in names]
    if args.sort == "count":
        recs.sort(key=lambda r: -r["folders"])
    if args.json:
        dump(recs)
        return 0
    for r in recs:
        flags = [k for k in ("exclusive", "useAnywhere", "hidden") if r[k]]
        if r["heldTo"]:
            flags.append("takes " + r["heldTo"] + " only")
        if r["hidesMedia"]:
            flags.append("hides " + "+".join(r["hidesMedia"]))
        bits = [plural(r["folders"], "folder")]
        if r["holdsTags"]:
            bits.append(f"holds {plural(len(r['holdsTags']), 'Tag')}")
        if r["parents"]:
            bits.append("in " + ", ".join(r["parents"]))
        if flags:
            bits.append(", ".join(flags))
        bits.append("card in " + (r["cardIn"] or "nowhere (empty)"))
        print(f"{r['label']}  --  " + "; ".join(bits))
    print(f"\n{plural(len(recs), 'Tag')}.")
    return 0


def cmd_tag(lib, args):
    doc = TagsDoc(lib)
    tag = TAG_STORAGE if args.name == TAG_STORAGE_ALIAS else normalize_tag(args.name)
    if not doc.tag_exists(tag):
        close = difflib.get_close_matches(tag, sorted(doc.tag_names()), n=5, cutoff=0.5)
        print(f"There is no Tag '{tag}'." + (f" Close names: {', '.join(repr(c) for c in close)}." if close else ""))
        return 1
    rec = tag_record(lib, doc, tag, full=True)
    if args.json:
        dump(rec)
        return 0
    print(f"Tag '{rec['label']}'")
    for k in ("exclusive", "useAnywhere", "hidden"):
        if rec[k]:
            print(f"  {k}")
    if rec["heldTo"]:
        print(f"  takes {rec['heldTo']} only")
    if rec["hidesMedia"]:
        print(f"  hides: {', '.join(rec['hidesMedia'])}")
    print(f"  card shows in: {rec['cardIn'] or 'nowhere (it holds nothing that exists)'}")
    if rec["parents"]:
        print(f"  inside: {', '.join(rec['parents'])}")
    if rec["holdsTags"]:
        print(f"  holds Tags: {', '.join(rec['holdsTags'])}")
    if rec["contentsRules"]:
        print(f"  contents rules: {', '.join(rec['contentsRules'])}")
    print(f"  {plural(len(rec['members']), 'folder')}:")
    for m in rec["members"]:
        print(f"    {m['path']}" + ("" if m["via"] == "tagged" else f"   (through {m['via']})"))
    for key, title in (("inTrash", "in the Trash"), ("rememberedButNotOnDisk", "remembered, not on disk")):
        if rec.get(key):
            print(f"  {title}: {len(rec[key])}")
            for p in rec[key][:20]:
                print(f"    {p}")
    return 0


def cmd_show(lib, args):
    doc = TagsDoc(lib)
    scores = load_scores(lib)
    out = []
    for raw in args.paths:
        try:
            path, notes = lib.resolve(raw, must_exist=False, allow_trash=True, known=doc.folders)
        except Refused as e:
            print(f"{raw}: {e}")
            continue
        rec = folder_record(lib, doc, path, scores=scores, counts=True)
        if notes:
            rec["notes"] = notes
        out.append(rec)
    if args.json:
        dump(out)
        return 0
    for r in out:
        print(r["path"] + f"  ({r['kind']}{'' if r['onDisk'] else ', not on disk'})")
        print(f"  tags: {', '.join(r['tags']) or '(none)'}")
        if r["tagsFromContentsRules"]:
            print(f"  also in (contents rule on its Model): {', '.join(r['tagsFromContentsRules'])}")
        marks = [k for k in ("favorite", "hidden", "storage") if r[k]]
        if marks:
            print(f"  {', '.join(marks)}")
        print(f"  score: {r.get('score', 0) or 0}")
        f = r["files"]
        if r["kind"] == "Set":
            print(f"  files: {f['images']} images, {f['videos']} videos, {f['text']} text")
        else:
            print(f"  sets: {len(lib.sets(r['path']))}")
        if r.get("alts"):
            print(f"  ALT versions: {', '.join(r['alts'])}")
        for n in r.get("notes") or []:
            print(f"  note: {n}")
    return 0


def cmd_models(lib, args):
    doc = TagsDoc(lib)
    recs = []
    for m in lib.models():
        rec = folder_record(lib, doc, m)
        rec["sets"] = len(lib.sets(m))
        recs.append(rec)
    if args.json:
        dump(recs)
        return 0
    for r in recs:
        print(f"{r['path']}  --  {plural(r['sets'], 'Set')}; tags: {', '.join(r['tags']) or '(none)'}")
    return 0


def cmd_sets(lib, args):
    doc = TagsDoc(lib)
    if args.model:
        model, notes = lib.resolve(args.model)
        if "/" in model:
            print(f"'{model}' is a Set, not a Model.")
            return 1
        sets = lib.sets(model)
    else:
        sets = lib.all_sets()
    recs = [folder_record(lib, doc, s, counts=args.counts) for s in sets]
    if args.untagged:
        recs = [r for r in recs if not r["tags"] and not r["tagsFromContentsRules"]]
    if args.tagged_with:
        t = normalize_tag(args.tagged_with)
        recs = [r for r in recs if t in r["tags"] or t in r["tagsFromContentsRules"]]
    if args.json:
        dump(recs)
        return 0
    for r in recs:
        print(f"{r['path']}  --  {', '.join(r['tags']) or '(no tags)'}")
    print(f"\n{plural(len(recs), 'Set')}.")
    return 0


def cmd_find(lib, args):
    doc = TagsDoc(lib)
    needle = nfc(args.text).casefold()
    hits = {"models": [], "sets": [], "tags": []}
    for m in lib.models():
        if needle in nfc(m).casefold():
            hits["models"].append(m)
        for s in lib.sets(m):
            if needle in nfc(s.split("/", 1)[1]).casefold():
                hits["sets"].append(s)
    hits["tags"] = sorted((t for t in doc.tag_names() if needle in t), key=natural_key)
    if args.json:
        dump(hits)
        return 0
    for k in ("models", "sets", "tags"):
        if hits[k]:
            print(f"{k.capitalize()} ({len(hits[k])}):")
            for h in hits[k][:200]:
                print(f"  {h}")
    if not any(hits.values()):
        print("Nothing found.")
    return 0


def cmd_export(lib, args):
    doc = TagsDoc(lib)
    scores = load_scores(lib)
    data = {
        "library": str(lib.root),
        "exportedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "models": [],
        "tags": [tag_record(lib, doc, t) for t in sorted(doc.tag_names(), key=natural_key)],
    }
    for m in lib.models():
        rec = folder_record(lib, doc, m, scores=scores)
        rec["sets"] = [folder_record(lib, doc, s, scores=scores, counts=args.counts) for s in lib.sets(m)]
        data["models"].append(rec)
    text = json.dumps(data, ensure_ascii=False, indent=1)
    if args.out:
        Path(args.out).write_text(text, "utf-8")
        print(f"Wrote {args.out}.")
    else:
        print(text)
    return 0


def cmd_check(lib, args):
    doc = TagsDoc(lib)
    problems, info = [], []
    names = doc.tag_names()
    # Loops in Tag-in-Tag.
    for t in names:
        if doc.holds(t, t):
            problems.append(f"'{t}' holds itself through other Tags (a loop).")
    # Names that differ only in spacing or punctuation.
    by_squash = {}
    for t in names:
        by_squash.setdefault(squash(t), []).append(t)
    for group in by_squash.values():
        if len(group) > 1:
            info.append("Tags that differ only in spaces or punctuation: " + ", ".join(repr(g) for g in sorted(group)))
    # Tags nobody can see.
    for t in sorted(names, key=natural_key):
        if t not in INTERNAL_TAGS and doc.placement(t) is None:
            info.append(f"'{t}' holds nothing that exists, so the app does not draw it.")
    # Folders that would take back Tags by fingerprint.
    for path, entry in doc.folders.items():
        if isinstance(entry, dict) and not normalize_tag_list(entry.get("tags")) and doc.fp_twins(path) and lib.exists(path):
            problems.append(f"'{path}' has no Tags but shares a fingerprint with {doc.fp_twins(path)[0]!r}; the app may copy that folder's Tags onto it.")
    # Tagged folders that are deeper than a Set.
    for path, entry in doc.folders.items():
        if isinstance(entry, dict) and normalize_tag_list(entry.get("tags")) and not is_trash(path) and len(path.split("/")) > 2:
            info.append(f"'{path}' is deeper than Model/Set and has Tags.")
    reqs = pending_requests(lib)
    if reqs:
        info.append(f"{plural(len(reqs), 'request')} waiting for the app.")
    if args.json:
        dump({"problems": problems, "info": info})
        return 0 if not problems else 1
    print("The tags file reads correctly (schema %s, %s)." % (doc.d.get("schema"), plural(len(doc.folders), "folder entry", "folder entries")))
    print("Problems:" if problems else "No problems.")
    for p in problems:
        print(f"  - {p}")
    if info:
        print("Worth knowing:")
        for p in info[: args.limit]:
            print(f"  - {p}")
        if len(info) > args.limit:
            print(f"  ... and {len(info) - args.limit} more (--limit).")
    return 0 if not problems else 1


def cmd_journal(lib, args):
    entries = read_journal(lib)[-args.n:]
    if args.json:
        dump(entries)
        return 0
    if not entries:
        print("No changes have been made with lg.py yet.")
    for e in entries:
        print(f"{e.get('at')}  [{e.get('id')}] {e.get('kind')}")
        for c in e.get("changes") or []:
            print(f"    {c}")
    return 0


def cmd_requests(lib, args):
    reqs = pending_requests(lib)
    res = recent_results(lib, args.n)
    if args.json:
        dump({"pending": reqs, "recent": res})
        return 0
    s = app_status(lib)
    if reqs:
        print(f"Waiting for the app ({'it is open' if s['ready'] else 'it is not open with the library loaded'}):")
        for r in reqs:
            print(f"  {r.get('id')}: " + "; ".join(describe_app_op(o) for o in r.get("ops") or []))
    else:
        print("Nothing is waiting for the app.")
    if res:
        print("Finished recently:")
        for r in res:
            print(f"  {r.get('id')}:")
            for x in r.get("results") or []:
                print(f"    {'ok' if x.get('ok') else 'FAILED'}: {x.get('message')}")
    return 0


def describe_app_op(o):
    k = o.get("kind")
    if k == "folder-moved":
        return f"follow the move of '{o.get('from')}' to '{o.get('to')}'"
    if k == "rename-tag":
        return f"rename Tag '{o.get('from')}' to '{o.get('to')}'"
    if k == "delete-tag":
        return f"delete Tag '{o.get('tag')}'"
    if k == "trash":
        return f"move {plural(len(o.get('paths') or []), 'folder')} to the Trash"
    if k == "collages":
        return f"make collages for {plural(len(o.get('sets') or []), 'Set')} of '{o.get('model')}'" if o.get("sets") else f"make collages for every Set of '{o.get('model')}'"
    if k == "storage":
        return f"{'send' if o.get('on') else 'take'} {plural(len(o.get('paths') or []), 'folder')} {'to' if o.get('on') else 'out of'} Storage"
    return str(k)


def cmd_verify(lib, args):
    entries = [e for e in read_journal(lib) if e.get("kind") in ("change", "undo")]
    if not entries:
        print("No changes to verify.")
        return 0
    last = entries[-1]
    doc = TagsDoc(lib)
    if doc.sha == last.get("afterSha256"):
        print(f"The tags file is exactly as the last change [{last.get('id')}] left it.")
        return 0
    print(f"The tags file has changed since the last change [{last.get('id')}] (the app or someone else saved after it).")
    print("That is normal when the app has been used since. To check particular folders, use `show`.")
    return 0


def cmd_undo(lib, args):
    entries = read_journal(lib)
    undone = {e.get("undid") for e in entries if e.get("kind") == "undo"}
    target = None
    for e in reversed(entries):
        if e.get("kind") == "change" and e.get("backup") and e.get("id") not in undone:
            target = e
            break
    if not target:
        print("There is no change made with lg.py left to undo.")
        return 1
    with ToolLock(lib):
        doc = TagsDoc(lib)
        if doc.sha != target.get("afterSha256") and not args.force:
            print(
                f"Refused: the tags file has changed since change [{target.get('id')}] "
                f"({'; '.join(target.get('changes') or [])}). Undoing it would also throw away "
                "what changed after it. Pass --force to do that anyway, or undo by hand with "
                "the opposite command."
            )
            return 1
        backup = lib.ai / "backups" / target["backup"]
        try:
            with gzip.open(backup, "rb") as f:
                old = f.read()
        except OSError:
            print(f"Refused: the backup {backup} is gone.")
            return 1
        json.loads(old.decode("utf-8"))
        if args.dry_run:
            print("Dry run: would put back the tags file from before:")
            for c in target.get("changes") or []:
                print(f"  - {c}")
            return 0
        st = os.stat(doc.path)
        if (st.st_size, st.st_mtime_ns) != doc.sig:
            print("Refused: the tags file changed just now. Try again.")
            return 1
        backups = lib.ai / "backups"
        name = f"{stamp()}-{uuid.uuid4().hex[:6]}.tags.log.json.gz"
        with gzip.open(backups / name, "wb") as f:
            f.write(doc.raw)
        atomic_write(doc.path, old)
        append_journal(lib, {
            "kind": "undo",
            "undid": target.get("id"),
            "changes": [f"Undid [{target.get('id')}]: " + "; ".join(target.get("changes") or [])],
            "backup": name,
            "beforeSha256": doc.sha,
            "afterSha256": sha256_bytes(old),
        })
    print(f"Undone [{target.get('id')}]:")
    for c in target.get("changes") or []:
        print(f"  - {c}")
    if app_status(lib)["ready"] and not args.no_wait:
        if wait_for_app_load(lib, sha256_bytes(old), 20) == "loaded":
            print("Local Gallery has loaded it.")
        else:
            print("Local Gallery has not loaded it yet; run `status` in a moment.")
    if any(o.get("op") in APP_OPS + ("move",) for o in target.get("ops") or []):
        print("Note: requests the app carried out (renames, deletes, Trash, Storage) and folder moves on disk are not undone by this. Reverse those with the opposite command.")
    return 0


def cmd_guide(lib, args):
    path = lib.meta / INSTRUCTIONS_FILE
    if not path.is_file():
        path = Path(__file__).resolve().parent / INSTRUCTIONS_FILE
    try:
        print(path.read_text("utf-8"))
    except OSError:
        print(f"The instructions (.local-gallery/{INSTRUCTIONS_FILE}) are missing. Open Local Gallery once and it writes them.")
        return 1
    return 0


# --- what AI assistants know about each Model -------------------------------------
#
# Kept in .local-gallery/ai/models/<Model>/ so it outlasts any one session and
# is never seen in the app:
#
#   sheets/<Set>.jpg            a contact sheet of every file in the Set ("collage");
#                               long Sets get "<Set> (sheet 1 of 2).jpg" and so on
#   set-guide.md                one written entry per Set, made from its sheets
#   index.json                  per Set: what its files were when the sheets were
#                               made and when it was described, so new and changed
#                               Sets can be found
#   notes/                      anything else worth keeping (decision lists...)
#   history/                    the guide before each change (gzip, 10 kept)
#
# Photo numbers p1, p2... are the Set's images in file-name order and v1, v2...
# its videos; the sheets and the guide use the same numbers.
#
# The app draws the same sheets itself (Folder options -> Create collage /
# Create collages for all sets, frontend/js/features/collages.js) and writes
# the same index records. Keep the SHEET_* layout, sheet_names, natural_key
# and set_media's signature in step with COLLAGE_LAYOUT, collageSheetNames,
# collageNaturalCompare and collageSignature there.

KNOWLEDGE_DIR = "models"
GUIDE_FILE = "set-guide.md"
INDEX_FILE = "index.json"
GUIDE_STATUS_PREFIX = "> Kept by lg.py:"
GUIDE_HISTORY_KEPT = 10

IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|gif|webp|tiff?|bmp|avif|heic)$", re.I)
VIDEO_EXT_RE = re.compile(r"\.(mp4|m4v|mov|wmv|flv|avi|webm|mkv)$", re.I)
TEXT_EXT_RE = re.compile(r"\.(md|markdown)$", re.I)

SHEET_WIDTH = 1440
SHEET_COLUMNS = 6
SHEET_CELL_H = 360
SHEET_LABEL_H = 18
SHEET_HEADER_H = 32
SHEET_ROWS_MAX = 4
SHEET_VIDEO_FRAMES = 6
SHEET_BG = (24, 24, 24)
SHEET_HEAD_INK = (250, 214, 60)
SHEET_LABEL_INK = (175, 175, 175)
SHEET_VIDEO_INK = (125, 190, 255)

# The fields every guide entry has. A guide may add its own after them (for a
# judgment a Tag depends on); extra fields are optional per entry.
STANDARD_FIELDS = [
    ("Concept", 'any theme, costume, story or scenario, or "None".'),
    ("Setting", "where it was shot and what is in the frame."),
    ("Outfit", "every garment and prop, in order of appearance."),
    ("Hair & accessories", "hair, makeup, jewelry, glasses and anything worn or held."),
    ("Body", "appearance as seen in this Set."),
    ("Poses & body language", "what happens, shot by shot (with photo numbers), and the mood."),
    ("Nudity", "how much is shown."),
    ("Camera", "photographer or selfie, light, color, format."),
]


def knowledge_root(lib):
    return lib.ai / KNOWLEDGE_DIR


def resolve_model(lib, raw):
    path, notes = lib.resolve(raw)
    if "/" in path:
        raise Refused(f"'{path}' is a Set. Give the Model it is in ('{path.split('/')[0]}').")
    return path


def set_media(lib, set_path):
    """The Set's files the way the app orders them, and a signature of them."""
    names = lib.listing(set_path) or {}
    images, videos, other = [], [], []
    for name, is_dir in names.items():
        if is_dir or name.startswith("."):
            continue
        if IMAGE_EXT_RE.search(name):
            images.append(name)
        elif VIDEO_EXT_RE.search(name):
            videos.append(name)
        elif TEXT_EXT_RE.search(name):
            other.append(name)
    images.sort(key=natural_key)
    videos.sort(key=natural_key)
    h = hashlib.sha1()
    for name in images + videos:
        try:
            size = os.stat(lib.root / set_path / name).st_size
        except OSError:
            size = -1
        h.update(f"{nfc(name)}|{size}\n".encode("utf-8"))
    return {"images": images, "videos": videos, "other": other, "signature": h.hexdigest()[:16]}


def set_date(name):
    m = re.match(r"^(\d{2})(\d{2})(\d{2})\b", name)
    if not m:
        return None
    yy, mm, dd = (int(x) for x in m.groups())
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return None
    return f"20{yy:02d}-{mm:02d}-{dd:02d}"


def default_heading(model, name):
    """`### 000001 · Title` from `yymmdd-[Creator-]NNNNNN[-flags] - Title`."""
    head, _, title = name.partition(" - ")
    title = title.strip()
    if not title or title.lower() == "postname":
        title = "(untitled)"
    parts = head.split("-")
    number = next((p for p in parts[1:] if re.fullmatch(r"\d{6}", p)), "")
    creator = next(
        (p for p in parts[1:] if p and not re.fullmatch(r"\d+", p) and p != model and p != "compressed"),
        "",
    )
    left = " ".join(x for x in (creator, number) if x)
    return f"### {left} · {title}" if left else f"### {title}"


def counts_text(n_img, n_vid):
    bits = []
    if n_img or not n_vid:
        bits.append(plural(n_img, "photo"))
    if n_vid:
        bits.append(plural(n_vid, "video"))
    return ", ".join(bits)


class Knowledge:
    """One Model's sheets, guide and index."""

    def __init__(self, lib, model):
        self.lib = lib
        self.model = model
        self.dir = knowledge_root(lib) / model
        self.sheets_dir = self.dir / "sheets"
        self.guide_path = self.dir / GUIDE_FILE
        self.index_path = self.dir / INDEX_FILE
        self.index = self._load_index()

    def _load_index(self):
        try:
            data = json.loads(self.index_path.read_text("utf-8"))
            if isinstance(data, dict) and isinstance(data.get("sets"), dict):
                return data
        except (OSError, ValueError):
            pass
        return {"schema": 1, "model": self.model, "sets": {}}

    def save_index(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        self.index["model"] = self.model
        self.index["updatedAt"] = datetime.datetime.now().isoformat(timespec="seconds")
        atomic_write(self.index_path, json.dumps(self.index, ensure_ascii=False, indent=1).encode("utf-8"))

    def record(self, set_name):
        return self.index["sets"].setdefault(set_name, {})

    def sets(self):
        return [s.split("/", 1)[1] for s in self.lib.sets(self.model)]

    def sheet_files(self, set_name):
        rec = self.index["sets"].get(set_name) or {}
        return [self.dir / rel for rel in rec.get("sheets") or []]

    # -- the guide

    def read_guide(self):
        try:
            return self.guide_path.read_text("utf-8")
        except OSError:
            return None

    def guide(self):
        return Guide(self.read_guide() or new_guide_text(self.model), self.model)

    def write_guide(self, guide):
        self.dir.mkdir(parents=True, exist_ok=True)
        old = self.read_guide()
        if old is not None:
            hist = self.dir / "history"
            hist.mkdir(exist_ok=True)
            with gzip.open(hist / f"{stamp()}-{uuid.uuid4().hex[:4]}.set-guide.md.gz", "wb") as f:
                f.write(old.encode("utf-8"))
            for extra in sorted(hist.glob("*.set-guide.md.gz"))[:-GUIDE_HISTORY_KEPT]:
                try:
                    extra.unlink()
                except OSError:
                    pass
        atomic_write(self.guide_path, guide.render().encode("utf-8"))

    def report(self):
        """Where every Set stands: sheets and description, current or not."""
        guide = self.guide() if self.read_guide() is not None else None
        keys = guide.keys() if guide else set()
        rows = []
        for name in self.sets():
            media = set_media(self.lib, f"{self.model}/{name}")
            rec = self.index["sets"].get(name) or {}
            sheets = self.sheet_files(name)
            if not sheets or not all(p.is_file() for p in sheets):
                sheet_state = "missing"
            elif rec.get("sheetsFor") == media["signature"]:
                sheet_state = "current"
            else:
                sheet_state = "changed"
            if name not in keys:
                desc_state = "missing"
            elif rec.get("described") == media["signature"]:
                desc_state = "current"
            elif rec.get("described"):
                desc_state = "changed"
            else:
                desc_state = "unchecked"
            if not media["images"] and not media["videos"]:
                sheet_state = desc_state = "empty"
            rows.append({
                "set": name,
                "path": f"{self.model}/{name}",
                "images": len(media["images"]),
                "videos": len(media["videos"]),
                "sheets": sheet_state,
                "description": desc_state,
                "sheetFiles": [str(p) for p in sheets if p.is_file()],
            })
        on_disk = {r["set"] for r in rows}
        orphans = sorted((k for k in keys if k not in on_disk), key=natural_key)
        return rows, orphans


class Guide:
    """A set guide: a preamble, entries keyed by Set folder name, and anything after."""

    ENTRY_KEY_RE = re.compile(r"^`([^`]+)`", re.M)
    FIELD_DEF_RE = re.compile(r"\*\*([^*]+?)\*\*")

    def __init__(self, text, model):
        self.model = model
        lines = text.replace("\r\n", "\n").split("\n")
        self.preamble, self.entries, self.postamble = [], [], []
        i = 0
        while i < len(lines) and not (lines[i].startswith("### ") or self._is_year(lines[i])):
            self.preamble.append(lines[i])
            i += 1
        current = None
        while i < len(lines):
            line = lines[i]
            if line.startswith("## ") and not self._is_year(line):
                self.postamble = lines[i:]
                break
            if self._is_year(line):
                current = None
            elif line.startswith("### "):
                current = {"heading": line, "lines": []}
                self.entries.append(current)
            elif current is not None:
                current["lines"].append(line)
            i += 1
        for e in self.entries:
            while e["lines"] and not e["lines"][-1].strip():
                e["lines"].pop()
            m = self.ENTRY_KEY_RE.search("\n".join(e["lines"]))
            e["key"] = nfc(m.group(1)) if m else None

    @staticmethod
    def _is_year(line):
        return bool(re.fullmatch(r"## (\d{4}|Undated)\s*", line))

    def keys(self):
        return {e["key"] for e in self.entries if e["key"]}

    def entry(self, key):
        return next((e for e in self.entries if e["key"] == key), None)

    def fields(self):
        """The field names the preamble lists, standard ones first."""
        names = []
        for line in self.preamble:
            if line.lstrip().startswith("- **"):
                for n in self.FIELD_DEF_RE.findall(line):
                    n = n.strip().rstrip(":")
                    if n and n not in names:
                        names.append(n)
        return names or [f for f, _ in STANDARD_FIELDS]

    def add_field(self, name, desc):
        """Adds a field to the preamble's list, after the last one there."""
        if name in self.fields() and any(f"**{name}**" in line for line in self.preamble):
            return False
        last = max((i for i, line in enumerate(self.preamble) if line.lstrip().startswith("- **")), default=None)
        line = f"- **{name}**: {desc}"
        if last is None:
            self.preamble += ["", "Fields:", ""] + [f"- **{f}**: {d}" for f, d in STANDARD_FIELDS] + [line]
        else:
            self.preamble.insert(last + 1, line)
        return True

    def amend(self, key, field_lines):
        """Sets only the given `- **Field:** text` lines in an existing entry."""
        e = self.entry(key)
        if not e:
            return None
        for fl in field_lines:
            m = re.match(r"^- \*\*([^*]+?):\*\*", fl)
            if not m:
                continue
            at = next((i for i, line in enumerate(e["lines"]) if line.startswith(f"- **{m.group(1)}:**")), None)
            if at is None:
                e["lines"].append(fl)
            else:
                e["lines"][at] = fl
        return e

    def required_fields(self):
        standard = {f for f, _ in STANDARD_FIELDS}
        listed = self.fields()
        req = [f for f in listed if f in standard]
        return req or listed

    def put(self, key, heading, body_lines):
        """Adds or replaces the entry for `key`, keeping the guide in Set order."""
        existing = self.entry(key)
        if existing:
            existing["heading"] = heading or existing["heading"]
            existing["lines"] = body_lines
            return "replaced"
        new = {"heading": heading, "lines": body_lines, "key": key}
        at = len(self.entries)
        for i, e in enumerate(self.entries):
            if e["key"] and natural_key(e["key"]) > natural_key(key):
                at = i
                break
        self.entries.insert(at, new)
        return "added"

    def remove(self, key):
        e = self.entry(key)
        if e:
            self.entries.remove(e)
        return e

    def rekey(self, old, new):
        e = self.entry(old)
        if not e:
            return False
        e["lines"] = [line.replace(f"`{old}`", f"`{new}`", 1) if line.startswith(f"`{old}`") else line for line in e["lines"]]
        e["key"] = new
        return True

    def status_line(self):
        dates = [set_date(e["key"] or "") for e in self.entries]
        dates = sorted(d for d in dates if d)
        span = f", {dates[0]} to {dates[-1]}" if dates else ""
        return (
            f"{GUIDE_STATUS_PREFIX} {plural(len(self.entries), 'entry', 'entries')}{span}; "
            f"last changed {datetime.date.today().isoformat()}. Entries are added and "
            "replaced with `lg.py describe`, never by hand."
        )

    def render(self):
        pre = [line for line in self.preamble if not line.startswith(GUIDE_STATUS_PREFIX)]
        while pre and not pre[-1].strip():
            pre.pop()
        # The status line goes right under the title.
        title_at = next((i for i, line in enumerate(pre) if line.startswith("# ")), -1)
        pre[title_at + 1:title_at + 1] = ["", self.status_line()]
        out = pre
        year = None
        for e in self.entries:
            d = set_date(e["key"] or "")
            y = d[:4] if d else "Undated"
            if y != year:
                out += ["", f"## {y}"]
                year = y
            out += ["", e["heading"]] + e["lines"]
        if self.postamble:
            out += [""] + self.postamble
        text = "\n".join(out)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.rstrip("\n") + "\n"


def new_guide_text(model):
    fields = "\n".join(f"- **{name}**: {desc}" for name, desc in STANDARD_FIELDS)
    return (
        f"# {model}: Set Guide\n\n"
        "Written by AI assistants from looking at every photo and video of each Set "
        "(through its contact sheets in `sheets/`), so Sets can be sorted and tagged "
        "without opening them again. Photo numbers (p1, p2...) count the Set's images "
        "in file-name order and match the labels on its sheets; v1, v2... count its "
        "videos. Fields:\n\n"
        f"{fields}\n"
    )


# -- contact sheets

def find_ffmpeg():
    import shutil
    for c in (
        shutil.which("ffmpeg"),
        "/Applications/Local Gallery.app/Contents/Resources/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ):
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def need_pillow():
    try:
        from PIL import Image, ImageDraw, ImageFont, ImageOps  # noqa: F401
        return True
    except ImportError:
        raise Refused(
            "Drawing collages yourself (--here) needs Pillow (the Python imaging library), "
            "which this Python does not have. Normally Local Gallery makes them: run the "
            "command without --here. If you really must draw them here, install it with "
            "`python3 -m pip install --user pillow`, then run this again."
        )


_FONTS = {}


def sheet_font(size):
    if size in _FONTS:
        return _FONTS[size]
    from PIL import ImageFont
    font = None
    try:
        font = ImageFont.load_default(size=size)
    except TypeError:
        for p in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/Library/Fonts/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ):
            try:
                font = ImageFont.truetype(p, size)
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()
    _FONTS[size] = font
    return font


def sheet_text(s):
    # Emoji and other symbols are not in the font; they would draw as boxes.
    return "".join(c for c in nfc(s) if c.isprintable() and ord(c) < 0x2000)


def ffmpeg_frame(ffmpeg, path, box, at=None):
    from PIL import Image
    import io
    import subprocess
    cmd = [ffmpeg, "-v", "error", "-nostdin", "-threads", "1"]
    if at is not None:
        cmd += ["-ss", f"{at:.2f}"]
    cmd += ["-i", str(path), "-frames:v", "1", "-vf",
            f"scale={box[0]}:{box[1]}:force_original_aspect_ratio=decrease",
            "-f", "image2pipe", "-vcodec", "png", "-"]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=60)
        if r.stdout:
            return Image.open(io.BytesIO(r.stdout)).convert("RGB")
    except Exception:
        pass
    return None


def video_duration(ffmpeg, path):
    import subprocess
    try:
        r = subprocess.run([ffmpeg, "-nostdin", "-i", str(path)], capture_output=True, timeout=30)
        m = re.search(rb"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
        if m:
            h, mi, s = m.groups()
            return int(h) * 3600 + int(mi) * 60 + float(s)
    except Exception:
        pass
    return 0.0


def load_still(path, box, ffmpeg):
    from PIL import Image, ImageOps
    try:
        im = Image.open(path)
        if (im.format or "").upper() == "JPEG":
            im.draft("RGB", (box[0] * 2, box[1] * 2))
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail(box)
        return im
    except Exception:
        pass
    return ffmpeg_frame(ffmpeg, path, box) if ffmpeg else None


def sheet_rows(media):
    """[('images', [(label, name)...]) | ('video', label, name)] in sheet order."""
    rows = []
    imgs = [(f"p{i + 1}", n) for i, n in enumerate(media["images"])]
    for i in range(0, len(imgs), SHEET_COLUMNS):
        rows.append(("images", imgs[i:i + SHEET_COLUMNS]))
    for i, n in enumerate(media["videos"]):
        rows.append(("video", f"v{i + 1}", n))
    return rows


def sheet_names(set_name, count, ext):
    base = set_name
    while len(f"{base} (sheet 99 of 99){ext}".encode("utf-8")) > 250:
        base = base[:-1]
    if count == 1:
        return [f"{base}{ext}"]
    return [f"{base} (sheet {k} of {count}){ext}" for k in range(1, count + 1)]


def make_sheets(lib, model, set_name, media, sheets_dir, ext, ffmpeg):
    """Draws the Set's sheets; answers their file names. Runs in a worker thread."""
    from PIL import Image, ImageDraw
    rows = sheet_rows(media)
    if not rows:
        return []
    count = -(-len(rows) // SHEET_ROWS_MAX)
    per = -(-len(rows) // count)
    names = sheet_names(set_name, count, ext)
    cell_w = SHEET_WIDTH // SHEET_COLUMNS
    box = (cell_w - 6, SHEET_CELL_H - SHEET_LABEL_H - 6)
    folder = lib.root / model / set_name
    head_font, label_font = sheet_font(20), sheet_font(13)
    sheets_dir.mkdir(parents=True, exist_ok=True)
    for k in range(count):
        part = rows[k * per:(k + 1) * per]
        sheet = Image.new("RGB", (SHEET_WIDTH, SHEET_HEADER_H + SHEET_CELL_H * len(part)), SHEET_BG)
        draw = ImageDraw.Draw(sheet)
        head = f"{set_name}  [{len(media['images'])} img, {len(media['videos'])} vid]  sheet {k + 1}/{count}"
        draw.text((8, 6), sheet_text(head), fill=SHEET_HEAD_INK, font=head_font)
        for r, row in enumerate(part):
            y = SHEET_HEADER_H + r * SHEET_CELL_H
            if row[0] == "images":
                cells = [(label, load_still(folder / name, box, ffmpeg)) for label, name in row[1]]
                ink = SHEET_LABEL_INK
            else:
                _, label, name = row
                dur = video_duration(ffmpeg, folder / name) if ffmpeg else 0.0
                cells = []
                for i in range(SHEET_VIDEO_FRAMES):
                    at = dur * (i + 0.5) / SHEET_VIDEO_FRAMES
                    frame = ffmpeg_frame(ffmpeg, folder / name, box, at) if ffmpeg else None
                    cells.append((f"{label} {at:.1f}/{dur:.0f}s", frame))
                ink = SHEET_VIDEO_INK
            for c, (label, im) in enumerate(cells):
                x = c * cell_w
                draw.text((x + 4, y + 1), label, fill=ink, font=label_font)
                if im is None:
                    draw.text((x + 10, y + SHEET_CELL_H // 2), "(could not be read)", fill=SHEET_LABEL_INK, font=label_font)
                    continue
                ox = x + (cell_w - im.width) // 2
                oy = y + SHEET_LABEL_H + (SHEET_CELL_H - SHEET_LABEL_H - im.height) // 2
                sheet.paste(im, (ox, oy))
        tmp = sheets_dir / f".{uuid.uuid4().hex[:8]}{ext}"
        if ext == ".png":
            sheet.save(tmp, "PNG", optimize=True)
        else:
            sheet.save(tmp, "JPEG", quality=85)
        os.replace(tmp, sheets_dir / names[k])
    return names


# -- commands

def knowledge_models(lib, raw):
    return [resolve_model(lib, raw)] if raw else [m for m in lib.models()]


def cmd_knowledge(lib, args):
    out = []
    for model in knowledge_models(lib, args.model):
        k = Knowledge(lib, model)
        if not args.model and not k.dir.exists():
            out.append({"model": model, "kept": False})
            continue
        rows, orphans = k.report()
        tally = lambda key, val: sum(1 for r in rows if r[key] == val)
        out.append({
            "model": model,
            "kept": k.dir.exists(),
            "folder": str(k.dir),
            "guide": str(k.guide_path) if k.guide_path.exists() else None,
            "sets": len([r for r in rows if r["sheets"] != "empty"]),
            "sheets": {s: tally("sheets", s) for s in ("current", "changed", "missing")},
            "descriptions": {s: tally("description", s) for s in ("current", "changed", "unchecked", "missing")},
            "describedButGone": orphans,
            "rows": rows if args.model else None,
        })
    if args.json:
        dump(out)
        return 0
    for o in out:
        if not o["kept"]:
            print(f"{o['model']}: nothing kept yet.")
            continue
        sh, de = o["sheets"], o["descriptions"]
        print(f"{o['model']}: {plural(o['sets'], 'Set')}. Sheets: {sh['current']} current, "
              f"{sh['changed']} out of date, {sh['missing']} missing. Descriptions: {de['current']} current, "
              f"{de['changed']} out of date, {de['missing']} missing"
              + (f", {de['unchecked']} not yet checked (run `adopt`)" if de["unchecked"] else "") + ".")
        if o["describedButGone"]:
            print(f"  Described but no longer on disk: {', '.join(o['describedButGone'][:10])}"
                  + (" ..." if len(o["describedButGone"]) > 10 else ""))
        if args.model:
            print(f"  Kept in: {o['folder']}")
            for r in o["rows"] or []:
                if r["sheets"] != "current" or r["description"] != "current":
                    print(f"  {r['set']}: sheets {r['sheets']}, description {r['description']}")
    return 0


def pending_collage_request(lib, model):
    for req in pending_requests(lib):
        for o in req.get("ops") or []:
            if o.get("kind") == "collages" and o.get("model") == model:
                return req
    return None


def ask_app_for_sheets(lib, model, todo, args):
    """Collages are the app's job: queue them, and wait as long as allowed."""
    waiting = pending_collage_request(lib, model)
    if waiting:
        print(f"Local Gallery is already making collages for {model} (request {waiting.get('id')}). "
              f"Don't ask again: wait, then run `knowledge \"{model}\"` to see how far it got.")
        return 0
    status = app_status(lib)
    if not status["ready"]:
        print(
            f"Refused: {plural(len(todo), 'Set')} of {model} {'needs' if len(todo) == 1 else 'need'} collages, and collages are made by "
            "Local Gallery, which is not open with the library loaded"
            + (" (it is open but locked or still opening)" if status["open"] else "")
            + ". Ask the user to open it (and unlock it), then run this again. Draw them yourself "
            "(`--here`) only if the user says they can't open the app."
        )
        return 1
    rid = queue_request(lib, [{"kind": "collages", "model": model, "sets": todo}])
    print(f"Asked Local Gallery to make collages for {plural(len(todo), 'Set')} of {model} (request {rid}).")
    res = wait_for_result(lib, rid, max(5, args.seconds))
    if res is None:
        raw = app_status(lib).get("raw") or {}
        prog = raw.get("collages") or {}
        far = f" ({prog.get('done')} of {prog.get('total')} done so far)" if prog.get("model") == model else ""
        print(f"It is still making them{far}. They are saved as it goes; run `knowledge \"{model}\"` in a "
              "minute to see which are done (or `requests`). Don't ask again meanwhile.")
        return 0
    for r in res.get("results") or []:
        print(("Done. " if r.get("ok") else "Not all made: ") + str(r.get("message") or ""))
    return 0 if all(r.get("ok") for r in res.get("results") or []) else 1


def cmd_sheets(lib, args):
    import concurrent.futures
    model = resolve_model(lib, args.model)
    k = Knowledge(lib, model)
    wanted = set()
    for raw in args.sets or []:
        p, _ = lib.resolve(raw if "/" in raw else f"{model}/{raw}")
        if p.split("/")[0] != model:
            raise Refused(f"'{p}' is not in {model}.")
        wanted.add(p.split("/", 1)[1])
    rows, _ = k.report()
    todo = []
    for r in rows:
        if r["sheets"] == "empty":
            continue
        if wanted and r["set"] not in wanted:
            continue
        if args.redo or r["sheets"] != "current":
            todo.append(r["set"])
    if not todo:
        print(f"Every Set of {model}{' asked for' if wanted else ''} already has a current collage. Nothing to make.")
        return 0
    if args.dry_run:
        print(f"Would {'draw' if args.here else 'ask Local Gallery for'} collages of {plural(len(todo), 'Set')} of {model}:")
        for s in todo:
            print(f"  {s}")
        return 0
    if not args.here:
        return ask_app_for_sheets(lib, model, todo, args)
    need_pillow()
    ffmpeg = find_ffmpeg()
    has_video = any(set_media(lib, f"{model}/{s}")["videos"] for s in todo)
    if has_video and not ffmpeg:
        print("Note: ffmpeg was not found, so videos get empty frames. Install ffmpeg for video frames.")
    deadline = time.time() + max(10, args.seconds)
    done, failed = [], []
    with ToolLock(lib, f".sheets-{hashlib.sha1(model.encode()).hexdigest()[:8]}.lock"):
        # Gentle on purpose, like the app's own collages: a library-wide run
        # at full width once locked a Mac up.
        workers = max(1, min(args.workers or 2, 8))
        pending = list(todo)
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            running = {}
            while pending or running:
                while pending and len(running) < workers and time.time() < deadline:
                    name = pending.pop(0)
                    media = set_media(lib, f"{model}/{name}")
                    old = k.sheet_files(name)
                    ext = old[0].suffix if old and old[0].suffix in (".png", ".jpg") else ".jpg"
                    fut = pool.submit(make_sheets, lib, model, name, media, k.sheets_dir, ext, ffmpeg)
                    running[fut] = (name, media, old)
                if not running:
                    break
                finished, _ = concurrent.futures.wait(list(running), return_when=concurrent.futures.FIRST_COMPLETED)
                for fut in finished:
                    name, media, old = running.pop(fut)
                    try:
                        files = fut.result()
                    except Exception as e:
                        failed.append(f"{name}: {e}")
                        continue
                    for p in old:
                        if p.name not in files:
                            try:
                                p.unlink()
                            except OSError:
                                pass
                    rec = k.record(name)
                    rec["sheets"] = [f"sheets/{f}" for f in files]
                    rec["sheetsFor"] = media["signature"]
                    rec["images"], rec["videos"] = len(media["images"]), len(media["videos"])
                    rec["signature"] = media["signature"]
                    k.save_index()
                    done.append(name)
    left = len(todo) - len(done) - len(failed)
    print(f"Made contact sheets for {plural(len(done), 'Set')} of {model}, in {k.sheets_dir}.")
    for f in failed:
        print(f"  FAILED: {f}")
    if left:
        print(f"{plural(left, 'Set')} still to do (time ran out). Run the same command again to go on.")
    return 0 if not failed else 1


def entry_template(guide):
    return [f"- **{f}:** " for f in guide.fields()]


def cmd_describe(lib, args):
    model = resolve_model(lib, args.model)
    k = Knowledge(lib, model)
    if args.write:
        return describe_write(lib, k, args)
    guide = k.guide()
    rows, _ = k.report()
    todo = [r for r in rows if r["description"] in ("missing", "changed") and r["sheets"] != "empty"]
    if args.set:
        p, _ = lib.resolve(args.set if "/" in args.set else f"{model}/{args.set}")
        todo = [r for r in rows if r["path"] == p]
    todo = todo[: args.next]
    items = []
    for r in todo:
        media = set_media(lib, r["path"])
        e = guide.entry(r["set"])
        items.append({
            "path": r["path"],
            "state": r["description"],
            "heading": e["heading"] if e else default_heading(model, r["set"]),
            "headerLine": f"`{r['set']}` · {set_date(r['set']) or 'undated'} · {counts_text(len(media['images']), len(media['videos']))}",
            "sheets": r["sheetFiles"],
            "sheetsCurrent": r["sheets"] == "current",
            "photos": {f"p{i + 1}": n for i, n in enumerate(media["images"])},
            "videos": {f"v{i + 1}": n for i, n in enumerate(media["videos"])},
            "currentEntry": "\n".join([e["heading"]] + e["lines"]) if e else None,
        })
    if args.json:
        dump({"model": model, "guide": str(k.guide_path), "fields": guide.fields(),
              "required": guide.required_fields(), "sets": items})
        return 0
    if not items:
        print(f"Every Set of {model} is described and current.")
        return 0
    print(f"{plural(len(items), 'Set')} of {model} to describe. Look at every sheet of each, then write the entries "
          f"in one file and run `describe \"{model}\" --write FILE`.\n")
    print("Entry format (one block per Set; the heading and the `folder` line are made for you):\n")
    print(f"=== {items[0]['path']}")
    for line in entry_template(guide):
        print(line)
    print(f"\nRequired fields: {', '.join(guide.required_fields())}. Others are optional.\n")
    for it in items:
        print(f"--- {it['path']}  ({it['state']}; {it['headerLine'].split(' · ')[-1]})")
        if not it["sheetsCurrent"]:
            print(f"    Sheets are not current: run `sheets \"{model}\" \"{it['path'].split('/', 1)[1]}\"` first.")
        for s in it["sheets"]:
            print(f"    sheet: {s}")
        if it["currentEntry"]:
            print(f"    It has an older entry (its files changed since): read it with `entry \"{it['path']}\"`, then write the whole entry again.")
    return 0


def parse_entry_blocks(text):
    blocks, cur = [], None
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.startswith("=== "):
            cur = {"path": line[4:].strip(), "lines": []}
            blocks.append(cur)
        elif cur is not None:
            cur["lines"].append(line)
    for b in blocks:
        while b["lines"] and not b["lines"][0].strip():
            b["lines"].pop(0)
        while b["lines"] and not b["lines"][-1].strip():
            b["lines"].pop()
    return blocks


def describe_write(lib, k, args):
    text = sys.stdin.read() if args.write == "-" else Path(args.write).read_text("utf-8")
    blocks = parse_entry_blocks(text)
    if not blocks:
        raise Refused("No entries found. Each entry starts with a line `=== Model/Set`.")
    guide = k.guide()
    required = guide.required_fields()
    problems, ready = [], []
    for b in blocks:
        try:
            p, _ = lib.resolve(b["path"] if "/" in b["path"] else f"{k.model}/{b['path']}")
        except Refused as e:
            problems.append(str(e))
            continue
        if p.split("/")[0] != k.model or "/" not in p:
            problems.append(f"'{b['path']}' is not a Set of {k.model}.")
            continue
        name = p.split("/", 1)[1]
        media = set_media(lib, p)
        body = list(b["lines"])
        if args.amend:
            fields_in = [line for line in body if re.match(r"^- \*\*[^*]+?:\*\*\s*\S", line)]
            if not guide.entry(name):
                problems.append(f"{p}: has no entry to amend. Write a whole entry first (without --amend).")
            elif not fields_in or len(fields_in) != len([line for line in body if line.strip()]):
                problems.append(f"{p}: --amend takes only field lines (- **Field:** text).")
            unknown = [re.match(r"^- \*\*([^*]+?):", line).group(1) for line in fields_in]
            unknown = [f for f in unknown if f not in guide.fields()]
            if unknown:
                problems.append(f"{p}: {', '.join(unknown)} is not a field of this guide. Add it first with `field`.")
            ready.append((name, None, fields_in, media))
            continue
        heading = None
        if body and body[0].startswith("### "):
            heading = body.pop(0)
            while body and not body[0].strip():
                body.pop(0)
        body = [line for line in body if not line.startswith("`")]
        joined = "\n".join(body)
        missing = [f for f in required if not re.search(r"^- \*\*" + re.escape(f) + r":\*\*\s*\S", joined, re.M)]
        if missing:
            problems.append(f"{p}: missing {', '.join(missing)}.")
        top_p = max([int(x) for x in re.findall(r"\bp(\d+)\b", joined)] or [0])
        top_v = max([int(x) for x in re.findall(r"\bv(\d+)\b", joined)] or [0])
        if top_p > len(media["images"]):
            problems.append(f"{p}: mentions p{top_p}, but the Set has {plural(len(media['images']), 'photo')}.")
        if top_v > len(media["videos"]):
            problems.append(f"{p}: mentions v{top_v}, but the Set has {plural(len(media['videos']), 'video')}.")
        header = f"`{name}` · {set_date(name) or 'undated'} · {counts_text(len(media['images']), len(media['videos']))}"
        ready.append((name, heading or (guide.entry(name) or {}).get("heading") or default_heading(k.model, name),
                      ["", header, ""] + body, media))
    if problems:
        print("Refused: nothing was written.")
        for x in problems:
            print(f"  - {x}")
        return 1
    if args.dry_run:
        print(f"Dry run: would write {plural(len(ready), 'entry', 'entries')} into {k.guide_path}.")
        return 0
    with ToolLock(lib, f".guide-{hashlib.sha1(k.model.encode()).hexdigest()[:8]}.lock"):
        guide = k.guide()
        results = []
        for name, heading, lines, media in ready:
            if args.amend:
                guide.amend(name, lines)
                results.append((name, "amended"))
                continue
            results.append((name, guide.put(name, heading, lines)))
            rec = k.record(name)
            rec["described"] = media["signature"]
            rec["signature"] = media["signature"]
        k.write_guide(guide)
        k.save_index()
    if args.amend:
        print(f"Done. {plural(len(results), 'entry', 'entries')} amended, in {k.guide_path}.")
        return 0
    added = sum(1 for _, r in results if r == "added")
    print(f"Done. {added} added, {len(results) - added} replaced, in {k.guide_path}.")
    return 0


def cmd_field(lib, args):
    model = resolve_model(lib, args.model)
    k = Knowledge(lib, model)
    name = args.name.strip().strip("*").rstrip(":")
    if not name or "*" in name or ":" in name:
        raise Refused("A field name can't be empty or hold * or :.")
    guide = k.guide()
    desc = args.description.strip()
    if name in guide.fields() and not args.update:
        print(f"'{name}' is already a field of {model}'s guide. Pass --update to change what it says it records.")
        return 0
    if args.update:
        at = next((i for i, line in enumerate(guide.preamble) if line.lstrip().startswith(f"- **{name}**")), None)
        if at is None:
            raise Refused(f"'{name}' is not a field of {model}'s guide (or shares its line with another field).")
        if not desc:
            raise Refused("Give the new description.")
        if args.dry_run:
            print(f"Dry run: would change what '{name}' records.")
            return 0
        with ToolLock(lib, f".guide-{hashlib.sha1(model.encode()).hexdigest()[:8]}.lock"):
            guide = k.guide()
            guide.preamble[at] = f"- **{name}**: {desc}"
            k.write_guide(guide)
        print(f"Done. '{name}' now says: {desc}")
        return 0
    if not desc:
        raise Refused("Say what the field records (the second argument): it is what keeps later entries consistent.")
    if args.dry_run:
        print(f"Dry run: would add the field '{name}' to {model}'s guide.")
        return 0
    with ToolLock(lib, f".guide-{hashlib.sha1(model.encode()).hexdigest()[:8]}.lock"):
        guide = k.guide()
        guide.add_field(name, desc)
        k.write_guide(guide)
    print(f"Done. '{name}' is now a field of {model}'s guide (optional in entries). Fill it in with "
          f"`describe \"{model}\" --write FILE --amend`.")
    return 0


def cmd_entry(lib, args):
    out = []
    for raw in args.paths:
        p, _ = lib.resolve(raw, must_exist=False)
        if "/" not in p:
            raise Refused(f"'{p}' is a Model; give Model/Set.")
        model, name = p.split("/", 1)
        k = Knowledge(lib, model)
        e = k.guide().entry(name) if k.read_guide() else None
        out.append({"path": p, "entry": "\n".join([e["heading"]] + e["lines"]) if e else None,
                    "sheets": [str(s) for s in k.sheet_files(name) if s.is_file()]})
    if args.json:
        dump(out)
        return 0
    for o in out:
        print(o["entry"] or f"{o['path']}: no entry in the set guide yet.")
        for s in o["sheets"]:
            print(f"(sheet: {s})")
        print()
    return 0


def cmd_adopt(lib, args):
    """Takes sheets and a guide made before (or elsewhere) as this Model's own."""
    model = resolve_model(lib, args.model)
    k = Knowledge(lib, model)
    actions = []
    sets = k.sets()
    by_name = {nfc(s): s for s in sets}
    if args.guide:
        src = Path(args.guide).expanduser()
        if not src.is_file():
            raise Refused(f"No guide at {src}.")
        if k.guide_path.exists() and not args.replace:
            raise Refused(f"{model} already has a set guide. Pass --replace to put {src.name} in its place (the old one is kept in history/).")
        actions.append(("guide", src))
    if args.sheets:
        src_dir = Path(args.sheets).expanduser()
        if not src_dir.is_dir():
            raise Refused(f"No folder {src_dir}.")
        actions.append(("sheets", src_dir))
    if args.dry_run:
        print("Dry run:", "; ".join(f"take {what} from {p}" for what, p in actions) or "mark what is there as current")
        return 0
    k.dir.mkdir(parents=True, exist_ok=True)
    import shutil
    moved_sheets = 0
    for what, src in actions:
        if what == "guide":
            text = src.read_text("utf-8")
            Guide(text, model)  # it must parse
            k.write_guide(Guide(text, model))
        else:
            k.sheets_dir.mkdir(parents=True, exist_ok=True)
            for f in sorted(src.iterdir()):
                if f.suffix.lower() not in (".png", ".jpg", ".jpeg") or f.name.startswith("."):
                    continue
                target = k.sheets_dir / f.name
                if target.exists():
                    continue
                (shutil.move if args.move else shutil.copy2)(str(f), str(target))
                moved_sheets += 1
            notes = [f for f in src.iterdir() if f.is_file() and f.suffix.lower() not in (".png", ".jpg", ".jpeg") and not f.name.startswith(".")]
            if notes:
                (k.dir / "notes").mkdir(exist_ok=True)
                for f in notes:
                    target = k.dir / "notes" / f.name
                    if not target.exists():
                        (shutil.move if args.move else shutil.copy2)(str(f), str(target))
    # Match sheets to Sets by name, and mark everything found as current.
    sheet_map = {}
    if k.sheets_dir.is_dir():
        for f in sorted(k.sheets_dir.iterdir(), key=lambda p: natural_key(p.name)):
            if f.name.startswith("."):
                continue
            base = re.sub(r" \(sheet \d+ of \d+\)$", "", f.stem)
            if nfc(base) in by_name:
                sheet_map.setdefault(by_name[nfc(base)], []).append(f"sheets/{f.name}")
    guide = k.guide() if k.read_guide() is not None else None
    keys = guide.keys() if guide else set()
    n_sheets = n_desc = 0
    for name in sets:
        media = set_media(lib, f"{model}/{name}")
        rec = k.record(name)
        rec["signature"] = media["signature"]
        rec["images"], rec["videos"] = len(media["images"]), len(media["videos"])
        if name in sheet_map:
            rec["sheets"] = sheet_map[name]
            rec["sheetsFor"] = media["signature"]
            n_sheets += 1
        if name in keys:
            rec["described"] = media["signature"]
            n_desc += 1
    k.save_index()
    if guide:
        k.write_guide(guide)  # adds the status line
    print(f"Adopted for {model}: sheets for {plural(n_sheets, 'Set')}"
          + (f" ({moved_sheets} files {'moved' if args.move else 'copied'} in)" if args.sheets else "")
          + f", descriptions for {plural(n_desc, 'Set')}. All marked current as of now.")
    gone = sorted(keys - set(sets), key=natural_key)
    if gone:
        print(f"The guide also describes {plural(len(gone), 'folder')} not in {model} now: {', '.join(gone[:8])}"
              + (" ..." if len(gone) > 8 else ""))
    return 0


def knowledge_follow_move(lib, old, new):
    """Carries sheets, guide entries and the index along with a moved folder."""
    notes = []
    o, n = old.split("/"), new.split("/")
    root = knowledge_root(lib)
    try:
        if len(o) == 1:
            src, dst = root / old, root / new
            if src.is_dir() and not dst.exists():
                os.rename(src, dst)
                k = Knowledge(lib, new)
                text = k.read_guide()
                if text is not None and text.startswith(f"# {old}: Set Guide"):
                    atomic_write(k.guide_path, text.replace(f"# {old}: Set Guide", f"# {new}: Set Guide", 1).encode("utf-8"))
                k.save_index()
                notes.append(f"Its kept sheets and guide moved to {dst}.")
            return notes
        (om, oset), (nm, nset) = o, n
        ko = Knowledge(lib, om)
        if not ko.dir.exists():
            return notes
        kn = ko if om == nm else Knowledge(lib, nm)
        rec = ko.index["sets"].pop(oset, None)
        if rec is not None:
            files = []
            if rec.get("sheets"):
                kn.sheets_dir.mkdir(parents=True, exist_ok=True)
                olds = [ko.dir / s for s in rec["sheets"]]
                ext = olds[0].suffix if olds else ".jpg"
                new_names = sheet_names(nset, len(olds), ext)
                for src, name in zip(olds, new_names):
                    if src.is_file():
                        os.rename(src, kn.sheets_dir / name)
                        files.append(f"sheets/{name}")
            rec["sheets"] = files
            kn.index["sets"][nset] = rec
        go = ko.guide() if ko.read_guide() is not None else None
        if go and go.entry(oset):
            if ko is kn:
                go.rekey(oset, nset)
                ko.write_guide(go)
            else:
                e = go.remove(oset)
                ko.write_guide(go)
                gn = kn.guide()
                lines = [line.replace(f"`{oset}`", f"`{nset}`", 1) if line.startswith(f"`{oset}`") else line for line in e["lines"]]
                gn.put(nset, e["heading"], lines)
                kn.write_guide(gn)
            notes.append("Its set guide entry and contact sheets went with it.")
        ko.save_index()
        if kn is not ko:
            kn.save_index()
    except OSError as e:
        notes.append(f"Its kept sheets or guide entry could not all be moved ({e}); run `knowledge` to check.")
    return notes


# --- arguments ----------------------------------------------------------------------------


def read_paths(args):
    paths = list(getattr(args, "paths", None) or [])
    src = getattr(args, "paths_from", None)
    if src:
        text = sys.stdin.read() if src == "-" else Path(src).read_text("utf-8")
        for line in text.splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                paths.append(line)
    return paths


def find_library(explicit):
    cands = []
    if explicit:
        cands.append(Path(explicit).expanduser())
    if os.environ.get("LG_LIBRARY"):
        cands.append(Path(os.environ["LG_LIBRARY"]).expanduser())
    here = Path(__file__).resolve()
    if here.parent.name == AI_DIR and here.parent.parent.name == META_DIR:
        cands.append(here.parent.parent.parent)
    for base in (Path.home() / "Documents",):
        cands += [base / ".Local Gallery", base / "Local Gallery"]
    for c in cands:
        if (c / META_DIR / TAGS_FILE).is_file():
            return Library(c)
    if explicit or os.environ.get("LG_LIBRARY"):
        raise Refused(f"No Local Gallery library at {cands[0]} (no {META_DIR}/{TAGS_FILE} in it).")
    raise Refused("Could not find the library. Pass --library PATH (the folder holding .local-gallery).")


def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--library", help="the library folder (the one holding .local-gallery)")
    common.add_argument("--json", action="store_true", help="machine-readable output (read commands)")
    common.add_argument("--dry-run", action="store_true", help="check and show the change without writing")
    common.add_argument("--no-wait", action="store_true", help="don't wait for the open app to confirm")
    common.add_argument("--new", dest="allow_new", action="store_true", help="allow a new Tag whose name nearly matches an existing one")
    common.add_argument("--skip-refused", action="store_true", help="skip folders a Tag refuses instead of refusing the whole change")

    p = argparse.ArgumentParser(
        prog="lg.py",
        description="Read and change Local Gallery's Tags. Read the instructions first: lg.py guide",
        parents=[common],
    )
    sub = p.add_subparsers(dest="cmd", metavar="command")

    def add(name, help_text):
        return sub.add_parser(name, help=help_text, parents=[common], description=help_text)

    add("guide", "print the AI instructions (.local-gallery/AI-INSTRUCTIONS.md)")
    add("status", "the library, whether the app is open, what is waiting")
    s = add("tags", "every Tag with its size, flags and where its card shows")
    s.add_argument("--sort", choices=["name", "count"], default="name")
    s = add("tag", "one Tag in full: its folders, the Tags it holds, its settings")
    s.add_argument("name")
    s = add("show", "folders: their Tags, marks, score and files")
    s.add_argument("paths", nargs="+")
    add("models", "every Model with its Tags")
    s = add("sets", "the Sets of one Model (or every Set) with their Tags")
    s.add_argument("model", nargs="?")
    s.add_argument("--untagged", action="store_true", help="only Sets with no Tags")
    s.add_argument("--tagged-with", metavar="TAG")
    s.add_argument("--counts", action="store_true", help="count files in each Set")
    s = add("find", "folders and Tags whose names contain TEXT")
    s.add_argument("text")
    s = add("export", "everything as JSON (Models, Sets, Tags)")
    s.add_argument("--out", help="write to this file instead of printing")
    s.add_argument("--counts", action="store_true", help="count files in each Set (slower)")
    s = add("check", "look for problems in the Tags")
    s.add_argument("--limit", type=int, default=60)
    s = add("journal", "the changes made with lg.py")
    s.add_argument("-n", type=int, default=20)
    s = add("requests", "what is waiting for the app, and what it finished")
    s.add_argument("-n", type=int, default=10)
    add("verify", "whether the tags file is still as the last change left it")
    s = add("undo", "put back the tags file from before the last lg.py change")
    s.add_argument("--force", action="store_true", help="even if it changed since")

    s = add("add", "put folders in a Tag (makes the Tag if it is new)")
    s.add_argument("tag")
    s.add_argument("paths", nargs="*")
    s.add_argument("--paths-from", metavar="FILE", help="one folder per line ('-' reads stdin)")
    s = add("remove", "take folders out of a Tag")
    s.add_argument("tag")
    s.add_argument("paths", nargs="*")
    s.add_argument("--paths-from", metavar="FILE")
    s = add("set-tags", "give a folder exactly these Tags (Favorite/Hidden/Storage untouched)")
    s.add_argument("path")
    s.add_argument("tags", nargs="*")
    s = add("nest", "put Tag CHILD inside Tag PARENT (':tag-storage' for Tag storage)")
    s.add_argument("tag")
    s.add_argument("parent")
    s = add("unnest", "take Tag CHILD out of Tag PARENT")
    s.add_argument("tag")
    s.add_argument("parent")
    s = add("flag", "turn a Tag setting on (or --off): " + ", ".join(FLAGS))
    s.add_argument("tag")
    s.add_argument("flag", choices=FLAGS + RETIRED_FLAGS)
    s.add_argument("--off", action="store_true")
    s = add("hide-media", "hide media types inside a Tag (images, videos, text; 'none' shows all)")
    s.add_argument("tag")
    s.add_argument("types", nargs="+")
    s = add("contents", "retired; only --off, to take away an old contents rule the app has not converted yet")
    s.add_argument("source")
    s.add_argument("tag")
    s.add_argument("--off", action="store_true")
    s = add("favorite", "mark folders as Favorites (or --off)")
    s.add_argument("paths", nargs="*")
    s.add_argument("--paths-from", metavar="FILE")
    s.add_argument("--off", action="store_true")
    s = add("hide", "mark folders Hidden (or --off)")
    s.add_argument("paths", nargs="*")
    s.add_argument("--paths-from", metavar="FILE")
    s.add_argument("--off", action="store_true")
    s = add("move", "move or rename a Model or Set on disk, keeping everything the app knows about it")
    s.add_argument("old")
    s.add_argument("new")
    s = add("moved", "tell the app a folder was already moved or renamed on disk")
    s.add_argument("old")
    s.add_argument("new")
    s = add("rename-tag", "rename a Tag (the app finishes it)")
    s.add_argument("old")
    s.add_argument("new")
    s = add("delete-tag", "delete a Tag; no folder or file is touched (the app finishes it)")
    s.add_argument("name")
    s = add("trash", "move folders to the app's Trash (the app does it; Put Back reverses it)")
    s.add_argument("paths", nargs="*")
    s.add_argument("--paths-from", metavar="FILE")
    s = add("storage", "send folders to Storage (or --off to take them out; the app does it)")
    s.add_argument("paths", nargs="*")
    s.add_argument("--paths-from", metavar="FILE")
    s.add_argument("--off", action="store_true")
    s = add("knowledge", "what is kept about a Model (contact sheets, set guide) and what is new or out of date")
    s.add_argument("model", nargs="?")
    s = add("sheets", "get collages (contact sheets) made for a Model's Sets that have none or whose files changed: Local Gallery makes them")
    s.add_argument("model")
    s.add_argument("sets", nargs="*", help="only these Sets (default: every Set that needs them)")
    s.add_argument("--redo", action="store_true", help="make them again even if current")
    s.add_argument("--seconds", type=int, default=150, help="how long to wait for the app, or (--here) to draw (default 150)")
    s.add_argument("--here", action="store_true", help="draw them with this script instead of the app (only if the user can't open the app; needs Pillow)")
    s.add_argument("--workers", type=int, default=0, help="with --here: Sets drawn at once (default 2, at most 8)")
    s = add("describe", "list the Sets that need a set guide entry, or (--write FILE) add entries to the guide")
    s.add_argument("model")
    s.add_argument("set", nargs="?", help="just this Set")
    s.add_argument("--next", type=int, default=10, help="how many Sets to list (default 10)")
    s.add_argument("--write", metavar="FILE", help="add or replace entries from FILE ('-' reads stdin)")
    s.add_argument("--amend", action="store_true", help="with --write: set only the fields given, in existing entries")
    s = add("field", "add a field to a Model's set guide (for a judgment worth keeping for every Set)")
    s.add_argument("model")
    s.add_argument("name")
    s.add_argument("description", help="what the field records")
    s.add_argument("--update", action="store_true", help="change the description of a field the guide already has")
    s = add("entry", "print the set guide entry and sheet files of Sets")
    s.add_argument("paths", nargs="+")
    s = add("adopt", "take existing contact sheets and/or a set guide as a Model's own, and mark them current")
    s.add_argument("model")
    s.add_argument("--guide", metavar="FILE", help="a set guide written before, to keep as this Model's")
    s.add_argument("--sheets", metavar="DIR", help="a folder of contact sheets named after the Sets")
    s.add_argument("--move", action="store_true", help="move them in instead of copying")
    s.add_argument("--replace", action="store_true", help="replace a guide the Model already has")
    s = add("apply", "make a batch of changes from a JSON plan file, all or nothing")
    s.add_argument("plan", help="a JSON file: {\"ops\": [...]} or a list of changes ('-' reads stdin)")
    return p


def ops_from_args(args):
    c = args.cmd
    if c in ("add", "remove"):
        return [{"op": c, "tag": args.tag, "paths": read_paths(args)}]
    if c == "set-tags":
        return [{"op": c, "path": args.path, "tags": args.tags}]
    if c in ("nest", "unnest"):
        return [{"op": c, "tag": args.tag, "parent": args.parent}]
    if c == "flag":
        return [{"op": c, "tag": args.tag, "flag": args.flag, "on": not args.off}]
    if c == "hide-media":
        return [{"op": c, "tag": args.tag, "types": args.types}]
    if c == "contents":
        return [{"op": c, "source": args.source, "tag": args.tag, "on": not args.off}]
    if c in ("favorite", "hide", "storage"):
        return [{"op": c, "paths": read_paths(args), "on": not args.off}]
    if c == "trash":
        return [{"op": c, "paths": read_paths(args)}]
    if c in ("move", "moved"):
        return [{"op": c, "from": args.old, "to": args.new}]
    if c == "rename-tag":
        return [{"op": c, "from": args.old, "to": args.new}]
    if c == "delete-tag":
        return [{"op": c, "tag": args.name}]
    if c == "apply":
        text = sys.stdin.read() if args.plan == "-" else Path(args.plan).read_text("utf-8")
        try:
            plan = json.loads(text)
        except ValueError as e:
            raise Refused(f"The plan is not valid JSON: {e}")
        ops = plan.get("ops") if isinstance(plan, dict) else plan
        if not isinstance(ops, list):
            raise Refused('A plan is {"ops": [ ... ]} or a list of changes.')
        return ops
    return None


READERS = {
    "guide": cmd_guide,
    "status": cmd_status,
    "tags": cmd_tags,
    "tag": cmd_tag,
    "show": cmd_show,
    "models": cmd_models,
    "sets": cmd_sets,
    "find": cmd_find,
    "export": cmd_export,
    "check": cmd_check,
    "journal": cmd_journal,
    "requests": cmd_requests,
    "verify": cmd_verify,
    "undo": cmd_undo,
    "knowledge": cmd_knowledge,
    "sheets": cmd_sheets,
    "describe": cmd_describe,
    "entry": cmd_entry,
    "field": cmd_field,
    "adopt": cmd_adopt,
}


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.cmd:
        parser.print_help()
        return 2
    try:
        lib = find_library(args.library)
        if args.cmd in READERS:
            return READERS[args.cmd](lib, args)
        ops = ops_from_args(args)
        opts = {
            "dry_run": args.dry_run,
            "no_wait": args.no_wait,
            "allow_new": args.allow_new,
            "skip_refused": args.skip_refused,
            "json": args.json,
        }
        return run_changes(lib, ops, opts)
    except (Refused, Busy) as e:
        print(f"Refused: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
