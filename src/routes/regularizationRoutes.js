const express = require('express');
const router  = express.Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  applyRegularization,
  applyRegularizationWithLocation,
  approveRegularization,
  getMyRegularizationRequests,
  getAllRegularizations,
  getVtpRegularizations,
  actionRegularizationByVtp,
} = require('../controllers/regularizationController');

// All regularization routes require authentication
router.use(authenticate);

// ── VT routes ────────────────────────────────────────────────────────────────
// Apply for an attendance regularization
// POST /api/regularization/apply   body: { date, reason }
router.post('/apply', authorize('leave:request'), applyRegularization);

// POST /api/regularization/apply-with-location   body: { date, reason, latitude, longitude }
router.post('/apply-with-location', authorize('leave:request'), applyRegularizationWithLocation);

// Get my own regularization requests
// GET /api/regularization/my   query: { status, from_date, to_date, page, limit }
router.get('/my', authorize('leave:view_own'), getMyRegularizationRequests);

// ── Admin / Headmaster routes ─────────────────────────────────────────────────
// Get all regularizations (filtered by udise_code or user_id via POST body)
// POST /api/regularization/list
router.post('/list', authorize('leave:approve'), getAllRegularizations);

// VTP-scoped dual approval routes
router.post('/vtp', authorize('vt:approve_vtp'), getVtpRegularizations);
router.patch('/vtp/:requestId/status', authorize('vt:approve_vtp'), actionRegularizationByVtp);

// Approve or reject a regularization request
// PATCH /api/regularization/:id/status   body: { status }
router.patch('/:id/status', authorize('leave:approve'), approveRegularization);

module.exports = router;
