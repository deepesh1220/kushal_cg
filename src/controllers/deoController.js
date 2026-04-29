const { pool } = require('../config/db');
const User = require('../models/User');
const Deo = require('../models/Deo');

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

    const district_cd = deo.district_cd;

    // 3. Fetch schools for this district_cd
    const schoolsQuery = `
      SELECT udise_code, school_name, block_name, district_name 
      FROM mst_schools 
      WHERE district_cd = $1
    `;
    const schoolsResult = await pool.query(schoolsQuery, [district_cd]);
    const schools = schoolsResult.rows;

    if (schools.length === 0) {
      return res.status(200).json({
        status: true,
        data: [],
        message: 'No schools found for this district.'
      });
    }

    // 4. Fetch VTs for these schools
    // Using vt_staff_details since it's the master table for VTs
    const udiseCodes = schools.map(s => s.udise_code);
    
    const vtsQuery = `
      SELECT 
        id, vt_name, vt_mob, vt_email, trade, vtp_name, udise_code
      FROM vt_staff_details
      WHERE udise_code = ANY($1)
    `;
    const vtsResult = await pool.query(vtsQuery, [udiseCodes]);
    const vts = vtsResult.rows;

    // 5. Group VTs by school
    const schoolsWithVts = schools.map(school => {
      // Find all VTs belonging to this school
      // Make sure to compare as strings just in case bigint is returned as string
      const schoolVts = vts.filter(vt => String(vt.udise_code) === String(school.udise_code));
      return {
        ...school,
        vts: schoolVts
      };
    });

    return res.status(200).json({
      status: true,
      message: 'Schools and VTs fetched successfully.',
      district: {
        district_cd: deo.district_cd,
        district_name: deo.district_name
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
