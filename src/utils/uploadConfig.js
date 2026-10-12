import multer from "multer";

// Use memory storage — buffers are streamed to Cloudinary, nothing hits disk
const memoryStorage = multer.memoryStorage();

const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp"];
const ALLOWED_EXT = /\.(jpe?g|jfif|png|webp)$/i;
// Some clients (mobile, Postman) send JPGs with a generic or missing mimetype
const GENERIC_MIME = ["application/octet-stream", "binary/octet-stream", ""];

const imageFileFilter = (_req, file, cb) => {
  const mime = (file.mimetype || "").toLowerCase();
  const ok =
    ALLOWED_MIME.includes(mime) ||
    (GENERIC_MIME.includes(mime) && ALLOWED_EXT.test(file.originalname || ""));
  if (ok) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG/JPEG, PNG and WebP images are allowed"), false);
  }
};

// ── KYC / user documents upload ───────────────────────────────────────────────
// Cloudinary folder: nagarsewa/kyc-documents
export const kycUpload = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── Report images upload ──────────────────────────────────────────────────────
// Cloudinary folder: nagarsewa/report-images
export const reportUpload = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: (Number(process.env.REPORT_MAX_IMAGE_SIZE_MB) || 5) * 1024 * 1024,
    files: Number(process.env.REPORT_MAX_IMAGES) || 5,
  },
});
