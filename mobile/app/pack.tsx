import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useSession } from "@/src/context/SessionContext";
import type { PackManifest, ProtocolInfo } from "@/src/api/types";

export default function PackScreen() {
  const { client, protocol, host, door, setSession, refreshProtocol } = useSession();
  const router = useRouter();
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [proto, setProto] = useState<ProtocolInfo | null>(protocol);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    (async () => {
      if (!client) return;
      setBusy(true);
      try {
        const [m, p] = await Promise.all([client.packManifest(), refreshProtocol()]);
        setManifest(m);
        if (p) setProto(p);
      } catch (e) {
        setErr(String(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [client, refreshProtocol]);

  if (!client) {
    return (
      <View style={styles.center}>
        <Text>No door</Text>
      </View>
    );
  }
  if (busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const features = proto?.features || {};
  const featureLines = Object.entries(features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const exportPack = async () => {
    setWorking(true);
    try {
      const bytes = await client.exportPackBytes();
      const b64 = arrayBufferToBase64(bytes);
      const path = `${FileSystem.cacheDirectory}keyverse-${door}-export.zip`;
      await FileSystem.writeAsStringAsync(path, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: "application/zip",
          dialogTitle: "Export keyverse pack",
        });
      } else {
        await Linking.openURL(client.exportUrl());
      }
    } catch (e) {
      Alert.alert("Export failed", String(e));
    } finally {
      setWorking(false);
    }
  };

  const importPack = async (mode: "merge" | "replace") => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: "application/zip",
      });
      if (pick.canceled || !pick.assets?.[0]) return;
      if (mode === "replace") {
        const ok = await new Promise<boolean>((resolve) => {
          Alert.alert("Replace pack?", "Deletes existing notes/attachments first.", [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Replace", style: "destructive", onPress: () => resolve(true) },
          ]);
        });
        if (!ok) return;
      }
      setWorking(true);
      const b64 = await FileSystem.readAsStringAsync(pick.assets[0].uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = base64ToArrayBuffer(b64);
      const res = await client.importPack(bytes, mode);
      Alert.alert("Import ok", JSON.stringify(res).slice(0, 200));
      const m = await client.packManifest();
      setManifest(m);
    } catch (e) {
      Alert.alert("Import failed", String(e));
    } finally {
      setWorking(false);
    }
  };

  const rotate = async () => {
    Alert.alert(
      "Rotate door?",
      "Creates a new multiword key for this pack. Update bookmarks.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rotate",
          style: "destructive",
          onPress: async () => {
            setWorking(true);
            try {
              const r = await client.rotateDoor();
              await setSession(host, r.door);
              Alert.alert("Rotated", `New door: ${r.door}`);
              router.replace("/home");
            } catch (e) {
              Alert.alert("Rotate failed", String(e));
            } finally {
              setWorking(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.root}>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <Text style={styles.h}>Door</Text>
      <Text style={styles.mono}>
        {host}/{door}
      </Text>

      <Text style={styles.h}>Protocol</Text>
      <Text style={styles.body}>
        {proto?.protocol || "keyverse"} {proto?.version || "?"}
      </Text>
      <Text style={styles.muted}>Features: {featureLines.join(", ") || "—"}</Text>
      {proto?.max_attach_bytes ? (
        <Text style={styles.muted}>
          Max attachment: {Math.round(proto.max_attach_bytes / (1024 * 1024))} MB
        </Text>
      ) : null}

      <Text style={styles.h}>Pack</Text>
      <Text style={styles.body}>Notes: {manifest?.notes ?? "—"}</Text>
      <Text style={styles.body}>Attachments: {manifest?.attachments ?? "—"}</Text>
      <Text style={styles.body}>Attachment bytes: {manifest?.attachment_bytes ?? "—"}</Text>

      <Text style={styles.h}>Ownership</Text>
      <Pressable style={styles.btn} onPress={exportPack} disabled={working}>
        <Text style={styles.btnTxt}>{working ? "…" : "Export pack zip"}</Text>
      </Pressable>
      <Pressable style={styles.btnSecondary} onPress={() => importPack("merge")} disabled={working}>
        <Text style={styles.btnSecondaryTxt}>Import zip (merge)</Text>
      </Pressable>
      <Pressable style={styles.btnSecondary} onPress={() => importPack("replace")} disabled={working}>
        <Text style={styles.btnSecondaryTxt}>Import zip (replace)</Text>
      </Pressable>
      <Pressable style={styles.btnDanger} onPress={rotate} disabled={working}>
        <Text style={styles.btnTxt}>Rotate door key</Text>
      </Pressable>

      <Text style={styles.h}>Endpoints</Text>
      {(proto?.endpoints || []).map((e) => (
        <Text key={e} style={styles.ep}>
          {e}
        </Text>
      ))}
    </View>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += b === undefined ? "=" : chars[(n >> 6) & 63];
    out += c === undefined ? "=" : chars[n & 63];
  }
  return out;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const len = clean.length;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outLen = (len * 3) / 4 - padding;
  const bytes = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const n =
      (chars.indexOf(clean[i]) << 18) |
      (chars.indexOf(clean[i + 1]) << 12) |
      (chars.indexOf(clean[i + 2]) << 6) |
      chars.indexOf(clean[i + 3]);
    if (p < outLen) bytes[p++] = (n >> 16) & 255;
    if (p < outLen) bytes[p++] = (n >> 8) & 255;
    if (p < outLen) bytes[p++] = n & 255;
  }
  return bytes.buffer;
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 6, backgroundColor: "#faf9f7" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  h: { marginTop: 14, fontSize: 13, fontWeight: "700", color: "#666", textTransform: "uppercase" },
  mono: { fontSize: 14, color: "#111" },
  body: { fontSize: 15, color: "#222" },
  muted: { fontSize: 13, color: "#777" },
  ep: { fontSize: 11, color: "#444" },
  btn: {
    marginTop: 10,
    backgroundColor: "#161616",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnSecondary: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.15)",
  },
  btnDanger: {
    marginTop: 8,
    backgroundColor: "#8b1a1a",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnTxt: { color: "#fff", fontWeight: "700" },
  btnSecondaryTxt: { color: "#111", fontWeight: "600" },
  err: { color: "#a33" },
});
