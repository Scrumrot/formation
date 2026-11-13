import type { ControlBinding, Diagnostic, FormBindings } from "@formation/core";
import { pathPattern } from "@formation/core";

import type { BlankPolicy } from "./values.js";
import { blankOf, printValue } from "./values.js";

/**
 * Two branches of a union may each declare a field of the same name, and the
 * two declarations then share one path (`pay.pan`). What a cleared control
 * writes back is decided per path — by a generated table, or by a state
 * library reading the schema at that path — so it cannot differ per branch.
 *
 * Usually the branches agree and nothing is lost. When they do not (required
 * in one, optional in the other), one answer has to serve both, and the user
 * should hear about it now rather than discover a field that clears to
 * `undefined` where their schema wanted `""`.
 */

/** A text control blanks to `""` and every other kind to `undefined`, unless tabled otherwise. */
export const defaultBlank = (control: ControlBinding): "" | undefined =>
  control.kind === "text" ? "" : undefined;

/**
 * The blank a path gets from a generated table when its declarations
 * disagree: the first one that needs saying. A declaration whose blank is its
 * kind's default never appears in the table, so the first non-default one is
 * what is found there.
 */
export const effectiveBlank = (
  controls: readonly ControlBinding[],
  policy: BlankPolicy,
): unknown => {
  const tabled = controls.find(
    (control) => blankOf(control.field, policy) !== defaultBlank(control),
  );
  const first = controls[0];

  return tabled !== undefined
    ? blankOf(tabled.field, policy)
    : first === undefined
      ? undefined
      : defaultBlank(first);
};

/** How one adapter settles a disagreement between branches, and how to say so. */
export type BlankRule = Readonly<{
  policy: BlankPolicy;
  /** The blank every branch ends up with, given the declarations sharing a path. */
  pick: (sharing: readonly ControlBinding[]) => unknown;
  /** Why, as a clause the warning completes: "A field's blank is looked up by path". */
  reason: string;
}>;

/** The rule for an adapter that emits `emptyValuesTable`. */
export const tabledBlank = (policy: BlankPolicy): BlankRule => ({
  policy,
  pick: (sharing) => effectiveBlank(sharing, policy),
  reason: "A field's blank is looked up by path",
});

export const branchConflicts = (bindings: FormBindings, rule: BlankRule): readonly Diagnostic[] => {
  // Booleans have one blank (off), so they cannot disagree.
  const clearable = bindings.controls.filter((control) => control.kind !== "boolean");
  const patterns = [...new Set(clearable.map((control) => pathPattern(control.field.path)))];

  return patterns.flatMap((pattern) => {
    const sharing = clearable.filter((control) => pathPattern(control.field.path) === pattern);
    const blanks = new Set(
      sharing.map((control) => printValue(blankOf(control.field, rule.policy))),
    );
    const first = sharing[0];

    return blanks.size < 2 || first === undefined
      ? []
      : [
          {
            severity: "warning" as const,
            code: "emit/branch-conflict" as const,
            message: `Branches of a union declare "${pattern}" with different blank values (${[...blanks].join(", ")}). ${rule.reason}, so in every branch a cleared control writes ${printValue(rule.pick(sharing))}.`,
            path: first.field.path,
          },
        ];
  });
};
