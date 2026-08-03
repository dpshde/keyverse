/**
 * Passage share URLs — default is projected **reader** (ADR 0019).
 * Cloud https when sync is on; app-scheme always opens local reader.
 */

import { appDoorReadUrl, appReadUrl } from "./deepLink";

export function normalizeHost(host: string): string {
  return host.replace(/\/+$/, "");
}

/** Projected passage URL on the multipack host — preferred share target when cloud is on. */
export function cloudReadUrl(host: string, door: string, slug: string): string {
  const h = normalizeHost(host);
  const d = door.replace(/^\/+|\/+$/g, "");
  const s = encodeURIComponent(slug);
  return `${h}/${d}/read/${s}`;
}

/** Exact note editor URL on the multipack host. */
export function cloudNoteUrl(host: string, door: string, slug: string): string {
  const h = normalizeHost(host);
  const d = door.replace(/^\/+|\/+$/g, "");
  const s = encodeURIComponent(slug);
  return `${h}/${d}/note/${s}`;
}

export { appReadUrl, appDoorReadUrl, appNoteUrl } from "./deepLink";

/**
 * Best share payload for a passage.
 * Prefer cloud reader URL when sync is on; always include app reader deep link.
 */
export function passageShareUrls(opts: {
  slug: string;
  cloudEnabled?: boolean;
  cloudHost?: string;
  cloudDoor?: string;
}): { primary: string; app: string; web?: string } {
  const slug = opts.slug.trim().toLowerCase();
  const app =
    opts.cloudEnabled && opts.cloudDoor
      ? appDoorReadUrl(opts.cloudDoor, slug)
      : appReadUrl(slug);
  if (opts.cloudEnabled && opts.cloudHost && opts.cloudDoor) {
    const web = cloudReadUrl(opts.cloudHost, opts.cloudDoor, slug);
    return { primary: web, app, web };
  }
  return { primary: app, app };
}
