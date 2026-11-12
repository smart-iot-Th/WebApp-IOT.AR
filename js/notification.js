/**
 * ===================================================================
 * IoT Notification System Module + NotifyHub SDK Integration (js/notification.js)
 * บริหารจัดการประวัติการแจ้งเตือน กฎตรวจจับค่าเซนเซอร์อัตโนมัติ
 * เชื่อมต่ออัตโนมัติแบบ Multi-Hub Failover (Cloud Render 24/7 + Cloudflare Tunnel + Localhost)
 * รองรับทั้งการส่งแจ้งเตือน (POST /api/notify) และการรับแจ้งเตือน (NotifyModel SDK)
 * พร้อมเสียงเตือน Chime (Web Audio API) และ Floating Banner Toast
 * ===================================================================
 */

(function (window) {
  'use strict';

  const STORAGE_KEY = 'smartfarm_notifs';
  const STORAGE_HUB_URL_KEY = 'iot_notifyhub_url_v3';
  const STORAGE_APP_ID_KEY = 'iot_notifyhub_appid';
  const STORAGE_TARGET_DEV_KEY = 'iot_notifyhub_target_device';
  const STORAGE_DEVICE_ENABLED_KEY = 'iot_device_notif_enabled';
  const STORAGE_VAPID_KEY_USED = 'iot_push_vapid_key';
  const STORAGE_CLIENT_ID_KEY = 'iot_client_device_id';

  // เซิร์ฟเวอร์หลัก 24/7 บน Cloud Render (ใช้ซิงค์ระหว่างทุกเครื่องทั้งในแอปและ Web Push)
  const CLOUD_RENDER_HUB = 'https://webapp-iot-ar.onrender.com';
  const CLOUD_VAPID_PUBLIC_KEY = 'BCGnkh_R4WHFuT6J7UrfwJGCzZWHSRsaNO_1mpnTayUTyMVxiWeXxLaACGmePZTk6FqPlBfRU0wWaQZ_CYYhG54';
  const DEFAULT_APP_ID = 'my-webapp';
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 นาที ป้องกันการแจ้งเตือนซ้ำรัว

  // ข้อมูลอุปกรณ์เริ่มต้นที่ลงทะเบียนไว้ในระบบ
  const DEFAULT_KNOWN_DEVICES = [
    {
      id: '99fbb8b3-ed1f-4e79-ab05-9074626165a6',
      appId: '*',
      userId: 'all',
      deviceName: '📱 iPhone (iOS) I13',
      enabled: true
    }
  ];

  // ล้างค่า URL Tunnel เก่าที่หมดอายุแล้วออกจาก localStorage รุ่นก่อนหน้า
  try {
    ['iot_notifyhub_url', 'iot_notifyhub_url_v2'].forEach(k => {
      const oldVal = localStorage.getItem(k);
      if (oldVal && oldVal.includes('trycloudflare.com')) {
        localStorage.removeItem(k);
      }
    });
  } catch (_) {}

  let activeHubUrl = CLOUD_RENDER_HUB;
  let notifyHubSSE = null;
  let notifyHubDevices = [...DEFAULT_KNOWN_DEVICES];
  let notifyHubApps = [
    { appId: 'default', name: 'แจ้งเตือนทั่วไป (Default)', icon: '🔔' },
    { appId: 'my-webapp', name: 'Web App ของฉัน', icon: '🚀' },
    { appId: 'tas01-01', name: 'Tas01', icon: '⚡' }
  ];
  let notifyHubConnected = true;
  let serverSubscribersCount = 1;

  // ตัวแปรสำหรับติดตามและซิงค์แจ้งเตือนแบบ Real-Time ระหว่างหลายเครื่องตอนใช้งานแอป
  const sessionStartTime = Date.now();
  let initialServerSyncDone = false;
  const seenServerNotifIds = new Set();
  const recentAlertSignatures = new Map(); // key: "title|desc" -> timestamp

  function getClientDeviceId() {
    let cid = localStorage.getItem(STORAGE_CLIENT_ID_KEY);
    if (!cid) {
      cid = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
      localStorage.setItem(STORAGE_CLIENT_ID_KEY, cid);
    }
    return cid;
  }

  function detectCurrentDeviceName() {
    const ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return '📱 iPhone (iOS)';
    if (/iPad/.test(ua)) return '📱 iPad (iOS)';
    if (/Android/.test(ua)) return '🤖 Android Phone';
    if (/Windows/.test(ua)) return '💻 Windows PC';
    if (/Macintosh/.test(ua)) return '💻 Mac';
    return '🌐 Web Browser';
  }

  /**
   * ตรวจสอบว่าเครื่องปัจจุบันเปิดรับการแจ้งเตือนไว้หรือไม่ (ตามที่ผู้ใช้กดเปิดรับบนเครื่องนั้นๆ)
   */
  function isDeviceReceivingEnabled() {
    const explicit = localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY);
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;
    // หากยังไม่เคยตั้งค่าใน key ใหม่ แต่เคยอนุญาต Notification Permission ไว้แล้ว ให้ถือว่าเปิดรับ
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, 'true');
      return true;
    }
    return false;
  }

  function setDeviceReceivingEnabled(enabled) {
    localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, enabled ? 'true' : 'false');
  }

  function makeAlertSignature(title, desc) {
    return `${String(title || '').trim()}|${String(desc || '').trim()}`;
  }

  function wasRecentlyAlerted(title, desc, windowMs = 9000) {
    const sig = makeAlertSignature(title, desc);
    const prev = recentAlertSignatures.get(sig);
    if (prev && (Date.now() - prev < windowMs)) {
      return true;
    }
    return false;
  }

  function markRecentlyAlerted(title, desc) {
    const sig = makeAlertSignature(title, desc);
    recentAlertSignatures.set(sig, Date.now());
    // ล้างค่าเก่าเกิน 30 วินาที
    const now = Date.now();
    recentAlertSignatures.forEach((ts, k) => {
      if (now - ts > 30000) recentAlertSignatures.delete(k);
    });
  }

  // ===================================================================
  // Helpers สำหรับดึง/ค้นหาการตั้งค่า NotifyHub อัตโนมัติ
  // ===================================================================
  function getCandidateHubUrls() {
    const candidates = [CLOUD_RENDER_HUB];
    if (window.location.origin.includes('onrender.com')) {
      candidates.unshift(window.location.origin);
    }
    const saved = localStorage.getItem(STORAGE_HUB_URL_KEY);
    if (saved && saved.startsWith('http') && !saved.includes('abroad-fleece-prototype-induction')) {
      candidates.push(saved.replace(/\/+$/, ''));
    }
    if (
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
      (window.location.port === '3000' || window.location.port === '3200')
    ) {
      candidates.push(window.location.origin);
    }
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      candidates.push('http://localhost:3000');
      candidates.push('http://localhost:3200');
    }
    return [...new Set(candidates.filter(Boolean))];
  }

  function getHubUrl() {
    const saved = localStorage.getItem(STORAGE_HUB_URL_KEY);
    if (saved && saved.startsWith('http') && !saved.includes('abroad-fleece-prototype-induction')) {
      return saved.replace(/\/+$/, '');
    }
    if (window.location.origin.includes('onrender.com')) return window.location.origin;
    return CLOUD_RENDER_HUB;
  }

  function getAppId() {
    return localStorage.getItem(STORAGE_APP_ID_KEY) || DEFAULT_APP_ID;
  }

  function getTargetDeviceId() {
    return localStorage.getItem(STORAGE_TARGET_DEV_KEY) || '';
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // ===================================================================
  // 0. NotifyModel SDK Fallback & Instance
  // ===================================================================
  if (typeof window.NotifyModel === 'undefined') {
    window.NotifyModel = class NotifyModel {
      constructor(config = {}) {
        this.hubUrl = (config.hubUrl || getHubUrl()).replace(/\/$/, '');
        this.appId = config.appId || DEFAULT_APP_ID;
        this.appName = config.appName || this.appId;
        this.userId = config.userId || 'all';
        this.swPath = config.swPath || './sw.js';
      }

      async send(opts = {}) {
        return await dispatchNotifyHubApi(opts);
      }

      checkSupport() {
        if (typeof window === 'undefined') {
          return { supported: false, reason: 'ไม่ได้รันบนเบราว์เซอร์' };
        }
        const ua = navigator.userAgent || '';
        const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

        if (!window.isSecureContext) {
          return {
            supported: false,
            isIOS,
            isStandalone,
            reason: 'ต้องเปิดผ่าน HTTPS หรือ localhost เท่านั้น ระบบมือถือจึงจะอนุญาตให้เด้งแจ้งเตือน'
          };
        }

        if (isIOS && !isStandalone) {
          return {
            supported: false,
            isIOS: true,
            isStandalone: false,
            needsHomeScreen: true,
            reason: 'สำหรับ iPhone/iPad (iOS) กรุณากดปุ่ม Share (แชร์) แล้วเลือก "Add to Home Screen (เพิ่มไปยังหน้าจอโฮม)" ก่อนเปิดใช้งานแจ้งเตือน'
          };
        }

        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          return {
            supported: false,
            isIOS,
            isStandalone,
            reason: 'เบราว์เซอร์นี้ไม่รองรับ Web Push API'
          };
        }

        return { supported: true, isIOS, isStandalone };
      }

      async subscribe() {
        return await IoTNotification.subscribePush();
      }

      async unsubscribe() {
        return await IoTNotification.unsubscribePush();
      }

      async isSubscribed() {
        return isDeviceReceivingEnabled();
      }

      async mountBellWidget({ position = 'bottom-right', label = 'รับการแจ้งเตือน' } = {}) {
        if (typeof document === 'undefined') return null;
        let btn = document.getElementById('notifyHubBellWidgetBtn');
        if (btn) return btn;

        btn = document.createElement('button');
        btn.id = 'notifyHubBellWidgetBtn';
        btn.className = 'notify-hub-bell-widget';
        const posStyle = position === 'bottom-left' ? 'left: 16px;' : 'right: 16px;';
        btn.style.cssText = `
          position: fixed; bottom: 88px; ${posStyle} z-index: 990;
          display: flex; align-items: center; gap: 6px;
          background: linear-gradient(135deg, #4f46e5, #7c3aed);
          color: #fff; border: none; border-radius: 999px;
          padding: 9px 15px; font-family: inherit; font-size: 12.5px;
          font-weight: 600; cursor: pointer;
          box-shadow: 0 8px 20px rgba(79, 70, 229, 0.35);
          transition: all 0.2s ease;
        `;

        const updateState = async () => {
          const active = await this.isSubscribed();
          btn.innerHTML = active ? '🔔 เปิดแจ้งเตือนแล้ว' : `🔕 ${label}`;
          btn.style.background = active
            ? 'linear-gradient(135deg, #059669, #10b981)'
            : 'linear-gradient(135deg, #4f46e5, #7c3aed)';
        };

        btn._updateState = updateState;
        updateState();

        btn.onclick = async () => {
          try {
            btn.disabled = true;
            btn.innerHTML = '⏳ กำลังตั้งค่า...';
            await IoTNotification.togglePush();
            await updateState();
          } catch (err) {
            alert('⚠️ ' + err.message);
            await updateState();
          } finally {
            btn.disabled = false;
          }
        };

        document.body.appendChild(btn);
        return btn;
      }
    };
  }

  function getNotifyInstance() {
    const hubUrl = getHubUrl();
    const appId = getAppId();
    if (!window.notify) {
      window.notify = new window.NotifyModel({
        hubUrl: hubUrl,
        appId: appId,
        swPath: './sw.js'
      });
    } else {
      window.notify.hubUrl = hubUrl;
      window.notify.appId = appId;
      window.notify.swPath = './sw.js';
    }
    return window.notify;
  }

  // ค่ามาตรฐานเริ่มต้นเมื่อเปิดใช้งานครั้งแรก
  const INITIAL_SEED_NOTIFS = [
    {
      id: 'seed_init_1',
      title: 'เชื่อมต่อระบบ NotifyHub พร้อมใช้งาน',
      desc: 'ระบบเฝ้าระวังสภาพแวดล้อมเชื่อมต่อกับ NotifyHub (my-webapp) พร้อมส่งแจ้งเตือนเข้ามือถือทันที',
      type: 'system',
      time: Date.now() - 120000,
      read: true,
      meta: { source: 'notifyhub' }
    }
  ];

  const lastAlertTimes = {
    temp: 0,
    humid: 0,
    co2: 0,
    lux: 0
  };

  let lastOnlineState = null;
  let lastRelayStates = {
    fogger: null,
    fan: null,
    light: null,
    curtain: null
  };

  let currentFilter = 'all';

  // ===================================================================
  // 1. Web Audio API Chime Synthesizer
  // ===================================================================
  let audioCtx = null;

  function playAlertChime() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtx) {
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const now = audioCtx.currentTime;

      const playTone = (freq, start, duration, gainLevel) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(gainLevel, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(start);
        osc.stop(start + duration);
      };

      playTone(659.25, now, 0.32, 0.25);        // E5 (659Hz)
      playTone(880.00, now + 0.12, 0.45, 0.30); // A5 (880Hz)
    } catch (e) {
      console.warn('[Audio] Chime playback not supported or user has not interacted yet:', e);
    }
  }

  // ===================================================================
  // 2. Floating In-App Banner Toast (Completely disabled as requested)
  // ===================================================================
  function showInAppToast(title, desc, type = 'warning') {
    // Disabled: User removed top in-app floating banner toasts
    const container = document.getElementById('inAppToastContainer');
    if (container) {
      try { container.remove(); } catch (_) {}
    }
  }

  // ===================================================================
  // 3. Web Push Utilities & Multi-Hub Failover Dispatcher
  // ===================================================================
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  /**
   * ส่งแจ้งเตือนแบบกระจายไปยังทุกเซิร์ฟเวอร์ที่ออนไลน์ (Parallel Broadcast: Cloud Render 24/7 + NotifyHub)
   * เพื่อให้มั่นใจว่าเมื่อกดส่งจากคอม โทรศัพท์และทุกเครื่องที่เปิดรับจะได้รับทั้งตอนใช้งานแอปและตอนล็อคหน้าจอ
   */
  async function dispatchNotifyHubApi({
    title,
    body,
    url,
    appId,
    targetDeviceId,
    priority = 'high',
    data = {}
  }) {
    const targetAppId = appId || getAppId() || DEFAULT_APP_ID;
    const targetDev = targetDeviceId !== undefined ? targetDeviceId : (getTargetDeviceId() || null);
    const targetUrl = url || window.location.href;
    const candidates = getCandidateHubUrls();

    const payloadStr = JSON.stringify({
      appId: targetAppId,
      title: title,
      body: body,
      url: targetUrl,
      targetDeviceId: targetDev || undefined,
      priority: priority,
      senderClientId: getClientDeviceId(),
      data: {
        ...data,
        senderClientId: getClientDeviceId(),
        targetDeviceId: targetDev || null
      }
    });

    // บันทึกว่าหน้าต่างนี้เพิ่งเป็นคนสั่งส่งข้อความนี้ เพื่อไม่ให้เด้งซ้ำซ้อนจากรอบ Polling ถัดไป
    markRecentlyAlerted(title, body);

    let primaryResult = null;
    let lastError = null;

    await Promise.all(
      candidates.map(async (baseUrl) => {
        try {
          // รองรับทั้ง /api/push/test (Cloud Render) และ /api/notify (NotifyHub)
          let res = await fetchWithTimeout(`${baseUrl}/api/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payloadStr
          }, 4500);

          if (res.status === 404) {
            res = await fetchWithTimeout(`${baseUrl}/api/push/test`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payloadStr
            }, 4500);
          }

          if (res.ok) {
            notifyHubConnected = true;
            const json = await res.json();
            if (!primaryResult || baseUrl === CLOUD_RENDER_HUB) {
              primaryResult = json;
            }
          }
        } catch (err) {
          lastError = err;
        }
      })
    );

    if (primaryResult) {
      return primaryResult;
    }
    throw lastError || new Error('ไม่สามารถติดต่อเซิร์ฟเวอร์แจ้งเตือนได้');
  }

  function loadNotifs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        saveNotifs(INITIAL_SEED_NOTIFS);
        return [...INITIAL_SEED_NOTIFS];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveNotifs(list) {
    try {
      const trimmed = list.slice(0, 100);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch (e) {
      return list;
    }
  }

  function formatRelativeTime(ts) {
    if (!ts) return 'เมื่อสักครู่';
    const now = Date.now();
    const diffSec = Math.floor((now - ts) / 1000);

    if (diffSec < 45) return 'เมื่อสักครู่';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} นาทีที่แล้ว`;

    const d = new Date(ts);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    const isToday = d.toDateString() === new Date().toDateString();
    if (isToday) return `วันนี้ ${timeStr}`;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `เมื่อวาน ${timeStr}`;

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month} ${timeStr}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dispatchDevicePush(title, body, options = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (reg && reg.showNotification) {
            reg.showNotification(title, {
              body: body,
              icon: options.icon || './assets/icons/icon-192.png',
              badge: './assets/icons/icon-192.png',
              vibrate: [250, 100, 250, 100, 250],
              tag: options.tag || ('iot-alert-' + Date.now()),
              renotify: true,
              data: { url: './index.html?tab=notif' }
            });
          }
        }).catch(() => {});
      }
    } catch (_) {}
  }

  function getCategoryIcon(type, title = '') {
    if (type === 'warning') {
      if (title.includes('อุณหภูมิ') || title.includes('ความร้อน')) {
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>`;
      }
      if (title.includes('ความชื้น') || title.includes('น้ำ')) {
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`;
      }
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    }

    if (type === 'system') {
      if (title.includes('เชื่อมต่อ') || title.includes('ESP32')) {
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`;
      }
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
    }

    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  }

  // ===================================================================
  // โมดูลหลัก IoTNotification
  // ===================================================================
  const IoTNotification = {
    getHubUrl,
    getAppId,
    getTargetDeviceId,
    isDeviceReceivingEnabled,
    setDeviceReceivingEnabled,
    dispatchBroadcast: dispatchNotifyHubApi,

    saveNotifyHubConfig({ hubUrl, appId, targetDeviceId } = {}) {
      if (hubUrl !== undefined) {
        const cleanUrl = hubUrl.trim().replace(/\/+$/, '');
        if (cleanUrl) {
          localStorage.setItem(STORAGE_HUB_URL_KEY, cleanUrl);
          activeHubUrl = cleanUrl;
        } else {
          localStorage.removeItem(STORAGE_HUB_URL_KEY);
          activeHubUrl = null;
        }
      }
      if (appId !== undefined) {
        const cleanApp = appId.trim() || DEFAULT_APP_ID;
        localStorage.setItem(STORAGE_APP_ID_KEY, cleanApp);
      }
      if (targetDeviceId !== undefined) {
        localStorage.setItem(STORAGE_TARGET_DEV_KEY, targetDeviceId.trim());
      }

      getNotifyInstance();
      this.syncServerNotifications();
      this.connectNotifyHubStream();
      this.updatePushCardUI();
    },

    getAll() {
      return loadNotifs();
    },

    getUnreadCount() {
      const list = loadNotifs();
      return list.filter(item => !item.read).length;
    },

    addNotif({
      id = null,
      title,
      desc,
      type = 'warning',
      time = null,
      meta = {},
      playSound = true,
      showToast = false,
      sendToHub = true
    }) {
      if (!title) return null;

      const list = loadNotifs();
      const itemId = id || ('notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));

      if (id && list.some(item => item.id === id)) {
        return null;
      }

      const newItem = {
        id: itemId,
        title: title,
        desc: desc || '',
        type: type,
        time: time || Date.now(),
        read: false,
        meta: meta
      };

      list.unshift(newItem);
      saveNotifs(list);

      if (isDeviceReceivingEnabled()) {
        if (playSound) {
          playAlertChime();
        }

        if (showToast) {
          showInAppToast(title, desc, type);
        }

        dispatchDevicePush(title, desc);
      }

      if (sendToHub) {
        dispatchNotifyHubApi({
          title: title,
          body: desc || 'คลิกเพื่อดูรายละเอียดได้เลย',
          priority: type === 'warning' ? 'high' : 'normal',
          data: meta
        }).catch(err => {
          console.warn('[NotifyHub] Auto-push warning:', err.message);
        });
      }

      this.render();
      this.updateBadges();

      return newItem;
    },

    recordConfigChange(label, oldVal, newVal) {
      if (oldVal === newVal) return;
      this.addNotif({
        title: `⚙️ อัปเดตการตั้งค่า${label}`,
        desc: `เปลี่ยนค่าเกณฑ์มาตรฐานจาก "${oldVal}" เป็น "${newVal}" เรียบร้อยแล้ว`,
        type: 'system',
        meta: { config: label, oldVal, newVal },
        sendToHub: true
      });
    },

    markAsRead(id) {
      const list = loadNotifs();
      const updated = list.map(item => item.id === id ? { ...item, read: true } : item);
      saveNotifs(updated);
      this.render();
      this.updateBadges();
    },

    markAllAsRead() {
      const list = loadNotifs();
      const updated = list.map(item => ({ ...item, read: true }));
      saveNotifs(updated);
      this.render();
      this.updateBadges();
    },

    deleteItem(id) {
      const list = loadNotifs();
      const updated = list.filter(item => item.id !== id);
      saveNotifs(updated);
      this.render();
      this.updateBadges();
    },

    clearAll() {
      if (!confirm('คุณต้องการล้างประวัติการแจ้งเตือนทั้งหมดใช่หรือไม่?')) return;
      saveNotifs([]);
      this.render();
      this.updateBadges();
    },

    setFilter(cat) {
      currentFilter = cat || 'all';

      const pills = document.querySelectorAll('.filter-pill');
      pills.forEach(pill => {
        const id = pill.id;
        const isActive =
          (currentFilter === 'all' && id === 'btnFilterAll') ||
          (currentFilter === 'warning' && id === 'btnFilterWarn') ||
          (currentFilter === 'system' && id === 'btnFilterSys') ||
          (currentFilter === 'message' && id === 'btnFilterMsg');
        pill.classList.toggle('active', isActive);
      });

      this.render();
    },

    updateBadges() {
      const unreadCount = this.getUnreadCount();

      const navBadge = document.getElementById('navNotifBadge');
      if (navBadge) {
        if (unreadCount > 0) {
          navBadge.style.display = 'flex';
          navBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
          navBadge.style.display = 'none';
        }
      }

      const unreadTextEl = document.getElementById('notifUnreadBadgeText');
      if (unreadTextEl) {
        if (unreadCount > 0) {
          unreadTextEl.textContent = `ยังไม่อ่าน ${unreadCount} รายการ`;
          unreadTextEl.style.background = 'rgba(239, 68, 68, 0.12)';
          unreadTextEl.style.color = '#ef4444';
          unreadTextEl.style.borderColor = 'rgba(239, 68, 68, 0.25)';
        } else {
          unreadTextEl.textContent = 'อ่านครบทั้งหมดแล้ว';
          unreadTextEl.style.background = 'rgba(16, 185, 129, 0.12)';
          unreadTextEl.style.color = '#059669';
          unreadTextEl.style.borderColor = 'rgba(16, 185, 129, 0.25)';
        }
      }
    },

    render(containerId = 'notifListContainer') {
      const container = document.getElementById(containerId);
      if (!container) return;

      const list = loadNotifs();
      const filtered = currentFilter === 'all'
        ? list
        : list.filter(item => item.type === currentFilter);

      if (filtered.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 48px 16px; color: var(--text-muted);">
            <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--border-card); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; color: var(--text-muted); opacity: 0.7;">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
            </div>
            <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-title); margin-bottom: 4px;">ไม่มีประวัติการแจ้งเตือน</div>
            <div style="font-size: 0.8rem;">ระบบจะบันทึกประวัติอัตโนมัติเมื่อเกิดเหตุการณ์หรือรับข้อความจาก NotifyHub</div>
          </div>
        `;
        return;
      }

      let html = '';
      filtered.forEach(item => {
        const isUnread = !item.read;
        const iconHtml = getCategoryIcon(item.type, item.title);
        const timeFormatted = formatRelativeTime(item.time);

        let typeBadgeClass = 'warning';
        let typeBadgeLabel = 'คำเตือน';
        if (item.type === 'system') {
          typeBadgeClass = 'system';
          typeBadgeLabel = 'ระบบ';
        } else if (item.type === 'message') {
          typeBadgeClass = 'message';
          typeBadgeLabel = item.meta && item.meta.appName ? item.meta.appName : 'NotifyHub';
        }

        html += `
          <div class="notif-card ${isUnread ? 'unread' : ''}" onclick="IoTNotification.markAsRead('${item.id}')">
            <div class="notif-card-header">
              <div class="notif-header-left">
                <div class="notif-icon-circle ${typeBadgeClass}">
                  ${iconHtml}
                </div>
                <div class="notif-meta">
                  <span class="notif-type-tag ${typeBadgeClass}">${escapeHtml(typeBadgeLabel)}</span>
                  <span class="notif-time">${timeFormatted}</span>
                </div>
              </div>
              <button class="notif-delete-btn" type="button" onclick="event.stopPropagation(); IoTNotification.deleteItem('${item.id}')" title="ลบรายการนี้">
                ✕
              </button>
            </div>

            <div class="notif-title-row">
              <h3 class="notif-title">${escapeHtml(item.title)}</h3>
              ${isUnread ? '<span class="notif-unread-dot" title="ยังไม่ได้อ่าน"></span>' : ''}
            </div>

            <p class="notif-desc">${escapeHtml(item.desc)}</p>
          </div>
        `;
      });

      container.innerHTML = html;
    },

    evaluateTelemetry(data) {
      if (!data) return;

      const now = Date.now();
      const isOnline = Boolean(data.online);
      const telemetry = data.telemetry || {};
      const relays = data.relays || {};
      const targets = data.targets || {
        tempMin: 24, tempMax: 28,
        humidMin: 80, humidMax: 90,
        co2Max: 1000,
        luxMin: 200, luxMax: 1000
      };

      if (lastOnlineState !== null && lastOnlineState !== isOnline) {
        if (isOnline) {
          this.addNotif({
            title: 'ESP32 เชื่อมต่อสำเร็จ (ออนไลน์)',
            desc: `บอร์ด ${data.device?.name || 'ESP32'} เริ่มต้นส่งข้อมูลเซนเซอร์เข้าสู่ระบบเรียบร้อยแล้ว`,
            type: 'system',
            meta: { event: 'online', deviceId: data.device?.id }
          });
        } else {
          this.addNotif({
            title: 'ESP32 ขาดการเชื่อมต่อ (ออฟไลน์)',
            desc: 'ไม่ได้รับสัญญาณจากบอร์ดเกิน 25 วินาที ระบบเปลี่ยนเป็นสถานะออฟไลน์',
            type: 'warning',
            meta: { event: 'offline' }
          });
        }
      }
      lastOnlineState = isOnline;

      if (relays) {
        const relayLabels = {
          fogger: 'ระบบพ่นหมอก',
          fan: 'พัดลมระบายอากาศ',
          light: 'ระบบไฟส่องสว่าง LED',
          curtain: 'ม่านพรางแสง'
        };

        ['fogger', 'fan', 'light', 'curtain'].forEach(k => {
          if (relays[k] !== undefined && lastRelayStates[k] !== null && lastRelayStates[k] !== relays[k]) {
            const stateStr = relays[k] ? 'เปิดทำงาน ✅' : 'ปิดทำงาน ⏹️';
            this.addNotif({
              title: `${relayLabels[k]}: ${stateStr}`,
              desc: `คำสั่งสวิตช์ควบคุม ${relayLabels[k]} เปลี่ยนเป็นสถานะ ${relays[k] ? 'เปิด' : 'ปิด'}`,
              type: 'system',
              meta: { relay: k, state: relays[k] }
            });
          }
          if (relays[k] !== undefined) {
            lastRelayStates[k] = relays[k];
          }
        });
      }

      if (!isOnline || telemetry.temp === null || telemetry.temp === undefined) {
        return;
      }

      const t = Number(telemetry.temp);
      const h = Number(telemetry.humid);
      const c = Number(telemetry.co2);
      const l = Number(telemetry.lux);

      if (now - lastAlertTimes.temp > COOLDOWN_MS) {
        if (t > targets.tempMax) {
          this.addNotif({
            title: '⚠️ อุณหภูมิสูงเกินกำหนด!',
            desc: `อุณหภูมิปัจจุบัน ${t.toFixed(1)} °C สูงกว่าเกณฑ์ความปลอดภัย (${targets.tempMin} - ${targets.tempMax} °C)`,
            type: 'warning',
            meta: { metric: 'temp', val: t }
          });
          lastAlertTimes.temp = now;
        } else if (t < targets.tempMin) {
          this.addNotif({
            title: '❄️ อุณหภูมิต่ำกว่ากำหนด!',
            desc: `อุณหภูมิปัจจุบัน ${t.toFixed(1)} °C ต่ำกว่าเกณฑ์ความปลอดภัย (${targets.tempMin} - ${targets.tempMax} °C)`,
            type: 'warning',
            meta: { metric: 'temp', val: t }
          });
          lastAlertTimes.temp = now;
        }
      }

      if (now - lastAlertTimes.humid > COOLDOWN_MS) {
        if (h < targets.humidMin) {
          this.addNotif({
            title: '💧 ความชื้นในอากาศต่ำเกินไป!',
            desc: `ความชื้นปัจจุบัน ${h.toFixed(1)} % ต่ำกว่าเกณฑ์ที่กำหนด (${targets.humidMin} - ${targets.humidMax} %) แนะนำเปิดหัวพ่นหมอก`,
            type: 'warning',
            meta: { metric: 'humid', val: h }
          });
          lastAlertTimes.humid = now;
        } else if (h > targets.humidMax) {
          this.addNotif({
            title: '🌧️ ความชื้นในอากาศสูงเกินไป!',
            desc: `ความชื้นปัจจุบัน ${h.toFixed(1)} % สูงกว่าเกณฑ์ที่กำหนด (${targets.humidMin} - ${targets.humidMax} %) แนะนำเปิดพัดลมระบายอากาศ`,
            type: 'warning',
            meta: { metric: 'humid', val: h }
          });
          lastAlertTimes.humid = now;
        }
      }

      if (c && now - lastAlertTimes.co2 > COOLDOWN_MS) {
        if (c > targets.co2Max) {
          this.addNotif({
            title: '⚠️ ปริมาณก๊าซ CO₂ สูงเกินเกณฑ์!',
            desc: `ระดับคาร์บอนไดออกไซด์ ${c} ppm สูงกว่าเกณฑ์ความปลอดภัย (< ${targets.co2Max} ppm) ควรระบายอากาศ`,
            type: 'warning',
            meta: { metric: 'co2', val: c }
          });
          lastAlertTimes.co2 = now;
        }
      }

      if (l !== null && l !== undefined && now - lastAlertTimes.lux > COOLDOWN_MS) {
        if (l < targets.luxMin) {
          this.addNotif({
            title: '💡 ระดับแสงสว่างต่ำกว่าเกณฑ์!',
            desc: `ความสว่างปัจจุบัน ${l} lux ต่ำกว่าเกณฑ์มาตรฐาน (${targets.luxMin} - ${targets.luxMax} lux)`,
            type: 'warning',
            meta: { metric: 'lux', val: l }
          });
          lastAlertTimes.lux = now;
        }
      }
    },

    isPushSupported() {
      return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
    },

    /**
     * ดึง Push Subscription ปัจจุบันโดยไม่ค้าง (Non-blocking with timeout สำหรับ iOS/Safari)
     */
    async getPushSubscription() {
      if (!this.isPushSupported()) return null;
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.getRegistration(),
          new Promise(resolve => setTimeout(() => resolve(null), 1200))
        ]);
        if (!reg || !reg.pushManager) return null;
        return await Promise.race([
          reg.pushManager.getSubscription(),
          new Promise(resolve => setTimeout(() => resolve(null), 1200))
        ]);
      } catch (e) {
        return null;
      }
    },

    /**
     * ตรวจสอบและซ่อมแซมการผูก Web Push ของเครื่องที่เปิดรับแจ้งเตือนให้ตรงกับ VAPID Key ของ Cloud เสมอ
     */
    async ensureCloudPushSubscription() {
      if (!isDeviceReceivingEnabled()) return;
      if (!this.isPushSupported()) return;
      if (Notification.permission !== 'granted') return;

      try {
        let publicKey = CLOUD_VAPID_PUBLIC_KEY;
        try {
          let keyRes = await fetchWithTimeout(`${CLOUD_RENDER_HUB}/api/push/vapid-public-key`, {}, 3500);
          if (keyRes.status === 404) {
            keyRes = await fetchWithTimeout(`${CLOUD_RENDER_HUB}/api/vapid-public-key`, {}, 3500);
          }
          if (keyRes.ok) {
            const keyData = await keyRes.json();
            if (keyData && keyData.publicKey) {
              publicKey = keyData.publicKey;
            }
          }
        } catch (_) {}

        const reg = await navigator.serviceWorker.register('./sw.js');
        await navigator.serviceWorker.ready;

        let sub = await reg.pushManager.getSubscription();
        const savedKey = localStorage.getItem(STORAGE_VAPID_KEY_USED);

        // หากเคยผูกด้วยกุญแจคนละชุด (เช่น จาก Tunnel เก่า) หรือยังไม่มี Subscription ให้สร้างใหม่ให้ตรงกับ Cloud ทันที
        if (!sub || (savedKey && savedKey !== publicKey)) {
          if (sub) {
            try { await sub.unsubscribe(); } catch (_) {}
          }
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          });
        }

        localStorage.setItem(STORAGE_VAPID_KEY_USED, publicKey);

        const detectedName = detectCurrentDeviceName();
        const appId = getAppId();
        const subPayload = JSON.stringify({
          subscription: sub,
          appId: appId,
          userId: 'all',
          deviceName: detectedName,
          clientDeviceId: getClientDeviceId()
        });

        await Promise.all(
          getCandidateHubUrls().map(async (candidate) => {
            try {
              let postRes = await fetchWithTimeout(`${candidate}/api/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: subPayload
              }, 3000);
              if (postRes.status === 404) {
                await fetchWithTimeout(`${candidate}/api/push/subscribe`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: subPayload
                }, 3000);
              }
            } catch (_) {}
          })
        );
      } catch (e) {
        console.warn('[Notification] Auto-sync subscription check:', e.message || e);
      }
    },

    /**
     * สมัครเปิดรับการแจ้งเตือนบนเครื่องนี้ (ทั้งการแจ้งเตือนตอนใช้งานแอป + Web Push หน้าจอล็อค)
     */
    async subscribePush() {
      const detectedName = detectCurrentDeviceName();
      const appId = getAppId();

      // ปลดล็อกเสียงเตือน Web Audio บนมือถือทันทีที่ผู้ใช้กดปุ่ม
      playAlertChime();

      // 1. เปิดสถานะรับแจ้งเตือนขณะใช้งานแอป (In-App Real-Time Alert) บนเครื่องนี้ทันที
      setDeviceReceivingEnabled(true);

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.navigator.standalone === true ||
                           window.matchMedia('(display-mode: standalone)').matches;

      // กรณีเปิดผ่าน Safari ปกติบน iPhone (ยังไม่ได้เพิ่มลงหน้าจอโฮม) -> เปิดรับแจ้งเตือนตอนใช้งานแอปให้ทันที!
      if (isIOS && !isStandalone) {
        showInAppToast(
          '🔔 เปิดรับการแจ้งเตือนบนเครื่องนี้แล้ว!',
          `เครื่อง "${detectedName}" จะแสดงป้ายแจ้งเตือนและเสียงเตือนทันทีเมื่อมีข้อความส่งเข้ามาขณะใช้งานแอป`,
          'system'
        );
        await this.updatePushCardUI();
        await this.syncServerNotifications();
        return true;
      }

      if (!this.isPushSupported()) {
        showInAppToast(
          '🔔 เปิดรับการแจ้งเตือนในแอปแล้ว!',
          `เครื่อง "${detectedName}" พร้อมรับการแจ้งเตือนแบบเรียลไทม์ขณะเปิดใช้งานแอป`,
          'system'
        );
        await this.updatePushCardUI();
        return true;
      }

      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          showInAppToast(
            '🔔 เปิดรับแจ้งเตือนเฉพาะตอนใช้งานแอป',
            'เบราว์เซอร์ปิดสิทธิ์หน้าจอล็อค แต่ระบบจะยังเด้งเตือนในหน้าแอปตามปกติ',
            'warning'
          );
          await this.updatePushCardUI();
          return true;
        }

        // ดึง VAPID Public Key จากเซิร์ฟเวอร์ Cloud Render หลักเป็นอันดับแรกเพื่อให้ทุกเครื่องใช้คีย์เดียวกัน
        let publicKey = CLOUD_VAPID_PUBLIC_KEY;
        for (const candidate of getCandidateHubUrls()) {
          try {
            let keyRes = await fetchWithTimeout(`${candidate}/api/push/vapid-public-key`, {}, 3000);
            if (keyRes.status === 404) {
              keyRes = await fetchWithTimeout(`${candidate}/api/vapid-public-key`, {}, 3000);
            }
            if (keyRes.ok) {
              const keyData = await keyRes.json();
              if (keyData && keyData.publicKey) {
                publicKey = keyData.publicKey;
                activeHubUrl = candidate;
                break;
              }
            }
          } catch (_) {}
        }

        const convertedKey = urlBase64ToUint8Array(publicKey);

        const reg = await navigator.serviceWorker.register('./sw.js');
        await navigator.serviceWorker.ready;

        let sub = await reg.pushManager.getSubscription();
        if (sub) {
          try {
            await sub.unsubscribe();
          } catch (_) {}
        }

        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey
        });

        localStorage.setItem(STORAGE_VAPID_KEY_USED, publicKey);

        const subPayload = JSON.stringify({
          subscription: sub,
          appId: appId,
          userId: 'all',
          deviceName: detectedName,
          clientDeviceId: getClientDeviceId()
        });

        // บันทึก Subscription ลงในทุกเซิร์ฟเวอร์ที่ออนไลน์
        await Promise.all(
          getCandidateHubUrls().map(async (candidate) => {
            try {
              let postRes = await fetchWithTimeout(`${candidate}/api/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: subPayload
              }, 3000);
              if (postRes.status === 404) {
                await fetchWithTimeout(`${candidate}/api/push/subscribe`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: subPayload
                }, 3000);
              }
            } catch (_) {}
          })
        );

        showInAppToast('เปิดแจ้งเตือนสำเร็จ!', `ผูกอุปกรณ์ "${detectedName}" รับการแจ้งเตือนทั้งในแอปและหน้าจอล็อคเรียบร้อยแล้ว`, 'system');

        await dispatchNotifyHubApi({
          title: '🔔 เปิดรับการแจ้งเตือน IoT WebApp สำเร็จ!',
          body: `อุปกรณ์ ${detectedName} เชื่อมต่อกับระบบแจ้งเตือน (แชนแนล: ${appId}) เรียบร้อยแล้ว`,
          priority: 'normal'
        }).catch(() => {});

        await this.syncServerNotifications();
        await this.updatePushCardUI();
        return true;
      } catch (err) {
        console.warn('[Notification] WebPush subscribe fallback to In-App:', err);
        showInAppToast(
          '🔔 เปิดรับแจ้งเตือนขณะใช้งานแอปแล้ว',
          `อุปกรณ์ "${detectedName}" พร้อมรับการแจ้งเตือนแบบเรียลไทม์เมื่อเปิดแอป`,
          'system'
        );
        await this.updatePushCardUI();
        return true;
      }
    },

    async unsubscribePush() {
      try {
        setDeviceReceivingEnabled(false);
        const sub = await this.getPushSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await Promise.all(
            getCandidateHubUrls().map(async (candidate) => {
              try {
                let res = await fetchWithTimeout(`${candidate}/api/unsubscribe`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ endpoint })
                }, 2500);
                if (res.status === 404) {
                  await fetchWithTimeout(`${candidate}/api/push/unsubscribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint })
                  }, 2500);
                }
              } catch (_) {}
            })
          );
          await sub.unsubscribe();
        }

        showInAppToast('🔕 ปิดรับการแจ้งเตือนบนเครื่องนี้แล้ว', 'เครื่องนี้จะไม่เด้งข้อความเตือนจนกว่าจะกดเปิดรับอีกครั้ง', 'message');
        await this.updatePushCardUI();
        return true;
      } catch (err) {
        setDeviceReceivingEnabled(false);
        await this.updatePushCardUI();
        return false;
      }
    },

    async togglePush() {
      if (isDeviceReceivingEnabled()) {
        if (confirm('คุณต้องการปิดรับการแจ้งเตือนบนอุปกรณ์นี้ใช่หรือไม่?')) {
          await this.unsubscribePush();
        }
      } else {
        await this.subscribePush();
      }
    },

    /**
     * ส่งแจ้งเตือนทดสอบกระจายไปยังทุกเครื่องที่เปิดรับการแจ้งเตือน
     */
    async sendTestPush(customTitle, customBody) {
      const appId = getAppId();
      const targetDeviceId = getTargetDeviceId();
      const senderName = detectCurrentDeviceName();
      const title = customTitle || '🔔 ทดสอบการแจ้งเตือนจาก IoT WebApp';
      const body = customBody || `ส่งสัญญาณทดสอบจาก ${senderName} (แชนแนล: ${appId}) คลิกเพื่อดูรายละเอียด`;

      // บันทึก Signature ไว้ก่อนเพื่อไม่ให้รอบ Polling 3 วินาทีถัดไปเด้งซ้ำบนเครื่องที่กดส่ง
      markRecentlyAlerted(title, body);

      // หากเครื่องที่กดส่งเปิดรับการแจ้งเตือนไว้ด้วย ให้เด้งแจ้งเตือนบนเครื่องนี้ทันทีเหมือนเครื่องรับอื่นๆ
      if (isDeviceReceivingEnabled()) {
        playAlertChime();
        showInAppToast(title, body, 'message');
        dispatchDevicePush(title, body);
      } else {
        showInAppToast('🚀 กำลังส่งแจ้งเตือนไปยังเครื่องที่เปิดรับ...', body, 'system');
      }

      try {
        const res = await dispatchNotifyHubApi({
          appId: appId,
          title: title,
          body: body,
          url: window.location.href,
          targetDeviceId: targetDeviceId || null,
          priority: 'high'
        });

        this.addNotif({
          title: title,
          desc: body,
          type: 'message',
          playSound: false,
          showToast: false,
          sendToHub: false,
          meta: { source: 'notifyhub-test', delivery: res ? res.delivery : null }
        });

        setTimeout(() => this.syncServerNotifications(), 800);
        return res;
      } catch (e) {
        console.warn('[NotifyHub] Test push fallback:', e);
        this.addNotif({
          title: title,
          desc: body,
          type: 'system',
          playSound: false,
          showToast: false,
          sendToHub: false
        });
        return null;
      }
    },

    async sendCustomFromUI() {
      const titleInput = document.getElementById('notifyHubCustomTitle');
      const bodyInput = document.getElementById('notifyHubCustomBody');
      const btn = document.getElementById('btnSendCustomNotifyHub');

      const title = (titleInput && titleInput.value.trim()) || 'มีรายการใหม่จาก Web App!';
      const body = (bodyInput && bodyInput.value.trim()) || 'คลิกเพื่อดูรายละเอียดได้เลย';

      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ กำลังส่ง...';
      }

      try {
        await this.sendTestPush(title, body);
        if (titleInput) titleInput.value = '';
        if (bodyInput) bodyInput.value = '';
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🚀 ส่งแจ้งเตือนเข้ามือถือทันที';
        }
      }
    },

    /**
     * ประมวลผลข้อมูลสถานะและการแจ้งเตือนที่ดึงมาจากเซิร์ฟเวอร์แบบ Real-Time (ทุก 3 วินาทีขณะใช้งานแอป)
     * รองรับทั้งรูปแบบ `data.notifications` (Cloud Render) และ `data.messages` (NotifyHub)
     */
    ingestServerStatus(data) {
      if (!data) return;
      const appId = getAppId();

      if (typeof data.subscriptionsCount === 'number' && data.subscriptionsCount > 0) {
        serverSubscribersCount = data.subscriptionsCount;
      }

      if (Array.isArray(data.devices) && data.devices.length > 0) {
        notifyHubDevices = data.devices;
      }

      if (Array.isArray(data.apps) && data.apps.length > 0) {
        notifyHubApps = data.apps;
      }

      // รวมรายการแจ้งเตือนจากทั้ง 2 รูปแบบ (data.notifications และ data.messages)
      const incomingItems = [];

      if (Array.isArray(data.notifications)) {
        data.notifications.slice(0, 35).forEach(n => {
          if (n && n.id) {
            incomingItems.push({
              id: String(n.id),
              title: n.title || 'แจ้งเตือนระบบ IoT',
              desc: n.desc || n.body || '',
              type: n.type || 'system',
              time: typeof n.time === 'number' ? n.time : (n.time ? new Date(n.time).getTime() : Date.now()),
              meta: n.meta || {}
            });
          }
        });
      }

      if (Array.isArray(data.messages)) {
        data.messages
          .filter(m => !m.appId || m.appId === appId || m.appId === 'default' || appId === '*')
          .slice(0, 35)
          .forEach(m => {
            if (m && m.id) {
              incomingItems.push({
                id: 'hub_' + String(m.id),
                title: m.title || 'แจ้งเตือนจาก NotifyHub',
                desc: m.body || `ส่งจากแชนแนล ${m.appName || m.appId}`,
                type: m.priority === 'high' ? 'warning' : 'message',
                time: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
                meta: {
                  ...(m.data || {}),
                  source: 'notifyhub',
                  appId: m.appId,
                  appName: m.appName || m.appId,
                  targetDeviceId: m.targetDeviceId || (m.data && m.data.targetDeviceId) || null,
                  delivery: m.delivery
                }
              });
            }
          });
      }

      if (incomingItems.length === 0) {
        initialServerSyncDone = true;
        return;
      }

      // เรียงจากเก่าไปใหม่เพื่อให้ unshift ลงรายการได้อย่างถูกต้อง
      incomingItems.sort((a, b) => a.time - b.time);

      const localList = loadNotifs();
      const existingLocalIds = new Set(localList.map(n => n.id));
      let hasNewHistory = false;
      const newlyArrivedForAlert = [];

      for (const item of incomingItems) {
        const isFirstTimeSeenInSession = !seenServerNotifIds.has(item.id);
        seenServerNotifIds.add(item.id);

        if (!existingLocalIds.has(item.id)) {
          localList.unshift({
            id: item.id,
            title: item.title,
            desc: item.desc,
            type: item.type,
            time: item.time,
            read: !initialServerSyncDone, // ประวัติเก่าที่โหลดตอนเปิดแอปครั้งแรกไม่ให้ค้างจุดแดงซ้ำ
            meta: item.meta
          });
          existingLocalIds.add(item.id);
          hasNewHistory = true;
        }

        // หากเป็นการแจ้งเตือนใหม่ที่เพิ่งส่งเข้ามาหลังจากเปิดหน้าแอป (เช่น กดส่งมาจากคอมพิวเตอร์หรือเครื่องอื่น)
        if (initialServerSyncDone && isFirstTimeSeenInSession && item.time >= (sessionStartTime - 20000)) {
          newlyArrivedForAlert.push(item);
        }
      }

      if (hasNewHistory) {
        saveNotifs(localList);
        this.render();
        this.updateBadges();
      }

      initialServerSyncDone = true;

      // หากมีรายการแจ้งเตือนใหม่เข้ามาขณะใช้งานแอป และเครื่องนี้เปิดรับการแจ้งเตือนไว้ -> เด้งแจ้งเตือนทันที!
      if (newlyArrivedForAlert.length > 0 && isDeviceReceivingEnabled()) {
        const latestAlert = newlyArrivedForAlert[newlyArrivedForAlert.length - 1];
        const targetDev = latestAlert.meta && latestAlert.meta.targetDeviceId;
        const myClientId = getClientDeviceId();

        // ถ้าระบุเครื่องเป้าหมายเฉพาะเจาะจง ให้เช็คว่าตรงกับเครื่องนี้หรือไม่ (ถ้าไม่ได้ระบุ = ส่งทุกเครื่องที่เปิดรับ)
        const isTargetedToMe = !targetDev || targetDev === 'all' || targetDev === myClientId ||
          (targetDev === '99fbb8b3-ed1f-4e79-ab05-9074626165a6' && /iPhone|iPad|iPod/.test(navigator.userAgent));

        if (isTargetedToMe && !wasRecentlyAlerted(latestAlert.title, latestAlert.desc)) {
          markRecentlyAlerted(latestAlert.title, latestAlert.desc);
          playAlertChime();
          showInAppToast(latestAlert.title, latestAlert.desc, latestAlert.type || 'message');
          dispatchDevicePush(latestAlert.title, latestAlert.desc);
        }
      }
    },

    /**
     * ค้นหาและซิงค์ข้อมูลจากเซิร์ฟเวอร์อัตโนมัติ
     */
    async syncServerNotifications() {
      const candidates = getCandidateHubUrls();
      let anyConnected = false;

      for (const candidate of candidates) {
        try {
          const res = await fetchWithTimeout(`${candidate}/api/status?appId=*`, { cache: 'no-store' }, 3200);
          if (res.ok) {
            const data = await res.json();
            if (data) {
              anyConnected = true;
              activeHubUrl = candidate;
              notifyHubConnected = true;
              this.ingestServerStatus(data);
            }
          }
        } catch (_) {}
      }

      if (!anyConnected) {
        notifyHubConnected = true;
      }

      this.updateNotifyHubDashboardUI();
      this.updatePushCardUI();
    },

    connectNotifyHubStream() {
      // 1. รับข้อความตรงจาก Service Worker เมื่อมี Web Push เข้ามาขณะเปิดแอปอยู่
      if ('serviceWorker' in navigator && !this._swListenerBound) {
        this._swListenerBound = true;
        navigator.serviceWorker.addEventListener('message', (event) => {
          const msgData = event.data;
          if (msgData && msgData.type === 'IOT_PUSH_RECEIVED' && msgData.payload) {
            const p = msgData.payload;
            if (isDeviceReceivingEnabled() && !wasRecentlyAlerted(p.title, p.body)) {
              markRecentlyAlerted(p.title, p.body);
              this.addNotif({
                id: p.id ? ('push_' + p.id) : null,
                title: p.title || '🔔 แจ้งเตือนใหม่จากระบบ IoT',
                desc: p.body || '',
                type: p.priority === 'high' ? 'warning' : 'message',
                playSound: true,
                showToast: true,
                sendToHub: false
              });
            }
          }
        });
      }

      // 2. ตั้งเวลา Polling ซิงค์การแจ้งเตือนระหว่างเครื่องทุก 3.5 วินาที (ทำงานร่วมกับ app.js)
      if (!this._realtimePollTimer) {
        this._realtimePollTimer = setInterval(() => {
          this.syncServerNotifications();
        }, 3500);
      }

      // 3. เชื่อมต่อ SSE Stream หากเซิร์ฟเวอร์รองรับ
      if (typeof EventSource === 'undefined') return;
      try {
        if (notifyHubSSE) {
          notifyHubSSE.close();
          notifyHubSSE = null;
        }
        const hubUrl = getHubUrl();
        if (hubUrl.includes('onrender.com')) return; // Render ใช้ REST polling อยู่แล้ว
        const es = new EventSource(`${hubUrl}/api/stream`);
        notifyHubSSE = es;

        es.addEventListener('new_message', (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg) {
              this.ingestServerStatus({ messages: [msg] });
            }
          } catch (_) {
            this.syncServerNotifications();
          }
        });
      } catch (_) {}
    },

    updateNotifyHubDashboardUI() {
      const hubConnBadge = document.getElementById('notifyHubConnBadge');
      const hubUrlInput = document.getElementById('notifyHubUrlInput');
      const hubAppIdSelect = document.getElementById('notifyHubAppIdInput');
      const hubTargetSelect = document.getElementById('notifyHubTargetDeviceSelect');
      const hubDevicesSummary = document.getElementById('notifyHubDevicesSummary');

      const currentHubUrl = getHubUrl();
      const currentAppId = getAppId();
      const currentTargetDev = getTargetDeviceId();

      if (hubUrlInput && document.activeElement !== hubUrlInput) {
        hubUrlInput.value = currentHubUrl;
      }

      if (hubAppIdSelect && document.activeElement !== hubAppIdSelect) {
        hubAppIdSelect.value = currentAppId;
      }

      const activeDevices = (notifyHubDevices && notifyHubDevices.length > 0 ? notifyHubDevices : DEFAULT_KNOWN_DEVICES)
        .filter(d => d.enabled !== false);
      const totalOnlineCount = Math.max(activeDevices.length, serverSubscribersCount || 1);

      if (hubConnBadge) {
        hubConnBadge.textContent = `🟢 เชื่อมต่อระบบแจ้งเตือนแล้ว (${totalOnlineCount} เครื่อง)`;
        hubConnBadge.className = 'notifyhub-conn-pill online';
      }

      if (hubDevicesSummary) {
        const myName = detectCurrentDeviceName();
        const myState = isDeviceReceivingEnabled()
          ? `<span style="color:#059669;font-weight:700;">เปิดรับข้อความแล้ว ✅</span>`
          : `<span style="color:#d97706;font-weight:700;">ยังไม่ได้กดเปิดรับบนเครื่องนี้</span>`;
        hubDevicesSummary.innerHTML = `📱 สถานะเครื่องนี้ (${escapeHtml(myName)}): ${myState} • ซิงค์ข้อมูลร่วมกัน ${totalOnlineCount} อุปกรณ์`;
      }

      if (hubTargetSelect) {
        const list = notifyHubDevices && notifyHubDevices.length > 0 ? notifyHubDevices : DEFAULT_KNOWN_DEVICES;
        let opts = `<option value="">🌐 ส่งทุกอุปกรณ์ที่เปิดรับแจ้งเตือน (${totalOnlineCount} เครื่อง)</option>`;
        list.forEach(dev => {
          const status = dev.enabled !== false ? '🟢' : '🔴 [ปิด]';
          const ch = dev.appId === '*' ? 'ทุกแชนแนล' : dev.appId;
          opts += `<option value="${escapeHtml(dev.id)}">${status} ${escapeHtml(dev.deviceName)} (${escapeHtml(ch)})</option>`;
        });
        hubTargetSelect.innerHTML = opts;
        if (currentTargetDev && list.some(d => d.id === currentTargetDev)) {
          hubTargetSelect.value = currentTargetDev;
        } else {
          hubTargetSelect.value = '';
        }
      }
    },

    async updatePushCardUI() {
      const statusPill = document.getElementById('notifSystemStatusBadge');
      const statusText = document.getElementById('notifStatusText');
      const toggleBtn = document.getElementById('btnTogglePushAlert');
      const testBtn = document.getElementById('btnTestPushAlert');
      const iosTip = document.getElementById('iosPushNoticeCard');
      const bellBtn = document.getElementById('notifyHubBellWidgetBtn');

      const receivingEnabled = isDeviceReceivingEnabled();

      if (bellBtn && typeof bellBtn._updateState === 'function') {
        bellBtn._updateState();
      }

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.navigator.standalone === true ||
                           window.matchMedia('(display-mode: standalone)').matches;

      if (iosTip) {
        iosTip.style.display = (isIOS && !isStandalone && !receivingEnabled) ? 'block' : 'none';
      }

      if (statusPill && statusText) {
        if (receivingEnabled) {
          statusPill.className = 'notif-status-pill online';
          statusText.textContent = 'เครื่องนี้เปิดรับแล้ว ✅';
        } else {
          statusPill.className = 'notif-status-pill offline';
          statusText.textContent = 'เครื่องนี้ยังไม่เปิดรับ';
        }
      }

      if (toggleBtn) {
        if (receivingEnabled) {
          toggleBtn.textContent = '🔕 ปิดรับแจ้งเตือนบนเครื่องนี้';
          toggleBtn.className = 'btn-push-toggle active';
        } else {
          toggleBtn.textContent = '🔔 เปิดรับแจ้งเตือนบนเครื่องนี้';
          toggleBtn.className = 'btn-push-toggle';
        }
      }

      if (testBtn) {
        testBtn.style.display = 'inline-flex';
      }
    },

    init() {
      getNotifyInstance();

      // ปลดล็อกระบบเสียง Web Audio บน iOS/Mobile ทันทีที่ผู้ใช้แตะหน้าจอครั้งแรก
      if (!this._audioUnlockBound && typeof document !== 'undefined') {
        this._audioUnlockBound = true;
        const unlockAudio = () => {
          try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
              if (!audioCtx) audioCtx = new AudioContextClass();
              if (audioCtx.state === 'suspended') audioCtx.resume();
            }
          } catch (_) {}
        };
        document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
        document.addEventListener('click', unlockAudio, { once: true, passive: true });
      }

      this.render();
      this.updateBadges();
      this.updateNotifyHubDashboardUI();
      this.updatePushCardUI();
      this.ensureCloudPushSubscription();
      this.syncServerNotifications();
      this.connectNotifyHubStream();
    }
  };

  // Expose to Global Window
  window.IoTNotification = IoTNotification;
  window.playAlertChime = playAlertChime;
  window.showInAppToast = showInAppToast;

  window.filterNotifs = function (cat) {
    IoTNotification.setFilter(cat);
  };

  window.markAllNotifsAsRead = function () {
    IoTNotification.markAllAsRead();
  };

  window.clearAllNotifs = function () {
    IoTNotification.clearAll();
  };

  window.deleteNotif = function (id) {
    IoTNotification.deleteItem(id);
  };

  window.addCustomNotif = function (title, desc, type, meta) {
    IoTNotification.addNotif({ title, desc, type, meta });
  };

  window.togglePushAlert = function () {
    IoTNotification.togglePush();
  };

  window.sendTestPushAlert = function () {
    IoTNotification.sendTestPush();
  };

  window.sendCustomNotifyHubAlert = function () {
    IoTNotification.sendCustomFromUI();
  };

  window.saveNotifyHubSettings = function () {
    const urlEl = document.getElementById('notifyHubUrlInput');
    const appEl = document.getElementById('notifyHubAppIdInput');
    const devEl = document.getElementById('notifyHubTargetDeviceSelect');

    IoTNotification.saveNotifyHubConfig({
      hubUrl: urlEl ? urlEl.value : '',
      appId: appEl ? appEl.value : DEFAULT_APP_ID,
      targetDeviceId: devEl ? devEl.value : ''
    });

    showInAppToast('💾 บันทึกการตั้งค่า NotifyHub แล้ว', `เชื่อมต่อแชนแนล "${getAppId()}" พร้อมใช้งาน`, 'system');
  };

  window.handleNotifyHubTargetChange = function (selectEl) {
    if (!selectEl) return;
    IoTNotification.saveNotifyHubConfig({
      targetDeviceId: selectEl.value
    });
  };

  window.toggleNotifyHubConfigPanel = function () {
    const panel = document.getElementById('notifyHubConfigCollapse');
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => IoTNotification.init());
  } else {
    IoTNotification.init();
  }

})(window);
