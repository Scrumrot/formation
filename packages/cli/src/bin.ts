#!/usr/bin/env node
import { Command } from "commander";

import { runGenerate } from "./generate.js";
import { runWizard } from "./wizard.js";

const list = (value: string): readonly string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const program = new Command()
  .name("formation")
  .description("Generate form components for your stack from a schema.")
  .version("0.0.0");

program
  .command("generate", { isDefault: false })
  .argument("<schema>", "a Zod schema module, or a JSON Schema / OpenAPI document (.json, .yaml)")
  .description("generate a form from a schema using explicit flags")
  .requiredOption("--state <id>", "state library that holds the form's values (zustand)")
  .requiredOption("--ui <id>", "UI library, optionally pinned to a major (mui, mui@7, mui@9)")
  .option("--schema <id>", "what the input is written in (zod, json-schema, openapi); inferred")
  .option("--framework <id>", "target framework", "react")
  .option("--syntax <ts|js>", "output syntax", "ts")
  .option("--select <name|#/pointer>", "document inputs: which schema to generate from")
  .option("--export <name>", "Zod inputs: which export holds the schema")
  .option("--name <Name>", "base name for the form, default derived from the schema")
  // A list rather than a choice — a component spec and an e2e spec are
  // different tests, not one template emitted twice.
  .option("--tests <runners>", "comma-separated test runners", list, [])
  .option("--out <dir>", "directory the form's folder is created in", "./src/components/forms")
  .option("--force", "overwrite files that were edited after formation wrote them", false)
  .option("--dry-run", "run the whole pipeline and report, but write nothing", false)
  .action(async (schema: string, options: Record<string, unknown>) => {
    const select = optionalString(options["select"]);
    const exportName = optionalString(options["export"]);
    const name = optionalString(options["name"]);
    const schemaLibrary = optionalString(options["schema"]);

    process.exitCode = await runGenerate(schema, {
      framework: String(options["framework"]),
      state: String(options["state"]),
      ui: String(options["ui"]),
      syntax: String(options["syntax"]),
      tests: options["tests"] as readonly string[],
      out: String(options["out"]),
      force: options["force"] === true,
      dryRun: options["dryRun"] === true,
      // Spread in only when present: `exactOptionalPropertyTypes` forbids
      // passing `undefined` for an omitted flag.
      ...(schemaLibrary === undefined ? {} : { schema: schemaLibrary }),
      ...(select === undefined ? {} : { select }),
      ...(exportName === undefined ? {} : { exportName }),
      ...(name === undefined ? {} : { name }),
    });
  });

program
  .command("wizard")
  .description("pick a stack interactively, then generate and print the equivalent command")
  .action(async () => {
    process.exitCode = await runWizard();
  });

await program.parseAsync(process.argv);
