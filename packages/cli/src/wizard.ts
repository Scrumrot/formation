import { resolve } from "node:path";

import { cancel, confirm, intro, isCancel, log, note, outro, select, text } from "@clack/prompts";
import type { FrameworkId, UiLibraryId } from "@formation/registry";
import {
  compatibleStateLibraries,
  compatibleUiLibraries,
  frameworks,
  resolveStack,
  schemaLibraries,
  stateLibraries,
  uiLibraries,
} from "@formation/registry";
import pc from "picocolors";

import { inferSchemaLibrary, runGenerate } from "./generate.js";
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

/**
 * A question with one possible answer is not a question. It is answered for
 * the user and said out loud, so the choice is visible without costing a
 * keypress — and the prompt reappears by itself once a second option ships.
 */
const choose = async (message: string, options: Option[]): Promise<string> => {
  const only = options[0];

  if (options.length === 1 && only !== undefined) {
    log.info(`${message}: ${only.label} ${pc.dim("(the only option so far)")}`);
    return only.value;
  }
  return required(await select({ message, options }));
};

export const runWizard = async (): Promise<number> => {
  intro(pc.bgCyan(pc.black(" formation ")));

  const schemaPath = required(
    await text({
      message: "Where is your schema? (a Zod module, or a JSON Schema / OpenAPI document)",
      placeholder: "./schemas/user.ts",
      validate: (value) => (value.length === 0 ? "A schema path is required." : undefined),
    }),
  );

  // Asked only when the file's extension does not already answer it, exactly
  // as `--schema` is optional on the flag path.
  const schemaLibrary =
    (await inferSchemaLibrary(resolve(schemaPath))) ??
    (await choose("What is the schema written in?", shipped(schemaLibraries)));

  const framework = (await choose("Framework", shipped(frameworks))) as FrameworkId;
  const stateLibrary = await choose(
    "State library",
    named(compatibleStateLibraries(framework), stateLibraries),
  );
  const uiLibrary = (await choose(
    "UI library",
    named(compatibleUiLibraries(framework), uiLibraries),
  )) as UiLibraryId;

  const majors = uiLibraries[uiLibrary].majors;
  const uiMajor =
    majors === undefined
      ? undefined
      : await choose(
          `${uiLibraries[uiLibrary].label} version`,
          // Newest first, since that is what a new project most likely has installed.
          [...majors.supported]
            .sort((a, b) => b - a)
            .map((major) => ({ value: String(major), label: `v${major}` })),
        );

  const outDir = required(
    await text({
      message: "Output directory",
      placeholder: "./src/components/forms",
      defaultValue: "./src/components/forms",
    }),
  );

  const ui = uiMajor === undefined ? uiLibrary : `${uiLibrary}@${uiMajor}`;
  const resolution = resolveStack({
    framework,
    stateLibrary,
    uiLibrary: ui,
    schemaLibrary,
    syntax: "ts",
    testRunners: [],
  });

  if (resolution.kind === "invalid") {
    printDiagnostics(resolution.diagnostics);
    outro(pc.red("Could not resolve that stack."));
    return 1;
  }

  note(stackToCommand(schemaPath, resolution.stack, outDir), "Equivalent command");

  const proceed = required(await confirm({ message: "Generate now?" }));

  if (!proceed) {
    outro("Nothing written. Run the command above when you are ready.");
    return 0;
  }

  const code = await runGenerate(schemaPath, {
    framework,
    state: stateLibrary,
    ui,
    schema: schemaLibrary,
    syntax: "ts",
    tests: [],
    out: outDir,
    force: false,
    dryRun: false,
  });

  outro(code === 0 ? pc.green("Done.") : pc.red("Generation failed."));
  return code;
};
