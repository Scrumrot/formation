import { defineConfig } from "vitest/config";

// One root project rather than per-package configs: every package here is pure
// TypeScript with no environment of its own, so splitting them would buy
// nothing but nine more config files to keep in sync. Revisit when a package
// needs jsdom (the framework adapters eventually will).
export const config = defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});

// Default export against the repo-wide named-exports-only rule: vitest resolves
// its config by default export and offers no alternative. Tool config files are
// the only place this exception applies.
export default config;
