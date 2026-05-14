const Report = require('../models/Report');
const { sendExcel, sendPDF, sendNSQFPdf } = require('../utils/export.utile');
const { pool } = require('../config/db');
const dayjs = require('dayjs');

// ─── Internal: fetch DEO profile by logged-in user ────────────────────────────
const _getDeoProfile = async (user) => {
  let deo = null;
  if (user.email) {
    const r = await pool.query('SELECT * FROM mst_deo WHERE email = $1 LIMIT 1', [user.email]);
    deo = r.rows[0];
  }
  if (!deo && user.phone) {
    const r = await pool.query('SELECT * FROM mst_deo WHERE mobile = $1 LIMIT 1', [user.phone]);
    deo = r.rows[0];
  }
  return deo;
};

// ─── Internal: get a single monthly_school_reports record ─────────────────────
const _getReportRecord = async (userId, month, year) => {
  const r = await pool.query(
    `SELECT * FROM monthly_school_reports WHERE user_id = $1 AND report_month = $2 AND report_year = $3 LIMIT 1`,
    [userId, month, year]
  );
  return r.rows[0] || null;
};

// ─── Internal: build snapshot JSON from attendance data ───────────────────────
const _buildSnapshotData = async (vtUserId, month, year) => {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  // VT details
  const vtRow = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.udise_code,
            v.vt_name, v.vt_mob, v.vt_email, v.trade, v.vtp_name,
            v.school_name, v.district_name, v.block_name, s.cluster_name
     FROM users u
     LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
     LEFT JOIN mst_schools s ON v.udise_code = s.udise_sch_code
     WHERE u.id = $1 LIMIT 1`,
    [vtUserId]
  );
  const vtDetails = vtRow.rows[0] || {};

  // Attendance data via existing Report model (only processes up to today for current month)
  const reportData = await Report.getMonthlySummaryReport({
    month: monthStr,
    vtUserId,
    page: 1,
    limit: 1,
  });

  const userData = (reportData.data || [])[0] || {};
  const attendanceRaw = userData.attendance || {};

  const totalDays = new Date(year, month, 0).getDate();

  // Determine if this is the current month — future days should be blank, not 'A'
  const today = new Date();
  const isCurrentMonth = (year === today.getFullYear() && month === today.getMonth() + 1);
  const todayDate = today.getDate();

  // Fetch ALL approved leaves for the entire month (includes future dates)
  // so future leave days show 'L' instead of blank
  const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
  const endOfMonth   = `${year}-${String(month).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`;
  const leaveRows = await pool.query(
    `SELECT from_date, to_date FROM leave_requests
     WHERE user_id = $1 AND status = 'approved'
       AND from_date <= $2 AND to_date >= $3`,
    [vtUserId, endOfMonth, startOfMonth]
  );
  const fullMonthLeaveDates = new Set();
  leaveRows.rows.forEach(l => {
    let cur = dayjs(l.from_date);
    const end = dayjs(l.to_date);
    while (!cur.isAfter(end)) {
      fullMonthLeaveDates.add(cur.date());
      cur = cur.add(1, 'day');
    }
  });

  // Normalise attendance map: day -> { status, check_in, check_out, remarks }
  const attendance = {};
  let totalPresent = 0, totalAbsent = 0, totalHolidays = 0, totalSundays = 0, totalLeaves = 0;

  for (let d = 1; d <= totalDays; d++) {
    const isFutureDay = isCurrentMonth && d > todayDate;
    const isSunday    = new Date(year, month - 1, d).getDay() === 0;
    const rec         = attendanceRaw[d] || {};

    let s;
    if (isFutureDay) {
      if (isSunday) {
        s = 'H';                                    // future Sunday → always SUN
      } else if (fullMonthLeaveDates.has(d)) {
        s = 'L';                                    // future approved leave
      } else {
        s = '';                                     // future blank (not absent)
      }
    } else {
      // Past / today: getMonthlySummaryReport already returns 'H' for Sundays,
      // so trust its result; fall back to 'H' for any Sunday missed, else 'A'.
      s = rec.status || (isSunday ? 'H' : 'A');
    }

    attendance[d] = {
      status:    s,
      check_in:  rec.check_in  || null,
      check_out: rec.check_out || null,
      remarks:   rec.remarks   || null,
    };
    if (s === 'P')       totalPresent++;
    else if (s === 'A')  totalAbsent++;
    else if (s === 'GH') totalHolidays++;
    else if (s === 'H')  totalSundays++;
    else if (s === 'L')  totalLeaves++;
    // '' (blank future non-Sunday days) intentionally not counted
  }

  // Dynamic financial year label (April–March cycle)
  const fyStartYear = month >= 4 ? year : year - 1;
  const fyLabel = `April ${fyStartYear} to March ${fyStartYear + 1}`;

  // Full leave balance for this calendar year
  const lb = await pool.query(
    `SELECT opening_balance, total_earned, total_used, remaining_balance, carried_forward
     FROM leave_balance WHERE user_id = $1 AND year = $2 LIMIT 1`,
    [vtUserId, year]
  );
  const leaveBalance = lb.rows[0] || {};

  // Excess leave accumulated this year
  const excessRow = await pool.query(
    `SELECT COALESCE(SUM(excess_leave), 0) AS total_excess
     FROM leave_excess_records WHERE user_id = $1 AND year = $2`,
    [vtUserId, year]
  );
  const excessLeave = parseFloat(excessRow.rows[0]?.total_excess || 0);

  return {
    vtDetails: {
      vt_name:       vtDetails.vt_name       || vtDetails.name  || '',
      vt_mob:        vtDetails.vt_mob        || vtDetails.phone || '',
      trade:         vtDetails.trade         || '',
      vtp_name:      vtDetails.vtp_name      || '',
      school_name:   vtDetails.school_name   || '',
      district_name: vtDetails.district_name || '',
      block_name:    vtDetails.block_name    || '',
    },
    attendance,
    summary: { totalPresent, totalAbsent, totalHolidays, totalSundays, totalLeaves },
    leaveDetails: {
      fyLabel,
      annualEntitlement: 12,
      totalEarned:       parseFloat(leaveBalance.total_earned       || 0),
      leavesTaken:       parseFloat(leaveBalance.total_used         || 0),
      remainingLeave:    parseFloat(leaveBalance.remaining_balance  || 0),
      carriedForward:    parseFloat(leaveBalance.carried_forward    || 0),
      excessLeaveTaken:  excessLeave,
    },
    month,
    year,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/reports/generate-monthly-vt-report
// Generate (or regenerate) an attendance snapshot for a given VT + month/year.
// Auth: headmaster (own school only) or admin/super_admin.
// ═══════════════════════════════════════════════════════════════════════════════
const generateMonthlyVtReport = async (req, res) => {
  try {
    const { user_id, month, year } = req.body;

    if (!user_id || !month || !year) {
      return res.status(400).json({ status: false, message: 'user_id, month, and year are required.' });
    }

    const monthInt = parseInt(month, 10);
    const yearInt  = parseInt(year, 10);

    if (monthInt < 1 || monthInt > 12) {
      return res.status(400).json({ status: false, message: 'month must be 1–12.' });
    }
    const now = new Date();
    if (yearInt > now.getFullYear() || (yearInt === now.getFullYear() && monthInt > now.getMonth() + 1)) {
      return res.status(400).json({ status: false, message: 'Future month not allowed.' });
    }

    // Role-based scope check
    const roleName = req.user.role_name;
    if (!['headmaster', 'admin', 'super_admin'].includes(roleName)) {
      return res.status(403).json({ status: false, message: 'Only headmaster or admin can generate reports.' });
    }

    if (roleName === 'headmaster') {
      const hmUdise = req.user.udise_code;
      if (!hmUdise) {
        return res.status(400).json({ status: false, message: 'Your account has no school UDISE linked.' });
      }
      const check = await pool.query(
        `SELECT u.id FROM users u
         JOIN vt_staff_details v ON v.id = u.vt_staff_id
         WHERE u.id = $1 AND v.udise_code = $2 LIMIT 1`,
        [user_id, hmUdise]
      );
      if (!check.rows.length) {
        return res.status(403).json({ status: false, message: 'VT does not belong to your school.' });
      }
    }

    // Check if report is already locked (all approvals done)
    const existingReport = await _getReportRecord(user_id, monthInt, yearInt);
    if (existingReport?.is_locked) {
      return res.status(400).json({ status: false, message: 'Report is locked after full approval and cannot be regenerated.' });
    }

    // Build snapshot
    const snapshotData = await _buildSnapshotData(user_id, monthInt, yearInt);

    // Get UDISE for this VT
    const vtRow = await pool.query('SELECT udise_code FROM users WHERE id = $1 LIMIT 1', [user_id]);
    const udiseCode = vtRow.rows[0]?.udise_code;

    const client = await pool.connect();
    let reportId, snapshotId;
    try {
      await client.query('BEGIN');

      // Upsert monthly_school_reports
      const rptResult = await client.query(
        `INSERT INTO monthly_school_reports
           (udise_code, user_id, report_month, report_year,
            hm_approval_status, deo_approval_status, vtp_approval_status,
            updated_at)
         VALUES ($1, $2, $3, $4, 'pending', 'pending', 'pending', NOW())
         ON CONFLICT (user_id, report_month, report_year)
         DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [udiseCode, user_id, monthInt, yearInt]
      );
      reportId = rptResult.rows[0].id;

      // Upsert snapshot
      const snapResult = await client.query(
        `INSERT INTO monthly_report_snapshots
           (report_id, user_id, month, year, snapshot_data, generated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, month, year)
         DO UPDATE SET snapshot_data = EXCLUDED.snapshot_data,
                       generated_at  = NOW(),
                       report_id     = EXCLUDED.report_id
         RETURNING id`,
        [reportId, user_id, monthInt, yearInt, JSON.stringify(snapshotData)]
      );
      snapshotId = snapResult.rows[0].id;

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return res.status(200).json({
      status: true,
      message: 'Monthly report generated successfully.',
      data: { report_id: reportId, snapshot_id: snapshotId },
    });
  } catch (err) {
    console.error('generateMonthlyVtReport error:', err.message);
    return res.status(500).json({ status: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/reports/download-vt-pdf?user_id=&month=&year=
// Stream NSQF PDF for given VT + month. Uses snapshot if available, otherwise
// generates on-the-fly from live attendance data (read-only, no DB write).
// Auth: role-scoped (headmaster=own school, deo=own district, vtp=own VTP)
// ═══════════════════════════════════════════════════════════════════════════════
const downloadVtMonthlyReportPdf = async (req, res) => {
  try {
    const { user_id, month, year } = req.query;

    if (!user_id || !month || !year) {
      return res.status(400).json({ status: false, message: 'user_id, month, and year are required.' });
    }

    const monthInt = parseInt(month, 10);
    const yearInt  = parseInt(year, 10);
    const roleName = req.user.role_name;

    // Role-based access check
    if (roleName === 'headmaster') {
      const hmUdise = req.user.udise_code;
      const check = await pool.query(
        `SELECT u.id FROM users u JOIN vt_staff_details v ON v.id = u.vt_staff_id
         WHERE u.id = $1 AND v.udise_code = $2 LIMIT 1`,
        [user_id, hmUdise]
      );
      if (!check.rows.length) {
        return res.status(403).json({ status: false, message: 'Unauthorized: VT not in your school.' });
      }
    } else if (roleName === 'deo') {
      const deo = await _getDeoProfile(req.user);
      if (!deo) return res.status(403).json({ status: false, message: 'DEO profile not found.' });
      const check = await pool.query(
        `SELECT u.id FROM users u
         JOIN vt_staff_details v ON v.id = u.vt_staff_id
         JOIN mst_schools s ON s.udise_sch_code = v.udise_code
         WHERE u.id = $1 AND s.district_cd = $2 LIMIT 1`,
        [user_id, deo.district_cd]
      );
      if (!check.rows.length) {
        return res.status(403).json({ status: false, message: 'Unauthorized: VT not in your district.' });
      }
    } else if (roleName === 'vocational_teacher_provider') {
      const vtpId = req.user.vtp_id;
      if (vtpId) {
        const check = await pool.query(
          `SELECT u.id FROM users u
           JOIN vt_staff_details v ON v.id = u.vt_staff_id
           WHERE u.id = $1 AND v.vtp_id = $2 LIMIT 1`,
          [user_id, vtpId]
        );
        if (!check.rows.length) {
          return res.status(403).json({ status: false, message: 'Unauthorized: VT not in your VTP.' });
        }
      }
    }

    // Try to use stored snapshot first
    const snapRow = await pool.query(
      `SELECT snapshot_data FROM monthly_report_snapshots
       WHERE user_id = $1 AND month = $2 AND year = $3 LIMIT 1`,
      [user_id, monthInt, yearInt]
    );

    let snapshotData;
    if (snapRow.rows.length) {
      snapshotData = snapRow.rows[0].snapshot_data;
    } else {
      // Generate on-the-fly from live data
      snapshotData = await _buildSnapshotData(user_id, monthInt, yearInt);
    }

    // Enrich with approval data
    const approvalRow = await pool.query(
      `SELECT hm_approval_status, hm_approved_at,
              deo_approval_status, deo_approved_at,
              vtp_approval_status, vtp_approved_at
       FROM monthly_school_reports
       WHERE user_id = $1 AND report_month = $2 AND report_year = $3 LIMIT 1`,
      [user_id, monthInt, yearInt]
    );
    const ar = approvalRow.rows[0] || {};
    snapshotData.approvals = {
      hm:  { status: ar.hm_approval_status  || 'pending', approvedAt: ar.hm_approved_at  || null },
      deo: { status: ar.deo_approval_status || 'pending', approvedAt: ar.deo_approved_at || null },
      vtp: { status: ar.vtp_approval_status || 'pending', approvedAt: ar.vtp_approved_at || null },
    };

    return sendNSQFPdf(snapshotData, res);
  } catch (err) {
    console.error('downloadVtMonthlyReportPdf error:', err.message);
    return res.status(500).json({ status: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/reports/monthly-vt-reports
// Query: month, year, udise_code, vtp_id, block_name, district_cd, status, page, limit
// Role-scoped list of monthly reports with VT details + all approval statuses.
// ═══════════════════════════════════════════════════════════════════════════════
const getMonthlyVtReportsList = async (req, res) => {
  try {
    const {
      month, year, udise_code, vtp_id, block_name,
      district_cd, block_cd, cluster_cd,
      status,
      page = 1, limit = 20,
    } = req.query;

    const roleName  = req.user.role_name;
    const monthInt  = month ? parseInt(month, 10)  : new Date().getMonth() + 1;
    const yearInt   = year  ? parseInt(year, 10)   : new Date().getFullYear();
    const pageNum   = parseInt(page, 10);
    const limitNum  = parseInt(limit, 10);
    const offsetNum = (pageNum - 1) * limitNum;

    let queryArgs = [monthInt, yearInt];
    let whereClauses = [];

    // Role-based scoping
    if (roleName === 'headmaster') {
      const hmUdise = req.user.udise_code;
      if (!hmUdise) {
        return res.status(400).json({ status: false, message: 'Account not linked to a school UDISE.' });
      }
      queryArgs.push(hmUdise);
      whereClauses.push(`v.udise_code = $${queryArgs.length}`);
    } else if (roleName === 'deo') {
      const deo = await _getDeoProfile(req.user);
      if (!deo) return res.status(403).json({ status: false, message: 'DEO profile not found.' });
      queryArgs.push(deo.district_cd);
      whereClauses.push(`s.district_cd = $${queryArgs.length}`);
    } else if (roleName === 'vocational_teacher_provider') {
      const vtpId = req.user.vtp_id;
      if (vtpId) {
        queryArgs.push(vtpId);
        whereClauses.push(`v.vtp_id = $${queryArgs.length}`);
      } else {
        // Fallback: scope by organization_name
        const orgName = req.user.organization_name;
        if (orgName) {
          queryArgs.push(orgName);
          whereClauses.push(`v.vtp_name = $${queryArgs.length}`);
        }
      }
    }
    // admin / super_admin: no scope restriction

    // Optional filters
    if (udise_code)  { queryArgs.push(udise_code);         whereClauses.push(`v.udise_code = $${queryArgs.length}`); }
    if (vtp_id)      { queryArgs.push(vtp_id);             whereClauses.push(`v.vtp_id = $${queryArgs.length}`);    }
    if (block_name)  { queryArgs.push(`%${block_name}%`); whereClauses.push(`v.block_name ILIKE $${queryArgs.length}`); }
    // Location hierarchy filters (use mst_schools join which is already in baseQuery)
    if (district_cd) { queryArgs.push(parseInt(district_cd, 10)); whereClauses.push(`s.district_cd = $${queryArgs.length}`); }
    if (block_cd)    { queryArgs.push(parseInt(block_cd, 10));    whereClauses.push(`s.block_cd = $${queryArgs.length}`);    }
    if (cluster_cd)  { queryArgs.push(parseInt(cluster_cd, 10));  whereClauses.push(`s.cluster_cd = $${queryArgs.length}`);  }

    // Status filter maps to role-relevant column
    let statusCol = 'hm_approval_status';
    if (roleName === 'deo') statusCol = 'deo_approval_status';
    else if (roleName === 'vocational_teacher_provider') statusCol = 'vtp_approval_status';

    if (status && status !== 'all') {
      if (status === 'pending_my_action') {
        if (roleName === 'deo') {
          whereClauses.push(`COALESCE(msr.hm_approval_status,'pending') = 'approved' AND COALESCE(msr.deo_approval_status,'pending') = 'pending'`);
        } else if (roleName === 'vocational_teacher_provider') {
          whereClauses.push(`COALESCE(msr.hm_approval_status,'pending') = 'approved' AND COALESCE(msr.deo_approval_status,'pending') = 'approved' AND COALESCE(msr.vtp_approval_status,'pending') = 'pending'`);
        } else {
          whereClauses.push(`COALESCE(msr.hm_approval_status,'pending') = 'pending'`);
        }
      } else {
        queryArgs.push(status);
        whereClauses.push(`COALESCE(msr.${statusCol},'pending') = $${queryArgs.length}`);
      }
    }

    const whereStr = whereClauses.length ? `AND ${whereClauses.join(' AND ')}` : '';

    const baseQuery = `
      FROM users u
      JOIN roles r ON u.role_id = r.id AND r.name = 'vocational_teacher'
      JOIN vt_staff_details v ON v.id = u.vt_staff_id
      LEFT JOIN mst_schools s ON s.udise_sch_code = v.udise_code
      LEFT JOIN monthly_school_reports msr
        ON msr.user_id = u.id AND msr.report_month = $1 AND msr.report_year = $2
      LEFT JOIN monthly_report_snapshots snap
        ON snap.user_id = u.id AND snap.month = $1 AND snap.year = $2
      WHERE u.is_active = TRUE
      ${whereStr}
    `;

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, queryArgs);
    const totalItems = parseInt(countResult.rows[0].count, 10);

    queryArgs.push(limitNum, offsetNum);
    const dataResult = await pool.query(
      `SELECT
         u.id AS user_id,
         v.vt_name, v.vt_mob, v.trade, v.vtp_name, v.vtp_id,
         v.school_name, v.district_name, v.block_name, v.udise_code,
         $1::int AS report_month, $2::int AS report_year,
         msr.id AS report_id,
         COALESCE(msr.hm_approval_status,  'pending') AS hm_approval_status,
         COALESCE(msr.deo_approval_status, 'pending') AS deo_approval_status,
         COALESCE(msr.vtp_approval_status, 'pending') AS vtp_approval_status,
         msr.hm_remarks, msr.deo_remarks, msr.vtp_remarks,
         msr.hm_approved_at, msr.deo_approved_at, msr.vtp_approved_at,
         msr.is_locked,
         (snap.id IS NOT NULL) AS has_snapshot
       ${baseQuery}
       ORDER BY v.school_name ASC, v.vt_name ASC
       LIMIT $${queryArgs.length - 1} OFFSET $${queryArgs.length}`,
      queryArgs
    );

    return res.status(200).json({
      status: true,
      month: monthInt,
      year: yearInt,
      pagination: {
        totalItems,
        totalPages: Math.ceil(totalItems / limitNum),
        currentPage: pageNum,
        limit: limitNum,
      },
      data: dataResult.rows,
    });
  } catch (err) {
    console.error('getMonthlyVtReportsList error:', err.message);
    return res.status(500).json({ status: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/reports/dashboard-pending-counts?month=&year=
// Returns role-scoped counts for the pending-action dashboard widget.
// ═══════════════════════════════════════════════════════════════════════════════
const getDashboardPendingCounts = async (req, res) => {
  try {
    const { month, year } = req.query;
    const monthInt = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    const yearInt  = year  ? parseInt(year, 10)  : new Date().getFullYear();
    const roleName = req.user.role_name;

    let scopeWhere = '';
    let queryArgs  = [monthInt, yearInt];

    if (roleName === 'headmaster') {
      const hmUdise = req.user.udise_code;
      if (hmUdise) { queryArgs.push(hmUdise); scopeWhere = `AND v.udise_code = $${queryArgs.length}`; }
    } else if (roleName === 'deo') {
      const deo = await _getDeoProfile(req.user);
      if (deo) { queryArgs.push(deo.district_cd); scopeWhere = `AND s.district_cd = $${queryArgs.length}`; }
    } else if (roleName === 'vocational_teacher_provider') {
      const vtpId = req.user.vtp_id;
      if (vtpId) { queryArgs.push(vtpId); scopeWhere = `AND v.vtp_id = $${queryArgs.length}`; }
    }

    const baseJoin = `
      FROM users u
      JOIN roles r ON u.role_id = r.id AND r.name = 'vocational_teacher'
      JOIN vt_staff_details v ON v.id = u.vt_staff_id
      LEFT JOIN mst_schools s ON s.udise_sch_code = v.udise_code
      LEFT JOIN monthly_school_reports msr
        ON msr.user_id = u.id AND msr.report_month = $1 AND msr.report_year = $2
      WHERE u.is_active = TRUE ${scopeWhere}
    `;

    let pendingCondition, approvedCondition, rejectedCondition;

    if (roleName === 'deo') {
      pendingCondition  = `COALESCE(msr.hm_approval_status,'pending') = 'approved' AND COALESCE(msr.deo_approval_status,'pending') = 'pending'`;
      approvedCondition = `COALESCE(msr.deo_approval_status,'pending') = 'approved'`;
      rejectedCondition = `COALESCE(msr.deo_approval_status,'pending') = 'rejected'`;
    } else if (roleName === 'vocational_teacher_provider') {
      pendingCondition  = `COALESCE(msr.hm_approval_status,'pending') = 'approved' AND COALESCE(msr.deo_approval_status,'pending') = 'approved' AND COALESCE(msr.vtp_approval_status,'pending') = 'pending'`;
      approvedCondition = `COALESCE(msr.vtp_approval_status,'pending') = 'approved'`;
      rejectedCondition = `COALESCE(msr.vtp_approval_status,'pending') = 'rejected'`;
    } else {
      // headmaster / admin
      pendingCondition  = `COALESCE(msr.hm_approval_status,'pending') = 'pending'`;
      approvedCondition = `COALESCE(msr.hm_approval_status,'pending') = 'approved'`;
      rejectedCondition = `COALESCE(msr.hm_approval_status,'pending') = 'rejected'`;
    }

    const [total, pending, approved, rejected] = await Promise.all([
      pool.query(`SELECT COUNT(*) ${baseJoin}`, queryArgs),
      pool.query(`SELECT COUNT(*) ${baseJoin} AND (${pendingCondition})`, queryArgs),
      pool.query(`SELECT COUNT(*) ${baseJoin} AND (${approvedCondition})`, queryArgs),
      pool.query(`SELECT COUNT(*) ${baseJoin} AND (${rejectedCondition})`, queryArgs),
    ]);

    return res.status(200).json({
      status: true,
      data: {
        total:             parseInt(total.rows[0].count, 10),
        pending_my_action: parseInt(pending.rows[0].count, 10),
        approved:          parseInt(approved.rows[0].count, 10),
        rejected:          parseInt(rejected.rows[0].count, 10),
        month: monthInt,
        year:  yearInt,
      },
    });
  } catch (err) {
    console.error('getDashboardPendingCounts error:', err.message);
    return res.status(500).json({ status: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/reports/approve
// Approve or reject a monthly report.
// Enhanced: sequential enforcement + audit trail (approved_by, approved_at).
// ═══════════════════════════════════════════════════════════════════════════════
const approveMonthlyReport = async (req, res) => {
  try {
    const { udise_code, vtUserId, month, year, status, remarks } = req.body;

    // Resolve role name
    let role_name = req.user.role_name;
    if (!role_name && req.user.role_id) {
      const roleResult = await pool.query('SELECT name FROM roles WHERE id = $1', [req.user.role_id]);
      if (roleResult.rows.length > 0) role_name = roleResult.rows[0].name;
    }

    if (!month || !year || !status) {
      return res.status(400).json({ status: false, message: 'month, year, and status are required.' });
    }
    if (!udise_code && !vtUserId) {
      return res.status(400).json({ status: false, message: 'Either udise_code or vtUserId must be provided.' });
    }
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ status: false, message: 'Invalid status. Must be approved, rejected, or pending.' });
    }

    // Map role → DB columns
    let statusCol, remarksCol, approvedByCol, approvedAtCol;
    if (role_name === 'headmaster') {
      statusCol = 'hm_approval_status';  remarksCol = 'hm_remarks';
      approvedByCol = 'hm_approved_by';  approvedAtCol = 'hm_approved_at';
    } else if (role_name === 'vocational_teacher_provider' || role_name === 'vtp') {
      statusCol = 'vtp_approval_status'; remarksCol = 'vtp_remarks';
      approvedByCol = 'vtp_approved_by'; approvedAtCol = 'vtp_approved_at';
    } else if (role_name === 'deo') {
      statusCol = 'deo_approval_status'; remarksCol = 'deo_remarks';
      approvedByCol = 'deo_approved_by'; approvedAtCol = 'deo_approved_at';
    } else if (['admin', 'super_admin'].includes(role_name)) {
      // Admin must specify which layer via an optional 'layer' body field
      const layer = req.body.layer || 'hm';
      if (layer === 'deo') {
        statusCol = 'deo_approval_status'; remarksCol = 'deo_remarks';
        approvedByCol = 'deo_approved_by'; approvedAtCol = 'deo_approved_at';
      } else if (layer === 'vtp') {
        statusCol = 'vtp_approval_status'; remarksCol = 'vtp_remarks';
        approvedByCol = 'vtp_approved_by'; approvedAtCol = 'vtp_approved_at';
      } else {
        statusCol = 'hm_approval_status';  remarksCol = 'hm_remarks';
        approvedByCol = 'hm_approved_by';  approvedAtCol = 'hm_approved_at';
      }
    } else {
      return res.status(403).json({ status: false, message: `Role '${role_name}' is not authorized to approve monthly reports.` });
    }

    // Resolve user IDs to approve
    let userIdsToApprove = [];
    let queryUdiseCode   = udise_code;

    if (vtUserId) {
      userIdsToApprove.push(vtUserId);
      if (!udise_code) {
        const ur = await pool.query('SELECT udise_code FROM users WHERE id = $1', [vtUserId]);
        if (!ur.rows.length) return res.status(404).json({ status: false, message: 'VT user not found.' });
        queryUdiseCode = ur.rows[0].udise_code;
      }
    } else if (udise_code) {
      const ur = await pool.query(
        `SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id
         WHERE u.udise_code = $1 AND r.name = 'vocational_teacher'`,
        [udise_code]
      );
      userIdsToApprove = ur.rows.map(r => r.id);
      if (!userIdsToApprove.length) {
        return res.status(404).json({ status: false, message: 'No VTs found for this school.' });
      }
    }

    const processedUsers = [];
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const uid of userIdsToApprove) {
        // ── Sequential enforcement ───────────────────────────────────────────
        const existing = await client.query(
          `SELECT hm_approval_status, deo_approval_status, vtp_approval_status, is_locked
           FROM monthly_school_reports WHERE user_id = $1 AND report_month = $2 AND report_year = $3`,
          [uid, month, year]
        );
        const rec = existing.rows[0];

        if (rec?.is_locked && status === 'approved') {
          processedUsers.push({ user_id: uid, skipped: true, reason: 'Report already fully approved and locked.' });
          continue;
        }

        if (role_name === 'deo' && rec?.hm_approval_status !== 'approved') {
          await client.query('ROLLBACK');
          return res.status(400).json({
            status: false,
            message: `Report for user ${uid} has not been approved by Principal/HM yet.`,
          });
        }

        if ((role_name === 'vocational_teacher_provider' || role_name === 'vtp')) {
          if (rec?.hm_approval_status !== 'approved') {
            await client.query('ROLLBACK');
            return res.status(400).json({ status: false, message: 'Not approved by Principal/HM yet.' });
          }
          if (rec?.deo_approval_status !== 'approved') {
            await client.query('ROLLBACK');
            return res.status(400).json({ status: false, message: 'Not approved by DEO yet.' });
          }
        }

        // ── Upsert report record ──────────────────────────────────────────────
        if (!rec) {
          const ins = await client.query(
            `INSERT INTO monthly_school_reports
               (udise_code, user_id, report_month, report_year,
                ${statusCol}, ${remarksCol}, ${approvedByCol}, ${approvedAtCol}, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *`,
            [queryUdiseCode, uid, month, year, status, remarks || '', req.user.id]
          );
          processedUsers.push(ins.rows[0]);
        } else {
          // Determine if all approvals are now done (after this update)
          const newHm  = statusCol === 'hm_approval_status'  ? status : rec.hm_approval_status;
          const newDeo = statusCol === 'deo_approval_status' ? status : rec.deo_approval_status;
          const newVtp = statusCol === 'vtp_approval_status' ? status : rec.vtp_approval_status;
          const nowLocked = (newHm === 'approved' && newDeo === 'approved' && newVtp === 'approved');

          const upd = await client.query(
            `UPDATE monthly_school_reports
             SET ${statusCol}    = $1,
                 ${remarksCol}   = $2,
                 ${approvedByCol}= $3,
                 ${approvedAtCol}= NOW(),
                 is_locked       = $4,
                 updated_at      = NOW()
             WHERE user_id = $5 AND report_month = $6 AND report_year = $7
             RETURNING *`,
            [status, remarks || '', req.user.id, nowLocked, uid, month, year]
          );
          processedUsers.push(upd.rows[0]);
        }
      }

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    return res.status(200).json({
      status: true,
      message: 'Monthly report(s) updated successfully.',
      data: processedUsers,
    });
  } catch (error) {
    console.error('approveMonthlyReport error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error updating report approval.' });
  }
};

// ─── Existing functions (unchanged) ──────────────────────────────────────────

const downloadMonthlyAttendance = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = req.query.month || req.body.month || currentMonth;
    const { format } = req.query;

    if (!format) {
      return res.status(400).json({ success: false, message: 'format is required' });
    }

    const report = await Report.getAttendanceReport(userId, month);

    if (format === 'excel') return sendExcel(report, res);
    if (format === 'pdf')   return sendPDF(report, res);

    return res.status(400).json({ success: false, message: 'Invalid format' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const { month, udise_code, vtUserId, page, limit } = req.query;

    if (!month) {
      return res.status(400).json({ success: false, message: 'month is required in YYYY-MM format' });
    }

    const filters = {
      month,
      udise_code,
      vtUserId,
      page:  page  ? parseInt(page, 10)  : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    };

    const report = await Report.getMonthlySummaryReport(filters);
    return res.status(200).json({ success: true, data: report.data, pagination: report.pagination });
  } catch (err) {
    console.error('getMonthlySummary Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/reports/location-master?type=districts|blocks|clusters&district_cd=&block_cd=
// Cascading location dropdowns for filter panels.
// type=districts → all districts
// type=blocks    → blocks for a district_cd
// type=clusters  → clusters for a district_cd + block_cd
// ═══════════════════════════════════════════════════════════════════════════════
const getLocationMasterData = async (req, res) => {
  try {
    const { type, district_cd, block_cd } = req.query;

    if (type === 'districts') {
      const r = await pool.query(
        `SELECT district_cd, district_name FROM mst_districts ORDER BY district_name ASC`
      );
      return res.status(200).json({ status: true, data: r.rows });
    }

    if (type === 'blocks') {
      if (!district_cd) {
        return res.status(400).json({ status: false, message: 'district_cd is required for blocks.' });
      }
      const r = await pool.query(
        `SELECT block_cd, block_name FROM mst_block WHERE district_cd = $1 ORDER BY block_name ASC`,
        [parseInt(district_cd, 10)]
      );
      return res.status(200).json({ status: true, data: r.rows });
    }

    if (type === 'clusters') {
      if (!district_cd || !block_cd) {
        return res.status(400).json({ status: false, message: 'district_cd and block_cd are required for clusters.' });
      }
      const r = await pool.query(
        `SELECT cluster_cd, cluster_name FROM mst_cluster WHERE district_cd = $1 AND block_cd = $2 ORDER BY cluster_name ASC`,
        [parseInt(district_cd, 10), parseInt(block_cd, 10)]
      );
      return res.status(200).json({ status: true, data: r.rows });
    }

    return res.status(400).json({ status: false, message: 'type must be districts, blocks, or clusters.' });
  } catch (err) {
    console.error('getLocationMasterData error:', err.message);
    return res.status(500).json({ status: false, message: err.message });
  }
};

module.exports = {
  downloadMonthlyAttendance,
  getMonthlySummary,
  approveMonthlyReport,
  generateMonthlyVtReport,
  downloadVtMonthlyReportPdf,
  getMonthlyVtReportsList,
  getDashboardPendingCounts,
  getLocationMasterData,
};
