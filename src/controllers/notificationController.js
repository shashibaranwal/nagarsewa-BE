const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, paginated } = require('../utils/response');
const { AUTHOR_FIELDS } = require('../services/reportService');

const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, unreadOnly } = req.validatedQuery;
  const filter = { recipient: req.user._id };
  if (unreadOnly) filter.isRead = false;

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .populate('actor', AUTHOR_FIELDS)
      .populate('report', 'title status image location')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: req.user._id, isRead: false }),
  ]);

  return res.json({
    success: true,
    message: 'Success',
    data: items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
      unreadCount,
    },
  });
});

const getUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await Notification.countDocuments({
    recipient: req.user._id,
    isRead: false,
  });
  return ok(res, { unreadCount });
});

const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { isRead: true },
    { new: true }
  );
  if (!notification) throw ApiError.notFound('Notification not found');
  return ok(res, notification, 'Marked as read');
});

const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { recipient: req.user._id, isRead: false },
    { isRead: true }
  );
  return ok(res, { updated: result.modifiedCount }, 'All notifications marked as read');
});

const deleteNotification = asyncHandler(async (req, res) => {
  const deleted = await Notification.findOneAndDelete({
    _id: req.params.id,
    recipient: req.user._id,
  });
  if (!deleted) throw ApiError.notFound('Notification not found');
  return ok(res, null, 'Notification deleted');
});

module.exports = {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
