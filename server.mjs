// keyverse demo — a cowyo-class capture door over an on-disk pack.
// The pack directory (./pack) is the source of truth; this server is just a door.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, readdir, mkdir, unlink, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tryParseAnyPassage,
  formatPassageForDisplay,
  getBookOrder,
  autocompletePassage,
} from "grab-bcv";
import QRCode from "qrcode";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// PACK_DIR: absolute or relative path to the pack directory (default ./pack).
const PACK_DIR = process.env.PACK_DIR
  ? path.resolve(process.env.PACK_DIR)
  : path.join(ROOT, "pack");
const NOTES_DIR = path.join(PACK_DIR, "notes");
const TEXT_DIR = path.join(PACK_DIR, "text", "bsb");
const ATTACH_DIR = path.join(PACK_DIR, "attachments");
const PORT = Number(process.env.PORT || 4180);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_ATTACH_BYTES = Number(process.env.MAX_ATTACH_BYTES || 50 * 1024 * 1024);
// Multiword door (cowyo-style): the URL *is* the key. No passwords, no accounts.
// DOOR=quiet-river-lantern  or auto-written to pack/door
// DOOR_OPEN=1 disables the door (open LAN demo only).
const DOOR_OPEN = process.env.DOOR_OPEN === "1" || process.env.DOOR_OPEN === "true";
const DOOR_FILE = path.join(PACK_DIR, "door");
// Interop constants (pack/protocol.json + GET /api/protocol)
const PROTOCOL_NAME = "keyverse";
const PROTOCOL_VERSION = "0.1-demo";
// CORS for /api/* : default * (door is the secret). CORS_ORIGIN=off disables.
// Comma-separated origins for credentialed multi-origin setups.
const CORS_ORIGIN_RAW = process.env.CORS_ORIGIN;

// ---------- multiword door (frictionless access) ----------

let DOOR = ""; // hyphenated multiword, e.g. quiet-river-lantern

function basePath() {
  return DOOR && !DOOR_OPEN ? `/${DOOR}` : "";
}

/** Prefix an absolute app path with the door segment. */
function u(p) {
  const pathOnly = p.startsWith("/") ? p : `/${p}`;
  return basePath() + pathOnly;
}

function normalizeDoorPhrase(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function loadWordList() {
  try {
    const raw = await readFile(path.join(ROOT, "words-door.txt"), "utf8");
    const words = raw.split(/\s+/).map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]{3,8}$/.test(w));
    if (words.length >= 64) return words;
  } catch { /* fall through */ }
  return "able acid also aqua arch area atom auto axis baby ball band bank bare base beam bean bear bell bird blue boat body bold bone book boot born bowl burn cake calm camp card care case cash cast cave cell chat chip city clay clip cold cook cool corn cost crab crew crow cube cure curl cute damp dark data dawn deal dear deep desk dial diet door down draw drop drum dual duck dusk dust duty each earn east easy echo edge edit even ever exit face fact fail fair fall fame farm fast fate fear feed feel file film find fine fire firm fish five flag flat flow foam fold food foot fork form fort four free frog from fuel full gain game gate gear gift girl give glad glow glue goal gold good grab gray grew grid grow hard harm hate have head heal heap heat help herb hero high hill hint hold hole home hope horn host hour huge hunt idea idle inch into iron item jade join joke jump just keen keep kept kick kind king kite knee knew know lace lack lake lamp land lane last late lawn lead leaf lean leap left less life lift like limb lime line link lion list live load loan lock long look loop lord lose loss lost loud love luck lung made maid mail main make male many mark mask mass mate maze meal mean meat meet melt menu mild mile milk mill mind mine mint miss mist mode mood moon more most move much must navy near neat need nest news next nice nine node none noon nose note once only open oven over pace pack page paid pain pair pale palm park part pass past path peak pear pick pile pine pink plan play plot plus poem pole pond pool port pose post pour pull pure push queen quiet quiz race raft rain rake rank rare rate read real rest rice rich ride ring rise risk road rock roll roof room root rose ruin rule rush rust safe said sail sale salt same sand save seal seat seed seek seem seen self sell send ship shop show shut sick side sign silk sing sink site size skin skip slow snow soap sock soft soil sold some song soon sort soul soup spin spot star stay stem step stop such suit sure swan swim tack tail take talk tall tank tape task team tear tell tend tent term test text than that them then they thin this tide tidy time tiny told tone took tool tour town trap tray tree trim trip true tube tuna turn twin type unit upon used user vain vary vast veil verb very vest view vine void vote wage wait wake walk wall want ward warm warn wave ways weak wear week well went were west what when wide wife wild will wind wine wing wipe wire wise wish with wolf wood wool word work yard yarn year your zero zone zoom".split(/\s+/);
}

async function generateDoorPhrase() {
  const words = await loadWordList();
  const parts = [];
  for (let i = 0; i < 4; i++) {
    parts.push(words[randomBytes(2).readUInt16BE(0) % words.length]);
  }
  return parts.join("-");
}

async function ensureDoor() {
  if (DOOR_OPEN) {
    DOOR = "";
    return;
  }
  const fromEnv = normalizeDoorPhrase(process.env.DOOR || process.env.PACK_DOOR || "");
  if (fromEnv) {
    DOOR = fromEnv;
    return;
  }
  try {
    const existing = normalizeDoorPhrase(await readFile(DOOR_FILE, "utf8"));
    if (existing && existing.split("-").length >= 3) {
      DOOR = existing;
      return;
    }
  } catch { /* generate */ }
  DOOR = await generateDoorPhrase();
  await mkdir(PACK_DIR, { recursive: true });
  await writeFile(DOOR_FILE, DOOR + "\n", { mode: 0o600 });
}

function doorMatches(segment) {
  if (DOOR_OPEN) return true;
  return normalizeDoorPhrase(segment) === DOOR;
}

/** True when the browser is on the same machine as the server (safe first-open). */
function isLocalClient(req) {
  const raw = String(req.socket?.remoteAddress || "");
  const ip = raw.replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

/** Strip /{door}/… prefix; returns null if door required and missing/wrong. */
function routePath(pathname) {
  const raw = pathname || "/";
  if (DOOR_OPEN) return { ok: true, path: raw === "" ? "/" : raw };

  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0) return { ok: false, path: "/", needDoor: true };

  const head = parts[0].toLowerCase();
  // reserved top-level words that are never doors
  if (head === "enter" || head === "login") return { ok: false, path: raw, needDoor: true };

  if (!doorMatches(head)) return { ok: false, path: raw, badDoor: true };

  const rest = "/" + parts.slice(1).join("/");
  return { ok: true, path: rest === "/" ? "/" : rest.replace(/\/$/, "") || "/" };
}

// ---------- pack (storage) ----------

async function ensurePack() {
  await mkdir(NOTES_DIR, { recursive: true });
  await mkdir(TEXT_DIR, { recursive: true });
  await mkdir(ATTACH_DIR, { recursive: true });
  const protocolPath = path.join(PACK_DIR, "protocol.json");
  try {
    await readFile(protocolPath);
  } catch {
    await writeFile(
      protocolPath,
      JSON.stringify(
        {
          protocol: PROTOCOL_NAME,
          version: PROTOCOL_VERSION,
          schemas: "schemas/",
        },
        null,
        2,
      ) + "\n",
    );
  }
  await ensureDoor();
}

const newAttId = () => `att_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

function attachBlobPath(sha256) {
  const hex = String(sha256 || "").toLowerCase().replace(/[^a-f0-9]/g, "");
  if (hex.length !== 64) return null;
  return path.join(ATTACH_DIR, hex);
}

async function writeAttachmentBlob(buf) {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const p = attachBlobPath(sha256);
  try {
    await access(p);
  } catch {
    await writeFile(p, buf);
  }
  return sha256;
}

function normalizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const kind = raw.kind === "url" ? "url" : raw.kind === "file" ? "file" : null;
    if (!kind) continue;
    let id = typeof raw.id === "string" && /^[\w.-]+$/.test(raw.id) ? raw.id : newAttId();
    if (seen.has(id)) id = newAttId();
    seen.add(id);
    if (kind === "url") {
      const url = String(raw.url || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      out.push({
        id,
        kind: "url",
        url,
        title: raw.title != null ? String(raw.title).slice(0, 500) : undefined,
        created_at: raw.created_at || new Date().toISOString(),
      });
    } else {
      const sha256 = String(raw.sha256 || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha256)) continue;
      out.push({
        id,
        kind: "file",
        name: String(raw.name || "file").slice(0, 500),
        mime: String(raw.mime || "application/octet-stream").slice(0, 200),
        sha256,
        bytes: Math.max(0, Number(raw.bytes) || 0),
        created_at: raw.created_at || new Date().toISOString(),
      });
    }
  }
  return out;
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
//   { id, indent, text, collapsed? }
// The tree is a projection of `indent` (2 spaces per level in text form),
// dotflowy-style: flat rows are canonical, the outline is derived. Stable
// block ids survive edits (LCS line matching for text/curl; the outliner UI
// sends ids directly). Optional `collapsed` persists in JSON only (ADR 0013).

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
// Optional collapsed (ADR 0013): only serialized when true.
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
    const row = { id, indent, text };
    if (item?.collapsed === true || item?.collapsed === "true" || item?.collapsed === 1) {
      row.collapsed = true;
    }
    out.push(row);
  }
  return out;
}

function blocksAreEmpty(blocks) {
  return !hasContent(blocks);
}

// Legacy demo notes stored one flat `body` string; hydrate them into blocks
// with deterministic ids so repeated reads agree until the next save persists.
function hydrate(note) {
  if (!note) return note;
  // Client-side encrypted envelope: no plaintext blocks on disk
  if (note.encrypted && note.cipher && typeof note.cipher === "object") {
    if (!Array.isArray(note.blocks)) note.blocks = [];
    if (!Array.isArray(note.attachments)) note.attachments = [];
    return note;
  }
  if (!Array.isArray(note.blocks)) {
    note.blocks = linesOf(typeof note.body === "string" ? note.body : "")
      .map((l, i) => ({ id: `${note.id}_l${i}`, indent: l.indent, text: l.text }));
    delete note.body;
  }
  if (!Array.isArray(note.attachments)) note.attachments = [];
  else note.attachments = normalizeAttachments(note.attachments);
  return note;
}

function isEncryptedNote(note) {
  return !!(note && note.encrypted && note.cipher && note.cipher.ct);
}

/** Validate client-side AES-GCM envelope (opaque to server). */
function normalizeCipher(cipher) {
  if (!cipher || typeof cipher !== "object") return null;
  const ct = typeof cipher.ct === "string" ? cipher.ct : "";
  const salt = typeof cipher.salt === "string" ? cipher.salt : "";
  const iv = typeof cipher.iv === "string" ? cipher.iv : "";
  if (!ct || !salt || !iv) return null;
  if (ct.length > 8_000_000) return null; // ~6MB b64 cap
  return {
    v: Number(cipher.v) || 1,
    alg: typeof cipher.alg === "string" ? cipher.alg : "AES-GCM",
    kdf: typeof cipher.kdf === "string" ? cipher.kdf : "PBKDF2",
    iter: Number(cipher.iter) || 210000,
    salt,
    iv,
    ct,
  };
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

// ---------- home list: project notes into a containment tree ----------
// Storage stays one file per address (ADR 0004). The home page *displays*
// chapter → verse nesting from OSIS geometry, with synthetic chapter folders
// when verse notes exist without a chapter note.

function noteEntry(note) {
  const scope = parseScope(note.scope?.osis || note.scope?.slug);
  if (!scope) return null;
  return { note, scope, interval: scopeInterval(scope.parsed) };
}

/** Nest notes by containment: start asc, wider first, stack of open parents. */
function buildContainmentForest(entries) {
  const sorted = [...entries].sort((a, b) => {
    if (a.interval.book !== b.interval.book) {
      return (getBookOrder(a.interval.book) ?? 999) - (getBookOrder(b.interval.book) ?? 999);
    }
    if (a.interval.s !== b.interval.s) return a.interval.s - b.interval.s;
    const spanA = a.interval.e - a.interval.s;
    const spanB = b.interval.e - b.interval.s;
    if (spanA !== spanB) return spanB - spanA; // wider parent first
    return a.scope.slug < b.scope.slug ? -1 : a.scope.slug > b.scope.slug ? 1 : 0;
  });
  const roots = [];
  const stack = [];
  for (const entry of sorted) {
    while (stack.length) {
      const top = stack[stack.length - 1];
      const rel = relateScopes(top.entry.interval, entry.interval);
      if (rel === "contains") break;
      stack.pop();
    }
    const node = { kind: "note", entry, children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function maxUpdatedAt(entries) {
  let best = "";
  for (const e of entries) {
    const t = e.note?.updated_at || "";
    if (t > best) best = t;
  }
  return best;
}

/**
 * Home forest: book order → chapter folders (synthetic when needed) →
 * notes nested by containment. Multi-chapter ranges sit at book level.
 */
function buildHomeNoteTree(notes) {
  const entries = [];
  for (const note of notes) {
    const e = noteEntry(note);
    if (e) entries.push(e);
  }
  if (!entries.length) return [];

  const byBook = new Map();
  for (const e of entries) {
    const b = e.interval.book;
    if (!byBook.has(b)) byBook.set(b, []);
    byBook.get(b).push(e);
  }
  const books = [...byBook.keys()].sort(
    (a, b) => (getBookOrder(a) ?? 999) - (getBookOrder(b) ?? 999),
  );

  const out = [];
  for (const book of books) {
    const bookEntries = byBook.get(book);
    const byChapter = new Map(); // single-chapter only
    const multi = [];
    for (const e of bookEntries) {
      const sc = e.scope.parsed.start.chapter;
      const ec = e.scope.parsed.end.chapter;
      if (sc !== ec) multi.push(e);
      else {
        if (!byChapter.has(sc)) byChapter.set(sc, []);
        byChapter.get(sc).push(e);
      }
    }

    const units = [];
    for (const [ch, list] of byChapter) {
      units.push({ type: "chapter", chapter: ch, entries: list, s: pos(ch, 1) });
    }
    for (const e of multi) {
      units.push({ type: "multi", entry: e, s: e.interval.s });
    }
    units.sort((a, b) => a.s - b.s || (a.type === "chapter" ? -1 : 1));

    for (const unit of units) {
      if (unit.type === "multi") {
        out.push({ kind: "note", entry: unit.entry, children: [] });
        continue;
      }
      const forest = buildContainmentForest(unit.entries);
      const chapterNote = unit.entries.find((e) => e.scope.kind === "chapter");
      if (chapterNote) {
        // Chapter note is the folder; nest any same-chapter roots under it.
        let root = forest.find((n) => n.entry.scope.slug === chapterNote.scope.slug);
        if (!root) {
          root = { kind: "note", entry: chapterNote, children: forest };
        } else {
          for (const r of forest) {
            if (r !== root) root.children.push(r);
          }
        }
        out.push(root);
      } else {
        const chScope = parseScope(`${book}.${unit.chapter}`);
        const label = chScope
          ? formatPassageForDisplay(chScope.parsed)
          : `${book} ${unit.chapter}`;
        const slug = chScope?.slug || `${book}.${unit.chapter}`.toLowerCase();
        out.push({
          kind: "folder",
          label,
          slug,
          href: chScope ? u(`/read/${chScope.slug}`) : u("/"),
          children: forest,
          updated_at: maxUpdatedAt(unit.entries),
          count: unit.entries.length,
        });
      }
    }
  }
  return out;
}

function countTreeNotes(node) {
  if (node.kind === "note") {
    let n = 1;
    for (const c of node.children || []) n += countTreeNotes(c);
    return n;
  }
  let n = 0;
  for (const c of node.children || []) n += countTreeNotes(c);
  return n;
}

const NT_ICON_EDIT = `<svg width="14" height="14" viewBox="0 0 256 256" fill="none" aria-hidden="true"><polygon points="128 160 96 160 96 128 192 32 224 64 128 160" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="168" y1="56" x2="200" y2="88" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M216,128v80a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V48a8,8,0,0,1,8-8h80" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;
const NT_ICON_READ = `<svg width="14" height="14" viewBox="0 0 256 256" fill="none" aria-hidden="true"><path d="M128,88a32,32,0,0,1,32-32h72V200H160a32,32,0,0,0-32,32" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M24,200H96a32,32,0,0,1,32,32V88A32,32,0,0,0,96,56H24Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;

function renderHomeTreeNode(node, depth = 0) {
  const kids = node.children || [];
  const hasKids = kids.length > 0;
  const id =
    node.kind === "folder"
      ? `folder:${node.slug}`
      : `note:${node.entry.scope.slug}`;

  let noteHref;
  let readHref;
  let ref;
  let timeIso;
  let sub;
  let isChapter = false;

  if (node.kind === "folder") {
    // Synthetic chapter folder: both icons open that chapter address.
    noteHref = u(`/note/${node.slug}`);
    readHref = node.href;
    ref = node.label;
    timeIso = node.updated_at;
    const n = node.count || countTreeNotes(node);
    sub = `${n} note${n === 1 ? "" : "s"}`;
    isChapter = true;
  } else {
    const { note, scope } = node.entry;
    noteHref = u(`/note/${scope.slug}`);
    // Reader accepts verse/range scopes and highlights them in the chapter.
    readHref = u(`/read/${scope.slug}`);
    ref = formatPassageForDisplay(scope.parsed);
    timeIso = note.updated_at;
    sub = excerpt(note) || "empty";
    isChapter = scope.kind === "chapter";
  }

  const chev = hasKids
    ? `<button type="button" class="nt-chev" aria-label="Collapse" aria-expanded="true"></button>`
    : `<span class="nt-chev is-leaf" aria-hidden="true"></span>`;

  const rowCls = [
    "note-row",
    node.kind === "folder" ? "is-folder" : "",
    isChapter ? "is-chapter" : "",
    hasKids ? "has-kids" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Meta sits top-right (icons left of modified stamp). Outside the fold button
  // so we never nest links inside a button.
  const meta = `<span class="nt-meta">
      <a class="nt-act nt-open" href="${esc(noteHref)}" title="Open note" aria-label="Open note">${NT_ICON_EDIT}</a>
      <a class="nt-act nt-read" href="${esc(readHref)}" title="Read" aria-label="Read">${NT_ICON_READ}</a>
      ${timeIso ? `<span class="muted nt-time">${esc(relTime(timeIso))}</span>` : ""}
    </span>`;
  const mainInner = `
      <span class="nt-top">
        <span class="ref">${esc(ref)}</span>
        ${meta}
      </span>
      <div class="muted nt-ex">${esc(sub)}</div>`;
  // Parent rows: click main (except .nt-act) to fold.
  // Leaf verse/passage rows: click main opens reader at that spot.
  const main = hasKids
    ? `<div class="nt-main nt-fold" role="button" tabindex="0" aria-expanded="true">${mainInner}
    </div>`
    : `<div class="nt-main nt-open-read" role="link" tabindex="0" data-href="${esc(readHref)}">${mainInner}
    </div>`;

  const kidsHtml = hasKids
    ? `<div class="nt-kids">${kids.map((c) => renderHomeTreeNode(c, depth + 1)).join("")}</div>`
    : "";

  return `<div class="nt-node" data-id="${esc(id)}" data-depth="${depth}">
    <div class="${rowCls}" style="--depth:${depth}">
      ${chev}
      ${main}
    </div>
    ${kidsHtml}
  </div>`;
}

function renderHomeNoteTree(notes) {
  const tree = buildHomeNoteTree(notes);
  if (!tree.length) return "";
  const body = tree.map((n) => renderHomeTreeNode(n, 0)).join("\n");
  return `<div class="note-tree" id="note-tree">${body}</div>
  <script>
  (function () {
    var root = document.getElementById("note-tree");
    if (!root) return;
    var KEY = "vp_home_fold_" + (typeof BASE === "string" ? BASE : location.pathname.split("/")[1] || "local");
    function load() {
      try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
    }
    function save(map) {
      try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) {}
    }
    var collapsed = load();
    function setExpanded(node, expanded) {
      node.classList.toggle("is-collapsed", !expanded);
      var chev = node.querySelector(":scope > .note-row .nt-chev");
      if (chev && chev.tagName === "BUTTON") {
        chev.setAttribute("aria-expanded", expanded ? "true" : "false");
        chev.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
      }
      var fold = node.querySelector(":scope > .note-row .nt-fold");
      if (fold) fold.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
    function toggleNode(node) {
      if (!node || !node.querySelector(":scope > .nt-kids")) return;
      var id = node.getAttribute("data-id");
      var nowCollapsed = !node.classList.contains("is-collapsed");
      setExpanded(node, !nowCollapsed);
      var map = load();
      if (nowCollapsed) map[id] = 1; else delete map[id];
      save(map);
    }
    root.querySelectorAll(".nt-node").forEach(function (node) {
      var id = node.getAttribute("data-id");
      if (!id || !collapsed[id]) return;
      if (!node.querySelector(":scope > .nt-kids")) return;
      setExpanded(node, false);
    });
    root.addEventListener("click", function (e) {
      if (e.target.closest(".nt-act")) return; // open note / read icons
      var chev = e.target.closest(".nt-chev");
      if (chev && !chev.classList.contains("is-leaf") && chev.tagName === "BUTTON") {
        e.preventDefault();
        e.stopPropagation();
        toggleNode(chev.closest(".nt-node"));
        return;
      }
      var fold = e.target.closest(".nt-fold");
      if (fold) {
        e.preventDefault();
        toggleNode(fold.closest(".nt-node"));
        return;
      }
      var openRead = e.target.closest(".nt-open-read");
      if (openRead) {
        var href = openRead.getAttribute("data-href");
        if (href) {
          if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
          else location.href = href;
        }
      }
    });
    root.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest(".nt-act")) return;
      var fold = e.target.closest(".nt-fold");
      if (fold && e.target === fold) {
        e.preventDefault();
        toggleNode(fold.closest(".nt-node"));
        return;
      }
      var openRead = e.target.closest(".nt-open-read");
      if (openRead && e.target === openRead) {
        e.preventDefault();
        var href = openRead.getAttribute("data-href");
        if (href) location.href = href;
      }
    });
  })();
  </script>`;
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

// Wiki links: [[target]] or [[target|label]] — see PROTOCOL §4.1 / ADR 0009.
// Prefer canonical /note/<slug> when parseable; else /go?q= for human recovery.
function resolveWikiTarget(raw) {
  const target = String(raw || "").trim();
  if (!target) return null;
  const scope = parseScope(target);
  if (scope) {
    return {
      href: u(`/note/${scope.slug}`),
      label: formatPassageForDisplay(scope.parsed),
      slug: scope.slug,
    };
  }
  return { href: u(`/go?q=${encodeURIComponent(target)}`), label: target, slug: null };
}

function renderEmbed(target, label, attachments = []) {
  const t = String(target || "").trim();
  const lab = (label != null && String(label).trim() !== "" ? String(label).trim() : null);
  // attachment pointer
  const attM = t.match(/^att:(.+)$/i);
  if (attM) {
    const att = (attachments || []).find((a) => a.id === attM[1].trim());
    if (!att) return `<span class="att-missing">${esc(lab || t)}</span>`;
    if (att.kind === "url") {
      return `<a class="attlink" href="${esc(att.url)}" target="_blank" rel="noopener noreferrer">${esc(lab || att.title || att.url)}</a>`;
    }
    const href = u(`/api/attachments/${att.sha256}?name=${encodeURIComponent(att.name || "file")}`);
    if ((att.mime || "").startsWith("image/")) {
      return `<a class="attlink att-image" href="${esc(href)}" target="_blank" rel="noopener"><img src="${esc(href)}" alt="${esc(lab || att.name || "")}" loading="lazy"></a>`;
    }
    return `<a class="attlink" href="${esc(href)}" download="${esc(att.name || "file")}">${esc(lab || att.name || "file")}</a>`;
  }
  // bare URL embed
  if (/^https?:\/\//i.test(t)) {
    return `<a class="attlink" href="${esc(t)}" target="_blank" rel="noopener noreferrer">${esc(lab || t)}</a>`;
  }
  return null;
}

/**
 * Base inline markdown for block text (dotflowy-inspired: markers stay in the
 * stored string; render is flat — no nested emphasis).
 *
 * Supported: `code`, **bold**, *italic* / _italic_, ~~strike~~,
 * [label](https://…), [[wiki]], ![[embed]].
 * Order: code → wiki/embed → md link → bold → strike → italic.
 */
function formatBlockText(text, attachments = []) {
  const s = String(text ?? "");
  let i = 0;
  let out = "";

  const isWord = (ch) => ch != null && /[A-Za-z0-9]/.test(ch);

  while (i < s.length) {
    // inline code — interior is literal
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1 && !s.slice(i + 1, end).includes("\n")) {
        out += `<code class="md-code">${esc(s.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }

    // embeds ![[…]] then wiki [[…]]
    if (s[i] === "!" && s[i + 1] === "[" && s[i + 2] === "[") {
      const end = s.indexOf("]]", i + 3);
      if (end >= 0) {
        const inner = s.slice(i + 3, end);
        if (!inner.includes("\n")) {
          const pipe = inner.indexOf("|");
          const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
          const label = pipe < 0 ? null : inner.slice(pipe + 1).trim();
          const emb = renderEmbed(target, label, attachments);
          out += emb != null ? emb : esc(s.slice(i, end + 2));
          i = end + 2;
          continue;
        }
      }
    }
    if (s[i] === "[" && s[i + 1] === "[") {
      const end = s.indexOf("]]", i + 2);
      if (end >= 0) {
        const inner = s.slice(i + 2, end);
        if (!inner.includes("\n")) {
          const pipe = inner.indexOf("|");
          const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
          const label = pipe < 0 ? null : inner.slice(pipe + 1).trim();
          const resolved = resolveWikiTarget(target);
          const lab = (label && label.length ? label : null) || resolved?.label || target;
          if (resolved) {
            out += `<a class="wikilink" href="${esc(resolved.href)}" data-wiki="${esc(target)}">${esc(lab)}</a>`;
          } else {
            out += esc(s.slice(i, end + 2));
          }
          i = end + 2;
          continue;
        }
      }
    }

    // markdown link [label](https://…)
    if (s[i] === "[") {
      const close = s.indexOf("]", i + 1);
      if (close > i + 1 && s[close + 1] === "(") {
        const urlEnd = s.indexOf(")", close + 2);
        if (urlEnd > close + 2) {
          const lab = s.slice(i + 1, close);
          const url = s.slice(close + 2, urlEnd).trim();
          if (
            lab &&
            !lab.includes("\n") &&
            /^https?:\/\/[^\s]+$/i.test(url)
          ) {
            out += `<a class="md-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(lab)}</a>`;
            i = urlEnd + 1;
            continue;
          }
        }
      }
    }

    // **bold**
    if (s[i] === "*" && s[i + 1] === "*") {
      const end = s.indexOf("**", i + 2);
      if (end > i + 2) {
        const inner = s.slice(i + 2, end);
        if (inner && !inner.includes("*") && !inner.includes("\n")) {
          out += `<strong class="md-strong">${esc(inner)}</strong>`;
          i = end + 2;
          continue;
        }
      }
    }

    // ~~strike~~
    if (s[i] === "~" && s[i + 1] === "~") {
      const end = s.indexOf("~~", i + 2);
      if (end > i + 2) {
        const inner = s.slice(i + 2, end);
        if (inner && !inner.includes("~") && !inner.includes("\n")) {
          out += `<s class="md-strike">${esc(inner)}</s>`;
          i = end + 2;
          continue;
        }
      }
    }

    // *italic*
    if (s[i] === "*" && s[i + 1] !== "*") {
      const end = s.indexOf("*", i + 1);
      if (end > i + 1) {
        const inner = s.slice(i + 1, end);
        if (inner && !inner.includes("*") && !inner.includes("\n")) {
          out += `<em class="md-em">${esc(inner)}</em>`;
          i = end + 1;
          continue;
        }
      }
    }

    // _italic_ (not snake_case)
    if (s[i] === "_") {
      const prev = i > 0 ? s[i - 1] : " ";
      if (!isWord(prev)) {
        const end = s.indexOf("_", i + 1);
        if (end > i + 1) {
          const next = end + 1 < s.length ? s[end + 1] : " ";
          const inner = s.slice(i + 1, end);
          if (
            inner &&
            !inner.includes("_") &&
            !inner.includes("\n") &&
            !isWord(next)
          ) {
            out += `<em class="md-em">${esc(inner)}</em>`;
            i = end + 1;
            continue;
          }
        }
      }
    }

    // plain run until next marker candidate
    let j = i + 1;
    while (j < s.length) {
      const c = s[j];
      if (
        c === "`" ||
        c === "[" ||
        c === "*" ||
        c === "~" ||
        c === "_" ||
        (c === "!" && s[j + 1] === "[")
      ) {
        break;
      }
      j++;
    }
    out += esc(s.slice(i, j));
    i = j;
  }
  return out;
}

/** @deprecated alias — prefer formatBlockText */
function linkifyText(text, attachments = []) {
  return formatBlockText(text, attachments);
}
const linkifyWiki = (text) => formatBlockText(text);

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    max-width: 38rem; margin: 0 auto;
    padding: 1.5rem 1.1rem calc(5rem + env(safe-area-inset-bottom, 0px));
    padding-left: max(1.1rem, env(safe-area-inset-left, 0px));
    padding-right: max(1.1rem, env(safe-area-inset-right, 0px));
    line-height: 1.55; font-size: 1.05rem;
  }
  a { color: inherit; text-decoration: none; }
  a:hover { opacity: .72; }
  /* body-copy / explicit text links only */
  a.underline, .note-meta a, .prose a, a.wikilink, a.attlink {
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
  }
  a.underline:hover, .note-meta a:hover, .prose a:hover, a.wikilink:hover, a.attlink:hover { opacity: 1;
    text-decoration-color: color-mix(in srgb, currentColor 55%, transparent); }
  a.wikilink, a.attlink, a.md-link { border-radius: .15rem; cursor: pointer; }
  a.wikilink:hover, a.attlink:hover, a.md-link:hover {
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
  /* attachments — one quiet list + one add row */
  .att-board {
    margin: 1rem 0 0;
    font-family: -apple-system, system-ui, sans-serif;
  }
  .att-list { list-style: none; margin: 0; padding: 0; }
  .att-row {
    display: flex; align-items: center; gap: .45rem;
    padding: .35rem 0;
    font-size: .88rem;
    min-height: 2.1rem;
  }
  .att-row .attlink {
    flex: 1 1 auto; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: inherit;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 22%, transparent);
    text-underline-offset: .12em;
  }
  .att-row .attlink:hover { text-decoration-color: currentColor; }
  .att-meta {
    flex: 0 0 auto;
    color: color-mix(in srgb, currentColor 38%, transparent);
    font-size: .75rem;
  }
  .att-remove {
    flex: 0 0 auto;
    border: 0; background: transparent; cursor: pointer;
    color: color-mix(in srgb, currentColor 40%, transparent);
    font-size: .9rem; line-height: 1; padding: .25rem .35rem;
    min-height: 2rem; min-width: 2rem;
    -webkit-tap-highlight-color: transparent;
  }
  .att-remove:hover { color: inherit; }
  .att-add {
    display: flex; flex-wrap: wrap; align-items: center; gap: .15rem .5rem;
    margin-top: .35rem;
  }
  .att-add input[type=file] { display: none; }
  .att-file-btn,
  .att-link-btn {
    flex: 0 0 auto;
    display: inline-flex; align-items: center;
    font: inherit; font-size: .85rem; padding: .45rem .55rem;
    border: 0; background: transparent; cursor: pointer;
    color: color-mix(in srgb, currentColor 48%, transparent);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .att-file-btn:hover,
  .att-link-btn:hover { color: inherit; }
  .att-file-btn.busy { opacity: .45; pointer-events: none; cursor: default; }
  #status {
    font-variant-numeric: tabular-nums;
    min-height: 1.1em;
  }
  .att-link-wrap {
    flex: 1 1 10rem; min-width: 0;
    display: flex; align-items: center;
  }
  .att-link-wrap:not([data-open="1"]) .att-url { display: none; }
  .att-link-wrap[data-open="1"] {
    flex: 1 1 100%;
  }
  .att-link-wrap[data-open="1"] .att-link-btn { display: none; }
  .att-add input.att-url {
    flex: 1 1 auto; width: 100%; min-width: 0; font-size: 16px;
    padding: .45rem .55rem; border-radius: .35rem;
    border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    background: transparent; color: inherit;
  }
  .att-add input.att-url:focus {
    outline: none;
    border-color: color-mix(in srgb, currentColor 36%, transparent);
  }
  .att-image img {
    display: block; max-width: min(100%, 22rem); max-height: 14rem;
    margin: .25rem 0; border-radius: .35rem;
  }
  .att-missing { opacity: .45; text-decoration: line-through; }
  .att-thumb {
    display: block; width: 1.65rem; height: 1.65rem; object-fit: cover;
    border-radius: .25rem; flex: 0 0 auto;
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
  .att-icon {
    flex: 0 0 auto; width: 1.1rem; text-align: center;
    opacity: .35; font-size: .8rem; user-select: none;
  }
  @media (max-width: 640px) {
    .att-row { min-height: 2.5rem; }
    .att-link-wrap[data-open="1"] { flex: 1 1 100%; }
  }
  code, kbd, .ui { font-family: -apple-system, system-ui, sans-serif; }
  button { font: inherit; color: inherit; }
  input[type=text] {
    width: 100%; font: inherit; font-size: 1rem; padding: .55rem .7rem;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: .4rem; background: transparent;
  }
  input:focus, .outliner:focus-within { outline: none;
    border-color: color-mix(in srgb, currentColor 45%, transparent); }
  /* passage reference autocomplete (home search) */
  .ref-search { position: relative; }
  .ref-search form { margin: 0; }
  .ref-search input[type=text] { margin: 0; display: block; }
  .ref-search input[aria-expanded="true"] {
    border-radius: .4rem .4rem 0 0;
  }
  .ref-suggest {
    position: absolute; left: 0; right: 0; top: 100%; z-index: 40;
    margin: 0; padding: 0; list-style: none;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    border-top: 0;
    border-radius: 0 0 .45rem .45rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 .4rem 1.25rem color-mix(in srgb, currentColor 10%, transparent);
    max-height: min(16rem, 50vh); overflow-y: auto;
  }
  .ref-suggest[hidden] { display: none; }
  .ref-suggest li { margin: 0; }
  .ref-suggest button {
    display: flex; align-items: baseline; justify-content: space-between; gap: .75rem;
    width: 100%; margin: 0; padding: .55rem .75rem;
    border: 0; background: transparent; cursor: pointer;
    font: inherit; font-size: .95rem; color: inherit; text-align: left;
    -webkit-tap-highlight-color: transparent;
  }
  .ref-suggest button:hover,
  .ref-suggest li[aria-selected="true"] button {
    background: color-mix(in srgb, currentColor 7%, transparent);
  }
  .ref-suggest .rs-label { font-weight: 500; }
  .ref-suggest .rs-kind {
    flex: 0 0 auto; font-size: .75rem;
    color: color-mix(in srgb, currentColor 42%, transparent);
    text-transform: lowercase;
  }
  @media (prefers-color-scheme: dark) {
    .ref-suggest { background: color-mix(in srgb, #1c1c1e 94%, transparent); }
  }
  .muted { color: color-mix(in srgb, currentColor 48%, transparent); font-size: .88rem; }
  /* ghost text control — matches muted header links (reader expand notes, etc.) */
  button.text-btn {
    margin: 0; padding: 0; border: 0; background: transparent;
    font: inherit; color: inherit; cursor: pointer;
    text-align: left; appearance: none; -webkit-appearance: none;
  }
  button.text-btn:hover { color: inherit; }
  button.text-btn[hidden] { display: none; }
  .ui { font-family: -apple-system, system-ui, sans-serif; font-size: .88rem; }
  .login {
    max-width: 20rem; margin: 3rem auto 2rem; padding: 0 .5rem;
    font-family: -apple-system, system-ui, sans-serif;
  }
  .login h1 { font-size: 1.4rem; font-weight: 650; margin: 0 0 .4rem; letter-spacing: -.025em; }
  .login .lead { margin: 0 0 1.5rem; line-height: 1.4;
    color: color-mix(in srgb, currentColor 52%, transparent); font-size: .95rem; }
  .login-form { display: flex; flex-direction: column; gap: .6rem; margin: 0; }
  .login-form label {
    font-size: .8rem; font-weight: 500;
    color: color-mix(in srgb, currentColor 48%, transparent);
  }
  .login-form input[type=text] {
    width: 100%; font-size: 16px; padding: .7rem .8rem;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    border-radius: .55rem; background: transparent; color: inherit;
  }
  .login-form input:focus {
    outline: none; border-color: color-mix(in srgb, currentColor 40%, transparent);
  }
  /* solid primary — high contrast, not washed grey */
  .login-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 100%; box-sizing: border-box;
    margin: 0; padding: .8rem 1.1rem; min-height: 2.9rem;
    font: inherit; font-size: .95rem; font-weight: 600;
    border: 0; border-radius: .55rem; cursor: pointer;
    text-decoration: none; text-align: center;
    background: #111; color: #fff;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .login-btn:hover { background: #000; color: #fff; }
  .login-btn:active { transform: scale(.99); }
  @media (prefers-color-scheme: dark) {
    .login-btn { background: #f2f2f2; color: #111; }
    .login-btn:hover { background: #fff; color: #111; }
  }
  .login-error {
    margin: 0 0 1rem; padding: .65rem .75rem; border-radius: .45rem;
    font-size: .9rem; line-height: 1.35;
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
  .login-more {
    margin: 1.35rem 0 0; font-size: .85rem; line-height: 1.45;
    color: color-mix(in srgb, currentColor 48%, transparent);
  }
  .login-more summary {
    cursor: pointer; list-style: none;
    color: color-mix(in srgb, currentColor 55%, transparent);
  }
  .login-more summary::-webkit-details-marker { display: none; }
  .login-more summary:hover { color: inherit; }
  .login-more .login-form { margin-top: .85rem; }
  .login-more p { margin: .65rem 0 0; }
  /* Share bookplate — overlay; key + seal QR + actions; no layout shift */
  .door-share-wrap {
    position: relative; display: inline-block; max-width: 100%;
    vertical-align: baseline;
    font-family: -apple-system, system-ui, sans-serif;
  }
  .door-share {
    display: inline-flex; align-items: center; gap: .3rem;
    margin: 0; padding: .15rem .35rem; border: 0; border-radius: .2rem;
    background: transparent; cursor: pointer;
    font: inherit; font-family: inherit;
    font-size: .82rem; letter-spacing: .01em;
    color: color-mix(in srgb, currentColor 48%, transparent);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    max-width: 100%;
  }
  .door-share:hover { color: inherit; background: color-mix(in srgb, currentColor 6%, transparent); }
  .door-share:active { transform: scale(.98); }
  .door-share:focus-visible {
    outline: 2px solid color-mix(in srgb, currentColor 35%, transparent);
    outline-offset: 2px;
  }
  .door-share-key {
    font-variant-ligatures: none;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: min(14rem, 42vw);
  }
  .door-share-hint {
    flex: 0 0 auto; font-size: .72rem; opacity: .65; line-height: 1;
  }
  /* Ghost chip holds header space while the panel floats above */
  .door-share-wrap[data-open="1"] > .door-share {
    visibility: hidden; pointer-events: none;
  }
  .door-share-panel {
    position: absolute; right: 0; top: 0; z-index: 60;
    width: 12.5rem;
    padding: .65rem .65rem .6rem;
    border-radius: .12rem;
    border: 1px solid color-mix(in srgb, #2a241c 16%, transparent);
    background: #f6f1e7;
    color: #1c1915;
    box-shadow:
      0 .05rem 0 color-mix(in srgb, #2a241c 6%, transparent),
      0 .55rem 1.6rem color-mix(in srgb, #1c1915 18%, transparent);
    animation: door-share-in 170ms cubic-bezier(.2, .8, .2, 1) both;
  }
  .door-share-panel[hidden] { display: none; animation: none; }
  @keyframes door-share-in {
    from { opacity: 0; transform: translateY(-.2rem) scale(.98); }
    to   { opacity: 1; transform: none; }
  }
  .door-share-head {
    display: flex; align-items: flex-start; gap: .35rem;
    margin: 0 0 .55rem;
  }
  .door-share-title {
    flex: 1 1 auto; min-width: 0;
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    font-size: .88rem; font-weight: 600;
    letter-spacing: -.015em; line-height: 1.2;
    color: inherit;
    white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .door-share-x {
    flex: 0 0 auto;
    margin: -.15rem -.2rem 0 0; padding: .2rem .35rem;
    border: 0; border-radius: .15rem;
    background: transparent; cursor: pointer;
    font: inherit; font-size: .95rem; line-height: 1;
    color: color-mix(in srgb, currentColor 42%, transparent);
    -webkit-tap-highlight-color: transparent;
  }
  .door-share-x:hover { color: inherit; background: color-mix(in srgb, currentColor 7%, transparent); }
  .door-share-x:focus-visible {
    outline: 2px solid color-mix(in srgb, currentColor 35%, transparent);
    outline-offset: 1px;
  }
  .door-share-qr {
    display: flex; align-items: center; justify-content: center;
    width: 100%; aspect-ratio: 1; margin: 0; padding: 0;
    border: 1px solid color-mix(in srgb, #2a241c 12%, transparent);
    border-radius: .08rem;
    background: #fff;
    overflow: hidden;
  }
  .door-share-qr svg {
    display: block; width: 100%; height: 100%;
  }
  .door-share-qr[aria-busy="true"] {
    min-height: 8.5rem;
    background:
      linear-gradient(90deg,
        color-mix(in srgb, #2a241c 5%, #fff) 25%,
        color-mix(in srgb, #2a241c 9%, #fff) 50%,
        color-mix(in srgb, #2a241c 5%, #fff) 75%);
    background-size: 200% 100%;
    animation: door-share-shimmer 1.1s ease-in-out infinite;
  }
  @keyframes door-share-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }
  .door-share-actions {
    display: flex; flex-direction: column; align-items: stretch;
    gap: .3rem; margin-top: .55rem;
  }
  .door-share-action {
    display: inline-flex; align-items: center; justify-content: center;
    width: 100%; box-sizing: border-box;
    margin: 0; padding: .48rem .6rem; min-height: 2.05rem;
    font: inherit; font-size: .82rem; font-weight: 600;
    letter-spacing: .01em;
    border: 1px solid #1c1915; border-radius: .1rem; cursor: pointer;
    background: #1c1915; color: #f6f1e7;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .door-share-action:hover { background: #000; border-color: #000; color: #fff; }
  .door-share-action:active { transform: scale(.99); }
  .door-share-action:focus-visible {
    outline: 2px solid color-mix(in srgb, #1c1915 45%, transparent);
    outline-offset: 2px;
  }
  .door-share-action[data-flash="1"] { opacity: .8; }
  .door-share-copy {
    display: inline-flex; align-items: center; justify-content: center;
    width: 100%; margin: 0; padding: .25rem .4rem;
    border: 0; border-radius: .1rem; cursor: pointer;
    background: transparent;
    font: inherit; font-size: .76rem; font-weight: 500;
    color: color-mix(in srgb, #1c1915 52%, transparent);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, #1c1915 22%, transparent);
    text-underline-offset: .14em;
    -webkit-tap-highlight-color: transparent;
  }
  .door-share-copy:hover {
    color: #1c1915;
    text-decoration-color: color-mix(in srgb, #1c1915 48%, transparent);
  }
  .door-share-copy:focus-visible {
    outline: 2px solid color-mix(in srgb, #1c1915 35%, transparent);
    outline-offset: 1px;
  }
  .door-share-copy[data-flash="1"] { color: #1c1915; }
  @media (prefers-color-scheme: dark) {
    .door-share-panel {
      background: #1a1814;
      color: #ece6db;
      border-color: color-mix(in srgb, #ece6db 14%, transparent);
      box-shadow:
        0 .05rem 0 color-mix(in srgb, #000 35%, transparent),
        0 .6rem 1.7rem color-mix(in srgb, #000 45%, transparent);
    }
    .door-share-qr {
      background: #fff;
      border-color: color-mix(in srgb, #ece6db 10%, transparent);
    }
    .door-share-action {
      background: #ece6db; color: #1a1814; border-color: #ece6db;
    }
    .door-share-action:hover { background: #fff; border-color: #fff; color: #111; }
    .door-share-action:focus-visible {
      outline-color: color-mix(in srgb, #ece6db 50%, transparent);
    }
    .door-share-copy { color: color-mix(in srgb, #ece6db 55%, transparent); }
    .door-share-copy:hover { color: #ece6db; }
  }
  @media (prefers-reduced-motion: reduce) {
    .door-share-panel { animation: none; }
    .door-share-qr[aria-busy="true"] { animation: none; }
  }
  .crypto-bar {
    display: flex; flex-wrap: wrap; align-items: center; gap: .65rem 1rem;
    margin: 0 0 1rem; padding: .45rem 0 .55rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    font-size: .82rem;
    color: color-mix(in srgb, currentColor 50%, transparent);
  }
  .crypto-bar[data-on="1"] { color: color-mix(in srgb, currentColor 62%, transparent); }
  .crypto-status { flex: 1 1 12rem; min-width: 0; line-height: 1.35; }
  .crypto-btn {
    border: 0; background: transparent; padding: .2rem 0; cursor: pointer;
    font: inherit; color: color-mix(in srgb, currentColor 48%, transparent);
  }
  .crypto-btn:hover { color: inherit; }
  .crypto-lock {
    margin: 2rem 0; padding: 1.25rem 0;
    font-family: -apple-system, system-ui, sans-serif;
  }
  .crypto-lock h2 { font-size: 1.05rem; margin: 0 0 .5rem; font-weight: 600; }
  .crypto-lock p { margin: 0 0 .85rem; color: color-mix(in srgb, currentColor 55%, transparent); max-width: 28rem; line-height: 1.45; }
  .crypto-lock input {
    width: min(100%, 20rem); font-size: 16px; padding: .55rem .65rem;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: .35rem; background: transparent; color: inherit;
  }
  .crypto-lock button {
    margin-left: .4rem; padding: .55rem .85rem; font-size: .88rem;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: .35rem; background: transparent; cursor: pointer; color: inherit;
    min-height: 2.6rem;
  }
  header { display: flex; align-items: baseline; gap: .55rem; flex-wrap: wrap; margin-bottom: 1.75rem;
    row-gap: .35rem; }
  header h1 { font-size: 1.2rem; font-weight: 600; margin: 0; letter-spacing: -.01em;
    min-width: 0; flex: 1 1 auto; }
  #status { margin-left: auto; font-size: .8rem; color: color-mix(in srgb, currentColor 45%, transparent); }
  h2 { font-size: .9rem; font-weight: 600; margin: 1.75rem 0 .4rem;
       font-family: -apple-system, system-ui, sans-serif; }
  /* Home list: flat by default; indent via --depth for chapter → verse folders */
  .note-tree { margin-top: .15rem; }
  .note-row {
    display: flex; align-items: flex-start; gap: .15rem;
    padding: .55rem 0; padding-left: calc(var(--depth, 0) * 1.15rem);
    color: inherit;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  }
  .note-row:hover { background: color-mix(in srgb, currentColor 4%, transparent);
    margin: 0 -.35rem; padding-left: calc(var(--depth, 0) * 1.15rem + .35rem);
    padding-right: .35rem; border-radius: .25rem; }
  .note-row .nt-main {
    flex: 1 1 auto; min-width: 0; color: inherit;
    display: block; text-align: left;
  }
  .note-row .nt-main.nt-fold,
  .note-row .nt-main.nt-open-read { cursor: pointer; }
  .note-row .nt-top {
    display: flex; align-items: center; gap: .35rem; min-width: 0;
  }
  .note-row .nt-top .ref {
    flex: 1 1 auto; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .note-row .nt-meta {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: .12rem;
    margin-left: auto;
  }
  .note-row .nt-time { font-size: .8rem; margin-left: .2rem; white-space: nowrap; }
  .note-row .nt-ex { margin-top: .1rem; }
  .note-row.is-folder .ref,
  .note-row.is-chapter .ref { font-weight: 600; }
  .note-row.is-folder .nt-ex,
  .note-row.is-chapter .nt-ex { font-size: .85rem; }
  .nt-act {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.25rem; height: 1.25rem; border-radius: .2rem;
    color: inherit; opacity: .38; text-decoration: none;
  }
  .nt-act:hover { opacity: .9; background: color-mix(in srgb, currentColor 8%, transparent); }
  .nt-act svg { display: block; }
  .nt-chev {
    flex: 0 0 auto; width: 1.35rem; height: 1.35rem; margin-top: .05rem;
    padding: 0; border: 0; background: transparent; color: inherit;
    cursor: pointer; border-radius: .25rem;
    display: inline-flex; align-items: center; justify-content: center;
    opacity: .45; font-size: .7rem; line-height: 1;
    transition: transform .12s ease, opacity .12s ease;
  }
  .nt-chev:not(.is-leaf)::before { content: "\\25BE"; } /* ▾ */
  .nt-chev.is-leaf { visibility: hidden; cursor: default; pointer-events: none; }
  .nt-chev:not(.is-leaf):hover { opacity: .85; background: color-mix(in srgb, currentColor 6%, transparent); }
  .nt-node.is-collapsed > .note-row .nt-chev { transform: rotate(-90deg); }
  .nt-node.is-collapsed > .nt-kids { display: none; }
  .ref { font-weight: 600; margin-right: .4rem; }
  kbd {
    font-family: inherit; font-size: .8em; padding: .05rem .3rem;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: .25rem;
  }

  /* reading: scripture primary; notes hide until the verse is opened */
  .verse {
    --v-pad-y: .34rem;
    --v-pad-x: .75rem;
    --v-gutter: .72rem; /* left rail only — never overlaps verse text */
    position: relative;
    padding: var(--v-pad-y) var(--v-pad-x) var(--v-pad-y) var(--v-pad-x);
    margin-left: 0;
    cursor: pointer;
  }
  /* .hl marks deep-link targets (scroll / open notes); selection owns the surface */
  /*
   * Multi-verse selection = one continuous surface.
   * --sel-x is the single horizontal inset for scripture AND the passage note.
   * Deep-links (single or multi) reuse this chrome via paintSelection.
   */
  .verse.sel {
    --sel-fill: color-mix(in srgb, currentColor 6.5%, transparent);
    --sel-edge: color-mix(in srgb, currentColor 11%, transparent);
    --sel-x: .75rem;
    --sel-y: .36rem;
    --sel-radius: .45rem;
    background: var(--sel-fill);
    padding: var(--sel-y) var(--sel-x);
    margin-left: 0;
  }
  .verse.sel.sel-lo { border-radius: var(--sel-radius) var(--sel-radius) 0 0; }
  .verse.sel.sel-hi { border-radius: 0 0 var(--sel-radius) var(--sel-radius); }
  .verse.sel.sel-lo.sel-hi { border-radius: var(--sel-radius); }
  /*
   * Note open on end verse: keep the *outer* bottom curve on .sel-hi and clip
   * children to it — never zero the radius under a rounded tray (square shows through).
   */
  .verse.sel.sel-hi.notes-open,
  .verse.sel.sel-hi.editing {
    padding-bottom: 0;
    overflow: hidden;
  }
  /* full-bleed within the card: cancel --sel-x, then re-apply so note text matches verse text */
  .verse.sel .vnotes {
    background: var(--sel-fill);
    margin: .28rem calc(-1 * var(--sel-x)) 0;
    padding: .5rem var(--sel-x) .55rem;
    border-top: 1px solid var(--sel-edge);
    border-radius: 0; /* curve lives on .sel-hi only */
  }
  body.selecting-verses { user-select: none; -webkit-user-select: none; cursor: pointer; }
  body.pick-range-end .verse { cursor: cell; }
  /*
   * Note presence: thin left rail, outside verse text.
   * Contiguous has-notes verses share one continuous bar; only an isolated
   * single verse (or the ends of a run) get a short/rounded segment.
   * Passage/range cover = quieter rail; individual verse note = stronger color
   * (even mid-run when connected to a passage).
   * Hidden once notes are open (the note itself is the cue).
   */
  .verse.has-notes:not(.notes-open):not(.editing)::before {
    content: "";
    position: absolute;
    left: 0;
    top: var(--v-pad-y, .34rem);
    bottom: var(--v-pad-y, .34rem);
    width: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, currentColor 22%, transparent);
    pointer-events: none;
  }
  .verse.has-verse-note:not(.notes-open):not(.editing)::before {
    background: color-mix(in srgb, currentColor 55%, transparent);
  }
  .verse.sel.has-notes:not(.notes-open):not(.editing)::before {
    top: var(--sel-y, .36rem);
    bottom: var(--sel-y, .36rem);
  }
  /* Join into next closed has-notes verse */
  .verse.has-notes:not(.notes-open):not(.editing):has(+ .verse.has-notes:not(.notes-open):not(.editing))::before {
    bottom: 0;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  /* Join from previous closed has-notes verse */
  .verse.has-notes:not(.notes-open):not(.editing) + .verse.has-notes:not(.notes-open):not(.editing)::before {
    top: 0;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
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
    margin: .35rem 0 .45rem 0;
    padding-left: 0;
  }
  .verse:not(.sel).notes-open .vnotes,
  .verse:not(.sel).editing .vnotes {
    margin-left: .35rem;
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
  /* range address: quiet meta above the editor — scope stays obvious while writing */
  .note[data-kind="range"] {
    margin: 0;
  }
  .note[data-kind="range"] .note-label {
    display: flex;
    align-items: baseline;
    gap: .4rem;
    flex-wrap: wrap;
    font-family: -apple-system, system-ui, sans-serif;
    font-size: .78rem;
    font-weight: 550;
    letter-spacing: .01em;
    color: color-mix(in srgb, currentColor 62%, transparent);
    margin: 0 0 .4rem;
    line-height: 1.3;
  }
  .note[data-kind="range"] .note-label::before {
    content: "Passage";
    flex: 0 0 auto;
    font-size: .65rem;
    font-weight: 650;
    letter-spacing: .07em;
    text-transform: uppercase;
    color: color-mix(in srgb, currentColor 42%, transparent);
  }
  .note-meta { margin: .2rem 0 0; font-size: .8rem;
    color: color-mix(in srgb, currentColor 45%, transparent); }
  .note-edit { margin: .05rem 0 0; }
  /* range editor sits inside the selection surface — tighten chrome */
  .note[data-kind="range"] .note-edit .outliner-shell.compact .otoolbar {
    margin-top: .4rem;
    padding-top: .3rem;
    border-top-color: color-mix(in srgb, currentColor 9%, transparent);
  }
  .note[data-kind="range"] .note-edit .otool-btn {
    font-size: .8rem;
    color: color-mix(in srgb, currentColor 42%, transparent);
  }
  .note.editing .note-body { display: none; }
  /* hide generic labels while editing; range labels stay (scope must remain obvious) */
  .note.editing:not([data-kind="range"]) .note-label { display: none; }
  .note .note-body { cursor: text; }
  .note .note-label { cursor: text; }
  .note[data-kind="range"] .note-label { cursor: default; }

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
  .note-group.passage .note[data-kind="range"] { margin: 0; }
  /* range note when tray is open without selection (rare) — still a quiet card */
  .verse:not(.sel) .note[data-kind="range"] {
    padding: .5rem .65rem .45rem;
    border-radius: .4rem;
    background: color-mix(in srgb, currentColor 4.5%, transparent);
  }

  /* chapter note sits above scripture — outline only, no redundant label/link */
  .chapter-note {
    margin: 0 0 1.1rem;
    padding: 0 0 1rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  }
  .chapter-note .note { margin: 0; }
  /* related notes (Within / Part of / Overlaps) — clear hierarchy */
  .related {
    margin: 1.65rem 0 0;
    padding-top: 1.15rem;
    border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    font-family: -apple-system, system-ui, sans-serif;
  }
  .related + .related {
    margin-top: 1.25rem;
  }
  .related-label {
    margin: 0 0 .15rem;
    font-size: .7rem;
    font-weight: 650;
    letter-spacing: .07em;
    text-transform: uppercase;
    color: color-mix(in srgb, currentColor 42%, transparent);
  }
  .related-sub {
    margin: 0 0 .65rem;
    font-size: .82rem;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    color: color-mix(in srgb, currentColor 48%, transparent);
    line-height: 1.35;
  }
  .inbox { margin: 0; display: flex; flex-direction: column; gap: .4rem; }

  /* Within = contained notes: primary cards */
  .related-within .inbox-item {
    display: block; text-decoration: none; color: inherit;
    padding: .7rem .8rem;
    border-radius: .45rem;
    border: 1px solid color-mix(in srgb, currentColor 11%, transparent);
    background: transparent;
  }
  .related-within .inbox-item:hover {
    background: color-mix(in srgb, currentColor 4%, transparent);
    border-color: color-mix(in srgb, currentColor 18%, transparent);
  }
  .related-within .inbox-title {
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    font-size: 1.02rem; font-weight: 600;
  }
  .related-within .inbox-excerpt {
    margin: .3rem 0 0;
    font-size: .9rem;
    color: color-mix(in srgb, currentColor 52%, transparent);
    line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Part of = parents: quieter compact links */
  .related-parent .inbox {
    gap: .2rem;
  }
  .related-parent .inbox-item {
    display: block; text-decoration: none; color: inherit;
    padding: .45rem .55rem;
    border-radius: .35rem;
    border: 0;
    background: color-mix(in srgb, currentColor 4%, transparent);
  }
  .related-parent .inbox-item:hover {
    background: color-mix(in srgb, currentColor 7%, transparent);
  }
  .related-parent .inbox-title {
    font-size: .95rem; font-weight: 550;
    color: color-mix(in srgb, currentColor 78%, transparent);
  }
  .related-parent .inbox-excerpt {
    margin: .1rem 0 0;
    font-size: .82rem;
    color: color-mix(in srgb, currentColor 42%, transparent);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .related-parent .inbox-excerpt.is-empty {
    font-style: italic;
    opacity: .75;
  }

  /* Overlaps = peer ranges: between the two */
  .related-overlap .inbox-item {
    display: block; text-decoration: none; color: inherit;
    padding: .55rem .65rem;
    border-radius: .4rem;
    border-left: 2px solid color-mix(in srgb, currentColor 18%, transparent);
    background: color-mix(in srgb, currentColor 3%, transparent);
  }
  .related-overlap .inbox-item:hover {
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
  .related-overlap .inbox-title { font-size: .98rem; font-weight: 600; }
  .related-overlap .inbox-excerpt {
    margin: .2rem 0 0;
    font-size: .86rem;
    color: color-mix(in srgb, currentColor 48%, transparent);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .inbox-top {
    display: flex; align-items: baseline; gap: .4rem; flex-wrap: wrap;
  }
  .inbox-kind {
    font-size: .72rem;
    font-weight: 500;
    letter-spacing: .02em;
    color: color-mix(in srgb, currentColor 40%, transparent);
  }

  /*
   * One indent geometry everywhere (read outline + edit outliner):
   *   chevron | bullet | text; depth via margin-left.
   */
  .outline, .outliner {
    --note-gutter: 1.25rem;
    --chev-w: 0.95rem;
    --bullet: 0.4375rem;
    --row-h: 1.55em;
  }
  .outline { margin: 0; padding: 0; display: block; }
  .oline {
    display: grid;
    grid-template-columns: var(--chev-w) var(--note-gutter) minmax(0, 1fr);
    align-items: start;
    box-sizing: border-box;
    width: 100%;
    min-height: var(--row-h);
    padding: 0;
    margin: 0 0 0 calc(var(--depth, 0) * var(--note-gutter));
    line-height: 1.45;
    position: relative;
  }
  .oline .ochev {
    width: var(--chev-w); height: var(--row-h);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none;
    color: color-mix(in srgb, currentColor 40%, transparent);
    font-size: .65rem; user-select: none;
  }
  .oline.has-kids .ochev { pointer-events: auto; cursor: pointer; }
  .oline.has-kids:hover .ochev,
  .oline.collapsed .ochev { opacity: 1; }
  .oline .ochev::before { content: "\\25B8"; transition: transform .12s ease; }
  .oline.collapsed .ochev::before { content: "\\25B8"; }
  .oline:not(.collapsed).has-kids .ochev::before { content: "\\25BE"; }
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
  .oline.collapsed.has-kids .odot::before {
    box-shadow: 0 0 0 1.5px color-mix(in srgb, currentColor 32%, transparent);
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .oline .otxt {
    display: block;
    min-height: var(--row-h);
    padding: 0.15em 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* base inline markdown (markers stored in text; rendered in view mode) */
  .md-strong { font-weight: 650; }
  .md-em { font-style: italic; }
  .md-strike { text-decoration: line-through; opacity: .85; }
  .md-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: .88em;
    padding: .08em .32em;
    border-radius: .28rem;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
  .md-link {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 28%, transparent);
    text-underline-offset: .12em;
  }
  .md-link:hover { text-decoration-color: currentColor; }
  .otext.view .md-code,
  .otxt .md-code { font-size: .86em; }
  .otext.view {
    cursor: text;
    min-height: var(--row-h, 1.55em);
  }
  /* wiki / md links stay clickable in view mode; rest of line enters edit */
  .otext.view a {
    pointer-events: auto;
    position: relative;
    z-index: 1;
  }
  .otxt a { pointer-events: auto; }
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
  .outliner { padding: .1rem 0; position: relative; }
  .outliner.page { min-height: 40vh; }
  .outliner.selecting { user-select: none; }
  .oblock {
    display: grid;
    grid-template-columns: var(--chev-w) var(--note-gutter) minmax(0, 1fr);
    align-items: start;
    min-height: var(--row-h);
    /* indent via padding (not margin) so hover/selection is a flush full-width band */
    padding: 0.05rem 0 0.05rem calc(var(--depth, 0) * var(--note-gutter));
    margin: 0;
    border-radius: 0;
    position: relative;
  }
  .oblock:hover { background: color-mix(in srgb, currentColor 3.5%, transparent); }
  .oblock.selected {
    background: color-mix(in srgb, currentColor 9%, transparent);
    border-radius: 0;
  }
  .oblock.dragging { opacity: .35; }
  .oblock .ochev {
    width: var(--chev-w); height: var(--row-h);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; border: 0; background: transparent; padding: 0;
    color: color-mix(in srgb, currentColor 45%, transparent);
    font-size: .65rem; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .oblock.has-kids .ochev { pointer-events: auto; }
  .oblock.has-kids:hover .ochev,
  .oblock.collapsed .ochev,
  .oblock.has-kids .ochev:focus-visible { opacity: 1; }
  .oblock .ochev::before { content: "\\25BE"; }
  .oblock.collapsed .ochev::before { content: "\\25B8"; }
  .obullet {
    width: var(--note-gutter); height: var(--row-h);
    display: flex; align-items: center; justify-content: center;
    user-select: none; cursor: grab; touch-action: none;
  }
  .obullet:active { cursor: grabbing; }
  .obullet::before {
    content: "";
    width: var(--bullet); height: var(--bullet);
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 28%, transparent);
  }
  .oblock.collapsed.has-kids .obullet::before {
    box-shadow: 0 0 0 1.5px color-mix(in srgb, currentColor 34%, transparent);
    background: color-mix(in srgb, currentColor 16%, transparent);
  }
  .otext {
    min-width: 0; min-height: var(--row-h); padding: 0; outline: none;
    white-space: pre-wrap; word-break: break-word; font: inherit;
    line-height: var(--row-h);
    /* 16px minimum prevents iOS focus-zoom */
    font-size: max(1em, 16px);
  }
  .otext:empty::before { content: attr(data-placeholder); opacity: .35; pointer-events: none; }
  .outliner.compact { font-size: .9rem; }
  .outliner.compact .otext { font-size: max(0.9rem, 16px); }
  .odrop {
    position: absolute; left: 0; right: 0; height: 2px;
    background: color-mix(in srgb, currentColor 55%, transparent);
    pointer-events: none; z-index: 5; display: none;
    border-radius: 1px;
  }
  .odrop.show { display: block; }
  .hint { margin-top: .65rem; }

  /* nest / unnest / collapse — same quiet chrome as header links */
  .outliner-shell { margin: 0; }
  .otoolbar {
    display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
    margin: .45rem 0 0;
    padding: .35rem 0 0;
    border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    font-family: -apple-system, system-ui, sans-serif;
  }
  .otool-btn {
    flex: 0 0 auto;
    margin: 0; padding: .15rem 0;
    border: 0; background: transparent;
    font-family: inherit; font-size: .85rem; font-weight: 400;
    color: color-mix(in srgb, currentColor 48%, transparent);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .otool-btn:hover:not(:disabled) { color: inherit; }
  .otool-btn:active:not(:disabled) { opacity: .7; }
  .otool-btn:disabled { opacity: .28; cursor: default; }
  .otool-ico {
    display: inline-block; margin-right: .3rem;
    opacity: .55; font-size: .95em; letter-spacing: -.02em;
  }

  @media (max-width: 640px) {
    body {
      padding-top: 1rem;
      padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
      font-size: 1.02rem;
    }
    header { margin-bottom: 1.5rem; gap: .4rem .55rem; }
    header h1 { font-size: 1.12rem; line-height: 1.25; }
    header a, header .text-btn, #status { font-size: .82rem; }
    input[type=text] { font-size: 16px; padding: .7rem .75rem; }
    .note-row { padding: .7rem 0; min-height: 2.75rem; }
    .nt-act { width: 1.75rem; height: 1.75rem; }
    .related-within .inbox-item { padding: .75rem .85rem; min-height: 2.75rem; }
    .related-parent .inbox-item { min-height: 2.5rem; }
    .verse {
      --v-pad-y: .4rem;
      --v-pad-x: .7rem;
      --v-gutter: .72rem;
    }
    .verse.sel {
      --sel-x: .7rem;
      --sel-y: .4rem;
    }
    .vtext { line-height: 1.5; }
    .outline, .outliner { --note-gutter: 1.15rem; --row-h: 1.7em; }
    .outliner.page { min-height: 30vh; }
    .oblock.has-kids .ochev { opacity: .7; }
    .hint { display: none; }
    .otoolbar {
      position: sticky;
      bottom: 0;
      z-index: 20;
      gap: 0;
      margin: .55rem -0.85rem 0;
      padding: 0 .25rem calc(env(safe-area-inset-bottom, 0px));
      border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
      background: color-mix(in srgb, Canvas 94%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      flex-wrap: nowrap;
    }
    .outliner-shell.compact .otoolbar {
      margin-left: 0; margin-right: 0;
    }
    .otool-btn {
      flex: 1 1 0;
      min-height: 2.85rem;
      padding: .55rem .35rem;
      font-size: .82rem;
      text-align: center;
    }
    .otool-btn + .otool-btn {
      border-left: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    }
    .otool-btn:hover:not(:disabled) {
      background: color-mix(in srgb, currentColor 4%, transparent);
    }
    .related-parent .inbox-excerpt,
    .related-overlap .inbox-excerpt {
      white-space: normal; display: -webkit-box;
      -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
  }

  @media (pointer: coarse) {
    .otool-btn { min-height: 2.5rem; padding: .4rem .35rem; }
    .note-row, .inbox-item { padding-top: .65rem; padding-bottom: .65rem; }
    .oblock.has-kids .ochev { opacity: .65; }
  }
`;

// Shared client outliner — Dotflowy-class fundamentals on flat indent blocks (ADR 0013).
// Enter / Tab / collapse / move / undo / multi-select / drag; markdown source on focus.
const OUTLINER_JS = `
function newId() {
  return "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;" })[c];
  });
}

/** Client twin of formatBlockText (wiki via /go; no attachment embeds in editor). */
function formatBlockHtml(text) {
  var s = String(text == null ? "" : text);
  var i = 0, out = "";
  var base = typeof BASE === "string" ? BASE : "";
  function isWord(ch) { return ch != null && /[A-Za-z0-9]/.test(ch); }
  while (i < s.length) {
    if (s[i] === "\`") {
      var ce = s.indexOf("\`", i + 1);
      if (ce > i + 1 && s.slice(i + 1, ce).indexOf("\\n") < 0) {
        out += '<code class="md-code">' + escHtml(s.slice(i + 1, ce)) + "</code>";
        i = ce + 1; continue;
      }
    }
    if (s[i] === "!" && s[i + 1] === "[" && s[i + 2] === "[") {
      var ee = s.indexOf("]]", i + 3);
      if (ee >= 0 && s.slice(i + 3, ee).indexOf("\\n") < 0) {
        var einner = s.slice(i + 3, ee);
        var epipe = einner.indexOf("|");
        var et = (epipe < 0 ? einner : einner.slice(0, epipe)).trim();
        var elab = epipe < 0 ? et : (einner.slice(epipe + 1).trim() || et);
        if (/^https?:\\/\\//i.test(et)) {
          out += '<a class="md-link" href="' + escHtml(et) + '" target="_blank" rel="noopener noreferrer">' +
            escHtml(elab) + "</a>";
        } else {
          out += escHtml(s.slice(i, ee + 2));
        }
        i = ee + 2; continue;
      }
    }
    if (s[i] === "[" && s[i + 1] === "[") {
      var we = s.indexOf("]]", i + 2);
      if (we >= 0 && s.slice(i + 2, we).indexOf("\\n") < 0) {
        var winner = s.slice(i + 2, we);
        var wpipe = winner.indexOf("|");
        var wt = (wpipe < 0 ? winner : winner.slice(0, wpipe)).trim();
        var wlab = wpipe < 0 ? wt : (winner.slice(wpipe + 1).trim() || wt);
        out += '<a class="wikilink" href="' + base + "/go?q=" + encodeURIComponent(wt) + '">' +
          escHtml(wlab) + "</a>";
        i = we + 2; continue;
      }
    }
    if (s[i] === "[") {
      var mc = s.indexOf("]", i + 1);
      if (mc > i + 1 && s[mc + 1] === "(") {
        var mu = s.indexOf(")", mc + 2);
        if (mu > mc + 2) {
          var mlab = s.slice(i + 1, mc);
          var murl = s.slice(mc + 2, mu).trim();
          if (mlab && mlab.indexOf("\\n") < 0 && /^https?:\\/\\/[^\\s]+$/i.test(murl)) {
            out += '<a class="md-link" href="' + escHtml(murl) + '" target="_blank" rel="noopener noreferrer">' +
              escHtml(mlab) + "</a>";
            i = mu + 1; continue;
          }
        }
      }
    }
    if (s[i] === "*" && s[i + 1] === "*") {
      var be = s.indexOf("**", i + 2);
      if (be > i + 2) {
        var bi = s.slice(i + 2, be);
        if (bi && bi.indexOf("*") < 0 && bi.indexOf("\\n") < 0) {
          out += '<strong class="md-strong">' + escHtml(bi) + "</strong>";
          i = be + 2; continue;
        }
      }
    }
    if (s[i] === "~" && s[i + 1] === "~") {
      var se = s.indexOf("~~", i + 2);
      if (se > i + 2) {
        var si = s.slice(i + 2, se);
        if (si && si.indexOf("~") < 0 && si.indexOf("\\n") < 0) {
          out += '<s class="md-strike">' + escHtml(si) + "</s>";
          i = se + 2; continue;
        }
      }
    }
    if (s[i] === "*" && s[i + 1] !== "*") {
      var ie = s.indexOf("*", i + 1);
      if (ie > i + 1) {
        var ii = s.slice(i + 1, ie);
        if (ii && ii.indexOf("*") < 0 && ii.indexOf("\\n") < 0) {
          out += '<em class="md-em">' + escHtml(ii) + "</em>";
          i = ie + 1; continue;
        }
      }
    }
    if (s[i] === "_") {
      var prev = i > 0 ? s[i - 1] : " ";
      if (!isWord(prev)) {
        var ue = s.indexOf("_", i + 1);
        if (ue > i + 1) {
          var un = ue + 1 < s.length ? s[ue + 1] : " ";
          var ui = s.slice(i + 1, ue);
          if (ui && ui.indexOf("_") < 0 && ui.indexOf("\\n") < 0 && !isWord(un)) {
            out += '<em class="md-em">' + escHtml(ui) + "</em>";
            i = ue + 1; continue;
          }
        }
      }
    }
    var j = i + 1;
    while (j < s.length) {
      var c = s[j];
      if (c === "\`" || c === "[" || c === "*" || c === "~" || c === "_" ||
          (c === "!" && s[j + 1] === "[")) break;
      j++;
    }
    out += escHtml(s.slice(i, j));
    i = j;
  }
  return out;
}

function mountOutliner(host, opts) {
  const slug = opts.slug;
  const statusEl = opts.statusEl || null;
  const compact = !!opts.compact;
  const placeholder = opts.placeholder || "Write\u2026";
  let blocks = (opts.blocks && opts.blocks.length)
    ? opts.blocks.map(b => ({
        id: b.id || newId(),
        indent: b.indent|0,
        text: b.text || "",
        collapsed: !!b.collapsed,
      }))
    : [{ id: newId(), indent: 0, text: "", collapsed: false }];
  let timer = null;
  let inflight = null;
  let dirty = false;
  let activeId = blocks[0] ? blocks[0].id : null;
  let selected = null; // { anchor, focus } ids for multi-select, or null
  let undoStack = [];
  let redoStack = [];
  let typingHistArmed = true;
  let histTimer = null;
  const HIST_MAX = 100;
  // While rebuild DOM, ignore focusout — removing the focused row would otherwise
  // nested-render in view mode and steal focus from Enter/Tab/etc.
  let rebuilding = false;
  let blurTimer = null;
  let alive = true;

  const shell = document.createElement("div");
  shell.className = "outliner-shell" + (compact ? " compact" : "");
  host.replaceWith(shell);
  shell.appendChild(host);

  const toolbar = document.createElement("div");
  toolbar.className = "otoolbar";
  toolbar.innerHTML =
    '<button type="button" class="otool-btn" data-act="outdent" aria-label="Unnest">' +
      '<span class="otool-ico" aria-hidden="true">\u21E4</span>unnest</button>' +
    '<button type="button" class="otool-btn" data-act="indent" aria-label="Nest">' +
      '<span class="otool-ico" aria-hidden="true">\u21E5</span>nest</button>' +
    '<button type="button" class="otool-btn" data-act="collapse" aria-label="Collapse or expand">' +
      '<span class="otool-ico" aria-hidden="true">\u25BE</span>fold</button>';
  shell.appendChild(toolbar);

  const dropLine = document.createElement("div");
  dropLine.className = "odrop";
  host.appendChild(dropLine);

  host.classList.add("outliner");
  if (compact) host.classList.add("compact");
  if (opts.page) host.classList.add("page");
  host.dataset.slug = slug;

  function setStatus(s) { if (statusEl) statusEl.textContent = s; }

  function snap() {
    return blocks.map(b => ({
      id: b.id, indent: b.indent, text: b.text, collapsed: !!b.collapsed,
    }));
  }
  function restore(s) {
    blocks = s.map(b => ({
      id: b.id, indent: b.indent, text: b.text, collapsed: !!b.collapsed,
    }));
  }
  function pushHistory() {
    undoStack.push(snap());
    if (undoStack.length > HIST_MAX) undoStack.shift();
    redoStack = [];
  }
  function undo() {
    if (!undoStack.length) return;
    syncFromDom();
    redoStack.push(snap());
    restore(undoStack.pop());
    selected = null;
    const id = activeId && blocks.some(b => b.id === activeId)
      ? activeId : (blocks[0] && blocks[0].id);
    render(id, null);
    scheduleSave();
  }
  function redo() {
    if (!redoStack.length) return;
    syncFromDom();
    undoStack.push(snap());
    restore(redoStack.pop());
    selected = null;
    const id = activeId && blocks.some(b => b.id === activeId)
      ? activeId : (blocks[0] && blocks[0].id);
    render(id, null);
    scheduleSave();
  }
  function armTypingHistory() {
    typingHistArmed = true;
  }
  function maybeTextHistory() {
    if (typingHistArmed) {
      pushHistory();
      typingHistArmed = false;
    }
    clearTimeout(histTimer);
    histTimer = setTimeout(armTypingHistory, 450);
  }

  function subtreeEnd(i) {
    const base = blocks[i].indent;
    let j = i + 1;
    while (j < blocks.length && blocks[j].indent > base) j++;
    return j;
  }
  function hasChildren(i) {
    return i + 1 < blocks.length && blocks[i + 1].indent > blocks[i].indent;
  }
  function parentIndex(i) {
    const base = blocks[i].indent;
    if (base <= 0) return -1;
    for (let j = i - 1; j >= 0; j--) {
      if (blocks[j].indent === base - 1) return j;
      if (blocks[j].indent < base - 1) return -1;
    }
    return -1;
  }
  function prevSibling(i) {
    const base = blocks[i].indent;
    for (let j = i - 1; j >= 0; j--) {
      if (blocks[j].indent < base) return -1;
      if (blocks[j].indent === base) return j;
    }
    return -1;
  }
  function nextSibling(i) {
    const base = blocks[i].indent;
    const end = subtreeEnd(i);
    if (end < blocks.length && blocks[end].indent === base) return end;
    return -1;
  }
  function isHiddenByCollapse(i) {
    let ind = blocks[i].indent;
    for (let j = i - 1; j >= 0 && ind > 0; j--) {
      if (blocks[j].indent === ind - 1) {
        if (blocks[j].collapsed) return true;
        ind = blocks[j].indent;
      }
    }
    return false;
  }
  function visibleIndices() {
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
      if (!isHiddenByCollapse(i)) out.push(i);
    }
    return out;
  }
  function indexOfId(id) {
    return blocks.findIndex(b => b.id === id);
  }
  function activeIndex() {
    let i = indexOfId(activeId);
    return i < 0 ? 0 : i;
  }
  function clampIndent() {
    for (let i = 0; i < blocks.length; i++) {
      if (i === 0) blocks[i].indent = 0;
      else blocks[i].indent = Math.min(blocks[i].indent, blocks[i - 1].indent + 1);
      blocks[i].indent = Math.max(0, blocks[i].indent);
      if (!hasChildren(i)) blocks[i].collapsed = false;
    }
  }
  function clearSelection() {
    selected = null;
    host.classList.remove("selecting");
  }
  function selectionIds() {
    if (!selected) return [];
    const vis = visibleIndices();
    const ia = vis.indexOf(indexOfId(selected.anchor));
    const ib = vis.indexOf(indexOfId(selected.focus));
    if (ia < 0 || ib < 0) return [];
    const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    return vis.slice(lo, hi + 1).map(i => blocks[i].id);
  }
  function selectionRoots() {
    const ids = selectionIds();
    const set = new Set(ids);
    const roots = [];
    for (const id of ids) {
      const i = indexOfId(id);
      if (i < 0) continue;
      let covered = false;
      let p = parentIndex(i);
      while (p >= 0) {
        if (set.has(blocks[p].id)) { covered = true; break; }
        p = parentIndex(p);
      }
      if (!covered) roots.push(i);
    }
    return roots.sort((a, b) => a - b);
  }

  function refreshToolbar() {
    const i = activeIndex();
    const outBtn = toolbar.querySelector('[data-act="outdent"]');
    const inBtn = toolbar.querySelector('[data-act="indent"]');
    const foldBtn = toolbar.querySelector('[data-act="collapse"]');
    if (outBtn) outBtn.disabled = !blocks[i] || blocks[i].indent <= 0;
    if (inBtn) {
      const max = i === 0 ? 0 : blocks[i - 1].indent + 1;
      inBtn.disabled = !blocks[i] || blocks[i].indent >= max;
    }
    if (foldBtn) foldBtn.disabled = !blocks[i] || !hasChildren(i);
  }

  function serializeBlock(b) {
    const row = { id: b.id, indent: b.indent, text: b.text };
    if (b.collapsed) row.collapsed = true;
    return row;
  }

  function render(focusId, caret, caretX) {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
    if (focusId) activeId = focusId;
    const selSet = new Set(selectionIds());
    if (selected) host.classList.add("selecting");
    else host.classList.remove("selecting");
    const fresh = blocks.length === 1 && !blocks[0].text.trim();

    rebuilding = true;
    // Drop all rows; keep .odrop. Guard stops focusout from nested-rendering.
    const rows = host.querySelectorAll(".oblock");
    for (const r of rows) r.remove();

    for (let i = 0; i < blocks.length; i++) {
      if (isHiddenByCollapse(i)) continue;
      const b = blocks[i];
      const kids = hasChildren(i);
      const row = document.createElement("div");
      row.className = "oblock";
      if (kids) row.classList.add("has-kids");
      if (b.collapsed && kids) row.classList.add("collapsed");
      if (selSet.has(b.id)) row.classList.add("selected");
      row.dataset.id = b.id;
      row.style.setProperty("--depth", String(Math.max(0, b.indent|0)));

      const chev = document.createElement("button");
      chev.type = "button";
      chev.className = "ochev";
      chev.tabIndex = -1;
      chev.setAttribute("aria-label", b.collapsed ? "Expand" : "Collapse");
      if (!kids) chev.style.visibility = "hidden";

      const bullet = document.createElement("span");
      bullet.className = "obullet";
      bullet.title = "Drag to reorder";

      const text = document.createElement("div");
      text.className = "otext";
      text.spellcheck = true;
      text.inputMode = "text";
      text.enterKeyHint = "enter";
      if (fresh) text.dataset.placeholder = placeholder;

      const editing = !selected && b.id === activeId;
      if (editing) {
        text.contentEditable = "true";
        text.classList.remove("view");
        text.textContent = b.text;
      } else {
        text.contentEditable = "false";
        text.classList.add("view");
        if (b.text && b.text.trim()) text.innerHTML = formatBlockHtml(b.text);
        else text.textContent = "";
      }

      row.appendChild(chev);
      row.appendChild(bullet);
      row.appendChild(text);
      host.insertBefore(row, dropLine);
    }

    if (focusId && !selected) {
      const el = host.querySelector('.oblock[data-id="' + CSS.escape(focusId) + '"] .otext');
      if (el && el.isContentEditable) {
        el.focus({ preventScroll: true });
        if (caretX != null && typeof caretX === "number") {
          placeCaretAtX(el, caretX);
        } else {
          placeCaret(el, caret == null ? endOf(el) : caret);
        }
      }
    }
    rebuilding = false;
    refreshToolbar();
  }

  function endOf(el) {
    return (el.textContent || "").length;
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

  function placeCaretAtX(el, x) {
    const text = el.textContent || "";
    if (!text) { placeCaret(el, 0); return; }
    // binary search offset by caret x
    let lo = 0, hi = text.length, best = 0, bestDist = Infinity;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      placeCaret(el, mid);
      const rect = caretLineRect();
      if (!rect) { best = mid; break; }
      const dist = Math.abs(rect.left - x);
      if (dist < bestDist) { bestDist = dist; best = mid; }
      if (rect.left < x) lo = mid + 1;
      else hi = mid - 1;
    }
    placeCaret(el, best);
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

  function caretLineRect() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (rect.height === 0) {
      const first = range.getClientRects()[0];
      if (first) rect = first;
    }
    return rect.height === 0 ? null : rect;
  }
  function atLineStart(el) {
    const rect = caretLineRect();
    if (!rect) return true;
    return rect.top - el.getBoundingClientRect().top < rect.height / 2;
  }
  function atLineEnd(el) {
    const rect = caretLineRect();
    if (!rect) return true;
    return el.getBoundingClientRect().bottom - rect.bottom < rect.height / 2;
  }
  function isCaretAtStart(el) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return false;
    return caretOffset(el) === 0;
  }
  function isCaretAtEnd(el) {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.rangeCount) return false;
    return caretOffset(el) === (el.textContent || "").length;
  }

  function syncFromDom() {
    const rows = host.querySelectorAll(".oblock");
    for (const row of rows) {
      const b = blocks.find(x => x.id === row.dataset.id);
      const el = row.querySelector(".otext");
      if (b && el && el.isContentEditable) {
        b.text = el.textContent.replace(/\u00a0/g, " ");
      }
    }
  }

  function scheduleSave() {
    dirty = true;
    setStatus("\u2026");
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  }

  async function save() {
    syncFromDom();
    let payload = {
      blocks: blocks.map(serializeBlock),
    };
    try {
      if (typeof VP_CRYPTO !== "undefined" && VP_CRYPTO.hasPassphrase()) {
        const atts = (opts.getAttachments && opts.getAttachments()) || opts.attachments || [];
        const cipher = await VP_CRYPTO.encryptPayload({
          blocks: payload.blocks,
          attachments: atts,
        }, VP_CRYPTO.getPassphrase());
        payload = { encrypted: true, cipher };
      }
    } catch (err) {
      setStatus("encrypt error");
      return;
    }
    if (inflight) await inflight;
    inflight = fetch((typeof BASE === "string" ? BASE : "") + "/api/note/" + slug, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        if (!r.ok) { setStatus("error"); return; }
        const data = await r.json().catch(() => null);
        if (data && data.deleted) setStatus("cleared");
        else setStatus(payload.encrypted ? "saved \u00b7 encrypted" : "saved");
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
    const end = subtreeEnd(i);
    for (let j = i; j < end; j++) blocks[j].indent += delta;
    return true;
  }

  function applyIndent(delta) {
    syncFromDom();
    pushHistory();
    if (selected) {
      const roots = selectionRoots();
      if (delta > 0) {
        for (let k = roots.length - 1; k >= 0; k--) indentBlock(roots[k], 1);
      } else {
        for (const r of roots) indentBlock(r, -1);
      }
      clampIndent();
      render(null);
      scheduleSave();
      return;
    }
    const i = activeIndex();
    const focusEl = document.activeElement;
    const caret = (focusEl && focusEl.classList && focusEl.classList.contains("otext"))
      ? caretOffset(focusEl) : endOf({ textContent: blocks[i] ? blocks[i].text : "" });
    if (!indentBlock(i, delta)) {
      undoStack.pop();
      refreshToolbar();
      return;
    }
    clampIndent();
    render(blocks[i].id, caret);
    scheduleSave();
  }

  function toggleCollapsed(i, force) {
    if (i < 0 || !hasChildren(i)) return false;
    pushHistory();
    if (force === true) blocks[i].collapsed = true;
    else if (force === false) blocks[i].collapsed = false;
    else blocks[i].collapsed = !blocks[i].collapsed;
    return true;
  }

  function moveUp(i) {
    if (i < 0) return false;
    const prev = prevSibling(i);
    if (prev >= 0) {
      const end = subtreeEnd(i);
      const chunk = blocks.splice(i, end - i);
      blocks.splice(prev, 0, ...chunk);
      return true;
    }
    const p = parentIndex(i);
    if (p < 0) return false;
    const uncle = prevSibling(p);
    if (uncle < 0) return false;
    const end = subtreeEnd(i);
    const chunk = blocks.splice(i, end - i);
    const delta = (blocks[uncle].indent + 1) - chunk[0].indent;
    for (const b of chunk) b.indent = Math.max(0, b.indent + delta);
    const insertAt = subtreeEnd(uncle);
    blocks.splice(insertAt, 0, ...chunk);
    clampIndent();
    return true;
  }

  function moveDown(i) {
    if (i < 0) return false;
    const next = nextSibling(i);
    if (next >= 0) {
      const end = subtreeEnd(i);
      const chunk = blocks.splice(i, end - i);
      const next2 = next - chunk.length;
      const insertAt = subtreeEnd(next2);
      blocks.splice(insertAt, 0, ...chunk);
      return true;
    }
    const p = parentIndex(i);
    if (p < 0) return false;
    const end = subtreeEnd(i);
    const chunk = blocks.splice(i, end - i);
    const pEnd = subtreeEnd(p);
    if (pEnd >= blocks.length || blocks[pEnd].indent !== blocks[p].indent) {
      blocks.splice(i, 0, ...chunk);
      return false;
    }
    const uncle = pEnd;
    const delta = (blocks[uncle].indent + 1) - chunk[0].indent;
    for (const b of chunk) b.indent = Math.max(0, b.indent + delta);
    blocks.splice(uncle + 1, 0, ...chunk);
    clampIndent();
    return true;
  }

  function deleteSubtreeAt(i) {
    if (i < 0) return -1;
    const end = subtreeEnd(i);
    const prevId = i > 0 ? blocks[i - 1].id : null;
    blocks.splice(i, end - i);
    if (!blocks.length) blocks.push({ id: newId(), indent: 0, text: "", collapsed: false });
    return prevId ? indexOfId(prevId) : 0;
  }

  function doMove(dir) {
    syncFromDom();
    pushHistory();
    if (selected) {
      const roots = selectionRoots();
      if (!roots.length) return;
      const ids = roots.map(r => blocks[r].id);
      if (dir < 0) {
        for (const id of ids) {
          const idx = indexOfId(id);
          if (idx < 0 || !moveUp(idx)) break;
        }
      } else {
        for (let k = ids.length - 1; k >= 0; k--) {
          const idx = indexOfId(ids[k]);
          if (idx >= 0) moveDown(idx);
        }
      }
      clampIndent();
      render(null);
      scheduleSave();
      return;
    }
    const i = activeIndex();
    const id = blocks[i].id;
    const ok = dir < 0 ? moveUp(i) : moveDown(i);
    if (!ok) {
      undoStack.pop();
      return;
    }
    clampIndent();
    render(id, null);
    scheduleSave();
  }

  function doDeleteSubtree() {
    syncFromDom();
    pushHistory();
    if (selected) {
      let focusAfter = null;
      let roots = selectionRoots();
      // If anchor/focus were hidden by collapse, still delete the anchor node.
      if (!roots.length && selected.anchor) {
        const ai = indexOfId(selected.anchor);
        if (ai >= 0) roots = [ai];
      }
      if (!roots.length) {
        undoStack.pop();
        clearSelection();
        render(activeId || (blocks[0] && blocks[0].id), null);
        return;
      }
      // Prefer focus after the node above the first (lowest-index) root.
      const firstRoot = roots[0];
      const preferPrev = firstRoot > 0 ? blocks[firstRoot - 1].id : null;
      const ids = roots.map(r => blocks[r].id);
      for (let k = ids.length - 1; k >= 0; k--) {
        const idx = indexOfId(ids[k]);
        if (idx >= 0) {
          const fi = deleteSubtreeAt(idx);
          if (fi >= 0 && blocks[fi]) focusAfter = blocks[fi].id;
        }
      }
      clampIndent();
      clearSelection();
      const nextId = (preferPrev && indexOfId(preferPrev) >= 0)
        ? preferPrev
        : (focusAfter || (blocks[0] && blocks[0].id));
      render(nextId, null);
      scheduleSave();
      return;
    }
    const i = activeIndex();
    const focusI = deleteSubtreeAt(i);
    clampIndent();
    const id = blocks[Math.max(0, focusI)].id;
    const caret = blocks[Math.max(0, focusI)].text.length;
    render(id, caret);
    scheduleSave();
  }

  /** Multi-node select: whole visible run from anchor id to focus id. */
  function setNodeSelection(anchorId, focusId) {
    if (!anchorId || indexOfId(anchorId) < 0) return;
    const focus = focusId && indexOfId(focusId) >= 0 ? focusId : anchorId;
    selected = { anchor: anchorId, focus };
    activeId = focus;
    const el = document.activeElement;
    if (el && host.contains(el) && el.blur) el.blur();
    window.getSelection() && window.getSelection().removeAllRanges();
    render(null);
  }

  function selectAllVisible() {
    const vis = visibleIndices();
    if (!vis.length) return;
    setNodeSelection(blocks[vis[0]].id, blocks[vis[vis.length - 1]].id);
  }

  // toolbar
  toolbar.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".otool-btn")) e.preventDefault();
  });
  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    const act = btn.dataset.act;
    if (act === "indent") applyIndent(1);
    else if (act === "outdent") applyIndent(-1);
    else if (act === "collapse") {
      syncFromDom();
      const i = activeIndex();
      if (toggleCollapsed(i)) {
        render(blocks[i].id, null);
        scheduleSave();
      }
    }
  });

  host.addEventListener("click", (e) => {
    const chev = e.target.closest(".ochev");
    if (chev && host.contains(chev)) {
      e.preventDefault();
      e.stopPropagation();
      const row = chev.closest(".oblock");
      if (!row) return;
      const i = indexOfRow(row);
      syncFromDom();
      if (toggleCollapsed(i)) {
        render(blocks[i].id, null);
        scheduleSave();
      }
      return;
    }
    const a = e.target.closest("a[href]");
    if (a && host.contains(a)) {
      e.stopPropagation();
    }
  });

  host.addEventListener("focusin", (e) => {
    if (e.target.closest && e.target.closest("a")) return;
    if (e.target.closest && e.target.closest(".ochev")) return;
    const row = e.target.closest(".oblock");
    if (!row) return;
    if (selected) {
      clearSelection();
    }
    const el = row.querySelector(".otext");
    if (el && !el.isContentEditable) {
      const id = row.dataset.id;
      const b = blocks.find(x => x.id === id);
      const caret = b && b.text ? b.text.length : 0;
      render(id, caret);
      return;
    }
    activeId = row.dataset.id;
    refreshToolbar();
  });

  host.addEventListener("focusout", (e) => {
    if (rebuilding) return;
    if (!e.target.classList || !e.target.classList.contains("otext")) return;
    const next = e.relatedTarget;
    if (next && (host.contains(next) || toolbar.contains(next))) return;
    // Defer: Enter/Tab destroy the node then focus a new one in the same turn.
    // relatedTarget is often null even when we are about to focus another row.
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(function () {
      blurTimer = null;
      if (rebuilding || !alive) return;
      if (host.contains(document.activeElement)) return;
      if (toolbar.contains(document.activeElement)) return;
      syncFromDom();
      const id = activeId;
      activeId = null;
      render(null);
      activeId = id;
      refreshToolbar();
    }, 0);
  });

  host.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a")) return;
    if (e.target.closest(".ochev")) return;
    const row = e.target.closest(".oblock");
    // Shift+click: multi-node select (extend or start from active/anchor)
    if (e.shiftKey && row && host.contains(row)) {
      e.preventDefault();
      const id = row.dataset.id;
      syncFromDom();
      if (selected) {
        setNodeSelection(selected.anchor, id);
      } else {
        const anchor = (activeId && indexOfId(activeId) >= 0) ? activeId : id;
        setNodeSelection(anchor, id);
      }
      return;
    }
    // drag from bullet
    const bullet = e.target.closest(".obullet");
    if (bullet && host.contains(bullet)) {
      if (!row) return;
      e.preventDefault();
      startDrag(e, row);
      return;
    }
    const el = e.target.closest(".otext.view");
    if (!el) return;
    if (!row) return;
    if (selected) {
      clearSelection();
    }
    e.preventDefault();
    const id = row.dataset.id;
    const b = blocks.find(x => x.id === id);
    render(id, b && b.text ? b.text.length : 0);
  });

  // --- drag reorder ---
  let drag = null;
  function startDrag(e, row) {
    const i = indexOfRow(row);
    if (i < 0) return;
    syncFromDom();
    drag = {
      id: blocks[i].id,
      startY: e.clientY,
      startX: e.clientX,
      moved: false,
      pointerId: e.pointerId,
    };
    try { row.setPointerCapture(e.pointerId); } catch (err) {}
    const onMove = (ev) => {
      if (!drag) return;
      if (!drag.moved) {
        if (Math.abs(ev.clientY - drag.startY) < 4 && Math.abs(ev.clientX - drag.startX) < 4) return;
        drag.moved = true;
        pushHistory();
        const r = host.querySelector('.oblock[data-id="' + CSS.escape(drag.id) + '"]');
        if (r) r.classList.add("dragging");
      }
      updateDropIndicator(ev);
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!drag) return;
      const d = drag;
      drag = null;
      dropLine.classList.remove("show");
      const r = host.querySelector('.oblock[data-id="' + CSS.escape(d.id) + '"]');
      if (r) r.classList.remove("dragging");
      if (!d.moved) {
        // treat as click: focus row
        clearSelection();
        const b = blocks.find(x => x.id === d.id);
        render(d.id, b && b.text ? b.text.length : 0);
        return;
      }
      applyDrop(d.id, ev);
      scheduleSave();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function updateDropIndicator(ev) {
    const rows = [...host.querySelectorAll(".oblock")];
    if (!rows.length) return;
    let target = null;
    let after = false;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (ev.clientY < mid) {
        target = row;
        after = false;
        break;
      }
      target = row;
      after = true;
    }
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    dropLine.classList.add("show");
    dropLine.style.top = (after ? rect.bottom : rect.top) - hostRect.top + host.scrollTop + "px";
    // depth from x
    const gutter = parseFloat(getComputedStyle(host).getPropertyValue("--note-gutter")) || 20;
    const chev = parseFloat(getComputedStyle(host).getPropertyValue("--chev-w")) || 15;
    const relX = ev.clientX - hostRect.left;
    const depth = Math.max(0, Math.min(8, Math.round((relX - chev) / gutter)));
    dropLine.dataset.afterId = target.dataset.id;
    dropLine.dataset.after = after ? "1" : "0";
    dropLine.dataset.depth = String(depth);
    dropLine.style.marginLeft = (depth * gutter) + "px";
  }

  function applyDrop(dragId, ev) {
    updateDropIndicator(ev);
    const afterId = dropLine.dataset.afterId;
    const after = dropLine.dataset.after === "1";
    let depth = parseInt(dropLine.dataset.depth || "0", 10) || 0;
    dropLine.classList.remove("show");
    if (!afterId || afterId === dragId) {
      // cancel history push if no-op - already pushed; leave it
      render(dragId, null);
      return;
    }
    const from = indexOfId(dragId);
    if (from < 0) return;
    // refuse drop inside own subtree
    const fromEnd = subtreeEnd(from);
    const toIdx = indexOfId(afterId);
    if (toIdx >= from && toIdx < fromEnd) {
      render(dragId, null);
      return;
    }
    const end = subtreeEnd(from);
    const chunk = blocks.splice(from, end - from);
    let insertAt = indexOfId(afterId);
    if (insertAt < 0) {
      blocks.splice(from, 0, ...chunk);
      render(dragId, null);
      return;
    }
    if (after) insertAt = subtreeEnd(insertAt);
    // adjust depth
    if (insertAt > 0) {
      const max = blocks[insertAt - 1] ? blocks[insertAt - 1].indent + 1 : 0;
      depth = Math.min(depth, max);
    } else depth = 0;
    const delta = depth - chunk[0].indent;
    for (const b of chunk) b.indent = Math.max(0, b.indent + delta);
    blocks.splice(insertAt, 0, ...chunk);
    clampIndent();
    clearSelection();
    render(dragId, null);
  }

  host.addEventListener("input", (e) => {
    if (!e.target.classList.contains("otext") || !e.target.isContentEditable) return;
    maybeTextHistory();
    const row = e.target.closest(".oblock");
    const b = blocks.find(x => x.id === row.dataset.id);
    if (b) b.text = e.target.textContent.replace(/\u00a0/g, " ");
    if (row) activeId = row.dataset.id;
    scheduleSave();
  });

  function enterNodeSelect(id) {
    setNodeSelection(id, id);
  }
  function extendSelect(dir) {
    if (!selected) return;
    const vis = visibleIndices();
    const fi = vis.indexOf(indexOfId(selected.focus));
    if (fi < 0) return;
    const ni = fi + dir;
    if (ni < 0 || ni >= vis.length) return;
    selected.focus = blocks[vis[ni]].id;
    activeId = selected.focus;
    render(null);
  }

  function handleSelectionKeys(e) {
    if (!selected) return false;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      e.preventDefault();
      const id = selected.focus;
      clearSelection();
      render(id, null);
      return true;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      applyIndent(e.shiftKey ? -1 : 1);
      return true;
    }
    // Multi-node delete: remove every selected root (and each subtree)
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      e.stopPropagation();
      doDeleteSubtree();
      return true;
    }
    if (mod && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      selectAllVisible();
      return true;
    }
    if (mod && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      doMove(e.key === "ArrowUp" ? -1 : 1);
      return true;
    }
    if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      extendSelect(e.key === "ArrowUp" ? -1 : 1);
      return true;
    }
    if (mod && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return true;
    }
    if (mod && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      redo();
      return true;
    }
    // arrow without shift leaves selection
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const id = selected.focus;
      clearSelection();
      const i = indexOfId(id);
      const vis = visibleIndices();
      const vi = vis.indexOf(i);
      let target = id;
      if (e.key === "ArrowUp" && vi > 0) target = blocks[vis[vi - 1]].id;
      if (e.key === "ArrowDown" && vi >= 0 && vi < vis.length - 1) target = blocks[vis[vi + 1]].id;
      render(target, null);
      return true;
    }
    return false;
  }

  // Capture-phase window keys while multi-selecting (caret is blurred off the row)
  function onWinKey(e) {
    if (!alive || !selected || !shell.isConnected) return;
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae !== document.documentElement) {
      const tag = (ae.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      // Another editor has focus — don't steal Backspace/Delete
      if (ae.isContentEditable && !host.contains(ae)) return;
    }
    handleSelectionKeys(e);
  }
  window.addEventListener("keydown", onWinKey, true);

  host.addEventListener("keydown", (e) => {
    // undo/redo always
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && (e.key === "b" || e.key === "i" || e.key === "u")) {
      e.preventDefault();
      return;
    }

    if (selected) {
      handleSelectionKeys(e);
      return;
    }

    const textEl = e.target.closest(".otext");
    if (!textEl || !textEl.isContentEditable) return;
    const row = textEl.closest(".oblock");
    const i = indexOfRow(row);
    if (i < 0) return;

    // collapse / expand
    if (mod && !e.shiftKey && e.key === "ArrowUp") {
      e.preventDefault();
      if (hasChildren(i) && !blocks[i].collapsed) {
        syncFromDom();
        toggleCollapsed(i, true);
        render(blocks[i].id, null);
        scheduleSave();
      }
      return;
    }
    if (mod && !e.shiftKey && e.key === "ArrowDown") {
      e.preventDefault();
      if (hasChildren(i) && blocks[i].collapsed) {
        syncFromDom();
        toggleCollapsed(i, false);
        render(blocks[i].id, null);
        scheduleSave();
      }
      return;
    }

    // move among siblings
    if (mod && e.shiftKey && e.key === "ArrowUp") {
      e.preventDefault();
      doMove(-1);
      return;
    }
    if (mod && e.shiftKey && e.key === "ArrowDown") {
      e.preventDefault();
      doMove(1);
      return;
    }

    // delete subtree
    if (mod && e.shiftKey && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      doDeleteSubtree();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      syncFromDom();
      pushHistory();
      const off = caretOffset(textEl);
      const cur = blocks[i];
      const left = cur.text.slice(0, off);
      const right = cur.text.slice(off);
      const atEnd = off === cur.text.length;
      cur.text = left;
      if (atEnd && hasChildren(i) && !cur.collapsed) {
        // first child
        const nb = { id: newId(), indent: cur.indent + 1, text: right, collapsed: false };
        blocks.splice(i + 1, 0, nb);
        render(nb.id, 0);
      } else {
        const nb = { id: newId(), indent: cur.indent, text: right, collapsed: false };
        blocks.splice(subtreeEnd(i), 0, nb);
        render(nb.id, 0);
      }
      scheduleSave();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      activeId = blocks[i].id;
      applyIndent(e.shiftKey ? -1 : 1);
      return;
    }

    // enter multi-select (and extend one step so a range is multi-node immediately)
    if (e.shiftKey && e.key === "ArrowUp" && atLineStart(textEl)) {
      e.preventDefault();
      syncFromDom();
      enterNodeSelect(blocks[i].id);
      extendSelect(-1);
      return;
    }
    if (e.shiftKey && e.key === "ArrowDown" && atLineEnd(textEl)) {
      e.preventDefault();
      syncFromDom();
      enterNodeSelect(blocks[i].id);
      extendSelect(1);
      return;
    }

    // select all visible nodes → Backspace/Delete removes them as multi-node delete
    if (mod && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      syncFromDom();
      selectAllVisible();
      return;
    }

    if (e.key === "Backspace") {
      const off = caretOffset(textEl);
      if (off === 0 && i > 0) {
        e.preventDefault();
        syncFromDom();
        pushHistory();
        if (!blocks[i].text) {
          const end = subtreeEnd(i);
          if (end > i + 1) {
            for (let j = i + 1; j < end; j++) blocks[j].indent = Math.max(0, blocks[j].indent - 1);
          }
          const prev = blocks[i - 1];
          const caret = prev.text.length;
          blocks.splice(i, 1);
          if (!blocks.length) blocks.push({ id: newId(), indent: 0, text: "", collapsed: false });
          clampIndent();
          render(prev.id, caret);
          scheduleSave();
          return;
        }
        const prev = blocks[i - 1];
        const caret = prev.text.length;
        prev.text += blocks[i].text;
        blocks.splice(i, 1);
        clampIndent();
        render(prev.id, caret);
        scheduleSave();
        return;
      }
    }

    if (e.key === "ArrowUp" && !e.shiftKey && !mod) {
      if (!atLineStart(textEl)) return;
      e.preventDefault();
      syncFromDom();
      const vis = visibleIndices();
      const vi = vis.indexOf(i);
      if (vi > 0) {
        const rect = caretLineRect();
        const x = rect ? rect.left : null;
        render(blocks[vis[vi - 1]].id, null, x);
      }
      return;
    }
    if (e.key === "ArrowDown" && !e.shiftKey && !mod) {
      if (!atLineEnd(textEl)) return;
      e.preventDefault();
      syncFromDom();
      const vis = visibleIndices();
      const vi = vis.indexOf(i);
      if (vi >= 0 && vi < vis.length - 1) {
        const rect = caretLineRect();
        const x = rect ? rect.left : null;
        render(blocks[vis[vi + 1]].id, null, x);
      }
      return;
    }
    if (e.key === "ArrowLeft" && !e.shiftKey && !mod && isCaretAtStart(textEl)) {
      e.preventDefault();
      syncFromDom();
      const vis = visibleIndices();
      const vi = vis.indexOf(i);
      if (vi > 0) {
        const prev = blocks[vis[vi - 1]];
        render(prev.id, prev.text.length);
      }
      return;
    }
    if (e.key === "ArrowRight" && !e.shiftKey && !mod && isCaretAtEnd(textEl)) {
      e.preventDefault();
      syncFromDom();
      const vis = visibleIndices();
      const vi = vis.indexOf(i);
      if (vi >= 0 && vi < vis.length - 1) {
        render(blocks[vis[vi + 1]].id, 0);
      }
      return;
    }
  });

  host.addEventListener("paste", (e) => {
    const textEl = e.target.closest(".otext");
    if (!textEl || !textEl.isContentEditable) return;
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData("text") || "";
    const lines = paste.replace(/\\r\\n/g, "\\n").split("\\n");
    syncFromDom();
    pushHistory();
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
      const nb = {
        id: newId(),
        indent: cur.indent,
        text: lines[k] + (isLast ? after : ""),
        collapsed: false,
      };
      created.push(nb);
    }
    blocks.splice(i + 1, 0, ...created);
    const last = created[created.length - 1] || cur;
    render(last.id, lines[lines.length - 1].length);
    scheduleSave();
  });

  render(opts.autofocus ? blocks[0].id : null, opts.autofocus ? endOf({ textContent: blocks[0].text }) : null);
  if (opts.autofocus) {
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
      return blocks.map(serializeBlock);
    },
    setAttachments(list) {
      opts.attachments = list || [];
    },
    async flush(force) {
      clearTimeout(timer);
      if (dirty || force) await save();
      else if (inflight) await inflight;
    },
    destroy() {
      alive = false;
      window.removeEventListener("keydown", onWinKey, true);
      clearTimeout(timer);
      clearTimeout(histTimer);
      if (blurTimer) clearTimeout(blurTimer);
      host.innerHTML = "";
      host.classList.remove("outliner", "compact", "page", "selecting");
      if (shell.parentNode) {
        shell.parentNode.insertBefore(host, shell);
        shell.remove();
      }
    },
  };
}

`;

// Client-side pack passphrase encryption (cowyo-style).
// Passphrase never leaves the browser; URL hash #pw=… is stripped after load.
const CRYPTO_JS = `
const VP_CRYPTO = (() => {
  const ITER = 210000;
  const storageKey = () => "vp_pw_" + (typeof BASE === "string" ? BASE : location.pathname.split("/")[1] || "local");

  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function getPassphrase() {
    try { return sessionStorage.getItem(storageKey()) || ""; } catch { return ""; }
  }
  function setPassphrase(pw) {
    try {
      if (pw) sessionStorage.setItem(storageKey(), pw);
      else sessionStorage.removeItem(storageKey());
    } catch { /* private mode */ }
  }
  function clearPassphrase() { setPassphrase(""); }

  // Read #pw=… or #password=… once, store, strip from URL (never hits server)
  function ingestHash() {
    const h = location.hash.replace(/^#/, "");
    if (!h) return;
    const params = new URLSearchParams(h.includes("=") ? h : ("pw=" + h));
    const pw = params.get("pw") || params.get("password") || params.get("key") || "";
    if (pw) {
      setPassphrase(pw);
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  async function deriveKey(passphrase, saltBytes) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: ITER, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async function encryptPayload(obj, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const pt = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
    return {
      v: 1,
      alg: "AES-GCM",
      kdf: "PBKDF2",
      iter: ITER,
      salt: b64(salt),
      iv: b64(iv),
      ct: b64(ct),
    };
  }

  async function decryptPayload(cipher, passphrase) {
    if (!cipher || !cipher.ct) throw new Error("missing cipher");
    const salt = unb64(cipher.salt);
    const iv = unb64(cipher.iv);
    const key = await deriveKey(passphrase, salt);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, unb64(cipher.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  function hasPassphrase() { return !!getPassphrase(); }

  return {
    ingestHash, getPassphrase, setPassphrase, clearPassphrase, hasPassphrase,
    encryptPayload, decryptPayload, ITER,
  };
})();
`;

function page(title, body) {
  const base = basePath();
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style>
<script>window.BASE=${JSON.stringify(base)};var BASE=window.BASE;</script>
<script>${CRYPTO_JS}</script>
<script>VP_CRYPTO.ingestHash();</script>
</head><body>${body}</body></html>`;
}

function cryptoBarHtml({ locked = false } = {}) {
  return `<div class="crypto-bar ui" id="crypto-bar" data-locked="${locked ? "1" : "0"}">
    <span class="crypto-status" id="crypto-status"></span>
    <button type="button" class="crypto-btn" id="crypto-unlock" hidden>Unlock</button>
    <button type="button" class="crypto-btn" id="crypto-set" hidden>Set passphrase</button>
    <button type="button" class="crypto-btn" id="crypto-clear" hidden>Lock</button>
  </div>
  <script>
  (function () {
    const bar = document.getElementById("crypto-bar");
    if (!bar || !window.VP_CRYPTO) return;
    const status = document.getElementById("crypto-status");
    const btnUnlock = document.getElementById("crypto-unlock");
    const btnSet = document.getElementById("crypto-set");
    const btnClear = document.getElementById("crypto-clear");
    function refresh() {
      const on = VP_CRYPTO.hasPassphrase();
      status.textContent = on
        ? "Encryption on — notes save encrypted (passphrase never leaves this browser)"
        : "Optional encryption off — set a passphrase to encrypt notes like cowyo";
      btnUnlock.hidden = on;
      btnSet.hidden = on;
      btnClear.hidden = !on;
      bar.dataset.on = on ? "1" : "0";
      document.dispatchEvent(new CustomEvent("vpcrypto", { detail: { on } }));
    }
    btnUnlock.addEventListener("click", () => {
      const pw = prompt("Pack passphrase (never sent to the server):");
      if (pw == null || pw === "") return;
      VP_CRYPTO.setPassphrase(pw);
      refresh();
      location.reload();
    });
    btnSet.addEventListener("click", () => {
      const pw = prompt("New pack passphrase (client-side only):");
      if (pw == null || pw === "") return;
      const pw2 = prompt("Repeat passphrase:");
      if (pw !== pw2) { alert("Passphrases did not match."); return; }
      VP_CRYPTO.setPassphrase(pw);
      refresh();
      alert("Passphrase set for this browser session. Saves will encrypt. Tip: open with #pw=… in the URL (hash is never sent to the server).");
    });
    btnClear.addEventListener("click", () => {
      VP_CRYPTO.clearPassphrase();
      refresh();
      location.reload();
    });
    refresh();
  })();
  </script>`;
}

/**
 * Sign-in at bare `/`.
 * Local: one solid button. Remote: key field + one button.
 * Alternate key path is tucked under a details row (not a second primary).
 */
function renderEnterDoor({ error = "", local = false } = {}) {
  const openHref = DOOR ? `/${DOOR}/` : "/";
  const showLocal = local && !!DOOR;

  const keyForm = (opts = {}) => {
    const { required = true, autofocus = false, btn = "Open notes" } = opts;
    return `<form class="login-form" method="get" action="/enter" id="login-form">
      <label for="door">Your key</label>
      <input type="text" id="door" name="door"
        placeholder="four-words-like-this"
        autocomplete="username" autocapitalize="off" spellcheck="false"
        ${required ? "required" : ""} ${autofocus ? "autofocus" : ""}>
      <button type="submit" class="login-btn">${esc(btn)}</button>
    </form>`;
  };

  let body;
  if (showLocal) {
    // One primary action. Key form only if they open “Use a different key”.
    body = `
      <h1>keyverse</h1>
      <p class="lead">Scripture notes on this machine.</p>
      ${error ? `<p class="login-error" role="alert">${esc(error)}</p>` : ""}
      <a class="login-btn" href="${esc(openHref)}">Open my notes</a>
      <details class="login-more"${error ? " open" : ""}>
        <summary>Use a different key</summary>
        ${keyForm({ required: true, autofocus: !!error, btn: "Continue" })}
      </details>`;
  } else {
    body = `
      <h1>keyverse</h1>
      <p class="lead">Open your notes with your key.</p>
      ${error ? `<p class="login-error" role="alert">${esc(error)}</p>` : ""}
      ${keyForm({ required: true, autofocus: true, btn: "Open notes" })}
      <details class="login-more">
        <summary>Don’t have a key?</summary>
        <p>Use the link from when you set this up, or ask whoever runs the server for their notes link. After you open once, bookmark the page.</p>
      </details>`;
  }

  return page(
    "keyverse",
    `<div class="login">${body}</div>
    <script>
    (function () {
      var KEY = "vp_door_key";
      var input = document.getElementById("door");
      var form = document.getElementById("login-form");
      if (!input || !form) return;
      try {
        var saved = localStorage.getItem(KEY);
        if (saved && !input.value) input.value = saved;
      } catch (e) {}
      form.addEventListener("submit", function () {
        var v = (input.value || "").trim().toLowerCase().replace(/\\s+/g, "-");
        if (v) try { localStorage.setItem(KEY, v); } catch (e) {}
      });
    })();
    </script>`,
  );
}

function stripInlineMarkers(text) {
  let line = String(text || "");
  // wiki labels
  line = line.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, l) => (l && l.trim()) || t.trim());
  line = line.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, l) => (l && l.trim()) || t.trim());
  // md links → label
  line = line.replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/gi, "$1");
  // code / emphasis markers (flat)
  line = line.replace(/`([^`\n]+)`/g, "$1");
  line = line.replace(/\*\*([^*]+)\*\*/g, "$1");
  line = line.replace(/~~([^~]+)~~/g, "$1");
  line = line.replace(/\*([^*]+)\*/g, "$1");
  line = line.replace(/(?<![\w])_([^_\n]+)_(?![\w])/g, "$1");
  return line;
}

function excerpt(note) {
  if (isEncryptedNote(note)) return "encrypted";
  let line = (note.blocks || []).find((b) => b.text.trim())?.text || "";
  line = stripInlineMarkers(line);
  return line.length > 90 ? line.slice(0, 90) + "…" : line;
}

// Read-only outline — same depth grid as the outliner (margin-left: depth * gutter).
// Block text: base markdown + wiki [[passage]] + embeds ![[att:…]] / ![[https://…]].
// Honors collapsed (ADR 0013): hides descendants of collapsed parents.
function renderOutline(blocks, attachments = []) {
  const items = blocks || [];
  if (!items.length) return "";
  const hidden = new Set();
  for (let i = 0; i < items.length; i++) {
    if (!items[i].collapsed) continue;
    const base = Math.max(0, Number(items[i].indent) || 0);
    for (let j = i + 1; j < items.length; j++) {
      const d = Math.max(0, Number(items[j].indent) || 0);
      if (d <= base) break;
      hidden.add(j);
    }
  }
  return `<div class="outline">${items.map((b, i) => {
    if (hidden.has(i)) return "";
    const depth = Math.max(0, Number(b.indent) || 0);
    const empty = !String(b.text || "").trim();
    const hasKids =
      i + 1 < items.length &&
      Math.max(0, Number(items[i + 1].indent) || 0) > depth;
    const collapsed = !!(b.collapsed && hasKids);
    const cls = [
      "oline",
      empty ? "blank" : "",
      hasKids ? "has-kids" : "",
      collapsed ? "collapsed" : "",
    ].filter(Boolean).join(" ");
    return `<div class="${cls}" style="--depth:${depth}" title="${esc(b.id)}">
      <span class="ochev" aria-hidden="true"></span>
      <span class="odot" aria-hidden="true"></span>
      <span class="otxt">${empty ? "" : formatBlockText(b.text, attachments)}</span>
    </div>`;
  }).join("")}</div>`;
}

function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact attachments: one list + File / paste-link row (no empty-state chrome). */
function renderAttachmentsBoard(attachments = [], { editable = false } = {}) {
  const list = attachments || [];
  if (!editable && !list.length) return "";

  const removeBtn = (id) =>
    editable
      ? `<button type="button" class="att-remove" data-att="${esc(id)}" title="Remove" aria-label="Remove">\u00d7</button>`
      : "";

  const rows = list.map((a) => {
    if (a.kind === "file") {
      const href = u(`/api/attachments/${a.sha256}?name=${encodeURIComponent(a.name || "file")}`);
      const isImg = (a.mime || "").startsWith("image/");
      const icon = isImg
        ? `<img class="att-thumb" src="${esc(href)}" alt="">`
        : `<span class="att-icon" aria-hidden="true">\u25A1</span>`;
      return `<li class="att-row" data-att="${esc(a.id)}" data-kind="file">
        ${icon}
        <a class="attlink" href="${esc(href)}" ${isImg ? 'target="_blank" rel="noopener"' : `download="${esc(a.name || "file")}"`}>${esc(a.name || "file")}</a>
        <span class="att-meta">${fmtBytes(a.bytes)}</span>
        ${removeBtn(a.id)}
      </li>`;
    }
    return `<li class="att-row" data-att="${esc(a.id)}" data-kind="url">
      <span class="att-icon" aria-hidden="true">\u2197</span>
      <a class="attlink" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title || a.url)}</a>
      ${removeBtn(a.id)}
    </li>`;
  }).join("");

  const addRow = editable
    ? `<form class="att-add" id="att-url-form">
        <label class="att-file-btn">+ File
          <input type="file" id="att-file" multiple accept="*/*">
        </label>
        <div class="att-link-wrap" id="att-link-wrap">
          <button type="button" class="att-link-btn" id="att-link-open">+ Link</button>
          <input class="att-url" type="url" id="att-url" name="url"
            placeholder="https://…" inputmode="url" autocomplete="url">
        </div>
      </form>`
    : "";

  return `<div class="att-board" id="att-board">
    ${rows ? `<ul class="att-list">${rows}</ul>` : ""}
    ${addRow}
  </div>`;
}

// Editor page: related notes as inbox items (open the note — don't embed it).
function inboxItem({ scope, note }) {
  const display = formatPassageForDisplay(scope.parsed);
  const line = excerpt(note);
  const empty = !line || line === "encrypted";
  const excerptText = line || "empty";
  return `<a class="inbox-item" href="${u(`/note/${scope.slug}`)}">
    <div class="inbox-top">
      <span class="inbox-title ref">${esc(display)}</span>
      <span class="inbox-kind">${esc(scope.kind)}</span>
    </div>
    <div class="inbox-excerpt${empty && !line ? " is-empty" : ""}">${esc(excerptText)}</div>
  </a>`;
}

function inboxList(entries) {
  if (!entries?.length) return "";
  return `<div class="inbox">${entries.map((e) => inboxItem(e)).join("\n")}</div>`;
}

/** Section chrome for compose-don’t-absorb related notes. */
function relatedSection(kind, label, sub, entries) {
  if (!entries?.length) return "";
  const cls =
    kind === "contains" ? "related-within" :
    kind === "within" ? "related-parent" :
    "related-overlap";
  return `<section class="related ${cls}">
    <h2 class="related-label ui">${esc(label)}</h2>
    ${sub ? `<p class="related-sub">${esc(sub)}</p>` : ""}
    ${inboxList(entries)}
  </section>`;
}

// Reader: plain outline; click body to edit inline (any scope). Show/hide is verse-level.
// label: false for the page chapter note (title already names the passage).
function readerNoteHtml({ scope, note, label = true }) {
  const display = formatPassageForDisplay(scope.parsed);
  const lo = scope.parsed.start.verse ?? "";
  const hi = scope.parsed.end.verse ?? lo;
  const rangeAttrs =
    scope.kind === "range"
      ? ` data-lo="${esc(String(lo))}" data-hi="${esc(String(hi))}"`
      : "";
  if (isEncryptedNote(note)) {
    const showLabel = label && scope.kind !== "verse";
    return `<div class="note encrypted" data-kind="${esc(scope.kind)}" data-slug="${esc(scope.slug)}"${rangeAttrs} data-encrypted="1">
      ${showLabel ? `<div class="note-label">${esc(display)}</div>` : ""}
      <div class="note-body"><p class="muted ui" style="margin:.35rem 0">Encrypted — <a href="${u(`/note/${scope.slug}`)}">open to unlock</a></p></div>
      <div class="note-edit" hidden></div>
    </div>`;
  }
  const blocks = note?.blocks || [];
  const has = blocks.some((b) => b.text.trim()) || blocks.length > 0;
  if (!has && scope.kind !== "verse") return "";
  const showLabel = label && scope.kind !== "verse";
  const attHtml = renderAttachmentsBoard(note?.attachments || [], { editable: false });
  return `<div class="note" data-kind="${esc(scope.kind)}" data-slug="${esc(scope.slug)}"${rangeAttrs}>
    ${showLabel ? `<div class="note-label">${esc(display)}</div>` : ""}
    <div class="note-body">${blocks.length ? renderOutline(blocks, note?.attachments) : ""}</div>
    ${attHtml}
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

/**
 * Public origin for share links / QR. Prefer client-provided origin (matches
 * what the browser bar shows); fall back to Forwarded / Host headers.
 */
function publicOrigin(req, originParam) {
  if (originParam) {
    try {
      const parsed = new URL(String(originParam));
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        if (!parsed.username && !parsed.password) return parsed.origin;
      }
    } catch { /* fall through */ }
  }
  const xfProto = req.headers["x-forwarded-proto"];
  const proto = String(Array.isArray(xfProto) ? xfProto[0] : xfProto || "")
    .split(",")[0]
    .trim() || (req.socket?.encrypted ? "https" : "http");
  const xfHost = req.headers["x-forwarded-host"];
  const host = String(Array.isArray(xfHost) ? xfHost[0] : xfHost || "")
    .split(",")[0]
    .trim() || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

/** Full pack door URL (trailing slash) for sharing. */
function packShareUrl(req, originParam) {
  if (DOOR_OPEN || !DOOR) return publicOrigin(req, originParam) + "/";
  return `${publicOrigin(req, originParam)}/${DOOR}/`;
}

async function shareQrSvg(text) {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 200,
    color: { dark: "#111111", light: "#ffffff" },
  });
}

/** Multiword key → bookplate overlay (serif key + QR seal + Share / Copy). */
function doorShareChipHtml() {
  if (DOOR_OPEN || !DOOR) return "";
  const keyLabel = esc(DOOR);
  return `<div class="door-share-wrap" id="door-share-wrap" data-open="0">
    <button type="button" class="door-share" id="door-share"
      title="Share your notes link" aria-label="Share notes link: ${keyLabel}"
      aria-expanded="false" aria-controls="door-share-panel">
      <span class="door-share-key">${keyLabel}</span>
      <span class="door-share-hint" aria-hidden="true">↗</span>
    </button>
    <div class="door-share-panel" id="door-share-panel" role="dialog"
      aria-label="Share your notes" hidden>
      <div class="door-share-head">
        <div class="door-share-title" id="door-share-title">${keyLabel}</div>
        <button type="button" class="door-share-x" id="door-share-close"
          title="Close" aria-label="Close share">×</button>
      </div>
      <div class="door-share-qr" id="door-share-qr" aria-busy="true"></div>
      <div class="door-share-actions">
        <button type="button" class="door-share-action" id="door-share-action">Share</button>
        <button type="button" class="door-share-copy" id="door-share-copy">Copy link</button>
      </div>
    </div>
  </div>
  <script>
  (function () {
    var wrap = document.getElementById("door-share-wrap");
    var btn = document.getElementById("door-share");
    var panel = document.getElementById("door-share-panel");
    var closeBtn = document.getElementById("door-share-close");
    var qrEl = document.getElementById("door-share-qr");
    var action = document.getElementById("door-share-action");
    var copyBtn = document.getElementById("door-share-copy");
    if (!wrap || !btn || !panel || !closeBtn || !qrEl || !action || !copyBtn) return;
    var key = ${JSON.stringify(DOOR)};
    var ready = false;
    var loading = false;

    function packUrl() {
      return location.origin + "/" + key + "/";
    }

    function ensureContent() {
      if (ready || loading) return;
      loading = true;
      qrEl.setAttribute("aria-busy", "true");
      var qrUrl = (typeof BASE === "string" ? BASE : "") + "/api/share-qr?origin=" +
        encodeURIComponent(location.origin);
      fetch(qrUrl, { credentials: "same-origin" })
        .then(function (r) {
          if (!r.ok) throw new Error("qr " + r.status);
          return r.text();
        })
        .then(function (svg) {
          qrEl.innerHTML = svg;
          var s = qrEl.querySelector("svg");
          if (s) {
            s.setAttribute("role", "img");
            s.setAttribute("aria-label", "QR code for notes link");
            s.removeAttribute("width");
            s.removeAttribute("height");
            s.style.width = "100%";
            s.style.height = "100%";
          }
          ready = true;
        })
        .catch(function () {
          qrEl.innerHTML = "<span style=\\"font-size:.75rem;opacity:.55\\">QR unavailable</span>";
        })
        .finally(function () {
          loading = false;
          qrEl.setAttribute("aria-busy", "false");
        });
    }

    function isOpen() { return wrap.dataset.open === "1"; }
    function openPop() {
      ensureContent();
      panel.hidden = false;
      wrap.dataset.open = "1";
      btn.setAttribute("aria-expanded", "true");
    }
    function closePop() {
      panel.hidden = true;
      wrap.dataset.open = "0";
      btn.setAttribute("aria-expanded", "false");
    }
    function togglePop() {
      if (isOpen()) closePop(); else openPop();
    }

    function flashEl(el, msg) {
      var prev = el.textContent;
      el.textContent = msg;
      el.dataset.flash = "1";
      setTimeout(function () {
        el.textContent = prev;
        el.dataset.flash = "0";
      }, 1400);
    }

    async function copyUrl(feedbackEl) {
      var url = packUrl();
      var target = feedbackEl || copyBtn;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          var ta = document.createElement("textarea");
          ta.value = url; ta.setAttribute("readonly", "");
          ta.style.position = "fixed"; ta.style.left = "-9999px";
          document.body.appendChild(ta); ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        flashEl(target, "Copied");
      } catch (e) {
        flashEl(target, "—");
        window.prompt("Copy your notes link:", url);
      }
    }

    async function shareUrl() {
      var url = packUrl();
      if (navigator.share) {
        try {
          await navigator.share({
            title: "keyverse",
            text: "Open my scripture notes",
            url: url,
          });
          return;
        } catch (err) {
          if (err && err.name === "AbortError") return;
        }
      }
      await copyUrl(action);
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      togglePop();
    });
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closePop();
      btn.focus();
    });
    action.addEventListener("click", function (e) {
      e.stopPropagation();
      shareUrl();
    });
    copyBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      copyUrl(copyBtn);
    });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function () {
      if (isOpen()) closePop();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) {
        closePop();
        btn.focus();
      }
    });

    try { localStorage.setItem("vp_door_key", key); } catch (e) {}
  })();
  </script>`;
}

/** Passage autocomplete for the home search box (grab-bcv autocompletePassage). */
function refSearchHtml() {
  return `<div class="ref-search" id="ref-search">
    <form action="${u("/go")}" method="get" id="ref-form" role="search" autocomplete="off">
      <input class="ui" type="text" name="q" id="ref-input"
        placeholder="John 3:16" autofocus autocomplete="off" autocorrect="off"
        autocapitalize="off" spellcheck="false" inputmode="search"
        role="combobox" aria-autocomplete="list" aria-expanded="false"
        aria-controls="ref-suggest" aria-haspopup="listbox">
    </form>
    <ul class="ref-suggest" id="ref-suggest" role="listbox" hidden></ul>
  </div>
  <script>
  (function () {
    var input = document.getElementById("ref-input");
    var list = document.getElementById("ref-suggest");
    var form = document.getElementById("ref-form");
    if (!input || !list || !form) return;
    var items = [];
    var active = -1;
    var timer = null;
    var seq = 0;
    var base = typeof BASE === "string" ? BASE : "";

    function hide() {
      list.hidden = true;
      list.innerHTML = "";
      items = [];
      active = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function kindLabel(k) {
      if (k === "book") return "book";
      if (k === "chapter") return "chapter";
      if (k === "range") return "range";
      return "verse";
    }

    function render() {
      if (!items.length) { hide(); return; }
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      list.innerHTML = items.map(function (s, i) {
        var id = "ref-opt-" + i;
        var sel = i === active ? ' aria-selected="true"' : ' aria-selected="false"';
        return '<li role="option" id="' + id + '"' + sel + '>' +
          '<button type="button" data-i="' + i + '">' +
          '<span class="rs-label"></span><span class="rs-kind"></span></button></li>';
      }).join("");
      var rows = list.querySelectorAll("li");
      for (var i = 0; i < rows.length; i++) {
        rows[i].querySelector(".rs-label").textContent = items[i].label;
        rows[i].querySelector(".rs-kind").textContent = kindLabel(items[i].kind);
      }
      if (active >= 0) {
        var el = document.getElementById("ref-opt-" + active);
        if (el) {
          input.setAttribute("aria-activedescendant", el.id);
          el.scrollIntoView({ block: "nearest" });
        }
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function setActive(i) {
      if (!items.length) { active = -1; return; }
      active = (i + items.length) % items.length;
      render();
    }

    function goHref(s) {
      // book alone is incomplete for /go — keep typing after insert
      if (s.kind === "book") return null;
      var slug = String(s.canonical || "").toLowerCase();
      if (!slug) return null;
      if (s.kind === "chapter") return base + "/read/" + slug;
      return base + "/note/" + slug;
    }

    function apply(s, opts) {
      opts = opts || {};
      if (!s) return;
      var href = goHref(s);
      if (href && !opts.insertOnly) {
        location.href = href;
        return;
      }
      // insert and keep focus (books, or Tab to complete without navigating)
      var text = s.insertText || s.label || "";
      if (s.kind === "book" && text && text.slice(-1) !== " ") text += " ";
      input.value = text;
      hide();
      input.focus();
      try {
        var n = input.value.length;
        input.setSelectionRange(n, n);
      } catch (e) {}
      // fetch next level of suggestions immediately
      fetchSuggest(input.value);
    }

    function fetchSuggest(q) {
      q = String(q || "").trim();
      if (q.length < 1) { hide(); return; }
      var my = ++seq;
      fetch(base + "/api/suggest?q=" + encodeURIComponent(q) + "&limit=8", {
        headers: { accept: "application/json" },
      })
        .then(function (r) { return r.ok ? r.json() : { suggestions: [] }; })
        .then(function (data) {
          if (my !== seq) return;
          items = (data && data.suggestions) || [];
          active = items.length ? 0 : -1;
          render();
        })
        .catch(function () { if (my === seq) hide(); });
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(function () { fetchSuggest(input.value); }, 80);
    }

    input.addEventListener("input", schedule);
    input.addEventListener("focus", function () {
      if (input.value.trim()) fetchSuggest(input.value);
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!list.hidden) { e.preventDefault(); hide(); }
        return;
      }
      if (list.hidden || !items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(active < 0 ? 0 : active + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(active < 0 ? items.length - 1 : active - 1);
      } else if (e.key === "Tab") {
        if (active >= 0 && items[active]) {
          e.preventDefault();
          apply(items[active], { insertOnly: true });
        }
      } else if (e.key === "Enter") {
        if (active >= 0 && items[active]) {
          e.preventDefault();
          apply(items[active]);
        }
        // else let form submit /go
      }
    });

    list.addEventListener("mousedown", function (e) {
      // prevent input blur before click
      e.preventDefault();
    });
    list.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-i]");
      if (!btn) return;
      var i = Number(btn.getAttribute("data-i"));
      if (items[i]) apply(items[i]);
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest("#ref-search")) hide();
    });

    form.addEventListener("submit", function () {
      // if a suggestion is highlighted and matches, prefer direct nav
      if (active >= 0 && items[active] && items[active].kind !== "book") {
        // allow default if value already equals — still fine via /go
      }
    });
  })();
  </script>`;
}

async function renderIndex() {
  const notes = await listNotes();
  const treeHtml = renderHomeNoteTree(notes);
  return page(
    "keyverse",
    `<header><h1>keyverse</h1>
      ${doorShareChipHtml()}
    </header>
    ${cryptoBarHtml()}
    ${refSearchHtml()}
    <p class="muted ui" style="margin-top:.75rem">${notes.length} note${notes.length === 1 ? "" : "s"}</p>
    ${treeHtml || `<p class="muted">Type a passage above.</p>`}`,
  );
}

function renderEditor(scope, note, rel) {
  const display = formatPassageForDisplay(scope.parsed);
  const sections = [
    relatedSection(
      "contains",
      "Within",
      `Notes on passages inside ${display}`,
      rel.contains,
    ),
    relatedSection(
      "within",
      "Part of",
      "Broader passages this note sits in",
      rel.within,
    ),
    relatedSection(
      "overlaps",
      "Overlaps",
      "Ranges that partially overlap this note",
      rel.overlaps,
    ),
  ].filter(Boolean);
  const locked = isEncryptedNote(note);
  const initial = !locked && note?.blocks?.length ? note.blocks : [{ id: "b_new", indent: 0, text: "" }];
  const atts = !locked ? (note?.attachments || []) : [];
  const cipherJson = locked ? JSON.stringify(note.cipher) : "null";
  return page(
    display,
    `<header class="ui">
      <a href="${u("/")}" class="muted">&larr;</a>
      <h1>${esc(display)}</h1>
      <a class="muted" href="${u(`/read/${scope.slug}`)}">read</a>
      <span id="status"></span>
    </header>
    ${cryptoBarHtml({ locked })}
    <div id="note-main" ${locked ? "hidden" : ""}>
    <div id="editor"></div>
    <div id="att-root">${renderAttachmentsBoard(atts, { editable: true })}</div>
    </div>
    <div id="crypto-gate" class="crypto-lock" ${locked ? "" : "hidden"}>
      <h2>Encrypted note</h2>
      <p>This note is sealed with a client-side passphrase (cowyo-style). The server only stores ciphertext. Enter the passphrase or open with <code>#pw=…</code> in the URL.</p>
      <form id="crypto-unlock-form">
        <input type="password" id="crypto-pw" placeholder="Passphrase" autocomplete="current-password" required>
        <button type="submit">Unlock</button>
      </form>
      <p class="muted" id="crypto-err" hidden>Could not decrypt — wrong passphrase?</p>
    </div>
    ${sections.join("\n")}
    <script type="application/json" id="initial-blocks">${blocksJson(initial)}</script>
    <script type="application/json" id="initial-atts">${JSON.stringify(atts)}</script>
    <script type="application/json" id="initial-cipher">${cipherJson}</script>
    <script>
      ${OUTLINER_JS}
      const slug = ${JSON.stringify(scope.slug)};
      let blocks = JSON.parse(document.getElementById("initial-blocks").textContent);
      let attachments = JSON.parse(document.getElementById("initial-atts").textContent);
      const cipher = JSON.parse(document.getElementById("initial-cipher").textContent);
      let outlinerApi = null;
      const attRoot = document.getElementById("att-root");
      let uploadBusy = false;

      function setStatus(msg) {
        const el = document.getElementById("status");
        if (el) el.textContent = msg || "";
      }

      function escH(s) {
        return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]));
      }
      function fmtSize(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + " B";
        if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
        return (n / 1048576).toFixed(1) + " MB";
      }
      function shortName(name, max) {
        name = String(name || "file");
        max = max || 28;
        if (name.length <= max) return name;
        return name.slice(0, max - 1) + "\\u2026";
      }

      function renderAtts() {
        if (!attRoot) return;
        const rows = (attachments || []).map(a => {
          if (a.kind === "file") {
            const href = BASE + "/api/attachments/" + a.sha256 + "?name=" + encodeURIComponent(a.name || "file");
            const isImg = (a.mime || "").indexOf("image/") === 0;
            const icon = isImg
              ? '<img class="att-thumb" src="' + href + '" alt="">'
              : '<span class="att-icon" aria-hidden="true">\\u25A1</span>';
            return '<li class="att-row" data-att="' + escH(a.id) + '" data-kind="file">' +
              icon +
              '<a class="attlink" href="' + href + '"' + (isImg ? ' target="_blank" rel="noopener"' : " download") + '>' +
              escH(a.name || "file") + '</a>' +
              '<span class="att-meta">' + fmtSize(a.bytes) + '</span>' +
              '<button type="button" class="att-remove" data-att="' + escH(a.id) + '" aria-label="Remove">\\u00d7</button></li>';
          }
          return '<li class="att-row" data-att="' + escH(a.id) + '" data-kind="url">' +
            '<span class="att-icon" aria-hidden="true">\\u2197</span>' +
            '<a class="attlink" href="' + escH(a.url) + '" target="_blank" rel="noopener noreferrer">' +
            escH(a.title || a.url) + '</a>' +
            '<button type="button" class="att-remove" data-att="' + escH(a.id) + '" aria-label="Remove">\\u00d7</button></li>';
        }).join("");
        attRoot.innerHTML =
          '<div class="att-board" id="att-board">' +
            (rows ? '<ul class="att-list">' + rows + '</ul>' : '') +
            '<form class="att-add" id="att-url-form">' +
              '<label class="att-file-btn' + (uploadBusy ? " busy" : "") + '">+ File' +
              '<input type="file" id="att-file" multiple accept="*/*"' + (uploadBusy ? " disabled" : "") + '></label>' +
              '<div class="att-link-wrap" id="att-link-wrap">' +
                '<button type="button" class="att-link-btn" id="att-link-open">+ Link</button>' +
                '<input class="att-url" type="url" id="att-url" placeholder="https://\\u2026" inputmode="url" autocomplete="url">' +
              '</div>' +
            '</form>' +
          '</div>';
        wireAttControls();
      }

      function newAttIdLocal() {
        return "att_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      }

      async function reencryptIfNeeded() {
        if (typeof VP_CRYPTO !== "undefined" && VP_CRYPTO.hasPassphrase() && outlinerApi) {
          setStatus("encrypting\\u2026");
          await outlinerApi.flush(true);
          setStatus("saved \\u00b7 encrypted");
          return true;
        }
        return false;
      }

      async function postUrl(url) {
        setStatus("adding link\\u2026");
        // With a pack passphrase, fold URL into the encrypted envelope (no plaintext on disk).
        if (typeof VP_CRYPTO !== "undefined" && VP_CRYPTO.hasPassphrase()) {
          attachments = attachments.concat([{
            id: newAttIdLocal(), kind: "url", url, created_at: new Date().toISOString(),
          }]);
          renderAtts();
          await reencryptIfNeeded();
          return;
        }
        try {
          const r = await fetch(BASE + "/api/note/" + slug + "/attachments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "url", url }),
          });
          if (!r.ok) { setStatus("link failed"); return; }
          const data = await r.json();
          if (data.encrypted && data.attachment) {
            attachments = attachments.concat([data.attachment]);
          } else {
            attachments = data.attachments || [];
          }
          renderAtts();
          setStatus("link added");
        } catch { setStatus("offline"); }
      }

      async function postFiles(fileList) {
        const files = [...fileList];
        if (!files.length) return;
        uploadBusy = true;
        renderAtts();
        const total = files.length;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const name = shortName(file.name || "file");
          const size = fmtSize(file.size);
          setStatus(total > 1
            ? "uploading " + (i + 1) + "/" + total + " \\u00b7 " + name
            : "uploading " + name + " (" + size + ")");
          try {
            const r = await fetch(BASE + "/api/note/" + slug + "/attachments", {
              method: "POST",
              headers: {
                "content-type": file.type || "application/octet-stream",
                "x-filename": file.name || "file",
              },
              body: file,
            });
            if (!r.ok) {
              let detail = "";
              try {
                const err = await r.json();
                if (err && err.error) detail = " \\u00b7 " + err.error;
              } catch (e) {}
              setStatus("upload failed \\u00b7 " + name + detail);
              uploadBusy = false;
              renderAtts();
              return;
            }
            const data = await r.json();
            if (data.encrypted && data.attachment) {
              attachments = attachments.concat([data.attachment]);
            } else {
              attachments = data.attachments || [];
            }
            renderAtts();
            if (typeof VP_CRYPTO !== "undefined" && VP_CRYPTO.hasPassphrase()) {
              await reencryptIfNeeded();
            } else {
              setStatus(total > 1
                ? "uploaded " + (i + 1) + "/" + total + " \\u00b7 " + name
                : "uploaded " + name);
            }
          } catch {
            setStatus("upload offline \\u00b7 " + name);
            uploadBusy = false;
            renderAtts();
            return;
          }
        }
        uploadBusy = false;
        renderAtts();
        if (!(typeof VP_CRYPTO !== "undefined" && VP_CRYPTO.hasPassphrase())) {
          setStatus(total > 1 ? "uploaded " + total + " files" : "uploaded " + shortName(files[0].name || "file"));
        }
      }

      function wireAttControls() {
        const form = document.getElementById("att-url-form");
        const wrap = document.getElementById("att-link-wrap");
        const openBtn = document.getElementById("att-link-open");
        const input = document.getElementById("att-url");

        function openLinkField() {
          if (!wrap || !input) return;
          wrap.dataset.open = "1";
          input.focus();
          try { input.select(); } catch (e) {}
        }
        function closeLinkField() {
          if (!wrap || !input) return;
          if ((input.value || "").trim()) return;
          wrap.dataset.open = "0";
          input.value = "";
        }

        if (openBtn) {
          openBtn.addEventListener("click", (e) => {
            e.preventDefault();
            openLinkField();
          });
        }
        if (input) {
          input.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              input.value = "";
              if (wrap) wrap.dataset.open = "0";
              if (openBtn) openBtn.focus();
            }
          });
          input.addEventListener("blur", () => {
            setTimeout(closeLinkField, 120);
          });
        }
        if (form) {
          form.addEventListener("submit", (e) => {
            e.preventDefault();
            const url = (input && input.value || "").trim();
            if (!url) { openLinkField(); return; }
            postUrl(url).then(() => {
              if (input) input.value = "";
              if (wrap) wrap.dataset.open = "0";
            });
          });
        }
        const fileInput = document.getElementById("att-file");
        if (fileInput) {
          fileInput.addEventListener("change", (e) => {
            const files = [...(e.target.files || [])];
            e.target.value = "";
            if (files.length) postFiles(files);
          });
        }
      }

      function startEditor() {
        const host = document.getElementById("editor");
        host.innerHTML = "";
        outlinerApi = mountOutliner(host, {
          slug,
          blocks,
          attachments,
          getAttachments: () => attachments,
          statusEl: document.getElementById("status"),
          autofocus: true,
          page: true,
          placeholder: "Write\\u2026",
        });
        renderAtts();
      }

      async function tryUnlock(pw) {
        if (!cipher) return true;
        try {
          const payload = await VP_CRYPTO.decryptPayload(cipher, pw);
          blocks = payload.blocks || [{ id: "b_new", indent: 0, text: "" }];
          attachments = payload.attachments || [];
          VP_CRYPTO.setPassphrase(pw);
          document.getElementById("crypto-gate").hidden = true;
          document.getElementById("note-main").hidden = false;
          document.getElementById("crypto-err").hidden = true;
          startEditor();
          document.getElementById("crypto-status") && document.dispatchEvent(new CustomEvent("vpcrypto", { detail: { on: true } }));
          return true;
        } catch {
          document.getElementById("crypto-err").hidden = false;
          return false;
        }
      }

      if (attRoot) {
        attRoot.addEventListener("click", async (e) => {
          const btn = e.target.closest(".att-remove");
          if (!btn) return;
          e.preventDefault();
          const id = btn.dataset.att;
          const removed = attachments.find(a => a.id === id);
          setStatus("removing\\u2026");
          if (typeof VP_CRYPTO !== "undefined" && VP_CRYPTO.hasPassphrase()) {
            attachments = attachments.filter(a => a.id !== id);
            renderAtts();
            try {
              let delUrl = BASE + "/api/note/" + slug + "/attachments/" + encodeURIComponent(id);
              if (removed && removed.kind === "file" && removed.sha256) {
                delUrl += "?sha256=" + encodeURIComponent(removed.sha256);
              }
              await fetch(delUrl, { method: "DELETE" });
            } catch { /* GC best-effort */ }
            await reencryptIfNeeded();
            return;
          }
          try {
            const r = await fetch(BASE + "/api/note/" + slug + "/attachments/" + encodeURIComponent(id), { method: "DELETE" });
            if (!r.ok) { setStatus("remove failed"); return; }
            const data = await r.json();
            if (data.encrypted) {
              attachments = attachments.filter(a => a.id !== id);
            } else {
              attachments = data.attachments || [];
            }
            renderAtts();
            setStatus("removed");
          } catch { setStatus("offline"); }
        });
      }

      if (cipher) {
        if (VP_CRYPTO.hasPassphrase()) {
          tryUnlock(VP_CRYPTO.getPassphrase()).then(ok => {
            if (!ok) { /* stay on gate */ }
          });
        }
        document.getElementById("crypto-unlock-form").addEventListener("submit", (e) => {
          e.preventDefault();
          tryUnlock(document.getElementById("crypto-pw").value);
        });
      } else {
        startEditor();
      }
    </script>`,
  );
}

// ---------- reading view ----------
// Scripture first. Click a verse → show/hide all of its notes (all or none).
// Header "expand notes" opens every tray with content (VBV analysis).
// Multi-verse: shift+click, mouse-drag, or long-press then tap → passage note.
// Click a visible verse-note outline → edit. No per-note chevrons.

async function renderRead(scope) {
  const { book, chapter } = { book: scope.parsed.start.book, chapter: scope.parsed.start.chapter };
  let text;
  try {
    text = await getChapterText(book, chapter);
  } catch (err) {
    return page("keyverse", `<p>Could not fetch text (${esc(err?.message || err)}).
      <a href="${u(`/note/${scope.slug}`)}">Open note editor</a>.</p>`);
  }
  const chapterScope = parseScope(`${book}.${chapter}`);
  const display = formatPassageForDisplay(chapterScope.parsed);
  const hl = scope.kind === "chapter" ? null : scopeInterval(scope.parsed);

  const verseNotes = new Map();
  // Range notes sit under the *end* verse so the full passage reads first, then the note.
  const rangeNotes = new Map();
  const rangeCover = new Set(); // every verse inside a range that has a note
  let chapterNote = null;
  for (const note of await listNotes()) {
    const other = parseScope(note.scope.osis);
    if (!other) continue;
    if (other.parsed.start.book !== book) continue;
    if (other.parsed.start.chapter !== chapter || other.parsed.end.chapter !== chapter) continue;
    if (other.kind === "chapter") chapterNote = note;
    else if (other.kind === "verse") verseNotes.set(other.parsed.start.verse, note);
    else {
      const startV = other.parsed.start.verse;
      const endV = other.parsed.end.verse ?? startV;
      const list = rangeNotes.get(endV) || [];
      list.push({ note, scope: other });
      rangeNotes.set(endV, list);
      for (let vv = startV; vv <= endV; vv++) rangeCover.add(vv);
    }
  }

  const seed = {};
  if (chapterNote && !isEncryptedNote(chapterNote) && chapterNote.blocks) {
    seed[chapterScope.slug] = chapterNote.blocks;
  }
  const rows = text.verses
    .map(({ v, text: t }) => {
      const note = verseNotes.get(v);
      const ranges = rangeNotes.get(v) || [];
      const inHl = hl && pos(chapter, v) >= hl.s && pos(chapter, v) <= hl.e;
      const slug = `${book.toLowerCase()}.${chapter}.${v}`;
      if (note && !isEncryptedNote(note) && note.blocks) seed[slug] = note.blocks;
      for (const e of ranges) {
        if (!isEncryptedNote(e.note)) seed[e.scope.slug] = e.note.blocks || [];
      }
      const vScope = parseScope(slug);
      const hasVerse = !!(note && (isEncryptedNote(note) || note?.blocks?.some((b) => b.text.trim())));
      const hasNotes = hasVerse || ranges.length > 0 || rangeCover.has(v);
      const rangeHtml = ranges
        .map((e) => readerNoteHtml({ scope: e.scope, note: e.note }))
        .join("\n");
      const verseHtml = hasVerse
        ? readerNoteHtml({ scope: vScope, note })
        : "";
      // passage notes (full range) vs this-verse notes — separate when both appear
      let notesInner = "";
      if (rangeHtml) {
        notesInner += `<div class="note-group passage">
          ${!verseHtml ? "" : `<div class="note-group-title">Passage</div>`}
          ${rangeHtml}
        </div>`;
      }
      if (verseHtml) {
        notesInner += `<div class="note-group verse-local">
          ${ranges.length ? `<div class="note-group-title">This verse</div>` : ""}
          ${verseHtml}
        </div>`;
      }
      const vCls = [
        "verse",
        inHl ? "hl" : "",
        hasNotes ? "has-notes" : "",
        hasVerse ? "has-verse-note" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<div class="${vCls}" data-slug="${esc(slug)}" data-v="${v}" id="v${v}">
        <p class="vtext"><sup>${v}</sup>${esc(t)}<span class="vstatus"></span></p>
        <div class="vnotes">${notesInner}</div>
      </div>`;
    })
    .join("\n");

  return page(
    display,
    `<header class="ui">
      <a href="${u("/")}" class="muted">&larr;</a>
      <h1>${esc(display)}</h1>
      <button type="button" class="muted text-btn" id="expand-notes"
        aria-pressed="false" aria-label="Expand all verse notes">expand notes</button>
      <a class="muted" href="${u(`/note/${chapterScope.slug}`)}">chapter note</a>
    </header>
    ${chapterNote ? `<div class="chapter-note">${readerNoteHtml({ scope: chapterScope, note: chapterNote, label: false })}</div>` : ""}
    ${rows}
    <script type="application/json" id="verse-seeds">${blocksJson(seed)}</script>
    <script>
      ${OUTLINER_JS}
      const seeds = JSON.parse(document.getElementById("verse-seeds").textContent);
      const chapterDisplay = ${JSON.stringify(display)};
      // slug → { api, noteEl }
      const editors = new Map();
      let anchorV = null;       // last plain-clicked verse number (shift+click base)
      let selRange = null;      // { lo, hi } while a multi-verse selection is active
      let pickRangeEnd = false; // long-press started; next verse tap completes range
      // Ignore dismiss/click noise right after opening a passage note (drag/shift tail events).
      let suppressDismissUntil = 0;
      document.querySelector(".verse.hl")?.scrollIntoView({ block: "center" });

      function verseNum(el) {
        if (!el) return null;
        const n = Number(el.dataset.v);
        return Number.isFinite(n) ? n : null;
      }

      function verseEl(n) {
        return document.getElementById("v" + n);
      }

      function outlineHtml(blocks) {
        const items = blocks || [];
        if (!items.length) return "";
        return '<div class="outline">' + items.map(b => {
          const depth = Math.max(0, b.indent|0);
          const empty = !(b.text && b.text.trim());
          return '<div class="oline' + (empty ? ' blank' : '') + '" style="--depth:' + depth + '">' +
            '<span class="odot" aria-hidden="true"></span>' +
            '<span class="otxt">' + (empty ? "" : formatBlockHtml(b.text)) + '</span></div>';
        }).join("") + '</div>';
      }

      function statusElFor(noteEl) {
        const verse = noteEl.closest(".verse");
        if (verse) return verse.querySelector(".vstatus");
        return null;
      }

      function clearSelection() {
        selRange = null;
        document.querySelectorAll(".verse.sel").forEach((v) => {
          v.classList.remove("sel", "sel-lo", "sel-hi");
        });
        document.body.classList.remove("pick-range-end");
        pickRangeEnd = false;
      }

      function dismissSuppressed() {
        return performance.now() < suppressDismissUntil;
      }

      function armDismissSuppress(ms) {
        suppressDismissUntil = performance.now() + (ms || 450);
        swallowClick = true;
      }

      /** Drop multi-verse highlight; optionally finish/close the passage note UI. */
      async function dismissMultiSelect({ closeNotes = true } = {}) {
        if (dismissSuppressed()) return;
        const range = selRange ? { ...selRange } : null;
        const wasPicking = pickRangeEnd;
        clearSelection();
        if (!closeNotes) return;
        if (range && range.lo !== range.hi) {
          const host = verseEl(range.hi);
          if (host) {
            await closeAllOnVerse(host);
            host.classList.remove("notes-open", "editing");
          }
        } else if (wasPicking && anchorV != null) {
          verseEl(anchorV)?.classList.remove("notes-open", "editing");
        }
        syncAllHasNotes();
      }

      function paintSelection(lo, hi) {
        const a = Math.min(lo, hi), b = Math.max(lo, hi);
        selRange = { lo: a, hi: b };
        document.querySelectorAll(".verse").forEach((v) => {
          const n = verseNum(v);
          const on = n != null && n >= a && n <= b;
          v.classList.toggle("sel", on);
          v.classList.toggle("sel-lo", on && n === a);
          v.classList.toggle("sel-hi", on && n === b);
        });
      }

      function rangeSlug(lo, hi) {
        const a = Math.min(lo, hi), b = Math.max(lo, hi);
        const el = verseEl(a);
        if (!el) return null;
        const m = String(el.dataset.slug || "").match(/^(.*)\\.(\\d+)$/);
        if (!m) return null;
        if (a === b) return m[1] + "." + a;
        return m[1] + "." + a + "-" + b;
      }

      function rangeLabel(lo, hi) {
        const a = Math.min(lo, hi), b = Math.max(lo, hi);
        if (a === b) return chapterDisplay + ":" + a;
        return chapterDisplay + ":" + a + "\\u2013" + b;
      }

      function noteHasContent(noteEl) {
        if (!noteEl) return false;
        if (noteEl.dataset.encrypted === "1") return true;
        const blocks = seeds[noteEl.dataset.slug];
        if (blocks) return blocks.some((b) => b.text.trim());
        return !!noteEl.querySelector(".oline:not(.blank), .otxt");
      }

      /** Recompute gutter rails from real note content only (never from bare selection). */
      function syncAllHasNotes() {
        const cover = new Set();
        const verseOnly = new Set();
        document.querySelectorAll(".note").forEach((n) => {
          if (!noteHasContent(n)) return;
          if (n.dataset.kind === "range") {
            let lo = Number(n.dataset.lo), hi = Number(n.dataset.hi);
            if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
              const m = String(n.dataset.slug || "").match(/\\.(\\d+)-(\\d+)$/);
              if (m) { lo = Number(m[1]); hi = Number(m[2]); }
            }
            if (Number.isFinite(lo) && Number.isFinite(hi)) {
              for (let i = lo; i <= hi; i++) cover.add(i);
            }
            // host verse always
            const host = n.closest(".verse");
            const hv = verseNum(host);
            if (hv != null) cover.add(hv);
          } else if (n.dataset.kind === "verse") {
            const host = n.closest(".verse");
            const hv = verseNum(host);
            if (hv != null) {
              cover.add(hv);
              verseOnly.add(hv);
            }
          }
        });
        document.querySelectorAll(".verse").forEach((v) => {
          const n = verseNum(v);
          v.classList.toggle("has-notes", n != null && cover.has(n));
          v.classList.toggle("has-verse-note", n != null && verseOnly.has(n));
        });
      }

      function syncHasNotes(verse) {
        // Keep single-verse callers cheap; full recompute is correct for ranges.
        syncAllHasNotes();
        if (verse) { /* verse param retained for call sites */ }
      }

      async function closeNoteEditor(slug) {
        const ed = editors.get(slug);
        if (!ed) return;
        const { api, noteEl } = ed;
        const kind = noteEl.dataset.kind;
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
          // drop empty passage group shell
          if (verse) {
            verse.querySelectorAll(".note-group").forEach((g) => {
              if (!g.querySelector(".note")) g.remove();
            });
            if (!verse.querySelector(".note")) verse.classList.remove("notes-open");
          }
        } else {
          seeds[slug] = blocks;
          body.innerHTML = outlineHtml(blocks);
          if (verse) verse.classList.add("notes-open", "has-notes");
        }
        syncAllHasNotes();
        if (!editors.size && kind === "range") clearSelection();
        syncExpandNotesBtn();
      }

      async function closeAllOnVerse(verse) {
        const slugs = [...editors.entries()]
          .filter(([, ed]) => ed.noteEl.closest(".verse") === verse)
          .map(([slug]) => slug);
        for (const slug of slugs) await closeNoteEditor(slug);
      }

      function openNoteEditor(noteEl) {
        const slug = noteEl.dataset.slug;
        // Encrypted notes have no plaintext seeds — open full editor unlock flow.
        if (noteEl.dataset.encrypted === "1") {
          location.href = BASE + "/note/" + slug;
          return;
        }
        if (editors.has(slug)) { editors.get(slug).api.focus(); return; }
        const verse = noteEl.closest(".verse");
        if (verse) verse.classList.add("notes-open", "editing");
        noteEl.classList.add("editing");
        const host = noteEl.querySelector(".note-edit");
        host.hidden = false;
        host.innerHTML = "";
        // Keep / restore range address label so scope stays obvious while writing.
        if (noteEl.dataset.kind === "range") {
          let lab = noteEl.querySelector(".note-label");
          if (!lab) {
            lab = document.createElement("div");
            lab.className = "note-label";
            noteEl.insertBefore(lab, noteEl.firstChild);
          }
          if (!lab.textContent.trim()) {
            const m = String(slug).match(/\\.(\\d+)-(\\d+)$/);
            if (m) lab.textContent = rangeLabel(Number(m[1]), Number(m[2]));
            else lab.textContent = slug;
          }
        }
        // Label already names the passage — keep the field quiet.
        const ph = "Write\\u2026";
        const api = mountOutliner(host, {
          slug,
          blocks: seeds[slug] || [{ id: newId(), indent: 0, text: "" }],
          statusEl: statusElFor(noteEl),
          compact: true,
          autofocus: true,
          placeholder: ph,
        });
        editors.set(slug, { api, noteEl });
      }

      function openVerseNoteEditor(verse) {
        let el = verse.querySelector('.note[data-kind="verse"]');
        if (!el) {
          // place under verse-local group when passage notes already exist
          let host = verse.querySelector(".vnotes");
          let group = host.querySelector(".note-group.verse-local");
          if (!group && host.querySelector(".note-group.passage")) {
            group = document.createElement("div");
            group.className = "note-group verse-local";
            group.innerHTML = '<div class="note-group-title">This verse</div>';
            host.appendChild(group);
            host = group;
          } else if (group) {
            host = group;
          }
          host.insertAdjacentHTML("beforeend",
            '<div class="note" data-kind="verse" data-slug="' + verse.dataset.slug + '">' +
            '<div class="note-body"></div><div class="note-edit" hidden></div></div>');
          el = verse.querySelector('.note[data-kind="verse"]');
        }
        openNoteEditor(el);
      }

      function ensurePassageNoteEl(lo, hi) {
        const a = Math.min(lo, hi), b = Math.max(lo, hi);
        const slug = rangeSlug(a, b);
        if (!slug) return null;
        // Sit under the *last* verse so the full passage reads above the note.
        const hostVerse = verseEl(b);
        if (!hostVerse) return null;
        let el = document.querySelector('.note[data-slug="' + CSS.escape(slug) + '"]');
        if (el) {
          // Re-home under end verse if an older render left it on the start.
          const owner = el.closest(".verse");
          if (owner && owner !== hostVerse) {
            let group = hostVerse.querySelector(".vnotes .note-group.passage");
            if (!group) {
              group = document.createElement("div");
              group.className = "note-group passage";
              const local = hostVerse.querySelector(".vnotes .note-group.verse-local");
              const vnotes = hostVerse.querySelector(".vnotes");
              if (local) vnotes.insertBefore(group, local);
              else vnotes.appendChild(group);
            }
            group.appendChild(el);
            const oldGroup = owner.querySelector(".note-group.passage");
            if (oldGroup && !oldGroup.querySelector(".note")) oldGroup.remove();
          }
          let lab = el.querySelector(".note-label");
          if (!lab) {
            lab = document.createElement("div");
            lab.className = "note-label";
            el.insertBefore(lab, el.firstChild);
          }
          lab.textContent = rangeLabel(a, b);
          return el;
        }
        const vnotes = hostVerse.querySelector(".vnotes");
        let group = vnotes.querySelector(".note-group.passage");
        if (!group) {
          group = document.createElement("div");
          group.className = "note-group passage";
          const local = vnotes.querySelector(".note-group.verse-local");
          if (local) vnotes.insertBefore(group, local);
          else vnotes.appendChild(group);
        }
        const local = vnotes.querySelector(".note-group.verse-local");
        if (local && !local.querySelector(".note-group-title") && local.querySelector(".note")) {
          local.insertAdjacentHTML("afterbegin", '<div class="note-group-title">This verse</div>');
        }
        if (local && local.querySelector(".note") && !group.querySelector(".note-group-title")) {
          group.insertAdjacentHTML("afterbegin", '<div class="note-group-title">Passage</div>');
        }
        const labelHtml = '<div class="note-label">' + rangeLabel(a, b).replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>';
        group.insertAdjacentHTML("beforeend",
          '<div class="note" data-kind="range" data-slug="' + slug + '" data-lo="' + a + '" data-hi="' + b + '">' +
          labelHtml +
          '<div class="note-body"></div><div class="note-edit" hidden></div></div>');
        return group.querySelector('.note[data-slug="' + CSS.escape(slug) + '"]');
      }

      /** Open exactly one passage note for lo–hi and focus its editor. */
      function openPassageNote(lo, hi) {
        const a = Math.min(lo, hi), b = Math.max(lo, hi);
        pickRangeEnd = false;
        document.body.classList.remove("pick-range-end");
        armDismissSuppress(500);
        if (a === b) {
          clearSelection();
          const verse = verseEl(a);
          if (!verse) return;
          anchorV = a;
          openVerseNoteEditor(verse);
          return;
        }
        paintSelection(a, b);
        const last = verseEl(b);
        if (!last) return;
        // Close any other open verse trays so only this passage note is front-and-center.
        document.querySelectorAll(".verse.notes-open, .verse.editing").forEach((v) => {
          if (v !== last) {
            v.classList.remove("notes-open", "editing");
          }
        });
        // Close other inline editors (single focus).
        for (const [slug, ed] of [...editors.entries()]) {
          if (ed.noteEl.dataset.slug !== rangeSlug(a, b)) {
            // fire-and-forget flush of unrelated editors
            closeNoteEditor(slug);
          }
        }
        const targetSlug = rangeSlug(a, b);
        // Close other inline editors so only this passage note is open.
        for (const [slug] of [...editors.entries()]) {
          if (slug !== targetSlug) closeNoteEditor(slug);
        }
        last.classList.add("notes-open", "editing");
        const el = ensurePassageNoteEl(a, b);
        if (!el) return;
        openNoteEditor(el);
        syncExpandNotesBtn();
        // Bring the note (under last verse) into view after the passage.
        last.scrollIntoView({ block: "nearest" });
        // Focus after layout so the outliner caret lands cleanly.
        requestAnimationFrame(() => {
          const ed = editors.get(el.dataset.slug);
          if (ed) ed.api.focus();
        });
      }

      function rangeNoteForVerse(v) {
        for (const el of document.querySelectorAll('.note[data-kind="range"]')) {
          if (!noteHasContent(el) && !editors.has(el.dataset.slug)) continue;
          let lo = Number(el.dataset.lo), hi = Number(el.dataset.hi);
          if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
            const m = String(el.dataset.slug || "").match(/\\.(\\d+)-(\\d+)$/);
            if (!m) continue;
            lo = Number(m[1]); hi = Number(m[2]);
          }
          if (v >= lo && v <= hi) return el;
        }
        return null;
      }

      function activateVerseClick(verse, { shiftKey = false } = {}) {
        const v = verseNum(verse);
        if (v == null) return;

        // long-press pick mode: same verse again cancels; other verse completes range
        if (pickRangeEnd && anchorV != null && !shiftKey) {
          if (v === anchorV) {
            dismissMultiSelect({ closeNotes: false });
            return;
          }
          openPassageNote(anchorV, v);
          return;
        }

        // shift+click → passage from last anchor (or this verse alone)
        if (shiftKey) {
          const base = anchorV != null ? anchorV : v;
          anchorV = base;
          openPassageNote(base, v);
          return;
        }

        // multi-verse select active: click inside = unselect; outside = clear then act
        if (selRange && selRange.lo !== selRange.hi) {
          if (dismissSuppressed()) return;
          const inSel = v >= selRange.lo && v <= selRange.hi;
          dismissMultiSelect({ closeNotes: true }).then(() => {
            anchorV = v;
            if (inSel) return; // unselect only
            activateVerseClick(verse, { shiftKey: false });
          });
          return;
        }

        anchorV = v;

        // verse text = all-or-none toggle; while editing, finish + hide
        const editingHere = [...editors.values()].some(ed => ed.noteEl.closest(".verse") === verse);
        if (editingHere) {
          closeAllOnVerse(verse).then(() => {
            verse.classList.remove("notes-open");
            clearSelection();
            syncAllHasNotes();
            syncExpandNotesBtn();
          });
          return;
        }
        if (verse.classList.contains("notes-open")) {
          verse.classList.remove("notes-open");
          clearSelection();
          syncExpandNotesBtn();
          return;
        }
        // Prefer this verse's own note tray when it has content. A covering
        // multi-verse passage must not steal the click (e.g. JHN.3.16 under 16–18).
        const localVerseNote = verse.querySelector('.note[data-kind="verse"]');
        const hasLocalVerse = localVerseNote && noteHasContent(localVerseNote);
        if (hasLocalVerse || verse.querySelector('.note[data-kind="verse"] .oline, .note[data-kind="verse"] .otxt')) {
          verse.classList.add("notes-open");
          const only = verse.querySelectorAll(".vnotes .note");
          // Single local note → edit-ready; multiple (passage host + verse) → show tray.
          if (only.length === 1) openNoteEditor(only[0]);
          syncExpandNotesBtn();
          return;
        }
        // No local verse note: open a multi-verse passage that covers this verse.
        const rangeNote = rangeNoteForVerse(v);
        if (rangeNote) {
          const lo = Number(rangeNote.dataset.lo);
          const hi = Number(rangeNote.dataset.hi);
          if (Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi) {
            openPassageNote(lo, hi);
            return;
          }
        }
        // Other local content (e.g. only a hosted range on this end verse) or empty.
        if (verse.classList.contains("has-notes") || verse.querySelector(".note .oline, .note .otxt")) {
          verse.classList.add("notes-open");
          const only = verse.querySelectorAll(".vnotes .note");
          if (only.length === 1) openNoteEditor(only[0]);
          syncExpandNotesBtn();
          return;
        }
        openVerseNoteEditor(verse);
        syncExpandNotesBtn();
      }

      // --- multi-verse: mouse drag + long-press (touch) ---
      let drag = null; // { startV, pointerId, moved, longTimer }
      let swallowClick = false; // true after pointer path already handled the gesture
      const LONG_MS = 480;

      function verseFromPoint(x, y) {
        const stack = document.elementsFromPoint(x, y);
        for (const node of stack) {
          const v = node.closest?.(".verse");
          if (v && v.dataset.v) return v;
        }
        return null;
      }

      function endDrag(e, commit) {
        if (!drag) return;
        if (drag.longTimer) clearTimeout(drag.longTimer);
        document.body.classList.remove("selecting-verses");
        const d = drag;
        drag = null;
        // Always release capture from the verse that took it (not e.target —
        // capture retargets events, so target may not own the capture).
        try {
          const capturer = verseEl(d.startV);
          if (capturer && d.pointerId != null && capturer.releasePointerCapture) {
            capturer.releasePointerCapture(d.pointerId);
          }
        } catch (_) {}
        if (!commit) return;

        // multi-verse drag (mouse, or touch after long-press)
        if (d.moved && d.curV != null && d.curV !== d.startV) {
          armDismissSuppress(500);
          openPassageNote(d.startV, d.curV);
          return;
        }
        // long-press without drag → wait for end verse
        if (d.longPressed && !d.moved) {
          swallowClick = true;
          pickRangeEnd = true;
          document.body.classList.add("pick-range-end");
          anchorV = d.startV;
          paintSelection(d.startV, d.startV);
          return;
        }
        // Plain tap/click: activate here. Do not rely on the synthetic click —
        // setPointerCapture makes click.target the .verse, so closest(".vtext")
        // fails and the click listener used to no-op (single-verse expand broken).
        if (!d.moved && !d.longPressed) {
          swallowClick = true;
          const verse = verseEl(d.startV);
          if (verse) activateVerseClick(verse, { shiftKey: !!d.shiftKey });
        }
      }

      /** True when the event is on verse scripture text (not the note tray). */
      function isVerseTextTarget(el) {
        if (!el || !el.closest) return false;
        const verse = el.closest(".verse");
        if (!verse) return false;
        if (el.closest(".vnotes, .note, .note-edit, .outliner, .otext, .obullet, .note-body, .note-label")) {
          return false;
        }
        // .vtext, its children (sup, status), or the .verse shell itself after capture
        return !!(el.closest(".vtext") || el === verse || verse.contains(el));
      }

      document.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest("a, .otext, .obullet, .outliner, .note-edit, .note-body, .note-label")) return;
        const verse = e.target.closest(".verse");
        if (!verse || !isVerseTextTarget(e.target)) return;
        const v = verseNum(verse);
        if (v == null) return;
        swallowClick = false;
        drag = {
          startV: v,
          curV: v,
          pointerId: e.pointerId,
          pointerType: e.pointerType || "mouse",
          moved: false,
          longPressed: false,
          shiftKey: e.shiftKey,
          longTimer: null,
        };
        // mouse: drag-select across verses; touch: long-press then pick end
        if ((e.pointerType || "mouse") === "mouse") {
          try { verse.setPointerCapture(e.pointerId); } catch (_) {}
        } else {
          drag.longTimer = setTimeout(() => {
            if (!drag || drag.moved) return;
            drag.longPressed = true;
            anchorV = drag.startV;
            paintSelection(drag.startV, drag.startV);
            if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
          }, LONG_MS);
        }
      });

      document.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const over = verseFromPoint(e.clientX, e.clientY);
        const n = over ? verseNum(over) : null;
        if (n == null) return;
        if (n !== drag.curV || n !== drag.startV) {
          if (n === drag.startV && !drag.moved) return;
          // touch: only drag-extend after long-press (avoids scroll-as-select)
          if (drag.pointerType !== "mouse" && !drag.longPressed) {
            if (drag.longTimer) { clearTimeout(drag.longTimer); drag.longTimer = null; }
            return;
          }
          if (n !== drag.startV) {
            if (drag.longTimer) { clearTimeout(drag.longTimer); drag.longTimer = null; }
            drag.moved = true;
            drag.curV = n;
            document.body.classList.add("selecting-verses");
            paintSelection(drag.startV, n);
          }
        }
      });

      document.addEventListener("pointerup", (e) => endDrag(e, true));
      document.addEventListener("pointercancel", (e) => endDrag(e, false));

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

        // pointer path already handled (plain click, drag, touch, long-press, passage open)
        if (swallowClick || dismissSuppressed()) {
          swallowClick = false;
          return;
        }

        const verse = e.target.closest(".verse");
        // click outside scripture (or on note tray) → unselect multi-verse
        if (!verse || !isVerseTextTarget(e.target)) {
          if ((selRange && selRange.lo !== selRange.hi) || pickRangeEnd) {
            // clicks inside the open passage note/editor must not dismiss
            if (!e.target.closest(".note, .vnotes, .chapter-note, .outliner, .note-edit")) {
              dismissMultiSelect({ closeNotes: true });
            }
          }
          return;
        }

        // Fallback if pointerdown didn't run (e.g. keyboard-activated click)
        activateVerseClick(verse, { shiftKey: e.shiftKey });
      });

      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (editors.size) {
          e.preventDefault();
          const last = [...editors.keys()].pop();
          closeNoteEditor(last).then(syncExpandNotesBtn);
          return;
        }
        if (pickRangeEnd || (selRange && selRange.lo !== selRange.hi)) {
          e.preventDefault();
          dismissMultiSelect({ closeNotes: true }).then(syncExpandNotesBtn);
          return;
        }
        if (selRange) {
          e.preventDefault();
          clearSelection();
          return;
        }
        // With all notes open (VBV), Esc collapses everything in one step.
        if (allNotesExpanded()) {
          e.preventDefault();
          collapseAllNotes();
          return;
        }
        const open = document.querySelector(".verse.notes-open");
        if (open) {
          e.preventDefault();
          open.classList.remove("notes-open");
          clearSelection();
          syncExpandNotesBtn();
        }
      });

      // --- expand / collapse all verse notes (VBV analysis) ---
      function versesWithNoteEls() {
        return [...document.querySelectorAll(".verse")].filter((v) =>
          v.querySelector(".vnotes .note")
        );
      }

      function allNotesExpanded() {
        const vs = versesWithNoteEls();
        return vs.length > 0 && vs.every((v) => v.classList.contains("notes-open"));
      }

      function syncExpandNotesBtn() {
        const btn = document.getElementById("expand-notes");
        if (!btn) return;
        const vs = versesWithNoteEls();
        if (!vs.length) {
          btn.hidden = true;
          return;
        }
        btn.hidden = false;
        const open = allNotesExpanded();
        btn.textContent = open ? "collapse notes" : "expand notes";
        btn.setAttribute("aria-pressed", open ? "true" : "false");
        btn.setAttribute(
          "aria-label",
          open ? "Collapse all verse notes" : "Expand all verse notes"
        );
      }

      function expandAllNotes() {
        clearSelection();
        // View only — do not open editors. Show every note tray that has content.
        versesWithNoteEls().forEach((v) => v.classList.add("notes-open"));
        syncExpandNotesBtn();
      }

      async function collapseAllNotes() {
        clearSelection();
        for (const slug of [...editors.keys()]) {
          await closeNoteEditor(slug);
        }
        document.querySelectorAll(".verse.notes-open, .verse.editing").forEach((v) => {
          v.classList.remove("notes-open", "editing");
        });
        syncExpandNotesBtn();
      }

      document.getElementById("expand-notes")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (allNotesExpanded()) collapseAllNotes();
        else expandAllNotes();
      });

      // deep-link: same selection chrome for single- and multi-verse; open notes on target
      const hlVerses = [...document.querySelectorAll(".verse.hl")];
      if (hlVerses.length) {
        const nums = hlVerses.map(verseNum).filter((n) => n != null);
        if (nums.length) paintSelection(Math.min(...nums), Math.max(...nums));
      }
      document.querySelectorAll(".verse.hl.has-notes").forEach((v) => v.classList.add("notes-open"));
      syncExpandNotesBtn();
    </script>`,
  );
}

// ---------- http ----------

/** CORS for API routes. Door path is the access key; CORS is for browser SPAs. */
function corsDisabled() {
  const v = CORS_ORIGIN_RAW;
  return v === "off" || v === "0" || v === "false" || v === "no";
}

function applyCors(req, res) {
  if (corsDisabled()) return;
  const conf = CORS_ORIGIN_RAW == null || CORS_ORIGIN_RAW === "" ? "*" : CORS_ORIGIN_RAW.trim();
  let allow = "*";
  if (conf !== "*") {
    const allowed = conf.split(",").map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) allow = origin;
    else if (allowed.length) allow = allowed[0];
    else allow = "*";
    if (allow !== "*") res.setHeader("vary", "origin");
  }
  res.setHeader("access-control-allow-origin", allow);
  res.setHeader("access-control-allow-methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, x-filename, accept");
  res.setHeader("access-control-max-age", "86400");
  res.setHeader("access-control-expose-headers", "content-type, content-disposition, content-length");
}

function protocolInfo() {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    door: !DOOR_OPEN && !!DOOR,
    door_open: DOOR_OPEN,
    cors: !corsDisabled(),
    max_attach_bytes: MAX_ATTACH_BYTES,
    features: {
      notes: true,
      attachments: true,
      encryption: true,
      suggest: true,
      resolve: true,
      share_qr: !DOOR_OPEN && !!DOOR,
    },
    endpoints: [
      "GET /api/protocol",
      "GET /api/notes",
      "GET /api/resolve?q=",
      "GET /api/suggest?q=&limit=",
      "GET /api/note/<slug>",
      "GET /api/note/<slug>?raw",
      "PUT /api/note/<slug>",
      "POST /api/note/<slug>/attachments",
      "DELETE /api/note/<slug>/attachments/<att_id>",
      "GET /api/attachments/<sha256>",
      "GET /api/share-qr?origin=",
    ],
    schemas: "schemas/",
    docs: {
      protocol: "PROTOCOL.md",
      http: "docs/API.md",
      llms: "llms.txt",
    },
  };
}

const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj, null, 2) + "\n");
};
const html = (res, code, body) => {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
};

async function readBodyBuffer(req, maxBytes = MAX_ATTACH_BYTES) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > maxBytes) throw new Error(`body too large (max ${maxBytes} bytes)`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  return (await readBodyBuffer(req)).toString("utf8");
}

async function attachmentReferenced(sha256, exceptSlug = null) {
  for (const n of await listNotes()) {
    if (exceptSlug && n.scope.slug === exceptSlug) continue;
    if ((n.attachments || []).some((a) => a.kind === "file" && a.sha256 === sha256)) return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let p = url.pathname;

    // ----- sign-in (multiword key in the URL path) -----
    // GET /enter?door=… or /login?door=…  →  /{key}/
    if (req.method === "GET" && (p === "/enter" || p === "/enter/" || p === "/login" || p === "/login/")) {
      const phrase = normalizeDoorPhrase(url.searchParams.get("door") || url.searchParams.get("q") || "");
      const local = isLocalClient(req);
      if (!phrase) {
        return html(res, 200, renderEnterDoor({
          error: "Enter your key to open your notes.",
          local,
        }));
      }
      if (!DOOR_OPEN && phrase !== DOOR) {
        return html(res, 200, renderEnterDoor({
          error: "That key didn’t work. Check the words and try again.",
          local,
        }));
      }
      res.writeHead(302, { location: `/${phrase}/`, "cache-control": "no-store" });
      return res.end();
    }

    // bare / without door → sign-in (local clients get one-tap open)
    if (!DOOR_OPEN && (p === "/" || p === "")) {
      return html(res, 200, renderEnterDoor({ local: isLocalClient(req) }));
    }

    const routed = routePath(p);
    if (!routed.ok) {
      if (routed.needDoor) {
        return html(res, 200, renderEnterDoor({ local: isLocalClient(req) }));
      }
      // wrong key: do not confirm whether a pack exists
      return html(res, 404, page("keyverse", `<div class="login">
        <h1>keyverse</h1>
        <p class="lead">Nothing here.</p>
        <p class="muted"><a href="/">Sign in</a></p>
      </div>`));
    }
    p = routed.path;
    // normalize trailing slash on app root inside door
    if (p === "") p = "/";

    // CORS + preflight for all /api/* (browser SPAs against the door)
    if (p === "/api" || p.startsWith("/api/")) {
      applyCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
    }

    if (req.method === "GET" && p === "/") return html(res, 200, await renderIndex());

    // GET /api/protocol — version + feature discovery (interop)
    if (req.method === "GET" && p === "/api/protocol") {
      return json(res, 200, protocolInfo());
    }

    // GET /api/resolve?q=John+3:16 — normalize human ref → scope (no note IO)
    if (req.method === "GET" && p === "/api/resolve") {
      const q = String(url.searchParams.get("q") || "").slice(0, 200);
      if (!q.trim()) return json(res, 400, { ok: false, error: "missing q" });
      const scope = parseScope(q);
      if (!scope) return json(res, 400, { ok: false, error: "invalid passage address", q });
      let label = scope.osis;
      try {
        label = formatPassageForDisplay(scope.parsed) || scope.osis;
      } catch { /* keep osis */ }
      return json(res, 200, {
        ok: true,
        q,
        scope: { kind: scope.kind, osis: scope.osis, slug: scope.slug },
        label,
      });
    }

    // GET /api/share-qr?origin=https%3A%2F%2Fhost — SVG QR for this pack’s door URL
    if (req.method === "GET" && p === "/api/share-qr") {
      if (DOOR_OPEN || !DOOR) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end("no door");
      }
      const packUrl = packShareUrl(req, url.searchParams.get("origin"));
      try {
        const svg = await shareQrSvg(packUrl);
        res.writeHead(200, {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "private, max-age=300",
        });
        return res.end(svg);
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        return res.end("qr failed");
      }
    }

    // GET /api/suggest?q=john+3  — passage reference autocomplete (grab-bcv)
    if (req.method === "GET" && p === "/api/suggest") {
      const q = String(url.searchParams.get("q") || "").slice(0, 80);
      const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit")) || 8));
      let suggestions = [];
      try {
        if (q.trim()) suggestions = autocompletePassage(q, { limit });
      } catch {
        suggestions = [];
      }
      return json(res, 200, {
        q,
        suggestions: suggestions.map((s) => ({
          label: s.label,
          insertText: s.insertText,
          canonical: s.canonical,
          kind: s.kind,
        })),
      });
    }

    if (req.method === "GET" && p === "/go") {
      const scope = parseScope(url.searchParams.get("q") || "");
      if (!scope) {
        return html(res, 200, page("keyverse", `<p>Could not parse that passage. <a href="${u("/")}">Back</a></p>`));
      }
      // chapters open as readable, annotatable text; verses/ranges as editors
      res.writeHead(302, {
        location: u(`${scope.kind === "chapter" ? "/read" : "/note"}/${scope.slug}`),
      });
      return res.end();
    }

    const readMatch = p.match(/^\/read\/([a-z0-9.\-]+)$/i);
    if (req.method === "GET" && readMatch) {
      const scope = parseScope(readMatch[1]);
      if (!scope) {
        return html(res, 404, page("not found", `<p>Not a valid passage address. <a href="${u("/")}">Back</a></p>`));
      }
      if (scope.slug !== readMatch[1]) {
        res.writeHead(302, { location: u(`/read/${scope.slug}`) });
        return res.end();
      }
      return html(res, 200, await renderRead(scope));
    }

    const noteMatch = p.match(/^\/note\/([a-z0-9.\-]+)$/i);
    if (req.method === "GET" && noteMatch) {
      const scope = parseScope(noteMatch[1]);
      if (!scope) {
        return html(res, 404, page("not found", `<p>Not a valid passage address. <a href="${u("/")}">Back</a></p>`));
      }
      if (scope.slug !== noteMatch[1]) {
        res.writeHead(302, { location: u(`/note/${scope.slug}`) });
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
          if (isEncryptedNote(note)) {
            return json(res, 409, { error: "encrypted", message: "note is encrypted; raw plaintext unavailable" });
          }
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          return res.end(serializeBlocks(note.blocks) + "\n");
        }
        return json(res, 200, note);
      }

      if (req.method === "PUT") {
        const raw = await readBody(req);
        const existing = await readNote(scope.slug);
        const ct = (req.headers["content-type"] || "").toLowerCase();

        // Client-side encrypted envelope (cowyo-style). Server stores ciphertext only.
        if (ct.includes("application/json")) {
          let parsed;
          try {
            parsed = JSON.parse(raw || "null");
          } catch {
            return json(res, 400, { error: "invalid json" });
          }
          if (parsed && parsed.encrypted === true) {
            const cipher = normalizeCipher(parsed.cipher);
            if (!cipher) return json(res, 400, { error: "invalid cipher envelope" });
            const now = new Date().toISOString();
            const note = {
              id: existing?.id || `note_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
              scope: { kind: scope.kind, osis: scope.osis, slug: scope.slug },
              encrypted: true,
              cipher,
              blocks: [],
              attachments: [],
              created_at: existing?.created_at || now,
              updated_at: now,
            };
            await writeNote(note);
            return json(res, 200, note);
          }

          let blocks;
          let attachments;
          const list = Array.isArray(parsed) ? parsed : parsed?.blocks;
          blocks = normalizeBlocks(list);
          // omit attachments key → preserve; explicit array replaces
          // if previous note was encrypted, do not rehydrate ghost plaintext attachments
          if (Array.isArray(parsed) || !parsed || !("attachments" in parsed)) {
            attachments = isEncryptedNote(existing) ? [] : (existing?.attachments || []);
          } else {
            attachments = normalizeAttachments(parsed.attachments);
          }

          if (blocksAreEmpty(blocks) && !(attachments && attachments.length)) {
            if (existing) {
              for (const a of existing.attachments || []) {
                if (a.kind === "file" && a.sha256 && !(await attachmentReferenced(a.sha256, scope.slug))) {
                  const p = attachBlobPath(a.sha256);
                  if (p) await unlink(p).catch(() => {});
                }
              }
              await unlink(notePath(scope.slug)).catch(() => {});
            }
            return json(res, 200, { deleted: true, slug: scope.slug });
          }

          if (blocksAreEmpty(blocks)) {
            blocks = [{ id: newBlockId(), indent: 0, text: "" }];
          }

          const now = new Date().toISOString();
          const note = {
            id: existing?.id || `note_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
            scope: { kind: scope.kind, osis: scope.osis, slug: scope.slug },
            blocks,
            attachments,
            created_at: existing?.created_at || now,
            updated_at: now,
          };
          await writeNote(note);
          return json(res, 200, note);
        }

        // plain text interchange (curl): 2 spaces = one indent level
        // cannot update encrypted notes via raw text without wiping the seal
        if (isEncryptedNote(existing)) {
          return json(res, 409, {
            error: "encrypted",
            message: "note is encrypted; send application/json {encrypted:true,cipher} or unlock client-side and save plaintext",
          });
        }

        let blocks;
        let attachments;
        if (!raw.trim()) {
          if (existing) {
            for (const a of existing.attachments || []) {
              if (a.kind === "file" && a.sha256 && !(await attachmentReferenced(a.sha256, scope.slug))) {
                const p = attachBlobPath(a.sha256);
                if (p) await unlink(p).catch(() => {});
              }
            }
            await unlink(notePath(scope.slug)).catch(() => {});
          }
          return json(res, 200, { deleted: true, slug: scope.slug });
        }
        blocks = reconcileBlocks(raw, existing?.blocks);
        attachments = existing?.attachments || [];

        if (blocksAreEmpty(blocks) && !(attachments && attachments.length)) {
          if (existing) {
            for (const a of existing.attachments || []) {
              if (a.kind === "file" && a.sha256 && !(await attachmentReferenced(a.sha256, scope.slug))) {
                const p = attachBlobPath(a.sha256);
                if (p) await unlink(p).catch(() => {});
              }
            }
            await unlink(notePath(scope.slug)).catch(() => {});
          }
          return json(res, 200, { deleted: true, slug: scope.slug });
        }

        // empty blocks but has attachments: keep a single blank bullet so the note stays open
        if (blocksAreEmpty(blocks)) {
          blocks = [{ id: newBlockId(), indent: 0, text: "" }];
        }

        const now = new Date().toISOString();
        const note = {
          id: existing?.id || `note_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          scope: { kind: scope.kind, osis: scope.osis, slug: scope.slug },
          blocks,
          attachments,
          created_at: existing?.created_at || now,
          updated_at: now,
        };
        await writeNote(note);
        return json(res, 200, note);
      }
    }

    // POST /api/note/:slug/attachments  — file (raw) or URL (json)
    // When the note is encrypted, store CAS blobs (files) but do not write
    // plaintext metadata onto the note — client folds att into the next cipher PUT.
    const attPost = p.match(/^\/api\/note\/([a-z0-9.\-]+)\/attachments$/i);
    if (req.method === "POST" && attPost) {
      const scope = parseScope(attPost[1]);
      if (!scope) return json(res, 400, { error: "invalid passage address" });
      let note = await readNote(scope.slug);
      const sealed = isEncryptedNote(note);
      if (!note) {
        const now = new Date().toISOString();
        note = {
          id: `note_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`,
          scope: { kind: scope.kind, osis: scope.osis, slug: scope.slug },
          blocks: [{ id: newBlockId(), indent: 0, text: "" }],
          attachments: [],
          created_at: now,
          updated_at: now,
        };
      }
      const ct = (req.headers["content-type"] || "").toLowerCase();
      const now = new Date().toISOString();
      let meta;
      if (ct.includes("application/json")) {
        let parsed;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { error: "invalid json" });
        }
        if (parsed?.kind === "url" || parsed?.url) {
          const url = String(parsed.url || "").trim();
          if (!/^https?:\/\//i.test(url)) return json(res, 400, { error: "url must be http(s)" });
          meta = {
            id: newAttId(),
            kind: "url",
            url,
            title: parsed.title != null ? String(parsed.title) : undefined,
            created_at: now,
          };
        } else {
          return json(res, 400, { error: "expected {kind:'url', url}" });
        }
      } else {
        // any content-type: store as file
        let buf;
        try {
          buf = await readBodyBuffer(req);
        } catch (err) {
          return json(res, 413, { error: String(err.message || err) });
        }
        if (!buf.length) return json(res, 400, { error: "empty body" });
        const sha256 = await writeAttachmentBlob(buf);
        const name = String(req.headers["x-filename"] || "file").replace(/[/\\]/g, "_").slice(0, 500);
        const mime = (req.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
        meta = {
          id: newAttId(),
          kind: "file",
          name,
          mime,
          sha256,
          bytes: buf.length,
          created_at: now,
        };
      }
      if (sealed) {
        // ciphertext on disk stays sealed; client merges `attachment` into next encrypt save
        return json(res, 200, { encrypted: true, attachment: meta });
      }
      note.attachments = normalizeAttachments([...(note.attachments || []), meta]);
      note.updated_at = now;
      await writeNote(note);
      return json(res, 200, note);
    }

    // DELETE /api/note/:slug/attachments/:attId
    const attDel = p.match(/^\/api\/note\/([a-z0-9.\-]+)\/attachments\/([\w.-]+)$/i);
    if (req.method === "DELETE" && attDel) {
      const scope = parseScope(attDel[1]);
      if (!scope) return json(res, 400, { error: "invalid passage address" });
      const note = await readNote(scope.slug);
      if (!note) return json(res, 404, { error: "no note at this address" });
      if (isEncryptedNote(note)) {
        // Metadata lives inside the cipher; client removes locally and re-encrypts.
        // Optional ?sha256= for GC of a known file blob after client-side remove.
        const sha = String(url.searchParams.get("sha256") || "").toLowerCase();
        if (/^[a-f0-9]{64}$/.test(sha)) {
          if (!(await attachmentReferenced(sha))) {
            const bp = attachBlobPath(sha);
            if (bp) await unlink(bp).catch(() => {});
          }
        }
        return json(res, 200, { encrypted: true, removed: attDel[2] });
      }
      const attId = attDel[2];
      const removed = (note.attachments || []).find((a) => a.id === attId);
      note.attachments = (note.attachments || []).filter((a) => a.id !== attId);
      note.updated_at = new Date().toISOString();
      await writeNote(note);
      if (removed?.kind === "file" && removed.sha256) {
        if (!(await attachmentReferenced(removed.sha256))) {
          const bp = attachBlobPath(removed.sha256);
          if (bp) await unlink(bp).catch(() => {});
        }
      }
      return json(res, 200, note);
    }

    // GET /api/attachments/:sha256
    const attGet = p.match(/^\/api\/attachments\/([a-f0-9]{64})$/i);
    if (req.method === "GET" && attGet) {
      const sha = attGet[1].toLowerCase();
      const bp = attachBlobPath(sha);
      if (!bp) return json(res, 400, { error: "invalid hash" });
      let buf;
      try {
        buf = await readFile(bp);
      } catch {
        return json(res, 404, { error: "attachment not found" });
      }
      // find a mime from any note that references this hash
      let mime = "application/octet-stream";
      let name = url.searchParams.get("name") || "file";
      for (const n of await listNotes()) {
        const a = (n.attachments || []).find((x) => x.kind === "file" && x.sha256 === sha);
        if (a) {
          mime = a.mime || mime;
          if (!url.searchParams.get("name") && a.name) name = a.name;
          break;
        }
      }
      res.writeHead(200, {
        "content-type": mime,
        "content-length": buf.length,
        "content-disposition": `inline; filename="${String(name).replace(/"/g, "")}"`,
        "cache-control": "public, max-age=31536000, immutable",
      });
      return res.end(buf);
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) });
  }
});

await ensurePack();
server.listen(PORT, HOST, () => {
  const hostLabel = HOST === "0.0.0.0" ? "localhost" : HOST;
  const root = `http://${hostLabel}:${PORT}`;
  if (DOOR_OPEN) {
    console.log(`keyverse: ${root}/  (DOOR_OPEN — open access, no key)`);
  } else {
    console.log(`keyverse: ${root}/${DOOR}/`);
    console.log(`open that link (or ${root}/ on this computer → “Open my notes”).`);
    console.log(`your key: ${DOOR}`);
  }
  console.log(`pack on disk:   ${PACK_DIR}`);
});
