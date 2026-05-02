const Report = require('../models/Report');
const { sendExcel, sendPDF } = require("../utils/export.utile");

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

module.exports = {
  downloadMonthlyAttendance,
  getMonthlySummary
};
