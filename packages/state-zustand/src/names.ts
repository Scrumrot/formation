import type { BlankPolicy, StateNames } from "@formation/state-kit";
import { stateNames } from "@formation/state-kit";

/**
 * A hand-rolled store has no library to ask what a cleared field holds, so the
 * generator answers: `null` wherever the schema allows it.
 */
export const BLANKS: BlankPolicy = "prefer-null";

/** File holding the store, relative to the form folder. */
export const STORE_MODULE = "store";

/** The contract's names, plus the two only a hand-rolled store has. */
export type StoreNames = StateNames &
  Readonly<{
    store: string;
    stateType: string;
  }>;

export const storeNames = (formName: string): StoreNames => ({
  ...stateNames(formName),
  store: `use${formName}Store`,
  stateType: `${formName}State`,
});
