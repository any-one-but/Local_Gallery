# Thumbnail Crop UX (Per-File, Non-Rotating)

## Goal
Provide a simple way to control crop focus and zoom for thumbnails that use a specific file, while keeping rotating and null thumbnail modes untouched.

## Scope
- Entry point: file menu action `Edit thumbnail`.
- Crop is stored per file (`relPath`) and reused everywhere that file appears as a non-rotating thumbnail.
- Applies to:
  - File cards (directory + preview)
  - Manual folder thumbnails
  - Manual tag/favorites/root thumbnails
- Does not apply to:
  - Rotating thumbnails (`data-rotate-key`)
  - Null/no-thumbnail states

## UX
1. User opens a file menu and clicks `Edit thumbnail`.
2. App opens a modal with:
   - Live square preview
   - Horizontal focus slider (0..100)
   - Vertical focus slider (0..100)
   - Zoom slider (1..4)
   - Reset / Cancel / Save buttons
3. Gestures:
   - Drag to pan
   - Pinch to zoom
   - Pinch center movement also pans
4. Save updates all non-rotating usages of that file immediately.

## Crop Math
- Cover layout is computed from image aspect + zoom.
- Pan uses clamped `left/top` bounds so viewport never leaves image bounds.
- Zoom increases available pan range in both axes.
- This avoids the portrait/landscape trap where one axis stays locked after zoom.

## Persistence
- New metadata map: `WS.meta.fileThumbCrop: Map<relPath, {x, y, zoom}>`
- Saved in tags log under: `fileThumbnailCropByRelPath`
- Loaded from tags log on workspace load.
- Remapped on file/folder rename so crop follows moved files.

## Defaults and Cleanup
- Default crop (`x=50, y=50, zoom=1`) is treated as unset and removed.
- Missing or invalid values normalize to defaults.
