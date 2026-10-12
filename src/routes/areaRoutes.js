import { Router } from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import { rankAreas } from "../controllers/areaController.js";

const router = Router();

router.use(protect);
router.get("/ranking", rateLimit({ windowMs: 60_000, max: 60 }), rankAreas);

export default router;
