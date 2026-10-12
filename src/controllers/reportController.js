import mongoose from "mongoose";
import Report from "../models/Report.js";
import User from "../models/User.js";
import { cleanupUploads, uploadReportImages } from "../utils/reportUpload.js";
import { submitReportWithMatching } from "../services/reportSubmissionService.js";
import { actorOf, handleReportWithdrawn } from "../services/issueService.js";
import { attachIssueSummaries } from "../services/wardLabelService.js";
import { runInTransaction } from "../services/transaction.js";
import MatchReview from "../models/MatchReview.js";
import { isValidId, validateQuery, validateReportInput } from "../validators/reportValidator.js";

const STAFF_ROLES = ["admin", "super_admin", "ward_admin"];
const isSuperAdmin = (user) => ["admin", "super_admin"].includes(user.role);
const isStaff = (user) => STAFF_ROLES.includes(user.role);

const canStaffAccess = async (user, report) => {
  if (isSuperAdmin(user)) return true;
  if (user.role !== "ward_admin" || !user.wardId) return false;
  const reporter = await User.findById(report.reporter).select("wardId").lean();
  return reporter?.wardId?.toString() === user.wardId.toString();
};

const reportResponse = (report) => ({
  _id: report._id,
  reporter: report.reporter,
  title: report.title,
  description: report.description,
  category: report.category,
  location: report.location,
  images: report.images,
  issue: report.issue,
  matchingDecision: report.matchingDecision,
  status: report.status,
  statusHistory: report.statusHistory,
  createdAt: report.createdAt,
  updatedAt: report.updatedAt,
});

const handleError = (res, error) => {
  if (!error.status) console.error(`[REPORT_ERROR] ${error.stack || error.message}`);
  return res.status(error.status || 500).json({
    success: false,
    message: error.message || "Server error",
    ...(error.code && { error: { code: error.code, details: error.details || [] } }),
  });
};

const parseListFilter = (query) => {
  const { page, limit, sort } = validateQuery(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  return { page, limit, sort, filter };
};

export const createReport = async (req, res) => {
  let uploads = [];
  try {
    const data = validateReportInput(req.body);
    uploads = await uploadReportImages(req.files || []);
    const outcome = await submitReportWithMatching({ data, user: req.user, images: uploads });
    const { report, issue, decision, matchingDecision, reviewRequired } = outcome;
    const messages = {
      auto_linked: "Report submitted and linked to an existing issue",
      new_issue: "Report submitted and a new issue has been created",
      pending_review: "Report submitted and awaiting issue review",
    };
    return res.status(201).json({
      success: true,
      message: messages[decision],
      data: {
        report: reportResponse(report),
        issue: issue ? { id: issue._id, status: issue.status, reportCount: issue.reportCount, uniqueReporters: issue.uniqueReporters, score: issue.score } : null,
        matching: { decision, reviewRequired, matchingDecision: matchingDecision ?? decision },
      },
    });
  } catch (error) {
    if (uploads.length) await cleanupUploads(uploads);
    return handleError(res, error);
  }
};

export const listMyReports = async (req, res) => {
  try {
    const { page, limit, sort, filter } = parseListFilter(req.query);
    filter.reporter = req.user._id;
    const [reports, total] = await Promise.all([
      Report.find(filter).select("title category location images issue status createdAt updatedAt").sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      Report.countDocuments(filter),
    ]);
    return res.json({ success: true, message: "Reports retrieved successfully", data: { reports: await attachIssueSummaries(reports), pagination: { total, page, limit, pages: Math.ceil(total / limit) } } });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getReport = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid report ID format" });
    const report = await Report.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    const owner = report.reporter.toString() === req.user._id.toString();
    if (!owner && !(isStaff(req.user) && await canStaffAccess(req.user, report))) return res.status(404).json({ success: false, message: "Report not found" });
    return res.json({ success: true, message: "Report retrieved successfully", data: { report: reportResponse(report) } });
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateReport = async (req, res) => {
  let uploads = [];
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid report ID format" });
    const updates = validateReportInput(req.body, { partial: true });
    uploads = await uploadReportImages(req.files || []);
    const updateOperation = { $set: updates };
    if (uploads.length) updateOperation.$push = { images: { $each: uploads } };
    const report = await Report.findOneAndUpdate(
      { _id: req.params.id, reporter: req.user._id, status: "submitted" },
      updateOperation,
      { new: true, runValidators: true }
    );
    if (!report) {
      if (uploads.length) await cleanupUploads(uploads);
      const exists = await Report.exists({ _id: req.params.id, reporter: req.user._id });
      return res.status(exists ? 409 : 404).json({ success: false, message: exists ? "Only submitted reports can be edited" : "Report not found" });
    }
    return res.json({ success: true, message: "Report updated successfully", data: { report: reportResponse(report) } });
  } catch (error) {
    if (uploads.length) await cleanupUploads(uploads);
    return handleError(res, error);
  }
};

export const withdrawReport = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid report ID format" });
    const report = await runInTransaction(async (session) => {
      const withdrawn = await Report.findOneAndUpdate(
        { _id: req.params.id, reporter: req.user._id, status: "submitted" },
        { $set: { status: "withdrawn" }, $push: { statusHistory: { from: "submitted", to: "withdrawn", actor: req.user._id, actorRole: req.user.role, reason: "Withdrawn by citizen" } } },
        { new: true, runValidators: true, session }
      );
      if (withdrawn) {
        await handleReportWithdrawn(withdrawn, actorOf(req.user), session);
        await MatchReview.updateOne(
          { report: withdrawn._id, status: { $in: ["pending", "in_review", "deferred"] } },
          { $set: { status: "rejected", decision: "withdrawn", decisionReason: "Report withdrawn by citizen", reviewedAt: new Date() } },
          { session }
        );
      }
      return withdrawn;
    });
    if (!report) {
      const exists = await Report.exists({ _id: req.params.id, reporter: req.user._id });
      return res.status(exists ? 409 : 404).json({ success: false, message: exists ? "Only submitted reports can be withdrawn" : "Report not found" });
    }
    return res.json({ success: true, message: "Report withdrawn successfully", data: { report: reportResponse(report) } });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listReports = async (req, res) => {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ success: false, message: "Staff access required" });
    const { page, limit, sort, filter } = parseListFilter(req.query);
    if (req.user.role === "ward_admin") {
      if (!req.user.wardId) return res.status(403).json({ success: false, message: "Ward scope is not configured" });
      const wardUsers = await User.find({ wardId: req.user.wardId }).select("_id").lean();
      filter.reporter = { $in: wardUsers.map(({ _id }) => _id) };
    }
    if (req.query.search) {
      const search = req.query.search.trim();
      if (isValidId(search)) filter._id = search;
      else filter.title = { $regex: search.slice(0, 100), $options: "i" };
    }
    const [reports, total] = await Promise.all([
      Report.find(filter).select("reporter title category location images issue status createdAt updatedAt").sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      Report.countDocuments(filter),
    ]);
    return res.json({ success: true, message: "Report queue retrieved successfully", data: { reports: await attachIssueSummaries(reports), pagination: { total, page, limit, pages: Math.ceil(total / limit) } } });
  } catch (error) {
    return handleError(res, error);
  }
};
