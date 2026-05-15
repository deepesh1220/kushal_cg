/**
 * One-Time Migration: Monthly → Annual Leave Credit System
 *
 * What this does:
 *  1. Sets total_earned = 13 for every VT's leave_balance row in the current FY
 *     (only if total_earned < 13, so it never reduces a balance that was already higher)
 *  2. Recalculates remaining_balance = opening_balance + carried_forward + 13 - total_used
 *  3. Inserts (or upserts) an annual credit log entry (month=4) so ensureAnnualCredit()
 *     does not double-credit those VTs after migration
 *
 * Safe to re-run: guarded by `total_earned < 13` and `ON CONFLICT DO UPDATE`.
 *
 * Usage:
 *   node src/scripts/migrate_leave_to_annual.js
 *   node src/scripts/migrate_leave_to_annual.js --fy 2026   (override FY)
 */

'use strict';

require('dotenv').config();

const { pool } = require('../config/db');

function getCurrentFinancialYear() {
  const now = new Date();
  return (now.getMonth() + 1) >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

async function run() {
  const args = process.argv.slice(2);
  const fyFlag = args.indexOf('--fy');
  const fy = fyFlag !== -1 ? parseInt(args[fyFlag + 1]) : getCurrentFinancialYear();

  console.log(`[migrate_leave_to_annual] Migrating FY ${fy}-${fy + 1} to annual 13-day quota...`);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Update leave_balance: set total_earned = 13 and recalculate remaining_balance
    //    Only updates rows where total_earned < 13 (idempotent)
    const updateResult = await client.query(`
      UPDATE leave_balance
      SET
        total_earned      = 13.00,
        remaining_balance = GREATEST(0, opening_balance + carried_forward + 13.00 - total_used),
        updated_at        = NOW()
      WHERE year = $1
        AND total_earned < 13.00
    `, [fy]);

    console.log(`[migrate_leave_to_annual] Updated ${updateResult.rowCount} leave_balance row(s) for FY ${fy}-${fy + 1}`);

    // 2. Insert annual credit log entries (month=4 = annual credit marker)
    //    so ensureAnnualCredit() skips these VTs and doesn't double-credit them
    const logResult = await client.query(`
      INSERT INTO monthly_leave_credit_log
        (user_id, year, month, credited_leave, status, error_message)
      SELECT
        lb.user_id,
        $1,
        4,
        13.0,
        'success',
        'Migrated from monthly to annual credit system (13 days/FY)'
      FROM leave_balance lb
      WHERE lb.year = $1
      ON CONFLICT (user_id, year, month) DO UPDATE
        SET credited_leave = 13.0,
            status         = 'success',
            error_message  = 'Migrated from monthly to annual credit system (13 days/FY)',
            credited_at    = NOW()
    `, [fy]);

    console.log(`[migrate_leave_to_annual] Upserted ${logResult.rowCount} credit log entry(ies) for FY ${fy}-${fy + 1}`);

    await client.query('COMMIT');
    console.log('[migrate_leave_to_annual] Migration completed successfully.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate_leave_to_annual] Migration FAILED — transaction rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
