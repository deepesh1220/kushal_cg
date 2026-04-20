const express = require('express');
const router  = express.Router();
const {
  getPendingVts,
  getAllVts,
  approveVt,
  rejectVt,
} = require('../controllers/vtApprovalController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

router.use(authenticate);

// Headmaster & admin — view pending VTs for their school
router.get('/pending',           authorize('vt:approve'), getPendingVts);

// Admin only — view all VTs with status filter (?status=pending|accepted|rejected)
router.get('/all',               authorize('vt:approve'), getAllVts);

// Headmaster & admin — approve a VT
router.patch('/:userId/approve', authorize('vt:approve'), approveVt);

// Headmaster & admin — reject a VT
router.patch('/:userId/reject',  authorize('vt:approve'), rejectVt);

module.exports = router;
