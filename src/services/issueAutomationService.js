import Issue from "../models/Issue.js";
import MatchingLock from "../models/MatchingLock.js";
import { getAutomationConfig, RULES_VERSION } from "../config/automation.js";
import { computeDeadline } from "./priorityService.js";
import { recordEvent } from "./issueEventService.js";
import { acquireLock, releaseLock } from "./matchingLockService.js";
import { runInTransaction } from "./transaction.js";
import { AppError } from "../utils/AppError.js";

export const AUTOMATED_STATUSES = ["open", "under_review", "assigned", "in_progress"];
const HOUR_MS = 3600 * 1000;
export const JOB_LOCK_KEY = "job:issue-automation";

const sameDate = (a, b) => Boolean(a && b) && new Date(a).getTime() === new Date(b).getTime();

// Applies automatic priority, deadline and escalation rules to ONE issue.
//
// Safe to rerun: every rule only writes when its computed result differs from what is stored, the
// issue is updated with a compare-and-set on every field the automation reads, and the issue update
// and its system events commit in one transaction. Breach/escalation events additionally carry an
// idempotency key tied to the breached deadline, so the database refuses a duplicate even if the
// compare-and-set were somehow bypassed.
export const processIssue = async (issueId, { now = new Date(), config = getAutomationConfig() } = {}) => {
  let outcome;
  await runInTransaction(async (session) => {
    outcome = { changed: false, priorityChanged: false, suggestion: false, deadlineSet: false, breached: false, escalations: 0, cleared: false };
    const issue = await Issue.findById(issueId).select("+matchTexts").session(session).lean();
    if (!issue || !AUTOMATED_STATUSES.includes(issue.status)) return;

    const set = {};
    const events = [];

    // ── 1. priority: derived from the ranking score (services/issueScoreService.js), not recomputed here ──
    const priority = issue.priority;

    // ── 2. deadline (only when staff have not set or cleared one) ───────────────
    let deadline = issue.deadline;
    if (issue.deadlineSource === "auto" || (!issue.deadline && issue.deadlineSource !== "manual")) {
      const rule = computeDeadline(issue, priority);
      const apply = !issue.deadline || (issue.deadlineSource === "auto" && rule.deadline.getTime() < new Date(issue.deadline).getTime());
      if (apply && !sameDate(rule.deadline, issue.deadline)) {
        deadline = rule.deadline;
        Object.assign(set, { deadline, deadlineSource: "auto" });
        events.push({
          eventType: "deadline_updated",
          summary: "A resolution deadline was set automatically.",
          reason: `Category "${issue.category}" target of ${rule.slaDays} day(s) x ${rule.multiplier} for ${priority} priority.`,
          details: { reasonCode: "auto_deadline" },
          metadata: { from: issue.deadline ?? null, to: deadline, source: "auto", slaDays: rule.slaDays, multiplier: rule.multiplier },
        });
        outcome.deadlineSet = true;
      }
    }

    // ── 3. overdue detection and escalation (once per breached deadline) ────────
    const currentLevel = sameDate(issue.escalationDeadline, deadline) ? issue.escalationLevel || 0 : 0;
    let target = 0;
    if (deadline && new Date(deadline).getTime() < now.getTime()) {
      target = now.getTime() - new Date(deadline).getTime() >= config.escalationGraceHours * HOUR_MS ? 2 : 1;
    }
    const deadlineMs = deadline ? new Date(deadline).getTime() : 0;
    const overdueHours = deadline ? Math.floor((now.getTime() - deadlineMs) / HOUR_MS) : 0;
    if (target > currentLevel) {
      if (currentLevel === 0) {
        events.push({
          eventType: "deadline_breached", idempotencyKey: `breach:${deadlineMs}`,
          details: { reasonCode: "deadline_breached" },
          metadata: { deadline, overdueHours },
        });
        outcome.breached = true;
      }
      for (let level = currentLevel + 1; level <= target; level += 1) {
        events.push({
          eventType: "issue_escalated", idempotencyKey: `escalate:${level}:${deadlineMs}`,
          summary: level === 1 ? "Overdue issue flagged in the ward administrators' queue." : "Issue overdue beyond the grace period; escalated to the super administrators' queue.",
          details: { reasonCode: `escalation_level_${level}` },
          metadata: { level, queue: level === 1 ? "ward_admin" : "super_admin", deadline, overdueHours },
        });
        outcome.escalations += 1;
      }
      Object.assign(set, { escalationLevel: target, escalationDeadline: deadline, escalatedAt: now });
    } else if (target === 0 && (issue.escalationLevel || 0) > 0) {
      Object.assign(set, { escalationLevel: 0, escalationDeadline: null, escalatedAt: null });
      events.push({ eventType: "system_action", summary: "Escalation cleared: the issue is no longer overdue.", details: { reasonCode: "escalation_cleared" }, metadata: { previousLevel: issue.escalationLevel } });
      outcome.cleared = true;
    }

    if (!Object.keys(set).length) return;
    const updated = await Issue.findOneAndUpdate(
      {
        _id: issue._id, status: issue.status, priority: issue.priority, priorityUpdatedBy: issue.priorityUpdatedBy ?? null,
        deadline: issue.deadline ?? null, deadlineSource: issue.deadlineSource ?? null, escalationLevel: issue.escalationLevel ?? null,
      },
      { $set: set },
      { returnDocument: "after", session }
    ).lean();
    if (!updated) throw new AppError(409, "Issue changed while automation was running", "ISSUE_CONFLICT");
    for (const event of events) await recordEvent({ issue: issue._id, ...event }, session); // system actor
    outcome.changed = true;
  });
  return outcome;
};

const renewLock = ({ key, owner }, leaseMs) => MatchingLock.updateOne({ key, owner }, { $set: { expiresAt: new Date(Date.now() + leaseMs) } });

// One automation pass over all active issues. Errors are isolated per issue and logged without
// issue content; a failed issue is retried on the next pass and is never left half-updated.
export const runAutomationCycle = async ({ now = new Date(), config = getAutomationConfig() } = {}) => {
  const started = Date.now();
  let lock;
  try {
    lock = await acquireLock(JOB_LOCK_KEY, { waitMs: 0, leaseMs: config.lockLeaseMs });
  } catch (error) {
    if (error.code === "MATCH_LOCK_TIMEOUT") return { skipped: true, reason: "already_running" };
    throw error;
  }
  const summary = { skipped: false, processed: 0, changed: 0, priorityChanged: 0, suggestions: 0, deadlinesSet: 0, breached: 0, escalations: 0, cleared: 0, conflicts: 0, errors: 0 };
  try {
    const cursor = Issue.find({ status: { $in: AUTOMATED_STATUSES } }).select("_id").sort({ _id: 1 }).cursor({ batchSize: config.batchSize });
    for await (const { _id } of cursor) {
      try {
        const result = await processIssue(_id, { now, config });
        summary.processed += 1;
        if (result?.changed) summary.changed += 1;
        if (result?.priorityChanged) summary.priorityChanged += 1;
        if (result?.suggestion) summary.suggestions += 1;
        if (result?.deadlineSet) summary.deadlinesSet += 1;
        if (result?.breached) summary.breached += 1;
        summary.escalations += result?.escalations || 0;
        if (result?.cleared) summary.cleared += 1;
      } catch (error) {
        if (error.code === "ISSUE_CONFLICT") summary.conflicts += 1;
        else {
          summary.errors += 1;
          console.error(`[AUTOMATION] issue ${_id} failed: ${error.message}`);
        }
      }
      if (summary.processed % 100 === 0) await renewLock(lock, config.lockLeaseMs).catch(() => {});
    }
  } finally {
    await releaseLock(lock).catch((error) => console.error(`[AUTOMATION] lock release failed: ${error.message}`));
  }
  summary.durationMs = Date.now() - started;
  return summary;
};
