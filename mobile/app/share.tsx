import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/src/context/SessionContext";
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
import { radius, space, type ThemeColors } from "@/src/theme";

const DEFAULT_HOST = "https://keyverse-production.up.railway.app";

/**
 * Sync home — key management only. Sync runs under the hood (save + app open).
 */
export default function ShareScreen() {
  const { color, ui, type } = useTheme();
  const styles = useMemo(() => makeShareStyles(color), [color]);
  const {
    cloudEnabled,
    cloudHost,
    cloudDoor,
    lastSyncAt,
    enableCloud,
    disableCloud,
  } = useSession();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enterOpen, setEnterOpen] = useState(false);
  const [revealDoor, setRevealDoor] = useState<string | null>(null);

  const host = cloudHost || DEFAULT_HOST;
  const displayKey = cloudDoor ? formatKeyForDisplay(cloudDoor) : "";

  const turnOn = useCallback(async () => {
    hapticSelect();
    setBusy(true);
    setErr(null);
    try {
      const res = await enableCloud(host);
      await completeSyncInvite();
      hapticSuccess();
      if (res.mode === "claim") setRevealDoor(res.door);
    } catch (e) {
      hapticError();
      setErr(plainSyncError(e, "turn_on"));
    } finally {
      setBusy(false);
    }
  }, [enableCloud, host]);

  const onEnterSubmit = useCallback(
    async (door: string) => {
      const res = await enableCloud(host, door);
      await completeSyncInvite();
      setEnterOpen(false);
      if (res.mode === "claim") setRevealDoor(res.door);
    },
    [enableCloud, host]
  );

  const onTurnOff = useCallback(() => {
    hapticWarning();
    Alert.alert(
      "Turn off sync?",
      "Sync will stop. Notes stay on this phone. You can turn it on again with your key.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn off",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            setErr(null);
            try {
              await disableCloud();
              hapticLight();
            } catch (e) {
              hapticError();
              setErr(plainSyncError(e, "off"));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [disableCloud]);

  const copyKey = async () => {
    if (!displayKey) return;
    await Clipboard.setStringAsync(displayKey);
    hapticSuccess();
  };

  const shareKey = async () => {
    if (!displayKey) return;
    hapticLight();
    await Share.share({ message: displayKey });
  };

  const lastShort = lastSyncAt
    ? formatLastSynced(lastSyncAt).replace(/^Last synced /i, "")
    : null;

  return (
    <View style={ui.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.pad,
          { paddingBottom: Math.max(insets.bottom, space[4]) + space[6] },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {!cloudEnabled ? (
          <View style={ui.group}>
            <Text style={type.section}>Sync</Text>
            <Text style={type.body}>
              Same notes on another phone, with a private key (a few words).
            </Text>
            {cloudDoor ? (
              <Text style={type.caption}>
                This phone already has a key — turn on to use it again.
              </Text>
            ) : null}
            {err ? <Text style={ui.err}>{err}</Text> : null}
            <Pressable style={ui.primaryBtn} onPress={turnOn} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
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
          </View>
        ) : (
          <View style={ui.group}>
            <Text style={type.section}>Sync</Text>
            <Text style={type.bodyStrong}>
              On{lastShort ? ` · ${lastShort}` : ""}
            </Text>
            {displayKey ? (
              <Pressable
                onPress={copyKey}
                style={styles.keyTap}
                accessibilityRole="button"
                accessibilityLabel="Copy key"
              >
                <Text style={styles.keyTxt} selectable>
                  {displayKey}
                </Text>
              </Pressable>
            ) : null}
            {err ? <Text style={ui.err}>{err}</Text> : null}
            <Pressable style={ui.secondaryBtn} onPress={shareKey} disabled={!displayKey}>
              <Text style={ui.secondaryBtnTxt}>Share key</Text>
            </Pressable>
            <Pressable style={ui.ghostBtn} onPress={onTurnOff} disabled={busy}>
              <Text style={ui.ghostBtnTxt}>Turn off</Text>
            </Pressable>
          </View>
        )}
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

function makeShareStyles(color: ThemeColors) {
  return StyleSheet.create({
  pad: {
    padding: space[4],
    gap: space[1],
  },
  keyTap: {
    backgroundColor: color.paper,
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineSoft,
  },
  keyTxt: {
    fontSize: 20,
    lineHeight: 30,
    fontWeight: "700",
    color: color.ink,
  },
});
}
