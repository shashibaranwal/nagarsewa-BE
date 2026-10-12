import Ward from "../models/Ward.js";
import Issue from "../models/Issue.js";
import Report from "../models/Report.js";

export const priorityLabel = (priority) => (priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : null);

// Sets wardName ("Ward 10") and wardNumber on plain issue objects, in one query.
export const attachWardLabels = async (issues) => {
  const ids = [...new Set(issues.map((i) => i.ward?.toString()).filter(Boolean))];
  const wards = ids.length ? await Ward.find({ _id: { $in: ids } }).select("wardNumber").lean() : [];
  const byId = new Map(wards.map((w) => [w._id.toString(), w.wardNumber]));
  for (const issue of issues) {
    const n = issue.ward ? byId.get(issue.ward.toString()) : undefined;
    issue.wardNumber = n ?? null;
    issue.wardName = n !== undefined ? `Ward ${n}` : null;
  }
  return issues;
};

// Adds issueSummary { priority, priorityLabel, reportCount, ward, wardName } to plain report objects.
export const attachIssueSummaries = async (reports) => {
  const ids = [...new Set(reports.map((r) => r.issue?.toString()).filter(Boolean))];
  const issues = ids.length ? await Issue.find({ _id: { $in: ids } }).select("priority reportCount ward").lean() : [];
  await attachWardLabels(issues);
  const byId = new Map(issues.map((i) => [i._id.toString(), i]));
  for (const report of reports) {
    const i = report.issue ? byId.get(report.issue.toString()) : null;
    report.issueSummary = i
      ? { priority: i.priority, priorityLabel: priorityLabel(i.priority), reportCount: i.reportCount, ward: i.ward, wardName: i.wardName, wardNumber: i.wardNumber }
      : null;
  }
  return reports;
};

// Sets primaryImage ({ url, width, height } | null) and imageCount from the oldest live report with images.
export const attachPrimaryImages = async (issues) => {
  const ids = issues.map((i) => i._id).filter(Boolean);
  const rows = ids.length
    ? await Report.aggregate([
        { $match: { issue: { $in: ids }, status: { $nin: ["withdrawn", "rejected"] }, "images.0": { $exists: true } } },
        { $sort: { createdAt: 1 } },
        { $group: { _id: "$issue", image: { $first: { $arrayElemAt: ["$images", 0] } }, imageCount: { $sum: { $size: "$images" } } } },
      ])
    : [];
  const byId = new Map(rows.map((r) => [r._id.toString(), r]));
  for (const issue of issues) {
    const r = byId.get(issue._id?.toString());
    issue.primaryImage = r ? { url: r.image.url, width: r.image.width ?? null, height: r.image.height ?? null } : null;
    issue.imageCount = r ? r.imageCount : 0;
  }
  return issues;
};
