import type { FormBindings, StateAdapterInput } from "@formation/core";
import { collectBindings } from "@formation/core";
import type { Usage } from "@formation/state-kit";
import {
  DATE_HELPERS,
  DICT_TYPE,
  EMPTY_OF,
  PATTERN_OF,
  blankRowsTable,
  dateEncodingsTable,
  emptyValuesTable,
  handlesSection,
  pathsSection,
  section,
  unionsTable,
  usageOf,
  valuesSection,
  when,
} from "@formation/state-kit";

import type { StoreNames } from "./names.js";
import { BLANKS } from "./names.js";

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
 * The values, paths and handle types come from state-kit, which every state
 * adapter shares; what is written here is the part only a hand-rolled store
 * needs — the store itself, and hooks that read and write it.
 *
 * Everything below is conditional on what the form uses. That is not tidiness:
 * a user project with `noUnusedLocals` rejects a helper the form never calls,
 * so "emit the whole runtime every time" would generate code that fails to
 * compile for a form with, say, no lists.
 */

const tablesSection = (bindings: FormBindings, usage: Usage): string =>
  `${when(usage.empties, emptyValuesTable(bindings, BLANKS))}${when(
    usage.date,
    dateEncodingsTable(bindings),
  )}${when(usage.list, blankRowsTable(bindings, BLANKS))}${when(usage.variant, unionsTable(bindings, BLANKS, false))}`;

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
${when(usage.patterns, PATTERN_OF)}${when(usage.empties, EMPTY_OF)}${when(
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
  )}${when(usage.date, DATE_HELPERS)}`;

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
  const bindings = collectBindings(input.form.fields);
  const usage = usageOf(bindings);

  return `${when(usage.number, `import { useState } from "react";\n`)}import type { z } from "zod";
import { create } from "zustand";

import { ${input.schemaExport} } from "./${input.schemaModule}";
${valuesSection(input, names, BLANKS)}${pathsSection(
    bindings,
    names,
    usage,
    `They are in the store; bind them through \`${names.store}\`.`,
  )}
${DICT_TYPE}
${when(usage.patterns, section("Field tables"))}${tablesSection(bindings, usage)}${helpersSection(usage)}${storeSection(input, names, usage)}${handlesSection(names, usage)}${hooksSection(names, usage)}`;
};
