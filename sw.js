/* District Texter service worker.
   Goal: open instantly and still work with a weak signal, WITHOUT ever pinning a phone to an old
   version. Same-origin files are network-first (fresh whenever there's signal, cached copy when
   there isn't). The Firebase SDK and fonts are stale-while-revalidate. Firestore/Auth API calls
   are never touched. VERSION is stamped by scripts/stamp-build.mjs. */
const VERSION = '463d4cc4a5';
const CACHE = 'dt-' + VERSION;
const SHELL = ['./', 'index.html', 'style.css', 'lib.js', 'sync.js', 'app.js', 'manifest.webmanifest',
  'assets/sunburst-icon.png', 'assets/apple-touch-icon.png'];
const CDN_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.indexOf('dt-') === 0 && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
        return Response.error();
      }
    })());
    return;
  }

  if (CDN_HOSTS.indexOf(url.hostname) >= 0) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const refresh = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || refresh;
    })());
  }
});
