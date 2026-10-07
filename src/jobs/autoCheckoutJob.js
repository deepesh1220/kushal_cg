const cron = require('node-cron');
const { pool } = require('../config/db');

const LOCK_ID = 47204812;
let isRunning = false;

const runAutoCheckoutJob = async () => {
  if (isRunning) return { skipped: true, updated: 0 };
  isRunning = true;
  const client = await pool.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [LOCK_ID]);
    if (!lock.rows[0].acquired) return { skipped: true, updated: 0 };
    const result = await client.query(`
      UPDATE attendance_records ar
      SET check_out_time = ((ar.date + ms.sch_close_time + INTERVAL '30 minutes') AT TIME ZONE 'Asia/Kolkata'),
          remarks = CASE
            WHEN NULLIF(TRIM(ar.remarks), '') IS NULL THEN 'Automatically checked out 30 minutes after school closing time.'
            ELSE ar.remarks || ' | Automatically checked out 30 minutes after school closing time.'
          END,
          updated_at = NOW()
      FROM users u
      LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
      JOIN mst_schools ms ON ms.udise_sch_code = COALESCE(u.udise_code, v.udise_code)
      WHERE ar.user_id = u.id
        AND ar.check_in_time IS NOT NULL
        AND ar.check_out_time IS NULL
        AND ms.sch_close_time IS NOT NULL
        AND ar.date <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date
        AND NOW() >= ((ar.date + ms.sch_close_time + INTERVAL '30 minutes') AT TIME ZONE 'Asia/Kolkata')
      RETURNING ar.id
    `);
    if (result.rowCount) console.log(`[AutoCheckout] Updated ${result.rowCount} attendance record(s).`);
    return { skipped: false, updated: result.rowCount };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
    isRunning = false;
  }
};

const initAutoCheckoutCronJob = () => {
  const job = cron.schedule('*/5 * * * *', () => runAutoCheckoutJob().catch((error) => {
    console.error('[AutoCheckout] Job failed:', error.message);
  }), { timezone: 'Asia/Kolkata' });
  setImmediate(() => runAutoCheckoutJob().catch((error) => console.error('[AutoCheckout] Initial run failed:', error.message)));
  console.log('[AutoCheckout] Enabled (every 5 minutes, Asia/Kolkata).');
  return job;
};

module.exports = { initAutoCheckoutCronJob, runAutoCheckoutJob };
