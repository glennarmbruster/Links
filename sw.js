/* Service worker for Links — offline app shell, plus site icons kept for offline use.
   The page is fetched from the network first so a new version shows up the next time the app opens; if the network is
   slow or offline it falls back to the saved copy after 4 s. A site icon is saved only after the page has shown it
   (the page posts its address), so failed icon lookups are never stored. */
const CACHE = 'goobs-links-v1';
const ICONS = 'goobs-links-icons';
const PREFIX = 'goobs-links-';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const WAIT_MS = 4000, MAX_ICONS = 400;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE && k !== ICONS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function page(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req, { cache: 'no-store' }).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
    return res;
  });
  const saved = () => cache.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true });
  const timer = new Promise(r => setTimeout(() => r(null), WAIT_MS));
  try { return await Promise.race([net, timer.then(async () => (await saved()) || net)]); }
  catch (err) { return (await saved()) || Response.error(); }
}
async function asset(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req, { cache: 'no-cache' }).then(res => { if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; });
  if (cached) { refresh.catch(() => {}); return cached; }
  try { return await refresh; } catch (err) { return Response.error(); }
}
/* site icons: the saved copy if there is one, otherwise the network */
async function icon(req) {
  const hit = await (await caches.open(ICONS)).match(req.url);
  if (hit) return hit;
  return fetch(req);
}
self.addEventListener('message', e => {
  const u = e.data && e.data.keepIcon;
  if (typeof u !== 'string' || !/^https:\/\//.test(u) || u.length > 500) return;
  e.waitUntil((async () => {
    const c = await caches.open(ICONS);
    if (await c.match(u)) return;
    try { const res = await fetch(u, { mode: 'no-cors', referrerPolicy: 'no-referrer' }); await c.put(u, res); } catch { return; }
    const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ICONS))) await c.delete(k);
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) { if (req.destination === 'image') e.respondWith(icon(req)); return; }
  const isPage = req.mode === 'navigate' || /\/(index\.html)?$/.test(u.pathname);
  e.respondWith(isPage ? page(req) : asset(req));
});
