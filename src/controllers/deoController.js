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

    const { udise_code, vtUserId } = req.query;

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

    const vtsQuery = `
      SELECT 
        v.id as vt_staff_id, u.id as user_id, v.vt_name, v.vt_mob, v.vt_email, v.trade, v.vtp_name, v.udise_code
      FROM vt_staff_details v
      LEFT JOIN users u ON u.vt_staff_id = v.id
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

module.exports = {
  getSchoolsAndVts
};
