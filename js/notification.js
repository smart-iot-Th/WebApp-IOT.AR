/**
 * ===================================================================
 * IoT Notification Module (Built-in Web App Notification & Sound System)
 * ขับเคลื่อนด้วย NotifyModel (sdk/notify-model.js)
 * - ระบบเสียงเตือนอัจฉริยะในตัว Web App (Web Audio Synthesizer)
 * - ระบบแจ้งเตือนหน้าจอล็อค (Service Worker & Web Push)
 * - ซิงค์รายชื่ออุปกรณ์และสถานะเปิด/ปิดรับแจ้งเตือนกับหน้าหลังบ้าน (admin.html) อัตโนมัติ
 * ===================================================================
 */

(function (window) {
  'use strict';

  const STORAGE_KEY = 'smartfarm_notifs';
  const STORAGE_HUB_URL_KEY = 'iot_notifyhub_url_v3';
  const CLOUD_RENDER_HUB = 'https://webapp-iot-ar.onrender.com';
  const DEFAULT_APP_ID = 'my-webapp';
  const COOLDOWN_MS = 5 * 60 * 1000;

  let currentFilter = 'all';
  let initialServerSyncDone = false;
  const pageLoadTime = Date.now();

  const lastAlertTimes = {
    temp: 0,
    humid: 0,
    co2: 0,
    lux: 0
  };
  let lastOnlineState = null;
  const lastRelayStates = {
    fogger: null,
    fan: null,
    light: null,
    curtain: null
  };

  function getHubUrl() {
    const saved = localStorage.getItem(STORAGE_HUB_URL_KEY);
    if (saved && saved.startsWith('http') && !saved.includes('trycloudflare.com')) {
      return saved.replace(/\/+$/, '');
    }
    if (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.origin.includes('onrender.com')
    ) {
      return window.location.origin;
    }
    return CLOUD_RENDER_HUB;
  }

  function getNotifyModel() {
    const hubUrl = getHubUrl();
    if (!window.notifyModelInstance) {
      window.notifyModelInstance = new window.NotifyModel({
        hubUrl,
        appId: DEFAULT_APP_ID,
        appName: 'IoT WebApp',
        swPath: './sw.js'
      });
    } else {
      window.notifyModelInstance.hubUrl = hubUrl;
    }
    return window.notifyModelInstance;
  }

  function loadNotifs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveNotifs(list) {
    try {
      const trimmed = list.slice(0, 100);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch (_) {
      return list;
    }
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

    if (d.toDateString() === new Date().toDateString()) return `วันนี้ ${timeStr}`;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `เมื่อวาน ${timeStr}`;

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month} ${timeStr}`;
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
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
    }

    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  }

  const IoTNotification = {
    getHubUrl,

    getAll() {
      return loadNotifs();
    },

    getUnreadCount() {
      return loadNotifs().filter(item => !item.read).length;
    },

    addNotif({
      id = null,
      title,
      desc,
      type = 'warning',
      time = null,
      meta = {},
      sendToHub = true,
      playSound = false
    }) {
      if (!title) return null;

      const cleanDesc = window.NotifyModel && window.NotifyModel.parseTargetTag
        ? window.NotifyModel.parseTargetTag(desc || '').cleanBody
        : (desc || '');

      const list = loadNotifs();
      const itemId = id || ('notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));

      if (id && list.some(item => item.id === id)) {
        return null;
      }

      const newItem = {
        id: itemId,
        title,
        desc: cleanDesc,
        type,
        time: time || Date.now(),
        read: false,
        meta
      };

      list.unshift(newItem);
      saveNotifs(list);

      const model = getNotifyModel();

      if (playSound) {
        model.playAlertSound(type === 'warning' ? 'high' : 'normal');
      }

      if (sendToHub) {
        model.send({
          appId: DEFAULT_APP_ID,
          title,
          body: cleanDesc || 'คลิกเพื่อดูรายละเอียดได้เลย',
          priority: type === 'warning' ? 'high' : 'normal',
          data: meta
        }).catch(() => {});
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
        sendToHub: false
      });
    },

    markAsRead(id) {
      const updated = loadNotifs().map(item => item.id === id ? { ...item, read: true } : item);
      saveNotifs(updated);
      this.render();
      this.updateBadges();
    },

    markAllAsRead() {
      const updated = loadNotifs().map(item => ({ ...item, read: true }));
      saveNotifs(updated);
      this.render();
      this.updateBadges();
    },

    deleteItem(id) {
      const updated = loadNotifs().filter(item => item.id !== id);
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
      document.querySelectorAll('.filter-pill').forEach(pill => {
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
            <div style="font-size: 0.8rem;">ระบบจะบันทึกประวัติอัตโนมัติเมื่อเกิดเหตุการณ์หรือรับข้อความแจ้งเตือน</div>
          </div>
        `;
        return;
      }

      container.innerHTML = filtered.map(item => {
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
          typeBadgeLabel = (item.meta && item.meta.appName) ? item.meta.appName : 'ข้อความ';
        }

        const cleanDesc = window.NotifyModel && window.NotifyModel.parseTargetTag
          ? window.NotifyModel.parseTargetTag(item.desc || '').cleanBody
          : (item.desc || '');

        return `
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

            <p class="notif-desc">${escapeHtml(cleanDesc)}</p>
          </div>
        `;
      }).join('');
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
        this.addNotif({
          title: isOnline ? 'ESP32 เชื่อมต่อสำเร็จ (ออนไลน์)' : 'ESP32 ขาดการเชื่อมต่อ (ออฟไลน์)',
          desc: isOnline
            ? `บอร์ด ${data.device?.name || 'ESP32'} เริ่มต้นส่งข้อมูลเซนเซอร์เข้าสู่ระบบเรียบร้อยแล้ว`
            : 'ไม่ได้รับสัญญาณจากบอร์ดเกิน 25 วินาที ระบบเปลี่ยนเป็นสถานะออฟไลน์',
          type: isOnline ? 'system' : 'warning',
          meta: { event: isOnline ? 'online' : 'offline' }
        });
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
              meta: { relay: k, state: relays[k] },
              sendToHub: false
            });
          }
          if (relays[k] !== undefined) {
            lastRelayStates[k] = relays[k];
          }
        });
      }

      if (!isOnline || telemetry.temp === null || telemetry.temp === undefined) return;

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

      if (c && now - lastAlertTimes.co2 > COOLDOWN_MS && c > targets.co2Max) {
        this.addNotif({
          title: '⚠️ ปริมาณก๊าซ CO₂ สูงเกินเกณฑ์!',
          desc: `ระดับคาร์บอนไดออกไซด์ ${c} ppm สูงกว่าเกณฑ์ความปลอดภัย (< ${targets.co2Max} ppm) ควรระบายอากาศ`,
          type: 'warning',
          meta: { metric: 'co2', val: c }
        });
        lastAlertTimes.co2 = now;
      }

      if (l !== null && l !== undefined && now - lastAlertTimes.lux > COOLDOWN_MS && l < targets.luxMin) {
        this.addNotif({
          title: '💡 ระดับแสงสว่างต่ำกว่าเกณฑ์!',
          desc: `ความสว่างปัจจุบัน ${l} lux ต่ำกว่าเกณฑ์มาตรฐาน (${targets.luxMin} - ${targets.luxMax} lux)`,
          type: 'warning',
          meta: { metric: 'lux', val: l }
        });
        lastAlertTimes.lux = now;
      }
    },

    /**
     * สลับเปิด/ปิดรับแจ้งเตือนและเสียงเตือนในตัว Web App บนเครื่องนี้
     * พร้อมลงทะเบียนอุปกรณ์เข้าสู่หน้าหลังบ้าน (Admin Control Center) ทันที
     */
    async togglePush() {
      const btn = document.getElementById('btnTogglePushAlert');
      const model = getNotifyModel();

      try {
        if (btn) btn.disabled = true;
        const subscribed = await model.isSubscribed();

        if (subscribed) {
          if (confirm('เครื่องนี้เปิดรับแจ้งเตือนอยู่แล้ว ต้องการปิดรับการแจ้งเตือนและเสียงเตือนบนเครื่องนี้หรือไม่?')) {
            await model.unsubscribe();
          }
        } else {
          const result = await model.subscribe({ appId: '*' });
          const devName = (result && result.device && result.device.deviceName) || model._detectDeviceName();

          this.addNotif({
            id: 'enable_' + Date.now(),
            title: '🔔 เปิดรับการแจ้งเตือน & เสียงเตือนสำเร็จ!',
            desc: `อุปกรณ์ ${devName} เชื่อมต่อกับระบบแจ้งเตือนในตัว Web App และซิงค์เข้ากับระบบหลังบ้านเรียบร้อยแล้ว`,
            type: 'system',
            sendToHub: false,
            playSound: false
          });

          await model.showLocalNotification(
            '🔔 เปิดรับการแจ้งเตือนสำเร็จ!',
            `อุปกรณ์ ${devName} พร้อมรับสัญญาณเตือนและเสียงเตือนใน Web App แล้ว`
          );
        }

        await this.updatePushCardUI();
      } catch (err) {
        alert('⚠️ ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    async updatePushCardUI() {
      const statusPill = document.getElementById('notifSystemStatusBadge');
      const statusText = document.getElementById('notifStatusText');
      const toggleBtn = document.getElementById('btnTogglePushAlert');
      const iosTip = document.getElementById('iosPushNoticeCard');

      const model = getNotifyModel();
      const support = model.checkSupport();
      const subscribed = await model.isSubscribed();

      if (iosTip) {
        iosTip.style.display = (!subscribed && support.needsHomeScreen) ? 'block' : 'none';
      }

      if (statusPill && statusText) {
        if (subscribed) {
          statusPill.className = 'notif-status-pill online';
          statusText.textContent = 'เครื่องนี้เปิดรับแล้ว ✅';
        } else {
          statusPill.className = 'notif-status-pill offline';
          statusText.textContent = 'เครื่องนี้ยังไม่เปิดรับ';
        }
      }

      if (toggleBtn) {
        if (subscribed) {
          toggleBtn.textContent = '🔕 ปิดรับแจ้งเตือนบนเครื่องนี้';
          toggleBtn.className = 'btn-push-toggle active';
        } else {
          toggleBtn.textContent = '🔔 เปิดรับแจ้งเตือนบนเครื่องนี้';
          toggleBtn.className = 'btn-push-toggle';
        }
      }
    },

    async ingestServerStatus(data) {
      const model = getNotifyModel();
      const myDeviceId = model.getDeviceId();

      if (data) {
        model.ingestCloudStatus(data);
      }
      await this.updatePushCardUI();

      const subscribed = await model.isSubscribed();

      const rawItems = [];
      if (data && Array.isArray(data.messages)) {
        data.messages.forEach(m => {
          rawItems.push({
            rawId: String(m.id),
            title: m.title || 'แจ้งเตือนใหม่',
            rawBody: m.body || '',
            type: (m.data && m.data.type) ? m.data.type : (m.priority === 'high' ? 'warning' : 'message'),
            time: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
            targetDeviceId: m.targetDeviceId || (m.data && m.data.targetDeviceId) || null,
            meta: {
              ...(m.data || {}),
              appId: m.appId,
              appName: m.appName || m.appId || 'IoT WebApp'
            }
          });
        });
      }

      if (data && Array.isArray(data.notifications)) {
        data.notifications.forEach(n => {
          rawItems.push({
            rawId: String(n.id),
            title: n.title || 'แจ้งเตือนใหม่',
            rawBody: n.desc || n.body || '',
            type: n.type || 'message',
            time: n.time || Date.now(),
            targetDeviceId: (n.meta && n.meta.targetDeviceId) || null,
            meta: n.meta || {}
          });
        });
      }

      const sharedMsgs = model.getSharedMessages();
      if (Array.isArray(sharedMsgs)) {
        sharedMsgs.forEach(m => {
          rawItems.push({
            rawId: String(m.id),
            title: m.title || 'แจ้งเตือนใหม่',
            rawBody: m.body || '',
            type: m.priority === 'high' ? 'warning' : 'message',
            time: m.time || (m.createdAt ? new Date(m.createdAt).getTime() : Date.now()),
            targetDeviceId: m.targetDeviceId || null,
            meta: { appId: m.appId, appName: m.appName || 'IoT WebApp' }
          });
        });
      }

      if (rawItems.length === 0) {
        initialServerSyncDone = true;
        return;
      }

      const incoming = rawItems
        .slice(0, 60)
        .map(item => {
          const parsed = window.NotifyModel.parseTargetTag(item.rawBody);
          return {
            id: item.rawId.startsWith('hub_') ? item.rawId : ('hub_' + item.rawId),
            rawId: item.rawId,
            title: item.title,
            desc: parsed.cleanBody,
            type: item.type,
            time: item.time,
            targetDeviceId: item.targetDeviceId || parsed.targetDeviceId || null,
            meta: item.meta
          };
        })
        .sort((a, b) => a.time - b.time);

      const localList = loadNotifs();
      const existingIds = new Set(localList.map(n => n.id));
      let hasNew = false;

      for (const item of incoming) {
        // กรองเฉพาะข้อความที่ส่งหาทุกเครื่อง หรือระบุตรงกับเครื่องนี้เท่านั้น
        if (item.targetDeviceId && item.targetDeviceId !== myDeviceId) {
          continue;
        }

        if (!existingIds.has(item.id)) {
          // ถ้าระบบบนเครื่องนี้ปิดรับแจ้งเตือนอยู่ และเป็นข้อความที่เพิ่งส่งมาใหม่ ไม่ต้องนำเข้า
          if (!subscribed && initialServerSyncDone) {
            continue;
          }

          localList.unshift({
            id: item.id,
            title: item.title,
            desc: item.desc,
            type: item.type,
            time: item.time,
            read: !initialServerSyncDone,
            meta: item.meta
          });
          existingIds.add(item.id);
          hasNew = true;

          // หากเครื่องนี้เปิดรับอยู่ และเป็นข้อความใหม่หลังจากเปิดหน้าเว็บ ให้เล่นเสียงเตือนในตัว Web App + เด้งแจ้งเตือนทันที
          const isRecent = item.time >= (pageLoadTime - 5000);
          if (subscribed && (initialServerSyncDone || isRecent) && !model._hasDelivered(item.rawId)) {
            model._markDelivered(item.rawId);
            model.playAlertSound(item.type === 'warning' ? 'high' : 'normal');
            await model.showLocalNotification(item.title, item.desc, { id: item.id });
          }
        }
      }

      initialServerSyncDone = true;

      if (hasNew) {
        saveNotifs(localList);
        this.render();
        this.updateBadges();
      }
    },

    async syncServerNotifications() {
      try {
        const res = await fetch(`${getHubUrl()}/api/status?appId=*`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          await this.ingestServerStatus(data);
        }
      } catch (_) {}
      await this.updatePushCardUI();
    },

    init() {
      const model = getNotifyModel();
      this.render();
      this.updateBadges();
      this.updatePushCardUI();
      this.syncServerNotifications();

      model.onMessage((evt) => {
        if (!evt) return;
        if (evt.type === 'REGISTRY_UPDATED') {
          this.updatePushCardUI();
        } else if (evt.type === 'NEW_MESSAGE' && evt.message) {
          const m = evt.message;
          this.addNotif({
            id: 'hub_' + m.id,
            title: m.title || 'แจ้งเตือนใหม่',
            desc: m.body || '',
            type: m.priority === 'high' ? 'warning' : 'message',
            meta: { appId: m.appId, appName: m.appName || 'IoT WebApp' },
            sendToHub: false,
            playSound: false
          });
        }
      });

      if ('serviceWorker' in navigator && !this._swBound) {
        this._swBound = true;
        navigator.serviceWorker.addEventListener('message', async (event) => {
          const msgData = event.data;
          if (msgData && msgData.type === 'NOTIFYHUB_PUSH_RECEIVED' && msgData.payload) {
            const p = msgData.payload;
            const subscribed = await model.isSubscribed();
            if (!subscribed) return;
            if (p.targetDeviceId && p.targetDeviceId !== model.getDeviceId()) return;

            const rawId = String(p.id || ('push_' + Date.now()));
            if (!model._hasDelivered(rawId)) {
              model._markDelivered(rawId);
              model.playAlertSound(p.priority === 'high' ? 'high' : 'normal');
            }

            this.addNotif({
              id: rawId.startsWith('hub_') ? rawId : ('hub_' + rawId),
              title: p.title || 'แจ้งเตือนใหม่',
              desc: p.body || '',
              type: p.priority === 'high' ? 'warning' : 'message',
              meta: { appId: p.appId, appName: p.appName },
              sendToHub: false,
              playSound: false
            });
          }
        });
      }
    }
  };

  window.IoTNotification = IoTNotification;
  window.filterNotifs = (cat) => IoTNotification.setFilter(cat);
  window.markAllNotifsAsRead = () => IoTNotification.markAllAsRead();
  window.clearAllNotifs = () => IoTNotification.clearAll();
  window.deleteNotif = (id) => IoTNotification.deleteItem(id);
  window.addCustomNotif = (title, desc, type, meta) => IoTNotification.addNotif({ title, desc, type, meta });
  window.togglePushAlert = () => IoTNotification.togglePush();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => IoTNotification.init());
  } else {
    IoTNotification.init();
  }
})(window);
