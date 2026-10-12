import mongoose from "mongoose";

// Cross-instance lease lock. `key` is unique; `owner` is a random token used for compare-and-set.
const matchingLockSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  owner: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});
matchingLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 }); // janitor for abandoned rows

export default mongoose.model("MatchingLock", matchingLockSchema);
