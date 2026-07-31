import { resolveStack } from "@formation/registry";
import pc from "picocolors";

import { printDiagnostics } from "./report.js";
import { stackToCommand, toSelection } from "./stack-command.js";

export type GenerateOptions = Readonly<{
  framework: string;
  form: string;
  ui: string;
  schema: string;
  syntax: string;
  tests: readonly string[];
  out: string;
}>;

/** Exit code, returned rather than thrown so the wizard can reuse this path. */
export const runGenerate = (schemaPath: string, options: GenerateOptions): number => {
  const resolution = resolveStack(toSelection(options));

  switch (resolution.kind) {
    case "invalid":
      printDiagnostics(resolution.diagnostics);
      return 1;

    case "valid":
      // The pipeline lands here: ingest → FormIR → ComponentIR → printer.
      // Until then say so plainly rather than exiting 0 on a no-op, which
      // would look like a successful generation that wrote nothing.
      console.log(pc.bold("Resolved stack"));
      console.log(`  ${stackToCommand(schemaPath, resolution.stack, options.out)}`);
      console.log();
      console.log(
        pc.yellow("Not generating yet — no emitters are wired up (see docs/plan.md §11)."),
      );
      return 2;
  }
};
