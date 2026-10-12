import Issue, { PRIORITY_RANK } from "../models/Issue.js";
import { actorOf, findEventByIdempotencyKey, recordEvent } from "./issueEventService.js";
import { planTransition } from "./issueLifecycleService.js";
import { planAssignment } from "./issueAssignmentService.js";
import { recomputeIssueScore } from "./issueScoreService.js";
import { runInTransaction } from "./transaction.js";
import { AppError } from "../utils/AppError.js";
import { sanitizeText } from "../utils/sanitize.js";

// Applies a staff update (status, assignment, summary, priority, deadline) and writes the matching
// IssueEvents in ONE transaction. The Issue is updated with a compare-and-set filter on every field
// being changed, so a concurrent change yields 409 instead of silently overwriting it, and no event
// is written for a mutation that did not happen.
export const updateIssueState = async ({ issueId, update, user, isInScope, idempotencyKey }) => {
  const actor = actorOf(user);
  const replay = async () => {
    const existing = await findEventByIdempotencyKey(issueId, idempotencyKey);
    if (!existing) return null;
    const issue = await Issue.findById(issueId).lean();
    return { issue, events: [existing], changed: false, replayed: true };
  };

  if (idempotencyKey) {
    const previous = await replay();
    if (previous) return previous;
  }

  try {
    return await runInTransaction(async (session) => {
      const issue = await Issue.findById(issueId).session(session).lean();
      if (!issue || !isInScope(issue)) throw new AppError(404, "Issue not found");
      if (issue.status === "merged") throw new AppError(409, "Merged issues cannot be modified", "ALREADY_MERGED");
      if (update.expectedStatus && update.expectedStatus !== issue.status && update.status === undefined) {
        throw new AppError(409, `Issue status is "${issue.status}", not "${update.expectedStatus}". Refresh and retry.`, "ISSUE_CONFLICT");
      }

      const set = {};
      const filter = { _id: issue._id, status: issue.status };
      const events = [];
      const note = sanitizeText(update.reason, { maxLength: 1000 });
      let departmentAfter = issue.department;

      // 1. assignment (so an "assigned" transition in the same request sees the new department)
      if (update.department !== undefined || update.assignedTo !== undefined) {
        const plan = await planAssignment({ issue, user, departmentId: update.department, assigneeId: update.assignedTo, session });
        Object.assign(set, plan.set);
        events.push(...plan.events.map((event) => ({ reason: note, ...event })));
        if ("department" in plan.set) { filter.department = issue.department ?? null; departmentAfter = plan.set.department; }
        if ("assignedTo" in plan.set) filter.assignedTo = issue.assignedTo ?? null;
      }

      // 2. lifecycle transition
      if (update.status !== undefined) {
        const plan = planTransition({
          issue, to: update.status, user, reason: update.reason, resolutionSummary: update.resolutionSummary,
          expectedStatus: update.expectedStatus, departmentAfter,
        });
        Object.assign(set, plan.set);
        events.push(plan.event);
      } else if (update.resolutionSummary !== undefined) {
        throw new AppError(422, "resolutionSummary is only valid together with status: resolved", "VALIDATION_ERROR");
      }

      // 3. plain field edits
      if (update.summary !== undefined && update.summary !== issue.summary) {
        set.summary = update.summary;
        filter.summary = issue.summary;
        events.push({ eventType: "summary_changed", reason: note, metadata: { from: issue.summary, to: update.summary } });
      }
      if (update.priority !== undefined && update.priority !== issue.priority) {
        Object.assign(set, { priority: update.priority, priorityRank: PRIORITY_RANK[update.priority], priorityUpdatedAt: new Date(), priorityUpdatedBy: user._id });
        filter.priority = issue.priority;
        events.push({ eventType: "priority_changed", reason: note, metadata: { from: issue.priority, to: update.priority } });
      }
      if (update.priorityReason !== undefined && update.priorityReason !== issue.priorityReason) set.priorityReason = update.priorityReason;
      if (update.deadline !== undefined && String(update.deadline) !== String(issue.deadline)) {
        set.deadline = update.deadline;
        Object.assign(set, { deadlineSource: "manual", escalationLevel: 0, escalationDeadline: null, escalatedAt: null });
        filter.deadline = issue.deadline ?? null;
        events.push({ eventType: "deadline_updated", reason: note, metadata: { from: issue.deadline, to: update.deadline } });
      }

      if (!Object.keys(set).length) return { issue, events: [], changed: false };

      const updated = await Issue.findOneAndUpdate(filter, { $set: set }, { returnDocument: "after", session }).lean();
      if (!updated) throw new AppError(409, "Issue was modified by someone else. Refresh and retry.", "ISSUE_CONFLICT");

      const created = [];
      for (const [index, event] of events.entries()) {
        created.push(await recordEvent({ issue: issue._id, actor, ...event, ...(index === 0 && idempotencyKey && { idempotencyKey }) }, session));
      }
      let result = updated;
      if (update.status !== undefined && update.status !== issue.status) {
        await recomputeIssueScore(issue._id, { session });
        result = await Issue.findById(issue._id).session(session).lean();
      }
      return { issue: result, events: created, changed: true };
    });
  } catch (error) {
    if (error.code === 11000 && idempotencyKey) {
      const previous = await replay();
      if (previous) return previous;
    }
    throw error;
  }
};
