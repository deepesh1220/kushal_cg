const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadDir = path.join(__dirname, '../uploads/on-duty');
fs.mkdirSync(uploadDir, { recursive: true });

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);
const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `od-${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const uploadOnDutyAttachment = multer({
  storage,
  limits: { fileSize: 500 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedMimeTypes.has(file.mimetype) || !allowedExtensions.has(extension)) {
      return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
    return callback(null, true);
  },
});

module.exports = { uploadOnDutyAttachment };
