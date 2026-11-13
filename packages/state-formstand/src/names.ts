import { camelCase } from "@formation/core";
import type { BlankPolicy, StateNames } from "@formation/state-kit";
import { stateNames } from "@formation/state-kit";

/**
 * formstand's own answer to what a cleared optional-and-nullable field holds.
 * The hooks ask formstand at run time (`useField`'s `emptyValue`); this is the
 * same rule applied at generation time, so the blank a form *starts* with is
 * the blank a cleared control writes.
 */
export const BLANKS: BlankPolicy = "prefer-undefined";

/** File holding the form, relative to the form folder. */
export const FORM_MODULE = "form";

/** The contract's names, plus the form instance formstand's own API hangs off. */
export type FormNames = StateNames & Readonly<{ instance: string }>;

export const formNames = (formName: string): FormNames => ({
  ...stateNames(formName),
  // `profileForm`, beside the component `ProfileForm`. The near-collision is
  // accepted: this is the name a formstand user would give it by hand, and it
  // is what they will pass to `useIsDirty`, the devtools, and `setError`.
  instance: `${camelCase(formName)}Form`,
});
