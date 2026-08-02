import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSession } from "@/src/context/SessionContext";
import type { Block, Note } from "@/src/api/types";
import { InlineMarkdown } from "@/src/lib/inlineMarkdown";
import { hydrateBlocks } from "@/src/api/client";
import { decryptPayload } from "@/src/lib/crypto";
import * as Local from "@/src/lib/localPack";
import { getChapter, chapterKey } from "@/src/lib/textBundle";
import { displayScope, resolveLocal, chapterSlugOf } from "@/src/lib/resolveLocal";

type VerseRow = {
  v: number;
  text: string;
  verseSlug: string;
  verseNote?: Note | null;
  rangeNotes: { slug: string; note: Note; label: string }[];
  inRangeCover: boolean;
};

export default function ReaderScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = decodeURIComponent(String(raw || ""));
  const { passphrase, translation } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState(slug);
  const [verses, setVerses] = useState<VerseRow[]>([]);
  const [notesBySlug, setNotesBySlug] = useState<Record<string, Note>>({});
  const [chapterNote, setChapterNote] = useState<Note | null>(null);
  const [chapterSlug, setChapterSlug] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState(false);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [resolvedBlocks, setResolvedBlocks] = useState<Record<string, Block[]>>({});

  const bookChapter = useMemo(() => {
    const m = /^([a-z0-9]+)\.(\d+)/i.exec(slug);
    return m ? { book: m[1].toLowerCase(), chapter: Number(m[2]) } : null;
  }, [slug]);

  const load = useCallback(async () => {
    if (!slug) return;
    setBusy(true);
    setErr(null);
    try {
      const r = resolveLocal(slug);
      const book = bookChapter?.book || "";
      const chapter = bookChapter?.chapter || 1;
      const text = await getChapter(translation, book, chapter);
      setTitle(
        `${displayScope(r.scope || { kind: "chapter", osis: `${book}.${chapter}`, slug: `${book}.${chapter}` })} · ${translation}`
      );

      const list = await Local.listNotes();
      const map: Record<string, Note> = {};
      for (const n of list) if (n.scope?.slug) map[n.scope.slug] = n;
      setNotesBySlug(map);

      const chSlug = chapterKey(book, chapter);
      setChapterSlug(chSlug);
      setChapterNote(map[chSlug] || null);

      const rangeByEnd = new Map<
        number,
        { slug: string; note: Note; label: string; lo: number; hi: number }[]
      >();
      const cover = new Set<number>();
      for (const n of list) {
        if (n.scope?.kind !== "range") continue;
        const osis = n.scope.osis || n.scope.slug;
        const m = /\.(\d+)\.(\d+)-(\d+)$/i.exec(osis);
        if (!m) continue;
        if (!n.scope.slug.toLowerCase().startsWith(book + "." + chapter)) continue;
        const lo = Number(m[2]);
        const hi = Number(m[3]);
        for (let v = lo; v <= hi; v++) cover.add(v);
        const arr = rangeByEnd.get(hi) || [];
        arr.push({ slug: n.scope.slug, note: n, label: n.scope.osis, lo, hi });
        rangeByEnd.set(hi, arr);
      }

      setVerses(
        (text.verses || []).map((vr) => {
          const vslug = `${book}.${chapter}.${vr.v}`;
          return {
            v: vr.v,
            text: vr.text || "",
            verseSlug: vslug,
            verseNote: map[vslug] || null,
            rangeNotes: rangeByEnd.get(vr.v) || [],
            inRangeCover: cover.has(vr.v),
          };
        })
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [slug, translation, bookChapter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const next: Record<string, Block[]> = {};
      for (const [sl, n] of Object.entries(notesBySlug)) {
        if (n.encrypted && n.cipher && passphrase) {
          try {
            const p = await decryptPayload(n.cipher, passphrase);
            next[sl] = p.blocks;
          } catch {
            /* locked */
          }
        } else if (!n.encrypted) {
          next[sl] = hydrateBlocks(n);
        }
      }
      setResolvedBlocks(next);
    })();
  }, [notesBySlug, passphrase]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: title.length > 28 ? title.slice(0, 28) + "…" : title,
      headerRight: () => (
        <Pressable onPress={() => setExpandAll((x) => !x)} style={{ marginRight: 8 }}>
          <Text style={{ fontWeight: "700", color: "#1a5fb4" }}>{expandAll ? "Fold" : "Expand"}</Text>
        </Pressable>
      ),
    });
  }, [navigation, title, expandAll]);

  if (busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (err) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>{err}</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const isOpen = (key: string) => expandAll || !!open[key];

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      data={verses}
      keyExtractor={(item) => String(item.v)}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.h1}>{title}</Text>
          <Text style={styles.hSub}>Bundled {translation} · tap note · long-press range</Text>
          {chapterNote || resolvedBlocks[chapterSlug]?.length ? (
            <Pressable
              style={styles.chNote}
              onPress={() => setOpen((o) => ({ ...o, chapter: !o.chapter }))}
              onLongPress={() => router.push(`/note/${encodeURIComponent(chapterSlug)}`)}
            >
              <Text style={styles.chNoteLbl}>Chapter note</Text>
              {isOpen("chapter") ? (
                <OutlineView blocks={resolvedBlocks[chapterSlug] || []} />
              ) : (
                <Text style={styles.chip}>tap to expand</Text>
              )}
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push(`/note/${encodeURIComponent(chapterSlug)}`)}>
              <Text style={styles.link}>+ Chapter note</Text>
            </Pressable>
          )}
          {bookChapter ? (
            <View style={styles.chNav}>
              <Pressable
                onPress={() =>
                  router.replace(
                    `/read/${bookChapter.book}.${Math.max(1, bookChapter.chapter - 1)}`
                  )
                }
              >
                <Text style={styles.link}>Prev ch</Text>
              </Pressable>
              <Pressable onPress={() => router.push("/home")}>
                <Text style={styles.link}>Home</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  router.replace(`/read/${bookChapter.book}.${bookChapter.chapter + 1}`)
                }
              >
                <Text style={styles.link}>Next ch</Text>
              </Pressable>
            </View>
          ) : null}
          {sel ? (
            <Pressable onPress={() => setSel(null)}>
              <Text style={{ color: "#a33", fontWeight: "600" }}>Cancel range from v{sel.a}</Text>
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        const note: Note | null | undefined = notesBySlug[item.verseSlug] ?? item.verseNote;
        const blocks = resolvedBlocks[item.verseSlug];
        const attCount = note?.attachments?.length ?? 0;
        const hasVerse =
          !!note || !!(blocks && blocks.some((b) => (b.text || "").trim())) || attCount > 0;
        const has = hasVerse || item.rangeNotes.length > 0 || item.inRangeCover;
        const key = "v" + item.v;
        const opened = isOpen(key);
        const selected =
          sel && item.v >= Math.min(sel.a, sel.b) && item.v <= Math.max(sel.a, sel.b);

        return (
          <View style={[styles.verse, selected && styles.verseSel]}>
            <Pressable
              onPress={() => {
                if (sel) {
                  const a = Math.min(sel.a, item.v);
                  const b = Math.max(sel.a, item.v);
                  setSel(null);
                  if (bookChapter && a !== b) {
                    router.push(
                      `/note/${encodeURIComponent(`${bookChapter.book}.${bookChapter.chapter}.${a}-${b}`)}`
                    );
                    return;
                  }
                }
                setOpen((o) => ({ ...o, [key]: !o[key] }));
              }}
              onLongPress={() => {
                if (!sel) setSel({ a: item.v, b: item.v });
                else router.push(`/note/${encodeURIComponent(item.verseSlug)}`);
              }}
            >
              <Text style={styles.vtext}>
                <Text style={styles.vnum}>{item.v} </Text>
                {item.text}
              </Text>
            </Pressable>
            {opened ? (
              <View style={styles.tray}>
                {note?.encrypted && !blocks?.length ? (
                  <Text style={styles.muted}>Encrypted — set passphrase on Home</Text>
                ) : blocks && blocks.some((b) => (b.text || "").trim()) ? (
                  <OutlineView blocks={blocks} />
                ) : (
                  <Text style={styles.muted}>No verse note</Text>
                )}
                {item.rangeNotes.map((rn) => (
                  <View key={rn.slug} style={styles.rangeBox}>
                    <Text style={styles.rangeLbl}>{rn.label}</Text>
                    <OutlineView blocks={resolvedBlocks[rn.slug] || hydrateBlocks(rn.note)} />
                    <Pressable onPress={() => router.push(`/note/${encodeURIComponent(rn.slug)}`)}>
                      <Text style={styles.link}>Edit range</Text>
                    </Pressable>
                  </View>
                ))}
                <Pressable
                  style={styles.editBtn}
                  onPress={() => router.push(`/note/${encodeURIComponent(item.verseSlug)}`)}
                >
                  <Text style={styles.editBtnTxt}>{hasVerse ? "Edit note" : "Add note"}</Text>
                </Pressable>
              </View>
            ) : has ? (
              <Text style={styles.chip}>note</Text>
            ) : null}
          </View>
        );
      }}
    />
  );
}

function OutlineView({ blocks }: { blocks: Block[] }) {
  return (
    <View style={{ gap: 4 }}>
      {blocks.map((b) => (
        <View key={b.id} style={[styles.oline, { paddingLeft: 8 + (b.indent | 0) * 14 }]}>
          <View style={styles.odot} />
          <InlineMarkdown text={b.text} style={styles.otxt} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#faf9f7" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  err: { color: "#a33", textAlign: "center" },
  header: { marginBottom: 12, gap: 8 },
  h1: { fontSize: 20, fontWeight: "700", color: "#111" },
  hSub: { fontSize: 13, color: "#888" },
  chNote: { backgroundColor: "rgba(0,0,0,0.04)", borderRadius: 12, padding: 12, gap: 6 },
  chNoteLbl: { fontWeight: "700", fontSize: 13, color: "#555" },
  chNav: { flexDirection: "row", justifyContent: "space-between" },
  link: { fontWeight: "600", color: "#336", fontSize: 14 },
  verse: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  verseSel: { backgroundColor: "rgba(26,95,180,0.08)", borderRadius: 8 },
  vtext: { fontSize: 17, lineHeight: 26, color: "#1a1a1a" },
  vnum: { fontWeight: "700", color: "#888", fontSize: 13 },
  chip: { marginTop: 4, fontSize: 11, color: "#888", fontWeight: "600" },
  tray: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.04)",
    gap: 8,
  },
  rangeBox: { padding: 8, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.03)", gap: 4 },
  rangeLbl: { fontSize: 12, fontWeight: "700", color: "#666" },
  oline: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  odot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(0,0,0,0.3)",
    marginTop: 8,
  },
  otxt: { flex: 1, fontSize: 15, lineHeight: 22, color: "#333" },
  muted: { color: "#888", fontSize: 14 },
  editBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#161616",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editBtnTxt: { color: "#fff", fontWeight: "600", fontSize: 13 },
});
