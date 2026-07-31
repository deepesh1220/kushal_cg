const bcrypt = require('bcryptjs');
const Headmaster = require('../models/Headmaster');
const { pool } = require('../config/db');
const Leave = require('../models/Leave');

// ─── GET  /api/headmaster/:teacher_code ───────────────────────────────────────
const getHeadmaster = async (req, res, next) => {
  try {
    const hm = await Headmaster.findByTeacherCode(req.params.teacher_code);
    if (!hm) return res.status(404).json({ status: 'error', message: 'Headmaster not found' });

    const { password: _p, ...safe } = hm;
    res.json({ status: 'success', data: safe });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/headmaster ─────────────────────────────────────────────────────
const createHeadmaster = async (req, res, next) => {
  try {
    const { teacher_code, password, t_name, email } = req.body;

    if (!teacher_code || !password || !t_name) {
      return res.status(400).json({
        status: 'error',
        message: 'teacher_code, password, and t_name are required',
      });
    }

    if (await Headmaster.teacherCodeExists(teacher_code)) {
      return res.status(409).json({ status: 'error', message: 'teacher_code already exists' });
    }

    if (email && (await Headmaster.emailExists(email))) {
      return res.status(409).json({ status: 'error', message: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const hm = await Headmaster.create({ ...req.body, password: hashed });

    const { password: _p, ...safe } = hm;
    res.status(201).json({ status: 'success', data: safe });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/headmaster/:teacher_code ──────────────────────────────────────
const updateHeadmaster = async (req, res, next) => {
  try {
    const { teacher_code } = req.params;
    const updated = await Headmaster.update(teacher_code, req.body);
    if (!updated) return res.status(404).json({ status: 'error', message: 'Headmaster not found' });

    const { password: _p, ...safe } = updated;
    res.json({ status: 'success', data: safe });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/headmaster/:teacher_code ─────────────────────────────────────
const deleteHeadmaster = async (req, res, next) => {
  try {
    const deleted = await Headmaster.delete(req.params.teacher_code);
    if (!deleted) return res.status(404).json({ status: 'error', message: 'Headmaster not found' });
    res.json({ status: 'success', message: 'Headmaster deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── GET  /api/headmaster/district/:district_id ───────────────────────────────
const getByDistrict = async (req, res, next) => {
  try {
    const list = await Headmaster.findByDistrict(req.params.district_id);
    res.json({ status: 'success', count: list.length, data: list });
  } catch (err) {
    next(err);
  }
};

// ─── GET  /api/headmaster/block/:block_id ─────────────────────────────────────
const getByBlock = async (req, res, next) => {
  try {
    const list = await Headmaster.findByBlock(req.params.block_id);
    res.json({ status: 'success', count: list.length, data: list });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/headmaster/school-time ──────────────────────────────────────────
const updateSchoolTime = async (req, res, next) => {
  try {
    const { udise_code, sch_open_time, sch_close_time } = req.body;
    // Accept both field names: frontend sends grace_time, Postman/legacy sends graceTime
    const graceTime = req.body.grace_time ?? req.body.graceTime;

    if (!udise_code || !sch_open_time || !sch_close_time || graceTime === undefined || graceTime === null) {
      return res.status(400).json({
        status: 'error',
        message: 'udise_code, sch_open_time, sch_close_time, and grace_time are required',
      });
    }

    const updateQuery = `
      UPDATE mst_schools
      SET sch_open_time = $1, sch_close_time = $2, grace_time = $3
      WHERE udise_sch_code = $4
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [sch_open_time, sch_close_time, graceTime, udise_code]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'School not found in mst_schools' });
    }

    // Optional: Keep users table in sync for this headmaster's school
    await pool.query(`
      UPDATE users 
      SET school_open_time = $1, school_close_time = $2 
      WHERE udise_code = $3 AND role_id = (SELECT id FROM roles WHERE name = 'headmaster' LIMIT 1)
    `, [sch_open_time, sch_close_time, udise_code]);

    res.json({ status: 'success', message: 'School timings updated successfully', data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/headmaster/school-time?udise_code=xxx ──────────────────────────
const getSchoolTiming = async (req, res, next) => {
  try {
    const { udise_code } = req.query;

    if (!udise_code) {
      return res.status(400).json({
        status: 'error',
        message: 'udise_code query parameter is required',
      });
    }

    const result = await pool.query(
      `SELECT sch_open_time, sch_close_time, grace_time
         FROM mst_schools
        WHERE udise_sch_code = $1
        LIMIT 1`,
      [udise_code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'School not found' });
    }

    const row = result.rows[0];

    // Normalise → HH:MM (24h) for <input type="time">
    const to24h = (timeStr) => {
      if (!timeStr) return null;
      const str = String(timeStr).trim();
      const hhmmss = str.match(/^(\d{2}):(\d{2})/);
      if (hhmmss) return `${hhmmss[1]}:${hhmmss[2]}`;
      const m12 = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
      if (!m12) return null;
      let h = parseInt(m12[1], 10);
      const min = m12[2];
      const period = m12[3].toLowerCase();
      if (period === 'pm' && h !== 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${min}`;
    };

    return res.status(200).json({
      status: 'success',
      data: {
        startTime: to24h(row.sch_open_time),
        endTime: to24h(row.sch_close_time),
        graceTime: row.grace_time ?? null,
        sch_open_time: row.sch_open_time,
        sch_close_time: row.sch_close_time,
        grace_time: row.grace_time,
      },
    });
  } catch (err) {
    next(err);
  }
};

const getSchoolDetails = async (req, res, next) => {
  try {
    const list = await Headmaster.findSchDetails(req.body.udise_code);
    res.json({ status: 'success', data: list, count: list.length });
  } catch (err) {
    next(err);
  }
};
// ─── GET /api/headmaster/leaves ──────────────────────────────────────────────
// Returns all leave requests of VTs belonging to the headmaster's school.
// Auth: authenticate + authorize('leaves:view') (applied in route)
//
// Query params:
//   status       – pending | approved | rejected  (optional)
//   fromDate     – YYYY-MM-DD  (optional, inclusive)
//   toDate       – YYYY-MM-DD  (optional, inclusive)
//   teacherCode  – VT teacher code  (optional)
//   page         – page number, default 1
//   limit        – records per page, default 20, max 100
const getSchoolLeaves = async (req, res, next) => {
  try {
    // ── 1. Guard: headmaster must be linked to a school ──────────────────────
    const udiseCode = req.user?.udise_code;

    if (!udiseCode) {
      return res.status(400).json({
        success: false,
        message: 'Your account is not linked to a school UDISE code. Contact administrator.',
      });
    }

    // ── 2. Extract & validate query params ───────────────────────────────────
    const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);
    const {
      status,
      fromDate,
      toDate,
      teacherCode,
      page = '1',
      limit = '20',
    } = req.query;

    if (status && !VALID_STATUSES.has(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid status "${status}". Must be one of: pending, approved, rejected.`,
      });
    }

    // Basic date format guard (YYYY-MM-DD)
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (fromDate && !DATE_RE.test(fromDate)) {
      return res.status(400).json({ success: false, message: 'fromDate must be in YYYY-MM-DD format.' });
    }
    if (toDate && !DATE_RE.test(toDate)) {
      return res.status(400).json({ success: false, message: 'toDate must be in YYYY-MM-DD format.' });
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ success: false, message: 'fromDate cannot be after toDate.' });
    }

    // ── 3. Delegate to model ──────────────────────────────────────────────────
    const result = await Leave.getSchoolLeaves(udiseCode, {
      status: status?.toLowerCase() || undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      teacher_code: teacherCode || undefined,
      page,
      limit,
    });

    // ── 4. Return structured response ─────────────────────────────────────────
    return res.status(200).json({
      success: true,
      total: result.total,
      page: result.page,
      limit: result.limit,
      total_pages: result.total_pages,
      data: result.data,
    });
  } catch (err) {
    next(err); // Passed to global error handler in app.js
  }
};

// ─── PATCH /api/headmaster/update-coordinates ─────────────────────────────────
const updateSchoolLatLong = async (req, res, next) => {
  try {
    const { udise_code, latitude, longitude } = req.body;

    if (!udise_code || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        status: 'error',
        message: 'udise_code, latitude, and longitude are required',
      });
    }

    const updateQuery = `
      UPDATE mst_schools
      SET latitude = $1, longitude = $2
      WHERE udise_sch_code = $3
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [latitude, longitude, udise_code]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'School not found in mst_schools' });
    }

    res.json({
      status: 'success',
      message: 'School coordinates updated successfully',
      data: {
        udise_code: result.rows[0].udise_sch_code,
        latitude: result.rows[0].latitude,
        longitude: result.rows[0].longitude,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/headmaster/vt-list ──────────────────────────────────────────
// Returns VTs mapped to the logged-in headmaster's school with optional filtering.
const getVtList = async (req, res, next) => {
  try {
    const udiseCode = req.user.udise_code;
    const { date, vtId } = req.body;

    if (!udiseCode) {
      return res.status(400).json({
        success: false,
        message: 'Your account is not linked to a school UDISE code.',
      });
    }

    const filterDate = date || new Date().toISOString().split('T')[0];
    const params = [udiseCode, filterDate];
    let vtFilter = '';

    if (vtId) {
      params.push(vtId);
      vtFilter = `AND u.id = $3`;
    }

    // Fetch VTs linked to this UDISE code (Registered and Pending)
    const query = `
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.phone,
        u.vt_approval_status,
        u.vtp_approval_status,
        u.principal_updated_at as vt_approval_time,
        u.vtp_updated_at as vtp_approval_time,
        u.is_active,
        ar.status as today_status,
        ar.id as attendance_id,
        ar.date as attendance_date
      FROM users u
      LEFT JOIN attendance_records ar ON ar.user_id = u.id AND ar.date = $2
      WHERE u.udise_code = $1 
      AND u.role_id = (SELECT id FROM roles WHERE name = 'vocational_teacher')
      ${vtFilter}
      ORDER BY u.name ASC;
    `;
    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/headmaster/mark-vt-attendance ──────────────────────────────
// Allows headmaster to mark attendance for VTs in their school.
const markVtAttendance = async (req, res, next) => {
  try {
    const { user_id, date, status, check_in_time, check_out_time, remarks } = req.body;
    const headmasterId = req.user.id;
    const udiseCode = req.user.udise_code;

    if (!udiseCode) {
      return res.status(400).json({
        status: 'error',
        message: 'Your account is not linked to a school UDISE code.',
      });
    }

    if (!user_id || !date || !status) {
      return res.status(400).json({
        status: 'error',
        message: 'vtId, date, and status are required.',
      });
    }

    // ── 1. Map status to DB values ──────────────────────────────────────────
    const statusMap = {
      'present': 'present',
      'absent': 'absent',
      'leave': 'on_leave',
      'onduty': 'od',
      'half-day': 'half_day',
    };
    const dbStatus = statusMap[status.toLowerCase()] || status;

    // ── 2. Verify VT belongs to this Headmaster's school ─────────────────────
    const vtCheck = await pool.query('SELECT udise_code FROM users WHERE id = $1', [user_id]);
    if (vtCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'VT user not found' });
    }

    // Use loose equality for udise_code (could be string vs bigint)
    if (vtCheck.rows[0].udise_code != udiseCode) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized: You can only mark VT status for VTs in your own school.',
      });
    }

    // ── 3. Prepare timestamps ───────────────────────────────────────────────
    // If times are provided as "HH:MM", combine them with the date
    const formatTime = (t) => {
      if (!t) return null;
      if (t.includes('T')) return t; // Already ISO or has date
      return `${date} ${t}`;
    };

    const finalCheckIn = formatTime(check_in_time);
    const finalCheckOut = formatTime(check_out_time);

    // ── 4. Upsert attendance record ─────────────────────────────────────────
    const query = `
      INSERT INTO attendance_records (user_id, date, check_in_time, check_out_time, status, remarks, marked_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, date) DO UPDATE SET
        check_in_time  = COALESCE(EXCLUDED.check_in_time, attendance_records.check_in_time),
        check_out_time = COALESCE(EXCLUDED.check_out_time, attendance_records.check_out_time),
        status         = EXCLUDED.status,
        remarks        = EXCLUDED.remarks,
        marked_by       = EXCLUDED.marked_by,
        updated_at     = NOW()
      RETURNING *;
    `;

    const result = await pool.query(query, [
      user_id,
      date,
      finalCheckIn,
      finalCheckOut,
      dbStatus,
      remarks || null,
      headmasterId,
    ]);

    const record = result.rows[0];

    // ── 5. Calculate working hours for response ──────────────────────────────
    let workingHours = null;
    if (record.check_in_time && record.check_out_time) {
      const start = new Date(record.check_in_time);
      const end = new Date(record.check_out_time);
      if (!isNaN(start) && !isNaN(end)) {
        const diffMs = end - start;
        workingHours = diffMs > 0 ? parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2)) : 0;
      }
    }

    res.status(200).json({
      success: true,
      message: `VT status marked as ${status} successfully.`,
      data: {
        ...record,
        total_working_hour: workingHours,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/headmaster/update-vt-attendance/:id ─────────────────────────
const updateVtAttendance = async (req, res, next) => {
  try {
    const { id } = req.params; // attendanceId
    const { status, check_in_time, check_out_time, remarks } = req.body;
    const headmasterId = req.user.id;
    const udiseCode = req.user.udise_code;

    if (!udiseCode) {
      return res.status(400).json({
        status: 'error',
        message: 'Your account is not linked to a school UDISE code.',
      });
    }

    // ── 1. Find existing record and verify ownership ────────────────────────
    const existingResult = await pool.query(`
      SELECT ar.*, u.udise_code
      FROM attendance_records ar
      JOIN users u ON u.id = ar.user_id
      WHERE ar.id = $1
    `, [id]);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'VT record not found.' });
    }

    const existing = existingResult.rows[0];

    // Use loose equality for udise_code
    if (existing.udise_code != udiseCode) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized: This record belongs to a VT from another school.',
      });
    }

    // ── 2. Prepare updates ──────────────────────────────────────────────────
    let dbStatus = existing.status;
    if (status) {
      const statusMap = {
        'present': 'present',
        'absent': 'absent',
        'leave': 'on_leave',
        'onduty': 'od',
        'half-day': 'half_day',
      };
      dbStatus = statusMap[status.toLowerCase()] || status;
    }

    const formatTime = (t, date) => {
      if (!t) return null;
      if (t.includes('T')) return t;
      return `${date} ${t}`;
    };

    const recordDate = new Date(existing.date).toISOString().split('T')[0];
    const finalCheckIn = check_in_time !== undefined ? formatTime(check_in_time, recordDate) : existing.check_in_time;
    const finalCheckOut = check_out_time !== undefined ? formatTime(check_out_time, recordDate) : existing.check_out_time;

    // ── 3. Execute Update ───────────────────────────────────────────────────
    const updateQuery = `
      UPDATE attendance_records
      SET
        status         = $1,
        check_in_time  = $2,
        check_out_time = $3,
        remarks        = $4,
        marked_by      = $5,
        updated_at     = NOW()
      WHERE id = $6
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [
      dbStatus,
      finalCheckIn,
      finalCheckOut,
      remarks !== undefined ? remarks : existing.remarks,
      headmasterId,
      id
    ]);

    const record = result.rows[0];

    // ── 4. Calculate working hours ──────────────────────────────────────────
    let workingHours = null;
    if (record.check_in_time && record.check_out_time) {
      const start = new Date(record.check_in_time);
      const end = new Date(record.check_out_time);
      if (!isNaN(start) && !isNaN(end)) {
        const diffMs = end - start;
        workingHours = diffMs > 0 ? parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2)) : 0;
      }
    }

    res.json({
      success: true,
      message: 'VT record updated successfully',
      data: {
        ...record,
        total_working_hour: workingHours,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {

  getHeadmaster,
  createHeadmaster,
  updateHeadmaster,
  deleteHeadmaster,
  getByDistrict,
  getByBlock,
  getSchoolLeaves,
  updateSchoolTime,
  getSchoolTiming,
  getSchoolDetails,
  updateSchoolLatLong,
  getVtList,
  markVtAttendance,
  updateVtAttendance,
};
