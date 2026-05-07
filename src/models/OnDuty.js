const { pool } = require('../config/db');

class OnDuty {
  // ─── Check for overlapping OD requests ──────────────────────────────────────
  static async checkOverlap(userId, fromDate, toDate, excludeId = null) {
    let query = `
      SELECT id FROM od_requests
      WHERE user_id = $1
      AND status IN ('pending', 'approved')
      AND from_date <= $3
      AND to_date   >= $2
    `;
    const params = [userId, fromDate, toDate];

    if (excludeId) {
      params.push(excludeId);
      query += ` AND id != $${params.length}`;
    }

    const result = await pool.query(query, params);
    return result.rows.length > 0;
  }

  // ─── Create a new OD request ─────────────────────────────────────────────────
  static async create({ user_id, from_date, to_date, reason }) {
    const result = await pool.query(`
      INSERT INTO od_requests (user_id, from_date, to_date, reason, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *
    `, [user_id, from_date, to_date, reason]);
    return result.rows[0];
  }

  // ─── Find OD request by ID ───────────────────────────────────────────────────
  static async findById(id) {
    const result = await pool.query(`
      SELECT
        o.*,
        u.name AS user_name,
        r.name AS reviewer_name
      FROM od_requests o
      JOIN  users u ON o.user_id      = u.id
      LEFT JOIN users r ON o.reviewed_by = r.id
      WHERE o.id = $1
    `, [id]);
    return result.rows[0] || null;
  }

  // ─── Find OD requests for a specific user ────────────────────────────────────
  static async findByUser(userId, { status, from_date, to_date, limit = 10, offset = 0 } = {}) {
    let baseQuery = `
      FROM od_requests o
      LEFT JOIN users r ON o.reviewed_by = r.id
      WHERE o.user_id = $1
    `;
    const params = [userId];

    if (status) {
      params.push(status);
      baseQuery += ` AND o.status = $${params.length}`;
    }
    if (from_date) {
      params.push(from_date);
      baseQuery += ` AND o.from_date >= $${params.length}`;
    }
    if (to_date) {
      params.push(to_date);
      baseQuery += ` AND o.to_date <= $${params.length}`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalRecords = parseInt(countResult.rows[0].count, 10);

    const dataQuery = `
      SELECT
        o.*,
        r.name AS reviewer_name
      ${baseQuery}
      ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const result = await pool.query(dataQuery, [...params, limit, offset]);
    return { data: result.rows, totalRecords };
  }

  // ─── Find all OD requests (admin/headmaster) ─────────────────────────────────
  static async findAll({ udise_code, status, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT
        o.*,
        u.name  AS user_name,
        v.udise_code,
        r.name  AS reviewer_name
      FROM od_requests o
      JOIN  users            u ON u.id = o.user_id
      LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
      LEFT JOIN users        r ON r.id = o.reviewed_by
      WHERE 1=1
    `;
    const params = [];

    if (udise_code) {
      params.push(udise_code);
      query += ` AND v.udise_code = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND o.status = $${params.length}`;
    }

    params.push(limit, offset);
    query += ` ORDER BY o.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  // ─── Update OD status (approve / reject) ────────────────────────────────────
  static async updateStatus(id, { status, reviewerId }) {
    const result = await pool.query(`
      UPDATE od_requests
      SET
        status      = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        updated_at  = NOW()
      WHERE id = $3
      RETURNING *
    `, [status, reviewerId, id]);
    return result.rows[0] || null;
  }
}

module.exports = OnDuty;
