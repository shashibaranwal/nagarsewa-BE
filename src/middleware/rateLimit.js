const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const isDev = env.nodeEnv === 'development';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 10000 : 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

// Login/register are brute-force targets, so they get a tighter budget.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 1000 : 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again in 15 minutes' },
});

// Report creation involves a file upload; keep it modest per user.
const createReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: isDev ? 1000 : 20,
  keyGenerator: (req) => String(req.user?._id || req.ip),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Report limit reached, please try again later' },
});

module.exports = { apiLimiter, authLimiter, createReportLimiter };
