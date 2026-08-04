import React, { useMemo } from "react";
import { Linking, StyleSheet, Text, type TextStyle } from "react-native";

/**
 * Render base inline markdown (PROTOCOL §4.0) — markers stay in storage.
 * Flat (non-nested) forms only.
 */
export const InlineMarkdown = React.memo(function InlineMarkdown({
  text,
  style,
}: {
  text: string;
  style?: TextStyle | TextStyle[];
}) {
  const nodes = useMemo(() => parseInline(text || ""), [text]);
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
        if (n.type === "link")
          return (
            <Text
              key={i}
              style={styles.link}
              onPress={() => {
                if (n.href?.startsWith("http")) Linking.openURL(n.href).catch(() => {});
              }}
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
  | { type: "link"; value: string; href: string };

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
    while (j < src.length && !"`*[~_".includes(src[j])) j++;
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
  link: { textDecorationLine: "underline" },
});
