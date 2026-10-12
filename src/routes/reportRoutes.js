import { Router } from "express";
import multer from "multer";
import { protect, requireVerified } from "../middlewares/authMiddleware.js";
import {
  createReport,
  getReport,
  listMyReports,
  listReports,
  updateReport,
  withdrawReport,
} from "../controllers/reportController.js";
import { reportUpload } from "../utils/uploadConfig.js";

const router = Router();

const handleReportUpload = (req, res, next) => {
  reportUpload.array("images", Number(process.env.REPORT_MAX_IMAGES) || 5)(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ success: false, message: "Each report image must be within the configured size limit" });
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") {
      return res.status(413).json({ success: false, message: "Too many report images" });
    }
    return res.status(415).json({ success: false, message: error.message || "Invalid image upload" });
  });
};

router.use(protect);
router.post("/", requireVerified, handleReportUpload, createReport);
router.get("/my", listMyReports);
router.get("/", listReports);
router.get("/:id", getReport);
router.patch("/:id", handleReportUpload, updateReport);
router.delete("/:id", withdrawReport);

export default router;