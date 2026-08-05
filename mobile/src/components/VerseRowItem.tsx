import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { Attachment, Block, Note } from "../api/types";
import { hydrateBlocks } from "../api/client";
import { useTheme } from "../context/ThemeContext";
import { InlineMarkdown } from "../lib/inlineMarkdown";
import { resolveWikiNav, wikiReaderHref } from "../lib/wikiLink";
import { pushOnce } from "../lib/nav";
import { hapticSelect } from "../lib/haptics";
import { InlineNoteEditor } from "./InlineNoteEditor";
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
  const onWikiPress = useCallback(
    (target: string) => {
      const nav = resolveWikiNav(target);
      if (!nav.ok || !nav.slug) return;
      hapticSelect();
      pushOnce(router, wikiReaderHref(nav.slug));
    },
    [router]
  );

  const previewText = expandPreview
    ? previewFromBlocks(blocks || (note && !note.encrypted ? hydrateBlocks(note) : []))
    : "";

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
              onPress={onPress}
              style={[styles.previewCard, { backgroundColor: c.fill }]}
              accessibilityRole="button"
              accessibilityLabel={`Open note for verse ${item.v}`}
            >
              {previewText ? (
                <InlineMarkdown
                  text={previewText}
                  style={[styles.previewTxt, { color: c.inkSoft }]}
                  onWikiPress={onWikiPress}
                />
              ) : note?.encrypted ? (
                <Text style={[styles.previewMuted, { color: c.muted }]}>Encrypted note</Text>
              ) : (
                <Text style={[styles.previewMuted, { color: c.muted }]}>Empty note</Text>
              )}
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
  // blocks identity for open editor seed; live typing does not update parent blocks
  if (a.blocks !== b.blocks && a.opened && !a.expandPreview) {
    // allow if only this row is open and blocks ref equal content — skip deep compare
    if (a.blocks && b.blocks && !blocksShallowEqual(a.blocks, b.blocks)) return false;
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

function previewFromBlocks(blocks: Block[]): string {
  const parts: string[] = [];
  let len = 0;
  for (const b of blocks) {
    const t = (b.text || "").trim();
    if (!t) continue;
    // +1 for the newline separator between lines
    const next = len + t.length + (parts.length ? 1 : 0);
    if (parts.length && next > 200) break;
    parts.push(t);
    len = next;
    if (len >= 200) break;
  }
  const s = parts.join("\n");
  return s.length > 200 ? s.slice(0, 197) + "…" : s;
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
    gap: 4,
  },
  previewTxt: {
    fontSize: 15,
    lineHeight: 22,
  },
  previewMuted: {
    fontSize: 14,
  },
  previewHint: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
});
