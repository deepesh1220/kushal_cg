const Holiday = require('../models/Holiday');

// ═══════════════════════════════════════════════════════════════════════════════
// Master Holiday Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/holidays?year=YYYY
 * Fetch all master holidays, optionally filtered by year.
 */
const getMasterHolidays = async (req, res) => {
  try {
    const { year } = req.query;

    if (year && (isNaN(year) || year < 2000 || year > 2100)) {
      return res.status(400).json({ success: false, message: 'Invalid year. Use 2000–2100.' });
    }

    const holidays = await Holiday.getAllMasterHolidays(year || null);

    return res.json({
      success: true,
      total: holidays.length,
      data: holidays,
    });
  } catch (err) {
    console.error('❌ getMasterHolidays error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch holidays' });
  }
};

/**
 * POST /api/holidays
 * Insert a new master holiday (admin-only).
 * Body: { holiday_date, holiday_name }
 */
const createMasterHoliday = async (req, res) => {
  try {
    const { holiday_date, holiday_name } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!holiday_date) {
      return res.status(400).json({ success: false, message: 'Holiday date is required' });
    }
    if (!holiday_name || !holiday_name.trim()) {
      return res.status(400).json({ success: false, message: 'Holiday name is required' });
    }

    const dateObj = new Date(holiday_date);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    const holiday = await Holiday.createMasterHoliday({
      holiday_date,
      holiday_name: holiday_name.trim(),
    });

    return res.status(201).json({
      success: true,
      message: 'Master holiday created successfully',
      data: holiday,
    });
  } catch (err) {
    // Handle unique constraint violation (duplicate date + name)
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A holiday with this date and name already exists',
      });
    }
    console.error('❌ createMasterHoliday error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create holiday' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// School Generated Holiday Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/holidays/generated/:udise_code
 * Fetch all generated holidays for a specific school.
 */
const getGeneratedHolidays = async (req, res) => {
  try {
    const { udise_code } = req.params;

    if (!udise_code) {
      return res.status(400).json({ success: false, message: 'UDISE code is required' });
    }

    const holidays = await Holiday.getGeneratedHolidays(udise_code);

    return res.json({
      success: true,
      total: holidays.length,
      data: holidays,
    });
  } catch (err) {
    console.error('❌ getGeneratedHolidays error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch generated holidays' });
  }
};

/**
 * POST /api/holidays/generated
 * Principal declares a school-specific holiday.
 * Body: { principal_name, principal_mobile_number, udise_code, school_name,
 *         holiday_description, generated_holiday_date, remarks }
 */
const createGeneratedHoliday = async (req, res) => {
  try {
    const {
      principal_name,
      principal_mobile_number,
      udise_code,
      school_name,
      holiday_description,
      generated_holiday_date,
      remarks,
    } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    const errors = [];

    if (!principal_name || !principal_name.trim()) {
      errors.push('Principal name is required');
    }
    if (!principal_mobile_number) {
      errors.push('Principal mobile number is required');
    } else if (!/^\d{10}$/.test(String(principal_mobile_number).replace(/\D/g, ''))) {
      errors.push('Mobile number must be a valid 10-digit number');
    }
    if (!udise_code) {
      errors.push('UDISE code is required');
    }
    if (!school_name || !school_name.trim()) {
      errors.push('School name is required');
    }
    if (!holiday_description || !holiday_description.trim()) {
      errors.push('Holiday description is required');
    }
    if (!generated_holiday_date) {
      errors.push('Holiday date is required');
    } else {
      const dateObj = new Date(generated_holiday_date);
      if (isNaN(dateObj.getTime())) {
        errors.push('Invalid date format');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors.join(', '), errors });
    }

    const holiday = await Holiday.createGeneratedHoliday({
      principal_name: principal_name.trim(),
      principal_mobile_number: String(principal_mobile_number).replace(/\D/g, ''),
      udise_code: String(udise_code).trim(),
      school_name: school_name.trim(),
      holiday_description: holiday_description.trim(),
      generated_holiday_date,
      remarks: remarks?.trim() || null,
    });

    return res.status(201).json({
      success: true,
      message: 'School holiday declared successfully',
      data: holiday,
    });
  } catch (err) {
    // Handle unique constraint violation (same school + same date)
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A holiday is already declared for this school on the selected date',
      });
    }
    console.error('❌ createGeneratedHoliday error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to declare holiday' });
  }
};

module.exports = {
  getMasterHolidays,
  createMasterHoliday,
  getGeneratedHolidays,
  createGeneratedHoliday,
};
