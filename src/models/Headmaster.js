const { pool } = require('../config/db');

/**
 * Headmaster Model
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages the `headmasters` table in the PostgreSQL database.
 *
 * Key design decisions:
 *  - teacher_code : TEXT PRIMARY KEY (assigned by MIS, not auto-generated)
 *  - password     : bcrypt hash — never plain text
 *  - latitude/longitude : DOUBLE PRECISION for GPS accuracy
 *  - All boolean flags default to FALSE
 *  - dob stored as DATE; updated_at/created_at stored as TIMESTAMPTZ
 *  - Indexes on udise_code, mobile, district_id for fast lookups
 */

// ─── Model object ─────────────────────────────────────────────────────────────
const Headmaster = {

  // ── Find by teacher_code (PK) ──────────────────────────────────────────────
  async findByTeacherCode(teacher_code) {
    const result = await pool.query(
      `SELECT * FROM headmasters WHERE teacher_code = $1`,
      [teacher_code]
    );
    return result.rows[0] || null;
  },

  // ── Find by email ──────────────────────────────────────────────────────────
  async findByEmail(email) {
    const result = await pool.query(
      `SELECT * FROM headmasters WHERE email = $1`,
      [email]
    );
    return result.rows[0] || null;
  },

  // ── Find by mobile ─────────────────────────────────────────────────────────
  async findByMobile(mobile) {
    const result = await pool.query(
      `SELECT * FROM headmasters WHERE mobile = $1`,
      [mobile]
    );
    return result.rows[0] || null;
  },

  // ── Existence checks ───────────────────────────────────────────────────────
  async teacherCodeExists(teacher_code) {
    const result = await pool.query(
      `SELECT 1 FROM headmasters WHERE teacher_code = $1`,
      [teacher_code]
    );
    return result.rowCount > 0;
  },

  async emailExists(email) {
    const result = await pool.query(
      `SELECT 1 FROM headmasters WHERE email = $1`,
      [email]
    );
    return result.rowCount > 0;
  },

  // ── Create a new headmaster record ────────────────────────────────────────
  /**
   * @param {object} data
   * @param {string}  data.teacher_code - REQUIRED, unique MIS code (PK)
   * @param {string}  data.password     - REQUIRED, bcrypt hash
   * @param {string}  data.t_name       - REQUIRED, full name
   * All other fields are optional and fall back to column defaults.
   */
  async create(data) {
    const {
      teacher_code,
      email = null,
      password,
      t_name,
      udise_code = null,
      school_name = null,
      cluster_id = null,
      cluster_name = null,
      block_id = null,
      block_name = null,
      district_id = null,
      district_name = null,
      gender = null,
      caste_name = null,
      mobile = null,
      dob = null,
      role = 'headmaster',
      is_migrated = false,
      is_attached_teacher = false,
      is_role_update = false,
      is_location_reset = false,
      location_verify = false,
      appoint_as_cac = false,
      is_retired_teacher = false,
      is_temporary_headmaster_or_principal = false,
      verified_by_headmaster = false,
      approved_by_headmaster = false,
      sch_mgmt_id = null,
      sch_category_id = null,
      school_image_url = null,
      latitude = null,
      longitude = null,
    } = data;

    const result = await pool.query(
      `INSERT INTO headmasters (
        teacher_code, email, password, t_name,
        udise_code, school_name, cluster_id, cluster_name,
        block_id, block_name, district_id, district_name,
        gender, caste_name, mobile, dob, role,
        is_migrated, is_attached_teacher, is_role_update,
        is_location_reset, location_verify, appoint_as_cac,
        is_retired_teacher, is_temporary_headmaster_or_principal,
        verified_by_headmaster, approved_by_headmaster,
        sch_mgmt_id, sch_category_id, school_image_url,
        latitude, longitude,
        updated_at, created_at
      ) VALUES (
        $1,  $2,  $3,  $4,  $5,  $6,  $7,  $8,
        $9,  $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20,
        $21, $22, $23,
        $24, $25,
        $26, $27,
        $28, $29, $30,
        $31, $32,
        NOW(), NOW()
      )
      RETURNING *`,
      [
        teacher_code, email, password, t_name,
        udise_code, school_name, cluster_id, cluster_name,
        block_id, block_name, district_id, district_name,
        gender, caste_name, mobile, dob, role,
        is_migrated, is_attached_teacher, is_role_update,
        is_location_reset, location_verify, appoint_as_cac,
        is_retired_teacher, is_temporary_headmaster_or_principal,
        verified_by_headmaster, approved_by_headmaster,
        sch_mgmt_id, sch_category_id, school_image_url,
        latitude, longitude,
      ]
    );
    return result.rows[0];
  },

  // ── Generic partial update ─────────────────────────────────────────────────
  /**
   * Updates only the supplied fields for a given teacher_code.
   * Fields not included are left unchanged via COALESCE.
   */
  async update(teacher_code, fields) {
    const {
      email, t_name, udise_code, school_name,
      cluster_id, cluster_name, block_id, block_name,
      district_id, district_name, gender, caste_name, mobile,
      dob, role,
      is_migrated, is_attached_teacher, is_role_update,
      is_location_reset, location_verify, appoint_as_cac,
      is_retired_teacher, is_temporary_headmaster_or_principal,
      verified_by_headmaster, approved_by_headmaster,
      sch_mgmt_id, sch_category_id, school_image_url,
      latitude, longitude,
    } = fields;

    const result = await pool.query(
      `UPDATE headmasters SET
        email                                = COALESCE($1,  email),
        t_name                               = COALESCE($2,  t_name),
        udise_code                           = COALESCE($3,  udise_code),
        school_name                          = COALESCE($4,  school_name),
        cluster_id                           = COALESCE($5,  cluster_id),
        cluster_name                         = COALESCE($6,  cluster_name),
        block_id                             = COALESCE($7,  block_id),
        block_name                           = COALESCE($8,  block_name),
        district_id                          = COALESCE($9,  district_id),
        district_name                        = COALESCE($10, district_name),
        gender                               = COALESCE($11, gender),
        caste_name                           = COALESCE($12, caste_name),
        mobile                               = COALESCE($13, mobile),
        dob                                  = COALESCE($14, dob),
        role                                 = COALESCE($15, role),
        is_migrated                          = COALESCE($16, is_migrated),
        is_attached_teacher                  = COALESCE($17, is_attached_teacher),
        is_role_update                       = COALESCE($18, is_role_update),
        is_location_reset                    = COALESCE($19, is_location_reset),
        location_verify                      = COALESCE($20, location_verify),
        appoint_as_cac                       = COALESCE($21, appoint_as_cac),
        is_retired_teacher                   = COALESCE($22, is_retired_teacher),
        is_temporary_headmaster_or_principal = COALESCE($23, is_temporary_headmaster_or_principal),
        verified_by_headmaster               = COALESCE($24, verified_by_headmaster),
        approved_by_headmaster               = COALESCE($25, approved_by_headmaster),
        sch_mgmt_id                          = COALESCE($26, sch_mgmt_id),
        sch_category_id                      = COALESCE($27, sch_category_id),
        school_image_url                     = COALESCE($28, school_image_url),
        latitude                             = COALESCE($29, latitude),
        longitude                            = COALESCE($30, longitude),
        updated_at                           = NOW()
      WHERE teacher_code = $31
      RETURNING *`,
      [
        email ?? null, t_name ?? null,
        udise_code ?? null, school_name ?? null,
        cluster_id ?? null, cluster_name ?? null,
        block_id ?? null, block_name ?? null,
        district_id ?? null, district_name ?? null,
        gender ?? null, caste_name ?? null,
        mobile ?? null, dob ?? null,
        role ?? null,
        is_migrated ?? null, is_attached_teacher ?? null,
        is_role_update ?? null, is_location_reset ?? null,
        location_verify ?? null, appoint_as_cac ?? null,
        is_retired_teacher ?? null, is_temporary_headmaster_or_principal ?? null,
        verified_by_headmaster ?? null, approved_by_headmaster ?? null,
        sch_mgmt_id ?? null, sch_category_id ?? null,
        school_image_url ?? null,
        latitude ?? null, longitude ?? null,
        teacher_code,
      ]
    );
    return result.rows[0] || null;
  },

  // ── Update password ────────────────────────────────────────────────────────
  async updatePassword(teacher_code, hashedPassword) {
    const result = await pool.query(
      `UPDATE headmasters
       SET password = $1, updated_at = NOW()
       WHERE teacher_code = $2
       RETURNING teacher_code, updated_at`,
      [hashedPassword, teacher_code]
    );
    return result.rows[0] || null;
  },

  // ── Find all headmasters in a district ────────────────────────────────────
  async findByDistrict(district_id) {
    const result = await pool.query(
      `SELECT teacher_code, t_name, email, mobile,
              school_name, udise_code, block_name,
              district_name, verified_by_headmaster
       FROM headmasters
       WHERE district_id = $1
       ORDER BY t_name ASC`,
      [district_id]
    );
    return result.rows;
  },

  // ── Find all headmasters in a block ───────────────────────────────────────
  async findByBlock(block_id) {
    const result = await pool.query(
      `SELECT teacher_code, t_name, email, mobile,
              school_name, udise_code, block_name,
              district_name, verified_by_headmaster
       FROM headmasters
       WHERE block_id = $1
       ORDER BY t_name ASC`,
      [block_id]
    );
    return result.rows;
  },

  // ── Find by UDISE school code ──────────────────────────────────────────────
  async findByUdise(udise_code) {
    const result = await pool.query(
      `SELECT * FROM headmasters WHERE udise_code = $1`,
      [udise_code]
    );
    return result.rows;
  },

  // ── Soft-delete equivalent: mark as retired ────────────────────────────────
  async markRetired(teacher_code) {
    const result = await pool.query(
      `UPDATE headmasters
       SET is_retired_teacher = TRUE, updated_at = NOW()
       WHERE teacher_code = $1
       RETURNING teacher_code, is_retired_teacher`,
      [teacher_code]
    );
    return result.rows[0] || null;
  },

  // ── Hard delete (use with caution) ────────────────────────────────────────
  async delete(teacher_code) {
    const result = await pool.query(
      `DELETE FROM headmasters WHERE teacher_code = $1 RETURNING teacher_code`,
      [teacher_code]
    );
    return result.rowCount > 0;
  },

  async findSchDetails(udise_code) {
    const result = await pool.query(
      `SELECT udise_sch_code,school_name,sch_open_time, sch_close_time,latitude,longitude
       FROM mst_schools
       WHERE udise_sch_code = $1`,
      [udise_code]
    );
    return result.rows;
  },
}

module.exports = Headmaster;
