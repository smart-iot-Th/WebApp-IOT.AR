const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  device: {
    id: 'esp32-zone1',
    name: 'ตู้ควบคุมและเซนเซอร์ IoT',
    lastSeen: null,
    ip: null
  },
  telemetry: {
    temp: null,
    humid: null,
    co2: null,
    lux: null,
    timestamp: null
  },
  relays: {
    fogger: false,
    fan: false,
    light: false,
    curtain: false
  },
  targets: {
    tempMin: 24,
    tempMax: 28,
    humidMin: 80,
    humidMax: 90,
    co2Max: 1000,
    luxMin: 200,
    luxMax: 1000
  },
  history: [],
  vapidKeys: {
    publicKey: 'BCGnkh_R4WHFuT6J7UrfwJGCzZWHSRsaNO_1mpnTayUTyMVxiWeXxLaACGmePZTk6FqPlBfRU0wWaQZ_CYYhG54',
    privateKey: 'C7xEe7ESDYxicfZmoul_c-_u2JcV2gb-2jdbsSQu0BU'
  },
  apps: [
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
  ],
  subscriptions: [
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
  ],
  messages: []
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.vapidKeys || !parsed.vapidKeys.publicKey) {
      parsed.vapidKeys = { ...DEFAULT_DB.vapidKeys };
    }
    if (!Array.isArray(parsed.apps) || parsed.apps.length === 0) {
      parsed.apps = [...DEFAULT_DB.apps];
    }
    if (!Array.isArray(parsed.subscriptions)) {
      parsed.subscriptions = [...DEFAULT_DB.subscriptions];
    }
    if (!Array.isArray(parsed.messages)) {
      parsed.messages = [];
    }
    return parsed;
  } catch (err) {
    console.error('Error reading DB, resetting to default:', err);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  readDb,
  writeDb,
  DB_FILE
};

