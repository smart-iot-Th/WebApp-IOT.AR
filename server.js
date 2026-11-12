const http = require('http');
const fs = require('fs');
const path = require('path');
const notifyEngine = require('./src/NotifyEngine');
const { readDb, writeDb } = require('./src/storage');

const PORT = process.env.PORT || 3000;

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

// Trigger Web Push via NotifyEngine when ESP32 sensor values exceed thresholds
async function triggerSensorAlert(title, body, meta = {}) {
  try {
    const result = await notifyEngine.sendNotification({
      appId: 'my-webapp',
      appName: 'IoT WebApp',
      title,
      body,
      url: './index.html?tab=notif',
      priority: 'high',
      data: { ...meta, type: 'warning', source: 'sensor-alert' }
    });
    broadcastSSE('new_message', result.message);
  } catch (err) {
    console.error('[NotifyEngine] Sensor alert error:', err.message);
  }
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

  if (now - serverAlertCooldowns.temp > ALERT_COOLDOWN_MS) {
    if (t > activeTargets.tempMax) {
      serverAlertCooldowns.temp = now;
      triggerSensorAlert(
        '⚠️ อุณหภูมิสูงเกินกำหนด!',
        `อุณหภูมิปัจจุบัน ${t.toFixed(1)} °C สูงกว่าเกณฑ์ความปลอดภัย (${activeTargets.tempMin} - ${activeTargets.tempMax} °C)`,
        { metric: 'temp', val: t }
      );
    } else if (t < activeTargets.tempMin) {
      serverAlertCooldowns.temp = now;
      triggerSensorAlert(
        '❄️ อุณหภูมิต่ำกว่ากำหนด!',
        `อุณหภูมิปัจจุบัน ${t.toFixed(1)} °C ต่ำกว่าเกณฑ์ความปลอดภัย (${activeTargets.tempMin} - ${activeTargets.tempMax} °C)`,
        { metric: 'temp', val: t }
      );
    }
  }

  if (now - serverAlertCooldowns.humid > ALERT_COOLDOWN_MS) {
    if (h < activeTargets.humidMin) {
      serverAlertCooldowns.humid = now;
      triggerSensorAlert(
        '💧 ความชื้นในอากาศต่ำเกินไป!',
        `ความชื้นปัจจุบัน ${h.toFixed(1)} % ต่ำกว่าเกณฑ์ (${activeTargets.humidMin} - ${activeTargets.humidMax} %) แนะนำเปิดหัวพ่นหมอก`,
        { metric: 'humid', val: h }
      );
    } else if (h > activeTargets.humidMax) {
      serverAlertCooldowns.humid = now;
      triggerSensorAlert(
        '🌧️ ความชื้นในอากาศสูงเกินไป!',
        `ความชื้นปัจจุบัน ${h.toFixed(1)} % สูงกว่าเกณฑ์ (${activeTargets.humidMin} - ${activeTargets.humidMax} %) แนะนำเปิดพัดลมระบาย`,
        { metric: 'humid', val: h }
      );
    }
  }

  if (c && now - serverAlertCooldowns.co2 > ALERT_COOLDOWN_MS) {
    if (c > activeTargets.co2Max) {
      serverAlertCooldowns.co2 = now;
      triggerSensorAlert(
        '⚠️ ระดับ CO₂ สูงเกินเกณฑ์!',
        `ระดับก๊าซ CO₂ ${c} ppm สูงกว่าเกณฑ์ความปลอดภัย (< ${activeTargets.co2Max} ppm) ควรระบายอากาศ`,
        { metric: 'co2', val: c }
      );
    }
  }

  if (l !== null && l !== undefined && now - serverAlertCooldowns.lux > ALERT_COOLDOWN_MS) {
    if (l < activeTargets.luxMin) {
      serverAlertCooldowns.lux = now;
      triggerSensorAlert(
        '💡 แสงสว่างต่ำกว่าเกณฑ์!',
        `ความสว่างปัจจุบัน ${l} lux ต่ำกว่าเกณฑ์มาตรฐาน (${activeTargets.luxMin} - ${activeTargets.luxMax} lux)`,
        { metric: 'lux', val: l }
      );
    }
  }
}

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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

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

  // 1. Real-time SSE stream (/api/stream)
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

  // 2. Get VAPID Public Key (/api/vapid-public-key)
  if (req.method === 'GET' && pathname === '/api/vapid-public-key') {
    sendJson(res, 200, { publicKey: notifyEngine.getPublicKey() });
    return;
  }

  // 3. Get Overview Status (NotifyEngine + IoT Telemetry)
  if (req.method === 'GET' && pathname === '/api/status') {
    const db = readDb();
    const now = Date.now();
    const isOnline = Boolean(db.device && db.device.lastSeen && (now - db.device.lastSeen < 25000));
    const secondsAgo = db.device && db.device.lastSeen ? Math.round((now - db.device.lastSeen) / 1000) : null;

    const appId = url.searchParams.get('appId') || '*';
    const allSubscriptions = notifyEngine.getSubscriptions('*');

    sendJson(res, 200, {
      // IoT fields
      online: isOnline,
      lastSeen: db.device ? db.device.lastSeen : null,
      secondsAgo,
      device: db.device,
      telemetry: db.telemetry,
      relays: db.relays,
      targets: db.targets,
      history: db.history || [],
      // NotifyEngine fields
      publicKey: notifyEngine.getPublicKey(),
      apps: notifyEngine.getApps(),
      subscriptionsCount: allSubscriptions.length,
      devices: allSubscriptions.map((s) => ({
        id: s.id,
        appId: s.appId,
        userId: s.userId,
        deviceName: s.deviceName,
        enabled: s.enabled !== false,
        userAgent: s.userAgent || '',
        updatedAt: s.updatedAt,
        createdAt: s.createdAt
      })),
      messages: notifyEngine.getMessages({ appId, limit: 60 })
    });
    return;
  }

  // 4. Create Channel / Project (POST /api/apps)
  if (req.method === 'POST' && pathname === '/api/apps') {
    try {
      const { appId, name, icon, color, description } = await parseRequestBody(req);
      const created = notifyEngine.createApp({ appId, name, icon, color, description });
      broadcastSSE('apps_updated', notifyEngine.getApps());
      sendJson(res, 200, { success: true, app: created, apps: notifyEngine.getApps() });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 4.1 & 4.2 Update or Delete Channel (PATCH / DELETE /api/apps/:id)
  if (pathname.startsWith('/api/apps/') && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const id = decodeURIComponent(pathname.replace('/api/apps/', ''));
    try {
      if (req.method === 'PATCH') {
        const { name, icon, color, description } = await parseRequestBody(req);
        const updated = notifyEngine.updateApp(id, { name, icon, color, description });
        broadcastSSE('apps_updated', notifyEngine.getApps());
        sendJson(res, 200, { success: true, app: updated, apps: notifyEngine.getApps() });
      } else {
        const removed = notifyEngine.deleteApp(id);
        broadcastSSE('apps_updated', notifyEngine.getApps());
        sendJson(res, 200, { success: true, removed, apps: notifyEngine.getApps() });
      }
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 5. Subscribe a Device (POST /api/subscribe)
  if (req.method === 'POST' && pathname === '/api/subscribe') {
    try {
      const body = await parseRequestBody(req);
      const subscription = body.subscription || body;
      const appId = body.appId || '*';
      const userId = body.userId || 'all';
      const deviceName = body.deviceName || 'Mobile/Web Device';
      const record = notifyEngine.registerSubscription({
        subscription,
        appId,
        userId,
        deviceName,
        userAgent: req.headers['user-agent'] || ''
      });
      broadcastSSE('devices_updated', { count: notifyEngine.getSubscriptions('*').length });
      sendJson(res, 200, { success: true, device: record });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 6. Unsubscribe a Device (POST /api/unsubscribe)
  if (req.method === 'POST' && pathname === '/api/unsubscribe') {
    try {
      const { endpoint } = await parseRequestBody(req);
      const removed = notifyEngine.removeSubscription(endpoint);
      broadcastSSE('devices_updated', { count: notifyEngine.getSubscriptions('*').length });
      sendJson(res, 200, { success: true, removed });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 6.1 & 6.2 Update or Delete Device (PATCH / DELETE /api/devices/:id)
  if (pathname.startsWith('/api/devices/') && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const id = decodeURIComponent(pathname.replace('/api/devices/', ''));
    try {
      if (req.method === 'PATCH') {
        const { deviceName, appId, enabled, userId } = await parseRequestBody(req);
        const updated = notifyEngine.updateDevice(id, { deviceName, appId, enabled, userId });
        broadcastSSE('devices_updated', { count: notifyEngine.getSubscriptions('*').length });
        sendJson(res, 200, { success: true, device: updated });
      } else {
        const removed = notifyEngine.deleteDevice(id);
        broadcastSSE('devices_updated', { count: notifyEngine.getSubscriptions('*').length });
        sendJson(res, 200, { success: true, removed });
      }
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  // 7. Send Notification (POST /api/notify)
  if (req.method === 'POST' && pathname === '/api/notify') {
    try {
      const {
        appId = 'default',
        appName,
        title = 'แจ้งเตือนใหม่',
        body = '',
        url: targetUrl = './index.html?tab=notif',
        icon,
        userId = null,
        deviceId = null,
        targetDeviceId = null,
        priority = 'normal',
        delaySeconds = 0,
        data = {}
      } = await parseRequestBody(req);

      const specificDeviceId = targetDeviceId || deviceId || null;
      const delayMs = Math.max(0, Math.min(Number(delaySeconds) || 0, 60)) * 1000;

      if (delayMs > 0) {
        setTimeout(async () => {
          try {
            const result = await notifyEngine.sendNotification({
              appId,
              appName,
              title,
              body,
              url: targetUrl,
              icon,
              userId,
              targetDeviceId: specificDeviceId,
              priority,
              data
            });
            broadcastSSE('new_message', result.message);
          } catch (err) {
            console.error('Delayed push error:', err);
          }
        }, delayMs);

        sendJson(res, 200, {
          success: true,
          scheduled: true,
          delaySeconds: delayMs / 1000,
          message: `ตั้งเวลาส่งแจ้งเตือนในอีก ${delayMs / 1000} วินาที (ล็อกหน้าจอมือถือรอได้เลย!)`
        });
        return;
      }

      const result = await notifyEngine.sendNotification({
        appId,
        appName,
        title,
        body,
        url: targetUrl,
        icon,
        userId,
        targetDeviceId: specificDeviceId,
        priority,
        data
      });

      broadcastSSE('new_message', result.message);
      sendJson(res, 200, result);
    } catch (err) {
      console.error('Notify error:', err);
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // 8. Clear Chat History (DELETE /api/messages)
  if (req.method === 'DELETE' && pathname === '/api/messages') {
    const appId = url.searchParams.get('appId') || '*';
    notifyEngine.clearMessages(appId);
    broadcastSSE('messages_cleared', { appId });
    sendJson(res, 200, { success: true });
    return;
  }

  // 9. Health Check (GET /api/health)
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      status: 'alive',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
    return;
  }

  // -------------------------------------------------------------
  // IoT Endpoints: ESP32 Telemetry, Relay Control, Thresholds, Simulator
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
      evaluateServerAlerts(db.telemetry, db.targets);

      sendJson(res, 200, {
        success: true,
        connected: true,
        relays: db.relays
      });
    } catch (err) {
      sendJson(res, 400, { success: false, error: 'Invalid JSON payload' });
    }
    return;
  }

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
      sendJson(res, 200, { success: true, relays: db.relays });
    } catch (err) {
      sendJson(res, 400, { success: false, error: 'Invalid JSON' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/targets') {
    try {
      const payload = await parseRequestBody(req);
      const db = readDb();
      db.targets = {
        tempMin: payload.tempMin !== undefined ? Number(payload.tempMin) : (db.targets ? db.targets.tempMin : 24),
        tempMax: payload.tempMax !== undefined ? Number(payload.tempMax) : (db.targets ? db.targets.tempMax : 28),
        humidMin: payload.humidMin !== undefined ? Number(payload.humidMin) : (db.targets ? db.targets.humidMin : 80),
        humidMax: payload.humidMax !== undefined ? Number(payload.humidMax) : (db.targets ? db.targets.humidMax : 90),
        co2Max: payload.co2Max !== undefined ? Number(payload.co2Max) : (db.targets ? db.targets.co2Max : 1000),
        luxMin: payload.luxMin !== undefined ? Number(payload.luxMin) : (db.targets ? db.targets.luxMin : 200),
        luxMax: payload.luxMax !== undefined ? Number(payload.luxMax) : (db.targets ? db.targets.luxMax : 1000)
      };
      writeDb(db);
      sendJson(res, 200, { success: true, targets: db.targets });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/simulate') {
    try {
      const payload = await parseRequestBody(req);
      const db = readDb();
      const now = Date.now();
      db.telemetry = {
        temp: payload.temp !== undefined ? Number(payload.temp) : (db.telemetry ? db.telemetry.temp : 26.5),
        humid: payload.humid !== undefined ? Number(payload.humid) : (db.telemetry ? db.telemetry.humid : 82),
        co2: payload.co2 !== undefined ? Number(payload.co2) : (db.telemetry ? db.telemetry.co2 : 450),
        lux: payload.lux !== undefined ? Number(payload.lux) : (db.telemetry ? db.telemetry.lux : 500),
        timestamp: now
      };
      db.device = db.device || {};
      db.device.lastSeen = now;
      db.device.ip = '127.0.0.1 (Simulator)';
      if (!db.device.name) db.device.name = 'ตู้ควบคุมและเซนเซอร์ IoT (Simulated)';

      db.history = db.history || [];
      db.history.push({
        time: now,
        temp: db.telemetry.temp,
        humid: db.telemetry.humid,
        co2: db.telemetry.co2,
        lux: db.telemetry.lux
      });
      if (db.history.length > 1500) db.history.shift();

      writeDb(db);
      evaluateServerAlerts(db.telemetry, db.targets);

      sendJson(res, 200, { success: true, telemetry: db.telemetry, online: true });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
    }
    return;
  }

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
      sendJson(res, 200, { success: true, pointsCount: generated.length, history: generated });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/export/csv') {
    const db = readDb();
    const history = db.history || [];
    let csv = '\uFEFFTimestamp,Date,Time,Temperature(°C),Humidity(%),CO2(ppm),Light(lux)\n';
    history.forEach(h => {
      const d = new Date(h.time);
      const dateStr = d.toLocaleDateString('th-TH');
      const timeStr = d.toLocaleTimeString('th-TH');
      csv += `${h.time},"${dateStr}","${timeStr}",${h.temp !== undefined ? h.temp : ''},${h.humid !== undefined ? h.humid : ''},${h.co2 !== undefined ? h.co2 : ''},${h.lux !== undefined ? h.lux : ''}\n`;
    });

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=UTF-8',
      'Content-Disposition': `attachment; filename="iot-telemetry-export-${Date.now()}.csv"`
    });
    res.end(csv);
    return;
  }

  // Static File Serving
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  } else if (reqPath === '/admin' || reqPath === '/admin.html') {
    reqPath = '/admin.html';
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

// Keep-Alive Ping (every 5 minutes to prevent cloud sleep)
const KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000;
function startKeepAlive() {
  setInterval(async () => {
    const targetUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    try {
      await fetch(`${targetUrl.replace(/\/$/, '')}/api/health`);
    } catch (_) {}
  }, KEEP_ALIVE_INTERVAL_MS);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 IoT WebApp + NotifyEngine Server is running!`);
  console.log(`💻 Local URL:      http://localhost:${PORT}`);
  console.log(`🛠️ Admin Center:   http://localhost:${PORT}/admin.html`);
  console.log(`📥 ESP32 Endpoint: POST http://localhost:${PORT}/api/esp32/telemetry`);
  console.log(`📤 Notify API:     POST http://localhost:${PORT}/api/notify`);
  console.log(`=======================================================`);
  startKeepAlive();
});
