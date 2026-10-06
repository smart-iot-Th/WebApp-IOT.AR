/**
 * ===================================================================
 * IoT Notification System Module (js/notification.js)
 * บริหารจัดการประวัติการแจ้งเตือน กฎตรวจจับค่าเซนเซอร์อัตโนมัติ 
 * ระบบ Web Push ผ่าน VAPID (แจ้งเตือนบนหน้าจอล็อค Android/iOS 16.4+)
 * พร้อมเสียงเตือน Chime (Web Audio API) และ Floating Banner Toast
 * ===================================================================
 */

(function (window) {
  'use strict';

  const STORAGE_KEY = 'smartfarm_notifs';
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 นาที ป้องกันการแจ้งเตือนซ้ำรัว

  // ค่ามาตรฐานเริ่มต้นเมื่อเปิดใช้งานครั้งแรก
  const INITIAL_SEED_NOTIFS = [
    {
      id: 'seed_init_1',
      title: 'เริ่มต้นระบบการแจ้งเตือนอัจฉริยะ',
      desc: 'ระบบเริ่มเฝ้าระวังสภาพแวดล้อมและพร้อมบันทึกเหตุการณ์อัตโนมัติตามข้อมูลจริงจาก ESP32',
      type: 'system',
      time: Date.now() - 300000,
      read: true,
      meta: { source: 'system' }
    }
  ];

  // ติดตามเวลาการแจ้งเตือนล่าสุดเพื่อทำ Anti-Spam Cooldown ในฝั่งเบราว์เซอร์
  const lastAlertTimes = {
    temp: 0,
    humid: 0,
    co2: 0,
    lux: 0
  };

  // ติดตามสถานะล่าสุดเพื่อตรวจจับการเปลี่ยนแปลง (State Transition Edge Detection)
  let lastOnlineState = null;
  let lastRelayStates = {
    fogger: null,
    fan: null,
    light: null,
    curtain: null
  };

  let currentFilter = 'all';

  // ===================================================================
  // 1. Web Audio API Chime Synthesizer (เสียงเตือนคุณภาพสูงแบบไม่ต้องโหลดไฟล์)
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

      // สร้างเสียงคอร์ด 2 จังหวะ (E5 -> A5) นุ่มนวล ชัดเจน เหมือนการแจ้งเตือนอุปกรณ์สมาร์ทโฮม
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
  // 2. Floating In-App Banner Toast (ป้ายเตือนเลื่อนลงจากขอบบน)
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

    // ปิดอัตโนมัติหลัง 5 วินาที
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 400);
    }, 5200);
  }

  // ===================================================================
  // 3. Web Push Utilities & Endpoints (VAPID API Helper)
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

  function resolveApiUrl(path) {
    if (typeof window.getApiUrl === 'function') {
      return window.getApiUrl(path);
    }
    if (window.location.origin.includes('onrender.com')) {
      return path;
    }
    if (window.location.port === '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      return path;
    }
    return 'https://webapp-iot-ar.onrender.com' + path;
  }

  /**
   * Helper จัดการ LocalStorage
   */
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
      console.error('[Notification] Load error:', e);
      return [];
    }
  }

  function saveNotifs(list) {
    try {
      const trimmed = list.slice(0, 100);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch (e) {
      console.error('[Notification] Save error:', e);
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

  /**
   * ส่ง Local Push Notification (เมื่อแอปเปิดอยู่หรือใน Background)
   */
  function dispatchDevicePush(title, body, options = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, {
            body: body,
            icon: options.icon || './assets/icons/icon-192.png',
            badge: './assets/icons/icon-192.png',
            vibrate: [250, 100, 250, 100, 250],
            tag: options.tag || ('iot-alert-' + Date.now()),
            renotify: true,
            data: { url: './index.html?tab=notif' }
          });
        }).catch(err => {
          console.warn('[Notification] SW showNotification error:', err);
        });
      }
    } catch (e) {
      console.warn('[Notification] Dispatch push error:', e);
    }
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
    /**
     * ดึงรายการทั้งหมด
     */
    getAll() {
      return loadNotifs();
    },

    /**
     * ดึงจำนวนที่ยังไม่อ่าน
     */
    getUnreadCount() {
      const list = loadNotifs();
      return list.filter(item => !item.read).length;
    },

    /**
     * เพิ่มการแจ้งเตือนใหม่ (พร้อมเสียง Chime, In-App Banner และ Local Push)
     */
    addNotif({ title, desc, type = 'warning', meta = {}, playSound = true, showToast = true }) {
      if (!title) return null;

      const list = loadNotifs();
      const newItem = {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        title: title,
        desc: desc || '',
        type: type, // 'warning' | 'system' | 'message'
        time: Date.now(),
        read: false,
        meta: meta
      };

      list.unshift(newItem);
      saveNotifs(list);

      // 1. เล่นเสียงเตือนทันทีในเบราว์เซอร์
      if (playSound) {
        playAlertChime();
      }

      // 2. แสดง Toast Banner ลอยลงมาจากขอบบน
      if (showToast) {
        showInAppToast(title, desc, type);
      }

      // 3. ส่ง Push เข้าสู่อุปกรณ์
      dispatchDevicePush(title, desc);

      // 4. อัปเดต UI ทันที
      this.render();
      this.updateBadges();

      return newItem;
    },

    /**
     * ทำเครื่องหมายว่าอ่านแล้วเดี่ยว
     */
    markAsRead(id) {
      const list = loadNotifs();
      const updated = list.map(item => item.id === id ? { ...item, read: true } : item);
      saveNotifs(updated);
      this.render();
      this.updateBadges();
    },

    /**
     * ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
     */
    markAllAsRead() {
      const list = loadNotifs();
      const updated = list.map(item => ({ ...item, read: true }));
      saveNotifs(updated);
      this.render();
      this.updateBadges();
    },

    /**
     * ลบรายการเดี่ยว
     */
    deleteItem(id) {
      const list = loadNotifs();
      const updated = list.filter(item => item.id !== id);
      saveNotifs(updated);
      this.render();
      this.updateBadges();
    },

    /**
     * ล้างรายการทั้งหมด
     */
    clearAll() {
      if (!confirm('คุณต้องการล้างประวัติการแจ้งเตือนทั้งหมดใช่หรือไม่?')) return;
      saveNotifs([]);
      this.render();
      this.updateBadges();
    },

    /**
     * ตั้งค่า Filter กรองข้อมูล ('all' | 'warning' | 'system' | 'message')
     */
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

    /**
     * อัปเดตป้ายตัวเลขและจุดแดงบน UI
     */
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

    /**
     * เรนเดอร์การ์ดรายการแจ้งเตือนลงใน DOM
     */
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
            <div style="font-size: 0.8rem;">ระบบจะบันทึกประวัติอัตโนมัติเมื่อเกิดเหตุการณ์หรือค่าเซนเซอร์หลุดเกณฑ์</div>
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
          typeBadgeLabel = 'ข้อความ';
        }

        html += `
          <div class="notif-card ${isUnread ? 'unread' : ''}" onclick="IoTNotification.markAsRead('${item.id}')">
            <div class="notif-card-header">
              <div class="notif-header-left">
                <div class="notif-icon-circle ${typeBadgeClass}">
                  ${iconHtml}
                </div>
                <div class="notif-meta">
                  <span class="notif-type-tag ${typeBadgeClass}">${typeBadgeLabel}</span>
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

    /**
     * กฎประเมินค่าเซนเซอร์และฮาร์ดแวร์ตามเวลาจริง (Smart Evaluation Engine)
     * เรียกใช้งานจาก app.js เมื่อได้รับ Telemetry จาก ESP32
     */
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

      // 1. ตรวจจับการเปลี่ยนแปลงสถานะฮาร์ดแวร์ (State Transition)
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

      // 2. ตรวจจับสวิตช์รีเลย์เปลี่ยนสถานะ (Relay Edge Detection)
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

      // หากบอร์ดออฟไลน์ ไม่ต้องประเมินค่าเซนเซอร์
      if (!isOnline || telemetry.temp === null || telemetry.temp === undefined) {
        return;
      }

      const t = Number(telemetry.temp);
      const h = Number(telemetry.humid);
      const c = Number(telemetry.co2);
      const l = Number(telemetry.lux);

      // 3. ตรวจจับอุณหภูมิ (Temperature Alert Rules with Cooldown)
      if (now - lastAlertTimes.temp > COOLDOWN_MS) {
        if (t > targets.tempMax) {
          this.addNotif({
            title: '⚠️ อุณหภูมิสูงเกินกำหนด',
            desc: `อุณหภูมิปัจจุบัน ${t.toFixed(1)} °C สูงกว่าเกณฑ์ความปลอดภัย (${targets.tempMin} - ${targets.tempMax} °C)`,
            type: 'warning',
            meta: { metric: 'temp', val: t }
          });
          lastAlertTimes.temp = now;
        } else if (t < targets.tempMin) {
          this.addNotif({
            title: '❄️ อุณหภูมิต่ำกว่ากำหนด',
            desc: `อุณหภูมิปัจจุบัน ${t.toFixed(1)} °C ต่ำกว่าเกณฑ์ความปลอดภัย (${targets.tempMin} - ${targets.tempMax} °C)`,
            type: 'warning',
            meta: { metric: 'temp', val: t }
          });
          lastAlertTimes.temp = now;
        }
      }

      // 4. ตรวจจับความชื้น (Humidity Alert Rules with Cooldown)
      if (now - lastAlertTimes.humid > COOLDOWN_MS) {
        if (h < targets.humidMin) {
          this.addNotif({
            title: '💧 ความชื้นในอากาศต่ำเกินไป',
            desc: `ความชื้นปัจจุบัน ${h.toFixed(1)} % ต่ำกว่าเกณฑ์ที่กำหนด (${targets.humidMin} - ${targets.humidMax} %) แนะนำเปิดหัวพ่นหมอก`,
            type: 'warning',
            meta: { metric: 'humid', val: h }
          });
          lastAlertTimes.humid = now;
        } else if (h > targets.humidMax) {
          this.addNotif({
            title: '🌧️ ความชื้นในอากาศสูงเกินไป',
            desc: `ความชื้นปัจจุบัน ${h.toFixed(1)} % สูงกว่าเกณฑ์ที่กำหนด (${targets.humidMin} - ${targets.humidMax} %) แนะนำเปิดพัดลมระบายอากาศ`,
            type: 'warning',
            meta: { metric: 'humid', val: h }
          });
          lastAlertTimes.humid = now;
        }
      }

      // 5. ตรวจจับคาร์บอนไดออกไซด์ (CO2 Alert Rules with Cooldown)
      if (c && now - lastAlertTimes.co2 > COOLDOWN_MS) {
        if (c > targets.co2Max) {
          this.addNotif({
            title: '⚠️ ปริมาณก๊าซ CO₂ สูงเกินเกณฑ์',
            desc: `ระดับคาร์บอนไดออกไซด์ ${c} ppm สูงกว่าเกณฑ์ความปลอดภัย (< ${targets.co2Max} ppm) ควรระบายอากาศ`,
            type: 'warning',
            meta: { metric: 'co2', val: c }
          });
          lastAlertTimes.co2 = now;
        }
      }

      // 6. ตรวจจับแสงสว่าง (Lux Alert Rules with Cooldown)
      if (l !== null && l !== undefined && now - lastAlertTimes.lux > COOLDOWN_MS) {
        if (l < targets.luxMin) {
          this.addNotif({
            title: '💡 ระดับแสงสว่างต่ำกว่าเกณฑ์',
            desc: `ความสว่างปัจจุบัน ${l} lux ต่ำกว่าเกณฑ์มาตรฐาน (${targets.luxMin} - ${targets.luxMax} lux)`,
            type: 'warning',
            meta: { metric: 'lux', val: l }
          });
          lastAlertTimes.lux = now;
        }
      }
    },

    /**
     * ตรวจสอบความพร้อมของ Web Push บนอุปกรณ์ปัจจุบัน
     */
    isPushSupported() {
      return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
    },

    /**
     * ดึง Push Subscription ปัจจุบัน
     */
    async getPushSubscription() {
      if (!this.isPushSupported()) return null;
      try {
        const reg = await navigator.serviceWorker.ready;
        return await reg.pushManager.getSubscription();
      } catch (e) {
        console.warn('[WebPush] Error getting subscription:', e);
        return null;
      }
    },

    /**
     * สมัครรับการแจ้งเตือนระดับ OS (Web Push Subscription)
     */
    async subscribePush() {
      if (!this.isPushSupported()) {
        alert('เบราว์เซอร์นี้ยังไม่รองรับระบบ Web Push หรือคุณกำลังเปิดในโหมดที่ไม่รองรับ');
        return false;
      }

      try {
        // ขอสิทธิ์ผู้ใช้
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          alert('คุณได้ปฏิเสธสิทธิ์การแจ้งเตือน กรุณาเปิดอนุญาตในการตั้งค่าเบราว์เซอร์เพื่อรับการแจ้งเตือนบนหน้าจอล็อค');
          this.updatePushCardUI();
          return false;
        }

        // ดึงกุญแจสาธารณะ VAPID จากเซิร์ฟเวอร์
        const keyUrl = resolveApiUrl('/api/push/vapid-public-key');
        const keyRes = await fetch(keyUrl);
        if (!keyRes.ok) {
          throw new Error('ไม่สามารถดึงกุญแจ VAPID จากเซิร์ฟเวอร์ได้');
        }
        const keyData = await keyRes.json();
        const convertedKey = urlBase64ToUint8Array(keyData.publicKey);

        // สั่งเบราว์เซอร์ Subscribe ผ่าน Service Worker
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedKey
          });
        }

        // ส่ง Subscription บันทึกเข้าเซิร์ฟเวอร์
        const subUrl = resolveApiUrl('/api/push/subscribe');
        const postRes = await fetch(subUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub })
        });

        if (!postRes.ok) {
          throw new Error('บันทึกการสมัครรับแจ้งเตือนไปยังเซิร์ฟเวอร์ไม่สำเร็จ');
        }

        playAlertChime();
        showInAppToast('เปิดแจ้งเตือนสำเร็จ!', 'ระบบจะแจ้งเตือนบนหน้าจอมือถือของคุณทันทีที่มีเหตุการณ์วิกฤต', 'system');
        this.updatePushCardUI();
        return true;
      } catch (err) {
        console.error('[WebPush] Subscribe error:', err);
        alert('เกิดข้อผิดพลาดในการเปิดการแจ้งเตือน: ' + (err.message || err));
        this.updatePushCardUI();
        return false;
      }
    },

    /**
     * ยกเลิกการรับแจ้งเตือน
     */
    async unsubscribePush() {
      try {
        const sub = await this.getPushSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();

          const unsubUrl = resolveApiUrl('/api/push/unsubscribe');
          await fetch(unsubUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: endpoint })
          });
        }

        showInAppToast('ปิดการแจ้งเตือนแล้ว', 'อุปกรณ์นี้จะไม่ได้รับการแจ้งเตือนระดับ OS บนหน้าจอล็อค', 'message');
        this.updatePushCardUI();
        return true;
      } catch (err) {
        console.error('[WebPush] Unsubscribe error:', err);
        return false;
      }
    },

    /**
     * สลับสถานะเปิด-ปิดการแจ้งเตือน
     */
    async togglePush() {
      const sub = await this.getPushSubscription();
      if (sub && Notification.permission === 'granted') {
        if (confirm('คุณต้องการปิดการแจ้งเตือนบนหน้าจอมือถือใช่หรือไม่?')) {
          await this.unsubscribePush();
        }
      } else {
        await this.subscribePush();
      }
    },

    /**
     * ส่งแจ้งเตือนทดสอบ (เข้ามือถือทันที)
     */
    async sendTestPush() {
      playAlertChime();
      showInAppToast('🔔 ทดสอบการแจ้งเตือน IoT', 'ระบบแจ้งเตือนทำงานสมบูรณ์แล้ว!', 'system');

      try {
        const testUrl = resolveApiUrl('/api/push/test');
        const res = await fetch(testUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '🔔 ทดสอบระบบแจ้งเตือน IoT',
            body: 'การแจ้งเตือนผ่านหน้าจอมือถือพร้อมใช้งานเรียบร้อยแล้ว! ส่งตรงจากเซิร์ฟเวอร์คลาวด์'
          })
        });

        if (res.ok) {
          const data = await res.json();
          console.log('[WebPush] Test sent:', data);
        }
      } catch (e) {
        console.warn('[WebPush] Test server trigger error:', e);
      }

      this.addNotif({
        title: '🔔 ทดสอบการแจ้งเตือน IoT สำเร็จ',
        desc: 'ส่งสัญญาณทดสอบเข้าสู่อุปกรณ์เรียบร้อยแล้ว ตรวจสอบแถบแจ้งเตือนบนหน้าจอมือถือของคุณได้เลย',
        type: 'system',
        playSound: false,
        showToast: false
      });
    },

    /**
     * ซิงค์ประวัติแจ้งเตือนจากเซิร์ฟเวอร์ (ถ้ามี)
     */
    async syncServerNotifications() {
      try {
        const url = resolveApiUrl('/api/notifications');
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.notifications) && data.notifications.length > 0) {
            const localList = loadNotifs();
            const existingIds = new Set(localList.map(n => n.id));
            let hasNew = false;
            for (const sNotif of data.notifications) {
              if (!existingIds.has(sNotif.id)) {
                localList.unshift(sNotif);
                hasNew = true;
              }
            }
            if (hasNew) {
              saveNotifs(localList);
              this.render();
              this.updateBadges();
            }
          }
        }
      } catch (_) {}
    },

    /**
     * อัปเดตสถานะการ์ดเปิด-ปิดการแจ้งเตือนในแท็บแจ้งเตือน (#tab-notif)
     */
    async updatePushCardUI() {
      const statusPill = document.getElementById('notifSystemStatusBadge');
      const statusText = document.getElementById('notifStatusText');
      const toggleBtn = document.getElementById('btnTogglePushAlert');
      const testBtn = document.getElementById('btnTestPushAlert');
      const iosTip = document.getElementById('iosPushNoticeCard');

      const isSupported = this.isPushSupported();
      const permission = ('Notification' in window) ? Notification.permission : 'denied';
      const sub = await this.getPushSubscription();
      const isSubscribed = Boolean(sub && permission === 'granted');

      // ตรวจสอบว่าเป็น iOS ซาฟารีที่ยังไม่ได้ติดตั้ง PWA หรือไม่
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.navigator.standalone === true || 
                           window.matchMedia('(display-mode: standalone)').matches;

      if (iosTip) {
        if (isIOS && !isStandalone) {
          iosTip.style.display = 'block';
        } else {
          iosTip.style.display = 'none';
        }
      }

      if (statusPill && statusText) {
        if (isSubscribed) {
          statusPill.className = 'notif-status-pill online';
          statusText.textContent = 'เปิดแจ้งเตือนบนหน้าจอแล้ว ✅';
        } else if (permission === 'denied') {
          statusPill.className = 'notif-status-pill offline';
          statusText.textContent = 'ถูกบล็อกสิทธิ์ในเบราว์เซอร์ ❌';
        } else {
          statusPill.className = 'notif-status-pill offline';
          statusText.textContent = 'ยังไม่ได้เปิดแจ้งเตือนบนหน้าจอ';
        }
      }

      if (toggleBtn) {
        if (isSubscribed) {
          toggleBtn.textContent = 'ปิดการแจ้งเตือน';
          toggleBtn.className = 'btn-push-toggle active';
        } else {
          toggleBtn.textContent = 'เปิดการแจ้งเตือนบนหน้าจอมือถือ';
          toggleBtn.className = 'btn-push-toggle';
        }
      }

      if (testBtn) {
        testBtn.style.display = 'inline-flex';
      }
    },

    /**
     * เริ่มต้นระบบแจ้งเตือนเมื่อโหลดหน้าเว็บ
     */
    init() {
      this.render();
      this.updateBadges();
      this.updatePushCardUI();
      this.syncServerNotifications();

      // เมื่อ Service Worker พร้อมแล้ว ให้อัปเดต UI ซ้ำอีกรอบ
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(() => {
          this.updatePushCardUI();
        });
      }
    }
  };

  // Expose to Global Window
  window.IoTNotification = IoTNotification;
  window.playAlertChime = playAlertChime;
  window.showInAppToast = showInAppToast;

  // Backwards compatibility helpers
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

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => IoTNotification.init());
  } else {
    IoTNotification.init();
  }

})(window);
