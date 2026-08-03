import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { useSession } from "@/src/context/SessionContext";
import type { Attachment, Block, Note } from "@/src/api/types";
import { hydrateBlocks } from "@/src/api/client";
import { Outliner } from "@/src/components/Outliner";
import { LocalAttachmentList } from "@/src/components/LocalAttachmentList";
import { decryptPayload, encryptPayload } from "@/src/lib/crypto";
import * as Local from "@/src/lib/localPack";
import { blocksEqual } from "@/src/lib/blocksEqual";
import { mirrorNoteIfCloud } from "@/src/lib/cloudSync";
import { displayScope, resolveLocal } from "@/src/lib/resolveLocal";
import { cloudReadUrl } from "@/src/lib/shareUrl";
import { hapticError, hapticLight, hapticSelect } from "@/src/lib/haptics";
import { color, radius, space, tap, type, ui } from "@/src/theme";

/** Natural-language title: "Hebrews 7:1" not "heb.7.1" or raw query text. */
function titleForSlug(slug: string, note: Note | null): string {
  if (note?.scope) {
    return displayScope(note.scope);
  }
  const r = resolveLocal(slug);
  if (r.ok && r.scope) return displayScope(r.scope);
  const r2 = resolveLocal(slug.replace(/-/g, " "));
  if (r2.ok && r2.scope) return displayScope(r2.scope);
  return slug;
}

/**
 * Critique → improve (operate):
 * - Text-only "Open in reader" / tool labels → icon chrome in the header & toolbar
 * - Dead space under note tools → tight icon row, less section padding
 * - Editor stays the hero; secondary actions recede into icons
 */
export default function NoteScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = decodeURIComponent(String(raw || ""));
  const { passphrase, hasPassphrase, cloudEnabled, cloudHost, cloudDoor } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const [busy, setBusy] = useState(true);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [wantEncrypt, setWantEncrypt] = useState(false);
  const [locked, setLocked] = useState(false);
  const [noteMeta, setNoteMeta] = useState<Note | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const blocksRef = useRef(blocks);
  const attsRef = useRef(attachments);
  /** Bumps on each save start — drop stale completions so late I/O never clobber UI. */
  const saveGen = useRef(0);
  blocksRef.current = blocks;
  attsRef.current = attachments;

  const pageTitle = useMemo(() => titleForSlug(slug, noteMeta), [slug, noteMeta]);

  const applyNote = useCallback(
    async (note: Note | null, opts?: { showBusy?: boolean }) => {
      if (opts?.showBusy) setBusy(true);
      try {
        if (!note) {
          setBlocks(Local.emptyBlocks());
          setAttachments([]);
          setLocked(false);
          setWantEncrypt(cloudEnabled && hasPassphrase);
          setNoteMeta(null);
          return;
        }
        setNoteMeta(note);
        if (note.encrypted && note.cipher) {
          if (!passphrase) {
            setLocked(true);
            setBlocks([]);
            setAttachments([]);
          } else {
            try {
              const plain = await decryptPayload(note.cipher, passphrase);
              const nextBlocks = plain.blocks.length ? plain.blocks : Local.emptyBlocks();
              if (!blocksEqual(nextBlocks, blocksRef.current)) setBlocks(nextBlocks);
              setAttachments(plain.attachments || []);
              setLocked(false);
              setWantEncrypt(true);
            } catch {
              setLocked(true);
            }
          }
        } else {
          setLocked(false);
          setWantEncrypt(cloudEnabled && hasPassphrase);
          const nextBlocks = hydrateBlocks(note);
          if (!blocksEqual(nextBlocks, blocksRef.current)) setBlocks(nextBlocks);
          setAttachments((note.attachments || []) as Attachment[]);
        }
      } finally {
        if (opts?.showBusy) setBusy(false);
      }
    },
    [passphrase, hasPassphrase, cloudEnabled]
  );

  const load = useCallback(async () => {
    if (!slug) return;
    setBusy(true);
    try {
      const note = await Local.getNote(slug);
      await applyNote(note, { showBusy: false });
    } catch (e) {
      Alert.alert("Couldn’t open note", String(e));
    } finally {
      setBusy(false);
    }
  }, [slug, applyNote]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-load when returning from reader if the pack moved under us
  useFocusEffect(
    useCallback(() => {
      if (dirtyRef.current || timer.current) return;
      void Local.getNote(slug).then((n) => applyNote(n));
    }, [slug, applyNote])
  );

  // Live: reader tray / cloud pull while full note is open
  useEffect(() => {
    return Local.subscribeNoteChanges((ch) => {
      if (ch.slug !== slug) return;
      if (dirtyRef.current || timer.current) return;
      if (ch.deleted) {
        void applyNote(null);
        return;
      }
      void applyNote(ch.note);
    });
  }, [slug, applyNote]);

  /**
   * Persist current editor state. Quiet autosave — no saved/saving chrome.
   * Editor blocks/attachments stay the source of truth after write.
   */
  const save = useCallback(async () => {
    if (locked) return;
    const gen = ++saveGen.current;
    try {
      const b = blocksRef.current;
      const a = attsRef.current;
      let res: Note | { deleted: true; slug: string };
      if (wantEncrypt) {
        if (!cloudEnabled) {
          hapticError();
          Alert.alert(
            "Sync off",
            "Encryption needs sync. Turn on sync in Settings, or save without encrypting."
          );
          return;
        }
        if (!passphrase) {
          hapticError();
          Alert.alert(
            "Passphrase required",
            "Set a passphrase under Settings → Advanced first."
          );
          return;
        }
        const cipher = await encryptPayload({ blocks: b, attachments: a }, passphrase);
        if (gen !== saveGen.current) return;
        res = await Local.putNote(slug, { encrypted: true, cipher });
      } else {
        res = await Local.putNote(slug, { blocks: b, attachments: a });
      }
      if (gen !== saveGen.current) return;

      dirtyRef.current = false;

      if ("deleted" in res && res.deleted) {
        if (cloudEnabled) mirrorNoteIfCloud(slug).catch(() => {});
        router.back();
        return;
      }

      const note = res as Note;
      setNoteMeta((prev) =>
        prev
          ? {
              ...prev,
              updated_at: note.updated_at,
              encrypted: note.encrypted,
              cipher: note.cipher,
              id: note.id,
            }
          : note
      );

      if (cloudEnabled) {
        mirrorNoteIfCloud(slug).catch(() => {});
      }
    } catch (e) {
      if (gen !== saveGen.current) return;
      hapticError();
      Alert.alert("Save failed", String(e));
    }
  }, [locked, wantEncrypt, passphrase, slug, router, cloudEnabled]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    // Debounced local write; UI already updated optimistically via setBlocks.
    timer.current = setTimeout(() => {
      timer.current = null;
      void saveRef.current();
    }, 650);
  }, []);

  // Flush pending autosave on unmount so navigations don't drop last keystrokes.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void saveRef.current();
      }
    };
  }, []);

  const openReader = useCallback(() => {
    hapticLight();
    const m = /^([a-z0-9]+)\.(\d+)/i.exec(slug);
    const chapter = m ? `${m[1].toLowerCase()}.${m[2]}` : slug;
    router.push(`/read/${encodeURIComponent(chapter)}`);
  }, [slug, router]);

  const sharePassage = useCallback(async () => {
    hapticSelect();
    if (!cloudEnabled || !cloudDoor) {
      Alert.alert(
        "Sync required",
        "Turn on sync in Share to get a cloud link for this passage."
      );
      return;
    }
    const url = cloudReadUrl(cloudHost, cloudDoor, slug);
    try {
      await Share.share(
        Platform.OS === "ios"
          ? { url, message: pageTitle }
          : { message: `${pageTitle}\n${url}`, title: pageTitle }
      );
    } catch {
      /* user cancelled */
    }
  }, [cloudEnabled, cloudDoor, cloudHost, slug, pageTitle]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: pageTitle.length > 24 ? pageTitle.slice(0, 24) + "…" : pageTitle,
      headerTitleAlign: "center",
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            onPress={sharePassage}
            style={styles.headerIconBtn}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Share passage link"
          >
            <SymbolView
              name="square.and.arrow.up"
              size={20}
              weight="semibold"
              tintColor={color.ink}
              fallback={<Text style={styles.headerIconFallback}>{"\u2197"}</Text>}
            />
          </Pressable>
          <Pressable
            onPress={openReader}
            style={styles.headerIconBtn}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Open in reader"
          >
            <SymbolView
              name="book"
              size={20}
              weight="semibold"
              tintColor={color.ink}
              fallback={<Text style={styles.headerIconFallback}>{"\u{1F4D6}"}</Text>}
            />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, pageTitle, openReader, sharePassage]);

  if (busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.muted} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={ui.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.mast}>
          <Text style={styles.refTitle} accessibilityRole="header">
            {pageTitle}
          </Text>
        </View>

        {locked ? (
          <View style={styles.warn}>
            <Text style={styles.warnTxt}>
              Sealed note. Set the correct passphrase under Settings → Advanced.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.editorCard}>
              <Outliner
                blocks={blocks}
                onChange={setBlocks}
                editable
                onDirty={scheduleSave}
              />
            </View>

            <View style={styles.section}>
              <LocalAttachmentList
                slug={slug}
                attachments={attachments}
                onChange={(atts) => {
                  setAttachments(atts);
                  scheduleSave();
                }}
              />
            </View>

            {cloudEnabled ? (
              <View style={styles.encryptRow}>
                <View style={styles.encryptCopy}>
                  <Text style={type.bodyStrong}>Encrypt for cloud</Text>
                  <Text style={type.caption}>
                    Host stores ciphertext only. Passphrase never leaves this device.
                  </Text>
                </View>
                <Switch
                  value={wantEncrypt}
                  onValueChange={(v) => {
                    hapticSelect();
                    setWantEncrypt(v);
                  }}
                  disabled={!hasPassphrase}
                />
              </View>
            ) : null}
            {cloudEnabled && !hasPassphrase ? (
              <Text style={styles.hint}>Set a passphrase in Settings to enable encryption.</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.paper,
  },
  body: {
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[6],
    backgroundColor: color.paper,
    gap: space[3],
  },
  mast: {
    gap: 2,
  },
  refTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    color: color.ink,
    letterSpacing: -0.3,
  },
  editorCard: {
    backgroundColor: color.paperRaised,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineSoft,
    paddingHorizontal: space[3],
    paddingTop: space[3],
    paddingBottom: space[2],
  },
  section: {
    gap: space[1],
  },
  encryptRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: tap,
    backgroundColor: color.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineSoft,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    gap: space[3],
  },
  encryptCopy: {
    flex: 1,
    paddingRight: space[2],
    gap: 2,
  },
  hint: {
    ...type.caption,
    paddingHorizontal: space[1],
  },
  warn: {
    backgroundColor: color.warnSoft,
    padding: space[3],
    borderRadius: radius.md,
  },
  warnTxt: {
    color: color.warnInk,
    fontSize: 14,
    lineHeight: 20,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconFallback: {
    fontSize: 17,
    fontWeight: "700",
    color: color.ink,
  },
});
