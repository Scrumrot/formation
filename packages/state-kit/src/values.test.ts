import type { FieldNode } from "@formation/core";
import { describe, expect, it } from "vitest";

import type { BlankPolicy } from "./values.js";
import { blankOf, initialValuesOf, typeOf } from "./values.js";

const field = (
  shape: FieldNode["shape"],
  extra: Partial<Pick<FieldNode, "optional" | "nullable" | "defaultValue">> = {},
): FieldNode => ({
  path: ["value"],
  label: "Value",
  optional: false,
  nullable: false,
  ...extra,
  shape,
});

const number: FieldNode["shape"] = { kind: "number", integer: false };
const text: FieldNode["shape"] = { kind: "string" };
const policies: readonly BlankPolicy[] = ["prefer-null", "prefer-undefined"];

describe("where the schema leaves one honest blank, both policies give it", () => {
  it.each(policies)("%s: a required string stays an empty string", (policy) => {
    expect(blankOf(field(text), policy)).toBe("");
    expect(typeOf(field(text), policy)).toBe("string");
  });

  it.each(policies)("%s: a required number has no value yet", (policy) => {
    expect(blankOf(field(number), policy)).toBeUndefined();
    expect(typeOf(field(number), policy)).toBe("number | undefined");
  });

  it.each(policies)("%s: an optional field is absent", (policy) => {
    expect(blankOf(field(text, { optional: true }), policy)).toBeUndefined();
    expect(blankOf(field(number, { optional: true }), policy)).toBeUndefined();
  });

  it.each(policies)("%s: a nullable, required field is null", (policy) => {
    expect(blankOf(field(text, { nullable: true }), policy)).toBeNull();
    expect(blankOf(field(number, { nullable: true }), policy)).toBeNull();
    expect(typeOf(field(number, { nullable: true }), policy)).toBe("number | null");
  });
});

describe("an optional and nullable field, where the schema accepts either", () => {
  const both = { optional: true, nullable: true };

  it("is null when the generator decides", () => {
    expect(blankOf(field(number, both), "prefer-null")).toBeNull();
    expect(blankOf(field(text, both), "prefer-null")).toBeNull();
    expect(typeOf(field(number, both), "prefer-null")).toBe("number | null");
  });

  it("is undefined under formstand's rule, with null still a legal value to hold", () => {
    expect(blankOf(field(number, both), "prefer-undefined")).toBeUndefined();
    expect(blankOf(field(text, both), "prefer-undefined")).toBeUndefined();
    // An edit form seeded from the server may well be handed the null.
    expect(typeOf(field(number, both), "prefer-undefined")).toBe("number | null | undefined");
  });

  it("starts the form on the same blank, so clearing a field is a round trip", () => {
    expect(initialValuesOf([field(number, both)], "prefer-null")).toBe("{ value: null }");
    expect(initialValuesOf([field(number, both)], "prefer-undefined")).toBe("{ value: undefined }");
  });
});

describe("a schema default", () => {
  it.each(policies)("%s: seeds the form ahead of any blank", (policy) => {
    expect(
      initialValuesOf([field(number, { optional: true, nullable: true, defaultValue: 3 })], policy),
    ).toBe("{ value: 3 }");
  });
});
