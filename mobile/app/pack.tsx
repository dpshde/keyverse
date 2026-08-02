import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSession } from "@/src/context/SessionContext";
import type { PackManifest, ProtocolInfo } from "@/src/api/types";

export default function PackScreen() {
  const { client, protocol, host, door, refreshProtocol } = useSession();
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [proto, setProto] = useState<ProtocolInfo | null>(protocol);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

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
      <Text style={styles.body}>
        Attachment bytes: {manifest?.attachment_bytes ?? "—"}
      </Text>

      <Text style={styles.h}>Endpoints (door)</Text>
      {(proto?.endpoints || []).slice(0, 16).map((e) => (
        <Text key={e} style={styles.ep}>
          {e}
        </Text>
      ))}

      <Pressable
        style={styles.btn}
        onPress={() => Linking.openURL(client.exportUrl()).catch(() => {})}
      >
        <Text style={styles.btnTxt}>Export pack zip</Text>
      </Pressable>
      <Text style={styles.hint}>
        Export is user-owned data only (protocol.json, door, notes/**, attachments/**). Import
        remains available via HTTP API / web mirror.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 6, backgroundColor: "#faf9f7" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  h: { marginTop: 14, fontSize: 13, fontWeight: "700", color: "#666", textTransform: "uppercase" },
  mono: { fontSize: 14, fontFamily: "SpaceMono", color: "#111" },
  body: { fontSize: 15, color: "#222" },
  muted: { fontSize: 13, color: "#777" },
  ep: { fontSize: 12, color: "#444", fontFamily: "SpaceMono" },
  btn: {
    marginTop: 20,
    backgroundColor: "#161616",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnTxt: { color: "#fff", fontWeight: "700" },
  hint: { fontSize: 12, color: "#888", lineHeight: 17, marginTop: 8 },
  err: { color: "#a33" },
});
