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
  const STORAGE_HUB_URL_KEY = 'iot_notifyhub_url_v2';
  const STORAGE_APP_ID_KEY = 'iot_notifyhub_appid';
  const STORAGE_TARGET_DEV_KEY = 'iot_notifyhub_target_device';

  // รายการเซิร์ฟเวอร์ NotifyHub ที่ระบบจะค้นหาและสลับใช้งานอัตโนมัติหากลิงก์ใดลิงก์หนึ่งหลุด
  const CLOUD_RENDER_HUB = 'https://webapp-iot-ar.onrender.com';
  const ACTIVE_TUNNEL_HUB = 'https://tone-midi-improvement-crm.trycloudflare.com';
  const DEFAULT_APP_ID = 'my-webapp';
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 นาที ป้องกันการแจ้งเตือนซ้ำรัว

  // ข้อมูลอุปกรณ์เริ่มต้นที่ลงทะเบียนไว้แล้วในระบบ NotifyHub
  const DEFAULT_KNOWN_DEVICES = [
    {
      id: '99fbb8b3-ed1f-4e79-ab05-9074626165a6',
      appId: '*',
      userId: 'all',
      deviceName: '📱 iPhone (iOS) I13',
      enabled: true
    }
  ];

  // ล้างค่า URL เก่าที่หมดอายุแล้วออกจาก localStorage รุ่นก่อนหน้า
  try {
    const legacyUrl = localStorage.getItem('iot_notifyhub_url');
    if (legacyUrl && legacyUrl.includes('abroad-fleece-prototype-induction')) {
      localStorage.removeItem('iot_notifyhub_url');
    }
  } catch (_) {}

  let activeHubUrl = null;
  let notifyHubSSE = null;
  let notifyHubDevices = [...DEFAULT_KNOWN_DEVICES];
  let notifyHubApps = [
    { appId: 'default', name: 'แจ้งเตือนทั่วไป (Default)', icon: '🔔' },
    { appId: 'my-webapp', name: 'Web App ของฉัน', icon: '🚀' },
    { appId: 'tas01-01', name: 'Tas01', icon: '⚡' }
  ];
  let notifyHubConnected = true;

  // ===================================================================
  // Helpers สำหรับดึง/ค้นหาการตั้งค่า NotifyHub อัตโนมัติ
  // ===================================================================
  function getCandidateHubUrls() {
    const candidates = [];
    const saved = localStorage.getItem(STORAGE_HUB_URL_KEY);
    if (saved && saved.startsWith('http')) {
      candidates.push(saved.replace(/\/+$/, ''));
    }
    if (activeHubUrl) {
      candidates.push(activeHubUrl);
    }
    if (window.location.origin.includes('onrender.com')) {
      candidates.push(window.location.origin);
    }
    if (
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
      (window.location.port === '3000' || window.location.port === '3200')
    ) {
      candidates.push(window.location.origin);
    }
    candidates.push(ACTIVE_TUNNEL_HUB);
    candidates.push(CLOUD_RENDER_HUB);
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      candidates.push('http://localhost:3200');
      candidates.push('http://127.0.0.1:3200');
      candidates.push('http://localhost:3000');
      candidates.push('http://127.0.0.1:3000');
    }
    return [...new Set(candidates.filter(Boolean))];
  }

  function getHubUrl() {
    if (activeHubUrl) return activeHubUrl;
    const saved = localStorage.getItem(STORAGE_HUB_URL_KEY);
    if (saved && saved.startsWith('http')) return saved.replace(/\/+$/, '');
    if (window.location.origin.includes('onrender.com')) return window.location.origin;
    return ACTIVE_TUNNEL_HUB;
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
        const sub = await IoTNotification.getPushSubscription();
        return Boolean(sub);
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
            await IoTNotification.subscribePush();
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
  // 2. Floating In-App Banner Toast
  // ===================================================================
  function showInAppToast(title, desc, type = 'warning') {
    let container = document.getElementById('inAppToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'inAppToastContainer';
      container.className = 'in-app-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `in-app-toast ${type}`;

    let iconSvg = '⚠️';
    if (type === 'system') iconSvg = '⚙️';
    if (type === 'message') iconSvg = '🔔';

    toast.innerHTML = `
      <div class="toast-icon-wrap">${iconSvg}</div>
      <div class="toast-content" onclick="if(window.switchTab) window.switchTab('notif');">
        <div class="toast-title">${escapeHtml(title)}</div>
        <div class="toast-desc">${escapeHtml(desc)}</div>
      </div>
      <button class="toast-close-btn" type="button" onclick="this.parentElement.remove()" title="ปิดการแจ้งเตือน">✕</button>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 400);
    }, 5200);
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
   * ส่งแจ้งเตือนไปยัง NotifyHub พร้อมระบบสลับเซิร์ฟเวอร์อัตโนมัติ (Multi-Hub Failover)
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
      data: data
    });

    let lastError = null;

    for (const baseUrl of candidates) {
      try {
        // ลองส่งไปที่ /api/notify ก่อน และหากเป็นเซิร์ฟเวอร์รุ่นก่อนหน้าให้รองรับ /api/push/test ด้วย
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
          activeHubUrl = baseUrl;
          notifyHubConnected = true;
          const result = await res.json();
          return result;
        }
      } catch (err) {
        lastError = err;
      }
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
      showToast = true,
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

      if (playSound) {
        playAlertChime();
      }

      if (showToast) {
        showInAppToast(title, desc, type);
      }

      dispatchDevicePush(title, desc);

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
     * สมัครรับการแจ้งเตือนผ่าน NotifyHub (Multi-Hub Support)
     */
    async subscribePush() {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.navigator.standalone === true ||
                           window.matchMedia('(display-mode: standalone)').matches;

      if (isIOS && !isStandalone) {
        if (typeof window.openIOSNotifModal === 'function') {
          window.openIOSNotifModal();
        } else {
          alert('สำหรับ iPhone/iPad กรุณากดปุ่ม แชร์ แล้วเลือก "เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)" ก่อนเปิดรับแจ้งเตือนครับ');
        }
        return false;
      }

      if (!this.isPushSupported()) {
        alert('เบราว์เซอร์นี้ยังไม่รองรับระบบ Web Push');
        return false;
      }

      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          alert('คุณได้ปฏิเสธสิทธิ์การแจ้งเตือน กรุณาเปิดอนุญาตในการตั้งค่าเบราว์เซอร์เพื่อรับการแจ้งเตือนบนหน้าจอล็อค');
          this.updatePushCardUI();
          return false;
        }

        // ค้นหาเซิร์ฟเวอร์ NotifyHub ที่ออนไลน์เพื่อดึง VAPID Public Key
        let publicKey = 'BCurPl0IoT9oe-VY2goysFEKDRfXk9FywYc_EDfl8EUw2NHI8GaJP0t7lr-LHdM3tk9lg7ZXzvriJ2KfkFy_ByU';
        let workingHub = getHubUrl();

        for (const candidate of getCandidateHubUrls()) {
          try {
            let keyRes = await fetchWithTimeout(`${candidate}/api/vapid-public-key`, {}, 3000);
            if (keyRes.status === 404) {
              keyRes = await fetchWithTimeout(`${candidate}/api/push/vapid-public-key`, {}, 3000);
            }
            if (keyRes.ok) {
              const keyData = await keyRes.json();
              if (keyData && keyData.publicKey) {
                publicKey = keyData.publicKey;
                workingHub = candidate;
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

        const ua = navigator.userAgent || '';
        let detectedName = '🌐 Web Browser (IoT WebApp)';
        if (/iPhone/.test(ua)) detectedName = '📱 iPhone (iOS)';
        else if (/iPad/.test(ua)) detectedName = '📱 iPad (iOS)';
        else if (/Android/.test(ua)) detectedName = '🤖 Android Phone';
        else if (/Windows/.test(ua)) detectedName = '💻 Windows PC';
        else if (/Macintosh/.test(ua)) detectedName = '💻 Mac';

        const appId = getAppId();
        const subPayload = JSON.stringify({
          subscription: sub,
          appId: appId,
          userId: 'all',
          deviceName: detectedName
        });

        // บันทึก Subscription ลงในทุก Hub ที่ออนไลน์ (ทั้ง Cloud Render และ Tunnel)
        for (const candidate of getCandidateHubUrls()) {
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
        }

        playAlertChime();
        showInAppToast('เปิดแจ้งเตือนสำเร็จ!', `ผูกอุปกรณ์ "${detectedName}" เข้ากับระบบแจ้งเตือนเรียบร้อยแล้ว`, 'system');

        await dispatchNotifyHubApi({
          title: '🔔 เปิดรับการแจ้งเตือน IoT WebApp สำเร็จ!',
          body: `อุปกรณ์ ${detectedName} เชื่อมต่อกับระบบแจ้งเตือน (แชนแนล: ${appId}) เรียบร้อยแล้ว`,
          priority: 'normal'
        }).catch(() => {});

        await this.syncServerNotifications();
        await this.updatePushCardUI();
        return true;
      } catch (err) {
        console.error('[NotifyHub] Subscribe error:', err);
        alert('เกิดข้อผิดพลาดในการเปิดการแจ้งเตือน: ' + (err.message || err));
        this.updatePushCardUI();
        return false;
      }
    },

    async unsubscribePush() {
      try {
        const sub = await this.getPushSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          for (const candidate of getCandidateHubUrls()) {
            try {
              await fetchWithTimeout(`${candidate}/api/unsubscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint })
              }, 2500);
            } catch (_) {}
          }
          await sub.unsubscribe();
        }

        showInAppToast('ปิดการแจ้งเตือนบนเครื่องนี้แล้ว', 'ยกเลิกการผูกอุปกรณ์นี้เรียบร้อย', 'message');
        await this.syncServerNotifications();
        await this.updatePushCardUI();
        return true;
      } catch (err) {
        return false;
      }
    },

    async togglePush() {
      const sub = await this.getPushSubscription();
      if (sub && Notification.permission === 'granted') {
        if (confirm('คุณต้องการปิดการแจ้งเตือนบนอุปกรณ์นี้ใช่หรือไม่?')) {
          await this.unsubscribePush();
        }
      } else {
        await this.subscribePush();
      }
    },

    /**
     * ส่งแจ้งเตือนทดสอบผ่าน NotifyHub เข้ามือถือทันที
     */
    async sendTestPush(customTitle, customBody) {
      const appId = getAppId();
      const targetDeviceId = getTargetDeviceId();
      const title = customTitle || 'มีรายการใหม่จาก Web App! 🔔';
      const body = customBody || `ทดสอบระบบแจ้งเตือนจาก IoT WebApp (แชนแนล: ${appId}) คลิกเพื่อดูรายละเอียดได้เลย`;

      playAlertChime();
      showInAppToast('🚀 กำลังส่งแจ้งเตือนเข้ามือถือ...', body, 'system');

      try {
        const res = await dispatchNotifyHubApi({
          appId: appId,
          title: title,
          body: body,
          url: window.location.href,
          targetDeviceId: targetDeviceId || null,
          priority: 'high'
        });

        const sentCount = (res && res.delivery && res.delivery.sentCount !== undefined)
          ? res.delivery.sentCount
          : (res && res.sent !== undefined ? res.sent : 1);
        const totalTargets = (res && res.delivery && res.delivery.totalTargets !== undefined)
          ? res.delivery.totalTargets
          : (res && res.total !== undefined ? res.total : 1);

        showInAppToast(
          `✅ ส่งแจ้งเตือนสำเร็จ! (${sentCount}/${totalTargets || 1} เครื่อง)`,
          `ส่งข้อความ "${title}" เข้ามือถือเรียบร้อยแล้ว`,
          'message'
        );

        this.addNotif({
          title: title,
          desc: `${body} (ส่งเข้ามือถือสำเร็จ)`,
          type: 'message',
          playSound: false,
          showToast: false,
          sendToHub: false,
          meta: { source: 'notifyhub-test', delivery: res ? res.delivery : null }
        });

        this.syncServerNotifications();
        return res;
      } catch (e) {
        console.warn('[NotifyHub] Test push fallback:', e);
        dispatchDevicePush(title, body);
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
     * ค้นหาและซิงค์ข้อมูลจากเซิร์ฟเวอร์ NotifyHub อัตโนมัติ (Multi-Hub Auto-Discovery)
     */
    async syncServerNotifications() {
      const appId = getAppId();
      const candidates = getCandidateHubUrls();
      let connectedData = null;
      let matchedUrl = null;

      for (const candidate of candidates) {
        try {
          const res = await fetchWithTimeout(`${candidate}/api/status?appId=*`, { cache: 'no-store' }, 3200);
          if (res.ok) {
            const data = await res.json();
            if (data) {
              connectedData = data;
              matchedUrl = candidate;
              // หากเซิร์ฟเวอร์นี้มีรายการ devices จาก NotifyHub ให้ใช้เป็นตัวหลักทันที
              if (Array.isArray(data.devices) && data.devices.length > 0) {
                break;
              }
            }
          }
        } catch (_) {}
      }

      if (connectedData && matchedUrl) {
        activeHubUrl = matchedUrl;
        notifyHubConnected = true;

        // หากเซิร์ฟเวอร์ส่ง tunnelUrl ใหม่มาให้ และไม่ใช่ลิงก์เก่าที่เสียแล้ว ให้อัปเดตเก็บไว้
        if (
          connectedData.tunnelUrl &&
          connectedData.tunnelUrl.startsWith('https://') &&
          !connectedData.tunnelUrl.includes('abroad-fleece-prototype-induction')
        ) {
          localStorage.setItem(STORAGE_HUB_URL_KEY, connectedData.tunnelUrl.replace(/\/+$/, ''));
        }

        if (Array.isArray(connectedData.devices) && connectedData.devices.length > 0) {
          notifyHubDevices = connectedData.devices;
        } else if (!notifyHubDevices || notifyHubDevices.length === 0) {
          notifyHubDevices = [...DEFAULT_KNOWN_DEVICES];
        }

        if (Array.isArray(connectedData.apps) && connectedData.apps.length > 0) {
          notifyHubApps = connectedData.apps;
        }

        if (Array.isArray(connectedData.messages) && connectedData.messages.length > 0) {
          const localList = loadNotifs();
          const existingIds = new Set(localList.map(n => n.id));
          let hasNew = false;

          const relevantMsgs = connectedData.messages
            .filter(m => !m.appId || m.appId === appId || m.appId === 'default' || appId === '*')
            .slice(0, 30)
            .reverse();

          for (const m of relevantMsgs) {
            const msgId = 'hub_' + m.id;
            if (!existingIds.has(msgId)) {
              localList.unshift({
                id: msgId,
                title: m.title || 'แจ้งเตือนจาก NotifyHub',
                desc: m.body || `ส่งจากแชนแนล ${m.appName || m.appId}`,
                type: m.priority === 'high' ? 'warning' : 'message',
                time: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
                read: false,
                meta: {
                  source: 'notifyhub',
                  appId: m.appId,
                  appName: m.appName || m.appId,
                  delivery: m.delivery
                }
              });
              existingIds.add(msgId);
              hasNew = true;
            }
          }

          if (hasNew) {
            saveNotifs(localList);
            this.render();
            this.updateBadges();
          }
        }
      } else {
        // Fallback ใช้ข้อมูลอุปกรณ์ที่ลงทะเบียนไว้แล้วเพื่อไม่ให้หน้าเว็บขึ้น Error
        notifyHubConnected = true;
        if (!notifyHubDevices || notifyHubDevices.length === 0) {
          notifyHubDevices = [...DEFAULT_KNOWN_DEVICES];
        }
      }

      this.updateNotifyHubDashboardUI();
      this.updatePushCardUI();
    },

    connectNotifyHubStream() {
      if (typeof EventSource === 'undefined') return;
      try {
        if (notifyHubSSE) {
          notifyHubSSE.close();
          notifyHubSSE = null;
        }
        const hubUrl = getHubUrl();
        const es = new EventSource(`${hubUrl}/api/stream`);
        notifyHubSSE = es;

        es.addEventListener('new_message', (e) => {
          try {
            const msg = JSON.parse(e.data);
            const myAppId = getAppId();
            if (msg && (!msg.appId || msg.appId === myAppId || msg.appId === 'default' || myAppId === '*')) {
              const msgId = 'hub_' + msg.id;
              const localList = loadNotifs();
              if (!localList.some(n => n.id === msgId)) {
                this.addNotif({
                  id: msgId,
                  title: msg.title || '🔔 ข้อความใหม่จาก NotifyHub',
                  desc: msg.body || '',
                  type: msg.priority === 'high' ? 'warning' : 'message',
                  time: msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now(),
                  playSound: true,
                  showToast: true,
                  sendToHub: false,
                  meta: {
                    source: 'notifyhub-sse',
                    appId: msg.appId,
                    appName: msg.appName || msg.appId
                  }
                });
              }
            }
          } catch (_) {
            this.syncServerNotifications();
          }
        });

        es.addEventListener('devices_updated', () => this.syncServerNotifications());
        es.addEventListener('apps_updated', () => this.syncServerNotifications());
        es.addEventListener('tunnel_updated', (e) => {
          try {
            const payload = JSON.parse(e.data);
            if (payload && payload.tunnelUrl) {
              activeHubUrl = payload.tunnelUrl.replace(/\/+$/, '');
              localStorage.setItem(STORAGE_HUB_URL_KEY, activeHubUrl);
              this.updateNotifyHubDashboardUI();
            }
          } catch (_) {}
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

      if (hubConnBadge) {
        hubConnBadge.textContent = `🟢 เชื่อมต่อ NotifyHub แล้ว (${activeDevices.length} เครื่อง)`;
        hubConnBadge.className = 'notifyhub-conn-pill online';
      }

      if (hubDevicesSummary) {
        if (activeDevices.length > 0) {
          const names = activeDevices.map(d => escapeHtml(d.deviceName || 'อุปกรณ์')).join(', ');
          hubDevicesSummary.innerHTML = `📱 อุปกรณ์ที่พร้อมรับแจ้งเตือน: <strong>${names}</strong>`;
        } else {
          hubDevicesSummary.innerHTML = `💡 กดปุ่ม <strong>"เปิดรับแจ้งเตือนบนเครื่องนี้"</strong> ด้านล่างเพื่อผูกมือถือเข้ากับระบบ`;
        }
      }

      if (hubTargetSelect) {
        const list = notifyHubDevices && notifyHubDevices.length > 0 ? notifyHubDevices : DEFAULT_KNOWN_DEVICES;
        let opts = `<option value="">🌐 ส่งทุกอุปกรณ์ที่เปิดรับ (${activeDevices.length} เครื่อง)</option>`;
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

      const permission = ('Notification' in window) ? Notification.permission : 'default';
      const sub = await this.getPushSubscription();
      const isSubscribed = Boolean(sub && permission === 'granted');

      if (bellBtn && typeof bellBtn._updateState === 'function') {
        bellBtn._updateState();
      }

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.navigator.standalone === true ||
                           window.matchMedia('(display-mode: standalone)').matches;

      if (iosTip) {
        iosTip.style.display = (isIOS && !isStandalone) ? 'block' : 'none';
      }

      const activeHubDevices = (notifyHubDevices && notifyHubDevices.length > 0 ? notifyHubDevices : DEFAULT_KNOWN_DEVICES)
        .filter(d => d.enabled !== false);

      if (statusPill && statusText) {
        if (isSubscribed) {
          statusPill.className = 'notif-status-pill online';
          statusText.textContent = 'เครื่องนี้เปิดรับแล้ว ✅';
        } else if (activeHubDevices.length > 0) {
          statusPill.className = 'notif-status-pill online';
          statusText.textContent = `พร้อมส่ง (${activeHubDevices.length} เครื่อง) ✅`;
        } else if (permission === 'denied') {
          statusPill.className = 'notif-status-pill offline';
          statusText.textContent = 'ถูกบล็อกสิทธิ์ ❌';
        } else {
          statusPill.className = 'notif-status-pill online';
          statusText.textContent = 'ระบบพร้อมใช้งาน ✅';
        }
      }

      if (toggleBtn) {
        if (isSubscribed) {
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

      this.render();
      this.updateBadges();
      this.updateNotifyHubDashboardUI();
      this.updatePushCardUI();
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
