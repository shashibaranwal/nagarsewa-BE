import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

// Ensure env vars are loaded regardless of import order (ES module hoisting)
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a file buffer to Cloudinary.
 *
 * @param {Buffer} buffer    - File buffer from multer memoryStorage
 * @param {string} folder    - Cloudinary folder path
 * @param {string} publicId  - Optional custom public_id (without extension)
 * @returns {Promise<{ secure_url: string, public_id: string }>}
 */
export const uploadToCloudinary = (buffer, folder, publicId) => {
  return new Promise((resolve, reject) => {
    const options = {
      folder,
      resource_type: "image",
      ...(publicId && { public_id: publicId }),
    };

    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve({ secure_url: result.secure_url, public_id: result.public_id });
    });

    stream.end(buffer);
  });
};

/**
 * Delete a file from Cloudinary by its public_id.
 *
 * @param {string} publicId
 */
export const deleteFromCloudinary = (publicId) =>
  cloudinary.uploader.destroy(publicId, { resource_type: "image" });

export default cloudinary;
