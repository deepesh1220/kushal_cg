const { pool } = require('../config/db');

const VtStaffDetail = {
  // ─── Find VT staff record by mobile number ──────────────────────────────────
  // Used during registration to verify the VT exists in master data
  async findByMobile(mobile) {
    const result = await pool.query(`
      SELECT
        id, vt_name, vt_email, vt_mob,
        district_name, block_name, school_name,
        udise_code, vtp_name, trade,
        vtp_pan, vt_aadhar, school_type, old_or_new, remarks
      FROM vt_staff_details
      WHERE vt_mob = $1
    `, [mobile]);
    return result.rows[0] || null;
  },

  // ─── Find VT staff record by ID ─────────────────────────────────────────────
  async findById(id) {
    const result = await pool.query(`
      SELECT * FROM vt_staff_details WHERE id = $1
    `, [id]);
    return result.rows[0] || null;
  },

  // ─── Get all VT staff records (for admin view) ──────────────────────────────
  async findAll({ district, block, vtp_name, trade, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT
        id, district_name, block_name, school_name,
        udise_code, vtp_name, vt_name, trade,
        vt_mob, vt_email, school_type, old_or_new
      FROM vt_staff_details
      WHERE 1 = 1
    `;
    const params = [];

    if (district) {
      params.push(district);
      query += ` AND district_name ILIKE $${params.length}`;
    }
    if (block) {
      params.push(block);
      query += ` AND block_name ILIKE $${params.length}`;
    }
    if (vtp_name) {
      params.push(`%${vtp_name}%`);
      query += ` AND vtp_name ILIKE $${params.length}`;
    }
    if (trade) {
      params.push(`%${trade}%`);
      query += ` AND trade ILIKE $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY vt_name ASC LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
  },

  // ─── Check if a mobile is already registered as a user ─────────────────────
  async isAlreadyRegistered(mobile) {
    const result = await pool.query(`
      SELECT u.id FROM users u
      JOIN vt_staff_details v ON u.vt_staff_id = v.id
      WHERE v.vt_mob = $1
    `, [mobile]);
    return result.rowCount > 0;
  },
};

module.exports = VtStaffDetail;
