import mongoose from "mongoose";

export const REVIEW_STATUSES = ["pending", "in_review", "linked", "new_issue_created", "rejected", "deferred"];
export const OPEN_REVIEW_STATUSES = ["pending", "in_review", "deferred"];

const candidateSchema = new mongoose.Schema(
  {
    issue: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true },
    distanceMeters: Number,
    textSimilarity: Number,
    score: Number,
    wardRelation: String,
    sharedTokens: [String],
    confidence: String,
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, default: "system" },
    reason: { type: String, default: "", maxlength: 1000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const matchReviewSchema = new mongoose.Schema(
  {
    report: { type: mongoose.Schema.Types.ObjectId, ref: "Report", required: true, unique: true },
    category: { type: String, required: true },
    municipality: { type: String, default: null },
    ward: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", default: null },
    candidates: { type: [candidateSchema], default: [] },
    // Why queued: ambiguous | below_auto_threshold | ward_conflict | matching_unavailable | lock_timeout
    reason: { type: String, default: "below_auto_threshold" },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: REVIEW_STATUSES, default: "pending" },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decision: { type: String, default: null },
    decisionReason: { type: String, default: "", maxlength: 1000 },
    resolvedIssue: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", default: null },
    reviewedAt: { type: Date, default: null },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

matchReviewSchema.index({ status: 1, ward: 1, createdAt: 1 });

export default mongoose.model("MatchReview", matchReviewSchema);
