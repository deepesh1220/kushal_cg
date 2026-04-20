const User = require('../models/User');
const { verifyAccessToken } = require('../utils/jwtUtils');

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE: authenticate
// Verifies the Bearer JWT token and attaches the user + permissions to req.user
// ─────────────────────────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Access denied. No token provided.',
      });
    }

    const token   = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    // Fetch user from DB to verify still active
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'User not found.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ status: 'error', message: 'Account is inactive.' });
    }

    // Fetch effective permissions via model
    const permissions = await User.getEffectivePermissions(user.role_id, user.id);
    user.permissions  = permissions;

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Token expired. Please login again.' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ status: 'error', message: 'Invalid token.' });
    }
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE: authorize(...permissions)
// Checks if req.user has ALL the required fine-grained permissions
// Usage: authorize('attendance:create')
//        authorize('users:view', 'users:update')
// ─────────────────────────────────────────────────────────────────────────────
const authorize = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'Not authenticated.' });
    }

    const userPermissions = req.user.permissions || [];
    const hasAll = requiredPermissions.every((perm) => userPermissions.includes(perm));

    if (!hasAll) {
      return res.status(403).json({
        status: 'error',
        message: `Forbidden. Required permission(s): ${requiredPermissions.join(', ')}`,
      });
    }

    next();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE: authorizeRole(...roles)
// Checks if req.user has one of the specified roles
// Usage: authorizeRole('super_admin', 'admin')
// ─────────────────────────────────────────────────────────────────────────────
const authorizeRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'Not authenticated.' });
    }

    if (!allowedRoles.includes(req.user.role_name)) {
      return res.status(403).json({
        status: 'error',
        message: `Forbidden. Required role(s): ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
};

module.exports = { authenticate, authorize, authorizeRole };
