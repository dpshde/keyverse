import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  dayFromNotes,
  formatDayLabel,
  formatTime,
  formatYtdLead,
  heatmapFromNotes,
  lineDiff,
  outlineAsRows,
  weeksFromHeatmap,
  type ActivityDay,
  type ActivityEvent,
  type ActivityHeatmap,
  type DiffRow,
  type HeatCell,
} from "@/src/lib/activity";
import { CountPill } from "@/src/components/CountPill";
import { InlineMarkdown } from "@/src/lib/inlineMarkdown";
import { radius, space, type ThemeColors } from "@/src/theme";
import { hapticLight, hapticSelect } from "@/src/lib/haptics";
import { pushOnce } from "@/src/lib/nav";

/** Indent step matches Outliner compact tray (~18px). */
const OUTLINE_STEP = 16;

const CELL = 11;
const GAP = 3;

export default function ActivityScreen() {
  const { color, type, ui } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { cloudEnabled, client } = useSession();

  const [heat, setHeat] = useState<ActivityHeatmap | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [day, setDay] = useState<ActivityDay | null>(null);
  const [busy, setBusy] = useState(true);
  const [dayBusy, setDayBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Which event cards are expanded (collapsed by default). */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Horizontal graph: latest weeks are on the right. */
  const graphScrollRef = useRef<ScrollView>(null);

  const scrollGraphToEnd = useCallback((animated = false) => {
    // rAF helps after layout; contentSizeChange is the reliable path.
    requestAnimationFrame(() => {
      graphScrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const loadLocalHeat = useCallback(async () => {
    const notes = await Local.listNotes();
    setHeat(heatmapFromNotes(notes));
  }, []);

  const loadHeat = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      // Prefer door GET /api/activity (ops/) when sync is on.
      if (cloudEnabled && client) {
        try {
          // Door default is YTD (Jan 1 → today) when host supports it
          const remote = await client.activityHeatmap();
          setHeat({
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
          });
          return;
        } catch (e) {
          // Production may not ship /api/activity yet → 404 "not found".
          // Fall back to on-device stamps and explain (don't blank the screen).
          const status = (e as { status?: number })?.status;
          const msg = String((e as { message?: string })?.message || e);
          await loadLocalHeat();
          setErr(
            status === 404 || /not found|HTTP 404/i.test(msg)
              ? "Door activity API isn’t on this host yet — showing on-device note stamps."
              : `Couldn’t reach activity on your key (${msg}). Showing on-device note stamps.`
          );
          return;
        }
      }
      // Sync off: device has no ops/ — note stamps only.
      await loadLocalHeat();
    } catch (e) {
      setHeat(null);
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [cloudEnabled, client, loadLocalHeat]);

  useEffect(() => {
    loadHeat();
  }, [loadHeat]);

  const openDay = useCallback(
    async (date: string) => {
      hapticSelect();
      setSelected(date);
      setExpanded({}); // collapse all when switching day
      setDayBusy(true);
      setDay(null);
      try {
        if (cloudEnabled && client) {
          try {
            const remote = await client.activityDay(date);
            setDay({
              date: remote.date,
              count: remote.count,
              events: remote.events as ActivityEvent[],
            });
            return;
          } catch {
            /* host without day API — local stamps */
          }
        }
        const notes = await Local.listNotes();
        setDay(dayFromNotes(notes, date));
      } catch (e) {
        setDay(null);
        setErr(String(e));
      } finally {
        setDayBusy(false);
      }
    },
    [cloudEnabled, client]
  );

  // Open today once the YTD graph loads; pin graph to the right (today).
  useEffect(() => {
    if (!heat || selected) return;
    const today = heat.ytd_to || heat.to;
    if (today) openDay(today);
    scrollGraphToEnd(false);
  }, [heat, selected, openDay, scrollGraphToEnd]);

  const weeks = useMemo(() => (heat ? weeksFromHeatmap(heat.days) : []), [heat]);

  // Re-pin when week columns re-layout (e.g. after heat swap local ↔ remote)
  useEffect(() => {
    if (!weeks.length) return;
    scrollGraphToEnd(false);
  }, [weeks.length, heat?.to, scrollGraphToEnd]);

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

  const inRange = useCallback(
    (date: string) => {
      if (!heat) return false;
      return date >= heat.from && date <= heat.to;
    },
    [heat]
  );

  const toggleEvent = useCallback((key: string) => {
    hapticSelect();
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

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
          <Pressable style={ui.secondaryBtn} onPress={() => void loadHeat()}>
            <Text style={ui.secondaryBtnTxt}>Retry</Text>
          </Pressable>
        </View>
      ) : heat ? (
        <>
          <Text style={[type.meta, styles.lead]}>{formatYtdLead(heat)}</Text>
          {err ? (
            <Text style={[type.caption, { color: color.danger, marginBottom: space[2] }]}>
              {err}
            </Text>
          ) : null}

          <ScrollView
            ref={graphScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.graphScroll}
            contentContainerStyle={styles.graphInner}
            onContentSizeChange={() => scrollGraphToEnd(false)}
            onLayout={() => scrollGraphToEnd(false)}
          >
            <View style={styles.weeks}>
              {weeks.map((week, wi) => (
                <View key={wi} style={styles.week}>
                  {week.map((cell) => {
                    const out = !inRange(cell.date);
                    const sel = selected === cell.date;
                    return (
                      <Pressable
                        key={cell.date}
                        disabled={out}
                        onPress={() => openDay(cell.date)}
                        accessibilityLabel={`${cell.date}: ${cell.count} changes`}
                        style={[
                          styles.cell,
                          {
                            backgroundColor: levelColor(cell.level, out),
                            opacity: out ? 0 : 1,
                            borderWidth: sel ? 2 : 0,
                            borderColor: color.ink,
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

          {selected ? (
            <View style={styles.daySection}>
              <Text style={[type.section, styles.dayTitle]}>{formatDayLabel(selected)}</Text>
              {dayBusy ? (
                <ActivityIndicator color={color.ink} style={{ marginTop: space[3] }} />
              ) : !day || day.events.length === 0 ? (
                <Text style={[type.meta, { marginTop: space[2] }]}>No changes this day.</Text>
              ) : (
                day.events.map((ev, idx) => {
                  const key = `${ev.slug}-${ev.at}-${idx}`;
                  return (
                    <EventCard
                      key={key}
                      event={ev}
                      expanded={!!expanded[key]}
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
    // Created / snapshot: preview the outline itself as structure
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
    // Pure snapshot (all eq) still has content to preview
    const hasChange = adds + dels > 0 || rows.some((r) => r.type === "eq" && r.text.trim());
    return { adds, dels, hasChange };
  }, [rows]);

  /** Prefer change lines when a real diff exists; else full outline snapshot. */
  const previewRows = useMemo(() => {
    if (!rows) return null;
    const changes = rows.filter((r) => r.type === "add" || r.type === "del");
    if (changes.length > 0) return changes;
    return rows;
  }, [rows]);

  const canExpand =
    !event.encrypted &&
    (stats.hasChange || !!event.after_text || event.summary === "Note updated");

  /** Same trailing CountPill language as home folders: filled = packed, ghost = open. */
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

/** One outliner-style line: optional +/− rail, bullet, indented body. */
function OutlinePreviewRow({
  row,
  styles,
  color,
}: {
  row: DiffRow;
  styles: ReturnType<typeof makeStyles>;
  color: ThemeColors;
}) {
  const isAdd = row.type === "add";
  const isDel = row.type === "del";
  const { addInk, delInk } = diffInks(color);
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
      {isAdd || isDel ? (
        <Text
          style={[
            styles.diffMark,
            { color: inkColor },
          ]}
        >
          {isAdd ? "+" : "−"}
        </Text>
      ) : (
        <View style={styles.diffMarkSpacer} />
      )}
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
                ? { textDecorationLine: "line-through" as const, textDecorationColor: delInk }
                : null),
            },
          ]}
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
    lead: { marginBottom: space[2] },
    graphScroll: { marginHorizontal: -space[1] },
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
      marginTop: space[3],
      marginBottom: space[2],
    },
    daySection: {
      marginTop: space[5],
      paddingTop: space[4],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.lineSoft,
    },
    dayTitle: { marginBottom: space[3] },
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
      minHeight: 56,
    },
    eventHeadText: { flex: 1, minWidth: 0, gap: 2, paddingRight: space[2] },
    eventLabel: { fontWeight: "600" },
    eventBody: {
      paddingHorizontal: space[3],
      paddingBottom: space[3],
      gap: space[3],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.lineSoft,
      paddingTop: space[3],
    },
    outlineBox: {
      borderRadius: radius.sm,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.lineSoft,
      backgroundColor: color.paper,
    },
    outlineRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: 5,
      paddingRight: space[2],
      paddingLeft: space[1],
      minHeight: 28,
    },
    outlineBody: {
      flex: 1,
      flexDirection: "row",
      alignItems: "flex-start",
      minWidth: 0,
    },
    dotCol: {
      width: 16,
      height: 22,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      transform: [{ translateY: -1 }],
    },
    outlineText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 22,
      color: color.ink,
    },
    diffAdd: { backgroundColor: addBg },
    diffDel: { backgroundColor: delBg },
    diffEq: { backgroundColor: "transparent" },
    diffMark: {
      width: 18,
      fontSize: 14,
      fontWeight: "700",
      color: color.muted,
      lineHeight: 22,
      textAlign: "center",
      flexShrink: 0,
    },
    diffMarkSpacer: {
      width: 18,
      flexShrink: 0,
    },
    openBtn: {
      marginTop: space[1],
    },
  });
}
