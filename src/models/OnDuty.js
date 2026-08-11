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
      INSERT INTO od_requests (user_id, from_date, to_date, reason, status,
                               hm_status, vtp_status, od_approved)
      VALUES ($1, $2, $3, $4, 'pending', 'pending', 'pending', FALSE)
      RETURNING *
    `, [user_id, from_date, to_date, reason]);
    return result.rows[0];
  }

  // ─── Find OD request by ID ───────────────────────────────────────────────────
  static async findById(id) {
    const result = await pool.query(`
      SELECT
        o.*,
        u.name  AS user_name,
        u.phone AS mobile,
        hm.name AS hm_approved_by_name,
        vp.name AS vtp_approved_by_name
      FROM od_requests o
      JOIN  users u   ON o.user_id       = u.id
      LEFT JOIN users hm ON o.hm_approved_by  = hm.id
      LEFT JOIN users vp ON o.vtp_approved_by = vp.id
      WHERE o.id = $1
    `, [id]);
    return result.rows[0] || null;
  }

  // ─── Find OD requests for a specific user (VT's own view) ────────────────────
  static async findByUser(userId, { status, from_date, to_date, limit = 10, offset = 0 } = {}) {
    let baseQuery = `
      FROM od_requests o
      LEFT JOIN users hm ON o.hm_approved_by  = hm.id
      LEFT JOIN users vp ON o.vtp_approved_by = vp.id
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
        hm.name AS hm_approved_by_name,
        vp.name AS vtp_approved_by_name
      ${baseQuery}
      ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const result = await pool.query(dataQuery, [...params, limit, offset]);
    return { data: result.rows, totalRecords };
  }

  // ─── Find all OD requests (admin/headmaster) ─────────────────────────────────
  static async findAll({ udise_code, status, limit = 50, offset = 0 } = {}) {
    let baseQuery = `
      FROM od_requests o
      JOIN  users            u  ON u.id  = o.user_id
      LEFT JOIN vt_staff_details v  ON v.id  = u.vt_staff_id
      LEFT JOIN users        hm ON hm.id = o.hm_approved_by
      LEFT JOIN users        vp ON vp.id = o.vtp_approved_by
      WHERE 1=1
    `;
    const params = [];

    if (udise_code) {
      params.push(udise_code);
      baseQuery += ` AND v.udise_code = $${params.length}`;
    }
    if (status) {
      params.push(status);
      baseQuery += ` AND o.status = $${params.length}`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalRecords = parseInt(countResult.rows[0].count, 10);

    const dataQuery = `
      SELECT
        o.*,
        u.name  AS user_name,
        u.phone AS mobile,
        v.udise_code,
        v.vtp_name,
        v.trade,
        hm.name AS hm_approved_by_name,
        vp.name AS vtp_approved_by_name
      ${baseQuery}
      ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await pool.query(dataQuery, [...params, limit, offset]);
    return { data: result.rows, totalRecords };
  }

  // ─── Find all OD requests scoped to a VTP (by vtp_id in vt_staff_details) ───
  static async findAllByVtpId(vtpId, { status, limit = 10, offset = 0 } = {}) {
    let baseQuery = `
      FROM od_requests o
      JOIN  users            u  ON u.id  = o.user_id
      LEFT JOIN vt_staff_details v  ON v.id  = u.vt_staff_id
      LEFT JOIN users        hm ON hm.id = o.hm_approved_by
      LEFT JOIN users        vp ON vp.id = o.vtp_approved_by
      WHERE TRIM(COALESCE(u.vtp_id, v.vtp_id)) = TRIM($1)
    `;
    const params = [vtpId];

    if (status) {
      params.push(status);
      baseQuery += ` AND o.status = $${params.length}`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalRecords = parseInt(countResult.rows[0].count, 10);

    const dataQuery = `
      SELECT
        o.*,
        u.name  AS user_name,
        u.phone AS mobile,
        v.udise_code,
        v.vtp_name,
        v.trade,
        hm.name AS hm_approved_by_name,
        vp.name AS vtp_approved_by_name
      ${baseQuery}
      ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await pool.query(dataQuery, [...params, limit, offset]);
    return { data: result.rows, totalRecords };
  }

  // ─── Update Headmaster approval status (first layer) ────────────────────────
  // Final status rules:
  //   HM rejects                     → status = 'rejected'
  //   HM approves + VTP pending      → status stays 'pending'
  //   HM approves + VTP approves     → status = 'approved', od_approved = TRUE
  static async updateHmStatus(id, { status, reviewerId, remarks, approvalType = 'manual' }) {
    const result = await pool.query(`
      UPDATE od_requests
      SET
        hm_status       = $1,
        hm_approved_by  = $2,
        hm_action_at    = NOW(),
        hm_remarks      = $3,
        status = CASE
          WHEN $1::varchar = 'rejected'                            THEN 'rejected'
          WHEN $1::varchar = 'approved' AND vtp_status = 'approved' THEN 'approved'
          ELSE 'pending'
        END,
        od_approved = CASE
          WHEN $1::varchar = 'approved' AND vtp_status = 'approved' THEN TRUE
          ELSE FALSE
        END,
        hm_approval_type = $4::VARCHAR,
        is_auto_approved = is_auto_approved OR $4::VARCHAR = 'auto',
        updated_at = NOW()
      WHERE id = $5 AND hm_status = 'pending' AND status <> 'rejected'
      RETURNING *
    `, [status, reviewerId, remarks || null, approvalType, id]);
    return result.rows[0] || null;
  }

  // ─── Update VTP approval status (second layer) ───────────────────────────────
  // Final status rules:
  //   VTP rejects                      → status = 'rejected'
  //   VTP approves + HM pending        → status stays 'pending'
  //   VTP approves + HM approved       → status = 'approved', od_approved = TRUE
  static async updateVtpStatus(id, { status, reviewerId, remarks, approvalType = 'manual' }) {
    const result = await pool.query(`
      UPDATE od_requests
      SET
        vtp_status      = $1,
        vtp_approved_by = $2,
        vtp_action_at   = NOW(),
        vtp_remarks     = $3,
        status = CASE
          WHEN $1::varchar = 'rejected'                            THEN 'rejected'
          WHEN $1::varchar = 'approved' AND hm_status = 'approved' THEN 'approved'
          ELSE 'pending'
        END,
        od_approved = CASE
          WHEN $1::varchar = 'approved' AND hm_status = 'approved' THEN TRUE
          ELSE FALSE
        END,
        vtp_approval_type = $4::VARCHAR,
        is_auto_approved = is_auto_approved OR $4::VARCHAR = 'auto',
        updated_at = NOW()
      WHERE id = $5 AND vtp_status = 'pending' AND status <> 'rejected'
      RETURNING *
    `, [status, reviewerId, remarks || null, approvalType, id]);
    return result.rows[0] || null;
  }

  // ─── Legacy alias (backward compat) — maps to HM layer ──────────────────────
  static async updateStatus(id, { status, reviewerId, remarks }) {
    return this.updateHmStatus(id, { status, reviewerId, remarks });
  }
}

module.exports = OnDuty;
