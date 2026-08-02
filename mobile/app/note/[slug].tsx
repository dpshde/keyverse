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
import { hydrateBlocks } from "@/src/api/client";
import { Outliner } from "@/src/components/Outliner";
import { LocalAttachmentList } from "@/src/components/LocalAttachmentList";
import { decryptPayload, encryptPayload } from "@/src/lib/crypto";
import * as Local from "@/src/lib/localPack";
import { mirrorNoteIfCloud } from "@/src/lib/cloudSync";
import { isBlankNote } from "@/src/api/client";

export default function NoteScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = decodeURIComponent(String(raw || ""));
  const { passphrase, hasPassphrase, cloudEnabled } = useSession();
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
    if (!slug) return;
    setBusy(true);
    try {
      const note = await Local.getNote(slug);
      if (!note) {
        setBlocks(Local.emptyBlocks());
        setAttachments([]);
        setLocked(false);
        setWantEncrypt(hasPassphrase);
        setStatus("New note · local");
        setNoteMeta(null);
      } else {
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
              setBlocks(
                plain.blocks.length ? plain.blocks : Local.emptyBlocks()
              );
              setAttachments(plain.attachments || []);
              setLocked(false);
              setWantEncrypt(true);
              setStatus("Unlocked · local");
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
          setStatus("Loaded · local");
        }
      }
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }, [slug, passphrase, hasPassphrase]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (locked) return;
    setSaving(true);
    try {
      const b = blocksRef.current;
      const a = attsRef.current;
      let res: Note | { deleted: true; slug: string };
      if (wantEncrypt) {
        if (!passphrase) {
          Alert.alert("Passphrase required", "Set a pack passphrase on Home first.");
          setSaving(false);
          return;
        }
        const cipher = await encryptPayload({ blocks: b, attachments: a }, passphrase);
        res = await Local.putNote(slug, { encrypted: true, cipher });
      } else {
        res = await Local.putNote(slug, { blocks: b, attachments: a });
      }
      if ("deleted" in res && res.deleted) {
        setStatus("Deleted");
        if (cloudEnabled) mirrorNoteIfCloud(slug).catch(() => {});
        router.back();
        return;
      }
      const note = res as Note;
      setNoteMeta(note);
      if (!note.encrypted) {
        setBlocks(hydrateBlocks(note));
        setAttachments((note.attachments || []) as Attachment[]);
      }
      setStatus(cloudEnabled ? "Saved · local + syncing…" : "Saved · local");
      if (cloudEnabled) {
        mirrorNoteIfCloud(slug)
          .then(() => setStatus("Saved · local + cloud"))
          .catch(() => setStatus("Saved · local (cloud sync failed)"));
      }
    } catch (e) {
      Alert.alert("Save failed", String(e));
      setStatus(String(e));
    } finally {
      setSaving(false);
    }
  }, [locked, wantEncrypt, passphrase, slug, router, cloudEnabled]);

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(), 900);
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
          <Text style={styles.warn}>Sealed note. Set the correct passphrase on Home.</Text>
        ) : (
          <>
            <View style={styles.encryptRow}>
              <Text style={styles.encryptLbl}>Encrypt on save</Text>
              <Switch value={wantEncrypt} onValueChange={setWantEncrypt} />
            </View>
            <Outliner
              blocks={blocks}
              onChange={setBlocks}
              editable
              honorCollapse
              onDirty={scheduleSave}
            />
            <LocalAttachmentList
              slug={slug}
              attachments={attachments}
              onChange={(atts) => {
                setAttachments(atts);
                scheduleSave();
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
  encryptRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
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
