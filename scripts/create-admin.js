'use strict';

const mysql = require('mysql2/promise');
const crypto = require('crypto');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, derived) => err ? reject(err) : resolve(derived))
  );
  return `scrypt$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let db;
  try {
    const username = (await rl.question('Admin username: ')).trim();
    const fullName = (await rl.question('Admin full name: ')).trim();
    const password = await rl.question('Admin password (minimum 10 characters): ');
    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) throw new Error('Username must be 3–60 characters and use letters, numbers, dots, underscores, or hyphens.');
    if (!fullName || fullName.length > 120) throw new Error('Enter a full name (maximum 120 characters).');
    if (password.length < 10) throw new Error('Password must contain at least 10 characters.');

    db = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'defaultdb'
    });
    const [existing] = await db.execute('SELECT user_id FROM staff_users WHERE username = ? LIMIT 1', [username]);
    if (existing.length) throw new Error('That username already exists.');
    const passwordHash = await hashPassword(password);
    await db.execute(
      "INSERT INTO staff_users (username, password_hash, full_name, role, status) VALUES (?, ?, ?, 'admin', 'active')",
      [username, passwordHash, fullName]
    );
    console.log(`Admin account '${username}' created successfully.`);
  } finally {
    rl.close();
    if (db) await db.end();
  }
}

main().catch((err) => {
  console.error(`Admin setup failed: ${err.message}`);
  process.exitCode = 1;
});
