import type { FieldNode, FormBindings, StateAdapterInput } from "@formation/core";
import { pathPattern, pathTypeText } from "@formation/core";

import { defaultBlank, effectiveBlank } from "./conflicts.js";
import { section, table, tableKey, union, when } from "./emit.js";
import type { StateNames } from "./names.js";
import type { Usage } from "./usage.js";
import type { BlankPolicy } from "./values.js";
import { CONTROL_KINDS } from "./usage.js";
import {
  blankOf,
  blankRowOf,
  blankVariantOf,
  initialValuesOf,
  objectType,
  printValue,
} from "./values.js";

/**
 * The parts of a state module that are the same whichever library holds the
 * state: the working values, the typed path unions, the handle types the UI
 * binds to, and the tables that describe the form's shape.
 *
 * These are the generated half of the state/UI contract (see `adapters.ts` in
 * core). Emitting them from one place is what makes "every state adapter
 * exports the same hooks over the same paths" true by construction rather than
 * by two emitters being kept in step.
 */

export const valuesSection = (
  input: StateAdapterInput,
  names: StateNames,
  policy: BlankPolicy,
): string =>
  `${section("Values")}
/**
 * The form's working values. Deliberately looser than the schema's input: a
 * number, choice or date the user has not filled in yet is \`undefined\` (or
 * \`null\` where the schema allows it), and validation reports the gap. Starting
 * a required number at 0 instead would submit a value nobody entered.
 */
export type ${names.valuesType} = ${objectType(input.form.fields, policy)};

/** What \`onSubmit\` receives: the schema's parsed output. */
export type ${names.dataType} = z.output<typeof ${input.schemaExport}>;

export const ${names.initialValues}: ${names.valuesType} = ${initialValuesOf(input.form.fields, policy)};
`;

export const pathsSection = (
  bindings: FormBindings,
  names: StateNames,
  usage: Usage,
  /** Where a field with no control can still be reached, as a sentence for its doc comment. */
  unboundHint: string,
): string => {
  const kinds = CONTROL_KINDS.filter((kind) => usage[kind]);
  const perKind = kinds.map(
    (kind) =>
      `export type ${names.hooks[kind].pathType} =\n${union(
        bindings.controls
          .filter((control) => control.kind === kind)
          .map((control) => pathTypeText(control.field.path)),
      )};`,
  );
  const lists = when(
    usage.list,
    `export type ${names.list.pathType} =\n${union(bindings.lists.map((list) => pathTypeText(list.path)))};`,
  );
  const unbound = when(
    bindings.unbound.length > 0,
    `/** Fields with no generated control. ${unboundHint} */
export type ${names.unboundPathType} =\n${union(bindings.unbound.map((field) => pathTypeText(field.path)))};`,
  );
  const variants = when(
    usage.variant,
    `export type ${names.variant.pathType} =\n${union(bindings.variants.map((entry) => pathTypeText(entry.field.path)))};`,
  );
  const all = [
    ...kinds.map((kind) => names.hooks[kind].pathType),
    ...(usage.list ? [names.list.pathType] : []),
    ...(usage.variant ? [names.variant.pathType] : []),
    ...(bindings.unbound.length > 0 ? [names.unboundPathType] : []),
  ];

  return `${section("Paths")}
// One union per kind of control, so a typo'd path — or a number path handed to
// a text control — fails to compile at the hook instead of rendering blank.
${perKind.join("\n\n")}

${lists}

${variants}

${unbound}

export type ${names.pathType} = ${all.length === 0 ? "never" : all.join(" | ")};
`;
};

/** The lookup type every table below is declared with. */
export const DICT_TYPE = "type Dict<T> = Readonly<Record<string, T | undefined>>;";

/** Text kinds blank to `""` and the rest to `undefined`; only exceptions are tabled. */
const emptyEntries = (
  bindings: FormBindings,
  policy: BlankPolicy,
): readonly (readonly [string, string])[] => [
  ...bindings.controls
    .filter((control) => control.kind !== "boolean")
    .filter((control) => blankOf(control.field, policy) !== defaultBlank(control))
    .map((control) => {
      // Branches of a union can share this path; they get one entry between
      // them (see ./conflicts), and `table` drops the repeats.
      const sharing = bindings.controls.filter(
        (other) => pathPattern(other.field.path) === pathPattern(control.field.path),
      );

      return [tableKey(control.field.path), printValue(effectiveBlank(sharing, policy))] as const;
    }),
  // A union clears like a choice does: to undefined unless the schema allows null.
  ...bindings.variants
    .filter((entry) => blankOf(entry.field, policy) !== undefined)
    .map(
      (entry) => [tableKey(entry.field.path), printValue(blankOf(entry.field, policy))] as const,
    ),
];

/**
 * What a cleared control writes back.
 *
 * For an adapter whose state library has no answer of its own: a store this
 * generator writes, or a form library that does not read blanks off the
 * schema. An adapter over a library that does (formstand) asks the library
 * instead and emits no table.
 */
export const emptyValuesTable = (bindings: FormBindings, policy: BlankPolicy): string => `
/**
 * What a cleared control writes back, where that is not the default for its
 * kind ("" for text, undefined for everything else). Keyed by path pattern:
 * "*" stands for any row.
 */
const emptyValues: Dict<null | undefined> = ${table(emptyEntries(bindings, policy))};
`;

/** A concrete path's key in the tables above. */
export const PATTERN_OF = `
/** A concrete path's table key: row indexes become "*". */
const patternOf = (path: string): string =>
  path
    .split(".")
    .map((segment) => (/^\\d+$/.test(segment) ? "*" : segment))
    .join(".");
`;

export const EMPTY_OF = `
const emptyOf = <Fallback extends "" | undefined>(
  path: string,
  fallback: Fallback,
): Fallback | null | undefined => {
  const key = patternOf(path);

  return key in emptyValues ? emptyValues[key] : fallback;
};
`;

const encodingOf = (field: FieldNode): string =>
  field.shape.kind !== "date"
    ? "iso-date"
    : field.shape.encoding === "date-object"
      ? field.shape.time
        ? "datetime"
        : "date"
      : field.shape.time
        ? "iso-datetime"
        : "iso-date";

export const dateEncodingsTable = (bindings: FormBindings): string => `
type DateEncoding = "iso-date" | "iso-datetime" | "date" | "datetime";

/** How each date is stored, where it is not plain "YYYY-MM-DD" text. */
const dateEncodings: Dict<DateEncoding> = ${table(
  bindings.controls
    .filter((control) => control.kind === "date" && encodingOf(control.field) !== "iso-date")
    .map((control) => [tableKey(control.field.path), JSON.stringify(encodingOf(control.field))]),
)};
`;

export const blankRowsTable = (bindings: FormBindings, policy: BlankPolicy): string => `
/** The row \`append\` adds to each list. */
const blankRows: Dict<unknown> = ${table(
  bindings.lists.map((list) => [tableKey(list.path), printValue(blankRowOf(list, policy))]),
)};
`;

/**
 * Each union's tag and branch blanks.
 *
 * `withEmpty` adds what the union itself clears to. An adapter that emits
 * `emptyValuesTable` reads it from there; one that leaves field blanks to its
 * library still needs it here, because the union is the one value the
 * generated code writes whole rather than through the library's field hook.
 */
export const unionsTable = (
  bindings: FormBindings,
  policy: BlankPolicy,
  withEmpty: boolean,
): string => `
/** Each union's tag property, ${when(withEmpty, "what it clears to, ")}and the blank value each of its branches starts from. */
const unions: Dict<Readonly<{ tag: string; ${when(withEmpty, "empty: null | undefined; ")}blanks: Readonly<Record<string, unknown>> }>> = ${table(
  bindings.variants.map((entry) => [
    tableKey(entry.field.path),
    `{ tag: ${JSON.stringify(entry.discriminator)}, ${when(
      withEmpty,
      `empty: ${printValue(blankOf(entry.field, policy))}, `,
    )}blanks: ${printValue(
      Object.fromEntries(
        entry.variants.map((variant) => [
          String(variant.tag),
          blankVariantOf(entry, variant, policy),
        ]),
      ),
    )} }`,
  ]),
)};
`;

/** Converts between a date control's local text and whatever the schema stores. */
export const DATE_HELPERS = `
const pad = (part: number): string => String(part).padStart(2, "0");

const localDate = (date: Date): string =>
  \`\${date.getFullYear()}-\${pad(date.getMonth() + 1)}-\${pad(date.getDate())}\`;

const localDateTime = (date: Date): string =>
  \`\${localDate(date)}T\${pad(date.getHours())}:\${pad(date.getMinutes())}\`;

// Date controls speak local "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm" text. These two
// convert between that and whatever the schema stores.
const dateToText = (value: unknown, encoding: DateEncoding): string => {
  if (encoding === "iso-date") return typeof value === "string" ? value : "";

  const date =
    value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;

  return date === undefined || Number.isNaN(date.getTime())
    ? ""
    : encoding === "date"
      ? localDate(date)
      : localDateTime(date);
};

const textToDate = (text: string, encoding: DateEncoding): unknown => {
  if (encoding === "iso-date") return text;

  // "T00:00" pins a bare date to local midnight; without it the Date
  // constructor reads "YYYY-MM-DD" as UTC and the day can shift by one.
  const date = new Date(encoding === "date" ? \`\${text}T00:00\` : text);

  return Number.isNaN(date.getTime())
    ? undefined
    : encoding === "iso-datetime"
      ? date.toISOString()
      : date;
};
`;

export const handlesSection = (names: StateNames, usage: Usage): string => `
${section("Handles")}
// What the hooks below return. The controls bind to these shapes and nothing
// else, so swapping the UI kit never touches this file.
${when(
  usage.control || usage.variant,
  `
export type FieldHandle<Value> = Readonly<{
  name: string;
  /** Always the control's own type: text for inputs, a boolean for a switch. */
  value: Value;
  /** Set once the field has been left or a submit was attempted. */
  error: string | undefined;
  setValue: (next: Value) => void;
  onBlur: () => void;
}>;
`,
)}${when(
  usage.choice,
  `
export type ${names.optionType} = Readonly<{ value: string | number; label: string }>;
`,
)}${when(
  usage.list,
  `
export type ListHandle = Readonly<{
  /** One stable key per row, in order. */
  ids: readonly string[];
  error: string | undefined;
  append: () => void;
  remove: (index: number) => void;
}>;
`,
)}
export type FormHandle = Readonly<{
  submitting: boolean;
  /** An error that belongs to no single field. */
  error: string | undefined;
  handleSubmit: (
    onValid: (data: ${names.dataType}) => void | Promise<void>,
  ) => (event: Readonly<{ preventDefault: () => void }>) => void;
  reset: () => void;
}>;
`;
