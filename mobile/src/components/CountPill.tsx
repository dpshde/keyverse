import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { radius } from "../theme";

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
  const { colors: c } = useTheme();
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: c.fillStrong },
        variant === "ghost" && {
          backgroundColor: "transparent",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.lineSoft,
        },
        variant === "active" && { backgroundColor: c.primaryFill },
        style,
      ]}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        style={[
          styles.text,
          { color: c.inkSoft },
          variant === "ghost" && { fontWeight: "600", color: c.faint },
          variant === "active" && { color: c.primaryOn },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Fixed geometry so book + chapter trailing counts align on one vertical rail */
  pill: {
    minWidth: 30,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  text: {
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.2,
    textAlign: "center",
  },
});
