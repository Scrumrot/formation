import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const source = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

// One root project rather than per-package configs: every package here is pure
// TypeScript with no environment of its own, so splitting them would buy
// nothing but a config file per package to keep in sync. The generated *output*
// does need a DOM to be tested, and that lives in examples/golden with its
// own config.
export const config = defineConfig({
  resolve: {
    // Each package's `exports` points at `dist`, which only exists after a
    // build. Aliasing to source lets `pnpm test` run on a fresh checkout and
    // makes a test see the edit that was just made, not the last build of it.
    alias: {
      "@formation/core": source("core"),
      "@formation/registry": source("registry"),
      "@formation/ingest-json-schema": source("ingest-json-schema"),
      "@formation/ingest-zod": source("ingest-zod"),
      "@formation/schema-zod": source("schema-zod"),
      "@formation/state-kit": source("state-kit"),
      "@formation/state-zustand": source("state-zustand"),
      "@formation/state-formstand": source("state-formstand"),
      "@formation/ui-mui": source("ui-mui"),
      "@formation/framework-react": source("framework-react"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});

// Default export against the repo-wide named-exports-only rule: vitest resolves
// its config by default export and offers no alternative. Tool config files are
// the only place this exception applies.
export default config;
