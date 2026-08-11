const DeviceChangeRequest = require('../models/DeviceChangeRequest');
const User = require('../models/User');
const { verifyDeviceChangeToken } = require('../utils/jwtUtils');

const pendingResponse = (res, request) => res.status(409).json({
  status: false,
  code: 'DEVICE_CHANGE_REQUEST_PENDING',
  message: 'Your Device ID change request is already pending for HM and VTP approval.',
  data: {
    request_id: request.id,
    status: request.status,
    hm_status: request.hm_status,
    vtp_status: request.vtp_status,
    requested_at: request.created_at,
  },
});

const submitRequest = async (req, res) => {
  try {
    const { device_change_token, reason } = req.body;
    if (!device_change_token) return res.status(400).json({ status: false, message: 'device_change_token is required.' });
    const normalizedReason = typeof reason === 'string' ? reason.trim() || null : null;
    if (normalizedReason?.length > 1000) return res.status(400).json({ status: false, message: 'Reason cannot exceed 1000 characters.' });
    const proof = verifyDeviceChangeToken(device_change_token);
    const user = await User.findById(proof.id);
    if (!user || user.role_name !== 'vocational_teacher') return res.status(403).json({ status: false, message: 'Invalid VT device change request.' });
    if (!proof.requested_device_hash || proof.requested_device_hash === user.device_id_hash) {
      return res.status(400).json({ status: false, message: 'The requested device is already registered.' });
    }
    const pending = await DeviceChangeRequest.findPendingByUser(user.id);
    if (pending) return pendingResponse(res, pending);

    let request;
    try {
      request = await DeviceChangeRequest.create(user.id, proof.requested_device_hash, normalizedReason);
    } catch (error) {
      // The partial unique index protects against simultaneous duplicate taps/requests.
      if (error.code === '23505') {
        const concurrentPending = await DeviceChangeRequest.findPendingByUser(user.id);
        if (concurrentPending) return pendingResponse(res, concurrentPending);
      }
      throw error;
    }
    return res.status(201).json({ status: true, message: 'Device ID change request sent to HM and VTP.', data: request });
  } catch (error) {
    if (['TokenExpiredError', 'JsonWebTokenError'].includes(error.name)) {
      return res.status(401).json({ status: false, message: 'Device change session expired. Please verify login credentials again.' });
    }
    console.error('Device change request error:', error.message);
    return res.status(500).json({ status: false, message: 'Unable to submit device change request.' });
  }
};

const listForHm = async (req, res) => {
  if (!req.user.udise_code) return res.status(400).json({ status: false, message: 'Headmaster school is not mapped.' });
  const data = await DeviceChangeRequest.listForHm(req.user.udise_code, req.body.status);
  return res.json({ status: true, data });
};
const listForVtp = async (req, res) => {
  if (!req.user.vtp_id) return res.status(400).json({ status: false, message: 'VTP is not mapped.' });
  const data = await DeviceChangeRequest.listForVtp(req.user.vtp_id, req.body.status);
  return res.json({ status: true, data });
};

const action = (layer) => async (req, res) => {
  try {
    const { decision, remarks } = req.body;
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ status: false, message: 'decision must be approved or rejected.' });
    if (typeof remarks === 'string' && remarks.trim().length > 1000) return res.status(400).json({ status: false, message: 'Remarks cannot exceed 1000 characters.' });
    const scope = layer === 'hm' ? req.user.udise_code : req.user.vtp_id;
    if (!scope) return res.status(400).json({ status: false, message: 'Approver mapping is missing.' });
    const result = await DeviceChangeRequest.action(req.params.requestId, layer, req.user.id, decision, remarks, scope);
    if (result.error === 'not_found') return res.status(404).json({ status: false, message: 'Request not found in your scope.' });
    if (result.error) return res.status(409).json({ status: false, message: 'Request has already been actioned.' });
    return res.json({ status: true, message: decision === 'approved' ? 'Device change approved.' : 'Device change rejected.', data: result.request });
  } catch (error) { console.error('Device approval error:', error.message); return res.status(500).json({ status: false, message: 'Unable to update request.' }); }
};

module.exports = { submitRequest, listForHm, listForVtp, actionByHm: action('hm'), actionByVtp: action('vtp') };
