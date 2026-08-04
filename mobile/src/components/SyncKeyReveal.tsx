import { useMemo } from "react";
import { Modal, Pressable, Share, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { formatKeyForDisplay } from "@/src/lib/syncInvite";
import { hapticLight, hapticSuccess } from "@/src/lib/haptics";
import { useTheme } from "@/src/context/ThemeContext";
import { radius, space, type ThemeColors } from "@/src/theme";


type Props = {
  visible: boolean;
  /** Door path segment (hyphenated) */
  door: string;
  onDone: () => void;
};

/** Full-attention reveal after first Turn on sync (claim). */
export function SyncKeyReveal({ visible, door, onDone }: Props) {
  const { color, ui, type } = useTheme();
  const styles = useMemo(() => makeRevealStyles(color, type), [color, type]);
  const display = formatKeyForDisplay(door);

  const copy = async () => {
    await Clipboard.setStringAsync(display);
    hapticSuccess();
  };

  const share = async () => {
    hapticLight();
    await Share.share({ message: display });
  };

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="pageSheet" onRequestClose={onDone}>
      <View style={styles.root}>
        <Text style={type.section}>Sync</Text>
        <Text style={styles.title}>Your key</Text>
        <Text style={styles.key} selectable>
          {display}
        </Text>
        <Text style={type.meta}>
          Anyone with this key can open your notes. Keep it private.
        </Text>
        <Pressable style={ui.primaryBtn} onPress={copy}>
          <Text style={ui.primaryBtnTxt}>Copy key</Text>
        </Pressable>
        <Pressable style={ui.secondaryBtn} onPress={share}>
          <Text style={ui.secondaryBtnTxt}>Share</Text>
        </Pressable>
        <Pressable style={ui.ghostBtn} onPress={onDone}>
          <Text style={ui.ghostBtnTxt}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function makeRevealStyles(color: ThemeColors, type: { caption: object; meta: object; bodyStrong: object; title: object; label: object; [k: string]: object }) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
    padding: space[6],
    paddingTop: space[12],
    gap: space[3],
    justifyContent: "center",
  },
  title: {
    ...type.title,
    fontSize: 28,
    lineHeight: 34,
  },
  key: {
    fontSize: 22,
    lineHeight: 32,
    fontWeight: "700",
    color: color.ink,
    letterSpacing: 0.2,
    backgroundColor: color.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineSoft,
    padding: space[4],
    overflow: "hidden",
  },
});
}
