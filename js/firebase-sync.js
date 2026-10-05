/**
 * ===================================================================
 * IoT Firebase Realtime Database Cloud Sync Module (js/firebase-sync.js)
 * สำหรับซิงค์ข้อมูลเซนเซอร์ ESP32 และสั่งงาน Relay ผ่านระบบคลาวด์
 * ใช้งานได้ทุกที่ทั่วโลกผ่าน GitHub Pages และอินเทอร์เน็ต 24 ชม.
 * ===================================================================
 */

(function (window) {
  'use strict';

  const STORAGE_KEY_FIREBASE_URL = 'iot_firebase_url';
  const STORAGE_KEY_MODE = 'iot_connection_mode'; // 'firebase' or 'local'
  
  let firebaseApp = null;
  let firebaseDb = null;
  let isConnected = false;
  let lastData = null;

  const IoTFirebase = {
    mode: localStorage.getItem(STORAGE_KEY_MODE) || 'local',
    
    getUrl() {
      return localStorage.getItem(STORAGE_KEY_FIREBASE_URL) || '';
    },

    saveUrl(url) {
      if (!url) {
        localStorage.removeItem(STORAGE_KEY_FIREBASE_URL);
        return;
      }
      let cleanUrl = url.trim();
      // Remove trailing slash
      cleanUrl = cleanUrl.replace(/\/+$/, '');
      localStorage.setItem(STORAGE_KEY_FIREBASE_URL, cleanUrl);
      this.mode = 'firebase';
      localStorage.setItem(STORAGE_KEY_MODE, 'firebase');
      this.connect();
    },

    setMode(mode) {
      this.mode = mode;
      localStorage.setItem(STORAGE_KEY_MODE, mode);
      if (mode === 'firebase') {
        this.connect();
      }
    },

    isConfigured() {
      const url = this.getUrl();
      return Boolean(url && url.startsWith('http'));
    },

    isConnected() {
      return isConnected;
    },

    init() {
      const url = this.getUrl();
      if (url && (this.mode === 'firebase' || window.location.hostname.includes('github.io'))) {
        this.connect();
      }
    },

    connect() {
      const dbUrl = this.getUrl();
      if (!dbUrl) {
        console.log('[Firebase] No Firebase Database URL configured.');
        return;
      }

      console.log('[Firebase] Connecting to Realtime Database:', dbUrl);

      // 1. Try Firebase Compat SDK if loaded
      if (window.firebase && window.firebase.initializeApp) {
        try {
          if (!firebaseApp) {
            firebaseApp = firebase.initializeApp({
              databaseURL: dbUrl
            }, 'iot-webapp-' + Date.now());
          }
          firebaseDb = firebase.database(firebaseApp);

          // Listen to connection state
          firebaseDb.ref('.info/connected').on('value', (snap) => {
            isConnected = Boolean(snap.val());
            console.log('[Firebase] Connection state:', isConnected ? 'CONNECTED' : 'DISCONNECTED');
            this.updateBadgeUI();
          });

          // Listen to Realtime Database at /iot_device
          firebaseDb.ref('iot_device').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val) {
              lastData = val;
              this.handleIncomingData(val);
            }
          }, (err) => {
            console.warn('[Firebase] SDK Listen error, falling back to REST stream:', err);
            this.startRestStream(dbUrl);
          });

          return;
        } catch (e) {
          console.warn('[Firebase] SDK init error, fallback to REST:', e);
        }
      }

      // 2. Pure REST Polling / Streaming fallback (Zero Dependencies)
      this.startRestStream(dbUrl);
    },

    startRestStream(dbUrl) {
      const endpoint = `${dbUrl}/iot_device.json`;
      const fetchOnce = async () => {
        try {
          const res = await fetch(endpoint, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            if (data) {
              isConnected = true;
              this.handleIncomingData(data);
              this.updateBadgeUI();
            }
          }
        } catch (e) {
          isConnected = false;
          this.updateBadgeUI();
        }
      };

      fetchOnce();
      if (!this._pollTimer) {
        this._pollTimer = setInterval(fetchOnce, 4000);
      }
    },

    handleIncomingData(data) {
      if (!data) return;

      const now = Date.now();
      const telemetry = data.telemetry || {};
      const lastSeen = telemetry.timestamp || (data.device ? data.device.lastSeen : null) || now;
      const secondsAgo = Math.max(0, Math.round((now - lastSeen) / 1000));
      // Considered online if updated within last 35 seconds
      const isOnline = Boolean(secondsAgo < 35 && telemetry.temp !== undefined);

      const formatted = {
        online: isOnline,
        secondsAgo: secondsAgo,
        device: data.device || { id: 'esp32-zone1', name: 'ESP32 IoT Cloud Node' },
        telemetry: {
          temp: telemetry.temp !== undefined ? Number(telemetry.temp) : null,
          humid: telemetry.humid !== undefined ? Number(telemetry.humid) : null,
          co2: telemetry.co2 !== undefined ? Number(telemetry.co2) : null,
          lux: telemetry.lux !== undefined ? Number(telemetry.lux) : null,
          timestamp: lastSeen
        },
        relays: data.relays || { fogger: false, fan: false, light: false, curtain: false },
        targets: data.targets || { tempMin: 24, tempMax: 28, humidMin: 80, humidMax: 90, co2Max: 1000, luxMin: 200, luxMax: 1000 },
        history: data.history ? (Array.isArray(data.history) ? data.history : Object.values(data.history)) : []
      };

      // Sync Relay state to local toggles
      if (formatted.relays && window.FarmStorage) {
        Object.entries(formatted.relays).forEach(([r, s]) => {
          FarmStorage.setDevice(r, Boolean(s));
          const el = document.getElementById(`toggle-${r}`);
          if (el) el.checked = Boolean(s);
          const badge = document.getElementById(`badge-${r}`);
          if (badge) {
            badge.textContent = s ? 'เปิด' : 'ปิด';
            badge.className = `toggle-badge ${s ? 'active' : ''}`;
          }
        });
      }

      // Update global UI in js/app.js
      if (window.updateEsp32UI) {
        window.updateEsp32UI(formatted);
      }
    },

    async setRelay(relayName, state) {
      const dbUrl = this.getUrl();
      if (!dbUrl) return false;

      // 1. Via Firebase SDK
      if (firebaseDb) {
        try {
          await firebaseDb.ref(`iot_device/relays/${relayName}`).set(Boolean(state));
          console.log(`[Firebase] Relay ${relayName} set to ${state}`);
          return true;
        } catch (e) {
          console.warn('[Firebase] SDK Set relay failed, trying REST:', e);
        }
      }

      // 2. Via REST PATCH
      try {
        const url = `${dbUrl}/iot_device/relays.json`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [relayName]: Boolean(state) })
        });
        return res.ok;
      } catch (err) {
        console.error('[Firebase] Set relay error:', err);
        return false;
      }
    },

    updateBadgeUI() {
      const badge = document.getElementById('firebaseConnStatus');
      if (!badge) return;
      if (isConnected) {
        badge.textContent = '🟢 เชื่อมต่อคลาวด์ Firebase แล้ว';
        badge.className = 'firebase-status-pill connected';
      } else if (this.isConfigured()) {
        badge.textContent = '🟡 กำลังเชื่อมต่อ Firebase...';
        badge.className = 'firebase-status-pill connecting';
      } else {
        badge.textContent = '⚪ ยังไม่ได้เชื่อมต่อ Firebase';
        badge.className = 'firebase-status-pill';
      }
    }
  };

  window.IoTFirebase = IoTFirebase;

  // Auto-init on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => IoTFirebase.init());
  } else {
    IoTFirebase.init();
  }

})(window);
