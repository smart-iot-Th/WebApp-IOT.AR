/**
 * ===================================================================
 * IoT Notification System Module (js/notification.js)
 * บริหารจัดการประวัติการแจ้งเตือน กฎตรวจจับค่าเซนเซอร์อัตโนมัติ 
 * และการส่งแจ้งเตือนโดยเฉพาะสำหรับ IoT WebApp
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

  // ติดตามเวลาการแจ้งเตือนล่าสุดเพื่อทำ Anti-Spam Cooldown
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
      // เก็บประวัติสูงสุด 100 รายการเพื่อไม่ให้เปลืองพื้นที่
      const trimmed = list.slice(0, 100);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch (e) {
      console.error('[Notification] Save error:', e);
      return list;
    }
  }

  /**
   * แปลง Timestamp เป็นข้อความเวลาที่อ่านง่าย
   */
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
   * ส่ง Push Notification เข้าสู่อุปกรณ์ (เมื่อได้รับสิทธิ์) โดยไม่มีปุ่มทดสอบ
   */
  function dispatchDevicePush(title, body, options = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, {
            body: body,
            icon: options.icon || './assets/icons/icon-192.png',
            badge: './assets/icons/icon.svg',
            vibrate: [200, 100, 200],
            data: { url: './index.html?tab=notif' }
          });
        });
      } else {
        new Notification(title, {
          body: body,
          icon: options.icon || './assets/icons/icon-192.png',
          badge: './assets/icons/icon.svg'
        });
      }
    } catch (e) {
      console.warn('[Notification] Dispatch push error:', e);
    }
  }

  /**
   * ไอคอนตามหมวดหมู่
   */
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
     * เพิ่มการแจ้งเตือนใหม่ (พร้อมบันทึกและเรนเดอร์ UI)
     */
    addNotif({ title, desc, type = 'warning', meta = {} }) {
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

      // ส่ง Push สู่ OS หากได้รับอนุญาต
      dispatchDevicePush(title, desc);

      // อัปเดต UI ทันที
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

      // อัปเดตสไตล์ปุ่ม Filter Pill
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

      // ป้ายแดงที่แถบ Navigation ล่าง
      const navBadge = document.getElementById('navNotifBadge');
      if (navBadge) {
        if (unreadCount > 0) {
          navBadge.style.display = 'flex';
          navBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
          navBadge.style.display = 'none';
        }
      }

      // ป้ายข้อความบนหัวแถบแจ้งเตือน
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

        // สีตามประเภท
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
            desc: `บอร์ด ${data.device?.name || 'ESP32'} เริ่มต้นส่งข้อมูลเซนเซอร์เข้าสู่ฐานข้อมูลเรียบร้อยแล้ว`,
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
     * บันทึกการเปลี่ยนแปลงการตั้งค่าเกณฑ์ (Configuration Event)
     */
    recordConfigChange(settingName, oldVal, newVal) {
      this.addNotif({
        title: `อัปเดตการตั้งค่า: ${settingName}`,
        desc: `เปลี่ยนเกณฑ์มาตรฐานจาก ${oldVal} เป็น ${newVal}`,
        type: 'message',
        meta: { setting: settingName, newVal: newVal }
      });
    },

    /**
     * เริ่มต้นระบบแจ้งเตือนเมื่อโหลดหน้าเว็บ
     */
    init() {
      this.render();
      this.updateBadges();

      // ขอสิทธิ์เบื้องหลังอย่างเงียบๆ ถ้าผู้ใช้เคยกดอนุญาตไว้
      if ('Notification' in window && Notification.permission === 'default') {
        // ไม่กวนใจผู้ใช้ จะขอเฉพาะเมื่อผู้ใช้ตอบรับ หรือปล่อยเป็น silent
      }
    }
  };

  // Expose to Global Window
  window.IoTNotification = IoTNotification;

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

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => IoTNotification.init());
  } else {
    IoTNotification.init();
  }

})(window);
