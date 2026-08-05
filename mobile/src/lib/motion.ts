/**
 * Motion tokens + reduced-motion helpers for Expo / Reanimated.
 *
 * Aligns with Vercel RN skills:
 * - Animate only transform + opacity (GPU)
 * - Prefer Reanimated (UI thread) over RN Animated for continuous motion
 * - Honor prefers-reduced-motion (instant settle, no decorative motion)
 *
 * View Transitions (react-view-transitions skill) are web-only; native stack
 * `simple_push` / Reanimated sheets carry that “state continuity” intent on mobile.
 */
import { AccessibilityInfo, Platform } from "react-native";
import type { WithSpringConfig } from "react-native-reanimated";

/** Canonical durations (ms). Stack nav uses `base`/`nav`. */
export const MOTION_MS = {
  /** Reduced-motion / no-op settle */
  instant: 0,
  /** Micro-feedback (press recover) */
  fast: 160,
  /** Sheets, dock, keyboard lift */
  base: 220,
  /** Stack push / page transition */
  nav: 280,
  /** Soft exit (backdrop) */
  exit: 180,
} as const;

/** Reanimated spring presets — translateY sheets only */
export const MOTION_SPRING = {
  snappy: { damping: 28, stiffness: 340, mass: 0.9 } satisfies WithSpringConfig,
  soft: { damping: 32, stiffness: 280, mass: 1 } satisfies WithSpringConfig,
} as const;

let reduceMotionCached = false;
let reduceMotionReady = false;

function wireReduceMotion() {
  if (reduceMotionReady) return;
  reduceMotionReady = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((v) => {
      reduceMotionCached = !!v;
    })
    .catch(() => {});
  const sub = AccessibilityInfo.addEventListener?.(
    "reduceMotionChanged",
    (v: boolean) => {
      reduceMotionCached = !!v;
    }
  );
  // RN versions differ on remove subscription shape; fire-and-forget is fine.
  void sub;
}

wireReduceMotion();

/** True when the user asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  return reduceMotionCached;
}

/**
 * Duration for a timing animation — 0 when reduced motion is on
 * so UI settles without a visible tween.
 */
export function motionDuration(ms: number): number {
  return reduceMotionCached ? MOTION_MS.instant : ms;
}

/**
 * Spring config, or null when reduced motion prefers a snap (caller should use timing 0).
 */
export function motionSpring(
  key: keyof typeof MOTION_SPRING = "snappy"
): WithSpringConfig | null {
  if (reduceMotionCached) return null;
  return MOTION_SPRING[key];
}

/** Stack navigator animationDuration (ms). */
export function stackAnimationDuration(): number {
  return motionDuration(MOTION_MS.nav);
}

/** Keyboard lift: prefer system duration on iOS, clamp for feel. */
export function keyboardMotionMs(systemMs: number | null | undefined, rising: boolean): number {
  if (reduceMotionCached) return MOTION_MS.instant;
  if (systemMs != null && systemMs > 0) return Math.min(systemMs, MOTION_MS.nav);
  return rising ? MOTION_MS.base : MOTION_MS.exit;
}

export const isIOS = Platform.OS === "ios";
