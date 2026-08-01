// versepack demo — a cowyo-class capture door over an on-disk pack.
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
      JSON.stringify({ protocol: "versepack", version: "0.1-demo" }, null, 2) + "\n",
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
  .ref-search input[type=text] { margin: 0; }
  .ref-suggest {
    position: absolute; left: 0; right: 0; top: calc(100% + .25rem); z-index: 40;
    margin: 0; padding: .25rem 0; list-style: none;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    border-radius: .45rem;
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
  .door-share {
    display: inline-flex; align-items: center; gap: .35rem;
    margin: 0; padding: .2rem .45rem; border: 0; border-radius: .35rem;
    background: transparent; cursor: pointer;
    font: inherit; font-family: -apple-system, system-ui, sans-serif;
    font-size: .82rem; letter-spacing: .01em;
    color: color-mix(in srgb, currentColor 48%, transparent);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    max-width: 100%;
  }
  .door-share:hover { color: inherit; background: color-mix(in srgb, currentColor 6%, transparent); }
  .door-share:active { transform: scale(.98); }
  .door-share[data-flash="1"] { color: inherit; }
  .door-share-key {
    font-variant-ligatures: none;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: min(14rem, 42vw);
  }
  .door-share-hint {
    flex: 0 0 auto; font-size: .75rem; opacity: .7;
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
  header { display: flex; align-items: baseline; gap: .55rem; flex-wrap: wrap; margin-bottom: 1rem;
    row-gap: .35rem; }
  header h1 { font-size: 1.2rem; font-weight: 600; margin: 0; letter-spacing: -.01em;
    min-width: 0; flex: 1 1 auto; }
  #status { margin-left: auto; font-size: .8rem; color: color-mix(in srgb, currentColor 45%, transparent); }
  h2 { font-size: .9rem; font-weight: 600; margin: 1.75rem 0 .4rem;
       font-family: -apple-system, system-ui, sans-serif; }
  .note-row {
    display: block; padding: .55rem 0; text-decoration: none; color: inherit;
    border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  }
  .note-row:hover { background: color-mix(in srgb, currentColor 4%, transparent);
    margin: 0 -.35rem; padding-left: .35rem; padding-right: .35rem; border-radius: .25rem; }
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
    /* 16px minimum prevents iOS focus-zoom */
    font-size: max(1em, 16px);
  }
  .otext:empty::before { content: attr(data-placeholder); opacity: .35; pointer-events: none; }
  .outliner.compact { font-size: .9rem; }
  .outliner.compact .otext { font-size: max(0.9rem, 16px); }
  .hint { margin-top: .65rem; }

  /* nest / unnest — same quiet chrome as header links / muted UI, not filled cards */
  .outliner-shell { margin: 0; }
  .otoolbar {
    display: flex; gap: 1rem; align-items: center;
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
    header { margin-bottom: .85rem; gap: .4rem .55rem; }
    header h1 { font-size: 1.12rem; line-height: 1.25; }
    header a, #status { font-size: .82rem; }
    input[type=text] { font-size: 16px; padding: .7rem .75rem; }
    .note-row { padding: .7rem 0; min-height: 2.75rem; }
    .related-within .inbox-item { padding: .75rem .85rem; min-height: 2.75rem; }
    .related-parent .inbox-item { min-height: 2.5rem; }
    .verse {
      padding: .4rem 0 .4rem 0.85rem;
      margin-left: -0.5rem;
    }
    .vnotes { margin-left: .75rem; }
    .vtext { line-height: 1.5; }
    .outline, .outliner { --note-gutter: 1.15rem; --row-h: 1.7em; }
    .outliner.page { min-height: 30vh; }
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
    }
    .outliner-shell.compact .otoolbar {
      margin-left: 0; margin-right: 0;
    }
    .otool-btn {
      flex: 1 1 0;
      min-height: 2.85rem;
      padding: .55rem .5rem;
      font-size: .88rem;
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
  }
`;

// Shared client outliner — sibling/nested rows, no indent syntax to learn.
// Enter = sibling (or split), Tab/Shift-Tab = nest/unnest, Backspace on empty = delete.
// Base markdown: stored as markers in text; focused row = source, idle = rendered.
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
  const placeholder = opts.placeholder || "Write\\u2026";
  // blank bullets are first-class; seed one empty row only when the note is new
  let blocks = (opts.blocks && opts.blocks.length)
    ? opts.blocks.map(b => ({ id: b.id || newId(), indent: b.indent|0, text: b.text || "" }))
    : [{ id: newId(), indent: 0, text: "" }];
  let timer = null;
  let inflight = null;
  let dirty = false;
  let activeId = blocks[0] ? blocks[0].id : null;

  // shell + nest toolbar (mobile-friendly Tab stand-in)
  const shell = document.createElement("div");
  shell.className = "outliner-shell" + (compact ? " compact" : "");
  host.replaceWith(shell);
  shell.appendChild(host);

  const toolbar = document.createElement("div");
  toolbar.className = "otoolbar";
  toolbar.innerHTML =
    '<button type="button" class="otool-btn" data-act="outdent" aria-label="Unnest">' +
      '<span class="otool-ico" aria-hidden="true">\\u21E4</span>unnest</button>' +
    '<button type="button" class="otool-btn" data-act="indent" aria-label="Nest">' +
      '<span class="otool-ico" aria-hidden="true">\\u21E5</span>nest</button>';
  shell.appendChild(toolbar);

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

  function activeIndex() {
    let i = blocks.findIndex(b => b.id === activeId);
    return i < 0 ? 0 : i;
  }

  function refreshToolbar() {
    const i = activeIndex();
    const outBtn = toolbar.querySelector('[data-act="outdent"]');
    const inBtn = toolbar.querySelector('[data-act="indent"]');
    if (outBtn) outBtn.disabled = !blocks[i] || blocks[i].indent <= 0;
    if (inBtn) {
      const max = i === 0 ? 0 : blocks[i - 1].indent + 1;
      inBtn.disabled = !blocks[i] || blocks[i].indent >= max;
    }
  }

  function render(focusId, caret) {
    host.innerHTML = "";
    const fresh = blocks.length === 1 && !blocks[0].text.trim();
    if (focusId) activeId = focusId;
    for (const b of blocks) {
      const row = document.createElement("div");
      row.className = "oblock";
      row.dataset.id = b.id;
      row.style.setProperty("--depth", String(Math.max(0, b.indent|0)));

      const bullet = document.createElement("span");
      bullet.className = "obullet";
      bullet.title = "Nest / Unnest";

      const text = document.createElement("div");
      text.className = "otext";
      text.spellcheck = true;
      text.inputMode = "text";
      text.enterKeyHint = "enter";
      // placeholder only on a brand-new empty note — blank bullets stay silent
      if (fresh) text.dataset.placeholder = placeholder;

      const editing = b.id === activeId;
      if (editing) {
        // source mode: raw markdown markers while typing
        text.contentEditable = "true";
        text.classList.remove("view");
        text.textContent = b.text;
      } else {
        // view mode: base inline markdown + wiki
        text.contentEditable = "false";
        text.classList.add("view");
        if (b.text && b.text.trim()) text.innerHTML = formatBlockHtml(b.text);
        else text.textContent = "";
      }

      row.appendChild(bullet);
      row.appendChild(text);
      host.appendChild(row);
    }
    if (focusId) {
      const el = host.querySelector('.oblock[data-id="' + CSS.escape(focusId) + '"] .otext');
      if (el && el.isContentEditable) {
        el.focus();
        placeCaret(el, caret == null ? endOf(el) : caret);
      }
    }
    refreshToolbar();
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
      const el = row.querySelector(".otext");
      // only source (contenteditable) rows are authoritative; view mode is HTML
      if (b && el && el.isContentEditable) {
        b.text = el.textContent.replace(/\\u00a0/g, " ");
      }
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
    let payload = {
      blocks: blocks.map(b => ({ id: b.id, indent: b.indent, text: b.text })),
    };
    // optional client-side encryption (cowyo-style); passphrase never sent
    try {
      if (typeof VP_CRYPTO !== "undefined" && VP_CRYPTO.hasPassphrase()) {
        const atts = (opts.getAttachments && opts.getAttachments()) || opts.attachments || [];
        const cipher = await VP_CRYPTO.encryptPayload({
          blocks: payload.blocks,
          attachments: atts,
        }, VP_CRYPTO.getPassphrase());
        payload = { encrypted: true, cipher };
      } else if (opts.attachments) {
        // when not encrypting, only send blocks (preserve server attachments)
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
        else setStatus(payload.encrypted ? "saved · encrypted" : "saved");
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

  function applyIndent(delta) {
    syncFromDom();
    const i = activeIndex();
    const focusEl = document.activeElement;
    const caret = (focusEl && focusEl.classList && focusEl.classList.contains("otext"))
      ? caretOffset(focusEl) : endOf({ textContent: blocks[i] ? blocks[i].text : "" });
    if (!indentBlock(i, delta)) { refreshToolbar(); return; }
    render(blocks[i].id, caret);
    scheduleSave();
  }

  // keep focus in editor when tapping toolbar (mousedown before blur)
  toolbar.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".otool-btn")) e.preventDefault();
  });
  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    applyIndent(btn.dataset.act === "indent" ? 1 : -1);
  });

  host.addEventListener("focusin", (e) => {
    // focusing a link should not open the source editor
    if (e.target.closest && e.target.closest("a")) return;
    const row = e.target.closest(".oblock");
    if (!row) return;
    const el = row.querySelector(".otext");
    // click a view-mode row → switch to source for that line
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
    if (!e.target.classList || !e.target.classList.contains("otext")) return;
    // when leaving the outliner (not moving to another row), re-render to show markdown
    const next = e.relatedTarget;
    if (next && host.contains(next)) return;
    syncFromDom();
    const id = activeId;
    activeId = null;
    render(null);
    activeId = id;
    refreshToolbar();
  });

  host.addEventListener("pointerdown", (e) => {
    // let wiki / markdown / attachment links navigate
    if (e.target.closest("a")) return;
    const el = e.target.closest(".otext.view");
    if (!el) return;
    const row = el.closest(".oblock");
    if (!row) return;
    // enter source mode before focus so caret lands in plain text
    e.preventDefault();
    const id = row.dataset.id;
    const b = blocks.find(x => x.id === id);
    render(id, b && b.text ? b.text.length : 0);
  });

  // capture click on links so focusin doesn't fight navigation
  host.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || !host.contains(a)) return;
    // allow default navigation (same tab) for internal wiki links
    e.stopPropagation();
  });

  host.addEventListener("input", (e) => {
    if (!e.target.classList.contains("otext") || !e.target.isContentEditable) return;
    const row = e.target.closest(".oblock");
    const b = blocks.find(x => x.id === row.dataset.id);
    if (b) b.text = e.target.textContent.replace(/\\u00a0/g, " ");
    if (row) activeId = row.dataset.id;
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
      activeId = blocks[i].id;
      applyIndent(e.shiftKey ? -1 : 1);
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
    setAttachments(list) {
      if (opts.getAttachments) { /* live via getAttachments */ }
      opts.attachments = list || [];
    },
    async flush(force) {
      clearTimeout(timer);
      if (dirty || force) await save();
      else if (inflight) await inflight;
    },
    destroy() {
      clearTimeout(timer);
      host.innerHTML = "";
      host.classList.remove("outliner", "compact", "page");
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
      <h1>versepack</h1>
      <p class="lead">Scripture notes on this machine.</p>
      ${error ? `<p class="login-error" role="alert">${esc(error)}</p>` : ""}
      <a class="login-btn" href="${esc(openHref)}">Open my notes</a>
      <details class="login-more"${error ? " open" : ""}>
        <summary>Use a different key</summary>
        ${keyForm({ required: true, autofocus: !!error, btn: "Continue" })}
      </details>`;
  } else {
    body = `
      <h1>versepack</h1>
      <p class="lead">Open your notes with your key.</p>
      ${error ? `<p class="login-error" role="alert">${esc(error)}</p>` : ""}
      ${keyForm({ required: true, autofocus: true, btn: "Open notes" })}
      <details class="login-more">
        <summary>Don’t have a key?</summary>
        <p>Use the link from when you set this up, or ask whoever runs the server for their notes link. After you open once, bookmark the page.</p>
      </details>`;
  }

  return page(
    "versepack",
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
function renderOutline(blocks, attachments = []) {
  const items = blocks || [];
  if (!items.length) return "";
  return `<div class="outline">${items.map((b) => {
    const depth = Math.max(0, Number(b.indent) || 0);
    const empty = !String(b.text || "").trim();
    return `<div class="oline${empty ? " blank" : ""}" style="--depth:${depth}" title="${esc(b.id)}">
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
  if (isEncryptedNote(note)) {
    const showLabel = label && scope.kind !== "verse";
    return `<div class="note encrypted" data-kind="${esc(scope.kind)}" data-slug="${esc(scope.slug)}" data-encrypted="1">
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
  return `<div class="note" data-kind="${esc(scope.kind)}" data-slug="${esc(scope.slug)}">
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

/** Clickable multiword key → native share sheet (fallback: copy link). */
function doorShareChipHtml() {
  if (DOOR_OPEN || !DOOR) return "";
  return `<button type="button" class="door-share" id="door-share"
      title="Share your notes link" aria-label="Share notes link: ${esc(DOOR)}">
      <span class="door-share-key">${esc(DOOR)}</span>
      <span class="door-share-hint" aria-hidden="true">↗</span>
    </button>
    <script>
    (function () {
      var btn = document.getElementById("door-share");
      if (!btn) return;
      var key = ${JSON.stringify(DOOR)};
      var hint = btn.querySelector(".door-share-hint");
      function packUrl() {
        return location.origin + "/" + key + "/";
      }
      function flash(msg) {
        if (!hint) return;
        var prev = hint.textContent;
        hint.textContent = msg;
        btn.dataset.flash = "1";
        setTimeout(function () {
          hint.textContent = prev;
          btn.dataset.flash = "0";
        }, 1400);
      }
      async function copyUrl() {
        var url = packUrl();
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
          flash("copied");
        } catch (e) {
          flash("—");
          window.prompt("Copy your notes link:", url);
        }
      }
      btn.addEventListener("click", async function () {
        var url = packUrl();
        if (navigator.share) {
          try {
            await navigator.share({
              title: "versepack",
              text: "Open my scripture notes",
              url: url,
            });
            return;
          } catch (err) {
            // user cancelled or share failed — fall through only on real errors
            if (err && err.name === "AbortError") return;
          }
        }
        await copyUrl();
      });
      // remember key for bare-/ prefill
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
  const rows = notes
    .map((n) => {
      const scope = parseScope(n.scope.osis);
      const display = scope ? formatPassageForDisplay(scope.parsed) : n.scope.osis;
      return `<a class="note-row" href="${u(`/note/${n.scope.slug}`)}">
        <span class="ref">${esc(display)}</span>
        <span class="muted" style="float:right">${esc(relTime(n.updated_at))}</span>
        <div class="muted">${esc(excerpt(n)) || "empty"}</div></a>`;
    })
    .join("\n");
  return page(
    "versepack",
    `<header><h1>versepack</h1>
      ${doorShareChipHtml()}
    </header>
    ${cryptoBarHtml()}
    ${refSearchHtml()}
    <p class="muted ui" style="margin-top:.75rem">${notes.length} note${notes.length === 1 ? "" : "s"}</p>
    ${rows || `<p class="muted">Type a passage above.</p>`}`,
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
// Click a visible verse-note outline → edit. No per-note chevrons.

async function renderRead(scope) {
  const { book, chapter } = { book: scope.parsed.start.book, chapter: scope.parsed.start.chapter };
  let text;
  try {
    text = await getChapterText(book, chapter);
  } catch (err) {
    return page("versepack", `<p>Could not fetch text (${esc(err?.message || err)}).
      <a href="${u(`/note/${scope.slug}`)}">Open note editor</a>.</p>`);
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
      <a href="${u("/")}" class="muted">&larr;</a>
      <h1>${esc(display)}</h1>
      <a class="muted" href="${u(`/note/${chapterScope.slug}`)}">chapter note</a>
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

      function syncHasNotes(verse) {
        if (!verse) return;
        const vslug = verse.dataset.slug;
        const hasVerse = !!(seeds[vslug] && seeds[vslug].some(b => b.text.trim()))
          || !!verse.querySelector('.note[data-kind="verse"][data-encrypted="1"]');
        const hasOther = [...verse.querySelectorAll(".note")].some((n) => {
          if (n.dataset.kind === "verse") return false;
          if (n.dataset.encrypted === "1") return true;
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
      return html(res, 404, page("versepack", `<div class="login">
        <h1>versepack</h1>
        <p class="lead">Nothing here.</p>
        <p class="muted"><a href="/">Sign in</a></p>
      </div>`));
    }
    p = routed.path;
    // normalize trailing slash on app root inside door
    if (p === "") p = "/";

    if (req.method === "GET" && p === "/") return html(res, 200, await renderIndex());

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
        return html(res, 200, page("versepack", `<p>Could not parse that passage. <a href="${u("/")}">Back</a></p>`));
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
    console.log(`versepack: ${root}/  (DOOR_OPEN — open access, no key)`);
  } else {
    console.log(`versepack: ${root}/${DOOR}/`);
    console.log(`open that link (or ${root}/ on this computer → “Open my notes”).`);
    console.log(`your key: ${DOOR}`);
  }
  console.log(`pack on disk:   ${PACK_DIR}`);
});
