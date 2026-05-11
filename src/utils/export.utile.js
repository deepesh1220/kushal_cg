
// const ExcelJS = require("exceljs");
// const PDFDocument = require("pdfkit");

// // ── Helpers ───────────────────────────────────────────────────────────────
// const STATUS_STYLE = {
//   P:  { fill: "E2EFDA", font: "276221" },
//   A:  { fill: "FCE4D6", font: "C00000" },
//   L:  { fill: "FFF2CC", font: "7F6000" },
//   SU: { fill: "D9D9D9", font: "404040" },
//   // SA removed — Saturday is a working day (P / A / L)
// };

// const thin  = { style: "thin",   color: { argb: "FFA0A0A0" } };
// const thick = { style: "medium", color: { argb: "FF1F3864" } };
// const allBorder = (s = thin) => ({ top: s, left: s, bottom: s, right: s });

// // Converts any legacy "SA" value to "A" so it never appears in the sheet
// const sanitizeAtt = (raw) =>
//   Object.fromEntries(
//     Object.entries(raw).map(([k, v]) => [k, v === "SA" ? "A" : v])
//   );

// // ── Excel ─────────────────────────────────────────────────────────────────
// const sendExcel = async (report, res) => {
//   const wb = new ExcelJS.Workbook();
//   const ws = wb.addWorksheet("Attendance");

//   const {
//     totalDays: days,
//     attendance: rawAtt,
//     month,
//     employeeName = "Employee",
//     employeeEmail = "",
//     udiseCode = ""
//   } = report;

//   // Replace SA → A at report level so counts & colours are all correct
//   const att = sanitizeAtt(rawAtt);

//   const monthLabel = new Date(`${month}-01`)
//     .toLocaleString("en-IN", { month: "long", year: "numeric" });

//   const sumCol = days + 2;

//   // ── Row 1: Title ─────────────────────────────────────────────────────────
//   ws.mergeCells(1, 1, 1, sumCol);
//   const titleCell = ws.getCell(1, 1);
//   titleCell.value = `Attendance Report — ${monthLabel}`;
//   titleCell.font      = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
//   titleCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
//   titleCell.alignment = { horizontal: "center", vertical: "middle" };
//   titleCell.border    = allBorder(thick);
//   ws.getRow(1).height = 28;

//   // ── Row 2: Info bar ───────────────────────────────────────────────────────
//   ws.mergeCells(2, 1, 2, sumCol);
//   const infoCell = ws.getCell(2, 1);
//   infoCell.value     = `Employee: ${employeeName}   |   UDISE: ${udiseCode}   |   Month: ${monthLabel}`;
//   infoCell.font      = { name: "Arial", bold: true, size: 9, color: { argb: "FF1F3864" } };
//   infoCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4F0" } };
//   infoCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
//   infoCell.border    = allBorder();
//   ws.getRow(2).height = 18;

//   // ── Row 3: Day headers ────────────────────────────────────────────────────
//   const hdrStyle = {
//     font:      { name: "Arial", bold: true, size: 8, color: { argb: "FFFFFFFF" } },
//     fill:      { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E5496" } },
//     alignment: { horizontal: "center", vertical: "middle" },
//     border:    allBorder(),
//   };

//   const nameHdr = ws.getCell(3, 1);
//   nameHdr.value = "Status";
//   Object.assign(nameHdr, hdrStyle);

//   for (let d = 1; d <= days; d++) {
//     const c = ws.getCell(3, d + 1);
//     c.value = d;
//     Object.assign(c, hdrStyle);
//   }

//   const sumHdr = ws.getCell(3, sumCol);
//   sumHdr.value     = "Summary";
//   sumHdr.font      = { name: "Arial", bold: true, size: 8, color: { argb: "FFFFFFFF" } };
//   sumHdr.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
//   sumHdr.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
//   sumHdr.border    = allBorder(thick);
//   ws.getRow(3).height = 20;

//   // ── Row 4: Attendance values ──────────────────────────────────────────────
//   const nameCell = ws.getCell(4, 1);
//   nameCell.value     = employeeName;
//   nameCell.font      = { name: "Arial", bold: true, size: 8, color: { argb: "FF1F3864" } };
//   nameCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
//   nameCell.border    = allBorder();

//   let present = 0, absent = 0, leave = 0;

//   for (let d = 1; d <= days; d++) {
//     const status = att[d] || "";
//     if (status === "P") present++;
//     if (status === "A") absent++;
//     if (status === "L") leave++;

//     const { fill: fg, font: fc } = STATUS_STYLE[status] || { fill: "FFFFFF", font: "000000" };
//     const c = ws.getCell(4, d + 1);
//     c.value     = status;
//     c.font      = { name: "Arial", bold: true, size: 8, color: { argb: `FF${fc}` } };
//     c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fg}` } };
//     c.alignment = { horizontal: "center", vertical: "middle" };
//     c.border    = allBorder();
//   }

//   const sc = ws.getCell(4, sumCol);
//   sc.value     = `P:${present}  A:${absent}  L:${leave}`;
//   sc.font      = { name: "Arial", bold: true, size: 8, color: { argb: "FF1F3864" } };
//   sc.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
//   sc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
//   sc.border    = allBorder(thick);
//   ws.getRow(4).height = 22;

//   // ── Column widths ─────────────────────────────────────────────────────────
//   ws.getColumn(1).width = 24;
//   for (let d = 1; d <= days; d++) ws.getColumn(d + 1).width = 3.8;
//   ws.getColumn(sumCol).width = 14;
//   ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];

//   // ── Summary block ─────────────────────────────────────────────────────────
//   const sunday = Object.values(att).filter(v => v === "SU").length;

//   const summaryRows = [
//     ["Present (P)",  present, "E2EFDA", "276221"],
//     ["Absent (A)",   absent,  "FCE4D6", "C00000"],
//     ["Leave (L)",    leave,   "FFF2CC", "7F6000"],
//     ["Sunday (SU)",  sunday,  "D9D9D9", "404040"],
//     ["Total Days",   days,    "D6E4F0", "1F3864"],
//   ];

//   ws.mergeCells(6, 1, 6, 3);
//   const sumTitle = ws.getCell(6, 1);
//   sumTitle.value     = "Monthly Summary";
//   sumTitle.font      = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
//   sumTitle.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
//   sumTitle.alignment = { horizontal: "center", vertical: "middle" };
//   sumTitle.border    = allBorder(thick);
//   ws.getRow(6).height = 18;

//   summaryRows.forEach(([label, val, bg, fc], i) => {
//     const r  = 7 + i;
//     const lc = ws.getCell(r, 1);
//     lc.value     = label;
//     lc.font      = { name: "Arial", size: 9 };
//     lc.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
//     lc.alignment = { horizontal: "left", vertical: "middle" };
//     lc.border    = allBorder();
//     ws.mergeCells(r, 2, r, 3);
//     const vc = ws.getCell(r, 2);
//     vc.value     = val;
//     vc.font      = { name: "Arial", bold: true, size: 9, color: { argb: `FF${fc}` } };
//     vc.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
//     vc.alignment = { horizontal: "center", vertical: "middle" };
//     vc.border    = allBorder();
//     ws.getRow(r).height = 16;
//   });

//   res.setHeader("Content-Type",
//     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
//   res.setHeader("Content-Disposition",
//     `attachment; filename=attendance_${month}.xlsx`);
//   await wb.xlsx.write(res);
//   res.end();
// };

// // ── PDF ───────────────────────────────────────────────────────────────────
// const sendPDF = (report, res) => {
//   const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 20 });

//   const {
//     totalDays: days,
//     attendance: rawAtt,
//     month,
//     employeeName = "Employee",
//     employeeEmail = "",
//     udiseCode = ""
//   } = report;

//   // Replace SA → A at report level
//   const att = sanitizeAtt(rawAtt);

//   const monthLabel = new Date(`${month}-01`)
//     .toLocaleString("en-IN", { month: "long", year: "numeric" });

//   res.setHeader("Content-Type", "application/pdf");
//   res.setHeader("Content-Disposition",
//     `attachment; filename=attendance_${month}.pdf`);
//   doc.pipe(res);

//   const W = doc.page.width - 40;
//   let y = 20;

//   // Title
//   doc.rect(20, y, W, 24).fill("#1F3864");
//   doc.fillColor("white").font("Helvetica-Bold").fontSize(13)
//     .text(`Attendance Report — ${monthLabel}`, 20, y + 5, { width: W, align: "center" });
//   y += 28;

//   // Info bar
//   doc.rect(20, y, W, 16).fill("#D6E4F0");
//   doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(8)
//     .text(
//       `Employee: ${employeeName}   |   UDISE: ${udiseCode}   |   Month: ${monthLabel}`,
//       20, y + 4, { width: W, align: "center" }
//     );
//   y += 20;

//   // Table header
//   const nameW = 100;
//   const sumW  = 70;
//   const dayW  = (W - nameW - sumW) / days;

//   doc.rect(20, y, nameW, 14).fill("#2E5496");
//   doc.fillColor("white").font("Helvetica-Bold").fontSize(7)
//     .text("Status", 22, y + 3, { width: nameW - 4, align: "center" });

//   for (let d = 1; d <= days; d++) {
//     const x = 20 + nameW + (d - 1) * dayW;
//     doc.rect(x, y, dayW, 14).fill("#2E5496").stroke("#A0A0A0");
//     doc.fillColor("white").font("Helvetica-Bold").fontSize(6)
//       .text(String(d), x, y + 4, { width: dayW, align: "center" });
//   }

//   doc.rect(20 + nameW + days * dayW, y, sumW, 14).fill("#1F3864");
//   doc.fillColor("white").font("Helvetica-Bold").fontSize(7)
//     .text("Summary", 20 + nameW + days * dayW, y + 3, { width: sumW, align: "center" });
//   y += 14;

//   // Status colours — SA removed
//   const STATUS_RGB = {
//     P:  ["#E2EFDA", "#276221"],
//     A:  ["#FCE4D6", "#C00000"],
//     L:  ["#FFF2CC", "#7F6000"],
//     SU: ["#D9D9D9", "#404040"],
//   };

//   doc.rect(20, y, nameW, 16).fill("#FFFFFF").stroke("#A0A0A0");
//   doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(7)
//     .text(employeeName, 22, y + 4, { width: nameW - 4 });

//   let present = 0, absent = 0, leave = 0;
//   for (let d = 1; d <= days; d++) {
//     const status = att[d] || "";
//     if (status === "P") present++;
//     if (status === "A") absent++;
//     if (status === "L") leave++;

//     const [bg, fg] = STATUS_RGB[status] || ["#FFFFFF", "#000000"];
//     const x = 20 + nameW + (d - 1) * dayW;
//     doc.rect(x, y, dayW, 16).fill(bg).stroke("#A0A0A0");
//     doc.fillColor(fg).font("Helvetica-Bold").fontSize(6.5)
//       .text(status, x, y + 5, { width: dayW, align: "center" });
//   }

//   const sx = 20 + nameW + days * dayW;
//   doc.rect(sx, y, sumW, 16).fill("#F2F2F2").stroke("#A0A0A0");
//   doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(7)
//     .text(`P:${present} A:${absent} L:${leave}`, sx + 2, y + 5, { width: sumW - 4, align: "center" });
//   y += 22;

//   // Monthly summary — SA row removed
//   doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(9)
//     .text("Monthly Summary", 20, y);
//   y += 12;

//   const sunday = Object.values(att).filter(v => v === "SU").length;

//   const sumData = [
//     ["Present (P)", present, "#E2EFDA", "#276221"],
//     ["Absent (A)",  absent,  "#FCE4D6", "#C00000"],
//     ["Leave (L)",   leave,   "#FFF2CC", "#7F6000"],
//     ["Sunday (SU)", sunday,  "#D9D9D9", "#404040"],
//     ["Total Days",  days,    "#D6E4F0", "#1F3864"],
//   ];

//   sumData.forEach(([label, val, bg, fg]) => {
//     doc.rect(20, y, 100, 14).fill(bg).stroke("#A0A0A0");
//     doc.fillColor(fg).font("Helvetica-Bold").fontSize(8).text(label, 24, y + 3);
//     doc.rect(120, y, 40, 14).fill(bg).stroke("#A0A0A0");
//     doc.fillColor(fg).font("Helvetica-Bold").fontSize(8)
//       .text(String(val), 120, y + 3, { width: 40, align: "center" });
//     y += 14;
//   });

//   doc.end();
// };

// module.exports = { sendExcel, sendPDF };

const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

// ── Helpers ───────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  P:  { fill: "E2EFDA", font: "276221" },
  A:  { fill: "FCE4D6", font: "C00000" },
  L:  { fill: "FFF2CC", font: "7F6000" },
  SU: { fill: "D9D9D9", font: "404040" },
};

const thin  = { style: "thin",   color: { argb: "FFA0A0A0" } };
const thick = { style: "medium", color: { argb: "FF1F3864" } };
const allBorder = (s = thin) => ({ top: s, left: s, bottom: s, right: s });

const sanitizeAtt = (raw) =>
  Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === "SA" ? "A" : v])
  );

// ── Excel ─────────────────────────────────────────────────────────────────
const sendExcel = async (report, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Attendance");

  const {
    totalDays: days,
    attendance: rawAtt,
    month,
    employeeName = "Employee",
    employeeEmail = "",
    udiseCode = "",
    totalEarned = 0,
    remainingBalance = 0,
  } = report;

  const att = sanitizeAtt(rawAtt);

  const monthLabel = new Date(`${month}-01`)
    .toLocaleString("en-IN", { month: "long", year: "numeric" });

  const sumCol = days + 2;

  // ── Row 1: Title ─────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, sumCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Attendance Report — ${monthLabel}`;
  titleCell.font      = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.border    = allBorder(thick);
  ws.getRow(1).height = 28;

  // ── Row 2: Info bar ───────────────────────────────────────────────────────
  ws.mergeCells(2, 1, 2, sumCol);
  const infoCell = ws.getCell(2, 1);
  infoCell.value     = `Employee: ${employeeName}   |   UDISE: ${udiseCode}   |   Month: ${monthLabel}`;
  infoCell.font      = { name: "Arial", bold: true, size: 9, color: { argb: "FF1F3864" } };
  infoCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4F0" } };
  infoCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  infoCell.border    = allBorder();
  ws.getRow(2).height = 18;

  // ── Row 3: Day headers ────────────────────────────────────────────────────
  const hdrStyle = {
    font:      { name: "Arial", bold: true, size: 8, color: { argb: "FFFFFFFF" } },
    fill:      { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E5496" } },
    alignment: { horizontal: "center", vertical: "middle" },
    border:    allBorder(),
  };

  const nameHdr = ws.getCell(3, 1);
  nameHdr.value = "Status";
  Object.assign(nameHdr, hdrStyle);

  for (let d = 1; d <= days; d++) {
    const c = ws.getCell(3, d + 1);
    c.value = d;
    Object.assign(c, hdrStyle);
  }

  const sumHdr = ws.getCell(3, sumCol);
  sumHdr.value     = "Summary";
  sumHdr.font      = { name: "Arial", bold: true, size: 8, color: { argb: "FFFFFFFF" } };
  sumHdr.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  sumHdr.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sumHdr.border    = allBorder(thick);
  ws.getRow(3).height = 20;

  // ── Row 4: Attendance values ──────────────────────────────────────────────
  const nameCell = ws.getCell(4, 1);
  nameCell.value     = employeeName;
  nameCell.font      = { name: "Arial", bold: true, size: 8, color: { argb: "FF1F3864" } };
  nameCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  nameCell.border    = allBorder();

  let present = 0, absent = 0, leave = 0;

  for (let d = 1; d <= days; d++) {
    const status = att[d] || "";
    if (status === "P") present++;
    if (status === "A") absent++;
    if (status === "L") leave++;

    const { fill: fg, font: fc } = STATUS_STYLE[status] || { fill: "FFFFFF", font: "000000" };
    const c = ws.getCell(4, d + 1);
    c.value     = status;
    c.font      = { name: "Arial", bold: true, size: 8, color: { argb: `FF${fc}` } };
    c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fg}` } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border    = allBorder();
  }

  const sc = ws.getCell(4, sumCol);
  sc.value     = `P:${present}  A:${absent}  L:${leave}`;
  sc.font      = { name: "Arial", bold: true, size: 8, color: { argb: "FF1F3864" } };
  sc.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  sc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sc.border    = allBorder(thick);
  ws.getRow(4).height = 22;

  // ── Column widths ─────────────────────────────────────────────────────────
  ws.getColumn(1).width = 24;
  for (let d = 1; d <= days; d++) ws.getColumn(d + 1).width = 3.8;
  ws.getColumn(sumCol).width = 14;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];

  // ── Summary block (starts at row 6) ──────────────────────────────────────
  const sunday = Object.values(att).filter(v => v === "SU").length;

  const summaryRows = [
    ["Present (P)",  present, "E2EFDA", "276221"],
    ["Absent (A)",   absent,  "FCE4D6", "C00000"],
    ["Leave (L)",    leave,   "FFF2CC", "7F6000"],
    ["Sunday (SU)",  sunday,  "D9D9D9", "404040"],
    ["Total Days",   days,    "D6E4F0", "1F3864"],
  ];

  ws.mergeCells(6, 1, 6, 3);
  const sumTitle = ws.getCell(6, 1);
  sumTitle.value     = "Monthly Summary";
  sumTitle.font      = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  sumTitle.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  sumTitle.alignment = { horizontal: "center", vertical: "middle" };
  sumTitle.border    = allBorder(thick);
  ws.getRow(6).height = 18;

  summaryRows.forEach(([label, val, bg, fc], i) => {
    const r  = 7 + i;
    const lc = ws.getCell(r, 1);
    lc.value     = label;
    lc.font      = { name: "Arial", size: 9 };
    lc.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
    lc.alignment = { horizontal: "left", vertical: "middle" };
    lc.border    = allBorder();
    ws.mergeCells(r, 2, r, 3);
    const vc = ws.getCell(r, 2);
    vc.value     = val;
    vc.font      = { name: "Arial", bold: true, size: 9, color: { argb: `FF${fc}` } };
    vc.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    vc.border    = allBorder();
    ws.getRow(r).height = 16;
  });

  // ── Leave Balance block (placed to the RIGHT of Monthly Summary, col 5–7) ─
  const lbStartCol = 5; // one column gap after summary cols (1–3)

  ws.mergeCells(6, lbStartCol, 6, lbStartCol + 2);
  const lbTitle = ws.getCell(6, lbStartCol);
  lbTitle.value     = "Leave Balance";
  lbTitle.font      = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  lbTitle.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  lbTitle.alignment = { horizontal: "center", vertical: "middle" };
  lbTitle.border    = allBorder(thick);
  ws.getRow(6).height = 18;

  const leaveBalanceRows = [
    ["Total Earned Leave",    totalEarned,       "E8F4FD", "1F3864"],
    ["Remaining Leave",       remainingBalance,  "E2EFDA", "276221"],
    // ["Leave Used (This Month)", leave,           "FFF2CC", "7F6000"],
  ];

  leaveBalanceRows.forEach(([label, val, bg, fc], i) => {
    const r  = 7 + i;
    const lc = ws.getCell(r, lbStartCol);
    lc.value     = label;
    lc.font      = { name: "Arial", size: 9 };
    lc.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
    lc.alignment = { horizontal: "left", vertical: "middle" };
    lc.border    = allBorder();
    ws.mergeCells(r, lbStartCol + 1, r, lbStartCol + 2);
    const vc = ws.getCell(r, lbStartCol + 1);
    vc.value     = val;
    vc.font      = { name: "Arial", bold: true, size: 9, color: { argb: `FF${fc}` } };
    vc.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    vc.border    = allBorder();
    ws.getRow(r).height = 16;
  });

  // Set widths for leave balance columns
  ws.getColumn(lbStartCol).width     = 24;
  ws.getColumn(lbStartCol + 1).width = 10;
  ws.getColumn(lbStartCol + 2).width = 10;

  res.setHeader("Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",
    `attachment; filename=attendance_${month}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
};

// ── PDF ───────────────────────────────────────────────────────────────────
const sendPDF = (report, res) => {
  const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 20 });

  const {
    totalDays: days,
    attendance: rawAtt,
    month,
    employeeName = "Employee",
    employeeEmail = "",
    udiseCode = "",
    totalEarned = 0,
    remainingBalance = 0,
  } = report;

  const att = sanitizeAtt(rawAtt);

  const monthLabel = new Date(`${month}-01`)
    .toLocaleString("en-IN", { month: "long", year: "numeric" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition",
    `attachment; filename=attendance_${month}.pdf`);
  doc.pipe(res);

  const W = doc.page.width - 40;
  let y = 20;

  // Title
  doc.rect(20, y, W, 24).fill("#1F3864");
  doc.fillColor("white").font("Helvetica-Bold").fontSize(13)
    .text(`Attendance Report — ${monthLabel}`, 20, y + 5, { width: W, align: "center" });
  y += 28;

  // Info bar
  doc.rect(20, y, W, 16).fill("#D6E4F0");
  doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(8)
    .text(
      `Employee: ${employeeName}   |   UDISE: ${udiseCode}   |   Month: ${monthLabel}`,
      20, y + 4, { width: W, align: "center" }
    );
  y += 20;

  // Table header
  const nameW = 100;
  const sumW  = 70;
  const dayW  = (W - nameW - sumW) / days;

  doc.rect(20, y, nameW, 14).fill("#2E5496");
  doc.fillColor("white").font("Helvetica-Bold").fontSize(7)
    .text("Status", 22, y + 3, { width: nameW - 4, align: "center" });

  for (let d = 1; d <= days; d++) {
    const x = 20 + nameW + (d - 1) * dayW;
    doc.rect(x, y, dayW, 14).fill("#2E5496").stroke("#A0A0A0");
    doc.fillColor("white").font("Helvetica-Bold").fontSize(6)
      .text(String(d), x, y + 4, { width: dayW, align: "center" });
  }

  doc.rect(20 + nameW + days * dayW, y, sumW, 14).fill("#1F3864");
  doc.fillColor("white").font("Helvetica-Bold").fontSize(7)
    .text("Summary", 20 + nameW + days * dayW, y + 3, { width: sumW, align: "center" });
  y += 14;

  const STATUS_RGB = {
    P:  ["#E2EFDA", "#276221"],
    A:  ["#FCE4D6", "#C00000"],
    L:  ["#FFF2CC", "#7F6000"],
    SU: ["#D9D9D9", "#404040"],
  };

  doc.rect(20, y, nameW, 16).fill("#FFFFFF").stroke("#A0A0A0");
  doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(7)
    .text(employeeName, 22, y + 4, { width: nameW - 4 });

  let present = 0, absent = 0, leave = 0;
  for (let d = 1; d <= days; d++) {
    const status = att[d] || "";
    if (status === "P") present++;
    if (status === "A") absent++;
    if (status === "L") leave++;

    const [bg, fg] = STATUS_RGB[status] || ["#FFFFFF", "#000000"];
    const x = 20 + nameW + (d - 1) * dayW;
    doc.rect(x, y, dayW, 16).fill(bg).stroke("#A0A0A0");
    doc.fillColor(fg).font("Helvetica-Bold").fontSize(6.5)
      .text(status, x, y + 5, { width: dayW, align: "center" });
  }

  const sx = 20 + nameW + days * dayW;
  doc.rect(sx, y, sumW, 16).fill("#F2F2F2").stroke("#A0A0A0");
  doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(7)
    .text(`P:${present} A:${absent} L:${leave}`, sx + 2, y + 5, { width: sumW - 4, align: "center" });
  y += 22;

  // ── Monthly Summary + Leave Balance side by side ──────────────────────────
  const sunday = Object.values(att).filter(v => v === "SU").length;

  const sumData = [
    ["Present (P)", present, "#E2EFDA", "#276221"],
    ["Absent (A)",  absent,  "#FCE4D6", "#C00000"],
    ["Leave (L)",   leave,   "#FFF2CC", "#7F6000"],
    ["Sunday (SU)", sunday,  "#D9D9D9", "#404040"],
    ["Total Days",  days,    "#D6E4F0", "#1F3864"],
  ];

  const lbData = [
    ["Total Earned Leave",      totalEarned,      "#E8F4FD", "#1F3864"],
    ["Remaining Leave",         remainingBalance, "#E2EFDA", "#276221"],
    // ["Leave Used (This Month)", leave,            "#FFF2CC", "#7F6000"],
  ];

  const blockW   = 160; // width of each summary block
  const valW     = 40;
  const labelW   = blockW - valW;
  const gap      = 20;  // gap between the two blocks
  const lbStartX = 20 + blockW + gap;

  // Section titles
  doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(9)
    .text("Monthly Summary", 20, y);
  doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(9)
    .text("Leave Balance", lbStartX, y);
  y += 12;

  // Draw Monthly Summary rows
  sumData.forEach(([label, val, bg, fg]) => {
    doc.rect(20, y, labelW, 14).fill(bg).stroke("#A0A0A0");
    doc.fillColor(fg).font("Helvetica-Bold").fontSize(8).text(label, 24, y + 3);
    doc.rect(20 + labelW, y, valW, 14).fill(bg).stroke("#A0A0A0");
    doc.fillColor(fg).font("Helvetica-Bold").fontSize(8)
      .text(String(val), 20 + labelW, y + 3, { width: valW, align: "center" });
    y += 14;
  });

  // Reset y to draw Leave Balance rows alongside summary rows
  y -= sumData.length * 14;

  lbData.forEach(([label, val, bg, fg]) => {
    doc.rect(lbStartX, y, labelW, 14).fill(bg).stroke("#A0A0A0");
    doc.fillColor(fg).font("Helvetica-Bold").fontSize(8).text(label, lbStartX + 4, y + 3);
    doc.rect(lbStartX + labelW, y, valW, 14).fill(bg).stroke("#A0A0A0");
    doc.fillColor(fg).font("Helvetica-Bold").fontSize(8)
      .text(String(val), lbStartX + labelW, y + 3, { width: valW, align: "center" });
    y += 14;
  });

  // Advance y past the taller of the two blocks
  y += (sumData.length - lbData.length) * 14;

  doc.end();
};

module.exports = { sendExcel, sendPDF };