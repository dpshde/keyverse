import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { KeyverseClient } from "../api/client";
import type { ProtocolInfo } from "../api/types";
import * as Local from "../lib/localPack";
import type { TranslationId } from "../lib/textBundle";
import { preloadTexts } from "../lib/textBundle";
import * as Cloud from "../lib/cloudSync";

const PW_KEY = "kv.local.pw";
const DEFAULT_HOST = "https://keyverse-production.up.railway.app";

type Ctx = {
  ready: boolean;
  /** Always true — local pack is the default workspace */
  localMode: true;
  translation: TranslationId;
  setTranslation: (t: TranslationId) => Promise<void>;
  cloudEnabled: boolean;
  cloudDoor: string;
  cloudHost: string;
  lastSyncAt?: string;
  client: KeyverseClient | null;
  protocol: ProtocolInfo | null;
  passphrase: string;
  hasPassphrase: boolean;
  setPassphrase: (pw: string) => Promise<void>;
  clearPassphrase: () => Promise<void>;
  /** Enable cloud. Pass existing multiword door to join/pull remote; omit to claim new. */
  enableCloud: (host?: string, door?: string) => Promise<Cloud.SyncResult>;
  disableCloud: () => Promise<void>;
  syncCloud: () => Promise<Cloud.SyncResult>;
  refreshProtocol: () => Promise<ProtocolInfo | null>;
  /** @deprecated use local-first; kept for pack screen host display */
  host: string;
  door: string;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [meta, setMetaState] = useState<Local.LocalMeta | null>(null);
  const [protocol, setProtocol] = useState<ProtocolInfo | null>(null);
  const [passphrase, setPw] = useState("");

  const cloudEnabled = !!meta?.cloud?.enabled && !!meta.cloud.door;
  const cloudDoor = meta?.cloud?.door || "";
  const cloudHost = meta?.cloud?.host || DEFAULT_HOST;
  const translation = (meta?.translation || "BSB") as TranslationId;

  const client = useMemo(() => {
    if (!cloudEnabled || !cloudDoor) return null;
    return new KeyverseClient({ host: cloudHost, door: cloudDoor });
  }, [cloudEnabled, cloudDoor, cloudHost]);

  useEffect(() => {
    (async () => {
      try {
        const m = await Local.getMeta();
        setMetaState(m);
        const pw = await AsyncStorage.getItem(PW_KEY);
        if (pw) setPw(pw);
        // Warm notes ASAP (snapshot → parallel files). Don't block ready.
        void Local.listNotes().catch(() => {});
        // Only gunzip the active translation on launch (~1.3MB gzip each).
        // The other translation loads on first switch / first open.
        const tr = (m.translation || "BSB") as TranslationId;
        preloadTexts([tr]).catch(() => {});
        const other: TranslationId = tr === "BSB" ? "KJV" : "BSB";
        // Idle-ish second pack — don't compete with notes list + first chapter
        setTimeout(() => {
          preloadTexts([other]).catch(() => {});
        }, 2500);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const refreshProtocol = useCallback(async () => {
    if (!client) {
      setProtocol(null);
      return null;
    }
    try {
      const p = await client.protocol();
      setProtocol(p);
      return p;
    } catch {
      setProtocol(null);
      return null;
    }
  }, [client]);

  useEffect(() => {
    if (ready && cloudEnabled) refreshProtocol();
  }, [ready, cloudEnabled, refreshProtocol]);

  const setTranslation = useCallback(async (t: TranslationId) => {
    const m = await Local.setMeta({ translation: t });
    setMetaState(m);
  }, []);

  const setPassphrase = useCallback(async (pw: string) => {
    setPw(pw);
    if (pw) await AsyncStorage.setItem(PW_KEY, pw);
    else await AsyncStorage.removeItem(PW_KEY);
  }, []);

  const clearPassphrase = useCallback(async () => {
    setPw("");
    await AsyncStorage.removeItem(PW_KEY);
  }, []);

  const enableCloud = useCallback(async (host?: string, door?: string) => {
    const res = await Cloud.enableCloudAndSync(host || DEFAULT_HOST, {
      door: door?.trim() || undefined,
    });
    const m = await Local.getMeta();
    setMetaState(m);
    try {
      const { completeSyncInvite } = await import("../lib/syncInvite");
      await completeSyncInvite();
    } catch {
      /* ok */
    }
    try {
      const c = new KeyverseClient({ host: res.host, door: res.door });
      setProtocol(await c.protocol());
    } catch {
      /* ok */
    }
    return res;
  }, []);

  const disableCloud = useCallback(async () => {
    await Cloud.disableCloudKeepLocal();
    setMetaState(await Local.getMeta());
    setProtocol(null);
  }, []);

  const syncCloud = useCallback(async () => {
    const res = await Cloud.syncNow();
    setMetaState(await Local.getMeta());
    return res;
  }, []);

  /** Quiet full sync under the hood — never a user control. */
  const quietSync = useCallback(() => {
    if (!cloudEnabled) return;
    Cloud.syncNow()
      .then(async () => {
        setMetaState(await Local.getMeta());
      })
      .catch(() => {
        /* silent */
      });
  }, [cloudEnabled]);

  useEffect(() => {
    if (!ready || !cloudEnabled) return;
    quietSync();
  }, [ready, cloudEnabled, quietSync]);

  // Sync again when returning to the foreground
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    if (!ready || !cloudEnabled) return;
    const onChange = (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        quietSync();
      }
      appState.current = next;
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [ready, cloudEnabled, quietSync]);

  const lastSyncAt = meta?.cloud?.last_sync_at;
  const hasPassphrase = !!passphrase;

  const value = useMemo<Ctx>(
    () => ({
      ready,
      localMode: true,
      translation,
      setTranslation,
      cloudEnabled,
      cloudDoor,
      cloudHost,
      lastSyncAt,
      client,
      protocol,
      passphrase,
      hasPassphrase,
      setPassphrase,
      clearPassphrase,
      enableCloud,
      disableCloud,
      syncCloud,
      refreshProtocol,
      host: cloudHost,
      door: cloudDoor,
    }),
    [
      ready,
      translation,
      setTranslation,
      cloudEnabled,
      cloudDoor,
      cloudHost,
      lastSyncAt,
      client,
      protocol,
      passphrase,
      hasPassphrase,
      setPassphrase,
      clearPassphrase,
      enableCloud,
      disableCloud,
      syncCloud,
      refreshProtocol,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}
