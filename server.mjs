// versepack demo — a cowyo-class capture door over an on-disk pack.
// The pack directory (./pack) is the source of truth; this server is just a door.
import http from "node:http";
import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tryParseAnyPassage,
  formatPassageForDisplay,
  getBookOrder,
} from "grab-bcv";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.join(ROOT, "pack");
const NOTES_DIR = path.join(PACK_DIR, "notes");
const TEXT_DIR = path.join(PACK_DIR, "text", "bsb");
const PORT = Number(process.env.PORT || 4180);

// ---------- pack (storage) ----------

async function ensurePack() {
  await mkdir(NOTES_DIR, { recursive: true });
  await mkdir(TEXT_DIR, { recursive: true });
  const protocolPath = path.join(PACK_DIR, "protocol.json");
  try {
    await readFile(protocolPath);
  } catch {
    await writeFile(
      protocolPath,
      JSON.stringify({ protocol: "versepack", version: "0.1-demo" }, null, 2) + "\n",
    );
  }
}

function notePath(slug) {
  return path.join(NOTES_DIR, `${slug}.json`);
}

async function readNote(slug) {
  try {
    return hydrate(JSON.parse(await readFile(notePath(slug), "utf8")));
  } catch {
    return null;
  }
}

async function writeNote(note) {
  await writeFile(notePath(note.scope.slug), JSON.stringify(note, null, 2) + "\n");
}

async function listNotes() {
  let files;
  try {
    files = await readdir(NOTES_DIR);
  } catch {
    return [];
  }
  const notes = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      notes.push(hydrate(JSON.parse(await readFile(path.join(NOTES_DIR, f), "utf8"))));
    } catch {
      // skip unreadable entries; the pack stays best-effort readable
    }
  }
  notes.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return notes;
}

// ---------- blocks (each note is a miniature outline) ----------
// A note's content is a flat list of line-blocks in document order:
//   { id, indent, text }
// The tree is a projection of `indent` (2 spaces per level in text form),
// dotflowy-style: flat rows are canonical, the outline is derived. Stable
// block ids survive edits (LCS line matching for text/curl; the outliner UI
// sends ids directly). A block written on a verse today can be referenced,
// merged, or transcluded by a broader note later without losing its identity.

const newBlockId = () =>
  `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function linesOf(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((line) => {
    const m = line.match(/^( *)(.*)$/);
    return { indent: Math.floor(m[1].length / 2), text: m[2] };
  });
}

const serializeBlocks = (blocks) =>
  (blocks || []).map((b) => "  ".repeat(b.indent) + b.text).join("\n");

// Longest-common-subsequence on line text: lines that survive an edit keep
// their block id. Re-indenting a line keeps its identity (text-only match).
function lcsIds(prev, next) {
  const n = prev.length, m = next.length;
  const ids = new Array(m).fill(null);
  if (!n || !m) return ids;
  if (n * m > 400_000) {
    for (let i = 0; i < Math.min(n, m); i++) ids[i] = prev[i].id;
    return ids;
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = prev[i].text === next[j].text
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (prev[i].text === next[j].text) { ids[j] = prev[i].id; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return ids;
}

// Blank bullets are real outline rows (structure / pause). A note is "empty"
// only when every block has no text — then the address is cleared.
function hasContent(blocks) {
  return (blocks || []).some((b) => String(b.text || "").trim().length > 0);
}

function reconcileBlocks(text, prev = []) {
  const next = linesOf(text);
  const ids = lcsIds(prev, next);
  return next.map((l, i) => ({ id: ids[i] || newBlockId(), indent: l.indent, text: l.text }));
}

// Accept client-authored blocks (outliner UI). Preserve ids when unique.
// Empty text is kept — blank bullets are first-class.
function normalizeBlocks(raw) {
  const used = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const text = String(item?.text ?? "").replace(/\r?\n/g, " ");
    let indent = Math.max(0, Math.min(32, Number(item?.indent) || 0));
    if (out.length) indent = Math.min(indent, out[out.length - 1].indent + 1);
    else indent = 0;
    let id = typeof item?.id === "string" && /^[\w.-]+$/.test(item.id) ? item.id : null;
    if (!id || used.has(id)) id = newBlockId();
    used.add(id);
    out.push({ id, indent, text });
  }
  return out;
}

function blocksAreEmpty(blocks) {
  return !hasContent(blocks);
}

// Legacy demo notes stored one flat `body` string; hydrate them into blocks
// with deterministic ids so repeated reads agree until the next save persists.
function hydrate(note) {
  if (note && !Array.isArray(note.blocks)) {
    note.blocks = linesOf(typeof note.body === "string" ? note.body : "")
      .map((l, i) => ({ id: `${note.id}_l${i}`, indent: l.indent, text: l.text }));
    delete note.body;
  }
  return note;
}

// ---------- addressing (OSIS spine via grab-bcv) ----------

function parseScope(input) {
  const result = tryParseAnyPassage(input);
  if (!result?.ok) return null;
  const parsed = result.value;
  const slug = parsed.canonical.toLowerCase();
  let kind = "range";
  if (parsed.rangeType === "chapter") kind = "chapter";
  else if (
    parsed.start.book === parsed.end.book &&
    parsed.start.chapter === parsed.end.chapter &&
    parsed.start.verse != null &&
    parsed.start.verse === parsed.end.verse
  ) {
    kind = "verse";
  }
  return { kind, osis: parsed.canonical, slug, parsed };
}

// ---------- containment (canonical scripture geometry) ----------
// A scope is an interval on the book's (chapter, verse) line. Chapter scopes
// span the whole chapter. This is how independent notes find each other:
// scripture containment is computed, never stored.

const pos = (chapter, verse) => chapter * 1000 + verse;

function scopeInterval(parsed) {
  return {
    book: parsed.start.book,
    s: pos(parsed.start.chapter, parsed.start.verse ?? 1),
    e: pos(parsed.end.chapter, parsed.end.verse ?? 999),
  };
}

function relateScopes(a, b) {
  if (a.book !== b.book || a.e < b.s || b.e < a.s) return null;
  if (a.s === b.s && a.e === b.e) return "same";
  if (a.s <= b.s && b.e <= a.e) return "contains";
  if (b.s <= a.s && a.e <= b.e) return "within";
  return "overlaps";
}

// Every other note in the pack, classified relative to this scope.
async function relatedNotes(scope) {
  const a = scopeInterval(scope.parsed);
  const rel = { contains: [], within: [], overlaps: [] };
  for (const note of await listNotes()) {
    if (note.scope.slug === scope.slug) continue;
    const other = parseScope(note.scope.osis);
    if (!other) continue;
    const r = relateScopes(a, scopeInterval(other.parsed));
    if (r && r !== "same") rel[r].push({ note, scope: other });
  }
  const start = (entry) => scopeInterval(entry.scope.parsed).s;
  rel.contains.sort((x, y) => start(x) - start(y));
  rel.overlaps.sort((x, y) => start(x) - start(y));
  return rel;
}

// ---------- scripture text (BSB, cache-first) ----------
// Chapter text is derived data: fetched once from bolls.life (public-domain
// BSB), then cached in the pack at pack/text/bsb/<book>.<chapter>.json so the
// pack reads offline. Never treated as user data.

function textPath(book, chapter) {
  return path.join(TEXT_DIR, `${book.toLowerCase()}.${chapter}.json`);
}

async function getChapterText(book, chapter) {
  try {
    return JSON.parse(await readFile(textPath(book, chapter), "utf8"));
  } catch {
    // not cached yet
  }
  const bollsId = getBookOrder(book) + 1; // grab-bcv is 0-based; bolls is 1-based
  const res = await fetch(`https://bolls.life/get-text/BSB/${bollsId}/${chapter}/`);
  if (!res.ok) throw new Error(`BSB fetch failed: ${res.status}`);
  const raw = await res.json();
  const doc = {
    translation: "BSB",
    book,
    chapter,
    verses: raw.map((v) => ({ v: v.verse, text: String(v.text).replace(/<[^>]+>/g, "").trim() })),
    fetched_at: new Date().toISOString(),
  };
  await writeFile(textPath(book, chapter), JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

// ---------- html ----------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    max-width: 38rem; margin: 0 auto; padding: 1.5rem 1.1rem 5rem;
    line-height: 1.55; font-size: 1.05rem;
  }
  a { color: inherit; }
  code, kbd, .ui { font-family: -apple-system, system-ui, sans-serif; }
  input[type=text] {
    width: 100%; font: inherit; font-size: 1rem; padding: .55rem .7rem;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: .4rem; background: transparent;
  }
  input:focus, .outliner:focus-within { outline: none;
    border-color: color-mix(in srgb, currentColor 45%, transparent); }
  .muted { color: color-mix(in srgb, currentColor 48%, transparent); font-size: .88rem; }
  .ui { font-family: -apple-system, system-ui, sans-serif; font-size: .88rem; }
  header { display: flex; align-items: baseline; gap: .55rem; flex-wrap: wrap; margin-bottom: 1rem; }
  header h1 { font-size: 1.2rem; font-weight: 600; margin: 0; letter-spacing: -.01em; }
  #status { margin-left: auto; font-size: .8rem; color: color-mix(in srgb, currentColor 45%, transparent); }
  h2 { font-size: .9rem; font-weight: 600; margin: 1.75rem 0 .4rem;
       font-family: -apple-system, system-ui, sans-serif; }
  .note-row {
    display: block; padding: .55rem 0; text-decoration: none;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  }
  .note-row:hover { opacity: .85; }
  .ref { font-weight: 600; margin-right: .4rem; }
  kbd {
    font-family: inherit; font-size: .8em; padding: .05rem .3rem;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: .25rem;
  }

  /* reading: scripture primary; notes hide until the verse is opened */
  .verse {
    position: relative;
    padding: .28rem 0 .28rem 0.9rem;
    margin-left: -0.9rem;
    cursor: pointer;
  }
  .verse.hl .vtext { background: color-mix(in srgb, currentColor 6%, transparent);
    margin: 0 -.35rem; padding: 0 .35rem; border-radius: .25rem; }
  /* has-notes mark lives in the left gutter — outside the verse number */
  .verse.has-notes:not(.notes-open):not(.editing)::before {
    content: "";
    position: absolute;
    left: 0.15rem;
    top: calc(0.28rem + 0.55em - 2.5px);
    width: 5px; height: 5px;
    border-radius: 50%;
    background: color-mix(in srgb, currentColor 32%, transparent);
    pointer-events: none;
  }
  .vtext { margin: 0; }
  .vtext sup {
    font-family: -apple-system, system-ui, sans-serif; font-size: .68em;
    font-weight: 500; color: color-mix(in srgb, currentColor 40%, transparent);
    margin-right: .35rem; user-select: none;
  }
  .vstatus { font-family: -apple-system, system-ui, sans-serif; font-size: .72rem;
    color: color-mix(in srgb, currentColor 40%, transparent); margin-left: .35rem; }
  .vnotes {
    display: none;
    margin: .2rem 0 .4rem 1.35rem;
  }
  .verse.notes-open .vnotes,
  .verse.editing .vnotes { display: block; }

  /* plain note block in reader (no per-note collapse) */
  .note {
    font-family: -apple-system, system-ui, sans-serif; font-size: .9rem;
    margin: .35rem 0 .5rem;
    color: color-mix(in srgb, currentColor 78%, transparent);
  }
  .note-label {
    font-size: .78rem; font-weight: 500; letter-spacing: .01em;
    color: color-mix(in srgb, currentColor 45%, transparent);
    margin: 0 0 .2rem;
  }
  .note-meta { margin: .2rem 0 0; font-size: .8rem;
    color: color-mix(in srgb, currentColor 45%, transparent); }
  .note-meta a { text-decoration: underline; text-underline-offset: 2px; }
  .note-edit { margin: .1rem 0; }
  .note.editing .note-body,
  .note.editing .note-label { display: none; }
  .note .note-body { cursor: text; }
  .note .note-label { cursor: text; }

  /* passage notes vs this-verse note under a verse */
  .note-group { margin: 0; }
  .note-group + .note-group {
    margin-top: .55rem;
    padding-top: .55rem;
    border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
  .note-group-title {
    font-family: -apple-system, system-ui, sans-serif;
    font-size: .72rem;
    font-weight: 500;
    letter-spacing: .02em;
    color: color-mix(in srgb, currentColor 42%, transparent);
    margin: 0 0 .3rem;
  }
  .note-group .note { margin: .25rem 0 .4rem; }
  .note-group .note:last-child { margin-bottom: 0; }

  /* chapter note sits above scripture — outline only, no redundant label/link */
  .chapter-note {
    margin: 0 0 1.1rem;
    padding: 0 0 1rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  }
  .chapter-note .note { margin: 0; }
  /* inbox: contained / related notes as openable items, not inline outlines */
  .inbox {
    display: flex; flex-direction: column; gap: .4rem;
    margin: .4rem 0 0;
  }
  .inbox-item {
    display: block; text-decoration: none; color: inherit;
    padding: .65rem .75rem;
    border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    border-radius: .5rem;
    background: color-mix(in srgb, currentColor 3%, transparent);
    transition: background .12s ease, border-color .12s ease;
  }
  .inbox-item:hover {
    background: color-mix(in srgb, currentColor 6%, transparent);
    border-color: color-mix(in srgb, currentColor 22%, transparent);
  }
  .inbox-top {
    display: flex; align-items: baseline; gap: .45rem; flex-wrap: wrap;
  }
  .inbox-title { font-weight: 600; font-size: .95rem; letter-spacing: -.01em; }
  .inbox-kind {
    font-family: -apple-system, system-ui, sans-serif;
    font-size: .65rem; font-weight: 500; letter-spacing: .04em;
    text-transform: uppercase;
    color: color-mix(in srgb, currentColor 42%, transparent);
  }
  .inbox-excerpt {
    margin: .2rem 0 0;
    font-size: .88rem;
    color: color-mix(in srgb, currentColor 52%, transparent);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /*
   * One indent geometry everywhere (read outline + edit outliner):
   *   row starts at depth * gutter; bullet is a fixed gutter-wide column; text follows.
   */
  .outline, .outliner {
    --note-gutter: 1.25rem;
    --bullet: 0.4375rem;
    --row-h: 1.55em;
  }
  .outline { margin: 0; padding: 0; display: block; }
  .oline {
    display: grid;
    grid-template-columns: var(--note-gutter) minmax(0, 1fr);
    align-items: start;
    box-sizing: border-box;
    width: 100%;
    min-height: var(--row-h);
    padding: 0;
    margin: 0 0 0 calc(var(--depth, 0) * var(--note-gutter));
    line-height: 1.45;
  }
  .oline .odot {
    box-sizing: border-box;
    width: var(--note-gutter); height: var(--row-h);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .oline .odot::before {
    content: "";
    width: var(--bullet); height: var(--bullet);
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 28%, transparent);
  }
  .oline .otxt {
    display: block;
    min-height: var(--row-h);
    padding: 0.15em 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* blank rows keep a full row so the next depth never sits beside them */
  .oline.blank {
    height: var(--row-h);
    min-height: var(--row-h);
  }
  .oline.blank .otxt {
    height: var(--row-h);
    min-height: var(--row-h);
    padding: 0;
    overflow: hidden;
  }
  .oline.blank .otxt::after { content: "\\00a0"; }

  /* outliner — same grid + depth step as .outline */
  .outliner { padding: .1rem 0; }
  .outliner.page { min-height: 40vh; }
  .oblock {
    display: grid;
    grid-template-columns: var(--note-gutter) minmax(0, 1fr);
    align-items: start;
    min-height: var(--row-h);
    padding: 0.05rem 0;
    margin-left: calc(var(--depth, 0) * var(--note-gutter));
  }
  .obullet {
    width: var(--note-gutter); height: var(--row-h);
    display: flex; align-items: center; justify-content: center;
    user-select: none;
  }
  .obullet::before {
    content: "";
    width: var(--bullet); height: var(--bullet);
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 28%, transparent);
  }
  .otext {
    min-width: 0; min-height: var(--row-h); padding: 0; outline: none;
    white-space: pre-wrap; word-break: break-word; font: inherit;
    line-height: var(--row-h);
  }
  .otext:empty::before { content: attr(data-placeholder); opacity: .35; pointer-events: none; }
  .outliner.compact { font-size: .9rem; }
  .hint { margin-top: .65rem; }
`;

// Shared client outliner — sibling/nested rows, no indent syntax to learn.
// Enter = sibling (or split), Tab/Shift-Tab = nest/unnest, Backspace on empty = delete.
const OUTLINER_JS = `
function newId() {
  return "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function mountOutliner(host, opts) {
  const slug = opts.slug;
  const statusEl = opts.statusEl || null;
  const compact = !!opts.compact;
  const placeholder = opts.placeholder || "Write\\u2026";
  // blank bullets are first-class; seed one empty row only when the note is new
  let blocks = (opts.blocks && opts.blocks.length)
    ? opts.blocks.map(b => ({ id: b.id || newId(), indent: b.indent|0, text: b.text || "" }))
    : [{ id: newId(), indent: 0, text: "" }];
  let timer = null;
  let inflight = null;
  let dirty = false;

  host.classList.add("outliner");
  if (compact) host.classList.add("compact");
  if (opts.page) host.classList.add("page");
  host.dataset.slug = slug;

  function setStatus(s) { if (statusEl) statusEl.textContent = s; }

  function subtreeEnd(i) {
    const base = blocks[i].indent;
    let j = i + 1;
    while (j < blocks.length && blocks[j].indent > base) j++;
    return j;
  }

  function render(focusId, caret) {
    host.innerHTML = "";
    const fresh = blocks.length === 1 && !blocks[0].text.trim();
    for (const b of blocks) {
      const row = document.createElement("div");
      row.className = "oblock";
      row.dataset.id = b.id;
      row.style.setProperty("--depth", String(Math.max(0, b.indent|0)));

      const bullet = document.createElement("span");
      bullet.className = "obullet";
      bullet.title = "Tab nest \\u00b7 Shift-Tab unnest";

      const text = document.createElement("div");
      text.className = "otext";
      text.contentEditable = "true";
      text.spellcheck = true;
      // placeholder only on a brand-new empty note — blank bullets stay silent
      if (fresh) text.dataset.placeholder = placeholder;
      text.textContent = b.text;

      row.appendChild(bullet);
      row.appendChild(text);
      host.appendChild(row);
    }
    if (focusId) {
      const el = host.querySelector('.oblock[data-id="' + CSS.escape(focusId) + '"] .otext');
      if (el) {
        el.focus();
        placeCaret(el, caret == null ? endOf(el) : caret);
      }
    }
  }

  function endOf(el) {
    const len = (el.textContent || "").length;
    return len;
  }

  function placeCaret(el, offset) {
    const range = document.createRange();
    const sel = window.getSelection();
    const node = el.firstChild;
    if (!node) {
      range.selectNodeContents(el);
      range.collapse(true);
    } else {
      const o = Math.max(0, Math.min(offset, node.textContent.length));
      range.setStart(node, o);
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function caretOffset(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return (el.textContent || "").length;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return (el.textContent || "").length;
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  function syncFromDom() {
    const rows = [...host.querySelectorAll(".oblock")];
    for (const row of rows) {
      const b = blocks.find(x => x.id === row.dataset.id);
      if (b) b.text = row.querySelector(".otext").textContent.replace(/\\u00a0/g, " ");
    }
  }

  function scheduleSave() {
    dirty = true;
    setStatus("\\u2026");
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  }

  async function save() {
    syncFromDom();
    // keep blank bullets; server clears the address only if nothing has text
    const payload = {
      blocks: blocks.map(b => ({ id: b.id, indent: b.indent, text: b.text })),
    };
    if (inflight) await inflight;
    inflight = fetch("/api/note/" + slug, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        if (!r.ok) { setStatus("error"); return; }
        const data = await r.json().catch(() => null);
        if (data && data.deleted) setStatus("cleared");
        else setStatus("saved");
        dirty = false;
      })
      .catch(() => setStatus("offline"))
      .finally(() => { inflight = null; });
    return inflight;
  }

  function indexOfRow(row) {
    return blocks.findIndex(b => b.id === row.dataset.id);
  }

  function indentBlock(i, delta) {
    if (delta > 0) {
      if (i === 0) return false;
      const max = blocks[i - 1].indent + 1;
      if (blocks[i].indent >= max) return false;
    } else {
      if (blocks[i].indent <= 0) return false;
    }
    const base = blocks[i].indent;
    const end = subtreeEnd(i);
    for (let j = i; j < end; j++) blocks[j].indent += delta;
    return true;
  }

  host.addEventListener("input", (e) => {
    if (!e.target.classList.contains("otext")) return;
    const row = e.target.closest(".oblock");
    const b = blocks.find(x => x.id === row.dataset.id);
    if (b) b.text = e.target.textContent.replace(/\\u00a0/g, " ");
    scheduleSave();
  });

  host.addEventListener("keydown", (e) => {
    const textEl = e.target.closest(".otext");
    if (!textEl) return;
    const row = textEl.closest(".oblock");
    const i = indexOfRow(row);
    if (i < 0) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      syncFromDom();
      const off = caretOffset(textEl);
      const cur = blocks[i];
      const left = cur.text.slice(0, off);
      const right = cur.text.slice(off);
      cur.text = left;
      // new sibling after this item's whole subtree (blank bullets allowed)
      const nb = { id: newId(), indent: cur.indent, text: right };
      blocks.splice(subtreeEnd(i), 0, nb);
      render(nb.id, 0);
      scheduleSave();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      syncFromDom();
      if (indentBlock(i, e.shiftKey ? -1 : 1)) {
        render(blocks[i].id, caretOffset(textEl));
        scheduleSave();
      }
      return;
    }

    if (e.key === "Backspace") {
      const off = caretOffset(textEl);
      const t = textEl.textContent || "";
      if (off === 0 && i > 0) {
        e.preventDefault();
        syncFromDom();
        // if has children and empty, outdent first / delete and reparent
        if (!blocks[i].text) {
          const end = subtreeEnd(i);
          if (end > i + 1) {
            // has children: outdent them into place, remove empty
            for (let j = i + 1; j < end; j++) blocks[j].indent = Math.max(0, blocks[j].indent - 1);
          }
          const prev = blocks[i - 1];
          const caret = prev.text.length;
          blocks.splice(i, 1);
          if (!blocks.length) blocks.push({ id: newId(), indent: 0, text: "" });
          render(prev.id, caret);
          scheduleSave();
          return;
        }
        // merge into previous; children keep their indents (still under nearer ancestor)
        const prev = blocks[i - 1];
        const caret = prev.text.length;
        prev.text += blocks[i].text;
        blocks.splice(i, 1);
        render(prev.id, caret);
        scheduleSave();
        return;
      }
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const off = caretOffset(textEl);
      // only move between blocks when at edge or no soft wrap concern — always allow with meta? simple: always on arrow at line level
      const atStart = off === 0;
      const atEnd = off === (textEl.textContent || "").length;
      if (e.key === "ArrowUp" && atStart && i > 0) {
        e.preventDefault();
        syncFromDom();
        render(blocks[i - 1].id, endOf({ textContent: blocks[i - 1].text }));
      } else if (e.key === "ArrowDown" && atEnd && i < blocks.length - 1) {
        e.preventDefault();
        syncFromDom();
        render(blocks[i + 1].id, 0);
      }
    }
  });

  host.addEventListener("paste", (e) => {
    const textEl = e.target.closest(".otext");
    if (!textEl) return;
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData("text") || "";
    const lines = paste.replace(/\\r\\n/g, "\\n").split("\\n");
    syncFromDom();
    const i = indexOfRow(textEl.closest(".oblock"));
    const off = caretOffset(textEl);
    const cur = blocks[i];
    if (lines.length === 1) {
      cur.text = cur.text.slice(0, off) + lines[0] + cur.text.slice(off);
      render(cur.id, off + lines[0].length);
      scheduleSave();
      return;
    }
    const before = cur.text.slice(0, off);
    const after = cur.text.slice(off);
    cur.text = before + lines[0];
    const created = [];
    for (let k = 1; k < lines.length; k++) {
      const isLast = k === lines.length - 1;
      const nb = { id: newId(), indent: cur.indent, text: lines[k] + (isLast ? after : "") };
      created.push(nb);
    }
    blocks.splice(i + 1, 0, ...created);
    const last = created[created.length - 1] || cur;
    render(last.id, lines[lines.length - 1].length);
    scheduleSave();
  });

  // prevent rich formatting shortcuts from injecting html
  host.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "i" || e.key === "u")) e.preventDefault();
  });

  render(opts.autofocus ? blocks[0].id : null, opts.autofocus ? endOf({ textContent: blocks[0].text }) : null);
  if (opts.autofocus) {
    // focus last block end for editor pages with content
    const last = blocks[blocks.length - 1];
    render(last.id, endOf({ textContent: last.text }));
  }

  return {
    focus() {
      const last = blocks[blocks.length - 1];
      render(last.id, endOf({ textContent: last.text }));
    },
    isEmpty() {
      syncFromDom();
      return blocks.every(b => !b.text.trim());
    },
    getBlocks() {
      syncFromDom();
      return blocks.map(b => ({ id: b.id, indent: b.indent, text: b.text }));
    },
    async flush() {
      clearTimeout(timer);
      if (dirty) await save();
      else if (inflight) await inflight;
    },
    destroy() {
      clearTimeout(timer);
      host.innerHTML = "";
      host.classList.remove("outliner", "compact", "page");
    },
  };
}
`;

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function excerpt(note) {
  const line = (note.blocks || []).find((b) => b.text.trim())?.text || "";
  return line.length > 90 ? line.slice(0, 90) + "…" : line;
}

// Read-only outline — same depth grid as the outliner (margin-left: depth * gutter).
function renderOutline(blocks) {
  const items = blocks || [];
  if (!items.length) return "";
  return `<div class="outline">${items.map((b) => {
    const depth = Math.max(0, Number(b.indent) || 0);
    const empty = !String(b.text || "").trim();
    return `<div class="oline${empty ? " blank" : ""}" style="--depth:${depth}" title="${esc(b.id)}">
      <span class="odot" aria-hidden="true"></span>
      <span class="otxt">${esc(b.text || "")}</span>
    </div>`;
  }).join("")}</div>`;
}

// Editor page: related notes as inbox items (open the note — don't embed it).
function inboxItem({ scope, note }) {
  const display = formatPassageForDisplay(scope.parsed);
  const line = excerpt(note);
  return `<a class="inbox-item" href="/note/${esc(scope.slug)}">
    <div class="inbox-top">
      <span class="inbox-title">${esc(display)}</span>
      <span class="inbox-kind">${esc(scope.kind)}</span>
    </div>
    <div class="inbox-excerpt">${esc(line) || "empty"}</div>
  </a>`;
}

function inboxList(entries) {
  if (!entries?.length) return "";
  return `<div class="inbox">${entries.map((e) => inboxItem(e)).join("\n")}</div>`;
}

// Reader: plain outline; click body to edit inline (any scope). Show/hide is verse-level.
// label: false for the page chapter note (title already names the passage).
function readerNoteHtml({ scope, note, label = true }) {
  const display = formatPassageForDisplay(scope.parsed);
  const blocks = note?.blocks || [];
  const has = blocks.some((b) => b.text.trim()) || blocks.length > 0;
  if (!has && scope.kind !== "verse") return "";
  const showLabel = label && scope.kind !== "verse";
  return `<div class="note" data-kind="${esc(scope.kind)}" data-slug="${esc(scope.slug)}">
    ${showLabel ? `<div class="note-label">${esc(display)}</div>` : ""}
    <div class="note-body">${blocks.length ? renderOutline(blocks) : ""}</div>
    <div class="note-edit" hidden></div>
  </div>`;
}

function relTime(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function blocksJson(blocks) {
  // safe embed for script: JSON is UTF-8 safe inside <script type=application/json>
  return JSON.stringify(blocks || []);
}

async function renderIndex() {
  const notes = await listNotes();
  const rows = notes
    .map((n) => {
      const scope = parseScope(n.scope.osis);
      const display = scope ? formatPassageForDisplay(scope.parsed) : n.scope.osis;
      return `<a class="note-row" href="/note/${esc(n.scope.slug)}">
        <span class="ref">${esc(display)}</span>
        <span class="muted" style="float:right">${esc(relTime(n.updated_at))}</span>
        <div class="muted">${esc(excerpt(n)) || "empty"}</div></a>`;
    })
    .join("\n");
  return page(
    "versepack",
    `<header><h1>versepack</h1></header>
    <form action="/go" method="get">
      <input class="ui" type="text" name="q" placeholder="John 3:16" autofocus autocomplete="off">
    </form>
    <p class="muted ui" style="margin-top:.75rem">${notes.length} note${notes.length === 1 ? "" : "s"}</p>
    ${rows || `<p class="muted">Type a passage above.</p>`}`,
  );
}

function renderEditor(scope, note, rel) {
  const display = formatPassageForDisplay(scope.parsed);
  const sections = [];
  if (rel.contains.length) {
    sections.push(`<h2 class="ui">Within ${esc(display)}</h2>${inboxList(rel.contains)}`);
  }
  if (rel.within.length) {
    sections.push(`<h2 class="ui">Part of</h2>${inboxList(rel.within)}`);
  }
  if (rel.overlaps.length) {
    sections.push(`<h2 class="ui">Overlaps</h2>${inboxList(rel.overlaps)}`);
  }
  const initial = note?.blocks?.length ? note.blocks : [{ id: "b_new", indent: 0, text: "" }];
  return page(
    display,
    `<header class="ui">
      <a href="/" class="muted">&larr;</a>
      <h1>${esc(display)}</h1>
      <a class="muted" href="/read/${esc(scope.slug)}">read</a>
      <span id="status"></span>
    </header>
    <div id="editor"></div>
    <p class="muted ui hint"><kbd>Enter</kbd> <kbd>Tab</kbd> <kbd>Shift</kbd>+<kbd>Tab</kbd></p>
    ${sections.join("\n")}
    <script type="application/json" id="initial-blocks">${blocksJson(initial)}</script>
    <script>
      ${OUTLINER_JS}
      const blocks = JSON.parse(document.getElementById("initial-blocks").textContent);
      mountOutliner(document.getElementById("editor"), {
        slug: ${JSON.stringify(scope.slug)},
        blocks,
        statusEl: document.getElementById("status"),
        autofocus: true,
        page: true,
        placeholder: "Write\\u2026",
      });
    </script>`,
  );
}

// ---------- reading view ----------
// Scripture first. Click a verse → show/hide all of its notes (all or none).
// Click a visible verse-note outline → edit. No per-note chevrons.

async function renderRead(scope) {
  const { book, chapter } = { book: scope.parsed.start.book, chapter: scope.parsed.start.chapter };
  let text;
  try {
    text = await getChapterText(book, chapter);
  } catch (err) {
    return page("versepack", `<p>Could not fetch text (${esc(err?.message || err)}).
      <a href="/note/${esc(scope.slug)}">Open note editor</a>.</p>`);
  }
  const chapterScope = parseScope(`${book}.${chapter}`);
  const display = formatPassageForDisplay(chapterScope.parsed);
  const hl = scope.kind === "chapter" ? null : scopeInterval(scope.parsed);

  const verseNotes = new Map();
  const rangeNotes = new Map();
  let chapterNote = null;
  for (const note of await listNotes()) {
    const other = parseScope(note.scope.osis);
    if (!other) continue;
    if (other.parsed.start.book !== book) continue;
    if (other.parsed.start.chapter !== chapter || other.parsed.end.chapter !== chapter) continue;
    if (other.kind === "chapter") chapterNote = note;
    else if (other.kind === "verse") verseNotes.set(other.parsed.start.verse, note);
    else {
      const list = rangeNotes.get(other.parsed.start.verse) || [];
      list.push({ note, scope: other });
      rangeNotes.set(other.parsed.start.verse, list);
    }
  }

  const seed = {};
  if (chapterNote?.blocks) seed[chapterScope.slug] = chapterNote.blocks;
  const rows = text.verses
    .map(({ v, text: t }) => {
      const note = verseNotes.get(v);
      const ranges = rangeNotes.get(v) || [];
      const inHl = hl && pos(chapter, v) >= hl.s && pos(chapter, v) <= hl.e;
      const slug = `${book.toLowerCase()}.${chapter}.${v}`;
      if (note?.blocks) seed[slug] = note.blocks;
      for (const e of ranges) seed[e.scope.slug] = e.note.blocks || [];
      const vScope = parseScope(slug);
      const hasVerse = !!(note?.blocks?.some((b) => b.text.trim()));
      const hasNotes = hasVerse || ranges.length > 0;
      const rangeHtml = ranges
        .map((e) => readerNoteHtml({ scope: e.scope, note: e.note }))
        .join("\n");
      const verseHtml = hasVerse
        ? readerNoteHtml({ scope: vScope, note })
        : "";
      // separate passage-scope notes from this-verse notes when both appear
      let notesInner = "";
      if (rangeHtml) {
        notesInner += `<div class="note-group passage">${rangeHtml}</div>`;
      }
      if (verseHtml) {
        notesInner += `<div class="note-group verse-local">
          ${ranges.length ? `<div class="note-group-title">This verse</div>` : ""}
          ${verseHtml}
        </div>`;
      }
      return `<div class="verse${inHl ? " hl" : ""}${hasNotes ? " has-notes" : ""}" data-slug="${esc(slug)}" id="v${v}">
        <p class="vtext"><sup>${v}</sup>${esc(t)}<span class="vstatus"></span></p>
        <div class="vnotes">${notesInner}</div>
      </div>`;
    })
    .join("\n");

  return page(
    display,
    `<header class="ui">
      <a href="/" class="muted">&larr;</a>
      <h1>${esc(display)}</h1>
      <a class="muted" href="/note/${esc(chapterScope.slug)}">chapter note</a>
    </header>
    ${chapterNote ? `<div class="chapter-note">${readerNoteHtml({ scope: chapterScope, note: chapterNote, label: false })}</div>` : ""}
    ${rows}
    <script type="application/json" id="verse-seeds">${blocksJson(seed)}</script>
    <script>
      ${OUTLINER_JS}
      const seeds = JSON.parse(document.getElementById("verse-seeds").textContent);
      // slug → { api, noteEl }
      const editors = new Map();
      document.querySelector(".verse.hl")?.scrollIntoView({ block: "center" });

      function escHtml(s) {
        return String(s).replace(/[&<>"']/g, c =>
          ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]));
      }
      function outlineHtml(blocks) {
        const items = blocks || [];
        if (!items.length) return "";
        return '<div class="outline">' + items.map(b => {
          const depth = Math.max(0, b.indent|0);
          const empty = !(b.text && b.text.trim());
          return '<div class="oline' + (empty ? ' blank' : '') + '" style="--depth:' + depth + '">' +
            '<span class="odot" aria-hidden="true"></span>' +
            '<span class="otxt">' + escHtml(b.text || "") + '</span></div>';
        }).join("") + '</div>';
      }

      function statusElFor(noteEl) {
        const verse = noteEl.closest(".verse");
        if (verse) return verse.querySelector(".vstatus");
        return null;
      }

      function syncHasNotes(verse) {
        if (!verse) return;
        const vslug = verse.dataset.slug;
        const hasVerse = !!(seeds[vslug] && seeds[vslug].some(b => b.text.trim()));
        const hasOther = [...verse.querySelectorAll(".note")].some((n) => {
          if (n.dataset.kind === "verse") return false;
          const blocks = seeds[n.dataset.slug];
          return blocks ? blocks.some(b => b.text.trim()) : !!n.querySelector(".oline, .otxt");
        });
        verse.classList.toggle("has-notes", hasVerse || hasOther);
      }

      async function closeNoteEditor(slug) {
        const ed = editors.get(slug);
        if (!ed) return;
        const { api, noteEl } = ed;
        await api.flush();
        const blocks = api.getBlocks();
        api.destroy();
        editors.delete(slug);
        noteEl.classList.remove("editing");
        const verse = noteEl.closest(".verse");
        if (verse && ![...editors.values()].some(e => e.noteEl.closest(".verse") === verse)) {
          verse.classList.remove("editing");
        }
        const status = statusElFor(noteEl);
        if (status) status.textContent = "";
        const host = noteEl.querySelector(".note-edit");
        const body = noteEl.querySelector(".note-body");
        host.hidden = true;
        host.innerHTML = "";
        if (!blocks.some(b => b.text.trim())) {
          delete seeds[slug];
          noteEl.remove();
        } else {
          seeds[slug] = blocks;
          body.innerHTML = outlineHtml(blocks);
          if (verse) verse.classList.add("notes-open", "has-notes");
        }
        syncHasNotes(verse);
      }

      async function closeAllOnVerse(verse) {
        const slugs = [...editors.entries()]
          .filter(([, ed]) => ed.noteEl.closest(".verse") === verse)
          .map(([slug]) => slug);
        for (const slug of slugs) await closeNoteEditor(slug);
      }

      function openNoteEditor(noteEl) {
        const slug = noteEl.dataset.slug;
        if (editors.has(slug)) { editors.get(slug).api.focus(); return; }
        const verse = noteEl.closest(".verse");
        if (verse) verse.classList.add("notes-open", "editing");
        noteEl.classList.add("editing");
        const host = noteEl.querySelector(".note-edit");
        host.hidden = false;
        host.innerHTML = "";
        const api = mountOutliner(host, {
          slug,
          blocks: seeds[slug] || [{ id: newId(), indent: 0, text: "" }],
          statusEl: statusElFor(noteEl),
          compact: true,
          autofocus: true,
          placeholder: "Write\\u2026",
        });
        editors.set(slug, { api, noteEl });
      }

      function openVerseNoteEditor(verse) {
        let el = verse.querySelector('.note[data-kind="verse"]');
        if (!el) {
          verse.querySelector(".vnotes").insertAdjacentHTML("beforeend",
            '<div class="note" data-kind="verse" data-slug="' + verse.dataset.slug + '">' +
            '<div class="note-body"></div><div class="note-edit" hidden></div></div>');
          el = verse.querySelector('.note[data-kind="verse"]');
        }
        openNoteEditor(el);
      }

      document.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        if (e.target.closest(".otext, .obullet, .outliner, .note-edit")) return;

        // click any note outline (verse / range / chapter) → edit that note inline
        const body = e.target.closest(".note .note-body");
        if (body) {
          const noteEl = body.closest(".note");
          if (!editors.has(noteEl.dataset.slug)) openNoteEditor(noteEl);
          return;
        }
        // click range/chapter label → edit too
        const label = e.target.closest(".note .note-label");
        if (label) {
          openNoteEditor(label.closest(".note"));
          return;
        }

        const verse = e.target.closest(".verse");
        if (!verse || !e.target.closest(".vtext")) return;

        // verse text = all-or-none toggle; while editing, finish + hide
        const editingHere = [...editors.values()].some(ed => ed.noteEl.closest(".verse") === verse);
        if (editingHere) {
          closeAllOnVerse(verse).then(() => verse.classList.remove("notes-open"));
          return;
        }
        if (verse.classList.contains("notes-open")) {
          verse.classList.remove("notes-open");
          return;
        }
        if (verse.classList.contains("has-notes") || verse.querySelector(".note .oline, .note .otxt")) {
          verse.classList.add("notes-open");
          return;
        }
        openVerseNoteEditor(verse);
      });

      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (editors.size) {
          e.preventDefault();
          const last = [...editors.keys()].pop();
          closeNoteEditor(last);
          return;
        }
        const open = document.querySelector(".verse.notes-open");
        if (open) { e.preventDefault(); open.classList.remove("notes-open"); }
      });

      // deep-link: show notes on highlighted verses
      document.querySelectorAll(".verse.hl.has-notes").forEach((v) => v.classList.add("notes-open"));
    </script>`,
  );
}

// ---------- http ----------

const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj, null, 2) + "\n");
};
const html = (res, code, body) => {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    if (req.method === "GET" && p === "/") return html(res, 200, await renderIndex());

    if (req.method === "GET" && p === "/go") {
      const scope = parseScope(url.searchParams.get("q") || "");
      if (!scope) return html(res, 200, page("versepack", `<p>Could not parse that passage. <a href="/">Back</a></p>`));
      // chapters open as readable, annotatable text; verses/ranges as editors
      res.writeHead(302, { location: `${scope.kind === "chapter" ? "/read" : "/note"}/${scope.slug}` });
      return res.end();
    }

    const readMatch = p.match(/^\/read\/([a-z0-9.\-]+)$/i);
    if (req.method === "GET" && readMatch) {
      const scope = parseScope(readMatch[1]);
      if (!scope) return html(res, 404, page("not found", `<p>Not a valid passage address. <a href="/">Back</a></p>`));
      if (scope.slug !== readMatch[1]) {
        res.writeHead(302, { location: `/read/${scope.slug}` });
        return res.end();
      }
      return html(res, 200, await renderRead(scope));
    }

    const noteMatch = p.match(/^\/note\/([a-z0-9.\-]+)$/i);
    if (req.method === "GET" && noteMatch) {
      const scope = parseScope(noteMatch[1]);
      if (!scope) return html(res, 404, page("not found", `<p>Not a valid passage address. <a href="/">Back</a></p>`));
      if (scope.slug !== noteMatch[1]) {
        res.writeHead(302, { location: `/note/${scope.slug}` });
        return res.end();
      }
      const [note, rel] = await Promise.all([readNote(scope.slug), relatedNotes(scope)]);
      return html(res, 200, renderEditor(scope, note, rel));
    }

    if (req.method === "GET" && p === "/api/notes") return json(res, 200, await listNotes());

    const apiMatch = p.match(/^\/api\/note\/([a-z0-9.\-]+)$/i);
    if (apiMatch) {
      const scope = parseScope(apiMatch[1]);
      if (!scope) return json(res, 400, { error: "invalid passage address" });

      if (req.method === "GET") {
        const note = await readNote(scope.slug);
        if (!note) return json(res, 404, { error: "no note at this address" });
        if ((req.headers.accept || "").includes("text/plain") || url.searchParams.has("raw")) {
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          return res.end(serializeBlocks(note.blocks) + "\n");
        }
        return json(res, 200, note);
      }

      if (req.method === "PUT") {
        const raw = await readBody(req);
        const existing = await readNote(scope.slug);
        const ct = (req.headers["content-type"] || "").toLowerCase();

        let blocks;
        if (ct.includes("application/json")) {
          let parsed;
          try {
            parsed = JSON.parse(raw || "null");
          } catch {
            return json(res, 400, { error: "invalid json" });
          }
          const list = Array.isArray(parsed) ? parsed : parsed?.blocks;
          blocks = normalizeBlocks(list);
        } else {
          // plain text interchange (curl): 2 spaces = one indent level
          if (!raw.trim()) {
            if (existing) await unlink(notePath(scope.slug)).catch(() => {});
            return json(res, 200, { deleted: true, slug: scope.slug });
          }
          blocks = reconcileBlocks(raw, existing?.blocks);
        }

        if (blocksAreEmpty(blocks)) {
          if (existing) await unlink(notePath(scope.slug)).catch(() => {});
          return json(res, 200, { deleted: true, slug: scope.slug });
        }

        const now = new Date().toISOString();
        const note = {
          id: existing?.id || `note_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          scope: { kind: scope.kind, osis: scope.osis, slug: scope.slug },
          blocks,
          created_at: existing?.created_at || now,
          updated_at: now,
        };
        await writeNote(note);
        return json(res, 200, note);
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) });
  }
});

await ensurePack();
server.listen(PORT, () => {
  console.log(`versepack door: http://localhost:${PORT}`);
  console.log(`pack on disk:   ${PACK_DIR}`);
});
