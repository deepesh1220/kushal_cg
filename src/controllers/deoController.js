const { pool } = require('../config/db');
const User = require('../models/User');

const getPaginationParams = (query, defaultLimit = 10, maxLimit = 100) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const resolveDeoProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return { user: null, deo: null };

  let deo = null;
  if (user.email) {
    const byEmail = await pool.query('SELECT * FROM mst_deo WHERE email = $1 LIMIT 1', [user.email]);
    deo = byEmail.rows[0] || null;
  }

  if (!deo && user.phone) {
    const byPhone = await pool.query('SELECT * FROM mst_deo WHERE mobile = $1 LIMIT 1', [user.phone]);
    deo = byPhone.rows[0] || null;
  }

  return { user, deo };
};

// GET /api/deo/schools-vts
const getSchoolsAndVts = async (req, res) => {
  try {
    const { user, deo } = await resolveDeoProfile(req.user.id);

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }
    if (!deo) {
      return res.status(403).json({ status: false, message: 'DEO profile not found.' });
    }

    const { udise_code, vtUserId, month, year } = req.query;
    const reportMonth = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    const reportYear = year ? parseInt(year, 10) : new Date().getFullYear();

    const districtCd = deo.district_cd;

    const schoolParams = [districtCd];
    let schoolWhere = 'WHERE vtp = 1 AND district_cd = $1';

    if (udise_code) {
      schoolParams.push(udise_code);
      schoolWhere += ` AND udise_sch_code = $${schoolParams.length}`;
    }

    const schoolsResult = await pool.query(`
      SELECT udise_sch_code AS udise_code, school_name, block_name, district_name
      FROM mst_schools
      ${schoolWhere}
    `, schoolParams);

    const schools = schoolsResult.rows;

    if (!schools.length) {
      return res.status(200).json({
        status: true,
        data: [],
        counts: { schools: 0, vts: 0, vtps: 0 },
        message: 'No schools found for this district.',
      });
    }

    const udiseCodes = schools.map((s) => s.udise_code);
    const vtParams = [udiseCodes];
    let vtWhere = 'WHERE v.udise_code = ANY($1)';

    if (vtUserId) {
      vtParams.push(vtUserId);
      vtWhere += ` AND u.id = $${vtParams.length}`;
    }

    vtParams.push(reportMonth, reportYear);
    const monthParamIdx = vtParams.length - 1;
    const yearParamIdx = vtParams.length;

    const vtsResult = await pool.query(`
      SELECT
        v.id AS vt_staff_id,
        u.id AS user_id,
        v.vt_name,
        v.vt_mob,
        v.vt_email,
        v.trade,
        v.vtp_name,
        v.udise_code,
        COALESCE(msr.hm_approval_status, 'pending') AS hm_approval_status,
        COALESCE(msr.vtp_approval_status, 'pending') AS vtp_approval_status,
        COALESCE(msr.deo_approval_status, 'pending') AS deo_approval_status
      FROM vt_staff_details v
      LEFT JOIN users u ON u.vt_staff_id = v.id
      LEFT JOIN monthly_school_reports msr
        ON msr.user_id = u.id
        AND msr.report_month = $${monthParamIdx}
        AND msr.report_year = $${yearParamIdx}
      ${vtWhere}
    `, vtParams);

    const vts = vtsResult.rows;

    const schoolsWithVts = schools
      .map((school) => ({
        ...school,
        vts: vts.filter((vt) => String(vt.udise_code) === String(school.udise_code)),
      }))
      .filter((school) => (vtUserId ? school.vts.length > 0 : true));

    const uniqueVtps = new Set(vts.filter((vt) => vt.vtp_name).map((vt) => vt.vtp_name));

    return res.status(200).json({
      status: true,
      message: 'Schools and VTs fetched successfully.',
      district: {
        district_cd: deo.district_cd,
        district_name: deo.district_name,
      },
      counts: {
        schools: schoolsWithVts.length,
        vts: vts.length,
        vtps: uniqueVtps.size,
      },
      data: schoolsWithVts,
    });
  } catch (error) {
    console.error('getSchoolsAndVts error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching schools and VTs.' });
  }
};

// GET /api/deo/dashboard-counts
const getDeoDashboardCounts = async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();

    const { user, deo } = await resolveDeoProfile(req.user.id);

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }
    if (!deo) {
      return res.status(403).json({ status: false, message: 'DEO profile not found.' });
    }

    const districtCd = deo.district_cd;

    const schoolsResult = await pool.query(
      'SELECT COUNT(*) AS count FROM mst_schools WHERE vtp = 1 AND district_cd = $1',
      [districtCd]
    );
    const totalSchools = parseInt(schoolsResult.rows[0].count, 10);

    const vtsResult = await pool.query(`
      SELECT COUNT(*) AS count
      FROM vt_staff_details v
      JOIN mst_schools s ON v.udise_code = s.udise_sch_code
      WHERE s.vtp = 1 AND s.district_cd = $1
    `, [districtCd]);
    const totalVts = parseInt(vtsResult.rows[0].count, 10);

    const reportsResult = await pool.query(`
      SELECT r.deo_approval_status, COUNT(*) AS count
      FROM monthly_school_reports r
      JOIN mst_schools s ON r.udise_code = s.udise_sch_code
      WHERE s.vtp = 1
        AND s.district_cd = $1
        AND r.report_month = $2
        AND r.report_year = $3
      GROUP BY r.deo_approval_status
    `, [districtCd, currentMonth, currentYear]);

    let approved = 0;
    let rejected = 0;
    let pending = 0;

    reportsResult.rows.forEach((row) => {
      if (row.deo_approval_status === 'approved') approved += parseInt(row.count, 10);
      else if (row.deo_approval_status === 'rejected') rejected += parseInt(row.count, 10);
      else if (row.deo_approval_status === 'pending') pending += parseInt(row.count, 10);
    });

    const totalGenerated = approved + rejected + pending;
    const notGenerated = totalSchools > totalGenerated ? totalSchools - totalGenerated : 0;

    return res.status(200).json({
      status: true,
      message: 'Dashboard counts fetched successfully.',
      district: {
        district_cd: deo.district_cd,
        district_name: deo.district_name,
      },
      data: {
        total_schools: totalSchools,
        total_vts: totalVts,
        reports: {
          month: currentMonth,
          year: currentYear,
          approved,
          rejected,
          pending: pending + notGenerated,
          explicit_pending: pending,
          not_generated: notGenerated,
          total_generated: totalGenerated,
        },
      },
    });
  } catch (error) {
    console.error('getDeoDashboardCounts error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching DEO dashboard counts.' });
  }
};

// GET /api/deo/school-reports
const getSchoolReports = async (req, res) => {
  try {
    const {
      month,
      year,
      udise_code,
      page = 1,
      limit = 50,
      status,
      search,
      block_cd,
      cluster_cd,
    } = req.query;

    const currentMonth = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offsetNum = (pageNum - 1) * limitNum;

    const { user, deo } = await resolveDeoProfile(req.user.id);

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }
    if (!deo) {
      return res.status(403).json({ status: false, message: 'DEO profile not found.' });
    }

    const districtCd = deo.district_cd;

    const params = [districtCd, currentMonth, currentYear];
    const schoolDeoStatusExpr = `
      CASE
        WHEN COALESCE(ss.total_teachers, 0) > 0
          AND COALESCE(ss.deo_approved_teachers, 0) = COALESCE(ss.total_teachers, 0)
          THEN 'approved'
        WHEN COALESCE(ss.deo_rejected_teachers, 0) > 0
          THEN 'rejected'
        ELSE 'pending'
      END
    `;
    let whereClause = 's.vtp = 1 AND s.district_cd = $1';

    if (udise_code) {
      params.push(udise_code);
      whereClause += ` AND s.udise_sch_code = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      whereClause += ` AND (
        s.school_name ILIKE $${params.length}
        OR CAST(s.udise_sch_code AS TEXT) ILIKE $${params.length}
        OR s.block_name ILIKE $${params.length}
        OR s.district_name ILIKE $${params.length}
      )`;
    }

    if (status && status !== 'all') {
      params.push(status);
      whereClause += ` AND (${schoolDeoStatusExpr}) = $${params.length}`;
    }

    if (block_cd) {
      const blockCdNum = parseInt(block_cd, 10);
      if (!Number.isNaN(blockCdNum)) {
        params.push(blockCdNum);
        whereClause += ` AND s.block_cd = $${params.length}`;
      }
    }

    if (cluster_cd) {
      const clusterCdNum = parseInt(cluster_cd, 10);
      if (!Number.isNaN(clusterCdNum)) {
        params.push(clusterCdNum);
        whereClause += ` AND s.cluster_cd = $${params.length}`;
      }
    }

    const countResult = await pool.query(`
      WITH school_stats AS (
        SELECT
          s.udise_sch_code AS udise_code,
          COUNT(DISTINCT u.id)::int AS total_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.hm_approval_status, 'pending') = 'approved')::int AS hm_approved_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.hm_approval_status, 'pending') = 'pending')::int AS hm_pending_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.hm_approval_status, 'pending') = 'rejected')::int AS hm_rejected_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.deo_approval_status, 'pending') = 'approved')::int AS deo_approved_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.deo_approval_status, 'pending') = 'pending')::int AS deo_pending_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.deo_approval_status, 'pending') = 'rejected')::int AS deo_rejected_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.vtp_approval_status, 'pending') = 'approved')::int AS vtp_approved_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.vtp_approval_status, 'pending') = 'pending')::int AS vtp_pending_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.vtp_approval_status, 'pending') = 'rejected')::int AS vtp_rejected_teachers
        FROM mst_schools s
        LEFT JOIN vt_staff_details v ON v.udise_code = s.udise_sch_code
        LEFT JOIN users u ON u.vt_staff_id = v.id
        LEFT JOIN monthly_school_reports msr
          ON msr.user_id = u.id
          AND msr.report_month = $2
          AND msr.report_year = $3
        GROUP BY s.udise_sch_code
      )
      SELECT COUNT(*)
      FROM mst_schools s
      LEFT JOIN school_stats ss ON ss.udise_code = s.udise_sch_code
      WHERE ${whereClause}
    `, params);

    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limitNum) || 1;

    const dataParams = [...params, limitNum, offsetNum];

    const result = await pool.query(`
      WITH school_stats AS (
        SELECT
          s.udise_sch_code AS udise_code,
          COUNT(DISTINCT u.id)::int AS total_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.hm_approval_status, 'pending') = 'approved')::int AS hm_approved_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.hm_approval_status, 'pending') = 'pending')::int AS hm_pending_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.hm_approval_status, 'pending') = 'rejected')::int AS hm_rejected_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.deo_approval_status, 'pending') = 'approved')::int AS deo_approved_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.deo_approval_status, 'pending') = 'pending')::int AS deo_pending_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.deo_approval_status, 'pending') = 'rejected')::int AS deo_rejected_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.vtp_approval_status, 'pending') = 'approved')::int AS vtp_approved_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.vtp_approval_status, 'pending') = 'pending')::int AS vtp_pending_teachers,
          COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(msr.vtp_approval_status, 'pending') = 'rejected')::int AS vtp_rejected_teachers
        FROM mst_schools s
        LEFT JOIN vt_staff_details v ON v.udise_code = s.udise_sch_code
        LEFT JOIN users u ON u.vt_staff_id = v.id
        LEFT JOIN monthly_school_reports msr
          ON msr.user_id = u.id
          AND msr.report_month = $2
          AND msr.report_year = $3
        GROUP BY s.udise_sch_code
      )
      SELECT
        s.udise_sch_code AS udise_code,
        s.school_name,
        s.block_name,
        s.district_name,
        $2::int AS report_month,
        $3::int AS report_year,
        COALESCE(ss.total_teachers, 0) AS total_teachers,
        COALESCE(ss.hm_approved_teachers, 0) AS hm_approved_teachers,
        COALESCE(ss.hm_pending_teachers, 0) AS hm_pending_teachers,
        COALESCE(ss.hm_rejected_teachers, 0) AS hm_rejected_teachers,
        COALESCE(ss.deo_approved_teachers, 0) AS deo_approved_teachers,
        COALESCE(ss.deo_pending_teachers, 0) AS deo_pending_teachers,
        COALESCE(ss.deo_rejected_teachers, 0) AS deo_rejected_teachers,
        COALESCE(ss.vtp_approved_teachers, 0) AS vtp_approved_teachers,
        COALESCE(ss.vtp_pending_teachers, 0) AS vtp_pending_teachers,
        COALESCE(ss.vtp_rejected_teachers, 0) AS vtp_rejected_teachers,
        CASE
          WHEN COALESCE(ss.total_teachers, 0) > 0
            AND COALESCE(ss.hm_approved_teachers, 0) = COALESCE(ss.total_teachers, 0)
            THEN 'approved'
          WHEN COALESCE(ss.hm_rejected_teachers, 0) > 0
            THEN 'rejected'
          ELSE 'pending'
        END AS hm_approval_status,
        CASE
          WHEN COALESCE(ss.total_teachers, 0) > 0
            AND COALESCE(ss.vtp_approved_teachers, 0) = COALESCE(ss.total_teachers, 0)
            THEN 'approved'
          WHEN COALESCE(ss.vtp_rejected_teachers, 0) > 0
            THEN 'rejected'
          ELSE 'pending'
        END AS vtp_approval_status,
        ${schoolDeoStatusExpr} AS deo_approval_status,
        NULL::TEXT AS hm_remarks,
        NULL::TEXT AS vtp_remarks,
        NULL::TEXT AS deo_remarks,
        (
          COALESCE(ss.total_teachers, 0) > 0
          AND COALESCE(ss.hm_approved_teachers, 0) = COALESCE(ss.total_teachers, 0)
        ) AS hm_all_approved
      FROM mst_schools s
      LEFT JOIN school_stats ss ON ss.udise_code = s.udise_sch_code
      WHERE ${whereClause}
      ORDER BY s.school_name ASC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `, dataParams);

    return res.status(200).json({
      status: true,
      message: 'School reports fetched successfully.',
      month: currentMonth,
      year: currentYear,
      district: {
        district_cd: deo.district_cd,
        district_name: deo.district_name,
      },
      pagination: {
        totalItems,
        totalPages,
        currentPage: pageNum,
        limit: limitNum,
      },
      data: result.rows,
    });
  } catch (error) {
    console.error('getSchoolReports error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching school reports.' });
  }
};

// GET /api/deo/vtps
const getDistrictVtpList = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query, 10, 100);
    const search = req.query.search?.trim();
    const status = req.query.status?.trim();
    const blockCd = parseInt(req.query.block_cd, 10);
    const clusterCd = parseInt(req.query.cluster_cd, 10);

    const { user, deo } = await resolveDeoProfile(req.user.id);

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }
    if (!deo) {
      return res.status(403).json({ status: false, message: 'DEO profile not found.' });
    }

    const params = [deo.district_cd];
    const filters = [];
    const cteFilters = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(
        vtp_name ILIKE $${params.length}
        OR vc_name ILIKE $${params.length}
        OR email ILIKE $${params.length}
        OR CAST(mobile AS TEXT) ILIKE $${params.length}
      )`);
    }

    if (status && status !== 'all') {
      params.push(status);
      filters.push(`status = $${params.length}`);
    }

    const whereFilter = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    if (!Number.isNaN(blockCd)) {
      params.push(blockCd);
      cteFilters.push(`s.block_cd = $${params.length}`);
    }

    if (!Number.isNaN(clusterCd)) {
      params.push(clusterCd);
      cteFilters.push(`s.cluster_cd = $${params.length}`);
    }

    const cteFilterClause = cteFilters.length ? ` AND ${cteFilters.join(' AND ')}` : '';

    const cte = `
      WITH district_vtp AS (
        SELECT
          m.vtp_id,
          m.vtp_name,
          MAX(p.vc_name) AS vc_name,
          MAX(p.email) AS email,
          MAX(p.mobile) AS mobile,
          COALESCE(MAX(p.status), 'active') AS status,
          MAX(s.district_name) AS district_name,
          COUNT(DISTINCT s.udise_sch_code)::int AS schools_count,
          COUNT(DISTINCT v.id)::int AS teachers_count
        FROM mst_vtp m
        JOIN vt_staff_details v
          ON (
            (v.vtp_id = m.vtp_id)
            OR (v.vtp_id IS NULL AND v.vtp_name = m.vtp_name)
          )
        JOIN mst_schools s
          ON s.udise_sch_code = v.udise_code
        LEFT JOIN vtp p
          ON (
            (p.vtp_id = m.vtp_id)
            OR (p.vtp_id IS NULL AND p.vtp_name = m.vtp_name)
          )
        WHERE s.vtp = 1
          AND s.district_cd = $1
          ${cteFilterClause}
        GROUP BY m.vtp_id, m.vtp_name
      )
    `;

    const countResult = await pool.query(`
      ${cte}
      SELECT COUNT(*)::int AS count
      FROM district_vtp
      ${whereFilter}
    `, params);

    const totalItems = countResult.rows[0]?.count || 0;
    const totalPages = Math.ceil(totalItems / limit) || 1;

    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(`
      ${cte}
      SELECT
        vtp_id,
        vtp_name,
        vc_name,
        email,
        mobile,
        status,
        district_name,
        schools_count,
        teachers_count
      FROM district_vtp
      ${whereFilter}
      ORDER BY vtp_name ASC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `, dataParams);

    return res.status(200).json({
      status: true,
      message: 'District VTP list fetched successfully.',
      district: {
        district_cd: deo.district_cd,
        district_name: deo.district_name,
      },
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit,
      },
      data: dataResult.rows,
    });
  } catch (error) {
    console.error('getDistrictVtpList error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching district VTP list.' });
  }
};

// GET /api/deo/vt-teachers
const getDistrictVtTeachers = async (req, res) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query, 10, 100);
    const search = req.query.search?.trim();
    const status = req.query.status?.trim();
    const blockCd = parseInt(req.query.block_cd, 10);
    const clusterCd = parseInt(req.query.cluster_cd, 10);

    const { user, deo } = await resolveDeoProfile(req.user.id);

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }
    if (!deo) {
      return res.status(403).json({ status: false, message: 'DEO profile not found.' });
    }

    const params = [deo.district_cd];
    const filters = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(
        v.vt_name ILIKE $${params.length}
        OR v.trade ILIKE $${params.length}
        OR v.school_name ILIKE $${params.length}
        OR COALESCE(m.vtp_name, v.vtp_name) ILIKE $${params.length}
        OR CAST(v.vt_mob AS TEXT) ILIKE $${params.length}
        OR v.vt_email ILIKE $${params.length}
        OR CAST(v.udise_code AS TEXT) ILIKE $${params.length}
      )`);
    }

    if (status && status !== 'all') {
      params.push(status);
      filters.push(`(
        CASE
          WHEN u.vt_approval_status = 'rejected' OR u.vtp_approval_status = 'rejected' THEN 'rejected'
          WHEN u.vt_approval_status = 'accepted' AND COALESCE(u.vtp_approval_status, 'pending') = 'accepted' THEN 'approved'
          ELSE 'pending'
        END
      ) = $${params.length}`);
    }

    if (!Number.isNaN(blockCd)) {
      params.push(blockCd);
      filters.push(`s.block_cd = $${params.length}`);
    }

    if (!Number.isNaN(clusterCd)) {
      params.push(clusterCd);
      filters.push(`s.cluster_cd = $${params.length}`);
    }

    const whereFilter = filters.length ? ` AND ${filters.join(' AND ')}` : '';

    const countResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM vt_staff_details v
      JOIN mst_schools s ON s.udise_sch_code = v.udise_code
      LEFT JOIN users u ON u.vt_staff_id = v.id
      LEFT JOIN mst_vtp m
        ON (
          (m.vtp_id = v.vtp_id)
          OR (v.vtp_id IS NULL AND m.vtp_name = v.vtp_name)
        )
      WHERE s.vtp = 1
        AND s.district_cd = $1
        ${whereFilter}
    `, params);

    const totalItems = countResult.rows[0]?.count || 0;
    const totalPages = Math.ceil(totalItems / limit) || 1;

    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(`
      SELECT
        v.id,
        v.vt_name,
        v.trade,
        v.school_name,
        v.udise_code,
        v.block_name,
        v.district_name,
        COALESCE(m.vtp_name, v.vtp_name) AS vtp_name,
        v.vt_mob AS phone,
        v.vt_email AS email,
        CASE
          WHEN u.vt_approval_status = 'rejected' OR u.vtp_approval_status = 'rejected' THEN 'rejected'
          WHEN u.vt_approval_status = 'accepted' AND COALESCE(u.vtp_approval_status, 'pending') = 'accepted' THEN 'approved'
          ELSE 'pending'
        END AS status
      FROM vt_staff_details v
      JOIN mst_schools s ON s.udise_sch_code = v.udise_code
      LEFT JOIN users u ON u.vt_staff_id = v.id
      LEFT JOIN mst_vtp m
        ON (
          (m.vtp_id = v.vtp_id)
          OR (v.vtp_id IS NULL AND m.vtp_name = v.vtp_name)
        )
      WHERE s.vtp = 1
        AND s.district_cd = $1
        ${whereFilter}
      ORDER BY v.vt_name ASC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `, dataParams);

    return res.status(200).json({
      status: true,
      message: 'District VT teachers fetched successfully.',
      district: {
        district_cd: deo.district_cd,
        district_name: deo.district_name,
      },
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit,
      },
      data: dataResult.rows,
    });
  } catch (error) {
    console.error('getDistrictVtTeachers error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching district VT teachers.' });
  }
};

// POST /api/deo/attendance
const getDeoAttendance = async (req, res) => {
  try {
    const { user, deo } = await resolveDeoProfile(req.user.id);

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }
    if (!deo) {
      return res.status(403).json({ status: false, message: 'DEO profile not found.' });
    }

    const districtCd = deo.district_cd;
    const {
      block_cd,
      cluster_cd,
      udise_code,
      user_id,
      status,
      trade,          // filter by trade (partial match)
      vtp_name,       // filter by VTP name (partial match)
      date,           // exact date  YYYY-MM-DD
      from_date,      // date range start  YYYY-MM-DD
      to_date,        // date range end    YYYY-MM-DD
      filter_type,    // 'date' | 'week' | 'month' | 'date_range'
      filter_value,   // paired value for filter_type
      limit,
      page,
    } = req.body;

    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const parsedPage = page ? parseInt(page, 10) : 1;
    const offset = (parsedPage - 1) * parsedLimit;

    const Attendance = require('../models/Attendance');

    const { records, totalCount } = await Attendance.findByDistrict(districtCd, {
      block_cd,
      cluster_cd,
      udise_code,
      user_id,
      status,
      trade,
      vtp_name,
      date,
      from_date,
      to_date,
      filter_type,
      filter_value,
      limit: parsedLimit,
      offset,
    });

    return res.status(200).json({
      status: true,
      pagination: {
        total: totalCount,
        page: parsedPage,
        limit: parsedLimit,
        total_pages: Math.ceil(totalCount / parsedLimit),
      },
      data: records,
    });
  } catch (error) {
    console.error('getDeoAttendance error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching attendance data.' });
  }
};

module.exports = {
  getSchoolsAndVts,
  getDeoDashboardCounts,
  getSchoolReports,
  getDistrictVtpList,
  getDistrictVtTeachers,
  getDeoAttendance,
};
