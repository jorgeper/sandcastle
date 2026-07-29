import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx,mts}"],
    setupFiles: ["src/testSetup.ts"],
  },
});
