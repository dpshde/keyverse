/**
 * Thin haptic helpers — safe no-ops if the device/simulator has no engine.
 * Use sparingly: selection for list/chrome, light for primary taps, impact for commits.
 */
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const ok = Platform.OS === "ios" || Platform.OS === "android";

function run(fn: () => Promise<void> | void) {
  if (!ok) return;
  try {
    void Promise.resolve(fn()).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Soft tick — chrome, chips, toggles, verse open */
export function hapticSelect() {
  run(() => Haptics.selectionAsync());
}

/** Light impact — primary buttons, dock segments, open note */
export function hapticLight() {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Medium — save, sync, claim door, range finalize */
export function hapticMedium() {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Heavier — destructive / important commit */
export function hapticHeavy() {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

export function hapticSuccess() {
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function hapticWarning() {
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

export function hapticError() {
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
