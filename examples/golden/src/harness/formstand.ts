import { consentForm, consentInitialValues } from "@generated/ConsentForm";
import { newPetForm, newPetInitialValues } from "@generated/NewPetForm";
import type { NewPetValues } from "@generated/NewPetForm";
import { orderForm, orderInitialValues } from "@generated/OrderForm";
import type { OrderValues } from "@generated/OrderForm";
import { profileForm, profileInitialValues } from "@generated/ProfileForm";
import type { ProfilePath, ProfileValues } from "@generated/ProfileForm";
import type { FieldFormApi } from "formstand";

/**
 * How the specs reach a form's state when formstand holds it. Same shape as
 * the zustand harness beside it; see that file for why this layer exists.
 */

// The slice of a formstand form the harness uses. `never` as the argument
// type accepts any form: each one's `reset` takes its own schema's input.
type ResettableForm = Readonly<{
  getState: () => Readonly<{ values: unknown }>;
  reset: (next?: never) => void;
}>;

// The casts are the harness's whole job. formstand types a form's values as
// the schema's input, and the generated working values are deliberately looser
// (a blank required number is `undefined`); the specs assert on the latter.
const stateOf = <Values>(form: ResettableForm, blank: Values) => ({
  values: (): Values => form.getState().values as Values,
  // formstand's `reset(next)` also makes `next` the new "initial", so a bare
  // `reset()` after a seeded test would return to the seed. Every reset here
  // names where it is going.
  reset: (values: Values = blank): void => form.reset(values as never),
});

/**
 * What a field that is both optional and nullable holds while blank. formstand
 * answers that itself, from the schema, and its answer is `undefined`; the
 * generated form follows it. (See the zustand harness for the other answer.)
 */
export const blanks = { optionalNullable: undefined } as const;

export const order = stateOf<OrderValues>(orderForm, orderInitialValues);

export const profile = {
  ...stateOf<ProfileValues>(profileForm, profileInitialValues),
  /** An error only the server knows, e.g. "email already registered". */
  setFieldError: (path: ProfilePath, message: string): void => {
    // By plain string, like the generated hooks: formstand's typed paths stop
    // at a union, and `ProfilePath` reaches inside one.
    const untyped: FieldFormApi = profileForm;

    untyped.setError(path, message);
  },
};

export const newPet = stateOf<NewPetValues>(newPetForm, newPetInitialValues);

export const consent = stateOf(consentForm, consentInitialValues);
