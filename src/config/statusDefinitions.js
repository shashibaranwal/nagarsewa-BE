// Single definition of the status groups used by analytics. They intentionally match the groups used
// by the admin queue/dashboard (Phase 7) and the automation job (Phase 8).
export const ISSUE_OPEN_STATUSES = ["open", "under_review", "assigned", "in_progress"]; // "open work"
export const ISSUE_RESOLVED_STATUSES = ["resolved", "closed"]; // "resolved work"
export const ISSUE_EXCLUDED_FROM_TOTAL = ["merged"]; // duplicates of another issue, never counted as separate problems
// total = open + resolved + cancelled (every non-merged issue)

export const REPORT_INACTIVE_STATUSES = ["withdrawn", "rejected"]; // not counted as active reports
export const ANALYTICS_TIMEZONE = "Asia/Kathmandu"; // fixed UTC+05:45, no daylight saving
export const ANALYTICS_UTC_OFFSET = "+05:45";
