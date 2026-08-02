const express = require('express');
const reportController = require('../controllers/reportController');
const commentController = require('../controllers/commentController');
const voteController = require('../controllers/voteController');
const repostController = require('../controllers/repostController');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { uploadReportImage } = require('../middleware/upload');
const { createReportLimiter } = require('../middleware/rateLimit');
const { ROLES } = require('../config/constants');
const {
  createReportSchema,
  updateReportSchema,
  updateStatusSchema,
  listReportsSchema,
  createCommentSchema,
  voteSchema,
  repostSchema,
  paginationSchema,
} = require('../validators/schemas');

const router = express.Router();

// --- feed & reports ---
router.get('/', optionalAuth, validate(listReportsSchema, 'query'), reportController.listReports);
router.get('/stats', reportController.getStats);
router.get('/mine', requireAuth, validate(paginationSchema, 'query'), reportController.getMyReports);

router.post(
  '/',
  requireAuth,
  createReportLimiter,
  uploadReportImage,
  validate(createReportSchema),
  reportController.createReport
);

router.get('/:id', optionalAuth, reportController.getReport);
router.patch('/:id', requireAuth, validate(updateReportSchema), reportController.updateReport);
router.delete('/:id', requireAuth, reportController.deleteReport);

// --- status: officials only ---
router.patch(
  '/:id/status',
  requireAuth,
  requireRole(ROLES.OFFICIAL, ROLES.ADMIN),
  validate(updateStatusSchema),
  reportController.updateStatus
);

// --- comments ---
router.get(
  '/:id/comments',
  optionalAuth,
  validate(paginationSchema, 'query'),
  commentController.listComments
);
router.post(
  '/:id/comments',
  requireAuth,
  validate(createCommentSchema),
  commentController.createComment
);

// --- votes ---
router.post('/:id/vote', requireAuth, validate(voteSchema), voteController.voteReport);

// --- reposts ---
router.post('/:id/repost', requireAuth, validate(repostSchema), repostController.createRepost);
router.delete('/:id/repost', requireAuth, repostController.removeRepost);
router.get(
  '/:id/reposts',
  optionalAuth,
  validate(paginationSchema, 'query'),
  repostController.listReposters
);

module.exports = router;
