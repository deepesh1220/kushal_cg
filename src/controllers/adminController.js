const { pool } = require('../config/db');

// GET /api/admin/dashboard-counts
const getDashboardCounts = async (req, res) => {
  try {
    const [schoolsRes, vtpRes, deoRes, vtStaffRes, vtTradeRes] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM mst_schools where vtp = 1'),
      pool.query('SELECT COUNT(*) AS count FROM vtp'),
      pool.query('SELECT COUNT(*) AS count FROM mst_deo'),
      pool.query('SELECT COUNT(*) AS count FROM vt_staff_details'),
      pool.query('SELECT COUNT(DISTINCT trade) AS count FROM vt_staff_details'),
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

// GET /api/admin/attendance-tracking
const getAttendanceTracking = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const currentDate = new Date();
    const reportMonth = Math.min(12, Math.max(1, parseInt(req.query.month, 10) || currentDate.getMonth() + 1));
    const reportYear = parseInt(req.query.year, 10) || currentDate.getFullYear();
    const status = normalizeReportStatus(req.query.status);
    const search = req.query.search?.trim();

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
      message: 'Attendance tracking reports fetched successfully.',
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
    return res.status(500).json({ status: false, message: 'Server error fetching attendance tracking reports.' });
  }
};

// GET /api/admin/schools
const getSchools = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { search } = req.query;
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

// GET /api/admin/vtp
const getVtpList = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { search } = req.query;
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

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) AS count FROM vtp ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await pool.query(`
      SELECT
        id,
        vc_name,
        vtp_name,
        mobile,
        email,
        status,
        created_at,
        updated_at
      FROM vtp
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

// GET /api/admin/deos
const getDeoList = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { search } = req.query;
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

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) AS count FROM mst_deo ${whereClause}`, params);
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
      FROM mst_deo
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
  getAttendanceTracking,
  getSchools,
  getVtpList,
  getDeoList,
  getCount: getDashboardCounts,
};
