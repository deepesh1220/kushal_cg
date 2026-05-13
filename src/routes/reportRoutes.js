const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  downloadMonthlyAttendance,
  getMonthlySummary,
  approveMonthlyReport,
  generateMonthlyVtReport,
  downloadVtMonthlyReportPdf,
  getMonthlyVtReportsList,
  getDashboardPendingCounts,
} = require('../controllers/reportController');

// All report routes require 
router.use(authenticate);

// ── Existing: Monthly Summary ─────────────────────────────────────────────────
router.get('/monthly-summary', getMonthlySummary);

// ── Existing: Personal Attendance Download ────────────────────────────────────
router.get('/attendance/download', authorize('leave:view_own'), downloadMonthlyAttendance);

// ── Existing: Approve Monthly Report (enhanced with sequential enforcement) ───
router.post('/approve', approveMonthlyReport);

// ── New: Generate Monthly VT Report (creates attendance snapshot) ─────────────
router.post('/generate-monthly-vt-report', generateMonthlyVtReport);

// ── New: Download NSQF PDF for a VT ──────────────────────────────────────────
router.get('/download-vt-pdf', downloadVtMonthlyReportPdf);

// ── New: List monthly VT reports (role-scoped) ────────────────────────────────
router.get('/monthly-vt-reports', getMonthlyVtReportsList);

// ── New: Dashboard pending-action counts ─────────────────────────────────────
router.get('/dashboard-pending-counts', getDashboardPendingCounts);

module.exports = router;
