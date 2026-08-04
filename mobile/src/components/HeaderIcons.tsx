/**
 * Reader header glyphs (Phosphor-style paths, currentColor via stroke/fill).
 * Matches web inline SVGs for share / chapter note / expand-all.
 */
import Svg, { Circle, Line, Path, Polygon, Polyline } from "react-native-svg";

type IconProps = {
  size?: number;
  color: string;
};

/** Phosphor export — share passage */
export function IconShare({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" accessibilityElementsHidden>
      <Path
        d="M176,152v56a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V88a8,8,0,0,1,8-8h56"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16}
      />
      <Polyline
        points="120 136 216 40 216 96"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16}
      />
      <Line
        x1="216"
        y1="40"
        x2="152"
        y2="40"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16}
      />
    </Svg>
  );
}

/** Note pencil — chapter note control */
export function IconNotePencil({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" accessibilityElementsHidden>
      <Polygon
        points="128 160 96 160 96 128 192 32 224 64 128 160"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16}
      />
      <Line
        x1="168"
        y1="56"
        x2="200"
        y2="88"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16}
      />
      <Path
        d="M216,128v80a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V48a8,8,0,0,1,8-8h80"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16}
      />
    </Svg>
  );
}

/** List bullets — expand / fold all verse notes */
export function IconListBullets({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" accessibilityElementsHidden>
      <Line
        x1="88"
        y1="64"
        x2="216"
        y2="64"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16}
      />
      <Line
        x1="88"
        y1="128"
        x2="216"
        y2="128"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16}
      />
      <Line
        x1="88"
        y1="192"
        x2="216"
        y2="192"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16}
      />
      <Circle cx="44" cy="64" r="12" fill={color} />
      <Circle cx="44" cy="128" r="12" fill={color} />
      <Circle cx="44" cy="192" r="12" fill={color} />
    </Svg>
  );
}
