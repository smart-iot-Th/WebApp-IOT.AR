const CACHE_NAME = 'iot-webapp-v6';
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
      console.log('[ServiceWorker] Pre-caching Smart Farm assets (v6)');
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

  // Never intercept or cache dynamic API requests or dynamic logic scripts
  if (
    event.request.url.includes('/api/') || 
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

// Push Notification: Handle incoming background push messages (Lock screen & background)
self.addEventListener('push', (event) => {
  let data = { title: '⚠️ แจ้งเตือนจากระบบ IoT', body: 'ตรวจพบความผิดปกติของเซนเซอร์' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || 'ระบบตรวจพบสถานะที่ต้องตรวจสอบ',
    icon: data.icon || './assets/icons/icon-192.png',
    badge: data.badge || './assets/icons/icon-192.png',
    vibrate: [250, 100, 250, 100, 250],
    tag: data.tag || ('iot-alert-' + Date.now()),
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || './index.html?tab=notif',
      timestamp: Date.now()
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '⚠️ IoT WebApp', options)
  );
});

// Notification Click: Focus existing app window or open a new one
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html?tab=notif';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('index.html') && 'focus' in client) {
          if ('navigate' in client && targetUrl) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

