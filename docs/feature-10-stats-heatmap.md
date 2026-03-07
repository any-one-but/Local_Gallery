# Feature 10: Usage Stats + Heatmap

## Goal
Provide a compact dashboard for usage analytics and organization quality signals.

## User Experience
- Add a `Stats dashboard` block in Menu -> General.
- Show:
  - Most viewed files.
  - Recently viewed files.
  - Video completion rate (avg).
  - Folder quality trend (avg folder score delta vs previous snapshot).
  - Orphaned content alerts (folders with media but no tags/favorite and low score).
  - 7x24 activity heatmap (weekday x hour).

## Data Model
- New persisted stats document with:
  - Per-file counters (views, last viewed, max completion).
  - Heatmap buckets by local weekday/hour.
  - Folder visit counters.
  - Compare decisions (shared with feature 07).
  - Score snapshots for trend estimation.

## Persistence
- Store in local mode and FS mode with existing metadata save cadence.
- New file in `.local-gallery`: `usage-stats.log.json`.

## Collection Rules
- Count a file view when a file is rendered in preview/viewer with debounce to avoid double-count spam.
- Update video completion via `timeupdate` from preview/viewer media elements.
- Record folder visit on directory context change.
- Capture score snapshots on score edits (throttled, bounded history).

## Validation
- Browse several files, then open dashboard and verify counters update.
- Play part of a video and verify completion metrics.
- Change folder scores and verify trend line/value updates.
