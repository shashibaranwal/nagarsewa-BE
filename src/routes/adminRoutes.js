import { Router } from "express";
import { listUsers, getUserById, changeRole, verifyUser, setStatus } from "../controllers/adminController.js";
import {
  assignIssue, dashboard, listAdminIssues, listAdminReports, requireOpsAccess, reviewAdminReport,
  setIssueDeadline, setIssuePriority, updateIssueStatus,
} from "../controllers/adminOperationsController.js";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";

const router = Router();

router.use(protect);

// ── Operations: ward_admin (own ward only), admin and super_admin ─────────────
router.get("/dashboard", requireOpsAccess, dashboard);
router.get("/issues", requireOpsAccess, listAdminIssues);
router.get("/reports", requireOpsAccess, listAdminReports);
router.patch("/reports/:id/review", requireOpsAccess, reviewAdminReport);
router.patch("/issues/:id/status", requireOpsAccess, updateIssueStatus);
router.patch("/issues/:id/assign", requireOpsAccess, assignIssue);
router.patch("/issues/:id/priority", requireOpsAccess, setIssuePriority);
router.patch("/issues/:id/deadline", requireOpsAccess, setIssueDeadline);

// GET /api/admin/users - ward_admin: only citizens of their own ward (no KYC data); super admin: everyone
router.get("/users", requireOpsAccess, listUsers);

// ── Global user management: super admin only ("admin" is the legacy alias of super_admin) ──
router.get("/users/:id", restrictTo("admin"), getUserById);
router.patch("/users/:id/role", restrictTo("admin"), changeRole);
router.patch("/users/:id/verify", restrictTo("admin"), verifyUser);
router.patch("/users/:id/status", restrictTo("admin"), setStatus);

export default router;
