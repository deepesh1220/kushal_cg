/**
 * Leave Balance Routes
 * API endpoints for leave balance management
 */

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  getMyBalance,
  getTeacherBalance,
  getSchoolBalances,
  triggerMonthlyCredit,
  triggerYearEnd,
  getCronStatus,
  getPolicy,
  initializeBalances,
  adjustBalance,
  checkLeaveApproval,
  approveWithDeduction
} = require('../controllers/leaveBalanceController');

// All routes require authentication
router.use(authenticate);

// ── Public (authenticated) ─────────────────────────────────────────────────
// Get leave policy constants (all authenticated users may read)
router.get('/policy', getPolicy);

// ── VT Routes ───────────────────────────────────────────────────────────────
// Get own leave balance and history
router.get('/my', authorize('leave:view_balance_own'), getMyBalance);

// ── Principal/Admin Routes ─────────────────────────────────────────────────
// Get all teachers' balances for school
router.get('/school', authorize('leave:view_balance_all'), getSchoolBalances);

// Get specific teacher's balance
router.get('/teacher/:teacherId', authorize('leave:view_balance_all'), getTeacherBalance);

// Check if leave can be approved (balance check)
router.get('/check/:leaveRequestId', authorize('leave:approve'), checkLeaveApproval);

// Approve/reject leave with automatic deduction
router.post('/approve-with-deduction/:leaveRequestId', authorize('leave:approve'), approveWithDeduction);

// ── Admin Only Routes ──────────────────────────────────────────────────────
// Trigger monthly leave credit job manually
router.post('/credit-monthly', authorize('leave:manage_balance'), triggerMonthlyCredit);

// Trigger year-end carry-forward job manually
router.post('/year-end-carry-forward', authorize('leave:manage_balance'), triggerYearEnd);

// Get cron job status
router.get('/cron-status', authorize('leave:manage_balance'), getCronStatus);

// Initialize leave balances for all VTs
router.post('/initialize', authorize('leave:manage_balance'), initializeBalances);

// Manual balance adjustment
router.post('/adjust', authorize('leave:manage_balance'), adjustBalance);

module.exports = router;
