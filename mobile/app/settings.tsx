import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/src/context/SessionContext";
import type { TranslationId } from "@/src/lib/textBundle";
import * as Local from "@/src/lib/localPack";
import {
  exportLocalPackZip,
  importLocalPackZip,
} from "@/src/lib/packTransfer";
import { b64ToArrayBuffer } from "@/src/lib/bytes";

import { CountPill } from "@/src/components/CountPill";
import { EnterSyncKey } from "@/src/components/EnterSyncKey";
import { SyncKeyReveal } from "@/src/components/SyncKeyReveal";
import {
  completeSyncInvite,
  formatKeyForDisplay,
  formatLastSynced,
  plainSyncError,
} from "@/src/lib/syncInvite";
import {
  hapticError,
  hapticLight,
  hapticSelect,
  hapticSuccess,
  hapticWarning,
} from "@/src/lib/haptics";
import { useTheme } from "@/src/context/ThemeContext";
import { radius, space, tap, type ThemeColors, type ThemePreference } from "@/src/theme";

const DEFAULT_HOST = "https://keyverse-production.up.railway.app";

const APPEARANCE: { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

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
    client,
    hasPassphrase,
    setPassphrase,
    clearPassphrase,
  } = useSession();
  const { color, ui, type, preference, setPreference } = useTheme();
  const styles = useMemo(() => makeSettingsStyles(color), [color]);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [host, setHost] = useState(cloudHost || DEFAULT_HOST);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({ notes: 0, label: "…" });
  const [pw, setPw] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [enterOpen, setEnterOpen] = useState(false);
  const [revealDoor, setRevealDoor] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  /** Keyboard height → bottom content pad (same curve as passage dock). */
  const kbPad = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const run = (height: number, e?: KeyboardEvent) => {
      const duration =
        Platform.OS === "ios" && e?.duration != null && e.duration > 0
          ? e.duration
          : height > 0
            ? 250
            : 220;
      Animated.timing(kbPad, {
        toValue: Math.max(0, height),
        duration,
        easing: Easing.bezier(0.17, 0.59, 0.4, 0.99),
        useNativeDriver: false,
      }).start();
    };

    const onShow = (e: KeyboardEvent) => run(e.endCoordinates?.height ?? 0, e);
    const onHide = (e: KeyboardEvent) => run(0, e);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [kbPad]);

  const refreshStats = useCallback(async () => {
    const notes = await Local.listNotes();
    setStats({ notes: notes.length, label: `${notes.length} local notes` });
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    if (cloudHost) setHost(cloudHost);
  }, [cloudHost]);

  const turnOnSync = async () => {
    hapticSelect();
    setBusy(true);
    setSyncErr(null);
    try {
      if (pw.trim()) {
        await setPassphrase(pw.trim());
        setPw("");
      }
      const res = await enableCloud(host.trim() || DEFAULT_HOST);
      await completeSyncInvite();
      hapticSuccess();
      if (res.mode === "claim") setRevealDoor(res.door);
    } catch (e) {
      hapticError();
      setSyncErr(plainSyncError(e, "turn_on"));
    } finally {
      setBusy(false);
      refreshStats();
    }
  };

  const onEnterSubmit = async (door: string) => {
    if (pw.trim()) {
      await setPassphrase(pw.trim());
      setPw("");
    }
    const res = await enableCloud(host.trim() || DEFAULT_HOST, door);
    await completeSyncInvite();
    setEnterOpen(false);
    if (res.mode === "claim") setRevealDoor(res.door);
    refreshStats();
  };

  const onTurnOff = () => {
    hapticWarning();
    Alert.alert(
      "Turn off sync?",
      "Sync will stop. Notes stay on this device. You can turn it on again with your key.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn off sync",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await disableCloud();
              hapticLight();
            } catch (e) {
              hapticError();
              setSyncErr(plainSyncError(e, "off"));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  /** Local pack zip → share sheet (protocol user-data only). */
  const onExportLocal = async () => {
    hapticLight();
    setBusy(true);
    try {
      const res = await exportLocalPackZip({
        door: cloudEnabled ? cloudDoor : undefined,
      });
      hapticSuccess();
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
      hapticError();
      Alert.alert("Export failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Import pack zip into local (merge | replace). */
  const onImportLocal = async (mode: "merge" | "replace") => {
    try {
      if (mode === "replace") {
        hapticWarning();
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
      hapticLight();
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
      hapticSuccess();
      Alert.alert(
        "Import complete",
        `${mode}: ${res.notes} notes · ${res.attachments} attachments · ${res.files} zip entries`
      );
      if (cloudEnabled) {
        // Quiet push after import — no user-facing sync control
        syncCloud().catch(() => {});
      }
      refreshStats();
    } catch (e) {
      hapticError();
      Alert.alert("Import failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Download cloud export zip and merge into local. */
  const onImportFromCloudExport = async () => {
    if (!client) {
      hapticWarning();
      Alert.alert("Sync off", "Turn on sync first.");
      return;
    }
    hapticLight();
    setBusy(true);
    try {
      const bytes = await client.exportPackBytes();
      const res = await importLocalPackZip(bytes, "merge");
      hapticSuccess();
      Alert.alert(
        "Imported from remote",
        `Merged ${res.notes} notes · ${res.attachments} attachments`
      );
      refreshStats();
    } catch (e) {
      hapticError();
      Alert.alert("Import failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Push current local pack zip to cloud import API. */
  const onPushZipToCloud = async (mode: "merge" | "replace") => {
    if (!client) {
      Alert.alert("Sync off", "Turn on sync first.");
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
      Alert.alert("Remote import", JSON.stringify(res).slice(0, 240));
      await syncCloud().catch(() => {});
      refreshStats();
    } catch (e) {
      Alert.alert("Push failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  const restBottom = Math.max(insets.bottom, space[4]) + space[8];
  const displayKey = cloudDoor ? formatKeyForDisplay(cloudDoor) : "";

  return (
    <View style={ui.screen}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: restBottom }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={ui.group}>
          <Text style={type.section}>Scripture text</Text>
          <Text style={type.meta}>Bundled BSB + KJV on device. No network to read.</Text>
          <View style={styles.row}>
            {(["BSB", "KJV"] as TranslationId[]).map((t) => (
              <Pressable
                key={t}
                style={[styles.chip, translation === t && styles.chipOn]}
                onPress={() => {
                  hapticSelect();
                  setTranslation(t);
                }}
              >
                <Text style={[styles.chipTxt, translation === t && styles.chipTxtOn]}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={ui.group}>
          <Text style={type.section}>Appearance</Text>
          <Text style={type.meta}>Warm paper by day, night paper after dark — or lock one.</Text>
          <View style={styles.row}>
            {APPEARANCE.map((opt) => (
              <Pressable
                key={opt.id}
                style={[styles.chip, preference === opt.id && styles.chipOn]}
                onPress={() => {
                  hapticSelect();
                  setPreference(opt.id);
                }}
              >
                <Text style={[styles.chipTxt, preference === opt.id && styles.chipTxtOn]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={ui.group}>
          <Text style={type.section}>Sync</Text>

          {cloudEnabled ? (
            <>
              <Text style={type.bodyStrong}>
                On
                {lastSyncAt
                  ? ` · ${formatLastSynced(lastSyncAt).replace(/^Last synced /i, "")}`
                  : ""}
              </Text>
              {displayKey ? (
                <Text style={styles.keyPreview} selectable>
                  {displayKey}
                </Text>
              ) : null}
              {syncErr ? <Text style={ui.err}>{syncErr}</Text> : null}
              <Pressable style={ui.ghostBtn} onPress={onTurnOff} disabled={busy}>
                <Text style={ui.ghostBtnTxt}>Turn off</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={type.body}>
                Same notes on another phone, with a private key (a few words).
              </Text>
              {cloudDoor ? (
                <Text style={type.caption}>
                  This phone already has a key — turn on to use it again.
                </Text>
              ) : null}
              {syncErr ? <Text style={ui.err}>{syncErr}</Text> : null}
              <Pressable style={ui.primaryBtn} onPress={turnOnSync} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color={color.primaryOn} />
                ) : (
                  <Text style={ui.primaryBtnTxt}>Turn on sync</Text>
                )}
              </Pressable>
              <Pressable
                style={ui.secondaryBtn}
                onPress={() => {
                  hapticSelect();
                  setEnterOpen(true);
                }}
                disabled={busy}
              >
                <Text style={ui.secondaryBtnTxt}>Enter a key</Text>
              </Pressable>
              <Text style={type.caption}>
                First phone: turn on. Second phone: enter the key.
              </Text>
            </>
          )}
        </View>

        {/* Sealed notes — passphrase only; lock/globe live on each note */}
        <View style={ui.group}>
          <Text style={type.section}>Sealed notes</Text>
          <Text style={type.meta}>
            {hasPassphrase
              ? "Passphrase is on this phone. Tap the lock on a note to seal it."
              : "Needed to lock notes private. Stays on this phone — not your sync key."}
          </Text>
          <TextInput
            style={ui.input}
            value={pw}
            onChangeText={setPw}
            placeholder="Passphrase"
            placeholderTextColor={color.faint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => {
              setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
            }}
          />
          <View style={styles.pwActions}>
            <Pressable
              style={[ui.primaryBtn, styles.pwActionBtn]}
              onPress={async () => {
                if (!pw.trim()) {
                  hapticWarning();
                  Alert.alert("Empty passphrase", "Enter a passphrase first.");
                  return;
                }
                await setPassphrase(pw.trim());
                setPw("");
                hapticSuccess();
              }}
            >
              <Text style={ui.primaryBtnTxt}>
                {hasPassphrase ? "Update" : "Set passphrase"}
              </Text>
            </Pressable>
            {hasPassphrase ? (
              <Pressable
                style={[ui.ghostBtn, styles.pwActionBtn]}
                onPress={async () => {
                  hapticLight();
                  await clearPassphrase();
                  setPw("");
                }}
              >
                <Text style={ui.ghostBtnTxt}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={ui.group}>
          <Pressable
            onPress={() => {
              hapticSelect();
              setAdvancedOpen((v) => !v);
            }}
            style={[styles.advancedHead, advancedOpen && styles.advancedHeadOpen]}
            accessibilityRole="button"
            accessibilityState={{ expanded: advancedOpen }}
            accessibilityLabel={`Advanced, ${advancedOpen ? "expanded" : "collapsed"}`}
            accessibilityHint={
              advancedOpen ? "Collapses advanced settings" : "Expands host and pack tools"
            }
          >
            <View style={styles.advancedHeadText}>
              <Text style={type.section}>Advanced</Text>
              <Text style={type.meta}>Host URL, pack export and import</Text>
            </View>
            {!advancedOpen ? <CountPill label="More" /> : null}
          </Pressable>

          {advancedOpen ? (
            <>
              <Text style={[type.label, { marginTop: space[2] }]}>Host</Text>
              <TextInput
                style={ui.input}
                value={host}
                onChangeText={setHost}
                autoCapitalize="none"
                editable={!cloudEnabled}
                placeholderTextColor={color.faint}
                onFocus={() => {
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
                }}
              />

              <Text style={[type.label, { marginTop: space[3] }]}>Local pack</Text>
              <Text style={type.body}>{stats.label}</Text>
              <Text style={type.meta}>
                Export/import uses the same zip as the web door: protocol.json, notes, attachments
                (no scripture text).
              </Text>
              <Pressable style={ui.primaryBtn} onPress={onExportLocal} disabled={busy}>
                <Text style={ui.primaryBtnTxt}>{busy ? "Working…" : "Export pack zip"}</Text>
              </Pressable>
              <Pressable
                style={ui.secondaryBtn}
                onPress={() => onImportLocal("merge")}
                disabled={busy}
              >
                <Text style={ui.secondaryBtnTxt}>Import zip (merge)</Text>
              </Pressable>
              <Pressable
                style={ui.secondaryBtn}
                onPress={() => onImportLocal("replace")}
                disabled={busy}
              >
                <Text style={ui.secondaryBtnTxt}>Import zip (replace)</Text>
              </Pressable>

              {cloudEnabled ? (
                <>
                  <Text style={[type.label, { marginTop: space[3] }]}>Remote pack zip</Text>
                  <Pressable
                    style={ui.secondaryBtn}
                    onPress={onImportFromCloudExport}
                    disabled={busy}
                  >
                    <Text style={ui.secondaryBtnTxt}>Pull remote export → local</Text>
                  </Pressable>
                  <Pressable
                    style={ui.secondaryBtn}
                    onPress={() => onPushZipToCloud("merge")}
                    disabled={busy}
                  >
                    <Text style={ui.secondaryBtnTxt}>Push local zip → remote (merge)</Text>
                  </Pressable>
                  <Pressable
                    style={ui.secondaryBtn}
                    onPress={() => onPushZipToCloud("replace")}
                    disabled={busy}
                  >
                    <Text style={ui.secondaryBtnTxt}>Push local zip → remote (replace)</Text>
                  </Pressable>
                </>
              ) : null}
            </>
          ) : null}
        </View>

        <Animated.View style={{ height: kbPad }} accessibilityElementsHidden />
      </ScrollView>

      <EnterSyncKey
        visible={enterOpen}
        onCancel={() => setEnterOpen(false)}
        onSubmit={onEnterSubmit}
      />
      <SyncKeyReveal
        visible={!!revealDoor}
        door={revealDoor || ""}
        onDone={() => setRevealDoor(null)}
      />
    </View>
  );
}

function makeSettingsStyles(color: ThemeColors) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    scrollContent: {
      padding: space[4],
      gap: space[2],
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] },
    chip: {
      minHeight: tap,
      paddingHorizontal: space[4],
      paddingVertical: space[2],
      borderRadius: radius.pill,
      backgroundColor: color.fillStrong,
      justifyContent: "center",
    },
    chipOn: { backgroundColor: color.primaryFill },
    chipTxt: { fontWeight: "700", color: color.inkSoft },
    chipTxtOn: { color: color.primaryOn },
    keyPreview: {
      fontSize: 17,
      lineHeight: 26,
      fontWeight: "700",
      color: color.ink,
      padding: space[3],
      backgroundColor: color.paper,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.lineSoft,
      overflow: "hidden",
    },
    advancedHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      minHeight: 44,
    },
    advancedHeadOpen: {
      borderLeftWidth: 2,
      borderLeftColor: color.line,
      paddingLeft: space[2],
      marginLeft: -2,
    },
    advancedHeadText: { flex: 1, minWidth: 0, gap: 2 },
    pwActions: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] },
    pwActionBtn: { flexGrow: 1, minWidth: 120 },
  });
}
