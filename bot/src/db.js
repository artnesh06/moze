const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'moze-bot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS verify_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS verified_holders (
    discord_id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    nft_count INTEGER DEFAULT 0,
    role TEXT,
    verified_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS captcha_pending (
    discord_id TEXT PRIMARY KEY,
    answer TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS roles_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name TEXT NOT NULL,
    min_hold INTEGER NOT NULL,
    max_hold INTEGER NOT NULL
  );
`);

// Default settings
const defaults = [
  ['moze_ca', '0x0e579bcec21ae9dc5400db46cab67d5a8d0a58cc'],
  ['rh_rpc', 'https://rpc.mainnet.chain.robinhood.com'],
  ['sales_webhook', ''],
  ['sales_channel_id', ''],
  ['verify_channel_id', ''],
  ['member_role', 'Werido'],
];

const insertDefault = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
for (const [k, v] of defaults) insertDefault.run(k, v);

// Default roles if empty
const roleCount = db.prepare('SELECT COUNT(*) as c FROM roles_config').get();
if (roleCount.c === 0) {
  const insertRole = db.prepare(
    'INSERT INTO roles_config (role_name, min_hold, max_hold) VALUES (?, ?, ?)'
  );
  insertRole.run('Moze +1', 1, 4);
  insertRole.run('Fat Moze +5', 5, 9);
  insertRole.run('Mozeus +10', 10, 999);
}

module.exports = {
  db,

  getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  },

  getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },

  getRoles() {
    return db.prepare('SELECT * FROM roles_config ORDER BY min_hold ASC').all();
  },

  setRoles(roles) {
    db.prepare('DELETE FROM roles_config').run();
    const ins = db.prepare('INSERT INTO roles_config (role_name, min_hold, max_hold) VALUES (?, ?, ?)');
    for (const r of roles) ins.run(r.role_name, r.min_hold, r.max_hold);
  },

  saveCode(discordId, code) {
    db.prepare('DELETE FROM verify_codes WHERE discord_id = ?').run(discordId);
    db.prepare('INSERT INTO verify_codes (discord_id, code, created_at) VALUES (?, ?, ?)').run(
      discordId, code, Date.now()
    );
  },

  getCode(discordId) {
    return db.prepare(
      'SELECT * FROM verify_codes WHERE discord_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1'
    ).get(discordId);
  },

  findCodeByValue(code) {
    return db.prepare(
      'SELECT * FROM verify_codes WHERE code = ? AND used = 0'
    ).get(code);
  },

  markCodeUsed(code) {
    db.prepare('UPDATE verify_codes SET used = 1 WHERE code = ?').run(code);
  },

  saveHolder(discordId, wallet, nftCount, role) {
    db.prepare(`
      INSERT OR REPLACE INTO verified_holders (discord_id, wallet, nft_count, role, verified_at, updated_at)
      VALUES (?, ?, ?, ?, COALESCE((SELECT verified_at FROM verified_holders WHERE discord_id = ?), ?), ?)
    `).run(discordId, wallet, nftCount, role, discordId, Date.now(), Date.now());
  },

  getHolder(discordId) {
    return db.prepare('SELECT * FROM verified_holders WHERE discord_id = ?').get(discordId);
  },

  getAllHolders() {
    return db.prepare('SELECT * FROM verified_holders ORDER BY nft_count DESC').all();
  },

  saveCaptcha(discordId, answer) {
    db.prepare('INSERT OR REPLACE INTO captcha_pending (discord_id, answer, created_at) VALUES (?, ?, ?)').run(
      discordId, answer, Date.now()
    );
  },

  getCaptcha(discordId) {
    return db.prepare('SELECT * FROM captcha_pending WHERE discord_id = ?').get(discordId);
  },

  deleteCaptcha(discordId) {
    db.prepare('DELETE FROM captcha_pending WHERE discord_id = ?').run(discordId);
  },
};
