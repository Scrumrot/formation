import { singularize } from "./casing.js";
import type { FieldNode, FieldShape } from "./form-ir.js";
import { INDEX_SEGMENT } from "./form-ir.js";

/**
 * The handful of ways a scalar field meets a control. Narrower than FieldShape
 * on purpose: a state adapter exposes one hook per kind and a UI adapter one
 * control per kind, and this union is the vocabulary the two agree on without
 * knowing about each other.
 */
export type ControlKind = "text" | "number" | "boolean" | "choice" | "date";

export const controlKinds: readonly ControlKind[] = ["text", "number", "boolean", "choice", "date"];

// No `default` arm: a new FieldShape must decide here whether it binds a
// control, rather than silently falling into "not bindable".
export const controlKindOf = (shape: FieldShape): ControlKind | undefined => {
  switch (shape.kind) {
    case "string":
      return "text";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "enum":
      return "choice";
    case "date":
      return "date";
    case "file":
    case "array":
    case "object":
    case "union":
    case "unsupported":
      return undefined;
  }
};

export type ListField = FieldNode & Readonly<{ shape: Extract<FieldShape, { kind: "array" }> }>;

export const isListField = (field: FieldNode): field is ListField => field.shape.kind === "array";

/**
 * The node standing for one row of a list. An array's `of` is a bare shape with
 * no label or path of its own, but a list of strings still needs a control per
 * row — so the row gets a synthetic node addressed at `list.*`.
 */
export const rowField = (list: ListField): FieldNode => ({
  path: [...list.path, INDEX_SEGMENT],
  label: singularize(list.label),
  optional: false,
  nullable: false,
  shape: list.shape.of,
});

export type ControlBinding = Readonly<{ kind: ControlKind; field: FieldNode }>;

/** One branch of a discriminated union, with the discriminator itself taken out. */
export type Variant = Readonly<{
  /** The value the discriminator holds for this branch. */
  tag: string | number;
  label: string;
  /** The branch's other fields. The discriminator is bound by the union, not as a field. */
  fields: readonly FieldNode[];
}>;

export type VariantField = Readonly<{
  field: FieldNode;
  /** Name of the property that tells the branches apart. */
  discriminator: string;
  variants: readonly Variant[];
}>;

const lastSegment = (field: FieldNode): string => field.path[field.path.length - 1] ?? "";

/**
 * Reads a union as "a choice of branches", or `undefined` when it cannot be
 * one. A choice needs a discriminator, and every branch has to be an object
 * that pins that property to a single value distinct from the others — without
 * that there is nothing to put in the select, or two options that mean the
 * same thing.
 */
export const variantFieldOf = (field: FieldNode): VariantField | undefined => {
  const shape = field.shape;

  if (shape.kind !== "union" || shape.discriminator === undefined) return undefined;

  const discriminator = shape.discriminator;
  const variants = shape.variants.flatMap((variant): readonly Variant[] => {
    const fields = variant.kind === "object" ? variant.fields : [];
    const pin = fields.find((child) => lastSegment(child) === discriminator);
    const option =
      pin?.shape.kind === "enum" && pin.shape.options.length === 1
        ? pin.shape.options[0]
        : undefined;

    return option === undefined
      ? []
      : [
          {
            tag: option.value,
            label: option.label,
            fields: fields.filter((child) => child !== pin),
          },
        ];
  });
  // Tags are compared as text because that is how the select will carry them.
  const distinct = new Set(variants.map((variant) => String(variant.tag))).size;

  return variants.length === shape.variants.length && distinct === variants.length
    ? { field, discriminator, variants }
    : undefined;
};

/** Everything in a form that generated code addresses by path, sorted by how it binds. */
export type FormBindings = Readonly<{
  controls: readonly ControlBinding[];
  lists: readonly ListField[];
  /** Discriminated unions: a choice of branch, then that branch's fields. */
  variants: readonly VariantField[];
  /** Fields with no control: files, undiscriminated unions, and whatever ingest could not represent. */
  unbound: readonly FieldNode[];
}>;

const none: FormBindings = { controls: [], lists: [], variants: [], unbound: [] };

const merge = (parts: readonly FormBindings[]): FormBindings => ({
  controls: parts.flatMap((part) => part.controls),
  lists: parts.flatMap((part) => part.lists),
  variants: parts.flatMap((part) => part.variants),
  unbound: parts.flatMap((part) => part.unbound),
});

const bindingsOf = (field: FieldNode): FormBindings => {
  const kind = controlKindOf(field.shape);
  const variantField = variantFieldOf(field);

  return kind !== undefined
    ? { ...none, controls: [{ kind, field }] }
    : field.shape.kind === "object"
      ? merge(field.shape.fields.map(bindingsOf))
      : isListField(field)
        ? merge([{ ...none, lists: [field] }, bindingsOf(rowField(field))])
        : variantField !== undefined
          ? merge([
              { ...none, variants: [variantField] },
              // Branch fields live at ordinary paths under the union, so they
              // bind exactly like any other field once their branch is active.
              ...variantField.variants.flatMap((variant) => variant.fields.map(bindingsOf)),
            ])
          : { ...none, unbound: [field] };
};

/**
 * One walk that both the state adapter and the component assembler read. They
 * must agree exactly on which paths exist and how each binds — the state
 * adapter types a hook's `path` parameter from this, and the assembler passes
 * paths to that hook — so neither gets its own traversal to drift.
 */
export const collectBindings = (fields: readonly FieldNode[]): FormBindings =>
  merge(fields.map(bindingsOf));

/** The row-agnostic spelling of a path, used as a lookup key: `contacts.*.phone`. */
export const pathPattern = (path: readonly string[]): string => path.join(".");

/**
 * A path as a TypeScript type: `"address.street"`, or a template literal type
 * (`` `contacts.${number}.phone` ``) when it runs through a list. Typing rows
 * as `${number}` is what lets generated code pass `` `${path}.${index}.phone` ``
 * to a hook and still have a typo'd field name fail to compile.
 */
export const pathTypeText = (path: readonly string[]): string =>
  path.includes(INDEX_SEGMENT)
    ? `\`${path.map((segment) => (segment === INDEX_SEGMENT ? "${number}" : escapeTemplate(segment))).join(".")}\``
    : JSON.stringify(path.join("."));

const escapeTemplate = (segment: string): string =>
  segment.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

/**
 * Whether a blank control would fail validation, i.e. whether the UI should
 * mark the field required. A required *string* with no minimum length accepts
 * `""`, so marking it with an asterisk would promise an error that never comes.
 */
export const mustBeFilled = (field: FieldNode): boolean => {
  if (field.optional || field.nullable) return false;

  switch (field.shape.kind) {
    case "string":
      // "" is not an email, a URL or a UUID, so those formats are as good as a
      // minimum length even when the schema states none.
      return (
        (field.shape.min?.value ?? 0) > 0 ||
        field.shape.format === "email" ||
        field.shape.format === "url" ||
        field.shape.format === "uuid"
      );
    case "number":
    case "enum":
    case "date":
    // A union with no branch chosen is as blank as an unpicked select.
    case "union":
      return true;
    case "array":
      return (field.shape.min?.value ?? 0) > 0;
    // A switch is never "blank" (off is a value), and the rest bind no control.
    case "boolean":
    case "file":
    case "object":
    case "unsupported":
      return false;
  }
};
