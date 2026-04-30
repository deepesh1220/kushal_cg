const express = require('express');
const router = express.Router();
const { getHolidays, clearCache } = require('../controllers/holidayController');
const { authenticate } = require('../middleware/authMiddleware');

// GET /api/holidays?year=2026  — public, no auth needed (holidays are public data)
router.get('/', getHolidays);

// DELETE /api/holidays?year=2026  — admin-only cache busting
router.delete('/', authenticate, clearCache);

module.exports = router;
