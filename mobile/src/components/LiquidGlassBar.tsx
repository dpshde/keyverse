import { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space } from "../theme";
import { LiquidGlassShell } from "./LiquidGlassShell";

type Props = {
  children: ReactNode;
  /** Extra bottom padding beyond safe area when bar is visible */
  bottomGutter?: number;
  /** Tighter capsule for secondary chrome (e.g. reader chapter nav) */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Floating liquid-glass dock — shared BlurView material with PassageSelector.
 */
export function LiquidGlassBar({
  children,
  bottomGutter = space[3],
  compact = false,
  style,
  contentStyle,
}: Props) {
  const insets = useSafeAreaInsets();
  const padBottom = Math.max(insets.bottom, compact ? space[2] : bottomGutter);
  const r = compact ? 20 : 28;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: padBottom }, style]}>
      <LiquidGlassShell borderRadius={r} compact={compact}>
        <View style={[styles.inner, compact && styles.innerCompact, contentStyle]}>
          {children}
        </View>
      </LiquidGlassShell>
    </View>
  );
}

/** Approximate bar height for list padding (compact | default) */
export function liquidGlassBarListPad(bottomInset: number, compact = false): number {
  const body = compact ? 40 : 56;
  const gutter = Math.max(bottomInset, compact ? space[2] : space[3]);
  return body + gutter + space[2];
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space[3],
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    gap: space[2],
    padding: space[2],
    minHeight: 48 + space[2] * 2,
  },
  innerCompact: {
    gap: space[1],
    padding: space[1],
    minHeight: 36 + space[1] * 2,
  },
});
