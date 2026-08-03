import { useState } from "react";
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
import { parseKeyInput, plainSyncError } from "@/src/lib/syncInvite";
import { hapticError, hapticLight, hapticSuccess } from "@/src/lib/haptics";
import { color, space, type, ui } from "@/src/theme";

type Props = {
  visible: boolean;
  busy?: boolean;
  onCancel: () => void;
  /** Normalized door segment */
  onSubmit: (door: string) => Promise<void>;
};

export function EnterSyncKey({ visible, busy: busyProp, onCancel, onSubmit }: Props) {
  const [raw, setRaw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const busy = busyProp || localBusy;

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
        {err ? <Text style={ui.err}>{err}</Text> : null}
        <Pressable style={ui.primaryBtn} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
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

const styles = StyleSheet.create({
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
