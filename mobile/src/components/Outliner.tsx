import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  honorCollapse?: boolean;
  onDirty?: () => void;
};

/** Full outliner: nest/unnest/fold, multi-line edit, Enter new line, Backspace merge. */
export function Outliner({
  blocks,
  onChange,
  editable = true,
  honorCollapse = true,
  onDirty,
}: Props) {
  const [focusId, setFocusId] = useState<string | null>(blocks[0]?.id ?? null);
  const emit = useCallback(
    (next: Block[]) => {
      onChange(clampIndents(next));
      onDirty?.();
    },
    [onChange, onDirty]
  );

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

  const hasKids = (i: number) =>
    i + 1 < blocks.length && (blocks[i + 1].indent | 0) > (blocks[i].indent | 0);

  const updateAt = (i: number, patch: Partial<Block>) => {
    emit(blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };

  const indent = (i: number, dir: 1 | -1) => {
    if (i < 0 || i >= blocks.length) return;
    let ind = (blocks[i].indent | 0) + dir;
    if (ind < 0) ind = 0;
    if (i === 0) ind = 0;
    else ind = Math.min(ind, (blocks[i - 1].indent | 0) + 1);
    emit(blocks.map((row, idx) => (idx === i ? { ...row, indent: ind } : row)));
  };

  const addAfter = (i: number) => {
    const base = blocks[i]?.indent | 0;
    const nb: Block = { id: newBlockId(), indent: base, text: "" };
    const next = [...blocks.slice(0, i + 1), nb, ...blocks.slice(i + 1)];
    emit(next);
    setFocusId(nb.id);
  };

  const removeAt = (i: number) => {
    if (blocks.length <= 1) {
      const nb = { id: newBlockId(), indent: 0, text: "" };
      emit([nb]);
      setFocusId(nb.id);
      return;
    }
    const next = blocks.filter((_, idx) => idx !== i);
    emit(next);
    setFocusId(next[Math.max(0, i - 1)]?.id ?? null);
  };

  const mergeIntoPrev = (i: number) => {
    if (i <= 0) return;
    const prev = blocks[i - 1];
    const cur = blocks[i];
    const merged = {
      ...prev,
      text: (prev.text || "") + (cur.text || ""),
    };
    const next = [...blocks.slice(0, i - 1), merged, ...blocks.slice(i + 1)];
    emit(next);
    setFocusId(merged.id);
  };

  const toggleCollapse = (i: number) => {
    if (!hasKids(i)) return;
    updateAt(i, { collapsed: !blocks[i].collapsed });
  };

  const fi = focusIndex(blocks, focusId);

  return (
    <View style={styles.wrap}>
      {visible.map(({ b, i }) => {
        const depth = b.indent | 0;
        const kids = hasKids(i);
        return (
          <View key={b.id} style={[styles.row, { paddingLeft: 4 + depth * 16 }]}>
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
              <View style={[styles.dot, kids && b.collapsed && styles.dotCollapsed]} />
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
                onKeyPress={(e) => {
                  if (e.nativeEvent.key === "Backspace" && !(b.text || "").length) {
                    e.preventDefault?.();
                    mergeIntoPrev(i);
                  }
                }}
                placeholder="Write…"
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
          <Tool label="Unnest" onPress={() => indent(fi, -1)} />
          <Tool label="Nest" onPress={() => indent(fi, 1)} />
          <Tool label="Fold" onPress={() => toggleCollapse(fi)} />
          <Tool label="Line+" onPress={() => addAfter(fi)} />
          <Tool label="Del" onPress={() => removeAt(fi)} />
        </View>
      ) : null}
    </View>
  );
}

function clampIndents(blocks: Block[]): Block[] {
  return blocks.map((b, i) => {
    let ind = Math.max(0, b.indent | 0);
    if (i === 0) ind = 0;
    else ind = Math.min(ind, (blocks[i - 1].indent | 0) + 1);
    const kids =
      i + 1 < blocks.length && (blocks[i + 1].indent | 0) > ind;
    return {
      ...b,
      indent: ind,
      collapsed: kids ? !!b.collapsed : false,
    };
  });
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
    paddingVertical: 3,
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
  dotCollapsed: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.35)",
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
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.12)",
  },
  toolBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.06)",
    minHeight: 44,
    justifyContent: "center",
  },
  toolLbl: { fontSize: 13, fontWeight: "600", color: "#333" },
});
