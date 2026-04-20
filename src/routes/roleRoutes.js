const express = require('express');
const router = express.Router();
const {
  getAllRoles,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  assignPermissionsToRole,
  removePermissionsFromRole,
} = require('../controllers/roleController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authenticate);

router.get('/', authorize('roles:view'), getAllRoles);
router.post('/', authorize('roles:create'), createRole);
router.put('/:id', authorize('roles:update'), updateRole);
router.delete('/:id', authorize('roles:delete'), deleteRole);
router.get('/:id/permissions', authorize('roles:view'), getRolePermissions);
router.post('/:id/permissions', authorize('roles:assign'), assignPermissionsToRole);
router.delete('/:id/permissions', authorize('roles:assign'), removePermissionsFromRole);

module.exports = router;
