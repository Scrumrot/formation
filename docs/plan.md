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
| Pilot stack      | React + TypeScript + **zustand** (raw store) + **MUI 7 and 9**. Built; see §11.              |
| State axis       | One axis, `--state`, for whatever holds the form's values (see below).                       |
| Repo shape       | Monorepo                                                                                     |

**Why the pilot changed, and what "state" means.** The first draft of this plan piloted
formstand + shadcn/ui. But `formstand-cli` already generates formstand forms; a second tool
doing the same would prove nothing about the design. @formation exists to do what
formstand-cli does for _other_ ways of holding form state, so the pilot is the one with no
form library at all: a raw zustand store, where the generator has to emit the whole state
layer itself. If the adapter boundary survives that, an adapter that merely emits calls
into formstand or react-hook-form is the easy case.

That is also why there is a single **state** axis rather than separate "state library" and
"form library" ones. To the generator they answer the same question — where do values live
and how does a field bind — and a project picks exactly one answer. `zustand`, `formstand`
and `react-hook-form` are all ids on `--state`.

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
                              state adapter + ui adapter + validator emitter
                                                │
                                                ▼
                                          ComponentIR          (props, setup, element tree)
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
  optional: boolean; // the key may be absent
  nullable: boolean; // the value may be null — a different blank, see below
  description?: string;
  defaultValue?: unknown;
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

Three more things the pilot forced into the IR (the sketch above is abridged; the source of
truth is `packages/core/src/form-ir.ts`):

- **`nullable` is separate from `optional`.** Clearing a control has to write _something_
  back: `undefined` for an optional field, `null` for a nullable one. An API that
  distinguishes the two rejects the wrong blank, so the IR cannot merge them.
- **A date carries its `encoding`** — ISO text (a JSON document) or a `Date` (`z.date()`).
  Same control, opposite conversions.
- **A path through an array uses `*` for the row**: `["contacts", "*", "phone"]`. Ingest
  refuses a property literally named `*`, numeric, or containing a dot (`isAddressable`),
  because generated state code addresses fields as dotted strings and each of those would
  be read back as something else.

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
  stateLibraries: {
    zustand: { status: "available", frameworks: ["react"] },
    formstand: { status: "planned", frameworks: ["react"] },
    "react-hook-form": { status: "planned", frameworks: ["react"] },
    // …
  },
  uiLibraries: {
    mui: { status: "available", frameworks: ["react"], majors: { supported: [7, 9], current: 9 } },
    vuetify: { status: "planned", frameworks: ["vue"] },
  },
} as const;
```

**`planned` is a status, not an absence.** `--state formstand` answers "on the roadmap but
not implemented yet", where an unknown id answers "unknown". An entry is `available` only
when an adapter exists; a test in the CLI fails if the registry and the adapter maps
disagree in either direction.

**UI majors are pinned.** `--ui mui@7` selects a major; bare `mui` means the current one.
A major is listed only if the golden project (§10) typechecks and runs generated output
against it, and an unlisted major is refused rather than approximated — emitting for it
would claim a check nobody ran.

Both CLI modes consume it: the **wizard** filters the next question's options by it (pick
Vue, never see shadcn), and the **raw CLI** validates flag combinations against it with the
same error text. This is the thing that keeps the two modes from drifting into two products.

---

## 6. Emit

Four adapter kinds, each with one job:

**UI adapter** — `FieldNode → ControlSpec`. Which component, which import, which props.
No framework knowledge. `{ kind: "string", format: "email" }` → `<Input type="email" />`
plus the shadcn import path.

**State adapter** — emits the state module (for zustand: the whole store) and returns a
`StateBinding` describing the hooks it exports. How a field binds, how errors are read, how
submit wires up, how a `path` is serialized, what "blank" means: all of it lives here.

**Validator emitter** — emits the schema itself when the input carried no runtime validator
(JSON Schema, OpenAPI, later TypeScript). A Zod input is never re-emitted: its own schema is
imported as-is, because refinements and messages have no JSON Schema form and a regenerated
copy would validate less than the original.

**Framework printer** — `ComponentIR → source text`.

### The contract between state and UI

A UI adapter never sees the state library. What lets that work is a fixed contract for the
_generated_ code: every state adapter emits hooks returning these shapes, and every UI
adapter binds only to them.

| Hook                                                      | Takes  | Returns                                      |
| --------------------------------------------------------- | ------ | -------------------------------------------- |
| field — one per kind: text, number, boolean, choice, date | `path` | `{ name, value, error, setValue, onBlur }`   |
| variant — picks a discriminated union's branch            | `path` | the same handle; `value` is the branch's tag |
| list                                                      | `path` | `{ ids, error, append, remove }`             |
| form                                                      | —      | `{ submitting, error, handleSubmit, reset }` |

A variant handle is deliberately the same shape as a choice field's, so a UI adapter draws a
union's branch picker with the control it already has. What differs is behind the handle:
`setValue` replaces the whole union with the chosen branch's blank, rather than carrying the
old branch's fields into data they do not belong to.

The load-bearing detail: a field handle's `value` is always the **control's** type —
`string` for text, number, choice and date controls, `boolean` for a switch. Converting to
and from the stored value (a number, a `Date`, `null` for a cleared nullable field, the
half-typed `"1."` that is not a number yet) is the state adapter's job, because only it
knows what blank means in its store. The UI adapter is left with nothing to decide but
which component to draw.

`core` owns the walk that puts the two together (`assembleForm`): which fields nest in which
sections, which arrays become list components, what path each control binds. It asks the UI
adapter only "what do you draw here" — the same split formstand-cli's `Backend` record
made, and the reason a new UI kit is leaves and chrome rather than a re-decision of how
nested arrays work.

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
  --state zustand --ui mui@9 \
  --schema zod --framework react \
  --out ./src/components/forms
```

Only `--state` and `--ui` are required. `--framework` defaults to `react`, and `--schema`
is read from the file (a module is Zod; a `.json`/`.yaml` document is JSON Schema, or
OpenAPI when it says so). `--select` picks a schema inside a document, `--export` an export
inside a module. `--tests` exists and takes a list, but every runner is still `planned`.

```ts
// formation.config.ts — not built yet
export default defineConfig({
  schema: { source: "./schemas/**/*.ts", library: "zod" },
  output: { framework: "react", syntax: "ts", state: "zustand", dir: "./src/components/forms" },
  ui: { library: "mui@9", extensions: ["date-picker"] },
  layout: {/* … */},
  tests: { runners: ["vitest", "playwright"] },
});
```

Flags override config. Parsing is `commander`; the wizard is `@clack/prompts`.

**Eject semantics** (per the ownership decision), as built: every write records a content
hash in `.formation/manifest.json`. On a re-run, a file whose hash still matches is
regenerated silently; a file that was edited — or that formation has no record of writing —
blocks the run. Blocking is all-or-nothing (a fresh store beside a stale component would not
compile) and `--force` overrides it. The flag path reports and exits rather than prompting,
so it behaves the same in CI; an interactive "overwrite?" belongs to the wizard and is not
built yet.

---

## 9. Monorepo layout

pnpm workspaces + Changesets. The split exists so third parties can publish
`@formation/ui-mantine` without a PR to this repo.

```
packages/
  core/               FormIR, ComponentIR, adapter contracts, assembly walk, diagnostics   ✔
  registry/           compatibility matrix — consumed by both CLI modes                    ✔
  ingest-json-schema/ JSON Schema and OpenAPI → FormIR                                     ✔
  ingest-zod/         … ingest-typescript, ingest-yup, …                                   ✔
  schema-zod/         FormIR → a Zod validator, for inputs with none                       ✔
  framework-react/    printer   (… -vue, -svelte, -solid, …)                               ✔
  state-zustand/      … state-formstand, state-rhf, state-tanstack, state-formik           ✔
  ui-mui/             … ui-shadcn, ui-mantine, ui-vuetify                                  ✔
  cli/                @formation/cli                                                       ✔
  plugin-kit/         public adapter interfaces + test harness for adapter authors
  tests-vitest/       … tests-jest, tests-playwright
  create/             create-formation (app mode, phase 2)
examples/
  zustand-mui/        golden project (see §10); its schemas/ are the canonical fixtures    ✔
```

Two departures from the first draft. OpenAPI lives inside `ingest-json-schema` rather than
in a package of its own: selecting a schema out of a document is needed for a bare
`{ "$defs": … }` file too, and what remained of "OpenAPI support" after that was a handful
of dialect spellings the JSON Schema walk had to understand anyway. And the adapter
interfaces currently live in `core`; `plugin-kit` should re-export them once a second state
adapter has tested their shape.

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

The slice: **Zod + JSON Schema + OpenAPI in → React + TS + zustand + MUI 7/9 out.**

1. ✔ `core` — FormIR types, diagnostics, adapter contracts, the assembly walk
2. ✔ `ingest-json-schema` (OpenAPI included), then `ingest-zod` on top of it
3. ✔ `registry` with the pilot stack available and everything else planned
4. ✔ ComponentIR + the JSX printer + Prettier pass
5. ✔ `ui-mui` (majors 7 and 9), `state-zustand`, `schema-zod`
6. ✔ `cli generate` — raw flags, `--dry-run`, manifest-guarded writes
7. ✔ Golden project (`examples/zustand-mui`), run locally with `pnpm golden`
8. ◐ Wizard — asks, prints the equivalent command, generates. Not yet: a config file.
9. ✔ Golden project in CI (`.github/workflows/ci.yml`: format, build, unit tests, the
   golden run, and a check that the committed goldens match what the CLI emits)
10. ☐ `tests-vitest` — TestCase derivation + component spec emitter

**Known gaps in the pilot's output**, each degraded loudly rather than silently (a `TODO` in
the component, the field kept in the store and schema, a diagnostic on stderr):

- **Unions with nothing to choose by.** A discriminated union generates a branch picker and
  a block per branch (at the root, nested, or as a list's row). A union whose branches are
  not told apart by one property pinned to a distinct value each has no picker to offer.
- **A field two union branches both declare, with different blanks.** It binds, but what a
  cleared control writes back is looked up by path and so is one value for both branches;
  the generator warns and names it (`emit/branch-conflict`).
- **File inputs, tuples, records/maps, recursive and external `$ref`s.**
- **Async Zod schemas.** The store validates with `safeParse`, which throws on an async
  refinement.
- **JavaScript output** (`--syntax js`) and **every test runner**: accepted as ids, refused
  as not implemented.

Next state adapter: **formstand**. It is the cheapest second implementation (emit calls
into a library instead of a store) and the first real test of whether the handle contract
in §6 was shaped by zustand's needs or by the problem's.

Then, before broadening: **add Vue or Svelte second, not fifth.** The render-tree IR is a
hypothesis until a non-JSX printer exists. Everything about the adapter API should be
considered provisional until that happens — which is an argument for tagging v0.1 as
`0.x` and keeping `plugin-kit` explicitly unstable.

---

## 12. Risks worth naming now

- **The handle contract has one implementation.** §6's field/list/form handles were designed
  against zustand, where the adapter writes the hooks and can make them any shape. A form
  library brings hooks of its own; if `react-hook-form`'s `register` cannot be wrapped into
  a `FieldHandle` without an extra render or a lost feature, the contract moves. Treat it
  as provisional until the second state adapter lands.
- **Self-contained output duplicates its runtime.** Each generated store carries its own
  ~150 lines of path and validation plumbing, which is the price of "no runtime package".
  Ten forms is ten copies. If that grates, the fix is an opt-in shared module emitted once
  per output directory — not a published runtime, which would end the ownership model.
- **UI library churn.** Control maps go stale silently. Layer 3 testing is the only defense.
  Today MUI 7 and 9 take byte-identical output (a test pins it); the first API that
  diverges is what `muiAdapter(major)`'s parameter is for.
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
