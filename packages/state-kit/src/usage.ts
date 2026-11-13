import type { ControlKind, FormBindings } from "@formation/core";

/**
 * What a form actually uses, which decides what its state module contains.
 * Shared by every state adapter so "this form has a number control" is asked
 * one way.
 */
export type Usage = Readonly<
  Record<ControlKind, boolean> & {
    list: boolean;
    variant: boolean;
    /** Any field control at all. */
    control: boolean;
    /** Something can be cleared to a blank value. */
    empties: boolean;
    /** Something looks a path up in a table, so the path-to-pattern helper is needed. */
    patterns: boolean;
    /** Something reads a value by path. */
    reads: boolean;
  }
>;

export const CONTROL_KINDS: readonly ControlKind[] = [
  "text",
  "number",
  "boolean",
  "choice",
  "date",
];

export const usageOf = (bindings: FormBindings): Usage => {
  const has = (kind: ControlKind): boolean =>
    bindings.controls.some((control) => control.kind === kind);

  const list = bindings.lists.length > 0;
  const variant = bindings.variants.length > 0;
  const empties = has("text") || has("number") || has("choice") || has("date") || variant;

  return {
    text: has("text"),
    number: has("number"),
    boolean: has("boolean"),
    choice: has("choice"),
    date: has("date"),
    list,
    variant,
    control: bindings.controls.length > 0,
    empties,
    patterns: empties || list,
    reads: bindings.controls.length > 0 || list || variant,
  };
};
