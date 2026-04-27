const Attendance = require('../models/Attendance');

// Haversine formula to calculate distance in meters
const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth radius in meters
  const toRadians = (deg) => deg * (Math.PI / 180);
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// ─── POST /api/attendance/check-in ───────────────────────────────────────────
// VT marks their own attendance
const checkIn = async (req, res) => {
  const userId = req.user.id;
  const { latitude, longitude, remarks } = req.body;

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    // Prevent duplicate check-in for today
    const existing = await Attendance.findByUserAndDate(userId, today);
    if (existing) {
      return res.status(409).json({
        status: false,
        message: `Attendance already marked for today (${today}). Status: ${existing.status}`,
        data: existing,
      });
    }

    // ── Get School Times & Location ─────────────────────────────────────
    const { pool } = require('../config/db');
    const vtRecord = await pool.query(`
      SELECT v.udise_code
      FROM users u
      JOIN vt_staff_details v ON u.vt_staff_id = v.id
      WHERE u.id = $1
    `, [userId]);
    const udiseCode = vtRecord.rows[0]?.udise_code;

    if (udiseCode) {
      // 1. Verify Distance using mst_schools
      if (latitude && longitude) {
        const schoolRecord = await pool.query(`
          SELECT latitude, longitude
          FROM mst_schools
          WHERE udise_sch_code = $1
          LIMIT 1
        `, [udiseCode]);

        const schoolLat = schoolRecord.rows[0]?.latitude;
        const schoolLon = schoolRecord.rows[0]?.longitude;

        if (schoolLat && schoolLon) {
          const distance = getDistanceInMeters(
            parseFloat(latitude),
            parseFloat(longitude),
            parseFloat(schoolLat),
            parseFloat(schoolLon)
          );

          if (distance > 300) {
            return res.status(403).json({
              status: false,
              message: `Check-in restricted. You are ${Math.round(distance)} meters away from the school. You must be within 300 meters.`
            });
          }
        }
      }

      // 2. Verify School Timings from Headmaster
      const hmRecord = await pool.query(`
        SELECT school_open_time, school_close_time 
        FROM users 
        WHERE udise_code = $1 
          AND role_id = (SELECT id FROM roles WHERE name = 'headmaster' LIMIT 1)
        LIMIT 1
      `, [udiseCode]);

      const hm = hmRecord.rows[0];
      if (hm && hm.school_open_time && hm.school_close_time) {
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const [openH, openM] = hm.school_open_time.split(':').map(Number);
        const [closeH, closeM] = hm.school_close_time.split(':').map(Number);
        const openTotalMins = openH * 60 + openM;
        const closeTotalMins = closeH * 60 + closeM;

        // Allow check-in up to 60 mins early, but block if too early or if after close time
        if (currentMins < openTotalMins - 60) {
          return res.status(403).json({
            status: false,
            message: `Too early to check in. School opens at ${hm.school_open_time}.`
          });
        }
        if (currentMins > closeTotalMins) {
          return res.status(403).json({
            status: false,
            message: `School is already closed (${hm.school_close_time}). Check-in not allowed.`
          });
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const record = await Attendance.create({
      user_id: userId,
      date: today,
      check_in_time: new Date(),
      status: 'present',
      latitude,
      longitude,
      remarks,
      marked_by: userId,
    });

    return res.status(201).json({
      status: true,
      message: 'Check-in successful.',
      data: record,
    });
  } catch (error) {
    console.error('Check-in error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── PATCH /api/attendance/check-out ─────────────────────────────────────────
// VT marks their check-out
const checkOut = async (req, res) => {
  const userId = req.user.id;
  const { latitude, longitude } = req.body;
  const today = new Date().toISOString().split('T')[0];

  try {
    const existing = await Attendance.findByUserAndDate(userId, today);

    if (!existing) {
      return res.status(404).json({
        status: false,
        message: 'No check-in record found for today. Please check-in first.',
      });
    }

    if (existing.check_out_time) {
      return res.status(409).json({
        status: false,
        message: 'You have already checked out today.',
        data: existing,
      });
    }

    // ── Get School Times & Location ─────────────────────────────────────
    const { pool } = require('../config/db');
    const vtRecord = await pool.query(`
      SELECT v.udise_code
      FROM users u
      JOIN vt_staff_details v ON u.vt_staff_id = v.id
      WHERE u.id = $1
    `, [userId]);
    const udiseCode = vtRecord.rows[0]?.udise_code;

    if (udiseCode) {
      // 1. Verify Distance using mst_schools
      if (latitude && longitude) {
        const schoolRecord = await pool.query(`
          SELECT latitude, longitude
          FROM mst_schools
          WHERE udise_sch_code = $1
          LIMIT 1
        `, [udiseCode]);

        const schoolLat = schoolRecord.rows[0]?.latitude;
        const schoolLon = schoolRecord.rows[0]?.longitude;

        if (schoolLat && schoolLon) {
          const distance = getDistanceInMeters(
            parseFloat(latitude),
            parseFloat(longitude),
            parseFloat(schoolLat),
            parseFloat(schoolLon)
          );

          if (distance > 300) {
            return res.status(403).json({
              status: false,
              message: `Check-out restricted. You are ${Math.round(distance)} meters away from the school. You must be within 300 meters.`
            });
          }
        }
      }

      // 2. Verify School Timings from Headmaster
      const hmRecord = await pool.query(`
        SELECT school_open_time, school_close_time 
        FROM users 
        WHERE udise_code = $1 
          AND role_id = (SELECT id FROM roles WHERE name = 'headmaster' LIMIT 1)
        LIMIT 1
      `, [udiseCode]);

      const hm = hmRecord.rows[0];
      if (hm && hm.school_open_time && hm.school_close_time) {
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const [openH, openM] = hm.school_open_time.split(':').map(Number);
        const openTotalMins = openH * 60 + openM;

        // Block check-out if it's before the school has even opened
        if (currentMins < openTotalMins) {
          return res.status(403).json({
            status: false,
            message: `Cannot check-out before school open time (${hm.school_open_time}).`
          });
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const updated = await Attendance.checkOut(userId, today, latitude, longitude);

    return res.status(200).json({
      status: true,
      message: 'Check-out successful.',
      data: updated,
    });
  } catch (error) {
    console.error('Check-out error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── POST /api/attendance/mark ────────────────────────────────────────────────
// DEO or admin marks attendance on behalf of a VT
const markAttendance = async (req, res) => {
  const markedBy = req.user.id;
  const { user_id, date, status, check_in_time, check_out_time, latitude, longitude, photo_path, remarks } = req.body;

  if (!user_id || !date || !status) {
    return res.status(400).json({
      status: false,
      message: 'user_id, date, and status are required.',
    });
  }

  try {
    // Check for duplicate
    const existing = await Attendance.findByUserAndDate(user_id, date);
    if (existing) {
      return res.status(409).json({
        status: false,
        message: `Attendance already exists for this user on ${date}.`,
        data: existing,
      });
    }

    const record = await Attendance.create({
      user_id,
      date,
      check_in_time,
      status,
      latitude,
      longitude,
      photo_path,
      remarks,
      marked_by: markedBy,
    });

    return res.status(201).json({
      status: true,
      message: 'Attendance marked successfully.',
      data: record,
    });
  } catch (error) {
    console.error('Mark attendance error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── GET /api/attendance/my ───────────────────────────────────────────────────
// VT views their own attendance
const getMyAttendance = async (req, res) => {
  const userId = req.user.id;
  const { from_date, to_date, limit, offset } = req.query;

  try {
    const records = await Attendance.findByUser(userId, { from_date, to_date, limit, offset });
    return res.status(200).json({ status: true, data: records });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/attendance ──────────────────────────────────────────────────────
// Admin / DEO / Headmaster views all attendance with filters
const getAllAttendance = async (req, res) => {
  const { user_id, date, from_date, to_date, status, district, block, vtp_name, trade, limit, offset } = req.query;

  try {
    const records = await Attendance.findAll({
      user_id, date, from_date, to_date, status,
      district, block, vtp_name, trade,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });
    return res.status(200).json({ status: true, count: records.length, data: records });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/attendance/provider ────────────────────────────────────────────
// Vocational Teacher Provider views attendance of their assigned VTs
// Matching: users.organization_name  ←→  vt_staff_details.vtp_name
const getProviderAttendance = async (req, res) => {
  const { from_date, to_date, limit, offset } = req.query;

  try {
    // VTP user has organization_name = their vtp_name in vt_staff_details
    const vtpOrgName = req.user.organization_name;

    if (!vtpOrgName) {
      return res.status(400).json({
        status: false,
        message: 'Your account does not have an organization name linked. Contact admin.',
      });
    }

    const records = await Attendance.findByProvider(vtpOrgName, {
      from_date,
      to_date,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });

    return res.status(200).json({
      status: true,
      organization: vtpOrgName,
      count: records.length,
      data: records,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};


// ─── PUT /api/attendance/:id ──────────────────────────────────────────────────
// Admin / DEO updates an attendance record
const updateAttendance = async (req, res) => {
  const { id } = req.params;
  const { check_in_time, check_out_time, status, remarks, photo_path } = req.body;

  try {
    const updated = await Attendance.update(id, { check_in_time, check_out_time, status, remarks, photo_path });

    if (!updated) {
      return res.status(404).json({ status: false, message: 'Attendance record not found.' });
    }

    return res.status(200).json({ status: true, message: 'Attendance updated.', data: updated });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── DELETE /api/attendance/:id ───────────────────────────────────────────────
const deleteAttendance = async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await Attendance.delete(id);
    if (!deleted) {
      return res.status(404).json({ status: false, message: 'Attendance record not found.' });
    }
    return res.status(200).json({ status: true, message: 'Attendance record deleted.' });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/attendance/summary/:userId ──────────────────────────────────────
// Monthly summary breakdown by status
const getMonthlySummary = async (req, res) => {
  const { userId } = req.params;
  const { year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ status: false, message: 'year and month query params are required.' });
  }

  try {
    const summary = await Attendance.getMonthlySummary(userId, parseInt(year), parseInt(month));
    return res.status(200).json({ status: true, data: summary });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── POST /api/attendance/report/daily ───────────────────────────────────────
// Per-day attendance report for a VT user: check-in, check-out, working hours,
// status, leave reason + overall totals.
// Body params:
//   userId       - required (the VT user id)
//   filter_type  - 'date' | 'week' | 'month' | 'date_range' (default: 'month')
//   filter_value - e.g. '2026-04-21' | '2026-W16' | '2026-04' | '2026-04-01,2026-04-21'
//   limit        - page size  (default 31)
//   offset       - page start (default 0)
const getDailyReport = async (req, res) => {
  const { userId, filter_type, filter_value, limit, offset } = req.body;

  if (!userId) {
    return res.status(400).json({ status: false, message: 'userId query param is required.' });
  }

  const validTypes = ['date', 'week', 'month', 'date_range'];
  const resolvedType = validTypes.includes(filter_type) ? filter_type : 'month';

  try {
    const { records, totals } = await Attendance.getDailyReport(parseInt(userId), {
      filter_type: resolvedType,
      filter_value: filter_value || null,
      limit: limit ? parseInt(limit) : 31,
      offset: offset ? parseInt(offset) : 0,
    });

    // Enrich each record — label absent if no DB row exists (only matters for direct date lookup)
    const enriched = records.map((r) => ({
      date: r.date,
      check_in: r.check_in_time || null,
      check_out: r.check_out_time || null,
      status: r.status,
      leave_reason: r.status === 'on_leave' ? (r.leave_reason || null) : null,
      working_hours: r.working_hours !== null ? parseFloat(r.working_hours) : null,
    }));

    return res.status(200).json({
      status: true,
      filter: { type: resolvedType, value: filter_value || null },
      pagination: {
        limit: limit ? parseInt(limit) : 31,
        offset: offset ? parseInt(offset) : 0,
        count: enriched.length,
      },
      summary: {
        total_present: parseInt(totals.total_present),
        total_absent: parseInt(totals.total_absent),
        total_leave: parseInt(totals.total_leave),
        total_late: parseInt(totals.total_late),
        total_half_day: parseInt(totals.total_half_day),
        total_working_hours: parseFloat(totals.total_working_hours),
      },
      data: enriched,
    });
  } catch (error) {
    console.error('getDailyReport error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = {
  checkIn,
  checkOut,
  markAttendance,
  getMyAttendance,
  getAllAttendance,
  getProviderAttendance,
  updateAttendance,
  deleteAttendance,
  getMonthlySummary,
  getDailyReport,
};
