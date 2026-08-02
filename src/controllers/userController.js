const User = require('../models/User');
const Report = require('../models/Report');
const Comment = require('../models/Comment');
const Repost = require('../models/Repost');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');

// Public profile plus the activity counts a profile header shows.
const getPublicProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || !user.isActive) throw ApiError.notFound('User not found');

  const [reportCount, commentCount, repostCount, resolvedCount] = await Promise.all([
    Report.countDocuments({ reportedBy: user._id, isDeleted: false }),
    Comment.countDocuments({ author: user._id, isDeleted: false }),
    Repost.countDocuments({ user: user._id }),
    Report.countDocuments({ reportedBy: user._id, isDeleted: false, status: 'completed' }),
  ]);

  return ok(res, {
    user: user.toPublicJSON(),
    stats: { reportCount, commentCount, repostCount, resolvedCount },
  });
});

// Admin: list users with an optional role filter.
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, role, search } = req.validatedQuery;
  const filter = {};
  if (role) filter.role = role;
  if (search) {
    filter.$or = [
      { name: new RegExp(search, 'i') },
      { email: new RegExp(search, 'i') },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  return paginated(res, users.map((u) => u.toPublicJSON()), { page, limit, total });
});

// Admin: create an official / another admin account.
const createOfficial = asyncHandler(async (req, res) => {
  if (await User.exists({ email: req.body.email })) {
    throw ApiError.conflict('Email is already registered');
  }
  const user = await User.create(req.body);
  return created(res, { user: user.toPublicJSON() }, `${user.role} account created`);
});

const updateUserRole = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  Object.assign(user, req.body);
  await user.save();
  return ok(res, { user: user.toPublicJSON() }, 'User updated');
});

const setUserActive = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }

  user.isActive = !user.isActive;
  await user.save();
  return ok(
    res,
    { user: user.toPublicJSON() },
    user.isActive ? 'Account activated' : 'Account deactivated'
  );
});

module.exports = { getPublicProfile, listUsers, createOfficial, updateUserRole, setUserActive };
