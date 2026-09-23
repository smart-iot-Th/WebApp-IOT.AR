/**
 * NovaHub PWA Controller
 * Handles Service Worker registration, install prompts, standalone detection, and mobile guides.
 */

let deferredInstallPrompt = null;

const PWA = {
  isStandalone: false,
  isIOS: false,
  isAndroid: false,

  init() {
    this.detectDeviceAndMode();
    this.registerServiceWorker();
    this.setupInstallPrompt();
    this.setupNetworkMonitor();
    this.updateUIStatus();
  },

  detectDeviceAndMode() {
    const ua = window.navigator.userAgent.toLowerCase();
    this.isIOS = /iphone|ipad|ipod/.test(ua);
    this.isAndroid = /android/.test(ua);

    // Check if running in standalone mode (no address bar / added to home screen)
    const isStandaloneMQ = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = window.navigator.standalone === true;
    this.isStandalone = isStandaloneMQ || isIOSStandalone;

    console.log(`[PWA] Mode: ${this.isStandalone ? 'Standalone (No URL bar)' : 'Browser Mode'}, iOS: ${this.isIOS}, Android: ${this.isAndroid}`);
  },

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((registration) => {
            console.log('[PWA] Service Worker registered with scope:', registration.scope);
          })
          .catch((error) => {
            console.warn('[PWA] Service Worker registration failed:', error);
          });
      });
    }
  },

  setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent browser default mini-infobar
      e.preventDefault();
      deferredInstallPrompt = e;
      console.log('[PWA] Captured beforeinstallprompt event');

      // Show install badge/button in header if not already installed
      const installBtn = document.getElementById('installHeaderBtn');
      if (installBtn && !this.isStandalone) {
        installBtn.style.display = 'inline-flex';
      }
    });

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] Application was successfully installed to home screen!');
      deferredInstallPrompt = null;
      this.isStandalone = true;
      this.updateUIStatus();
    });
  },

  promptInstall() {
    if (deferredInstallPrompt) {
      // Trigger native Chrome/Android install prompt
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('[PWA] User accepted the install prompt');
        } else {
          console.log('[PWA] User dismissed the install prompt');
        }
        deferredInstallPrompt = null;
      });
    } else {
      // Show custom step-by-step install guide modal
      this.showInstallGuideModal();
    }
  },

  showInstallGuideModal() {
    const modal = document.getElementById('installGuideModal');
    if (modal) {
      modal.classList.add('active');
      // Auto-select platform tab based on detected device
      if (this.isIOS) {
        window.switchPlatformGuide('ios');
      } else {
        window.switchPlatformGuide('android');
      }
    }
  },

  closeInstallGuideModal() {
    const modal = document.getElementById('installGuideModal');
    if (modal) {
      modal.classList.remove('active');
    }
  },

  setupNetworkMonitor() {
    const updateOnlineStatus = () => {
      const isOnline = navigator.onLine;
      const statusPill = document.getElementById('networkStatusPill');
      const statusDot = document.getElementById('networkStatusDot');
      const statusText = document.getElementById('networkStatusText');

      if (statusPill && statusDot && statusText) {
        if (isOnline) {
          statusDot.style.backgroundColor = 'var(--emerald)';
          statusDot.style.boxShadow = '0 0 8px var(--emerald)';
          statusText.textContent = 'ออนไลน์พร้อมใช้';
        } else {
          statusDot.style.backgroundColor = 'var(--amber)';
          statusDot.style.boxShadow = '0 0 8px var(--amber)';
          statusText.textContent = 'ออฟไลน์ (เปิดได้จากแคช)';
        }
      }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
  },

  updateUIStatus() {
    const badge = document.getElementById('modeIndicatorBadge');
    const installBtn = document.getElementById('installHeaderBtn');
    const standaloneStat = document.getElementById('pwaModeStat');

    if (this.isStandalone) {
      if (badge) {
        badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> โหมดแอปเต็มจอ (Standalone)`;
        badge.style.color = '#10b981';
        badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      }
      if (installBtn) installBtn.style.display = 'none';
      if (standaloneStat) standaloneStat.innerHTML = '<span style="color: var(--emerald);">เปิดในโหมดแอปแท้ (Standalone)</span>';
    } else {
      if (badge) {
        badge.innerHTML = `💡 แนะนำ: เพิ่มลงหน้าจอโฮมเพื่อเปิดเต็มจอ`;
        badge.style.color = '#c7d2fe';
      }
      if (installBtn) installBtn.style.display = 'inline-flex';
      if (standaloneStat) standaloneStat.innerHTML = '<span style="color: var(--amber);">เปิดผ่านเบราว์เซอร์ปกติ</span>';
    }
  },

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        alert('การเปิดเต็มจอบนเบราว์เซอร์นี้ถูกจำกัด กรุณาใช้ฟังก์ชัน "เพิ่มลงในหน้าจอโฮม" เพื่อใช้งานแบบไร้แถบ URL ถาวรครับ');
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }
};

window.NovaPWA = PWA;
