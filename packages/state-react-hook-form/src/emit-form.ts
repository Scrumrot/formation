import type { FormBindings, StateAdapterInput } from "@formation/core";
import { collectBindings } from "@formation/core";
import type { Usage } from "@formation/state-kit";
import {
  DATE_HELPERS,
  DICT_TYPE,
  EMPTY_OF,
  NUMBER_HELPERS,
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

import type { FormNames } from "./names.js";
import { BLANKS } from "./names.js";

/**
 * Emits the form's state module for react-hook-form: one form created outside
 * React with `createFormControl`, validated through the zod resolver, and the
 * contract's hooks as wrappers over `useController`.
 *
 * Two things about react-hook-form shape this module.
 *
 * It is built around uncontrolled inputs, and the UI kits this generator
 * targets are controlled. `useController` is react-hook-form's own bridge for
 * that, and it hands back exactly what a field handle needs — a value, an
 * `onChange`, an `onBlur`, the field's error — so the contract did not have to
 * move to fit it.
 *
 * A form normally lives in the component that calls `useForm()` and reaches
 * its fields through a context provider. The contract has no provider: a hook
 * takes a path and nothing else. `createFormControl` is what makes that work —
 * the form is a module-level object, as the zustand store and the formstand
 * form are, and `useForm({ formControl })` in the form hook only connects it to
 * React's lifecycle.
 */

/** Which of react-hook-form's exports the module uses, so none is imported unused. */
const libraryImports = (usage: Usage): string => {
  const values = [
    "createFormControl",
    ...(usage.list || usage.variant ? ["get"] : []),
    ...(usage.control ? ["useController"] : []),
    "useForm",
    "useFormState",
    ...(usage.list || usage.variant ? ["useWatch"] : []),
  ];
  const types = ["FieldValues", "Resolver", "UseFormReturn"];

  return [...values, ...types.map((name) => `type ${name}`)]
    .sort((a, b) => a.replace("type ", "").localeCompare(b.replace("type ", "")))
    .join(",\n  ");
};

const tablesSection = (bindings: FormBindings, usage: Usage): string =>
  when(
    usage.patterns,
    `${section("Field tables")}
${DICT_TYPE}
${when(usage.empties, emptyValuesTable(bindings, BLANKS))}${when(
      usage.date,
      dateEncodingsTable(bindings),
    )}${when(usage.list, blankRowsTable(bindings, BLANKS))}${when(
      usage.variant,
      unionsTable(bindings, BLANKS, false),
    )}${PATTERN_OF}${when(usage.empties, EMPTY_OF)}${when(usage.number, NUMBER_HELPERS)}${when(
      usage.date,
      DATE_HELPERS,
    )}`,
  );

const formSection = (input: StateAdapterInput, names: FormNames, usage: Usage): string => `
${section("Form")}
// The schema does the validating. The cast is deliberate: the resolver is
// typed by the schema's input, and the form's working values are looser than
// that (a blank required number is \`undefined\`) so that validation has a gap
// to report.
const resolver = zodResolver(${input.schemaExport}) as unknown as Resolver<
  ${names.valuesType},
  unknown,
  ${names.dataType}
>;

// A field is judged when it is left and on every change after that, so a blank
// form is not a wall of red and a fixed mistake clears as it is typed.
const MODE = "onTouched";

/**
 * The react-hook-form form. One per module, created at load rather than by
 * \`useForm()\` in a component: it outlives the component, so a form that should
 * start fresh each time it mounts calls \`${names.instance}.reset()\` on mount.
 *
 * This is what \`useForm()\` returns, minus \`formState\` — \`getValues\`,
 * \`setValue\`, \`reset\`, \`watch\`, \`trigger\`. For a verdict only the server
 * knows, \`${names.instance}.setError("email", { type: "server", message })\`: an
 * error of type "server" is released when that field is next edited. For one
 * that belongs to the whole form, \`setError("root", { message })\`.
 */
export const ${names.instance} = createFormControl<${names.valuesType}, unknown, ${names.dataType}>({
  defaultValues: ${names.initialValues},
  resolver,
  mode: MODE,
});

// react-hook-form types a path against the form's values, and that type cannot
// name a field inside one branch of a union ("payment.last4"). The hooks below
// take this module's own path unions instead and address the same form by
// plain string. So does the form hook, for the two keys form-level errors are
// filed under, which are not field paths either.
const untyped = ${names.instance} as unknown as Omit<UseFormReturn<FieldValues>, "formState">;

// react-hook-form nests errors by path. At a container's path the entry may be
// the errors of the fields beneath it rather than an error of its own, so a
// message is only taken when it is one.
const messageOf = (entry: unknown): string | undefined => {
  const message =
    typeof entry === "object" && entry !== null
      ? (entry as Readonly<Record<string, unknown>>).message
      : undefined;

  return typeof message === "string" ? message : undefined;
};
${when(
  usage.list || usage.variant,
  `
const messageAt = (errors: unknown, path: string): string | undefined =>
  messageOf(get(errors, path));
`,
)}`;

const hooksSection = (names: FormNames, usage: Usage): string => `
${section("Hooks")}
${when(
  usage.control,
  `
// One field's slice of the form. \`useController\` subscribes this component to
// that field alone, so a keystroke re-renders one control.
const useBinding = (path: ${names.pathType}) => {
  const { field, fieldState } = useController({ control: untyped.control, name: path });
  const value: unknown = field.value;

  return {
    name: field.name,
    value,
    error: fieldState.error?.message,
    change: (next: unknown) => {
      // An error the app set is not validation's to clear, and until a field
      // has been left no validation runs on change at all. Released here, so
      // "already registered" does not outlive the value it was about.
      if (fieldState.error?.type === "server") untyped.clearErrors(path);
      field.onChange(next);
    },
    blur: field.onBlur,
  };
};
`,
)}${when(
  usage.text,
  `
export const ${names.hooks.text.name} = (path: ${names.hooks.text.pathType}): FieldHandle<string> => {
  const { name, value, error, change, blur } = useBinding(path);

  return {
    name,
    value: typeof value === "string" ? value : "",
    error,
    setValue: (text) => change(text === "" ? emptyOf(path, "") : text),
    onBlur: blur,
  };
};
`,
)}${when(
  usage.number,
  `
export const ${names.hooks.number.name} = (path: ${names.hooks.number.pathType}): FieldHandle<string> => {
  const { name, value, error, change, blur } = useBinding(path);
  // The text as typed, honoured only while the form still holds what it
  // parsed to. Without it "1." would snap back to "1" mid-keystroke and a
  // decimal could never be typed; with it, an outside write (reset, a server
  // value) still wins because the stored value no longer matches.
  const [typed, setTyped] = useState<Readonly<{ text: string; stored: unknown }> | undefined>(
    undefined,
  );

  return {
    name,
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
      if (parsed !== "unfinished") change(stored);
    },
    onBlur: () => {
      setTyped(undefined);
      blur();
    },
  };
};
`,
)}${when(
  usage.boolean,
  `
export const ${names.hooks.boolean.name} = (path: ${names.hooks.boolean.pathType}): FieldHandle<boolean> => {
  const { name, value, error, change, blur } = useBinding(path);

  return { name, value: value === true, error, setValue: change, onBlur: blur };
};
`,
)}${when(
  usage.choice,
  `
export const ${names.hooks.choice.name} = (
  path: ${names.hooks.choice.pathType},
  options: readonly ${names.optionType}[],
): FieldHandle<string> => {
  const { name, value, error, change, blur } = useBinding(path);

  return {
    name,
    // The control speaks text; the form keeps the option's own value, so a
    // numeric enum stays a number in what gets submitted.
    value: typeof value === "string" || typeof value === "number" ? String(value) : "",
    error,
    setValue: (text) =>
      change(
        options.find((option) => String(option.value) === text)?.value ?? emptyOf(path, undefined),
      ),
    onBlur: blur,
  };
};
`,
)}${when(
  usage.date,
  `
export const ${names.hooks.date.name} = (path: ${names.hooks.date.pathType}): FieldHandle<string> => {
  const { name, value, error, change, blur } = useBinding(path);
  const encoding = dateEncodings[patternOf(path)] ?? "iso-date";

  return {
    name,
    value: dateToText(value, encoding),
    error,
    setValue: (text) =>
      change(text === "" ? emptyOf(path, undefined) : textToDate(text, encoding)),
    onBlur: blur,
  };
};
`,
)}${when(
  usage.list,
  `
export const ${names.list.name} = (path: ${names.list.pathType}): ListHandle => {
  // Not \`useFieldArray\`. It drops falsy rows on every operation, so it cannot
  // hold a blank row of a list of plain values ("" or 0) or of a union with
  // no branch chosen yet (undefined). Rows are written with \`setValue\`
  // instead, and identified here.
  const length = useWatch({
    control: untyped.control,
    name: path,
    // Only the row count: typing in a row must not re-render the list.
    compute: (rows: unknown) => (Array.isArray(rows) ? rows.length : 0),
  });
  const { errors, isSubmitted } = useFormState({ control: untyped.control, name: path });
  const [keyed, setKeyed] = useState<Readonly<{ ids: readonly string[]; next: number }>>({
    ids: [],
    next: 0,
  });
  // Ids are trusted only while they match the row count. reset() and writes
  // from outside this hook replace rows without telling it; positions stand in.
  const ids =
    keyed.ids.length === length
      ? keyed.ids
      : Array.from({ length }, (_, index) => String(index));
  const write = (rows: readonly unknown[], nextIds: readonly string[], next: number): void => {
    setKeyed({ ids: nextIds, next });
    untyped.setValue(path, rows, { shouldDirty: true });
    // After a submit every error is on show, so the list's own ("add at least
    // two") has to follow the rows. Before one, nothing is judged early.
    if (isSubmitted) void untyped.trigger(path);
  };
  const rowsNow = (): readonly unknown[] => {
    const rows: unknown = untyped.getValues(path);

    return Array.isArray(rows) ? rows : [];
  };

  return {
    ids,
    // While a list has rows, the resolver files its own error under \`root\`,
    // beside the rows' errors; with none, at the path.
    error: messageAt(errors, \`\${path}.root\`) ?? messageAt(errors, path),
    append: () =>
      write([...rowsNow(), blankRows[patternOf(path)]], [...ids, \`row-\${keyed.next}\`], keyed.next + 1),
    remove: (index) => {
      const keep = <T,>(items: readonly T[]): readonly T[] =>
        items.filter((_, position) => position !== index);

      // Errors are filed by row position, and every row after this one is
      // about to move up. Dropping them beats showing one row's error on its
      // neighbour; validation puts back whichever still apply.
      untyped.clearErrors(path);
      write(keep(rowsNow()), keep(ids), keyed.next);
    },
  };
};
`,
)}${when(
  usage.variant,
  `
export const ${names.variant.name} = (path: ${names.variant.pathType}): FieldHandle<string> => {
  const union = unions[patternOf(path)];
  const tagPath = union === undefined ? path : \`\${path}.\${union.tag}\`;
  // Only the tag is watched, so typing in one of the branch's fields does not
  // re-render the branch picker.
  const tag: unknown = useWatch({ control: untyped.control, name: tagPath });
  const { errors } = useFormState({ control: untyped.control, name: path });
  const chosen = typeof tag === "string" || typeof tag === "number";

  return {
    name: path,
    value: chosen ? String(tag) : "",
    // Zod reports a union with no branch at the union's own path, and a branch
    // it does not recognise at the tag's. Either belongs under this control.
    error: messageAt(errors, path) ?? messageAt(errors, tagPath),
    setValue: (text) => {
      // Whatever was said about the old choice, or about the old branch's
      // fields, no longer describes what is there.
      untyped.clearErrors(path);
      // Choosing a branch replaces the whole union with that branch's blank.
      // Keeping the old branch's fields would send them along on submit, where
      // a strict schema rejects them and a loose one accepts stale data.
      untyped.setValue(
        path,
        union !== undefined && Object.keys(union.blanks).includes(text)
          ? union.blanks[text]
          : emptyOf(path, undefined),
        { shouldDirty: true },
      );
    },
    onBlur: () => {
      // Leaving the picker with nothing chosen is the one case judged here.
      // Once a branch exists, validating the union would light up every field
      // of it; those fields validate themselves as they are left.
      if (!chosen) void untyped.trigger(path);
    },
  };
};
`,
)}
export const ${names.form} = (): FormHandle => {
  // Connects the module's form to React while this component is mounted. The
  // options are repeated on purpose: \`useForm\` resets to its default any
  // option it is not handed, and that would drop the resolver.
  const { formState } = useForm<${names.valuesType}, unknown, ${names.dataType}>({
    formControl: ${names.instance}.formControl,
    resolver,
    mode: MODE,
  });
  // Named, so this component re-renders for a form-level error and not for
  // every field's.
  const { errors } = useFormState({ control: untyped.control, name: "root" });

  return {
    submitting: formState.isSubmitting,
    // "root" is where setError("root", …) puts an error of the app's; the
    // empty key is where the resolver files an issue with no path (an
    // object-level refinement that names no field). That key is read
    // directly: react-hook-form's path lookup does not resolve an empty path.
    error: messageOf(errors.root) ?? messageOf(errors[""]),
    handleSubmit: (onValid) => (event) => {
      event.preventDefault();
      void ${names.instance}.handleSubmit(onValid)();
    },
    reset: () => ${names.instance}.reset(),
  };
};
`;

/** The state module's source. Unformatted; the CLI runs Prettier over it. */
export const emitForm = (input: StateAdapterInput, names: FormNames): string => {
  const bindings = collectBindings(input.form.fields);
  const usage = usageOf(bindings);

  return `import { zodResolver } from "@hookform/resolvers/zod";
${when(usage.number || usage.list, `import { useState } from "react";\n`)}import {
  ${libraryImports(usage)},
} from "react-hook-form";
import type { z } from "zod";

import { ${input.schemaExport} } from "./${input.schemaModule}";
${valuesSection(input, names, BLANKS)}${pathsSection(
    bindings,
    names,
    usage,
    `They are in the form; reach them with \`${names.instance}.getValues\` and \`${names.instance}.setValue\`.`,
  )}${tablesSection(bindings, usage)}${formSection(input, names, usage)}${handlesSection(names, usage)}${hooksSection(names, usage)}`;
};
