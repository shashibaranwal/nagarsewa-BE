const express = require('express');
const controller = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} = require('../validators/schemas');

const router = express.Router();

router.post('/register', authLimiter, validate(registerSchema), controller.register);
router.post('/login', authLimiter, validate(loginSchema), controller.login);
router.get('/me', requireAuth, controller.me);
router.patch('/me', requireAuth, validate(updateProfileSchema), controller.updateProfile);
router.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  controller.changePassword
);

module.exports = router;
