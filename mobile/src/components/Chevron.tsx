/**
 * Phosphor caret chevrons (regular weight, stroke scales with viewBox).
 * Paths match web `.kv-chev` / activity disclosure glyphs.
 *
 * Use muted colors + modest size (14–16) for disclosure chrome;
 * avoid full ink at 20+ unless it’s a primary control.
 */
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Svg, { G, Path } from "react-native-svg";

export type ChevronDirection = "right" | "down" | "left" | "up";

type Props = {
  direction?: ChevronDirection;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  /** Default true — hide from VoiceOver when parent labels the control */
  accessibilityElementsHidden?: boolean;
};

/** Caret-right path (user-provided polyline). */
const D_RIGHT = "M96 48 L176 128 L96 208";
/** Caret-down path (user-provided polyline). */
const D_DOWN = "M208 96 L128 176 L48 96";

/**
 * Directional caret. Left/up are mirrors of right/down so we stay on the
 * provided glyph geometry. Stroke is in viewBox units (scales with size).
 */
export function Chevron({
  direction = "right",
  size = 14,
  color,
  style,
  accessibilityElementsHidden = true,
}: Props) {
  const d = direction === "down" || direction === "up" ? D_DOWN : D_RIGHT;

  // Mirror transforms keep stroke caps/joins identical to the base glyphs
  const transform =
    direction === "left"
      ? "translate(256 0) scale(-1 1)"
      : direction === "up"
        ? "translate(0 256) scale(1 -1)"
        : undefined;

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      style={[styles.base, style]}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility="no-hide-descendants"
    >
      <G transform={transform}>
        <Path
          d={d}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={16}
        />
      </G>
    </Svg>
  );
}

const styles = StyleSheet.create({
  base: { flexShrink: 0 },
});
