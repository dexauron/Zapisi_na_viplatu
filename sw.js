// Кэш оболочки «Сверки» для работы без сети. Данные Supabase здесь не сохраняются.
const CACHE = 'sverka-shell-v3';
const PREVIOUS = 'sverka-shell-v2';
const SCOPE = new URL(self.registration.scope);
const PAGES = new Set(['', 'app.html', 'index.html', 'list.html', 'admin.html']);
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function cached(cache, request, options) {
  try {
    return await cache?.match(request, options) || await caches.match(request, { ...options, cacheName: PREVIOUS });
  } catch { return undefined; }
}
async function fromNetwork(cache, request) {
  const response = await fetch(request);
  if (response.ok && cache) {
    try { await cache.put(request, response.clone()); } catch { /* кэш может быть недоступен */ }
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || request.cache === 'no-store' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const path = url.pathname.slice(SCOPE.pathname.length);
  const navigation = request.mode === 'navigate';
  if (navigation ? !PAGES.has(path) : !/^(assets\/|vendor\/|manifest\.webmanifest$)/.test(path)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE).catch(() => null);
    if (!navigation && url.searchParams.has('v')) {
      return await cached(cache, request) || fromNetwork(cache, request);
    }

    const options = navigation ? { ignoreSearch: true } : undefined;
    const fallback = () => cached(cache, request, options);
    const network = fromNetwork(cache, request);
    if (!navigation) return network.catch(async () => await fallback() || Response.error());

    let timer;
    const slow = new Promise((resolve) => {
      timer = setTimeout(async () => resolve(await fallback() || response), 2500);
    });
    const response = network.catch(async () => await fallback() || Response.error());
    try { return await Promise.race([response, slow]); }
    finally { clearTimeout(timer); }
  })());
});
