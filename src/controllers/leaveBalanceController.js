/**
 * Leave Balance Controller
 * Handles APIs for leave balance management, monthly credits, and principal views
 */

const LeaveBalance = require('../models/LeaveBalance');
const Leave = require('../models/Leave');
const { pool } = require('../config/db');
const { runMonthlyLeaveCreditJob, getJobStatus } = require('../jobs/leaveCreditJob');
const { runYearEndCarryForwardJob } = require('../jobs/yearEndCarryForwardJob');

// ─── GET /api/leave-balance/my ───────────────────────────────────────────────
// Get own leave balance (for VT)
const getMyBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const year = req.query.year || new Date().getFullYear();

    // Ensure balance row exists, then lazy-credit current month
    await LeaveBalance.getOrCreateBalance(userId, year);
    if (parseInt(year) === new Date().getFullYear()) {
      await LeaveBalance.ensureCurrentMonthCredit(userId);
    }

    const balance = await LeaveBalance.getBalanceByUserId(userId, year);

    // Get monthly credit history
    const creditHistory = await LeaveBalance.getMonthlyCreditHistory(userId, year);

    // Get deduction history
    const deductionHistory = await LeaveBalance.getDeductionHistory(userId, year);

    return res.status(200).json({
      status: true,
      data: {
        balance: {
          openingBalance: parseFloat(balance.opening_balance || 0),
          totalEarned: parseFloat(balance.total_earned),
          totalUsed: parseFloat(balance.total_used),
          remainingBalance: parseFloat(balance.remaining_balance),
          carriedForward: parseFloat(balance.carried_forward),
          closingBalance: parseFloat(balance.closing_balance || 0),
          year: balance.year,
          updatedAt: balance.updated_at
        },
        creditHistory: creditHistory.map(ch => ({
          month: ch.month,
          creditedLeave: parseFloat(ch.credited_leave),
          status: ch.status,
          creditedAt: ch.credited_at
        })),
        deductionHistory: deductionHistory.map(dh => ({
          leaveRequestId: dh.leave_request_id,
          deductedAmount: parseFloat(dh.deducted_amount),
          leaveType: dh.leave_type,
          fromDate: dh.from_date,
          toDate: dh.to_date,
          reason: dh.reason,
          deductedAt: dh.deducted_at,
          reviewedBy: dh.reviewed_by_name
        }))
      }
    });

  } catch (error) {
    console.error('Get my balance error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/leave-balance/teacher/:teacherId ───────────────────────────────
// Get specific teacher's leave balance (for Principal)
const getTeacherBalance = async (req, res) => {
  try {
    const teacherId = req.params.teacherId;
    const year = req.query.year || new Date().getFullYear();

    // Validate teacher belongs to principal's UDISE
    const user = req.user;
    if (!['super_admin', 'admin'].includes(user.role_name)) {
      if (!user.udise_code) {
        return res.status(403).json({ status: false, message: 'Your account is not linked to any school UDISE code.' });
      }

      // Check teacher's UDISE matches
      const teacherCheck = await pool.query(`
        SELECT v.udise_code
        FROM users u
        JOIN vt_staff_details v ON v.id = u.vt_staff_id
        WHERE u.id = $1
      `, [teacherId]);

      if (teacherCheck.rows.length === 0) {
        return res.status(404).json({ status: false, message: 'Teacher not found.' });
      }

      if (String(teacherCheck.rows[0].udise_code) !== String(user.udise_code)) {
        return res.status(403).json({ status: false, message: 'You can only view teachers from your own school.' });
      }
    }

    const balance = await LeaveBalance.getBalanceByUserId(teacherId, year);

    if (!balance) {
      return res.status(404).json({ status: false, message: 'No leave balance found for this teacher.' });
    }

    return res.status(200).json({
      status: true,
      data: {
        teacherId: balance.user_id,
        teacherName: balance.user_name,
        udiseCode: balance.udise_code,
        schoolName: balance.school_name,
        trade: balance.trade,
        balance: {
          totalEarned: parseFloat(balance.total_earned),
          totalUsed: parseFloat(balance.total_used),
          remainingBalance: parseFloat(balance.remaining_balance),
          carriedForward: parseFloat(balance.carried_forward),
          year: balance.year,
          updatedAt: balance.updated_at
        }
      }
    });

  } catch (error) {
    console.error('Get teacher balance error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/leave-balance/school ───────────────────────────────────────────
// Get all teachers' leave balances for principal's school
const getSchoolBalances = async (req, res) => {
  try {
    const user = req.user;
    const year = req.query.year || new Date().getFullYear();

    console.log('[getSchoolBalances] User:', { id: user.id, role: user.role_name, udise_code: user.udise_code });

    if (!['super_admin', 'admin'].includes(user.role_name)) {
      if (!user.udise_code) {
        return res.status(403).json({ status: false, message: 'Your account is not linked to any school UDISE code.' });
      }
    }

    const udiseCode = user.udise_code;
    console.log('[getSchoolBalances] Fetching balances for UDISE:', udiseCode, 'Year:', year);

    const balances = await LeaveBalance.getBalancesByUdise(udiseCode, year);
    console.log('[getSchoolBalances] Balances returned:', balances.length);

    // Get summary
    const summary = await LeaveBalance.getBalanceSummaryByUdise(udiseCode, year);
    console.log('[getSchoolBalances] Summary:', summary);

    return res.status(200).json({
      status: true,
      data: {
        summary: {
          totalTeachers: parseInt(summary.total_teachers || 0),
          healthyBalance: parseInt(summary.healthy_balance || 0),
          lowBalance: parseInt(summary.low_balance || 0),
          zeroBalance: parseInt(summary.zero_balance || 0),
          averageBalance: parseFloat(summary.avg_balance || 0),
          totalEarnedSchool: parseFloat(summary.total_earned_school || 0),
          totalUsedSchool: parseFloat(summary.total_used_school || 0)
        },
        teachers: balances.map(b => ({
          teacherId: b.user_id,
          teacherName: b.teacher_name || b.vt_name,
          email: b.email,
          phone: b.phone,
          udiseCode: b.udise_code,
          schoolName: b.school_name,
          trade: b.trade,
          balance: {
            openingBalance:   parseFloat(b.opening_balance  || 0),
            totalEarned:      parseFloat(b.total_earned     || 0),
            totalUsed:        parseFloat(b.total_used       || 0),
            remainingBalance: parseFloat(b.remaining_balance|| 0),
            carriedForward:   parseFloat(b.carried_forward  || 0),
            closingBalance:   parseFloat(b.closing_balance  || 0),
            year: b.year || parseInt(year)
          },
          leaveStats: {
            total:    parseInt(b.total_leave_requests || 0),
            pending:  parseInt(b.pending_leaves  || 0),
            approved: parseInt(b.approved_leaves || 0),
            rejected: parseInt(b.rejected_leaves || 0),
            lastLeaveDate: b.last_leave_date || null,
            lastLeaveType: b.last_leave_type || null
          }
        }))
      }
    });

  } catch (error) {
    console.error('Get school balances error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── POST /api/leave-balance/credit-monthly ──────────────────────────────────
// Trigger monthly leave credit job (admin only)
const triggerMonthlyCredit = async (req, res) => {
  try {
    const { year, month, userId } = req.body;

    let result;

    if (userId) {
      // Credit specific user
      result = await LeaveBalance.creditMonthlyLeave(userId, year || new Date().getFullYear(), month || (new Date().getMonth() + 1), 1.5);
    } else {
      // Run full job
      result = await runMonthlyLeaveCreditJob(year, month);
    }

    return res.status(result.success ? 200 : 400).json({
      status: result.success,
      message: result.message,
      data: result
    });

  } catch (error) {
    console.error('Trigger monthly credit error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/leave-balance/cron-status ──────────────────────────────────────
// Get cron job status
const getCronStatus = async (req, res) => {
  try {
    const status = await getJobStatus();

    return res.status(200).json({
      status: true,
      data: status
    });

  } catch (error) {
    console.error('Get cron status error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── POST /api/leave-balance/initialize ─────────────────────────────────────
// Initialize leave balances for all VTs
const initializeBalances = async (req, res) => {
  try {
    const year = req.body.year || new Date().getFullYear();

    const result = await LeaveBalance.initializeBalancesForAllVTs(year);

    return res.status(200).json({
      status: true,
      message: `Initialized ${result.created} leave balance records`,
      data: result
    });

  } catch (error) {
    console.error('Initialize balances error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── POST /api/leave-balance/adjust ─────────────────────────────────────────
// Manual balance adjustment (admin only)
const adjustBalance = async (req, res) => {
  try {
    const { userId, year, amount, reason } = req.body;
    const adjustedBy = req.user.id;

    if (!userId || !amount || !reason) {
      return res.status(400).json({ status: false, message: 'userId, amount, and reason are required.' });
    }

    const result = await LeaveBalance.manualAdjustment(userId, year || new Date().getFullYear(), amount, reason, adjustedBy);

    return res.status(result.success ? 200 : 400).json({
      status: result.success,
      message: result.message,
      data: result.balance
    });

  } catch (error) {
    console.error('Adjust balance error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/leave-balance/check/:leaveRequestId ──────────────────────────
// Check if leave request can be approved (balance check)
const checkLeaveApproval = async (req, res) => {
  try {
    const leaveRequestId = req.params.leaveRequestId;
    const user = req.user;

    // Get leave request with balance info
    const leaveWithBalance = await Leave.getLeaveRequestWithBalance(leaveRequestId);

    if (!leaveWithBalance) {
      return res.status(404).json({ status: false, message: 'Leave request not found.' });
    }

    // Check authorization
    if (!['super_admin', 'admin'].includes(user.role_name)) {
      if (!user.udise_code) {
        return res.status(403).json({ status: false, message: 'Your account is not linked to any school UDISE code.' });
      }

      if (String(leaveWithBalance.udise_code) !== String(user.udise_code)) {
        return res.status(403).json({ status: false, message: 'You can only check leaves for your own school.' });
      }
    }

    return res.status(200).json({
      status: true,
      data: {
        leaveRequest: {
          id: leaveWithBalance.id,
          teacherId: leaveWithBalance.user_id,
          teacherName: leaveWithBalance.user_name,
          fromDate: leaveWithBalance.from_date,
          toDate: leaveWithBalance.to_date,
          leaveType: leaveWithBalance.leave_type,
          reason: leaveWithBalance.reason,
          status: leaveWithBalance.status
        },
        balanceCheck: leaveWithBalance.balanceCheck,
        canApprove: leaveWithBalance.balanceCheck.sufficient && leaveWithBalance.status === 'pending'
      }
    });

  } catch (error) {
    console.error('Check leave approval error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── POST /api/leave-balance/approve-with-deduction/:leaveRequestId ────────
// Approve leave with automatic balance deduction
const approveWithDeduction = async (req, res) => {
  try {
    const leaveRequestId = req.params.leaveRequestId;
    const reviewerId = req.user.id;
    const { status } = req.body;

    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ status: false, message: 'Status must be approved or rejected.' });
    }

    // Validate authorization
    const leaveWithBalance = await Leave.getLeaveRequestWithBalance(leaveRequestId);

    if (!leaveWithBalance) {
      return res.status(404).json({ status: false, message: 'Leave request not found.' });
    }

    const user = req.user;

    if (!['super_admin', 'admin'].includes(user.role_name)) {
      if (!user.udise_code) {
        return res.status(403).json({ status: false, message: 'Your account is not linked to any school UDISE code.' });
      }

      if (String(leaveWithBalance.udise_code) !== String(user.udise_code)) {
        return res.status(403).json({ status: false, message: 'You can only approve leaves for your own school.' });
      }
    }

    if (leaveWithBalance.status !== 'pending') {
      return res.status(400).json({ status: false, message: `Leave is already ${leaveWithBalance.status}` });
    }

    // If rejecting, just update status without deduction
    if (status === 'rejected') {
      const result = await Leave.updateStatus(leaveRequestId, { status, reviewerId });
      return res.status(200).json({
        status: true,
        message: 'Leave rejected successfully',
        data: result
      });
    }

    // Approve with deduction
    const result = await Leave.approveWithDeduction(leaveRequestId, { reviewerId, status });

    return res.status(result.success ? 200 : 400).json({
      status: result.success,
      message: result.message,
      data: result
    });

  } catch (error) {
    console.error('Approve with deduction error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── POST /api/leave-balance/year-end-carry-forward ─────────────────────────
// Manually trigger year-end carry-forward job (admin only)
const triggerYearEnd = async (req, res) => {
  try {
    const { fromYear, toYear } = req.body;
    const result = await runYearEndCarryForwardJob(fromYear, toYear);
    return res.status(result.success ? 200 : 400).json({
      status: result.success,
      message: result.message,
      data: result
    });
  } catch (error) {
    console.error('Year-end carry forward error:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

// ─── GET /api/leave-balance/policy ─────────────────────────────────────────
// Expose leave policy constants (monthly credit, yearly cap, carry forward, monthly cap)
const getPolicy = async (_req, res) => {
  return res.status(200).json({ status: true, data: LeaveBalance.POLICY });
};

module.exports = {
  getMyBalance,
  getTeacherBalance,
  getSchoolBalances,
  triggerMonthlyCredit,
  triggerYearEnd,
  getCronStatus,
  getPolicy,
  initializeBalances,
  adjustBalance,
  checkLeaveApproval,
  approveWithDeduction
};
