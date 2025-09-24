const net = require('net');

function normalizeIp(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';
  // Strip quotes in Forwarded: for="ip"
  s = s.replace(/^"|"$/g, '');
  // Remove IPv6 zone id
  s = s.replace(/%[0-9a-zA-Z]+$/, '');
  // If it's IPv6-mapped IPv4 (::ffff:127.0.0.1)
  if (s.startsWith('::ffff:')) s = s.slice(7);
  // If contains port for IPv4 (1.2.3.4:5678)
  if (/^[0-9.]+:\d+$/.test(s)) s = s.split(':')[0];
  // If bracketed IPv6 like [2001:db8::1]:443
  const m = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (m && m[1]) s = m[1];
  return s;
}

function isPrivate(ip) {
  const s = normalizeIp(ip);
  if (!s) return true;
  // IPv4 checks
  if (net.isIP(s) === 4) {
    const parts = s.split('.').map(n => parseInt(n, 10));
    const a = parts[0], b = parts[1];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 127) return true; // loopback
    return false;
  }
  // IPv6 checks
  if (net.isIP(s) === 6) {
    const lower = s.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:')) return true; // link-local fe80::/10
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local fc00::/7
    return false;
  }
  return true; // Unknown treated as private
}

function parseForwardedHeader(h) {
  // RFC 7239: Forwarded: for=1.2.3.4;proto=https;by=...
  if (!h) return [];
  const parts = String(h).split(',');
  const ips = [];
  for (const p of parts) {
    const m = /for=([^;]+)/i.exec(p);
    if (m && m[1]) ips.push(normalizeIp(m[1]));
  }
  return ips.filter(Boolean);
}

function headerIps(req) {
  const headers = req && req.headers ? req.headers : {};
  const get = (k) => headers[k] || headers[k.toLowerCase()] || headers[k.toUpperCase()];
  const list = [];
  const push = (val) => {
    if (!val) return;
    const s = String(val);
    for (const item of s.split(',').map(x => normalizeIp(x))) {
      if (item) list.push(item);
    }
  };
  // Priority single-IP headers from CDNs/reverse proxies
  push(get('cf-connecting-ip'));
  push(get('true-client-ip'));
  push(get('x-real-ip'));
  push(get('x-client-ip'));
  push(get('fly-client-ip'));
  push(get('fastly-client-ip'));
  // X-Forwarded-For (may contain multiple)
  push(get('x-forwarded-for'));
  // Forwarded (RFC 7239)
  for (const ip of parseForwardedHeader(get('forwarded'))) list.push(ip);
  return list;
}

function getClientIp(req) {
  try {
    const candidates = headerIps(req);
    // Prefer first public IP in header chain
    for (const ip of candidates) { if (net.isIP(ip) && !isPrivate(ip)) return ip; }
    // If none public, take the first valid
    for (const ip of candidates) { if (net.isIP(ip)) return ip; }
    // Fallback to Express-aware IP (obeys trust proxy), else socket address
    const fallback = normalizeIp(req?.ip || req?.connection?.remoteAddress || req?.socket?.remoteAddress || '');
    return fallback || '0.0.0.0';
  } catch (_) {
    return '0.0.0.0';
  }
}

module.exports = { getClientIp, isPrivate, normalizeIp };

