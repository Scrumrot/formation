import { useProfileNumber, useProfileText } from "../generated/zustand-mui9/ProfileForm/store";

/**
 * Compile-time checks, never run. The README says a wrong path does not
 * compile; this file is what makes that a tested claim rather than a hope.
 *
 * Each `@ts-expect-error` is itself an assertion: if the line below it ever
 * *stops* being an error — the path unions widened to `string`, say — tsc fails
 * with "unused '@ts-expect-error' directive".
 */
export const typedPathChecks = (row: number): void => {
  useProfileText("address.street");
  useProfileText(`contacts.${row}.name`);
  useProfileNumber("age");

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
