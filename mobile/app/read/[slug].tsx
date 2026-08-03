import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/src/context/SessionContext";
import type { Attachment, Block, Note } from "@/src/api/types";
import { hydrateBlocks } from "@/src/api/client";
import { decryptPayload } from "@/src/lib/crypto";
import { getChapter, chapterKey } from "@/src/lib/textBundle";
import { displayScope, resolveLocal } from "@/src/lib/resolveLocal";
import { cloudReadUrl } from "@/src/lib/shareUrl";
import { LiquidGlassBar, liquidGlassBarListPad } from "@/src/components/LiquidGlassBar";
import { InlineNoteEditor } from "@/src/components/InlineNoteEditor";
import * as Local from "@/src/lib/localPack";
import { hapticLight, hapticMedium, hapticSelect } from "@/src/lib/haptics";
import { color, radius, space, type, ui } from "@/src/theme";

type VerseRow = {
  v: number;
  text: string;
  verseSlug: string;
  /** BSB section / pericope title shown above this verse */
  heading?: string;
  verseNote?: Note | null;
  rangeNotes: { slug: string; note: Note; label: string }[];
  inRangeCover: boolean;
};

function resolvedBlocksEqual(
  a: Record<string, Block[]>,
  b: Record<string, Block[]>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const ab = a[k];
    const bb = b[k];
    if (!bb || ab.length !== bb.length) return false;
    for (let i = 0; i < ab.length; i++) {
      if (
        ab[i].id !== bb[i].id ||
        ab[i].text !== bb[i].text ||
        (ab[i].indent | 0) !== (bb[i].indent | 0) ||
        !!ab[i].collapsed !== !!bb[i].collapsed
      ) {
        return false;
      }
    }
  }
  return true;
}

export default function ReaderScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = decodeURIComponent(String(raw || ""));
  const { passphrase, translation, cloudEnabled, cloudHost, cloudDoor } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState(slug);
  const [verses, setVerses] = useState<VerseRow[]>([]);
  const [notesBySlug, setNotesBySlug] = useState<Record<string, Note>>({});
  const [chapterNote, setChapterNote] = useState<Note | null>(null);
  const [chapterSlug, setChapterSlug] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState(false);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [resolvedBlocks, setResolvedBlocks] = useState<Record<string, Block[]>>({});
  const [pendingRange, setPendingRange] = useState<{
    slug: string;
    label: string;
    endV: number;
  } | null>(null);
  const lastScrollY = useRef(0);
  const dockShown = useRef(true);
  const dockAnim = useRef(new Animated.Value(0)).current;
  /** Long-press + drag range select */
  const draggingRange = useRef(false);
  const rangeAnchor = useRef<number | null>(null);
  const verseWindow = useRef(new Map<number, { y: number; h: number }>());
  const verseRefs = useRef(new Map<number, View | null>());
  const flatListRef = useRef<FlatList<VerseRow>>(null);
  /** Swallow the synthetic press that follows a long-press drag release */
  const suppressNextPress = useRef(false);
  const selRef = useRef(sel);
  const [rangeDragging, setRangeDragging] = useState(false);
  selRef.current = sel;

  const setListScrollEnabled = useCallback((enabled: boolean) => {
    // Native prop avoids a full re-render that can cancel the active touch
    flatListRef.current?.setNativeProps?.({ scrollEnabled: enabled });
    setRangeDragging(!enabled);
  }, []);

  const setDockVisible = useCallback(
    (visible: boolean) => {
      if (dockShown.current === visible) return;
      dockShown.current = visible;
      Animated.timing(dockAnim, {
        toValue: visible ? 0 : 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    },
    [dockAnim]
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const dy = y - lastScrollY.current;
      lastScrollY.current = y;
      if (y < 24) {
        setDockVisible(true);
        return;
      }
      if (dy > 6) setDockVisible(false);
      else if (dy < -6) setDockVisible(true);
    },
    [setDockVisible]
  );

  const bookChapter = useMemo(() => {
    const m = /^([a-z0-9]+)\.(\d+)/i.exec(slug);
    return m ? { book: m[1].toLowerCase(), chapter: Number(m[2]) } : null;
  }, [slug]);

  const openVerseInline = useCallback((v: number) => {
    hapticSelect();
    setOpen({ ["v" + v]: true });
    setPendingRange(null);
  }, []);

  const goChapter = useCallback(
    (delta: -1 | 1) => {
      if (!bookChapter) return;
      hapticLight();
      const ch = Math.max(1, bookChapter.chapter + delta);
      const nextSlug = `${bookChapter.book}.${ch}`;
      // anim=prev → reverse (pop) replace animation in root Stack options
      router.replace({
        pathname: "/read/[slug]",
        params: { slug: nextSlug, anim: delta < 0 ? "prev" : "next" },
      });
    },
    [bookChapter, router]
  );

  const remeasureVerses = useCallback(() => {
    verseRefs.current.forEach((node, v) => {
      node?.measureInWindow((_x, y, _w, h) => {
        if (h > 0) verseWindow.current.set(v, { y, h });
      });
    });
  }, []);

  const verseAtPageY = useCallback((pageY: number) => {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [v, lay] of verseWindow.current) {
      if (pageY >= lay.y && pageY < lay.y + lay.h) return v;
      const mid = lay.y + lay.h / 2;
      const d = Math.abs(pageY - mid);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  }, []);

  const updateRangeEnd = useCallback(
    (pageY: number) => {
      if (!draggingRange.current || rangeAnchor.current == null) return;
      const v = verseAtPageY(pageY);
      if (v == null) return;
      const a = rangeAnchor.current;
      setSel((prev) => {
        if (prev && prev.a === a && prev.b === v) return prev;
        return { a, b: v };
      });
    },
    [verseAtPageY]
  );

  const beginRangeDrag = useCallback(
    (v: number) => {
      hapticMedium();
      draggingRange.current = true;
      rangeAnchor.current = v;
      setSel({ a: v, b: v });
      setOpen({});
      setPendingRange(null);
      setListScrollEnabled(false);
      // Measure after scroll lock so frames are stable for drag hit-tests
      requestAnimationFrame(() => {
        remeasureVerses();
        requestAnimationFrame(() => remeasureVerses());
      });
    },
    [remeasureVerses, setListScrollEnabled]
  );

  const cancelRangeDrag = useCallback(() => {
    draggingRange.current = false;
    rangeAnchor.current = null;
    setSel(null);
    setListScrollEnabled(true);
  }, [setListScrollEnabled]);

  const finalizeRange = useCallback(
    (a: number, b: number) => {
      draggingRange.current = false;
      rangeAnchor.current = null;
      setListScrollEnabled(true);
      setSel(null);
      if (!bookChapter) return;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (lo === hi) {
        openVerseInline(lo);
        return;
      }
      hapticMedium();
      const rSlug = `${bookChapter.book}.${bookChapter.chapter}.${lo}-${hi}`;
      setPendingRange({
        slug: rSlug,
        label: displayScope({
          kind: "range",
          osis: rSlug.toUpperCase(),
          slug: rSlug,
        }),
        endV: hi,
      });
      setOpen({ ["v" + hi]: true });
    },
    [bookChapter, openVerseInline, setListScrollEnabled]
  );

  const onNoteSaved = useCallback(
    (slugSaved: string, res: Note | { deleted: true; slug: string }) => {
      if ("deleted" in res && res.deleted) {
        setNotesBySlug((m) => {
          const n = { ...m };
          delete n[slugSaved];
          return n;
        });
        setResolvedBlocks((m) => {
          const n = { ...m };
          delete n[slugSaved];
          return n;
        });
        if (slugSaved === chapterSlug) setChapterNote(null);
        return;
      }
      const note = res as Note;
      setNotesBySlug((m) => ({ ...m, [slugSaved]: note }));
      if (slugSaved === chapterSlug) setChapterNote(note);
      if (!note.encrypted) {
        setResolvedBlocks((m) => ({ ...m, [slugSaved]: hydrateBlocks(note) }));
      }
    },
    [chapterSlug]
  );

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!slug) return;
    const quiet = !!opts?.quiet;
    if (!quiet) {
      setBusy(true);
      setErr(null);
    }
    try {
      const r = resolveLocal(slug);
      const book = bookChapter?.book || "";
      const chapter = bookChapter?.chapter || 1;
      const text = await getChapter(translation, book, chapter);
      setTitle(
        displayScope(
          r.scope || { kind: "chapter", osis: `${book}.${chapter}`, slug: `${book}.${chapter}` }
        )
      );

      const list = await Local.listNotes();
      const map: Record<string, Note> = {};
      for (const n of list) if (n.scope?.slug) map[n.scope.slug] = n;
      setNotesBySlug(map);

      const chSlug = chapterKey(book, chapter);
      setChapterSlug(chSlug);
      setChapterNote(map[chSlug] || null);

      const rangeByEnd = new Map<
        number,
        { slug: string; note: Note; label: string; lo: number; hi: number }[]
      >();
      const cover = new Set<number>();
      for (const n of list) {
        if (n.scope?.kind !== "range") continue;
        const osis = n.scope.osis || n.scope.slug;
        const m = /\.(\d+)\.(\d+)-(\d+)$/i.exec(osis);
        if (!m) continue;
        if (!n.scope.slug.toLowerCase().startsWith(book + "." + chapter)) continue;
        const lo = Number(m[2]);
        const hi = Number(m[3]);
        for (let v = lo; v <= hi; v++) cover.add(v);
        const arr = rangeByEnd.get(hi) || [];
        arr.push({
          slug: n.scope.slug,
          note: n,
          label: displayScope(n.scope),
          lo,
          hi,
        });
        rangeByEnd.set(hi, arr);
      }

      setVerses(
        (text.verses || []).map((vr) => {
          const vslug = `${book}.${chapter}.${vr.v}`;
          return {
            v: vr.v,
            text: vr.text || "",
            verseSlug: vslug,
            heading: (vr as { heading?: string }).heading || undefined,
            verseNote: map[vslug] || null,
            rangeNotes: rangeByEnd.get(vr.v) || [],
            inRangeCover: cover.has(vr.v),
          };
        })
      );
    } catch (e) {
      if (!quiet) setErr(String(e));
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [slug, translation, bookChapter]);

  // Only re-run when chapter/translation changes — not on every focus (notes cache handles writes).
  const loadedKey = useRef("");
  const notesEpochRef = useRef(Local.getNotesCacheEpoch());

  useEffect(() => {
    const key = `${slug}|${translation}`;
    if (loadedKey.current !== key) {
      loadedKey.current = key;
      load();
    }
  }, [load, slug, translation]);

  // Soft notes refresh only if local pack epoch advanced while we were away
  useFocusEffect(
    useCallback(() => {
      const ep = Local.getNotesCacheEpoch();
      if (ep !== notesEpochRef.current) {
        notesEpochRef.current = ep;
        load({ quiet: true });
      }
    }, [load])
  );

  // Live: full note page / imports / cloud pull while reader stays mounted under stack
  useEffect(() => {
    return Local.subscribeNoteChanges((ch) => {
      notesEpochRef.current = Local.getNotesCacheEpoch();
      if (ch.deleted) {
        onNoteSaved(ch.slug, { deleted: true, slug: ch.slug });
        return;
      }
      onNoteSaved(ch.slug, ch.note);
    });
  }, [onNoteSaved]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, Block[]> = {};
      for (const [sl, n] of Object.entries(notesBySlug)) {
        if (n.encrypted && n.cipher && passphrase) {
          try {
            const p = await decryptPayload(n.cipher, passphrase);
            next[sl] = p.blocks;
          } catch {
            /* locked */
          }
        } else if (!n.encrypted) {
          next[sl] = hydrateBlocks(n);
        }
      }
      if (cancelled) return;
      // Avoid pointless setState when content is unchanged (breaks update-depth loops
      // when saves already updated the same slug via onNoteSaved).
      setResolvedBlocks((prev) => (resolvedBlocksEqual(prev, next) ? prev : next));
    })();
    return () => {
      cancelled = true;
    };
  }, [notesBySlug, passphrase]);

  const sharePassage = useCallback(async () => {
    hapticSelect();
    if (!cloudEnabled || !cloudDoor) {
      Alert.alert(
        "Sync required",
        "Turn on sync in Share to get a cloud link for this passage."
      );
      return;
    }
    const shareSlug = slug || chapterSlug;
    if (!shareSlug) return;
    const url = cloudReadUrl(cloudHost, cloudDoor, shareSlug);
    try {
      await Share.share(
        Platform.OS === "ios"
          ? { url, message: title }
          : { message: `${title}\n${url}`, title }
      );
    } catch {
      /* cancelled */
    }
  }, [cloudEnabled, cloudDoor, cloudHost, slug, chapterSlug, title]);

  useLayoutEffect(() => {
    const hasChapter = !!(
      chapterNote ||
      (chapterSlug && resolvedBlocks[chapterSlug]?.some((b) => (b.text || "").trim()))
    );
    const displayTitle = title.length > 26 ? title.slice(0, 26) + "…" : title;
    navigation.setOptions({
      // Custom title for full type weight — default stack title reads soft on glass
      headerTitle: () => (
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
          {displayTitle}
        </Text>
      ),
      headerTitleAlign: "center",
      headerLeftContainerStyle: styles.headerSide,
      headerRightContainerStyle: styles.headerSide,
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
            onPress={() => {
              if (!chapterSlug) return;
              hapticLight();
              setOpen({});
              setPendingRange(null);
              router.push(`/note/${encodeURIComponent(chapterSlug)}`);
            }}
            style={[styles.headerIconBtn, hasChapter && styles.headerIconBtnOn]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={hasChapter ? "Open chapter note" : "Add chapter note"}
          >
            <SymbolView
              name={hasChapter ? "note.text" : "square.and.pencil"}
              size={20}
              weight="semibold"
              tintColor={hasChapter ? color.ink : color.inkSoft}
              fallback={
                <Text style={styles.headerIconFallback}>{hasChapter ? "N" : "+"}</Text>
              }
            />
          </Pressable>
          <Pressable
            onPress={() => {
              hapticSelect();
              setExpandAll((x) => !x);
            }}
            style={[styles.headerIconBtn, expandAll && styles.headerIconBtnOn]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={expandAll ? "Fold note previews" : "Expand note previews"}
            accessibilityState={{ selected: expandAll }}
          >
            <SymbolView
              name={expandAll ? "chevron.up" : "chevron.down"}
              size={18}
              weight="bold"
              tintColor={expandAll ? color.ink : color.inkSoft}
              fallback={
                <Text style={styles.headerIconFallback}>{expandAll ? "↑" : "↓"}</Text>
              }
            />
          </Pressable>
        </View>
      ),
    });
  }, [
    navigation,
    sharePassage,
    title,
    expandAll,
    chapterNote,
    chapterSlug,
    resolvedBlocks,
    router,
  ]);

  /** Capture pan while range-dragging so FlatList cannot steal the gesture for scroll. */
  const onMoveShouldSetResponderCapture = useCallback(() => draggingRange.current, []);
  const onStartShouldSetResponderCapture = useCallback(() => draggingRange.current, []);

  const onListTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      if (!draggingRange.current) return;
      updateRangeEnd(e.nativeEvent.pageY);
    },
    [updateRangeEnd]
  );

  const onListTouchEnd = useCallback(() => {
    if (!draggingRange.current || rangeAnchor.current == null) return;
    suppressNextPress.current = true;
    const cur = selRef.current;
    if (cur) finalizeRange(cur.a, cur.b);
    else cancelRangeDrag();
  }, [finalizeRange, cancelRangeDrag]);

  // Derived UI state only — no hooks below this line (early returns follow).
  /** Expand-all only opens verses that already have notes (not every blank verse). */
  const isOpen = (key: string, hasNotes: boolean) =>
    !!open[key] || (expandAll && hasNotes);
  const dockH = liquidGlassBarListPad(insets.bottom, true);
  const dockSlide = dockAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 120],
  });
  if (busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.muted} />
      </View>
    );
  }
  if (err) {
    return (
      <View style={styles.center}>
        <Text style={ui.err}>{err}</Text>
        <Pressable onPress={() => load()} style={ui.secondaryBtn}>
          <Text style={ui.secondaryBtnTxt}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={ui.screen}>
      <View
        style={styles.list}
        onStartShouldSetResponderCapture={onStartShouldSetResponderCapture}
        onMoveShouldSetResponderCapture={onMoveShouldSetResponderCapture}
        onResponderMove={onListTouchMove}
        onResponderRelease={onListTouchEnd}
        onResponderTerminate={onListTouchEnd}
        onTouchMove={onListTouchMove}
        onTouchEnd={onListTouchEnd}
        onTouchCancel={onListTouchEnd}
      >
        <FlatList
          ref={flatListRef}
          style={styles.list}
          contentContainerStyle={{ padding: space[4], paddingBottom: dockH + space[4] }}
          data={verses}
          keyExtractor={(item) => String(item.v)}
          onScroll={onScroll}
          scrollEventThrottle={16}
          scrollEnabled={!rangeDragging}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              {sel ? (
                <Pressable
                  onPress={() => {
                    cancelRangeDrag();
                    setPendingRange(null);
                  }}
                  style={styles.rangeBanner}
                  hitSlop={8}
                >
                  <Text style={styles.cancelRange}>
                    vv. {Math.min(sel.a, sel.b)}–{Math.max(sel.a, sel.b)} — drag · release to note ·
                    Cancel
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const note: Note | null | undefined = notesBySlug[item.verseSlug] ?? item.verseNote;
            const blocks = resolvedBlocks[item.verseSlug];
            const attCount = note?.attachments?.length ?? 0;
            const hasVerse =
              !!note || !!(blocks && blocks.some((b) => (b.text || "").trim())) || attCount > 0;
            // Range notes render under their end verse; mid-cover only gets a dot.
            const hasNotesToShow = hasVerse || item.rangeNotes.length > 0;
            const has = hasNotesToShow || item.inRangeCover;
            const key = "v" + item.v;
            const opened = isOpen(key, hasNotesToShow);
            const selected =
              sel && item.v >= Math.min(sel.a, sel.b) && item.v <= Math.max(sel.a, sel.b);
            const showPendingRange = pendingRange && pendingRange.endV === item.v;
            const verseLocked = !!(note?.encrypted && !blocks?.length);

            // Web parity: flat left rail = has notes; stronger when this verse owns a note
            const showRail = has && !opened;
            const railStrong = hasVerse || item.rangeNotes.length > 0;

            return (
              <View
                ref={(n) => {
                  verseRefs.current.set(item.v, n);
                }}
                style={[
                  styles.verse,
                  selected && styles.verseSel,
                  showRail && styles.verseHasNotes,
                  showRail && railStrong && styles.verseHasVerseNote,
                ]}
                collapsable={false}
                accessibilityState={{ selected: !!selected }}
                accessibilityHint={has ? "Has note" : undefined}
              >
                {item.heading ? (
                  <Text
                    style={[styles.sectionHead, item.v > 1 && styles.sectionHeadSpaced]}
                    accessibilityRole="header"
                  >
                    {item.heading}
                  </Text>
                ) : null}
                <Pressable
                  style={styles.versePress}
                  delayLongPress={320}
                  onPress={() => {
                    if (suppressNextPress.current) {
                      suppressNextPress.current = false;
                      return;
                    }
                    if (draggingRange.current) return;
                    if (sel) {
                      // Two-tap range: long-press start, then tap end
                      finalizeRange(sel.a, item.v);
                      return;
                    }
                    if (opened && open[key] && !expandAll) {
                      setOpen({});
                      setPendingRange(null);
                      return;
                    }
                    openVerseInline(item.v);
                  }}
                  onLongPress={() => beginRangeDrag(item.v)}
                >
                  {/* Row layout: paddingRight on nested Text is unreliable on RN */}
                  <Text style={styles.vnum}>{item.v}</Text>
                  <Text style={styles.vtext}>{item.text}</Text>
                </Pressable>

                {opened ? (
                  <View style={styles.noteTray}>
                    <InlineNoteEditor
                      slug={item.verseSlug}
                      revision={note?.updated_at || ""}
                      initialBlocks={
                        verseLocked
                          ? undefined
                          : blocks && blocks.length
                            ? blocks
                            : Local.emptyBlocks()
                      }
                      initialAttachments={(note?.attachments || []) as Attachment[]}
                      encrypted={!!note?.encrypted}
                      locked={verseLocked}
                      onSaved={(res) => onNoteSaved(item.verseSlug, res)}
                    />
                    {item.rangeNotes.map((rn) => {
                      const rBlocks = resolvedBlocks[rn.slug] || hydrateBlocks(rn.note);
                      const rLocked = !!(rn.note.encrypted && !rBlocks?.length);
                      const live = notesBySlug[rn.slug] || rn.note;
                      return (
                        <InlineNoteEditor
                          key={rn.slug}
                          slug={rn.slug}
                          label={rn.label}
                          revision={live?.updated_at || ""}
                          initialBlocks={rLocked ? undefined : rBlocks}
                          initialAttachments={(live?.attachments || []) as Attachment[]}
                          encrypted={!!live?.encrypted}
                          locked={rLocked}
                          onSaved={(res) => onNoteSaved(rn.slug, res)}
                        />
                      );
                    })}
                    {showPendingRange &&
                    !item.rangeNotes.some((r) => r.slug === pendingRange!.slug) ? (
                      <InlineNoteEditor
                        slug={pendingRange!.slug}
                        label={pendingRange!.label}
                        revision={
                          notesBySlug[pendingRange!.slug]?.updated_at ||
                          pendingRange!.slug
                        }
                        initialBlocks={
                          resolvedBlocks[pendingRange!.slug] || Local.emptyBlocks()
                        }
                        onSaved={(res) => onNoteSaved(pendingRange!.slug, res)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      </View>

      {bookChapter ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.dockSlide,
            {
              opacity: dockAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0],
              }),
              transform: [{ translateY: dockSlide }],
            },
          ]}
        >
          <LiquidGlassBar compact>
            <Pressable
              style={({ pressed }) => [styles.dockSeg, pressed && styles.dockSegPressed]}
              onPress={() => goChapter(-1)}
              accessibilityLabel="Previous chapter"
            >
              <Text style={styles.dockSegTxt}>Prev</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.dockSeg,
                styles.dockSegPrimary,
                pressed && styles.dockSegPressed,
              ]}
              onPress={() => {
                hapticLight();
                if (router.canGoBack()) router.back();
                else router.replace("/home");
              }}
              accessibilityLabel="Home"
            >
              <Text style={[styles.dockSegTxt, styles.dockSegPrimaryTxt]}>Home</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.dockSeg, pressed && styles.dockSegPressed]}
              onPress={() => goChapter(1)}
              accessibilityLabel="Next chapter"
            >
              <Text style={styles.dockSegTxt}>Next</Text>
            </Pressable>
          </LiquidGlassBar>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: color.paper },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[6],
    backgroundColor: color.paper,
    gap: space[3],
  },
  // Nav chrome — bolder within liquid-glass constraints
  headerSide: {
    paddingHorizontal: 2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: color.ink,
    maxWidth: 220,
    textAlign: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 40,
    gap: 0,
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconBtnOn: {
    // Active state reads through glass without new chrome
    opacity: 1,
  },
  headerIconFallback: {
    fontSize: 17,
    fontWeight: "700",
    color: color.ink,
    lineHeight: 20,
    textAlign: "center",
  },
  rangeBanner: {
    marginBottom: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: color.sel,
  },
  cancelRange: { color: color.link, fontWeight: "600", fontSize: 14 },
  verse: {
    // Keep vertical rhythm tight — only left rail needs structural inset
    paddingVertical: space[2],
    paddingLeft: 10,
    paddingRight: 2,
    borderLeftWidth: 2,
    borderLeftColor: "transparent",
  },
  verseSel: { backgroundColor: color.sel, borderRadius: radius.sm },
  /**
   * Web parity (app.css .verse.has-notes::before): flat 2px left rail.
   * Quieter for passage cover; stronger when this verse owns a note.
   */
  verseHasNotes: {
    borderLeftColor: "rgba(22,22,22,0.22)",
  },
  verseHasVerseNote: {
    borderLeftColor: "rgba(22,22,22,0.55)",
  },
  /** BSB pericope / section title above a verse */
  sectionHead: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: color.muted,
    marginBottom: space[2],
    paddingLeft: 0,
  },
  sectionHeadSpaced: {
    marginTop: space[3],
  },
  /** Horizontal gap lives here (not nested Text padding). */
  versePress: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  vnum: {
    ...type.verseNum,
    marginRight: 10,
    minWidth: 18,
    textAlign: "right",
    // Optical align with serif body cap height
    paddingTop: 4,
  },
  vtext: {
    ...type.verse,
    flex: 1,
  },
  noteTray: {
    // Tight under verse — was too much air above the tray
    marginTop: space[2],
    marginHorizontal: -space[1],
  },
  // Only pin to bottom — never full-screen (absoluteFill was intercepting header taps).
  dockSlide: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  dockSeg: {
    flex: 1,
    minHeight: 34,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.45)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.7)",
    paddingHorizontal: space[1],
  },
  dockSegPrimary: {
    backgroundColor: "rgba(22,22,22,0.88)",
    borderColor: "rgba(255,255,255,0.22)",
    borderTopColor: "rgba(255,255,255,0.35)",
  },
  dockSegPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  dockSegTxt: {
    fontWeight: "600",
    fontSize: 13,
    letterSpacing: -0.2,
    color: color.ink,
  },
  dockSegPrimaryTxt: {
    color: "#fff",
    fontWeight: "700",
  },
});
