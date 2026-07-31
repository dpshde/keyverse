// versepack demo — a cowyo-class capture door over an on-disk pack.
// The pack directory (./pack) is the source of truth; this server is just a door.
import http from "node:http";
import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tryParseAnyPassage,
  formatPassageForDisplay,
  toResolverUrl,
} from "grab-bcv";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.join(ROOT, "pack");
const NOTES_DIR = path.join(PACK_DIR, "notes");
const PORT = Number(process.env.PORT || 4180);

// ---------- pack (storage) ----------

async function ensurePack() {
  await mkdir(NOTES_DIR, { recursive: true });
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
// block ids survive edits (LCS line matching), so a block written on a verse
// today can be referenced, merged, or transcluded by a broader note later
// without losing its identity.

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

function reconcileBlocks(text, prev = []) {
  const next = linesOf(text);
  const ids = lcsIds(prev, next);
  return next.map((l, i) => ({ id: ids[i] || newBlockId(), indent: l.indent, text: l.text }));
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

// ---------- html ----------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 44rem;
         margin: 0 auto; padding: 1.25rem 1rem 4rem; line-height: 1.5; }
  a { color: inherit; }
  input[type=text] { width: 100%; font-size: 1.1rem; padding: .6rem .8rem;
         border: 1.5px solid #8884; border-radius: .5rem; background: transparent; }
  .muted { opacity: .55; font-size: .85rem; }
  .badge { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em;
         border: 1px solid #8886; border-radius: .3rem; padding: .05rem .35rem; opacity: .7; }
  .note-row { display: block; padding: .65rem .2rem; border-bottom: 1px solid #8883;
         text-decoration: none; }
  .note-row:hover { background: #8881; }
  .ref { font-weight: 600; margin-right: .5rem; }
  textarea { width: 100%; min-height: 60vh; font: .95rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
         padding: .8rem; border: 1.5px solid #8884; border-radius: .5rem;
         background: transparent; resize: vertical; }
  textarea:focus, input:focus { outline: none; border-color: #4a90d9; }
  h2 { font-size: .95rem; margin: 1.8rem 0 .35rem; opacity: .85; }
  ul.outline { list-style: none; padding-left: 1.1rem; margin: .2rem 0; }
  ul.outline > li { padding: .08rem 0; }
  ul.outline > li::before { content: "\\2022"; opacity: .35; margin-right: .5rem; }
  .embed { border: 1px solid #8883; border-radius: .5rem; padding: .6rem .8rem; margin: .6rem 0; }
  .embed-head { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; margin-bottom: .2rem; }
  .embed-head a { font-size: .8rem; margin-left: auto; }
  header { display: flex; align-items: baseline; gap: .6rem; margin-bottom: .75rem; flex-wrap: wrap; }
  header h1 { font-size: 1.25rem; margin: 0; }
  #status { font-size: .8rem; opacity: .5; min-width: 4rem; }
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

// Read-only outline projection of a note's blocks. Nesting is derived from
// indent; each li carries its block id so identity is visibly real.
function renderOutline(blocks) {
  let out = "", open = 0;
  for (const b of blocks || []) {
    if (!b.text.trim()) continue;
    const want = Math.min(b.indent + 1, open + 1);
    while (open > want) { out += "</ul>"; open--; }
    while (open < want) { out += `<ul class="outline">`; open++; }
    out += `<li title="${esc(b.id)}">${esc(b.text)}</li>`;
  }
  while (open > 0) { out += "</ul>"; open--; }
  return out || `<p class="muted"><em>empty</em></p>`;
}

function embedHtml(entry) {
  const display = formatPassageForDisplay(entry.scope.parsed);
  return `<div class="embed">
    <div class="embed-head">
      <span class="ref">${esc(display)}</span>
      <span class="badge">${esc(entry.scope.kind)}</span>
      <a href="/note/${esc(entry.scope.slug)}">edit its own note &rarr;</a>
    </div>
    ${renderOutline(entry.note.blocks)}
  </div>`;
}

function linkRow(entry) {
  const display = formatPassageForDisplay(entry.scope.parsed);
  return `<a class="note-row" href="/note/${esc(entry.scope.slug)}">
    <span class="ref">${esc(display)}</span><span class="badge">${esc(entry.scope.kind)}</span>
    <div class="muted">${esc(excerpt(entry.note)) || "<em>empty</em>"}</div></a>`;
}

function relTime(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function renderIndex() {
  const notes = await listNotes();
  const rows = notes
    .map((n) => {
      const scope = parseScope(n.scope.osis);
      const display = scope ? formatPassageForDisplay(scope.parsed) : n.scope.osis;
      return `<a class="note-row" href="/note/${esc(n.scope.slug)}">
        <span class="ref">${esc(display)}</span><span class="badge">${esc(n.scope.kind)}</span>
        <span class="muted" style="float:right">${esc(relTime(n.updated_at))}</span>
        <div class="muted">${esc(excerpt(n)) || "<em>empty</em>"}</div></a>`;
    })
    .join("\n");
  return page(
    "versepack",
    `<header><h1>versepack</h1><span class="muted">notes follow the pack</span></header>
    <form action="/go" method="get">
      <input type="text" name="q" placeholder="John 3:16 &middot; 1jn.1 &middot; Rom 8:28-30 &mdash; type a passage, press enter" autofocus autocomplete="off">
    </form>
    <p class="muted">${notes.length} note${notes.length === 1 ? "" : "s"} in pack</p>
    ${rows || `<p class="muted">No notes yet. Type a passage above to open its door.</p>`}`,
  );
}

function renderEditor(scope, note, rel) {
  const display = formatPassageForDisplay(scope.parsed);
  const route = toResolverUrl("https://route.bible", scope.parsed);
  const sections = [];
  if (rel.contains.length) {
    sections.push(`<h2>Within ${esc(display)}</h2>
      <p class="muted">Independent notes on passages inside this one. They compose here — they are not copied here. Editing this page never touches them.</p>
      ${rel.contains.map(embedHtml).join("\n")}`);
  }
  if (rel.within.length) {
    sections.push(`<h2>Part of broader notes</h2>
      ${rel.within.map(linkRow).join("\n")}`);
  }
  if (rel.overlaps.length) {
    sections.push(`<h2>Overlapping notes</h2>
      ${rel.overlaps.map(linkRow).join("\n")}`);
  }
  return page(
    display,
    `<header>
      <a href="/" class="muted">&larr; all notes</a>
      <h1>${esc(display)}</h1>
      <span class="badge">${esc(scope.kind)}</span>
      <a class="muted" href="${esc(route)}" target="_blank" rel="noopener">route.bible &nearr;</a>
      <span id="status" style="margin-left:auto"></span>
    </header>
    <textarea id="body" placeholder="Type. Indent with two spaces to nest. It saves itself." autofocus>${esc(serializeBlocks(note?.blocks))}</textarea>
    <p class="muted">address: <code>/note/${esc(scope.slug)}</code> &middot;
       curl in: <code>curl -X PUT --data-binary @- localhost:${PORT}/api/note/${esc(scope.slug)}</code></p>
    ${sections.join("\n")}
    <script>
      const ta = document.getElementById("body"), status = document.getElementById("status");
      let timer, inflight;
      ta.addEventListener("input", () => {
        status.textContent = "…";
        clearTimeout(timer);
        timer = setTimeout(save, 400);
      });
      async function save() {
        if (inflight) await inflight;
        inflight = fetch("/api/note/${esc(scope.slug)}", { method: "PUT", body: ta.value })
          .then(r => { status.textContent = r.ok ? "saved" : "error"; })
          .catch(() => { status.textContent = "offline"; })
          .finally(() => { inflight = null; });
      }
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
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
      res.writeHead(302, { location: `/note/${scope.slug}` });
      return res.end();
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
        const body = await readBody(req);
        const existing = await readNote(scope.slug);
        if (!body.trim()) {
          // empty body clears the address, cowyo-style
          if (existing) await unlink(notePath(scope.slug)).catch(() => {});
          return json(res, 200, { deleted: true, slug: scope.slug });
        }
        const now = new Date().toISOString();
        const note = {
          id: existing?.id || `note_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          scope: { kind: scope.kind, osis: scope.osis, slug: scope.slug },
          blocks: reconcileBlocks(body, existing?.blocks),
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
