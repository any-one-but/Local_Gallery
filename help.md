Disclaimer: Local Gallery is a web app that runs locally on your computer. It cannot delete files. No files you give it access to are ever uploaded anywhere. It uses disk write permissions to create and edit logs it keeps in a system file in any folder you load into it. It also has permissions to rename files, but only when you choose to (these actions are called Rename, Batch Index I, and Batch Index II).
## Basics
Local Gallery is a media viewer designed to use hot keys for interactions and it mirrors many of it's controls down the middle of the keyboard so it can be used one handed by anyone.
## PANIC!
Press your PANIC! key at any point to instantly mute all audio and blank the window. By default, PANIC! also opens a random safe window, but you can turn this off in the Options Menu if you prefer. Press your PANIC! key again to disengage.
## Getting Started
Start by choosing a folder as your root with the `Upload Folder` button. I recommend  choosing the highest level directory in your collection. The first time you choose a folder as your root, Local Gallery will make a system folder inside called `.local-gallery` to store information about the content and to save your option preferences. Loading a folder may take a few seconds. Once it's loaded, all immediate subfolders will appear on the left in the Directories Pane and the Preview Pane on the right will populate with the contents of the selected folder.
## Navigation
Navigation is designed to be easy and quick to use only with your off hand. Righties use `WASD` and lefties use `IJKL` to navigate through the file structure. `WS`/`IK` Move up and down the Directories Pane, changing the selected item. By default, files and folders are sorted alphabetically top to bottom in the Directories Pane. Use `D` or `L` to move left into a selected folder, and use `A` or `J` to move right out of it. 
## Shortcuts
You can use the number keys above your hand and the key immediately below to move more quickly. For righties thats `12345` and `X` and for lefties thats `67890` and `M`. Use the keys immediately above and below your up/down keys (`3` and `X` or `9` and `M`) to move to the first file of the next or previous directory your current parent folder. You can use `4` and `3` or `9` and `7` to jump 10 items up or down in the Directories Pane, or `5` and `1` or `0` and `6` to jump 50 items.
## Controls
- Use `G` to enter Gallery Mode, which displays media fullscreen. In default Gallery Mode, you can still navigate as noraml through out your root, it's just less informative. You can enable the Alt Gallery Mode in settings, which makes your enter folder key (`D` or `L`) start Gallery Mode when you have a file selected, and you turn it off with you exit folder key (`A` or `J`). You cannot navigate as normal in Alt Gallery Mode and `G` is disabled. 
- Use `R` or `Y` to toggle Random Mode. In Random Mode, every directory will shuffle it's file contents into a new order. Each time you toggle this mode, each directory is shuffled globally and remain in that order until it's toggled off. You can enable Random Mode as the default mode for your root in the Options Menu.
- Use `F` or `H` to cycle through the Media Filters. The filters are: All, Images only, Videos only, and GIFs only. Each filter hides media outside it's type and folders which don't contain any of it's type.
- Use `C` or `N` to cycle through Folder behavior modes. The modes are: Slide, Stop, and Loop. The slide behavior makes it so that when are the first or last file in a directory and move in the direction of the edge, you jump in to the nearest file in next folder in your currect parent folder (it makes sense when you use it). Stop mode makes it so then when you reach the last file in a folder, you stop and must leave the folder or go back. Loop makes it so that when you reach the last file in a folder, you can move to the next file and it loops you back to the first file in that folder. You can choose the default folder behavior for your directory in the Options Menu.
- Use `Shift` to enter Slideshow mode. By default, `Shift` cycles through different Slideshow speeds, but you can choose a single speed that it toggles on/off in the Options Menu. Slideshow mode will act according to the Folder behavior mode you have set.
- Use the `Q` and `E` or `U` and `O` to step forward or backward in video. You can choose the number of seconds you step in the Options Menu. Use `Space` to play or pause video.

## -- OLD HELP MENU KEPT FOR POSTERITY --


Local Gallery is a local-only browser for folders of images and videos, with most controls mirrored so you can use it one-handed from either side of the keyboard. It loads a folder locally and never uploads files, but it can alter files by writing metadata (scores, tags, options) so use it cautiously. The root starts on the left and you navigate deeper by moving right and down; the directories pane lists the current folder's files, while the preview pane shows the selected item in more detail.

## Load a folder (writable)
- Click `Load Folder` to pick a root folder. The app will scan for images/videos and create a small `.local-gallery` folder to store scoring, tags, and preferences.
- Only media files are shown (images + videos). Filter modes can restrict what appears.

## Basic navigation keys (mirrored)
- Move selection: `↑/↓`, `W/S`, or `I/K`.
- Enter/leave folders: `→`/`Enter`/`D`/`L` to go in, `←`/`Backspace`/`A`/`J` to go out.
- Open Gallery Mode: `G`. Close preview/gallery: `Esc` (or `G` in Gallery Mode).
- Fast jumps: `1/6` -50, `2/7` -10, `3/8` previous folder's first file, `4/9` +10, `5/0` +50.
- Video controls: `Space` play/pause, `Q/E` seek back/forward, mirrored by `U/O`.
- Filters & behaviors: `F/H` cycle media filter, `R/Y` toggle random order, `C/N` cycle folder behavior.
- Slideshow: `Shift` toggles the slideshow speed set in Options.
- Jump to next folder's first file: `X` or `M`.
- Jump to previous folder's first file: `3` or `8`.

## Other hotkeys & controls
- Hold `/` to show the keyboard cheatsheet overlay (only while the key is held down).
- Use the `?` button in the title bar to open/close this help panel.

## PANIC! button
- Press your PANIC! key to trigger PANIC! (mutes Local Gallery, blacks out the screen, and can open a harmless site). Press it again to resume.

## Directories + preview panes
- Selecting a folder shows its contents; selecting a file shows a large in-pane preview.
- The breadcrumb at the top lets you jump to any parent folder.
- Press `Esc` while previewing a file to return to folder preview.

## Gallery Mode (fullscreen overlay)
- Open with `G`. Close with `G` or `Esc`.
- `↑/↓` moves between items (folders and files) in the current directory.
- `←/→` leaves/enters directories (folders act like navigable items).

## Searching
- Use the search bar to filter the current view by name (folders only).
- Search stays active until you click `X` in the search bar.

## Scoring (folder scoring)
- Scoring visibility is controlled from `Preferences` in the Options menu.
- Folder scores can show arrows, show score only, or hide everything.

## Tags (single-folder)
- Open the folder menu (⋯) on a folder row and choose `Tag` to edit its tags (comma-separated). Press `Enter` to save or `Esc` to cancel.
- When the current directory contains tagged child folders, tag chips appear (with counts). Click to include, click again to hide, click a third time to clear.

## Tags (multi-folder)
- Click `Select` to show folder checkboxes, then click folders to select multiple folders.
- Use the select menu (☰) to tag, favorite, or hide the selected folders. `Tag selected` opens the bulk tag row.
- In the bulk tag row, type comma-separated tags and/or click existing tag chips, then click `Apply`.
- Click `Clear` to reset the selection.

## Hidden folders
- Use the `Hidden` button to switch into hidden mode and view hidden folders.
- Hidden folders are only visible while hidden mode is active.
