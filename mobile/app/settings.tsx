import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useSession } from "@/src/context/SessionContext";
import type { TranslationId } from "@/src/lib/textBundle";
import * as Local from "@/src/lib/localPack";
import {
  exportLocalPackZip,
  importLocalPackZip,
} from "@/src/lib/packTransfer";
import { b64ToArrayBuffer } from "@/src/lib/bytes";

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
    client,
  } = useSession();
  const [host, setHost] = useState(cloudHost || DEFAULT_HOST);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({ notes: 0, label: "…" });

  const refreshStats = useCallback(async () => {
    const notes = await Local.listNotes();
    setStats({ notes: notes.length, label: `${notes.length} local notes` });
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const onToggleCloud = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        const res = await enableCloud(host.trim() || DEFAULT_HOST);
        Alert.alert(
          "Cloud on",
          `Door assigned:\n${res.door}\n\nPushed ${res.pushed} notes · pulled ${res.pulled}`
        );
      } else {
        await disableCloud();
      }
    } catch (e) {
      Alert.alert("Cloud toggle failed", String(e));
    } finally {
      setBusy(false);
      refreshStats();
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
      refreshStats();
    }
  };

  /** Local pack zip → share sheet (protocol user-data only). */
  const onExportLocal = async () => {
    setBusy(true);
    try {
      const res = await exportLocalPackZip({
        door: cloudEnabled ? cloudDoor : undefined,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.path, {
          mimeType: "application/zip",
          dialogTitle: "Export keyverse pack",
          UTI: "public.zip-archive",
        });
      } else {
        Alert.alert("Exported", `${res.filename}\n${res.notes} notes · ${res.attachments} files`);
      }
    } catch (e) {
      Alert.alert("Export failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Import pack zip into local (merge | replace). */
  const onImportLocal = async (mode: "merge" | "replace") => {
    try {
      if (mode === "replace") {
        const ok = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Replace local pack?",
            "Deletes existing local notes and attachments, then imports the zip.",
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Replace", style: "destructive", onPress: () => resolve(true) },
            ]
          );
        });
        if (!ok) return;
      }
      const pick = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ["application/zip", "application/x-zip-compressed", "*/*"],
      });
      if (pick.canceled || !pick.assets?.[0]) return;
      setBusy(true);
      const b64 = await FileSystem.readAsStringAsync(pick.assets[0].uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = b64ToArrayBuffer(b64);
      const res = await importLocalPackZip(bytes, mode);
      Alert.alert(
        "Import complete",
        `${mode}: ${res.notes} notes · ${res.attachments} attachments · ${res.files} zip entries`
      );
      if (cloudEnabled) {
        Alert.alert(
          "Cloud is on",
          "Local pack updated. Tap Sync now to double this import up to the cloud door."
        );
      }
      refreshStats();
    } catch (e) {
      Alert.alert("Import failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Download cloud export zip and merge into local. */
  const onImportFromCloudExport = async () => {
    if (!client) {
      Alert.alert("Cloud off", "Enable cloud first.");
      return;
    }
    setBusy(true);
    try {
      const bytes = await client.exportPackBytes();
      const res = await importLocalPackZip(bytes, "merge");
      Alert.alert(
        "Imported from cloud",
        `Merged ${res.notes} notes · ${res.attachments} attachments`
      );
      refreshStats();
    } catch (e) {
      Alert.alert("Cloud import failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Push current local pack zip to cloud import API. */
  const onPushZipToCloud = async (mode: "merge" | "replace") => {
    if (!client) {
      Alert.alert("Cloud off", "Enable cloud first.");
      return;
    }
    setBusy(true);
    try {
      const exp = await exportLocalPackZip({ door: cloudDoor });
      const b64 = await FileSystem.readAsStringAsync(exp.path, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = b64ToArrayBuffer(b64);
      const res = await client.importPack(bytes, mode);
      Alert.alert("Cloud import API", JSON.stringify(res).slice(0, 240));
      await syncCloud().catch(() => {});
      refreshStats();
    } catch (e) {
      Alert.alert("Push to cloud failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={styles.h}>Scripture text</Text>
      <Text style={styles.hint}>Bundled BSB + KJV on device. No network to read.</Text>
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

      <Text style={styles.h}>Local pack</Text>
      <Text style={styles.body}>{stats.label}</Text>
      <Text style={styles.hint}>
        Export/import uses the same zip shape as the web door: protocol.json, notes/**,
        attachments/** (no scripture text).
      </Text>
      <Pressable style={styles.btn} onPress={onExportLocal} disabled={busy}>
        <Text style={styles.btnTxt}>{busy ? "…" : "Export pack zip"}</Text>
      </Pressable>
      <Pressable
        style={styles.btnSecondary}
        onPress={() => onImportLocal("merge")}
        disabled={busy}
      >
        <Text style={styles.btnSecondaryTxt}>Import zip (merge)</Text>
      </Pressable>
      <Pressable
        style={styles.btnSecondary}
        onPress={() => onImportLocal("replace")}
        disabled={busy}
      >
        <Text style={styles.btnSecondaryTxt}>Import zip (replace)</Text>
      </Pressable>

      <Text style={styles.h}>Cloud mirror</Text>
      <Text style={styles.hint}>
        Toggle on → multiword door + double local to host. Import/export still work offline.
      </Text>
      <View style={styles.switchRow}>
        <Text style={styles.body}>Enable cloud sync</Text>
        {busy ? <ActivityIndicator /> : <Switch value={cloudEnabled} onValueChange={onToggleCloud} />}
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
          <Pressable style={styles.btnSecondary} onPress={onImportFromCloudExport} disabled={busy}>
            <Text style={styles.btnSecondaryTxt}>Pull cloud export → local</Text>
          </Pressable>
          <Pressable
            style={styles.btnSecondary}
            onPress={() => onPushZipToCloud("merge")}
            disabled={busy}
          >
            <Text style={styles.btnSecondaryTxt}>Push local zip → cloud (merge)</Text>
          </Pressable>
          <Pressable
            style={styles.btnSecondary}
            onPress={() => onPushZipToCloud("replace")}
            disabled={busy}
          >
            <Text style={styles.btnSecondaryTxt}>Push local zip → cloud (replace)</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: "#faf9f7" },
  h: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: "700",
    color: "#666",
    textTransform: "uppercase",
  },
  hint: { fontSize: 13, color: "#777", lineHeight: 18, marginBottom: 6 },
  body: { fontSize: 15, color: "#222", lineHeight: 21 },
  row: { flexDirection: "row", gap: 10, marginTop: 4, marginBottom: 4 },
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
    marginTop: 10,
    backgroundColor: "#161616",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnTxt: { color: "#fff", fontWeight: "700" },
  btnSecondary: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.15)",
  },
  btnSecondaryTxt: { color: "#111", fontWeight: "600" },
});
