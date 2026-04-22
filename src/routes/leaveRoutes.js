const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  applyLeave,
  getMyLeaves,
  getAllLeaves,
  approveRejectLeave,
  updateLeave,
  deleteLeave,
  getLeaveReport
} = require('../controllers/leaveController');

// All leave routes require authentication
router.use(authenticate);

// ── VT routes ───────────────────────────────────────────────────────────────
// Apply for a new leave
router.post('/apply', authorize('leave:request'), applyLeave);

// Get my own leave requests
router.get('/my', authorize('leave:view_own'), getMyLeaves);

// Get leave report (resembles getDailyReport for attendance)
router.post('/report', authorize('leave:view_own'), getLeaveReport);

// Update my pending leave request
router.put('/:id', authorize('leave:request'), updateLeave);

// Delete my pending leave request
router.delete('/:id', authorize('leave:request'), deleteLeave);

// ── Admin / Headmaster routes ───────────────────────────────────────────────
// View all leave requests (Headmasters see only their VT's requests, Admin sees all)
router.get('/all', authorize('leave:view_all'), getAllLeaves);

// Approve or reject a leave request
router.patch('/:id/status', authorize('leave:approve'), approveRejectLeave);

module.exports = router;
