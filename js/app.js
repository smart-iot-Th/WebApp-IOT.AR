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
  startEsp32Polling();
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

window.toggleDevice = async function(name, state) {
  FarmStorage.setDevice(name, state);
  console.log(`[IoT] Device ${name} set to ${state ? 'ON' : 'OFF'}`);

  // Send real command to backend database / ESP32
  try {
    await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relay: name, state: state })
    });
  } catch (err) {
    console.warn('[IoT Control] Offline mode, command stored locally:', err);
  }
};

window.saveControlSettings = function() {
  alert('บันทึกการตั้งค่าการควบคุมเรียบร้อยแล้ว ✅');
};

// --- SCREEN 3: REAL-TIME SPLINE CHARTS & RANGES ---
let currentChartRange = '24h';

// Mathematical Catmull-Rom cubic Bezier spline for smooth natural curves
function getSmoothSplinePath(pts) {
  if (!pts || pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i < pts.length - 2 ? pts[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function renderSingleSplineChart({
  areaId,
  lineId,
  pointsId,
  emptyOverlayId,
  badgeId,
  axisId,
  series,
  color,
  unit,
  currentVal,
  isOnline,
  badgeClass
}) {
  const areaEl = document.getElementById(areaId);
  const lineEl = document.getElementById(lineId);
  const pointsEl = document.getElementById(pointsId);
  const emptyEl = document.getElementById(emptyOverlayId);
  const badgeEl = document.getElementById(badgeId);
  const axisEl = document.getElementById(axisId);

  // If no historical data or empty series
  if (!series || series.length === 0) {
    if (areaEl) areaEl.setAttribute('d', '');
    if (lineEl) lineEl.setAttribute('d', '');
    if (pointsEl) pointsEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      emptyEl.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3v18h18"></path>
          <path d="M7 16l4-4 4 4 5-6" stroke-dasharray="3 3"></path>
        </svg>
        <span>ยังไม่มีข้อมูลจาก ESP32 (${isOnline ? 'รอส่งข้อมูล...' : 'ออฟไลน์'})</span>
      `;
    }
    if (badgeEl) {
      badgeEl.className = `chart-card-badge ${badgeClass} offline`;
      badgeEl.textContent = isOnline ? 'รอข้อมูล...' : 'ออฟไลน์ (ไม่มีข้อมูล)';
    }
    if (axisEl) {
      axisEl.innerHTML = '<span>--:--</span><span>--:--</span><span>--:--</span><span>--:--</span><span>--:--</span>';
    }
    return;
  }

  // Real historical data exists: hide empty overlay
  if (emptyEl) emptyEl.style.display = 'none';

  const latestVal = currentVal !== null && currentVal !== undefined ? Number(currentVal) : series[series.length - 1].val;
  if (badgeEl) {
    badgeEl.className = `chart-card-badge ${badgeClass}`;
    badgeEl.textContent = `ปัจจุบัน ${Number(latestVal).toFixed(1)} ${unit}`;
  }

  // If only 1 data point
  if (series.length === 1) {
    const yCenter = 50;
    if (lineEl) lineEl.setAttribute('d', `M 0 ${yCenter} L 340 ${yCenter}`);
    if (areaEl) areaEl.setAttribute('d', `M 0 ${yCenter} L 340 ${yCenter} L 340 100 L 0 100 Z`);
    if (pointsEl) {
      pointsEl.innerHTML = `<circle cx="170" cy="${yCenter}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="2" class="chart-pulse-point"/>`;
    }
    if (axisEl) {
      const d = new Date(series[0].time);
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      axisEl.innerHTML = `<span>--:--</span><span>--:--</span><span>${timeStr}</span><span>--:--</span><span>--:--</span>`;
    }
    return;
  }

  // 2 or more data points -> Draw smooth spline curve
  const values = series.map(s => s.val);
  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);
  if (minVal === maxVal) {
    minVal -= 2;
    maxVal += 2;
  } else {
    const pad = (maxVal - minVal) * 0.15;
    minVal -= pad;
    maxVal += pad;
  }

  const pts = series.map((s, idx) => {
    const x = (idx / (series.length - 1)) * 340;
    const y = 85 - ((s.val - minVal) / (maxVal - minVal)) * 70;
    return {
      x: Math.max(0, Math.min(340, x)),
      y: Math.max(10, Math.min(90, y))
    };
  });

  const lineD = getSmoothSplinePath(pts);
  const areaD = `${lineD} L 340 100 L 0 100 Z`;

  if (lineEl) lineEl.setAttribute('d', lineD);
  if (areaEl) areaEl.setAttribute('d', areaD);

  // Render point dots
  if (pointsEl) {
    let circlesHtml = '';
    const step = Math.max(1, Math.floor(pts.length / 6));
    for (let i = 0; i < pts.length - 1; i += step) {
      circlesHtml += `<circle cx="${pts[i].x.toFixed(1)}" cy="${pts[i].y.toFixed(1)}" r="3.5" fill="${color}"/>`;
    }
    const lastPt = pts[pts.length - 1];
    circlesHtml += `<circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="2" class="chart-pulse-point"/>`;
    pointsEl.innerHTML = circlesHtml;
  }

  // Update timestamps on axis
  if (axisEl && series.length >= 2) {
    const tStart = series[0].time;
    const tEnd = series[series.length - 1].time;
    let labelHtml = '';
    for (let i = 0; i < 5; i++) {
      const t = tStart + ((tEnd - tStart) * (i / 4));
      const d = new Date(t);
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      labelHtml += `<span>${timeStr}</span>`;
    }
    axisEl.innerHTML = labelHtml;
  }
}

window.renderAllEsp32Charts = function(history, isOnline, telemetry) {
  let filtered = Array.isArray(history) ? [...history] : [];
  const now = Date.now();
  if (currentChartRange === '24h') {
    filtered = filtered.filter(h => now - h.time <= 24 * 3600 * 1000);
  } else if (currentChartRange === '7d') {
    filtered = filtered.filter(h => now - h.time <= 7 * 24 * 3600 * 1000);
  } else if (currentChartRange === '30d') {
    filtered = filtered.filter(h => now - h.time <= 30 * 24 * 3600 * 1000);
  }

  // If time filter returned empty but we have history, fallback to showing all recorded points
  if (filtered.length === 0 && history && history.length > 0) {
    filtered = history;
  }

  // 1. Temperature
  const tempSeries = filtered
    .filter(h => h.temp !== null && h.temp !== undefined)
    .map(h => ({ val: Number(h.temp), time: h.time }));
  renderSingleSplineChart({
    areaId: 'pathTempArea',
    lineId: 'pathTempLine',
    pointsId: 'pointsTemp',
    emptyOverlayId: 'emptyChartTemp',
    badgeId: 'chartBadgeTemp',
    axisId: 'axisTemp',
    series: tempSeries,
    color: '#ef4444',
    unit: '°C',
    currentVal: telemetry ? telemetry.temp : null,
    isOnline: isOnline,
    badgeClass: 'temp'
  });

  // 2. Humidity
  const humidSeries = filtered
    .filter(h => h.humid !== null && h.humid !== undefined)
    .map(h => ({ val: Number(h.humid), time: h.time }));
  renderSingleSplineChart({
    areaId: 'pathHumidArea',
    lineId: 'pathHumidLine',
    pointsId: 'pointsHumid',
    emptyOverlayId: 'emptyChartHumid',
    badgeId: 'chartBadgeHumid',
    axisId: 'axisHumid',
    series: humidSeries,
    color: '#3b82f6',
    unit: '%',
    currentVal: telemetry ? telemetry.humid : null,
    isOnline: isOnline,
    badgeClass: 'humid'
  });

  // 3. Lux
  const luxSeries = filtered
    .filter(h => h.lux !== null && h.lux !== undefined)
    .map(h => ({ val: Number(h.lux), time: h.time }));
  renderSingleSplineChart({
    areaId: 'pathLuxArea',
    lineId: 'pathLuxLine',
    pointsId: 'pointsLux',
    emptyOverlayId: 'emptyChartLux',
    badgeId: 'chartBadgeLux',
    axisId: 'axisLux',
    series: luxSeries,
    color: '#f59e0b',
    unit: 'lux',
    currentVal: telemetry ? telemetry.lux : null,
    isOnline: isOnline,
    badgeClass: 'lux'
  });

  // 4. CO2
  const co2Series = filtered
    .filter(h => h.co2 !== null && h.co2 !== undefined)
    .map(h => ({ val: Number(h.co2), time: h.time }));
  renderSingleSplineChart({
    areaId: 'pathCo2Area',
    lineId: 'pathCo2Line',
    pointsId: 'pointsCo2',
    emptyOverlayId: 'emptyChartCo2',
    badgeId: 'chartBadgeCo2',
    axisId: 'axisCo2',
    series: co2Series,
    color: '#10b981',
    unit: 'ppm',
    currentVal: telemetry ? telemetry.co2 : null,
    isOnline: isOnline,
    badgeClass: 'co2'
  });
};

window.setChartRange = function(range) {
  currentChartRange = range;
  const btn24h = document.getElementById('btnRange24h');
  const btn7d = document.getElementById('btnRange7d');
  const btn30d = document.getElementById('btnRange30d');

  if (btn24h) btn24h.classList.toggle('active', range === '24h');
  if (btn7d) btn7d.classList.toggle('active', range === '7d');
  if (btn30d) btn30d.classList.toggle('active', range === '30d');

  if (window.latestEsp32Data) {
    window.renderAllEsp32Charts(window.latestEsp32Data.history || [], window.latestEsp32Data.online, window.latestEsp32Data.telemetry);
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

// ============================================================
// REAL ESP32 HARDWARE TELEMETRY & DATABASE BRIDGE
// ============================================================
let esp32Online = false;

window.openEsp32Modal = function() {
  const m = document.getElementById('esp32GuideModal');
  if (m) m.style.display = 'flex';
};

window.closeEsp32Modal = function() {
  const m = document.getElementById('esp32GuideModal');
  if (m) m.style.display = 'none';
};

async function fetchEsp32Telemetry() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error('API server status ' + res.status);
    const data = await res.json();
    updateEsp32UI(data);
  } catch (err) {
    // API server unreachable or offline
    updateEsp32UI({ online: false, telemetry: {} });
  }
}

function updateEsp32UI(data) {
  esp32Online = Boolean(data && data.online);

  // 1. Home Banner Badge
  const homeBadge = document.getElementById('homeConnBadge');
  const homeDot = document.getElementById('homeConnDot');
  const homeText = document.getElementById('homeConnText');

  // 2. Sensor Value Elements
  const tempEl = document.getElementById('sensorTemp');
  const humidEl = document.getElementById('sensorHumid');
  const co2El = document.getElementById('sensorCo2');
  const luxEl = document.getElementById('sensorLux');

  // 3. Settings ESP32 Bridge Card
  const bridgeDot = document.getElementById('bridgeStatusDot');
  const bridgeTitle = document.getElementById('bridgeStatusTitle');
  const bridgeBadge = document.getElementById('bridgeStatusBadge');
  const bridgeDesc = document.getElementById('bridgeStatusDesc');

  // 4. Device Status Page Elements (#view-devices)
  const devHeaderBadge = document.getElementById('devStatusHeaderBadge');
  const devHeaderDot = document.getElementById('devStatusHeaderDot');
  const devHeaderText = document.getElementById('devStatusHeaderText');

  const badgeSensor = document.getElementById('badgeDeviceSensor');
  const badgeMist = document.getElementById('badgeDeviceMist');
  const badgeFan = document.getElementById('badgeDeviceFan');
  const badgeLight = document.getElementById('badgeDeviceLight');
  const badgeBox = document.getElementById('badgeDeviceBox');

  // 5. Chart Badges
  const graphTempBadge = document.querySelector('.chart-card-badge.temp');
  const graphHumidBadge = document.querySelector('.chart-card-badge.humid');
  const graphLuxBadge = document.querySelector('.chart-card-badge.lux');

  if (esp32Online && data.telemetry && data.telemetry.temp !== null && data.telemetry.temp !== undefined) {
    // --- REAL ONLINE STATE ---
    const t = Number(data.telemetry.temp);
    const h = Number(data.telemetry.humid);
    const c = Number(data.telemetry.co2);
    const l = Number(data.telemetry.lux);

    // Update Home Banner
    if (homeBadge) homeBadge.className = 'banner-status-badge';
    if (homeDot) homeDot.className = 'banner-status-dot';
    if (homeText) homeText.textContent = `เชื่อมต่อ ESP32 สำเร็จ (${data.secondsAgo !== null ? data.secondsAgo + 's' : 'Online'})`;

    // Update Sensors
    if (tempEl) tempEl.textContent = `${t.toFixed(1)} °C`;
    if (humidEl) humidEl.textContent = `${h.toFixed(1)} %`;
    if (co2El) co2El.textContent = `${c} ppm`;
    if (luxEl) luxEl.textContent = `${l} lux`;

    // Update Settings Card
    if (bridgeDot) bridgeDot.className = 'esp32-bridge-dot';
    if (bridgeTitle) bridgeTitle.textContent = 'สถานะ ESP32: ออนไลน์';
    if (bridgeBadge) {
      bridgeBadge.className = 'esp32-badge-tag';
      bridgeBadge.textContent = 'เชื่อมต่อแล้ว';
    }
    if (bridgeDesc) {
      bridgeDesc.textContent = `รับข้อมูลล่าสุดเมื่อ ${data.secondsAgo || 0} วินาทีที่แล้ว จากบอร์ด ESP32 สำเร็จ`;
    }

    // Update Device Status Page (#view-devices)
    if (devHeaderBadge) devHeaderBadge.className = 'sub-online-badge';
    if (devHeaderDot) devHeaderDot.className = 'sub-online-dot';
    if (devHeaderText) devHeaderText.textContent = 'ออนไลน์';

    if (badgeSensor) { badgeSensor.className = 'device-card-badge'; badgeSensor.textContent = 'ออนไลน์'; }
    if (badgeMist) { badgeMist.className = 'device-card-badge'; badgeMist.textContent = 'ออนไลน์'; }
    if (badgeFan) { badgeFan.className = 'device-card-badge'; badgeFan.textContent = 'ออนไลน์'; }
    if (badgeLight) { badgeLight.className = 'device-card-badge'; badgeLight.textContent = 'ออนไลน์'; }
    if (badgeBox) { badgeBox.className = 'device-card-badge'; badgeBox.textContent = 'ออนไลน์'; }

    // Automatic Threshold Check on real data
    checkThresholdsAndNotify(t, h, c);

  } else {
    // --- REAL OFFLINE STATE (No fake numbers, strictly offline as requested) ---
    // Update Home Banner
    if (homeBadge) homeBadge.className = 'banner-status-badge offline';
    if (homeDot) homeDot.className = 'banner-status-dot offline';
    if (homeText) homeText.textContent = 'ออฟไลน์ (รอเชื่อมต่อ ESP32)';

    // Update Sensors to placeholder
    if (tempEl) tempEl.textContent = '-- °C';
    if (humidEl) humidEl.textContent = '-- %';
    if (co2El) co2El.textContent = '-- ppm';
    if (luxEl) luxEl.textContent = '-- lux';

    // Update Settings Card
    if (bridgeDot) bridgeDot.className = 'esp32-bridge-dot offline';
    if (bridgeTitle) bridgeTitle.textContent = 'สถานะ ESP32: ออฟไลน์';
    if (bridgeBadge) {
      bridgeBadge.className = 'esp32-badge-tag offline';
      bridgeBadge.textContent = 'รอเชื่อมต่อ';
    }
    if (bridgeDesc) {
      bridgeDesc.textContent = 'ยังไม่มีสัญญาณจากบอร์ด ESP32 เข้าสู่ฐานข้อมูล ระบบจะแสดงสถานะออฟไลน์ตามจริง';
    }

    // Update Device Status Page (#view-devices)
    if (devHeaderBadge) devHeaderBadge.className = 'sub-online-badge offline';
    if (devHeaderDot) devHeaderDot.className = 'sub-online-dot offline';
    if (devHeaderText) devHeaderText.textContent = 'ออฟไลน์';

    if (badgeSensor) { badgeSensor.className = 'device-card-badge offline'; badgeSensor.textContent = 'ออฟไลน์'; }
    if (badgeMist) { badgeMist.className = 'device-card-badge offline'; badgeMist.textContent = 'ออฟไลน์'; }
    if (badgeFan) { badgeFan.className = 'device-card-badge offline'; badgeFan.textContent = 'ออฟไลน์'; }
    if (badgeLight) { badgeLight.className = 'device-card-badge offline'; badgeLight.textContent = 'ออฟไลน์'; }
    if (badgeBox) { badgeBox.className = 'device-card-badge offline'; badgeBox.textContent = 'ออฟไลน์'; }
  }

  // 5. Update Real Charts Dynamically
  window.latestEsp32Data = data;
  if (window.renderAllEsp32Charts) {
    window.renderAllEsp32Charts(data.history || [], esp32Online, data.telemetry);
  }
}

function startEsp32Polling() {
  fetchEsp32Telemetry();
  setInterval(fetchEsp32Telemetry, 3000);
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

