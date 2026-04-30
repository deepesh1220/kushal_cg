const express = require('express');
const router = express.Router();
const deoController = require('../controllers/deoController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

// Apply authentication to all DEO routes
router.use(authenticate);

// Route to get schools and VTs under DEO's district
// Requires user to be logged in and ideally have the 'deo' role or related permission.
// Using authorize('users:view') as a placeholder; adjust as needed.
router.get('/schools-vts', authorize('attendance:view_all'), deoController.getSchoolsAndVts);

module.exports = router;
