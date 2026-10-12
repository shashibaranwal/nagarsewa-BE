import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      trim: true,
    },
    currentAddress: {
      type: String,
      required: [true, "Current address is required"],
    },
    permanentAddress: {
      type: String,
      required: [true, "Permanent address is required"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
    },
    kycType: {
      type: String,
      enum: ["citizenship", "pan"],
      required: [true, "KYC type is required"],
    },
    citizenshipNumber: {
      type: String,
      trim: true,
      // Required only when kycType === 'citizenship'; enforced in controller
    },
    kycFrontImage: {
      url: { type: String, required: [true, "KYC front image is required"] },
      publicId: { type: String, required: true },
    },
    // Required only when kycType === 'citizenship'; validated in the controller
    kycBackImage: {
      url: { type: String },
      publicId: { type: String },
    },
    isVerified: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
    },
    role: {
      type: String,
      enum: ["user", "citizen", "admin", "super_admin", "ward_admin"],
      default: "user",
    },
    wardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ward",
      default: null,
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Instance method to compare passwords
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
