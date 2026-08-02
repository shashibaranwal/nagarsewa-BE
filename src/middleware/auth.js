const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../utils/jwt');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

// Rejects the request when no valid token is present.
const requireAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Authorization token missing');

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired token');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or deactivated');

  req.user = user;
  next();
});

// Populates req.user when a token is present but never blocks the request.
// Used by the public feed so we can annotate posts with the viewer's own vote.
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (user && user.isActive) req.user = user;
  } catch (err) {
    // Ignore bad tokens on public routes.
  }
  next();
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`Requires one of these roles: ${roles.join(', ')}`));
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, requireRole };
