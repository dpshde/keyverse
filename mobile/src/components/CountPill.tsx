import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { color, radius } from "../theme";

type Props = {
  /** Numeric count, or a short label (e.g. "All", "More") */
  label: string | number;
  /** Filled = collapsed / packed; ghost = expanded / active */
  variant?: "filled" | "ghost" | "active";
  style?: ViewStyle;
  accessibilityElementsHidden?: boolean;
};

/**
 * Trailing disclosure chip — replaces tiny ▸/▾ chevrons.
 * Collapsed sections use filled; expanded/on use ghost or active.
 */
export function CountPill({
  label,
  variant = "filled",
  style,
  accessibilityElementsHidden = true,
}: Props) {
  return (
    <View
      style={[
        styles.pill,
        variant === "ghost" && styles.ghost,
        variant === "active" && styles.active,
        style,
      ]}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        style={[
          styles.text,
          variant === "ghost" && styles.textGhost,
          variant === "active" && styles.textActive,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minWidth: 28,
    height: 26,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: color.fillStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  ghost: {
    backgroundColor: "transparent",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  active: {
    backgroundColor: color.ink,
  },
  text: {
    fontSize: 13,
    fontWeight: "700",
    color: color.inkSoft,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.2,
  },
  textGhost: {
    fontWeight: "600",
    color: color.muted,
  },
  textActive: {
    color: color.paperRaised,
  },
});
