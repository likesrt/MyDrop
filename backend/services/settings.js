// Centralized runtime settings backed by DB app_meta
// Keys managed here are migrated from environment variables and editable via admin UI.
// All values are stored as strings in app_meta and exposed as typed getters.

let _db = null;
let _cache = null;
const _listeners = new Set();

// Defaults reflect current desired behavior supplied by user (treated as built-in defaults)
const DEFAULTS = Object.freeze({
  // 清理相关
  autoCleanupEnabled: false,            // AUTO_CLEANUP_ENABLED：是否启用周期性清理
  cleanupIntervalAuto: true,            // CLEANUP_INTERVAL_AUTO：是否自动选择清理间隔
  cleanupIntervalMinutes: 720,          // CLEANUP_INTERVAL_MINUTES：手动清理间隔（分钟）
  messageTtlDays: 90,                   // MESSAGE_TTL_DAYS：自动删除早于 N 天的消息与文件（0 关闭）
  deviceInactiveDays: 90,               // DEVICE_INACTIVE_DAYS：删除 N 天未活跃设备（0 关闭）
  // 登录与前端
  jwtExpiresDays: 7,                    // JWT_EXPIRES_DAYS：记住我有效期（天）
  tempLoginTtlMinutes: 10,              // TEMP_LOGIN_TTL_MINUTES：临时登录有效期（分钟）
  headerAutoHide: false,                // HEADER_AUTO_HIDE：移动端顶部栏自动隐藏
  // 上传与日志
  fileSizeLimitMB: 20,                  // FILE_SIZE_LIMIT_MB：单个文件上限（MB）
  maxFiles: 1000,                       // MAX_FILES：全局文件数量上限
  logLevel: 'warn',                     // LOG_LEVEL：日志级别
});

function init(db) { _db = db; }

async function load() {
  if (!_db) throw new Error('settings.init not called');
  const vals = Object.assign({}, DEFAULTS);
  try {
    // Read each key from app_meta, parse to typed value if present
    const map = new Map();
    const keys = [
      ['autoCleanupEnabled', 'AUTO_CLEANUP_ENABLED'],
      ['cleanupIntervalAuto', 'CLEANUP_INTERVAL_AUTO'],
      ['cleanupIntervalMinutes', 'CLEANUP_INTERVAL_MINUTES'],
      ['messageTtlDays', 'MESSAGE_TTL_DAYS'],
      ['deviceInactiveDays', 'DEVICE_INACTIVE_DAYS'],
      ['jwtExpiresDays', 'JWT_EXPIRES_DAYS'],
      ['tempLoginTtlMinutes', 'TEMP_LOGIN_TTL_MINUTES'],
      ['headerAutoHide', 'HEADER_AUTO_HIDE'],
      ['fileSizeLimitMB', 'FILE_SIZE_LIMIT_MB'],
      ['maxFiles', 'MAX_FILES'],
      ['logLevel', 'LOG_LEVEL'],
    ];
    for (const [internalKey, metaKey] of keys) {
      const raw = await _db.getMeta('settings.' + metaKey, null);
      if (raw === null || raw === undefined) continue;
      map.set(internalKey, String(raw));
    }
    if (map.has('autoCleanupEnabled')) vals.autoCleanupEnabled = !/^false|0|no$/i.test(map.get('autoCleanupEnabled'));
    if (map.has('cleanupIntervalAuto')) vals.cleanupIntervalAuto = !/^false|0|no$/i.test(map.get('cleanupIntervalAuto'));
    if (map.has('cleanupIntervalMinutes')) vals.cleanupIntervalMinutes = Math.max(1, parseInt(map.get('cleanupIntervalMinutes'), 10) || DEFAULTS.cleanupIntervalMinutes);
    if (map.has('messageTtlDays')) vals.messageTtlDays = Math.max(0, parseInt(map.get('messageTtlDays'), 10) || 0);
    if (map.has('deviceInactiveDays')) vals.deviceInactiveDays = Math.max(0, parseInt(map.get('deviceInactiveDays'), 10) || 0);
    if (map.has('jwtExpiresDays')) vals.jwtExpiresDays = Math.max(0, parseInt(map.get('jwtExpiresDays'), 10) || DEFAULTS.jwtExpiresDays);
    if (map.has('tempLoginTtlMinutes')) vals.tempLoginTtlMinutes = Math.max(1, parseInt(map.get('tempLoginTtlMinutes'), 10) || DEFAULTS.tempLoginTtlMinutes);
    if (map.has('headerAutoHide')) vals.headerAutoHide = /^(1|true|yes)$/i.test(map.get('headerAutoHide'));
    if (map.has('fileSizeLimitMB')) vals.fileSizeLimitMB = Math.max(1, parseInt(map.get('fileSizeLimitMB'), 10) || DEFAULTS.fileSizeLimitMB);
    if (map.has('maxFiles')) vals.maxFiles = Math.max(1, parseInt(map.get('maxFiles'), 10) || DEFAULTS.maxFiles);
    if (map.has('logLevel')) {
      const l = String(map.get('logLevel')).toLowerCase();
      vals.logLevel = ['error','warn','info','debug'].includes(l) ? l : DEFAULTS.logLevel;
    }
  } catch (_) {}
  _cache = vals;
  return Object.assign({}, _cache);
}

function getAllSync() { return _cache ? Object.assign({}, _cache) : Object.assign({}, DEFAULTS); }

async function getAll() { return _cache ? Object.assign({}, _cache) : load(); }

function bool(v) { return !!v; }

function num(v, def, { min = null } = {}) {
  let n = parseInt(v, 10);
  if (!Number.isFinite(n)) n = def;
  if (min !== null && n < min) n = min;
  return n;
}

function normalize(partial) {
  const curr = getAllSync();
  return {
    autoCleanupEnabled: 'autoCleanupEnabled' in partial ? bool(partial.autoCleanupEnabled) : curr.autoCleanupEnabled,
    cleanupIntervalAuto: 'cleanupIntervalAuto' in partial ? bool(partial.cleanupIntervalAuto) : curr.cleanupIntervalAuto,
    cleanupIntervalMinutes: 'cleanupIntervalMinutes' in partial ? num(partial.cleanupIntervalMinutes, curr.cleanupIntervalMinutes, { min: 1 }) : curr.cleanupIntervalMinutes,
    messageTtlDays: 'messageTtlDays' in partial ? num(partial.messageTtlDays, curr.messageTtlDays, { min: 0 }) : curr.messageTtlDays,
    deviceInactiveDays: 'deviceInactiveDays' in partial ? num(partial.deviceInactiveDays, curr.deviceInactiveDays, { min: 0 }) : curr.deviceInactiveDays,
    jwtExpiresDays: 'jwtExpiresDays' in partial ? num(partial.jwtExpiresDays, curr.jwtExpiresDays, { min: 0 }) : curr.jwtExpiresDays,
    tempLoginTtlMinutes: 'tempLoginTtlMinutes' in partial ? num(partial.tempLoginTtlMinutes, curr.tempLoginTtlMinutes, { min: 1 }) : curr.tempLoginTtlMinutes,
    headerAutoHide: 'headerAutoHide' in partial ? bool(partial.headerAutoHide) : curr.headerAutoHide,
    fileSizeLimitMB: 'fileSizeLimitMB' in partial ? num(partial.fileSizeLimitMB, curr.fileSizeLimitMB, { min: 1 }) : curr.fileSizeLimitMB,
    maxFiles: 'maxFiles' in partial ? num(partial.maxFiles, curr.maxFiles, { min: 1 }) : curr.maxFiles,
    logLevel: (function(){ const l = (partial.logLevel ?? curr.logLevel); const x = String(l).toLowerCase(); return ['error','warn','info','debug'].includes(x) ? x : curr.logLevel; })(),
  };
}

async function update(partial) {
  if (!_db) throw new Error('settings.init not called');
  const next = normalize(partial || {});
  // Persist to app_meta
  await _db.setMeta('settings.AUTO_CLEANUP_ENABLED', next.autoCleanupEnabled ? 'true' : 'false');
  await _db.setMeta('settings.CLEANUP_INTERVAL_AUTO', next.cleanupIntervalAuto ? 'true' : 'false');
  await _db.setMeta('settings.CLEANUP_INTERVAL_MINUTES', String(next.cleanupIntervalMinutes));
  await _db.setMeta('settings.MESSAGE_TTL_DAYS', String(next.messageTtlDays));
  await _db.setMeta('settings.DEVICE_INACTIVE_DAYS', String(next.deviceInactiveDays));
  await _db.setMeta('settings.JWT_EXPIRES_DAYS', String(next.jwtExpiresDays));
  await _db.setMeta('settings.TEMP_LOGIN_TTL_MINUTES', String(next.tempLoginTtlMinutes));
  await _db.setMeta('settings.HEADER_AUTO_HIDE', next.headerAutoHide ? '1' : '0');
  await _db.setMeta('settings.FILE_SIZE_LIMIT_MB', String(next.fileSizeLimitMB));
  await _db.setMeta('settings.MAX_FILES', String(next.maxFiles));
  await _db.setMeta('settings.LOG_LEVEL', String(next.logLevel));
  _cache = next;
  // Notify listeners
  for (const fn of _listeners) {
    try { fn(Object.assign({}, _cache)); } catch (_) {}
  }
  return Object.assign({}, _cache);
}

function onChange(fn) { if (typeof fn === 'function') _listeners.add(fn); return () => _listeners.delete(fn); }

module.exports = { init, load, getAll, getAllSync, update, onChange, DEFAULTS };
