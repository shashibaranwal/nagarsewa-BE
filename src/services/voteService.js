const Vote = require('../models/Vote');
const Report = require('../models/Report');
const Comment = require('../models/Comment');
const ApiError = require('../utils/ApiError');

const MODELS = { Report, Comment };

// Casts, switches or removes a vote and keeps the target's denormalised
// counters consistent. Voting the same way twice toggles the vote off, which is
// what the UI expects from an already-highlighted arrow.
async function castVote({ userId, targetType, targetId, value }) {
  const Model = MODELS[targetType];
  if (!Model) throw ApiError.badRequest('Unsupported vote target');

  const target = await Model.findOne({ _id: targetId, isDeleted: { $ne: true } });
  if (!target) throw ApiError.notFound(`${targetType} not found`);

  const existing = await Vote.findOne({ user: userId, targetType, targetId });

  let inc = {};
  let myVote = value;

  if (!existing) {
    await Vote.create({ user: userId, targetType, targetId, value });
    inc = value === 1 ? { upvoteCount: 1, score: 1 } : { downvoteCount: 1, score: -1 };
  } else if (existing.value === value) {
    await existing.deleteOne();
    inc = value === 1 ? { upvoteCount: -1, score: -1 } : { downvoteCount: -1, score: 1 };
    myVote = 0;
  } else {
    existing.value = value;
    await existing.save();
    inc =
      value === 1
        ? { upvoteCount: 1, downvoteCount: -1, score: 2 }
        : { upvoteCount: -1, downvoteCount: 1, score: -2 };
  }

  const updated = await Model.findByIdAndUpdate(targetId, { $inc: inc }, { new: true }).lean();

  return {
    targetType,
    targetId,
    myVote,
    upvoteCount: updated.upvoteCount,
    downvoteCount: updated.downvoteCount,
    score: updated.score,
    isNewVote: !existing,
    previousVote: existing ? existing.value : 0,
  };
}

// Returns a map of targetId -> the viewer's vote value, for annotating lists.
async function getUserVoteMap(userId, targetType, targetIds) {
  if (!userId || targetIds.length === 0) return {};
  const votes = await Vote.find({ user: userId, targetType, targetId: { $in: targetIds } })
    .select('targetId value')
    .lean();
  return votes.reduce((acc, v) => {
    acc[String(v.targetId)] = v.value;
    return acc;
  }, {});
}

module.exports = { castVote, getUserVoteMap };
