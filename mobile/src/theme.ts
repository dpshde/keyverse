/**
 * Shared mobile visual tokens — aligned with web priv/static/app.css
 * (warm paper / night paper, system UI chrome over serif reading).
 * Spacing: 4-based scale.
 *
 * Colors are scheme-aware. Prefer `useTheme()` for live colors/ui/type.
 * The default `color` export is the light palette (static fallback only).
 */
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from "react-native";

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** Minimum comfortable tap target (HIG / web --tap) */
export const tap = 44;
export const tapComfy = 48;

export type ThemeScheme = "light" | "dark";
export type ThemePreference = ThemeScheme | "system";

export type GlassTokens = {
  capsule: string;
  capsuleBorder: string;
  capsuleBorderBottom: string;
  glow: string;
  specular: string;
  field: string;
  fieldBorder: string;
  sugBg: string;
  sugBorder: string;
  sugRowBorder: string;
  placeholder: string;
  selection: string;
  dockSeg: string;
  dockSegBorder: string;
};

export type ThemeColors = {
  paper: string;
  paperRaised: string;
  ink: string;
  inkSoft: string;
  muted: string;
  faint: string;
  line: string;
  lineSoft: string;
  fill: string;
  fillStrong: string;
  danger: string;
  dangerSoft: string;
  warnSoft: string;
  warnInk: string;
  link: string;
  /** Passage selection wash */
  sel: string;
  selEdge: string;
  /** Filled primary (Go, Save, Home dock) */
  primaryFill: string;
  primaryOn: string;
  /** Soft press wash on chrome icons */
  pressFill: string;
  /** Outliner / tool hairlines */
  hairline: string;
  verseNum: string;
  glass: GlassTokens;
};

export const colorsLight: ThemeColors = {
  paper: "#f6f5f2",
  paperRaised: "#ffffff",
  ink: "#161616",
  inkSoft: "#3a3a38",
  muted: "#6b6a66",
  faint: "#8a8984",
  line: "rgba(22,22,22,0.12)",
  lineSoft: "rgba(22,22,22,0.08)",
  fill: "rgba(22,22,22,0.05)",
  fillStrong: "rgba(22,22,22,0.08)",
  danger: "#a33",
  dangerSoft: "#f5e6e4",
  warnSoft: "#f5efd9",
  warnInk: "#5c5330",
  link: "#2c4a6e",
  sel: "#e5e4e1",
  selEdge: "#d6d5d1",
  primaryFill: "#161616",
  primaryOn: "#ffffff",
  pressFill: "rgba(0,0,0,0.06)",
  hairline: "rgba(0,0,0,0.1)",
  verseNum: "rgba(22,22,22,0.32)",
  glass: {
    /**
     * iOS: UIVisualEffectView supplies fill (no wash).
     * Android: solid-ish frost fill (blur optional / experimental).
     */
    capsule: Platform.select({
      ios: "transparent",
      default: "rgba(255,255,255,0.88)",
    }) as string,
    capsuleBorder: "rgba(255,255,255,0.55)",
    capsuleBorderBottom: "rgba(22,22,22,0.12)",
    glow: "rgba(255,255,255,0.35)",
    specular: "rgba(255,255,255,0.65)",
    /** Field flush on glass — never a nested pill */
    field: "transparent",
    fieldBorder: "transparent",
    sugBg: "transparent",
    sugBorder: "rgba(255,255,255,0.55)",
    sugRowBorder: "rgba(22,22,22,0.08)",
    placeholder: "rgba(22,22,22,0.38)",
    selection: "rgba(22,22,22,0.18)",
    dockSeg: "rgba(255,255,255,0.45)",
    dockSegBorder: "rgba(255,255,255,0.7)",
  },
};

/** Night paper — matches web dark body / raised chrome */
export const colorsDark: ThemeColors = {
  paper: "#121211",
  paperRaised: "#1c1b19",
  ink: "#eceae4",
  inkSoft: "#c8c6c0",
  muted: "#9a9890",
  faint: "#7a7872",
  line: "rgba(236,234,228,0.14)",
  lineSoft: "rgba(236,234,228,0.09)",
  fill: "rgba(236,234,228,0.07)",
  fillStrong: "rgba(236,234,228,0.11)",
  danger: "#e07070",
  dangerSoft: "#3a2220",
  warnSoft: "#3a3520",
  warnInk: "#e8d9a0",
  link: "#8ab4d8",
  sel: "#2a2820",
  selEdge: "#3d3a30",
  primaryFill: "#eceae4",
  primaryOn: "#111111",
  pressFill: "rgba(255,255,255,0.08)",
  hairline: "rgba(255,255,255,0.12)",
  verseNum: "rgba(236,234,228,0.38)",
  glass: {
    /**
     * Dark: iOS uses systemChromeMaterialDark at full intensity (no wash).
     * Android: charcoal frost fill only.
     */
    capsule: Platform.select({
      ios: "transparent",
      default: "rgba(42,44,52,0.88)",
    }) as string,
    capsuleBorder: "rgba(255,255,255,0.18)",
    capsuleBorderBottom: "rgba(0,0,0,0.45)",
    glow: "rgba(140,150,180,0.16)",
    specular: "rgba(255,255,255,0.22)",
    field: "transparent",
    fieldBorder: "transparent",
    sugBg: "transparent",
    sugBorder: "rgba(255,255,255,0.16)",
    sugRowBorder: "rgba(255,255,255,0.1)",
    placeholder: "rgba(255,255,255,0.42)",
    selection: "rgba(255,255,255,0.35)",
    dockSeg: "rgba(255,255,255,0.14)",
    dockSegBorder: "rgba(255,255,255,0.22)",
  },
};

export function getColors(scheme: ThemeScheme): ThemeColors {
  return scheme === "dark" ? colorsDark : colorsLight;
}

/** @deprecated Prefer useTheme().colors — light fallback for static modules */
export const color = colorsLight;

export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  pill: 999,
  /** Outer corners of a multi-verse selection run (web --sel-radius ≈ .65rem) */
  sel: 10,
} as const;

/** UI chrome — system sans */
export const fontUi = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "System",
});

/** Reading body — matches web Iowan/Palatino stack */
export const fontRead = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia",
});

export type TypeStyles = {
  caption: TextStyle;
  meta: TextStyle;
  label: TextStyle;
  body: TextStyle;
  bodyStrong: TextStyle;
  title: TextStyle;
  verse: TextStyle;
  verseNum: TextStyle;
  section: TextStyle;
};

export function makeType(c: ThemeColors): TypeStyles {
  return {
    caption: { fontSize: 12, lineHeight: 16, color: c.faint, fontFamily: fontUi },
    meta: { fontSize: 13, lineHeight: 18, color: c.muted, fontFamily: fontUi },
    label: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: c.muted,
      fontFamily: fontUi,
    },
    body: { fontSize: 16, lineHeight: 24, color: c.inkSoft, fontFamily: fontUi },
    bodyStrong: {
      fontSize: 16,
      lineHeight: 24,
      fontWeight: "600",
      color: c.ink,
      fontFamily: fontUi,
    },
    title: {
      fontSize: 20,
      lineHeight: 26,
      fontWeight: "700",
      color: c.ink,
      fontFamily: fontUi,
    },
    verse: {
      fontSize: 18,
      lineHeight: 28,
      color: c.ink,
      fontFamily: fontRead,
    },
    verseNum: {
      fontSize: 12,
      fontWeight: "500",
      color: c.verseNum,
      fontFamily: fontUi,
    },
    section: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: c.muted,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      fontFamily: fontUi,
    },
  };
}

/** @deprecated Prefer useTheme().type */
export const type = makeType(colorsLight);

export const shadowDock = {
  shadowColor: "#000",
  shadowOpacity: 0.07,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: -3 },
  elevation: 10,
} as const;

/**
 * Button system (use these — no ad-hoc blue text “buttons”):
 * - primaryBtn   filled ink     — one primary action per surface (Go, Save, Sync)
 * - secondaryBtn outlined       — alternate actions (Import, Share sheet)
 * - ghostBtn     soft fill      — chrome / secondary nav (Settings, Share, Prev)
 * - dangerBtn    soft danger    — destructive
 * - headerBtn    compact ghost  — nav bar trailing actions
 * - link         text only      — in-content links only (markdown, “edit range”)
 */
export function makeUi(c: ThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.paper,
    } as ViewStyle,
    screenPad: {
      flex: 1,
      backgroundColor: c.paper,
      padding: space[4],
    } as ViewStyle,
    group: {
      backgroundColor: c.paperRaised,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.lineSoft,
      padding: space[4],
      marginBottom: space[4],
      gap: space[2],
    } as ViewStyle,
    primaryBtn: {
      minHeight: tapComfy,
      backgroundColor: c.primaryFill,
      borderRadius: radius.md,
      paddingVertical: space[3],
      paddingHorizontal: space[4],
      alignItems: "center",
      justifyContent: "center",
    } as ViewStyle,
    primaryBtnTxt: {
      color: c.primaryOn,
      fontWeight: "700",
      fontSize: 16,
      fontFamily: fontUi,
    } as TextStyle,
    secondaryBtn: {
      minHeight: tap,
      backgroundColor: c.paperRaised,
      borderRadius: radius.md,
      paddingVertical: space[3],
      paddingHorizontal: space[4],
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    } as ViewStyle,
    secondaryBtnTxt: {
      color: c.ink,
      fontWeight: "600",
      fontSize: 15,
      fontFamily: fontUi,
    } as TextStyle,
    ghostBtn: {
      minHeight: tap,
      backgroundColor: c.fillStrong,
      borderRadius: radius.md,
      paddingVertical: space[2],
      paddingHorizontal: space[3],
      alignItems: "center",
      justifyContent: "center",
    } as ViewStyle,
    ghostBtnTxt: {
      color: c.ink,
      fontWeight: "600",
      fontSize: 14,
      fontFamily: fontUi,
    } as TextStyle,
    /** Compact pill for toolbar rows (Settings · Share · Passphrase) */
    ghostBtnSm: {
      minHeight: 36,
      backgroundColor: c.fillStrong,
      borderRadius: radius.pill,
      paddingVertical: space[1] + 2,
      paddingHorizontal: space[3],
      alignItems: "center",
      justifyContent: "center",
    } as ViewStyle,
    ghostBtnSmTxt: {
      color: c.inkSoft,
      fontWeight: "600",
      fontSize: 13,
      fontFamily: fontUi,
    } as TextStyle,
    headerBtn: {
      minHeight: tap,
      minWidth: tap,
      paddingHorizontal: space[2],
      alignItems: "center",
      justifyContent: "center",
    } as ViewStyle,
    headerBtnTxt: {
      color: c.ink,
      fontWeight: "600",
      fontSize: 16,
      fontFamily: fontUi,
    } as TextStyle,
    dangerBtn: {
      minHeight: tap,
      backgroundColor: c.dangerSoft,
      borderRadius: radius.md,
      paddingVertical: space[3],
      paddingHorizontal: space[4],
      alignItems: "center",
      justifyContent: "center",
    } as ViewStyle,
    dangerBtnTxt: {
      color: c.danger,
      fontWeight: "600",
      fontSize: 15,
      fontFamily: fontUi,
    } as TextStyle,
    /** In-content only — never use for chrome actions */
    link: {
      fontWeight: "600",
      color: c.inkSoft,
      fontSize: 15,
      fontFamily: fontUi,
      textDecorationLine: "underline",
      textDecorationColor: c.line,
    } as TextStyle,
    input: {
      minHeight: tapComfy,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      borderRadius: radius.md,
      paddingHorizontal: space[3],
      paddingVertical: space[3],
      backgroundColor: c.paperRaised,
      fontSize: 16,
      color: c.ink,
      fontFamily: fontUi,
    } as TextStyle,
    err: {
      color: c.danger,
      fontSize: 14,
      lineHeight: 20,
      fontFamily: fontUi,
    } as TextStyle,
  });
}

/** @deprecated Prefer useTheme().ui */
export const ui = makeUi(colorsLight);

export function resolveScheme(
  preference: ThemePreference,
  system: ThemeScheme | null | undefined
): ThemeScheme {
  if (preference === "light" || preference === "dark") return preference;
  return system === "dark" ? "dark" : "light";
}
