import type { FieldNode, FormIR } from "@formation/core";
import { describe, expect, it } from "vitest";

import { zustandAdapter } from "./index.js";

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

const storeFor = (fields: readonly FieldNode[]): string => {
  const form: FormIR = { name: "Sample", fields, diagnostics: [] };
  const output = zustandAdapter({ form, schemaModule: "schema", schemaExport: "sampleSchema" });

  // Whitespace is Prettier's job downstream, so assertions ignore it.
  return (output.files[0]?.content ?? "").replace(/\s+/g, " ");
};

const kitchenSink = [
  field(["name"], { kind: "string" }),
  field(["nickname"], { kind: "string" }, { optional: true }),
  field(["middle"], { kind: "string" }, { nullable: true }),
  field(["age"], { kind: "number", integer: true }),
  field(["score"], { kind: "number", integer: false }, { nullable: true }),
  field(["role"], {
    kind: "enum",
    options: [
      { value: "admin", label: "Admin" },
      { value: 2, label: "Two" },
    ],
  }),
  field(["agree"], { kind: "boolean" }, { defaultValue: true }),
  field(["day"], { kind: "date", time: false, encoding: "iso-string" }),
  field(["at"], { kind: "date", time: true, encoding: "iso-string" }),
  field(["born"], { kind: "date", time: false, encoding: "date-object" }),
  field(["contacts"], {
    kind: "array",
    of: {
      kind: "object",
      fields: [
        field(["contacts", "*", "name"], { kind: "string" }),
        field(["contacts", "*", "phone"], { kind: "string" }, { optional: true }),
        field(["contacts", "*", "qty"], { kind: "number", integer: true }, { defaultValue: 1 }),
      ],
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
          field(["pay", "kind"], { kind: "enum", options: [{ value: 2, label: "Two" }] }),
          field(["pay", "pan"], { kind: "string" }, { optional: true }),
          field(["pay", "limit"], { kind: "number", integer: false }),
        ],
      },
    ],
  }),
  field(["meta"], { kind: "unsupported", reason: "no shape" }),
];

describe("the working values", () => {
  const store = storeFor(kitchenSink);

  it("types a blank as what the control will actually write back", () => {
    expect(store).toContain("name: string;");
    expect(store).toContain("nickname: string | undefined;");
    expect(store).toContain("middle: string | null;");
    expect(store).toContain("age: number | undefined;");
    expect(store).toContain("score: number | null;");
    expect(store).toContain('role: "admin" | 2 | undefined;');
    expect(store).toContain("born: Date | undefined;");
    expect(store).toContain("meta: unknown;");
  });

  it("starts blank, except where the schema gives a usable default", () => {
    expect(store).toContain(
      'export const sampleInitialValues: SampleValues = { name: "", nickname: undefined, middle: null, age: undefined, score: null, role: undefined, agree: true,',
    );
  });

  it("ignores a default of the wrong type rather than seeding a control with it", () => {
    const seeded = storeFor([
      field(["age"], { kind: "number", integer: true }, { defaultValue: "12" }),
    ]);

    expect(seeded).toContain("SampleValues = { age: undefined }");
  });
});

describe("the path unions", () => {
  const store = storeFor(kitchenSink);

  it("sorts paths by control kind, typing row positions as numbers", () => {
    expect(store).toContain(
      'export type SampleTextPath = | "name" | "nickname" | "middle" | `contacts.${number}.name` | `contacts.${number}.phone` | "pay.pan";',
    );
    expect(store).toContain(
      'export type SampleNumberPath = | "age" | "score" | `contacts.${number}.qty` | "pay.limit";',
    );
    expect(store).toContain('export type SampleListPath = | "contacts";');
  });

  it("keeps a field with no control addressable", () => {
    expect(store).toContain('export type SampleUnboundPath = | "meta";');
  });
});

describe("discriminated unions", () => {
  const store = storeFor(kitchenSink);

  it("types the union as its branches, each with its tag as a literal", () => {
    // Literal tags are what let `value.kind === "card"` narrow to that branch.
    expect(store).toContain('Readonly<{ kind: "card"; pan: string; }>');
    expect(store).toContain(
      "Readonly<{ kind: 2; pan: string | undefined; limit: number | undefined; }> | undefined;",
    );
  });

  it("starts with no branch chosen", () => {
    expect(store).toContain("role: undefined, agree: true, day: undefined, at: undefined,");
    expect(store).toContain("contacts: [], pay: undefined, meta: undefined }");
  });

  it("tables each branch's blank, keyed by the tag as the select will send it", () => {
    // (JavaScript orders integer-like keys first; the order carries no meaning here.)
    expect(store).toContain(
      'pay: { tag: "kind", blanks: { "2": { kind: 2, pan: undefined, limit: undefined }, card: { kind: "card", pan: "" } } },',
    );
  });

  it("exports the variant hook and its path type", () => {
    expect(store).toContain('export type SampleVariantPath = | "pay";');
    expect(store).toContain("export const useSampleVariant = (path: SampleVariantPath)");
  });

  it("emits none of it for a form without a union", () => {
    expect(storeFor([field(["name"], { kind: "string" })])).not.toMatch(/unions|Variant/);
  });
});

describe("a field two branches both declare", () => {
  // `pay.pan` is a required string in one branch and optional in the other.
  const form: FormIR = { name: "Sample", fields: kitchenSink, diagnostics: [] };
  const output = zustandAdapter({ form, schemaModule: "schema", schemaExport: "sampleSchema" });
  const store = (output.files[0]?.content ?? "").replace(/\s+/g, " ");

  it("appears once in its path union and once in a table", () => {
    // Twice in a union is noise; twice in an object literal does not compile.
    expect(store.match(/\| "pay\.pan"/g)).toHaveLength(1);
    expect(store.match(/"pay\.pan": /g)).toHaveLength(1);
  });

  it("warns that the branches disagree, naming the blank that was chosen", () => {
    const warning = output.diagnostics.find((entry) => entry.code === "emit/branch-conflict");

    expect(warning?.path).toEqual(["pay", "pan"]);
    expect(warning?.message).toMatch(/"pay\.pan" with different blank values/);
    // The warning and the generated table have to agree on the outcome.
    expect(warning?.message).toMatch(/writes undefined\.$/);
    expect(store).toContain('"pay.pan": undefined,');
  });

  it("says nothing when the branches agree", () => {
    const agreeing = kitchenSink.filter((entry) => entry.path[0] !== "pay");
    const quiet = zustandAdapter({
      form: { name: "Sample", fields: agreeing, diagnostics: [] },
      schemaModule: "schema",
      schemaExport: "sampleSchema",
    });

    expect(quiet.diagnostics).toEqual([]);
  });
});

describe("the field tables", () => {
  const store = storeFor(kitchenSink);

  it("lists only the blanks that differ from the kind's default", () => {
    // `name` (text, blanks to "") and `age` (number, blanks to undefined) are
    // the defaults, so neither appears.
    expect(store).toContain(
      'const emptyValues: Dict<null | undefined> = { nickname: undefined, middle: null, score: null, "contacts.*.phone": undefined, "pay.pan": undefined, };',
    );
  });

  it("records how each non-trivial date is stored", () => {
    expect(store).toContain(
      'const dateEncodings: Dict<DateEncoding> = { at: "iso-datetime", born: "date", };',
    );
  });

  it("seeds a new row from the row fields' own defaults", () => {
    expect(store).toContain(
      'const blankRows: Dict<unknown> = { contacts: { name: "", phone: undefined, qty: 1 }, };',
    );
  });
});

// A project with `noUnusedLocals` rejects a helper nothing calls, so each
// piece of runtime must appear only when the form uses it.
describe("conditional emission", () => {
  it("emits only the boolean hook for a form of switches", () => {
    const store = storeFor([field(["terms"], { kind: "boolean" })]);

    expect(store).toContain("export const useSampleBoolean");
    expect(store).not.toMatch(/useSampleText|useSampleNumber|useSampleChoice|useSampleDate/);
    expect(store).not.toMatch(/emptyValues|patternOf|parseNumber|dateToText|blankRows|rowIds/);
    expect(store).not.toContain('from "react"');
  });

  it("pulls in React state only when a number field needs to hold typed text", () => {
    expect(storeFor([field(["name"], { kind: "string" })])).not.toContain('from "react"');
    expect(storeFor([field(["age"], { kind: "number", integer: true })])).toContain(
      'import { useState } from "react";',
    );
  });

  it("emits list plumbing only when there is a list", () => {
    const flat = storeFor([field(["name"], { kind: "string" })]);
    const listed = storeFor([field(["tags"], { kind: "array", of: { kind: "string" } })]);

    expect(flat).not.toMatch(/appendRow|removeRow|ListHandle|idsFor/);
    expect(listed).toMatch(/appendRow: \(path: SampleListPath\) => void;/);
    expect(listed).toContain("export const useSampleList");
  });

  it("still emits a usable store when nothing in the form can be bound", () => {
    const store = storeFor([field(["meta"], { kind: "unsupported", reason: "no shape" })]);

    expect(store).toContain("export const useSampleStore");
    expect(store).toContain("export const useSampleForm");
    // No control and no list means nothing reads by path.
    expect(store).not.toContain("const getAt");
    expect(store).not.toContain("FieldHandle");
  });
});

describe("the binding", () => {
  it("advertises exactly the names the store declares", () => {
    const form: FormIR = { name: "Sample", fields: kitchenSink, diagnostics: [] };
    const { binding, files } = zustandAdapter({
      form,
      schemaModule: "schema",
      schemaExport: "sampleSchema",
    });
    const store = files[0]?.content ?? "";
    const advertised = [
      ...Object.values(binding.hooks).flatMap((hook) => [hook.name, hook.pathType]),
      binding.list.name,
      binding.list.pathType,
      binding.variant.name,
      binding.variant.pathType,
      binding.form,
      binding.dataType,
      binding.optionType,
      ...binding.publicValues,
      ...binding.publicTypes,
    ];

    // The UI adapter imports these by name; one the store does not export
    // would be a broken import in generated code.
    expect(
      advertised.filter((name) => !new RegExp(`export (const|type) ${name}\\b`).test(store)),
    ).toEqual([]);
    expect(Object.keys(binding.imports).every((name) => advertised.includes(name))).toBe(true);
  });
});
