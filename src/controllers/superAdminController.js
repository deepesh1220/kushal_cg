const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const User = require('../models/User');
const Role = require('../models/Role');

// ─── GET /api/super-admin/dashboard ──────────────────────────────────────────
// Returns system-wide counts: total users, roles, schools, VTs, headmasters, etc.
const getDashboard = async (req, res, next) => {
  try {
    const [usersRes, rolesRes, schoolsRes, vtsRes, headmastersRes, leavesRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM users`),
      pool.query(`SELECT COUNT(*) as count FROM roles`),
      pool.query(`SELECT COUNT(*) as count FROM mst_schools`),
      pool.query(`SELECT COUNT(*) as count FROM vt_staff_details`),
      pool.query(`SELECT COUNT(*) as count FROM headmasters`),
      pool.query(`SELECT status, COUNT(*) as count FROM leave_requests GROUP BY status`),
    ]);

    const leaveCounts = { pending: 0, approved: 0, rejected: 0 };
    leavesRes.rows.forEach(row => {
      leaveCounts[row.status] = parseInt(row.count, 10);
    });

    return res.status(200).json({
      status: true,
      message: 'Super admin dashboard fetched successfully.',
      data: {
        total_users: parseInt(usersRes.rows[0].count, 10),
        total_roles: parseInt(rolesRes.rows[0].count, 10),
        total_schools: parseInt(schoolsRes.rows[0].count, 10),
        total_vts: parseInt(vtsRes.rows[0].count, 10),
        total_headmasters: parseInt(headmastersRes.rows[0].count, 10),
        leave_requests: leaveCounts,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/super-admin/users ───────────────────────────────────────────────
// List all users with optional filters: role_id, is_active, search (name/email/phone)
// Query params: role_id, is_active, search, page (default 1), limit (default 20)
const getAllUsers = async (req, res, next) => {
  try {
    const { role_id, is_active, search, page = '1', limit = '20' } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, parseInt(limit, 10) || 20);
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [];
    const params     = [];

    if (role_id) {
      params.push(role_id);
      conditions.push(`u.role_id = $${params.length}`);
    }
    if (is_active !== undefined && is_active !== '') {
      params.push(is_active === 'true');
      conditions.push(`u.is_active = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR CAST(u.phone AS TEXT) ILIKE $${params.length})`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) FROM users u ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limitNum, offset);
    const dataQuery = `
      SELECT
        u.id, u.name, u.email, u.phone, u.is_active,
        u.vt_approval_status, u.udise_code, u.profile_photo,
        u.created_at, u.updated_at,
        r.name AS role_name
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const dataResult = await pool.query(dataQuery, params);

    return res.status(200).json({
      status: true,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
      data: dataResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/super-admin/users/:id ──────────────────────────────────────────
const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }
    const { password_hash, ...safe } = user;
    return res.status(200).json({ status: true, data: safe });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/super-admin/users/:id ────────────────────────────────────────
// Update user details (name, email, role_id, is_active, udise_code)
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, phone, role_id, is_active, udise_code, organization_name } = req.body;

    const existing = await User.findById(id);
    if (!existing) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    const updated = await User.update(id, {
      name,
      email,
      phone,
      role_id,
      is_active,
      udise_code,
      organization_name,
    });

    const { password_hash, ...safe } = updated;
    return res.status(200).json({ status: true, message: 'User updated successfully.', data: safe });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/super-admin/users/:id/toggle-active ──────────────────────────
// Activate or deactivate a user
const toggleUserActive = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await User.findById(id);
    if (!existing) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    const newStatus = !existing.is_active;
    const result = await pool.query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, is_active`,
      [newStatus, id]
    );

    return res.status(200).json({
      status: true,
      message: `User ${newStatus ? 'activated' : 'deactivated'} successfully.`,
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/super-admin/users/:id ───────────────────────────────────────
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await User.findById(id);
    if (!existing) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    return res.status(200).json({ status: true, message: 'User deleted successfully.' });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/super-admin/users/:id/reset-password ─────────────────────────
// Reset a user's password (body: { new_password })
const resetUserPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ status: false, message: 'new_password must be at least 6 characters.' });
    }

    const existing = await User.findById(id);
    if (!existing) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    const hashed = await bcrypt.hash(new_password, 12);
    await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hashed, id]);

    return res.status(200).json({ status: true, message: 'Password reset successfully.' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/super-admin/roles ──────────────────────────────────────────────
const getAllRoles = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.name, r.description, r.is_active, r.created_at,
             COUNT(u.id) AS user_count
      FROM roles r
      LEFT JOIN users u ON u.role_id = r.id
      GROUP BY r.id
      ORDER BY r.id ASC
    `);
    return res.status(200).json({ status: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/super-admin/headmasters ────────────────────────────────────────
// List all headmasters with pagination and optional district/block filter
const getAllHeadmasters = async (req, res, next) => {
  try {
    const { district_id, block_id, search, page = '1', limit = '20' } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, parseInt(limit, 10) || 20);
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [];
    const params     = [];

    if (district_id) {
      params.push(district_id);
      conditions.push(`district_id = $${params.length}`);
    }
    if (block_id) {
      params.push(block_id);
      conditions.push(`block_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(t_name ILIKE $${params.length} OR teacher_code ILIKE $${params.length} OR school_name ILIKE $${params.length})`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM headmasters ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limitNum, offset);
    const dataResult = await pool.query(`
      SELECT teacher_code, t_name, email, mobile, udise_code,
             school_name, block_name, district_name, role,
             is_retired_teacher, is_active_teacher, created_at
      FROM headmasters
      ${whereClause}
      ORDER BY t_name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return res.status(200).json({
      status: true,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
      data: dataResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/super-admin/schools ────────────────────────────────────────────
// List all schools from mst_schools with optional district/block filter
const getAllSchools = async (req, res, next) => {
  try {
    const { district_cd, block_name, search, page = '1', limit = '20' } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, parseInt(limit, 10) || 20);
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [];
    const params     = [];

    if (district_cd) {
      params.push(district_cd);
      conditions.push(`district_cd = $${params.length}`);
    }
    if (block_name) {
      params.push(`%${block_name}%`);
      conditions.push(`block_name ILIKE $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(school_name ILIKE $${params.length} OR CAST(udise_sch_code AS TEXT) ILIKE $${params.length})`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM mst_schools ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limitNum, offset);
    const dataResult = await pool.query(`
      SELECT udise_sch_code, school_name, block_name, district_name, district_cd,
             sch_open_time, sch_close_time, grace_time, latitude, longitude
      FROM mst_schools
      ${whereClause}
      ORDER BY school_name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return res.status(200).json({
      status: true,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
      data: dataResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/super-admin/vt-staff ───────────────────────────────────────────
// List all VT staff from vt_staff_details with optional filters
const getAllVtStaff = async (req, res, next) => {
  try {
    const { udise_code, vtp_name, search, page = '1', limit = '20' } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, parseInt(limit, 10) || 20);
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [];
    const params     = [];

    if (udise_code) {
      params.push(udise_code);
      conditions.push(`v.udise_code = $${params.length}`);
    }
    if (vtp_name) {
      params.push(`%${vtp_name}%`);
      conditions.push(`v.vtp_name ILIKE $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(v.vt_name ILIKE $${params.length} OR v.school_name ILIKE $${params.length} OR CAST(v.vt_mob AS TEXT) ILIKE $${params.length})`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM vt_staff_details v ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limitNum, offset);
    const dataResult = await pool.query(`
      SELECT v.id, v.vt_name, v.vt_mob, v.vt_email, v.trade, v.vtp_name,
             v.school_name, v.udise_code, v.district_name, v.block_name,
             u.id AS user_id, u.is_active, u.vt_approval_status
      FROM vt_staff_details v
      LEFT JOIN users u ON u.vt_staff_id = v.id
      ${whereClause}
      ORDER BY v.vt_name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return res.status(200).json({
      status: true,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
      data: dataResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/super-admin/leave-requests ─────────────────────────────────────
// System-wide leave requests list with filters
const getAllLeaveRequests = async (req, res, next) => {
  try {
    const { status, from_date, to_date, udise_code, page = '1', limit = '20' } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, parseInt(limit, 10) || 20);
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [];
    const params     = [];

    if (status) {
      params.push(status.toLowerCase());
      conditions.push(`lr.status = $${params.length}`);
    }
    if (from_date) {
      params.push(from_date);
      conditions.push(`lr.from_date >= $${params.length}`);
    }
    if (to_date) {
      params.push(to_date);
      conditions.push(`lr.to_date <= $${params.length}`);
    }
    if (udise_code) {
      params.push(udise_code);
      conditions.push(`u.udise_code = $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM leave_requests lr
      LEFT JOIN users u ON u.id = lr.user_id
      ${whereClause}
    `, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limitNum, offset);
    const dataResult = await pool.query(`
      SELECT lr.id, lr.user_id, u.name AS user_name, u.udise_code,
             lr.from_date, lr.to_date, lr.leave_type, lr.reason,
             lr.status, lr.reviewed_at, lr.created_at
      FROM leave_requests lr
      LEFT JOIN users u ON u.id = lr.user_id
      ${whereClause}
      ORDER BY lr.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return res.status(200).json({
      status: true,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
      data: dataResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/super-admin/attendance ─────────────────────────────────────────
// System-wide attendance records with filters
const getAllAttendance = async (req, res, next) => {
  try {
    const { date, user_id, udise_code, status, page = '1', limit = '20' } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, parseInt(limit, 10) || 20);
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [];
    const params     = [];

    if (date) {
      params.push(date);
      conditions.push(`ar.date = $${params.length}`);
    }
    if (user_id) {
      params.push(user_id);
      conditions.push(`ar.user_id = $${params.length}`);
    }
    if (udise_code) {
      params.push(udise_code);
      conditions.push(`u.udise_code = $${params.length}`);
    }
    if (status) {
      params.push(status.toLowerCase());
      conditions.push(`ar.status = $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`
      SELECT COUNT(*) FROM attendance_records ar
      LEFT JOIN users u ON u.id = ar.user_id
      ${whereClause}
    `, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limitNum, offset);
    const dataResult = await pool.query(`
      SELECT ar.id, ar.user_id, u.name AS user_name, u.udise_code,
             ar.date, ar.check_in_time, ar.check_out_time, ar.status,
             ar.latitude, ar.longitude, ar.remarks, ar.created_at
      FROM attendance_records ar
      LEFT JOIN users u ON u.id = ar.user_id
      ${whereClause}
      ORDER BY ar.date DESC, ar.check_in_time DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return res.status(200).json({
      status: true,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
      data: dataResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/super-admin/users/:id/attendance/:attendanceId ───────────────
// Delete a specific attendance record of a user
const deleteUserAttendance = async (req, res, next) => {
  try {
    const { id, attendanceId } = req.params;

    const result = await pool.query(
      `DELETE FROM attendance_records WHERE id = $1 AND user_id = $2 RETURNING id`,
      [attendanceId, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        status: false,
        message: 'Attendance record not found for this user.',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Attendance record deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/super-admin/users/:id/leave/:leaveId ────────────────────────
// Delete a specific leave request of a user
const deleteUserLeave = async (req, res, next) => {
  try {
    const { id, leaveId } = req.params;

    const result = await pool.query(
      `DELETE FROM leave_requests WHERE id = $1 AND user_id = $2 RETURNING id`,
      [leaveId, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        status: false,
        message: 'Leave request not found for this user.',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Leave request deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboard,
  getAllUsers,
  getUserById,
  updateUser,
  toggleUserActive,
  deleteUser,
  resetUserPassword,
  getAllRoles,
  getAllHeadmasters,
  getAllSchools,
  getAllVtStaff,
  getAllLeaveRequests,
  getAllAttendance,
  deleteUserAttendance,
  deleteUserLeave,
};
