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

type VerseRow = {
  v: number;
  text: string;
  note?: Note | null;
  seedBlocks?: Block[];
};

export default function ReaderScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = decodeURIComponent(String(raw || ""));
  const { client } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState(slug);
  const [verses, setVerses] = useState<VerseRow[]>([]);
  const [seed, setSeed] = useState<Record<string, Block[]>>({});
  const [notesBySlug, setNotesBySlug] = useState<Record<string, Note>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    if (!client || !slug) return;
    setBusy(true);
    setErr(null);
    try {
      const bundle = await client.readBundle(slug);
      if (!bundle.ok && bundle.error) throw new Error(bundle.error);
      setTitle(String(bundle.meta?.display || slug));
      const s = bundle.seed || {};
      setSeed(s);
      // Load full notes for attachments flags
      const list = await client.listNotes();
      const map: Record<string, Note> = {};
      for (const n of list) {
        if (n.scope?.slug) map[n.scope.slug] = n;
      }
      setNotesBySlug(map);
      const rows: VerseRow[] = (bundle.text?.verses || []).map((vr) => {
        const vslug = `${String(bundle.text?.book || "").toLowerCase()}.${bundle.text?.chapter}.${vr.v}`;
        return {
          v: vr.v,
          text: vr.text || "",
          note: map[vslug] || null,
          seedBlocks: s[vslug],
        };
      });
      setVerses(rows);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [client, slug]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const bookChapter = useMemo(() => {
    const m = /^([a-z0-9]+)\.(\d+)/i.exec(slug);
    return m ? { book: m[1], chapter: m[2] } : null;
  }, [slug]);

  if (!client) {
    return (
      <View style={styles.center}>
        <Text>Open a door first.</Text>
      </View>
    );
  }

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
        <Pressable onPress={load} style={styles.retry}>
          <Text style={styles.retryTxt}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
      data={verses}
      keyExtractor={(item) => String(item.v)}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.h1}>{title}</Text>
          <Text style={styles.hSub}>Tap verse to expand notes · long-press to edit</Text>
          {bookChapter ? (
            <View style={styles.chNav}>
              <Pressable
                onPress={() =>
                  router.replace(
                    `/read/${bookChapter.book}.${Math.max(1, Number(bookChapter.chapter) - 1)}`
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
                  router.replace(`/read/${bookChapter.book}.${Number(bookChapter.chapter) + 1}`)
                }
              >
                <Text style={styles.link}>Next ch</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        const vslug = bookChapter
          ? `${bookChapter.book}.${bookChapter.chapter}.${item.v}`
          : `v${item.v}`;
        const note: Note | null | undefined = notesBySlug[vslug] ?? item.note;
        const blocks: Block[] | undefined =
          item.seedBlocks ||
          (note && !note.encrypted ? hydrateBlocks(note) : undefined);
        const attCount = note?.attachments?.length ?? 0;
        const has =
          !!note || !!(blocks && blocks.some((b) => (b.text || "").trim())) || attCount > 0;
        const isOpen = !!open[item.v];
        return (
          <View style={[styles.verse, has && styles.verseHas]}>
            <Pressable
              onPress={() => setOpen((o) => ({ ...o, [item.v]: !o[item.v] }))}
              onLongPress={() => router.push(`/note/${encodeURIComponent(vslug)}`)}
            >
              <Text style={styles.vtext}>
                <Text style={styles.vnum}>{item.v} </Text>
                {item.text}
              </Text>
            </Pressable>
            {isOpen ? (
              <View style={styles.tray}>
                {note?.encrypted ? (
                  <Text style={styles.muted}>Encrypted — open note to unlock on web for now.</Text>
                ) : blocks && blocks.some((b) => (b.text || "").trim()) ? (
                  blocks.map((b) => (
                    <View
                      key={b.id}
                      style={[styles.oline, { paddingLeft: 8 + (b.indent | 0) * 14 }]}
                    >
                      <View style={styles.odot} />
                      <InlineMarkdown text={b.text} style={styles.otxt} />
                    </View>
                  ))
                ) : (
                  <Text style={styles.muted}>No note yet</Text>
                )}
                {(note?.attachments || []).length ? (
                  <Text style={styles.attHint}>
                    {(note?.attachments || []).length} attachment(s) · open editor
                  </Text>
                ) : null}
                <Pressable
                  style={styles.editBtn}
                  onPress={() => router.push(`/note/${encodeURIComponent(vslug)}`)}
                >
                  <Text style={styles.editBtnTxt}>{has ? "Edit note" : "Add note"}</Text>
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

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#faf9f7" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  err: { color: "#a33", textAlign: "center" },
  retry: { marginTop: 12, padding: 10 },
  retryTxt: { fontWeight: "700" },
  header: { marginBottom: 12, gap: 6 },
  h1: { fontSize: 22, fontWeight: "700", color: "#111" },
  hSub: { fontSize: 13, color: "#888" },
  chNav: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  link: { fontWeight: "600", color: "#336", fontSize: 14 },
  verse: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  verseHas: {},
  vtext: { fontSize: 17, lineHeight: 26, color: "#1a1a1a" },
  vnum: { fontWeight: "700", color: "#888", fontSize: 13 },
  chip: { marginTop: 4, fontSize: 11, color: "#888", fontWeight: "600" },
  tray: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.04)",
    gap: 6,
  },
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
  attHint: { fontSize: 12, color: "#666", marginTop: 4 },
  editBtn: {
    alignSelf: "flex-start",
    marginTop: 6,
    backgroundColor: "#161616",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editBtnTxt: { color: "#fff", fontWeight: "600", fontSize: 13 },
});
