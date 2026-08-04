import { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { space } from "../theme";

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
 * Floating liquid-glass dock — shared look with home PassageSelector.
 * Frosted fill, specular rim, soft outer lift. No expo-blur.
 */
export function LiquidGlassBar({
  children,
  bottomGutter = space[3],
  compact = false,
  style,
  contentStyle,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const g = c.glass;
  const padBottom = Math.max(insets.bottom, compact ? space[2] : bottomGutter);
  const r = compact ? 20 : 28;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: padBottom }, style]}>
      <View style={[styles.capsuleOuter, { borderRadius: r }, compact && styles.capsuleOuterCompact]}>
        <View
          style={[
            styles.glow,
            { borderRadius: r, backgroundColor: g.glow },
            compact && styles.glowCompact,
          ]}
        />
        <View
          style={[
            styles.capsule,
            {
              borderRadius: r,
              backgroundColor: g.capsule,
              borderColor: g.capsuleBorder,
              borderBottomColor: g.capsuleBorderBottom,
              borderLeftColor: g.capsuleBorder,
              borderRightColor: g.capsuleBorder,
            },
            compact && styles.capsuleCompact,
          ]}
        >
          <View
            style={[
              styles.specular,
              {
                borderTopLeftRadius: r,
                borderTopRightRadius: r,
                backgroundColor: g.specular,
              },
              compact && styles.specularCompact,
            ]}
            pointerEvents="none"
          />
          <View style={[styles.inner, compact && styles.innerCompact, contentStyle]}>
            {children}
          </View>
        </View>
      </View>
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
  capsuleOuter: {
    borderRadius: 28,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  capsuleOuterCompact: {
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    transform: [{ scale: 1.03 }],
    opacity: 0.5,
  },
  glowCompact: {
    opacity: 0.35,
    transform: [{ scale: 1.02 }],
  },
  capsule: {
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  capsuleCompact: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  specular: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 0,
    height: 14,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  specularCompact: {
    left: 10,
    right: 10,
    height: 10,
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
