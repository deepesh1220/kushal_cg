'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const sharp  = require('sharp');

// ── TensorFlow WASM backend (no native build tools needed) ───────────────────
const tf = require('@tensorflow/tfjs');
require('@tensorflow/tfjs-backend-wasm');

// Use the standard entry point (now shimmed to avoid native dependency)
const faceapi = require('@vladmandic/face-api');

// ─── Model path: bundled inside @vladmandic/face-api npm package ─────────────
const MODELS_PATH = path.join(
  path.dirname(require.resolve('@vladmandic/face-api/package.json')),
  'model'
);

// ─── Match threshold: euclidean distance → (1 - 0.30) * 100 = 70% ────────────
const MATCH_THRESHOLD = 0.30;

// ─── AES-256-GCM encryption key (32 bytes, derived from env var) ─────────────
const ALGORITHM      = 'aes-256-gcm';
const ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(process.env.FACE_DESCRIPTOR_SECRET || 'kushal_face_default_key_2026')
  .digest(); // always 32 bytes

let modelsLoaded = false;

// ─────────────────────────────────────────────────────────────────────────────
// LOAD MODELS (once at startup, cached in memory)
// ─────────────────────────────────────────────────────────────────────────────
const loadModels = async () => {
  if (modelsLoaded) return;

  // Set TF backend to WASM (no native binaries required)
  await tf.setBackend('wasm');
  await tf.ready();

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);

  modelsLoaded = true;
  console.log('✅ Face-API models loaded. Backend:', tf.getBackend());
};

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Convert any image buffer → raw pixel Float32Array tensor
// Uses sharp to decode JPEG/PNG → raw RGB pixels → TF tensor
// ─────────────────────────────────────────────────────────────────────────────
const bufferToTensor = async (imageBuffer) => {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()               // convert to RGBA
    .raw()
    .toBuffer({ resolveWithObject: true });

  // face-api expects an HTMLImageElement-like object or a 3-channel tensor
  // Build a 3D tensor [height, width, 3] from RGBA → RGB
  const { width, height } = info;
  const rgbData = new Uint8Array(width * height * 3);

  for (let i = 0; i < width * height; i++) {
    rgbData[i * 3]     = data[i * 4];     // R
    rgbData[i * 3 + 1] = data[i * 4 + 1]; // G
    rgbData[i * 3 + 2] = data[i * 4 + 2]; // B
  }

  return tf.tensor3d(rgbData, [height, width, 3], 'int32');
};

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACT DESCRIPTOR from a file path (used during registration)
// ─────────────────────────────────────────────────────────────────────────────
const extractDescriptorFromFile = async (imagePath) => {
  await loadModels();
  const buffer = fs.readFileSync(imagePath);
  const tensor = await bufferToTensor(buffer);

  try {
    const detection = await faceapi
      .detectSingleFace(tensor)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return null;
    return Array.from(detection.descriptor); // plain JS array of 128 floats

  } finally {
    tensor.dispose(); // IMPORTANT: free GPU/WASM memory
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACT DESCRIPTOR from a base64 image string (used during check-in/out)
// ─────────────────────────────────────────────────────────────────────────────
const extractDescriptorFromBase64 = async (base64String) => {
  await loadModels();

  // Strip "data:image/jpeg;base64," prefix if present
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  const buffer     = Buffer.from(base64Data, 'base64');
  const tensor     = await bufferToTensor(buffer);

  try {
    const detection = await faceapi
      .detectSingleFace(tensor)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return null;
    return Array.from(detection.descriptor);

  } finally {
    tensor.dispose();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ENCRYPT descriptor array → AES-256-GCM encrypted JSON string
// ─────────────────────────────────────────────────────────────────────────────
const encryptDescriptor = (descriptorArray) => {
  const iv     = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  const plaintext = JSON.stringify(descriptorArray);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  return JSON.stringify({
    iv:      iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data:    encrypted.toString('hex'),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// DECRYPT stored descriptor string → plain array of 128 floats
// ─────────────────────────────────────────────────────────────────────────────
const decryptDescriptor = (encryptedString) => {
  const { iv, authTag, data } = JSON.parse(encryptedString);

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data, 'hex')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE two face descriptors
// storedRaw  → encrypted string from DB
// liveArray  → plain array extracted from live photo
// Returns: { distance, matchPercent, isMatch }
// ─────────────────────────────────────────────────────────────────────────────
const compareFaces = (storedRaw, liveArray) => {
  let storedArray;

  try {
    // Primary: encrypted string format
    if (typeof storedRaw === 'string') {
      storedArray = decryptDescriptor(storedRaw);
    } else {
      // Legacy fallback: plain JSON array stored directly
      storedArray = Array.isArray(storedRaw) ? storedRaw : Object.values(storedRaw);
    }
  } catch {
    storedArray = Array.isArray(storedRaw) ? storedRaw : Object.values(storedRaw);
  }

  const stored = new Float32Array(storedArray);
  const live   = new Float32Array(liveArray);

  const distance    = faceapi.euclideanDistance(stored, live);

  // distance 0.00 → 100%  |  distance 0.25 → 75%  |  distance 0.60+ → ~0%
  const matchPercent = Math.max(0, Math.round((1 - distance) * 10000) / 100);

  return {
    distance,
    matchPercent,
    isMatch: distance <= MATCH_THRESHOLD, // ≤ 0.25 means ≥ 75%
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// SAVE base64 image to disk → returns URL path
// ─────────────────────────────────────────────────────────────────────────────
const saveBase64Image = (base64String, filename) => {
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  const buffer     = Buffer.from(base64Data, 'base64');

  const uploadDir = path.join(__dirname, '../uploads/checkin');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, buffer);

  return `/uploads/checkin/${filename}`;
};

module.exports = {
  loadModels,
  extractDescriptorFromFile,
  extractDescriptorFromBase64,
  encryptDescriptor,
  decryptDescriptor,
  compareFaces,
  saveBase64Image,
};
