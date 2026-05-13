const User = require('../models/User');
const Leave = require('../models/Leave');
const { pool } = require('../config/db');

const VTP_ROLE_NAME = 'vocational_teacher_provider';

// ─── Internal helper ──────────────────────────────────────────────────────────
// Validates that the VT being approved/rejected belongs to the VTP's organization
// (matched via vt_staff_details.vtp_name === vtp.organization_name).
// super_admin and admin skip this check.
const _validateVtBelongsToVtp = async (vtUserId, vtpUser) => {
  if (['super_admin', 'admin'].includes(vtpUser.role_name)) return null;

  if (vtpUser.role_name !== VTP_ROLE_NAME) {
    return {
      status: 403,
      body: { status: false, message: 'Only VTP users can perform this action.' },
    };
  }

  const vtpName = vtpUser.organization_name;
  if (!vtpName) {
    return {
      status: 400,
      body: { status: false, message: 'Your VTP account is not linked to a vtp_name. Contact administrator.' },
    };
  }

  const result = await pool.query(`
    SELECT v.vtp_name
    FROM users u
    JOIN vt_staff_details v ON v.id = u.vt_staff_id
    WHERE u.id = $1
  `, [vtUserId]);

  if (!result.rows.length) {
    return {
      status: 404,
      body: { status: false, message: 'Vocational Teacher not found.' },
    };
  }

  if (String(result.rows[0].vtp_name).trim() !== String(vtpName).trim()) {
    return {
      status: 403,
      body: {
        status: false,
        message: 'You are not authorized to approve VTs from a different VTP organization.',
      },
    };
  }

  return null;
};

// ─── Internal helper for Leave ────────────────────────────────────────────────
const _validateLeaveBelongsToVtp = async (leaveId, vtpUser) => {
  if (['super_admin', 'admin'].includes(vtpUser.role_name)) return null;

  const result = await pool.query(`
    SELECT v.vtp_name
    FROM leave_requests l
    JOIN users u ON l.user_id = u.id
    JOIN vt_staff_details v ON v.id = u.vt_staff_id
    WHERE l.id = $1::integer
  `, [leaveId]);

  if (!result.rows.length) {
    return {
      status: 404,
      body: { status: false, message: 'Leave request not found.' },
    };
  }

  const vtpName = vtpUser.organization_name;
  if (String(result.rows[0].vtp_name).trim() !== String(vtpName).trim()) {
    return {
      status: 403,
      body: { status: false, message: 'You are not authorized to approve leaves for this VT.' },
    };
  }

  return null;
};

// ─── GET /api/vtp/vts ─────────────────────────────────────────────────────────
// VTP views VTs assigned to their organization with status filter (?status=all|pending|accepted|rejected)
const getVtpScopedVts = async (req, res) => {
  
  try {
    const vtpUser = req.user;
    console.log("vtpUser",vtpUser);
    
    const { status } = req.query;

    // super_admin/admin: see all; VTP: scoped by organization_name
    let allVts;
    if (['super_admin', 'admin'].includes(vtpUser.role_name)) {
      allVts = await User.findAllVtsByStatus(null);
      
    } else {
      if (vtpUser.role_name !== VTP_ROLE_NAME) {
        return res.status(403).json({ status: false, message: 'Only VTP users can access this resource.' });
      }
      if (!vtpUser.vtp_id) {
        return res.status(400).json({
          status: false,
          message: 'Your account is not linked to a VTP ID. Contact administrator.',
        });
      }
      allVts = await User.findVtsByVtpId(vtpUser.vtp_id);
    }

    // Counts (across both layers) — useful for VTP UI badges
    let pendingCount = 0;
    let acceptedCount = 0;
    let rejectedCount = 0;
    allVts.forEach(vt => {
      if (vt.vtp_approval_status === 'pending') pendingCount++;
      else if (vt.vtp_approval_status === 'accepted') acceptedCount++;
      else if (vt.vtp_approval_status === 'rejected') rejectedCount++;
    });

    // Filter by VTP status (so VTP sees their own approval workflow)
    let filteredVts = allVts;
    if (status && status !== 'all') {
      filteredVts = allVts.filter(vt => vt.vtp_approval_status === status);
    }

    return res.status(200).json({
      status: true,
      counts: {
        total: allVts.length,
        pending: pendingCount,
        accepted: acceptedCount,
        rejected: rejectedCount,
      },
      message: `Found ${filteredVts.length} VT(s) matching criteria.`,
      data: filteredVts,
    });
  } catch (error) {
    console.error('getVtpScopedVts error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── PATCH /api/vtp/:userId/approve ──────────────────────────────────────────
// VTP approves a VT — combined with HM approval, account becomes active
const approveVtByVtp = async (req, res) => {
  const { userId } = req.params;

  try {
    const validationError = await _validateVtBelongsToVtp(userId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await User.updateVtpApprovalStatus(userId, 'accepted', req.user.id);

    if (!updated) {
      return res.status(404).json({
        status: false,
        message: 'VT not found or has no VTP approval row.',
      });
    }

    return res.status(200).json({
      status: true,
      message: updated.is_active
        ? `Vocational Teacher "${updated.name}" has been fully approved (HM + VTP) and can now login.`
        : `Vocational Teacher "${updated.name}" approved by VTP. Awaiting Headmaster approval.`,
      data: updated,
    });
  } catch (error) {
    console.error('approveVtByVtp error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── PATCH /api/vtp/:userId/reject ───────────────────────────────────────────
// VTP rejects a VT — account stays inactive
const rejectVtByVtp = async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;

  try {
    const validationError = await _validateVtBelongsToVtp(userId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await User.updateVtpApprovalStatus(userId, 'rejected', req.user.id);

    if (!updated) {
      return res.status(404).json({
        status: false,
        message: 'VT not found or has no VTP approval row.',
      });
    }

    return res.status(200).json({
      status: true,
      message: `Vocational Teacher "${updated.name}" registration has been rejected by VTP.`,
      reason: reason || null,
      data: updated,
    });
  } catch (error) {
    console.error('rejectVtByVtp error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── GET /api/vtp/leaves ──────────────────────────────────────────────────────
// VTP views leave requests scoped to their organization
const getVtpScopedLeaves = async (req, res) => {
  try {
    const vtpUser = req.user;
    const { status, from_date, to_date, teacher_code, page, limit } = req.query;

    if (!['super_admin', 'admin'].includes(vtpUser.role_name)) {
      if (vtpUser.role_name !== VTP_ROLE_NAME) {
        return res.status(403).json({ status: false, message: 'Only VTP users can access this resource.' });
      }
      if (!vtpUser.organization_name) {
        return res.status(400).json({
          status: false,
          message: 'Your account is not linked to a VTP organization name. Contact administrator.',
        });
      }
    }

    const vtpName = ['super_admin', 'admin'].includes(vtpUser.role_name) ? null : vtpUser.organization_name;

    const result = await Leave.getVtpLeaves(vtpName, {
      status,
      from_date,
      to_date,
      teacher_code,
      page,
      limit,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('getVtpScopedLeaves error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── Leave Approval by VTP ───────────────────────────────────────────────────

/**
 * Approve a leave request by VTP
 * PATCH /api/vtp/leave/:leaveId/approve
 */
const approveLeaveByVtp = async (req, res) => {
  const { leaveId } = req.params;
  const parsedLeaveId = parseInt(leaveId, 10);

  try {
    const validationError = await _validateLeaveBelongsToVtp(parsedLeaveId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await Leave.updateVtpStatus(parsedLeaveId, { status: 'approved', reviewerId: req.user.id });

    if (!updated) {
      return res.status(404).json({ status: false, message: 'Leave request not found.' });
    }

    let deductionInfo = null;
    if (updated.leave_approved) {
      try {
        const LeaveBalance = require('../models/LeaveBalance');
        // Lazy credit current month if not yet credited
        await LeaveBalance.ensureCurrentMonthCredit(updated.user_id);
        
        // Prevent duplicate deduction: check if already deducted
        const checkDeduction = await pool.query(`
          SELECT 1 FROM leave_deduction_log WHERE leave_request_id = $1
          UNION
          SELECT 1 FROM leave_excess_records WHERE leave_request_id = $1
        `, [parsedLeaveId]);
        
        if (checkDeduction.rows.length === 0) {
          // Deduct the leave amount
          const deduction = await LeaveBalance.deductLeave(
            parsedLeaveId, updated.user_id, updated.leave_type, req.user.id
          );
          deductionInfo = deduction;
          if (!deduction.success) {
            console.warn(`[Leave ${parsedLeaveId}] Approved but deduction failed: ${deduction.message}`);
          }
        } else {
          deductionInfo = { success: true, message: 'Already deducted' };
        }
      } catch (e) {
        console.error(`[Leave ${parsedLeaveId}] Deduction error (approval still succeeded):`, e.message);
        deductionInfo = { success: false, message: e.message };
      }
    }

    return res.status(200).json({
      status: true,
      message: updated.leave_approved
        ? 'Leave request fully approved (Principal + VTP).'
        : 'Leave request approved by VTP. Awaiting Principal approval.',
      data: updated,
      ...(deductionInfo ? { deduction: deductionInfo } : {})
    });
  } catch (error) {
    console.error('approveLeaveByVtp error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * Reject a leave request by VTP
 * PATCH /api/vtp/leave/:leaveId/reject
 */
const rejectLeaveByVtp = async (req, res) => {
  const { leaveId } = req.params;
  const parsedLeaveId = parseInt(leaveId, 10);

  try {
    const validationError = await _validateLeaveBelongsToVtp(parsedLeaveId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await Leave.updateVtpStatus(parsedLeaveId, { status: 'rejected', reviewerId: req.user.id });

    if (!updated) {
      return res.status(404).json({ status: false, message: 'Leave request not found.' });
    }

    return res.status(200).json({
      status: true,
      message: 'Leave request rejected by VTP.',
      data: updated,
    });
  } catch (error) {
    console.error('rejectLeaveByVtp error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

module.exports = {
  getVtpScopedVts,
  approveVtByVtp,
  rejectVtByVtp,
  getVtpScopedLeaves,
  approveLeaveByVtp,
  rejectLeaveByVtp
};

