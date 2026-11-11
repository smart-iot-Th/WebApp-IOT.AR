const CACHE_NAME = 'iot-webapp-v9';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './css/components.css',
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

// Install: Cache core assets immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching Smart Farm assets (v9)');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate: Clean up outdated caches & claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate strategy for fast load + offline support
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  // Never intercept or cache dynamic API requests, NotifyHub requests, or dynamic logic scripts
  if (
    event.request.url.includes('/api/') ||
    event.request.url.includes('notify-model.js') ||
    event.request.url.includes('trycloudflare.com') ||
    event.request.url.includes('app.js') ||
    event.request.url.includes('notification.js') ||
    event.request.url.includes('firebase-sync.js')
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
      }).catch((err) => {
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// Push Notification: Handle incoming background push messages (NotifyHub & Local WebPush)
self.addEventListener('push', (event) => {
  let data = {
    title: '⚠️ แจ้งเตือนจากระบบ IoT',
    body: 'คุณมีข้อความแจ้งเตือนใหม่จาก Web App',
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    url: './index.html?tab=notif',
    appId: 'my-webapp'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  // Use local app icon if NotifyHub sends default '/icons/icon-192.svg' which doesn't exist on this origin
  const resolvedIcon = (!data.icon || data.icon === '/icons/icon-192.svg')
    ? './assets/icons/icon-192.png'
    : data.icon;
  const resolvedBadge = (!data.badge || data.badge === '/icons/icon-192.svg')
    ? './assets/icons/icon-192.png'
    : data.badge;
  const resolvedUrl = (!data.url || data.url === '/')
    ? './index.html?tab=notif'
    : data.url;

  const options = {
    body: data.body || 'คลิกเพื่อดูรายละเอียดได้เลย',
    icon: resolvedIcon,
    badge: resolvedBadge,
    vibrate: [250, 100, 250, 100, 250],
    tag: data.tag || data.id || ('iot-alert-' + Date.now()),
    renotify: true,
    requireInteraction: data.priority === 'high' || true,
    data: {
      url: resolvedUrl,
      appId: data.appId || 'my-webapp',
      id: data.id,
      timestamp: Date.now()
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '🔔 IoT WebApp', options)
  );
});

// Notification Click: Focus existing app window or open a new one
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html?tab=notif';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && targetUrl && targetUrl !== '/') {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

