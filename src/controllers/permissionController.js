const Permission = require('../models/Permission');

// ─── GET /api/permissions ─────────────────────────────────────────────────────
const getAllPermissions = async (req, res) => {
  try {
    const permissions = await Permission.findAll();
    res.status(200).json({ status: 'success', data: permissions });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── POST /api/permissions ────────────────────────────────────────────────────
const createPermission = async (req, res) => {
  const { name, module, action, description } = req.body;

  if (!name || !module || !action) {
    return res.status(400).json({
      status: 'error',
      message: 'name, module, and action are required.',
    });
  }

  try {
    const permission = await Permission.create({ name, module, action, description });
    res.status(201).json({ status: 'success', data: permission });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ status: 'error', message: 'Permission name already exists.' });
    }
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── DELETE /api/permissions/:id ─────────────────────────────────────────────
const deletePermission = async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await Permission.delete(id);

    if (!deleted) {
      return res.status(404).json({ status: 'error', message: 'Permission not found.' });
    }

    res.status(200).json({ status: 'success', message: 'Permission deleted.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── POST /api/permissions/user/:userId ───────────────────────────────────────
// Body: { permission_id, is_granted: true/false }
const setUserPermission = async (req, res) => {
  const { userId } = req.params;
  const { permission_id, is_granted } = req.body;

  if (!permission_id || is_granted === undefined) {
    return res.status(400).json({
      status: 'error',
      message: 'permission_id and is_granted are required.',
    });
  }

  try {
    await Permission.setUserPermission(userId, permission_id, is_granted);
    res.status(200).json({ status: 'success', message: 'User permission updated.' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── GET /api/permissions/user/:userId ───────────────────────────────────────
const getUserPermissions = async (req, res) => {
  const { userId } = req.params;

  try {
    const permissions = await Permission.getUserPermissions(userId);
    res.status(200).json({ status: 'success', data: permissions });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

module.exports = {
  getAllPermissions,
  createPermission,
  deletePermission,
  setUserPermission,
  getUserPermissions,
};
