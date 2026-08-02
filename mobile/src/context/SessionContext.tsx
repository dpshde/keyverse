import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { KeyverseClient, type SessionConfig } from "../api/client";
import type { ProtocolInfo } from "../api/types";

const KEY = "kv.session.v1";
const DEFAULT_HOST = "https://keyverse-production.up.railway.app";

type Ctx = {
  ready: boolean;
  host: string;
  door: string;
  client: KeyverseClient | null;
  protocol: ProtocolInfo | null;
  setSession: (host: string, door: string) => Promise<void>;
  clearSession: () => Promise<void>;
  refreshProtocol: () => Promise<ProtocolInfo | null>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [host, setHost] = useState(DEFAULT_HOST);
  const [door, setDoor] = useState("");
  const [protocol, setProtocol] = useState<ProtocolInfo | null>(null);

  const client = useMemo(() => {
    if (!door && !host) return null;
    // Door required for multipack unless open host
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
    await AsyncStorage.removeItem(KEY);
  }, []);

  const value: Ctx = {
    ready,
    host,
    door,
    client: door ? client : null,
    protocol,
    setSession,
    clearSession,
    refreshProtocol,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}
