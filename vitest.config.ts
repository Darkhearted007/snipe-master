// Minimal vitest config for the unit tests under src/**/*.test.ts.
// Declared as a separate config so vitest does NOT load vite.config.ts
// (the @lovable.dev/vite-tanstack-config plugin stack is app-only and
// irrelevant for pure-logic tests).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
