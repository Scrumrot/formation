import type {
  ControlKind,
  FieldNode,
  FormBindings,
  FormIR,
  StateAdapterInput,
} from "@formation/core";
import { collectBindings, isIdentifier, pathPattern, pathTypeText } from "@formation/core";

import { defaultBlank, effectiveBlank } from "./conflicts.js";
import type { StoreNames } from "./names.js";
import {
  blankOf,
  blankRowOf,
  blankVariantOf,
  initialValuesOf,
  objectType,
  printValue,
} from "./values.js";

/**
 * Emits the form's state module: one self-contained zustand store plus the
 * hooks the UI binds to.
 *
 * Self-contained on purpose. The output's only runtime dependencies are
 * zustand, zod and react; there is no `@formation/*` runtime package for the
 * generated code to import, because the ownership model is "generate once, the
 * file is yours" (docs/plan.md §1) and a hidden runtime would take that back.
 * The price is that each form carries its own copy of ~150 lines of plumbing.
 *
 * Everything below is conditional on what the form uses. That is not tidiness:
 * a user project with `noUnusedLocals` rejects a helper the form never calls,
 * so "emit the whole runtime every time" would generate code that fails to
 * compile for a form with, say, no lists.
 */

type Usage = Readonly<
  Record<ControlKind, boolean> & {
    list: boolean;
    variant: boolean;
    /** Any field control at all. */
    control: boolean;
    /** Something can be cleared, so `emptyOf` is needed. */
    empties: boolean;
    /** Something looks a path up in a table, so `patternOf` is needed. */
    patterns: boolean;
    /** Something reads a value by path, so `getAt` and `useError` are needed. */
    reads: boolean;
  }
>;

const usageOf = (bindings: FormBindings): Usage => {
  const has = (kind: ControlKind): boolean =>
    bindings.controls.some((control) => control.kind === kind);

  const list = bindings.lists.length > 0;
  const variant = bindings.variants.length > 0;
  const empties = has("text") || has("number") || has("choice") || has("date") || variant;

  return {
    text: has("text"),
    number: has("number"),
    boolean: has("boolean"),
    choice: has("choice"),
    date: has("date"),
    list,
    variant,
    control: bindings.controls.length > 0,
    empties,
    patterns: empties || list,
    reads: bindings.controls.length > 0 || list || variant,
  };
};

const tableKey = (path: readonly string[]): string => {
  const pattern = pathPattern(path);

  return isIdentifier(pattern) ? pattern : JSON.stringify(pattern);
};

// Two branches of a union may declare a field of the same name, which puts
// the same path in a table twice. A repeated key is a compile error in an
// object literal, so only the first entry is kept.
const table = (entries: readonly (readonly [string, string])[]): string => {
  const unique = entries.filter(
    ([name], index) => entries.findIndex(([other]) => other === name) === index,
  );

  return unique.length === 0
    ? "{}"
    : `{\n${unique.map(([name, value]) => `${name}: ${value},`).join("\n")}\n}`;
};

const union = (types: readonly string[]): string =>
  types.length === 0 ? "never" : [...new Set(types)].map((type) => `| ${type}`).join("\n");

/** Text kinds blank to `""` and the rest to `undefined`; only exceptions are tabled. */
const emptyEntries = (bindings: FormBindings): readonly (readonly [string, string])[] => [
  ...bindings.controls
    .filter((control) => control.kind !== "boolean")
    .filter((control) => blankOf(control.field) !== defaultBlank(control))
    .map((control) => {
      // Branches of a union can share this path; they get one entry between
      // them (see ./conflicts), and `table` drops the repeats.
      const sharing = bindings.controls.filter(
        (other) => pathPattern(other.field.path) === pathPattern(control.field.path),
      );

      return [tableKey(control.field.path), printValue(effectiveBlank(sharing))] as const;
    }),
  // A union clears like a choice does: to undefined unless the schema allows null.
  ...bindings.variants
    .filter((entry) => blankOf(entry.field) !== undefined)
    .map((entry) => [tableKey(entry.field.path), printValue(blankOf(entry.field))] as const),
];

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

const encodingEntries = (bindings: FormBindings): readonly (readonly [string, string])[] =>
  bindings.controls
    .filter((control) => control.kind === "date" && encodingOf(control.field) !== "iso-date")
    .map((control) => [tableKey(control.field.path), JSON.stringify(encodingOf(control.field))]);

const section = (title: string): string =>
  `\n// ---- ${title} ${"-".repeat(Math.max(4, 72 - title.length))}\n`;

const when = (condition: boolean, source: string): string => (condition ? source : "");

const pathsSection = (bindings: FormBindings, names: StoreNames, usage: Usage): string => {
  const kinds: readonly ControlKind[] = ["text", "number", "boolean", "choice", "date"];
  const perKind = kinds
    .filter((kind) => usage[kind])
    .map(
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
    `/** Fields with no generated control. They are in the store; bind them through \`${names.store}\`. */
export type ${names.unboundPathType} =\n${union(bindings.unbound.map((field) => pathTypeText(field.path)))};`,
  );
  const variants = when(
    usage.variant,
    `export type ${names.variant.pathType} =\n${union(bindings.variants.map((entry) => pathTypeText(entry.field.path)))};`,
  );
  const all = [
    ...kinds.filter((kind) => usage[kind]).map((kind) => names.hooks[kind].pathType),
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

const tablesSection = (bindings: FormBindings, usage: Usage): string =>
  `${when(
    usage.empties,
    `
/**
 * What a cleared control writes back, where that is not the default for its
 * kind ("" for text, undefined for everything else). Keyed by path pattern:
 * "*" stands for any row.
 */
const emptyValues: Dict<null | undefined> = ${table(emptyEntries(bindings))};
`,
  )}${when(
    usage.date,
    `
type DateEncoding = "iso-date" | "iso-datetime" | "date" | "datetime";

/** How each date is stored, where it is not plain "YYYY-MM-DD" text. */
const dateEncodings: Dict<DateEncoding> = ${table(encodingEntries(bindings))};
`,
  )}${when(
    usage.list,
    `
/** The row \`append\` adds to each list. */
const blankRows: Dict<unknown> = ${table(
      bindings.lists.map((list) => [tableKey(list.path), printValue(blankRowOf(list))]),
    )};
`,
  )}${when(
    usage.variant,
    `
/** Each union's tag property, and the blank value each of its branches starts from. */
const unions: Dict<Readonly<{ tag: string; blanks: Readonly<Record<string, unknown>> }>> = ${table(
      bindings.variants.map((entry) => [
        tableKey(entry.field.path),
        `{ tag: ${JSON.stringify(entry.discriminator)}, blanks: ${printValue(
          Object.fromEntries(
            entry.variants.map((variant) => [String(variant.tag), blankVariantOf(entry, variant)]),
          ),
        )} }`,
      ]),
    )};
`,
  )}`;

const helpersSection = (usage: Usage): string =>
  `${section("Path helpers")}
const segmentsOf = (path: string): readonly string[] => (path === "" ? [] : path.split("."));
${when(
  usage.reads,
  `
const getAt = (source: unknown, path: string): unknown =>
  segmentsOf(path).reduce<unknown>(
    (node, segment) =>
      typeof node === "object" && node !== null
        ? (node as Readonly<Record<string, unknown>>)[segment]
        : undefined,
    source,
  );
`,
)}
// Returns a copy with one path replaced; everything off that path keeps its
// identity, which is what lets each field re-render only when its own value changes.
const setAt = (source: unknown, segments: readonly string[], value: unknown): unknown => {
  const [head, ...rest] = segments;

  if (head === undefined) return value;
  if (Array.isArray(source)) {
    return source.map((item: unknown, index) =>
      String(index) === head ? setAt(item, rest, value) : item,
    );
  }

  const record =
    typeof source === "object" && source !== null
      ? (source as Readonly<Record<string, unknown>>)
      : {};

  return { ...record, [head]: setAt(record[head], rest, value) };
};

const dropKeys = <T>(dict: Dict<T>, drop: (key: string) => boolean): Dict<T> =>
  Object.fromEntries(Object.entries(dict).filter(([key]) => !drop(key)));
${when(
  usage.patterns,
  `
/** A concrete path's table key: row indexes become "*". */
const patternOf = (path: string): string =>
  segmentsOf(path)
    .map((segment) => (/^\\d+$/.test(segment) ? "*" : segment))
    .join(".");
`,
)}${when(
    usage.empties,
    `
const emptyOf = <Fallback extends "" | undefined>(
  path: string,
  fallback: Fallback,
): Fallback | null | undefined => {
  const key = patternOf(path);

  return key in emptyValues ? emptyValues[key] : fallback;
};
`,
  )}${when(
    usage.number,
    `
// Plain decimal notation only. Number() alone also reads "0x10" and "Infinity",
// neither of which anyone means in a form.
const DECIMAL_TEXT = /^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$/;

const parseNumber = (text: string): number | "empty" | "unfinished" => {
  const trimmed = text.trim();

  return trimmed === ""
    ? "empty"
    : DECIMAL_TEXT.test(trimmed) && Number.isFinite(Number(trimmed))
      ? Number(trimmed)
      : "unfinished";
};
`,
  )}${when(
    usage.date,
    `
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
`,
  )}`;

const storeSection = (input: StateAdapterInput, names: StoreNames, usage: Usage): string => `
${section("Validation")}
// The whole schema is parsed on every change. That keeps cross-field rules
// (refinements, "end after start") correct with no dependency tracking, and it
// is fast enough for forms; if a very large form ever drags, validate on blur.
const errorsOf = (values: ${names.valuesType}): Dict<string> => {
  const result = ${input.schemaExport}.safeParse(values);

  return result.success
    ? {}
    : result.error.issues.reduce<Dict<string>>((errors, issue) => {
        const key = issue.path.map(String).join(".");

        // The first issue per field is the one shown.
        return key in errors ? errors : { ...errors, [key]: issue.message };
      }, {});
};
${section("Store")}
type ${names.stateType} = Readonly<{
  values: ${names.valuesType};
  /** Validation's channel: rebuilt from the schema on every change. */
  errors: Dict<string>;
  /**
   * Your channel, for errors only the server knows ("email already taken").
   * Validation never touches it; editing the field releases its entry.
   */
  serverErrors: Dict<string>;
  touched: Dict<true>;
  submitCount: number;
  submitting: boolean;${when(
    usage.list,
    `
  /** Stable React keys per list, so removing a row does not remount the ones after it. */
  rowIds: Dict<readonly string[]>;
  nextRowId: number;`,
  )}
  setValue: (path: ${names.pathType}, value: unknown) => void;
  blur: (path: ${names.pathType}) => void;
  /** Pass "" as the path for an error that belongs to the form as a whole. */
  setFieldError: (path: ${names.pathType} | "", message: string) => void;${when(
    usage.list,
    `
  appendRow: (path: ${names.list.pathType}) => void;
  removeRow: (path: ${names.list.pathType}, index: number) => void;`,
  )}
  reset: (values?: ${names.valuesType}) => void;
  submit: (onValid: (data: ${names.dataType}) => void | Promise<void>) => Promise<void>;
}>;

const idle = (values: ${names.valuesType}) => ({
  values,
  errors: errorsOf(values),
  serverErrors: {},
  touched: {},
  submitCount: 0,
  submitting: false,${when(
    usage.list,
    `
  rowIds: {},
  nextRowId: 0,`,
  )}
});
${when(
  usage.list,
  `
const rowsAt = (values: ${names.valuesType}, path: string): readonly unknown[] => {
  const rows = getAt(values, path);

  return Array.isArray(rows) ? rows : [];
};

// Stored ids are trusted only while they match the row count. reset() and
// whole-array writes replace rows without updating them; positions stand in then.
const idsFor = (ids: readonly string[] | undefined, length: number): readonly string[] =>
  ids !== undefined && ids.length === length
    ? ids
    : Array.from({ length }, (_, index) => String(index));
`,
)}
/**
 * One store per form, created at module load. It outlives the component, so a
 * form that should start fresh each time it mounts calls \`reset()\` on mount.
 */
export const ${names.store} = create<${names.stateType}>()((set, get) => ({
  ...idle(${names.initialValues}),

  setValue: (path, value) =>
    set((state) => {
      // The cast is the one place types are asserted rather than checked: a
      // string path cannot prove to the compiler which value it replaces.
      const values = setAt(state.values, segmentsOf(path), value) as ${names.valuesType};

      return {
        values,
        errors: errorsOf(values),
        serverErrors: dropKeys(state.serverErrors, (key) => key === path),
      };
    }),

  blur: (path) => set((state) => ({ touched: { ...state.touched, [path]: true } })),

  setFieldError: (path, message) =>
    set((state) => ({ serverErrors: { ...state.serverErrors, [path]: message } })),
${when(
  usage.list,
  `
  appendRow: (path) =>
    set((state) => {
      const rows = rowsAt(state.values, path);
      const values = setAt(state.values, segmentsOf(path), [
        ...rows,
        blankRows[patternOf(path)],
      ]) as ${names.valuesType};

      return {
        values,
        errors: errorsOf(values),
        touched: { ...state.touched, [path]: true },
        rowIds: {
          ...state.rowIds,
          [path]: [...idsFor(state.rowIds[path], rows.length), \`row-\${state.nextRowId}\`],
        },
        nextRowId: state.nextRowId + 1,
      };
    }),

  removeRow: (path, index) =>
    set((state) => {
      const rows = rowsAt(state.values, path);
      const keep = <T>(items: readonly T[]): readonly T[] =>
        items.filter((_, position) => position !== index);
      const values = setAt(state.values, segmentsOf(path), keep(rows)) as ${names.valuesType};
      // Everything keyed beneath the list has just shifted by one row. Dropping
      // it beats leaving an error or a "touched" mark pointing at a neighbour.
      const beneath = (key: string): boolean => key.startsWith(\`\${path}.\`);

      return {
        values,
        errors: errorsOf(values),
        serverErrors: dropKeys(state.serverErrors, beneath),
        touched: { ...dropKeys(state.touched, beneath), [path]: true },
        rowIds: {
          ...dropKeys(state.rowIds, beneath),
          [path]: keep(idsFor(state.rowIds[path], rows.length)),
        },
      };
    }),
`,
)}
  reset: (values = ${names.initialValues}) => set(idle(values)),

  submit: async (onValid) => {
    const result = ${input.schemaExport}.safeParse(get().values);

    // Counting the attempt is what reveals errors on fields never visited.
    set((state) => ({ submitCount: state.submitCount + 1 }));

    if (!result.success) return;

    set({ submitting: true });
    try {
      await onValid(result.data);
    } finally {
      set({ submitting: false });
    }
  },
}));
`;

const handlesSection = (names: StoreNames, usage: Usage): string => `
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

const hooksSection = (names: StoreNames, usage: Usage): string => `
${section("Hooks")}
${when(
  usage.reads,
  `
// A server error shows at once; a validation error waits until the user has
// left the field or tried to submit, so a blank form is not a wall of red.
const useError = (path: string): string | undefined =>
  ${names.store}(
    (state) =>
      state.serverErrors[path] ??
      (state.touched[path] === true || state.submitCount > 0 ? state.errors[path] : undefined),
  );
`,
)}${when(
  usage.control,
  `
// Each selector returns one field's slice, so a keystroke re-renders that
// field's control and nothing else.
const useBinding = (path: ${names.pathType}) => ({
  value: ${names.store}((state) => getAt(state.values, path)),
  error: useError(path),
  setValue: ${names.store}((state) => state.setValue),
  blur: ${names.store}((state) => state.blur),
});
`,
)}${when(
  usage.text,
  `
export const ${names.hooks.text.name} = (path: ${names.hooks.text.pathType}): FieldHandle<string> => {
  const { value, error, setValue, blur } = useBinding(path);

  return {
    name: path,
    value: typeof value === "string" ? value : "",
    error,
    setValue: (text) => setValue(path, text === "" ? emptyOf(path, "") : text),
    onBlur: () => blur(path),
  };
};
`,
)}${when(
  usage.number,
  `
export const ${names.hooks.number.name} = (path: ${names.hooks.number.pathType}): FieldHandle<string> => {
  const { value, error, setValue, blur } = useBinding(path);
  // The text as typed, honoured only while the store still holds what it
  // parsed to. Without it "1." would snap back to "1" mid-keystroke and a
  // decimal could never be typed; with it, an outside write (reset, a server
  // value) still wins because the stored value no longer matches.
  const [typed, setTyped] = useState<Readonly<{ text: string; stored: unknown }> | undefined>(
    undefined,
  );

  return {
    name: path,
    value:
      typed !== undefined && Object.is(typed.stored, value)
        ? typed.text
        : typeof value === "number"
          ? String(value)
          : "",
    error,
    setValue: (text) => {
      const parsed = parseNumber(text);
      // "-" and "1e" are on their way to being numbers: keep the text, leave
      // the stored value alone rather than flashing a "required" error.
      const stored =
        parsed === "unfinished" ? value : parsed === "empty" ? emptyOf(path, undefined) : parsed;

      setTyped({ text, stored });
      if (parsed !== "unfinished") setValue(path, stored);
    },
    onBlur: () => {
      setTyped(undefined);
      blur(path);
    },
  };
};
`,
)}${when(
  usage.boolean,
  `
export const ${names.hooks.boolean.name} = (path: ${names.hooks.boolean.pathType}): FieldHandle<boolean> => {
  const { value, error, setValue, blur } = useBinding(path);

  return {
    name: path,
    value: value === true,
    error,
    setValue: (next) => setValue(path, next),
    onBlur: () => blur(path),
  };
};
`,
)}${when(
  usage.choice,
  `
export const ${names.hooks.choice.name} = (
  path: ${names.hooks.choice.pathType},
  options: readonly ${names.optionType}[],
): FieldHandle<string> => {
  const { value, error, setValue, blur } = useBinding(path);

  return {
    name: path,
    // The control speaks text; the store keeps the option's own value, so a
    // numeric enum stays a number in what gets submitted.
    value: typeof value === "string" || typeof value === "number" ? String(value) : "",
    error,
    setValue: (text) =>
      setValue(
        path,
        options.find((option) => String(option.value) === text)?.value ??
          emptyOf(path, undefined),
      ),
    onBlur: () => blur(path),
  };
};
`,
)}${when(
  usage.date,
  `
export const ${names.hooks.date.name} = (path: ${names.hooks.date.pathType}): FieldHandle<string> => {
  const { value, error, setValue, blur } = useBinding(path);
  const encoding = dateEncodings[patternOf(path)] ?? "iso-date";

  return {
    name: path,
    value: dateToText(value, encoding),
    error,
    setValue: (text) =>
      setValue(path, text === "" ? emptyOf(path, undefined) : textToDate(text, encoding)),
    onBlur: () => blur(path),
  };
};
`,
)}${when(
  usage.list,
  `
export const ${names.list.name} = (path: ${names.list.pathType}): ListHandle => {
  // Two primitive-ish selections rather than one derived array: a selector that
  // builds a fresh array on every call would re-render forever.
  const length = ${names.store}((state) => rowsAt(state.values, path).length);
  const ids = ${names.store}((state) => state.rowIds[path]);
  const error = useError(path);
  const appendRow = ${names.store}((state) => state.appendRow);
  const removeRow = ${names.store}((state) => state.removeRow);

  return {
    ids: idsFor(ids, length),
    error,
    append: () => appendRow(path),
    remove: (index) => removeRow(path, index),
  };
};
`,
)}${when(
  usage.variant,
  `
export const ${names.variant.name} = (path: ${names.variant.pathType}): FieldHandle<string> => {
  const union = unions[patternOf(path)];
  // Only the tag is selected, so typing in one of the branch's fields does not
  // re-render the branch picker.
  const tag = ${names.store}((state) => {
    const value = getAt(state.values, path);

    return union !== undefined && typeof value === "object" && value !== null
      ? (value as Readonly<Record<string, unknown>>)[union.tag]
      : undefined;
  });
  // Zod reports a union with no branch at the union's own path, and a branch
  // it does not recognise at the tag's. Either belongs under this control.
  const unionError = useError(path);
  const tagError = useError(union === undefined ? path : \`\${path}.\${union.tag}\`);
  const setValue = ${names.store}((state) => state.setValue);
  const blur = ${names.store}((state) => state.blur);

  return {
    name: path,
    value: typeof tag === "string" || typeof tag === "number" ? String(tag) : "",
    error: unionError ?? tagError,
    // Choosing a branch replaces the whole union with that branch's blank.
    // Keeping the old branch's fields would send them along on submit, where a
    // strict schema rejects them and a loose one silently accepts stale data.
    setValue: (text) =>
      setValue(
        path,
        union !== undefined && Object.keys(union.blanks).includes(text)
          ? union.blanks[text]
          : emptyOf(path, undefined),
      ),
    onBlur: () => blur(path),
  };
};
`,
)}
export const ${names.form} = (): FormHandle => {
  const submitting = ${names.store}((state) => state.submitting);
  const error = ${names.store}(
    (state) => state.serverErrors[""] ?? (state.submitCount > 0 ? state.errors[""] : undefined),
  );
  const submit = ${names.store}((state) => state.submit);
  const reset = ${names.store}((state) => state.reset);

  return {
    submitting,
    error,
    handleSubmit: (onValid) => (event) => {
      event.preventDefault();
      void submit(onValid);
    },
    reset: () => reset(),
  };
};
`;

/** The state module's source. Unformatted; the CLI runs Prettier over it. */
export const emitStore = (input: StateAdapterInput, names: StoreNames): string => {
  const form: FormIR = input.form;
  const bindings = collectBindings(form.fields);
  const usage = usageOf(bindings);

  return `${when(usage.number, `import { useState } from "react";\n`)}import type { z } from "zod";
import { create } from "zustand";

import { ${input.schemaExport} } from "./${input.schemaModule}";
${section("Values")}
/**
 * The form's working values. Deliberately looser than the schema's input: a
 * number, choice or date the user has not filled in yet is \`undefined\` (or
 * \`null\` where the schema allows it), and validation reports the gap. Starting
 * a required number at 0 instead would submit a value nobody entered.
 */
export type ${names.valuesType} = ${objectType(form.fields)};

/** What \`onSubmit\` receives: the schema's parsed output. */
export type ${names.dataType} = z.output<typeof ${input.schemaExport}>;

export const ${names.initialValues}: ${names.valuesType} = ${initialValuesOf(form.fields)};
${pathsSection(bindings, names, usage)}
type Dict<T> = Readonly<Record<string, T | undefined>>;
${when(usage.patterns, section("Field tables"))}${tablesSection(bindings, usage)}${helpersSection(usage)}${storeSection(input, names, usage)}${handlesSection(names, usage)}${hooksSection(names, usage)}`;
};
