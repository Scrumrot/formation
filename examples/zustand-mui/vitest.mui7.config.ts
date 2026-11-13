import { defineConfig } from "vitest/config";

import { configFor } from "./vitest.shared";

// Default export: vitest finds its config no other way (the same exception the
// repo root's vitest.config.ts documents).
export default defineConfig(configFor(7));
