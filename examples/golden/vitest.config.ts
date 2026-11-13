import { defineConfig } from "vitest/config";

import { projectFor } from "./vitest.shared";

// The targets generate.mjs writes, one vitest project each.
export const config = defineConfig({
  test: {
    projects: [
      projectFor({ state: "zustand", major: 9 }),
      projectFor({ state: "zustand", major: 7 }),
      projectFor({ state: "formstand", major: 9 }),
    ],
  },
});

// Default export: vitest finds its config no other way (the same exception the
// repo root's vitest.config.ts documents).
export default config;
