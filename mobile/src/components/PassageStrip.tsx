/**
 * Scripture strip above the note outliner (web `.passage-strip`).
 * Verse / range scopes only — chapter notes omit the strip (full chapter is the reader).
 * Bare on paper: no chip, rail, kicker, italic, or heavy fontWeight.
 * Presence = display scale + full ink + open leading (reader vocabulary, turned up).
 */
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSession } from "../context/SessionContext";
import { useTheme } from "../context/ThemeContext";
import { getChapter, peekChapter } from "../lib/textBundle";
import { fontRead, fontUi, space, type ThemeColors } from "../theme";

export type PassageVerse = { v: number; text: string };

/** Parse `book.ch.v` / `book.ch.v1-v2` → window. Chapter-only slugs return null. */
export function verseWindowFromSlug(
  slug: string
): { book: string; chapter: number; v0: number; v1: number } | null {
  const m = /^([1-3]?[a-z]+)\.(\d+)\.(\d+)(?:-(\d+))?$/i.exec((slug || "").trim());
  if (!m) return null;
  const vA = Number(m[3]);
  const vB = m[4] ? Number(m[4]) : vA;
  if (!Number.isFinite(vA) || !Number.isFinite(vB)) return null;
  return {
    book: m[1].toLowerCase(),
    chapter: Number(m[2]),
    v0: Math.min(vA, vB),
    v1: Math.max(vA, vB),
  };
}

type Props = {
  /** Note / scope slug, e.g. `psa.3.5` or `jhn.3.16-18` */
  slug: string;
  /** Optional display label for a11y (defaults to slug) */
  label?: string;
};

export function PassageStrip({ slug, label }: Props) {
  const { translation } = useSession();
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);
  const win = useMemo(() => verseWindowFromSlug(slug), [slug]);

  const [verses, setVerses] = useState<PassageVerse[]>(() => {
    if (!win) return [];
    const peeked = peekChapter(translation, win.book, win.chapter);
    return sliceVerses(peeked?.verses, win.v0, win.v1);
  });

  useEffect(() => {
    if (!win) {
      setVerses([]);
      return;
    }
    let cancelled = false;
    const peeked = peekChapter(translation, win.book, win.chapter);
    if (peeked?.verses?.length) {
      setVerses(sliceVerses(peeked.verses, win.v0, win.v1));
    }
    void getChapter(translation, win.book, win.chapter)
      .then((doc) => {
        if (cancelled) return;
        setVerses(sliceVerses(doc.verses, win.v0, win.v1));
      })
      .catch(() => {
        if (!cancelled && !peeked?.verses?.length) setVerses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [win, translation]);

  if (!win || verses.length === 0) return null;

  const a11y = `${label || slug} · ${translation}`;
  // Multi-verse ranges always show nums; single-verse title already names it.
  const showVerseNums = !(win.v0 === win.v1 && verses.length === 1);

  return (
    <View style={styles.strip} accessibilityRole="text" accessibilityLabel={a11y}>
      {verses.map((row) => (
        <Text key={row.v} style={styles.line}>
          {showVerseNums ? (
            <Text style={styles.vn}>
              {row.v}
              {"\u00A0"}
            </Text>
          ) : null}
          <Text style={styles.vt}>{row.text}</Text>
        </Text>
      ))}
    </View>
  );
}

function sliceVerses(
  rows: { v?: number; verse?: number; text?: string; t?: string }[] | undefined,
  v0: number,
  v1: number
): PassageVerse[] {
  if (!rows?.length) return [];
  const out: PassageVerse[] = [];
  for (const row of rows) {
    const v = Number(row.v ?? row.verse);
    if (!Number.isFinite(v) || v < v0 || v > v1) continue;
    const text = String(row.text ?? row.t ?? "").trim();
    if (!text) continue;
    out.push({ v, text });
  }
  return out;
}

function makeStyles(color: ThemeColors) {
  return StyleSheet.create({
    /**
     * Bare on paper. “Bolder” = larger regular serif + full ink + open leading —
     * not fontWeight 600 (Georgia bold looks muddy at body sizes).
     * Note card below stays 16 UI; this peaks above it as reading, not chrome.
     */
    strip: {
      paddingTop: space[1],
      // Tight into NOTE — capture surface sits close under the verse
      paddingBottom: space[1],
      marginBottom: 0,
      gap: space[2],
    },
    line: {
      fontSize: 22,
      lineHeight: 34,
      color: color.ink,
      fontFamily: fontRead,
    },
    vn: {
      fontSize: 13,
      fontWeight: "500",
      color: color.verseNum,
      fontFamily: fontUi,
      lineHeight: 34,
    },
    vt: {
      fontSize: 22,
      lineHeight: 34,
      // Regular — scale does the bold job
      fontWeight: "400",
      color: color.ink,
      fontFamily: fontRead,
      letterSpacing: -0.35,
    },
  });
}
