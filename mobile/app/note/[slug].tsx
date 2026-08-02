import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSession } from "@/src/context/SessionContext";
import type { Attachment, Block, Note } from "@/src/api/types";
import { hydrateBlocks, isBlankNote } from "@/src/api/client";
import { Outliner } from "@/src/components/Outliner";
import { AttachmentList } from "@/src/components/AttachmentList";
import { decryptPayload, encryptPayload } from "@/src/lib/crypto";

export default function NoteScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = decodeURIComponent(String(raw || ""));
  const { client, passphrase, hasPassphrase } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [wantEncrypt, setWantEncrypt] = useState(false);
  const [locked, setLocked] = useState(false);
  const [noteMeta, setNoteMeta] = useState<Note | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef(blocks);
  const attsRef = useRef(attachments);
  blocksRef.current = blocks;
  attsRef.current = attachments;

  const load = useCallback(async () => {
    if (!client || !slug) return;
    setBusy(true);
    try {
      try {
        const note = await client.getNote(slug);
        setNoteMeta(note);
        if (note.encrypted && note.cipher) {
          if (!passphrase) {
            setLocked(true);
            setBlocks([]);
            setAttachments([]);
            setStatus("Encrypted — set passphrase on Home");
          } else {
            try {
              const plain = await decryptPayload(note.cipher, passphrase);
              setBlocks(plain.blocks.length ? plain.blocks : [{ id: `b_${Date.now()}`, indent: 0, text: "" }]);
              setAttachments(plain.attachments || []);
              setLocked(false);
              setWantEncrypt(true);
              setStatus("Unlocked");
            } catch {
              setLocked(true);
              setStatus("Wrong passphrase");
            }
          }
        } else {
          setLocked(false);
          setWantEncrypt(false);
          setBlocks(hydrateBlocks(note));
          setAttachments((note.attachments || []) as Attachment[]);
          setStatus("Loaded");
        }
      } catch (e: unknown) {
        const msg = String(e);
        if (msg.includes("404") || msg.includes("no note")) {
          setBlocks([{ id: `b_${Date.now()}`, indent: 0, text: "" }]);
          setAttachments([]);
          setLocked(false);
          setWantEncrypt(hasPassphrase);
          setStatus("New note");
        } else throw e;
      }
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }, [client, slug, passphrase, hasPassphrase]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!client || locked) return;
    setSaving(true);
    try {
      const b = blocksRef.current;
      const a = attsRef.current;
      if (isBlankNote(b, a) && !wantEncrypt) {
        const res = await client.putNote(slug, { blocks: b, attachments: a });
        if ("deleted" in res && res.deleted) {
          setStatus("Deleted");
          router.back();
          return;
        }
      }
      if (wantEncrypt) {
        if (!passphrase) {
          Alert.alert("Passphrase required", "Set a pack passphrase on Home first.");
          setSaving(false);
          return;
        }
        const cipher = await encryptPayload({ blocks: b, attachments: a }, passphrase);
        const res = await client.putNote(slug, { encrypted: true, cipher });
        setNoteMeta(res as Note);
        setStatus("Saved · encrypted");
      } else {
        const res = await client.putNote(slug, { blocks: b, attachments: a });
        if ("deleted" in res && res.deleted) {
          setStatus("Deleted");
          router.back();
          return;
        }
        const note = res as Note;
        setNoteMeta(note);
        setBlocks(hydrateBlocks(note));
        setAttachments((note.attachments || []) as Attachment[]);
        setStatus("Saved");
      }
    } catch (e) {
      Alert.alert("Save failed", String(e));
      setStatus(String(e));
    } finally {
      setSaving(false);
    }
  }, [client, locked, wantEncrypt, passphrase, slug, router]);

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      save();
    }, 900);
  }, [save]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: noteMeta?.scope?.osis || slug,
      headerRight: () => (
        <Pressable onPress={save} disabled={saving || locked} style={{ marginRight: 4 }}>
          <Text style={{ fontWeight: "700", color: locked ? "#aaa" : "#1a5fb4" }}>
            {saving ? "…" : "Save"}
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, noteMeta, slug, save, saving, locked]);

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

        {locked ? (
          <Text style={styles.warn}>
            Sealed note. Set the correct pack passphrase on Home, then reopen.
          </Text>
        ) : (
          <>
            <View style={styles.encryptRow}>
              <Text style={styles.encryptLbl}>Encrypt on save</Text>
              <Switch
                value={wantEncrypt}
                onValueChange={setWantEncrypt}
                disabled={!hasPassphrase && !wantEncrypt}
              />
            </View>
            {!hasPassphrase && wantEncrypt ? (
              <Text style={styles.warn}>Set a passphrase on Home to encrypt.</Text>
            ) : null}

            <Outliner
              blocks={blocks}
              onChange={setBlocks}
              editable
              honorCollapse
              onDirty={scheduleSave}
            />
            <AttachmentList
              slug={slug}
              attachments={attachments}
              client={client}
              onChange={(atts) => {
                setAttachments(atts);
                scheduleSave();
              }}
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
    marginBottom: 8,
  },
  encryptRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingVertical: 4,
  },
  encryptLbl: { fontSize: 15, fontWeight: "600", color: "#333" },
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
