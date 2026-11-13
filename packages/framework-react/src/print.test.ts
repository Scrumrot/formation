import type { ComponentIR, ComponentModule, ImportMap } from "@formation/core";
import {
  arrow,
  binary,
  call,
  comment,
  element,
  eventProp,
  exprNode,
  exprProp,
  lit,
  member,
  object,
  pathExpr,
  ref,
  slotProp,
  staticProp,
  text,
  when,
} from "@formation/core";
import { describe, expect, it } from "vitest";

import { printComponent, printExpr, printModule, printNode } from "./print.js";

describe("printExpr", () => {
  it("spells each expression kind", () => {
    expect(printExpr(call(member(ref("field"), "setValue"), [lit("a"), lit(1), lit(null)]))).toBe(
      'field.setValue("a", 1, null)',
    );
    expect(printExpr(arrow(["event"], member(member(ref("event"), "target"), "value")))).toBe(
      "(event) => event.target.value",
    );
    expect(printExpr(pathExpr([ref("path"), ref("index"), "name"]))).toBe(
      "`${path}.${index}.name`",
    );
  });

  it("parenthesizes where precedence would otherwise change the meaning", () => {
    // Without the parentheses this is `a ?? (b !== undefined)`.
    expect(printExpr(binary("!==", binary("??", ref("a"), ref("b")), ref("undefined")))).toBe(
      "(a ?? b) !== undefined",
    );
    // A bare `{` after `=>` opens a block, not an object literal.
    expect(printExpr(arrow([], object({ a: lit(1) })))).toBe("() => ({ a: 1 })");
  });

  it("uses shorthand for same-named entries and quotes keys that need it", () => {
    expect(printExpr(object({ inputMode: ref("inputMode"), "aria-label": lit("x") }))).toBe(
      '{ inputMode, "aria-label": "x" }',
    );
  });

  it("escapes template text so a schema key cannot inject an interpolation", () => {
    expect(printExpr({ kind: "template", parts: ["a`b${c}", ref("x")] })).toBe("`a\\`b\\${c}${x}`");
  });
});

describe("printNode", () => {
  it("writes plain strings as attributes and everything else as expressions", () => {
    const node = element("TextField", [
      staticProp("fullWidth"),
      staticProp("label", "Email"),
      staticProp("minRows", 3),
      exprProp("path", lit("address.street")),
      exprProp("value", member(ref("field"), "value")),
      eventProp("change", ref("onChange")),
    ]);

    expect(printNode(node)).toBe(
      '<TextField fullWidth label="Email" minRows={3} path="address.street" value={field.value} onChange={onChange} />',
    );
  });

  it("does not let a label change what the JSX means", () => {
    // Labels are data from someone's schema. Quotes, braces, angle brackets and
    // entities all have meaning in JSX, so each goes through a string expression.
    const hostile = 'Say "hi" & <b>{now}</b>';

    expect(printNode(element("Label", [staticProp("text", hostile)]))).toBe(
      `<Label text={${JSON.stringify(hostile)}} />`,
    );
    expect(printNode(text(hostile))).toBe(`{${JSON.stringify(hostile)}}`);
    expect(printNode(text("Remove"))).toBe("Remove");
  });

  it("keeps a comment from closing itself early", () => {
    expect(printNode(comment("see a */ b"))).toBe("{/* see a * / b */}");
  });

  it("renders a condition as a ternary, never as `&&`", () => {
    // `count && <X />` renders a literal 0 when count is 0.
    expect(printNode(when(ref("visible"), element("Alert")))).toBe(
      "{visible ? (<Alert />) : null}",
    );
  });

  it("puts the key on the element a list renders", () => {
    const node = {
      kind: "each" as const,
      items: member(ref("list"), "ids"),
      item: "id",
      index: "index",
      key: ref("id"),
      body: element("Row", [exprProp("index", ref("index"))]),
    };

    expect(printNode(node)).toBe("{list.ids.map((id, index) => (<Row key={id} index={index} />))}");
  });

  it("passes an element-valued prop as JSX", () => {
    expect(printNode(element("FormControlLabel", [slotProp("control", element("Switch"))]))).toBe(
      "<FormControlLabel control={<Switch />} />",
    );
  });
});

const sample: ComponentIR = {
  name: "TextControl",
  props: [
    { name: "path", type: "ProfileTextPath", uses: ["ProfileTextPath"], optional: false },
    { name: "label", type: "string", optional: false, doc: "Shown above the input." },
    { name: "type", type: "string", optional: true, defaultValue: lit("text") },
  ],
  setup: [{ name: "field", init: call(ref("useProfileText"), [ref("path")]) }],
  root: element("TextField", [exprProp("label", ref("label"))], [exprNode(ref("type"))]),
};

const imports: ImportMap = {
  TextField: { from: "@mui/material", typeOnly: false },
  Stack: { from: "@mui/material", typeOnly: false },
  useProfileText: { from: "./store", typeOnly: false },
  ProfileTextPath: { from: "./store", typeOnly: true },
  TextControl: { from: "./controls", typeOnly: false },
};

describe("printComponent", () => {
  it("declares a named, readonly props type and destructures with defaults", () => {
    const source = printComponent(sample);

    expect(source).toContain("export type TextControlProps = Readonly<{");
    expect(source).toContain("/** Shown above the input. */\nlabel: string;");
    expect(source).toContain("type?: string;");
    expect(source).toContain(
      'export const TextControl = ({ path, label, type = "text" }: TextControlProps) => {',
    );
    expect(source).toContain("const field = useProfileText(path);");
  });

  it("takes no parameter list type when there are no props", () => {
    expect(printComponent({ ...sample, props: [] })).toContain(
      "export const TextControl = () => {",
    );
  });
});

describe("printModule", () => {
  const module: ComponentModule = { name: "controls", components: [sample] };

  it("imports exactly what the trees reference", () => {
    const source = printModule(module, imports);

    expect(source).toContain('import { TextField } from "@mui/material";');
    // `Stack` is in the map but unused here; locals like `path` are in neither.
    expect(source).not.toContain("Stack");
  });

  it("marks type-only names so the output survives verbatimModuleSyntax", () => {
    expect(printModule(module, imports)).toContain(
      'import { type ProfileTextPath, useProfileText } from "./store";',
    );
  });

  it("does not import a component from the file that defines it", () => {
    expect(printModule(module, imports)).not.toContain('from "./controls"');
  });

  it("orders packages before relative modules", () => {
    const source = printModule(module, imports);

    expect(source.indexOf("@mui/material")).toBeLessThan(source.indexOf("./store"));
  });
});
