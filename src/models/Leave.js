const { pool } = require('../config/db');
const LeaveBalance = require('./LeaveBalance');

const dayjs = require("dayjs");
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
  static async create({ user_id, from_date, to_date, reason }) {
    const result = await pool.query(`
      INSERT INTO leave_requests (user_id, from_date, to_date, reason, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *
    `, [user_id, from_date, to_date, reason]);
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
        COALESCE(SUM(to_date - from_date + 1), 0) AS total_leaves,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'full-day'), 0) AS full_day,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'first-half'), 0) AS first_half,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'second-half'), 0) AS second_half,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'od'), 0) AS od,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'regularization'), 0) AS regularization,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE status = 'pending'), 0) AS pending,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE status = 'approved'), 0) AS accepted,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE status = 'rejected'), 0) AS rejected
      FROM leave_requests
      WHERE user_id = $1
    `, [userId]);

    const row = result.rows[0];
    return {
      total_leaves: parseInt(row.total_leaves || 0, 10),
      full_day: parseInt(row.full_day || 0, 10),
      first_half: parseInt(row.first_half || 0, 10),
      second_half: parseInt(row.second_half || 0, 10),
      od: parseInt(row.od || 0, 10),
      regularization: parseInt(row.regularization || 0, 10),
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
        COALESCE(SUM(to_date - from_date + 1), 0) AS total_leaves,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'full-day'), 0) AS full_day,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'first-half'), 0) AS first_half,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'second-half'), 0) AS second_half,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'od'), 0) AS od,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE leave_type = 'regularization'), 0) AS regularization,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE status = 'pending'), 0) AS pending,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE status = 'approved'), 0) AS accepted,
        COALESCE(SUM(to_date - from_date + 1) FILTER (WHERE status = 'rejected'), 0) AS rejected
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
  static async findAll({ udise_code, user_id, status, leave_type, from_date, to_date, limit = 50, offset = 0 } = {}) {
    let baseQuery = `
      FROM leave_requests l
      JOIN users u ON l.user_id = u.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      LEFT JOIN users r ON l.reviewed_by = r.id
      WHERE 1=1
    `;
    const params = [];

    if (udise_code) {
      params.push(udise_code);
      baseQuery += ` AND v.udise_code = $${params.length}`;
    }
    if (user_id) {
      params.push(user_id);
      baseQuery += ` AND l.user_id = $${params.length}`;
    }
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
        u.name AS user_name,
        v.udise_code,
        r.name AS reviewer_name
      ${baseQuery}
      ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await pool.query(dataQuery, [...params, limit, offset]);
    return { data: result.rows, totalRecords };
  }

  // ─── Get all leave requests for a headmaster's school ───────────────────────
  // Used by: GET /api/headmaster/leaves
  // Scoped to udise_code so headmaster only sees their school's VTs.
  //
  // INDEX SUGGESTIONS (add to DB schema for production performance):
  //   CREATE INDEX idx_leave_requests_user_id     ON leave_requests(user_id);
  //   CREATE INDEX idx_leave_requests_status       ON leave_requests(status);
  //   CREATE INDEX idx_leave_requests_from_date    ON leave_requests(from_date);
  //   CREATE INDEX idx_vt_staff_details_udise_code ON vt_staff_details(udise_code);
  //   CREATE INDEX idx_users_vt_staff_id           ON users(vt_staff_id);
  static async getSchoolLeaves(udiseCode, {
    status,
    from_date,
    to_date,
    teacher_code,
    page = 1,
    limit = 20,
  } = {}) {
    // Clamp pagination values
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (parsedPage - 1) * parsedLimit;

    // ── Build dynamic filter clauses (school-scoped) ─────────────────────────
    const filterParams = [udiseCode]; // $1 always = udise_code
    let filterClauses = '';

    if (status) {
      filterParams.push(status.toLowerCase());
      filterClauses += ` AND l.status = $${filterParams.length}`;
    }
    if (from_date) {
      filterParams.push(from_date);
      filterClauses += ` AND l.from_date >= $${filterParams.length}`;
    }
    if (to_date) {
      filterParams.push(to_date);
      filterClauses += ` AND l.to_date <= $${filterParams.length}`;
    }
    if (teacher_code) {
      // teacher_code for VTs is their user ID (vt_staff_details has no teacher_code column)
      filterParams.push(teacher_code);
      filterClauses += ` AND u.id = $${filterParams.length}`;
    }


    const baseWhere = `
      FROM leave_requests l
      JOIN  users            u ON u.id  = l.user_id
      JOIN  vt_staff_details v ON v.id  = u.vt_staff_id
      LEFT JOIN users        r ON r.id  = l.reviewed_by
      LEFT JOIN leave_excess_records ler ON ler.leave_request_id = l.id
      WHERE v.udise_code = $1
      ${filterClauses}
    `;

    // ── COUNT query (pagination metadata) ───────────────────────────────────
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total ${baseWhere}`,
      filterParams
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // ── Data query ───────────────────────────────────────────────────────────
    const dataParams = [...filterParams, parsedLimit, offset];
    const dataResult = await pool.query(
      `SELECT
         l.id           AS leave_id,
         u.id           AS vt_user_id,
         u.name         AS teacher_name,
         u.phone        AS vt_phone,
         v.vt_aadhar    AS vt_aadhar,
         l.leave_type,
         l.from_date,
         l.to_date,
         l.status,
         l.reason,
         l.created_at   AS applied_at,
         r.name         AS reviewed_by_name,
         l.reviewed_at,
         ler.approved_leave_days,
         ler.excess_leave
       ${baseWhere}
       ORDER BY l.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return {
      total,
      page: parsedPage,
      limit: parsedLimit,
      total_pages: Math.ceil(total / parsedLimit),
      data: dataResult.rows,
    };
  }
  // ─── Get all leave requests for a VTP's organization ────────────────────────
  // Used by: GET /api/vtp/leaves
  // Scoped to vtp_name so VTP only sees their organization's VTs.
  static async getVtpLeaves(vtpName, {
    status,
    from_date,
    to_date,
    teacher_code,
    page = 1,
    limit = 20,
  } = {}) {
    // Clamp pagination values
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (parsedPage - 1) * parsedLimit;

    // ── Build dynamic filter clauses (VTP-scoped) ─────────────────────────
    const filterParams = [vtpName]; // $1 always = vtp_name
    let filterClauses = '';

    if (status) {
      filterParams.push(status.toLowerCase());
      filterClauses += ` AND l.vtp_status = $${filterParams.length}`;
    }
    if (from_date) {
      filterParams.push(from_date);
      filterClauses += ` AND l.from_date >= $${filterParams.length}`;
    }
    if (to_date) {
      filterParams.push(to_date);
      filterClauses += ` AND l.to_date <= $${filterParams.length}`;
    }
    if (teacher_code) {
      filterParams.push(teacher_code);
      filterClauses += ` AND u.id = $${filterParams.length}`;
    }

    const baseWhere = `
      FROM leave_requests l
      JOIN  users            u ON u.id  = l.user_id
      JOIN  vt_staff_details v ON v.id  = u.vt_staff_id
      LEFT JOIN users        r ON r.id  = l.reviewed_by
      LEFT JOIN leave_excess_records ler ON ler.leave_request_id = l.id
      WHERE v.vtp_name = $1
      ${filterClauses}
    `;

    // ── COUNT query (pagination metadata) ───────────────────────────────────
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total ${baseWhere}`,
      filterParams
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // ── Data query ───────────────────────────────────────────────────────────
    const dataParams = [...filterParams, parsedLimit, offset];
    const dataResult = await pool.query(
      `SELECT
         l.id           AS leave_id,
         u.id           AS vt_user_id,
         u.name         AS teacher_name,
         u.phone        AS vt_phone,
         v.vt_aadhar    AS vt_aadhar,
         v.udise_code   AS udise_code,
         v.school_name  AS school_name,
         l.leave_type,
         l.from_date,
         l.to_date,
         l.status       AS principal_status,
         l.vtp_status   AS status,
         l.principal_approval_type,
         l.vtp_approval_type,
         l.is_auto_approved,
         l.leave_approved,
         l.reason,
         l.created_at   AS applied_at,
         r.name         AS reviewed_by_name,
         l.reviewed_at,
         ler.approved_leave_days,
         ler.excess_leave
       ${baseWhere}
       ORDER BY l.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return {
      total,
      page: parsedPage,
      limit: parsedLimit,
      total_pages: Math.ceil(total / parsedLimit),
      data: dataResult.rows,
    };
  }


  // ─── Update leave request (before approval) ─────────────────────────────────
  static async update(id, { from_date, to_date, reason }) {
    const result = await pool.query(`
      UPDATE leave_requests
      SET 
        from_date  = COALESCE($1, from_date),
        to_date    = COALESCE($2, to_date),
        reason     = COALESCE($3, reason),
        updated_at = NOW()
      WHERE id = $4 AND status = 'pending'
      RETURNING *
    `, [from_date, to_date, reason, id]);
    return result.rows[0] || null;
  }

  // ─── Update status by Principal/HM ───────────────────────────────────────────
  static async updatePrincipalStatus(id, { status, reviewerId, remarks = null, approvalType = 'manual' }) {
    const result = await pool.query(`
      UPDATE leave_requests
      SET 
        status = $1,
        reviewed_by = $2,
        reviewed_at = NOW(),
        principal_remarks = $4,
        principal_updated_at = NOW(),
        updated_at = NOW(),
        leave_approved = CASE WHEN $3 = 'approved' AND vtp_status = 'approved' THEN TRUE ELSE FALSE END,
        principal_approval_type = $5::VARCHAR,
        is_auto_approved = is_auto_approved OR $5::VARCHAR = 'auto'
      WHERE id = $6 AND status = 'pending'
      RETURNING *
    `, [status, reviewerId, status, remarks, approvalType, id]);
    return result.rows[0] || null;
  }

  // ─── Update status by VTP ───────────────────────────────────────────────────
  static async updateVtpStatus(id, { status, reviewerId, remarks = null, approvalType = 'manual' }) {
    const result = await pool.query(`
      UPDATE leave_requests
      SET 
        vtp_status = $1,
        vtp_remarks = $3,
        vtp_updated_at = NOW(),
        updated_at = NOW(),
        leave_approved = CASE WHEN status = 'approved' AND $2 = 'approved' THEN TRUE ELSE FALSE END,
        vtp_approval_type = $4::VARCHAR,
        is_auto_approved = is_auto_approved OR $4::VARCHAR = 'auto'
      WHERE id = $5 AND vtp_status = 'pending' AND status <> 'rejected'
      RETURNING *
    `, [status, status, remarks, approvalType, id]);
    return result.rows[0] || null;
  }

  // ─── Legacy Update Status (for backward compatibility if needed) ────────────
  static async updateStatus(id, { status, reviewerId, remarks = null }) {
    return await this.updatePrincipalStatus(id, { status, reviewerId, remarks });
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


  static async getAttendanceReport(userId, month) {
    if (!month) {
      throw new Error("Month is required (YYYY-MM)");
    }

    const [year, monthNum] = month.split("-").map(Number);

    const startDate = dayjs(`${month}-01`).startOf("month");
    const endDate = dayjs(`${month}-01`).endOf("month");

    const today = dayjs();

    const userResult = await pool.query(
      `
  SELECT id, name, email, udise_code
  FROM users
  WHERE id = $1
  `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error("User not found");
    }

    const user = userResult.rows[0];

    // 🔴 Prevent future month
    if (startDate.isAfter(today, "month")) {
      throw new Error("Future month not allowed");
    }

    // 🔴 If current month → limit till today
    const isCurrentMonth =
      today.year() === year && today.month() + 1 === monthNum;

    const lastDay = isCurrentMonth ? today.date() : endDate.date();

    // ─────────── Fetch attendance ───────────
    const attendanceResult = await pool.query(
      `
      SELECT date
      FROM attendance_records
      WHERE user_id = $1
      AND date BETWEEN $2 AND $3
    `,
      [userId, startDate.format("YYYY-MM-DD"), endDate.format("YYYY-MM-DD")]
    );

    // Convert to Set for fast lookup
    const attendanceSet = new Set(
      attendanceResult.rows.map((r) =>
        dayjs(r.date).format("YYYY-MM-DD")
      )
    );

    // ─────────── Fetch leaves ───────────
    const leaveResult = await pool.query(
      `
      SELECT from_date, to_date
      FROM leave_requests
      WHERE user_id = $1
      AND leave_approved = TRUE
      AND from_date <= $3
      AND to_date >= $2
    `,
      [userId, startDate.format("YYYY-MM-DD"), endDate.format("YYYY-MM-DD")]
    );

    // Expand leave dates
    const leaveSet = new Set();

    leaveResult.rows.forEach((leave) => {
      let current = dayjs(leave.from_date);
      const end = dayjs(leave.to_date);

      while (current.isBefore(end) || current.isSame(end)) {
        leaveSet.add(current.format("YYYY-MM-DD"));
        current = current.add(1, "day");
      }
    });

    // ─────────── Build final attendance map ───────────
    const attendanceMap = {};
    const excessResult = await pool.query(
  `
  SELECT excess_leave
  FROM leave_excess_records
  WHERE user_id = $1
    AND month = $2
    AND year  = $3
  ORDER BY created_at DESC
  LIMIT 1
  `,
  [userId, monthNum, year]
);

const excessLeave = excessResult.rows.length > 0
  ? parseFloat(excessResult.rows[0].excess_leave || 0)
  : 0;

    // for (let day = 1; day <= lastDay; day++) {
    //   const currentDate = dayjs(`${month}-${String(day).padStart(2, "0")}`);
    //   const date = currentDate.format("YYYY-MM-DD");

    //   const dayOfWeek = currentDate.day(); // 0 = Sunday, 6 = Saturday

    //   if (dayOfWeek === 6) {
    //     attendanceMap[day] = "SA"; // Saturday
    //   } else if (dayOfWeek === 0) {
    //     attendanceMap[day] = "SU"; // Sunday
    //   } else if (attendanceSet.has(date)) {
    //     attendanceMap[day] = "P";
    //   } else if (leaveSet.has(date)) {
    //     attendanceMap[day] = "L";
    //   } else {
    //     attendanceMap[day] = "A";
    //   }
    // }

      for (let day = 1; day <= lastDay; day++) {
    const currentDate = dayjs(`${month}-${String(day).padStart(2, "0")}`);
    const date        = currentDate.format("YYYY-MM-DD");
    const dayOfWeek   = currentDate.day(); // 0 = Sunday, 6 = Saturday
 
    if (dayOfWeek === 0) {
      // Sunday → off day
      attendanceMap[day] = "SU";
    } else if (leaveSet.has(date)) {
      // Approved leave (works for Mon–Sat equally)
      attendanceMap[day] = "L";
    } else if (attendanceSet.has(date)) {
      // Present (Mon–Sat)
      attendanceMap[day] = "P";
    } else {
      // Absent (Mon–Sat, including Saturday if not present/on leave)
      attendanceMap[day] = "A";
    }
   
  }

    // ─────────── Fetch leave balance for the year ───────────
    const leaveBalance = await LeaveBalance.getBalanceByUserId(userId, year);

    return {
      userId,
      employeeName: user.name,
      employeeEmail: user.email,
      udiseCode: user.udise_code,
      month,
      totalDays: lastDay,
      attendance: attendanceMap,
      totalEarned: leaveBalance ? parseFloat(leaveBalance.total_earned || 0) : 0,
      remainingBalance: leaveBalance ? parseFloat(leaveBalance.remaining_balance || 0) : 0,
      excessLeave,   // ← new
    };
  }

  // ─── Check if user has sufficient leave balance ───────────────────────────
  static async checkLeaveBalance(userId, leaveType, year = new Date().getFullYear()) {
    return await LeaveBalance.checkSufficientBalance(userId, leaveType, year);
  }

  // ─── Approve leave with balance deduction ─────────────────────────────────
  static async approveWithDeduction(leaveId, { reviewerId, status, remarks = null }) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get leave request details
      const leaveResult = await client.query(`
        SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE
      `, [leaveId]);

      if (leaveResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: 'Leave request not found' };
      }

      const leave = leaveResult.rows[0];

      if (leave.status !== 'pending') {
        await client.query('ROLLBACK');
        return { success: false, message: `Leave is already ${leave.status}` };
      }

      // Lazy-credit annual EL if not yet credited this FY
      await LeaveBalance.ensureAnnualCredit(leave.user_id);

      // Update leave status (Principal Layer)
      const updatedLeave = await client.query(`
        UPDATE leave_requests
        SET 
          status = $1, 
          reviewed_by = $2, 
          principal_remarks = $4,
          reviewed_at = NOW(), 
          principal_updated_at = NOW(),
          updated_at = NOW(),
          leave_approved = CASE WHEN $3 = 'approved' AND vtp_status = 'approved' THEN TRUE ELSE FALSE END
        WHERE id = $5
        RETURNING *
      `, [status, reviewerId, status, remarks, leaveId]);

      // Deduct leave balance
      const deductionResult = await LeaveBalance.deductLeave(
        leaveId,
        leave.user_id,
        leave.leave_type,
        reviewerId
      );

      if (!deductionResult.success) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: deductionResult.message,
          deductionFailed: true
        };
      }

      await client.query('COMMIT');

      return {
        success: true,
        message: `Leave approved and ${deductionResult.deductedAmount} EL deducted`,
        leave: updatedLeave.rows[0],
        deduction: deductionResult
      };

    } catch (error) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: error.message,
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  // ─── Get leave request with balance info for principal view ───────────────
  static async getLeaveRequestWithBalance(leaveId) {
    const leaveResult = await pool.query(`
      SELECT
        l.*,
        u.name as user_name,
        u.email,
        v.udise_code,
        v.school_name,
        v.trade,
        r.name as reviewer_name
      FROM leave_requests l
      JOIN users u ON l.user_id = u.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      LEFT JOIN users r ON l.reviewed_by = r.id
      WHERE l.id = $1
    `, [leaveId]);

    if (leaveResult.rows.length === 0) {
      return null;
    }

    const leave = leaveResult.rows[0];

    // Get balance info
    const balance = await LeaveBalance.getBalanceByUserId(leave.user_id);

    // Check if sufficient balance
    const balanceCheck = await LeaveBalance.checkSufficientBalance(
      leave.user_id,
      leave.leave_type
    );

    return {
      ...leave,
      balance: balance,
      balanceCheck: balanceCheck
    };
  }
}

module.exports = Leave;
