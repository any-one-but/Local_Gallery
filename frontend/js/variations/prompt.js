/* Variations: the assembled prompt
   What reaches the prompt and in what order, and the word diff. */

// -- imports (generated) --
import { esc } from "./dom.js";
import { bankSegments, blockIncluded, effectiveText, groupIncluded, project, stackUnits, stripNotes } from "./store.js";
// -- end imports --

/* ============================================================
   2. Assembling the prompt
   ============================================================ */

/* What separates two members of the same group. A group is one passage, so its
   blocks run together into a single paragraph instead of being held apart by a
   blank line the way loose blocks are. */
export const GROUP_JOIN = " ";

/* A part carries both forms of its text: `raw` is what is written in the
   editor, `segs` is the same thing with the word banks resolved, split so the
   output pane can mark which runs came from a bank. `text` is the resolved
   string, and it is what assemble() and every count use — so the banks are
   applied in exactly one place and the pane cannot disagree with the clipboard. */
export function blockPart(b) {
  /* Notes come out before the banks go in: a bank named inside a note must not
     be substituted, because the note is not going anywhere. */
  const raw = stripNotes(effectiveText(b)).trim();
  const segs = bankSegments(raw);
  return {
    blockId: b.id, label: b.label,
    raw, segs,
    text: segs.map((s) => s.text).join(""),
  };
}

/* The prompt as a list of paragraphs. A loose block is its own paragraph; a
   group is one paragraph made of all its included members. Both the assembled
   text and the output pane are built from this, so what you read and what you
   copy can never disagree. */
export function promptUnits() {
  const p = project();
  const out = [];
  stackUnits(p).forEach((u) => {
    if (u.kind === "group") {
      if (!groupIncluded(u.group)) return;
      const parts = u.blocks.filter(blockIncluded).map(blockPart).filter((x) => x.text);
      if (!parts.length) return;
      /* With labels on, the group speaks for its members: one heading over the
         paragraph, rather than per-member headings that would split it again. */
      out.push({
        kind: "group", id: u.group.id, label: u.group.label,
        heading: p.includeLabels ? "## " + u.group.label : "", parts,
      });
      return;
    }
    const b = u.block;
    if (!blockIncluded(b)) return;
    const part = blockPart(b);
    const heading = p.includeLabels ? "## " + b.label : "";
    if (!part.text && !heading) return;
    out.push({ kind: "block", id: b.id, label: b.label, heading, parts: [part] });
  });
  return out;
}

export function assemble() {
  return promptUnits()
    .map((u) => (u.heading ? u.heading + "\n" : "") + u.parts.map((x) => x.text).join(GROUP_JOIN))
    .join("\n\n");
}

export const countWords = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/* ============================================================
   3. Word-level diff (LCS) — for comparing two phrasings
   ============================================================ */

export const MAX_DIFF_TOKENS = 900;

export function tokenize(s) { return s.match(/\s+|[^\s]+/g) || []; }

export function diffTokens(aTokens, bTokens) {
  const n = aTokens.length, m = bTokens.length;
  // Trim the shared head and tail first; most edits are local.
  let head = 0;
  while (head < n && head < m && aTokens[head] === bTokens[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head &&
         aTokens[n - 1 - tail] === bTokens[m - 1 - tail]) tail++;

  const a = aTokens.slice(head, n - tail);
  const b = bTokens.slice(head, m - tail);
  const out = [];
  for (let i = 0; i < head; i++) out.push({ op: "=", t: aTokens[i] });

  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) {
    if (a.length) out.push({ op: "-", t: a.join("") });
    if (b.length) out.push({ op: "+", t: b.join("") });
  } else {
    const dp = [];
    for (let i = 0; i <= a.length; i++) dp.push(new Int32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push({ op: "=", t: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: "-", t: a[i] }); i++; }
      else { out.push({ op: "+", t: b[j] }); j++; }
    }
    while (i < a.length) { out.push({ op: "-", t: a[i] }); i++; }
    while (j < b.length) { out.push({ op: "+", t: b[j] }); j++; }
  }

  for (let k = m - tail; k < m; k++) out.push({ op: "=", t: bTokens[k] });
  return out;
}

export function renderDiffHtml(oldText, newText) {
  const parts = diffTokens(tokenize(oldText), tokenize(newText));
  let html = "", run = null, buf = "";
  const flush = () => {
    if (!buf) return;
    const e = esc(buf);
    html += run === "+" ? "<ins>" + e + "</ins>" : run === "-" ? "<del>" + e + "</del>" : e;
    buf = "";
  };
  for (const part of parts) {
    if (part.op !== run) { flush(); run = part.op; }
    buf += part.t;
  }
  flush();
  return html;
}

