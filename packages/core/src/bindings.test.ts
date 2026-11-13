import { describe, expect, it } from "vitest";

import { collectBindings, mustBeFilled, pathTypeText, variantFieldOf } from "./bindings.js";
import type { FieldNode } from "./form-ir.js";

const field = (
  path: readonly string[],
  shape: FieldNode["shape"],
  flags: Partial<Pick<FieldNode, "optional" | "nullable">> = {},
): FieldNode => ({
  path,
  label: path[path.length - 1] ?? "",
  optional: false,
  nullable: false,
  ...flags,
  shape,
});

describe("collectBindings", () => {
  const fields = [
    field(["email"], { kind: "string" }),
    field(["address"], {
      kind: "object",
      fields: [field(["address", "zip"], { kind: "string" })],
    }),
    field(["tags"], { kind: "array", of: { kind: "string" } }),
    field(["teams"], {
      kind: "array",
      of: {
        kind: "object",
        fields: [
          field(["teams", "*", "size"], { kind: "number", integer: true }),
          field(["teams", "*", "members"], { kind: "array", of: { kind: "string" } }),
        ],
      },
    }),
    field(["meta"], { kind: "unsupported", reason: "no shape" }),
  ];

  it("gives a list of scalars a control per row, addressed at the row itself", () => {
    const paths = collectBindings(fields).controls.map((control) => control.field.path.join("."));

    // `tags.*` and `teams.*.members.*` exist only as synthetic row nodes;
    // without them a list of strings would have nothing to bind.
    expect(paths).toEqual(["email", "address.zip", "tags.*", "teams.*.size", "teams.*.members.*"]);
  });

  it("finds lists at every depth, outermost first", () => {
    expect(collectBindings(fields).lists.map((list) => list.path.join("."))).toEqual([
      "tags",
      "teams",
      "teams.*.members",
    ]);
  });

  it("keeps a field with no control instead of dropping it", () => {
    expect(collectBindings(fields).unbound.map((entry) => entry.path.join("."))).toEqual(["meta"]);
  });
});

describe("discriminated unions", () => {
  const pin = (tag: string | number): FieldNode =>
    field(["pay", "kind"], { kind: "enum", options: [{ value: tag, label: String(tag) }] });
  const branch = (tag: string | number, extra: FieldNode): FieldNode["shape"] => ({
    kind: "object",
    fields: [pin(tag), extra],
  });
  const pay = field(["pay"], {
    kind: "union",
    discriminator: "kind",
    variants: [
      branch("card", field(["pay", "pan"], { kind: "string" })),
      branch("bank", field(["pay", "iban"], { kind: "string" })),
    ],
  });

  it("reads each branch's tag and takes the discriminator out of its fields", () => {
    expect(variantFieldOf(pay)?.variants).toMatchObject([
      { tag: "card", fields: [{ path: ["pay", "pan"] }] },
      { tag: "bank", fields: [{ path: ["pay", "iban"] }] },
    ]);
  });

  it("binds the union as a variant and its branch fields as ordinary controls", () => {
    const bindings = collectBindings([pay]);

    expect(bindings.variants.map((entry) => entry.field.path.join("."))).toEqual(["pay"]);
    // The discriminator is not a control of its own: the variant picker owns it.
    expect(bindings.controls.map((control) => control.field.path.join("."))).toEqual([
      "pay.pan",
      "pay.iban",
    ]);
    expect(bindings.unbound).toEqual([]);
  });

  it("refuses a union it cannot offer as a choice, leaving it unbound", () => {
    const noDiscriminator = field(["a"], { kind: "union", variants: [{ kind: "string" }] });
    // Two branches claiming the same tag would be two options that mean one thing.
    const sameTag = field(["b"], {
      kind: "union",
      discriminator: "kind",
      variants: [
        branch("card", field(["b", "x"], { kind: "string" })),
        branch("card", field(["b", "y"], { kind: "string" })),
      ],
    });
    // A branch that leaves the discriminator open cannot be selected by it.
    const openTag = field(["c"], {
      kind: "union",
      discriminator: "kind",
      variants: [{ kind: "object", fields: [field(["c", "kind"], { kind: "string" })] }],
    });

    expect([noDiscriminator, sameTag, openTag].map(variantFieldOf)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(collectBindings([noDiscriminator]).unbound).toHaveLength(1);
  });

  it("counts a required union with no branch chosen as a gap", () => {
    expect(mustBeFilled(pay)).toBe(true);
    expect(mustBeFilled({ ...pay, optional: true })).toBe(false);
  });
});

describe("pathTypeText", () => {
  it("is a string literal type for a static path", () => {
    expect(pathTypeText(["address", "zip"])).toBe('"address.zip"');
  });

  it("types row positions as ${number} so a row path still checks its field name", () => {
    expect(pathTypeText(["teams", "*", "members", "*"])).toBe(
      "`teams.${number}.members.${number}`",
    );
  });
});

describe("mustBeFilled", () => {
  it("does not mark a required string that accepts an empty value", () => {
    // The asterisk promises an error on blank; with no minimum length there is none.
    expect(mustBeFilled(field(["note"], { kind: "string" }))).toBe(false);
    expect(mustBeFilled(field(["name"], { kind: "string", min: { value: 1 } }))).toBe(true);
    expect(mustBeFilled(field(["email"], { kind: "string", format: "email" }))).toBe(true);
  });

  it("treats a blank number as a gap unless the schema allows it", () => {
    const age = { kind: "number", integer: true } as const;

    expect(mustBeFilled(field(["age"], age))).toBe(true);
    expect(mustBeFilled(field(["age"], age, { optional: true }))).toBe(false);
    expect(mustBeFilled(field(["age"], age, { nullable: true }))).toBe(false);
  });
});
