import type { FieldNode, ListField, Variant, VariantField } from "@formation/core";
import { isIdentifier, isListField, rowField, variantFieldOf } from "@formation/core";

/**
 * A form's *working* values: what their type is, and what a blank form starts
 * as.
 *
 * These are deliberately not the schema's input type. A form begins empty, and
 * "empty" has no honest spelling for a required number or a required choice —
 * so the working type admits `undefined` there, the form starts with it, and
 * validation reports the gap. The alternative (starting a required number at
 * `0`) submits a value the user never entered.
 */

/**
 * Which blank a field that is both optional and nullable holds — the one case
 * where the schema accepts two, so "blank" has no single right answer.
 *
 * It is a parameter rather than a constant because a state library may already
 * answer it. formstand's `useField` says `undefined`; a store this generator
 * writes itself has no opinion and gets `null`, on the reasoning that an API
 * which bothered to declare a field nullable wants to be sent the null. An
 * adapter must use one policy for everything it emits: the blank a form starts
 * with and the blank a cleared control writes have to be the same value, or
 * typing into a field and deleting it again leaves the form reading as edited.
 */
export type BlankPolicy = "prefer-null" | "prefer-undefined";

const lastSegment = (field: FieldNode): string => field.path[field.path.length - 1] ?? "";

const key = (name: string): string => (isIdentifier(name) ? name : JSON.stringify(name));

/** `null` or `undefined`: what "no value" is for a field, where it is not `""`. */
const emptyOf = (field: FieldNode, policy: BlankPolicy): null | undefined =>
  field.nullable && !(field.optional && policy === "prefer-undefined") ? null : undefined;

/**
 * What a cleared control writes back, and what a blank field starts as:
 * `null` or `undefined` as the schema allows — except a required string, which
 * stays `""` because that is a value the schema can judge, where `undefined`
 * would trade it for a type error the user cannot act on.
 */
export const blankOf = (field: FieldNode, policy: BlankPolicy): unknown => {
  switch (field.shape.kind) {
    case "string":
      return field.nullable || field.optional ? emptyOf(field, policy) : "";
    case "number":
    case "enum":
    case "date":
    case "file":
    case "union":
    case "unsupported":
      return emptyOf(field, policy);
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return Object.fromEntries(
        field.shape.fields.map((child) => [lastSegment(child), initialOf(child, policy)]),
      );
  }
};

/**
 * A schema default seeds the form only when it is a plain value of the field's
 * own kind. Anything else (an object default, a number on a string field) is
 * ignored rather than trusted: a wrong-typed initial value would sit in a
 * control that cannot display it.
 */
const usableDefault = (field: FieldNode): readonly [unknown] | undefined => {
  const value = field.defaultValue;

  switch (field.shape.kind) {
    case "string":
      return typeof value === "string" ? [value] : undefined;
    case "number":
      return typeof value === "number" &&
        Number.isFinite(value) &&
        (!field.shape.integer || Number.isInteger(value))
        ? [value]
        : undefined;
    case "boolean":
      return typeof value === "boolean" ? [value] : undefined;
    case "enum":
      return field.shape.options.some((option) => option.value === value) ? [value] : undefined;
    case "date":
      // A `Date` default has no source literal to print, so only ISO text seeds.
      return field.shape.encoding === "iso-string" && typeof value === "string"
        ? [value]
        : undefined;
    case "file":
    case "array":
    case "object":
    case "union":
    case "unsupported":
      return undefined;
  }
};

export const initialOf = (field: FieldNode, policy: BlankPolicy): unknown => {
  const seeded = usableDefault(field);

  return seeded === undefined ? blankOf(field, policy) : seeded[0];
};

/**
 * What a union becomes when one of its branches is chosen: the branch's tag,
 * and every other field of that branch blank. Fields of the branch that was
 * active before are deliberately not carried over — they are not part of this
 * branch's shape, and a strict schema would reject them.
 */
export const blankVariantOf = (
  union: VariantField,
  variant: Variant,
  policy: BlankPolicy,
): unknown => ({
  [union.discriminator]: variant.tag,
  ...Object.fromEntries(
    variant.fields.map((child) => [lastSegment(child), initialOf(child, policy)]),
  ),
});

/** What `append` adds to a list. */
export const blankRowOf = (list: ListField, policy: BlankPolicy): unknown =>
  initialOf(rowField(list), policy);

const literalType = (value: string | number): string =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

/**
 * The blank's own type, as a suffix. Under `prefer-undefined` an optional and
 * nullable field admits both: it starts `undefined`, and `null` is still what
 * an edit form seeded from the server may hand it.
 */
const blankType = (field: FieldNode, policy: BlankPolicy): string =>
  !field.nullable
    ? " | undefined"
    : field.optional && policy === "prefer-undefined"
      ? " | null | undefined"
      : " | null";

/** The working type of one field, with the blank representation `blankOf` uses folded in. */
export const typeOf = (field: FieldNode, policy: BlankPolicy): string => {
  const blank = blankType(field, policy);

  switch (field.shape.kind) {
    case "string":
      return field.nullable || field.optional ? `string${blank}` : "string";
    case "number":
      return `number${blank}`;
    case "enum":
      return `${field.shape.options.map((option) => literalType(option.value)).join(" | ")}${blank}`;
    case "date":
      return `${field.shape.encoding === "date-object" ? "Date" : "string"}${blank}`;
    case "boolean":
      return "boolean";
    case "array": {
      const row = isListField(field) ? typeOf(rowField(field), policy) : "unknown";

      return `readonly (${row})[]`;
    }
    case "object":
      return objectType(field.shape.fields, policy);
    case "union": {
      const union = variantFieldOf(field);

      // A union the generator cannot offer as a choice is typed like any other
      // field it could not model: wide, so nothing pretends to know its shape.
      return union === undefined
        ? "unknown"
        : `${union.variants.map((variant) => variantType(union, variant, policy)).join(" | ")}${blank}`;
    }
    // Left wide on purpose: nothing generated reads these, and a precise type
    // would be a guess about a shape ingest already said it could not model.
    case "file":
    case "unsupported":
      return "unknown";
  }
};

/** One branch as an object type whose tag is its literal, so narrowing on the tag works. */
const variantType = (union: VariantField, variant: Variant, policy: BlankPolicy): string =>
  `Readonly<{\n${key(union.discriminator)}: ${literalType(variant.tag)};\n${variant.fields
    .map((child) => `${key(lastSegment(child))}: ${typeOf(child, policy)};`)
    .join("\n")}\n}>`;

export const objectType = (fields: readonly FieldNode[], policy: BlankPolicy): string =>
  fields.length === 0
    ? "Readonly<Record<string, never>>"
    : `Readonly<{\n${fields.map((field) => `${key(lastSegment(field))}: ${typeOf(field, policy)};`).join("\n")}\n}>`;

/** A runtime value as source text. Only the JSON-ish values `initialOf` can produce. */
export const printValue = (value: unknown): string =>
  value === undefined
    ? "undefined"
    : value === null || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : typeof value === "string"
        ? JSON.stringify(value)
        : Array.isArray(value)
          ? `[${value.map(printValue).join(", ")}]`
          : `{ ${Object.entries(value as Readonly<Record<string, unknown>>)
              .map(([name, entry]) => `${key(name)}: ${printValue(entry)}`)
              .join(", ")} }`;

export const initialValuesOf = (fields: readonly FieldNode[], policy: BlankPolicy): string =>
  printValue(
    Object.fromEntries(fields.map((field) => [lastSegment(field), initialOf(field, policy)])),
  );
