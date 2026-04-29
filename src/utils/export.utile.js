const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

// ─── Excel Generator ─────────────────────
const sendExcel = async (report, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Attendance");

  const header = ["Day"];
  for (let i = 1; i <= report.totalDays; i++) {
    header.push(i);
  }

  const row = ["Status"];
  for (let i = 1; i <= report.totalDays; i++) {
    row.push(report.attendance[i]);
  }

  sheet.addRow(header);
  sheet.addRow(row);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=attendance_${report.month}.xlsx`
  );

  await workbook.xlsx.write(res);
  res.end();
};

// ─── PDF Generator ─────────────────────
const sendPDF = (report, res) => {
  const doc = new PDFDocument();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=attendance_${report.month}.pdf`
  );

  doc.pipe(res);

  doc.fontSize(16).text("Attendance Report", { align: "center" });
  doc.moveDown();

  for (let i = 1; i <= report.totalDays; i++) {
    doc.text(`Day ${i}: ${report.attendance[i]}`);
  }

  doc.end();
};

module.exports = {
  sendExcel,
  sendPDF,
};