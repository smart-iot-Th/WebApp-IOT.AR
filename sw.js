const CACHE_NAME = 'iot-webapp-v15';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './css/components.css',
  './sdk/notify-model.js',
  './js/pwa.js',
  './js/storage.js',
  './assets/login_hero.png',
  './assets/iot_banner.png',
  './assets/avatar.png',
  './assets/icons/favicon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/app-logo.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  if (
    event.request.url.includes('/api/') ||
    event.request.url.includes('/admin') ||
    event.request.url.includes('admin.html') ||
    event.request.url.includes('admin.js') ||
    event.request.url.includes('admin.css') ||
    event.request.url.includes('notify-model.js') ||
    event.request.url.includes('app.js') ||
    event.request.url.includes('notification.js') ||
    event.request.url.includes('firebase-sync.js') ||
    event.request.url.includes('components.css') ||
    event.request.url.includes('style.css')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Core Web Push Notification Handler (from Notification_system)
self.addEventListener('push', (event) => {
  let payload = {
    title: 'NotifyHub แจ้งเตือนใหม่',
    body: 'คุณมีข้อความแจ้งเตือนใหม่',
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    url: './index.html?tab=notif',
    appId: 'default'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch (_) {
      payload.body = event.data.text();
    }
  }

  const resolvedIcon = (!payload.icon || payload.icon === '/icons/icon-192.svg')
    ? './assets/icons/icon-192.png'
    : payload.icon;
  const resolvedBadge = (!payload.badge || payload.badge === '/icons/icon-192.svg')
    ? './assets/icons/icon-192.png'
    : payload.badge;
  const resolvedUrl = (!payload.url || payload.url === '/')
    ? './index.html?tab=notif'
    : payload.url;

  const options = {
    body: payload.body,
    icon: resolvedIcon,
    badge: resolvedBadge,
    vibrate: [200, 100, 200],
    tag: payload.id || `notify-${Date.now()}`,
    renotify: true,
    requireInteraction: payload.priority === 'high',
    data: {
      url: resolvedUrl,
      appId: payload.appId || 'default',
      id: payload.id
    }
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        clientList.forEach((client) => {
          try {
            client.postMessage({
              type: 'NOTIFYHUB_PUSH_RECEIVED',
              payload: {
                id: payload.id || options.tag,
                title: payload.rawTitle || payload.title,
                body: payload.body,
                priority: payload.priority || 'normal',
                appId: payload.appId || 'default',
                appName: payload.appName || payload.appId || 'NotifyHub',
                timestamp: Date.now()
              }
            });
          } catch (_) {}
        });
      })
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html?tab=notif';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && targetUrl && targetUrl !== '/') {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
