import { Router } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";
import {
  listWards,
  getWardById,
  createWard,
  updateWard,
  getWardIssues,
  getWardDashboard,
} from "../controllers/wardController.js";

const router = Router();

// Optional auth helper for public endpoints
const optionalAuth = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_TOKEN);
      const user = await User.findById(decoded.userId).select("-password");
      if (user && user.status !== "suspended") {
        req.user = user;
      }
    }
  } catch {
    // Ignore invalid tokens on optional public routes
  }
  next();
};

// GET /api/wards - Public / Authenticated read
router.get("/", optionalAuth, listWards);

// GET /api/wards/:id - Public / Authenticated read
router.get("/:id", optionalAuth, getWardById);

// POST /api/wards - Super Admin only
router.post("/", protect, restrictTo("admin", "super_admin"), createWard);

// PATCH /api/wards/:id - Super Admin only
router.patch("/:id", protect, restrictTo("admin", "super_admin"), updateWard);

// GET /api/wards/:id/issues - Ward Admin / Super Admin
router.get("/:id/issues", protect, restrictTo("ward_admin", "admin", "super_admin"), getWardIssues);

// GET /api/wards/:id/dashboard - Ward Admin / Super Admin
router.get("/:id/dashboard", protect, restrictTo("ward_admin", "admin", "super_admin"), getWardDashboard);

export default router;
