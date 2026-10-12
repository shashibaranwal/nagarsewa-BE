import Issue, { ELIGIBLE_ISSUE_STATUSES } from "../models/Issue.js";
import Ward from "../models/Ward.js";

// ~500 m cells: 0.0045 deg of latitude ~ 500 m; longitude uses a fixed 0.005 deg step (~490 m near Kathmandu).
const LAT_STEP = 0.0045;
const LNG_STEP = 0.005;

const round = (value, places = 2) => Number(value.toFixed(places));

// ── GET /api/areas/ranking ───────────────────────────────────────────────────
// Open issues grouped by ward when known, otherwise by ~500 m grid cell. Most urgent area first.
export const rankAreas = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const match = { status: { $in: ELIGIBLE_ISSUE_STATUSES } };
    if (req.user.role === "ward_admin") {
      if (!req.user.wardId) return res.status(403).json({ success: false, message: "Ward scope is not configured" });
      match.ward = req.user.wardId;
    }
    const rows = await Issue.aggregate([
      { $match: match },
      { $addFields: { lat: { $arrayElemAt: ["$location.coordinates", 1] }, lng: { $arrayElemAt: ["$location.coordinates", 0] } } },
      {
        $addFields: {
          areaKey: {
            $cond: [
              { $ne: [{ $ifNull: ["$ward", null] }, null] },
              { $concat: ["ward:", { $toString: "$ward" }] },
              { $concat: ["cell:", { $toString: { $floor: { $divide: ["$lat", LAT_STEP] } } }, ":", { $toString: { $floor: { $divide: ["$lng", LNG_STEP] } } }] },
            ],
          },
        },
      },
      {
        $group: {
          _id: { key: "$areaKey", category: "$category" },
          issues: { $sum: 1 },
          reports: { $sum: "$reportCount" },
          score: { $sum: "$score" },
          lat: { $sum: "$lat" },
          lng: { $sum: "$lng" },
          ward: { $first: "$ward" },
          municipality: { $first: "$municipality" },
        },
      },
      {
        $group: {
          _id: "$_id.key",
          totalIssues: { $sum: "$issues" },
          totalReports: { $sum: "$reports" },
          totalScore: { $sum: "$score" },
          latSum: { $sum: "$lat" },
          lngSum: { $sum: "$lng" },
          ward: { $first: "$ward" },
          municipality: { $first: "$municipality" },
          breakdown: { $push: { k: "$_id.category", v: "$issues" } },
        },
      },
      { $sort: { totalScore: -1, _id: 1 } },
      { $limit: limit },
    ]);

    const wardIds = rows.map((r) => r.ward).filter(Boolean);
    const wards = wardIds.length ? await Ward.find({ _id: { $in: wardIds } }).select("wardNumber name municipality").lean() : [];
    const wardById = new Map(wards.map((w) => [w._id.toString(), w]));

    const areas = rows.map((row, index) => {
      const lat = row.latSum / row.totalIssues;
      const lng = row.lngSum / row.totalIssues;
      const ward = row.ward ? wardById.get(row.ward.toString()) : null;
      const place = ward?.municipality || row.municipality;
      const label = ward
        ? `Ward ${ward.wardNumber}${place ? `, ${place}` : ""}`
        : `${place ? `${place} - ` : ""}Area near ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      return {
        rank: index + 1,
        areaId: row._id,
        type: ward ? "ward" : "grid",
        label,
        wardName: ward ? `Ward ${ward.wardNumber}` : null,
        center: { type: "Point", coordinates: [round(lng, 6), round(lat, 6)] },
        totalIssues: row.totalIssues,
        totalReports: row.totalReports,
        totalScore: round(row.totalScore),
        categoryBreakdown: Object.fromEntries(row.breakdown.sort((a, b) => b.v - a.v || a.k.localeCompare(b.k)).map(({ k, v }) => [k, v])),
      };
    });
    return res.json({ success: true, message: "Area ranking retrieved successfully", data: { areas, limit } });
  } catch (error) {
    console.error(`[AREA_RANKING_ERROR] ${error.stack || error.message}`);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
