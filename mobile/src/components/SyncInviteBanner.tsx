import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { hapticSelect } from "@/src/lib/haptics";
import { useTheme } from "@/src/context/ThemeContext";
import { radius, space, type ThemeColors } from "@/src/theme";


type Props = {
  onTurnOn: () => void;
  onEnterKey: () => void;
  onDismiss: () => void;
};

/** Soft home invite after first note — job-first copy, no key preview. */
export function SyncInviteBanner({ onTurnOn, onEnterKey, onDismiss }: Props) {
  const { color, ui, type } = useTheme();
  const styles = useMemo(() => makeInviteStyles(color, type), [color, type]);
  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Text style={styles.q}>Use these notes on another device?</Text>
      <View style={styles.actions}>
        <Pressable
          style={[ui.primaryBtn, styles.btn]}
          onPress={() => {
            hapticSelect();
            onTurnOn();
          }}
        >
          <Text style={ui.primaryBtnTxt}>Turn on sync</Text>
        </Pressable>
        <Pressable
          style={[ui.secondaryBtn, styles.btn]}
          onPress={() => {
            hapticSelect();
            onEnterKey();
          }}
        >
          <Text style={ui.secondaryBtnTxt}>Enter a key</Text>
        </Pressable>
        <Pressable
          style={styles.dismiss}
          onPress={() => {
            hapticSelect();
            onDismiss();
          }}
          hitSlop={8}
        >
          <Text style={styles.dismissTxt}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeInviteStyles(color: ThemeColors, type: { caption: object; meta: object; bodyStrong: object; title: object; label: object; [k: string]: object }) {
  return StyleSheet.create({
  wrap: {
    marginHorizontal: space[4],
    marginTop: space[3],
    marginBottom: space[1],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: color.paperRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineSoft,
    gap: space[3],
  },
  q: {
    ...type.bodyStrong,
    fontSize: 16,
  },
  actions: { gap: space[2] },
  btn: { width: "100%" },
  dismiss: {
    alignItems: "center",
    paddingVertical: space[2],
  },
  dismissTxt: {
    ...type.meta,
    fontWeight: "600",
    color: color.muted,
  },
});
}
