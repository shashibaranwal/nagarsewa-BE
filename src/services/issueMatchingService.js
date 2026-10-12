import Issue, { ELIGIBLE_ISSUE_STATUSES } from "../models/Issue.js";
import { getMatchingConfig, MATCHING_METHOD } from "../config/matching.js";
import { GEO_MATCHING, isLegacyMatching } from "../config/geoMatching.js";
import { checkSameProblem } from "./geminiMatch.js";
import { bestSimilarity, tokenSet } from "../utils/textSimilarity.js";

const round = (value, places = 4) => Number(value.toFixed(places));
const sameId = (a, b) => a && b && a.toString() === b.toString();

// Candidate retrieval: geospatial + category + municipal scope + lifecycle eligibility.
// Municipality `null` only matches issues whose municipality is also unknown.
export const findCandidateIssues = async (
  { location, category, municipality },
  { radiusMeters, limit, statuses = ELIGIBLE_ISSUE_STATUSES, excludeId, anyMunicipality = false, config = getMatchingConfig() } = {}
) => {
  const query = { category, status: { $in: statuses }, ...(!anyMunicipality && { municipality: municipality ?? null }) };
  if (excludeId) query._id = { $ne: excludeId };
  return Issue.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: location.coordinates },
        distanceField: "distanceMeters",
        maxDistance: radiusMeters ?? config.radiusMeters,
        spherical: true,
        key: "location",
        query,
      },
    },
    { $limit: limit ?? config.maxCandidates },
    {
      $project: {
        category: 1, summary: 1, description: 1, location: 1, municipality: 1, ward: 1, department: 1, status: 1,
        priority: 1, reportCount: 1, matchTexts: 1, distanceMeters: 1, createdAt: 1,
      },
    },
  ])
    .option({ maxTimeMS: config.queryTimeoutMs })
    .exec();
};

// Scores every candidate and explains it. Text similarity is a token-overlap score,
// NOT a calibrated probability of "same problem".
export const scoreCandidates = (subject, candidates, config = getMatchingConfig()) => {
  const subjectTokens = tokenSet(`${subject.title || ""} ${subject.description || ""}`);
  return candidates.map((candidate) => {
    const texts = [candidate.summary, ...(candidate.matchTexts || [])];
    const text = bestSimilarity(subjectTokens, texts);
    const distanceScore = Math.max(0, 1 - candidate.distanceMeters / config.radiusMeters);
    const score = config.weights.text * text.score + config.weights.distance * distanceScore;
    const wardRelation =
      subject.ward && candidate.ward ? (sameId(subject.ward, candidate.ward) ? "same" : "different") : "unknown";
    const enoughText = subjectTokens.size >= config.minTokensForAuto && text.tokenCount >= config.minTokensForAuto;

    const reasons = ["category_match", `within_${config.radiusMeters}m_radius`];
    let confidence = "none";
    if (text.score < config.reviewThreshold) reasons.push("text_below_review_threshold");
    else if (text.score >= config.autoThreshold && wardRelation !== "different" && enoughText) {
      confidence = "auto";
      reasons.push("text_meets_auto_threshold");
    } else {
      confidence = "review";
      if (text.score >= config.autoThreshold && wardRelation === "different") reasons.push("ward_conflict");
      else if (text.score >= config.autoThreshold && !enoughText) reasons.push("too_few_meaningful_tokens");
      else reasons.push("text_below_auto_threshold");
    }
    return {
      issueId: candidate._id,
      summary: candidate.summary,
      category: candidate.category,
      location: candidate.location,
      ward: candidate.ward,
      department: candidate.department,
      status: candidate.status,
      priority: candidate.priority,
      reportCount: candidate.reportCount,
      distanceMeters: round(candidate.distanceMeters, 1),
      textSimilarity: round(text.score),
      score: round(score),
      categoryMatch: true,
      wardRelation,
      sharedTokens: text.shared.slice(0, 8),
      matchingMethod: MATCHING_METHOD,
      confidence,
      reasons,
    };
  });
};

const rankCandidates = (scored) =>
  [...scored].sort(
    (a, b) =>
      b.score - a.score ||
      a.distanceMeters - b.distanceMeters ||
      b.reportCount - a.reportCount ||
      a.issueId.toString().localeCompare(b.issueId.toString())
  );

// Decision policy:
//  - no candidate reaching the review threshold            -> new_issue
//  - exactly one clear "auto" winner                        -> auto_linked
//  - several "auto" candidates within the ambiguity margin  -> pending_review (ambiguous)
//  - otherwise (plausible but not confident)                -> pending_review
export const decideMatch = (scored, config = getMatchingConfig(), candidatesConsidered = scored.length) => {
  const ranked = rankCandidates(scored);
  const plausible = ranked.filter((c) => c.confidence !== "none");
  const meta = {
    method: MATCHING_METHOD,
    radiusMeters: config.radiusMeters,
    autoThreshold: config.autoThreshold,
    reviewThreshold: config.reviewThreshold,
    candidatesConsidered,
  };
  if (!plausible.length) return { decision: "new_issue", reason: "no_candidate", candidates: ranked, chosen: null, config: meta };

  const autos = plausible.filter((c) => c.confidence === "auto");
  if (autos.length === 1 || (autos.length > 1 && autos[0].score - autos[1].score >= config.ambiguityMargin)) {
    return { decision: "auto_linked", reason: "auto_threshold_met", candidates: ranked, chosen: autos[0], config: meta };
  }
  const reason = autos.length > 1 ? "ambiguous" : plausible.some((c) => c.reasons.includes("ward_conflict")) ? "ward_conflict" : "below_auto_threshold";
  return { decision: "pending_review", reason, candidates: plausible.slice(0, 5), chosen: null, config: meta };
};

// ── Geo-first matching ────────────────────────────────────────────────────────
//  d <= SAME_SPOT_M and category != "other" -> merged_geo (no AI)
//  SAME_SPOT_M < d <= CANDIDATE_M (or d <= SAME_SPOT_M for "other") -> ask Gemini -> merged_ai / new_issue
//  d > CANDIDATE_M or no candidate -> new_issue (no AI)
// Any AI failure means new_issue; submission is never blocked by it.
export const decideGeoMatch = async ({ candidate, subject, askGemini = checkSameProblem, geo = GEO_MATCHING }) => {
  const meta = { method: "geo+gemini-v1", sameSpotMeters: geo.SAME_SPOT_M, candidateMeters: geo.CANDIDATE_M };
  const none = (reason) => ({ decision: "new_issue", reason, candidates: [], chosen: null, config: meta });
  if (!candidate || candidate.distanceMeters > geo.CANDIDATE_M) return none("no_candidate_in_range");

  const distanceMeters = round(candidate.distanceMeters, 1);
  const chosen = (confidence) => ({
    issueId: candidate._id, distanceMeters, score: confidence, textSimilarity: null, wardRelation: "unknown", sharedTokens: [],
  });
  if (candidate.distanceMeters <= geo.SAME_SPOT_M && subject.category !== "other") {
    return { decision: "auto_linked", matchType: "merged_geo", reason: "same_spot", candidates: [], chosen: chosen(1), config: meta };
  }

  const verdict = await askGemini({
    category: subject.category,
    distanceMeters,
    existing: { title: candidate.summary, description: candidate.description },
    report: { title: subject.title, description: subject.description },
  });
  if (!verdict) return none("ai_unavailable");
  if (verdict.sameProblem && verdict.confidence >= geo.AI_MIN_CONFIDENCE) {
    console.log(`[MATCHING] merged_ai at ${distanceMeters}m: ${verdict.reason}`);
    return { decision: "auto_linked", matchType: "merged_ai", reason: "ai_same_problem", candidates: [], chosen: chosen(verdict.confidence), config: { ...meta, aiModel: verdict.model } };
  }
  console.log(`[MATCHING] new_issue at ${distanceMeters}m after AI check: ${verdict.reason}`);
  return none("ai_different_problem");
};

export const evaluateMatch = async (subject, options = {}) => {
  if (!isLegacyMatching()) {
    const [candidate] = await findCandidateIssues(subject, { radiusMeters: GEO_MATCHING.CANDIDATE_M, limit: 1, anyMunicipality: true });
    return decideGeoMatch({ candidate, subject, askGemini: options.askGemini });
  }
  const config = options.config || getMatchingConfig();
  const raw = await findCandidateIssues(subject, { config });
  return decideMatch(scoreCandidates(subject, raw, config), config, raw.length);
};

export const toReviewCandidates = (candidates) =>
  candidates.map((c) => ({
    issue: c.issueId,
    distanceMeters: c.distanceMeters,
    textSimilarity: c.textSimilarity,
    score: c.score,
    wardRelation: c.wardRelation,
    sharedTokens: c.sharedTokens,
    confidence: c.confidence,
  }));
