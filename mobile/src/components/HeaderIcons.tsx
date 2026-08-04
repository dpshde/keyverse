/**
 * Reader header glyphs (Phosphor-style paths, currentColor via stroke/fill).
 * Share = web `ph-export`; note/list match web inline SVGs in html.ex.
 */
import Svg, { Circle, Line, Path, Polygon } from "react-native-svg";

type IconProps = {
  size?: number;
  color: string;
};

/**
 * Phosphor `export` — same glyph as web `ph-export` / ico("export")
 * (tray + up arrow). Used for passage share on reader + note headers.
 */
export function IconShare({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" accessibilityElementsHidden>
      <Path
        d="M216,112v96a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V112A16,16,0,0,1,56,96H80a8,8,0,0,1,0,16H56v96H200V112H176a8,8,0,0,1,0-16h24A16,16,0,0,1,216,112ZM93.66,69.66,120,43.31V136a8,8,0,0,0,16,0V43.31l26.34,26.35a8,8,0,0,0,11.32-11.32l-40-40a8,8,0,0,0-11.32,0l-40,40A8,8,0,0,0,93.66,69.66Z"
        fill={color}
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
