const { pool } = require('../config/db');
const LeaveBalance = require('../models/LeaveBalance');
const { getISTDate } = require('../utils/timeUtils');

const LAYERS = {
  hm: {
    status: 'hm_status',
    reviewer: 'hm_approved_by',
    reviewedAt: 'hm_approved_at',
    remarks: 'hm_remarks',
    waitingFor: 'VTP',
  },
  vtp: {
    status: 'vtp_status',
    reviewer: 'vtp_approved_by',
    reviewedAt: 'vtp_approved_at',
    remarks: 'vtp_remarks',
    waitingFor: 'HM',
  },
};

class LeaveCancellationError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const approveCancellationLayer = async ({ cancellationRequestId, layer, reviewerId, remarks = null }) => {
  const layerConfig = LAYERS[layer];
  if (!layerConfig) throw new LeaveCancellationError(400, 'Invalid cancellation approval layer.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestResult = await client.query(`
      SELECT lcr.*, l.leave_type, l.leave_approved, l.from_date, l.to_date
      FROM leave_cancellation_requests lcr
      JOIN leave_requests l ON l.id = lcr.leave_request_id
      WHERE lcr.id = $1
      FOR UPDATE OF lcr, l
    `, [cancellationRequestId]);

    if (!requestResult.rows.length) {
      throw new LeaveCancellationError(404, 'Leave cancellation request not found.');
    }

    let cancellation = requestResult.rows[0];
    if (cancellation.status !== 'pending') {
      throw new LeaveCancellationError(409, `Cancellation request is already ${cancellation.status}.`);
    }
    if (cancellation[layerConfig.status] !== 'pending') {
      throw new LeaveCancellationError(409, `Cancellation request is already ${cancellation[layerConfig.status]} by this approval layer.`);
    }
    if (!cancellation.leave_approved) {
      throw new LeaveCancellationError(409, 'The related leave is no longer fully approved.');
    }
    if (getISTDate(cancellation.cancel_date) !== getISTDate()) {
      throw new LeaveCancellationError(409, 'A leave cancellation can only be approved on its requested date.');
    }
    const cancelDate = getISTDate(cancellation.cancel_date);
    if (cancelDate < getISTDate(cancellation.from_date) || cancelDate > getISTDate(cancellation.to_date)) {
      throw new LeaveCancellationError(409, 'Cancellation date is outside the related leave period.');
    }

    const layerUpdate = await client.query(`
      UPDATE leave_cancellation_requests
      SET ${layerConfig.status} = 'approved',
          ${layerConfig.reviewer} = $1,
          ${layerConfig.reviewedAt} = NOW(),
          ${layerConfig.remarks} = $2,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [reviewerId, remarks, cancellationRequestId]);
    cancellation = { ...cancellation, ...layerUpdate.rows[0] };

    if (cancellation.hm_status !== 'approved' || cancellation.vtp_status !== 'approved') {
      await client.query('COMMIT');
      return {
        finalized: false,
        message: `Leave cancellation approved by ${layer.toUpperCase()}. Awaiting ${layerConfig.waitingFor} approval.`,
        cancellation: layerUpdate.rows[0],
      };
    }

    const attendance = await client.query(`
      SELECT id, status, check_in_time, check_out_time
      FROM attendance_records
      WHERE user_id = $1 AND date = $2
      FOR UPDATE
    `, [cancellation.user_id, cancellation.cancel_date]);
    if (attendance.rows.length) {
      const record = attendance.rows[0];
      const isLeaveOnlyRecord = record.status === 'on_leave'
        && !record.check_in_time
        && !record.check_out_time;
      if (!isLeaveOnlyRecord) {
        throw new LeaveCancellationError(409, 'Actual attendance is already marked for the cancellation date.');
      }
      await client.query('DELETE FROM attendance_records WHERE id = $1', [record.id]);
    }

    const cancellationAmount = LeaveBalance.getDeductionAmount(cancellation.leave_type);
    let amountLeft = cancellationAmount;
    let refundedAmount = 0;

    const excessResult = await client.query(
      'SELECT * FROM leave_excess_records WHERE leave_request_id = $1 FOR UPDATE',
      [cancellation.leave_request_id]
    );
    if (excessResult.rows.length && amountLeft > 0) {
      const excess = excessResult.rows[0];
      const excessReduction = Math.min(amountLeft, Number(excess.excess_leave) || 0);
      amountLeft -= excessReduction;
      await client.query(`
        UPDATE leave_excess_records
        SET approved_leave_days = GREATEST(0, approved_leave_days - $1),
            excess_leave = GREATEST(0, excess_leave - $2), updated_at = NOW()
        WHERE id = $3
      `, [cancellationAmount, excessReduction, excess.id]);
    }

    const deductionResult = await client.query(
      'SELECT * FROM leave_deduction_log WHERE leave_request_id = $1 FOR UPDATE',
      [cancellation.leave_request_id]
    );
    if (deductionResult.rows.length && amountLeft > 0) {
      const deduction = deductionResult.rows[0];
      refundedAmount = Math.min(amountLeft, Number(deduction.deducted_amount) || 0);
      if (refundedAmount > 0) {
        const deductionYearResult = await client.query(`
          SELECT year FROM leave_balance WHERE user_id = $1
          AND year = CASE WHEN EXTRACT(MONTH FROM $2::timestamptz) >= 4
            THEN EXTRACT(YEAR FROM $2::timestamptz) ELSE EXTRACT(YEAR FROM $2::timestamptz) - 1 END
          FOR UPDATE
        `, [cancellation.user_id, deduction.deducted_at]);
        const balanceYear = deductionYearResult.rows[0]?.year;
        if (balanceYear !== undefined) {
          await client.query(`
            UPDATE leave_balance SET total_used = GREATEST(0, total_used - $1),
              remaining_balance = remaining_balance + $1, updated_at = NOW()
            WHERE user_id = $2 AND year = $3
          `, [refundedAmount, cancellation.user_id, balanceYear]);
        }
        await client.query(
          'UPDATE leave_deduction_log SET deducted_amount = GREATEST(0, deducted_amount - $1) WHERE id = $2',
          [refundedAmount, deduction.id]
        );
      }
    }

    const finalized = await client.query(`
      UPDATE leave_cancellation_requests
      SET status = 'approved', reviewed_by = $1, reviewer_remarks = $2,
          reviewed_at = NOW(), refunded_amount = $3, updated_at = NOW()
      WHERE id = $4 AND status = 'pending'
      RETURNING *
    `, [reviewerId, remarks, refundedAmount, cancellationRequestId]);
    await client.query(`
      UPDATE leave_requests SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1
    `, [cancellation.leave_request_id]);

    await client.query('COMMIT');
    return {
      finalized: true,
      message: 'Leave cancellation fully approved. Attendance is enabled for the cancellation date.',
      cancellation: finalized.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { approveCancellationLayer, LeaveCancellationError };
