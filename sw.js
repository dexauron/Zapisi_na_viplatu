// Офлайн-оболочка и быстрый старт.
// Файлы с ?v=<версия> не меняются — берём из кэша сразу (cache-first).
// Страницы — из сети, но если сеть не ответила за 2,5 с или её нет — из кэша.
// Данные (Supabase) сюда не попадают: их хранит само приложение (кэш + очередь изменений).
const CACHE = 'sverka-shell-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

const put = (req, res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.searchParams.has('v')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => put(e.request, res))));
    return;
  }
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const fromCache = () => caches.match(e.request, { ignoreSearch: true })
      .then((r) => r || caches.match('app.html', { ignoreSearch: true }));
    const timer = setTimeout(() => fromCache().then((r) => { if (r && !done) { done = true; resolve(r); } }), 2500);
    fetch(e.request).then((res) => { put(e.request, res); if (!done) { done = true; clearTimeout(timer); resolve(res); } })
      .catch(() => fromCache().then((r) => { if (!done) { done = true; clearTimeout(timer); resolve(r || Response.error()); } }));
  }));
});
