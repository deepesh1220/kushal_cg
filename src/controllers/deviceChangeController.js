const DeviceChangeRequest = require('../models/DeviceChangeRequest');
const User = require('../models/User');
const { verifyDeviceChangeToken } = require('../utils/jwtUtils');

const submitRequest = async (req, res) => {
  try {
    const { device_change_token, reason } = req.body;
    if (!device_change_token) return res.status(400).json({ status: false, message: 'device_change_token is required.' });
    const proof = verifyDeviceChangeToken(device_change_token);
    const user = await User.findById(proof.id);
    if (!user || user.role_name !== 'vocational_teacher') return res.status(403).json({ status: false, message: 'Invalid VT device change request.' });
    if (!proof.requested_device_hash || proof.requested_device_hash === user.device_id_hash) {
      return res.status(400).json({ status: false, message: 'The requested device is already registered.' });
    }
    const request = await DeviceChangeRequest.createOrGet(user.id, proof.requested_device_hash, reason);
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
    const scope = layer === 'hm' ? req.user.udise_code : req.user.vtp_id;
    if (!scope) return res.status(400).json({ status: false, message: 'Approver mapping is missing.' });
    const result = await DeviceChangeRequest.action(req.params.requestId, layer, req.user.id, decision, remarks, scope);
    if (result.error === 'not_found') return res.status(404).json({ status: false, message: 'Request not found in your scope.' });
    if (result.error) return res.status(409).json({ status: false, message: 'Request has already been actioned.' });
    return res.json({ status: true, message: decision === 'approved' ? 'Device change approved.' : 'Device change rejected.', data: result.request });
  } catch (error) { console.error('Device approval error:', error.message); return res.status(500).json({ status: false, message: 'Unable to update request.' }); }
};

module.exports = { submitRequest, listForHm, listForVtp, actionByHm: action('hm'), actionByVtp: action('vtp') };
