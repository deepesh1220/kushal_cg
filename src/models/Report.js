const { pool } = require('../config/db');
const dayjs = require('dayjs');

// In-memory cache for holidays
const holidayCache = {};
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

class Report {
  // Fetch official (master) holidays from local mst_holiday table
  static async _getGovHolidays(year) {
    if (holidayCache[year] && Date.now() - holidayCache[year].fetchedAt < CACHE_TTL_MS) {
      return holidayCache[year].data;
    }
    try {
      const { rows } = await pool.query(
        `SELECT holiday_date FROM mst_holiday WHERE year = $1`, [year]
      );
      const holidayDates = new Set(
        rows.map(r => dayjs(r.holiday_date).format('YYYY-MM-DD'))
      );
      holidayCache[year] = { data: holidayDates, fetchedAt: Date.now() };
      return holidayDates;
    } catch (err) {
      console.error('Error fetching gov holidays from DB:', err.message);
      return new Set();
    }
  }

  // Fetch school-declared holidays for a specific UDISE code + date range
  static async _getSchoolHolidays(udiseCode, startDate, endDate) {
    if (!udiseCode) return new Set();
    try {
      const { rows } = await pool.query(
        `SELECT generated_holiday_date FROM school_generated_holidays
         WHERE udise_code = $1 AND generated_holiday_date BETWEEN $2 AND $3`,
        [udiseCode, startDate, endDate]
      );
      return new Set(
        rows.map(r => dayjs(r.generated_holiday_date).format('YYYY-MM-DD'))
      );
    } catch (err) {
      console.error('Error fetching school holidays from DB:', err.message);
      return new Set();
    }
  }

  static async getMonthlySummaryReport(filters) {
    const { month, udise_code, vtUserId, page = 1, limit = 50 } = filters;

    if (!month) {
      throw new Error("Month is required (YYYY-MM)");
    }

    const [year, monthNum] = month.split("-").map(Number);
    const startDate = dayjs(`${month}-01`).startOf("month");
    const endDate = dayjs(`${month}-01`).endOf("month");
    const today = dayjs();

    if (startDate.isAfter(today, "month")) {
      throw new Error("Future month not allowed");
    }

    const isCurrentMonth = today.year() === year && today.month() + 1 === monthNum;
    const lastDay = isCurrentMonth ? today.date() : endDate.date();

    // 1. Fetch Users
    const offset = (page - 1) * limit;
    let queryArgs = [];
    let whereClauses = ["r.name = 'vocational_teacher'"];

    if (udise_code) {
      queryArgs.push(udise_code);
      whereClauses.push(`u.udise_code = $${queryArgs.length}`);
    }
    if (vtUserId) {
      queryArgs.push(vtUserId);
      whereClauses.push(`(u.id = $${queryArgs.length} OR u.vt_staff_id = $${queryArgs.length})`);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) 
      FROM users u
      JOIN roles r ON u.role_id = r.id
      ${whereStr}
    `;
    const totalResult = await pool.query(countQuery, queryArgs);
    const totalRecords = parseInt(totalResult.rows[0].count, 10);

    const userQuery = `
      SELECT u.id, u.name, u.email, u.phone, u.udise_code, 
             v.school_name, v.district_name, v.block_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN vt_staff_details v ON u.vt_staff_id = v.id
      ${whereStr}
      ORDER BY u.name ASC
      LIMIT $${queryArgs.length + 1} OFFSET $${queryArgs.length + 2}
    `;

    const userResult = await pool.query(userQuery, [...queryArgs, limit, offset]);
    const users = userResult.rows;

    if (users.length === 0) {
      return {
        data: [],
        pagination: { totalRecords, totalPages: 0, currentPage: page, limit }
      };
    }

    const userIds = users.map(u => u.id);

    // 2. Fetch Attendance
    const attendanceResult = await pool.query(`
      SELECT user_id, date, status, check_in_time, check_out_time
      FROM attendance_records
      WHERE user_id = ANY($1)
      AND date BETWEEN $2 AND $3
    `, [userIds, startDate.format("YYYY-MM-DD"), endDate.format("YYYY-MM-DD")]);

    const attendanceMap = {}; // { userId: { date: record } }
    attendanceResult.rows.forEach(r => {
      const uId = r.user_id;
      const dateStr = dayjs(r.date).format("YYYY-MM-DD");
      if (!attendanceMap[uId]) attendanceMap[uId] = {};
      attendanceMap[uId][dateStr] = r;
    });

    // 3. Fetch Leaves
    const leaveResult = await pool.query(`
      SELECT user_id, from_date, to_date
      FROM leave_requests
      WHERE user_id = ANY($1)
      AND status = 'approved'
      AND from_date <= $3
      AND to_date >= $2
    `, [userIds, startDate.format("YYYY-MM-DD"), endDate.format("YYYY-MM-DD")]);

    const leaveMap = {}; // { userId: Set(dates) }
    leaveResult.rows.forEach(l => {
      const uId = l.user_id;
      if (!leaveMap[uId]) leaveMap[uId] = new Set();

      let current = dayjs(l.from_date);
      const end = dayjs(l.to_date);
      while (current.isBefore(end) || current.isSame(end)) {
        leaveMap[uId].add(current.format("YYYY-MM-DD"));
        current = current.add(1, "day");
      }
    });

    // 4. Fetch Gov Holidays
    const govHolidays = await Report._getGovHolidays(year);

    // 4b. Fetch School-Declared Holidays per UDISE code
    const udiseCodes = [...new Set(users.map(u => u.udise_code).filter(Boolean))];
    const schoolHolidayMap = {}; // { udise_code: Set(dateStr) }
    await Promise.all(udiseCodes.map(async (uc) => {
      schoolHolidayMap[uc] = await Report._getSchoolHolidays(
        uc, startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD')
      );
    }));

    // 5. Build Report
    const reportData = users.map(user => {
      const uId = user.id;
      const monthAttendance = {};
      const userSchoolHolidays = schoolHolidayMap[user.udise_code] || new Set();

      for (let day = 1; day <= lastDay; day++) {
        const dateObj = dayjs(`${month}-${day}`);
        const dateStr = dateObj.format("YYYY-MM-DD");

        const isSunday = dateObj.day() === 0;
        const isGovHoliday = govHolidays.has(dateStr);
        const isSchoolHoliday = userSchoolHolidays.has(dateStr);
        const hasLeave = leaveMap[uId] && leaveMap[uId].has(dateStr);
        const attRecord = attendanceMap[uId] && attendanceMap[uId][dateStr];

        let statusStr = "A";
        let check_in = null;
        let check_out = null;

        if (attRecord) {
          if (attRecord.check_in_time) check_in = dayjs(attRecord.check_in_time).format('hh:mm A');
          if (attRecord.check_out_time) check_out = dayjs(attRecord.check_out_time).format('hh:mm A');

          if (attRecord.status === 'present') statusStr = 'P';
          else if (attRecord.status === 'absent') statusStr = 'A';
          else if (attRecord.status === 'half_day') statusStr = 'HD';
          else if (attRecord.status === 'late') statusStr = 'LATE';
          else if (attRecord.status === 'od') statusStr = 'OD';
          else statusStr = 'P';
        }

        if (isSunday && (!attRecord || statusStr === 'A')) {
          statusStr = "H";
        } else if (isGovHoliday && (!attRecord || statusStr === 'A')) {
          statusStr = "GH";
        } else if (isSchoolHoliday && (!attRecord || statusStr === 'A')) {
          statusStr = "SH";
        } else if (hasLeave) {
          statusStr = "L";
        }

        monthAttendance[day] = {
          status: statusStr,
          check_in,
          check_out
        };
      }

      return {
        ...user,
        attendance: monthAttendance
      };
    });

    return {
      data: reportData,
      pagination: {
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        currentPage: page,
        limit
      }
    };
  }

  static async getAttendanceReport(userId, month) {
    if (!month) {
      throw new Error("Month is required (YYYY-MM)");
    }

    const [year, monthNum] = month.split("-").map(Number);

    const startDate = dayjs(`${month}-01`).startOf("month");
    const endDate = dayjs(`${month}-01`).endOf("month");

    const today = dayjs();

    const userResult = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        COALESCE(v.vt_email, u.email) AS email,
        COALESCE(v.udise_code, u.udise_code) AS udise_code,
        v.district_name,
        v.block_name,
        v.trade,
        v.vtp_name
      FROM users u
      LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
      WHERE u.id = $1
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error("User not found");
    }

    const user = userResult.rows[0];

    // 🔴 Prevent future month
    if (startDate.isAfter(today, "month")) {
      throw new Error("Future month not allowed");
    }

    // 🔴 If current month → limit till today
    const isCurrentMonth =
      today.year() === year && today.month() + 1 === monthNum;

    const lastDay = isCurrentMonth ? today.date() : endDate.date();

    // ─────────── Fetch attendance ───────────
    const attendanceResult = await pool.query(
      `
      SELECT date
      FROM attendance_records
      WHERE user_id = $1
      AND date BETWEEN $2 AND $3
    `,
      [userId, startDate.format("YYYY-MM-DD"), endDate.format("YYYY-MM-DD")]
    );

    // Convert to Set for fast lookup
    const attendanceSet = new Set(
      attendanceResult.rows.map((r) =>
        dayjs(r.date).format("YYYY-MM-DD")
      )
    );

    // ─────────── Fetch leaves ───────────
    const leaveResult = await pool.query(
      `
      SELECT from_date, to_date
      FROM leave_requests
      WHERE user_id = $1
      AND status = 'approved'
      AND from_date <= $3
      AND to_date >= $2
    `,
      [userId, startDate.format("YYYY-MM-DD"), endDate.format("YYYY-MM-DD")]
    );

    // Expand leave dates
    const leaveSet = new Set();

    leaveResult.rows.forEach((leave) => {
      let current = dayjs(leave.from_date);
      const end = dayjs(leave.to_date);

      while (current.isBefore(end) || current.isSame(end)) {
        leaveSet.add(current.format("YYYY-MM-DD"));
        current = current.add(1, "day");
      }
    });

    // ─────────── Build final attendance map ───────────
    const attendanceMap = {};

    for (let day = 1; day <= lastDay; day++) {
      const date = dayjs(`${month}-${day}`).format("YYYY-MM-DD");

      if (attendanceSet.has(date)) {
        attendanceMap[day] = "P";
      } else if (leaveSet.has(date)) {
        attendanceMap[day] = "L";
      } else {
        attendanceMap[day] = "A";
      }
    }

    return {
      userId,
      employeeName: user.name,
      employeeEmail: user.email,
      udiseCode: user.udise_code,
      districtName: user.district_name,
      blockName: user.block_name,
      trade: user.trade,
      vtpName: user.vtp_name,
      month,
      totalDays: lastDay,
      attendance: attendanceMap,
    };
  }
}

module.exports = Report;
