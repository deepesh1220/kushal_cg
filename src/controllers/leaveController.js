const Leave = require('../models/Leave');
const { pool } = require('../config/db');
const { sendExcel, sendPDF } = require("../utils/export.utile");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const parseDateStr = (dateStr) => {
  if (!dateStr) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3 && parts[2].length === 4) {
    // Convert DD-MM-YYYY to YYYY-MM-DD
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
};

// Validates that the VT being approved/rejected is from the headmaster's school
// super_admin and admin skip this check
const _validateVtBelongsToHeadmaster = async (vtUserId, headmaster) => {
  // super_admin and admin can approve any VT
  if (['super_admin', 'admin'].includes(headmaster.role_name)) return null;

  if (!headmaster.udise_code) {
    return {
      status: 400,
      body: { status: false, message: 'Your account is not linked to a school UDISE code.' },
    };
  }

  // Check the VT's school UDISE code matches the headmaster's
  const result = await pool.query(`
    SELECT v.udise_code
    FROM users u
    JOIN vt_staff_details v ON v.id = u.vt_staff_id
    WHERE u.id = $1
  `, [vtUserId]);

  if (!result.rows.length) {
    return {
      status: 404,
      body: { status: false, message: 'Vocational Teacher not found.' },
    };
  }

  const vtUdise = result.rows[0].udise_code;
  if (String(vtUdise) !== String(headmaster.udise_code)) {
    return {
      status: 403,
      body: {
        status: false,
        message: 'You are not authorized to approve leaves for VTs from a different school.',
      },
    };
  }

  return null;
};

// ─── POST /api/leaves/apply ──────────────────────────────────────────────────
// Vocational teacher applies for leave
const applyLeave = async (req, res) => {
  const userId = req.user.id;
  let { from_date, to_date, reason, leave_type } = req.body;

  if (!from_date || !to_date) {
    return res.status(400).json({ status: false, message: 'from_date and to_date are required.' });
  }

  if (leave_type && !['full-day', 'first-half', 'second-half'].includes(leave_type)) {
    return res.status(400).json({ status: false, message: "leave_type must be 'full-day', 'first-half', or 'second-half'." });
  }

  from_date = parseDateStr(from_date);
  to_date = parseDateStr(to_date);

  const parsedFrom = new Date(from_date);
  const parsedTo = new Date(to_date);

  if (isNaN(parsedFrom.getTime()) || isNaN(parsedTo.getTime())) {
    return res.status(400).json({ status: false, message: 'Invalid date format. Please use YYYY-MM-DD or DD-MM-YYYY.' });
  }

  if (parsedFrom > parsedTo) {
    return res.status(400).json({ status: false, message: 'from_date cannot be after to_date.' });
  }

  try {
    const isOverlap = await Leave.checkOverlap(userId, parsedFrom, parsedTo);
    if (isOverlap) {
      return res.status(400).json({ status: false, message: 'You already have a pending or approved leave request during this period.' });
    }

    const leave = await Leave.create({ user_id: userId, from_date, to_date, reason, leave_type });
    return res.status(201).json({ status: true, message: 'Leave request submitted successfully.', data: leave });
  } catch (error) {
    console.error('Apply leave error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/leaves/my ──────────────────────────────────────────────────────
// User views their own leaves
const getMyLeaves = async (req, res) => {
  const userId = req.user.id;
  let { status, leave_type, from_date, to_date, limit, offset, page } = req.query;

  try {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedOffset = offset ? parseInt(offset, 10) : (parsedPage - 1) * parsedLimit;

    if (from_date) from_date = parseDateStr(from_date);
    if (to_date) to_date = parseDateStr(to_date);

    // Filtration and fetching data
    const leavesData = await Leave.findByUser(userId, {
      status, leave_type, from_date, to_date,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    // Metrics calculation
    const metrics = await Leave.getUserLeaveMetrics(userId);

    return res.status(200).json({
      status: true,
      metrics,
      pagination: {
        totalRecords: leavesData.totalRecords,
        totalPages: Math.ceil(leavesData.totalRecords / parsedLimit),
        currentPage: parsedPage,
        limit: parsedLimit
      },
      data: leavesData.data
    });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/leaves/all ─────────────────────────────────────────────────────
// Headmaster views leaves of their school, admin views all
const getAllLeaves = async (req, res) => {
  const user = req.user;
  const { status, limit, offset } = req.query;

  try {
    let udise_code = null;

    // If the user is a headmaster, they should only see requests for their own school
    if (!['super_admin', 'admin'].includes(user.role_name)) {
      if (!user.udise_code) {
        return res.status(403).json({ status: false, message: 'Your account is not linked to any school UDISE code.' });
      }
      udise_code = user.udise_code;
    }

    const leaves = await Leave.findAll({
      udise_code,
      status,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });

    return res.status(200).json({ status: true, count: leaves.length, data: leaves });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── PATCH /api/leaves/:id/status ────────────────────────────────────────────
// Headmaster / Admin approves or rejects the leave
const approveRejectLeave = async (req, res) => {
  const reviewer = req.user;
  const leaveId = req.params.id;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ status: false, message: 'Status must be either approved or rejected.' });
  }

  try {
    const leave = await Leave.findById(leaveId);
    if (!leave) {
      return res.status(404).json({ status: false, message: 'Leave request not found.' });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({ status: false, message: `Leave is already ${leave.status}` });
    }

    // Validate Headmaster authorization for this VT
    const authError = await _validateVtBelongsToHeadmaster(leave.user_id, reviewer);
    if (authError) {
      return res.status(authError.status).json(authError.body);
    }

    const updated = await Leave.updateStatus(leaveId, { status, reviewerId: reviewer.id });

    // Optional: Could automatically mark attendance records as 'on_leave' for the dates here
    // Leaving out the automatic mark for now to keep it safe and modular

    return res.status(200).json({ status: true, message: `Leave successfully ${status}.`, data: updated });
  } catch (error) {
    console.error('Approve/Reject leave error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── PUT /api/leaves/:id ─────────────────────────────────────────────────────
// VT updates their own pending leave request
const updateLeave = async (req, res) => {
  const userId = req.user.id;
  const leaveId = req.params.id;
  let { from_date, to_date, reason, leave_type } = req.body;

  try {
    const leave = await Leave.findById(leaveId);
    if (!leave) {
      return res.status(404).json({ status: false, message: 'Leave request not found.' });
    }

    if (leave.user_id !== userId) {
      return res.status(403).json({ status: false, message: 'You can only edit your own leave requests.' });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({ status: false, message: 'You cannot edit a leave request that has already been approved or rejected.' });
    }

    if (leave_type && !['full-day', 'first-half', 'second-half'].includes(leave_type)) {
      return res.status(400).json({ status: false, message: "leave_type must be 'full-day', 'first-half', or 'second-half'." });
    }

    if (from_date) from_date = parseDateStr(from_date);
    if (to_date) to_date = parseDateStr(to_date);

    if (from_date || to_date) {
      const parsedFrom = from_date ? new Date(from_date) : new Date(leave.from_date);
      const parsedTo = to_date ? new Date(to_date) : new Date(leave.to_date);

      if (isNaN(parsedFrom.getTime()) || isNaN(parsedTo.getTime())) {
        return res.status(400).json({ status: false, message: 'Invalid date format. Please use YYYY-MM-DD or DD-MM-YYYY.' });
      }

      if (parsedFrom > parsedTo) {
        return res.status(400).json({ status: false, message: 'from_date cannot be after to_date.' });
      }

      // const isOverlap = await Leave.checkOverlap(userId, parsedFrom, parsedTo, leaveId);
      // if (isOverlap) {
      //   return res.status(400).json({ status: false, message: 'You already have a pending or approved leave request during this period.' });
      // }
    }

    const updated = await Leave.update(leaveId, { from_date, to_date, reason, leave_type });
    return res.status(200).json({ status: true, message: 'Leave request updated.', data: updated });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── DELETE /api/leaves/:id ──────────────────────────────────────────────────
// VT deletes their own pending leave request
const deleteLeave = async (req, res) => {
  const userId = req.user.id;
  const leaveId = req.params.id;

  try {
    const leave = await Leave.findById(leaveId);
    if (!leave) {
      return res.status(404).json({ status: false, message: 'Leave request not found.' });
    }

    if (leave.user_id !== userId) {
      return res.status(403).json({ status: false, message: 'You can only delete your own leave requests.' });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({ status: false, message: 'You cannot delete a leave request that has already been approved or rejected.' });
    }

    await Leave.delete(leaveId);
    return res.status(200).json({ status: true, message: 'Leave request deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── POST /api/leaves/report ─────────────────────────────────────────────────
// Per-time-period leave report (resembles getDailyReport for attendance)
const getLeaveReport = async (req, res) => {
  const userId = req.body.userId || req.user.id;
  const { filter_type, filter_value, limit, offset } = req.body;

  if (!userId) {
    return res.status(400).json({ status: false, message: 'userId is required.' });
  }

  const validTypes = ['date', 'week', 'month', 'date_range'];
  const resolvedType = validTypes.includes(filter_type) ? filter_type : 'month';

  try {
    const { records, totals } = await Leave.getLeaveReport(parseInt(userId), {
      filter_type: resolvedType,
      filter_value: filter_value || null,
      limit: limit ? parseInt(limit) : 31,
      offset: offset ? parseInt(offset) : 0,
    });

    const enriched = records.map((r) => ({
      id: r.id,
      date: r.from_date === r.to_date ? r.from_date : `${r.from_date} to ${r.to_date}`,
      from_date: r.from_date,
      to_date: r.to_date,
      leave_type: r.leave_type,
      status: r.status,
      reason: r.reason,
      reviewer_name: r.reviewer_name,
      created_at: r.created_at,
    }));

    return res.status(200).json({
      status: true,
      filter: { type: resolvedType, value: filter_value || null },
      pagination: {
        limit: limit ? parseInt(limit) : 31,
        offset: offset ? parseInt(offset) : 0,
        count: enriched.length,
      },
      summary: {
        overall_no_of_leave: parseInt(totals.total_leaves || 0),
        full_day: parseInt(totals.full_day || 0),
        first_half: parseInt(totals.first_half || 0),
        second_half: parseInt(totals.second_half || 0),
        pending: parseInt(totals.pending || 0),
        accepted: parseInt(totals.accepted || 0),
        rejected: parseInt(totals.rejected || 0),
      },
      data: enriched,
    });
  } catch (error) {
    console.error('getLeaveReport error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};



const downloadMonthlyAttendance = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = req.query.month || req.body.month || currentMonth;
    const { format } = req.query;

    if (!format) {
      return res.status(400).json({
        success: false,
        message: "format is required",
      });
    }

    const report = await Leave.getAttendanceReport(userId, month);

    if (format === "excel") {
      return sendExcel(report, res);
    }

    if (format === "pdf") {
      return sendPDF(report, res);
    }

    return res.status(400).json({
      success: false,
      message: "Invalid format",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};


module.exports = {
  applyLeave,
  getMyLeaves,
  getAllLeaves,
  approveRejectLeave,
  updateLeave,
  deleteLeave,
  getLeaveReport,
  downloadMonthlyAttendance
};
