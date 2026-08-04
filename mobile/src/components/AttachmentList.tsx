import React, { useState, useMemo } from "react";
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
import type { KeyverseClient } from "../api/client";
import { useTheme } from "../context/ThemeContext";
import type { ThemeColors } from "../theme";


type Props = {
  slug: string;
  attachments: Attachment[];
  client: KeyverseClient;
  onChange: (atts: Attachment[]) => void;
  /** Called after server returns full note — parent may sync blocks too */
  onNoteFromServer?: (note: { attachments?: Attachment[] }) => void;
};

export function AttachmentList({ slug, attachments, client, onChange, onNoteFromServer }: Props) {
  const { color, ui, type } = useTheme();
  const styles = useMemo(() => makeAttachStyles(color), [color]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const addUrl = async () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      Alert.alert("URL", "Use http(s) URL");
      return;
    }
    setBusy(true);
    try {
      const res = await client.addUrlAttachment(slug, u, title.trim() || undefined);
      if (isEncryptedAtt(res)) {
        Alert.alert("Encrypted", "Attachment uploaded; fold into encrypted note on next save.");
        onChange([...attachments, res.attachment as Attachment]);
      } else {
        const note = res as { attachments?: Attachment[] };
        onChange(note.attachments || []);
        onNoteFromServer?.(note);
      }
      setUrl("");
      setTitle("");
    } catch (e) {
      Alert.alert("Attach failed", String(e));
    } finally {
      setBusy(false);
    }
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
      const bin = b64ToArrayBuffer(b64);
      const res = await client.addFileAttachment(
        slug,
        bin,
        asset.name || "file",
        asset.mimeType || "application/octet-stream"
      );
      if (isEncryptedAtt(res)) {
        Alert.alert("Encrypted", "File stored in CAS; metadata needs encrypted save.");
        onChange([...attachments, res.attachment as Attachment]);
      } else {
        const note = res as { attachments?: Attachment[] };
        onChange(note.attachments || []);
        onNoteFromServer?.(note);
      }
    } catch (e) {
      Alert.alert("File attach failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (att: Attachment) => {
    setBusy(true);
    try {
      const sha = att.kind === "file" ? att.sha256 : undefined;
      const res = await client.deleteAttachment(slug, att.id, sha);
      if (isEncryptedAtt(res) || ("removed" in (res as object))) {
        onChange(attachments.filter((a) => a.id !== att.id));
      } else {
        const note = res as { attachments?: Attachment[] };
        onChange(note.attachments || []);
        onNoteFromServer?.(note);
      }
    } catch (e) {
      Alert.alert("Remove failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  const open = (att: Attachment) => {
    if (att.kind === "url") {
      Linking.openURL(att.url).catch(() => {});
      return;
    }
    const href = client.attachmentBlobUrl(att.sha256, att.name);
    Linking.openURL(href).catch(() => {});
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.h}>Attachments & links</Text>
      {attachments.length === 0 ? (
        <Text style={styles.empty}>None yet</Text>
      ) : (
        attachments.map((att) => (
          <View key={att.id} style={styles.row}>
            <Pressable onPress={() => open(att)} style={styles.main}>
              <Text style={styles.kind}>{att.kind === "url" ? "link" : "file"}</Text>
              <Text style={styles.name} numberOfLines={2}>
                {att.kind === "url" ? att.title || att.url : att.name}
              </Text>
            </Pressable>
            <Pressable onPress={() => remove(att)} hitSlop={8}>
              <Text style={styles.rm}>Remove</Text>
            </Pressable>
          </View>
        ))
      )}

      <Text style={styles.sub}>Add link</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://…"
        placeholderTextColor="#999"
      />
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Title (optional)"
        placeholderTextColor="#999"
      />
      <View style={styles.actions}>
        <Pressable style={[ui.primaryBtn, busy && { opacity: 0.5 }]} onPress={addUrl} disabled={busy}>
          <Text style={ui.primaryBtnTxt}>Add URL</Text>
        </Pressable>
        <Pressable style={[ui.secondaryBtn, busy && { opacity: 0.5 }]} onPress={addFile} disabled={busy}>
          <Text style={ui.secondaryBtnTxt}>Add file</Text>
        </Pressable>
        {busy ? <ActivityIndicator color={color.muted} /> : null}
      </View>
    </View>
  );
}

function isEncryptedAtt(res: unknown): res is { encrypted: true; attachment: Attachment } {
  return !!res && typeof res === "object" && (res as { encrypted?: boolean }).encrypted === true;
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
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

function makeAttachStyles(color: ThemeColors) {
  return StyleSheet.create({
    wrap: { marginTop: 16, gap: 8 },
    h: { fontSize: 15, fontWeight: "700", color: color.ink },
    sub: { fontSize: 13, fontWeight: "600", marginTop: 8, color: color.inkSoft },
    empty: { color: color.faint, fontSize: 13 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.lineSoft,
    },
    main: { flex: 1, gap: 2 },
    kind: {
      fontSize: 11,
      textTransform: "uppercase",
      color: color.faint,
      letterSpacing: 0.4,
    },
    name: { fontSize: 15, color: color.ink },
    rm: { color: color.danger, fontWeight: "600", fontSize: 13 },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.line,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      backgroundColor: color.paperRaised,
      color: color.ink,
    },
    actions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
    btn: {
      backgroundColor: color.primaryFill,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
    },
    btnTxt: { color: color.primaryOn, fontWeight: "600", fontSize: 14 },
  });
}
