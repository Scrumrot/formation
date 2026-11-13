import { fileURLToPath } from "node:url";

import type { TestProjectInlineConfiguration } from "vitest/config";

export type Target = Readonly<{ state: "zustand" | "formstand"; major: 7 | 9 }>;

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * One test file, run once per target stack. The specs import the forms through
 * `@generated` and reach into the form's state through `@harness`; each
 * target's project points those two aliases at its own generated tree and its
 * own state library's harness — so the same assertions hold every stack to the
 * same behaviour.
 */
export const projectFor = ({ state, major }: Target): TestProjectInlineConfiguration => ({
  // esbuild reads JSX settings from a file named exactly `tsconfig.json`, and
  // this project has one tsconfig per target instead. Stated here, the tests
  // compile JSX the way the app would (`jsx: "react-jsx"`).
  esbuild: { jsx: "automatic" },
  // Lets a spec assert which MUI it is actually running against, so a broken
  // alias cannot quietly turn the "MUI 7" run into a second MUI 9 run.
  define: { __MUI_MAJOR__: String(major) },
  resolve: {
    alias: [
      {
        find: /^@generated\/(.*)$/,
        replacement: here(`./src/generated/${state}-mui${major}/$1`),
      },
      { find: /^@harness$/, replacement: here(`./src/harness/${state}.ts`) },
      // MUI 7 is installed beside 9 under the alias `mui7`; redirecting the
      // bare specifier runs the mui@7 output against the real MUI 7 runtime.
      ...(major === 7 ? [{ find: /^@mui\/material(\/.*)?$/, replacement: "mui7$1" }] : []),
    ],
  },
  test: {
    name: `${state}-mui${major}`,
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    // MUI's Select portals its menu and animates it; a cold first run under
    // load can pass the 5s default without anything being wrong.
    testTimeout: 20_000,
  },
});
