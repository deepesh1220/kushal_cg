const { Router } = require('express');
const {
  getHeadmaster,
  createHeadmaster,
  updateHeadmaster,
  deleteHeadmaster,
  getByDistrict,
  getByBlock,
  getSchoolLeaves,
  approveLeaveCancellationByHm,
  updateSchoolTime,
  getSchoolTiming,
  getSchoolDetails,
  updateSchoolLatLong,
  getVtList,
  markVtAttendance, 
  updateVtAttendance,
} = require('../controllers/headmasterController');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const headmasterAttendance = require('../controllers/attendanceStatusController').createAttendanceStatusHandlers('headmaster');

const router = Router();
router.get('/attendance-status', authenticate, authorize('attendance:create_others'), headmasterAttendance.getStatus);
router.get('/attendance-status/vts', authenticate, authorize('attendance:create_others'), headmasterAttendance.getVts);

// ── District / Block lookup (defined BEFORE /:teacher_code to avoid param clash) ─
router.get('/district/:district_id', /* authenticate, */ getByDistrict);
router.get('/block/:block_id',       /* authenticate, */ getByBlock);
router.post('/school',    /* authenticate, */ getSchoolDetails);

// ── School leave requests (headmaster scope) ──────────────────────────────────
// GET /api/headmaster/leaves
// Must be defined BEFORE /:teacher_code to prevent Express treating 'leaves' as a param
router.get('/leaves', authenticate, authorize('leave:view_all'), getSchoolLeaves);
router.patch('/leave-cancellation/:cancellationRequestId/approve', authenticate, authorize('leave:approve'), approveLeaveCancellationByHm);
router.post('/vt-list', authenticate, getVtList);
router.post('/mark-vt-attendance', authenticate, authorize('attendance:create_others'), markVtAttendance);
router.put('/update-vt-attendance/:id', authenticate, authorize('attendance:create_others'), updateVtAttendance);

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.get('/school-time',   /* authenticate, */ getSchoolTiming);
router.patch('/school-time', /* authenticate, */ updateSchoolTime);
router.get('/:teacher_code',    /* authenticate, */ getHeadmaster);
router.post('/',                /* authenticate, */ createHeadmaster);
router.patch('/update-lat-long', updateSchoolLatLong);
router.patch('/:teacher_code',  /* authenticate, */ updateHeadmaster);
router.delete('/:teacher_code', /* authenticate, */ deleteHeadmaster);

module.exports = router;
