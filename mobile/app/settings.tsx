import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSession } from "@/src/context/SessionContext";
import type { TranslationId } from "@/src/lib/textBundle";

const DEFAULT_HOST = "https://keyverse-production.up.railway.app";

export default function SettingsScreen() {
  const {
    translation,
    setTranslation,
    cloudEnabled,
    cloudDoor,
    cloudHost,
    lastSyncAt,
    enableCloud,
    disableCloud,
    syncCloud,
    protocol,
  } = useSession();
  const [host, setHost] = useState(cloudHost || DEFAULT_HOST);
  const [busy, setBusy] = useState(false);

  const onToggleCloud = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        const res = await enableCloud(host.trim() || DEFAULT_HOST);
        Alert.alert(
          "Cloud on",
          `Door assigned:\n${res.door}\n\nPushed ${res.pushed} notes · pulled ${res.pulled}\nSave this multiword key — it doubles your local pack to the host.`
        );
      } else {
        await disableCloud();
      }
    } catch (e) {
      Alert.alert("Cloud toggle failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSync = async () => {
    setBusy(true);
    try {
      const res = await syncCloud();
      Alert.alert("Synced", `Pushed ${res.pushed} · pulled ${res.pulled}`);
    } catch (e) {
      Alert.alert("Sync failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.h}>Scripture text</Text>
      <Text style={styles.hint}>Bundled on device (public domain). No network required to read.</Text>
      <View style={styles.row}>
        {(["BSB", "KJV"] as TranslationId[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.chip, translation === t && styles.chipOn]}
            onPress={() => setTranslation(t)}
          >
            <Text style={[styles.chipTxt, translation === t && styles.chipTxtOn]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.h}>Storage</Text>
      <Text style={styles.body}>
        Default: <Text style={styles.bold}>local pack</Text> on this device. Notes, outlines,
        attachments stay here first.
      </Text>

      <Text style={styles.h}>Cloud mirror</Text>
      <Text style={styles.hint}>
        Toggle on → host assigns a multiword door and copies this pack up (and pulls any remote
        notes down). Local remains the working copy.
      </Text>
      <View style={styles.switchRow}>
        <Text style={styles.body}>Enable cloud sync</Text>
        {busy ? (
          <ActivityIndicator />
        ) : (
          <Switch value={cloudEnabled} onValueChange={onToggleCloud} />
        )}
      </View>
      <Text style={styles.label}>Host</Text>
      <TextInput
        style={styles.input}
        value={host}
        onChangeText={setHost}
        autoCapitalize="none"
        editable={!cloudEnabled}
      />
      {cloudEnabled ? (
        <>
          <Text style={styles.label}>Door</Text>
          <Text style={styles.mono} selectable>
            {cloudDoor}
          </Text>
          <Text style={styles.meta}>
            Last sync: {lastSyncAt ? lastSyncAt.replace("T", " ").slice(0, 19) : "—"}
          </Text>
          {protocol ? (
            <Text style={styles.meta}>
              Protocol {protocol.version} · {protocol.protocol}
            </Text>
          ) : null}
          <Pressable style={styles.btn} onPress={onSync} disabled={busy}>
            <Text style={styles.btnTxt}>Sync now</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 8, backgroundColor: "#faf9f7" },
  h: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: "700",
    color: "#666",
    textTransform: "uppercase",
  },
  hint: { fontSize: 13, color: "#777", lineHeight: 18 },
  body: { fontSize: 15, color: "#222", lineHeight: 21 },
  bold: { fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, marginTop: 4 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  chipOn: { backgroundColor: "#161616" },
  chipTxt: { fontWeight: "700", color: "#333" },
  chipTxtOn: { color: "#fff" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  label: { fontSize: 12, fontWeight: "600", color: "#666", marginTop: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.15)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    fontSize: 15,
  },
  mono: { fontSize: 15, color: "#111", fontWeight: "600" },
  meta: { fontSize: 12, color: "#888" },
  btn: {
    marginTop: 12,
    backgroundColor: "#161616",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnTxt: { color: "#fff", fontWeight: "700" },
});
