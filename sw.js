const CACHE_NAME = 'iot-webapp-v17';
const SW_CONFIG_CACHE = 'iot-device-config-v1';
const CLOUD_PUSH_SERVER = 'https://webapp-iot-ar.onrender.com';
const BUILT_IN_VAPID_PUBLIC_KEY = 'BCGnkh_R4WHFuT6J7UrfwJGCzZWHSRsaNO_1mpnTayUTyMVxiWeXxLaACGmePZTk6FqPlBfRU0wWaQZ_CYYhG54';

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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Core Web Push Notification Handler (Wakes up Lock Screen when phone screen is off or app is closed)
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

      // ใช้ unique tag ทุกครั้ง เพื่อให้ iOS และ Android ปลุกหน้าจอล็อคและส่งเสียงเตือนทุกข้อความ ไม่ถูกยุบรวมเงียบๆ
      const uniqueTag = `iot-push-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const options = {
        body: cleanBody,
        icon: resolvedIcon,
        badge: resolvedBadge,
        vibrate: [300, 100, 300, 100, 400],
        tag: uniqueTag,
        renotify: true,
        requireInteraction: true,
        silent: false,
        timestamp: Date.now(),
        data: {
          url: resolvedUrl,
          appId: payload.appId || 'my-webapp',
          id: payload.id || uniqueTag,
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
              id: payload.id || uniqueTag,
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

// Auto re-subscribe if OS rotates push token while app is closed
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(BUILT_IN_VAPID_PUBLIC_KEY)
        });
        await fetch(`${CLOUD_PUSH_SERVER}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: newSub })
        });
      } catch (_) {}
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
