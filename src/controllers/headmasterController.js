const bcrypt = require('bcryptjs');
const Headmaster = require('../models/Headmaster');
const Leave = require('../models/Leave');
const { pool } = require('../config/db');

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

// ─── PATCH /api/headmaster/school-time ──────────────────────────────────────────
const updateSchoolTime = async (req, res, next) => {
  try {
    const { udise_code, sch_open_time, sch_close_time } = req.body;

    if (!udise_code || !sch_open_time || !sch_close_time) {
      return res.status(400).json({
        status: 'error',
        message: 'udise_code, sch_open_time, and sch_close_time are required',
      });
    }

    const updateQuery = `
      UPDATE mst_schools
      SET sch_open_time = $1, sch_close_time = $2
      WHERE udise_sch_code = $3
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [sch_open_time, sch_close_time, udise_code]);

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


module.exports = {
  getHeadmaster,
  createHeadmaster,
  updateHeadmaster,
  deleteHeadmaster,
  getByDistrict,
  getByBlock,
  getSchoolLeaves,
  updateSchoolTime,
};
