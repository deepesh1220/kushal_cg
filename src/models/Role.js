const { pool } = require('../config/db');

const Role = {
  // ─── Get all roles ──────────────────────────────────────────────────────────
  async findAll() {
    const result = await pool.query(`
      SELECT id, name, description, is_active, created_at
      FROM roles 
      WHERE id != 1
      ORDER BY id ASC
    `);
    return result.rows;
  },

  // ─── Find role by ID ────────────────────────────────────────────────────────
  async findById(id) {
    const result = await pool.query(
      'SELECT id, name, description, is_active FROM roles WHERE id = $1', [id]
    );
    return result.rows[0] || null;
  },

  // ─── Find role by name ──────────────────────────────────────────────────────
  async findByName(name) {
    const result = await pool.query(
      'SELECT id, name, description, is_active FROM roles WHERE name = $1', [name]
    );
    return result.rows[0] || null;
  },

  // ─── Find active role by ID ─────────────────────────────────────────────────
  async findActiveById(id) {
    const result = await pool.query(
      'SELECT id FROM roles WHERE id = $1 AND is_active = TRUE', [id]
    );
    return result.rows[0] || null;
  },

  // ─── Create a new role ──────────────────────────────────────────────────────
  async create({ name, description }) {
    const result = await pool.query(`
      INSERT INTO roles (name, description)
      VALUES ($1, $2)
      RETURNING id, name, description, is_active, created_at
    `, [name.toLowerCase(), description || null]);
    return result.rows[0];
  },

  // ─── Update a role ──────────────────────────────────────────────────────────
  async update(id, { name, description, is_active }) {
    const result = await pool.query(`
      UPDATE roles
      SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        is_active   = COALESCE($3, is_active),
        updated_at  = NOW()
      WHERE id = $4
      RETURNING id, name, description, is_active, updated_at
    `, [name || null, description || null, is_active ?? null, id]);
    return result.rows[0] || null;
  },

  // ─── Delete a role ──────────────────────────────────────────────────────────
  async delete(id) {
    const result = await pool.query(
      'DELETE FROM roles WHERE id = $1 RETURNING id', [id]
    );
    return result.rowCount > 0;
  },

  // ─── Get permissions assigned to a role ─────────────────────────────────────
  async getPermissions(roleId) {
    const result = await pool.query(`
      SELECT p.id, p.name, p.module, p.action, p.description
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      WHERE rp.role_id = $1
      ORDER BY p.module, p.action
    `, [roleId]);
    return result.rows;
  },

  // ─── Assign multiple permissions to a role ──────────────────────────────────
  async assignPermissions(roleId, permissionIds) {
    if (!permissionIds.length) return;
    const values = permissionIds.map((pid) => `(${roleId}, ${pid})`).join(', ');
    await pool.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES ${values}
      ON CONFLICT DO NOTHING
    `);
  },

  // ─── Remove multiple permissions from a role ────────────────────────────────
  async removePermissions(roleId, permissionIds) {
    await pool.query(`
      DELETE FROM role_permissions
      WHERE role_id = $1 AND permission_id = ANY($2::int[])
    `, [roleId, permissionIds]);
  },
};

module.exports = Role;
