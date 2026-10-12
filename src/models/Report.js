import mongoose from "mongoose";
import { ALLOWED_CATEGORIES } from "./Department.js";

export const REPORT_STATUSES = [
  "submitted",
  "under_review",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
  "withdrawn",
  "rejected",
];

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, match: /^https:\/\// },
    publicId: { type: String, required: true },
    format: { type: String, default: null },
    bytes: { type: Number, default: null, min: 0 },
    width: { type: Number, default: null, min: 1 },
    height: { type: Number, default: null, min: 1 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    from: { type: String, enum: REPORT_STATUSES, default: null },
    to: { type: String, enum: REPORT_STATUSES, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    actorRole: { type: String, required: true },
    reason: { type: String, trim: true, maxlength: 1000, default: "" },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 150,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 5000,
    },
    category: { type: String, enum: ALLOWED_CATEGORIES, required: true },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (coordinates) =>
            coordinates.length === 2 &&
            coordinates[0] >= -180 &&
            coordinates[0] <= 180 &&
            coordinates[1] >= -90 &&
            coordinates[1] <= 90,
          message: "Location coordinates must be [longitude, latitude] within valid ranges",
        },
      },
    },
    images: { type: [imageSchema], default: [] },
    issue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Issue",
      default: null,
    },
    // Scope captured at submission from the reporter's ward (no boundary lookup exists).
    ward: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", default: null },
    municipality: { type: String, trim: true, default: null },
    matchingDecision: {
      type: String,
      enum: ["auto_linked", "merged_geo", "merged_ai", "manually_linked", "new_issue", "pending_review", null],
      default: null,
    },
    status: { type: String, enum: REPORT_STATUSES, default: "submitted", index: true },
    statusHistory: { type: [statusHistorySchema], default: [] },
  },
  { timestamps: true }
);

reportSchema.index({ reporter: 1, createdAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ category: 1, createdAt: -1 });
reportSchema.index({ issue: 1 });
reportSchema.index({ location: "2dsphere" });

const Report = mongoose.model("Report", reportSchema);

export default Report;