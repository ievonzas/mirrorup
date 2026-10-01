/* Mirror Up service worker.
   1. Keeps the app shell cached so it opens with no signal (on a hill, in a studio basement).
   2. Adds the cross-origin isolation headers to every response. The gphoto2 WebAssembly build needs
      SharedArrayBuffer, which Chrome only allows on isolated pages, and GitHub Pages can't send these headers itself. */
const CACHE = 'mirrorup-v4';
const SHELL = [
  './', './index.html', './style.css', './app.js', './camera.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/camera.svg', './icons/heart.svg',
  './fonts/pixelify-sans-latin-400-normal.woff2', './fonts/pixelify-sans-latin-700-normal.woff2', './fonts/press-start-2p-latin-400-normal.woff2',
  './vendor/web-gphoto2/libapi.mjs', './vendor/web-gphoto2/libapi.wasm', './vendor/web-gphoto2/libapi.worker.js',
];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function isolate(res) {
  if (!res || res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/* Network first so updates show up straight away, cache when the network is slow or gone. */
async function respond(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const fresh = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  if (!cached) return fresh;
  fresh.catch(() => {});
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  const winner = await Promise.race([fresh.catch(() => null), timeout]);
  return winner && winner.ok ? winner : cached;
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(respond(e.request).then(isolate));
});
