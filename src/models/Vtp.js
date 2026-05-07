const { pool } = require('../config/db');

class Vtp {
  // ─── Find VTP by email ──────────────────────────────────────────────────────
  static async findByEmail(email) {
    const query = `
      SELECT id, vc_name, vtp_name, mobile,
             email, status, created_at, updated_at
      FROM vtp
      WHERE email = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [email]);
    return result.rows[0] || null;
  }

  // ─── Find VTP by mobile number ──────────────────────────────────────────────
  static async findByMobile(mobile) {
    const query = `
      SELECT id, vc_name, vtp_name, mobile,
             email, status, created_at, updated_at
      FROM vtp
      WHERE mobile = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [mobile]);
    return result.rows[0] || null;
  }

  // ─── Find VTP by email OR mobile (used by login) ───────────────────────────
  static async findByEmailOrMobile(identifier) {
    const query = `
      SELECT id, vc_name, vtp_name, mobile,
             email, status, created_at, updated_at
      FROM vtp
      WHERE email = $1 OR mobile::TEXT = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [identifier]);
    return result.rows[0] || null;
  }

  // ─── Find VTP by ID ────────────────────────────────────────────────────────
  static async findById(id) {
    const query = `
      SELECT id, vc_name, vtp_name, mobile,
             email, status, created_at, updated_at
      FROM vtp
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }
}

module.exports = Vtp;
