// Automation rules for priority, deadlines and escalation. ALL VALUES ARE PROVISIONAL MVP DEFAULTS
// (no municipal service-level agreement has been agreed yet); tune them here or via env.
const num = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const RULES_VERSION = "priority-v1";

// Base points per category (hazard potential / service criticality).
export const CATEGORY_POINTS = {
  electricity: 2, water_supply: 2, sewerage: 2,
  pothole: 1, road: 1, drainage: 1, traffic: 1, street_lighting: 1, public_infrastructure: 1, sanitation: 1, waste_management: 1,
  environment: 0, other: 0,
};

// Provisional target resolution time (days) per category, before the priority multiplier.
export const SLA_DAYS = {
  electricity: 2, water_supply: 3, sewerage: 3, sanitation: 3, waste_management: 3, drainage: 5,
  pothole: 7, street_lighting: 7, traffic: 7, road: 14, public_infrastructure: 14, environment: 14, other: 14,
};
export const PRIORITY_DEADLINE_MULTIPLIER = { critical: 0.5, high: 0.75, medium: 1, low: 1.5 };

// Lower-case substrings that flag a potential immediate danger (English + Nepali). A match only
// ever SUGGESTS critical; it never auto-sets it (see priorityService).
export const URGENCY_KEYWORDS = [
  "open manhole", "manhole open", "live wire", "exposed wire", "electric shock", "electrocut", "sinkhole",
  "gas leak", "fire", "flood", "collapse", "accident", "landslide", "sparking",
  "खुला म्यानहोल", "करेन्ट", "आगलागी", "बाढी", "पहिरो", "दुर्घटना",
];

// Volume / age bands: [minimum, points], highest matching band wins.
export const VOLUME_BANDS = [[1, 0], [2, 1], [5, 2], [10, 3]];
export const AGE_DAY_BANDS = [[0, 0], [3, 1], [7, 2], [14, 3]];

export const getAutomationConfig = () => ({
  enabled: process.env.ENABLE_AUTOMATION === "true",
  intervalMinutes: Math.max(1, num(process.env.AUTOMATION_INTERVAL_MINUTES, 15)),
  // Hours an issue may stay overdue at level 1 (ward queue) before moving to level 2 (super admin queue).
  escalationGraceHours: Math.max(1, num(process.env.AUTOMATION_ESCALATION_GRACE_HOURS, 48)),
  batchSize: Math.max(10, num(process.env.AUTOMATION_BATCH_SIZE, 200)),
  lockLeaseMs: num(process.env.AUTOMATION_LOCK_LEASE_MS, 10 * 60 * 1000),
  // Official priority set automatically never exceeds this level; "critical" needs a human.
  maxAutoPriority: "high",
});
