const CACHE = "scorpio-iphone-shell-v1";
const base = new URL("./", self.location.href);
const files = ["./", "./app.css", "./app.mjs", "./cloud.mjs", "./manifest.webmanifest", "./icon.png"];
const assets = new Set(files.slice(1).map(file => new URL(file, base).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(files.map(file => new Request(new URL(file, base), { cache: "reload" })))));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("scorpio-iphone-shell-") && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== base.origin) return;
  const navigation = request.mode === "navigate" && url.pathname === base.pathname;
  if (!navigation && !assets.has(url.href)) return;
  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch {
      const cache = await caches.open(CACHE);
      return (await cache.match(navigation ? base.href : request)) || Response.error();
    }
  })());
});
