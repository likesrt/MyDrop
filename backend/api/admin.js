const path = require('path');
const fs = require('fs');
const express = require('express');
const { logger } = require('../services/logger');

function createAdminRouter(options) {
  const { db, uploadDir, tokenCookieName, kickDevice, requireAuth } = options;
  const router = express.Router();

  // Delete device and optionally its messages/files
  router.post('/admin/device/delete', requireAuth, async (req, res) => {
    try {
      const { deviceId, removeMessages } = req.body || {};
      if (!deviceId) return res.status(400).json({ error: '缺少设备ID' });

      if (removeMessages) {
        const files = await db.listFilesByDevice(deviceId);
        for (const f of files) {
          const p = path.join(uploadDir, f.stored_name);
          try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
        }

        const msgs = await db.listMessagesByDevice(deviceId);
        for (const m of msgs) { await db.deleteMessage(m.id); }
      }

      await db.deleteDevice(deviceId);
      try { if (typeof kickDevice === 'function') kickDevice(deviceId); } catch (_) {}

      // If deleting current device, clear cookie immediately
      if (deviceId === req.device_id) {
        try { res.clearCookie(tokenCookieName, { httpOnly: true, sameSite: 'lax', path: '/' }); } catch (_) {}
      }

      logger.info('admin.device.delete', { device_id: deviceId, remove_messages: !!removeMessages });
      res.json({ ok: true });
    } catch (err) {
      logger.error('admin.device.delete.error', { err });
      res.status(500).json({ error: '删除设备失败' });
    }
  });


  return router;
}

module.exports = createAdminRouter;