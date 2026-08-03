/**
 * Cloud deep links for passage sharing.
 * Default: projected reader view (scripture + contained notes).
 */

export function normalizeHost(host: string): string {
  return host.replace(/\/+$/, "");
}

/** Projected passage URL — preferred share target. */
export function cloudReadUrl(host: string, door: string, slug: string): string {
  const h = normalizeHost(host);
  const d = door.replace(/^\/+|\/+$/g, "");
  const s = encodeURIComponent(slug);
  return `${h}/${d}/read/${s}`;
}

/** Exact note editor URL. */
export function cloudNoteUrl(host: string, door: string, slug: string): string {
  const h = normalizeHost(host);
  const d = door.replace(/^\/+|\/+$/g, "");
  const s = encodeURIComponent(slug);
  return `${h}/${d}/note/${s}`;
}
