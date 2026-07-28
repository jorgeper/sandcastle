import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,mts}"],
    setupFiles: ["src/testSetup.ts"],
  },
});
