import { Link, useRouter } from "expo-router";
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
import { KeyverseClient } from "@/src/api/client";

const DEFAULT_HOST = "https://keyverse-production.up.railway.app";

export default function DoorScreen() {
  const { ready, door, host, setSession } = useSession();
  const router = useRouter();
  const [h, setH] = useState(host || DEFAULT_HOST);
  const [d, setD] = useState(door);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"open" | "create">("open");

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (door) {
    router.replace("/home");
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const open = async () => {
    setBusy(true);
    try {
      await setSession(h.trim() || DEFAULT_HOST, d.trim());
      router.replace("/home");
    } catch (e) {
      Alert.alert("Could not open door", String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const hostN = (h.trim() || DEFAULT_HOST).replace(/\/+$/, "");
      const c = new KeyverseClient({ host: hostN, door: "" });
      const claimed = await c.setupClaim(d.trim());
      await setSession(hostN, claimed);
      router.replace("/home");
    } catch (e) {
      Alert.alert("Create failed", String(e));
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
        <Text style={styles.sub}>Mobile product · full protocol client</Text>

        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, mode === "open" && styles.tabOn]}
            onPress={() => setMode("open")}
          >
            <Text style={[styles.tabTxt, mode === "open" && styles.tabTxtOn]}>Open door</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, mode === "create" && styles.tabOn]}
            onPress={() => setMode("create")}
          >
            <Text style={[styles.tabTxt, mode === "create" && styles.tabTxtOn]}>Create pack</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Host</Text>
        <TextInput
          style={styles.input}
          value={h}
          onChangeText={setH}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://…"
        />
        <Text style={styles.label}>
          {mode === "create" ? "New multiword key" : "Door (multiword key)"}
        </Text>
        <TextInput
          style={styles.input}
          value={d}
          onChangeText={setD}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="quiet-river-lantern-…"
          onSubmitEditing={mode === "open" ? open : create}
        />
        <Pressable
          style={styles.btn}
          onPress={mode === "open" ? open : create}
          disabled={busy || !d.trim()}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnTxt}>{mode === "open" ? "Open pack" : "Create & open"}</Text>
          )}
        </Pressable>
        <Text style={styles.hint}>
          Same packs as the web mirror. Door URL is the secret. Notes, attachments, links, encryption
          passphrase stay on-device.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#f6f5f2" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { gap: 10 },
  brand: { fontSize: 34, fontWeight: "700", letterSpacing: -0.5, color: "#111" },
  sub: { fontSize: 15, color: "#666", marginBottom: 8 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 4 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.06)",
    alignItems: "center",
  },
  tabOn: { backgroundColor: "#161616" },
  tabTxt: { fontWeight: "600", color: "#444" },
  tabTxtOn: { color: "#fff" },
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
