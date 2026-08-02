import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSession } from "@/src/context/SessionContext";

export default function DoorScreen() {
  const { ready, door, host, setSession } = useSession();
  const router = useRouter();
  const [h, setH] = useState(host);
  const [d, setD] = useState(door);
  const [busy, setBusy] = useState(false);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (door) {
    return <Redirect href="/home" />;
  }

  const open = async () => {
    setBusy(true);
    try {
      await setSession(h.trim() || host, d.trim());
      router.replace("/home");
    } catch (e) {
      Alert.alert("Could not open door", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>keyverse</Text>
        <Text style={styles.sub}>Mobile client · full protocol door</Text>
        <Text style={styles.label}>Host</Text>
        <TextInput
          style={styles.input}
          value={h}
          onChangeText={setH}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://…"
        />
        <Text style={styles.label}>Door (multiword key)</Text>
        <TextInput
          style={styles.input}
          value={d}
          onChangeText={setD}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="quiet-river-lantern-…"
          onSubmitEditing={open}
        />
        <Pressable style={styles.btn} onPress={open} disabled={busy || !d.trim()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Open pack</Text>}
        </Pressable>
        <Text style={styles.hint}>
          The door URL is the secret. Same packs as the web mirror — notes, attachments, links.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f6f5f2",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { gap: 10 },
  brand: { fontSize: 34, fontWeight: "700", letterSpacing: -0.5, color: "#111" },
  sub: { fontSize: 15, color: "#666", marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "600", color: "#444", marginTop: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.18)",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  btn: {
    marginTop: 12,
    backgroundColor: "#161616",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
  hint: { marginTop: 16, fontSize: 13, lineHeight: 18, color: "#777" },
});
