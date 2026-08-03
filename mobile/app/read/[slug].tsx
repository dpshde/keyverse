import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/src/context/SessionContext";
import type { Attachment, Block, Note } from "@/src/api/types";
import { hydrateBlocks } from "@/src/api/client";
import { decryptPayload } from "@/src/lib/crypto";
import { getChapter, chapterKey } from "@/src/lib/textBundle";
import { displayScope, resolveLocal } from "@/src/lib/resolveLocal";
import { passageShareUrls } from "@/src/lib/shareUrl";
import { LiquidGlassBar, liquidGlassBarListPad } from "@/src/components/LiquidGlassBar";
import { InlineNoteEditor } from "@/src/components/InlineNoteEditor";
import { CountPill } from "@/src/components/CountPill";
import { HeaderIconButton } from "@/src/components/HeaderIconButton";
import * as Local from "@/src/lib/localPack";
import { hapticLight, hapticMedium, hapticSelect } from "@/src/lib/haptics";
import { color, radius, space, type, ui } from "@/src/theme";

type VerseRow = {
  v: number;
  text: string;
  verseSlug: string;
  /** BSB section / pericope title shown above this verse */
  heading?: string;
};

type RangeNoteHit = { slug: string; note: Note; label: string; lo: number; hi: number };

/** Note counts for the left rail only when it has real content (or sealed body). */
function noteHasContent(note: Note | undefined | null, blocks?: Block[]): boolean {
  if (!note && !blocks) return false;
  if (note?.encrypted) return true;
  const bs = blocks ?? (note && !note.encrypted ? hydrateBlocks(note) : []);
  if (bs.some((b) => (b.text || "").trim())) return true;
  if ((note?.attachments?.length ?? 0) > 0) return true;
  return false;
}

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
  /**
   * Active multi-verse selection note tray.
   * While set: keep vv. lo–endV highlighted and open only the range note under
   * endV (do not open the individual end-verse note).
   */
  const [pendingRange, setPendingRange] = useState<{
    slug: string;
    label: string;
    /** Inclusive start verse of the selection */
    lo: number;
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
  /** Keyboard height — pad list + scroll open tray into view above keys */
  const [kbHeight, setKbHeight] = useState(0);
  const kbHeightRef = useRef(0);
  kbHeightRef.current = kbHeight;
  /** Verse number whose tray we keep above the keyboard */
  const focusVerseRef = useRef<number | null>(null);
  const versesRef = useRef(verses);
  versesRef.current = verses;
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
      // Don't fight the keyboard: keep dock hidden while typing
      if (kbHeightRef.current > 0) {
        setDockVisible(false);
        return;
      }
      if (y < 24) {
        setDockVisible(true);
        return;
      }
      if (dy > 6) setDockVisible(false);
      else if (dy < -6) setDockVisible(true);
    },
    [setDockVisible]
  );

  /**
   * Scroll so the open note tray sits in the upper portion of the visible
   * list (above the keyboard). Uses scrollToIndex + generous bottom padding.
   */
  const ensureVerseVisible = useCallback((v: number, animated = true) => {
    const list = versesRef.current;
    const index = list.findIndex((row) => row.v === v);
    if (index < 0) return;
    // Defer until tray layout / keyboard padding have applied
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          flatListRef.current?.scrollToIndex({
            index,
            // Keep verse + tray near top of remaining viewport (not under keys)
            viewPosition: 0.12,
            animated,
          });
        } catch {
          // Unknown layout: fall back to approximate offset
          flatListRef.current?.scrollToOffset({
            offset: Math.max(0, index * 72),
            animated,
          });
        }
      });
    });
  }, []);

  // Keyboard: pad list bottom + pin open tray into view
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (e: KeyboardEvent) => {
      const h = e.endCoordinates?.height ?? 0;
      setKbHeight(h);
      setDockVisible(false);
      const v = focusVerseRef.current;
      if (v != null) {
        // Match keyboard animation so the tray rides up with the keys
        const delay =
          Platform.OS === "ios" && e.duration != null && e.duration > 0
            ? Math.min(e.duration, 120)
            : 40;
        setTimeout(() => ensureVerseVisible(v, true), delay);
      }
    };
    const onHide = () => {
      setKbHeight(0);
    };

    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [ensureVerseVisible, setDockVisible]);

  const bookChapter = useMemo(() => {
    const m = /^([a-z0-9]+)\.(\d+)/i.exec(slug);
    return m ? { book: m[1].toLowerCase(), chapter: Number(m[2]) } : null;
  }, [slug]);

  const openVerseInline = useCallback(
    (v: number) => {
      hapticSelect();
      // Verse tap owns the tray — clear any range selection highlight.
      setPendingRange(null);
      focusVerseRef.current = v;
      setOpen({ ["v" + v]: true });
      // Keyboard may already be up (switching verses) — pin immediately
      if (kbHeightRef.current > 0) {
        ensureVerseVisible(v, true);
      } else {
        // Pre-scroll before keyboard so the jump is smaller
        ensureVerseVisible(v, true);
      }
    },
    [ensureVerseVisible]
  );

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
      // Drop in-progress drag chrome; multi-verse highlight lives on pendingRange.
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
      // Keep the passage highlighted and open ONLY the range note tray
      // (not the individual end-verse note).
      setPendingRange({
        slug: rSlug,
        label: displayScope({
          kind: "range",
          osis: rSlug.toUpperCase(),
          slug: rSlug,
        }),
        lo,
        endV: hi,
      });
      focusVerseRef.current = hi;
      setOpen({ ["v" + hi]: true });
      ensureVerseVisible(hi, true);
    },
    [bookChapter, openVerseInline, setListScrollEnabled, ensureVerseVisible]
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
        // Drop pending range tray if that note was just deleted
        setPendingRange((p) => (p && p.slug === slugSaved ? null : p));
        return;
      }
      const note = res as Note;
      // Blank plaintext notes are deleted by putNote; if we still get one, ignore for rail.
      if (!note.encrypted && !noteHasContent(note)) {
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
      setNotesBySlug((m) => ({ ...m, [slugSaved]: note }));
      if (slugSaved === chapterSlug) setChapterNote(note);
      if (!note.encrypted) {
        setResolvedBlocks((m) => ({ ...m, [slugSaved]: hydrateBlocks(note) }));
      }
    },
    [chapterSlug]
  );

  /** Live typing in a tray — keep resolvedBlocks (and thus the rail) in sync. */
  const onBlocksLive = useCallback((slugLive: string, blocks: Block[]) => {
    setResolvedBlocks((m) => {
      const empty = !blocks.some((b) => (b.text || "").trim());
      if (empty) {
        // Keep key only if attachments / encrypted note still “count”; parent rail
        // uses noteHasContent which treats empty blocks + no atts as no note.
        const next = { ...m, [slugLive]: blocks };
        return next;
      }
      return { ...m, [slugLive]: blocks };
    });
  }, []);

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

      // Range / cover indicators are derived live from notesBySlug (see rangeIndex).
      setVerses(
        (text.verses || []).map((vr) => {
          const vslug = `${book}.${chapter}.${vr.v}`;
          return {
            v: vr.v,
            text: vr.text || "",
            verseSlug: vslug,
            heading: (vr as { heading?: string }).heading || undefined,
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
    const shareSlug = slug || chapterSlug;
    if (!shareSlug) return;
    // Projected reader link (ADR 0019). App deep link always; https when cloud on.
    const { primary, web, app } = passageShareUrls({
      slug: shareSlug,
      cloudEnabled,
      cloudHost,
      cloudDoor,
    });
    const message = web ? `${title}\n${web}` : `${title}\n${app}`;
    try {
      await Share.share(
        Platform.OS === "ios"
          ? { url: primary, message: title }
          : { message, title }
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
      // Custom title — full weight, optically level with 40pt glass controls
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
          <HeaderIconButton
            symbol="square.and.arrow.up"
            accessibilityLabel="Share passage link"
            onPress={sharePassage}
            fallback={"\u2197"}
          />
          <HeaderIconButton
            symbol={hasChapter ? "note.text" : "square.and.pencil"}
            accessibilityLabel={hasChapter ? "Open chapter note" : "Add chapter note"}
            muted={!hasChapter}
            active={hasChapter}
            fallback={hasChapter ? "N" : "+"}
            onPress={() => {
              if (!chapterSlug) return;
              hapticLight();
              setOpen({});
              setPendingRange(null);
              router.push(`/note/${encodeURIComponent(chapterSlug)}`);
            }}
          />
          <Pressable
            onPress={() => {
              hapticSelect();
              setExpandAll((x) => !x);
            }}
            style={({ pressed }) => [
              styles.expandAllBtn,
              pressed && styles.expandAllPressed,
            ]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: expandAll }}
            accessibilityLabel={expandAll ? "Fold note previews" : "Expand note previews"}
          >
            <CountPill label="All" variant={expandAll ? "active" : "filled"} />
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
  /**
   * Range notes + cover set from live notesBySlug so deleting a range clears
   * mid-verse rails without waiting for a full chapter reload.
   */
  const rangeIndex = useMemo(() => {
    const byEnd = new Map<number, RangeNoteHit[]>();
    const cover = new Set<number>();
    if (!bookChapter) return { byEnd, cover };
    const prefix = `${bookChapter.book}.${bookChapter.chapter}`.toLowerCase();
    for (const n of Object.values(notesBySlug)) {
      if (n.scope?.kind !== "range") continue;
      const sl = (n.scope.slug || "").toLowerCase();
      if (!sl.startsWith(prefix + ".")) continue;
      // Skip blank notes that haven't been deleted yet
      if (!noteHasContent(n, resolvedBlocks[n.scope.slug])) continue;
      const osis = n.scope.osis || n.scope.slug;
      const m = /\.(\d+)\.(\d+)-(\d+)$/i.exec(osis);
      if (!m) continue;
      const lo = Number(m[2]);
      const hi = Number(m[3]);
      for (let v = lo; v <= hi; v++) cover.add(v);
      const arr = byEnd.get(hi) || [];
      arr.push({
        slug: n.scope.slug,
        note: n,
        label: displayScope(n.scope),
        lo,
        hi,
      });
      byEnd.set(hi, arr);
    }
    // Pending multi-verse selection (not yet saved) still covers the span for rail.
    if (pendingRange) {
      for (let v = pendingRange.lo; v <= pendingRange.endV; v++) cover.add(v);
    }
    return { byEnd, cover };
  }, [notesBySlug, resolvedBlocks, bookChapter, pendingRange]);

  /** Expand-all only opens verses that already have notes (not every blank verse). */
  const isOpen = (key: string, hasNotes: boolean) =>
    !!open[key] || (expandAll && hasNotes);
  const dockH = liquidGlassBarListPad(insets.bottom, true);
  /** Extra room so the open tray can scroll above the keyboard */
  const listBottomPad =
    space[4] + (kbHeight > 0 ? kbHeight + space[3] : dockH);
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
          contentContainerStyle={{ padding: space[4], paddingBottom: listBottomPad }}
          data={verses}
          keyExtractor={(item) => String(item.v)}
          onScroll={onScroll}
          scrollEventThrottle={16}
          scrollEnabled={!rangeDragging}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          // Keep focused TextInput from being covered while typing at chapter end
          maintainVisibleContentPosition={
            Platform.OS === "ios" ? { minIndexForVisible: 0 } : undefined
          }
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            flatListRef.current?.scrollToOffset({
              offset: Math.max(0, index * (averageItemLength || 80)),
              animated: true,
            });
            const v = verses[index]?.v;
            if (v != null) {
              setTimeout(() => ensureVerseVisible(v, true), 80);
            }
          }}
          renderItem={({ item }) => {
            // Live pack only — never fall back to a stale load-time note snapshot.
            const note = notesBySlug[item.verseSlug];
            const blocks = resolvedBlocks[item.verseSlug];
            const rangeNotes = rangeIndex.byEnd.get(item.v) || [];
            const hasVerse = noteHasContent(note, blocks);
            // Range notes under end verse; mid-span cover only gets a quiet rail.
            const hasNotesToShow = hasVerse || rangeNotes.length > 0;
            const has = hasNotesToShow || rangeIndex.cover.has(item.v);
            const key = "v" + item.v;
            const opened = isOpen(key, hasNotesToShow);
            // Drag selection (sel) or committed multi-verse passage (pendingRange).
            const selLo = sel
              ? Math.min(sel.a, sel.b)
              : pendingRange
                ? pendingRange.lo
                : null;
            const selHi = sel
              ? Math.max(sel.a, sel.b)
              : pendingRange
                ? pendingRange.endV
                : null;
            const selected =
              selLo != null && selHi != null && item.v >= selLo && item.v <= selHi;
            const selFirst = selected && item.v === selLo;
            const selLast = selected && item.v === selHi;
            const showPendingRange = pendingRange && pendingRange.endV === item.v;
            /**
             * Range selection owns this tray: show only the range note, not the
             * individual end-verse editor (user asked for passage, not vN alone).
             */
            const rangeOnlyTray = !!(
              showPendingRange && pendingRange!.lo < pendingRange!.endV
            );
            const verseLocked = !!(note?.encrypted && !blocks?.length);

            // Web parity: flat left rail = has notes; stronger when this verse owns a note
            const showRail = has && !opened;
            const railStrong = hasVerse || rangeNotes.length > 0;

            return (
              <View
                ref={(n) => {
                  verseRefs.current.set(item.v, n);
                }}
                style={[
                  styles.verse,
                  // Continuous passage: no vertical gap between selected rows
                  selected && styles.verseInPassage,
                  selected && selFirst && styles.verseInPassageFirst,
                  selected && selLast && styles.verseInPassageLast,
                  showRail && styles.verseHasNotes,
                  showRail && railStrong && styles.verseHasVerseNote,
                ]}
                collapsable={false}
                accessibilityState={{ selected: !!selected }}
                accessibilityHint={has ? "Has note" : undefined}
              >
                {/*
                  Passage mark = scripture only (web .verse.sel ::after).
                  Outer radius on run ends; flat mid-span. Note tray is separate.
                */}
                <View
                  style={[
                    selected && styles.verseSel,
                    selected && selFirst && styles.verseSelFirst,
                    selected && selLast && styles.verseSelLast,
                  ]}
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
                        focusVerseRef.current = null;
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
                </View>

                {opened ? (
                  <View style={[styles.noteTray, selected && styles.noteTrayAfterSel]}>
                    {/* Skip end-verse note when user selected a multi-verse passage */}
                    {!rangeOnlyTray ? (
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
                        onBlocksLive={(b) => onBlocksLive(item.verseSlug, b)}
                      />
                    ) : null}
                    {rangeNotes.map((rn) => {
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
                          onBlocksLive={(b) => onBlocksLive(rn.slug, b)}
                        />
                      );
                    })}
                    {showPendingRange &&
                    !rangeNotes.some((r) => r.slug === pendingRange!.slug) ? (
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
                        onBlocksLive={(b) => onBlocksLive(pendingRange!.slug, b)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      </View>

      {bookChapter && kbHeight === 0 ? (
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
  // Nav chrome — title + glass controls share one optical midline
  headerSide: {
    paddingHorizontal: 0,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.35,
    lineHeight: 22,
    color: color.ink,
    maxWidth: 200,
    textAlign: "center",
    // Nudge title to the same visual center as HeaderIconButton glyphs
    marginTop: -1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    height: 40,
    // Tight cluster so the liquid-glass pill reads as one control
    gap: 0,
  },
  /** “All” note-preview pill — same language as home count chips, not chevrons */
  expandAllBtn: {
    minWidth: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  expandAllPressed: {
    opacity: 0.45,
  },
  verse: {
    // Keep vertical rhythm tight — only left rail needs structural inset
    paddingVertical: space[2],
    paddingLeft: 10,
    paddingRight: 2,
    borderLeftWidth: 2,
    borderLeftColor: "transparent",
  },
  /** Collapse outer pad so adjacent selected verses form one wash */
  verseInPassage: {
    paddingVertical: 0,
  },
  verseInPassageFirst: {
    paddingTop: space[2],
  },
  verseInPassageLast: {
    paddingBottom: space[2],
  },
  /**
   * Passage mark (web .verse.sel): warm ink wash on paper, not UI-blue.
   * Mid-span: square. Run ends: soft outer radius only.
   */
  verseSel: {
    backgroundColor: color.sel,
    borderRadius: 0,
    paddingVertical: 10,
    paddingHorizontal: space[3],
  },
  verseSelFirst: {
    borderTopLeftRadius: radius.sel,
    borderTopRightRadius: radius.sel,
  },
  verseSelLast: {
    borderBottomLeftRadius: radius.sel,
    borderBottomRightRadius: radius.sel,
  },
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
  /** Breathing room after a passage mark — tray is a sibling surface, not in the wash */
  noteTrayAfterSel: {
    marginTop: space[3],
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
