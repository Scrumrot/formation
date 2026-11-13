export type { Diagnostic, DiagnosticCode, DiagnosticSeverity, Outcome } from "./diagnostics.js";
export { failed, hasErrors, ok } from "./diagnostics.js";

export type {
  Bound,
  Constraint,
  DateEncoding,
  EnumOption,
  FieldNode,
  FieldShape,
  FormIR,
  Message,
  StringFormat,
} from "./form-ir.js";
export { INDEX_SEGMENT, flattenFields, hasUnsupportedFields, isAddressable } from "./form-ir.js";

export type {
  ControlBinding,
  ControlKind,
  FormBindings,
  ListField,
  Variant,
  VariantField,
} from "./bindings.js";
export {
  collectBindings,
  controlKindOf,
  controlKinds,
  isListField,
  mustBeFilled,
  pathPattern,
  pathTypeText,
  rowField,
  variantFieldOf,
} from "./bindings.js";

export type {
  BinaryOperator,
  ComponentIR,
  ComponentModule,
  ElementNode,
  Expr,
  ImportMap,
  ImportSource,
  PrinterCapabilities,
  PropBinding,
  PropDecl,
  SetupBinding,
} from "./component-ir.js";
export {
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
  object,
  pathExpr,
  ref,
  slotProp,
  staticProp,
  text,
  undefinedExpr,
  when,
} from "./component-ir.js";

export type {
  ControlSite,
  GeneratedFile,
  HookRef,
  StateAdapter,
  StateAdapterInput,
  StateAdapterOutput,
  StateBinding,
  UiAdapter,
} from "./adapters.js";

export type { AssembledForm } from "./assemble.js";
export { CONTROLS_MODULE, assembleForm } from "./assemble.js";

export {
  camelCase,
  capitalize,
  isIdentifier,
  labelFromName,
  pascalCase,
  singularize,
  splitWords,
} from "./casing.js";
