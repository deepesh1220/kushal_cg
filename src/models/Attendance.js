const { pool } = require('../config/db');

const Attendance = {
  // ─── Mark attendance (create) ───────────────────────────────────────────────
  async create({ user_id, date, check_in_time, status, latitude, longitude, photo_path, remarks, marked_by }) {
    const result = await pool.query(`
      INSERT INTO attendance_records
        (user_id, date, check_in_time, status, latitude, longitude, photo_path, remarks, marked_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      user_id,
      date,
      check_in_time || new Date(),
      status || 'present',
      latitude || null,
      longitude || null,
      photo_path || null,
      remarks || null,
      marked_by || user_id,
    ]);
    return result.rows[0];
  },

  // ─── Check-out (update check_out_time) ─────────────────────────────────────
  async checkOut(userId, date) {
    const result = await pool.query(`
      UPDATE attendance_records
      SET check_out_time = NOW(), updated_at = NOW()
      WHERE user_id = $1 AND date = $2
      RETURNING *
    `, [userId, date]);
    return result.rows[0] || null;
  },

  // ─── Find today's record for a user ─────────────────────────────────────────
  async findByUserAndDate(userId, date) {
    const result = await pool.query(`
      SELECT * FROM attendance_records
      WHERE user_id = $1 AND date = $2
    `, [userId, date]);
    return result.rows[0] || null;
  },

  // ─── Get own attendance (vocational_teacher view) ───────────────────────────
  async findByUser(userId, { from_date, to_date, limit = 30, offset = 0 } = {}) {
    let query = `
      SELECT
        ar.*,
        u.name  AS marked_by_name
      FROM attendance_records ar
      LEFT JOIN users u ON u.id = ar.marked_by
      WHERE ar.user_id = $1
    `;
    const params = [userId];

    if (from_date) { params.push(from_date); query += ` AND ar.date >= $${params.length}`; }
    if (to_date) { params.push(to_date); query += ` AND ar.date <= $${params.length}`; }

    params.push(limit);
    query += ` ORDER BY ar.date DESC LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
  },

  // ─── Get all attendance records (admin/headmaster/deo) ──────────────────────
  async findAll({ user_id, date, from_date, to_date, status, district, block, vtp_name, trade, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT
        ar.id, ar.date, ar.check_in_time, ar.check_out_time,
        ar.status, ar.latitude, ar.longitude, ar.photo_path,
        ar.remarks, ar.created_at,
        u.id   AS user_id,
        u.name AS user_name,
        u.phone AS user_phone,
        r.name AS user_role,
        v.district_name, v.block_name, v.school_name,
        v.vtp_name, v.trade,
        mb.name AS marked_by_name
      FROM attendance_records ar
      JOIN users u       ON u.id = ar.user_id
      LEFT JOIN roles r  ON r.id = u.role_id
      LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
      LEFT JOIN users mb ON mb.id = ar.marked_by
      WHERE 1 = 1
    `;
    const params = [];

    if (user_id) { params.push(user_id); query += ` AND ar.user_id = $${params.length}`; }
    if (date) { params.push(date); query += ` AND ar.date = $${params.length}`; }
    if (from_date) { params.push(from_date); query += ` AND ar.date >= $${params.length}`; }
    if (to_date) { params.push(to_date); query += ` AND ar.date <= $${params.length}`; }
    if (status) { params.push(status); query += ` AND ar.status = $${params.length}`; }
    if (district) { params.push(district); query += ` AND v.district_name ILIKE $${params.length}`; }
    if (block) { params.push(block); query += ` AND v.block_name ILIKE $${params.length}`; }
    if (vtp_name) { params.push(`%${vtp_name}%`); query += ` AND v.vtp_name ILIKE $${params.length}`; }
    if (trade) { params.push(`%${trade}%`); query += ` AND v.trade ILIKE $${params.length}`; }

    params.push(limit);
    query += ` ORDER BY ar.date DESC, u.name ASC LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
  },

  // ─── Get attendance for teachers under a provider ───────────────────────────
  async findByProvider(vtpName, { from_date, to_date, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT
        ar.id, ar.date, ar.check_in_time, ar.check_out_time,
        ar.status, ar.photo_path, ar.remarks,
        u.name AS vt_name, u.phone AS vt_phone,
        v.district_name, v.block_name, v.school_name, v.trade
      FROM attendance_records ar
      JOIN users u ON u.id = ar.user_id
      JOIN vt_staff_details v ON v.id = u.vt_staff_id
      WHERE v.vtp_name = $1
    `;
    const params = [vtpName];

    if (from_date) { params.push(from_date); query += ` AND ar.date >= $${params.length}`; }
    if (to_date) { params.push(to_date); query += ` AND ar.date <= $${params.length}`; }

    params.push(limit);
    query += ` ORDER BY ar.date DESC LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
  },

  // ─── Update an attendance record ─────────────────────────────────────────────
  async update(id, { check_in_time, check_out_time, status, remarks, photo_path }) {
    const result = await pool.query(`
      UPDATE attendance_records
      SET
        check_in_time  = COALESCE($1, check_in_time),
        check_out_time = COALESCE($2, check_out_time),
        status         = COALESCE($3, status),
        remarks        = COALESCE($4, remarks),
        photo_path     = COALESCE($5, photo_path),
        updated_at     = NOW()
      WHERE id = $6
      RETURNING *
    `, [check_in_time || null, check_out_time || null, status || null, remarks || null, photo_path || null, id]);
    return result.rows[0] || null;
  },

  // ─── Daily report: per-day rows for a user with working hours & totals ───────
  // filter_type: 'date' | 'week' | 'month' | 'date_range'
  // filter_value examples: '2026-04-21' | '2026-W16' (ISO week) | '2026-04' | '2026-04-01,2026-04-21'
  async getDailyReport(userId, { filter_type = 'month', filter_value, limit = 31, offset = 0 } = {}) {
    const params = [userId];
    let dateFilter = '';

    if (filter_type === 'date' && filter_value) {
      params.push(filter_value);
      dateFilter = `AND ar.date = $${params.length}`;
    } else if (filter_type === 'week' && filter_value) {
      // filter_value: 'YYYY-WNN'  e.g. '2026-W16'
      const [yearStr, weekStr] = filter_value.split('-W');
      params.push(parseInt(yearStr), parseInt(weekStr));
      dateFilter = `AND EXTRACT(ISOYEAR FROM ar.date) = $${params.length - 1}
                    AND EXTRACT(WEEK     FROM ar.date) = $${params.length}`;
    } else if (filter_type === 'month' && filter_value) {
      // filter_value: 'YYYY-MM'  e.g. '2026-04'
      const [yearStr, monthStr] = filter_value.split('-');
      params.push(parseInt(yearStr), parseInt(monthStr));
      dateFilter = `AND EXTRACT(YEAR  FROM ar.date) = $${params.length - 1}
                    AND EXTRACT(MONTH FROM ar.date) = $${params.length}`;
    } else if (filter_type === 'date_range' && filter_value) {
      // filter_value: 'YYYY-MM-DD,YYYY-MM-DD' e.g. '2026-04-01,2026-04-21'
      const [fromDate, toDate] = filter_value.split(',');
      if (fromDate && toDate) {
        params.push(fromDate, toDate);
        dateFilter = `AND ar.date >= $${params.length - 1} AND ar.date <= $${params.length}`;
      } else if (fromDate) {
        params.push(fromDate);
        dateFilter = `AND ar.date >= $${params.length}`;
      }
    }

    // per-day records
    const recordsQuery = `
      SELECT
        ar.date,
        ar.check_in_time,
        ar.check_out_time,
        ar.status,
        ar.remarks                              AS leave_reason,
        CASE
          WHEN ar.check_in_time IS NOT NULL AND ar.check_out_time IS NOT NULL
          THEN ROUND(
            EXTRACT(EPOCH FROM (ar.check_out_time - ar.check_in_time)) / 3600.0,
            2
          )
          ELSE NULL
        END                                     AS working_hours
      FROM attendance_records ar
      WHERE ar.user_id = $1
        ${dateFilter}
      ORDER BY ar.date DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);
    const recordsResult = await pool.query(recordsQuery, params);

    // overall totals for the same filter (no limit/offset)
    const totalParams = params.slice(0, params.length - 2); // remove limit & offset
    const totalsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'present')  AS total_present,
        COUNT(*) FILTER (WHERE status = 'absent')   AS total_absent,
        COUNT(*) FILTER (WHERE status = 'on_leave') AS total_leave,
        COUNT(*) FILTER (WHERE status = 'late')     AS total_late,
        COUNT(*) FILTER (WHERE status = 'half_day') AS total_half_day,
        COALESCE(
          ROUND(
            SUM(
              CASE
                WHEN check_in_time IS NOT NULL AND check_out_time IS NOT NULL
                THEN EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 3600.0
                ELSE 0
              END
            ), 2
          ), 0
        )                                           AS total_working_hours
      FROM attendance_records ar
      WHERE ar.user_id = $1
        ${dateFilter}
    `;
    const totalsResult = await pool.query(totalsQuery, totalParams);

    return {
      records: recordsResult.rows,
      totals: totalsResult.rows[0],
    };
  },

  // ─── Delete a record ─────────────────────────────────────────────────────────
  async delete(id) {
    const result = await pool.query(
      'DELETE FROM attendance_records WHERE id = $1 RETURNING id', [id]
    );
    return result.rowCount > 0;
  },

  // ─── Monthly summary (count by status per user) ──────────────────────────────
  async getMonthlySummary(userId, year, month) {
    const result = await pool.query(`
      SELECT
        status,
        COUNT(*) AS count
      FROM attendance_records
      WHERE user_id = $1
        AND EXTRACT(YEAR  FROM date) = $2
        AND EXTRACT(MONTH FROM date) = $3
      GROUP BY status
    `, [userId, year, month]);
    return result.rows;
  },
};

module.exports = Attendance;
