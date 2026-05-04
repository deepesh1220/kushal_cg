const { pool } = require('../config/db');
const dayjs = require('dayjs');
const axios = require('axios');

// In-memory cache for holidays
const holidayCache = {};
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

class Report {
  static async _getGovHolidays(year) {
    if (holidayCache[year] && Date.now() - holidayCache[year].fetchedAt < CACHE_TTL_MS) {
      return holidayCache[year].data;
    }
    const apiKey = process.env.CALENDARIFIC_API_KEY;
    if (!apiKey) return []; // Fallback if no key

    try {
      const BASE_PARAMS = { api_key: apiKey, country: 'IN', year };
      const [nationalRes, stateRes] = await Promise.allSettled([
        axios.get('https://calendarific.com/api/v2/holidays', { params: { ...BASE_PARAMS, type: 'national' }, timeout: 5000 }),
        axios.get('https://calendarific.com/api/v2/holidays', { params: { ...BASE_PARAMS, type: 'local', location: 'IN-CT' }, timeout: 5000 }),
      ]);

      const national = nationalRes.status === 'fulfilled' ? (nationalRes.value.data?.response?.holidays || []) : [];
      const state = stateRes.status === 'fulfilled' ? (stateRes.value.data?.response?.holidays || []) : [];

      const merged = [...national, ...state];
      const holidayDates = new Set();
      merged.forEach(h => {
        const dateStr = h.date?.iso || (h.date?.datetime ? `${h.date.datetime.year}-${String(h.date.datetime.month).padStart(2, '0')}-${String(h.date.datetime.day).padStart(2, '0')}` : null);
        if (dateStr) holidayDates.add(dateStr.split('T')[0]); // Keep only YYYY-MM-DD
      });

      holidayCache[year] = { data: holidayDates, fetchedAt: Date.now() };
      return holidayDates;
    } catch (err) {
      console.error('Error fetching holidays for report:', err.message);
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
      whereClauses.push(`u.id = $${queryArgs.length}`);
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
      SELECT user_id, date, status
      FROM attendance_records
      WHERE user_id = ANY($1)
      AND date BETWEEN $2 AND $3
    `, [userIds, startDate.format("YYYY-MM-DD"), endDate.format("YYYY-MM-DD")]);

    const attendanceMap = {}; // { userId: { date: status } }
    attendanceResult.rows.forEach(r => {
      const uId = r.user_id;
      const dateStr = dayjs(r.date).format("YYYY-MM-DD");
      if (!attendanceMap[uId]) attendanceMap[uId] = {};
      attendanceMap[uId][dateStr] = r.status;
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

    // 5. Build Report
    const reportData = users.map(user => {
      const uId = user.id;
      const monthAttendance = {};

      for (let day = 1; day <= lastDay; day++) {
        const dateObj = dayjs(`${month}-${day}`);
        const dateStr = dateObj.format("YYYY-MM-DD");

        const isSunday = dateObj.day() === 0;
        const isGovHoliday = govHolidays.has(dateStr);
        const hasLeave = leaveMap[uId] && leaveMap[uId].has(dateStr);
        const isPresent = attendanceMap[uId] && attendanceMap[uId][dateStr] === 'present';

        if (isSunday) {
          monthAttendance[day] = "H";
        } else if (isGovHoliday) {
          monthAttendance[day] = "GH";
        } else if (hasLeave) {
          monthAttendance[day] = "L";
        } else if (isPresent) {
          monthAttendance[day] = "P";
        } else {
          monthAttendance[day] = "A";
        }
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
      month,
      totalDays: lastDay,
      attendance: attendanceMap,
    };
  }
}

module.exports = Report;
