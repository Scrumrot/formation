# @formation

A CLI form code generator. Pick your stack, hand it a schema, get form components — as raw
flags or through a wizard. Plus an app mode (`npm create formation`) that scaffolds a whole
repo around your schemas.

> **Status: pre-alpha.** The IR and the stack registry exist; no emitters are wired up yet,
> so `formation generate` resolves your stack, prints it back, and stops. See
> [`docs/plan.md`](./docs/plan.md) for the architecture and the v0.1 milestone list.

## Why it's built this way

The naive design — one template per (framework × form library × UI library × test runner) —
is a cross-product in the thousands. This is built as a compiler instead, with two IRs:

- **FormIR** — what the form _means_: fields, constraints, messages. Produced by ingest.
- **ComponentIR** — imports, hook calls, and an element tree, still framework-neutral.

So a UI adapter is `FieldNode → ControlSpec` with no framework knowledge, and a framework
printer is `ComponentIR → string` with no UI knowledge. Mantine costs one file. Svelte costs
one file.

## Packages

| Package               | What it owns                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `@formation/core`     | FormIR, diagnostics, the pipeline contract                        |
| `@formation/registry` | Which stacks exist and which combinations are legal               |
| `@formation/cli`      | `formation generate` (flags) and `formation wizard` (interactive) |

Planned: `plugin-kit`, `ingest-*`, `framework-*`, `form-*`, `ui-*`, `tests-*`, `create-formation`.

## Develop

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build

# Try the CLI without building
node --experimental-strip-types packages/cli/src/bin.ts wizard
node --experimental-strip-types packages/cli/src/bin.ts generate ./schemas/user.ts \
  --framework react --form formstand --ui shadcn --schema zod --tests vitest
```

## License

MIT
