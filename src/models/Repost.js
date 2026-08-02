const mongoose = require('mongoose');

const repostSchema = new mongoose.Schema(
  {
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    caption: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

// A user can only repost a given report once.
repostSchema.index({ user: 1, report: 1 }, { unique: true });
repostSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Repost', repostSchema);
