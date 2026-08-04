/**
 * Canonical book list + chapter counts for the passage picker sheet.
 * Labels match resolveLocal OSIS labels; slugs are lower OSIS book codes.
 */

export type BibleBook = {
  /** Lower OSIS book id (gen, 1sa, jhn, …) */
  osis: string;
  /** Display name (Genesis, 1 Samuel, …) */
  label: string;
  chapters: number;
};

/** Old + New Testament in traditional order */
export const BIBLE_BOOKS: BibleBook[] = [
  { osis: "gen", label: "Genesis", chapters: 50 },
  { osis: "exo", label: "Exodus", chapters: 40 },
  { osis: "lev", label: "Leviticus", chapters: 27 },
  { osis: "num", label: "Numbers", chapters: 36 },
  { osis: "deu", label: "Deuteronomy", chapters: 34 },
  { osis: "jos", label: "Joshua", chapters: 24 },
  { osis: "jdg", label: "Judges", chapters: 21 },
  { osis: "rut", label: "Ruth", chapters: 4 },
  { osis: "1sa", label: "1 Samuel", chapters: 31 },
  { osis: "2sa", label: "2 Samuel", chapters: 24 },
  { osis: "1ki", label: "1 Kings", chapters: 22 },
  { osis: "2ki", label: "2 Kings", chapters: 25 },
  { osis: "1ch", label: "1 Chronicles", chapters: 29 },
  { osis: "2ch", label: "2 Chronicles", chapters: 36 },
  { osis: "ezr", label: "Ezra", chapters: 10 },
  { osis: "neh", label: "Nehemiah", chapters: 13 },
  { osis: "est", label: "Esther", chapters: 10 },
  { osis: "job", label: "Job", chapters: 42 },
  { osis: "psa", label: "Psalms", chapters: 150 },
  { osis: "pro", label: "Proverbs", chapters: 31 },
  { osis: "ecc", label: "Ecclesiastes", chapters: 12 },
  { osis: "sng", label: "Song of Songs", chapters: 8 },
  { osis: "isa", label: "Isaiah", chapters: 66 },
  { osis: "jer", label: "Jeremiah", chapters: 52 },
  { osis: "lam", label: "Lamentations", chapters: 5 },
  { osis: "ezk", label: "Ezekiel", chapters: 48 },
  { osis: "dan", label: "Daniel", chapters: 12 },
  { osis: "hos", label: "Hosea", chapters: 14 },
  { osis: "jol", label: "Joel", chapters: 3 },
  { osis: "amo", label: "Amos", chapters: 9 },
  { osis: "oba", label: "Obadiah", chapters: 1 },
  { osis: "jon", label: "Jonah", chapters: 4 },
  { osis: "mic", label: "Micah", chapters: 7 },
  { osis: "nam", label: "Nahum", chapters: 3 },
  { osis: "hab", label: "Habakkuk", chapters: 3 },
  { osis: "zep", label: "Zephaniah", chapters: 3 },
  { osis: "hag", label: "Haggai", chapters: 2 },
  { osis: "zec", label: "Zechariah", chapters: 14 },
  { osis: "mal", label: "Malachi", chapters: 4 },
  { osis: "mat", label: "Matthew", chapters: 28 },
  { osis: "mrk", label: "Mark", chapters: 16 },
  { osis: "luk", label: "Luke", chapters: 24 },
  { osis: "jhn", label: "John", chapters: 21 },
  { osis: "act", label: "Acts", chapters: 28 },
  { osis: "rom", label: "Romans", chapters: 16 },
  { osis: "1co", label: "1 Corinthians", chapters: 16 },
  { osis: "2co", label: "2 Corinthians", chapters: 13 },
  { osis: "gal", label: "Galatians", chapters: 6 },
  { osis: "eph", label: "Ephesians", chapters: 6 },
  { osis: "php", label: "Philippians", chapters: 4 },
  { osis: "col", label: "Colossians", chapters: 4 },
  { osis: "1th", label: "1 Thessalonians", chapters: 5 },
  { osis: "2th", label: "2 Thessalonians", chapters: 3 },
  { osis: "1ti", label: "1 Timothy", chapters: 6 },
  { osis: "2ti", label: "2 Timothy", chapters: 4 },
  { osis: "tit", label: "Titus", chapters: 3 },
  { osis: "phm", label: "Philemon", chapters: 1 },
  { osis: "heb", label: "Hebrews", chapters: 13 },
  { osis: "jas", label: "James", chapters: 5 },
  { osis: "1pe", label: "1 Peter", chapters: 5 },
  { osis: "2pe", label: "2 Peter", chapters: 3 },
  { osis: "1jn", label: "1 John", chapters: 5 },
  { osis: "2jn", label: "2 John", chapters: 1 },
  { osis: "3jn", label: "3 John", chapters: 1 },
  { osis: "jud", label: "Jude", chapters: 1 },
  { osis: "rev", label: "Revelation", chapters: 22 },
];

/** Alpha-sorted copy (ignore leading digit for sort key). */
export const BIBLE_BOOKS_ALPHA: BibleBook[] = [...BIBLE_BOOKS].sort((a, b) => {
  const clean = (s: string) => s.replace(/^\d\s*/, "");
  return clean(a.label).localeCompare(clean(b.label));
});

/** Letter → first book in alpha list (for rail labels). */
export function alphaRailEntries(
  books: BibleBook[] = BIBLE_BOOKS_ALPHA
): { book: BibleBook; label: string | null }[] {
  const seen = new Set<string>();
  return books.map((book) => {
    const letter = book.label.replace(/^\d\s*/, "")[0]?.toUpperCase() || "";
    if (!letter || seen.has(letter)) return { book, label: null };
    seen.add(letter);
    return { book, label: letter };
  });
}

export function getChapterCount(osis: string): number {
  const b = BIBLE_BOOKS.find((x) => x.osis === osis.toLowerCase());
  return b?.chapters ?? 1;
}

export function chapterSlug(osis: string, chapter: number): string {
  return `${osis.toLowerCase()}.${chapter}`;
}

/** Sparse chapter labels for the scrub rail (1, 5, 10, … last). */
export function chapterRailLabels(count: number): number[] {
  if (count <= 0) return [];
  const step = count <= 40 ? 5 : count <= 80 ? 10 : count <= 120 ? 15 : 20;
  const labels: number[] = [1];
  for (let ch = step; ch < count; ch += step) labels.push(ch);
  if (labels[labels.length - 1] !== count) labels.push(count);
  return labels;
}
