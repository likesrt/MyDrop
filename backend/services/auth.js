const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlJSON(obj) {
  return b64url(JSON.stringify(obj));
}

function signJWT(payload, secret, expiresSeconds = null) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSec = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: nowSec };
  if (typeof expiresSeconds === 'number' && expiresSeconds > 0) {
    body.exp = nowSec + expiresSeconds;
  }
  const unsigned = b64urlJSON(header) + '.' + b64urlJSON(body);
  const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return unsigned + '.' + sig;
}

function verifyJWT(token, secret) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [h, p, s] = parts;
  const expected = crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) throw new Error('Invalid signature');
  const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) throw new Error('Token expired');
  return payload;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 120000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, salt, hash] = String(stored).split('$');
    if (scheme !== 'pbkdf2') return false;
    const iterations = parseInt(iterStr, 10) || 0;
    const calc = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash));
  } catch (_) {
    return false;
  }
}

module.exports = {
  signJWT,
  verifyJWT,
  hashPassword,
  verifyPassword,
};

