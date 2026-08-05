import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/src/context/SessionContext";
import { useTheme } from "@/src/context/ThemeContext";
import * as Local from "@/src/lib/localPack";
import {
  addDays,
  dayEqual,
  dayFromNotes,
  formatDayLabel,
  formatTime,
  bookAtCanonT,
  heatEqual,
  heatmapFromNotes,
  lineDiff,
  localDateKey,
  outlineAsRows,
  weeksFromHeatmap,
  type ActivityDay,
  type ActivityEvent,
  type ActivityHeatmap,
  type CanonBook,
  type DiffRow,
  type HeatCell,
} from "@/src/lib/activity";
import {
  activityScope,
  getDayMem,
  getHeatMem,
  loadDayCached,
  loadHeatCached,
  setDayCached,
  setHeatCached,
} from "@/src/lib/activityCache";
import { Chevron } from "@/src/components/Chevron";
import { CountPill } from "@/src/components/CountPill";
import { InlineMarkdown } from "@/src/lib/inlineMarkdown";
import { resolveWikiNav, wikiReaderHref } from "@/src/lib/wikiLink";
import { radius, space, type ThemeColors } from "@/src/theme";
import { hapticLight, hapticSelect } from "@/src/lib/haptics";
import { pushOnce } from "@/src/lib/nav";

/** Indent step matches Outliner compact tray (~18px). */
const OUTLINE_STEP = 16;

/** Graph cells — same size/spacing as original (11×11, 3px gap). Visual only. */
const CELL = 11;
const GAP = 3;

/** Sunday-start week containing `iso` (local calendar). */
function weekStartOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return addDays(iso, -dt.getDay());
}

function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** "Aug 3 – 9" or "Dec 29 – Jan 4" */
function formatWeekRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  try {
    const [y1, m1, d1] = weekStart.split("-").map(Number);
    const [y2, m2, d2] = end.split("-").map(Number);
    const a = new Date(y1, m1 - 1, d1, 12);
    const b = new Date(y2, m2 - 1, d2, 12);
    const left = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (y1 === y2 && m1 === m2) {
      return `${left} – ${d2}`;
    }
    const right = b.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${left} – ${right}`;
  } catch {
    return `${weekStart} – ${end}`;
  }
}

/** "Tuesday · Aug 4" */
function formatDayFolderLabel(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
    const weekday = dt.toLocaleDateString(undefined, { weekday: "long" });
    const rest = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${weekday} · ${rest}`;
  } catch {
    return formatDayLabel(iso);
  }
}

export default function ActivityScreen() {
  const { color, type, ui } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { cloudEnabled, client, cloudHost, cloudDoor } = useSession();

  const scope = useMemo(
    () => activityScope({ cloudEnabled, host: cloudHost, door: cloudDoor }),
    [cloudEnabled, cloudHost, cloudDoor]
  );

  const [heat, setHeat] = useState<ActivityHeatmap | null>(() => getHeatMem(scope));
  const [busy, setBusy] = useState(() => !getHeatMem(scope));
  const [err, setErr] = useState<string | null>(null);

  /** Sunday of the visible week. */
  const [weekStart, setWeekStart] = useState(() => weekStartOf(localDateKey(new Date())));
  /** Day folders: true = collapsed (home default). */
  const [dayCollapsed, setDayCollapsed] = useState<Record<string, boolean>>({});
  /** Day payloads in this session (seeded from activityCache on open). */
  const [dayCache, setDayCache] = useState<Record<string, ActivityDay | "loading" | "error">>({});
  /** Event cards expanded inside a day. */
  const [eventExpanded, setEventExpanded] = useState<Record<string, boolean>>({});
  /** Week range title → jump to any week in the heat range. */
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  /** Selected book on the canon coverage rail. */
  const [canonOsis, setCanonOsis] = useState<string | null>(null);
  const [canonRailW, setCanonRailW] = useState(0);

  const graphScrollRef = useRef<ScrollView>(null);
  const scrollGraphToEnd = useCallback((animated = false) => {
    requestAnimationFrame(() => {
      graphScrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const applyHeat = useCallback(
    async (next: ActivityHeatmap) => {
      // Stale-while-revalidate: keep showing cache unless payload actually changed
      setHeat((prev) => (heatEqual(prev, next) ? prev : next));
      await setHeatCached(scope, next);
    },
    [scope]
  );

  const loadLocalHeat = useCallback(async () => {
    const notes = await Local.listNotes();
    const local = heatmapFromNotes(notes);
    await applyHeat(local);
    return local;
  }, [applyHeat]);

  /**
   * Stale-while-revalidate heatmap.
   * `force` = user Retry (show spinner only if no cache).
   */
  const loadHeat = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = !!opts?.force;
      setErr(null);

      // Hydrate from disk if memory empty — paint cache immediately
      let cached = getHeatMem(scope);
      if (!cached) {
        cached = await loadHeatCached(scope);
        if (cached) {
          setHeat((prev) => (heatEqual(prev, cached) ? prev : cached));
        }
      }

      // Only block UI when we have nothing to show
      if (!cached || force) setBusy(!cached);

      try {
        if (cloudEnabled && client) {
          try {
            const remote = await client.activityHeatmap();
            const next: ActivityHeatmap = {
              days: remote.days.map((d) => ({
                date: d.date,
                count: d.count,
                level: Math.min(4, Math.max(0, d.level | 0)) as HeatCell["level"],
              })),
              total: remote.total,
              notes_taken_ytd: remote.notes_taken_ytd ?? remote.lines_added_ytd ?? 0,
              ytd_from: remote.ytd_from || remote.from,
              ytd_to: remote.ytd_to || remote.to,
              from: remote.from,
              to: remote.to,
              source: remote.source || "ops",
              canon: remote.canon,
            };
            await applyHeat(next);
            return;
          } catch (e) {
            const status = (e as { status?: number })?.status;
            const msg = String((e as { message?: string })?.message || e);
            // Keep showing cached remote heat if we have it
            if (!cached || cached.source === "notes") {
              await loadLocalHeat();
            }
            setErr(
              status === 404 || /not found|HTTP 404/i.test(msg)
                ? "Door activity API isn’t on this host yet — showing on-device note stamps."
                : `Couldn’t reach activity on your key (${msg}). Showing on-device note stamps.`
            );
            return;
          }
        }
        await loadLocalHeat();
      } catch (e) {
        if (!cached) {
          setHeat(null);
          setErr(String(e));
        } else {
          setErr(String(e));
        }
      } finally {
        setBusy(false);
      }
    },
    [cloudEnabled, client, scope, applyHeat, loadLocalHeat]
  );

  const scopeRef = useRef(scope);
  useEffect(() => {
    // Door / local scope change — drop day UI for the previous key
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      setDayCache({});
      setEventExpanded({});
      const mem = getHeatMem(scope);
      setHeat(mem);
      setBusy(!mem);
    }
    void loadHeat();
  }, [scope, loadHeat]);

  // Land on this week + scroll graph to today when heat arrives
  useEffect(() => {
    if (!heat) return;
    const today = heat.ytd_to || heat.to || localDateKey(new Date());
    setWeekStart(weekStartOf(today));
    scrollGraphToEnd(false);
  }, [heat, scrollGraphToEnd]);

  const weeks = useMemo(() => (heat ? weeksFromHeatmap(heat.days) : []), [heat]);

  useEffect(() => {
    if (!weeks.length) return;
    scrollGraphToEnd(false);
  }, [weeks.length, heat?.to, scrollGraphToEnd]);

  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    if (!heat) return m;
    for (const d of heat.days) m.set(d.date, d.count);
    return m;
  }, [heat]);

  const daysInWeek = useMemo(() => weekDates(weekStart), [weekStart]);

  const weekEnd = addDays(weekStart, 6);

  const shiftWeek = useCallback(
    (deltaWeeks: number) => {
      if (!heat) return;
      const next = addDays(weekStart, deltaWeeks * 7);
      const nextEnd = addDays(next, 6);
      const from = heat.from || heat.ytd_from;
      const to = heat.to || heat.ytd_to;
      // Allow week if it intersects [from, to]
      if (nextEnd < from || next > to) return;
      hapticSelect();
      setWeekStart(next);
      setEventExpanded({});
    },
    [heat, weekStart]
  );

  const canGoPrev = useMemo(() => {
    if (!heat) return false;
    const next = addDays(weekStart, -7);
    const nextEnd = addDays(next, 6);
    const from = heat.from || heat.ytd_from;
    const to = heat.to || heat.ytd_to;
    return nextEnd >= from && next <= to;
  }, [heat, weekStart]);

  const canGoNext = useMemo(() => {
    if (!heat) return false;
    const next = addDays(weekStart, 7);
    const nextEnd = addDays(next, 6);
    const from = heat.from || heat.ytd_from;
    const to = heat.to || heat.ytd_to;
    return nextEnd >= from && next <= to;
  }, [heat, weekStart]);

  const jumpToThisWeek = useCallback(() => {
    if (!heat) return;
    hapticSelect();
    const today = heat.ytd_to || heat.to || localDateKey(new Date());
    setWeekStart(weekStartOf(today));
    setEventExpanded({});
    scrollGraphToEnd(true);
  }, [heat, scrollGraphToEnd]);

  /** Sunday-start weeks that intersect [from, to], newest first. */
  const weekOptions = useMemo(() => {
    if (!heat) return [] as { start: string; end: string; count: number; isCurrent: boolean }[];
    const from = heat.from || heat.ytd_from;
    const to = heat.to || heat.ytd_to;
    const today = heat.ytd_to || heat.to || localDateKey(new Date());
    const thisWeek = weekStartOf(today);
    const first = weekStartOf(from);
    let cursor = weekStartOf(to);
    // Walk backward so the list reads recent → older
    const out: { start: string; end: string; count: number; isCurrent: boolean }[] = [];
    let guard = 0;
    while (cursor >= first && guard < 80) {
      const end = addDays(cursor, 6);
      if (end >= from && cursor <= to) {
        let count = 0;
        for (let i = 0; i < 7; i++) {
          const d = addDays(cursor, i);
          if (d >= from && d <= to) count += countByDate.get(d) || 0;
        }
        out.push({
          start: cursor,
          end,
          count,
          isCurrent: cursor === thisWeek,
        });
      }
      cursor = addDays(cursor, -7);
      guard++;
    }
    return out;
  }, [heat, countByDate]);

  const pickWeek = useCallback(
    (start: string) => {
      hapticSelect();
      setWeekStart(start);
      setEventExpanded({});
      setWeekPickerOpen(false);
      // Keep heatmap overview scrolled toward recent when picking "this week"
      const today = heat?.ytd_to || heat?.to || localDateKey(new Date());
      if (start === weekStartOf(today)) scrollGraphToEnd(true);
    },
    [heat, scrollGraphToEnd]
  );

  const openWeekPicker = useCallback(() => {
    hapticSelect();
    setWeekPickerOpen(true);
  }, []);

  const putDay = useCallback((date: string, day: ActivityDay) => {
    setDayCache((prev) => {
      const cur = prev[date];
      if (
        cur &&
        cur !== "loading" &&
        cur !== "error" &&
        dayEqual(cur, day)
      ) {
        return prev;
      }
      return { ...prev, [date]: day };
    });
  }, []);

  const loadDay = useCallback(
    async (date: string) => {
      // Memory / disk first — paint cache immediately, revalidate in background
      let cached = getDayMem(scope, date);
      if (!cached) cached = await loadDayCached(scope, date);
      if (cached) {
        putDay(date, cached);
      } else {
        setDayCache((prev) => {
          // Don't clobber a good payload if re-entering mid-fetch
          if (prev[date] && prev[date] !== "loading" && prev[date] !== "error") return prev;
          return { ...prev, [date]: "loading" };
        });
      }

      try {
        if (cloudEnabled && client) {
          try {
            const remote = await client.activityDay(date);
            const day: ActivityDay = {
              date: remote.date,
              count: remote.count,
              events: remote.events as ActivityEvent[],
            };
            putDay(date, day);
            await setDayCached(scope, day);
            return;
          } catch {
            /* fall through to local */
          }
        }
        const notes = await Local.listNotes();
        const day = dayFromNotes(notes, date);
        putDay(date, day);
        await setDayCached(scope, day);
      } catch {
        if (!cached) {
          setDayCache((prev) => ({ ...prev, [date]: "error" }));
        }
      }
    },
    [cloudEnabled, client, scope, putDay]
  );

  const toggleDay = useCallback(
    (date: string) => {
      hapticSelect();
      setDayCollapsed((prev) => {
        const wasCollapsed = prev[date] !== false; // default collapsed
        const nextCollapsed = !wasCollapsed;
        // Opening → load (cache hit is instant; network revalidates)
        if (wasCollapsed) {
          void loadDay(date);
        }
        return { ...prev, [date]: nextCollapsed };
      });
    },
    [loadDay]
  );

  const isDayCollapsed = useCallback(
    (date: string) => dayCollapsed[date] !== false, // default true (collapsed)
    [dayCollapsed]
  );

  const levelColor = useCallback(
    (level: number, out: boolean) => {
      if (out) return "transparent";
      const greens =
        color.paper === "#121211"
          ? ["#1c1b19", "#2a3d31", "#3a5c48", "#4d7a5e", "#6dba86"]
          : ["#e8e7e3", "#c5d4c9", "#8fad97", "#5a8568", "#2a5139"];
      return greens[Math.min(4, Math.max(0, level))] || greens[0];
    },
    [color.paper]
  );

  /** Continuous olive heat for canon rail (0 empty → full green). */
  const canonHeatColor = useCallback(
    (heat: number) => {
      const t = Math.max(0, Math.min(1, heat || 0));
      if (t <= 0) return color.paper === "#121211" ? "#1c1b19" : "#e8e7e3";
      const dark = color.paper === "#121211";
      const greens = dark
        ? ["#2a3d31", "#3a5c48", "#4d7a5e", "#6dba86", "#8fd0a4"]
        : ["#c5d4c9", "#8fad97", "#5a8568", "#3d6b4e", "#2a5139"];
      const idx = Math.min(4, Math.max(0, Math.round(t * 4)));
      return greens[idx]!;
    },
    [color.paper]
  );

  const canonBooks = heat?.canon?.books ?? [];
  const canonSeamT = heat?.canon?.testament_seam_t ?? 929 / 1189;

  const selectedCanon: CanonBook | null = useMemo(() => {
    if (!canonBooks.length) return null;
    if (canonOsis) {
      return canonBooks.find((b) => b.osis === canonOsis) ?? canonBooks[0]!;
    }
    // Prefer hottest book, else first with notes, else Genesis
    let best: CanonBook | null = null;
    let firstWith: CanonBook | null = null;
    for (const b of canonBooks) {
      if (b.notes > 0 && !firstWith) firstWith = b;
      if (b.notes > 0 && (!best || b.heat > best.heat)) best = b;
    }
    return best ?? firstWith ?? canonBooks[0]!;
  }, [canonBooks, canonOsis]);

  const selectCanonFromX = useCallback(
    (locationX: number) => {
      if (!canonRailW || !canonBooks.length) return;
      const t = Math.min(1, Math.max(0, locationX / canonRailW));
      const book = bookAtCanonT(t, canonBooks);
      if (book && book.osis !== canonOsis) {
        hapticSelect();
        setCanonOsis(book.osis);
      }
    },
    [canonBooks, canonOsis, canonRailW]
  );

  const inRange = useCallback(
    (date: string) => {
      if (!heat) return false;
      return date >= heat.from && date <= heat.to;
    },
    [heat]
  );

  const toggleEvent = useCallback((key: string) => {
    hapticSelect();
    setEventExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const todayKey = heat?.ytd_to || heat?.to || localDateKey(new Date());
  const isThisWeek = weekStart === weekStartOf(todayKey);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingHorizontal: space[4],
        paddingTop: space[2],
        paddingBottom: insets.bottom + space[10],
      }}
    >
      {busy && !heat ? (
        <ActivityIndicator style={{ marginTop: space[4] }} color={color.ink} />
      ) : err && !heat ? (
        <View style={{ marginTop: space[2], gap: space[2] }}>
          <Text style={[type.body, { color: color.danger }]}>{err}</Text>
          <Pressable style={ui.secondaryBtn} onPress={() => void loadHeat({ force: true })}>
            <Text style={ui.secondaryBtnTxt}>Retry</Text>
          </Pressable>
        </View>
      ) : heat ? (
        <>
          {err ? (
            <Text style={[type.caption, { color: color.danger, marginBottom: space[2] }]}>
              {err}
            </Text>
          ) : null}

          {/* Compact YTD graph — overview only */}
          <ScrollView
            ref={graphScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.graphScroll}
            contentContainerStyle={styles.graphInner}
            onContentSizeChange={() => scrollGraphToEnd(false)}
            onLayout={() => scrollGraphToEnd(false)}
          >
            <View style={styles.weeks} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {weeks.map((week, wi) => (
                <View key={wi} style={styles.week}>
                  {week.map((cell) => {
                    const out = !inRange(cell.date);
                    const inThisWeek = cell.date >= weekStart && cell.date <= weekEnd;
                    return (
                      <View
                        key={cell.date}
                        style={[
                          styles.cell,
                          {
                            backgroundColor: levelColor(cell.level, out),
                            // Soft dim outside the open week — no border (keeps 11×11 geometry)
                            opacity: out ? 0 : inThisWeek ? 1 : 0.4,
                          },
                        ]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.legend}>
            <Text style={type.caption}>Less</Text>
            {[0, 1, 2, 3, 4].map((lv) => (
              <View
                key={lv}
                style={[styles.cell, { backgroundColor: levelColor(lv, false), marginHorizontal: 1 }]}
              />
            ))}
            <Text style={type.caption}>More</Text>
          </View>

          {/* Canon coverage — book-width rail, heat = note density */}
          {canonBooks.length > 0 ? (
            <View style={styles.canonSection} accessibilityLabel="Canon coverage map">
              <Text style={styles.canonLabel}>Canon map</Text>
              <Text style={[type.caption, styles.canonHint]}>
                {(heat?.canon?.total_notes ?? 0) === 0
                  ? "No notes yet — coverage will warm books as you capture."
                  : `${heat?.canon?.books_with_notes ?? 0} books · ${heat?.canon?.total_notes ?? 0} notes · 1 note/chapter ≈ 90% heat`}
              </Text>
              <Pressable
                onPress={(e) => selectCanonFromX(e.nativeEvent.locationX)}
                onLayout={(e) => setCanonRailW(e.nativeEvent.layout.width)}
                accessibilityRole="adjustable"
                accessibilityLabel="Note coverage by book"
                accessibilityHint="Tap a position on the map to inspect that book."
                accessibilityValue={{ text: selectedCanon?.name ?? "No book selected" }}
                style={[styles.canonRail, { backgroundColor: levelColor(0, false) }]}
                testID="canon-coverage-map"
              >
                <View style={styles.canonRailInner} pointerEvents="none">
                  {canonBooks.map((b) => (
                    <View
                      key={b.osis}
                      style={{
                        flex: Math.max(0.001, b.t1 - b.t0),
                        backgroundColor: b.heat > 0 ? canonHeatColor(b.heat) : "transparent",
                      }}
                    >
                      {selectedCanon?.osis === b.osis ? (
                        <View style={[styles.canonSelection, { backgroundColor: color.ink, borderColor: color.paper }]} />
                      ) : null}
                    </View>
                  ))}
                  <View
                    style={[
                      styles.canonSeam,
                      { left: `${canonSeamT * 100}%`, backgroundColor: color.muted },
                    ]}
                  />
                </View>
              </Pressable>
              <View style={styles.canonEnds}>
                <Text style={styles.canonEndLab}>Genesis</Text>
                <Text style={styles.canonEndLab}>Revelation</Text>
              </View>
              <View style={[styles.canonDetail, { borderColor: color.lineSoft }]}>
                <Text
                  style={[styles.canonDetailName, selectedCanon && selectedCanon.notes === 0 && { color: color.muted }]}
                  testID="canon-map-selected-book"
                >
                  {selectedCanon?.name ?? "Choose a book"}
                </Text>
                <Text style={[type.caption, { color: color.muted }]}>
                  {selectedCanon
                    ? selectedCanon.notes === 0
                      ? `No notes yet · ${selectedCanon.chapters} ch`
                      : `${selectedCanon.notes} note${selectedCanon.notes === 1 ? "" : "s"} · ${selectedCanon.chapters} ch · ${Math.round(selectedCanon.heat * 100)}% heat`
                    : "Tap the map to inspect a book."}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Week navigator + day folders */}
          <View style={styles.weekSection}>
            <View style={styles.weekNav}>
              <Pressable
                onPress={() => shiftWeek(-1)}
                disabled={!canGoPrev}
                accessibilityRole="button"
                accessibilityLabel="Previous week"
                style={({ pressed }) => [
                  styles.weekNavBtn,
                  !canGoPrev && styles.weekNavBtnDisabled,
                  pressed && canGoPrev && { opacity: 0.65 },
                ]}
                hitSlop={8}
              >
                <Chevron direction="left" size={14} color={canGoPrev ? color.muted : color.faint} />
              </Pressable>

              <View style={styles.weekNavCenter}>
                <Pressable
                  onPress={openWeekPicker}
                  accessibilityRole="button"
                  accessibilityLabel={`Week of ${formatWeekRange(weekStart)}. Choose week.`}
                  accessibilityHint="Opens a list of weeks with activity"
                  hitSlop={6}
                  style={({ pressed }) => [styles.weekTitleHit, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.weekTitle} numberOfLines={1}>
                    {formatWeekRange(weekStart)}
                  </Text>
                </Pressable>
                {!isThisWeek ? (
                  <Pressable
                    onPress={jumpToThisWeek}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Jump to this week"
                  >
                    <Text style={styles.weekJump}>This week</Text>
                  </Pressable>
                ) : null}
              </View>

              <Pressable
                onPress={() => shiftWeek(1)}
                disabled={!canGoNext}
                accessibilityRole="button"
                accessibilityLabel="Next week"
                style={({ pressed }) => [
                  styles.weekNavBtn,
                  !canGoNext && styles.weekNavBtnDisabled,
                  pressed && canGoNext && { opacity: 0.65 },
                ]}
                hitSlop={8}
              >
                <Chevron direction="right" size={14} color={canGoNext ? color.muted : color.faint} />
              </Pressable>
            </View>

            {(() => {
              const activeDays = daysInWeek.filter((date) => {
                // Hide empty days entirely (graph still shows the week overview).
                if (!inRange(date)) return false;
                const count = countByDate.get(date) || 0;
                const cached = dayCache[date];
                if (cached && cached !== "loading" && cached !== "error") {
                  return cached.events.length > 0;
                }
                return count > 0;
              });
              if (activeDays.length === 0) {
                return (
                  <Text style={[type.meta, { marginTop: space[2], textAlign: "center" }]}>
                    No activity this week.
                  </Text>
                );
              }
              return activeDays.map((date) => {
              const outside = !inRange(date);
              const count = countByDate.get(date) || 0;
              const collapsed = isDayCollapsed(date);
              const isToday = date === todayKey;
              const cached = dayCache[date];
              const eventCount =
                cached && cached !== "loading" && cached !== "error"
                  ? cached.events.length
                  : count;

              return (
                <View key={date} style={styles.dayBlock}>
                  <Pressable
                    onPress={() => {
                      if (outside) return;
                      toggleDay(date);
                    }}
                    disabled={outside}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !collapsed, disabled: outside }}
                    accessibilityLabel={`${formatDayFolderLabel(date)}, ${eventCount} ${
                      eventCount === 1 ? "change" : "changes"
                    }, ${collapsed ? "collapsed" : "expanded"}`}
                    accessibilityHint={collapsed ? "Expands day" : "Collapses day"}
                    style={({ pressed }) => [
                      styles.dayFolder,
                      isToday && styles.dayFolderToday,
                      !collapsed && styles.dayFolderOpen,
                      outside && styles.dayFolderOutside,
                      pressed && !outside && styles.dayFolderPressed,
                    ]}
                  >
                    <View style={styles.dayFolderText}>
                      <Text
                        style={[
                          styles.dayFolderTitle,
                          outside && { color: color.faint },
                          isToday && { fontWeight: "700" },
                        ]}
                        numberOfLines={1}
                      >
                        {formatDayFolderLabel(date)}
                        {isToday ? " · Today" : ""}
                      </Text>
                    </View>
                    <CountPill
                      label={outside ? "—" : eventCount}
                      variant={collapsed ? "filled" : "ghost"}
                    />
                  </Pressable>

                  {!collapsed && !outside ? (
                    <View style={styles.dayFolderBody}>
                      {cached === "loading" || cached == null ? (
                        <ActivityIndicator color={color.ink} style={{ marginVertical: space[3] }} />
                      ) : cached === "error" ? (
                        <Text style={[type.meta, { marginVertical: space[2] }]}>
                          Couldn’t load this day.
                        </Text>
                      ) : cached.events.length === 0 ? (
                        <Text style={[type.meta, { marginVertical: space[2], marginLeft: space[1] }]}>
                          No changes this day.
                        </Text>
                      ) : (
                        cached.events.map((ev, idx) => {
                          const key = `${date}-${ev.slug}-${ev.at}-${idx}`;
                          return (
                            <EventCard
                              key={key}
                              event={ev}
                              expanded={!!eventExpanded[key]}
                              onToggle={() => toggleEvent(key)}
                              styles={styles}
                              color={color}
                              type={type}
                              ui={ui}
                              onOpenNote={() => {
                                hapticLight();
                                pushOnce(router, `/note/${encodeURIComponent(ev.slug)}`);
                              }}
                            />
                          );
                        })
                      )}
                    </View>
                  ) : null}
                </View>
              );
              });
            })()}
          </View>
          <Modal
            visible={weekPickerOpen}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setWeekPickerOpen(false)}
          >
            <View style={[styles.pickerRoot, { paddingBottom: insets.bottom + space[4] }]}>
              <View style={styles.pickerHead}>
                <Text style={[type.title, styles.pickerTitle]}>Choose week</Text>
                <Pressable
                  onPress={() => setWeekPickerOpen(false)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Close week picker"
                  style={({ pressed }) => [styles.pickerClose, pressed && { opacity: 0.65 }]}
                >
                  <Text style={[type.bodyStrong, { color: color.ink }]}>Done</Text>
                </Pressable>
              </View>
              <ScrollView
                style={styles.pickerList}
                contentContainerStyle={styles.pickerListInner}
                keyboardShouldPersistTaps="handled"
              >
                {weekOptions.map((w) => {
                  const selected = w.start === weekStart;
                  return (
                    <Pressable
                      key={w.start}
                      onPress={() => pickWeek(w.start)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${formatWeekRange(w.start)}${
                        w.isCurrent ? ", this week" : ""
                      }, ${w.count} ${w.count === 1 ? "change" : "changes"}`}
                      style={({ pressed }) => [
                        styles.pickerRow,
                        selected && styles.pickerRowSelected,
                        pressed && styles.pickerRowPressed,
                      ]}
                    >
                      <View style={styles.pickerRowText}>
                        <Text
                          style={[
                            styles.pickerRowTitle,
                            selected && styles.pickerRowTitleSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {formatWeekRange(w.start)}
                        </Text>
                        {w.isCurrent ? (
                          <Text style={[type.caption, { color: color.muted, marginTop: 2 }]}>
                            This week
                          </Text>
                        ) : null}
                      </View>
                      <CountPill
                        label={w.count}
                        variant={selected ? "ghost" : "filled"}
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Modal>
        </>
      ) : null}
    </ScrollView>
  );
}

function EventCard({
  event,
  expanded,
  onToggle,
  styles,
  color,
  type,
  ui,
  onOpenNote,
}: {
  event: ActivityEvent;
  expanded: boolean;
  onToggle: () => void;
  styles: ReturnType<typeof makeStyles>;
  color: ThemeColors;
  type: ReturnType<typeof useTheme>["type"];
  ui: ReturnType<typeof useTheme>["ui"];
  onOpenNote: () => void;
}) {
  const rows: DiffRow[] | null = useMemo(() => {
    if (event.has_diff && event.before_text != null && event.after_text != null) {
      return lineDiff(event.before_text, event.after_text);
    }
    if (event.after_text) {
      return outlineAsRows(event.after_text, event.kind === "created" ? "add" : "eq");
    }
    return null;
  }, [event]);

  const stats = useMemo(() => {
    if (!rows) return { adds: 0, dels: 0, hasChange: false };
    let adds = 0;
    let dels = 0;
    for (const r of rows) {
      if (r.type === "add") adds++;
      else if (r.type === "del") dels++;
    }
    const hasChange = adds + dels > 0 || rows.some((r) => r.type === "eq" && r.text.trim());
    return { adds, dels, hasChange };
  }, [rows]);

  const previewRows = useMemo(() => {
    if (!rows) return null;
    const changes = rows.filter((r) => r.type === "add" || r.type === "del");
    if (changes.length > 0) return changes;
    return rows;
  }, [rows]);

  const canExpand =
    !event.encrypted &&
    (stats.hasChange || !!event.after_text || event.summary === "Note updated");

  const pillLabel =
    stats.adds + stats.dels > 0
      ? stats.adds + stats.dels
      : event.encrypted
        ? "·"
        : event.kind === "created"
          ? "new"
          : previewRows?.length || 1;

  return (
    <View style={[styles.eventCard, expanded && styles.eventCardOpen]}>
      <Pressable
        onPress={canExpand ? onToggle : onOpenNote}
        accessibilityRole="button"
        accessibilityState={{ expanded: canExpand ? expanded : undefined }}
        accessibilityLabel={`${event.label}. ${expanded ? "Collapse" : "Expand"} change details.`}
        style={({ pressed }) => [styles.eventHead, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.eventHeadText}>
          <Text style={[type.body, styles.eventLabel]} numberOfLines={1}>
            {event.label}
          </Text>
          <Text style={type.meta} numberOfLines={2}>
            {formatTime(event.at)}
            {event.summary ? ` · ${event.summary}` : ""}
          </Text>
        </View>
        <CountPill
          label={pillLabel}
          variant={expanded ? "ghost" : "filled"}
          accessibilityElementsHidden={false}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.eventBody}>
          {event.encrypted ? (
            <Text style={type.meta}>Sealed note — content not shown.</Text>
          ) : previewRows && previewRows.length > 0 ? (
            <View style={styles.outlineBox}>
              {previewRows.map((r, i) => (
                <OutlinePreviewRow key={i} row={r} styles={styles} color={color} />
              ))}
            </View>
          ) : (
            <Text style={type.meta}>No outline available.</Text>
          )}

          <Pressable
            style={[ui.secondaryBtn, styles.openBtn]}
            onPress={onOpenNote}
            accessibilityRole="button"
            accessibilityLabel={`Open note ${event.label}`}
          >
            <Text style={ui.secondaryBtnTxt}>Open note</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function diffInks(color: ThemeColors) {
  const isDark = color.paper === "#121211";
  return {
    addInk: isDark ? "#8fd4a4" : "#1a6b38",
    delInk: isDark ? "#f0a0a0" : "#a02828",
  };
}

function OutlinePreviewRow({
  row,
  styles,
  color,
}: {
  row: DiffRow;
  styles: ReturnType<typeof makeStyles>;
  color: ThemeColors;
}) {
  const router = useRouter();
  const isAdd = row.type === "add";
  const isDel = row.type === "del";
  const { addInk, delInk } = diffInks(color);
  // No +/- rail; color + strikethrough carry the meaning.
  const inkColor = isAdd ? addInk : isDel ? delInk : color.ink;
  const dotColor = isAdd ? addInk : isDel ? delInk : color.verseNum;

  return (
    <View
      style={[
        styles.outlineRow,
        isAdd && styles.diffAdd,
        isDel && styles.diffDel,
        row.type === "eq" && styles.diffEq,
      ]}
    >
      <View style={[styles.outlineBody, { paddingLeft: row.indent * OUTLINE_STEP }]}>
        <View style={styles.dotCol}>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        </View>
        <InlineMarkdown
          text={row.text || " "}
          style={[
            styles.outlineText,
            {
              color: inkColor,
              ...(isDel
                ? {
                    textDecorationLine: "line-through" as const,
                    textDecorationColor: delInk,
                  }
                : null),
            },
          ]}
          onWikiPress={(target) => {
            const nav = resolveWikiNav(target);
            if (!nav.ok || !nav.slug) return;
            hapticSelect();
            pushOnce(router, wikiReaderHref(nav.slug));
          }}
        />
      </View>
    </View>
  );
}

function makeStyles(color: ThemeColors) {
  const isDark = color.paper === "#121211";
  const addBg = isDark ? "rgba(61, 140, 90, 0.22)" : "rgba(46, 125, 70, 0.12)";
  const delBg = isDark ? "rgba(200, 70, 70, 0.22)" : "rgba(180, 45, 45, 0.11)";

  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.paper },
    graphScroll: { marginHorizontal: -space[1], marginTop: space[1] },
    graphInner: { paddingVertical: space[1], paddingRight: space[2] },
    weeks: { flexDirection: "row", gap: GAP },
    week: { gap: GAP },
    cell: {
      width: CELL,
      height: CELL,
      borderRadius: 2,
    },
    legend: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: space[1],
      marginBottom: 0,
      opacity: 0.85,
    },
    canonSection: {
      marginTop: space[5],
    },
    canonLabel: {
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: color.faint,
      marginBottom: 4,
    },
    canonHint: {
      marginBottom: space[2],
      opacity: 0.9,
    },
    canonRail: {
      height: 26,
      borderRadius: 6,
      overflow: "hidden",
    },
    canonRailInner: {
      flex: 1,
      flexDirection: "row",
      position: "relative",
    },
    canonSelection: {
      position: "absolute",
      left: "50%",
      top: "15%",
      bottom: "15%",
      width: 3,
      marginLeft: -1.5,
      borderRadius: 1,
      borderWidth: 1,
    },
    canonSeam: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: StyleSheet.hairlineWidth,
      marginLeft: -0.5,
    },
    canonEnds: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 6,
    },
    canonEndLab: {
      fontSize: 10,
      fontWeight: "650" as const,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: color.faint,
    },
    canonDetail: {
      marginTop: space[2],
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: color.fill,
      gap: 2,
    },
    canonDetailName: {
      fontSize: 16,
      fontWeight: "650" as const,
      letterSpacing: -0.2,
      color: color.ink,
    },
    weekSection: {
      // Secondary zone under graph hero (web .activity-week)
      marginTop: space[5],
      paddingTop: space[4],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.lineSoft,
    },
    weekNav: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      marginBottom: space[3] + 2,
    },
    weekNavBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: color.fill,
    },
    weekNavBtnDisabled: { opacity: 0.4 },
    weekNavCenter: {
      flex: 1,
      alignItems: "center",
      minWidth: 0,
      paddingVertical: space[1],
      gap: 2,
    },
    weekTitleHit: {
      alignItems: "center",
      alignSelf: "stretch",
      paddingVertical: 4,
      paddingHorizontal: space[2],
      borderRadius: radius.sm,
    },
    weekTitle: {
      textAlign: "center",
      fontSize: 17,
      fontWeight: "600",
      letterSpacing: -0.3,
      lineHeight: 22,
      color: color.ink,
    },
    weekJump: {
      fontSize: 13,
      fontWeight: "600",
      color: color.link,
      marginTop: 2,
    },
    pickerRoot: {
      flex: 1,
      backgroundColor: color.paper,
    },
    pickerHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: space[4],
      paddingTop: space[4],
      paddingBottom: space[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.lineSoft,
    },
    pickerTitle: { flex: 1 },
    pickerClose: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: space[2],
    },
    pickerList: { flex: 1 },
    pickerListInner: {
      paddingHorizontal: space[4],
      paddingTop: space[2],
      paddingBottom: space[8],
      gap: space[1],
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      paddingVertical: space[3],
      paddingHorizontal: space[3],
      borderRadius: radius.md,
      backgroundColor: color.paperRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.lineSoft,
      minHeight: 52,
    },
    pickerRowSelected: {
      borderColor: color.line,
      backgroundColor: color.fill,
    },
    pickerRowPressed: { opacity: 0.85 },
    pickerRowText: { flex: 1, minWidth: 0 },
    pickerRowTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: color.ink,
    },
    pickerRowTitleSelected: {
      fontWeight: "700",
    },
    dayBlock: {
      marginBottom: space[1],
    },
    dayFolder: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      paddingVertical: space[3],
      paddingHorizontal: space[3],
      borderRadius: radius.md,
      backgroundColor: color.paperRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.lineSoft,
      minHeight: 48,
    },
    dayFolderToday: {
      borderColor: color.line,
    },
    dayFolderOpen: {
      backgroundColor: color.fill,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      borderBottomWidth: 0,
    },
    dayFolderOutside: {
      opacity: 0.45,
    },
    dayFolderPressed: {
      opacity: 0.85,
    },
    dayFolderText: {
      flex: 1,
      minWidth: 0,
    },
    dayFolderTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: color.ink,
    },
    dayFolderBody: {
      paddingTop: space[2],
      paddingBottom: space[1],
      paddingHorizontal: space[1],
      marginBottom: space[2],
      borderWidth: StyleSheet.hairlineWidth,
      borderTopWidth: 0,
      borderColor: color.lineSoft,
      borderBottomLeftRadius: radius.md,
      borderBottomRightRadius: radius.md,
      backgroundColor: color.paper,
    },
    eventCard: {
      backgroundColor: color.paperRaised,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.lineSoft,
      marginBottom: space[2],
      overflow: "hidden",
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.04,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 1 },
        },
        default: {},
      }),
    },
    eventCardOpen: {
      borderColor: color.line,
    },
    eventHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      paddingVertical: space[3],
      paddingHorizontal: space[3],
      minHeight: 52,
    },
    eventHeadText: { flex: 1, minWidth: 0, gap: 2 },
    eventLabel: { fontWeight: "600" },
    eventBody: {
      paddingHorizontal: space[3],
      paddingBottom: space[3],
      gap: space[3],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.lineSoft,
      paddingTop: space[3],
    },
    openBtn: { marginTop: 0 },
    outlineBox: {
      borderRadius: radius.sm,
      overflow: "hidden",
      gap: 2,
    },
    outlineRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: 5,
      paddingHorizontal: space[2],
      borderRadius: radius.sm,
    },
    outlineBody: {
      flex: 1,
      flexDirection: "row",
      alignItems: "flex-start",
      minWidth: 0,
      gap: 8,
    },
    dotCol: {
      width: 14,
      paddingTop: 6,
      alignItems: "center",
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    outlineText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 21,
    },
    diffAdd: { backgroundColor: addBg },
    diffDel: { backgroundColor: delBg },
    diffEq: {},
  });
}
