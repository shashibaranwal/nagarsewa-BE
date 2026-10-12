// Deterministic, explainable text similarity (token Jaccard). No stemming, translation or
// semantic understanding is implemented: English and Nepali (Devanagari) are tokenized as-is.
const ENGLISH_STOP_WORDS = [
  "a", "an", "the", "on", "in", "at", "of", "to", "is", "are", "was", "were", "be", "been", "and",
  "or", "for", "with", "this", "that", "it", "its", "there", "here", "has", "have", "had", "by",
  "from", "as", "very", "so", "please", "i", "we", "our", "my", "since", "again",
];
const NEPALI_STOP_WORDS = [
  "र", "को", "का", "की", "मा", "छ", "छन्", "हो", "यो", "त्यो", "लाई", "बाट", "पनि", "ले", "हुन",
  "भएको", "गरेको", "एक", "छैन", "थियो",
];

export const DEFAULT_STOP_WORDS = new Set([...ENGLISH_STOP_WORDS, ...NEPALI_STOP_WORDS]);

export const normalizeText = (text = "") =>
  String(text)
    .normalize("NFC")
    .toLowerCase()
    // keep letters, numbers and combining marks (required to preserve Devanagari)
    .replace(/[^\p{L}\p{N}\p{M}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const tokenize = (text, stopWords = DEFAULT_STOP_WORDS) =>
  normalizeText(text)
    .split(" ")
    .filter((token) => token && !stopWords.has(token) && ([...token].length > 1 || /\p{N}/u.test(token)));

export const tokenSet = (text, stopWords) => new Set(tokenize(text, stopWords));

// J(A,B) = |A ∩ B| / |A ∪ B|; empty sets score 0 (never a match).
export const jaccard = (a, b) => {
  if (!a.size || !b.size) return { score: 0, shared: [] };
  const shared = [...a].filter((token) => b.has(token));
  const union = a.size + b.size - shared.length;
  return { score: shared.length / union, shared };
};

// Best Jaccard of `tokens` against several candidate texts.
export const bestSimilarity = (tokens, texts) => {
  let best = { score: 0, shared: [], tokenCount: 0 };
  for (const text of texts) {
    const other = tokenSet(text);
    const result = jaccard(tokens, other);
    if (result.score > best.score || !best.tokenCount) best = { ...result, tokenCount: other.size };
  }
  return best;
};
