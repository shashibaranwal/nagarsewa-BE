import User from "../models/User.js";
import Ward from "../models/Ward.js";

// ─── GET /api/users/me ────────────────────────────────────────────────────────
/**
 * Returns the authenticated user's full profile.
 * Protected. No verification required — users can always see their own data.
 */
const getMe = async (req, res) => {
  try {
    // req.user is already attached by protect middleware (no password)
    const user = req.user.toObject ? req.user.toObject() : { ...req.user };
    const ward = user.wardId ? await Ward.findById(user.wardId).select("name wardNumber municipality").lean() : null;
    user.ward = ward ? { _id: ward._id, name: ward.name, wardNumber: ward.wardNumber, label: `Ward ${ward.wardNumber}`, municipality: ward.municipality } : null;
    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PATCH /api/users/me/password ────────────────────────────────────────────
/**
 * Change own password.
 * Protected. Requires: { currentPassword, newPassword, confirmNewPassword }
 */
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({
        success: false,
        message: "currentPassword, newPassword, and confirmNewPassword are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters",
      });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({
        success: false,
        message: "New passwords do not match",
      });
    }

    if (newPassword === currentPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
    }

    // Re-fetch user WITH password field (select excluded it in protect)
    const user = await User.findById(req.user._id).select("+password");
    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    user.password = newPassword; // pre-save hook will hash it
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── DELETE /api/users/me ─────────────────────────────────────────────────────
/**
 * Self-deactivation — sets status to 'suspended' rather than hard-deleting.
 * Protected. Requires: { password } for confirmation.
 */
const deactivateMe = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password confirmation is required to deactivate your account",
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password",
      });
    }

    await User.findByIdAndUpdate(req.user._id, { status: "suspended" });

    return res.status(200).json({
      success: true,
      message: "Your account has been deactivated. Contact support to reactivate.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export { getMe, changePassword, deactivateMe };
