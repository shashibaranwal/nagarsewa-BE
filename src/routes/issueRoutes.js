import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import {
  createIssueEvent, getIssue, rankedIssues, getIssueEvents, listIssueReports, listIssues, listReviews, mergeIssue, nearbyIssues, reconcile, resolveReview, similarIssues, updateIssue,
} from "../controllers/issueController.js";

const router = Router();
const expensive = rateLimit({ windowMs: 60_000, max: 60 });

router.use(protect);

// Static paths must be registered before "/:id".
router.get("/", expensive, listIssues);
router.get("/nearby", expensive, nearbyIssues);
router.get("/ranking", expensive, rankedIssues);
router.get("/reviews", listReviews);
router.post("/reviews/:reviewId/resolve", resolveReview);
router.post("/reconcile", reconcile);

router.get("/:id", getIssue);
router.patch("/:id", updateIssue);
router.get("/:id/reports", listIssueReports);
router.get("/:id/events", getIssueEvents);
router.post("/:id/events", rateLimit({ windowMs: 60_000, max: 30 }), createIssueEvent);
router.get("/:id/similar", expensive, similarIssues);
router.post("/:id/merge", mergeIssue);

export default router;
