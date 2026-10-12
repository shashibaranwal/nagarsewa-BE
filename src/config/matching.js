// Centralized, env-tunable matching configuration. Values are PROVISIONAL starting points,
// not validated production thresholds. Clients can never override them via requests.
const num = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const MATCHING_METHOD = "geo+jaccard-v1";

export const getMatchingConfig = () => {
  let autoThreshold = num(process.env.ISSUE_AUTO_MATCH_THRESHOLD, 0.8);
  let reviewThreshold = num(process.env.ISSUE_REVIEW_THRESHOLD, 0.45);
  if (!(reviewThreshold >= 0 && autoThreshold <= 1 && reviewThreshold <= autoThreshold)) {
    console.error("[MATCHING_CONFIG] Invalid thresholds, using defaults 0.80/0.45");
    autoThreshold = 0.8;
    reviewThreshold = 0.45;
  }
  const textWeight = Math.min(1, Math.max(0, num(process.env.ISSUE_MATCH_TEXT_WEIGHT, 0.7)));
  return {
    radiusMeters: Math.max(1, num(process.env.ISSUE_MATCH_RADIUS_METERS, 100)),
    autoThreshold,
    reviewThreshold,
    ambiguityMargin: num(process.env.ISSUE_MATCH_AMBIGUITY_MARGIN, 0.05),
    maxCandidates: Math.max(1, num(process.env.ISSUE_MATCH_MAX_CANDIDATES, 10)),
    minTokensForAuto: num(process.env.ISSUE_MATCH_MIN_TOKENS, 3),
    weights: { text: textWeight, distance: 1 - textWeight },
    queryTimeoutMs: num(process.env.ISSUE_MATCH_QUERY_TIMEOUT_MS, 5000),
    textSamples: 3,
    sampleChars: 400,
    nearbyDefaultRadius: num(process.env.ISSUE_NEARBY_DEFAULT_RADIUS_METERS, 500),
    nearbyMaxRadius: num(process.env.ISSUE_NEARBY_MAX_RADIUS_METERS, 5000),
    lock: {
      leaseMs: num(process.env.ISSUE_LOCK_LEASE_MS, 15000),
      waitMs: num(process.env.ISSUE_LOCK_WAIT_MS, 5000),
      retryMs: 40,
    },
  };
};
