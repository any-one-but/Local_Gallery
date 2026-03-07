# Feature 07: A/B Compare Panel

## Goal
Add a lightweight side-by-side compare workflow for similar files so users can quickly pick a winner with one action.

## User Experience
- Start compare from a file menu action: `A/B compare from this file`.
- Panel opens in the preview pane with two candidates:
  - Left: anchor file.
  - Right: next candidate from the same directory order.
- Actions in panel:
  - Pick Left
  - Pick Right
  - Next Candidate
  - Exit Compare
- Winner selection should be fast and iterative:
  - Selected winner becomes new anchor.
  - Right side advances to next candidate.

## Input Model
- Add keybind actions (unbound by default):
  - `toggleComparePanel`
  - `comparePickLeft`
  - `comparePickRight`
  - `compareNextCandidate`

## Data Model
- Persist compare decisions in metadata stats log:
  - Pair key: stable pair of relative paths.
  - Value: winner path + timestamp.
- Keep compare state ephemeral in view state.

## Safety / Edge Cases
- If fewer than 2 files are available, show status and refuse to open panel.
- If a compared file no longer exists, auto-advance or exit compare.
- Compare mode should not mutate files directly.

## Validation
- Open compare from file menu in a folder with 3+ files.
- Choose left/right repeatedly and confirm panel keeps advancing.
- Reopen app and confirm decisions persist.
