import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useSession } from "../context/SessionContext";
import { parseDeepLink } from "../lib/deepLink";
import { pushOnce } from "../lib/nav";

/**
 * Opens inbound keyverse / https door links into the reader (default) or note.
 * Waits for session ready so cloud join + navigation are stable.
 */
export function DeepLinkHandler() {
  const { ready, cloudEnabled, cloudDoor, enableCloud } = useSession();
  const router = useRouter();
  const lastHandled = useRef<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!ready) return;

    const open = async (raw: string | null) => {
      if (!raw || busy.current) return;
      // Avoid re-processing the same cold-start URL on re-render.
      if (lastHandled.current === raw) return;
      const target = parseDeepLink(raw);
      if (!target) return;

      busy.current = true;
      lastHandled.current = raw;
      try {
        // Join multiword door from the link when present and different.
        if (target.door) {
          const needJoin =
            !cloudEnabled || cloudDoor.toLowerCase() !== target.door.toLowerCase();
          if (needJoin) {
            try {
              await enableCloud(target.host, target.door);
            } catch {
              // Still open local reader with the slug — pack may already have notes.
            }
          }
        }

        if (target.kind === "read" && target.slug) {
          pushOnce(router, `/read/${encodeURIComponent(target.slug)}`);
          return;
        }
        if (target.kind === "note" && target.slug) {
          pushOnce(router, `/note/${encodeURIComponent(target.slug)}`);
          return;
        }
        if (target.kind === "home") {
          pushOnce(router, "/home");
        }
      } finally {
        busy.current = false;
      }
    };

    let sub: { remove: () => void } | undefined;
    (async () => {
      const initial = await Linking.getInitialURL();
      await open(initial);
      sub = Linking.addEventListener("url", ({ url }) => {
        // Allow the same path again on a later open (clear guard for new events).
        if (url !== lastHandled.current) {
          lastHandled.current = null;
        }
        void open(url);
      });
    })();

    return () => {
      sub?.remove();
    };
  }, [ready, cloudEnabled, cloudDoor, enableCloud, router]);

  return null;
}
