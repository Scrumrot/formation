import type { StateBinding, UiAdapter } from "./adapters.js";
import type { ControlKind, ListField, VariantField } from "./bindings.js";
import {
  collectBindings,
  controlKindOf,
  controlKinds,
  isListField,
  pathTypeText,
  rowField,
  variantFieldOf,
} from "./bindings.js";
import { pascalCase } from "./casing.js";
import type { ComponentIR, ComponentModule, ElementNode, Expr, ImportMap } from "./component-ir.js";
import { call, element, exprProp, lit, pathExpr, ref } from "./component-ir.js";
import type { Diagnostic } from "./diagnostics.js";
import type { FieldNode, FormIR } from "./form-ir.js";
import { INDEX_SEGMENT } from "./form-ir.js";

/**
 * FormIR + a state binding + a UI adapter → ComponentIR.
 *
 * This walk owns the *structure* — which fields nest in which sections, which
 * arrays become list components, what path each control binds — and asks the UI
 * adapter only "what do you draw here". That is the same split formstand-cli's
 * `Backend` record made, and it is why adding a UI kit means writing leaves and
 * chrome rather than re-deciding how nested arrays work.
 */

export type AssembledForm = Readonly<{
  /** Name of the root component, and of the file that holds it. */
  componentName: string;
  modules: readonly ComponentModule[];
  /** Every identifier any module may reference, and where it comes from. */
  imports: ImportMap;
  diagnostics: readonly Diagnostic[];
}>;

/** File holding the bound controls, relative to the form folder. */
export const CONTROLS_MODULE = "controls";

// Names bound inside a list component. Fixed, because every list component has
// the same shape: a `path` prop, the `list` handle, and `index` per row.
const PATH_PROP = "path";
const LIST_HANDLE = "list";
const ROW_INDEX = "index";
const VARIANT_HANDLE = "variant";

type PathParts = readonly (string | Expr)[];

type Rendered = Readonly<{
  node: ElementNode;
  /** List and variant components this subtree needs defined, innermost first. */
  components: readonly ComponentIR[];
  diagnostics: readonly Diagnostic[];
}>;

type Context = Readonly<{
  ui: UiAdapter;
  state: StateBinding;
  /**
   * Component name for each list and each union, keyed by path pattern —
   * assigned up front so names are unique across the whole form.
   */
  componentNames: ReadonlyMap<string, string>;
}>;

const lastSegment = (field: FieldNode): string => field.path[field.path.length - 1] ?? "";

const gather = (
  rendered: readonly Rendered[],
): Readonly<{
  nodes: readonly ElementNode[];
  components: readonly ComponentIR[];
  diagnostics: readonly Diagnostic[];
}> => ({
  nodes: rendered.map((entry) => entry.node),
  components: rendered.flatMap((entry) => entry.components),
  diagnostics: rendered.flatMap((entry) => entry.diagnostics),
});

const unboundReason = (field: FieldNode): Readonly<{ reason: string; report: boolean }> => {
  switch (field.shape.kind) {
    case "unsupported":
      // Ingest already raised a diagnostic for this node; a second one here
      // would read as two problems when there is one.
      return { reason: field.shape.reason, report: false };
    case "union":
      // Only a union `variantFieldOf` turned down reaches here.
      return {
        reason:
          "the union's branches are not told apart by one property with a distinct fixed value each, so there is nothing to choose a branch by",
        report: true,
      };
    case "file":
      return { reason: "file inputs are not generated yet", report: true };
    // The remaining kinds all bind something, so they never reach here. Listed
    // rather than defaulted so a new FieldShape has to be placed deliberately.
    case "string":
    case "number":
    case "boolean":
    case "enum":
    case "date":
    case "array":
    case "object":
      return { reason: `"${field.shape.kind}" was left unbound`, report: true };
  }
};

const renderUnbound = (field: FieldNode, context: Context): Rendered => {
  const { reason, report } = unboundReason(field);

  return {
    node: context.ui.unbound({ field, reason }),
    components: [],
    diagnostics: report
      ? [
          {
            severity: "warning",
            code: "emit/capability-unsupported",
            message: `No control was generated: ${reason}. The field is still in the store; bind it by hand.`,
            path: field.path,
          },
        ]
      : [],
  };
};

/**
 * One row's contents. An object row contributes its fields directly (the row
 * itself is the visual group, so a section heading per row would be noise);
 * any other row — a list of strings, a list of lists — is a single field.
 */
const renderRow = (list: ListField, context: Context): ReturnType<typeof gather> => {
  const row = rowField(list);
  const parts: PathParts = [ref(PATH_PROP), ref(ROW_INDEX)];

  return gather(
    row.shape.kind === "object"
      ? row.shape.fields.map((child) => renderField(child, [...parts, lastSegment(child)], context))
      : [renderField(row, parts, context)],
  );
};

const renderList = (list: ListField, parts: PathParts, context: Context): Rendered => {
  const name = context.componentNames.get(list.path.join(".")) ?? "List";
  const row = renderRow(list, context);
  // Every list is its own component, even a top-level one. Rows need the list
  // hook, a nested list needs it once per parent row, and hooks cannot run
  // inside a `.map` — so the component boundary is not optional for the nested
  // case, and using it everywhere keeps one shape instead of two.
  const component: ComponentIR = {
    name,
    props: [{ name: PATH_PROP, type: pathTypeText(list.path), optional: false }],
    setup: [{ name: LIST_HANDLE, init: call(ref(context.state.list.name), [ref(PATH_PROP)]) }],
    root: context.ui.list({
      field: list,
      rowLabel: rowField(list).label,
      handle: ref(LIST_HANDLE),
      index: ROW_INDEX,
      row: row.nodes,
    }),
  };

  return {
    node: element(name, [exprProp(PATH_PROP, pathExpr(parts))]),
    // Inner lists first, so each component is defined above the one that uses it.
    components: [...row.components, component],
    diagnostics: row.diagnostics,
  };
};

const renderField = (field: FieldNode, parts: PathParts, context: Context): Rendered => {
  const kind = controlKindOf(field.shape);

  if (kind !== undefined) {
    return {
      node: context.ui.control({ kind, field, path: pathExpr(parts) }),
      components: [],
      diagnostics: [],
    };
  }

  if (field.shape.kind === "object") {
    const { nodes, components, diagnostics } = gather(
      field.shape.fields.map((child) =>
        renderField(child, [...parts, lastSegment(child)], context),
      ),
    );

    return { node: context.ui.section({ field, children: nodes }), components, diagnostics };
  }

  if (isListField(field)) return renderList(field, parts, context);

  const variantField = variantFieldOf(field);

  return variantField === undefined
    ? renderUnbound(field, context)
    : renderVariants(variantField, parts, context);
};

const renderVariants = (
  variantField: VariantField,
  parts: PathParts,
  context: Context,
): Rendered => {
  const { field, variants } = variantField;
  const name = context.componentNames.get(field.path.join(".")) ?? "Variants";
  const branches = variants.map((variant) => ({
    variant,
    rendered: gather(
      variant.fields.map((child) =>
        renderField(child, [ref(PATH_PROP), lastSegment(child)], context),
      ),
    ),
  }));
  // Its own component for the same reason a list is: the variant hook has to
  // run once per union, and a union can sit inside a list row.
  const component: ComponentIR = {
    name,
    props: [{ name: PATH_PROP, type: pathTypeText(field.path), optional: false }],
    setup: [
      { name: VARIANT_HANDLE, init: call(ref(context.state.variant.name), [ref(PATH_PROP)]) },
    ],
    root: context.ui.variants({
      field,
      handle: ref(VARIANT_HANDLE),
      branches: branches.map(({ variant, rendered }) => ({
        tag: variant.tag,
        label: variant.label,
        children: rendered.nodes,
      })),
    }),
  };

  return {
    node: element(name, [exprProp(PATH_PROP, pathExpr(parts))]),
    components: [...branches.flatMap((branch) => branch.rendered.components), component],
    diagnostics: branches.flatMap((branch) => branch.rendered.diagnostics),
  };
};

/**
 * `ProfileContactsList`, `ProfileTeamsMembersList`, `ProfilePaymentVariants`.
 * Two paths can PascalCase to the same name (`a_b` and `aB`), so later
 * collisions take a numeric suffix rather than silently shadowing an earlier
 * component.
 */
const nameComponents = (
  formName: string,
  entries: readonly Readonly<{ path: readonly string[]; suffix: string }>[],
): ReadonlyMap<string, string> =>
  entries.reduce<ReadonlyMap<string, string>>((names, entry) => {
    const base = `${formName}${entry.path
      .filter((segment) => segment !== INDEX_SEGMENT)
      .map(pascalCase)
      .join("")}${entry.suffix}`;
    const taken = new Set(names.values());
    const attempt = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(
      (count) => !taken.has(count === 1 ? base : `${base}${count}`),
    );
    const name = attempt === undefined || attempt === 1 ? base : `${base}${attempt}`;

    return new Map([...names, [entry.path.join("."), name]]);
  }, new Map());

export const assembleForm = (form: FormIR, state: StateBinding, ui: UiAdapter): AssembledForm => {
  const bindings = collectBindings(form.fields);
  const componentName = `${form.name}Form`;
  const context: Context = {
    ui,
    state,
    componentNames: nameComponents(form.name, [
      ...bindings.lists.map((list) => ({ path: list.path, suffix: "List" })),
      ...bindings.variants.map((entry) => ({ path: entry.field.path, suffix: "Variants" })),
    ]),
  };

  // Controls are emitted only for kinds in use: an unused bound control would
  // import a hook the state module never exported.
  const used = new Set<ControlKind>(bindings.controls.map((control) => control.kind));
  const usedKinds = controlKinds.filter((kind) => used.has(kind));

  const body = gather(
    form.fields.map((field) => renderField(field, [lastSegment(field)], context)),
  );

  const root: ComponentIR = {
    name: componentName,
    ...(form.description === undefined ? {} : { doc: form.description }),
    props: [
      {
        name: "onSubmit",
        type: `(data: ${state.dataType}) => void | Promise<void>`,
        uses: [state.dataType],
        optional: false,
        doc: "Called with the parsed, validated values. A returned promise keeps the form submitting.",
      },
      { name: "submitLabel", type: "string", optional: true, defaultValue: lit("Submit") },
    ],
    setup: [{ name: "form", init: call(ref(state.form)) }],
    root: ui.form({
      handle: ref("form"),
      onSubmit: ref("onSubmit"),
      submitLabel: ref("submitLabel"),
      children: body.nodes,
    }),
  };

  const controlImports: ImportMap = Object.fromEntries(
    usedKinds.map((kind) => [
      ui.controlNames[kind],
      { from: `./${CONTROLS_MODULE}`, typeOnly: false },
    ]),
  );

  return {
    componentName,
    modules: [
      ...(usedKinds.length > 0
        ? [{ name: CONTROLS_MODULE, components: ui.controls(usedKinds, state) }]
        : []),
      { name: componentName, components: [...body.components, root] },
    ],
    imports: { ...ui.imports, ...state.imports, ...controlImports },
    diagnostics: body.diagnostics,
  };
};
