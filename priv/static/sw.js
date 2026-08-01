/* keyverse service worker — offline shell + cached reads
 * Scope: / (registered from any page). Network-first for app HTML/API GETs;
 * writes always hit the network. Bump CACHE when shell assets change. */
const CACHE = "keyverse-v1";
const PRECACHE = [
  "/offline",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/icons/icon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isApi(url) {
  return url.pathname.includes("/api/");
}

function isWrite(method) {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname === "/sw.js" ||
    url.pathname === "/offline"
  );
}

async function networkFirst(request, { fallbackOffline = false } = {}) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok && request.method === "GET") {
      try {
        cache.put(request, res.clone());
      } catch {
        /* opaque or partial */
      }
    }
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackOffline) {
      const offline = await cache.match("/offline");
      if (offline) return offline;
    }
    return new Response("Offline", {
      status: 503,
      statusText: "Offline",
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      try {
        cache.put(request, res.clone());
      } catch { /* ignore */ }
    }
    return res;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Mutations: network only (no offline write queue in v0.1)
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the service worker itself with SW logic beyond network
  if (url.pathname === "/sw.js") {
    event.respondWith(fetch(req));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (isApi(url)) {
    // GET API: network-first so offline can still open recently viewed notes/lists
    event.respondWith(networkFirst(req, { fallbackOffline: false }));
    return;
  }

  // Navigations and HTML: network-first, offline page as last resort
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirst(req, { fallbackOffline: true }));
    return;
  }

  event.respondWith(networkFirst(req));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
