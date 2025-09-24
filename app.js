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
const os = require('os');

const app = express();
// Entry hardening
app.disable('x-powered-by');
app.set('trust proxy', true);
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Config
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '0.0.0.0';
const LOG_FILE = process.env.LOG_FILE || '';
const { verifyJWT } = require('./backend/services/auth');
const TOKEN_COOKIE = 'token';
const MAX_FILES = process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : 10; // total files cap
const FILE_SIZE_LIMIT_MB = process.env.FILE_SIZE_LIMIT_MB ? parseInt(process.env.FILE_SIZE_LIMIT_MB, 10) : 5;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_DAYS = process.env.JWT_EXPIRES_DAYS ? parseInt(process.env.JWT_EXPIRES_DAYS, 10) : 7;
const TEMP_LOGIN_TTL_MINUTES = process.env.TEMP_LOGIN_TTL_MINUTES ? Math.max(1, parseInt(process.env.TEMP_LOGIN_TTL_MINUTES, 10)) : 10;
const HEADER_AUTO_HIDE = /^(1|true|yes)$/i.test(process.env.HEADER_AUTO_HIDE || '');
// Cleanup configuration
const AUTO_CLEANUP_ENABLED = !/^false|0|no$/i.test(process.env.AUTO_CLEANUP_ENABLED || 'true');
const CLEANUP_INTERVAL_MINUTES = process.env.CLEANUP_INTERVAL_MINUTES ? Math.max(1, parseInt(process.env.CLEANUP_INTERVAL_MINUTES, 10)) : 15;
const MESSAGE_TTL_DAYS = process.env.MESSAGE_TTL_DAYS ? Math.max(0, parseInt(process.env.MESSAGE_TTL_DAYS, 10)) : 0; // 0 = disabled
const DEVICE_INACTIVE_DAYS = process.env.DEVICE_INACTIVE_DAYS ? Math.max(0, parseInt(process.env.DEVICE_INACTIVE_DAYS, 10)) : 0; // 0 = disabled
// PWA static asset version for SW cache-busting via query param
let PKG_VERSION = '0.0.0';
try { PKG_VERSION = require('./package.json').version || '0.0.0'; } catch (_) {}
const ASSET_VERSION = process.env.ASSET_VERSION || PKG_VERSION || String(Math.floor(Date.now() / 1000));

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Initialize DB (creates sqlite.db and tables if not exist) then start server
async function boot() {
  try {
    await db.init();

    // Helpful error handler for common listen failures (port in use, permission)
    server.on('error', (err) => {
      const code = (err && err.code) || '';
      const tips = [];
      if (code === 'EADDRINUSE') {
        tips.push(`端口 ${PORT} 已被占用，请尝试：`);
        tips.push(`- 修改环境变量 PORT（例如：PORT=8080 yarn start）`);
        tips.push(`- 查找占用进程：Linux: sudo ss -tulnp | grep :${PORT} · macOS: lsof -i :${PORT} · Windows: netstat -ano | findstr :${PORT}`);
      } else if (code === 'EACCES') {
        tips.push(`端口 ${PORT} 需要更高权限，请尝试使用 1024 以上的端口，或以具备权限的用户运行。`);
      } else {
        tips.push('无法启动服务，请检查端口/权限/环境变量设置。');
      }
      // Always print to console
      console.error('[MyDrop] 启动失败:', code || (err && err.message) || String(err));
      for (const t of tips) console.error('[MyDrop]', t);
      // Also log to file/structured logger
      try { logger.error('server.listen.error', { code, host: HOST, port: PORT, tips }); } catch (_) {}
      process.exit(1);
    });

    server.listen(PORT, HOST, () => {
      logger.info('server.listen', { host: HOST, port: PORT });
      printStartupBanner();
    });

    if (AUTO_CLEANUP_ENABLED) scheduleCleanup();
    // demo分支：启动定时清理
    scheduleDemoCleanup();
  } catch (e) {
    logger.error('db.init.failed', { err: e });
    // Always print to console for visibility
    try { console.error('[MyDrop] 数据库初始化失败:', e && e.message ? e.message : String(e)); } catch (_) {}
    process.exit(1);
  }
}

// Middleware
app.use(cookieParser());
try { app.use(require('compression')()); } catch (_) {}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger(logger));
// Security headers (CSP, Referrer-Policy, X-Content-Type-Options)
app.use((req, res, next) => {
  try {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' ws: wss:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; ');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  } catch (_) {}
  next();
});
// Ensure local vendor assets only if missing
try {
  const vendorDir = path.join(__dirname, 'frontend', 'templates', 'static', 'vendor');
  const vendorOk = fs.existsSync(path.join(vendorDir, 'marked.min.js'))
    && fs.existsSync(path.join(vendorDir, 'dompurify.min.js'))
    && fs.existsSync(path.join(vendorDir, 'sweetalert2.all.min.js'))
    && fs.existsSync(path.join(vendorDir, 'sweetalert2.min.css'))
    && fs.existsSync(path.join(vendorDir, 'jsqr.js'));
  if (!vendorOk) { require('./scripts/copy-vendor'); }
} catch (_) {}
// Serve built static assets (Tailwind CSS, vendor libs) under frontend/templates/static
const TEMPLATES_DIR = path.join(__dirname, 'frontend/templates');
app.use('/static', express.static(path.join(TEMPLATES_DIR, 'static'), { maxAge: '30d', immutable: true }));
// Serve frontend JS files
app.use('/js', express.static(path.join(__dirname, 'frontend/js')));
// Serve template components
app.use('/templates', express.static(TEMPLATES_DIR));

// PWA Service Worker (dynamic, embeds version to control cache keys via ?v=)
app.get('/sw.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-cache');
  const sw = `// Generated Service Worker\n\nconst ASSET_VERSION = ${JSON.stringify(ASSET_VERSION)};\nconst CACHE_NAME = 'mydrop-static-v' + ASSET_VERSION;\nlet BUST_TS = null;\nconst PRECACHE_URLS = [\n  '/',\n  '/admin',\n  '/static/tailwind.css',\n  '/static/favicon.svg',\n  '/static/vendor/marked.min.js',\n  '/static/vendor/dompurify.min.js',\n  '/static/vendor/sweetalert2.all.min.js',\n  '/static/vendor/sweetalert2.min.css',\n  '/static/vendor/jsqr.js',\n  '/index.css',\n  '/js/utils.js',\n  '/js/ui.js',\n  '/js/theme.js',\n  '/js/api.js',\n  '/js/templates.js',\n  '/js/render.js',\n  '/js/auth.js',\n  '/js/websocket.js',\n  '/js/editor.js',\n  '/js/chat.js',\n  '/js/app.js',\n  '/admin.js'\n];\n\nfunction withV(url) { try { const u = new URL(url, self.location.origin); u.searchParams.set('v', ASSET_VERSION); if (BUST_TS) u.searchParams.set('r', BUST_TS); return u.toString(); } catch (e) { return url; } }\n\nself.addEventListener('install', (event) => {\n  event.waitUntil((async () => {\n    const cache = await caches.open(CACHE_NAME);\n    try {\n      // 静态资源使用带版本查询参数缓存；HTML 直接按路径缓存\n      const staticUrls = PRECACHE_URLS.filter(u => u.startsWith('/static/') || u.startsWith('/js/') || u === '/index.css' || u === '/admin.js');\n      const htmlUrls = PRECACHE_URLS.filter(u => u === '/' || u === '/admin');\n      await cache.addAll(staticUrls.map(withV).concat(htmlUrls));\n    } catch (_) {}\n    self.skipWaiting();\n  })());\n});\n\nself.addEventListener('activate', (event) => {\n  event.waitUntil((async () => {\n    const keys = await caches.keys();\n    await Promise.all(keys.filter(k => k.startsWith('mydrop-static-v') && k !== CACHE_NAME).map(k => caches.delete(k)));\n    self.clients.claim();\n  })());\n});\n\nself.addEventListener('message', (event) => {\n  try {\n    const data = event && event.data ? event.data : {};\n    if (data && data.type === 'SKIP_WAITING') { self.skipWaiting(); }\n    if (data && data.type === 'BUST_FETCH') { BUST_TS = String(Date.now()); }\n  } catch (_) {}\n});\n\nself.addEventListener('fetch', (event) => {\n  const req = event.request;\n  if (req.method !== 'GET') return;\n  const url = new URL(req.url);\n  if (url.origin !== self.location.origin) return;\n  const p = url.pathname;\n  const isDoc = req.mode === 'navigate' || p === '/' || p === '/admin';\n  const isStatic = p.startsWith('/static/') || p.startsWith('/js/') || p === '/index.css' || p === '/admin.js' || p.startsWith('/templates/components/');\n  if (!(isDoc || isStatic)) return;\n  event.respondWith((async () => {\n    const cacheKey = isStatic ? withV(url.toString()) : url.toString();\n    const cache = await caches.open(CACHE_NAME);\n    const cached = await cache.match(cacheKey, { ignoreSearch: !isStatic ? true : false });\n    if (cached) return cached;\n    try {\n      const res = await fetch(cacheKey, { credentials: 'same-origin' });\n      if (res && res.status === 200) { try { await cache.put(cacheKey, res.clone()); } catch (_) {} }\n      return res;\n    } catch (err) {\n      const any = await cache.match(url.toString(), { ignoreSearch: true });\n      if (any) return any;\n      throw err;\n    }\n  })());\n});\n`;
  res.send(sw);
});

// Serve minimal static assets only (moved under templates)
app.get('/', (req, res) => {
  res.sendFile(path.join(TEMPLATES_DIR, 'index.html'));
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
  tempLoginMinutes: TEMP_LOGIN_TTL_MINUTES,
  kickDevice: kickDeviceById,
  kickUserSessions,
  features: { autoHideHeader: HEADER_AUTO_HIDE, assetVersion: ASSET_VERSION },
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

// Periodic cleanup of old data and inactive devices
function scheduleCleanup() {
  const runOnce = async () => {
    try {
      let removedFiles = 0;
      let removedMessages = 0;
      let removedDevices = 0;
      if (MESSAGE_TTL_DAYS > 0) {
        const cutoff = Date.now() - MESSAGE_TTL_DAYS * 24 * 60 * 60 * 1000;
        try {
          const files = await db.listFilesForOldMessages(cutoff);
          for (const f of files) {
            const p = path.join(UPLOAD_DIR, f.stored_name);
            try { await fs.promises.unlink(p); removedFiles++; } catch (_) {}
          }
        } catch (_) {}
        try { removedMessages = await db.deleteMessagesOlderThan(cutoff); } catch (_) { removedMessages = 0; }
        logger.info('cleanup.messages', { cutoff, removed_files: removedFiles, removed_messages: removedMessages });
        try {
          if (removedFiles > 0) await db.incrementStat('cleaned_files_total', removedFiles);
          if (removedMessages > 0) await db.incrementStat('cleaned_messages_total', removedMessages);
        } catch (_) {}
      }
      if (DEVICE_INACTIVE_DAYS > 0) {
        const beforeTs = Date.now() - DEVICE_INACTIVE_DAYS * 24 * 60 * 60 * 1000;
        try { removedDevices = await db.deleteInactiveDevices(beforeTs); } catch (_) { removedDevices = 0; }
        logger.info('cleanup.devices', { before: beforeTs, removed_devices: removedDevices });
        try { if (removedDevices > 0) await db.incrementStat('cleaned_devices_total', removedDevices); } catch (_) {}
      }
    } catch (e) {
      logger.error('cleanup.error', { err: e });
    }
  };
  // run once on boot (delayed slightly) and then at interval
  setTimeout(runOnce, 10 * 1000).unref?.();
  setInterval(runOnce, CLEANUP_INTERVAL_MINUTES * 60 * 1000).unref?.();
}

// demo分支：五分钟定时清空数据库功能
function scheduleDemoCleanup() {
  const runDemoCleanup = async () => {
    try {
      logger.info('demo.cleanup.start', { message: 'Demo server clearing database' });

      // 清空所有文件
      try {
        const files = await db.listAllFiles();
        for (const f of files) {
          const p = path.join(UPLOAD_DIR, f.stored_name);
          try { await fs.promises.unlink(p); } catch (_) {}
        }
        logger.info('demo.cleanup.files', { count: files.length });
      } catch (_) {}

      // 清空所有消息
      try {
        await db.clearAllMessages();
        logger.info('demo.cleanup.messages', { message: 'All messages cleared' });
      } catch (_) {}

      // 重置管理员用户（但保持已登录状态）
      try {
        const { hashPassword } = require('./backend/services/auth');
        await db.updateUserAuth(1, {
          username: 'admin',
          passwordHash: hashPassword('admin'),
          isDefaultPassword: true
        });
        logger.info('demo.cleanup.user', { message: 'Admin user reset' });
      } catch (_) {}

      logger.info('demo.cleanup.complete', { message: 'Demo cleanup completed' });
    } catch (e) {
      logger.error('demo.cleanup.error', { err: e });
    }
  };

  // 5分钟定时清理
  setInterval(runDemoCleanup, 5 * 60 * 1000).unref?.();
}
// 打印启动横幅与常用提示（始终输出到控制台，同时写入日志）
function printStartupBanner() {
  try {
    const localUrl = `http://localhost:${PORT}`;
    const hostUrl = HOST && HOST !== '0.0.0.0' && HOST !== '::' ? `http://${HOST}:${PORT}` : null;
    const adminUrl = `${localUrl}/admin`;
    const wsUrl = `ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/ws`;
    const lines = [
      'MyDrop 已启动 ✓',
      `- 监听地址：${HOST}:${PORT}`,
      `- 本地访问：${localUrl}`,
      hostUrl ? `- 指定主机：${hostUrl}` : null,
      `- 设置页面：${adminUrl}`,
      `- WebSocket：${wsUrl}`,
      `- 重置管理员：yarn reset:admin（将重置为 admin/admin，并使现有登录失效）`,
      LOG_FILE ? `- 日志文件：${path.isAbsolute(LOG_FILE) ? LOG_FILE : path.join(process.cwd(), LOG_FILE)}` : '- 日志：标准输出（可设置 LOG_FILE 写入到文件）',
      `- Node 版本：${process.version} · 平台：${process.platform}/${process.arch} · 主机名：${os.hostname()}`,
    ].filter(Boolean);

    // Console banner
    const banner = '\n' + lines.map((s) => `[MyDrop] ${s}`).join('\n') + '\n';
    try { console.log(banner); } catch (_) {}

    // Structured log
    try { logger.info('startup.banner', { host: HOST, port: PORT, urls: { local: localUrl, host: hostUrl, admin: adminUrl, ws: wsUrl }, log_file: LOG_FILE || null }); } catch (_) {}
  } catch (_) {}
}
