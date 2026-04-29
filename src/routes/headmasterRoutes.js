const { Router } = require('express');
const {
  getHeadmaster,
  createHeadmaster,
  updateHeadmaster,
  deleteHeadmaster,
  getByDistrict,
  getByBlock,
  getSchoolLeaves,
  updateSchoolTime,
} = require('../controllers/headmasterController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = Router();

// ── District / Block lookup (defined BEFORE /:teacher_code to avoid param clash) ─
router.get('/district/:district_id', getByDistrict);
router.get('/block/:block_id', getByBlock);

// ── School leave requests (headmaster scope) ──────────────────────────────────
// GET /api/headmaster/leaves
// Must be defined BEFORE /:teacher_code to prevent Express treating 'leaves' as a param
router.get('/leaves', authenticate, authorize('leave:view_all'), getSchoolLeaves);

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.get('/:teacher_code',    /* authenticate, */ getHeadmaster);
router.post('/',                /* authenticate, */ createHeadmaster);
router.patch('/school-time',    /* authenticate, */ updateSchoolTime);
router.patch('/:teacher_code',  /* authenticate, */ updateHeadmaster);
router.delete('/:teacher_code', /* authenticate, */ deleteHeadmaster);

module.exports = router;
