import { useMemo } from "react";
import { Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSession } from "@/src/context/SessionContext";
import { doorBase } from "@/src/api/client";

export default function ShareScreen() {
  const { cloudEnabled, cloudHost, cloudDoor, client } = useSession();

  const url = useMemo(() => {
    if (!cloudEnabled || !cloudDoor) return "";
    return doorBase({ host: cloudHost, door: cloudDoor }) + "/";
  }, [cloudEnabled, cloudHost, cloudDoor]);

  const qr = client && cloudEnabled ? client.shareQrUrl(cloudHost) : "";

  if (!cloudEnabled) {
    return (
      <View style={styles.root}>
        <Text style={styles.h}>Share</Text>
        <Text style={styles.hint}>
          Cloud is off. Notes live only on this device. Turn on cloud in Settings to get a multiword
          door URL you can share or open on the web mirror.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.h}>Share cloud door</Text>
      <Text style={styles.hint}>
        Anyone with this URL can read and write the mirrored pack. Treat it like a password.
      </Text>
      <Text style={styles.url} selectable>
        {url}
      </Text>
      <Pressable style={styles.btn} onPress={async () => Clipboard.setStringAsync(url)}>
        <Text style={styles.btnTxt}>Copy URL</Text>
      </Pressable>
      <Pressable style={styles.btnSecondary} onPress={() => Share.share({ message: url, url })}>
        <Text style={styles.btnSecondaryTxt}>System share</Text>
      </Pressable>
      {qr ? (
        <View style={styles.qrWrap}>
          <Text style={styles.h}>QR</Text>
          <Image source={{ uri: qr }} style={styles.qr} resizeMode="contain" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12, backgroundColor: "#faf9f7" },
  h: { fontSize: 13, fontWeight: "700", color: "#666", textTransform: "uppercase" },
  hint: { fontSize: 14, color: "#666", lineHeight: 20 },
  url: {
    fontSize: 15,
    color: "#111",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 10,
  },
  btn: {
    backgroundColor: "#161616",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnTxt: { color: "#fff", fontWeight: "700" },
  btnSecondary: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.15)",
  },
  btnSecondaryTxt: { fontWeight: "600", color: "#111" },
  qrWrap: { marginTop: 12, alignItems: "center", gap: 8 },
  qr: { width: 220, height: 220, backgroundColor: "#fff", borderRadius: 12 },
});
