/**
 * Cache for Activity screen door fetches (heatmap + day detail).
 * Memory survives navigation; AsyncStorage survives cold start.
 * Stale-while-revalidate: always revalidate on open, never block on network
 * when a prior payload exists.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ActivityDay, ActivityHeatmap } from "./activity";

const HEAT_PREFIX = "kv.activity.heat.v1:";
const DAY_PREFIX = "kv.activity.day.v1:";

type Entry<T> = { data: T; at: number };

const heatMem = new Map<string, Entry<ActivityHeatmap>>();
const dayMem = new Map<string, Entry<ActivityDay>>();

/** Scope key: local pack or host|door. */
export function activityScope(opts: {
  cloudEnabled: boolean;
  host?: string;
  door?: string;
}): string {
  if (!opts.cloudEnabled || !opts.door?.trim()) return "local";
  const host = (opts.host || "").replace(/\/+$/, "");
  const door = opts.door.trim().toLowerCase().replace(/\s+/g, "-");
  return `${host}|${door}`;
}

function dayKey(scope: string, date: string): string {
  return `${scope}|${date}`;
}

export function getHeatMem(scope: string): ActivityHeatmap | null {
  return heatMem.get(scope)?.data ?? null;
}

export function getDayMem(scope: string, date: string): ActivityDay | null {
  return dayMem.get(dayKey(scope, date))?.data ?? null;
}

export async function loadHeatCached(scope: string): Promise<ActivityHeatmap | null> {
  const mem = heatMem.get(scope);
  if (mem?.data) return mem.data;
  try {
    const raw = await AsyncStorage.getItem(HEAT_PREFIX + scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry<ActivityHeatmap>;
    if (parsed?.data?.days) {
      heatMem.set(scope, { data: parsed.data, at: parsed.at || Date.now() });
      return parsed.data;
    }
  } catch {
    /* ignore corrupt */
  }
  return null;
}

export async function setHeatCached(scope: string, data: ActivityHeatmap): Promise<void> {
  const entry: Entry<ActivityHeatmap> = { data, at: Date.now() };
  heatMem.set(scope, entry);
  try {
    await AsyncStorage.setItem(HEAT_PREFIX + scope, JSON.stringify(entry));
  } catch {
    /* disk full / private mode — memory still works */
  }
}

export async function loadDayCached(scope: string, date: string): Promise<ActivityDay | null> {
  const k = dayKey(scope, date);
  const mem = dayMem.get(k);
  if (mem?.data) return mem.data;
  try {
    const raw = await AsyncStorage.getItem(DAY_PREFIX + k);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry<ActivityDay>;
    if (parsed?.data?.date) {
      dayMem.set(k, { data: parsed.data, at: parsed.at || Date.now() });
      return parsed.data;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function setDayCached(scope: string, data: ActivityDay): Promise<void> {
  const k = dayKey(scope, data.date);
  const entry: Entry<ActivityDay> = { data, at: Date.now() };
  dayMem.set(k, entry);
  try {
    await AsyncStorage.setItem(DAY_PREFIX + k, JSON.stringify(entry));
  } catch {
    /* ok */
  }
}

/** Drop cache for a scope (e.g. cloud disable / door change). */
export async function clearActivityCache(scope?: string): Promise<void> {
  if (scope) {
    heatMem.delete(scope);
    for (const k of [...dayMem.keys()]) {
      if (k.startsWith(scope + "|")) dayMem.delete(k);
    }
    try {
      await AsyncStorage.removeItem(HEAT_PREFIX + scope);
      const keys = await AsyncStorage.getAllKeys();
      const dayKeys = keys.filter((k) => k.startsWith(DAY_PREFIX + scope + "|"));
      if (dayKeys.length) await AsyncStorage.multiRemove(dayKeys);
    } catch {
      /* ok */
    }
    return;
  }
  heatMem.clear();
  dayMem.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter(
      (k) => k.startsWith(HEAT_PREFIX) || k.startsWith(DAY_PREFIX)
    );
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    /* ok */
  }
}
