const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// =============================================================
// NotifyHub + IoT WebApp Unified VAPID Keys
// (Matched with Notification_system so existing iPhone/Android subscriptions work immediately)
// =============================================================
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BCurPl0IoT9oe-VY2goysFEKDRfXk9FywYc_EDfl8EUw2NHI8GaJP0t7lr-LHdM3tk9lg7ZXzvriJ2KfkFy_ByU';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'YEi0NZHFR51vvJE_rFV-BjukvmHVT10_luhhMs8V6MA';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:notify@example.com';

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const DEFAULT_APPS = [
  {
    appId: 'default',
    name: 'แจ้งเตือนทั่วไป (Default)',
    icon: '🔔',
    color: '#6366f1',
    createdAt: '2026-11-09T16:34:39.364Z'
  },
  {
    appId: 'my-webapp',
    name: 'Web App ของฉัน',
    icon: '🚀',
    color: '#10b981',
    createdAt: '2026-11-09T16:34:39.365Z'
  },
  {
    appId: 'tas01-01',
    name: 'Tas01',
    icon: '⚡',
    color: '#e23232',
    description: '',
    createdAt: '2026-11-11T04:27:18.033Z'
  }
];

const DEFAULT_SUBSCRIPTIONS = [
  {
    id: '99fbb8b3-ed1f-4e79-ab05-9074626165a6',
    subscription: {
      endpoint: 'https://web.push.apple.com/QI28pw4PY0dz4-YWEdmlSDlQggNMFPiw60JvzUb8mPWKrHARGyaKE4el36ipMRunCfmMUBGH8o-gojQerhvpFf7CWYeW5CXavZXZ_NVu4I1iZGhoXaRUUPO6HB75EUAx8qO6jMFogucb_hTATbwon6bJ3oULSvnpOAHdnMXOke4',
      keys: {
        p256dh: 'BCS6rLfx8b8OFDiVovjnrcPZiHySOwG6zC4GgL0l5l4OGTK7-63zNep_bYmZJ4LxEOPScQ32xlJEvN2mGh89zjA',
        auth: 'BZDC1Cq9Bxxvrw3vDTKdHg'
      }
    },
    appId: '*',
    userId: 'all',
    deviceName: '📱 iPhone (iOS) I13',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Mobile/15E148 Safari/604.1',
    enabled: true,
    updatedAt: '2026-11-11T05:41:07.031Z',
    createdAt: '2026-11-11T03:49:05.056Z'
  }
];

// SSE Clients for real-time NotifyHub & IoT feed updates
const sseClients = new Set();

function broadcastSSE(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

// Server-side Anti-Spam Cooldown Tracker (5 minutes cooldown per metric)
const serverAlertCooldowns = {
  temp: 0,
  humid: 0,
  co2: 0,
  lux: 0
};
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.webmanifest': 'application/manifest+json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// Database helper functions
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
        device: { id: 'esp32-node-01', name: 'ตู้ควบคุมและเซนเซอร์ IoT', lastSeen: null, ip: null },
        telemetry: { temp: null, humid: null, co2: null, lux: null, timestamp: null },
        relays: { fogger: false, fan: false, light: false, curtain: false },
        targets: { tempMin: 24, tempMax: 28, humidMin: 80, humidMax: 90, co2Max: 1000, luxMin: 200, luxMax: 1000 },
        history: [],
        vapidKeys: { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY },
        apps: [...DEFAULT_APPS],
        subscriptions: [...DEFAULT_SUBSCRIPTIONS],
        messages: [],
        notifications: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.apps) || parsed.apps.length === 0) parsed.apps = [...DEFAULT_APPS];
    if (!Array.isArray(parsed.subscriptions) || parsed.subscriptions.length === 0) {
      parsed.subscriptions = [...DEFAULT_SUBSCRIPTIONS];
    }
    if (!Array.isArray(parsed.messages)) parsed.messages = [];
    if (!Array.isArray(parsed.notifications)) parsed.notifications = [];
    return parsed;
  } catch (e) {
    console.error('[DB] Read error:', e);
    return {
      device: { id: 'esp32-node-01', lastSeen: null },
      telemetry: { temp: null, humid: null, co2: null, lux: null, timestamp: null },
      relays: { fogger: false, fan: false, light: false, curtain: false },
      targets: { tempMin: 24, tempMax: 28, humidMin: 80, humidMax: 90, co2Max: 1000, luxMin: 200, luxMax: 1000 },
      history: [],
      apps: [...DEFAULT_APPS],
      subscriptions: [...DEFAULT_SUBSCRIPTIONS],
      messages: [],
      notifications: []
    };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[DB] Write error:', e);
    return false;
  }
}

// Normalize subscription record (supports both NotifyHub wrapper and raw WebPush subscription)
function normalizeSubRecord(entry) {
  if (!entry) return null;
  if (entry.subscription && entry.subscription.endpoint) {
    return entry;
  }
  if (entry.endpoint) {
    return {
      id: entry.id || crypto.randomUUID(),
      subscription: entry,
      appId: entry.appId || '*',
      userId: entry.userId || 'all',
      deviceName: entry.deviceName || '📱 Mobile/Web Device',
      userAgent: entry.userAgent || '',
      enabled: entry.enabled !== false,
      updatedAt: entry.updatedAt || new Date().toISOString(),
      createdAt: entry.createdAt || new Date().toISOString()
    };
  }
  return null;
}

// Log a notification to database history
function logServerNotification(title, desc, type = 'warning', meta = {}) {
  try {
    const db = readDb();
    db.notifications = db.notifications || [];
    const item = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      title: title,
      desc: desc || '',
      type: type,
      time: Date.now(),
      read: false,
      meta: meta
    };
    db.notifications.unshift(item);
    if (db.notifications.length > 50) db.notifications.pop();
    writeDb(db);
    return item;
  } catch (e) {
    console.error('[Notification] Log error:', e);
    return null;
  }
}

// Unified NotifyHub & IoT Push Dispatcher
async function sendUnifiedNotification({
  appId = 'my-webapp',
  appName,
  title = 'แจ้งเตือนใหม่',
  body = '',
  url = './index.html?tab=notif',
  icon = './assets/icons/icon-192.png',
  userId = null,
  targetDeviceId = null,
  priority = 'high',
  data = {}
}) {
  const db = readDb();
  db.apps = db.apps || [...DEFAULT_APPS];
  const cleanAppId = (appId || 'my-webapp').trim();
  let app = db.apps.find(a => a.appId === cleanAppId);
  if (!app) {
    app = {
      appId: cleanAppId,
      name: appName || cleanAppId,
      icon: '🚀',
      color: '#10b981',
      createdAt: new Date().toISOString()
    };
    db.apps.push(app);
  }

  const normalizedSubs = (db.subscriptions || []).map(normalizeSubRecord).filter(Boolean);
  db.subscriptions = normalizedSubs;

  const messageRecord = {
    id: crypto.randomUUID(),
    appId: app.appId,
    appName: app.name,
    appIcon: app.icon || '🔔',
    title,
    body,
    url: url || './index.html?tab=notif',
    userId: userId || 'all',
    targetDeviceId: targetDeviceId || null,
    priority,
    data,
    createdAt: new Date().toISOString()
  };

  const targets = normalizedSubs.filter(sub => {
    if (sub.enabled === false) return false;
    if (targetDeviceId) return sub.id === targetDeviceId;
    const appMatch = !sub.appId || sub.appId === '*' || sub.appId === app.appId || app.appId === 'default';
    const userMatch = !userId || userId === 'all' || sub.userId === userId || sub.userId === 'all';
    return appMatch && userMatch;
  });

  const payload = JSON.stringify({
    id: messageRecord.id,
    appId: app.appId,
    appName: app.name,
    title: title,
    rawTitle: title,
    body: body,
    icon: icon || './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: data.tag || messageRecord.id,
    url: url || './index.html?tab=notif',
    priority,
    timestamp: Date.now(),
    data
  });

  let sentCount = 0;
  let failedCount = 0;
  const deadEndpoints = [];

  await Promise.all(
    targets.map(async (target) => {
      try {
        await webpush.sendNotification(target.subscription, payload, {
          TTL: 86400,
          urgency: priority === 'high' ? 'high' : 'normal'
        });
        sentCount++;
      } catch (err) {
        failedCount++;
        if (err.statusCode === 404 || err.statusCode === 410) {
          deadEndpoints.push(target.subscription.endpoint);
        } else {
          console.warn(`[NotifyHub] Push error for ${target.deviceName}:`, err.statusCode || err.message);
        }
      }
    })
  );

  if (deadEndpoints.length > 0) {
    db.subscriptions = db.subscriptions.filter(s => !deadEndpoints.includes(s.subscription.endpoint));
  }

  messageRecord.delivery = {
    totalTargets: targets.length,
    sentCount,
    failedCount
  };

  db.messages = db.messages || [];
  db.messages.unshift(messageRecord);
  if (db.messages.length > 100) db.messages = db.messages.slice(0, 100);

  writeDb(db);
  broadcastSSE('new_message', messageRecord);

  console.log(`[NotifyHub] Sent "${title}" (${sentCount}/${targets.length} devices)`);
  return {
    success: true,
    message: messageRecord,
    delivery: messageRecord.delivery,
    sent: sentCount,
    total: targets.length
  };
}

// Broadcast Web Push helper for IoT Sensor Alerts
async function broadcastPushNotification(title, body, meta = {}) {
  return await sendUnifiedNotification({
    appId: 'my-webapp',
    title,
    body,
    url: './index.html?tab=notif',
    priority: 'high',
    data: meta
  });
}

// Smart Server-side Telemetry Evaluation Rule Engine
function evaluateServerAlerts(telemetry, targets) {
  if (!telemetry || telemetry.temp === null || telemetry.temp === undefined) return;
  const now = Date.now();
  const t = Number(telemetry.temp);
  const h = Number(telemetry.humid);
  const c = Number(telemetry.co2);
  const l = Number(telemetry.lux);

  const activeTargets = targets || {
    tempMin: 24, tempMax: 28,
    humidMin: 80, humidMax: 90,
    co2Max: 1000,
    luxMin: 200, luxMax: 1000
  };

  // 1. Temperature Alert Rule
  if (now - serverAlertCooldowns.temp > ALERT_COOLDOWN_MS) {
    if (t > activeTargets.tempMax) {
      serverAlertCooldowns.temp = now;
      const title = '⚠️ อุณหภูมิสูงเกินกำหนด!';
      const body = `อุณหภูมิปัจจุบัน ${t.toFixed(1)} °C สูงกว่าเกณฑ์ความปลอดภัย (${activeTargets.tempMin} - ${activeTargets.tempMax} °C)`;
      broadcastPushNotification(title, body, { metric: 'temp', val: t, tag: 'alert-temp' });
      logServerNotification(title, body, 'warning', { metric: 'temp', val: t });
    } else if (t < activeTargets.tempMin) {
      serverAlertCooldowns.temp = now;
      const title = '❄️ อุณหภูมิต่ำกว่ากำหนด!';
      const body = `อุณหภูมิปัจจุบัน ${t.toFixed(1)} °C ต่ำกว่าเกณฑ์ความปลอดภัย (${activeTargets.tempMin} - ${activeTargets.tempMax} °C)`;
      broadcastPushNotification(title, body, { metric: 'temp', val: t, tag: 'alert-temp' });
      logServerNotification(title, body, 'warning', { metric: 'temp', val: t });
    }
  }

  // 2. Humidity Alert Rule
  if (now - serverAlertCooldowns.humid > ALERT_COOLDOWN_MS) {
    if (h < activeTargets.humidMin) {
      serverAlertCooldowns.humid = now;
      const title = '💧 ความชื้นในอากาศต่ำเกินไป!';
      const body = `ความชื้นปัจจุบัน ${h.toFixed(1)} % ต่ำกว่าเกณฑ์ (${activeTargets.humidMin} - ${activeTargets.humidMax} %) แนะนำเปิดหัวพ่นหมอก`;
      broadcastPushNotification(title, body, { metric: 'humid', val: h, tag: 'alert-humid' });
      logServerNotification(title, body, 'warning', { metric: 'humid', val: h });
    } else if (h > activeTargets.humidMax) {
      serverAlertCooldowns.humid = now;
      const title = '🌧️ ความชื้นในอากาศสูงเกินไป!';
      const body = `ความชื้นปัจจุบัน ${h.toFixed(1)} % สูงกว่าเกณฑ์ (${activeTargets.humidMin} - ${activeTargets.humidMax} %) แนะนำเปิดพัดลมระบาย`;
      broadcastPushNotification(title, body, { metric: 'humid', val: h, tag: 'alert-humid' });
      logServerNotification(title, body, 'warning', { metric: 'humid', val: h });
    }
  }

  // 3. CO2 Alert Rule
  if (c && now - serverAlertCooldowns.co2 > ALERT_COOLDOWN_MS) {
    if (c > activeTargets.co2Max) {
      serverAlertCooldowns.co2 = now;
      const title = '⚠️ ระดับ CO₂ สูงเกินเกณฑ์!';
      const body = `ระดับก๊าซ CO₂ ${c} ppm สูงกว่าเกณฑ์ความปลอดภัย (< ${activeTargets.co2Max} ppm) ควรระบายอากาศ`;
      broadcastPushNotification(title, body, { metric: 'co2', val: c, tag: 'alert-co2' });
      logServerNotification(title, body, 'warning', { metric: 'co2', val: c });
    }
  }

  // 4. Lux Alert Rule
  if (l !== null && l !== undefined && now - serverAlertCooldowns.lux > ALERT_COOLDOWN_MS) {
    if (l < activeTargets.luxMin) {
      serverAlertCooldowns.lux = now;
      const title = '💡 แสงสว่างต่ำกว่าเกณฑ์!';
      const body = `ความสว่างปัจจุบัน ${l} lux ต่ำกว่าเกณฑ์มาตรฐาน (${activeTargets.luxMin} - ${activeTargets.luxMax} lux)`;
      broadcastPushNotification(title, body, { metric: 'lux', val: l, tag: 'alert-lux' });
      logServerNotification(title, body, 'warning', { metric: 'lux', val: l });
    }
  }
}

// Ensure data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Helper to read JSON body
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Create HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS Headers for API calls (supports GitHub Pages, Mobile PWA, Localhost)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // -------------------------------------------------------------
  // API: Real-time SSE Stream (/api/stream)
  // -------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=UTF-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'ok' })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // -------------------------------------------------------------
  // API: Health Check (/api/health)
  // -------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify({
      status: 'alive',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // -------------------------------------------------------------
  // API: Get Unified Status (IoT Telemetry + NotifyHub Devices/Apps/Messages)
  // -------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/status') {
    const db = readDb();
    const now = Date.now();
    const isOnline = Boolean(db.device && db.device.lastSeen && (now - db.device.lastSeen < 25000));
    const secondsAgo = db.device && db.device.lastSeen ? Math.round((now - db.device.lastSeen) / 1000) : null;

    const normalizedSubs = (db.subscriptions || []).map(normalizeSubRecord).filter(Boolean);
    const filterAppId = url.searchParams.get('appId') || '*';
    let messages = db.messages || [];
    if (filterAppId && filterAppId !== '*') {
      messages = messages.filter(m => m.appId === filterAppId || m.appId === 'default');
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      // IoT WebApp fields
      online: isOnline,
      lastSeen: db.device ? db.device.lastSeen : null,
      secondsAgo: secondsAgo,
      device: db.device,
      telemetry: db.telemetry,
      relays: db.relays,
      targets: db.targets,
      history: db.history || [],
      notifications: db.notifications || [],
      // NotifyHub fields
      publicKey: VAPID_PUBLIC_KEY,
      apps: db.apps || DEFAULT_APPS,
      subscriptionsCount: normalizedSubs.length,
      devices: normalizedSubs.map(s => ({
        id: s.id,
        appId: s.appId || '*',
        userId: s.userId || 'all',
        deviceName: s.deviceName || '📱 Mobile Device',
        enabled: s.enabled !== false,
        userAgent: s.userAgent || '',
        updatedAt: s.updatedAt,
        createdAt: s.createdAt
      })),
      messages: messages.slice(0, 60)
    }));
    return;
  }

  // -------------------------------------------------------------
  // API: Get VAPID Public Key (/api/vapid-public-key & /api/push/vapid-public-key)
  // -------------------------------------------------------------
  if (req.method === 'GET' && (pathname === '/api/vapid-public-key' || pathname === '/api/push/vapid-public-key')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      success: true,
      publicKey: VAPID_PUBLIC_KEY
    }));
    return;
  }

  // -------------------------------------------------------------
  // API: Subscribe Device (/api/subscribe & /api/push/subscribe)
  // -------------------------------------------------------------
  if (req.method === 'POST' && (pathname === '/api/subscribe' || pathname === '/api/push/subscribe')) {
    try {
      const payload = await parseRequestBody(req);
      const sub = payload.subscription || payload;

      if (!sub || !sub.endpoint) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid push subscription payload' }));
        return;
      }

      const db = readDb();
      const normalized = (db.subscriptions || []).map(normalizeSubRecord).filter(Boolean);
      const existingIdx = normalized.findIndex(s => s.subscription.endpoint === sub.endpoint);

      const record = {
        id: existingIdx >= 0 ? normalized[existingIdx].id : crypto.randomUUID(),
        subscription: sub,
        appId: payload.appId || '*',
        userId: payload.userId || 'all',
        deviceName: payload.deviceName || '📱 Mobile/Web Device',
        userAgent: req.headers['user-agent'] || '',
        enabled: existingIdx >= 0 ? normalized[existingIdx].enabled !== false : true,
        updatedAt: new Date().toISOString(),
        createdAt: existingIdx >= 0 ? normalized[existingIdx].createdAt : new Date().toISOString()
      };

      if (existingIdx >= 0) {
        normalized[existingIdx] = record;
      } else {
        normalized.push(record);
      }

      db.subscriptions = normalized;
      writeDb(db);
      broadcastSSE('devices_updated', { count: normalized.length });
      console.log(`[NotifyHub] Device registered: ${record.deviceName} (Total: ${normalized.length})`);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({
        success: true,
        device: record,
        subscriptionsCount: normalized.length
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // -------------------------------------------------------------
  // API: Unsubscribe Device (/api/unsubscribe & /api/push/unsubscribe)
  // -------------------------------------------------------------
  if (req.method === 'POST' && (pathname === '/api/unsubscribe' || pathname === '/api/push/unsubscribe')) {
    try {
      const payload = await parseRequestBody(req);
      const endpoint = payload.endpoint;
      const db = readDb();
      const normalized = (db.subscriptions || []).map(normalizeSubRecord).filter(Boolean);
      db.subscriptions = endpoint ? normalized.filter(s => s.subscription.endpoint !== endpoint) : normalized;
      writeDb(db);
      broadcastSSE('devices_updated', { count: db.subscriptions.length });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({
        success: true,
        subscriptionsCount: db.subscriptions.length
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
    }
    return;
  }

  // -------------------------------------------------------------
  // API: Send Notification (/api/notify & /api/push/test)
  // -------------------------------------------------------------
  if (req.method === 'POST' && (pathname === '/api/notify' || pathname === '/api/push/test')) {
    try {
      const payload = await parseRequestBody(req);
      const title = payload.title || '🔔 แจ้งเตือนจาก IoT WebApp';
      const body = payload.body || 'ระบบแจ้งเตือนเชื่อมต่อและทำงานสมบูรณ์แล้ว!';
      const appId = payload.appId || 'my-webapp';
      const targetDeviceId = payload.targetDeviceId || payload.deviceId || null;
      const priority = payload.priority || 'high';
      const delaySeconds = Math.max(0, Math.min(Number(payload.delaySeconds) || 0, 60));

      if (delaySeconds > 0) {
        setTimeout(() => {
          sendUnifiedNotification({
            appId,
            appName: payload.appName,
            title,
            body,
            url: payload.url || './index.html?tab=notif',
            targetDeviceId,
            priority,
            data: payload.data || {}
          }).catch(e => console.error('[NotifyHub] Delayed error:', e));
        }, delaySeconds * 1000);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({
          success: true,
          scheduled: true,
          delaySeconds,
          message: `ตั้งเวลาส่งแจ้งเตือนในอีก ${delaySeconds} วินาที`
        }));
        return;
      }

      const result = await sendUnifiedNotification({
        appId,
        appName: payload.appName,
        title,
        body,
        url: payload.url || './index.html?tab=notif',
        targetDeviceId,
        priority,
        data: payload.data || {}
      });

      logServerNotification(title, body, priority === 'high' ? 'warning' : 'message', { source: 'notifyhub' });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // -------------------------------------------------------------
  // API: NotifyHub Channels & Devices Management
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/apps') {
    try {
      const { appId, name, icon = '⚡', color = '#6366f1', description = '' } = await parseRequestBody(req);
      const cleanId = (appId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      if (!cleanId) throw new Error('กรุณาระบุรหัสแชนแนล (appId)');
      const db = readDb();
      db.apps = db.apps || [...DEFAULT_APPS];
      if (db.apps.some(a => a.appId === cleanId)) throw new Error(`แชนแนล "${cleanId}" มีอยู่แล้ว`);
      const created = { appId: cleanId, name: (name || cleanId).trim(), icon, color, description, createdAt: new Date().toISOString() };
      db.apps.push(created);
      writeDb(db);
      broadcastSSE('apps_updated', db.apps);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ success: true, app: created, apps: db.apps }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname.startsWith('/api/devices/') && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const devId = decodeURIComponent(pathname.replace('/api/devices/', ''));
    const db = readDb();
    const normalized = (db.subscriptions || []).map(normalizeSubRecord).filter(Boolean);
    if (req.method === 'DELETE') {
      db.subscriptions = normalized.filter(s => s.id !== devId);
      writeDb(db);
      broadcastSSE('devices_updated', { count: db.subscriptions.length });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    try {
      const body = await parseRequestBody(req);
      const target = normalized.find(s => s.id === devId);
      if (!target) throw new Error('ไม่พบอุปกรณ์');
      if (typeof body.deviceName === 'string' && body.deviceName.trim()) target.deviceName = body.deviceName.trim();
      if (typeof body.appId === 'string') target.appId = body.appId.trim() || '*';
      if (typeof body.enabled === 'boolean') target.enabled = body.enabled;
      target.updatedAt = new Date().toISOString();
      db.subscriptions = normalized;
      writeDb(db);
      broadcastSSE('devices_updated', { count: db.subscriptions.length });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ success: true, device: target }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'DELETE' && pathname === '/api/messages') {
    const db = readDb();
    db.messages = [];
    writeDb(db);
    broadcastSSE('messages_cleared', {});
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // -------------------------------------------------------------
  // API: ESP32 Telemetry Ingestion (ESP32 sends HTTP POST)
  // -------------------------------------------------------------
  if (req.method === 'POST' && (pathname === '/api/esp32/telemetry' || pathname === '/api/telemetry')) {
    try {
      const payload = await parseRequestBody(req);
      const db = readDb();
      const now = Date.now();

      db.telemetry = {
        temp: payload.temp !== undefined ? Number(payload.temp) : db.telemetry.temp,
        humid: payload.humid !== undefined ? Number(payload.humid) : db.telemetry.humid,
        co2: payload.co2 !== undefined ? Number(payload.co2) : db.telemetry.co2,
        lux: payload.lux !== undefined ? Number(payload.lux) : db.telemetry.lux,
        timestamp: now
      };

      db.device = db.device || {};
      db.device.lastSeen = now;
      db.device.ip = req.socket.remoteAddress || req.headers['x-forwarded-for'];
      if (payload.deviceId) db.device.id = payload.deviceId;

      db.history = db.history || [];
      const lastPoint = db.history.length > 0 ? db.history[db.history.length - 1] : null;

      if (!lastPoint || (now - lastPoint.time >= 60000)) {
        db.history.push({
          time: now,
          temp: db.telemetry.temp,
          humid: db.telemetry.humid,
          co2: db.telemetry.co2,
          lux: db.telemetry.lux
        });

        const thirtyOneDaysAgo = now - (31 * 24 * 3600 * 1000);
        db.history = db.history.filter(h => h.time >= thirtyOneDaysAgo);

        if (db.history.length > 1500) {
          const recent = db.history.slice(-300);
          const older = db.history.slice(0, -300).filter((_, idx) => idx % 2 === 0);
          db.history = older.concat(recent);
        }
      }

      writeDb(db);

      try {
        evaluateServerAlerts(db.telemetry, db.targets);
      } catch (evalErr) {
        console.error('[WebPush] Error evaluating alerts:', evalErr);
      }

      console.log(`[ESP32] Telemetry received from ${db.device.ip}: Temp=${db.telemetry.temp}, Humid=${db.telemetry.humid}, Lux=${db.telemetry.lux}, CO2=${db.telemetry.co2}`);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({
        success: true,
        connected: true,
        relays: db.relays
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
    }
    return;
  }

  // -------------------------------------------------------------
  // API: Get Notification History from Server
  // -------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/notifications') {
    const db = readDb();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      success: true,
      notifications: db.notifications || []
    }));
    return;
  }

  // -------------------------------------------------------------
  // API: Clear Server Notification History
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/notifications/clear') {
    const db = readDb();
    db.notifications = [];
    writeDb(db);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify({ success: true, message: 'Server notifications cleared' }));
    return;
  }

  // -------------------------------------------------------------
  // API: Seed Demo History (for testing 7d and 30d views)
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/history/seed-demo') {
    try {
      const parsed = await parseRequestBody(req);
      const days = parsed.days ? Number(parsed.days) : 7;
      const db = readDb();
      const now = Date.now();
      const generated = [];
      const stepHours = days <= 7 ? 2 : 4;
      const totalSteps = Math.floor((days * 24) / stepHours);

      for (let i = totalSteps; i >= 0; i--) {
        const t = now - (i * stepHours * 3600 * 1000);
        const hour = new Date(t).getHours();
        const isDay = hour >= 6 && hour <= 18;
        const tempBase = isDay ? 27.5 : 24.5;
        const temp = Number((tempBase + Math.sin(hour / 3.8) * 2.2 + (Math.random() * 0.6 - 0.3)).toFixed(1));
        const humid = Number((isDay ? 81 + Math.random() * 5 : 87 + Math.random() * 4).toFixed(1));
        const lux = isDay ? Math.round(350 + Math.sin(((hour - 6) / 12) * Math.PI) * 450 + Math.random() * 50) : 0;
        const co2 = Math.round(410 + Math.random() * 110);

        generated.push({ time: t, temp, humid, lux, co2 });
      }

      db.history = generated;
      writeDb(db);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({
        success: true,
        pointsCount: generated.length,
        history: generated
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // -------------------------------------------------------------
  // API: Web Control Switches (User changes relays from WebApp)
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/control') {
    try {
      const payload = await parseRequestBody(req);
      const db = readDb();
      db.relays = db.relays || {};

      if (payload.relays) {
        db.relays = { ...db.relays, ...payload.relays };
      } else if (payload.relay !== undefined && payload.state !== undefined) {
        db.relays[payload.relay] = Boolean(payload.state);
      }

      writeDb(db);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ success: true, relays: db.relays }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
    }
    return;
  }

  // -------------------------------------------------------------
  // Static File Serving
  // -------------------------------------------------------------
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  } else if (reqPath === '/notifyhub') {
    reqPath = '/notifyhub.html';
  }

  const filePath = path.join(__dirname, reqPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('500 Server Error: ' + err.code);
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.json') ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
      });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 IoT WebApp + NotifyHub Server is running!`);
  console.log(`💻 Local URL:      http://localhost:${PORT}`);
  console.log(`🔔 NotifyHub UI:   http://localhost:${PORT}/notifyhub.html`);
  console.log(`📥 ESP32 Endpoint: POST http://localhost:${PORT}/api/esp32/telemetry`);
  console.log(`📤 Notify API:     POST http://localhost:${PORT}/api/notify`);
  console.log(`=======================================================`);
});
