const path = require('path');
const sqlite3 = require('sqlite3');

const DB_PATH = path.join(__dirname, 'sqlite.db');
let db;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function init() {
  db = new sqlite3.Database(DB_PATH);
  await run('PRAGMA journal_mode = WAL');
  await run('PRAGMA foreign_keys = ON');

  await run(`CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    alias TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    FOREIGN KEY(device_id) REFERENCES devices(device_id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_device_id TEXT,
    text TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(sender_device_id) REFERENCES devices(device_id) ON DELETE SET NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
  )`);

  await run('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_files_message_id ON files(message_id)');

  // Single user table
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_default_password INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  // schema migrations
  await ensureUserTokenVersionColumn();
  await ensureUser2FAColumns();
  await ensureWebAuthnTables();
  await fixMessagesSenderDeviceIdConstraint();
  await ensureDefaultUser();
}

async function fixMessagesSenderDeviceIdConstraint() {
  try {
    // Check if we need to recreate the messages table to fix the constraint conflict
    const tableInfo = await all('PRAGMA table_info(messages)');
    const senderDeviceIdColumn = tableInfo.find(col => col.name === 'sender_device_id');

    if (senderDeviceIdColumn && senderDeviceIdColumn.notnull === 1) {
      // We need to recreate the table to allow NULL in sender_device_id

      // First, create a backup table with the corrected schema
      await run(`CREATE TABLE IF NOT EXISTS messages_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_device_id TEXT,
        text TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(sender_device_id) REFERENCES devices(device_id) ON DELETE SET NULL
      )`);

      // Copy existing data
      await run(`INSERT INTO messages_new (id, sender_device_id, text, created_at)
                 SELECT id, sender_device_id, text, created_at FROM messages`);

      // Drop the old table and rename the new one
      await run('DROP TABLE messages');
      await run('ALTER TABLE messages_new RENAME TO messages');

      // Recreate the index
      await run('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)');
    }
  } catch (e) {
    // If migration fails, we'll log it but continue
    console.error('Migration fixMessagesSenderDeviceIdConstraint failed:', e);
  }
}

async function ensureDefaultUser() {
  const existing = await get('SELECT id FROM users LIMIT 1');
  if (!existing) {
    const { hashPassword } = require('./auth');
    const now = Date.now();
    const pw = hashPassword('admin');
    await run('INSERT INTO users (username, password_hash, is_default_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
      'admin', pw, 1, now, now,
    ]);
  }
}

async function ensureUserTokenVersionColumn() {
  try {
    const cols = await all('PRAGMA table_info(users)');
    const has = Array.isArray(cols) && cols.some(c => c.name === 'token_version');
    if (!has) {
      await run('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
    }
  } catch (e) {
    throw e;
  }
}

async function ensureUser2FAColumns() {
  const cols = await all('PRAGMA table_info(users)');
  const hasTotpSecret = cols.some(c => c.name === 'totp_secret');
  const hasTotpEnabled = cols.some(c => c.name === 'totp_enabled');
  if (!hasTotpSecret) {
    await run('ALTER TABLE users ADD COLUMN totp_secret TEXT');
  }
  if (!hasTotpEnabled) {
    await run('ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0');
  }
}

async function ensureWebAuthnTables() {
  await run(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    public_key_pem TEXT NOT NULL,
    sign_count INTEGER NOT NULL,
    transports TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id)');
}

async function upsertDevice(deviceId, alias, userAgent) {
  const now = Date.now();
  const existing = await get('SELECT device_id FROM devices WHERE device_id = ?', [deviceId]);
  if (existing) {
    await run('UPDATE devices SET alias = COALESCE(?, alias), user_agent = ?, last_seen_at = ? WHERE device_id = ?', [alias, userAgent, now, deviceId]);
  } else {
    await run('INSERT INTO devices (device_id, alias, user_agent, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', [deviceId, alias, userAgent, now, now]);
  }
}

async function getDevice(deviceId) {
  return get('SELECT * FROM devices WHERE device_id = ?', [deviceId]);
}

async function listDevices() {
  return all('SELECT * FROM devices ORDER BY last_seen_at DESC');
}

async function deleteDevice(deviceId) {
  await run('DELETE FROM devices WHERE device_id = ?', [deviceId]);
}

async function createSession(id, deviceId) {
  const now = Date.now();
  await run('INSERT INTO sessions (id, device_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)', [id, deviceId, now, now]);
}

async function getSession(id) {
  const row = await get('SELECT * FROM sessions WHERE id = ?', [id]);
  if (row) await run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [Date.now(), id]);
  return row;
}

async function deleteSession(id) {
  await run('DELETE FROM sessions WHERE id = ?', [id]);
}

async function createMessage({ senderDeviceId, text }) {
  const now = Date.now();
  const res = await run('INSERT INTO messages (sender_device_id, text, created_at) VALUES (?, ?, ?)', [senderDeviceId, text, now]);
  const id = res.lastID;
  return { id, sender_device_id: senderDeviceId, text, created_at: now };
}

async function getMessage(id) {
  const msg = await get('SELECT * FROM messages WHERE id = ?', [id]);
  if (!msg) return null;
  const files = await all('SELECT * FROM files WHERE message_id = ? ORDER BY id ASC', [id]);
  const sender = await get('SELECT * FROM devices WHERE device_id = ?', [msg.sender_device_id]);
  return { ...msg, files, sender };
}

async function listMessages(sinceId = null, limit = 100) {
  let rows;
  if (sinceId) {
    rows = await all('SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?', [sinceId, limit]);
  } else {
    rows = await all('SELECT * FROM messages ORDER BY id DESC LIMIT ?', [limit]);
    rows = rows.reverse();
  }
  const result = [];
  for (const r of rows) {
    const files = await all('SELECT * FROM files WHERE message_id = ? ORDER BY id ASC', [r.id]);
    const sender = await get('SELECT * FROM devices WHERE device_id = ?', [r.sender_device_id]);
    result.push({ ...r, files, sender });
  }
  return result;
}

async function listMessagesByDevice(deviceId) {
  return all('SELECT * FROM messages WHERE sender_device_id = ? ORDER BY id ASC', [deviceId]);
}

async function listFilesByDevice(deviceId) {
  return all(
    'SELECT f.* FROM files f JOIN messages m ON f.message_id = m.id WHERE m.sender_device_id = ? ORDER BY f.id ASC',
    [deviceId]
  );
}

async function deleteMessage(id) {
  await run('DELETE FROM messages WHERE id = ?', [id]);
}

async function addFile({ messageId, storedName, originalName, mimeType, size }) {
  const now = Date.now();
  await run(
    'INSERT INTO files (message_id, stored_name, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [messageId, storedName, originalName, mimeType, size, now]
  );
}

async function getFile(id) {
  return get('SELECT * FROM files WHERE id = ?', [id]);
}

async function deleteFile(id) {
  await run('DELETE FROM files WHERE id = ?', [id]);
}

async function countFiles() {
  const row = await get('SELECT COUNT(1) as c FROM files');
  return row ? row.c : 0;
}

// Cleanup helpers
async function listFilesForOldMessages(cutoffTs) {
  return all('SELECT f.* FROM files f JOIN messages m ON f.message_id = m.id WHERE m.created_at < ? ORDER BY f.id ASC', [cutoffTs]);
}

async function deleteMessagesOlderThan(cutoffTs) {
  await run('DELETE FROM messages WHERE created_at < ?', [cutoffTs]);
}

async function deleteInactiveDevices(beforeTs) {
  await run('DELETE FROM devices WHERE last_seen_at < ?', [beforeTs]);
}

// Admin utilities
async function listAllFiles() {
  return all('SELECT * FROM files ORDER BY id ASC');
}

async function clearAllMessages() {
  // Due to ON DELETE CASCADE on files(message_id), deleting messages clears file rows.
  await run('DELETE FROM messages');
}

// Users
async function getUserByUsername(username) {
  return get('SELECT * FROM users WHERE username = ?', [username]);
}

async function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

async function updateUserAuth(id, { username = null, passwordHash = null, isDefaultPassword = null }) {
  const now = Date.now();
  const curr = await getUserById(id);
  if (!curr) throw new Error('User not found');
  const newUsername = username ?? curr.username;
  const newPw = passwordHash ?? curr.password_hash;
  const newFlag = (isDefaultPassword === null || isDefaultPassword === undefined) ? curr.is_default_password : (isDefaultPassword ? 1 : 0);
  // If password changed, also bump token_version to invalidate old tokens
  if (passwordHash && passwordHash !== curr.password_hash) {
    await run('UPDATE users SET username = ?, password_hash = ?, is_default_password = ?, updated_at = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [newUsername, newPw, newFlag, now, id]);
  } else {
    await run('UPDATE users SET username = ?, password_hash = ?, is_default_password = ?, updated_at = ? WHERE id = ?', [newUsername, newPw, newFlag, now, id]);
  }
  return getUserById(id);
}

async function setUserTOTPEnabled(id, secretBase32, enabled) {
  const now = Date.now();
  await run('UPDATE users SET totp_secret = ?, totp_enabled = ?, updated_at = ? WHERE id = ?', [
    enabled ? (secretBase32 || null) : null,
    enabled ? 1 : 0,
    now,
    id,
  ]);
  return getUserById(id);
}

async function getWebAuthnCredentialsByUser(userId) {
  return all('SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at ASC', [userId]);
}

async function getWebAuthnCredential(credId) {
  return get('SELECT * FROM webauthn_credentials WHERE id = ?', [credId]);
}

async function addWebAuthnCredential({ userId, credId, publicKeyPem, signCount = 0, transports = null }) {
  const now = Date.now();
  await run('INSERT OR REPLACE INTO webauthn_credentials (id, user_id, public_key_pem, sign_count, transports, created_at, updated_at) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM webauthn_credentials WHERE id = ?), ?), ?)', [
    credId, userId, publicKeyPem, signCount|0, transports, credId, now, now,
  ]);
  return getWebAuthnCredential(credId);
}

async function updateWebAuthnCounter(credId, signCount) {
  const now = Date.now();
  await run('UPDATE webauthn_credentials SET sign_count = ?, updated_at = ? WHERE id = ?', [signCount|0, now, credId]);
}

async function deleteWebAuthnCredential(credId) {
  await run('DELETE FROM webauthn_credentials WHERE id = ?', [credId]);
}

async function countWebAuthnCredentials(userId) {
  const row = await get('SELECT COUNT(1) as c FROM webauthn_credentials WHERE user_id = ?', [userId]);
  return row ? row.c : 0;
}

module.exports = {
  init,
  ensureDefaultUser,
  // devices
  upsertDevice,
  getDevice,
  listDevices,
  deleteDevice,
  createSession,
  getSession,
  deleteSession,
  createMessage,
  getMessage,
  listMessages,
  listMessagesByDevice,
  deleteMessage,
  deleteMessagesOlderThan,
  addFile,
  getFile,
  listFilesByDevice,
  listFilesForOldMessages,
  deleteFile,
  countFiles,
  listAllFiles,
  clearAllMessages,
  getUserByUsername,
  getUserById,
  updateUserAuth,
  setUserTOTPEnabled,
  getWebAuthnCredentialsByUser,
  getWebAuthnCredential,
  addWebAuthnCredential,
  updateWebAuthnCounter,
  deleteWebAuthnCredential,
  countWebAuthnCredentials,
  // users
};
