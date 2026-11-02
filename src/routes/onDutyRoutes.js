const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const multer = require('multer');
const { uploadOnDutyAttachment } = require('../utils/onDutyUpload');
const {
  applyOnDuty,
  approveOnDuty,
  getMyOnDutyRequests,
  getOnDutyById,
  getHeadmasterOnDutyRequests,
  getVtpScopedOnDutyRequests,
  actionOnDutyByVtp,
} = require('../controllers/onDutyController');

// All OD routes require authentication
router.use(authenticate);

// ── VT routes ────────────────────────────────────────────────────────────────
// Apply for an On-Duty request
// POST /api/od/apply   multipart/form-data: { from_date, to_date, reason, attachment }
router.post('/apply', authorize('leave:request'), (req, res, next) => {
  uploadOnDutyAttachment.single('attachment')(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Attachment must not exceed 500 KB.'
        : 'Attachment must be a PDF, JPG, JPEG, or PNG file.';
      return res.status(400).json({ status: false, message });
    }

    return next(error);
  });
}, applyOnDuty);

// Get my own OD requests
// GET /api/od/my   query: { status, from_date, to_date, page, limit }
router.get('/my', authorize('leave:view_own'), getMyOnDutyRequests);

// ── Admin / Headmaster routes ─────────────────────────────────────────────────
// Approve or reject an OD request
// PATCH /api/od/:id/status   body: { status }
router.patch('/:id/status', authorize('leave:approve'), approveOnDuty);

// Get all OD requests for headmaster
// POST /api/od/headmaster   body: { udise_code, status, page, limit }
router.post('/headmaster', authorize('leave:approve'), getHeadmasterOnDutyRequests);

// ── VTP routes ────────────────────────────────────────────────────────────────
// Get all OD requests for VTP
// POST /api/od/vtp   body: { status, page, limit }
router.post('/vtp', authorize('vt:approve_vtp'), getVtpScopedOnDutyRequests);

// Approve or reject an OD request (VTP)
// PATCH /api/od/vtp/:requestId/status   body: { status, remarks }
router.patch('/vtp/:requestId/status', authorize('vt:approve_vtp'), actionOnDutyByVtp);

// Get specific OD request by ID
// GET /api/od/:id
router.get('/:id', authorize('leave:view_own'), getOnDutyById);

module.exports = router;
