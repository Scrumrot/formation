# @formation

A CLI form code generator. Hand it a schema, name the state library and the UI library, and
get a ready-to-use form.

[formstand-cli](https://github.com/Scrumrot/formstand) does this for one form library.
@formation is the same idea with the stack as a parameter: what holds the form's state and
what draws it are independent choices, each served by its own adapter.

> **Status: pre-alpha.** Zod, JSON Schema and OpenAPI in; a raw **zustand** store, a
> **formstand** form or a **react-hook-form** form, with **MUI 7 or 9** controls, out — for
> React + TypeScript. Other stacks are listed in the registry as planned and refused by
> name. See
> [`docs/plan.md`](./docs/plan.md) for the architecture and what comes next.

## Use it

```bash
formation generate ./schemas/profile.ts --state zustand --ui mui
formation generate ./api/order.json     --state zustand --ui mui@7
formation generate ./api/openapi.yaml   --state zustand --ui mui --select NewPet
formation generate ./schemas/profile.ts --state formstand --ui mui
formation generate ./schemas/profile.ts --state react-hook-form --ui mui
formation wizard
```

The input kind is read from the file: a `.ts`/`.js` module is a Zod schema, a `.json` or
`.yaml` file is a JSON Schema or an OpenAPI document.

| Flag                         | Meaning                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `--state <id>`               | what holds the form's values: `zustand`, `formstand` or `react-hook-form`          |
| `--ui <id>`                  | UI library, optionally pinned: `mui` (= `mui@9`), `mui@7`, `mui@9`                 |
| `--schema <id>`              | `zod`, `json-schema`, `openapi`; only needed when the extension does not say       |
| `--select <name\|#/pointer>` | documents: which schema, by name or JSON pointer (required when there are several) |
| `--export <name>`            | Zod modules: which export (default: the default export, else the only schema)      |
| `--name <Name>`              | base name; `Profile` gives `ProfileForm`. Default: derived from the schema         |
| `--out <dir>`                | where the form's folder goes, default `./src/components/forms`                     |
| `--dry-run`                  | run everything, report, write nothing                                              |
| `--force`                    | overwrite files edited since formation wrote them                                  |

## What you get

One folder per form, with no runtime dependency on formation:

```
ProfileForm/
  schema.ts        the Zod validator: re-exported for a Zod input, generated for a document
  store.ts         the state: a zustand store (or form.ts: a formstand or react-hook-form form)
                   and one hook per kind of control
  controls.tsx     MUI controls bound to those hooks
  ProfileForm.tsx  the form: sections for nested objects, a component per list, submit
  index.ts         the folder's public API
```

```tsx
import { ProfileForm } from "./components/forms/ProfileForm";

<ProfileForm onSubmit={async (data) => api.save(data)} />;
```

Your app supplies `zod` 4, `react`, `@mui/material` 7 or 9 with its theme, and the state
library you chose:

| `--state`         | Your app supplies                                              |
| ----------------- | -------------------------------------------------------------- |
| `zustand`         | `zustand` 5                                                    |
| `formstand`       | `formstand` and `zustand` 5; needs React 19                    |
| `react-hook-form` | `react-hook-form` 7 (tested on 7.92) and `@hookform/resolvers` |

- **Per-field subscriptions.** Each control selects its own slice, so a keystroke re-renders
  one field.
- **Typed paths.** `useProfileText("adress.street")` does not compile, and neither does a
  number path handed to a text control. Row paths type their index:
  `` `contacts.${number}.phone` ``.
- **Honest blanks.** A required number starts `undefined`, not `0`; a cleared optional
  field goes back to `undefined`, a cleared nullable one to `null`.
- **Two error channels.** Validation owns one; the other is yours, for what only the
  server knows, and is released when that field is edited. With zustand that is
  `setFieldError("email", "Already registered")` on the store; with formstand it is the
  form's own `setError`; with react-hook-form it is `setError` with `type: "server"`.
- **Lists** at any depth, with stable row keys.
- **Discriminated unions** (`z.discriminatedUnion`, or `oneOf` with a discriminator) as a
  branch picker plus that branch's fields, including as the rows of a list. Changing branch
  starts the new one blank instead of carrying the old one's fields along.
- **Nothing silently dropped.** A field with no control (a record, a tuple, a file, an
  external `$ref`) stays in the store and the schema, leaves a `TODO` in the component, and
  is reported on stderr.

A Zod input is validated by **your** schema, imported as-is, so refinements, transforms and
custom messages keep working. A JSON Schema or OpenAPI input gets a generated Zod schema
with messages written for the person filling in the form.

### Choosing `--state`

Every state library produces the same hooks, over the same typed paths, returning the same
handles — so `controls.tsx` and the form component are identical whichever you pick.

- **`zustand`** writes the whole store into `store.ts`. No form library to install; about
  150 lines of plumbing per form that are yours to read and change. It validates the whole
  schema on every change.
- **`formstand`** creates a formstand form in `form.ts` and wraps its hooks. Less generated
  code, and the exported form is a real formstand `Form`: dirty tracking, `diff()`, async
  validation, persistence and the devtools all work on it. Validation timing is
  formstand's (`mode: "onTouched"`), and so is what a cleared field holds.
- **`react-hook-form`** creates the form in `form.ts` with `createFormControl`, validated
  through the zod resolver, and binds each control with `useController`. The exported form
  is what `useForm()` returns (minus `formState`), and no `FormProvider` is needed. Lists
  do not use `useFieldArray`: it drops blank rows, so the generated list hook writes rows
  with `setValue` instead.

They differ in what they store in one case: a field that is both optional and nullable,
left blank. The schema accepts either blank. formstand holds `undefined`, as its own
`useField` does; the other two hold `null`. Everywhere else a blank is the same value.

### Regenerating

Generated files are yours to edit. formation records a hash of what it wrote in
`.formation/manifest.json`; re-running regenerates files you have not touched and refuses
(writing nothing) if any file was edited, unless you pass `--force`. Commit the manifest so
the rule holds for your teammates too.

## Why it's built this way

The naive design — one template per (framework × state library × UI library × test runner)
— is a cross-product in the thousands. This is built as a compiler instead, with two IRs:

- **FormIR** — what the form _means_: fields, constraints, messages. Produced by ingest.
- **ComponentIR** — props, hook calls, and an element tree, still framework-neutral.

A state adapter emits the state module and describes the hooks it exports. A UI adapter
builds controls against that description, never against the state library itself. A
framework printer turns ComponentIR into source. So zustand does not know about MUI, MUI
does not know about zustand, and adding either a state library or a UI kit is one package.

## Packages

| Package                            | What it owns                                                  |
| ---------------------------------- | ------------------------------------------------------------- |
| `@formation/core`                  | FormIR, ComponentIR, the adapter contracts, the assembly walk |
| `@formation/registry`              | Which stacks exist and which combinations are legal           |
| `@formation/ingest-json-schema`    | JSON Schema and OpenAPI documents → FormIR                    |
| `@formation/ingest-zod`            | Zod modules → FormIR, through the project's own zod           |
| `@formation/schema-zod`            | FormIR → a Zod validator, for inputs that have none           |
| `@formation/state-kit`             | What every state adapter emits alike: values, paths, handles  |
| `@formation/state-zustand`         | State adapter: a self-contained zustand store                 |
| `@formation/state-formstand`       | State adapter: a formstand form and hooks over it             |
| `@formation/state-react-hook-form` | State adapter: a react-hook-form form and hooks over it       |
| `@formation/ui-mui`                | UI adapter: MUI 7 and 9                                       |
| `@formation/framework-react`       | ComponentIR → TSX                                             |
| `@formation/cli`                   | `formation generate` (flags) and `formation wizard`           |

Planned: `plugin-kit`, more `ingest-*`, `framework-*`, `state-*`, `ui-*`, `tests-*`,
`create-formation`.

## Develop

```bash
pnpm install
pnpm build        # tsc --build across the workspace
pnpm test         # unit tests, straight from source
pnpm golden       # build, regenerate examples/golden, typecheck and run every target stack

node packages/cli/dist/bin.js generate examples/golden/schemas/order.json \
  --state zustand --ui mui --dry-run
```

[`examples/golden`](./examples/golden) is the golden project. Its generated output is
committed, typechecked against the real declarations of each supported library under strict
settings, and rendered and driven in a DOM — one spec file, run against every target stack.
A generator change that alters output shows up there as a reviewable diff.

## License

MIT
