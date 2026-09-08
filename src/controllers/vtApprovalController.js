const User = require('../models/User');
const { pool } = require('../config/db');

const requestMobileUpdate = async (req, res) => {
  const newMobile = String(req.body?.new_mobile_number ?? '').trim();
  if (!/^\d{10}$/.test(newMobile)) {
    return res.status(400).json({ status: false, message: 'new_mobile_number must contain exactly 10 digits.' });
  }

  try {
    const staffResult = await pool.query(`
      SELECT v.* FROM vt_staff_details v
      JOIN users u ON u.vt_staff_id = v.id
      WHERE u.id = $1 LIMIT 1
    `, [req.user.id]);
    const staff = staffResult.rows[0];
    if (!staff) return res.status(404).json({ status: false, message: 'Your account is not linked to a VT staff record.' });
    if (String(staff.vt_mob || '') === newMobile) {
      return res.status(400).json({ status: false, message: 'New mobile number must be different from the current number.' });
    }
    if (staff.vtp_mobile_approved_status === 'pending') {
      return res.status(409).json({ status: false, message: 'A mobile update request is already pending.' });
    }
    const duplicate = await pool.query(`
      SELECT 1 FROM vt_staff_details
      WHERE id <> $1 AND (vt_mob = $2 OR (vtp_mobile_approved_status = 'pending' AND old_mobile_number = $2))
      UNION ALL
      SELECT 1 FROM users WHERE id <> $3 AND phone = $2
      LIMIT 1
    `, [staff.id, newMobile, req.user.id]);
    if (duplicate.rows.length) {
      return res.status(409).json({ status: false, message: 'This mobile number is already in use or pending approval.' });
    }
    const result = await pool.query(`
      UPDATE vt_staff_details SET old_mobile_number = $1,
        vtp_mobile_approved_status = 'pending', mobile_number_approved_at = NULL, updated_at = NOW()
      WHERE id = $2 RETURNING id, vt_mob, old_mobile_number, vtp_mobile_approved_status
    `, [newMobile, staff.id]);
    return res.status(201).json({
      status: true,
      message: 'Mobile update request submitted successfully.',
      data: {
        vt_staff_id: result.rows[0].id,
        current_mobile_number: String(result.rows[0].vt_mob),
        requested_mobile_number: String(result.rows[0].old_mobile_number),
        status: result.rows[0].vtp_mobile_approved_status,
      },
    });
  } catch (error) {
    console.error('requestMobileUpdate error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to submit mobile update request.' });
  }
};

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
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim() || null : null;
  if (remarks?.length > 1000) {
    return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
  }
  const { pool } = require('../config/db');

  try {
    // ── 1. Verify the VT belongs to the headmaster's school ──────────────────
    const validationError = await _validateVtBelongsToHeadmaster(userId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    // ── 2. Gate: school timing must be configured before approving any VT ────
    const principalUdise = req.user.udise_code;
    if (principalUdise) {
      const schoolRow = await pool.query(
        `SELECT sch_open_time, sch_close_time, grace_time
           FROM mst_schools
          WHERE udise_sch_code = $1
          LIMIT 1`,
        [principalUdise]
      );

      const school = schoolRow.rows[0];
      const timingMissing =
        !school ||
        school.sch_open_time == null ||
        school.sch_close_time == null ||
        school.grace_time == null;

      if (timingMissing) {
        return res.status(400).json({
          status: false,
          code: 'SCHOOL_TIMING_NOT_SET',
          message:
            'School timing (open time, close time, grace time) is not configured for your school. ' +
            'Please set up the school timing first before approving Vocational Teachers.',
        });
      }
    }

    // ── 3. Perform approval ──────────────────────────────────────────────────
    const updated = await User.updateApprovalStatus(userId, 'accepted', req.user.id, remarks);

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
  const rawRemarks = req.body?.remarks ?? req.body?.reason;
  const remarks = typeof rawRemarks === 'string' ? rawRemarks.trim() || null : null;
  if (remarks?.length > 1000) {
    return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
  }

  try {
    // Verify the VT belongs to the headmaster's school
    const validationError = await _validateVtBelongsToHeadmaster(userId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await User.updateApprovalStatus(userId, 'rejected', req.user.id, remarks);

    if (!updated) {
      return res.status(404).json({
        status: false,
        message: 'VT not found or not in pending state.',
      });
    }

    return res.status(200).json({
      status: true,
      message: `Vocational Teacher "${updated.name}" registration has been rejected.`,
      reason: remarks,
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
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const {
      vt_name,
      vt_email,
      vt_mob,
      dob,
      educational_qualification,
      date_of_joining,
    } = req.body;

    const hasMobileField = Object.prototype.hasOwnProperty.call(req.body || {}, 'vt_mob');
    const requestedMobile = hasMobileField ? String(vt_mob ?? '').trim() : null;
    if (hasMobileField && !/^\d{10}$/.test(requestedMobile)) {
      return res.status(400).json({ status: false, message: 'vt_mob must contain exactly 10 digits.' });
    }

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

    await client.query('BEGIN');
    const staffResult = await client.query(`
      SELECT v.* FROM vt_staff_details v
      JOIN users u ON u.vt_staff_id = v.id
      WHERE u.id = $1
      FOR UPDATE OF v
    `, [userId]);
    const staff = staffResult.rows[0];
    if (!staff) {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: false, message: 'Your account is not linked to a VT staff record.' });
    }

    const currentMobile = String(staff.vt_mob || '');
    const mobileChanged = hasMobileField && requestedMobile !== currentMobile;
    let stageMobileRequest = false;
    let mobileUpdatePending = false;

    if (mobileChanged) {
      if (staff.vtp_mobile_approved_status === 'pending') {
        if (String(staff.old_mobile_number || '') !== requestedMobile) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            status: false,
            message: 'A different mobile update request is already pending. Wait for VTP approval or rejection.',
          });
        }
        mobileUpdatePending = true;
      } else {
        const duplicate = await client.query(`
          SELECT 1 FROM vt_staff_details
          WHERE id <> $1 AND (vt_mob = $2 OR (vtp_mobile_approved_status = 'pending' AND old_mobile_number = $2))
          UNION ALL
          SELECT 1 FROM users WHERE id <> $3 AND phone = $2
          LIMIT 1
        `, [staff.id, requestedMobile, userId]);
        if (duplicate.rows.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({ status: false, message: 'This mobile number is already in use or pending approval.' });
        }
        stageMobileRequest = true;
        mobileUpdatePending = true;
      }
    }

    const result = await client.query(
      `UPDATE vt_staff_details SET
        vt_name                  = COALESCE($1,  vt_name),
        vt_email                 = COALESCE($2,  vt_email),
        dob                      = COALESCE($3,  dob),
        educational_qualification = COALESCE($4,  educational_qualification),
        date_of_joining          = COALESCE($5,  date_of_joining),
        old_mobile_number        = CASE WHEN $7 THEN $8::bigint ELSE old_mobile_number END,
        vtp_mobile_approved_status = CASE WHEN $7 THEN 'pending' ELSE vtp_mobile_approved_status END,
        mobile_number_approved_at = CASE WHEN $7 THEN NULL ELSE mobile_number_approved_at END,
        updated_at               = NOW()
      WHERE id = $6
      RETURNING *`,
      [
        vt_name || null,
        vt_email || null,
        dobParsed,
        educational_qualification || null,
        dateOfJoiningParsed,
        staff.id,
        stageMobileRequest,
        requestedMobile,
      ]
    );
    await client.query('COMMIT');

    return res.status(200).json({
      status: true,
      message: stageMobileRequest
        ? 'Profile updated and mobile update request submitted for VTP approval.'
        : 'VT profile updated successfully.',
      mobile_update_requested: stageMobileRequest,
      mobile_update_pending: mobileUpdatePending,
      data: {
        ...result.rows[0],
        requested_mobile_number: mobileUpdatePending ? requestedMobile : null,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateVtProfile error:', err.message);
    return res.status(500).json({ status: false, message: 'Server error while updating VT profile.' });
  } finally {
    client.release();
  }
};

module.exports = { getPendingVts, getAllVts, approveVt, rejectVt, getVtByMobile, updateVtProfile, requestMobileUpdate };
