// ══════════════════════════════════════════════════════════════════
//  SERVICE WORKER — Delhi Metro Monitor
//  Handles: Push notification delivery + offline caching
// ══════════════════════════════════════════════════════════════════
const CACHE = 'metro-v1';
const CACHE_FILES = ['/', '/index.html', '/style.css', '/data.js',
  '/crowd.js', '/map.js', '/news.js', '/route.js', '/ui.js',
  '/app.js', '/supabase.js', '/auth.js', '/notify.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CACHE_FILES).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Push notification handler
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch { data = { title: e.data?.text() || 'Metro Alert' }; }

  const title   = data.title  || '🚇 Delhi Metro Alert';
  const body    = data.body   || 'Crowd update for your subscribed station';
  const icon    = data.icon   || '/icon-192.png';
  const badge   = data.badge  || '/badge-72.png';
  const tag     = data.tag    || 'metro-alert';
  const url     = data.url    || '/';
  const urgency = data.urgency || 'normal';

  // Color-code the notification by alert type
  const vibrate = urgency === 'high' ? [200, 100, 200, 100, 400]
                : urgency === 'medium' ? [200, 100, 200]
                : [100];

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      vibrate,
      requireInteraction: urgency === 'high',
      data: { url, stationId: data.stationId },
      actions: [
        { action: 'view',    title: 'View Station' },
        { action: 'dismiss', title: 'Dismiss'      },
      ]
    })
  );
});

// Notification click → open/focus the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.postMessage({ type: 'OPEN_STATION', stationId: e.notification.data?.stationId });
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Offline-first fetch
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
