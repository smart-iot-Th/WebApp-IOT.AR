/**
 * ============================================================
 * IoT WebApp - Admin Control Center Logic (js/admin.js)
 * Powered by NotifyModel & NotifyEngine (Notification_system)
 * ============================================================
 */

(function (window) {
  'use strict';

  const ADMIN_PIN_DEFAULT = 'admin1234';
  const STORAGE_AUTH_KEY = 'iot_admin_auth_v1';
  const STORAGE_THEME_KEY = 'iot_admin_theme';
  const STORAGE_HUB_URL_KEY = 'iot_notifyhub_url_v3';
  const STORAGE_APP_ID_KEY = 'iot_notifyhub_appid';
  const CLOUD_RENDER_HUB = 'https://webapp-iot-ar.onrender.com';

  let currentAdminData = null;
  let pollInterval = null;
  let activeTab = 'overview';

  function getHubBaseUrl() {
    const input = document.getElementById('adminHubUrlInput');
    if (input && input.value.trim().startsWith('http') && document.activeElement === input) {
      return input.value.trim().replace(/\/+$/, '');
    }
    const saved = localStorage.getItem(STORAGE_HUB_URL_KEY);
    if (saved && saved.startsWith('http') && !saved.includes('trycloudflare.com')) {
      return saved.replace(/\/+$/, '');
    }
    if (window.location.hostname.includes('github.io')) {
      return CLOUD_RENDER_HUB;
    }
    return window.location.origin;
  }

  function getAppId() {
    return localStorage.getItem(STORAGE_APP_ID_KEY) || 'my-webapp';
  }

  function getAdminNotifyModel() {
    const hubUrl = getHubBaseUrl();
    const appId = getAppId();
    if (!window.adminNotifyInstance) {
      window.adminNotifyInstance = new window.NotifyModel({
        hubUrl,
        appId,
        appName: 'Web App ของฉัน',
        swPath: './sw.js'
      });
    } else {
      window.adminNotifyInstance.hubUrl = hubUrl;
      window.adminNotifyInstance.appId = appId;
    }
    return window.adminNotifyInstance;
  }

  function resolveApiUrl(path) {
    return getHubBaseUrl() + path;
  }

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
  async function fetchStatus() {
    try {
      const url = resolveApiUrl('/api/status?appId=*');
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        currentAdminData = data;
        await renderAdminData(data);
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

  async function renderAdminData(data) {
    if (!data) return;

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

    const t = data.telemetry || {};
    const tEl = document.getElementById('metricTemp');
    const hEl = document.getElementById('metricHumid');
    const lEl = document.getElementById('metricLux');
    const cEl = document.getElementById('metricCo2');

    if (tEl) tEl.textContent = t.temp !== null && t.temp !== undefined ? `${Number(t.temp).toFixed(1)} °C` : '-- °C';
    if (hEl) hEl.textContent = t.humid !== null && t.humid !== undefined ? `${Number(t.humid).toFixed(1)} %` : '-- %';
    if (lEl) lEl.textContent = t.lux !== null && t.lux !== undefined ? `${Number(t.lux)} lux` : '-- lux';
    if (cEl) cEl.textContent = t.co2 !== null && t.co2 !== undefined ? `${Number(t.co2)} ppm` : '-- ppm';

    const relays = data.relays || {};
    ['fogger', 'fan', 'light', 'curtain'].forEach(r => {
      const sw = document.getElementById(`adminSwitch${r.charAt(0).toUpperCase() + r.slice(1)}`);
      if (sw && document.activeElement !== sw) {
        sw.checked = Boolean(relays[r]);
      }
    });

    renderOverviewRelayGrid(relays);

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

    const devices = Array.isArray(data.devices) ? data.devices : [];
    await renderNotifyHubCard(data, devices);
    renderDevicesTable(devices);
    renderLogsTable(data.messages || []);

    const uptimeEl = document.getElementById('adminServerUptime');
    if (uptimeEl) {
      uptimeEl.textContent = 'เปิดทำงานต่อเนื่อง (NotifyEngine Active)';
    }
    const hostEl = document.getElementById('adminServerHost');
    if (hostEl) {
      hostEl.textContent = getHubBaseUrl();
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
  // 4. NotifyHub Dispatcher & Device Control (Powered by NotifyModel)
  // ============================================================
  async function renderNotifyHubCard(data, devices) {
    const activeCount = devices.filter(d => d.enabled !== false).length;
    const model = getAdminNotifyModel();
    const isReceiving = await model.isSubscribed();

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

    const hubConnBadge = document.getElementById('adminHubConnBadge');
    if (hubConnBadge) {
      hubConnBadge.textContent = `🟢 เชื่อมต่อระบบแจ้งเตือนแล้ว (${activeCount} เครื่อง)`;
    }

    const summary = document.getElementById('adminHubDevicesSummary');
    if (summary) {
      const myDev = model._detectDeviceName();
      const myStateText = isReceiving
        ? `<span style="color:#10b981;font-weight:700;">เปิดรับข้อความแล้ว ✅</span>`
        : `<span style="color:#ef4444;font-weight:700;">ยังไม่เปิดรับ</span>`;
      summary.innerHTML = `📱 สถานะเครื่องนี้ (${myDev}): ${myStateText} • ซิงค์ข้อมูลร่วมกัน ${activeCount} อุปกรณ์`;
    }

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

    const targetSelect = document.getElementById('adminTargetDeviceSelect');
    const bcastSelect = document.getElementById('bcastTargetSelect');
    const renderOptions = () => {
      let opts = `<option value="">🌐 ส่งทุกอุปกรณ์ที่เปิดรับแจ้งเตือน (${activeCount} เครื่อง)</option>`;
      devices.forEach(d => {
        const status = d.enabled !== false ? '🟢' : '🔴 [ปิดแจ้งเตือน]';
        const ch = d.appId === '*' ? 'ทุกแชนแนล' : d.appId;
        opts += `<option value="${escapeHtml(d.id)}">${status} ${escapeHtml(d.deviceName)} (${escapeHtml(ch)})</option>`;
      });
      return opts;
    };

    if (targetSelect && document.activeElement !== targetSelect) {
      const curVal = targetSelect.value;
      targetSelect.innerHTML = renderOptions();
      if (curVal && devices.some(d => d.id === curVal)) targetSelect.value = curVal;
    }

    if (bcastSelect && document.activeElement !== bcastSelect) {
      const curVal = bcastSelect.value;
      bcastSelect.innerHTML = renderOptions();
      if (curVal && devices.some(d => d.id === curVal)) bcastSelect.value = curVal;
    }
  }

  window.toggleAdminDevicePush = async function () {
    const btn = document.getElementById('adminBtnTogglePush');
    const model = getAdminNotifyModel();
    try {
      if (btn) btn.disabled = true;
      const subscribed = await model.isSubscribed();
      if (subscribed) {
        if (confirm('เครื่องนี้เปิดรับแจ้งเตือนอยู่แล้ว ต้องการยกเลิกการรับแจ้งเตือนบนเครื่องนี้หรือไม่?')) {
          await model.unsubscribe();
        }
      } else {
        await model.subscribe({ appId: '*' });
        await model.send({
          appId: getAppId(),
          title: 'เปิดรับการแจ้งเตือนสำเร็จ! 🎉',
          body: 'อุปกรณ์ของคุณพร้อมรับแจ้งเตือนจาก NotifyHub แล้ว'
        });
      }
      await fetchStatus();
    } catch (err) {
      alert('⚠️ ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
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
      localStorage.setItem(STORAGE_HUB_URL_KEY, urlEl.value.trim().replace(/\/+$/, ''));
    }
    if (appEl && appEl.value.trim()) {
      localStorage.setItem(STORAGE_APP_ID_KEY, appEl.value.trim());
    }
    getAdminNotifyModel();
    alert('💾 บันทึกการตั้งค่าการเชื่อมต่อ NotifyHub แล้ว');
    fetchStatus();
  };

  window.sendAdminTestAlert = async function (e) {
    const btn = e?.currentTarget || document.getElementById('adminBtnTestAlert');
    const targetDeviceId = document.getElementById('adminTargetDeviceSelect')?.value || null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังส่งสัญญาณ...'; }
    try {
      const res = await getAdminNotifyModel().send({
        appId: getAppId(),
        targetDeviceId,
        title: 'มีรายการแจ้งเตือนใหม่! 🎉',
        body: 'ทดสอบส่งแจ้งเตือนเด้งขึ้นหน้าจอมือถือ iOS และ Android จาก Admin Control Center',
        priority: 'high'
      });
      const sentCount = res && res.delivery ? res.delivery.sentCount : 0;
      alert(`✅ ส่งแจ้งเตือนสำเร็จ! (ส่งเข้าอุปกรณ์ ${sentCount} เครื่อง)`);
      await fetchStatus();
    } catch (err) {
      alert('⚠️ เกิดข้อผิดพลาดในการส่ง: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 ทดสอบส่งแจ้งเตือน'; }
    }
  };

  window.sendAdminCustomMessage = async function (e) {
    const btn = e?.currentTarget || document.getElementById('adminBtnSendCustom');
    const titleInput = document.getElementById('adminCustomTitle');
    const bodyInput = document.getElementById('adminCustomBody');
    const targetSelect = document.getElementById('adminTargetDeviceSelect');
    const title = (titleInput ? titleInput.value.trim() : '') || 'มีรายการใหม่จาก Web App!';
    const body = (bodyInput ? bodyInput.value.trim() : '') || 'คลิกเพื่อดูรายละเอียดได้เลย';
    const targetDeviceId = targetSelect ? (targetSelect.value || null) : null;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังส่ง...'; }
    try {
      const res = await getAdminNotifyModel().send({
        appId: getAppId(),
        targetDeviceId,
        title,
        body,
        priority: 'high'
      });
      const sentCount = res && res.delivery ? res.delivery.sentCount : 0;
      alert(`✅ ส่งข้อความแจ้งเตือนสำเร็จ! (ส่งเข้าอุปกรณ์ ${sentCount} เครื่อง)`);
      if (titleInput) titleInput.value = '';
      if (bodyInput) bodyInput.value = '';
      await fetchStatus();
    } catch (err) {
      alert('⚠️ ส่งข้อความไม่สำเร็จ: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 ส่งแจ้งเตือนเข้ามือถือทันที'; }
    }
  };

  // ============================================================
  // 5. Registered Devices Table Management
  // ============================================================
  function renderDevicesTable(devices) {
    const tbody = document.getElementById('adminDevicesTableBody');
    const countEl = document.getElementById('adminTotalDevicesCount');
    if (!tbody) return;

    const list = devices || [];
    if (countEl) {
      countEl.textContent = `${list.length} อุปกรณ์`;
    }

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--admin-text-muted); padding: 24px;">
            ยังไม่มีอุปกรณ์ลงทะเบียนในระบบ
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(d => {
      const isEnabled = d.enabled !== false;
      const dateStr = d.updatedAt
        ? new Date(d.updatedAt).toLocaleString('th-TH')
        : (d.createdAt ? new Date(d.createdAt).toLocaleString('th-TH') : '-');
      const channelLabel = d.appId === '*' ? 'ทุกแชนแนล (*)' : (d.appId || 'my-webapp');

      return `
        <tr>
          <td>
            <strong>${escapeHtml(d.deviceName || 'อุปกรณ์')}</strong>
            <span class="admin-badge-tag" style="margin-left: 6px; font-size: 0.68rem; background: ${isEnabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${isEnabled ? '#10b981' : '#ef4444'}; border: 1px solid ${isEnabled ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'};">
              ${isEnabled ? '🟢 เปิดรับ' : '🔴 ปิดอยู่'}
            </span>
          </td>
          <td>
            <code style="font-size: 0.75rem; background: var(--admin-surface); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--admin-border);">
              ${escapeHtml(String(d.id).length > 20 ? (String(d.id).substring(0, 18) + '...') : String(d.id))}
            </code>
          </td>
          <td>
            <span class="admin-badge-tag" style="font-size: 0.7rem; background: rgba(59, 130, 246, 0.2); color: #60a5fa;">
              ${escapeHtml(channelLabel)}
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
            <div style="display: flex; gap: 6px; align-items: center;">
              <button type="button" class="admin-btn primary" style="padding: 4px 10px; font-size: 0.75rem; white-space: nowrap;" onclick="sendTestToDevice('${d.id}', '${escapeHtml(d.deviceName)}')">
                🚀 ส่งหาเครื่องนี้
              </button>
              <button type="button" class="admin-btn outline" style="padding: 4px 8px; font-size: 0.75rem; color: #ef4444;" onclick="deleteDevice('${d.id}')">
                🗑️ ลบ
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.sendTestToDevice = async function (id, name) {
    const ok = confirm(`ต้องการส่งข้อความทดสอบแจ้งเตือนเจาะจงไปยัง "${name}" ใช่หรือไม่?`);
    if (!ok) return;
    try {
      const res = await getAdminNotifyModel().send({
        appId: getAppId(),
        targetDeviceId: id,
        title: `แจ้งเตือนถึง ${name}! 🔔`,
        body: 'สัญญาณทดสอบแจ้งเตือนเฉพาะเครื่องนี้จาก Admin Control Center',
        priority: 'high'
      });
      const sentCount = res && res.delivery ? res.delivery.sentCount : 0;
      alert(`✅ ส่งข้อความไปยัง "${name}" สำเร็จ! (ส่งเข้า ${sentCount} เครื่อง)`);
      await fetchStatus();
    } catch (err) {
      alert('⚠️ ไม่สามารถส่งข้อความได้: ' + err.message);
    }
  };

  window.toggleDeviceEnabled = async function (id, enabled) {
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'ไม่สามารถเปลี่ยนสถานะได้');
      await fetchStatus();
    } catch (err) {
      alert('⚠️ เกิดข้อผิดพลาด: ' + err.message);
      await fetchStatus();
    }
  };

  window.deleteDevice = async function (id) {
    if (!confirm('ยืนยันการลบอุปกรณ์นี้ออกจากระบบหรือไม่?\nเมื่อลบแล้ว อุปกรณ์นี้จะไม่ได้รับแจ้งเตือนอีกต่อไป')) return;
    try {
      const res = await fetch(resolveApiUrl(`/api/devices/${encodeURIComponent(id)}`), {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'ไม่สามารถลบอุปกรณ์ได้');
      await fetchStatus();
    } catch (err) {
      alert('⚠️ ไม่สามารถลบอุปกรณ์ได้: ' + err.message);
    }
  };

  window.sendAdminBroadcast = async function (e) {
    const btn = e?.currentTarget || document.getElementById('adminBtnSendBcast');
    const title = (document.getElementById('bcastTitle')?.value || '').trim();
    const body = (document.getElementById('bcastBody')?.value || '').trim();
    const priority = document.getElementById('bcastPriority')?.value || 'normal';
    const targetDeviceId = document.getElementById('bcastTargetSelect')?.value || null;
    const delaySeconds = Number(document.getElementById('bcastDelay')?.value) || 0;

    if (!title || !body) {
      alert('กรุณาระบุทั้งหัวข้อและข้อความรายละเอียด');
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังส่งประกาศ...'; }
    try {
      const res = await getAdminNotifyModel().send({
        appId: getAppId(),
        targetDeviceId,
        title,
        body,
        priority,
        delaySeconds
      });
      if (res.scheduled) {
        alert(`✅ ${res.message}`);
      } else {
        const sentCount = res && res.delivery ? res.delivery.sentCount : 0;
        alert(`✅ ส่งข้อความประกาศสำเร็จ! (ส่งเข้าอุปกรณ์ ${sentCount} เครื่อง)`);
      }
      const tInput = document.getElementById('bcastTitle');
      const bInput = document.getElementById('bcastBody');
      if (tInput) tInput.value = '';
      if (bInput) bInput.value = '';
      await fetchStatus();
    } catch (err) {
      alert('⚠️ ส่งข้อความไม่สำเร็จ: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 ยิงข้อความประกาศทันที'; }
    }
  };

  // ============================================================
  // 6. Master Relays Control
  // ============================================================
  window.setAdminRelay = async function (name, state) {
    try {
      await fetch(resolveApiUrl('/api/control'), {
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
      const res = await fetch(resolveApiUrl('/api/simulate'), {
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
      const res = await fetch(resolveApiUrl('/api/targets'), {
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
      const timeStr = item.createdAt ? new Date(item.createdAt).toLocaleString('th-TH') : (item.time ? new Date(item.time).toLocaleString('th-TH') : '-');
      const isWarn = item.priority === 'high' || item.type === 'warning';
      const deliveryInfo = item.delivery ? ` (ส่งเข้า ${item.delivery.sentCount}/${item.delivery.totalTargets} เครื่อง)` : '';
      return `
        <tr>
          <td style="white-space: nowrap; font-size: 0.8rem; color: var(--admin-text-muted);">${timeStr}</td>
          <td>
            <span class="admin-status-pill ${isWarn ? 'offline' : 'online'}" style="font-size: 0.72rem;">
              ${escapeHtml(item.appIcon || '🔔')} ${escapeHtml(item.appName || item.appId || 'ข้อความ')}
            </span>
          </td>
          <td><strong>${escapeHtml(item.title || '')}</strong></td>
          <td style="color: var(--admin-text-muted); font-size: 0.82rem;">${escapeHtml((item.body || item.desc || '') + deliveryInfo)}</td>
        </tr>
      `;
    }).join('');
  }

  window.downloadCsvExport = function () {
    window.open(resolveApiUrl('/api/export/csv'), '_blank');
  };

  window.seedDemoHistory = async function (days) {
    if (!confirm(`คุณต้องการสร้างข้อมูลจำลองประวัติย้อนหลัง ${days} วันใช่หรือไม่?`)) return;
    try {
      const res = await fetch(resolveApiUrl('/api/history/seed-demo'), {
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
      await fetch(resolveApiUrl('/api/messages?appId=*'), { method: 'DELETE' });
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
    getAdminNotifyModel();
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
