// Minimal per-user fixed-window limiter for expensive endpoints (per-process; use a shared store
// such as Redis if the API runs on several instances).
const buckets = new Map();

export const rateLimit = ({ windowMs = 60_000, max = 60 } = {}) => (req, res, next) => {
  if (process.env.NODE_ENV === "test") return next();
  const key = `${req.user?._id || req.ip}:${req.baseUrl}${req.route?.path || ""}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > max) {
    res.set("Retry-After", Math.ceil((bucket.reset - now) / 1000));
    return res.status(429).json({ success: false, message: "Too many requests, please slow down" });
  }
  return next();
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
}, 60_000).unref();
