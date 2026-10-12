import mongoose from "mongoose";
import Issue, { ELIGIBLE_ISSUE_STATUSES } from "../models/Issue.js";
import Report from "../models/Report.js";
import MatchReview, { OPEN_REVIEW_STATUSES, REVIEW_STATUSES } from "../models/MatchReview.js";
import { getMatchingConfig } from "../config/matching.js";
import { findCandidateIssues, scoreCandidates } from "../services/issueMatchingService.js";
import { actorOf, reconcileIssueCounts, resolveCanonicalIssue } from "../services/issueService.js";
import { findEventByIdempotencyKey, listIssueEvents, parseIdempotencyKey, recordEvent } from "../services/issueEventService.js";
import { updateIssueState } from "../services/issueUpdateService.js";
import { audienceFor, AUDIENCES, serializeEvent, serializeEvents, visibilitiesFor } from "../serializers/issueEvent.serializer.js";
import { mergeIssues } from "../services/issueMergeService.js";
import { resolveMatchReview } from "../services/matchReviewService.js";
import { scoreLevel } from "../services/issueScoreService.js";
import { attachPrimaryImages, attachWardLabels, priorityLabel } from "../services/wardLabelService.js";
import { applySearch } from "../services/issueSearchService.js";
import { runInTransaction } from "../services/transaction.js";
import { AppError } from "../utils/AppError.js";
import {
  isValidId, parseCoordinates, parseEventQuery, parseIssueFilters, parsePagination, parseRadius, parseThreshold, requireId, validateIssueUpdate, validateManualEvent,
} from "../validators/issueValidator.js";

const isAdmin = (user) => ["admin", "super_admin"].includes(user.role);
const isStaff = (user) => isAdmin(user) || user.role === "ward_admin";

const requireStaff = (user) => {
  if (!isStaff(user)) throw new AppError(403, "Staff access required");
  if (user.role === "ward_admin" && !user.wardId) throw new AppError(403, "Ward scope is not configured");
};
const requireAdmin = (user) => {
  if (!isAdmin(user)) throw new AppError(403, "Administrator access required");
};
const inScope = (user, issue) => !(user.role === "ward_admin") || issue.ward?.toString() === user.wardId?.toString();
const scopeFilter = (user) => (user.role === "ward_admin" ? { ward: user.wardId } : {});

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (!error.status) console.error(`[ISSUE_ERROR] ${error.stack || error.message}`);
    const status = error.status || (error.name === "ValidationError" ? 400 : 500);
    res.status(status).json({
      success: false,
      message: status === 500 ? "Server error" : error.message,
      ...(error.code && { error: { code: error.code, details: error.details || [] } }),
    });
  }
};

const pagination = (total, page, limit) => {
  const pages = Math.ceil(total / limit);
  return { total, page, limit, pages, totalPages: pages, hasMore: page < pages };
};

const publicIssue = (issue) => ({
  _id: issue._id,
  category: issue.category,
  summary: issue.summary,
  description: issue.description ?? "",
  location: issue.location,
  municipality: issue.municipality,
  ward: issue.ward,
  department: issue.department,
  status: issue.status,
  priority: issue.priority,
  priorityLabel: priorityLabel(issue.priority),
  reportCount: issue.reportCount,
  uniqueReporters: issue.uniqueReporters ?? issue.reportCount,
  severity: issue.severity ?? 2,
  score: issue.score ?? 0,
  scoreLevel: scoreLevel(issue.score ?? 0),
  wardName: issue.wardName ?? null,
  wardNumber: issue.wardNumber ?? null,
  primaryImage: issue.primaryImage ?? null,
  imageCount: issue.imageCount ?? 0,
  firstReportedAt: issue.firstReportedAt,
  lastReportedAt: issue.lastReportedAt,
  deadline: issue.deadline,
  createdAt: issue.createdAt,
  ...(issue.distanceMeters !== undefined && { distanceMeters: Math.round(issue.distanceMeters * 10) / 10 }),
  ...(issue.mergedInto && { mergedInto: issue.mergedInto }),
});

export const staffIssue = (issue) => ({
  ...publicIssue(issue),
  assignedAt: issue.assignedAt,
  assignedBy: issue.assignedBy,
  priorityReason: issue.priorityReason,
  suggestedPriority: issue.suggestedPriority,
  priorityUpdatedAt: issue.priorityUpdatedAt,
  priorityScore: issue.priorityScore,
  priorityFactors: issue.priorityFactors,
  deadlineSource: issue.deadlineSource,
  escalationLevel: issue.escalationLevel ?? 0,
  escalatedAt: issue.escalatedAt,
  mergedAt: issue.mergedAt,
  mergedBy: issue.mergedBy,
  mergeReason: issue.mergeReason,
  matching: {
    method: issue.matchingMethod,
    score: issue.matchingScore,
    threshold: issue.matchingThreshold,
    factors: issue.matchingFactors,
    decision: issue.matchingDecision,
    reviewedBy: issue.matchingReviewedBy,
    reviewedAt: issue.matchingReviewedAt,
  },
});

const serialize = (user, issue) => (isStaff(user) ? staffIssue(issue) : publicIssue(issue));

const LIST_DESCRIPTION_MAX = 200;
const truncate = (text) => (text.length > LIST_DESCRIPTION_MAX ? `${text.slice(0, LIST_DESCRIPTION_MAX - 1).trimEnd()}…` : text);
// List cards get a short description; the detail endpoint returns it in full.
const serializeForList = (user, issue) => {
  const out = serialize(user, issue);
  return { ...out, description: truncate(out.description) };
};
const toObjectId = (id) => new mongoose.Types.ObjectId(id);

// ── GET /api/issues ──────────────────────────────────────────────────────────
export const listIssues = handle(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { filter, sort, search } = parseIssueFilters(req.query);
  if (isStaff(req.user)) requireStaff(req.user);
  Object.assign(filter, scopeFilter(req.user));
  await applySearch(filter, search);
  const wantsMerged = isStaff(req.user) && (filter.status === "merged" || req.query.includeMerged === "true");
  if (!wantsMerged && !filter.status) filter.status = { $ne: "merged" };
  else if (!wantsMerged && filter.status === "merged") throw new AppError(403, "Merged issues are only visible to staff");
  if (req.user.role === "ward_admin" && filter.ward?.toString && req.query.ward && req.query.ward !== req.user.wardId.toString()) {
    throw new AppError(403, "Outside your ward scope");
  }
  const [issues, total] = await Promise.all([
    Issue.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Issue.countDocuments(filter),
  ]);
  res.json({ success: true, message: "Issues retrieved successfully", data: { issues: (await attachPrimaryImages(await attachWardLabels(issues))).map((i) => serializeForList(req.user, i)), pagination: pagination(total, page, limit) } });
});

// ── GET /api/issues/ranking ──────────────────────────────────────────────────
// Open issues around a point, most urgent first (score desc).
export const rankedIssues = handle(async (req, res) => {
  const config = getMatchingConfig();
  const near = parseCoordinates({ longitude: req.query.lng ?? req.query.longitude, latitude: req.query.lat ?? req.query.latitude });
  const radius = parseRadius(req.query.radius, 1000);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  if (isStaff(req.user)) requireStaff(req.user);
  const { filter } = parseIssueFilters({ category: req.query.category });
  const query = { status: { $in: ELIGIBLE_ISSUE_STATUSES }, ...filter, ...scopeFilter(req.user) };
  const items = await Issue.aggregate([
    { $geoNear: { near, distanceField: "distanceMeters", maxDistance: radius, spherical: true, key: "location", query } },
    { $sort: { score: -1, _id: 1 } },
    { $limit: limit },
    { $project: { matchTexts: 0, matchingFactors: 0 } },
  ]).option({ maxTimeMS: config.queryTimeoutMs });
  const ranked = (await attachPrimaryImages(await attachWardLabels(items))).map((i, index) => ({ ...serialize(req.user, i), rank: index + 1 }));
  res.json({ success: true, message: "Issue ranking retrieved successfully", data: { issues: ranked, radiusMeters: radius, limit } });
});

// ── GET /api/issues/nearby ───────────────────────────────────────────────────
export const nearbyIssues = handle(async (req, res) => {
  const config = getMatchingConfig();
  const near = parseCoordinates(req.query);
  const radius = parseRadius(req.query.radius, config.nearbyDefaultRadius);
  const { page, limit } = parsePagination(req.query);
  const { filter, search } = parseIssueFilters({ category: req.query.category, municipality: req.query.municipality, ward: req.query.ward, search: req.query.search });
  if (isStaff(req.user)) requireStaff(req.user);
  await applySearch(filter, search);
  const query = { status: { $ne: "merged" }, ...filter, ...scopeFilter(req.user) };
  if (query.ward) query.ward = toObjectId(query.ward.toString());
  const [result] = await Issue.aggregate([
    { $geoNear: { near, distanceField: "distanceMeters", maxDistance: radius, spherical: true, key: "location", query } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: { matchTexts: 0, matchingFactors: 0 } }],
        total: [{ $count: "n" }],
      },
    },
  ]).option({ maxTimeMS: config.queryTimeoutMs });
  const total = result.total[0]?.n || 0;
  res.json({ success: true, message: "Nearby issues retrieved successfully", data: { issues: (await attachPrimaryImages(await attachWardLabels(result.items))).map((i) => serializeForList(req.user, i)), radiusMeters: radius, pagination: pagination(total, page, limit) } });
});

const loadVisibleIssue = async (req) => {
  requireId(req.params.id, "issue ID");
  if (isStaff(req.user)) requireStaff(req.user);
  const issue = await Issue.findById(req.params.id).lean();
  if (!issue || !inScope(req.user, issue)) throw new AppError(404, "Issue not found");
  return issue;
};

// ── GET /api/issues/:id ──────────────────────────────────────────────────────
export const getIssue = handle(async (req, res) => {
  const issue = await loadVisibleIssue(req);
  const staff = isStaff(req.user);
  if (issue.status === "merged") {
    const canonical = await resolveCanonicalIssue(issue._id);
    return res.json({
      success: true,
      message: "Issue has been merged into another issue",
      data: {
        merged: true,
        issue: { _id: issue._id, status: "merged", mergedInto: canonical?._id ?? issue.mergedInto, mergedAt: issue.mergedAt },
        canonicalIssueId: canonical?._id ?? issue.mergedInto,
      },
    });
  }
  const audience = audienceFor(req.user);
  const { events } = await listIssueEvents(issue._id.toString(), { visibilities: visibilitiesFor(audience), page: 1, limit: 100 });
  const data = { merged: false, issue: serialize(req.user, (await attachPrimaryImages(await attachWardLabels([issue])))[0]), events: await serializeEvents(events, audience) };
  if (staff) data.mergedIssueIds = (await Issue.find({ mergedInto: issue._id }).select("_id").lean()).map((i) => i._id);
  res.json({ success: true, message: "Issue retrieved successfully", data });
});

// ── GET /api/issues/:id/events ───────────────────────────────────────────────
// Order: timestamp ASC, _id ASC (stable). Page-based; limit <= 100.
export const getIssueEvents = handle(async (req, res) => {
  const audience = audienceFor(req.user);
  const query = parseEventQuery(req.query, { audienceIsCitizen: audience === AUDIENCES.CITIZEN });
  const issue = await loadVisibleIssue(req);
  if (issue.status === "merged" && audience === AUDIENCES.CITIZEN) {
    const canonical = await resolveCanonicalIssue(issue._id);
    return res.json({ success: true, message: "Issue has been merged into another issue", data: { issueId: issue._id, merged: true, canonicalIssueId: canonical?._id ?? issue.mergedInto, currentStatus: "merged", events: [], pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 } } });
  }
  const allowed = visibilitiesFor(audience);
  const visibilities = query.visibility ? allowed.filter((v) => v === query.visibility) : allowed;
  const { events, total } = await listIssueEvents(issue._id.toString(), { visibilities, eventType: query.eventType, page: query.page, limit: query.limit });
  res.json({
    success: true,
    message: "Issue timeline retrieved successfully",
    data: {
      issueId: issue._id,
      currentStatus: issue.status,
      merged: issue.status === "merged",
      events: await serializeEvents(events, audience),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    },
  });
});

// ── POST /api/issues/:id/events ──────────────────────────────────────────────
// Manual notes only. Lifecycle/assignment/merge events are created by the services that perform
// those operations, never by posting here.
export const createIssueEvent = handle(async (req, res) => {
  requireStaff(req.user);
  const input = validateManualEvent(req.body || {}, { canWriteInternal: isStaff(req.user) });
  const key = parseIdempotencyKey(req.get("Idempotency-Key"));
  const issue = await loadVisibleIssue(req);
  if (issue.status === "merged") throw new AppError(409, "Merged issues cannot receive new events", "ALREADY_MERGED");
  const audience = audienceFor(req.user);
  const replayed = await findEventByIdempotencyKey(issue._id, key);
  if (replayed) return res.status(200).json({ success: true, message: "Event already recorded", data: { event: await serializeEvent(replayed, audience), replayed: true } });
  let event;
  try {
    event = await runInTransaction((session) => recordEvent({ issue: issue._id, actor: actorOf(req.user), ...input, idempotencyKey: key }, session));
  } catch (error) {
    if (error.code !== 11000 || !key) throw error;
    const existing = await findEventByIdempotencyKey(issue._id, key);
    return res.status(200).json({ success: true, message: "Event already recorded", data: { event: await serializeEvent(existing, audience), replayed: true } });
  }
  res.status(201).json({ success: true, message: "Event recorded successfully", data: { event: await serializeEvent(event, audience) } });
});

// ── GET /api/issues/:id/reports ──────────────────────────────────────────────
export const listIssueReports = handle(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  let issue = await loadVisibleIssue(req);
  let redirected = false;
  if (issue.status === "merged") {
    issue = (await resolveCanonicalIssue(issue._id))?.toObject();
    redirected = true;
    if (!issue || !inScope(req.user, issue)) throw new AppError(404, "Issue not found");
  }
  const staff = isStaff(req.user);
  const filter = { issue: issue._id, ...(staff ? {} : { reporter: req.user._id }) };
  const select = "title description category location images status matchingDecision createdAt" + (staff ? " reporter" : "");
  const [reports, total] = await Promise.all([
    Report.find(filter).select(select).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Report.countDocuments(filter),
  ]);
  res.json({ success: true, message: "Issue reports retrieved successfully", data: { issueId: issue._id, redirectedFromMerged: redirected, reports, pagination: pagination(total, page, limit) } });
});

// ── GET /api/issues/:id/similar ──────────────────────────────────────────────
export const similarIssues = handle(async (req, res) => {
  requireStaff(req.user);
  const config = getMatchingConfig();
  requireId(req.params.id, "issue ID");
  const radius = parseRadius(req.query.radius, config.radiusMeters);
  const threshold = parseThreshold(req.query.threshold, config.reviewThreshold);
  const { limit } = parsePagination({ limit: req.query.limit ?? 10 });
  const source = await Issue.findById(req.params.id).select("+matchTexts").lean();
  if (!source || !inScope(req.user, source)) throw new AppError(404, "Issue not found");
  if (source.status === "merged") throw new AppError(409, "Issue has been merged", "ALREADY_MERGED", [{ canonicalIssueId: source.mergedInto }]);
  const { filter } = parseIssueFilters({ category: req.query.category });
  const category = filter.category || source.category;
  const raw = await findCandidateIssues(
    { location: source.location, category, municipality: source.municipality },
    { radiusMeters: radius, limit: 50, excludeId: source._id, statuses: [...ELIGIBLE_ISSUE_STATUSES, "resolved", "closed"], config }
  );
  const subject = { title: source.summary, description: (source.matchTexts || []).join(" "), ward: source.ward };
  const scored = scoreCandidates(subject, raw, { ...config, radiusMeters: radius })
    .filter((c) => c.textSimilarity >= threshold && (req.user.role !== "ward_admin" || c.ward?.toString() === req.user.wardId.toString()))
    .sort((a, b) => b.score - a.score || a.distanceMeters - b.distanceMeters)
    .slice(0, limit)
    .map((c) => ({ ...c, unconfirmed: true, recommendation: c.confidence === "auto" ? "likely_duplicate_review_for_merge" : "possible_duplicate_needs_review" }));
  res.json({ success: true, message: "Similar issues retrieved (unconfirmed candidates)", data: { sourceIssueId: source._id, radiusMeters: radius, threshold, candidates: scored } });
});

// ── POST /api/issues/:id/merge ───────────────────────────────────────────────
export const mergeIssue = handle(async (req, res) => {
  requireAdmin(req.user);
  requireId(req.params.id, "issue ID");
  const { targetIssueId, reason, reviewedMatching } = req.body || {};
  requireId(targetIssueId, "targetIssueId");
  const result = await mergeIssues({ sourceId: req.params.id, targetId: targetIssueId, reason, user: req.user, reviewedMatching });
  res.json({ success: true, message: "Issues merged successfully", data: result });
});

// ── PATCH /api/issues/:id ────────────────────────────────────────────────────
// Single integration point for status / assignment / edits; delegates to the lifecycle,
// assignment and event services (one transaction, compare-and-set, 409 on conflict).
export const updateIssue = handle(async (req, res) => {
  requireStaff(req.user);
  requireId(req.params.id, "issue ID");
  const update = validateIssueUpdate(req.body || {});
  const idempotencyKey = parseIdempotencyKey(req.get("Idempotency-Key"));
  const result = await updateIssueState({ issueId: req.params.id, update, user: req.user, isInScope: (issue) => inScope(req.user, issue), idempotencyKey });
  const audience = audienceFor(req.user);
  res.json({
    success: true,
    message: result.replayed ? "Request already applied" : result.changed ? "Issue updated successfully" : "No changes applied",
    data: { issue: staffIssue(result.issue), events: await serializeEvents(result.events, audience), replayed: Boolean(result.replayed) },
  });
});

// ── Matching review queue ────────────────────────────────────────────────────
export const listReviews = handle(async (req, res) => {
  requireStaff(req.user);
  const { page, limit } = parsePagination(req.query);
  if (req.query.status !== undefined && !REVIEW_STATUSES.includes(req.query.status)) throw new AppError(400, "Invalid review status");
  const filter = { status: req.query.status ? req.query.status : { $in: OPEN_REVIEW_STATUSES } };
  if (req.user.role === "ward_admin") filter.ward = req.user.wardId;
  const [reviews, total] = await Promise.all([
    MatchReview.find(filter).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    MatchReview.countDocuments(filter),
  ]);
  const reports = await Report.find({ _id: { $in: reviews.map((r) => r.report) } }).select("reporter title description category location images createdAt status").lean();
  const issues = await Issue.find({ _id: { $in: reviews.flatMap((r) => r.candidates.map((c) => c.issue)) } })
    .select("summary status priority reportCount ward department category location").lean();
  const reportMap = new Map(reports.map((r) => [r._id.toString(), r]));
  const issueMap = new Map(issues.map((i) => [i._id.toString(), i]));
  const items = reviews.map((review) => ({
    _id: review._id,
    status: review.status,
    reason: review.reason,
    createdAt: review.createdAt,
    report: reportMap.get(review.report.toString()) || null,
    candidates: review.candidates.map((c) => ({ ...c, issue: issueMap.get(c.issue.toString()) || { _id: c.issue } })),
    availableActions: ["link", "new_issue", "defer", "request_verification"],
    history: review.history,
  }));
  res.json({ success: true, message: "Matching review queue retrieved successfully", data: { reviews: items, pagination: pagination(total, page, limit) } });
});

export const resolveReview = handle(async (req, res) => {
  requireStaff(req.user);
  requireId(req.params.reviewId, "review ID");
  const { action, issueId, reason } = req.body || {};
  if (issueId !== undefined) requireId(issueId, "issueId");
  const { review, issue } = await resolveMatchReview({ reviewId: req.params.reviewId, user: req.user, action, issueId, reason });
  res.json({ success: true, message: "Review updated successfully", data: { review: { _id: review._id, status: review.status, decision: review.decision, resolvedIssue: review.resolvedIssue }, issue: issue ? staffIssue(issue.toObject()) : null } });
});

// ── POST /api/issues/reconcile ───────────────────────────────────────────────
export const reconcile = handle(async (req, res) => {
  requireAdmin(req.user);
  res.json({ success: true, message: "Issue counts reconciled", data: await reconcileIssueCounts() });
});

export { isValidId };
