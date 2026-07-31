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
    `--framework ${stack.framework}`,
    `--form ${stack.formLibrary}`,
    `--ui ${stack.uiLibrary}`,
    `--schema ${stack.schemaLibrary}`,
    `--syntax ${stack.syntax}`,
    ...(stack.testRunners.length > 0 ? [`--tests ${stack.testRunners.join(",")}`] : []),
    `--out ${outDir}`,
  ].join(" \\\n  ");

export const toSelection = (
  options: Readonly<{
    framework: string;
    form: string;
    ui: string;
    schema: string;
    syntax: string;
    tests: readonly string[];
  }>,
): StackSelection => ({
  framework: options.framework,
  formLibrary: options.form,
  uiLibrary: options.ui,
  schemaLibrary: options.schema,
  syntax: options.syntax,
  testRunners: options.tests,
});
