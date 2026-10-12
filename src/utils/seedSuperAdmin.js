import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

export const DEFAULT_SUPER_ADMIN = {
  fullName: "Super Admin",
  email: "superadmin@nagarsewa.gov.np",
  phone: "9800000000",
  currentAddress: "Kathmandu, Nepal",
  permanentAddress: "Kathmandu, Nepal",
  password: "SuperAdmin@123",
  kycType: "pan",
  kycFrontImage: {
    url: "https://res.cloudinary.com/nagarsewa/image/upload/v1/system/superadmin_kyc.jpg",
    publicId: "system/superadmin_kyc",
  },
  isVerified: true,
  status: "active",
  role: "super_admin",
};

/**
 * Ensures a default Super Admin account exists in the database.
 * Does not overwrite existing users or alter any current accounts.
 */
export const seedSuperAdmin = async () => {
  try {
    const existing = await User.findOne({
      $or: [{ email: DEFAULT_SUPER_ADMIN.email }, { role: "super_admin" }],
    });

    if (existing) {
      console.log(`[SEED] Super Admin account already exists (${existing.email}).`);
      return existing;
    }

    const superAdmin = await User.create(DEFAULT_SUPER_ADMIN);
    console.log(`[SEED] Created default Super Admin account (${superAdmin.email}).`);
    return superAdmin;
  } catch (error) {
    console.error(`[SEED] Error seeding Super Admin: ${error.message}`);
  }
};

// Allow running directly via `node src/utils/seedSuperAdmin.js`
if (process.argv[1] && process.argv[1].includes("seedSuperAdmin.js")) {
  const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/nagarsewa";
  mongoose
    .connect(MONGODB_URI)
    .then(async () => {
      console.log("[SEED] Connected to MongoDB for seeding...");
      await seedSuperAdmin();
      await mongoose.disconnect();
      console.log("[SEED] Seeding process complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[SEED] DB connection error:", err);
      process.exit(1);
    });
}
