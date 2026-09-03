const express = require('express');
const router = express.Router();
const deoController = require('../controllers/deoController');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const deoAttendance = require('../controllers/attendanceStatusController').createAttendanceStatusHandlers('deo');

// Apply authentication to all DEO routes
router.use(authenticate);
router.get('/attendance-status', authorize('attendance:view_all'), deoAttendance.getStatus);
router.get('/attendance-status/vts', authorize('attendance:view_all'), deoAttendance.getVts);
router.get('/attendance-status/options', authorize('attendance:view_all'), deoAttendance.getOptions);

// Route to get schools and VTs under DEO's district
// Requires user to be logged in and ideally have the 'deo' role or related permission.
// Using authorize('users:view') as a placeholder; adjust as needed.
router.get('/schools-vts', authorize('attendance:view_all'), deoController.getSchoolsAndVts);
router.get('/dashboard-counts', authorize('attendance:view_all'), deoController.getDeoDashboardCounts);
router.get('/school-reports', authorize('attendance:view_all'), deoController.getSchoolReports);
router.get('/vtps', authorize('attendance:view_all'), deoController.getDistrictVtpList);
router.get('/vt-teachers', authorize('attendance:view_all'), deoController.getDistrictVtTeachers);
router.get('/vtp-names', authorize('attendance:view_all'), deoController.getDistrictVtpNames);
router.get('/trades', authorize('attendance:view_all'), deoController.getDistrictTrades);
router.post('/attendance', authorize('attendance:view_all'), deoController.getDeoAttendance);

module.exports = router;
