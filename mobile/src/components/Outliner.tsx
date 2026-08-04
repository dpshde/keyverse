import React, { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { useTheme } from "../context/ThemeContext";

type Props = {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  editable?: boolean;
  /** @deprecated Collapse is disabled — prop ignored for API compat */
  honorCollapse?: boolean;
  onDirty?: () => void;
  /**
   * Compact reader tray: tighter type/indent step; toolbar is nest/unnest only
   * (full editor also gets Add line / Delete line).
   */
  compact?: boolean;
  /**
   * Compact footer trailing control (e.g. “Open full note”) — same row as
   * nest/unnest, not stacked below.
   */
  footerEnd?: ReactNode;
};

type Selection = { start: number; end: number };

/**
 * Flat outline: nest/unnest, multi-line wrap, Enter new row, Backspace merge.
 *
 * Enter must never paint a soft-break inside a bullet (that multi-line height
 * flash is the reader outliner glitch). RN 0.73+ `submitBehavior="submit"`
 * makes Return fire onSubmitEditing without inserting "\n"; we still guard
 * onKeyPress + onChangeText as a safety net for hardware keyboards / older
 * paths. Never remount rows on split — remount was a worse flicker source.
 */
export const Outliner = React.memo(function Outliner({
  blocks,
  onChange,
  editable = true,
  onDirty,
  compact = false,
  footerEnd,
}: Props) {
  const { colors: c } = useTheme();
  const [focusId, setFocusId] = useState<string | null>(blocks[0]?.id ?? null);
  /** Focus a row that is not mounted yet (Enter / Line+). Never used for merge/delete. */
  const wantFocusId = useRef<string | null>(null);
  const pendingSelection = useRef<({ id: string } & Selection) | null>(null);
  const inputRefs = useRef(new Map<string, TextInput>());
  /** Last known selection per block — used for caret after merge without re-focus thrash. */
  const selectionById = useRef(new Map<string, Selection>());
  /** Swallow late "\n" onChangeText after we already split. */
  const suppressNewline = useRef(new Set<string>());
  /** One split at a time (Enter key + submit + changeText can all fire). */
  const splitting = useRef(false);
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

  const updateText = useCallback(
    (id: string, text: string) => {
      const list = blocksRef.current;
      const i = list.findIndex((b) => b.id === id);
      if (i < 0) return;
      if (list[i].text === text) return;
      const next = list.map((b, idx) => (idx === i ? { ...b, text } : b));
      commit(next);
    },
    [commit]
  );

  /**
   * Split one outline row into two at caret (or at first newline if provided).
   * Never remounts the source row — remount was a flicker source.
   */
  const splitRow = useCallback(
    (id: string, rawText?: string) => {
      if (splitting.current) return;
      const list = blocksRef.current;
      const i = list.findIndex((b) => b.id === id);
      if (i < 0) return;
      const cur = list[i];
      const baseText = cur.text || "";

      let first: string;
      let rest: string;
      if (rawText != null && /[\r\n]/.test(rawText)) {
        const nl = rawText.search(/[\r\n]/);
        first = rawText.slice(0, nl);
        rest = rawText.slice(nl).replace(/^[\r\n]+/, "").replace(/[\r\n]/g, "");
      } else {
        const text = rawText != null ? rawText.replace(/[\r\n]/g, "") : baseText;
        const sel = selectionById.current.get(id);
        const start = sel ? Math.min(sel.start, text.length) : text.length;
        const end = sel ? Math.min(Math.max(sel.end, start), text.length) : start;
        first = text.slice(0, start);
        rest = text.slice(end);
      }

      splitting.current = true;
      suppressNewline.current.add(id);

      // Pin native text to first half immediately (no multi-line paint linger).
      const src = inputRefs.current.get(id);
      src?.setNativeProps?.({ text: first });

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

      // Late onChangeText("…\n") from some keyboards; keep suppress briefly.
      setTimeout(() => {
        suppressNewline.current.delete(id);
        splitting.current = false;
      }, 100);
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
      const key = e.nativeEvent.key;

      // Hardware / soft Enter that still delivers a key event.
      // Prefer submitBehavior path; this is backup. preventDefault is best-effort.
      if (key === "Enter") {
        e.preventDefault?.();
        splitRow(id);
        return;
      }

      if (key !== "Backspace") return;
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
    [mergeIntoPrev, splitRow]
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
      if (/[\r\n]/.test(t)) {
        // Already split from submit/key — strip native residue, no second row.
        if (suppressNewline.current.has(id) || splitting.current) {
          const expected =
            blocksRef.current.find((b) => b.id === id)?.text ?? t.replace(/[\r\n]/g, "");
          inputRefs.current.get(id)?.setNativeProps?.({ text: expected });
          return;
        }
        // Soft path that only injected "\n" (no key event).
        splitRow(id, t);
        return;
      }
      updateText(id, t);
    },
    [splitRow, updateText]
  );

  /** Primary Enter path when submitBehavior="submit" — no "\n" ever lands. */
  const onRowSubmit = useCallback(
    (id: string) => {
      splitRow(id);
    },
    [splitRow]
  );

  const fi = focusIndex(blocks, focusId);
  const indentStep = compact ? 12 : 16;
  // Empty-state hint only — not on every blank row after Enter ("Write Write Write…").
  const soloEmpty =
    blocks.length === 1 && !(blocks[0]?.text || "").trim();

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
          placeholder={soloEmpty ? "Write…" : ""}
          onChangeText={onRowChangeText}
          onFocus={onRowFocus}
          onSelectionChange={onSelectionChange}
          onKeyPress={onKeyPress}
          onSubmitEditing={onRowSubmit}
          setRowRef={setRowRef}
        />
      ))}
      {editable ? (
        compact ? (
          // One footer row: nest/unnest left · optional “Open full note” right
          <View style={[styles.toolsCompactRow, { borderTopColor: c.hairline }]}>
            <View style={styles.toolsCluster}>
              <ToolIcon
                symbol="decrease.indent"
                fallback="⇤"
                label="Unnest"
                compact
                onPress={() => indent(fi, -1)}
              />
              <ToolIcon
                symbol="increase.indent"
                fallback="⇥"
                label="Nest"
                compact
                onPress={() => indent(fi, 1)}
              />
            </View>
            {footerEnd ? <View style={styles.footerEnd}>{footerEnd}</View> : null}
          </View>
        ) : (
          <View style={[styles.tools, { borderTopColor: c.hairline }]}>
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
        )
      ) : footerEnd ? (
        <View style={[styles.toolsCompactRow, { borderTopColor: c.hairline }]}>{footerEnd}</View>
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
  /** Empty-state only; omit on multi-row blanks */
  placeholder: string;
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
    placeholder,
    onChangeText,
    onFocus,
    onSelectionChange,
    onKeyPress,
    onSubmitEditing,
    setRowRef,
  }: BlockRowProps) {
    const { colors: c } = useTheme();
    return (
      <View
        style={[styles.row, compact && styles.rowCompact, { paddingLeft: indent * indentStep }]}
      >
        <View style={[styles.dotCol, compact && styles.dotColCompact]}>
          <View style={[styles.dot, { backgroundColor: c.verseNum }]} />
        </View>
        {editable ? (
          <TextInput
            ref={(r) => setRowRef(id, r)}
            style={[styles.input, compact && styles.inputCompact, { color: c.ink }]}
            value={text}
            onChangeText={(t) => onChangeText(id, t)}
            onFocus={() => onFocus(id)}
            onSelectionChange={(e) => onSelectionChange(id, e)}
            multiline
            // Return inserts a new outline row — never a soft line break inside the bullet.
            // (RN 0.73+; without this, multiline paints "…\n" for one frame = the flicker.)
            submitBehavior="submit"
            blurOnSubmit={false}
            onSubmitEditing={() => onSubmitEditing(id)}
            onKeyPress={(e) => onKeyPress(id, e)}
            placeholder={placeholder}
            placeholderTextColor={c.faint}
            autoCorrect
            scrollEnabled={false}
            showSoftInputOnFocus
            textAlignVertical="top"
          />
        ) : (
          <Text style={[styles.viewTxt, { color: c.inkSoft }]}>{text || " "}</Text>
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
    prev.editable === next.editable &&
    prev.placeholder === next.placeholder
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
  compact = false,
}: {
  symbol: string;
  fallback: string;
  label: string;
  onPress: () => void;
  compact?: boolean;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        onPress();
      }}
      style={({ pressed }) => [
        styles.toolIcon,
        compact && styles.toolIconCompact,
        pressed && { backgroundColor: c.pressFill },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
    >
      <SymbolView
        name={symbol as any}
        size={compact ? 17 : 18}
        weight="semibold"
        tintColor={c.inkSoft}
        // Same optical lift as header glyphs — SF Symbols sit low in the hit box
        style={styles.toolGlyph}
        fallback={<Text style={[styles.toolFallback, { color: c.inkSoft }]}>{fallback}</Text>}
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
    transform: [{ translateY: -1 }],
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    padding: 0,
    margin: 0,
  } as TextStyle,
  inputCompact: {
    fontSize: 17,
    lineHeight: 24,
    minWidth: 0,
  } as TextStyle,
  viewTxt: { flex: 1, fontSize: 15, lineHeight: 22 },
  tools: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 6,
    paddingBottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  /** Compact tray: nest/unnest + trailing action on ONE row */
  toolsCompactRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
    paddingTop: 4,
    paddingBottom: 0,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolsCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
  footerEnd: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  toolIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  toolIconCompact: {
    width: 40,
    height: 40,
  },
  toolGlyph: {
    transform: [{ translateY: -1 }],
  },
  toolFallback: {
    fontSize: 16,
    fontWeight: "600",
  },
});
