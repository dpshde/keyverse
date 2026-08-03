import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { SymbolView } from "expo-symbols";
import type { Block } from "../api/types";
import { newBlockId } from "../api/client";
import { hapticLight, hapticSelect } from "../lib/haptics";
import { color } from "../theme";

type Props = {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  editable?: boolean;
  /** @deprecated Collapse is disabled — prop ignored for API compat */
  honorCollapse?: boolean;
  onDirty?: () => void;
  /** Hide Nest/Unnest toolbar — for mini inline reader trays */
  compact?: boolean;
};

type Selection = { start: number; end: number };

/**
 * Flat outline: nest/unnest, multi-line edit, Enter new line, Backspace merge.
 * Newline path is optimized to avoid keyboard bounce / list remount stutter.
 */
export const Outliner = React.memo(function Outliner({
  blocks,
  onChange,
  editable = true,
  onDirty,
  compact = false,
}: Props) {
  const [focusId, setFocusId] = useState<string | null>(blocks[0]?.id ?? null);
  /** Focus a row that is not mounted yet (Enter / Line+). Never used for merge/delete. */
  const wantFocusId = useRef<string | null>(null);
  const pendingSelection = useRef<({ id: string } & Selection) | null>(null);
  const inputRefs = useRef(new Map<string, TextInput>());
  /** Last known selection per block — used for caret after merge without re-focus thrash. */
  const selectionById = useRef(new Map<string, Selection>());
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;

  const commit = useCallback((next: Block[], opts?: { dirty?: boolean }) => {
    const clamped = clampIndents(next);
    blocksRef.current = clamped;
    onChangeRef.current(clamped);
    if (opts?.dirty !== false) {
      // Defer dirty so focus/layout can settle before parent schedules save work.
      queueMicrotask(() => onDirtyRef.current?.());
    }
  }, []);

  /** Focus a not-yet-mounted row after React commits it (new line only). */
  const requestFocusNew = useCallback((id: string, selection?: Selection) => {
    wantFocusId.current = id;
    if (selection) pendingSelection.current = { id, ...selection };
    setFocusId(id);
  }, []);

  /**
   * Move keyboard to an already-mounted row BEFORE removing the current one.
   * Calling focus() on a surviving input first prevents dismiss → reopen flicker.
   */
  const focusExisting = useCallback((id: string, selection?: Selection) => {
    wantFocusId.current = null;
    const input = inputRefs.current.get(id);
    if (input) {
      input.focus();
      if (selection) {
        selectionById.current.set(id, selection);
        requestAnimationFrame(() => {
          input.setNativeProps?.({ selection });
        });
      }
    } else if (selection) {
      pendingSelection.current = { id, ...selection };
      wantFocusId.current = id;
    }
    setFocusId(id);
  }, []);

  // Only for brand-new rows (Enter) — existing rows use focusExisting.
  useLayoutEffect(() => {
    const id = wantFocusId.current;
    if (!id) return;
    if (!blocks.some((b) => b.id === id)) return;

    let cancelled = false;
    const tryFocus = (attempt: number) => {
      if (cancelled) return;
      const input = inputRefs.current.get(id);
      if (input) {
        if (typeof (input as any).isFocused === "function" && (input as any).isFocused()) {
          const sel = pendingSelection.current;
          if (sel && sel.id === id) {
            input.setNativeProps?.({ selection: { start: sel.start, end: sel.end } });
            pendingSelection.current = null;
          }
          wantFocusId.current = null;
          return;
        }
        input.focus();
        const sel = pendingSelection.current;
        if (sel && sel.id === id) {
          input.setNativeProps?.({ selection: { start: sel.start, end: sel.end } });
          pendingSelection.current = null;
        }
        wantFocusId.current = null;
        return;
      }
      if (attempt < 8) requestAnimationFrame(() => tryFocus(attempt + 1));
    };
    tryFocus(0);
    return () => {
      cancelled = true;
    };
  }, [blocks, focusId]);

  const updateText = useCallback((id: string, text: string) => {
    const list = blocksRef.current;
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) return;
    if (list[i].text === text) return;
    const next = list.map((b, idx) => (idx === i ? { ...b, text } : b));
    commit(next);
  }, [commit]);

  const splitAtNewline = useCallback(
    (id: string, text: string) => {
      const list = blocksRef.current;
      const i = list.findIndex((b) => b.id === id);
      if (i < 0) return;
      const cur = list[i];
      const nl = text.indexOf("\n");
      const first = nl >= 0 ? text.slice(0, nl) : text;
      const rest = nl >= 0 ? text.slice(nl + 1).replace(/\n/g, "") : "";

      // Strip the native newline immediately so the controlled value doesn't flash "…\n".
      const input = inputRefs.current.get(id);
      input?.setNativeProps?.({ text: first });

      const base = cur.indent | 0;
      const nb: Block = { id: newBlockId(), indent: base, text: rest };
      const next = [
        ...list.slice(0, i),
        { ...cur, text: first },
        nb,
        ...list.slice(i + 1),
      ];
      commit(next);
      requestFocusNew(nb.id, { start: rest.length, end: rest.length });
    },
    [commit, requestFocusNew]
  );

  const indent = useCallback(
    (i: number, dir: 1 | -1) => {
      const list = blocksRef.current;
      if (i < 0 || i >= list.length) return;
      let ind = (list[i].indent | 0) + dir;
      if (ind < 0) ind = 0;
      if (i === 0) ind = 0;
      else ind = Math.min(ind, (list[i - 1].indent | 0) + 1);
      commit(list.map((row, idx) => (idx === i ? { ...row, indent: ind } : row)));
    },
    [commit]
  );

  const addAfter = useCallback(
    (i: number) => {
      hapticSelect();
      const list = blocksRef.current;
      const base = list[i]?.indent | 0;
      const nb: Block = { id: newBlockId(), indent: base, text: "" };
      const next = [...list.slice(0, i + 1), nb, ...list.slice(i + 1)];
      commit(next);
      requestFocusNew(nb.id, { start: 0, end: 0 });
    },
    [commit, requestFocusNew]
  );

  const removeAt = useCallback(
    (i: number) => {
      const list = blocksRef.current;
      if (list.length <= 1) {
        const only = list[0];
        if (!only) return;
        commit([{ ...only, text: "", indent: 0, collapsed: false }]);
        focusExisting(only.id, { start: 0, end: 0 });
        return;
      }
      const target = list[Math.max(0, i - 1)];
      const len = (target.text || "").length;
      focusExisting(target.id, { start: len, end: len });
      commit(list.filter((_, idx) => idx !== i));
    },
    [commit, focusExisting]
  );

  const mergeIntoPrev = useCallback(
    (i: number) => {
      if (i <= 0) return;
      const list = blocksRef.current;
      const prev = list[i - 1];
      const cur = list[i];
      if (!prev || !cur) return;
      hapticLight();
      const prevText = prev.text || "";
      const curText = cur.text || "";
      const caret = prevText.length;
      const merged = { ...prev, text: prevText + curText };

      // Native-side update before React re-render so merge feels instant.
      inputRefs.current.get(prev.id)?.setNativeProps?.({
        text: merged.text,
        selection: { start: caret, end: caret },
      });

      focusExisting(prev.id, { start: caret, end: caret });
      commit([...list.slice(0, i - 1), merged, ...list.slice(i + 1)]);
    },
    [commit, focusExisting]
  );

  const onKeyPress = useCallback(
    (id: string, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (e.nativeEvent.key !== "Backspace") return;
      const list = blocksRef.current;
      const i = list.findIndex((b) => b.id === id);
      if (i < 0) return;
      const b = list[i];
      if (!(b.text || "").length) {
        e.preventDefault?.();
        if (i > 0) mergeIntoPrev(i);
        return;
      }
      const sel = selectionById.current.get(b.id);
      if (i > 0 && sel && sel.start === 0 && sel.end === 0) {
        e.preventDefault?.();
        mergeIntoPrev(i);
      }
    },
    [mergeIntoPrev]
  );

  const onSelectionChange = useCallback(
    (id: string, e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionById.current.set(id, e.nativeEvent.selection);
    },
    []
  );

  const setRowRef = useCallback((id: string, r: TextInput | null) => {
    if (r) inputRefs.current.set(id, r);
    else inputRefs.current.delete(id);
  }, []);

  const onRowFocus = useCallback((id: string) => {
    setFocusId(id);
  }, []);

  const onRowChangeText = useCallback(
    (id: string, t: string) => {
      if (t.includes("\n")) {
        splitAtNewline(id, t);
        return;
      }
      updateText(id, t);
    },
    [splitAtNewline, updateText]
  );

  const onRowSubmit = useCallback(
    (id: string) => {
      const i = blocksRef.current.findIndex((b) => b.id === id);
      if (i >= 0) addAfter(i);
    },
    [addAfter]
  );

  const fi = focusIndex(blocks, focusId);
  const indentStep = compact ? 12 : 16;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {blocks.map((b) => (
        <BlockRow
          key={b.id}
          id={b.id}
          text={b.text || ""}
          indent={b.indent | 0}
          indentStep={indentStep}
          compact={compact}
          editable={editable}
          onChangeText={onRowChangeText}
          onFocus={onRowFocus}
          onSelectionChange={onSelectionChange}
          onKeyPress={onKeyPress}
          onSubmitEditing={onRowSubmit}
          setRowRef={setRowRef}
        />
      ))}
      {editable && !compact ? (
        <View style={styles.tools}>
          <ToolIcon
            symbol="decrease.indent"
            fallback="⇤"
            label="Unnest"
            onPress={() => indent(fi, -1)}
          />
          <ToolIcon
            symbol="increase.indent"
            fallback="⇥"
            label="Nest"
            onPress={() => indent(fi, 1)}
          />
          <ToolIcon
            symbol="plus"
            fallback="+"
            label="Add line"
            onPress={() => addAfter(fi)}
          />
          <ToolIcon
            symbol="trash"
            fallback="⌫"
            label="Delete line"
            onPress={() => removeAt(fi)}
          />
        </View>
      ) : null}
    </View>
  );
});

type BlockRowProps = {
  id: string;
  text: string;
  indent: number;
  indentStep: number;
  compact: boolean;
  editable: boolean;
  onChangeText: (id: string, t: string) => void;
  onFocus: (id: string) => void;
  onSelectionChange: (
    id: string,
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>
  ) => void;
  onKeyPress: (id: string, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
  onSubmitEditing: (id: string) => void;
  setRowRef: (id: string, r: TextInput | null) => void;
};

const BlockRow = React.memo(
  function BlockRow({
    id,
    text,
    indent,
    indentStep,
    compact,
    editable,
    onChangeText,
    onFocus,
    onSelectionChange,
    onKeyPress,
    onSubmitEditing,
    setRowRef,
  }: BlockRowProps) {
    return (
      <View
        style={[styles.row, compact && styles.rowCompact, { paddingLeft: indent * indentStep }]}
      >
        <View style={[styles.dotCol, compact && styles.dotColCompact]}>
          <View style={styles.dot} />
        </View>
        {editable ? (
          <TextInput
            ref={(r) => setRowRef(id, r)}
            style={[styles.input, compact && styles.inputCompact]}
            value={text}
            onChangeText={(t) => onChangeText(id, t)}
            onFocus={() => onFocus(id)}
            onSelectionChange={(e) => onSelectionChange(id, e)}
            multiline
            blurOnSubmit={false}
            onSubmitEditing={() => onSubmitEditing(id)}
            onKeyPress={(e) => onKeyPress(id, e)}
            placeholder="Write…"
            placeholderTextColor="#999"
            autoCorrect
            scrollEnabled={false}
            showSoftInputOnFocus
            textAlignVertical="top"
          />
        ) : (
          <Text style={styles.viewTxt}>{text || " "}</Text>
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.id === next.id &&
    prev.text === next.text &&
    prev.indent === next.indent &&
    prev.indentStep === next.indentStep &&
    prev.compact === next.compact &&
    prev.editable === next.editable
);

function clampIndents(blocks: Block[]): Block[] {
  return blocks.map((b, i) => {
    let ind = Math.max(0, b.indent | 0);
    if (i === 0) ind = 0;
    else ind = Math.min(ind, (blocks[i - 1].indent | 0) + 1);
    return {
      ...b,
      indent: ind,
      collapsed: false,
    };
  });
}

function focusIndex(blocks: Block[], id: string | null): number {
  if (!id) return Math.max(0, blocks.length - 1);
  const i = blocks.findIndex((b) => b.id === id);
  return i < 0 ? 0 : i;
}

function ToolIcon({
  symbol,
  fallback,
  label,
  onPress,
}: {
  symbol: string;
  fallback: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        onPress();
      }}
      style={({ pressed }) => [styles.toolIcon, pressed && styles.toolIconPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
    >
      <SymbolView
        name={symbol as any}
        size={18}
        weight="semibold"
        tintColor={color.inkSoft}
        fallback={<Text style={styles.toolFallback}>{fallback}</Text>}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  wrapCompact: { gap: 4, width: "100%" },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 28,
    paddingVertical: 3,
  },
  rowCompact: {
    minHeight: 32,
    paddingVertical: 4,
  },
  dotCol: {
    width: 16,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  dotColCompact: {
    width: 18,
    height: 24,
    marginRight: 4,
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
  inputCompact: {
    fontSize: 17,
    lineHeight: 24,
    minWidth: 0,
  } as TextStyle,
  viewTxt: { flex: 1, fontSize: 15, lineHeight: 22, color: "#333" },
  tools: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 6,
    paddingBottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.1)",
  },
  toolIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  toolIconPressed: {
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  toolFallback: {
    fontSize: 16,
    fontWeight: "600",
    color: color.inkSoft,
  },
});
