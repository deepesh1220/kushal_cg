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
    const { udise_code, vtUserId, month, year, status, remarks } = req.body;
    
    // Fallback: If role_name is missing on req.user, try to determine role from role_id.
    let role_name = req.user.role_name;
    if (!role_name && req.user.role_id) {
      const roleResult = await pool.query('SELECT name FROM roles WHERE id = $1', [req.user.role_id]);
      if (roleResult.rows.length > 0) {
        role_name = roleResult.rows[0].name;
      }
    }

    if (!month || !year || !status) {
      return res.status(400).json({ status: false, message: 'month, year, and status are required.' });
    }

    if (!udise_code && !vtUserId) {
      return res.status(400).json({ status: false, message: 'Either udise_code or vtUserId must be provided.' });
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

    let userIdsToApprove = [];
    let queryUdiseCode = udise_code;

    if (vtUserId) {
      userIdsToApprove.push(vtUserId);
      // Ensure we have udise_code for the user
      if (!udise_code) {
        const userResult = await pool.query('SELECT udise_code FROM users WHERE id = $1', [vtUserId]);
        if (userResult.rows.length > 0) {
          queryUdiseCode = userResult.rows[0].udise_code;
        } else {
          return res.status(404).json({ status: false, message: 'VT user not found.' });
        }
      }
    } else if (udise_code) {
      // Get all vocational teachers for this school
      const usersResult = await pool.query(`
        SELECT u.id 
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.udise_code = $1 AND r.name = 'vocational_teacher'
      `, [udise_code]);
      
      userIdsToApprove = usersResult.rows.map(row => row.id);
      
      if (userIdsToApprove.length === 0) {
        return res.status(404).json({ status: false, message: 'No vocational teachers found for this school.' });
      }
    }

    const processedUsers = [];
    
    // Process approvals in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const uid of userIdsToApprove) {
        // Check if report exists
        const checkQuery = `
          SELECT id FROM monthly_school_reports 
          WHERE user_id = $1 AND report_month = $2 AND report_year = $3
        `;
        const checkResult = await client.query(checkQuery, [uid, month, year]);

        if (checkResult.rows.length === 0) {
          // Create it
          const insertQuery = `
            INSERT INTO monthly_school_reports (
              udise_code, user_id, report_month, report_year, ${statusCol}, ${remarksCol}
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
          `;
          const inserted = await client.query(insertQuery, [queryUdiseCode, uid, month, year, status, remarks || '']);
          processedUsers.push(inserted.rows[0]);
        } else {
          // Update it
          const updateQuery = `
            UPDATE monthly_school_reports
            SET ${statusCol} = $1, ${remarksCol} = $2, updated_at = NOW()
            WHERE user_id = $3 AND report_month = $4 AND report_year = $5
            RETURNING *
          `;
          const updated = await client.query(updateQuery, [status, remarks || '', uid, month, year]);
          processedUsers.push(updated.rows[0]);
        }
      }
      
      await client.query('COMMIT');
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      client.release();
    }

    return res.status(200).json({
      status: true,
      message: 'Monthly report(s) approved successfully.',
      data: processedUsers
    });

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
