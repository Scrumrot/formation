import type { Diagnostic } from "./diagnostics.js";

/**
 * FormIR is the semantic layer: what the form *means*, independent of any
 * framework, form library, or UI kit. Every ingest adapter produces one; every
 * emitter consumes one.
 *
 * It is deliberately NOT JSON Schema. JSON Schema is the ingest hub (see
 * docs/plan.md §4) but it drops exactly what a form needs — custom error
 * messages, refinement intent, field ordering, branded types. FormIR keeps
 * those, and records what it still couldn't keep.
 */

/** A validation message, carried alongside the constraint that produces it. */
export type Message = Readonly<{
  /** The schema author's own wording, when they supplied one. */
  text: string;
  /** False when we synthesized the wording because the source had none. */
  authored: boolean;
}>;

export type Constraint<T> = Readonly<{
  value: T;
  message?: Message;
}>;

export type EnumOption = Readonly<{
  value: string | number;
  label: string;
}>;

/**
 * Refined string kinds. This is a semantic hint, not a widget name: the UI
 * adapter decides that `multiline` becomes a `<Textarea>` and `email` becomes
 * `<Input type="email">`. Keeping the two separate is what lets one UI adapter
 * serve every framework.
 */
export type StringFormat = "email" | "url" | "uuid" | "password" | "phone" | "multiline" | "color";

export type FieldShape =
  | Readonly<{
      kind: "string";
      format?: StringFormat;
      min?: Constraint<number>;
      max?: Constraint<number>;
      pattern?: Constraint<string>;
    }>
  | Readonly<{
      kind: "number";
      integer: boolean;
      min?: Constraint<number>;
      max?: Constraint<number>;
      step?: number;
    }>
  | Readonly<{ kind: "boolean" }>
  | Readonly<{ kind: "enum"; options: readonly EnumOption[]; message?: Message }>
  | Readonly<{
      kind: "date";
      time: boolean;
      min?: Constraint<string>;
      max?: Constraint<string>;
    }>
  | Readonly<{ kind: "file"; multiple: boolean; accept?: readonly string[] }>
  | Readonly<{
      kind: "array";
      of: FieldShape;
      min?: Constraint<number>;
      max?: Constraint<number>;
    }>
  | Readonly<{ kind: "object"; fields: readonly FieldNode[] }>
  | Readonly<{
      kind: "union";
      /** Property name when the source was a discriminated union; absent otherwise. */
      discriminator?: string;
      variants: readonly FieldShape[];
    }>
  /**
   * Not an error and not a dropped field. A `z.custom()`, an unresolvable
   * `$ref`, a transform with no static shape — the field still exists in the
   * user's data, so it must still exist in the IR. Emitters turn this into a
   * commented stub.
   *
   * Silently omitting it would produce a form that compiles, passes its
   * generated tests, and quietly loses data. That is the worst outcome this
   * whole design is arranged to prevent.
   */
  | Readonly<{ kind: "unsupported"; reason: string }>;

export type FieldNode = Readonly<{
  /**
   * Path as segments, never a joined string. `address.street` vs
   * `address[street]` vs a tuple is a form-library concern, so the form adapter
   * serializes it and FormIR refuses to pick a side.
   */
  path: readonly string[];
  label: string;
  optional: boolean;
  description?: string;
  defaultValue?: unknown;
  shape: FieldShape;
}>;

export type FormIR = Readonly<{
  /** PascalCase base for generated identifiers, derived from the schema name. */
  name: string;
  description?: string;
  fields: readonly FieldNode[];
  diagnostics: readonly Diagnostic[];
}>;

/**
 * Depth-first walk yielding every field including nested ones, parents before
 * children. Used by both the UI mapper and the test-case deriver, which is the
 * reason it lives in core rather than in either of them.
 */
export const flattenFields = (fields: readonly FieldNode[]): readonly FieldNode[] =>
  fields.flatMap((field) => [field, ...descendants(field.shape)]);

// No `default` arm: adding a variant to FieldShape must fail to compile here
// rather than silently traverse nothing.
const descendants = (shape: FieldShape): readonly FieldNode[] => {
  switch (shape.kind) {
    case "object":
      return flattenFields(shape.fields);
    case "array":
      return descendants(shape.of);
    case "union":
      return shape.variants.flatMap(descendants);
    case "string":
    case "number":
    case "boolean":
    case "enum":
    case "date":
    case "file":
    case "unsupported":
      return [];
  }
};

/** True when any field in the tree could not be fully represented. */
export const hasUnsupportedFields = (form: FormIR): boolean =>
  flattenFields(form.fields).some((field) => field.shape.kind === "unsupported");
