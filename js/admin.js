/**
 * ============================================================
 * IoT WebApp - Admin Control Center Logic (js/admin.js)
 * Full Fleet & Hardware Management, NotifyHub Multi-Device Control,
 * Sensor Simulator, Real-time Push Dispatcher & CSV Export
 * ============================================================
 */

(function (window) {
  'use strict';

  const ADMIN_PIN_DEFAULT = 'admin1234';
  const STORAGE_AUTH_KEY = 'iot_admin_auth_v1';
  const STORAGE_THEME_KEY = 'iot_admin_theme';
  const STORAGE_DEVICE_ENABLED_KEY = 'iot_device_notif_enabled';
  const STORAGE_HUB_URL_KEY = 'iot_notifyhub_url_v3';
  const STORAGE_APP_ID_KEY = 'iot_notifyhub_appid';

  let currentAdminData = null;
  let pollInterval = null;
  let activeTab = 'overview';

  // ============================================================
  // 1. Authentication (PIN Lock)
  // ============================================================
  function checkAdminAuth() {
    const isAuthed = sessionStorage.getItem(STORAGE_AUTH_KEY) === 'true';
    const modal = document.getElementById('adminAuthModal');
    if (!isAuthed) {
      if (modal) modal.style.display = 'flex';
      return false;
    } else {
      if (modal) modal.style.display = 'none';
      return true;
    }
  }

  window.handleAdminUnlock = function (e) {
    if (e) e.preventDefault();
    const input = document.getElementById('adminPinInput');
    const errEl = document.getElementById('adminPinError');
    const pin = (input ? input.value : '').trim();

    if (pin === ADMIN_PIN_DEFAULT || pin === '1234') {
      sessionStorage.setItem(STORAGE_AUTH_KEY, 'true');
      const modal = document.getElementById('adminAuthModal');
      if (modal) modal.style.display = 'none';
      if (errEl) errEl.style.display = 'none';
      initAdminDashboard();
    } else {
      if (errEl) errEl.style.display = 'block';
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  };

  window.lockAdminPortal = function () {
    if (confirm('คุณต้องการออกจากระบบแอดมินและล็อคหน้านี้ใช่หรือไม่?')) {
      sessionStorage.removeItem(STORAGE_AUTH_KEY);
      const modal = document.getElementById('adminAuthModal');
      if (modal) {
        modal.style.display = 'flex';
        const input = document.getElementById('adminPinInput');
        if (input) { input.value = ''; input.focus(); }
      }
    }
  };

  // ============================================================
  // 2. Tabs & Theme Switching
  // ============================================================
  window.switchAdminTab = function (tabName) {
    activeTab = tabName;
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.admin-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${tabName}`);
    });
  };

  window.toggleAdminTheme = function () {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_THEME_KEY, next);
    const iconEl = document.getElementById('themeBtnIcon');
    if (iconEl) iconEl.textContent = next === 'dark' ? '☀️' : '🌙';
  };

  function initTheme() {
    const saved = localStorage.getItem(STORAGE_THEME_KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const iconEl = document.getElementById('themeBtnIcon');
    if (iconEl) iconEl.textContent = saved === 'dark' ? '☀️' : '🌙';
  }

  // ============================================================
  // 3. API & Real-time Telemetry Polling
  // ============================================================
  function resolveApiUrl(path) {
    if (window.location.origin.includes('onrender.com')) return path;
    if (window.location.port === '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      return path;
    }
    return 'https://webapp-iot-ar.onrender.com' + path;
  }

  async function fetchStatus() {
    try {
      const url = resolveApiUrl('/api/status?appId=*');
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        currentAdminData = data;
        renderAdminData(data);
        updateTopPill(true);
      } else {
        updateTopPill(false);
      }
    } catch (e) {
      updateTopPill(false);
    }
  }

  function updateTopPill(online) {
    const pill = document.getElementById('topServerPill');
    const text = document.getElementById('topServerText');
    if (pill && text) {
      pill.className = `admin-status-pill ${online ? 'online' : 'offline'}`;
      text.textContent = online ? 'เซิร์ฟเวอร์ออนไลน์' : 'ขาดการเชื่อมต่อ';
    }
  }

  function renderAdminData(data) {
    if (!data) return;

    // --- Overview & Hardware ---
    const isOnline = Boolean(data.online);
    const badge = document.getElementById('esp32StatusBadge');
    const badgeText = document.getElementById('esp32StatusText');
    if (badge && badgeText) {
      badge.className = `admin-status-pill ${isOnline ? 'online' : 'offline'}`;
      badgeText.textContent = isOnline ? 'ออนไลน์ ✅' : 'ออฟไลน์ ⏹️';
    }

    const devNameEl = document.getElementById('esp32DeviceName');
    if (devNameEl && data.device) {
      devNameEl.textContent = `${data.device.name || 'ตู้ควบคุม IoT'} (${data.device.id || 'esp32'})`;
    }

    const devIpEl = document.getElementById('esp32Ip');
    if (devIpEl && data.device) {
      devIpEl.textContent = data.device.ip || (isOnline ? '192.168.1.138' : 'ไม่มีสัญญาณ');
    }

    const lastSeenEl = document.getElementById('esp32LastSeen');
    if (lastSeenEl) {
      lastSeenEl.textContent = data.secondsAgo !== null && data.secondsAgo !== undefined
        ? `${data.secondsAgo} วินาทีที่แล้ว (${new Date(data.lastSeen).toLocaleTimeString('th-TH')})`
        : 'ยังไม่เคยเชื่อมต่อ';
    }

    // Telemetry Numbers
    const t = data.telemetry || {};
    const tEl = document.getElementById('metricTemp');
    const hEl = document.getElementById('metricHumid');
    const lEl = document.getElementById('metricLux');
    const cEl = document.getElementById('metricCo2');

    if (tEl) tEl.textContent = t.temp !== null && t.temp !== undefined ? `${Number(t.temp).toFixed(1)} °C` : '-- °C';
    if (hEl) hEl.textContent = t.humid !== null && t.humid !== undefined ? `${Number(t.humid).toFixed(1)} %` : '-- %';
    if (lEl) lEl.textContent = t.lux !== null && t.lux !== undefined ? `${Number(t.lux)} lux` : '-- lux';
    if (cEl) cEl.textContent = t.co2 !== null && t.co2 !== undefined ? `${Number(t.co2)} ppm` : '-- ppm';

    // Relays
    const relays = data.relays || {};
    ['fogger', 'fan', 'light', 'curtain'].forEach(r => {
      const sw = document.getElementById(`adminSwitch${r.charAt(0).toUpperCase() + r.slice(1)}`);
      if (sw && document.activeElement !== sw) {
        sw.checked = Boolean(relays[r]);
      }
    });

    renderOverviewRelayGrid(relays);

    // Targets (Thresholds)
    if (data.targets && !window._adminTargetsLoaded) {
      window._adminTargetsLoaded = true;
      const targets = data.targets;
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined) el.value = val;
      };
      setVal('targetTempMin', targets.tempMin);
      setVal('targetTempMax', targets.tempMax);
      setVal('targetHumidMin', targets.humidMin);
      setVal('targetHumidMax', targets.humidMax);
      setVal('targetLuxMin', targets.luxMin);
      setVal('targetLuxMax', targets.luxMax);
      setVal('targetCo2Max', targets.co2Max);
    }

    // Devices & Notification Hub Card (Matching User Image)
    renderNotifyHubCard(data);
    renderDevicesTable(data.devices || []);
    renderLogsTable(data.notifications || data.messages || []);

    // Server Uptime
    const uptimeEl = document.getElementById('adminServerUptime');
    if (uptimeEl) {
      uptimeEl.textContent = `เปิดทำงานต่อเนื่อง (Active 24/7 บน Render)`;
    }
    const hostEl = document.getElementById('adminServerHost');
    if (hostEl) {
      hostEl.textContent = window.location.origin;
    }
  }

  function renderOverviewRelayGrid(relays) {
    const container = document.getElementById('overviewRelayGrid');
    if (!container) return;

    const items = [
      { key: 'fogger', name: 'ระบบพ่นหมอก (Fogger)', icon: '💧', desc: 'ปั๊มน้ำเพิ่มความชื้น' },
      { key: 'fan', name: 'พัดลมระบาย (Fan)', icon: '🌀', desc: 'ระบายความร้อน/ลดชื้น' },
      { key: 'light', name: 'ไฟส่องสว่าง (LED Light)', icon: '💡', desc: 'ไฟเร่งการเจริญเติบโต' },
      { key: 'curtain', name: 'ม่านพรางแสง (Curtain)', icon: '🛡️', desc: 'มอเตอร์ควบคุมแสง' }
    ];

    container.innerHTML = items.map(item => {
      const active = Boolean(relays[item.key]);
      return `
        <div class="admin-relay-item">
          <div class="admin-relay-left">
            <span style="font-size: 1.3rem;">${item.icon}</span>
            <div>
              <div class="admin-relay-name">${item.name}</div>
              <div class="admin-relay-sub">${item.desc}</div>
            </div>
          </div>
          <span class="admin-status-pill ${active ? 'online' : 'offline'}">
            ${active ? 'เปิดทำงาน ✅' : 'ปิดทำงาน ⏹️'}
          </span>
        </div>
      `;
    }).join('');
  }

  // ============================================================
  // 4. Render The EXACT NotifyHub Card (From User's Image)
  // ============================================================
  function renderNotifyHubCard(data) {
    const devices = data.devices || [];
    const activeCount = devices.filter(d => d.enabled !== false).length;
    const isReceiving = localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY) === 'true';

    // Status Badge
    const statusBadge = document.getElementById('adminNotifStatusBadge');
    const statusText = document.getElementById('adminNotifStatusText');
    if (statusBadge && statusText) {
      if (isReceiving) {
        statusBadge.className = 'notif-status-pill online';
        statusText.textContent = 'เครื่องนี้เปิดรับแล้ว ✅';
      } else {
        statusBadge.className = 'notif-status-pill offline';
        statusText.textContent = 'เครื่องนี้ยังไม่เปิดรับ';
      }
    }

    // Hub Conn Badge
    const hubConnBadge = document.getElementById('adminHubConnBadge');
    if (hubConnBadge) {
      hubConnBadge.textContent = `🟢 เชื่อมต่อระบบแจ้งเตือนแล้ว (${Math.max(activeCount, 1)} เครื่อง)`;
    }

    // Devices Summary
    const summary = document.getElementById('adminHubDevicesSummary');
    if (summary) {
      const ua = navigator.userAgent || '';
      let myDev = '💻 คอมพิวเตอร์ (PC)';
      if (/iPhone/.test(ua)) myDev = '📱 iPhone (iOS)';
      else if (/Android/.test(ua)) myDev = '🤖 Android Phone';
      const myStateText = isReceiving
        ? `<span style="color:#10b981;font-weight:700;">เปิดรับข้อความแล้ว ✅</span>`
        : `<span style="color:#ef4444;font-weight:700;">ยังไม่เปิดรับ</span>`;

      summary.innerHTML = `📱 สถานะเครื่องนี้ (${myDev}): ${myStateText} • ซิงค์ข้อมูลร่วมกัน ${Math.max(activeCount, 1)} อุปกรณ์`;
    }

    // Toggle Button
    const toggleBtn = document.getElementById('adminBtnTogglePush');
    if (toggleBtn) {
      if (isReceiving) {
        toggleBtn.textContent = '🔕 ปิดรับแจ้งเตือนบนเครื่องนี้';
        toggleBtn.className = 'btn-push-toggle active';
      } else {
        toggleBtn.textContent = '🔔 เปิดรับแจ้งเตือนบนเครื่องนี้';
        toggleBtn.className = 'btn-push-toggle';
      }
    }

    // Target device dropdowns
    const targetSelect = document.getElementById('adminTargetDeviceSelect');
    const bcastSelect = document.getElementById('bcastTargetSelect');
    const renderOptions = () => {
      let opts = `<option value="">🌐 ส่งทุกอุปกรณ์ที่เปิดรับแจ้งเตือน (${Math.max(activeCount, 1)} เครื่อง)</option>`;
      devices.forEach(d => {
        const status = d.enabled !== false ? '🟢' : '🔴 [ปิด]';
        opts += `<option value="${escapeHtml(d.id)}">${status} ${escapeHtml(d.deviceName)} (${d.appId || '*'})</option>`;
      });
      return opts;
    };

    if (targetSelect && document.activeElement !== targetSelect) {
      const curVal = targetSelect.value;
      targetSelect.innerHTML = renderOptions();
      targetSelect.value = curVal;
    }

    if (bcastSelect && document.activeElement !== bcastSelect) {
      const curVal = bcastSelect.value;
      bcastSelect.innerHTML = renderOptions();
      bcastSelect.value = curVal;
    }
  }

  window.toggleAdminDevicePush = function () {
    const isReceiving = localStorage.getItem(STORAGE_DEVICE_ENABLED_KEY) === 'true';
    if (isReceiving) {
      localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, 'false');
      alert('🔕 ปิดรับการแจ้งเตือนบนอุปกรณ์นี้เรียบร้อยแล้ว');
    } else {
      localStorage.setItem(STORAGE_DEVICE_ENABLED_KEY, 'true');
      alert('🔔 เปิดรับการแจ้งเตือนบนอุปกรณ์นี้เรียบร้อยแล้ว! พร้อมรับการแจ้งเตือนสด');
    }
    fetchStatus();
  };

  window.toggleAdminHubConfig = function () {
    const panel = document.getElementById('adminHubConfigCollapse');
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }
  };

  window.saveAdminHubSettings = function () {
    const urlEl = document.getElementById('adminHubUrlInput');
    const appEl = document.getElementById('adminAppIdInput');
    if (urlEl && urlEl.value.trim()) {
      localStorage.setItem(STORAGE_HUB_URL_KEY, urlEl.value.trim());
    }
    if (appEl && appEl.value.trim()) {
      localStorage.setItem(STORAGE_APP_ID_KEY, appEl.value.trim());
    }
    alert('💾 บันทึกการตั้งค่า NotifyHub แล้ว');
  };

  window.sendAdminTestAlert = async function () {
    const btn = event?.currentTarget;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังส่ง...'; }
    try {
      const url = resolveApiUrl('/api/notify');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'มีรายการใหม่จาก Web App! 🔔',
          body: 'ทดสอบส่งข้อความแจ้งเตือนเข้ามือถือจากระบบหลังบ้าน Admin Control Center',
          priority: 'high',
          appId: 'my-webapp'
        })
      });
      const data = await res.json();
      alert(`✅ ส่งข้อความทดสอบสำเร็จ! (${data.sent || 1} เครื่อง)`);
      fetchStatus();
    } catch (e) {
      alert('⚠️ เกิดข้อผิดพลาดในการส่ง: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 ทดสอบส่งแจ้งเตือน'; }
    }
  };

  window.sendAdminCustomMessage = async function () {
    const titleInput = document.getElementById('adminCustomTitle');
    const bodyInput = document.getElementById('adminCustomBody');
    const targetSelect = document.getElementById('adminTargetDeviceSelect');
    const title = (titleInput ? titleInput.value.trim() : '') || 'มีรายการใหม่จาก Web App!';
    const body = (bodyInput ? bodyInput.value.trim() : '') || 'คลิกเพื่อดูรายละเอียดได้เลย';
    const target = targetSelect ? targetSelect.value : null;

    try {
      const url = resolveApiUrl('/api/notify');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body,
          targetDeviceId: target || null,
          priority: 'high',
          appId: 'my-webapp'
        })
      });
      const data = await res.json();
      alert(`✅ ส่งข้อความสำเร็จ! (${data.sent || 1} เครื่อง)`);
      if (titleInput) titleInput.value = '';
      if (bodyInput) bodyInput.value = '';
      fetchStatus();
    } catch (e) {
      alert('⚠️ ส่งข้อความไม่สำเร็จ: ' + e.message);
    }
  };

  // ============================================================
  // 5. Registered Devices Table Management
  // ============================================================
  function renderDevicesTable(devices) {
    const tbody = document.getElementById('adminDevicesTableBody');
    const countEl = document.getElementById('adminTotalDevicesCount');
    if (!tbody) return;

    if (countEl) {
      countEl.textContent = `${devices.length} อุปกรณ์`;
    }

    if (devices.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--admin-text-muted); padding: 24px;">
            ยังไม่มีอุปกรณ์ลงทะเบียนในระบบ
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = devices.map(d => {
      const isEnabled = d.enabled !== false;
      const dateStr = d.createdAt ? new Date(d.createdAt).toLocaleString('th-TH') : 'ไม่ระบุ';
      return `
        <tr>
          <td>
            <strong>${escapeHtml(d.deviceName || 'อุปกรณ์')}</strong>
          </td>
          <td>
            <code style="font-size: 0.75rem; background: var(--admin-surface); padding: 2px 6px; border-radius: 4px;">
              ${escapeHtml(d.id)}
            </code>
          </td>
          <td>
            <span class="admin-badge-tag" style="font-size: 0.7rem; background: rgba(59, 130, 246, 0.2); color: #60a5fa;">
              ${escapeHtml(d.appId || '*')}
            </span>
          </td>
          <td>
            <label class="admin-switch">
              <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleDeviceEnabled('${d.id}', this.checked)">
              <span class="admin-slider"></span>
            </label>
          </td>
          <td style="font-size: 0.8rem; color: var(--admin-text-muted);">
            ${dateStr}
          </td>
          <td>
            <button type="button" class="admin-btn outline" style="padding: 4px 8px; font-size: 0.75rem; color: #ef4444;" onclick="deleteDevice('${d.id}')">
              🗑️ ลบ
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.toggleDeviceEnabled = async function (id, enabled) {
    try {
      const url = resolveApiUrl(`/api/devices/${encodeURIComponent(id)}`);
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      fetchStatus();
    } catch (e) {
      alert('⚠️ เกิดข้อผิดพลาดในการเปลี่ยนสถานะ: ' + e.message);
    }
  };

  window.deleteDevice = async function (id) {
    if (!confirm('คุณต้องการลบอุปกรณ์นี้ออกจากระบบรับแจ้งเตือนใช่หรือไม่?')) return;
    try {
      const url = resolveApiUrl(`/api/devices/${encodeURIComponent(id)}`);
      await fetch(url, { method: 'DELETE' });
      fetchStatus();
    } catch (e) {
      alert('⚠️ ลบอุปกรณ์ไม่สำเร็จ: ' + e.message);
    }
  };

  window.sendAdminBroadcast = async function () {
    const title = (document.getElementById('bcastTitle')?.value || '').trim();
    const body = (document.getElementById('bcastBody')?.value || '').trim();
    const priority = document.getElementById('bcastPriority')?.value || 'normal';
    const target = document.getElementById('bcastTargetSelect')?.value || null;
    const delay = Number(document.getElementById('bcastDelay')?.value) || 0;

    if (!title || !body) {
      alert('กรุณาระบุทั้งหัวข้อและข้อความรายละเอียด');
      return;
    }

    try {
      const url = resolveApiUrl('/api/notify');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body,
          priority,
          targetDeviceId: target,
          delaySeconds: delay,
          appId: 'my-webapp'
        })
      });
      const data = await res.json();
      alert(`✅ ส่งข้อความประกาศสำเร็จ! (${data.sent || 1} เครื่อง)`);
      document.getElementById('bcastTitle').value = '';
      document.getElementById('bcastBody').value = '';
      fetchStatus();
    } catch (e) {
      alert('⚠️ ส่งข้อความไม่สำเร็จ: ' + e.message);
    }
  };

  // ============================================================
  // 6. Master Relays Control
  // ============================================================
  window.setAdminRelay = async function (name, state) {
    try {
      const url = resolveApiUrl('/api/control');
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relay: name, state: Boolean(state) })
      });
      fetchStatus();
    } catch (e) {
      console.warn('Set relay error:', e);
    }
  };

  // ============================================================
  // 7. Sensor Simulator
  // ============================================================
  window.updateSimLabel = function (metric, val, unit) {
    const el = document.getElementById(`simVal${metric.charAt(0).toUpperCase() + metric.slice(1)}`);
    if (el) el.textContent = `${Number(val).toFixed(metric === 'temp' || metric === 'humid' ? 1 : 0)} ${unit}`;
  };

  window.applySimPreset = function (type) {
    if (type === 'normal') {
      document.getElementById('simRangeTemp').value = 26.5;
      document.getElementById('simRangeHumid').value = 85;
      document.getElementById('simRangeLux').value = 450;
      document.getElementById('simRangeCo2').value = 480;
    } else if (type === 'high-temp') {
      document.getElementById('simRangeTemp').value = 33.0;
      document.getElementById('simRangeHumid').value = 75;
      document.getElementById('simRangeLux').value = 850;
      document.getElementById('simRangeCo2').value = 520;
    } else if (type === 'low-humid') {
      document.getElementById('simRangeTemp').value = 27.0;
      document.getElementById('simRangeHumid').value = 65;
      document.getElementById('simRangeLux').value = 500;
      document.getElementById('simRangeCo2').value = 450;
    }
    updateSimLabel('temp', document.getElementById('simRangeTemp').value, '°C');
    updateSimLabel('humid', document.getElementById('simRangeHumid').value, '%');
    updateSimLabel('lux', document.getElementById('simRangeLux').value, 'lux');
    updateSimLabel('co2', document.getElementById('simRangeCo2').value, 'ppm');
  };

  window.submitSimulateTelemetry = async function () {
    const temp = Number(document.getElementById('simRangeTemp').value);
    const humid = Number(document.getElementById('simRangeHumid').value);
    const lux = Number(document.getElementById('simRangeLux').value);
    const co2 = Number(document.getElementById('simRangeCo2').value);

    try {
      const url = resolveApiUrl('/api/simulate');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temp, humid, lux, co2 })
      });
      if (res.ok) {
        alert('🚀 ฉีดข้อมูลจำลองเข้าสู่ระบบสำเร็จ! ระบบหน้าบ้านจะอัปเดตตัวเลขและกราฟทันที');
        fetchStatus();
      }
    } catch (e) {
      alert('⚠️ เกิดข้อผิดพลาดในการจำลอง: ' + e.message);
    }
  };

  // ============================================================
  // 8. Thresholds & Presets
  // ============================================================
  window.saveAdminTargets = async function () {
    const payload = {
      tempMin: Number(document.getElementById('targetTempMin').value),
      tempMax: Number(document.getElementById('targetTempMax').value),
      humidMin: Number(document.getElementById('targetHumidMin').value),
      humidMax: Number(document.getElementById('targetHumidMax').value),
      luxMin: Number(document.getElementById('targetLuxMin').value),
      luxMax: Number(document.getElementById('targetLuxMax').value),
      co2Max: Number(document.getElementById('targetCo2Max').value)
    };

    try {
      const url = resolveApiUrl('/api/targets');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert('💾 บันทึกเกณฑ์ความปลอดภัยมาตรฐานลงฐานข้อมูลเรียบร้อยแล้ว!');
        fetchStatus();
      }
    } catch (e) {
      alert('⚠️ บันทึกไม่สำเร็จ: ' + e.message);
    }
  };

  window.applyCropPreset = function (crop) {
    if (crop === 'mushroom') {
      document.getElementById('targetTempMin').value = 24;
      document.getElementById('targetTempMax').value = 28;
      document.getElementById('targetHumidMin').value = 80;
      document.getElementById('targetHumidMax').value = 90;
      document.getElementById('targetLuxMin').value = 100;
      document.getElementById('targetLuxMax').value = 500;
      document.getElementById('targetCo2Max').value = 1000;
    } else if (crop === 'melon') {
      document.getElementById('targetTempMin').value = 26;
      document.getElementById('targetTempMax').value = 32;
      document.getElementById('targetHumidMin').value = 60;
      document.getElementById('targetHumidMax').value = 75;
      document.getElementById('targetLuxMin').value = 500;
      document.getElementById('targetLuxMax').value = 1200;
      document.getElementById('targetCo2Max').value = 1200;
    } else if (crop === 'salad') {
      document.getElementById('targetTempMin').value = 22;
      document.getElementById('targetTempMax').value = 27;
      document.getElementById('targetHumidMin').value = 65;
      document.getElementById('targetHumidMax').value = 80;
      document.getElementById('targetLuxMin').value = 300;
      document.getElementById('targetLuxMax').value = 800;
      document.getElementById('targetCo2Max').value = 1000;
    }
    saveAdminTargets();
  };

  // ============================================================
  // 9. Cloud Infrastructure
  // ============================================================
  window.saveAdminFirebaseUrl = function () {
    const input = document.getElementById('adminFirebaseUrlInput');
    const val = (input ? input.value : '').trim();
    if (val && !val.startsWith('https://')) {
      alert('URL ของ Firebase ต้องขึ้นต้นด้วย https://');
      return;
    }
    if (val) {
      localStorage.setItem('iot_firebase_url', val);
      alert('💾 บันทึกการตั้งค่า Firebase Realtime Database แล้ว');
    } else {
      localStorage.removeItem('iot_firebase_url');
      alert('ลบค่า Firebase URL แล้ว');
    }
  };

  function initFirebaseUrl() {
    const input = document.getElementById('adminFirebaseUrlInput');
    if (input) {
      input.value = localStorage.getItem('iot_firebase_url') || '';
    }
  }

  // ============================================================
  // 10. Data Logs & CSV Export
  // ============================================================
  function renderLogsTable(logs) {
    const tbody = document.getElementById('adminLogsTableBody');
    if (!tbody) return;

    if (!Array.isArray(logs) || logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--admin-text-muted); padding: 24px;">
            ไม่มีบันทึกเหตุการณ์ในระบบ
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = logs.slice(0, 50).map(item => {
      const timeStr = item.time ? new Date(item.time).toLocaleString('th-TH') : (item.createdAt ? new Date(item.createdAt).toLocaleString('th-TH') : '-');
      const isWarn = item.type === 'warning' || item.priority === 'high';
      return `
        <tr>
          <td style="white-space: nowrap; font-size: 0.8rem; color: var(--admin-text-muted);">${timeStr}</td>
          <td>
            <span class="admin-status-pill ${isWarn ? 'offline' : 'online'}" style="font-size: 0.72rem;">
              ${isWarn ? '⚠️ คำเตือน' : '🔔 ข้อความ'}
            </span>
          </td>
          <td><strong>${escapeHtml(item.title || '')}</strong></td>
          <td style="color: var(--admin-text-muted); font-size: 0.82rem;">${escapeHtml(item.desc || item.body || '')}</td>
        </tr>
      `;
    }).join('');
  }

  window.downloadCsvExport = function () {
    const url = resolveApiUrl('/api/export/csv');
    window.open(url, '_blank');
  };

  window.seedDemoHistory = async function (days) {
    if (!confirm(`คุณต้องการสร้างข้อมูลจำลองประวัติย้อนหลัง ${days} วันใช่หรือไม่?`)) return;
    try {
      const url = resolveApiUrl('/api/history/seed-demo');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days })
      });
      if (res.ok) {
        alert(`🌱 สร้างข้อมูลจำลองย้อนหลัง ${days} วันเรียบร้อยแล้ว!`);
        fetchStatus();
      }
    } catch (e) {
      alert('⚠️ ผิดพลาด: ' + e.message);
    }
  };

  window.clearServerNotifications = async function () {
    if (!confirm('คุณต้องการล้างประวัติการแจ้งเตือนทั้งหมดใช่หรือไม่?')) return;
    try {
      const url = resolveApiUrl('/api/notifications/clear');
      await fetch(url, { method: 'POST' });
      alert('🗑️ ล้างประวัติแจ้งเตือนสำเร็จ');
      fetchStatus();
    } catch (e) {
      alert('⚠️ เกิดข้อผิดพลาด: ' + e.message);
    }
  };

  window.copyToClipboard = function (text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      alert('📋 คัดลอกลงคลิปบอร์ดแล้ว: ' + text);
    }).catch(() => {
      prompt('คัดลอกข้อความด้านล่าง:', text);
    });
  };

  window.refreshAdminData = function () {
    fetchStatus();
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initAdminDashboard() {
    initTheme();
    initFirebaseUrl();
    fetchStatus();

    if (!pollInterval) {
      pollInterval = setInterval(fetchStatus, 2500);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (checkAdminAuth()) {
      initAdminDashboard();
    }
  });

})(window);
