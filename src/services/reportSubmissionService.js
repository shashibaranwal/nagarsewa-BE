import Report from "../models/Report.js";
import Ward from "../models/Ward.js";
import MatchReview from "../models/MatchReview.js";
import { evaluateMatch, toReviewCandidates } from "./issueMatchingService.js";
import { acquireLock, isLockHeld, lockKeyFor, releaseLock } from "./matchingLockService.js";
import { createIssueForReport, linkReportToIssue, recordEvent } from "./issueService.js";
import { runInTransaction } from "./transaction.js";
import { AppError } from "../utils/AppError.js";

// Scope comes from the reporter's ward (the only reliable server-side data that exists).
export const resolveReporterScope = async (user) => {
  if (!user.wardId) return { ward: null, municipality: null };
  const ward = await Ward.findById(user.wardId).select("municipality isActive").lean();
  return ward ? { ward: ward._id, municipality: ward.municipality } : { ward: null, municipality: null };
};

const queueForReview = async ({ report, reason, candidates = [], config = {}, session }) => {
  await Report.updateOne({ _id: report._id, issue: null }, { $set: { matchingDecision: "pending_review" } }, { session });
  const review = new MatchReview({
    report: report._id,
    category: report.category,
    municipality: report.municipality ?? null,
    ward: report.ward ?? null,
    candidates: toReviewCandidates(candidates),
    reason,
    config,
    history: [{ action: "queued", reason }],
  });
  await review.save({ session });
  // Leave an audit trail on each suggested candidate Issue.
  for (const candidate of candidates) {
    await recordEvent({ issue: candidate.issueId, eventType: "matching_suggested", relatedReport: report._id, metadata: { score: candidate.score, distanceMeters: candidate.distanceMeters, textSimilarity: candidate.textSimilarity, reason } }, session);
  }
  return review;
};

// Applies a matching outcome to a persisted Report inside an open transaction.
export const applyDecision = async ({ report, evaluation, degradedReason, session }) => {
  if (degradedReason) {
    await queueForReview({ report, reason: degradedReason, session });
    return { decision: "pending_review", reviewRequired: true, issue: null, reason: degradedReason };
  }
  if (evaluation.decision === "auto_linked") {
    try {
      const issue = await linkReportToIssue({ report, issueId: evaluation.chosen.issueId, matching: evaluation, decision: evaluation.matchType || "auto_linked", session });
      return { decision: "auto_linked", matchingDecision: evaluation.matchType || "auto_linked", reviewRequired: false, issue, reason: evaluation.reason };
    } catch (error) {
      if (error.code !== "ISSUE_NOT_ELIGIBLE") throw error;
      await queueForReview({ report, reason: "candidate_changed", candidates: [evaluation.chosen], config: evaluation.config, session });
      return { decision: "pending_review", reviewRequired: true, issue: null, reason: "candidate_changed" };
    }
  }
  if (evaluation.decision === "pending_review") {
    await queueForReview({ report, reason: evaluation.reason, candidates: evaluation.candidates, config: evaluation.config, session });
    return { decision: "pending_review", reviewRequired: true, issue: null, reason: evaluation.reason };
  }
  const issue = await createIssueForReport({ report, matching: evaluation, decision: "new_issue", session });
  return { decision: "new_issue", reviewRequired: false, issue, reason: evaluation.reason };
};

// Runs `fn` while holding the (category, municipality) matching lock. Lock/matching failure never
// creates an Issue: the caller receives `degradedReason` and must queue the report for review.
export const withMatching = async (subject, fn) => {
  const key = lockKeyFor(subject.category, subject.municipality);
  let lock = null;
  let evaluation = null;
  let degradedReason = null;
  try {
    lock = await acquireLock(key);
    evaluation = await evaluateMatch(subject);
  } catch (error) {
    degradedReason = error.code === "MATCH_LOCK_TIMEOUT" ? "lock_timeout" : "matching_unavailable";
    console.error(`[MATCHING] degraded (${degradedReason}): ${error.message}`);
  }
  try {
    return await fn({ evaluation, degradedReason, lock });
  } finally {
    if (lock) await releaseLock(lock).catch((error) => console.error(`[MATCHING] lock release failed: ${error.message}`));
  }
};

const assertLock = async (lock, session) => {
  if (lock && !(await isLockHeld(lock, session))) throw new AppError(503, "Matching lease expired, please retry", "MATCH_LOCK_LOST");
};

// POST /api/reports workflow: persist the Report and its Issue association atomically.
export const submitReportWithMatching = async ({ data, user, images }) => {
  const scope = await resolveReporterScope(user);
  const subject = { ...data, ward: scope.ward, municipality: scope.municipality };
  return withMatching(subject, ({ evaluation, degradedReason, lock }) =>
    runInTransaction(async (session) => {
      await assertLock(lock, session);
      const report = new Report({
        ...data,
        reporter: user._id,
        images,
        ward: scope.ward,
        municipality: scope.municipality,
        statusHistory: [{ from: null, to: "submitted", actor: user._id, actorRole: user.role, reason: "Report submitted" }],
      });
      await report.save({ session });
      const outcome = await applyDecision({ report, evaluation, degradedReason, session });
      const fresh = await Report.findById(report._id).session(session).lean();
      return { report: fresh, ...outcome };
    })
  );
};

// Used by the backfill script: places already-persisted, unassociated Reports.
export const placeExistingReport = async (reportId) => {
  const existing = await Report.findById(reportId).lean();
  if (!existing || existing.issue || ["withdrawn", "rejected"].includes(existing.status) || existing.matchingDecision) return null;
  return withMatching(existing, ({ evaluation, degradedReason, lock }) =>
    runInTransaction(async (session) => {
      await assertLock(lock, session);
      const report = await Report.findById(reportId).session(session);
      if (!report || report.issue || report.matchingDecision) return null;
      return applyDecision({ report, evaluation, degradedReason, session });
    })
  );
};

