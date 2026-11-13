import { useConsentStore } from "@generated/ConsentForm";
import { useNewPetStore } from "@generated/NewPetForm";
import type { NewPetValues } from "@generated/NewPetForm";
import { useOrderStore } from "@generated/OrderForm";
import type { OrderValues } from "@generated/OrderForm";
import { useProfileStore } from "@generated/ProfileForm";
import type { ProfilePath, ProfileValues } from "@generated/ProfileForm";

/**
 * How the specs reach a form's state when zustand holds it.
 *
 * The specs drive the forms through the DOM, but a few assertions have to look
 * at what is actually stored ("a cleared number is `undefined`, not `0`"), and
 * that is the one thing that differs per state library. Each library gets a
 * harness of this shape; `forms.test.tsx` is typechecked against every one of
 * them, so they cannot drift apart.
 */

/**
 * The one behaviour that differs by state library on purpose: what a field
 * that is both optional and nullable holds while blank. The schema accepts
 * either; the zustand store is the generator's own, and it says `null`.
 */
export const blanks = { optionalNullable: null } as const;

export const order = {
  values: (): OrderValues => useOrderStore.getState().values,
  /** Back to a blank form, or to `values` — which is also how an edit form is seeded. */
  reset: (values?: OrderValues): void => useOrderStore.getState().reset(values),
};

export const profile = {
  values: (): ProfileValues => useProfileStore.getState().values,
  reset: (values?: ProfileValues): void => useProfileStore.getState().reset(values),
  /** An error only the server knows, e.g. "email already registered". */
  setFieldError: (path: ProfilePath, message: string): void =>
    useProfileStore.getState().setFieldError(path, message),
};

export const newPet = {
  values: (): NewPetValues => useNewPetStore.getState().values,
  reset: (values?: NewPetValues): void => useNewPetStore.getState().reset(values),
};

export const consent = {
  reset: (): void => useConsentStore.getState().reset(),
};
