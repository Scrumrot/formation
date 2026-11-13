import type { ControlKind, HookRef, ImportMap, StateBinding } from "@formation/core";
import { camelCase } from "@formation/core";

/**
 * Every identifier of the state/UI contract that a state module declares,
 * derived from the form's name in one place. The emitter writes these names
 * and the binding advertises them, so the two cannot disagree about what a
 * hook is called — and two state adapters cannot disagree either, which is
 * what lets a project switch `--state` without touching its own imports of
 * `useProfileText` or `ProfileValues`.
 */
export type StateNames = Readonly<{
  /** The hook returning the form handle. */
  form: string;
  hooks: Readonly<Record<ControlKind, HookRef>>;
  list: HookRef;
  variant: HookRef;
  valuesType: string;
  dataType: string;
  pathType: string;
  unboundPathType: string;
  optionType: string;
  initialValues: string;
}>;

export const stateNames = (formName: string): StateNames => {
  const hook = (kind: string): HookRef => ({
    name: `use${formName}${kind}`,
    pathType: `${formName}${kind}Path`,
  });

  return {
    form: `use${formName}Form`,
    hooks: {
      text: hook("Text"),
      number: hook("Number"),
      boolean: hook("Boolean"),
      choice: hook("Choice"),
      date: hook("Date"),
    },
    list: hook("List"),
    variant: hook("Variant"),
    valuesType: `${formName}Values`,
    dataType: `${formName}Data`,
    pathType: `${formName}Path`,
    unboundPathType: `${formName}UnboundPath`,
    // Unprefixed: its shape is the same for every form, and the controls name it in their props.
    optionType: "ChoiceOption",
    initialValues: `${camelCase(formName)}InitialValues`,
  };
};

/**
 * The binding a UI adapter builds against.
 *
 * `instance` is whatever the library's own handle on the form is called (the
 * zustand store hook, the formstand form): the one name that differs between
 * adapters, re-exported from the folder's index beside the names they share.
 */
export const bindingOf = (names: StateNames, module: string, instance: string): StateBinding => {
  const from = `./${module}`;
  const value = (name: string): readonly [string, ImportMap[string]] => [
    name,
    { from, typeOnly: false },
  ];
  const type = (name: string): readonly [string, ImportMap[string]] => [
    name,
    { from, typeOnly: true },
  ];
  const hooks = [...Object.values(names.hooks), names.list, names.variant];

  return {
    module,
    hooks: names.hooks,
    list: names.list,
    variant: names.variant,
    form: names.form,
    dataType: names.dataType,
    optionType: names.optionType,
    imports: Object.fromEntries([
      ...hooks.flatMap((hook) => [value(hook.name), type(hook.pathType)]),
      value(names.form),
      type(names.dataType),
      type(names.optionType),
    ]),
    publicValues: [instance, names.form, names.initialValues],
    publicTypes: [names.valuesType, names.dataType, names.pathType],
  };
};
