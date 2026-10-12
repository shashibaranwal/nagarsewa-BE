import { getAutomationConfig } from "../config/automation.js";
import { runAutomationCycle } from "../services/issueAutomationService.js";
import { recomputeAllScores } from "../services/issueScoreService.js";

let timer = null;
let initial = null;
let running = false;

const tick = async () => {
  if (running) return; // never overlap runs inside one process; the DB lock covers other instances
  running = true;
  try {
    const summary = await runAutomationCycle();
    if (!summary.skipped) console.log(`[AUTOMATION] cycle done ${JSON.stringify(summary)}`);
  } catch (error) {
    console.error(`[AUTOMATION] cycle failed: ${error.message}`);
  } finally {
    running = false;
  }
};

// Disabled unless ENABLE_AUTOMATION=true. Several app instances may run it: runAutomationCycle takes
// a cross-instance lease lock and skips when another instance is already running a cycle.
export const startAutomationScheduler = () => {
  const config = getAutomationConfig();
  if (!config.enabled || timer) return false;
  initial = setTimeout(tick, 30 * 1000);
  timer = setInterval(tick, config.intervalMinutes * 60 * 1000);
  initial.unref();
  timer.unref();
  console.log(`[AUTOMATION] scheduler started (every ${config.intervalMinutes} min)`);
  return true;
};

export const stopAutomationScheduler = () => {
  clearTimeout(initial);
  clearInterval(timer);
  timer = null;
  initial = null;
};


// ── Daily ranking-score refresh ──────────────────────────────────────────────
// daysOpen grows with time, so open issues are rescored daily (merges/withdrawals rescore immediately).
let scoreTimer = null;
const DAY_MS = 24 * 3600 * 1000;

export const startScoreScheduler = () => {
  if (process.env.SCORE_JOB_ENABLED === "false" || scoreTimer) return false;
  const run = async () => {
    try {
      const changed = await recomputeAllScores();
      console.log(`[SCORES] daily recompute done, ${changed} issues updated`);
    } catch (error) {
      console.error(`[SCORES] daily recompute failed: ${error.message}`);
    }
  };
  const initial = setTimeout(run, 60 * 1000);
  scoreTimer = setInterval(run, DAY_MS);
  initial.unref();
  scoreTimer.unref();
  return true;
};
