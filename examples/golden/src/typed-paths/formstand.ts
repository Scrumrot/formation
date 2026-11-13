import { useProfileNumber, useProfileText } from "../generated/formstand-mui9/ProfileForm/form";

/**
 * The same compile-time checks as ./zustand.ts, against the formstand output.
 * The path unions come from one shared emitter, so this mostly guards the
 * wrappers: binding formstand by plain string must not have widened a hook's
 * `path` parameter to `string` along the way.
 */
export const typedPathChecks = (row: number): void => {
  useProfileText("address.street");
  useProfileText(`contacts.${row}.name`);
  useProfileNumber("age");
  // Inside one branch of a union: the path formstand's own types cannot name.
  useProfileText("payment.last4");

  // @ts-expect-error — a typo'd path
  useProfileText("adress.street");

  // @ts-expect-error — a number field handed to the text hook
  useProfileText("age");

  // @ts-expect-error — a text field handed to the number hook
  useProfileNumber("fullName");

  // @ts-expect-error — a typo'd field inside a list row
  useProfileText(`contacts.${row}.nmae`);

  // @ts-expect-error — a list path is not a field path
  useProfileText("contacts");
};
