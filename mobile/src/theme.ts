/**
 * Shared mobile visual tokens — aligned with web priv/static/app.css
 * (warm paper, dark ink primary, system UI chrome over serif reading).
 * Spacing: 4-based scale.
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

export const color = {
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
  /**
   * Passage selection wash — ink into paper (web: color-mix currentColor 7.5% Canvas).
   * Not link-blue: a reading mark on warm stock, not a UI chrome selection.
   * Opaque so adjacent verse rows stitch without dark transparency seams.
   */
  sel: "#e5e4e1",
  /** Hairline at selection → note tray (web --sel-edge ≈ 14% ink into paper) */
  selEdge: "#d6d5d1",
} as const;

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

export const type = {
  caption: { fontSize: 12, lineHeight: 16, color: color.faint, fontFamily: fontUi } as TextStyle,
  meta: { fontSize: 13, lineHeight: 18, color: color.muted, fontFamily: fontUi } as TextStyle,
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600" as const,
    color: color.muted,
    fontFamily: fontUi,
  } as TextStyle,
  body: { fontSize: 16, lineHeight: 24, color: color.inkSoft, fontFamily: fontUi } as TextStyle,
  bodyStrong: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600" as const,
    color: color.ink,
    fontFamily: fontUi,
  } as TextStyle,
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700" as const,
    color: color.ink,
    fontFamily: fontUi,
  } as TextStyle,
  /** Scripture verse line */
  verse: {
    fontSize: 18,
    lineHeight: 28,
    color: color.ink,
    fontFamily: fontRead,
  } as TextStyle,
  verseNum: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: "rgba(22,22,22,0.32)",
    fontFamily: fontUi,
  } as TextStyle,
  section: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700" as const,
    color: color.muted,
    letterSpacing: 0.4,
    textTransform: "uppercase" as const,
    fontFamily: fontUi,
  } as TextStyle,
};

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
export const ui = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.paper,
  } as ViewStyle,
  screenPad: {
    flex: 1,
    backgroundColor: color.paper,
    padding: space[4],
  } as ViewStyle,
  group: {
    backgroundColor: color.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineSoft,
    padding: space[4],
    marginBottom: space[4],
    gap: space[2],
  } as ViewStyle,
  primaryBtn: {
    minHeight: tapComfy,
    backgroundColor: color.ink,
    borderRadius: radius.md,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  primaryBtnTxt: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
    fontFamily: fontUi,
  } as TextStyle,
  secondaryBtn: {
    minHeight: tap,
    backgroundColor: color.paperRaised,
    borderRadius: radius.md,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  } as ViewStyle,
  secondaryBtnTxt: {
    color: color.ink,
    fontWeight: "600",
    fontSize: 15,
    fontFamily: fontUi,
  } as TextStyle,
  ghostBtn: {
    minHeight: tap,
    backgroundColor: color.fillStrong,
    borderRadius: radius.md,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  ghostBtnTxt: {
    color: color.ink,
    fontWeight: "600",
    fontSize: 14,
    fontFamily: fontUi,
  } as TextStyle,
  /** Compact pill for toolbar rows (Settings · Share · Passphrase) */
  ghostBtnSm: {
    minHeight: 36,
    backgroundColor: color.fillStrong,
    borderRadius: radius.pill,
    paddingVertical: space[1] + 2,
    paddingHorizontal: space[3],
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  ghostBtnSmTxt: {
    color: color.inkSoft,
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
    color: color.ink,
    fontWeight: "600",
    fontSize: 16,
    fontFamily: fontUi,
  } as TextStyle,
  dangerBtn: {
    minHeight: tap,
    backgroundColor: color.dangerSoft,
    borderRadius: radius.md,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  dangerBtnTxt: {
    color: color.danger,
    fontWeight: "600",
    fontSize: 15,
    fontFamily: fontUi,
  } as TextStyle,
  /** In-content only — never use for chrome actions */
  link: {
    fontWeight: "600",
    color: color.inkSoft,
    fontSize: 15,
    fontFamily: fontUi,
    textDecorationLine: "underline",
    textDecorationColor: color.line,
  } as TextStyle,
  input: {
    minHeight: tapComfy,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    backgroundColor: color.paperRaised,
    fontSize: 16,
    color: color.ink,
    fontFamily: fontUi,
  } as TextStyle,
  err: {
    color: color.danger,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontUi,
  } as TextStyle,
});
