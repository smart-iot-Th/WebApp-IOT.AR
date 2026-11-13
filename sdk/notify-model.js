/**
 * NotifyModel - ระบบแจ้งเตือนและเสียงเตือนในตัว Web App (Self-Contained Web App Notification & Sound SDK)
 * รองรับทั้ง:
 * 1. ระบบเสียงเตือนอัจฉริยะในตัว Web App (Web Audio Synthesizer Chime & Alarm + Mobile Vibration)
 * 2. ระบบแจ้งเตือน Native / Lock Screen Web Push (Service Worker + PushManager)
 * 3. ระบบซิงค์รายชื่ออุปกรณ์ (Device Registry) และข้อความแจ้งเตือนระหว่างหน้าบ้าน (index.html) และหลังบ้าน (admin.html)
 *    ทำงานได้ 100% บน GitHub Pages โดยไม่ต้องพึ่งพาการตั้งค่าเซิร์ฟเวอร์ NotifyHub ภายนอก
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NotifyModel = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const BUILT_IN_VAPID_PUBLIC_KEY = 'BCGnkh_R4WHFuT6J7UrfwJGCzZWHSRsaNO_1mpnTayUTyMVxiWeXxLaACGmePZTk6FqPlBfRU0wWaQZ_CYYhG54';
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

  class NotifyModel {
    constructor(config = {}) {
      let defaultHub = 'https://webapp-iot-ar.onrender.com';
      if (typeof window !== 'undefined' && window.location) {
        if (
          window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1' ||
          window.location.origin.includes('onrender.com')
        ) {
          defaultHub = window.location.origin;
        }
      }
      this.hubUrl = (config.hubUrl || defaultHub).replace(/\/$/, '');
      this.appId = config.appId || 'my-webapp';
      this.appName = config.appName || 'IoT WebApp';
      this.userId = config.userId || 'all';
      this.swPath = config.swPath || './sw.js';
      this._listeners = new Set();

      this._initBroadcastChannel();
      this._ensureCurrentDeviceSynced();
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
     * @param {'normal'|'high'} priority
     * @param {boolean} forcePlay - เล่นเสียงแม้ปิดเสียงไว้ (เช่น กดปุ่มทดสอบเสียงโดยตรง)
     */
    playAlertSound(priority = 'normal', forcePlay = false) {
      if (typeof window === 'undefined') return false;
      if (!forcePlay && !this.isSoundEnabled()) return false;

      try {
        if (navigator.vibrate) {
          if (priority === 'high') {
            navigator.vibrate([200, 100, 200, 100, 300]);
          } else {
            navigator.vibrate([140, 80, 140]);
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
          // เสียงเตือนภัย/แจ้งเตือนสำคัญ (Double 3-Note Smart Chime)
          playTone(880.0, 0.0, 0.14, 0.25, 'triangle');
          playTone(1174.66, 0.11, 0.14, 0.25, 'triangle');
          playTone(1318.51, 0.22, 0.22, 0.28, 'sine');

          playTone(880.0, 0.50, 0.14, 0.25, 'triangle');
          playTone(1174.66, 0.61, 0.14, 0.25, 'triangle');
          playTone(1567.98, 0.72, 0.28, 0.30, 'sine');
        } else {
          // เสียงแจ้งเตือนมาตรฐาน / ยืนยันการเปิดระบบ (Pleasant 2-Note Chime)
          playTone(659.25, 0.0, 0.15, 0.20, 'sine');
          playTone(880.0, 0.13, 0.26, 0.24, 'sine');
        }
        return true;
      } catch (err) {
        return false;
      }
    }

    /**
     * แสดงแจ้งเตือนระดับเบราว์เซอร์ / หน้าจอล็อคผ่าน Service Worker หรือ Notification API
     */
    async showLocalNotification(title, body, meta = {}) {
      if (typeof window === 'undefined' || !('Notification' in window)) return false;
      if (Notification.permission !== 'granted') return false;

      const options = {
        body: body || '',
        icon: './assets/icons/icon-192.png',
        badge: './assets/icons/icon-192.png',
        vibrate: [200, 100, 200],
        tag: meta.id || ('webapp-notif-' + Date.now()),
        renotify: true,
        data: {
          url: meta.url || './index.html?tab=notif',
          appId: meta.appId || this.appId,
          id: meta.id
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
     * บันทึกสถานะอุปกรณ์ลงใน Cache Storage เพื่อให้ Service Worker (sw.js) อ่านได้แม้ปิดหน้าเว็บ
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

    /**
     * จัดการรายชื่ออุปกรณ์ที่ลงทะเบียนในระบบ (Shared Device Registry)
     */
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
        const list = Array.isArray(parsed) ? parsed.filter(d => d && d.id && !deleted.has(d.id)) : [];
        return list;
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

    /**
     * เข้ารหัสรายชื่ออุปกรณ์แบบย่อ (Compact String) สำหรับซิงค์ข้ามอุปกรณ์ผ่าน Cloud
     */
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

    async syncDevicesToCloud(devicesList = null) {
      const list = devicesList || this.getDevices();
      const compact = this.encodeCompactDevices(list);
      this._postBroadcast({ type: 'DEVICE_REGISTRY_UPDATED', devices: list });

      try {
        await fetch(`${this.hubUrl}/api/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            relays: {
              _d: compact,
              _sync_test: 0
            }
          })
        });
      } catch (_) {}
    }

    /**
     * รวมข้อมูลอุปกรณ์จาก Cloud (/api/status) เข้ากับรายการในเครื่องแบบอัตโนมัติ
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

      // 1. จากเซิร์ฟเวอร์ NotifyEngine (ถ้ามี data.devices)
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

      // 2. จาก Compact Cloud Registry (relays._d)
      if (statusData.relays && typeof statusData.relays._d === 'string' && statusData.relays._d.trim() !== '') {
        const cloudDevices = this.decodeCompactDevices(statusData.relays._d);
        cloudDevices.forEach(d => {
          if (!d || !d.id || deleted.has(d.id)) return;
          const existing = byId.get(d.id);
          const existingTs = existing && existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
          const incomingTs = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
          if (!existing || incomingTs >= existingTs) {
            byId.set(d.id, { ...existing, ...d });
          }
        });
      }

      // 3. ตรวจสอบสถานะของเครื่องปัจจุบัน
      const myId = this.getDeviceId();
      const myEntry = byId.get(myId);
      if (myEntry) {
        const isEnabled = myEntry.enabled !== false;
        localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, isEnabled ? 'true' : 'false');
        this._syncSwDeviceConfig(isEnabled);
      } else if (localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY) === 'true' && !deleted.has(myId)) {
        const nowIso = new Date().toISOString();
        const selfEntry = {
          id: myId,
          deviceName: this._detectDeviceName(),
          appId: '*',
          userId: 'all',
          enabled: true,
          updatedAt: nowIso,
          createdAt: nowIso
        };
        byId.set(myId, selfEntry);
      }

      const merged = Array.from(byId.values());
      this.saveDevices(merged);
      return merged;
    }

    _ensureCurrentDeviceSynced() {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
      const enabledFlag = localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY);
      if (enabledFlag === 'true') {
        const myId = this.getDeviceId();
        const list = this.getDevices();
        const idx = list.findIndex(d => d.id === myId);
        const nowIso = new Date().toISOString();
        if (idx === -1) {
          list.unshift({
            id: myId,
            deviceName: this._detectDeviceName(),
            appId: '*',
            userId: 'all',
            enabled: true,
            updatedAt: nowIso,
            createdAt: nowIso
          });
          this.saveDevices(list);
          this.syncDevicesToCloud(list);
        }
        this._syncSwDeviceConfig(true);
      }
    }

    /**
     * แยกแท็กเป้าหมาย #tgt:<deviceId> ออกจากข้อความแจ้งเตือน
     */
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
     * ส่งแจ้งเตือนและเสียงเตือนในตัว Web App (รองรับทั้งส่งทุกเครื่อง หรือระบุเฉพาะเครื่อง)
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

      // 2. ตรวจสอบว่าเครื่องปัจจุบันเป็นผู้รับหรือไม่ ถ้าใช่ให้เล่นเสียงเตือน + เด้งแจ้งเตือนทันที
      await this._handleIncomingDispatch(msgObj, { playSound: true, showOsNotif: true });

      // 3. กระจายสัญญาณไปยังแท็บอื่นในเบราว์เซอร์เดียวกันทันที
      this._postBroadcast({ type: 'WEBAPP_NOTIF_DISPATCH', payload: msgObj });

      // 4. ซิงค์ไปยังเซิร์ฟเวอร์ / Cloud เพื่อให้เครื่องอื่น (เช่น มือถือ / คอมอีกเครื่อง) ได้รับแจ้งเตือนด้วย
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
          const serverJson = await res.json();
          if (serverJson && serverJson.delivery) {
            msgObj.delivery = {
              totalTargets: Math.max(matchedDevices.length, serverJson.delivery.totalTargets || 0),
              sentCount: Math.max(matchedDevices.length, serverJson.delivery.sentCount || 0),
              failedCount: 0
            };
          }
          return { success: true, message: msgObj, delivery: msgObj.delivery };
        }
      } catch (_) {}

      // Fallback สำหรับ Cloud Render (/api/push/test) พร้อมแนบแท็กเป้าหมาย #tgt:<id>
      try {
        const wireBody = resolvedTargetId ? `${cleanBody} #tgt:${resolvedTargetId}` : cleanBody;
        await fetch(`${this.hubUrl}/api/push/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: msgObj.title,
            body: wireBody
          })
        });
      } catch (_) {}

      return {
        success: true,
        message: msgObj,
        delivery: msgObj.delivery
      };
    }

    /**
     * ตรวจสอบว่าอุปกรณ์/เบราว์เซอร์นี้รองรับการแจ้งเตือนหรือไม่
     */
    checkSupport() {
      if (typeof window === 'undefined') {
        return { supported: false, reason: 'ไม่ได้รันบนเบราว์เซอร์' };
      }
      const ua = navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      const hasPush = ('serviceWorker' in navigator) && ('PushManager' in window);

      return {
        supported: true,
        hasPush,
        isIOS,
        isStandalone,
        needsHomeScreen: Boolean(isIOS && !isStandalone)
      };
    }

    /**
     * เปิดรับการแจ้งเตือนและเสียงเตือนบนเครื่องนี้ พร้อมลงทะเบียนเข้ากับระบบหลังบ้านทันที
     */
    async subscribe({ appId = '*', userId = this.userId, deviceName } = {}) {
      // 1. เล่นเสียงยืนยันการเปิดระบบแจ้งเตือนในตัว Web App ทันที (ปลดล็อค AudioContext บนมือถือ/คอม)
      this.playAlertSound('normal', true);

      const myId = this.getDeviceId();
      const detectedName = deviceName || this._detectDeviceName();
      const nowIso = new Date().toISOString();

      // 2. บันทึกสถานะเปิดรับลงในเครื่องและลงทะเบียนอุปกรณ์เข้าตารางหลังบ้านทันที
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
        updatedAt: nowIso,
        createdAt: existingIdx >= 0 ? (devices[existingIdx].createdAt || nowIso) : nowIso
      };

      if (existingIdx >= 0) {
        devices[existingIdx] = deviceRecord;
      } else {
        devices.unshift(deviceRecord);
      }
      this.saveDevices(devices);

      // 3. ขออนุญาตสิทธิ์แจ้งเตือนของเบราว์เซอร์และผูก Web Push (ถ้าเบราว์เซอร์รองรับ)
      if (typeof window !== 'undefined' && 'Notification' in window) {
        try {
          if (Notification.permission === 'default') {
            await Notification.requestPermission();
          }
        } catch (_) {}
      }

      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const regPromise = navigator.serviceWorker.register(this.swPath);
          const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 3500));
          const registration = await Promise.race([regPromise, timeoutPromise]);

          if (registration && 'PushManager' in window && Notification.permission === 'granted') {
            let publicKey = BUILT_IN_VAPID_PUBLIC_KEY;
            try {
              const keyRes = await fetch(`${this.hubUrl}/api/vapid-public-key`);
              if (keyRes.ok) {
                const keyData = await keyRes.json();
                if (keyData && keyData.publicKey) publicKey = keyData.publicKey;
              } else {
                const fallbackRes = await fetch(`${this.hubUrl}/api/push/vapid-public-key`);
                if (fallbackRes.ok) {
                  const fallbackData = await fallbackRes.json();
                  if (fallbackData && fallbackData.publicKey) publicKey = fallbackData.publicKey;
                }
              }
            } catch (_) {}

            let subscription = null;
            try {
              subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this._urlBase64ToUint8Array(publicKey)
              });
            } catch (_) {
              try {
                const oldSub = await registration.pushManager.getSubscription();
                if (oldSub) await oldSub.unsubscribe();
                subscription = await registration.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: this._urlBase64ToUint8Array(publicKey)
                });
              } catch (_e2) {}
            }

            if (subscription) {
              fetch(`${this.hubUrl}/api/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subscription,
                  appId: appId || '*',
                  userId: userId || 'all',
                  deviceName: detectedName
                })
              }).catch(() => {});

              fetch(`${this.hubUrl}/api/push/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subscription,
                  deviceName: detectedName
                })
              }).catch(() => {});
            }
          }
        } catch (_) {}
      }

      // 4. ซิงค์ข้อมูลอุปกรณ์ขึ้น Cloud เพื่อให้หน้าหลังบ้าน (admin.html) เห็นอุปกรณ์ทันที
      await this.syncDevicesToCloud(devices);

      return {
        success: true,
        device: deviceRecord,
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
            if (sub) {
              fetch(`${this.hubUrl}/api/unsubscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: sub.endpoint })
              }).catch(() => {});
              fetch(`${this.hubUrl}/api/push/unsubscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: sub.endpoint })
              }).catch(() => {});
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
      if (idx >= 0) {
        devices[idx].enabled = isEnabled;
        devices[idx].updatedAt = new Date().toISOString();
        this.saveDevices(devices);
      }

      if (deviceId === this.getDeviceId()) {
        localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, isEnabled ? 'true' : 'false');
        await this._syncSwDeviceConfig(isEnabled);
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
     * ตรวจสอบว่าเครื่องนี้เปิดรับการแจ้งเตือนอยู่หรือไม่
     */
    async isSubscribed() {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return false;
      }
      const myId = this.getDeviceId();
      const devices = this.getDevices();
      const myRecord = devices.find(d => d.id === myId);

      // หากถูกปิดจากหน้า Admin ให้ยึดตามสถานะที่ซิงค์มา
      if (myRecord && myRecord.enabled === false) {
        return false;
      }

      const flag = localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY);
      if (flag === 'true') {
        return true;
      }
      if (flag === 'false') {
        return false;
      }

      // กรณีเข้าใช้งานครั้งแรกแต่เคยผูก PushManager ไว้แล้ว
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
              localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, 'true');
              this._ensureCurrentDeviceSynced();
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
