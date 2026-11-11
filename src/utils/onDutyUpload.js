const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadDir = path.join(__dirname, '../uploads/on-duty');
fs.mkdirSync(uploadDir, { recursive: true });

const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const MAX_ATTACHMENT_SIZE = 500 * 1024;

const detectAttachmentType = (header) => {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'jpeg';
  }
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'png';
  }
  if (header.length >= 5 && header.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'pdf';
  }
  return null;
};

const validateOnDutyAttachment = async (file) => {
  if (!file?.path) return false;

  const extension = path.extname(file.originalname || file.filename).toLowerCase();
  const handle = await fsPromises.open(file.path, 'r');
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const detectedType = detectAttachmentType(header.subarray(0, bytesRead));

    if (detectedType === 'jpeg') return extension === '.jpg' || extension === '.jpeg';
    if (detectedType === 'png') return extension === '.png';
    if (detectedType === 'pdf') return extension === '.pdf';
    return false;
  } finally {
    await handle.close();
  }
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `od-${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const uploadOnDutyAttachment = multer({
  storage,
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
    return callback(null, true);
  },
});

module.exports = {
  MAX_ATTACHMENT_SIZE,
  detectAttachmentType,
  uploadOnDutyAttachment,
  validateOnDutyAttachment,
};
