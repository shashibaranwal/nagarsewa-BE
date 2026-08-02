const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    // One level of threading is enough for a Facebook-style comment section.
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },
    replyCount: { type: Number, default: 0, min: 0 },
    upvoteCount: { type: Number, default: 0, min: 0 },
    downvoteCount: { type: Number, default: 0, min: 0 },
    score: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

commentSchema.index({ report: 1, parent: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', commentSchema);
