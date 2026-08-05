import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { WikiSuggestItem } from "../lib/wikiLink";
import { useTheme } from "../context/ThemeContext";
import { radius, space } from "../theme";
import { hapticSelect } from "../lib/haptics";

type Props = {
  items: WikiSuggestItem[];
  onPick: (item: WikiSuggestItem) => void;
};

/** Cap height so the active outliner line stays on screen; scroll for the rest. */
const MAX_LIST_HEIGHT = 3.5 * 44 + space[1];

/**
 * Compact list for [[ autocomplete inside an outline row.
 * Renders *below* the active line (parent places it); scrollable under keyboard.
 */
export function WikiLinkSuggest({ items, onPick }: Props) {
  const { colors: c } = useTheme();
  if (!items.length) return null;
  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: c.fill,
          borderColor: c.hairline,
          maxHeight: MAX_LIST_HEIGHT,
        },
      ]}
      accessibilityRole="list"
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        nestedScrollEnabled
        bounces={items.length > 3}
        showsVerticalScrollIndicator={items.length > 3}
        style={styles.scroll}
      >
        {items.map((item, i) => (
          <Pressable
            key={`${item.kind}:${item.slug}:${i}`}
            onPress={() => {
              hapticSelect();
              onPick(item);
            }}
            style={({ pressed }) => [
              styles.row,
              i > 0 && {
                borderTopColor: c.hairline,
                borderTopWidth: StyleSheet.hairlineWidth,
              },
              pressed && { backgroundColor: c.pressFill },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}${item.kind === "note" ? ", note" : ", passage"}`}
          >
            <View style={styles.main}>
              <Text style={[styles.label, { color: c.ink }]} numberOfLines={1}>
                {item.label}
              </Text>
              {item.detail ? (
                <Text style={[styles.detail, { color: c.muted }]} numberOfLines={1}>
                  {item.detail}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.kind, { color: c.faint }]}>
              {item.kind === "note" ? "note" : "ref"}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    // Below the active line — small gap from the caret row
    marginTop: space[1],
    marginBottom: space[1],
  },
  scroll: {
    maxHeight: MAX_LIST_HEIGHT,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[3],
    paddingVertical: space[2] + 2,
    gap: space[2],
    minHeight: 44,
  },
  main: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 12, lineHeight: 16 },
  kind: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 },
});
