import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
import type { Note } from "@/src/api/types";
import { InlineMarkdown } from "@/src/lib/inlineMarkdown";
import { hydrateBlocks } from "@/src/api/client";

export default function HomeScreen() {
  const { client, door, protocol, clearSession } = useSession();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    setErr(null);
    try {
      const list = await client.listNotes();
      setNotes(list);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  const openPassage = async () => {
    if (!client || !q.trim()) return;
    try {
      const r = await client.resolve(q.trim());
      if (!r.ok || !r.scope) {
        setErr(r.error || "invalid passage");
        return;
      }
      router.push(`/read/${encodeURIComponent(r.scope.slug)}`);
    } catch (e) {
      setErr(String(e));
    }
  };

  if (!client) {
    return (
      <View style={styles.center}>
        <Text>No door open.</Text>
        <Link href="/" style={{ marginTop: 12 }}>
          Enter door
        </Link>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Text style={styles.door} numberOfLines={1}>
          {door}
        </Text>
        <Text style={styles.meta}>
          {protocol?.version ? `protocol ${protocol.version}` : "…"} · {notes.length} notes
        </Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="John 3:16 · psa 33 · go to reader"
            placeholderTextColor="#999"
            autoCapitalize="none"
            onSubmitEditing={openPassage}
            returnKeyType="go"
          />
          <Pressable style={styles.go} onPress={openPassage}>
            <Text style={styles.goTxt}>Go</Text>
          </Pressable>
        </View>
        <View style={styles.navRow}>
          <Pressable onPress={() => router.push("/pack")}>
            <Text style={styles.link}>Pack / export</Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              await clearSession();
              router.replace("/");
            }}
          >
            <Text style={styles.link}>Switch door</Text>
          </Pressable>
        </View>
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </View>

      {busy && !notes.length ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(n) => n.id || n.scope?.slug || String(Math.random())}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          ListEmptyComponent={<Text style={styles.empty}>No notes yet — open a passage.</Text>}
          renderItem={({ item }) => {
            const slug = item.scope?.slug || "";
            const label = item.scope?.osis || slug;
            const preview = item.encrypted
              ? "Encrypted"
              : hydrateBlocks(item)
                  .map((b) => b.text)
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(" · ");
            const attN = (item.attachments || []).length;
            return (
              <Pressable
                style={styles.card}
                onPress={() => router.push(`/read/${encodeURIComponent(slug)}`)}
                onLongPress={() => router.push(`/note/${encodeURIComponent(slug)}`)}
              >
                <Text style={styles.cardTitle}>{label}</Text>
                {preview ? (
                  item.encrypted ? (
                    <Text style={styles.cardBody}>{preview}</Text>
                  ) : (
                    <InlineMarkdown text={preview} style={styles.cardBody} />
                  )
                ) : null}
                <Text style={styles.cardMeta}>
                  {item.scope?.kind || "note"}
                  {attN ? ` · ${attN} attach` : ""}
                  {item.updated_at ? ` · ${item.updated_at.slice(0, 10)}` : ""}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#faf9f7" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  navRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  link: { color: "#336", fontWeight: "600", fontSize: 13 },
  err: { color: "#a33", fontSize: 13 },
  empty: { textAlign: "center", color: "#888", marginTop: 40 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#111", marginBottom: 4 },
  cardBody: { fontSize: 14, color: "#444", lineHeight: 20 },
  cardMeta: { marginTop: 8, fontSize: 11, color: "#999" },
});
