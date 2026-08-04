import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { formatKeyForDisplay, parseKeyInput, plainSyncError } from "@/src/lib/syncInvite";
import { hapticError, hapticLight, hapticSelect, hapticSuccess } from "@/src/lib/haptics";
import { useTheme } from "@/src/context/ThemeContext";
import { space, type ThemeColors } from "@/src/theme";

type Props = {
  visible: boolean;
  busy?: boolean;
  onCancel: () => void;
  /** Normalized door segment */
  onSubmit: (door: string) => Promise<void>;
};

/**
 * Sheet to type or paste a multiword sync key.
 * “Paste key” reads the clipboard and parses in one step.
 */
export function EnterSyncKey({ visible, busy: busyProp, onCancel, onSubmit }: Props) {
  const { color, ui, type } = useTheme();
  const styles = useMemo(() => makeEnterKeyStyles(color, type), [color, type]);
  const [raw, setRaw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const busy = busyProp || localBusy;

  useEffect(() => {
    if (!visible) return;
    setErr(null);
    setRaw("");
  }, [visible]);

  const pasteAndParse = useCallback(async () => {
    try {
      const clip = (await Clipboard.getStringAsync())?.trim() ?? "";
      if (!clip) {
        setErr("Clipboard is empty.");
        hapticLight();
        return;
      }
      const door = parseKeyInput(clip);
      if (!door) {
        setErr("Clipboard doesn’t look like a key.");
        hapticLight();
        return;
      }
      // Show the normalized words in the field
      setRaw(formatKeyForDisplay(door));
      setErr(null);
      hapticSelect();
    } catch {
      setErr("Couldn’t read the clipboard.");
      hapticLight();
    }
  }, []);

  const submit = async () => {
    const door = parseKeyInput(raw);
    if (!door) {
      setErr("Enter your key to continue.");
      hapticLight();
      return;
    }
    setErr(null);
    setLocalBusy(true);
    try {
      await onSubmit(door);
      hapticSuccess();
      setRaw("");
    } catch (e) {
      hapticError();
      setErr(plainSyncError(e, "enter"));
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Text style={type.section}>Sync</Text>
        <Text style={styles.title}>Enter key</Text>
        <Text style={type.meta}>Paste or type the key from your other device.</Text>
        <TextInput
          style={ui.input}
          value={raw}
          onChangeText={(t) => {
            setRaw(t);
            if (err) setErr(null);
          }}
          placeholder="quiet river lantern stone"
          placeholderTextColor={color.faint}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          editable={!busy}
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        <Pressable
          style={ui.secondaryBtn}
          onPress={() => void pasteAndParse()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Paste and parse key from clipboard"
        >
          <Text style={ui.secondaryBtnTxt}>Paste key</Text>
        </Pressable>
        {err ? <Text style={ui.err}>{err}</Text> : null}
        <Pressable style={ui.primaryBtn} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={color.primaryOn} />
          ) : (
            <Text style={ui.primaryBtnTxt}>Continue</Text>
          )}
        </Pressable>
        <Pressable
          style={ui.ghostBtn}
          onPress={() => {
            setRaw("");
            setErr(null);
            onCancel();
          }}
          disabled={busy}
        >
          <Text style={ui.ghostBtnTxt}>Cancel</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeEnterKeyStyles(
  color: ThemeColors,
  type: {
    caption: object;
    meta: object;
    bodyStrong: object;
    title: object;
    label: object;
    [k: string]: object;
  }
) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: color.paper,
      padding: space[6],
      paddingTop: space[12],
      gap: space[3],
    },
    title: {
      ...type.title,
      fontSize: 28,
      lineHeight: 34,
    },
  });
}
