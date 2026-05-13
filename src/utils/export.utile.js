const ExcelJS     = require("exceljs");
const PDFDocument = require("pdfkit");
const path        = require("path");
const fs          = require("fs");

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
// Portrait A4. Renders attendance, leave details (dynamic), approval section
// pinned to page bottom, and VTP icon as watermark + header logo.
const VTP_ICON   = path.join(__dirname, '../../../kushal_chhattisgarh/public/vtp_icon.png');
const iconExists = fs.existsSync(VTP_ICON);

const sendNSQFPdf = (data, res) => {
  const {
    vtDetails  = {},
    attendance = {},   // { day: { status, check_in, check_out, remarks } }
    summary    = {},
    leaveDetails = {},
    approvals  = {},   // { hm:{status,approvedAt}, deo:{...}, vtp:{...} }
    month,
    year,
  } = data;

  const doc = new PDFDocument({ size: 'A4', margin: 0, layout: 'portrait' });

  res.setHeader('Content-Type', 'application/pdf');
  const vtName    = (vtDetails.vt_name || 'VT').replace(/\s+/g, '_');
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long' });
  res.setHeader('Content-Disposition',
    `attachment; filename=VT_Attendance_${vtName}_${monthName}_${year}.pdf`);
  doc.pipe(res);

  const ML = 28;           // left margin
  const MT = 20;           // top margin
  const PW = 595 - ML * 2; // usable page width
  let y = MT;

  // ─── Colors ─────────────────────────────────────────────────────────────────
  const DARK_BLUE  = '#1F3864';
  const MED_BLUE   = '#2E5496';
  const LIGHT_BLUE = '#D6E4F0';
  const WHITE      = '#FFFFFF';
  const GRAY_LIGHT = '#F2F2F2';

  const STATUS_COLOR = {
    P:    { bg: '#E2EFDA', fg: '#276221' },
    A:    { bg: '#FCE4D6', fg: '#C00000' },
    H:    { bg: '#D9D9D9', fg: '#404040' },  // Sunday
    SUN:  { bg: '#D9D9D9', fg: '#404040' },
    GH:   { bg: '#D9D9D9', fg: '#404040' },  // Govt holiday
    L:    { bg: '#FFF2CC', fg: '#7F6000' },
    OD:   { bg: '#E8F4FD', fg: '#1F6B9A' },
    HD:   { bg: '#FFF2CC', fg: '#7F6000' },
    LATE: { bg: '#FCE4D6', fg: '#C00000' },
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const fillRect = (x, ry, w, h, fill, stroke) => {
    doc.save();
    doc.rect(x, ry, w, h).fillColor(fill).fill();
    if (stroke) doc.rect(x, ry, w, h).strokeColor(stroke).lineWidth(0.4).stroke();
    doc.restore();
  };

  const cellText = (text, x, ry, w, h, color, fontSize, bold, align) => {
    doc.save();
    doc.fillColor(color || '#000')
       .font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(fontSize || 7)
       .text(String(text ?? ''), x + 2, ry + (h / 2) - (fontSize || 7) / 2, {
         width: w - 4, align: align || 'left', lineBreak: false,
       });
    doc.restore();
  };

  // ─── WATERMARK (drawn first so all content renders on top) ──────────────────
  if (iconExists) {
    doc.save();
    doc.opacity(0.07);
    const wmSize = 280;
    doc.image(VTP_ICON, (595 - wmSize) / 2, (842 - wmSize) / 2,
              { width: wmSize, height: wmSize });
    doc.restore();
  }

  // ─── HEADER ──────────────────────────────────────────────────────────────────
  fillRect(ML, y, PW, 22, DARK_BLUE);
  if (iconExists) {
    doc.image(VTP_ICON, ML + 2, y + 1, { width: 20, height: 20 });
  }
  cellText('LEARNET  SKILLS LIMITED',    ML + 24,       y, PW * 0.4 - 24, 22, WHITE, 9, true, 'left');
  cellText('NSQF CHHATTISGARH PROJECT',  ML + PW * 0.4, y, PW * 0.6,      22, WHITE, 9, true, 'right');
  y += 22;

  fillRect(ML, y, PW, 14, MED_BLUE);
  cellText("Vocational Trainer's Monthly Attendance Sheet", ML, y, PW, 14, WHITE, 8, true, 'center');
  y += 14;

  // ─── VT DETAILS TABLE ────────────────────────────────────────────────────────
  const detRowH = 16;
  const c1W = 90, c2W = PW * 0.45 - 90, c3W = 70, c4W = PW - 90 - (PW * 0.45 - 90) - 70;

  const drawDetail = (l1, v1, l2, v2) => {
    fillRect(ML,           y, c1W, detRowH, LIGHT_BLUE, '#A0A0A0');
    fillRect(ML + c1W,     y, c2W, detRowH, WHITE,      '#A0A0A0');
    fillRect(ML+c1W+c2W,   y, c3W, detRowH, LIGHT_BLUE, '#A0A0A0');
    fillRect(ML+c1W+c2W+c3W, y, c4W, detRowH, WHITE,    '#A0A0A0');
    cellText(l1, ML,             y, c1W, detRowH, DARK_BLUE, 7, true);
    cellText(v1, ML + c1W,       y, c2W, detRowH, '#000',    7, false);
    cellText(l2, ML+c1W+c2W,     y, c3W, detRowH, DARK_BLUE, 7, true);
    cellText(v2, ML+c1W+c2W+c3W, y, c4W, detRowH, '#000',    7, false);
    y += detRowH;
  };

  const totalDaysInMonth = new Date(year, month, 0).getDate();

  drawDetail('School Name :',         vtDetails.school_name  || '', 'District :',      vtDetails.district_name || '');
  drawDetail('Block Name :',          vtDetails.block_name   || '', 'VTP Name :',      vtDetails.vtp_name      || '');
  drawDetail('VT Name & Mobile No :', `${vtDetails.vt_name || ''} ${vtDetails.vt_mob ? '| ' + vtDetails.vt_mob : ''}`,
             'Trade :',               vtDetails.trade || '');
  drawDetail('Attendance for Month :', `${monthName}-${year}`, 'Training Partner :', 'Learnet Skills Limited');

  y += 4;

  // ─── ATTENDANCE TABLE ─────────────────────────────────────────────────────────
  const half      = 16;
  const attTableW = (PW - 6) / 2;
  const dateColW  = 28;
  const statColW  = 40;
  const remColW   = attTableW - dateColW - statColW;
  const attRowH   = 13;

  const drawAttHeader = (xOff) => {
    fillRect(ML + xOff,                       y, dateColW, attRowH, MED_BLUE, '#A0A0A0');
    fillRect(ML + xOff + dateColW,            y, statColW, attRowH, MED_BLUE, '#A0A0A0');
    fillRect(ML + xOff + dateColW + statColW, y, remColW,  attRowH, MED_BLUE, '#A0A0A0');
    cellText('Date',    ML + xOff,                       y, dateColW, attRowH, WHITE, 7, true, 'center');
    cellText('Status',  ML + xOff + dateColW,            y, statColW, attRowH, WHITE, 7, true, 'center');
    cellText('Remarks', ML + xOff + dateColW + statColW, y, remColW,  attRowH, WHITE, 7, true, 'center');
  };
  drawAttHeader(0);
  drawAttHeader(attTableW + 6);
  y += attRowH;

  for (let i = 1; i <= half; i++) {
    const drawRow = (day, xOff) => {
      const rec       = attendance[day] || {};
      // status is '' for blank future days (set in _buildSnapshotData)
      const rawStatus = rec.status ?? '';

      const isFutureBlank = (rawStatus === '' && day <= totalDaysInMonth);
      const overMonth     = day > totalDaysInMonth;

      const statusLabel = rawStatus === 'P'    ? 'P'
        : rawStatus === 'A'    ? 'A'
        : rawStatus === 'H'    ? 'SUN'
        : rawStatus === 'GH'   ? 'H'
        : rawStatus === 'L'    ? 'L'
        : rawStatus === 'OD'   ? 'OD'
        : rawStatus === 'HD'   ? 'HD'
        : rawStatus === 'LATE' ? 'LATE'
        : rawStatus;

      const colors = STATUS_COLOR[statusLabel] || STATUS_COLOR[rawStatus] || { bg: WHITE, fg: '#000' };
      const rowBg  = overMonth     ? '#F8F8F8'
                   : isFutureBlank ? '#F5F5F5'
                   : colors.bg;
      const rowFg  = overMonth     ? '#C0C0C0'
                   : isFutureBlank ? '#BBBBBB'
                   : colors.fg;

      const displayDay    = overMonth ? '' : String(day);
      const displayStatus = overMonth || isFutureBlank ? '' : statusLabel;
      const remarks       = overMonth || isFutureBlank ? ''
        : (rec.remarks || (rawStatus === 'H' ? 'SUNDAY' : rawStatus === 'GH' ? 'HOLIDAY' : ''));

      fillRect(ML + xOff,                       y, dateColW, attRowH, rowBg, '#C0C0C0');
      fillRect(ML + xOff + dateColW,            y, statColW, attRowH, rowBg, '#C0C0C0');
      fillRect(ML + xOff + dateColW + statColW, y, remColW,  attRowH, rowBg, '#C0C0C0');
      cellText(displayDay,    ML + xOff,                       y, dateColW, attRowH, rowFg, 7, true,  'center');
      cellText(displayStatus, ML + xOff + dateColW,            y, statColW, attRowH, rowFg, 7, true,  'center');
      cellText(remarks,       ML + xOff + dateColW + statColW, y, remColW,  attRowH, rowFg, 6, false, 'left');
    };
    drawRow(i,         0);
    drawRow(i + half,  attTableW + 6);
    y += attRowH;
  }

  y += 4;

  // ─── SUMMARY ROWS (A–E) ──────────────────────────────────────────────────────
  const sumRowH   = 13;
  const sumLabelW = PW * 0.38;
  const sumCodeW  = 24;
  const sumDescW  = PW - sumLabelW - sumCodeW;

  // Recount from attendance map (blank future days are not counted)
  let cntPresent = 0, cntAbsent = 0, cntHoliday = 0, cntSunday = 0, cntLeave = 0;
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const s = (attendance[d] || {}).status || '';
    if (s === 'P')       cntPresent++;
    else if (s === 'A')  cntAbsent++;
    else if (s === 'H')  cntSunday++;
    else if (s === 'GH') cntHoliday++;
    else if (s === 'L')  cntLeave++;
  }
  if (summary.totalPresent  !== undefined) cntPresent  = summary.totalPresent;
  if (summary.totalAbsent   !== undefined) cntAbsent   = summary.totalAbsent;
  if (summary.totalHolidays !== undefined) cntHoliday  = summary.totalHolidays;
  if (summary.totalSundays  !== undefined) cntSunday   = summary.totalSundays;
  if (summary.totalLeaves   !== undefined) cntLeave    = summary.totalLeaves;

  [
    [`A.  Total Days in Month: ${totalDaysInMonth}`, 'P -', 'for Present'],
    [`B.  Total Holidays: ${cntHoliday}`,            'A -', 'for Absent'],
    [`C.  Total Sunday: ${cntSunday}`,               'L -', 'for Leave'],
    [`D.  No. of Extra Leaves: ${cntLeave}`,         'H -', 'for Holidays'],
    [`E.  Total Present Days: ${cntPresent}`,        'Sun-','for Sundays'],
  ].forEach(([label, code, desc]) => {
    fillRect(ML,               y, sumLabelW, sumRowH, GRAY_LIGHT, '#C0C0C0');
    fillRect(ML + sumLabelW,   y, sumCodeW,  sumRowH, LIGHT_BLUE, '#C0C0C0');
    fillRect(ML+sumLabelW+sumCodeW, y, sumDescW, sumRowH, WHITE,  '#C0C0C0');
    cellText(label, ML,               y, sumLabelW, sumRowH, DARK_BLUE, 7, true);
    cellText(code,  ML + sumLabelW,   y, sumCodeW,  sumRowH, DARK_BLUE, 7, true, 'center');
    cellText(desc,  ML+sumLabelW+sumCodeW, y, sumDescW, sumRowH, '#333', 7, false);
    y += sumRowH;
  });

  y += 6;

  // ─── LEAVE DETAILS SECTION (dynamic) ─────────────────────────────────────────
  const fyLabel  = leaveDetails.fyLabel || 'April 2025 to March 2026';
  fillRect(ML, y, PW, 13, MED_BLUE, '#A0A0A0');
  cellText(`Leave Detail (${fyLabel})`, ML, y, PW, 13, WHITE, 7, true);
  y += 13;

  const leaveColW = PW * 0.68;
  const leaveValW = PW - leaveColW;

  const leaveRows = [
    ['Annual Leave Entitlement (Casual Leave) :',  String(leaveDetails.annualEntitlement ?? 12)],
    ['Leave Credited (Earned this Year) :',        String(leaveDetails.totalEarned       ?? 0)],
    ['Leave Taken by Trainer :',                   String(leaveDetails.leavesTaken       ?? 0)],
    ['Excess Leave Taken :',                       String(leaveDetails.excessLeaveTaken  ?? 0)],
    ['Remaining Leave Balance :',                  String(leaveDetails.remainingLeave    ?? 0)],
  ];
  if ((leaveDetails.carriedForward ?? 0) > 0) {
    leaveRows.splice(1, 0,
      ['Leave Carried Forward (from Prev. Year) :', String(leaveDetails.carriedForward)]);
  }

  leaveRows.forEach(([label, val]) => {
    fillRect(ML,             y, leaveColW, 13, GRAY_LIGHT, '#C0C0C0');
    fillRect(ML + leaveColW, y, leaveValW, 13, WHITE,      '#C0C0C0');
    cellText(label, ML,             y, leaveColW, 13, DARK_BLUE, 7, false);
    cellText(val,   ML + leaveColW, y, leaveValW, 13, '#000',    7, true, 'center');
    y += 13;
  });

  // ─── APPROVAL / SIGNATURE SECTION — pinned to bottom of page ─────────────────
  // Signature block height: VT/Seal row (40pt) + 6 approval rows × 13pt + footer (20pt)
  const apLineH        = 13;
  const sigBlockHeight = 40 + 6 * apLineH + 20;
  const bottomAnchor   = doc.page.height - MT - sigBlockHeight;
  if (y < bottomAnchor) y = bottomAnchor;  // push down if space available

  const approvalColW = PW / 3;
  const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-IN',
    { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const apStatus = (s) => s === 'approved' ? 'APPROVED' : s === 'rejected' ? 'REJECTED' : 'PENDING';
  const apColor  = (s) => s === 'approved' ? '#276221' : s === 'rejected' ? '#C00000' : '#7F6000';

  const hmA  = approvals.hm  || {};
  const deoA = approvals.deo || {};
  const vtpA = approvals.vtp || {};

  // Col 1: VT signature
  fillRect(ML, y, approvalColW, 40, GRAY_LIGHT, '#C0C0C0');
  cellText('Signature of Vocational Trainer', ML, y + 4,  approvalColW, 13, DARK_BLUE, 7, true, 'center');
  cellText(vtDetails.vt_name || '',           ML, y + 22, approvalColW, 13, '#555',    6, false, 'center');

  // Col 2: Learnet seal
  fillRect(ML + approvalColW, y, approvalColW, 40, GRAY_LIGHT, '#C0C0C0');
  cellText('LEARNET SKILLS', ML + approvalColW, y + 4,  approvalColW, 13, MED_BLUE, 7, true, 'center');
  cellText('(Seal)',         ML + approvalColW, y + 22, approvalColW, 13, '#555',   6, false, 'center');

  // Col 3: stacked approvals
  const ap3X = ML + approvalColW * 2;
  const ap3W = approvalColW;

  const drawApprovalRow = (label, apObj, bgColor, yPos) => {
    fillRect(ap3X, yPos, ap3W, apLineH, bgColor, '#C0C0C0');
    cellText(`${label}`, ap3X, yPos, ap3W * 0.5, apLineH, DARK_BLUE, 6, true);
    doc.save().fillColor(apColor(apObj.status)).font('Helvetica-Bold').fontSize(6)
       .text(apStatus(apObj.status), ap3X + ap3W * 0.5, yPos + 3, { width: ap3W * 0.5 - 4 });
    doc.restore();
  };

  let apY = y;
  drawApprovalRow('Principal/HM :', hmA,  LIGHT_BLUE, apY); apY += apLineH;
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

  // Footer — below the entire signature block
  const footerY = Math.max(apY + apLineH + 4, y + 40 + 4);
  doc.save().fillColor(DARK_BLUE).font('Helvetica').fontSize(6)
     .text('Kushal Chhattisgarh System Generated   |   NSQF Chhattisgarh Project   |   Learnet Skills Limited',
           ML, footerY, { width: PW, align: 'center' });
  doc.restore();

  doc.end();
};

module.exports = { sendExcel, sendPDF, sendNSQFPdf };