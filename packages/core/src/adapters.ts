import type { ControlKind } from "./bindings.js";
import type { ComponentIR, ElementNode, Expr, ImportMap } from "./component-ir.js";
import type { Diagnostic } from "./diagnostics.js";
import type { FieldNode, FormIR } from "./form-ir.js";

/**
 * The seam between "what holds the form's state" and "what draws it".
 *
 * A state adapter (zustand today; formstand, react-hook-form, … later) emits
 * the state module and describes it with a `StateBinding`. A UI adapter (MUI
 * today) builds controls against that description. Neither imports the other,
 * which is the whole point: N state adapters and M UI adapters, not N×M
 * templates.
 *
 * What makes that possible is a fixed contract for the *generated* code, not
 * for the generator: every state adapter must emit hooks returning the handle
 * shapes below, and every UI adapter binds only to those shapes.
 *
 *   field hook (per ControlKind)  (path) → { name, value, error, setValue, onBlur }
 *       `value` is always the control's own type — `string` for text, number,
 *       choice and date controls, `boolean` for a switch. Converting to and
 *       from the stored value (a number, a `Date`, `null` for a cleared
 *       nullable field) is the state adapter's job, because only it knows what
 *       "blank" means in its store.
 *   choice hook                   (path, options) → the same handle
 *   variant hook                  (path) → the same handle, over a union's *branch*:
 *       `value` is the active branch's tag as text ("" when none is chosen),
 *       and `setValue` replaces the whole union with that branch's blank value.
 *   list hook                     (path) → { ids, error, append, remove }
 *   form hook                     ()     → { submitting, error, handleSubmit, reset }
 */

export type HookRef = Readonly<{
  name: string;
  /** Type of the hook's `path` parameter, as an exported name. */
  pathType: string;
}>;

export type StateBinding = Readonly<{
  /** The state module, relative to the form folder, without extension. */
  module: string;
  hooks: Readonly<Record<ControlKind, HookRef>>;
  list: HookRef;
  /** The hook that selects a discriminated union's branch. */
  variant: HookRef;
  /** Name of the hook returning the form handle. */
  form: string;
  /** Type of the validated payload `onSubmit` receives. */
  dataType: string;
  /** Type of one `{ value, label }` choice option. */
  optionType: string;
  /** Where each of the names above is imported from. */
  imports: ImportMap;
  /** What the form folder's `index` re-exports from the state module. */
  publicValues: readonly string[];
  publicTypes: readonly string[];
}>;

/** A file to write, relative to the form's folder. Unformatted — the CLI runs Prettier. */
export type GeneratedFile = Readonly<{ path: string; content: string }>;

export type StateAdapterInput = Readonly<{
  form: FormIR;
  /** Module holding the validator, relative to the form folder, without extension. */
  schemaModule: string;
  /** Exported name of the validator in that module. */
  schemaExport: string;
}>;

export type StateAdapterOutput = Readonly<{
  binding: StateBinding;
  files: readonly GeneratedFile[];
  diagnostics: readonly Diagnostic[];
}>;

export type StateAdapter = (input: StateAdapterInput) => StateAdapterOutput;

export type ControlSite = Readonly<{
  kind: ControlKind;
  field: FieldNode;
  /** Evaluates to the field's path at this site. */
  path: Expr;
}>;

export type UiAdapter = Readonly<{
  /** Where every tag this adapter emits is imported from. */
  imports: ImportMap;
  /** Name of the bound control component for each kind. */
  controlNames: Readonly<Record<ControlKind, string>>;
  /** The bound controls, for the kinds this form actually uses. */
  controls: (kinds: readonly ControlKind[], state: StateBinding) => readonly ComponentIR[];
  /** One use of a bound control. */
  control: (site: ControlSite) => ElementNode;
  /** Chrome around a nested object's fields. */
  section: (args: Readonly<{ field: FieldNode; children: readonly ElementNode[] }>) => ElementNode;
  /** Chrome around a list: heading, rows with a remove control, the add control. */
  list: (
    args: Readonly<{
      field: FieldNode;
      rowLabel: string;
      /** Evaluates to the list handle. */
      handle: Expr;
      /** Name the row position is bound to inside `row`. */
      index: string;
      row: readonly ElementNode[];
    }>,
  ) => ElementNode;
  /**
   * A discriminated union: the control that picks a branch, then each branch's
   * fields, shown only while that branch is the active one.
   */
  variants: (
    args: Readonly<{
      field: FieldNode;
      /** Evaluates to the variant handle. */
      handle: Expr;
      branches: readonly Readonly<{
        tag: string | number;
        label: string;
        children: readonly ElementNode[];
      }>[];
    }>,
  ) => ElementNode;
  /** The form element, the form-level error, and the submit control. */
  form: (
    args: Readonly<{
      handle: Expr;
      onSubmit: Expr;
      submitLabel: Expr;
      children: readonly ElementNode[];
    }>,
  ) => ElementNode;
  /** What to leave where a field has no control. Never nothing — see FormIR's `unsupported`. */
  unbound: (args: Readonly<{ field: FieldNode; reason: string }>) => ElementNode;
}>;
