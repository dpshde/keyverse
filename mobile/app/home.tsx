import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSession } from "@/src/context/SessionContext";
import type { Note, SuggestItem } from "@/src/api/types";
import { InlineMarkdown } from "@/src/lib/inlineMarkdown";
import { buildNoteTree, type TreeFolder, type TreeLeaf, type TreeNode } from "@/src/lib/noteTree";
import * as Local from "@/src/lib/localPack";
import { resolveLocal, suggestLocal } from "@/src/lib/resolveLocal";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function HomeScreen() {
  const {
    cloudEnabled,
    cloudDoor,
    translation,
    hasPassphrase,
    setPassphrase,
    clearPassphrase,
  } = useSession();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pw, setPw] = useState("");

  const foldKey = "kv.fold.local";

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const [list, foldRaw] = await Promise.all([
        Local.listNotes(),
        AsyncStorage.getItem(foldKey),
      ]);
      setNotes(list);
      if (foldRaw) setCollapsed(JSON.parse(foldRaw) || {});
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (q.trim().length < 1) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => setSuggestions(suggestLocal(q.trim())), 120);
    return () => clearTimeout(t);
  }, [q]);

  const tree = useMemo(() => buildNoteTree(notes), [notes]);
  const flat = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  const toggle = async (id: string) => {
    const was = !!collapsed[id];
    const map2 = { ...collapsed };
    if (was) delete map2[id];
    else map2[id] = true;
    setCollapsed(map2);
    await AsyncStorage.setItem(foldKey, JSON.stringify(map2));
  };

  const openPassage = async (query?: string) => {
    const qq = (query ?? q).trim();
    if (!qq) return;
    const r = resolveLocal(qq);
    if (!r.ok || !r.scope) {
      setErr(r.error || "invalid passage");
      return;
    }
    setSuggestions([]);
    setQ("");
    router.push(`/read/${encodeURIComponent(r.scope.slug)}`);
  };

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Text style={styles.door} numberOfLines={1}>
          Local pack{cloudEnabled ? ` · cloud ${cloudDoor}` : " · offline"}
        </Text>
        <Text style={styles.meta}>
          {translation} · {notes.length} notes{hasPassphrase ? " · 🔒" : ""}
        </Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="John 3:16 · psa 33"
            placeholderTextColor="#999"
            autoCapitalize="none"
            onSubmitEditing={() => openPassage()}
            returnKeyType="go"
          />
          <Pressable style={styles.go} onPress={() => openPassage()}>
            <Text style={styles.goTxt}>Go</Text>
          </Pressable>
        </View>
        {suggestions.length > 0 ? (
          <View style={styles.sugBox}>
            {suggestions.map((s) => (
              <Pressable
                key={s.canonical + s.label}
                style={styles.sug}
                onPress={() => openPassage(s.insertText || s.canonical)}
              >
                <Text style={styles.sugTxt}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.pwRow}>
          <TextInput
            style={styles.pw}
            value={pw}
            onChangeText={setPw}
            placeholder="Passphrase (optional encrypt)"
            placeholderTextColor="#999"
            secureTextEntry
            autoCapitalize="none"
          />
          <Pressable
            style={styles.pwBtn}
            onPress={async () => {
              await setPassphrase(pw);
              setPw("");
            }}
          >
            <Text style={styles.pwBtnTxt}>Set</Text>
          </Pressable>
          {hasPassphrase ? (
            <Pressable onPress={() => clearPassphrase()}>
              <Text style={styles.link}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.navRow}>
          <Pressable onPress={() => router.push("/settings")}>
            <Text style={styles.link}>Settings · cloud</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/share")}>
            <Text style={styles.link}>Share</Text>
          </Pressable>
        </View>
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </View>

      {busy && !notes.length ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={flat}
          keyExtractor={(item) => item.key}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}
          contentContainerStyle={{ padding: 12, paddingBottom: 48 }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Notes stay on this device. Search a passage to read ({translation}) and capture.
            </Text>
          }
          renderItem={({ item }) => {
            if (item.kind === "folder") {
              const f = item.node as TreeFolder;
              const isCol = !!collapsed[f.id];
              return (
                <Pressable
                  style={[styles.folder, { marginLeft: item.depth * 12 }]}
                  onPress={() => toggle(f.id)}
                >
                  <Text style={styles.folderChev}>{isCol ? "▸" : "▾"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.folderTitle}>{f.label}</Text>
                    <Text style={styles.folderMeta}>{f.kids.length} items</Text>
                  </View>
                </Pressable>
              );
            }
            const leaf = item.node as TreeLeaf;
            return (
              <Pressable
                style={[styles.card, { marginLeft: item.depth * 12 }]}
                onPress={() => router.push(`/read/${encodeURIComponent(leaf.slug)}`)}
                onLongPress={() => router.push(`/note/${encodeURIComponent(leaf.slug)}`)}
              >
                <Text style={styles.cardTitle}>{leaf.label}</Text>
                {leaf.preview ? (
                  leaf.encrypted ? (
                    <Text style={styles.cardBody}>Encrypted</Text>
                  ) : (
                    <InlineMarkdown text={leaf.preview} style={styles.cardBody} />
                  )
                ) : null}
                <Text style={styles.cardMeta}>
                  {leaf.kind}
                  {leaf.attCount ? ` · ${leaf.attCount} attach` : ""}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function flattenTree(
  nodes: TreeNode[],
  collapsed: Record<string, boolean>,
  depth = 0
): { key: string; kind: "folder" | "note"; node: TreeNode; depth: number }[] {
  const out: { key: string; kind: "folder" | "note"; node: TreeNode; depth: number }[] = [];
  for (const n of nodes) {
    if (n.type === "folder") {
      out.push({ key: n.id, kind: "folder", node: n, depth });
      if (!collapsed[n.id]) out.push(...flattenTree(n.kids, collapsed, depth + 1));
    } else {
      out.push({ key: n.id, kind: "note", node: n, depth });
    }
  }
  return out;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#faf9f7" },
  top: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.1)",
    backgroundColor: "#fff",
    gap: 6,
  },
  door: { fontSize: 13, fontWeight: "600", color: "#666" },
  meta: { fontSize: 12, color: "#888" },
  searchRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  search: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.15)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#f6f6f6",
  },
  go: {
    backgroundColor: "#161616",
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  goTxt: { color: "#fff", fontWeight: "700" },
  sugBox: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.12)",
    overflow: "hidden",
  },
  sug: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  sugTxt: { fontSize: 15, color: "#222" },
  pwRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pw: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.12)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  pwBtn: { backgroundColor: "#eee", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  pwBtnTxt: { fontWeight: "600" },
  navRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  link: { color: "#336", fontWeight: "600", fontSize: 13 },
  err: { color: "#a33", fontSize: 13 },
  empty: { textAlign: "center", color: "#888", marginTop: 40, paddingHorizontal: 24, lineHeight: 20 },
  folder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  folderChev: { fontSize: 14, color: "#666", width: 16 },
  folderTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  folderMeta: { fontSize: 12, color: "#888" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#111", marginBottom: 4 },
  cardBody: { fontSize: 14, color: "#444", lineHeight: 20 },
  cardMeta: { marginTop: 8, fontSize: 11, color: "#999" },
});
