const express = require('express');
const router = express.Router();
const {
  getVtpScopedVts,
  getVtStaffOptions,
  getVtpStaffList,
  getVtpDashboardCounts,
  getVtStaffById,
  createVtStaff,
  updateVtStaff,
  deleteVtStaff,
  approveVtByVtp,
  rejectVtByVtp,
  getVtpScopedLeaves,
  approveLeaveByVtp,
  rejectLeaveByVtp,
  approveLeaveCancellationByVtp,
  getVtMobileUpdateRequests,
  updateVtMobileRequestStatus
} = require('../controllers/vtpApprovalController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

router.use(authenticate);

// VTP & admin — view VTs scoped to their organization (?status=all|pending|accepted|rejected)
router.get('/vts', authorize('vt:approve_vtp'), getVtpScopedVts);
router.get('/dashboard/counts', authorize('vt:approve_vtp'), getVtpDashboardCounts);

// VTP-scoped VT master CRUD and cascading form options
router.get('/vt-staff/options', authorize('vt:approve_vtp'), getVtStaffOptions);
router.get('/vt-staff', authorize('vt:approve_vtp'), getVtpStaffList);
router.get('/vt-staff/:staffId', authorize('vt:approve_vtp'), getVtStaffById);
router.post('/vt-staff', authorize('vt:approve_vtp'), createVtStaff);
router.patch('/vt-staff/:staffId', authorize('vt:approve_vtp'), updateVtStaff);
router.delete('/vt-staff/:staffId', authorize('vt:approve_vtp'), deleteVtStaff);
router.get('/vt-mobile-update-requests', authorize('vt:approve_vtp'), getVtMobileUpdateRequests);
router.patch('/vt-mobile-update-requests/:staffId/status', authorize('vt:approve_vtp'), updateVtMobileRequestStatus);

// VTP & admin — approve a VT (VTP layer)
router.patch('/:userId/approve', authorize('vt:approve_vtp'), approveVtByVtp);

// VTP & admin — reject a VT (VTP layer)
router.patch('/:userId/reject', authorize('vt:approve_vtp'), rejectVtByVtp);

// ── Leave Management by VTP ──────────────────────────────────────────────────

// VTP — view leave requests
router.get('/leaves', authorize('vt:approve_vtp'), getVtpScopedLeaves);

// VTP — approve a leave request
router.patch('/leave/:leaveId/approve', authorize('vt:approve_vtp'), approveLeaveByVtp);

// VTP — reject a leave request
router.patch('/leave/:leaveId/reject', authorize('vt:approve_vtp'), rejectLeaveByVtp);
router.patch('/leave-cancellation/:cancellationRequestId/approve', authorize('vt:approve_vtp'), approveLeaveCancellationByVtp);

module.exports = router;
