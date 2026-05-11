const { pool } = require('../config/db');

/**
 * Leave Policy Constants (STRICT RULES)
 */
const LEAVE_POLICY = {
  MONTHLY_CREDIT: 1.0,         // 1.0 EL credited per month
  MAX_YEARLY_ACCRUAL: 12,      // Max 12 days can be earned per year (1.0 × 12 months)
  MAX_CARRY_FORWARD: 10,       // Max 10 days carry forward to next year
  MAX_MONTHLY_USAGE: 10,       // Max 10 days can be used in a single month
  LEAVE_DEDUCTIONS: {
    'full-day': 1.0,
    'first-half': 0.5,
    'second-half': 0.5,
  },
};

/**
 * LeaveBalance Model
 * Manages earned leave (EL) credits, deductions, and balance tracking for VTs
 * Core Business Rules:
 * - Each VT gets 1.5 EL per month (automated via cron), capped at 18/year
 * - full-day leave deducts 1.0, half-day deducts 0.5
 * - Monthly usage cap: 10 days
 * - Year-end carry forward: max 10 days
 */
class LeaveBalance {
  static POLICY = LEAVE_POLICY;

  // ─── Get Deduction Amount for Leave Type ──────────────────────────────────
  static getDeductionAmount(leaveType) {
    return LEAVE_POLICY.LEAVE_DEDUCTIONS[leaveType] ?? 1.0;
  }

  // ─── Ensure Current Month Credit (On-Demand) ──────────────────────────────
  // Credits the current month's 1.5 EL if not already credited.
  // Called lazily on leave approval so VTs get balance without waiting for cron.
  static async ensureCurrentMonthCredit(userId) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const existing = await pool.query(`
      SELECT 1 FROM monthly_leave_credit_log
      WHERE user_id = $1 AND year = $2 AND month = $3 AND status IN ('success','skipped')
    `, [userId, year, month]);

    if (existing.rows.length > 0) return { credited: false, alreadyProcessed: true };

    const result = await this.creditMonthlyLeave(userId, year, month, LEAVE_POLICY.MONTHLY_CREDIT);
    return { credited: result.success && !result.skipped, ...result };
  }

  // ─── Get Monthly Usage for User ───────────────────────────────────────────
  static async getMonthlyUsage(userId, year, month) {
    const result = await pool.query(`
      SELECT COALESCE(SUM(deducted_amount), 0) AS used
      FROM leave_deduction_log
      WHERE user_id = $1
        AND EXTRACT(YEAR FROM deducted_at) = $2
        AND EXTRACT(MONTH FROM deducted_at) = $3
    `, [userId, year, month]);
    return parseFloat(result.rows[0].used || 0);
  }

  // ─── Get or Create Leave Balance for a User ────────────────────────────────
  static async getOrCreateBalance(userId, year = new Date().getFullYear()) {
    // Try to get existing balance
    let result = await pool.query(`
      SELECT * FROM leave_balance
      WHERE user_id = $1 AND year = $2
    `, [userId, year]);

    if (result.rows.length === 0) {
      // Derive opening balance from previous year's closing_balance (capped at MAX_CARRY_FORWARD)
      const prev = await pool.query(`
        SELECT closing_balance, remaining_balance FROM leave_balance
        WHERE user_id = $1 AND year = $2
      `, [userId, year - 1]);

      let opening = 0;
      if (prev.rows.length > 0) {
        const prevClosing = parseFloat(prev.rows[0].closing_balance || prev.rows[0].remaining_balance || 0);
        opening = Math.min(prevClosing, LEAVE_POLICY.MAX_CARRY_FORWARD);
      }

      result = await pool.query(`
        INSERT INTO leave_balance
          (user_id, year, opening_balance, total_earned, total_used, remaining_balance, carried_forward, closing_balance)
        VALUES ($1, $2, $3, 0.00, 0.00, $3, $3, 0.00)
        RETURNING *
      `, [userId, year, opening]);
    }

    return result.rows[0];
  }

  // ─── Get Balance for Specific User ─────────────────────────────────────────
  static async getBalanceByUserId(userId, year = new Date().getFullYear()) {
    const result = await pool.query(`
      SELECT lb.*, u.name as user_name, u.email, v.udise_code, v.school_name
      FROM leave_balance lb
      JOIN users u ON lb.user_id = u.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      WHERE lb.user_id = $1 AND lb.year = $2
    `, [userId, year]);

    return result.rows[0] || null;
  }

  // ─── Credit Monthly Leave (Called by Cron Job) ─────────────────────────────
  static async creditMonthlyLeave(userId, year, month, amount = 1.5) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if already credited for this month (prevent duplicates)
      const existingCredit = await client.query(`
        SELECT id FROM monthly_leave_credit_log
        WHERE user_id = $1 AND year = $2 AND month = $3 AND status = 'success'
      `, [userId, year, month]);

      if (existingCredit.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `Leave already credited for ${year}-${month}`,
          alreadyCredited: true
        };
      }

      // Get or create balance record
      const balance = await this.getOrCreateBalance(userId, year);

      // Enforce max yearly accrual (18 days) — carry_forward is separate
      // total_earned represents EL earned this year only (excl. carry_forward)
      const currentEarned = parseFloat(balance.total_earned);
      const maxCredit = Math.max(0, LEAVE_POLICY.MAX_YEARLY_ACCRUAL - currentEarned);
      const creditAmount = Math.min(amount, maxCredit);

      if (creditAmount <= 0) {
        // Log as skipped — already reached yearly cap
        await client.query(`
          INSERT INTO monthly_leave_credit_log (user_id, year, month, credited_leave, status, error_message)
          VALUES ($1, $2, $3, 0, 'skipped', 'Yearly accrual cap (18 days) reached')
          ON CONFLICT (user_id, year, month) DO UPDATE
          SET credited_leave = 0, status = 'skipped',
              error_message = 'Yearly accrual cap (18 days) reached', credited_at = NOW()
        `, [userId, year, month]);
        await client.query('COMMIT');
        return {
          success: true,
          skipped: true,
          message: `Yearly accrual cap (${LEAVE_POLICY.MAX_YEARLY_ACCRUAL}) reached. No credit applied.`,
          balance
        };
      }

      // Update balance
      const updatedBalance = await client.query(`
        UPDATE leave_balance
        SET
          total_earned = total_earned + $1,
          remaining_balance = remaining_balance + $1,
          updated_at = NOW()
        WHERE user_id = $2 AND year = $3
        RETURNING *
      `, [creditAmount, userId, year]);

      // Log the credit
      await client.query(`
        INSERT INTO monthly_leave_credit_log (user_id, year, month, credited_leave, status)
        VALUES ($1, $2, $3, $4, 'success')
        ON CONFLICT (user_id, year, month) DO UPDATE
        SET credited_leave = $4, status = 'success', credited_at = NOW()
      `, [userId, year, month, creditAmount]);

      await client.query('COMMIT');

      return {
        success: true,
        message: `Credited ${creditAmount} EL for ${year}-${month}`,
        balance: updatedBalance.rows[0]
      };

    } catch (error) {
      await client.query('ROLLBACK');

      // Log failed credit attempt
      await pool.query(`
        INSERT INTO monthly_leave_credit_log (user_id, year, month, credited_leave, status, error_message)
        VALUES ($1, $2, $3, $4, 'failed', $5)
        ON CONFLICT (user_id, year, month) DO UPDATE
        SET status = 'failed', error_message = $5, credited_at = NOW()
      `, [userId, year, month, amount, error.message]);

      return {
        success: false,
        message: error.message,
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  // ─── Deduct Leave on Approval ─────────────────────────────────────────────
  static async deductLeave(leaveRequestId, userId, leaveType, reviewedBy) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 0. Prevent duplicate deductions inside transaction
      const existingDeduction = await client.query(`
        SELECT id FROM leave_deduction_log WHERE leave_request_id = $1 FOR UPDATE
      `, [leaveRequestId]);
      
      const existingExcess = await client.query(`
        SELECT id FROM leave_excess_records WHERE leave_request_id = $1 FOR UPDATE
      `, [leaveRequestId]);

      if (existingDeduction.rows.length > 0 || existingExcess.rows.length > 0) {
        await client.query('ROLLBACK');
        return { success: true, message: 'Leave already deducted or processed for excess' };
      }

      // 1. Fetch leave request dates to calculate total approved days
      const leaveQuery = await client.query(`
        SELECT from_date, to_date, leave_type FROM leave_requests WHERE id = $1
      `, [leaveRequestId]);

      if (leaveQuery.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: 'Leave request not found' };
      }

      const leave = leaveQuery.rows[0];
      let days = 1;
      if (leave.from_date && leave.to_date) {
        const from = new Date(leave.from_date);
        const to = new Date(leave.to_date);
        from.setHours(0, 0, 0, 0);
        to.setHours(0, 0, 0, 0);
        days = Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1;
      }
      
      // We still use leaveType if passed, else fallback to db record
      const actualLeaveType = leaveType || leave.leave_type;
      const approvedLeaveDays = days * this.getDeductionAmount(actualLeaveType);

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // Get current balance (row-locked)
      const balanceResult = await client.query(`
        SELECT remaining_balance FROM leave_balance
        WHERE user_id = $1 AND year = $2
        FOR UPDATE
      `, [userId, year]);

      if (balanceResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: 'No leave balance record found',
          insufficientBalance: true
        };
      }

      const currentBalance = parseFloat(balanceResult.rows[0].remaining_balance);

      // We do not block for insufficient balance anymore.
      // Instead, we calculate excess leave.
      let deductedFromBalance = 0;
      let excessLeave = 0;

      if (currentBalance >= approvedLeaveDays) {
        deductedFromBalance = approvedLeaveDays;
        excessLeave = 0;
      } else {
        deductedFromBalance = currentBalance;
        excessLeave = approvedLeaveDays - currentBalance;
      }

      // Enforce monthly usage cap? 
      // User says: "Remove the restriction that prevents a VT from applying leave when remaining_balance is insufficient."
      // If we keep MAX_MONTHLY_USAGE, it would block them if they exceed 10 days even if they have 0 balance.
      // We will skip monthly cap check if they are taking excess leave, or maybe we keep it? 
      // To be safe and meet the requirement perfectly, we won't block here. 
      // The user wants normal deduction for available balance, and rest as excess.
      // We'll record whatever is deducted into total_used, and remainder goes to leave_excess_records.

      // Update balance
      const updatedBalance = await client.query(`
        UPDATE leave_balance
        SET
          total_used = total_used + $1,
          remaining_balance = remaining_balance - $1,
          updated_at = NOW()
        WHERE user_id = $2 AND year = $3
        RETURNING *
      `, [deductedFromBalance, userId, year]);

      // Log the deduction
      if (deductedFromBalance > 0) {
        await client.query(`
          INSERT INTO leave_deduction_log (leave_request_id, user_id, deducted_amount, leave_type, reviewed_by)
          VALUES ($1, $2, $3, $4, $5)
        `, [leaveRequestId, userId, deductedFromBalance, actualLeaveType, reviewedBy]);
      }

      // If there is excess leave, log it into leave_excess_records
      if (excessLeave > 0) {
        await client.query(`
          INSERT INTO leave_excess_records 
            (user_id, leave_request_id, month, year, approved_leave_days, available_balance_before_deduction, deducted_from_balance, excess_leave)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [userId, leaveRequestId, month, year, approvedLeaveDays, currentBalance, deductedFromBalance, excessLeave]);
      }

      await client.query('COMMIT');

      return {
        success: true,
        message: `Approved ${approvedLeaveDays} days. Deducted ${deductedFromBalance} EL, ${excessLeave} Excess.`,
        deductedAmount: deductedFromBalance,
        excessLeave: excessLeave,
        balance: updatedBalance.rows[0]
      };

    } catch (error) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: error.message,
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  // ─── Check Leave Balance & Monthly Cap (Before Approval) ──────────────────
  static async checkSufficientBalance(userId, leaveType, year = new Date().getFullYear(), month = null) {
    const requiredAmount = this.getDeductionAmount(leaveType);
    const checkMonth = month || (new Date().getMonth() + 1);

    const balance = await this.getOrCreateBalance(userId, year);
    const remaining = parseFloat(balance.remaining_balance);
    const monthlyUsage = await this.getMonthlyUsage(userId, year, checkMonth);

    const balanceOk = remaining >= requiredAmount;
    const monthlyCapOk = (monthlyUsage + requiredAmount) <= LEAVE_POLICY.MAX_MONTHLY_USAGE;

    let reason = null;
    if (!balanceOk) reason = 'insufficient_balance';
    else if (!monthlyCapOk) reason = 'monthly_cap_exceeded';

    return {
      sufficient: balanceOk && monthlyCapOk,
      balanceOk,
      monthlyCapOk,
      reason,
      required: requiredAmount,
      available: remaining,
      monthlyUsed: monthlyUsage,
      monthlyCap: LEAVE_POLICY.MAX_MONTHLY_USAGE,
      balance
    };
  }

  // ─── Get All Teachers' Leave Balances by UDISE Code ───────────────────────
  // Returns ALL VTs under the UDISE (even those without a balance row yet)
  // Includes leave_requests stats aggregated per teacher
  static async getBalancesByUdise(udiseCode, year = new Date().getFullYear()) {
    const result = await pool.query(`
      SELECT
        u.id                                             AS user_id,
        u.name                                           AS teacher_name,
        u.email,
        u.phone,
        v.vt_name,
        v.trade,
        v.udise_code,
        v.school_name,

        -- Leave balance (may be NULL if never credited — show zeros)
        COALESCE(lb.opening_balance,   0) AS opening_balance,
        COALESCE(lb.total_earned,      0) AS total_earned,
        COALESCE(lb.total_used,        0) AS total_used,
        COALESCE(lb.remaining_balance, 0) AS remaining_balance,
        COALESCE(lb.carried_forward,   0) AS carried_forward,
        COALESCE(lb.closing_balance,   0) AS closing_balance,
        lb.year,
        lb.updated_at                                    AS balance_updated_at,

        -- Leave request counts
        COALESCE(SUM(lr.to_date - lr.from_date + 1), 0)                  AS total_leave_requests,
        COALESCE(SUM(lr.to_date - lr.from_date + 1) FILTER (WHERE lr.status = 'pending'), 0)  AS pending_leaves,
        COALESCE(SUM(lr.to_date - lr.from_date + 1) FILTER (WHERE lr.status = 'approved'), 0) AS approved_leaves,
        COALESCE(SUM(lr.to_date - lr.from_date + 1) FILTER (WHERE lr.status = 'rejected'), 0) AS rejected_leaves,
        MAX(lr.from_date)                                AS last_leave_date,
        (
          SELECT lr2.leave_type FROM leave_requests lr2
          WHERE lr2.user_id = u.id
          ORDER BY lr2.created_at DESC LIMIT 1
        )                                                AS last_leave_type

      FROM users u
      JOIN roles r               ON u.role_id = r.id
      JOIN vt_staff_details v    ON v.id = u.vt_staff_id
      LEFT JOIN leave_balance lb ON lb.user_id = u.id AND lb.year = $2
      LEFT JOIN leave_requests lr ON lr.user_id = u.id

      WHERE v.udise_code = $1
        AND r.name = 'vocational_teacher'
        AND u.is_active = true

      GROUP BY
        u.id, u.name, u.email, u.phone,
        v.vt_name, v.trade, v.udise_code, v.school_name,
        lb.opening_balance, lb.total_earned, lb.total_used,
        lb.remaining_balance, lb.carried_forward, lb.closing_balance,
        lb.year, lb.updated_at

      ORDER BY u.name ASC
    `, [udiseCode, year]);

    return result.rows;
  }

  // ─── Get All Teachers' Leave Balances by VTP Name ───────────────────────
  static async getBalancesByVtpName(vtpName, year = new Date().getFullYear()) {
    const result = await pool.query(`
      SELECT
        u.id                                             AS user_id,
        u.name                                           AS teacher_name,
        u.email,
        u.phone,
        v.vt_name,
        v.trade,
        v.udise_code,
        v.school_name,

        -- Leave balance (may be NULL if never credited — show zeros)
        COALESCE(lb.opening_balance,   0) AS opening_balance,
        COALESCE(lb.total_earned,      0) AS total_earned,
        COALESCE(lb.total_used,        0) AS total_used,
        COALESCE(lb.remaining_balance, 0) AS remaining_balance,
        COALESCE(lb.carried_forward,   0) AS carried_forward,
        COALESCE(lb.closing_balance,   0) AS closing_balance,
        lb.year,
        lb.updated_at                                    AS balance_updated_at,

        -- Leave request counts
        COALESCE(SUM(lr.to_date - lr.from_date + 1), 0)                  AS total_leave_requests,
        COALESCE(SUM(lr.to_date - lr.from_date + 1) FILTER (WHERE lr.status = 'pending'), 0)  AS pending_leaves,
        COALESCE(SUM(lr.to_date - lr.from_date + 1) FILTER (WHERE lr.status = 'approved'), 0) AS approved_leaves,
        COALESCE(SUM(lr.to_date - lr.from_date + 1) FILTER (WHERE lr.status = 'rejected'), 0) AS rejected_leaves,
        MAX(lr.from_date)                                AS last_leave_date,
        (
          SELECT lr2.leave_type FROM leave_requests lr2
          WHERE lr2.user_id = u.id
          ORDER BY lr2.created_at DESC LIMIT 1
        )                                                AS last_leave_type

      FROM users u
      JOIN roles r               ON u.role_id = r.id
      JOIN vt_staff_details v    ON v.id = u.vt_staff_id
      LEFT JOIN leave_balance lb ON lb.user_id = u.id AND lb.year = $2
      LEFT JOIN leave_requests lr ON lr.user_id = u.id

      WHERE TRIM(v.vtp_name) = TRIM($1)
        AND r.name = 'vocational_teacher'
        AND u.is_active = true

      GROUP BY
        u.id, u.name, u.email, u.phone,
        v.vt_name, v.trade, v.udise_code, v.school_name,
        lb.opening_balance, lb.total_earned, lb.total_used,
        lb.remaining_balance, lb.carried_forward, lb.closing_balance,
        lb.year, lb.updated_at

      ORDER BY u.name ASC
    `, [vtpName, year]);

    return result.rows;
  }

  // ─── Get All VTs Without Leave Balance (for initial setup) ──────────────────
  static async getUsersWithoutBalance(year = new Date().getFullYear()) {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.vt_staff_id, v.udise_code
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      LEFT JOIN leave_balance lb ON u.id = lb.user_id AND lb.year = $1
      WHERE r.name = 'vocational_teacher'
        AND lb.id IS NULL
    `, [year]);

    return result.rows;
  }

  // ─── Initialize Leave Balances for All VTs ─────────────────────────────────
  static async initializeBalancesForAllVTs(year = new Date().getFullYear()) {
    const usersWithoutBalance = await this.getUsersWithoutBalance(year);

    const results = {
      created: 0,
      errors: []
    };

    for (const user of usersWithoutBalance) {
      try {
        await this.getOrCreateBalance(user.id, year);
        results.created++;
      } catch (error) {
        results.errors.push({ userId: user.id, error: error.message });
      }
    }

    return results;
  }

  // ─── Get Monthly Credit History for User ──────────────────────────────────
  static async getMonthlyCreditHistory(userId, year = new Date().getFullYear()) {
    const result = await pool.query(`
      SELECT * FROM monthly_leave_credit_log
      WHERE user_id = $1 AND year = $2
      ORDER BY month ASC
    `, [userId, year]);

    return result.rows;
  }

  // ─── Get Deduction History for User ───────────────────────────────────────
  static async getDeductionHistory(userId, year = new Date().getFullYear()) {
    const result = await pool.query(`
      SELECT
        ldl.*,
        lr.from_date,
        lr.to_date,
        lr.reason,
        r.name as reviewed_by_name
      FROM leave_deduction_log ldl
      JOIN leave_requests lr ON ldl.leave_request_id = lr.id
      LEFT JOIN users r ON ldl.reviewed_by = r.id
      WHERE ldl.user_id = $1
        AND EXTRACT(YEAR FROM ldl.deducted_at) = $2
      ORDER BY ldl.deducted_at DESC
    `, [userId, year]);

    return result.rows;
  }

  // ─── Carry Forward Unused Leave to Next Year ──────────────────────────────
  static async carryForwardLeave(userId, fromYear, toYear) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get previous year balance
      const prevBalance = await client.query(`
        SELECT remaining_balance FROM leave_balance
        WHERE user_id = $1 AND year = $2
      `, [userId, fromYear]);

      if (prevBalance.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: 'No previous year balance found' };
      }

      // Cap carry forward at MAX_CARRY_FORWARD (10 days)
      const remainingPrev = parseFloat(prevBalance.rows[0].remaining_balance);
      const carryForwardAmount = Math.min(remainingPrev, LEAVE_POLICY.MAX_CARRY_FORWARD);

      // Record closing_balance on the ending year
      await client.query(`
        UPDATE leave_balance SET closing_balance = $1, updated_at = NOW()
        WHERE user_id = $2 AND year = $3
      `, [remainingPrev, userId, fromYear]);

      // Create or update new year balance with carried forward amount
      const newBalance = await client.query(`
        INSERT INTO leave_balance (user_id, year, total_earned, total_used, remaining_balance, carried_forward)
        VALUES ($1, $2, 0.00, 0.00, $3, $3)
        ON CONFLICT (user_id, year) DO UPDATE
        SET carried_forward = $3,
            remaining_balance = leave_balance.remaining_balance + $3,
            updated_at = NOW()
        RETURNING *
      `, [userId, toYear, carryForwardAmount]);

      await client.query('COMMIT');

      return {
        success: true,
        message: `Carried forward ${carryForwardAmount} EL to ${toYear}`,
        carriedForward: carryForwardAmount,
        balance: newBalance.rows[0]
      };

    } catch (error) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: error.message,
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  // ─── Manual Adjustment (for admin corrections) ──────────────────────────
  static async manualAdjustment(userId, year, adjustmentAmount, reason, adjustedBy) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const balance = await client.query(`
        UPDATE leave_balance
        SET
          total_earned = GREATEST(0, total_earned + $1),
          remaining_balance = GREATEST(0, remaining_balance + $1),
          updated_at = NOW()
        WHERE user_id = $2 AND year = $3
        RETURNING *
      `, [adjustmentAmount, userId, year]);

      // Log the adjustment
      await client.query(`
        INSERT INTO monthly_leave_credit_log (user_id, year, month, credited_leave, status, error_message)
        VALUES ($1, $2, 0, $3, 'success', $4)
      `, [userId, year, adjustmentAmount, `Manual adjustment: ${reason} by user ${adjustedBy}`]);

      await client.query('COMMIT');

      return {
        success: true,
        message: `Adjusted balance by ${adjustmentAmount}`,
        balance: balance.rows[0]
      };

    } catch (error) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: error.message,
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  // ─── Get Leave Balance Summary for Dashboard ──────────────────────────────
  static async getBalanceSummaryByUdise(udiseCode, year = new Date().getFullYear()) {
    const result = await pool.query(`
      SELECT
        COUNT(u.id)                                                              AS total_teachers,
        COUNT(u.id) FILTER (WHERE COALESCE(lb.remaining_balance,0) >= 10)       AS healthy_balance,
        COUNT(u.id) FILTER (WHERE COALESCE(lb.remaining_balance,0) < 5)         AS low_balance,
        COUNT(u.id) FILTER (WHERE COALESCE(lb.remaining_balance,0) = 0)         AS zero_balance,
        ROUND(AVG(COALESCE(lb.remaining_balance, 0)), 2)                        AS avg_balance,
        COALESCE(SUM(lb.total_earned), 0)                                       AS total_earned_school,
        COALESCE(SUM(lb.total_used), 0)                                         AS total_used_school
      FROM users u
      JOIN roles r             ON u.role_id = r.id
      JOIN vt_staff_details v  ON v.id = u.vt_staff_id
      LEFT JOIN leave_balance lb ON lb.user_id = u.id AND lb.year = $2
      WHERE v.udise_code = $1
        AND r.name = 'vocational_teacher'
        AND u.is_active = true
    `, [udiseCode, year]);

    return result.rows[0];
  }

  // ─── Get Leave Balance Summary for VTP Dashboard ──────────────────────────────
  static async getBalanceSummaryByVtpName(vtpName, year = new Date().getFullYear()) {
    const result = await pool.query(`
      SELECT
        COUNT(u.id)                                                              AS total_teachers,
        COUNT(u.id) FILTER (WHERE COALESCE(lb.remaining_balance,0) >= 10)       AS healthy_balance,
        COUNT(u.id) FILTER (WHERE COALESCE(lb.remaining_balance,0) < 5)         AS low_balance,
        COUNT(u.id) FILTER (WHERE COALESCE(lb.remaining_balance,0) = 0)         AS zero_balance,
        ROUND(AVG(COALESCE(lb.remaining_balance, 0)), 2)                        AS avg_balance,
        COALESCE(SUM(lb.total_earned), 0)                                       AS total_earned_school,
        COALESCE(SUM(lb.total_used), 0)                                         AS total_used_school
      FROM users u
      JOIN roles r             ON u.role_id = r.id
      JOIN vt_staff_details v  ON v.id = u.vt_staff_id
      LEFT JOIN leave_balance lb ON lb.user_id = u.id AND lb.year = $2
      WHERE TRIM(v.vtp_name) = TRIM($1)
        AND r.name = 'vocational_teacher'
        AND u.is_active = true
    `, [vtpName, year]);

    return result.rows[0];
  }
}

module.exports = LeaveBalance;
