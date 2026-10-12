import mongoose from "mongoose";
import { seedSuperAdmin } from "../utils/seedSuperAdmin.js";

const connectDB = async () => {
  try {
    const connection = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`[DB] MongoDB connected: ${connection.connection.host}`);
    await seedSuperAdmin();
  } catch (error) {
    console.error(`[DB] Connection failed: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
