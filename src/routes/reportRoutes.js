const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  downloadMonthlyAttendance,
  getMonthlySummary,
  approveMonthlyReport
} = require('../controllers/reportController');

// All report routes require authentication
router.use(authenticate);

// ── Monthly Summary ───────────────────────────────────────────────────────────
router.get(
  '/monthly-summary',
  // authorize('leave:view_all'), // Or any specific permission for this report
  getMonthlySummary
);

// ── Attendance Download ───────────────────────────────────────────────
router.get(
  '/attendance/download',
  authorize('leave:view_own'), // Requires 'leave:view_own' or specific report permission
  downloadMonthlyAttendance
);

// ── Approve Monthly Report ────────────────────────────────────────────
router.post(
  '/approve',
  approveMonthlyReport
);

module.exports = router;
