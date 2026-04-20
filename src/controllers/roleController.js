const Role = require('../models/Role');

// ─── GET /api/roles ───────────────────────────────────────────────────────────
const getAllRoles = async (req, res) => {
  try {
    const roles = await Role.findAll();
    res.status(200).json({ status: 'success', data: roles });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── POST /api/roles ──────────────────────────────────────────────────────────
const createRole = async (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Role name is required.' });
  }

  try {
    const role = await Role.create({ name, description });
    res.status(201).json({ status: 'success', data: role });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ status: 'error', message: 'Role name already exists.' });
    }
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── PUT /api/roles/:id ───────────────────────────────────────────────────────
const updateRole = async (req, res) => {
  const { id } = req.params;
  const { name, description, is_active } = req.body;

  try {
    const updated = await Role.update(id, { name, description, is_active });

    if (!updated) {
      return res.status(404).json({ status: 'error', message: 'Role not found.' });
    }

    res.status(200).json({ status: 'success', data: updated });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── DELETE /api/roles/:id ────────────────────────────────────────────────────
const deleteRole = async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await Role.delete(id);

    if (!deleted) {
      return res.status(404).json({ status: 'error', message: 'Role not found.' });
    }

    res.status(200).json({ status: 'success', message: 'Role deleted successfully.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── GET /api/roles/:id/permissions ──────────────────────────────────────────
const getRolePermissions = async (req, res) => {
  const { id } = req.params;

  try {
    const permissions = await Role.getPermissions(id);
    res.status(200).json({ status: 'success', data: permissions });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── POST /api/roles/:id/permissions ─────────────────────────────────────────
// Body: { permission_ids: [1, 2, 3] }
const assignPermissionsToRole = async (req, res) => {
  const { id } = req.params;
  const { permission_ids } = req.body;

  if (!Array.isArray(permission_ids) || permission_ids.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'permission_ids must be a non-empty array.',
    });
  }

  try {
    await Role.assignPermissions(id, permission_ids);
    res.status(200).json({ status: 'success', message: 'Permissions assigned to role.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── DELETE /api/roles/:id/permissions ───────────────────────────────────────
// Body: { permission_ids: [1, 2] }
const removePermissionsFromRole = async (req, res) => {
  const { id } = req.params;
  const { permission_ids } = req.body;

  if (!Array.isArray(permission_ids) || permission_ids.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'permission_ids must be a non-empty array.',
    });
  }

  try {
    await Role.removePermissions(id, permission_ids);
    res.status(200).json({ status: 'success', message: 'Permissions removed from role.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

module.exports = {
  getAllRoles,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  assignPermissionsToRole,
  removePermissionsFromRole,
};
