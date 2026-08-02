const path = require('path');
const crypto = require('crypto');
const { ImageKit, toFile } = require('@imagekit/nodejs');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const imagekit = new ImageKit({ privateKey: env.imagekit.privateKey });

function uniqueName(originalName) {
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

// Uploads a multer memory-storage file to ImageKit and returns the `image`
// subdocument a report stores.
async function saveImage(file) {
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
    url: uploaded.url,
    thumbnailUrl: uploaded.thumbnailUrl,
    filename: uploaded.name || fileName,
    fileId: uploaded.fileId,
    filePath: uploaded.filePath,
    mimeType: file.mimetype,
    size: uploaded.size ?? file.size,
  };
}

// Best-effort cleanup; a failure here must never break the request that
// triggered it (it is only ever called while unwinding another error).
async function deleteImage(image) {
  if (!image || !image.fileId) return;

  try {
    await imagekit.files.delete(image.fileId);
  } catch (err) {
    console.error('Failed to remove image from ImageKit:', err.message);
  }
}

module.exports = { saveImage, deleteImage };
