const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { submitRequest, listForHm, listForVtp, actionByHm, actionByVtp } = require('../controllers/deviceChangeController');

router.post('/request', submitRequest);
router.post('/headmaster/list', authenticate, authorize('vt:approve'), listForHm);
router.patch('/:requestId/headmaster/status', authenticate, authorize('vt:approve'), actionByHm);
router.post('/vtp/list', authenticate, authorize('vt:approve_vtp'), listForVtp);
router.patch('/:requestId/vtp/status', authenticate, authorize('vt:approve_vtp'), actionByVtp);

module.exports = router;
