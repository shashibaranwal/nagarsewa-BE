import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import { requireOpsAccess } from "../controllers/adminOperationsController.js";
import { departmentPerformance, issueBreakdown, overview, resolutionTime, trends } from "../controllers/analyticsController.js";

const router = Router();

// Staff only: ward_admin (own ward), admin, super_admin. Aggregations are comparatively expensive.
router.use(protect, requireOpsAccess, rateLimit({ windowMs: 60_000, max: 60 }));

router.get("/overview", overview);
router.get("/issues", issueBreakdown);
router.get("/resolution-time", resolutionTime);
router.get("/department-performance", departmentPerformance);
router.get("/trends", trends);

export default router;
