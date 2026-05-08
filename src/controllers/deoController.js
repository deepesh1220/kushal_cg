const { pool } = require('../config/db');
const User = require('../models/User');
// const Deo = require('../models/Deo'); // model not created yet — using raw SQL instead


// ─── GET /api/deo/schools-vts ────────────────────────────────────────────────
const getSchoolsAndVts = async (req, res) => {
  try {
    const userId = req.user.id; // from JWT payload

    // 1. Get user details to find phone/email
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    // 2. Fetch DEO details to get district_cd
    // First try by email, then phone
    let deo = null;
    if (user.email) {
      const deoResult = await pool.query('SELECT * FROM mst_deo WHERE email = $1 LIMIT 1', [user.email]);
      deo = deoResult.rows[0];
    }
    if (!deo && user.phone) {
      const deoResult = await pool.query('SELECT * FROM mst_deo WHERE mobile = $1 LIMIT 1', [user.phone]);
      deo = deoResult.rows[0];
    }

    if (!deo) {
      return res.status(403).json({ status: false, message: 'DEO profile not found.' });
    }

    const { udise_code, vtUserId, month, year } = req.query;

    const reportMonth = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    const reportYear = year ? parseInt(year, 10) : new Date().getFullYear();

    const district_cd = deo.district_cd;

    // 3. Fetch schools for this district_cd
    let schoolsQueryArgs = [district_cd];
    let schoolsWhereStr = "WHERE vtp = 1 AND district_cd = $1";

    if (udise_code) {
      schoolsQueryArgs.push(udise_code);
      schoolsWhereStr += ` AND udise_sch_code = $${schoolsQueryArgs.length}`;
    }

    const schoolsQuery = `
      SELECT udise_sch_code as udise_code, school_name, block_name, district_name 
      FROM mst_schools 
      ${schoolsWhereStr}
    `;
    const schoolsResult = await pool.query(schoolsQuery, schoolsQueryArgs);
    const schools = schoolsResult.rows;

    if (schools.length === 0) {
      return res.status(200).json({
        status: true,
        data: [],
        counts: { schools: 0, vts: 0, vtps: 0 },
        message: 'No schools found for this district.'
      });
    }

    // 4. Fetch VTs for these schools
    const udiseCodes = schools.map(s => s.udise_code);
    let vtsQueryArgs = [udiseCodes];
    let vtsWhereStr = "WHERE v.udise_code = ANY($1)";

    if (vtUserId) {
      vtsQueryArgs.push(vtUserId);
      vtsWhereStr += ` AND u.id = $${vtsQueryArgs.length}`;
    }

    vtsQueryArgs.push(reportMonth, reportYear);
    const monthArgIndex = vtsQueryArgs.length - 1;
    const yearArgIndex = vtsQueryArgs.length;

    const vtsQuery = `
      SELECT 
        v.id as vt_staff_id, u.id as user_id, v.vt_name, v.vt_mob, v.vt_email, v.trade, v.vtp_name, v.udise_code,
        COALESCE(msr.hm_approval_status, 'pending') as hm_approval_status,
        COALESCE(msr.vtp_approval_status, 'pending') as vtp_approval_status,
        COALESCE(msr.deo_approval_status, 'pending') as deo_approval_status
      FROM vt_staff_details v
      LEFT JOIN users u ON u.vt_staff_id = v.id
      LEFT JOIN monthly_school_reports msr ON msr.user_id = u.id AND msr.report_month = $${monthArgIndex} AND msr.report_year = $${yearArgIndex}
      ${vtsWhereStr}
    `;
    const vtsResult = await pool.query(vtsQuery, vtsQueryArgs);
    const vts = vtsResult.rows;

    // 5. Group VTs by school
    const schoolsWithVts = schools.map(school => {
      const schoolVts = vts.filter(vt => String(vt.udise_code) === String(school.udise_code));
      return {
        ...school,
        vts: schoolVts
      };
    }).filter(school => {
      // If vtUserId filter is applied, only show schools that have the matching VT
      if (vtUserId) {
        return school.vts.length > 0;
      }
      return true;
    });

    // Compute unique VTPs
    const uniqueVTPs = new Set(vts.filter(vt => vt.vtp_name).map(vt => vt.vtp_name));

    return res.status(200).json({
      status: true,
      message: 'Schools and VTs fetched successfully.',
      district: {
        district_cd: deo.district_cd,
        district_name: deo.district_name
      },
      counts: {
        schools: schoolsWithVts.length,
        vts: vts.length,
        vtps: uniqueVTPs.size
      },
      data: schoolsWithVts
    });

  } catch (error) {
    console.error('getSchoolsAndVts error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching schools and VTs.' });
  }
};

// ─── GET /api/deo/dashboard-counts ───────────────────────────────────────────
const getDeoDashboardCounts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { month, year } = req.query;

    const currentMonth = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    let deo = null;
    if (user.email) {
      const deoResult = await pool.query('SELECT * FROM mst_deo WHERE email = $1 LIMIT 1', [user.email]);
      deo = deoResult.rows[0];
    }
    if (!deo && user.phone) {
      const deoResult = await pool.query('SELECT * FROM mst_deo WHERE mobile = $1 LIMIT 1', [user.phone]);
      deo = deoResult.rows[0];
    }

    if (!deo) {
      return res.status(403).json({ status: false, message: 'DEO profile not found.' });
    }

    const district_cd = deo.district_cd;

    // 1. Total Schools
    const schoolsQuery = `SELECT COUNT(*) as count FROM mst_schools WHERE vtp = 1 AND district_cd = $1`;
    const schoolsResult = await pool.query(schoolsQuery, [district_cd]);
    const totalSchools = parseInt(schoolsResult.rows[0].count, 10);

    // 2. Total VTs
    const vtsQuery = `
      SELECT COUNT(*) as count 
      FROM vt_staff_details v
      JOIN mst_schools s ON v.udise_code = s.udise_sch_code
      WHERE s.vtp = 1 AND s.district_cd = $1
    `;
    const vtsResult = await pool.query(vtsQuery, [district_cd]);
    const totalVts = parseInt(vtsResult.rows[0].count, 10);

    // 3. Report Counts
    const reportsQuery = `
      SELECT r.deo_approval_status, COUNT(*) as count
      FROM monthly_school_reports r
      JOIN mst_schools s ON r.udise_code = s.udise_sch_code
      WHERE s.vtp = 1 AND s.district_cd = $1 AND r.report_month = $2 AND r.report_year = $3
      GROUP BY r.deo_approval_status
    `;
    const reportsResult = await pool.query(reportsQuery, [district_cd, currentMonth, currentYear]);

    let approved = 0;
    let rejected = 0;
    let pending = 0;

    reportsResult.rows.forEach(row => {
      if (row.deo_approval_status === 'approved') approved += parseInt(row.count, 10);
      else if (row.deo_approval_status === 'rejected') rejected += parseInt(row.count, 10);
      else if (row.deo_approval_status === 'pending') pending += parseInt(row.count, 10);
    });

    const totalGenerated = approved + rejected + pending;
    const notGenerated = totalSchools > totalGenerated ? totalSchools - totalGenerated : 0;

    return res.status(200).json({
      status: true,
      message: 'Dashboard counts fetched successfully.',
      data: {
        total_schools: totalSchools,
        total_vts: totalVts,
        reports: {
          month: currentMonth,
          year: currentYear,
          approved,
          rejected,
          pending: pending + notGenerated, // Combines explicit pending + not yet generated
          explicit_pending: pending,
          not_generated: notGenerated,
          total_generated: totalGenerated
        }
      }
    });

  } catch (error) {
    console.error('getDeoDashboardCounts error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching DEO dashboard counts.' });
  }
};

// ─── GET /api/deo/school-reports ─────────────────────────────────────────────
const getSchoolReports = async (req, res) => {
  try {
    const userId = req.user.id;
    const { month, year, udise_code, page = 1, limit = 50, status } = req.query;

    const currentMonth = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const offsetNum = (pageNum - 1) * limitNum;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    let deo = null;
    if (user.email) {
      const deoResult = await pool.query('SELECT * FROM mst_deo WHERE email = $1 LIMIT 1', [user.email]);
      deo = deoResult.rows[0];
    }
    if (!deo && user.phone) {
      const deoResult = await pool.query('SELECT * FROM mst_deo WHERE mobile = $1 LIMIT 1', [user.phone]);
      deo = deoResult.rows[0];
    }

    if (!deo) {
      return res.status(403).json({ status: false, message: 'DEO profile not found.' });
    }

    const district_cd = deo.district_cd;

    let queryArgs = [district_cd, currentMonth, currentYear];
    let whereClause = "s.vtp = 1 AND s.district_cd = $1";

    if (udise_code) {
      queryArgs.push(udise_code);
      whereClause += ` AND s.udise_sch_code = $${queryArgs.length}`;
    }

    if (status) {
      queryArgs.push(status);
      whereClause += ` AND COALESCE(r.deo_approval_status, 'pending') = $${queryArgs.length}`;
    }

    const countQuery = `
      SELECT COUNT(*) 
      FROM mst_schools s
      LEFT JOIN monthly_school_reports r 
        ON s.udise_sch_code = r.udise_code 
        AND r.report_month = $2 
        AND r.report_year = $3
      WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery, queryArgs);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limitNum);

    queryArgs.push(limitNum);
    const limitIndex = queryArgs.length;
    queryArgs.push(offsetNum);
    const offsetIndex = queryArgs.length;

    const query = `
      SELECT 
        s.udise_sch_code as udise_code, 
        s.school_name, 
        s.block_name, 
        s.district_name,
        r.id as report_id,
        r.report_month,
        r.report_year,
        COALESCE(r.hm_approval_status, 'pending') as hm_approval_status,
        COALESCE(r.vtp_approval_status, 'pending') as vtp_approval_status,
        COALESCE(r.deo_approval_status, 'pending') as deo_approval_status,
        r.hm_remarks,
        r.vtp_remarks,
        r.deo_remarks
      FROM mst_schools s
      LEFT JOIN monthly_school_reports r 
        ON s.udise_sch_code = r.udise_code 
        AND r.report_month = $2 
        AND r.report_year = $3
      WHERE ${whereClause}
      ORDER BY s.school_name ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `;

    const result = await pool.query(query, queryArgs);

    return res.status(200).json({
      status: true,
      message: 'School reports fetched successfully.',
      month: currentMonth,
      year: currentYear,
      pagination: {
        totalItems,
        totalPages,
        currentPage: pageNum,
        limit: limitNum
      },
      data: result.rows
    });

  } catch (error) {
    console.error('getSchoolReports error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error fetching school reports.' });
  }
};

module.exports = {
  getSchoolsAndVts,
  getDeoDashboardCounts,
  getSchoolReports
};
