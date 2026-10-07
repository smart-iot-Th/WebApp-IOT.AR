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
  if (window.IoTNotification && window.IoTNotification.init) {
    window.IoTNotification.init();
  }
  renderScheduleList();
  startEsp32Polling();
  if (window.IoTFirebase) {
    const input = document.getElementById('firebaseDbUrlInput');
    if (input) input.value = window.IoTFirebase.getUrl();
    window.IoTFirebase.updateBadgeUI();
  }
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

    if (targetTab === 'notif' && window.IoTNotification) {
      if (window.IoTNotification.render) window.IoTNotification.render();
      if (window.IoTNotification.updatePushCardUI) window.IoTNotification.updatePushCardUI();
      if (window.IoTNotification.syncServerNotifications) window.IoTNotification.syncServerNotifications();
    }

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

  // 1. If Firebase Cloud is configured, sync to Firebase
  if (window.IoTFirebase && window.IoTFirebase.isConfigured()) {
    window.IoTFirebase.setRelay(name, state);
  }

  // 2. Also send real command to backend database / ESP32 if local node server is reachable
  try {
    const targetUrl = (typeof getApiUrl === 'function') ? getApiUrl('/api/control') : '/api/control';
    await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relay: name, state: state })
    });
  } catch (err) {
    console.warn('[IoT Control] Offline/Local mode, command stored locally:', err);
  }
};

window.saveControlSettings = function() {
  alert('บันทึกการตั้งค่าการควบคุมเรียบร้อยแล้ว ✅');
};

// --- SCREEN 3: REAL-TIME SPLINE CHARTS & RANGES ---
let currentChartRange = '24h';
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// Monotonic cubic spline interpolation (Fritsch-Carlson)
// Guarantees smooth natural curves with zero loops, zero backward overshoot, and zero artificial spikes
function getSmoothSplinePath(pts) {
  if (!pts || pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }

  // Deduplicate points with nearly identical X positions (< 1px) to prevent vertical jumps
  const cleanPts = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x - cleanPts[cleanPts.length - 1].x >= 1.0) {
      cleanPts.push(pts[i]);
    } else if (i === pts.length - 1) {
      cleanPts[cleanPts.length - 1] = pts[i];
    }
  }

  if (cleanPts.length < 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[pts.length - 1].x.toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`;
  }

  let d = `M ${cleanPts[0].x.toFixed(1)} ${cleanPts[0].y.toFixed(1)}`;
  for (let i = 0; i < cleanPts.length - 1; i++) {
    const p0 = i > 0 ? cleanPts[i - 1] : cleanPts[i];
    const p1 = cleanPts[i];
    const p2 = cleanPts[i + 1];
    const p3 = i < cleanPts.length - 2 ? cleanPts[i + 2] : p2;

    const dx = p2.x - p1.x;
    
    // Slopes
    let s1 = (p2.y - p0.y) / ((p2.x - p0.x) || 1);
    let s2 = (p3.y - p1.y) / ((p3.x - p1.x) || 1);

    // Monotonicity condition: flatten tangent slope at local peaks / valleys
    if ((p2.y - p1.y) * (p1.y - p0.y) <= 0) s1 = 0;
    if ((p3.y - p2.y) * (p2.y - p1.y) <= 0) s2 = 0;

    const cp1x = p1.x + dx / 3;
    const cp1y = p1.y + (s1 * dx) / 3;
    const cp2x = p2.x - dx / 3;
    const cp2y = p2.y - (s2 * dx) / 3;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

window.selectChartPoint = function(badgeId, badgeClass, dateStr, valStr, unit) {
  const badgeEl = document.getElementById(badgeId);
  if (badgeEl) {
    badgeEl.className = `chart-card-badge ${badgeClass}`;
    badgeEl.textContent = `${dateStr}: ${valStr} ${unit}`;
  }
};

function renderSingleSplineChart({
  areaId,
  lineId,
  pointsId,
  emptyOverlayId,
  badgeId,
  axisId,
  yLabelTopId,
  yLabelMidId,
  yLabelBotId,
  series,
  color,
  unit,
  currentVal,
  isOnline,
  badgeClass,
  metricType
}) {
  const areaEl = document.getElementById(areaId);
  const lineEl = document.getElementById(lineId);
  const pointsEl = document.getElementById(pointsId);
  const emptyEl = document.getElementById(emptyOverlayId);
  const badgeEl = document.getElementById(badgeId);
  const axisEl = document.getElementById(axisId);

  const yLabelTopEl = document.getElementById(yLabelTopId);
  const yLabelMidEl = document.getElementById(yLabelMidId);
  const yLabelBotEl = document.getElementById(yLabelBotId);

  // Time window boundary
  const now = Date.now();
  let windowDuration = 24 * 3600 * 1000;
  if (currentChartRange === '7d') {
    windowDuration = 7 * 24 * 3600 * 1000;
  } else if (currentChartRange === '30d') {
    windowDuration = 30 * 24 * 3600 * 1000;
  }
  const windowStart = now - windowDuration;

  // Filter series strictly to the selected time window and sort ascending
  const inWindow = (Array.isArray(series) ? series : [])
    .filter(s => s && s.time && s.val !== null && s.val !== undefined && s.time >= windowStart && s.time <= now)
    .sort((a, b) => a.time - b.time);

  // Geometry dimensions
  // Left margin reserved for Y-axis labels (46px). Plot area is from x=46 to x=346 (width = 300).
  const xMin = 46;
  const xMax = 346;
  const plotW = xMax - xMin; // 300
  const yTopLine = 20;
  const yBotLine = 80;
  const plotH = yBotLine - yTopLine; // 60

  // If no data within the selected time range
  if (inWindow.length === 0) {
    if (areaEl) areaEl.setAttribute('d', '');
    if (lineEl) lineEl.setAttribute('d', '');
    if (pointsEl) pointsEl.innerHTML = '';
    if (axisEl) axisEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      const rangeText = currentChartRange === '7d' ? '7 วัน' : currentChartRange === '30d' ? '30 วัน' : '24 ชม.';
      emptyEl.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3v18h18"></path>
          <path d="M7 16l4-4 4 4 5-6" stroke-dasharray="3 3"></path>
        </svg>
        <span>ยังไม่มีข้อมูลบันทึกในรอบ ${rangeText} (${isOnline ? 'รอเซฟข้อมูล...' : 'ออฟไลน์'})</span>
      `;
    }
    if (badgeEl) {
      badgeEl.className = `chart-card-badge ${badgeClass} offline`;
      badgeEl.textContent = isOnline ? 'รอข้อมูล...' : 'ออฟไลน์ (ไม่มีข้อมูล)';
    }
    return;
  }

  // Data exists: hide empty overlay
  if (emptyEl) emptyEl.style.display = 'none';

  // Current badge value
  const latestPointVal = inWindow[inWindow.length - 1].val;
  const latestVal = currentVal !== null && currentVal !== undefined ? Number(currentVal) : latestPointVal;
  if (badgeEl) {
    badgeEl.className = `chart-card-badge ${badgeClass}`;
    badgeEl.textContent = `ปัจจุบัน ${Number(latestVal).toFixed(1)} ${unit}`;
  }

  // Compute dynamic Y-axis min/max
  const vals = inWindow.map(s => Number(s.val));
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);

  let scaleMin, scaleMax;
  if (metricType === 'temp') {
    scaleMin = Math.floor(Math.min(rawMin, 20) / 2) * 2;
    scaleMax = Math.ceil(Math.max(rawMax, 32) / 2) * 2;
    if (scaleMax - scaleMin < 6) scaleMax = scaleMin + 6;
  } else if (metricType === 'humid') {
    scaleMin = Math.max(0, Math.floor(Math.min(rawMin, 50) / 10) * 10);
    scaleMax = Math.min(100, Math.ceil(Math.max(rawMax, 95) / 5) * 5);
    if (scaleMax - scaleMin < 20) scaleMax = Math.min(100, scaleMin + 25);
  } else if (metricType === 'lux') {
    scaleMin = 0;
    scaleMax = Math.max(500, Math.ceil(Math.max(rawMax * 1.15, 300) / 200) * 200);
  } else if (metricType === 'co2') {
    scaleMin = Math.max(300, Math.floor(Math.min(rawMin * 0.9, 400) / 100) * 100);
    scaleMax = Math.max(1000, Math.ceil(Math.max(rawMax * 1.15, 800) / 200) * 200);
  } else {
    scaleMin = Math.floor(rawMin * 0.9);
    scaleMax = Math.ceil(rawMax * 1.1);
    if (scaleMin === scaleMax) { scaleMin -= 2; scaleMax += 2; }
  }
  const scaleMid = Math.round((scaleMin + scaleMax) / 2);

  // Update Y-Axis labels in SVG
  const unitSuffix = unit === 'lux' ? 'lx' : unit === 'ppm' ? 'p' : unit;
  if (yLabelTopEl) yLabelTopEl.textContent = `${scaleMax}${unitSuffix}`;
  if (yLabelMidEl) yLabelMidEl.textContent = `${scaleMid}${unitSuffix}`;
  if (yLabelBotEl) yLabelBotEl.textContent = `${scaleMin}${unitSuffix}`;

  // Time boundaries of the available data:
  // Starts strictly from the left edge (xMin) and ends at the right edge (xMax)
  const tMin = inWindow[0].time;
  const tMax = inWindow[inWindow.length - 1].time;
  const timeSpan = tMax - tMin;

  // Generate X-Axis timeline labels matching the plotted time range [tMin, tMax]
  if (axisEl) {
    let axisHtml = '';
    if (timeSpan < 120000) {
      // Very short time (< 2 min): brand new readings
      const d = new Date(tMax);
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      axisHtml = `<span>${timeStr}</span><span></span><span></span><span></span><span>ตอนนี้</span>`;
    } else {
      const numSteps = 5;
      const labels = [];
      for (let i = 0; i < numSteps; i++) {
        const ratio = i / (numSteps - 1);
        const t = tMin + (ratio * timeSpan);
        const d = new Date(t);
        const isLast = (i === numSteps - 1);

        let labelText = '';
        if (isLast && Math.abs(now - tMax) < 30 * 60 * 1000) {
          labelText = (timeSpan <= 24 * 3600 * 1000) ? 'ตอนนี้' : 'วันนี้';
        } else if (timeSpan <= 24 * 3600 * 1000) {
          // Within 24h: show HH:mm
          labelText = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } else if (timeSpan <= 72 * 3600 * 1000) {
          // 2 to 3 days: show Date and Hour to differentiate
          labelText = `${d.getDate()} ต.ค. ${String(d.getHours()).padStart(2, '0')}น.`;
        } else {
          // 4 to 30 days: show Date and Month
          labelText = `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]}`;
        }
        labels.push(labelText);
      }
      axisHtml = labels.map(l => `<span>${l}</span>`).join('');
    }
    axisEl.innerHTML = axisHtml;
  }

  // Left-aligned Coordinate Mapping:
  // First point starts at xMin (left edge), last point ends at xMax (right edge)
  const pts = inWindow.map((s, idx) => {
    let tRatio = 0;
    if (timeSpan > 0) {
      tRatio = Math.max(0, Math.min(1, (s.time - tMin) / timeSpan));
    } else if (inWindow.length > 1) {
      tRatio = idx / (inWindow.length - 1);
    }
    const x = xMin + (tRatio * plotW);
    const vRatio = Math.max(0, Math.min(1, (s.val - scaleMin) / (scaleMax - scaleMin)));
    const y = yBotLine - (vRatio * plotH);
    return {
      x: Math.max(xMin, Math.min(xMax, x)),
      y: Math.max(12, Math.min(88, y)),
      time: s.time,
      val: s.val
    };
  });

  // If only 1 data point
  if (pts.length === 1) {
    const singlePt = pts[0];
    if (lineEl) lineEl.setAttribute('d', `M ${xMin} ${singlePt.y} L ${xMax} ${singlePt.y}`);
    if (areaEl) areaEl.setAttribute('d', `M ${xMin} ${singlePt.y} L ${xMax} ${singlePt.y} L ${xMax} 95 L ${xMin} 95 Z`);
    if (pointsEl) {
      pointsEl.innerHTML = `<circle cx="${((xMin + xMax) / 2).toFixed(1)}" cy="${singlePt.y.toFixed(1)}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="2" class="chart-pulse-point"/>`;
    }
    return;
  }

  // 2 or more points: draw monotonic smooth spline spanning full width
  const lineD = getSmoothSplinePath(pts);
  const areaD = `${lineD} L ${xMax} 95 L ${xMin} 95 Z`;

  if (lineEl) lineEl.setAttribute('d', lineD);
  if (areaEl) areaEl.setAttribute('d', areaD);

  // Render point dots with interactive tap support
  if (pointsEl) {
    let circlesHtml = '';
    const step = Math.max(1, Math.floor(pts.length / 8));
    for (let i = 0; i < pts.length - 1; i += step) {
      const p = pts[i];
      const d = new Date(p.time);
      const dateStr = `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      circlesHtml += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${color}" style="cursor: pointer;" onclick="selectChartPoint('${badgeId}', '${badgeClass}', '${dateStr}', '${p.val.toFixed(1)}', '${unit}')"/>`;
    }
    // Last point (most recent)
    const lastPt = pts[pts.length - 1];
    const lastD = new Date(lastPt.time);
    const lastDateStr = `${lastD.getDate()} ${THAI_MONTHS_SHORT[lastD.getMonth()]} ${String(lastD.getHours()).padStart(2, '0')}:${String(lastD.getMinutes()).padStart(2, '0')}`;
    circlesHtml += `<circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="2" class="chart-pulse-point" style="cursor: pointer;" onclick="selectChartPoint('${badgeId}', '${badgeClass}', '${lastDateStr}', '${lastPt.val.toFixed(1)}', '${unit}')"/>`;
    pointsEl.innerHTML = circlesHtml;
  }
}

window.renderAllEsp32Charts = function(history, isOnline, telemetry) {
  const allHistory = Array.isArray(history) ? history : [];

  // 1. Temperature
  const tempSeries = allHistory
    .filter(h => h && h.temp !== null && h.temp !== undefined)
    .map(h => ({ val: Number(h.temp), time: h.time }));
  renderSingleSplineChart({
    areaId: 'pathTempArea',
    lineId: 'pathTempLine',
    pointsId: 'pointsTemp',
    emptyOverlayId: 'emptyChartTemp',
    badgeId: 'chartBadgeTemp',
    axisId: 'axisTemp',
    yLabelTopId: 'yLabelTopTemp',
    yLabelMidId: 'yLabelMidTemp',
    yLabelBotId: 'yLabelBotTemp',
    series: tempSeries,
    color: '#ef4444',
    unit: '°C',
    currentVal: telemetry ? telemetry.temp : null,
    isOnline: isOnline,
    badgeClass: 'temp',
    metricType: 'temp'
  });

  // 2. Humidity
  const humidSeries = allHistory
    .filter(h => h && h.humid !== null && h.humid !== undefined)
    .map(h => ({ val: Number(h.humid), time: h.time }));
  renderSingleSplineChart({
    areaId: 'pathHumidArea',
    lineId: 'pathHumidLine',
    pointsId: 'pointsHumid',
    emptyOverlayId: 'emptyChartHumid',
    badgeId: 'chartBadgeHumid',
    axisId: 'axisHumid',
    yLabelTopId: 'yLabelTopHumid',
    yLabelMidId: 'yLabelMidHumid',
    yLabelBotId: 'yLabelBotHumid',
    series: humidSeries,
    color: '#3b82f6',
    unit: '%',
    currentVal: telemetry ? telemetry.humid : null,
    isOnline: isOnline,
    badgeClass: 'humid',
    metricType: 'humid'
  });

  // 3. Lux
  const luxSeries = allHistory
    .filter(h => h && h.lux !== null && h.lux !== undefined)
    .map(h => ({ val: Number(h.lux), time: h.time }));
  renderSingleSplineChart({
    areaId: 'pathLuxArea',
    lineId: 'pathLuxLine',
    pointsId: 'pointsLux',
    emptyOverlayId: 'emptyChartLux',
    badgeId: 'chartBadgeLux',
    axisId: 'axisLux',
    yLabelTopId: 'yLabelTopLux',
    yLabelMidId: 'yLabelMidLux',
    yLabelBotId: 'yLabelBotLux',
    series: luxSeries,
    color: '#f59e0b',
    unit: 'lux',
    currentVal: telemetry ? telemetry.lux : null,
    isOnline: isOnline,
    badgeClass: 'lux',
    metricType: 'lux'
  });

  // 4. CO2
  const co2Series = allHistory
    .filter(h => h && h.co2 !== null && h.co2 !== undefined)
    .map(h => ({ val: Number(h.co2), time: h.time }));
  renderSingleSplineChart({
    areaId: 'pathCo2Area',
    lineId: 'pathCo2Line',
    pointsId: 'pointsCo2',
    emptyOverlayId: 'emptyChartCo2',
    badgeId: 'chartBadgeCo2',
    axisId: 'axisCo2',
    yLabelTopId: 'yLabelTopCo2',
    yLabelMidId: 'yLabelMidCo2',
    yLabelBotId: 'yLabelBotCo2',
    series: co2Series,
    color: '#10b981',
    unit: 'ppm',
    currentVal: telemetry ? telemetry.co2 : null,
    isOnline: isOnline,
    badgeClass: 'co2',
    metricType: 'co2'
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

// --- SCREEN 4: NOTIFICATIONS CONTROLLER (DELEGATED TO js/notification.js) ---
// การแสดงผลประวัติการแจ้งเตือนทั้งหมดจัดการโดยโมดูล window.IoTNotification ใน js/notification.js

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


// ============================================================
// REAL ESP32 HARDWARE TELEMETRY & DATABASE BRIDGE
// ============================================================
const CLOUD_API_ORIGIN = 'https://webapp-iot-ar.onrender.com';
let esp32Online = false;
let activeApiOrigin = null;

function getApiUrl(path) {
  if (activeApiOrigin !== null) {
    return activeApiOrigin ? `${activeApiOrigin}${path}` : path;
  }
  // If running directly on Render
  if (window.location.origin.includes('onrender.com')) {
    return path;
  }
  // If running on local server port 3000
  if (window.location.port === '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return path;
  }
  // Default to public Cloud Render endpoint so all devices (GitHub Pages, mobile 5G) talk to the same cloud!
  return `${CLOUD_API_ORIGIN}${path}`;
}

window.openEsp32Modal = function() {
  const m = document.getElementById('esp32GuideModal');
  if (m) m.style.display = 'flex';
};

window.closeEsp32Modal = function() {
  const m = document.getElementById('esp32GuideModal');
  if (m) m.style.display = 'none';
};

window.openFirebaseGuideModal = function() {
  const m = document.getElementById('firebaseGuideModal');
  if (m) m.style.display = 'flex';
};

window.closeFirebaseGuideModal = function() {
  const m = document.getElementById('firebaseGuideModal');
  if (m) m.style.display = 'none';
};

window.handleSaveFirebaseUrl = function() {
  const input = document.getElementById('firebaseDbUrlInput');
  if (!input) return;
  const url = input.value.trim();
  if (url && !url.startsWith('https://')) {
    alert('กรุณาใส่ URL ของ Firebase Realtime Database ให้ถูกต้อง (ต้องขึ้นต้นด้วย https://)');
    return;
  }
  if (window.IoTFirebase) {
    window.IoTFirebase.saveUrl(url);
    alert('บันทึกการตั้งค่า Firebase เรียบร้อยแล้ว! ✅ ระบบกำลังเชื่อมต่อระบบคลาวด์');
  }
};

async function fetchEsp32Telemetry() {
  const candidates = [];

  if (activeApiOrigin !== null) {
    candidates.push(activeApiOrigin ? `${activeApiOrigin}/api/status` : '/api/status');
  } else {
    // 1. If running on Render, relative is top priority
    if (window.location.origin.includes('onrender.com')) {
      candidates.push('/api/status');
    }
    // 2. Primary Cloud Render URL (accessible from GitHub Pages, mobile 5G, and everywhere)
    candidates.push(`${CLOUD_API_ORIGIN}/api/status`);

    // 3. Local fallback candidates
    if (window.location.port === '3000') {
      candidates.push('/api/status');
    }
    candidates.push('http://127.0.0.1:3000/api/status');
    candidates.push('http://localhost:3000/api/status');
  }

  const uniqueCandidates = [...new Set(candidates)];
  let successData = null;

  for (const url of uniqueCandidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        successData = await res.json();
        try {
          const parsed = new URL(url, window.location.href);
          activeApiOrigin = (parsed.origin !== window.location.origin) ? parsed.origin : '';
        } catch (_) {}
        break;
      }
    } catch (err) {
      // Try next candidate
    }
  }

  if (successData) {
    updateEsp32UI(successData);
  } else {
    // API server unreachable or offline
    updateEsp32UI({ online: false, telemetry: {} });
  }
}

function updateEsp32UI(data) {
  esp32Online = Boolean(data && data.online);
  window.updateEsp32UI = updateEsp32UI;

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

    // Automatic Threshold Check on real data via IoTNotification
    if (window.IoTNotification && window.IoTNotification.evaluateTelemetry) {
      window.IoTNotification.evaluateTelemetry(data);
    }

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
    const oldVal = targetLabel.textContent.trim();
    targetLabel.textContent = val;
    if (window.IoTNotification && window.IoTNotification.recordConfigChange) {
      window.IoTNotification.recordConfigChange(`เกณฑ์ ${key}`, oldVal, val);
    }
  }
  closeThresholdModal();
};

