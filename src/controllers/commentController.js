const Comment = require('../models/Comment');
const Report = require('../models/Report');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { ROLES, NOTIFICATION_TYPES } = require('../config/constants');
const { notify } = require('../services/notificationService');
const { getUserVoteMap } = require('../services/voteService');
const { AUTHOR_FIELDS } = require('../services/reportService');

const createComment = asyncHandler(async (req, res) => {
  const { body, parent } = req.body;
  const report = await Report.findOne({ _id: req.params.id, isDeleted: false });
  if (!report) throw ApiError.notFound('Report not found');

  let parentComment = null;
  if (parent) {
    parentComment = await Comment.findOne({
      _id: parent,
      report: report._id,
      isDeleted: false,
    });
    if (!parentComment) throw ApiError.notFound('Parent comment not found');
    if (parentComment.parent) throw ApiError.badRequest('Replies cannot be nested further');
  }

  const comment = await Comment.create({
    report: report._id,
    author: req.user._id,
    body,
    parent: parentComment ? parentComment._id : null,
  });

  await Promise.all([
    Report.updateOne({ _id: report._id }, { $inc: { commentCount: 1 } }),
    parentComment
      ? Comment.updateOne({ _id: parentComment._id }, { $inc: { replyCount: 1 } })
      : Promise.resolve(),
  ]);

  // A reply notifies the parent comment's author; a top-level comment notifies
  // the reporter.
  await notify({
    recipients: [parentComment ? parentComment.author : report.reportedBy],
    actor: req.user._id,
    type: parentComment ? NOTIFICATION_TYPES.COMMENT_REPLY : NOTIFICATION_TYPES.NEW_COMMENT,
    report: report._id,
    comment: comment._id,
    message: parentComment
      ? `${req.user.name} replied to your comment`
      : `${req.user.name} commented on "${report.title}"`,
  });

  const populated = await comment.populate('author', AUTHOR_FIELDS);
  return created(res, { ...populated.toObject(), myVote: 0 }, 'Comment added');
});

// Top-level comments only; replies are fetched per comment.
const listComments = asyncHandler(async (req, res) => {
  const { page, limit } = req.validatedQuery;
  const filter = { report: req.params.id, parent: null, isDeleted: false };

  const [comments, total] = await Promise.all([
    Comment.find(filter)
      .populate('author', AUTHOR_FIELDS)
      .sort({ score: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Comment.countDocuments(filter),
  ]);

  const voteMap = await getUserVoteMap(
    req.user?._id,
    'Comment',
    comments.map((c) => c._id)
  );
  const items = comments.map((c) => ({ ...c, myVote: voteMap[String(c._id)] || 0 }));

  return paginated(res, items, { page, limit, total });
});

const listReplies = asyncHandler(async (req, res) => {
  const { page, limit } = req.validatedQuery;
  const filter = { parent: req.params.commentId, isDeleted: false };

  const [replies, total] = await Promise.all([
    Comment.find(filter)
      .populate('author', AUTHOR_FIELDS)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Comment.countDocuments(filter),
  ]);

  const voteMap = await getUserVoteMap(
    req.user?._id,
    'Comment',
    replies.map((c) => c._id)
  );
  const items = replies.map((c) => ({ ...c, myVote: voteMap[String(c._id)] || 0 }));

  return paginated(res, items, { page, limit, total });
});

const updateComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findOne({ _id: req.params.commentId, isDeleted: false });
  if (!comment) throw ApiError.notFound('Comment not found');
  if (String(comment.author) !== String(req.user._id)) {
    throw ApiError.forbidden('You can only edit your own comments');
  }

  comment.body = req.body.body;
  await comment.save();
  return ok(res, await comment.populate('author', AUTHOR_FIELDS), 'Comment updated');
});

const deleteComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findOne({ _id: req.params.commentId, isDeleted: false });
  if (!comment) throw ApiError.notFound('Comment not found');

  const isAuthor = String(comment.author) === String(req.user._id);
  const isModerator = req.user.role === ROLES.OFFICIAL || req.user.role === ROLES.ADMIN;
  if (!isAuthor && !isModerator) {
    throw ApiError.forbidden('You can only delete your own comments');
  }

  comment.isDeleted = true;
  await comment.save();

  await Promise.all([
    Report.updateOne({ _id: comment.report }, { $inc: { commentCount: -1 } }),
    comment.parent
      ? Comment.updateOne({ _id: comment.parent }, { $inc: { replyCount: -1 } })
      : Promise.resolve(),
  ]);

  return ok(res, null, 'Comment deleted');
});

module.exports = { createComment, listComments, listReplies, updateComment, deleteComment };
