import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type KeyboardEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SuggestItem } from "../api/types";
import { hapticLight, hapticSelect } from "../lib/haptics";
import { color, radius, space, tap, tapComfy } from "../theme";

type Props = {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit: (query?: string) => void;
  suggestions: SuggestItem[];
  /** So the parent list can pad above the raised dock */
  onKeyboardHeightChange?: (height: number) => void;
};

/**
 * Thumb-zone passage control: floating liquid-glass capsule.
 * Pure RN (no expo-blur). Keyboard lift is Animated in sync with system
 * keyboard (absolute bottom docks ignore KeyboardAvoidingView).
 */
export function PassageSelector({
  value,
  onChangeText,
  onSubmit,
  suggestions,
  onKeyboardHeightChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  const restPad = Math.max(insets.bottom, space[3]);

  /**
   * Lift with translateY (native driver) — animating `bottom`/`padding` is JS-thread
   * only and feels laggy. lift 0 = resting; lift = keyboardHeight − restPad + gap.
   */
  const liftAnim = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const run = (kb: number, e?: KeyboardEvent) => {
      // Prefer system keyboard duration when present; keep hides snappy.
      const sysMs =
        Platform.OS === "ios" && e?.duration != null && e.duration > 0 ? e.duration : null;
      const duration = sysMs != null ? Math.min(sysMs, 280) : kb > 0 ? 220 : 180;
      // Rise so capsule sits just above keys (small gap), not on the home indicator
      const lift = kb > 0 ? Math.max(0, kb - restPad + space[2]) : 0;

      animRef.current?.stop();
      animRef.current = Animated.timing(liftAnim, {
        toValue: -lift,
        duration,
        // Snappier than a long keyboard ease — less “floaty”
        easing: kb > 0 ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      });
      animRef.current.start();
      onKeyboardHeightChange?.(kb);
    };

    const onShow = (e: KeyboardEvent) => {
      run(e.endCoordinates?.height ?? 0, e);
    };
    const onHide = (e: KeyboardEvent) => {
      run(0, e);
    };

    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
      animRef.current?.stop();
    };
  }, [liftAnim, restPad, onKeyboardHeightChange]);

  const shown = suggestions.slice(0, 5);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingBottom: restPad,
          transform: [{ translateY: liftAnim }],
        },
      ]}
    >
      {shown.length > 0 ? (
        <View style={[styles.sugOuter, dark && styles.sugOuterDark]}>
          <View style={[styles.glassFill, dark && styles.glassFillDark]} />
          <View style={[styles.glassHighlight, dark && styles.glassHighlightDark]} />
          {shown.map((s, i) => (
            <Pressable
              key={s.canonical + s.label}
              style={[
                styles.sugRow,
                i < shown.length - 1 && styles.sugRowBorder,
                dark && styles.sugRowBorderDark,
              ]}
              onPress={() => {
                hapticSelect();
                onSubmit(s.insertText || s.canonical);
              }}
            >
              <Text style={[styles.sugTxt, dark && styles.sugTxtDark]} numberOfLines={1}>
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.capsuleOuter}>
        <View style={[styles.glow, dark && styles.glowDark]} />
        <View style={[styles.capsule, dark && styles.capsuleDark]}>
          <View style={[styles.specular, dark && styles.specularDark]} pointerEvents="none" />
          <View style={styles.capsuleInner}>
            <View style={[styles.fieldShell, dark && styles.fieldShellDark]}>
              <TextInput
                style={[styles.field, dark && styles.fieldDark]}
                value={value}
                onChangeText={onChangeText}
                placeholder="John 3:16 · psa 33"
                placeholderTextColor={dark ? "rgba(255,255,255,0.38)" : "rgba(22,22,22,0.38)"}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => {
                  hapticLight();
                  onSubmit();
                }}
                returnKeyType="go"
                accessibilityLabel="Passage search"
                selectionColor={dark ? "rgba(255,255,255,0.35)" : color.sel}
              />
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.go,
                dark && styles.goDark,
                pressed && styles.goPressed,
              ]}
              onPress={() => {
                hapticLight();
                onSubmit();
              }}
              accessibilityRole="button"
              accessibilityLabel="Go to passage"
            >
              <Text style={[styles.goTxt, dark && styles.goTxtDark]}>Go</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

/** Height budget for list padding under the floating control */
export function passageSelectorListPad(
  suggestionCount: number,
  bottomInset: number,
  keyboardHeight = 0
): number {
  const safe = keyboardHeight > 0 ? space[2] : Math.max(bottomInset, space[3]);
  const base = 72 + safe + space[3] + keyboardHeight;
  const sug = suggestionCount > 0 ? Math.min(suggestionCount, 5) * 44 + 12 : 0;
  return base + sug;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space[3],
    gap: space[2],
  },
  sugOuter: {
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: "rgba(255,255,255,0.9)",
    borderBottomColor: "rgba(22,22,22,0.1)",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  sugOuterDark: {
    backgroundColor: "rgba(28,30,36,0.94)",
    borderColor: "rgba(255,255,255,0.16)",
    borderBottomColor: "rgba(0,0,0,0.4)",
  },
  glassFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(246,245,242,0.55)",
  },
  glassFillDark: {
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  glassHighlight: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  glassHighlightDark: {
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  sugRow: {
    minHeight: tap,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    justifyContent: "center",
    zIndex: 1,
  },
  sugRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(22,22,22,0.08)",
  },
  sugRowBorderDark: {
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  sugTxt: {
    fontSize: 16,
    fontWeight: "500",
    color: color.ink,
    letterSpacing: -0.2,
  },
  sugTxtDark: {
    color: "rgba(255,255,255,0.92)",
  },
  capsuleOuter: {
    borderRadius: 28,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.55)",
    transform: [{ scale: 1.03 }],
    opacity: 0.5,
  },
  glowDark: {
    backgroundColor: "rgba(90,100,140,0.32)",
  },
  capsule: {
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: Platform.select({
      ios: "rgba(255,255,255,0.94)",
      default: "rgba(255,255,255,0.97)",
    }),
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: "rgba(255,255,255,0.92)",
    borderBottomColor: "rgba(22,22,22,0.12)",
    borderLeftColor: "rgba(255,255,255,0.7)",
    borderRightColor: "rgba(255,255,255,0.7)",
  },
  capsuleDark: {
    backgroundColor: Platform.select({
      ios: "rgba(32,34,40,0.94)",
      default: "rgba(28,30,36,0.97)",
    }),
    borderColor: "rgba(255,255,255,0.2)",
    borderBottomColor: "rgba(0,0,0,0.45)",
    borderLeftColor: "rgba(255,255,255,0.12)",
    borderRightColor: "rgba(255,255,255,0.12)",
  },
  specular: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 0,
    height: 14,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  specularDark: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  capsuleInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    padding: space[2],
    minHeight: tapComfy + space[2] * 2,
  },
  fieldShell: {
    flex: 1,
    minHeight: tapComfy,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(22,22,22,0.08)",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
      },
      default: {},
    }),
  },
  fieldShellDark: {
    backgroundColor: "rgba(0,0,0,0.4)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  field: {
    minHeight: tapComfy,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: 17,
    fontWeight: "500",
    letterSpacing: -0.2,
    color: color.ink,
  },
  fieldDark: {
    color: "rgba(255,255,255,0.95)",
  },
  go: {
    minHeight: tapComfy,
    minWidth: 64,
    borderRadius: 22,
    paddingHorizontal: space[4],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22,22,22,0.9)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.22)",
    borderTopColor: "rgba(255,255,255,0.4)",
  },
  goDark: {
    backgroundColor: "rgba(255,255,255,0.94)",
    borderColor: "rgba(255,255,255,0.55)",
  },
  goPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  goTxt: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: -0.2,
  },
  goTxtDark: {
    color: color.ink,
  },
});
