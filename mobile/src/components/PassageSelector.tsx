import { useEffect, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { SuggestItem } from "../api/types";
import { useTheme } from "../context/ThemeContext";
import { hapticLight, hapticSelect } from "../lib/haptics";
import { keyboardMotionMs } from "../lib/motion";
import { space, tap, tapComfy } from "../theme";
import { LiquidGlassShell } from "./LiquidGlassShell";
import { PassagePickerSheet } from "./PassagePickerSheet";

type Props = {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit: (query?: string) => void;
  suggestions: SuggestItem[];
  /** So the parent list can pad above the raised dock */
  onKeyboardHeightChange?: (height: number) => void;
  /**
   * Optional book→chapter sheet (Exedra-style notched picker).
   * Default on — set false to keep text-only input.
   */
  enablePicker?: boolean;
};

/**
 * Thumb-zone passage control: floating liquid-glass capsule.
 * Optional PassagePickerSheet for book/chapter browse.
 */
export function PassageSelector({
  value,
  onChangeText,
  onSubmit,
  suggestions,
  onKeyboardHeightChange,
  enablePicker = true,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const g = c.glass;
  const restPad = Math.max(insets.bottom, space[3]);
  const [pickerOpen, setPickerOpen] = useState(false);

  /**
   * Lift with translateY on the UI thread (Reanimated).
   * Never animate bottom/padding — layout thrash. lift 0 = rest; negative = above keyboard.
   */
  const liftY = useSharedValue(0);
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: liftY.value }],
  }));

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const run = (kb: number, e?: KeyboardEvent) => {
      const sysMs =
        Platform.OS === "ios" && e?.duration != null && e.duration > 0 ? e.duration : null;
      const duration = keyboardMotionMs(sysMs, kb > 0);
      // Rise so capsule sits just above keys (small gap), not on the home indicator
      const lift = kb > 0 ? Math.max(0, kb - restPad + space[2]) : 0;
      liftY.value = withTiming(-lift, {
        duration,
        easing: kb > 0 ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      });
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
    };
  }, [liftY, restPad, onKeyboardHeightChange]);

  const shown = suggestions.slice(0, 5);
  const open = shown.length > 0;
  // Capsule radius — composite (suggest + field) shares one shell like web .ref-search
  const r = 28;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: restPad }, liftStyle]}
    >
      <LiquidGlassShell borderRadius={r} elevated>
        {open ? (
          <View style={styles.sugBlock}>
            {shown.map((s, i) => (
              <Pressable
                key={s.canonical + s.label}
                style={[
                  styles.sugRow,
                  i < shown.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: g.sugRowBorder,
                  },
                ]}
                onPress={() => {
                  hapticSelect();
                  onSubmit(s.insertText || s.canonical);
                }}
              >
                <Text style={[styles.sugTxt, { color: c.ink }]} numberOfLines={1}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
            {/* Soft inner seam — matches web inset divider, not a gap */}
            <View style={[styles.sugSeam, { backgroundColor: g.sugRowBorder }]} />
          </View>
        ) : null}

        <View style={styles.capsuleInner}>
          {enablePicker ? (
            <Pressable
              style={({ pressed }) => [styles.pickBtn, pressed && { opacity: 0.65 }]}
              onPress={() => {
                hapticSelect();
                Keyboard.dismiss();
                setPickerOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Browse books and chapters"
            >
              <SymbolView
                name="book"
                size={20}
                weight="semibold"
                tintColor={c.ink}
                fallback={<Text style={[styles.pickFallback, { color: c.ink }]}>B</Text>}
              />
            </Pressable>
          ) : null}
          <TextInput
            style={[styles.field, { color: c.ink }]}
            value={value}
            onChangeText={onChangeText}
            placeholder="John 3:16 · psa 33"
            placeholderTextColor={g.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => {
              hapticLight();
              onSubmit();
            }}
            returnKeyType="go"
            accessibilityLabel="Passage search"
            selectionColor={g.selection}
          />
          <Pressable
            style={({ pressed }) => [
              styles.go,
              {
                backgroundColor: c.primaryFill,
                borderTopColor: "rgba(255,255,255,0.28)",
                borderBottomColor: "rgba(0,0,0,0.14)",
                borderLeftColor: "transparent",
                borderRightColor: "transparent",
              },
              pressed && styles.goPressed,
            ]}
            onPress={() => {
              hapticLight();
              onSubmit();
            }}
            accessibilityRole="button"
            accessibilityLabel="Go to passage"
          >
            <Text style={[styles.goTxt, { color: c.primaryOn }]}>Go</Text>
          </Pressable>
        </View>
      </LiquidGlassShell>

      {enablePicker ? (
        <PassagePickerSheet
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(slug) => {
            onChangeText(slug);
            onSubmit(slug);
          }}
        />
      ) : null}
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
  // Suggestions share the capsule shell; extra top pad when open
  const sug =
    suggestionCount > 0 ? Math.min(suggestionCount, 5) * 44 + space[2] + space[1] : 0;
  return base + sug;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space[3],
  },
  /** Sits above the field row inside the same glass shell */
  sugBlock: {
    zIndex: 1,
    // Extra air under the top rounded edge (was cramped against the rim)
    paddingTop: space[2],
  },
  sugRow: {
    minHeight: tap,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    justifyContent: "center",
  },
  sugTxt: {
    fontSize: 16,
    fontWeight: "500",
    letterSpacing: -0.2,
  },
  /** Hairline between last suggestion and the input row (web inset seam) */
  sugSeam: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: space[3],
  },
  capsuleInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    padding: space[2],
    minHeight: tapComfy + space[2] * 2,
  },
  pickBtn: {
    width: tapComfy,
    height: tapComfy,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  pickFallback: {
    fontSize: 15,
    fontWeight: "700",
  },
  field: {
    flex: 1,
    minHeight: tapComfy,
    paddingHorizontal: space[2],
    paddingVertical: space[3],
    fontSize: 17,
    fontWeight: "500",
    letterSpacing: -0.2,
    backgroundColor: "transparent",
  },
  go: {
    minHeight: tapComfy,
    minWidth: 64,
    borderRadius: 22,
    paddingHorizontal: space[4],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  goPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  goTxt: {
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: -0.2,
  },
});
