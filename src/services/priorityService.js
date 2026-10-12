import {
  AGE_DAY_BANDS, CATEGORY_POINTS, PRIORITY_DEADLINE_MULTIPLIER, RULES_VERSION, SLA_DAYS, URGENCY_KEYWORDS, VOLUME_BANDS,
} from "../config/automation.js";
import { ISSUE_PRIORITIES } from "../models/Issue.js";
import { normalizeText } from "../utils/textSimilarity.js";

const DAY_MS = 24 * 3600 * 1000;
const band = (value, bands) => bands.reduce((points, [min, p]) => (value >= min ? p : points), 0);

export const findUrgencyKeywords = (texts) => {
  const haystack = normalizeText(texts.filter(Boolean).join(" "));
  return URGENCY_KEYWORDS.filter((keyword) => haystack.includes(normalizeText(keyword)));
};

// PURE and deterministic: the same issue snapshot and `now` always give the same result.
//
//   score = category points + report-volume points + age points + (4 if an urgency keyword matches)
//   level : critical only when an urgency keyword matched AND score >= 6
//           high >= 5, medium 2-4, low <= 1
//   autoLevel (the only level automation may write as the official priority) = min(level, maxAutoPriority)
//
// Report volume and age can raise priority up to "high" but can never reach "critical" on their own.
export const computePriority = (issue, now = new Date(), { maxAutoPriority = "high" } = {}) => {
  const reference = issue.firstReportedAt || issue.createdAt;
  const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(reference).getTime()) / DAY_MS));
  const matched = findUrgencyKeywords([issue.summary, ...(issue.matchTexts || [])]);

  const factors = [
    { name: "category", detail: issue.category, points: CATEGORY_POINTS[issue.category] ?? 0 },
    { name: "reportVolume", detail: issue.reportCount, points: band(issue.reportCount || 0, VOLUME_BANDS) },
    { name: "ageDays", detail: ageDays, points: band(ageDays, AGE_DAY_BANDS) },
    { name: "urgencyKeywords", detail: matched.slice(0, 3), points: matched.length ? 4 : 0 },
  ];
  const score = factors.reduce((sum, factor) => sum + factor.points, 0);
  let level = score >= 5 ? "high" : score >= 2 ? "medium" : "low";
  if (matched.length && score >= 6) level = "critical";
  const cap = ISSUE_PRIORITIES.indexOf(maxAutoPriority);
  const autoLevel = ISSUE_PRIORITIES[Math.min(ISSUE_PRIORITIES.indexOf(level), cap)];
  return { rulesVersion: RULES_VERSION, score, level, autoLevel, urgent: matched.length > 0, factors };
};

export const explainPriority = (result) =>
  `Automatic priority (${result.rulesVersion}): score ${result.score} = ` +
  result.factors.filter((f) => f.points).map((f) => `${f.name} ${f.points}`).join(" + ") + (result.score ? "" : "no contributing factors");

// Deadline = reference date + category SLA days * priority multiplier (rounded to whole minutes).
export const computeDeadline = (issue, priority) => {
  const reference = new Date(issue.firstReportedAt || issue.createdAt).getTime();
  const days = SLA_DAYS[issue.category] ?? SLA_DAYS.other;
  const minutes = Math.round(days * 24 * 60 * (PRIORITY_DEADLINE_MULTIPLIER[priority] ?? 1));
  return { deadline: new Date(reference + minutes * 60000), slaDays: days, multiplier: PRIORITY_DEADLINE_MULTIPLIER[priority] ?? 1 };
};
