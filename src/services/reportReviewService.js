import Report from "../models/Report.js";
import User from "../models/User.js";
import Issue from "../models/Issue.js";
import MatchReview, { OPEN_REVIEW_STATUSES } from "../models/MatchReview.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { actorOf, recordEvent } from "./issueEventService.js";
import { uncountReporter } from "./issueService.js";
import { runInTransaction } from "./transaction.js";
import { AppError } from "../utils/AppError.js";
import { sanitizeText } from "../utils/sanitize.js";

// Ward scope for reports: the report's captured ward, or (legacy reports) the reporter's ward.
export const reportInWardScope = async (user, report) => {
  if (user.role !== "ward_admin") return true;
  if (!user.wardId) return false;
  if (report.ward) return report.ward.toString() === user.wardId.toString();
  const reporter = await User.findById(report.reporter).select("wardId").lean();
  return reporter?.wardId?.toString() === user.wardId.toString();
};

export const REVIEW_DECISIONS = ["accept", "reject"];

// accept: submitted -> under_review.  reject: submitted|under_review -> rejected (reason required).
// The reason is stored in the report's statusHistory, which the reporting citizen can read, so it
// must be written for them. Rejection removes the report from its issue's active count.
export const reviewReport = async ({ reportId, user, decision, reason }) => {
  if (!REVIEW_DECISIONS.includes(decision)) throw new AppError(400, `decision must be one of: ${REVIEW_DECISIONS.join(", ")}`, "VALIDATION_ERROR");
  const cleanReason = sanitizeText(reason, { maxLength: 1000 });
  if (decision === "reject" && cleanReason.length < 5) throw new AppError(422, "A reason (min 5 characters) is required to reject a report", "REASON_REQUIRED");
  const actor = actorOf(user);

  return runInTransaction(async (session) => {
    const report = await Report.findById(reportId).session(session).lean();
    if (!report || !(await reportInWardScope(user, report))) throw new AppError(404, "Report not found");
    const allowedFrom = decision === "accept" ? ["submitted"] : ["submitted", "under_review"];
    if (!allowedFrom.includes(report.status)) {
      throw new AppError(409, `Report is "${report.status}" and cannot be ${decision}ed`, "REPORT_STATE_CONFLICT");
    }
    const to = decision === "accept" ? "under_review" : "rejected";
    const updated = await Report.findOneAndUpdate(
      { _id: report._id, status: report.status },
      { $set: { status: to }, $push: { statusHistory: { from: report.status, to, actor: user._id, actorRole: user.role, reason: cleanReason || "Accepted for review" } } },
      { returnDocument: "after", session }
    ).lean();
    if (!updated) throw new AppError(409, "Report was modified by someone else. Refresh and retry.", "REPORT_STATE_CONFLICT");

    if (decision === "reject") {
      if (report.issue) {
        await uncountReporter(report, session);
        await recordEvent({
          issue: report.issue, eventType: "report_unlinked", actor, reason: cleanReason, relatedReport: report._id,
          summary: "A report was removed from this issue's active count after review.",
          details: { reasonCode: "rejected" },
        }, session);
      }
      await MatchReview.updateOne(
        { report: report._id, status: { $in: OPEN_REVIEW_STATUSES } },
        { $set: { status: "rejected", decision: "report_rejected", decisionReason: cleanReason, reviewer: user._id, reviewedAt: new Date() } },
        { session }
      );
    }
    await new AdminAuditLog({
      action: decision === "accept" ? "report_accepted" : "report_rejected",
      actor: user._id, actorRole: user.role, targetReport: report._id, targetIssue: report.issue ?? null,
      before: { status: report.status }, after: { status: to }, reason: cleanReason,
    }).save({ session });
    return updated;
  });
};
