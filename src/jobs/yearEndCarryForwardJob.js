/**
 * Year-End Carry Forward Job
 * Runs at 00:05 on January 1 to:
 *  1. Carry forward unused EL (capped at MAX_CARRY_FORWARD = 10)
 *  2. Reset yearly counters by creating fresh leave_balance rows for new year
 */

const { pool } = require('../config/db');
const LeaveBalance = require('../models/LeaveBalance');

let isJobRunning = false;

const runYearEndCarryForwardJob = async (manualFromYear = null, manualToYear = null) => {
  if (isJobRunning) {
    return { success: false, message: 'Year-end job already running', skipped: true };
  }
  isJobRunning = true;

  try {
    const now = new Date();
    const toYear = manualToYear || now.getFullYear();
    const fromYear = manualFromYear || (toYear - 1);

    console.log(`[YearEndJob] Carrying forward leave: ${fromYear} → ${toYear}`);

    // Get all VTs with a balance in the previous year
    const result = await pool.query(`
      SELECT u.id, u.name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      JOIN leave_balance lb ON lb.user_id = u.id AND lb.year = $1
      WHERE r.name = 'vocational_teacher' AND u.is_active = true
    `, [fromYear]);

    const teachers = result.rows;
    const summary = { successful: 0, failed: 0, skipped: 0, errors: [] };

    for (const t of teachers) {
      const r = await LeaveBalance.carryForwardLeave(t.id, fromYear, toYear);
      if (r.success) summary.successful++;
      else {
        summary.failed++;
        summary.errors.push({ userId: t.id, name: t.name, error: r.message });
      }
    }

    console.log(`[YearEndJob] Done. Successful: ${summary.successful}, Failed: ${summary.failed}`);
    isJobRunning = false;

    return {
      success: true,
      message: `Year-end carry forward completed (${fromYear} → ${toYear})`,
      processed: teachers.length,
      ...summary,
      fromYear,
      toYear
    };
  } catch (error) {
    isJobRunning = false;
    console.error('[YearEndJob] Failed:', error.message);
    return { success: false, message: error.message };
  }
};

const initYearEndCarryForwardCronJob = () => {
  let cron;
  try {
    cron = require('node-cron');
  } catch {
    console.warn('[YearEndJob] node-cron not installed. Schedule disabled.');
    return null;
  }

  // At 00:05 on January 1st every year (IST)
  const job = cron.schedule('5 0 1 1 *', async () => {
    console.log('[YearEndJob] Cron triggered');
    await runYearEndCarryForwardJob();
  }, { scheduled: true, timezone: 'Asia/Kolkata' });

  console.log('[YearEndJob] Scheduled for Jan 1 at 00:05 IST');
  return job;
};

module.exports = {
  runYearEndCarryForwardJob,
  initYearEndCarryForwardCronJob
};
