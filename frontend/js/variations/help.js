/* Variations: help
   The ? dialog. */

// -- imports (generated) --
import { $, closeDialog, el, esc, showDialog } from "./dom.js";
import { HOST, isApp } from "./store.js";
// -- end imports --

/* ============================================================
   10. Help
   ============================================================ */

export function showHelp() {
  $("#vxDlgTitle").textContent = "Variations";
  $("#vxDlgBody").innerHTML = `
    <h3>All the versions, at once</h3>
    <p>A <b>project</b> is one prompt. A prompt is a stack of <b>blocks</b> — Role, Task, Tone,
    whatever you like. Each block holds as many <b>variants</b> as you want, and they all stay
    on the table: nothing is buried in history. Switching a block swaps that part of the prompt
    instantly. A <b>take</b> saves the whole combination so you can jump back to it in one click.</p>
    <h4>Null: showing nothing is a choice</h4>
    <p>Nothing here has an on/off switch. Instead, the first slot in every row is <b>Null</b> — the
    empty option. Put a block on Null and that block drops out of the prompt; put a group on Null
    and the whole group does; put a variant's version row on Null and that variant contributes
    nothing while it is picked. Null cannot be renamed, moved, deleted or written into. It is the
    absence, wearing the shape of an option, so a block is always showing exactly one thing and one
    of the things it can show is nothing.</p>
    <p>Nothing is forgotten while it sits there: the variant, the version and the arrangement you
    came from are all still recorded, and clicking any of them brings it straight back. <kbd>0</kbd>
    picks Null for the focused block, <kbd>space</kbd> flips between Null and whatever it was last
    showing, and <kbd>h</kbd>/<kbd>l</kbd> walk through Null on their way round the ring.</p>
    <h4>Versions inside variants</h4>
    <p>A variant is a slot, not a leaf. Each one holds <b>versions</b>, and the text lives on the
    version, so “concise” can keep three degrees of concise without spending three variant slots
    on a single idea. The open variant's versions sit in the mustard row under the chips; a variant
    holding more than one shows a small count so it never hides its depth. Arrangements and takes
    both record the version alongside the variant.</p>
    <h4>Word banks</h4>
    <p>A <b>word bank</b> is one named swap shared by the whole project. Name it in capitals with
    underscores, give it as many words as you like, and pick one. Then write the name straight into
    any block: <code>Explain this to AUDIENCE.</code> The assembled prompt gets the selected word,
    and the substituted run is underlined in the Assembled pane so you can see what came from where.
    The naming rule is the whole trick — SCREAMING_SNAKE never turns up by accident, so there is no
    escaping syntax to learn. Renaming a bank rewrites every mention for you. A bank you have not
    filled in leaves its own name in the prompt rather than quietly deleting itself, and one that
    nothing mentions is struck through in the rail.</p>
    <h4>Notes that never ship</h4>
    <p>A line starting with <code>//</code> is a <b>note</b>: it lives in the text, right next to the
    sentence it is about, and it is taken out before the prompt is assembled, before the banks are
    substituted and before every count you see. A line that is only <code>//</code> opens a note that
    runs until the next line that is only <code>//</code>, so a paragraph of commentary needs one
    marker, not one per line. Notes are banded in the editor, they travel with a fork, a duplicate
    and an export, and they show up in the word diff — the annotation is part of what changed.</p>
    <h4>Finding things</h4>
    <p><kbd>⌘F</kbd> puts the cursor in the <b>filter</b> in the Composer's title bar. It matches
    block labels, variant and version names, the text of every version, group labels, arrangement
    names and word banks — by the name you write into a block or by any word the bank holds. The
    stack narrows as you type, chips narrow to the variants that matched, and the count reads
    “3 of 47”. It is a view and only a view: switching variants, muting blocks and saving a take
    while it is up all act on the whole project, and the Assembled pane always shows the whole
    prompt. <kbd>esc</kbd> in the field gives the stack back.</p>
    <h4>Dragging</h4>
    <p>Blocks are dragged by their number and groups by their header bar. A loose block and a whole
    group are the units of the stack, so a block hops over a group rather than landing inside it;
    a member is dragged within its own group and cannot leave it. Grouping stays something you say
    out loud, through the footer's picker or <kbd>g</kbd>. The ↑↓ buttons still do the same moves.</p>
    <p>Chips drag too: pick up a variant, a version or an arrangement and drop it wherever you want
    it in its row. A marker shows the gap it will land in, and rows that have wrapped onto two lines
    work the same way. The active chip is dragged by its edges or its little number — the middle of
    it is the name field, and a drag started there is you selecting text. Reordering changes only
    the order: every take, arrangement and dependency goes on pointing at exactly what it did.
    Null stays first, because it is not one of the ones you own.</p>
    <h4>Folding</h4>
    <p>A block folds down to its heading with <kbd>z</kbd>, or the <kbd>▾</kbd> in its header —
    the same gesture a group already had. What is left is one line: the variant the block is on,
    and the opening of what that variant actually says, so a folded stack reads as an outline
    rather than a list of labels. The line is the text that would <i>ship</i> — notes taken out,
    word banks filled in — and it follows the block, so cycling variants with <kbd>h</kbd> and
    <kbd>l</kbd> while it is folded shows you each one in turn without opening anything.</p>
    <p><kbd>⇧Z</kbd> folds the whole stack, and again to open it. Folding is only a view: it
    changes nothing about the prompt, and it is remembered with the project, so a stack you left
    folded opens folded. Anything that needs the editor — pressing
    <kbd>e</kbd>, adding a variant or a version — unfolds the block on its way rather than
    appearing to do nothing.</p>
    <h4>Dependencies</h4>
    <p>A block, a variant, a version or a group can say it only makes sense when something else is
    in a particular state — press <kbd>d</kbd>, or use <i>Depends…</i> in the footer. Pick what it
    depends on and which states of that thing will do; there is nothing else to choose, because a
    condition that fails does exactly one thing. It <b>holds the item off</b>: it stays exactly
    where it is, struck through, with its Null slot locked and the reason written on it, and it takes
    no part in the prompt. It is never taken out of the stack — a section you cannot see is a
    section you cannot switch back on, and the way back would be the very thing that vanished.</p>
    <p>Nothing is rewritten either: its slot, its variant and its version are all waiting where you
    left them, and they come straight back when the condition passes.</p>
    <p>A condition that names something you have since deleted is <b>thrown away</b>, at every level:
    the block or group it hangs off, and the variants, versions and arrangements it names inside
    that block. A rule whose subject is gone can never be met again, so leaving it in place would
    hold its dependent off for good behind a state nothing can reach. Nothing can be left stuck
    behind a controller that no longer exists.</p>
    <p>Conditions sit on top of everything else rather than inside it. An arrangement may still name
    a variant a condition is currently holding off, and a take may still restore one — the stored
    choice is kept as it was, and the moment the condition passes it is showing again. If the
    variant a block is set to is held off, the block falls back to the first one still available and
    says so, rather than silently emitting nothing.</p>
    <h4>Groups and arrangements</h4>
    <p>Blocks that belong together can be wired into a <b>group</b> — pick one from the block's
    footer, or press <kbd>g</kbd>. A group has its own Null slot, so its blocks drop out and come
    back as one, and its own variants, called <b>arrangements</b>: an arrangement remembers which members
    are on and which variant each of them is showing. So a group of three blocks can have a
    <i>house</i> arrangement and an <i>unsparing</i> one and you flip between whole passages of
    the prompt at a stroke.</p>
    <p>Arrangements stay live, the way block variants do: whatever the members are doing now <i>is</i>
    what the active arrangement means, so there is never a stale copy to update. A block added to
    the group appears in the arrangement you were on and starts off in the others — the same rule
    takes use.</p>
    <p>A group is one passage, so its blocks run together into a <b>single paragraph</b> in the
    assembled prompt instead of being held apart by a blank line. Hovering the group's header
    lights that whole paragraph; hovering one member lights just its share of it. With
    <i>Emit labels</i> on, the group writes one heading of its own over the paragraph rather than
    a heading per member, which would only split it up again.</p>
    <h4>What a take remembers</h4>
    <p>A take snapshots the whole rig: each block's variant <i>and</i> whether it was on, each
    group's arrangement <i>and</i> whether it was on. Anything the take never saw — a block or
    group made after it was saved — comes back <b>off</b>, because a snapshot cannot vouch for
    text it never approved. The one exception is a group wrapped around blocks an older take
    already had on: that group comes back on, so the take still shows what it always showed.</p>
    <h4>Keys — when you are not typing</h4>
    <table class="keytable">
      <tr><td><kbd>j</kbd> <kbd>k</kbd> / <kbd>↓</kbd> <kbd>↑</kbd></td><td>Move between blocks</td></tr>
      <tr><td><kbd>h</kbd> <kbd>l</kbd> / <kbd>←</kbd> <kbd>→</kbd></td><td>Cycle the focused block's variant</td></tr>
      <tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>Jump straight to a variant</td></tr>
      <tr><td><kbd>0</kbd></td><td>Null — show nothing from this block</td></tr>
      <tr><td><kbd>,</kbd> <kbd>.</kbd></td><td>Cycle the versions inside that variant</td></tr>
      <tr><td><kbd>space</kbd></td><td>Flip between Null and the last variant shown</td></tr>
      <tr><td><kbd>g</kbd> / <kbd>⇧G</kbd></td><td>Group this block · Null or restore its whole group</td></tr>
      <tr><td><kbd>[</kbd> <kbd>]</kbd></td><td>Cycle its group's arrangement</td></tr>
      <tr><td><kbd>e</kbd></td><td>Edit the active variant's text</td></tr>
      <tr><td><kbd>d</kbd></td><td>Conditions on this block, variant or version</td></tr>
      <tr><td><kbd>n</kbd> / <kbd>f</kbd></td><td>New empty variant / fork the current one</td></tr>
      <tr><td><kbd>m</kbd></td><td>Toggle Mixer view</td></tr>
      <tr><td><kbd>s</kbd></td><td>Snapshot this combination as a take</td></tr>
      <tr><td><kbd>c</kbd></td><td>Copy the assembled prompt</td></tr>
      <tr><td><kbd>z</kbd> / <kbd>⇧Z</kbd></td><td>Fold this block · fold or unfold the whole stack</td></tr>
      <tr><td><kbd>esc</kbd></td><td>Leave the text field</td></tr>
    </table>
    <h4>Anywhere</h4>
    <table class="keytable">
      <tr><td><kbd>⌘F</kbd></td><td>Filter the stack</td></tr>
      <tr><td><kbd>⌘⇧C</kbd></td><td>Copy the assembled prompt</td></tr>
      <tr><td><kbd>⌘⇧E</kbd></td><td>Export everything as JSON</td></tr>
    </table>
    <p class="hkeynote">Those three, and the Variations, Grok and Claude keys, are the only
    shortcuts held down with ⌘ that Variations listens to. Everything else is a bare key, so
    holding a modifier can never change your prompt by accident.</p>
    <h4>Two things worth knowing</h4>
    <p>Shift-click a chip (or use <i>Compare with…</i>) to word-diff it against the active variant —
    useful when two phrasings differ by a sentence.</p>
    ${isApp()
      ? '<p>Everything here saves itself into this library\'s metadata folder, at ' +
        '<code>' + esc(HOST.file) + '</code>, so it travels with the library. Import and Export ' +
        'move documents in and out of that file — an import merges in and is written straight ' +
        'back, an export drops a copy in your Downloads folder. Esc, ⇧⌘W or the Variations key ' +
        'closes it.</p>'
      : '<p>' + esc(HOST.note || "This library's folder could not be reached") + ', so for now ' +
        'everything is kept in this window\'s local storage. Export writes a JSON file you can keep.</p>'}`;
  $("#vxDlgFoot").innerHTML = "";
  $("#vxDlgFoot").append(el("button", { class: "btn primary", text: "Close", onclick: closeDialog }));
  showDialog();
}

