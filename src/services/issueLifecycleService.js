import { AppError } from "../utils/AppError.js";
import { sanitizeText } from "../utils/sanitize.js";

const STAFF = ["ward_admin", "admin", "super_admin"];
const ADMIN = ["admin", "super_admin"];

// Single source of truth for the Issue lifecycle. Each rule lists who may perform the transition,
// what must accompany it and which event type records it. `merged` is only reachable through the
// merge workflow and is never a valid target here.
export const TRANSITION_RULES = {
  open: {
    under_review: { roles: STAFF },
    cancelled: { roles: ADMIN, reason: true, event: "issue_cancelled" },
  },
  under_review: {
    open: { roles: STAFF, reason: true },
    assigned: { roles: STAFF, requiresDepartment: true },
    cancelled: { roles: ADMIN, reason: true, event: "issue_cancelled" },
  },
  assigned: {
    in_progress: { roles: STAFF },
    under_review: { roles: STAFF, reason: true },
    cancelled: { roles: ADMIN, reason: true, event: "issue_cancelled" },
  },
  in_progress: {
    resolved: { roles: STAFF, resolutionSummary: true, event: "resolution_submitted" },
    assigned: { roles: STAFF, reason: true },
    cancelled: { roles: ADMIN, reason: true, event: "issue_cancelled" },
  },
  resolved: {
    closed: { roles: ADMIN },
    in_progress: { roles: STAFF, reason: true, event: "issue_reopened" }, // resolution rejected / problem persists
  },
  closed: { under_review: { roles: ADMIN, reason: true, event: "issue_reopened" } },
  cancelled: { under_review: { roles: ADMIN, reason: true, event: "issue_reopened" } },
  merged: {},
};

export const ISSUE_TRANSITIONS = Object.fromEntries(Object.entries(TRANSITION_RULES).map(([from, to]) => [from, Object.keys(to)]));

export const allowedTransitions = (from) => ISSUE_TRANSITIONS[from] || [];

const inWardScope = (user, issue) => user.role !== "ward_admin" || (issue.ward && user.wardId && issue.ward.toString() === user.wardId.toString());

// Validates a requested transition and returns everything needed to apply it.
// Throws AppError (never mutates anything) when the transition is not allowed.
export const planTransition = ({ issue, to, user, reason, resolutionSummary, expectedStatus, departmentAfter }) => {
  if (expectedStatus && expectedStatus !== issue.status) {
    throw new AppError(409, `Issue status is "${issue.status}", not "${expectedStatus}". Refresh and retry.`, "ISSUE_CONFLICT");
  }
  if (to === issue.status) throw new AppError(409, `Issue is already "${to}"`, "ISSUE_CONFLICT");
  const rule = TRANSITION_RULES[issue.status]?.[to];
  if (!rule) throw new AppError(422, `Cannot change status from ${issue.status} to ${to}`, "INVALID_TRANSITION");
  if (!rule.roles.includes(user.role) || !inWardScope(user, issue)) {
    throw new AppError(403, `Your role is not permitted to move an issue from ${issue.status} to ${to}`, "TRANSITION_FORBIDDEN");
  }
  const cleanReason = sanitizeText(reason, { maxLength: 1000 });
  const cleanResolution = sanitizeText(resolutionSummary, { maxLength: 1000 });
  if (rule.reason && cleanReason.length < 5) throw new AppError(422, "A reason (min 5 characters) is required for this transition", "REASON_REQUIRED");
  if (rule.resolutionSummary && cleanResolution.length < 5) throw new AppError(422, "A resolutionSummary (min 5 characters) is required to resolve an issue", "RESOLUTION_REQUIRED");
  if (rule.requiresDepartment && !departmentAfter) throw new AppError(422, "A department must be assigned before the issue can be marked assigned", "DEPARTMENT_REQUIRED");

  const now = new Date();
  const set = { status: to, statusChangedAt: now };
  if (to === "resolved") Object.assign(set, { resolutionSummary: cleanResolution, resolvedAt: now, resolvedBy: user._id });
  if (to === "closed") set.closedAt = now;
  if (rule.event === "issue_reopened") Object.assign(set, { resolvedAt: null, closedAt: null, resolutionSummary: "", resolvedBy: null });

  const eventType = rule.event || "status_changed";
  return {
    set,
    event: {
      eventType,
      reason: cleanReason,
      ...(eventType === "resolution_submitted" && { summary: cleanResolution }),
      details: { previousStatus: issue.status, newStatus: to },
    },
  };
};

// Transitions the given user could attempt from `from` (role + ward scope aware); used by queues
// so the UI only offers valid actions. Authoritative checks still happen in planTransition.
export const transitionsFor = (issue, user) =>
  Object.entries(TRANSITION_RULES[issue.status] || {})
    .filter(([, rule]) => rule.roles.includes(user.role) && inWardScope(user, issue))
    .map(([to, rule]) => ({ to, requiresReason: Boolean(rule.reason), requiresResolutionSummary: Boolean(rule.resolutionSummary), requiresDepartment: Boolean(rule.requiresDepartment) }));
