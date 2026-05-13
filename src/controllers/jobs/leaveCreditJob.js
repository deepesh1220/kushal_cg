/**
 * Monthly Leave Credit Cron Job
 * Automatically credits 1.5 EL (Earned Leave) to all Vocational Teachers every month
 * Runs on the 1st day of each month at 00:01 AM
 */

const { pool } = require('../config/db');
const LeaveBalance = require('../models/LeaveBalance');

// Flag to track if job is running (prevent overlapping executions)
let isJobRunning = false;

/**
 * Credit monthly leave to a single teacher
 * @param {number} userId - Teacher's user ID
 * @param {number} year - Year
 * @param {number} month - Month (1-12)
 * @returns {Promise<Object>} Credit result
 */
const creditTeacherLeave = async (userId, year, month) => {
  try {
    const result = await LeaveBalance.creditMonthlyLeave(userId, year, month, 1.5);
    return {
      userId,
      ...result
    };
  } catch (error) {
    return {
      userId,
      success: false,
      message: error.message,
      error: error.message
    };
  }
};

/**
 * Main job function - Credits leave to all eligible VTs
 * Called by cron scheduler or can be triggered manually
 */
const runMonthlyLeaveCreditJob = async (manualYear = null, manualMonth = null) => {
  // Prevent overlapping executions
  if (isJobRunning) {
    console.log('[LeaveCreditJob] Job already running, skipping...');
    return {
      success: false,
      message: 'Job already running',
      skipped: true
    };
  }

  isJobRunning = true;
  console.log('[LeaveCreditJob] Starting monthly leave credit job...');

  const startTime = new Date();

  try {
    // Determine year and month to process
    const now = new Date();
    const year = manualYear || now.getFullYear();
    const month = manualMonth || (now.getMonth() + 1); // JS months are 0-indexed

    console.log(`[LeaveCreditJob] Processing credits for ${year}-${month.toString().padStart(2, '0')}`);

    // Get all vocational teachers who don't have credit for this month
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.vt_staff_id, v.udise_code, v.school_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      LEFT JOIN monthly_leave_credit_log mcl
        ON u.id = mcl.user_id
        AND mcl.year = $1
        AND mcl.month = $2
        AND mcl.status = 'success'
      WHERE r.name = 'vocational_teacher'
        AND u.is_active = true
        AND mcl.id IS NULL
    `, [year, month]);

    const teachers = result.rows;
    console.log(`[LeaveCreditJob] Found ${teachers.length} teachers to credit`);

    if (teachers.length === 0) {
      isJobRunning = false;
      return {
        success: true,
        message: 'No teachers need credit for this month',
        processed: 0,
        successful: 0,
        failed: 0,
        year,
        month
      };
    }

    // Process each teacher
    const results = {
      successful: [],
      failed: [],
      alreadyCredited: []
    };

    for (const teacher of teachers) {
      const creditResult = await creditTeacherLeave(teacher.id, year, month);

      if (creditResult.success) {
        results.successful.push({
          userId: teacher.id,
          name: teacher.name,
          udiseCode: teacher.udise_code
        });
      } else if (creditResult.alreadyCredited) {
        results.alreadyCredited.push({
          userId: teacher.id,
          name: teacher.name
        });
      } else {
        results.failed.push({
          userId: teacher.id,
          name: teacher.name,
          error: creditResult.message
        });
      }
    }

    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;

    console.log(`[LeaveCreditJob] Completed in ${duration}s`);
    console.log(`[LeaveCreditJob] Successful: ${results.successful.length}, Failed: ${results.failed.length}`);

    isJobRunning = false;

    return {
      success: true,
      message: `Credited ${results.successful.length} teachers, ${results.failed.length} failed`,
      processed: teachers.length,
      successful: results.successful.length,
      failed: results.failed.length,
      alreadyCredited: results.alreadyCredited.length,
      year,
      month,
      duration: `${duration}s`,
      details: results
    };

  } catch (error) {
    isJobRunning = false;
    console.error('[LeaveCreditJob] Job failed:', error.message);

    return {
      success: false,
      message: error.message,
      error: error.message,
      processed: 0,
      successful: 0,
      failed: 0
    };
  }
};

/**
 * Initialize the cron job
 * Call this from app.js to start the scheduled job
 */
const initLeaveCreditCronJob = () => {
  // Use dynamic import for node-cron to handle cases where it might not be installed
  let cron;
  try {
    cron = require('node-cron');
  } catch (err) {
    console.warn('[LeaveCreditJob] node-cron not installed. Cron job will not run automatically.');
    console.warn('[LeaveCreditJob] Install with: npm install node-cron');
    console.warn('[LeaveCreditJob] Manual API endpoint available at POST /api/leave-balance/credit-monthly');
    return null;
  }

  // Schedule: At 00:01 on the 1st of every month
  // Cron format: minute hour day month day-of-week
  const job = cron.schedule('1 0 1 * *', async () => {
    console.log('[LeaveCreditJob] Cron triggered - running monthly leave credit...');
    const result = await runMonthlyLeaveCreditJob();
    console.log('[LeaveCreditJob] Cron result:', result.message);
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata' // Use India timezone
  });

  console.log('[LeaveCreditJob] Monthly leave credit cron job initialized');
  console.log('[LeaveCreditJob] Scheduled to run at 00:01 on 1st of every month (IST)');

  return job;
};

/**
 * Get job status and last run info
 */
const getJobStatus = async () => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // Get last credit log entry
    const lastRunResult = await pool.query(`
      SELECT MAX(credited_at) as last_run,
             COUNT(*) FILTER (WHERE status = 'success') as successful_count,
             COUNT(*) FILTER (WHERE status = 'failed') as failed_count
      FROM monthly_leave_credit_log
      WHERE year = $1 AND month = $2
    `, [year, month]);

    // Get pending teachers count
    const pendingResult = await pool.query(`
      SELECT COUNT(*) as pending_count
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN monthly_leave_credit_log mcl
        ON u.id = mcl.user_id
        AND mcl.year = $1
        AND mcl.month = $2
        AND mcl.status = 'success'
      WHERE r.name = 'vocational_teacher'
        AND u.is_active = true
        AND mcl.id IS NULL
    `, [year, month]);

    return {
      isRunning: isJobRunning,
      currentMonth: `${year}-${month.toString().padStart(2, '0')}`,
      lastRun: lastRunResult.rows[0]?.last_run,
      successfulThisMonth: parseInt(lastRunResult.rows[0]?.successful_count || 0),
      failedThisMonth: parseInt(lastRunResult.rows[0]?.failed_count || 0),
      pendingTeachers: parseInt(pendingResult.rows[0]?.pending_count || 0),
      nextScheduledRun: '1st of next month at 00:01 AM IST'
    };
  } catch (error) {
    return {
      error: error.message
    };
  }
};

module.exports = {
  runMonthlyLeaveCreditJob,
  initLeaveCreditCronJob,
  getJobStatus,
  creditTeacherLeave
};
