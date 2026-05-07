const express = require('express');
const router = express.Router();
const { register, login, loginVT, refreshToken, logout, getMe, getRoles } = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const upload = require('../utils/uploadUtils');

// Public routes
router.post('/register', upload.single('profile_photo'), register);
router.post('/web/login', login);
router.post('/app/login', loginVT);   // Dedicated VT login: { phone, password }
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);
router.get('/roles', getRoles);

// Protected routes
router.post('/me', getMe);

module.exports = router;
