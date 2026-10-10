import { defineConfig } from "vitest/config";

export default defineConfig({
  // Bound parallelism so CI and small self-hosted machines do not starve timers.
  test: { maxWorkers: 2, minWorkers: 1 },
});
