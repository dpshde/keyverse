/**
 * Header paper fill + soft fade into content.
 * - HeaderScrim → native-stack `headerBackground` (bar fill)
 * - HeaderContentFade → top of screen body (reliable drip; header may clip overflow)
 */
import { useId, useMemo, useState } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../context/ThemeContext";

/** Minimal drip — barely peeks under the bar. */
export const HEADER_FADE_H = 12;

function PaperFade({ height, gradId }: { height: number; gradId: string }) {
  const { color } = useTheme();
  const [w, setW] = useState(() => Dimensions.get("window").width);

  return (
    <View
      style={{ height, width: "100%" }}
      pointerEvents="none"
      onLayout={(e) => {
        const next = e.nativeEvent.layout.width;
        if (next > 0 && next !== w) setW(next);
      }}
    >
      <Svg width={w} height={height}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.paper} stopOpacity="1" />
            <Stop offset="0.5" stopColor={color.paper} stopOpacity="0.45" />
            <Stop offset="1" stopColor={color.paper} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={height} fill={`url(#${gradId})`} />
      </Svg>
    </View>
  );
}

/**
 * Use as native-stack `headerBackground`.
 * Solid paper under title/chrome; fade may extend if the host doesn’t clip.
 */
export function HeaderScrim() {
  const { color } = useTheme();
  const gradId = useId().replace(/:/g, "");

  return (
    <View style={styles.scrim} pointerEvents="none">
      <View style={[styles.fill, { backgroundColor: color.paper }]} />
      <View style={styles.scrimFade}>
        <PaperFade height={HEADER_FADE_H} gradId={`hdr-${gradId}`} />
      </View>
    </View>
  );
}

/**
 * Pin to the top of the screen body (under the stack header).
 * Content scrolls beneath the soft edge so titles stay separated from verse text.
 */
export function HeaderContentFade() {
  const gradId = useId().replace(/:/g, "");
  return (
    <View style={styles.contentFade} pointerEvents="none">
      <PaperFade height={HEADER_FADE_H} gradId={`body-${gradId}`} />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    overflow: "visible",
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  scrimFade: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "100%",
    height: HEADER_FADE_H,
  },
  contentFade: {
    position: "absolute",
    left: 0,
    right: 0,
    // Almost entirely under the header — only a thin edge into content
    top: -8,
    zIndex: 8,
    elevation: 8,
  },
});
