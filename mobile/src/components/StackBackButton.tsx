import { useRouter } from "expo-router";
import { StyleSheet } from "react-native";
import { hapticSelect } from "@/src/lib/haptics";
import { HeaderIconButton } from "./HeaderIconButton";

/**
 * Stack back control — same optical center as trailing glass actions.
 */
export function StackBackButton() {
  const router = useRouter();
  return (
    <HeaderIconButton
      symbol="chevron.left"
      size={20}
      weight="bold"
      accessibilityLabel="Back"
      hitSlop={8}
      style={styles.btn}
      onPress={() => {
        hapticSelect();
        if (router.canGoBack()) router.back();
        else router.replace("/home");
      }}
      fallback="‹"
    />
  );
}

const styles = StyleSheet.create({
  btn: {
    marginLeft: 0,
  },
});
