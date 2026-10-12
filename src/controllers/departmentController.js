import mongoose from "mongoose";
import Department, { ALLOWED_CATEGORIES } from "../models/Department.js";

/**
 * GET /api/departments
 * Retrieve municipal departments with filtering, search, and pagination.
 */
export const listDepartments = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    const isSuperAdmin = req.user && ["admin", "super_admin"].includes(req.user.role);
    if (!isSuperAdmin || req.query.includeInactive !== "true") {
      filter.isActive = true;
    }

    if (req.query.municipality) {
      filter.municipality = new RegExp(req.query.municipality.trim(), "i");
    }

    if (req.query.category) {
      filter.categories = req.query.category.trim().toLowerCase();
    }

    if (req.query.search) {
      const rx = new RegExp(req.query.search.trim(), "i");
      filter.$or = [{ name: rx }, { code: rx }, { description: rx }];
    }

    const [departments, total] = await Promise.all([
      Department.find(filter)
        .populate("createdBy", "fullName email")
        .populate("updatedBy", "fullName email")
        .skip(skip)
        .limit(limit)
        .sort({ name: 1 }),
      Department.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Departments retrieved successfully",
      data: {
        departments,
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
 * GET /api/departments/:id
 * Retrieve details of a specific department.
 */
export const getDepartmentById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid department ID format" });
    }

    const department = await Department.findById(req.params.id)
      .populate("createdBy", "fullName email")
      .populate("updatedBy", "fullName email");

    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    const isSuperAdmin = req.user && ["admin", "super_admin"].includes(req.user.role);
    if (!department.isActive && !isSuperAdmin) {
      return res.status(404).json({ success: false, message: "Department not found or inactive" });
    }

    return res.status(200).json({
      success: true,
      message: "Department details retrieved successfully",
      data: department,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/departments
 * Create a department (Super Admin only).
 */
export const createDepartment = async (req, res) => {
  try {
    const { name, code, description, municipality, categories } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: "Required fields: name, code",
      });
    }

    const formattedCode = code.trim().toUpperCase();

    const existingCode = await Department.findOne({ code: formattedCode });
    if (existingCode) {
      return res.status(409).json({
        success: false,
        message: `Department with code '${formattedCode}' already exists`,
      });
    }

    let parsedCategories = [];
    if (categories) {
      if (!Array.isArray(categories)) {
        return res.status(400).json({
          success: false,
          message: "categories must be an array of string values",
        });
      }
      const invalidCats = categories.filter(
        (cat) => !ALLOWED_CATEGORIES.includes(cat.toLowerCase().trim())
      );
      if (invalidCats.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid categories: ${invalidCats.join(", ")}. Allowed: ${ALLOWED_CATEGORIES.join(", ")}`,
        });
      }
      parsedCategories = categories.map((cat) => cat.toLowerCase().trim());
    }

    const department = await Department.create({
      name: name.trim(),
      code: formattedCode,
      ...(description && { description: description.trim() }),
      municipality: municipality ? municipality.trim() : "Kathmandu Metropolitan City",
      categories: parsedCategories,
      isActive: true,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Department created successfully",
      data: department,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Department code already exists",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/departments/:id
 * Update department details (Super Admin only).
 */
export const updateDepartment = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid department ID format" });
    }

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    const allowedUpdates = ["name", "code", "description", "municipality", "categories", "isActive"];
    const updates = {};

    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (updates.code) {
      updates.code = updates.code.trim().toUpperCase();
      const existingCode = await Department.findOne({
        code: updates.code,
        _id: { $ne: department._id },
      });
      if (existingCode) {
        return res.status(409).json({
          success: false,
          message: `Department code '${updates.code}' is already taken`,
        });
      }
    }

    if (updates.categories) {
      if (!Array.isArray(updates.categories)) {
        return res.status(400).json({
          success: false,
          message: "categories must be an array of string values",
        });
      }
      const invalidCats = updates.categories.filter(
        (cat) => !ALLOWED_CATEGORIES.includes(cat.toLowerCase().trim())
      );
      if (invalidCats.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid categories: ${invalidCats.join(", ")}. Allowed: ${ALLOWED_CATEGORIES.join(", ")}`,
        });
      }
      updates.categories = updates.categories.map((cat) => cat.toLowerCase().trim());
    }

    if (updates.name) updates.name = updates.name.trim();
    if (updates.description) updates.description = updates.description.trim();
    if (updates.municipality) updates.municipality = updates.municipality.trim();

    updates.updatedBy = req.user._id;

    const updatedDepartment = await Department.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    })
      .populate("createdBy", "fullName email")
      .populate("updatedBy", "fullName email");

    return res.status(200).json({
      success: true,
      message: "Department updated successfully",
      data: updatedDepartment,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate department code constraint violation",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/departments/:id
 * Safe department deactivation (Super Admin only).
 * Sets isActive to false rather than physical deletion.
 */
export const deactivateDepartment = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid department ID format" });
    }

    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    if (!department.isActive) {
      return res.status(200).json({
        success: true,
        message: "Department is already inactive",
        data: department,
      });
    }

    department.isActive = false;
    department.updatedBy = req.user._id;
    await department.save();

    return res.status(200).json({
      success: true,
      message: "Department deactivated successfully. Historical issue references preserved.",
      data: department,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
