import { camelCase } from "@formation/core";
import type { BlankPolicy, StateNames } from "@formation/state-kit";
import { stateNames } from "@formation/state-kit";

/**
 * react-hook-form has no opinion on what a cleared field holds — it stores
 * whatever `onChange` is given — so the generator answers, as it does for the
 * store it writes itself: `null` wherever the schema allows it.
 */
export const BLANKS: BlankPolicy = "prefer-null";

/** File holding the form, relative to the form folder. */
export const FORM_MODULE = "form";

/** The contract's names, plus the form object react-hook-form's own API hangs off. */
export type FormNames = StateNames & Readonly<{ instance: string }>;

export const formNames = (formName: string): FormNames => ({
  ...stateNames(formName),
  // `profileForm`: what `useForm()` would have returned, minus `formState`.
  instance: `${camelCase(formName)}Form`,
});
