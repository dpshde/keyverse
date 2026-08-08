import React, { useCallback, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { Attachment, Block, Note } from "../api/types";
import { hydrateBlocks } from "../api/client";
import { useTheme } from "../context/ThemeContext";
import { resolveWikiNav, wikiReaderHref } from "../lib/wikiLink";
import { pushOnce } from "../lib/nav";
import { hapticSelect } from "../lib/haptics";
import { InlineNoteEditor } from "./InlineNoteEditor";
import { hasNonEmptyOutline, OutlinePreview } from "./OutlinePreview";
import { radius, space } from "../theme";

export type VerseRowData = {
  v: number;
  text: string;
  verseSlug: string;
  heading?: string;
};

export type RangeNoteHit = {
  slug: string;
  note: Note;
  label: string;
  lo: number;
  hi: number;
};

type Props = {
  item: VerseRowData;
  note: Note | undefined;
  blocks: Block[] | undefined;
  rangeNotes: RangeNoteHit[];
  /** Left rail when closed */
  showRail: boolean;
  railStrong: boolean;
  opened: boolean;
  /** Expand-all preview only (not a full editor) */
  expandPreview: boolean;
  selected: boolean;
  selFirst: boolean;
  selLast: boolean;
  showPendingRange: boolean;
  rangeOnlyTray: boolean;
  pendingRange: { slug: string; label: string; lo: number; endV: number } | null;
  notesBySlug: Record<string, Note>;
  resolvedBlocks: Record<string, Block[]>;
  onPressVerse: (v: number) => void;
  onLongPressVerse: (v: number) => void;
  onNoteSaved: (slug: string, res: Note | { deleted: true; slug: string }) => void;
  onBlocksLive: (slug: string, blocks: Block[]) => void;
  setVerseRef: (v: number, node: View | null) => void;
};

/**
 * Single reader verse — memoized so typing in one tray does not re-render peers.
 */
export const VerseRowItem = React.memo(function VerseRowItem({
  item,
  note,
  blocks,
  rangeNotes,
  showRail,
  railStrong,
  opened,
  expandPreview,
  selected,
  selFirst,
  selLast,
  showPendingRange,
  rangeOnlyTray,
  pendingRange,
  notesBySlug,
  resolvedBlocks,
  onPressVerse,
  onLongPressVerse,
  onNoteSaved,
  onBlocksLive,
  setVerseRef,
}: Props) {
  const { colors: c, type } = useTheme();
  const router = useRouter();
  const verseLocked = !!(note?.encrypted && !blocks?.length);

  const onPress = useCallback(() => onPressVerse(item.v), [onPressVerse, item.v]);
  const onLongPress = useCallback(() => onLongPressVerse(item.v), [onLongPressVerse, item.v]);
  const setRef = useCallback(
    (n: View | null) => setVerseRef(item.v, n),
    [setVerseRef, item.v]
  );
  /** Wiki/http link taps must not also open the full editor (nested in Pressable). */
  const absorbCardPress = useRef(false);
  const onInteractiveInPreview = useCallback(() => {
    absorbCardPress.current = true;
  }, []);
  const onPreviewCardPress = useCallback(() => {
    if (absorbCardPress.current) {
      absorbCardPress.current = false;
      return;
    }
    onPress();
  }, [onPress]);
  const onWikiPress = useCallback(
    (target: string) => {
      const nav = resolveWikiNav(target);
      if (!nav.ok || !nav.slug) return;
      hapticSelect();
      pushOnce(router, wikiReaderHref(nav.slug));
    },
    [router]
  );

  const versePreviewBlocks =
    expandPreview && !verseLocked
      ? blocks && blocks.length
        ? blocks
        : note && !note.encrypted
          ? hydrateBlocks(note)
          : []
      : [];

  const railOpacity = railStrong ? 0.55 : 0.22;

  return (
    <View
      ref={setRef}
      style={[
        styles.verse,
        selected && styles.verseInPassage,
        selected && selFirst && styles.verseInPassageFirst,
        selected && selLast && styles.verseInPassageLast,
        showRail && { borderLeftColor: withAlpha(c.ink, railOpacity) },
      ]}
      collapsable={false}
      accessibilityState={{ selected: !!selected }}
    >
      <View
        style={[
          selected && [styles.verseSel, { backgroundColor: c.sel }],
          selected && selFirst && styles.verseSelFirst,
          selected && selLast && styles.verseSelLast,
        ]}
      >
        {item.heading ? (
          <Text
            style={[
              styles.sectionHead,
              { color: c.muted },
              item.v > 1 && styles.sectionHeadSpaced,
            ]}
            accessibilityRole="header"
          >
            {item.heading}
          </Text>
        ) : null}
        <Pressable
          style={styles.versePress}
          delayLongPress={320}
          onPress={onPress}
          onLongPress={onLongPress}
        >
          <Text style={[styles.vnum, type.verseNum]}>{item.v}</Text>
          <Text style={[styles.vtext, type.verse]}>{item.text}</Text>
        </Pressable>
      </View>

      {opened ? (
        <View style={[styles.noteTray, selected && styles.noteTrayAfterSel]}>
          {expandPreview ? (
            <Pressable
              onPress={onPreviewCardPress}
              style={[styles.previewCard, { backgroundColor: c.fill }]}
              accessibilityRole="button"
              accessibilityLabel={`Open note for verse ${item.v}`}
            >
              <ExpandAllPreview
                verseBlocks={versePreviewBlocks}
                verseEncrypted={!!note?.encrypted && !versePreviewBlocks.length}
                rangeNotes={rangeNotes}
                resolvedBlocks={resolvedBlocks}
                inkSoft={c.inkSoft}
                muted={c.muted}
                faint={c.faint}
                verseNum={c.verseNum}
                onWikiPress={onWikiPress}
                onInteractivePress={onInteractiveInPreview}
              />
              <Text style={[styles.previewHint, { color: c.faint }]}>Tap to edit</Text>
            </Pressable>
          ) : (
            <>
              {!rangeOnlyTray ? (
                <InlineNoteEditor
                  slug={item.verseSlug}
                  revision={note?.updated_at || ""}
                  initialBlocks={
                    verseLocked
                      ? undefined
                      : blocks && blocks.length
                        ? blocks
                        : emptyBlocks()
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
              pendingRange &&
              !rangeNotes.some((r) => r.slug === pendingRange.slug) ? (
                <InlineNoteEditor
                  slug={pendingRange.slug}
                  label={pendingRange.label}
                  revision={
                    notesBySlug[pendingRange.slug]?.updated_at || pendingRange.slug
                  }
                  initialBlocks={
                    resolvedBlocks[pendingRange.slug] || emptyBlocks()
                  }
                  onSaved={(res) => onNoteSaved(pendingRange.slug, res)}
                  onBlocksLive={(b) => onBlocksLive(pendingRange.slug, b)}
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}, verseRowPropsEqual);

function verseRowPropsEqual(a: Props, b: Props): boolean {
  if (a.item.v !== b.item.v) return false;
  if (a.item.text !== b.item.text) return false;
  if (a.item.heading !== b.item.heading) return false;
  if (a.showRail !== b.showRail || a.railStrong !== b.railStrong) return false;
  if (a.opened !== b.opened || a.expandPreview !== b.expandPreview) return false;
  if (a.selected !== b.selected || a.selFirst !== b.selFirst || a.selLast !== b.selLast)
    return false;
  if (a.rangeOnlyTray !== b.rangeOnlyTray || a.showPendingRange !== b.showPendingRange)
    return false;
  if (a.note?.updated_at !== b.note?.updated_at) return false;
  if (a.note?.encrypted !== b.note?.encrypted) return false;
  if ((a.blocks?.length || 0) !== (b.blocks?.length || 0)) return false;
  // Open editor seed + expand-all preview both need live block content
  if (a.blocks !== b.blocks && a.opened) {
    if (a.blocks && b.blocks && !blocksShallowEqual(a.blocks, b.blocks)) return false;
    if (!a.blocks || !b.blocks) return false;
  }
  if (a.rangeNotes.length !== b.rangeNotes.length) return false;
  for (let i = 0; i < a.rangeNotes.length; i++) {
    if (
      a.rangeNotes[i].slug !== b.rangeNotes[i].slug ||
      a.rangeNotes[i].note.updated_at !== b.rangeNotes[i].note.updated_at
    ) {
      return false;
    }
  }
  if (a.pendingRange?.slug !== b.pendingRange?.slug) return false;
  // Stable callbacks assumed from parent
  return true;
}

function blocksShallowEqual(a: Block[], b: Block[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text || (a[i].indent | 0) !== (b[i].indent | 0))
      return false;
  }
  return true;
}

function emptyBlocks(): Block[] {
  return [{ id: "b_new", indent: 0, text: "" }];
}

function ExpandAllPreview({
  verseBlocks,
  verseEncrypted,
  rangeNotes,
  resolvedBlocks,
  inkSoft,
  muted,
  faint,
  verseNum,
  onWikiPress,
  onInteractivePress,
}: {
  verseBlocks: Block[];
  verseEncrypted: boolean;
  rangeNotes: RangeNoteHit[];
  resolvedBlocks: Record<string, Block[]>;
  inkSoft: string;
  muted: string;
  faint: string;
  verseNum: string;
  onWikiPress: (target: string) => void;
  onInteractivePress?: () => void;
}) {
  const verseHas = hasNonEmptyOutline(verseBlocks);
  const rangePreviews = rangeNotes.map((rn) => {
    const rBlocks =
      resolvedBlocks[rn.slug] ||
      (rn.note.encrypted ? [] : hydrateBlocks(rn.note));
    return {
      slug: rn.slug,
      label: rn.label,
      blocks: rBlocks,
      encrypted: !!(rn.note.encrypted && !hasNonEmptyOutline(rBlocks)),
    };
  });
  const anyRange = rangePreviews.some(
    (r) => r.encrypted || hasNonEmptyOutline(r.blocks)
  );

  if (!verseHas && !verseEncrypted && !anyRange) {
    return <Text style={[styles.previewMuted, { color: muted }]}>Empty note</Text>;
  }

  return (
    <View style={styles.previewStack}>
      {verseEncrypted ? (
        <Text style={[styles.previewMuted, { color: muted }]}>Encrypted note</Text>
      ) : verseHas ? (
        <OutlinePreview
          blocks={verseBlocks}
          ink={inkSoft}
          dotColor={verseNum}
          onWikiPress={onWikiPress}
          onInteractivePress={onInteractivePress}
        />
      ) : null}
      {rangePreviews.map((r) => (
        <View key={r.slug} style={styles.rangePreview}>
          <Text style={[styles.rangeLabel, { color: faint }]} numberOfLines={1}>
            {r.label}
          </Text>
          {r.encrypted ? (
            <Text style={[styles.previewMuted, { color: muted }]}>Encrypted note</Text>
          ) : hasNonEmptyOutline(r.blocks) ? (
            <OutlinePreview
              blocks={r.blocks}
              ink={inkSoft}
              dotColor={verseNum}
              onWikiPress={onWikiPress}
              onInteractivePress={onInteractivePress}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Apply alpha to #rrggbb or return color unchanged for rgba. */
function withAlpha(hexOrRgba: string, alpha: number): string {
  if (hexOrRgba.startsWith("#") && hexOrRgba.length === 7) {
    const r = parseInt(hexOrRgba.slice(1, 3), 16);
    const g = parseInt(hexOrRgba.slice(3, 5), 16);
    const b = parseInt(hexOrRgba.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hexOrRgba;
}

const styles = StyleSheet.create({
  verse: {
    paddingVertical: space[2],
    paddingLeft: 10,
    paddingRight: 2,
    borderLeftWidth: 2,
    borderLeftColor: "transparent",
  },
  verseInPassage: {
    paddingVertical: 0,
  },
  verseInPassageFirst: {
    paddingTop: space[2],
  },
  verseInPassageLast: {
    paddingBottom: space[2],
  },
  verseSel: {
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
  versePress: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  sectionHead: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: space[2],
  },
  sectionHeadSpaced: {
    marginTop: space[3],
  },
  vnum: {
    marginRight: 10,
    minWidth: 18,
    textAlign: "right",
    paddingTop: 4,
  },
  vtext: {
    flex: 1,
  },
  noteTray: {
    marginTop: space[2],
    marginHorizontal: -space[1],
  },
  noteTrayAfterSel: {
    marginTop: space[3],
  },
  previewCard: {
    marginTop: space[1],
    padding: space[3],
    borderRadius: radius.md,
    gap: 6,
  },
  previewStack: {
    gap: 8,
  },
  previewMuted: {
    fontSize: 14,
  },
  previewHint: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  rangePreview: {
    gap: 2,
  },
  rangeLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginBottom: 2,
  },
});
