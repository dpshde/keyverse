import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from "react-native";
import type { Block } from "../api/types";
import { newBlockId } from "../api/client";

type Props = {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  editable?: boolean;
  /** When false, collapse is ignored (show all) — reader tray style */
  honorCollapse?: boolean;
};

export function Outliner({ blocks, onChange, editable = true, honorCollapse = true }: Props) {
  const [focusId, setFocusId] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (!honorCollapse) return blocks.map((b, i) => ({ b, i }));
    const hidden = new Set<number>();
    for (let i = 0; i < blocks.length; i++) {
      if (!blocks[i].collapsed) continue;
      const base = blocks[i].indent | 0;
      for (let j = i + 1; j < blocks.length; j++) {
        if ((blocks[j].indent | 0) <= base) break;
        hidden.add(j);
      }
    }
    return blocks.map((b, i) => ({ b, i })).filter(({ i }) => !hidden.has(i));
  }, [blocks, honorCollapse]);

  const updateAt = useCallback(
    (i: number, patch: Partial<Block>) => {
      const next = blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
      onChange(next);
    },
    [blocks, onChange]
  );

  const hasKids = (i: number) =>
    i + 1 < blocks.length && (blocks[i + 1].indent | 0) > (blocks[i].indent | 0);

  const indent = (i: number, dir: 1 | -1) => {
    const b = blocks[i];
    if (!b) return;
    let ind = (b.indent | 0) + dir;
    if (ind < 0) ind = 0;
    if (i === 0) ind = 0;
    else ind = Math.min(ind, (blocks[i - 1].indent | 0) + 1);
    const next = blocks.map((row, idx) => (idx === i ? { ...row, indent: ind } : row));
    // clamp chain
    for (let k = 1; k < next.length; k++) {
      next[k] = {
        ...next[k],
        indent: Math.min(next[k].indent | 0, (next[k - 1].indent | 0) + 1),
      };
    }
    onChange(next);
  };

  const addAfter = (i: number) => {
    const base = blocks[i]?.indent | 0;
    const nb: Block = { id: newBlockId(), indent: base, text: "" };
    const next = [...blocks.slice(0, i + 1), nb, ...blocks.slice(i + 1)];
    onChange(next);
    setFocusId(nb.id);
  };

  const removeAt = (i: number) => {
    if (blocks.length <= 1) {
      onChange([{ id: newBlockId(), indent: 0, text: "" }]);
      return;
    }
    onChange(blocks.filter((_, idx) => idx !== i));
  };

  const toggleCollapse = (i: number) => {
    if (!hasKids(i)) return;
    updateAt(i, { collapsed: !blocks[i].collapsed });
  };

  return (
    <View style={styles.wrap}>
      {visible.map(({ b, i }) => {
        const depth = b.indent | 0;
        const kids = hasKids(i);
        return (
          <View key={b.id} style={[styles.row, { paddingLeft: 8 + depth * 16 }]}>
            {editable && honorCollapse ? (
              <Pressable
                onPress={() => toggleCollapse(i)}
                style={styles.chev}
                hitSlop={8}
                disabled={!kids}
              >
                <Text style={[styles.chevTxt, !kids && styles.chevHidden]}>
                  {kids ? (b.collapsed ? "▸" : "▾") : " "}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.chev} />
            )}
            <View style={styles.dotCol}>
              <View style={styles.dot} />
            </View>
            {editable ? (
              <TextInput
                style={styles.input}
                value={b.text}
                onChangeText={(t) => updateAt(i, { text: t.replace(/\n/g, " ") })}
                onFocus={() => setFocusId(b.id)}
                multiline
                blurOnSubmit
                onSubmitEditing={() => addAfter(i)}
                placeholder="…"
                placeholderTextColor="#999"
                autoCorrect
              />
            ) : (
              <Text style={styles.viewTxt}>{b.text || " "}</Text>
            )}
          </View>
        );
      })}
      {editable ? (
        <View style={styles.tools}>
          <Tool
            label="Nest"
            onPress={() => {
              const i = focusIndex(blocks, focusId);
              indent(i, 1);
            }}
          />
          <Tool
            label="Unnest"
            onPress={() => {
              const i = focusIndex(blocks, focusId);
              indent(i, -1);
            }}
          />
          <Tool
            label="Fold"
            onPress={() => {
              const i = focusIndex(blocks, focusId);
              toggleCollapse(i);
            }}
          />
          <Tool
            label="Line+"
            onPress={() => {
              const i = focusIndex(blocks, focusId);
              addAfter(i);
            }}
          />
          <Tool
            label="Del"
            onPress={() => {
              const i = focusIndex(blocks, focusId);
              removeAt(i);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function focusIndex(blocks: Block[], id: string | null): number {
  if (!id) return Math.max(0, blocks.length - 1);
  const i = blocks.findIndex((b) => b.id === id);
  return i < 0 ? 0 : i;
}

function Tool({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.toolBtn}>
      <Text style={styles.toolLbl}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 28,
    paddingVertical: 2,
  },
  chev: { width: 18, height: 22, alignItems: "center", justifyContent: "center" },
  chevTxt: { fontSize: 12, color: "#666" },
  chevHidden: { opacity: 0 },
  dotCol: {
    width: 16,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(0,0,0,0.28)",
    transform: [{ translateY: -1 }],
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    padding: 0,
    margin: 0,
    color: "#111",
  } as TextStyle,
  viewTxt: { flex: 1, fontSize: 15, lineHeight: 22, color: "#333" },
  tools: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.12)",
  },
  toolBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  toolLbl: { fontSize: 13, fontWeight: "600", color: "#333" },
});
