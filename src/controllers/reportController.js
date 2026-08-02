const Report = require('../models/Report');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/response');
const { saveImage, deleteImage } = require('../services/storageService');
const { ROLES, REPORT_STATUS, NOTIFICATION_TYPES } = require('../config/constants');
const reportService = require('../services/reportService');
const { notify, notifyOfficialsOfNewReport } = require('../services/notificationService');
const { emitToOfficials } = require('../realtime/io');

function canModerate(user) {
  return user.role === ROLES.OFFICIAL || user.role === ROLES.ADMIN;
}

// POST /api/reports - multipart/form-data with a single `image` field.
const createReport = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('An image of the problem is required');

  const { title, description, category, address, ward, city, latitude, longitude } = req.body;

  const location = { address, ward, city };
  if (latitude !== undefined && longitude !== undefined) {
    location.coordinates = { type: 'Point', coordinates: [longitude, latitude] };
  }

  const image = await saveImage(req.file);

  let report;
  try {
    report = await Report.create({
      title,
      description,
      category,
      image,
      location,
      reportedBy: req.user._id,
      status: REPORT_STATUS.UNTOUCHED,
      statusHistory: [{ status: REPORT_STATUS.UNTOUCHED, changedBy: req.user._id }],
    });
  } catch (err) {
    // Don't leave an orphaned upload behind if the document fails validation.
    await deleteImage(image);
    throw err;
  }

  await notifyOfficialsOfNewReport(report, req.user._id);
  emitToOfficials('report:new', { reportId: report._id, title: report.title });

  const populated = await reportService.getReportById(report._id, req.user._id);
  return created(res, populated, 'Report submitted successfully');
});

// GET /api/reports - the public feed.
const listReports = asyncHandler(async (req, res) => {
  const query = req.validatedQuery;
  const { items, total } = await reportService.listReports(query, req.user?._id);
  return paginated(res, items, { page: query.page, limit: query.limit, total });
});

const getReport = asyncHandler(async (req, res) => {
  const report = await reportService.getReportById(req.params.id, req.user?._id);
  if (!report) throw ApiError.notFound('Report not found');
  return ok(res, report);
});

// Reporters can edit their own text; officials/admins can edit any report.
const updateReport = asyncHandler(async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, isDeleted: false });
  if (!report) throw ApiError.notFound('Report not found');

  const isOwner = String(report.reportedBy) === String(req.user._id);
  if (!isOwner && !canModerate(req.user)) {
    throw ApiError.forbidden('You can only edit your own reports');
  }
  if (isOwner && !canModerate(req.user) && report.status !== REPORT_STATUS.UNTOUCHED) {
    throw ApiError.forbidden('The report can no longer be edited once officials have opened it');
  }

  const { address, ward, city, ...rest } = req.body;
  Object.assign(report, rest);
  if (address !== undefined) report.location.address = address;
  if (ward !== undefined) report.location.ward = ward;
  if (city !== undefined) report.location.city = city;
  await report.save();

  return ok(res, await reportService.getReportById(report._id, req.user._id), 'Report updated');
});

// PATCH /api/reports/:id/status - officials and admins only.
const updateStatus = asyncHandler(async (req, res) => {
  const { status, note, assignedTo } = req.body;
  const report = await Report.findOne({ _id: req.params.id, isDeleted: false });
  if (!report) throw ApiError.notFound('Report not found');

  if (report.status === status && !assignedTo) {
    throw ApiError.badRequest(`Report is already marked as "${status}"`);
  }

  const previousStatus = report.status;
  report.status = status;
  report.statusHistory.push({ status, changedBy: req.user._id, note });
  if (assignedTo) report.assignedTo = assignedTo;
  report.resolvedAt = status === REPORT_STATUS.COMPLETED ? new Date() : undefined;
  await report.save();

  const recipients = [report.reportedBy];
  if (assignedTo) recipients.push(assignedTo);

  await notify({
    recipients,
    actor: req.user._id,
    type: NOTIFICATION_TYPES.STATUS_CHANGED,
    report: report._id,
    message: `"${report.title}" moved from ${previousStatus} to ${status}`,
  });

  return ok(
    res,
    await reportService.getReportById(report._id, req.user._id),
    `Status updated to ${status}`
  );
});

// Soft delete so the feed keeps its comment/vote history intact.
const deleteReport = asyncHandler(async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, isDeleted: false });
  if (!report) throw ApiError.notFound('Report not found');

  const isOwner = String(report.reportedBy) === String(req.user._id);
  if (!isOwner && req.user.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('You can only delete your own reports');
  }

  report.isDeleted = true;
  await report.save();
  return ok(res, null, 'Report deleted');
});

const getMyReports = asyncHandler(async (req, res) => {
  const { page, limit } = req.validatedQuery;
  const { items, total } = await reportService.listReports(
    { page, limit, sort: 'recent', reportedBy: String(req.user._id), radius: 2000 },
    req.user._id
  );
  return paginated(res, items, { page, limit, total });
});

const getStats = asyncHandler(async (req, res) => {
  const stats = await reportService.getStats({ ward: req.query.ward, city: req.query.city });
  return ok(res, stats);
});

module.exports = {
  createReport,
  listReports,
  getReport,
  updateReport,
  updateStatus,
  deleteReport,
  getMyReports,
  getStats,
};
