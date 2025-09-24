const express = require('express');
const crypto = require('crypto');
let QRCode;
try { QRCode = require('qrcode'); } catch (_) { QRCode = null; }
const { logger } = require('../services/logger');
const { signJWT, verifyJWT, verifyPassword, hashPassword, verifyTOTP, generateTOTPSecret, b64urlToBuffer } = require('../services/auth');

function createAuthRouter(options) {
  const { tokenCookieName, db, jwtSecret, jwtExpiresDays, tempLoginMinutes = 10, kickUserSessions } = options;
  const router = express.Router();

  // In-memory ephemeral stores
  const pendingMFA = new Map(); // mfaToken -> { userId, username, deviceId, alias, remember, issuedAt }
  const webauthnRegs = new Map(); // flowId -> { userId, challenge, rpId, origin, issuedAt }
  const webauthnLogins = new Map(); // flowId -> { challenge, rpId, origin, issuedAt }
  const FLOW_TTL_MS = 5 * 60 * 1000;
  const qrSessions = new Map(); // rid -> { codeHash, createdAt, expiresAt, approvedBy: userId|null, consumed: bool }
  const QR_TTL_MS = 2 * 60 * 1000; // 2 minutes

  function now() { return Date.now(); }
  function gcEphemeral() {
    const limit = now() - FLOW_TTL_MS;
    for (const [k, v] of pendingMFA.entries()) { if ((v.issuedAt || 0) < limit) pendingMFA.delete(k); }
    for (const [k, v] of webauthnRegs.entries()) { if ((v.issuedAt || 0) < limit) webauthnRegs.delete(k); }
    for (const [k, v] of webauthnLogins.entries()) { if ((v.issuedAt || 0) < limit) webauthnLogins.delete(k); }
    // cleanup QR sessions
    const nowTs = now();
    for (const [k, v] of qrSessions.entries()) { if ((v.expiresAt || 0) < nowTs || v.consumed) qrSessions.delete(k); }
  }
  setInterval(gcEphemeral, 60 * 1000).unref?.();

  function randomId(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  function getExpectedOrigin(req) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = req.get('host');
    return `${proto}://${host}`;
  }

  function isSecureReq(req) {
    if (req.secure) return true;
    const xf = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim().toLowerCase();
    return xf === 'https';
  }

  function cookieOptsFor(req, maxAgeMs = null) {
    const base = { httpOnly: true, sameSite: 'lax', path: '/' };
    if (isSecureReq(req)) base.secure = true;
    if (typeof maxAgeMs === 'number' && maxAgeMs > 0) base.maxAge = maxAgeMs;
    return base;
  }

  // Auth middleware
  async function requireAuth(req, res, next) {
    try {
      const token = req.cookies?.[tokenCookieName] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ error: '未登录' });
      const claims = verifyJWT(token, jwtSecret);
      // verify token version against DB
      const user = await db.getUserById(claims.sub);
      if (!user || typeof claims.tv !== 'number' || claims.tv !== (user.token_version || 0)) {
        try { res.clearCookie(tokenCookieName, cookieOptsFor(req)); } catch (_) {}
        return res.status(401).json({ error: '令牌无效' });
      }
      req.user = { id: claims.sub, username: claims.username };
      req.device_id = claims.device_id;
      // ensure device still exists (revoked device should not access)
      const device = await db.getDevice(req.device_id);
      if (!device) {
        try { res.clearCookie(tokenCookieName, cookieOptsFor(req)); } catch (_) {}
        return res.status(401).json({ error: '设备已撤销' });
      }
      req.device = device;
      next();
    } catch (e) {
      return res.status(401).json({ error: '令牌无效' });
    }
  }

  // Login
  router.post('/login', async (req, res) => {
    try {
      const { username, password, deviceId, alias } = req.body || {};
      const remember = !!(req.body && (req.body.remember === true || req.body.remember === '1' || req.body.remember === 1 || String(req.body.remember).toLowerCase() === 'true'));
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

      // If TOTP is enabled, require second factor
      if (user.totp_enabled) {
        const mfaToken = randomId(24);
        pendingMFA.set(mfaToken, { userId: user.id, username: user.username, deviceId, alias: alias || null, remember: !!remember, issuedAt: now() });
        logger.info('login.password_ok_mfa_required', { device_id: deviceId });
        return res.json({ ok: true, mfaRequired: 'totp', mfaToken });
      }

      await db.upsertDevice(deviceId, alias || null, req.headers['user-agent'] || '');
      const days = Number.isFinite(jwtExpiresDays) ? jwtExpiresDays : 7;
      const tmpSec = Math.max(60, (parseInt(tempLoginMinutes, 10) || 10) * 60);
      const expiresSec = remember ? (days > 0 ? days * 24 * 60 * 60 : null) : tmpSec;
      const token = signJWT({ sub: user.id, username: user.username, device_id: deviceId, tv: user.token_version || 0 }, jwtSecret, expiresSec);
      const cookieMaxAge = (remember && days > 0) ? (expiresSec * 1000) : null; // session cookie for temporary login
      res.cookie(tokenCookieName, token, cookieOptsFor(req, cookieMaxAge));

      logger.info('login.success', { device_id: deviceId, alias: alias || '', remember: !!remember, ip: req.ip });
      res.json({ ok: true, needsPasswordChange: !!user.is_default_password });
    } catch (err) {
      logger.error('login.error', { err });
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // Verify TOTP for pending login
  router.post('/login/totp', async (req, res) => {
    try {
      const { mfaToken, code } = req.body || {};
      if (!mfaToken || !code) return res.status(400).json({ error: '缺少验证码' });
      const flow = pendingMFA.get(mfaToken);
      if (!flow) return res.status(400).json({ error: '登录会话已过期' });
      pendingMFA.delete(mfaToken);
      const user = await db.getUserById(flow.userId);
      if (!user || !user.totp_enabled || !user.totp_secret) return res.status(400).json({ error: '二步验证未开启' });
      const ok = verifyTOTP(String(code), String(user.totp_secret));
      if (!ok) {
        logger.warn('login.totp.failed', { user_id: flow.userId });
        return res.status(401).json({ error: '验证码不正确' });
      }

      await db.upsertDevice(flow.deviceId, flow.alias || null, req.headers['user-agent'] || '');
      const days = Number.isFinite(jwtExpiresDays) ? jwtExpiresDays : 7;
      const tmpSec = Math.max(60, (parseInt(tempLoginMinutes, 10) || 10) * 60);
      const expiresSec = flow.remember ? (days > 0 ? days * 24 * 60 * 60 : null) : tmpSec;
      const token = signJWT({ sub: user.id, username: user.username, device_id: flow.deviceId, tv: user.token_version || 0 }, jwtSecret, expiresSec);
      const cookieMaxAge = (flow.remember && days > 0) ? (expiresSec * 1000) : null;
      res.cookie(tokenCookieName, token, cookieOptsFor(req, cookieMaxAge));
      logger.info('login.totp.success', { device_id: flow.deviceId });
      res.json({ ok: true, needsPasswordChange: !!user.is_default_password });
    } catch (err) {
      logger.error('login.totp.error', { err });
      res.status(500).json({ error: 'Login with TOTP failed' });
    }
  });

  // Logout
  router.post('/logout', requireAuth, async (req, res) => {
    try {
      res.clearCookie(tokenCookieName, cookieOptsFor(req));
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
    const passkeyCount = await db.countWebAuthnCredentials(user.id);
    res.json({ device, user: { username: user.username, needsPasswordChange: !!user.is_default_password, totpEnabled: !!user.totp_enabled, passkeyCount, qrLoginEnabled: !!user.qr_login_enabled } });
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
      // demo分支：禁用用户名密码修改功能
      return res.status(403).json({ error: '演示服务器已禁用用户名密码修改功能' });

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
      try { res.clearCookie(tokenCookieName, cookieOptsFor(req)); } catch (_) {}
      try { if (typeof kickUserSessions === 'function') kickUserSessions(updated.id); } catch (_) {}

      res.json({ ok: true, loggedOut: true });
    } catch (err) {
      logger.error('admin.user.error', { err });
      res.status(500).json({ error: '更新用户失败' });
    }
  });

  // TOTP setup: begin (generate secret + otpauth uri)
  router.post('/mfa/totp/begin', requireAuth, async (req, res) => {
    try {
      const { password } = req.body || {};
      const user = await db.getUserById(req.user.id);
      if (!verifyPassword(password || '', user.password_hash)) {
        return res.status(400).json({ error: '密码不正确' });
      }
      const secret = generateTOTPSecret();
      const label = encodeURIComponent(`MyDrop:${user.username}`);
      const issuer = encodeURIComponent('MyDrop');
      const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
      res.json({ ok: true, secret, otpauth });
    } catch (err) {
      logger.error('mfa.totp.begin.error', { err });
      res.status(500).json({ error: '生成密钥失败' });
    }
  });

  // TOTP enable
  router.post('/mfa/totp/enable', requireAuth, async (req, res) => {
    try {
      const { secret, code } = req.body || {};
      const user = await db.getUserById(req.user.id);
      if (!secret || !code) return res.status(400).json({ error: '缺少参数' });
      const ok = verifyTOTP(String(code), String(secret));
      if (!ok) return res.status(400).json({ error: '验证码不正确' });
      await db.setUserTOTPEnabled(user.id, String(secret), true);
      logger.info('mfa.totp.enabled', { user_id: user.id });
      res.json({ ok: true });
    } catch (err) {
      logger.error('mfa.totp.enable.error', { err });
      res.status(500).json({ error: '启用失败' });
    }
  });

  // TOTP QR (SVG) - for otpauth URI
  router.get('/mfa/totp/qr', requireAuth, async (req, res) => {
    try {
      if (!QRCode) return res.status(500).send('QR unavailable');
      const uri = (req.query.otpauth || '').toString();
      if (!uri.startsWith('otpauth://')) return res.status(400).send('Bad request');
      const svg = await QRCode.toString(uri, { type: 'svg', margin: 0, width: 256 });
      res.type('image/svg+xml').send(svg);
    } catch (err) {
      logger.error('mfa.totp.qr.error', { err });
      res.status(500).send('QR failed');
    }
  });

  // TOTP disable
  router.post('/mfa/totp/disable', requireAuth, async (req, res) => {
    try {
      const { password } = req.body || {};
      const user = await db.getUserById(req.user.id);
      if (!verifyPassword(password || '', user.password_hash)) {
        return res.status(400).json({ error: '密码不正确' });
      }
      await db.setUserTOTPEnabled(user.id, null, false);
      logger.info('mfa.totp.disabled', { user_id: user.id });
      res.json({ ok: true });
    } catch (err) {
      logger.error('mfa.totp.disable.error', { err });
      res.status(500).json({ error: '关闭失败' });
    }
  });

  // ===== QR Code Login =====
  function hashCode(code) {
    return crypto.createHash('sha256').update(String(code)).digest('hex');
  }

  // Create a new QR login session
  router.post('/login/qr/start', async (req, res) => {
    try {
      const rid = randomId(16);
      const code = randomId(16);
      const createdAt = now();
      const expiresAt = createdAt + QR_TTL_MS;
      qrSessions.set(rid, { codeHash: hashCode(code), createdAt, expiresAt, approvedBy: null, consumed: false });
      const origin = getExpectedOrigin(req);
      const scanUrl = `${origin}/login/qr/scan?rid=${encodeURIComponent(rid)}&code=${encodeURIComponent(code)}`;
      res.json({ ok: true, rid, code, expiresAt, scanUrl });
    } catch (err) {
      logger.error('qr.start.error', { err });
      res.status(500).json({ error: '无法创建会话' });
    }
  });

  // QR SVG image encoding parameters (not a URL)
  router.get('/login/qr/svg', async (req, res) => {
    try {
      if (!QRCode) return res.status(500).send('QR unavailable');
      const rid = (req.query.rid || '').toString();
      const code = (req.query.code || '').toString();
      const sess = qrSessions.get(rid);
      if (!rid || !code || !sess) return res.status(404).send('Not found');
      if (sess.consumed || (sess.expiresAt && sess.expiresAt < now())) return res.status(410).send('Expired');
      if (sess.codeHash !== hashCode(code)) return res.status(400).send('Bad request');
      const payload = JSON.stringify({ t: 'mydrop.qr', v: 1, rid, code });
      const svg = await QRCode.toString(payload, { type: 'svg', margin: 0, width: 256 });
      res.type('image/svg+xml').send(svg);
    } catch (err) {
      logger.error('qr.svg.error', { err });
      res.status(500).send('QR failed');
    }
  });

  // Scanning approve endpoint (must be from an authenticated, already-logged-in device)
  router.post('/login/qr/approve', requireAuth, async (req, res) => {
    try {
      const { rid, code, remember } = req.body || {};
      const sess = qrSessions.get(String(rid || ''));
      if (!sess) return res.status(404).json({ error: '会话不存在' });
      if (sess.consumed) return res.status(400).json({ error: '会话已使用' });
      if (sess.expiresAt && sess.expiresAt < now()) return res.status(400).json({ error: '会话已过期' });
      if (sess.codeHash !== hashCode(String(code || ''))) return res.status(400).json({ error: '无效参数' });

      const user = await db.getUserById(req.user.id);
      if (!user || !user.qr_login_enabled) return res.status(403).json({ error: '扫码登录已关闭' });

      sess.approvedBy = user.id;
      if (typeof remember !== 'undefined') sess.remember = !!remember;
      qrSessions.set(String(rid), sess);
      logger.info('qr.approve.api', { rid: String(rid), user_id: user.id, remember: !!sess.remember });
      res.json({ ok: true });
    } catch (err) {
      logger.error('qr.approve.error', { err });
      res.status(500).json({ error: '批准失败' });
    }
  });

  // Legacy GET scanning endpoint removed

  // Poll status from the new device
  router.get('/login/qr/status', async (req, res) => {
    try {
      const rid = (req.query.rid || '').toString();
      const code = (req.query.code || '').toString();
      const sess = qrSessions.get(rid);
      if (!rid || !code || !sess) return res.status(404).json({ ok: false, error: 'not_found' });
      if (sess.codeHash !== hashCode(code)) return res.status(400).json({ ok: false, error: 'invalid' });
      if (sess.consumed) return res.json({ ok: true, approved: true, consumed: true });
      if (sess.expiresAt && sess.expiresAt < now()) return res.json({ ok: true, approved: false, expired: true });
      res.json({ ok: true, approved: !!sess.approvedBy, expired: false });
    } catch (err) {
      logger.error('qr.status.error', { err });
      res.status(500).json({ error: '状态读取失败' });
    }
  });

  // Consume: issue cookie for the new device once approved
  router.post('/login/qr/consume', async (req, res) => {
    try {
      const { rid, code, deviceId, alias } = req.body || {};
      const remember = !!(req.body && (req.body.remember === true || req.body.remember === '1' || req.body.remember === 1 || String(req.body.remember).toLowerCase() === 'true'));
      if (!rid || !code || !deviceId) return res.status(400).json({ error: '缺少参数' });
      const sess = qrSessions.get(String(rid));
      if (!sess) return res.status(404).json({ error: '会话不存在' });
      if (sess.consumed) return res.status(400).json({ error: '会话已使用' });
      if (sess.expiresAt && sess.expiresAt < now()) return res.status(400).json({ error: '会话已过期' });
      if (sess.codeHash !== hashCode(String(code))) return res.status(400).json({ error: '无效二维码' });
      if (!sess.approvedBy) return res.status(400).json({ error: '尚未批准' });

      const user = await db.getUserById(sess.approvedBy);
      if (!user) return res.status(400).json({ error: '用户不存在' });

      await db.upsertDevice(String(deviceId), (alias || null), req.headers['user-agent'] || '');
      const days = Number.isFinite(jwtExpiresDays) ? jwtExpiresDays : 7;
      const tmpSec = Math.max(60, (parseInt(tempLoginMinutes, 10) || 10) * 60);
      const rememberFinal = (typeof sess.remember === 'boolean') ? !!sess.remember : !!remember;
      const expiresSec = rememberFinal ? (days > 0 ? days * 24 * 60 * 60 : null) : tmpSec;
      const token = signJWT({ sub: user.id, username: user.username, device_id: String(deviceId), tv: user.token_version || 0 }, jwtSecret, expiresSec);
      const cookieMaxAge = (rememberFinal && days > 0) ? (expiresSec * 1000) : null;
      res.cookie(tokenCookieName, token, cookieOptsFor(req, cookieMaxAge));
      sess.consumed = true;
      qrSessions.set(String(rid), sess);
      logger.info('qr.consume', { rid, device_id: String(deviceId) });
      res.json({ ok: true, needsPasswordChange: !!user.is_default_password });
    } catch (err) {
      logger.error('qr.consume.error', { err });
      res.status(500).json({ error: '登录失败' });
    }
  });

  // Toggle QR login availability
  router.post('/settings/qr', requireAuth, async (req, res) => {
    try {
      const { enabled } = req.body || {};
      const user = await db.getUserById(req.user.id);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      const updated = await db.setUserQRLoginEnabled(user.id, !!enabled);
      logger.info('settings.qr_login', { user_id: user.id, enabled: !!enabled });
      res.json({ ok: true, enabled: !!updated.qr_login_enabled });
    } catch (err) {
      logger.error('settings.qr_login.error', { err });
      res.status(500).json({ error: '设置失败' });
    }
  });

  // WebAuthn register start
  router.post('/webauthn/register/start', requireAuth, async (req, res) => {
    try {
      const user = await db.getUserById(req.user.id);
      const rpId = req.hostname;
      const origin = getExpectedOrigin(req);
      const challenge = crypto.randomBytes(32).toString('base64url');
      const flowId = randomId(24);
      webauthnRegs.set(flowId, { userId: user.id, challenge, rpId, origin, issuedAt: now() });
      const pubkeyCredParams = [
        { type: 'public-key', alg: -7 }, // ES256
      ];
      const options = {
        challenge,
        rp: { id: rpId, name: 'MyDrop' },
        user: { id: Buffer.from(String(user.id)), name: user.username, displayName: user.username },
        pubKeyCredParams: pubkeyCredParams,
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      };
      res.json({ ok: true, flowId, publicKey: options });
    } catch (err) {
      logger.error('webauthn.register.start.error', { err });
      res.status(500).json({ error: '无法开始注册' });
    }
  });

  // WebAuthn register finish (expects client to send extracted publicKey PEM)
  router.post('/webauthn/register/finish', requireAuth, async (req, res) => {
    try {
      const { flowId, credentialId, publicKeyPem, signCount, transports } = req.body || {};
      const flow = webauthnRegs.get(flowId);
      webauthnRegs.delete(flowId);
      if (!flow) return res.status(400).json({ error: '注册会话已过期' });
      if (!credentialId || !publicKeyPem) return res.status(400).json({ error: '缺少凭证' });
      const credId = String(credentialId);
      await db.addWebAuthnCredential({ userId: flow.userId, credId, publicKeyPem: String(publicKeyPem), signCount: parseInt(signCount || '0', 10) || 0, transports: transports ? String(transports) : null });
      logger.info('webauthn.register.success', { user_id: flow.userId });
      res.json({ ok: true });
    } catch (err) {
      logger.error('webauthn.register.finish.error', { err });
      res.status(500).json({ error: '注册失败' });
    }
  });

  // List WebAuthn credentials
  router.get('/webauthn/credentials', requireAuth, async (req, res) => {
    try {
      const list = await db.getWebAuthnCredentialsByUser(req.user.id);
      res.json({ ok: true, credentials: list.map(c => ({ id: c.id, sign_count: c.sign_count, transports: c.transports, created_at: c.created_at })) });
    } catch (err) {
      logger.error('webauthn.creds.error', { err });
      res.status(500).json({ error: '读取凭证失败' });
    }
  });

  router.post('/webauthn/credential/delete', requireAuth, async (req, res) => {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: '缺少ID' });
      const cred = await db.getWebAuthnCredential(String(id));
      if (!cred || cred.user_id !== req.user.id) return res.status(404).json({ error: '不存在' });
      await db.deleteWebAuthnCredential(String(id));
      res.json({ ok: true });
    } catch (err) {
      logger.error('webauthn.cred.delete.error', { err });
      res.status(500).json({ error: '删除失败' });
    }
  });

  // WebAuthn login start (usernameless)
  router.post('/webauthn/login/start', async (req, res) => {
    try {
      const rpId = req.hostname;
      const origin = getExpectedOrigin(req);
      const challenge = crypto.randomBytes(32).toString('base64url');
      const flowId = randomId(24);
      webauthnLogins.set(flowId, { challenge, rpId, origin, issuedAt: now() });
      const options = {
        challenge,
        rpId,
        timeout: 60000,
        userVerification: 'preferred',
      };
      res.json({ ok: true, flowId, publicKey: options });
    } catch (err) {
      logger.error('webauthn.login.start.error', { err });
      res.status(500).json({ error: '无法开始登录' });
    }
  });

  // WebAuthn login finish
  router.post('/webauthn/login/finish', async (req, res) => {
    try {
      const { flowId, id, response, deviceId, alias } = req.body || {};
      const remember = !!(req.body && (req.body.remember === true || req.body.remember === '1' || req.body.remember === 1 || String(req.body.remember).toLowerCase() === 'true'));
      if (!flowId || !id || !response || !deviceId) return res.status(400).json({ error: '缺少参数' });
      const flow = webauthnLogins.get(flowId);
      webauthnLogins.delete(flowId);
      if (!flow) return res.status(400).json({ error: '登录会话已过期' });
      const cred = await db.getWebAuthnCredential(String(id));
      if (!cred) return res.status(401).json({ error: '凭证不存在' });

      const clientDataJSON = b64urlToBuffer(response.clientDataJSON);
      const client = JSON.parse(clientDataJSON.toString('utf8'));
      if (client.type !== 'webauthn.get') return res.status(400).json({ error: '类型不匹配' });
      if (client.challenge !== flow.challenge) return res.status(400).json({ error: '挑战不匹配' });
      if (client.origin !== flow.origin) return res.status(400).json({ error: '来源不匹配' });

      const authData = b64urlToBuffer(response.authenticatorData);
      const rpIdHash = crypto.createHash('sha256').update(flow.rpId).digest();
      if (!authData.slice(0, 32).equals(rpIdHash)) return res.status(400).json({ error: 'RPID 校验失败' });
      const flags = authData[32];
      const up = !!(flags & 0x01);
      if (!up) return res.status(400).json({ error: '需要用户存在(UP)' });
      const signCount = authData.readUInt32BE(33);

      const sig = b64urlToBuffer(response.signature);
      const clientHash = crypto.createHash('sha256').update(clientDataJSON).digest();
      const data = Buffer.concat([authData, clientHash]);
      const verifier = crypto.createVerify('sha256');
      verifier.update(data);
      verifier.end();
      const ok = verifier.verify(cred.public_key_pem, sig);
      if (!ok) return res.status(401).json({ error: '签名校验失败' });

      // Update counter (best-effort)
      try { if (signCount > (cred.sign_count || 0)) await db.updateWebAuthnCounter(cred.id, signCount); } catch (_) {}

      const user = await db.getUserById(cred.user_id);
      await db.upsertDevice(deviceId, alias || null, req.headers['user-agent'] || '');
      const days = Number.isFinite(jwtExpiresDays) ? jwtExpiresDays : 7;
      const tmpSec = Math.max(60, (parseInt(tempLoginMinutes, 10) || 10) * 60);
      const expiresSec = remember ? (days > 0 ? days * 24 * 60 * 60 : null) : tmpSec;
      const token = signJWT({ sub: user.id, username: user.username, device_id: deviceId, tv: user.token_version || 0 }, jwtSecret, expiresSec);
      const cookieMaxAge = (remember && days > 0) ? (expiresSec * 1000) : null;
      res.cookie(tokenCookieName, token, cookieOptsFor(req, cookieMaxAge));
      logger.info('login.passkey.success', { device_id: deviceId });
      res.json({ ok: true, needsPasswordChange: !!user.is_default_password });
    } catch (err) {
      logger.error('webauthn.login.finish.error', { err });
      res.status(500).json({ error: '登录失败' });
    }
  });

  return { router, requireAuth };
}

module.exports = createAuthRouter;
