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
  Text,
  View,
} from "react-native";
import { useSession } from "@/src/context/SessionContext";
import type { Attachment, Block, Note } from "@/src/api/types";
import { hydrateBlocks } from "@/src/api/client";
import { Outliner } from "@/src/components/Outliner";
import { LocalAttachmentList } from "@/src/components/LocalAttachmentList";
import { HeaderIconButton } from "@/src/components/HeaderIconButton";
import { IconShare } from "@/src/components/HeaderIcons";
import { decryptPayload, encryptPayload } from "@/src/lib/crypto";
import * as Local from "@/src/lib/localPack";
import { blocksEqual } from "@/src/lib/blocksEqual";
import { mirrorNoteIfCloud } from "@/src/lib/cloudSync";
import { displayScope, resolveLocal } from "@/src/lib/resolveLocal";
import { passageShareUrls } from "@/src/lib/shareUrl";
import { hapticError, hapticLight, hapticSelect } from "@/src/lib/haptics";
import { useTheme } from "@/src/context/ThemeContext";
import { pushOnce } from "@/src/lib/nav";
import { radius, space, tap, type ThemeColors } from "@/src/theme";

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
  const { color, ui, type } = useTheme();
  const styles = useMemo(() => makeNoteStyles(color), [color]);
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = decodeURIComponent(String(raw || ""));
  const { passphrase, hasPassphrase, cloudEnabled, cloudHost, cloudDoor } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  // Cache-first: paint from memory so reader → full note never blanks
  const seedNote = Local.peekNote(slug);
  const [busy, setBusy] = useState(() => seedNote == null);
  const [blocks, setBlocks] = useState<Block[]>(() =>
    seedNote && !seedNote.encrypted ? hydrateBlocks(seedNote) : []
  );
  const [attachments, setAttachments] = useState<Attachment[]>(
    () =>
      (seedNote && !seedNote.encrypted
        ? ((seedNote.attachments || []) as Attachment[])
        : [])
  );
  const [wantEncrypt, setWantEncrypt] = useState(
    () => !!(seedNote?.encrypted || (cloudEnabled && hasPassphrase))
  );
  const [locked, setLocked] = useState(
    () => !!(seedNote?.encrypted && seedNote.cipher && !passphrase)
  );
  const [noteMeta, setNoteMeta] = useState<Note | null>(() => seedNote);
  /** Last applied stamp — skip rehydrate when focus/getNote returns same note. */
  const appliedStampRef = useRef(
    seedNote ? `${seedNote.scope?.slug || slug}:${seedNote.updated_at || ""}` : ""
  );
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
    // Optimistic: apply memory hit immediately; only spin when cold
    const peeked = Local.peekNote(slug);
    if (peeked) {
      const stamp = `${peeked.scope?.slug || slug}:${peeked.updated_at || ""}`;
      if (stamp !== appliedStampRef.current) {
        appliedStampRef.current = stamp;
        await applyNote(peeked, { showBusy: false });
      }
      setBusy(false);
    } else {
      setBusy(true);
    }
    try {
      const note = await Local.getNote(slug);
      const stamp = note
        ? `${note.scope?.slug || slug}:${note.updated_at || ""}`
        : `${slug}:`;
      // Skip UI rewrite if getNote returned the same stamp we already painted
      if (stamp === appliedStampRef.current) return;
      appliedStampRef.current = stamp;
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
      void Local.getNote(slug).then((n) => {
        const stamp = n
          ? `${n.scope?.slug || slug}:${n.updated_at || ""}`
          : `${slug}:`;
        if (stamp === appliedStampRef.current) return;
        appliedStampRef.current = stamp;
        void applyNote(n);
      });
    }, [slug, applyNote])
  );

  // Live: reader tray / cloud pull while full note is open
  useEffect(() => {
    return Local.subscribeNoteChanges((ch) => {
      if (ch.slug !== slug) return;
      if (dirtyRef.current || timer.current) return;
      if (ch.deleted) {
        appliedStampRef.current = `${slug}:`;
        void applyNote(null);
        return;
      }
      const stamp = `${ch.note.scope?.slug || slug}:${ch.note.updated_at || ""}`;
      if (stamp === appliedStampRef.current) return;
      appliedStampRef.current = stamp;
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
      appliedStampRef.current = `${note.scope?.slug || slug}:${note.updated_at || ""}`;
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
    pushOnce(router, `/read/${encodeURIComponent(chapter)}`);
  }, [slug, router]);

  const sharePassage = useCallback(async () => {
    hapticSelect();
    // Default share target = projected reader (ADR 0019). App scheme works offline;
    // cloud https included when sync is on.
    const { primary, web, app } = passageShareUrls({
      slug,
      cloudEnabled,
      cloudHost,
      cloudDoor,
    });
    const message = web
      ? `${pageTitle}\n${web}`
      : `${pageTitle}\n${app}`;
    try {
      await Share.share(
        Platform.OS === "ios"
          ? { url: primary, message: pageTitle }
          : { message, title: pageTitle }
      );
    } catch {
      /* user cancelled */
    }
  }, [cloudEnabled, cloudDoor, cloudHost, slug, pageTitle]);

  useLayoutEffect(() => {
    const displayTitle =
      pageTitle.length > 24 ? pageTitle.slice(0, 24) + "…" : pageTitle;
    navigation.setOptions({
      headerTitle: () => (
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
          {displayTitle}
        </Text>
      ),
      headerTitleAlign: "center",
      headerRight: () => (
        <View style={styles.headerActions}>
          <HeaderIconButton
            accessibilityLabel="Share passage link"
            onPress={sharePassage}
            icon={(c) => <IconShare color={c} size={22} />}
            fallback={"\u2197"}
          />
          <HeaderIconButton
            symbol="book"
            accessibilityLabel="Open in reader"
            onPress={openReader}
            fallback={"\u{1F4D6}"}
          />
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
              <View
                style={styles.sealCard}
                accessibilityRole="summary"
                accessibilityLabel={
                  wantEncrypt
                    ? "Note sealed for cloud. Host stores ciphertext only."
                    : "Note is plain on the host. Anyone with your door can read it."
                }
              >
                <View style={styles.sealCopy}>
                  <Text style={type.bodyStrong}>
                    {wantEncrypt ? "Sealed for cloud" : "Plain on host"}
                  </Text>
                  <Text style={type.caption}>
                    {wantEncrypt
                      ? "Host stores ciphertext only. Passphrase stays on this device."
                      : "Anyone with your door can read this note on the host."}
                  </Text>
                </View>
                {!hasPassphrase ? (
                  <Pressable
                    style={ui.ghostBtnSm}
                    onPress={() => {
                      hapticLight();
                      pushOnce(router, "/settings");
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Set passphrase in Settings"
                  >
                    <Text style={ui.ghostBtnSmTxt}>Set passphrase</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={ui.ghostBtnSm}
                    onPress={() => {
                      hapticSelect();
                      const next = !wantEncrypt;
                      setWantEncrypt(next);
                      // Seal preference is part of the note write — persist now,
                      // not only after the next keystroke.
                      dirtyRef.current = true;
                      if (timer.current) clearTimeout(timer.current);
                      timer.current = setTimeout(() => {
                        timer.current = null;
                        void saveRef.current();
                      }, 200);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={
                      wantEncrypt ? "Unseal note for cloud" : "Seal note for cloud"
                    }
                    accessibilityHint={
                      wantEncrypt
                        ? "Saves this note as plain text on the host"
                        : "Encrypts this note so the host only sees ciphertext"
                    }
                  >
                    <Text style={ui.ghostBtnSmTxt}>
                      {wantEncrypt ? "Unseal" : "Seal"}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeNoteStyles(color: ThemeColors) {
  return StyleSheet.create({
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
  /** Cloud seal status + explicit Seal / Unseal action (not a Switch). */
  sealCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: tap,
    backgroundColor: color.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineSoft,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    gap: space[3],
  },
  sealCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
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
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.35,
    lineHeight: 22,
    color: color.ink,
    maxWidth: 200,
    textAlign: "center",
    marginTop: -1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    height: 40,
    gap: 0,
  },
});
}
