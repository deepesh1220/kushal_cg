const Report = require('../models/Report');
const { sendExcel, sendPDF } = require("../utils/export.utile");
const { pool } = require('../config/db');

const downloadMonthlyAttendance = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = req.query.month || req.body.month || currentMonth;
    const { format } = req.query;

    if (!format) {
      return res.status(400).json({
        success: false,
        message: "format is required",
      });
    }

    const report = await Report.getAttendanceReport(userId, month);

    if (format === "excel") {
      return sendExcel(report, res);
    }

    if (format === "pdf") {
      return sendPDF(report, res);
    }

    return res.status(400).json({
      success: false,
      message: "Invalid format",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const { month, udise_code, vtUserId, page, limit } = req.query;

    if (!month) {
      return res.status(400).json({
        success: false,
        message: "month is required in YYYY-MM format",
      });
    }

    const filters = {
      month,
      udise_code,
      vtUserId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    };

    const report = await Report.getMonthlySummaryReport(filters);

    return res.status(200).json({
      success: true,
      data: report.data,
      pagination: report.pagination
    });
  } catch (err) {
    console.error("getMonthlySummary Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const approveMonthlyReport = async (req, res) => {
  try {
    const { udise_code, month, year, status, remarks } = req.body;
    
    // Fallback: If role_name is missing on req.user, try to determine role from role_id.
    let role_name = req.user.role_name;
    if (!role_name && req.user.role_id) {
      const roleResult = await pool.query('SELECT name FROM roles WHERE id = $1', [req.user.role_id]);
      if (roleResult.rows.length > 0) {
        role_name = roleResult.rows[0].name;
      }
    }

    if (!udise_code || !month || !year || !status) {
      return res.status(400).json({ status: false, message: 'udise_code, month, year, and status are required.' });
    }

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ status: false, message: 'Invalid status. Must be approved, rejected, or pending.' });
    }

    let statusCol = '';
    let remarksCol = '';

    if (role_name === 'headmaster') {
      statusCol = 'hm_approval_status';
      remarksCol = 'hm_remarks';
    } else if (role_name === 'vocational_teacher_provider' || role_name === 'vtp') {
      statusCol = 'vtp_approval_status';
      remarksCol = 'vtp_remarks';
    } else if (role_name === 'deo') {
      statusCol = 'deo_approval_status';
      remarksCol = 'deo_remarks';
    } else {
      return res.status(403).json({ status: false, message: `Role '${role_name}' is not authorized to approve monthly reports.` });
    }

    // Check if report exists
    const checkQuery = `
      SELECT id FROM monthly_school_reports 
      WHERE udise_code = $1 AND report_month = $2 AND report_year = $3
    `;
    const checkResult = await pool.query(checkQuery, [udise_code, month, year]);

    if (checkResult.rows.length === 0) {
      // Create it
      const insertQuery = `
        INSERT INTO monthly_school_reports (
          udise_code, report_month, report_year, ${statusCol}, ${remarksCol}
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const inserted = await pool.query(insertQuery, [udise_code, month, year, status, remarks || '']);
      return res.status(200).json({
        status: true,
        message: 'Monthly report created and approved successfully.',
        data: inserted.rows[0]
      });
    } else {
      // Update it
      const updateQuery = `
        UPDATE monthly_school_reports
        SET ${statusCol} = $1, ${remarksCol} = $2, updated_at = NOW()
        WHERE udise_code = $3 AND report_month = $4 AND report_year = $5
        RETURNING *
      `;
      const updated = await pool.query(updateQuery, [status, remarks || '', udise_code, month, year]);
      return res.status(200).json({
        status: true,
        message: 'Monthly report approval status updated successfully.',
        data: updated.rows[0]
      });
    }

  } catch (error) {
    console.error('approveMonthlyReport error:', error.message);
    return res.status(500).json({ status: false, message: 'Server error updating report approval.' });
  }
};

module.exports = {
  downloadMonthlyAttendance,
  getMonthlySummary,
  approveMonthlyReport
};
