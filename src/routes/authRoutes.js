const express = require('express');
const router = express.Router();
const { register, validateRegistrationLocation, login, loginVT, refreshToken, logout, getMe, getRoles } = require('../controllers/authController');
const upload = require('../utils/uploadUtils');

// Public routes
router.post('/register', upload.single('profile_photo'), register);
router.post('/validate-registration-location', validateRegistrationLocation);
router.post('/web/login', login);
router.post('/app/login', loginVT);   // Dedicated VT login: { phone|teacher_code|identifier, password, device_id }
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);
router.get('/roles', getRoles); // Public: required on the login screen before authentication

// Protected routes
router.post('/me', getMe);

module.exports = router;
