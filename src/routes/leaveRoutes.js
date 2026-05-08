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
  getLeaveReport,
  downloadMonthlyAttendance,
  applyOnDuty,
  approveOnDuty,
  getMyOnDutyRequests,
  getOnDutyById,
  applyRegularization,
  approveRegularization,
  getMyRegularizationRequests
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
router.post('/list', authorize('leave:view_all'), getAllLeaves);

// Approve or reject a leave request
router.patch('/:id/status', authorize('leave:approve'), approveRejectLeave);

// ── On Duty (OD) routes ─────────────────────────────────────────────────────
// Apply for On Duty
router.post('/apply-od', authorize('leave:request'), applyOnDuty);

// Approve or reject On Duty request
router.patch('/:id/od-status', authorize('leave:approve'), approveOnDuty);

// Get my own OD requests
router.get('/od/my', authorize('leave:view_own'), getMyOnDutyRequests);

// Get specific OD request by ID
router.get('/od/:id', authorize('leave:view_own'), getOnDutyById);

// ── Attendance Regularization routes ────────────────────────────────────────
// Apply for Regularization
router.post('/apply-regularization', authorize('leave:request'), applyRegularization);

// Approve or reject Regularization request
router.patch('/:id/regularize-status', authorize('leave:approve'), approveRegularization);

// Get my own regularization requests
router.get('/regularization/my', authorize('leave:view_own'), getMyRegularizationRequests);

// ── Attendance Download ───────────────────────────────────────────────
router.get(
  '/attendance/download',
  authorize('leave:view_own'),
  downloadMonthlyAttendance
);


module.exports = router;
