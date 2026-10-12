import mongoose from "mongoose";
import { ALLOWED_CATEGORIES } from "../models/Department.js";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../models/Issue.js";
import { getMatchingConfig } from "../config/matching.js";
import { AppError } from "../utils/AppError.js";
import { sanitizeText } from "../utils/sanitize.js";
import { EVENT_VISIBILITIES, ISSUE_EVENT_TYPES, MANUAL_EVENT_TYPES } from "../models/IssueEvent.js";

export const isValidId = (id) => typeof id === "string" && mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);

const bad = (message, code = "VALIDATION_ERROR") => new AppError(400, message, code);

export const requireId = (id, label = "ID") => {
  if (!isValidId(id)) throw bad(`Invalid ${label} format`, "INVALID_ID");
  return id;
};

export const parsePagination = (query) => {
  const page = query.page === undefined ? 1 : Number(query.page);
  const max = Number(process.env.REPORT_MAX_PAGE_SIZE) || 50;
  const limit = query.limit === undefined ? Number(process.env.REPORT_DEFAULT_PAGE_SIZE) || 10 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > max) {
    throw bad("page must be at least 1 and limit must be within the configured maximum", "INVALID_PAGINATION");
  }
  return { page, limit };
};

const parseDate = (value, name) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw bad(`${name} must be a valid ISO date`);
  return date;
};

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  last_reported: { lastReportedAt: -1, _id: -1 },
  priority: { priorityRank: -1, lastReportedAt: -1, _id: -1 },
  score: { score: -1, _id: -1 },
  deadline: { deadline: 1, _id: 1 },
};

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Builds a Mongo filter from validated, whitelisted query params only.
export const parseIssueFilters = (query) => {
  const filter = {};
  if (query.category !== undefined) {
    // Accepts one category or a comma-separated list (?category=road,pothole) and matches any of them.
    const raw = Array.isArray(query.category) ? query.category.join(",") : query.category;
    const categories = [...new Set(String(raw).split(",").map((c) => c.trim().toLowerCase()).filter(Boolean))];
    if (!categories.length || categories.some((c) => !ALLOWED_CATEGORIES.includes(c))) throw bad("Invalid category filter");
    filter.category = categories.length === 1 ? categories[0] : { $in: categories };
  }
  if (query.status !== undefined) {
    if (!ISSUE_STATUSES.includes(query.status)) throw bad("Invalid status filter");
    filter.status = query.status;
  }
  if (query.priority !== undefined) {
    if (!ISSUE_PRIORITIES.includes(query.priority)) throw bad("Invalid priority filter");
    filter.priority = query.priority;
  }
  if (query.municipality !== undefined) {
    if (typeof query.municipality !== "string" || !query.municipality.trim() || query.municipality.length > 100) throw bad("Invalid municipality filter");
    filter.municipality = query.municipality.trim();
  }
  if (query.ward !== undefined) filter.ward = requireId(query.ward, "ward ID");
  if (query.department !== undefined) filter.department = requireId(query.department, "department ID");
  if (query.from !== undefined || query.to !== undefined) {
    filter.createdAt = {};
    if (query.from !== undefined) filter.createdAt.$gte = parseDate(query.from, "from");
    if (query.to !== undefined) filter.createdAt.$lte = parseDate(query.to, "to");
  }
  if (query.search !== undefined) {
    if (typeof query.search !== "string" || !query.search.trim()) throw bad("Invalid search");
  }
  const sortKey = query.sort ?? "newest";
  if (!SORTS[sortKey]) throw bad(`sort must be one of: ${Object.keys(SORTS).join(", ")}`);
  const search = query.search === undefined ? null : query.search.trim().slice(0, 100);
  return { filter, sort: SORTS[sortKey], search };
};

export const parseCoordinates = (query) => {
  const longitude = Number(query.longitude);
  const latitude = Number(query.latitude);
  if (query.longitude === undefined || query.latitude === undefined || !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw bad("longitude (-180..180) and latitude (-90..90) are required numbers", "INVALID_COORDINATES");
  }
  return { type: "Point", coordinates: [longitude, latitude] };
};

export const parseRadius = (value, fallback) => {
  const { nearbyMaxRadius } = getMatchingConfig();
  if (value === undefined) return fallback;
  const radius = Number(value);
  if (!Number.isFinite(radius) || radius <= 0 || radius > nearbyMaxRadius) throw bad(`radius must be between 1 and ${nearbyMaxRadius} metres`, "INVALID_RADIUS");
  return radius;
};

export const parseThreshold = (value, fallback) => {
  if (value === undefined) return fallback;
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw bad("threshold must be between 0 and 1", "INVALID_THRESHOLD");
  return threshold;
};

const UPDATABLE = ["summary", "priority", "priorityReason", "department", "assignedTo", "deadline", "status", "reason", "resolutionSummary", "expectedStatus"];
export const validateIssueUpdate = (body) => {
  const unknown = Object.keys(body).filter((key) => !UPDATABLE.includes(key));
  if (unknown.length) throw bad(`Fields not allowed: ${unknown.join(", ")}`);
  const update = {};
  if (body.summary !== undefined) {
    if (typeof body.summary !== "string" || body.summary.trim().length < 5 || body.summary.trim().length > 300) throw bad("summary must be 5-300 characters");
    update.summary = body.summary.trim();
  }
  if (body.priority !== undefined) {
    if (!ISSUE_PRIORITIES.includes(body.priority)) throw bad("Invalid priority");
    update.priority = body.priority;
  }
  if (body.priorityReason !== undefined) {
    if (typeof body.priorityReason !== "string" || body.priorityReason.length > 500) throw bad("priorityReason must be at most 500 characters");
    update.priorityReason = body.priorityReason.trim();
  }
  if (body.department !== undefined) update.department = body.department === null ? null : requireId(body.department, "department ID");
  if (body.deadline !== undefined) update.deadline = body.deadline === null ? null : parseDate(body.deadline, "deadline");
  if (body.status !== undefined) {
    if (!ISSUE_STATUSES.includes(body.status) || body.status === "merged") throw bad("Invalid status (use the merge endpoint to merge)");
    update.status = body.status;
  }
  if (body.assignedTo !== undefined) update.assignedTo = body.assignedTo === null ? null : requireId(body.assignedTo, "assignedTo");
  if (body.resolutionSummary !== undefined) {
    if (typeof body.resolutionSummary !== "string" || body.resolutionSummary.length > 1000) throw bad("resolutionSummary must be at most 1000 characters");
    update.resolutionSummary = body.resolutionSummary;
  }
  if (body.expectedStatus !== undefined) {
    if (!ISSUE_STATUSES.includes(body.expectedStatus)) throw bad("Invalid expectedStatus");
    update.expectedStatus = body.expectedStatus;
  }
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 1000)) throw bad("reason must be at most 1000 characters");
  if (!Object.keys(update).filter((key) => key !== "expectedStatus").length) throw bad("At least one updatable field is required");
  update.reason = body.reason || "";
  return update;
};

// POST /api/issues/:id/events - manual events only (see MANUAL_EVENT_TYPES). Anything else
// (actor, timestamps, details, metadata, system events) is rejected, never ignored.
export const validateManualEvent = (body, { canWriteInternal }) => {
  const allowed = ["eventType", "summary", "visibility"];
  const unknown = Object.keys(body || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) throw bad(`Fields not allowed: ${unknown.join(", ")}`);
  if (!MANUAL_EVENT_TYPES.includes(body.eventType)) throw bad(`eventType must be one of: ${MANUAL_EVENT_TYPES.join(", ")}`);
  if (typeof body.summary !== "string") throw bad("summary is required");
  const summary = sanitizeText(body.summary, { maxLength: 1000 });
  if (summary.length < 3) throw bad("summary must be at least 3 characters after sanitization");
  if (body.summary.length > 1000) throw bad("summary must be at most 1000 characters");
  const visibility = body.visibility ?? "internal";
  if (!EVENT_VISIBILITIES.includes(visibility)) throw bad("visibility must be public or internal");
  if (visibility === "internal" && !canWriteInternal) throw new AppError(403, "You may not create internal notes");
  return { eventType: body.eventType, summary, visibility };
};

export const parseEventQuery = (query, { audienceIsCitizen }) => {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw bad("page must be at least 1 and limit between 1 and 100", "INVALID_PAGINATION");
  }
  if (query.eventType !== undefined && !ISSUE_EVENT_TYPES.includes(query.eventType)) throw bad("Invalid eventType filter");
  if (query.visibility !== undefined) {
    if (!EVENT_VISIBILITIES.includes(query.visibility)) throw bad("Invalid visibility filter");
    if (audienceIsCitizen && query.visibility !== "public") throw new AppError(403, "Internal events are not available to you");
  }
  return { page, limit, eventType: query.eventType, visibility: query.visibility };
};
