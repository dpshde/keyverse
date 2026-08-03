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
import { SymbolView } from "expo-symbols";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import type { Attachment } from "../api/types";
import * as Local from "../lib/localPack";
import { newBlockId } from "../api/client";
import { hapticLight, hapticSelect, hapticSuccess, hapticWarning } from "../lib/haptics";
import { color, type, ui } from "../theme";

// simple sha256 via expo-crypto
import * as Crypto from "expo-crypto";

type Props = {
  slug: string;
  attachments: Attachment[];
  onChange: (atts: Attachment[]) => void;
};

export function LocalAttachmentList({ attachments, onChange }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  /** Collapsed by default so note typing stays the primary path */
  const [adding, setAdding] = useState(false);

  const addUrl = async () => {
    const u = url.trim();
    if (!u) return;
    hapticSuccess();
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
      hapticLight();
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
      hapticSuccess();
    } catch (e) {
      Alert.alert("File attach failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    hapticWarning();
    onChange(attachments.filter((a) => a.id !== id));
  };

  const open = async (att: Attachment) => {
    hapticSelect();
    if (att.kind === "url") {
      Linking.openURL(att.url).catch(() => {});
      return;
    }
    const uri = await Local.attachmentLocalUri(att.sha256);
    if (uri) Linking.openURL(uri).catch(() => Alert.alert("Open", att.name));
  };

  return (
    <View style={styles.wrap}>
      {attachments.length > 0 ? (
        <>
          {attachments.map((att) => (
            <View key={att.id} style={styles.row}>
              <Pressable style={{ flex: 1 }} onPress={() => open(att)}>
                <Text style={styles.name} numberOfLines={1}>
                  {att.kind === "url" ? att.title || att.url : att.name}
                </Text>
                <Text style={type.caption}>
                  {att.kind === "url" ? "link" : `file · ${(att.bytes || 0).toLocaleString()} B`}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => remove(att.id)}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
                hitSlop={6}
              >
                <SymbolView
                  name="trash"
                  size={18}
                  weight="medium"
                  tintColor={color.muted}
                  fallback={<Text style={styles.iconFallback}>⌫</Text>}
                />
              </Pressable>
            </View>
          ))}
        </>
      ) : null}

      {adding ? (
        <View style={styles.addUrl}>
          <TextInput
            style={ui.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://… link"
            placeholderTextColor={color.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={ui.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Title (optional)"
            placeholderTextColor={color.faint}
          />
          <View style={styles.addActions}>
            <Pressable
              style={[styles.iconBtnLg, (busy || !url.trim()) && { opacity: 0.4 }]}
              onPress={addUrl}
              disabled={busy || !url.trim()}
              accessibilityLabel="Add link"
            >
              <SymbolView
                name="link"
                size={20}
                weight="semibold"
                tintColor={color.ink}
                fallback={<Text style={styles.iconFallback}>🔗</Text>}
              />
            </Pressable>
            <Pressable
              style={[styles.iconBtnLg, busy && { opacity: 0.4 }]}
              onPress={addFile}
              disabled={busy}
              accessibilityLabel="Attach file"
            >
              {busy ? (
                <ActivityIndicator color={color.muted} />
              ) : (
                <SymbolView
                  name="paperclip"
                  size={20}
                  weight="semibold"
                  tintColor={color.ink}
                  fallback={<Text style={styles.iconFallback}>📎</Text>}
                />
              )}
            </Pressable>
            <Pressable
              style={styles.iconBtnLg}
              onPress={() => {
                hapticSelect();
                setAdding(false);
              }}
              accessibilityLabel="Done"
            >
              <SymbolView
                name="checkmark"
                size={20}
                weight="bold"
                tintColor={color.ink}
                fallback={<Text style={styles.iconFallback}>✓</Text>}
              />
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          style={styles.addTrigger}
          onPress={() => {
            hapticSelect();
            setAdding(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={attachments.length ? "Add another attachment" : "Add link or file"}
        >
          <SymbolView
            name="paperclip"
            size={18}
            weight="medium"
            tintColor={color.inkSoft}
            fallback={<Text style={styles.iconFallback}>+</Text>}
          />
          <Text style={styles.addTriggerTxt}>
            {attachments.length ? "Add attachment" : "Attach"}
          </Text>
        </Pressable>
      )}
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
  wrap: { gap: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.lineSoft,
  },
  name: { fontSize: 15, fontWeight: "600", color: color.ink },
  addUrl: { gap: 8, marginTop: 4 },
  addActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingVertical: 4,
  },
  addTriggerTxt: {
    fontSize: 14,
    fontWeight: "600",
    color: color.inkSoft,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnLg: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: color.fill,
  },
  iconFallback: {
    fontSize: 16,
    fontWeight: "600",
    color: color.inkSoft,
  },
});
