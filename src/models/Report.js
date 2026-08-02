const mongoose = require('mongoose');
const { REPORT_STATUS, REPORT_STATUSES, REPORT_CATEGORIES } = require('../config/constants');

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, enum: REPORT_STATUSES, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, maxlength: 500 },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    category: { type: String, enum: REPORT_CATEGORIES, default: 'other', index: true },

    // Exactly one image per report, as per the reporting flow. Hosted on
    // ImageKit - the API stores what the upload returned, not a local path.
    image: {
      url: { type: String, required: true },
      thumbnailUrl: { type: String },
      filename: { type: String },
      // ImageKit identifiers, needed to delete or transform the asset later.
      fileId: { type: String },
      filePath: { type: String },
      mimeType: { type: String },
      size: { type: Number },
    },

    location: {
      address: { type: String, required: true, trim: true, maxlength: 300 },
      ward: { type: String, trim: true, index: true },
      city: { type: String, trim: true, index: true },
      // GeoJSON point; optional because a user may only type an address.
      coordinates: {
        type: {
          type: String,
          enum: ['Point'],
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
        },
      },
    },

    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: REPORT_STATUS.UNTOUCHED,
      index: true,
    },
    statusHistory: { type: [statusHistorySchema], default: [] },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },

    // Denormalised counters kept in sync by the vote/comment/repost services so
    // the feed can be sorted and rendered without extra aggregations.
    upvoteCount: { type: Number, default: 0, min: 0 },
    downvoteCount: { type: Number, default: 0, min: 0 },
    score: { type: Number, default: 0, index: true },
    commentCount: { type: Number, default: 0, min: 0 },
    repostCount: { type: Number, default: 0, min: 0 },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

reportSchema.index({ 'location.coordinates': '2dsphere' });
reportSchema.index({ title: 'text', description: 'text', 'location.address': 'text' });
reportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
