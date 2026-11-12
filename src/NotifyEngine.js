const webpush = require('web-push');
const crypto = require('crypto');
const { readDb, writeDb } = require('./storage');

class NotifyEngine {
  constructor() {
    this.initVapid();
  }

  initVapid() {
    const db = readDb();
    let publicKey = db.vapidKeys && db.vapidKeys.publicKey;
    let privateKey = db.vapidKeys && db.vapidKeys.privateKey;
    const subject = process.env.VAPID_SUBJECT || 'mailto:notify@example.com';

    if (!publicKey || !privateKey) {
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        publicKey = process.env.VAPID_PUBLIC_KEY;
        privateKey = process.env.VAPID_PRIVATE_KEY;
      } else {
        const generated = webpush.generateVAPIDKeys();
        publicKey = generated.publicKey;
        privateKey = generated.privateKey;
      }
      db.vapidKeys = { publicKey, privateKey };
      writeDb(db);
      console.log('✅ สร้าง VAPID Keys สำหรับ Web Push (iOS / Android) อัตโนมัติเรียบร้อยแล้ว');
    }

    this.publicKey = publicKey;
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  getPublicKey() {
    return this.publicKey;
  }

  getApps() {
    const db = readDb();
    return db.apps || [];
  }

  ensureApp(appId, appName, icon = '🔔', color = '#6366f1') {
    const db = readDb();
    const cleanId = (appId || 'default').trim();
    let app = db.apps.find((a) => a.appId === cleanId);
    if (!app) {
      app = {
        appId: cleanId,
        name: appName || cleanId,
        icon: icon || '📦',
        color: color || '#6366f1',
        description: '',
        createdAt: new Date().toISOString()
      };
      db.apps.push(app);
      writeDb(db);
    }
    return app;
  }

  createApp({ appId, name, icon = '⚡', color = '#6366f1', description = '' }) {
    const db = readDb();
    const cleanId = (appId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!cleanId) {
      throw new Error('กรุณาระบุรหัสแชนแนล (appId)');
    }
    if (db.apps.some((a) => a.appId === cleanId)) {
      throw new Error(`แชนแนลรหัส "${cleanId}" มีอยู่ในระบบแล้ว`);
    }
    const newApp = {
      appId: cleanId,
      name: (name || cleanId).trim(),
      icon: icon || '⚡',
      color: color || '#6366f1',
      description: (description || '').trim(),
      createdAt: new Date().toISOString()
    };
    db.apps.push(newApp);
    writeDb(db);
    return newApp;
  }

  updateApp(appId, { name, icon, color, description }) {
    const db = readDb();
    const app = db.apps.find((a) => a.appId === appId);
    if (!app) {
      throw new Error(`ไม่พบแชนแนลรหัส "${appId}"`);
    }
    if (typeof name === 'string' && name.trim()) {
      app.name = name.trim();
    }
    if (typeof icon === 'string' && icon.trim()) {
      app.icon = icon.trim();
    }
    if (typeof color === 'string' && color.trim()) {
      app.color = color.trim();
    }
    if (typeof description === 'string') {
      app.description = description.trim();
    }
    app.updatedAt = new Date().toISOString();
    writeDb(db);
    return app;
  }

  deleteApp(appId) {
    if (appId === 'default') {
      throw new Error('ไม่สามารถลบแชนแนลหลัก (default) ได้');
    }
    const db = readDb();
    const before = db.apps.length;
    db.apps = db.apps.filter((a) => a.appId !== appId);
    if (db.subscriptions) {
      db.subscriptions.forEach((s) => {
        if (s.appId === appId) s.appId = '*';
      });
    }
    writeDb(db);
    return db.apps.length !== before;
  }

  registerSubscription({ subscription, appId = '*', userId = 'all', deviceName = 'Unknown Device', userAgent = '' }) {
    if (!subscription || !subscription.endpoint) {
      throw new Error('Invalid Push Subscription object (missing endpoint)');
    }

    const db = readDb();
    const existingIndex = db.subscriptions.findIndex((s) => s.subscription && s.subscription.endpoint === subscription.endpoint);

    const record = {
      id: existingIndex >= 0 ? db.subscriptions[existingIndex].id : crypto.randomUUID(),
      subscription,
      appId: appId || '*',
      userId: userId || 'all',
      deviceName,
      userAgent,
      enabled: existingIndex >= 0 && typeof db.subscriptions[existingIndex].enabled === 'boolean'
        ? db.subscriptions[existingIndex].enabled
        : true,
      updatedAt: new Date().toISOString(),
      createdAt: existingIndex >= 0 ? db.subscriptions[existingIndex].createdAt : new Date().toISOString()
    };

    if (existingIndex >= 0) {
      db.subscriptions[existingIndex] = record;
    } else {
      db.subscriptions.push(record);
    }

    writeDb(db);
    return record;
  }

  removeSubscription(endpoint) {
    const db = readDb();
    const before = db.subscriptions.length;
    db.subscriptions = db.subscriptions.filter((s) => s.subscription && s.subscription.endpoint !== endpoint);
    writeDb(db);
    return before !== db.subscriptions.length;
  }

  updateDevice(deviceId, { deviceName, appId, enabled, userId } = {}) {
    const db = readDb();
    const index = db.subscriptions.findIndex((s) => s.id === deviceId);
    if (index === -1) {
      throw new Error(`ไม่พบอุปกรณ์รหัส ${deviceId}`);
    }
    const dev = db.subscriptions[index];
    if (typeof deviceName === 'string' && deviceName.trim()) {
      dev.deviceName = deviceName.trim();
    }
    if (typeof appId === 'string') {
      dev.appId = appId.trim() || '*';
    }
    if (typeof enabled === 'boolean') {
      dev.enabled = enabled;
    }
    if (typeof userId === 'string') {
      dev.userId = userId.trim() || 'all';
    }
    dev.updatedAt = new Date().toISOString();
    writeDb(db);
    return dev;
  }

  deleteDevice(deviceId) {
    const db = readDb();
    const before = db.subscriptions.length;
    db.subscriptions = db.subscriptions.filter((s) => s.id !== deviceId);
    writeDb(db);
    return db.subscriptions.length !== before;
  }

  getSubscriptions(appId) {
    const db = readDb();
    if (!appId || appId === '*') return db.subscriptions;
    return db.subscriptions.filter((s) => s.appId === '*' || s.appId === appId);
  }

  getMessages({ appId, limit = 50 } = {}) {
    const db = readDb();
    let list = db.messages || [];
    if (appId && appId !== '*') {
      list = list.filter((m) => m.appId === appId);
    }
    return list.slice(0, limit);
  }

  clearMessages(appId) {
    const db = readDb();
    if (!appId || appId === '*') {
      db.messages = [];
    } else {
      db.messages = (db.messages || []).filter((m) => m.appId !== appId);
    }
    writeDb(db);
  }

  async sendNotification({
    appId = 'default',
    appName,
    title = 'แจ้งเตือนใหม่',
    body = '',
    url = './index.html?tab=notif',
    icon = './assets/icons/icon-192.png',
    userId = null,
    deviceId = null,
    targetDeviceId = null,
    priority = 'normal',
    data = {}
  }) {
    const app = this.ensureApp(appId, appName);
    const db = readDb();
    const specificDeviceId = targetDeviceId || deviceId;

    const messageRecord = {
      id: crypto.randomUUID(),
      appId: app.appId,
      appName: app.name,
      appIcon: app.icon,
      title,
      body,
      url,
      userId: userId || 'all',
      targetDeviceId: specificDeviceId || null,
      priority,
      data,
      createdAt: new Date().toISOString()
    };

    db.messages = db.messages || [];
    db.messages.unshift(messageRecord);
    if (db.messages.length > 200) {
      db.messages = db.messages.slice(0, 200);
    }

    // Filter target subscriptions:
    // 1. Devices must have enabled !== false (not muted/disabled)
    // 2. If specificDeviceId is set, target only that device
    // 3. Otherwise, check appId ('*' or match) and userId ('all' or match)
    const targets = db.subscriptions.filter((sub) => {
      if (!sub || !sub.subscription || !sub.subscription.endpoint) return false;
      if (sub.enabled === false) return false;

      if (specificDeviceId) {
        return sub.id === specificDeviceId;
      }

      const appMatch = sub.appId === '*' || sub.appId === app.appId || app.appId === 'default';
      const userMatch = !userId || userId === 'all' || sub.userId === userId || sub.userId === 'all';
      return appMatch && userMatch;
    });

    const payload = JSON.stringify({
      id: messageRecord.id,
      appId: app.appId,
      appName: app.name,
      title: `[${app.name}] ${title}`,
      rawTitle: title,
      body,
      icon,
      badge: './assets/icons/icon-192.png',
      url: url || './index.html?tab=notif',
      priority,
      timestamp: Date.now(),
      data
    });

    let sentCount = 0;
    let failedCount = 0;
    const deadEndpoints = [];

    await Promise.all(
      targets.map(async (target) => {
        try {
          await webpush.sendNotification(target.subscription, payload, {
            TTL: 86400,
            urgency: priority === 'high' ? 'high' : 'normal'
          });
          sentCount++;
        } catch (err) {
          failedCount++;
          if (err.statusCode === 404 || err.statusCode === 410) {
            deadEndpoints.push(target.subscription.endpoint);
          } else {
            console.error(`Push error for device ${target.deviceName}:`, err.message);
          }
        }
      })
    );

    if (deadEndpoints.length > 0) {
      db.subscriptions = db.subscriptions.filter((s) => s.subscription && !deadEndpoints.includes(s.subscription.endpoint));
    }

    messageRecord.delivery = {
      totalTargets: targets.length,
      sentCount,
      failedCount
    };

    writeDb(db);

    return {
      success: true,
      message: messageRecord,
      delivery: messageRecord.delivery
    };
  }
}

module.exports = new NotifyEngine();
