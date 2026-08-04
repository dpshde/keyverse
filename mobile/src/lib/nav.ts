/**
 * Dedup stack navigation under UI lag / multi-tap.
 *
 * expo-router will happily push N copies of /settings if the gear is mashed
 * while the main thread is busy. Short per-href locks keep one transition
 * without blocking a different destination (Activity then Settings).
 */
import type { Router } from "expo-router";
import { useRouter } from "expo-router";
import { useCallback } from "react";

/** Expo Router href (string path or object form). */
export type NavHref = Parameters<Router["push"]>[0];

/** How long to ignore a second push of the *same* target. */
const PUSH_LOCK_MS = 380;

/**
 * Routes that should only exist once on the stack (chrome / sheets).
 * Prefer `navigate` so re-open pops/reuses instead of stacking.
 */
const SINGLETON_PREFIXES = [
  "/settings",
  "/activity",
  "/share",
  "/pack",
  "/home",
] as const;

const lockUntilByKey = new Map<string, number>();

function hrefKey(href: NavHref): string {
  if (typeof href === "string") return href.split("?")[0];
  if (href && typeof href === "object") {
    const p = (href as { pathname?: string }).pathname;
    if (typeof p === "string") return p;
  }
  return String(href);
}

function isSingleton(key: string): boolean {
  const path = key.startsWith("/") ? key : `/${key}`;
  return SINGLETON_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

/**
 * `router.push` / `navigate` with multi-tap protection.
 * Singletons use `navigate` (reuse); dynamic routes use `push`.
 * @returns true if the navigation was issued
 */
export function pushOnce(router: Router, href: NavHref, lockMs = PUSH_LOCK_MS): boolean {
  const key = hrefKey(href);
  const now = Date.now();
  const until = lockUntilByKey.get(key) ?? 0;
  if (now < until) return false;
  lockUntilByKey.set(key, now + lockMs);

  // Drop stale lock entries occasionally
  if (lockUntilByKey.size > 24) {
    for (const [k, t] of lockUntilByKey) {
      if (t <= now) lockUntilByKey.delete(k);
    }
  }

  if (isSingleton(key) && typeof router.navigate === "function") {
    router.navigate(href);
  } else {
    router.push(href);
  }
  return true;
}

/**
 * Clear locks (e.g. when home regains focus after a sheet is dismissed)
 * so intentional re-open is not blocked.
 */
export function releasePushLock(): void {
  lockUntilByKey.clear();
}

/** Hook: stable pushOnce bound to the current router. */
export function usePushOnce(lockMs = PUSH_LOCK_MS): (href: NavHref) => boolean {
  const router = useRouter();
  return useCallback((href: NavHref) => pushOnce(router, href, lockMs), [router, lockMs]);
}
