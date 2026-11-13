import { fileURLToPath } from "node:url";

import type { ViteUserConfig } from "vitest/config";

/**
 * One test file, run once per supported MUI major. The specs import the forms
 * through `@generated`, and each major's config points that alias at its own
 * generated tree — so the same assertions hold the mui@7 and mui@9 output to
 * the same behaviour.
 */
export const configFor = (major: 7 | 9): ViteUserConfig => ({
  // esbuild reads JSX settings from a file named exactly `tsconfig.json`, and
  // this project has one tsconfig per MUI major instead. Stated here, the tests
  // compile JSX the way the app would (`jsx: "react-jsx"`).
  esbuild: { jsx: "automatic" },
  // Lets a spec assert which MUI it is actually running against, so a broken
  // alias cannot quietly turn the "MUI 7" run into a second MUI 9 run.
  define: { __MUI_MAJOR__: String(major) },
  resolve: {
    alias: [
      {
        find: /^@generated\/(.*)$/,
        replacement: fileURLToPath(new URL(`./src/generated/mui${major}/$1`, import.meta.url)),
      },
      // MUI 7 is installed beside 9 under the alias `mui7`; redirecting the
      // bare specifier runs the mui@7 output against the real MUI 7 runtime.
      ...(major === 7 ? [{ find: /^@mui\/material(\/.*)?$/, replacement: "mui7$1" }] : []),
    ],
  },
  test: {
    name: `mui${major}`,
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    // MUI's Select portals its menu and animates it; a cold first run under
    // load can pass the 5s default without anything being wrong.
    testTimeout: 20_000,
  },
});
