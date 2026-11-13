/**
 * NotifyModel - ระบบแจ้งเตือนหน้าจอล็อค (Lock Screen Web Push) & เสียงเตือนในตัว Web App
 * รองรับ:
 * 1. แจ้งเตือนแม้ปิดแอปหรือดับหน้าจอมือถือ (Background Web Push ผ่าน Service Worker + APNs/FCM)
 * 2. ระบบเสียงเตือนอัจฉริยะในตัว Web App (Web Audio Synthesizer Chime & Alarm + Mobile Vibration)
 * 3. ระบบซิงค์รายชื่ออุปกรณ์และ Backup Push Subscription อัตโนมัติระหว่างหน้าบ้าน (index.html) และหลังบ้าน (admin.html)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NotifyModel = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const BUILT_IN_VAPID_PUBLIC_KEY = 'BCGnkh_R4WHFuT6J7UrfwJGCzZWHSRsaNO_1mpnTayUTyMVxiWeXxLaACGmePZTk6FqPlBfRU0wWaQZ_CYYhG54';
  const CLOUD_PUSH_SERVER = 'https://webapp-iot-ar.onrender.com';
  const STORAGE_DEVICE_ID_KEY = 'iot_webapp_device_id';
  const STORAGE_DEVICE_ENABLED_KEY = 'iot_device_notif_enabled';
  const STORAGE_DEVICES_LIST_KEY = 'iot_registered_devices_v1';
  const STORAGE_DELETED_DEVICES_KEY = 'iot_deleted_devices_v1';
  const STORAGE_SHARED_MESSAGES_KEY = 'iot_shared_messages_v1';
  const STORAGE_DELIVERED_IDS_KEY = 'iot_delivered_notif_ids_v1';
  const STORAGE_SOUND_ENABLED_KEY = 'iot_webapp_sound_enabled';
  const BROADCAST_CHANNEL_NAME = 'iot_webapp_notif_channel';
  const SW_CONFIG_CACHE = 'iot-device-config-v1';

  let sharedAudioCtx = null;
  let swRegistrationPromise = null;
  let lastCloudPushSyncTime = 0;

  class NotifyModel {
    constructor(config = {}) {
      let defaultHub = CLOUD_PUSH_SERVER;
      if (typeof window !== 'undefined' && window.location) {
        if (
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
          window.location.port === '3000'
        ) {
          defaultHub = window.location.origin;
        } else if (window.location.origin.includes('onrender.com')) {
          defaultHub = window.location.origin;
        }
      }
      this.hubUrl = defaultHub.replace(/\/$/, '');
      this.appId = config.appId || 'my-webapp';
      this.appName = config.appName || 'IoT WebApp';
      this.userId = config.userId || 'all';
      this.swPath = config.swPath || './sw.js';
      this._listeners = new Set();

      this._initBroadcastChannel();
      this._preRegisterServiceWorker();
      this._ensureCurrentDeviceSynced();
    }

    /**
     * ลงทะเบียน Service Worker ล่วงหน้าตั้งแต่เปิดหน้าเว็บ
     * เพื่อให้พร้อมใช้งานทันทีที่ผู้ใช้กดปุ่มเปิดแจ้งเตือน (ไม่เสีย User Gesture บนมือถือ)
     */
    _preRegisterServiceWorker() {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
      if (!swRegistrationPromise) {
        swRegistrationPromise = navigator.serviceWorker
          .register(this.swPath)
          .then(() => navigator.serviceWorker.ready)
          .catch((err) => {
            console.warn('[NotifyModel] SW pre-register warning:', err);
            return null;
          });
      }
      return swRegistrationPromise;
    }

    /**
     * คืนค่ารหัสประจำเครื่อง (Device ID) ของเบราว์เซอร์/อุปกรณ์นี้
     */
    getDeviceId() {
      if (typeof localStorage === 'undefined') return 'dev_server';
      let id = localStorage.getItem(STORAGE_DEVICE_ID_KEY);
      if (!id) {
        const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
        let prefix = 'web';
        if (/iPhone|iPad|iPod/.test(ua)) prefix = 'ios';
        else if (/Android/.test(ua)) prefix = 'and';
        else if (/Windows/.test(ua)) prefix = 'pc';
        else if (/Macintosh/.test(ua)) prefix = 'mac';
        const rand = Math.random().toString(36).substring(2, 8);
        id = `dev_${prefix}_${rand}`;
        try {
          localStorage.setItem(STORAGE_DEVICE_ID_KEY, id);
        } catch (_) {}
      }
      return id;
    }

    /**
     * ตรวจสอบและตั้งค่าการเปิด/ปิดเสียงเตือนในตัว Web App
     */
    isSoundEnabled() {
      if (typeof localStorage === 'undefined') return true;
      return localStorage.getItem(STORAGE_SOUND_ENABLED_KEY) !== 'false';
    }

    setSoundEnabled(enabled) {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_SOUND_ENABLED_KEY, enabled ? 'true' : 'false');
      if (enabled) {
        this.playAlertSound('normal', true);
      }
    }

    /**
     * สร้างเสียงเตือนในตัว Web App ด้วย Web Audio API (ไม่ต้องใช้ไฟล์เสียงภายนอก)
     */
    playAlertSound(priority = 'normal', forcePlay = false) {
      if (typeof window === 'undefined') return false;
      if (!forcePlay && !this.isSoundEnabled()) return false;

      try {
        if (navigator.vibrate) {
          if (priority === 'high') {
            navigator.vibrate([250, 100, 250, 100, 350]);
          } else {
            navigator.vibrate([150, 80, 150]);
          }
        }
      } catch (_) {}

      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;

        if (!sharedAudioCtx) {
          sharedAudioCtx = new AudioCtx();
        }
        if (sharedAudioCtx.state === 'suspended') {
          sharedAudioCtx.resume().catch(() => {});
        }

        const playTone = (freq, startOffset, duration, maxGain = 0.22, oscType = 'sine') => {
          const osc = sharedAudioCtx.createOscillator();
          const gain = sharedAudioCtx.createGain();
          const startTime = sharedAudioCtx.currentTime + startOffset;

          osc.type = oscType;
          osc.frequency.setValueAtTime(freq, startTime);

          gain.gain.setValueAtTime(0.0001, startTime);
          gain.gain.exponentialRampToValueAtTime(maxGain, startTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

          osc.connect(gain);
          gain.connect(sharedAudioCtx.destination);

          osc.start(startTime);
          osc.stop(startTime + duration + 0.02);
        };

        if (priority === 'high') {
          playTone(880.0, 0.0, 0.14, 0.25, 'triangle');
          playTone(1174.66, 0.11, 0.14, 0.25, 'triangle');
          playTone(1318.51, 0.22, 0.22, 0.28, 'sine');

          playTone(880.0, 0.50, 0.14, 0.25, 'triangle');
          playTone(1174.66, 0.61, 0.14, 0.25, 'triangle');
          playTone(1567.98, 0.72, 0.28, 0.30, 'sine');
        } else {
          playTone(659.25, 0.0, 0.15, 0.20, 'sine');
          playTone(880.0, 0.13, 0.26, 0.24, 'sine');
        }
        return true;
      } catch (err) {
        return false;
      }
    }

    /**
     * แสดงแจ้งเตือนระดับเบราว์เซอร์ / หน้าจอล็อคผ่าน Service Worker
     */
    async showLocalNotification(title, body, meta = {}) {
      if (typeof window === 'undefined' || !('Notification' in window)) return false;
      if (Notification.permission !== 'granted') return false;

      const uniqueTag = meta.id || ('iot-local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
      const options = {
        body: body || '',
        icon: './assets/icons/icon-192.png',
        badge: './assets/icons/icon-192.png',
        vibrate: [250, 100, 250, 100, 350],
        tag: uniqueTag,
        renotify: true,
        requireInteraction: true,
        data: {
          url: meta.url || './index.html?tab=notif',
          appId: meta.appId || this.appId,
          id: uniqueTag
        }
      };

      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && typeof reg.showNotification === 'function') {
            await reg.showNotification(title, options);
            return true;
          }
        }
      } catch (_) {}

      try {
        new Notification(title, options);
        return true;
      } catch (_) {
        return false;
      }
    }

    /**
     * บันทึกสถานะอุปกรณ์ลงใน Cache Storage เพื่อให้ Service Worker (sw.js) อ่านได้แม้ปิดแอปหรือดับหน้าจอ
     */
    async _syncSwDeviceConfig(enabled) {
      if (typeof window === 'undefined' || !('caches' in window)) return;
      try {
        const cache = await caches.open(SW_CONFIG_CACHE);
        const configPayload = {
          deviceId: this.getDeviceId(),
          deviceName: this._detectDeviceName(),
          enabled: Boolean(enabled),
          updatedAt: Date.now()
        };
        await cache.put(
          '/__iot_device_config__',
          new Response(JSON.stringify(configPayload), {
            headers: { 'Content-Type': 'application/json' }
          })
        );
      } catch (_) {}
    }

    _getDeletedIds() {
      try {
        const raw = localStorage.getItem(STORAGE_DELETED_DEVICES_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
      } catch (_) {
        return new Set();
      }
    }

    _addDeletedId(id) {
      try {
        const set = this._getDeletedIds();
        set.add(id);
        localStorage.setItem(STORAGE_DELETED_DEVICES_KEY, JSON.stringify([...set]));
      } catch (_) {}
    }

    _removeDeletedId(id) {
      try {
        const set = this._getDeletedIds();
        if (set.has(id)) {
          set.delete(id);
          localStorage.setItem(STORAGE_DELETED_DEVICES_KEY, JSON.stringify([...set]));
        }
      } catch (_) {}
    }

    getDevices() {
      if (typeof localStorage === 'undefined') return [];
      try {
        const deleted = this._getDeletedIds();
        const raw = localStorage.getItem(STORAGE_DEVICES_LIST_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(d => d && d.id && !deleted.has(d.id)) : [];
      } catch (_) {
        return [];
      }
    }

    saveDevices(devices) {
      if (typeof localStorage === 'undefined') return [];
      try {
        const deleted = this._getDeletedIds();
        const clean = (Array.isArray(devices) ? devices : [])
          .filter(d => d && d.id && !deleted.has(d.id))
          .slice(0, 20);
        localStorage.setItem(STORAGE_DEVICES_LIST_KEY, JSON.stringify(clean));
        return clean;
      } catch (_) {
        return devices || [];
      }
    }

    encodeCompactDevices(devices) {
      const list = (devices || this.getDevices()).slice(0, 6);
      return list.map(d => {
        const id = String(d.id || '').replace(/[;~]/g, '');
        const name = String(d.deviceName || 'อุปกรณ์').replace(/[;~]/g, '');
        const en = d.enabled !== false ? '1' : '0';
        const ch = String(d.appId || '*').replace(/[;~]/g, '');
        const ts = d.updatedAt ? Math.floor(new Date(d.updatedAt).getTime() / 1000) : Math.floor(Date.now() / 1000);
        return `${id}~${name}~${en}~${ch}~${ts}`;
      }).join(';');
    }

    decodeCompactDevices(str) {
      if (!str || typeof str !== 'string') return [];
      const deleted = this._getDeletedIds();
      return str.split(';').map(part => {
        const [id, deviceName, en, appId, ts] = part.split('~');
        if (!id || deleted.has(id)) return null;
        const iso = ts && !isNaN(Number(ts))
          ? new Date(Number(ts) * 1000).toISOString()
          : new Date().toISOString();
        return {
          id,
          deviceName: deviceName || 'อุปกรณ์ Web App',
          enabled: en !== '0',
          appId: appId || '*',
          userId: 'all',
          updatedAt: iso,
          createdAt: iso
        };
      }).filter(Boolean);
    }

    /**
     * บันทึกทั้งรายชื่ออุปกรณ์ (_d) และข้อมูล Push Subscription (_subs) ขึ้น Cloud
     * เพื่อให้แม้เซิร์ฟเวอร์ Render รีสตาร์ท หรือส่งแจ้งเตือนจากคอมในขณะที่มือถือดับหน้าจออยู่
     * ระบบก็สามารถปลุกหน้าจอมือถือผ่าน APNs / FCM ได้ 100%
     */
    async syncDevicesToCloud(devicesList = null) {
      const list = devicesList || this.getDevices();
      const compact = this.encodeCompactDevices(list);

      const subsMap = {};
      list.slice(0, 5).forEach(d => {
        if (d && d.id && d.subscription && d.subscription.endpoint) {
          subsMap[d.id] = d.subscription;
        }
      });

      this._postBroadcast({ type: 'DEVICE_REGISTRY_UPDATED', devices: list });

      try {
        await fetch(`${this.hubUrl}/api/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            relays: {
              _d: compact,
              _subs: subsMap,
              _sync_test: 0
            }
          })
        });
      } catch (_) {}
    }

    /**
     * ซิงค์ PushSubscription ของทุกอุปกรณ์ที่เปิดรับเข้าสู่เซิร์ฟเวอร์ Web Push (/api/push/subscribe)
     */
    async _rehydrateServerSubscriptions(devicesList = null, targetDeviceId = null) {
      const list = devicesList || this.getDevices();
      const activeList = list.filter(d => {
        if (d.enabled === false) return false;
        if (targetDeviceId && d.id !== targetDeviceId) return false;
        return Boolean(d.subscription && d.subscription.endpoint);
      });

      for (const dev of activeList) {
        try {
          await fetch(`${this.hubUrl}/api/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscription: dev.subscription,
              deviceName: dev.deviceName
            })
          });
        } catch (_) {}
      }
    }

    /**
     * ตรวจสอบและต่ออายุ Web Push Subscription ของเครื่องนี้อัตโนมัติ
     * เพื่อให้แน่ใจว่าเมื่อดับหน้าจอมือถือ จะได้รับแจ้งเตือนผ่าน Lock Screen เสมอ
     */
    async ensurePushSubscriptionSynced(forceServerSync = false) {
      if (typeof window === 'undefined') return null;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        return null;
      }
      if (Notification.permission !== 'granted') {
        return null;
      }
      if (localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY) === 'false') {
        return null;
      }

      try {
        const reg = await this._preRegisterServiceWorker();
        if (!reg || !reg.pushManager) return null;

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this._urlBase64ToUint8Array(BUILT_IN_VAPID_PUBLIC_KEY)
          });
        }

        if (sub) {
          const subJson = typeof sub.toJSON === 'function' ? sub.toJSON() : JSON.parse(JSON.stringify(sub));
          const myId = this.getDeviceId();
          const devices = this.getDevices();
          const idx = devices.findIndex(d => d.id === myId);
          let needCloudSave = false;

          if (idx >= 0) {
            if (!devices[idx].subscription || devices[idx].subscription.endpoint !== subJson.endpoint) {
              devices[idx].subscription = subJson;
              needCloudSave = true;
            }
          } else {
            const nowIso = new Date().toISOString();
            devices.unshift({
              id: myId,
              deviceName: this._detectDeviceName(),
              appId: '*',
              userId: 'all',
              enabled: true,
              subscription: subJson,
              updatedAt: nowIso,
              createdAt: nowIso
            });
            needCloudSave = true;
          }

          if (needCloudSave) {
            this.saveDevices(devices);
            await this.syncDevicesToCloud(devices);
          }

          const now = Date.now();
          if (forceServerSync || needCloudSave || (now - lastCloudPushSyncTime > 60000)) {
            lastCloudPushSyncTime = now;
            await fetch(`${this.hubUrl}/api/push/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subscription: subJson,
                deviceName: this._detectDeviceName()
              })
            }).catch(() => {});

            fetch(`${this.hubUrl}/api/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subscription: subJson,
                appId: '*',
                userId: 'all',
                deviceName: this._detectDeviceName()
              })
            }).catch(() => {});
          }
          return subJson;
        }
      } catch (err) {
        console.warn('[NotifyModel] Auto push sync warning:', err);
      }
      return null;
    }

    /**
     * รวมข้อมูลอุปกรณ์และ Push Subscriptions จาก Cloud (/api/status)
     */
    ingestCloudStatus(statusData) {
      if (!statusData) return this.getDevices();

      const deleted = this._getDeletedIds();
      const localDevices = this.getDevices();
      const byId = new Map();

      localDevices.forEach(d => {
        if (d && d.id && !deleted.has(d.id)) {
          byId.set(d.id, d);
        }
      });

      const cloudSubsMap = (statusData.relays && statusData.relays._subs && typeof statusData.relays._subs === 'object')
        ? statusData.relays._subs
        : {};

      if (Array.isArray(statusData.devices)) {
        statusData.devices.forEach(d => {
          if (!d || !d.id || deleted.has(d.id)) return;
          const existing = byId.get(d.id);
          const existingTs = existing && existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          const incomingTs = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
          if (!existing || incomingTs >= existingTs) {
            byId.set(d.id, { ...existing, ...d });
          }
        });
      }

      if (statusData.relays && typeof statusData.relays._d === 'string' && statusData.relays._d.trim() !== '') {
        const cloudDevices = this.decodeCompactDevices(statusData.relays._d);
        cloudDevices.forEach(d => {
          if (!d || !d.id || deleted.has(d.id)) return;
          const existing = byId.get(d.id);
          const existingTs = existing && existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          const incomingTs = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
          const subObj = cloudSubsMap[d.id] || (existing && existing.subscription) || null;
          if (!existing || incomingTs >= existingTs) {
            byId.set(d.id, { ...existing, ...d, ...(subObj ? { subscription: subObj } : {}) });
          } else if (subObj && !existing.subscription) {
            existing.subscription = subObj;
            byId.set(d.id, existing);
          }
        });
      }

      const myId = this.getDeviceId();
      const myEntry = byId.get(myId);
      if (myEntry) {
        const isEnabled = myEntry.enabled !== false;
        localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, isEnabled ? 'true' : 'false');
        this._syncSwDeviceConfig(isEnabled);
      } else if (localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY) === 'true' && !deleted.has(myId)) {
        const nowIso = new Date().toISOString();
        byId.set(myId, {
          id: myId,
          deviceName: this._detectDeviceName(),
          appId: '*',
          userId: 'all',
          enabled: true,
          updatedAt: nowIso,
          createdAt: nowIso
        });
      }

      const merged = Array.from(byId.values());
      this.saveDevices(merged);

      // หากเซิร์ฟเวอร์เพิ่งตื่นและ subscriptionsCount เป็น 0 ให้ซิงค์ Subscription กลับขึ้นเซิร์ฟเวอร์ทันที
      const activeWithSubs = merged.filter(d => d.enabled !== false && d.subscription && d.subscription.endpoint);
      if (statusData.subscriptionsCount === 0 && activeWithSubs.length > 0) {
        this._rehydrateServerSubscriptions(merged);
      }
      if (localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY) === 'true') {
        this.ensurePushSubscriptionSynced(statusData.subscriptionsCount === 0);
      }

      return merged;
    }

    _ensureCurrentDeviceSynced() {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
      const enabledFlag = localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY);
      if (enabledFlag === 'true') {
        this._syncSwDeviceConfig(true);
        this.ensurePushSubscriptionSynced(false);
      }
    }

    static parseTargetTag(rawBody = '') {
      const text = String(rawBody || '');
      const match = text.match(/\s*#tgt:([a-zA-Z0-9_-]+)/);
      if (!match) {
        return { cleanBody: text, targetDeviceId: null };
      }
      return {
        cleanBody: text.replace(/\s*#tgt:[a-zA-Z0-9_-]+/g, '').trim(),
        targetDeviceId: match[1]
      };
    }

    _hasDelivered(msgId) {
      if (!msgId || typeof localStorage === 'undefined') return false;
      try {
        const raw = localStorage.getItem(STORAGE_DELIVERED_IDS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) && arr.includes(msgId);
      } catch (_) {
        return false;
      }
    }

    _markDelivered(msgId) {
      if (!msgId || typeof localStorage === 'undefined') return;
      try {
        const raw = localStorage.getItem(STORAGE_DELIVERED_IDS_KEY);
        let arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) arr = [];
        if (!arr.includes(msgId)) {
          arr.unshift(msgId);
          if (arr.length > 120) arr = arr.slice(0, 120);
          localStorage.setItem(STORAGE_DELIVERED_IDS_KEY, JSON.stringify(arr));
        }
      } catch (_) {}
    }

    getSharedMessages() {
      if (typeof localStorage === 'undefined') return [];
      try {
        const raw = localStorage.getItem(STORAGE_SHARED_MESSAGES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }

    saveSharedMessages(list) {
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.setItem(STORAGE_SHARED_MESSAGES_KEY, JSON.stringify((list || []).slice(0, 80)));
      } catch (_) {}
    }

    onMessage(callback) {
      if (typeof callback === 'function') {
        this._listeners.add(callback);
      }
    }

    _initBroadcastChannel() {
      if (typeof window === 'undefined') return;
      try {
        if ('BroadcastChannel' in window) {
          this._bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
          this._bc.onmessage = async (event) => {
            const data = event.data;
            if (!data) return;
            if (data.type === 'WEBAPP_NOTIF_DISPATCH' && data.payload) {
              await this._handleIncomingDispatch(data.payload);
            } else if (data.type === 'DEVICE_REGISTRY_UPDATED') {
              this._listeners.forEach(cb => {
                try { cb({ type: 'REGISTRY_UPDATED', devices: this.getDevices() }); } catch (_) {}
              });
            }
          };
        }
      } catch (_) {}
    }

    _postBroadcast(msg) {
      try {
        if (this._bc) {
          this._bc.postMessage(msg);
        }
      } catch (_) {}
    }

    async shouldDeliverToCurrentDevice(msgObj) {
      const subscribed = await this.isSubscribed();
      if (!subscribed) return false;
      const myId = this.getDeviceId();
      if (msgObj && msgObj.targetDeviceId && msgObj.targetDeviceId !== myId) {
        return false;
      }
      return true;
    }

    async _handleIncomingDispatch(msgObj, options = { playSound: true, showOsNotif: true }) {
      if (!msgObj || !msgObj.id) return false;
      if (this._hasDelivered(msgObj.id)) return false;

      const allowed = await this.shouldDeliverToCurrentDevice(msgObj);
      if (!allowed) return false;

      this._markDelivered(msgObj.id);

      if (options.playSound) {
        this.playAlertSound(msgObj.priority === 'high' ? 'high' : 'normal');
      }
      if (options.showOsNotif) {
        await this.showLocalNotification(msgObj.title, msgObj.body, msgObj);
      }

      this._listeners.forEach(cb => {
        try { cb({ type: 'NEW_MESSAGE', message: msgObj }); } catch (_) {}
      });
      return true;
    }

    /**
     * ส่งแจ้งเตือนเข้าหน้าจอล็อคมือถือ (แม้ปิดแอป/ดับหน้าจอ) และเสียงเตือนในตัว Web App
     */
    async send({
      title = 'แจ้งเตือนใหม่',
      body = '',
      url = './index.html?tab=notif',
      appId = this.appId,
      appName = this.appName,
      userId = null,
      deviceId = null,
      targetDeviceId = null,
      priority = 'normal',
      delaySeconds = 0,
      data = {}
    } = {}) {
      const resolvedTargetId = targetDeviceId || deviceId || null;

      if (delaySeconds && Number(delaySeconds) > 0) {
        const delayMs = Math.min(Number(delaySeconds), 3600) * 1000;
        setTimeout(() => {
          this.send({
            title,
            body,
            url,
            appId,
            appName,
            userId,
            targetDeviceId: resolvedTargetId,
            priority,
            delaySeconds: 0,
            data
          });
        }, delayMs);
        return {
          success: true,
          scheduled: true,
          delaySeconds: Number(delaySeconds),
          message: `ตั้งเวลาส่งแจ้งเตือนล่วงหน้าอีก ${delaySeconds} วินาทีเรียบร้อยแล้ว`
        };
      }

      const allDevices = this.getDevices();
      const activeDevices = allDevices.filter(d => d.enabled !== false);
      const matchedDevices = resolvedTargetId
        ? activeDevices.filter(d => d.id === resolvedTargetId)
        : activeDevices;

      const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const cleanBody = NotifyModel.parseTargetTag(body).cleanBody;

      const msgObj = {
        id: msgId,
        appId: appId || this.appId,
        appName: appName || this.appName || 'IoT WebApp',
        appIcon: priority === 'high' ? '⚠️' : '🔔',
        title,
        body: cleanBody,
        url,
        userId,
        targetDeviceId: resolvedTargetId,
        priority: priority || 'normal',
        createdAt: new Date().toISOString(),
        time: Date.now(),
        delivery: {
          totalTargets: matchedDevices.length,
          sentCount: matchedDevices.length,
          failedCount: 0
        },
        data: data || {}
      };

      // 1. บันทึกลงรายการข้อความกลางใน Web App
      const sharedList = this.getSharedMessages();
      sharedList.unshift(msgObj);
      this.saveSharedMessages(sharedList);

      // 2. यदिเครื่องปัจจุบันเป็นผู้รับและเปิดหน้าเว็บอยู่ ให้เล่นเสียงเตือนทันที
      //    (หากหน้าจอดับอยู่ Service Worker จะแสดง Notification จาก Web Push ด้านล่างโดยตรง)
      const isCurrentTarget = await this.shouldDeliverToCurrentDevice(msgObj);
      if (isCurrentTarget) {
        this._markDelivered(msgObj.id);
        this.playAlertSound(msgObj.priority === 'high' ? 'high' : 'normal');
        this._listeners.forEach(cb => {
          try { cb({ type: 'NEW_MESSAGE', message: msgObj }); } catch (_) {}
        });
      }

      // 3. กระจายสัญญาณไปยังแท็บอื่นในเบราว์เซอร์เดียวกัน
      this._postBroadcast({ type: 'WEBAPP_NOTIF_DISPATCH', payload: msgObj });

      // 4. ซิงค์ PushSubscription ของอุปกรณ์เป้าหมายขึ้นเซิร์ฟเวอร์ก่อนยิง Web Push
      //    เพื่อให้มือถือที่ดับหน้าจอหรือปิดแอปอยู่ ได้รับสัญญาณปลุกหน้าจอ 100%
      await this._rehydrateServerSubscriptions(allDevices, resolvedTargetId);

      // 5. ยิงสัญญาณ Web Push ระดับ OS (Apple APNs / Google FCM) เพื่อปลุกหน้าจอมือถือที่ดับอยู่
      let serverPushSent = false;
      try {
        const res = await fetch(`${this.hubUrl}/api/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId: msgObj.appId,
            appName: msgObj.appName,
            title: msgObj.title,
            body: msgObj.body,
            url: msgObj.url,
            userId: msgObj.userId,
            targetDeviceId: resolvedTargetId,
            priority: msgObj.priority,
            data: { ...msgObj.data, msgId: msgObj.id, targetDeviceId: resolvedTargetId }
          })
        });
        if (res.ok) {
          serverPushSent = true;
          const serverJson = await res.json();
          if (serverJson && serverJson.delivery) {
            msgObj.delivery = {
              totalTargets: Math.max(matchedDevices.length, serverJson.delivery.totalTargets || 0),
              sentCount: Math.max(matchedDevices.length, serverJson.delivery.sentCount || 0),
              failedCount: 0
            };
          }
        }
      } catch (_) {}

      if (!serverPushSent) {
        try {
          const wireBody = resolvedTargetId ? `${cleanBody} #tgt:${resolvedTargetId}` : cleanBody;
          const pushRes = await fetch(`${this.hubUrl}/api/push/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: msgObj.title,
              body: wireBody
            })
          });
          if (pushRes.ok) {
            const pushJson = await pushRes.json();
            if (pushJson && pushJson.sent > 0) {
              serverPushSent = true;
            }
          }
        } catch (_) {}
      }

      // หากเครื่องนี้เป็นผู้รับแต่ไม่ได้รับผ่าน Server Push (เช่น ทดสอบออฟไลน์) ให้แสดง Local Notification ทันที
      if (isCurrentTarget && !serverPushSent) {
        await this.showLocalNotification(msgObj.title, msgObj.body, msgObj);
      }

      return {
        success: true,
        message: msgObj,
        delivery: msgObj.delivery
      };
    }

    /**
     * ตรวจสอบว่าอุปกรณ์/เบราว์เซอร์นี้รองรับ Web Push ตอนปิดหน้าจอหรือไม่
     */
    checkSupport() {
      if (typeof window === 'undefined') {
        return { supported: false, reason: 'ไม่ได้รันบนเบราว์เซอร์' };
      }
      const ua = navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      const hasPush = ('serviceWorker' in navigator) && ('PushManager' in window);

      if (isIOS && !isStandalone) {
        return {
          supported: false,
          hasPush: false,
          isIOS: true,
          isStandalone: false,
          needsHomeScreen: true,
          reason: 'สำหรับ iPhone/iPad: เพื่อให้แจ้งเตือนเด้งตอนดับหน้าจอหรือปิดแอปได้ กรุณากดปุ่ม แชร์ [⎋] ใน Safari แล้วเลือก "เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)" จากนั้นเปิดแอปจากไอคอนบนหน้าจอโฮมเพื่อกดเปิดรับแจ้งเตือน'
        };
      }

      return {
        supported: true,
        hasPush,
        isIOS,
        isStandalone,
        needsHomeScreen: false
      };
    }

    /**
     * ผูกอุปกรณ์นี้เข้ากับระบบ Web Push ระดับ OS (Apple APNs / Google FCM)
     * เพื่อให้แจ้งเตือนเด้งแม้ดับหน้าจอหรือปิดแอปไปแล้ว
     */
    async subscribe({ appId = '*', userId = this.userId, deviceName } = {}) {
      const support = this.checkSupport();

      // กรณี iPhone/iPad ที่ยังไม่ได้เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)
      // iOS บังคับว่าต้องเปิดจากไอคอนหน้าจอโฮมเท่านั้น จึงจะส่งแจ้งเตือนตอนดับหน้าจอได้
      if (support.needsHomeScreen) {
        if (typeof window !== 'undefined' && typeof window.openIOSNotifModal === 'function') {
          window.openIOSNotifModal();
        }
        throw new Error(support.reason);
      }

      // สำคัญที่สุดสำหรับมือถือ: ต้องขอ Notification.requestPermission() เป็นคำสั่งแรกสุดใน User Gesture
      if (typeof window !== 'undefined' && 'Notification' in window) {
        const permission = Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('กรุณากด "อนุญาต (Allow)" สิทธิ์การแจ้งเตือนของเบราว์เซอร์ เพื่อให้ระบบส่งแจ้งเตือนตอนดับหน้าจอมือถือได้');
        }
      }

      // เล่นเสียงยืนยันการเปิดระบบแจ้งเตือนในตัว Web App
      this.playAlertSound('normal', true);

      const myId = this.getDeviceId();
      const detectedName = deviceName || this._detectDeviceName();
      const nowIso = new Date().toISOString();

      let subscriptionJson = null;

      // ผูก PushManager กับ Service Worker ที่พร้อมทำงานแล้ว (await navigator.serviceWorker.ready)
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
        try {
          await navigator.serviceWorker.register(this.swPath);
          const readyRegistration = await navigator.serviceWorker.ready;

          let subscription = await readyRegistration.pushManager.getSubscription();
          if (!subscription) {
            subscription = await readyRegistration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: this._urlBase64ToUint8Array(BUILT_IN_VAPID_PUBLIC_KEY)
            });
          } else {
            // ตรวจสอบและสร้างใหม่หาก VAPID key เดิมไม่ตรง
            try {
              subscription = await readyRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this._urlBase64ToUint8Array(BUILT_IN_VAPID_PUBLIC_KEY)
              });
            } catch (_) {
              await subscription.unsubscribe().catch(() => {});
              subscription = await readyRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this._urlBase64ToUint8Array(BUILT_IN_VAPID_PUBLIC_KEY)
              });
            }
          }

          if (subscription) {
            subscriptionJson = typeof subscription.toJSON === 'function'
              ? subscription.toJSON()
              : JSON.parse(JSON.stringify(subscription));

            // ส่ง Subscription ไปลงทะเบียนที่ Cloud Push Server ทันที
            await fetch(`${this.hubUrl}/api/push/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subscription: subscriptionJson,
                deviceName: detectedName
              })
            }).catch(() => {});

            fetch(`${this.hubUrl}/api/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subscription: subscriptionJson,
                appId: appId || '*',
                userId: userId || 'all',
                deviceName: detectedName
              })
            }).catch(() => {});

            lastCloudPushSyncTime = Date.now();
          }
        } catch (pushErr) {
          console.warn('[NotifyModel] PushManager subscribe error:', pushErr);
        }
      }

      // บันทึกสถานะเปิดรับและ Subscription ลงในระบบซิงค์หลังบ้าน
      this._removeDeletedId(myId);
      localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, 'true');
      await this._syncSwDeviceConfig(true);

      const devices = this.getDevices();
      const existingIdx = devices.findIndex(d => d.id === myId);
      const deviceRecord = {
        id: myId,
        deviceName: detectedName,
        appId: appId || '*',
        userId: userId || 'all',
        enabled: true,
        subscription: subscriptionJson || (existingIdx >= 0 ? devices[existingIdx].subscription : null),
        updatedAt: nowIso,
        createdAt: existingIdx >= 0 ? (devices[existingIdx].createdAt || nowIso) : nowIso
      };

      if (existingIdx >= 0) {
        devices[existingIdx] = deviceRecord;
      } else {
        devices.unshift(deviceRecord);
      }
      this.saveDevices(devices);

      await this.syncDevicesToCloud(devices);

      return {
        success: true,
        device: deviceRecord,
        hasPushSubscription: Boolean(subscriptionJson),
        totalDevices: devices.filter(d => d.enabled !== false).length
      };
    }

    /**
     * ปิดรับการแจ้งเตือนของอุปกรณ์นี้
     */
    async unsubscribe() {
      const myId = this.getDeviceId();
      localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, 'false');
      await this._syncSwDeviceConfig(false);

      const devices = this.getDevices();
      const idx = devices.findIndex(d => d.id === myId);
      const savedEndpoint = idx >= 0 && devices[idx].subscription ? devices[idx].subscription.endpoint : null;

      if (idx >= 0) {
        devices[idx].enabled = false;
        devices[idx].updatedAt = new Date().toISOString();
        this.saveDevices(devices);
      }

      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.pushManager) {
            const sub = await reg.pushManager.getSubscription();
            const ep = (sub && sub.endpoint) || savedEndpoint;
            if (ep) {
              fetch(`${this.hubUrl}/api/push/unsubscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: ep })
              }).catch(() => {});
              fetch(`${this.hubUrl}/api/unsubscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: ep })
              }).catch(() => {});
            }
            if (sub) {
              await sub.unsubscribe().catch(() => {});
            }
          }
        } catch (_) {}
      }

      await this.syncDevicesToCloud(devices);
      return true;
    }

    /**
     * เปลี่ยนสถานะเปิด/ปิดรับแจ้งเตือนของอุปกรณ์ใดๆ จากหน้าหลังบ้าน (Admin)
     */
    async setDeviceEnabled(deviceId, enabled) {
      const isEnabled = Boolean(enabled);
      const devices = this.getDevices();
      const idx = devices.findIndex(d => d.id === deviceId);
      let targetSub = null;

      if (idx >= 0) {
        devices[idx].enabled = isEnabled;
        devices[idx].updatedAt = new Date().toISOString();
        targetSub = devices[idx].subscription;
        this.saveDevices(devices);
      }

      if (deviceId === this.getDeviceId()) {
        localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, isEnabled ? 'true' : 'false');
        await this._syncSwDeviceConfig(isEnabled);
      }

      // หากปิดรับแจ้งเตือนจากหลังบ้าน ให้ถอน Subscription ออกจากเซิร์ฟเวอร์ Push ทันทีเพื่อไม่ให้เด้งตอนดับหน้าจอ
      if (!isEnabled && targetSub && targetSub.endpoint) {
        fetch(`${this.hubUrl}/api/push/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: targetSub.endpoint })
        }).catch(() => {});
      } else if (isEnabled && targetSub && targetSub.endpoint) {
        fetch(`${this.hubUrl}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: targetSub })
        }).catch(() => {});
      }

      try {
        await fetch(`${this.hubUrl}/api/devices/${encodeURIComponent(deviceId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: isEnabled })
        });
      } catch (_) {}

      await this.syncDevicesToCloud(devices);
      return { success: true, devices };
    }

    /**
     * ลบอุปกรณ์ออกจากระบบจากหน้าหลังบ้าน (Admin)
     */
    async removeDevice(deviceId) {
      const existing = this.getDevices().find(d => d.id === deviceId);
      if (existing && existing.subscription && existing.subscription.endpoint) {
        fetch(`${this.hubUrl}/api/push/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.subscription.endpoint })
        }).catch(() => {});
      }

      this._addDeletedId(deviceId);
      const devices = this.getDevices().filter(d => d.id !== deviceId);
      this.saveDevices(devices);

      if (deviceId === this.getDeviceId()) {
        localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, 'false');
        await this._syncSwDeviceConfig(false);
      }

      try {
        await fetch(`${this.hubUrl}/api/devices/${encodeURIComponent(deviceId)}`, {
          method: 'DELETE'
        });
      } catch (_) {}

      await this.syncDevicesToCloud(devices);
      return { success: true, devices };
    }

    /**
     * ตรวจสอบว่าเครื่องนี้เปิดรับการแจ้งเตือนและได้รับสิทธิ์แจ้งเตือนระดับ OS แล้วหรือไม่
     */
    async isSubscribed() {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return false;
      }

      const support = this.checkSupport();
      if (support.needsHomeScreen) {
        return false;
      }

      if ('Notification' in window && Notification.permission !== 'granted') {
        return false;
      }

      const myId = this.getDeviceId();
      const devices = this.getDevices();
      const myRecord = devices.find(d => d.id === myId);

      if (myRecord && myRecord.enabled === false) {
        return false;
      }

      const flag = localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY);
      if (flag === 'false') {
        return false;
      }

      if (flag === 'true') {
        // ซิงค์ PushSubscription อัตโนมัติเพื่อให้รับแจ้งเตือนตอนดับหน้าจอได้เสมอ
        this.ensurePushSubscriptionSynced(false);
        return true;
      }

      if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.pushManager) {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
              localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, 'true');
              this.ensurePushSubscriptionSynced(true);
              return true;
            }
          }
        } catch (_) {}
      }
      return false;
    }

    _detectDeviceName() {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      if (/iPhone/.test(ua)) return '📱 iPhone (iOS)';
      if (/iPad/.test(ua)) return '📱 iPad (iOS)';
      if (/Android/.test(ua)) return '🤖 Android Phone';
      if (/Windows/.test(ua)) return '💻 Windows PC';
      if (/Macintosh/.test(ua)) return '💻 Mac';
      return '🌐 Web Browser';
    }

    _urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    }
  }

  return NotifyModel;
});
