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
    sender_device_id TEXT NOT NULL,
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

async function countFiles() {
  const row = await get('SELECT COUNT(1) as c FROM files');
  return row ? row.c : 0;
}

module.exports = {
  init,
  upsertDevice,
  getDevice,
  listDevices,
  createSession,
  getSession,
  deleteSession,
  createMessage,
  getMessage,
  listMessages,
  addFile,
  getFile,
  countFiles,
};

