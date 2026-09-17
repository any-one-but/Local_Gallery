// Local Gallery's service worker. It exists so the browser version can be
// installed as an app (its own window, fullscreen). It keeps a copy of the page
// so the app still opens when the server serving it is not running; the
// library itself is never cached -- it is read straight from disk through the
// folder handle.
const CACHE = "local-gallery-shell-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./app-icons/icon-192.png", "./app-icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pages: always the newest copy from the network, the cached one only when the
// network cannot answer. Everything else goes straight to the network.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put("./index.html", copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match("./index.html")),
  );
});
