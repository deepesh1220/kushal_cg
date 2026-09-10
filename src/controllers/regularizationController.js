const Regularization = require('../models/Regularization');
const { pool } = require('../config/db');
const { getDistanceInMeters } = require('../utils/locationUtils');

// ─── Shared date parser: DD-MM-YYYY → YYYY-MM-DD ──────────────────────────────
const parseDateStr = (dateStr) => {
  if (!dateStr) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3 && parts[2].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
};

const VTP_ROLE_NAME = 'vocational_teacher_provider';

const parsePagination = ({ limit, page }) => {
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  return { parsedLimit, parsedPage, parsedOffset: (parsedPage - 1) * parsedLimit };
};

const upsertRegularizedAttendance = async (reg, markedBy) => {
  const dateStr = new Date(reg.date).toISOString().split('T')[0];
  const timeStr = new Date(reg.created_at).toTimeString().split(' ')[0];
  const schoolResult = await pool.query(`
    SELECT ms.sch_close_time FROM users u
    JOIN mst_schools ms ON COALESCE(u.udise_code, (
      SELECT v.udise_code FROM vt_staff_details v WHERE v.id = u.vt_staff_id
    )) = ms.udise_sch_code
    WHERE u.id = $1 LIMIT 1
  `, [reg.user_id]);
  const closeTime = schoolResult.rows[0]?.sch_close_time;
  await pool.query(`
    INSERT INTO attendance_records
      (user_id, date, status, check_in_time, check_out_time, remarks, marked_by)
    VALUES ($1, $2, 'present', $3, $4, 'VT Status Regularized by Headmaster & VTP', $5)
    ON CONFLICT (user_id, date) DO UPDATE SET
      status = 'present',
      check_in_time = COALESCE(attendance_records.check_in_time, EXCLUDED.check_in_time),
      check_out_time = COALESCE(attendance_records.check_out_time, EXCLUDED.check_out_time),
      remarks = EXCLUDED.remarks, marked_by = EXCLUDED.marked_by, updated_at = NOW()
  `, [reg.user_id, dateStr, `${dateStr} ${timeStr}`, closeTime ? `${dateStr} ${closeTime}` : null, markedBy]);
};

// ─── Shared helper: validate VT belongs to headmaster's school ─────────────────
const _validateVtBelongsToHeadmaster = async (vtUserId, headmaster) => {
  if (['super_admin', 'admin'].includes(headmaster.role_name)) return null;

  if (!headmaster.udise_code) {
    return {
      status: 400,
      body: { status: false, message: 'Your account is not linked to a school UDISE code.' },
    };
  }

  const result = await pool.query(`
    SELECT v.udise_code
    FROM users u
    JOIN vt_staff_details v ON v.id = u.vt_staff_id
    WHERE u.id = $1
  `, [vtUserId]);

  if (!result.rows.length) {
    return { status: 404, body: { status: false, message: 'Vocational Teacher not found.' } };
  }

  const vtUdise = result.rows[0].udise_code;
  if (String(vtUdise) !== String(headmaster.udise_code)) {
    return {
      status: 403,
      body: { status: false, message: 'You are not authorized to approve regularization requests from a different school.' },
    };
  }

  return null;
};

const _validateVtBelongsToVtp = async (vtUserId, vtpUser) => {
  if (['super_admin', 'admin'].includes(vtpUser.role_name)) return null;
  if (vtpUser.role_name !== VTP_ROLE_NAME) {
    return { status: 403, body: { status: false, message: 'Only VTP users can access this resource.' } };
  }
  if (!vtpUser.vtp_id) {
    return { status: 400, body: { status: false, message: 'Your account is not linked to a VTP ID. Contact administrator.' } };
  }
  const result = await pool.query(`
    SELECT TRIM(COALESCE(u.vtp_id, v.vtp_id)) AS vtp_id
    FROM users u LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id WHERE u.id = $1
  `, [vtUserId]);
  if (!result.rows.length) return { status: 404, body: { status: false, message: 'Vocational Teacher not found.' } };
  if (String(result.rows[0].vtp_id || '').trim() !== String(vtpUser.vtp_id).trim()) {
    return { status: 403, body: { status: false, message: 'You are not authorized to approve regularization requests for this VT.' } };
  }
  return null;
};

// ─── POST /api/regularization/apply ──────────────────────────────────────────
// VT submits an attendance regularization request
// req.body: { date, reason }
const applyRegularization = async (req, res) => {
  const userId = req.user.id;
  let { date, reason } = req.body;

  if (!date || !reason) {
    return res.status(400).json({ status: false, message: 'date and reason are required.' });
  }

  date = parseDateStr(date);
  const parsedDate = new Date(date);

  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ status: false, message: 'Invalid date format. Please use YYYY-MM-DD or DD-MM-YYYY.' });
  }

  if (parsedDate > new Date()) {
    return res.status(400).json({ status: false, message: 'Cannot request regularization for a future date.' });
  }

  try {
    const isDuplicate = await Regularization.checkDuplicate(userId, date);
    if (isDuplicate) {
      return res.status(400).json({ status: false, message: 'You already have a pending or approved request for this date.' });
    }

    const reg = await Regularization.create({ user_id: userId, date, reason });
    return res.status(201).json({ status: true, message: 'VT regularization request submitted successfully.', data: reg });
  } catch (error) {
    console.error('applyRegularization error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── POST /api/regularization/apply-with-location ────────────────────────────
// VT submits a regularization request but must be within 300m of school
// req.body: { date, reason, latitude, longitude }
const applyRegularizationWithLocation = async (req, res) => {
  const userId = req.user.id;
  let { date, reason, latitude, longitude, isFakeGPS } = req.body;

  if (!date || !reason || !latitude || !longitude || isFakeGPS == null) {
    return res.status(400).json({ status: false, message: 'date, reason, latitude, longitude and isFakeGPS are required.' });
  }

  if (isFakeGPS === true) {
    return res.status(403).json({
      status: false,
      message: 'Fake GPS is not allowed. Please disable fake GPS and try again.'
    });
  }
  date = parseDateStr(date);
  const parsedDate = new Date(date);

  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ status: false, message: 'Invalid date format.' });
  }

  try {
    // 1. Get School Location
    const vtRecord = await pool.query(`
      SELECT v.udise_code
      FROM users u
      JOIN vt_staff_details v ON u.vt_staff_id = v.id
      WHERE u.id = $1
    `, [userId]);
    const udiseCode = vtRecord.rows[0]?.udise_code;

    if (!udiseCode) {
      return res.status(404).json({ status: false, message: 'School information not found for this user.' });
    }

    const schoolRecord = await pool.query(`
      SELECT latitude, longitude
      FROM mst_schools
      WHERE udise_sch_code = $1
      LIMIT 1
    `, [udiseCode]);

    const schoolLat = schoolRecord.rows[0]?.latitude;
    const schoolLon = schoolRecord.rows[0]?.longitude;

    if (!schoolLat || !schoolLon) {
      return res.status(400).json({ status: false, message: 'School coordinates not set. Contact admin.' });
    }

    // 2. Verify Distance
    const distance = getDistanceInMeters(
      parseFloat(latitude),
      parseFloat(longitude),
      parseFloat(schoolLat),
      parseFloat(schoolLon)
    );

    if (distance > 300) {
      return res.status(403).json({
        status: false,
        message: `Regularization restricted. You are ${Math.round(distance)} meters away from the school. You must be within 300 meters.`
      });
    }

    // 3. Check Duplicate
    const isDuplicate = await Regularization.checkDuplicate(userId, date);
    if (isDuplicate) {
      return res.status(400).json({ status: false, message: 'You already have a pending or approved request for this date.' });
    }

    // 4. Create Request
    const reg = await Regularization.create({ user_id: userId, date, reason });
    return res.status(201).json({ status: true, message: 'Regularization request submitted successfully.', data: reg });

  } catch (error) {
    console.error('applyRegularizationWithLocation error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};


// ─── PATCH /api/regularization/:id/status ────────────────────────────────────
// Headmaster / Admin approves or rejects a regularization request
// req.body: { status }
const approveRegularization = async (req, res) => {
  const reviewer = req.user;
  const regId = req.params.id;
  const { status } = req.body;
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim() || null : null;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ status: false, message: 'Status must be either approved or rejected.' });
  }
  if (remarks?.length > 1000) {
    return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
  }

  try {
    const reg = await Regularization.findById(regId);
    if (!reg) {
      return res.status(404).json({ status: false, message: 'Regularization request not found.' });
    }

    // Validate headmaster can act on this VT
    const authError = await _validateVtBelongsToHeadmaster(reg.user_id, reviewer);
    if (authError) return res.status(authError.status).json(authError.body);

    const updated = await Regularization.updateHmStatus(regId, { status, reviewerId: reviewer.id, remarks });

    // On approval → upsert attendance_records as 'present' with regularization timestamps
    if (updated.regularization_approved === true) {
      const d = new Date(reg.date);
      const dateStr = d.toISOString().split('T')[0];

      // The check_in_time should be the exact time the VT applied for regularization
      const appliedTime = new Date(reg.created_at);
      const timeStr = appliedTime.toTimeString().split(' ')[0]; // gets HH:MM:SS
      const checkIn = `${dateStr} ${timeStr}`;

      // Fetch sch_close_time from mst_schools
      const schoolResult = await pool.query(`
        SELECT ms.sch_close_time 
        FROM users u 
        JOIN mst_schools ms ON u.udise_code = ms.udise_sch_code 
        WHERE u.id = $1
      `, [reg.user_id]);

      let checkOut = null;
      if (schoolResult.rows.length > 0 && schoolResult.rows[0].sch_close_time) {
        const schCloseTime = schoolResult.rows[0].sch_close_time;
        checkOut = `${dateStr} ${schCloseTime}`;
      }

      await pool.query(`
        INSERT INTO attendance_records (user_id, date, status, check_in_time, check_out_time, remarks, marked_by)
        VALUES ($1, $2, 'present', $4, $5, 'VT Status Regularized by Headmaster & VTP', $3)
        ON CONFLICT (user_id, date)
        DO UPDATE SET
          status         = 'present',
          check_in_time  = COALESCE(attendance_records.check_in_time, $4),
          check_out_time = COALESCE(attendance_records.check_out_time, $5),
          remarks        = 'VT Status Regularized by Headmaster & VTP',
          updated_at     = NOW()
      `, [reg.user_id, dateStr, reviewer.id, checkIn, checkOut]);
    } else if (reg.regularization_approved === true) {
      await pool.query(`DELETE FROM attendance_records
        WHERE user_id = $1 AND date = $2
          AND remarks = 'VT Status Regularized by Headmaster & VTP'`,
      [reg.user_id, reg.date]);
    }

    const message = updated.regularization_approved
      ? 'Regularization request fully approved (Headmaster + VTP). Attendance updated.'
      : status === 'rejected'
        ? 'Regularization request rejected by Headmaster.'
        : 'Regularization request approved by Headmaster. Awaiting VTP approval.';
    return res.status(200).json({ status: true, message, data: updated });
  } catch (error) {
    console.error('approveRegularization error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/regularization/my ──────────────────────────────────────────────
// VT views their own regularization requests
// query: { status, from_date, to_date, page, limit, offset }
const getMyRegularizationRequests = async (req, res) => {
  const userId = req.user.id;
  let { status, from_date, to_date, limit, offset, page } = req.query;

  try {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedOffset = offset ? parseInt(offset, 10) : (parsedPage - 1) * parsedLimit;

    if (from_date) from_date = parseDateStr(from_date);
    if (to_date) to_date = parseDateStr(to_date);

    const regData = await Regularization.findByUser(userId, {
      status, from_date, to_date,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    return res.status(200).json({
      status: true,
      pagination: {
        totalRecords: regData.totalRecords,
        totalPages: Math.ceil(regData.totalRecords / parsedLimit),
        currentPage: parsedPage,
        limit: parsedLimit,
      },
      data: regData.data,
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── POST /api/regularization/filter ──────────────────────────────────────────
// Admin / Headmaster gets regularizations by udise_code or user_id via POST body
// req.body: { udise_code, user_id, status, from_date, to_date, limit, page }
const getAllRegularizations = async (req, res) => {
  let { udise_code, user_id, status, from_date, to_date, limit, page } = req.body;

  try {
    if (!['super_admin', 'admin'].includes(req.user.role_name)) {
      if (!req.user.udise_code) {
        return res.status(400).json({ status: false, message: 'Your account is not linked to a school UDISE code.' });
      }
      udise_code = req.user.udise_code;
    }
    const { parsedLimit, parsedPage, parsedOffset } = parsePagination({ limit, page });

    if (from_date) from_date = parseDateStr(from_date);
    if (to_date) to_date = parseDateStr(to_date);

    const regData = await Regularization.findAll({
      udise_code,
      user_id,
      status,
      from_date,
      to_date,
      limit: parsedLimit,
      offset: parsedOffset
    });

    return res.status(200).json({
      status: true,
      pagination: {
        totalRecords: regData.totalRecords,
        totalPages: Math.ceil(regData.totalRecords / parsedLimit),
        currentPage: parsedPage,
        limit: parsedLimit,
      },
      data: regData.data,
    });
  } catch (error) {
    console.error('getAllRegularizations error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// VTP views regularization requests scoped to its linked VTs.
const getVtpRegularizations = async (req, res) => {
  try {
    if (!['super_admin', 'admin'].includes(req.user.role_name)) {
      if (req.user.role_name !== VTP_ROLE_NAME) {
        return res.status(403).json({ status: false, message: 'Only VTP users can access this resource.' });
      }
      if (!req.user.vtp_id) {
        return res.status(400).json({ status: false, message: 'Your account is not linked to a VTP ID. Contact administrator.' });
      }
    }
    const { status, from_date, to_date } = req.body;
    const { parsedLimit, parsedPage, parsedOffset } = parsePagination(req.body);
    const filters = {
      status,
      from_date: from_date ? parseDateStr(from_date) : undefined,
      to_date: to_date ? parseDateStr(to_date) : undefined,
      limit: parsedLimit,
      offset: parsedOffset,
    };
    const data = ['super_admin', 'admin'].includes(req.user.role_name)
      ? await Regularization.findAll({ ...filters, approval_status_column: 'vtp_status' })
      : await Regularization.findAllByVtpId(req.user.vtp_id, filters);
    return res.status(200).json({
      status: true,
      pagination: {
        totalRecords: data.totalRecords,
        totalPages: Math.ceil(data.totalRecords / parsedLimit),
        currentPage: parsedPage,
        limit: parsedLimit,
      },
      data: data.data,
    });
  } catch (error) {
    console.error('getVtpRegularizations error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// VTP approves or rejects one regularization request in its organization.
const actionRegularizationByVtp = async (req, res) => {
  const requestId = parseInt(req.params.requestId, 10);
  const { status } = req.body;
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim() || null : null;
  if (!Number.isInteger(requestId)) return res.status(400).json({ status: false, message: 'Invalid request ID.' });
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ status: false, message: "status must be 'approved' or 'rejected'." });
  }
  if (remarks?.length > 1000) return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });

  try {
    const reg = await Regularization.findById(requestId);
    if (!reg) return res.status(404).json({ status: false, message: 'Regularization request not found.' });
    const authError = await _validateVtBelongsToVtp(reg.user_id, req.user);
    if (authError) return res.status(authError.status).json(authError.body);

    const updated = await Regularization.updateVtpStatus(requestId, {
      status, reviewerId: req.user.id, remarks,
    });
    if (updated.regularization_approved === true) await upsertRegularizedAttendance(reg, req.user.id);
    else if (reg.regularization_approved === true) {
      await pool.query(`DELETE FROM attendance_records
        WHERE user_id = $1 AND date = $2
          AND remarks = 'VT Status Regularized by Headmaster & VTP'`,
      [reg.user_id, reg.date]);
    }
    const message = updated.regularization_approved
      ? 'Regularization request fully approved (Headmaster + VTP). Attendance updated.'
      : status === 'rejected'
        ? 'Regularization request rejected by VTP.'
        : 'Regularization request approved by VTP. Awaiting Headmaster approval.';
    return res.status(200).json({ status: true, message, data: updated });
  } catch (error) {
    console.error('actionRegularizationByVtp error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = {
  applyRegularization,
  applyRegularizationWithLocation,
  approveRegularization,
  getMyRegularizationRequests,
  getAllRegularizations,
  getVtpRegularizations,
  actionRegularizationByVtp,
};
