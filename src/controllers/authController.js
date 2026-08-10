const bcrypt = require('bcryptjs');
const path = require('path');
const User = require('../models/User');
const Role = require('../models/Role');
const RefreshToken = require('../models/RefreshToken');
const VtStaffDetail = require('../models/VtStaffDetail');
const Attendance = require('../models/Attendance');
const Headmaster = require('../models/Headmaster');
const Deo = require('../models/Deo');
const Vtp = require('../models/Vtp');
const Report = require('../models/Report');
const { pool } = require('../config/db');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
  generateDeviceChangeToken,
} = require('../utils/jwtUtils');
const { toIST } = require('../utils/timeUtils');
const { validateDeviceId, hashDeviceId } = require('../utils/deviceUtils');
const { SCHOOL_RADIUS_METERS, parseCoordinates, getDistanceInMeters, isTrue } = require('../utils/locationUtils');
const { extractDescriptorFromFile, encryptDescriptor } = require('../utils/faceUtils');

const VT_ROLE_NAME = 'vocational_teacher';
const VTP_ROLE_NAME = 'vocational_teacher_provider';

const verifyVtDevice = async (user, deviceId) => {
  if (!validateDeviceId(deviceId)) return { error: 'A valid device_id (8-255 characters) is required.' };
  const requestedHash = hashDeviceId(deviceId);
  if (!user.device_id_hash) {
    const bound = await pool.query(`UPDATE users SET device_id_hash = $1, device_bound_at = NOW(),
      device_updated_at = NOW(), updated_at = NOW() WHERE id = $2 AND device_id_hash IS NULL
      RETURNING device_id_hash`, [requestedHash, user.id]);
    if (bound.rowCount) user.device_id_hash = requestedHash;
    else {
      const current = await pool.query('SELECT device_id_hash FROM users WHERE id = $1', [user.id]);
      user.device_id_hash = current.rows[0]?.device_id_hash;
    }
  }
  if (user.device_id_hash !== requestedHash) {
    return { mismatch: true, token: generateDeviceChangeToken({ id: user.id, requested_device_hash: requestedHash }) };
  }
  return { verified: true };
};

const deviceMismatchResponse = (res, token) => res.status(403).json({
  status: false, code: 'DEVICE_MISMATCH',
  message: 'Different Device ID Detected, unable to login.',
  can_request_device_change: true, device_change_token: token,
});

const validateVtRegistrationLocation = async ({ phone, latitude, longitude, isFakeGPS } = {}) => {
  if (!phone || latitude === undefined || longitude === undefined || isFakeGPS === undefined) {
    return { httpStatus: 400, body: { status: false, code: 'MISSING_LOCATION_FIELDS', message: 'phone, latitude, longitude and isFakeGPS are required.' } };
  }
  if (isTrue(isFakeGPS)) {
    return { httpStatus: 403, body: { status: false, code: 'FAKE_GPS_DETECTED', message: 'Fake GPS is not allowed. Please disable fake GPS and try again.' } };
  }
  const coordinates = parseCoordinates(latitude, longitude);
  if (!coordinates) {
    return { httpStatus: 400, body: { status: false, code: 'INVALID_COORDINATES', message: 'Valid latitude and longitude are required.' } };
  }
  const vtStaff = await VtStaffDetail.findByMobile(phone);
  if (!vtStaff) {
    return { httpStatus: 404, body: { status: false, code: 'VT_NOT_FOUND', message: 'Your mobile number is not found in the approved Vocational Teacher list.' } };
  }
  if (!vtStaff.udise_code) {
    return { httpStatus: 400, body: { status: false, code: 'UDISE_NOT_MAPPED', message: 'Your school UDISE code is not mapped. Contact administrator.' } };
  }
  const school = await VtStaffDetail.findSchoolLocationByUdise(vtStaff.udise_code);
  if (!school) {
    return { httpStatus: 404, body: { status: false, code: 'SCHOOL_NOT_FOUND', message: 'School information was not found for your UDISE code.' } };
  }
  const schoolCoordinates = parseCoordinates(school.latitude, school.longitude);
  if (!schoolCoordinates) {
    return { httpStatus: 400, body: { status: false, code: 'SCHOOL_LOCATION_NOT_CONFIGURED', message: 'School location is not configured. Contact administrator.' } };
  }
  const distance = Math.round(getDistanceInMeters(
    coordinates.latitude, coordinates.longitude,
    schoolCoordinates.latitude, schoolCoordinates.longitude
  ));
  if (distance > SCHOOL_RADIUS_METERS) {
    return { httpStatus: 403, body: {
      status: false, code: 'OUTSIDE_SCHOOL_RADIUS',
      message: `You are ${distance} meters away from the school location. Please come inside the school location within ${SCHOOL_RADIUS_METERS} meters to complete registration.`,
      data: { within_radius: false, distance_in_meters: distance, allowed_radius_in_meters: SCHOOL_RADIUS_METERS },
    } };
  }
  return { httpStatus: 200, vtStaff, coordinates, body: {
    status: true, message: 'You are inside the school location radius. You can proceed with registration.',
    data: { within_radius: true, distance_in_meters: distance, allowed_radius_in_meters: SCHOOL_RADIUS_METERS,
      udise_code: vtStaff.udise_code, school_name: school.school_name || vtStaff.school_name },
  } };
};

const validateRegistrationLocation = async (req, res) => {
  try {
    const result = await validateVtRegistrationLocation(req.body);
    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    console.error('Registration location validation error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error while validating registration location.' });
  }
};

// ─── POST /api/auth/register ──────────────────────────────────────────────────
const register = async (req, res) => {
  const { name, email, phone, password, role_id, latitude, longitude, school_open_time, school_close_time, image, isFakeGPS, device_id } = req.body;

  if (!phone || !password) {
    return res.status(400).json({
      status: false,
      message: 'Phone number and password are required.',
    });
  }

  if (isFakeGPS === true) {
    return res.status(403).json({
      status: false,
      message: 'Fake GPS is not allowed. Please disable fake GPS and try again.'
    });
  }

  try {
    // ── Resolve role first so we know if this is a VT registration ───────────
    let resolvedRoleId = null;
    let roleName = null;
    let vtStaff = null;
    let finalName = name;
    let finalEmail = email;
    let finalUdise = req.body.udise_code;

    if (role_id) {
      const role = await Role.findActiveById(role_id);
      if (!role) {
        return res.status(400).json({ status: false, message: 'Invalid or inactive role_id.' });
      }
      const roleDetails = await Role.findById(role_id);
      resolvedRoleId = role.id;
      roleName = roleDetails?.name || null;
    } else {
      // Default to vocational_teacher when no role_id provided
      const defaultRole = await Role.findByName(VT_ROLE_NAME);
      resolvedRoleId = defaultRole?.id || null;
      roleName = defaultRole?.name || null;
    }

    // Profile photo is temporarily disabled for registration.
    // if ((roleName === VT_ROLE_NAME || roleName === 'headmaster') && !req.file) {
    //   return res.status(400).json({
    //     status: false,
    //     message: 'Profile image is required for registration.',
    //   });
    // }

    // ── GATE: If registering as vocational_teacher verify mobile in vt_staff_details ──
    if (roleName === VT_ROLE_NAME) {
      if (!phone) {
        return res.status(400).json({
          status: false,
          message: 'Mobile number (vt_mob) is required for Vocational Teacher registration.',
        });
      }

      // Check vt_mob exists in master data → vt_name is the teacher's name
      vtStaff = await VtStaffDetail.findByMobile(phone);
      if (!vtStaff) {
        return res.status(403).json({
          status: false,
          message: 'Registration not allowed. Your mobile number is not found in the approved Vocational Teacher list.',
        });
      }

      // Check not already registered
      const alreadyRegistered = await VtStaffDetail.isAlreadyRegistered(phone);
      if (alreadyRegistered) {
        return res.status(409).json({
          status: false,
          message: 'An account already exists for this mobile number.',
        });
      }

      // Auto-fill from master data:
      //   vt_name  → teacher's own name
      //   vt_email → teacher's email
      finalName = name || vtStaff.vt_name;
      finalEmail = email || vtStaff.vt_email || `${phone}@vt.local`;
      finalUdise = req.body.udise_code || vtStaff.udise_code;

    } else if (roleName === VTP_ROLE_NAME) {
      // VTP: organization_name is required so we can link them to vt_staff_details.vtp_name
      if (!name || !email) {
        return res.status(400).json({
          status: false,
          message: 'Name (organization name) and email are required for VT Provider registration.',
        });
      }
      const emailExists = await User.emailExists(email);
      if (emailExists) {
        return res.status(409).json({ status: false, message: 'An account with this email already exists.' });
      }

    } else if (roleName === 'headmaster') {
      if (!name || !email) {
        return res.status(400).json({ status: false, message: 'Name and email are required.' });
      }
      if (!req.body.udise_code) {
        return res.status(400).json({ status: false, message: 'School UDISE code is required for Headmaster registration.' });
      }
      if (!school_open_time || !school_close_time) {
        return res.status(400).json({ status: false, message: 'school_open_time and school_close_time are required for Headmaster registration.' });
      }
      const emailExists = await User.emailExists(email);
      if (emailExists) {
        return res.status(409).json({ status: false, message: 'An account with this email already exists.' });
      }
    } else {
      // All other roles: name + email required
      if (!name || !email) {
        return res.status(400).json({
          status: false,
          message: 'Name and email are required.',
        });
      }

      // Check duplicate email
      const emailExists = await User.emailExists(email);
      if (emailExists) {
        return res.status(409).json({
          status: false,
          message: 'An account with this email already exists.',
        });
      }
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // ── Determine is_active and approval statuses ───────────────────────────
    // VTs start as inactive + pending on BOTH layers (HM + VTP) until both approve
    const isVt = roleName === VT_ROLE_NAME;
    if (isVt && !validateDeviceId(device_id)) {
      return res.status(400).json({ status: false, message: 'A valid device_id (8-255 characters) is required for VT registration.' });
    }
    let registrationCoordinates = null;
    if (isVt) {
      const locationValidation = await validateVtRegistrationLocation({ phone, latitude, longitude, isFakeGPS });
      if (locationValidation.httpStatus !== 200) {
        return res.status(locationValidation.httpStatus).json(locationValidation.body);
      }
      registrationCoordinates = locationValidation.coordinates;
    }
    const vtApprovalStatus = isVt ? 'pending' : null;
    const vtpApprovalStatus = isVt ? 'pending' : null;
    const isActiveOnRegister = isVt ? false : true;

    // ── Extract photo if uploaded ─────────────────────────────────────────────
    // Profile photo upload/storage is temporarily disabled for registration.
    // const profile_photo = req.file ? `/uploads/register/${req.file.filename}` : null;
    const profile_photo = null;
    console.log(vtStaff);

    // ── [FACE] Extract & validate face descriptor from photo ─────────────────
    // Required for VT and Headmaster roles (photo is mandatory for them anyway)
    let faceDescriptorEncrypted = null;
    if (false && req.file) { // Temporarily disabled: face descriptor enrollment.
      const absPhotoPath = path.join(__dirname, '../uploads/register', req.file.filename);
      let descriptor;
      try {
        descriptor = await extractDescriptorFromFile(absPhotoPath);
      } catch (faceErr) {
        console.error('Face extraction error:', faceErr.message);
        return res.status(500).json({
          status: false,
          message: 'Could not process the profile photo for face recognition. Please try again.',
        });
      }

      if (!descriptor) {
        // No face detected → block registration
        return res.status(400).json({
          status: false,
          message: 'No face detected in the profile photo. Please upload a clear photo with your face visible.',
        });
      }

      // Encrypt the 128D descriptor before storing
      faceDescriptorEncrypted = encryptDescriptor(descriptor);
    }

    // ── Create user ──────────────────────────────────────────────────────────
    const user = await User.create({
      name: finalName,
      email: finalEmail,
      phone: phone ? BigInt(phone) : null,
      password_hash,
      role_id: resolvedRoleId,
      vt_staff_id: vtStaff?.id || null,
      // organization_name:
      //   VT  → vtStaff.vtp_name  (the VTP organisation this VT belongs to, from vt_staff_details)
      //   VTP → name field (the provider's own org name)
      //   others → null
      organization_name: isVt
        ? (vtStaff?.vtp_name || null)
        : roleName === VTP_ROLE_NAME
          ? (name || null)
          : null,
      vtp_id: vtStaff?.vtp_id,
      udise_code: finalUdise || null,
      profile_photo: profile_photo,
      latitude: isVt ? registrationCoordinates.latitude : (latitude ? parseFloat(latitude) : null),
      longitude: isVt ? registrationCoordinates.longitude : (longitude ? parseFloat(longitude) : null),
      school_open_time: roleName === 'headmaster' ? school_open_time : null,
      school_close_time: roleName === 'headmaster' ? school_close_time : null,
      vt_approval_status: vtApprovalStatus,
      vtp_approval_status: vtpApprovalStatus,
      is_active: isActiveOnRegister,
      device_id_hash: isVt ? hashDeviceId(device_id) : null,
    });

    // ── [FACE] Store encrypted face descriptor ────────────────────────────────
    if (faceDescriptorEncrypted) {
      await pool.query(
        'UPDATE users SET face_descriptor = $1 WHERE id = $2',
        [faceDescriptorEncrypted, user.id]
      );
    }

    return res.status(201).json({
      status: true,
      message: isVt
        ? 'Registration submitted. Awaiting approval from your school Headmaster and VTP.'
        : 'Account created successfully.',
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: roleName,
        profile_photo: user.profile_photo,
        face_enrolled: false,
        home_location: (user.latitude && user.longitude) ? {
          latitude: user.latitude,
          longitude: user.longitude
        } : null,
        school_hours: (user.school_open_time && user.school_close_time) ? {
          open_time: user.school_open_time,
          close_time: user.school_close_time
        } : null,
        vt_approval_status: user.vt_approval_status,
        vtp_approval_status: user.vtp_approval_status,
        vt_details: vtStaff ? {
          district: vtStaff.district_name,
          block: vtStaff.block_name,
          school: vtStaff.school_name,
          udise_code: vtStaff.udise_code,
          trade: vtStaff.trade,
          vtp_name: vtStaff.vtp_name,
          vtp_id: vtStaff?.vtp_id,
        } : null,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error('Register error:', error.message);
    return res.status(500).json({ status: 'error', message: 'Server error during registration.' });
  }
};

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
// Unified login: always send { email, password, role_id } from Postman.
// The backend maps those fields to the correct credentials per role:
//
//   role_id (headmaster)   → email = teacher_code, password = mobile
//   role_id (deo)          → email = email,         password = mobile
//   role_id (vocational_teacher) → email = phone,   password = password
//   role_id (admin/super_admin)  → email = email,   password = password
// ─────────────────────────────────────────────────────────────────────────────
const login = async (req, res) => {
  const { role_id, email, password } = req.body;

  if (!role_id) {
    return res.status(400).json({ status: false, message: 'role_id is required.' });
  }
  if (!email || !password) {
    return res.status(400).json({ status: false, message: 'email and password are required.' });
  }

  try {
    // ── Resolve role name from role_id ────────────────────────────────────────
    const roleRow = await Role.findById(role_id);
    if (!roleRow) {
      return res.status(400).json({ status: false, message: 'Invalid role_id provided.' });
    }
    const roleName = roleRow.name;

    // ── Helper: build & store tokens ─────────────────────────────────────────
    const issueTokens = async (user) => {
      const permissions = await User.getEffectivePermissions(user.role_id, user.id);
      const payload = { id: user.id, email: user.email, role: user.role_name, role_id: user.role_id };
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);
      await RefreshToken.create(user.id, refreshToken, getRefreshTokenExpiry());
      return { accessToken, refreshToken, permissions };
    };

    // ══════════════════════════════════════════════════════════════════════════
    // HEADMASTER  →  email = teacher_code, password = mobile
    // ══════════════════════════════════════════════════════════════════════════
    if (roleName === 'headmaster') {
      const teacher_code = email;        // mapped from email field
      const inputMobile = password;      // mapped from password field

      const headmaster = await Headmaster.findByTeacherCode(teacher_code);
      if (!headmaster || String(headmaster.mobile) !== String(inputMobile)) {
        return res.status(401).json({ status: false, message: 'Invalid teacher code or mobile number.' });
      }

      let user = await User.findByPhone(inputMobile);
      if (!user) {
        const defaultRole = await Role.findByName('headmaster');
        const password_hash = await bcrypt.hash(String(inputMobile), 12);
        const newUser = await User.create({
          name: headmaster.t_name || 'Headmaster',
          email: headmaster.email || `${teacher_code}@headmaster.local`,
          phone: inputMobile, password_hash,
          role_id: defaultRole ? defaultRole.id : null,
          udise_code: headmaster.udise_code, is_active: true,
        });
        user = await User.findById(newUser.id);
      }

      if (!user.is_active) {
        return res.status(403).json({ status: false, message: 'Your account has been deactivated. Contact administrator.' });
      }

      const { accessToken, refreshToken, permissions } = await issueTokens(user);
      return res.status(200).json({
        status: true,
        message: 'Headmaster login successful.',
        data: {
          user: {
            id: user.id, name: user.name, email: user.email,
            phone: user.phone, role: user.role_name, role_id: user.role_id,
            udise_code: user.udise_code, profile_photo: user.profile_photo,
            permissions,
          },
          headmaster_details: {
            teacher_code: headmaster.teacher_code,
            school_name: headmaster.school_name,
            block_name: headmaster.block_name,
            district_name: headmaster.district_name,
          },
          tokens: { access_token: accessToken, refresh_token: refreshToken },
        },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DEO  →  email = email, password = mobile
    // ══════════════════════════════════════════════════════════════════════════
    if (roleName === 'deo') {
      const inputEmail = email;           // email field stays as email
      const inputMobile = password;       // mapped from password field

      const deo = await Deo.findByEmailAndMobile(inputEmail, inputMobile);
      if (!deo) {
        return res.status(401).json({ status: false, message: 'Invalid DEO email or mobile number.' });
      }

      let user = await User.findByPhone(inputMobile);
      if (!user) {
        const defaultRole = await Role.findByName('deo');
        const password_hash = await bcrypt.hash(String(inputMobile), 12);
        const newUser = await User.create({
          name: deo.deo_name || 'DEO', email: deo.email, phone: inputMobile,
          password_hash, role_id: defaultRole ? defaultRole.id : null, is_active: true,
        });
        user = await User.findById(newUser.id);
      }

      if (!user.is_active) {
        return res.status(403).json({ status: false, message: 'Your account has been deactivated. Contact administrator.' });
      }

      const { accessToken, refreshToken, permissions } = await issueTokens(user);
      return res.status(200).json({
        status: true,
        message: 'DEO login successful.',
        data: {
          user: {
            id: user.id, name: user.name, email: user.email,
            phone: user.phone, role: user.role_name, role_id: user.role_id,
            profile_photo: user.profile_photo, permissions,
          },
          deo_details: {
            district_cd: deo.district_cd, district_name: deo.district_name, designation: deo.designation,
          },
          tokens: { access_token: accessToken, refresh_token: refreshToken },
        },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // VOCATIONAL TEACHER  →  email = phone, password = password
    // ══════════════════════════════════════════════════════════════════════════
    if (roleName === 'vocational_teacher') {
      const inputPhone = email;            // mapped from email field (phone number)
      const { device_id } = req.body;

      const user = await User.findByPhone(inputPhone);
      if (!user) {
        return res.status(401).json({ status: false, message: 'Invalid credentials.' });
      }

      if (user.role_name !== 'vocational_teacher') {
        return res.status(403).json({ status: false, message: 'Role mismatch. Use the correct role_id for your account.' });
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) return res.status(401).json({ status: false, message: 'Invalid credentials.' });
      const deviceCheck = await verifyVtDevice(user, device_id);
      if (deviceCheck.error) return res.status(400).json({ status: false, message: deviceCheck.error });
      if (deviceCheck.mismatch) return deviceMismatchResponse(res, deviceCheck.token);

      if (user.vt_approval_status === 'pending') {
        return res.status(403).json({ status: false, code: 'VT_PENDING_APPROVAL', message: 'Your registration is pending approval from your school Headmaster. Please wait.' });
      }
      if (user.vt_approval_status === 'rejected') {
        return res.status(403).json({ status: false, code: 'VT_REJECTED', message: 'Your registration was rejected by the Headmaster. Contact your school or administrator.' });
      }
      if (!user.is_active) {
        return res.status(403).json({ status: false, message: 'Your account has been deactivated. Contact administrator.' });
      }

      const { accessToken, refreshToken, permissions } = await issueTokens(user);
      return res.status(200).json({
        status: true,
        message: 'Login successful.',
        data: {
          user: {
            id: user.id, name: user.name, email: user.email,
            phone: user.phone, role: user.role_name, role_id: user.role_id,
            udise_code: user.udise_code, profile_photo: user.profile_photo,
            vt_approval_status: user.vt_approval_status,
            permissions,
          },
          tokens: { access_token: accessToken, refresh_token: refreshToken },
        },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // VTP (vocational_teacher_provider)  →  email = email/mobile, password = password
    // First checks users table, then falls back to vtp table.
    // Auto-provisions a users row on first VTP login for JWT compatibility.
    // ══════════════════════════════════════════════════════════════════════════
    if (roleName === 'vocational_teacher_provider') {
      const inputIdentifier = email;   // could be email or mobile number

      // ── Step 1: Try users table first (returning VTP who already has a user row) ──
      let user = await User.findByEmail(inputIdentifier);

      console.log("VTP login details", user);

      if (!user && /^\d+$/.test(inputIdentifier)) {
        user = await User.findByPhone(inputIdentifier);
      }

      if (user && String(user.role_id) === String(role_id)) {
        // User exists in users table with matching VTP role — standard bcrypt check
        if (!user.is_active) {
          return res.status(403).json({ status: false, message: 'Your account has been deactivated. Contact administrator.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
          return res.status(401).json({ status: false, message: 'Invalid credentials.' });
        }

        const { accessToken, refreshToken, permissions } = await issueTokens(user);
        return res.status(200).json({
          status: true,
          message: 'VTP login successful.',
          data: {
            user: {
              id: user.id, name: user.name, email: user.email,
              phone: user.phone, role: 'vtp', role_id: user.role_id,
              profile_photo: user.profile_photo, permissions,
            },
            tokens: { access_token: accessToken, refresh_token: refreshToken },
          },
        });
      }

      // ── Step 2: Fall back to vtp table ─────────────────────────────────────
      const vtpRecord = await Vtp.findByEmailOrMobile(inputIdentifier);
      if (!vtpRecord) {
        return res.status(401).json({ status: false, message: 'Invalid credentials.' });
      }

      if (vtpRecord.status !== 'active') {
        return res.status(403).json({ status: false, message: 'Your VTP account is inactive. Contact administrator.' });
      }

      // ── First-login auth: vtp table has no password column, so password = mobile ──
      // (same pattern used for Headmaster & DEO master tables)
      if (String(password) !== String(vtpRecord.mobile)) {
        return res.status(401).json({ status: false, message: 'Invalid credentials. For first login, use your registered mobile number as password.' });
      }

      // ── Auto-provision user row for JWT/token compatibility ───────────────
      const vtpRole = await Role.findByName('vocational_teacher_provider');
      const password_hash = await bcrypt.hash(password, 12);
      let newUser;
      try {
        newUser = await User.create({
          name: vtpRecord.vc_name,
          email: vtpRecord.email,
          phone: vtpRecord.mobile,
          password_hash,
          role_id: vtpRole ? vtpRole.id : null,
          organization_name: vtpRecord.vtp_name,
          is_active: true,
          vtp_id: vtpRecord.vtp_id,
        });
      } catch (dupErr) {
        // If user row already exists (race condition / duplicate), just fetch it
        newUser = await User.findByEmail(vtpRecord.email);
        if (!newUser) newUser = await User.findByPhone(vtpRecord.mobile);
      }

      user = await User.findById(newUser.id);
      const { accessToken, refreshToken, permissions } = await issueTokens(user);
      return res.status(200).json({
        status: true,
        message: 'VTP login successful.',
        data: {
          user: {
            id: user.id, name: user.name, email: user.email,
            phone: user.phone, role: 'vtp', role_id: user.role_id,
            profile_photo: user.profile_photo, permissions,
          },
          vtp_details: {
            vtp_name: vtpRecord.vtp_name,
            coordinator_name: vtpRecord.vc_name,
          },
          tokens: { access_token: accessToken, refresh_token: refreshToken },
        },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN / SUPER_ADMIN / OTHER  →  email = email, password = password
    // ══════════════════════════════════════════════════════════════════════════
    let user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ status: false, message: 'Invalid credentials.' });
    }

    // Ensure user actually belongs to the requested role
    if (String(user.role_id) !== String(role_id)) {
      return res.status(403).json({ status: false, message: 'Role mismatch. Use the correct role_id for your account.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ status: false, message: 'Your account has been deactivated. Contact administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Invalid credentials.' });
    }

    const { accessToken, refreshToken, permissions } = await issueTokens(user);
    return res.status(200).json({
      status: true,
      message: 'Login successful.',
      data: {
        user: {
          id: user.id, name: user.name, email: user.email,
          phone: user.phone, role: user.role_name, role_id: user.role_id,
          udise_code: user.udise_code, profile_photo: user.profile_photo,
          vt_approval_status: user.vt_approval_status,
          permissions,
        },
        tokens: { access_token: accessToken, refresh_token: refreshToken },
      },
    });

  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error during login.' });
  }
};

// ─── POST /api/auth/refresh-token ────────────────────────────────────────────
const refreshToken = async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ status: false, message: 'Refresh token is required.' });
  }

  try {
    const decoded = verifyRefreshToken(refresh_token);

    // Check token is valid + non-expired via model
    const storedToken = await RefreshToken.findValid(refresh_token, decoded.id);
    if (!storedToken) {
      return res.status(401).json({
        status: false,
        message: 'Invalid or expired refresh token. Please login again.',
      });
    }

    // Rotate — delete old, issue new
    await RefreshToken.delete(refresh_token);

    const tokenPayload = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      role_id: decoded.role_id,
    };

    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);
    const expiresAt = getRefreshTokenExpiry();

    await RefreshToken.create(decoded.id, newRefreshToken, expiresAt);

    return res.status(200).json({
      status: 'success',
      data: {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      },
    });
  } catch (error) {
    return res.status(401).json({ status: 'error', message: 'Invalid refresh token.' });
  }
};

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
const logout = async (req, res) => {
  const { refresh_token } = req.body;

  if (refresh_token) {
    await RefreshToken.delete(refresh_token);
  }

  return res.status(200).json({ status: 'success', message: 'Logged out successfully.' });
};

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    // If not provided in body/query, default to the currently authenticated user and today's date
    const { userId, date } = req.body;
    let processedDate = date || new Date().toISOString().split('T')[0];

    // Normalize date if it comes in DD-MM-YYYY or DD/MM/YYYY format
    if (processedDate && processedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [day, month, year] = processedDate.split('-');
      processedDate = `${year}-${month}-${day}`;
    } else if (processedDate && processedDate.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      const [day, month, year] = processedDate.split('/');
      processedDate = `${year}-${month}-${day}`;
    }

    let attendanceData = {
      check_in: null,
      check_out: null,
      status: 'absent' // Defaults to absent if no record is found
    };

    const attendanceRecord = await Attendance.findByUserAndDate(userId, processedDate);

    let isPresentOrOther = false;
    if (attendanceRecord && attendanceRecord.status !== 'absent') {
      isPresentOrOther = true;
      attendanceData = {
        check_in: toIST(attendanceRecord.check_in_time),
        check_out: toIST(attendanceRecord.check_out_time),
        status: attendanceRecord.status
      };
    }

    if (!isPresentOrOther) {
      // Check for Leave
      const leaveRes = await pool.query(`
        SELECT id FROM leave_requests 
        WHERE user_id = $1 AND leave_approved = TRUE AND from_date <= $2 AND to_date >= $2
      `, [userId, processedDate]);

      if (leaveRes.rows.length > 0) {
        attendanceData.status = 'leave';
      } else {
        // Check for OnDuty
        const odRes = await pool.query(`
          SELECT id FROM od_requests 
          WHERE user_id = $1 AND od_approved = TRUE AND from_date <= $2 AND to_date >= $2
        `, [userId, processedDate]);

        if (odRes.rows.length > 0) {
          attendanceData.status = 'onduty';
        } else {
          // Check for Gov Holiday
          const [yearStr, monthStr, dayStr] = processedDate.split('-');
          const yearHol = parseInt(yearStr, 10);
          const dateObjForHol = new Date(yearHol, parseInt(monthStr, 10) - 1, parseInt(dayStr, 10));
          const govHolidays = await Report._getGovHolidays(yearHol);

          if (govHolidays.has(processedDate)) {
            attendanceData.status = 'gov holiday';
          } else {
            // Check for School-Declared Holiday
          const userUdiseRes = await pool.query(
              `SELECT udise_code FROM users WHERE id = $1`,
              [Number(userId)]
            );
            const userUdise = userUdiseRes.rows[0]?.udise_code;
            let isSchoolHoliday = false;
            if (userUdise) {
              const schoolHolRes = await pool.query(
                `SELECT 1 FROM school_generated_holidays
                 WHERE udise_code = $1 AND generated_holiday_date = $2 LIMIT 1`,
                [String(userUdise), processedDate]
              );
              isSchoolHoliday = schoolHolRes.rows.length > 0;
            }
            if (isSchoolHoliday) {
              attendanceData.status = 'school holiday';
            } else if (dateObjForHol.getDay() === 0) {
              attendanceData.status = 'holiday'; // Sunday
            } else if (attendanceRecord) {
              attendanceData.status = 'absent';
              attendanceData.check_in = toIST(attendanceRecord.check_in_time);
              attendanceData.check_out = toIST(attendanceRecord.check_out_time);
            }
          }
        }
      }
    }

    // ── Monthly summary for the month of the requested date ──────────────────
    const dateObj = processedDate ? new Date(processedDate) : new Date();
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1; // getMonth() is 0-indexed

    const summaryRows = await Attendance.getMonthlySummary(userId, year, month);

    // Build a summary object keyed by status
    const monthlySummary = { present: 0, absent: 0, late: 0, half_day: 0, on_leave: 0 };
    for (const row of summaryRows) {
      if (row.status in monthlySummary) {
        monthlySummary[row.status] = parseInt(row.count, 10);
      }
    }

    const vtProfile = await Attendance.findByUserId(userId);

    return res.status(200).json({
      status: true,
      data: {
        check_in: attendanceData.check_in,
        check_out: attendanceData.check_out,
        status: attendanceData.status,
        date_requested: processedDate,
        monthly_summary: {
          month: `${year}-${String(month).padStart(2, '0')}`,
          present: monthlySummary.present,
          absent: monthlySummary.absent,
          late: monthlySummary.late,
          half_day: monthlySummary.half_day,
          on_leave: monthlySummary.on_leave,
        },
        vt_profile: vtProfile
      }
    });
  } catch (error) {
    console.error('getMe error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error while fetching user profile and VT records.' });
  }
};

// ─── POST /api/auth/login/vt ──────────────────────────────────────────────────
// Dedicated VT login: phone + password. Returns same structure as /login.
const loginVT = async (req, res) => {
  try {
    const { phone, password, device_id } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ status: false, message: 'phone and password are required.' });
    }

    const user = await User.findByPhone(phone);
    if (!user) {
      return res.status(401).json({ status: false, message: 'Invalid credentials.' });
    }

    // Role guard
    if (user.role_name !== 'vocational_teacher') {
      return res.status(403).json({ status: false, message: 'This endpoint is for Vocational Teachers only.' });
    }

    // Credentials must be verified before exposing any device mismatch action.
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ status: false, message: 'Invalid credentials.' });

    const deviceCheck = await verifyVtDevice(user, device_id);
    if (deviceCheck.error) return res.status(400).json({ status: false, message: deviceCheck.error });
    if (deviceCheck.mismatch) return deviceMismatchResponse(res, deviceCheck.token);

    let vtpMobile = null;
    if (user.vtp_id) {
      const vtpData = await Vtp.findByVTPID(user.vtp_id);
      if (vtpData) {
        vtpMobile = vtpData.mobile;
      }
    }

    if (user.vt_approval_status === 'pending' && user.vtp_approval_status === 'pending') {
      return res.status(403).json({
        status: false,
        hm_approval: user.vt_approval_status,
        vtp_approval: user.vtp_approval_status,
        vtp_mobile: vtpMobile,
        code: 'PENDING_APPROVAL OF HM (Head Master) and VTP',
        message: 'Your registration is pending approval from your school Headmaster and VTP. Please wait.',
      });
    }

    if (user.vt_approval_status === 'rejected' && user.vtp_approval_status === 'rejected') {
      return res.status(403).json({
        status: false,
        hm_approval: user.vt_approval_status,
        vtp_approval: user.vtp_approval_status,
        vtp_mobile: vtpMobile,
        code: 'REJECTED',
        message: 'Your registration was rejected by the Headmaster and VTP. Contact your school or administrator.',
      });
    }

    // ── VT approval gate (Principal/HM layer) ──────────────────────────────────
    if (user.vt_approval_status === 'pending') {
      return res.status(403).json({
        status: false,
        hm_approval: user.vt_approval_status,
        vtp_approval: user.vtp_approval_status,
        vtp_mobile: vtpMobile,
        code: 'VT_PENDING_APPROVAL',
        message: 'Your registration is pending approval from your school Headmaster. Please wait.',
      });
    }

    if (user.vt_approval_status === 'rejected') {
      return res.status(403).json({
        status: false,
        hm_approval: user.vt_approval_status,
        vtp_approval: user.vtp_approval_status,
        vtp_mobile: vtpMobile,
        code: 'VT_REJECTED',
        message: 'Your registration was rejected by the Headmaster. Contact your school or administrator.',
      });
    }
    // ── VTP approval gate (second layer) ──────────────────────────────────────
    if (user.vtp_approval_status === 'pending') {
      return res.status(403).json({
        status: false,
        hm_approval: user.vt_approval_status,
        vtp_approval: user.vtp_approval_status,
        vtp_mobile: vtpMobile,
        code: 'VTP_PENDING_APPROVAL',
        message: 'Your registration is pending approval from your VTP. Please wait.',
      });
    }

    if (user.vtp_approval_status === 'rejected') {
      return res.status(403).json({
        status: false,
        hm_approval: user.vt_approval_status,
        vtp_approval: user.vtp_approval_status,
        vtp_mobile: vtpMobile,
        code: 'VTP_REJECTED',
        message: 'Your registration was rejected by your VTP. Contact your VTP or administrator.',
      });
    }


    if (!user.is_active) {
      return res.status(403).json({ status: false, message: 'Your account has been deactivated. Contact administrator.' });
    }

    const permissions = await User.getEffectivePermissions(user.role_id, user.id);

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role_name,
      role_id: user.role_id,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    const expiresAt = getRefreshTokenExpiry();
    await RefreshToken.create(user.id, refreshToken, expiresAt);

    return res.status(200).json({
      status: true,
      message: 'Login successful.',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role_name,
          udise_code: user.udise_code,
          profile_photo: user.profile_photo,
          vt_approval_status: user.vt_approval_status,
          vtp_approval_status: user.vtp_approval_status,
          vtp_mobile: vtpMobile,
          permissions,
        },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      },
    });
  } catch (err) {
    console.error('VT login error:', err.message);
    return res.status(500).json({ status: false, message: 'Server error during VT login.' });
  }
};

// ─── GET /api/auth/roles ──────────────────────────────────────────────────────
const getRoles = async (req, res) => {
  try {
    const roles = await Role.findAll();
    return res.status(200).json({ status: true, data: roles });
  } catch (error) {
    console.error('getRoles error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error while fetching roles.' });
  }
};

module.exports = { register, validateRegistrationLocation, login, loginVT, refreshToken, logout, getMe, getRoles };
