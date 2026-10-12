import mongoose from "mongoose";
import { ALLOWED_CATEGORIES } from "./Department.js";

export const ISSUE_STATUSES = [
  "open", "under_review", "assigned", "in_progress", "resolved", "closed", "merged", "cancelled",
];
export const ISSUE_PRIORITIES = ["low", "medium", "high", "critical"];
export const PRIORITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

// Issues in these states can receive new Reports automatically.
export const ELIGIBLE_ISSUE_STATUSES = ["open", "under_review", "assigned", "in_progress"];

// Lifecycle transitions and role rules live in services/issueLifecycleService.js.

export const MATCHING_DECISIONS = ["auto_linked", "merged_geo", "merged_ai", "manually_linked", "new_issue", "rejected_candidate"];

const issueSchema = new mongoose.Schema(
  {
    category: { type: String, enum: ALLOWED_CATEGORIES, required: true },
    summary: { type: String, required: true, trim: true, minlength: 5, maxlength: 300 },
    // Copied from the creating report; later merged-in reports never overwrite it.
    description: { type: String, trim: true, maxlength: 5000, default: "" },
    location: {
      type: { type: String, enum: ["Point"], required: true, default: "Point" },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (c) =>
            Array.isArray(c) && c.length === 2 && c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90,
          message: "Location coordinates must be [longitude, latitude] within valid ranges",
        },
      },
    },
    // No Municipality collection exists (Phase 3 stores it as a string on Ward/Department).
    municipality: { type: String, trim: true, default: null },
    ward: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", default: null },
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    assignedAt: { type: Date, default: null },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deadline: { type: Date, default: null },
    // "manual" (set/cleared by staff) deadlines are never touched by automation.
    deadlineSource: { type: String, enum: ["auto", "manual", null], default: null },
    // Escalation for the CURRENT deadline: 0 none, 1 overdue (ward queue), 2 overdue past grace (super admin queue).
    escalationLevel: { type: Number, enum: [0, 1, 2], default: 0 },
    escalationDeadline: { type: Date, default: null },
    escalatedAt: { type: Date, default: null },

    status: { type: String, enum: ISSUE_STATUSES, default: "open" },
    statusChangedAt: { type: Date, default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Citizen-safe resolution text (staff-only operational detail belongs in internal events).
    resolutionSummary: { type: String, trim: true, maxlength: 1000, default: "" },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },
    lastEventAt: { type: Date, default: null },
    priority: { type: String, enum: ISSUE_PRIORITIES, default: "medium" },
    priorityRank: { type: Number, default: PRIORITY_RANK.medium },
    suggestedPriority: { type: String, enum: [...ISSUE_PRIORITIES, null], default: null },
    priorityReason: { type: String, trim: true, maxlength: 500, default: "" },
    priorityUpdatedAt: { type: Date, default: null },
    priorityUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Explainable automatic priority (see services/priorityService.js). Staff-only in API output.
    priorityScore: { type: Number, default: null },
    priorityFactors: { type: mongoose.Schema.Types.Mixed, default: null },
    priorityComputedAt: { type: Date, default: null },

    // Counting policy: reportCount = linked Reports whose status is not "withdrawn" or "rejected".
    reportCount: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    // Distinct citizens with a live report on this issue. A repeat report by the same citizen never raises it.
    uniqueReporters: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    // 1-5, derived once at creation. score ranks open issues (see services/issueScoreService.js).
    severity: { type: Number, default: 2, min: 1, max: 5 },
    score: { type: Number, default: 0 },
    scoreComputedAt: { type: Date, default: null },
    firstReportedAt: { type: Date, default: null },
    lastReportedAt: { type: Date, default: null },
    // Bounded samples of normalized report text used for similarity (never returned by the API).
    matchTexts: { type: [String], default: [], select: false },

    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", default: null },
    mergedAt: { type: Date, default: null },
    mergedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    mergeReason: { type: String, trim: true, maxlength: 1000, default: "" },

    matchingMethod: { type: String, default: null },
    matchingScore: { type: Number, min: 0, max: 1, default: null },
    matchingThreshold: { type: Number, min: 0, max: 1, default: null },
    matchingFactors: { type: mongoose.Schema.Types.Mixed, default: null },
    matchingDecision: { type: String, enum: [...MATCHING_DECISIONS, null], default: null },
    matchingReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    matchingReviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

issueSchema.pre("validate", function () {
  this.priorityRank = PRIORITY_RANK[this.priority];
  if (this.status === "merged" && !this.mergedInto) this.invalidate("mergedInto", "mergedInto is required for merged issues");
  if (this.mergedInto && this._id && this.mergedInto.equals(this._id)) this.invalidate("mergedInto", "An issue cannot merge into itself");
});

issueSchema.index({ location: "2dsphere" });
issueSchema.index({ category: 1, status: 1 });
issueSchema.index({ status: 1, score: -1 });
issueSchema.index({ category: 1, municipality: 1, status: 1 });
issueSchema.index({ status: 1, priorityRank: -1, lastReportedAt: -1 });
issueSchema.index({ ward: 1, status: 1, createdAt: -1 });
issueSchema.index({ department: 1, status: 1 });
issueSchema.index({ mergedInto: 1 }, { sparse: true });
issueSchema.index({ lastReportedAt: -1 });
issueSchema.index({ status: 1, escalationLevel: 1, ward: 1 });
issueSchema.index({ status: 1, deadline: 1 });

export default mongoose.model("Issue", issueSchema);
