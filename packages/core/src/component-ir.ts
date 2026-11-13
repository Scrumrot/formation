/**
 * ComponentIR answers "what does the component contain": props, setup calls,
 * and an element tree with bindings — still without committing to JSX, a Vue
 * template, or Svelte markup.
 *
 * This is the IR that keeps the design from collapsing back into a
 * (framework × UI kit) cross-product. A UI adapter builds these trees; a
 * framework printer serializes them; neither knows the other exists (see
 * docs/plan.md §2 and §6).
 */

/**
 * A small expression tree rather than strings of source. Every variant here is
 * something all the target template languages can spell, so a printer never has
 * to parse a string to find out what an adapter meant.
 */
export type Expr =
  | Readonly<{ kind: "ref"; name: string }>
  | Readonly<{ kind: "member"; object: Expr; property: string }>
  | Readonly<{ kind: "call"; callee: Expr; args: readonly Expr[] }>
  | Readonly<{ kind: "lit"; value: string | number | boolean | null }>
  /** A string built from fixed text and expressions, e.g. a row's field path. */
  | Readonly<{ kind: "template"; parts: readonly (string | Expr)[] }>
  | Readonly<{ kind: "arrow"; params: readonly string[]; body: Expr }>
  | Readonly<{ kind: "binary"; operator: BinaryOperator; left: Expr; right: Expr }>
  | Readonly<{ kind: "object"; entries: readonly (readonly [string, Expr])[] }>
  | Readonly<{ kind: "array"; items: readonly Expr[] }>
  /**
   * The escape hatch. Tagged rather than smuggled in as a `ref`, so a printer
   * can warn when source text written for one framework crosses into another.
   */
  | Readonly<{ kind: "raw"; code: string }>;

export type BinaryOperator = "===" | "!==" | "??" | "&&" | "||";

export type PropBinding =
  /** A fixed value known at generation time: `label="Email"`, `fullWidth`. */
  | Readonly<{ kind: "static"; name: string; value: string | number | boolean }>
  /** `value={x}` / `:value="x"` / `[value]="x"`. */
  | Readonly<{ kind: "expr"; name: string; expr: Expr }>
  /**
   * `name` is the bare event (`"change"`), not a framework spelling. The
   * printer turns it into `onChange` / `@change` / `on:change` / `(change)`.
   */
  | Readonly<{ kind: "event"; name: string; handler: Expr }>
  /**
   * An element passed as a prop — a slot in Vue and Svelte, an element-valued
   * prop in React. Kept distinct from `expr` because only the printer knows
   * which of those two shapes its framework wants.
   */
  | Readonly<{ kind: "slot"; name: string; node: ElementNode }>
  /**
   * Where framework-neutrality genuinely leaks: React and Svelte spread, Vue
   * has `v-bind`, Angular has nothing. Printers declare whether they can (see
   * `PrinterCapabilities`) and adapters enumerate bindings for those that can't.
   */
  | Readonly<{ kind: "spread"; expr: Expr }>;

export type ElementNode =
  | Readonly<{
      kind: "element";
      tag: string;
      props: readonly PropBinding[];
      children: readonly ElementNode[];
    }>
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "expr"; expr: Expr }>
  /** List rendering. `key` is evaluated per item and must be stable across reorders. */
  | Readonly<{
      kind: "each";
      items: Expr;
      item: string;
      /** Omitted when the body never needs the position. */
      index?: string;
      key: Expr;
      body: ElementNode;
    }>
  /** Conditional rendering — the repo-wide alternative to an early return. */
  | Readonly<{ kind: "when"; test: Expr; then: ElementNode }>
  /** A note left in the output, used for `TODO` stubs where a field could not be bound. */
  | Readonly<{ kind: "comment"; text: string }>;

export type PropDecl = Readonly<{
  name: string;
  /** Type as source text. TypeScript today; a JS printer would drop it. */
  type: string;
  /** Named types inside `type` that the module has to import. */
  uses?: readonly string[];
  optional: boolean;
  defaultValue?: Expr;
  doc?: string;
}>;

/** One `const name = init` in the component body — in practice, a hook call. */
export type SetupBinding = Readonly<{ name: string; init: Expr }>;

export type ComponentIR = Readonly<{
  name: string;
  doc?: string;
  props: readonly PropDecl[];
  setup: readonly SetupBinding[];
  root: ElementNode;
}>;

/** One generated component file. `name` has no extension; the printer owns that. */
export type ComponentModule = Readonly<{
  name: string;
  components: readonly ComponentIR[];
}>;

/**
 * Where an identifier comes from. Adapters publish a map of these instead of
 * writing import statements, and the printer derives each file's imports from
 * what its trees actually reference — so an import can't be forgotten or left
 * dangling after a control stops being used.
 */
export type ImportSource = Readonly<{ from: string; typeOnly: boolean }>;
export type ImportMap = Readonly<Record<string, ImportSource>>;

export type PrinterCapabilities = Readonly<{ spread: boolean }>;

// ---- Builders ---------------------------------------------------------------
// Adapters build a lot of these trees; the helpers keep that code reading like
// the markup it describes rather than like nested object literals.

export const ref = (name: string): Expr => ({ kind: "ref", name });

export const member = (object: Expr, property: string): Expr => ({
  kind: "member",
  object,
  property,
});

export const call = (callee: Expr, args: readonly Expr[] = []): Expr => ({
  kind: "call",
  callee,
  args,
});

export const lit = (value: string | number | boolean | null): Expr => ({ kind: "lit", value });

export const arrow = (params: readonly string[], body: Expr): Expr => ({
  kind: "arrow",
  params,
  body,
});

export const binary = (operator: BinaryOperator, left: Expr, right: Expr): Expr => ({
  kind: "binary",
  operator,
  left,
  right,
});

export const object = (entries: Readonly<Record<string, Expr>>): Expr => ({
  kind: "object",
  entries: Object.entries(entries),
});

export const array = (items: readonly Expr[]): Expr => ({ kind: "array", items });

/** `undefined` is an identifier, not a literal — which is why `lit` has no arm for it. */
export const undefinedExpr: Expr = ref("undefined");

export const isDefined = (expr: Expr): Expr => binary("!==", expr, undefinedExpr);

export const element = (
  tag: string,
  props: readonly PropBinding[] = [],
  children: readonly ElementNode[] = [],
): ElementNode => ({ kind: "element", tag, props, children });

export const text = (value: string): ElementNode => ({ kind: "text", value });

export const exprNode = (expr: Expr): ElementNode => ({ kind: "expr", expr });

export const when = (test: Expr, then: ElementNode): ElementNode => ({ kind: "when", test, then });

export const comment = (value: string): ElementNode => ({ kind: "comment", text: value });

export const staticProp = (name: string, value: string | number | boolean = true): PropBinding => ({
  kind: "static",
  name,
  value,
});

export const exprProp = (name: string, expr: Expr): PropBinding => ({ kind: "expr", name, expr });

export const eventProp = (name: string, handler: Expr): PropBinding => ({
  kind: "event",
  name,
  handler,
});

export const slotProp = (name: string, node: ElementNode): PropBinding => ({
  kind: "slot",
  name,
  node,
});

/**
 * Joins path parts into one expression: all-static parts collapse to a string
 * literal (`"address.street"`), anything involving a row index becomes a
 * template (`` `${path}.${index}.street` ``).
 */
export const pathExpr = (parts: readonly (string | Expr)[]): Expr => {
  const dotted = parts.flatMap((part, index) => (index === 0 ? [part] : [".", part]));
  // Adjacent static parts merge so the printed template has no `${"a"}.${"b"}` noise.
  const merged = dotted.reduce<readonly (string | Expr)[]>((out, part) => {
    const last = out[out.length - 1];

    return typeof part === "string" && typeof last === "string"
      ? [...out.slice(0, -1), last + part]
      : [...out, part];
  }, []);
  const only = merged[0];

  return merged.length === 0
    ? lit("")
    : merged.length === 1 && typeof only === "string"
      ? lit(only)
      : { kind: "template", parts: merged };
};
