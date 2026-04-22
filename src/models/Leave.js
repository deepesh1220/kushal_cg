const { pool } = require('../config/db');

class Leave {
  // ─── Check for overlapping leaves ───────────────────────────────────────────
  static async checkOverlap(userId, fromDate, toDate, excludeId = null) {
    let query = `
      SELECT id FROM leave_requests
      WHERE user_id = $1
      AND status IN ('pending', 'approved')
      AND from_date <= $3
      AND to_date >= $2
    `;
    const params = [userId, fromDate, toDate];

    if (excludeId) {
      params.push(excludeId);
      query += ` AND id != $4`;
    }

    const result = await pool.query(query, params);
    return result.rows.length > 0;
  }

  // ─── Create a new leave request ─────────────────────────────────────────────
  static async create({ user_id, from_date, to_date, reason, leave_type = 'full-day' }) {
    const result = await pool.query(`
      INSERT INTO leave_requests (user_id, from_date, to_date, reason, leave_type, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `, [user_id, from_date, to_date, reason, leave_type]);
    return result.rows[0];
  }

  // ─── Find leave by ID ───────────────────────────────────────────────────────
  static async findById(id) {
    const result = await pool.query(`
      SELECT 
        l.*,
        u.name AS user_name,
        r.name AS reviewer_name
      FROM leave_requests l
      JOIN users u ON l.user_id = u.id
      LEFT JOIN users r ON l.reviewed_by = r.id
      WHERE l.id = $1
    `, [id]);
    return result.rows[0] || null;
  }

  // ─── Find leaves for a specific user ────────────────────────────────────────
  static async findByUser(userId, { status, leave_type, from_date, to_date, limit = 50, offset = 0 } = {}) {
    let baseQuery = `
      FROM leave_requests l
      LEFT JOIN users r ON l.reviewed_by = r.id
      WHERE l.user_id = $1
    `;
    const params = [userId];

    if (status) {
      params.push(status);
      baseQuery += ` AND l.status = $${params.length}`;
    }
    if (leave_type) {
      params.push(leave_type);
      baseQuery += ` AND l.leave_type = $${params.length}`;
    }
    if (from_date) {
      params.push(from_date);
      baseQuery += ` AND l.from_date >= $${params.length}`;
    }
    if (to_date) {
      params.push(to_date);
      baseQuery += ` AND l.to_date <= $${params.length}`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalRecords = parseInt(countResult.rows[0].count, 10);

    const dataQuery = `
      SELECT 
        l.*,
        r.name AS reviewer_name
      ${baseQuery}
      ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const dataParams = [...params, limit, offset];

    const result = await pool.query(dataQuery, dataParams);
    return { data: result.rows, totalRecords };
  }

  // ─── Get User Leave Metrics ──────────────────────────────────────────────────
  static async getUserLeaveMetrics(userId) {
    const result = await pool.query(`
      SELECT 
        COUNT(*) AS total_leaves,
        COUNT(*) FILTER (WHERE leave_type = 'full-day') AS full_day,
        COUNT(*) FILTER (WHERE leave_type = 'first-half') AS first_half,
        COUNT(*) FILTER (WHERE leave_type = 'second-half') AS second_half,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'approved') AS accepted,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
      FROM leave_requests
      WHERE user_id = $1
    `, [userId]);

    const row = result.rows[0];
    return {
      total_leaves: parseInt(row.total_leaves || 0, 10),
      full_day: parseInt(row.full_day || 0, 10),
      first_half: parseInt(row.first_half || 0, 10),
      second_half: parseInt(row.second_half || 0, 10),
      pending: parseInt(row.pending || 0, 10),
      accepted: parseInt(row.accepted || 0, 10),
      rejected: parseInt(row.rejected || 0, 10)
    };
  }

  // ─── Leave report: paginated rows for a user matching filter_type ───────
  static async getLeaveReport(userId, { filter_type = 'month', filter_value, limit = 31, offset = 0 } = {}) {
    const params = [userId];
    let dateFilter = '';

    if (filter_type === 'date' && filter_value) {
      params.push(filter_value);
      // For a single date find any requests that include this date
      dateFilter = `AND l.from_date <= $${params.length} AND l.to_date >= $${params.length}`;
    } else if (filter_type === 'week' && filter_value) {
      const [yearStr, weekStr] = filter_value.split('-W');
      params.push(parseInt(yearStr), parseInt(weekStr));
      dateFilter = `AND EXTRACT(ISOYEAR FROM l.from_date) = $${params.length - 1}
                    AND EXTRACT(WEEK     FROM l.from_date) = $${params.length}`;
    } else if (filter_type === 'month' && filter_value) {
      const [yearStr, monthStr] = filter_value.split('-');
      params.push(parseInt(yearStr), parseInt(monthStr));
      dateFilter = `AND EXTRACT(YEAR  FROM l.from_date) = $${params.length - 1}
                    AND EXTRACT(MONTH FROM l.from_date) = $${params.length}`;
    } else if (filter_type === 'date_range' && filter_value) {
      const [fromDate, toDate] = filter_value.split(',');
      if (fromDate && toDate) {
        params.push(fromDate, toDate);
        dateFilter = `AND l.from_date >= $${params.length - 1} AND l.from_date <= $${params.length}`;
      } else if (fromDate) {
        params.push(fromDate);
        dateFilter = `AND l.from_date >= $${params.length}`;
      }
    }

    // per-leave records
    const recordsQuery = `
      SELECT
        l.id, l.from_date, l.to_date, l.leave_type, l.status, l.reason, l.created_at, l.updated_at,
        r.name AS reviewer_name
      FROM leave_requests l
      LEFT JOIN users r ON l.reviewed_by = r.id
      WHERE l.user_id = $1
        ${dateFilter}
      ORDER BY l.from_date DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);
    const recordsResult = await pool.query(recordsQuery, params);

    // overall totals for the same filter
    const totalParams = params.slice(0, params.length - 2); 
    const totalsQuery = `
      SELECT
        COUNT(*) AS total_leaves,
        COUNT(*) FILTER (WHERE leave_type = 'full-day') AS full_day,
        COUNT(*) FILTER (WHERE leave_type = 'first-half') AS first_half,
        COUNT(*) FILTER (WHERE leave_type = 'second-half') AS second_half,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'approved') AS accepted,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
      FROM leave_requests l
      WHERE l.user_id = $1
        ${dateFilter}
    `;
    const totalsResult = await pool.query(totalsQuery, totalParams);

    return {
      records: recordsResult.rows,
      totals: totalsResult.rows[0],
    };
  }

  // ─── Find all leaves with filters ───────────────────────────────────────────
  static async findAll({ udise_code, status, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT 
        l.*,
        u.name AS user_name,
        v.udise_code,
        r.name AS reviewer_name
      FROM leave_requests l
      JOIN users u ON l.user_id = u.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      LEFT JOIN users r ON l.reviewed_by = r.id
      WHERE 1=1
    `;
    const params = [];

    if (udise_code) {
      params.push(udise_code);
      query += ` AND v.udise_code = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND l.status = $${params.length}`;
    }

    params.push(limit, offset);
    query += ` ORDER BY l.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  // ─── Update leave request (before approval) ─────────────────────────────────
  static async update(id, { from_date, to_date, reason, leave_type }) {
    const result = await pool.query(`
      UPDATE leave_requests
      SET 
        from_date  = COALESCE($1, from_date),
        to_date    = COALESCE($2, to_date),
        reason     = COALESCE($3, reason),
        leave_type = COALESCE($4, leave_type),
        updated_at = NOW()
      WHERE id = $5 AND status = 'pending'
      RETURNING *
    `, [from_date, to_date, reason, leave_type, id]);
    return result.rows[0] || null;
  }

  // ─── Approve or Reject a leave ──────────────────────────────────────────────
  static async updateStatus(id, { status, reviewerId }) {
    const result = await pool.query(`
      UPDATE leave_requests
      SET 
        status = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [status, reviewerId, id]);
    return result.rows[0] || null;
  }

  // ─── Delete a leave request (before approval) ───────────────────────────────
  static async delete(id) {
    const result = await pool.query(`
      DELETE FROM leave_requests
      WHERE id = $1 AND status = 'pending'
      RETURNING *
    `, [id]);
    return result.rows[0] || null;
  }
}

module.exports = Leave;
