import { Router } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";
import {
  listDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deactivateDepartment,
} from "../controllers/departmentController.js";

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

// GET /api/departments - Public / Authenticated read
router.get("/", optionalAuth, listDepartments);

// GET /api/departments/:id - Public / Authenticated read
router.get("/:id", optionalAuth, getDepartmentById);

// POST /api/departments - Super Admin only
router.post("/", protect, restrictTo("admin", "super_admin"), createDepartment);

// PATCH /api/departments/:id - Super Admin only
router.patch("/:id", protect, restrictTo("admin", "super_admin"), updateDepartment);

// DELETE /api/departments/:id - Super Admin only (Safe Deactivation)
router.delete("/:id", protect, restrictTo("admin", "super_admin"), deactivateDepartment);

export default router;
