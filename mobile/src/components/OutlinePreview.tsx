import React from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import type { Block } from "../api/types";
import { InlineMarkdown } from "../lib/inlineMarkdown";
import { useTheme } from "../context/ThemeContext";

/** Compact outliner step — matches Outliner `compact` mode. */
export const OUTLINE_PREVIEW_INDENT_STEP = 12;
/** Soft cap so list previews stay scannable. */
export const OUTLINE_PREVIEW_MAX_BLOCKS = 12;

export function nonEmptyOutlineBlocks(
  blocks: Block[],
  max = OUTLINE_PREVIEW_MAX_BLOCKS
): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (!(b.text || "").trim()) continue;
    out.push(b);
    if (out.length >= max) break;
  }
  return out;
}

export function hasNonEmptyOutline(blocks: Block[] | null | undefined): boolean {
  if (!blocks?.length) return false;
  for (const b of blocks) {
    if ((b.text || "").trim()) return true;
  }
  return false;
}

type Props = {
  blocks: Block[];
  /** Cap non-empty rows (default 12). */
  maxBlocks?: number;
  /** Ink for body text; defaults to theme inkSoft. */
  ink?: string;
  /** Bullet color; defaults to theme verseNum. */
  dotColor?: string;
  onWikiPress?: (target: string) => void;
  /**
   * Fired when the user taps a wiki/http link (before navigation).
   * Use to suppress an outer Pressable (card open / open editor).
   */
  onInteractivePress?: () => void;
  /** Optional body text style override (size/lineHeight/font). */
  textStyle?: TextStyle;
};

/**
 * Read-only outline rows — same visual language as the outliner
 * (bullet + indent). Block text is PROTOCOL §4.0 inline markdown.
 */
export function OutlinePreview({
  blocks,
  maxBlocks = OUTLINE_PREVIEW_MAX_BLOCKS,
  ink,
  dotColor,
  onWikiPress,
  onInteractivePress,
  textStyle,
}: Props) {
  const { colors: c } = useTheme();
  const bodyInk = ink ?? c.inkSoft;
  const bullet = dotColor ?? c.verseNum;
  const rows = nonEmptyOutlineBlocks(blocks, maxBlocks);
  if (!rows.length) return null;

  let nonEmptyCount = 0;
  for (const b of blocks) {
    if ((b.text || "").trim()) nonEmptyCount++;
  }
  const truncated = nonEmptyCount > maxBlocks;

  return (
    <View style={styles.box}>
      {rows.map((b) => (
        <View
          key={b.id}
          style={[
            styles.row,
            { paddingLeft: (b.indent | 0) * OUTLINE_PREVIEW_INDENT_STEP },
          ]}
        >
          <View style={styles.dotCol}>
            <View style={[styles.dot, { backgroundColor: bullet }]} />
          </View>
          <View style={styles.txtWrap}>
            <InlineMarkdown
              text={b.text || " "}
              style={[styles.txt, { color: bodyInk }, textStyle]}
              onWikiPress={onWikiPress}
              onInteractivePress={onInteractivePress}
            />
          </View>
        </View>
      ))}
      {truncated ? (
        <Text style={[styles.ellipsis, { color: bodyInk }]} numberOfLines={1}>
          …
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 28,
    paddingVertical: 3,
  },
  /** Match Outliner compact: 18-wide rail + 4 margin. */
  dotCol: {
    width: 18,
    height: 24,
    marginRight: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    transform: [{ translateY: -1 }],
  },
  txtWrap: {
    flex: 1,
    minWidth: 0,
  },
  txt: {
    fontSize: 15,
    lineHeight: 22,
  },
  ellipsis: {
    fontSize: 15,
    lineHeight: 22,
    paddingLeft: 22,
  },
});
