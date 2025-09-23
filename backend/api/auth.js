const express = require('express');
const { logger } = require('../services/logger');
const { signJWT, verifyJWT, verifyPassword, hashPassword } = require('../services/auth');

function createAuthRouter(options) {
  const { tokenCookieName, db, jwtSecret, jwtExpiresDays, kickUserSessions } = options;
  const router = express.Router();

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

  // Login
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

  // Logout
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

  // Get current user/device info
  router.get('/me', requireAuth, async (req, res) => {
    const device = await db.getDevice(req.device_id);
    const user = await db.getUserById(req.user.id);
    res.json({ device, user: { username: user.username, needsPasswordChange: !!user.is_default_password } });
  });

  // List devices
  router.get('/devices', requireAuth, async (req, res) => {
    const devices = await db.listDevices();
    res.json({ devices });
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

  // Update user credentials
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

      // Force logout by clearing cookie and kicking WS sessions
      try { res.clearCookie(tokenCookieName, { httpOnly: true, sameSite: 'lax', path: '/' }); } catch (_) {}
      try { if (typeof kickUserSessions === 'function') kickUserSessions(updated.id); } catch (_) {}

      res.json({ ok: true, loggedOut: true });
    } catch (err) {
      logger.error('admin.user.error', { err });
      res.status(500).json({ error: '更新用户失败' });
    }
  });

  return { router, requireAuth };
}

module.exports = createAuthRouter;