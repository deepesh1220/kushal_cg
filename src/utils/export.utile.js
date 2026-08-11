

const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

// ── Helpers ───────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  P: { fill: "E2EFDA", font: "276221" },
  A: { fill: "FCE4D6", font: "C00000" },
  L: { fill: "FFF2CC", font: "7F6000" },
  SU: { fill: "D9D9D9", font: "404040" },
  SH: { fill: "E8F4FD", font: "0E7C47" },
};

const thin = { style: "thin", color: { argb: "FFA0A0A0" } };
const thick = { style: "medium", color: { argb: "FF1F3864" } };
const allBorder = (s = thin) => ({ top: s, left: s, bottom: s, right: s });

const sanitizeAtt = (raw) =>
  Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === "SA" ? "A" : v])
  );

// ── Excel ─────────────────────────────────────────────────────────────────
const sendExcel = async (report, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("VT Approval");

  const {
    totalDays: days,
    attendance: rawAtt,
    month,
    employeeName = "Employee",
    employeeEmail = "",
    udiseCode = "",
    districtName = "",
    blockName = "",
    trade = "",
    vtpName = "",
    totalEarned = 0,
    remainingBalance = 0,
    excessLeave = 0, 
  } = report;

  const att = sanitizeAtt(rawAtt);

  const monthLabel = new Date(`${month}-01`)
    .toLocaleString("en-IN", { month: "long", year: "numeric" });

  const sumCol = days + 2;

  // ── Row 1: Title ─────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, sumCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Monthly Report — ${monthLabel}`;
  titleCell.font = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.border = allBorder(thick);
  ws.getRow(1).height = 28;

  // ── Row 2: Info bar ───────────────────────────────────────────────────────
  ws.mergeCells(2, 1, 2, sumCol);
  const infoCell = ws.getCell(2, 1);
  infoCell.value = `VT Name: ${employeeName}   |   Email: ${employeeEmail}   |   District: ${districtName}   |   Block: ${blockName}   |   Trade: ${trade}   |   VTP: ${vtpName}   |   UDISE: ${udiseCode}`;
  infoCell.font = { name: "Arial", bold: true, size: 9, color: { argb: "FF1F3864" } };
  infoCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4F0" } };
  infoCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  infoCell.border = allBorder();
  ws.getRow(2).height = 36;

  // ── Row 3: Day headers ────────────────────────────────────────────────────
  const hdrStyle = {
    font: { name: "Arial", bold: true, size: 8, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E5496" } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: allBorder(),
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
  sumHdr.value = "Summary";
  sumHdr.font = { name: "Arial", bold: true, size: 8, color: { argb: "FFFFFFFF" } };
  sumHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  sumHdr.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sumHdr.border = allBorder(thick);
  ws.getRow(3).height = 20;

  // ── Row 4: Attendance values ──────────────────────────────────────────────
  const nameCell = ws.getCell(4, 1);
  nameCell.value = employeeName;
  nameCell.font = { name: "Arial", bold: true, size: 8, color: { argb: "FF1F3864" } };
  nameCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  nameCell.border = allBorder();

  let present = 0, absent = 0, leave = 0;

  for (let d = 1; d <= days; d++) {
    const status = att[d] || "";
    if (status === "P") present++;
    if (status === "A") absent++;
    if (status === "L") leave++;

    const { fill: fg, font: fc } = STATUS_STYLE[status] || { fill: "FFFFFF", font: "000000" };
    const c = ws.getCell(4, d + 1);
    c.value = status;
    c.font = { name: "Arial", bold: true, size: 8, color: { argb: `FF${fc}` } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fg}` } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = allBorder();
  }

  const sc = ws.getCell(4, sumCol);
  sc.value = `P:${present}  A:${absent}  L:${leave}`;
  sc.font = { name: "Arial", bold: true, size: 8, color: { argb: "FF1F3864" } };
  sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  sc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sc.border = allBorder(thick);
  ws.getRow(4).height = 22;

  // ── Column widths ─────────────────────────────────────────────────────────
  ws.getColumn(1).width = 24;
  for (let d = 1; d <= days; d++) ws.getColumn(d + 1).width = 3.8;
  ws.getColumn(sumCol).width = 14;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];

  // ── Summary block (starts at row 6) ──────────────────────────────────────
  const sunday = Object.values(att).filter(v => v === "SU").length;

  const summaryRows = [
    ["Present (P)", present, "E2EFDA", "276221"],
    ["Absent (A)", absent, "FCE4D6", "C00000"],
    ["Leave (L)", leave, "FFF2CC", "7F6000"],
    ["Sunday (SU)", sunday, "D9D9D9", "404040"],
    ["Total Days", days, "D6E4F0", "1F3864"],
  ];

  ws.mergeCells(6, 1, 6, 3);
  const sumTitle = ws.getCell(6, 1);
  sumTitle.value = "Monthly Summary";
  sumTitle.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  sumTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  sumTitle.alignment = { horizontal: "center", vertical: "middle" };
  sumTitle.border = allBorder(thick);
  ws.getRow(6).height = 18;

  summaryRows.forEach(([label, val, bg, fc], i) => {
    const r = 7 + i;
    const lc = ws.getCell(r, 1);
    lc.value = label;
    lc.font = { name: "Arial", size: 9 };
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
    lc.alignment = { horizontal: "left", vertical: "middle" };
    lc.border = allBorder();
    ws.mergeCells(r, 2, r, 3);
    const vc = ws.getCell(r, 2);
    vc.value = val;
    vc.font = { name: "Arial", bold: true, size: 9, color: { argb: `FF${fc}` } };
    vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    vc.border = allBorder();
    ws.getRow(r).height = 16;
  });

  // ── Leave Balance block (placed to the RIGHT of Monthly Summary, col 5–7) ─
  const lbStartCol = 5; // one column gap after summary cols (1–3)

  ws.mergeCells(6, lbStartCol, 6, lbStartCol + 2);
  const lbTitle = ws.getCell(6, lbStartCol);
  lbTitle.value = "Leave Balance";
  lbTitle.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  lbTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  lbTitle.alignment = { horizontal: "center", vertical: "middle" };
  lbTitle.border = allBorder(thick);
  ws.getRow(6).height = 18;

  const leaveBalanceRows = [
    ["Total Earned Leave", totalEarned, "E8F4FD", "1F3864"],
    ["Remaining Leave", remainingBalance, "E2EFDA", "276221"],
    ...(excessLeave > 0
  ? [["Extra Leave", excessLeave, "FCE4D6", "C00000"]]
  : []),
  ];

  leaveBalanceRows.forEach(([label, val, bg, fc], i) => {
    const r = 7 + i;
    const lc = ws.getCell(r, lbStartCol);
    lc.value = label;
    lc.font = { name: "Arial", size: 9 };
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
    lc.alignment = { horizontal: "left", vertical: "middle" };
    lc.border = allBorder();
    ws.mergeCells(r, lbStartCol + 1, r, lbStartCol + 2);
    const vc = ws.getCell(r, lbStartCol + 1);
    vc.value = val;
    vc.font = { name: "Arial", bold: true, size: 9, color: { argb: `FF${fc}` } };
    vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    vc.border = allBorder();
    ws.getRow(r).height = 16;
  });

  // Set widths for leave balance columns
  ws.getColumn(lbStartCol).width = 24;
  ws.getColumn(lbStartCol + 1).width = 10;
  ws.getColumn(lbStartCol + 2).width = 10;

  res.setHeader("Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",
    `attachment; filename=report_${month}.xlsx`);
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
    districtName = "",
    blockName = "",
    trade = "",
    vtpName = "",
    totalEarned = 0,
    remainingBalance = 0,
     excessLeave = 0,  
  } = report;

  const att = sanitizeAtt(rawAtt);

  const monthLabel = new Date(`${month}-01`)
    .toLocaleString("en-IN", { month: "long", year: "numeric" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition",
    `attachment; filename=report_${month}.pdf`);
  doc.pipe(res);

  const W = doc.page.width - 40;
  let y = 20;

  // Title
  doc.rect(20, y, W, 24).fill("#1F3864");
  doc.fillColor("white").font("Helvetica-Bold").fontSize(13)
    .text(`Monthly Report — ${monthLabel}`, 20, y + 5, { width: W, align: "center" });
  y += 28;

  // Info bar
  doc.rect(20, y, W, 28).fill("#D6E4F0");
  doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(8)
    .text(
      `VT Name: ${employeeName}   |   Email: ${employeeEmail}   |   District: ${districtName}   |   Block: ${blockName}`,
      22, y + 4, { width: W - 4, align: "center" }
    )
    .text(
      `Trade: ${trade}   |   VTP: ${vtpName}   |   UDISE: ${udiseCode}   |   Month: ${monthLabel}`,
      22, y + 16, { width: W - 4, align: "center" }
    );
  y += 32;

  // Table header
  const nameW = 100;
  const sumW = 70;
  const dayW = (W - nameW - sumW) / days;

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
    P: ["#E2EFDA", "#276221"],
    A: ["#FCE4D6", "#C00000"],
    L: ["#FFF2CC", "#7F6000"],
    SU: ["#D9D9D9", "#404040"],
    SH: ["#E8F4FD", "#0E7C47"],
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
    ["Absent (A)", absent, "#FCE4D6", "#C00000"],
    ["Leave (L)", leave, "#FFF2CC", "#7F6000"],
    ["Sunday (SU)", sunday, "#D9D9D9", "#404040"],
    ["Total Days", days, "#D6E4F0", "#1F3864"],
  ];

  // const lbData = [
  //   ["Total Earned Leave", totalEarned, "#E8F4FD", "#1F3864"],
  //   ["Remaining Leave", remainingBalance, "#E2EFDA", "#276221"],
  //   // ["Leave Used (This Month)", leave,            "#FFF2CC", "#7F6000"],
  // ];

  const lbData = [
  ["Total Earned Leave", totalEarned,      "#E8F4FD", "#1F3864"],
  ["Remaining Leave",    remainingBalance,  "#E2EFDA", "#276221"],
  ...(excessLeave > 0
    ? [["Extra Leave", excessLeave, "#FCE4D6", "#C00000"]]
    : []),
];
  const blockW = 160; // width of each summary block
  const valW = 40;
  const labelW = blockW - valW;
  const gap = 20;  // gap between the two blocks
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

// ── NSQF Monthly Attendance Sheet PDF ────────────────────────────────────────
// Portrait A4. Renders attendance, leave details (dynamic), approval section
// pinned to page bottom, and VTP icon as watermark + header logo.
const VTP_ICON = path.join(__dirname, '../assets/cglogo.png');
const iconExists = fs.existsSync(VTP_ICON);

const sendNSQFPdf = (data, res) => {
  const {
    vtDetails = {},
    attendance = {},   // { day: { status, check_in, check_out, remarks } }
    summary = {},
    leaveDetails = {},
    approvals = {},   // { hm:{status,approvedAt}, deo:{...}, vtp:{...} }
    month,
    year,
  } = data;

  const doc = new PDFDocument({ size: 'A4', margin: 0, layout: 'portrait' });

  res.setHeader('Content-Type', 'application/pdf');
  const vtName = (vtDetails.vt_name || 'VT').replace(/\s+/g, '_');
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long' });
  res.setHeader('Content-Disposition',
    `attachment; filename=VT_Report_${vtName}_${monthName}_${year}.pdf`);
  doc.pipe(res);

  const ML = 28;           // left margin
  const MT = 20;           // top margin
  const PW = 595 - ML * 2; // usable page width
  let y = MT;

  // ─── Colors ─────────────────────────────────────────────────────────────────
  const DARK_BLUE = '#1F3864';
  const MED_BLUE = '#2E5496';
  const LIGHT_BLUE = '#D6E4F0';
  const WHITE = '#FFFFFF';
  const GRAY_LIGHT = '#F2F2F2';

  const STATUS_COLOR = {
    P: { bg: '#E2EFDA', fg: '#276221' },
    A: { bg: '#FCE4D6', fg: '#C00000' },
    H: { bg: '#D9D9D9', fg: '#404040' },  // Sunday
    SUN: { bg: '#D9D9D9', fg: '#404040' },
    GH: { bg: '#D9D9D9', fg: '#404040' },  // Govt holiday
    SH: { bg: '#E8F4FD', fg: '#0E7C47' },  // School holiday
    L: { bg: '#FFF2CC', fg: '#7F6000' },
    OD: { bg: '#E8F4FD', fg: '#1F6B9A' },
    HD: { bg: '#FFF2CC', fg: '#7F6000' },
    LATE: { bg: '#FCE4D6', fg: '#C00000' },
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const fillRect = (x, ry, w, h, fill, stroke) => {
    doc.save();
    doc.rect(x, ry, w, h).fillColor(fill).fill();
    if (stroke) doc.rect(x, ry, w, h).strokeColor(stroke).lineWidth(0.4).stroke();
    doc.restore();
  };

  const cellText = (text, x, ry, w, h, color, fontSize, bold, align, wrap = false) => {
    doc.save();
    doc.fillColor(color || '#000')
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(fontSize || 7);

    if (wrap) {
      const textHeight = doc.heightOfString(String(text ?? ''), { width: w - 4 });
      doc.text(String(text ?? ''), x + 2, ry + (h / 2) - textHeight / 2, {
        width: w - 4, align: align || 'left', lineBreak: true,
      });
    } else {
      doc.text(String(text ?? ''), x + 2, ry + (h / 2) - (fontSize || 7) / 2, {
        width: w - 4, align: align || 'left', lineBreak: false,
      });
    }
    doc.restore();
  };

  const cellTextRich = (parts, x, ry, w, h, color, fontSize, align, wrap = false) => {
    const validParts = parts.filter(p => p.text);
    if (validParts.length === 0) return;

    doc.save();
    doc.fillColor(color || '#000').fontSize(fontSize || 7);

    const fullText = validParts.map(p => p.text).join('');
    doc.font('Helvetica-Bold');
    const textHeight = wrap ? doc.heightOfString(fullText, { width: w - 4 }) : (fontSize || 7);
    const startY = ry + (h / 2) - textHeight / 2;

    const opt = { width: w - 4, align: align || 'left', lineBreak: wrap };

    validParts.forEach((p, i) => {
      doc.font(p.bold ? 'Helvetica-Bold' : 'Helvetica');
      const isLast = (i === validParts.length - 1);
      if (i === 0) {
        doc.text(p.text, x + 2, startY, { ...opt, continued: !isLast });
      } else {
        doc.text(p.text, { ...opt, continued: !isLast });
      }
    });
    doc.restore();
  };

  // ─── WATERMARK ───────────────────────────────────────────────────────────────
  // Draw image at full opacity, then cover with an 60%-opaque white rect so the
  // logo appears at ~20% visibility. This technique is reliable in all PDF viewers
  // because fillOpacity on a path operator (f) is universally supported, unlike
  // applying ca/CA graphics-state alpha to image (Do) operators.
  if (iconExists) {
    const wmSize = 260;
    const wmX = (595 - wmSize) / 2;
    const wmY = (842 - wmSize) / 2;
    doc.image(VTP_ICON, wmX, wmY, { width: wmSize, height: wmSize });
    doc.save();
    doc.rect(wmX, wmY, wmSize, wmSize).fillColor('#FFFFFF').fillOpacity(0.60).fill();
    doc.restore();
  }

  // ─── HEADER ──────────────────────────────────────────────────────────────────
  fillRect(ML, y, PW, 22, DARK_BLUE);
  if (iconExists) {
    doc.image(VTP_ICON, ML + 2, y + 1, { width: 20, height: 20 });
  }
  cellText('LEARNET  SKILLS LIMITED', ML + 24, y, PW * 0.4 - 24, 22, WHITE, 9, true, 'left');
  cellText('NSQF CHHATTISGARH PROJECT', ML + PW * 0.4, y, PW * 0.6, 22, WHITE, 9, true, 'right');
  y += 22;

  fillRect(ML, y, PW, 14, MED_BLUE);
  cellText("VT Monthly Status Report", ML, y, PW, 14, WHITE, 8, true, 'center');
  y += 14;

  // ─── VT DETAILS TABLE ────────────────────────────────────────────────────────
  const detRowH = 16;
  const c1W = 105, c3W = 75;
  const c2W = (PW - c1W - c3W) * 0.62;
  const c4W = PW - c1W - c2W - c3W;

  const drawDetail = (l1, v1, l2, v2, customH = detRowH, wrapV1 = false) => {
    fillRect(ML, y, c1W, customH, LIGHT_BLUE, '#A0A0A0');
    fillRect(ML + c1W, y, c2W, customH, WHITE, '#A0A0A0');
    fillRect(ML + c1W + c2W, y, c3W, customH, LIGHT_BLUE, '#A0A0A0');
    fillRect(ML + c1W + c2W + c3W, y, c4W, customH, WHITE, '#A0A0A0');
    cellText(l1, ML, y, c1W, customH, DARK_BLUE, 7, true);
    if (Array.isArray(v1)) {
      cellTextRich(v1, ML + c1W, y, c2W, customH, '#000', 7, 'left', wrapV1);
    } else {
      cellText(v1, ML + c1W, y, c2W, customH, '#000', 7, false, 'left', wrapV1);
    }
    cellText(l2, ML + c1W + c2W, y, c3W, customH, DARK_BLUE, 7, true);
    cellText(v2, ML + c1W + c2W + c3W, y, c4W, customH, '#000', 7, false);
    y += customH;
  };

  const totalDaysInMonth = new Date(year, month, 0).getDate();

  drawDetail('School & UDISE :', [
    { text: `${vtDetails.school_name || ''}\n`, bold: false },
    { text: `(UDISE: ${vtDetails.udise_code || ''})`, bold: true }
  ], 'District :', vtDetails.district_name || '', 24, true);
  drawDetail('Block Name :', vtDetails.block_name || '', 'VTP Name :', vtDetails.vtp_name || '');
  drawDetail('VT Name & Mobile No :', [
    { text: `${vtDetails.vt_name || ''} `, bold: false },
    { text: vtDetails.vt_mob ? `| ${vtDetails.vt_mob}` : '', bold: true }
  ], 'Trade :', vtDetails.trade || '');
  drawDetail('Report for Month :', `${monthName}-${year}`, 'Training Partner :', 'Learnet Skills Limited');

  y += 4;

  // ─── ATTENDANCE TABLE ─────────────────────────────────────────────────────────
  const half = 16;
  const attTableW = (PW - 6) / 2;
  const dateColW = 28;
  const statColW = 40;
  const remColW = attTableW - dateColW - statColW;
  const attRowH = 13;

  const drawAttHeader = (xOff) => {
    fillRect(ML + xOff, y, dateColW, attRowH, MED_BLUE, '#A0A0A0');
    fillRect(ML + xOff + dateColW, y, statColW, attRowH, MED_BLUE, '#A0A0A0');
    fillRect(ML + xOff + dateColW + statColW, y, remColW, attRowH, MED_BLUE, '#A0A0A0');
    cellText('Date', ML + xOff, y, dateColW, attRowH, WHITE, 7, true, 'center');
    cellText('Status', ML + xOff + dateColW, y, statColW, attRowH, WHITE, 7, true, 'center');
    cellText('Remarks', ML + xOff + dateColW + statColW, y, remColW, attRowH, WHITE, 7, true, 'center');
  };
  drawAttHeader(0);
  drawAttHeader(attTableW + 6);
  y += attRowH;

  for (let i = 1; i <= half; i++) {
    const drawRow = (day, xOff) => {
      const rec = attendance[day] || {};
      // status is '' for blank future days (set in _buildSnapshotData)
      const rawStatus = rec.status ?? '';

      const isFutureBlank = (rawStatus === '' && day <= totalDaysInMonth);
      const overMonth = day > totalDaysInMonth;

      const statusLabel = rawStatus === 'P' ? 'P'
        : rawStatus === 'A' ? 'A'
          : rawStatus === 'H' ? 'SUN'
            : rawStatus === 'GH' ? 'H'
              : rawStatus === 'SH' ? 'SH'
                : rawStatus === 'L' ? 'L'
                  : rawStatus === 'OD' ? 'OD'
                    : rawStatus === 'HD' ? 'HD'
                      : rawStatus === 'LATE' ? 'LATE'
                        : rawStatus;

      const colors = STATUS_COLOR[statusLabel] || STATUS_COLOR[rawStatus] || { bg: WHITE, fg: '#000' };
      const rowBg = overMonth ? '#F8F8F8'
        : isFutureBlank ? '#F5F5F5'
          : colors.bg;
      const rowFg = overMonth ? '#C0C0C0'
        : isFutureBlank ? '#BBBBBB'
          : colors.fg;

      const displayDay = overMonth ? '' : String(day);
      const displayStatus = overMonth || isFutureBlank ? '' : statusLabel;
      const remarks = overMonth || isFutureBlank ? ''
        : (rec.remarks || (rawStatus === 'H' ? 'SUNDAY' : rawStatus === 'GH' ? 'HOLIDAY' : rawStatus === 'SH' ? 'SCHOOL HOLIDAY' : ''));

      fillRect(ML + xOff, y, dateColW, attRowH, rowBg, '#C0C0C0');
      fillRect(ML + xOff + dateColW, y, statColW, attRowH, rowBg, '#C0C0C0');
      fillRect(ML + xOff + dateColW + statColW, y, remColW, attRowH, rowBg, '#C0C0C0');
      cellText(displayDay, ML + xOff, y, dateColW, attRowH, rowFg, 7, true, 'center');
      cellText(displayStatus, ML + xOff + dateColW, y, statColW, attRowH, rowFg, 7, true, 'center');
      cellText(remarks, ML + xOff + dateColW + statColW, y, remColW, attRowH, rowFg, 6, false, 'left');
    };
    drawRow(i, 0);
    drawRow(i + half, attTableW + 6);
    y += attRowH;
  }

  y += 4;

  // ─── SUMMARY ROWS (A–E) ──────────────────────────────────────────────────────
  const sumRowH = 13;
  const sumLabelW = PW * 0.38;
  const sumCodeW = 24;
  const sumDescW = PW - sumLabelW - sumCodeW;

  // Recount from attendance map (blank future days are not counted)
  let cntPresent = 0, cntAbsent = 0, cntHoliday = 0, cntSunday = 0, cntLeave = 0, cntSchoolHoliday = 0;
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const s = (attendance[d] || {}).status || '';
    if (s === 'P') cntPresent++;
    else if (s === 'A') cntAbsent++;
    else if (s === 'H') cntSunday++;
    else if (s === 'GH') cntHoliday++;
    else if (s === 'L') cntLeave++;
    else if (s === 'SH') cntSchoolHoliday++;
  }
  if (summary.totalPresent !== undefined) cntPresent = summary.totalPresent;
  if (summary.totalAbsent !== undefined) cntAbsent = summary.totalAbsent;
  if (summary.totalHolidays !== undefined) cntHoliday = summary.totalHolidays;
  if (summary.totalSundays !== undefined) cntSunday = summary.totalSundays;
  if (summary.totalLeaves !== undefined) cntLeave = summary.totalLeaves;
  if (summary.totalSchoolHolidays !== undefined) cntSchoolHoliday = summary.totalSchoolHolidays;

  [
    [`A.  Total Holidays: ${cntHoliday}`, 'P -', 'for Present'],
    [`B.  Total Sunday: ${cntSunday}`, 'A -', 'for Absent'],
    [`C.  Local Holidays: ${cntSchoolHoliday}`, 'L -', 'for Leave'],
    [`D.  No. of Extra Leaves: ${cntLeave}`, 'H -', 'for Holidays'],
    [`E.  Total Present Days: ${cntPresent}`, 'SH -', 'for Local Holidays'],
    ['', 'Sun-', 'for Sundays'],
  ].forEach(([label, code, desc]) => {
    fillRect(ML, y, sumLabelW, sumRowH, GRAY_LIGHT, '#C0C0C0');
    fillRect(ML + sumLabelW, y, sumCodeW, sumRowH, LIGHT_BLUE, '#C0C0C0');
    fillRect(ML + sumLabelW + sumCodeW, y, sumDescW, sumRowH, WHITE, '#C0C0C0');
    cellText(label, ML, y, sumLabelW, sumRowH, DARK_BLUE, 7, true);
    cellText(code, ML + sumLabelW, y, sumCodeW, sumRowH, DARK_BLUE, 7, true, 'center');
    cellText(desc, ML + sumLabelW + sumCodeW, y, sumDescW, sumRowH, '#333', 7, false);
    y += sumRowH;
  });

  y += 6;

  // ─── LEAVE DETAILS SECTION (dynamic) ─────────────────────────────────────────
  const fyLabel = leaveDetails.fyLabel || 'April 2025 to March 2026';
  fillRect(ML, y, PW, 13, MED_BLUE, '#A0A0A0');
  cellText(`Leave Detail (${fyLabel})`, ML, y, PW, 13, WHITE, 7, true);
  y += 13;

  const leaveColW = PW * 0.68;
  const leaveValW = PW - leaveColW;

  const leaveRows = [
    ['Annual Leave Entitlement (Casual Leave) :', String(leaveDetails.annualEntitlement ?? 12)],
    ['Leave Credited (Earned this Year) :', String(leaveDetails.totalEarned ?? 0)],
    ['Leave Taken by Trainer :', String(leaveDetails.leavesTaken ?? 0)],
    ['Excess Leave Taken :', String(leaveDetails.excessLeaveTaken ?? 0)],
    ['Remaining Leave Balance :', String(leaveDetails.remainingLeave ?? 0)],
  ];
  if ((leaveDetails.carriedForward ?? 0) > 0) {
    leaveRows.splice(1, 0,
      ['Leave Carried Forward (from Prev. Year) :', String(leaveDetails.carriedForward)]);
  }

  leaveRows.forEach(([label, val]) => {
    fillRect(ML, y, leaveColW, 13, GRAY_LIGHT, '#C0C0C0');
    fillRect(ML + leaveColW, y, leaveValW, 13, WHITE, '#C0C0C0');
    cellText(label, ML, y, leaveColW, 13, DARK_BLUE, 7, false);
    cellText(val, ML + leaveColW, y, leaveValW, 13, '#000', 7, true, 'center');
    y += 13;
  });

  // ─── ATTENDANCE OVERVIEW STATS CARD ──────────────────────────────────────────
  y += 8;
  fillRect(ML, y, PW, 13, MED_BLUE, '#A0A0A0');
  cellText('VT Overview', ML, y, PW, 13, WHITE, 8, true, 'center');
  y += 13;

  const boxW = PW / 3;
  const boxH = 35;
  const kpiBoxes = [
    ['Total Present', cntPresent, '#E2EFDA', '#276221'],
    ['Total Absent', cntAbsent, '#FCE4D6', '#C00000'],
    ['Total Leaves', cntLeave, '#FFF2CC', '#7F6000'],
    ['Govt Holidays', cntHoliday, '#D9D9D9', '#404040'],
    ['Total Sundays', cntSunday, '#EDEDED', '#555555'],
    ['Local Holidays', cntSchoolHoliday, '#E8F4FD', '#0E7C47'],
  ];
  for (let ki = 0; ki < 6; ki++) {
    const [kLabel, kVal, kBg, kFg] = kpiBoxes[ki];
    const bx = ML + (ki % 3) * boxW;
    const by = y + Math.floor(ki / 3) * boxH;
    fillRect(bx, by, boxW, boxH, kBg, '#A0A0A0');
    // Large number
    doc.save()
      .fillColor(kFg).font('Helvetica-Bold').fontSize(16)
      .text(String(kVal), bx, by + 5, { width: boxW, align: 'center', lineBreak: false })
      .restore();
    // Small label below
    doc.save()
      .fillColor(kFg).font('Helvetica').fontSize(6)
      .text(kLabel, bx + 2, by + 23, { width: boxW - 4, align: 'center', lineBreak: false })
      .restore();
  }
  y += boxH * 2;


  // ─── APPROVAL / SIGNATURE SECTION — pinned to bottom of page ─────────────────
  // Signature block height: VT/Seal row (40pt) + 6 approval rows × 13pt + footer (20pt)
  const apLineH = 13;
  const sigBlockHeight = 40 + 6 * apLineH;
  // Pin exactly to the bottom of A4 page (leaving room for footer)
  const bottomAnchor = doc.page.height - 40 - sigBlockHeight;
  if (y < bottomAnchor) y = bottomAnchor;  // push down if space available

  const approvalColW = PW / 3;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN',
    { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const apStatus = (s) => s === 'approved' ? 'APPROVED' : s === 'rejected' ? 'REJECTED' : 'PENDING';
  const apColor = (s) => s === 'approved' ? '#276221' : s === 'rejected' ? '#C00000' : '#7F6000';

  const hmA = approvals.hm || {};
  const deoA = approvals.deo || {};
  const vtpA = approvals.vtp || {};

  // Col 1: VT signature
  fillRect(ML, y, approvalColW, 40, GRAY_LIGHT, '#C0C0C0');
  cellText('Signature of Vocational Trainer', ML, y + 4, approvalColW, 13, DARK_BLUE, 7, true, 'center');
  cellText(vtDetails.vt_name || '', ML, y + 22, approvalColW, 13, '#555', 6, false, 'center');

  // Col 2: Learnet seal
  fillRect(ML + approvalColW, y, approvalColW, 40, GRAY_LIGHT, '#C0C0C0');
  cellText('LEARNET SKILLS', ML + approvalColW, y + 4, approvalColW, 13, MED_BLUE, 7, true, 'center');
  cellText('(Seal)', ML + approvalColW, y + 22, approvalColW, 13, '#555', 6, false, 'center');

  // Col 3: stacked approvals
  const ap3X = ML + approvalColW * 2;
  const ap3W = approvalColW;

  const drawApprovalRow = (label, apObj, bgColor, yPos) => {
    fillRect(ap3X, yPos, ap3W, apLineH, bgColor, '#C0C0C0');
    cellText(`${label}`, ap3X, yPos, ap3W * 0.5, apLineH, DARK_BLUE, 6, true);
    doc.save().fillColor(apColor(apObj.status)).font('Helvetica-Bold').fontSize(6)
      .text(`${apStatus(apObj.status)}${apObj.type ? ` (${apObj.type.toUpperCase()})` : ''}`, ap3X + ap3W * 0.5, yPos + 3, { width: ap3W * 0.5 - 4 });
    doc.restore();
  };

  let apY = y;
  drawApprovalRow('Principal/HM (Head Master) :', hmA, LIGHT_BLUE, apY); apY += apLineH;
  fillRect(ap3X, apY, ap3W, apLineH, WHITE, '#C0C0C0');
  cellText(`Date: ${fmtDate(hmA.approvedAt)}`, ap3X, apY, ap3W, apLineH, '#555', 6, false);
  apY += apLineH;

  drawApprovalRow('DEO :', deoA, LIGHT_BLUE, apY); apY += apLineH;
  fillRect(ap3X, apY, ap3W, apLineH, WHITE, '#C0C0C0');
  cellText(`Date: ${fmtDate(deoA.approvedAt)}`, ap3X, apY, ap3W, apLineH, '#555', 6, false);
  apY += apLineH;

  drawApprovalRow('VTP Final :', vtpA, LIGHT_BLUE, apY); apY += apLineH;
  fillRect(ap3X, apY, ap3W, apLineH, WHITE, '#C0C0C0');
  cellText(`Date: ${fmtDate(vtpA.approvedAt)}`, ap3X, apY, ap3W, apLineH, '#555', 6, false);

  // Footer — fixed at the bottom of the A4 page
  const footerY = doc.page.height - 25;
  doc.save().fillColor(DARK_BLUE).font('Helvetica').fontSize(6)
    .text('Kushal Chhattisgarh System Generated   |   NSQF Chhattisgarh Project   |   Learnet Skills Limited',
      ML, footerY, { width: PW, align: 'center' });
  doc.restore();

  doc.end();
};

module.exports = { sendExcel, sendPDF, sendNSQFPdf };
