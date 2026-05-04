const { pool } = require('../config/db');

class Deo {
  static async findByEmailAndMobile(email, mobile) {
    const query = 'SELECT * FROM mst_deo WHERE email = $1 AND mobile = $2 LIMIT 1';
    const result = await pool.query(query, [email, mobile]);
    return result.rows[0];
  }

  static async create(deoData) {
    const { district_cd, district_name, deo_name, mobile, alternate_mobile, designation, email } = deoData;
    const query = `
      INSERT INTO mst_deo (
        district_cd, district_name, deo_name, mobile, alternate_mobile, designation, email
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *;
    `;
    const result = await pool.query(query, [
      district_cd,
      district_name,
      deo_name,
      mobile,
      alternate_mobile,
      designation,
      email
    ]);
    return result.rows[0];
  }
}

module.exports = Deo;
