import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

import type { Diagnostic, GeneratedFile } from "@formation/core";
import type { SchemaLibraryId, Stack } from "@formation/registry";
import { resolveStack, stateLibraries, uiLibraries } from "@formation/registry";
import pc from "picocolors";
import { format, resolveConfig } from "prettier";

import type { GeneratedForm } from "./pipeline.js";
import { generateForm } from "./pipeline.js";
import { printDiagnostics } from "./report.js";
import { stackToCommand, toSelection } from "./stack-command.js";
import type { PendingFile } from "./write.js";
import { parseManifest, planWrites } from "./write.js";

export type GenerateOptions = Readonly<{
  framework: string;
  state: string;
  ui: string;
  /** Inferred from the file when omitted. */
  schema?: string;
  syntax: string;
  tests: readonly string[];
  out: string;
  select?: string;
  exportName?: string;
  name?: string;
  force: boolean;
  dryRun: boolean;
}>;

const MANIFEST = join(".formation", "manifest.json");

const readText = (path: string): Promise<string | undefined> =>
  readFile(path, "utf8").catch(() => undefined);

const posix = (path: string): string => path.split("\\").join("/");

const MODULE_EXTENSIONS: readonly string[] = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".tsx"];
const DOCUMENT_EXTENSIONS: readonly string[] = [".json", ".yaml", ".yml"];

/**
 * A module is a Zod schema; a document is JSON Schema unless it announces
 * itself as OpenAPI. Both document kinds take the same ingest route, so the
 * distinction only matters for echoing an honest `--schema` back to the user.
 */
export const inferSchemaLibrary = async (
  schemaPath: string,
): Promise<SchemaLibraryId | undefined> => {
  const extension = extname(schemaPath).toLowerCase();

  if (MODULE_EXTENSIONS.includes(extension)) return "zod";
  if (!DOCUMENT_EXTENSIONS.includes(extension)) return undefined;

  const text = (await readText(schemaPath)) ?? "";

  return /^\s*["']?(openapi|swagger)["']?\s*:/m.test(text) ? "openapi" : "json-schema";
};

/**
 * Formatting is not cosmetic here: the printers emit parseable-but-unindented
 * source on purpose and rely on this pass (docs/plan.md §6). The project's own
 * Prettier config applies, so generated files match the code around them.
 */
const formatFile = async (
  file: GeneratedFile,
  destination: string,
): Promise<
  Readonly<{ kind: "formatted"; content: string }> | Readonly<{ kind: "failed"; message: string }>
> => {
  try {
    const config = await resolveConfig(destination);

    return {
      kind: "formatted",
      // `filepath`, not a fixed parser: a `.ts` file formatted as TSX comes
      // out with `<T,>` on every generic arrow function.
      content: await format(file.content, { ...config, filepath: destination }),
    };
  } catch (cause) {
    return { kind: "failed", message: cause instanceof Error ? cause.message : String(cause) };
  }
};

const stackLabel = (stack: Stack): string =>
  `${stateLibraries[stack.stateLibrary].label} + ${uiLibraries[stack.uiLibrary].label}${
    stack.uiMajor === undefined ? "" : ` ${stack.uiMajor}`
  }`;

const reportSuccess = (
  form: GeneratedForm,
  stack: Stack,
  written: readonly string[],
  unchanged: readonly string[],
  dryRun: boolean,
): void => {
  // "Generated" over five untouched files would claim work that did not happen.
  const verb = written.length === 0 ? "Up to date:" : dryRun ? "Would generate" : "Generated";

  console.log(
    `${pc.green(verb)} ${pc.bold(form.componentName)} ${pc.dim(`(${stackLabel(stack)})`)}`,
  );
  written.forEach((path) =>
    console.log(`  ${dryRun ? pc.dim("write") : pc.green("wrote")}  ${path}`),
  );
  unchanged.forEach((path) => console.log(`  ${pc.dim("same   " + path)}`));
};

/** Exit code, returned rather than thrown so the wizard can reuse this path. */
export const runGenerate = async (
  schemaArgument: string,
  options: GenerateOptions,
  cwd: string = process.cwd(),
): Promise<number> => {
  const schemaPath = resolve(cwd, schemaArgument);
  const schemaLibrary = options.schema ?? (await inferSchemaLibrary(schemaPath));

  if (schemaLibrary === undefined) {
    printDiagnostics([
      {
        severity: "error",
        code: "stack/unknown-option",
        message: `Cannot tell what kind of schema "${schemaArgument}" is from its extension; pass --schema.`,
      },
    ]);
    return 1;
  }

  const resolution = resolveStack(toSelection({ ...options, schema: schemaLibrary }));

  if (resolution.kind === "invalid") {
    printDiagnostics(resolution.diagnostics);
    return 1;
  }

  const stack = resolution.stack;
  const outDir = resolve(cwd, options.out);
  const outcome = await generateForm({
    schemaPath,
    stack,
    outDir,
    ...(options.select === undefined ? {} : { select: options.select }),
    ...(options.exportName === undefined ? {} : { exportName: options.exportName }),
    ...(options.name === undefined ? {} : { name: options.name }),
  });

  printDiagnostics(outcome.diagnostics);

  if (outcome.kind === "failed") return 1;

  const form = outcome.value;
  const destinationOf = (file: GeneratedFile): string => join(outDir, form.folder, file.path);
  const formatted = await Promise.all(
    form.files.map(async (file) => ({
      file,
      destination: destinationOf(file),
      result: await formatFile(file, destinationOf(file)),
    })),
  );
  const unformattable: readonly Diagnostic[] = formatted.flatMap((entry) =>
    entry.result.kind === "failed"
      ? [
          {
            severity: "error" as const,
            code: "emit/capability-unsupported" as const,
            // Unparseable output is a generator bug, never the user's schema.
            message: `Generated ${entry.file.path} did not parse (this is a bug in formation): ${entry.result.message}`,
          },
        ]
      : [],
  );

  if (unformattable.length > 0) {
    printDiagnostics(unformattable);
    return 1;
  }

  const pending: readonly (PendingFile & Readonly<{ destination: string }>)[] = await Promise.all(
    formatted.map(async (entry) => ({
      key: posix(relative(cwd, entry.destination)),
      destination: entry.destination,
      content: entry.result.kind === "formatted" ? entry.result.content : entry.file.content,
      existing: await readText(entry.destination),
    })),
  );
  const manifestPath = join(cwd, MANIFEST);
  const plan = planWrites(pending, parseManifest(await readText(manifestPath)), options.force);

  if (plan.kind === "blocked") {
    console.error(
      pc.red(
        `Refusing to overwrite ${plan.edited.length === 1 ? "a file" : "files"} changed since formation wrote ${plan.edited.length === 1 ? "it" : "them"}:`,
      ),
    );
    plan.edited.forEach((path) => console.error(`  ${path}`));
    console.error(
      pc.dim(
        `Nothing was written. Re-run with --force to replace ${plan.edited.length === 1 ? "it" : "them"}.`,
      ),
    );
    return 1;
  }

  const destinations = new Map(pending.map((file) => [file.key, file.destination]));

  if (!options.dryRun) {
    // Writes are sequential on purpose: the form folder is created by the
    // first, and a failure part-way reports the path that actually failed.
    await plan.writes.reduce<Promise<void>>(async (previous, file) => {
      await previous;
      const destination = destinations.get(file.key) ?? join(cwd, file.key);

      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, "utf8");
    }, Promise.resolve());
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`, "utf8");
  }

  reportSuccess(
    form,
    stack,
    plan.writes.map((file) => file.key),
    plan.unchanged.map((file) => file.key),
    options.dryRun,
  );
  console.log();
  console.log(pc.dim(stackToCommand(schemaArgument, stack, options.out)));

  return 0;
};
