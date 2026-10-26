---
name: "media-library-curator"
description: "Use when curating the user's media library: merging new downloads (match by content, upgrade quality, dedupe, group, name by convention), sorting set folders into confidence buckets by a visual criterion, or categorizing and describing sets. If the library is a Local Gallery library (a folder holding a hidden .local-gallery folder, often named Local Gallery), first find and read its own instructions, .local-gallery/AI-INSTRUCTIONS.md, which override this skill there."
---

# Media library curation

## Goal
Build the most organized, highest-quality, most complete media library possible. Take in new content, compare it file by file against what already exists, and merge both into better sets: upgrade low-quality files, add what's missing, drop what's redundant, and leave everything consistently named and grouped.

The second job is **sorting sets by an abstract criterion**: the user describes something you can only judge by looking, such as a pose or activity, a setting, an outfit, a mood or a production style. They want the set folders sorted into buckets by how confident you are that each set has it.

The third is **categorizing sets**: deciding which sets belong in which of the user's categories, by looking at them.

Each job has its own section below. The ground rules, the naming convention and the environment notes apply to all three, except in a Local Gallery library (next section), whose own instructions come first.

## Local Gallery libraries: find their own instructions first
Some libraries are browsed in **Local Gallery**, a Mac app, and carry their own instructions for AI assistants. Before anything else, check whether the library you are working on is one, by looking for the file `.local-gallery/AI-INSTRUCTIONS.md`:

1. In the folder you were given or are working in, and in each of its parent folders.
2. Inside each connected or mounted folder (in a sandbox, for example everything under `$HOME/mnt/`), down to three levels: `find <folder> -maxdepth 4 -path '*/.local-gallery/AI-INSTRUCTIONS.md'` (the folder is hidden, so plain listings miss it).
3. On the user's Mac: `~/Documents/Local Gallery/` and `~/Documents/.Local Gallery/`.

- **Found it:** the folder holding `.local-gallery/` is the library. Read the whole file before doing anything, and follow it for every job in that library: it has the library's tool (`.local-gallery/ai/lg.py`), its rules, how Tags, sorting and merging work there, and where contact sheets and written descriptions of each Model's Sets are kept and how to keep them current. Where it differs from this skill, it wins; where it is silent, this skill still applies. Never edit files in `.local-gallery/` except as it says.
- **Found more than one:** ask the user which library this job is about.
- **The user mentioned Local Gallery, or there is a `.local-gallery/` folder, but no instructions file:** do not guess at the app's data; say so, and ask the user to open the Local Gallery app once (it writes the file) or to point you at the library.
- **No sign of Local Gallery:** ignore this section and carry on with the rest of this skill.

## Ground rules
1. **Never touch originals.** Copy everything you're given into a workspace (e.g. `rsync -a --exclude .DS_Store <src>/ New/_staging/`) and rename, move and delete only there. Leave source folders exactly as they were, and tell the user they can delete them once they're happy.
2. **No duplicates in the final library.** Duplicates, near-duplicates (re-encodes, resizes, slight crops, metadata-only differences) and practical duplicates (the same clip as GIF and MP4, the same photo in a preview post and the full set, a later repost) collapse to one file. Keep the best by: highest resolution, then most detail (less lossy format, full color, higher bitrate), then largest file. AVIF/re-encoded hoard copies always lose to an original.
3. **Identify by content, never by name.** Names, dates and post numbers are often wrong. Use pixel and frame fingerprints; md5 is only a bonus signal.
4. **Use machine-only signals** a human couldn't check by eye at scale: dimensions after EXIF orientation, file size, codec, duration, frame counts, frame-level similarity, embedded metadata.
5. **Follow the naming convention exactly** (below).
6. **When grouping is uncertain, don't combine**; the user can merge later. If a step is irreversible and could reasonably go either way, ask first.
7. **Adult material.** Libraries may hold explicit content. Keep notes, sheet labels and reports clinical. If anything suggests a person depicted could be under 18, stop and tell the user.

## Naming convention
- Set folder: `yymmdd-<Model Name>-<NNNNNN> - <Display Title>`
- File: `yymmdd-<Model Name>-<NNNNNN> - <Display Title>_<NN>.<ext>`
- ` - ` (space-hyphen-space) is special: the user's media browser hides it and everything before it. Put useful machine info before it (date, model, post number, flags) and the human display name after it. Never put a second ` - ` inside the header.
- `yymmdd` = date of the set's first post. `<Model Name>` e.g. `Alice Delish` (older sets may carry a numeric creator id like `27715367`; leave those names as they are). `NNNNNN` = six-digit post number; `000000` when unknown.
- `_NN` = zero-padded position in set order: two digits (`_01`), three if the set has 100+ files. Some existing sets use three digits; keep their names when replacing files in them.
- Flags go right after the six-digit index, before ` - `. `-compressed` marks files from low-quality sources that still need replacing: `260305-Alice Delish-000360-compressed - postname_06.jpg`. A folder carries the flag only if every file in it does. Remove the flag from a file when it's upgraded, and from the folder once nothing flagged remains. Names without a six-digit index (`0000 - Movies_003.mp4`) take it after the leading number: `0000-compressed - Movies_003.mp4`.
- Display title: the post's title, trimmed, emoji and punctuation kept. The user's forum downloader names posts `... - postname`; keep that for single-set posts. When a post contains several sets, split them into separate folders and give each a distinct short descriptive title.
- Special folders: `0000 - Movies` (video compilation) and a GIFs compilation set. Follow existing placement: gif-only posts go to the GIFs set, older standalone video posts to Movies; newer forum post folders keep their own videos.
- **The existing library's arrangement is authoritative for matched content.** An upgraded file takes the exact name and slot of the file it replaces, with its own extension. Don't reorder or rename existing sets beyond that.
- Bucket folders made when sorting by a criterion follow the same ` - ` trick: `1 - Definite` shows in the browser as just `Definite`.
- Keep each name component under 255 bytes; `:` is fine on macOS (Finder shows it as `/`).

## Workflow (merging new content)
Set up a task list. Typical stages: survey, copy, fingerprint, match, decide, group/name new content, execute, verify, report.

### 1. Survey
List folders, file counts, extension mix, date range and naming patterns for every input. Note different sources: e.g. Patreon downloads (`creator - YYYY-MM-DD - title N.ext`, source quality), forum downloads (`yymmdd-Model-NNNNNN - postname_NN`, variable quality, posts may hold several sets or only fragments), and the hoard (sets that may be AVIF-compressed and may hold an .avif and a .jpg at the same index).

### 2. Copy into the workspace
rsync each input into a staging folder inside the target library (`New/_Small`, `New/_Big`, `New/_SimpCity`...). Verify sizes against the source before working. Ask for delete permission once (it's needed for cleanup) with `device_request_delete_permission` on the project folder.

### 3. Fingerprint every file
One resumable script writes one JSON line per file (rel path, size, md5, ext, kind, width/height after orientation, features). Images: 32x32 grayscale vector + 8x8 RGB thumbnail. GIFs: same for 5 spread frames, plus frame count and duration. Videos: ffprobe dims/fps/duration, plus frames sampled at 2 fps at 32x32 gray (cache these).

```python
import numpy as np, hashlib, subprocess
from PIL import Image, ImageOps   # Pillow 11+ reads AVIF natively: PIL.features.check('avif')
def norm(v):
    v = np.asarray(v, np.float32).ravel(); v -= v.mean(); return v / (np.linalg.norm(v) + 1e-6)
def img_feats(path):
    im = Image.open(path); w, h = im.size
    if path.lower().endswith(('.jpg', '.jpeg')):
        im.draft('RGB', (w // 4, h // 4))          # fast reduced-size JPEG decode
    ori = im.getexif().get(0x0112, 1)
    im = ImageOps.exif_transpose(im).convert('RGB')
    if ori in (5, 6, 7, 8): w, h = h, w
    g = np.asarray(im.convert('L').resize((32, 32), Image.BILINEAR))
    c = np.asarray(im.resize((8, 8), Image.BILINEAR))
    return w, h, g.ravel().tolist(), c.ravel().tolist()
def video_frames(path, fps=2):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'fps={fps},scale=32:32',
                        '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], capture_output=True)
    a = np.frombuffer(r.stdout, np.uint8).reshape(-1, 1024).astype(np.float32)
    a -= a.mean(1, keepdims=True); return a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-6)
```
Use `multiprocessing.Pool(4)` and `imap_unordered`; skip paths already in the output file so a re-run continues.

### 4. Match
- Images: `sim = new @ existing.T` on normalized 32x32 vectors. True matches score about 0.995 or higher; different photos from the same shoot rarely pass 0.8. Use 0.97 as the threshold, then confirm that aspect ratio agrees within about 0.01 and 8x8 color correlation is above 0.98.
- One-to-one assignment per extension layer (avif, jpg, png...) with `scipy.optimize.linear_sum_assignment`. A good file can satisfy both the .avif and the .jpg copy of the same photo.
- Exact duplicates (preview photo = full-set photo, reposts) tie at 1.0. Break ties with a neighbor bonus: prefer the candidate whose post neighbors (index ±1/±2) match the neighbors of the file being matched.
- Don't assume a hoard set's .avif `_N` and .jpg `_N` are the same picture; their orders sometimes differ. Match each file on its own.
- Videos: score = median over frames of the best frame match. The same video scores about 0.95–1.0; different videos score under 0.6. GIF against MP4: compare GIF frames to video frames and check dims and duration.
- md5 catches bit-identical files instantly; files a few bytes apart with identical frames are re-downloads of the same thing.
- Also look for duplicates *within* the existing library and within the new batch, not only across them.

### 5. Decide each match
Compare pixel count, then format/detail, then file size:
- New is better: it replaces the old file, takes its exact name/slot (new extension), the old file is deleted, and any `-compressed` flag goes.
- Old is as good or better (same resolution, equal or bigger file): delete the new copy.
- A photo should live in one set only. Its home is the original, most complete set; drop copies from previews and reposts. A set left empty disappears.
- Practical duplicates (GIF vs MP4 of the same clip, a crop) count as duplicates: keep the better one. A longer or higher-resolution *source* video the clips were cut from is new content, not a duplicate.

### 6. Group and name new content
- Each post is a starting set; files with the same post name stay together.
- Combine adjacent posts that are clearly one shoot: same outfit, hair, location and lighting, usually within days, often with telling titles ("part 1/part 2", "some more photos from this set", "Slap it!" / "Slap it more!").
- Previews, teasers, "full set coming tomorrow" posts and "UNLOCK this set" promo collages belong to the set they announce, even when that set is an existing one.
- Split posts that contain several shoots; give each set its own descriptive title.
- A combined set takes the earliest date and the title of its largest post; files keep their own post-based names inside it.
- Judge looks visually. Color histograms proved unreliable for telling shoots apart. Build contact sheets (PIL montage: about 66x99 thumbs, 10 per row, about 20 posts per sheet, labelled `#idx date n=` in ASCII because the default font can't render emoji, matched files marked). Write them to a temp folder (see Environment notes), stage them with `device_stage_files`, and Read them. For borderline pairs, make a second sheet with larger thumbs. Delete the temp folder at the end.

### 7. Plan, execute, verify
- Write a plan JSON (moves, copies, deletes, folder renames) before touching anything. Assert that every input file is accounted for exactly once, no two files share a target, and nothing would overwrite an existing file.
- The executor uses `os.rename` (same mount, instant), logs every operation, skips work already done, and finally removes the empty staging folders.
- Verify: expected file and folder counts; no loose files at the library root; no nested folders inside sets; moved files match their source size; md5 check on a random sample; indexes contiguous where expected; flags consistent (a folder is flagged if and only if all its files are); original folders still intact.

### 8. Report
Lead with the result: what's now in the library, how many files were upgraded, added and dropped, and what remains flagged. Then list the judgment calls the user may want to check (combined sets, splits, duplicates dropped, anything placed by convention), and say where the untouched originals are. Keep it short; no step-by-step recap.

## Categorizing sets
The user wants sets put into categories: existing ones ("put the beach sets with the others"), new ones ("make categories for her outfits"), or "categorize everything that isn't yet". The judgment is visual, the same as the criterion sort below (manifest, contact sheets, a decision written down the moment you look); the unit is the set and titles mislead.

Ask once how the user keeps categories (folders, a list, a spreadsheet, filename flags) unless it is obvious from the library, and record them that way. Moving set folders into category folders is the bucket method of the criterion sort, with its undo script. Write each call to a file as you make it (set, category, reason), and keep that file with the library's notes so the next batch of sets is judged the same way.

## Sorting sets by an abstract criterion
The user names a quality that no filename, metadata or fingerprint can answer and asks for the set folders sorted by confidence. It might be a pose, an activity, a setting, an outfit, a mood or a quality judgment, and it often comes with a few example folders. Answering it takes visual review at scale.

### Rules
- **The unit is the set folder, judged by its contents.** Whatever a set holds (photos, videos, GIFs, or a mix), its bucket comes from looking at that media, never from its title. Titles hint and routinely mislead.
- **Aggregation.** By default a set takes the bucket of its strongest item: one clear video, or a clear run of photos, qualifies the whole set. If the user cares about proportion ("mostly", "the whole set"), score the share of matching items instead. Say in the report which rule you used.
- **The user's examples are the rubric.** Treat them as anchors: positives ("definitely"), near misses ("very close, but I wouldn't call it exactly") and negatives. A near miss marks the boundary, so give it its own bucket.
- **Buckets.** If the user doesn't care what they're called, use 4–6 numbered folders ordered by confidence. For example: `1 - Definite`, `2 - Likely`, `3 - Close, <what the near miss is>`, `4 - Maybe`, `5 - Unlikely`, `6 - No`. Create them where the sets live (usually the library root) and move whole set folders into them. Never rename sets or touch the files inside them.
- **Every set lands in exactly one bucket**, clear negatives included, so nothing is left loose beside the buckets.
- **Stills can't show motion.** When the criterion is a motion, a pose that fits but can't be confirmed from frames goes to Likely, not Definite. More frames from a short window (12–16 over 3 s) can help settle it.

### Workflow
Set up a task list: manifest, first pass, calibrate, second pass, plan and move, verify, report.

1. **Manifest.** List every set folder and every media file in it in a stable order (sorted folders, then sorted files) and number the items. Save the list as `manifest.json` inside the temp folder (see Environment notes) beside the sheets, not only in `$HOME/work`, because a later session's `$HOME` is gone and the sheet numbers are useless without the list. If an earlier session left sheets but no manifest, rebuild the list the same way and check a few sheet labels against it before reusing the sheets.
2. **Sample every item.**
   - Videos: 6 frames spread evenly across the duration (at `(k+0.5)/n`) for the first pass.
   - GIFs: the same, spread over their frames.
   - Photos: one row per set with up to 6–8 photos spread evenly through the set order (all of them if there are fewer).
   - Mixed sets: each video gets its own row and the photos share one.
   - Cache each row as a PNG so reruns are instant. Run the generator under `timeout 170`, skipping sheets that already exist, and repeat until done.
   ```python
   def strip(path, n=6, tw=90, th=160):
       d = float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',path],
                                capture_output=True, text=True).stdout or 10)
       out = Image.new('RGB', (tw*n, th), (30, 30, 30))
       for k in range(n):
           r = subprocess.run(['ffmpeg','-v','error','-ss',f'{d*(k+.5)/n:.2f}','-i',path,'-frames:v','1',
                               '-vf',f'scale={tw}:{th}:force_original_aspect_ratio=decrease',
                               '-f','image2pipe','-vcodec','png','-'], capture_output=True)
           try:
               im = Image.open(io.BytesIO(r.stdout)).convert('RGB')
               out.paste(im, (k*tw + (tw-im.width)//2, (th-im.height)//2))
           except Exception: pass
       return out
   ```
   For photos, use `ImageOps.exif_transpose` and `thumbnail((tw, th))` instead.
3. **First pass.** Make contact sheets of about 20 rows (two columns of ten). Label each row in ASCII: `#<index> <set header> <duration or n photos>`. Read about three sheets per turn. Score every row 0–10 the moment you've looked at it and append the score to `scores.txt` (`index score [v]`), adding `v` when you're unsure. Images drop out of context after a few turns (`[media removed]`), so never score from memory and never put off writing scores down.
4. **Calibrate.** Before the second pass, render the user's examples (plus a few of your own top and boundary scores) as large strips: 8 frames at about 150×266. Look at them together and pin down what each score level means. Also watch for a recurring look-alike: something that shares the camera angle or framing but isn't what the user asked for. Give it its own verdict, put it in a lower bucket and mention it in the report.
5. **Second pass.** Review every `v` row at the large size, 6 rows per sheet. Record a verdict code per item in `verdicts.txt`, using a small fixed set of codes that each map to one bucket (clear match, likely, near miss, look-alike, possible, no).
6. **Plan.**
   - Give each item a bucket: its verdict if it has one, otherwise its score band.
   - Give each set a bucket using the aggregation rule.
   - Write `plan.json` with one move per set folder.
   - Assert that every set appears exactly once, every target is unique, nothing already exists at a target, and the user's examples land where they said they should.
7. **Execute** with `os.rename` (same mount, instant), logging each move. Write an undo script at the library root: `_undo_sort.command`, made executable, which does `mv -n` for each folder back to where it was and then `rmdir`s the buckets. The user can reverse everything with a double-click.
8. **Verify:**
   - The total number of set folders and media files is unchanged.
   - Per-bucket set and file counts add up.
   - Nothing is loose at the root except the buckets, the temp folder and the undo script.
   - No nested folders were created inside sets.
   - The reference examples are in their expected buckets.
9. **Report.** Lead with a short table (bucket, number of sets, what's in it). Then list the judgment calls: look-alikes, the aggregation rule, poses you couldn't confirm from stills. Say where the undo script is and that the temp folder can be deleted.

## Environment notes (computer link)
- Work on the user's files with `device_bash`; connected folders are under `$HOME/mnt/<folder>`. Keep scripts, fingerprints, plans and logs in `$HOME/work` (outside the user's folders). Anything a later session needs to resume (manifests, scores, contact sheets) also goes in a **temp folder** inside the connected folder (such as `_tmp_check`), since a later session's `$HOME` is gone. (A Local Gallery library says where its own goes.)
- Each call is capped at about 180s, and background processes (`nohup`, `setsid`, `&`) are killed when the call ends. Run long jobs as resumable scripts under `timeout 170` and repeat the call until done. A large rsync may need two calls (`--partial`, then re-run).
- The device had Python 3 with Pillow (AVIF support), numpy, ffmpeg/ffprobe and rsync. `pip3 install --user scipy` worked. Model-weight hosts were blocked, so there are no neural embeddings; rely on pixel fingerprints plus visual review.
- Contact sheets: stage about 12 at a time with `device_stage_files` (50 max per call) and Read about three per turn. Reading more at once has returned `[media removed: request limit]`.
- Deleting needs `device_request_delete_permission` (once per session) on the project folder.
- The user may make a backup zip of the library before a risky round; never touch it.

## Pitfalls seen before
- Dates and post numbers in names (and in the forum thread) can be off; don't use them to identify content.
- A forum post can hold several sets, a fragment of a set, or reposts of old material; one hoard set can be assembled from several posts.
- Patreon gif-only posts sometimes duplicate clips that also appear as MP4s elsewhere, and a forum post may carry the full-length source video the GIFs were cut from.
- Later posts repost older photos at lower resolution or slightly cropped; the full-resolution original's set is the home.
- Keep checking for name collisions before renaming, and re-check the flag rules after every change to a folder.
- Post numbers repeat across different sets (the same six digits on two dates), so key everything on the full folder name, never on the number alone.
- When sorting by a criterion, near-identical setups recur across many posts (same room, same prop, same camera angle). Once one is calibrated, apply that judgment consistently to the whole run, but still look at each item.