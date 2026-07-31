#!/usr/bin/env node
import { Command } from "commander";

import { runGenerate } from "./generate.js";
import { runWizard } from "./wizard.js";

const list = (value: string): readonly string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const program = new Command()
  .name("formation")
  .description("Generate form components for your stack from a schema.")
  .version("0.0.0");

program
  .command("generate", { isDefault: false })
  .argument("<schema>", "path or glob for the schema to generate from")
  .description("generate form components from a schema using explicit flags")
  .requiredOption("--framework <id>", "target framework")
  .requiredOption("--form <id>", "form library")
  .requiredOption("--ui <id>", "UI library")
  .requiredOption("--schema <id>", "schema library the input is written in")
  .option("--syntax <ts|js>", "output syntax", "ts")
  // A list rather than a choice — a component spec and an e2e spec are
  // different tests, not one template emitted twice.
  .option("--tests <runners>", "comma-separated test runners", list, [])
  .option("--out <dir>", "output directory", "./src/components/forms")
  .action((schema: string, options: Record<string, unknown>) => {
    process.exitCode = runGenerate(schema, {
      framework: String(options["framework"]),
      form: String(options["form"]),
      ui: String(options["ui"]),
      schema: String(options["schema"]),
      syntax: String(options["syntax"]),
      tests: options["tests"] as readonly string[],
      out: String(options["out"]),
    });
  });

program
  .command("wizard")
  .description("pick a stack interactively, then print the equivalent command")
  .action(async () => {
    process.exitCode = await runWizard();
  });

await program.parseAsync(process.argv);
