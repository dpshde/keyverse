import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { KeyverseClient, type SessionConfig } from "../api/client";
import type { ProtocolInfo } from "../api/types";

const KEY = "kv.session.v1";
const PW_PREFIX = "kv.pw.";
const DEFAULT_HOST = "https://keyverse-production.up.railway.app";

type Ctx = {
  ready: boolean;
  host: string;
  door: string;
  client: KeyverseClient | null;
  protocol: ProtocolInfo | null;
  passphrase: string;
  hasPassphrase: boolean;
  setSession: (host: string, door: string) => Promise<void>;
  clearSession: () => Promise<void>;
  setPassphrase: (pw: string) => Promise<void>;
  clearPassphrase: () => Promise<void>;
  refreshProtocol: () => Promise<ProtocolInfo | null>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [host, setHost] = useState(DEFAULT_HOST);
  const [door, setDoor] = useState("");
  const [protocol, setProtocol] = useState<ProtocolInfo | null>(null);
  const [passphrase, setPw] = useState("");

  const client = useMemo(() => {
    if (!door) return null;
    return new KeyverseClient({ host, door });
  }, [host, door]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const s = JSON.parse(raw) as SessionConfig;
          if (s.host) setHost(s.host);
          if (s.door) setDoor(s.door);
          if (s.door) {
            const pw = await AsyncStorage.getItem(PW_PREFIX + s.door);
            if (pw) setPw(pw);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const refreshProtocol = useCallback(async () => {
    if (!client || !door) {
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
  }, [client, door]);

  useEffect(() => {
    if (ready && door) refreshProtocol();
  }, [ready, door, host, refreshProtocol]);

  const setSession = useCallback(async (h: string, d: string) => {
    const hostN = (h || DEFAULT_HOST).replace(/\/+$/, "");
    const doorN = d.trim().toLowerCase().replace(/\s+/g, "-");
    setHost(hostN);
    setDoor(doorN);
    await AsyncStorage.setItem(KEY, JSON.stringify({ host: hostN, door: doorN }));
    const pw = await AsyncStorage.getItem(PW_PREFIX + doorN);
    setPw(pw || "");
    const c = new KeyverseClient({ host: hostN, door: doorN });
    try {
      const p = await c.protocol();
      setProtocol(p);
    } catch (e) {
      setProtocol(null);
      throw e;
    }
  }, []);

  const clearSession = useCallback(async () => {
    setDoor("");
    setProtocol(null);
    setPw("");
    await AsyncStorage.removeItem(KEY);
  }, []);

  const setPassphrase = useCallback(
    async (pw: string) => {
      setPw(pw);
      if (door) {
        if (pw) await AsyncStorage.setItem(PW_PREFIX + door, pw);
        else await AsyncStorage.removeItem(PW_PREFIX + door);
      }
    },
    [door]
  );

  const clearPassphrase = useCallback(async () => {
    setPw("");
    if (door) await AsyncStorage.removeItem(PW_PREFIX + door);
  }, [door]);

  const value: Ctx = {
    ready,
    host,
    door,
    client: door ? client : null,
    protocol,
    passphrase,
    hasPassphrase: !!passphrase,
    setSession,
    clearSession,
    setPassphrase,
    clearPassphrase,
    refreshProtocol,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}
