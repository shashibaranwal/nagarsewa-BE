const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ImageKit, toFile } = require('@imagekit/nodejs');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// Local disk stays available as a fallback so the API still runs without
// ImageKit credentials (fresh clone, offline dev, CI).
const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

const imagekit = env.imagekit.privateKey
  ? new ImageKit({ privateKey: env.imagekit.privateKey })
  : null;

const isImageKitEnabled = Boolean(imagekit);

function uniqueName(originalName) {
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

async function saveToImageKit(file) {
  const fileName = uniqueName(file.originalname);

  let uploaded;
  try {
    uploaded = await imagekit.files.upload({
      file: await toFile(file.buffer, fileName),
      fileName,
      folder: env.imagekit.folder,
      // Names are already unique; this keeps the stored path predictable.
      useUniqueFileName: false,
    });
  } catch (err) {
    console.error('ImageKit upload failed:', err);
    throw ApiError.badRequest('Could not upload the image, please try again');
  }

  return {
    provider: 'imagekit',
    url: uploaded.url,
    thumbnailUrl: uploaded.thumbnailUrl,
    filename: uploaded.name || fileName,
    fileId: uploaded.fileId,
    filePath: uploaded.filePath,
    mimeType: file.mimetype,
    size: uploaded.size ?? file.size,
  };
}

async function saveToDisk(file) {
  const filename = uniqueName(file.originalname);
  await fs.promises.writeFile(path.join(uploadRoot, filename), file.buffer);

  return {
    provider: 'local',
    url: `${env.publicBaseUrl}/${env.uploadDir}/${filename}`,
    filename,
    mimeType: file.mimetype,
    size: file.size,
  };
}

// Persists a multer memory-storage file and returns the `image` subdocument.
function saveImage(file) {
  return isImageKitEnabled ? saveToImageKit(file) : saveToDisk(file);
}

// Best-effort cleanup; a failure here must never break the request that
// triggered it (it is only ever called while unwinding another error).
async function deleteImage(image) {
  if (!image) return;

  try {
    if (image.fileId && imagekit) {
      await imagekit.files.delete(image.fileId);
    } else if (image.filename && image.provider !== 'imagekit') {
      await fs.promises.unlink(path.join(uploadRoot, image.filename));
    }
  } catch (err) {
    console.error('Failed to remove stored image:', err.message);
  }
}

module.exports = { saveImage, deleteImage, uploadRoot, isImageKitEnabled };
