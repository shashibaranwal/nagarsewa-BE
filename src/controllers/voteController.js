const Report = require('../models/Report');
const Comment = require('../models/Comment');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { castVote } = require('../services/voteService');
const { notify } = require('../services/notificationService');
const { NOTIFICATION_TYPES } = require('../config/constants');

const voteReport = asyncHandler(async (req, res) => {
  const result = await castVote({
    userId: req.user._id,
    targetType: 'Report',
    targetId: req.params.id,
    value: req.body.value,
  });

  // Only announce fresh upvotes - toggles and flips would be noise.
  if (result.isNewVote && req.body.value === 1) {
    const report = await Report.findById(req.params.id).select('reportedBy title').lean();
    await notify({
      recipients: [report.reportedBy],
      actor: req.user._id,
      type: NOTIFICATION_TYPES.NEW_VOTE,
      report: report._id,
      message: `${req.user.name} upvoted "${report.title}"`,
    });
  }

  return ok(res, result, 'Vote recorded');
});

const voteComment = asyncHandler(async (req, res) => {
  const result = await castVote({
    userId: req.user._id,
    targetType: 'Comment',
    targetId: req.params.commentId,
    value: req.body.value,
  });

  if (result.isNewVote && req.body.value === 1) {
    const comment = await Comment.findById(req.params.commentId).select('author report').lean();
    await notify({
      recipients: [comment.author],
      actor: req.user._id,
      type: NOTIFICATION_TYPES.NEW_VOTE,
      report: comment.report,
      comment: comment._id,
      message: `${req.user.name} upvoted your comment`,
    });
  }

  return ok(res, result, 'Vote recorded');
});

module.exports = { voteReport, voteComment };
