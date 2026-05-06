const express = require('express');
const router = express.Router();
const {
  getPendingVts,
  getAllVts,
  approveVt,
  rejectVt,
  getVtByMobile,
  updateVtProfile,
} = require('../controllers/vtApprovalController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// Public route — lookup VT details by mobile (used during registration)
// POST /api/vt/by-mobile  →  body: { mobile }
router.post('/by-mobile', getVtByMobile);

router.use(authenticate);

// Headmaster & admin — view pending VTs for their school
router.get('/list', authorize('vt:approve'), getPendingVts);

// Admin only — view all VTs with status filter (?status=pending|accepted|rejected)
router.get('/all', authorize('vt:approve'), getAllVts);

// Headmaster & admin — approve a VT
router.patch('/:userId/approve', authorize('vt:approve'), approveVt);

// Headmaster & admin — reject a VT
router.patch('/:userId/reject', authorize('vt:approve'), rejectVt);

// VT — update own profile on vt_staff_details (VT only)
router.patch('/update-profile', authorize('attendance:create'), updateVtProfile);

module.exports = router;
