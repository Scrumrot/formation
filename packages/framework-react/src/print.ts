import type {
  ComponentIR,
  ComponentModule,
  ElementNode,
  Expr,
  ImportMap,
  PrinterCapabilities,
  PropBinding,
  PropDecl,
} from "@formation/core";
import { capitalize, isIdentifier } from "@formation/core";

/**
 * ComponentIR → TSX source.
 *
 * The bar here is *parseable*, not pretty: the CLI runs Prettier over the
 * result (docs/plan.md §6), so this file never counts indentation. What it
 * does have to get exactly right is escaping — a label is user data from a
 * schema, and a quote or a brace in one must not change what the JSX means.
 */

export const capabilities: PrinterCapabilities = { spread: true };

/** Extension of the files this printer writes. */
export const EXTENSION = "tsx";

// ---- Expressions ------------------------------------------------------------

const templateText = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const objectKey = (name: string): string => (isIdentifier(name) ? name : JSON.stringify(name));

// Arrow functions and `??`/`||`/`&&` bind loosely, so they are parenthesized
// wherever they sit inside a larger expression. Over-parenthesizing is free:
// Prettier removes what is redundant.
const grouped = (expr: Expr): string =>
  expr.kind === "binary" || expr.kind === "arrow" ? `(${printExpr(expr)})` : printExpr(expr);

// No `default` arm: a new Expr variant must be given a spelling here.
export const printExpr = (expr: Expr): string => {
  switch (expr.kind) {
    case "ref":
      return expr.name;
    case "member":
      return `${grouped(expr.object)}.${expr.property}`;
    case "call":
      return `${grouped(expr.callee)}(${expr.args.map(printExpr).join(", ")})`;
    case "lit":
      return typeof expr.value === "string" ? JSON.stringify(expr.value) : String(expr.value);
    case "template":
      return `\`${expr.parts
        .map((part) => (typeof part === "string" ? templateText(part) : `\${${printExpr(part)}}`))
        .join("")}\``;
    case "arrow": {
      const body = printExpr(expr.body);

      // A bare `{` after `=>` opens a block, not an object literal.
      return `(${expr.params.join(", ")}) => ${expr.body.kind === "object" ? `(${body})` : body}`;
    }
    case "binary":
      return `${grouped(expr.left)} ${expr.operator} ${grouped(expr.right)}`;
    case "object":
      return expr.entries.length === 0
        ? "{}"
        : `{ ${expr.entries
            .map(([name, value]) =>
              value.kind === "ref" && value.name === name && isIdentifier(name)
                ? name
                : `${objectKey(name)}: ${printExpr(value)}`,
            )
            .join(", ")} }`;
    case "array":
      return `[${expr.items.map(printExpr).join(", ")}]`;
    case "raw":
      return expr.code;
  }
};

// ---- JSX --------------------------------------------------------------------

// A JSX attribute string has no escapes and decodes HTML entities, so anything
// that could be misread goes through an expression container instead.
const isPlainAttribute = (value: string): boolean => /^[^"&\\{}<>\n\r]*$/.test(value);

// JSX text collapses whitespace and treats `{`, `}`, `<`, `>` and `&` as
// syntax. Text with none of that is written bare; the rest becomes a string
// expression, which is always exact.
const isPlainText = (value: string): boolean =>
  /^[^{}<>&\n\r]+$/.test(value) && value === value.trim();

const printProp = (prop: PropBinding): string => {
  switch (prop.kind) {
    case "static":
      return prop.value === true
        ? prop.name
        : typeof prop.value === "string" && isPlainAttribute(prop.value)
          ? `${prop.name}="${prop.value}"`
          : `${prop.name}={${JSON.stringify(prop.value)}}`;
    case "expr":
      // A plain string literal is written as an attribute (`path="email"`), the
      // way a person would; Prettier does not make that simplification itself.
      return prop.expr.kind === "lit" &&
        typeof prop.expr.value === "string" &&
        isPlainAttribute(prop.expr.value)
        ? `${prop.name}="${prop.expr.value}"`
        : `${prop.name}={${printExpr(prop.expr)}}`;
    case "event":
      return `on${capitalize(prop.name)}={${printExpr(prop.handler)}}`;
    case "slot":
      return `${prop.name}={${printElement(prop.node)}}`;
    case "spread":
      return `{...${printExpr(prop.expr)}}`;
  }
};

/** A node where an *expression* is expected: a prop value, a branch of `?:`, a `.map` body. */
const printElement = (node: ElementNode): string =>
  node.kind === "element" ? printNode(node) : `<>${printNode(node)}</>`;

const withKey = (node: ElementNode, key: Expr): string =>
  node.kind === "element"
    ? printNode({ ...node, props: [{ kind: "expr", name: "key", expr: key }, ...node.props] })
    : // Only an element can carry a key, so anything else is wrapped in a keyed Fragment.
      `<Fragment key={${printExpr(key)}}>${printNode(node)}</Fragment>`;

/** A node where JSX *children* are expected. */
export const printNode = (node: ElementNode): string => {
  switch (node.kind) {
    case "element": {
      const props = node.props.map(printProp).join(" ");
      const open = `<${node.tag}${props.length > 0 ? ` ${props}` : ""}`;

      return node.children.length === 0
        ? `${open} />`
        : `${open}>${node.children.map(printNode).join("\n")}</${node.tag}>`;
    }
    case "text":
      return isPlainText(node.value) ? node.value : `{${JSON.stringify(node.value)}}`;
    case "expr":
      return `{${printExpr(node.expr)}}`;
    case "each":
      return `{${grouped(node.items)}.map((${[node.item, ...(node.index === undefined ? [] : [node.index])].join(", ")}) => (${withKey(node.body, node.key)}))}`;
    case "when":
      // `cond ? x : null`, not `cond && x`: the latter renders a stray `0` or
      // `""` when the test is a falsy non-boolean.
      return `{${printExpr(node.test)} ? (${printElement(node.then)}) : null}`;
    case "comment":
      return `{/* ${node.text.replace(/\*\//g, "* /")} */}`;
  }
};

// ---- Components -------------------------------------------------------------

const jsDoc = (doc: string | undefined): string =>
  doc === undefined ? "" : `/** ${doc.replace(/\*\//g, "* /")} */\n`;

const propsTypeName = (component: ComponentIR): string => `${component.name}Props`;

const printPropsType = (component: ComponentIR): string =>
  component.props.length === 0
    ? ""
    : `export type ${propsTypeName(component)} = Readonly<{\n${component.props
        .map((prop) => `${jsDoc(prop.doc)}${prop.name}${prop.optional ? "?" : ""}: ${prop.type};`)
        .join("\n")}\n}>;\n\n`;

const printParam = (prop: PropDecl): string =>
  prop.defaultValue === undefined ? prop.name : `${prop.name} = ${printExpr(prop.defaultValue)}`;

export const printComponent = (component: ComponentIR): string => {
  const params =
    component.props.length === 0
      ? "()"
      : `({ ${component.props.map(printParam).join(", ")} }: ${propsTypeName(component)})`;
  const setup = component.setup
    .map((binding) => `const ${binding.name} = ${printExpr(binding.init)};`)
    .join("\n");

  return `${printPropsType(component)}${jsDoc(component.doc)}export const ${component.name} = ${params} => {
${setup}

return (
${printElement(component.root)}
);
};
`;
};

// ---- Imports ----------------------------------------------------------------

const exprRefs = (expr: Expr): readonly string[] => {
  switch (expr.kind) {
    case "ref":
      return [expr.name];
    case "member":
      return exprRefs(expr.object);
    case "call":
      return [...exprRefs(expr.callee), ...expr.args.flatMap(exprRefs)];
    case "template":
      return expr.parts.flatMap((part) => (typeof part === "string" ? [] : exprRefs(part)));
    case "arrow":
      return exprRefs(expr.body);
    case "binary":
      return [...exprRefs(expr.left), ...exprRefs(expr.right)];
    case "object":
      return expr.entries.flatMap(([, value]) => exprRefs(value));
    case "array":
      return expr.items.flatMap(exprRefs);
    // Opaque by definition: a `raw` expression's imports are its author's problem.
    case "lit":
    case "raw":
      return [];
  }
};

const propRefs = (prop: PropBinding): readonly string[] => {
  switch (prop.kind) {
    case "static":
      return [];
    case "expr":
    case "spread":
      return exprRefs(prop.expr);
    case "event":
      return exprRefs(prop.handler);
    case "slot":
      return nodeRefs(prop.node);
  }
};

const nodeRefs = (node: ElementNode): readonly string[] => {
  switch (node.kind) {
    case "element":
      return [node.tag, ...node.props.flatMap(propRefs), ...node.children.flatMap(nodeRefs)];
    case "expr":
      return exprRefs(node.expr);
    case "each":
      return [
        ...exprRefs(node.items),
        ...exprRefs(node.key),
        ...nodeRefs(node.body),
        // The keyed-Fragment fallback in `withKey` is the one tag the printer adds itself.
        ...(node.body.kind === "element" ? [] : ["Fragment"]),
      ];
    case "when":
      return [...exprRefs(node.test), ...nodeRefs(node.then)];
    case "text":
    case "comment":
      return [];
  }
};

const componentRefs = (component: ComponentIR): readonly string[] => [
  ...component.props.flatMap((prop) => [
    ...(prop.uses ?? []),
    ...(prop.defaultValue === undefined ? [] : exprRefs(prop.defaultValue)),
  ]),
  ...component.setup.flatMap((binding) => exprRefs(binding.init)),
  ...nodeRefs(component.root),
];

const REACT_IMPORTS: ImportMap = { Fragment: { from: "react", typeOnly: false } };

// Packages before relative modules, each group alphabetical: a stable order, so
// regenerating an untouched form produces no diff.
const bySpecifier = (a: string, b: string): number =>
  Number(a.startsWith(".")) - Number(b.startsWith(".")) || a.localeCompare(b);

const printImports = (module: ComponentModule, imports: ImportMap): string => {
  const known: ImportMap = { ...REACT_IMPORTS, ...imports };
  const own = new Set(module.components.map((component) => component.name));
  // Only names the import map knows are imported. Every other reference is a
  // local — a prop, a hook result, an event parameter — which is why adapters
  // never have to declare their locals.
  const used = [...new Set(module.components.flatMap(componentRefs))]
    .filter((name) => !own.has(name))
    .flatMap((name) => {
      const source = known[name];

      return source === undefined || source.from === `./${module.name}` ? [] : [{ name, source }];
    });
  const specifiers = [...new Set(used.map((entry) => entry.source.from))].sort(bySpecifier);

  return specifiers
    .map((from) => {
      const names = used
        .filter((entry) => entry.source.from === from)
        .sort((a, b) => a.name.localeCompare(b.name));
      const allTypes = names.every((entry) => entry.source.typeOnly);
      const list = names
        .map((entry) => (entry.source.typeOnly && !allTypes ? `type ${entry.name}` : entry.name))
        .join(", ");

      return `import ${allTypes ? "type " : ""}{ ${list} } from ${JSON.stringify(from)};`;
    })
    .join("\n");
};

/** One component file's source. Unformatted; the CLI runs Prettier over it. */
export const printModule = (module: ComponentModule, imports: ImportMap): string =>
  `${printImports(module, imports)}\n\n${module.components.map(printComponent).join("\n")}`;
