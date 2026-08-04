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
import type { Block, Note } from "@/src/api/types";
import { hydrateBlocks } from "@/src/api/client";
import { decryptPayload } from "@/src/lib/crypto";
import { getChapter, chapterKey } from "@/src/lib/textBundle";
import { displayScope, resolveLocal } from "@/src/lib/resolveLocal";
import { passageShareUrls } from "@/src/lib/shareUrl";
import { LiquidGlassBar, liquidGlassBarListPad } from "@/src/components/LiquidGlassBar";
import { HeaderIconButton } from "@/src/components/HeaderIconButton";
import {
  VerseRowItem,
  type RangeNoteHit,
  type VerseRowData,
} from "@/src/components/VerseRowItem";
import * as Local from "@/src/lib/localPack";
import { hapticLight, hapticMedium, hapticSelect } from "@/src/lib/haptics";
import { useTheme } from "@/src/context/ThemeContext";
import { space, type ThemeColors } from "@/src/theme";

type VerseRow = VerseRowData;

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
  const { color, ui } = useTheme();
  const styles = useMemo(() => makeReaderStyles(color), [color]);
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
   * Live text presence per slug (from tray typing). Only flips empty↔content
   * so we do NOT rewrite resolvedBlocks (and re-render the chapter) every keystroke.
   */
  const [liveText, setLiveText] = useState<Record<string, boolean>>({});
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

  const clearLiveText = useCallback((slugSaved: string) => {
    setLiveText((m) => {
      if (m[slugSaved] === undefined) return m;
      const n = { ...m };
      delete n[slugSaved];
      return n;
    });
  }, []);

  const onNoteSaved = useCallback(
    (slugSaved: string, res: Note | { deleted: true; slug: string }) => {
      clearLiveText(slugSaved);
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
    [chapterSlug, clearLiveText]
  );

  /**
   * Live typing — only update rail presence when empty↔content flips.
   * Full block text stays inside InlineNoteEditor until save (no chapter re-render).
   */
  const onBlocksLive = useCallback((slugLive: string, blocks: Block[]) => {
    const hasText = blocks.some((b) => (b.text || "").trim().length > 0);
    setLiveText((m) => (m[slugLive] === hasText ? m : { ...m, [slugLive]: hasText }));
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

      // Chapter-scoped notes only — avoid mapping/decrypting the whole pack
      const chSlug = chapterKey(book, chapter);
      const prefix = `${book}.${chapter}`.toLowerCase();
      const list = await Local.listNotes();
      const map: Record<string, Note> = {};
      for (const n of list) {
        const sl = (n.scope?.slug || "").toLowerCase();
        if (!sl) continue;
        if (sl === chSlug.toLowerCase() || sl.startsWith(prefix + ".")) {
          map[n.scope!.slug] = n;
        }
      }
      setNotesBySlug(map);
      setLiveText({});
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

  const hasChapterNote = useMemo(() => {
    if (liveText[chapterSlug] === true) return true;
    if (liveText[chapterSlug] === false) {
      return !!(chapterNote?.attachments?.length || chapterNote?.encrypted);
    }
    return noteHasContent(chapterNote, resolvedBlocks[chapterSlug]);
  }, [chapterNote, chapterSlug, resolvedBlocks, liveText]);

  const openChapterNote = useCallback(() => {
    if (!chapterSlug) return;
    hapticLight();
    setOpen({});
    setPendingRange(null);
    router.push(`/note/${encodeURIComponent(chapterSlug)}`);
  }, [chapterSlug, router]);

  const toggleExpandAll = useCallback(() => {
    hapticSelect();
    setExpandAll((x) => !x);
  }, []);

  useLayoutEffect(() => {
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
            symbol={hasChapterNote ? "note.text" : "square.and.pencil"}
            accessibilityLabel={hasChapterNote ? "Open chapter note" : "Add chapter note"}
            muted={!hasChapterNote}
            active={hasChapterNote}
            fallback={hasChapterNote ? "N" : "+"}
            onPress={openChapterNote}
          />
          <HeaderIconButton
            symbol={expandAll ? "list.bullet.rectangle.fill" : "list.bullet.rectangle"}
            accessibilityLabel={expandAll ? "Fold note previews" : "Expand note previews"}
            active={expandAll}
            muted={!expandAll}
            fallback={"≡"}
            onPress={toggleExpandAll}
          />
        </View>
      ),
    });
  }, [
    navigation,
    sharePassage,
    title,
    expandAll,
    hasChapterNote,
    openChapterNote,
    toggleExpandAll,
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
  /** Content for rails: live typing overrides resolved snapshot when present. */
  const slugHasContent = useCallback(
    (sl: string, note: Note | undefined | null) => {
      if (liveText[sl] === true) return true;
      if (liveText[sl] === false) {
        return !!(note?.attachments?.length || note?.encrypted);
      }
      return noteHasContent(note, resolvedBlocks[sl]);
    },
    [liveText, resolvedBlocks]
  );

  const rangeIndex = useMemo(() => {
    const byEnd = new Map<number, RangeNoteHit[]>();
    const cover = new Set<number>();
    if (!bookChapter) return { byEnd, cover };
    const prefix = `${bookChapter.book}.${bookChapter.chapter}`.toLowerCase();
    for (const n of Object.values(notesBySlug)) {
      if (n.scope?.kind !== "range") continue;
      const sl = (n.scope.slug || "").toLowerCase();
      if (!sl.startsWith(prefix + ".")) continue;
      if (!slugHasContent(n.scope.slug, n)) continue;
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
  }, [notesBySlug, bookChapter, pendingRange, slugHasContent]);
  const dockH = liquidGlassBarListPad(insets.bottom, true);
  /** Extra room so the open tray can scroll above the keyboard */
  const listBottomPad =
    space[4] + (kbHeight > 0 ? kbHeight + space[3] : dockH);
  const listContentStyle = useMemo(
    () => ({ padding: space[4], paddingBottom: listBottomPad }),
    [listBottomPad]
  );
  const dockSlide = dockAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 120],
  });

  const setVerseRef = useCallback((v: number, node: View | null) => {
    verseRefs.current.set(v, node);
  }, []);

  const onPressVerse = useCallback(
    (v: number) => {
      if (suppressNextPress.current) {
        suppressNextPress.current = false;
        return;
      }
      if (draggingRange.current) return;
      const curSel = selRef.current;
      if (curSel) {
        finalizeRange(curSel.a, v);
        return;
      }
      const key = "v" + v;
      if (open[key] && !expandAll) {
        setOpen({});
        setPendingRange(null);
        focusVerseRef.current = null;
        return;
      }
      // Explicit open (also upgrades expand-all preview → full editor)
      openVerseInline(v);
    },
    [open, expandAll, finalizeRange, openVerseInline]
  );

  const onLongPressVerse = useCallback(
    (v: number) => beginRangeDrag(v),
    [beginRangeDrag]
  );

  const renderItem = useCallback(
    ({ item }: { item: VerseRow }) => {
      const note = notesBySlug[item.verseSlug];
      const blocks = resolvedBlocks[item.verseSlug];
      const rangeNotes = rangeIndex.byEnd.get(item.v) || EMPTY_RANGE_NOTES;
      const hasVerse = slugHasContent(item.verseSlug, note);
      const hasNotesToShow = hasVerse || rangeNotes.length > 0;
      const has = hasNotesToShow || rangeIndex.cover.has(item.v);
      const key = "v" + item.v;
      const explicitlyOpen = !!open[key];
      // Expand-all: read-only previews; full editor only when tapped (open[key])
      const expandPreview = expandAll && hasNotesToShow && !explicitlyOpen;
      const opened = explicitlyOpen || expandPreview;
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
      const showPendingRange = !!(pendingRange && pendingRange.endV === item.v);
      const rangeOnlyTray = !!(
        showPendingRange &&
        pendingRange &&
        pendingRange.lo < pendingRange.endV
      );
      const showRail = has && !opened;
      const railStrong = hasVerse || rangeNotes.length > 0;

      return (
        <VerseRowItem
          item={item}
          note={note}
          blocks={blocks}
          rangeNotes={rangeNotes}
          showRail={showRail}
          railStrong={railStrong}
          opened={opened}
          expandPreview={expandPreview}
          selected={selected}
          selFirst={selected && item.v === selLo}
          selLast={selected && item.v === selHi}
          showPendingRange={showPendingRange}
          rangeOnlyTray={rangeOnlyTray}
          pendingRange={pendingRange}
          notesBySlug={notesBySlug}
          resolvedBlocks={resolvedBlocks}
          onPressVerse={onPressVerse}
          onLongPressVerse={onLongPressVerse}
          onNoteSaved={onNoteSaved}
          onBlocksLive={onBlocksLive}
          setVerseRef={setVerseRef}
        />
      );
    },
    [
      notesBySlug,
      resolvedBlocks,
      rangeIndex,
      open,
      expandAll,
      sel,
      pendingRange,
      slugHasContent,
      onPressVerse,
      onLongPressVerse,
      onNoteSaved,
      onBlocksLive,
      setVerseRef,
    ]
  );

  const listExtraData = useMemo(
    () => ({
      open,
      expandAll,
      sel,
      pendingRange,
      liveText,
      notesEpoch: Object.keys(notesBySlug).length,
    }),
    [open, expandAll, sel, pendingRange, liveText, notesBySlug]
  );

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
          contentContainerStyle={listContentStyle}
          data={verses}
          keyExtractor={keyExtractorVerse}
          extraData={listExtraData}
          renderItem={renderItem}
          onScroll={onScroll}
          scrollEventThrottle={16}
          scrollEnabled={!rangeDragging}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          windowSize={7}
          maxToRenderPerBatch={8}
          initialNumToRender={12}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={Platform.OS === "android"}
          // Only while keyboard up — height thrash with expand-all previews is costly
          maintainVisibleContentPosition={
            Platform.OS === "ios" && kbHeight > 0
              ? { minIndexForVisible: 0 }
              : undefined
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

const EMPTY_RANGE_NOTES: RangeNoteHit[] = [];
const keyExtractorVerse = (item: VerseRow) => String(item.v);

function makeReaderStyles(color: ThemeColors) {
  const g = color.glass;
  return StyleSheet.create({
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
      backgroundColor: g.dockSeg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: g.dockSegBorder,
      paddingHorizontal: space[1],
    },
    dockSegPrimary: {
      backgroundColor: color.primaryFill,
      borderColor: g.capsuleBorder,
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
      color: color.primaryOn,
      fontWeight: "700",
    },
  });
}
