const fs = require('fs');
const path = require('path');

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_FILE = process.env.LOG_FILE || '';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function levelVal(lvl) {
  return LEVELS[lvl] || LEVELS.info;
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return JSON.stringify(String(obj));
  }
}

function ensureDir(p) {
  try {
    const dir = path.dirname(p);
    if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
}

class Logger {
  constructor() {
    this.level = levelVal(LOG_LEVEL);
    if (LOG_FILE) {
      ensureDir(LOG_FILE);
      this.stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    } else {
      this.stream = null;
    }
  }

  log(level, msg, meta = {}) {
    if (levelVal(level) < this.level) return;
    const rec = { ts: new Date().toISOString(), level, msg, ...sanitizeMeta(meta) };
    const line = safeStringify(rec) + '\n';
    if (this.stream) {
      this.stream.write(line);
    } else {
      // console output
      if (level === 'error') console.error(line.trim());
      else if (level === 'warn') console.warn(line.trim());
      else console.log(line.trim());
    }
  }

  debug(msg, meta) { this.log('debug', msg, meta); }
  info(msg, meta) { this.log('info', msg, meta); }
  warn(msg, meta) { this.log('warn', msg, meta); }
  error(msg, meta) { this.log('error', msg, meta); }
}

function sanitizeMeta(meta) {
  // Avoid logging secrets
  const clone = { ...meta };
  if (clone.password) clone.password = '[redacted]';
  if (clone.headers) clone.headers = undefined;
  if (clone.req && clone.req.headers) clone.req = undefined;
  if (clone.err instanceof Error) clone.err = serializeError(clone.err);
  return clone;
}

function serializeError(err) {
  return { name: err.name, message: err.message, stack: err.stack };
}

function requestLogger(logger) {
  return function (req, res, next) {
    // Skip noisy static and template assets
    try {
      const p = req.originalUrl || req.url || '';
      if (req.method === 'GET') {
        if (p === '/sw.js' || p === '/index.css' || p === '/admin.js' ||
            p.startsWith('/static/') || p.startsWith('/js/') || p.startsWith('/templates/components/')) {
          return next();
        }
      }
    } catch (_) {}
    const start = process.hrtime.bigint();
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip;
    res.on('finish', () => {
      const durMs = Number(process.hrtime.bigint() - start) / 1e6;
      const meta = {
        ip,
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        duration_ms: Math.round(durMs),
      };
      if (req.session?.device_id) meta.device_id = req.session.device_id;
      logger.info('http.request', meta);
    });
    next();
  };
}

const logger = new Logger();

module.exports = {
  logger,
  requestLogger,
  serializeError,
};
