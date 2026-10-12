import mongoose from "mongoose";

// Controlled set of standard municipal civic categories
export const ALLOWED_CATEGORIES = [
  "road",
  "pothole",
  "sanitation",
  "waste_management",
  "water_supply",
  "drainage",
  "sewerage",
  "street_lighting",
  "public_infrastructure",
  "electricity",
  "environment",
  "traffic",
  "other",
];

const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Department name is required"],
      trim: true,
      minlength: [2, "Department name must be at least 2 characters"],
      maxlength: [100, "Department name cannot exceed 100 characters"],
    },
    code: {
      type: String,
      required: [true, "Department code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    municipality: {
      type: String,
      required: [true, "Municipality is required"],
      trim: true,
      default: "Kathmandu Metropolitan City",
    },
    categories: {
      type: [String],
      default: [],
      validate: {
        validator: function (categories) {
          if (!Array.isArray(categories)) return false;
          return categories.every((cat) => ALLOWED_CATEGORIES.includes(cat.toLowerCase().trim()));
        },
        message: (props) => `One or more categories are invalid. Allowed categories: ${ALLOWED_CATEGORIES.join(", ")}`,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

departmentSchema.index({ municipality: 1, code: 1 }, { unique: true });
departmentSchema.index({ isActive: 1 });
departmentSchema.index({ categories: 1 });

const Department = mongoose.model("Department", departmentSchema);

export default Department;
