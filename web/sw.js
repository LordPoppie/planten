// Service worker: app-shell offline + pushmeldingen.
const CACHE = "planten-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "data.js", "config.js", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Netwerk eerst voor eigen bestanden (altijd de nieuwste versie), cache als fallback.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match("./"))),
  );
});

self.addEventListener("push", (e) => {
  const d = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(d.title ?? "Planten", {
    body: d.body ?? "", tag: d.tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    data: { url: d.url ?? "" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(self.registration.scope + (e.notification.data?.url ?? "")).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const c = list.find((w) => w.url.startsWith(self.registration.scope));
    if (c) { c.navigate(target); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
