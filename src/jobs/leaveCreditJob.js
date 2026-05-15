/**
 * Annual Leave Credit Cron Job
 * Automatically credits 13 EL (Earned Leave) to all Vocational Teachers
 * on April 1 — the start of the Indian financial year.
 * Can also be triggered manually via POST /api/leave-balance/credit-monthly
 */

const { pool } = require('../config/db');
const LeaveBalance = require('../models/LeaveBalance');

// Flag to prevent overlapping executions
let isJobRunning = false;

/**
 * Credit annual leave to a single teacher for a given financial year
 */
const creditTeacherLeave = async (userId, financialYear) => {
  try {
    const result = await LeaveBalance.creditAnnualLeave(userId, financialYear);
    return { userId, ...result };
  } catch (error) {
    return { userId, success: false, message: error.message, error: error.message };
  }
};

/**
 * Main job function — Credits 13 EL to all eligible VTs for the given financial year.
 * Called by the April 1 cron scheduler or triggered manually.
 * financialYear: the starting calendar year of the FY (e.g. 2026 = FY 2026-27)
 */
const runAnnualLeaveCreditJob = async (manualFinancialYear = null) => {
  if (isJobRunning) {
    console.log('[AnnualLeaveCreditJob] Job already running, skipping...');
    return { success: false, message: 'Job already running', skipped: true };
  }

  isJobRunning = true;
  console.log('[AnnualLeaveCreditJob] Starting annual leave credit job...');

  const startTime = new Date();

  try {
    const financialYear = manualFinancialYear || LeaveBalance.getCurrentFinancialYear();
    console.log(`[AnnualLeaveCreditJob] Processing credits for FY ${financialYear}-${financialYear + 1}`);

    // Get all active vocational teachers who don't have the annual credit yet
    // Annual credit is identified by month=4 in the credit log
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.vt_staff_id, v.udise_code, v.school_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      LEFT JOIN monthly_leave_credit_log mcl
        ON u.id = mcl.user_id
        AND mcl.year = $1
        AND mcl.month = 4
        AND mcl.status = 'success'
      WHERE r.name = 'vocational_teacher'
        AND u.is_active = true
        AND mcl.id IS NULL
    `, [financialYear]);

    const teachers = result.rows;
    console.log(`[AnnualLeaveCreditJob] Found ${teachers.length} teachers to credit`);

    if (teachers.length === 0) {
      isJobRunning = false;
      return {
        success: true,
        message: `All teachers already credited for FY ${financialYear}-${financialYear + 1}`,
        processed: 0,
        successful: 0,
        failed: 0,
        financialYear
      };
    }

    const results = { successful: [], failed: [], alreadyCredited: [] };

    for (const teacher of teachers) {
      const creditResult = await creditTeacherLeave(teacher.id, financialYear);

      if (creditResult.success) {
        results.successful.push({ userId: teacher.id, name: teacher.name, udiseCode: teacher.udise_code });
      } else if (creditResult.alreadyCredited) {
        results.alreadyCredited.push({ userId: teacher.id, name: teacher.name });
      } else {
        results.failed.push({ userId: teacher.id, name: teacher.name, error: creditResult.message });
      }
    }

    const duration = ((new Date() - startTime) / 1000).toFixed(2);
    console.log(`[AnnualLeaveCreditJob] Completed in ${duration}s`);
    console.log(`[AnnualLeaveCreditJob] Successful: ${results.successful.length}, Failed: ${results.failed.length}`);

    isJobRunning = false;

    return {
      success: true,
      message: `Credited ${results.successful.length} teachers, ${results.failed.length} failed`,
      processed: teachers.length,
      successful: results.successful.length,
      failed: results.failed.length,
      alreadyCredited: results.alreadyCredited.length,
      financialYear,
      duration: `${duration}s`,
      details: results
    };

  } catch (error) {
    isJobRunning = false;
    console.error('[AnnualLeaveCreditJob] Job failed:', error.message);
    return { success: false, message: error.message, error: error.message, processed: 0, successful: 0, failed: 0 };
  }
};

/**
 * Initialize the cron job.
 * Call from app.js to start the scheduled job.
 * Runs at 00:01 on April 1 every year (Indian financial year start).
 */
const initLeaveCreditCronJob = () => {
  let cron;
  try {
    cron = require('node-cron');
  } catch (err) {
    console.warn('[AnnualLeaveCreditJob] node-cron not installed. Cron job will not run automatically.');
    console.warn('[AnnualLeaveCreditJob] Install with: npm install node-cron');
    console.warn('[AnnualLeaveCreditJob] Manual API endpoint available at POST /api/leave-balance/credit-monthly');
    return null;
  }

  // April 1 at 00:01 IST — start of Indian financial year
  const job = cron.schedule('1 0 1 4 *', async () => {
    console.log('[AnnualLeaveCreditJob] Cron triggered — running annual leave credit...');
    const result = await runAnnualLeaveCreditJob();
    console.log('[AnnualLeaveCreditJob] Cron result:', result.message);
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  console.log('[AnnualLeaveCreditJob] Annual leave credit cron job initialized');
  console.log('[AnnualLeaveCreditJob] Scheduled to run at 00:01 on April 1 every year (IST)');

  return job;
};

/**
 * Get job status and last run info for the current financial year
 */
const getJobStatus = async () => {
  try {
    const fy = LeaveBalance.getCurrentFinancialYear();

    // Annual credit log entry is identified by month=4
    const lastRunResult = await pool.query(`
      SELECT MAX(credited_at) as last_run,
             COUNT(*) FILTER (WHERE status = 'success') as successful_count,
             COUNT(*) FILTER (WHERE status = 'failed') as failed_count
      FROM monthly_leave_credit_log
      WHERE year = $1 AND month = 4
    `, [fy]);

    // Teachers pending annual credit for this FY
    const pendingResult = await pool.query(`
      SELECT COUNT(*) as pending_count
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN monthly_leave_credit_log mcl
        ON u.id = mcl.user_id
        AND mcl.year = $1
        AND mcl.month = 4
        AND mcl.status = 'success'
      WHERE r.name = 'vocational_teacher'
        AND u.is_active = true
        AND mcl.id IS NULL
    `, [fy]);

    return {
      isRunning: isJobRunning,
      currentFinancialYear: `${fy}-${fy + 1}`,
      lastRun: lastRunResult.rows[0]?.last_run,
      successfulThisFY: parseInt(lastRunResult.rows[0]?.successful_count || 0),
      failedThisFY: parseInt(lastRunResult.rows[0]?.failed_count || 0),
      pendingTeachers: parseInt(pendingResult.rows[0]?.pending_count || 0),
      nextScheduledRun: 'April 1 at 00:01 AM IST'
    };
  } catch (error) {
    return { error: error.message };
  }
};

module.exports = {
  runAnnualLeaveCreditJob,
  // Alias kept for backward compatibility with any callers using the old name
  runMonthlyLeaveCreditJob: runAnnualLeaveCreditJob,
  initLeaveCreditCronJob,
  getJobStatus,
  creditTeacherLeave
};
