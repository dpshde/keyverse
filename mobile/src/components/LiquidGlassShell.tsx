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
  /**
   * Higher contrast vs page paper (passage dock).
   * Thicker system material + denser border/shadow so the control reads as a solid surface.
   */
  elevated?: boolean;
};

/**
 * Real iOS liquid glass: `UIVisualEffectView` via expo-blur (intensity 100).
 * Default: no wash (material alone). Elevated: thick material + light wash for dock contrast.
 * Android keeps a frost fill (+ experimental blur when available).
 */
export function LiquidGlassShell({
  children,
  borderRadius,
  style,
  contentStyle,
  compact = false,
  elevated = false,
}: Props) {
  const { colors: c, resolved } = useTheme();
  const g = c.glass;
  const dark = resolved === "dark";

  // Full-strength system materials — partial intensity looks like a flat slab.
  // Elevated dock: thicker material so content under the keyboard doesn't wash through.
  const tint: BlurTint = elevated
    ? dark
      ? "systemThickMaterialDark"
      : "systemThickMaterialLight"
    : dark
      ? "systemChromeMaterialDark"
      : "systemChromeMaterialLight";

  /**
   * Dark elevated was painting a bright white ring (1px + specular rim).
   * Keep contrast via wash/material; stroke stays quiet hairline like the rest of night chrome.
   */
  const borderStyle = elevated
    ? dark
      ? {
          borderRadius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: "rgba(255,255,255,0.12)",
          borderTopColor: "rgba(255,255,255,0.14)",
          borderBottomColor: "rgba(0,0,0,0.5)",
          borderLeftColor: "rgba(255,255,255,0.1)",
          borderRightColor: "rgba(255,255,255,0.1)",
        }
      : {
          borderRadius,
          borderWidth: 1,
          borderColor: "rgba(22,22,22,0.16)",
          borderTopColor: "rgba(255,255,255,0.72)",
          borderBottomColor: "rgba(22,22,22,0.18)",
          borderLeftColor: "rgba(22,22,22,0.14)",
          borderRightColor: "rgba(22,22,22,0.14)",
        }
    : {
        borderRadius,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: g.capsuleBorder,
        borderTopColor: g.capsuleBorder,
        borderBottomColor: g.capsuleBorderBottom,
        borderLeftColor: g.capsuleBorder,
        borderRightColor: g.capsuleBorder,
      };

  // Subtle solid lift — keeps glass feel but separates from paper bg
  const wash = elevated
    ? dark
      ? "rgba(28, 30, 36, 0.72)"
      : "rgba(255, 255, 255, 0.62)"
    : null;

  return (
    <View
      style={[
        styles.outer,
        compact ? styles.outerCompact : null,
        elevated ? styles.outerElevated : null,
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
          {wash ? (
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFillObject, { backgroundColor: wash, borderRadius }]}
            />
          ) : null}
          {/* Hairline top catch-light only — material supplies the frost */}
          <View
            pointerEvents="none"
            style={[
              styles.rim,
              elevated && dark ? styles.rimQuiet : null,
              {
                backgroundColor: elevated
                  ? dark
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(255,255,255,0.9)"
                  : g.specular,
                borderTopLeftRadius: borderRadius,
                borderTopRightRadius: borderRadius,
              },
            ]}
          />
          {children}
        </BlurView>
      ) : (
        <View
          style={[
            styles.shell,
            borderStyle,
            {
              backgroundColor: elevated
                ? dark
                  ? "rgba(36,38,46,0.96)"
                  : "rgba(255,255,255,0.96)"
                : g.capsule,
            },
            contentStyle,
          ]}
        >
          <BlurView
            intensity={elevated ? 95 : 80}
            tint={tint}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          {wash ? (
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFillObject, { backgroundColor: wash, borderRadius }]}
            />
          ) : null}
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
  outerElevated: {
    shadowOpacity: 0.38,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
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
  /** Dark elevated: no bright catch-light halo */
  rimQuiet: {
    opacity: 0.45,
  },
});
