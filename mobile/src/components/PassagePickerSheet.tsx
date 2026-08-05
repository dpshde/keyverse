/**
 * Book → chapter picker sheet — Exedra NavigationSheet inspired.
 * Books list + A–Z rail (letter bubble) → chapter grid + chapter rail.
 * Title chrome: drag-down dismiss via RNGH (Pressables don't steal the pan).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ListRenderItem,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  Pressable as GHPressable,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import {
  alphaRailEntries,
  BIBLE_BOOKS_ALPHA,
  chapterRailLabels,
  chapterSlug,
  type BibleBook,
} from "../lib/bibleBooks";
import { hapticLight, hapticSelect } from "../lib/haptics";
import { motionDuration, motionSpring, MOTION_MS, MOTION_SPRING } from "../lib/motion";
import { radius, space, type ThemeColors } from "../theme";

const BOOK_ROW_H = 48;
/** Exedra uses 5 cols phone / 6 tablet-ish */
const COLS = 5;
const CHAPTER_GAP = 8;
const SHEET_TOP_INSET = 0.06;
/** Compact notch strip — title chrome is also a drag target */
const HANDLE_H = 28;
const CHAPTER_HEAD_H = 48;
/** Pull down this far on chrome to dismiss */
const DISMISS_DY = 72;
/** Velocity (px/s) that dismisses even below distance threshold */
const DISMISS_VY = 900;
const OPEN_SPRING = MOTION_SPRING.snappy;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called with chapter slug e.g. `jhn.3` */
  onSelect: (slug: string) => void;
  initialBook?: string;
  initialChapter?: number;
};

type Phase = "books" | "chapters";

function bookLetter(label: string): string {
  return label.replace(/^\d\s*/, "")[0]?.toUpperCase() || "";
}

export function PassagePickerSheet({
  visible,
  onClose,
  onSelect,
  initialBook,
  initialChapter,
}: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("books");
  const [book, setBook] = useState<BibleBook | null>(null);
  const [railH, setRailH] = useState(1);
  const [listW, setListW] = useState(0);
  const [bookRailDragging, setBookRailDragging] = useState(false);
  const [chapterRailDragging, setChapterRailDragging] = useState(false);
  const [previewLetter, setPreviewLetter] = useState<string | null>(null);
  const [previewChapter, setPreviewChapter] = useState<number | null>(null);

  const bookListRef = useRef<FlatList<BibleBook>>(null);
  const chapterScrollRef = useRef<ScrollView>(null);
  const lastHapticBook = useRef("");
  const lastHapticCh = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** JS-side guard against double onClose. */
  const closingRef = useRef(false);

  const winW = Dimensions.get("window").width;
  const winH = Dimensions.get("window").height;
  const maxSheetH = winH * (1 - SHEET_TOP_INSET);
  const padBottom = Math.max(insets.bottom, space[3]);

  /**
   * Single owner of sheet motion — Modal animationType is "none".
   * Drag, Done, and backdrop all drive the same translateY / backdrop fade.
   * Never reset Y to 0 before unmount (that caused a snap + second slide).
   */
  const sheetDragY = useSharedValue(winH);
  const backdropOp = useSharedValue(0);
  /** UI-thread flag so pan finalize won't fight exit animation. */
  const isClosingSV = useSharedValue(0);

  const finishClose = useCallback(() => {
    closingRef.current = false;
    isClosingSV.value = 0;
    onCloseRef.current();
  }, [isClosingSV]);

  /** Animate sheet off-screen from current Y, then unmount — one motion only. */
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    isClosingSV.value = 1;
    const closeMs = motionDuration(MOTION_MS.base);
    backdropOp.value = withTiming(0, {
      duration: closeMs,
      easing: Easing.out(Easing.cubic),
    });
    sheetDragY.value = withTiming(
      winH,
      { duration: closeMs, easing: Easing.out(Easing.cubic) },
      () => {
        // Always notify parent so the Modal can unmount
        runOnJS(finishClose)();
      }
    );
  }, [backdropOp, finishClose, isClosingSV, sheetDragY, winH]);

  // Open: slide up from bottom once (no competing Modal animation)
  useEffect(() => {
    if (!visible) {
      closingRef.current = false;
      isClosingSV.value = 0;
      return;
    }
    closingRef.current = false;
    isClosingSV.value = 0;
    // Start off-screen so first paint never flashes the full sheet mid-frame
    sheetDragY.value = winH;
    backdropOp.value = 0;
    const spring = motionSpring("snappy");
    if (spring) {
      sheetDragY.value = withSpring(0, spring);
    } else {
      sheetDragY.value = withTiming(0, { duration: 0 });
    }
    backdropOp.value = withTiming(1, {
      duration: motionDuration(MOTION_MS.base),
      easing: Easing.out(Easing.cubic),
    });
  }, [visible, winH, sheetDragY, backdropOp, isClosingSV]);

  const sheetDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetDragY.value }],
  }));

  const backdropAnimStyle = useAnimatedStyle(() => ({
    opacity: backdropOp.value,
  }));

  const books = BIBLE_BOOKS_ALPHA;
  const railEntries = useMemo(() => alphaRailEntries(books), [books]);
  const chapters = useMemo(() => {
    if (!book) return [] as number[];
    return Array.from({ length: book.chapters }, (_, i) => i + 1);
  }, [book]);
  const chRailLabels = useMemo(
    () => (book ? chapterRailLabels(book.chapters) : []),
    [book]
  );

  /**
   * Title chrome (notch + Books / ← book + Done) is the dismiss drag handle.
   * activeOffsetY keeps Done/Back tappable until a clear pull-down.
   * Modal is a separate native root → content must sit in GestureHandlerRootView.
   */
  const chromeDismissPan = useMemo(
    () =>
      Gesture.Pan()
        // Activate only after ~10px downward (not upward / sideways)
        .activeOffsetY(10)
        .failOffsetX([-32, 32])
        .onUpdate((e) => {
          if (isClosingSV.value) return;
          // Downward only; fade backdrop with drag
          const y = Math.max(0, e.translationY);
          sheetDragY.value = y;
          backdropOp.value = interpolate(
            y,
            [0, winH * 0.45],
            [1, 0],
            Extrapolation.CLAMP
          );
        })
        .onEnd((e) => {
          if (isClosingSV.value) return;
          const dy = Math.max(0, e.translationY);
          const shouldClose = dy > DISMISS_DY || e.velocityY > DISMISS_VY;
          if (shouldClose) {
            runOnJS(requestClose)();
          } else {
            sheetDragY.value = withSpring(0, OPEN_SPRING);
            backdropOp.value = withTiming(1, { duration: 160 });
          }
        })
        .onFinalize((_, success) => {
          // Interrupted mid-drag — ease back (not a dismiss)
          if (!success && !isClosingSV.value && sheetDragY.value > 0) {
            sheetDragY.value = withSpring(0, OPEN_SPRING);
            backdropOp.value = withTiming(1, { duration: 160 });
          }
        }),
    [backdropOp, isClosingSV, requestClose, sheetDragY, winH]
  );

  /**
   * Equal-width chapter cells (Exedra grid: repeat(5, 1fr)).
   * Estimate from window when list not laid out yet so height sizing works first paint.
   */
  const chapterCell = useMemo(() => {
    const railReserve = 40; // chapter rail + margin when present
    const w =
      listW > 0
        ? listW
        : winW - (book && book.chapters > COLS * 2 ? railReserve : 0);
    const pad = space[3] * 2;
    const gaps = CHAPTER_GAP * (COLS - 1);
    return Math.max(44, Math.floor((w - pad - gaps) / COLS));
  }, [listW, winW, book]);

  /** Grid content height (padding + rows) — used to size the sheet only. */
  const chapterGridH = useMemo(() => {
    if (!book || phase !== "chapters") return 0;
    const rows = Math.ceil(book.chapters / COLS);
    return (
      space[2] +
      rows * chapterCell +
      Math.max(0, rows - 1) * CHAPTER_GAP +
      space[4]
    );
  }, [book, phase, chapterCell]);

  /**
   * Books phase: tall browse sheet.
   * Chapters phase: hug content (Romans 16 → short); cap at max for Psalms etc.
   * Body always flex:1 into remaining space — never pin body height (that fought
   * flexBasis:0 and collapsed the chapter grid to 0 on short books).
   */
  const sheetH = useMemo(() => {
    if (phase === "chapters" && book) {
      const chrome = HANDLE_H + CHAPTER_HEAD_H + padBottom;
      const needed = chrome + chapterGridH;
      return Math.min(maxSheetH, Math.max(needed, 280));
    }
    return maxSheetH;
  }, [phase, book, chapterGridH, maxSheetH, padBottom]);

  useEffect(() => {
    if (!visible) {
      setBookRailDragging(false);
      setChapterRailDragging(false);
      setPreviewLetter(null);
      setPreviewChapter(null);
      return;
    }
    const start =
      (initialBook && books.find((b) => b.osis === initialBook.toLowerCase())) || null;
    if (start) {
      setBook(start);
      setPhase("chapters");
    } else {
      setBook(null);
      setPhase("books");
    }
  }, [visible, initialBook, books]);

  const scrollBookToIndex = useCallback(
    (index: number, animated = true) => {
      if (index < 0 || index >= books.length) return;
      try {
        bookListRef.current?.scrollToIndex({
          index,
          animated,
          viewPosition: 0.35,
        });
      } catch {
        bookListRef.current?.scrollToOffset({
          offset: Math.max(0, index * BOOK_ROW_H - 80),
          animated,
        });
      }
    },
    [books.length]
  );

  const scrollChapterIntoView = useCallback(
    (ch: number, animated = false) => {
      if (!book || chapterCell <= 0) return;
      const idx = ch - 1;
      const row = Math.floor(idx / COLS);
      const rowH = chapterCell + CHAPTER_GAP;
      chapterScrollRef.current?.scrollTo({
        y: Math.max(0, row * rowH - rowH),
        animated,
      });
    },
    [book, chapterCell]
  );

  // Open on a long book (e.g. Psalms): scroll grid to chapter without selected chrome
  useEffect(() => {
    if (!visible || phase !== "chapters" || !book) return;
    const ch =
      initialChapter && initialChapter >= 1 && initialChapter <= book.chapters
        ? initialChapter
        : null;
    if (ch == null || ch <= COLS * 3) return;
    const t = requestAnimationFrame(() => scrollChapterIntoView(ch, false));
    return () => cancelAnimationFrame(t);
  }, [visible, phase, book, initialChapter, scrollChapterIntoView]);

  const applyBookRailY = useCallback(
    (y: number, h: number) => {
      if (h <= 0 || books.length === 0) return;
      const ratio = Math.max(0, Math.min(1, y / h));
      const index = Math.min(Math.floor(ratio * books.length), books.length - 1);
      const b = books[index];
      if (!b) return;
      const letter = bookLetter(b.label);
      setPreviewLetter(letter || null);
      if (lastHapticBook.current !== b.osis) {
        hapticSelect();
        lastHapticBook.current = b.osis;
      }
      // Scroll only — no hover/selected row wash on the book list
      scrollBookToIndex(index, false);
    },
    [books, scrollBookToIndex]
  );

  const applyChapterRailY = useCallback(
    (y: number, h: number) => {
      if (!book || h <= 0) return;
      const ratio = Math.max(0, Math.min(1, y / h));
      const ch = Math.min(Math.floor(ratio * book.chapters) + 1, book.chapters);
      setPreviewChapter(ch);
      if (lastHapticCh.current !== ch) {
        hapticSelect();
        lastHapticCh.current = ch;
      }
      scrollChapterIntoView(ch, false);
    },
    [book, scrollChapterIntoView]
  );

  const bookRailPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          lastHapticBook.current = "";
          setBookRailDragging(true);
          applyBookRailY(e.nativeEvent.locationY, railH);
        },
        onPanResponderMove: (e) => {
          applyBookRailY(e.nativeEvent.locationY, railH);
        },
        onPanResponderRelease: () => {
          lastHapticBook.current = "";
          setBookRailDragging(false);
          setPreviewLetter(null);
        },
        onPanResponderTerminate: () => {
          lastHapticBook.current = "";
          setBookRailDragging(false);
          setPreviewLetter(null);
        },
      }),
    [applyBookRailY, railH]
  );

  const chapterRailPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          lastHapticCh.current = 0;
          setChapterRailDragging(true);
          applyChapterRailY(e.nativeEvent.locationY, railH);
        },
        onPanResponderMove: (e) => {
          applyChapterRailY(e.nativeEvent.locationY, railH);
        },
        onPanResponderRelease: () => {
          lastHapticCh.current = 0;
          setChapterRailDragging(false);
          setPreviewChapter(null);
        },
        onPanResponderTerminate: () => {
          lastHapticCh.current = 0;
          setChapterRailDragging(false);
          setPreviewChapter(null);
        },
      }),
    [applyChapterRailY, railH]
  );

  const onBookPress = useCallback((b: BibleBook) => {
    hapticLight();
    setBook(b);
    setPhase("chapters");
    setBookRailDragging(false);
    setPreviewLetter(null);
  }, []);

  const onChapterPress = useCallback(
    (ch: number) => {
      if (!book) return;
      hapticLight();
      onSelect(chapterSlug(book.osis, ch));
      requestClose();
    },
    [book, onSelect, requestClose]
  );

  const backToBooks = useCallback(() => {
    hapticSelect();
    setPhase("books");
    setBook(null);
    setChapterRailDragging(false);
    setPreviewChapter(null);
  }, []);

  const renderBook: ListRenderItem<BibleBook> = useCallback(
    ({ item }) => {
      return (
        <Pressable
          onPress={() => onBookPress(item)}
          style={styles.bookRow}
          accessibilityRole="button"
          accessibilityLabel={`${item.label}, ${item.chapters} chapters`}
        >
          {/* Title + chapter count sit tight as one cluster (Exedra-style meta) */}
          <View style={styles.bookTitleCluster}>
            <Text style={styles.bookTxt} numberOfLines={1}>
              {item.label}
            </Text>
            <Text style={styles.bookMeta}>{item.chapters}</Text>
          </View>
        </Pressable>
      );
    },
    [onBookPress, styles]
  );

  const showChapterRail = book != null && book.chapters > COLS * 2;
  /** True when sheet is content-sized (no need to scroll the chapter grid). */
  const chaptersFit =
    phase === "chapters" && book != null && sheetH < maxSheetH - 8;

  const chapterCells = chapters.map((ch) => {
    // Only flash selection while scrubbing the rail — no sticky “current chapter”
    const on = chapterRailDragging && previewChapter === ch;
    return (
      <Pressable
        key={ch}
        onPress={() => onChapterPress(ch)}
        style={[
          styles.chCell,
          {
            width: chapterCell,
            height: chapterCell,
          },
          on && styles.chCellOn,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Chapter ${ch}`}
        accessibilityState={{ selected: !!on }}
      >
        <Text style={[styles.chTxt, on && styles.chTxtOn]}>{ch}</Text>
      </Pressable>
    );
  });

  return (
    <Modal
      visible={visible}
      // We own open/close motion — Modal slide fought translateY (snap + residual bar)
      animationType="none"
      transparent
      onRequestClose={requestClose}
      statusBarTranslucent
    >
      {/* Modal is a separate native root — RNGH needs its own root here. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View
          style={[styles.backdrop, backdropAnimStyle]}
          pointerEvents="box-none"
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel="Dismiss passage picker"
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetH,
              paddingBottom: padBottom,
            },
            sheetDragStyle,
          ]}
        >
          {/*
            Entire chrome is the dismiss drag target (Exedra sheet pull-down).
            Gesture.Pan activeOffsetY keeps Done/Back tappable until a real pull.
            flexShrink:0 so body always receives remaining height.
          */}
          <GestureDetector gesture={chromeDismissPan}>
            <View
              style={styles.chrome}
              accessibilityRole="adjustable"
              accessibilityLabel="Drag down to close"
              collapsable={false}
            >
              <View style={styles.handleHit}>
                <View style={styles.handleNotch} />
              </View>

              {phase === "books" ? (
                <View style={styles.head}>
                  {/* Title is pure text so the pan host owns the drag */}
                  <Text style={styles.headTitle}>Books</Text>
                  {/* GH Pressable cooperates with parent Pan; RN Pressable steals it */}
                  <GHPressable
                    onPress={requestClose}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                  >
                    <Text style={styles.done}>Done</Text>
                  </GHPressable>
                </View>
              ) : null}

              {phase === "chapters" && book ? (
                <View style={styles.chapterHead}>
                  <GHPressable
                    onPress={backToBooks}
                    style={styles.chapterBackRow}
                    accessibilityRole="button"
                    accessibilityLabel={`Back to books, ${book.label}`}
                  >
                    <Text style={styles.chapterBackArrow}>←</Text>
                    <Text style={styles.chapterBackTitle} numberOfLines={1}>
                      {book.label}
                    </Text>
                  </GHPressable>
                  <GHPressable
                    onPress={requestClose}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    style={styles.chapterDone}
                  >
                    <Text style={styles.done}>Done</Text>
                  </GHPressable>
                </View>
              ) : null}
            </View>
          </GestureDetector>

          <View
            style={styles.body}
            onLayout={(e: LayoutChangeEvent) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) setRailH(h);
            }}
          >
            {bookRailDragging && previewLetter ? (
              <View style={styles.letterBubble} pointerEvents="none">
                <Text style={styles.letterBubbleTxt}>{previewLetter}</Text>
              </View>
            ) : null}
            {chapterRailDragging && previewChapter != null ? (
              <View style={styles.letterBubble} pointerEvents="none">
                <Text
                  style={[
                    styles.letterBubbleTxt,
                    previewChapter >= 100 && styles.letterBubbleTxtSm,
                  ]}
                >
                  {previewChapter}
                </Text>
              </View>
            ) : null}

            {phase === "books" ? (
              <>
                <FlatList
                  ref={bookListRef}
                  data={books}
                  keyExtractor={(b) => b.osis}
                  renderItem={renderBook}
                  getItemLayout={(_, index) => ({
                    length: BOOK_ROW_H,
                    offset: BOOK_ROW_H * index,
                    index,
                  })}
                  style={styles.list}
                  contentContainerStyle={styles.listPad}
                  showsVerticalScrollIndicator={false}
                  onScrollToIndexFailed={({ index }) => {
                    bookListRef.current?.scrollToOffset({
                      offset: index * BOOK_ROW_H,
                      animated: false,
                    });
                  }}
                />
                {/*
                  Exedra jump-rail: only letter labels painted
                  (.rail-tick { display:none } / .rail-label { flex:1 }).
                  Scrub still maps Y → full book list index.
                */}
                <View
                  style={[styles.rail, bookRailDragging && styles.railDragging]}
                  {...bookRailPan.panHandlers}
                  accessibilityLabel="Book index"
                >
                  {railEntries
                    .filter((e) => e.label)
                    .map((e) => (
                      <View key={e.label!} style={styles.railLabelSlot} pointerEvents="none">
                        <Text
                          style={[
                            styles.railLab,
                            previewLetter === e.label &&
                              bookRailDragging &&
                              styles.railLabOn,
                          ]}
                        >
                          {e.label}
                        </Text>
                      </View>
                    ))}
                </View>
              </>
            ) : book ? (
              <>
                {/*
                  Chapter grid (Exedra .chapter-grid).
                  Short books: plain View (no ScrollView height collapse).
                  Long books: ScrollView when sheet is capped at max.
                */}
                <View
                  style={styles.chapterPane}
                  onLayout={(e) => {
                    const w = e.nativeEvent.layout.width;
                    if (w > 0) setListW(w);
                  }}
                >
                  {chaptersFit ? (
                    <View style={[styles.chPad, styles.chPadFit]}>
                      <View style={styles.chapterGrid}>{chapterCells}</View>
                    </View>
                  ) : (
                    <ScrollView
                      ref={chapterScrollRef}
                      style={styles.list}
                      contentContainerStyle={styles.chPad}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      bounces
                    >
                      <View style={styles.chapterGrid}>{chapterCells}</View>
                    </ScrollView>
                  )}
                </View>
                {showChapterRail ? (
                  <View
                    style={[
                      styles.rail,
                      styles.chapterRail,
                      chapterRailDragging && styles.railDragging,
                    ]}
                    {...chapterRailPan.panHandlers}
                    accessibilityLabel="Chapter index"
                  >
                    {chRailLabels.map((n) => (
                      <View key={n} style={styles.railLabelSlot} pointerEvents="none">
                        <Text
                          style={[
                            styles.railLab,
                            // Only while scrubbing — no sticky selected-chapter mark
                            chapterRailDragging &&
                              previewChapter === n &&
                              styles.railLabOn,
                          ]}
                        >
                          {n}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: "flex-end",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.38)",
    },
    sheet: {
      backgroundColor: c.paperRaised,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.lineSoft,
      width: "100%",
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 32,
      shadowOffset: { width: 0, height: -10 },
      elevation: 20,
    },
    /** Notch + title share one drag region — never shrink so body keeps height */
    chrome: {
      flexShrink: 0,
      // Ensure the gesture host has a real hit box (Android collapsable views break RNGH)
      backgroundColor: "transparent",
    },
    handleHit: {
      height: HANDLE_H,
      alignItems: "center",
      justifyContent: "center",
      paddingTop: 4,
      // Extra top slack for the pull target
      paddingBottom: 2,
    },
    handleNotch: {
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: c.hairline,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: space[4],
      paddingTop: 0,
      paddingBottom: space[1],
      minHeight: 40,
      gap: space[2],
    },
    headTitle: {
      flex: 1,
      fontSize: 17,
      fontWeight: "700",
      letterSpacing: -0.3,
      color: c.ink,
    },
    done: {
      fontSize: 16,
      fontWeight: "600",
      color: c.inkSoft,
      paddingVertical: space[1],
      paddingHorizontal: space[1],
    },
    /** Exedra .chapter-back-row — full-width under handle */
    chapterHead: {
      flexDirection: "row",
      alignItems: "center",
      paddingRight: space[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.lineSoft,
      marginBottom: 0,
    },
    chapterBackRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      minHeight: 44,
      paddingHorizontal: space[4],
      paddingVertical: space[1] + 2,
    },
    chapterBackArrow: {
      fontSize: 18,
      fontWeight: "500",
      color: c.inkSoft,
      marginTop: -1,
    },
    chapterBackTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: "600",
      letterSpacing: -0.2,
      color: c.ink,
    },
    chapterDone: {
      paddingHorizontal: space[2],
    },
    body: {
      flex: 1,
      flexDirection: "row",
      minHeight: 120,
      position: "relative",
    },
    letterBubble: {
      position: "absolute",
      top: "42%",
      left: "42%",
      marginLeft: -40,
      marginTop: -40,
      width: 80,
      height: 80,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.paperRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      zIndex: 20,
      shadowColor: "#000",
      shadowOpacity: 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 },
      elevation: 12,
    },
    letterBubbleTxt: {
      fontSize: 32,
      fontWeight: "700",
      color: c.ink,
      letterSpacing: -0.5,
      fontVariant: ["tabular-nums"],
    },
    letterBubbleTxtSm: {
      fontSize: 26,
    },
    list: {
      flex: 1,
    },
    listPad: {
      paddingHorizontal: space[3],
      paddingBottom: space[8],
    },
    bookRow: {
      height: BOOK_ROW_H,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: space[3],
      borderRadius: radius.md,
    },
    bookTitleCluster: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 6,
      minWidth: 0,
      maxWidth: "100%",
    },
    bookTxt: {
      flexShrink: 1,
      fontSize: 17,
      fontWeight: "500",
      color: c.ink,
      letterSpacing: -0.2,
    },
    /** Quiet chapter count — sits immediately after the book name */
    bookMeta: {
      fontSize: 13,
      fontWeight: "400",
      color: c.faint,
      opacity: 0.72,
      fontVariant: ["tabular-nums"],
    },
    chapterPane: {
      flex: 1,
      minWidth: 0,
    },
    chPad: {
      paddingHorizontal: space[3],
      paddingTop: space[2],
      paddingBottom: space[8],
    },
    /** When all chapters fit — no huge bottom pad */
    chPadFit: {
      paddingBottom: space[2],
      flexGrow: 0,
    },
    /** Exedra .chapter-grid */
    chapterGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: CHAPTER_GAP,
    },
    chCell: {
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.lineSoft,
    },
    chCellOn: {
      backgroundColor: c.fillStrong,
      borderColor: c.line,
    },
    chTxt: {
      fontSize: 15,
      fontWeight: "500",
      color: c.ink,
      fontVariant: ["tabular-nums"],
    },
    chTxtOn: {
      fontWeight: "700",
    },
    /**
     * Exedra .jump-rail — letters only, evenly flexed.
     * No per-book notches/dots.
     */
    rail: {
      width: 32,
      paddingVertical: 8,
      paddingHorizontal: 4,
      alignItems: "center",
      justifyContent: "space-between",
      marginRight: 2,
      borderTopRightRadius: 12,
      borderBottomRightRadius: 12,
    },
    chapterRail: {
      alignSelf: "stretch",
      paddingHorizontal: 6,
    },
    railDragging: {
      backgroundColor: c.fillStrong,
    },
    /** Exedra .rail-tick.rail-label — flex:1 slot per letter */
    railLabelSlot: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 0,
    },
    railLab: {
      fontSize: 9,
      fontWeight: "600",
      letterSpacing: 0.5,
      color: c.faint,
    },
    railLabOn: {
      color: c.ink,
      fontWeight: "700",
    },
  });
}
