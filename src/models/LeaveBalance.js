const { pool } = require('../config/db');

/**
 * Leave Policy Constants
 */
const LEAVE_POLICY = {
  ANNUAL_CREDIT: 13,        // 13 EL granted upfront per financial year (April 1)
  MAX_YEARLY_ACCRUAL: 13,   // Max 13 days earneable per financial year
  MAX_CARRY_FORWARD: 10,    // Max 10 days carry forward to next FY
  LEAVE_DEDUCTIONS: {
    'full-day': 1.0,
    'first-half': 0.5,
    'second-half': 0.5,
  },
};

/**
 * LeaveBalance Model
 * Manages earned leave (EL) credits, deductions, and balance tracking for VTs.
 * Core Business Rules:
 * - Each VT gets 13 EL on April 1 (Indian financial year start), capped at 13/year
 * - full-day leave deducts 1.0, half-day deducts 0.5
 * - Year-end carry forward: max 10 days
 */
class LeaveBalance {
  static POLICY = LEAVE_POLICY;

  // ─── Financial Year Helper ─────────────────────────────────────────────────
  // Returns the starting calendar year of the current Indian financial year.
  // FY 2026-27 (Apr 2026 – Mar 2027) → 2026
  static getCurrentFinancialYear() {
    const now = new Date();
    return (now.getMonth() + 1) >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  }

  // ─── Get Deduction Amount for Leave Type ──────────────────────────────────
  static getDeductionAmount(leaveType) {
    return LEAVE_POLICY.LEAVE_DEDUCTIONS[leaveType] ?? 1.0;
  }

  // ─── Ensure Annual Credit (On-Demand / Lazy) ──────────────────────────────
  // Credits this FY's 13 EL if not already credited.
  // Called lazily on leave application and approval so VTs get balance
  // without waiting for the April 1 cron job.
  // month=4 in the credit log is the annual credit marker.
  static async ensureAnnualCredit(userId) {
    const fy = this.getCurrentFinancialYear();

    const existing = await pool.query(`
      SELECT 1 FROM monthly_leave_credit_log
      WHERE user_id = $1 AND year = $2 AND month = 4 AND status IN ('success','skipped')
    `, [userId, fy]);

    if (existing.rows.length > 0) return { credited: false, alreadyProcessed: true };

    const result = await this.creditAnnualLeave(userId, fy);
    return { credited: result.success && !result.skipped, ...result };
  }

  // ─── Get Monthly Usage for User (informational only, no longer blocks) ────
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
  static async getOrCreateBalance(userId, year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();

    // Try to get existing balance
    let result = await pool.query(`
      SELECT * FROM leave_balance
      WHERE user_id = $1 AND year = $2
    `, [userId, fy]);

    if (result.rows.length === 0) {
      // Derive opening balance from previous FY's closing_balance (capped at MAX_CARRY_FORWARD)
      const prev = await pool.query(`
        SELECT closing_balance, remaining_balance FROM leave_balance
        WHERE user_id = $1 AND year = $2
      `, [userId, fy - 1]);

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
      `, [userId, fy, opening]);
    }

    return result.rows[0];
  }

  // ─── Get Balance for Specific User ─────────────────────────────────────────
  static async getBalanceByUserId(userId, year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();
    const result = await pool.query(`
      SELECT lb.*, u.name as user_name, u.email, v.udise_code, v.school_name
      FROM leave_balance lb
      JOIN users u ON lb.user_id = u.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      WHERE lb.user_id = $1 AND lb.year = $2
    `, [userId, fy]);

    return result.rows[0] || null;
  }

  // ─── Credit Annual Leave (Called by April 1 Cron or Lazy Ensure) ──────────
  // month=4 (April) is used as the annual credit marker in monthly_leave_credit_log.
  static async creditAnnualLeave(userId, financialYear, amount = LEAVE_POLICY.ANNUAL_CREDIT) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if annual credit already applied for this FY (month=4 is the marker)
      const existingCredit = await client.query(`
        SELECT id FROM monthly_leave_credit_log
        WHERE user_id = $1 AND year = $2 AND month = 4 AND status = 'success'
      `, [userId, financialYear]);

      if (existingCredit.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `Annual leave already credited for FY ${financialYear}-${financialYear + 1}`,
          alreadyCredited: true
        };
      }

      // Get or create balance record for this FY
      const balance = await this.getOrCreateBalance(userId, financialYear);

      // Enforce max yearly accrual (13 days) — carry_forward is separate
      const currentEarned = parseFloat(balance.total_earned);
      const maxCredit = Math.max(0, LEAVE_POLICY.MAX_YEARLY_ACCRUAL - currentEarned);
      const creditAmount = Math.min(amount, maxCredit);

      if (creditAmount <= 0) {
        await client.query(`
          INSERT INTO monthly_leave_credit_log (user_id, year, month, credited_leave, status, error_message)
          VALUES ($1, $2, 4, 0, 'skipped', 'Annual quota (13 days) already credited')
          ON CONFLICT (user_id, year, month) DO UPDATE
          SET credited_leave = 0, status = 'skipped',
              error_message = 'Annual quota (13 days) already credited', credited_at = NOW()
        `, [userId, financialYear]);
        await client.query('COMMIT');
        return {
          success: true,
          skipped: true,
          message: `Annual quota (${LEAVE_POLICY.MAX_YEARLY_ACCRUAL} days) already reached. No credit applied.`,
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
      `, [creditAmount, userId, financialYear]);

      // Log the annual credit (month=4 marks this as the FY annual credit)
      await client.query(`
        INSERT INTO monthly_leave_credit_log (user_id, year, month, credited_leave, status)
        VALUES ($1, $2, 4, $3, 'success')
        ON CONFLICT (user_id, year, month) DO UPDATE
        SET credited_leave = $3, status = 'success', credited_at = NOW()
      `, [userId, financialYear, creditAmount]);

      await client.query('COMMIT');

      return {
        success: true,
        message: `Credited ${creditAmount} EL for FY ${financialYear}-${financialYear + 1}`,
        balance: updatedBalance.rows[0]
      };

    } catch (error) {
      await client.query('ROLLBACK');

      await pool.query(`
        INSERT INTO monthly_leave_credit_log (user_id, year, month, credited_leave, status, error_message)
        VALUES ($1, $2, 4, $3, 'failed', $4)
        ON CONFLICT (user_id, year, month) DO UPDATE
        SET status = 'failed', error_message = $4, credited_at = NOW()
      `, [userId, financialYear, amount, error.message]);

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

      // Prevent duplicate deductions inside transaction
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

      // Fetch leave request dates to calculate total approved days
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

      const actualLeaveType = leaveType || leave.leave_type;
      const approvedLeaveDays = days * this.getDeductionAmount(actualLeaveType);

      // Use financial year of approval date so Jan-Mar deductions go to the correct FY
      const year = LeaveBalance.getCurrentFinancialYear();
      const now = new Date();
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

      let deductedFromBalance = 0;
      let excessLeave = 0;

      if (currentBalance >= approvedLeaveDays) {
        deductedFromBalance = approvedLeaveDays;
        excessLeave = 0;
      } else {
        deductedFromBalance = currentBalance;
        excessLeave = approvedLeaveDays - currentBalance;
      }

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

  // ─── Check Leave Balance (Before Approval) ────────────────────────────────
  static async checkSufficientBalance(userId, leaveType, financialYear = null) {
    const fy = financialYear !== null ? financialYear : this.getCurrentFinancialYear();
    const requiredAmount = this.getDeductionAmount(leaveType);

    const balance = await this.getOrCreateBalance(userId, fy);
    const remaining = parseFloat(balance.remaining_balance);
    const balanceOk = remaining >= requiredAmount;

    return {
      sufficient: balanceOk,
      balanceOk,
      reason: !balanceOk ? 'insufficient_balance' : null,
      required: requiredAmount,
      available: remaining,
      balance
    };
  }

  // ─── Get All Teachers' Leave Balances by UDISE Code ───────────────────────
  static async getBalancesByUdise(udiseCode, year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();
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
    `, [udiseCode, fy]);

    return result.rows;
  }

  // ─── Get All Teachers' Leave Balances by VTP Name ───────────────────────
  static async getBalancesByVtpName(vtpName, year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();
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
    `, [vtpName, fy]);

    return result.rows;
  }

  // ─── Get All VTs Without Leave Balance (for initial setup) ──────────────────
  static async getUsersWithoutBalance(year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.vt_staff_id, v.udise_code
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      LEFT JOIN leave_balance lb ON u.id = lb.user_id AND lb.year = $1
      WHERE r.name = 'vocational_teacher'
        AND lb.id IS NULL
    `, [fy]);

    return result.rows;
  }

  // ─── Initialize Leave Balances for All VTs ─────────────────────────────────
  static async initializeBalancesForAllVTs(year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();
    const usersWithoutBalance = await this.getUsersWithoutBalance(fy);

    const results = {
      created: 0,
      errors: []
    };

    for (const user of usersWithoutBalance) {
      try {
        await this.getOrCreateBalance(user.id, fy);
        results.created++;
      } catch (error) {
        results.errors.push({ userId: user.id, error: error.message });
      }
    }

    return results;
  }

  // ─── Get Annual Credit History for User ───────────────────────────────────
  static async getAnnualCreditHistory(userId, year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();
    const result = await pool.query(`
      SELECT * FROM monthly_leave_credit_log
      WHERE user_id = $1 AND year = $2
      ORDER BY credited_at DESC
    `, [userId, fy]);

    return result.rows;
  }

  // ─── Get Deduction History for User ───────────────────────────────────────
  static async getDeductionHistory(userId, year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();
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
    `, [userId, fy]);

    return result.rows;
  }

  // ─── Carry Forward Unused Leave to Next Financial Year ───────────────────
  static async carryForwardLeave(userId, fromYear, toYear) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get previous FY balance
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

      // Record closing_balance on the ending FY row
      await client.query(`
        UPDATE leave_balance SET closing_balance = $1, updated_at = NOW()
        WHERE user_id = $2 AND year = $3
      `, [remainingPrev, userId, fromYear]);

      // Create or update new FY balance with carried forward amount
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
        message: `Carried forward ${carryForwardAmount} EL to FY ${toYear}-${toYear + 1}`,
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

      // Log the adjustment using month=0 as manual adjustment marker
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
  static async getBalanceSummaryByUdise(udiseCode, year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();
    const result = await pool.query(`
      SELECT
        COUNT(u.id)                                                              AS total_teachers,
        COUNT(u.id) FILTER (WHERE COALESCE(lb.remaining_balance,0) >= 7)        AS healthy_balance,
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
    `, [udiseCode, fy]);

    return result.rows[0];
  }

  // ─── Get Leave Balance Summary for VTP Dashboard ──────────────────────────
  static async getBalanceSummaryByVtpName(vtpName, year = null) {
    const fy = year !== null ? year : this.getCurrentFinancialYear();
    const result = await pool.query(`
      SELECT
        COUNT(u.id)                                                              AS total_teachers,
        COUNT(u.id) FILTER (WHERE COALESCE(lb.remaining_balance,0) >= 7)        AS healthy_balance,
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
    `, [vtpName, fy]);

    return result.rows[0];
  }
}

module.exports = LeaveBalance;
