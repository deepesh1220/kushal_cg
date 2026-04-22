const bcrypt = require('bcryptjs');
const Headmaster = require('../models/Headmaster');

// ─── GET  /api/headmaster/:teacher_code ───────────────────────────────────────
const getHeadmaster = async (req, res, next) => {
  try {
    const hm = await Headmaster.findByTeacherCode(req.params.teacher_code);
    if (!hm) return res.status(404).json({ status: 'error', message: 'Headmaster not found' });

    const { password: _p, ...safe } = hm;
    res.json({ status: 'success', data: safe });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/headmaster ─────────────────────────────────────────────────────
const createHeadmaster = async (req, res, next) => {
  try {
    const { teacher_code, password, t_name, email } = req.body;

    if (!teacher_code || !password || !t_name) {
      return res.status(400).json({
        status: 'error',
        message: 'teacher_code, password, and t_name are required',
      });
    }

    if (await Headmaster.teacherCodeExists(teacher_code)) {
      return res.status(409).json({ status: 'error', message: 'teacher_code already exists' });
    }

    if (email && (await Headmaster.emailExists(email))) {
      return res.status(409).json({ status: 'error', message: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const hm = await Headmaster.create({ ...req.body, password: hashed });

    const { password: _p, ...safe } = hm;
    res.status(201).json({ status: 'success', data: safe });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/headmaster/:teacher_code ──────────────────────────────────────
const updateHeadmaster = async (req, res, next) => {
  try {
    const { teacher_code } = req.params;
    const updated = await Headmaster.update(teacher_code, req.body);
    if (!updated) return res.status(404).json({ status: 'error', message: 'Headmaster not found' });

    const { password: _p, ...safe } = updated;
    res.json({ status: 'success', data: safe });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/headmaster/:teacher_code ─────────────────────────────────────
const deleteHeadmaster = async (req, res, next) => {
  try {
    const deleted = await Headmaster.delete(req.params.teacher_code);
    if (!deleted) return res.status(404).json({ status: 'error', message: 'Headmaster not found' });
    res.json({ status: 'success', message: 'Headmaster deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── GET  /api/headmaster/district/:district_id ───────────────────────────────
const getByDistrict = async (req, res, next) => {
  try {
    const list = await Headmaster.findByDistrict(req.params.district_id);
    res.json({ status: 'success', count: list.length, data: list });
  } catch (err) {
    next(err);
  }
};

// ─── GET  /api/headmaster/block/:block_id ─────────────────────────────────────
const getByBlock = async (req, res, next) => {
  try {
    const list = await Headmaster.findByBlock(req.params.block_id);
    res.json({ status: 'success', count: list.length, data: list });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getHeadmaster,
  createHeadmaster,
  updateHeadmaster,
  deleteHeadmaster,
  getByDistrict,
  getByBlock,
};
