import crypto from "crypto";
import MatchingLock from "../models/MatchingLock.js";
import { getMatchingConfig } from "../config/matching.js";
import { AppError } from "../utils/AppError.js";

export const lockKeyFor = (category, municipality) => `issue-match:${category}:${municipality || "unscoped"}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Atomic acquire: the upsert only matches an EXPIRED lock; if a live lock exists the upsert tries
// to insert a duplicate `key` and MongoDB's unique index rejects it (E11000) -> retry until timeout.
export const acquireLock = async (key, overrides = {}) => {
  const lock = { ...getMatchingConfig().lock, ...overrides };
  const owner = crypto.randomUUID();
  const deadline = Date.now() + lock.waitMs;
  for (;;) {
    const now = new Date();
    try {
      const acquired = await MatchingLock.findOneAndUpdate(
        { key, expiresAt: { $lte: now } },
        { $set: { owner, expiresAt: new Date(now.getTime() + lock.leaseMs) }, $setOnInsert: { key } },
        { upsert: true, returnDocument: "after" }
      );
      if (acquired?.owner === owner) return { key, owner };
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    if (Date.now() >= deadline) throw new AppError(503, "Matching is busy, please retry", "MATCH_LOCK_TIMEOUT");
    await sleep(lock.retryMs + Math.floor(Math.random() * 30));
  }
};

// Compare-and-set release: an expired holder can never delete a newer holder's lock.
export const releaseLock = async ({ key, owner }) => {
  await MatchingLock.deleteOne({ key, owner });
};

export const isLockHeld = async ({ key, owner }, session = null) =>
  Boolean(await MatchingLock.exists({ key, owner, expiresAt: { $gt: new Date() } }).session(session));
