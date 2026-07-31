# @formation — design plan

A form code generator with two surfaces:

1. **Generate into an existing app.** `formation generate ./schemas/user.ts` emits form
   components for a chosen stack.
2. **Generate a whole app.** `npm create formation@latest` — pick a stack, hand it schemas,
   get a repo. (Phase 2; shares everything below.)

Decisions already made:

| Question         | Decision                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Output ownership | **Eject / own it.** Generate once, the user edits freely, re-running warns before overwrite. |
| v0.1 scope       | **One vertical slice, end to end.**                                                          |
| Pilot stack      | React + TypeScript + formstand + shadcn/ui + Vitest                                          |
| Repo shape       | Monorepo                                                                                     |

---

## 1. Naming

`@formation/cli` and `create-formation` are both unclaimed on npm. Unscoped `formation`
is taken (v0.1.0, unrelated), which is why the scope is the right call regardless.

**Verify before committing:** a 404 on `@formation/cli` does _not_ prove the `formation`
_scope_ is free — scopes are owned by an org or user account independently of whether any
package under them exists. Confirm with `npm org create formation` (or by trying a
throwaway publish) before the name shows up in a README.

---

## 2. The core idea: this is a compiler, not a template engine

The naïve shape — a template per (framework × form library × UI library × runner) — is a
cross-product. Five schema libraries, four input formats, two syntaxes, seven frameworks,
several form libraries each, a dozen UI kits, three test runners. Thousands of templates,
none of them individually maintained.

The tractable shape is a compiler with **two IRs** and adapters that each know one thing:

```
   sources                    ingest              semantic IR
 ┌──────────────┐
 │ zod / valibot│──┐
 │ arktype      │  │
 │ typebox      │  ├──▶ ingest-* ──▶  FormIR  ──┐
 │ yup          │  │                            │
 │ TypeScript   │──┤                            │
 │ JSON Schema  │──┤                            │
 │ OpenAPI      │──┘                            │
 └──────────────┘                               │
                                                ▼
                              form adapter + ui adapter + resolver adapter
                                                │
                                                ▼
                                          ComponentIR          (imports, setup, element tree)
                                                │
                                       framework printer
                                                │
                                                ▼
                                          prettier ──▶ files
```

**FormIR** answers _what the form means_: fields, types, constraints, messages.
**ComponentIR** answers _what the component contains_: imports, hook calls, an element tree
with bindings — but still framework-neutral.

That second IR is the load-bearing one. Without it, every UI adapter would need to know JSX
vs. Vue templates vs. Svelte vs. Angular, and you are back to N×M. With it, a UI adapter is
a pure function `FieldNode → ControlSpec`, and a framework printer is a pure function
`ComponentIR → string`. Adding Mantine costs one file. Adding Svelte costs one file.

---

## 3. FormIR

Semantic, lossless-where-it-matters, and explicit about what it could not represent.

```ts
export type FormIR = Readonly<{
  name: string;
  fields: readonly FieldNode[];
  diagnostics: readonly Diagnostic[];
}>;

export type FieldNode = Readonly<{
  path: readonly string[]; // ["address", "street"] — adapters serialize this themselves
  label: string;
  optional: boolean;
  description?: string;
  shape: FieldShape;
}>;

export type FieldShape =
  | { kind: "string"; format?: StringFormat; min?: number; max?: number; pattern?: string }
  | { kind: "number"; min?: number; max?: number; step?: number; integer: boolean }
  | { kind: "boolean" }
  | { kind: "enum"; options: readonly EnumOption[] }
  | { kind: "date"; min?: string; max?: string }
  | { kind: "file"; accept?: readonly string[]; multiple: boolean }
  | { kind: "array"; of: FieldShape; min?: number; max?: number }
  | { kind: "object"; fields: readonly FieldNode[] }
  | { kind: "union"; discriminator?: string; variants: readonly FieldShape[] }
  | { kind: "unsupported"; reason: string };
```

Three things earn their place:

- **`unsupported` is a variant, not a dropped field.** A `z.custom()` or a transform with no
  static shape becomes a node the emitters turn into a commented `// TODO:` stub. Silently
  omitting a field from a generated form is the worst possible failure mode — the form
  compiles, passes tests, and loses data.
- **`diagnostics` is a return channel, not a throw.** Ingest is lossy by nature (see §4);
  the CLI prints what was lost. Matches the repo rule that expected failure is a value.
- **`path` is an array, not a string.** `address.street` vs `address[street]` vs
  `["address","street"]` is a form-library concern; FormIR must not pick a side.

Constraints stay attached to fields rather than being flattened into "a validator", because
the **test emitter reads them** (§7) and so does the UI adapter (a `max: 500` string becomes
a textarea, not an input).

---

## 4. Ingest

**JSON Schema is the hub**, because nearly every source can reach it:

| Source     | Route                                                            |
| ---------- | ---------------------------------------------------------------- |
| TypeBox    | Already JSON Schema                                              |
| Zod        | `z.toJSONSchema()` (v4+)                                         |
| Valibot    | `@valibot/to-json-schema`                                        |
| ArkType    | `.toJsonSchema()`                                                |
| Yup        | No JSON Schema export — introspect `schema.describe()` directly  |
| TypeScript | `ts-json-schema-generator` or the TS compiler API via `ts-morph` |
| OpenAPI    | Extract `components.schemas`, convert the dialect differences    |

**But JSON Schema is not the IR.** It loses exactly the things a form needs: custom error
messages, refinements, field ordering guarantees, branded types, UI hints. So each ingest
adapter converts to `FormIR` and may consult the _native_ schema for what JSON Schema drops.
Zod's ingest reads `z.toJSONSchema()` for structure and the Zod internals for messages.

Every lossy step emits a `Diagnostic`. Yup, TypeScript, and OpenAPI are the lossiest and
should say so out loud.

**Bulk mode** is just `FormIR[]` plus a shared symbol table so `$ref`/imported types resolve
across files instead of being inlined per form.

---

## 5. The registry (compatibility)

One declarative source of truth describing which combinations exist:

```ts
export const registry = {
  frameworks: { react: { versions: ">=18", ext: "tsx", printer: "jsx" } /* … */ },
  formLibraries: {
    formstand: { frameworks: ["react"] },
    "@tanstack/react-form": { frameworks: ["react"] },
    "react-hook-form": { frameworks: ["react"] },
    // …
  },
  uiLibraries: { "shadcn/ui": { frameworks: ["react"] }, vuetify: { frameworks: ["vue"] } },
  resolvers: {/* formLib × schemaLib → package + call */},
} as const;
```

Both CLI modes consume it: the **wizard** filters the next question's options by it (pick
Vue, never see shadcn), and the **raw CLI** validates flag combinations against it with the
same error text. This is the thing that keeps the two modes from drifting into two products.

---

## 6. Emit

Four adapter kinds, each with one job:

**UI adapter** — `FieldNode → ControlSpec`. Which component, which import, which props.
No framework knowledge. `{ kind: "string", format: "email" }` → `<Input type="email" />`
plus the shadcn import path.

**Form-library adapter** — how state is declared, how a field binds, how errors are read,
how submit wires up, how a `path` is serialized, which resolver package applies.

**Resolver adapter** — the `zodResolver(schema)` glue, and (optionally) emitting the schema
itself when the user's input was TypeScript or JSON Schema and they want a runtime validator.

**Framework printer** — `ComponentIR → source text`.

### ComponentIR

```ts
export type PropBinding =
  | { kind: "static"; name: string; value: string | number | boolean }
  | { kind: "expr"; name: string; expr: Expr } // value={x} / :value="x" / [value]="x"
  | { kind: "event"; name: string; handler: Expr } // onChange / @change / on:change / (change)
  | { kind: "spread"; expr: Expr };
```

`spread` is where framework-neutrality genuinely leaks: React and Svelte have it, Vue has
`v-bind="obj"`, Angular templates have nothing equivalent. So **printers declare
capabilities**, and the emitter degrades — a printer that can't spread gets explicit
bindings enumerated for it instead. Better to design that in now than to discover it when
the Angular adapter lands and every UI adapter needs rewriting.

`Expr` stays a small tagged tree (`ref` / `member` / `call` / `lit` / `raw`). The `raw`
escape hatch exists, but it's a tagged variant so printers can warn when a raw string
crosses a framework boundary.

### Formatting

Do not hand-roll indentation. Emit approximately-correct text and run Prettier over it —
built-in parsers cover TS/JSX/Vue/Angular HTML, `prettier-plugin-svelte` covers the rest.
This turns "the printer must produce beautiful output" into "the printer must produce
_parseable_ output", which is a far cheaper correctness bar.

---

## 7. Tests

Per the brief: `--tests` takes a **list**, not a choice (`--tests vitest,playwright`), and
config grows a `tests` block alongside `ui` and `layout`.

Combinations are not the same test twice. Derive **cases** from FormIR once:

```ts
export type TestCase =
  | { kind: "happy-path"; values: Record<string, unknown> }
  | { kind: "required-empty"; field: readonly string[]; message: string }
  | { kind: "below-min" | "above-max"; field: readonly string[]; value: unknown; message: string }
  | { kind: "invalid-enum"; field: readonly string[]; value: unknown; message: string }
  | { kind: "array-min"; field: readonly string[]; count: number; message: string };
```

Then emit per runner:

- **Vitest / Jest** — component spec. Render, fill, assert the schema's own messages appear.
  These two share a generator; they differ in imports and globals, not in structure. The
  Testing Library package is chosen by the _framework_ adapter (`@testing-library/react`,
  `/vue`, `/svelte`, …).
- **Playwright** — browser spec. Navigate, fill by label and role, assert visible text.
  Structurally different, not a syntax variant.

One thing the brief doesn't resolve: **a Playwright spec needs a URL.** In app mode the
generator knows the route. In generate-into-existing-app mode it does not, so `--tests
playwright` needs `--route /signup` or it emits a spec with a `TODO` placeholder URL and a
diagnostic. Worth deciding which; the placeholder is friendlier.

---

## 8. CLI

Two modes, one engine. The unifier: **the wizard's real output is a config file plus the
equivalent raw command, printed on completion.** Anything the wizard can do is reproducible
in CI, and users learn the flags by using the wizard.

```
formation generate ./schemas/user.ts \
  --framework react --form formstand --ui shadcn \
  --resolver zod --syntax ts --tests vitest,playwright \
  --out ./src/components/forms
```

```ts
// formation.config.ts
export default defineConfig({
  schema: { source: "./schemas/**/*.ts", library: "zod" },
  output: { framework: "react", syntax: "ts", form: "formstand", dir: "./src/components/forms" },
  ui: { library: "shadcn", extensions: ["date-picker"] },
  layout: {/* … */},
  tests: { runners: ["vitest", "playwright"] },
});
```

Flags override config. Suggested libraries: `commander` or `clipanion` for parsing,
`@clack/prompts` for the wizard.

**Eject semantics** (per the ownership decision): files are written once and re-running
detects modification (content hash recorded in a small `.formation/manifest.json`) and
prompts before overwrite, with `--force` to skip the prompt. Untouched files regenerate
silently; edited files never get clobbered without a word.

---

## 9. Monorepo layout

pnpm workspaces + Changesets. The split exists so third parties can publish
`@formation/ui-mantine` without a PR to this repo.

```
packages/
  core/            FormIR, ComponentIR, pipeline, diagnostics
  registry/        compatibility matrix — consumed by both CLI modes
  plugin-kit/      public adapter interfaces + test harness for adapter authors
  ingest-zod/      … ingest-json-schema, ingest-typescript, ingest-openapi, ingest-yup, …
  framework-react/ printer + Testing Library binding   (… -vue, -svelte, -solid, …)
  form-formstand/  … form-tanstack, form-rhf, form-formik, form-final-form
  ui-shadcn/       … ui-mui, ui-mantine, ui-vuetify
  tests-vitest/    … tests-jest, tests-playwright
  cli/             @formation/cli
  create/          create-formation (app mode, phase 2)
examples/
fixtures/          canonical schemas (see §10)
```

Ship `plugin-kit` early even though it's small. Breadth across this matrix has to come from
contributors; if the adapter API isn't public by the time there are four adapters, it will
be shaped by whatever the first four happened to need.

---

## 10. Testing the generator

This is the largest sustained engineering cost and the thing most likely to be
under-invested in. Snapshot tests alone are not enough — they prove output is _stable_, not
that it _compiles_.

Three layers:

1. **Unit** — ingest and adapters are pure functions. Cheap, fast, most of the coverage.
2. **Snapshot** — canonical fixture schemas × sampled stack combinations. Fixtures should
   cover: kitchen-sink primitives, deeply nested objects, array-of-objects, discriminated
   union, and one schema with a deliberately `unsupported` node.
3. **Golden projects** — a small set of generated apps actually installed, typechecked,
   built, and their generated tests _run_, in CI. This is what catches a UI library's
   breaking change or a resolver package rename. Expensive, so sample the matrix rather than
   covering it; run nightly rather than per-PR if needed.

Without layer 3, generated code rots silently and the first person to notice is a user.

---

## 11. v0.1 milestones

The slice: **Zod + JSON Schema in → React + TS + formstand + shadcn/ui + Vitest out.**

1. `core` — FormIR types, diagnostics, pipeline skeleton
2. `ingest-json-schema`, then `ingest-zod` on top of it
3. `registry` with just the pilot stack in it
4. ComponentIR + the JSX printer + Prettier pass
5. `ui-shadcn` control map, `form-formstand` adapter
6. `cli generate` — raw flags only
7. `tests-vitest` — TestCase derivation + component spec emitter
8. Wizard (`@clack/prompts`) + config file + "here's the equivalent command" output
9. Golden project in CI

Then, before broadening: **add Vue or Svelte second, not fifth.** The render-tree IR is a
hypothesis until a non-JSX printer exists. Everything about the adapter API should be
considered provisional until that happens — which is an argument for tagging v0.1 as
`0.x` and keeping `plugin-kit` explicitly unstable.

---

## 12. Risks worth naming now

- **formstand's maturity.** Verify its current release status and API surface before making
  it the flagship adapter — a pre-1.0, low-activity dependency at the center of the pilot
  slice is a real risk. If it's thin, `react-hook-form` is the safer pilot and formstand
  becomes the second adapter (which also proves the form-adapter boundary earlier).
- **UI library churn.** Control maps go stale silently. Layer 3 testing is the only defense.
- **shadcn is not a dependency**, it's copy-in source. The generator either assumes the
  user already ran `shadcn add input`, or shells out to do it. Decide which — it changes
  what "generate a form" means on a fresh repo.
- **OpenAPI ingest is a tar pit.** Discriminators, `allOf` merging, nullable-vs-optional,
  vendor extensions. Scope it to a documented subset and diagnose the rest.
- **Angular** is the printer most likely to break the ComponentIR assumptions (no spread,
  template syntax, DI, standalone-vs-module). Treat it as a later validation of the design,
  not an early win.

---

## 13. Housekeeping

`CLAUDE.md` at the repo root is inherited from formstand — it describes _that_ library
("formstand is a library rather than an app"). The code-style rules are good and worth
keeping verbatim; the framing paragraphs need rewriting for this project.
