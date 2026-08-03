/**
 * Inbound deep links → reader / note routes.
 *
 * Supported shapes (host optional on custom scheme):
 *   keyverse:///read/{slug}
 *   keyverse:///note/{slug}
 *   keyverse:///{door}/read/{slug}
 *   keyverse:///{door}/note/{slug}
 *   keyverse://read/{slug}          (host-as-segment form)
 *   https://{host}/{door}/read/{slug}
 *   https://{host}/{door}/note/{slug}
 *
 * Default share target is the projected reader (ADR 0019).
 */

export type DeepLinkTarget = {
  kind: "read" | "note" | "home";
  /** OSIS slug e.g. jhn.3.16, jhn.3.16-18, jhn.3 */
  slug?: string;
  /** Multiword door when present in the path */
  door?: string;
  /** Origin for https links (join cloud) */
  host?: string;
};

const APP_SCHEME = "keyverse";

/** Loose OSIS / pack slug check (verse, range, chapter). */
export function looksLikePassageSlug(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (!t || t.length > 64) return false;
  // book.chapter[.verse[-verseEnd]]
  return /^[a-z][a-z0-9]*\.\d+(\.\d+(-\d+)?)?$/.test(t);
}

function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Normalize path segments from any of the URL shapes above.
 * Returns path parts without leading empty.
 */
function pathParts(url: URL): string[] {
  let path = url.pathname || "";
  // keyverse://read/jhn.3 → host "read", path "/jhn.3" → ["read","jhn.3"]
  // keyverse:///read/jhn.3 → host "", path "/read/jhn.3"
  if (url.protocol === `${APP_SCHEME}:` || url.protocol.startsWith("exp")) {
    if (url.host && url.host !== "expo-development-client") {
      path = `/${url.host}${path === "/" ? "" : path}`;
    }
  }
  return path
    .split("/")
    .map((p) => decodeSeg(p.trim()))
    .filter(Boolean);
}

/**
 * Parse an inbound URL into a navigation target, or null if not ours.
 */
export function parseDeepLink(raw: string | null | undefined): DeepLinkTarget | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Bare path: /read/jhn.3
    if (trimmed.startsWith("/")) {
      try {
        url = new URL(`keyverse://${trimmed}`);
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  const protocol = url.protocol.replace(/:$/, "").toLowerCase();
  const isHttp = protocol === "http" || protocol === "https";
  const isApp =
    protocol === APP_SCHEME || protocol === "exp" || protocol.startsWith("exp+");

  if (!isHttp && !isApp) return null;

  const parts = pathParts(url);
  if (parts.length === 0) {
    return isApp ? { kind: "home" } : null;
  }

  const host =
    isHttp && url.origin && url.origin !== "null" ? url.origin.replace(/\/+$/, "") : undefined;

  // /read/{slug} | /note/{slug}
  if (parts.length >= 2 && (parts[0] === "read" || parts[0] === "note")) {
    const slug = parts[1].toLowerCase();
    if (!looksLikePassageSlug(slug)) return null;
    return { kind: parts[0] as "read" | "note", slug, host };
  }

  // /{door}/read/{slug} | /{door}/note/{slug}
  if (parts.length >= 3 && (parts[1] === "read" || parts[1] === "note")) {
    const door = parts[0].toLowerCase();
    const slug = parts[2].toLowerCase();
    if (!door || door === "api" || door === "setup") return null;
    if (!looksLikePassageSlug(slug)) return null;
    return {
      kind: parts[1] as "read" | "note",
      slug,
      door,
      host,
    };
  }

  // /{door}/ alone → pack home (cloud join)
  if (parts.length === 1 && isHttp) {
    const door = parts[0].toLowerCase();
    if (door && door !== "api" && door !== "setup" && door !== "health") {
      return { kind: "home", door, host };
    }
  }

  return null;
}

/** App-scheme projected reader link (works offline on local pack). */
export function appReadUrl(slug: string): string {
  const s = slug.trim().toLowerCase();
  return `${APP_SCHEME}:///read/${encodeURIComponent(s)}`;
}

/** App-scheme note editor link. */
export function appNoteUrl(slug: string): string {
  const s = slug.trim().toLowerCase();
  return `${APP_SCHEME}:///note/${encodeURIComponent(s)}`;
}

/** Door-scoped app link (recipient can join + open). */
export function appDoorReadUrl(door: string, slug: string): string {
  const d = door.replace(/^\/+|\/+$/g, "").toLowerCase();
  const s = slug.trim().toLowerCase();
  return `${APP_SCHEME}:///${encodeURIComponent(d)}/read/${encodeURIComponent(s)}`;
}
