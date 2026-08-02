import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import type { Attachment } from "../api/types";
import * as Local from "../lib/localPack";
import { newBlockId } from "../api/client";

// simple sha256 via expo-crypto
import * as Crypto from "expo-crypto";

type Props = {
  slug: string;
  attachments: Attachment[];
  onChange: (atts: Attachment[]) => void;
};

export function LocalAttachmentList({ slug, attachments, onChange }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const addUrl = async () => {
    const u = url.trim();
    if (!u) return;
    const att: Attachment = {
      id: newBlockId(),
      kind: "url",
      url: u,
      title: title.trim() || undefined,
      created_at: new Date().toISOString(),
    };
    onChange([...attachments, att]);
    setUrl("");
    setTitle("");
  };

  const addFile = async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (pick.canceled || !pick.assets?.[0]) return;
      const asset = pick.assets[0];
      setBusy(true);
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = b64ToArrayBuffer(b64);
      const digestBuf = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        new Uint8Array(bytes)
      );
      const sha = [...new Uint8Array(digestBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      await Local.saveAttachmentBytes(sha, bytes);
      const att: Attachment = {
        id: newBlockId(),
        kind: "file",
        name: asset.name || "file",
        mime: asset.mimeType || "application/octet-stream",
        sha256: sha,
        bytes: bytes.byteLength,
        created_at: new Date().toISOString(),
      };
      onChange([...attachments, att]);
    } catch (e) {
      Alert.alert("File attach failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    onChange(attachments.filter((a) => a.id !== id));
  };

  const open = async (att: Attachment) => {
    if (att.kind === "url") {
      Linking.openURL(att.url).catch(() => {});
      return;
    }
    const uri = await Local.attachmentLocalUri(att.sha256);
    if (uri) Linking.openURL(uri).catch(() => Alert.alert("Open", att.name));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.h}>Attachments & links</Text>
      {attachments.length === 0 ? (
        <Text style={styles.empty}>None yet</Text>
      ) : (
        attachments.map((att) => (
          <View key={att.id} style={styles.row}>
            <Pressable style={{ flex: 1 }} onPress={() => open(att)}>
              <Text style={styles.name} numberOfLines={1}>
                {att.kind === "url" ? att.title || att.url : att.name}
              </Text>
              <Text style={styles.meta}>
                {att.kind === "url" ? "link" : `file · ${(att.bytes || 0).toLocaleString()} B`}
              </Text>
            </Pressable>
            <Pressable onPress={() => remove(att.id)} hitSlop={8}>
              <Text style={styles.rm}>Remove</Text>
            </Pressable>
          </View>
        ))
      )}
      <View style={styles.addUrl}>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://… link"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Title (optional)"
        />
        <Pressable style={styles.btn} onPress={addUrl} disabled={busy || !url.trim()}>
          <Text style={styles.btnTxt}>Add link</Text>
        </Pressable>
      </View>
      <Pressable style={styles.btnSecondary} onPress={addFile} disabled={busy}>
        {busy ? <ActivityIndicator /> : <Text style={styles.btnSecondaryTxt}>Attach file</Text>}
      </Pressable>
      <Text style={styles.hint}>Stored on device · mirrors to cloud when enabled · {slug}</Text>
    </View>
  );
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outLen = (clean.length * 3) / 4 - padding;
  const bytes = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
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
  wrap: { marginTop: 20, gap: 8 },
  h: { fontSize: 13, fontWeight: "700", color: "#666", textTransform: "uppercase" },
  empty: { color: "#999", fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  name: { fontSize: 15, fontWeight: "600", color: "#1a5fb4" },
  meta: { fontSize: 12, color: "#888", marginTop: 2 },
  rm: { color: "#a33", fontWeight: "600", fontSize: 13 },
  addUrl: { gap: 8, marginTop: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.15)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#fff",
  },
  btn: {
    backgroundColor: "#161616",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnTxt: { color: "#fff", fontWeight: "700" },
  btnSecondary: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  btnSecondaryTxt: { fontWeight: "600", color: "#222" },
  hint: { fontSize: 11, color: "#999", marginTop: 4 },
});
