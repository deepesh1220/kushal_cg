const { Router } = require('express');
const {
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
} = require('../controllers/superAdminController');
const { authenticate, authorizeRole } = require('../middleware/authMiddleware');

const router = Router();

// ── All routes require authentication + super_admin role ─────────────────────
router.use(authenticate, authorizeRole('super_admin'));

// ── Dashboard ─────────────────────────────────────────────────────────────────
// GET /api/super-admin/dashboard
router.get('/dashboard', getDashboard);

// ── User Management ───────────────────────────────────────────────────────────
// GET    /api/super-admin/users               — list all users (paginated + filters)
// GET    /api/super-admin/users/:id           — get single user
// PATCH  /api/super-admin/users/:id           — update user details
// PATCH  /api/super-admin/users/:id/toggle-active  — activate/deactivate user
// PATCH  /api/super-admin/users/:id/reset-password — reset password
// DELETE /api/super-admin/users/:id           — delete user
router.get('/users',                         getAllUsers);
router.get('/users/:id',                     getUserById);
router.patch('/users/:id',                   updateUser);
router.patch('/users/:id/toggle-active',     toggleUserActive);
router.patch('/users/:id/reset-password',    resetUserPassword);
router.delete('/users/:id',                  deleteUser);

// ── Roles ─────────────────────────────────────────────────────────────────────
// GET /api/super-admin/roles
router.get('/roles', getAllRoles);

// ── Headmasters ───────────────────────────────────────────────────────────────
// GET /api/super-admin/headmasters
router.get('/headmasters', getAllHeadmasters);

// ── Schools ───────────────────────────────────────────────────────────────────
// GET /api/super-admin/schools
router.get('/schools', getAllSchools);

// ── VT Staff ──────────────────────────────────────────────────────────────────
// GET /api/super-admin/vt-staff
router.get('/vt-staff', getAllVtStaff);

// ── Leave Requests ────────────────────────────────────────────────────────────
// GET    /api/super-admin/leave-requests
// DELETE /api/super-admin/users/:id/leave/:leaveId
router.get('/leave-requests', getAllLeaveRequests);
router.delete('/users/:id/leave/:leaveId', deleteUserLeave);

// ── Attendance ────────────────────────────────────────────────────────────────
// GET    /api/super-admin/attendance
// DELETE /api/super-admin/users/:id/attendance/:attendanceId
router.get('/attendance', getAllAttendance);
router.delete('/users/:id/attendance/:attendanceId', deleteUserAttendance);

module.exports = router;
