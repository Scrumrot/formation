import type { ControlKind, HookRef, ImportMap, StateBinding } from "@formation/core";
import { camelCase } from "@formation/core";

/** File holding the store, relative to the form folder. */
export const STORE_MODULE = "store";

/**
 * Every identifier the state module declares, derived from the form's name in
 * one place. The emitter writes these names and the binding advertises them,
 * so the two cannot disagree about what a hook is called.
 */
export type StoreNames = Readonly<{
  store: string;
  form: string;
  hooks: Readonly<Record<ControlKind, HookRef>>;
  list: HookRef;
  variant: HookRef;
  valuesType: string;
  dataType: string;
  stateType: string;
  pathType: string;
  unboundPathType: string;
  optionType: string;
  initialValues: string;
}>;

export const storeNames = (formName: string): StoreNames => {
  const hook = (kind: string): HookRef => ({
    name: `use${formName}${kind}`,
    pathType: `${formName}${kind}Path`,
  });

  return {
    store: `use${formName}Store`,
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
    stateType: `${formName}State`,
    pathType: `${formName}Path`,
    unboundPathType: `${formName}UnboundPath`,
    // Unprefixed: its shape is the same for every form, and the controls name it in their props.
    optionType: "ChoiceOption",
    initialValues: `${camelCase(formName)}InitialValues`,
  };
};

export const bindingOf = (names: StoreNames): StateBinding => {
  const from = `./${STORE_MODULE}`;
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
    publicValues: [names.store, names.form, names.initialValues],
    publicTypes: [names.valuesType, names.dataType, names.pathType],
  };
};
