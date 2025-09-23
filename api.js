const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('./logger');

function createApiRouter(options) {
  const {
    auth, // { username, password }
    sessionCookieName,
    db,
    uploadDir,
    limits, // { maxFiles, fileSizeLimitMB }
    broadcast, // function(message)
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
    const sid = req.cookies?.[sessionCookieName];
    if (!sid) return res.status(401).json({ error: 'Not authenticated' });
    const session = await db.getSession(sid);
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    req.session = session;
    next();
  }

  // Config (public)
  router.get('/config', (req, res) => {
    res.json({ maxFiles: limits.maxFiles, fileSizeLimitMB: limits.fileSizeLimitMB });
  });

  // Login/Logout
  router.post('/login', async (req, res) => {
    try {
      const { username, password, deviceId, alias } = req.body || {};
      if (username !== auth.username || password !== auth.password) {
        logger.warn('login.failed', { username: username || '', ip: req.ip });
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });
      await db.upsertDevice(deviceId, alias || null, req.headers['user-agent'] || '');
      const sid = uuidv4();
      await db.createSession(sid, deviceId);
      res.cookie(sessionCookieName, sid, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
      logger.info('login.success', { device_id: deviceId, alias: alias || '', ip: req.ip });
      res.json({ ok: true });
    } catch (err) {
      logger.error('login.error', { err });
      res.status(500).json({ error: 'Login failed' });
    }
  });

  router.post('/logout', requireAuth, async (req, res) => {
    try {
      if (req.session) await db.deleteSession(req.session.id);
      res.clearCookie(sessionCookieName);
      logger.info('logout', { device_id: req.session?.device_id });
      res.json({ ok: true });
    } catch (err) {
      logger.error('logout.error', { err });
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  router.get('/me', requireAuth, async (req, res) => {
    const device = await db.getDevice(req.session.device_id);
    res.json({ device, username: auth.username });
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
      const deviceId = req.session.device_id;
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
      const senderDeviceId = req.session.device_id;
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

  return router;
}

module.exports = createApiRouter;
