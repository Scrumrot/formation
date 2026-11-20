import { bookingForm, bookingInitialValues } from "@generated/BookingForm";
import type { BookingValues } from "@generated/BookingForm";
import { consentForm, consentInitialValues } from "@generated/ConsentForm";
import type { ConsentValues } from "@generated/ConsentForm";
import { newPetForm, newPetInitialValues } from "@generated/NewPetForm";
import type { NewPetValues } from "@generated/NewPetForm";
import { orderForm, orderInitialValues } from "@generated/OrderForm";
import type { OrderValues } from "@generated/OrderForm";
import { profileForm, profileInitialValues } from "@generated/ProfileForm";
import type { ProfilePath, ProfileValues } from "@generated/ProfileForm";
import type { FieldValues, UseFormReturn } from "react-hook-form";

/**
 * How the specs reach a form's state when react-hook-form holds it. Same shape
 * as the zustand harness; see that file for why this layer exists.
 */

/**
 * What a field that is both optional and nullable holds while blank.
 * react-hook-form has no rule of its own, so the generator's applies: `null`.
 */
export const blanks = { optionalNullable: null } as const;

// The slice of a react-hook-form form the harness uses, with the values type
// as the only thing that varies.
type FormOf<Values extends FieldValues> = Pick<
  UseFormReturn<Values, unknown, unknown>,
  "getValues" | "reset"
>;

const stateOf = <Values extends FieldValues>(form: FormOf<Values>, blank: Values) => ({
  values: (): Values => form.getValues(),
  // react-hook-form's `reset(next)` also makes `next` the new default, so a
  // bare `reset()` after a seeded test would return to the seed. Every reset
  // here names where it is going.
  reset: (values: Values = blank): void => form.reset(values),
});

export const order = stateOf<OrderValues>(orderForm, orderInitialValues);

export const profile = {
  ...stateOf<ProfileValues>(profileForm, profileInitialValues),
  /** An error only the server knows, e.g. "email already registered". */
  setFieldError: (path: ProfilePath, message: string): void => {
    // By plain string, like the generated hooks: react-hook-form's typed paths
    // stop at a union, and `ProfilePath` reaches inside one.
    const untyped = profileForm as unknown as Pick<UseFormReturn<FieldValues>, "setError">;

    // Type "server" is what the generated hooks release when the field is edited.
    untyped.setError(path, { type: "server", message });
  },
};

export const newPet = stateOf<NewPetValues>(newPetForm, newPetInitialValues);

export const booking = stateOf<BookingValues>(bookingForm, bookingInitialValues);

export const consent = stateOf<ConsentValues>(consentForm, consentInitialValues);
