const fs = require('fs');
const path = require('path');
const { getClientIp } = require('../utils/ip');

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_FILE = process.env.LOG_FILE || '';
const LOG_MAX_SIZE_MB = process.env.LOG_MAX_SIZE_MB ? Math.max(1, parseInt(process.env.LOG_MAX_SIZE_MB, 10)) : 5; // default 5MB
const LOG_ROTATE_KEEP = process.env.LOG_ROTATE_KEEP ? Math.max(1, parseInt(process.env.LOG_ROTATE_KEEP, 10)) : 5; // default keep 5 files
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
    this.rotating = false;
    this.queue = [];
    this.stream = null;
    this._sizeAtOpen = 0;
    this.maxBytes = Math.max(1, LOG_MAX_SIZE_MB) * 1024 * 1024;
    this.keep = Math.max(1, LOG_ROTATE_KEEP);
    this.filePath = '';
    if (LOG_FILE) {
      const abs = path.isAbsolute(LOG_FILE) ? LOG_FILE : path.join(process.cwd(), LOG_FILE);
      ensureDir(abs);
      this.filePath = abs;
      this._openStream();
    }
  }

  log(level, msg, meta = {}) {
    if (levelVal(level) < this.level) return;
    const rec = { ts: new Date().toISOString(), level, msg, ...sanitizeMeta(meta) };
    const line = safeStringify(rec) + '\n';
    if (this.stream) {
      // Simple size-based rotation: ensure current log file never exceeds configured limit
      if (this.rotating) {
        this.queue.push(line);
        return;
      }
      try {
        const projected = this._currentSize() + Buffer.byteLength(line);
        if (projected > this.maxBytes) {
          this.queue.push(line);
          this._rotate();
          return;
        }
      } catch (_) {
        // On failure to determine size, fall back to best-effort write
      }
      try { this.stream.write(line); } catch (_) {}
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

// Internal helpers for file rotation
Logger.prototype._openStream = function () {
  try {
    const exists = fs.existsSync(this.filePath);
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    this._sizeAtOpen = 0;
    if (exists) {
      try { const st = fs.statSync(this.filePath); this._sizeAtOpen = st.size || 0; } catch (_) { this._sizeAtOpen = 0; }
    }
  } catch (_) {
    this.stream = null;
  }
};

Logger.prototype._currentSize = function () {
  if (!this.stream) return 0;
  try {
    return (this._sizeAtOpen || 0) + (this.stream.bytesWritten || 0);
  } catch (_) { return 0; }
};

Logger.prototype._rotate = function () {
  if (!this.filePath || this.rotating) return;
  this.rotating = true;
  const oldStream = this.stream;
  this.stream = null;

  const finalize = () => {
    try {
      const rotatedPath = this._makeRotatedFilename();
      try { fs.renameSync(this.filePath, rotatedPath); } catch (_) {}
      this._openStream();
      this._pruneOld();
    } finally {
      this.rotating = false;
      // Flush any queued lines to the new stream
      if (this.stream && this.queue && this.queue.length) {
        try {
          const lines = this.queue;
          this.queue = [];
          for (const l of lines) { try { this.stream.write(l); } catch (_) {} }
        } catch (_) {}
      }
    }
  };

  try {
    if (oldStream) {
      // Close the stream; on 'close', rename and reopen
      try { oldStream.once('close', finalize); } catch (_) { setImmediate(finalize); }
      try { oldStream.end(); } catch (_) { setImmediate(finalize); }
    } else {
      setImmediate(finalize);
    }
  } catch (_) {
    this.rotating = false;
  }
};

Logger.prototype._makeRotatedFilename = function () {
  const p = path.parse(this.filePath);
  const ts = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = [
    ts.getFullYear(),
    pad(ts.getMonth() + 1),
    pad(ts.getDate())
  ].join('') + '-' + [pad(ts.getHours()), pad(ts.getMinutes()), pad(ts.getSeconds())].join('');
  const baseName = p.name;
  const ext = p.ext || '.log';
  const rotated = `${baseName}.${stamp}${ext}`;
  return path.join(p.dir || '.', rotated);
};

Logger.prototype._pruneOld = function () {
  try {
    const p = path.parse(this.filePath);
    const dir = p.dir || '.';
    const baseName = p.name;
    const ext = p.ext || '.log';
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + esc(baseName) + '\\.[0-9]{8}-[0-9]{6}' + esc(ext) + '$');
    const files = fs.readdirSync(dir).filter(f => re.test(f)).map(f => ({ f, p: path.join(dir, f) }));
    if (files.length <= this.keep) return;
    files.sort((a, b) => a.f.localeCompare(b.f)); // timestamp-friendly lexicographic sort
    const toDelete = files.slice(0, Math.max(0, files.length - this.keep));
    for (const x of toDelete) { try { fs.unlinkSync(x.p); } catch (_) {} }
  } catch (_) {}
};

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
    const ip = getClientIp(req);
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
