#!/usr/bin/env node
/**
 * Import personal scripture notes from an Obsidian/dps-prim vault into a keyverse pack.
 *
 * Usage:
 *   node scripts/import-dps-prim.mjs [vaultDir] [packDir]
 *
 * Defaults: ~/Documents/dps-prim → ./pack
 *
 * Strategy:
 * - Route.bible chapter notes with ## Verse-by-verse → chapter note + per-verse notes
 *   (compose-don't-absorb; BSB verse text is dropped — reading view supplies it)
 * - Freeform chapter notes (James, Philippians) → chapter outline
 * - List notes (DPS Verses, Verses to Remember) → target passages when they have content
 * - Empty shells (no personal notes) are skipped
 */

import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tryParseAnyPassage, formatPassageForDisplay } from "grab-bcv";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VAULT = process.argv[2] || path.join(process.env.HOME || "", "Documents/dps-prim");
const PACK = process.argv[3] || path.join(ROOT, "pack");
const NOTES_DIR = path.join(PACK, "notes");

const DRY = process.env.DRY === "1";
const FORCE = process.env.FORCE === "1"; // overwrite existing non-sample notes

function newBlockId() {
  return "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function newNoteId() {
  return "note_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

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

function stripFrontmatter(raw) {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { fm: {}, body: raw };
  const yaml = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const fm = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    fm[m[1]] = v;
  }
  return { fm, body };
}

/**
 * Normalize ESV/Crossway-style scripture quote markers into flat keyverse markdown.
 * Source often looks like: ***11** text **12** text*  or  ***[[Phil 4|…]]***
 * Our renderer is flat (no nested emphasis), so strip verse-number bold and
 * mismatched star wraps; keep a single outer italic when the quote was italic.
 */
function cleanEsVQuoteMarkers(s) {
  let t = String(s ?? "");
  // ***[[wiki]]*** / **[[wiki]]** / *[[wiki]]* → [[wiki]]
  t = t.replace(/^\*{1,3}\s*(\[\[)/, "$1").replace(/(\]\])\s*\*{1,3}$/, "$1");
  // Leading ***N** (bold-italic open + bold verse num) → drop the verse-num chrome
  t = t.replace(/^\*{1,3}(\d+)\*\*\s*/, "");
  // Mid-quote bold verse numbers: **12** / **13** → drop (reading view has numbers)
  t = t.replace(/\s*\*\*(\d+)\*\*\s*/g, " ");
  // Trailing orphan italic/bold closers left by the above
  t = t.replace(/^\*+/, "").replace(/\*+$/, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/** Clean inline text for outline storage. */
function cleanInline(s) {
  let t = String(s ?? "");
  // drop HTML anchors / tags
  t = t.replace(/<a\b[^>]*>/gi, "").replace(/<\/a>/gi, "").replace(/<[^>]+>/g, "");
  // Obsidian highlights → bold (flatten nested ** inside ==…==)
  t = t.replace(/==([^=]+)==/g, (_, inner) => {
    const i = inner.trim().replace(/\*\*/g, "").trim();
    return i ? `**${i}**` : "";
  });
  // broken route links
  t = t.replace(/\]\(thttps?:/g, "](https:");
  // route.bible markdown links → wiki
  t = t.replace(
    /\[([^\]]*)\]\(https?:\/\/route\.bible\/([^?)#\s]+)[^)]*\)/gi,
    (_, label, slugish) => {
      const scope = parseScope(slugish.replace(/\//g, ".").replace(/^\./, ""));
      if (scope) return `[[${prettyRef(scope)}]]`;
      // try human label if it parses
      const fromLabel = parseScope(label);
      if (fromLabel) return `[[${prettyRef(fromLabel)}]]`;
      return label || slugish;
    }
  );
  // bare route.bible urls
  t = t.replace(/https?:\/\/route\.bible\/([A-Za-z0-9.-]+)/gi, (_, slugish) => {
    const scope = parseScope(slugish);
    return scope ? `[[${prettyRef(scope)}]]` : slugish;
  });
  // Obsidian embeds / section anchors → plain wiki
  t = t.replace(/!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    return label ? `[[${target.trim()}|${label.trim()}]]` : `[[${target.trim()}]]`;
  });
  t = t.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const cleaned = target.trim();
    // normalize if it looks like a passage
    const scope = parseScope(cleaned.replace(/\s+/g, " "));
    if (scope) {
      const pretty = prettyRef(scope);
      return label ? `[[${pretty}|${label.trim()}]]` : `[[${pretty}]]`;
    }
    return label ? `[[${cleaned}|${label.trim()}]]` : `[[${cleaned}]]`;
  });
  // ESV-style ***11**…**12**…* and ***[[wiki]]*** before other star munging
  t = cleanEsVQuoteMarkers(t);
  // collapse odd bold-per-word artifacts: **What** **does** → **What does**
  t = t.replace(/(?:\*\*[^*]+\*\*\s*){2,}/g, (chunk) => {
    const words = [...chunk.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
    return `**${words.join(" ")}**`;
  });
  // tidy whitespace
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function prettyRef(scope) {
  try {
    const d = formatPassageForDisplay(scope.parsed);
    if (d) return d;
  } catch {
    /* fall through */
  }
  return scope.osis;
}

function isBlankOrRule(line) {
  const t = line.trim();
  return !t || t === "- - -" || t === "---" || /^[-*_]{3,}$/.test(t);
}

/** Leading indent units: 2 spaces or 1 tab = 1. */
function listDepth(line) {
  const m = line.match(/^([ \t]*)([-*+]|\d+\.)\s+/);
  if (!m) return null;
  const ws = m[1].replace(/\t/g, "  ");
  return Math.floor(ws.length / 2);
}

/**
 * Convert freeform markdown body to flat outline blocks.
 */
function freeformToBlocks(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let para = [];

  const flushPara = (indent = 0) => {
    const text = cleanInline(para.join(" "));
    para = [];
    if (text) blocks.push({ indent, text });
  };

  for (const raw of lines) {
    if (isBlankOrRule(raw)) {
      flushPara();
      continue;
    }
    // skip lone back-nav lines like ← [[James]] | [[James 2]] →
    if (/^[←→]/.test(raw.trim()) || /^←\s*\[\[/.test(raw.trim())) {
      flushPara();
      continue;
    }
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      const text = cleanInline(heading[2].replace(/^\[([^\]]+)\]\([^)]+\)/, "$1"));
      if (text) blocks.push({ indent: 0, text });
      continue;
    }
    // blockquote lines (often ESV quotes with ***11**…**12**…* chrome)
    if (/^\s*>/.test(raw)) {
      flushPara();
      let t = raw.replace(/^\s*>\s?/, "");
      const wasEmph =
        /^\*{1,3}/.test(t.trim()) || /^_/.test(t.trim()) || /\*{1,3}$/.test(t.trim());
      // strip wrapping stars even when no space after them (***11**… not *** 11)
      t = t.replace(/^\*+/, "").replace(/\*+$/, "");
      t = cleanInline(t);
      if (t) {
        // Re-wrap as italic only when the source was an emphasized quote and
        // cleanInline didn't already leave emphasis markers.
        const text =
          wasEmph && !t.startsWith("*") && !t.startsWith("_") && !t.startsWith("[[")
            ? `_${t}_`
            : t;
        blocks.push({ indent: Math.min(1, blocks.length ? 1 : 0), text });
      }
      continue;
    }
    const depth = listDepth(raw);
    if (depth != null) {
      flushPara();
      const text = cleanInline(raw.replace(/^([ \t]*)([-*+]|\d+\.)\s+/, ""));
      if (text) blocks.push({ indent: depth, text });
      continue;
    }
    para.push(raw.trim());
  }
  flushPara();
  return finalizeBlocks(blocks);
}

/**
 * Parse route.bible style chapter notes with optional ## Verse-by-verse.
 * Returns Map slug → blocks[]
 */
function parseRouteBibleChapter(fm, body, fileBase) {
  const scopeInput = fm.osis || fm.reference || fileBase;
  const chapterScope = parseScope(scopeInput);
  if (!chapterScope) {
    console.warn("  skip unparseable scope:", scopeInput);
    return new Map();
  }

  // Split body into named sections by ## headings
  const sections = splitSections(body);
  const out = new Map(); // slug → { scope, blocks: [{indent,text}] }

  const ensure = (scope) => {
    if (!out.has(scope.slug)) out.set(scope.slug, { scope, blocks: [] });
    return out.get(scope.slug);
  };

  const chapter = ensure(chapterScope);

  // Top matter before first ## (links, verse text) — ignore pure links / pure scripture paste
  // ## Notes (before verse-by-verse)
  for (const sec of sections) {
    const title = sec.title.toLowerCase();
    if (title === "notes") {
      // only personal notes, not full BSB paste under Notes
      const personal = extractPersonalNotesOnly(sec.body);
      chapter.blocks.push(...personal);
      continue;
    }
    if (title === "verse-by-verse" || title.startsWith("verse-by-verse")) {
      parseVerseByVerse(sec.body, chapterScope, ensure);
      continue;
    }
    if (title.startsWith("study questions") || title === "key synthesis" || title.startsWith("vv.") || title.startsWith("vv ")) {
      // study question sections often use ## vv. 1-4 as siblings
      chapter.blocks.push({ indent: 0, text: sec.title.replace(/^#+\s*/, "") || sec.title });
      chapter.blocks.push(...freeformToBlocks(sec.body).map((b) => ({ ...b, indent: b.indent + 1 })));
      continue;
    }
    // other ## sections on chapter note
    if (sec.title) {
      chapter.blocks.push({ indent: 0, text: sec.title });
      chapter.blocks.push(...freeformToBlocks(sec.body).map((b) => ({ ...b, indent: b.indent + 1 })));
    }
  }

  // Also fold sibling ## vv. N-M that appear as top-level sections after study questions header
  // (already handled as sections with title vv....)

  // Drop empty entries
  for (const [slug, rec] of out) {
    rec.blocks = finalizeBlocks(rec.blocks);
    if (!rec.blocks.some((b) => b.text.trim())) out.delete(slug);
  }
  return out;
}

function splitSections(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let cur = { title: "", body: [] };
  for (const line of lines) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      sections.push({ title: cur.title, body: cur.body.join("\n") });
      cur = { title: h[1].trim(), body: [] };
    } else {
      cur.body.push(line);
    }
  }
  sections.push({ title: cur.title, body: cur.body.join("\n") });
  return sections;
}

/**
 * Under ## Notes, skip pure BSB dumps (numbered verse lines without nested notes)
 * and keep blockquotes / bullets / paragraphs that look like study notes.
 */
function extractPersonalNotesOnly(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  // If it looks like a full chapter paste (many "N. text" lines, few real note bullets), skip all
  let verseLines = 0;
  let noteBullets = 0;
  let noteQuotes = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/^\d+\.\s+\S/.test(t)) verseLines++;
    // real notes: indented bullets (not column-0 "1. scripture")
    const depth = listDepth(line);
    if (depth != null) {
      const lead = (line.match(/^(\s*)/)?.[1] || "").replace(/\t/g, "  ").length;
      // column-0 "1. foo" is scripture numbering, not a note bullet
      if (!(lead <= 1 && /^\d+\.\s/.test(t))) noteBullets++;
    }
    if (/^\s*>/.test(line) && t.length > 2) noteQuotes++;
  }
  if (verseLines >= 5 && noteBullets + noteQuotes === 0) return [];
  // mostly BSB dump with a thin header: still skip
  if (verseLines >= 10 && noteBullets < 3) return [];

  // Otherwise convert as freeform, but drop standalone "N. scripture" lines
  const filtered = [];
  for (const line of lines) {
    const t = line.trim();
    const lead = (line.match(/^(\s*)/)?.[1] || "").replace(/\t/g, "  ").length;
    // skip pure numbered verse dumps
    if (lead <= 1 && /^\d+\.\s+\S/.test(t) && t.length > 20) continue;
    // skip **[Revelation N](url)** style chapter headers in dumps
    if (/^\*\*\[[^\]]+\]\(https?:\/\/route\.bible/.test(t)) continue;
    if (/^\*\*\[[^\]]+\]\(https?:\/\/route\.bible/.test(t.replace(/^\*\*/, ""))) continue;
    filtered.push(line);
  }
  return freeformToBlocks(filtered.join("\n"));
}

function parseVerseByVerse(body, chapterScope, ensure) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let currentVerse = null;
  let pending = []; // {indent, text} for current verse

  const flush = () => {
    if (currentVerse == null) return;
    const book = chapterScope.parsed.start.book; // OSIS book code via grab-bcv
    const ch = chapterScope.parsed.start.chapter;
    const ref = `${book}.${ch}.${currentVerse}`;
    const scope = parseScope(ref);
    if (!scope) {
      console.warn("  bad verse ref", ref);
      pending = [];
      currentVerse = null;
      return;
    }
    const rec = ensure(scope);
    // Rebase list depths so the shallowest bullet under this verse is indent 0
    if (pending.length) {
      const minD = Math.min(...pending.map((b) => b._depth ?? b.indent ?? 0));
      for (const b of pending) {
        const depth = b._depth ?? b.indent ?? 0;
        rec.blocks.push({ indent: Math.max(0, depth - minD), text: b.text });
      }
    }
    pending = [];
    currentVerse = null;
  };

  for (const raw of lines) {
    if (isBlankOrRule(raw)) continue;
    // Verse header at column 0: "1. _scripture…_" (listDepth also matches "N." so don't use it here)
    const leadWs = (raw.match(/^(\s*)/)?.[1] || "").replace(/\t/g, "  ").length;
    const vm = raw.match(/^\s*(\d+)\.\s+(.*)$/);
    if (vm && leadWs <= 1) {
      flush();
      currentVerse = Number(vm[1]);
      // discard verse text (BSB) — keyverse reading view has it
      continue;
    }
    if (currentVerse == null) continue;

    const depth = listDepth(raw);
    if (depth != null) {
      const text = cleanInline(raw.replace(/^([ \t]*)([-*+]|\d+\.)\s+/, ""));
      if (text) pending.push({ _depth: depth, text });
      continue;
    }
    const text = cleanInline(raw.trim());
    if (text) pending.push({ _depth: 0, text });
  }
  flush();
}

function finalizeBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    let indent = Math.max(0, Math.min(32, Number(b.indent) || 0));
    if (out.length) indent = Math.min(indent, out[out.length - 1].indent + 1);
    else indent = 0;
    const text = String(b.text || "").replace(/\r?\n/g, " ").trimEnd();
    // skip empty
    if (!text.trim()) continue;
    out.push({ id: newBlockId(), indent, text: text.trim() });
  }
  return out;
}

function buildNote(scope, blocks, dates = {}) {
  const now = new Date().toISOString();
  return {
    id: newNoteId(),
    scope: { kind: scope.kind, osis: scope.osis, slug: scope.slug },
    blocks,
    attachments: [],
    created_at: dates.created || now,
    updated_at: dates.updated || now,
  };
}

function parseDate(fm) {
  if (!fm?.date) return {};
  const d = new Date(fm.date);
  if (Number.isNaN(d.getTime())) return {};
  const iso = d.toISOString();
  return { created: iso, updated: iso };
}

/** Known freeform scripture files without osis frontmatter */
const FREEFORM_FILES = {
  "James 1.md": "James 1",
  "James 2.md": "James 2",
  "Philippians 1.md": "Philippians 1",
};

/** Filenames that are BSB mirrors only (import the non-BSB twin if both exist). */
function isBsbMirror(name) {
  return /\(BSB\)\.md$/i.test(name);
}

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function writeNote(note, stats) {
  const file = path.join(NOTES_DIR, `${note.scope.slug}.json`);
  if (!FORCE && (await fileExists(file))) {
    // preserve sample John notes and any already-imported
    const existing = JSON.parse(await readFile(file, "utf8"));
    if (existing?.blocks?.length && !FORCE) {
      stats.skippedExisting.push(note.scope.slug);
      return;
    }
  }
  const json = JSON.stringify(note, null, 2) + "\n";
  if (DRY) {
    stats.wouldWrite.push({ slug: note.scope.slug, blocks: note.blocks.length });
    return;
  }
  await writeFile(file, json, "utf8");
  stats.written.push({ slug: note.scope.slug, blocks: note.blocks.length });
}

async function importRouteFile(abs, stats) {
  const raw = await readFile(abs, "utf8");
  const { fm, body } = stripFrontmatter(raw);
  const base = path.basename(abs, ".md");
  if (!fm.osis && !fm.reference && !/^(\d\s)?[A-Za-z]/.test(base)) {
    stats.skippedNoScope.push(base);
    return;
  }
  // skip pure empty notes shells
  const map = parseRouteBibleChapter(fm, body, base);
  if (map.size === 0) {
    stats.skippedEmpty.push(base);
    return;
  }
  const dates = parseDate(fm);
  for (const rec of map.values()) {
    const note = buildNote(rec.scope, rec.blocks, dates);
    await writeNote(note, stats);
  }
  stats.sources.push({ file: base, notes: map.size });
}

async function importFreeform(abs, ref, stats) {
  const raw = await readFile(abs, "utf8");
  const { fm, body } = stripFrontmatter(raw);
  const scope = parseScope(ref);
  if (!scope) {
    stats.skippedNoScope.push(path.basename(abs));
    return;
  }
  // drop Concepts & Refs section noise lightly — freeformToBlocks handles most
  let cleaned = body;
  // remove tag-only concept clouds that are just wiki lists under Concepts
  cleaned = cleaned.replace(/##\s*Concepts\s*&\s*Refs[\s\S]*?(?=##\s*Notes|$)/i, "");
  const blocks = freeformToBlocks(cleaned);
  if (!blocks.length) {
    stats.skippedEmpty.push(path.basename(abs));
    return;
  }
  const note = buildNote(scope, blocks, parseDate(fm));
  await writeNote(note, stats);
  stats.sources.push({ file: path.basename(abs), notes: 1 });
}

async function importVersesToRemember(abs, stats) {
  const raw = await readFile(abs, "utf8");
  const { body } = stripFrontmatter(raw);
  // Content is Phil 4:11-13 quote + wiki
  const scope = parseScope("Philippians 4:11-13");
  if (!scope) return;
  const blocks = freeformToBlocks(body);
  if (!blocks.length) {
    // still capture the quote as note
    const m = body.match(/>\s*\*?\*?\*?([\s\S]*?)\*?\*?\*?\s*\n\s*>?\s*\*+\s*\[\[/);
    if (!m) {
      stats.skippedEmpty.push("Verses to Remember.md");
      return;
    }
  }
  const note = buildNote(scope, blocks.length ? blocks : finalizeBlocks([{ indent: 0, text: "Contentment in every circumstance — through Christ who strengthens me." }]));
  await writeNote(note, stats);
  stats.sources.push({ file: "Verses to Remember.md", notes: 1 });
}

async function importDpsVerses(abs, stats) {
  // DPS Verses is a bookmark list, not study notes. Only seed stubs when SEED_LIST=1.
  if (process.env.SEED_LIST !== "1") {
    stats.skippedEmpty.push("DPS Verses.md (list only; set SEED_LIST=1 to stub)");
    return;
  }
  const raw = await readFile(abs, "utf8");
  const lines = raw.split("\n");
  let n = 0;
  for (const line of lines) {
    const m = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!m) continue;
    const parts = m[1].split(/\s*&\s*/);
    for (const part of parts) {
      const scope = parseScope(part.trim());
      if (!scope) continue;
      const file = path.join(NOTES_DIR, `${scope.slug}.json`);
      if (await fileExists(file)) {
        stats.skippedExisting.push(scope.slug);
        continue;
      }
      const note = buildNote(scope, finalizeBlocks([{ indent: 0, text: "From DPS Verses list" }]));
      await writeNote(note, stats);
      n++;
    }
  }
  if (n) stats.sources.push({ file: "DPS Verses.md", notes: n });
}

async function main() {
  console.log("vault:", VAULT);
  console.log("pack: ", PACK);
  if (DRY) console.log("(dry run)");

  await mkdir(NOTES_DIR, { recursive: true });

  const stats = {
    written: [],
    wouldWrite: [],
    skippedEmpty: [],
    skippedExisting: [],
    skippedNoScope: [],
    sources: [],
  };

  const names = await readdir(VAULT);
  const md = names.filter((n) => n.endsWith(".md") && !n.startsWith("."));

  // 1) Route.bible style (has osis: or known passage filename with frontmatter)
  for (const name of md) {
    if (isBsbMirror(name)) continue;
    if (FREEFORM_FILES[name]) continue;
    if (name === "DPS Verses.md" || name === "Verses to Remember.md") continue;
    // skip non-scripture
    const abs = path.join(VAULT, name);
    const raw = await readFile(abs, "utf8");
    const { fm } = stripFrontmatter(raw);
    const looksScripture =
      fm.osis ||
      fm.reference ||
      (Array.isArray(fm.tags) ? false : String(fm.tags || "").includes("scripture")) ||
      /route-bible|scripture|book\//.test(raw.slice(0, 800));
    // filename heuristics for passage notes
    const nameLooks =
      /^(1 |2 |3 )?(John|Peter|James|Luke|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|Psalms?|Proverbs?|Revelation|Matthew|Mark|Genesis|Exodus)\b/i.test(
        name
      ) || /^\d/.test(name);

    if (!looksScripture && !nameLooks) continue;
    // exclude non-passage titles
    if (/Clear|Gerstner|Gospel Understanding|America|Jobs vs/i.test(name)) continue;

    // only process if osis/reference present OR name parses as passage
    const scopeGuess = parseScope(fm.osis || fm.reference || name.replace(/\.md$/, "").replace(/\./g, ":"));
    if (!scopeGuess && !fm.osis) continue;

    console.log("route:", name);
    await importRouteFile(abs, stats);
  }

  // 2) Freeform chapter notes
  for (const [name, ref] of Object.entries(FREEFORM_FILES)) {
    const abs = path.join(VAULT, name);
    if (!(await fileExists(abs))) continue;
    console.log("freeform:", name);
    await importFreeform(abs, ref, stats);
  }

  // 3) Lists
  const vtr = path.join(VAULT, "Verses to Remember.md");
  if (await fileExists(vtr)) {
    console.log("list:", "Verses to Remember.md");
    await importVersesToRemember(vtr, stats);
  }
  const dps = path.join(VAULT, "DPS Verses.md");
  if (await fileExists(dps)) {
    console.log("list:", "DPS Verses.md");
    await importDpsVerses(dps, stats);
  }

  console.log("\n--- summary ---");
  console.log("sources:", stats.sources.length, stats.sources);
  console.log("written:", (DRY ? stats.wouldWrite : stats.written).length);
  for (const w of DRY ? stats.wouldWrite : stats.written) {
    console.log(`  ${w.slug} (${w.blocks} blocks)`);
  }
  if (stats.skippedEmpty.length) console.log("skipped empty:", stats.skippedEmpty);
  if (stats.skippedExisting.length) console.log("skipped existing:", [...new Set(stats.skippedExisting)]);
  if (stats.skippedNoScope.length) console.log("skipped no scope:", stats.skippedNoScope);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
