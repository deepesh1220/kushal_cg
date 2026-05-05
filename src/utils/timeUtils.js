/**
 * timeUtils.js
 * Utility helpers for handling IST (Asia/Kolkata, UTC+5:30) timezone formatting.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5h 30m in milliseconds

/**
 * Converts a Date object or date string to an IST-formatted ISO string.
 * Example output: "2026-05-05T12:57:54.240+05:30"
 *
 * @param {Date|string|null} date
 * @returns {string|null}
 */
const toIST = (date) => {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;

  const istMs = d.getTime() + IST_OFFSET_MS;
  const istDate = new Date(istMs);

  // Build ISO string manually and append +05:30 offset
  const pad = (n, len = 2) => String(n).padStart(len, '0');

  const year   = istDate.getUTCFullYear();
  const month  = pad(istDate.getUTCMonth() + 1);
  const day    = pad(istDate.getUTCDate());
  const hour   = pad(istDate.getUTCHours());
  const min    = pad(istDate.getUTCMinutes());
  const sec    = pad(istDate.getUTCSeconds());
  const ms     = pad(istDate.getUTCMilliseconds(), 3);

  return `${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}+05:30`;
};

/**
 * Formats an attendance record's timestamp fields to IST.
 * Returns a new object with check_in_time, check_out_time, created_at, updated_at in IST.
 *
 * @param {object} record
 * @returns {object}
 */
const formatAttendanceRecord = (record) => {
  if (!record) return record;
  return {
    ...record,
    check_in_time:     toIST(record.check_in_time),
    check_out_time:    toIST(record.check_out_time),
    created_at:        toIST(record.created_at),
    updated_at:        toIST(record.updated_at),
  };
};

module.exports = { toIST, formatAttendanceRecord };
