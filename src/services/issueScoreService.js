import Issue, { ELIGIBLE_ISSUE_STATUSES } from "../models/Issue.js";
import { SCORE } from "../config/geoMatching.js";
import { PRIORITY_RANK } from "../models/Issue.js";
import { recordEvent } from "./issueEventService.js";

const DAY_MS = 24 * 3600 * 1000;
const SEVERE = /\b(fire|flood\w*|collaps\w*|electrocut\w*|live wire|accident|injur\w*|sewage|overflow\w*|manhole|danger\w*|emergency|urgent\w*|hazard\w*)\b/i;
const MODERATE = /\b(broken|leak\w*|block\w*|dark|garbage|smell\w*|stink\w*|damaged|no water|week|days)\b/i;

// Derived once, at issue creation. 1-5, default 2.
export const deriveSeverity = ({ category, title = "", description = "" }) => {
  const text = `${title} ${description}`;
  let severity = SCORE.DEFAULT_SEVERITY;
  if (SEVERE.test(text)) severity = 4;
  else if (MODERATE.test(text)) severity = 3;
  if (["water_supply", "electricity", "sewerage", "drainage"].includes(category) && severity < 5) severity += 1;
  return Math.min(5, Math.max(1, severity));
};

export const scoreLevel = (score) => SCORE.LEVELS.find(([min]) => score >= min)[1];

// score = 3*ln(1+uniqueReporters) + 2*severity + min(daysOpen, 14) + categoryWeight
export const computeScore = ({ uniqueReporters = 1, severity = SCORE.DEFAULT_SEVERITY, category, firstReportedAt, createdAt }, now = new Date()) => {
  const start = new Date(firstReportedAt || createdAt || now).getTime();
  const daysOpen = Math.min(SCORE.MAX_DAYS_OPEN, Math.max(0, (now.getTime() - start) / DAY_MS));
  const weight = SCORE.CATEGORY_WEIGHT[category] ?? SCORE.DEFAULT_CATEGORY_WEIGHT;
  const score = 3 * Math.log(1 + uniqueReporters) + 2 * severity + daysOpen + weight;
  return Math.round(score * 100) / 100;
};

const SCORE_FIELDS = "uniqueReporters severity category firstReportedAt createdAt score priority priorityUpdatedBy";

// Fields to write for `issue` at `now`: score always; priority/priorityRank derived from the score.
// A priority a staff member set by hand (priorityUpdatedBy) is never overwritten; the score still updates.
export const scoreUpdateFor = (issue, now = new Date()) => {
  const score = computeScore(issue, now);
  const level = scoreLevel(score);
  const set = { score, scoreComputedAt: now };
  let change = null;
  if (!issue.priorityUpdatedBy && level !== issue.priority) {
    Object.assign(set, { priority: level, priorityRank: PRIORITY_RANK[level], priorityReason: `Derived from ranking score ${score}`, priorityUpdatedAt: now });
    change = { from: issue.priority, to: level, score };
  }
  return { set, score, level, change };
};

export const priorityEvent = (issueId, change, session = null) =>
  recordEvent({
    issue: issueId,
    eventType: "priority_changed",
    summary: `Priority automatically changed from ${change.from} to ${change.to}.`,
    reason: `Ranking score ${change.score}`,
    details: { reasonCode: "auto_priority" },
    metadata: { from: change.from, to: change.to, score: change.score, auto: true },
  }, session);

export const recomputeIssueScore = async (issueId, { session = null, now = new Date() } = {}) => {
  const issue = await Issue.findById(issueId).select(SCORE_FIELDS).session(session).lean();
  if (!issue) return null;
  const { set, score, change } = scoreUpdateFor(issue, now);
  await Issue.updateOne({ _id: issueId }, { $set: set }, { session });
  if (change) await priorityEvent(issueId, change, session);
  return score;
};

// Daily job: only open issues are ranked, so only those are recomputed. Returns how many changed.
export const recomputeAllScores = async (now = new Date()) => {
  const cursor = Issue.find({ status: { $in: ELIGIBLE_ISSUE_STATUSES } }).select(SCORE_FIELDS).cursor();
  const ops = [];
  const changes = [];
  for await (const issue of cursor) {
    const { set, score, change } = scoreUpdateFor(issue, now);
    if (score === issue.score && !change) continue;
    ops.push({ updateOne: { filter: { _id: issue._id }, update: { $set: set } } });
    if (change) changes.push([issue._id, change]);
  }
  if (ops.length) await Issue.bulkWrite(ops);
  for (const [id, change] of changes) await priorityEvent(id, change);
  return ops.length;
};
