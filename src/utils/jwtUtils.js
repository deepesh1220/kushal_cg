const jwt = require('jsonwebtoken');
require('dotenv').config();

// ─── Generate Access Token ────────────────────────────────────────────────────
const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
};

// ─── Generate Refresh Token ───────────────────────────────────────────────────
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
};

// ─── Verify Access Token ──────────────────────────────────────────────────────
const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

// ─── Verify Refresh Token ─────────────────────────────────────────────────────
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

// ─── Decode token expiry to Date ─────────────────────────────────────────────
const getRefreshTokenExpiry = () => {
  const days = parseInt(process.env.JWT_REFRESH_EXPIRES_IN) || 7;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const generateDeviceChangeToken = (payload) => jwt.sign(
  { ...payload, token_type: 'device_change' },
  process.env.JWT_SECRET,
  { expiresIn: process.env.DEVICE_CHANGE_TOKEN_EXPIRES_IN || '10m' }
);

const verifyDeviceChangeToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.token_type !== 'device_change') {
    throw new jwt.JsonWebTokenError('Invalid device change token.');
  }
  return decoded;
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
  generateDeviceChangeToken,
  verifyDeviceChangeToken,
};
