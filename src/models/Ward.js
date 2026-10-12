import mongoose from "mongoose";

const wardSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Ward name is required"],
      trim: true,
      minlength: [2, "Ward name must be at least 2 characters"],
      maxlength: [100, "Ward name cannot exceed 100 characters"],
    },
    wardNumber: {
      type: Number,
      required: [true, "Ward number is required"],
      min: [1, "Ward number must be a positive integer"],
    },
    wardCode: {
      type: String,
      required: [true, "Ward code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    municipality: {
      type: String,
      required: [true, "Municipality is required"],
      trim: true,
      default: "Kathmandu Metropolitan City",
    },
    district: {
      type: String,
      trim: true,
      default: "Kathmandu",
    },
    province: {
      type: String,
      trim: true,
      default: "Bagmati",
    },
    description: {
      type: String,
      trim: true,
      default: "",
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

// Enforce unique ward number within the same municipality
wardSchema.index({ municipality: 1, wardNumber: 1 }, { unique: true });
wardSchema.index({ isActive: 1 });

const Ward = mongoose.model("Ward", wardSchema);

export default Ward;
