# Folder Thumbnail Presets

## Overview

There are now two file-menu actions that can set thumbnails on folders:

- `Set folder thumbnail`
- `Set parent thumbnail`

They both use the selected file as the image source, but they target different folders.

## `Set folder thumbnail`

- Source: the selected file.
- Target: the file's immediate containing folder (`rec.dirPath`).
- Result: that folder gets a manual thumbnail preset.
- Removal: in that folder's menu, `Use default thumbnail` appears contextually and clears the manual preset.

Use this when you want direct, local control over the thumbnail of the current folder.

## `Set parent thumbnail`

- Source: the selected file.
- Target: nearest ancestor folder that is eligible for parent presets.
- Eligibility logic:
  - walks up ancestors from the file's folder;
  - skips ancestors that already have direct-file thumbnails in normal rotate mode;
  - accepts folders designed to use recursive rotating/derived thumbnails.
- Result: the selected file becomes the manual thumbnail for that ancestor.

Use this when the immediate folder is already media-backed, but a higher virtual/aggregate folder should be pinned to a specific image.

## `Use default thumbnail` (Folder Menu)

- Contextual: only appears when a folder currently has a manual preset.
- Action: clears the manual preset.
- After clearing: folder returns to normal default behavior (first direct media if present, otherwise rotate/none based on existing folder thumbnail mode rules).
