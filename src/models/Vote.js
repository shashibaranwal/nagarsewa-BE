const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, enum: ['Report', 'Comment'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    value: { type: Number, enum: [1, -1], required: true },
  },
  { timestamps: true }
);

// A user gets exactly one vote per target.
voteSchema.index({ user: 1, targetType: 1, targetId: 1 }, { unique: true });
voteSchema.index({ targetType: 1, targetId: 1 });

module.exports = mongoose.model('Vote', voteSchema);
