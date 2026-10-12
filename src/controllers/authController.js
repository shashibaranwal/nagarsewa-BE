import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { uploadToCloudinary } from "../config/cloudinary.js";
import { isSupportedImage } from "../utils/reportUpload.js";

// Cloudinary folder for KYC documents
const KYC_FOLDER = "nagarsewa/kyc-documents";

// ─── Helpers ────────────────────────────────────────────────────────────────

const signToken = (userId, role) =>
  jwt.sign({ userId, role }, process.env.JWT_TOKEN, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

const safeUser = (user) => ({
  _id: user._id,
  fullName: user.fullName,
  email: user.email,
  phone: user.phone,
  role: user.role,
  isVerified: user.isVerified,
});

// ─── Register ────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Body: multipart/form-data
 * Files:  kycFrontImage (always), kycBackImage (citizenship only)
 */
const register = async (req, res) => {
  try {
    let {
      fullName,
      email,
      phone,
      currentAddress,
      permanentAddress,
      kycType,
      citizenshipNumber,
    } = req.body;

    let password = req.body.password;
    let confirmPassword =
      req.body.confirmPassword ||
      req.body.confirm_password ||
      req.body.confirmpassword;

    if (typeof password === "string") password = password.trim();
    if (typeof confirmPassword === "string") confirmPassword = confirmPassword.trim();

    // 1. Required text field validation
    if (
      !fullName ||
      !email ||
      !phone ||
      !currentAddress ||
      !permanentAddress ||
      !password ||
      !confirmPassword ||
      !kycType
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Required fields: fullName, email, phone, currentAddress, permanentAddress, password, confirmPassword, kycType",
      });
    }

    // 2. Confirm password match
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    // 2b. Password min length check
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    // 3. Validate kycType
    if (!["citizenship", "pan"].includes(kycType)) {
      return res.status(400).json({
        success: false,
        message: "kycType must be either 'citizenship' or 'pan'",
      });
    }

    // 4. Citizenship number required when kycType is citizenship
    if (kycType === "citizenship" && !citizenshipNumber) {
      return res.status(400).json({
        success: false,
        message: "Citizenship number is required for citizenship verification",
      });
    }

    // 5. Validate uploaded file buffers (from memoryStorage)
    const frontFile = req.files?.kycFrontImage?.[0];
    const backFile = req.files?.kycBackImage?.[0];

    if (!frontFile) {
      return res.status(400).json({
        success: false,
        message: "KYC front image is required",
      });
    }

    if (kycType === "citizenship" && !backFile) {
      return res.status(400).json({
        success: false,
        message: "KYC back image is required for citizenship verification",
      });
    }

    if (![frontFile, backFile].filter(Boolean).every((f) => isSupportedImage(f.buffer))) {
      return res.status(415).json({
        success: false,
        message: "KYC image content is invalid or unsupported (use JPG, PNG or WebP)",
      });
    }

    // 6. Check for duplicate email or phone
    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { phone }],
    });
    if (existing) {
      const field =
        existing.email === email.toLowerCase().trim() ? "email" : "phone";
      return res.status(409).json({
        success: false,
        message: `A user with this ${field} already exists`,
      });
    }

    // 7. Upload KYC images to Cloudinary → nagarsewa/kyc-documents
    const frontUpload = await uploadToCloudinary(
      frontFile.buffer,
      KYC_FOLDER,
      `kyc_front_${phone}_${Date.now()}`
    );

    let backUpload = null;
    if (backFile) {
      backUpload = await uploadToCloudinary(
        backFile.buffer,
        KYC_FOLDER,
        `kyc_back_${phone}_${Date.now()}`
      );
    }

    // 8. Create user — store Cloudinary URL + public_id for each image
    const userData = {
      fullName,
      email: email.toLowerCase().trim(),
      phone,
      currentAddress,
      permanentAddress,
      password,
      kycType,
      kycFrontImage: {
        url: frontUpload.secure_url,
        publicId: frontUpload.public_id,
      },
      ...(citizenshipNumber && { citizenshipNumber }),
      ...(backUpload && {
        kycBackImage: {
          url: backUpload.secure_url,
          publicId: backUpload.public_id,
        },
      }),
    };

    const user = await User.create(userData);

    return res.status(201).json({
      success: true,
      message: "Registration successful. Your account is verified and active.",
      data: safeUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `A user with this ${field} already exists`,
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Login ───────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Body: { identifier, password }
 * identifier can be email or phone number
 */
const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "identifier (email or phone) and password are required",
      });
    }

    const isEmail = identifier.includes("@");
    const query = isEmail
      ? { email: identifier.toLowerCase().trim() }
      : { phone: identifier.trim() };

    const user = await User.findOne(query);

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const token = signToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: { token, user: safeUser(user) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Update Profile ──────────────────────────────────────────────────────────

/**
 * PUT /api/auth/update-profile
 * Protected — requires Bearer token
 * Body: { fullName?, phone?, currentAddress?, permanentAddress? }
 */
const updateProfile = async (req, res) => {
  try {
    const allowedFields = [
      "fullName",
      "phone",
      "currentAddress",
      "permanentAddress",
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: `No updatable fields provided. Allowed: ${allowedFields.join(", ")}`,
      });
    }

    if (updates.phone) {
      const existing = await User.findOne({
        phone: updates.phone,
        _id: { $ne: req.user._id },
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: "A user with this phone number already exists",
        });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { returnDocument: "after", runValidators: true }
    ).select("-password");

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export { register, login, updateProfile };
