import mongoose from "mongoose";
import Issue from "../models/Issue.js";
import Report from "../models/Report.js";
import User from "../models/User.js";
import Ward from "../models/Ward.js";
import Department, { ALLOWED_CATEGORIES } from "../models/Department.js";
import { ANALYTICS_TIMEZONE, ANALYTICS_UTC_OFFSET, ISSUE_OPEN_STATUSES, ISSUE_RESOLVED_STATUSES, REPORT_INACTIVE_STATUSES } from "../config/statusDefinitions.js";
import { AppError } from "../utils/AppError.js";

const DAY_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const MAX_RANGE_DAYS = 366;
const DURATION_SAMPLE_LIMIT = 20000;
const toId = (id) => new mongoose.Types.ObjectId(String(id));
const round = (value, places = 1) => (value === null || value === undefined ? null : Math.round(value * 10 ** places) / 10 ** places);
const bad = (message) => new AppError(400, message, "VALIDATION_ERROR");

// ── query parsing & scope ────────────────────────────────────────────────────
const parseBoundary = (value, name, endOfDay) => {
  if (value === undefined) return null;
  if (typeof value !== "string") throw bad(`${name} must be an ISO date`);
  // Date-only values are calendar days in Nepal time; full timestamps are used as given.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}${ANALYTICS_UTC_OFFSET}` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw bad(`${name} must be a valid ISO date`);
  return date;
};

export const GROUP_BY = {
  issues: ["category", "status", "priority", "ward", "department"],
  resolution: ["none", "category", "priority", "ward", "department"],
};

// Validates filters and applies role scope. `ward_admin` is always restricted to their ward.
export const parseAnalyticsQuery = (query, user, { now = new Date(), defaultDays = null, requireRange = false, allowDepartment = true, groupByOptions = null, defaultGroupBy = null, intervals = false } = {}) => {
  let from = parseBoundary(query.from, "from", false);
  let to = parseBoundary(query.to, "to", true);
  if ((requireRange || defaultDays) && !to) to = now;
  if (defaultDays && !from) from = new Date(to.getTime() - defaultDays * DAY_MS);
  if (from && to && from > to) throw bad("from must not be after to");
  if (requireRange && from && to && to - from > MAX_RANGE_DAYS * DAY_MS) throw bad(`date range may not exceed ${MAX_RANGE_DAYS} days`);

  const filters = { from, to, ward: null, category: null, department: null };
  if (user.role === "ward_admin") {
    if (!user.wardId) throw new AppError(403, "Ward scope is not configured");
    if (query.ward !== undefined && String(query.ward) !== String(user.wardId)) throw new AppError(403, "Outside your ward scope");
    filters.ward = String(user.wardId);
  } else if (query.ward !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(query.ward) || !/^[a-f\d]{24}$/i.test(query.ward)) throw bad("Invalid ward ID format");
    filters.ward = query.ward;
  }
  if (query.category !== undefined) {
    if (!ALLOWED_CATEGORIES.includes(query.category)) throw bad("Invalid category filter");
    filters.category = query.category;
  }
  if (query.department !== undefined) {
    if (!allowDepartment) throw bad("The department filter is not supported by this endpoint");
    if (!/^[a-f\d]{24}$/i.test(query.department)) throw bad("Invalid department ID format");
    filters.department = query.department;
  }
  if (groupByOptions) {
    const groupBy = query.groupBy ?? defaultGroupBy;
    if (!groupByOptions.includes(groupBy)) throw bad(`groupBy must be one of: ${groupByOptions.join(", ")}`);
    filters.groupBy = groupBy;
  }
  if (intervals) {
    const interval = query.interval ?? "day";
    if (!["day", "week", "month"].includes(interval)) throw bad("interval must be day, week or month");
    filters.interval = interval;
  }
  return filters;
};

export const describeFilters = (filters) => ({
  from: filters.from?.toISOString() ?? null,
  to: filters.to?.toISOString() ?? null,
  ward: filters.ward,
  category: filters.category,
  department: filters.department,
  ...(filters.groupBy && { groupBy: filters.groupBy }),
  ...(filters.interval && { interval: filters.interval }),
  timezone: ANALYTICS_TIMEZONE,
});

const dateRange = (field, filters) => (filters.from || filters.to ? { [field]: { ...(filters.from && { $gte: filters.from }), ...(filters.to && { $lte: filters.to }) } } : {});

export const issueMatch = (filters, dateField = "createdAt", { includeMerged = false } = {}) => ({
  ...(includeMerged ? {} : { status: { $ne: "merged" } }),
  ...(filters.ward && { ward: toId(filters.ward) }),
  ...(filters.category && { category: filters.category }),
  ...(filters.department && { department: toId(filters.department) }),
  ...dateRange(dateField, filters),
});

// Reports have no department; ward scope falls back to the reporter's ward for legacy reports (as in the admin queue).
export const reportMatch = async (filters) => {
  const match = { ...(filters.category && { category: filters.category }), ...dateRange("createdAt", filters) };
  if (filters.ward) {
    const wardUsers = await User.find({ wardId: filters.ward }).select("_id").lean();
    match.$or = [{ ward: toId(filters.ward) }, { ward: null, reporter: { $in: wardUsers.map((u) => u._id) } }];
  }
  return match;
};

// ── shared aggregation fragments ─────────────────────────────────────────────
const inList = (list) => ({ $in: ["$status", list] });
const flag = (expr) => ({ $sum: { $cond: [expr, 1, 0] } });
const hasDeadline = { $gt: ["$deadline", null] };
const isResolved = { $gt: ["$resolvedAt", null] };
const overdueExpr = (now) => ({ $and: [inList(ISSUE_OPEN_STATUSES), hasDeadline, { $lt: ["$deadline", now] }] });

export const percentile = (sorted, p) => {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

// ── overview ─────────────────────────────────────────────────────────────────
export const getOverview = async (filters, now = new Date()) => {
  const match = issueMatch(filters, "createdAt", { includeMerged: true });
  const [byStatus, overdue, escalated, reportsMatch] = await Promise.all([
    Issue.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Issue.countDocuments({ ...issueMatch(filters), status: { $in: ISSUE_OPEN_STATUSES }, deadline: { $ne: null, $lt: now } }),
    Issue.countDocuments({ ...issueMatch(filters), status: { $in: ISSUE_OPEN_STATUSES }, escalationLevel: { $gte: 1 } }),
    reportMatch(filters),
  ]);
  const status = Object.fromEntries(byStatus.map((row) => [row._id, row.count]));
  const sum = (list) => list.reduce((acc, s) => acc + (status[s] || 0), 0);
  const reportRows = await Report.aggregate([{ $match: reportsMatch }, { $group: { _id: "$status", count: { $sum: 1 }, linked: flag({ $gt: ["$issue", null] }) } }]);
  const reportStatus = Object.fromEntries(reportRows.map((row) => [row._id, row.count]));
  const reportTotal = reportRows.reduce((acc, row) => acc + row.count, 0);
  return {
    issues: {
      total: sum(ISSUE_OPEN_STATUSES) + sum(ISSUE_RESOLVED_STATUSES) + sum(["cancelled"]),
      open: sum(ISSUE_OPEN_STATUSES),
      resolved: sum(ISSUE_RESOLVED_STATUSES),
      cancelled: sum(["cancelled"]),
      merged: sum(["merged"]),
      overdue,
      escalated,
      byStatus: status,
    },
    reports: {
      total: reportTotal,
      active: reportTotal - REPORT_INACTIVE_STATUSES.reduce((acc, s) => acc + (reportStatus[s] || 0), 0),
      awaitingReview: reportStatus.submitted || 0,
      rejected: reportStatus.rejected || 0,
      withdrawn: reportStatus.withdrawn || 0,
      linkedToIssue: reportRows.reduce((acc, row) => acc + row.linked, 0),
      byStatus: reportStatus,
    },
  };
};

// ── breakdowns ───────────────────────────────────────────────────────────────
const lookupNames = async (groupBy, ids) => {
  const real = ids.filter(Boolean);
  if (groupBy === "ward") return new Map((await Ward.find({ _id: { $in: real } }).select("name wardNumber").lean()).map((w) => [String(w._id), `${w.name}`]));
  if (groupBy === "department") return new Map((await Department.find({ _id: { $in: real } }).select("name").lean()).map((d) => [String(d._id), d.name]));
  return new Map();
};

export const getIssueBreakdown = async (filters, now = new Date()) => {
  const field = filters.groupBy;
  const rows = await Issue.aggregate([
    { $match: issueMatch(filters) },
    {
      $group: {
        _id: `$${field}`, total: { $sum: 1 },
        open: flag(inList(ISSUE_OPEN_STATUSES)), resolved: flag(inList(ISSUE_RESOLVED_STATUSES)), cancelled: flag(inList(["cancelled"])),
        overdue: flag(overdueExpr(now)),
      },
    },
    { $sort: { total: -1, _id: 1 } },
  ]);
  const names = await lookupNames(field, rows.map((r) => r._id));
  const groups = rows.map((row) => ({
    key: row._id === null || row._id === undefined ? null : String(row._id),
    ...(["ward", "department"].includes(field) && { name: row._id ? names.get(String(row._id)) ?? null : null }),
    total: row.total, open: row.open, resolved: row.resolved, cancelled: row.cancelled, overdue: row.overdue,
  }));
  return { groups, totals: { total: groups.reduce((a, g) => a + g.total, 0), open: groups.reduce((a, g) => a + g.open, 0), resolved: groups.reduce((a, g) => a + g.resolved, 0), overdue: groups.reduce((a, g) => a + g.overdue, 0) } };
};

// ── resolution time ──────────────────────────────────────────────────────────
// Population: issues whose resolvedAt falls in the period (reopened issues have resolvedAt cleared and are excluded).
// Duration = resolvedAt - createdAt. Statistics are computed in the database; percentiles from a bounded sample.
const durationStats = (hours) => {
  const sorted = [...hours].sort((a, b) => a - b);
  return {
    count: sorted.length,
    avgHours: round(sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null),
    medianHours: round(percentile(sorted, 0.5)),
    p90Hours: round(percentile(sorted, 0.9)),
    minHours: round(sorted[0] ?? null),
    maxHours: round(sorted.at(-1) ?? null),
  };
};

export const getResolutionTime = async (filters) => {
  const match = { ...issueMatch(filters, "resolvedAt"), resolvedAt: { ...(filters.from && { $gte: filters.from }), ...(filters.to && { $lte: filters.to }), $ne: null } };
  const field = filters.groupBy === "none" ? null : filters.groupBy;
  const docs = await Issue.find(match).select(`createdAt resolvedAt deadline ${field || ""}`).sort({ _id: 1 }).limit(DURATION_SAMPLE_LIMIT + 1).lean();
  const truncated = docs.length > DURATION_SAMPLE_LIMIT;
  const sample = truncated ? docs.slice(0, DURATION_SAMPLE_LIMIT) : docs;
  const hoursOf = (d) => (d.resolvedAt - d.createdAt) / HOUR_MS;
  const withDeadline = sample.filter((d) => d.deadline);
  const onTime = withDeadline.filter((d) => d.resolvedAt <= d.deadline).length;
  const result = {
    ...durationStats(sample.map(hoursOf)),
    deadlineCompliance: { withDeadline: withDeadline.length, resolvedOnTime: onTime, onTimeRate: withDeadline.length ? round(onTime / withDeadline.length, 3) : null },
    truncated,
  };
  if (field) {
    const buckets = new Map();
    for (const d of sample) {
      const key = d[field] === null || d[field] === undefined ? null : String(d[field]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(hoursOf(d));
    }
    const names = await lookupNames(field, [...buckets.keys()]);
    result.groups = [...buckets.entries()]
      .map(([key, hours]) => ({ key, ...(["ward", "department"].includes(field) && { name: key ? names.get(key) ?? null : null }), ...durationStats(hours) }))
      .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
  }
  return result;
};

// ── department performance (cohort: issues CREATED in the period, current state) ─
export const getDepartmentPerformance = async (filters, now = new Date()) => {
  const rows = await Issue.aggregate([
    { $match: issueMatch(filters) },
    {
      $group: {
        _id: "$department", total: { $sum: 1 },
        open: flag(inList(ISSUE_OPEN_STATUSES)), resolved: flag(inList(ISSUE_RESOLVED_STATUSES)), cancelled: flag(inList(["cancelled"])),
        overdue: flag(overdueExpr(now)), escalated: flag({ $and: [inList(ISSUE_OPEN_STATUSES), { $gte: ["$escalationLevel", 1] }] }),
        resolvedWithDeadline: flag({ $and: [isResolved, hasDeadline] }),
        resolvedOnTime: flag({ $and: [isResolved, hasDeadline, { $lte: ["$resolvedAt", "$deadline"] }] }),
        avgResolutionMs: { $avg: { $cond: [isResolved, { $subtract: ["$resolvedAt", "$createdAt"] }, null] } },
      },
    },
    { $sort: { total: -1, _id: 1 } },
  ]);
  const names = await lookupNames("department", rows.map((r) => r._id));
  const departments = rows.map((row) => ({
    departmentId: row._id ? String(row._id) : null,
    name: row._id ? names.get(String(row._id)) ?? null : "Unassigned",
    total: row.total, open: row.open, resolved: row.resolved, cancelled: row.cancelled, overdue: row.overdue, escalated: row.escalated,
    resolutionRate: row.total - row.cancelled > 0 ? round(row.resolved / (row.total - row.cancelled), 3) : null,
    avgResolutionHours: round(row.avgResolutionMs === null || row.avgResolutionMs === undefined ? null : row.avgResolutionMs / HOUR_MS),
    onTimeRate: row.resolvedWithDeadline ? round(row.resolvedOnTime / row.resolvedWithDeadline, 3) : null,
  }));
  return { departments, totals: { total: departments.reduce((a, d) => a + d.total, 0), open: departments.reduce((a, d) => a + d.open, 0), resolved: departments.reduce((a, d) => a + d.resolved, 0), overdue: departments.reduce((a, d) => a + d.overdue, 0) } };
};

// ── trends ───────────────────────────────────────────────────────────────────
const FORMAT = { day: "%Y-%m-%d", week: "%G-W%V", month: "%Y-%m" };
const OFFSET_MS = (5 * 60 + 45) * 60000;
const pad = (n) => String(n).padStart(2, "0");

// Bucket label for an instant, in Nepal time; mirrors MongoDB's %Y-%m-%d / %G-W%V / %Y-%m.
export const bucketKey = (date, interval) => {
  const local = new Date(date.getTime() + OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + 1;
  if (interval === "month") return `${y}-${pad(m)}`;
  if (interval === "day") return `${y}-${pad(m)}-${pad(local.getUTCDate())}`;
  const thursday = new Date(Date.UTC(y, m - 1, local.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7)); // ISO week: Thursday decides the year
  const isoYear = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday - Date.UTC(isoYear, 0, 1)) / DAY_MS + 1) / 7);
  return `${isoYear}-W${pad(week)}`;
};

// Every bucket label between from and to (inclusive), generated by walking the range day by day.
const bucketKeys = (from, to, interval) => {
  const keys = new Set();
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) keys.add(bucketKey(new Date(t), interval));
  keys.add(bucketKey(to, interval));
  return [...keys].sort();
};

export const getTrends = async (filters) => {
  const format = FORMAT[filters.interval];
  const bucket = (field) => ({ $dateToString: { format, date: `$${field}`, timezone: ANALYTICS_TIMEZONE } });
  const issuesMatch = (dateField) => ({ ...issueMatch(filters, dateField), ...(dateField === "resolvedAt" && { resolvedAt: { ...(filters.from && { $gte: filters.from }), ...(filters.to && { $lte: filters.to }), $ne: null } }) });
  const [reportsMatch, created, resolved] = await Promise.all([
    reportMatch(filters),
    Issue.aggregate([{ $match: issuesMatch("createdAt") }, { $group: { _id: bucket("createdAt"), count: { $sum: 1 } } }]),
    Issue.aggregate([{ $match: issuesMatch("resolvedAt") }, { $group: { _id: bucket("resolvedAt"), count: { $sum: 1 } } }]),
  ]);
  const reportRows = await Report.aggregate([{ $match: reportsMatch }, { $group: { _id: bucket("createdAt"), count: { $sum: 1 } } }]);
  const toMap = (rows) => new Map(rows.map((r) => [r._id, r.count]));
  const [c, r, rp] = [toMap(created), toMap(resolved), toMap(reportRows)];
  const series = bucketKeys(filters.from, filters.to, filters.interval).map((period) => ({
    period, reportsCreated: rp.get(period) || 0, issuesCreated: c.get(period) || 0, issuesResolved: r.get(period) || 0,
  }));
  return {
    series,
    totals: {
      reportsCreated: series.reduce((a, s) => a + s.reportsCreated, 0),
      issuesCreated: series.reduce((a, s) => a + s.issuesCreated, 0),
      issuesResolved: series.reduce((a, s) => a + s.issuesResolved, 0),
    },
  };
};
