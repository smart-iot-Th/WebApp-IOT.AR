/**
 * NovaHub Main Application Logic
 * Navigation, UI Rendering, Interactions, and State Management
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize PWA Controller
  NovaPWA.init();

  // Initialize UI & Components
  initDateTime();
  initNavigation();
  renderAllData();
  setupEventListeners();
});

// Real-time Clock & Thai Date Formatter
function initDateTime() {
  const dateEl = document.getElementById('currentDateText');
  const clockEl = document.getElementById('currentTimeText');

  const updateTime = () => {
    const now = new Date();
    
    // Thai Date format options
    const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];

    const dayName = thaiDays[now.getDay()];
    const dateNum = now.getDate();
    const monthName = thaiMonths[now.getMonth()];
    const yearBE = now.getFullYear() + 543;

    if (dateEl) {
      dateEl.textContent = `วัน${dayName}ที่ ${dateNum} ${monthName} ${yearBE}`;
    }

    if (clockEl) {
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      clockEl.textContent = `${hours}:${minutes}:${seconds}`;
    }
  };

  updateTime();
  setInterval(updateTime, 1000);
}

// Bottom Tab Navigation Logic
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  const tabPanels = document.querySelectorAll('.tab-panel');

  const switchTab = (targetId) => {
    navButtons.forEach(btn => {
      const isTarget = btn.getAttribute('data-tab') === targetId;
      btn.classList.toggle('active', isTarget);
    });

    tabPanels.forEach(panel => {
      const isTarget = panel.id === `tab-${targetId}`;
      panel.classList.toggle('active', isTarget);
    });

    // Scroll to top of app body on tab change
    const body = document.getElementById('appBody');
    if (body) body.scrollTo({ top: 0, behavior: 'smooth' });
  };

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Handle URL hash on launch
  const hash = window.location.hash.replace('#', '');
  if (hash && ['hub', 'notes', 'tools', 'guide'].includes(hash)) {
    switchTab(hash);
  }
}

// Icon Helper for Shortcuts
function getShortcutIconSvg(iconType, color) {
  const icons = {
    search: `<path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35"/>`,
    video: `<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>`,
    sparkles: `<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>`,
    globe: `<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>`,
    code: `<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`,
    'file-text': `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
    palette: `<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z"/>`,
    external: `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`
  };

  const path = icons[iconType] || icons['external'];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color || '#818cf8'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

// Render All Components
function renderAllData() {
  renderShortcuts();
  renderTasks();
  renderNotes();
  renderFinance();
}

// Render Shortcuts Grid
function renderShortcuts() {
  const container = document.getElementById('shortcutsGrid');
  if (!container) return;

  const shortcuts = NovaStorage.getShortcuts();
  let html = '';

  shortcuts.forEach(item => {
    html += `
      <div class="shortcut-item" data-id="${item.id}">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit; display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <div class="shortcut-icon-box" style="border-color: ${item.color}40; background: radial-gradient(circle at 50% 0%, ${item.color}20, transparent 75%), var(--bg-card);">
            ${getShortcutIconSvg(item.iconType, item.color)}
          </div>
          <span class="shortcut-name" title="${item.name}">${item.name}</span>
        </a>
      </div>
    `;
  });

  // "Add Shortcut" Button
  html += `
    <button class="shortcut-item" id="openAddShortcutBtn" type="button">
      <div class="shortcut-icon-box add-shortcut-box">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </div>
      <span class="shortcut-name" style="color: var(--primary-light);">+ เพิ่มลิงก์</span>
    </button>
  `;

  container.innerHTML = html;

  // Bind add button
  const addBtn = document.getElementById('openAddShortcutBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => openModal('addShortcutModal'));
  }
}

// Render Tasks
function renderTasks() {
  const container = document.getElementById('tasksContainer');
  if (!container) return;

  const tasks = NovaStorage.getTasks();
  if (tasks.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.85rem;">ไม่มีสิ่งที่ต้องทำในขณะนี้ 🎉</div>`;
    return;
  }

  let html = '';
  tasks.forEach(task => {
    html += `
      <div class="task-card ${task.completed ? 'completed' : ''}" data-task-id="${task.id}">
        <div class="task-left">
          <div class="task-checkbox ${task.completed ? 'checked' : ''}" onclick="toggleTaskStatus('${task.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <div class="task-content">
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-tag">🏷️ ${escapeHtml(task.tag || 'ทั่วไป')}</div>
          </div>
        </div>
        <button class="task-delete-btn" onclick="deleteTaskItem('${task.id}')" title="ลบรายการ">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
  });

  container.innerHTML = html;
}

window.toggleTaskStatus = function(id) {
  NovaStorage.toggleTask(id);
  renderTasks();
};

window.deleteTaskItem = function(id) {
  NovaStorage.deleteTask(id);
  renderTasks();
};

// Render Notes
function renderNotes() {
  const container = document.getElementById('notesContainer');
  if (!container) return;

  const notes = NovaStorage.getNotes();
  if (notes.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.85rem;">ยังไม่มีโน้ตที่บันทึกไว้</div>`;
    return;
  }

  let html = '';
  notes.forEach(note => {
    html += `
      <div class="note-card" data-note-id="${note.id}">
        <div class="note-header">
          <div class="note-title">${escapeHtml(note.title)}</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="note-date">${note.date}</span>
            <button class="task-delete-btn" onclick="deleteNoteItem('${note.id}')" style="padding: 2px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="note-body">${escapeHtml(note.body)}</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

window.deleteNoteItem = function(id) {
  NovaStorage.deleteNote(id);
  renderNotes();
};

// Render Finance Summary & Transactions
function renderFinance() {
  const listContainer = document.getElementById('transListContainer');
  const balanceEl = document.getElementById('financeBalance');
  const incomeEl = document.getElementById('financeTotalIncome');
  const expenseEl = document.getElementById('financeTotalExpense');

  const items = NovaStorage.getFinance();
  let totalIncome = 0;
  let totalExpense = 0;

  let listHtml = '';
  items.forEach(t => {
    if (t.type === 'income') totalIncome += Number(t.amount);
    if (t.type === 'expense') totalExpense += Number(t.amount);

    listHtml += `
      <div class="trans-item">
        <div class="trans-left">
          <div class="trans-icon ${t.type}">${t.icon || (t.type === 'income' ? '💵' : '💳')}</div>
          <div>
            <div class="trans-title">${escapeHtml(t.title)}</div>
            <div class="trans-sub">${t.date}</div>
          </div>
        </div>
        <div class="trans-amount ${t.type}">
          ${t.type === 'income' ? '+' : '-'}฿${Number(t.amount).toLocaleString('th-TH')}
        </div>
      </div>
    `;
  });

  const netBalance = totalIncome - totalExpense;

  if (balanceEl) balanceEl.textContent = `฿${netBalance.toLocaleString('th-TH')}`;
  if (incomeEl) incomeEl.textContent = `+฿${totalIncome.toLocaleString('th-TH')}`;
  if (expenseEl) expenseEl.textContent = `-฿${totalExpense.toLocaleString('th-TH')}`;
  if (listContainer) listContainer.innerHTML = listHtml || `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 12px;">ไม่มีรายการบันทึก</div>`;
}

// Modal System Helper
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

window.switchPlatformGuide = function(platform) {
  const iosGuide = document.getElementById('iosGuideContent');
  const androidGuide = document.getElementById('androidGuideContent');
  const iosBtn = document.getElementById('iosPlatformBtn');
  const androidBtn = document.getElementById('androidPlatformBtn');

  if (platform === 'ios') {
    if (iosGuide) iosGuide.style.display = 'block';
    if (androidGuide) androidGuide.style.display = 'none';
    if (iosBtn) iosBtn.classList.add('active');
    if (androidBtn) androidBtn.classList.remove('active');
  } else {
    if (iosGuide) iosGuide.style.display = 'none';
    if (androidGuide) androidGuide.style.display = 'block';
    if (iosBtn) iosBtn.classList.remove('active');
    if (androidBtn) androidBtn.classList.add('active');
  }
};

// Event Listeners for Forms & Action Buttons
function setupEventListeners() {
  // Modal background close triggers
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  // Modal close buttons
  document.querySelectorAll('.sheet-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) modal.classList.remove('active');
    });
  });

  // Header Install Button
  const installHeaderBtn = document.getElementById('installHeaderBtn');
  if (installHeaderBtn) {
    installHeaderBtn.addEventListener('click', () => NovaPWA.promptInstall());
  }

  // Fullscreen Preview Toggle
  const testFullscreenBtn = document.getElementById('testFullscreenBtn');
  if (testFullscreenBtn) {
    testFullscreenBtn.addEventListener('click', () => NovaPWA.toggleFullscreen());
  }

  // Form: Add Shortcut
  const addShortcutForm = document.getElementById('addShortcutForm');
  if (addShortcutForm) {
    addShortcutForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('shortcutNameInput').value.trim();
      let url = document.getElementById('shortcutUrlInput').value.trim();
      const iconType = document.getElementById('shortcutIconSelect').value;
      const color = document.getElementById('shortcutColorInput').value;

      if (!name || !url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

      NovaStorage.saveShortcut({
        id: 'sc-' + Date.now(),
        name,
        url,
        iconType,
        color
      });

      addShortcutForm.reset();
      closeModal('addShortcutModal');
      renderShortcuts();
    });
  }

  // Form: Add Task
  const addTaskForm = document.getElementById('addTaskForm');
  if (addTaskForm) {
    addTaskForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('taskTitleInput').value.trim();
      const tag = document.getElementById('taskTagInput').value.trim() || 'งานทั่วไป';

      if (!title) return;

      NovaStorage.saveTask({
        id: 'task-' + Date.now(),
        title,
        tag,
        completed: false
      });

      addTaskForm.reset();
      closeModal('addTaskModal');
      renderTasks();
    });
  }

  // Form: Add Note
  const addNoteForm = document.getElementById('addNoteForm');
  if (addNoteForm) {
    addNoteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('noteTitleInput').value.trim();
      const body = document.getElementById('noteBodyInput').value.trim();

      if (!title || !body) return;

      NovaStorage.saveNote({
        id: 'note-' + Date.now(),
        title,
        body,
        date: new Date().toLocaleDateString('th-TH')
      });

      addNoteForm.reset();
      closeModal('addNoteModal');
      renderNotes();
    });
  }

  // Form: Add Finance Transaction
  const addFinanceForm = document.getElementById('addFinanceForm');
  if (addFinanceForm) {
    addFinanceForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('transTitleInput').value.trim();
      const amount = parseFloat(document.getElementById('transAmountInput').value);
      const type = document.getElementById('transTypeSelect').value;
      const icon = document.getElementById('transIconInput').value.trim() || (type === 'income' ? '💰' : '💳');

      if (!title || isNaN(amount) || amount <= 0) return;

      NovaStorage.saveTransaction({
        id: 'fin-' + Date.now(),
        title,
        amount,
        type,
        date: 'วันนี้',
        icon
      });

      addFinanceForm.reset();
      closeModal('addFinanceModal');
      renderFinance();
    });
  }

  // Data Export Button
  const exportBtn = document.getElementById('exportDataBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(NovaStorage.exportAllData());
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `novahub_backup_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    });
  }

  // Data Import Button
  const importFile = document.getElementById('importDataFile');
  if (importFile) {
    importFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const success = NovaStorage.importData(event.target.result);
        if (success) {
          alert('นำเข้าข้อมูลสำเร็จเรียบร้อย!');
          renderAllData();
        } else {
          alert('ไฟล์ข้อมูลไม่ถูกต้อง');
        }
      };
      reader.readAsText(file);
    });
  }
}

// Utility: escape HTML
function escapeHtml(string) {
  if (!string) return '';
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
