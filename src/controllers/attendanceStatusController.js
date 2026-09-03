const { pool } = require('../config/db');
const User = require('../models/User');

const STATUS_CONDITIONS = {
  present: `attendance_status IN ('present', 'late', 'half_day')`,
  absent: `attendance_status NOT IN ('present', 'late', 'half_day', 'on_leave', 'od')`,
  on_leave: `attendance_status = 'on_leave'`,
  on_duty: `attendance_status = 'od'`,
};

const resolveScope = async (req, role) => {
  if (role === 'vtp') {
    const vtpId = String(req.user?.vtp_id || '').trim();
    if (!vtpId) throw Object.assign(new Error('Your account is not linked to a VTP ID.'), { statusCode: 400 });
    return { role, vtpId };
  }
  if (role === 'headmaster') {
    const udiseCode = String(req.user?.udise_code || '').trim();
    if (!udiseCode) throw Object.assign(new Error('Your account is not linked to a school.'), { statusCode: 400 });
    return { role, udiseCode };
  }
  const user = await User.findById(req.user.id);
  if (!user) throw Object.assign(new Error('User not found.'), { statusCode: 404 });
  let deo = null;
  if (user.email) deo = (await pool.query('SELECT district_cd, district_name FROM mst_deo WHERE email = $1 LIMIT 1', [user.email])).rows[0];
  if (!deo && user.phone) deo = (await pool.query('SELECT district_cd, district_name FROM mst_deo WHERE mobile = $1 LIMIT 1', [user.phone])).rows[0];
  if (!deo?.district_cd) throw Object.assign(new Error('Your account is not linked to a district.'), { statusCode: 400 });
  return { role, districtCd: Number(deo.district_cd), districtName: deo.district_name || '' };
};

const parseOptionalCode = (value, name) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const code = Number(raw);
  if (!Number.isInteger(code) || code < 1) throw Object.assign(new Error(`A valid ${name} is required.`), { statusCode: 400 });
  return code;
};

const buildCte = (scope, query) => {
  const params = [];
  const filters = [];
  const add = (value, expression) => { params.push(value); filters.push(expression.replace('?', `$${params.length}`)); };
  if (scope.role === 'vtp') add(scope.vtpId, `TRIM(COALESCE(u.vtp_id::text, v.vtp_id::text, '')) = TRIM(?::text)`);
  if (scope.role === 'deo') add(scope.districtCd, 's.district_cd = ?');
  if (scope.role === 'headmaster') add(scope.udiseCode, 'CAST(s.udise_sch_code AS TEXT) = TRIM(?::text)');

  const districtCd = scope.role === 'deo' ? scope.districtCd : parseOptionalCode(query.district_cd, 'district_cd');
  const blockCd = scope.role === 'headmaster' ? null : parseOptionalCode(query.block_cd, 'block_cd');
  if (scope.role === 'vtp' && districtCd) add(districtCd, 's.district_cd = ?');
  if (blockCd) add(blockCd, 's.block_cd = ?');

  const cte = `WITH eligible_vts AS (
    SELECT DISTINCT ON (u.id) u.id AS user_id, u.name, u.email, s.udise_sch_code,
      s.school_name, s.district_cd, s.district_name, s.block_cd, s.block_name
    FROM users u
    JOIN roles r ON r.id = u.role_id AND r.name = 'vocational_teacher'
    LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
    JOIN mst_schools s ON CAST(s.udise_sch_code AS TEXT) = CAST(COALESCE(v.udise_code, u.udise_code) AS TEXT)
    WHERE u.is_active = TRUE AND s.vtp = 1 AND ${filters.join(' AND ')}
    ORDER BY u.id
  ), daily_status AS (
    SELECT ev.*, COALESCE(ar.status, 'absent') AS attendance_status
    FROM eligible_vts ev LEFT JOIN attendance_records ar ON ar.user_id = ev.user_id AND ar.date = CURRENT_DATE
  )`;
  return { cte, params, districtCd, blockCd };
};

const groupColumns = (scope, districtCd, blockCd) => {
  if (scope.role === 'headmaster' || blockCd) return { code: 'udise_sch_code::text', name: `COALESCE(NULLIF(TRIM(school_name), ''), udise_sch_code::text)`, type: 'school' };
  if (scope.role === 'deo' || districtCd) return { code: 'block_cd::text', name: `COALESCE(NULLIF(TRIM(block_name), ''), 'Unknown Block')`, type: 'block' };
  return { code: 'district_cd::text', name: `COALESCE(NULLIF(TRIM(district_name), ''), 'Unknown District')`, type: 'district' };
};

const sendError = (res, error, action) => {
  console.error(`${action} error:`, error.message);
  return res.status(error.statusCode || 500).json({ status: false, message: error.statusCode ? error.message : `Server error ${action}.` });
};

const createAttendanceStatusHandlers = (role) => ({
  getStatus: async (req, res) => {
    try {
      const scope = await resolveScope(req, role);
      const { cte, params, districtCd, blockCd } = buildCte(scope, req.query);
      const group = groupColumns(scope, districtCd, blockCd);
      const [countsResult, chartResult] = await Promise.all([
        pool.query(`${cte} SELECT COUNT(*)::int total_vts,
          COUNT(*) FILTER (WHERE ${STATUS_CONDITIONS.present})::int total_present,
          COUNT(*) FILTER (WHERE ${STATUS_CONDITIONS.absent})::int total_absent,
          COUNT(*) FILTER (WHERE ${STATUS_CONDITIONS.on_leave})::int on_leave,
          COUNT(*) FILTER (WHERE ${STATUS_CONDITIONS.on_duty})::int on_duty FROM daily_status`, params),
        pool.query(`${cte} SELECT ${group.code} code, ${group.name} name, COUNT(*)::int total_vts,
          COUNT(*) FILTER (WHERE ${STATUS_CONDITIONS.present})::int present
          FROM daily_status GROUP BY ${group.code}, ${group.name} ORDER BY ${group.name}`, params),
      ]);
      const rows = chartResult.rows;
      return res.json({ status: true, message: 'Attendance status fetched successfully.', data: {
        as_of_date: new Date().toISOString().slice(0, 10),
        filters: { district_cd: districtCd, block_cd: blockCd }, counts: countsResult.rows[0],
        chart: { group_by: group.type, categories: rows.map(x => x.name), total_vts: rows.map(x => x.total_vts), present: rows.map(x => x.present) },
      }});
    } catch (error) { return sendError(res, error, 'fetching attendance status'); }
  },
  getVts: async (req, res) => {
    try {
      const status = String(req.query.status || '').trim().toLowerCase();
      if (!STATUS_CONDITIONS[status]) return res.status(400).json({ status: false, message: 'status must be present, absent, on_leave, or on_duty.' });
      const scope = await resolveScope(req, role);
      const { cte, params } = buildCte(scope, req.query);
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const total = Number((await pool.query(`${cte} SELECT COUNT(*)::int total FROM daily_status WHERE ${STATUS_CONDITIONS[status]}`, params)).rows[0].total);
      const dataParams = [...params, limit, (page - 1) * limit];
      const rows = (await pool.query(`${cte} SELECT user_id, district_name, block_name, udise_sch_code, school_name, name, email
        FROM daily_status WHERE ${STATUS_CONDITIONS[status]} ORDER BY district_name, block_name, school_name, name
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams)).rows;
      return res.json({ status: true, data: { status, total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)), rows } });
    } catch (error) { return sendError(res, error, 'fetching attendance VT list'); }
  },
  getOptions: async (req, res) => {
    try {
      const scope = await resolveScope(req, role);
      const type = String(req.query.type || '').trim();
      if (!['districts', 'blocks'].includes(type)) return res.status(400).json({ status: false, message: 'type must be districts or blocks.' });
      let result;
      if (type === 'districts') {
        if (role !== 'vtp') return res.json({ status: true, data: scope.districtCd ? [{ district_cd: scope.districtCd, district_name: scope.districtName }] : [] });
        result = await pool.query(`SELECT DISTINCT s.district_cd, s.district_name FROM vt_staff_details v JOIN mst_schools s ON s.udise_sch_code::text=v.udise_code::text WHERE TRIM(v.vtp_id)=TRIM($1::text) ORDER BY s.district_name`, [scope.vtpId]);
      } else {
        const districtCd = role === 'deo' ? scope.districtCd : parseOptionalCode(req.query.district_cd, 'district_cd');
        if (!districtCd) return res.status(400).json({ status: false, message: 'district_cd is required.' });
        const values = role === 'vtp' ? [scope.vtpId, districtCd] : [districtCd];
        const vtpJoin = role === 'vtp' ? `JOIN vt_staff_details v ON v.udise_code::text=s.udise_sch_code::text` : '';
        const vtpWhere = role === 'vtp' ? `AND TRIM(v.vtp_id)=TRIM($1::text)` : '';
        const districtParam = role === 'vtp' ? '$2' : '$1';
        result = await pool.query(`SELECT DISTINCT s.block_cd, s.block_name FROM mst_schools s ${vtpJoin} WHERE s.district_cd=${districtParam} ${vtpWhere} AND s.vtp=1 ORDER BY s.block_name`, values);
      }
      return res.json({ status: true, data: result?.rows || [] });
    } catch (error) { return sendError(res, error, 'fetching attendance location options'); }
  },
});

module.exports = { createAttendanceStatusHandlers };
