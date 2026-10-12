import { ISSUE_PRIORITIES } from "../models/Issue.js";
import { AppError } from "../utils/AppError.js";
import { sanitizeText } from "../utils/sanitize.js";
import { requireId, validateIssueUpdate } from "./issueValidator.js";

const bad = (message) => new AppError(400, message, "VALIDATION_ERROR");

const only = (body, allowed) => {
  const unknown = Object.keys(body || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) throw bad(`Fields not allowed: ${unknown.join(", ")}`);
  return body || {};
};

export const validateStatusBody = (raw) => {
  const body = only(raw, ["status", "reason", "resolutionSummary", "expectedStatus"]);
  if (body.status === undefined) throw bad("status is required");
  return validateIssueUpdate(body);
};

export const validateAssignBody = (raw) => {
  const body = only(raw, ["department", "assignedTo", "reason", "expectedStatus"]);
  if (body.department === undefined && body.assignedTo === undefined) throw bad("department and/or assignedTo is required (null clears)");
  return validateIssueUpdate(body);
};

// Escalations (high/critical) must carry a reason; the reason is stored as priorityReason too.
export const validatePriorityBody = (raw) => {
  const body = only(raw, ["priority", "reason", "expectedStatus"]);
  if (!ISSUE_PRIORITIES.includes(body.priority)) throw bad(`priority must be one of: ${ISSUE_PRIORITIES.join(", ")}`);
  const reason = sanitizeText(body.reason, { maxLength: 500 });
  if (["high", "critical"].includes(body.priority) && reason.length < 5) throw new AppError(422, "A reason (min 5 characters) is required for high/critical priority", "REASON_REQUIRED");
  return validateIssueUpdate({ priority: body.priority, priorityReason: reason, reason, ...(body.expectedStatus && { expectedStatus: body.expectedStatus }) });
};

const MAX_DEADLINE_MS = 2 * 365 * 24 * 3600 * 1000;
export const validateDeadlineBody = (raw, currentDeadline) => {
  const body = only(raw, ["deadline", "reason", "expectedStatus"]);
  if (body.deadline === undefined) throw bad("deadline is required (ISO date, or null to clear)");
  const reason = sanitizeText(body.reason, { maxLength: 1000 });
  if (body.deadline !== null) {
    const date = new Date(body.deadline);
    if (Number.isNaN(date.getTime())) throw bad("deadline must be a valid ISO date");
    if (date.getTime() <= Date.now()) throw new AppError(422, "deadline must be in the future", "INVALID_DEADLINE");
    if (date.getTime() - Date.now() > MAX_DEADLINE_MS) throw new AppError(422, "deadline is too far in the future (max 2 years)", "INVALID_DEADLINE");
  }
  // Revising or clearing an existing deadline requires a recorded reason.
  if (currentDeadline && reason.length < 5) throw new AppError(422, "A reason (min 5 characters) is required to revise or clear a deadline", "REASON_REQUIRED");
  return validateIssueUpdate({ deadline: body.deadline, reason, ...(body.expectedStatus && { expectedStatus: body.expectedStatus }) });
};

export const validateReviewBody = (raw) => {
  const body = only(raw, ["decision", "reason"]);
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 1000)) throw bad("reason must be at most 1000 characters");
  return body;
};

export { requireId };
