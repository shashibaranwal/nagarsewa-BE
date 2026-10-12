import { GEO_MATCHING } from "../config/geoMatching.js";

const RETRY_STATUSES = new Set([404, 429, 503]);

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    sameProblem: { type: "BOOLEAN" },
    confidence: { type: "NUMBER" },
    reason: { type: "STRING" },
  },
  required: ["sameProblem", "confidence", "reason"],
};

const clip = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const buildPrompt = ({ category, distanceMeters, existing, report }) =>
  [
    "Two citizen reports of a civic problem were made close together. Decide if they describe the SAME physical problem.",
    `Category: ${category}. Distance apart: ${Math.round(distanceMeters)} m.`,
    `Existing issue: "${clip(existing.title, 150)}" - ${clip(existing.description, 400)}`,
    `New report: "${clip(report.title, 150)}" - ${clip(report.description, 400)}`,
    "Answer JSON {sameProblem, confidence (0-1), reason (max 15 words)}.",
  ].join("\n");

// Returns { sameProblem, confidence, reason, model } or null on ANY failure/timeout.
// The API key travels in the x-goog-api-key header only and is never logged.
export const checkSameProblem = async (input, { fetchImpl = fetch, config = GEO_MATCHING } = {}) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn("[GEMINI_MATCH] GEMINI_API_KEY not set, skipping AI check");
    return null;
  }
  const deadline = Date.now() + config.AI_TIMEOUT_MS;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  });

  for (const model of config.AI_MODELS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetchImpl(`${config.AI_ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
        signal: controller.signal,
      });
      if (RETRY_STATUSES.has(response.status)) {
        console.warn(`[GEMINI_MATCH] ${model} returned ${response.status}, trying next model`);
        continue;
      }
      if (!response.ok) {
        console.error(`[GEMINI_MATCH] ${model} failed with HTTP ${response.status}`);
        return null;
      }
      const json = await response.json();
      const parsed = JSON.parse(json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "null");
      if (!parsed || typeof parsed.sameProblem !== "boolean" || !Number.isFinite(Number(parsed.confidence))) {
        console.error(`[GEMINI_MATCH] ${model} returned an unusable payload`);
        return null;
      }
      const result = {
        sameProblem: parsed.sameProblem,
        confidence: Math.min(1, Math.max(0, Number(parsed.confidence))),
        reason: clip(parsed.reason, 120),
        model,
      };
      console.log(`[GEMINI_MATCH] model=${model} same=${result.sameProblem} confidence=${result.confidence} reason="${result.reason}"`);
      return result;
    } catch (error) {
      console.error(`[GEMINI_MATCH] ${model} error: ${error.name === "AbortError" ? "timeout" : error.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  console.error("[GEMINI_MATCH] no model produced an answer");
  return null;
};
