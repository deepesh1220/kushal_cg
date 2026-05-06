const User = require('../models/User');

// ─── GET /api/vt/pending ──────────────────────────────────────────────────────
// Headmaster views VTs for their school (matched by udise_code) with status filter
const getPendingVts = async (req, res) => {
  try {
    const headmasterUdise = req.user.udise_code;
    const { status } = req.query; // all, pending, accepted, rejected

    if (!headmasterUdise) {
      return res.status(400).json({
        status: false,
        message: 'Your account is not linked to a school UDISE code. Contact administrator.',
      });
    }

    const allVts = await User.findVtsByUdise(headmasterUdise);

    let pendingCount = 0;
    let acceptedCount = 0;
    let rejectedCount = 0;

    allVts.forEach(vt => {
      if (vt.vt_approval_status === 'pending') pendingCount++;
      else if (vt.vt_approval_status === 'accepted') acceptedCount++;
      else if (vt.vt_approval_status === 'rejected') rejectedCount++;
    });

    let filteredVts = allVts;
    if (status && status !== 'all') {
      filteredVts = allVts.filter(vt => vt.vt_approval_status === status);
    }

    return res.status(200).json({
      status: true,
      counts: {
        total: allVts.length,
        pending: pendingCount,
        accepted: acceptedCount,
        rejected: rejectedCount
      },
      message: `Found ${filteredVts.length} VT(s) matching criteria.`,
      data: filteredVts,
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

// ─── POST /api/vt/by-mobile ────────────────────────────────────────────────────────────
// Get VT staff details from vt_staff_details table using mobile number
const getVtByMobile = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({ status: false, message: 'mobile is required.' });
    }

    const { pool } = require('../config/db');

    const result = await pool.query(
      `SELECT * FROM vt_staff_details WHERE vt_mob = $1 LIMIT 1`,
      [String(mobile)]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        status: false,
        message: 'No VT staff found with the provided mobile number.',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'VT staff details fetched successfully.',
      data: result.rows[0],
    });
  } catch (err) {
    console.error('getVtByMobile error:', err.message);
    return res.status(500).json({ status: false, message: 'Server error while fetching VT details.' });
  }
};

// ─── PATCH /api/vt/update-profile ─────────────────────────────────────────────────────────────
// Update VT's own profile on vt_staff_details table.
// Authenticated VT only — matches record by their linked vt_staff_id.
// Updatable fields:
//   vt_name, vt_email, vt_mob, vt_aadhar, vtp_pan,
//   dob, educational_qualification, date_of_joining
const updateVtProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { pool } = require('../config/db');

    // Resolve vt_staff_id from users table
    const userRow = await pool.query(
      `SELECT vt_staff_id FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    const vtStaffId = userRow.rows[0]?.vt_staff_id;
    if (!vtStaffId) {
      return res.status(400).json({
        status: false,
        message: 'Your account is not linked to a VT staff record.',
      });
    }

    const {
      vt_name,
      vt_email,
      vt_mob,
      dob,
      educational_qualification,
      date_of_joining,
    } = req.body;

    // Helper: convert DD-MM-YYYY → YYYY-MM-DD (also accepts YYYY-MM-DD passthrough)
    const parseDate = (raw) => {
      if (!raw) return null;
      const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/;
      const m = String(raw).match(ddmmyyyy);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`; // YYYY-MM-DD
      return raw; // already ISO or null handled above
    };

    const dobParsed = parseDate(dob);
    const dateOfJoiningParsed = parseDate(date_of_joining);

    const result = await pool.query(
      `UPDATE vt_staff_details SET
        vt_name                  = COALESCE($1,  vt_name),
        vt_email                 = COALESCE($2,  vt_email),
        vt_mob                   = COALESCE($3,  vt_mob),
        dob                      = COALESCE($4,  dob),
        educational_qualification = COALESCE($5,  educational_qualification),
        date_of_joining          = COALESCE($6,  date_of_joining),
        updated_at               = NOW()
      WHERE id = $7
      RETURNING *`,
      [
        vt_name || null,
        vt_email || null,
        vt_mob || null,
        dobParsed,
        educational_qualification || null,
        dateOfJoiningParsed,
        vtStaffId,
      ]
    );

    return res.status(200).json({
      status: true,
      message: 'VT profile updated successfully.',
      data: result.rows[0],
    });
  } catch (err) {
    console.error('updateVtProfile error:', err.message);
    return res.status(500).json({ status: false, message: 'Server error while updating VT profile.' });
  }
};

module.exports = { getPendingVts, getAllVts, approveVt, rejectVt, getVtByMobile, updateVtProfile };
