/**
 * Note attachments — list inline; add via bottom sheet (file + link).
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { Attachment } from "../api/types";
import * as Local from "../lib/localPack";
import { newBlockId } from "../api/client";
import { hapticLight, hapticSelect, hapticSuccess, hapticWarning } from "../lib/haptics";
import { motionDuration, motionSpring, MOTION_MS } from "../lib/motion";
import { useTheme } from "../context/ThemeContext";
import { radius, space, tap, tapComfy, type ThemeColors } from "../theme";

/** Off-screen parking for the sheet — larger than typical sheet height. */
const SHEET_OFF = Math.min(520, Dimensions.get("window").height * 0.55);

type Props = {
  slug: string;
  attachments: Attachment[];
  onChange: (atts: Attachment[]) => void;
};

export function LocalAttachmentList({ attachments, onChange }: Props) {
  const { color, type } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);
  const insets = useSafeAreaInsets();
  /** Modal mounted (visible). Motion is Reanimated (transform + opacity only). */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const sheetY = useSharedValue(SHEET_OFF);
  const backdropOp = useSharedValue(0);
  const closingRef = useRef(false);

  const finishClose = useCallback(() => {
    closingRef.current = false;
    setSheetOpen(false);
    setUrl("");
    sheetY.value = SHEET_OFF;
    backdropOp.value = 0;
  }, [backdropOp, sheetY]);

  const abortClose = useCallback(() => {
    closingRef.current = false;
  }, []);

  const closeSheet = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const exitMs = motionDuration(MOTION_MS.exit);
    const baseMs = motionDuration(MOTION_MS.base);
    backdropOp.value = withTiming(0, {
      duration: exitMs,
      easing: Easing.out(Easing.cubic),
    });
    sheetY.value = withTiming(
      SHEET_OFF,
      { duration: baseMs, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(finishClose)();
        } else {
          runOnJS(abortClose)();
        }
      }
    );
  }, [backdropOp, sheetY, finishClose, abortClose]);

  const openSheet = useCallback(() => {
    hapticSelect();
    closingRef.current = false;
    sheetY.value = SHEET_OFF;
    backdropOp.value = 0;
    setSheetOpen(true);
    // Next frame so Modal is mounted before we animate in.
    requestAnimationFrame(() => {
      const openMs = motionDuration(MOTION_MS.base);
      backdropOp.value = withTiming(1, {
        duration: openMs,
        easing: Easing.out(Easing.cubic),
      });
      const spring = motionSpring("snappy");
      if (spring) {
        sheetY.value = withSpring(0, spring);
      } else {
        sheetY.value = withTiming(0, { duration: 0 });
      }
    });
  }, [backdropOp, sheetY]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOp.value,
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  /** Add a URL attachment and dismiss the sheet. Optional override for paste. */
  const addUrl = useCallback(
    (raw?: string) => {
      const u = (raw ?? url).trim();
      if (!u) return;
      hapticSuccess();
      const att: Attachment = {
        id: newBlockId(),
        kind: "url",
        url: u,
        created_at: new Date().toISOString(),
      };
      onChange([...attachments, att]);
      closeSheet();
    },
    [url, attachments, onChange, closeSheet]
  );

  /** Paste from clipboard and attach immediately. */
  const pasteLink = useCallback(async () => {
    try {
      const clip = (await Clipboard.getStringAsync())?.trim() ?? "";
      if (!clip) {
        hapticLight();
        Alert.alert("Clipboard empty", "Copy a link first, then tap Paste.");
        return;
      }
      // Strip wrapping quotes / angle brackets browsers sometimes leave
      const cleaned = clip
        .replace(/^<|>$/g, "")
        .replace(/^["']|["']$/g, "")
        .trim();
      if (!cleaned) {
        hapticLight();
        Alert.alert("Clipboard empty", "Copy a link first, then tap Paste.");
        return;
      }
      setUrl(cleaned);
      addUrl(cleaned);
    } catch {
      hapticLight();
      Alert.alert("Paste failed", "Couldn’t read the clipboard.");
    }
  }, [addUrl]);

  const addFile = useCallback(async () => {
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
      const sha = [...new Uint8Array(digestBuf)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
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
      closeSheet();
    } catch (e) {
      Alert.alert("File attach failed", String(e));
    } finally {
      setBusy(false);
    }
  }, [attachments, onChange, closeSheet]);

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

  const padBottom = Math.max(insets.bottom, space[4]);

  return (
    <View style={styles.wrap}>
      {attachments.length > 0
        ? attachments.map((att) => (
            <View key={att.id} style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() => open(att)}
                accessibilityRole="button"
                accessibilityLabel={
                  att.kind === "url"
                    ? `Open link ${att.title || att.url}`
                    : `Open file ${att.name}`
                }
              >
                <Text style={styles.name} numberOfLines={1}>
                  {att.kind === "url" ? att.title || att.url : att.name}
                </Text>
                <Text style={type.caption}>
                  {att.kind === "url"
                    ? "link"
                    : `file · ${(att.bytes || 0).toLocaleString()} B`}
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
          ))
        : null}

      <Pressable
        style={styles.addTrigger}
        onPress={openSheet}
        accessibilityRole="button"
        accessibilityLabel={
          attachments.length ? "Add another attachment" : "Attach file or link"
        }
      >
        <SymbolView
          name="paperclip"
          size={18}
          weight="semibold"
          tintColor={color.muted}
          fallback={<Text style={styles.iconFallback}>+</Text>}
        />
        <Text style={styles.addTriggerTxt}>
          {attachments.length ? "Add attachment" : "Attach"}
        </Text>
      </Pressable>

      <Modal
        visible={sheetOpen}
        // Own motion: system "slide" dragged the dimmed backdrop with the sheet.
        animationType="none"
        transparent
        onRequestClose={closeSheet}
        statusBarTranslucent
      >
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="auto">
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeSheet}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            />
          </Animated.View>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.sheetLift}
            pointerEvents="box-none"
          >
            <Animated.View
              style={[styles.sheet, { paddingBottom: padBottom }, sheetStyle]}
              accessibilityViewIsModal
            >
              <View style={styles.handle} accessibilityElementsHidden />
              <Text style={styles.sheetTitle}>Attach</Text>

              {/* Large file target — primary sheet action */}
              <Pressable
                style={({ pressed }) => [
                  styles.fileBtn,
                  pressed && styles.fileBtnPressed,
                  busy && { opacity: 0.6 },
                ]}
                onPress={() => void addFile()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Choose a file"
              >
                {busy ? (
                  <ActivityIndicator color={color.primaryOn} />
                ) : (
                  <>
                    <SymbolView
                      name="doc.badge.plus"
                      size={28}
                      weight="medium"
                      tintColor={color.primaryOn}
                      fallback={
                        <Text style={[styles.fileBtnIconFb, { color: color.primaryOn }]}>
                          +
                        </Text>
                      }
                    />
                    <Text style={styles.fileBtnTxt}>Choose file</Text>
                    <Text style={styles.fileBtnSub}>Photos, PDFs, and other files</Text>
                  </>
                )}
              </Pressable>

              {/* Link: type + enter, or Paste — both attach and close */}
              <View style={styles.linkRow}>
                <TextInput
                  style={styles.linkInput}
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://… then return"
                  placeholderTextColor={color.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="done"
                  blurOnSubmit
                  onSubmitEditing={() => addUrl()}
                  editable={!busy}
                  accessibilityLabel="Link URL. Paste button or return to attach."
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.linkBtn,
                    busy && styles.linkBtnDisabled,
                    pressed && !busy && styles.linkBtnPressed,
                  ]}
                  onPress={() => void pasteLink()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Paste link from clipboard and attach"
                >
                  <Text style={styles.linkBtnTxt}>Paste</Text>
                </Pressable>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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

function makeStyles(color: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: 4 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.lineSoft,
    },
    rowMain: { flex: 1, minWidth: 0 },
    name: { fontSize: 15, fontWeight: "600", color: color.ink },
    addTrigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      minHeight: tap,
      paddingVertical: space[2],
      paddingRight: space[3],
      alignSelf: "flex-start",
    },
    addTriggerTxt: {
      fontSize: 15,
      fontWeight: "600",
      color: color.muted,
      letterSpacing: -0.1,
    },
    iconBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    iconFallback: {
      fontSize: 16,
      fontWeight: "600",
      color: color.inkSoft,
    },

    modalRoot: {
      flex: 1,
      justifyContent: "flex-end",
    },
    /** Fades independently — never rides the sheet's translateY. */
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.32)",
    },
    sheetLift: {
      width: "100%",
    },
    sheet: {
      backgroundColor: color.paperRaised,
      borderTopLeftRadius: radius.lg + 4,
      borderTopRightRadius: radius.lg + 4,
      paddingHorizontal: space[4],
      paddingTop: space[2],
      gap: space[3],
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: -4 },
      elevation: 16,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.line,
      marginBottom: space[1],
    },
    sheetTitle: {
      fontSize: 17,
      fontWeight: "700",
      color: color.ink,
      letterSpacing: -0.3,
      textAlign: "center",
      marginBottom: space[1],
    },
    fileBtn: {
      minHeight: 112,
      borderRadius: radius.lg,
      backgroundColor: color.primaryFill,
      alignItems: "center",
      justifyContent: "center",
      gap: space[1],
      paddingVertical: space[5],
      paddingHorizontal: space[4],
    },
    fileBtnPressed: {
      opacity: 0.88,
    },
    fileBtnIconFb: {
      fontSize: 28,
      fontWeight: "600",
      lineHeight: 32,
    },
    fileBtnTxt: {
      fontSize: 17,
      fontWeight: "700",
      color: color.primaryOn,
      letterSpacing: -0.2,
    },
    fileBtnSub: {
      fontSize: 13,
      fontWeight: "500",
      color: color.primaryOn,
      opacity: 0.72,
    },
    linkRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[1],
      minHeight: tapComfy,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.line,
      backgroundColor: color.paper,
      paddingLeft: space[3],
      paddingRight: space[1],
    },
    linkInput: {
      flex: 1,
      minWidth: 0,
      minHeight: tap,
      fontSize: 16,
      color: color.ink,
      paddingVertical: Platform.OS === "ios" ? space[3] : space[2],
    },
    linkBtn: {
      minHeight: 36,
      paddingHorizontal: space[3],
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: color.fillStrong,
    },
    linkBtnPressed: {
      opacity: 0.7,
    },
    linkBtnDisabled: {
      opacity: 0.45,
    },
    linkBtnTxt: {
      fontSize: 15,
      fontWeight: "700",
      color: color.ink,
    },
  });
}
