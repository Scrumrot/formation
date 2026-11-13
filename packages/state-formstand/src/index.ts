import type { StateAdapter } from "@formation/core";
import { collectBindings } from "@formation/core";
import type { BlankRule } from "@formation/state-kit";
import { bindingOf, blankOf, branchConflicts } from "@formation/state-kit";

import { emitForm } from "./emit-form.js";
import { BLANKS, FORM_MODULE, formNames } from "./names.js";

export { FORM_MODULE } from "./names.js";

/**
 * formstand reads a field's blank from the schema at its path, and inside a
 * union it reads the first branch that declares that key. So when two branches
 * disagree, the first one's answer serves both.
 */
const firstDeclared: BlankRule = {
  policy: BLANKS,
  pick: (sharing) => (sharing[0] === undefined ? undefined : blankOf(sharing[0].field, BLANKS)),
  reason: "formstand reads a field's blank from the first branch that declares it",
};

/**
 * The formstand state adapter: a `createForm` instance per form, and the
 * contract's hooks as wrappers over formstand's `useField` and `useFieldArray`.
 *
 * The UI adapter cannot tell this from the zustand one — the hooks have the
 * same names, paths and handle shapes — which is the claim the adapter seam
 * makes, here tested by a second implementation.
 */
export const formstandAdapter: StateAdapter = (input) => {
  const names = formNames(input.form.name);

  return {
    binding: bindingOf(names, FORM_MODULE, names.instance),
    files: [{ path: `${FORM_MODULE}.ts`, content: emitForm(input, names) }],
    diagnostics: branchConflicts(collectBindings(input.form.fields), firstDeclared),
  };
};
