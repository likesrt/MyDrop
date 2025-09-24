const path = require('path');
const fs = require('fs');
const express = require('express');
const { logger } = require('../services/logger');
const os = require('os');

function createAdminRouter(options) {
  const { db, uploadDir, tokenCookieName, kickDevice, requireAuth, settings } = options;
  const router = express.Router();

  function isSecureReq(req) {
    if (req.secure) return true;
    const xf = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim().toLowerCase();
    return xf === 'https';
  }

  function cookieOptsFor(req) {
    const base = { httpOnly: true, sameSite: 'lax', path: '/' };
    if (isSecureReq(req)) base.secure = true;
    return base;
  }

  // Delete device and optionally its messages/files
  router.post('/admin/device/delete', requireAuth, async (req, res) => {
    try {
      const { deviceId, removeMessages } = req.body || {};
      if (!deviceId) return res.status(400).json({ error: '缺少设备ID' });

      if (removeMessages) {
        const files = await db.listFilesByDevice(deviceId);
        for (const f of files) {
          const p = path.join(uploadDir, f.stored_name);
          try { await fs.promises.unlink(p); } catch (_) {}
        }

        const msgs = await db.listMessagesByDevice(deviceId);
        for (const m of msgs) { await db.deleteMessage(m.id); }
        try {
          if (files && files.length) await db.incrementStat('cleaned_files_total', files.length);
          if (msgs && msgs.length) await db.incrementStat('cleaned_messages_total', msgs.length);
        } catch (_) {}
      }

      await db.deleteDevice(deviceId);
      try { if (typeof kickDevice === 'function') kickDevice(deviceId); } catch (_) {}

      // If deleting current device, clear cookie immediately
      if (deviceId === req.device_id) {
        try { res.clearCookie(tokenCookieName, cookieOptsFor(req)); } catch (_) {}
      }

      logger.info('admin.device.delete', { device_id: deviceId, remove_messages: !!removeMessages });
      res.json({ ok: true });
    } catch (err) {
      logger.error('admin.device.delete.error', { err });
      res.status(500).json({ error: '删除设备失败' });
    }
  });

  // Admin status: runtime/config/cleanup/stats
  router.get('/admin/status', requireAuth, async (req, res) => {
    try {
      const stats = await db.getStats();
      const mem = process.memoryUsage();
      const rssMB = Math.round((mem.rss || 0) / 1024 / 1024);
      const heapMB = Math.round((mem.heapUsed || 0) / 1024 / 1024);
      const uptimeSec = Math.round(process.uptime());
      const appVersion = (() => { try { return require('../../package.json').version || '0.0.0'; } catch(_) { return '0.0.0'; } })();

      const LOG_FILE = process.env.LOG_FILE || '';
      const canDownloadLog = !!LOG_FILE && fs.existsSync(path.isAbsolute(LOG_FILE) ? LOG_FILE : path.join(process.cwd(), LOG_FILE));

      const cfg = settings && settings.getAllSync ? settings.getAllSync() : {};
      res.json({
        ok: true,
        logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
        canDownloadLog,
        jwtExpiresDays: Number(cfg.jwtExpiresDays || 7) | 0,
        wsHeartbeat: true,
        version: { app: appVersion, asset: (process.env.ASSET_VERSION || null) },
        cleanup: {
          enabled: !!cfg.autoCleanupEnabled,
          intervalMinutes: Number(cfg.cleanupIntervalMinutes || 720) | 0,
          messageTtlDays: Number(cfg.messageTtlDays || 0) | 0,
          deviceInactiveDays: Number(process.env.DEVICE_INACTIVE_DAYS || '0') | 0,
          counters: {
            files: stats.cleaned_files_total || 0,
            messages: stats.cleaned_messages_total || 0,
            devices: stats.cleaned_devices_total || 0,
          },
        },
        runtime: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          uptimeSec,
          memoryMB: { rss: rssMB, heapUsed: heapMB },
          cpus: os.cpus()?.length || 0,
        },
      });
    } catch (err) {
      logger.error('admin.status.error', { err });
      res.status(500).json({ error: '无法获取状态' });
    }
  });

  // System settings
  router.get('/admin/settings', requireAuth, async (req, res) => {
    try {
      const cfg = settings && settings.getAll ? await settings.getAll() : {};
      res.json({ ok: true, settings: cfg });
    } catch (err) {
      logger.error('admin.settings.get.error', { err });
      res.status(500).json({ error: '无法获取设置' });
    }
  });

  router.post('/admin/settings', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const patch = {
        autoCleanupEnabled: !!body.autoCleanupEnabled,
        cleanupIntervalMinutes: parseInt(body.cleanupIntervalMinutes, 10),
        messageTtlDays: parseInt(body.messageTtlDays, 10),
        jwtExpiresDays: parseInt(body.jwtExpiresDays, 10),
        tempLoginTtlMinutes: parseInt(body.tempLoginTtlMinutes, 10),
        headerAutoHide: !!body.headerAutoHide,
      };
      const saved = await settings.update(patch);
      logger.info('admin.settings.update', { patch });
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('admin.settings.update.error', { err });
      res.status(500).json({ error: '保存失败' });
    }
  });

  // Download log file (if configured)
  router.get('/admin/logs/download', requireAuth, async (req, res) => {
    try {
      const LOG_FILE = process.env.LOG_FILE || '';
      if (!LOG_FILE) return res.status(400).json({ error: '未配置日志文件' });
      const abs = path.isAbsolute(LOG_FILE) ? LOG_FILE : path.join(process.cwd(), LOG_FILE);
      if (!fs.existsSync(abs)) return res.status(404).json({ error: '日志文件不存在' });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);
      fs.createReadStream(abs).pipe(res);
    } catch (err) {
      logger.error('admin.logs.download.error', { err });
      res.status(500).json({ error: '下载失败' });
    }
  });


  return router;
}

module.exports = createAdminRouter;
