const express = require('express');
const router  = express.Router();
const {
  checkIn,
  checkOut,
  markAttendance,
  getMyAttendance,
  getAllAttendance,
  getProviderAttendance,
  updateAttendance,
  deleteAttendance,
  getMonthlySummary,
  getDailyReport,
} = require('../controllers/attendanceController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// All routes require a valid token
router.use(authenticate);

// ── VT self-service ───────────────────────────────────────────────────────────
router.post('/check-in',              authorize('attendance:create'),          checkIn);
router.patch('/check-out',            authorize('attendance:create'),          checkOut);
router.get('/my',                     authorize('attendance:view_own'),        getMyAttendance);

// ── DEO / Admin — mark on behalf of others ───────────────────────────────────
router.post('/mark',                  authorize('attendance:create_others'),   markAttendance);

// ── Admin / DEO / Headmaster — view all ──────────────────────────────────────
router.get('/',                       authorize('attendance:view_all'),        getAllAttendance);

// ── VT Provider — view their teachers ────────────────────────────────────────
router.get('/provider',               authorize('attendance:view_teachers'),   getProviderAttendance);

// ── Monthly summary ───────────────────────────────────────────────────────────
router.get('/summary/:userId',        authorize('attendance:report'),          getMonthlySummary);

// ── Daily per-day report with filters & totals ────────────────────────────────
router.post('/report/daily',           authorize('attendance:view_own'),        getDailyReport);

// ── Admin / DEO — edit & delete ───────────────────────────────────────────────
router.put('/:id',                    authorize('attendance:update'),          updateAttendance);
router.delete('/:id',                 authorize('attendance:delete'),          deleteAttendance);

module.exports = router;
