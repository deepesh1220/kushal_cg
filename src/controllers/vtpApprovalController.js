const User = require('../models/User');
const Leave = require('../models/Leave');
const { pool } = require('../config/db');
const { approveCancellationLayer } = require('../services/leaveCancellationService');

const VTP_ROLE_NAME = 'vocational_teacher_provider';
const normalizeVtpName = (value) => String(value ?? '').trim().toLowerCase();
const clean = (value) => typeof value === 'string' ? value.trim() : value;

const validateStaffOwnership = async (staffId, user) => {
  const id = Number.parseInt(staffId, 10);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, message: 'Invalid VT staff ID.' };
  const result = await pool.query('SELECT * FROM vt_staff_details WHERE id = $1', [id]);
  if (!result.rows.length) return { status: 404, message: 'VT staff record not found.' };
  if (!['admin', 'super_admin'].includes(user.role_name)
      && String(result.rows[0].vtp_id || '').trim() !== String(user.vtp_id || '').trim()) {
    return { status: 403, message: 'You cannot manage a VT from another VTP.' };
  }
  return { staff: result.rows[0] };
};

const validateStaffPayload = (body = {}) => {
  const required = ['vt_name', 'vt_email', 'vt_mob', 'district_name', 'block_name', 'school_name', 'udise_code', 'trade'];
  const missing = required.filter((key) => !String(body[key] ?? '').trim());
  if (missing.length) return `Required fields missing: ${missing.join(', ')}`;
  if (!/^\S+@\S+\.\S+$/.test(String(body.vt_email))) return 'Please enter a valid email address.';
  if (!/^\d{10}$/.test(String(body.vt_mob))) return 'Mobile number must contain exactly 10 digits.';
  if (body.vt_aadhar && !/^\d{12}$/.test(String(body.vt_aadhar))) return 'Aadhaar number must contain exactly 12 digits.';
  if (body.vtp_pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(body.vtp_pan).toUpperCase())) return 'Please enter a valid PAN number.';
  if (body.remarks && String(body.remarks).length > 1000) return 'Remarks cannot exceed 1000 characters.';
  return null;
};

const getVtpIdentity = async (user) => {
  const result = await pool.query(
    'SELECT vtp_id, vtp_name FROM mst_vtp WHERE TRIM(vtp_id) = TRIM($1::text) LIMIT 1',
    [String(user.vtp_id || '')]
  );
  return result.rows[0] || null;
};

const getVtStaffOptions = async (req, res) => {
  try {
    const { type, district_cd, block_cd, cluster_cd, search = '' } = req.query;
    let result;
    if (type === 'districts') {
      result = await pool.query('SELECT district_cd, district_name FROM mst_district ORDER BY district_name');
    } else if (type === 'blocks') {
      if (!district_cd) return res.status(400).json({ status: false, message: 'district_cd is required.' });
      result = await pool.query('SELECT block_cd, block_name FROM mst_block WHERE district_cd = $1 ORDER BY block_name', [district_cd]);
    } else if (type === 'clusters') {
      if (!district_cd || !block_cd) return res.status(400).json({ status: false, message: 'district_cd and block_cd are required.' });
      result = await pool.query('SELECT cluster_cd, cluster_name FROM mst_cluster WHERE district_cd = $1 AND block_cd = $2 ORDER BY cluster_name', [district_cd, block_cd]);
    } else if (type === 'schools') {
      if (!district_cd || !block_cd || !cluster_cd) return res.status(400).json({ status: false, message: 'Complete location selection is required.' });
      result = await pool.query(`SELECT udise_sch_code AS udise_code, school_name FROM mst_schools
        WHERE district_cd=$1 AND block_cd=$2 AND cluster_cd=$3
        AND ($4::text='' OR CAST(udise_sch_code AS text) ILIKE '%'||$4::text||'%' OR school_name ILIKE '%'||$4::text||'%')
        ORDER BY school_name LIMIT 100`, [district_cd, block_cd, cluster_cd, clean(search)]);
    } else if (type === 'trades') {
      result = await pool.query(`SELECT DISTINCT trade FROM vt_staff_details WHERE TRIM(vtp_id)=TRIM($1::text) AND NULLIF(TRIM(trade),'') IS NOT NULL ORDER BY trade`, [String(req.user.vtp_id || '')]);
    } else if (type === 'vtp') {
      const identity = await getVtpIdentity(req.user);
      result = { rows: identity ? [identity] : [] };
    } else return res.status(400).json({ status: false, message: 'Invalid option type.' });
    return res.json({ status: true, data: result.rows });
  } catch (error) {
    console.error('getVtStaffOptions error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to load form options.' });
  }
};

const getVtStaffById = async (req, res) => {
  try {
    const check = await validateStaffOwnership(req.params.staffId, req.user);
    if (!check.staff) return res.status(check.status).json({ status: false, message: check.message });
    const location = await pool.query(`SELECT district_cd, block_cd, cluster_cd FROM mst_schools
      WHERE TRIM(CAST(udise_sch_code AS text))=TRIM($1::text) LIMIT 1`, [String(check.staff.udise_code || '')]);
    return res.json({ status: true, data: { ...check.staff, ...(location.rows[0] || {}) } });
  } catch (error) {
    console.error('getVtStaffById error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to fetch VT details.' });
  }
};

// GET /api/vtp/vt-staff - all VT master records belonging to logged-in VTP
const getVtpStaffList = async (req, res) => {
  try {
    if (!req.user.vtp_id) {
      return res.status(400).json({ status: false, message: 'Your account is not linked to a VTP ID.' });
    }
    const requestedPage = Number.parseInt(req.query.page, 10);
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const pageSize = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10;
    const search = String(req.query.search || '').trim();
    const params = [String(req.user.vtp_id)];
    let searchClause = '';
    if (search) {
      params.push(`%${search}%`);
      searchClause = `AND (
        v.vt_name ILIKE $2 OR v.vt_email ILIKE $2 OR CAST(v.vt_mob AS text) ILIKE $2
        OR v.trade ILIKE $2 OR v.district_name ILIKE $2 OR v.block_name ILIKE $2
        OR s.cluster_name ILIKE $2 OR v.school_name ILIKE $2
        OR CAST(v.udise_code AS text) ILIKE $2 OR v.vtp_pan ILIKE $2
        OR CAST(v.vt_aadhar AS text) ILIKE $2
      )`;
    }
    const countResult = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM vt_staff_details v
      LEFT JOIN mst_schools s
        ON TRIM(CAST(s.udise_sch_code AS text)) = TRIM(CAST(v.udise_code AS text))
      WHERE TRIM(v.vtp_id) = TRIM($1::text) ${searchClause}
    `, params);
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
    const currentPage = Math.min(
      Number.isInteger(requestedPage) ? Math.max(requestedPage, 1) : 1,
      totalPages
    );
    const dataParams = [...params, pageSize, (currentPage - 1) * pageSize];
    const limitPosition = dataParams.length - 1;
    const offsetPosition = dataParams.length;
    const result = await pool.query(`
      SELECT v.id, v.vt_name, v.vt_email, v.vt_mob, v.dob, v.trade,
             v.district_name, v.block_name, s.cluster_name,
             v.school_name, v.udise_code, v.vtp_pan, v.vt_aadhar, v.remarks
      FROM vt_staff_details v
      LEFT JOIN mst_schools s
        ON TRIM(CAST(s.udise_sch_code AS text)) = TRIM(CAST(v.udise_code AS text))
      WHERE TRIM(v.vtp_id) = TRIM($1::text) ${searchClause}
      ORDER BY v.vt_name ASC, v.id ASC
      LIMIT $${limitPosition} OFFSET $${offsetPosition}
    `, dataParams);
    return res.json({
      status: true,
      data: result.rows,
      pagination: { currentPage, pageSize, totalItems, totalPages },
    });
  } catch (error) {
    console.error('getVtpStaffList error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to load VT staff list.' });
  }
};

// GET /api/vtp/dashboard/counts - summary scoped to logged-in VTP
const getVtpDashboardCounts = async (req, res) => {
  try {
    if (!req.user.vtp_id) {
      return res.status(400).json({ status: false, message: 'Your account is not linked to a VTP ID.' });
    }
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT udise_code) FILTER (WHERE udise_code IS NOT NULL)::int AS total_schools,
        COUNT(*)::int AS total_vts,
        COUNT(DISTINCT LOWER(TRIM(trade))) FILTER (WHERE NULLIF(TRIM(trade), '') IS NOT NULL)::int AS total_trades
      FROM vt_staff_details
      WHERE TRIM(vtp_id) = TRIM($1::text)
    `, [String(req.user.vtp_id)]);
    return res.json({
      status: true,
      data: result.rows[0] || { total_schools: 0, total_vts: 0, total_trades: 0 },
    });
  } catch (error) {
    console.error('getVtpDashboardCounts error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to load VTP dashboard counts.' });
  }
};

const saveVtStaff = async (req, res, isUpdate) => {
  const validation = validateStaffPayload(req.body);
  if (validation) return res.status(400).json({ status: false, message: validation });
  const client = await pool.connect();
  try {
    const identity = await getVtpIdentity(req.user);
    if (!identity) return res.status(400).json({ status: false, message: 'Logged-in account is not linked to a valid VTP.' });
    let existing = null;
    if (isUpdate) {
      const check = await validateStaffOwnership(req.params.staffId, req.user);
      if (!check.staff) return res.status(check.status).json({ status: false, message: check.message });
      existing = check.staff;
    }
    await client.query('BEGIN');
    const schoolResult = await client.query(`SELECT school_name, district_name, block_name FROM mst_schools
      WHERE TRIM(CAST(udise_sch_code AS text))=TRIM($1::text) LIMIT 1`, [String(req.body.udise_code)]);
    if (!schoolResult.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ status: false, message: 'Selected school/UDISE is invalid.' }); }
    const duplicate = await client.query(`
      SELECT id FROM vt_staff_details
      WHERE (vt_mob=$1 OR (vtp_mobile_approved_status='pending' AND old_mobile_number=$1) OR LOWER(vt_email)=LOWER($2))
        AND ($3::int IS NULL OR id<>$3::int)
      UNION ALL
      SELECT id FROM users WHERE phone=$1 AND ($3::int IS NULL OR vt_staff_id IS NULL OR vt_staff_id<>$3::int)
      LIMIT 1
    `, [req.body.vt_mob, clean(req.body.vt_email), existing?.id || null]);
    if (duplicate.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ status: false, message: 'A different VT already uses this mobile or email.' }); }
    const school = schoolResult.rows[0];
    const values = [school.district_name, school.block_name, school.school_name, req.body.udise_code, identity.vtp_name, clean(req.body.vt_name), clean(req.body.trade), req.body.vt_mob, clean(req.body.vtp_pan)?.toUpperCase() || null, req.body.vt_aadhar || null, clean(req.body.vt_email).toLowerCase(), identity.vtp_id, clean(req.body.remarks) || null];
    let result;
    if (isUpdate) {
      result = await client.query(`UPDATE vt_staff_details SET district_name=$1,block_name=$2,school_name=$3,udise_code=$4,vtp_name=$5,vt_name=$6,trade=$7,
        old_mobile_number=CASE WHEN vt_mob IS DISTINCT FROM $8::bigint THEN vt_mob ELSE old_mobile_number END,
        mobile_number_approved_at=CASE WHEN vt_mob IS DISTINCT FROM $8::bigint THEN NOW() ELSE mobile_number_approved_at END,
        vtp_mobile_approved_status=CASE WHEN vt_mob IS DISTINCT FROM $8::bigint THEN 'approved' ELSE vtp_mobile_approved_status END,
        vt_mob=$8,vtp_pan=$9,vt_aadhar=$10,vt_email=$11,vtp_id=$12,remarks=$13,updated_at=NOW() WHERE id=$14 RETURNING *`, [...values, existing.id]);
      await client.query('UPDATE users SET name=$1,email=$2,phone=$3,vtp_id=$4,updated_at=NOW() WHERE vt_staff_id=$5', [values[5], values[10], values[7], identity.vtp_id, existing.id]);
    } else {
      await client.query('SELECT pg_advisory_xact_lock(731904)');
      const next = await client.query('SELECT COALESCE(MAX(id),0)+1 AS id FROM vt_staff_details');
      result = await client.query(`INSERT INTO vt_staff_details (id,district_name,block_name,school_name,udise_code,vtp_name,vt_name,trade,vt_mob,vtp_pan,vt_aadhar,vt_email,vtp_id,remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [next.rows[0].id, ...values]);
    }
    await client.query('COMMIT');
    return res.status(isUpdate ? 200 : 201).json({ status: true, message: `VT details ${isUpdate ? 'updated' : 'added'} successfully.`, data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('saveVtStaff error:', error.message);
    return res.status(500).json({ status: false, message: `Unable to ${isUpdate ? 'update' : 'add'} VT details.` });
  } finally { client.release(); }
};

const createVtStaff = (req, res) => saveVtStaff(req, res, false);
const updateVtStaff = (req, res) => saveVtStaff(req, res, true);

const deleteVtStaff = async (req, res) => {
  const client = await pool.connect();
  try {
    const check = await validateStaffOwnership(req.params.staffId, req.user);
    if (!check.staff) return res.status(check.status).json({ status: false, message: check.message });
    await client.query('BEGIN');
    await client.query('DELETE FROM users WHERE vt_staff_id=$1', [check.staff.id]);
    await client.query('DELETE FROM vt_staff_details WHERE id=$1', [check.staff.id]);
    await client.query('COMMIT');
    return res.json({ status: true, message: 'VT registration deleted successfully.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('deleteVtStaff error:', error.message);
    return res.status(409).json({ status: false, message: 'This VT cannot be deleted because related records exist.' });
  } finally { client.release(); }
};

const getVtMobileUpdateRequests = async (req, res) => {
  try {
    const requestedPage = Number.parseInt(req.query.page, 10);
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const page = Number.isInteger(requestedPage) ? Math.max(requestedPage, 1) : 1;
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10;
    const search = String(req.query.search || '').trim();
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role_name);
    if (!isAdmin && !req.user.vtp_id) {
      return res.status(400).json({ status: false, message: 'Your account is not linked to a VTP ID.' });
    }
    const params = [];
    let where = `WHERE v.vtp_mobile_approved_status = 'pending'`;
    if (!isAdmin) {
      params.push(String(req.user.vtp_id));
      where += ` AND TRIM(v.vtp_id) = TRIM($${params.length}::text)`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (v.vt_name ILIKE $${params.length} OR v.school_name ILIKE $${params.length}
        OR CAST(v.vt_mob AS text) ILIKE $${params.length} OR CAST(v.old_mobile_number AS text) ILIKE $${params.length})`;
    }
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM vt_staff_details v ${where}`, params);
    const totalItems = count.rows[0]?.total || 0;
    const totalPages = Math.max(Math.ceil(totalItems / limit), 1);
    const currentPage = Math.min(page, totalPages);
    const dataParams = [...params, limit, (currentPage - 1) * limit];
    const result = await pool.query(`
      SELECT v.id AS vt_staff_id, u.id AS user_id, v.vt_name, v.school_name, v.udise_code,
        v.vt_mob AS current_mobile_number, v.old_mobile_number AS requested_mobile_number,
        v.vtp_mobile_approved_status AS status, v.updated_at AS requested_at
      FROM vt_staff_details v
      LEFT JOIN users u ON u.vt_staff_id = v.id
      ${where}
      ORDER BY v.updated_at DESC, v.id DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `, dataParams);
    return res.json({
      status: true,
      data: result.rows,
      pagination: { currentPage, pageSize: limit, totalItems, totalPages },
    });
  } catch (error) {
    console.error('getVtMobileUpdateRequests error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to load mobile update requests.' });
  }
};

const updateVtMobileRequestStatus = async (req, res) => {
  const staffId = Number.parseInt(req.params.staffId, 10);
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!Number.isInteger(staffId) || staffId <= 0) return res.status(400).json({ status: false, message: 'Invalid VT staff ID.' });
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ status: false, message: 'Status must be approved or rejected.' });
  }
  const ownership = await validateStaffOwnership(staffId, req.user);
  if (!ownership.staff) return res.status(ownership.status).json({ status: false, message: ownership.message });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const staffResult = await client.query(
      'SELECT * FROM vt_staff_details WHERE id = $1 FOR UPDATE', [staffId]
    );
    const staff = staffResult.rows[0];
    if (staff.vtp_mobile_approved_status !== 'pending' || !staff.old_mobile_number) {
      await client.query('ROLLBACK');
      return res.status(409).json({ status: false, message: 'No pending mobile update request exists for this VT.' });
    }
    const userResult = await client.query('SELECT id FROM users WHERE vt_staff_id = $1 FOR UPDATE', [staffId]);
    const userId = userResult.rows[0]?.id || null;

    if (status === 'approved') {
      const duplicate = await client.query(`
        SELECT 1 FROM vt_staff_details WHERE id <> $1 AND vt_mob = $2
        UNION ALL SELECT 1 FROM users WHERE ($3::int IS NULL OR id <> $3) AND phone = $2 LIMIT 1
      `, [staffId, staff.old_mobile_number, userId]);
      if (duplicate.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ status: false, message: 'Requested mobile number is already in use.' });
      }
      const updated = await client.query(`
        UPDATE vt_staff_details SET vt_mob = old_mobile_number, old_mobile_number = vt_mob,
          vtp_mobile_approved_status = 'approved', mobile_number_approved_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *
      `, [staffId]);
      if (userId) await client.query('UPDATE users SET phone = $1, updated_at = NOW() WHERE id = $2', [staff.old_mobile_number, userId]);
      await client.query('COMMIT');
      return res.json({ status: true, message: 'Mobile update request approved successfully.', data: updated.rows[0] });
    }

    const updated = await client.query(`
      UPDATE vt_staff_details SET old_mobile_number = NULL,
        vtp_mobile_approved_status = 'rejected', mobile_number_approved_at = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [staffId]);
    await client.query('COMMIT');
    return res.json({ status: true, message: 'Mobile update request rejected.', data: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('updateVtMobileRequestStatus error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to update mobile request status.' });
  } finally {
    client.release();
  }
};

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

  if (normalizeVtpName(result.rows[0].vtp_name) !== normalizeVtpName(vtpName)) {
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
  if (normalizeVtpName(result.rows[0].vtp_name) !== normalizeVtpName(vtpName)) {
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
    console.log("vtpUser", vtpUser);

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
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim() || null : null;
  if (remarks?.length > 1000) {
    return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
  }

  try {
    const validationError = await _validateVtBelongsToVtp(userId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await User.updateVtpApprovalStatus(userId, 'accepted', req.user.id, remarks);

    if (!updated) {
      return res.status(404).json({
        status: false,
        message: 'VT not found or has no VTP approval row.',
      });
    }

    return res.status(200).json({
      status: true,
      message: updated.is_active
        ? `Vocational Teacher "${updated.name}" has been fully approved (HM (Head Master) + VTP) and can now login.`
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
  const rawRemarks = req.body?.remarks ?? req.body?.reason;
  const remarks = typeof rawRemarks === 'string' ? rawRemarks.trim() || null : null;
  if (remarks?.length > 1000) {
    return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
  }

  try {
    const validationError = await _validateVtBelongsToVtp(userId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await User.updateVtpApprovalStatus(userId, 'rejected', req.user.id, remarks);

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
    const { status, principal_status, vtp_status, from_date, to_date, teacher_code, page, limit } = req.query;
    const allowedStatuses = ['pending', 'approved', 'rejected'];
    const requestedPrincipalStatus = principal_status?.toLowerCase();
    const requestedVtpStatus = (vtp_status || status)?.toLowerCase();
    if (requestedPrincipalStatus && !allowedStatuses.includes(requestedPrincipalStatus)) {
      return res.status(400).json({ status: false, message: 'Invalid principal_status filter.' });
    }
    if (requestedVtpStatus && !allowedStatuses.includes(requestedVtpStatus)) {
      return res.status(400).json({ status: false, message: 'Invalid vtp_status filter.' });
    }

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

    const vtpId = ['super_admin', 'admin'].includes(vtpUser.role_name) ? null : vtpUser.vtp_id;

    const result = await Leave.getVtpLeaves(vtpId, {
      principal_status: requestedPrincipalStatus,
      vtp_status: requestedVtpStatus,
      from_date,
      to_date,
      teacher_code,
      page,
      limit,
    });

    return res.status(200).json({
      success: true,
      scope: { vtp_id: vtpId },
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
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim() || null : null;
  if (remarks?.length > 1000) {
    return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
  }

  try {
    const validationError = await _validateLeaveBelongsToVtp(parsedLeaveId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await Leave.updateVtpStatus(parsedLeaveId, { status: 'approved', reviewerId: req.user.id, remarks });

    if (!updated) {
      return res.status(404).json({ status: false, message: 'Leave request not found.' });
    }

    let deductionInfo = null;
    if (updated.leave_approved) {
      try {
        const LeaveBalance = require('../models/LeaveBalance');
        // Lazy-credit annual EL if not yet credited this FY
        await LeaveBalance.ensureAnnualCredit(updated.user_id);

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

      try {
        await Leave.reconcileApprovedAttendance(updated);
      } catch (attendanceError) {
        console.error(`[Leave ${parsedLeaveId}] Attendance reconciliation error:`, attendanceError.message);
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
  const rawRemarks = req.body?.remarks ?? req.body?.reason;
  const remarks = typeof rawRemarks === 'string' ? rawRemarks.trim() || null : null;
  if (remarks?.length > 1000) {
    return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
  }

  try {
    const validationError = await _validateLeaveBelongsToVtp(parsedLeaveId, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const updated = await Leave.updateVtpStatus(parsedLeaveId, { status: 'rejected', reviewerId: req.user.id, remarks });

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

// Approves a VT's request to cancel only today's portion of an approved leave.
const approveLeaveCancellationByVtp = async (req, res) => {
  const cancellationRequestId = Number.parseInt(req.params.cancellationRequestId, 10);
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim() || null : null;
  if (!Number.isInteger(cancellationRequestId) || cancellationRequestId <= 0) {
    return res.status(400).json({ status: false, message: 'Invalid cancellation request ID.' });
  }
  if (remarks?.length > 1000) {
    return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
  }

  try {
    const requestLookup = await pool.query(
      'SELECT leave_request_id FROM leave_cancellation_requests WHERE id = $1',
      [cancellationRequestId]
    );
    if (!requestLookup.rows.length) {
      return res.status(404).json({ status: false, message: 'Leave cancellation request not found.' });
    }
    const validationError = await _validateLeaveBelongsToVtp(requestLookup.rows[0].leave_request_id, req.user);
    if (validationError) return res.status(validationError.status).json(validationError.body);

    const result = await approveCancellationLayer({
      cancellationRequestId,
      layer: 'vtp',
      reviewerId: req.user.id,
      remarks,
    });
    return res.json({
      status: true,
      message: result.message,
      data: result.cancellation,
    });
  } catch (error) {
    console.error('approveLeaveCancellationByVtp error:', error.message);
    return res.status(error.statusCode || 500).json({
      status: false,
      message: error.statusCode ? error.message : 'Unable to approve leave cancellation.',
    });
  }
};

module.exports = {
  getVtpScopedVts,
  getVtStaffOptions,
  getVtpStaffList,
  getVtpDashboardCounts,
  getVtStaffById,
  createVtStaff,
  updateVtStaff,
  deleteVtStaff,
  approveVtByVtp,
  rejectVtByVtp,
  getVtpScopedLeaves,
  approveLeaveByVtp,
  rejectLeaveByVtp,
  approveLeaveCancellationByVtp,
  getVtMobileUpdateRequests,
  updateVtMobileRequestStatus
};

