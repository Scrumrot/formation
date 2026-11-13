import type {
  Bound,
  EnumOption,
  FieldNode,
  FieldShape,
  FormIR,
  StringFormat,
} from "@formation/core";
import { isIdentifier } from "@formation/core";

/**
 * FormIR → the source of a Zod (v4) schema.
 *
 * Needed whenever the input carried no runtime validator of its own: a JSON
 * Schema or an OpenAPI document describes the data but cannot check it, and
 * the generated store validates through Zod. A Zod *input* never comes through
 * here — its own schema is imported as-is, refinements and messages intact.
 *
 * Messages: the IR carries the author's wording when there was one. JSON
 * Schema has none, and Zod's defaults ("Too small: expected string to have
 * >=1 characters") are written for developers, not for the person filling in
 * the form — so every check gets a short synthesized message instead.
 */

const quote = (value: string): string => JSON.stringify(value);

const literal = (value: string | number): string =>
  typeof value === "string" ? quote(value) : String(value);

const key = (name: string): string => (isIdentifier(name) ? name : quote(name));

const lastSegment = (field: FieldNode): string => field.path[field.path.length - 1] ?? "";

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

const lowerBound = (bound: Bound): string =>
  bound.exclusive === true
    ? `.gt(${bound.value}, ${quote(bound.message?.text ?? `Must be greater than ${bound.value}`)})`
    : `.min(${bound.value}, ${quote(bound.message?.text ?? `Must be at least ${bound.value}`)})`;

const upperBound = (bound: Bound): string =>
  bound.exclusive === true
    ? `.lt(${bound.value}, ${quote(bound.message?.text ?? `Must be less than ${bound.value}`)})`
    : `.max(${bound.value}, ${quote(bound.message?.text ?? `Must be at most ${bound.value}`)})`;

// Exhaustive on purpose: a new StringFormat has to say here whether Zod has a
// validator for it. `undefined` means the format changes the control, not what
// counts as valid text.
const FORMAT_VALIDATORS: Readonly<Record<StringFormat, string | undefined>> = {
  email: `z.email(${quote("Enter a valid email address")})`,
  url: `z.url(${quote("Enter a valid URL")})`,
  uuid: `z.uuid(${quote("Enter a valid UUID")})`,
  password: undefined,
  phone: undefined,
  multiline: undefined,
  color: undefined,
};

const stringBase = (shape: Extract<FieldShape, { kind: "string" }>): string =>
  (shape.format === undefined ? undefined : FORMAT_VALIDATORS[shape.format]) ?? "z.string()";

const stringSchema = (shape: Extract<FieldShape, { kind: "string" }>): string => {
  const min = shape.min;
  const max = shape.max;
  const pattern = shape.pattern;

  return [
    stringBase(shape),
    min === undefined || min.value <= 0
      ? ""
      : `.min(${min.value}, ${quote(
          min.message?.text ??
            (min.value === 1 ? "Required" : `Must be at least ${plural(min.value, "character")}`),
        )})`,
    max === undefined
      ? ""
      : `.max(${max.value}, ${quote(max.message?.text ?? `Must be at most ${plural(max.value, "character")}`)})`,
    // `new RegExp(source)` rather than a `/literal/`: a JSON Schema pattern may
    // hold an unescaped `/`, which a literal would end early.
    pattern === undefined
      ? ""
      : `.regex(new RegExp(${quote(pattern.value)}), ${quote(pattern.message?.text ?? "Invalid format")})`,
  ].join("");
};

const numberSchema = (shape: Extract<FieldShape, { kind: "number" }>): string =>
  [
    // The message on the base type is what a blank required number reports:
    // the store holds `undefined` there, which fails the type check itself.
    `z.number(${quote("Enter a number")})`,
    shape.integer ? `.int(${quote("Must be a whole number")})` : "",
    shape.min === undefined ? "" : lowerBound(shape.min),
    shape.max === undefined ? "" : upperBound(shape.max),
    shape.step === undefined
      ? ""
      : `.multipleOf(${shape.step}, ${quote(`Must be a multiple of ${shape.step}`)})`,
  ].join("");

const enumSchema = (options: readonly EnumOption[], message: string): string => {
  const values = options.map((option) => option.value);

  // `z.enum` is string-only; `z.literal([...])` (Zod 4) takes mixed values.
  return values.every((value) => typeof value === "string") && values.length > 1
    ? `z.enum([${values.map(literal).join(", ")}], ${quote(message)})`
    : `z.literal(${values.length === 1 ? literal(values[0] ?? "") : `[${values.map(literal).join(", ")}]`}, ${quote(message)})`;
};

const objectSchema = (fields: readonly FieldNode[]): string =>
  `z.object({\n${fields.map((field) => `${key(lastSegment(field))}: ${fieldSchema(field)},`).join("\n")}\n})`;

// No `default` arm: a new FieldShape must say how it validates, or fail to compile.
const shapeSchema = (shape: FieldShape): string => {
  switch (shape.kind) {
    case "string":
      return stringSchema(shape);
    case "number":
      return numberSchema(shape);
    case "boolean":
      return "z.boolean()";
    case "enum":
      return enumSchema(shape.options, shape.message?.text ?? "Select an option");
    case "date":
      return shape.encoding === "date-object"
        ? `z.date(${quote("Enter a date")})`
        : shape.time
          ? `z.iso.datetime(${quote("Enter a date and time")})`
          : `z.iso.date(${quote("Enter a date")})`;
    case "array":
      return [
        `z.array(${shapeSchema(shape.of)})`,
        shape.min === undefined || shape.min.value <= 0
          ? ""
          : `.min(${shape.min.value}, ${quote(shape.min.message?.text ?? `Add at least ${plural(shape.min.value, "item")}`)})`,
        shape.max === undefined
          ? ""
          : `.max(${shape.max.value}, ${quote(shape.max.message?.text ?? `No more than ${plural(shape.max.value, "item")}`)})`,
      ].join("");
    case "object":
      return objectSchema(shape.fields);
    case "union": {
      const variants = shape.variants.map(shapeSchema).join(",\n");

      return shape.discriminator === undefined
        ? `z.union([\n${variants}\n])`
        : // The message is what a union with no branch chosen reports, so it
          // reads like the unpicked select it is shown under.
          `z.discriminatedUnion(${quote(shape.discriminator)}, [\n${variants}\n], ${quote("Select an option")})`;
    }
    // The value is still part of the data, so it stays in the schema — as
    // "anything", with the reason beside it — rather than being stripped on parse.
    case "file":
      return "z.unknown() /* TODO(formation): file upload — tighten once the control is bound */";
    case "unsupported":
      return `z.unknown() /* TODO(formation): ${shape.reason.replace(/\*\//g, "* /")} */`;
  }
};

const fieldSchema = (field: FieldNode): string =>
  [
    shapeSchema(field.shape),
    // `.nullable()` before `.optional()`: Zod reads the chain inside-out, and
    // this order yields `T | null | undefined` either way but keeps the output
    // stable for snapshotting.
    field.nullable ? ".nullable()" : "",
    field.optional ? ".optional()" : "",
  ].join("");

/** The schema module's source. Unformatted; the CLI runs Prettier over it. */
export const emitZodSchema = (form: FormIR, exportName: string): string =>
  [
    `import { z } from "zod";`,
    "",
    ...(form.description === undefined
      ? []
      : [`/** ${form.description.replace(/\*\//g, "* /")} */`]),
    `export const ${exportName} = ${objectSchema(form.fields)};`,
    "",
  ].join("\n");
