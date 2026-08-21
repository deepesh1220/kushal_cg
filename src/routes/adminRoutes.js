const express = require('express');
const router  = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// All routes require a valid token
router.use(authenticate);

// ── Admin routes go here ───────────────────────────────────────────────────────
router.get('/dashboard-counts', authorize('users:view'), adminController.getDashboardCounts);
router.get('/get-count', authorize('users:view'), adminController.getCount);
router.get('/attendance-tracking', authorize('users:view'), adminController.getAttendanceTracking);
router.get('/schools', authorize('users:view'), adminController.getSchools);
router.get('/vtp', authorize('users:view'), adminController.getVtpList);
router.get('/vtp-options', authorize('users:view'), adminController.getVtpOptions);
router.post('/vtp', authorize('users:create'), adminController.createVtp);
router.put('/vtp/:id', authorize('users:update'), adminController.updateVtp);
router.delete('/vtp/:id', authorize('users:delete'), adminController.deleteVtp);
router.get('/deos', authorize('users:view'), adminController.getDeoList);
router.put('/deos/:id', authorize('users:update'), adminController.updateDeo);

module.exports = router;
