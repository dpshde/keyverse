import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { color } from "../theme";

type Props = {
  symbol: string;
  onPress: () => void;
  accessibilityLabel: string;
  /** Glyph point size — default 20 */
  size?: number;
  weight?: "regular" | "medium" | "semibold" | "bold";
  tint?: string;
  /** Dim inactive chrome (e.g. expand when off) */
  muted?: boolean;
  /** Active / filled state for the control */
  active?: boolean;
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
  onPress,
  accessibilityLabel,
  size = 20,
  weight = "semibold",
  tint,
  muted,
  active,
  fallback = "·",
  style,
  hitSlop = 6,
}: Props) {
  const ink = tint ?? (muted && !active ? color.inkSoft : color.ink);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        active && styles.btnActive,
        pressed && styles.pressed,
        style,
      ]}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={active != null ? { selected: !!active } : undefined}
    >
      <View style={styles.glyphBox} pointerEvents="none">
        <SymbolView
          name={symbol as SFSymbol}
          size={size}
          weight={weight}
          tintColor={ink}
          style={styles.glyph}
          fallback={<Text style={[styles.fallback, { color: ink }]}>{fallback}</Text>}
        />
      </View>
    </Pressable>
  );
}

const GLYPH = 22;

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  btnActive: {
    opacity: 1,
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
  fallback: {
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
    marginTop: -2,
  },
});
