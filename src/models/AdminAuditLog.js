import mongoose from "mongoose";

export const AUDIT_ACTIONS = [
  "user_role_changed", "user_status_changed", "user_verification_changed", "report_accepted", "report_rejected",
];

// Append-only audit trail for administrative actions that are not Issue events
// (Issue changes are audited through IssueEvent). Same application-level immutability caveat.
const auditSchema = new mongoose.Schema(
  {
    action: { type: String, enum: AUDIT_ACTIONS, required: true, immutable: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    actorRole: { type: String, required: true, immutable: true },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
    targetReport: { type: mongoose.Schema.Types.ObjectId, ref: "Report", default: null, immutable: true },
    targetIssue: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", default: null, immutable: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    after: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
    reason: { type: String, trim: true, maxlength: 1000, default: "", immutable: true },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { timestamps: false }
);

auditSchema.index({ targetUser: 1, createdAt: -1 }, { sparse: true });
auditSchema.index({ targetReport: 1, createdAt: -1 }, { sparse: true });
auditSchema.index({ actor: 1, createdAt: -1 });

for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  auditSchema.pre(hook, () => {
    throw new Error("Audit records are immutable");
  });
}
auditSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Audit records are immutable");
});

export default mongoose.model("AdminAuditLog", auditSchema);
