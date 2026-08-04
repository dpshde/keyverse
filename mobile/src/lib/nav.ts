/**
 * Dedup stack navigation under UI lag / multi-tap.
 *
 * expo-router will happily push N copies of /settings if the gear is mashed
 * while the main thread is busy. A short global lock on `push` keeps one sheet.
 */
import type { Router } from "expo-router";
import { useRouter } from "expo-router";
import { useCallback } from "react";

/** Expo Router href (string path or object form). */
export type NavHref = Parameters<Router["push"]>[0];

/** How long to ignore further stack pushes after a successful push. */
const PUSH_LOCK_MS = 800;

let pushLockUntil = 0;

/**
 * `router.push` with multi-tap / lag protection.
 * @returns true if the push was issued
 */
export function pushOnce(router: Router, href: NavHref, lockMs = PUSH_LOCK_MS): boolean {
  const now = Date.now();
  if (now < pushLockUntil) return false;
  pushLockUntil = now + lockMs;
  router.push(href);
  return true;
}

/**
 * Clear the lock (e.g. when home regains focus after a sheet is dismissed)
 * so intentional re-open is not blocked by the full window.
 */
export function releasePushLock(): void {
  pushLockUntil = 0;
}

/** Hook: stable pushOnce bound to the current router. */
export function usePushOnce(lockMs = PUSH_LOCK_MS): (href: NavHref) => boolean {
  const router = useRouter();
  return useCallback((href: NavHref) => pushOnce(router, href, lockMs), [router, lockMs]);
}
