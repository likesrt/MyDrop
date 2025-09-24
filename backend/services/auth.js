const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlToBuffer(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  return Buffer.from(s + pad, 'base64');
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

// TOTP (RFC 6238) helpers
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str) {
  const s = String(str || '').toUpperCase().replace(/=+$/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(s[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateTOTPSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  return base32Encode(buf);
}

function hotp(secretBase32, counter, digits = 6, algo = 'sha1') {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  let tmp = BigInt(counter);
  for (let i = 7; i >= 0; i--) { msg[i] = Number(tmp & 0xffn); tmp >>= 8n; }
  const hmac = crypto.createHmac(algo, key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | (hmac[offset + 3]);
  const code = (bin % (10 ** digits)).toString().padStart(digits, '0');
  return code;
}

function totp(secretBase32, step = 30, t0 = 0, digits = 6, algo = 'sha1') {
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor((now - t0) / step);
  return hotp(secretBase32, counter, digits, algo);
}

function verifyTOTP(code, secretBase32, { step = 30, window = 1, digits = 6, algo = 'sha1' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const center = Math.floor(now / step);
  const target = String(code || '').replace(/\s+/g, '');
  for (let w = -window; w <= window; w++) {
    const c = center + w;
    const h = hotp(secretBase32, c, digits, algo);
    if (crypto.timingSafeEqual(Buffer.from(h), Buffer.from(target))) return true;
  }
  return false;
}

module.exports = {
  signJWT,
  verifyJWT,
  hashPassword,
  verifyPassword,
  b64url,
  b64urlToBuffer,
  generateTOTPSecret,
  totp,
  verifyTOTP,
};
