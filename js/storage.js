/**
 * Smart Farm IoT Storage & State Manager
 */

const STORAGE_KEYS = {
  THEME: 'smartfarm_theme',
  DEVICES: 'smartfarm_devices',
  CONTROL_MODE: 'smartfarm_control_mode',
  SENSOR_TARGETS: 'smartfarm_targets',
  NOTIFS: 'smartfarm_notifs'
};

const DEFAULT_DEVICES = {
  fogger: true,   // ระบบพ่นหมอก
  fan: true,      // พัดลมระบายอากาศ
  light: false,   // ไฟส่องสว่าง
  curtain: true   // ม่านเปิดลมระบาย
};

const DEFAULT_TARGETS = {
  tempMin: 24,
  tempMax: 28,
  humidMin: 80,
  humidMax: 90,
  co2Max: 1000,
  luxMin: 200,
  luxMax: 1000
};

const DEFAULT_NOTIFS = [
  {
    id: 'n-1',
    type: 'warning',
    category: 'warning',
    title: 'อุณหภูมิสูงเกินกำหนด',
    time: 'วันนี้ 14:25',
    detail: 'อุณหภูมิ 31.2 °C (เกณฑ์: 24 - 28 °C)',
    read: false
  },
  {
    id: 'n-2',
    type: 'info',
    category: 'warning',
    title: 'ความชื้นต่ำกว่ากำหนด',
    time: 'วันนี้ 10:18',
    detail: 'ความชื้น 58 % (เกณฑ์: 80 - 90 %)',
    read: false
  },
  {
    id: 'n-3',
    type: 'success',
    category: 'system',
    title: 'ระบบพ่นหมอกทำงาน',
    time: 'วันนี้ 09:30',
    detail: 'เริ่มพ่นหมอกอัตโนมัติตามตารางเวลา',
    read: true
  },
  {
    id: 'n-4',
    type: 'neutral',
    category: 'system',
    title: 'พัดลมระบายอากาศหยุดทำงาน',
    time: 'วันนี้ 08:12',
    detail: 'รอบการทำงานเสร็จสิ้น สถานะปกติ',
    read: true
  },
  {
    id: 'n-5',
    type: 'light',
    category: 'message',
    title: 'ไฟ LED ส่องสว่างเปิด',
    time: 'เมื่อวาน 18:00',
    detail: 'ทำงานตามเวลาที่ตั้งไว้',
    read: true
  }
];

const FarmStorage = {
  getTheme() {
    return localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
  },

  setTheme(theme) {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
    document.documentElement.setAttribute('data-theme', theme);
  },

  getControlMode() {
    return localStorage.getItem(STORAGE_KEYS.CONTROL_MODE) || 'auto';
  },

  setControlMode(mode) {
    localStorage.setItem(STORAGE_KEYS.CONTROL_MODE, mode);
  },

  getDevices() {
    const data = localStorage.getItem(STORAGE_KEYS.DEVICES);
    if (!data) {
      localStorage.setItem(STORAGE_KEYS.DEVICES, JSON.stringify(DEFAULT_DEVICES));
      return { ...DEFAULT_DEVICES };
    }
    return JSON.parse(data);
  },

  setDevice(name, state) {
    const devices = this.getDevices();
    devices[name] = state;
    localStorage.setItem(STORAGE_KEYS.DEVICES, JSON.stringify(devices));
    return devices;
  },

  getTargets() {
    const data = localStorage.getItem(STORAGE_KEYS.SENSOR_TARGETS);
    if (!data) return DEFAULT_TARGETS;
    return JSON.parse(data);
  },

  getNotifs() {
    const data = localStorage.getItem(STORAGE_KEYS.NOTIFS);
    if (!data) {
      localStorage.setItem(STORAGE_KEYS.NOTIFS, JSON.stringify(DEFAULT_NOTIFS));
      return DEFAULT_NOTIFS;
    }
    return JSON.parse(data);
  },

  saveNotifs(notifs) {
    localStorage.setItem(STORAGE_KEYS.NOTIFS, JSON.stringify(notifs));
    return notifs;
  },

  addNotif(item) {
    const notifs = this.getNotifs();
    const newNotif = {
      id: 'n-' + Date.now(),
      read: false,
      ...item
    };
    notifs.unshift(newNotif);
    // Keep max 50 recent records
    if (notifs.length > 50) notifs.pop();
    this.saveNotifs(notifs);
    return newNotif;
  },

  deleteNotif(id) {
    let notifs = this.getNotifs();
    notifs = notifs.filter(n => n.id !== id);
    this.saveNotifs(notifs);
    return notifs;
  },

  markAllNotifsRead() {
    const notifs = this.getNotifs().map(n => ({ ...n, read: true }));
    this.saveNotifs(notifs);
    return notifs;
  },

  markNotifRead(id) {
    const notifs = this.getNotifs().map(n => n.id === id ? { ...n, read: true } : n);
    this.saveNotifs(notifs);
    return notifs;
  },

  clearAllNotifs() {
    this.saveNotifs([]);
    return [];
  },

  getUnreadCount() {
    const notifs = this.getNotifs();
    return notifs.filter(n => !n.read).length;
  }
};

window.FarmStorage = FarmStorage;
