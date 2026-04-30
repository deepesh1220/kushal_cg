const axios = require('axios');

// In-memory cache: { year: { data, fetchedAt } }
const cache = {};
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch India holidays from Calendarific for a given year.
 * Optionally filter to Chhattisgarh-specific entries if available.
 */
const getHolidays = async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();

  // ── Validate year ──────────────────────────────────────────────────────────
  if (year < 2000 || year > 2100) {
    return res.status(400).json({ success: false, message: 'Invalid year. Use 2000–2100.' });
  }

  // ── Serve from cache if fresh ──────────────────────────────────────────────
  const cached = cache[year];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return res.json({ success: true, year, total: cached.data.length, data: cached.data, source: 'cache' });
  }

  // ── Check API key ──────────────────────────────────────────────────────────
  const apiKey = process.env.CALENDARIFIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'CALENDARIFIC_API_KEY is not configured in .env' });
  }

  try {
    const BASE_PARAMS = { api_key: apiKey, country: 'IN', year };

    // ── Two parallel calls ───────────────────────────────────────────────────
    // 1. National holidays — all of India (no location filter)
    // 2. State/local holidays — Chhattisgarh only (ISO 3166-2: IN-CT)
    const [nationalRes, stateRes] = await Promise.allSettled([
      axios.get('https://calendarific.com/api/v2/holidays', {
        params: { ...BASE_PARAMS, type: 'national' },
        timeout: 10000,
      }),
      axios.get('https://calendarific.com/api/v2/holidays', {
        params: { ...BASE_PARAMS, type: 'local', location: 'IN-CT' },
        timeout: 10000,
      }),
    ]);

    const nationalHolidays = nationalRes.status === 'fulfilled'
      ? (nationalRes.value.data?.response?.holidays || [])
      : [];
    const stateHolidays = stateRes.status === 'fulfilled'
      ? (stateRes.value.data?.response?.holidays || [])
      : [];

    console.log(`📅 Calendarific: ${nationalHolidays.length} national + ${stateHolidays.length} state holidays fetched for ${year}`);

    // ── Normalise a raw Calendarific holiday ─────────────────────────────────
    const normalise = (h, category) => ({
      name:         h.name,
      description:  h.description || '',
      date:         h.date?.iso || '',
      day:          h.date?.datetime
        ? `${h.date.datetime.year}-${String(h.date.datetime.month).padStart(2, '0')}-${String(h.date.datetime.day).padStart(2, '0')}`
        : null,
      type:         Array.isArray(h.type) ? h.type.join(', ') : (h.type || 'National'),
      primary_type: Array.isArray(h.primary_type)
        ? h.primary_type[0]
        : (h.primary_type || h.type?.[0] || 'Holiday'),
      category,     // 'national' | 'state'
    });

    const nationalNorm = nationalHolidays.map(h => normalise(h, 'national'));
    const stateNorm    = stateHolidays.map(h => normalise(h, 'state'));

    // ── Merge + deduplicate by date + name ───────────────────────────────────
    const seen = new Set();
    const merged = [...nationalNorm, ...stateNorm].filter(h => {
      const key = `${h.day || h.date}__${h.name.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    // ── Store in cache ────────────────────────────────────────────────────────
    cache[year] = { data: merged, fetchedAt: Date.now() };

    return res.json({ success: true, year, total: merged.length, data: merged, source: 'api' });

  } catch (err) {
    console.error('❌ Calendarific API error:', err.message);

    // If Calendarific is down but we have stale cache, serve it
    if (cached) {
      return res.json({ success: true, year, total: cached.data.length, data: cached.data, source: 'stale_cache', warning: 'API unavailable; serving stale data' });
    }

    const status = err.response?.status || 503;
    const message = err.response?.data?.meta?.error_detail || err.message || 'Failed to fetch holidays';
    return res.status(status).json({ success: false, message });
  }
};

/**
 * Clear cache for a specific year or all years (admin utility).
 * DELETE /api/holidays?year=YYYY  or  DELETE /api/holidays
 */
const clearCache = (req, res) => {
  const year = req.query.year;
  if (year) {
    delete cache[parseInt(year)];
    return res.json({ success: true, message: `Cache cleared for ${year}` });
  }
  Object.keys(cache).forEach(k => delete cache[k]);
  return res.json({ success: true, message: 'All holiday cache cleared' });
};

module.exports = { getHolidays, clearCache };
