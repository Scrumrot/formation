import { cancel, intro, isCancel, multiselect, note, outro, select, text } from "@clack/prompts";
import type { FrameworkId } from "@formation/registry";
import {
  compatibleFormLibraries,
  compatibleUiLibraries,
  formLibraries,
  frameworks,
  resolveStack,
  schemaLibraries,
  testRunners,
  uiLibraries,
} from "@formation/registry";
import pc from "picocolors";

import { printDiagnostics } from "./report.js";
import { stackToCommand } from "./stack-command.js";

// Every option list is derived from the registry rather than hardcoded here,
// so a new adapter shows up in the wizard the moment it is registered — the
// wizard and the flag parser can't disagree about what's supported.
// Mutable arrays against the repo-wide readonly preference: clack's option
// lists are typed as mutable and it will not accept `readonly`. The arrays are
// freshly built here and never handed anywhere else, so nothing can observe a
// mutation even if clack made one.
type Option = { value: string; label: string };

const shipped = <T extends { readonly status: string; readonly label: string }>(
  catalog: Readonly<Record<string, T>>,
): Option[] =>
  Object.entries(catalog)
    .filter(([, entry]) => entry.status === "available")
    .map(([value, entry]) => ({ value, label: entry.label }));

const named = (
  ids: readonly string[],
  catalog: Readonly<Record<string, { readonly label: string }>>,
): Option[] => ids.map((id) => ({ value: id, label: catalog[id]?.label ?? id }));

/** Clack signals cancellation with a symbol; bail out rather than coerce it. */
const required = <T>(value: T | symbol): T => {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(130); // 128 + SIGINT, the conventional code for user interrupt.
  }
  return value;
};

export const runWizard = async (): Promise<number> => {
  intro(pc.bgCyan(pc.black(" formation ")));

  const schemaPath = required(
    await text({
      message: "Where is your schema?",
      placeholder: "./schemas/user.ts",
      validate: (value) => (value.length === 0 ? "A schema path is required." : undefined),
    }),
  );

  const schemaLibrary = required(
    await select({ message: "Schema library", options: shipped(schemaLibraries) }),
  );

  const framework = required(
    await select({ message: "Framework", options: shipped(frameworks) }),
  ) as FrameworkId;

  const formLibrary = required(
    await select({
      message: "Form library",
      options: named(compatibleFormLibraries(framework), formLibraries),
    }),
  );

  const uiLibrary = required(
    await select({
      message: "UI library",
      options: named(compatibleUiLibraries(framework), uiLibraries),
    }),
  );

  const syntax = required(
    await select({
      message: "Output syntax",
      options: [
        { value: "ts", label: "TypeScript" },
        { value: "js", label: "JavaScript + JSDoc" },
      ],
    }),
  );

  // A list, not a choice: a project can legitimately want a component spec and
  // an e2e spec, and those are different tests rather than one template in two
  // dialects.
  const tests = required(
    await multiselect({
      message: "Generate tests with",
      options: shipped(testRunners),
      required: false,
    }),
  );

  const outDir = required(
    await text({
      message: "Output directory",
      placeholder: "./src/components/forms",
      defaultValue: "./src/components/forms",
    }),
  );

  const resolution = resolveStack({
    framework,
    formLibrary,
    uiLibrary,
    schemaLibrary,
    syntax,
    testRunners: tests,
  });

  switch (resolution.kind) {
    case "invalid":
      printDiagnostics(resolution.diagnostics);
      outro(pc.red("Could not resolve that stack."));
      return 1;

    case "valid":
      note(stackToCommand(schemaPath, resolution.stack, outDir), "Equivalent command");
      outro(pc.yellow("Not generating yet — no emitters are wired up (see docs/plan.md §11)."));
      return 2;
  }
};
