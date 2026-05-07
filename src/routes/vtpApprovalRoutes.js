const express = require('express');
const router = express.Router();
const {
  getVtpScopedVts,
  approveVtByVtp,
  rejectVtByVtp,
} = require('../controllers/vtpApprovalController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

router.use(authenticate);

// VTP & admin — view VTs scoped to their organization (?status=all|pending|accepted|rejected)
router.get('/vts', authorize('vt:approve_vtp'), getVtpScopedVts);

// VTP & admin — approve a VT (VTP layer)
router.patch('/:userId/approve', authorize('vt:approve_vtp'), approveVtByVtp);

// VTP & admin — reject a VT (VTP layer)
router.patch('/:userId/reject', authorize('vt:approve_vtp'), rejectVtByVtp);

module.exports = router;
