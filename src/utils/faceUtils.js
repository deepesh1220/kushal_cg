'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

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

// ─── Match threshold ────────────────────────────────────────────────────────
// face-api dlib 128D: same person photos typically score distance 0.30 – 0.50.
// 0.50 is the right real-world balance (strict enough to block impostors,
// loose enough to pass the same person under different lighting/angles).
const MATCH_THRESHOLD = 0.50;

// ─── AES-256-GCM encryption key (32 bytes, derived from env var) ─────────────
const ALGORITHM = 'aes-256-gcm';
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
// INTERNAL: Convert any image buffer → lighting-normalised raw pixel tensor
//
// Problem: direct sunlight / extreme overexposure blows out pixel values,
// causing the 128-D descriptor to drift far from the registered embedding,
// even though the face belongs to the same person.
//
// Fix (applied in order, all lossless to face geometry):
//   1. Resize to 640 px max — keeps enough detail without wasting compute.
//   2. CLAHE (Contrast Limited Adaptive Histogram Equalisation) — locally
//      levels blown-out highlights & deep shadows without touching global
//      brightness much.  width/height 8 = moderate tile size; maxSlope 3
//      limits over-amplification in uniform regions.
//   3. Gamma 1.2 — mild gamma lift to bring up crushed shadow details that
//      CLAHE may not fully recover on its own.
//   4. Linear normalise — stretches the remaining dynamic range so that both
//      registration photos (indoor, controlled) and check-in selfies (outdoor,
//      harsh sun) end up in a similar pixel-value range before hitting the
//      model.  This is the key step that closes the domain gap.
//   5. removeAlpha → raw float32 — same as before.
//
// NOTE: face-api's recognition net is robust to moderate preprocessing;
// CLAHE + gamma + normalize is a well-established pipeline for face
// recognition under variable illumination (see LFW benchmark pre-processing).
// ─────────────────────────────────────────────────────────────────────────────
const bufferToTensor = async (imageBuffer) => {
  const { data, info } = await sharp(imageBuffer)
    .resize({ width: 640, withoutEnlargement: true })   // 1. resize
    .clahe({ width: 8, height: 8, maxSlope: 3 })         // 2. local contrast eq.
    .gamma(1.2)                                          // 3. mild gamma lift
    .normalize()                                         // 4. global range stretch
    .removeAlpha()                                       // 5. 3-channel RGB
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const rgbData = new Float32Array(data); // cast to float32 for TF

  return tf.tensor3d(rgbData, [height, width, 3], 'float32');
};

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACT DESCRIPTOR from a file path (used during registration)
// ─────────────────────────────────────────────────────────────────────────────
const extractDescriptorFromFile = async (imagePath) => {
  await loadModels();
  const buffer = fs.readFileSync(imagePath);
  const tensor = await bufferToTensor(buffer);

  // minConfidence 0.45: slightly lower than default to improve recall under
  // harsh lighting where the detector scores valid faces a bit lower than usual.
  // 0.3 is too noisy; 0.5 sometimes rejects the same face in bright sun.
  const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 });

  try {
    const detection = await faceapi
      .detectSingleFace(tensor, options)
      .withFaceLandmarks()    // landmarks drive internal face-alignment
      .withFaceDescriptor();  // 128D embedding

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
  const buffer = Buffer.from(base64Data, 'base64');
  const tensor = await bufferToTensor(buffer);

  // Same 0.45 threshold as registration — keeps behaviour consistent.
  const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 });

  try {
    const detection = await faceapi
      .detectSingleFace(tensor, options)
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
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  const plaintext = JSON.stringify(descriptorArray);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
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
  const live = new Float32Array(liveArray);

  const distance = faceapi.euclideanDistance(stored, live);

  // Map distance → human-readable score using 0.6 as the "0%" anchor.
  // This is the industry-standard formula for dlib/face-api 128D descriptors.
  //
  //   distance 0.00  →  100%  (identical)
  //   distance 0.30  →   50%  (clearly same person)
  //   distance 0.50  →   17%  (borderline, still isMatch: true)
  //   distance 0.60+ →    0%  (different people)
  //
  // Using (1 - distance) * 100 WITHOUT the /0.6 anchor is WRONG: it makes a
  // same-person match at 0.35 show as 65%, which looks like a failure.
  const matchPercent = Math.max(0, Math.min(100, Math.round((1 - distance / 0.6) * 10000) / 100));

  return {
    distance: Math.round(distance * 10000) / 10000,
    matchPercent,
    isMatch: distance <= MATCH_THRESHOLD,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// SAVE base64 image to disk → returns URL path
// ─────────────────────────────────────────────────────────────────────────────
const saveBase64Image = (base64String, filename) => {
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

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
