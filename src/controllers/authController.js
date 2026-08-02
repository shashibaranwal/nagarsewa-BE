const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken } = require('../utils/jwt');
const { ok, created } = require('../utils/response');

// Public signup always creates a citizen; officials are created by an admin.
const register = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (await User.exists({ email })) throw ApiError.conflict('Email is already registered');

  const user = await User.create({ ...req.body });
  return created(
    res,
    { user: user.toPublicJSON(), token: signToken(user) },
    'Account created successfully'
  );
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  return ok(res, { user: user.toPublicJSON(), token: signToken(user) }, 'Logged in successfully');
});

const me = asyncHandler(async (req, res) => ok(res, { user: req.user.toPublicJSON() }));

const updateProfile = asyncHandler(async (req, res) => {
  Object.assign(req.user, req.body);
  await req.user.save();
  return ok(res, { user: req.user.toPublicJSON() }, 'Profile updated');
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  user.password = newPassword;
  await user.save();
  return ok(res, null, 'Password changed successfully');
});

module.exports = { register, login, me, updateProfile, changePassword };
