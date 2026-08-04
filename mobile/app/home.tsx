import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSession } from "@/src/context/SessionContext";
import type { Note, SuggestItem } from "@/src/api/types";
import { InlineMarkdown } from "@/src/lib/inlineMarkdown";
import { buildNoteTree, type TreeFolder, type TreeLeaf, type TreeNode } from "@/src/lib/noteTree";
import * as Local from "@/src/lib/localPack";
import { resolveLocal, suggestLocal } from "@/src/lib/resolveLocal";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SymbolView } from "expo-symbols";
import { NoteSwipeRow } from "@/src/components/NoteSwipeRow";
import { PassageSelector, passageSelectorListPad } from "@/src/components/PassageSelector";
import { EnterSyncKey } from "@/src/components/EnterSyncKey";
import { SyncInviteBanner } from "@/src/components/SyncInviteBanner";
import { SyncKeyReveal } from "@/src/components/SyncKeyReveal";
import {
  completeSyncInvite,
  deferSyncInvite,
  getSyncInviteState,
  plainSyncError,
  type SyncInviteState,
} from "@/src/lib/syncInvite";
import { hapticError, hapticLight, hapticSelect, hapticSuccess, hapticWarning } from "@/src/lib/haptics";
import { CountPill } from "@/src/components/CountPill";
import { useTheme } from "@/src/context/ThemeContext";
import { pushOnce, releasePushLock } from "@/src/lib/nav";
import { fontRead, radius, space, tap, type ThemeColors } from "@/src/theme";

const DEFAULT_HOST = "https://keyverse-production.up.railway.app";

/**
 * Critique → improve (operate mode):
 * - Machine OSIS (`1SA.15.15`) → natural refs (`1 Samuel 15:15`)
 * - Folder labels match people language (books & chapters)
 * - Cards lead with the note body; kind chrome demoted/removed
 * - Hierarchy: book (strong) → chapter (quiet) → note (content card)
 * - Full-note affordance is a soft trailing control, not a heavy rail
 */
export default function HomeScreen() {
  const { cloudEnabled, cloudHost, translation, enableCloud } = useSession();
  const { color, ui, type } = useTheme();
  const styles = useMemo(() => makeHomeStyles(color), [color]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [kbHeight, setKbHeight] = useState(0);
  const [invite, setInvite] = useState<SyncInviteState>("pending");
  const [syncBusy, setSyncBusy] = useState(false);
  const [enterOpen, setEnterOpen] = useState(false);
  const [revealDoor, setRevealDoor] = useState<string | null>(null);

  const foldKey = "kv.fold.local";
  const onKeyboardHeightChange = useCallback((h: number) => setKbHeight(h), []);

  const notesEpochRef = useRef(Local.getNotesCacheEpoch());
  /** Only one iMessage-style swipe row open at a time. */
  const openSwipeRef = useRef<SwipeableMethods | null>(null);

  const closeOpenSwipe = useCallback(() => {
    openSwipeRef.current?.close();
    openSwipeRef.current = null;
  }, []);

  const onSwipeWillOpen = useCallback((methods: SwipeableMethods) => {
    if (openSwipeRef.current && openSwipeRef.current !== methods) {
      openSwipeRef.current.close();
    }
    openSwipeRef.current = methods;
  }, []);

  const deleteNote = useCallback(
    (leaf: TreeLeaf) => {
      hapticWarning();
      Alert.alert(
        "Delete note?",
        `Remove “${leaf.label}” from this device. This cannot be undone here.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                closeOpenSwipe();
                await Local.deleteNote(leaf.slug);
                notesEpochRef.current = Local.getNotesCacheEpoch();
                setNotes((prev) => prev.filter((n) => n.scope?.slug !== leaf.slug));
                hapticSuccess();
              } catch (e) {
                hapticError();
                Alert.alert("Delete failed", String(e));
              }
            },
          },
        ]
      );
    },
    [closeOpenSwipe]
  );

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = !!opts?.quiet;
    if (!quiet) {
      setBusy(true);
      setErr(null);
    }
    try {
      const [list, foldRaw, inv] = await Promise.all([
        Local.listNotes(), // memory-cached after first disk read
        AsyncStorage.getItem(foldKey),
        getSyncInviteState(),
      ]);
      setNotes(list);
      setInvite(inv);
      notesEpochRef.current = Local.getNotesCacheEpoch();
      if (foldRaw) setCollapsed(JSON.parse(foldRaw) || {});
    } catch (e) {
      if (!quiet) setErr(String(e));
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh list only when notes actually changed elsewhere (note editor / sync / import)
  useFocusEffect(
    useCallback(() => {
      // Allow opening Settings/Share again immediately after dismissing a sheet
      releasePushLock();
      const ep = Local.getNotesCacheEpoch();
      if (ep !== notesEpochRef.current) {
        load({ quiet: true });
      } else {
        // Re-read invite / cloud chrome when returning from Sync home
        getSyncInviteState().then(setInvite).catch(() => {});
      }
    }, [load])
  );

  const showInviteBanner =
    !cloudEnabled && invite === "pending" && notes.length >= 1 && !syncBusy;

  const onTurnOnFromBanner = async () => {
    setSyncBusy(true);
    setErr(null);
    try {
      const res = await enableCloud(cloudHost || DEFAULT_HOST);
      await completeSyncInvite();
      setInvite("done");
      hapticSuccess();
      if (res.mode === "claim") setRevealDoor(res.door);
      load({ quiet: true });
    } catch (e) {
      hapticError();
      setErr(plainSyncError(e, "turn_on"));
    } finally {
      setSyncBusy(false);
    }
  };

  const onEnterFromBanner = () => setEnterOpen(true);

  const onDismissInvite = async () => {
    await deferSyncInvite();
    setInvite("deferred");
  };

  const onEnterSubmit = async (door: string) => {
    const res = await enableCloud(cloudHost || DEFAULT_HOST, door);
    await completeSyncInvite();
    setInvite("done");
    setEnterOpen(false);
    if (res.mode === "claim") setRevealDoor(res.door);
    load({ quiet: true });
  };

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

  const toggle = useCallback(async (id: string) => {
    hapticSelect();
    setCollapsed((prev) => {
      const map2 = { ...prev };
      if (map2[id]) delete map2[id];
      else map2[id] = true;
      AsyncStorage.setItem(foldKey, JSON.stringify(map2)).catch(() => {});
      return map2;
    });
  }, []);

  const openPassage = async (query?: string) => {
    const qq = (query ?? q).trim();
    if (!qq) return;
    const r = resolveLocal(qq);
    if (!r.ok || !r.scope) {
      setErr(r.error || "invalid passage");
      return;
    }
    hapticLight();
    setSuggestions([]);
    setQ("");
    setErr(null);
    pushOnce(router, `/read/${encodeURIComponent(r.scope.slug)}`);
  };

  const dockPad = passageSelectorListPad(suggestions.length, insets.bottom, kbHeight);
  const listContentStyle = useMemo(
    () => ({
      paddingHorizontal: space[4],
      paddingTop: space[3],
      paddingBottom: dockPad,
    }),
    [dockPad]
  );
  const homeKeyExtractor = useCallback((item: { key: string }) => item.key, []);

  return (
    <View style={ui.screen}>
      <View style={[styles.top, { paddingTop: Math.max(insets.top, space[2]) }]}>
        <View style={styles.topRow}>
          <View style={styles.topMeta}>
            <Text style={styles.brand} numberOfLines={1}>
              keyverse
            </Text>
            {cloudEnabled ? (
              <Pressable
                onPress={() => {
                  hapticSelect();
                  pushOnce(router, "/share");
                }}
                accessibilityRole="button"
                accessibilityLabel="Sync on, open sync"
                hitSlop={6}
              >
                <Text style={styles.status}>Sync on</Text>
              </Pressable>
            ) : (
              <Text style={styles.status}>On this device</Text>
            )}
            <Text style={styles.metaLine}>
              {translation} · {notes.length} {notes.length === 1 ? "note" : "notes"}
            </Text>
          </View>
          <View style={styles.topActions}>
            <Pressable
              onPress={() => {
                hapticSelect();
                pushOnce(router, "/activity");
              }}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Activity"
              hitSlop={8}
            >
              <SymbolView
                name="chart.bar"
                size={22}
                weight="semibold"
                tintColor={color.ink}
                fallback={<Text style={styles.gearFallback}>{"\u2593"}</Text>}
              />
            </Pressable>
            <Pressable
              onPress={() => {
                hapticSelect();
                pushOnce(router, "/settings");
              }}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={8}
            >
              <SymbolView
                name="gearshape"
                size={22}
                weight="semibold"
                tintColor={color.ink}
                fallback={<Text style={styles.gearFallback}>{"\u2699"}</Text>}
              />
            </Pressable>
          </View>
        </View>
        {err ? <Text style={ui.err}>{err}</Text> : null}
        {syncBusy ? (
          <View style={styles.syncBusyRow}>
            <ActivityIndicator color={color.muted} />
            <Text style={type.meta}>Turning on sync…</Text>
          </View>
        ) : null}
      </View>

      {showInviteBanner ? (
        <SyncInviteBanner
          onTurnOn={onTurnOnFromBanner}
          onEnterKey={onEnterFromBanner}
          onDismiss={onDismissInvite}
        />
      ) : null}

      {busy && !notes.length ? (
        <ActivityIndicator style={{ marginTop: space[10] }} color={color.muted} />
      ) : (
        <FlatList
          data={flat}
          keyExtractor={homeKeyExtractor}
          refreshControl={
            <RefreshControl refreshing={busy} onRefresh={load} tintColor={color.muted} />
          }
          contentContainerStyle={listContentStyle}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={closeOpenSwipe}
          windowSize={10}
          maxToRenderPerBatch={10}
          initialNumToRender={16}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={Platform.OS === "android"}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Notes stay on this device. Open a passage below in {translation} and write under a
              verse.
            </Text>
          }
          renderItem={({ item }) => {
            if (item.kind === "folder") {
              const f = item.node as TreeFolder;
              const isCol = !!collapsed[f.id];
              const isBook = f.level === "book";
              const a11y = f.accessibilityLabel || f.label;
              const noteWord = f.noteCount === 1 ? "note" : "notes";
              /**
               * Same trailing CountPill for books and chapters:
               * - Collapsed → filled (packed)
               * - Expanded → ghost (open; children visible)
               * Title column only — no under-title “N notes” (that fought the pill).
               */
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.folder,
                    isBook ? styles.folderBook : styles.folderChapter,
                    { marginLeft: item.depth * space[3] },
                    !isBook && pressed && styles.folderChapterPressed,
                    isBook && !isCol && styles.folderBookOpen,
                  ]}
                  onPress={() => toggle(f.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !isCol }}
                  accessibilityLabel={`${a11y}, ${f.noteCount} ${noteWord}, ${
                    isCol ? "collapsed" : "expanded"
                  }`}
                  accessibilityHint={isCol ? "Expands section" : "Collapses section"}
                >
                  <Text
                    style={isBook ? styles.folderTitleBook : styles.folderTitleChapter}
                    numberOfLines={1}
                  >
                    {f.label}
                  </Text>
                  <CountPill
                    label={f.noteCount}
                    variant={isCol ? "filled" : "ghost"}
                  />
                </Pressable>
              );
            }

            const leaf = item.node as TreeLeaf;
            return (
              <NoteSwipeRow
                style={{ marginLeft: item.depth * space[3] }}
                label={leaf.label}
                onWillOpen={onSwipeWillOpen}
                onDelete={() => deleteNote(leaf)}
                onEdit={() => {
                  hapticLight();
                  pushOnce(router, `/note/${encodeURIComponent(leaf.slug)}`);
                }}
              >
                <Pressable
                  style={styles.card}
                  onPress={() => {
                    closeOpenSwipe();
                    hapticSelect();
                    pushOnce(router, `/read/${encodeURIComponent(leaf.slug)}`);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${leaf.label} in reader. Swipe left for options.`}
                  accessibilityHint="Swipe left for Note and Delete"
                >
                  <View style={styles.cardHead}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {leaf.label}
                    </Text>
                    {leaf.encrypted ? (
                      <Text style={styles.badge}>Sealed</Text>
                    ) : leaf.attCount > 0 ? (
                      <Text style={styles.badge}>
                        {leaf.attCount} file{leaf.attCount === 1 ? "" : "s"}
                      </Text>
                    ) : null}
                  </View>
                  {leaf.preview ? (
                    <InlineMarkdown text={leaf.preview} style={styles.cardBody} />
                  ) : leaf.encrypted ? (
                    <Text style={styles.cardBodyMuted}>Encrypted — open with passphrase</Text>
                  ) : (
                    <Text style={styles.cardBodyMuted}>Empty note</Text>
                  )}
                </Pressable>
              </NoteSwipeRow>
            );
          }}
        />
      )}

      <PassageSelector
        value={q}
        onChangeText={setQ}
        onSubmit={(query) => openPassage(query)}
        suggestions={suggestions}
        onKeyboardHeightChange={onKeyboardHeightChange}
      />

      <EnterSyncKey
        visible={enterOpen}
        onCancel={() => setEnterOpen(false)}
        onSubmit={onEnterSubmit}
      />
      <SyncKeyReveal
        visible={!!revealDoor}
        door={revealDoor || ""}
        onDone={() => setRevealDoor(null)}
      />
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

function makeHomeStyles(color: ThemeColors) {
  return StyleSheet.create({
    top: {
      paddingHorizontal: space[4],
      paddingBottom: space[3] + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.line,
      backgroundColor: color.paperRaised,
      gap: space[1],
      // Slight lift so the bar reads as chrome, not page wash
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: space[3],
      minHeight: 48,
    },
    topMeta: { flex: 1, minWidth: 0, gap: 2, paddingRight: space[3] },
    topActions: { flexDirection: "row", alignItems: "center" },
    brand: {
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: -0.5,
      color: color.ink,
    },
    iconBtn: {
      width: tap,
      height: tap,
      alignItems: "center",
      justifyContent: "center",
    },
    iconBtnPressed: {
      opacity: 0.45,
    },
    gearFallback: { fontSize: 20, color: color.ink, lineHeight: 22, fontWeight: "700" },
    status: {
      fontSize: 13,
      fontWeight: "600",
      color: color.inkSoft,
      letterSpacing: -0.1,
    },
    metaLine: {
      fontSize: 12,
      fontWeight: "500",
      color: color.faint,
      letterSpacing: -0.1,
    },
    syncBusyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      marginTop: space[2],
    },
    empty: {
      textAlign: "center",
      color: color.muted,
      marginTop: space[10],
      paddingHorizontal: space[6],
      lineHeight: 22,
      fontSize: 15,
    },

    folder: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[3],
      marginBottom: space[1],
      minHeight: 44,
      paddingRight: 2,
    },
    folderBook: {
      marginTop: space[3],
      marginBottom: space[2],
      paddingVertical: space[2],
      minHeight: 48,
    },
    /** Soft left rail when a book is open — structure without chevrons */
    folderBookOpen: {
      borderLeftWidth: 2,
      borderLeftColor: color.line,
      paddingLeft: space[2],
      marginLeft: 0,
    },
    /**
     * Chapter rows: large hit target, no fill — sits on paper like book labels.
     * Note cards carry the surface weight; chapter is structure, not a chip.
     */
    folderChapter: {
      minHeight: tap, // 44
      paddingVertical: space[2],
      paddingHorizontal: space[1],
      marginBottom: space[1],
      borderRadius: radius.sm,
      backgroundColor: "transparent",
    },
    folderChapterPressed: {
      backgroundColor: color.fill,
    },
    folderTitleBook: {
      flex: 1,
      minWidth: 0,
      fontSize: 17,
      fontWeight: "700",
      color: color.ink,
      letterSpacing: -0.2,
    },
    folderTitleChapter: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      fontWeight: "600",
      color: color.inkSoft,
      letterSpacing: -0.1,
    },

    card: {
      backgroundColor: color.paperRaised,
      borderRadius: radius.md,
      // margin lives on NoteSwipeRow so swipe actions align under the card
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.lineSoft,
      paddingVertical: space[3],
      paddingHorizontal: space[3] + 2,
      gap: space[1],
      // Soft lift without fighting the paper field
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
    },
    cardTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: "700",
      color: color.ink,
      letterSpacing: -0.2,
    },
    badge: {
      fontSize: 11,
      fontWeight: "600",
      color: color.muted,
      backgroundColor: color.fill,
      overflow: "hidden",
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radius.pill,
    },
    cardBody: {
      fontSize: 15,
      lineHeight: 21,
      color: color.inkSoft,
      fontFamily: fontRead,
    },
    cardBodyMuted: {
      fontSize: 14,
      lineHeight: 20,
      color: color.faint,
      fontStyle: "italic",
    },
  });
}
