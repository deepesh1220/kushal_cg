const express = require('express');

const router = express.Router();



// ─── Import All Routes ────────────────────────────────────────────────────────

const authRoutes = require('./authRoutes');

const roleRoutes = require('./roleRoutes');

const permissionRoutes = require('./permissionRoutes');

const attendanceRoutes = require('./attendanceRoutes');

const vtRoutes = require('./vtRoutes');

const vtpApprovalRoutes = require('./vtpApprovalRoutes');

const leaveRoutes = require('./leaveRoutes');

const leaveBalanceRoutes = require('./leaveBalanceRoutes');

const headmasterRoutes = require('./headmasterRoutes');

const deoRoutes = require('./deoRoutes');

const holidayRoutes = require('./holidayRoutes');

const reportRoutes = require('./reportRoutes');
const superAdminRoutes = require('./superAdminRoutes');
const onDutyRoutes = require('./onDutyRoutes');
const regularizationRoutes = require('./regularizationRoutes');



// ─── Register API Routes ──────────────────────────────────────────────────────

router.use('/auth', authRoutes);

router.use('/roles', roleRoutes);

router.use('/permissions', permissionRoutes);

router.use('/attendance', attendanceRoutes);

router.use('/vt', vtRoutes);

router.use('/vtp', vtpApprovalRoutes);

router.use('/headmaster', headmasterRoutes);

router.use('/leaves', leaveRoutes);

router.use('/leave-balance', leaveBalanceRoutes);

router.use('/deo', deoRoutes);

router.use('/holidays', holidayRoutes);

router.use('/reports', reportRoutes);
router.use('/super-admin', superAdminRoutes);
router.use('/od', onDutyRoutes);
router.use('/regularization', regularizationRoutes);



module.exports = router;

