import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSession } from "@/src/context/SessionContext";
import type { Attachment, Block, Note } from "@/src/api/types";
import { hydrateBlocks } from "@/src/api/client";
import { Outliner } from "@/src/components/Outliner";
import { AttachmentList } from "@/src/components/AttachmentList";

export default function NoteScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = decodeURIComponent(String(raw || ""));
  const { client } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [encrypted, setEncrypted] = useState(false);
  const [noteMeta, setNoteMeta] = useState<Note | null>(null);

  const load = useCallback(async () => {
    if (!client || !slug) return;
    setBusy(true);
    try {
      try {
        const note = await client.getNote(slug);
        setNoteMeta(note);
        setEncrypted(!!note.encrypted);
        if (note.encrypted) {
          setBlocks([]);
          setAttachments([]);
          setStatus("Encrypted on server — decrypt on web client for now");
        } else {
          setBlocks(hydrateBlocks(note));
          setAttachments((note.attachments || []) as Attachment[]);
          setStatus("Loaded");
        }
      } catch (e: unknown) {
        // 404 = empty note at address
        const msg = String(e);
        if (msg.includes("404") || msg.includes("no note")) {
          setBlocks([{ id: `b_${Date.now()}`, indent: 0, text: "" }]);
          setAttachments([]);
          setEncrypted(false);
          setStatus("New note");
        } else {
          throw e;
        }
      }
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }, [client, slug]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: noteMeta?.scope?.osis || slug,
    });
  }, [navigation, noteMeta, slug]);

  const save = async () => {
    if (!client || encrypted) return;
    setSaving(true);
    try {
      // Omit attachments to preserve server-side list when we only edit blocks —
      // but we manage attachments via dedicated endpoints; if local list is source
      // after attach ops, send explicit attachments to stay in sync.
      const res = await client.putNote(slug, {
        blocks,
        attachments,
      });
      if ("deleted" in res && res.deleted) {
        setStatus("Deleted (empty)");
        router.back();
        return;
      }
      const note = res as Note;
      setNoteMeta(note);
      setBlocks(hydrateBlocks(note));
      setAttachments((note.attachments || []) as Attachment[]);
      setStatus("Saved");
    } catch (e) {
      Alert.alert("Save failed", String(e));
      setStatus(String(e));
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.slug}>{slug}</Text>
        <Text style={styles.status}>{status}</Text>

        {encrypted ? (
          <Text style={styles.warn}>
            This note is sealed (client-side cipher). Full passphrase unlock lands next; use web
            mirror to edit sealed notes for now.
          </Text>
        ) : (
          <>
            <Outliner blocks={blocks} onChange={setBlocks} editable honorCollapse />
            <AttachmentList
              slug={slug}
              attachments={attachments}
              client={client}
              onChange={setAttachments}
              onNoteFromServer={(n) => {
                if (n.attachments) setAttachments(n.attachments as Attachment[]);
              }}
            />
            <View style={styles.footer}>
              <Pressable style={styles.primary} onPress={save} disabled={saving}>
                <Text style={styles.primaryTxt}>{saving ? "Saving…" : "Save note"}</Text>
              </Pressable>
              <Pressable
                style={styles.secondary}
                onPress={() => router.push(`/read/${encodeURIComponent(slug)}`)}
              >
                <Text style={styles.secondaryTxt}>Open in reader</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, paddingBottom: 48, backgroundColor: "#faf9f7" },
  slug: { fontSize: 13, fontWeight: "600", color: "#666" },
  status: { fontSize: 12, color: "#888", marginBottom: 12 },
  warn: {
    backgroundColor: "#fff3cd",
    padding: 12,
    borderRadius: 10,
    color: "#664",
    lineHeight: 20,
  },
  footer: { marginTop: 24, gap: 10 },
  primary: {
    backgroundColor: "#161616",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondary: { alignItems: "center", padding: 10 },
  secondaryTxt: { fontWeight: "600", color: "#336" },
});
