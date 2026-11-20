import type { FieldNode, FormIR } from "@formation/core";
import { describe, expect, it } from "vitest";

import { reactHookFormAdapter } from "./index.js";

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

  return reactHookFormAdapter({ form, schemaModule: "schema", schemaExport: "sampleSchema" });
};

// Whitespace is Prettier's job downstream, so assertions ignore it.
const moduleFor = (fields: readonly FieldNode[]): string =>
  (adapt(fields).files[0]?.content ?? "").replace(/\s+/g, " ");

const kitchenSink = [
  field(["name"], { kind: "string" }),
  field(["nickname"], { kind: "string" }, { optional: true }),
  field(["age"], { kind: "number", integer: true }),
  field(["score"], { kind: "number", integer: false }, { optional: true, nullable: true }),
  field(["role"], { kind: "enum", options: [{ value: "admin", label: "Admin" }] }),
  field(["agree"], { kind: "boolean" }),
  field(["born"], { kind: "date", time: false, encoding: "date-object" }),
  field(["tags"], { kind: "array", of: { kind: "string" } }),
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

describe("the form", () => {
  const source = moduleFor(kitchenSink);

  it("is created outside React, so the hooks need no provider", () => {
    expect(source).toContain(
      "export const sampleForm = createFormControl<SampleValues, unknown, SampleData>({",
    );
    expect(source).toContain("defaultValues: sampleInitialValues,");
    expect(source).not.toContain("FormProvider");
    expect(source).not.toContain("useFormContext");
  });

  it("validates with the schema through the zod resolver", () => {
    expect(source).toContain('import { zodResolver } from "@hookform/resolvers/zod";');
    // Working values are looser than the schema's input; this cast is the one
    // place the two are reconciled.
    expect(source).toContain(
      "const resolver = zodResolver(sampleSchema) as unknown as Resolver< SampleValues, unknown, SampleData >;",
    );
  });

  it("holds errors back until a field is left", () => {
    expect(source).toContain('const MODE = "onTouched";');
  });

  it("is connected to React by the form hook, with its options handed over again", () => {
    // `useForm` resets any option it is not given; without these the module's
    // form would lose its resolver the first time the component rendered.
    expect(source).toContain(
      "useForm<SampleValues, unknown, SampleData>({ formControl: sampleForm.formControl, resolver, mode: MODE, });",
    );
  });

  it("is what the binding advertises as the form's public handle", () => {
    const { binding } = adapt(kitchenSink);

    expect(binding.module).toBe("form");
    expect(binding.publicValues).toEqual(["sampleForm", "useSampleForm", "sampleInitialValues"]);
  });
});

describe("the field hooks", () => {
  const source = moduleFor(kitchenSink);

  it("bind controlled inputs through useController, by plain string", () => {
    expect(source).toContain(
      "const { field, fieldState } = useController({ control: untyped.control, name: path });",
    );
  });

  it("keep the contract's path types, not a bare string", () => {
    expect(source).toContain(
      "export const useSampleText = (path: SampleTextPath): FieldHandle<string>",
    );
    expect(source).toContain('| "pay.pan"');
  });

  it("release a server error when the field is edited", () => {
    expect(source).toContain('if (fieldState.error?.type === "server") untyped.clearErrors(path);');
  });

  it("clear to the generator's blanks, react-hook-form having none of its own", () => {
    expect(source).toContain(
      "const emptyValues: Dict<null | undefined> = { nickname: undefined, score: null, };",
    );
    expect(source).toContain("score: null,");
    expect(source).toContain('change(text === "" ? emptyOf(path, "") : text)');
  });
});

describe("the list hook", () => {
  const source = moduleFor(kitchenSink);

  it("does not use useFieldArray, which drops blank rows", () => {
    // `tags` is a list of strings whose blank row is "". react-hook-form's
    // field arrays filter falsy rows out on every operation.
    expect(source).not.toContain("useFieldArray(");
    expect(source).toContain('const blankRows: Dict<unknown> = { tags: "", };');
  });

  it("subscribes to the row count only", () => {
    expect(source).toContain(
      "compute: (rows: unknown) => (Array.isArray(rows) ? rows.length : 0),",
    );
  });

  it("drops row-indexed errors when a row is removed", () => {
    expect(source).toContain(
      "untyped.clearErrors(path); write(keep(rowsNow()), keep(ids), keyed.next);",
    );
  });

  it("reads a list's own error from where the resolver files it", () => {
    expect(source).toContain("messageAt(errors, `${path}.root`) ?? messageAt(errors, path)");
  });
});

describe("the variant hook", () => {
  const source = moduleFor(kitchenSink);

  it("watches only the tag", () => {
    expect(source).toContain(
      "const tag: unknown = useWatch({ control: untyped.control, name: tagPath });",
    );
  });

  it("replaces the whole union, and drops what was said about the old one", () => {
    expect(source).toContain("untyped.clearErrors(path);");
    expect(source).toContain("untyped.setValue( path,");
    expect(source).toContain(
      'blanks: { card: { kind: "card", pan: "" }, bank: { kind: "bank", iban: "" } }',
    );
  });
});

describe("the form hook", () => {
  const source = moduleFor(kitchenSink);

  it("reads a form-level error from both places one can be filed", () => {
    // `root` for an error the app set; the empty key for a schema issue with
    // no path, which the path lookup cannot reach.
    expect(source).toContain('error: messageOf(errors.root) ?? messageOf(errors[""]),');
  });

  it("subscribes to form-level errors by name, not to every field's", () => {
    expect(source).toContain('useFormState({ control: untyped.control, name: "root" })');
  });
});

describe("a form that uses little", () => {
  const source = moduleFor([field(["agree"], { kind: "boolean" })]);

  it("imports only what it calls, so it compiles under noUnusedLocals", () => {
    expect(source).toContain(
      'import { createFormControl, type FieldValues, type Resolver, useController, useForm, type UseFormReturn, useFormState, } from "react-hook-form";',
    );
    expect(source).not.toContain("useState");
    expect(source).not.toContain("useWatch");
  });

  it("emits no tables and no lookups", () => {
    expect(source).not.toMatch(/Dict<|patternOf|emptyOf|blankRows|const unions/);
  });
});

describe("a form with no controls at all", () => {
  const source = moduleFor([field(["meta"], { kind: "unsupported", reason: "no shape" })]);

  it("still exports a form and its handle", () => {
    expect(source).toContain("export const sampleForm = createFormControl<");
    expect(source).toContain("export const useSampleForm = (): FormHandle =>");
    expect(source).not.toContain("useController");
  });

  it("says how to reach the field it could not bind", () => {
    expect(source).toContain("reach them with `sampleForm.getValues` and `sampleForm.setValue`");
  });
});
