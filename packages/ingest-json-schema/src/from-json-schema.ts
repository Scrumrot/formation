import type {
  Bound,
  Constraint,
  Diagnostic,
  DiagnosticCode,
  EnumOption,
  FieldNode,
  FieldShape,
  FormIR,
  Outcome,
  StringFormat,
} from "@formation/core";
import {
  INDEX_SEGMENT,
  failed,
  flattenFields,
  isAddressable,
  labelFromName,
  ok,
  pascalCase,
} from "@formation/core";

import type { JsonRecord } from "./select.js";
import { isRecord, own, resolvePointer, selectSchema } from "./select.js";

/**
 * JSON Schema (2020-12, with the draft-04/07 and OpenAPI 3.0 spellings people
 * actually ship) → FormIR.
 *
 * JSON Schema is the ingest hub — Zod, TypeBox, Valibot and OpenAPI all reach
 * FormIR through here (docs/plan.md §4) — so this walk is where "what could
 * not be represented" has to be said out loud. Nothing here throws on an
 * unrepresentable node: it becomes an `unsupported` shape with a diagnostic,
 * because a field missing from a generated form is worse than a stub in it.
 */

export type JsonSchemaIngestOptions = Readonly<{
  /** A schema name (`components.schemas`, `$defs`, `definitions`) or a `#/…` pointer. */
  select?: string;
  /** Overrides the name derived from the schema. */
  name?: string;
  /** Stamped on diagnostics so a multi-file run says which file each came from. */
  source?: string;
}>;

type Context = Readonly<{
  root: unknown;
  path: readonly string[];
  /** `$ref` targets on the way down to here; meeting one again means recursion. */
  trail: readonly unknown[];
  source: string | undefined;
}>;

type Shaped = Readonly<{ shape: FieldShape; diagnostics: readonly Diagnostic[] }>;

/** A schema with `$ref`, `allOf` and every spelling of "nullable" already resolved away. */
type Normalized =
  | Readonly<{ kind: "schema"; record: JsonRecord; nullable: boolean; trail: readonly unknown[] }>
  | Readonly<{ kind: "unsupported"; reason: string; code: DiagnosticCode }>;

const diagnose = (
  context: Context,
  code: DiagnosticCode,
  message: string,
  severity: Diagnostic["severity"] = "warning",
): Diagnostic => ({
  severity,
  code,
  message,
  ...(context.path.length > 0 ? { path: context.path } : {}),
  ...(context.source === undefined ? {} : { source: context.source }),
});

const unsupported = (
  context: Context,
  reason: string,
  code: DiagnosticCode = "schema/unsupported-node",
): Shaped => ({
  shape: { kind: "unsupported", reason },
  diagnostics: [diagnose(context, code, `Not generated: ${reason}.`)],
});

const without = (record: JsonRecord, keys: readonly string[]): JsonRecord =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const constraint = <T>(value: T | undefined): Constraint<T> | undefined =>
  value === undefined ? undefined : { value };

// `exactOptionalPropertyTypes` forbids writing `key: undefined`, so optional
// properties are spread in only when they exist.
const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

// ---- Normalization ----------------------------------------------------------

const isNullSchema = (schema: unknown): boolean =>
  isRecord(schema) &&
  (own(schema, "type") === "null" ||
    own(schema, "const") === null ||
    (Array.isArray(own(schema, "enum")) &&
      (own(schema, "enum") as readonly unknown[]).every((value) => value === null)));

const looksLikeObject = (record: JsonRecord): boolean =>
  own(record, "type") === "object" || isRecord(own(record, "properties"));

const requiredOf = (record: JsonRecord): readonly string[] => {
  const required = own(record, "required");

  return Array.isArray(required)
    ? required.filter((name): name is string => typeof name === "string")
    : [];
};

/** `allOf` of objects is one object: properties merge, `required` lists union. */
const mergeObjects = (records: readonly JsonRecord[]): JsonRecord => ({
  type: "object",
  properties: Object.assign(
    {},
    ...records.map((record) =>
      isRecord(own(record, "properties")) ? own(record, "properties") : {},
    ),
  ) as JsonRecord,
  required: [...new Set(records.flatMap(requiredOf))],
});

const normalize = (schema: unknown, root: unknown, trail: readonly unknown[]): Normalized => {
  if (!isRecord(schema)) {
    return {
      kind: "unsupported",
      reason: "the schema is not an object (a bare `true`/`false` schema describes no fields)",
      code: "schema/unsupported-node",
    };
  }

  const reference = own(schema, "$ref");

  if (typeof reference === "string") {
    if (!reference.startsWith("#")) {
      return {
        kind: "unsupported",
        reason: `external $ref "${reference}" (only references inside the document resolve)`,
        code: "schema/ref-unresolved",
      };
    }

    const target = resolvePointer(root, reference);

    if (target === undefined) {
      return {
        kind: "unsupported",
        reason: `$ref "${reference}" points at nothing`,
        code: "schema/ref-unresolved",
      };
    }
    if (trail.includes(target)) {
      return {
        kind: "unsupported",
        reason: `$ref "${reference}" is recursive`,
        code: "schema/unsupported-node",
      };
    }

    // Keywords beside a `$ref` (OpenAPI 3.1, JSON Schema 2019-09+) describe
    // this *use* of the target, so they win over the target's own.
    return normalize(
      isRecord(target) ? { ...target, ...without(schema, ["$ref"]) } : target,
      root,
      [...trail, target],
    );
  }

  const allOf = own(schema, "allOf");

  if (Array.isArray(allOf) && allOf.length > 0) {
    const site = without(schema, ["allOf"]);
    const branches = allOf.map((branch) => normalize(branch, root, trail));
    const failure = branches.find((branch) => branch.kind === "unsupported");

    if (failure !== undefined) return failure;

    const resolved = branches.flatMap((branch) => (branch.kind === "schema" ? [branch] : []));
    const only = resolved[0];
    const nullable = resolved.some((branch) => branch.nullable);
    const deepest = resolved.reduce<readonly unknown[]>(
      (longest, branch) => (branch.trail.length > longest.length ? branch.trail : longest),
      trail,
    );

    // A single-branch allOf is OpenAPI 3.0's way to hang a description or
    // `nullable` on a $ref, which 3.0 otherwise forbids siblings on.
    const merged =
      resolved.length === 1 && only !== undefined
        ? { ...only.record, ...site }
        : resolved.every((branch) => looksLikeObject(branch.record)) &&
            (Object.keys(site).length === 0 || looksLikeObject(site) || !("type" in site))
          ? {
              ...mergeObjects([...resolved.map((branch) => branch.record), site]),
              ...without(site, ["properties", "required", "type"]),
            }
          : undefined;

    if (merged === undefined) {
      return {
        kind: "unsupported",
        reason: "allOf combines schemas that are not all objects",
        code: "schema/unsupported-node",
      };
    }

    const next = normalize(merged, root, deepest);

    return next.kind === "schema" ? { ...next, nullable: next.nullable || nullable } : next;
  }

  // Every dialect's spelling of "or null", gathered into one flag.
  const type = own(schema, "type");
  const types = Array.isArray(type) ? type.filter((entry) => entry !== "null") : undefined;
  const typeNullable = Array.isArray(type) && type.includes("null");

  if (types !== undefined && types.length !== 1) {
    return {
      kind: "unsupported",
      reason:
        types.length === 0
          ? "the only allowed type is null"
          : `several types are allowed (${types.join(", ")}) and no single control fits them`,
      code: "schema/unsupported-node",
    };
  }

  const typed = types === undefined ? schema : { ...schema, type: types[0] };
  const flagNullable = own(schema, "nullable") === true;

  const alternativesKey = (["oneOf", "anyOf"] as const).find((key) =>
    Array.isArray(own(typed, key)),
  );
  const alternatives =
    alternativesKey === undefined ? [] : (own(typed, alternativesKey) as readonly unknown[]);
  const nonNull = alternatives.filter((branch) => !isNullSchema(branch));
  const branchNullable = nonNull.length < alternatives.length;
  const nullable = typeNullable || flagNullable || branchNullable;

  if (alternativesKey !== undefined && nonNull.length === 1) {
    // `anyOf: [X, null]` is just nullable X. Keywords on the site still win,
    // for the same reason they do beside a `$ref`.
    const next = normalize(
      isRecord(nonNull[0])
        ? { ...nonNull[0], ...without(typed, [alternativesKey, "nullable"]) }
        : nonNull[0],
      root,
      trail,
    );

    return next.kind === "schema" ? { ...next, nullable: next.nullable || nullable } : next;
  }

  const enumValues = own(typed, "enum");
  const enumNullable = Array.isArray(enumValues) && enumValues.includes(null);

  return {
    kind: "schema",
    record: {
      ...typed,
      ...(alternativesKey === undefined ? {} : { [alternativesKey]: nonNull }),
      ...(Array.isArray(enumValues) ? { enum: enumValues.filter((value) => value !== null) } : {}),
    },
    nullable: nullable || enumNullable,
    trail,
  };
};

// ---- Shapes -----------------------------------------------------------------

const optionLabel = (value: string | number, title: unknown): string =>
  stringOf(title) ?? (typeof value === "string" ? labelFromName(value) || value : String(value));

const isOptionValue = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

const enumShape = (record: JsonRecord, values: readonly unknown[], context: Context): Shaped => {
  if (values.length === 0) return unsupported(context, "the enum lists no values");
  if (values.every((value) => typeof value === "boolean")) {
    return { shape: { kind: "boolean" }, diagnostics: [] };
  }
  if (!values.every(isOptionValue)) {
    return unsupported(context, "the enum holds values that are not strings or numbers");
  }

  // `x-enumNames` / `enumNames` is the widespread (non-standard) way to label
  // enum values; honoring it costs nothing and saves hand-editing every option.
  const names = own(record, "x-enumNames") ?? own(record, "enumNames");
  const options: readonly EnumOption[] = values.map((value, index) => ({
    value,
    label: optionLabel(value, Array.isArray(names) ? names[index] : undefined),
  }));

  return { shape: { kind: "enum", options }, diagnostics: [] };
};

const FORMATS: Readonly<Record<string, StringFormat>> = {
  email: "email",
  "idn-email": "email",
  uri: "url",
  url: "url",
  iri: "url",
  uuid: "uuid",
  password: "password",
  phone: "phone",
  tel: "phone",
  color: "color",
  textarea: "multiline",
  multiline: "multiline",
};

/**
 * JSON Schema's `format: password` is an OpenAPI convention most schemas — and
 * every Zod schema — never set. A property *named* like a password is the one
 * case where guessing from the name is worth it: the cost of a wrong guess is a
 * masked text field, the cost of not guessing is a password shown on screen.
 */
const PASSWORD_NAME = /pass(word|phrase|wd)$/i;

const stringShape = (record: JsonRecord, context: Context): Shaped => {
  const format =
    stringOf(own(record, "format")) ??
    (PASSWORD_NAME.test(context.path[context.path.length - 1] ?? "") ? "password" : undefined);

  if (format === "date" || format === "date-time") {
    return {
      shape: {
        kind: "date",
        time: format === "date-time",
        // Set by ingest-zod for `z.date()`, whose JSON Schema rendering is a
        // string but whose runtime value is a Date.
        encoding: own(record, "x-formation-date") === "object" ? "date-object" : "iso-string",
      },
      diagnostics: [],
    };
  }
  if (format === "binary" || format === "byte") {
    return { shape: { kind: "file", multiple: false }, diagnostics: [] };
  }

  const known = format === undefined ? undefined : own(FORMATS, format);
  const pattern = stringOf(own(record, "pattern"));

  return {
    shape: {
      kind: "string",
      ...optional("format", typeof known === "string" ? (known as StringFormat) : undefined),
      ...optional("min", constraint(finite(own(record, "minLength")))),
      ...optional("max", constraint(finite(own(record, "maxLength")))),
      ...optional("pattern", constraint(pattern)),
    },
    diagnostics:
      format !== undefined && known === undefined
        ? [
            diagnose(
              context,
              "schema/dialect-approximated",
              `String format "${format}" has no dedicated control or check; treated as plain text.`,
              "info",
            ),
          ]
        : [],
  };
};

// Draft-04 spelled an exclusive bound as `exclusiveMinimum: true` beside
// `minimum`; 2019-09 onward made `exclusiveMinimum` the number itself. When a
// schema carries both spellings the tighter bound is the real one.
const bound = (
  inclusive: unknown,
  exclusive: unknown,
  tighter: (a: number, b: number) => boolean,
): Bound | undefined => {
  const limit = finite(inclusive);
  const strict = finite(exclusive);

  return exclusive === true && limit !== undefined
    ? { value: limit, exclusive: true }
    : strict !== undefined && (limit === undefined || !tighter(limit, strict))
      ? { value: strict, exclusive: true }
      : limit === undefined
        ? undefined
        : { value: limit };
};

const numberShape = (record: JsonRecord): Shaped => {
  const step = finite(own(record, "multipleOf"));

  return {
    shape: {
      kind: "number",
      integer: own(record, "type") === "integer",
      ...optional(
        "min",
        bound(own(record, "minimum"), own(record, "exclusiveMinimum"), (a, b) => a > b),
      ),
      ...optional(
        "max",
        bound(own(record, "maximum"), own(record, "exclusiveMaximum"), (a, b) => a < b),
      ),
      ...optional("step", step !== undefined && step > 0 ? step : undefined),
    },
    diagnostics: [],
  };
};

const fieldsOf = (
  record: JsonRecord,
  context: Context,
): Readonly<{ fields: readonly FieldNode[]; diagnostics: readonly Diagnostic[] }> => {
  const properties = own(record, "properties");
  const required = requiredOf(record);
  const walked = Object.entries(isRecord(properties) ? properties : {}).map(([name, schema]) =>
    fieldOf(name, schema, !required.includes(name), context),
  );

  return {
    fields: walked.map((entry) => entry.field),
    diagnostics: walked.flatMap((entry) => entry.diagnostics),
  };
};

const objectShape = (record: JsonRecord, context: Context): Shaped => {
  if (!isRecord(own(record, "properties"))) {
    return unsupported(
      context,
      "the object declares no fixed properties (a record/map has no fields to bind)",
    );
  }

  const { fields, diagnostics } = fieldsOf(record, context);

  return { shape: { kind: "object", fields }, diagnostics };
};

const arrayShape = (record: JsonRecord, context: Context): Shaped => {
  const items = own(record, "items");

  if (Array.isArray(own(record, "prefixItems")) || Array.isArray(items)) {
    return unsupported(context, "tuples (fixed positional items) are not generated yet");
  }
  if (items === undefined) {
    return unsupported(context, "the array does not say what its items are");
  }

  const item = shapeOf(items, { ...context, path: [...context.path, INDEX_SEGMENT] });

  return {
    shape: {
      kind: "array",
      of: item.shape,
      ...optional("min", constraint(finite(own(record, "minItems")))),
      ...optional("max", constraint(finite(own(record, "maxItems")))),
    },
    diagnostics: [
      ...item.diagnostics,
      ...(item.nullable
        ? [
            diagnose(
              context,
              "schema/dialect-approximated",
              "The array's items may be null; rows are generated as non-null.",
              "info",
            ),
          ]
        : []),
    ],
  };
};

/** The single value a property is pinned to, when it is pinned: `const`, or a one-value `enum`. */
const pinnedValue = (schema: unknown): string | number | undefined => {
  if (!isRecord(schema)) return undefined;

  const fixed = own(schema, "const");
  const values = own(schema, "enum");
  const single = Array.isArray(values) && values.length === 1 ? (values[0] as unknown) : undefined;

  return isOptionValue(fixed) ? fixed : isOptionValue(single) ? single : undefined;
};

const propertiesOf = (record: JsonRecord): JsonRecord => {
  const properties = own(record, "properties");

  return isRecord(properties) ? properties : {};
};

/**
 * The property that tells a union's branches apart: OpenAPI's explicit
 * `discriminator.propertyName`, or — for plain JSON Schema and Zod's
 * `discriminatedUnion` output — the one property every branch pins to a
 * different value.
 */
const discriminatorOf = (site: JsonRecord, branches: readonly JsonRecord[]): string | undefined => {
  const declared = own(site, "discriminator");
  const named = isRecord(declared) ? stringOf(own(declared, "propertyName")) : undefined;

  if (named !== undefined) return named;

  const first = branches[0];

  return first === undefined
    ? undefined
    : Object.keys(propertiesOf(first)).find((name) => {
        const pins = branches.map((branch) => pinnedValue(own(propertiesOf(branch), name)));

        return pins.every((pin) => pin !== undefined) && new Set(pins).size === pins.length;
      });
};

const alternativesShape = (
  record: JsonRecord,
  branches: readonly unknown[],
  context: Context,
  trail: readonly unknown[],
): Shaped => {
  const resolved = branches.map((branch) => normalize(branch, context.root, trail));
  const records = resolved.flatMap((branch) => (branch.kind === "schema" ? [branch.record] : []));

  if (records.length !== branches.length) {
    return unsupported(context, "one of the alternatives could not be resolved");
  }

  // `oneOf` of `const`s is the standards-blessed way to give enum values titles.
  const pins = records.map((branch) => own(branch, "const"));

  if (pins.every(isOptionValue)) {
    return {
      shape: {
        kind: "enum",
        options: records.map((branch, index) => {
          const value = pins[index] as string | number;

          return { value, label: optionLabel(value, own(branch, "title")) };
        }),
      },
      diagnostics: [],
    };
  }

  const discriminator = records.every(looksLikeObject)
    ? discriminatorOf(record, records)
    : undefined;

  if (discriminator === undefined) {
    return unsupported(
      context,
      "the alternatives (oneOf/anyOf) share no discriminator property to choose between them",
    );
  }

  const variants = records.map((branch) => objectShape(branch, { ...context, trail }));

  return {
    shape: { kind: "union", discriminator, variants: variants.map((variant) => variant.shape) },
    diagnostics: variants.flatMap((variant) => variant.diagnostics),
  };
};

const shapeOfRecord = (record: JsonRecord, context: Context, trail: readonly unknown[]): Shaped => {
  const inner: Context = { ...context, trail };

  if (own(record, "const") !== undefined) return enumShape(record, [own(record, "const")], inner);

  const values = own(record, "enum");

  if (Array.isArray(values)) return enumShape(record, values, inner);

  const alternatives = own(record, "oneOf") ?? own(record, "anyOf");

  if (Array.isArray(alternatives) && alternatives.length > 0) {
    return alternativesShape(record, alternatives, inner, trail);
  }

  // `type` is frequently omitted where a structural keyword makes it obvious.
  const type =
    own(record, "type") ??
    (isRecord(own(record, "properties"))
      ? "object"
      : own(record, "items") !== undefined
        ? "array"
        : undefined);

  switch (type) {
    case "string":
      return stringShape(record, inner);
    case "number":
    case "integer":
      return numberShape(record);
    case "boolean":
      return { shape: { kind: "boolean" }, diagnostics: [] };
    case "object":
      return objectShape(record, inner);
    case "array":
      return arrayShape(record, inner);
    // Deliberately a subset: only the JSON Schema types a form can bind. `null`
    // alone and an absent type (which accepts anything) have no control.
    default:
      return unsupported(
        inner,
        type === undefined
          ? "the schema sets no type, so any value is allowed"
          : `type "${String(type)}" has no control`,
      );
  }
};

const shapeOf = (schema: unknown, context: Context): Shaped & Readonly<{ nullable: boolean }> => {
  const normalized = normalize(schema, context.root, context.trail);

  return normalized.kind === "unsupported"
    ? { ...unsupported(context, normalized.reason, normalized.code), nullable: false }
    : {
        ...shapeOfRecord(normalized.record, context, normalized.trail),
        nullable: normalized.nullable,
      };
};

const fieldOf = (
  name: string,
  schema: unknown,
  isOptional: boolean,
  parent: Context,
): Readonly<{ field: FieldNode; diagnostics: readonly Diagnostic[] }> => {
  const context: Context = { ...parent, path: [...parent.path, name] };
  const normalized = normalize(schema, context.root, context.trail);
  const record = normalized.kind === "schema" ? normalized.record : {};

  const shaped = !isAddressable(name)
    ? unsupported(
        context,
        `the property name "${name}" cannot be part of a dotted path (it is empty, numeric, "*", or contains a dot)`,
      )
    : normalized.kind === "unsupported"
      ? unsupported(context, normalized.reason, normalized.code)
      : shapeOfRecord(normalized.record, context, normalized.trail);

  const defaultValue = own(record, "default");

  return {
    field: {
      path: context.path,
      label: stringOf(own(record, "title")) ?? (labelFromName(name) || name),
      optional: isOptional,
      nullable: normalized.kind === "schema" && normalized.nullable,
      ...optional("description", stringOf(own(record, "description"))),
      ...(defaultValue === undefined ? {} : { defaultValue }),
      shape: shaped.shape,
    },
    diagnostics: shaped.diagnostics,
  };
};

// ---- Entry ------------------------------------------------------------------

/** `profileSchema` / `Profile` / `profile_form` → `Profile`: the component adds its own `Form`. */
const baseName = (raw: string | undefined): string => {
  const pascal = pascalCase(raw ?? "");
  const trimmed = pascal.replace(/(Schema|Form)$/, "");

  return trimmed.length > 0 ? trimmed : pascal.length > 0 ? pascal : "Generated";
};

/**
 * A required string with no minimum length accepts `""`. That is what the
 * schema says, so the form honors it — but it is rarely what the author meant,
 * and it is invisible until a blank form submits. One note for the whole form,
 * rather than one per field, keeps it readable on a 40-field schema.
 */
const blankAllowed = (
  fields: readonly FieldNode[],
  source: string | undefined,
): readonly Diagnostic[] => {
  const paths = flattenFields(fields)
    .filter(
      (field) =>
        field.shape.kind === "string" &&
        !field.optional &&
        !field.nullable &&
        field.shape.format === undefined &&
        field.shape.pattern === undefined &&
        (field.shape.min?.value ?? 0) === 0,
    )
    .map((field) => field.path.join("."));

  return paths.length === 0
    ? []
    : [
        {
          severity: "info",
          code: "schema/blank-allowed",
          message: `${paths.length} required text ${paths.length === 1 ? "field accepts" : "fields accept"} an empty string because the schema sets no minimum length: ${paths.join(", ")}.`,
          ...(source === undefined ? {} : { source }),
        },
      ];
};

export const fromJsonSchema = (
  document: unknown,
  options: JsonSchemaIngestOptions = {},
): Outcome<FormIR> => {
  const selection = selectSchema(document, options.select);
  const sourced = options.source === undefined ? {} : { source: options.source };

  if (selection.kind === "missing") {
    return failed([
      { severity: "error", code: "schema/unreadable", message: selection.message, ...sourced },
    ]);
  }

  // Seeding the trail with the selected schema cuts a self-referential type
  // (`Tree.left: $ref Tree`) at its first recursion instead of its second.
  const context: Context = {
    root: document,
    path: [],
    trail: [selection.schema],
    source: options.source,
  };
  const normalized = normalize(selection.schema, document, context.trail);

  if (normalized.kind === "unsupported" || !looksLikeObject(normalized.record)) {
    return failed([
      {
        severity: "error",
        code: "schema/unreadable",
        message:
          normalized.kind === "unsupported"
            ? `The schema could not be read: ${normalized.reason}.`
            : "A form needs an object schema with properties at its root.",
        ...sourced,
      },
    ]);
  }

  const { fields, diagnostics } = fieldsOf(normalized.record, {
    ...context,
    trail: normalized.trail,
  });
  const all = [...diagnostics, ...blankAllowed(fields, options.source)];
  const title = stringOf(own(normalized.record, "title"));

  return ok(
    {
      name: baseName(options.name ?? selection.name ?? title),
      ...optional("description", stringOf(own(normalized.record, "description"))),
      fields,
      diagnostics: all,
    },
    all,
  );
};
