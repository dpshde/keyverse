import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
// Core only — package main is Node server; deep import skips canvas/fs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create: createQr } = require("qrcode/lib/core/qrcode") as {
  create: (
    data: string,
    opts?: { errorCorrectionLevel?: string }
  ) => { modules: { size: number; get: (x: number, y: number) => number } };
};
import { useTheme } from "@/src/context/ThemeContext";
import { radius, space, type ThemeColors } from "@/src/theme";


type Props = {
  /** Full door URL (or any string) encoded into the QR. */
  value: string;
  size?: number;
  fg?: string;
  bg?: string;
};

/**
 * On-device QR via `qrcode` core + `react-native-svg`.
 * Avoids remote `/api/share-qr` SVG (RN Image cannot render it) and
 * avoids `react-native-qrcode-svg` Metro resolution flakiness under pnpm.
 */
export function DoorQr({ value, size = 200, fg, bg }: Props) {
  const { color } = useTheme();
  const styles = useMemo(() => makeDoorQrStyles(color), [color]);
  const fgColor = fg ?? color.ink;
  const bgColor = bg ?? color.paper;
  const path = useMemo(() => {
    if (!value) return "";
    try {
      const code = createQr(value, { errorCorrectionLevel: "M" });
      const n = code.modules.size;
      const cell = size / n;
      const parts: string[] = [];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (code.modules.get(x, y)) {
            const px = x * cell;
            const py = y * cell;
            parts.push(`M${px} ${py}h${cell}v${cell}h${-cell}z`);
          }
        }
      }
      return parts.join("");
    } catch {
      return "";
    }
  }, [value, size]);

  if (!value || !path) return null;

  return (
    <View style={[styles.frame, { width: size + space[4] * 2, backgroundColor: bgColor }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Path d={path} fill={fgColor} />
      </Svg>
    </View>
  );
}

function makeDoorQrStyles(color: ThemeColors) {
  return StyleSheet.create({
  frame: {
    alignSelf: "center",
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineSoft,
    overflow: "hidden",
  },
});
}
