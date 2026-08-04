/**
 * Sync invite + display helpers for frictionless multi-word sync UX.
 * Protocol still uses multiword doors; UI calls the secret a "key".
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeDoorPhrase } from "./cloudSync";

const INVITE_KEY = "kv.sync.invite.v1";

/** pending = may show banner; deferred = Not now; done = completed or no longer needed */
export type SyncInviteState = "pending" | "deferred" | "done";

export async function getSyncInviteState(): Promise<SyncInviteState> {
  const raw = await AsyncStorage.getItem(INVITE_KEY);
  if (raw === "deferred" || raw === "done" || raw === "pending") return raw;
  return "pending";
}

export async function setSyncInviteState(state: SyncInviteState): Promise<void> {
  await AsyncStorage.setItem(INVITE_KEY, state);
}

export async function deferSyncInvite(): Promise<void> {
  await setSyncInviteState("deferred");
}

export async function completeSyncInvite(): Promise<void> {
  await setSyncInviteState("done");
}

/** Door path segment → spaced words for reading. */
export function formatKeyForDisplay(door: string): string {
  return door
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, "-")
    .replace(/[^a-z0-9-\s]/g, "")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** User input → door segment (spaces or hyphens). */
export function parseKeyInput(raw: string): string {
  return normalizeDoorPhrase(raw);
}

/** Parse door/pack ISO as UTC when zone is omitted. */
function parseSyncTime(iso: string): number {
  const s = iso.trim();
  if (!s) return NaN;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  const normalized = (s.includes("T") ? s : s.replace(" ", "T")) + (s.endsWith("Z") ? "" : "Z");
  return Date.parse(normalized);
}

/** Last sync ISO → short calm label (relative to local now). */
export function formatLastSynced(iso?: string): string {
  if (!iso) return "Not synced yet";
  const t = parseSyncTime(iso);
  if (!Number.isFinite(t)) return "Not synced yet";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return "Last synced just now";
  if (sec < 3600) {
    const m = Math.max(1, Math.round(sec / 60));
    return `Last synced ${m}m ago`;
  }
  if (sec < 86400) {
    const h = Math.max(1, Math.round(sec / 3600));
    return `Last synced ${h}h ago`;
  }
  const d = Math.max(1, Math.round(sec / 86400));
  return `Last synced ${d}d ago`;
}

/** Map thrown errors to plain English for non-technical users. */
export function plainSyncError(err: unknown, context: "turn_on" | "enter" | "sync" | "off"): string {
  const s = String(err ?? "");
  const lower = s.toLowerCase();
  if (
    context === "enter" ||
    lower.includes("could not open door") ||
    lower.includes("that key")
  ) {
    return "That key didn’t work. Check it and try again.";
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("timeout") ||
    lower.includes("failed to connect") ||
    lower.includes("internet")
  ) {
    return "Couldn’t sync. Check your connection and try again.";
  }
  if (context === "turn_on" && lower.includes("claim")) {
    return "Couldn’t turn on sync. Check your connection and try again.";
  }
  if (context === "sync") {
    return "Couldn’t sync. Check your connection and try again.";
  }
  // Strip stack-ish noise; keep short
  const first = s.split("\n")[0]?.replace(/^Error:\s*/i, "").trim() || "Something went wrong.";
  if (first.length > 160) return "Something went wrong. Try again.";
  return first;
}
