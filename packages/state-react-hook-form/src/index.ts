import type { StateAdapter } from "@formation/core";
import { collectBindings } from "@formation/core";
import { bindingOf, branchConflicts, tabledBlank } from "@formation/state-kit";

import { emitForm } from "./emit-form.js";
import { BLANKS, FORM_MODULE, formNames } from "./names.js";

export { FORM_MODULE } from "./names.js";

/**
 * The react-hook-form state adapter: a `createFormControl` form per module
 * validated through the zod resolver, and the contract's hooks as wrappers
 * over `useController` and `useFieldArray`.
 *
 * This is the adapter the handle contract was most likely to bend for — a
 * library built on uncontrolled inputs and a context provider, where the two
 * before it were stores. It did not bend: see the header of `emit-form.ts` for
 * the two react-hook-form features that made a provider-free, controlled
 * binding possible.
 */
export const reactHookFormAdapter: StateAdapter = (input) => {
  const names = formNames(input.form.name);

  return {
    binding: bindingOf(names, FORM_MODULE, names.instance),
    files: [{ path: `${FORM_MODULE}.ts`, content: emitForm(input, names) }],
    diagnostics: branchConflicts(collectBindings(input.form.fields), tabledBlank(BLANKS)),
  };
};
