const OnDuty = require('../models/OnDuty');
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
      body: { status: false, message: 'You are not authorized to approve OD requests from a different school.' },
    };
  }

  return null;
};

// ─── POST /api/od/apply ───────────────────────────────────────────────────────
// VT submits an On-Duty request
// req.body: { from_date, to_date, reason }
const applyOnDuty = async (req, res) => {
  const userId = req.user.id;
  let { from_date, to_date, reason } = req.body;

  if (!from_date || !to_date) {
    return res.status(400).json({ status: false, message: 'from_date and to_date are required.' });
  }

  from_date = parseDateStr(from_date);
  to_date   = parseDateStr(to_date);

  const parsedFrom = new Date(from_date);
  const parsedTo   = new Date(to_date);

  if (isNaN(parsedFrom.getTime()) || isNaN(parsedTo.getTime())) {
    return res.status(400).json({ status: false, message: 'Invalid date format. Please use YYYY-MM-DD or DD-MM-YYYY.' });
  }

  if (parsedFrom > parsedTo) {
    return res.status(400).json({ status: false, message: 'from_date cannot be after to_date.' });
  }

  try {
    const isOverlap = await OnDuty.checkOverlap(userId, parsedFrom, parsedTo);
    if (isOverlap) {
      return res.status(400).json({ status: false, message: 'You already have a pending or approved OD request during this period.' });
    }

    const od = await OnDuty.create({ user_id: userId, from_date, to_date, reason });
    return res.status(201).json({ status: true, message: 'On Duty request submitted successfully.', data: od });
  } catch (error) {
    console.error('applyOnDuty error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── PATCH /api/od/:id/status ─────────────────────────────────────────────────
// Headmaster / Admin approves or rejects an OD request
// req.body: { status }
const approveOnDuty = async (req, res) => {
  const reviewer = req.user;
  const odId     = req.params.id;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ status: false, message: 'Status must be either approved or rejected.' });
  }

  try {
    const od = await OnDuty.findById(odId);
    if (!od) {
      return res.status(404).json({ status: false, message: 'OD request not found.' });
    }

    if (od.status !== 'pending') {
      return res.status(400).json({ status: false, message: `OD request is already ${od.status}.` });
    }

    // Validate headmaster can act on this VT
    const authError = await _validateVtBelongsToHeadmaster(od.user_id, reviewer);
    if (authError) return res.status(authError.status).json(authError.body);

    const updated = await OnDuty.updateStatus(odId, { status, reviewerId: reviewer.id });

    // On approval → upsert attendance_records as 'od' for each day in range
    if (status === 'approved') {
      const fromD = new Date(od.from_date);
      const toD   = new Date(od.to_date);

      for (let d = new Date(fromD); d <= toD; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];

        await pool.query(`
          INSERT INTO attendance_records (user_id, date, status, check_in_time, check_out_time, remarks, marked_by)
          VALUES ($1, $2, 'od', NOW(), NOW(), 'OD Approved by Headmaster', $3)
          ON CONFLICT (user_id, date)
          DO UPDATE SET
            status     = 'od',
            remarks    = 'OD Approved by Headmaster',
            updated_at = NOW()
        `, [od.user_id, dateStr, reviewer.id]);
      }
    }

    return res.status(200).json({ status: true, message: `OD request successfully ${status}.`, data: updated });
  } catch (error) {
    console.error('approveOnDuty error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/od/my ───────────────────────────────────────────────────────────
// VT views their own OD requests
// query: { status, from_date, to_date, page, limit, offset }
const getMyOnDutyRequests = async (req, res) => {
  const userId = req.user.id;
  let { status, from_date, to_date, limit, offset, page } = req.query;

  try {
    const parsedLimit  = limit  ? parseInt(limit, 10)  : 10;
    const parsedPage   = page   ? parseInt(page, 10)   : 1;
    const parsedOffset = offset ? parseInt(offset, 10) : (parsedPage - 1) * parsedLimit;

    if (from_date) from_date = parseDateStr(from_date);
    if (to_date)   to_date   = parseDateStr(to_date);

    const odData = await OnDuty.findByUser(userId, {
      status, from_date, to_date,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    return res.status(200).json({
      status: true,
      pagination: {
        totalRecords: odData.totalRecords,
        totalPages:   Math.ceil(odData.totalRecords / parsedLimit),
        currentPage:  parsedPage,
        limit:        parsedLimit,
      },
      data: odData.data,
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/od/:id ──────────────────────────────────────────────────────────
// Get a specific OD request by ID
const getOnDutyById = async (req, res) => {
  const { id }  = req.params;
  const user    = req.user;

  try {
    const od = await OnDuty.findById(id);

    if (!od) {
      return res.status(404).json({ status: false, message: 'On Duty request not found.' });
    }

    const isOwner  = od.user_id === user.id;
    const isAdmin  = ['admin', 'super_admin'].includes(user.role_name);

    let isAuthorizedHM = false;
    if (user.role_name === 'headmaster') {
      const authError = await _validateVtBelongsToHeadmaster(od.user_id, user);
      if (!authError) isAuthorizedHM = true;
    }

    if (!isOwner && !isAdmin && !isAuthorizedHM) {
      return res.status(403).json({ status: false, message: 'You are not authorized to view this request.' });
    }

    return res.status(200).json({ status: true, data: od });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = { applyOnDuty, approveOnDuty, getMyOnDutyRequests, getOnDutyById };
