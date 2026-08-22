# Stripper UI Style Guide

A Stripper is a small dark panel that sits on someone else’s site and does one job: take media off that site, named and filed. Every Stripper should look like the same tool wearing a pin from the site it lives on.

The Playboy Plus Stripper is the reference. Copy its chrome, type, spacing, radii, and information layout. Change only the accent, so the panel belongs to that site.

This is both a look and a way of arranging things. Matching the numbers without matching the arrangement is still wrong.

---

## How it should feel

A private collector’s instrument. Warm, compact, sure of itself. Not a settings form, not a website, not a browser extension store page.

It is a guest on a loud page, so it is quieter than the page and more ordered than the page. Empty space is a decision. If two controls are equally loud, one of them is in the wrong place.

---

## The one thing that changes: the site accent

Pick **one** color from the host site — the color in its logo, its primary buttons, or its links. That is the accent. Every Stripper uses a different accent. Everything else stays.

Use that accent **rarely, and always to mean something**:

- The panel title
- The current tab
- The one primary action on a pane (filled chip, dark text on the accent, not white on the accent)
- Drop-zone border and fill
- Focus ring on fields
- Progress fill
- Links inside result cards
- Hover on ordinary buttons (a wash of accent, not a new color)

Do not paint backgrounds, body text, or every border with it. A panel soaked in the site color looks like a skin. A panel that flashes the site color at the title, the drop, and the main button looks like a tool that knows where it is.

If the site’s brand color is a pure digital hue, warm it slightly so it sits on the dark panel. If the site is already dark, take their link or brand color, never their background.

### Accent recipes

Always the same color, at different strengths:

| Use | Strength |
|---|---|
| Panel edge | 40% |
| Drop-zone idle border | 45%, dashed |
| Drop-zone idle fill | 6% |
| Drop-zone active border | 100%, solid |
| Drop-zone active fill | 22% |
| Tab on, button hover fill | 18–20% |
| Tab on, button hover border | 55% |
| Field focus border | 70% |
| Field focus ring | 14%, 2px outside |
| Quiet section rules, card edges, tray edge | 12–16% |
| Range dash between min and max | 45% |
| Kind spine on a card | 13% fill, accent text |
| Partial / in-progress badge | 18% fill |

Primary action: **solid accent, panel-dark text, 900 weight.** Hover is a lighter step of the same accent, not a second hue.

Checkboxes use the accent as their tick color.

---

## Shared chrome (never changes)

The panel is a warm dark room, not a cool gray overlay and not pure black.

| Role | Color | Notes |
|---|---|---|
| Panel ground | `#141210` | Off-black with brown in it |
| Field ground | `#211d19` | One step up, for inputs and selects |
| Head bar | `#33261a` → `#1a1613` | Left-to-right, slightly lighter at the left |
| Body text | `#f2ece1` | Warm off-white |
| Secondary text | `#cfc2ae` / `#bdb1a0` | Labels, summaries, quiet buttons |
| Faint text / kickers | `#857a68` | Uppercase rails, field captions, placeholders nearby |
| Placeholder | `#8f806b` | |
| Quiet fill | white at 3–8% | Default buttons, cards, option rows |
| Quiet line | white at 10–14% | Default borders, head underline |
| Disabled | opacity 42% | No extra gray |
| Stop | `#4a3323` fill, cream text, accent-strength border | The only warm-dark filled button besides the primary |
| Hidden / danger | muted red, never the site accent | Card, badge, spine |
| Downloaded / ok | muted green, never the site accent | Badge only |

Hidden is a state, not a theme. Red is reserved for “this is out of the way.” Green is reserved for “this is fully in hand.” Partial borrows the site accent at low opacity, because it is still in progress, not an error.

No drop shadows on controls, cards, tabs, or fields. The **panel itself** is the one exception: `0 18px 60px` black at 60%, so it lifts off the foreign page. Insets and 1px edges do the rest of the separation.

---

## Type

One family: **Arial**. No second font. No system-ui. No icons-as-fonts.

| Role | Size | Weight | Line | Extra |
|---|---|---|---|---|
| Body / buttons / fields | 12px | 700 | 1.35 body, 1 on buttons | |
| Panel title | 12px | 900 | | Accent color, ellipsis if it overflows |
| Section kicker (`Find`, `Housekeeping`) | 10px | 900 | | Uppercase, letter-spacing `.12em` |
| Row rail (`Look`, `When`, `Counts`) | 10px | 900 | | Uppercase, letter-spacing `.08em` |
| Field caption (`Show`, `From`) | 10px | 900 | | Uppercase, letter-spacing `.06em` |
| Live-status rail (`Model`, `Sets`) | 10px | 900 | | Uppercase, 56px column |
| Search field | 13px | 700 | | |
| Result title | 13px | 900 | | Ellipsis |
| Result meta / models | 11px | 700 | | Ellipsis, one line |
| Card actions | 10px | 700 | | |
| Kind spine, badges | 9px | 900 | | Uppercase; spine letter-spacing `.16em` |

Two weights only: **700 and 900**. Never regular, never italic, never a third weight to make hierarchy. Hierarchy is size, case, and color.

Text is **left-aligned**, always. The only centered text is the drop-zone prompt and the label inside a full-width button (the button is the object; the text is on it).

One line with an ellipsis beats two wrapping lines in titles, meta, and status. Summaries in the results tray may wrap; they are the caption for a list, not a chrome label.

---

## Spacing

Base unit **8px**. Everything is 4, 6, 8, 10, 12, or 14.

| Where | Gap / padding |
|---|---|
| Panel inset from the window | 16px from the top and right |
| Body padding | 10px |
| Default stack (pane, body, simple blocks) | 8px |
| Advanced pane, and the stack of Find / filters / actions | 14px — sections, not fields |
| Inside a block (kicker to field) | 8px |
| Field caption to control | 4px |
| Tab row | 6px |
| Head bar internal | 6px |
| Card body | 10px 12px 12px |
| Card action grid | 6px, with 8px above a 1px rule |
| Results tray padding | 12px |
| Option row, checkbox to label | 10px |
| Filter rail to fields | 12px horizontal, 8px vertical |

If you are unsure, use 8. If it is a new *section*, use 14. Do not invent 5, 9, 11, or 16 inside the panel.

---

## Corner radius

One family, stepped by how big the object is:

| Object | Radius |
|---|---|
| Panel, results tray, result card | 10px |
| Search field | 9px |
| Default button, drop zone, option row, stats chip | 8px |
| Fields, tabs, icon button, compact card buttons | 7px |
| Kind spine | 0 — it is clipped by the card |
| Badges, progress bar | 999px (pill) |

Do not mix a 4px chip with a 12px panel. If a new object appears, pick the nearest of these.

The panel clips its own overflow, so the head bar’s square corners are hidden by the 10px panel radius.

---

## Lines

Every line is **1px**. Never 2px. Never a line made of shadow.

| Line | Treatment |
|---|---|
| Panel edge | 1px accent at 40% |
| Head bar underside | 1px white at 10% |
| Default control edge | 1px white at 14% |
| Quiet inner edge (tray, card, section rule) | 1px accent at 12–16% |
| Housekeeping separator | 1px accent at 14%, above the section |
| Card action splitter | 1px accent at 12%, above the buttons |
| Drop idle | 1px dashed accent at 45% |
| Drop active | 1px solid accent at 100% |
| Range dash (min — max) | 1px × 12px wide, accent at 45% |
| Focus | 1px accent at 70%, plus a 2px ring at 14% |

Dashed means “drop something here.” Solid means “it is landing.” Do not dash anything else.

Do not put a box around every group. Boxes belong to **the panel, the results tray, and the card**. Filter rows are labeled, not enclosed. Nested boxes are how a designed layout turns back into a form.

---

## Alignment

- The panel is a **column**. Things stack. They do not float.
- **Hanging labels** for related controls: a 48px uppercase rail on the left (`Look`, `When`, `Counts`), fields on the right. The rail sits beside the controls, not beside the field captions.
- Live run readout is the same idea at 56px (`Model`, `Sets`, `Current`, `Files`).
- Result cards: 28px vertical kind spine on the left, content on the right. Title left, badges right, on one row.
- Primary and secondary actions share a row, primary wider (`1.4fr` / `.8fr`).
- Housekeeping is two equal columns on a wide panel, stacked on a narrow one.
- Filter grids take only as many columns as they have real questions: three for Look, two for When, four for Counts. Do not pad a grid to an unused fourth cell.
- On a narrow panel (700px and below): two columns for filters, Look’s last field spans the full row, hanging rails stack above their fields, action rows become one column.

Nothing is centered as a layout. Nothing wraps the cursor around. Lists do not shrink their children to fit; they scroll.

---

## The panel on the page

- `position: fixed`, top-right, 16px in.
- Default width **300px**. Wide panes (search, index, anything that has to show a list of cards) **760px**, capped at the window minus 32px.
- Max height 88vh default, 94vh wide. The body scrolls; the head does not.
- `z-index: 2147483646` so the host page cannot cover it.
- Collapsed: head only.
- Prefix every rule with the panel id. The host page will fight you. Win on purpose. List rows must not shrink when there are many of them (`flex: 0 0 auto` on each card; the list scrolls).

The Stripper is not the site. Do not inherit the site’s type, radii, or buttons.

---

## Controls

**Default button.** Full width of its cell, min-height 32px, padding 0 10px, 8px radius, white 8% fill, white 14% border, 700 / 12px. Hover: accent wash and accent border. Disabled: 42% opacity, no pointer.

**Primary button.** Same shape, solid accent, dark panel text, 900. One per pane. If you cannot point to it in a second, there isn’t one.

**Quiet button.** Transparent fill, secondary text. For Clear, Hide, and other “not the point of this pane” actions. It must still have a 1px edge so it is findable.

**Icon button.** 28×28, 7px radius, in the head only.

**Tab.** Min-height 28px, 7px radius, secondary text. On: accent wash, accent border, light text. Equal columns.

**Field.** Height 30px, 7px radius, field ground, 8px inner padding, 700 / 12px. Search is allowed to be 38px / 13px / 9px radius / 12px padding — it is the Find control, so it is slightly larger than a filter.

**Number fields.** No stepper arrows. A min and a max that describe one quantity share one caption and a 1px dash between them.

**Option row.** A default-height outlined bar with a 15px checkbox and a sentence. The whole bar is the hit target. This is a setting, so it looks like a setting, not like a button.

**Drop zone.** Dashed accent, centered prompt, min-height 44px (56px in a wide advanced pane). It is the start of the job; it may be taller than a field. On drag it goes solid and fills.

**Progress.** 10px tall, full pill, quiet track, accent gradient fill. Only while a run is happening.

**Stop.** Visible only during a run. Warm dark fill, cream text. It is the emergency, not a sibling of Search.

---

## How to lay out information

This is the part that matters more than the radii.

### 1. One job per band

Read the pane top to bottom as a sequence of questions, not a pile of widgets.

1. **Put work in** — the drop.
2. **Find** — one search field, named.
3. **Narrow** — only the questions that change the set, grouped by what they ask.
4. **Act** — one primary, one quiet undo.
5. **Housekeeping** — things you do to the library, not to this search. Below a 1px rule, so they cannot be mistaken for Search.
6. **See what came back** — a sunk tray. Output, not more input.

A control lives in the band of the question it answers. “Hide video-only sets” is not a search button. “Skip Various” is not a filter. They do not sit in the Search row just because they are controls.

### 2. Group by the question, not by the widget

Do not line up eleven filters in one grid because they are all `<select>` and `<input>`. Ask what the person is deciding:

- **Look** — what kind of thing (models or sets, type, files).
- **When** — a from and a to.
- **Counts** — how many pictures, videos, views, likes.

Two values that are one range (min and max) are one field with a dash, not two captions. “Images” then Min — Max. Not “Images min” and “Images max” as strangers.

### 3. Name the band, not the box

A 10px uppercase kicker (`Find`, `Housekeeping`) is enough to open a section. A 10px uppercase rail (`Look`) is enough to name a row. Do not also wrap that row in a bordered card. Three nested boxes is the look of a form builder.

Kickers are faint. They organize; they do not compete with the title or the primary button.

### 4. One primary action

Every pane has a thing you are probably here to do. Make that control the only solid accent fill. Everything else is quieter: outline, transparent, or a checkbox in a bar.

Changing a setting never needs to be as loud as running a search. Stopping a run is loud in a different way (its own color, only while running).

### 5. Output lives in a tray

Results, empty states, and “here is what that did” copy sit in a slightly darker well (black at 22%, 10px radius, 1px quiet accent edge, 12px padding). That well is always there, even empty, so the destination of a search is visible before anything is in it.

The caption of the tray is a sentence: “Index or import logs, then search.” or “59 results from 1 log: 8 models, 51 sets.” Human, specific, not “No data.”

Cards inside the tray do not shrink to share the tray’s height. The tray scrolls.

### 6. A card is a record, not a toolbar

Each result is one object:

- A **spine** naming what it is (`model`, `set`), vertical, 28px, clipped by the card radius. Different kinds may tint the spine differently; hidden always turns the spine to the danger color.
- A **title**, 13px / 900, with status pills on the right.
- One line of facts. One line of people or type.
- Actions behind a 1px rule, grouped by job: hide is the tall quiet button on the left; download across the top; marks across the bottom.

Do not scatter seven equal buttons in a leftover 4-column grid. If actions are different jobs, they must look like different jobs.

Hidden cards shift the whole card to the danger wash, not just the badge. You should see the state in the row without reading.

### 7. Busy is a mode, not extra clutter

While a run is going: the drop hides, the progress bar and the live four-line readout and Stop appear. The rest of the pane stays. Do not invent a second progress design.

The live readout is a hanging-label list, same type as the filter rails. It is a status strip, not a dashboard.

---

## Anatomy (the shared skeleton)

Every Stripper panel, in this order:

1. **Head** — 38px, grab to move, title in accent 900, collapse on the right.
2. **Tabs** — only if there is more than one pane. Equal columns. The current tab uses the accent wash.
3. **The active pane** — one of the bands above. Simple can be only a drop. That is allowed. Do not add chrome to keep it from looking empty.
4. **Run furniture** — progress, live lines, status sentence, Stop. Hidden until needed.

Simple, Advanced, Indexing (or whatever the site actually needs) are panes, not separate windows. The panel gets wide when the pane needs width, and goes back to 300px when it does not.

---

## What not to do

- Do not introduce a second accent, a rainbow of badges, or the host site’s own buttons.
- Do not use drop shadows, gradients (except the head bar and the progress fill), or blur.
- Do not center long text.
- Do not put a border around every field group.
- Do not make every button the primary.
- Do not use emoji as icons, or a second typeface for “personality.”
- Do not let a list of cards flex-shrink into hairlines.
- Do not copy the host page’s light theme into the panel. The panel is always the warm dark room.
- Do not name a section after the widget (`Dropdowns`, `Checkboxes`). Name it after the question.

---

## Checklist for a new Stripper

- [ ] Panel chrome, type, radii, spacing, and z-index match this guide.
- [ ] One accent, taken from the host site, used only in the roles above.
- [ ] Title, current tab, drop, primary action, focus, and progress all speak that accent.
- [ ] Hidden is muted red. Complete is muted green. Partial is the accent at low opacity.
- [ ] Each pane has exactly one solid-accent action, or none if the pane is only a drop.
- [ ] Filters are grouped by question, with hanging labels, not one dump grid.
- [ ] Ranges share a caption and a dash.
- [ ] Housekeeping is below a rule, not in the act row.
- [ ] Results sit in a sunk tray that still exists when empty, with a sentence for a caption.
- [ ] Cards keep their height; the tray scrolls.
- [ ] Host-page CSS cannot restyle the panel (rules are prefixed; list items do not shrink).
- [ ] A 300px simple pane and a 760px wide pane both look like the same object.

If those are true, it is a Stripper. If a control looks “plopped,” it is in the wrong band or at the wrong loudness — fix the arrangement before you add more decoration.
