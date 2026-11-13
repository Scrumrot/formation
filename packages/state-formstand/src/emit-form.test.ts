import type { FieldNode, FormIR } from "@formation/core";
import { describe, expect, it } from "vitest";

import { formstandAdapter } from "./index.js";

const field = (
  path: readonly string[],
  shape: FieldNode["shape"],
  extra: Partial<Pick<FieldNode, "optional" | "nullable" | "defaultValue">> = {},
): FieldNode => ({
  path,
  label: path[path.length - 1] ?? "",
  optional: false,
  nullable: false,
  ...extra,
  shape,
});

const adapt = (fields: readonly FieldNode[]) => {
  const form: FormIR = { name: "Sample", fields, diagnostics: [] };

  return formstandAdapter({ form, schemaModule: "schema", schemaExport: "sampleSchema" });
};

// Whitespace is Prettier's job downstream, so assertions ignore it.
const moduleFor = (fields: readonly FieldNode[]): string =>
  (adapt(fields).files[0]?.content ?? "").replace(/\s+/g, " ");

const kitchenSink = [
  field(["name"], { kind: "string" }),
  field(["nickname"], { kind: "string" }, { optional: true }),
  field(["age"], { kind: "number", integer: true }),
  // Optional *and* nullable: the one case where formstand's own rule for a
  // cleared field (undefined) and this generator's (null) part ways.
  field(["score"], { kind: "number", integer: false }, { optional: true, nullable: true }),
  field(["grade"], { kind: "number", integer: false }, { nullable: true }),
  field(["role"], { kind: "enum", options: [{ value: "admin", label: "Admin" }] }),
  field(["agree"], { kind: "boolean" }),
  field(["born"], { kind: "date", time: false, encoding: "date-object" }),
  field(["contacts"], {
    kind: "array",
    of: {
      kind: "object",
      fields: [field(["contacts", "*", "name"], { kind: "string" })],
    },
  }),
  field(["pay"], {
    kind: "union",
    discriminator: "kind",
    variants: [
      {
        kind: "object",
        fields: [
          field(["pay", "kind"], { kind: "enum", options: [{ value: "card", label: "Card" }] }),
          field(["pay", "pan"], { kind: "string" }),
        ],
      },
      {
        kind: "object",
        fields: [
          field(["pay", "kind"], { kind: "enum", options: [{ value: "bank", label: "Bank" }] }),
          field(["pay", "iban"], { kind: "string" }),
        ],
      },
    ],
  }),
];

describe("the form instance", () => {
  const source = moduleFor(kitchenSink);

  it("is a formstand form over the schema, started from the blank working values", () => {
    expect(source).toContain("export const sampleForm = createForm(sampleSchema, {");
    // Working values are looser than the schema's input, so this cast is the
    // one place the two are reconciled.
    expect(source).toContain(
      "initialValues: sampleInitialValues as unknown as z.input<typeof sampleSchema>,",
    );
  });

  it("holds errors back until a field is left", () => {
    expect(source).toContain('mode: "onTouched"');
  });

  it("is what the binding advertises as the form's public handle", () => {
    const { binding } = adapt(kitchenSink);

    expect(binding.module).toBe("form");
    expect(binding.publicValues).toEqual(["sampleForm", "useSampleForm", "sampleInitialValues"]);
  });
});

describe("the hooks", () => {
  const source = moduleFor(kitchenSink);

  it("are formstand's own, bound by string so a path inside a union can be named", () => {
    expect(source).toContain("const untyped: FieldFormApi & FieldArrayFormApi = sampleForm;");
    expect(source).toContain("const field = useField(untyped, path);");
    expect(source).toContain("const list = useFieldArray(untyped, path);");
  });

  it("keep the contract's path types, not a bare string", () => {
    expect(source).toContain(
      "export const useSampleText = (path: SampleTextPath): FieldHandle<string>",
    );
    expect(source).toContain('| "pay.pan"');
  });

  it("take row identity from formstand rather than tracking it again", () => {
    expect(source).toContain("ids: list.fields.map((row) => row.id),");
    expect(source).not.toContain("rowIds");
  });

  it("append the generated blank row", () => {
    expect(source).toContain('const blankRows: Dict<unknown> = { contacts: { name: "" }, };');
    expect(source).toContain("append: () => list.push(blankRows[patternOf(path)]),");
  });

  it("replace the whole union when a branch is chosen", () => {
    expect(source).toContain(
      'blanks: { card: { kind: "card", pan: "" }, bank: { kind: "bank", iban: "" } }',
    );
    expect(source).toContain("untyped.setValue( path,");
  });
});

describe("what a cleared field holds", () => {
  const source = moduleFor(kitchenSink);

  it("is formstand's own answer, read from the schema at run time", () => {
    expect(source).toContain('text === "" && field.clearable ? field.emptyValue : text');
    // No table of the generator's own: that would be a second opinion.
    expect(source).not.toContain("emptyValues");
    expect(source).not.toContain("emptyOf");
  });

  it("starts an optional-and-nullable field on the blank formstand clears it to", () => {
    // `score`: formstand clears it to undefined. Starting it at null would
    // leave the form reading as edited after typing a value and deleting it.
    expect(source).toContain("age: undefined, score: undefined, grade: null,");
    expect(source).toContain("score: number | null | undefined;");
  });

  it("starts a nullable, required field on null, which formstand also clears it to", () => {
    expect(source).toContain("grade: number | null;");
  });

  it("tables what a union clears to, the one value the module writes whole", () => {
    expect(source).toContain('pay: { tag: "kind", empty: undefined, blanks: {');
    expect(source).toContain(": union?.empty,");
  });
});

describe("a form that uses little", () => {
  const source = moduleFor([field(["agree"], { kind: "boolean" })]);

  it("imports only what it calls, so it compiles under noUnusedLocals", () => {
    expect(source).toContain(
      'import { createForm, type FieldFormApi, useField, useFormError, useIsSubmitting, } from "formstand";',
    );
    expect(source).not.toContain("useState");
  });

  it("emits no tables and no lookups", () => {
    expect(source).not.toMatch(/Dict<|patternOf|emptyOf|blankRows|const unions/);
  });

  it("types the bound view without the list API", () => {
    expect(source).toContain("const untyped: FieldFormApi = sampleForm;");
  });
});

describe("a form with no controls at all", () => {
  const source = moduleFor([field(["meta"], { kind: "unsupported", reason: "no shape" })]);

  it("still exports a form and its handle", () => {
    expect(source).toContain("export const sampleForm = createForm(");
    expect(source).toContain("export const useSampleForm = (): FormHandle =>");
  });

  it("declares no bound view, which nothing would read", () => {
    expect(source).not.toContain("untyped");
    expect(source).not.toContain("FieldFormApi");
  });

  it("says how to reach the field it could not bind", () => {
    expect(source).toContain("bind them with formstand's own `useField(sampleForm, path)`");
  });
});

describe("a field two union branches both declare", () => {
  const conflicted = [
    field(["pay"], {
      kind: "union",
      discriminator: "kind",
      variants: [
        {
          kind: "object",
          fields: [
            field(["pay", "kind"], { kind: "enum", options: [{ value: "a", label: "A" }] }),
            field(["pay", "ref"], { kind: "string" }),
          ],
        },
        {
          kind: "object",
          fields: [
            field(["pay", "kind"], { kind: "enum", options: [{ value: "b", label: "B" }] }),
            field(["pay", "ref"], { kind: "string" }, { optional: true }),
          ],
        },
      ],
    }),
  ];

  it("is warned about in formstand's terms: the first branch to declare it decides", () => {
    const warning = adapt(conflicted).diagnostics.find(
      (entry) => entry.code === "emit/branch-conflict",
    );

    expect(warning?.path).toEqual(["pay", "ref"]);
    expect(warning?.message).toContain("the first branch that declares it");
    // Required in the first branch, so a cleared control keeps the empty string.
    expect(warning?.message).toMatch(/writes ""\.$/);
  });
});
