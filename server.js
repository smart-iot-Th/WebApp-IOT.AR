const http = require('http');
const fs = require('fs');
const path = require('path');

const webpush = require('web-push');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// VAPID Web Push Keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BCGnkh_R4WHFuT6J7UrfwJGCzZWHSRsaNO_1mpnTayUTyMVxiWeXxLaACGmePZTk6FqPlBfRU0wWaQZ_CYYhG54';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'C7xEe7ESDYxicfZmoul_c-_u2JcV2gb-2jdbsSQu0BU';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@smartiot.local';

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

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
        subscriptions: [],
        notifications: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.subscriptions)) parsed.subscriptions = [];
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
      subscriptions: [],
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

// Broadcast Web Push to all subscribed devices
async function broadcastPushNotification(title, body, meta = {}) {
  const db = readDb();
  if (!db.subscriptions || db.subscriptions.length === 0) {
    console.log('[WebPush] No device subscriptions to notify.');
    return { sent: 0, total: 0 };
  }

  const payload = JSON.stringify({
    title: title,
    body: body,
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: meta.tag || ('iot-alert-' + (meta.metric || Date.now())),
    url: './index.html?tab=notif',
    timestamp: Date.now(),
    meta: meta
  });

  const remainingSubs = [];
  let sent = 0;

  for (const sub of db.subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      remainingSubs.push(sub);
      sent++;
    } catch (err) {
      console.warn(`[WebPush] Failed send to subscription:`, err.statusCode || err.message);
      // HTTP 404 or 410 means subscription is expired or cancelled by user
      if (err.statusCode !== 404 && err.statusCode !== 410) {
        remainingSubs.push(sub);
      }
    }
  }

  if (remainingSubs.length !== db.subscriptions.length) {
    db.subscriptions = remainingSubs;
    writeDb(db);
  }

  console.log(`[WebPush] Sent push notification: "${title}" (${sent}/${db.subscriptions.length} devices)`);
  return { sent, total: db.subscriptions.length };
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

// Create HTTP Server
const server = http.createServer((req, res) => {
  // CORS Headers for API calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // -------------------------------------------------------------
  // API: Get Status & Real Sensor Telemetry
  // -------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/status') {
    const db = readDb();
    const now = Date.now();
    // Considered ONLINE if telemetry was received within the last 25 seconds
    const isOnline = Boolean(db.device && db.device.lastSeen && (now - db.device.lastSeen < 25000));
    const secondsAgo = db.device && db.device.lastSeen ? Math.round((now - db.device.lastSeen) / 1000) : null;

    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      online: isOnline,
      lastSeen: db.device ? db.device.lastSeen : null,
      secondsAgo: secondsAgo,
      device: db.device,
      telemetry: db.telemetry,
      relays: db.relays,
      targets: db.targets,
      history: db.history || [],
      notifications: db.notifications || [],
      subscriptionsCount: (db.subscriptions || []).length
    }));
    return;
  }

  // -------------------------------------------------------------
  // API: ESP32 Telemetry Ingestion (ESP32 sends HTTP POST)
  // -------------------------------------------------------------
  if (req.method === 'POST' && (pathname === '/api/esp32/telemetry' || pathname === '/api/telemetry')) {
    let bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', () => {
      try {
        const bodyStr = Buffer.concat(bodyChunks).toString('utf8');
        const payload = JSON.parse(bodyStr);

        const db = readDb();
        const now = Date.now();

        // Update telemetry data
        db.telemetry = {
          temp: payload.temp !== undefined ? Number(payload.temp) : db.telemetry.temp,
          humid: payload.humid !== undefined ? Number(payload.humid) : db.telemetry.humid,
          co2: payload.co2 !== undefined ? Number(payload.co2) : db.telemetry.co2,
          lux: payload.lux !== undefined ? Number(payload.lux) : db.telemetry.lux,
          timestamp: now
        };

        // Update device connection status
        db.device = db.device || {};
        db.device.lastSeen = now;
        db.device.ip = req.socket.remoteAddress || req.headers['x-forwarded-for'];
        if (payload.deviceId) db.device.id = payload.deviceId;

        // Log historical telemetry (keep max 100 points)
        db.history = db.history || [];
        db.history.push({
          time: now,
          temp: db.telemetry.temp,
          humid: db.telemetry.humid,
          co2: db.telemetry.co2,
          lux: db.telemetry.lux
        });
        if (db.history.length > 100) {
          db.history.shift();
        }

        writeDb(db);

        // Run smart server-side alert evaluation (triggers Web Push to all devices if out of bounds)
        try {
          evaluateServerAlerts(db.telemetry, db.targets);
        } catch (evalErr) {
          console.error('[WebPush] Error evaluating alerts:', evalErr);
        }

        console.log(`[ESP32] Telemetry received from ${db.device.ip}: Temp=${db.telemetry.temp}, Humid=${db.telemetry.humid}, Lux=${db.telemetry.lux}, CO2=${db.telemetry.co2}`);

        // Return current relay commands so ESP32 knows whether to activate mist, fan, light, curtain
        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({
          success: true,
          connected: true,
          relays: db.relays
        }));
      } catch (err) {
        console.error('[ESP32] Bad payload:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // -------------------------------------------------------------
  // API: Get VAPID Public Key for Web Push Subscription
  // -------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/push/vapid-public-key') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      success: true,
      publicKey: VAPID_PUBLIC_KEY
    }));
    return;
  }

  // -------------------------------------------------------------
  // API: Subscribe Device for Native Web Push
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/push/subscribe') {
    let bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', () => {
      try {
        const bodyStr = Buffer.concat(bodyChunks).toString('utf8');
        const payload = JSON.parse(bodyStr);
        const sub = payload.subscription || payload;

        if (!sub || !sub.endpoint) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid push subscription payload' }));
          return;
        }

        const db = readDb();
        db.subscriptions = db.subscriptions || [];

        // Check if endpoint already exists; update keys if so, else add
        const existingIdx = db.subscriptions.findIndex(s => s.endpoint === sub.endpoint);
        if (existingIdx >= 0) {
          db.subscriptions[existingIdx] = sub;
        } else {
          db.subscriptions.push(sub);
        }

        writeDb(db);
        console.log(`[WebPush] Device registered. Total subscriptions: ${db.subscriptions.length}`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({
          success: true,
          message: 'Device subscribed successfully',
          subscriptionsCount: db.subscriptions.length
        }));
      } catch (err) {
        console.error('[WebPush] Subscription error:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // -------------------------------------------------------------
  // API: Unsubscribe Device
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/push/unsubscribe') {
    let bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', () => {
      try {
        const bodyStr = Buffer.concat(bodyChunks).toString('utf8');
        const payload = JSON.parse(bodyStr);
        const endpoint = payload.endpoint;

        const db = readDb();
        if (endpoint && Array.isArray(db.subscriptions)) {
          db.subscriptions = db.subscriptions.filter(s => s.endpoint !== endpoint);
          writeDb(db);
          console.log(`[WebPush] Device unsubscribed. Remaining: ${db.subscriptions.length}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({
          success: true,
          message: 'Unsubscribed successfully',
          subscriptionsCount: (db.subscriptions || []).length
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
      }
    });
    return;
  }

  // -------------------------------------------------------------
  // API: Send Test Web Push Notification
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/push/test') {
    let bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', async () => {
      try {
        let customMsg = 'ระบบแจ้งเตือนผ่านหน้าจอมือถือเชื่อมต่อเรียบร้อยแล้ว! พร้อมส่งสัญญาณเตือน 24 ชม.';
        let customTitle = '🔔 ทดสอบระบบแจ้งเตือน IoT';

        if (bodyChunks.length > 0) {
          try {
            const bodyStr = Buffer.concat(bodyChunks).toString('utf8');
            const parsed = JSON.parse(bodyStr);
            if (parsed.title) customTitle = parsed.title;
            if (parsed.body) customMsg = parsed.body;
          } catch (_) {}
        }

        const result = await broadcastPushNotification(customTitle, customMsg, { tag: 'test-push', isTest: true });
        logServerNotification(customTitle, customMsg, 'system', { isTest: true });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({
          success: true,
          message: 'Test notification sent',
          sent: result.sent,
          total: result.total
        }));
      } catch (err) {
        console.error('[WebPush] Test error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
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
  // API: Web Control Switches (User changes relays from WebApp)
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/control') {
    let bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', () => {
      try {
        const bodyStr = Buffer.concat(bodyChunks).toString('utf8');
        const payload = JSON.parse(bodyStr);
        const db = readDb();

        db.relays = db.relays || {};

        if (payload.relays) {
          db.relays = { ...db.relays, ...payload.relays };
        } else if (payload.relay !== undefined && payload.state !== undefined) {
          db.relays[payload.relay] = Boolean(payload.state);
        }

        writeDb(db);
        console.log('[Control] Relays updated:', db.relays);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ success: true, relays: db.relays }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // -------------------------------------------------------------
  // API: Reset DB to Offline (for testing)
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/reset-data') {
    const initial = {
      device: { id: 'esp32-node-01', name: 'ตู้ควบคุมและเซนเซอร์ IoT', lastSeen: null, ip: null },
      telemetry: { temp: null, humid: null, co2: null, lux: null, timestamp: null },
      relays: { fogger: false, fan: false, light: false, curtain: false },
      targets: { tempMin: 24, tempMax: 28, humidMin: 80, humidMax: 90, co2Max: 1000, luxMin: 200, luxMax: 1000 },
      history: []
    };
    writeDb(initial);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify({ success: true, message: 'Database reset to offline state' }));
    return;
  }

  // -------------------------------------------------------------
  // Handler to save generated icons from browser canvas
  // -------------------------------------------------------------
  if (req.method === 'POST' && pathname.startsWith('/save-icon')) {
    const filename = url.searchParams.get('name') || 'icon.png';
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const targetPath = path.join(__dirname, 'assets', 'icons', filename);
      fs.writeFileSync(targetPath, buffer);
      console.log(`Saved icon: ${filename} (${buffer.length} bytes)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, file: filename }));
    });
    return;
  }

  // -------------------------------------------------------------
  // Static File Serving
  // -------------------------------------------------------------
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
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
  console.log(`🚀 IoT WebApp Server is running!`);
  console.log(`💻 Local URL:      http://localhost:${PORT}`);
  console.log(`📡 Local Network:  http://192.168.1.138:${PORT}`);
  console.log(`📥 ESP32 Endpoint: POST http://192.168.1.138:${PORT}/api/esp32/telemetry`);
  console.log(`💾 Database File:  ${DB_FILE}`);
  console.log(`=======================================================`);
});
