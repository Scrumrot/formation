import type { StateAdapter } from "@formation/core";
import { collectBindings } from "@formation/core";
import { bindingOf, branchConflicts, tabledBlank } from "@formation/state-kit";

import { emitStore } from "./emit-store.js";
import { BLANKS, STORE_MODULE, storeNames } from "./names.js";

/**
 * The zustand state adapter: one self-contained store module per form, and a
 * description of the hooks it exports for the UI adapter to bind against.
 */
export const zustandAdapter: StateAdapter = (input) => {
  const names = storeNames(input.form.name);

  return {
    binding: bindingOf(names, STORE_MODULE, names.store),
    files: [{ path: `${STORE_MODULE}.ts`, content: emitStore(input, names) }],
    diagnostics: branchConflicts(collectBindings(input.form.fields), tabledBlank(BLANKS)),
  };
};
