const Notification = require('../models/Notification');
const User = require('../models/User');
const { ROLES, NOTIFICATION_TYPES } = require('../config/constants');
const { emitToUser } = require('../realtime/io');

// Creates notifications and pushes them over the socket connection when the
// recipient is online. Never throws into the caller's request flow — a failed
// notification must not fail the action that triggered it.
async function notify({ recipients, actor, type, report, comment, message }) {
  const actorId = actor ? String(actor) : null;
  const unique = [...new Set((recipients || []).map(String))].filter((id) => id !== actorId);
  if (unique.length === 0) return [];

  try {
    const docs = await Notification.insertMany(
      unique.map((recipient) => ({ recipient, actor, type, report, comment, message }))
    );
    docs.forEach((doc) => emitToUser(doc.recipient, 'notification:new', doc.toObject()));
    return docs;
  } catch (err) {
    console.error('Failed to create notifications:', err.message);
    return [];
  }
}

// Officials of the matching ward/city are notified about a new report; if none
// are scoped to that area, every official and admin is notified instead.
async function notifyOfficialsOfNewReport(report, actorId) {
  const { ward, city } = report.location || {};
  const scoped = [];
  if (ward) scoped.push({ ward });
  if (city) scoped.push({ city });

  const baseQuery = { role: { $in: [ROLES.OFFICIAL, ROLES.ADMIN] }, isActive: true };
  let officials = [];
  if (scoped.length) {
    officials = await User.find({ ...baseQuery, $or: scoped }).select('_id').lean();
  }
  if (officials.length === 0) {
    officials = await User.find(baseQuery).select('_id').lean();
  }

  return notify({
    recipients: officials.map((o) => o._id),
    actor: actorId,
    type: NOTIFICATION_TYPES.NEW_REPORT,
    report: report._id,
    message: `New report: ${report.title} (${report.location.address})`,
  });
}

module.exports = { notify, notifyOfficialsOfNewReport };
