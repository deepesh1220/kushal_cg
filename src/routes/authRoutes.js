const express = require('express');
const router = express.Router();
const { register, login, refreshToken, logout, getMe } = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const upload = require('../utils/uploadUtils');

// Public routes
router.post('/register',      upload.single('profile_photo'), register);
router.post('/login',         login);
router.post('/refresh-token', refreshToken);
router.post('/logout',        logout);

// Protected routes
router.get('/me', authenticate, getMe);

module.exports = router;
