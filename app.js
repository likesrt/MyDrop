require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const WebSocket = require('ws');
const createApiRouter = require('./backend/api');
const db = require('./backend/services/db');
const { logger, requestLogger } = require('./backend/services/logger');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Config
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '0.0.0.0';
const { verifyJWT } = require('./backend/services/auth');
const TOKEN_COOKIE = 'token';
const MAX_FILES = process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : 10; // total files cap
const FILE_SIZE_LIMIT_MB = process.env.FILE_SIZE_LIMIT_MB ? parseInt(process.env.FILE_SIZE_LIMIT_MB, 10) : 5;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_DAYS = process.env.JWT_EXPIRES_DAYS ? parseInt(process.env.JWT_EXPIRES_DAYS, 10) : 7;
const HEADER_AUTO_HIDE = /^(1|true|yes)$/i.test(process.env.HEADER_AUTO_HIDE || '');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Initialize DB (creates sqlite.db and tables if not exist) then start server
async function boot() {
  try {
    await db.init();
    server.listen(PORT, HOST, () => {
      logger.info('server.listen', { host: HOST, port: PORT });
    });
  } catch (e) {
    logger.error('db.init.failed', { err: e });
    process.exit(1);
  }
}

// Middleware
app.use(cookieParser());
try { app.use(require('compression')()); } catch (_) {}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger(logger));
// Ensure local vendor assets are present (copy from node_modules if missing)
try { require('./scripts/copy-vendor'); } catch (_) {}
// Serve built static assets (Tailwind CSS, vendor libs) under frontend/templates/static
const TEMPLATES_DIR = path.join(__dirname, 'frontend/templates');
app.use('/static', express.static(path.join(TEMPLATES_DIR, 'static'), { maxAge: '30d', immutable: true }));
// Serve frontend JS files
app.use('/js', express.static(path.join(__dirname, 'frontend/js')));
// Serve template components
app.use('/templates', express.static(TEMPLATES_DIR));

// Serve minimal static assets only (moved under templates)
app.get('/', (req, res) => {
  res.sendFile(path.join(TEMPLATES_DIR, 'index.html'));
});
app.get('/demo', (req, res) => {
  res.sendFile(path.join(TEMPLATES_DIR, 'demo.html'));
});
app.get('/index.css', (req, res) => {
  res.type('text/css').sendFile(path.join(TEMPLATES_DIR, 'index.css'));
});

// Serve admin assets
app.get('/admin', (req, res) => {
  res.type('text/html').sendFile(path.join(TEMPLATES_DIR, 'admin.html'));
});
app.get('/admin.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, 'frontend/js/admin.js'));
});

// Mount API router (all HTTP endpoints live in api.js)
function kickDeviceById(deviceId) {
  try {
    for (const [token, obj] of clients.entries()) {
      if (obj?.deviceId === deviceId && obj.ws && obj.ws.readyState === WebSocket.OPEN) {
        try { obj.ws.send(JSON.stringify({ type: 'force-logout', reason: 'admin_kick' })); } catch (_) {}
        try { obj.ws.close(); } catch (_) {}
        clients.delete(token);
      }
    }
  } catch (_) {}
}

function kickUserSessions(userId, opts = {}) {
  const exceptDeviceId = opts.exceptDeviceId || null;
  try {
    for (const [token, obj] of clients.entries()) {
      if (obj?.userId === userId && (!exceptDeviceId || obj.deviceId !== exceptDeviceId)) {
        if (obj.ws && obj.ws.readyState === WebSocket.OPEN) {
          try { obj.ws.send(JSON.stringify({ type: 'force-logout', reason: 'password_change' })); } catch (_) {}
          try { obj.ws.close(); } catch (_) {}
        }
        clients.delete(token);
      }
    }
  } catch (_) {}
}

const apiRouter = createApiRouter({
  tokenCookieName: TOKEN_COOKIE,
  db,
  uploadDir: UPLOAD_DIR,
  limits: { maxFiles: MAX_FILES, fileSizeLimitMB: FILE_SIZE_LIMIT_MB },
  broadcast: (message) => broadcastMessage(message),
  jwtSecret: JWT_SECRET,
  jwtExpiresDays: JWT_EXPIRES_DAYS,
  kickDevice: kickDeviceById,
  kickUserSessions,
  features: { autoHideHeader: HEADER_AUTO_HIDE },
});
app.use(apiRouter);

// WebSocket handling
const clients = new Map(); // sid -> { ws, deviceId }

function broadcastMessage(message) {
  const payload = JSON.stringify({ type: 'message', data: message });
  let sent = 0;
  for (const { ws } of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) { ws.send(payload); sent++; }
  }
  try { if (message?.id) logger.debug('ws.broadcast', { message_id: message.id, recipients: sent }); } catch(_) {}
}

wss.on('connection', async (ws, req) => {
  // Read token from cookie header
  const cookies = Object.fromEntries((req.headers['cookie'] || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.split('='))
    .map(([k, v]) => [k, decodeURIComponent(v || '')]));
  const token = cookies[TOKEN_COOKIE];
  let claims = null;
  try { if (token) claims = verifyJWT(token, JWT_SECRET); } catch (_) {}
  if (!claims) {
    logger.warn('ws.reject', { reason: 'no-token' });
    try { ws.close(4001, 'unauthorized'); } catch (_) { try { ws.close(); } catch(_) {} }
    return;
  }
  // ensure device still exists
  try {
    // also ensure token version is still valid for user
    const user = await db.getUserById(claims.sub);
    if (!user || typeof claims.tv !== 'number' || claims.tv !== (user.token_version || 0)) {
      logger.warn('ws.reject', { reason: 'invalid-token-version', user_id: claims.sub });
      try { ws.close(4003, 'invalid-token'); } catch (_) { try { ws.close(); } catch(_) {} }
      return;
    }
    const device = await db.getDevice(claims.device_id);
    if (!device) {
      logger.warn('ws.reject', { reason: 'device-revoked', device_id: claims.device_id });
      try { ws.close(4002, 'device-revoked'); } catch (_) { try { ws.close(); } catch(_) {} }
      return;
    }
  } catch (_) { ws.close(); return; }

  clients.set(token, { ws, deviceId: claims.device_id, userId: claims.sub });
  logger.info('ws.connect', { device_id: claims.device_id });

  ws.on('message', async (raw) => {
    // For future ping/pong or typing events
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    clients.delete(token);
    logger.info('ws.close', {});
  });
});

boot();

// Global error logging
process.on('unhandledRejection', (err) => {
  try { logger.error('unhandledRejection', { err }); } catch (_) {}
});
process.on('uncaughtException', (err) => {
  try { logger.error('uncaughtException', { err }); } catch (_) {}
});
