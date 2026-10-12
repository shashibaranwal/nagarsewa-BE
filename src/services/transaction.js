import mongoose from "mongoose";

const isTransactionUnsupported = (error) =>
  error?.code === 20 || /Transaction numbers are only allowed|replica set member or mongos/i.test(error?.message || "");

// Runs `work(session)` in a MongoDB transaction. On a standalone deployment (no transaction
// support) it falls back to running `work(null)` WITHOUT atomicity; callers still rely on the
// matching lock and idempotent guards, and /api/issues/reconcile can repair counts.
export const runInTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      console.error("[TX] Transactions unsupported, running without atomicity");
      return work(null);
    }
    throw error;
  } finally {
    await session.endSession();
  }
};
