const express = require('express');
const router = express.Router();
const {
  getAllPermissions,
  createPermission,
  deletePermission,
  setUserPermission,
  getUserPermissions,
} = require('../controllers/permissionController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authenticate);

router.get('/',                          authorize('permissions:manage'), getAllPermissions);
router.post('/',                         authorize('permissions:manage'), createPermission);
router.delete('/:id',                    authorize('permissions:manage'), deletePermission);
router.get('/user/:userId',              authorize('permissions:manage'), getUserPermissions);
router.post('/user/:userId',             authorize('permissions:manage'), setUserPermission);

module.exports = router;
