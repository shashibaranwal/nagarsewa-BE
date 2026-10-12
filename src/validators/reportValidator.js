import mongoose from "mongoose";
import { ALLOWED_CATEGORIES } from "../models/Department.js";

const editableFields = ["title", "description", "category", "location"];
const rejectedClientFields = [
  "reporter",
  "reporterId",
  "userId",
  "status",
  "issue",
  "createdAt",
  "updatedAt",
  "statusHistory",
];

const parseLocation = (value) => {
  let location = value;
  if (typeof location === "string") {
    try {
      location = JSON.parse(location);
    } catch {
      throw new Error("location must be valid JSON");
    }
  }

  if (
    !location ||
    location.type !== "Point" ||
    !Array.isArray(location.coordinates) ||
    location.coordinates.length !== 2
  ) {
    throw new Error("location must be a GeoJSON Point with [longitude, latitude] coordinates");
  }

  const coordinates = location.coordinates.map(Number);
  if (
    coordinates.some((coordinate) => !Number.isFinite(coordinate)) ||
    coordinates[0] < -180 ||
    coordinates[0] > 180 ||
    coordinates[1] < -90 ||
    coordinates[1] > 90
  ) {
    throw new Error("longitude must be between -180 and 180 and latitude between -90 and 90");
  }
  return { type: "Point", coordinates };
};

const validateReportInput = (body, { partial = false } = {}) => {
  const errors = [];
  for (const field of rejectedClientFields) {
    if (body[field] !== undefined) errors.push({ field, message: `${field} is not allowed` });
  }

  const fields = partial ? editableFields.filter((field) => body[field] !== undefined) : editableFields;
  if (partial && fields.length === 0) errors.push({ field: "body", message: "At least one editable field is required" });

  for (const field of fields) {
    const value = body[field];
    if (field === "title" || field === "description") {
      if (typeof value !== "string") errors.push({ field, message: `${field} must be a string` });
      else {
        const trimmed = value.trim();
        const min = field === "title" ? 5 : 10;
        const max = field === "title" ? 150 : 5000;
        if (trimmed.length < min || trimmed.length > max) errors.push({ field, message: `${field} must be between ${min} and ${max} characters` });
      }
    }
    if (field === "category" && !ALLOWED_CATEGORIES.includes(value)) {
      errors.push({ field, message: `category must be one of: ${ALLOWED_CATEGORIES.join(", ")}` });
    }
    if (field === "location") {
      try {
        parseLocation(value);
      } catch (error) {
        errors.push({ field, message: error.message });
      }
    }
  }

  if (errors.length) {
    const error = new Error("Validation failed");
    error.status = 400;
    error.code = "VALIDATION_ERROR";
    error.details = errors;
    throw error;
  }

  const clean = {};
  for (const field of fields) {
    clean[field] = field === "location" ? parseLocation(body[field]) : typeof body[field] === "string" ? body[field].trim() : body[field];
  }
  return clean;
};

const validateQuery = (query) => {
  const page = Number.parseInt(query.page, 10) || 1;
  const limit = Number.parseInt(query.limit, 10) || Number(process.env.REPORT_DEFAULT_PAGE_SIZE) || 10;
  if (page < 1 || limit < 1 || limit > (Number(process.env.REPORT_MAX_PAGE_SIZE) || 50)) {
    const error = new Error("page must be at least 1 and limit must be within the configured maximum");
    error.status = 400;
    error.code = "INVALID_PAGINATION";
    throw error;
  }
  if (query.status && !["submitted", "under_review", "assigned", "in_progress", "resolved", "closed", "withdrawn", "rejected"].includes(query.status)) {
    const error = new Error("Invalid report status filter");
    error.status = 400;
    throw error;
  }
  if (query.category && !ALLOWED_CATEGORIES.includes(query.category)) {
    const error = new Error("Invalid report category filter");
    error.status = 400;
    throw error;
  }
  const sort = { newest: { createdAt: -1 }, oldest: { createdAt: 1 } }[query.sort || "newest"];
  if (!sort) {
    const error = new Error("sort must be newest or oldest");
    error.status = 400;
    throw error;
  }
  return { page, limit, sort };
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

export { editableFields, isValidId, parseLocation, validateQuery, validateReportInput };