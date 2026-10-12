import Ward from "../models/Ward.js";
import { escapeRegex } from "../validators/issueValidator.js";

// Case-insensitive search over title, description, municipality and ward ("Ward 10" / ward name).
export const applySearch = async (filter, search) => {
  if (!search) return;
  const rx = { $regex: escapeRegex(search), $options: "i" };
  const wardNumber = /^ward\s*(\d+)$/i.exec(search)?.[1];
  const wards = await Ward.find({ $or: [{ name: rx }, ...(wardNumber ? [{ wardNumber: Number(wardNumber) }] : [])] }).select("_id").limit(50).lean();
  filter.$or = [{ summary: rx }, { description: rx }, { municipality: rx }, ...(wards.length ? [{ ward: { $in: wards.map((w) => w._id) } }] : [])];
};
