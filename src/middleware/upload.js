const multer = require('multer');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

// Files are buffered in memory and then handed to the storage service, which
// forwards them to ImageKit (or writes them to disk when it is not configured).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(ApiError.badRequest('Only JPEG, PNG, WEBP or HEIC images are allowed'));
    }
    cb(null, true);
  },
});

// A report carries exactly one image, under the `image` form field.
const uploadReportImage = upload.single('image');

module.exports = { uploadReportImage };
