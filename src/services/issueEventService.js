import mongoose from "mongoose";
import Issue from "../models/Issue.js";
import IssueEvent from "../models/IssueEvent.js";
import { sanitizeText } from "../utils/sanitize.js";
import { AppError } from "../utils/AppError.js";

export const systemActor = { id: null, role: "system" };
export const actorOf = (user) => (user ? { id: user._id, role: user.role } : systemActor);

export const actorTypeOf = (role) => {
  if (role === "system") return "system";
  if (role === "admin" || role === "super_admin") return "admin";
  if (role === "ward_admin") return "staff";
  return "citizen";
};

// Who may see an event type by default. Callers can override (e.g. public vs internal notes),
// but only server-side code ever reaches this function.
export const DEFAULT_VISIBILITY = {
  issue_created: "public",
  department_assigned: "public",
  status_changed: "public",
  issue_reopened: "public",
  issue_cancelled: "public",
  resolution_submitted: "public",
  note_added: "internal",
  report_linked: "internal",
  report_unlinked: "internal",
  matching_suggested: "internal",
  matching_reviewed: "internal",
  priority_changed: "internal",
  deadline_updated: "internal",
  summary_changed: "internal",
  issue_merged: "internal",
  system_action: "internal",
  deadline_breached: "internal",
  issue_escalated: "internal",
};

const STATUS_LABEL = {
  open: "The issue was returned for further verification.",
  under_review: "The issue is being reviewed by the municipal team.",
  assigned: "The issue has been assigned to a responsible department.",
  in_progress: "Work has started on this issue.",
  resolved: "The issue has been marked as resolved.",
  closed: "The issue has been closed.",
};

// Citizen-safe default text. Never include actor names, reasons, notes or other reporters' data.
export const defaultSummary = (eventType, details = {}, context = {}) => {
  switch (eventType) {
    case "issue_created": return "Your issue was received and is awaiting review.";
    case "status_changed": return STATUS_LABEL[details.newStatus] || "The issue status was updated.";
    case "department_assigned":
      return context.departmentName ? `This issue has been assigned to the ${context.departmentName}.` : "The responsible department for this issue was updated.";
    case "issue_reopened": return "This issue has been reopened for further review.";
    case "issue_cancelled": return "This issue has been cancelled.";
    case "report_linked": return "A report was linked to this issue.";
    case "report_unlinked": return "A report was removed from this issue's active count.";
    case "matching_suggested": return "Possible duplicate issue suggested for review.";
    case "matching_reviewed": return "A staff member reviewed a duplicate-matching decision.";
    case "priority_changed": return `Priority changed from ${details.from ?? "?"} to ${details.to ?? "?"}.`;
    case "deadline_updated": return "The deadline was updated.";
    case "summary_changed": return "The issue summary was edited.";
    case "issue_merged": return "This issue was merged with a duplicate issue.";
    case "resolution_submitted": return "The issue has been marked as resolved.";
    case "deadline_breached": return "The resolution deadline for this issue has passed.";
    case "issue_escalated": return "The issue was escalated because its deadline was missed.";
    case "system_action": return "An automated system action was performed.";
    default: return "The issue was updated.";
  }
};

// The single place where IssueEvents are created. Pass `session` to commit atomically with the
// Issue mutation. `idempotencyKey` makes retries return the original event instead of a duplicate.
export const recordEvent = async (
  {
    issue, eventType, actor = systemActor, reason = "", metadata = {}, relatedReport = null, relatedIssue = null,
    summary, visibility, details = {}, idempotencyKey, context = {},
  },
  session = null
) => {
  const merged = {
    ...details,
    ...(relatedReport && !details.relatedReportId && { relatedReportId: relatedReport }),
  };
  // Free-form legacy "metadata" values that are structural facts are mirrored into typed details.
  if (metadata?.from !== undefined && eventType === "status_changed") merged.previousStatus ??= metadata.from;
  if (metadata?.to !== undefined && eventType === "status_changed") merged.newStatus ??= metadata.to;

  const event = new IssueEvent({
    issue,
    eventType,
    actor: actor.id ?? null,
    actorRole: actor.role,
    actorType: actorTypeOf(actor.role),
    visibility: visibility ?? DEFAULT_VISIBILITY[eventType] ?? "internal",
    summary: sanitizeText(summary || defaultSummary(eventType, { ...merged, ...(metadata || {}) }, context), { maxLength: 1000 }) || "Issue updated",
    reason: sanitizeText(reason, { maxLength: 1000 }),
    details: merged,
    metadata,
    relatedReport,
    relatedIssue,
    ...(idempotencyKey && { idempotencyKey }),
  });
  await event.save({ session });
  await Issue.updateOne({ _id: issue }, { $max: { lastEventAt: event.timestamp } }, { session });
  return event;
};

export const findEventByIdempotencyKey = (issueId, key, session = null) =>
  key ? IssueEvent.findOne({ issue: issueId, idempotencyKey: key }).session(session) : null;

export const parseIdempotencyKey = (header) => {
  if (header === undefined) return undefined;
  if (typeof header !== "string" || !/^[A-Za-z0-9_\-:.]{8,100}$/.test(header)) {
    throw new AppError(400, "Idempotency-Key must be 8-100 characters (letters, digits, _ - : .)", "VALIDATION_ERROR");
  }
  return header;
};

// Paginated, deterministically ordered query (timestamp ASC, _id ASC). `visibilities` is always
// derived from the requester's role by the caller - never from raw client input alone.
export const listIssueEvents = async (issueId, { visibilities, eventType, page, limit }) => {
  const filter = { issue: new mongoose.Types.ObjectId(issueId), visibility: { $in: visibilities } };
  if (eventType) filter.eventType = eventType;
  const [events, total] = await Promise.all([
    IssueEvent.find(filter).sort({ timestamp: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    IssueEvent.countDocuments(filter),
  ]);
  return { events, total };
};
