const { pool } = require('../config/db');

const pagination = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 10));
  return { page, limit, offset: (page - 1) * limit };
};

const listRequests = async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const status = String(req.query.status || 'pending').toLowerCase();
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
      return res.status(400).json({ status: false, message: 'Invalid status filter.' });
    }
    const search = String(req.query.search || '').trim().slice(0, 200);
    const params = [];
    const conditions = [];
    if (status !== 'all') { params.push(status); conditions.push(`r.status = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(v.vt_name ILIKE $${params.length} OR v.teacher_code ILIKE $${params.length} OR v.vt_email ILIKE $${params.length}
        OR v.vtp_name ILIKE $${params.length} OR r.requested_school_name ILIKE $${params.length}
        OR CAST(r.requested_udise_code AS TEXT) ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM vt_location_update_requests r
      JOIN vt_staff_details v ON v.id=r.vt_staff_id ${where}`, params);
    const totalItems = count.rows[0]?.total || 0;
    const dataParams = [...params, limit, offset];
    const result = await pool.query(`SELECT r.*, v.teacher_code, v.vt_name, v.vt_email, v.vt_mob, v.vtp_name
      FROM vt_location_update_requests r JOIN vt_staff_details v ON v.id=r.vt_staff_id
      ${where} ORDER BY CASE WHEN r.status='pending' THEN 0 ELSE 1 END, r.requested_at DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams);
    return res.json({ status: true, data: result.rows, pagination: {
      currentPage: page, pageSize: limit, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    } });
  } catch (error) {
    console.error('listVtLocationUpdateRequests error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to load VT updation requests.' });
  }
};

const reviewRequest = async (req, res) => {
  const requestId = Number.parseInt(req.params.requestId, 10);
  const status = String(req.body?.status || '').toLowerCase();
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim() || null : null;
  if (!Number.isInteger(requestId) || requestId <= 0) return res.status(400).json({ status: false, message: 'Invalid request ID.' });
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ status: false, message: 'Status must be approved or rejected.' });
  if (remarks?.length > 1000) return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM vt_location_update_requests WHERE id=$1 FOR UPDATE', [requestId]);
    const request = found.rows[0];
    if (!request) { await client.query('ROLLBACK'); return res.status(404).json({ status: false, message: 'VT updation request not found.' }); }
    if (request.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ status: false, message: `Request is already ${request.status}.` }); }
    if (status === 'approved') {
      const updated = await client.query(`UPDATE vt_staff_details SET district_name=$1, block_name=$2,
        school_name=$3, udise_code=$4, updated_at=NOW() WHERE id=$5 RETURNING id`,
      [request.requested_district_name, request.requested_block_name, request.requested_school_name, request.requested_udise_code, request.vt_staff_id]);
      if (!updated.rowCount) throw new Error('VT staff record no longer exists.');
      await client.query('UPDATE users SET udise_code=$1, updated_at=NOW() WHERE vt_staff_id=$2',
        [request.requested_udise_code, request.vt_staff_id]);
    }
    const reviewed = await client.query(`UPDATE vt_location_update_requests SET status=$1, reviewed_by=$2,
      reviewer_remarks=$3, reviewed_at=NOW(), updated_at=NOW() WHERE id=$4 RETURNING *`,
    [status, req.user.id, remarks, requestId]);
    await client.query('COMMIT');
    return res.json({ status: true, message: `VT updation request ${status} successfully.`, data: reviewed.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('reviewVtLocationUpdateRequest error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to review VT updation request.' });
  } finally { client.release(); }
};

module.exports = { listRequests, reviewRequest };
