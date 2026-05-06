const { pool } = require('../config/db');

class Regularization {
  // ─── Check if a request already exists for this user+date ───────────────────
  static async checkDuplicate(userId, date, excludeId = null) {
    let query = `
      SELECT id FROM regularization_requests
      WHERE user_id = $1
      AND date = $2
      AND status IN ('pending', 'approved')
    `;
    const params = [userId, date];

    if (excludeId) {
      params.push(excludeId);
      query += ` AND id != $${params.length}`;
    }

    const result = await pool.query(query, params);
    return result.rows.length > 0;
  }

  // ─── Create a new regularization request ────────────────────────────────────
  static async create({ user_id, date, reason }) {
    const result = await pool.query(`
      INSERT INTO regularization_requests (user_id, date, reason, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING *
    `, [user_id, date, reason]);
    return result.rows[0];
  }

  // ─── Find by ID ──────────────────────────────────────────────────────────────
  static async findById(id) {
    const result = await pool.query(`
      SELECT
        rr.*,
        u.name AS user_name,
        rv.name AS reviewer_name
      FROM regularization_requests rr
      JOIN  users u  ON rr.user_id      = u.id
      LEFT JOIN users rv ON rr.reviewed_by = rv.id
      WHERE rr.id = $1
    `, [id]);
    return result.rows[0] || null;
  }

  // ─── Find requests for a specific user ──────────────────────────────────────
  static async findByUser(userId, { status, from_date, to_date, limit = 10, offset = 0 } = {}) {
    let baseQuery = `
      FROM regularization_requests rr
      LEFT JOIN users rv ON rr.reviewed_by = rv.id
      WHERE rr.user_id = $1
    `;
    const params = [userId];

    if (status) {
      params.push(status);
      baseQuery += ` AND rr.status = $${params.length}`;
    }
    if (from_date) {
      params.push(from_date);
      baseQuery += ` AND rr.date >= $${params.length}`;
    }
    if (to_date) {
      params.push(to_date);
      baseQuery += ` AND rr.date <= $${params.length}`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalRecords = parseInt(countResult.rows[0].count, 10);

    const dataQuery = `
      SELECT
        rr.*,
        rv.name AS reviewer_name
      ${baseQuery}
      ORDER BY rr.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const result = await pool.query(dataQuery, [...params, limit, offset]);
    return { data: result.rows, totalRecords };
  }

  // ─── Find all requests (admin/headmaster) ───────────────────────────────────
  static async findAll({ udise_code, status, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT
        rr.*,
        u.name  AS user_name,
        v.udise_code,
        rv.name AS reviewer_name
      FROM regularization_requests rr
      JOIN  users            u  ON u.id  = rr.user_id
      LEFT JOIN vt_staff_details v  ON v.id  = u.vt_staff_id
      LEFT JOIN users       rv  ON rv.id = rr.reviewed_by
      WHERE 1=1
    `;
    const params = [];

    if (udise_code) {
      params.push(udise_code);
      query += ` AND v.udise_code = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND rr.status = $${params.length}`;
    }

    params.push(limit, offset);
    query += ` ORDER BY rr.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  // ─── Update status (approve / reject) ───────────────────────────────────────
  static async updateStatus(id, { status, reviewerId }) {
    const result = await pool.query(`
      UPDATE regularization_requests
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

module.exports = Regularization;
