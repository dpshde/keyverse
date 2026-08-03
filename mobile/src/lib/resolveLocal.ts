/**
 * Offline passage resolve / suggest (subset of server grab-bcv behavior).
 */
import type { ResolveResult, Scope, SuggestItem } from "../api/types";

const BOOK_ALIASES: Record<string, string> = {
  gen: "gen", genesis: "gen",
  exo: "exo", exod: "exo", exodus: "exo",
  lev: "lev", leviticus: "lev",
  num: "num", numbers: "num",
  deu: "deu", deut: "deu", deuteronomy: "deu",
  jos: "jos", josh: "jos", joshua: "jos",
  jdg: "jdg", judg: "jdg", judges: "jdg",
  rut: "rut", ruth: "rut",
  "1sa": "1sa", "1sam": "1sa", "1 samuel": "1sa", "i samuel": "1sa",
  "2sa": "2sa", "2sam": "2sa", "2 samuel": "2sa", "ii samuel": "2sa",
  "1ki": "1ki", "1kgs": "1ki", "1 kings": "1ki", "i kings": "1ki",
  "2ki": "2ki", "2kgs": "2ki", "2 kings": "2ki", "ii kings": "2ki",
  "1ch": "1ch", "1chr": "1ch", "1 chronicles": "1ch",
  "2ch": "2ch", "2chr": "2ch", "2 chronicles": "2ch",
  ezr: "ezr", ezra: "ezr",
  neh: "neh", nehemiah: "neh",
  est: "est", esther: "est",
  job: "job",
  psa: "psa", ps: "psa", psalm: "psa", psalms: "psa",
  pro: "pro", prov: "pro", proverbs: "pro",
  ecc: "ecc", eccl: "ecc", ecclesiastes: "ecc",
  sng: "sng", song: "sng", "song of solomon": "sng",
  isa: "isa", isaiah: "isa",
  jer: "jer", jeremiah: "jer",
  lam: "lam", lamentations: "lam",
  ezk: "ezk", ezek: "ezk", ezekiel: "ezk",
  dan: "dan", daniel: "dan",
  hos: "hos", hosea: "hos",
  jol: "jol", joel: "jol",
  amo: "amo", amos: "amo",
  oba: "oba", obadiah: "oba",
  jon: "jon", jonah: "jon",
  mic: "mic", micah: "mic",
  nam: "nam", nah: "nam", nahum: "nam",
  hab: "hab", habakkuk: "hab",
  zep: "zep", zeph: "zep", zephaniah: "zep",
  hag: "hag", haggai: "hag",
  zec: "zec", zech: "zec", zechariah: "zec",
  mal: "mal", malachi: "mal",
  mat: "mat", matt: "mat", matthew: "mat",
  mrk: "mrk", mk: "mrk", mark: "mrk",
  luk: "luk", lk: "luk", luke: "luk",
  jhn: "jhn", jn: "jhn", john: "jhn",
  act: "act", acts: "act",
  rom: "rom", romans: "rom",
  "1co": "1co", "1cor": "1co", "1 corinthians": "1co",
  "2co": "2co", "2cor": "2co", "2 corinthians": "2co",
  gal: "gal", galatians: "gal",
  eph: "eph", ephesians: "eph",
  php: "php", phil: "php", philippians: "php",
  col: "col", colossians: "col",
  "1th": "1th", "1thess": "1th", "1 thessalonians": "1th",
  "2th": "2th", "2thess": "2th", "2 thessalonians": "2th",
  "1ti": "1ti", "1tim": "1ti", "1 timothy": "1ti",
  "2ti": "2ti", "2tim": "2ti", "2 timothy": "2ti",
  tit: "tit", titus: "tit",
  phm: "phm", philemon: "phm",
  heb: "heb", hebrews: "heb",
  jas: "jas", james: "jas",
  "1pe": "1pe", "1pet": "1pe", "1 peter": "1pe",
  "2pe": "2pe", "2pet": "2pe", "2 peter": "2pe",
  "1jn": "1jn", "1john": "1jn", "1 john": "1jn",
  "2jn": "2jn", "2john": "2jn", "2 john": "2jn",
  "3jn": "3jn", "3john": "3jn", "3 john": "3jn",
  jud: "jud", jude: "jud",
  rev: "rev", revelation: "rev",
};

const OSIS_LABEL: Record<string, string> = {
  gen: "Genesis", exo: "Exodus", lev: "Leviticus", num: "Numbers", deu: "Deuteronomy",
  jos: "Joshua", jdg: "Judges", rut: "Ruth", "1sa": "1 Samuel", "2sa": "2 Samuel",
  "1ki": "1 Kings", "2ki": "2 Kings", "1ch": "1 Chronicles", "2ch": "2 Chronicles",
  ezr: "Ezra", neh: "Nehemiah", est: "Esther", job: "Job", psa: "Psalm", pro: "Proverbs",
  ecc: "Ecclesiastes", sng: "Song of Songs", isa: "Isaiah", jer: "Jeremiah", lam: "Lamentations",
  ezk: "Ezekiel", dan: "Daniel", hos: "Hosea", jol: "Joel", amo: "Amos", oba: "Obadiah",
  jon: "Jonah", mic: "Micah", nam: "Nahum", hab: "Habakkuk", zep: "Zephaniah", hag: "Haggai",
  zec: "Zechariah", mal: "Malachi", mat: "Matthew", mrk: "Mark", luk: "Luke", jhn: "John",
  act: "Acts", rom: "Romans", "1co": "1 Corinthians", "2co": "2 Corinthians", gal: "Galatians",
  eph: "Ephesians", php: "Philippians", col: "Colossians", "1th": "1 Thessalonians",
  "2th": "2 Thessalonians", "1ti": "1 Timothy", "2ti": "2 Timothy", tit: "Titus",
  phm: "Philemon", heb: "Hebrews", jas: "James", "1pe": "1 Peter", "2pe": "2 Peter",
  "1jn": "1 John", "2jn": "2 John", "3jn": "3 John", jud: "Jude", rev: "Revelation",
};

export function resolveLocal(q: string): ResolveResult {
  const raw = (q || "").trim();
  if (!raw) return { ok: false, error: "empty" };

  // already slug: jhn.3.16 or jhn.3.16-18 or jhn.3
  const slugM = /^([1-3]?[a-z]+)\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$/i.exec(raw.replace(/\s+/g, ""));
  if (slugM) {
    const book = (BOOK_ALIASES[slugM[1].toLowerCase()] || slugM[1].toLowerCase());
    const ch = Number(slugM[2]);
    const v1 = slugM[3] ? Number(slugM[3]) : null;
    const v2 = slugM[4] ? Number(slugM[4]) : null;
    return scopeResult(book, ch, v1, v2, raw);
  }

  // "John 3:16" / "Psalm 23" / "1 John 1:1-3"
  const m =
    /^((?:[1-3]|I{1,3}|II|III)\s*)?([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(\d+)(?:\s*[:.]\s*(\d+)(?:\s*-\s*(\d+))?)?$/i.exec(
      raw
    );
  if (!m) return { ok: false, q: raw, error: "unrecognized passage" };
  const prefix = (m[1] || "").trim().toLowerCase().replace(/iii/i, "3").replace(/ii/i, "2").replace(/i$/i, "1");
  const name = `${prefix ? prefix + " " : ""}${m[2]}`.trim().toLowerCase().replace(/\s+/g, " ");
  const book = BOOK_ALIASES[name] || BOOK_ALIASES[m[2].toLowerCase()];
  if (!book) return { ok: false, q: raw, error: "unknown book" };
  const ch = Number(m[3]);
  const v1 = m[4] ? Number(m[4]) : null;
  const v2 = m[5] ? Number(m[5]) : null;
  return scopeResult(book, ch, v1, v2, raw);
}

function scopeResult(
  book: string,
  ch: number,
  v1: number | null,
  v2: number | null,
  q: string
): ResolveResult {
  let scope: Scope;
  if (v1 != null && v2 != null && v2 !== v1) {
    const lo = Math.min(v1, v2);
    const hi = Math.max(v1, v2);
    scope = {
      kind: "range",
      osis: `${book.toUpperCase()}.${ch}.${lo}-${hi}`,
      slug: `${book}.${ch}.${lo}-${hi}`,
    };
  } else if (v1 != null) {
    scope = {
      kind: "verse",
      osis: `${book.toUpperCase()}.${ch}.${v1}`,
      slug: `${book}.${ch}.${v1}`,
    };
  } else {
    scope = {
      kind: "chapter",
      osis: `${book.toUpperCase()}.${ch}`,
      slug: `${book}.${ch}`,
    };
  }
  const label = displayScope(scope);
  return { ok: true, q, scope, label };
}

/**
 * Human book name from any common id (`1sa` / `1SA` / `1sam` / `1 samuel` → `1 Samuel`).
 * Never returns raw OSIS shouting when a map hit exists.
 */
export function bookLabel(osisBook: string): string {
  const raw = (osisBook || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const compact = raw.replace(/\s+/g, "");
  const canonical =
    BOOK_ALIASES[raw] ||
    BOOK_ALIASES[compact] ||
    (OSIS_LABEL[raw] ? raw : undefined) ||
    (OSIS_LABEL[compact] ? compact : undefined) ||
    raw;
  if (OSIS_LABEL[canonical]) return OSIS_LABEL[canonical];
  if (OSIS_LABEL[raw]) return OSIS_LABEL[raw];
  if (OSIS_LABEL[compact]) return OSIS_LABEL[compact];
  // Prefer title-ish over ALL-CAPS OSIS when unknown
  if (/^[1-3]?[a-z]{2,5}$/i.test(compact)) {
    return compact.length <= 4 ? compact.toUpperCase() : compact;
  }
  return osisBook.trim() || "Unknown";
}

/** Natural-language passage from scope or slug — never surface raw `1SA.15.15`. */
export function displayScope(scope: Scope): string {
  const slug = (scope.slug || scope.osis || "").trim();
  const m =
    /^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$/i.exec(slug.replace(/\s+/g, "")) ||
    /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)-(\d+)$/i.exec(slug.replace(/\s+/g, ""));
  if (m) {
    const name = bookLabel(m[1]);
    const ch = m[2];
    const v1 = m[3];
    const v2 = m[4];
    if (v1 && v2 && v1 !== v2) return `${name} ${ch}:${v1}–${v2}`;
    if (v1) return `${name} ${ch}:${v1}`;
    return `${name} ${ch}`;
  }
  // kind-based fallback when slug is nonstandard
  const book = slug.split(".")[0];
  const name = bookLabel(book);
  if (scope.kind === "chapter") {
    const ch = slug.split(".")[1];
    return ch ? `${name} ${ch}` : name;
  }
  if (scope.kind === "verse") {
    const [, ch, v] = slug.split(".");
    if (ch && v) return `${name} ${ch}:${v}`;
  }
  const range = /\.(\d+)\.(\d+)-(\d+)$/.exec(slug);
  if (range) return `${name} ${range[1]}:${range[2]}–${range[3]}`;
  return name !== book.toUpperCase() ? name : slug;
}

export function suggestLocal(q: string, limit = 8): SuggestItem[] {
  const raw = (q || "").trim().toLowerCase();
  if (raw.length < 1) return [];
  const out: SuggestItem[] = [];
  // book name completions
  for (const [alias, osis] of Object.entries(BOOK_ALIASES)) {
    if (!alias.startsWith(raw) && !alias.includes(raw)) continue;
    if (alias.length > 20) continue;
    const label = OSIS_LABEL[osis] || osis;
    if (out.some((x) => x.canonical === osis + ".1")) continue;
    out.push({
      label: `${label} 1`,
      insertText: `${label} 1`,
      canonical: `${osis}.1`,
      kind: "chapter",
    });
    if (out.length >= limit) break;
  }
  // if looks like partial ref, try resolve
  if (/\d/.test(raw)) {
    const r = resolveLocal(q);
    if (r.ok && r.scope) {
      out.unshift({
        label: r.label || r.scope.osis,
        insertText: r.label || r.scope.osis,
        canonical: r.scope.slug,
        kind: r.scope.kind,
      });
    }
  }
  return out.slice(0, limit);
}

export function chapterSlugOf(noteSlug: string): string {
  const parts = noteSlug.split(".");
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return noteSlug;
}
