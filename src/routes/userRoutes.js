const express = require('express');
const userController = require('../controllers/userController');
const repostController = require('../controllers/repostController');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ROLES } = require('../config/constants');
const {
  createOfficialSchema,
  updateUserRoleSchema,
  listUsersSchema,
  paginationSchema,
} = require('../validators/schemas');

const router = express.Router();

// --- admin ---
router.get(
  '/',
  requireAuth,
  requireRole(ROLES.ADMIN),
  validate(listUsersSchema, 'query'),
  userController.listUsers
);
router.post(
  '/officials',
  requireAuth,
  requireRole(ROLES.ADMIN),
  validate(createOfficialSchema),
  userController.createOfficial
);
router.patch(
  '/:id/role',
  requireAuth,
  requireRole(ROLES.ADMIN),
  validate(updateUserRoleSchema),
  userController.updateUserRole
);
router.patch(
  '/:id/toggle-active',
  requireAuth,
  requireRole(ROLES.ADMIN),
  userController.setUserActive
);

// --- public profiles ---
router.get('/:id', userController.getPublicProfile);
router.get(
  '/:userId/reposts',
  optionalAuth,
  validate(paginationSchema, 'query'),
  repostController.listUserReposts
);

module.exports = router;
