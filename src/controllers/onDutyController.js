const OnDuty = require('../models/OnDuty');
const { pool } = require('../config/db');

const VTP_ROLE_NAME = 'vocational_teacher_provider';

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
  let { from_date, to_date, reason, onDuty_type } = req.body;

  if (!from_date || !to_date) {
    return res.status(400).json({ status: false, message: 'from_date and to_date are required.' });
  }

  const validTypes = ['full-day', 'first-half', 'second-half'];
  if (!onDuty_type || !validTypes.includes(onDuty_type)) {
    return res.status(400).json({ status: false, message: "onDuty_type must be 'full-day', 'first-half', or 'second-half'." });
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

    const od = await OnDuty.create({ user_id: userId, from_date, to_date, od_type: onDuty_type, reason });
    return res.status(201).json({ status: true, message: 'On Duty request submitted successfully.', data: od });
  } catch (error) {
    console.error('applyOnDuty error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── PATCH /api/od/:id/status ─────────────────────────────────────────────────
// Headmaster / Admin approves or rejects an OD request (HM layer of dual approval)
// req.body: { status, remarks }
const approveOnDuty = async (req, res) => {
  const reviewer = req.user;
  const odId     = req.params.id;
  const { status, remarks } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ status: false, message: 'Status must be either approved or rejected.' });
  }

  try {
    const od = await OnDuty.findById(odId);
    if (!od) {
      return res.status(404).json({ status: false, message: 'OD request not found.' });
    }

    // Guard: HM cannot act if HM has already acted on this request
    if (od.hm_status && od.hm_status !== 'pending') {
      return res.status(400).json({
        status: false,
        message: `Headmaster has already ${od.hm_status} this OD request.`,
      });
    }

    // Validate headmaster can act on this VT
    const authError = await _validateVtBelongsToHeadmaster(od.user_id, reviewer);
    if (authError) return res.status(authError.status).json(authError.body);

    // Update only HM layer — final status is computed inside the model
    const updated = await OnDuty.updateHmStatus(odId, {
      status,
      reviewerId: reviewer.id,
      remarks,
    });

    // Upsert attendance records ONLY when both layers are approved (od_approved = true)
    if (updated.od_approved === true) {
      const fromD = new Date(od.from_date);
      const toD   = new Date(od.to_date);
      for (let d = new Date(fromD); d <= toD; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        await pool.query(`
          INSERT INTO attendance_records (user_id, date, status, check_in_time, check_out_time, remarks, marked_by)
          VALUES ($1, $2, 'od', NOW(), NOW(), $3, $4)
          ON CONFLICT (user_id, date)
          DO UPDATE SET
            status     = 'od',
            remarks    = $3,
            updated_at = NOW()
        `, [od.user_id, dateStr, remarks || 'OD Approved by Headmaster & VTP', reviewer.id]);
      }
    }

    const finalMessage = updated.od_approved
      ? `OD request fully approved (Headmaster + VTP). Attendance updated.`
      : status === 'rejected'
        ? `OD request rejected by Headmaster.`
        : `OD request approved by Headmaster. Awaiting VTP approval.`;

    return res.status(200).json({
      status: true,
      message: finalMessage,
      data: {
        ...updated,
        headmasterApprovalStatus: updated.hm_status,
        headmasterApprovedBy:     updated.hm_approved_by,
        headmasterActionAt:       updated.hm_action_at,
        headmasterRemarks:        updated.hm_remarks,
        vtpApprovalStatus:        updated.vtp_status,
        vtpApprovedBy:            updated.vtp_approved_by,
        vtpActionAt:              updated.vtp_action_at,
        vtpRemarks:               updated.vtp_remarks,
        finalStatus:              updated.status,
        od_approved:              updated.od_approved,
      },
    });
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

// ─── POST /api/od/headmaster ──────────────────────────────────────────────────
// Headmaster views OD requests of VTs in their school
// body: { udise_code, status, page, limit }
const getHeadmasterOnDutyRequests = async (req, res) => {
  const { udise_code, status, limit, page } = req.body;
  const user = req.user;

  // Security: If a headmaster is calling this, ensure they can only query their own school
  if (user.role_name === 'headmaster') {
    if (!user.udise_code) {
      return res.status(400).json({ status: false, message: 'Your account is not linked to a school UDISE code.' });
    }
    if (udise_code && String(udise_code) !== String(user.udise_code)) {
      return res.status(403).json({ status: false, message: 'You are not authorized to view OD requests for a different school.' });
    }
  }

  // Use the requested udise_code or fallback to the headmaster's own udise_code
  const targetUdiseCode = udise_code || (user.role_name === 'headmaster' ? user.udise_code : null);

  if (!targetUdiseCode) {
    return res.status(400).json({ status: false, message: 'udise_code is required.' });
  }

  try {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedOffset = (parsedPage - 1) * parsedLimit;

    const odData = await OnDuty.findAll({
      udise_code: targetUdiseCode,
      status,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    return res.status(200).json({
      status: true,
      pagination: {
        totalRecords: odData.totalRecords,
        totalPages: Math.ceil(odData.totalRecords / parsedLimit),
        currentPage: parsedPage,
        limit: parsedLimit,
      },
      data: odData.data,
    });
  } catch (error) {
    console.error('getHeadmasterOnDutyRequests error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── Internal helper for VTP OnDuty ───────────────────────────────────────────
// Validates that the OD request belongs to a VT that is under the calling VTP.
const _validateOnDutyBelongsToVtp = async (odId, vtpUser) => {
  if (['super_admin', 'admin'].includes(vtpUser.role_name)) return null;

  const result = await pool.query(`
    SELECT TRIM(COALESCE(u.vtp_id, v.vtp_id)) AS vtp_id
    FROM od_requests o
    JOIN users u ON u.id = o.user_id
    LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
    WHERE o.id = $1::integer
  `, [odId]);

  if (!result.rows.length) {
    return {
      status: 404,
      body: { status: false, message: 'OnDuty request not found.' },
    };
  }

  const vtpId = vtpUser.vtp_id;
  if (!vtpId) {
    return {
      status: 400,
      body: { status: false, message: 'Your VTP account is not linked to a vtp_id. Contact administrator.' },
    };
  }

  if (String(result.rows[0].vtp_id).trim() !== String(vtpId).trim()) {
    return {
      status: 403,
      body: { status: false, message: 'You are not authorized to approve OnDuty requests for this VT.' },
    };
  }

  return null;
};

// ─── POST /api/od/vtp ─────────────────────────────────────────────────────────
// VTP views OnDuty requests scoped to their organization
// body: { status, page, limit }
const getVtpScopedOnDutyRequests = async (req, res) => {
  try {
    const vtpUser = req.user;
    const { status, limit, page } = req.body;

    if (!['super_admin', 'admin'].includes(vtpUser.role_name)) {
      if (vtpUser.role_name !== VTP_ROLE_NAME) {
        return res.status(403).json({ status: false, message: 'Only VTP users can access this resource.' });
      }
      if (!vtpUser.vtp_id) {
        return res.status(400).json({
          status: false,
          message: 'Your account is not linked to a VTP ID. Contact administrator.',
        });
      }
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedOffset = (parsedPage - 1) * parsedLimit;

    let odData;
    if (['super_admin', 'admin'].includes(vtpUser.role_name)) {
      // Admin sees all (no vtp_id filter)
      odData = await OnDuty.findAll({ status, limit: parsedLimit, offset: parsedOffset });
    } else {
      odData = await OnDuty.findAllByVtpId(vtpUser.vtp_id, {
        status,
        limit: parsedLimit,
        offset: parsedOffset,
      });
    }

    return res.status(200).json({
      status: true,
      pagination: {
        totalRecords: odData.totalRecords,
        totalPages: Math.ceil(odData.totalRecords / parsedLimit),
        currentPage: parsedPage,
        limit: parsedLimit,
      },
      data: odData.data,
    });
  } catch (error) {
    console.error('getVtpScopedOnDutyRequests error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── PUT /api/od/vtp/:requestId/action ────────────────────────────────────────
// VTP approves or rejects an OnDuty request of a VT under their organization
// body: { status: 'approved'|'rejected', remarks }
const actionOnDutyByVtp = async (req, res) => {
  const { requestId } = req.params;
  const parsedId = parseInt(requestId, 10);
  const { status, remarks } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ status: false, message: "status must be 'approved' or 'rejected'." });
  }

  try {
    const od = await OnDuty.findById(parsedId);
    if (!od) {
      return res.status(404).json({ status: false, message: 'OnDuty request not found.' });
    }

    // Guard: VTP cannot act if VTP has already acted on this request
    if (od.vtp_status && od.vtp_status !== 'pending') {
      return res.status(400).json({
        status: false,
        message: `VTP has already ${od.vtp_status} this OnDuty request.`,
      });
    }

    // Final status must not already be rejected (e.g. HM rejected it)
    if (od.status === 'rejected') {
      return res.status(400).json({
        status: false,
        message: 'This OnDuty request has already been rejected.',
      });
    }

    // Verify the VT belongs to this VTP
    const validationError = await _validateOnDutyBelongsToVtp(parsedId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    // Update only VTP layer — final status is computed inside the model
    const updated = await OnDuty.updateVtpStatus(parsedId, {
      status,
      reviewerId: req.user.id,
      remarks,
    });

    if (!updated) {
      return res.status(404).json({ status: false, message: 'OnDuty request not found.' });
    }

    // Upsert attendance records ONLY when both layers are approved (od_approved = true)
    if (updated.od_approved === true) {
      const fromD = new Date(od.from_date);
      const toD   = new Date(od.to_date);
      for (let d = new Date(fromD); d <= toD; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        await pool.query(`
          INSERT INTO attendance_records (user_id, date, status, check_in_time, check_out_time, remarks, marked_by)
          VALUES ($1, $2, 'od', NOW(), NOW(), $3, $4)
          ON CONFLICT (user_id, date)
          DO UPDATE SET
            status     = 'od',
            remarks    = $3,
            updated_at = NOW()
        `, [od.user_id, dateStr, remarks || 'OD Approved by Headmaster & VTP', req.user.id]);
      }
    }

    const finalMessage = updated.od_approved
      ? `OD request fully approved (Headmaster + VTP). Attendance updated.`
      : status === 'rejected'
        ? `OD request rejected by VTP.`
        : `OD request approved by VTP. Awaiting Headmaster approval.`;

    return res.status(200).json({
      status: true,
      message: finalMessage,
      data: {
        ...updated,
        headmasterApprovalStatus: updated.hm_status,
        headmasterApprovedBy:     updated.hm_approved_by,
        headmasterActionAt:       updated.hm_action_at,
        headmasterRemarks:        updated.hm_remarks,
        vtpApprovalStatus:        updated.vtp_status,
        vtpApprovedBy:            updated.vtp_approved_by,
        vtpActionAt:              updated.vtp_action_at,
        vtpRemarks:               updated.vtp_remarks,
        finalStatus:              updated.status,
        od_approved:              updated.od_approved,
      },
    });
  } catch (error) {
    console.error('actionOnDutyByVtp error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

module.exports = {
  applyOnDuty,
  approveOnDuty,
  getMyOnDutyRequests,
  getOnDutyById,
  getHeadmasterOnDutyRequests,
  getVtpScopedOnDutyRequests,
  actionOnDutyByVtp,
};
