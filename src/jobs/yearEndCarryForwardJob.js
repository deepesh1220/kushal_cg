/**
 * Financial Year-End Carry Forward Job
 * Runs at 23:55 on March 31 (last day of the Indian financial year) to:
 *  1. Record closing_balance for the ending FY
 *  2. Carry forward unused EL (capped at MAX_CARRY_FORWARD = 10) into the new FY row
 * The April 1 annual credit job runs immediately after and adds 13 EL to the new FY balance.
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
    // fromYear = ending FY start year (e.g. 2025 = FY 2025-26)
    // toYear   = new FY start year    (e.g. 2026 = FY 2026-27)
    const fromYear = manualFromYear || LeaveBalance.getCurrentFinancialYear();
    const toYear   = manualToYear   || (fromYear + 1);

    console.log(`[YearEndJob] Carrying forward leave: FY ${fromYear}-${fromYear + 1} → FY ${toYear}-${toYear + 1}`);

    // Get all VTs with a balance row in the ending FY
    const result = await pool.query(`
      SELECT u.id, u.name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      JOIN leave_balance lb ON lb.user_id = u.id AND lb.year = $1
      WHERE r.name = 'vocational_teacher' AND u.is_active = true
    `, [fromYear]);

    const teachers = result.rows;
    const summary = { successful: 0, failed: 0, errors: [] };

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
      message: `Year-end carry forward completed (FY ${fromYear}-${fromYear + 1} → FY ${toYear}-${toYear + 1})`,
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

  // March 31 at 23:55 IST — last day of the Indian financial year
  // Runs ~6 minutes before the April 1 annual credit job
  const job = cron.schedule('55 23 31 3 *', async () => {
    console.log('[YearEndJob] Cron triggered — running FY-end carry forward...');
    await runYearEndCarryForwardJob();
  }, { scheduled: true, timezone: 'Asia/Kolkata' });

  console.log('[YearEndJob] Scheduled for March 31 at 23:55 IST');
  return job;
};

module.exports = {
  runYearEndCarryForwardJob,
  initYearEndCarryForwardCronJob
};
