import { type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { BlurView, type BlurTint } from "expo-blur";
import { useTheme } from "../context/ThemeContext";

type Props = {
  children: ReactNode;
  borderRadius: number;
  /** Outer shadow / layout wrapper style */
  style?: StyleProp<ViewStyle>;
  /** Inner content padding / layout style */
  contentStyle?: StyleProp<ViewStyle>;
  /** Softer lift for compact chrome */
  compact?: boolean;
};

/**
 * Real iOS liquid glass: `UIVisualEffectView` via expo-blur (intensity 100).
 * No wash layer on iOS — that killed the native material. Android keeps a
 * frost fill (+ experimental blur when available).
 */
export function LiquidGlassShell({
  children,
  borderRadius,
  style,
  contentStyle,
  compact = false,
}: Props) {
  const { colors: c, resolved } = useTheme();
  const g = c.glass;
  const dark = resolved === "dark";

  // Full-strength system materials — partial intensity looks like a flat slab.
  const tint: BlurTint = dark
    ? "systemChromeMaterialDark"
    : "systemChromeMaterialLight";

  const borderStyle = {
    borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: g.capsuleBorder,
    borderTopColor: g.capsuleBorder,
    borderBottomColor: g.capsuleBorderBottom,
    borderLeftColor: g.capsuleBorder,
    borderRightColor: g.capsuleBorder,
  } as const;

  return (
    <View
      style={[
        styles.outer,
        compact ? styles.outerCompact : null,
        { borderRadius },
        style,
      ]}
    >
      {Platform.OS === "ios" ? (
        <BlurView
          intensity={100}
          tint={tint}
          style={[styles.shell, borderStyle, contentStyle]}
        >
          {/* Hairline top catch-light only — material supplies the frost */}
          <View
            pointerEvents="none"
            style={[
              styles.rim,
              {
                backgroundColor: g.specular,
                borderTopLeftRadius: borderRadius,
                borderTopRightRadius: borderRadius,
              },
            ]}
          />
          {children}
        </BlurView>
      ) : (
        <View style={[styles.shell, borderStyle, { backgroundColor: g.capsule }, contentStyle]}>
          <BlurView
            intensity={80}
            tint={tint}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[
              styles.rim,
              {
                backgroundColor: g.specular,
                borderTopLeftRadius: borderRadius,
                borderTopRightRadius: borderRadius,
              },
            ]}
          />
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  outerCompact: {
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  shell: {
    overflow: "hidden",
    // Transparent so UIVisualEffectView samples content underneath
    backgroundColor: "transparent",
  },
  rim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.85,
  },
});
