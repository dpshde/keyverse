import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useTheme } from "../context/ThemeContext";

type Props = {
  onPress: () => void;
  accessibilityLabel: string;
  /** SF Symbol name — ignored when `icon` is provided */
  symbol?: string;
  /** Custom glyph (e.g. Phosphor SVG). Receives resolved ink color. */
  icon?: (color: string) => ReactNode;
  /** Glyph point size — default 20 (SF) / 22 (SVG box) */
  size?: number;
  weight?: "regular" | "medium" | "semibold" | "bold";
  tint?: string;
  /** Dim inactive chrome (e.g. expand when off) */
  muted?: boolean;
  /** Active / filled state for the control */
  active?: boolean;
  /** Non-interactive (e.g. expand-all with no notes on the page) */
  disabled?: boolean;
  fallback?: string;
  style?: ViewStyle;
  hitSlop?: number;
};

/**
 * Nav-bar icon in liquid-glass circles / pills.
 * SF Symbols sit low relative to geometric center — we center in a fixed
 * glyph box and lift slightly for optical balance with the title baseline.
 */
export function HeaderIconButton({
  symbol,
  icon,
  onPress,
  accessibilityLabel,
  size = 18,
  weight = "semibold",
  tint,
  muted,
  active,
  disabled = false,
  fallback = "·",
  style,
  hitSlop = 6,
}: Props) {
  const { colors } = useTheme();
  const ink =
    tint ??
    (disabled
      ? colors.faint
      : muted && !active
        ? colors.inkSoft
        : colors.ink);
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        active && !disabled && styles.btnActive,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        disabled: !!disabled,
        ...(active != null ? { selected: !!active && !disabled } : null),
      }}
    >
      <View style={styles.glyphBox} pointerEvents="none">
        {icon ? (
          <View style={styles.svgWrap}>{icon(ink)}</View>
        ) : (
          <SymbolView
            name={(symbol || "circle") as SFSymbol}
            size={size}
            weight={weight}
            tintColor={ink}
            style={styles.glyph}
            fallback={<Text style={[styles.fallback, { color: ink }]}>{fallback}</Text>}
          />
        )}
      </View>
    </Pressable>
  );
}

const GLYPH = 20;

const styles = StyleSheet.create({
  btn: {
    // Compact header chrome — still ≥36pt hit target
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  btnActive: {
    opacity: 1,
  },
  btnDisabled: {
    opacity: 0.32,
  },
  pressed: {
    opacity: 0.45,
  },
  /**
   * Fixed box so SymbolView’s intrinsic bounds don’t shift layout.
   * translateY lifts the mark into optical center of the glass control
   * (SF Symbols bias low; -2 reads balanced next to the title).
   */
  glyphBox: {
    width: GLYPH,
    height: GLYPH,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    transform: [{ translateY: -2 }],
  },
  svgWrap: {
    // SVGs are geometrically centered; slight lift matches SF optical nudge
    transform: [{ translateY: -1 }],
  },
  fallback: {
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
    marginTop: -2,
  },
});
