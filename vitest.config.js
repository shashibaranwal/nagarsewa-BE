import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run test files one at a time — prevents parallel MongoDB connection races
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
    reporters: ["verbose"],
  },
});
