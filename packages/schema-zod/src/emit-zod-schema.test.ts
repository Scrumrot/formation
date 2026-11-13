import type { FieldNode, FormIR } from "@formation/core";
import { describe, expect, it } from "vitest";

import { emitZodSchema } from "./emit-zod-schema.js";

const field = (
  name: string,
  shape: FieldNode["shape"],
  flags: Partial<Pick<FieldNode, "optional" | "nullable">> = {},
): FieldNode => ({
  path: [name],
  label: name,
  optional: false,
  nullable: false,
  ...flags,
  shape,
});

const form = (fields: readonly FieldNode[]): FormIR => ({
  name: "Sample",
  fields,
  diagnostics: [],
});

// Whitespace is Prettier's job downstream, so comparisons ignore it.
const emit = (fields: readonly FieldNode[]): string =>
  emitZodSchema(form(fields), "sampleSchema").replace(/\s+/g, " ");

describe("emitZodSchema", () => {
  it("exports the schema under the requested name", () => {
    expect(emit([field("a", { kind: "boolean" })])).toContain(
      "export const sampleSchema = z.object({ a: z.boolean(), });",
    );
  });

  it("writes messages a form user can act on, not Zod's developer-facing defaults", () => {
    const source = emit([
      field("name", { kind: "string", min: { value: 1 } }),
      field("code", { kind: "string", min: { value: 3 }, max: { value: 9 } }),
      field("age", { kind: "number", integer: true, min: { value: 18 } }),
    ]);

    expect(source).toContain('name: z.string().min(1, "Required")');
    expect(source).toContain(
      'z.string().min(3, "Must be at least 3 characters").max(9, "Must be at most 9 characters")',
    );
    expect(source).toContain(
      'z.number("Enter a number").int("Must be a whole number").min(18, "Must be at least 18")',
    );
  });

  it("prefers the schema author's wording when the IR carries one", () => {
    const source = emit([
      field("name", {
        kind: "string",
        min: { value: 2, message: { text: "Too short!", authored: true } },
      }),
    ]);

    expect(source).toContain('.min(2, "Too short!")');
  });

  it("keeps an exclusive bound exclusive", () => {
    const source = emit([
      field("rate", {
        kind: "number",
        integer: false,
        min: { value: 0, exclusive: true },
        max: { value: 1, exclusive: true },
      }),
    ]);

    expect(source).toContain('.gt(0, "Must be greater than 0").lt(1, "Must be less than 1")');
  });

  it("uses Zod's format validators, and a plain string for display-only formats", () => {
    const source = emit([
      field("email", { kind: "string", format: "email" }),
      field("secret", { kind: "string", format: "password" }),
    ]);

    expect(source).toContain('email: z.email("Enter a valid email address")');
    expect(source).toContain("secret: z.string(),");
  });

  it("emits a pattern through RegExp so a slash in it cannot end a literal early", () => {
    const source = emit([field("path", { kind: "string", pattern: { value: "^/api/v\\d+$" } })]);

    expect(source).toContain('.regex(new RegExp("^/api/v\\\\d+$"), "Invalid format")');
  });

  it("uses z.enum for strings and z.literal where a value is numeric or alone", () => {
    const option = (value: string | number) => ({ value, label: String(value) });
    const source = emit([
      field("size", { kind: "enum", options: [option("s"), option("m")] }),
      field("level", { kind: "enum", options: [option(1), option(2)] }),
      field("version", { kind: "enum", options: [option("v1")] }),
    ]);

    expect(source).toContain('size: z.enum(["s", "m"], "Select an option")');
    expect(source).toContain('level: z.literal([1, 2], "Select an option")');
    expect(source).toContain('version: z.literal("v1", "Select an option")');
  });

  it("matches each date encoding to the value the store will hold", () => {
    const source = emit([
      field("day", { kind: "date", time: false, encoding: "iso-string" }),
      field("at", { kind: "date", time: true, encoding: "iso-string" }),
      field("born", { kind: "date", time: false, encoding: "date-object" }),
    ]);

    expect(source).toContain('day: z.iso.date("Enter a date")');
    expect(source).toContain('at: z.iso.datetime("Enter a date and time")');
    expect(source).toContain('born: z.date("Enter a date")');
  });

  it("applies nullable and optional, and quotes keys that are not identifiers", () => {
    const source = emit([
      field("first-name", { kind: "string" }, { optional: true }),
      field("score", { kind: "number", integer: false }, { nullable: true, optional: true }),
    ]);

    expect(source).toContain('"first-name": z.string().optional()');
    expect(source).toContain('score: z.number("Enter a number").nullable().optional()');
  });

  it("nests objects, arrays and discriminated unions", () => {
    const variant = (tag: string): FieldNode["shape"] => ({
      kind: "object",
      fields: [
        {
          ...field("kind", { kind: "enum", options: [{ value: tag, label: tag }] }),
          path: ["pay", "kind"],
        },
      ],
    });
    const source = emit([
      field("lines", {
        kind: "array",
        min: { value: 1 },
        of: {
          kind: "object",
          fields: [{ ...field("sku", { kind: "string" }), path: ["lines", "*", "sku"] }],
        },
      }),
      field("pay", {
        kind: "union",
        discriminator: "kind",
        variants: [variant("card"), variant("bank")],
      }),
    ]);

    expect(source).toContain(
      'z.array(z.object({ sku: z.string(), })).min(1, "Add at least 1 item")',
    );
    expect(source).toContain('z.discriminatedUnion("kind", [ z.object({ kind: z.literal("card"');
  });

  it("keeps an unsupported field in the schema, as unknown, with the reason beside it", () => {
    // z.object strips keys it does not list, so omitting the field would
    // delete the user's data on parse.
    const source = emit([
      field("meta", { kind: "unsupported", reason: "a record has no fields */" }),
    ]);

    expect(source).toContain("meta: z.unknown() /* TODO(formation): a record has no fields * / */");
  });
});
