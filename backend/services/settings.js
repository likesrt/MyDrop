// Centralized runtime settings backed by DB app_meta
// Keys managed here are migrated from environment variables and editable via admin UI.
// All values are stored as strings in app_meta and exposed as typed getters.

let _db = null;
let _cache = null;
const _listeners = new Set();

// Defaults reflect current desired behavior supplied by user (treated as built-in defaults)
const DEFAULTS = Object.freeze({
  autoCleanupEnabled: false,            // AUTO_CLEANUP_ENABLED
  cleanupIntervalMinutes: 720,          // CLEANUP_INTERVAL_MINUTES
  messageTtlDays: 90,                   // MESSAGE_TTL_DAYS
  jwtExpiresDays: 7,                    // JWT_EXPIRES_DAYS
  tempLoginTtlMinutes: 10,              // TEMP_LOGIN_TTL_MINUTES
  headerAutoHide: false,                // HEADER_AUTO_HIDE
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
      ['cleanupIntervalMinutes', 'CLEANUP_INTERVAL_MINUTES'],
      ['messageTtlDays', 'MESSAGE_TTL_DAYS'],
      ['jwtExpiresDays', 'JWT_EXPIRES_DAYS'],
      ['tempLoginTtlMinutes', 'TEMP_LOGIN_TTL_MINUTES'],
      ['headerAutoHide', 'HEADER_AUTO_HIDE'],
    ];
    for (const [internalKey, metaKey] of keys) {
      const raw = await _db.getMeta('settings.' + metaKey, null);
      if (raw === null || raw === undefined) continue;
      map.set(internalKey, String(raw));
    }
    if (map.has('autoCleanupEnabled')) vals.autoCleanupEnabled = !/^false|0|no$/i.test(map.get('autoCleanupEnabled'));
    if (map.has('cleanupIntervalMinutes')) vals.cleanupIntervalMinutes = Math.max(1, parseInt(map.get('cleanupIntervalMinutes'), 10) || DEFAULTS.cleanupIntervalMinutes);
    if (map.has('messageTtlDays')) vals.messageTtlDays = Math.max(0, parseInt(map.get('messageTtlDays'), 10) || 0);
    if (map.has('jwtExpiresDays')) vals.jwtExpiresDays = Math.max(0, parseInt(map.get('jwtExpiresDays'), 10) || DEFAULTS.jwtExpiresDays);
    if (map.has('tempLoginTtlMinutes')) vals.tempLoginTtlMinutes = Math.max(1, parseInt(map.get('tempLoginTtlMinutes'), 10) || DEFAULTS.tempLoginTtlMinutes);
    if (map.has('headerAutoHide')) vals.headerAutoHide = /^(1|true|yes)$/i.test(map.get('headerAutoHide'));
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
    cleanupIntervalMinutes: 'cleanupIntervalMinutes' in partial ? num(partial.cleanupIntervalMinutes, curr.cleanupIntervalMinutes, { min: 1 }) : curr.cleanupIntervalMinutes,
    messageTtlDays: 'messageTtlDays' in partial ? num(partial.messageTtlDays, curr.messageTtlDays, { min: 0 }) : curr.messageTtlDays,
    jwtExpiresDays: 'jwtExpiresDays' in partial ? num(partial.jwtExpiresDays, curr.jwtExpiresDays, { min: 0 }) : curr.jwtExpiresDays,
    tempLoginTtlMinutes: 'tempLoginTtlMinutes' in partial ? num(partial.tempLoginTtlMinutes, curr.tempLoginTtlMinutes, { min: 1 }) : curr.tempLoginTtlMinutes,
    headerAutoHide: 'headerAutoHide' in partial ? bool(partial.headerAutoHide) : curr.headerAutoHide,
  };
}

async function update(partial) {
  if (!_db) throw new Error('settings.init not called');
  const next = normalize(partial || {});
  // Persist to app_meta
  await _db.setMeta('settings.AUTO_CLEANUP_ENABLED', next.autoCleanupEnabled ? 'true' : 'false');
  await _db.setMeta('settings.CLEANUP_INTERVAL_MINUTES', String(next.cleanupIntervalMinutes));
  await _db.setMeta('settings.MESSAGE_TTL_DAYS', String(next.messageTtlDays));
  await _db.setMeta('settings.JWT_EXPIRES_DAYS', String(next.jwtExpiresDays));
  await _db.setMeta('settings.TEMP_LOGIN_TTL_MINUTES', String(next.tempLoginTtlMinutes));
  await _db.setMeta('settings.HEADER_AUTO_HIDE', next.headerAutoHide ? '1' : '0');
  _cache = next;
  // Notify listeners
  for (const fn of _listeners) {
    try { fn(Object.assign({}, _cache)); } catch (_) {}
  }
  return Object.assign({}, _cache);
}

function onChange(fn) { if (typeof fn === 'function') _listeners.add(fn); return () => _listeners.delete(fn); }

module.exports = { init, load, getAll, getAllSync, update, onChange, DEFAULTS };

