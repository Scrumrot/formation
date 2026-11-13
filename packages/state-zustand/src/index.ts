import type { StateAdapter } from "@formation/core";
import { collectBindings } from "@formation/core";

import { branchConflicts } from "./conflicts.js";
import { emitStore } from "./emit-store.js";
import { STORE_MODULE, bindingOf, storeNames } from "./names.js";

export { STORE_MODULE } from "./names.js";

/**
 * The zustand state adapter: one self-contained store module per form, and a
 * description of the hooks it exports for the UI adapter to bind against.
 */
export const zustandAdapter: StateAdapter = (input) => {
  const names = storeNames(input.form.name);

  return {
    binding: bindingOf(names),
    files: [{ path: `${STORE_MODULE}.ts`, content: emitStore(input, names) }],
    diagnostics: branchConflicts(collectBindings(input.form.fields)),
  };
};
