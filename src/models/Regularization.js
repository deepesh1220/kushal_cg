const { pool } = require('../config/db');

class Regularization {
  static async checkDuplicate(userId, date, excludeId = null) {
    let query = `SELECT id FROM regularization_requests
      WHERE user_id = $1 AND date = $2 AND status IN ('pending', 'approved')`;
    const params = [userId, date];
    if (excludeId) {
      params.push(excludeId);
      query += ` AND id != $${params.length}`;
    }
    const result = await pool.query(query, params);
    return result.rows.length > 0;
  }

  static async create({ user_id, date, reason }) {
    const result = await pool.query(`
      INSERT INTO regularization_requests
        (user_id, date, reason, status, hm_status, vtp_status, regularization_approved)
      VALUES ($1, $2, $3, 'pending', 'pending', 'pending', FALSE)
      RETURNING *
    `, [user_id, date, reason]);
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`
      SELECT rr.*, u.name AS user_name, u.phone AS mobile,
        v.udise_code, v.vtp_name, v.trade,
        hm.name AS hm_approved_by_name, vp.name AS vtp_approved_by_name
      FROM regularization_requests rr
      JOIN users u ON u.id = rr.user_id
      LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
      LEFT JOIN users hm ON hm.id = rr.hm_approved_by
      LEFT JOIN users vp ON vp.id = rr.vtp_approved_by
      WHERE rr.id = $1
    `, [id]);
    return result.rows[0] || null;
  }

  static async findByUser(userId, filters = {}) {
    return this._find({ ...filters, user_id: userId });
  }

  static async findAll(filters = {}) {
    return this._find({ ...filters, approval_status_column: filters.approval_status_column || 'hm_status' });
  }

  static async findAllByVtpId(vtpId, filters = {}) {
    return this._find({ ...filters, vtp_id: vtpId, approval_status_column: 'vtp_status' });
  }

  static async _find({
    udise_code, user_id, vtp_id, status, from_date, to_date,
    approval_status_column = 'status', limit = 10, offset = 0,
  } = {}) {
    let baseQuery = `
      FROM regularization_requests rr
      JOIN users u ON u.id = rr.user_id
      LEFT JOIN vt_staff_details v ON v.id = u.vt_staff_id
      LEFT JOIN users hm ON hm.id = rr.hm_approved_by
      LEFT JOIN users vp ON vp.id = rr.vtp_approved_by
      WHERE 1=1`;
    const params = [];
    const add = (clause, value) => {
      params.push(value);
      baseQuery += ` AND ${clause.replace('?', `$${params.length}`)}`;
    };

    if (udise_code) add('COALESCE(u.udise_code, v.udise_code) = ?', udise_code);
    if (user_id) add('rr.user_id = ?', user_id);
    if (vtp_id) add('TRIM(COALESCE(u.vtp_id, v.vtp_id)) = TRIM(?)', vtp_id);
    if (status) {
      const safeColumn = ['status', 'hm_status', 'vtp_status'].includes(approval_status_column)
        ? approval_status_column
        : 'status';
      add(`rr.${safeColumn} = ?`, status);
    }
    if (from_date) add('rr.date >= ?', from_date);
    if (to_date) add('rr.date <= ?', to_date);

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const dataResult = await pool.query(`
      SELECT rr.*, u.name AS user_name, u.phone AS mobile,
        COALESCE(u.udise_code, v.udise_code) AS udise_code,
        v.vtp_name, v.trade,
        hm.name AS hm_approved_by_name, vp.name AS vtp_approved_by_name
      ${baseQuery}
      ORDER BY rr.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);
    return { data: dataResult.rows, totalRecords: parseInt(countResult.rows[0].count, 10) };
  }

  static async updateHmStatus(id, { status, reviewerId, remarks, approvalType = 'manual' }) {
    return this._updateApproval(id, 'hm', { status, reviewerId, remarks, approvalType });
  }

  static async updateVtpStatus(id, { status, reviewerId, remarks, approvalType = 'manual' }) {
    return this._updateApproval(id, 'vtp', { status, reviewerId, remarks, approvalType });
  }

  static async _updateApproval(id, layer, { status, reviewerId, remarks, approvalType }) {
    const isHm = layer === 'hm';
    const ownStatus = isHm ? 'hm_status' : 'vtp_status';
    const otherStatus = isHm ? 'vtp_status' : 'hm_status';
    const approvedBy = isHm ? 'hm_approved_by' : 'vtp_approved_by';
    const actionAt = isHm ? 'hm_action_at' : 'vtp_action_at';
    const remarksColumn = isHm ? 'hm_remarks' : 'vtp_remarks';
    const typeColumn = isHm ? 'hm_approval_type' : 'vtp_approval_type';
    const result = await pool.query(`
      UPDATE regularization_requests SET
        ${ownStatus} = $1, ${approvedBy} = $2, ${actionAt} = NOW(), ${remarksColumn} = $3,
        status = CASE
          WHEN $1::varchar = 'rejected' OR ${otherStatus} = 'rejected' THEN 'rejected'
          WHEN $1::varchar = 'approved' AND ${otherStatus} = 'approved' THEN 'approved'
          ELSE 'pending'
        END,
        regularization_approved = ($1::varchar = 'approved' AND ${otherStatus} = 'approved'),
        ${typeColumn} = $4::VARCHAR,
        is_auto_approved = is_auto_approved OR $4::VARCHAR = 'auto',
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [status, reviewerId, remarks || null, approvalType, id]);
    return result.rows[0] || null;
  }
}

module.exports = Regularization;
