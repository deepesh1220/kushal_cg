const express = require('express');
const router = express.Router();
const {
  getMasterHolidays,
  createMasterHoliday,
  getGeneratedHolidays,
  createGeneratedHoliday,
} = require('../controllers/holidayController');
const { authenticate, authorizeRole } = require('../middleware/authMiddleware');

// ── Master Holiday APIs ───────────────────────────────────────────────────────

// GET  /api/holidays?year=2026     → Fetch all master holidays (with optional year filter)
router.get('/', authenticate, getMasterHolidays);

// POST /api/holidays               → Insert a new master holiday (admin/super_admin only)
router.post('/', authenticate, authorizeRole('admin', 'super_admin'), createMasterHoliday);

// ── School Generated Holiday APIs ─────────────────────────────────────────────

// GET  /api/holidays/generated/:udise_code  → Fetch generated holidays for a school
router.get('/generated/:udise_code', authenticate, getGeneratedHolidays);

// POST /api/holidays/generated              → Principal declares a school holiday
router.post('/generated', authenticate, createGeneratedHoliday);

module.exports = router;
