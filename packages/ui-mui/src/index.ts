import type {
  ComponentIR,
  ControlKind,
  ControlSite,
  ElementNode,
  Expr,
  FieldNode,
  ImportMap,
  PropBinding,
  PropDecl,
  StateBinding,
  UiAdapter,
} from "@formation/core";
import {
  array,
  arrow,
  binary,
  call,
  comment,
  element,
  eventProp,
  exprNode,
  exprProp,
  isDefined,
  lit,
  member,
  mustBeFilled,
  object,
  ref,
  slotProp,
  staticProp,
  text,
  when,
} from "@formation/core";

/**
 * The Material UI adapter: which MUI component draws each kind of field, and
 * the chrome around sections, lists and the form itself.
 *
 * It knows nothing about zustand. Controls bind to the handle shapes in
 * `@formation/core`'s adapter contract, so the same output works over any
 * state adapter that honors it.
 */

/**
 * The majors this adapter is verified against (examples/golden typechecks
 * generated output against each one's real declarations). MUI published no
 * major 8 — 7.x is followed directly by 9.
 */
export type MuiMajor = 7 | 9;

export const muiMajors: readonly MuiMajor[] = [7, 9];

const MUI = "@mui/material";

const TAGS: readonly string[] = [
  "Alert",
  "Box",
  "Button",
  "FormControl",
  "FormControlLabel",
  "FormHelperText",
  "MenuItem",
  "Stack",
  "Switch",
  "TextField",
  "Typography",
];

const imports: ImportMap = Object.fromEntries(
  TAGS.map((tag) => [tag, { from: MUI, typeOnly: false }]),
);

const controlNames: Readonly<Record<ControlKind, string>> = {
  text: "TextControl",
  number: "NumberControl",
  boolean: "BooleanControl",
  choice: "ChoiceControl",
  date: "DateControl",
};

/** A string past this length is prose, not a value, and gets a multi-line input. */
const MULTILINE_FROM = 256;

const FIELD = "field";
const field = ref(FIELD);

// ---- Bound controls ---------------------------------------------------------

const pathProp = (type: string): PropDecl => ({
  name: "path",
  type,
  uses: [type],
  optional: false,
});

const labelProp: PropDecl = { name: "label", type: "string", optional: false };

const descriptionProp: PropDecl = {
  name: "description",
  type: "string",
  optional: true,
  doc: "Helper text under the control. An error replaces it while one is showing.",
};

const requiredProp: PropDecl = {
  name: "required",
  type: "boolean",
  optional: true,
  defaultValue: lit(false),
};

/** Error first, then the description: one helper slot, and the problem outranks the hint. */
const helper = binary("??", member(field, "error"), ref("description"));

/**
 * The props every `TextField`-based control shares. Enumerated one by one
 * rather than spread from a helper: it keeps the generated file free of an
 * adapter layer to maintain, and it means a printer that cannot spread
 * (Angular) needs nothing special from this adapter.
 */
const textFieldProps = (): readonly PropBinding[] => [
  staticProp("fullWidth"),
  exprProp("name", member(field, "name")),
  exprProp("label", ref("label")),
  exprProp("required", ref("required")),
  exprProp("value", member(field, "value")),
  exprProp("error", isDefined(member(field, "error"))),
  exprProp("helperText", helper),
  eventProp(
    "change",
    arrow(
      ["event"],
      call(member(field, "setValue"), [member(member(ref("event"), "target"), "value")]),
    ),
  ),
  eventProp("blur", member(field, "onBlur")),
];

const bind = (hook: string, extra: readonly Expr[] = []): ComponentIR["setup"] => [
  { name: FIELD, init: call(ref(hook), [ref("path"), ...extra]) },
];

const textControl = (state: StateBinding): ComponentIR => ({
  name: controlNames.text,
  props: [
    pathProp(state.hooks.text.pathType),
    labelProp,
    descriptionProp,
    requiredProp,
    { name: "type", type: "string", optional: true, defaultValue: lit("text") },
    { name: "multiline", type: "boolean", optional: true, defaultValue: lit(false) },
  ],
  setup: bind(state.hooks.text.name),
  root: element("TextField", [
    ...textFieldProps(),
    exprProp("type", ref("type")),
    exprProp("multiline", ref("multiline")),
    staticProp("minRows", 3),
  ]),
});

const numberControl = (state: StateBinding): ComponentIR => ({
  name: controlNames.number,
  props: [
    pathProp(state.hooks.number.pathType),
    labelProp,
    descriptionProp,
    requiredProp,
    {
      name: "inputMode",
      type: `"decimal" | "numeric"`,
      optional: true,
      defaultValue: lit("decimal"),
    },
  ],
  setup: bind(state.hooks.number.name),
  // A text input, not type="number": the browser reports "" for a half-typed
  // number, which would erase "1." and "-" as they are typed. `inputMode`
  // still brings up the numeric keypad on touch devices.
  root: element("TextField", [
    ...textFieldProps(),
    exprProp("slotProps", object({ htmlInput: object({ inputMode: ref("inputMode") }) })),
  ]),
});

const dateControl = (state: StateBinding): ComponentIR => ({
  name: controlNames.date,
  props: [
    pathProp(state.hooks.date.pathType),
    labelProp,
    descriptionProp,
    requiredProp,
    {
      name: "type",
      type: `"date" | "datetime-local"`,
      optional: true,
      defaultValue: lit("date"),
    },
  ],
  setup: bind(state.hooks.date.name),
  root: element("TextField", [
    ...textFieldProps(),
    exprProp("type", ref("type")),
    // A native date input always shows its "mm/dd/yyyy" mask, so a resting
    // label would be printed on top of it.
    exprProp("slotProps", object({ inputLabel: object({ shrink: lit(true) }) })),
  ]),
});

const choiceControl = (state: StateBinding): ComponentIR => ({
  name: controlNames.choice,
  props: [
    pathProp(state.hooks.choice.pathType),
    labelProp,
    {
      name: "options",
      type: `readonly ${state.optionType}[]`,
      uses: [state.optionType],
      optional: false,
    },
    descriptionProp,
    requiredProp,
    {
      name: "clearable",
      type: "boolean",
      optional: true,
      defaultValue: lit(false),
      doc: "Offer an empty choice, for a field the schema lets stay unset.",
    },
  ],
  setup: bind(state.hooks.choice.name, [ref("options")]),
  root: element(
    "TextField",
    [staticProp("select"), ...textFieldProps()],
    [
      when(
        ref("clearable"),
        element("MenuItem", [staticProp("value", "")], [element("em", [], [text("None")])]),
      ),
      {
        kind: "each",
        items: ref("options"),
        item: "option",
        key: member(ref("option"), "value"),
        // MenuItem values are text; the hook maps the text back to the
        // option's own value, so a numeric enum is not submitted as a string.
        body: element(
          "MenuItem",
          [exprProp("value", call(ref("String"), [member(ref("option"), "value")]))],
          [exprNode(member(ref("option"), "label"))],
        ),
      },
    ],
  ),
});

const booleanControl = (state: StateBinding): ComponentIR => ({
  name: controlNames.boolean,
  props: [pathProp(state.hooks.boolean.pathType), labelProp, descriptionProp],
  setup: bind(state.hooks.boolean.name),
  // A Switch has no helper slot of its own, so FormControl + FormHelperText
  // supplies the same error/description line the text fields get.
  root: element(
    "FormControl",
    [exprProp("error", isDefined(member(field, "error")))],
    [
      element("FormControlLabel", [
        exprProp("label", ref("label")),
        slotProp(
          "control",
          element("Switch", [
            exprProp("name", member(field, "name")),
            exprProp("checked", member(field, "value")),
            eventProp(
              "change",
              arrow(
                ["event"],
                call(member(field, "setValue"), [
                  member(member(ref("event"), "target"), "checked"),
                ]),
              ),
            ),
            eventProp("blur", member(field, "onBlur")),
          ]),
        ),
      ]),
      when(isDefined(helper), element("FormHelperText", [], [exprNode(helper)])),
    ],
  ),
});

const CONTROLS: Readonly<Record<ControlKind, (state: StateBinding) => ComponentIR>> = {
  text: textControl,
  number: numberControl,
  boolean: booleanControl,
  choice: choiceControl,
  date: dateControl,
};

// ---- Use sites --------------------------------------------------------------

const TEXT_TYPES: Readonly<Record<string, string>> = {
  email: "email",
  url: "url",
  password: "password",
  phone: "tel",
  color: "color",
};

/** The props that vary per field, beyond `path` and `label`. */
const siteProps = (kind: ControlKind, node: FieldNode): readonly PropBinding[] => {
  const shape = node.shape;
  const common: readonly PropBinding[] = [
    ...(node.description === undefined ? [] : [staticProp("description", node.description)]),
    // The switch takes no `required`: off is a value, never a blank.
    ...(kind !== "boolean" && mustBeFilled(node) ? [staticProp("required")] : []),
  ];

  switch (shape.kind) {
    case "string": {
      const type = shape.format === undefined ? undefined : TEXT_TYPES[shape.format];
      const multiline = shape.format === "multiline" || (shape.max?.value ?? 0) >= MULTILINE_FROM;

      return [
        ...common,
        ...(type === undefined ? [] : [staticProp("type", type)]),
        ...(multiline ? [staticProp("multiline")] : []),
      ];
    }
    case "number":
      return [...common, ...(shape.integer ? [staticProp("inputMode", "numeric")] : [])];
    case "date":
      return [...common, ...(shape.time ? [staticProp("type", "datetime-local")] : [])];
    case "enum":
      return [
        exprProp(
          "options",
          array(
            shape.options.map((option) =>
              object({ value: lit(option.value), label: lit(option.label) }),
            ),
          ),
        ),
        ...common,
        ...(mustBeFilled(node) ? [] : [staticProp("clearable")]),
      ];
    // Booleans carry no extra props; the rest never reach a control site.
    case "boolean":
    case "file":
    case "array":
    case "object":
    case "union":
    case "unsupported":
      return common;
  }
};

const control = (site: ControlSite): ElementNode =>
  element(controlNames[site.kind], [
    exprProp("path", site.path),
    staticProp("label", site.field.label),
    ...siteProps(site.kind, site.field),
  ]);

const heading = (node: FieldNode): readonly ElementNode[] => [
  element(
    "Typography",
    [staticProp("variant", "subtitle1"), staticProp("component", "h3")],
    [text(node.label)],
  ),
  ...(node.description === undefined
    ? []
    : [
        element(
          "Typography",
          [staticProp("variant", "body2"), staticProp("color", "text.secondary")],
          [text(node.description)],
        ),
      ]),
];

const stack = (children: readonly ElementNode[], props: readonly PropBinding[] = []): ElementNode =>
  element("Stack", [staticProp("spacing", 2), ...props], children);

const section: UiAdapter["section"] = ({ field: node, children }) =>
  stack([...heading(node), ...children]);

const list: UiAdapter["list"] = ({ field: node, rowLabel, handle, index, row }) =>
  stack([
    ...heading(node),
    {
      kind: "each",
      items: member(handle, "ids"),
      item: "id",
      index,
      key: ref("id"),
      body: element(
        "Stack",
        [
          staticProp("direction", "row"),
          staticProp("spacing", 2),
          exprProp("sx", object({ alignItems: lit("flex-start") })),
        ],
        [
          stack(row, [exprProp("sx", object({ flexGrow: lit(1) }))]),
          element(
            "Button",
            [
              staticProp("type", "button"),
              staticProp("color", "error"),
              eventProp("click", arrow([], call(member(handle, "remove"), [ref(index)]))),
            ],
            [text("Remove")],
          ),
        ],
      ),
    },
    when(
      isDefined(member(handle, "error")),
      element("FormHelperText", [staticProp("error")], [exprNode(member(handle, "error"))]),
    ),
    element(
      "Box",
      [],
      [
        element(
          "Button",
          [
            staticProp("type", "button"),
            staticProp("variant", "outlined"),
            eventProp("click", member(handle, "append")),
          ],
          [text(`Add ${rowLabel.toLowerCase()}`)],
        ),
      ],
    ),
  ]);

const variants: UiAdapter["variants"] = ({ field: node, handle, branches }) => {
  const error = member(handle, "error");
  const required = mustBeFilled(node);

  return stack([
    // The same select a choice field gets, bound straight to the variant
    // handle. Its options are fixed by the schema, so they are written out
    // rather than mapped from a prop.
    element(
      "TextField",
      [
        staticProp("select"),
        staticProp("fullWidth"),
        exprProp("name", member(handle, "name")),
        staticProp("label", node.label),
        ...(required ? [staticProp("required")] : []),
        exprProp("value", member(handle, "value")),
        exprProp("error", isDefined(error)),
        exprProp(
          "helperText",
          node.description === undefined ? error : binary("??", error, lit(node.description)),
        ),
        eventProp(
          "change",
          arrow(
            ["event"],
            call(member(handle, "setValue"), [member(member(ref("event"), "target"), "value")]),
          ),
        ),
        eventProp("blur", member(handle, "onBlur")),
      ],
      [
        // A union the schema lets stay unset needs a way back to unset.
        ...(required
          ? []
          : [element("MenuItem", [staticProp("value", "")], [element("em", [], [text("None")])])]),
        ...branches.map((branch) =>
          element("MenuItem", [staticProp("value", String(branch.tag))], [text(branch.label)]),
        ),
      ],
    ),
    // A branch that is only its tag has nothing more to show.
    ...branches
      .filter((branch) => branch.children.length > 0)
      .map((branch) =>
        when(
          binary("===", member(handle, "value"), lit(String(branch.tag))),
          stack(branch.children),
        ),
      ),
  ]);
};

const form: UiAdapter["form"] = ({ handle, onSubmit, submitLabel, children }) =>
  element(
    "Box",
    [
      staticProp("component", "form"),
      // The schema validates; the browser's own bubbles would only race it.
      staticProp("noValidate"),
      eventProp("submit", call(member(handle, "handleSubmit"), [onSubmit])),
    ],
    [
      stack([
        ...children,
        when(
          isDefined(member(handle, "error")),
          element("Alert", [staticProp("severity", "error")], [exprNode(member(handle, "error"))]),
        ),
        element(
          "Box",
          [],
          [
            element(
              "Button",
              [
                staticProp("type", "submit"),
                staticProp("variant", "contained"),
                exprProp("disabled", member(handle, "submitting")),
              ],
              [exprNode(submitLabel)],
            ),
          ],
        ),
      ]),
    ],
  );

const unbound: UiAdapter["unbound"] = ({ field: node, reason }) =>
  comment(
    `TODO(formation): "${node.path.join(".")}" has no control — ${reason}. Its value is still in the store.`,
  );

/**
 * `major` is accepted, and the output is verified per major, but today the two
 * supported majors take identical source: everything emitted here (`slotProps`
 * on TextField, `Stack`, `sx`) has the same surface in 7 and 9. The parameter
 * is the seam for the first API that does diverge.
 */
export const muiAdapter = (_major: MuiMajor): UiAdapter => ({
  imports,
  controlNames,
  controls: (kinds, state) => kinds.map((kind) => CONTROLS[kind](state)),
  control,
  section,
  list,
  variants,
  form,
  unbound,
});
