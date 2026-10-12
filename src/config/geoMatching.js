// Single place for the geo-first matching and ranking-score constants.
// Distances are metres. Everything here is a demo-tuned starting point, not a validated threshold.
const num = (value, fallback) => {
  const parsed = value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const GEO_MATCHING = {
  SAME_SPOT_M: num(process.env.GEO_SAME_SPOT_M, 30), // <= this (and category != "other"): merge without AI
  CANDIDATE_M: num(process.env.GEO_CANDIDATE_M, 100), // <= this: candidate; between the two the AI decides
  AI_MIN_CONFIDENCE: 0.7,
  AI_TIMEOUT_MS: 8000, // total budget across all model fallbacks
  AI_MODELS: (process.env.GEMINI_MODELS || "gemini-3.5-flash,gemini-flash-latest,gemini-3.8-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  AI_ENDPOINT: "https://generativelanguage.googleapis.com/v1beta/models",
};

// Legacy text-based matching (review queue) stays available: MATCHING_MODE=legacy.
export const isLegacyMatching = () => process.env.MATCHING_MODE === "legacy";

export const SCORE = {
  CATEGORY_WEIGHT: { water_supply: 2, electricity: 2, drainage: 2, road: 1.5, pothole: 1.5, traffic: 1.5 },
  DEFAULT_CATEGORY_WEIGHT: 1,
  DEFAULT_SEVERITY: 2,
  MAX_DAYS_OPEN: 14,
  // score -> priority (single source of truth: priority, priorityLabel and scoreLevel all come from this)
  LEVELS: [
    [14, "critical"],
    [11, "high"],
    [8, "medium"],
    [-Infinity, "low"],
  ],
};
