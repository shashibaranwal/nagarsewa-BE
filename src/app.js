import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import wardRoutes from "./routes/wardRoutes.js";
import departmentRoutes from "./routes/departmentRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import issueRoutes from "./routes/issueRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import areaRoutes from "./routes/areaRoutes.js";
import swaggerSpec from "./config/swagger.js";

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/wards", wardRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/issues", issueRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/areas", areaRoutes);

// ─── Swagger UI ───────────────────────────────────────────────────────────────
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "Nagarsewa API Docs",
    customCss: ".swagger-ui .topbar { background-color: #c0392b; }",
    swaggerOptions: { persistAuthorization: true },
  })
);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ success: true, message: "Welcome to Nagarsewa Backend" });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    ...(err.code && { error: { code: err.code, details: err.details || [] } }),
  });
});

export default app;
