import mongoose from "mongoose";
import User from "../models/User.js";
import Ward from "../models/Ward.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { sanitizeText } from "../utils/sanitize.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAFE_FIELDS = "-password";
// Ward administrators get a minimal, KYC-free view of users in their own ward.
const WARD_ADMIN_FIELDS = "fullName email phone role status isVerified wardId createdAt";
const escapeRegex = (value) => String(value).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const audit = (req, action, targetUser, before, after, reason = "") =>
  new AdminAuditLog({ action, actor: req.user._id, actorRole: req.user.role, targetUser, before, after, reason: sanitizeText(reason, { maxLength: 1000 }) }).save();

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
/**
 * List all users with optional filtering and pagination.
 * Query params:
 *   page      (default 1)
 *   limit     (default 20, max 100)
 *   role      filter by role ('user' | 'admin')
 *   status    filter by status ('active' | 'suspended')
 *   isVerified filter by verification ('true' | 'false')
 *   search    partial match on fullName, email, or phone
 */
const listUsers = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    const filter = {};
    const wardScoped = req.user.role === "ward_admin";
    if (wardScoped) {
      if (!req.user.wardId) return res.status(403).json({ success: false, message: "Ward scope is not configured" });
      filter.wardId = req.user.wardId;
      filter.role = { $in: ["user", "citizen"] };
    }

    if (req.query.role && !wardScoped) filter.role = req.query.role;
    if (req.query.status)     filter.status     = req.query.status;
    if (req.query.isVerified !== undefined) {
      filter.isVerified = req.query.isVerified === "true";
    }
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(req.query.search), "i");
      filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
    }

    const [users, total] = await Promise.all([
      User.find(filter).select(wardScoped ? WARD_ADMIN_FIELDS : SAFE_FIELDS).skip(skip).limit(limit).sort({ createdAt: -1 }),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────
/**
 * Get a single user by ID. Returns full profile including KYC image URLs.
 */
const getUserById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const user = await User.findById(req.params.id).select(SAFE_FIELDS);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────
/**
 * Change a user's role.
 * Body: { role: 'user' | 'admin' }
 * Admins cannot demote themselves.
 */
const changeRole = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const { role, wardId } = req.body;
    const allowedRoles = ["user", "citizen", "admin", "super_admin", "ward_admin"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "invalid role value",
      });
    }

    // Prevent self-demotion from super admin / admin
    const isSuperAdminRole = ["admin", "super_admin"].includes(role);
    const isSelf = req.user._id.toString() === req.params.id;
    if (isSelf && !isSuperAdminRole) {
      return res.status(400).json({
        success: false,
        message: "admin cannot demote themselves",
      });
    }

    let updateData = { role };

    if (role === "ward_admin") {
      if (!wardId || !mongoose.Types.ObjectId.isValid(wardId)) {
        return res.status(400).json({
          success: false,
          message: "Valid wardId is required for ward_admin role assignment",
        });
      }
      const ward = await Ward.findById(wardId);
      if (!ward) {
        return res.status(404).json({
          success: false,
          message: "Assigned ward not found",
        });
      }
      if (!ward.isActive) {
        return res.status(400).json({
          success: false,
          message: "Cannot assign ward_admin to an inactive ward",
        });
      }
      updateData.wardId = wardId;
    } else {
      updateData.wardId = null;
    }

    const existing = await User.findById(req.params.id).select("role wardId");
    if (!existing) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { returnDocument: "after", runValidators: true }
    ).select(SAFE_FIELDS);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await audit(req, "user_role_changed", user._id, { role: existing.role, wardId: existing.wardId }, { role: user.role, wardId: user.wardId }, req.body.reason);

    return res.status(200).json({
      success: true,
      message: `User role updated to '${role}'`,
      data: user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PATCH /api/admin/users/:id/verify ───────────────────────────────────────
/**
 * Approve or reject a user's KYC verification.
 * Body: { isVerified: true | false }
 */
const verifyUser = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const { isVerified } = req.body;
    if (typeof isVerified !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isVerified must be a boolean (true or false)",
      });
    }

    const before = await User.findById(req.params.id).select("isVerified");
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isVerified },
      { returnDocument: "after", runValidators: true }
    ).select(SAFE_FIELDS);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await audit(req, "user_verification_changed", user._id, { isVerified: before?.isVerified }, { isVerified: user.isVerified });
    const action = isVerified ? "approved" : "rejected";
    return res.status(200).json({
      success: true,
      message: `User KYC ${action}`,
      data: user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PATCH /api/admin/users/:id/status ───────────────────────────────────────
/**
 * Activate or suspend a user account.
 * Body: { status: 'active' | 'suspended' }
 * Admins cannot suspend themselves.
 */
const setStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const { status } = req.body;
    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be 'active' or 'suspended'",
      });
    }

    // Prevent self-suspension
    if (req.user._id.toString() === req.params.id && status === "suspended") {
      return res.status(400).json({
        success: false,
        message: "Admins cannot suspend themselves",
      });
    }

    const beforeStatus = await User.findById(req.params.id).select("status");
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { returnDocument: "after", runValidators: true }
    ).select(SAFE_FIELDS);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await audit(req, "user_status_changed", user._id, { status: beforeStatus?.status }, { status: user.status }, req.body.reason);
    return res.status(200).json({
      success: true,
      message: `User account ${status}`,
      data: user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export { listUsers, getUserById, changeRole, verifyUser, setStatus };
