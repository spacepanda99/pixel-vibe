// Pixel Vibe service worker: makes the game installable and playable offline.
// Code is network-first (updates show up on the next launch); samples are
// cache-first because a sample's content never changes under the same name.
const VERSION = '0.2.0';
const CODE_CACHE = 'pv-code-' + VERSION;
const AUDIO_CACHE = 'pv-audio-1';
const CORE = ['./', 'index.html', `css/style.css?v=${VERSION}`, `js/game.js?v=${VERSION}`, `js/audio.js?v=${VERSION}`,
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CODE_CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CODE_CACHE && k !== AUDIO_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/audio/')) {
    e.respondWith(caches.open(AUDIO_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) caches.open(CODE_CACHE).then(c => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
});
