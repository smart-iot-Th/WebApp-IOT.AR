/**
 * Smart Farm IoT Application Logic
 * Supports 5 Tabs, Realistic Sensor Simulation, Graph Ranges & Light/Dark Theme
 */

// Active removal of Netlify injected elements (Badge & Drawer)
function removeNetlifyBadge() {
  const killNetlify = () => {
    document.querySelectorAll('iframe, div, a, span, button').forEach(el => {
      const src = (el.src || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
      const title = (el.title || '').toLowerCase();
      const href = (el.href || '').toLowerCase();
      const text = (el.innerText || '').toLowerCase().trim();

      if (
        src.includes('netlify') ||
        id.includes('netlify') ||
        className.includes('netlify') ||
        title.includes('netlify') ||
        href.includes('netlify.com') ||
        text === 'powered by netlify' ||
        text.includes('powered by netlify')
      ) {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        try { el.remove(); } catch (e) {}
      }
    });
  };

  killNetlify();
  if (window.MutationObserver) {
    const observer = new MutationObserver(killNetlify);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  setInterval(killNetlify, 500);
}

removeNetlifyBadge();

// State
let isSimulationActive = true;
let currentFilter = 'all';
let currentRange = '24h';

// Mock Live Sensor Data
const sensorData = {
  temp: 26.5,
  humid: 85,
  co2: 680,
  lux: 350
};

document.addEventListener('DOMContentLoaded', () => {
  removeNetlifyBadge();
  initTheme();
  initAuth();
  initSplashScreen();
  initNavigation();
  initDeviceStates();
  renderNotifs('all');
  initDeviceNotification();
  updateNotifBadge();
  renderScheduleList();
  startLiveSensorTicker();
});

// --- SPLASH / LOADING SCREEN CONTROLLER ---
function initSplashScreen() {
  const splash = document.getElementById('appSplashScreen');
  const progressFill = document.getElementById('splashProgressFill');
  const statusText = document.getElementById('splashStatusText');

  if (!splash) return;

  const steps = [
    { progress: 28, text: 'กำลังเชื่อมต่อระบบ IoT WebApp...' },
    { progress: 65, text: 'โหลดข้อมูลอุปกรณ์และเซนเซอร์...' },
    { progress: 95, text: 'เตรียมพร้อมระบบควบคุม...' },
    { progress: 100, text: 'ระบบพร้อมใช้งาน' }
  ];

  let currentStep = 0;
  const stepInterval = 320; // 320ms per step = ~1.3s total

  const runStep = () => {
    if (currentStep < steps.length) {
      const step = steps[currentStep];
      if (progressFill) progressFill.style.width = `${step.progress}%`;
      if (statusText) statusText.textContent = step.text;
      currentStep++;
      setTimeout(runStep, stepInterval);
    } else {
      // Completed, smoothly fade out splash screen
      setTimeout(() => {
        splash.classList.add('splash-hidden');
        splash.setAttribute('aria-hidden', 'true');
        setTimeout(() => {
          splash.style.display = 'none';
        }, 600);
      }, 350);
    }
  };

  // Start smooth progress
  setTimeout(runStep, 100);

  // Safety fallback: if anything blocks or takes too long, dismiss after 3.2s
  setTimeout(() => {
    if (!splash.classList.contains('splash-hidden')) {
      splash.classList.add('splash-hidden');
      setTimeout(() => { splash.style.display = 'none'; }, 600);
    }
  }, 3200);
}

// --- THEME CONTROLLER (Light / Dark Mode) ---
function initTheme() {
  const savedTheme = FarmStorage.getTheme();
  selectTheme(savedTheme, false);
}

window.selectTheme = function(theme, save = true) {
  if (save) FarmStorage.setTheme(theme);
  document.documentElement.setAttribute('data-theme', theme);

  // Update Meta Theme Color
  const metaColor = document.getElementById('metaThemeColor');
  if (metaColor) {
    metaColor.setAttribute('content', theme === 'dark' ? '#0b0f17' : '#ffffff');
  }

  // Update Theme Chooser UI Cards
  const optLight = document.getElementById('themeOptionLight');
  const optDark = document.getElementById('themeOptionDark');
  if (optLight && optDark) {
    optLight.classList.toggle('active', theme === 'light');
    optDark.classList.toggle('active', theme === 'dark');
  }
};

// --- NAVIGATION (5 TABS) ---
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  const tabPanels = document.querySelectorAll('.tab-panel');

  window.switchTab = function(targetTab) {
    navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === targetTab);
    });

    tabPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${targetTab}`);
    });

    const body = document.getElementById('appBody');
    if (body) body.scrollTo({ top: 0, behavior: 'smooth' });
  };

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });
}

// --- SCREEN 2: CONTROLS & DEVICES ---
function initDeviceStates() {
  const devices = FarmStorage.getDevices();
  const mode = FarmStorage.getControlMode();

  setControlMode(mode, false);

  const foggerSwitch = document.getElementById('switchFogger');
  const fanSwitch = document.getElementById('switchFan');
  const lightSwitch = document.getElementById('switchLight');
  const curtainSwitch = document.getElementById('switchCurtain');

  if (foggerSwitch) foggerSwitch.checked = !!devices.fogger;
  if (fanSwitch) fanSwitch.checked = !!devices.fan;
  if (lightSwitch) lightSwitch.checked = !!devices.light;
  if (curtainSwitch) curtainSwitch.checked = !!devices.curtain;
}

window.setControlMode = function(mode, save = true) {
  if (save) FarmStorage.setControlMode(mode);

  const btnAuto = document.getElementById('btnModeAuto');
  const btnManual = document.getElementById('btnModeManual');

  if (btnAuto && btnManual) {
    btnAuto.classList.toggle('active', mode === 'auto');
    btnManual.classList.toggle('active', mode === 'manual');
  }
};

window.toggleDevice = function(name, state) {
  FarmStorage.setDevice(name, state);
  console.log(`[IoT] Device ${name} set to ${state ? 'ON' : 'OFF'}`);
};

window.saveControlSettings = function() {
  alert('บันทึกการตั้งค่าการควบคุมเรียบร้อยแล้ว ✅');
};

// --- SCREEN 3: GRAPHS & RANGES ---
window.setChartRange = function(range) {
  currentRange = range;
  const btn24h = document.getElementById('btnRange24h');
  const btn7d = document.getElementById('btnRange7d');
  const btn30d = document.getElementById('btnRange30d');

  if (btn24h) btn24h.classList.toggle('active', range === '24h');
  if (btn7d) btn7d.classList.toggle('active', range === '7d');
  if (btn30d) btn30d.classList.toggle('active', range === '30d');

  // Morph SVG chart lines slightly for realistic feedback
  const tempPath = document.getElementById('pathTempLine');
  const humidPath = document.getElementById('pathHumidLine');
  const luxPath = document.getElementById('pathLuxLine');

  if (range === '7d') {
    if (tempPath) tempPath.setAttribute('d', 'M 0 50 Q 50 70, 100 45 T 180 35 T 260 40 T 340 55');
    if (humidPath) humidPath.setAttribute('d', 'M 0 35 Q 50 25, 100 30 T 180 45 T 260 30 T 340 28');
    if (luxPath) luxPath.setAttribute('d', 'M 0 80 Q 70 60, 140 25 T 220 30 T 340 80');
  } else if (range === '30d') {
    if (tempPath) tempPath.setAttribute('d', 'M 0 60 Q 60 45, 120 55 T 200 48 T 280 62 T 340 50');
    if (humidPath) humidPath.setAttribute('d', 'M 0 40 Q 60 45, 120 35 T 200 30 T 280 40 T 340 38');
    if (luxPath) luxPath.setAttribute('d', 'M 0 85 Q 80 50, 160 20 T 250 40 T 340 85');
  } else {
    if (tempPath) tempPath.setAttribute('d', 'M 0 65 Q 40 60, 80 50 T 160 30 T 240 55 T 300 62 T 340 60');
    if (humidPath) humidPath.setAttribute('d', 'M 0 45 Q 40 40, 80 25 T 160 30 T 240 50 T 300 35 T 340 32');
    if (luxPath) luxPath.setAttribute('d', 'M 0 85 Q 50 85, 100 65 Q 140 18, 170 15 Q 200 18, 240 70 Q 290 85, 340 85');
  }
};

// --- SCREEN 4: NOTIFICATIONS CONTROLLER ---
let currentNotifFilter = 'all';

function updateNotifBadge() {
  const unreadCount = FarmStorage.getUnreadCount();
  const badgeEl = document.getElementById('navNotifBadge');
  const countTextEl = document.getElementById('notifUnreadBadgeText');

  if (badgeEl) {
    if (unreadCount > 0) {
      badgeEl.style.display = 'flex';
      badgeEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
    } else {
      badgeEl.style.display = 'none';
    }
  }

  if (countTextEl) {
    countTextEl.textContent = unreadCount > 0 ? `ยังไม่อ่าน ${unreadCount} รายการ` : 'อ่านแล้วทั้งหมด';
  }
}

window.filterNotifs = function(cat) {
  currentNotifFilter = cat;
  const pills = {
    all: document.getElementById('btnFilterAll'),
    warning: document.getElementById('btnFilterWarn'),
    system: document.getElementById('btnFilterSys'),
    message: document.getElementById('btnFilterMsg')
  };

  Object.keys(pills).forEach(k => {
    if (pills[k]) pills[k].classList.toggle('active', k === cat);
  });

  renderNotifs(cat);
};

function renderNotifs(cat = currentNotifFilter) {
  const container = document.getElementById('notifListContainer');
  if (!container) return;

  const notifs = FarmStorage.getNotifs();
  const filtered = cat === 'all' ? notifs : notifs.filter(n => n.category === cat);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="opacity: 0.4; margin-bottom: 10px;">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <div style="font-weight: 600; font-size: 0.95rem;">ไม่มีประวัติการแจ้งเตือน</div>
        <div style="font-size: 0.8rem; margin-top: 4px;">เมื่อมีเหตุการณ์สำคัญ ระบบจะบันทึกประวัติไว้ที่นี่</div>
      </div>
    `;
    updateNotifBadge();
    return;
  }

  let html = '';
  filtered.forEach(item => {
    let iconSvg = '';
    if (item.type === 'warning') {
      iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    } else if (item.type === 'info') {
      iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`;
    } else if (item.type === 'success') {
      iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    } else if (item.type === 'light') {
      iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6h8c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7z"></path></svg>`;
    } else {
      iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }

    const unreadClass = item.read ? '' : 'unread';

    html += `
      <div class="notif-card ${unreadClass}" onclick="handleNotifClick('${item.id}')">
        <div class="notif-left">
          <div class="notif-icon-circle ${item.type}">${iconSvg}</div>
          <div class="notif-content">
            <div class="notif-title">${escapeHtml(item.title)}</div>
            <div class="notif-time">${escapeHtml(item.time)}</div>
            <div class="notif-detail">${escapeHtml(item.detail)}</div>
          </div>
        </div>
        <button class="notif-card-delete" type="button" title="ลบรายการนี้" onclick="event.stopPropagation(); handleDeleteNotif('${item.id}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;
  });

  container.innerHTML = html;
  updateNotifBadge();
}

window.handleNotifClick = function(id) {
  FarmStorage.markNotifRead(id);
  renderNotifs(currentNotifFilter);
};

window.handleDeleteNotif = function(id) {
  FarmStorage.deleteNotif(id);
  renderNotifs(currentNotifFilter);
};

window.markAllNotifsAsRead = function() {
  FarmStorage.markAllNotifsRead();
  renderNotifs(currentNotifFilter);
};

window.clearAllNotifs = function() {
  if (confirm('คุณต้องการล้างประวัติการแจ้งเตือนทั้งหมดใช่หรือไม่?')) {
    FarmStorage.clearAllNotifs();
    renderNotifs(currentNotifFilter);
  }
};

// ============================================================
// NATIVE DEVICE WEB NOTIFICATION CONTROLLER (Direct from WebApp)
// ============================================================
function checkIsIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function checkIsStandalone() {
  return window.navigator.standalone === true || 
         window.matchMedia('(display-mode: standalone)').matches;
}

window.openIOSNotifModal = function() {
  const m = document.getElementById('iosNotifModal');
  if (m) m.style.display = 'flex';
};

window.closeIOSNotifModal = function() {
  const m = document.getElementById('iosNotifModal');
  if (m) m.style.display = 'none';
};

function initDeviceNotification() {
  const btn = document.getElementById('btnEnableNotif');
  const title = document.getElementById('deviceNotifTitle');
  const sub = document.getElementById('deviceNotifSub');
  if (!btn) return;

  const isIOS = checkIsIOS();
  const isStandalone = checkIsStandalone();

  // If on iOS and running inside normal Safari tab (not added to home screen yet)
  if (isIOS && !isStandalone) {
    btn.textContent = 'ดูวิธีเปิดบน iOS';
    btn.classList.remove('active');
    btn.style.display = 'inline-block';
    if (sub) sub.textContent = 'บน iPhone ต้องเพิ่มลงหน้าจอโฮมก่อนรับแจ้งเตือน';
    return;
  }

  if (!('Notification' in window)) {
    if (isIOS) {
      btn.textContent = 'ดูวิธีเปิดบน iOS';
      btn.classList.remove('active');
      if (sub) sub.textContent = 'เพิ่มลงหน้าจอโฮมเพื่อเปิดใช้งานแจ้งเตือน (iOS 16.4+)';
    } else {
      btn.style.display = 'none';
      if (sub) sub.textContent = 'เบราว์เซอร์นี้ยังไม่รองรับ Web Notification';
    }
    return;
  }

  if (Notification.permission === 'granted') {
    btn.textContent = '● เปิดแล้ว (ทดสอบ)';
    btn.classList.add('active');
    if (sub) sub.textContent = 'พร้อมส่งการแจ้งเตือนเข้าเครื่องโดยตรง';
  } else if (Notification.permission === 'denied') {
    btn.textContent = 'เปิดในการตั้งค่า';
    btn.classList.remove('active');
    if (sub) sub.textContent = 'กรุณาเปิดสิทธิ์ในการตั้งค่าเครื่อง ➔ การแจ้งเตือน';
  } else {
    btn.textContent = 'เปิดแจ้งเตือน';
    btn.classList.remove('active');
    if (sub) sub.textContent = 'แจ้งเตือนตรงสู่หน้าจอมือถือ ไม่ผ่านแอปอื่น';
  }
}

window.toggleDeviceNotification = async function() {
  const isIOS = checkIsIOS();
  const isStandalone = checkIsStandalone();

  // If on iOS and running inside normal Safari tab
  if (isIOS && !isStandalone) {
    openIOSNotifModal();
    return;
  }

  // Check HTTPS requirement
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !isLocalhost) {
    alert('ระบบแจ้งเตือนของสมาร์ตโฟน (iOS/Android) จำเป็นต้องใช้งานผ่าน HTTPS (เช่น ลิงก์บน Netlify) เท่านั้น ไม่สามารถรับแจ้งเตือนผ่าน http:// ทั่วไปได้ครับ');
    return;
  }

  if (!('Notification' in window)) {
    if (isIOS) {
      openIOSNotifModal();
    } else {
      alert('อุปกรณ์หรือเบราว์เซอร์ของคุณยังไม่รองรับระบบ Web Notification');
    }
    return;
  }

  if (Notification.permission === 'granted') {
    // Send a test notification immediately
    await sendDeviceNotification(
      'IoT WebApp',
      'ทดสอบการแจ้งเตือนสำเร็จ! ระบบพร้อมส่งการแจ้งเตือนตรงสู่อุปกรณ์ของคุณ'
    );
    return;
  }

  if (Notification.permission === 'denied') {
    alert('คุณเคยปิดการแจ้งเตือนไว้ สามารถไปที่ การตั้งค่าของโทรศัพท์ ➔ การแจ้งเตือน ➔ เลือก IoT WebApp แล้วเปิด "อนุญาตการแจ้งเตือน" ได้ครับ');
    return;
  }

  // Request permission (supporting both Promise and Callback for iOS Safari)
  try {
    let permission;
    if (typeof Notification.requestPermission === 'function') {
      permission = await new Promise(resolve => {
        const p = Notification.requestPermission(resolve);
        if (p && typeof p.then === 'function') {
          p.then(resolve);
        }
      });
    }

    initDeviceNotification();

    if (permission === 'granted') {
      await sendDeviceNotification(
        'IoT WebApp',
        'ยินดีต้อนรับ! เปิดการแจ้งเตือนตรงจาก WebApp สำเร็จแล้ว'
      );
    } else if (permission === 'denied') {
      alert('คุณปฏิเสธการแจ้งเตือน หากต้องการเปิดในภายหลัง สามารถไปเปิดได้ในการตั้งค่าโทรศัพท์ครับ');
    }
  } catch (err) {
    console.error('requestPermission error:', err);
    alert('เกิดข้อผิดพลาดในการขอสิทธิ์แจ้งเตือน: ' + err.message);
  }
};

async function sendDeviceNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const options = {
    body: body,
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-192.png',
    tag: 'iot-alert-' + Date.now(),
    renotify: true,
    data: { url: './index.html?tab=notif' }
  };

  // 1. Primary method for iOS PWA and Android (via Service Worker showNotification)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      console.log('[Notification] Sent via Service Worker showNotification successfully');
      return;
    } catch (err) {
      console.warn('[Notification] Service Worker showNotification failed:', err);
    }
  }

  // 2. Fallback for Desktop browsers that support the constructor
  try {
    new Notification(title, options);
  } catch (e) {
    console.warn('[Notification] Fallback constructor failed:', e);
  }
}

// ============================================================
// AUTO-THRESHOLD SENSOR MONITORING (Combined Phase 2 & 3)
// ============================================================
const alertCooldowns = {
  temp: 0,
  humid: 0,
  co2: 0
};

function checkThresholdsAndNotify(temp, humid, co2) {
  const targets = FarmStorage.getTargets();
  const now = Date.now();
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 mins cooldown
  const timeStr = getCurrentTimeFormatted();

  // Check Temperature
  if (temp > targets.tempMax || temp < targets.tempMin) {
    if (now - alertCooldowns.temp > COOLDOWN_MS) {
      alertCooldowns.temp = now;
      const statusText = temp > targets.tempMax ? 'อุณหภูมิสูงเกินกำหนด' : 'อุณหภูมิต่ำกว่ากำหนด';
      const detailText = `อุณหภูมิปัจจุบัน ${temp.toFixed(1)} °C (เกณฑ์: ${targets.tempMin} - ${targets.tempMax} °C)`;
      
      FarmStorage.addNotif({
        title: statusText,
        detail: detailText,
        type: 'warning',
        category: 'warning',
        time: 'วันนี้ ' + timeStr
      });
      
      sendDeviceNotification(`⚠️ ${statusText}`, detailText);
      renderNotifs(currentNotifFilter);
    }
  }

  // Check Humidity
  if (humid > targets.humidMax || humid < targets.humidMin) {
    if (now - alertCooldowns.humid > COOLDOWN_MS) {
      alertCooldowns.humid = now;
      const statusText = humid > targets.humidMax ? 'ความชื้นสูงเกินกำหนด' : 'ความชื้นต่ำกว่ากำหนด';
      const detailText = `ความชื้นปัจจุบัน ${humid} % (เกณฑ์: ${targets.humidMin} - ${targets.humidMax} %)`;
      
      FarmStorage.addNotif({
        title: statusText,
        detail: detailText,
        type: 'info',
        category: 'warning',
        time: 'วันนี้ ' + timeStr
      });
      
      sendDeviceNotification(`💧 ${statusText}`, detailText);
      renderNotifs(currentNotifFilter);
    }
  }

  // Check CO2
  if (co2 > targets.co2Max) {
    if (now - alertCooldowns.co2 > COOLDOWN_MS) {
      alertCooldowns.co2 = now;
      const statusText = 'ระดับ CO₂ เกินมาตรฐาน';
      const detailText = `ระดับ CO₂ ปัจจุบัน ${co2} ppm (เกณฑ์: < ${targets.co2Max} ppm)`;
      
      FarmStorage.addNotif({
        title: statusText,
        detail: detailText,
        type: 'warning',
        category: 'warning',
        time: 'วันนี้ ' + timeStr
      });
      
      sendDeviceNotification(`☁️ ${statusText}`, detailText);
      renderNotifs(currentNotifFilter);
    }
  }
}

function getCurrentTimeFormatted() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// --- SCREEN 5: SIMULATION & PWA ---
window.toggleSimulation = function(active) {
  isSimulationActive = active;
};

window.promptPWAInstall = function() {
  if (window.NovaPWA) {
    NovaPWA.promptInstall();
  } else {
    alert('สำหรับ iPhone: กดปุ่มแชร์ ➔ "เพิ่มไปยังหน้าจอโฮม"\nสำหรับ Android: กดเมนู 3 จุด ➔ "ติดตั้งแอป" ครับ');
  }
};

// Subtle Real-time Fluctuations & Threshold Checking
function startLiveSensorTicker() {
  setInterval(() => {
    if (!isSimulationActive) return;

    // Small natural fluctuations
    const tempDelta = (Math.random() * 0.4 - 0.2);
    const humidDelta = Math.floor(Math.random() * 3 - 1);
    const luxDelta = Math.floor(Math.random() * 10 - 5);

    sensorData.temp = Math.max(25.8, Math.min(27.2, +(sensorData.temp + tempDelta).toFixed(1)));
    sensorData.humid = Math.max(83, Math.min(88, sensorData.humid + humidDelta));
    sensorData.lux = Math.max(330, Math.min(370, sensorData.lux + luxDelta));

    // Update Home Screen values
    const tempEl = document.getElementById('sensorTemp');
    const humidEl = document.getElementById('sensorHumid');
    const luxEl = document.getElementById('sensorLux');

    if (tempEl) tempEl.textContent = `${sensorData.temp.toFixed(1)} °C`;
    if (humidEl) humidEl.textContent = `${sensorData.humid} %`;
    if (luxEl) luxEl.textContent = `${sensorData.lux} lux`;

    // Update Graph current badges
    const graphTempBadge = document.querySelector('.chart-card-badge.temp');
    const graphHumidBadge = document.querySelector('.chart-card-badge.humid');
    const graphLuxBadge = document.querySelector('.chart-card-badge.lux');

    if (graphTempBadge) graphTempBadge.textContent = `ปัจจุบัน ${sensorData.temp.toFixed(1)} °C`;
    if (graphHumidBadge) graphHumidBadge.textContent = `ปัจจุบัน ${sensorData.humid} %`;
    if (graphLuxBadge) graphLuxBadge.textContent = `ปัจจุบัน ${sensorData.lux} lux`;

    // Automatic Threshold Checking (Combined Phase 2 & 3)
    checkThresholdsAndNotify(sensorData.temp, sensorData.humid, sensorData.co2);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// AUTHENTICATION & LOGIN CONTROLLER (Matching Image 2)
// ============================================================
function initAuth() {
  const isLoggedIn = localStorage.getItem('iot_webapp_logged_in') === 'true';
  const loginScreen = document.getElementById('appLoginScreen');
  if (loginScreen) {
    if (isLoggedIn) {
      loginScreen.classList.add('login-hidden');
    } else {
      loginScreen.classList.remove('login-hidden');
    }
  }
}

window.handleLoginSubmit = function(e) {
  if (e) e.preventDefault();
  const submitBtn = document.getElementById('btnLoginSubmit');
  if (!submitBtn) return;

  const originalContent = submitBtn.innerHTML;
  submitBtn.innerHTML = `<span>กำลังเข้าสู่ระบบ...</span>`;
  submitBtn.disabled = true;

  setTimeout(() => {
    localStorage.setItem('iot_webapp_logged_in', 'true');
    const loginScreen = document.getElementById('appLoginScreen');
    if (loginScreen) {
      loginScreen.classList.add('login-hidden');
    }
    submitBtn.innerHTML = originalContent;
    submitBtn.disabled = false;
  }, 400);
};

window.quickGuestLogin = function() {
  handleLoginSubmit(null);
};

window.handleLogout = function() {
  if (confirm('คุณต้องการออกจากระบบ IoT WebApp ใช่หรือไม่?')) {
    localStorage.removeItem('iot_webapp_logged_in');
    const loginScreen = document.getElementById('appLoginScreen');
    if (loginScreen) {
      loginScreen.classList.remove('login-hidden');
    }
    showSettingsView('main');
  }
};

window.togglePasswordVisibility = function() {
  const input = document.getElementById('loginPassword');
  const eyeOpen = document.getElementById('eyeIconOpen');
  const eyeClosed = document.getElementById('eyeIconClosed');
  if (!input) return;

  if (input.type === 'password') {
    input.type = 'text';
    if (eyeOpen) eyeOpen.style.display = 'none';
    if (eyeClosed) eyeClosed.style.display = 'block';
  } else {
    input.type = 'password';
    if (eyeOpen) eyeOpen.style.display = 'block';
    if (eyeClosed) eyeClosed.style.display = 'none';
  }
};

// ============================================================
// SETTINGS SUB-VIEWS CONTROLLER (Matching Image 1)
// ============================================================
window.showSettingsView = function(viewName) {
  const views = document.querySelectorAll('.sub-settings-view');
  views.forEach(v => v.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.add('active');
  } else {
    const mainView = document.getElementById('view-settings-main');
    if (mainView) mainView.classList.add('active');
  }

  if (viewName === 'schedule') {
    renderScheduleList();
  }
};

// ============================================================
// AUTOMATION SCHEDULE DATA & CONTROLLER (Screen 3)
// ============================================================
let activeScheduleCategory = 'mist';
let schedules = [
  { id: 1, category: 'mist', time: '06:00 - 06:30', days: 'จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์', active: true },
  { id: 2, category: 'mist', time: '10:00 - 10:30', days: 'จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์', active: true },
  { id: 3, category: 'mist', time: '14:00 - 14:30', days: 'จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์', active: true },
  { id: 4, category: 'mist', time: '18:00 - 18:30', days: 'จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์', active: true },
  { id: 5, category: 'fan', time: '08:00 - 08:30', days: 'จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์', active: true },
  { id: 6, category: 'fan', time: '12:00 - 12:45', days: 'จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์', active: true },
  { id: 7, category: 'light', time: '06:00 - 18:00', days: 'จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์', active: true }
];

window.selectScheduleCategory = function(cat) {
  activeScheduleCategory = cat;
  const pills = document.querySelectorAll('.schedule-pill-btn');
  pills.forEach(p => p.classList.remove('active'));

  const activeBtn = document.getElementById(`pill${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
  if (activeBtn) activeBtn.classList.add('active');

  renderScheduleList();
};

function renderScheduleList() {
  const container = document.getElementById('scheduleListContainer');
  if (!container) return;

  const filtered = schedules.filter(s => s.category === activeScheduleCategory);
  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px 10px; color: var(--text-muted); font-size: 0.9rem;">
        ไม่มีตารางเวลาสำหรับอุปกรณ์นี้<br>กด "เพิ่มตารางเวลา" เพื่อสร้างใหม่
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => `
    <div class="schedule-item-card">
      <div class="schedule-item-left">
        <svg class="schedule-clock-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <div>
          <div class="schedule-time-range">${item.time}</div>
          <div class="schedule-days-text">${item.days}</div>
        </div>
      </div>
      <div class="schedule-item-right">
        <label class="switch">
          <input type="checkbox" ${item.active ? 'checked' : ''} onchange="toggleScheduleActive(${item.id}, this.checked)">
          <span class="slider"></span>
        </label>
        <button class="schedule-more-btn" type="button" onclick="alert('ตัวเลือกตารางเวลา ${item.time}')">⋮</button>
      </div>
    </div>
  `).join('');
}

window.toggleScheduleActive = function(id, isActive) {
  const item = schedules.find(s => s.id === id);
  if (item) item.active = isActive;
};

window.openAddScheduleModal = function() {
  const modal = document.getElementById('scheduleModal');
  if (modal) {
    document.getElementById('scheduleCategory').value = activeScheduleCategory;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }
};

window.closeAddScheduleModal = function() {
  const modal = document.getElementById('scheduleModal');
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
};

window.handleSaveSchedule = function(e) {
  e.preventDefault();
  const cat = document.getElementById('scheduleCategory').value;
  const start = document.getElementById('scheduleStartTime').value || '08:00';
  const end = document.getElementById('scheduleEndTime').value || '08:30';

  schedules.push({
    id: Date.now(),
    category: cat,
    time: `${start} - ${end}`,
    days: 'จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์',
    active: true
  });

  closeAddScheduleModal();
  selectScheduleCategory(cat);
};

// ============================================================
// THRESHOLD MODAL CONTROLLER (Screen 1)
// ============================================================
window.promptEditThreshold = function(key, title, defaultValue) {
  const modal = document.getElementById('thresholdModal');
  const modalTitle = document.getElementById('thresholdModalTitle');
  const inputVal = document.getElementById('thresholdInputValue');
  const keyInput = document.getElementById('thresholdKey');
  const labelDesc = document.getElementById('thresholdLabelDesc');

  if (modal) {
    modalTitle.textContent = title;
    keyInput.value = key;
    labelDesc.textContent = `กำหนดช่วงค่าที่ต้องการ (${title})`;
    
    const curLabel = document.getElementById(`labelThresh${key.charAt(0).toUpperCase() + key.slice(1)}`);
    inputVal.value = curLabel ? curLabel.textContent.trim() : defaultValue;
    
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }
};

window.closeThresholdModal = function() {
  const modal = document.getElementById('thresholdModal');
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
};

window.handleSaveThreshold = function(e) {
  e.preventDefault();
  const key = document.getElementById('thresholdKey').value;
  const val = document.getElementById('thresholdInputValue').value.trim();

  const targetLabel = document.getElementById(`labelThresh${key.charAt(0).toUpperCase() + key.slice(1)}`);
  if (targetLabel && val) {
    targetLabel.textContent = val;
  }
  closeThresholdModal();
};

