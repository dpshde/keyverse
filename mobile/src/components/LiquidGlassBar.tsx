import { type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  const dark = useColorScheme() === "dark";
  const padBottom = Math.max(insets.bottom, compact ? space[2] : bottomGutter);
  const r = compact ? 20 : 28;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: padBottom }, style]}>
      <View style={[styles.capsuleOuter, { borderRadius: r }, compact && styles.capsuleOuterCompact]}>
        <View
          style={[styles.glow, { borderRadius: r }, dark && styles.glowDark, compact && styles.glowCompact]}
        />
        <View
          style={[
            styles.capsule,
            { borderRadius: r },
            dark && styles.capsuleDark,
            compact && styles.capsuleCompact,
          ]}
        >
          <View
            style={[
              styles.specular,
              { borderTopLeftRadius: r, borderTopRightRadius: r },
              dark && styles.specularDark,
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
    backgroundColor: "rgba(255,255,255,0.55)",
    transform: [{ scale: 1.03 }],
    opacity: 0.5,
  },
  glowCompact: {
    opacity: 0.35,
    transform: [{ scale: 1.02 }],
  },
  glowDark: {
    backgroundColor: "rgba(90,100,140,0.32)",
  },
  capsule: {
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: Platform.select({
      ios: "rgba(255,255,255,0.94)",
      default: "rgba(255,255,255,0.97)",
    }),
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: "rgba(255,255,255,0.92)",
    borderBottomColor: "rgba(22,22,22,0.12)",
    borderLeftColor: "rgba(255,255,255,0.7)",
    borderRightColor: "rgba(255,255,255,0.7)",
  },
  capsuleCompact: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  capsuleDark: {
    backgroundColor: Platform.select({
      ios: "rgba(32,34,40,0.94)",
      default: "rgba(28,30,36,0.97)",
    }),
    borderColor: "rgba(255,255,255,0.2)",
    borderBottomColor: "rgba(0,0,0,0.45)",
    borderLeftColor: "rgba(255,255,255,0.12)",
    borderRightColor: "rgba(255,255,255,0.12)",
  },
  specular: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 0,
    height: 14,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  specularCompact: {
    left: 10,
    right: 10,
    height: 10,
  },
  specularDark: {
    backgroundColor: "rgba(255,255,255,0.08)",
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
