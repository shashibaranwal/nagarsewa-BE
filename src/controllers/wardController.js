import mongoose from "mongoose";
import Ward from "../models/Ward.js";

/**
 * GET /api/wards
 * Retrieve a list of wards with filtering, pagination, and search.
 */
export const listWards = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    // Citizens / unauthenticated see active wards by default
    const isSuperAdmin = req.user && ["admin", "super_admin"].includes(req.user.role);
    if (!isSuperAdmin || req.query.includeInactive !== "true") {
      filter.isActive = true;
    }

    if (req.query.municipality) {
      filter.municipality = new RegExp(req.query.municipality.trim(), "i");
    }

    if (req.query.search) {
      const rx = new RegExp(req.query.search.trim(), "i");
      filter.$or = [{ name: rx }, { wardCode: rx }, { municipality: rx }];
    }

    const [wards, total] = await Promise.all([
      Ward.find(filter)
        .populate("createdBy", "fullName email")
        .populate("updatedBy", "fullName email")
        .skip(skip)
        .limit(limit)
        .sort({ wardNumber: 1 }),
      Ward.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Wards retrieved successfully",
      data: {
        wards,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/wards/:id
 * Retrieve details of a specific ward.
 */
export const getWardById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ward ID format" });
    }

    const ward = await Ward.findById(req.params.id)
      .populate("createdBy", "fullName email")
      .populate("updatedBy", "fullName email");

    if (!ward) {
      return res.status(404).json({ success: false, message: "Ward not found" });
    }

    const isSuperAdmin = req.user && ["admin", "super_admin"].includes(req.user.role);
    const isAssignedWardAdmin =
      req.user &&
      req.user.role === "ward_admin" &&
      req.user.wardId &&
      req.user.wardId.toString() === ward._id.toString();

    // If ward is inactive, only super admin or assigned ward admin can view details
    if (!ward.isActive && !isSuperAdmin && !isAssignedWardAdmin) {
      return res.status(404).json({ success: false, message: "Ward not found or inactive" });
    }

    return res.status(200).json({
      success: true,
      message: "Ward details retrieved successfully",
      data: ward,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/wards
 * Create a new municipal ward (Super Admin only).
 */
export const createWard = async (req, res) => {
  try {
    const { name, wardNumber, wardCode, municipality, district, province, description } = req.body;

    if (!name || wardNumber === undefined || !wardCode) {
      return res.status(400).json({
        success: false,
        message: "Required fields: name, wardNumber, wardCode",
      });
    }

    const num = Number(wardNumber);
    if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
      return res.status(400).json({
        success: false,
        message: "wardNumber must be a positive integer",
      });
    }

    const code = wardCode.trim().toUpperCase();

    // Check duplicate code
    const existingCode = await Ward.findOne({ wardCode: code });
    if (existingCode) {
      return res.status(409).json({
        success: false,
        message: `Ward with code '${code}' already exists`,
      });
    }

    // Check duplicate wardNumber within municipality
    const muni = municipality ? municipality.trim() : "Kathmandu Metropolitan City";
    const existingMuniNum = await Ward.findOne({ municipality: muni, wardNumber: num });
    if (existingMuniNum) {
      return res.status(409).json({
        success: false,
        message: `Ward ${num} already exists in ${muni}`,
      });
    }

    const ward = await Ward.create({
      name: name.trim(),
      wardNumber: num,
      wardCode: code,
      municipality: muni,
      ...(district && { district: district.trim() }),
      ...(province && { province: province.trim() }),
      ...(description && { description: description.trim() }),
      isActive: true,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Ward created successfully",
      data: ward,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Ward code or ward number already exists in this municipality",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/wards/:id
 * Update an existing ward (Super Admin only).
 */
export const updateWard = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ward ID format" });
    }

    const ward = await Ward.findById(req.params.id);
    if (!ward) {
      return res.status(404).json({ success: false, message: "Ward not found" });
    }

    const allowedUpdates = [
      "name",
      "wardNumber",
      "wardCode",
      "municipality",
      "district",
      "province",
      "description",
      "isActive",
    ];

    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (updates.wardCode) {
      updates.wardCode = updates.wardCode.trim().toUpperCase();
      const existingCode = await Ward.findOne({
        wardCode: updates.wardCode,
        _id: { $ne: ward._id },
      });
      if (existingCode) {
        return res.status(409).json({
          success: false,
          message: `Ward code '${updates.wardCode}' is already taken`,
        });
      }
    }

    if (updates.wardNumber !== undefined || updates.municipality !== undefined) {
      const targetMuni = updates.municipality ? updates.municipality.trim() : ward.municipality;
      const targetNum = updates.wardNumber !== undefined ? Number(updates.wardNumber) : ward.wardNumber;

      if (isNaN(targetNum) || targetNum < 1 || !Number.isInteger(targetNum)) {
        return res.status(400).json({
          success: false,
          message: "wardNumber must be a positive integer",
        });
      }

      const existingDuplicate = await Ward.findOne({
        municipality: targetMuni,
        wardNumber: targetNum,
        _id: { $ne: ward._id },
      });
      if (existingDuplicate) {
        return res.status(409).json({
          success: false,
          message: `Ward ${targetNum} already exists in ${targetMuni}`,
        });
      }
      updates.wardNumber = targetNum;
      updates.municipality = targetMuni;
    }

    if (updates.name) updates.name = updates.name.trim();
    if (updates.district) updates.district = updates.district.trim();
    if (updates.province) updates.province = updates.province.trim();
    if (updates.description) updates.description = updates.description.trim();

    updates.updatedBy = req.user._id;

    const updatedWard = await Ward.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    })
      .populate("createdBy", "fullName email")
      .populate("updatedBy", "fullName email");

    return res.status(200).json({
      success: true,
      message: "Ward updated successfully",
      data: updatedWard,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate ward code or number constraint violation",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/wards/:id/issues
 * Retrieve issues associated with a specific ward (Ward Admin scoped to assigned ward; Super Admin all).
 */
export const getWardIssues = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ward ID format" });
    }

    const ward = await Ward.findById(req.params.id);
    if (!ward) {
      return res.status(404).json({ success: false, message: "Ward not found" });
    }

    const isSuperAdmin = ["admin", "super_admin"].includes(req.user.role);
    const isAssignedWardAdmin =
      req.user.role === "ward_admin" &&
      req.user.wardId &&
      req.user.wardId.toString() === ward._id.toString();

    if (!isSuperAdmin && !isAssignedWardAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Ward administrators can only view issues for their assigned ward.",
      });
    }

    // Contract ready for Phase 5 Issue model integration
    return res.status(200).json({
      success: true,
      message: "Ward issues retrieved successfully",
      data: {
        issues: [],
        pagination: {
          total: 0,
          page: Math.max(1, parseInt(req.query.page) || 1),
          limit: Math.min(100, Math.max(1, parseInt(req.query.limit) || 20)),
          pages: 0,
        },
        phaseStatus: "Deferred to Phase 5 (Issue Management)",
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/wards/:id/dashboard
 * Retrieve ward operational summary dashboard (Ward Admin scoped to assigned ward; Super Admin all).
 */
export const getWardDashboard = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ward ID format" });
    }

    const ward = await Ward.findById(req.params.id);
    if (!ward) {
      return res.status(404).json({ success: false, message: "Ward not found" });
    }

    const isSuperAdmin = ["admin", "super_admin"].includes(req.user.role);
    const isAssignedWardAdmin =
      req.user.role === "ward_admin" &&
      req.user.wardId &&
      req.user.wardId.toString() === ward._id.toString();

    if (!isSuperAdmin && !isAssignedWardAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Ward administrators can only view the dashboard for their assigned ward.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ward dashboard retrieved successfully",
      data: {
        ward: {
          id: ward._id,
          name: ward.name,
          wardNumber: ward.wardNumber,
          wardCode: ward.wardCode,
          municipality: ward.municipality,
          isActive: ward.isActive,
        },
        summary: {
          totalIssues: 0,
          openIssues: 0,
          underReview: 0,
          inProgress: 0,
          resolved: 0,
          overdue: 0,
        },
        byCategory: [],
        byPriority: [],
        byDepartment: [],
        recentIssues: [],
        phaseStatus: "Summary contract ready; issue metrics will populate upon Phase 5 Issue integration.",
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
