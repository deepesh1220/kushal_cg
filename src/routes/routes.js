const express = require('express');
const router = express.Router();

// ─── Import All Routes ────────────────────────────────────────────────────────
const authRoutes = require('./authRoutes');
const roleRoutes = require('./roleRoutes');
const permissionRoutes = require('./permissionRoutes');
const attendanceRoutes = require('./attendanceRoutes');
const vtRoutes = require('./vtRoutes');
const leaveRoutes = require('./leaveRoutes');
const headmasterRoutes = require('./headmasterRoutes');
const deoRoutes = require('./deoRoutes');
const holidayRoutes = require('./holidayRoutes');
const reportRoutes = require('./reportRoutes');

// ─── Register API Routes ──────────────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/roles', roleRoutes);
router.use('/permissions', permissionRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/vt', vtRoutes);
router.use('/headmaster', headmasterRoutes);
router.use('/leaves', leaveRoutes);
router.use('/deo', deoRoutes);
router.use('/holidays', holidayRoutes);
router.use('/reports', reportRoutes);

module.exports = router;
