/**
 * NotifyModel - โมดูลระบบแจ้งเตือนกลาง (Reusable Notification Model)
 * นำไฟล์นี้ไปใช้ใน Web App หรือโปรเจกต์ไหนก็ได้ เพื่อส่งหรือรับแจ้งเตือนขึ้นหน้าจอมือถือ (iOS & Android)
 * โดยไม่ต้องสร้างระบบแจ้งเตือนใหม่ในแต่ละโปรเจกต์
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NotifyModel = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  class NotifyModel {
    /**
     * @param {Object} config
     * @param {string} config.hubUrl - URL ของเซิร์ฟเวอร์ NotifyHub (เช่น 'https://your-notify-hub.onrender.com' หรือ 'http://localhost:3200')
     * @param {string} [config.appId='default'] - รหัสโปรเจกต์/แชนแนลของ Web App นั้นๆ (เช่น 'my-webapp', 'shop-system')
     * @param {string} [config.appName] - ชื่อโปรเจกต์ที่จะแสดงบนหัวแจ้งเตือน
     * @param {string} [config.userId='all'] - รหัสผู้ใช้ (กรณีต้องการแยกส่งเฉพาะบุคคล)
     * @param {string} [config.swPath='/sw.js'] - พาธของไฟล์ Service Worker
     */
    constructor(config = {}) {
      this.hubUrl = (config.hubUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3200')).replace(/\/$/, '');
      this.appId = config.appId || 'default';
      this.appName = config.appName || this.appId;
      this.userId = config.userId || 'all';
      this.swPath = config.swPath || '/sw.js';
    }

    /**
     * ส่งแจ้งเตือนขึ้นหน้าจอมือถือ (เรียกใช้ได้ทั้งจาก Frontend Web App และ Backend Node.js)
     */
    async send({
      title = 'แจ้งเตือนใหม่',
      body = '',
      url = '/',
      appId = this.appId,
      appName = this.appName,
      userId = null,
      deviceId = null,
      targetDeviceId = null,
      priority = 'normal',
      delaySeconds = 0,
      data = {}
    } = {}) {
      if (typeof window !== 'undefined' && window.IoTNotification && typeof window.IoTNotification.dispatchBroadcast === 'function') {
        return await window.IoTNotification.dispatchBroadcast({
          title,
          body,
          url,
          appId,
          targetDeviceId: targetDeviceId || deviceId || null,
          priority,
          data
        });
      }

      const payload = JSON.stringify({
        appId,
        appName,
        title,
        body,
        url,
        userId,
        targetDeviceId: targetDeviceId || deviceId || null,
        priority,
        delaySeconds,
        data
      });

      let response = await fetch(`${this.hubUrl}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      if (response.status === 404) {
        response = await fetch(`${this.hubUrl}/api/push/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
      }
      return await response.json();
    }

    /**
     * ตรวจสอบว่าอุปกรณ์/เบราว์เซอร์นี้รองรับ Web Push หรือไม่ (รวมถึงเช็คเงื่อนไข iOS Home Screen)
     */
    checkSupport() {
      if (typeof window === 'undefined') {
        return { supported: false, reason: 'ไม่ได้รันบนเบราว์เซอร์' };
      }
      const ua = navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

      if (!window.isSecureContext) {
        return {
          supported: false,
          isIOS,
          isStandalone,
          reason: 'ต้องเปิดผ่าน HTTPS หรือ localhost เท่านั้น ระบบมือถือจึงจะอนุญาตให้เด้งแจ้งเตือน'
        };
      }

      if (isIOS && !isStandalone) {
        return {
          supported: false,
          isIOS: true,
          isStandalone: false,
          needsHomeScreen: true,
          reason: 'สำหรับ iPhone/iPad (iOS) กรุณากดปุ่ม Share (แชร์) แล้วเลือก "Add to Home Screen (เพิ่มไปยังหน้าจอโฮม)" ก่อนเปิดใช้งานแจ้งเตือน'
        };
      }

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return {
          supported: false,
          isIOS,
          isStandalone,
          reason: 'เบราว์เซอร์นี้ไม่รองรับ Web Push API'
        };
      }

      return { supported: true, isIOS, isStandalone };
    }

    /**
     * ผูกอุปกรณ์มือถือ/เบราว์เซอร์นี้เพื่อรับ Push Notification
     */
    async subscribe({ appId = this.appId, userId = this.userId, deviceName } = {}) {
      if (typeof window !== 'undefined' && window.IoTNotification && typeof window.IoTNotification.subscribePush === 'function') {
        return await window.IoTNotification.subscribePush();
      }

      const support = this.checkSupport();
      if (!support.supported) {
        throw new Error(support.reason);
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('ผู้ใช้ไม่อนุญาตสิทธิ์การแจ้งเตือน (Permission denied)');
      }

      const registration = await navigator.serviceWorker.register(this.swPath);
      await navigator.serviceWorker.ready;

      let keyRes = await fetch(`${this.hubUrl}/api/vapid-public-key`);
      if (keyRes.status === 404) {
        keyRes = await fetch(`${this.hubUrl}/api/push/vapid-public-key`);
      }
      const { publicKey } = await keyRes.json();

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(publicKey)
      });

      const detectedName = deviceName || this._detectDeviceName();
      const subBody = JSON.stringify({
        subscription,
        appId,
        userId,
        deviceName: detectedName
      });

      let subRes = await fetch(`${this.hubUrl}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: subBody
      });
      if (subRes.status === 404) {
        subRes = await fetch(`${this.hubUrl}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: subBody
        });
      }

      return await subRes.json();
    }

    /**
     * ยกเลิกการรับแจ้งเตือนของอุปกรณ์นี้
     */
    async unsubscribe() {
      if (typeof window !== 'undefined' && window.IoTNotification && typeof window.IoTNotification.unsubscribePush === 'function') {
        return await window.IoTNotification.unsubscribePush();
      }
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch(`${this.hubUrl}/api/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        }).catch(() => {});
        await subscription.unsubscribe();
        return true;
      }
      return false;
    }

    /**
     * เช็คว่าเครื่องนี้กดรับแจ้งเตือนไว้หรือยัง
     */
    async isSubscribed() {
      if (typeof window !== 'undefined' && window.IoTNotification && typeof window.IoTNotification.isDeviceReceivingEnabled === 'function') {
        return window.IoTNotification.isDeviceReceivingEnabled();
      }
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        return false;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;
      const sub = await reg.pushManager.getSubscription();
      return Boolean(sub);
    }

    /**
     * สร้างปุ่มลอย (Floating Bell Widget) อัตโนมัติสำหรับเสียบใน Web App ใดก็ได้ภายในบรรทัดเดียว
     */
    async mountBellWidget({ position = 'bottom-right', label = 'รับการแจ้งเตือน' } = {}) {
      if (typeof document === 'undefined') return null;
      let btn = document.getElementById('notifyHubBellWidgetBtn');
      if (btn) return btn;

      btn = document.createElement('button');
      btn.id = 'notifyHubBellWidgetBtn';
      btn.className = 'notify-hub-bell-widget';
      const posStyle = position === 'bottom-left' ? 'left: 16px;' : 'right: 16px;';
      btn.style.cssText = `
        position: fixed; bottom: 88px; ${posStyle} z-index: 990;
        display: flex; align-items: center; gap: 6px;
        background: linear-gradient(135deg, #4f46e5, #7c3aed);
        color: #fff; border: none; border-radius: 999px;
        padding: 9px 15px; font-family: inherit; font-size: 12.5px;
        font-weight: 600; cursor: pointer;
        box-shadow: 0 8px 20px rgba(79, 70, 229, 0.35);
        transition: all 0.2s ease;
      `;

      const updateState = async () => {
        const active = await this.isSubscribed();
        btn.innerHTML = active ? '🔔 เปิดแจ้งเตือนแล้ว' : `🔕 ${label}`;
        btn.style.background = active
          ? 'linear-gradient(135deg, #059669, #10b981)'
          : 'linear-gradient(135deg, #4f46e5, #7c3aed)';
      };

      btn._updateState = updateState;
      await updateState();

      btn.onclick = async () => {
        try {
          btn.disabled = true;
          btn.innerHTML = '⏳ กำลังตั้งค่า...';
          if (typeof window !== 'undefined' && window.IoTNotification && typeof window.IoTNotification.togglePush === 'function') {
            await window.IoTNotification.togglePush();
          } else {
            await this.subscribe();
          }
          await updateState();
        } catch (err) {
          alert('⚠️ ' + err.message);
          await updateState();
        } finally {
          btn.disabled = false;
        }
      };

      document.body.appendChild(btn);
      return btn;
    }

    _detectDeviceName() {
      const ua = navigator.userAgent || '';
      if (/iPhone/.test(ua)) return '📱 iPhone (iOS)';
      if (/iPad/.test(ua)) return '📱 iPad (iOS)';
      if (/Android/.test(ua)) return '🤖 Android Phone';
      if (/Windows/.test(ua)) return '💻 Windows PC';
      if (/Macintosh/.test(ua)) return '💻 Mac';
      return '🌐 Web Browser';
    }

    _urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    }
  }

  return NotifyModel;
});
