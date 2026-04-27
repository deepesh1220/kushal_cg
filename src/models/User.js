const { pool } = require('../config/db');

const User = {
  // ─── Find user by email ─────────────────────────────────────────────────────
  async findByEmail(email) {
    const result = await pool.query(`
      SELECT
        u.id, u.name, u.email, u.phone,
        u.password_hash, u.is_active, u.profile_photo,
        u.vt_approval_status, u.udise_code, u.organization_name,
        u.latitude, u.longitude, u.school_open_time, u.school_close_time,
        r.id   AS role_id,
        r.name AS role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email = $1
    `, [email]);
    return result.rows[0] || null;
  },

  // ─── Find user by phone (BIGINT) ────────────────────────────────────────────
  async findByPhone(phone) {
    const result = await pool.query(`
      SELECT
        u.id, u.name, u.email, u.phone,
        u.password_hash, u.is_active, u.profile_photo,
        u.vt_approval_status, u.udise_code, u.organization_name,
        u.latitude, u.longitude, u.school_open_time, u.school_close_time,
        r.id   AS role_id,
        r.name AS role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.phone = $1
    `, [phone]);
    return result.rows[0] || null;
  },

  // ─── Find user by ID ────────────────────────────────────────────────────────
  async findById(id) {
    const result = await pool.query(`
      SELECT
        u.id, u.name, u.email, u.phone,
        u.is_active, u.profile_photo,
        u.vt_approval_status, u.udise_code, u.organization_name,
        u.latitude, u.longitude, u.school_open_time, u.school_close_time,
        r.id   AS role_id,
        r.name AS role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1
    `, [id]);
    return result.rows[0] || null;
  },

  // ─── Check if email already exists ─────────────────────────────────────────
  async emailExists(email) {
    const result = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email]
    );
    return result.rowCount > 0;
  },

  // ─── Check if phone already exists ──────────────────────────────────────────
  async phoneExists(phone) {
    const result = await pool.query(
      'SELECT id FROM users WHERE phone = $1', [phone]
    );
    return result.rowCount > 0;
  },

  // ─── Create a new user ──────────────────────────────────────────────────────
  async create({ name, email, phone, password_hash, role_id, vt_staff_id = null, organization_name = null, udise_code = null, profile_photo = null, latitude = null, longitude = null, school_open_time = null, school_close_time = null, vt_approval_status = null, is_active = true }) {
    const result = await pool.query(`
      INSERT INTO users
        (name, email, phone, password_hash, role_id, vt_staff_id, organization_name, udise_code, profile_photo, latitude, longitude, school_open_time, school_close_time, vt_approval_status, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, name, email, phone, role_id, vt_staff_id, organization_name, udise_code, profile_photo, latitude, longitude, school_open_time, school_close_time, vt_approval_status, is_active, created_at
    `, [name, email, phone || null, password_hash, role_id, vt_staff_id, organization_name, udise_code, profile_photo, latitude, longitude, school_open_time, school_close_time, vt_approval_status, is_active]);
    return result.rows[0];
  },

  // ─── Get effective permissions for a user ───────────────────────────────────
  async getEffectivePermissions(roleId, userId) {
    const result = await pool.query(`
      SELECT DISTINCT p.name AS permission
      FROM permissions p
      WHERE p.id IN (
        SELECT rp.permission_id
        FROM role_permissions rp
        WHERE rp.role_id = $1

        UNION

        SELECT up.permission_id
        FROM user_permissions up
        WHERE up.user_id = $2 AND up.is_granted = TRUE
      )
      AND p.id NOT IN (
        SELECT up.permission_id
        FROM user_permissions up
        WHERE up.user_id = $2 AND up.is_granted = FALSE
      )
    `, [roleId, userId]);
    return result.rows.map((r) => r.permission);
  },

  // ─── Update approval status for VT ──────────────────────────────────────────
  // status: 'accepted' → also sets is_active = true
  // status: 'rejected' → keeps is_active = false
  async updateApprovalStatus(userId, status, reviewedBy) {
    const isActive = status === 'accepted';
    const result = await pool.query(`
      UPDATE users
      SET
        vt_approval_status = $1,
        is_active          = $2,
        updated_at         = NOW()
      WHERE id = $3
        AND vt_approval_status IS NOT NULL
      RETURNING id, name, email, phone, vt_approval_status, is_active
    `, [status, isActive, userId]);
    return result.rows[0] || null;
  },

  // ─── Get VTs for a specific school (by UDISE code) ──────────────────────────
  // Used by headmaster to see VTs in their school
  async findVtsByUdise(udiseCode) {
    const result = await pool.query(`
      SELECT
        u.id, u.name, u.email, u.phone,
        u.vt_approval_status, u.created_at,
        v.district_name, v.block_name, v.school_name,
        v.vtp_name, v.trade, v.vt_aadhar, v.udise_code
      FROM users u
      JOIN vt_staff_details v ON v.id = u.vt_staff_id
      WHERE v.udise_code = $1
      ORDER BY u.created_at DESC
    `, [udiseCode]);
    return result.rows;
  },

  // ─── Get all VTs with approval status (admin view) ──────────────────────────
  async findAllVtsByStatus(status = null) {
    let query = `
      SELECT
        u.id, u.name, u.email, u.phone,
        u.vt_approval_status, u.is_active, u.created_at,
        v.district_name, v.block_name, v.school_name,
        v.vtp_name, v.trade, v.udise_code
      FROM users u
      JOIN vt_staff_details v ON v.id = u.vt_staff_id
      WHERE u.vt_approval_status IS NOT NULL
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND u.vt_approval_status = $${params.length}`;
    }

    query += ' ORDER BY u.created_at DESC';
    const result = await pool.query(query, params);
    return result.rows;
  },

  // ─── Update user fields ─────────────────────────────────────────────────────
  async update(id, fields) {
    const { name, phone, role_id, is_active, profile_photo, udise_code, organization_name, latitude, longitude, school_open_time, school_close_time } = fields;
    const result = await pool.query(`
      UPDATE users
      SET
        name              = COALESCE($1, name),
        phone             = COALESCE($2, phone),
        role_id           = COALESCE($3, role_id),
        is_active         = COALESCE($4, is_active),
        profile_photo     = COALESCE($5, profile_photo),
        udise_code        = COALESCE($6, udise_code),
        organization_name = COALESCE($7, organization_name),
        latitude          = COALESCE($8, latitude),
        longitude         = COALESCE($9, longitude),
        school_open_time  = COALESCE($10, school_open_time),
        school_close_time = COALESCE($11, school_close_time),
        updated_at        = NOW()
      WHERE id = $12
      RETURNING id, name, email, phone, role_id, is_active, profile_photo, udise_code, organization_name, latitude, longitude, school_open_time, school_close_time, updated_at
    `, [name || null, phone || null, role_id || null, is_active ?? null, profile_photo || null, udise_code || null, organization_name || null, latitude || null, longitude || null, school_open_time || null, school_close_time || null, id]);
    return result.rows[0] || null;
  },
};

module.exports = User;
