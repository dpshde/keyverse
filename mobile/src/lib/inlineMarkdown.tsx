import React, { useMemo } from "react";
import {
  Linking,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import { wikiDisplayLabel, parseWikiInner } from "./wikiLink";

/**
 * Render base inline markdown (PROTOCOL §4.0) — markers stay in storage.
 * Flat (non-nested) forms only. Wiki [[target]] / [[target|label]] supported.
 */
export const InlineMarkdown = React.memo(function InlineMarkdown({
  text,
  style,
  onWikiPress,
  onInteractivePress,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Wiki cross-ref tap — parent navigates to reader */
  onWikiPress?: (target: string) => void;
  /**
   * Fired when the user taps a wiki or http link (before navigation).
   * Use to suppress an outer Pressable that would otherwise open the editor.
   */
  onInteractivePress?: () => void;
}) {
  const { colors: c } = useTheme();
  const nodes = useMemo(() => parseInline(text || ""), [text]);
  const linkStyle = useMemo(
    () => [styles.link, { color: c.link, textDecorationColor: c.link }],
    [c.link]
  );

  // Fast path: no markers — single Text (no nested tree)
  if (nodes.length === 1 && nodes[0].type === "text") {
    return <Text style={style}>{nodes[0].value}</Text>;
  }
  return (
    <Text style={style}>
      {nodes.map((n, i) => {
        if (n.type === "text") return <Text key={i}>{n.value}</Text>;
        if (n.type === "code")
          return (
            <Text key={i} style={styles.code}>
              {n.value}
            </Text>
          );
        if (n.type === "strong")
          return (
            <Text key={i} style={styles.strong}>
              {n.value}
            </Text>
          );
        if (n.type === "em")
          return (
            <Text key={i} style={styles.em}>
              {n.value}
            </Text>
          );
        if (n.type === "strike")
          return (
            <Text key={i} style={styles.strike}>
              {n.value}
            </Text>
          );
        if (n.type === "wiki")
          return (
            <Text
              key={i}
              style={linkStyle}
              onPress={() => {
                onInteractivePress?.();
                if (onWikiPress) onWikiPress(n.target);
              }}
              accessibilityRole="link"
              accessibilityLabel={`Open ${n.value}`}
            >
              {n.value}
            </Text>
          );
        if (n.type === "link")
          return (
            <Text
              key={i}
              style={linkStyle}
              onPress={() => {
                onInteractivePress?.();
                if (n.href?.startsWith("http")) Linking.openURL(n.href).catch(() => {});
              }}
              accessibilityRole="link"
              accessibilityLabel={n.value}
            >
              {n.value}
            </Text>
          );
        return null;
      })}
    </Text>
  );
});

type Node =
  | { type: "text"; value: string }
  | { type: "code" | "strong" | "em" | "strike"; value: string }
  | { type: "link"; value: string; href: string }
  | { type: "wiki"; value: string; target: string };

function parseInline(src: string): Node[] {
  const out: Node[] = [];
  let i = 0;
  const pushText = (t: string) => {
    if (!t) return;
    out.push({ type: "text", value: t });
  };
  while (i < src.length) {
    // code
    if (src[i] === "`") {
      const j = src.indexOf("`", i + 1);
      if (j > i) {
        out.push({ type: "code", value: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    // embeds ![[…]] — leave as text for now (attachment UX is separate)
    if (src.startsWith("![[", i)) {
      const j = src.indexOf("]]", i + 3);
      if (j > i) {
        pushText(src.slice(i, j + 2));
        i = j + 2;
        continue;
      }
    }
    // wiki [[target]] or [[target|label]]
    if (src.startsWith("[[", i)) {
      const j = src.indexOf("]]", i + 2);
      if (j > i) {
        const inner = src.slice(i + 2, j);
        if (!inner.includes("\n")) {
          const { target, label } = parseWikiInner(inner);
          if (target) {
            out.push({
              type: "wiki",
              target,
              value: wikiDisplayLabel(target, label),
            });
            i = j + 2;
            continue;
          }
        }
      }
    }
    // link [label](https://...)
    if (src[i] === "[") {
      const m = /^\[([^\]]*)\]\((https?:[^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        out.push({ type: "link", value: m[1] || m[2], href: m[2] });
        i += m[0].length;
        continue;
      }
    }
    // bold **
    if (src.startsWith("**", i)) {
      const j = src.indexOf("**", i + 2);
      if (j > i) {
        out.push({ type: "strong", value: src.slice(i + 2, j) });
        i = j + 2;
        continue;
      }
    }
    // strike ~~
    if (src.startsWith("~~", i)) {
      const j = src.indexOf("~~", i + 2);
      if (j > i) {
        out.push({ type: "strike", value: src.slice(i + 2, j) });
        i = j + 2;
        continue;
      }
    }
    // italic * or _ (not snake_case)
    if (src[i] === "*" && src[i + 1] !== "*") {
      const j = src.indexOf("*", i + 1);
      if (j > i) {
        out.push({ type: "em", value: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (src[i] === "_" && src[i + 1] !== "_" && !/[A-Za-z0-9]/.test(src[i - 1] || "")) {
      const j = src.indexOf("_", i + 1);
      if (j > i && !/[A-Za-z0-9]/.test(src[j + 1] || "")) {
        out.push({ type: "em", value: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    // plain run until next special
    let j = i + 1;
    while (j < src.length && !"`*[~_!".includes(src[j])) j++;
    // also break before `[[` so wiki is found
    if (src[j] === "[" && src[j + 1] === "[") {
      /* stop before wiki */
    } else if (src[j] === "!" && src[j + 1] === "[" && src[j + 2] === "[") {
      /* stop before embed */
    }
    pushText(src.slice(i, j));
    i = j;
  }
  return out;
}

const styles = StyleSheet.create({
  code: {
    fontFamily: "SpaceMono",
    fontSize: 13,
    backgroundColor: "rgba(127,127,127,0.12)",
  },
  strong: { fontWeight: "700" },
  em: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through", opacity: 0.85 },
  link: {
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
