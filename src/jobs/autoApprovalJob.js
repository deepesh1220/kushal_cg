const cron = require('node-cron');
const { pool } = require('../config/db');
const Leave = require('../models/Leave');
const LeaveBalance = require('../models/LeaveBalance');
const OnDuty = require('../models/OnDuty');
const Regularization = require('../models/Regularization');

const LOCK_ID = 47204811;
const AUTO_REMARKS = 'Automatically approved after 48 hours without manual action.';
let isRunning = false;

const configuredHours = () => {
  const hours = Number(process.env.AUTO_APPROVAL_AFTER_HOURS || 48);
  return Number.isFinite(hours) && hours > 0 ? hours : 48;
};

const logResult = async (entityType, entityId, layer, eligibleAt, status, error = null) => {
  await pool.query(`
    INSERT INTO auto_approval_logs
      (entity_type, entity_id, approval_layer, eligible_at, status, error_message)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (entity_type, entity_id, approval_layer) DO UPDATE SET
      eligible_at = EXCLUDED.eligible_at,
      processed_at = NOW(),
      status = EXCLUDED.status,
      error_message = EXCLUDED.error_message
  `, [entityType, entityId, layer, eligibleAt, status, error]);
};

const deductLeaveOnce = async (leave) => {
  if (!leave?.leave_approved) return;
  await LeaveBalance.ensureAnnualCredit(leave.user_id);
  const exists = await pool.query(`
    SELECT 1 FROM leave_deduction_log WHERE leave_request_id = $1
    UNION SELECT 1 FROM leave_excess_records WHERE leave_request_id = $1
  `, [leave.id]);
  if (!exists.rows.length) {
    await LeaveBalance.deductLeave(leave.id, leave.user_id, leave.leave_type, null);
  }
};

const upsertOdAttendance = async (request) => {
  if (!request?.od_approved) return;
  const from = new Date(request.from_date);
  const to = new Date(request.to_date);
  for (let date = new Date(from); date <= to; date.setUTCDate(date.getUTCDate() + 1)) {
    const dateStr = date.toISOString().slice(0, 10);
    await pool.query(`
      INSERT INTO attendance_records (user_id, date, status, check_in_time, check_out_time, remarks)
      VALUES ($1, $2, 'od', NOW(), NOW(), 'OD Auto-approved by Headmaster & VTP')
      ON CONFLICT (user_id, date) DO UPDATE SET
        status = 'od', remarks = EXCLUDED.remarks, updated_at = NOW()
    `, [request.user_id, dateStr]);
  }
};

const upsertRegularizationAttendance = async (request) => {
  if (!request?.regularization_approved) return;
  const dateStr = new Date(request.date).toISOString().slice(0, 10);
  const appliedTime = new Date(request.created_at).toTimeString().split(' ')[0];
  const school = await pool.query(`
    SELECT ms.sch_close_time FROM users u
    LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
    JOIN mst_schools ms ON ms.udise_sch_code = COALESCE(u.udise_code, v.udise_code)
    WHERE u.id = $1 LIMIT 1
  `, [request.user_id]);
  const closeTime = school.rows[0]?.sch_close_time;
  await pool.query(`
    INSERT INTO attendance_records
      (user_id, date, status, check_in_time, check_out_time, remarks)
    VALUES ($1, $2, 'present', $3, $4, 'Regularization Auto-approved by Headmaster & VTP')
    ON CONFLICT (user_id, date) DO UPDATE SET
      status = 'present',
      check_in_time = COALESCE(attendance_records.check_in_time, EXCLUDED.check_in_time),
      check_out_time = COALESCE(attendance_records.check_out_time, EXCLUDED.check_out_time),
      remarks = EXCLUDED.remarks, updated_at = NOW()
  `, [request.user_id, dateStr, `${dateStr} ${appliedTime}`, closeTime ? `${dateStr} ${closeTime}` : null]);
};

const processRows = async (entityType, layer, rows, approve, afterApprove) => {
  let approved = 0;
  for (const row of rows) {
    try {
      const updated = await approve(row);
      if (!updated) {
        await logResult(entityType, row.id, layer, row.eligible_at, 'skipped');
        continue;
      }
      if (afterApprove) await afterApprove(updated);
      await logResult(entityType, row.id, layer, row.eligible_at, 'success');
      approved += 1;
    } catch (error) {
      console.error(`[AutoApproval] ${entityType} ${row.id} ${layer}:`, error.message);
      await logResult(entityType, row.id, layer, row.eligible_at, 'failed', error.message).catch(() => {});
    }
  }
  return approved;
};

const dueRows = async (table, where, deadlineExpression = 'created_at') => {
  const hours = configuredHours();
  const result = await pool.query(`
    SELECT *, (${deadlineExpression} + ($1 * INTERVAL '1 hour')) AS eligible_at
    FROM ${table}
    WHERE ${where}
      AND ${deadlineExpression} <= NOW() - ($1 * INTERVAL '1 hour')
    ORDER BY ${deadlineExpression}, id
  `, [hours]);
  return result.rows;
};

const processLeaves = async () => {
  let count = 0;
  const hmRows = await dueRows('leave_requests', "status = 'pending' AND vtp_status <> 'rejected'");
  count += await processRows('leave', 'hm', hmRows,
    row => Leave.updatePrincipalStatus(row.id, { status: 'approved', reviewerId: null, remarks: AUTO_REMARKS, approvalType: 'auto' }),
    deductLeaveOnce);
  const vtpRows = await dueRows('leave_requests', "vtp_status = 'pending' AND status <> 'rejected'");
  count += await processRows('leave', 'vtp', vtpRows,
    row => Leave.updateVtpStatus(row.id, { status: 'approved', reviewerId: null, remarks: AUTO_REMARKS, approvalType: 'auto' }),
    deductLeaveOnce);
  return count;
};

const processOnDuty = async () => {
  let count = 0;
  const hmRows = await dueRows('od_requests', "hm_status = 'pending' AND status <> 'rejected'");
  count += await processRows('on_duty', 'hm', hmRows,
    row => OnDuty.updateHmStatus(row.id, { status: 'approved', reviewerId: null, remarks: AUTO_REMARKS, approvalType: 'auto' }),
    upsertOdAttendance);
  const vtpRows = await dueRows('od_requests', "vtp_status = 'pending' AND status <> 'rejected'");
  count += await processRows('on_duty', 'vtp', vtpRows,
    row => OnDuty.updateVtpStatus(row.id, { status: 'approved', reviewerId: null, remarks: AUTO_REMARKS, approvalType: 'auto' }),
    upsertOdAttendance);
  return count;
};

const processRegularizations = async () => {
  let count = 0;
  const hmRows = await dueRows('regularization_requests', "hm_status = 'pending' AND status <> 'rejected'");
  count += await processRows('regularization', 'hm', hmRows,
    row => Regularization.updateHmStatus(row.id, { status: 'approved', reviewerId: null, remarks: AUTO_REMARKS, approvalType: 'auto' }),
    upsertRegularizationAttendance);
  const vtpRows = await dueRows('regularization_requests', "vtp_status = 'pending' AND status <> 'rejected'");
  count += await processRows('regularization', 'vtp', vtpRows,
    row => Regularization.updateVtpStatus(row.id, { status: 'approved', reviewerId: null, remarks: AUTO_REMARKS, approvalType: 'auto' }),
    upsertRegularizationAttendance);
  return count;
};

const approveReportLayer = async (row, layer) => {
  const map = {
    hm: ['hm_approval_status', 'hm_approved_at', 'hm_remarks', 'hm_approval_type'],
    deo: ['deo_approval_status', 'deo_approved_at', 'deo_remarks', 'deo_approval_type'],
    vtp: ['vtp_approval_status', 'vtp_approved_at', 'vtp_remarks', 'vtp_approval_type'],
  };
  const [statusCol, atCol, remarksCol, typeCol] = map[layer];
  const result = await pool.query(`
    UPDATE monthly_school_reports SET
      ${statusCol} = 'approved', ${atCol} = NOW(), ${remarksCol} = $1,
      ${typeCol} = 'auto', is_auto_approved = TRUE,
      is_locked = CASE WHEN
        (CASE WHEN $2 = 'hm' THEN 'approved' ELSE hm_approval_status END) = 'approved' AND
        (CASE WHEN $2 = 'deo' THEN 'approved' ELSE deo_approval_status END) = 'approved' AND
        (CASE WHEN $2 = 'vtp' THEN 'approved' ELSE vtp_approval_status END) = 'approved'
        THEN TRUE ELSE is_locked END,
      updated_at = NOW()
    WHERE id = $3 AND ${statusCol} = 'pending'
    RETURNING *
  `, [AUTO_REMARKS, layer, row.id]);
  return result.rows[0] || null;
};

const processReports = async () => {
  let count = 0;
  const stages = [
    ['hm', "hm_approval_status = 'pending' AND deo_approval_status <> 'rejected' AND vtp_approval_status <> 'rejected'", 'created_at'],
    ['deo', "hm_approval_status = 'approved' AND deo_approval_status = 'pending' AND vtp_approval_status <> 'rejected'", 'hm_approved_at'],
    ['vtp', "hm_approval_status = 'approved' AND deo_approval_status = 'approved' AND vtp_approval_status = 'pending'", 'deo_approved_at'],
  ];
  for (const [layer, where, deadline] of stages) {
    const rows = await dueRows('monthly_school_reports', `${where} AND is_locked = FALSE`, deadline);
    count += await processRows('monthly_report', layer, rows, row => approveReportLayer(row, layer));
  }
  return count;
};

// Re-run idempotent final side-effects so a transient balance/attendance failure
// is healed on the next hourly execution even though the approval itself succeeded.
const reconcileFinalSideEffects = async () => {
  const leaves = await pool.query(`
    SELECT l.* FROM leave_requests l
    WHERE l.is_auto_approved = TRUE AND l.leave_approved = TRUE
      AND NOT EXISTS (SELECT 1 FROM leave_deduction_log d WHERE d.leave_request_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM leave_excess_records e WHERE e.leave_request_id = l.id)
  `);
  for (const leave of leaves.rows) {
    try { await deductLeaveOnce(leave); } catch (error) {
      console.error(`[AutoApproval] Leave ${leave.id} reconciliation failed:`, error.message);
    }
  }

  const onDuty = await pool.query(`SELECT * FROM od_requests WHERE is_auto_approved = TRUE AND od_approved = TRUE`);
  for (const request of onDuty.rows) {
    try { await upsertOdAttendance(request); } catch (error) {
      console.error(`[AutoApproval] OnDuty ${request.id} reconciliation failed:`, error.message);
    }
  }

  const regularizations = await pool.query(`
    SELECT * FROM regularization_requests
    WHERE is_auto_approved = TRUE AND regularization_approved = TRUE
  `);
  for (const request of regularizations.rows) {
    try { await upsertRegularizationAttendance(request); } catch (error) {
      console.error(`[AutoApproval] Regularization ${request.id} reconciliation failed:`, error.message);
    }
  }
};

const runAutoApprovalJob = async () => {
  if (isRunning || process.env.AUTO_APPROVAL_ENABLED === 'false') return { skipped: true, approved: 0 };
  isRunning = true;
  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS acquired', [LOCK_ID]);
    if (!lock.rows[0].acquired) return { skipped: true, approved: 0 };
    const approved = await processLeaves() + await processOnDuty() +
      await processRegularizations() + await processReports();
    await reconcileFinalSideEffects();
    console.log(`[AutoApproval] Completed. Approved layers: ${approved}`);
    return { skipped: false, approved };
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    lockClient.release();
    isRunning = false;
  }
};

const initAutoApprovalCronJob = () => {
  if (process.env.AUTO_APPROVAL_ENABLED === 'false') {
    console.log('[AutoApproval] Disabled by configuration.');
    return null;
  }
  const expression = process.env.AUTO_APPROVAL_CRON || '0 * * * *';
  const job = cron.schedule(expression, () => runAutoApprovalJob().catch(error => {
    console.error('[AutoApproval] Job failed:', error.message);
  }), { timezone: 'Asia/Kolkata' });
  setImmediate(() => runAutoApprovalJob().catch(error => console.error('[AutoApproval] Initial run failed:', error.message)));
  console.log(`[AutoApproval] Scheduled (${expression}), threshold ${configuredHours()} hours.`);
  return job;
};

module.exports = { initAutoApprovalCronJob, runAutoApprovalJob };
