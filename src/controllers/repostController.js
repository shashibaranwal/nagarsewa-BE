const Repost = require('../models/Repost');
const Report = require('../models/Report');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { NOTIFICATION_TYPES } = require('../config/constants');
const { notify } = require('../services/notificationService');
const { AUTHOR_FIELDS, decorateForViewer } = require('../services/reportService');

const createRepost = asyncHandler(async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, isDeleted: false });
  if (!report) throw ApiError.notFound('Report not found');
  if (await Repost.exists({ user: req.user._id, report: report._id })) {
    throw ApiError.conflict('You have already reposted this report');
  }

  const repost = await Repost.create({
    report: report._id,
    user: req.user._id,
    caption: req.body.caption,
  });
  await Report.updateOne({ _id: report._id }, { $inc: { repostCount: 1 } });

  await notify({
    recipients: [report.reportedBy],
    actor: req.user._id,
    type: NOTIFICATION_TYPES.NEW_REPOST,
    report: report._id,
    message: `${req.user.name} reposted "${report.title}"`,
  });

  return created(res, repost, 'Report reposted');
});

const removeRepost = asyncHandler(async (req, res) => {
  const repost = await Repost.findOneAndDelete({ user: req.user._id, report: req.params.id });
  if (!repost) throw ApiError.notFound('You have not reposted this report');

  await Report.updateOne({ _id: req.params.id }, { $inc: { repostCount: -1 } });
  return ok(res, null, 'Repost removed');
});

// Who reposted a given report.
const listReposters = asyncHandler(async (req, res) => {
  const { page, limit } = req.validatedQuery;
  const filter = { report: req.params.id };

  const [reposts, total] = await Promise.all([
    Repost.find(filter)
      .populate('user', AUTHOR_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Repost.countDocuments(filter),
  ]);

  return paginated(res, reposts, { page, limit, total });
});

// A user's reposts, each with the full underlying report - this is what a
// profile timeline renders alongside their own reports.
const listUserReposts = asyncHandler(async (req, res) => {
  const { page, limit } = req.validatedQuery;
  const filter = { user: req.params.userId || req.user._id };

  const [reposts, total] = await Promise.all([
    Repost.find(filter)
      .populate({
        path: 'report',
        populate: { path: 'reportedBy', select: AUTHOR_FIELDS },
      })
      .populate('user', AUTHOR_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Repost.countDocuments(filter),
  ]);

  const visible = reposts.filter((r) => r.report && !r.report.isDeleted);
  const decorated = await decorateForViewer(
    visible.map((r) => r.report),
    req.user?._id
  );
  const items = visible.map((r, i) => ({ ...r, report: decorated[i] }));

  return paginated(res, items, { page, limit, total });
});

module.exports = { createRepost, removeRepost, listReposters, listUserReposts };
