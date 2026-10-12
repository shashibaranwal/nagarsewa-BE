import mongoose from "mongoose";
import Issue from "../models/Issue.js";
import Report from "../models/Report.js";
import User from "../models/User.js";
import MatchReview, { OPEN_REVIEW_STATUSES } from "../models/MatchReview.js";
import { updateIssueState } from "../services/issueUpdateService.js";
import { parseIdempotencyKey } from "../services/issueEventService.js";
import { audienceFor, serializeEvents } from "../serializers/issueEvent.serializer.js";
import { transitionsFor } from "../services/issueLifecycleService.js";
import { reviewReport } from "../services/reportReviewService.js";
import { staffIssue } from "./issueController.js";
import { AppError } from "../utils/AppError.js";
import { applySearch } from "../services/issueSearchService.js";
import { isValidId, parseIssueFilters, parsePagination, requireId } from "../validators/issueValidator.js";
import { validateAssignBody, validateDeadlineBody, validatePriorityBody, validateReviewBody, validateStatusBody } from "../validators/adminValidator.js";
import { ALLOWED_CATEGORIES } from "../models/Department.js";
import { REPORT_STATUSES } from "../models/Report.js";

const OPEN_STATUSES = ["open", "under_review", "assigned", "in_progress"];
const QUEUE_DEFAULT_STATUSES = [...OPEN_STATUSES, "resolved"];
const toId = (id) => new mongoose.Types.ObjectId(String(id));

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (!error.status && error.name !== "ValidationError") console.error(`[ADMIN_ERROR] ${error.stack || error.message}`);
    const status = error.status || (error.name === "ValidationError" ? 400 : 500);
    res.status(status).json({
      success: false,
      message: status === 500 ? "Server error" : error.message,
      ...(error.code && { error: { code: error.code, details: error.details || [] } }),
    });
  }
};

// Staff (ward_admin / admin / super_admin). ward_admin must have a ward: their scope is that ward.
export const requireOpsAccess = (req, res, next) => {
  const { role, wardId } = req.user;
  if (!["ward_admin", "admin", "super_admin"].includes(role)) return res.status(403).json({ success: false, message: "Access denied. Required role: ward_admin or admin" });
  if (role === "ward_admin" && !wardId) return res.status(403).json({ success: false, message: "Ward scope is not configured" });
  return next();
};

const isWardScoped = (user) => user.role === "ward_admin";
const issueScope = (user) => (isWardScoped(user) ? { ward: user.wardId } : {});
const inIssueScope = (user) => (issue) => !isWardScoped(user) || issue.ward?.toString() === user.wardId.toString();

const assertWardParam = (user, ward) => {
  if (isWardScoped(user) && ward && ward !== user.wardId.toString()) throw new AppError(403, "Outside your ward scope");
};

// ── GET /api/admin/issues ────────────────────────────────────────────────────
export const listAdminIssues = handle(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { filter, sort, search } = parseIssueFilters({ ...req.query, sort: req.query.sort ?? "priority" });
  await applySearch(filter, search);
  assertWardParam(req.user, req.query.ward);
  Object.assign(filter, issueScope(req.user));
  if (!filter.status) filter.status = { $in: req.query.includeClosed === "true" ? [...QUEUE_DEFAULT_STATUSES, "closed", "cancelled"] : QUEUE_DEFAULT_STATUSES };
  if (filter.status === "merged" && req.query.includeMerged !== "true") filter.status = { $in: [] };
  if (req.query.assignedTo !== undefined) filter.assignedTo = requireId(req.query.assignedTo, "assignedTo");
  if (req.query.unassigned === "true") filter.department = null;
  if (req.query.escalated === "true") filter.escalationLevel = { $gte: 1 };
  if (req.query.escalationLevel !== undefined) {
    if (!["1", "2"].includes(req.query.escalationLevel)) throw new AppError(400, "escalationLevel must be 1 or 2", "VALIDATION_ERROR");
    filter.escalationLevel = { $gte: Number(req.query.escalationLevel) };
  }
  if (req.query.overdue === "true") {
    filter.deadline = { $lt: new Date() };
    filter.status = typeof filter.status === "string" ? (OPEN_STATUSES.includes(filter.status) ? filter.status : { $in: [] }) : { $in: OPEN_STATUSES };
  }
  if (sort.deadline && !filter.deadline) filter.deadline = { $ne: null }; // deadline sort lists issues that have one
  const [issues, total] = await Promise.all([
    Issue.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Issue.countDocuments(filter),
  ]);
  const now = Date.now();
  res.json({
    success: true,
    message: "Issue queue retrieved successfully",
    data: {
      issues: issues.map((issue) => ({
        ...staffIssue(issue),
        assignedTo: issue.assignedTo,
        overdue: Boolean(issue.deadline && issue.deadline.getTime() < now && OPEN_STATUSES.includes(issue.status)),
        availableTransitions: transitionsFor(issue, req.user),
      })),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    },
  });
});

// ── GET /api/admin/reports ───────────────────────────────────────────────────
// Default: reports awaiting administrative action (status "submitted").
export const listAdminReports = handle(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filter = {};
  if (req.query.status !== undefined) {
    if (!REPORT_STATUSES.includes(req.query.status)) throw new AppError(400, "Invalid report status filter", "VALIDATION_ERROR");
    filter.status = req.query.status;
  } else filter.status = "submitted";
  if (req.query.category !== undefined) {
    if (!ALLOWED_CATEGORIES.includes(req.query.category)) throw new AppError(400, "Invalid category filter", "VALIDATION_ERROR");
    filter.category = req.query.category;
  }
  if (req.query.matching !== undefined) {
    if (!["pending_review", "auto_linked", "merged_geo", "merged_ai", "new_issue", "manually_linked"].includes(req.query.matching)) throw new AppError(400, "Invalid matching filter", "VALIDATION_ERROR");
    filter.matchingDecision = req.query.matching;
  }
  if (req.query.issue !== undefined) filter.issue = requireId(req.query.issue, "issue ID");
  if (req.query.unlinked === "true") filter.issue = null;
  if (isWardScoped(req.user)) {
    assertWardParam(req.user, req.query.ward);
    // captured ward, or the reporter's ward for reports created before wards were captured
    const wardUsers = await User.find({ wardId: req.user.wardId }).select("_id").lean();
    filter.$or = [{ ward: req.user.wardId }, { ward: null, reporter: { $in: wardUsers.map((u) => u._id) } }];
  } else if (req.query.ward !== undefined) filter.ward = requireId(req.query.ward, "ward ID");
  const sort = req.query.sort === "newest" ? { createdAt: -1, _id: -1 } : { createdAt: 1, _id: 1 }; // oldest first = longest waiting
  const [reports, total] = await Promise.all([
    Report.find(filter).select("reporter title category location issue matchingDecision status ward municipality createdAt images").sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Report.countDocuments(filter),
  ]);
  res.json({
    success: true,
    message: "Report queue retrieved successfully",
    data: {
      reports: reports.map(({ images, ...r }) => ({ ...r, imageCount: images?.length || 0 })),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    },
  });
});

// ── PATCH /api/admin/reports/:id/review ──────────────────────────────────────
export const reviewAdminReport = handle(async (req, res) => {
  requireId(req.params.id, "report ID");
  const body = validateReviewBody(req.body);
  const report = await reviewReport({ reportId: req.params.id, user: req.user, decision: body.decision, reason: body.reason });
  res.json({ success: true, message: body.decision === "accept" ? "Report accepted for review" : "Report rejected", data: { report: { _id: report._id, status: report.status, issue: report.issue, statusHistory: report.statusHistory.slice(-1) } } });
});

// ── Issue mutations: all delegate to updateIssueState (transaction + CAS + events) ──
const applyIssueUpdate = async (req, res, update, message) => {
  const result = await updateIssueState({
    issueId: requireId(req.params.id, "issue ID"), update, user: req.user, isInScope: inIssueScope(req.user),
    idempotencyKey: parseIdempotencyKey(req.get("Idempotency-Key")),
  });
  res.json({
    success: true,
    message: result.replayed ? "Request already applied" : result.changed ? message : "No changes applied",
    data: { issue: staffIssue(result.issue), events: await serializeEvents(result.events, audienceFor(req.user)), replayed: Boolean(result.replayed) },
  });
};

export const updateIssueStatus = handle((req, res) => applyIssueUpdate(req, res, validateStatusBody(req.body), "Issue status updated"));
export const assignIssue = handle((req, res) => applyIssueUpdate(req, res, validateAssignBody(req.body), "Issue assignment updated"));
export const setIssuePriority = handle((req, res) => applyIssueUpdate(req, res, validatePriorityBody(req.body), "Issue priority updated"));
export const setIssueDeadline = handle(async (req, res) => {
  requireId(req.params.id, "issue ID");
  const current = await Issue.findById(req.params.id).select("deadline ward").lean();
  if (!current || !inIssueScope(req.user)(current)) throw new AppError(404, "Issue not found");
  return applyIssueUpdate(req, res, validateDeadlineBody(req.body, current.deadline), "Issue deadline updated");
});

// ── GET /api/admin/dashboard ─────────────────────────────────────────────────
export const dashboard = handle(async (req, res) => {
  const scope = isWardScoped(req.user) ? { ward: toId(req.user.wardId) } : {};
  const now = new Date();
  const day = 24 * 3600 * 1000;
  const since7 = new Date(now - 7 * day);
  const since30 = new Date(now - 30 * day);
  const active = { ...scope, status: { $in: OPEN_STATUSES } };

  const reportScope = isWardScoped(req.user)
    ? { $or: [{ ward: toId(req.user.wardId) }, { ward: null, reporter: { $in: (await User.find({ wardId: req.user.wardId }).select("_id").lean()).map((u) => u._id) } }] }
    : {};

  const [byStatus, byPriority, overdue, dueSoon, unassigned, created7, resolved7, resolution, reportsAwaiting, reviewsPending, escalatedL1, escalatedL2] = await Promise.all([
    Issue.aggregate([{ $match: { ...scope, status: { $ne: "merged" } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Issue.aggregate([{ $match: active }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
    Issue.countDocuments({ ...active, deadline: { $lt: now } }),
    Issue.countDocuments({ ...active, deadline: { $gte: now, $lt: new Date(now.getTime() + 2 * day) } }),
    Issue.countDocuments({ ...active, department: null }),
    Issue.countDocuments({ ...scope, createdAt: { $gte: since7 } }),
    Issue.countDocuments({ ...scope, resolvedAt: { $gte: since7 } }),
    Issue.aggregate([
      { $match: { ...scope, resolvedAt: { $gte: since30 } } },
      { $group: { _id: null, avgMs: { $avg: { $subtract: ["$resolvedAt", "$createdAt"] } }, n: { $sum: 1 } } },
    ]),
    Report.countDocuments({ ...reportScope, status: "submitted" }),
    MatchReview.countDocuments({ status: { $in: OPEN_REVIEW_STATUSES }, ...(isWardScoped(req.user) ? { ward: req.user.wardId } : {}) }),
    Issue.countDocuments({ ...active, escalationLevel: { $gte: 1 } }),
    Issue.countDocuments({ ...active, escalationLevel: 2 }),
  ]);
  const tally = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const data = {
    scope: isWardScoped(req.user) ? { type: "ward", wardId: req.user.wardId } : { type: "all" },
    generatedAt: now.toISOString(),
    issues: {
      byStatus: tally(byStatus),
      activeByPriority: tally(byPriority),
      active: Object.values(tally(byPriority)).reduce((a, b) => a + b, 0),
      overdue, dueWithin48h: dueSoon, unassigned, escalated: escalatedL1, escalatedToSuperAdmin: escalatedL2,
      createdLast7Days: created7, resolvedLast7Days: resolved7,
      avgResolutionHoursLast30Days: resolution[0] ? Math.round((resolution[0].avgMs / 3600000) * 10) / 10 : null,
    },
    reports: { awaitingReview: reportsAwaiting },
    matchingReviews: { pending: reviewsPending },
  };
  if (!isWardScoped(req.user)) {
    const [total, pendingKyc, wardAdmins, suspended] = await Promise.all([
      User.countDocuments({}), User.countDocuments({ isVerified: false }), User.countDocuments({ role: "ward_admin" }), User.countDocuments({ status: "suspended" }),
    ]);
    data.users = { total, pendingVerification: pendingKyc, wardAdmins, suspended };
  }
  res.json({ success: true, message: "Dashboard retrieved successfully", data });
});

export { isValidId };
