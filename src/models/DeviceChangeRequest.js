const { pool } = require('../config/db');

const baseSelect = `
  SELECT d.id, d.user_id, d.reason, d.status, d.hm_status, d.hm_remarks,
         d.vtp_status, d.vtp_remarks, d.created_at, d.updated_at, d.completed_at,
         u.name, u.phone, COALESCE(u.udise_code, v.udise_code) AS udise_code,
         v.school_name, v.vtp_name, COALESCE(u.vtp_id, v.vtp_id) AS vtp_id
  FROM device_change_requests d
  JOIN users u ON u.id = d.user_id
  LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id`;

const DeviceChangeRequest = {
  async findPendingByUser(userId) {
    const result = await pool.query(`
      SELECT id, user_id, reason, status, hm_status, vtp_status, created_at, updated_at
      FROM device_change_requests
      WHERE user_id = $1 AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);
    return result.rows[0] || null;
  },

  async create(userId, requestedHash, reason) {
    const result = await pool.query(`
      INSERT INTO device_change_requests (user_id, requested_device_id_hash, reason)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, reason, status, hm_status, vtp_status, created_at, updated_at
    `, [userId, requestedHash, reason || null]);
    return result.rows[0];
  },

  async listForHm(udiseCode, status) {
    const params = [String(udiseCode).trim()];
    let filter = `COALESCE(NULLIF(TRIM(CAST(u.udise_code AS TEXT)), ''), TRIM(CAST(v.udise_code AS TEXT))) = $1`;
    if (status && status !== 'all') {
      params.push(status);
      filter += ` AND d.hm_status = $${params.length}`;
      if (status === 'pending') filter += ` AND d.status = 'pending'`;
    }
    const result = await pool.query(
      `${baseSelect} WHERE ${filter} ORDER BY d.created_at DESC, d.id DESC`,
      params
    );
    return result.rows;
  },

  async listForVtp(vtpId, status) {
    const params = [String(vtpId).trim()];
    let filter = `COALESCE(NULLIF(TRIM(CAST(u.vtp_id AS TEXT)), ''), TRIM(CAST(v.vtp_id AS TEXT))) = $1`;
    if (status && status !== 'all') {
      params.push(status);
      filter += ` AND d.vtp_status = $${params.length}`;
      if (status === 'pending') filter += ` AND d.status = 'pending'`;
    }
    const result = await pool.query(
      `${baseSelect} WHERE ${filter} ORDER BY d.created_at DESC, d.id DESC`,
      params
    );
    return result.rows;
  },

  async action(id, layer, approverId, decision, remarks, scopeValue) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const scopeSql = layer === 'hm'
        ? `COALESCE(NULLIF(TRIM(CAST(u.udise_code AS TEXT)), ''), TRIM(CAST(v.udise_code AS TEXT))) = $2`
        : `COALESCE(NULLIF(TRIM(CAST(u.vtp_id AS TEXT)), ''), TRIM(CAST(v.vtp_id AS TEXT))) = $2`;
      const locked = await client.query(`
        SELECT d.*, u.device_id_hash FROM device_change_requests d
        JOIN users u ON u.id = d.user_id LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
        WHERE d.id = $1 AND ${scopeSql} FOR UPDATE OF d
      `, [id, String(scopeValue).trim()]);
      const request = locked.rows[0];
      if (!request) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
      if (request.status !== 'pending' || request[`${layer}_status`] !== 'pending') {
        await client.query('ROLLBACK'); return { error: 'already_actioned' };
      }

      const otherLayer = layer === 'hm' ? 'vtp' : 'hm';
      const finalStatus = decision === 'rejected'
        ? 'rejected'
        : request[`${otherLayer}_status`] === 'approved' ? 'approved' : 'pending';
      const updated = await client.query(`
        UPDATE device_change_requests SET
          ${layer}_status = $2::VARCHAR, ${layer}_approved_by = $3, ${layer}_approved_at = NOW(),
          ${layer}_remarks = $4, status = $5::VARCHAR,
          completed_at = CASE WHEN $5::VARCHAR <> 'pending' THEN NOW() ELSE completed_at END, updated_at = NOW()
        WHERE id = $1 RETURNING *
      `, [id, decision, approverId, remarks || null, finalStatus]);

      if (finalStatus === 'approved') {
        await client.query(`UPDATE users SET device_id_hash = $1, device_bound_at = COALESCE(device_bound_at, NOW()),
          device_updated_at = NOW(), updated_at = NOW() WHERE id = $2`, [request.requested_device_id_hash, request.user_id]);
        await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [request.user_id]);
      }
      await client.query('COMMIT');
      return { request: updated.rows[0] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  },
};

module.exports = DeviceChangeRequest;
