import { createRequire } from "node:module";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

import type { Diagnostic, FormIR, Outcome } from "@formation/core";
import { failed } from "@formation/core";
import type { JsonSchemaIngestOptions } from "@formation/ingest-json-schema";
import { fromJsonSchema } from "@formation/ingest-json-schema";
import { createJiti } from "jiti";

/**
 * A module exporting a Zod schema → FormIR.
 *
 * Structure comes from Zod's own JSON Schema export, then through the JSON
 * Schema ingest (docs/plan.md §4). Two details carry most of the weight:
 *
 * 1. The export is produced by the *user's* copy of zod, resolved from their
 *    schema file — never one bundled here. A schema built by zod 4.1 handed to
 *    a zod 4.6 `toJSONSchema` is the dual-package hazard: `instanceof` checks
 *    miss and internals drift. It also means this package has no zod dependency
 *    to fall out of step with the user's.
 * 2. What JSON Schema cannot say (refinements, transforms, custom messages) is
 *    not lost, because the generated form does not validate against the JSON
 *    Schema: it imports the original Zod schema and parses with that.
 */

export type ZodIngestOptions = Readonly<{
  /** Which export holds the schema. Defaults to the default export, then the only schema export. */
  exportName?: string;
  /** Overrides the name derived from the export. */
  name?: string;
}>;

export type ZodIngestResult = Readonly<{
  form: FormIR;
  /** The export the schema was found under; `"default"` for a default export. */
  exportName: string;
}>;

type Loaded = Readonly<Record<string, unknown>>;

type ZodLike = Readonly<{ toJSONSchema?: (schema: unknown, options: unknown) => unknown }>;

const error = (message: string, source: string): Diagnostic => ({
  severity: "error",
  code: "schema/unreadable",
  message,
  source,
});

/**
 * Duck-typed: a schema built by the user's zod is not an `instanceof` anything
 * this process imported. Zod 4 schemas carry a `def` payload and `safeParse`.
 */
const isZodSchema = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Readonly<{ safeParse?: unknown }>).safeParse === "function" &&
  typeof (value as Readonly<{ def?: unknown }>).def === "object";

type Picked =
  | Readonly<{ kind: "found"; exportName: string; schema: unknown }>
  | Readonly<{ kind: "missing"; message: string }>;

const pickExport = (module: Loaded, requested: string | undefined): Picked => {
  const named = Object.entries(module).filter(
    ([name, value]) => name !== "default" && isZodSchema(value),
  );
  const names = named.map(([name]) => name);
  const listed = names.length === 0 ? "none" : names.join(", ");

  if (requested !== undefined) {
    return isZodSchema(module[requested])
      ? { kind: "found", exportName: requested, schema: module[requested] }
      : {
          kind: "missing",
          message: `Export "${requested}" is not a Zod schema. Schema exports found: ${listed}.`,
        };
  }
  if (isZodSchema(module["default"])) {
    return { kind: "found", exportName: "default", schema: module["default"] };
  }

  const only = named[0];

  return named.length === 1 && only !== undefined
    ? { kind: "found", exportName: only[0], schema: only[1] }
    : {
        kind: "missing",
        message:
          named.length === 0
            ? "The module exports no Zod schema."
            : `The module exports ${named.length} Zod schemas; pick one with --export. Found: ${listed}.`,
      };
};

type OverrideContext = Readonly<{
  zodSchema: Readonly<{ _zod?: Readonly<{ def?: Readonly<{ type?: unknown }> }> }>;
  // Zod's `override` hook works by mutating this object in place; there is no
  // return value to use instead. This is the one sanctioned mutation in the
  // package, and it is confined to an object Zod created for that purpose.
  jsonSchema: Record<string, unknown>;
}>;

const override = (context: OverrideContext): void => {
  const target = context.jsonSchema;

  // `z.date()` has no JSON Schema form. Marking it lets the JSON Schema ingest
  // produce a date field whose value is a `Date`, where the default
  // ("unrepresentable") would have dropped the field to an untyped blob.
  if (context.zodSchema._zod?.def?.type === "date") {
    target["type"] = "string";
    target["format"] = "date";
    target["x-formation-date"] = "object";
  }
  // Zod restates each built-in format as a regex beside `format`. The form
  // validates with the real schema, so the copy is noise in the IR.
  if (typeof target["format"] === "string") delete target["pattern"];
  // `z.int()` documents the float-safe range as bounds; they are not limits
  // anyone chose.
  if (target["maximum"] === Number.MAX_SAFE_INTEGER) delete target["maximum"];
  if (target["minimum"] === Number.MIN_SAFE_INTEGER) delete target["minimum"];
};

/** The user's own zod, resolved from where their schema file lives. */
const loadUserZod = async (
  jiti: ReturnType<typeof createJiti>,
  schemaFile: string,
): Promise<ZodLike | undefined> => {
  try {
    const resolved = createRequire(pathToFileURL(schemaFile)).resolve("zod");
    const module = await jiti.import<Readonly<{ z?: ZodLike }> & ZodLike>(
      pathToFileURL(resolved).href,
    );

    return module.z ?? module;
  } catch {
    return undefined;
  }
};

/**
 * @param schemaFile Absolute path to the module. TypeScript is fine — it is
 *   loaded through jiti, so no build step is needed first.
 */
export const fromZodModule = async (
  schemaFile: string,
  options: ZodIngestOptions = {},
): Promise<Outcome<ZodIngestResult>> => {
  // No module cache: in a long-lived process (a watch mode, the wizard) the
  // second run must see the edited schema, not the first run's copy.
  const jiti = createJiti(import.meta.url, { moduleCache: false });

  // Loading user code is a process boundary, and it can fail in ways only the
  // user can fix (a syntax error, a missing import). The failure is still
  // returned as a diagnostic so the CLI reports it like every other problem.
  const loaded = await jiti
    .import<Loaded>(pathToFileURL(schemaFile).href)
    .then((module) => ({ kind: "loaded" as const, module }))
    .catch((cause: unknown) => ({
      kind: "threw" as const,
      message: cause instanceof Error ? cause.message : String(cause),
    }));

  if (loaded.kind === "threw") {
    return failed([error(`Could not load the schema module: ${loaded.message}`, schemaFile)]);
  }

  const picked = pickExport(loaded.module, options.exportName);

  if (picked.kind === "missing") return failed([error(picked.message, schemaFile)]);

  const zod = await loadUserZod(jiti, schemaFile);

  if (zod?.toJSONSchema === undefined) {
    return failed([
      error(
        zod === undefined
          ? 'Could not resolve "zod" from the schema\'s folder. Install zod (v4) in that project.'
          : "The project's zod has no toJSONSchema(); Zod 4 or newer is required.",
        schemaFile,
      ),
    ]);
  }

  const toJsonSchema = zod.toJSONSchema;
  // `io: "input"`: a form collects what goes *into* the schema. For a
  // `.transform()` the output side is whatever the transform returns, which no
  // control can produce.
  const converted = (():
    Readonly<{ kind: "ok"; document: unknown }> | Readonly<{ kind: "threw"; message: string }> => {
    try {
      return {
        kind: "ok",
        document: toJsonSchema(picked.schema, { io: "input", unrepresentable: "any", override }),
      };
    } catch (cause) {
      return { kind: "threw", message: cause instanceof Error ? cause.message : String(cause) };
    }
  })();

  if (converted.kind === "threw") {
    return failed([
      error(`Zod could not describe the schema as JSON Schema: ${converted.message}`, schemaFile),
    ]);
  }

  const ingestOptions: JsonSchemaIngestOptions = {
    // A default export has no name of its own, so the file's name stands in:
    // `profile.ts` → `ProfileForm`.
    name:
      options.name ??
      (picked.exportName === "default"
        ? basename(schemaFile, extname(schemaFile))
        : picked.exportName),
    source: schemaFile,
  };
  const outcome = fromJsonSchema(converted.document, ingestOptions);

  return outcome.kind === "failed"
    ? outcome
    : {
        kind: "ok",
        value: { form: outcome.value, exportName: picked.exportName },
        diagnostics: outcome.diagnostics,
      };
};
