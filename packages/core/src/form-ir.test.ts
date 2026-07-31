import { describe, expect, it } from "vitest";

import type { FieldNode, FormIR } from "./form-ir.js";
import { flattenFields, hasUnsupportedFields } from "./form-ir.js";

const field = (path: readonly string[], shape: FieldNode["shape"]): FieldNode => ({
  path,
  label: path[path.length - 1] ?? "",
  optional: false,
  shape,
});

describe("flattenFields", () => {
  it("yields nested object fields after their parent", () => {
    const fields = [
      field(["email"], { kind: "string", format: "email" }),
      field(["address"], {
        kind: "object",
        fields: [
          field(["address", "street"], { kind: "string" }),
          field(["address", "zip"], { kind: "string" }),
        ],
      }),
    ];

    expect(flattenFields(fields).map((f) => f.path.join("."))).toEqual([
      "email",
      "address",
      "address.street",
      "address.zip",
    ]);
  });

  it("descends into array element shapes", () => {
    const fields = [
      field(["items"], {
        kind: "array",
        of: {
          kind: "object",
          fields: [field(["items", "qty"], { kind: "number", integer: true })],
        },
      }),
    ];

    expect(flattenFields(fields).map((f) => f.path.join("."))).toEqual(["items", "items.qty"]);
  });
});

describe("hasUnsupportedFields", () => {
  it("finds an unsupported node nested inside an array of objects", () => {
    const form: FormIR = {
      name: "Order",
      diagnostics: [],
      fields: [
        field(["lines"], {
          kind: "array",
          of: {
            kind: "object",
            fields: [
              field(["lines", "meta"], { kind: "unsupported", reason: "z.custom() has no shape" }),
            ],
          },
        }),
      ],
    };

    expect(hasUnsupportedFields(form)).toBe(true);
  });
});
