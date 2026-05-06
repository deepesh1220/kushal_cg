const Regularization = require('../models/Regularization');
const { pool } = require('../config/db');

// ─── Shared date parser: DD-MM-YYYY → YYYY-MM-DD ──────────────────────────────
const parseDateStr = (dateStr) => {
  if (!dateStr) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3 && parts[2].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
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
    return res.status(201).json({ status: true, message: 'Attendance regularization request submitted successfully.', data: reg });
  } catch (error) {
    console.error('applyRegularization error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── PATCH /api/regularization/:id/status ────────────────────────────────────
// Headmaster / Admin approves or rejects a regularization request
// req.body: { status }
const approveRegularization = async (req, res) => {
  const reviewer = req.user;
  const regId    = req.params.id;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ status: false, message: 'Status must be either approved or rejected.' });
  }

  try {
    const reg = await Regularization.findById(regId);
    if (!reg) {
      return res.status(404).json({ status: false, message: 'Regularization request not found.' });
    }

    if (reg.status !== 'pending') {
      return res.status(400).json({ status: false, message: `Request is already ${reg.status}.` });
    }

    // Validate headmaster can act on this VT
    const authError = await _validateVtBelongsToHeadmaster(reg.user_id, reviewer);
    if (authError) return res.status(authError.status).json(authError.body);

    const updated = await Regularization.updateStatus(regId, { status, reviewerId: reviewer.id });

    // On approval → upsert attendance_records as 'present' with regularization timestamps
    if (status === 'approved') {
      const d        = new Date(reg.date);
      const dateStr  = d.toISOString().split('T')[0];
      const checkIn  = `${dateStr} 10:00:00`;
      const checkOut = `${dateStr} 17:00:00`;

      await pool.query(`
        INSERT INTO attendance_records (user_id, date, status, check_in_time, check_out_time, remarks, marked_by)
        VALUES ($1, $2, 'present', $4, $5, 'Attendance Regularized by Headmaster', $3)
        ON CONFLICT (user_id, date)
        DO UPDATE SET
          status         = 'present',
          check_in_time  = COALESCE(attendance_records.check_in_time, $4),
          check_out_time = COALESCE(attendance_records.check_out_time, $5),
          remarks        = 'Attendance Regularized by Headmaster',
          updated_at     = NOW()
      `, [reg.user_id, dateStr, reviewer.id, checkIn, checkOut]);
    }

    return res.status(200).json({ status: true, message: `Regularization request successfully ${status}.`, data: updated });
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
    const parsedLimit  = limit  ? parseInt(limit, 10)  : 10;
    const parsedPage   = page   ? parseInt(page, 10)   : 1;
    const parsedOffset = offset ? parseInt(offset, 10) : (parsedPage - 1) * parsedLimit;

    if (from_date) from_date = parseDateStr(from_date);
    if (to_date)   to_date   = parseDateStr(to_date);

    const regData = await Regularization.findByUser(userId, {
      status, from_date, to_date,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    return res.status(200).json({
      status: true,
      pagination: {
        totalRecords: regData.totalRecords,
        totalPages:   Math.ceil(regData.totalRecords / parsedLimit),
        currentPage:  parsedPage,
        limit:        parsedLimit,
      },
      data: regData.data,
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = { applyRegularization, approveRegularization, getMyRegularizationRequests };
