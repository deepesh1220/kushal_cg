const { pool } = require('../config/db');

const Permission = {
  // ─── Get all permissions ────────────────────────────────────────────────────
  async findAll() {
    const result = await pool.query(`
      SELECT id, name, module, action, description, created_at
      FROM permissions
      ORDER BY module, action
    `);
    return result.rows;
  },

  // ─── Create a new permission ────────────────────────────────────────────────
  async create({ name, module, action, description }) {
    const result = await pool.query(`
      INSERT INTO permissions (name, module, action, description)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, module, action, description, created_at
    `, [name, module, action, description || null]);
    return result.rows[0];
  },

  // ─── Delete a permission ────────────────────────────────────────────────────
  async delete(id) {
    const result = await pool.query(
      'DELETE FROM permissions WHERE id = $1 RETURNING id', [id]
    );
    return result.rowCount > 0;
  },

  // ─── Set (grant or revoke) a specific permission for a user ────────────────
  async setUserPermission(userId, permissionId, isGranted) {
    await pool.query(`
      INSERT INTO user_permissions (user_id, permission_id, is_granted)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, permission_id)
      DO UPDATE SET is_granted = EXCLUDED.is_granted
    `, [userId, permissionId, isGranted]);
  },

  // ─── Get all user-level permission overrides for a user ─────────────────────
  async getUserPermissions(userId) {
    const result = await pool.query(`
      SELECT p.id, p.name, p.module, p.action, up.is_granted
      FROM user_permissions up
      JOIN permissions p ON p.id = up.permission_id
      WHERE up.user_id = $1
      ORDER BY p.module, p.action
    `, [userId]);
    return result.rows;
  },
};

module.exports = Permission;
