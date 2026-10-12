import {
  describeFilters, getDepartmentPerformance, getIssueBreakdown, getOverview, getResolutionTime, getTrends, GROUP_BY, parseAnalyticsQuery,
} from "../services/analyticsService.js";

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (!error.status) console.error(`[ANALYTICS_ERROR] ${error.stack || error.message}`);
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: status === 500 ? "Server error" : error.message,
      ...(error.code && { error: { code: error.code, details: error.details || [] } }),
    });
  }
};

const respond = (res, message, filters, data, now) =>
  res.json({ success: true, message, data: { generatedAt: now.toISOString(), filters: describeFilters(filters), ...data } });

// All endpoints are staff-only (ward_admin: own ward, enforced in parseAnalyticsQuery) and return
// aggregates only: no reporter identities or contact details.

export const overview = handle(async (req, res) => {
  const now = new Date();
  const filters = parseAnalyticsQuery(req.query, req.user, { now, allowDepartment: false });
  respond(res, "Analytics overview retrieved successfully", filters, await getOverview(filters, now), now);
});

export const issueBreakdown = handle(async (req, res) => {
  const now = new Date();
  const filters = parseAnalyticsQuery(req.query, req.user, { now, groupByOptions: GROUP_BY.issues, defaultGroupBy: "category" });
  respond(res, "Issue breakdown retrieved successfully", filters, await getIssueBreakdown(filters, now), now);
});

export const resolutionTime = handle(async (req, res) => {
  const now = new Date();
  const filters = parseAnalyticsQuery(req.query, req.user, { now, defaultDays: 30, requireRange: true, groupByOptions: GROUP_BY.resolution, defaultGroupBy: "none" });
  respond(res, "Resolution time retrieved successfully", filters, { resolution: await getResolutionTime(filters) }, now);
});

export const departmentPerformance = handle(async (req, res) => {
  const now = new Date();
  const filters = parseAnalyticsQuery(req.query, req.user, { now });
  respond(res, "Department performance retrieved successfully", filters, await getDepartmentPerformance(filters, now), now);
});

export const trends = handle(async (req, res) => {
  const now = new Date();
  const filters = parseAnalyticsQuery(req.query, req.user, { now, defaultDays: 30, requireRange: true, allowDepartment: false, intervals: true });
  respond(res, "Trends retrieved successfully", filters, await getTrends(filters), now);
});
