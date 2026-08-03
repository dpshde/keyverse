import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import { hapticSelect } from "@/src/lib/haptics";
import { color } from "@/src/theme";

/**
 * Stack back control — bold chevron at a weight that holds its own
 * next to a strong header title and liquid-glass trailing actions.
 */
export function StackBackButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        if (router.canGoBack()) router.back();
        else router.replace("/home");
      }}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <SymbolView
        name="chevron.left"
        size={20}
        weight="bold"
        tintColor={color.ink}
        fallback={<Text style={styles.fallback}>‹</Text>}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 0,
  },
  pressed: { opacity: 0.5 },
  fallback: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "700",
    color: color.ink,
    marginTop: -2,
  },
});
