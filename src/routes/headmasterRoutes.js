const { Router } = require('express');
const {
  getHeadmaster,
  createHeadmaster,
  updateHeadmaster,
  deleteHeadmaster,
  getByDistrict,
  getByBlock,
  updateSchoolTime,
} = require('../controllers/headmasterController');

// Plug in your auth middleware here when ready, e.g.:
// const { authenticate } = require('../middleware/authMiddleware');

const router = Router();

// ── District / Block lookup (defined BEFORE /:teacher_code to avoid param clash) ─
router.get('/district/:district_id', /* authenticate, */ getByDistrict);
router.get('/block/:block_id',       /* authenticate, */ getByBlock);

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.get('/:teacher_code',    /* authenticate, */ getHeadmaster);
router.post('/',                /* authenticate, */ createHeadmaster);
router.patch('/school-time',    /* authenticate, */ updateSchoolTime);
router.patch('/:teacher_code',  /* authenticate, */ updateHeadmaster);
router.delete('/:teacher_code', /* authenticate, */ deleteHeadmaster);

module.exports = router;
