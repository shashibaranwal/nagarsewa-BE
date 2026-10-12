import Issue, { ELIGIBLE_ISSUE_STATUSES } from "../models/Issue.js";
import { actorOf, recordEvent, systemActor } from "./issueEventService.js";
import Report from "../models/Report.js";
import { getMatchingConfig, MATCHING_METHOD } from "../config/matching.js";
import { normalizeText } from "../utils/textSimilarity.js";
import { AppError } from "../utils/AppError.js";
import { isLegacyMatching } from "../config/geoMatching.js";
import { computeScore, deriveSeverity, recomputeIssueScore, scoreLevel } from "./issueScoreService.js";

export { actorOf, recordEvent, systemActor };

const textSample = (report, config) =>
  normalizeText(`${report.title}. ${report.description}`).slice(0, config.sampleChars);

const matchingFields = (matching, decision, reviewer) => {
  const factors = matching?.chosen
    ? {
        distanceMeters: matching.chosen.distanceMeters,
        textSimilarity: matching.chosen.textSimilarity,
        wardRelation: matching.chosen.wardRelation,
        categoryMatch: true,
        sharedTokens: matching.chosen.sharedTokens,
      }
    : null;
  return {
    matchingMethod: matching?.config?.method ?? MATCHING_METHOD,
    matchingScore: matching?.chosen?.score ?? null,
    matchingThreshold: matching?.config?.autoThreshold ?? null,
    matchingFactors: factors,
    matchingDecision: decision,
    matchingReviewedBy: reviewer?.id ?? null,
    matchingReviewedAt: reviewer?.id ? new Date() : null,
  };
};

// Follows mergedInto pointers (bounded) to the surviving Issue.
export const resolveCanonicalIssue = async (issueId, session = null) => {
  let current = await Issue.findById(issueId).session(session);
  for (let hops = 0; current && current.status === "merged" && current.mergedInto && hops < 10; hops += 1) {
    current = await Issue.findById(current.mergedInto).session(session);
  }
  return current;
};

// Creates a new Issue seeded from `report` and links the report to it.
export const createIssueForReport = async ({ report, matching = null, decision = "new_issue", actor = systemActor, reason = "", session = null }) => {
  const config = getMatchingConfig();
  const severity = deriveSeverity(report);
  const startScore = computeScore({ uniqueReporters: 1, severity, category: report.category, firstReportedAt: report.createdAt });
  const issue = new Issue({
    category: report.category,
    summary: report.title,
    description: report.description || "",
    uniqueReporters: 1,
    severity,
    score: startScore,
    priority: scoreLevel(startScore),
    scoreComputedAt: new Date(),
    location: { type: "Point", coordinates: report.location.coordinates },
    municipality: report.municipality ?? null,
    ward: report.ward ?? null,
    status: "open",
    reportCount: 1,
    firstReportedAt: report.createdAt,
    lastReportedAt: report.createdAt,
    matchTexts: [textSample(report, config)],
    ...matchingFields(matching, decision, actor.id ? actor : null),
  });
  await issue.save({ session });
  await recordEvent({ issue: issue._id, eventType: "issue_created", actor, reason, relatedReport: report._id, metadata: { category: issue.category, decision } }, session);
  const linked = await Report.updateOne(
    { _id: report._id, issue: null },
    { $set: { issue: issue._id, matchingDecision: decision === "manually_linked" ? "manually_linked" : "new_issue" } },
    { session }
  );
  if (linked.modifiedCount !== 1) throw new AppError(409, "Report is already associated with an issue", "REPORT_ALREADY_LINKED");
  await recordEvent({ issue: issue._id, eventType: "report_linked", actor, relatedReport: report._id, metadata: { decision } }, session);
  return issue;
};

// Links an existing report to an existing eligible Issue. The Issue is updated first (guarded by
// eligibility) so that an ineligible target aborts before any Report mutation.
export const linkReportToIssue = async ({ report, issueId, matching = null, decision, actor = systemActor, reason = "", session = null }) => {
  const config = getMatchingConfig();
  const sample = textSample(report, config);
  // A citizen repeating a report on the same issue is linked but must not inflate the counts.
  const alreadyCounted = Boolean(
    await Report.exists({ issue: issueId, reporter: report.reporter, _id: { $ne: report._id }, status: { $nin: ["withdrawn", "rejected"] } }).session(session)
  );
  const increment = alreadyCounted ? 0 : 1;
  const issue = await Issue.findOneAndUpdate(
    { _id: issueId, status: { $in: ELIGIBLE_ISSUE_STATUSES }, category: report.category, ...(isLegacyMatching() && { municipality: report.municipality ?? null }) },
    [
      {
        $set: {
          reportCount: { $add: ["$reportCount", increment] },
          uniqueReporters: { $add: [{ $ifNull: ["$uniqueReporters", 0] }, increment] },
          lastReportedAt: { $max: ["$lastReportedAt", report.createdAt] },
          firstReportedAt: { $min: ["$firstReportedAt", report.createdAt] },
          matchTexts: { $slice: [{ $concatArrays: [{ $ifNull: ["$matchTexts", []] }, [sample]] }, -config.textSamples] },
          ...Object.fromEntries(Object.entries(matchingFields(matching, decision, actor.id ? actor : null)).map(([k, v]) => [k, { $literal: v }])),
          updatedAt: "$$NOW",
        },
      },
    ],
    { returnDocument: "after", updatePipeline: true, session }
  );
  if (!issue) throw new AppError(409, "Issue is no longer eligible to receive reports", "ISSUE_NOT_ELIGIBLE");
  const linked = await Report.updateOne(
    { _id: report._id, issue: null },
    { $set: { issue: issue._id, matchingDecision: decision } },
    { session }
  );
  if (linked.modifiedCount !== 1) throw new AppError(409, "Report is already associated with an issue", "REPORT_ALREADY_LINKED");
  await recomputeIssueScore(issue._id, { session });
  await recordEvent(
    {
      issue: issue._id,
      eventType: "report_linked",
      actor,
      reason,
      relatedReport: report._id,
      metadata: { decision, countedReporter: !alreadyCounted, ...(matching?.chosen && { score: matching.chosen.score, distanceMeters: matching.chosen.distanceMeters, textSimilarity: matching.chosen.textSimilarity }) },
    },
    session
  );
  return Issue.findById(issue._id).session(session); // fresh score/priority after the recompute
};

// Withdrawal keeps the Report associated (history) but removes it from the active count.
// Removes `report`'s citizen from the issue counts unless they still have another live report on it.
export const uncountReporter = async (report, session = null) => {
  const stillCounted = await Report.exists({
    issue: report.issue, reporter: report.reporter, _id: { $ne: report._id }, status: { $nin: ["withdrawn", "rejected"] },
  }).session(session);
  if (stillCounted) return false;
  await Issue.updateOne(
    { _id: report.issue },
    [{ $set: {
      reportCount: { $max: [0, { $subtract: ["$reportCount", 1] }] },
      uniqueReporters: { $max: [0, { $subtract: [{ $ifNull: ["$uniqueReporters", 0] }, 1] }] },
    } }],
    { session }
  );
  await recomputeIssueScore(report.issue, { session });
  return true;
};

export const handleReportWithdrawn = async (report, actor, session = null) => {
  if (!report.issue) return;
  await uncountReporter(report, session);
  await recordEvent({ issue: report.issue, eventType: "report_unlinked", actor, relatedReport: report._id, reason: "Report withdrawn by citizen", metadata: { cause: "withdrawn" } }, session);
};

// Authoritative recount from Reports (policy: active = not withdrawn/rejected). Safe to run repeatedly.
export const reconcileIssueCounts = async () => {
  const stats = await Report.aggregate([
    { $match: { issue: { $ne: null } } },
    {
      $group: {
        _id: "$issue",
        reporters: { $addToSet: { $cond: [{ $not: [{ $in: ["$status", ["withdrawn", "rejected"]] }] }, "$reporter", "$$REMOVE"] } },
        first: { $min: "$createdAt" },
        last: { $max: "$createdAt" },
      },
    },
  ]);
  const byIssue = new Map(stats.map((s) => [s._id.toString(), s]));
  const issues = await Issue.find({}).select("reportCount uniqueReporters firstReportedAt lastReportedAt status").lean();
  const ops = [];
  for (const issue of issues) {
    const stat = byIssue.get(issue._id.toString());
    const expected = issue.status === "merged" ? 0 : stat?.reporters?.length ?? 0;
    if (issue.reportCount !== expected || (issue.uniqueReporters ?? 0) !== expected) {
      ops.push({
        updateOne: {
          filter: { _id: issue._id },
          update: { $set: { reportCount: expected, uniqueReporters: expected, ...(stat && issue.status !== "merged" && { firstReportedAt: stat.first, lastReportedAt: stat.last }) } },
        },
      });
    }
  }
  if (ops.length) {
    await Issue.bulkWrite(ops);
    for (const op of ops) {
      await recordEvent({ issue: op.updateOne.filter._id, eventType: "system_action", summary: "Report counts were reconciled automatically.", metadata: { action: "reconcile_counts", set: op.updateOne.update.$set } });
    }
  }
  return { issuesChecked: issues.length, issuesCorrected: ops.length };
};
