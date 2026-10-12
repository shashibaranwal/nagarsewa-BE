import mongoose from "mongoose";

// Phase 5 vocabulary is preserved. Mapping to the Phase 6 conceptual names:
//   created -> issue_created, assigned/reassigned/department_changed -> department_assigned,
//   reopened -> issue_reopened, merged -> issue_merged. New in Phase 6: note_added,
//   resolution_submitted, system_action.
export const ISSUE_EVENT_TYPES = [
  "issue_created", "report_linked", "report_unlinked", "matching_suggested", "matching_reviewed",
  "priority_changed", "department_assigned", "deadline_updated", "status_changed", "summary_changed",
  "issue_merged", "issue_reopened", "issue_cancelled",
  "note_added", "resolution_submitted", "system_action",
  "deadline_breached", "issue_escalated",
];

export const EVENT_VISIBILITIES = ["public", "internal"];
export const ACTOR_TYPES = ["citizen", "staff", "admin", "system"];
// Only these may be created through POST /api/issues/:id/events; everything else is produced
// by trusted backend services as a side effect of the real operation.
export const MANUAL_EVENT_TYPES = ["note_added"];

const ref = (name) => ({ type: mongoose.Schema.Types.ObjectId, ref: name, default: undefined });

const detailsSchema = new mongoose.Schema(
  {
    previousStatus: String,
    newStatus: String,
    previousAssigneeId: ref("User"),
    newAssigneeId: ref("User"),
    previousDepartmentId: ref("Department"),
    newDepartmentId: ref("Department"),
    sourceIssueId: ref("Issue"),
    targetIssueId: ref("Issue"),
    relatedReportId: ref("Report"),
    reasonCode: { type: String, maxlength: 60 },
  },
  { _id: false }
);

const issueEventSchema = new mongoose.Schema(
  {
    issue: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true, immutable: true },
    eventType: { type: String, enum: ISSUE_EVENT_TYPES, required: true, immutable: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
    actorRole: { type: String, default: "system", immutable: true },
    actorType: { type: String, enum: ACTOR_TYPES, required: true, default: "system", immutable: true },
    // Defaults to internal: an event is never public unless a trusted service says so.
    visibility: { type: String, enum: EVENT_VISIBILITIES, required: true, default: "internal", immutable: true },
    // Safe, sanitized text shown to everyone allowed to see this event.
    summary: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000, immutable: true },
    // Staff-only explanation (never serialized for citizens).
    reason: { type: String, trim: true, maxlength: 1000, default: "", immutable: true },
    details: { type: detailsSchema, default: () => ({}), immutable: true },
    // Small admin-only context (never serialized for citizens or ward staff).
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      immutable: true,
      validate: {
        validator: (value) => JSON.stringify(value ?? {}).length <= 4096,
        message: "Event metadata is too large",
      },
    },
    // Always server-generated (UTC); clients can never supply it.
    timestamp: { type: Date, default: Date.now, immutable: true },
    relatedReport: { type: mongoose.Schema.Types.ObjectId, ref: "Report", default: null, immutable: true },
    relatedIssue: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", default: null, immutable: true },
    idempotencyKey: { type: String, maxlength: 100, default: undefined, immutable: true },
  },
  { timestamps: false }
);

issueEventSchema.pre("validate", function () {
  if (this.actorType === "system" && this.actor) this.invalidate("actor", "System events must not reference a user");
  if (this.actorType !== "system" && !this.actor) this.invalidate("actor", "Non-system events require an actor");
});

// Stable ordering + pagination for timelines.
issueEventSchema.index({ issue: 1, timestamp: 1, _id: 1 });
issueEventSchema.index({ issue: 1, visibility: 1, timestamp: 1, _id: 1 });
issueEventSchema.index({ issue: 1, eventType: 1, timestamp: 1 });
issueEventSchema.index({ relatedIssue: 1 }, { sparse: true });
// Retried requests carrying the same Idempotency-Key cannot create a second event.
issueEventSchema.index(
  { issue: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

// Application-level append-only protection. This does NOT protect against someone with direct
// database access (or `IssueEvent.collection.*`); it prevents the application from editing history.
const BLOCKED_QUERY_HOOKS = [
  "updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne",
  "deleteOne", "deleteMany", "findOneAndDelete",
];
for (const hook of BLOCKED_QUERY_HOOKS) {
  issueEventSchema.pre(hook, () => {
    throw new Error("Issue events are immutable");
  });
}
issueEventSchema.pre("deleteOne", { document: true, query: false }, () => {
  throw new Error("Issue events are immutable");
});
issueEventSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Issue events are immutable");
});

export default mongoose.model("IssueEvent", issueEventSchema);
