const mongoose = require('mongoose');
const { NOTIFICATION_TYPES } = require('../config/constants');

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true },
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },
    comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
    message: { type: String, required: true, maxlength: 300 },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
