/**
 * NovaHub LocalStorage Manager
 * Stores and manages shortcuts, tasks, notes, and finance logs locally.
 */

const STORAGE_KEYS = {
  SHORTCUTS: 'novahub_shortcuts',
  TASKS: 'novahub_tasks',
  NOTES: 'novahub_notes',
  FINANCE: 'novahub_finance',
  SETTINGS: 'novahub_settings'
};

// Default Curated Shortcuts
const DEFAULT_SHORTCUTS = [
  {
    id: 'sc-1',
    name: 'Google',
    url: 'https://www.google.com',
    iconType: 'search',
    color: '#4285F4'
  },
  {
    id: 'sc-2',
    name: 'YouTube',
    url: 'https://www.youtube.com',
    iconType: 'video',
    color: '#FF0000'
  },
  {
    id: 'sc-3',
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    iconType: 'sparkles',
    color: '#10A37F'
  },
  {
    id: 'sc-4',
    name: 'Facebook',
    url: 'https://www.facebook.com',
    iconType: 'globe',
    color: '#1877F2'
  },
  {
    id: 'sc-5',
    name: 'GitHub',
    url: 'https://github.com',
    iconType: 'code',
    color: '#8b5cf6'
  },
  {
    id: 'sc-6',
    name: 'Notion',
    url: 'https://www.notion.so',
    iconType: 'file-text',
    color: '#f59e0b'
  },
  {
    id: 'sc-7',
    name: 'Canva',
    url: 'https://www.canva.com',
    iconType: 'palette',
    color: '#06b6d4'
  }
];

// Default Tasks
const DEFAULT_TASKS = [
  { id: 'task-1', title: 'เพิ่ม NovaHub ลงหน้าจอโฮมมือถือ', completed: false, tag: 'การติดตั้ง' },
  { id: 'task-2', title: 'ทดลองกดเปิดแอปผ่านไอคอนบนมือถือ', completed: false, tag: 'ทดสอบ' },
  { id: 'task-3', title: 'เพิ่มลิงก์หรือเว็บไซต์ที่ใช้ประจำ', completed: true, tag: 'เริ่มต้น' }
];

// Default Notes
const DEFAULT_NOTES = [
  {
    id: 'note-1',
    title: 'ยินดีต้อนรับสู่ NovaHub 🚀',
    body: 'แอปนี้เป็น Progressive Web App (PWA) เต็มรูปแบบ เมื่อคุณกด "เพิ่มไปยังหน้าจอโฮม" ใน Safari (iOS) หรือ Chrome (Android) แอปนี้จะเปิดแบบเต็มจอ 100% ไร้แถบ URL ด้านบน สามารถเข้าใช้งานได้จากทุกที่ที่มีอินเทอร์เน็ต!',
    date: new Date().toLocaleDateString('th-TH')
  }
];

// Default Finance
const DEFAULT_FINANCE = [
  { id: 'fin-1', title: 'เงินเดือน / รายได้', amount: 35000, type: 'income', date: 'วันนี้', icon: '💰' },
  { id: 'fin-2', title: 'อาหาร & กาแฟ', amount: 240, type: 'expense', date: 'วันนี้', icon: '☕' },
  { id: 'fin-3', title: 'อินเทอร์เน็ต / ค่าบริการ', amount: 599, type: 'expense', date: 'เมื่อวาน', icon: '📶' }
];

const Storage = {
  getShortcuts() {
    const data = localStorage.getItem(STORAGE_KEYS.SHORTCUTS);
    if (!data) {
      localStorage.setItem(STORAGE_KEYS.SHORTCUTS, JSON.stringify(DEFAULT_SHORTCUTS));
      return DEFAULT_SHORTCUTS;
    }
    return JSON.parse(data);
  },

  saveShortcut(shortcut) {
    const list = this.getShortcuts();
    list.push(shortcut);
    localStorage.setItem(STORAGE_KEYS.SHORTCUTS, JSON.stringify(list));
    return list;
  },

  deleteShortcut(id) {
    let list = this.getShortcuts();
    list = list.filter(item => item.id !== id);
    localStorage.setItem(STORAGE_KEYS.SHORTCUTS, JSON.stringify(list));
    return list;
  },

  getTasks() {
    const data = localStorage.getItem(STORAGE_KEYS.TASKS);
    if (!data) {
      localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(DEFAULT_TASKS));
      return DEFAULT_TASKS;
    }
    return JSON.parse(data);
  },

  saveTask(task) {
    const list = this.getTasks();
    list.unshift(task);
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(list));
    return list;
  },

  toggleTask(id) {
    const list = this.getTasks();
    const item = list.find(t => t.id === id);
    if (item) {
      item.completed = !item.completed;
      localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(list));
    }
    return list;
  },

  deleteTask(id) {
    let list = this.getTasks();
    list = list.filter(item => item.id !== id);
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(list));
    return list;
  },

  getNotes() {
    const data = localStorage.getItem(STORAGE_KEYS.NOTES);
    if (!data) {
      localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(DEFAULT_NOTES));
      return DEFAULT_NOTES;
    }
    return JSON.parse(data);
  },

  saveNote(note) {
    const list = this.getNotes();
    list.unshift(note);
    localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(list));
    return list;
  },

  deleteNote(id) {
    let list = this.getNotes();
    list = list.filter(item => item.id !== id);
    localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(list));
    return list;
  },

  getFinance() {
    const data = localStorage.getItem(STORAGE_KEYS.FINANCE);
    if (!data) {
      localStorage.setItem(STORAGE_KEYS.FINANCE, JSON.stringify(DEFAULT_FINANCE));
      return DEFAULT_FINANCE;
    }
    return JSON.parse(data);
  },

  saveTransaction(item) {
    const list = this.getFinance();
    list.unshift(item);
    localStorage.setItem(STORAGE_KEYS.FINANCE, JSON.stringify(list));
    return list;
  },

  exportAllData() {
    const backup = {
      shortcuts: this.getShortcuts(),
      tasks: this.getTasks(),
      notes: this.getNotes(),
      finance: this.getFinance(),
      exportedAt: new Date().toISOString()
    };
    return JSON.stringify(backup, null, 2);
  },

  importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.shortcuts) localStorage.setItem(STORAGE_KEYS.SHORTCUTS, JSON.stringify(data.shortcuts));
      if (data.tasks) localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(data.tasks));
      if (data.notes) localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(data.notes));
      if (data.finance) localStorage.setItem(STORAGE_KEYS.FINANCE, JSON.stringify(data.finance));
      return true;
    } catch (e) {
      console.error('Invalid backup JSON', e);
      return false;
    }
  }
};

window.NovaStorage = Storage;
