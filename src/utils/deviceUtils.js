const crypto = require('crypto');

const normalizeDeviceId = (deviceId) => String(deviceId || '').trim();
const validateDeviceId = (deviceId) => {
  const normalized = normalizeDeviceId(deviceId);
  return normalized.length >= 8 && normalized.length <= 255;
};
const hashDeviceId = (deviceId) => crypto.createHash('sha256')
  .update(normalizeDeviceId(deviceId)).digest('hex');

module.exports = { normalizeDeviceId, validateDeviceId, hashDeviceId };
