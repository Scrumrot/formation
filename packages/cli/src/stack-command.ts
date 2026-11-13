import type { Stack, StackSelection } from "@formation/registry";

/**
 * Renders a resolved stack back into the flags that would reproduce it.
 *
 * This is the hinge between the two CLI surfaces: the wizard finishes by
 * printing the equivalent raw command, so anything discovered interactively is
 * reproducible in CI and users learn the flags by using the wizard instead of
 * by reading `--help`.
 */
export const stackToCommand = (schemaPath: string, stack: Stack, outDir: string): string =>
  [
    `formation generate ${schemaPath}`,
    `--state ${stack.stateLibrary}`,
    // The major is always spelled out, even when it is the current one: a
    // command saved today must not start meaning a different MUI next year.
    `--ui ${stack.uiMajor === undefined ? stack.uiLibrary : `${stack.uiLibrary}@${stack.uiMajor}`}`,
    `--schema ${stack.schemaLibrary}`,
    `--framework ${stack.framework}`,
    ...(stack.testRunners.length > 0 ? [`--tests ${stack.testRunners.join(",")}`] : []),
    `--out ${outDir}`,
  ].join(" \\\n  ");

export const toSelection = (
  options: Readonly<{
    framework: string;
    state: string;
    ui: string;
    schema: string;
    syntax: string;
    tests: readonly string[];
  }>,
): StackSelection => ({
  framework: options.framework,
  stateLibrary: options.state,
  uiLibrary: options.ui,
  schemaLibrary: options.schema,
  syntax: options.syntax,
  testRunners: options.tests,
});
