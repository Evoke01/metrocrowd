const CACHE = 'metro-v8';
const CACHE_FILES = [
  '/', '/index.html', '/style.css',
  '/data.js', '/crowd.js', '/route.js', '/gps.js',
  '/api.js', '/app.js', '/auth.js', '/supabase.js',
  '/ui.js', '/coach.js', '/news.js', '/notify.js',
  '/map.js', '/realtime.js', '/legal.js', '/install.js',
  '/settings.js', '/commute.js', '/tripnav.js', '/group.js',
  '/stats.js', '/rewards.js', '/notifprefs.js', '/guide.js',
  '/ui/home.js', '/ui/station.js', '/ui/route.js',
  '/ui/report.js', '/ui/search.js', '/ui/nav.js',
  '/icons.js', '/ui-proxy.js', '/legal.html', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CACHE_FILES).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Push notification handler
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch { data = { title: e.data?.text() || 'Metro Alert' }; }
  const title = data.title || '🚇 Delhi Metro Alert';
  const body  = data.body  || 'Crowd update for your station';
  const url   = data.url   || '/';
  e.waitUntil(
    self.registration.showNotification(title, {
      body, icon: '/icons/icon-192.png', badge: '/icons/icon-72.png',
      tag: data.tag || 'metro-alert',
      data: { url, stationId: data.stationId },
      actions: [{ action: 'view', title: 'View' }, { action: 'dismiss', title: 'Dismiss' }]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// Network first, fall back to cache (same-origin + Google Fonts only)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;           // APIs, analytics, CDNs: straight to network
  if (sameOrigin && url.pathname.startsWith('/_vercel/')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit =>
        hit || (e.request.mode === 'navigate' ? caches.match('/index.html') : undefined)
      ))
  );
});
