const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  downloadMonthlyAttendance,
  getMonthlySummary,
  approveMonthlyReport,
  approveTeacherMonthlyReport,
  approveMonthlyReportBulk,
  generateMonthlyVtReport,
  downloadVtMonthlyReportPdf,
  downloadVtpVtMonthlyExcel,
  downloadDeoVtMonthlyExcel,
  getMonthlyVtReportsList,
  getDashboardPendingCounts,
  getLocationMasterData,
} = require('../controllers/reportController');

// All report routes require 
router.use(authenticate);

// ── Existing: Monthly Summary ─────────────────────────────────────────────────
router.get('/monthly-summary', getMonthlySummary);

// ── Existing: Personal Attendance Download ────────────────────────────────────
router.get('/attendance/download', authorize('leave:view_own'), downloadMonthlyAttendance);

// ── Existing: Approve Monthly Report (enhanced with sequential enforcement) ───
router.post('/approve', approveMonthlyReport);
router.post('/approve-teacher', approveTeacherMonthlyReport);
router.post('/approve-bulk', approveMonthlyReportBulk);

// ── New: Generate Monthly VT Report (creates attendance snapshot) ─────────────
router.post('/generate-monthly-vt-report', generateMonthlyVtReport);

// ── New: Download NSQF PDF for a VT ──────────────────────────────────────────
router.get('/download-vt-pdf', downloadVtMonthlyReportPdf);
router.get('/download-vtp-vt-excel', downloadVtpVtMonthlyExcel);
router.get('/download-deo-vt-excel', downloadDeoVtMonthlyExcel);

// ── New: List monthly VT reports (role-scoped) ────────────────────────────────
router.get('/monthly-vt-reports', getMonthlyVtReportsList);

// ── New: Dashboard pending-action counts ─────────────────────────────────────
router.get('/dashboard-pending-counts', getDashboardPendingCounts);

// ── New: Cascading location master data (districts / blocks / clusters) ───────
router.get('/location-master', getLocationMasterData);

module.exports = router;
