const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('./logger');
const { signJWT, verifyJWT, verifyPassword, hashPassword } = require('./auth');

function createApiRouter(options) {
  const {
    tokenCookieName,
    db,
    uploadDir,
    limits, // { maxFiles, fileSizeLimitMB }
    broadcast, // function(message)
    jwtSecret,
    jwtExpiresDays,
    kickDevice, // function(deviceId)
    kickUserSessions, // function(userId, { exceptDeviceId })
  } = options;

  const router = express.Router();

  // Multer for this router
  const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname);
      const name = uuidv4().replace(/-/g, '') + ext;
      cb(null, name);
    },
  });
  const upload = multer({ storage, limits: { fileSize: limits.fileSizeLimitMB * 1024 * 1024 } });

  // Auth middleware
  async function requireAuth(req, res, next) {
    try {
      const token = req.cookies?.[tokenCookieName] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ error: 'Not authenticated' });
      const claims = verifyJWT(token, jwtSecret);
      // verify token version against DB
      const user = await db.getUserById(claims.sub);
      if (!user || typeof claims.tv !== 'number' || claims.tv !== (user.token_version || 0)) {
        try { res.clearCookie(tokenCookieName); } catch (_) {}
        return res.status(401).json({ error: 'Invalid token' });
      }
      req.user = { id: claims.sub, username: claims.username };
      req.device_id = claims.device_id;
      // ensure device still exists (revoked device should not access)
      const device = await db.getDevice(req.device_id);
      if (!device) {
        try { res.clearCookie(tokenCookieName); } catch (_) {}
        return res.status(401).json({ error: 'Device revoked' });
      }
      req.device = device;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  // Config (public)
  router.get('/config', (req, res) => {
    res.json({ maxFiles: limits.maxFiles, fileSizeLimitMB: limits.fileSizeLimitMB });
  });

  // Login/Logout
  router.post('/login', async (req, res) => {
    try {
      const { username, password, deviceId, alias } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });
      if (!deviceId) return res.status(400).json({ error: '缺少设备ID' });
      const user = await db.getUserByUsername(username);
      if (!user) {
        logger.warn('login.failed.no_user', { username: username || '', ip: req.ip });
        return res.status(401).json({ error: '用户名不存在' });
      }
      if (!verifyPassword(password, user.password_hash)) {
        logger.warn('login.failed.bad_password', { username: username || '', ip: req.ip });
        return res.status(401).json({ error: '密码错误' });
      }
      await db.upsertDevice(deviceId, alias || null, req.headers['user-agent'] || '');
      const days = Number.isFinite(jwtExpiresDays) ? jwtExpiresDays : 7;
      const expiresSec = days > 0 ? days * 24 * 60 * 60 : null;
      const token = signJWT({ sub: user.id, username: user.username, device_id: deviceId, tv: user.token_version || 0 }, jwtSecret, expiresSec);
      const cookieOpts = { httpOnly: true, sameSite: 'lax' };
      if (days > 0) cookieOpts.maxAge = expiresSec * 1000;
      res.cookie(tokenCookieName, token, cookieOpts);
      logger.info('login.success', { device_id: deviceId, alias: alias || '', ip: req.ip });
      res.json({ ok: true, needsPasswordChange: !!user.is_default_password });
    } catch (err) {
      logger.error('login.error', { err });
      res.status(500).json({ error: 'Login failed' });
    }
  });

  router.post('/logout', requireAuth, async (req, res) => {
    try {
      res.clearCookie(tokenCookieName, { httpOnly: true, sameSite: 'lax' });
      logger.info('logout', { device_id: req.device_id });
      res.json({ ok: true });
    } catch (err) {
      logger.error('logout.error', { err });
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  router.get('/me', requireAuth, async (req, res) => {
    const device = await db.getDevice(req.device_id);
    const user = await db.getUserById(req.user.id);
    res.json({ device, user: { username: user.username, needsPasswordChange: !!user.is_default_password } });
  });

  router.get('/devices', requireAuth, async (req, res) => {
    const devices = await db.listDevices();
    res.json({ devices });
  });

  router.get('/messages', requireAuth, async (req, res) => {
    const sinceId = req.query.sinceId ? parseInt(req.query.sinceId, 10) : null;
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 200) : 100;
    const msgs = await db.listMessages(sinceId, limit);
    res.json({ messages: msgs });
  });

  // Update current device alias
  router.post('/device/alias', requireAuth, async (req, res) => {
    try {
      const alias = (req.body?.alias || '').toString().trim();
      const deviceId = req.device_id;
      if (alias.length > 100) return res.status(400).json({ error: '别名过长' });
      await db.upsertDevice(deviceId, alias || null, req.headers['user-agent'] || '');
      const device = await db.getDevice(deviceId);
      logger.info('device.alias.update', { device_id: deviceId, alias: alias || '' });
      res.json({ ok: true, device });
    } catch (err) {
      logger.error('device.alias.error', { err });
      res.status(500).json({ error: '更新设备别名失败' });
    }
  });

  router.post('/message', requireAuth, upload.array('files'), async (req, res) => {
    try {
      const senderDeviceId = req.device_id;
      const text = (req.body.text || '').toString();

      const currentFileCount = await db.countFiles();
      const incoming = (req.files || []).length;
      if (incoming > 0 && currentFileCount + incoming > limits.maxFiles) {
        for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch (_) {} }
        logger.warn('message.file_limit_reached', { incoming, current: currentFileCount, max: limits.maxFiles });
        return res.status(400).json({ error: `File limit reached. Max ${limits.maxFiles} files.` });
      }

      const msg = await db.createMessage({ senderDeviceId, text });
      if (req.files && req.files.length) {
        let totalSize = 0;
        for (const f of req.files) {
          totalSize += f.size || 0;
          await db.addFile({
            messageId: msg.id,
            storedName: path.basename(f.filename),
            originalName: f.originalname,
            mimeType: f.mimetype,
            size: f.size,
          });
        }
        logger.info('message.sent', { message_id: msg.id, device_id: senderDeviceId, text_len: text.length, file_count: req.files.length, total_size: totalSize });
      } else {
        logger.info('message.sent', { message_id: msg.id, device_id: senderDeviceId, text_len: text.length, file_count: 0, total_size: 0 });
      }
      const full = await db.getMessage(msg.id);
      if (typeof broadcast === 'function') broadcast(full);
      res.json({ ok: true, message: full });
    } catch (err) {
      logger.error('message.error', { err });
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  router.get('/file/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const file = await db.getFile(id);
      if (!file) return res.status(404).send('Not found');
      const filePath = path.join(uploadDir, file.stored_name);
      if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
      }
      logger.info('file.stream', { file_id: id, mime: file.mime_type, size: file.size, download: req.query.download === '1' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      logger.error('file.error', { err });
      res.status(500).send('Download failed');
    }
  });

  // Admin: update username/password
  router.post('/admin/user', requireAuth, async (req, res) => {
    try {
      const { oldPassword, username, password } = req.body || {};
      const user = await db.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!oldPassword || !verifyPassword(oldPassword, user.password_hash)) {
        return res.status(400).json({ error: '旧密码不正确' });
      }
      let updates = {};
      if (username && username !== user.username) updates.username = username;
      if (password) {
        updates.passwordHash = hashPassword(password);
        updates.isDefaultPassword = false;
      }
      if (!updates.username && !updates.passwordHash) {
        return res.status(400).json({ error: '没有变更内容' });
      }
      const updated = await db.updateUserAuth(user.id, updates);
      // Do NOT reissue token. Force logout by clearing cookie and kicking WS sessions.
      try { res.clearCookie(tokenCookieName, { httpOnly: true, sameSite: 'lax', path: '/' }); } catch (_) {}
      // Immediately kick all online WS connections for this user (including current device)
      try { if (typeof kickUserSessions === 'function') kickUserSessions(updated.id); } catch (_) {}
      res.json({ ok: true, loggedOut: true });
    } catch (err) {
      logger.error('admin.user.error', { err });
      res.status(500).json({ error: '更新用户失败' });
    }
  });

  // Admin: delete a device, optionally also delete its messages/files
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

  // Admin: delete a message (and its files by FK). Also unlink files.
  router.post('/admin/message/delete', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.body || {};
      if (!messageId) return res.status(400).json({ error: '缺少消息ID' });
      const full = await db.getMessage(messageId);
      for (const f of (full?.files || [])) {
        const p = path.join(uploadDir, f.stored_name);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
      }
      await db.deleteMessage(messageId);
      logger.info('admin.message.delete', { message_id: messageId });
      res.json({ ok: true });
    } catch (err) {
      logger.error('admin.message.delete.error', { err });
      res.status(500).json({ error: '删除消息失败' });
    }
  });

  // Admin: delete a single file
  router.post('/admin/file/delete', requireAuth, async (req, res) => {
    try {
      const { fileId } = req.body || {};
      if (!fileId) return res.status(400).json({ error: '缺少文件ID' });
      const file = await db.getFile(fileId);
      if (file) {
        const p = path.join(uploadDir, file.stored_name);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
        await db.deleteFile(fileId);
      }
      logger.info('admin.file.delete', { file_id: fileId });
      res.json({ ok: true });
    } catch (err) {
      logger.error('admin.file.delete.error', { err });
      res.status(500).json({ error: '删除文件失败' });
    }
  });

  return router;
}

module.exports = createApiRouter;
