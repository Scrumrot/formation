import type { FieldNode, FormIR } from "@formation/core";
import { describe, expect, it } from "vitest";

import { fromJsonSchema } from "./from-json-schema.js";

const ingest = (document: unknown, select?: string): FormIR => {
  const outcome = fromJsonSchema(document, select === undefined ? {} : { select });

  if (outcome.kind === "failed") {
    throw new Error(outcome.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  }
  return outcome.value;
};

const fieldAt = (form: FormIR, name: string): FieldNode => {
  const found = form.fields.find((field) => field.path.join(".") === name);

  if (found === undefined) throw new Error(`no field "${name}"`);
  return found;
};

const object = (properties: Record<string, unknown>, required: readonly string[] = []) => ({
  type: "object",
  properties,
  required,
});

describe("scalars and constraints", () => {
  const form = ingest(
    object(
      {
        name: { type: "string", minLength: 2, maxLength: 40, title: "Full name" },
        email: { type: "string", format: "email", description: "Work address." },
        age: { type: "integer", minimum: 18 },
        score: { type: "number", exclusiveMinimum: 0, maximum: 10, multipleOf: 0.5 },
        legacy: { type: "number", minimum: 1, exclusiveMinimum: true },
        active: { type: "boolean", default: true },
        born: { type: "string", format: "date" },
        seen: { type: "string", format: "date-time" },
      },
      ["name"],
    ),
  );

  it("keeps property order, since that is the order the form renders in", () => {
    expect(form.fields.map((field) => field.path[0])).toEqual([
      "name",
      "email",
      "age",
      "score",
      "legacy",
      "active",
      "born",
      "seen",
    ]);
  });

  it("derives optionality from `required`, and labels from `title` then the key", () => {
    expect(fieldAt(form, "name")).toMatchObject({ optional: false, label: "Full name" });
    expect(fieldAt(form, "email")).toMatchObject({
      optional: true,
      label: "Email",
      description: "Work address.",
    });
  });

  it("carries string and number bounds", () => {
    expect(fieldAt(form, "name").shape).toEqual({
      kind: "string",
      min: { value: 2 },
      max: { value: 40 },
    });
    expect(fieldAt(form, "age").shape).toEqual({
      kind: "number",
      integer: true,
      min: { value: 18 },
    });
  });

  it("keeps an exclusive bound exclusive, in both the 2020-12 and draft-04 spellings", () => {
    expect(fieldAt(form, "score").shape).toEqual({
      kind: "number",
      integer: false,
      min: { value: 0, exclusive: true },
      max: { value: 10 },
      step: 0.5,
    });
    expect(fieldAt(form, "legacy").shape).toMatchObject({ min: { value: 1, exclusive: true } });
  });

  it("reads date formats as dates stored as ISO text", () => {
    expect(fieldAt(form, "born").shape).toEqual({
      kind: "date",
      time: false,
      encoding: "iso-string",
    });
    expect(fieldAt(form, "seen").shape).toMatchObject({ kind: "date", time: true });
  });

  it("keeps a schema default", () => {
    expect(fieldAt(form, "active").defaultValue).toBe(true);
  });
});

describe("nullable, in every dialect's spelling", () => {
  const form = ingest(
    object({
      a: { type: ["string", "null"] },
      b: { type: "string", nullable: true },
      c: { anyOf: [{ type: "number" }, { type: "null" }] },
      d: { oneOf: [{ $ref: "#/$defs/Tag" }, { type: "null" }], description: "On the use." },
      e: { type: "string", enum: ["x", "y", null] },
      f: { type: "string" },
    }),
  );

  it("recognises all five", () => {
    const withDefs = ingest({
      ...object({
        a: { type: ["string", "null"] },
        b: { type: "string", nullable: true },
        c: { anyOf: [{ type: "number" }, { type: "null" }] },
        d: { oneOf: [{ $ref: "#/$defs/Tag" }, { type: "null" }], description: "On the use." },
        e: { type: "string", enum: ["x", "y", null] },
        f: { type: "string" },
      }),
      $defs: { Tag: { type: "string", description: "On the target." } },
    });

    expect(withDefs.fields.map((field) => field.nullable)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    // A keyword beside the reference describes this use, so it wins.
    expect(fieldAt(withDefs, "d")).toMatchObject({
      description: "On the use.",
      shape: { kind: "string" },
    });
    // The null is the nullability, not one of the choices.
    expect(fieldAt(withDefs, "e").shape).toMatchObject({
      kind: "enum",
      options: [{ value: "x" }, { value: "y" }],
    });
  });

  it("degrades a reference that points at nothing instead of dropping the field", () => {
    expect(fieldAt(form, "d").shape.kind).toBe("unsupported");
    expect(form.diagnostics.some((entry) => entry.code === "schema/ref-unresolved")).toBe(true);
  });
});

describe("choices", () => {
  const form = ingest(
    object({
      plain: { type: "string", enum: ["small", "extra_large"] },
      titled: {
        oneOf: [
          { const: "USD", title: "US dollar" },
          { const: "EUR", title: "Euro" },
        ],
      },
      numeric: { type: "integer", enum: [1, 2], "x-enumNames": ["Low", "High"] },
      pinned: { const: "v1" },
      flags: { enum: [true, false] },
    }),
  );

  it("labels values from the value, a `oneOf` title, or x-enumNames", () => {
    expect(fieldAt(form, "plain").shape).toEqual({
      kind: "enum",
      options: [
        { value: "small", label: "Small" },
        { value: "extra_large", label: "Extra Large" },
      ],
    });
    expect(fieldAt(form, "titled").shape).toMatchObject({
      options: [
        { value: "USD", label: "US dollar" },
        { value: "EUR", label: "Euro" },
      ],
    });
    expect(fieldAt(form, "numeric").shape).toMatchObject({
      options: [
        { value: 1, label: "Low" },
        { value: 2, label: "High" },
      ],
    });
  });

  it("treats `const` as a one-option choice and a boolean enum as a boolean", () => {
    expect(fieldAt(form, "pinned").shape).toMatchObject({
      kind: "enum",
      options: [{ value: "v1" }],
    });
    expect(fieldAt(form, "flags").shape).toEqual({ kind: "boolean" });
  });
});

describe("structure", () => {
  const document = {
    ...object({
      owner: { $ref: "#/$defs/Owner" },
      lines: { type: "array", minItems: 1, items: { $ref: "#/$defs/Line" } },
      tags: { type: "array", items: { type: "string" } },
      tree: { $ref: "#/$defs/Tree" },
    }),
    $defs: {
      Person: object({ name: { type: "string" } }, ["name"]),
      Owner: {
        allOf: [{ $ref: "#/$defs/Person" }, object({ email: { type: "string" } }, ["email"])],
      },
      Line: object({ sku: { type: "string" } }, ["sku"]),
      Tree: object({ value: { type: "string" }, left: { $ref: "#/$defs/Tree" } }),
    },
  };
  const form = ingest(document);

  it("merges allOf of objects into one section: properties and required lists both", () => {
    const owner = fieldAt(form, "owner");

    expect(owner.shape.kind === "object" && owner.shape.fields).toMatchObject([
      { path: ["owner", "name"], optional: false },
      { path: ["owner", "email"], optional: false },
    ]);
  });

  it("addresses fields inside list rows through the any-row marker", () => {
    const lines = fieldAt(form, "lines");

    expect(lines.shape).toMatchObject({
      kind: "array",
      min: { value: 1 },
      of: { kind: "object", fields: [{ path: ["lines", "*", "sku"] }] },
    });
    expect(fieldAt(form, "tags").shape).toEqual({ kind: "array", of: { kind: "string" } });
  });

  it("cuts a recursive reference off with a stub rather than recursing forever", () => {
    const tree = fieldAt(form, "tree");
    const left =
      tree.shape.kind === "object"
        ? tree.shape.fields.find((child) => child.path.join(".") === "tree.left")
        : undefined;

    expect(left?.shape).toMatchObject({ kind: "unsupported" });
    expect(left?.shape.kind === "unsupported" && left.shape.reason).toMatch(/recursive/);
  });
});

describe("unions", () => {
  const variant = (tag: string, extra: string) =>
    object({ kind: { const: tag }, [extra]: { type: "string" } }, ["kind"]);

  it("finds the discriminator when every branch pins the same property", () => {
    const form = ingest(
      object({ pay: { oneOf: [variant("card", "pan"), variant("bank", "iban")] } }),
    );

    expect(fieldAt(form, "pay").shape).toMatchObject({
      kind: "union",
      discriminator: "kind",
      variants: [{ kind: "object" }, { kind: "object" }],
    });
  });

  it("honors an OpenAPI discriminator", () => {
    const form = ingest(
      object({
        pay: {
          oneOf: [variant("card", "pan"), variant("bank", "iban")],
          discriminator: { propertyName: "kind" },
        },
      }),
    );

    expect(fieldAt(form, "pay").shape).toMatchObject({ discriminator: "kind" });
  });

  it("degrades alternatives with nothing to choose between them", () => {
    const form = ingest(object({ value: { anyOf: [{ type: "string" }, { type: "number" }] } }));

    expect(fieldAt(form, "value").shape.kind).toBe("unsupported");
  });
});

describe("what cannot be represented", () => {
  const form = ingest(
    object({
      record: { type: "object", additionalProperties: { type: "string" } },
      tuple: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] },
      anything: {},
      external: { $ref: "other.json#/Thing" },
      "dotted.key": { type: "string" },
      "0": { type: "string" },
    }),
  );

  it("keeps every such field as an unsupported node", () => {
    // Six properties in, six fields out: a field missing from the form would
    // be a field missing from what gets submitted.
    expect(form.fields).toHaveLength(6);
    expect(form.fields.every((field) => field.shape.kind === "unsupported")).toBe(true);
  });

  it("raises one diagnostic per field, at that field's path", () => {
    const paths = form.diagnostics
      .filter((entry) => entry.severity === "warning")
      .map((entry) => entry.path?.join("/"));

    expect(paths.sort()).toEqual(["0", "anything", "dotted.key", "external", "record", "tuple"]);
  });
});

describe("advisories", () => {
  it("notes, once, the required strings that will accept an empty value", () => {
    const form = ingest(
      object(
        { a: { type: "string" }, b: { type: "string", minLength: 1 }, c: { type: "string" } },
        ["a", "b"],
      ),
    );
    const notes = form.diagnostics.filter((entry) => entry.code === "schema/blank-allowed");

    expect(notes).toHaveLength(1);
    // `b` has a minimum length and `c` is optional, so only `a` is at issue.
    expect(notes[0]?.message).toMatch(/1 required text field accepts an empty string.*: a\./);
  });

  it("masks a field named like a password even when the schema sets no format", () => {
    const form = ingest(object({ confirmPassword: { type: "string" }, note: { type: "string" } }));

    expect(fieldAt(form, "confirmPassword").shape).toMatchObject({ format: "password" });
    expect(fieldAt(form, "note").shape).toEqual({ kind: "string" });
  });
});

describe("choosing the schema", () => {
  const openapi = {
    openapi: "3.0.3",
    paths: {
      "/pets": {
        post: {
          requestBody: {
            content: { "application/json": { schema: object({ viaPointer: { type: "string" } }) } },
          },
        },
      },
    },
    components: {
      schemas: {
        Pet: object({ name: { type: "string" } }),
        Owner: object({ phone: { type: "string" } }),
      },
    },
  };

  it("picks a component schema by name and names the form after it", () => {
    const form = ingest(openapi, "Owner");

    expect(form.name).toBe("Owner");
    expect(form.fields.map((field) => field.path[0])).toEqual(["phone"]);
  });

  it("reaches a request body by JSON pointer, escaped slashes included", () => {
    const form = ingest(
      openapi,
      "#/paths/~1pets/post/requestBody/content/application~1json/schema",
    );

    expect(form.fields.map((field) => field.path[0])).toEqual(["viaPointer"]);
  });

  it("refuses to guess among several schemas, and lists them", () => {
    const outcome = fromJsonSchema(openapi);

    expect(outcome.kind).toBe("failed");
    expect(outcome.diagnostics[0]?.message).toMatch(/holds 2 schemas.*"Pet", "Owner"/);
  });

  it("uses the only schema without being told", () => {
    const single = {
      openapi: "3.1.0",
      components: { schemas: { Pet: openapi.components.schemas.Pet } },
    };

    expect(ingest(single).name).toBe("Pet");
  });

  it("does not find prototype members when asked for a name like `constructor`", () => {
    const outcome = fromJsonSchema(openapi, { select: "constructor" });

    expect(outcome.kind).toBe("failed");
    expect(outcome.diagnostics[0]?.message).toMatch(/No schema named "constructor"/);
  });

  it("strips a Schema/Form suffix so the component is not ProfileSchemaForm", () => {
    const named = (name: string): string =>
      ingest({ ...object({ a: { type: "string" } }), title: name }).name;

    expect([named("profileSchema"), named("signup_form"), named("Order")]).toEqual([
      "Profile",
      "Signup",
      "Order",
    ]);
  });

  it("fails on a root that is not an object, since a form needs fields", () => {
    const outcome = fromJsonSchema({ type: "string" });

    expect(outcome.kind).toBe("failed");
    expect(outcome.diagnostics[0]?.code).toBe("schema/unreadable");
  });
});
