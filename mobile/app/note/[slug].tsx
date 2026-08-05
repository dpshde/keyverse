import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  type KeyboardEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSession } from "@/src/context/SessionContext";
import type { Attachment, Block, Note } from "@/src/api/types";
import { hydrateBlocks } from "@/src/api/client";
import { Outliner } from "@/src/components/Outliner";
import { PassageStrip } from "@/src/components/PassageStrip";
import { LocalAttachmentList } from "@/src/components/LocalAttachmentList";
import { HeaderContentFade } from "@/src/components/HeaderScrim";
import { HeaderIconButton } from "@/src/components/HeaderIconButton";
import { IconShare } from "@/src/components/HeaderIcons";
import { decryptPayload, encryptPayload } from "@/src/lib/crypto";
import * as Local from "@/src/lib/localPack";
import { blocksEqual } from "@/src/lib/blocksEqual";
import { mirrorNoteIfCloud } from "@/src/lib/cloudSync";
import { displayScope, resolveLocal } from "@/src/lib/resolveLocal";
import { passageShareUrls } from "@/src/lib/shareUrl";
import { hapticError, hapticLight, hapticSelect } from "@/src/lib/haptics";
import { keyboardMotionMs } from "@/src/lib/motion";
import { useTheme } from "@/src/context/ThemeContext";
import { pushOnce } from "@/src/lib/nav";
import { radius, space, tapComfy, type ThemeColors } from "@/src/theme";

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
 * Full note editor — operate mode.
 * Hierarchy: nav ref → scripture strip → outline (hero) → quiet tools/meta.
 * No second title mast (header already names the passage).
 */
export default function NoteScreen() {
  const { color, ui } = useTheme();
  const styles = useMemo(() => makeNoteStyles(color), [color]);
  const insets = useSafeAreaInsets();
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = decodeURIComponent(String(raw || ""));
  const { passphrase, hasPassphrase, cloudEnabled, cloudHost, cloudDoor } = useSession();
  const router = useRouter();
  const navigation = useNavigation();

  /**
   * Keyboard lift — Reanimated bottom pad so the flex outliner compresses/expands
   * with the system keyboard (not KeyboardAvoidingView’s abrupt jump).
   * restPad stays on the home indicator; kbLift is keyboard height above it.
   */
  // Tight above home indicator — attach/globe sit close to the bottom.
  const restPad = Math.max(insets.bottom, space[2]) + space[1];
  const kbLift = useSharedValue(0);
  const bodyKbStyle = useAnimatedStyle(() => ({
    paddingBottom: restPad + kbLift.value,
  }));

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const run = (kb: number, e?: KeyboardEvent) => {
      const sysMs =
        Platform.OS === "ios" && e?.duration != null && e.duration > 0 ? e.duration : null;
      const duration = keyboardMotionMs(sysMs, kb > 0);
      // Keyboard frame is from screen bottom; restPad already covers home indicator.
      const lift = kb > 0 ? Math.max(0, kb - insets.bottom) : 0;
      kbLift.value = withTiming(lift, {
        duration,
        easing: kb > 0 ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      });
    };

    const onShow = (e: KeyboardEvent) => run(e.endCoordinates?.height ?? 0, e);
    const onHide = (e: KeyboardEvent) => run(0, e);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [insets.bottom, kbLift]);
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
  /** Deleted elsewhere (home / tray / empty) — block autosave resurrection. */
  const deletedRef = useRef(false);
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
      if (ch.deleted) {
        // Honor deletes even mid-type — pending autosave must not resurrect
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        dirtyRef.current = false;
        deletedRef.current = true;
        saveGen.current += 1;
        appliedStampRef.current = `${slug}:`;
        void applyNote(null);
        return;
      }
      if (dirtyRef.current || timer.current) return;
      deletedRef.current = false;
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
    if (locked || deletedRef.current) return;
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
            "Set a passphrase under Settings → Sealed notes first."
          );
          return;
        }
        const cipher = await encryptPayload({ blocks: b, attachments: a }, passphrase);
        if (gen !== saveGen.current || deletedRef.current) return;
        res = await Local.putNote(slug, { encrypted: true, cipher });
      } else {
        res = await Local.putNote(slug, { blocks: b, attachments: a });
      }
      if (gen !== saveGen.current || deletedRef.current) return;

      dirtyRef.current = false;

      if ("deleted" in res && res.deleted) {
        deletedRef.current = true;
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
    // User edit after a delete is an intentional recreate
    deletedRef.current = false;
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
      if (deletedRef.current) {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        return;
      }
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
  }, [navigation, pageTitle, openReader, sharePassage, styles]);

  const toggleSeal = useCallback(() => {
    if (!hasPassphrase) {
      hapticLight();
      pushOnce(router, "/settings");
      return;
    }
    hapticSelect();
    const next = !wantEncrypt;
    setWantEncrypt(next);
    dirtyRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void saveRef.current();
    }, 200);
  }, [hasPassphrase, wantEncrypt, router]);

  if (busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.muted} />
      </View>
    );
  }

  /**
   * Privacy control (sync only): lock = private/sealed, globe = public on the door.
   * Icon is the affordance; a11y carries the full sentence.
   */
  const privacySealed = wantEncrypt;
  const privacySymbol = privacySealed ? "lock.fill" : "globe";
  const privacyA11y = !hasPassphrase
    ? "Public on your door. Set a passphrase in Settings → Sealed notes to lock notes private."
    : privacySealed
      ? "Private. Host stores ciphertext only. Double tap for public on your door."
      : "Public on your door. Anyone with your sync key can read this. Double tap to lock private.";

  return (
    <View style={ui.screen}>
      <HeaderContentFade />
      {/* Non-interactive taps (verse, paper, labels) dismiss keyboard; controls keep focus. */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <Animated.View style={[styles.body, bodyKbStyle]}>
          {/* Scripture first — ref lives in the nav title; strip is the reading layer */}
          <PassageStrip slug={slug} label={pageTitle} />

          {locked ? (
            <View style={styles.warn}>
              <Text style={styles.warnTxt}>
                Private note. Set the correct passphrase under Settings → Sealed notes.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.noteLabel} accessibilityRole="header">
                Note
              </Text>
              {/* Capture surface — flex shrinks/grows as kbLift animates body padding */}
              <View style={styles.editorCard}>
                <Outliner
                  fill
                  blocks={blocks}
                  onChange={setBlocks}
                  editable
                  onDirty={scheduleSave}
                />
              </View>

              <View style={styles.footer}>
                <View style={styles.footerMain}>
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
                  <Pressable
                    onPress={toggleSeal}
                    style={({ pressed }) => [
                      styles.privacyBtn,
                      privacySealed && styles.privacyBtnOn,
                      pressed && styles.privacyBtnPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: privacySealed }}
                    accessibilityLabel={privacyA11y}
                    hitSlop={8}
                  >
                    <SymbolView
                      name={privacySymbol as "lock.fill" | "globe"}
                      size={22}
                      weight={privacySealed ? "semibold" : "medium"}
                      tintColor={privacySealed ? color.inkSoft : color.muted}
                      fallback={
                        <Text
                          style={[
                            styles.privacyFallback,
                            { color: privacySealed ? color.inkSoft : color.muted },
                          ]}
                        >
                          {privacySealed ? "\u{1F512}" : "\u{1F310}"}
                        </Text>
                      }
                    />
                  </Pressable>
                ) : null}
              </View>
            </>
          )}
        </Animated.View>
      </TouchableWithoutFeedback>
    </View>
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
      flex: 1,
      paddingHorizontal: space[4],
      paddingTop: space[2],
      backgroundColor: color.paper,
      gap: space[2],
    },
    /** Quiet rail between scripture (primary) and capture (secondary). */
    noteLabel: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: color.muted,
      marginTop: 0,
      marginBottom: 2,
    },
    /**
     * Capture surface under scripture — claims leftover Y.
     * Soft fill (not pure white slab) so empty space still reads as paper hierarchy.
     */
    editorCard: {
      flex: 1,
      minHeight: 160,
      alignSelf: "stretch",
      width: "100%",
      backgroundColor: color.paperRaised,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.line,
      // No horizontal pad — Outliner pads lines; toolbar bleeds full card width
      paddingHorizontal: 0,
      paddingTop: space[2],
      paddingBottom: 0,
      overflow: "hidden",
      // Slight lift so the note field is clearly “on” the paper field
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    /** Attach (left) + privacy icon (right) — tight above home indicator. */
    footer: {
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      paddingTop: space[1],
      minHeight: tapComfy,
    },
    footerMain: {
      flex: 1,
      minWidth: 0,
      justifyContent: "center",
    },
    /**
     * Privacy toggle: lock.fill = private, globe = public on the door.
     * No status copy — icon carries state; VoiceOver gets the full sentence.
     */
    privacyBtn: {
      width: tapComfy,
      height: tapComfy,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
    },
    privacyBtnOn: {
      backgroundColor: color.fillStrong,
    },
    privacyBtnPressed: {
      opacity: 0.55,
    },
    privacyFallback: {
      fontSize: 20,
      lineHeight: 24,
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
      fontSize: 16,
      fontWeight: "700",
      letterSpacing: -0.3,
      lineHeight: 20,
      color: color.ink,
      maxWidth: 180,
      textAlign: "center",
      marginTop: 0,
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      height: 36,
      gap: 0,
    },
  });
}
