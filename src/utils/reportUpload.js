import { deleteFromCloudinary, uploadToCloudinary } from "../config/cloudinary.js";

const REPORT_FOLDER = "nagarsewa/reports";

const isSupportedImage = (buffer) => {
  if (!buffer || buffer.length < 12) return false;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const webp = buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  return png || jpeg || webp;
};

const cleanupUploads = async (uploads) => {
  await Promise.all(
    uploads.map(async ({ publicId }) => {
      try {
        await deleteFromCloudinary(publicId);
      } catch (error) {
        console.error(`[REPORT_UPLOAD_CLEANUP_FAILED] ${publicId}: ${error.message}`);
      }
    })
  );
};

const uploadReportImages = async (files = []) => {
  const uploads = [];
  try {
    for (const file of files) {
      if (!isSupportedImage(file.buffer)) {
        const error = new Error("Image content is invalid or unsupported");
        error.status = 415;
        throw error;
      }
      const uploaded = await uploadToCloudinary(file.buffer, REPORT_FOLDER, `report_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      uploads.push({
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        format: uploaded.format || null,
        bytes: file.size,
        width: uploaded.width || null,
        height: uploaded.height || null,
        uploadedAt: new Date(),
      });
    }
    return uploads;
  } catch (error) {
    await cleanupUploads(uploads);
    throw error;
  }
};

export { cleanupUploads, isSupportedImage, uploadReportImages };