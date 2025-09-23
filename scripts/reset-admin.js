#!/usr/bin/env node
'use strict';

const path = require('path');
const sqlite3 = require('sqlite3');
const { hashPassword } = require('../auth');

require('dotenv').config();

const DB_PATH = path.join(__dirname, '..', 'sqlite.db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function main() {
  const db = new sqlite3.Database(DB_PATH);
  try {
    const now = Date.now();
    const row = await get(db, 'SELECT id FROM users ORDER BY id ASC LIMIT 1');
    const pw = hashPassword('admin');
    if (row && row.id) {
      await run(db, 'UPDATE users SET username = ?, password_hash = ?, is_default_password = 1, updated_at = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', ['admin', pw, now, row.id]);
      console.log('User reset successful: username=admin, password=admin');
    } else {
      await run(db, 'INSERT INTO users (username, password_hash, is_default_password, created_at, updated_at, token_version) VALUES (?, ?, 1, ?, ?, 0)', ['admin', pw, now, now]);
      console.log('User created: username=admin, password=admin');
    }
    console.log('All existing tokens have been invalidated.');
  } catch (err) {
    console.error('Failed to reset admin:', err.message || err);
    process.exitCode = 1;
  } finally {
    try { db.close(); } catch (_) {}
  }
}

main();

