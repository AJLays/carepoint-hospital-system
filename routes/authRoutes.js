'use strict';
const express = require('express');
const crypto = require('crypto');

module.exports = (db) => {
  const router = express.Router();
  const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password)
        return res.status(400).json({ error: 'Username and password are required.' });

      const [rows] = await db.execute(
        'SELECT user_id, username, password_hash, full_name, role, status FROM staff_users WHERE username=? LIMIT 1',
        [username.trim()]
      );
      const user = rows[0];
      if (!user || user.status !== 'active' || !user.password_hash.startsWith('scrypt$'))
        return res.status(401).json({ error: 'Invalid username or password.' });

      const parts = user.password_hash.split('$');
      if (parts.length !== 4) return res.status(401).json({ error: 'Invalid username or password.' });
      const salt = Buffer.from(parts[2], 'hex');
      const expected = Buffer.from(parts[3], 'hex');
      const actual = await new Promise((resolve, reject) => crypto.scrypt(password, salt, expected.length, (e, key) => e ? reject(e) : resolve(key)));
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
        return res.status(401).json({ error: 'Invalid username or password.' });

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
      await db.execute('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?,?,?)',
        [user.user_id, hashToken(token), expiresAt]);
      res.json({ token, expires_at: expiresAt.toISOString(), user: {
        user_id: user.user_id, username: user.username, full_name: user.full_name, role: user.role
      }});
    } catch (err) {
      console.error('POST /api/auth/login:', err.message);
      res.status(500).json({ error: 'Login failed. Check server logs.' });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      if (token) await db.execute('DELETE FROM user_sessions WHERE token_hash=?', [hashToken(token)]);
      res.json({ ok: true, message: 'Logged out.' });
    } catch (err) {
      console.error('POST /api/auth/logout:', err.message);
      res.status(500).json({ error: 'Logout failed.' });
    }
  });

  router.get('/me', async (req, res) => {
    try {
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      if (!token) return res.status(401).json({ error: 'Not logged in.' });
      const [rows] = await db.execute(`SELECT u.user_id,u.username,u.full_name,u.role,s.expires_at
        FROM user_sessions s JOIN staff_users u ON u.user_id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>NOW() AND u.status='active' LIMIT 1`, [hashToken(token)]);
      if (!rows.length) return res.status(401).json({ error: 'Session expired or invalid.' });
      res.json({ user: rows[0] });
    } catch (err) {
      console.error('GET /api/auth/me:', err.message);
      res.status(500).json({ error: 'Unable to check session.' });
    }
  });

  return router;
};
