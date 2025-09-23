require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const WebSocket = require('ws');
const createApiRouter = require('./api');
const db = require('./db');
const { logger, requestLogger } = require('./logger');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Config
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin';
const SESSION_COOKIE = 'sid';
const MAX_FILES = process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : 10; // total files cap
const FILE_SIZE_LIMIT_MB = process.env.FILE_SIZE_LIMIT_MB ? parseInt(process.env.FILE_SIZE_LIMIT_MB, 10) : 5;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger(logger));

// Serve minimal static assets only
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/index.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, 'index.js'));
});
app.get('/index.css', (req, res) => {
  res.type('text/css').sendFile(path.join(__dirname, 'index.css'));
});

// Mount API router (all HTTP endpoints live in api.js)
const apiRouter = createApiRouter({
  auth: { username: AUTH_USERNAME, password: AUTH_PASSWORD },
  sessionCookieName: SESSION_COOKIE,
  db,
  uploadDir: UPLOAD_DIR,
  limits: { maxFiles: MAX_FILES, fileSizeLimitMB: FILE_SIZE_LIMIT_MB },
  broadcast: (message) => broadcastMessage(message),
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
  // Read sid from cookie header
  const cookies = Object.fromEntries((req.headers['cookie'] || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.split('='))
    .map(([k, v]) => [k, decodeURIComponent(v || '')]));
  const sid = cookies[SESSION_COOKIE];
  const session = sid ? await db.getSession(sid) : null;
  if (!session) {
    logger.warn('ws.reject', { reason: 'no-session' });
    ws.close();
    return;
  }

  clients.set(sid, { ws, deviceId: session.device_id });
  logger.info('ws.connect', { sid, device_id: session.device_id });

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
    clients.delete(sid);
    logger.info('ws.close', { sid });
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
