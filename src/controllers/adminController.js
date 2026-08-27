const { pool } = require('../config/db');
const { parseCoordinates } = require('../utils/locationUtils');

// GET /api/admin/dashboard-counts
const getDashboardCounts = async (req, res) => {
  try {
    const [schoolsRes, vtpRes, deoRes, vtStaffRes, vtTradeRes] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM mst_schools where vtp = 1'),
      pool.query('SELECT COUNT(*) AS count FROM vtp'),
      pool.query('SELECT COUNT(*) AS count FROM mst_deo'),
      pool.query('SELECT COUNT(*) AS count FROM vt_staff_details'),
      pool.query(`
        SELECT COUNT(DISTINCT LOWER(TRIM(trade))) FILTER (
          WHERE NULLIF(TRIM(trade), '') IS NOT NULL
        ) AS count
        FROM vt_staff_details
      `),
    ]);

    return res.status(200).json({
      status: true,
      message: 'Dashboard counts fetched successfully.',
      data: {
        total_schools: parseInt(schoolsRes.rows[0].count, 10),
        total_vc: parseInt(vtpRes.rows[0].count, 10),
        total_deo: parseInt(deoRes.rows[0].count, 10),
        total_vt_staff: parseInt(vtStaffRes.rows[0].count, 10),
        total_trades: parseInt(vtTradeRes.rows[0].count, 10),
      },
    });
  } catch (error) {
    console.error('getDashboardCounts error:', error.message);
    return res.status(500).json({
      status: false,
      message: 'Server error fetching dashboard counts.',
    });
  }
};

const getPaginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
};

// GET /api/admin/trades
// Distinct VTP/trade combinations used by the admin Trades List page.
const getTrades = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const search = String(req.query.search || '').trim();
    const params = [];
    let searchClause = '';

    if (search) {
      params.push(`%${search}%`);
      searchClause = `WHERE trade_name ILIKE $1 OR vtp_names ILIKE $1`;
    }

    const normalizedTradesCte = `
      WITH normalized_pairs AS (
        SELECT
          LOWER(TRIM(trade)) AS trade_key,
          MIN(TRIM(trade)) AS trade_name,
          MIN(TRIM(vtp_name)) AS vtp_name
        FROM vt_staff_details
        WHERE NULLIF(TRIM(vtp_name), '') IS NOT NULL
          AND NULLIF(TRIM(trade), '') IS NOT NULL
        GROUP BY LOWER(TRIM(trade)), LOWER(TRIM(vtp_name))
      ), normalized_trades AS (
        SELECT
          MIN(trade_name) AS trade_name,
          STRING_AGG(vtp_name, ', ' ORDER BY LOWER(vtp_name)) AS vtp_names
        FROM normalized_pairs
        GROUP BY trade_key
      )
    `;

    const countResult = await pool.query(`
      ${normalizedTradesCte}
      SELECT COUNT(*)::int AS count
      FROM normalized_trades
      ${searchClause}
    `, params);
    const total = Number(countResult.rows[0]?.count || 0);

    const dataParams = [...params, limit, offset];
    const limitIndex = dataParams.length - 1;
    const offsetIndex = dataParams.length;
    const dataResult = await pool.query(`
      ${normalizedTradesCte}
      SELECT trade_name, vtp_names
      FROM normalized_trades
      ${searchClause}
      ORDER BY LOWER(trade_name)
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `, dataParams);

    return sendPaginatedResponse(
      res,
      'Trades list fetched successfully.',
      dataResult.rows,
      total,
      page,
      limit
    );
  } catch (error) {
    console.error('getTrades error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching trades list.' });
  }
};

const sendPaginatedResponse = (res, message, rows, total, page, limit) => {
  return res.status(200).json({
    status: true,
    message,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
    data: rows,
  });
};

const normalizeReportStatus = (status) => (
  ['pending', 'approved', 'rejected'].includes(status) ? status : null
);

const normalizeVtpPayload = (body = {}) => ({
  vtp_id: String(body.vtp_id || '').trim(),
  vtp_name: String(body.vtp_name || '').trim(),
  vc_name: String(body.vc_name || '').trim(),
  mobile: String(body.mobile || '').trim(),
  email: String(body.email || '').trim().toLowerCase(),
  status: String(body.status || 'active').trim().toLowerCase(),
});

const validateVtpPayload = (payload) => {
  if (!payload.vtp_id || !payload.vtp_name || !payload.vc_name || !payload.mobile || !payload.email) {
    return 'VTP ID, VTP name, coordinator name, mobile, and email are required.';
  }
  if (!/^\d{2}$/.test(payload.vtp_id)) return 'VTP ID must be exactly 2 digits.';
  if (!/^\d{10}$/.test(payload.mobile)) return 'Mobile number must be exactly 10 digits.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return 'Please enter a valid email address.';
  if (!['active', 'inactive'].includes(payload.status)) return 'Status must be active or inactive.';
  if (payload.vtp_name.length > 200 || payload.vc_name.length > 200 || payload.email.length > 200) {
    return 'VTP name, coordinator name, and email must not exceed 200 characters.';
  }
  return null;
};

const isUniqueViolation = (error) => error?.code === '23505';

const getTrackingVtsByView = async (req, res, view) => {
  const { page, limit, offset } = getPaginationParams(req.query);
  const search = String(req.query.search || '').trim();
  const districtCd = parseInt(req.query.district_cd, 10);
  const blockCd = parseInt(req.query.block_cd, 10);
  const clusterCd = parseInt(req.query.cluster_cd, 10);
  const params = [];
  const conditions = [];

  let fromClause = `
    FROM vt_staff_details v
    LEFT JOIN mst_schools s ON s.udise_sch_code = v.udise_code
  `;
  let selectColumns = `
    v.id,
    v.vt_name,
    v.school_name,
    v.udise_code,
    v.vtp_name,
    v.trade,
    COALESCE(s.district_name, v.district_name) AS district_name,
    COALESCE(s.block_name, v.block_name) AS block_name,
    s.cluster_name
  `;

  let reportMonth = null;
  let reportYear = null;
  if (view === 'approved_vts') {
    reportMonth = parseInt(req.query.month, 10);
    reportYear = parseInt(req.query.year, 10);
    if (!Number.isInteger(reportMonth) || reportMonth < 1 || reportMonth > 12 ||
        !Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2200) {
      return res.status(400).json({ status: false, message: 'A valid month and year are required.' });
    }

    params.push(reportMonth, reportYear);
    conditions.push('r.report_month = $1', 'r.report_year = $2');
    conditions.push(`COALESCE(r.hm_approval_status, 'pending') = 'approved'`);
    conditions.push(`COALESCE(r.vtp_approval_status, 'pending') = 'approved'`);
    conditions.push(`COALESCE(r.deo_approval_status, 'pending') = 'approved'`);
    fromClause = `
      FROM monthly_school_reports r
      JOIN users u ON u.id = r.user_id
      JOIN vt_staff_details v ON v.id = u.vt_staff_id
      LEFT JOIN mst_schools s ON s.udise_sch_code = v.udise_code
    `;
    selectColumns = `
      r.id,
      v.id AS vt_staff_id,
      v.vt_name,
      v.school_name,
      v.udise_code,
      v.vtp_name,
      v.trade,
      COALESCE(s.district_name, v.district_name) AS district_name,
      COALESCE(s.block_name, v.block_name) AS block_name,
      s.cluster_name,
      r.report_month,
      r.report_year,
      r.hm_approval_status,
      r.vtp_approval_status,
      r.deo_approval_status
    `;
  }

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(
      v.vt_name ILIKE $${params.length}
      OR v.school_name ILIKE $${params.length}
      OR CAST(v.udise_code AS TEXT) ILIKE $${params.length}
      OR v.vtp_name ILIKE $${params.length}
      OR v.trade ILIKE $${params.length}
    )`);
  }
  if (!Number.isNaN(districtCd)) {
    params.push(districtCd);
    conditions.push(`s.district_cd = $${params.length}`);
  }
  if (!Number.isNaN(blockCd)) {
    params.push(blockCd);
    conditions.push(`s.block_cd = $${params.length}`);
  }
  if (!Number.isNaN(clusterCd)) {
    params.push(clusterCd);
    conditions.push(`s.cluster_cd = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const summaryResult = await pool.query(`
    SELECT
      COUNT(*)::int AS total_vts,
      COUNT(DISTINCT v.udise_code)::int AS total_schools,
      COUNT(DISTINCT LOWER(TRIM(v.vtp_name))) FILTER (WHERE NULLIF(TRIM(v.vtp_name), '') IS NOT NULL)::int AS total_vtps,
      COUNT(DISTINCT LOWER(TRIM(v.trade))) FILTER (WHERE NULLIF(TRIM(v.trade), '') IS NOT NULL)::int AS total_trades
    ${fromClause}
    ${whereClause}
  `, params);
  const total = Number(summaryResult.rows[0]?.total_vts || 0);

  const dataParams = [...params, limit, offset];
  const limitIndex = dataParams.length - 1;
  const offsetIndex = dataParams.length;
  const dataResult = await pool.query(`
    SELECT ${selectColumns}
    ${fromClause}
    ${whereClause}
    ORDER BY LOWER(v.vt_name), v.id
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `, dataParams);

  return res.status(200).json({
    status: true,
    message: view === 'approved_vts' ? 'Approved VTs fetched successfully.' : 'All VTs fetched successfully.',
    view,
    month: reportMonth,
    year: reportYear,
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    summary: summaryResult.rows[0] || {},
    data: dataResult.rows,
  });
};

// GET /api/admin/attendance-tracking
const getAttendanceTracking = async (req, res) => {
  try {
    const view = String(req.query.view || 'all_vts').trim().toLowerCase();
    if (!['all_vts', 'approved_vts'].includes(view)) {
      return res.status(400).json({ status: false, message: 'Invalid view. Use all_vts or approved_vts.' });
    }
    return await getTrackingVtsByView(req, res, view);

    /* Legacy report-level tracking query retained below for migration reference. */
    const { page, limit, offset } = getPaginationParams(req.query);
    const currentDate = new Date();
    const reportMonth = Math.min(12, Math.max(1, parseInt(req.query.month, 10) || currentDate.getMonth() + 1));
    const reportYear = parseInt(req.query.year, 10) || currentDate.getFullYear();
    const status = normalizeReportStatus(req.query.status);
    const search = req.query.search?.trim();
    const districtCd = parseInt(req.query.district_cd, 10);
    const blockCd = parseInt(req.query.block_cd, 10);
    const clusterCd = parseInt(req.query.cluster_cd, 10);

    const params = [reportMonth, reportYear];
    const conditions = ['r.report_month = $1', 'r.report_year = $2'];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        CAST(r.udise_code AS TEXT) ILIKE $${params.length}
        OR s.school_name ILIKE $${params.length}
        OR s.district_name ILIKE $${params.length}
        OR s.block_name ILIKE $${params.length}
      )`);
    }

    if (status) {
      params.push(status);
      conditions.push(`(
        COALESCE(r.hm_approval_status, 'pending') = $${params.length}
        OR COALESCE(r.vtp_approval_status, 'pending') = $${params.length}
        OR COALESCE(r.deo_approval_status, 'pending') = $${params.length}
      )`);
    }

    if (!Number.isNaN(districtCd)) {
      params.push(districtCd);
      conditions.push(`s.district_cd = $${params.length}`);
    }

    if (!Number.isNaN(blockCd)) {
      params.push(blockCd);
      conditions.push(`s.block_cd = $${params.length}`);
    }

    if (!Number.isNaN(clusterCd)) {
      params.push(clusterCd);
      conditions.push(`s.cluster_cd = $${params.length}`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(`
      SELECT COUNT(*) AS count
      FROM monthly_school_reports r
      LEFT JOIN mst_schools s ON r.udise_code = s.udise_sch_code
      ${whereClause}
    `, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const summaryResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total_reports,
        COUNT(*) FILTER (WHERE COALESCE(r.hm_approval_status, 'pending') = 'approved')::int AS hm_approved,
        COUNT(*) FILTER (WHERE COALESCE(r.vtp_approval_status, 'pending') = 'approved')::int AS vtp_approved,
        COUNT(*) FILTER (WHERE COALESCE(r.deo_approval_status, 'pending') = 'approved')::int AS deo_approved,
        COUNT(*) FILTER (
          WHERE COALESCE(r.hm_approval_status, 'pending') = 'approved'
            AND COALESCE(r.vtp_approval_status, 'pending') = 'approved'
            AND COALESCE(r.deo_approval_status, 'pending') = 'approved'
        )::int AS fully_approved,
        COUNT(*) FILTER (
          WHERE COALESCE(r.hm_approval_status, 'pending') = 'rejected'
            OR COALESCE(r.vtp_approval_status, 'pending') = 'rejected'
            OR COALESCE(r.deo_approval_status, 'pending') = 'rejected'
        )::int AS rejected_reports
      FROM monthly_school_reports r
      LEFT JOIN mst_schools s ON r.udise_code = s.udise_sch_code
      ${whereClause}
    `, params);

    const dataParams = [...params, limit, offset];
    const limitIndex = dataParams.length - 1;
    const offsetIndex = dataParams.length;

    const dataResult = await pool.query(`
      SELECT
        r.id,
        r.udise_code,
        r.report_month,
        r.report_year,
        COALESCE(r.hm_approval_status, 'pending') AS hm_approval_status,
        COALESCE(r.vtp_approval_status, 'pending') AS vtp_approval_status,
        COALESCE(r.deo_approval_status, 'pending') AS deo_approval_status,
        r.hm_remarks,
        r.vtp_remarks,
        r.deo_remarks,
        r.created_at,
        r.updated_at,
        COALESCE(s.school_name, 'School not found') AS school_name,
        s.district_name,
        s.block_name,
        s.cluster_name
      FROM monthly_school_reports r
      LEFT JOIN mst_schools s ON r.udise_code = s.udise_sch_code
      ${whereClause}
      ORDER BY r.updated_at DESC, r.created_at DESC, r.id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `, dataParams);

    return res.status(200).json({
      status: true,
      message: 'VT approval reports fetched successfully.',
      month: reportMonth,
      year: reportYear,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
      summary: summaryResult.rows[0] || {
        total_reports: 0,
        hm_approved: 0,
        vtp_approved: 0,
        deo_approved: 0,
        fully_approved: 0,
        rejected_reports: 0,
      },
      data: dataResult.rows,
    });
  } catch (error) {
    console.error('getAttendanceTracking error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching VT approval reports.' });
  }
};

// GET /api/admin/schools
const getSchools = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { search } = req.query;
    const districtCd = parseInt(req.query.district_cd, 10);
    const blockCd = parseInt(req.query.block_cd, 10);
    const clusterCd = parseInt(req.query.cluster_cd, 10);
    const params = [];
    const conditions = ['vtp = 1'];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        school_name ILIKE $${params.length}
        OR CAST(udise_sch_code AS TEXT) ILIKE $${params.length}
        OR district_name ILIKE $${params.length}
        OR block_name ILIKE $${params.length}
        OR cluster_name ILIKE $${params.length}
      )`);
    }

    if (!Number.isNaN(districtCd)) {
      params.push(districtCd);
      conditions.push(`district_cd = $${params.length}`);
    }

    if (!Number.isNaN(blockCd)) {
      params.push(blockCd);
      conditions.push(`block_cd = $${params.length}`);
    }

    if (!Number.isNaN(clusterCd)) {
      params.push(clusterCd);
      conditions.push(`cluster_cd = $${params.length}`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const countResult = await pool.query(`SELECT COUNT(*) AS count FROM mst_schools ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await pool.query(`
      SELECT
        id,
        udise_sch_code,
        school_name,
        edu_state_cd,
        edu_state_name,
        district_cd,
        district_name,
        block_cd,
        block_name,
        cluster_cd,
        cluster_name,
        lgd_state_id,
        lgd_district_id,
        lgd_block_id,
        sch_status_id,
        address,
        email,
        sch_mobile
      FROM mst_schools
      ${whereClause}
      ORDER BY school_name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return sendPaginatedResponse(res, 'Schools fetched successfully.', dataResult.rows, total, page, limit);
  } catch (error) {
    console.error('getSchools error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching schools.' });
  }
};

// GET /api/admin/schools/:udiseCode/location
const getSchoolLocationByUdise = async (req, res) => {
  try {
    const udiseCode = String(req.params.udiseCode || '').trim();

    if (!/^\d+$/.test(udiseCode)) {
      return res.status(400).json({
        status: false,
        message: 'A valid UDISE code is required.',
      });
    }

    const result = await pool.query(`
      SELECT udise_sch_code, school_name, latitude, longitude
      FROM mst_schools
      WHERE CAST(udise_sch_code AS TEXT) = $1
      LIMIT 1
    `, [udiseCode]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: 'School not found for the provided UDISE code.',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'School location fetched successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('getSchoolLocationByUdise error:', error.message);
    return res.status(500).json({
      status: false,
      message: 'Server error fetching school location.',
    });
  }
};

// PATCH /api/admin/schools/:udiseCode/location
const updateSchoolLocationByUdise = async (req, res) => {
  try {
    const udiseCode = String(req.params.udiseCode || '').trim();
    const { latitude, longitude } = req.body || {};

    if (!/^\d+$/.test(udiseCode)) {
      return res.status(400).json({
        status: false,
        message: 'A valid UDISE code is required.',
      });
    }

    if (latitude === undefined || latitude === null
      || longitude === undefined || longitude === null) {
      return res.status(400).json({
        status: false,
        message: 'Latitude and longitude are required.',
      });
    }

    const coordinates = parseCoordinates(latitude, longitude);
    if (!coordinates) {
      return res.status(400).json({
        status: false,
        message: 'Latitude must be between -90 and 90, and longitude must be between -180 and 180.',
      });
    }

    const result = await pool.query(`
      UPDATE mst_schools
      SET latitude = $1,
          longitude = $2
      WHERE CAST(udise_sch_code AS TEXT) = $3
      RETURNING udise_sch_code, school_name, latitude, longitude
    `, [coordinates.latitude, coordinates.longitude, udiseCode]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: 'School not found for the provided UDISE code.',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'School location updated successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('updateSchoolLocationByUdise error:', error.message);
    return res.status(500).json({
      status: false,
      message: 'Server error updating school location.',
    });
  }
};

// GET /api/admin/vtp
const getVtpList = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { search } = req.query;
    const districtCd = parseInt(req.query.district_cd, 10);
    const blockCd = parseInt(req.query.block_cd, 10);
    const clusterCd = parseInt(req.query.cluster_cd, 10);
    const params = [];
    const conditions = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        vtp_name ILIKE $${params.length}
        OR vc_name ILIKE $${params.length}
        OR email ILIKE $${params.length}
        OR CAST(mobile AS TEXT) ILIKE $${params.length}
      )`);
    }

    if (!Number.isNaN(districtCd)) {
      params.push(districtCd);
      conditions.push(`EXISTS (
        SELECT 1
        FROM vt_staff_details vs
        JOIN mst_schools ms ON ms.udise_sch_code = vs.udise_code
        WHERE (
          (vs.vtp_id IS NOT NULL AND v.vtp_id IS NOT NULL AND vs.vtp_id = v.vtp_id)
          OR (vs.vtp_id IS NULL AND vs.vtp_name = v.vtp_name)
        )
        AND ms.vtp = 1
        AND ms.district_cd = $${params.length}
      )`);
    }

    if (!Number.isNaN(blockCd)) {
      params.push(blockCd);
      conditions.push(`EXISTS (
        SELECT 1
        FROM vt_staff_details vs
        JOIN mst_schools ms ON ms.udise_sch_code = vs.udise_code
        WHERE (
          (vs.vtp_id IS NOT NULL AND v.vtp_id IS NOT NULL AND vs.vtp_id = v.vtp_id)
          OR (vs.vtp_id IS NULL AND vs.vtp_name = v.vtp_name)
        )
        AND ms.vtp = 1
        AND ms.block_cd = $${params.length}
      )`);
    }

    if (!Number.isNaN(clusterCd)) {
      params.push(clusterCd);
      conditions.push(`EXISTS (
        SELECT 1
        FROM vt_staff_details vs
        JOIN mst_schools ms ON ms.udise_sch_code = vs.udise_code
        WHERE (
          (vs.vtp_id IS NOT NULL AND v.vtp_id IS NOT NULL AND vs.vtp_id = v.vtp_id)
          OR (vs.vtp_id IS NULL AND vs.vtp_name = v.vtp_name)
        )
        AND ms.vtp = 1
        AND ms.cluster_cd = $${params.length}
      )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) AS count FROM vtp v ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await pool.query(`
      SELECT
        id,
        vtp_id,
        vc_name,
        vtp_name,
        mobile,
        email,
        status,
        created_at,
        updated_at
      FROM vtp v
      ${whereClause}
      ORDER BY vtp_name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return sendPaginatedResponse(res, 'VTP list fetched successfully.', dataResult.rows, total, page, limit);
  } catch (error) {
    console.error('getVtpList error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching VTP list.' });
  }
};

// GET /api/admin/vtp-options
const getVtpOptions = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT TRIM(vtp_id) AS vtp_id, vtp_name
      FROM mst_vtp
      ORDER BY vtp_name ASC
    `);
    return res.status(200).json({ status: true, data: result.rows });
  } catch (error) {
    console.error('getVtpOptions error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching VTP options.' });
  }
};

// POST /api/admin/vtp
const createVtp = async (req, res) => {
  const payload = normalizeVtpPayload(req.body);
  const validationError = validateVtpPayload(payload);
  if (validationError) return res.status(400).json({ status: false, message: validationError });

  try {
    const masterResult = await pool.query(
      'SELECT vtp_name FROM mst_vtp WHERE TRIM(vtp_id) = $1 AND LOWER(vtp_name) = LOWER($2)',
      [payload.vtp_id, payload.vtp_name]
    );
    if (!masterResult.rowCount) {
      return res.status(400).json({ status: false, message: 'Selected VTP ID and VTP name do not match the VTP master.' });
    }

    const result = await pool.query(`
      INSERT INTO vtp (vtp_id, vtp_name, vc_name, mobile, email, status)
      VALUES ($1, $2, $3, $4::bigint, $5, $6)
      RETURNING id, TRIM(vtp_id) AS vtp_id, vtp_name, vc_name, mobile, email, status, created_at, updated_at
    `, [payload.vtp_id, masterResult.rows[0].vtp_name, payload.vc_name, payload.mobile, payload.email, payload.status]);

    return res.status(201).json({ status: true, message: 'VTP provider created successfully.', data: result.rows[0] });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ status: false, message: 'A VTP provider with this email or mobile already exists.' });
    }
    console.error('createVtp error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error creating VTP provider.' });
  }
};

// PUT /api/admin/vtp/:id
const updateVtp = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ status: false, message: 'Invalid VTP provider ID.' });

  const payload = normalizeVtpPayload(req.body);
  const validationError = validateVtpPayload(payload);
  if (validationError) return res.status(400).json({ status: false, message: validationError });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query('SELECT * FROM vtp WHERE id = $1 FOR UPDATE', [id]);
    if (!existingResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: false, message: 'VTP provider not found.' });
    }

    const masterResult = await client.query(
      'SELECT vtp_name FROM mst_vtp WHERE TRIM(vtp_id) = $1 AND LOWER(vtp_name) = LOWER($2)',
      [payload.vtp_id, payload.vtp_name]
    );
    if (!masterResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: false, message: 'Selected VTP ID and VTP name do not match the VTP master.' });
    }

    const existing = existingResult.rows[0];
    const result = await client.query(`
      UPDATE vtp
      SET vtp_id = $1, vtp_name = $2, vc_name = $3, mobile = $4::bigint,
          email = $5, status = $6, updated_at = NOW()
      WHERE id = $7
      RETURNING id, TRIM(vtp_id) AS vtp_id, vtp_name, vc_name, mobile, email, status, created_at, updated_at
    `, [payload.vtp_id, masterResult.rows[0].vtp_name, payload.vc_name, payload.mobile, payload.email, payload.status, id]);

    await client.query(`
      UPDATE users u
      SET name = $1, email = $2, phone = $3::bigint, organization_name = $4,
          vtp_id = $5, is_active = $6, updated_at = NOW()
      FROM roles r
      WHERE u.role_id = r.id
        AND r.name = 'vocational_teacher_provider'
        AND (u.email = $7 OR u.phone = $8)
    `, [payload.vc_name, payload.email, payload.mobile, masterResult.rows[0].vtp_name,
      payload.vtp_id, payload.status === 'active', existing.email, existing.mobile]);

    await client.query('COMMIT');
    return res.status(200).json({ status: true, message: 'VTP provider updated successfully.', data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(error)) {
      return res.status(409).json({ status: false, message: 'A VTP provider with this email or mobile already exists.' });
    }
    console.error('updateVtp error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error updating VTP provider.' });
  } finally {
    client.release();
  }
};

// DELETE /api/admin/vtp/:id
const deleteVtp = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ status: false, message: 'Invalid VTP provider ID.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query('SELECT * FROM vtp WHERE id = $1 FOR UPDATE', [id]);
    if (!existingResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: false, message: 'VTP provider not found.' });
    }

    const existing = existingResult.rows[0];
    await client.query(`
      UPDATE users u
      SET is_active = FALSE, updated_at = NOW()
      FROM roles r
      WHERE u.role_id = r.id
        AND r.name = 'vocational_teacher_provider'
        AND (u.email = $1 OR u.phone = $2)
    `, [existing.email, existing.mobile]);
    await client.query('DELETE FROM vtp WHERE id = $1', [id]);
    await client.query('COMMIT');

    return res.status(200).json({ status: true, message: 'VTP provider deleted successfully.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('deleteVtp error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error deleting VTP provider.' });
  } finally {
    client.release();
  }
};

const normalizeDeoUpdatePayload = (body = {}) => ({
  deo_name: String(body.deo_name || '').trim(),
  email: String(body.email || '').trim().toLowerCase(),
  mobile: String(body.mobile || '').trim(),
});

const validateDeoUpdatePayload = (payload) => {
  if (!payload.deo_name || !payload.email || !payload.mobile) {
    return 'DEO name, email, and mobile are required.';
  }
  if (payload.deo_name.length > 255) return 'DEO name must not exceed 255 characters.';
  if (payload.email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return 'Please enter a valid email address.';
  }
  if (!/^\d{10}$/.test(payload.mobile)) return 'Mobile number must be exactly 10 digits.';
  return null;
};

// PUT /api/admin/deos/:id
const updateDeo = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ status: false, message: 'Invalid DEO ID.' });
  }

  const payload = normalizeDeoUpdatePayload(req.body);
  const validationError = validateDeoUpdatePayload(payload);
  if (validationError) return res.status(400).json({ status: false, message: validationError });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query('SELECT * FROM mst_deo WHERE id = $1 FOR UPDATE', [id]);
    if (!existingResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: false, message: 'DEO record not found.' });
    }

    const duplicateResult = await client.query(`
      SELECT id
      FROM mst_deo
      WHERE id <> $1
        AND (LOWER(email) = $2 OR mobile = $3::bigint)
      LIMIT 1
    `, [id, payload.email, payload.mobile]);
    if (duplicateResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ status: false, message: 'A DEO with this email or mobile already exists.' });
    }

    const existing = existingResult.rows[0];
    const updatedResult = await client.query(`
      UPDATE mst_deo
      SET deo_name = $1, email = $2, mobile = $3::bigint
      WHERE id = $4
      RETURNING id, district_cd, district_name, deo_name, mobile, alternate_mobile, designation, email
    `, [payload.deo_name, payload.email, payload.mobile, id]);

    await client.query(`
      UPDATE users u
      SET name = $1, email = $2, phone = $3::bigint, updated_at = NOW()
      FROM roles r
      WHERE u.role_id = r.id
        AND r.name = 'deo'
        AND (u.email = $4 OR u.phone = $5)
    `, [payload.deo_name, payload.email, payload.mobile, existing.email, existing.mobile]);

    await client.query('COMMIT');
    return res.status(200).json({
      status: true,
      message: 'DEO details updated successfully.',
      data: updatedResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(error)) {
      return res.status(409).json({ status: false, message: 'This email or mobile is already in use.' });
    }
    console.error('updateDeo error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error updating DEO details.' });
  } finally {
    client.release();
  }
};

// GET /api/admin/deos
const getDeoList = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { search } = req.query;
    const districtCd = parseInt(req.query.district_cd, 10);
    const blockCd = parseInt(req.query.block_cd, 10);
    const clusterCd = parseInt(req.query.cluster_cd, 10);
    const params = [];
    const conditions = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        deo_name ILIKE $${params.length}
        OR district_name ILIKE $${params.length}
        OR designation ILIKE $${params.length}
        OR email ILIKE $${params.length}
        OR CAST(mobile AS TEXT) ILIKE $${params.length}
      )`);
    }

    if (!Number.isNaN(districtCd)) {
      params.push(districtCd);
      conditions.push(`district_cd = $${params.length}`);
    }

    if (!Number.isNaN(blockCd)) {
      params.push(blockCd);
      conditions.push(`EXISTS (
        SELECT 1 FROM mst_schools s
        WHERE s.vtp = 1
          AND s.district_cd = d.district_cd
          AND s.block_cd = $${params.length}
      )`);
    }

    if (!Number.isNaN(clusterCd)) {
      params.push(clusterCd);
      conditions.push(`EXISTS (
        SELECT 1 FROM mst_schools s
        WHERE s.vtp = 1
          AND s.district_cd = d.district_cd
          AND s.cluster_cd = $${params.length}
      )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) AS count FROM mst_deo d ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await pool.query(`
      SELECT
        id,
        district_cd,
        district_name,
        deo_name,
        mobile,
        alternate_mobile,
        designation,
        email
      FROM mst_deo d
      ${whereClause}
      ORDER BY district_name ASC, deo_name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return sendPaginatedResponse(res, 'DEO list fetched successfully.', dataResult.rows, total, page, limit);
  } catch (error) {
    console.error('getDeoList error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching DEO list.' });
  }
};

module.exports = {
  getDashboardCounts,
  getTrades,
  getAttendanceTracking,
  getSchools,
  getSchoolLocationByUdise,
  updateSchoolLocationByUdise,
  getVtpList,
  getVtpOptions,
  createVtp,
  updateVtp,
  deleteVtp,
  getDeoList,
  updateDeo,
  getCount: getDashboardCounts,
};
