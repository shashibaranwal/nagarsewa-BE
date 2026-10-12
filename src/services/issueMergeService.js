import Issue, { ELIGIBLE_ISSUE_STATUSES } from "../models/Issue.js";
import Report from "../models/Report.js";
import { actorOf, recordEvent, resolveCanonicalIssue } from "./issueService.js";
import { runInTransaction } from "./transaction.js";
import { scoreUpdateFor } from "./issueScoreService.js";
import { acquireLock, lockKeyFor, releaseLock } from "./matchingLockService.js";
import { getMatchingConfig } from "../config/matching.js";
import { AppError } from "../utils/AppError.js";

const MERGEABLE_SOURCE_STATUSES = [...ELIGIBLE_ISSUE_STATUSES, "resolved", "closed"];

// Deterministic merge rules: the canonical (target) Issue keeps its location, priority, department,
// deadline, status and summary. Differing source values are preserved in the merge event metadata.
// Reports are re-pointed (never copied or edited); the source Issue is kept with status "merged".
export const mergeIssues = async ({ sourceId, targetId, reason, user, reviewedMatching = null }) => {
  if (!reason || typeof reason !== "string" || reason.trim().length < 5) throw new AppError(400, "reason is required (min 5 characters)", "VALIDATION_ERROR");
  const actor = actorOf(user);
  const config = getMatchingConfig();

  // Serialize with report matching in the same (category, municipality) scope.
  const pre = await Issue.findById(sourceId).select("category municipality").lean();
  if (!pre) throw new AppError(404, "Source issue not found");
  const lock = await acquireLock(lockKeyFor(pre.category, pre.municipality));
  try {
    return await doMerge();
  } finally {
    await releaseLock(lock).catch((error) => console.error(`[MERGE] lock release failed: ${error.message}`));
  }

  function doMerge() {
  return runInTransaction(async (session) => {
    const source = await Issue.findById(sourceId).select("+matchTexts").session(session);
    if (!source) throw new AppError(404, "Source issue not found");
    if (source.status === "merged") throw new AppError(409, "Source issue is already merged", "ALREADY_MERGED");
    const target = await resolveCanonicalIssue(targetId, session);
    if (!target) throw new AppError(404, "Target issue not found");
    const targetFull = await Issue.findById(target._id).select("+matchTexts").session(session);

    if (source._id.equals(targetFull._id)) throw new AppError(422, "An issue cannot be merged into itself or its own canonical issue", "MERGE_CYCLE");
    if (targetFull.mergedInto && targetFull.mergedInto.equals(source._id)) throw new AppError(422, "Merge would create a cycle", "MERGE_CYCLE");
    if (["cancelled", "merged"].includes(targetFull.status)) throw new AppError(422, "Target issue is not eligible for merging", "INVALID_MERGE");
    if (!MERGEABLE_SOURCE_STATUSES.includes(source.status)) throw new AppError(422, `Source issue in status "${source.status}" cannot be merged`, "INVALID_MERGE");
    if (source.category !== targetFull.category) throw new AppError(422, "Issues must share the same category", "INVALID_MERGE");
    if ((source.municipality ?? null) !== (targetFull.municipality ?? null)) throw new AppError(422, "Cross-municipality merges are not permitted", "INVALID_MERGE");

    const now = new Date();
    const moved = await Report.updateMany({ issue: source._id }, { $set: { issue: targetFull._id } }, { session });

    // Authoritative recount from Reports (active = not withdrawn).
    const [stats] = await Report.aggregate([
      { $match: { issue: targetFull._id } },
      { $group: { _id: null, reporters: { $addToSet: { $cond: [{ $not: [{ $in: ["$status", ["withdrawn", "rejected"]] }] }, "$reporter", "$$REMOVE"] } }, first: { $min: "$createdAt" }, last: { $max: "$createdAt" } } },
    ]).session(session);

    const mergedTexts = [...(targetFull.matchTexts || []), ...(source.matchTexts || [])].slice(-config.textSamples);
    const differences = {};
    if (source.priority !== targetFull.priority) differences.priority = source.priority;
    if (source.department && String(source.department) !== String(targetFull.department)) differences.department = source.department;
    if (source.deadline && String(source.deadline) !== String(targetFull.deadline)) differences.deadline = source.deadline;
    if (source.status !== targetFull.status) differences.status = source.status;
    if (source.summary !== targetFull.summary) differences.summary = source.summary;
    differences.location = source.location.coordinates;

    targetFull.reportCount = stats?.reporters?.length ?? 0;
    targetFull.uniqueReporters = targetFull.reportCount;
    targetFull.firstReportedAt = stats?.first ?? targetFull.firstReportedAt;
    targetFull.lastReportedAt = stats?.last ?? targetFull.lastReportedAt;
    targetFull.matchTexts = mergedTexts;
    Object.assign(targetFull, scoreUpdateFor(targetFull, now).set);
    await targetFull.save({ session });

    source.status = "merged";
    source.mergedInto = targetFull._id;
    source.mergedAt = now;
    source.mergedBy = user._id;
    source.mergeReason = reason.trim();
    source.reportCount = 0;
    source.uniqueReporters = 0;
    await source.save({ session });

    // Flatten earlier chains (A->source becomes A->target).
    await Issue.updateMany({ mergedInto: source._id }, { $set: { mergedInto: targetFull._id } }, { session });

    const metadata = { reportsMoved: moved.modifiedCount, resultingReportCount: targetFull.reportCount, sourceValues: differences, ...(reviewedMatching && { reviewedMatching: JSON.stringify(reviewedMatching).slice(0, 500) }) };
    await recordEvent({ issue: targetFull._id, eventType: "issue_merged", actor, reason, relatedIssue: source._id, details: { sourceIssueId: source._id, targetIssueId: targetFull._id }, summary: "Duplicate issue merged into this issue.", metadata: { role: "target", ...metadata } }, session);
    await recordEvent({ issue: source._id, eventType: "issue_merged", actor, reason, relatedIssue: targetFull._id, details: { sourceIssueId: source._id, targetIssueId: targetFull._id }, summary: "This issue was merged into another issue.", metadata: { role: "source", ...metadata } }, session);

    return {
      sourceIssueId: source._id,
      targetIssueId: targetFull._id,
      reportsReassociated: moved.modifiedCount,
      reportCount: targetFull.reportCount,
      mergedAt: now,
      mergedBy: user._id,
      reason: reason.trim(),
    };
  });
  }
};
