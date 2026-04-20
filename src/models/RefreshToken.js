const { pool } = require('../config/db');

const RefreshToken = {
  // ─── Save a new refresh token ───────────────────────────────────────────────
  async create(userId, token, expiresAt) {
    await pool.query(`
      INSERT INTO refresh_tokens (user_id, token, expires_at)
      VALUES ($1, $2, $3)
    `, [userId, token, expiresAt]);
  },

  // ─── Find a valid (non-expired) refresh token ───────────────────────────────
  async findValid(token, userId) {
    const result = await pool.query(`
      SELECT * FROM refresh_tokens
      WHERE token = $1 AND user_id = $2 AND expires_at > NOW()
    `, [token, userId]);
    return result.rows[0] || null;
  },

  // ─── Delete a refresh token (logout / rotation) ──────────────────────────────
  async delete(token) {
    await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
  },

  // ─── Delete all tokens for a user (force logout all devices) ────────────────
  async deleteAllByUser(userId) {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
  },
};

module.exports = RefreshToken;
