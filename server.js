const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

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
        history: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[DB] Read error:', e);
    return {
      device: { id: 'esp32-node-01', lastSeen: null },
      telemetry: { temp: null, humid: null, co2: null, lux: null, timestamp: null },
      relays: { fogger: false, fan: false, light: false, curtain: false },
      targets: { tempMin: 24, tempMax: 28, humidMin: 80, humidMax: 90, co2Max: 1000, luxMin: 200, luxMax: 1000 },
      history: []
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
      history: db.history ? db.history.slice(-20) : []
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
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 IoT WebApp Server is running at http://localhost:${PORT}`);
  console.log(`📡 ESP32 Telemetry Endpoint: POST http://localhost:${PORT}/api/esp32/telemetry`);
  console.log(`📊 Web Status Endpoint:    GET  http://localhost:${PORT}/api/status`);
  console.log(`💾 Database File:           ${DB_FILE}`);
  console.log(`=======================================================`);
});
