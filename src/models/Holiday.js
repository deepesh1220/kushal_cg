const { pool } = require('../config/db');

// ── Month name lookup ─────────────────────────────────────────────────────────
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ═══════════════════════════════════════════════════════════════════════════════
// Holiday Model — static methods for mst_holiday & school_generated_holidays
// ═══════════════════════════════════════════════════════════════════════════════
class Holiday {

  // ── Master Holidays ──────────────────────────────────────────────────────────

  /**
   * Fetch all master holidays, optionally filtered by year.
   */
  static async getAllMasterHolidays(year) {
    let query = 'SELECT * FROM mst_holiday';
    const params = [];

    if (year) {
      query += ' WHERE year = $1';
      params.push(parseInt(year));
    }

    query += ' ORDER BY holiday_date ASC';
    const { rows } = await pool.query(query, params);
    return rows;
  }

  /**
   * Insert a new master holiday.
   * Derives month_name, year, weekday_name from holiday_date.
   */
  static async createMasterHoliday({ holiday_date, holiday_name }) {
    const dateObj = new Date(holiday_date);

    if (isNaN(dateObj.getTime())) {
      throw new Error('Invalid date format');
    }

    const month_name = MONTHS[dateObj.getMonth()];
    const year = dateObj.getFullYear();
    const weekday_name = WEEKDAYS[dateObj.getDay()];

    const { rows } = await pool.query(
      `INSERT INTO mst_holiday (holiday_date, month_name, year, holiday_name, weekday_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [holiday_date, month_name, year, holiday_name, weekday_name]
    );

    return rows[0];
  }

  // ── School Generated Holidays ────────────────────────────────────────────────

  /**
   * Fetch all generated holidays for a specific school (by UDISE code).
   */
  static async getGeneratedHolidays(udise_code) {
    const { rows } = await pool.query(
      `SELECT * FROM school_generated_holidays
       WHERE udise_code = $1
       ORDER BY generated_holiday_date DESC`,
      [udise_code]
    );
    return rows;
  }

  /**
   * Insert a new school-generated holiday.
   */
  static async createGeneratedHoliday({
    principal_name,
    principal_mobile_number,
    udise_code,
    school_name,
    holiday_description,
    generated_holiday_date,
    remarks,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO school_generated_holidays
         (principal_name, principal_mobile_number, udise_code, school_name,
          holiday_description, generated_holiday_date, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        principal_name,
        principal_mobile_number,
        udise_code,
        school_name,
        holiday_description,
        generated_holiday_date,
        remarks || null,
      ]
    );
    return rows[0];
  }
}

module.exports = Holiday;
