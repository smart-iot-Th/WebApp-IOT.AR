const CACHE_NAME = 'iot-webapp-v16';
const SW_CONFIG_CACHE = 'iot-device-config-v1';
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
          if (key !== CACHE_NAME && key !== SW_CONFIG_CACHE) {
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

async function getSwDeviceConfig() {
  try {
    const cache = await caches.open(SW_CONFIG_CACHE);
    const res = await cache.match('/__iot_device_config__');
    if (res) {
      return await res.json();
    }
  } catch (_) {}
  return null;
}

function parseTargetFromBody(bodyText = '') {
  const str = String(bodyText || '');
  const match = str.match(/\s*#tgt:([a-zA-Z0-9_-]+)/);
  if (!match) {
    return { cleanBody: str, targetDeviceId: null };
  }
  return {
    cleanBody: str.replace(/\s*#tgt:[a-zA-Z0-9_-]+/g, '').trim(),
    targetDeviceId: match[1]
  };
}

// Core Web Push Notification Handler (Supports Per-Device Filtering & Lock Screen Push)
self.addEventListener('push', (event) => {
  let payload = {
    title: 'IoT WebApp แจ้งเตือนใหม่',
    body: 'คุณมีข้อความแจ้งเตือนใหม่',
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    url: './index.html?tab=notif',
    appId: 'my-webapp'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch (_) {
      payload.body = event.data.text();
    }
  }

  const parsedTarget = parseTargetFromBody(payload.body);
  const cleanBody = parsedTarget.cleanBody;
  const targetDeviceId = payload.targetDeviceId || (payload.data && payload.data.targetDeviceId) || parsedTarget.targetDeviceId || null;

  event.waitUntil(
    (async () => {
      const config = await getSwDeviceConfig();
      if (config) {
        if (config.enabled === false) {
          return;
        }
        if (targetDeviceId && config.deviceId && targetDeviceId !== config.deviceId) {
          return;
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
        body: cleanBody,
        icon: resolvedIcon,
        badge: resolvedBadge,
        vibrate: [200, 100, 200],
        tag: payload.id || payload.tag || `notify-${Date.now()}`,
        renotify: true,
        requireInteraction: payload.priority === 'high',
        data: {
          url: resolvedUrl,
          appId: payload.appId || 'my-webapp',
          id: payload.id,
          targetDeviceId
        }
      };

      await self.registration.showNotification(payload.title, options);

      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clientList.forEach((client) => {
        try {
          client.postMessage({
            type: 'NOTIFYHUB_PUSH_RECEIVED',
            payload: {
              id: payload.id || options.tag,
              title: payload.rawTitle || payload.title,
              body: cleanBody,
              priority: payload.priority || 'high',
              appId: payload.appId || 'my-webapp',
              appName: payload.appName || 'IoT WebApp',
              targetDeviceId,
              timestamp: Date.now()
            }
          });
        } catch (_) {}
      });
    })()
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
