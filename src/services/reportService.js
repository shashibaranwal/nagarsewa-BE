const Report = require('../models/Report');
const Repost = require('../models/Repost');
const { getUserVoteMap } = require('./voteService');
const { REPORT_STATUS } = require('../config/constants');

const AUTHOR_FIELDS = 'name avatarUrl role ward city';

const EARTH_RADIUS_METRES = 6378100;

const SORTS = {
  recent: { createdAt: -1 },
  oldest: { createdAt: 1 },
  top: { score: -1, createdAt: -1 },
  discussed: { commentCount: -1, createdAt: -1 },
};

function buildFilter(query) {
  const filter = { isDeleted: false };
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  if (query.ward) filter['location.ward'] = new RegExp(`^${escapeRegex(query.ward)}$`, 'i');
  if (query.city) filter['location.city'] = new RegExp(`^${escapeRegex(query.city)}$`, 'i');
  if (query.reportedBy) filter.reportedBy = query.reportedBy;
  if (query.search) filter.$text = { $search: query.search };
  if (query.lat !== undefined && query.lng !== undefined) {
    // $geoWithin rather than $nearSphere: $near is rejected inside the
    // aggregation that countDocuments runs, and it would also override the
    // caller's sort. $centerSphere takes its radius in radians.
    filter['location.coordinates'] = {
      $geoWithin: {
        $centerSphere: [[query.lng, query.lat], query.radius / EARTH_RADIUS_METRES],
      },
    };
  }
  return filter;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Attaches the viewer's own vote and repost state so the client can render the
// post's action bar without a second round trip.
async function decorateForViewer(reports, viewerId) {
  if (reports.length === 0) return [];
  const ids = reports.map((r) => r._id);
  const [voteMap, reposts] = await Promise.all([
    getUserVoteMap(viewerId, 'Report', ids),
    viewerId
      ? Repost.find({ user: viewerId, report: { $in: ids } }).select('report').lean()
      : Promise.resolve([]),
  ]);
  const repostedSet = new Set(reposts.map((r) => String(r.report)));

  return reports.map((report) => ({
    ...report,
    myVote: voteMap[String(report._id)] || 0,
    hasReposted: repostedSet.has(String(report._id)),
  }));
}

async function listReports(query, viewerId) {
  const { page, limit, sort } = query;
  const filter = buildFilter(query);

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .populate('reportedBy', AUTHOR_FIELDS)
      .populate('assignedTo', AUTHOR_FIELDS)
      .sort(SORTS[sort] || SORTS.recent)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Report.countDocuments(filter),
  ]);

  return { items: await decorateForViewer(reports, viewerId), total };
}

async function getReportById(id, viewerId) {
  const report = await Report.findOne({ _id: id, isDeleted: false })
    .populate('reportedBy', AUTHOR_FIELDS)
    .populate('assignedTo', AUTHOR_FIELDS)
    .populate('statusHistory.changedBy', AUTHOR_FIELDS)
    .lean();
  if (!report) return null;
  const [decorated] = await decorateForViewer([report], viewerId);
  return decorated;
}

async function getStats(scope = {}) {
  const match = { isDeleted: false };
  if (scope.ward) match['location.ward'] = scope.ward;
  if (scope.city) match['location.city'] = scope.city;

  const [byStatus, byCategory, total] = await Promise.all([
    Report.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Report.aggregate([{ $match: match }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
    Report.countDocuments(match),
  ]);

  const statusCounts = Object.values(REPORT_STATUS).reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  byStatus.forEach((row) => {
    statusCounts[row._id] = row.count;
  });

  return {
    total,
    byStatus: statusCounts,
    byCategory: byCategory.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {}),
    resolutionRate: total ? Number((statusCounts.completed / total).toFixed(3)) : 0,
  };
}

module.exports = { listReports, getReportById, getStats, decorateForViewer, AUTHOR_FIELDS };
