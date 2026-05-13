const express = require('express');
const router = express.Router();
const {
  getVtpScopedVts,
  approveVtByVtp,
  rejectVtByVtp,
  getVtpScopedLeaves,
  approveLeaveByVtp,
  rejectLeaveByVtp
} = require('../controllers/vtpApprovalController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

router.use(authenticate);

// VTP & admin — view VTs scoped to their organization (?status=all|pending|accepted|rejected)
router.get('/vts', authorize('vt:approve_vtp'), getVtpScopedVts);

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

module.exports = router;
