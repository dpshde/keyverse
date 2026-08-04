import { useRouter } from "expo-router";
import { StyleSheet } from "react-native";
import { hapticSelect } from "@/src/lib/haptics";
import { Chevron } from "./Chevron";
import { HeaderIconButton } from "./HeaderIconButton";

/**
 * Stack back control — same optical center as trailing glass actions.
 * Navigate first, then light haptic so the transition isn’t gated on haptics.
 */
export function StackBackButton() {
  const router = useRouter();
  return (
    <HeaderIconButton
      icon={(c) => <Chevron direction="left" size={16} color={c} />}
      accessibilityLabel="Back"
      hitSlop={8}
      style={styles.btn}
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/home");
        // Fire after pop starts — never block the gesture
        requestAnimationFrame(() => hapticSelect());
      }}
    />
  );
}

const styles = StyleSheet.create({
  btn: {
    marginLeft: 0,
  },
});
