import jwt from "jsonwebtoken";
import User from "../models/User.js";

// ─── protect ──────────────────────────────────────────────────────────────────
// Verifies JWT, loads the user from DB, attaches to req.user.
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ success: false, message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_TOKEN);
    } catch {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token" });
    }

    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    }

    // Block suspended accounts from all protected routes
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended. Contact support.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Server error in auth middleware" });
  }
};

// ─── restrictTo ───────────────────────────────────────────────────────────────
// Usage: restrictTo("admin")  or  restrictTo("admin", "staff")
// Must be used AFTER protect so req.user is available.
const restrictTo = (...roles) => {
  return (req, res, next) => {
    const userRole = req.user.role;
    // Map admin and super_admin interchangeably for platform admin checks
    const effectiveRoles = new Set(roles);
    if (effectiveRoles.has("admin") || effectiveRoles.has("super_admin")) {
      effectiveRoles.add("admin");
      effectiveRoles.add("super_admin");
    }
    if (!effectiveRoles.has(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(" or ")}`,
      });
    }
    next();
  };
};

// ─── requireVerified ─────────────────────────────────────────────────────────
// Blocks users whose KYC has not been approved yet.
// Must be used AFTER protect so req.user is available.
const requireVerified = (req, res, next) => {
  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message:
        "Your account is pending KYC verification. This action requires a verified account.",
    });
  }
  next();
};

export { protect, restrictTo, requireVerified };
