const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

// ── Helpers ───────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  P: { fill: "E2EFDA", font: "276221" },
  A: { fill: "FCE4D6", font: "C00000" },
  L: { fill: "FFF2CC", font: "7F6000" },
  SA: { fill: "EDEDED", font: "404040" },
  SU: { fill: "D9D9D9", font: "404040" },
};

const thin = { style: "thin", color: { argb: "FFA0A0A0" } };
const thick = { style: "medium", color: { argb: "FF1F3864" } };
const allBorder = (s = thin) => ({ top: s, left: s, bottom: s, right: s });

// ── Excel ─────────────────────────────────────────────────────────────────
const sendExcel = async (report, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Attendance");

  const {
    totalDays: days,
    attendance: att,
    month,
    employeeName = "Employee",
    employeeEmail = "",
    udiseCode = ""
  } = report;

  const monthLabel = new Date(`${month}-01`)
    .toLocaleString("en-IN", { month: "long", year: "numeric" });

  const sumCol = days + 2; // last column

  // ── Row 1: Title ────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, sumCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Attendance Report — ${monthLabel}`;
  titleCell.font = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.border = allBorder(thick);
  ws.getRow(1).height = 28;

  // ── Row 2: Info bar ─────────────────────────────────────────────────────
  // const half = Math.floor(sumCol / 2);
  // ws.mergeCells(2, 1, 2, half);
  // ws.mergeCells(2, half + 1, 2, sumCol);
  // const infoStyle = {
  //   font: { name: "Arial", bold: true, size: 9, color: { argb: "FF1F3864" } },
  //   fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4F0" } },
  //   alignment: { horizontal: "left", vertical: "middle" },
  //   border: allBorder(),
  // };
  // const c2a = ws.getCell(2, 1);
  // c2a.value = `  Employee: ${employeeName}   |   ID: ${employeeId}`;
  // Object.assign(c2a, infoStyle);
  // const c2b = ws.getCell(2, half + 1);
  // c2b.value = `  Department: ${department}   |   Month: ${monthLabel}`;
  // Object.assign(c2b, infoStyle);
  // ws.getRow(2).height = 18;

  // ── Row 2: Info bar (CENTERED) ───────────────────────────────────────────
  ws.mergeCells(2, 1, 2, sumCol);

  const infoCell = ws.getCell(2, 1);
  infoCell.value =
    `Employee: ${employeeName}   |   UDISE: ${udiseCode}   |   Month: ${monthLabel}`;

  infoCell.font = {
    name: "Arial",
    bold: true,
    size: 9,
    color: { argb: "FF1F3864" }
  };

  infoCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD6E4F0" }
  };

  infoCell.alignment = {
    horizontal: "center",   // 🔥 THIS is the key fix
    vertical: "middle",
    wrapText: true
  };

  infoCell.border = allBorder();

  ws.getRow(2).height = 18;

  // ── Row 3: Day headers ──────────────────────────────────────────────────
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

  // ── Row 4: Attendance values ────────────────────────────────────────────
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

  // ── Column widths ───────────────────────────────────────────────────────
  ws.getColumn(1).width = 24;
  for (let d = 1; d <= days; d++) ws.getColumn(d + 1).width = 3.8;
  ws.getColumn(sumCol).width = 14;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];

  // ── Summary block (rows 6–12) ───────────────────────────────────────────
  const saturday = Object.values(att).filter(v => v === "SA").length;
  const sunday = Object.values(att).filter(v => v === "SU").length;
  const summaryRows = [
    ["Present (P)", present, "E2EFDA", "276221"],
    ["Absent (A)", absent, "FCE4D6", "C00000"],
    ["Leave (L)", leave, "FFF2CC", "7F6000"],
    ["Saturday (SA)", saturday, "EDEDED", "404040"],
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

  res.setHeader("Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",
    `attachment; filename=attendance_${month}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
};

// ── PDF (basic, same look) ────────────────────────────────────────────────
const sendPDF = (report, res) => {
  const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 20 });

  // ✅ Only ONE destructuring at the top
  const {
    totalDays: days,
    attendance: att,
    month,
    employeeName = "Employee",
    employeeEmail = "",
    udiseCode = ""
  } = report;

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

  doc.fillColor("#1F3864")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(
      `Employee: ${employeeName}   |   UDISE: ${udiseCode}   |   Month: ${monthLabel}`,
      20,              // EXACT same X as rect
      y + 4,
      {
        width: W,      // FULL width of rect
        align: "center"
      }
    );
  y += 20;

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

  // Status row
  const STATUS_RGB = {
    P: ["#E2EFDA", "#276221"],
    A: ["#FCE4D6", "#C00000"],
    L: ["#FFF2CC", "#7F6000"],
    SA: ["#EDEDED", "#404040"],
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

  // Monthly summary table
  doc.fillColor("#1F3864").font("Helvetica-Bold").fontSize(9)
    .text("Monthly Summary", 20, y);
  y += 12;

  // ✅ saturday/sunday counted from att
  const saturday = Object.values(att).filter(v => v === "SA").length;
  const sunday = Object.values(att).filter(v => v === "SU").length;

  const sumData = [
    ["Present (P)", present, "#E2EFDA", "#276221"],
    ["Absent (A)", absent, "#FCE4D6", "#C00000"],
    ["Leave (L)", leave, "#FFF2CC", "#7F6000"],
    ["Saturday (SA)", saturday, "#EDEDED", "#404040"],
    ["Sunday (SU)", sunday, "#D9D9D9", "#404040"],
    ["Total Days", days, "#D6E4F0", "#1F3864"],
  ];

  sumData.forEach(([label, val, bg, fg]) => {
    doc.rect(20, y, 100, 14).fill(bg).stroke("#A0A0A0");
    doc.fillColor(fg).font("Helvetica-Bold").fontSize(8).text(label, 24, y + 3);
    doc.rect(120, y, 40, 14).fill(bg).stroke("#A0A0A0");
    doc.fillColor(fg).font("Helvetica-Bold").fontSize(8)
      .text(String(val), 120, y + 3, { width: 40, align: "center" });
    y += 14;
  });

  doc.end();
};

// ── NSQF Monthly Attendance Sheet PDF ────────────────────────────────────────
// Generates a portrait A4 PDF matching the NSQF Chhattisgarh attendance sheet
// format. Called with snapshot_data from monthly_report_snapshots table plus
// the approval record from monthly_school_reports.
const sendNSQFPdf = (data, res) => {
  const {
    vtDetails = {},
    attendance = {},         // { day: { status, check_in, check_out, remarks } }
    summary = {},
    studentDetails = {},     // { class9:{girls,boys}, class10:{...}, class11:{...}, class12:{...} }
    leaveDetails = {},       // { casualLeave, leavesTaken, remainingLeave }
    approvals = {},          // { hm:{status,approvedAt,name}, deo:{...}, vtp:{...} }
    month,                   // integer 1-12
    year,                    // integer
  } = data;

  const doc = new PDFDocument({ size: 'A4', margin: 0, layout: 'portrait' });

  res.setHeader('Content-Type', 'application/pdf');
  const vtName = (vtDetails.vt_name || 'VT').replace(/\s+/g, '_');
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long' });
  res.setHeader('Content-Disposition', `attachment; filename=VT_Attendance_${vtName}_${monthName}_${year}.pdf`);
  doc.pipe(res);

  const ML = 28; // margin left
  const MT = 20; // margin top
  const PW = 595 - ML * 2; // page width minus margins
  let y = MT;

  // ─── Color palette ──────────────────────────────────────────────────────────
  const DARK_BLUE  = '#1F3864';
  const MED_BLUE   = '#2E5496';
  const LIGHT_BLUE = '#D6E4F0';
  const WHITE      = '#FFFFFF';
  const GRAY_LIGHT = '#F2F2F2';

  const NSQF_STATUS_COLOR = {
    P:   { bg: '#E2EFDA', fg: '#276221' },
    A:   { bg: '#FCE4D6', fg: '#C00000' },
    H:   { bg: '#D9D9D9', fg: '#404040' },
    SUN: { bg: '#D9D9D9', fg: '#404040' },
    L:   { bg: '#FFF2CC', fg: '#7F6000' },
    GH:  { bg: '#D9D9D9', fg: '#404040' },
    OD:  { bg: '#E8F4FD', fg: '#1F6B9A' },
    HD:  { bg: '#FFF2CC', fg: '#7F6000' },
    LATE:{ bg: '#FCE4D6', fg: '#C00000' },
  };

  // ─── Helper: draw a filled rect with optional stroke ────────────────────────
  const fillRect = (x, ry, w, h, fillColor, strokeColor) => {
    doc.save();
    doc.rect(x, ry, w, h).fillColor(fillColor).fill();
    if (strokeColor) {
      doc.rect(x, ry, w, h).strokeColor(strokeColor).lineWidth(0.4).stroke();
    }
    doc.restore();
  };

  // ─── Helper: text in a cell ──────────────────────────────────────────────────
  const cellText = (text, x, ry, w, h, color, fontSize, bold, align) => {
    doc.save();
    doc.fillColor(color || '#000000')
       .font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(fontSize || 7)
       .text(String(text || ''), x + 2, ry + (h / 2) - (fontSize || 7) / 2, {
         width: w - 4,
         align: align || 'left',
         lineBreak: false,
       });
    doc.restore();
  };

  // ─── HEADER ──────────────────────────────────────────────────────────────────
  // Top bar: LEARNET brand + NSQF Project title
  fillRect(ML, y, PW, 22, DARK_BLUE);
  cellText('LEARNET  SKILLS LIMITED', ML, y, PW * 0.4, 22, WHITE, 9, true, 'left');
  cellText('NSQF CHHATTISGARH PROJECT', ML + PW * 0.4, y, PW * 0.6, 22, WHITE, 9, true, 'right');
  y += 22;

  fillRect(ML, y, PW, 14, MED_BLUE);
  cellText('Vocational Trainer\'s Monthly Attendance Sheet', ML, y, PW, 14, WHITE, 8, true, 'center');
  y += 14;

  // ─── VT DETAILS TABLE ────────────────────────────────────────────────────────
  const detailRowH = 16;
  const col1W = 90;
  const col2W = PW * 0.45 - col1W;
  const col3W = 70;
  const col4W = PW - col1W - col2W - col3W;

  const drawDetailRow = (label1, val1, label2, val2) => {
    fillRect(ML,               y, col1W,           detailRowH, LIGHT_BLUE, '#A0A0A0');
    fillRect(ML + col1W,       y, col2W,           detailRowH, WHITE,      '#A0A0A0');
    fillRect(ML + col1W + col2W,       y, col3W,   detailRowH, LIGHT_BLUE, '#A0A0A0');
    fillRect(ML + col1W + col2W + col3W, y, col4W, detailRowH, WHITE,      '#A0A0A0');
    cellText(label1, ML,                         y, col1W,           detailRowH, DARK_BLUE, 7, true);
    cellText(val1,   ML + col1W,                 y, col2W,           detailRowH, '#000000', 7, false);
    cellText(label2, ML + col1W + col2W,         y, col3W,           detailRowH, DARK_BLUE, 7, true);
    cellText(val2,   ML + col1W + col2W + col3W, y, col4W,           detailRowH, '#000000', 7, false);
    y += detailRowH;
  };

  const totalDaysInMonth = new Date(year, month, 0).getDate();
  const monthYearLabel = `${monthName}-${year}`;

  drawDetailRow('School Name :',        vtDetails.school_name || '', 'District :',     vtDetails.district_name || '');
  drawDetailRow('Block Name :',         vtDetails.block_name  || '', 'VTP Name :',     vtDetails.vtp_name      || '');
  drawDetailRow('VT Name & Mobile No :', `${vtDetails.vt_name || ''} ${vtDetails.vt_mob ? '| ' + vtDetails.vt_mob : ''}`,
                'Trade :',              vtDetails.trade || '');
  drawDetailRow('Attendance for Month :', monthYearLabel, 'Training Partner :', 'Learnet Skills Limited');

  y += 4;

  // ─── ATTENDANCE TABLE ─────────────────────────────────────────────────────────
  // Two-column layout: dates 1-16 on left, 17-end on right (as in the image)
  const half = 16;
  const attTableW = (PW - 6) / 2;
  const dateColW = 28;
  const statusColW = 40;
  const remarkColW = attTableW - dateColW - statusColW;
  const attRowH = 13;

  // Header row
  const drawAttHeader = (xOffset) => {
    fillRect(ML + xOffset, y, dateColW,   attRowH, MED_BLUE, '#A0A0A0');
    fillRect(ML + xOffset + dateColW, y, statusColW, attRowH, MED_BLUE, '#A0A0A0');
    fillRect(ML + xOffset + dateColW + statusColW, y, remarkColW, attRowH, MED_BLUE, '#A0A0A0');
    cellText('Date',    ML + xOffset,                        y, dateColW,   attRowH, WHITE, 7, true, 'center');
    cellText('Status',  ML + xOffset + dateColW,             y, statusColW, attRowH, WHITE, 7, true, 'center');
    cellText('Remarks', ML + xOffset + dateColW + statusColW, y, remarkColW, attRowH, WHITE, 7, true, 'center');
  };

  drawAttHeader(0);
  drawAttHeader(attTableW + 6);
  y += attRowH;

  const attStartY = y;

  // Data rows: left column dates 1-16, right column 17-totalDays
  for (let i = 1; i <= half; i++) {
    const rightDay = i + half;
    const drawRow = (day, xOffset) => {
      const rec = attendance[day] || {};
      const rawStatus = rec.status || (day > totalDaysInMonth ? '' : 'A');
      // Normalise status code to display label
      const statusLabel = rawStatus === 'P' ? 'P'
        : rawStatus === 'A' ? 'A'
        : rawStatus === 'H' ? 'SUN'
        : rawStatus === 'GH' ? 'H'
        : rawStatus === 'L' ? 'L'
        : rawStatus === 'OD' ? 'OD'
        : rawStatus === 'HD' ? 'HD'
        : rawStatus === 'LATE' ? 'LATE'
        : rawStatus;
      const colors = NSQF_STATUS_COLOR[statusLabel] || NSQF_STATUS_COLOR[rawStatus] || { bg: WHITE, fg: '#000' };
      const rowBg = day > totalDaysInMonth ? '#F8F8F8' : colors.bg;
      const rowFg = day > totalDaysInMonth ? '#C0C0C0' : colors.fg;
      const displayDay = day > totalDaysInMonth ? '' : String(day);
      const displayStatus = day > totalDaysInMonth ? '' : statusLabel;
      const remarks = day > totalDaysInMonth ? '' : (rec.remarks || (rawStatus === 'H' ? 'SUNDAY' : rawStatus === 'GH' ? 'HOLIDAY' : ''));

      fillRect(ML + xOffset,                          y, dateColW,   attRowH, rowBg, '#C0C0C0');
      fillRect(ML + xOffset + dateColW,               y, statusColW, attRowH, rowBg, '#C0C0C0');
      fillRect(ML + xOffset + dateColW + statusColW,  y, remarkColW, attRowH, rowBg, '#C0C0C0');
      cellText(displayDay,    ML + xOffset,                        y, dateColW,   attRowH, rowFg, 7, true,  'center');
      cellText(displayStatus, ML + xOffset + dateColW,             y, statusColW, attRowH, rowFg, 7, true,  'center');
      cellText(remarks,       ML + xOffset + dateColW + statusColW, y, remarkColW, attRowH, rowFg, 6, false, 'left');
    };

    drawRow(i, 0);
    drawRow(rightDay, attTableW + 6);
    y += attRowH;
  }

  y += 4;

  // ─── SUMMARY ROWS (A–E) ──────────────────────────────────────────────────────
  const sumRowH = 13;
  const sumLabelW = PW * 0.38;
  const sumValW   = 32;
  const sumCodeW  = 24;
  const sumDescW  = PW - sumLabelW - sumValW - sumCodeW - sumValW;

  // Calculate summary counts from attendance map
  let cntPresent = 0, cntAbsent = 0, cntHoliday = 0, cntSunday = 0, cntLeave = 0;
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const s = (attendance[d] || {}).status || 'A';
    if (s === 'P' || s === 'present') cntPresent++;
    else if (s === 'A' || s === 'absent') cntAbsent++;
    else if (s === 'H') cntSunday++;
    else if (s === 'GH') cntHoliday++;
    else if (s === 'L') cntLeave++;
  }
  // Override with pre-computed summary if provided
  if (summary.totalPresent !== undefined) cntPresent = summary.totalPresent;
  if (summary.totalAbsent  !== undefined) cntAbsent  = summary.totalAbsent;
  if (summary.totalHolidays !== undefined) cntHoliday = summary.totalHolidays;
  if (summary.totalSundays  !== undefined) cntSunday  = summary.totalSundays;
  if (summary.totalLeaves   !== undefined) cntLeave   = summary.totalLeaves;

  const summaryRows = [
    [`A.  Total Days in Month: ${totalDaysInMonth}`, '', 'P -', 'for Present'],
    [`B.  Total Holidays: ${cntHoliday}`,            '', 'A -', 'for Absent'],
    [`C.  Total Sunday: ${cntSunday}`,               '', 'L -', 'for Leave'],
    [`D.  No. of Extra Leaves: ${cntLeave}`,         '', 'H -', 'for Holidays'],
    [`E.  Total Present Days: ${cntPresent}`,        '', 'Sun-', 'for Sundays'],
  ];

  summaryRows.forEach(([label, val, code, desc]) => {
    fillRect(ML,                       y, sumLabelW, sumRowH, GRAY_LIGHT, '#C0C0C0');
    fillRect(ML + sumLabelW,           y, sumCodeW,  sumRowH, LIGHT_BLUE, '#C0C0C0');
    fillRect(ML + sumLabelW + sumCodeW, y, sumDescW, sumRowH, WHITE,      '#C0C0C0');
    cellText(label, ML,                        y, sumLabelW, sumRowH, DARK_BLUE, 7, true);
    cellText(code,  ML + sumLabelW,            y, sumCodeW,  sumRowH, DARK_BLUE, 7, true, 'center');
    cellText(desc,  ML + sumLabelW + sumCodeW, y, sumDescW,  sumRowH, '#333333', 7, false);
    y += sumRowH;
  });

  y += 6;

  // ─── LEAVE DETAILS SECTION ────────────────────────────────────────────────────
  fillRect(ML, y, PW, 13, MED_BLUE, '#A0A0A0');
  cellText('Leave Detail (April-2025 to March-2026)', ML, y, PW, 13, WHITE, 7, true);
  y += 13;

  const leaveRows = [
    ['Total No. of Casual Leave', String(leaveDetails.casualLeave || '13')],
    ['Total No. of Leave Taken by Trainer :', String(leaveDetails.leavesTaken || cntLeave)],
    ['Total No. of Remaining Leave', String(leaveDetails.remainingLeave || (13 - (leaveDetails.leavesTaken || cntLeave)))],
  ];

  const leaveColW = PW * 0.65;
  const leaveValW = PW - leaveColW;

  leaveRows.forEach(([label, val]) => {
    fillRect(ML,              y, leaveColW, 13, GRAY_LIGHT, '#C0C0C0');
    fillRect(ML + leaveColW,  y, leaveValW, 13, WHITE,      '#C0C0C0');
    cellText(label, ML,              y, leaveColW, 13, DARK_BLUE, 7, false);
    cellText(val,   ML + leaveColW,  y, leaveValW, 13, '#000',    7, true, 'center');
    y += 13;
  });

  y += 6;

  // ─── STUDENT DETAILS SECTION ──────────────────────────────────────────────────
  fillRect(ML, y, PW, 13, MED_BLUE, '#A0A0A0');
  cellText('Students Details (April2025 to March2026)', ML, y, PW, 13, WHITE, 7, true);
  y += 13;

  const stuColW = [PW * 0.35, PW * 0.2, PW * 0.2, PW * 0.25];
  const stuHeaders = ['Class', 'Girls', 'Boys', 'Total'];
  stuHeaders.forEach((h, i) => {
    const xOff = ML + stuColW.slice(0, i).reduce((a, b) => a + b, 0);
    fillRect(xOff, y, stuColW[i], 13, LIGHT_BLUE, '#C0C0C0');
    cellText(h, xOff, y, stuColW[i], 13, DARK_BLUE, 7, true, 'center');
  });
  y += 13;

  const classDefs = [
    ['Class 9th',  studentDetails.class9  || {}],
    ['Class 10th', studentDetails.class10 || {}],
    ['Class 11th', studentDetails.class11 || {}],
    ['Class 12th', studentDetails.class12 || {}],
  ];

  classDefs.forEach(([label, cls]) => {
    const girls = cls.girls != null ? String(cls.girls) : '';
    const boys  = cls.boys  != null ? String(cls.boys)  : '';
    const total = cls.total != null ? String(cls.total) : (girls && boys ? String((parseInt(girls)||0)+(parseInt(boys)||0)) : '');
    [label, girls, boys, total].forEach((val, i) => {
      const xOff = ML + stuColW.slice(0, i).reduce((a, b) => a + b, 0);
      fillRect(xOff, y, stuColW[i], 13, WHITE, '#C0C0C0');
      cellText(val, xOff, y, stuColW[i], 13, '#000', 7, false, i === 0 ? 'left' : 'center');
    });
    y += 13;
  });

  // Tip by Principal row
  fillRect(ML, y, PW, 13, GRAY_LIGHT, '#C0C0C0');
  cellText('Tip by the Principal (If Any) :', ML, y, PW, 13, DARK_BLUE, 7, false);
  y += 13;

  y += 8;

  // ─── APPROVAL SIGNATURES SECTION ──────────────────────────────────────────────
  const approvalColW = PW / 3;
  const approvalH = 40;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const statusLabel = (s) => s === 'approved' ? 'APPROVED' : s === 'rejected' ? 'REJECTED' : 'PENDING';
  const statusColor = (s) => s === 'approved' ? '#276221' : s === 'rejected' ? '#C00000' : '#7F6000';

  // Signature col 1: VT
  fillRect(ML, y, approvalColW, approvalH, GRAY_LIGHT, '#C0C0C0');
  cellText('Signature of Vocational Trainer', ML, y + 4, approvalColW, 13, DARK_BLUE, 7, true, 'center');
  cellText(vtDetails.vt_name || '', ML, y + 20, approvalColW, 13, '#555', 6, false, 'center');

  // Seal col 2: Learnet seal placeholder
  fillRect(ML + approvalColW, y, approvalColW, approvalH, GRAY_LIGHT, '#C0C0C0');
  cellText('LEARNET SKILLS', ML + approvalColW, y + 4, approvalColW, 13, MED_BLUE, 7, true, 'center');
  cellText('(Seal)', ML + approvalColW, y + 20, approvalColW, 13, '#555', 6, false, 'center');

  // Approvals col 3: stacked HM / DEO / VTP
  const ap3X = ML + approvalColW * 2;
  const ap3W = approvalColW;
  const apLineH = 13;

  const hmStatus  = approvals.hm  || {};
  const deoStatus = approvals.deo || {};
  const vtpStatus = approvals.vtp || {};

  fillRect(ap3X, y, ap3W, apLineH, LIGHT_BLUE, '#C0C0C0');
  cellText('Principal/HM: ', ap3X, y, ap3W * 0.55, apLineH, DARK_BLUE, 6, true);
  doc.save().fillColor(statusColor(hmStatus.status)).font('Helvetica-Bold').fontSize(6)
     .text(statusLabel(hmStatus.status), ap3X + ap3W * 0.55, y + 3, { width: ap3W * 0.45 - 4 });
  doc.restore();
  y += apLineH;

  fillRect(ap3X, y, ap3W, apLineH, WHITE, '#C0C0C0');
  cellText(`Date: ${fmtDate(hmStatus.approvedAt)}`, ap3X, y, ap3W, apLineH, '#555', 6, false);
  y += apLineH;

  fillRect(ap3X, y, ap3W, apLineH, LIGHT_BLUE, '#C0C0C0');
  cellText('DEO: ', ap3X, y, ap3W * 0.55, apLineH, DARK_BLUE, 6, true);
  doc.save().fillColor(statusColor(deoStatus.status)).font('Helvetica-Bold').fontSize(6)
     .text(statusLabel(deoStatus.status), ap3X + ap3W * 0.55, y + 3, { width: ap3W * 0.45 - 4 });
  doc.restore();
  y += apLineH;

  fillRect(ap3X, y, ap3W, apLineH, WHITE, '#C0C0C0');
  cellText(`Date: ${fmtDate(deoStatus.approvedAt)}`, ap3X, y, ap3W, apLineH, '#555', 6, false);
  y += apLineH;

  // Reset y to approval section end
  // (VTP row printed on right side, matching height of VT/seal columns)
  const apFinalY = y;
  fillRect(ap3X, apFinalY, ap3W, apLineH, LIGHT_BLUE, '#C0C0C0');
  cellText('VTP Final: ', ap3X, apFinalY, ap3W * 0.55, apLineH, DARK_BLUE, 6, true);
  doc.save().fillColor(statusColor(vtpStatus.status)).font('Helvetica-Bold').fontSize(6)
     .text(statusLabel(vtpStatus.status), ap3X + ap3W * 0.55, apFinalY + 3, { width: ap3W * 0.45 - 4 });
  doc.restore();
  y = apFinalY + apLineH;

  fillRect(ap3X, y, ap3W, apLineH, WHITE, '#C0C0C0');
  cellText(`Date: ${fmtDate(vtpStatus.approvedAt)}`, ap3X, y, ap3W, apLineH, '#555', 6, false);
  y += apLineH;

  // Footer
  y += 6;
  doc.save().fillColor(DARK_BLUE).font('Helvetica').fontSize(6)
     .text(`Generated: ${new Date().toLocaleDateString('en-IN')}   |   NSQF Chhattisgarh Project   |   Learnet Skills Limited`,
           ML, y, { width: PW, align: 'center' });
  doc.restore();

  doc.end();
};

module.exports = { sendExcel, sendPDF, sendNSQFPdf };