import { Router } from "express";
import multer from "multer";
import { register, login, updateProfile } from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { kycUpload } from "../utils/uploadConfig.js";

const router = Router();

// KYC upload fields: front always required, back required for citizenship
const kycFields = kycUpload.fields([
  { name: "kycFrontImage", maxCount: 1 },
  { name: "kycBackImage", maxCount: 1 },
]);

/**
 * Wraps multer middleware so file-upload errors (wrong type, size exceeded)
 * are caught and returned as clean JSON 400 responses instead of crashing.
 */
const handleKycUpload = (req, res, next) => {
  kycFields(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(400).json({
      success: false,
      message: err.message || "File upload error",
    });
  });
};

// POST /api/auth/register
router.post("/register", handleKycUpload, register);

// POST /api/auth/login
router.post("/login", login);

// PUT /api/auth/update-profile  (protected)
router.put("/update-profile", protect, updateProfile);

export default router;
