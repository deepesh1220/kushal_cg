require('dotenv').config();
const { pool } = require('../config/db');

const seedDummyHoliday = async () => {
  try {
    const result = await pool.query(`
      INSERT INTO mst_holiday
        (holiday_date, month_name, year, holiday_name, weekday_name)
      VALUES
        ('2026-10-02', 'October', 2026, 'Gandhi Jayanti', 'Friday')
      ON CONFLICT (holiday_date, holiday_name) DO NOTHING
      RETURNING holiday_id
    `);
    console.log(result.rowCount ? 'Dummy holiday inserted.' : 'Dummy holiday already exists.');
  } finally {
    await pool.end();
  }
};

seedDummyHoliday().catch((error) => {
  console.error('Dummy holiday insert failed:', error.message);
  process.exitCode = 1;
});
