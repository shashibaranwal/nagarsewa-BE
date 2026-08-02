const express = require('express');
const controller = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { notificationListSchema } = require('../validators/schemas');

const router = express.Router();

router.use(requireAuth);

router.get('/', validate(notificationListSchema, 'query'), controller.listNotifications);
router.get('/unread-count', controller.getUnreadCount);
router.patch('/read-all', controller.markAllAsRead);
router.patch('/:id/read', controller.markAsRead);
router.delete('/:id', controller.deleteNotification);

module.exports = router;
