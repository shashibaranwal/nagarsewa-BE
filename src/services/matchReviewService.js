import Report from "../models/Report.js";
import MatchReview, { OPEN_REVIEW_STATUSES } from "../models/MatchReview.js";
import { acquireLock, isLockHeld, lockKeyFor, releaseLock } from "./matchingLockService.js";
import { createIssueForReport, linkReportToIssue, actorOf, recordEvent, resolveCanonicalIssue } from "./issueService.js";
import { runInTransaction } from "./transaction.js";
import { AppError } from "../utils/AppError.js";

export const REVIEW_ACTIONS = ["link", "new_issue", "defer", "request_verification"];

export const resolveMatchReview = async ({ reviewId, user, action, issueId, reason }) => {
  if (!REVIEW_ACTIONS.includes(action)) throw new AppError(400, `action must be one of: ${REVIEW_ACTIONS.join(", ")}`, "VALIDATION_ERROR");
  if (!reason || reason.trim().length < 3) throw new AppError(400, "reason is required", "VALIDATION_ERROR");
  const review = await MatchReview.findById(reviewId);
  if (!review) throw new AppError(404, "Review not found");
  if (user.role === "ward_admin" && (!user.wardId || review.ward?.toString() !== user.wardId.toString())) throw new AppError(404, "Review not found");
  if (!OPEN_REVIEW_STATUSES.includes(review.status)) throw new AppError(409, "Review has already been resolved", "REVIEW_ALREADY_RESOLVED");

  const actor = actorOf(user);
  const history = { action, actor: actor.id, actorRole: actor.role, reason: reason.trim(), at: new Date() };

  if (action === "defer" || action === "request_verification") {
    const status = action === "defer" ? "deferred" : "in_review";
    const updated = await MatchReview.findOneAndUpdate(
      { _id: review._id, status: { $in: OPEN_REVIEW_STATUSES } },
      { $set: { status, reviewer: user._id }, $push: { history } },
      { returnDocument: "after" }
    );
    if (!updated) throw new AppError(409, "Review has already been resolved", "REVIEW_ALREADY_RESOLVED");
    return { review: updated, issue: null };
  }

  let targetId = null;
  if (action === "link") {
    if (!issueId) throw new AppError(400, "issueId is required to link", "VALIDATION_ERROR");
    const target = await resolveCanonicalIssue(issueId);
    if (!target) throw new AppError(404, "Issue not found");
    if (user.role === "ward_admin" && target.ward?.toString() !== user.wardId?.toString()) throw new AppError(404, "Issue not found");
    targetId = target._id;
  }

  const lock = await acquireLock(lockKeyFor(review.category, review.municipality));
  try {
    return await runInTransaction(async (session) => {
      if (!(await isLockHeld(lock, session))) throw new AppError(503, "Matching lease expired, please retry", "MATCH_LOCK_LOST");
      const fresh = await MatchReview.findById(review._id).session(session);
      if (!fresh || !OPEN_REVIEW_STATUSES.includes(fresh.status)) throw new AppError(409, "Review has already been resolved", "REVIEW_ALREADY_RESOLVED");
      const report = await Report.findById(fresh.report).session(session);
      if (!report || report.issue || ["withdrawn", "rejected"].includes(report.status)) throw new AppError(409, "Report is no longer eligible for matching", "REPORT_NOT_ELIGIBLE");

      let issue;
      if (action === "link") {
        issue = await linkReportToIssue({ report, issueId: targetId, decision: "manually_linked", actor, reason, session });
      } else {
        issue = await createIssueForReport({ report, decision: "new_issue", actor, reason, session });
      }
      await recordEvent({ issue: issue._id, eventType: "matching_reviewed", actor, reason, relatedReport: report._id, metadata: { action, reviewId: fresh._id } }, session);
      fresh.status = action === "link" ? "linked" : "new_issue_created";
      fresh.decision = action;
      fresh.decisionReason = reason.trim();
      fresh.reviewer = user._id;
      fresh.reviewedAt = new Date();
      fresh.resolvedIssue = issue._id;
      fresh.history.push(history);
      await fresh.save({ session });
      return { review: fresh, issue };
    });
  } finally {
    await releaseLock(lock).catch((error) => console.error(`[REVIEW] lock release failed: ${error.message}`));
  }
};
