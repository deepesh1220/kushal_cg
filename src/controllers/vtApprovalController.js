const User = require('../models/User');

// ─── GET /api/vt/pending ──────────────────────────────────────────────────────
// Headmaster views pending VTs for their school (matched by udise_code)
const getPendingVts = async (req, res) => {
  try {
    const headmasterUdise = req.user.udise_code;

    if (!headmasterUdise) {
      return res.status(400).json({
        status: false,
        message: 'Your account is not linked to a school UDISE code. Contact administrator.',
      });
    }

    const pendingVts = await User.findPendingVtsByUdise(headmasterUdise);

    return res.status(200).json({
      status: true,
      count: pendingVts.length,
      message: `${pendingVts.length} pending VT registration(s) for your school.`,
      data: pendingVts,
    });
  } catch (error) {
    console.error('getPendingVts error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── GET /api/vt/all ─────────────────────────────────────────────────────────
// Admin views all VT registrations with optional status filter
const getAllVts = async (req, res) => {
  const { status } = req.query; // pending | accepted | rejected

  try {
    const vts = await User.findAllVtsByStatus(status || null);
    return res.status(200).json({
      status: true,
      count: vts.length,
      data: vts,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── PATCH /api/vt/:userId/approve ───────────────────────────────────────────
// Headmaster approves a VT — account becomes active
const approveVt = async (req, res) => {
  const { userId } = req.params;

  try {
    // Verify the VT belongs to the headmaster's school
    const validationError = await _validateVtBelongsToHeadmaster(userId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await User.updateApprovalStatus(userId, 'accepted', req.user.id);

    if (!updated) {
      return res.status(404).json({
        status: false,
        message: 'VT not found or not in pending state.',
      });
    }

    return res.status(200).json({
      status: true,
      message: `Vocational Teacher "${updated.name}" has been approved and can now login.`,
      data: updated,
    });
  } catch (error) {
    console.error('approveVt error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── PATCH /api/vt/:userId/reject ───────────────────────────────────────────
// Headmaster rejects a VT — account stays inactive
const rejectVt = async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;

  try {
    // Verify the VT belongs to the headmaster's school
    const validationError = await _validateVtBelongsToHeadmaster(userId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await User.updateApprovalStatus(userId, 'rejected', req.user.id);

    if (!updated) {
      return res.status(404).json({
        status: false,
        message: 'VT not found or not in pending state.',
      });
    }

    return res.status(200).json({
      status: true,
      message: `Vocational Teacher "${updated.name}" registration has been rejected.`,
      reason: reason || null,
      data: updated,
    });
  } catch (error) {
    console.error('rejectVt error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── Internal helper ──────────────────────────────────────────────────────────
// Validates that the VT being approved/rejected is from the headmaster's school
// super_admin and admin skip this check
const _validateVtBelongsToHeadmaster = async (vtUserId, headmaster) => {
  // super_admin and admin can approve any VT
  if (['super_admin', 'admin'].includes(headmaster.role_name)) return null;

  if (!headmaster.udise_code) {
    return {
      status: 400,
      body: { status: false, message: 'Your account is not linked to a school UDISE code.' },
    };
  }

  // Check the VT's school UDISE code matches the headmaster's
  const { pool } = require('../config/db');
  const result = await pool.query(`
    SELECT v.udise_code
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

  const vtUdise = result.rows[0].udise_code;
  if (String(vtUdise) !== String(headmaster.udise_code)) {
    return {
      status: 403,
      body: {
        status: false,
        message: 'You are not authorized to approve VTs from a different school.',
      },
    };
  }

  return null;
};

module.exports = { getPendingVts, getAllVts, approveVt, rejectVt };
