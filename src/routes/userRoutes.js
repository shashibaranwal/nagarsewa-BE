import { Router } from "express";
import { getMe, changePassword, deactivateMe } from "../controllers/userController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = Router();

// All user routes require authentication
router.use(protect);

// GET  /api/users/me           — view own full profile
router.get("/me", getMe);

// PATCH /api/users/me/password — change own password
router.patch("/me/password", changePassword);

// DELETE /api/users/me         — self-deactivate (soft delete)
router.delete("/me", deactivateMe);

export default router;
