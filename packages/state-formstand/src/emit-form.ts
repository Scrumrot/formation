import type { FormBindings, StateAdapterInput } from "@formation/core";
import { collectBindings } from "@formation/core";
import type { Usage } from "@formation/state-kit";
import {
  DATE_HELPERS,
  DICT_TYPE,
  PATTERN_OF,
  blankRowsTable,
  dateEncodingsTable,
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
 * Emits the form's state module for formstand: one `createForm` instance, and
 * the contract's hooks as thin wrappers over formstand's own.
 *
 * Where the zustand adapter has to write a store, this one has a library that
 * already is one, so the rule here is to add nothing formstand does itself:
 * when an error becomes visible is formstand's validation `mode`, not a
 * touched-or-submitted check of our own, and row identity is
 * `useFieldArray`'s.
 *
 * That includes what a cleared field holds. `useField` reads it off the
 * schema (`emptyValue`, `clearable`) and the hooks below write exactly that,
 * so a generated control clears a field to the same value formstand's own
 * `TextField` would. The one place this differs from a store the generator
 * writes itself is a field that is both optional and nullable: formstand says
 * `undefined`, the zustand output says `null`.
 *
 * What is left to generate is what formstand cannot know: the form's blank
 * starting values (printed under the same rule, see `BLANKS`), the row each
 * list appends, the blank each union branch starts from, and how each date is
 * stored.
 */

/** Which of formstand's exports the module uses, so none is imported unused. */
const formstandImports = (usage: Usage): string => {
  const values = [
    "createForm",
    ...(usage.control ? ["useField"] : []),
    ...(usage.list ? ["useFieldArray"] : []),
    "useFormError",
    ...(usage.variant ? ["getAtPath", "useFormSelector"] : []),
    "useIsSubmitting",
    ...(usage.number ? ["numberToInputText", "parseNumberText"] : []),
  ];
  const types = [
    ...(usage.list ? ["FieldArrayFormApi"] : []),
    ...(usage.reads ? ["FieldFormApi"] : []),
  ];

  return [...values, ...types.map((name) => `type ${name}`)]
    .sort((a, b) => a.replace("type ", "").localeCompare(b.replace("type ", "")))
    .join(",\n  ");
};

const tablesSection = (bindings: FormBindings, usage: Usage): string => {
  // Lists and unions are looked up by path pattern; dates too, though only
  // the ones stored as something other than plain "YYYY-MM-DD" text have an
  // entry. Field blanks are not tabled at all: formstand answers those.
  const tabled = usage.date || usage.list || usage.variant;

  return when(
    tabled,
    `${section("Field tables")}
${DICT_TYPE}
${when(usage.date, dateEncodingsTable(bindings))}${when(
      usage.list,
      blankRowsTable(bindings, BLANKS),
    )}${when(usage.variant, unionsTable(bindings, BLANKS, true))}${PATTERN_OF}${when(
      usage.date,
      DATE_HELPERS,
    )}`,
  );
};

const formSection = (input: StateAdapterInput, names: FormNames, usage: Usage): string => `
${section("Form")}
/**
 * The formstand form. One per module, created at load: it outlives the
 * component, so a form that should start fresh each time it mounts calls
 * \`${names.instance}.reset()\` on mount.
 *
 * Everything formstand offers hangs off this object — \`setError\` for a
 * verdict only the server knows, \`useIsDirty(${names.instance})\`, \`diff()\`,
 * the devtools panel.
 */
export const ${names.instance} = createForm(${input.schemaExport}, {
  // The cast is deliberate. A form starts blank, and "blank" has no spelling in
  // the schema's input type for a required number or a required choice; the
  // working values admit \`undefined\` there and validation reports the gap.
  initialValues: ${names.initialValues} as unknown as z.input<typeof ${input.schemaExport}>,
  // A field is judged when it is left and on every change after that, so a
  // blank form is not a wall of red and a fixed mistake clears as it is typed.
  mode: "onTouched",
});
${when(
  usage.reads,
  `
// formstand types a path against the schema's input, and that type cannot
// name a field inside one branch of a union ("payment.last4"). The hooks below
// take this module's own path unions instead and bind by plain string, which
// is the binding formstand provides for exactly that case. It is the same
// object: the schema still travels with it, so blanks are still read from it.
const untyped: FieldFormApi${when(usage.list, " & FieldArrayFormApi")} = ${names.instance};
`,
)}`;

const hooksSection = (names: FormNames, usage: Usage): string => `
${section("Hooks")}
${when(
  usage.text,
  `
export const ${names.hooks.text.name} = (path: ${names.hooks.text.pathType}): FieldHandle<string> => {
  const field = useField(untyped, path);

  return {
    name: field.path,
    value: typeof field.value === "string" ? field.value : "",
    error: field.firstError,
    // A cleared optional field goes back to undefined and a nullable one to
    // null. A required string stays "": that is a value the schema can judge,
    // where a hole would be a type error the user cannot act on.
    setValue: (text) => field.setValue(text === "" && field.clearable ? field.emptyValue : text),
    onBlur: field.onBlur,
  };
};
`,
)}${when(
  usage.number,
  `
export const ${names.hooks.number.name} = (path: ${names.hooks.number.pathType}): FieldHandle<string> => {
  const field = useField(untyped, path);
  const value = field.value;
  // The text as typed, honoured only while the form still holds what it
  // parsed to. Without it "1." would snap back to "1" mid-keystroke and a
  // decimal could never be typed; with it, an outside write (reset, a server
  // value) still wins because the stored value no longer matches.
  const [typed, setTyped] = useState<Readonly<{ text: string; stored: unknown }> | undefined>(
    undefined,
  );

  return {
    name: field.path,
    value:
      typed !== undefined && Object.is(typed.stored, value)
        ? typed.text
        : numberToInputText(typeof value === "number" ? value : undefined),
    error: field.firstError,
    setValue: (text) => {
      const parsed = parseNumberText(text);
      // "-" and "1e" are on their way to being numbers: keep the text, leave
      // the stored value alone rather than flashing a "required" error.
      const stored =
        parsed.kind === "invalid"
          ? value
          : parsed.kind === "number"
            ? parsed.value
            : field.emptyValue;

      setTyped({ text, stored });
      if (parsed.kind !== "invalid") field.setValue(stored);
    },
    onBlur: () => {
      setTyped(undefined);
      field.onBlur();
    },
  };
};
`,
)}${when(
  usage.boolean,
  `
export const ${names.hooks.boolean.name} = (path: ${names.hooks.boolean.pathType}): FieldHandle<boolean> => {
  const field = useField(untyped, path);

  return {
    name: field.path,
    value: field.value === true,
    error: field.firstError,
    setValue: field.setValue,
    onBlur: field.onBlur,
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
  const field = useField(untyped, path);
  const value = field.value;

  return {
    name: field.path,
    // The control speaks text; the form keeps the option's own value, so a
    // numeric enum stays a number in what gets submitted.
    value: typeof value === "string" || typeof value === "number" ? String(value) : "",
    error: field.firstError,
    // No option chosen is written as the field's blank even where the schema
    // requires a choice: "" is not one of the options, so it could only ever
    // be reported as an invalid value rather than a missing one.
    setValue: (text) =>
      field.setValue(
        options.find((option) => String(option.value) === text)?.value ?? field.emptyValue,
      ),
    onBlur: field.onBlur,
  };
};
`,
)}${when(
  usage.date,
  `
export const ${names.hooks.date.name} = (path: ${names.hooks.date.pathType}): FieldHandle<string> => {
  const field = useField(untyped, path);
  const encoding = dateEncodings[patternOf(path)] ?? "iso-date";

  return {
    name: field.path,
    value: dateToText(field.value, encoding),
    error: field.firstError,
    setValue: (text) => field.setValue(text === "" ? field.emptyValue : textToDate(text, encoding)),
    onBlur: field.onBlur,
  };
};
`,
)}${when(
  usage.list,
  `
export const ${names.list.name} = (path: ${names.list.pathType}): ListHandle => {
  const list = useFieldArray(untyped, path);

  return {
    // formstand's row ids survive removes and reorders, which is what keeps a
    // row's controls mounted when the one above it goes away.
    ids: list.fields.map((row) => row.id),
    error: list.firstError,
    append: () => list.push(blankRows[patternOf(path)]),
    remove: list.remove,
  };
};
`,
)}${when(
  usage.variant,
  `
export const ${names.variant.name} = (path: ${names.variant.pathType}): FieldHandle<string> => {
  const union = unions[patternOf(path)];
  const tagPath = union === undefined ? path : \`\${path}.\${union.tag}\`;
  // Only the tag is selected, so typing in one of the branch's fields does not
  // re-render the branch picker.
  const tag = useFormSelector(untyped, (state) => getAtPath(state.values, tagPath));
  const unionError = useFormSelector(untyped, (state) => state.errors[path]?.[0]);
  const tagError = useFormSelector(untyped, (state) => state.errors[tagPath]?.[0]);
  const chosen = typeof tag === "string" || typeof tag === "number";

  return {
    name: path,
    value: chosen ? String(tag) : "",
    // Zod reports a union with no branch at the union's own path. That verdict
    // is shown only while no branch is chosen: choosing one answers it, and
    // the new branch's fields are then judged as they are filled in rather
    // than all at once the moment they appear.
    error: chosen ? tagError : (unionError ?? tagError),
    // Choosing a branch replaces the whole union with that branch's blank.
    // Keeping the old branch's fields would send them along on submit, where a
    // strict schema rejects them and a loose one silently accepts stale data.
    setValue: (text) =>
      untyped.setValue(
        path,
        union !== undefined && Object.keys(union.blanks).includes(text)
          ? union.blanks[text]
          : union?.empty,
      ),
    onBlur: () => {
      untyped.setTouched(path, true);
      // Leaving the picker with nothing chosen is the one case judged here.
      // Once a branch exists, validating the union would light up every field
      // of it; those fields validate themselves as they are left.
      if (!chosen) untyped.validateField(path);
    },
  };
};
`,
)}
export const ${names.form} = (): FormHandle => {
  const submitting = useIsSubmitting(${names.instance});
  const error = useFormError(${names.instance})?.[0];

  return {
    submitting,
    error,
    handleSubmit: (onValid) => (event) => {
      // formstand resolves rather than rejects when \`onValid\` throws, so that
      // its handler is safe to hand to a form. Rejecting here keeps a failed
      // save from passing in silence: it reaches the console and any error
      // reporting. To show it in the form, catch it in \`onSubmit\` and call
      // \`${names.instance}.setError("", message)\`.
      void ${names.instance}
        .handleSubmit(onValid)(event)
        .then((result) => (result.kind === "error" ? Promise.reject(result.error) : undefined));
    },
    reset: () => ${names.instance}.reset(),
  };
};
`;

/** The state module's source. Unformatted; the CLI runs Prettier over it. */
export const emitForm = (input: StateAdapterInput, names: FormNames): string => {
  const bindings = collectBindings(input.form.fields);
  const usage = usageOf(bindings);

  return `import {
  ${formstandImports(usage)},
} from "formstand";
${when(usage.number, `import { useState } from "react";\n`)}import type { z } from "zod";

import { ${input.schemaExport} } from "./${input.schemaModule}";
${valuesSection(input, names, BLANKS)}${pathsSection(
    bindings,
    names,
    usage,
    `They are in the form; bind them with formstand's own \`useField(${names.instance}, path)\`.`,
  )}${tablesSection(bindings, usage)}${formSection(input, names, usage)}${handlesSection(names, usage)}${hooksSection(names, usage)}`;
};
